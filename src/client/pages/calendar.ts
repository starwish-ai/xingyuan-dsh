/** 日历页：月历（机会日语义着色）+ 日期详情面板（补卡/取消打卡）。 */
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { getJson, postAction } from '../api.js'
import { t } from '../i18n.js'
import { softConfirm, useActionGuard, usePageData, useStableScrollbar, localYmd } from '../hooks.js'
import { PageError, PageSkeleton, toast } from '../ui.js'
import { cycleLabel, dateSuffix, formatFriendlyDate, formatMonth } from './format.js'
import type { CalendarPayload, DayPayload } from './types.js'

function monthOf(offset: number): string {
  const base = new Date()
  base.setDate(1)
  base.setMonth(base.getMonth() + offset)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
}

const WEEKDAY_KEYS = ['cal.weekday.1', 'cal.weekday.2', 'cal.weekday.3', 'cal.weekday.4', 'cal.weekday.5', 'cal.weekday.6', 'cal.weekday.7'] as const

export function CalendarPage(): ReactElement {
  const [offset, setOffset] = useState(0)
  // 详情请求序号守卫：快速连点不同日期时，慢的旧响应不得覆盖新选中日的详情
  const pickSeqRef = useRef(0)
  const stabilize = useStableScrollbar()
  const { busy, guard } = useActionGuard()
  const page = usePageData<CalendarPayload>(() => `/xingyuan/api/calendar?month=${monthOf(offset)}`, [offset])
  const [detail, setDetail] = useState<DayPayload | undefined>(undefined)
  const [pickedDate, setPickedDate] = useState<string | undefined>(undefined)
  // 拾取三态：loading（面板骨架行）/ error（错误 + 重试）/ idle——交互闭环不静默吞错
  const [pickState, setPickState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    // 切月时清掉上一个月的选中与详情，并使在途 pick 响应失效——
    // 否则「高亮格消失但详情又挂回来」的错位会复现
    pickSeqRef.current += 1
    // pickedDateRef 一并失效：动作完成链凭它决定是否回填详情，
    // 不清则「打卡在途时切月」会让旧月份详情复活到新月视图
    pickedDateRef.current = undefined
    setDetail(undefined)
    setPickedDate(undefined)
    setPickState('idle')
  }, [offset])

  // 动作后重取详情需要知道「当前选中日」；用 ref 避免 act 闭包读到过期 state
  const pickedDateRef = useRef<string | undefined>(undefined)

  const pick = (date: string): void => {
    pickedDateRef.current = date
    setPickedDate(date)
    setPickState('loading')
    const seq = ++pickSeqRef.current
    getJson<DayPayload>(`/xingyuan/api/day?date=${date}`)
      .then((payload) => {
        if (seq !== pickSeqRef.current) return
        setDetail(payload)
        setPickState('idle')
      })
      .catch(() => { if (seq === pickSeqRef.current) setPickState('error') })
  }

  const data = page.data
  const act = (action: string, taskId: string, taskName: string, date: string): void => {
    // 需要确认的动作先弹应用内确认，通过后才进入写路径；无需确认的动作直接执行
    const confirmMessage =
      action === 'checkin' && date > (data?.today ?? '')
        ? t('confirm.futureAt', { name: taskName, date })
        : action === 'cancel-checkin'
          ? t('confirm.undoAt', { name: taskName, date })
          : undefined
    const run = (): void => {
      // claim 服务端只读 taskId；checkin/cancel-checkin 的 date 是必读参数
      guard(() => postAction(action, action === 'claim' ? { taskId } : { taskId, date }).then(() => {
        toast(action === 'claim'
          ? t('toast.claimed', { name: taskName })
          : action === 'checkin'
            ? t('toast.checkinOk') + dateSuffix(date)
            : t('toast.undoneAt', { date }), 'ok')
        // busy 窗口覆盖月历重取；之后仅当操作日仍是当前选中日才回填详情——
        // 动作与快速连点另一日期竞争时，慢的旧响应不得覆盖新选中日的面板
        return page.reload().then(() => {
          if (pickedDateRef.current !== date) return undefined
          const seq = ++pickSeqRef.current
          return getJson<DayPayload>(`/xingyuan/api/day?date=${date}`)
            .then((dayAfter) => { if (seq === pickSeqRef.current) { setDetail(dayAfter); setPickState('idle') } })
        })
      }))
    }
    if (confirmMessage === undefined) { run(); return }
    void softConfirm(confirmMessage).then((ok) => { if (ok) run() })
  }

  if (page.error !== undefined) return createElement(PageError, { message: page.error, onRetry: page.reload })
  if (data === undefined) return createElement(PageSkeleton)

  const cellClass = (date: string, checked: number, due: number): string => {
    const tone = due === 0 ? 'c0' : checked >= due ? 'c3' : checked > 0 ? 'c2' : 'c1'
    return `xy-cell xy-${tone}${date === data.today ? ' xy-today' : ''}${date === pickedDate ? ' xy-picked' : ''}`
  }
  const goMonth = (delta: number): void => setOffset(offset + delta)

  // 邻月补位日（业界月历惯例：Google/Apple Calendar 均渲染邻月日并置灰）：
  // null 槽位纯客户端推导真实日期——1 号前回填上月尾、月末后续填下月初。
  // 不依赖宿主路由变更；每周恒为七列，星期对齐语境完整。补位日无打卡数据语义，
  // 置灰且不可聚焦/不可点（aria-hidden，对读屏整体隐藏）。
  const leadingDates: string[] = []
  const trailingDates: string[] = []
  const flatCells = data.weeks.flat()
  const firstIdx = flatCells.findIndex((cell) => cell.date !== null)
  if (firstIdx > 0 && flatCells[firstIdx] !== undefined) {
    const first = flatCells[firstIdx]!.date!
    const cursor = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 0)
    for (let i = 0; i < firstIdx; i += 1) {
      leadingDates.unshift(localYmd(cursor))
      cursor.setDate(cursor.getDate() - 1)
    }
  }
  let lastIdx = -1
  for (let i = flatCells.length - 1; i >= 0; i -= 1) {
    if (flatCells[i]!.date !== null) { lastIdx = i; break }
  }
  const trailingCount = lastIdx >= 0 ? flatCells.length - 1 - lastIdx : 0
  if (trailingCount > 0 && lastIdx >= 0) {
    const last = flatCells[lastIdx]!.date!
    const cursor = new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 1)
    for (let i = 0; i < trailingCount; i += 1) {
      trailingDates.push(localYmd(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  const outsideBySlot = new Map<string, string>()
  {
    let leadCursor = 0
    let tailCursor = 0
    data.weeks.forEach((week, wi) => {
      week.forEach((cell, ci) => {
        if (cell.date !== null) return
        const date = leadCursor < leadingDates.length
          ? leadingDates[leadCursor++]!
          : trailingDates[tailCursor++] ?? ''
        outsideBySlot.set(`${wi}:${ci}`, date)
      })
    })
  }

  return createElement('div', { className: 'xy-page', ref: stabilize },
    // 月份导航居中（日历惯例）：‹ 标题 › 成组居中，「回到本月」绝对定位贴右缘不挤占中轴
    createElement('div', { className: 'xy-page-head xy-calnav' },
      createElement('button', { className: 'xy-btn', 'aria-label': t('cal.prevMonth'), onClick: () => goMonth(-1) }, '‹'),
      createElement('h2', { className: 'xy-page-title' }, formatMonth(data.month)),
      createElement('button', { className: 'xy-btn', 'aria-label': t('cal.nextMonth'), onClick: () => goMonth(1) }, '›'),
      offset !== 0 ? createElement('button', { className: 'xy-btn xy-calnav-back', onClick: () => goMonth(-offset) }, t('cal.backToMonth')) : null),
    // 月历收进面板卡：与任务/今日页的分组卡同一容器语言，日历本体不再裸放页面
    createElement('div', { className: 'xy-panel xy-calcard' },
      createElement('div', { className: 'xy-calhead' },
        WEEKDAY_KEYS.map((key) => createElement('span', { key, className: 'xy-calhead-cell' }, t(key)))),
      createElement('div', { className: 'xy-cal' },
        ...data.weeks.map((week, wi) => createElement('div', { key: `w${wi}`, className: 'xy-week' },
          ...week.map((cell, ci) => cell.date === null
            ? (() => {
                // 邻月补位日：置灰展示、不可聚焦不可点（纯视觉延续，读屏跳过）
                const outsideDate = outsideBySlot.get(`${wi}:${ci}`) ?? ''
                return createElement('span', {
                  key: `out-${wi}-${ci}`,
                  className: 'xy-cell xy-outside',
                  'aria-hidden': 'true',
                }, outsideDate === '' ? null : createElement('span', { className: 'xy-daynum' }, String(Number(outsideDate.slice(8)))))
              })()
            : (() => {
                // 悬停 title 与读屏 aria-label 同源同文案——键盘聚焦用户的原生提示与读屏口径不再分裂
                const cellLabel = cell.due === 0
                  ? t('cal.cellAria.none', { date: cell.date })
                  : t('cal.cellAria.some', { date: cell.date, checked: cell.checked, due: cell.due })
                // 日期号包一层圆章 span：状态底色/今日环/选中实底都挂在圆章上（现代日历惯例），
                // 格子保持无边框中性底；读屏语义不受影响（aria-label 在 button 上）
                return createElement('button', {
                  key: cell.date,
                  className: cellClass(cell.date, cell.checked, cell.due),
                  title: cellLabel,
                  'aria-label': cellLabel,
                  ...(cell.date === data.today ? { 'aria-current': 'date' as const } : {}),
                  onClick: () => pick(cell.date!),
                }, createElement('span', { className: 'xy-daynum' }, String(Number(cell.date.slice(8)))))
              })())))),
      createElement('div', { className: 'xy-legend' },
        createElement('span', null, createElement('i', { className: 'xy-dot xy-c0', 'aria-hidden': 'true' }), t('cal.legend.c0')),
        createElement('span', null, createElement('i', { className: 'xy-dot xy-c1', 'aria-hidden': 'true' }), t('cal.legend.c1')),
        createElement('span', null, createElement('i', { className: 'xy-dot xy-c2', 'aria-hidden': 'true' }), t('cal.legend.c2')),
        createElement('span', null, createElement('i', { className: 'xy-dot xy-c3', 'aria-hidden': 'true' }), t('cal.legend.c3')))),
    // 详情区常驻固定最小高度：提示/加载/错误/详情在同一容器内切换、超长列表内部滚动，
    // 消除点击不同日期时下方内容忽高忽低（连带滚动条出现/消失）的跳动；aria-live 让
    // 读屏跟随面板内容变化（选中新日期即播报）
    createElement('div', { className: 'xy-daypanel', 'aria-live': 'polite' },
      pickState === 'loading'
        ? createElement('div', { className: 'xy-skel xy-pickline', role: 'status' },
            createElement('span', { className: 'xy-visually-hidden' }, t('common.loading')))
        : pickState === 'error'
          ? createElement('div', { className: 'xy-dayhint' },
              createElement('div', { className: 'xy-field-err' }, t('cal.dayLoadFailed')),
              createElement('button', {
                className: 'xy-btn',
                onClick: () => { if (pickedDate !== undefined) pick(pickedDate) },
              }, t('common.retry')))
              : detail === undefined
                ? createElement('div', { className: 'xy-meta xy-dayhint' }, t('cal.panelHint'))
                : createElement('div', { className: 'xy-daydetail' },
                    // 面板头 = 本地化友好日期（含星期），与今日页标题同一语法；不再裸奔 ISO
                    createElement('h3', { className: 'xy-section-title' }, formatFriendlyDate(detail.date)),
                detail.tasks.length === 0
                  ? createElement('div', { className: 'xy-meta' }, t('cal.dayEmpty'))
                  : createElement('ul', { className: 'xy-grouplist' }, detail.tasks.map((task) => {
                      // 元信息分段拼接：空段不产悬挂分隔符（如已完结任务无状态词）
                      const stateText = task.checked
                        ? t('cal.state.checked')
                        : task.canCheckIn ? t('cal.state.todo')
                          : task.status === 'pending' ? t('cal.state.unclaimed') : ''
                      const segments = [
                        cycleLabel(task.cycle),
                        ...(task.wishName !== undefined ? [task.wishName] : []),
                        ...(stateText !== '' ? [stateText] : []),
                      ]
                      return createElement('li', { key: task.taskId, className: 'xy-grouprow' },
                        createElement('div', { className: 'xy-rowmain' },
                          createElement('span', { className: 'xy-rowtitle' }, task.name),
                          createElement('span', { className: 'xy-meta' }, segments.join(' · '))),
                        task.status === 'pending' && !task.checked
                          ? createElement('button', { className: 'xy-btn', disabled: busy, onClick: () => act('claim', task.taskId, task.name, detail.date) }, t('action.claim'))
                          : !task.checked && task.status === 'in_progress'
                            ? createElement('button', { className: 'xy-btn xy-btn-primary', disabled: busy || !task.canCheckIn, onClick: () => act('checkin', task.taskId, task.name, detail.date) }, t('action.checkinThisDay'))
                            : task.checked && task.canCancel
                              ? createElement('button', { className: 'xy-btn', disabled: busy, onClick: () => act('cancel-checkin', task.taskId, task.name, detail.date) }, t('action.cancelCheckin'))
                              : null)
                    })))))
}
