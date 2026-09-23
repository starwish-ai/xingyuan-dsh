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
 * 判据：主行配置表单的 tabVisibilityMode × hiddenTabs ×
 * 当前会话是否星愿预设（取法见 src/tab-policy.ts 的 currentSessionIsXingyuan）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 0.1.2 起 sessions 列表快照归 api-session-controller 的 ctx.sessions 服务（client 子路径声明合并位）
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// 0.1.7 起可编辑配置归 configForms 服务（dsh-client-ui-settings 的 Context 声明合并位）
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReactElement } from 'react'
import { XY_NS, t, type XyKey } from './i18n.js'
import { TAB_VISIBILITY_DEFAULTS, currentSessionIsXingyuan, normalizeHiddenTabs, visibleTabIds, type SessionListFacts, type TabId, type TabVisibilityMode } from '../tab-policy.js'
import { SETTINGS_ENTRY_ID, type SettingsFormValue } from '../pref-policy.js'
import { CalendarPage, GrowthPage, MemoryPage, TasksPage, TodayPage, WishesPage } from './pages/index.js'
import { clearTodayHint, setTodayHint } from './tab-hint.js'

/**
 * `ctx.sessions` 的会话列表 store 收窄视图。
 *
 * 为什么要自己断言而不直接用宿主类型：服务名 `sessions` 在宿主两半侧**撞名**——
 * dsh-session 把 host 侧 `SessionStore` 合并进 `Context.sessions`，
 * dsh-api-session-controller 又把 client 侧 `ISessions` 合并进同一个键。
 * 本仓库两半侧的类型都在编译面里，解析结果是 host 那个，`ctx.sessions.list`
 * 的类型因此是错的，只能按运行时事实面收窄。
 * 列表快照的两代形状差异不在此处重复，统一收在 tab-policy 的 SessionListFacts。
 */
interface SessionsListLike {
  getSnapshot(): SessionListFacts
  subscribe(fn: () => void): () => void
}

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
  // 不写逐级可选链：上一版 `sessions?.list?.` 把「依赖缺席」表现成「标签页永远不出现」
  // 且零线索。sessions 现已在 index.ts 的 inject 里声明，apply 跑到这里必然就绪。
  const { list: sessions } = ctx.get('sessions') as unknown as { readonly list: SessionsListLike }
  // 与设置页共用同一表单实例（宿主按行 id 缓存），故此处只读不改
  const form = ctx.configForms.get<SettingsFormValue>(SETTINGS_ENTRY_ID)
  let disposers: Array<() => void> = []
  let stopped = false

  const sync = (): void => {
    if (stopped) return
    for (const dispose of disposers) dispose()
    disposers = []
    const value = form.getSnapshot().value
    const mode: TabVisibilityMode = value?.tabVisibilityMode ?? TAB_VISIBILITY_DEFAULTS.tabVisibilityMode
    const hidden: readonly TabId[] = normalizeHiddenTabs(value?.hiddenTabs)
    const isXingyuan = currentSessionIsXingyuan(sessions.getSnapshot())
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

  const unsubscribeForm = form.subscribe(sync)
  const unsubscribeSessions = sessions.subscribe(sync)
  sync()
  return () => {
    stopped = true
    clearTodayHint()
    unsubscribeSessions()
    unsubscribeForm()
    for (const dispose of disposers) dispose()
    disposers = []
  }
}