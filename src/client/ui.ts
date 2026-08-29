/**
 * 星愿 client 半侧共享 UI 原语：Toast 轻提示、应用内确认弹窗、页面三态与行内图标。
 * 插画为内联 SVG 线稿（stroke 走主题令牌、点缀走品牌强调色），深浅色自适应，
 * aria-hidden（语义文案由调用方提供）——替代 emoji 主视觉的「廉价感」。
 */
import { createElement, type ReactElement } from 'react'
import { describeError } from './api.js'
import { t } from './i18n.js'

// ===== Toast（壳内轻提示）=====

type ToastKind = 'ok' | 'error' | 'info'

let toastRoot: HTMLElement | undefined
let toastAlertRoot: HTMLElement | undefined

function ensureToastRoot(): HTMLElement {
  if (toastRoot !== undefined && toastRoot.isConnected) return toastRoot
  const root = document.createElement('div')
  root.className = 'xy-toasts'
  root.setAttribute('role', 'status')
  root.setAttribute('aria-live', 'polite')
  document.body.append(root)
  toastRoot = root
  return root
}

/** 错误 toast 独立容器（role=alert + assertive）：失败信息不得被成功提示的
 * polite 队列淹没——读屏用户按下一次操作前必须先听到上一次的失败。 */
function ensureToastAlertRoot(): HTMLElement {
  if (toastAlertRoot !== undefined && toastAlertRoot.isConnected) return toastAlertRoot
  const root = document.createElement('div')
  root.className = 'xy-toasts'
  root.setAttribute('role', 'alert')
  root.setAttribute('aria-live', 'assertive')
  document.body.append(root)
  toastAlertRoot = root
  return root
}

/** 插件卸载时清空 toast 容器（HMR/停用不留残骸）。 */
export function disposeToasts(): void {
  toastRoot?.remove()
  toastRoot = undefined
  toastAlertRoot?.remove()
  toastAlertRoot = undefined
}

const TOAST_GLYPH: Record<ToastKind, string> = { ok: '✓', error: '!', info: 'i' }

/** 轻提示：成功 2.6s / 错误 4.2s 自动消退，点击立即关闭；textContent 注入天然防 XSS。
 * 字形集合（✓/!/i）对读屏隐藏（aria-hidden）：装饰符不进 live region 播报，语义由文字承担；
 * info 用「i」不用「★」——星标是高重要度记忆的专属标记（.xy-star-hi），语义不撞车。 */
export function toast(message: string, kind: ToastKind = 'info'): void {
  const root = kind === 'error' ? ensureToastAlertRoot() : ensureToastRoot()
  while (root.children.length >= 4) root.firstElementChild?.remove()
  const el = document.createElement('div')
  el.className = `xy-toast xy-toast-${kind}`
  const glyph = document.createElement('span')
  glyph.className = 'xy-toast-glyph'
  glyph.setAttribute('aria-hidden', 'true')
  glyph.textContent = TOAST_GLYPH[kind]
  const text = document.createElement('span')
  text.className = 'xy-toast-text'
  text.textContent = message
  el.append(glyph, text)
  el.addEventListener('click', () => el.remove())
  root.append(el)
  window.setTimeout(() => {
    el.classList.add('xy-toast-out')
    window.setTimeout(() => el.remove(), 240)
  }, kind === 'error' ? 4200 : 2600)
}

/** 统一错误提示（catch 分支用）：ActionError 按 code 本地化，其余消息直出。 */
export function toastError(e: unknown): void {
  toast(describeError(e), 'error')
}

// ===== 焦点兜底 =====

/**
 * 把焦点交给当前页面的标题（h2.xy-page-title，tabindex=-1）：
 * 删除/撤销类动作会把触发行连 DOM 一起移除，确认框归还的焦点随即落空到 <body>，
 * 读屏与键盘用户就此「失明」。动作完成 + 列表刷新后调用本函数，焦点落在
 * 永远存活的稳定锚点上（程序化焦点不显示 focus 环，无视觉噪音）。
 */
export function focusPageTitle(): void {
  const title = document.querySelector<HTMLElement>('.xy-page-title')
  if (title === null) return
  if (title.tabIndex < 0) title.tabIndex = -1
  title.focus({ preventScroll: false })
}

// ===== 应用内确认弹窗 =====

/**
 * 原生 window.confirm 的替代：与壳主题同源的面板卡 + 背板遮罩。
 * Promise 结算 true/false；Esc / 背板点击 / 取消键 = false，确认键或 Enter = true。
 * 焦点进入弹窗并在关闭后归还；Tab 在两键间循环（双键弹窗无需完整 trap）。
 * 危险动作传 danger:true，确认键呈实心危险色。
 */

interface ConfirmDialogOptions {
  readonly message: string
  /** 删除类不可逆动作：确认按钮使用实心危险色。 */
  readonly danger?: boolean
}

interface OpenConfirm {
  readonly backdrop: HTMLElement
  resolve(ok: boolean): void
}

const openConfirms: OpenConfirm[] = []

/** 弹窗滚动锁：遮罩后的页面不得随手势滚动（焦点锁定在弹窗内，滚动语境同样锁定）。
 * 引用计数支持叠层弹窗；保存并恢复加锁前的 body 内联值，不覆盖壳侧并发 overlay
 * 自己设置的滚动锁。 */
let scrollLockSaved: string | undefined = undefined

function updateScrollLock(): void {
  if (openConfirms.length > 0) {
    if (scrollLockSaved === undefined) {
      scrollLockSaved = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
  } else if (scrollLockSaved !== undefined) {
    document.body.style.overflow = scrollLockSaved
    scrollLockSaved = undefined
  }
}

export function confirmDialog(options: ConfirmDialogOptions | string): Promise<boolean> {
  const { message, danger } = typeof options === 'string' ? { message: options, danger: false } : options
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'xy-modal-backdrop'
    const titleId = `xy-modal-title-${Date.now().toString(36)}-${openConfirms.length}`
    const panel = document.createElement('div')
    panel.className = 'xy-modal'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    panel.setAttribute('aria-labelledby', titleId)
    const messageEl = document.createElement('p')
    messageEl.className = 'xy-modal-msg'
    messageEl.id = titleId
    messageEl.textContent = message
    const actions = document.createElement('div')
    actions.className = 'xy-modal-actions'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'xy-btn'
    cancelBtn.textContent = t('common.cancel')
    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = danger ? 'xy-btn xy-btn-danger-solid' : 'xy-btn xy-btn-primary'
    okBtn.textContent = t('common.confirm')
    actions.append(cancelBtn, okBtn)
    panel.append(messageEl, actions)
    backdrop.append(panel)

    let settled = false
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const entry: OpenConfirm = { backdrop, resolve: finish }

    function finish(ok: boolean): void {
      if (settled) return
      settled = true
      const index = openConfirms.indexOf(entry)
      if (index >= 0) openConfirms.splice(index, 1)
      updateScrollLock()
      backdrop.classList.add('xy-modal-out')
      window.setTimeout(() => backdrop.remove(), 160)
      if (previousFocus !== null && previousFocus.isConnected) previousFocus.focus()
      resolve(ok)
    }

    // 初始焦点给安全选项：危险动作聚焦「取消」（回车误触不致不可逆），常规动作聚焦确认键
    const initialFocus = danger ? cancelBtn : okBtn
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        finish(false)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const buttons = [cancelBtn, okBtn]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.shiftKey
          ? (index <= 0 ? buttons.length - 1 : index - 1)
          : (index === -1 || index === buttons.length - 1 ? 0 : index + 1)
        buttons[next]!.focus()
      }
    }
    backdrop.addEventListener('keydown', onKeyDown)
    cancelBtn.addEventListener('click', () => finish(false))
    okBtn.addEventListener('click', () => finish(true))
    // 点击背板空白处 = 取消；点在面板上不关（误触保护）
    backdrop.addEventListener('click', (event: MouseEvent) => {
      if (event.target === backdrop) finish(false)
    })

    openConfirms.push(entry)
    updateScrollLock()
    document.body.append(backdrop)
    initialFocus.focus()
  })
}

/** 插件卸载时结算全部未决确认框（一律按取消），调用方 Promise 不悬挂。 */
export function disposeConfirms(): void {
  for (const entry of [...openConfirms]) entry.resolve(false)
  updateScrollLock()
}

// ===== 功能性小图标（编辑/删除，行内幽灵键用）=====
// 与空态插画同一线稿语言（stroke 2、圆角端点）；stroke=currentColor 继承按钮
// 危险/普通字色。仅几何基元组合（盖+桶身、笔杆），尺寸由 CSS 按钮档约束。

/** 垃圾桶线性图标（aria-hidden；语义由宿主按钮 aria-label 承担）。 */
export function IconTrash(): ReactElement {
  return createElement('svg', {
    viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': 'true', focusable: 'false',
    style: { display: 'block', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const },
  },
    createElement('path', { d: 'M4 7h16' }),
    createElement('path', { d: 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }),
    createElement('path', { d: 'M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12' }),
    createElement('path', { d: 'M10 11v6M14 11v6', opacity: 0.55 }))
}

/** 铅笔线性图标（编辑动作）。 */
export function IconEdit(): ReactElement {
  return createElement('svg', {
    viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': 'true', focusable: 'false',
    style: { display: 'block', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const },
  },
    createElement('path', { d: 'M13.5 5l5.5 5.5' }),
    createElement('path', { d: 'M5 19l1-4L17.5 3.5a2.12 2.12 0 0 1 3 3L9 18z' }))
}

// ===== 页面三态 =====

export function PageError(props: { message: string; onRetry: () => void; retryLabel?: string }): ReactElement {
  return createElement('div', { className: 'xy-page-center' },
    createElement('div', { className: 'xy-empty-title' }, props.message),
    createElement('button', { className: 'xy-btn', onClick: props.onRetry }, props.retryLabel ?? t('common.retry')))
}

/**
 * 数据陈旧横幅：动作已成功但随后的列表刷新失败时，页面保留旧数据 + 一行
 * 可重试的提示，而不是整页翻成错误屏——「写成功了却看到全页报错」会让人以为
 * 动作失败了（与 growth 页图表区独立错误分支同一诚实降级思路）。
 */
export function StaleBanner(props: { onRetry: () => void }): ReactElement {
  return createElement('div', { className: 'xy-stalerow', role: 'status' },
    createElement('span', { className: 'xy-meta' }, t('common.staleData')),
    createElement('button', { className: 'xy-btn xy-btn-inline', onClick: props.onRetry }, t('common.retry')))
}

/** 骨架屏加载态：微光扫过占位块，避免「文字→内容」的突变感。 */
export function PageSkeleton(): ReactElement {
  return createElement('div', { className: 'xy-page', 'aria-busy': 'true' },
    createElement('div', { className: 'xy-skel xy-skel-title' }),
    ...[0, 1, 2].map((i) => createElement('div', { key: i, className: 'xy-skel xy-skel-row' })),
    createElement('span', { className: 'xy-visually-hidden' }, t('common.loading')))
}

/**
 * 空态：主文案 + 辅助引导的纯文字版式。
 * 历史：曾有 76px SVG 线稿插画（EmptyArt），其描边色依赖 color-mix()，
 * 在不支持的浏览器里线稿整体隐身、只剩 accent 点缀浮现为一个孤立蓝点/对勾，
 * 观感如同渲染事故——已按产品决策整体移除，页面动作入口（页头「＋新建」）
 * 继续充当空态出口。勿在未确定目标环境支持面的前提下重新引入装饰性 CSS。
 */
export function PageEmpty(props: { title: string; hint?: string }): ReactElement {
  return createElement('div', { className: 'xy-page-center' },
    createElement('div', { className: 'xy-empty-title' }, props.title),
    props.hint !== undefined ? createElement('div', { className: 'xy-meta xy-empty-hint' }, props.hint) : null)
}

// ===== 空态/错误态已去插画化 =====
// 提示：原 EmptyArt 线稿插画（star/rocket/list/calendar/sprout/memory/search/alert 八种）
// 因描边色 color-mix() 兼容性缺陷在部分浏览器渲染为孤立色点，已于本版整体移除；
// 设计约束沉淀见 PageEmpty 注释与 AGENTS.md §5.10。
