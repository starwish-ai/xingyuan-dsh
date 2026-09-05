/** /xingyuan/api/* 返回形状（叶子字段快照；与 routes 层一一对应）。 */

export interface ApiTask {
  readonly taskId: string
  readonly name: string
  readonly hint?: string
  readonly dueDate?: string
  readonly cycle: string
  readonly status: 'pending' | 'in_progress' | 'closed'
  /** 关闭原因（仅 status==='closed' 时存在）：客户端区分「已达成/已过期」。 */
  readonly closedReason?: 'achieved' | 'expired'
  readonly requiredDays: number
  readonly completedDays: number
  readonly nextOpportunityDate?: string
  readonly wishId?: string
  readonly wishName?: string
}

export interface OverviewPayload {
  readonly today: string
  readonly total: number
  readonly checked: number
  readonly uncheckedCount: number
  readonly unchecked: ReadonlyArray<{
    readonly taskId: string
    readonly name: string
    readonly cycle: string
    readonly wishName?: string
    readonly hint?: string
    readonly status: ApiTask['status']
  }>
}

export interface DayTask {
  readonly taskId: string
  readonly name: string
  readonly cycle: string
  readonly wishName?: string
  readonly hint?: string
  readonly status: ApiTask['status']
  /** 承诺口径布尔（host 单一判定）：已领取方计入待打卡/完成率。 */
  readonly claimed: boolean
  readonly checked: boolean
  readonly canCheckIn: boolean
  readonly canCancel: boolean
}

export interface DayPayload {
  readonly date: string
  readonly tasks: ReadonlyArray<DayTask>
}

export interface ApiWish {
  readonly wishId: string
  readonly title: string
  readonly categoryName: string
  readonly colorKey?: string
  readonly description?: string
  readonly progress: number
  readonly archived: boolean
  /** 待结算（满进度而有候选）/计划中（无已领取任务）与候选计数：服务端 wishProgressFromAgg 派生，展示层禁止重建谓词（§5.2 规则 7）。 */
  readonly settled: boolean
  readonly pendingCount: number
  readonly planning: boolean
  readonly estimatedCompletionDate?: string
  readonly tasks: ReadonlyArray<ApiTask>
}

export interface WishesPayload {
  readonly today: string
  readonly wishes: ReadonlyArray<ApiWish>
}

export interface CalendarPayload {
  readonly month: string
  readonly today: string
  readonly weeks: ReadonlyArray<ReadonlyArray<{ readonly date: string | null; readonly checked: number; readonly due: number }>>
}

export interface ApiGrowthLevel {
  readonly level: number
  readonly levelName: string
  readonly requiredExperience: number
  readonly rewardDescription: string
}

export interface GrowthPayload {
  readonly today?: string
  readonly currentStreak: number
  readonly maxStreak: number
  /** 兼容旧字段；新口径优先读 totalCheckinDays（去重日期数）。 */
  readonly totalCheckins?: number
  readonly totalCheckinDays?: number
  readonly wishAchieved: number
  readonly wishTotal: number
  readonly taskAchieved?: number
  readonly taskTotal?: number
  readonly memoryCount?: number
  readonly level?: number
  readonly levelName?: string
  readonly rewardDescription?: string
  readonly totalExperience?: number
  readonly nextLevelExperience?: number | null
  readonly levelProgress?: number
  readonly levels?: ReadonlyArray<ApiGrowthLevel>
}

export interface RangePayload {
  readonly days: ReadonlyArray<{ readonly date: string; readonly total: number; readonly checked: number }>
}

export interface TasksPayload {
  readonly today: string
  readonly tasks: ReadonlyArray<ApiTask>
}

export interface MemoryItem {
  readonly key: string
  readonly value: string
  readonly category: string
  readonly importance: string
  readonly createdAt: string
}

export interface MemoriesPayload {
  readonly today: string
  readonly total: number
  /** offset 分页：本页条目；offset>0 时为后续页。 */
  readonly memories: ReadonlyArray<MemoryItem>
  readonly offset?: number
}
