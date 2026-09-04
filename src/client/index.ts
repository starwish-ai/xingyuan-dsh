/**
 * 星愿 client 半侧组装层：样式注入、locale 字典注册、5 个卡片 Definition + keyed 渲染、
 * 6 个会话视图标签页（今日/愿望/任务/日历/成长/记忆）+ 设置整页。
 * 文案与渲染细节分别在 i18n.ts / cards.ts / pages/*；本文件只做注册与接线。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
// settingsScope 服务与 settings.section 槽的类型声明合并位（dsh 0.1.2 起归 ui-settings 包持有）
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// ctx.slots 服务声明位（SlotRegistry，0.1.2 起归 ui-renderer 持有）
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { t, XY_NS, setupLocale } from './i18n.js'
import { disposeConfirms, disposeToasts } from './ui.js'
import { STYLE_TEXT } from './styles.js'
import { CARD_VIEWS } from './cards.js'
import type { XyState } from './types.js'
import { installTabVisibility } from './tab-visibility.js'
import { SettingsSection, type PrefScopeLike, type UiScopeLike } from './pages/settings.js'

export const inject = ['slots', 'settingsScope', 'uiConversation']

// dsh 0.1.2 起三个声明合并位重新归口：ChatNodeDataMap 在 ui-chat，
// ConversationStepDataMap 在 ui-conversation（client 子路径），runtime 包消失。
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'xy-wish': XyState
    'xy-task': XyState
    'xy-checkin': XyState
    'xy-chart': XyState
    'xy-micro': XyState
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
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
    disposeConfirms()
  })

  // dsh 0.1.2：事件 Definition 注册收进 uiConversation 服务的 events 子注册表。
  ctx.uiConversation.events.register(definition('xy-wish'))
  ctx.uiConversation.events.register(definition('xy-task'))
  ctx.uiConversation.events.register(definition('xy-checkin'))
  ctx.uiConversation.events.register(definition('xy-chart'))
  ctx.uiConversation.events.register(definition('xy-micro'))

  // 卡片注册不声明 locale：t 席位由组件内 useXyT() 取代（键受查 + 订阅刷新），
  // 避免 'conversation' 窄域 t 与本插件命名空间的类型冲突。
  ctx.slots.inject('conversation.chat.node', () => [
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-wish' }, CARD_VIEWS.WishView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-task' }, CARD_VIEWS.TaskView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-checkin' }, CARD_VIEWS.CheckinView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-chart' }, CARD_VIEWS.ChartView),
    ctx.slots.register({ name: 'conversation.chat.node', key: 'xy-micro' }, CARD_VIEWS.MicroView),
  ])

  // 会话视图环标签页：今日 / 愿望 / 任务 / 日历 / 成长 / 记忆。
  // 显隐由 tab-visibility 控制器按「界面偏好设置 × 会话预设」动态维护：
  // 默认跟随会话（星愿预设的会话才显示），设置可切始终显示/始终隐藏并按标签勾选。
  // label 用 thunk 跟随当前语言；locale 声明让壳在语言切换时刷新标签行。
  ctx.slots.inject('conversation.view', () => installTabVisibility(ctx))

  // 星愿设置整页（设置 → 星愿）：教练风格/画像（星愿库）+ 二次确认开关与注入上限
  // （bundle 常驻命名空间 xingyuan-pref）+ 标签页显隐（bundle 常驻命名空间 xingyuan-ui）。
  // 两个偏好命名空间都挂在常驻层：整页由本文件无条件注册，命名空间若随 preset 懒加载
  // 缺席，就会出现「整页可见但两项写不进去且静默失败」。
  ctx.slots.inject('settings.section', () => {
    const prefscope = ctx.settingsScope.bind({ namespace: 'xingyuan-pref' }) as unknown as PrefScopeLike
    const uiscope = ctx.settingsScope.bind({ namespace: 'xingyuan-ui' }) as unknown as UiScopeLike
    return ctx.slots.register(
      { name: 'settings.section', id: 'xingyuan', order: 60, label: () => t('settings.tabLabel'), locale: XY_NS },
      () => SettingsSection({ scope: prefscope, uiscope }),
    )
  })
}
