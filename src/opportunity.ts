/**
 * 机会日计算器 —— TaskCheckInCalculatorUtil.java 的 TS 逐语义移植（跨语言对拍基准）。
 *
 * 机会日 = 任务应打卡的日期序列，是打卡/进度/日历/完成判定的唯一事实口径。
 * 锚点日 = 领取日（claimDate），无领取日则为创建日。
 * 周期：once 仅截止日；daily 锚点日起每天；weekly 每 7 天（非自然周）；
 * monthly 逐自然月推进、日期钳制（1/31 → 2/28 → 3/31）。
 * 全部日期为本地时区 'yyyy-MM-dd' 字符串，ISO 字典序即时间序。
 */

export type CheckInCycle = 'once' | 'daily' | 'weekly' | 'monthly'

const CYCLES: readonly CheckInCycle[] = ['once', 'daily', 'weekly', 'monthly']

/** 本地「今天」，yyyy-MM-dd。 */
export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 语义化 ISO 日期校验：格式合法且是真实存在的日历日期。
 * 注意：仅靠 Date.parse 判 NaN 不够——ES 规范的 ISO 文法只约束「月 01-12、日 01-31」，
 * 不校验月长度（2026-02-30 会滚动成 03-02 的合法时间戳而非 NaN），必须再做往返
 * 比对。机会日序列与 store 写路径共用这一份（日期语义校验唯一口径）。 */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const n = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(n) && new Date(n).toISOString().slice(0, 10) === value
}

/** UTC 天数序号：同一天恒等，可直接做差与比较（避免本地时区夏令时漂移）。 */
function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
}

function fromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days)
}

/** 自然月推进 + 日期钳制：1/31 → 下月 min(31, 该月天数)。 */
function addMonthsClamped(y: number, m0: number, dayOfMonth: number, addMonths: number): string {
  const total = y * 12 + m0 + addMonths
  const year = Math.floor(total / 12)
  const month0 = total % 12
  const lengthOfMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const day = Math.min(dayOfMonth, lengthOfMonth)
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * 计算机会日序列。锚点或周期非法 → 空集；
 * once 无截止日 → 空集；其余周期无截止日 → 空集（无截止日任务无机会日约束）。
 */
export function calculateOpportunityDates(
  anchorDate: string | null | undefined,
  dueDate: string | null | undefined,
  checkInCycle: string | null | undefined,
): string[] {
  if (!anchorDate || !checkInCycle || !isIsoDate(anchorDate)) return []
  if (!CYCLES.includes(checkInCycle as CheckInCycle)) return []

  if (checkInCycle === 'once') {
    return dueDate && isIsoDate(dueDate) ? [dueDate] : []
  }
  if (!dueDate || !isIsoDate(dueDate)) return []

  const due = dueDate
  const dates: string[] = []
  if (checkInCycle === 'daily') {
    for (let d = anchorDate; d <= due; d = addDays(d, 1)) dates.push(d)
    return dates
  }
  if (checkInCycle === 'weekly') {
    for (let d = anchorDate; d <= due; d = addDays(d, 7)) dates.push(d)
    return dates
  }
  // monthly：自然月推进，日期钳制
  let months = 0
  while (true) {
    const candidate = addMonthsClamped(Number(anchorDate.slice(0, 4)), Number(anchorDate.slice(5, 7)) - 1, Number(anchorDate.slice(8, 10)), months)
    if (candidate > due) break
    dates.push(candidate)
    months++
  }
  return dates
}

/**
 * 要求打卡天数 = 机会日数量（唯一口径）。
 * 例外：once 无截止日 → 1（点击打卡即完成）；其余无截止日 → 0。
 */
export function calculateRequiredDays(
  createDate: string | null | undefined,
  dueDate: string | null | undefined,
  checkInCycle: string | null | undefined,
): number {
  if (checkInCycle === 'once' && !dueDate) return 1
  return calculateOpportunityDates(createDate, dueDate, checkInCycle).length
}

/**
 * 从 today（含）起第一个未勾选的机会日（按钮态 nextOpportunityDate 与打卡目标同一口径）：
 * 无截止日返回 today；全部勾完/无机会日返回 null。
 */
export function findFirstUncheckedOpportunityDate(
  anchorDate: string | null | undefined,
  dueDate: string | null | undefined,
  checkInCycle: string | null | undefined,
  checkedDates: ReadonlySet<string>,
  today: string,
): string | null {
  if (!dueDate) return today
  for (const date of calculateOpportunityDates(anchorDate, dueDate, checkInCycle)) {
    if (date >= today && !checkedDates.has(date)) return date
  }
  return null
}

/** 统一达标判定（唯一口径）：requiredDays > 0 且 completedDays >= requiredDays。 */
export function isTaskDone(requiredDays: number | null | undefined, completedDays: number | null | undefined): boolean {
  return requiredDays != null && requiredDays > 0 && completedDays != null && completedDays >= requiredDays
}

/**
 * 重新开始判定：仅「按过期关闭」的已截止任务可通过延长截止日复活——
 * status=closed 且旧截止日已过、旧应打天数未达标；已达成不允许复活。
 */
export function shouldRestartFromExpired(
  status: string,
  oldDueDate: string | null | undefined,
  today: string,
  oldRequiredDays: number | null | undefined,
  completedDays: number | null | undefined,
): boolean {
  if (status !== 'closed') return false
  if (!oldDueDate || oldDueDate >= today) return false
  return oldRequiredDays != null && oldRequiredDays > 0 && completedDays != null && completedDays < oldRequiredDays
}
