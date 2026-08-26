/** 任务行（愿望页/任务页共用）：状态元信息 + 领取/打卡内联动作。 */
import { createElement, type ReactElement } from 'react'
import { postAction } from '../api.js'
import { toast } from '../ui.js'
import { useXyT } from '../i18n.js'
import { softConfirm, useActionGuard } from '../hooks.js'
import { cycleLabel, durationText, statusLabel, dateSuffix } from './format.js'
import type { ApiTask } from './types.js'

export function TaskLine(props: {
  task: ApiTask
  today: string
  /** 写成功后的上层刷新；返回 Promise 时 busy 窗口延伸到刷新完成。 */
  onChanged: () => void | Promise<void>
  /** 展开详情控件插槽（详情聚合视图 T1-1 接线点）。 */
  trailing?: ReactElement
}): ReactElement {
  const t = useXyT()
  const { task, today, onChanged, trailing } = props
  const { busy, guard } = useActionGuard()
  const act = (action: string, body: Record<string, unknown>, doneText?: (payload: Record<string, unknown>) => string): void => {
    guard(() => postAction(action, body).then((payload) => {
      if (doneText !== undefined) toast(doneText(payload), 'ok')
      return Promise.resolve(onChanged()).then(() => undefined)
    }))
  }
  // 未来机会日：预勾 = 承诺当天完成（与对话侧确认语义一致），按钮如实标注并二次确认
  const futureDate = task.nextOpportunityDate !== undefined && task.nextOpportunityDate > today ? task.nextOpportunityDate : undefined
  const checkIn = (): void => {
    if (futureDate !== undefined && !softConfirm(t('confirm.futureCheckin', { name: task.name, date: futureDate }))) return
    act('checkin', { taskId: task.taskId }, (p) =>
      t('toast.checkinOk') + dateSuffix(typeof p.date === 'string' ? String(p.date) : undefined))
  }
  return createElement('div', { className: 'xy-taskline' },
    createElement('span', { className: 'xy-taskname' }, task.name),
    createElement('span', { className: 'xy-meta' },
      `${cycleLabel(task.cycle)} · ${durationText(task.completedDays, task.requiredDays)} · ${statusLabel(task.status)}`
      + `${futureDate !== undefined ? ` · ${t('task.nextDate', { date: futureDate })}` : ''}`
      + `${task.dueDate !== undefined ? ` · ${t('task.due', { date: task.dueDate })}` : ''}`),
    createElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      task.status === 'pending'
        ? createElement('button', {
            className: 'xy-btn', disabled: busy,
            onClick: () => act('claim', { taskId: task.taskId }, () => t('toast.claimed', { name: task.name })),
          }, t('action.claim'))
        : task.status === 'in_progress'
          ? createElement('button', { className: 'xy-btn xy-btn-primary', disabled: busy, onClick: checkIn },
              futureDate !== undefined ? t('action.checkinFuture', { date: futureDate.slice(5) }) : t('action.checkin'))
          : null,
      trailing),
  )
}
