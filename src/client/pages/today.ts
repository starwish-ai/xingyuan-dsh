/** 今日页：今日打卡总览 + 一键打卡/领取 + 已完成撤销。 */
import { createElement, type ReactElement } from 'react'
import { postAction } from '../api.js'
import { toast } from '../ui.js'
import { useXyT } from '../i18n.js'
import { softConfirm, useActionGuard, usePageData, useStableScrollbar, localYmd } from '../hooks.js'
import { PageEmpty, PageError, PageSkeleton } from '../ui.js'
import { cycleLabel, dateSuffix } from './format.js'
import type { DayPayload, OverviewPayload } from './types.js'

export function TodayPage(): ReactElement {
  const t = useXyT()
  const stabilize = useStableScrollbar()
  const overview = usePageData<OverviewPayload>('/xingyuan/api/overview')
  const day = usePageData<DayPayload>(() => `/xingyuan/api/day?date=${localYmd(new Date())}`)
  const { busy, guard } = useActionGuard()

  const reload = (): Promise<void> => Promise.all([overview.reload(), day.reload()]).then(() => undefined)
  const act = (action: string, body: Record<string, unknown>, doneText?: (payload: Record<string, unknown>) => string): void => {
    // busy 窗口覆盖「动作 + 双列表刷新」全程：刷新未落定时按钮保持禁用，
    // 杜绝陈旧数据下的双击竞态与多余的 already_checked 提示
    guard(() => postAction(action, body).then((payload) => {
      if (doneText !== undefined) toast(doneText(payload), 'ok')
      return reload()
    }))
  }

  if (overview.error !== undefined) return createElement(PageError, { message: overview.error, onRetry: overview.reload })
  if (day.error !== undefined) return createElement(PageError, { message: day.error, onRetry: day.reload })
  const data = overview.data
  const dayData = day.data
  if (data === undefined || dayData === undefined) return createElement(PageSkeleton)

  const ratio = data.total > 0 ? Math.round((data.checked / data.total) * 100) : 0
  const doneItems = dayData.tasks.filter((task) => task.checked)
  const openItems = dayData.tasks.filter((task) => !task.checked && task.status === 'in_progress')
  const pendingItems = dayData.tasks.filter((task) => !task.checked && task.status === 'pending')
  const rows = [...openItems, ...pendingItems].map((task) => createElement('li', { key: task.taskId, className: 'xy-grouprow' },
    createElement('div', { className: 'xy-rowmain' },
      createElement('span', { className: 'xy-rowtitle' }, task.name),
      createElement('span', { className: 'xy-meta' },
        `${cycleLabel(task.cycle)}${task.wishName !== undefined ? ` · ${task.wishName}` : ''}${task.hint !== undefined ? ` · ${task.hint}` : ''}`)),
    task.status === 'in_progress'
      ? createElement('button', {
          className: 'xy-btn xy-btn-primary',
          disabled: busy || !task.canCheckIn,
          title: task.canCheckIn ? undefined : t('cal.state.todo'),
          onClick: () => act('checkin', { taskId: task.taskId }, (p) =>
            t('toast.checkinOk') + dateSuffix(typeof p.date === 'string' ? String(p.date) : undefined)),
        }, t('action.checkin'))
      : createElement('button', {
          className: 'xy-btn', disabled: busy,
          onClick: () => act('claim', { taskId: task.taskId }, () => t('toast.claimed', { name: task.name })),
        }, t('action.claim'))))
  const doneRows = doneItems.map((task) => createElement('li', { key: task.taskId, className: 'xy-grouprow xy-done' },
    createElement('div', { className: 'xy-rowmain' },
      createElement('span', { className: 'xy-rowtitle' },
        createElement('span', { className: 'xy-done-glyph', 'aria-hidden': 'true' }, '✓'),
        task.name),
      createElement('span', { className: 'xy-meta' }, cycleLabel(task.cycle))),
    createElement('button', { className: 'xy-btn', disabled: busy, onClick: () => {
      if (!softConfirm(t('confirm.undoToday', { name: task.name }))) return
      act('cancel-checkin', { taskId: task.taskId }, (p) => typeof p.date === 'string'
        ? t('toast.undoneAt', { date: String(p.date) })
        : t('toast.undone'))
    } }, t('action.undoCheckin'))))

  const allDone = data.total > 0 && data.uncheckedCount === 0
  return createElement('div', { className: 'xy-page', ref: stabilize },
    // 概览卡：标题、计数与进度条同卡呈现——进度条不再作为裸条悬在页头下方，
    // 0% 时也有明确的「今日进度」语境（即旧版页头下的空白横条）。
    createElement('section', { className: `xy-todayhero${allDone ? ' xy-todayhero-all' : ''}` },
      createElement('div', { className: 'xy-todayhero-top' },
        createElement('h2', { className: 'xy-page-title' }, t('today.title', { date: data.today })),
        data.total === 0
          ? createElement('span', { className: 'xy-meta' }, t('today.noneToday'))
          : createElement('span', { className: 'xy-todayhero-num' },
              t('today.summary', { checked: data.checked, total: data.total, ratio }))),
      data.total > 0
        ? createElement('div', {
            className: 'xy-bar',
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': ratio,
            'aria-label': t('today.title', { date: data.today }),
          },
            createElement('div', { className: 'xy-bar-fill', style: { width: `${ratio}%` } }))
        : null,
      allDone ? createElement('div', { className: 'xy-banner-ok' }, t('today.allDone')) : null),
    rows.length > 0 ? createElement('section', { className: 'xy-group' },
      createElement('h3', { className: 'xy-group-head' },
        createElement('span', { className: 'xy-group-dot xy-group-dot-warn', 'aria-hidden': 'true' }),
        createElement('span', null, t('today.sectionOpen')),
        createElement('span', { className: 'xy-group-count' }, String(rows.length))),
      createElement('ul', { className: 'xy-grouplist' }, rows)) : null,
    doneRows.length > 0 ? createElement('section', { className: 'xy-group' },
      createElement('h3', { className: 'xy-group-head' },
        createElement('span', { className: 'xy-group-dot xy-group-dot-ok', 'aria-hidden': 'true' }),
        createElement('span', null, t('today.sectionDone')),
        createElement('span', { className: 'xy-group-count' }, String(doneRows.length))),
      createElement('ul', { className: 'xy-grouplist' }, doneRows)) : null,
    data.total === 0
      ? createElement(PageEmpty, { art: 'rocket', title: t('today.empty.title'), hint: t('today.empty.hint') })
      : null)
}
