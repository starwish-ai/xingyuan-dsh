/** 任务页：全量清单（进行中/待领取/已完结）+ 行内详情聚合 + 快速新建。 */
import { createElement, useState, type ReactElement } from 'react'
import { useXyT } from '../i18n.js'
import { usePageData, useStableScrollbar } from '../hooks.js'
import { PageEmpty, PageError, PageSkeleton } from '../ui.js'
import { TaskLine } from './task-line.js'
import { DetailToggle, TaskDetailPanel } from './detail.js'
import { TaskQuickForm } from './quick-create.js'
import type { ApiTask, TasksPayload } from './types.js'

export function TasksPage(): ReactElement {
  const t = useXyT()
  const stabilize = useStableScrollbar()
  const page = usePageData<TasksPayload>('/xingyuan/api/tasks')
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
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

  // 服务端已按 进行中→待领取→已完结 排序（byDisplayOrder）；这里按状态分桶渲染
  const groups: ReadonlyArray<{ readonly status: ApiTask['status']; readonly key: 'task.group.in_progress' | 'task.group.pending' | 'task.group.closed' }> = [
    { status: 'in_progress', key: 'task.group.in_progress' },
    { status: 'pending', key: 'task.group.pending' },
    { status: 'closed', key: 'task.group.closed' },
  ]
  // 分组卡状态点：进行中=品牌蓝 / 待领取=琥珀 / 已完结=成功绿
  const DOT_BY_STATUS: Record<ApiTask['status'], string> = {
    in_progress: 'xy-group-dot-accent',
    pending: 'xy-group-dot-warn',
    closed: 'xy-group-dot-ok',
  }
  const sections = groups
    .map((group) => ({ ...group, tasks: data.tasks.filter((task) => task.status === group.status) }))
    .filter((section) => section.tasks.length > 0)

  /** 单个任务块：两栏行（名称/元信息居左、动作右置）+ 可选内联详情，同一 row 承担分隔线语义。 */
  const taskRow = (task: ApiTask): ReactElement =>
    createElement('div', { key: task.taskId, className: 'xy-grouprow xy-taskrow' },
      createElement(TaskLine, {
        task,
        today: data.today,
        onChanged: page.reload,
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
          createElement(TaskQuickForm, { today: data.today, onCreated: () => void page.reload() }))
      : null,
    data.tasks.length === 0 && !showCreate
      ? createElement(PageEmpty, { art: 'list', title: t('task.empty.title'), hint: t('task.empty.hint') })
      : sections.map((section) => createElement('section', { key: section.status, className: 'xy-group' },
          createElement('h3', { className: 'xy-group-head' },
            createElement('span', { className: `xy-group-dot ${DOT_BY_STATUS[section.status]}`, 'aria-hidden': 'true' }),
            createElement('span', null, t(section.key)),
            createElement('span', { className: 'xy-group-count' }, String(section.tasks.length))),
          createElement('div', { className: 'xy-grouplist' }, section.tasks.map(taskRow)))))
}
