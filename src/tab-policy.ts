/**
 * 会话视图标签页显隐策略（host/client 两半侧共用 + 测试对拍）的纯函数与常量。
 *
 * 决策口径（设计评审结论）：
 * - mode=follow（默认）：仅当前会话 agentPreset === 'xingyuan' 时显示标签页；
 * - mode=show：所有会话都显示；mode=hide：任何会话都不显示；
 * - hiddenTabs：在「显示」前提下被勾掉的单个标签（默认空数组 = 六个全显示）。
 * 未知/重复的 hiddenTabs 值一律容错忽略（settings.yaml 手改脏值不炸）。
 */

/** 六个会话视图标签的稳定业务名（与 slot entry id 的 xy- 前缀解耦，settings.yaml 可读）。 */
export const TAB_IDS = ['today', 'wishes', 'tasks', 'calendar', 'growth', 'memory'] as const

export type TabId = (typeof TAB_IDS)[number]

/** 显隐模式：跟随会话 / 始终显示 / 始终隐藏。 */
export type TabVisibilityMode = 'follow' | 'show' | 'hide'

/** 命名空间缺省（与 xingyuan-ui schema 默认值同源，见 src/ui-settings.ts）。 */
export const TAB_VISIBILITY_DEFAULTS: {
  tabVisibilityMode: TabVisibilityMode
  hiddenTabs: TabId[]
} = {
  tabVisibilityMode: 'follow',
  hiddenTabs: [],
}

/**
 * 计算当前应注册的标签集合。唯一事实口径：client 注册控制器、设置页回显、
 * 单元测试三方共用，任何一侧不得另写一份判定。
 */
export function visibleTabIds(
  mode: TabVisibilityMode,
  hiddenTabs: readonly TabId[],
  isXingyuanSession: boolean,
): readonly TabId[] {
  if (mode === 'hide') return []
  if (mode === 'follow' && !isXingyuanSession) return []
  const hidden = new Set(hiddenTabs)
  return TAB_IDS.filter((id) => !hidden.has(id))
}