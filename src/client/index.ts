/**
 * 星愿 client 半侧组装层：样式注入、locale 字典注册、5 个卡片 Definition + keyed 渲染、
 * 6 个会话视图标签页（今日/愿望/任务/日历/成长/记忆）+ 设置整页。
 * 文案与渲染细节分别在 i18n.ts / cards.ts / pages/*；本文件只做注册与接线。
 */
import type { ClientContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { t, XY_NS, setupLocale } from './i18n.js'
import { disposeToasts } from './ui.js'
import { STYLE_TEXT } from './styles.js'
import { CARD_VIEWS } from './cards.js'
import type { XyState } from './types.js'
import { CalendarPage, GrowthPage, MemoryPage, TasksPage, TodayPage, WishesPage } from './pages/index.js'
import { SettingsSection, type SettingsScopeLike } from './pages/settings.js'

export const inject = ['slots', 'settingsScope', 'conversationEvents']

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'xy-wish': XyState
    'xy-task': XyState
    'xy-checkin': XyState
    'xy-chart': XyState
    'xy-micro': XyState
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'xy-wish': XyState
    'xy-task': XyState
    'xy-checkin': XyState
    'xy-chart': XyState
    'xy-micro': XyState
  }
}

/** 事件类型 → 渲染 kind。 */
const KIND_BY_EVENT: Record<string, string> = {
  'xingyuan/wish': 'xy-wish',
  'xingyuan/task': 'xy-task',
  'xingyuan/checkin': 'xy-checkin',
  'xingyuan/chart': 'xy-chart',
  'xingyuan/micro': 'xy-micro',
}

/** whole-value 单事件 Definition：每条事件独立成卡，id=event.seq，天然满足 start 唯一。 */
function definition(kind: string): ConversationNodeDefinition<XyState> {
  return {
    kind,
    target: 'chat',
    match: (event) => {
      const mapped = KIND_BY_EVENT[event.type]
      if (mapped !== kind) return null
      return { id: String(event.seq), role: 'start' }
    },
    start: (_context, match) => ({
      type: match.event.type,
      seq: match.event.seq,
      data: match.event.data as XyState['data'],
    }),
    update: (context) => context.state,
    buildViewNode: (context) => {
      if (context.state === undefined) return null
      return {
        key: context.key,
        kind,
        id: context.id,
        target: 'chat',
        anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
        location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        data: context.state,
      }
    },
  }
}

/** 客户端插件体：5 个卡片 Definition + keyed renderer + 6 个视图标签页 + 星愿设置页。 */
export function apply(ctx: ClientContext): void {
  // 双语文案：绑定壳 locale 服务并注册 xingyuan 命名空间字典（无 locale 服务时回落中文）。
  // setupLocale 给出的 execute 形状即 ctx.effect 所需（返回清理函数）。
  setupLocale(ctx.get('locale'), (execute) => ctx.effect(execute))

  const style = document.createElement('style')
  style.textContent = STYLE_TEXT
  document.head.append(style)
  ctx.effect(() => () => {
    style.remove()
    disposeToasts()
  })

  ctx.conversationEvents.register(definition('xy-wish'))
  ctx.conversationEvents.register(definition('xy-task'))
  ctx.conversationEvents.register(definition('xy-checkin'))
  ctx.conversationEvents.register(definition('xy-chart'))
  ctx.conversationEvents.register(definition('xy-micro'))

  // 卡片注册不声明 locale：t 席位由组件内 useXyT() 取代（键受查 + 订阅刷新），
  // 避免 'conversation' 窄域 t 与本插件命名空间的类型冲突。
  ctx.slots.inject('conversation.chat.node', () => [
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-wish' }, CARD_VIEWS.WishView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-task' }, CARD_VIEWS.TaskView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-checkin' }, CARD_VIEWS.CheckinView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-chart' }, CARD_VIEWS.ChartView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-micro' }, CARD_VIEWS.MicroView),
  ])

  // 会话视图环标签页：今日 / 愿望 / 任务 / 日历 / 成长 / 记忆（仅激活时挂载，进入即取最新数据）。
  // label 用 thunk 跟随当前语言；locale 声明让壳在语言切换时刷新标签行。
  ctx.slots.inject('conversation.view', () => [
    ctx.slots.register({ name: 'conversation.view', id: 'xy-today', order: 21, label: () => t('tab.today'), locale: XY_NS }, TodayPage),
    ctx.slots.register({ name: 'conversation.view', id: 'xy-wishes', order: 22, label: () => t('tab.wishes'), locale: XY_NS }, WishesPage),
    ctx.slots.register({ name: 'conversation.view', id: 'xy-tasks', order: 23, label: () => t('tab.tasks'), locale: XY_NS }, TasksPage),
    ctx.slots.register({ name: 'conversation.view', id: 'xy-calendar', order: 24, label: () => t('tab.calendar'), locale: XY_NS }, CalendarPage),
    ctx.slots.register({ name: 'conversation.view', id: 'xy-growth', order: 25, label: () => t('tab.growth'), locale: XY_NS }, GrowthPage),
    ctx.slots.register({ name: 'conversation.view', id: 'xy-memory', order: 26, label: () => t('tab.memory'), locale: XY_NS }, MemoryPage),
  ])

  // 星愿设置整页（设置 → 星愿）：教练风格/画像（星愿库）+ 二次确认开关与注入上限（设置命名空间）
  ctx.slots.inject('settings.section', () => {
    const scope = ctx.settingsScope.bind({ namespace: 'xingyuan' }) as unknown as SettingsScopeLike
    return ctx.slots.register(
      { name: 'settings.section', id: 'xingyuan', order: 60, label: () => t('settings.tabLabel'), locale: XY_NS },
      () => SettingsSection({ scope }),
    )
  })
}
