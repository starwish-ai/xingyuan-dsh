/**
 * 图表数据计算：chartKey 15 选 1。
 * 数据全部由 storageDomain 现算（打卡明细 + 任务 + 愿望），卡片走 xingyuan/chart 事件。
 */
import type { XingyuanChartDatum } from '../events.js'
import { anchorOf, checkinCountIndex, freshTask, freshWishes, type Task, type Wish } from '../store.js'
import { computeCheckInStats } from '../growth.js'
import type { XingyuanStore } from '../domain.js'
import { calculateOpportunityDates, todayIso } from '../opportunity.js'
export const CHART_KEYS = [
  'checkinTrend',
  'checkinCalendar',
  'taskCompletionRate',
  'checkinRateTrend',
  'weekComparison',
  'taskStatus',
  'checkinByCategory',
  'wishCategory',
  'checkinRanking',
  'taskDistribution',
  'wishProgress',
  'wishAchievement',
  'continuousCheckin',
  'checkinTimeDistribution',
  'weeklyActivity',
] as const
export type ChartKey = (typeof CHART_KEYS)[number]

export interface ChartParams {
  days?: number
  wishId?: string
  month?: string
  limit?: number
  title?: string
}

export interface ChartSpec {
  readonly chartKey: ChartKey
  readonly title: string
  readonly subtitle?: string
  readonly chartType: 'line' | 'column' | 'bar' | 'pie' | 'arcbars' | 'heatmap' | 'radar'
  readonly data: readonly XingyuanChartDatum[]
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

const HOUR_BUCKETS: ReadonlyArray<{ readonly label: string; readonly from: number; readonly to: number }> = [
  { label: '凌晨(0-5)', from: 0, to: 5 },
  { label: '早晨(6-8)', from: 6, to: 8 },
  { label: '上午(9-11)', from: 9, to: 11 },
  { label: '中午(12-13)', from: 12, to: 13 },
  { label: '下午(14-17)', from: 14, to: 17 },
  { label: '傍晚(18-19)', from: 18, to: 19 },
  { label: '夜间(20-23)', from: 20, to: 23 },
]


/** 图表默认参数（§4.3：无硬编码可调参数——默认值由 side.ts Config 注入）。 */
export interface ChartConfig {
  readonly trendDays: number
  readonly distributionDays: number
  readonly maxDays: number
  readonly rankLimit: number
  readonly rankMax: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** yyyy-MM-dd → UTC 天序号（本地日期的稳定序）。 */
function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
}

function isoOfDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/** 本地星期一为一周起点：返回该日所在周的周一。 */
function mondayOf(iso: string): string {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay()
  const offset = (weekday + 6) % 7
  return isoOfDay(dayNumber(iso) - offset)
}

interface CheckinFact {
  readonly taskId: string
  readonly date: string
  readonly hour: number
}

function checkinFacts(store: XingyuanStore, sinceDay?: number, untilDay?: number): CheckinFact[] {
  const facts: CheckinFact[] = []
  for (const [, record] of store.domain.table('checkins').entries()) {
    const day = dayNumber(record.date)
    if (sinceDay !== undefined && day < sinceDay) continue
    // 统计窗上界：未来预勾不进统计（「近 N 天」是 trailing window；
    // 唯一例外是日历热力图——它是逐日记录而非聚合统计）
    if (untilDay !== undefined && day > untilDay) continue
    facts.push({
      taskId: record.taskId,
      date: record.date,
      hour: new Date(record.checkedAt).getHours(),
    })
  }
  return facts
}

function tasksOf(store: XingyuanStore, wishId?: string): Task[] {
  const out: Task[] = []
  for (const [, task] of store.domain.table('tasks').entries()) {
    if (!wishId || task.wishId === wishId) out.push(task)
  }
  return out
}

function wishesOf(store: XingyuanStore): Wish[] {
  return [...store.domain.table('wishes').entries()].map(([, wish]) => wish)
}


/** 按愿望分类聚合打卡次数。 */
function countByCategory(store: XingyuanStore, facts: CheckinFact[]): Map<string, number> {
  const taskWish = new Map<string, string>()
  for (const task of tasksOf(store)) taskWish.set(task.taskId, task.wishId ?? '')
  const wishCategory = new Map<string, string>()
  for (const wish of wishesOf(store)) wishCategory.set(wish.wishId, wish.categoryName)
  const counts = new Map<string, number>()
  for (const fact of facts) {
    const category = wishCategory.get(taskWish.get(fact.taskId) ?? '') ?? '未分类'
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return counts
}

/**
 * 计算 chartKey 对应图表。数据为空返回 undefined（工具回「暂无相关数据」）。
 */
export function buildChart(key: ChartKey, params: ChartParams, store: XingyuanStore, config: ChartConfig, today = todayIso()): ChartSpec | undefined {
  const days = clamp(params.days ?? config.trendDays, 1, config.maxDays)
  const limit = clamp(params.limit ?? config.rankLimit, 1, config.rankMax)

  switch (key) {
    case 'checkinTrend': {
      const startDay = dayNumber(today) - days + 1
      const counts = new Map<number, number>()
      // checkinFacts 已按 [startDay, today] 双侧过滤（上界=今天：窗口内只有
      // 未来预勾时 counts 为空 → 走「暂无数据」，统计不含未来）
      for (const fact of checkinFacts(store, startDay, dayNumber(today))) {
        counts.set(dayNumber(fact.date), (counts.get(dayNumber(fact.date)) ?? 0) + 1)
      }
      const data: XingyuanChartDatum[] = []
      for (let d = startDay; d <= dayNumber(today); d++) {
        data.push({ label: isoOfDay(d).slice(5), value: counts.get(d) ?? 0 })
      }
      if (!counts.size) return undefined
      return { chartKey: key, title: params.title ?? '打卡趋势', subtitle: `近 ${days} 天`, chartType: 'line', data }
    }
    case 'checkinCalendar': {
      // 指定月或最近一年：按自然日网格给数（仅非零日，前端渲染网格）。
      // 未指定月默认截取最近 365 天——与副标题「最近一年」如实对应
      const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : undefined
      const prefix = month ? `${month}-` : ''
      const sinceDay = month ? undefined : dayNumber(today) - 364
      const countsMap = new Map<string, number>()
      for (const fact of checkinFacts(store, sinceDay)) {
        if (prefix && !fact.date.startsWith(prefix)) continue
        countsMap.set(fact.date, (countsMap.get(fact.date) ?? 0) + 1)
      }
      if (!countsMap.size) return undefined
      const data = [...countsMap.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, value]) => ({ label: date, value }))
      return {
        chartKey: key,
        title: params.title ?? '打卡日历',
        subtitle: month ?? '最近一年',
        chartType: 'heatmap',
        data,
      }
    }
    case 'taskCompletionRate': {
      let required = 0
      let completed = 0
      let hasPending = false
      for (const task of tasksOf(store, params.wishId)) {
        required += task.requiredDays
        completed += task.completedDays
        if (task.status === 'pending') hasPending = true
      }
      if (required <= 0) return undefined
      const ratio = completed / required
      return {
        chartKey: key,
        title: params.title ?? '任务完成率',
        // 口径透明（诚实标注惯例）：分母含未领取任务的应打天数，与愿望进度同一公式
        subtitle: `${completed}/${required} 天${hasPending ? '（含未领取任务）' : ''}`,
        chartType: 'arcbars',
        data: [{ label: '完成率', value: completed, ratio }],
      }
    }
    case 'checkinRateTrend': {
      const startDay = dayNumber(today) - days + 1
      const byDate = new Map<string, number>()
      for (const fact of checkinFacts(store, startDay, dayNumber(today))) {
        byDate.set(fact.date, (byDate.get(fact.date) ?? 0) + 1)
      }
      // 每任务的机会日集合只算一次（此前逐日全量重算，O(天数×任务×机会日) 热路径）
      const dueSets = tasksOf(store)
        .filter((task) => task.status !== 'pending')
        .map((task) => new Set(calculateOpportunityDates(anchorOf(task), task.dueDate, task.checkInCycle)))
      const data: XingyuanChartDatum[] = []
      let totalDue = 0
      let totalDone = 0
      for (let d = startDay; d <= dayNumber(today); d++) {
        const date = isoOfDay(d)
        let due = 0
        for (const opportunities of dueSets) {
          if (opportunities.has(date)) due++
        }
        const done = byDate.get(date) ?? 0
        totalDue += due
        totalDone += Math.min(done, due)
        // 无安排日 = 缺失而非零（null≠zero）：产出 inactive 点，渲染为空槽
        data.push(due > 0
          ? { label: date.slice(5), value: Math.round((Math.min(done, due) / due) * 100) }
          : { label: date.slice(5), value: 0, inactive: true })
      }
      if (totalDue <= 0) return undefined
      return {
        chartKey: key,
        title: params.title ?? '打卡完成率',
        subtitle: `${totalDone}/${totalDue} 天`,
        chartType: 'line',
        data,
      }
    }
    case 'weekComparison': {
      const monday = mondayOf(today)
      const lastMonday = isoOfDay(dayNumber(monday) - 7)
      const thisWeek = new Map<number, number>()
      const lastWeek = new Map<number, number>()
      // 双侧闭区间 [lastMonday, today]：未来预勾（含下周）不进任何桶——
      // 此前无上界，下周预勾会按其自身星期几错算进本周柱（bug）
      for (const fact of checkinFacts(store, dayNumber(lastMonday), dayNumber(today))) {
        const bucket = fact.date >= monday ? thisWeek : lastWeek
        const weekday = (new Date(`${fact.date}T00:00:00Z`).getUTCDay() + 6) % 7
        bucket.set(weekday, (bucket.get(weekday) ?? 0) + 1)
      }
      const hasData = [...thisWeek.values(), ...lastWeek.values()].some((n) => n > 0)
      if (!hasData) return undefined
      const data: XingyuanChartDatum[] = []
      for (let w = 0; w < 7; w++) {
        data.push({ label: WEEKDAY_LABELS[w]!, value: thisWeek.get(w) ?? 0, series: '本周' })
        data.push({ label: WEEKDAY_LABELS[w]!, value: lastWeek.get(w) ?? 0, series: '上周' })
      }
      return { chartKey: key, title: params.title ?? '本周打卡对比', chartType: 'column', data }
    }
    case 'taskStatus': {
      const statusLabels: Record<Task['status'], string> = { pending: '待领取', in_progress: '进行中', closed: '已完结' }
      // 打卡计数索引仅此分支消费：按需计算（此前 buildChart 入口无条件全表扫描，
      // 其余 14 种图表白付一次扫描）
      const counts = checkinCountIndex(store)
      const statusCounts = new Map<string, number>()
      for (const task of tasksOf(store, params.wishId)) {
        const label = statusLabels[freshTask(store, task, today, counts).status]!
        statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1)
      }
      if (!statusCounts.size) return undefined
      return {
        chartKey: key,
        title: params.title ?? '任务状态分布',
        chartType: 'pie',
        data: [...statusCounts.entries()].map(([label, value]) => ({ label, value })),
      }
    }
    case 'checkinByCategory': {
      const startDay = dayNumber(today) - clamp(params.days ?? config.distributionDays, 1, config.maxDays) + 1
      const counts = countByCategory(store, checkinFacts(store, startDay, dayNumber(today)))
      if (!counts.size) return undefined
      return {
        chartKey: key,
        title: params.title ?? '分类打卡分布',
        subtitle: `近 ${clamp(params.days ?? config.distributionDays, 1, config.maxDays)} 天`,
        chartType: 'pie',
        data: [...counts.entries()].map(([label, value]) => ({ label, value })),
      }
    }
    case 'wishCategory': {
      const counts = new Map<string, number>()
      for (const wish of wishesOf(store)) counts.set(wish.categoryName, (counts.get(wish.categoryName) ?? 0) + 1)
      if (!counts.size) return undefined
      return {
        chartKey: key,
        title: params.title ?? '愿望分类分布',
        chartType: 'pie',
        data: [...counts.entries()].map(([label, value]) => ({ label, value })),
      }
    }
    case 'checkinRanking':
    case 'taskDistribution':
    case 'wishProgress':
    case 'wishAchievement':
    case 'continuousCheckin':
    case 'checkinTimeDistribution':
    case 'weeklyActivity':
      return buildTailChart(key, params, store, today, days, limit, config)
  }
}

/** 排行/进度/达成/连续/时段/周活跃六类共用尾部实现。 */
function buildTailChart(
  key: Exclude<ChartKey, 'checkinTrend' | 'checkinCalendar' | 'taskCompletionRate' | 'checkinRateTrend' | 'weekComparison' | 'taskStatus' | 'checkinByCategory' | 'wishCategory'>,
  params: ChartParams,
  store: XingyuanStore,
  today: string,
  days: number,
  limit: number,
  config: ChartConfig,
): ChartSpec | undefined {
  if (key === 'checkinRanking') {
    const startDay = dayNumber(today) - clamp(params.days ?? config.distributionDays, 1, config.maxDays) + 1
    const counts = new Map<string, number>()
    for (const fact of checkinFacts(store, startDay, dayNumber(today))) counts.set(fact.taskId, (counts.get(fact.taskId) ?? 0) + 1)
    const names = new Map(tasksOf(store).map((task) => [task.taskId, task.name]))
    if (!counts.size) return undefined
    const data = [...counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([taskId, value]) => ({ label: names.get(taskId) ?? taskId, value }))
    return { chartKey: key, title: params.title ?? '打卡排行', subtitle: '按任务 TopN', chartType: 'bar', data }
  }
  if (key === 'taskDistribution') {
    const counts = new Map<string, number>()
    for (const task of tasksOf(store)) {
      const label = task.wishId ? store.domain.table('wishes').get(task.wishId)?.title ?? '未关联' : '未关联'
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    if (!counts.size) return undefined
    const data = [...counts.entries()].sort(([, a], [, b]) => b - a).slice(0, limit).map(([label, value]) => ({ label, value }))
    return { chartKey: key, title: params.title ?? '任务分布', subtitle: '按愿望 TopN', chartType: 'bar', data }
  }
  if (key === 'wishProgress') {
    // 新鲜进度（读侧口径，单遍任务索引）：跨日陈旧的库存值不参与排行与筛选
    const wishes = freshWishes(store).filter((wish) => !wish.archived)
    if (!wishes.length) return undefined
    const data = wishes
      .slice()
      .sort((a, b) => b.progress - a.progress)
      .slice(0, limit)
      .map((wish) => ({ label: wish.title, value: wish.progress }))
    return { chartKey: key, title: params.title ?? '愿望进度', subtitle: '%（应打天数完成率）', chartType: 'bar', data }
  }
  if (key === 'wishAchievement') {
    const wishes = freshWishes(store)
    if (!wishes.length) return undefined
    const achieved = wishes.filter((wish) => wish.progress >= 100).length
    return {
      chartKey: key,
      title: params.title ?? '愿望达成率',
      subtitle: `${achieved}/${wishes.length}`,
      chartType: 'arcbars',
      data: [{ label: '达成率', value: achieved, ratio: achieved / wishes.length }],
    }
  }
  if (key === 'continuousCheckin') {
    const stats = computeCheckInStats(store, today)
    if (stats.maxContinuousCheckInDays <= 0) return undefined
    return {
      chartKey: key,
      title: params.title ?? '连续打卡',
      subtitle: `当前 ${stats.continuousCheckInDays} 天 / 最长 ${stats.maxContinuousCheckInDays} 天`,
      chartType: 'arcbars',
      data: [{ label: '当前/最长', value: stats.continuousCheckInDays, ratio: stats.continuousCheckInDays / stats.maxContinuousCheckInDays }],
    }
  }
  if (key === 'checkinTimeDistribution') {
    const startDay = dayNumber(today) - clamp(params.days ?? config.distributionDays, 1, config.maxDays) + 1
    const counts = new Map(HOUR_BUCKETS.map((bucket) => [bucket.label, 0]))
    let total = 0
    for (const fact of checkinFacts(store, startDay, dayNumber(today))) {
      const bucket = HOUR_BUCKETS.find((b) => fact.hour >= b.from && fact.hour <= b.to)
      if (!bucket) continue
      counts.set(bucket.label, (counts.get(bucket.label) ?? 0) + 1)
      total++
    }
    if (total === 0) return undefined
    return {
      chartKey: key,
      title: params.title ?? '打卡时间分布',
      subtitle: '按实际打卡时刻分桶；过滤范围为打卡日区间',
      chartType: 'radar',
      data: HOUR_BUCKETS.map((bucket) => ({ label: bucket.label, value: counts.get(bucket.label) ?? 0 })),
    }
  }
  // weeklyActivity
  const startDay = dayNumber(today) - clamp(params.days ?? config.distributionDays, 1, config.maxDays) + 1
  const counts = new Map<number, number>(WEEKDAY_LABELS.map((_, index) => [index, 0]))
  let total = 0
  for (const fact of checkinFacts(store, startDay, dayNumber(today))) {
    const weekday = (new Date(`${fact.date}T00:00:00Z`).getUTCDay() + 6) % 7
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1)
    total++
  }
  if (total === 0) return undefined
  return {
    chartKey: key,
    title: params.title ?? '周度活跃度',
    subtitle: `近 ${clamp(params.days ?? config.distributionDays, 1, config.maxDays)} 天`,
    chartType: 'radar',
    data: WEEKDAY_LABELS.map((label, index) => ({ label, value: counts.get(index) ?? 0 })),
  }
}
