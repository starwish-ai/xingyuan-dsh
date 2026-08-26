/**
 * 页面共享 Hooks：取数三态（usePageData）、动作防重入（useActionGuard）、
 * 滚动条槽位稳定（useStableScrollbar）、本地日期口径（localYmd）、近 N 天窗口。
 * 六页取数样板统一收口——新页面取数 ≤3 行起步（T2-1）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getJson, describeError } from './api.js'
import { confirmDialog, toastError } from './ui.js'

/** 本地时区 yyyy-MM-dd（与机会日计算器的本地「今天」同口径；禁用 toISOString 的 UTC 偏移）。 */
export function localYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 区间查询用的本地日期窗口（近 n 天，含今天）。 */
export function recentRangeDays(days: number): { start: string; end: string } {
  const now = new Date()
  return {
    start: localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))),
    end: localYmd(now),
  }
}

export interface PageData<T> {
  readonly data: T | undefined
  readonly error: string | undefined
  /** 重取数据；返回取数 Promise，供写操作把 busy 窗口延伸到刷新完成（防陈旧双击竞态）。 */
  readonly reload: () => Promise<void>
}

/**
 * 取数三态统一：挂载（或 deps 变化）即拉取，error 存本地化文案，
 * reload 供错误态按钮与动作后刷新复用。path 支持函数形态（如日历按月取参）；
 * 内置序号守卫：快速翻页/连点时慢的旧响应不得覆盖新状态。
 */
export function usePageData<T>(path: string | (() => string), deps: readonly unknown[] = []): PageData<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const seqRef = useRef(0)
  const pathRef = useRef(path)
  pathRef.current = path

  const load = useCallback((): Promise<void> => {
    const seq = ++seqRef.current
    setError(undefined)
    return getJson<T>(typeof pathRef.current === 'function' ? pathRef.current() : pathRef.current)
      .then((payload) => { if (seq === seqRef.current) setData(payload) })
      .catch((e: unknown) => { if (seq === seqRef.current) setError(describeError(e)) })
  }, deps)

  useEffect(() => { void load() }, [load])
  return { data, error, reload: load }
}

/**
 * 写操作防重入：busy 期间 guard 直接吞掉重复调用（按钮同时置 disabled），
 * 结束后自动复位；失败经 toast 非阻塞提示（describeError 本地化）。
 */
export function useActionGuard(): { readonly busy: boolean; readonly guard: (run: () => Promise<unknown>) => void } {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const guardRef = useRef((run: () => Promise<unknown>): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    run().catch(toastError).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  })
  return { busy, guard: guardRef.current }
}

/**
 * 把祖先滚动容器的滚动条槽位钉成常驻（scrollbar-gutter: stable）。
 * 壳的输入框浮层模式会把真实滚动容器（*_scrollBody）的 gutter 放开为 auto，
 * 经典滚动条按需出现/消失会使页面宽度抖动约 15px，等分布局随之整格跳变。
 * 因此每次提交后沿祖先链把所有潜在滚动容器全部重钉，卸载时统一还原。
 */
export function useStableScrollbar(): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null)
  const undoRef = useRef<Map<HTMLElement, string>>(new Map())

  const pin = useCallback((): void => {
    const node = nodeRef.current
    if (node === null) return
    const undo = undoRef.current
    let el: HTMLElement | null = node.parentElement
    for (let depth = 0; el !== null && depth < 16; depth += 1, el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && !undo.has(el)) {
        undo.set(el, el.style.scrollbarGutter)
        el.style.scrollbarGutter = 'stable'
      }
    }
  }, [])

  // 无依赖数组：每次提交后执行，捕捉壳侧节点替换与结构变化（幂等，已钉的跳过）。
  // 用 useLayoutEffect：钉住发生在浏览器绘制前——展开详情/新建让内容变高时，
  // 竖向滚动条出现的同一帧槽位已就位，经典滚动条不再引起整页宽度抖动。
  useLayoutEffect(() => { pin() })

  // 仅最终卸载时还原，避免逐次提交的样式抖动
  useEffect(() => () => {
    for (const [el, prev] of undoRef.current) el.style.scrollbarGutter = prev
    undoRef.current.clear()
    nodeRef.current = null
  }, [])

  return useCallback((node: HTMLElement | null): void => {
    if (node === null) return
    nodeRef.current = node
    pin()
  }, [pin])
}

/**
 * 写操作确认（应用内弹窗，替代原生 window.confirm）：Promise 结算；
 * 调用方以 `softConfirm(msg).then((ok) => { if (ok) … })` 表达「确认后才继续」。
 * 删除类不可逆动作请再传 danger 语义（见 confirmDialog）。
 */
export function softConfirm(message: string): Promise<boolean> {
  return confirmDialog(message)
}

/** 删除类确认（实心危险键）：与 softConfirm 同一交互闭环，仅视觉强调不可逆。 */
export function softConfirmDanger(message: string): Promise<boolean> {
  return confirmDialog({ message, danger: true })
}
