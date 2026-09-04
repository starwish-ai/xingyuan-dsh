/**
 * 会话视图标签页显隐控制器（client 半侧）。
 *
 * 机制：conversation.view 标签环把「全部已注册 entries」投影为标签（无
 * per-session 过滤），因此按会话预设自动显隐只能动态维护注册表——本控制器
 * 订阅「界面偏好设置快照 × 会话列表」，每次任一输入变化时 dispose 旧组、
 * 按 src/tab-policy.ts 纯策略 register 应显示的组（标签环对槽版本号订阅，
 * 重投影即刷新）。切换瞬间至多一帧旧标签，壳的 resolveActiveView 对已注销
 * 的活跃视图回落 Chat（官方契约），不会渲染空白。
 *
 * 判据：settingsScope('xingyuan-ui').tabVisibilityMode × hiddenTabs ×
 * 当前（staged）会话 SessionSummary.agentPreset === 'xingyuan'。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 0.1.2 起 sessions 列表快照归 api-session-controller 的 ctx.sessions 服务（client 子路径声明合并位）
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ReactElement } from 'react'
import { XY_NS, t, type XyKey } from './i18n.js'
import { TAB_IDS, TAB_VISIBILITY_DEFAULTS, visibleTabIds, type TabId, type TabVisibilityMode } from '../tab-policy.js'
import { CalendarPage, GrowthPage, MemoryPage, TasksPage, TodayPage, WishesPage } from './pages/index.js'
import { clearTodayHint, setTodayHint } from './tab-hint.js'

/** 设置快照的叶子视图（只读字段；与 pages/settings.ts 的 ScopeSnapshotLike 同构）。 */
interface UiScopeSnapshotLike {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value?: {
    readonly tabVisibilityMode?: TabVisibilityMode
    readonly hiddenTabs?: readonly TabId[]
  }
}

/** settingsScope.bind() 的最小结构面（getSnapshot/subscribe，同 pages/settings.ts）。 */
interface UiScopeLike {
  getSnapshot(): UiScopeSnapshotLike
  subscribe(listener: () => void): () => void
}

/** api-session-controller sessions 服务的最小结构面（列表快照 store）。0.1.2 起会话预设不再挂
 * SessionSummary 顶层，而是投影值 `projectionValues.agentPreset`（官方 AgentPresetLabel 同口径）。 */
interface SessionsListLike {
  getSnapshot(): {
    readonly current?: string
    readonly byId: Record<string, { readonly projectionValues?: { readonly agentPreset?: unknown } } | undefined>
  }
  subscribe(fn: () => void): () => void
}

const noopUnsubscribe = (): void => {}

/** 六个标签的注册描述（id/order/label 与旧静态注册完全一致，仅迁到控制器）。 */
interface TabEntryDef {
  readonly tabId: TabId
  readonly id: string
  readonly order: number
  readonly labelKey: XyKey
  readonly component: () => ReactElement
}

const TAB_ENTRIES: readonly TabEntryDef[] = [
  { tabId: 'today', id: 'xy-today', order: 21, labelKey: 'tab.today', component: TodayPage },
  { tabId: 'wishes', id: 'xy-wishes', order: 22, labelKey: 'tab.wishes', component: WishesPage },
  { tabId: 'tasks', id: 'xy-tasks', order: 23, labelKey: 'tab.tasks', component: TasksPage },
  { tabId: 'calendar', id: 'xy-calendar', order: 24, labelKey: 'tab.calendar', component: CalendarPage },
  { tabId: 'growth', id: 'xy-growth', order: 25, labelKey: 'tab.growth', component: GrowthPage },
  { tabId: 'memory', id: 'xy-memory', order: 26, labelKey: 'tab.memory', component: MemoryPage },
]

/**
 * 安装标签页显隐控制器，返回随 conversation.view 声明生命周期卸载的 disposer。
 * 必须在 slots.inject('conversation.view') 回调内调用：保证首次 sync() 时
 * 槽已声明（未声明时 register 不落账），注册/注销全走壳的 effect 语义。
 */
export function installTabVisibility(ctx: ClientContext): () => void {
  const sessions = ctx.get('sessions') as { readonly list?: SessionsListLike } | undefined
  const scope = ctx.settingsScope.bind({ namespace: 'xingyuan-ui' }) as unknown as UiScopeLike
  let disposers: Array<() => void> = []
  let stopped = false

  const sync = (): void => {
    if (stopped) return
    for (const dispose of disposers) dispose()
    disposers = []
    const snap = scope.getSnapshot()
    const value = snap.value
    const mode: TabVisibilityMode = value?.tabVisibilityMode ?? TAB_VISIBILITY_DEFAULTS.tabVisibilityMode
    const hidden: readonly TabId[] = value?.hiddenTabs ?? TAB_VISIBILITY_DEFAULTS.hiddenTabs
    const list = sessions?.list?.getSnapshot()
    const row = list?.current !== undefined ? list.byId[list.current] : undefined
    const isXingyuan = row?.projectionValues?.agentPreset === 'xingyuan'
    // 「始终显示 × 非星愿会话」的今日页轻提示（Q4=b 结论），其余模式不提示
    setTodayHint(mode === 'show' && !isXingyuan)
    const visible = new Set(visibleTabIds(mode, hidden, isXingyuan))
    for (const entry of TAB_ENTRIES) {
      if (!visible.has(entry.tabId)) continue
      disposers.push(ctx.slots.register(
        { name: 'conversation.view', id: entry.id, order: entry.order, label: () => t(entry.labelKey), locale: XY_NS },
        entry.component,
      ))
    }
  }

  const unsubscribeScope = scope.subscribe(sync)
  const unsubscribeSessions = sessions?.list?.subscribe(sync) ?? noopUnsubscribe
  sync()
  return () => {
    stopped = true
    clearTodayHint()
    unsubscribeSessions()
    unsubscribeScope()
    for (const dispose of disposers) dispose()
    disposers = []
  }
}