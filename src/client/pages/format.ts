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

/** 进度时长：「{done}/{required} 天」或无上限时「{done} 次」。 */
export function durationText(completed: number, required: number): string {
  return required > 0
    ? t('common.dayUnit', { n: `${completed}/${required}` })
    : t('common.countUnit', { n: completed })
}

/** 打卡日期后缀（toast/完成态用）：zh 全角括号 / en 半角括号，由词典统一口径。 */
export function dateSuffix(date: string | undefined): string {
  return date !== undefined && date !== '' ? t('common.dateSuffix', { date }) : ''
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
