/**
 * 会话日志自愈回归（session-log-repair.ts）。
 *
 * 锁死的契约：
 * - 当前格式工件（版本 = SESSION_FORMAT_VERSION，随宿主换代）：只给 xingyuan/* 未标记事件行
 *   补 `"ignorable": true`，官方行逐字节不变；
 * - 历史格式工件（版本 < 当前）：xingyuan/* 事件行替换为惰性 hook/invoked（seq/time 不变），
 *   替换产物能被官方迁移链（dsh-session-format-catalog）迁移并回放；
 * - 干净文件（不含星愿事件）零写入；
 * - 目录内多代工件并存时只处理最新代（旧代被遮蔽，零写入）；
 * - 防御性放弃矩阵：撕裂尾 / 坏帧 / header 版本与工件名不符 / 行解析失败 / 活会话；
 * - 多帧拼接容器可读可改；明文 .jsonl 变体同样支持；
 * - 改写幂等（二次运行零改写）；首次改写前有备份且按会话裁剪保留数；
 * - 补标后的事件仍能被官方恢复管线（createSessionFormatCatalogWithChildren().createRestore）读回。
 * 运行前置：无需 build（被测模块为纯 TS 源码直载），但依赖 Node ≥22.15 的 node:zlib zstd。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'
import { compressZstdFrame, repairSessionLogs, resolveDshHome, scanZstdFrames } from '../src/session-log-repair.js'
import { existsSync } from 'node:fs'

// ===== 夹具 =====

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xy-repair-'))
})

/** 当前格式代与旧格式夹具代（v0：0.1.2-rc.1 及更早写入的代）。 */
const CURRENT: number = SESSION_FORMAT_VERSION
const LEGACY = 0

/** 官方工件名（v0 无版本段；更高代带 .vN）。 */
const currentFilename = (compressed = true): string =>
  `${CURRENT === 0 ? 'session' : `session.v${CURRENT}`}.jsonl${compressed ? '.zstd' : ''}`
const legacyFilename = (compressed = true): string => `session.jsonl${compressed ? '.zstd' : ''}`

/** 旧格式（v0/v1）物理 header：isSeeded 由 seedLength 派生，不能显式出现。 */
const legacyHeaderLine = (id: string): string =>
  JSON.stringify({ type: 'session', version: LEGACY, id, createdAt: 1756000000000, delegationDepth: 0 })

/**
 * 「ignorable 感知的旧代」夹具（v3）：v3→v4 迁移边在严格拒绝前先放行带标未知事件
 * （重命名为 `plugin:<type>`、载荷与坐标原样保留），所以这一代只需补标、不该被去毒。
 * 与 SESSION_FORMAT_VERSION 解耦，宿主再升代时本组用例照旧有效。
 */
const V3 = 3
const v3HeaderLine = (id: string): string =>
  JSON.stringify({ type: 'session', version: V3, id, createdAt: 1756000000000, isSeeded: false, delegationDepth: 0 })
const v3Filename = (compressed = true): string => `session.v${V3}.jsonl${compressed ? '.zstd' : ''}`
function buildV3Plaintext(sessionId: string, lines: string[]): Buffer {
  return Buffer.from([v3HeaderLine(sessionId), ...lines].join('\n') + '\n', 'utf8')
}

/** 最小合法 v3 会话骨架（与 v0 骨架同构）；星愿行固定在 V3_XINGYUAN_INDEX。 */
const V3_XINGYUAN_INDEX = 3
function v3SessionLines(): string[] {
  return [
    eventLine('turn/start', 0, { turn: 1 }),
    eventLine('step/start', 1, { turn: 1, step: 1 }),
    officialLine(2),
    xingyuanLine(3),
    eventLine('step/end', 4, { turn: 1, step: 1 }),
    eventLine('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/**
 * 同一骨架去掉星愿行并重编号（官方链要求 seq 与行号密集相等）——用于「夹具本身合法」
 * 的对照：它必须能通过迁移链，否则下面「未补标即被拒绝」的用例只是在测夹具不合法。
 */
const v3OfficialLines = (): string[] => v3SessionLines()
  .filter((_, i) => i !== V3_XINGYUAN_INDEX)
  .map((line, i) => JSON.stringify({ ...(JSON.parse(line) as Record<string, unknown>), seq: i }))

/** 当前格式物理 header：必须显式 isSeeded/delegationDepth。 */
const currentHeaderLine = (id: string): string =>
  JSON.stringify({ type: 'session', version: CURRENT, id, createdAt: 1756000000000, isSeeded: false, delegationDepth: 0 })

/** 官方与星愿事件的信封形状（surface 事件带 surfaceOp，与 Session.append 产出一致）。 */
const officialLine = (seq: number): string =>
  JSON.stringify({ type: 'user/message', seq, time: 1756000000000 + seq, data: { id: `m${seq}`, role: 'user', source: { kind: 'user' }, content: [] }, surfaceOp: 'append' })

const xingyuanLine = (seq: number): string =>
  JSON.stringify({ type: 'xingyuan/wish', seq, time: 1756000000000 + seq, data: { op: 'created', wishId: 'w1' } })

/** 通用官方事件行（构造最小合法会话骨架用）。 */
const eventLine = (type: string, seq: number, data: Record<string, unknown>): string =>
  JSON.stringify({ type, seq, time: 1756000000000 + seq, data })

/** 最小合法 v0 会话骨架：迁移要求首个 surface 事件处于打开的 step 内。 */
function legacySessionLines(): string[] {
  return [
    eventLine('turn/start', 0, { turn: 1 }),
    eventLine('step/start', 1, { turn: 1, step: 1 }),
    officialLine(2),
    xingyuanLine(3),
    eventLine('step/end', 4, { turn: 1, step: 1 }),
    eventLine('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }),
  ]
}

function buildPlaintext(sessionId: string, lines: string[], tornTail = ''): Buffer {
  return Buffer.from([currentHeaderLine(sessionId), ...lines].join('\n') + '\n' + tornTail, 'utf8')
}

/** 旧格式完整明文（v0 header + 行）。 */
function buildLegacyPlaintext(sessionId: string, lines: string[]): Buffer {
  return Buffer.from([legacyHeaderLine(sessionId), ...lines].join('\n') + '\n', 'utf8')
}

/**
 * 按官方工件布局写 zstd 夹具：首帧内容拆出「header 行」单独成帧（官方
 * assertZstdHeaderFrame 强制首帧单行），其余内容各自成帧（持久化按批一帧）。
 */
async function writeZstdArtifact(projectDir: string, sessionId: string, chunks: Buffer[], filename = currentFilename()): Promise<string> {
  const dir = join(home, 'sessions', projectDir, sessionId)
  await mkdir(dir, { recursive: true })
  const first = chunks[0]
  if (first === undefined) throw new Error('fixture 至少需要一个 chunk')
  const headerEnd = first.indexOf(10)
  if (headerEnd === -1) throw new Error('fixture 首帧内容缺少 header 行')
  const frames: Buffer[] = [await compressZstdFrame(first.subarray(0, headerEnd + 1))]
  const firstRest = first.subarray(headerEnd + 1)
  if (firstRest.length > 0) frames.push(await compressZstdFrame(firstRest))
  for (const chunk of chunks.slice(1)) frames.push(await compressZstdFrame(chunk))
  const path = join(dir, filename)
  await writeFile(path, Buffer.concat(frames))
  return path
}

/** 用官方恢复管线（严格模式 + 当前词汇校验）读一个工件：迁移拒绝或读取失败即抛。 */
function restoreArtifact(headerLine: string, rows: string[]): { header: { version: number }; events: Array<Record<string, unknown>> } {
  const restore = catalog.createRestore(JSON.parse(headerLine), { recovery: 'strict', validation: 'current' })
  for (const row of rows) restore.decodeRow(JSON.parse(row))
  return restore.finish() as unknown as { header: { version: number }; events: Array<Record<string, unknown>> }
}

/**
 * dsh 0.1.7 的 v3→v4 迁移边要求显式提供「该父会话的历史子会话证据」（子会话 =
 * subagent 子日志，真实宿主由 persistence 层读齐再绑定）。本文件的夹具没有子会话，
 * 空数组就是"无子会话"的显式声明——缺这份证据时整条边直接拒绝迁移。
 */
const catalog = createSessionFormatCatalogWithChildren([])

/** 断言容器首帧恰好一行 header（复刻官方 assertZstdHeaderFrame）。 */
function expectHeaderFrame(container: Buffer, expectedHeader: string): void {
  const scan = scanZstdFrames(container)
  expect(scan.tornStart).toBeUndefined()
  const first = zstdDecompressSync(container.subarray(scan.frames[0]!.start, scan.frames[0]!.end))
  expect(first.length).toBeGreaterThan(0)
  expect(first.indexOf(10)).toBe(first.length - 1)
  expect(first.toString('utf8')).toBe(`${expectedHeader}\n`)
}

/** 读回 zstd 容器并跨帧全解为明文（容器可能是多帧：首帧 header + 事件帧）。 */
async function readPlaintext(path: string): Promise<Buffer> {
  const raw = await readFile(path)
  if (!path.endsWith('.zstd')) return raw
  const scan = scanZstdFrames(raw)
  return Buffer.concat(scan.frames.map((frame) => zstdDecompressSync(raw.subarray(frame.start, frame.end))))
}

function splitLines(text: Buffer): string[] {
  const out = text.toString('utf8').split('\n')
  if (out.at(-1) === '') out.pop()
  return out
}

/** 带断言的行访问（noUncheckedIndexedAccess 收窄，越界直接炸测试）。 */
function lineAt(lines: string[], index: number): string {
  const value = lines[index]
  if (value === undefined) throw new Error(`fixture 行缺失：index=${index}`)
  return value
}

// ===== 用例 =====

describe('会话日志自愈', () => {
  it('resolveDshHome 恒定可解析', () => {
    expect(resolveDshHome()).toBeTruthy()
  })

  it('zstd 日志只补标星愿事件行，官方行逐字节不变', async () => {
    const lines = [officialLine(0), xingyuanLine(1), officialLine(2), xingyuanLine(3)]
    const path = await writeZstdArtifact('--D-Projects-XingYuan-Dsh--', 'session-abc', [buildPlaintext('session-abc', lines)])
    const beforeBytes = await readFile(path)

    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1)
    expect(report.eventsMarked).toBe(2)
    expect(report.neutralized).toBe(0)
    expect(report.scanned).toBe(1)

    const after = splitLines(await readPlaintext(path))
    expect(after.length).toBe(lines.length + 1)
    expect(lineAt(after, 0)).toBe(currentHeaderLine('session-abc'))
    expect(lineAt(after, 1)).toBe(lineAt(lines, 0))
    expect(lineAt(after, 3)).toBe(lineAt(lines, 2))
    expect(JSON.parse(lineAt(after, 2))).toEqual({ ...JSON.parse(lineAt(lines, 1)), ignorable: true })
    expect(JSON.parse(lineAt(after, 4))).toEqual({ ...JSON.parse(lineAt(lines, 3)), ignorable: true })

    // 与修复前的原始明文对照：非星愿行的 utf8 字节完全一致（跨帧全解）
    const beforeScan = scanZstdFrames(beforeBytes)
    const before = splitLines(Buffer.concat(beforeScan.frames.map((frame) => zstdDecompressSync(beforeBytes.subarray(frame.start, frame.end)))))
    expect(lineAt(before, 1)).toBe(lineAt(after, 1))
  })

  it('补标幂等：二次运行零改写、字节稳定', async () => {
    const path = await writeZstdArtifact('p', 'session-idem', [buildPlaintext('session-idem', [xingyuanLine(0)])])
    await repairSessionLogs({ dshHome: home })
    const once = await readFile(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(0)
    expect(report.scanned).toBe(1)
    expect(await readFile(path)).toEqual(once)
  })

  it('纯官方日志零写入（含 mtime）', async () => {
    const path = await writeZstdArtifact('p', 'session-clean', [buildPlaintext('session-clean', [officialLine(0), officialLine(1)])])
    const before = await readFile(path)
    const beforeStat = await stat(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(0)
    expect(report.skipped).toEqual({})
    expect(await readFile(path)).toEqual(before)
    expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs)
  })

  it('明文 .jsonl 工件同样支持', async () => {
    const dir = join(home, 'sessions', 'p', 'session-plain')
    await mkdir(dir, { recursive: true })
    const path = join(dir, currentFilename(false))
    await writeFile(path, buildPlaintext('session-plain', [officialLine(0), xingyuanLine(1)]))
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1)
    const text = (await readFile(path)).toString('utf8')
    expect(JSON.parse(lineAt(splitLines(Buffer.from(text)), 2)).ignorable).toBe(true)
  })

  it('多帧拼接容器：全部帧解出后统一补标，产物按官方布局重组（首帧单行 header）', async () => {
    const firstHalf = [officialLine(0), xingyuanLine(1)]
    const secondHalf = [xingyuanLine(2), officialLine(3)]
    const path = await writeZstdArtifact('p', 'session-multi', [
      buildPlaintext('session-multi', firstHalf),
      buildPlaintextWithoutHeader(secondHalf),
    ])
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.eventsMarked).toBe(2)
    const raw = await readFile(path)
    expectHeaderFrame(raw, currentHeaderLine('session-multi'))
    const lines = splitLines(await readPlaintext(path))
    expect(JSON.parse(lineAt(lines, 2)).ignorable).toBe(true)
    expect(JSON.parse(lineAt(lines, 3)).ignorable).toBe(true)
    expect(lineAt(lines, 4)).toBe(secondHalf[1]!)
  })

  it('写回产物遵守官方帧布局：首帧恰好一行 header（防启动崩溃回归）', async () => {
    const path = await writeZstdArtifact('p', 'session-layout', [buildPlaintext('session-layout', [officialLine(0), xingyuanLine(1)])])
    await repairSessionLogs({ dshHome: home })
    expectHeaderFrame(await readFile(path), currentHeaderLine('session-layout'))
  })

  it('结构完整但首帧非单行 header（整文件单帧的历史错误产物）会被重写为合法布局', async () => {
    const plain = buildPlaintext('session-badlayout', [officialLine(0), xingyuanLine(1)])
    const dir = join(home, 'sessions', 'p', 'session-badlayout')
    await mkdir(dir, { recursive: true })
    const path = join(dir, currentFilename())
    await writeFile(path, await compressZstdFrame(plain)) // 整文件单帧 = 错误布局
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1)
    expect(report.eventsMarked).toBe(1)
    expectHeaderFrame(await readFile(path), currentHeaderLine('session-badlayout'))
  })

  it('无需补标但布局非法的容器仍重写为合法布局（relayout-only，幂等自愈）', async () => {
    const path = await writeZstdArtifact('p', 'session-relayout', [buildPlaintext('session-relayout', [xingyuanLine(0)])])
    await repairSessionLogs({ dshHome: home }) // 先正常补标 → 官方布局
    // 破坏布局：整文件重压为单帧（模拟历史错误产物）
    const plain = await readPlaintext(path)
    await writeFile(path, await compressZstdFrame(plain))
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1) // relayout-only
    expect(report.eventsMarked).toBe(0) // 无新增补标（已有 1 条已标记，回填 totalMarked）
    expectHeaderFrame(await readFile(path), currentHeaderLine('session-relayout'))
  })

  it.each([
    ['撕裂尾', 'torn'],
    ['坏帧', 'corrupt'],
  ])('%s整文件放弃且不触碰原件', async (_label, reason) => {
    const plain = buildPlaintext('session-x', [xingyuanLine(0)])
    const frame = await compressZstdFrame(plain)
    const dir = join(home, 'sessions', 'p', 'session-x')
    await mkdir(dir, { recursive: true })
    const path = join(dir, currentFilename())
    if (reason === 'torn') {
      await writeFile(path, frame.subarray(0, frame.length - 5)) // 截掉校验和所在的尾部
    } else {
      const broken = Buffer.from(frame)
      broken[10] = broken[10]! ^ 0xff // 结构区翻转 → 扫描/解压必炸
      await writeFile(path, broken)
    }
    const before = await readFile(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(0)
    expect(Object.keys(report.skipped)).toEqual([reason])
    expect(await readFile(path)).toEqual(before)
  })

  it('活会话跳过，交给下次启动', async () => {
    const path = await writeZstdArtifact('p', 'session-live', [buildPlaintext('session-live', [xingyuanLine(0)])])
    const before = await readFile(path)
    const report = await repairSessionLogs({ dshHome: home, listLiveSessionIds: () => new Set(['session-live']) })
    expect(report.skipped.live).toBe(1)
    expect(report.patched).toBe(0)
    expect(await readFile(path)).toEqual(before)
  })

  it('header 版本与工件名不符按格式放弃', async () => {
    const dir = join(home, 'sessions', 'p', 'session-future')
    await mkdir(dir, { recursive: true })
    const futureHeader = JSON.stringify({ type: 'session', version: 99, id: 'session-future', createdAt: 1, delegationDepth: 0 })
    const path = join(dir, legacyFilename())
    await writeFile(path, await compressZstdFrame(Buffer.from(`${futureHeader}\n${xingyuanLine(0)}\n`, 'utf8')))
    const before = await readFile(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.skipped.format).toBe(1)
    expect(await readFile(path)).toEqual(before)
  })

  it('存在解析失败的事件行时整文件放弃', async () => {
    const dir = join(home, 'sessions', 'p', 'session-badline')
    await mkdir(dir, { recursive: true })
    const path = join(dir, legacyFilename())
    await writeFile(path, await compressZstdFrame(buildLegacyPlaintextRaw('session-badline')))
    const before = await readFile(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.skipped.unparsable).toBe(1)
    expect(await readFile(path)).toEqual(before)
  })

  it('首次改写前备份原件，多次改写按上限裁剪', async () => {
    const path = await writeZstdArtifact('proj-key', 'session-bak', [buildPlaintext('session-bak', [xingyuanLine(0)])])
    const original = await readFile(path)

    await repairSessionLogs({ dshHome: home })
    let backups = await listBackups('proj-key')
    expect(backups.length).toBe(1)
    expect(zstdDecompressSync(await readFile(backups[0]!))).toEqual(zstdDecompressSync(original))

    // 追加新的未标记事件 → 第二次改写
    const appended = buildPlaintext('session-bak', [xingyuanLine(0), xingyuanLine(1)])
    await writeFile(path, await compressZstdFrame(appended))
    await repairSessionLogs({ dshHome: home, maxBackupPerSession: 1 })
    backups = await listBackups('proj-key')
    expect(backups.length).toBe(1) // 上限裁剪生效
  })

  it('补标后的当前格式工件能被官方恢复管线读回（ignorable 保留）', async () => {
    const path = await writeZstdArtifact('p', 'session-decode', [buildPlaintext('session-decode', [officialLine(0), xingyuanLine(1)])])
    await repairSessionLogs({ dshHome: home })
    const rows = splitLines(await readPlaintext(path))
    const artifact = restoreArtifact(lineAt(rows, 0), rows.slice(1))
    expect(artifact.header.version).toBe(CURRENT)
    expect(artifact.events[0]).toMatchObject({ type: 'user/message', seq: 0 })
    expect(artifact.events[1]).toMatchObject({ type: 'xingyuan/wish', ignorable: true, seq: 1 })
  })

  it('多个项目目录与会话遍历计数正确', async () => {
    await writeZstdArtifact('projA', 'session-a1', [buildPlaintext('session-a1', [xingyuanLine(0)])])
    await writeZstdArtifact('projA', 'session-a2', [buildPlaintext('session-a2', [officialLine(0)])])
    await writeZstdArtifact('projB', 'session-b1', [buildPlaintext('session-b1', [xingyuanLine(0), xingyuanLine(1)])])
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.scanned).toBe(3)
    expect(report.patched).toBe(2)
    expect(report.eventsMarked).toBe(3)
  })

  it('已标记会话增量跳过：不改写工件、不落备份、事件数从标记回填', async () => {
    const path = await writeZstdArtifact('p', 'session-marked', [buildPlaintext('session-marked', [xingyuanLine(0), xingyuanLine(1)])])
    await repairSessionLogs({ dshHome: home })
    expect((await listBackups('p')).length).toBe(1)

    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(0)
    expect(report.scanned).toBe(1)
    expect(report.eventsMarked).toBe(2) // 从标记回填，不重新解压
    expect((await listBackups('p')).length).toBe(1) // 没有新备份
    expect(await readFile(path)).toEqual(await readFile(path)) // 工件未动
  })

  it('工件字节数变化（新事件落盘）使标记失效并重扫补标', async () => {
    const path = await writeZstdArtifact('p', 'session-grow', [buildPlaintext('session-grow', [xingyuanLine(0)])])
    await repairSessionLogs({ dshHome: home })
    // 追加新事件（字节数变化）→ 标记失效
    await writeFile(path, Buffer.concat(await Promise.all([compressZstdFrame(Buffer.from(currentHeaderLine('session-grow') + '\n', 'utf8')), compressZstdFrame(Buffer.from(xingyuanLine(0) + '\n' + xingyuanLine(1) + '\n', 'utf8'))])))
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1)
    expect(report.eventsMarked).toBe(2) // 追加后两条都被重新补标（标记失效触发全量重扫）
    // 标记已刷新：再跑一次增量跳过
    const next = await repairSessionLogs({ dshHome: home })
    expect(next.patched).toBe(0)
  })

  it('布局损坏（整文件单帧错误产物）不受标记保护：relayout-only 重写并刷新标记', async () => {
    const path = await writeZstdArtifact('p', 'session-marked-relayout', [buildPlaintext('session-marked-relayout', [xingyuanLine(0)])])
    await repairSessionLogs({ dshHome: home })
    // 破坏布局：整文件重压成单帧（字节数与官方布局不同，触发标记失效 → 重扫 → relayout-only 修复）
    const plain = await readPlaintext(path)
    await writeFile(path, await compressZstdFrame(plain))
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1) // relayout-only 修复
    expectHeaderFrame(await readFile(path), currentHeaderLine('session-marked-relayout'))
    // 标记已刷新（新字节数），再跑增量跳过
    const next = await repairSessionLogs({ dshHome: home })
    expect(next.patched).toBe(0)
  })

  it('标记文件存在但损坏/缺失时重扫', async () => {
    const path = await writeZstdArtifact('p', 'session-badmarker', [buildPlaintext('session-badmarker', [xingyuanLine(0)])])
    await repairSessionLogs({ dshHome: home })
    const markerPath = join(home, 'sessions', 'p', 'session-badmarker', '.xingyuan-repaired')
    await writeFile(markerPath, '{oops') // 损坏
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(0) // 已补标，无需重写
    expect(report.eventsMarked).toBe(0) // 无新增补标（已标记事件走 clean，回填 totalMarked）
    expect(existsSync(markerPath)).toBe(true)
  })

  // ===== 旧格式（<v3）去毒路径 =====

  it('旧格式工件：星愿行替换为惰性 hook/invoked，官方行逐字节不变且有备份', async () => {
    const lines = [officialLine(0), xingyuanLine(1), officialLine(2)]
    const path = await writeZstdArtifact('p', 'session-legacy', [buildLegacyPlaintext('session-legacy', lines)], legacyFilename())
    const before = splitLines(await readPlaintext(path))

    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1)
    expect(report.eventsMarked).toBe(0)
    expect(report.neutralized).toBe(1)

    const after = splitLines(await readPlaintext(path))
    expect(lineAt(after, 0)).toBe(legacyHeaderLine('session-legacy'))
    expect(lineAt(after, 1)).toBe(lineAt(before, 1)) // 官方行逐字节不变
    expect(lineAt(after, 3)).toBe(lineAt(before, 3))
    const filler = JSON.parse(lineAt(after, 2)) as { type: string; seq: number; time: number; data: Record<string, unknown> }
    expect(filler.type).toBe('hook/invoked')
    expect(filler.seq).toBe(1)
    expect(filler.time).toBe(1756000000001)
    expect(filler.data['handlerId']).toContain('xingyuan-repair:session-legacy:1')
    expect((await listBackups('p')).length).toBe(1)
  })

  it('旧格式替换产物可被官方迁移链迁移到当前格式，卡片事件不再回放', async () => {
    const path = await writeZstdArtifact('p', 'session-migrate', [buildLegacyPlaintext('session-migrate', legacySessionLines())], legacyFilename())
    await repairSessionLogs({ dshHome: home })
    const rows = splitLines(await readPlaintext(path))
    const artifact = restoreArtifact(lineAt(rows, 0), rows.slice(1))
    expect(artifact.header.version).toBe(CURRENT)
    expect(artifact.events.some((event) => String(event['type']).startsWith('xingyuan/'))).toBe(false)
    expect(artifact.events.some((event) => event['type'] === 'hook/invoked')).toBe(true)
  })

  it('旧格式未修复的原始星愿事件会被官方迁移链拒绝（去毒必要性回归）', async () => {
    const path = await writeZstdArtifact('p', 'session-raw-legacy', [buildLegacyPlaintext('session-raw-legacy', legacySessionLines())], legacyFilename())
    const rows = splitLines(await readPlaintext(path))
    expect(() => restoreArtifact(lineAt(rows, 0), rows.slice(1))).toThrow(/unknown historical event/)
  })

  it('旧格式干净文件零写入（工件字节与 mtime 不变）', async () => {
    const path = await writeZstdArtifact('p', 'session-legacy-clean', [buildLegacyPlaintext('session-legacy-clean', [officialLine(0)])], legacyFilename())
    const before = await readFile(path)
    const beforeStat = await stat(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(0)
    expect(report.neutralized).toBe(0)
    expect(await readFile(path)).toEqual(before)
    expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs)
  })

  it('旧格式去毒幂等：二次运行零改写', async () => {
    const path = await writeZstdArtifact('p', 'session-legacy-idem', [buildLegacyPlaintext('session-legacy-idem', [xingyuanLine(0)])], legacyFilename())
    await repairSessionLogs({ dshHome: home })
    const once = await readFile(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(0)
    expect(report.neutralized).toBe(0)
    expect(await readFile(path)).toEqual(once)
  })

  // ===== ignorable 感知的旧代（v3）：补标面，不是去毒面 =====

  /**
   * 对照用例（先证明夹具合法）：纯官方行的 v3 工件必须能被官方链迁移到当前代。
   * 缺这条对照时，下面「未补标被拒绝」的用例可能只是夹具本身不合法而在假阳性通过。
   */
  it('v3 官方行夹具可被官方链迁移到当前格式（对照：夹具合法）', async () => {
    const rows = splitLines(buildV3Plaintext('session-v3-control', v3OfficialLines()))
    const artifact = restoreArtifact(lineAt(rows, 0), rows.slice(1))
    expect(artifact.header.version).toBe(CURRENT)
  })

  it('v3 工件走补标而非去毒：星愿事件数据原样保留', async () => {
    const lines = v3SessionLines()
    const path = await writeZstdArtifact('p', 'session-v3', [buildV3Plaintext('session-v3', lines)], v3Filename())
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.eventsMarked).toBe(1)
    expect(report.neutralized).toBe(0)

    const after = splitLines(await readPlaintext(path))
    // 官方行逐字节不变；星愿行只多出一个 ignorable 字段
    for (const [i, line] of lines.entries()) {
      if (i !== V3_XINGYUAN_INDEX) expect(lineAt(after, i + 1)).toBe(line)
    }
    const marked = JSON.parse(lineAt(after, V3_XINGYUAN_INDEX + 1)) as Record<string, unknown>
    expect(marked['type']).toBe('xingyuan/wish')
    expect(marked['ignorable']).toBe(true)
    expect(marked['data']).toEqual({ op: 'created', wishId: 'w1' })
  })

  it('v3 补标产物经官方 v3→v4 链保留为 plugin: 前缀事件（卡片数据不销毁）', async () => {
    const path = await writeZstdArtifact('p', 'session-v3-keep', [buildV3Plaintext('session-v3-keep', v3SessionLines())], v3Filename())
    await repairSessionLogs({ dshHome: home })
    const rows = splitLines(await readPlaintext(path))
    const artifact = restoreArtifact(lineAt(rows, 0), rows.slice(1))
    expect(artifact.header.version).toBe(CURRENT)
    const kept = artifact.events.find((event) => String(event['type']).startsWith('plugin:xingyuan/'))
    expect(kept).toBeDefined()
    expect(kept?.['data']).toEqual({ op: 'created', wishId: 'w1' })
    expect(kept?.['ignorable']).toBe(true)
  })

  it('v3 未补标的星愿事件会被官方链拒绝（补标仍是必需）', async () => {
    const rows = splitLines(buildV3Plaintext('session-v3-raw', v3SessionLines()))
    expect(() => restoreArtifact(lineAt(rows, 0), rows.slice(1))).toThrow(/unknown event type/)
  })

  it('目录内多代并存：只处理最新代（旧代被遮蔽，零写入）', async () => {
    const dir = join(home, 'sessions', 'p', 'session-generations')
    await mkdir(dir, { recursive: true })
    // 旧代 v0：含未处理星愿事件（若被错误处理会改写）
    const legacyPath = join(dir, legacyFilename())
    await writeFile(legacyPath, await compressZstdFrame(buildLegacyPlaintext('session-generations', [xingyuanLine(0)])))
    const legacyBefore = await readFile(legacyPath)
    // 当前代 v3：也应被补标
    const currentPath = join(dir, currentFilename())
    await writeFile(currentPath, Buffer.concat(await Promise.all([
      compressZstdFrame(Buffer.from(currentHeaderLine('session-generations') + '\n', 'utf8')),
      compressZstdFrame(Buffer.from(xingyuanLine(0) + '\n', 'utf8')),
    ])))

    const report = await repairSessionLogs({ dshHome: home })
    expect(report.scanned).toBe(1)
    expect(report.patched).toBe(1)
    expect(report.eventsMarked).toBe(1)
    expect(report.neutralized).toBe(0)
    expect(await readFile(legacyPath)).toEqual(legacyBefore) // 旧代未被触碰
    const current = splitLines(await readPlaintext(currentPath))
    expect(JSON.parse(lineAt(current, 1)).ignorable).toBe(true)
  })

  it('非规范工件名（v0 带版本段 / 前导零）一律不处理', async () => {
    const dir = join(home, 'sessions', 'p', 'session-noncanonical')
    await mkdir(dir, { recursive: true })
    const names = ['session.v0.jsonl.zstd', 'session.v01.jsonl.zstd']
    for (const name of names) {
      await writeFile(join(dir, name), await compressZstdFrame(buildLegacyPlaintext('session-noncanonical', [xingyuanLine(0)])))
    }
    const before = await Promise.all(names.map((name) => readFile(join(dir, name))))
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.scanned).toBe(0)
    expect(report.patched).toBe(0)
    for (const [index, name] of names.entries()) {
      expect(await readFile(join(dir, name))).toEqual(before[index])
    }
  })
})

// ===== 辅助 =====

/** 无 header 的续帧内容（模拟一帧一批复的物理布局）。 */
function buildPlaintextWithoutHeader(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n') + '\n', 'utf8')
}

/** 含一行坏 JSON 的旧格式完整明文（用于解析失败路径）。 */
function buildLegacyPlaintextRaw(sessionId: string): Buffer {
  return Buffer.from([legacyHeaderLine(sessionId), '{oops', xingyuanLine(1)].join('\n') + '\n', 'utf8')
}

async function listBackups(projectDir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const dir = join(home, 'xingyuan', 'session-backups', projectDir)
  try {
    return (await readdir(dir)).map((name) => join(dir, name))
  } catch {
    return []
  }
}
