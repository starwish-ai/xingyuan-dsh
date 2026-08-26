/**
 * 愿望分类颜色 —— Web 端 src/utils/wish-category.ts 的 TS 对齐移植（跨端同源口径）。
 *
 * - 22 个预设 colorKey（5 中性 + 17 彩色），与 Web CATEGORY_COLOR_KEY_PRESETS 一一对应；
 * - 未设 colorKey 时按分类名哈希到色环取稳定色相（Web resolveHueSpecBySeed 同式），
 *   老数据/未选色的分类也有稳定可辨的颜色；
 * - 颜色以「色相 + 饱和度」CSS 变量下发，亮度由样式表按主题切换：
 *   壳内跟随 body[data-ds-dark-theme]，独立页走 prefers-color-scheme——
 *   与 Web「--cat-h 注入 + .dark 覆盖亮度」的分层完全同构。
 */

/** 分类颜色白名单（与工具 schema enum、Web 预设表同源；顺序即展示顺序）。 */
export const CATEGORY_COLOR_KEYS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const

export type CategoryColorKey = (typeof CATEGORY_COLOR_KEYS)[number]

/** 中性色键（饱和度走低档）。 */
const NEUTRAL_KEYS: ReadonlySet<string> = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone'])

/** 彩色键 → 色相（Web COLOR_HUES 同值）。 */
const COLOR_HUES: Readonly<Record<string, number>> = {
  red: 0, orange: 24, amber: 38, yellow: 55, lime: 78, green: 142, emerald: 160,
  teal: 175, cyan: 190, sky: 200, blue: 215, indigo: 235, violet: 260, purple: 275,
  fuchsia: 300, pink: 330, rose: 345,
}

const NEUTRAL_HUES: Readonly<Record<string, number>> = {
  slate: 215, gray: 220, zinc: 240, neutral: 0, stone: 25,
}

/** 色环：未知键哈希落位（由彩色预设值派生，与 Web CATEGORY_COLOR_HUE_RING 恒等）。 */
const HUE_RING: readonly number[] = [...new Set(Object.values(COLOR_HUES))].sort((a, b) => a - b)

/** djb2 文本哈希（Web hashText 同式）。 */
function hashText(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h
}

export function normalizeColorKey(colorKey?: string): string {
  if (!colorKey) return ''
  return String(colorKey).trim().toLowerCase()
}

/** 预设键/名查表；未命中按种子哈希入色环（Web resolveHueSpecBySeed 同式）。 */
function hueSpecOf(seed: string): { hue: number; neutral: boolean } {
  if (seed in NEUTRAL_HUES) return { hue: NEUTRAL_HUES[seed]!, neutral: true }
  if (seed in COLOR_HUES) return { hue: COLOR_HUES[seed]!, neutral: false }
  const index = hashText(seed) % HUE_RING.length
  return { hue: HUE_RING[index] ?? HUE_RING[0]!, neutral: false }
}

/**
 * 解析分类的色相与中性标记：
 * colorKey 在白名单内 → 预设色相；否则回退到「分类名为种子」的同一解析器
 * （与 Web getWishCategoryCombinedStyle 一致：名称恰为英文预设键时两端同色；
 * 空名兜底也用 Web 的 'default' 种子）。
 */
export function categoryHue(colorKey?: string, categoryName?: string): { hue: number; neutral: boolean } {
  const key = normalizeColorKey(colorKey)
  if (key !== '') return hueSpecOf(key)
  const name = (categoryName ?? '').trim()
  return hueSpecOf(name === '' ? 'default' : name)
}

/** 饱和度档（Web CATEGORY_COLOR_THEME / neutral 分支同值；主题无关，只随中性变化）。 */
const SAT_LIGHT = { bg: 58, fg: 46, border: 46 } as const
const SAT_NEUTRAL = { bg: 16, fg: 20, border: 12 } as const

/**
 * 徽章内联 CSS 变量（style 属性用）：JS 拥有主题无关的色相/饱和度，
 * CSS 拥有各主题的亮度——深浅色翻转零 JS 参与。
 */
export function categoryVars(colorKey?: string, categoryName?: string): Record<string, string> {
  const { hue, neutral } = categoryHue(colorKey, categoryName)
  const sat = neutral ? SAT_NEUTRAL : SAT_LIGHT
  return {
    '--cat-h': String(hue),
    '--cat-sbg': String(sat.bg),
    '--cat-sfg': String(sat.fg),
    '--cat-sbd': String(sat.border),
  }
}
