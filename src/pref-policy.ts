/**
 * 星愿「对话偏好」的纯策略与常量（host/client 两半侧共用 + 测试对拍），并承载
 * 偏好落到哪一条 profile 行上的绑定位（`SETTINGS_ENTRY_ID` / `SettingsFormValue`，
 * 含界面偏好两字段，故不只服务「对话」偏好）。
 *
 * 独立成模块而非并入 pref-settings.ts 的理由：后者依赖 host-only 的
 * `@deepseek-ai/dsh-settings`，绝不可进浏览器包；而设置页需要上下界与默认值
 * 做输入夹取、回显兜底与不可用态兜底。形态对标 tab-policy.ts。
 *
 * 决策口径（确认分层模型见 AGENTS.md §10 决策 8）：
 * - confirmWrites：写操作总开关。关闭时除锁定类目（删除）外所有类目一律不弹确认卡；
 *   开启时按 confirmOps 各类目明细决定。默认开。
 * - confirmOps：六个可配确认类目的明细开关（创建/打卡/取消打卡/领取/修改/记忆保存），
 *   默认值 = 总开关粒度时代的现行矩阵（创建/打卡/取消默认确认，其余默认不确认）；
 *   删除为锁定类目，不设开关、始终确认（破坏性操作不设开关）。
 * - memoryInjectLimit：记忆注入条数上限，默认 40，合法区间 [5,200] 的整数。
 *   越界输入夹取到区间内并回显；非整数/非数字/空一律拒绝，不静默改值。
 * - confirmLang：对话内确认卡（HITL 卡头/按钮/问题文案）的显示语言，默认 zh。
 *   平台事实（0.1.7 复核仍成立）：宿主不向 host 侧插件暴露用户界面语言——client 半侧的
 *   locale 服务是浏览器专属 seam，工具执行期读不到；故确认卡语言只能由用户在此
 *   显式选择，不能自动跟随界面语言。
 */
import type { TabVisibilityMode } from './tab-policy.js'

/**
 * 偏好落在哪一条 profile 行上：dsh 0.1.7 起「可编辑设置 = 该行的 Config schema 里
 * 标了 `.volatile()` 的字段」，客户端经 `ctx.configForms.get(SETTINGS_ENTRY_ID)` 读写，
 * 故这个串必须与 `cordis.patch.yml` 的主行 `id:` 逐字一致（宿主按行 id 索引表单，
 * 见 dsh-settings `describe()` 的 `ns: entry.options.id`）。host/client 两半侧共用，
 * 改一处即可，两侧不会各自漂移。
 */
export const SETTINGS_ENTRY_ID = 'xy-bundle'

/**
 * 该行的可编辑表单值形状（= 主行 Config 里所有 volatile 字段）。
 *
 * 全部可选：`status` 为 loading/unavailable 时 `value` 是 undefined，且宿主按
 * schema 投影——字段缺席要回落各自默认值，不得假设一定在。
 * 设置页与标签页控制器共用这一个表单实例（宿主按行 id 缓存），故类型也共用一份。
 */
export interface SettingsFormValue {
  readonly confirmWrites?: boolean
  readonly confirmOps?: Readonly<Record<string, boolean>>
  readonly memoryInjectLimit?: number
  readonly confirmLang?: ConfirmLang
  readonly tabVisibilityMode?: TabVisibilityMode
  readonly hiddenTabs?: readonly string[]
}

/** 记忆注入上限的下界（含）。 */
export const MEMORY_LIMIT_MIN = 5
/** 记忆注入上限的上界（含）。 */
export const MEMORY_LIMIT_MAX = 200

/** 确认卡语言的可选值（schema 枚举与设置页选项同源）。 */
export const CONFIRM_LANGS = ['zh', 'en'] as const
export type ConfirmLang = (typeof CONFIRM_LANGS)[number]

/**
 * 可配确认类目（与工具面确认挂点、设置页明细行、i18n 键三方同源，勿改语义）：
 * - create：创建愿望/任务（含批量）+ 微行动拆解；
 * - checkin / cancelCheckin：打卡 / 取消打卡；
 * - claim：领取任务（误领取不可逆，恢复 = 删除重建，故提供可开确认的档位）；
 * - update：修改愿望/任务/分类改名/记忆更新；
 * - memorySave：记忆保存。
 * 删除（含批量、微行动重开）为锁定类目，不在其中——始终确认，见 ADR-0001。
 */
export const CONFIRM_OPS = ['create', 'checkin', 'cancelCheckin', 'claim', 'update', 'memorySave'] as const
export type ConfirmOp = (typeof CONFIRM_OPS)[number]

/** 各类目默认值（= 2026-09 分层化之前的现行矩阵）。 */
export const CONFIRM_OP_DEFAULTS: Record<ConfirmOp, boolean> = {
  create: true,
  checkin: true,
  cancelCheckin: true,
  claim: false,
  update: false,
  memorySave: false,
}

/** 脏值容错：confirmOps 快照缺键/非布尔键一律回落类目默认（与 confirmLang 同口径）。 */
export function normalizeConfirmOps(value: unknown): Record<ConfirmOp, boolean> {
  const source = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}
  const out = {} as Record<ConfirmOp, boolean>
  for (const op of CONFIRM_OPS) {
    out[op] = typeof source[op] === 'boolean' ? source[op] : CONFIRM_OP_DEFAULTS[op]
  }
  return out
}

/** 对话偏好的当前解析值（schema 默认 → profile 补丁里主行的 config 节）。 */
export interface PrefSettings {
  /** 写操作总开关：关闭时除锁定的删除类目外一律不弹确认卡。 */
  confirmWrites: boolean
  /** 各可配确认类目的明细开关（总开关开启时生效）。 */
  confirmOps: Record<ConfirmOp, boolean>
  /** 每次对话自动注入上下文的记忆条数上限。 */
  memoryInjectLimit: number
  /** 对话内确认卡的显示语言（平台不向 host 侧暴露界面语言，见头注）。 */
  confirmLang: ConfirmLang
}

/** 偏好缺省（与主行 Config 里这些字段的 schema 默认值同源，见 src/pref-settings.ts）。 */
export const PREF_DEFAULTS: PrefSettings = {
  confirmWrites: true,
  confirmOps: { ...CONFIRM_OP_DEFAULTS },
  memoryInjectLimit: 40,
  confirmLang: 'zh',
}

/** 脏值容错：非 zh/en 一律回落 zh（与 tab-policy 的显隐脏值容错同口径）。 */
export function normalizeConfirmLang(value: unknown): ConfirmLang {
  return value === 'en' ? 'en' : 'zh'
}

/**
 * 解析「记忆注入上限」输入：非整数、非数字、空串一律返回 undefined（拒绝）；
 * 越界值夹取到 [MIN,MAX] 且 clamped 置 true（调用方据此给出行内提示并回显）。
 */
export function parseMemoryLimit(
  raw: string,
): { value: number; clamped: boolean } | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return undefined
  if (Math.round(n) !== n) return undefined
  const value = Math.min(MEMORY_LIMIT_MAX, Math.max(MEMORY_LIMIT_MIN, Math.round(n)))
  return { value, clamped: value !== n }
}
