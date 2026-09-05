/** 愿望页：进行中/已达成愿望卡 + 下属任务行（领取/打卡/详情聚合）+ 愿望删除 + 分类管理 + 快速新建。 */
import { createElement, useState, useSyncExternalStore, type ReactElement } from 'react'
import { postAction } from '../api.js'
import { useXyT } from '../i18n.js'
import { softConfirmDanger, useActionGuard, usePageData, useScrollTopOnMount, useStableScrollbar } from '../hooks.js'
import { getViewState, setViewState } from '../view-state.js'
import { todayHintStore } from '../tab-hint.js'
import { PageEmpty, PageError, PageSkeleton, StaleBanner, toast, IconTrash, focusPageTitle } from '../ui.js'
import { categoryVars } from '../../category-color.js'
import { TaskLine } from './task-line.js'
import { formatMediumDate } from './format.js'
import { DetailToggle, TaskDetailPanel } from './detail.js'
import { CategoryManager } from './categories.js'
import { WishQuickForm } from './quick-create.js'
import type { ApiWish, WishesPayload } from './types.js'

export function WishesPage(): ReactElement {
  const t = useXyT()
  // 始终显示 × 非星愿会话：与今日页同一轻提示（空态里的「告诉我」引导对该会话不成立）
  const showNoPresetHint = useSyncExternalStore(todayHintStore.subscribe, todayHintStore.getSnapshot)
  const stabilize = useStableScrollbar()
  useScrollTopOnMount()
  const page = usePageData<WishesPayload>('/xingyuan/api/wishes')
  // 面板显隐 + 行内详情展开集合（组件持有：跨列表刷新保持展开态；
  // 展开集合另经 view-state 快照跨标签切换保留）
  const [showCategories, setShowCategories] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpandedRaw] = useState<ReadonlySet<string>>(() => getViewState<ReadonlySet<string>>('wishes.expanded', new Set()))
  const setExpanded = (next: ReadonlySet<string>): void => { setViewState('wishes.expanded', next); setExpandedRaw(next) }
  const { busy: deleting, guard: deleteGuard } = useActionGuard()
  const toggleDetail = (taskId: string): void => {
    const next = new Set(expanded)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    setExpanded(next)
  }

  if (page.error !== undefined && page.data === undefined) return createElement(PageError, { message: page.error, onRetry: () => void page.reload() })
  const data = page.data
  if (data === undefined) return createElement(PageSkeleton)

  // 页头四态计数：进行中/计划中/待收尾/已达成各计各的，与卡头徽章同一称呼
  // （消灭「摘要算进行中、卡上写计划中」的并见歧义）；全部取服务端派生位，展示层不重建谓词
  const achieved = data.wishes.filter((w) => w.archived)
  const settledCount = data.wishes.filter((w) => w.settled).length
  const planningCount = data.wishes.filter((w) => !w.archived && w.planning).length
  const active = data.wishes.filter((w) => !w.archived)

  /** 删除愿望（级联下属任务与打卡记录，服务端同一写路径）：确认后直连动作并整页刷新。
   * 行移除后触发按钮销毁、焦点落空——刷新完成后把焦点交给页面标题兜底。 */
  const removeWish = (wish: ApiWish): void => {
    void softConfirmDanger(t('confirm.deleteWish', { name: wish.title })).then((ok) => {
      if (!ok) return
      deleteGuard(() => postAction('delete-wish', { wishId: wish.wishId }).then(() => {
        toast(t('toast.deleted', { name: wish.title }), 'ok')
        return page.reload().then(() => { focusPageTitle() })
      }))
    })
  }

  /** 愿望下属任务行（含详情展开）；返回片段数组供 wishtasks 容器平铺。 */
  const wishTasks = (wish: ApiWish): ReadonlyArray<ReactElement> =>
    wish.tasks.flatMap((task) => {
      const line = createElement(TaskLine, {
        key: task.taskId,
        task,
        today: data.today,
        onChanged: page.reload,
        trailing: createElement(DetailToggle, {
          open: expanded.has(task.taskId),
          onToggle: () => toggleDetail(task.taskId),
          controlsId: `xy-task-detail-${task.taskId}`,
        }),
      })
      return expanded.has(task.taskId)
        ? [line, createElement(TaskDetailPanel, { key: `d-${task.taskId}`, id: `xy-task-detail-${task.taskId}`, taskId: task.taskId, today: data.today, onChanged: page.reload })]
        : [line]
    })

  const card = (wish: ApiWish): ReactElement => {
    // 承诺口径（§5.2 规则 7）：进度分母只计已领取任务。展示三态：
    // 计划中（无已领取任务）/ 进行中（正常百分比）/ 待结算（满进度而有候选——不归档，附收尾指引）。
    // settled/pendingCount/planning 直取服务端 wishProgressFromAgg 派生位（随 /api/wishes 下发），
    // 展示层禁止重建 `progress>=100 && 有候选` 闸门或 planning 谓词（单一判定源，防与工具回包分叉）
    const { pendingCount, settled, planning } = wish
    const progressLabel = planning ? t('wish.planning') : t('wish.progress', { percent: wish.progress })
    const pendingMeta = pendingCount > 0 ? ` · ${t('wish.pendingCount', { n: pendingCount })}` : ''
    return createElement('div', { key: wish.wishId, className: 'xy-wishcard' },
      createElement('div', { className: 'xy-card-head' },
        createElement('span', {
          className: 'xy-badge xy-badge-cat',
          style: categoryVars(wish.colorKey, wish.categoryName),
        }, wish.categoryName),
        createElement('span', { className: 'xy-title' }, wish.title),
        createElement('span', { className: 'xy-progress-num' },
          progressLabel,
          pendingCount > 0
            ? createElement('span', { className: 'xy-meta' }, pendingMeta)
            : null),
        createElement('button', {
          className: 'xy-btn xy-btn-danger xy-btn-icon',
          disabled: deleting,
          'aria-label': t('common.delete') + ' · ' + wish.title,
          title: t('common.delete'),
          onClick: () => removeWish(wish),
        }, createElement(IconTrash))),
      wish.description !== undefined ? createElement('div', { className: 'xy-meta' }, wish.description) : null,
      wish.estimatedCompletionDate !== undefined
        ? createElement('div', { className: 'xy-meta' }, t('wish.eta', { date: formatMediumDate(wish.estimatedCompletionDate) }))
        : null,
      // 与今日页 hero 进度条同一语义语法：读屏可感知进度（role+valuenow），不只是一根哑条
      createElement('div', {
        className: 'xy-bar',
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': wish.progress,
        'aria-label': progressLabel + pendingMeta,
      },
        createElement('div', { className: 'xy-bar-fill', style: { transform: `scaleX(${Math.min(wish.progress, 100) / 100})` } })),
      settled ? createElement('div', { className: 'xy-meta' }, t('wish.settleHint')) : null,
      wish.tasks.length > 0
        ? createElement('div', { className: 'xy-wishtasks' }, ...wishTasks(wish))
        : createElement('div', { className: 'xy-meta' }, t('wish.noTasks')))
  }

  return createElement('div', { className: 'xy-page', ref: stabilize },
    page.error !== undefined ? createElement(StaleBanner, { onRetry: () => void page.reload() }) : null,
    showNoPresetHint ? createElement('p', { className: 'xy-hint' }, t('today.noPresetHint')) : null,
    createElement('div', { className: 'xy-page-head' },
      createElement('h2', { className: 'xy-page-title' }, t('wish.pageTitle')),
      createElement('span', { className: 'xy-meta' }, t('wish.summary', {
        // 四态计数各计各的（进行中扣除计划中与待收尾，不相套）；列表渲染仍归未完成组（未完成≠进行中计数）
        active: active.length - settledCount - planningCount,
        planning: planningCount > 0 ? t('wish.planningSuffix', { n: planningCount }) : '',
        settled: settledCount > 0 ? t('wish.settledSuffix', { n: settledCount }) : '',
        achieved: achieved.length > 0 ? t('wish.achievedSuffix', { n: achieved.length }) : '',
      })),
      // 动作组整体右置（单一 margin-left:auto），避免多按钮各自 auto margin 平分剩余空间
      createElement('div', { className: 'xy-page-actions' },
        createElement('button', {
          className: 'xy-btn',
          'aria-expanded': showCreate,
          'aria-controls': 'xy-wishes-create',
          onClick: () => setShowCreate(!showCreate),
        }, t('action.createWish')),
        createElement('button', {
          className: 'xy-btn',
          'aria-expanded': showCategories,
          'aria-controls': 'xy-wishes-categories',
          onClick: () => setShowCategories(!showCategories),
        }, t('action.manageCategories')))),
    showCreate
      ? createElement('div', { id: 'xy-wishes-create' },
          // 传入既有愿望标题做同名软确认兜底（对话侧创建前有 check_similar_wishes 查重）
          createElement(WishQuickForm, { onCreated: () => void page.reload(), existingTitles: data.wishes.map((w) => w.title) }))
      : null,
    // onChanged：改名/配色会同步既有愿望（分类名、默认色），列表必须跟着刷新——闭环
    showCategories
      ? createElement('div', { id: 'xy-wishes-categories' },
          createElement(CategoryManager, { onChanged: () => void page.reload() }))
      : null,
    active.length === 0 && achieved.length === 0 && !showCreate && !showCategories
      ? createElement(PageEmpty, { title: t('wish.empty.title'), hint: t('wish.empty.hint') })
      : null,
    ...active.map(card),
    achieved.length > 0
      ? createElement('h3', { className: 'xy-section-title' }, t('wish.sectionAchieved'))
      : null,
    ...achieved.map(card))
}
