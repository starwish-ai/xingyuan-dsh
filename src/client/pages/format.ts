/** 展示格式化：周期/状态/进度时长的本地化文案（页面与卡片共用）。 */
import { t, activeLocale, type XyKey } from '../i18n.js'

const CYCLE_KEYS: Record<string, XyKey> = {
  once: 'cycle.once',
  daily: 'cycle.daily',
  weekly: 'cycle.weekly',
  monthly: 'cycle.monthly',
}

/** 周期文案（未知值原样回显，防御未来新增枚举）。 */
export function cycleLabel(cycle: string): string {
  const key = CYCLE_KEYS[cycle]
  return key !== undefined ? t(key) : cycle
}

const STATUS_KEYS: Record<string, XyKey> = {
  pending: 'task.status.pending',
  in_progress: 'task.status.in_progress',
  closed: 'task.status.closed',
}

/** 任务状态文案。 */
export function statusLabel(status: string): string {
  const key = STATUS_KEYS[status]
  return key !== undefined ? t(key) : status
}

/**
 * 进度时长：「{done}/{required} 天」或无上限时「{done} 次」。
 * 计数在英文下经 Intl.PluralRules 分单复数（1 time / n times）；zh 两键同文无感。
 */
export function durationText(completed: number, required: number): string {
  if (required > 0) return t('common.dayUnit', { n: `${completed}/${required}` })
  const key = englishPlural(completed) ? 'common.countUnit' : 'common.countUnitOne'
  return t(key, { n: completed })
}

/** 英文语境下名词是否应用复数键（其他 locale 恒 false，调用方两键同文即可）。 */
export function englishPlural(n: number): boolean {
  return activeLocale() === 'en' && new Intl.PluralRules('en-US').select(n) !== 'one'
}

/** 单复数键选择：zh 两键同文取 manyKey 即可；en 经 Intl.PluralRules 分档。 */
export function countKey<K extends XyKey>(n: number, oneKey: K, manyKey: K): K {
  return englishPlural(n) ? manyKey : oneKey
}

/** 打卡日期后缀（toast/完成态用）：入参 ISO，内部本地化为短日期（§5.10 界面禁裸奔 ISO）；
 * zh 全角括号 / en 半角括号由词典统一口径。 */
export function dateSuffix(date: string | undefined): string {
  return date !== undefined && date !== '' ? t('common.dateSuffix', { date: formatShortDate(date) }) : ''
}

/** 紧凑按钮内的本地化短日期：'2026-03-05' → 「3月5日」/「Mar 5」（解析失败原样回显）。 */
export function formatShortDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (match === null) return ymd
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  if (Number.isNaN(date.getTime())) return ymd
  return new Intl.DateTimeFormat(LOCALE_TAG[activeLocale()], { month: 'short', day: 'numeric' }).format(date)
}

/**
 * 友好全称日期：'2026-08-27' → 「8月27日 周四」/「Thu, Aug 27」。
 * 展示性标题统一走这里，杜绝界面裸奔 ISO 串；解析失败回退原值（防御脏数据）。
 */
export function formatFriendlyDate(ymd: string): string {
  const short = formatShortDate(ymd)
  const wd = formatWeekday(ymd)
  if (short === ymd || wd === '') return ymd
  return activeLocale() === 'en' ? `${wd}, ${short}` : `${short} ${wd}`
}

/** 带年份的中格式（远期目标日）：'2026-11-24' → 「2026年11月24日」/「Nov 24, 2026」。 */
export function formatMediumDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (match === null) return ymd
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  if (Number.isNaN(date.getTime())) return ymd
  return new Intl.DateTimeFormat(LOCALE_TAG[activeLocale()], { dateStyle: 'medium' }).format(date)
}

// ===== Intl 日历文案（业界实践：本地化交给 Intl.DateTimeFormat，不手写格式） =====

const LOCALE_TAG: Record<'zh' | 'en', string> = { zh: 'zh-CN', en: 'en-US' }

/** '2026-01' → 「2026年1月」/「January 2026」；解析失败原样回显（防御脏数据）。 */
export function formatMonth(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym)
  if (match === null) return ym
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return ym
  return new Intl.DateTimeFormat(LOCALE_TAG[activeLocale()], { year: 'numeric', month: 'long' })
    .format(new Date(year, month - 1, 1))
}

/** '2026-01-08' → 「周四」/「Thu」；解析失败返回空串（调用方自行省略）。 */
export function formatWeekday(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (match === null) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''
  const date = new Date(year, month - 1, day, 12)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE_TAG[activeLocale()], { weekday: 'short' }).format(date)
}
