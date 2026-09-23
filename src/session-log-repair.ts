/**
 * 会话日志自愈（bundle 常驻层）。
 *
 * 背景：dsh 会话持久化读取端按「本仓库生成的官方事件类型白名单」拒绝未知事件；
 * 仓库外插件事件按构造不在名单内，而写入端（Session.append）至今没有 ignorable
 * 标记通道。**接受规则按迁移边分档，且随宿主换代在变**（下列事实逐条取自各
 * dsh-session-format-vN-to-vM 的 lib/index.js，勿凭印象改）：
 * - 当前格式（版本 = SESSION_FORMAT_VERSION，工件名 session.v{N}.jsonl[.zstd]）：
 *   读取端认 `ignorable: true`，不认识的带标事件被安全跳过且数据原样保留；
 * - **v3 → v4 迁移边同样接受 ignorable 未知事件**：把它们重命名为
 *   `plugin:<type>` 并保留载荷与坐标（`namespaceV3OpaqueEvent` 在严格拒绝之前先放行）；
 * - **v0→v1 / v1→v2 / v2→v3 三条边拒绝一切未知历史事件，ignorable 也不例外**
 *   （官方 alpha-historical-unknown-event-refusal 决策；v0→v1 的报错原文即
 *   「refuses unknown historical events even when ignorable」）——这些代里的
 *   xingyuan/* 事件会让整个会话冷加载失败，且不产出后继、源文件原样保留。
 *
 * 本模块在激活期扫描 $DSH_HOME/sessions，按**工件版本是否落在 ignorable 被接受的
 * 那一侧**（见 {@link IGNORABLE_AWARE_FORMAT_VERSION}）分两种处理：
 * - ignorable 感知工件（当前版本与被 v3→v4 这类宽容边接住的旧代）：补标模式——
 *   xingyuan/* 未标记事件行补 `"ignorable": true`，事件载荷与坐标全保留；
 * - 更旧代（其迁移边拒绝未知事件）：去毒模式——xingyuan/* 事件行替换为官方惰性
 *   事件 hook/invoked（seq/time 不变），迁移链即可安全穿过、会话照常打开；代价是
 *   该会话历史卡片事件不再回放（业务数据在 sqlite，不丢失）。仅当目录内无更高代
 *   工件时才动低代（dsh 只按最新代读取，旧代已不被消费）。
 *
 * **补标 ≠ 卡片当场还能渲染**（2026-09-23 实测口径，勿再写成「回放能力保留」）：
 * 客户端按裸 `xingyuan/*` 类型匹配卡片（src/client/index.ts 的 KIND_BY_EVENT），而
 * v3→v4 迁移边会把带标未知事件重命名为 `plugin:xingyuan/*`（官方
 * namespaceV3OpaqueEvent），所以**跨代迁移后的旧会话卡片不再渲染**。补标相对去毒的
 * 实际收益是「载荷仍在日志里、上游开放映射或本插件登记前缀类型后可即行恢复」；
 * 停留在当前代不再迁移的工件则确实逐条回放（类型不变）。
 *
 * 安全约束（改前必读，勿删）：
 * - 不含星愿事件的会话文件零写入（字节与 mtime 均不变）；
 * - 只有星愿事件行被重序列化（补标仅追加字段；去毒仅换 type/data），其余行原样
 *   保留字节；行序与 seq 由构造保证不变（本模块从不增删移动任何行）；
 * - 首次改写前把原件备份到 <home>/xingyuan/session-backups/<项目目录>/，
 *   每会话保留最近 maxBackupPerSession 份；
 * - 任何看不懂的情况一律整文件跳过不动：撕裂尾、坏帧、header 版本不符、
 *   行解析失败、处理期间文件被并发修改、目标被占用无法原子替换；
 * - 工件布局与帧扫描逻辑对齐 dsh-session-persistence-jsonl 的物理格式；
 *   **压缩工件的布局硬约束：帧 0 必须恰好承载一行 header（含结尾换行）**，
 *   由 dsh 的 assertZstdHeaderFrame 强制（listArtifacts 启动期执行）——本模块
 *   写回时按「帧 0 = header、其余事件行第二帧」重建，写回前自检（首帧单行 +
 *   解码全等），任何不符放弃写回。若读入的容器结构完整但首帧不是单 header 行
 *   （历史上一次实现曾把整个文件重压成单帧导致宿主启动崩溃，已由本模块的
 *   relayout-only 路径兜底自愈），即使无需补标也会重写为合法布局。
 * - SESSION_FORMAT_VERSION 取自 @deepseek-ai/dsh-session。升级 dsh 时必须核对
 *   本模块的前提与布局契约仍然成立，尤其**新迁移边是否接受 ignorable 未知事件**：
 *   接受则可接受的下界就要上移（去毒面随之收窄），拒绝则须下移。判错方向的代价不
 *   对称——多去毒一次即永久销毁该会话的卡片回放，少去毒一次则会话冷加载失败。
 */

import { constants as zlibConstants, zstdCompress, zstdDecompressSync } from 'node:zlib'
import { promisify } from 'node:util'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'

const zstdCompressAsync = promisify(zstdCompress)

/** 星愿事件类型前缀（events.ts 声明合并的全部 kind）。 */
const XINGYUAN_EVENT_PREFIX = 'xingyuan/'
/**
 * 「迁移链接受 ignorable 未知事件」的最低工件版本——补标 / 去毒的分界。
 *
 * 取值口径见头注：v3→v4 边已在严格拒绝前放行 ignorable（重命名为 `plugin:<type>`、
 * 载荷与坐标原样保留），故 v3 工件补标即可穿过；v0/v1/v2 的边一律拒绝，只能去毒。
 * **与 SESSION_FORMAT_VERSION 解耦**：当前代永远落在本界之上（v4 ≥ v3），
 * 因此「当前代 = 补标」仍成立，但反过来不成立——被版本升级误判成去毒目标、
 * 从而销毁可保留数据的正是那批 v3 旧工件（2026-09-23 修掉的即为此）。
 */
const IGNORABLE_AWARE_FORMAT_VERSION = 3
/** 工件内明文的防御性上限（远超个人部署可能的会话体积）。 */
const MAX_PLAINTEXT_BYTES = 512 * 1024 * 1024

/**
 * 去毒模式下替换星愿事件的官方惰性事件类型与载荷：hook/invoked 只做日志记录，
 * 跨 v0/v1/v2 迁移边无任何关系约束，是最安全的中性载体（payload 语义校验要求
 * turn≥0、point/handlerId 非空、dialect ∈ {claude-code, codex}）。
 * handlerId 保留可追溯的替换来源，便于人工审计。
 */
const NEUTRAL_EVENT_TYPE = 'hook/invoked'
function neutralEvent(seq: unknown, time: unknown, headerId: string): string {
  return JSON.stringify({
    type: NEUTRAL_EVENT_TYPE,
    seq,
    time,
    data: { turn: 1, point: 'PreToolUse', dialect: 'codex', handlerId: `xingyuan-repair:${headerId}:${String(seq)}` },
  })
}

/**
 * 每会话自愈标记文件名（放在会话目录内，dsh 不扫描它）。用于把启动期自愈从
 * 「全量解压解析」降为「stat + 读 40 字节标记」：已修复的会话除非工件字节数
 * 变化（有新事件落盘）或布局损坏，否则直接跳过——66 个会话从 3.6s 降到 <10ms。
 */
const MARKER_NAME = '.xingyuan-repaired'

// ===== dsh home 解析 =====

/** $DSH_HOME 解析：环境变量优先，否则 ~/.dsh。 */
export function resolveDshHome(): string {
  return process.env.DSH_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.dsh')
}

// ===== zstd 结构化帧扫描（逐字对应 dsh-session-persistence-jsonl 的 scanZstdFrames）=====

const ZSTD_MAGIC = 4247762216
/** 完整帧区间；tornStart = 末尾不完整帧的起点（撕裂尾）。 */
interface FrameScan {
  frames: Array<{ start: number; end: number }>
  tornStart?: number
}

/**
 * 不解压块体、只按 zstd 帧结构定位边界。EOF 落在末帧中间返回 tornStart，
 * 任何结构非法即抛错——两个信号都让上层放弃该文件。
 * 导出供测试与内部自检校验布局契约。
 */
export function scanZstdFrames(buffer: Buffer): FrameScan {
  const frames: FrameScan['frames'] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** 压缩单个带校验和的独立 zstd 帧（参数口径同官方写入端）。 */
export async function compressZstdFrame(input: Buffer): Promise<Buffer> {
  return zstdCompressAsync(input, { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } })
}

/**
 * 按官方工件物理布局把补标后的明文重组为帧序列：**帧 0 必须恰好承载一行 header
 * （含结尾换行）**——dsh 的 listArtifacts 经 assertZstdHeaderFrame 强制该校验，
 * 「整文件重压为单帧」会直接炸掉宿主启动（2026-08-27 实际事故，勿回退）。
 * 其余事件行装第二个帧（读取端跨帧顺序解码明文，对事件帧边界无额外约束）。
 */
async function rebuildContainer(plaintext: Buffer): Promise<Buffer[]> {
  const headerEnd = plaintext.indexOf(10)
  if (headerEnd === -1) throw new Error('plaintext lost its header line')
  const frames = [await compressZstdFrame(plaintext.subarray(0, headerEnd + 1))]
  if (plaintext.length > headerEnd + 1) {
    frames.push(await compressZstdFrame(plaintext.subarray(headerEnd + 1)))
  }
  return frames
}

/**
 * 写回前的最后一道闸（防御性自检）：容器必须能完整结构扫描、首帧解压后
 * 「恰好一个换行且位于末字节」（复刻 assertZstdHeaderFrame）、全部帧拼回的
 * 明文与预期逐字节一致。任一不满足即放弃写回。
 */
async function selfVerify(container: Buffer, expectedPlaintext: Buffer): Promise<string | undefined> {
  let scan: FrameScan
  try {
    scan = scanZstdFrames(container)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  if (scan.tornStart !== undefined) return 'container has a torn tail'
  try {
    const firstFrame = zstdDecompressSync(container.subarray(scan.frames[0]!.start, scan.frames[0]!.end))
    if (firstFrame.length === 0 || firstFrame.indexOf(10) !== firstFrame.length - 1) {
      return 'first frame is not exactly one header line'
    }
    const joined = Buffer.concat(scan.frames.map((f) => zstdDecompressSync(container.subarray(f.start, f.end))))
    if (!joined.equals(expectedPlaintext)) return 'decoded plaintext diverges from the intended content'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

// ===== 日志行级补标 =====

/**
 * mark：ignorable 感知工件（{@link IGNORABLE_AWARE_FORMAT_VERSION} 及以上），为星愿事件
 * 补 `ignorable: true`（载荷保留、迁移边会把它带进后继代；跨代后是否仍渲染见头注）；
 * neutralize：迁移链拒绝未知事件的更旧代，把星愿事件替换为官方惰性事件让链穿过。
 */
type PatchMode = 'mark' | 'neutralize'

interface PatchOutcome {
  kind: 'patched' | 'clean'
  plaintext: Buffer
  /** mark 模式新增补标的事件数（已标记事件不计入）。 */
  eventsMarked: number
  /** neutralize 模式替换为惰性事件的星愿事件数。 */
  eventsNeutralized: number
  /** 文件内星愿事件总数（已标记 + 本次处理），供 clean 分支回填标记。 */
  totalMarked: number
}
type PatchFailure = { kind: 'skip'; reason: SkipReason; detail: string }

/**
 * 对工件明文做行级处理。首行必须是 session header 且版本与工件名一致；模式还须与
 * 该版本的 ignorable 接受性一致（mark 只对界及以上有意义，neutralize 只对界以下必要
 * ——走错一侧等于白改或错删，故此处响亮拒绝而不是将错就错）。之后每个完整行必须能
 * 解析为对象（任何一行解析失败都整体放弃）。只有星愿事件行会被重序列化，其余行保持
 * 原字节。撕裂尾（无换行的最后一段）按原样保留。
 */
function patchPlaintext(plaintext: Buffer, mode: PatchMode, artifactVersion: number): PatchOutcome | PatchFailure {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) return skip('oversized', `${plaintext.length} bytes`)
  const headerEnd = plaintext.indexOf(10)
  if (headerEnd === -1) return skip('format', 'no header line')
  let header: unknown
  try {
    header = JSON.parse(plaintext.subarray(0, headerEnd).toString('utf8'))
  } catch {
    return skip('format', 'header line is not valid JSON')
  }
  const headerRecord = header as Record<string, unknown> | null
  const expectedVersion = artifactVersion
  const ignorableAware = artifactVersion >= IGNORABLE_AWARE_FORMAT_VERSION
  if (
    headerRecord === null || typeof headerRecord !== 'object' ||
    headerRecord['type'] !== 'session' ||
    headerRecord['version'] !== expectedVersion ||
    (mode === 'mark') !== ignorableAware ||
    typeof headerRecord['id'] !== 'string' || headerRecord['id'] === ''
  ) {
    return skip('format', `header version=${String(headerRecord?.['version'])} expect=${expectedVersion} mode=${mode}`)
  }
  const headerId = headerRecord['id']

  const chunks: Buffer[] = [plaintext.subarray(0, headerEnd + 1)]
  let eventsMarked = 0
  let eventsNeutralized = 0
  let totalMarked = 0
  let cursor = headerEnd + 1
  let lineNumber = 1
  for (;;) {
    const newline = plaintext.indexOf(10, cursor)
    // 无换行的尾段是撕裂尾或尚未落盘的部分记录：交给 dsh 自己的截断修复，不在处理范围
    if (newline === -1) {
      chunks.push(plaintext.subarray(cursor))
      break
    }
    lineNumber += 1
    const rawLine = plaintext.subarray(cursor, newline)
    cursor = newline + 1
    let event: unknown
    try {
      event = JSON.parse(rawLine.toString('utf8'))
    } catch {
      return skip('unparsable', `event line ${lineNumber} is not valid JSON`)
    }
    const record = event as Record<string, unknown> | null
    if (record === null || typeof record !== 'object' || typeof record['type'] !== 'string') {
      return skip('unparsable', 'event line is not an object with a type field')
    }
    if (!record['type'].startsWith(XINGYUAN_EVENT_PREFIX)) {
      chunks.push(rawLine, Buffer.from('\n', 'utf8'))
      continue
    }
    totalMarked += 1
    if (mode === 'mark') {
      if (record['ignorable'] !== true) {
        record['ignorable'] = true
        eventsMarked += 1
        chunks.push(Buffer.from(JSON.stringify(record), 'utf8'), Buffer.from('\n', 'utf8'))
      } else {
        // 已是 ignorable：不触发补标（patched 判定只看 eventsMarked），只累计总数供回填
        chunks.push(rawLine, Buffer.from('\n', 'utf8'))
      }
      continue
    }
    // neutralize：seq/time 必须可原样承载，否则整文件放弃（宁可跳过不可伪造坐标）
    const seq = record['seq']
    const time = record['time']
    if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(time)) {
      return skip('unparsable', `xingyuan event line ${lineNumber} lacks safe integer seq/time`)
    }
    eventsNeutralized += 1
    chunks.push(Buffer.from(neutralEvent(seq, time, headerId), 'utf8'), Buffer.from('\n', 'utf8'))
  }
  if (eventsMarked === 0 && eventsNeutralized === 0) {
    return { kind: 'clean', plaintext, eventsMarked: 0, eventsNeutralized: 0, totalMarked }
  }
  return { kind: 'patched', plaintext: Buffer.concat(chunks), eventsMarked, eventsNeutralized, totalMarked }
}

function skip(reason: SkipReason, detail: string): PatchFailure {
  return { kind: 'skip', reason, detail }
}

// ===== 目录遍历与会话目录名 =====

/**
 * encodeSegment 的逆变换（dsh 会话目录名 ~XXXX 转义）。解不出时返回 undefined，
 * 上层只当作「非活会话」处理——最坏情形是尝试补标一个正活跃的会话，
 * 原子替换会因占用失败并被跳过。
 */
function decodeSegment(segment: string): string | undefined {
  if (segment.length === 0) return undefined
  let out = ''
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (ch !== '~') {
      out += ch
      continue
    }
    const hex = segment.slice(i + 1, i + 5)
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return undefined
    out += String.fromCharCode(parseInt(hex, 16))
    i += 4
  }
  return out
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

// ===== 报告与入口 =====

export type SkipReason =
  | 'live'        // 会话当前在本进程存活，交给下次启动
  | 'torn'        // 末帧撕裂（崩溃残留），交给 dsh 自己的截断修复
  | 'corrupt'     // 帧结构非法 / 解压失败
  | 'format'      // header 缺失或版本与本构建不符
  | 'unparsable'  // 存在解析不出的事件行
  | 'changed'     // 处理期间文件被并发修改
  | 'busy'        // 目标被占用，原子替换失败（Windows 文件锁等）
  | 'oversized'   // 明文超出防御性上限
  | 'verify'      // 重组后的容器未通过自检（首帧单行 / 解码全等）
  | 'error'       // 其余未预期 IO 错误

export interface RepairReport {
  /** 扫描到的会话工件总数。 */
  scanned: number
  /** 实际改写的会话文件数。 */
  patched: number
  /** 补上 ignorable 标记的事件总数（ignorable 感知工件）。 */
  eventsMarked: number
  /** 迁移链拒绝未知事件的那批旧代工件中，替换为惰性事件的星愿事件总数。 */
  neutralized: number
  skipped: Partial<Record<SkipReason, number>>
  warnings: string[]
}

export interface RepairOptions {
  /** dsh 根目录；缺省按 DSH_HOME/~/.dsh 解析。测试注入临时目录。 */
  dshHome?: string
  /** 当前进程活会话 id 集合提供者（来自宿主 sessions 服务）。 */
  listLiveSessionIds?: () => ReadonlySet<string>
  /** 每会话保留的备份数上限（默认 3，超出裁剪最旧）。 */
  maxBackupPerSession?: number
  /** 过程日志出口（默认 console.log/warn 由调用方装配）。 */
  log?: (message: string) => void
}

/** 激活期自愈入口：永不抛出，异常折算进 report（warnings/skipped.error）。 */
export async function repairSessionLogs(options: RepairOptions = {}): Promise<RepairReport> {
  const log = options.log ?? (() => {})
  const report: RepairReport = { scanned: 0, patched: 0, eventsMarked: 0, neutralized: 0, skipped: {}, warnings: [] }
  const sessionsRoot = join(options.dshHome ?? resolveDshHome(), 'sessions')
  const liveIds = safeLiveIds(options.listLiveSessionIds)
  if (!existsSync(sessionsRoot)) return report
  for (const projectDir of await subdirectories(sessionsRoot)) {
    for (const sessionDir of await subdirectories(join(sessionsRoot, projectDir))) {
      const dir = join(sessionsRoot, projectDir, sessionDir)
      // 原子写残骸清扫：进程在 writeFile 与 rename 之间崩溃会留下 `*.xy-repair-*`
      // 临时文件——它们不在任何标记/工件清单里，此前永不清理、永久滞留会话目录。
      // 本轮启动统一扫除。双实例同 DSH_HOME 时可能删掉另一进程在途的临时文件，
      // 对方 rename 失败按 busy 跳过、下次启动重试（无数据损失），故不做进程甄别。
      await sweepRepairTemps(dir)
      const artifact = await locateArtifact(dir)
      if (artifact === undefined) continue
      report.scanned += 1
      const sessionId = decodeSegment(sessionDir)
      if (sessionId !== undefined && liveIds.has(sessionId)) {
        bump(report.skipped, 'live')
        continue
      }
      // 增量跳过：标记存在且工件字节数未变 → 已处理过（无需全量解压解析）。
      // 字节数变化 = 有新事件落盘，重扫补标并刷新标记。布局损坏（旧版整文件
      // 单帧的错误产物）不受标记保护，由读取路径修复并重标记。
      const statResult = await safeStat(artifact.path)
      if (statResult !== undefined) {
        const marker = await readMarker(dirnameOf(artifact.path))
        if (marker !== undefined && marker.artifactBytes === statResult.size) {
          report.eventsMarked += marker.eventsMarked
          continue
        }
      }
      try {
        const outcome = await repairOneFile(
          artifact,
          sessionId ?? sessionDir,
          projectDir,
          join(options.dshHome ?? resolveDshHome(), 'xingyuan', 'session-backups'),
          options.maxBackupPerSession ?? 3,
          statResult?.size,
        )
        if (outcome.kind === 'patched') {
          report.patched += 1
          report.eventsMarked += outcome.eventsMarked
          report.neutralized += outcome.eventsNeutralized
          log(outcome.relayoutOnly
            ? `[xingyuan] 已修复会话 ${outcome.sessionId} 的工件帧布局（首帧须为单行 header）`
            : outcome.eventsNeutralized > 0
              ? `[xingyuan] 会话 ${outcome.sessionId} 为旧格式：${outcome.eventsNeutralized} 条卡片事件已替换为惰性事件以便 dsh 迁移（卡片不再回放）`
              : `[xingyuan] 已为会话 ${outcome.sessionId} 补标 ${outcome.eventsMarked} 条卡片事件（ignorable）`)
        } else if (outcome.kind === 'clean') {
          report.eventsMarked += outcome.eventsMarked
        } else if (outcome.kind === 'skipped') {
          bump(report.skipped, outcome.reason ?? 'error')
          report.warnings.push(`${artifact.path}: ${outcome.reason ?? 'error'}${outcome.detail ? ` — ${outcome.detail}` : ''}`)
        }
      } catch (error) {
        bump(report.skipped, 'error')
        report.warnings.push(`${artifact.path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return report
}

interface ArtifactRef {
  path: string
  /** 工件名中的格式代（v0 无版本段，按 0 计）。 */
  version: number
  compressed: boolean
}

/**
 * 解析官方工件名：`session.jsonl[.zstd]`（v0）或 `session.v<N>.jsonl[.zstd]`（N>0）。
 * 非规范名（大写 v、前导零、v0 带版本段、迁移临时文件等）与高于当前版本的代
 * 一律不认（口径同 dsh 的 parseGenerationLogFilename）。
 */
function parseArtifactName(name: string): { version: number; compressed: boolean } | undefined {
  const match = /^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$/.exec(name)
  if (match === null) return undefined
  const version = match[1] === undefined ? 0 : Number(match[1])
  if (!Number.isSafeInteger(version) || version > SESSION_FORMAT_VERSION) return undefined
  return { version, compressed: match[2] !== undefined }
}

/**
 * 选目录内最高代的合法工件（dsh 只按最新代读取/迁移）：{@link
 * IGNORABLE_AWARE_FORMAT_VERSION} 及以上走补标，界以下走去毒，旧代在被更高代遮蔽时
 * 不处理（零写入原则）。同代并存时
 * 优先压缩工件（与旧版选择顺序一致）。
 */
async function locateArtifact(sessionDir: string): Promise<ArtifactRef | undefined> {
  let entries: string[]
  try {
    entries = await readdir(sessionDir)
  } catch {
    return undefined
  }
  let best: ArtifactRef | undefined
  for (const name of entries) {
    const parsed = parseArtifactName(name)
    if (parsed === undefined) continue
    if (best !== undefined) {
      if (parsed.version < best.version) continue
      if (parsed.version === best.version && (best.compressed || !parsed.compressed)) continue
    }
    best = { path: join(sessionDir, name), version: parsed.version, compressed: parsed.compressed }
  }
  return best
}

// ===== 自愈标记（增量跳过）=====

/** 标记载荷：工件字节数 + 补标事件数。字节数未变则工件内容未变，可直接跳过。 */
interface Marker {
  artifactBytes: number
  eventsMarked: number
}

async function readMarker(sessionDir: string): Promise<Marker | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(sessionDir, MARKER_NAME), 'utf8')) as Partial<Marker>
    if (
      typeof parsed['artifactBytes'] === 'number' && Number.isSafeInteger(parsed['artifactBytes']) && parsed['artifactBytes'] >= 0 &&
      typeof parsed['eventsMarked'] === 'number' && Number.isSafeInteger(parsed['eventsMarked']) && parsed['eventsMarked'] >= 0
    ) {
      return { artifactBytes: parsed['artifactBytes'], eventsMarked: parsed['eventsMarked'] }
    }
  } catch {}
  return undefined
}

async function writeMarker(sessionDir: string, marker: Marker): Promise<void> {
  try {
    await writeFile(join(sessionDir, MARKER_NAME), JSON.stringify(marker), 'utf8')
  } catch {
    // 标记写失败不阻断主流程（代价是下次启动重扫一次）
  }
}

type Outcome =
  | { kind: 'patched'; sessionId: string; eventsMarked: number; eventsNeutralized: number; relayoutOnly?: boolean; totalMarked: number }
  | { kind: 'clean'; eventsMarked: number; totalMarked: number }
  | { kind: 'skipped'; reason?: SkipReason; detail?: string }

async function repairOneFile(
  artifact: ArtifactRef,
  sessionId: string,
  projectDirName: string,
  backupRoot: string,
  maxBackupPerSession: number,
  knownSize?: number,
): Promise<Outcome> {
  const before = knownSize !== undefined ? { size: knownSize, mtimeMs: 0 } : await stat(artifact.path)
  const raw = await readFile(artifact.path)

  let plaintext: Buffer
  let layoutBroken = false
  if (artifact.compressed) {
    let scan: FrameScan
    try {
      scan = scanZstdFrames(raw)
    } catch (error) {
      return { kind: 'skipped', reason: 'corrupt', detail: error instanceof Error ? error.message : String(error) }
    }
    if (scan.tornStart !== undefined) return { kind: 'skipped', reason: 'torn' }
    try {
      plaintext = Buffer.concat(scan.frames.map((frame) => zstdDecompressSync(raw.subarray(frame.start, frame.end))))
      // 布局校验：首帧必须恰好一行 header（官方 assertZstdHeaderFrame / listArtifacts 强制）。
      // 结构完整但首帧非单行 = 历史错误产物（整文件单帧重压），启动期会炸宿主，必须重写修复。
      const firstFrame = zstdDecompressSync(raw.subarray(scan.frames[0]!.start, scan.frames[0]!.end))
      layoutBroken = firstFrame.length === 0 || firstFrame.indexOf(10) !== firstFrame.length - 1
    } catch (error) {
      return { kind: 'skipped', reason: 'corrupt', detail: error instanceof Error ? error.message : String(error) }
    }
  } else {
    plaintext = raw
  }

  // 分界看「该代迁移边是否接受 ignorable」而非「是否当前代」：v3 工件补标即可被
  // v3→v4 边带进后继代（卡片数据保留），只有更旧代才需要去毒。
  const outcome = patchPlaintext(
    plaintext,
    artifact.version >= IGNORABLE_AWARE_FORMAT_VERSION ? 'mark' : 'neutralize',
    artifact.version,
  )
  if (outcome.kind === 'skip') return { kind: 'skipped', reason: outcome.reason, detail: outcome.detail }
  // 布局非法时即使无需补标也要重写为合法容器（其余情况才允许 clean 跳过）
  if (outcome.kind === 'clean' && !layoutBroken) {
    await writeMarker(dirnameOf(artifact.path), { artifactBytes: before.size, eventsMarked: outcome.totalMarked })
    return { kind: 'clean', eventsMarked: outcome.eventsMarked, totalMarked: outcome.totalMarked }
  }

  // 处理期间原文件有动静（新批次落盘）：放弃本次，下次启动重来。
  // 仅当 knownSize 缺省（标记未提供大小）时才比对 mtime；否则以字节数是否漂移为准。
  const after = knownSize !== undefined
    ? (await safeStat(artifact.path))?.size
    : (await stat(artifact.path)).size
  if (after === undefined || after !== before.size) {
    return { kind: 'skipped', reason: 'changed' }
  }

  const backupPath = await backupOriginal(raw, artifact.path, sessionId, projectDirName, backupRoot)

  // 明文工件直接整体写回；压缩工件按官方布局重组建帧并自检后才落盘
  let nextBytes: Buffer
  if (artifact.compressed) {
    try {
      const container = Buffer.concat(await rebuildContainer(outcome.plaintext))
      const problem = await selfVerify(container, outcome.plaintext)
      if (problem !== undefined) {
        return { kind: 'skipped', reason: 'verify', detail: problem }
      }
      nextBytes = container
    } catch (error) {
      return { kind: 'skipped', reason: 'verify', detail: error instanceof Error ? error.message : String(error) }
    }
  } else {
    nextBytes = outcome.plaintext
  }
  const tempPath = `${artifact.path}.xy-repair-${process.pid}-${Date.now()}`
  try {
    await writeFile(tempPath, nextBytes)
    await rename(tempPath, artifact.path)
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    return { kind: 'skipped', reason: 'busy', detail: error instanceof Error ? error.message : String(error) }
  }
  await pruneBackups(dirnameOf(backupPath), `${sessionId}-`, maxBackupPerSession)
  // neutralize 后文件内不再有星愿事件：标记计数归零，避免下次启动虚报「已补标」
  await writeMarker(dirnameOf(artifact.path), {
    artifactBytes: nextBytes.length,
    eventsMarked: outcome.eventsNeutralized > 0 ? 0 : outcome.totalMarked,
  })
  if (outcome.eventsNeutralized > 0) {
    return { kind: 'patched', sessionId, eventsMarked: 0, eventsNeutralized: outcome.eventsNeutralized, totalMarked: outcome.totalMarked }
  }
  return { kind: 'patched', sessionId, eventsMarked: outcome.eventsMarked, eventsNeutralized: 0, totalMarked: outcome.totalMarked, relayoutOnly: outcome.kind === 'clean' }
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/')
  const indexAlt = path.lastIndexOf('\\')
  return path.slice(0, Math.max(index, indexAlt))
}

/** 原子写临时文件标记（repairOneFile 以 `<工件名>.xy-repair-<pid>-<ts>` 命名）：
 * 清扫只认自己的私有后缀（dsh 会话目录不存在该命名），零误伤面。 */
const REPAIR_TEMP_MARKER = '.xy-repair-'

/** 清除会话目录内滞留的 `*.xy-repair-*` 原子写残骸（尽力而为，失败静默）。 */
async function sweepRepairTemps(sessionDir: string): Promise<void> {
  try {
    for (const entry of await readdir(sessionDir)) {
      if (entry.includes(REPAIR_TEMP_MARKER)) await unlink(join(sessionDir, entry)).catch(() => {})
    }
  } catch {}
}

// ===== 备份（首次改写前留存原件，每会话只留最近 N 份）=====

async function backupOriginal(
  original: Buffer,
  artifactPath: string,
  sessionId: string,
  projectDirName: string,
  backupRoot: string,
): Promise<string> {
  const dir = join(backupRoot, projectDirName)
  await mkdir(dir, { recursive: true })
  const suffix = artifactPath.endsWith('.zstd') ? '.jsonl.zstd' : '.jsonl'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(dir, `${sessionId}-${stamp}${suffix}`)
  await writeFile(target, original)
  return target
}

async function pruneBackups(dir: string, prefix: string, keep: number): Promise<void> {
  try {
    const entries = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort()
    const excess = entries.slice(0, Math.max(0, entries.length - keep))
    for (const name of excess) await unlink(join(dir, name)).catch(() => {})
  } catch {
    // 备份清理失败不影响主流程
  }
}

// ===== 杂项 =====

function bump(target: Partial<Record<SkipReason, number>>, reason: SkipReason): void {
  target[reason] = (target[reason] ?? 0) + 1
}

/** stat 失败返回 undefined（文件不存在/无权限等——让主流程照常处理或跳过）。 */
async function safeStat(path: string): Promise<{ size: number } | undefined> {
  try {
    const info = await stat(path)
    return { size: info.size }
  } catch {
    return undefined
  }
}

function safeLiveIds(provider: RepairOptions['listLiveSessionIds']): ReadonlySet<string> {
  try {
    return provider?.() ?? new Set<string>()
  } catch {
    return new Set<string>()
  }
}
