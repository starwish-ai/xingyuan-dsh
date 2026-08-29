/** 任务页：全量清单（进行中/待领取/已完结）+ 行内详情聚合 + 快速新建。 */
import { createElement, useState, type ReactElement } from 'react'
import { useXyT, type XyKey } from '../i18n.js'
import { usePageData, useScrollTopOnMount, useStableScrollbar } from '../hooks.js'
import { getViewState, setViewState } from '../view-state.js'
import { PageEmpty, PageError, PageSkeleton, StaleBanner } from '../ui.js'
import { TaskLine } from './task-line.js'
import { DetailToggle, TaskDetailPanel } from './detail.js'
import { TaskQuickForm } from './quick-create.js'
import type { ApiTask, TasksPayload } from './types.js'

export function TasksPage(): ReactElement {
  const t = useXyT()
  const stabilize = useStableScrollbar()
  useScrollTopOnMount()
  const page = usePageData<TasksPayload>('/xingyuan/api/tasks')
  const [showCreate, setShowCreate] = useState(false)
  // 展开的详情集合跨标签切换保留（view-state 快照）
  const [expanded, setExpandedRaw] = useState<ReadonlySet<string>>(() => getViewState<ReadonlySet<string>>('tasks.expanded', new Set()))
  const setExpanded = (next: ReadonlySet<string>): void => { setViewState('tasks.expanded', next); setExpandedRaw(next) }
  const toggleDetail = (taskId: string): void => {
    const next = new Set(expanded)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    setExpanded(next)
  }

  if (page.error !== undefined && page.data === undefined) return createElement(PageError, { message: page.error, onRetry: () => void page.reload() })
  const data = page.data
  if (data === undefined) return createElement(PageSkeleton)

  // 服务端已按 进行中→待领取→已完结 排序（byDisplayOrder）；这里按状态分桶渲染。
  // 已完结再按 closedReason 细分「已达成/已过期」：过期是失败态、达成是成就态，
  // 混在一组里用户无法分辨任务是被完成还是被截止日杀死（复活入口挂在过期详情面板）。
  const sections: ReadonlyArray<{
    readonly key: XyKey
    readonly dot: string
    readonly match: (task: ApiTask) => boolean
  }> = [
    { key: 'task.group.in_progress', dot: 'xy-group-dot-accent', match: (task) => task.status === 'in_progress' },
    { key: 'task.group.pending', dot: 'xy-group-dot-warn', match: (task) => task.status === 'pending' },
    { key: 'task.group.achieved', dot: 'xy-group-dot-ok', match: (task) => task.status === 'closed' && task.closedReason !== 'expired' },
    { key: 'task.group.expired', dot: 'xy-group-dot-warn', match: (task) => task.status === 'closed' && task.closedReason === 'expired' },
  ]
  const visibleSections = sections
    .map((section) => ({ ...section, tasks: data.tasks.filter(section.match) }))
    .filter((section) => section.tasks.length > 0)

  /** 单个任务块：两栏行（名称/元信息居左、动作右置）+ 可选内联详情，同一 row 承担分隔线语义。 */
  const taskRow = (task: ApiTask): ReactElement =>
    createElement('div', { key: task.taskId, className: 'xy-grouprow xy-taskrow' },
      createElement(TaskLine, {
        task,
        today: data.today,
        onChanged: page.reload,
        // 任务页按状态分桶：领取使行迁移组别，领取后焦点交页面标题兜底
        focusAfterClaim: true,
        trailing: createElement(DetailToggle, {
          open: expanded.has(task.taskId),
          onToggle: () => toggleDetail(task.taskId),
          controlsId: `xy-task-detail-${task.taskId}`,
        }),
      }),
      expanded.has(task.taskId)
        ? createElement(TaskDetailPanel, { id: `xy-task-detail-${task.taskId}`, taskId: task.taskId, today: data.today, onChanged: page.reload })
        : null)

  return createElement('div', { className: 'xy-page', ref: stabilize },
    page.error !== undefined ? createElement(StaleBanner, { onRetry: () => void page.reload() }) : null,
    createElement('div', { className: 'xy-page-head' },
      createElement('h2', { className: 'xy-page-title' }, t('task.pageTitle')),
      createElement('span', { className: 'xy-meta' }, t('task.totalCount', { n: data.tasks.length })),
      // 动作组整体右置（与愿望页同一头部语法）
      createElement('div', { className: 'xy-page-actions' },
        createElement('button', {
          className: 'xy-btn',
          'aria-expanded': showCreate,
          'aria-controls': 'xy-tasks-create',
          onClick: () => setShowCreate(!showCreate),
        }, t('action.createTask')))),
    showCreate
      ? createElement('div', { id: 'xy-tasks-create' },
          // 传入既有任务名做同名软确认兜底（对话侧创建前有 check_similar_tasks 查重）
          createElement(TaskQuickForm, { today: data.today, onCreated: () => void page.reload(), existingNames: data.tasks.map((task) => task.name) }))
      : null,
    data.tasks.length === 0 && !showCreate
      ? createElement(PageEmpty, { title: t('task.empty.title'), hint: t('task.empty.hint') })
      : visibleSections.map((section) => createElement('section', { key: section.key, className: 'xy-group' },
          createElement('h3', { className: 'xy-group-head' },
            createElement('span', { className: `xy-group-dot ${section.dot}`, 'aria-hidden': 'true' }),
            createElement('span', null, t(section.key)),
            createElement('span', { className: 'xy-group-count' }, String(section.tasks.length))),
          createElement('div', { className: 'xy-grouplist' }, section.tasks.map(taskRow)))))
}
