/**
 * 星愿「对话偏好」的纯策略与常量（host/client 两半侧共用 + 测试对拍）。
 *
 * 独立成模块而非并入 pref-settings.ts 的理由：后者依赖 host-only 的
 * `@deepseek-ai/dsh-settings`，绝不可进浏览器包；而设置页需要上下界与默认值
 * 做输入夹取、回显兜底与不可用态兜底。形态对标 tab-policy.ts。
 *
 * 决策口径：
 * - confirmWrites：创建/打卡/取消打卡类写操作是否二次确认，默认开；
 *   删除类始终确认，不受此开关控制（破坏性操作不设开关）。
 * - memoryInjectLimit：记忆注入条数上限，默认 40，合法区间 [5,200] 的整数。
 *   越界输入夹取到区间内并回显；非整数/非数字/空一律拒绝，不静默改值。
 */

/** 记忆注入上限的下界（含）。 */
export const MEMORY_LIMIT_MIN = 5

/** 记忆注入上限的上界（含）。 */
export const MEMORY_LIMIT_MAX = 200

/** 命名空间解析值（schema 默认 → base 层 → 用户层）。 */
export interface PrefSettings {
  /** 创建/取消打卡类写操作是否二次确认（删除类始终确认）。 */
  confirmWrites: boolean
  /** 每次对话自动注入上下文的记忆条数上限。 */
  memoryInjectLimit: number
}

/** 命名空间缺省（与 xingyuan-pref schema 默认值同源，见 src/pref-settings.ts）。 */
export const PREF_DEFAULTS: PrefSettings = {
  confirmWrites: true,
  memoryInjectLimit: 40,
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
