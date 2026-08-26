/**
 * 共享 UI 原语：Toast 轻提示、页面级 加载/错误/空态，与空态线性插画。
 * 插画为内联 SVG 线稿（stroke 走主题令牌、点缀走品牌强调色），深浅色自适应，
 * aria-hidden（语义文案由调用方提供）——替代 emoji 主视觉的「廉价感」。
 */
import { createElement, type ReactElement } from 'react'
import { describeError } from './api.js'
import { t } from './i18n.js'

// ===== Toast（壳内轻提示）=====

type ToastKind = 'ok' | 'error' | 'info'

let toastRoot: HTMLElement | undefined

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

/** 插件卸载时清空 toast 容器（HMR/停用不留残骸）。 */
export function disposeToasts(): void {
  toastRoot?.remove()
  toastRoot = undefined
}

const TOAST_GLYPH: Record<ToastKind, string> = { ok: '✓', error: '!', info: '★' }

/** 轻提示：成功 2.6s / 错误 4.2s 自动消退，点击立即关闭；textContent 注入天然防 XSS。 */
export function toast(message: string, kind: ToastKind = 'info'): void {
  const root = ensureToastRoot()
  while (root.children.length >= 4) root.firstElementChild?.remove()
  const el = document.createElement('div')
  el.className = `xy-toast xy-toast-${kind}`
  const glyph = document.createElement('span')
  glyph.className = 'xy-toast-glyph'
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
    document.body.append(backdrop)
    initialFocus.focus()
  })
}

/** 插件卸载时结算全部未决确认框（一律按取消），调用方 Promise 不悬挂。 */
export function disposeConfirms(): void {
  for (const entry of [...openConfirms]) entry.resolve(false)
}

// ===== 页面三态 =====

export function PageError(props: { message: string; onRetry: () => void; retryLabel?: string }): ReactElement {
  return createElement('div', { className: 'xy-page-center' },
    createElement(EmptyArt, { kind: 'alert' }),
    createElement('div', { className: 'xy-empty-title' }, props.message),
    createElement('button', { className: 'xy-btn', onClick: props.onRetry }, props.retryLabel ?? t('common.retry')))
}

/** 骨架屏加载态：微光扫过占位块，避免「文字→内容」的突变感。 */
export function PageSkeleton(): ReactElement {
  return createElement('div', { className: 'xy-page', 'aria-busy': 'true' },
    createElement('div', { className: 'xy-skel xy-skel-title' }),
    ...[0, 1, 2].map((i) => createElement('div', { key: i, className: 'xy-skel xy-skel-row' })),
    createElement('span', { className: 'xy-visually-hidden' }, t('common.loading')))
}

/**
 * 空态：线性插画 + 主文案 + 辅助引导（Web EmptyState 三段式升级版）。
 * icon 参数保留兼容旧调用点（不再使用 emoji 时可删）。
 */
export function PageEmpty(props: { art?: EmptyArtKind; title: string; hint?: string }): ReactElement {
  return createElement('div', { className: 'xy-page-center' },
    createElement(EmptyArt, { kind: props.art ?? 'star' }),
    createElement('div', { className: 'xy-empty-title' }, props.title),
    props.hint !== undefined ? createElement('div', { className: 'xy-meta xy-empty-hint' }, props.hint) : null)
}

// ===== 空态线性插画（SVG 线稿，双主题令牌供色）=====

export type EmptyArtKind =
  | 'star'      // 愿望
  | 'rocket'    // 今日
  | 'list'      // 任务
  | 'calendar'  // 日历
  | 'sprout'    // 成长
  | 'memory'    // 记忆（书页+星点）
  | 'search'    // 搜索无结果
  | 'alert'     // 错误

const ART_SIZE = 76

function artChildren(kind: EmptyArtKind): ReactElement {
  switch (kind) {
    case 'star':
      return createElement('g', null,
        createElement('path', { d: 'M32 12l4.7 10.9L48 27l-11.3 4.1L32 42l-4.7-10.9L16 27l11.3-4.1z' }),
        createElement('circle', { cx: 49, cy: 15, r: 2.5, style: { fill: 'var(--xyd-accent)', stroke: 'none' } }),
        createElement('path', { d: 'M14 44c6 5 30 5 36 0', opacity: 0.55 }))
    case 'rocket':
      return createElement('g', null,
        createElement('path', { d: 'M32 10c7 6 10 14 10 22l-10 8-10-8c0-8 3-16 10-22z' }),
        createElement('circle', { cx: 32, cy: 26, r: 4.5 }),
        createElement('path', { d: 'M22 34l-6 8h9M42 34l6 8h-9M28 46l4 8 4-8', opacity: 0.75 }),
        createElement('path', { d: 'M10 20h6M8 30h5M50 20h6M51 30h5', opacity: 0.45 }))
    case 'list':
      return createElement('g', null,
        createElement('rect', { x: 16, y: 12, width: 32, height: 40, rx: 5 }),
        createElement('path', { d: 'M26 12v-3h12v3', opacity: 0.75 }),
        createElement('path', { d: 'M23 25l2.5 2.5L30 23', style: { stroke: 'var(--xyd-accent)' } }),
        createElement('path', { d: 'M35 26h9' }),
        createElement('path', { d: 'M23 35l2.5 2.5L30 33', opacity: 0.85 }),
        createElement('path', { d: 'M35 36h9', opacity: 0.85 }),
        createElement('path', { d: 'M24 45h16', opacity: 0.5 }))
    case 'calendar':
      return createElement('g', null,
        createElement('rect', { x: 13, y: 16, width: 38, height: 34, rx: 5 }),
        createElement('path', { d: 'M13 26h38M22 16v-5M42 16v-5' }),
        createElement('rect', { x: 21, y: 32, width: 6, height: 6, rx: 1.5, style: { fill: 'var(--xyd-accent)', stroke: 'none' } }),
        createElement('rect', { x: 31, y: 32, width: 6, height: 6, rx: 1.5, opacity: 0.6 }),
        createElement('rect', { x: 41, y: 32, width: 4, height: 6, rx: 1.5, opacity: 0.35 }),
        createElement('path', { d: 'M21 43.5h24', opacity: 0.4 }))
    case 'sprout':
      return createElement('g', null,
        createElement('path', { d: 'M32 52V30' }),
        createElement('path', { d: 'M32 36c0-8-6-12-14-12 0 8 5 12 14 12z' }),
        createElement('path', { d: 'M32 30c0-8 6-12 14-12 0 8-5 12-14 12z', style: { stroke: 'var(--xyd-accent)' } }),
        createElement('path', { d: 'M20 52h24', opacity: 0.6 }),
        createElement('path', { d: 'M14 58h36', opacity: 0.35 }))
    case 'memory':
      return createElement('g', null,
        createElement('path', { d: 'M32 14c-9 0-15 6-15 14 0 5 2 8 5 11v7a3 3 0 003 3h14a3 3 0 003-3v-7c3-3 5-6 5-11 0-8-6-14-15-14z' }),
        createElement('path', { d: 'M27 49h10M29 54h6', opacity: 0.6 }),
        createElement('circle', { cx: 14, cy: 24, r: 1.6, opacity: 0.6 }),
        createElement('circle', { cx: 53, cy: 34, r: 1.4, opacity: 0.45 }))
    case 'search':
      return createElement('g', null,
        createElement('circle', { cx: 30, cy: 28, r: 12 }),
        createElement('path', { d: 'M39 37l11 11' }),
        createElement('path', { d: 'M25 28c0-3 2-5 5-5', opacity: 0.55 }))
    case 'alert':
      return createElement('g', null,
        createElement('path', { d: 'M32 12L52 48H12z' }),
        createElement('path', { d: 'M32 25v11' }),
        createElement('circle', { cx: 32, cy: 42, r: 1.8, style: { fill: 'var(--xyd-danger)', stroke: 'none' } }))
  }
}

/** 空态/错误态插画：线稿统一 stroke 令牌色，个别点缀用强调色 fill。 */
export function EmptyArt(props: { kind: EmptyArtKind }): ReactElement {
  return createElement('svg', {
    viewBox: '0 0 64 64',
    width: ART_SIZE,
    height: ART_SIZE,
    className: 'xy-art',
    'aria-hidden': 'true',
    focusable: 'false',
  },
    createElement('g', {
      style: {
        fill: 'none',
        stroke: 'var(--xyd-art-line)',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    }, artChildren(props.kind)))
}
