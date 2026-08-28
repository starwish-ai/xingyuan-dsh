/**
 * 包根导出：领域 spec 与事件类型（host 侧复用；client 只做类型导入）。
 * 各 cordis 插件行经子路径导出：./domain ./sqlite ./routes ./preset/side。
 * ./types 子路径的 types 与 default 条件必须指向同一编译产物（此前 types 指
 * events 声明、default 指 domain 值导出——类型与运行时解析到不同模块）。
 */
export { xingyuanDomainSpec, DOMAIN_VERSION, COACH_STYLES } from './domain.js'
export type { CoachStyle, WishRecord, TaskRecord, CheckinRecord, MemoryRecord } from './domain.js'
export type {
  XingyuanWishEventData,
  XingyuanTaskEventData,
  XingyuanCheckinEventData,
  XingyuanChartEventData,
  XingyuanChartDatum,
  XingyuanMicroEventData,
  XingyuanMicroStepView,
  XingyuanWishSnapshot,
  XingyuanTaskSnapshot,
} from './events.js'
