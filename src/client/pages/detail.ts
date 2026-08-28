/**
 * 任务详情聚合视图：行内展开——打卡记录网格（截至今天的机会日末段 + 预勾）、
 * 接下来机会日、微行动进度、状态机操作栏（领取/打卡/取消打卡/删除）与「让 AI 总结」降级入口。
 * 数据经 GET /xingyuan/api/task-detail；动作直连 POST（用户点击即本人授权），动作后原位刷新
 * 详情并回调上层列表刷新。
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { getJson, postAction } from '../api.js'
import { useXyT, t as translate, activeLocale, type XyT } from '../i18n.js'
import { localYmd, softConfirm, softConfirmDanger, useActionGuard } from '../hooks.js'
import { toast } from '../ui.js'
import { dateSuffix, formatShortDate } from './format.js'
import type { ApiTask } from './types.js'

/** /api/task-detail 响应叶子形状。 */
interface TaskDetailPayload {
  readonly task: ApiTask
  readonly grid: ReadonlyArray<{ readonly date: string; readonly state: 'checked' | 'missed' | 'future' }>
  readonly upcoming: ReadonlyArray<string>
  readonly micro?: {
    readonly steps: ReadonlyArray<{ readonly stepNumber: number; readonly instruction: string; readonly completed: boolean; readonly skipped: boolean }>
    readonly currentStepNumber: number | null
  }
}

/** 「让 AI 总结」提示词：触发者是人、产物直接可见，模板随界面语言切换（与 prompts.ts 总结分析模式同一结构诉求）。 */
function summaryPrompt(taskName: string): string {
  return activeLocale() === 'en'
    ? `Please summarize the task "${taskName}": current status, highlights, obstacles, action suggestions for the next 7 days, and measurable metrics. Query the data with tools before answering.`
    : `请对任务「${taskName}」做一次总结分析：现状、亮点、阻碍、未来7天行动建议、量化指标。数据请先用工具查询后再回答。`
}

async function copySummaryPrompt(taskName: string): Promise<void> {
  const text = summaryPrompt(taskName)
  try {
    await navigator.clipboard.writeText(text)
    toast(translate('detail.askAi.copied'), 'ok')
  } catch {
    toast(translate('detail.askAi.manual'), 'info')
  }
}

/** 展开开关按钮（嵌在 TaskLine trailing 槽）；controlsId 关联详情面板（aria-controls）。 */
export function DetailToggle(props: { open: boolean; onToggle: () => void; controlsId?: string }): ReactElement {
  const t = useXyT()
  return createElement('button', {
    className: 'xy-btn xy-btn-inline',
    'aria-expanded': props.open,
    ...(props.controlsId !== undefined ? { 'aria-controls': props.controlsId } : {}),
    onClick: props.onToggle,
  }, props.open ? t('action.collapse') : t('action.expand'))
}

/** 'yyyy-MM-dd' → 周一为 0 的星期序号（与日历页表头「一..日」同构）；解析失败回落 0。 */
function weekdayMon0(ymd: string): number {
  const date = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8)), 12)
  return Number.isNaN(date.getTime()) ? 0 : (date.getDay() + 6) % 7
}

/**
 * 撤销目标=网格内最近一条打卡（含未来预勾）。必须由客户端解析出具体日期并随请求显式携带：
 * 服务端「不传日期=撤最近一次」的隐式口径下，弹框文案无法与实际撤销对象同源
 * （今天已打卡 + 未来预勾并存时，弹框说撤今天、实际撤掉的是预勾日）。
 */
export function latestCheckedDate(grid: ReadonlyArray<{ readonly date: string; readonly state: string }>): string | undefined {
  let latest: string | undefined
  for (const cell of grid) {
    if (cell.state !== 'checked') continue
    if (latest === undefined || cell.date > latest) latest = cell.date
  }
  return latest
}

/**
 * 任务详情面板：expanded 由调用方持有（TaskLine trailing 放 DetailToggle）。
 * today 缺省取本地日期；onChanged 在任何写动作成功后回调（供列表 reload，
 * 返回 Promise 时 busy 窗口延伸到上层刷新完成）。id 供 aria-controls 关联。
 */
export function TaskDetailPanel(props: { taskId: string; today?: string; onChanged: () => void | Promise<void>; id?: string }): ReactElement | null {
  const t = useXyT()
  const [detail, setDetail] = useState<TaskDetailPayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const { busy, guard } = useActionGuard()

  /** 取详情的 Promise 形态：act 里用于把 busy 窗口延伸到刷新完成。 */
  const fetchDetail = (): Promise<void> => {
    setError(undefined)
    return getJson<TaskDetailPayload>(`/xingyuan/api/task-detail?taskId=${encodeURIComponent(props.taskId)}`)
      .then((payload) => setDetail(payload))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
  }
  // useEffect 回调只能返回 void/清理函数——这里包掉 Promise
  const load = (): void => {
    setLoading(true)
    void fetchDetail().finally(() => setLoading(false))
  }
  useEffect(load, [props.taskId])

  const act = (action: string, body: Record<string, unknown>, doneText: () => string): void => {
    // 删除任务成功后详情必然 404：跳过回取，仅回调上层刷新移除该行——
    // 否则父列表 reload 完成前会闪现「加载失败 + 对死任务的重试」
    const skipDetailRefetch = action === 'delete-task'
    guard(() => postAction(action, body).then(() => {
      toast(doneText(), 'ok')
      if (skipDetailRefetch) return Promise.resolve(props.onChanged()).then(() => undefined)
      return Promise.all([fetchDetail(), Promise.resolve(props.onChanged())]).then(() => undefined)
    }))
  }

  if (loading && detail === undefined) {
    // 拾取式骨架行：占位高度恒定，展开瞬间不跳版；aria-busy 对读屏声明进行中
    return createElement('div', { className: 'xy-detail', id: props.id, 'aria-busy': 'true' },
      createElement('div', { className: 'xy-skel xy-pickline', role: 'status' },
        createElement('span', { className: 'xy-visually-hidden' }, t('detail.loading'))))
  }
  if (error !== undefined) {
    return createElement('div', { className: 'xy-detail', id: props.id },
      createElement('div', { className: 'xy-field-err' }, t('detail.loadFailed', { error })),
      createElement('button', { className: 'xy-btn', onClick: load }, t('common.retry')))
  }
  if (detail === undefined) return null

  const today = props.today ?? localYmd(new Date())
  const task = detail.task
  // 撤销目标=最近一条打卡（含预勾）；只要有打卡记录撤销入口就可达（预勾也能在详情页撤销）
  const undoTarget = latestCheckedDate(detail.grid)

  // 网格可访问性：28 格逐格播报是读屏灾难——格子 aria-hidden，整体以一条
  // 汇总 aria-label 暴露（role=img），逐日细节保留 title 供鼠标悬停。
  // 视觉按周对齐（周一始，GitHub/Streaks 惯例）：首行前置隐形占位，今日格加 accent 环，
  // 连续坚持一眼可读；换月错位不再出现流式换行的参差断行。
  // 服务端窗口恒 ≤28（GRID_DATES_LIMIT，§5.10 口径）——此处不再重复截尾，避免双份常量漂移
  const recent = detail.grid
  const gridCells = [
    ...Array.from({ length: recent.length > 0 ? weekdayMon0(recent[0]!.date) : 0 }, (_, i) =>
      createElement('span', { key: `pad-${i}`, className: 'xy-dcell xy-dcell-blank', 'aria-hidden': 'true' })),
    ...recent.map((cell) => {
      const label = cell.state === 'checked'
        ? t('detail.grid.checked', { date: cell.date })
        : cell.state === 'missed'
          ? t('detail.grid.missed', { date: cell.date })
          : t('detail.grid.future', { date: cell.date })
      const tone = cell.state === 'checked' ? 'xy-dcell-checked' : cell.state === 'future' ? 'xy-dcell-future' : 'xy-dcell-missed'
      return createElement('span', {
        key: cell.date,
        className: `xy-dcell ${tone}${cell.date === today ? ' xy-dcell-today' : ''}`,
        title: label,
        'aria-hidden': 'true',
      }, String(Number(cell.date.slice(8))))
    }),
  ]
  const gridSummary = ((): string => {
    const checked = recent.filter((c) => c.state === 'checked').length
    const missed = recent.filter((c) => c.state === 'missed').length
    const future = recent.length - checked - missed
    return t('detail.grid.summary', { total: recent.length, checked, missed, future })
  })()

  // 当前步说明缺失时不产出悬挂的「 · 」（找不到对应步或空说明都整段省略）
  const micro = detail.micro
  let microTail = ''
  if (micro !== undefined && micro.currentStepNumber !== null) {
    const current = micro.steps.find((s) => s.stepNumber === micro.currentStepNumber)
    if (current !== undefined && current.instruction !== '') {
      microTail = ' · ' + t('detail.micro.stepN', {
        current: micro.currentStepNumber,
        total: micro.steps.length,
        instruction: current.instruction,
      })
    }
  }
  const microBlock = detail.micro === undefined
    ? createElement('span', { className: 'xy-meta' }, t('detail.micro.idle'))
    : createElement('span', { className: 'xy-meta' },
        t('detail.micro.done', {
          done: detail.micro.steps.filter((s) => s.completed).length,
          total: detail.micro.steps.length,
        }),
        microTail)

  // 操作区单行成组：主操作（打卡/领取）→ 条件动作（取消打卡）→ 辅助（让 AI 总结）→ 危险（删除）。
  // 删除跟随行流并靠 danger 描边区分（确认弹窗兜底防误触）；不再 margin-left:auto 漂到卡缘——
  // 愿望卡里会与卡头的愿望级删除同侧对齐造成语义混淆，窄面板里则是一段突兀的空白。
  const ops: ReactElement[] = []
  if (task.status === 'pending') {
    ops.push(createElement('button', {
      key: 'claim', className: 'xy-btn', disabled: busy,
      onClick: () => act('claim', { taskId: task.taskId }, () => translate('toast.claimed', { name: task.name })),
    }, t('action.claim')))
  }
  if (task.status === 'in_progress') {
    ops.push(createElement('button', {
      key: 'checkin', className: 'xy-btn xy-btn-primary', disabled: busy,
      onClick: () => {
        const future = task.nextOpportunityDate !== undefined && task.nextOpportunityDate > today ? task.nextOpportunityDate : undefined
        const submit = (): void => act('checkin', { taskId: task.taskId }, () =>
          // 与今日页/日历/任务行同口径：toast 带实际勾选日期（预勾时不是今天）
          translate('toast.checkinOk') + dateSuffix(future ?? today))
        if (future === undefined) { submit(); return }
        void softConfirm(translate('confirm.futureCheckin', { name: task.name, date: future })).then((ok) => { if (ok) submit() })
      },
    }, t('action.checkin')))
  }
  if (undoTarget !== undefined) {
    ops.push(createElement('button', {
      key: 'cancel', className: 'xy-btn', disabled: busy,
      // 读屏标签携带目标日期：不开确认弹窗即知将撤销哪一天（含预勾场景）
      'aria-label': t('action.cancelCheckinAria', { date: formatShortDate(undoTarget) }),
      onClick: () => {
        // 日期显式随请求携带，弹框/toast 与实际撤销对象同源；确认文案保留 ISO（§5.10 口径）
        const message = undoTarget === today
          ? translate('confirm.undoToday', { name: task.name })
          : translate('confirm.undoAt', { name: task.name, date: undoTarget })
        void softConfirm(message).then((ok) => {
          if (ok) {
            act('cancel-checkin', { taskId: task.taskId, date: undoTarget },
              () => translate('toast.undoneAt', { date: formatShortDate(undoTarget) }))
          }
        })
      },
    }, t('action.cancelCheckin')))
  }
  ops.push(createElement('button', {
    key: 'askai',
    className: 'xy-btn',
    disabled: busy,
    onClick: () => void copySummaryPrompt(task.name),
  }, t('action.askAi')))
  ops.push(createElement('button', {
    key: 'delete', className: 'xy-btn xy-btn-danger', disabled: busy,
    onClick: () => {
      void softConfirmDanger(translate('confirm.deleteTask', { name: task.name })).then((ok) => {
        if (ok) act('delete-task', { taskId: task.taskId }, () => translate('toast.deleted', { name: task.name }))
      })
    },
  }, t('common.delete')))

  return createElement('div', { className: 'xy-detail', id: props.id },
    detail.grid.length > 0
      ? createElement('div', null,
          createElement('span', { className: 'xy-quick-label' }, t('detail.grid.title')),
          // 整块网格对读屏是一句话汇总；格子 aria-hidden，逐日细节走 title 悬停
          createElement('div', { className: 'xy-detail-grid', role: 'img', 'aria-label': gridSummary }, gridCells),
          createElement('div', { className: 'xy-legend' },
            createElement('span', null, createElement('i', { className: 'xy-dot xy-dcell-checked', 'aria-hidden': 'true' }), t('detail.legend.checked')),
            createElement('span', null, createElement('i', { className: 'xy-dot xy-dcell-missed', 'aria-hidden': 'true' }), t('detail.legend.missed')),
            createElement('span', null, createElement('i', { className: 'xy-dot xy-dcell-future', 'aria-hidden': 'true' }), t('detail.legend.future'))))
      : null,
    detail.upcoming.length > 0
      ? createElement('div', { className: 'xy-detail-next' },
          // 机会日列表与「提前打卡」按钮同一短格式口径（ISO 只留给确认文案与读屏）
          t('detail.next.title', {
            dates: detail.upcoming.map((d) => formatShortDate(d)).join(activeLocale() === 'en' ? ', ' : '、'),
          }))
      : null,
    createElement('div', null,
      createElement('span', { className: 'xy-quick-label' }, t('detail.micro.title')),
      microBlock),
    createElement('div', null,
      createElement('span', { className: 'xy-quick-label' }, t('detail.ops.title')),
      // 周期/进度元信息不再重复：TaskLine 行本身已展示同口径信息（cycle·duration·status·next·due）
      createElement('div', { className: 'xy-detail-ops' }, ...ops)))
}
