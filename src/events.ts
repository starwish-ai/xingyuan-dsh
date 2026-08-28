/**
 * 星愿业务会话事件：生产方（preset 侧工具）与消费方（client 卡片）共享的纯类型导出。
 *
 * 全部为 whole-value 单事件：每条事件携带完整展示状态，Definition 以 `event.seq`
 * 作为内部 id（每条事件一张独立卡片，天然满足「每 (kind,id) 仅一条 start」）。
 * 事件一旦发出即已持久化（模型可见即已记录），刷新/回放后卡片仍可见。
 */
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'

/** 愿望快照（卡片与 API 共用形状）。 */
export interface XingyuanWishSnapshot {
  readonly wishId: string
  readonly title: string
  readonly categoryName: string
  readonly colorKey?: string
  readonly description?: string
  readonly estimatedCompletionDate?: string
  readonly progress: number
  readonly totalRequiredDays: number
  readonly totalCompletedDays: number
  readonly createdAt: string
}

/** 任务快照（卡片与 API 共用形状）。 */
export interface XingyuanTaskSnapshot {
  readonly taskId: string
  readonly wishId?: string
  readonly wishName?: string
  readonly name: string
  readonly hint?: string
  readonly dueDate?: string
  readonly checkInCycle: 'once' | 'daily' | 'weekly' | 'monthly'
  readonly status: 'pending' | 'in_progress' | 'closed'
  readonly requiredDays: number
  readonly completedDays: number
  readonly nextOpportunityDate?: string
  readonly createdAt: string
}

/** 愿望创建/更新/删除事实。 */
export interface XingyuanWishEventData {
  readonly op: 'created' | 'updated' | 'deleted'
  readonly wish: XingyuanWishSnapshot
}

/** 任务创建/更新/删除事实（含机会日预览，供卡片直接展示）。 */
export interface XingyuanTaskEventData {
  readonly op: 'created' | 'updated' | 'deleted'
  readonly task: XingyuanTaskSnapshot
  /** 未来几个机会日（≤5 个，yyyy-MM-dd），创建/更新时给用户直观预期。 */
  readonly opportunityPreview: readonly string[]
}

/** 打卡/取消打卡事实。 */
export interface XingyuanCheckinEventData {
  readonly op: 'checked' | 'cancelled'
  readonly taskId: string
  readonly taskName: string
  readonly wishName?: string
  /** 本次勾选（或取消）的机会日。 */
  readonly date: string
  readonly checkedAt: string
  readonly completedDays: number
  readonly requiredDays: number
}

/** 图表事实（getChart 成功后发出；数据口径见 src/preset/charts.ts）。 */
export interface XingyuanChartEventData {
  readonly chartKey: string
  readonly title: string
  readonly subtitle?: string
  readonly chartType: 'line' | 'column' | 'bar' | 'pie' | 'arcbars' | 'heatmap' | 'radar'
  readonly data: readonly XingyuanChartDatum[]
  /**
   * 生成时刻（ISO）：图表卡是 whole-value 冻结快照，重放时据此标注「生成于」，
   * 避免历史会话里的旧图被误读为当前数据（事件溯源：事实不可变，标注让历史性可见）。
   * optional：旧事件无此字段则不显示标注（诚实降级，不编造时间）。
   */
  readonly generatedAt?: string
}

/** 单个图表数据点。 */
export interface XingyuanChartDatum {
  readonly label: string
  readonly value: number
  /** 占比/比率类（0-1），arcbars 渲染用。 */
  readonly ratio?: number
  /** 分组序列名（weekComparison 等分组图用）。 */
  readonly series?: string
  /**
   * 无数据点（如 checkinRateTrend 的无安排日）：渲染为空槽而非 0 值柱——
   * 「没有安排」≠「完成率为 0」，缺失必须显式可见（数据可视化 null≠zero 惯例）。
   * optional：旧事件无此字段照常渲染，回放兼容。
   */
  readonly inactive?: boolean
}

/** 微行动步骤快照（事件卡展示用）。 */
export interface XingyuanMicroStepView {
  readonly stepNumber: number
  readonly instruction: string
  readonly rationale?: string
  readonly completed: boolean
  readonly skipped: boolean
}

/** 微行动事实（开始/推进/重开/完成；whole-value 每条一张步骤卡）。 */
export interface XingyuanMicroEventData {
  readonly op: 'started' | 'stepped' | 'restarted' | 'finished'
  readonly taskId: string
  readonly taskName: string
  readonly steps: readonly XingyuanMicroStepView[]
  /** 当前步（null = 全部处理完毕）。 */
  readonly currentStepNumber: number | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** 愿望业务事实（whole-value；每条事件一张愿望卡）。 */
    'xingyuan/wish': XingyuanWishEventData
    /** 任务业务事实（含机会日预览；每条事件一张任务卡）。 */
    'xingyuan/task': XingyuanTaskEventData
    /** 打卡业务事实（每条事件一张打卡卡）。 */
    'xingyuan/checkin': XingyuanCheckinEventData
    /** 图表业务事实（每条事件一张图表卡）。 */
    'xingyuan/chart': XingyuanChartEventData
    /** 微行动业务事实（拆解执行步进流）。 */
    'xingyuan/micro': XingyuanMicroEventData
  }
}
