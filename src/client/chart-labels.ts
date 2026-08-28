/**
 * 图表卡词表的客户端本地化。
 *
 * 背景（终端用户评审 P1）：服务端 charts.ts 的内建标题/副标题/枚举标签是中文权威源，
 * en 用户会在图表卡上直接看到「周一 / 本周 / 未分类」。事件是 whole-value 冻结快照，
 * 历史事件只有中文标签，因此本地化放在消费端：按 chartKey 与「已知中文标签 → 键」
 * 的映射表渲染，未知值（模型自定义标题、用户数据标签如愿望名）原样回显——诚实降级。
 *
 * 一致性锁定：映射表的中文键必须与 charts.ts 内建词逐字一致，由 test/chart-labels.test.ts
 * 用真实 buildChart 输出对拍（内建词改动而映射表未跟 → 测试红）。
 */
import { t, type XyKey } from './i18n.js'
import type { XingyuanChartEventData } from '../events.js'

/** 各 chartKey 的内建默认标题（与 charts.ts `params.title ?? '…'` 逐字同源）。 */
export const CHART_DEFAULT_TITLES: Record<string, string> = {
  checkinTrend: '打卡趋势',
  checkinCalendar: '打卡日历',
  taskCompletionRate: '任务完成率',
  checkinRateTrend: '打卡完成率',
  weekComparison: '本周打卡对比',
  taskStatus: '任务状态分布',
  checkinByCategory: '分类打卡分布',
  wishCategory: '愿望分类分布',
  checkinRanking: '打卡排行',
  taskDistribution: '任务分布',
  wishProgress: '愿望进度',
  wishAchievement: '愿望达成率',
  continuousCheckin: '连续打卡',
  checkinTimeDistribution: '打卡时间分布',
  weeklyActivity: '周度活跃度',
}

/** 已知中文枚举标签 → 本地化键（weekComparison/weeklyActivity 星期、时段桶、状态、系列名等）。
 * 导出供 test/chart-labels.test.ts 做「服务端内建词全覆盖」对拍锁定。 */
export const CHART_LABEL_KEYS: Record<string, XyKey> = {
  周一: 'chart.weekday.1',
  周二: 'chart.weekday.2',
  周三: 'chart.weekday.3',
  周四: 'chart.weekday.4',
  周五: 'chart.weekday.5',
  周六: 'chart.weekday.6',
  周日: 'chart.weekday.7',
  '凌晨(0-5)': 'chart.hour.0',
  '早晨(6-8)': 'chart.hour.1',
  '上午(9-11)': 'chart.hour.2',
  '中午(12-13)': 'chart.hour.3',
  '下午(14-17)': 'chart.hour.4',
  '傍晚(18-19)': 'chart.hour.5',
  '夜间(20-23)': 'chart.hour.6',
  待领取: 'task.status.pending',
  进行中: 'task.status.in_progress',
  已完结: 'task.status.closed',
  未分类: 'chart.uncategorized',
  未关联: 'chart.unlinked',
  完成率: 'chart.label.completionRate',
  达成率: 'chart.label.achievementRate',
  '当前/最长': 'chart.label.currentVsBest',
}

export const CHART_SERIES_KEYS: Record<string, XyKey> = {
  本周: 'chart.series.this',
  上周: 'chart.series.last',
}

/** 数据点标签本地化：已知中文枚举标签映射，其余（用户数据）原样回显。 */
export function localizeChartLabel(label: string): string {
  const key = CHART_LABEL_KEYS[label]
  return key !== undefined ? t(key) : label
}

/** 分组序列名本地化（图例与柱色对应关系按原字符串分组，故仅展示层替换）。 */
export function localizeChartSeries(series: string): string {
  const key = CHART_SERIES_KEYS[series]
  return key !== undefined ? t(key) : series
}

/** 标题本地化：内建默认标题按 chartKey 映射；模型自定义标题原样回显。 */
export function localizeChartTitle(event: Pick<XingyuanChartEventData, 'chartKey' | 'title'>): string {
  const key = `chart.title.${event.chartKey}` as XyKey
  if (event.title === CHART_DEFAULT_TITLES[event.chartKey]) return t(key)
  return event.title
}

/** 已知中文固定副标题 → 本地化键。 */
export const CHART_SUBTITLE_KEYS: Record<string, XyKey> = {
  最近一年: 'chart.subtitle.lastYear',
  '按任务 TopN': 'chart.subtitle.byTaskTopN',
  '按愿望 TopN': 'chart.subtitle.byWishTopN',
  '按实际打卡时刻分桶；过滤范围为打卡日区间': 'chart.subtitle.byHourBucket',
  '%（应打天数完成率）': 'chart.subtitle.progressPercent',
}

/**
 * 副标题本地化：固定短语查表；含数字的模板（近 N 天 / A/B 天 / 当前 A 天 / 最长 B 天 /
 * 含未领取任务）按正则重排——服务端模板变化时未知副标题原样回显（诚实降级）。
 */
export function localizeChartSubtitle(subtitle: string): string {
  const fixed = CHART_SUBTITLE_KEYS[subtitle]
  if (fixed !== undefined) return t(fixed)
  let m = /^近 (\d+) 天$/.exec(subtitle)
  if (m !== null) return t('chart.subtitle.lastDays', { n: m[1] })
  m = /^(\d+)\/(\d+) 天（含未领取任务）$/.exec(subtitle)
  if (m !== null) return t('chart.subtitle.daysInclPending', { done: m[1], due: m[2] })
  m = /^(\d+)\/(\d+) 天$/.exec(subtitle)
  if (m !== null) return t('chart.subtitle.daysRatio', { done: m[1], due: m[2] })
  m = /^当前 (\d+) 天 \/ 最长 (\d+) 天$/.exec(subtitle)
  if (m !== null) return t('chart.subtitle.streak', { current: m[1], best: m[2] })
  return subtitle
}
