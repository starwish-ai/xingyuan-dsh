/** 愿望页：进行中/已达成愿望卡 + 下属任务行（领取/打卡/详情聚合）+ 愿望删除 + 分类管理 + 快速新建。 */
import { createElement, useState, type ReactElement } from 'react'
import { postAction } from '../api.js'
import { useXyT } from '../i18n.js'
import { softConfirmDanger, useActionGuard, usePageData, useStableScrollbar } from '../hooks.js'
import { PageEmpty, PageError, PageSkeleton, toast, IconTrash } from '../ui.js'
import { categoryVars } from '../../category-color.js'
import { TaskLine } from './task-line.js'
import { formatMediumDate } from './format.js'
import { DetailToggle, TaskDetailPanel } from './detail.js'
import { CategoryManager } from './categories.js'
import { WishQuickForm } from './quick-create.js'
import type { ApiWish, WishesPayload } from './types.js'

export function WishesPage(): ReactElement {
  const t = useXyT()
  const stabilize = useStableScrollbar()
  const page = usePageData<WishesPayload>('/xingyuan/api/wishes')
  // 面板显隐 + 行内详情展开集合（组件持有：跨列表刷新保持展开态）
  const [showCategories, setShowCategories] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const { busy: deleting, guard: deleteGuard } = useActionGuard()
  const toggleDetail = (taskId: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  if (page.error !== undefined) return createElement(PageError, { message: page.error, onRetry: () => void page.reload() })
  const data = page.data
  if (data === undefined) return createElement(PageSkeleton)

  const active = data.wishes.filter((w) => !w.archived)
  const achieved = data.wishes.filter((w) => w.archived)

  /** 删除愿望（级联下属任务与打卡记录，服务端同一写路径）：确认后直连动作并整页刷新。 */
  const removeWish = (wish: ApiWish): void => {
    void softConfirmDanger(t('confirm.deleteWish', { name: wish.title })).then((ok) => {
      if (!ok) return
      deleteGuard(() => postAction('delete-wish', { wishId: wish.wishId }).then(() => {
        toast(t('toast.deleted', { name: wish.title }), 'ok')
        return page.reload().then(() => undefined)
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

  const card = (wish: ApiWish): ReactElement =>
    createElement('div', { key: wish.wishId, className: 'xy-wishcard' },
      createElement('div', { className: 'xy-card-head' },
        createElement('span', {
          className: 'xy-badge xy-badge-cat',
          style: categoryVars(wish.colorKey, wish.categoryName),
        }, wish.categoryName),
        createElement('span', { className: 'xy-title' }, wish.title),
        createElement('span', { className: 'xy-progress-num' }, t('wish.progress', { percent: wish.progress })),
        createElement('button', {
          className: 'xy-btn xy-btn-danger xy-btn-icon xy-wishdel',
          disabled: deleting,
          'aria-label': t('common.delete') + ' · ' + wish.title,
          title: t('common.delete'),
          onClick: () => removeWish(wish),
        }, createElement(IconTrash))),
      wish.description !== undefined ? createElement('div', { className: 'xy-meta' }, wish.description) : null,
      wish.estimatedCompletionDate !== undefined
        ? createElement('div', { className: 'xy-meta' }, t('wish.eta', { date: formatMediumDate(wish.estimatedCompletionDate) }))
        : null,
      createElement('div', { className: 'xy-bar' },
        createElement('div', { className: 'xy-bar-fill', style: { transform: `scaleX(${Math.min(wish.progress, 100) / 100})` } })),
      wish.tasks.length > 0
        ? createElement('div', { className: 'xy-wishtasks' }, ...wishTasks(wish))
        : createElement('div', { className: 'xy-meta' }, t('wish.noTasks')))

  return createElement('div', { className: 'xy-page', ref: stabilize },
    createElement('div', { className: 'xy-page-head' },
      createElement('h2', { className: 'xy-page-title' }, t('wish.pageTitle')),
      createElement('span', { className: 'xy-meta' }, t('wish.summary', {
        active: active.length,
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
          createElement(WishQuickForm, { onCreated: () => void page.reload() }))
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
