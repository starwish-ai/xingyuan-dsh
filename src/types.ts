/**
 * 包根导出：领域 spec 与事件类型（host 侧复用；client 只做类型导入）。
 * 各 cordis 插件行经子路径导出：./domain ./sqlite ./routes ./preset/side。
 */
export { xingyuanDomainSpec, DOMAIN_VERSION, COACH_STYLES } from './domain.js'
export type { CoachStyle, WishRecord, TaskRecord, CheckinRecord, MemoryRecord } from './domain.js'
