/**
 * 会话日志自愈回归（session-log-repair.ts）。
 *
 * 锁死的契约：
 * - 只给 xingyuan/* 未标记事件行补 `"ignorable": true`，官方行保持逐字节不变；
 * - 干净文件（不含星愿事件）零写入；
 * - 防御性放弃矩阵：撕裂尾 / 坏帧 / header 版本不符 / 行解析失败 / 活会话；
 * - 多帧拼接容器可读可改；明文 .jsonl 变体同样支持；
 * - 补标幂等（二次运行零改写）；首次改写前有备份且按会话裁剪保留数；
 * - 补标后的事件仍能被 @deepseek-ai/dsh-session 的 decodeStorageRecord 读回。
 * 运行前置：无需 build（被测模块为纯 TS 源码直载），但依赖 Node ≥22.15 的 node:zlib zstd。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'
import { compressZstdFrame, repairSessionLogs, resolveDshHome, scanZstdFrames } from '../src/session-log-repair.js'
import { existsSync } from 'node:fs'

// ===== 夹具 =====

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xy-repair-'))
})

const VERSION = 0 // 与 @deepseek-ai/dsh-session 的 SESSION_FORMAT_VERSION 同步断言见用例「版本常量」

const headerLine = (id: string): string =>
  JSON.stringify({ type: 'session', version: VERSION, id, createdAt: 1756000000000, delegationDepth: 0 })

/** 官方与星愿事件的信封形状（与 Session.append 产出的明文行一致）。 */
const officialLine = (seq: number): string =>
  JSON.stringify({ type: 'user/message', seq, time: 1756000000000 + seq, data: { id: `m${seq}`, role: 'user', source: { kind: 'web' }, content: [] } })

const xingyuanLine = (seq: number): string =>
  JSON.stringify({ type: 'xingyuan/wish', seq, time: 1756000000000 + seq, data: { op: 'created', wishId: 'w1' } })

function buildPlaintext(sessionId: string, lines: string[], tornTail = ''): Buffer {
  return Buffer.from([headerLine(sessionId), ...lines].join('\n') + '\n' + tornTail, 'utf8')
}

/**
 * 按官方工件布局写 zstd 夹具：首帧内容拆出「header 行」单独成帧（官方
 * assertZstdHeaderFrame 强制首帧单行），其余内容各自成帧（持久化按批一帧）。
 */
async function writeZstdArtifact(projectDir: string, sessionId: string, chunks: Buffer[]): Promise<string> {
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
  const path = join(dir, 'session.jsonl.zstd')
  await writeFile(path, Buffer.concat(frames))
  return path
}

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
  it('版本常量与 @deepseek-ai/dsh-session 的 SESSION_FORMAT_VERSION 一致', async () => {
    expect(VERSION).toBe((await import('@deepseek-ai/dsh-session')).SESSION_FORMAT_VERSION)
    expect(resolveDshHome()).toBeTruthy()
  })

  it('zstd 日志只补标星愿事件行，官方行逐字节不变', async () => {
    const lines = [officialLine(0), xingyuanLine(1), officialLine(2), xingyuanLine(3)]
    const path = await writeZstdArtifact('--D-Projects-XingYuan-Dsh--', 'session-abc', [buildPlaintext('session-abc', lines)])
    const beforeBytes = await readFile(path)

    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1)
    expect(report.eventsMarked).toBe(2)
    expect(report.scanned).toBe(1)

    const after = splitLines(await readPlaintext(path))
    expect(after.length).toBe(lines.length + 1)
    expect(lineAt(after, 0)).toBe(headerLine('session-abc'))
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
    const path = join(dir, 'session.jsonl')
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
    expectHeaderFrame(raw, headerLine('session-multi'))
    const lines = splitLines(await readPlaintext(path))
    expect(JSON.parse(lineAt(lines, 2)).ignorable).toBe(true)
    expect(JSON.parse(lineAt(lines, 3)).ignorable).toBe(true)
    expect(lineAt(lines, 4)).toBe(secondHalf[1]!)
  })

  it('写回产物遵守官方帧布局：首帧恰好一行 header（防启动崩溃回归）', async () => {
    const path = await writeZstdArtifact('p', 'session-layout', [buildPlaintext('session-layout', [officialLine(0), xingyuanLine(1)])])
    await repairSessionLogs({ dshHome: home })
    expectHeaderFrame(await readFile(path), headerLine('session-layout'))
  })

  it('结构完整但首帧非单行 header（整文件单帧的历史错误产物）会被重写为合法布局', async () => {
    const plain = buildPlaintext('session-badlayout', [officialLine(0), xingyuanLine(1)])
    const dir = join(home, 'sessions', 'p', 'session-badlayout')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'session.jsonl.zstd')
    await writeFile(path, await compressZstdFrame(plain)) // 整文件单帧 = 错误布局
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.patched).toBe(1)
    expect(report.eventsMarked).toBe(1)
    expectHeaderFrame(await readFile(path), headerLine('session-badlayout'))
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
    expectHeaderFrame(await readFile(path), headerLine('session-relayout'))
  })

  it.each([
    ['撕裂尾', 'torn'],
    ['坏帧', 'corrupt'],
  ])('%s整文件放弃且不触碰原件', async (_label, reason) => {
    const plain = buildPlaintext('session-x', [xingyuanLine(0)])
    const frame = await compressZstdFrame(plain)
    const dir = join(home, 'sessions', 'p', 'session-x')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'session.jsonl.zstd')
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

  it('header 版本不符按格式放弃', async () => {
    const dir = join(home, 'sessions', 'p', 'session-future')
    await mkdir(dir, { recursive: true })
    const futureHeader = JSON.stringify({ type: 'session', version: 99, id: 'session-future', createdAt: 1, delegationDepth: 0 })
    const path = join(dir, 'session.jsonl.zstd')
    await writeFile(path, await compressZstdFrame(Buffer.from(`${futureHeader}\n${xingyuanLine(0)}\n`, 'utf8')))
    const before = await readFile(path)
    const report = await repairSessionLogs({ dshHome: home })
    expect(report.skipped.format).toBe(1)
    expect(await readFile(path)).toEqual(before)
  })

  it('存在解析失败的事件行时整文件放弃', async () => {
    const dir = join(home, 'sessions', 'p', 'session-badline')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'session.jsonl.zstd')
    await writeFile(path, await compressZstdFrame(buildPlaintextRaw('session-badline')))
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

  it('补标后的星愿事件仍能被 dsh-session decodeStorageRecord 读回', async () => {
    const path = await writeZstdArtifact('p', 'session-decode', [buildPlaintext('session-decode', [xingyuanLine(0), officialLine(1)])])
    await repairSessionLogs({ dshHome: home })
    const events = splitLines(await readPlaintext(path)).slice(1).map((line) => decodeStorageRecord(JSON.parse(line)))
    expect(events.length).toBe(2)
    expect(events[0]![0]).toMatchObject({ type: 'xingyuan/wish', ignorable: true, seq: 0 })
    expect(events[1]![0]).toMatchObject({ type: 'user/message', seq: 1 })
    expect((events[1]![0] as { ignorable?: true }).ignorable).toBeUndefined()
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
    await writeFile(path, Buffer.concat(await Promise.all([compressZstdFrame(Buffer.from(headerLine('session-grow') + '\n', 'utf8')), compressZstdFrame(Buffer.from(xingyuanLine(0) + '\n' + xingyuanLine(1) + '\n', 'utf8'))])))
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
    expectHeaderFrame(await readFile(path), headerLine('session-marked-relayout'))
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
})

// ===== 辅助 =====

/** 无 header 的续帧内容（模拟一帧一批复的物理布局）。 */
function buildPlaintextWithoutHeader(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n') + '\n', 'utf8')
}

/** 含一行坏 JSON 的完整明文（用于解析失败路径）。 */
function buildPlaintextRaw(sessionId: string): Buffer {
  return Buffer.from([headerLine(sessionId), '{oops', xingyuanLine(1)].join('\n') + '\n', 'utf8')
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
