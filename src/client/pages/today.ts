/** 今日页：今日打卡总览 + 一键打卡/领取 + 已完成撤销。 */
import { createElement, useSyncExternalStore, type ReactElement } from 'react'
import { postAction } from '../api.js'
import { toast } from '../ui.js'
import { useXyT } from '../i18n.js'
import { softConfirm, useActionGuard, usePageData, useScrollTopOnMount, useStableScrollbar, localYmd } from '../hooks.js'
import { PageEmpty, PageError, PageSkeleton, StaleBanner, focusPageTitle } from '../ui.js'
import { cycleLabel, dateSuffix, formatFriendlyDate, formatShortDate } from './format.js'
import { todayHintStore } from '../tab-hint.js'
import type { DayPayload, OverviewPayload } from './types.js'

export function TodayPage(): ReactElement {
  const t = useXyT()
  const stabilize = useStableScrollbar()
  useScrollTopOnMount()
  // 「始终显示 × 非星愿会话」轻提示：控制器写值，本页订阅渲染（默认 false 零开销）
  const showNoPresetHint = useSyncExternalStore(todayHintStore.subscribe, todayHintStore.getSnapshot)
  const overview = usePageData<OverviewPayload>('/xingyuan/api/overview')
  const day = usePageData<DayPayload>(() => `/xingyuan/api/day?date=${localYmd(new Date())}`)
  const { busy, guard } = useActionGuard()

  const reload = (): Promise<void> => Promise.all([overview.reload(), day.reload()]).then(() => undefined)
  const act = (action: string, body: Record<string, unknown>, doneText?: (payload: Record<string, unknown>) => string): Promise<void> => {
    // busy 窗口覆盖「动作 + 双列表刷新」全程：刷新未落定时按钮保持禁用，
    // 杜绝陈旧数据下的双击竞态与多余的 already_checked 提示。
    // 保持惰性：请求必须在 guard 内发起——先发请求再进 guard 的话，busy 期间
    // 的重入调用会「被吞掉却已在服务端执行」，防重入就只剩记账作用。
    // 返回动作 promise（仅在实际发起时非 undefined）供调用方接续焦点移交。
    let run: Promise<void> | undefined
    guard(() => {
      run = postAction(action, body).then((payload) => {
        if (doneText !== undefined) toast(doneText(payload), 'ok')
        return reload()
      })
      return run
    })
    return run ?? Promise.resolve()
  }

  // 错误降级口径：数据从未到达（undefined）才整页错误屏；已有数据时降级为
  // 「旧数据 + 陈旧提示行」——动作成功后刷新失败不应让用户以为动作失败了。
  // 重试一律重取两个端点（此前先错的端点单独重试，双失败时要点两次）
  if (overview.error !== undefined && overview.data === undefined) return createElement(PageError, { message: overview.error, onRetry: reload })
  if (day.error !== undefined && day.data === undefined) return createElement(PageError, { message: day.error, onRetry: reload })
  const data = overview.data
  const dayData = day.data
  if (data === undefined || dayData === undefined) return createElement(PageSkeleton)
  const stale = overview.error !== undefined || day.error !== undefined

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
          // planForDay 保证展示行必为未打卡的进行中任务，canCheckIn 恒 true——
          // 不再有「disabled 但无解释」的死分支；disabled 仅服务动作在途的 busy 窗口
          disabled: busy || !task.canCheckIn,
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
      // 与待完成行同口径：周期 + 所属愿望（hint 是当天行动备忘，完成后不再展示）
      createElement('span', { className: 'xy-meta' }, `${cycleLabel(task.cycle)}${task.wishName !== undefined ? ` · ${task.wishName}` : ''}`)),
    createElement('button', {
      className: 'xy-btn', disabled: busy,
      // 行级语义：完成区多行并存时读屏不再播报一串同名「撤销」
      'aria-label': `${t('action.undoCheckin')} · ${task.name}`,
      onClick: () => {
      void softConfirm(t('confirm.undoToday', { name: task.name })).then((ok) => {
        if (!ok) return
        // 完成区行=今天的打卡：日期必须显式携带——服务端「不传日期=撤最近一次」
        // 会误撤未来预勾（弹框却说撤今天）。撤销后行在两个分组间迁移、原按钮
        // 随 DOM 更换销毁，刷新完成后焦点交给页面标题兜底
        act('cancel-checkin', { taskId: task.taskId, date: data.today }, (p) => typeof p.date === 'string'
          ? t('toast.undoneAt', { date: formatShortDate(String(p.date)) })
          : t('toast.undone'))
          .then(focusPageTitle, () => {})
      })
    } }, t('action.undoCheckin'))))

  const allDone = data.total > 0 && data.uncheckedCount === 0
  // 展示性日期走 Intl 本地化短格式（含星期）；aria 与标题同源，读屏不再播 ISO 串
  const heroTitle = t('today.title', { date: formatFriendlyDate(data.today) })
  return createElement('div', { className: 'xy-page', ref: stabilize },
    // 概览卡：标题、计数与进度条同卡呈现——进度条不再作为裸条悬在页头下方，
    // 0% 时也有明确的「今日进度」语境（即旧版页头下的空白横条）。
    createElement('section', { className: `xy-todayhero${allDone ? ' xy-todayhero-all' : ''}` },
      createElement('div', { className: 'xy-todayhero-top' },
        createElement('h2', { className: 'xy-page-title' }, heroTitle),
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
            'aria-label': heroTitle,
          },
            createElement('div', { className: 'xy-bar-fill', style: { transform: `scaleX(${ratio / 100})` } }))
        : null,
      allDone ? createElement('div', { className: 'xy-banner-ok' }, t('today.allDone')) : null),
    // 刷新失败但旧数据仍在：诚实降级（写已成功，页面数据可能滞后），可就地重试
    stale ? createElement(StaleBanner, { onRetry: () => void reload() }) : null,
    // 始终显示模式下非星愿会话：概览卡下一行轻提示（页面可浏览/操作，对话能力受限）
    showNoPresetHint ? createElement('p', { className: 'xy-hint' }, t('today.noPresetHint')) : null,
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
      ? createElement(PageEmpty, { title: t('today.empty.title'), hint: t('today.empty.hint') })
      : null)
}
