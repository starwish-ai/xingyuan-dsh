/** 任务行（愿望页/任务页共用）：状态元信息 + 领取/打卡内联动作。 */
import { createElement, type ReactElement } from 'react'
import { postAction } from '../api.js'
import { focusPageTitle, toast } from '../ui.js'
import { useXyT } from '../i18n.js'
import { softConfirm, useActionGuard } from '../hooks.js'
import { cycleLabel, durationText, closedStatusLabel, dateSuffix, formatShortDate } from './format.js'
import type { ApiTask } from './types.js'

export function TaskLine(props: {
  task: ApiTask
  today: string
  /** 写成功后的上层刷新；返回 Promise 时 busy 窗口延伸到刷新完成。 */
  onChanged: () => void | Promise<void>
  /** 展开详情控件插槽（TaskDetailPanel 接线点）。 */
  trailing?: ReactElement
  /** 领取后行会跨状态分组迁移的场景（任务页按状态分桶）置 true：原行 DOM 销毁、
   * 焦点落空，交给页面标题兜底。愿望卡内行原地复用 DOM，置 true 反而会把焦点
   * 无谓拽离（保持默认 false）。 */
  focusAfterClaim?: boolean
}): ReactElement {
  const t = useXyT()
  const { task, today, onChanged, trailing, focusAfterClaim } = props
  const { busy, guard } = useActionGuard()
  const act = (action: string, body: Record<string, unknown>, doneText?: (payload: Record<string, unknown>) => string): Promise<void> => {
    // 返回动作 promise（闭包捕获，与今日页同款）供调用方接续焦点移交
    let run: Promise<void> | undefined
    guard(() => {
      run = postAction(action, body).then((payload) => {
        if (doneText !== undefined) toast(doneText(payload), 'ok')
        return Promise.resolve(onChanged()).then(() => undefined)
      })
      return run
    })
    return run ?? Promise.resolve()
  }
  // 未来机会日：预勾 = 承诺当天完成（与对话侧确认语义一致），按钮如实标注并二次确认
  const futureDate = task.nextOpportunityDate !== undefined && task.nextOpportunityDate > today ? task.nextOpportunityDate : undefined
  const checkIn = (): void => {
    const submit = (): void => {
      // 一次打卡使任务完结时（任务页跨状态分组 / 愿望卡行迁入已完成），原按钮随
      // DOM 销毁、焦点落空——交给页面标题兜底；未完结的行原地复用 DOM，无需移动焦点
      // 镜像 isTaskDone 口径：requiredDays=0（无截止日不限次）任务永不关闭，
      // 打卡后行原地复用 DOM，不该把焦点拽离
      const closes = task.requiredDays > 0 && task.completedDays + 1 >= task.requiredDays
      void act('checkin', { taskId: task.taskId }, (p) =>
        t('toast.checkinOk') + dateSuffix(typeof p.date === 'string' ? String(p.date) : undefined))
        .then(() => { if (closes) focusPageTitle() }, () => {})
    }
    if (futureDate === undefined) { submit(); return }
    void softConfirm(t('confirm.futureCheckin', { name: task.name, date: futureDate })).then((ok) => { if (ok) submit() })
  }
  return createElement('div', { className: 'xy-taskline' },
    createElement('span', { className: 'xy-taskname' }, task.name),
    createElement('span', { className: 'xy-meta' },
      `${cycleLabel(task.cycle)} · ${durationText(task.completedDays, task.requiredDays)}`
      // 关闭态细分「已达成/已过期」（无旁证时保留状态词；进行中/待领取由按钮自解释）
      + `${task.status === 'closed' ? ` · ${closedStatusLabel(task)}` : ''}`
      // 近期行动日期走短格式（与「提前打卡」按钮同口径）；ISO 只留给确认文案与读屏
      + `${futureDate !== undefined ? ` · ${t('task.nextDate', { date: formatShortDate(futureDate) })}` : ''}`
      + `${task.dueDate !== undefined ? ` · ${t('task.due', { date: formatShortDate(task.dueDate) })}` : ''}`),
    createElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      task.status === 'pending'
        ? (task.dueDate !== undefined && task.dueDate < today
            // 截止日已过的待领取任务：写路径拒绝领取（claim_expired），行内给指引而非必失败按钮
            // （复活入口在展开详情的「延长截止日」行，与详情面板同口径）
            ? createElement('span', { className: 'xy-meta' }, t('task.claimExpiredHint'))
            : createElement('button', {
                className: 'xy-btn', disabled: busy,
                onClick: () => {
                  void act('claim', { taskId: task.taskId }, () => t('toast.claimed', { name: task.name }))
                    .then(() => { if (focusAfterClaim) focusPageTitle() }, () => {})
                },
              }, t('action.claim')))
        : task.status === 'in_progress'
          ? createElement('button', { className: 'xy-btn xy-btn-primary', disabled: busy, onClick: checkIn },
              futureDate !== undefined ? t('action.checkinFuture', { date: formatShortDate(futureDate) }) : t('action.checkin'))
          : null,
      trailing),
  )
}
