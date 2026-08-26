/** 路由层可调参数（§4.3：无硬编码可调参数；默认值写在 bundle 行 Config schema）。 */

export interface RoutesConfig {
  /** 区间查询默认天数窗。 */
  rangeDefaultDays: number
  /** 区间查询天数窗上限。 */
  rangeMaxDays: number
  /** 记忆列表单页条数（分页端点缺省 limit）。 */
  memoryListLimit: number
}
