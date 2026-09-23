/**
 * 会话视图标签页显隐策略（host/client 两半侧共用 + 测试对拍）的纯函数与常量。
 *
 * 决策口径（设计评审结论）：
 * - mode=follow（默认）：仅当前会话 agentPreset === 'xingyuan' 时显示标签页；
 * - mode=show：所有会话都显示；mode=hide：任何会话都不显示；
 * - hiddenTabs：在「显示」前提下被勾掉的单个标签（默认空数组 = 六个全显示）。
 * 未知/重复的 hiddenTabs 值由 {@link normalizeHiddenTabs} 在读取侧容错剔除
 * （手改 profile 补丁塞进脏值不炸——Config 元素类型放宽为 string，见 ui-settings.ts）。
 *
 * 「当前会话是哪一条」的取法随宿主换代过，见 {@link currentSessionIsXingyuan}。
 */

/** 六个会话视图标签的稳定业务名（与 slot entry id 的 xy- 前缀解耦，配置文件里可读）。 */
export const TAB_IDS = ['today', 'wishes', 'tasks', 'calendar', 'growth', 'memory'] as const

export type TabId = (typeof TAB_IDS)[number]

/** 显隐模式：跟随会话 / 始终显示 / 始终隐藏。 */
export type TabVisibilityMode = 'follow' | 'show' | 'hide'

/**
 * 会话列表快照里星愿要读的最小事实面——按「本插件用到什么」收窄，不是宿主类型的复刻：
 * 宿主增删其它字段都不影响本视图，代价是**我们读的字段被撤除时编译期不会报错**
 * （0.1.6 撤 `SessionListState.current` 时 typecheck 一路绿灯、运行静默失效即为此）。
 * 因此这里必须照宿主的**真实可选项性**写：宿主把 `retainedBy` 声明成必填，本视图就
 * 不得写成可选——写成可选等于允许「字段没了」继续编译通过，下一次换代又是同一个坑。
 * 见 §5.11 的踩坑实录。
 */
export interface SessionListFacts {
  readonly byId: Readonly<Record<string, SessionRowFacts | undefined>>
}

/**
 * 单条会话行。可选项性与宿主 `SessionSummary` 逐字段对齐：
 * `retainedBy` 必填（宿主明载「本地归属计数，宿主元数据刷新不得覆盖」），
 * `mainView` 缺席 = 计数为 0（该源无引用时宿主不写这个键）；
 * `projectionValues` 可选（冷读未投影时确实没有）。
 */
export interface SessionRowFacts {
  readonly retainedBy: { readonly mainView?: number }
  readonly projectionValues?: { readonly agentPreset?: unknown }
}

/**
 * 星愿 preset 身份：宿主会话投影值 `agentPreset` 的取值，与 bundle 补丁里
 * `preset-xingyuan` 声明行的 `config.id` 是同一串纯字符串（对拍见 test/preset-declaration.test.ts）。
 * 两者不一致时标签页跟随静默失效——判定取不到星愿与不是星愿在代码里是同一个 false。
 */
export const XINGYUAN_PRESET_ID = 'xingyuan'

/**
 * 「用户当前看着的会话是不是星愿预设」。
 *
 * dsh 0.1.6 起「当前会话」由每条会话行上的 `retainedBy.mainView` 引用计数表达
 * （>0 = 主视图正在看它）。更早的代际用列表快照上的 `current` 点名，本基线已不支持
 * 那一代，故不留兼容分支。
 * 多栏并行时计数可命中多行——取「任一主视图会话是星愿即显示」：标签环本身是全局
 * 的一份，六个页面读的也是同一份星愿数据。
 */
export function currentSessionIsXingyuan(list: SessionListFacts | undefined): boolean {
  if (!list) return false
  return Object.values(list.byId).some((row) =>
    (row?.retainedBy.mainView ?? 0) > 0
    && row?.projectionValues?.agentPreset === XINGYUAN_PRESET_ID,
  )
}

/** 显隐缺省（与主行 Config 里这两个 volatile 字段的 schema 默认值同源，见 src/ui-settings.ts）。 */
export const TAB_VISIBILITY_DEFAULTS: {
  tabVisibilityMode: TabVisibilityMode
  hiddenTabs: TabId[]
} = {
  tabVisibilityMode: 'follow',
  hiddenTabs: [],
}

/**
 * 读取侧容错收敛：非数组、非字符串元素、不在 {@link TAB_IDS} 内的值一律丢弃，重复值合并。
 *
 * 主行 Config 的 `hiddenTabs` 元素类型是宽松的 string（理由见 src/ui-settings.ts——
 * 解析期抛错会连带炸掉存储、路由与 preset 发布），所以「只认六个合法 id」这件事
 * 必须在**每个消费侧**发生，且只能在这一处收口。
 */
export function normalizeHiddenTabs(value: unknown): TabId[] {
  if (!Array.isArray(value)) return []
  const known = new Set<string>(TAB_IDS)
  return [...new Set(value.filter((item): item is TabId => typeof item === 'string' && known.has(item)))]
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