/**
 * 成长统计：等级、经验与打卡指标。
 *
 * 全部指标从 checkins 表重放重算（单一事实源），取消中间一天、补卡乱序、
 * 同日多条、未来预勾均精确无漂移。语义：
 * - 当前连续 = 从「最后一条 ≤ today 的记录」倒推的自然日连续：断更后冻结不衰减；
 *   未来预勾不劫持当前连续，只计入累计/最长/经验。
 * - 最长连续 = 全部记录（含未来段）的最长自然日连续。
 * - 经验 = 每条打卡记录发放一份，按该记录所在日期的连续值加成（同日多条共享同一连续值）。
 */
import type { XingyuanStore } from './domain.js'
import { freshWishes } from './store.js'
import { todayIso } from './opportunity.js'

/** 等级配置行（t_level_config）。 */
export interface LevelConfig {
  readonly level: number
  readonly levelName: string
  /** 升级所需总经验值（累计口径，非级差）。 */
  readonly requiredExperience: number
  readonly rewardDescription: string
}

/** 等级表（Lv.1–Lv.10）。 */
export const LEVEL_CONFIGS: readonly LevelConfig[] = [
  { level: 1, levelName: '初心者', requiredExperience: 0, rewardDescription: '开启星愿之旅' },
  { level: 2, levelName: '探索者', requiredExperience: 100, rewardDescription: '晋升「探索者」称号' },
  { level: 3, levelName: '实践者', requiredExperience: 300, rewardDescription: '晋升「实践者」称号' },
  { level: 4, levelName: '坚持者', requiredExperience: 600, rewardDescription: '晋升「坚持者」称号' },
  { level: 5, levelName: '奋斗者', requiredExperience: 1000, rewardDescription: '晋升「奋斗者」称号' },
  { level: 6, levelName: '进取者', requiredExperience: 1500, rewardDescription: '晋升「进取者」称号' },
  { level: 7, levelName: '成就者', requiredExperience: 2200, rewardDescription: '晋升「成就者」称号' },
  { level: 8, levelName: '卓越者', requiredExperience: 3000, rewardDescription: '晋升「卓越者」称号' },
  { level: 9, levelName: '领航者', requiredExperience: 4000, rewardDescription: '晋升「领航者」称号' },
  { level: 10, levelName: '星愿大师', requiredExperience: 5200, rewardDescription: '晋升「星愿大师」——星愿之旅的最高荣誉' },
]

/** 每条打卡记录的基础经验。 */
export const BASE_EXPERIENCE = 10

/** 连续加成：≥7 天 ×1.5、≥3 天 ×1.2，四舍五入取整。 */
export function calculateExperience(continuousDays: number): number {
  const multiplier = continuousDays >= 7 ? 1.5 : continuousDays >= 3 ? 1.2 : 1.0
  return Math.round(BASE_EXPERIENCE * multiplier)
}

/** 打卡统计快照。 */
export interface CheckInStats {
  /** 累计打卡天数（去重日期数，含未来预勾）。 */
  readonly totalCheckInDays: number
  /** 当前连续（最后一条 ≤today 倒推；断更冻结；未来记录不参与）。 */
  readonly continuousCheckInDays: number
  /** 历史最长连续（含未来段）。 */
  readonly maxContinuousCheckInDays: number
  /** 最后一条打卡记录日期（可为未来）；无记录时 undefined。 */
  readonly lastCheckInDate?: string
  /** 累计经验（每条记录一份，按当日连续值加成）。 */
  readonly totalExperience: number
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
}

/**
 * 从打卡记录重放统计。store.checkins 以 `${taskId}|${date}` 为键，
 * 同一日期多条记录（多任务同日）保留：去重计天数，经验按条发放。
 */
export function computeCheckInStats(store: XingyuanStore, today: string = todayIso()): CheckInStats {
  const dates: string[] = []
  for (const [, record] of store.domain.table('checkins').entries()) dates.push(record.date)
  if (dates.length === 0) {
    return { totalCheckInDays: 0, continuousCheckInDays: 0, maxContinuousCheckInDays: 0, totalExperience: 0 }
  }
  dates.sort()
  const distinct = [...new Set(dates)]

  const lastCheckInDate = distinct[distinct.length - 1]
  let maxContinuous = 1
  let run = 1
  for (let i = 1; i < distinct.length; i++) {
    if (dayNumber(distinct[i]!) - dayNumber(distinct[i - 1]!) === 1) {
      run++
      maxContinuous = Math.max(maxContinuous, run)
    } else {
      run = 1
    }
  }

  // 当前连续：最后一条 ≤today 的记录为锚点倒推（未来记录不参与）
  let anchorIdx = -1
  for (let i = distinct.length - 1; i >= 0; i--) {
    if (distinct[i]! <= today) {
      anchorIdx = i
      break
    }
  }
  let continuous = 0
  if (anchorIdx >= 0) {
    continuous = 1
    for (let i = anchorIdx - 1; i >= 0; i--) {
      if (dayNumber(distinct[i + 1]!) - dayNumber(distinct[i]!) === 1) continuous++
      else break
    }
  }

  // 经验：每条记录发放一份，按该记录所在日期的连续值加成（原始序列重放）
  let totalExperience = 0
  let continuousAtRecord = 1
  let prev: string | undefined
  for (const cur of dates) {
    if (prev !== undefined && cur !== prev) {
      // 同日多条：连续值保持不变；相邻日递进，否则重开一段
      if (dayNumber(cur) - dayNumber(prev) === 1) continuousAtRecord++
      else continuousAtRecord = 1
    }
    totalExperience += calculateExperience(continuousAtRecord)
    prev = cur
  }

  return {
    totalCheckInDays: distinct.length,
    continuousCheckInDays: continuous,
    maxContinuousCheckInDays: maxContinuous,
    lastCheckInDate,
    totalExperience,
  }
}

/** 等级解析结果（Web UserGrowth 展示口径）。 */
export interface LevelStatus {
  readonly level: number
  readonly levelName: string
  readonly rewardDescription: string
  /** 当前累计经验。 */
  readonly totalExperience: number
  /** 下一级所需总经验；满级为 null。 */
  readonly nextLevelExperience: number | null
  /** 距下一级进度百分比 0-100（Web 口径：total / next）；满级恒 100。 */
  readonly levelProgress: number
}

/** 由总经验解析等级：取满足阈值的最高档（UserGrowthServiceImpl.recalculateLevel 同式）。 */
export function resolveLevel(totalExperience: number): LevelStatus {
  let current: LevelConfig = LEVEL_CONFIGS[0]!
  for (const config of LEVEL_CONFIGS) {
    if (totalExperience >= config.requiredExperience) current = config
  }
  const next = LEVEL_CONFIGS.find((config) => config.level === current.level + 1)
  const nextRequired = next?.requiredExperience ?? null
  const progress = nextRequired !== null && nextRequired > 0
    ? Math.min(100, Math.max(0, Math.round((totalExperience / nextRequired) * 100)))
    : 100
  return {
    level: current.level,
    levelName: current.levelName,
    rewardDescription: current.rewardDescription,
    totalExperience,
    nextLevelExperience: nextRequired,
    levelProgress: progress,
  }
}

/** 成长页聚合统计（对齐 Web Growth.vue 统计卡七项）。 */
export interface GrowthSummary {
  readonly today: string
  readonly stats: CheckInStats
  readonly level: LevelStatus
  readonly totalWishes: number
  readonly completedWishes: number
  readonly totalTasks: number
  readonly completedTasks: number
}

/**
 * 全域成长汇总：愿望/任务计数使用读路径新鲜口径
 * （freshWish/freshTask 语义：进度跨日陈旧由读侧消除）。
 */
export function growthSummary(store: XingyuanStore, today: string = todayIso()): GrowthSummary {
  // 单遍任务索引批量新鲜化（freshWishes），替代逐愿望嵌套全表扫描 O(W×T)
  const wishes = freshWishes(store)
  // 达成口径与愿望卡一致（freshWishes 派生的 archived 谓词）：承诺全部完成且无未处理候选——
  // 禁止在此重复写 progress >= 100 谓词（候选拦达成会漏掉，见 §5.2 规则 7）
  const completedWishes = wishes.filter((wish) => wish.archived).length
  let totalTasks = 0
  let completedTasks = 0
  for (const [, task] of store.domain.table('tasks').entries()) {
    totalTasks++
    if (task.status === 'closed' && task.closedReason === 'achieved') completedTasks++
  }
  const stats = computeCheckInStats(store, today)
  return {
    today,
    stats,
    level: resolveLevel(stats.totalExperience),
    totalWishes: wishes.length,
    completedWishes,
    totalTasks,
    completedTasks,
  }
}
