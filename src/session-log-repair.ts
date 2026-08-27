/**
 * 会话日志自愈（bundle 常驻层）。
 *
 * 背景：dsh（0.1.1-rc.2）会话持久化读取端按「本仓库生成的官方事件类型白名单」
 * 拒绝未知事件；仓库外插件事件按构造就在名单之外，而写入端（Session.append）
 * 当前没有 ignorable 标记通道——因此任何包含 xingyuan/* 卡片事件的会话，
 * 进程重启后冷加载会被 SessionFormatUnsupportedError 整体拒绝，连对话文本都
 * 打不开（详见 docs/handoff-session-format-unsupported-event.md）。
 *
 * 本模块以「事后补标」弥合「写时打标」的缺位：激活期扫描 $DSH_HOME/sessions
 * 下的会话工件，把 type 以 xingyuan/ 开头且未标记的事件行补上 `"ignorable": true`
 * 后原子替换原文件。读取端本来就支持该字段：不认识的带标事件被安全跳过且
 * **不会被过滤**——事件数据原封保留在日志中，卡片回放能力随之保留。
 *
 * 安全约束（改前必读，勿删）：
 * - 不含星愿事件的会话文件零写入（字节与 mtime 均不变）；
 * - 只有星愿事件行被重序列化（仅追加一个字段），其余行原样保留字节；
 *   行序与 seq 由构造保证不变（本模块从不增删移动任何行）；
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
 *   本模块的前提与布局契约仍然成立。
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
/** 工件内明文的防御性上限（远超个人部署可能的会话体积）。 */
const MAX_PLAINTEXT_BYTES = 512 * 1024 * 1024

/**
 * 每会话自愈标记文件名（放在会话目录内，dsh 不扫描它）。用于把启动期自愈从
 * 「全量解压解析」降为「stat + 读 40 字节标记」：已修复的会话除非工件字节数
 * 变化（有新事件落盘）或布局损坏，否则直接跳过——66 个会话从 3.6s 降到 <10ms。
 */
const MARKER_NAME = '.xingyuan-repaired'

// ===== dsh home 解析（口径同 preset-root.ts）=====

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

interface PatchOutcome {
  kind: 'patched' | 'clean'
  plaintext: Buffer
  /** 本次新增补标的事件数（仅 ign 缺失时才 +1；已标记事件不计入）。 */
  eventsMarked: number
  /** 文件内星愿事件总数（已标记 + 本次新增），供 clean 分支回填标记。 */
  totalMarked: number
}
type PatchFailure = { kind: 'skip'; reason: SkipReason; detail: string }

/**
 * 对工件明文做行级补标。首行必须是本构建可读的 session header；之后每个完整行
 * 必须能解析为对象（任何一行解析失败都整体放弃）。只有 xingyuan/* 且未标记的行
 * 会被重序列化，其余行保持原字节。撕裂尾（无换行的最后一段）按原样保留。
 */
function patchPlaintext(plaintext: Buffer): PatchOutcome | PatchFailure {
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
  if (
    headerRecord === null || typeof headerRecord !== 'object' ||
    headerRecord['type'] !== 'session' ||
    headerRecord['version'] !== SESSION_FORMAT_VERSION ||
    typeof headerRecord['id'] !== 'string' || headerRecord['id'] === ''
  ) {
    return skip('format', `header version=${String(headerRecord?.['version'])} expect=${SESSION_FORMAT_VERSION}`)
  }

  const chunks: Buffer[] = [plaintext.subarray(0, headerEnd + 1)]
  let eventsMarked = 0
  let totalMarked = 0
  let cursor = headerEnd + 1
  let lineNumber = 1
  for (;;) {
    const newline = plaintext.indexOf(10, cursor)
    // 无换行的尾段是撕裂尾或尚未落盘的部分记录：交给 dsh 自己的截断修复，不在补标范围
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
    if (record['type'].startsWith(XINGYUAN_EVENT_PREFIX)) {
      totalMarked += 1
      if (record['ignorable'] !== true) {
        record['ignorable'] = true
        eventsMarked += 1
        chunks.push(Buffer.from(JSON.stringify(record), 'utf8'), Buffer.from('\n', 'utf8'))
      } else {
        // 已是 ignorable：不触发补标（patched 判定只看 eventsMarked），只累计总数供回填
        chunks.push(rawLine, Buffer.from('\n', 'utf8'))
      }
    } else {
      chunks.push(rawLine, Buffer.from('\n', 'utf8'))
    }
  }
  if (eventsMarked === 0) return { kind: 'clean', plaintext, eventsMarked: 0, totalMarked }
  return { kind: 'patched', plaintext: Buffer.concat(chunks), eventsMarked, totalMarked }
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
  /** 补上 ignorable 标记的事件总数。 */
  eventsMarked: number
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

const SESSION_ARTIFACTS: Array<{ filename: string; compressed: boolean }> = [
  { filename: 'session.jsonl.zstd', compressed: true },
  { filename: 'session.jsonl', compressed: false },
]

/** 激活期自愈入口：永不抛出，异常折算进 report（warnings/skipped.error）。 */
export async function repairSessionLogs(options: RepairOptions = {}): Promise<RepairReport> {
  const log = options.log ?? (() => {})
  const report: RepairReport = { scanned: 0, patched: 0, eventsMarked: 0, skipped: {}, warnings: [] }
  const sessionsRoot = join(options.dshHome ?? resolveDshHome(), 'sessions')
  const liveIds = safeLiveIds(options.listLiveSessionIds)
  if (!existsSync(sessionsRoot)) return report
  for (const projectDir of await subdirectories(sessionsRoot)) {
    for (const sessionDir of await subdirectories(join(sessionsRoot, projectDir))) {
      const artifact = await locateArtifact(join(sessionsRoot, projectDir, sessionDir))
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
          log(outcome.relayoutOnly
            ? `[xingyuan] 已修复会话 ${outcome.sessionId} 的工件帧布局（首帧须为单行 header）`
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
  compressed: boolean
}

async function locateArtifact(sessionDir: string): Promise<ArtifactRef | undefined> {
  for (const candidate of SESSION_ARTIFACTS) {
    const path = join(sessionDir, candidate.filename)
    if (existsSync(path)) return { path, compressed: candidate.compressed }
  }
  return undefined
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
  | { kind: 'patched'; sessionId: string; eventsMarked: number; relayoutOnly?: boolean; totalMarked: number }
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

  const outcome = patchPlaintext(plaintext)
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
  await writeMarker(dirnameOf(artifact.path), { artifactBytes: nextBytes.length, eventsMarked: outcome.totalMarked })
  return { kind: 'patched', sessionId, eventsMarked: outcome.eventsMarked, totalMarked: outcome.totalMarked, relayoutOnly: outcome.kind === 'clean' }
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/')
  const indexAlt = path.lastIndexOf('\\')
  return path.slice(0, Math.max(index, indexAlt))
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
