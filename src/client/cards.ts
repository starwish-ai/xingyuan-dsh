/**
 * 会话卡片渲染组件（愿望/任务/打卡/图表/微行动）。
 * 渲染器只读 node.data（whole-value 事件），不扫描事件窗口；可回放可分页。
 * 任务卡带内联领取/打卡动作（本地态防重复，服务端校验兜底）。
 * 文案经 useXyT()：语言切换由 locale revision 订阅驱动重渲（见 i18n.ts §方案）。
 */
import { createElement, useRef, useState, type ReactElement } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  type XingyuanChartEventData,
  type XingyuanCheckinEventData,
  type XingyuanMicroEventData,
  type XingyuanTaskEventData,
  type XingyuanWishEventData,
} from '../events.js'
import { postAction, ActionError, describeError } from './api.js'
import { toast, toastError } from './ui.js'
import { localYmd, softConfirm } from './hooks.js'
import { useXyT, t, activeLocale } from './i18n.js'
import { categoryVars } from '../category-color.js'
import { cycleLabel, durationText, dateSuffix, formatMediumDate, formatShortDate } from './pages/format.js'
import type { XyState } from './types.js'

/**
 * 卡片组件 props：剥掉壳注入的 'conversation' 命名空间 t 席位（本插件文案走 useXyT，
 * 键受查且随语言切换订阅刷新）；注册处不声明 locale，避免窄域 t 的类型冲突。
 */
type CardProps<Kind extends 'xy-wish' | 'xy-task' | 'xy-checkin' | 'xy-chart' | 'xy-micro'> =
  Omit<ChatNodeViewProps<Kind>, 't'>

function WishView(props: CardProps<'xy-wish'>): ReactElement {
  const t = useXyT()
  const wish = (props.node.data as XyState).data as XingyuanWishEventData
  const deleted = wish.op === 'deleted'
  return createElement('div', { className: `xy-card ${deleted ? 'xy-deleted' : ''}` },
    createElement('div', { className: 'xy-card-head' },
      createElement('span', {
        className: 'xy-badge xy-badge-cat',
        style: categoryVars(wish.wish.colorKey, wish.wish.categoryName),
      }, t('badge.wish')),
      createElement('span', { className: 'xy-title' }, deleted ? t('state.deleted', { title: wish.wish.title }) : wish.wish.title)),
    // 已删除卡不再渲染活体进度（删除态 × 进度百分比自相矛盾）
    createElement('div', { className: 'xy-meta' }, deleted
      ? wish.wish.categoryName
      : `${wish.wish.categoryName} · ${t('wish.progress', { percent: wish.wish.progress })}`))
}

function TaskView(props: CardProps<'xy-task'>): ReactElement {
  const t = useXyT()
  const event = (props.node.data as XyState).data as XingyuanTaskEventData
  const task = event.task
  // 内联动作（对齐 Web 聊天卡领取/打卡）：点击即本人授权，本地态防重复，服务端仍校验兜底。
  // 状态机对齐 Web markCardActioned：领取 → 原地转为可打卡；打卡 → 定格「已完成（日期）」。
  const [phase, setPhase] = useState<'idle' | 'claimed' | 'done'>('idle')
  const [doneDate, setDoneDate] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // 同帧双击守卫：渲染态 busy 在同一事件循环内读不到新值，与页面侧
  // useActionGuard 的 busyRef 对齐（服务端去重兜底，这里保证不发多余请求）
  const busyRef = useRef(false)
  const run = (action: 'claim' | 'checkin'): void => {
    if (busyRef.current || phase === 'done') return
    const future = task.nextOpportunityDate !== undefined && task.nextOpportunityDate > localYmd(new Date())
      ? task.nextOpportunityDate
      : undefined
    const perform = (): void => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      postAction(action, { taskId: task.taskId })
        .then((payload) => {
          if (action === 'claim') {
            setPhase('claimed')
            toast(t('toast.claimed', { name: task.name }), 'ok')
          } else {
            setPhase('done')
            setDoneDate(typeof payload.date === 'string' ? payload.date : undefined)
            toast(t('toast.checkinOk') + dateSuffix(typeof payload.date === 'string' ? payload.date : undefined), 'ok')
          }
        })
        .catch((e: unknown) => {
          // 会话重放后本地态丢失，服务端状态是事实：按稳定错误码恢复卡片到真实阶段
          //（store.ToolError 携带 code 经路由透传；文案按 code 本地化，不依赖中文子串）
          if (e instanceof ActionError) {
            if (action === 'claim' && e.code === 'already_claimed') {
              setPhase('claimed')
              toast(describeError(e), 'info')
              return
            }
            if (action === 'checkin' && (e.code === 'already_checked' || e.code === 'task_closed')) {
              setPhase('done')
              setDoneDate(typeof e.params?.date === 'string' ? e.params.date : undefined)
              toast(describeError(e), 'info')
              return
            }
          }
          toastError(e)
        })
        .finally(() => {
          busyRef.current = false
          setBusy(false)
        })
    }
    if (action === 'checkin' && future !== undefined) {
      // 未来机会日预勾：应用内确认「承诺当天完成」后再进入写路径
      void softConfirm(t('confirm.futureCheckin', { name: task.name, date: future })).then((ok) => { if (ok) perform() })
      return
    }
    perform()
  }
  const deleted = event.op === 'deleted'
  const showClaim = !deleted && phase === 'idle' && task.status === 'pending'
  const showCheckIn = !deleted && phase !== 'done' && (task.status === 'in_progress' || phase === 'claimed')
  const preview = event.opportunityPreview.length > 0
    ? t('task.upcoming', { dates: event.opportunityPreview.map((date) => formatShortDate(date)).join(activeLocale() === 'en' ? ', ' : '、') })
    : undefined
  return createElement('div', { className: `xy-card ${deleted ? 'xy-deleted' : ''}` },
    createElement('div', { className: 'xy-card-head' },
      createElement('span', { className: 'xy-badge xy-badge-task' }, t('badge.task')),
      createElement('span', { className: 'xy-title' }, deleted ? t('state.deleted', { title: task.name }) : task.name),
      !deleted && phase === 'done'
        ? createElement('span', { className: 'xy-meta xy-actioned' },
            // 勾形装饰对读屏隐藏（语义由文案承担），与今日页行首勾同一语法
            createElement('span', { className: 'xy-done-glyph', 'aria-hidden': 'true' }, '✓'),
            t('state.done') + dateSuffix(doneDate))
        : null,
      showClaim
        ? createElement('button', { className: 'xy-btn xy-btn-inline', disabled: busy, onClick: () => run('claim') }, t('action.claim'))
        : null,
      showCheckIn
        ? createElement('button', { className: 'xy-btn xy-btn-primary xy-btn-inline', disabled: busy, onClick: () => run('checkin') }, t('action.checkin'))
        : null),
    createElement('div', { className: 'xy-meta' },
      `${cycleLabel(task.checkInCycle)}${task.dueDate !== undefined ? ` · ${t('task.due', { date: formatShortDate(task.dueDate) })}` : ''} · ${durationText(task.completedDays, task.requiredDays)}`),
    deleted === false && preview !== undefined
      ? createElement('div', { className: 'xy-preview' }, preview)
      : null)
}

function MicroView(props: CardProps<'xy-micro'>): ReactElement {
  const t = useXyT()
  const event = (props.node.data as XyState).data as XingyuanMicroEventData
  const cleared = event.op === 'restarted'
  const finished = event.op === 'finished' || event.currentStepNumber === null
  const doneCount = event.steps.filter((s) => s.completed).length
  return createElement('div', { className: 'xy-card xy-micro' },
    createElement('div', { className: 'xy-card-head' },
      createElement('span', { className: 'xy-badge xy-badge-micro' }, t('badge.micro')),
      createElement('span', { className: 'xy-title' },
        cleared ? t('micro.cleared', { task: event.taskName })
          : finished ? t('micro.finished', { task: event.taskName })
          : t('micro.step', { task: event.taskName, current: event.currentStepNumber ?? 0, total: event.steps.length }))),
    cleared
      ? null
      : createElement('ol', { className: 'xy-microsteps' },
          ...event.steps.map((step) => createElement('li', {
            key: step.stepNumber,
            className: `xy-microstep${step.completed ? ' xy-done' : step.skipped ? ' xy-skipped' : ''}`,
          },
            createElement('span', { className: 'xy-microstepnum' }, String(step.stepNumber)),
            createElement('span', { className: 'xy-microsteptext' },
              step.instruction,
              step.rationale !== undefined ? createElement('span', { className: 'xy-meta' }, step.rationale) : null),
            step.completed
              ? createElement('span', { className: 'xy-meta xy-microstate xy-glyph xy-glyph-ok' }, '✓')
              : step.skipped
                ? createElement('span', { className: 'xy-meta xy-microstate' }, t('micro.state.skipped'))
                : step.stepNumber === event.currentStepNumber
                  ? createElement('span', { className: 'xy-meta xy-microstate' }, t('micro.state.current'))
                  : null)),
    ),
    // 进度行置于 <ol> 之外：列表语义只允许 li 子元素，进度属卡片级信息
    !cleared && !finished
      ? createElement('div', { className: 'xy-meta' }, t('micro.progress', { done: doneCount, total: event.steps.length }))
      : null)
}

function CheckinView(props: CardProps<'xy-checkin'>): ReactElement {
  const t = useXyT()
  const event = (props.node.data as XyState).data as XingyuanCheckinEventData
  const cancelled = event.op === 'cancelled'
  return createElement('div', { className: 'xy-card xy-checkin' },
    createElement('div', { className: 'xy-card-head' },
      createElement('span', { className: `xy-glyph ${cancelled ? 'xy-glyph-back' : 'xy-glyph-ok'}`, 'aria-hidden': 'true' }, cancelled ? '↩' : '✓'),
      createElement('span', { className: 'xy-title' },
        cancelled
          ? t('checkin.cancelled', { task: event.taskName, date: formatShortDate(event.date) })
          : t('checkin.success', { task: event.taskName }))),
    createElement('div', { className: 'xy-meta' },
      `${formatShortDate(event.date)}${event.wishName !== undefined ? ` · ${event.wishName}` : ''} · ${durationText(event.completedDays, event.requiredDays)}`))
}

function ChartView(props: CardProps<'xy-chart'>): ReactElement {
  const t = useXyT()
  const event = (props.node.data as XyState).data as XingyuanChartEventData
  // 悬停柱下标（与成长页悬浮明细同一交互语法；null = 未悬停）
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  return createElement('div', { className: 'xy-card xy-chart' },
    createElement('div', { className: 'xy-card-head' },
      createElement('span', { className: 'xy-badge xy-badge-chart' }, t('badge.chart')),
      createElement('span', { className: 'xy-title' }, event.title),
      event.subtitle !== undefined ? createElement('span', { className: 'xy-meta' }, event.subtitle) : null),
    // 快照时点标注（事件溯源：卡片=当时的事实）：无 generatedAt 的旧事件诚实降级不显示。
    // 中格式带年份——回放的旧卡可能跨年，「生成于 3月5日」须能定位到哪一年。
    // ISO → 本地日再格式化：直接 slice 会把 UTC 日期当本地日（UTC+8 零点后 8 小时内差一天）
    event.generatedAt !== undefined
      ? createElement('div', { className: 'xy-meta' }, t('chart.generatedAt', { date: formatMediumDate(localYmd(new Date(event.generatedAt))) }))
      : null,
    chartBody(event, t('chart.noData'), t('chart.noSchedule'), hoverIdx, setHoverIdx))
}

/** 图表卡主体：四类渲染路径（占比条/占比列表/热力格/柱图）颜色全部走主题变量，深浅色自适应。 */
function chartBody(
  event: XingyuanChartEventData,
  noDataText: string,
  noScheduleText: string,
  hoverIdx: number | null,
  onHover: (idx: number | null) => void,
): ReactElement {
  const { chartType, data } = event
  if (data.length === 0) return createElement('div', { className: 'xy-meta' }, noDataText)
  const max = Math.max(...data.filter((d) => !d.inactive).map((d) => d.value), 1)
  const labelValue = (d: XingyuanChartEventData['data'][number]): string =>
    `${d.label}${activeLocale() === 'en' ? ': ' : '：'}${d.inactive === true ? noScheduleText : d.value}`
  if (chartType === 'arcbars') {
    const ratio = Math.min(Math.max(data[0]!.ratio ?? 0, 0), 1)
    return createElement('div', { className: 'xy-arcwrap' },
      createElement('div', { className: 'xy-arcnum' }, `${Math.round(ratio * 100)}%`),
      // 进度条填充走 transform（合成器动画，不触发布局），与全站进度条同一实现
      createElement('div', { className: 'xy-bar' },
        createElement('div', { className: 'xy-bar-fill', style: { transform: `scaleX(${ratio})` } })))
  }
  if (chartType === 'pie' || chartType === 'radar') {
    // 占比分母守卫：总和为 0 时跳过百分比（避免 NaN%）
    const sum = data.reduce((s, x) => s + x.value, 0)
    return createElement('ul', { className: 'xy-rows' },
      ...data.map((d, i) => createElement('li', { key: i, className: 'xy-row' },
        createElement('span', null, d.label),
        createElement('span', { className: 'xy-rowval' },
          `${d.value}${chartType === 'pie' && sum > 0 ? ` · ${Math.round((d.value / sum) * 100)}%` : ''}`))))
  }
  if (chartType === 'heatmap') {
    return createElement('div', null,
      createElement('div', { className: 'xy-heat', 'aria-hidden': 'true' },
        ...data.map((d, i) => createElement('span', {
          key: i,
          className: 'xy-heatcell',
          title: labelValue(d),
          style: { opacity: String(0.25 + 0.75 * (d.value / max)) },
        }))),
      // 热力格纯视觉（title 不构成可访问名）：数据以屏内隐藏文本整体提供给读屏
      createElement('span', { className: 'xy-visually-hidden' },
        data.map((d) => `${d.label} ${d.value}`).join(activeLocale() === 'en' ? '; ' : '；')))
  }
  const seriesList = [...new Set(data.map((d) => d.series).filter((s): s is string => s !== undefined))]
  const seriesColor = (index: number): string =>
    index <= 0 ? 'var(--xyd-accent)' : 'var(--dsw-alias-label-secondary)'
  const width = 560
  const height = 140
  const step = width / Math.max(data.length, 1)
  // 只圆顶不圆底：柱脚与基线齐平（rect 的 rx 会四角全圆，悬空感）
  const topRoundedBar = (x: number, y: number, w: number, h: number): string => {
    const r = Math.min(2, h, w / 2)
    return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`
  }
  const bars = data.flatMap((d, i) => {
    // 无安排日不画柱（缺失≠0）：空槽由下标占位保留，柱序与日期轴不塌缩
    if (d.inactive === true) return []
    // 微值可见性下限：有值但按比例不足 2px 的柱给 2px，避免「有数据却看不见」
    const rawH = Math.round((d.value / max) * (height - 24))
    const h = d.value > 0 ? Math.max(rawH, 2) : rawH
    const seriesIdx = d.series !== undefined ? seriesList.indexOf(d.series) : -1
    return [createElement('path', {
      key: i,
      d: topRoundedBar(i * step + 2, height - 18 - h, Math.max(step - 4, 2), h),
      style: { fill: seriesIdx > 0 ? seriesColor(seriesIdx) : 'var(--xyd-accent)', opacity: seriesIdx > 0 ? 0.55 : 0.85 },
      onMouseEnter: () => onHover(i),
    },
      // 每根柱子带 <title>：原生悬停提示；精确数值另由上方悬浮明细条实时呈现
      createElement('title', null, labelValue(d)))]
  })
  // 标签用原始下标定位：indexOf 会把重复标签（如分组系列的「周一」×2）全部钉到首个位置
  const labelStep = data.length <= 10 ? 1 : Math.ceil(data.length / 8)
  const labels = data
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % labelStep === 0)
    .map(({ d, i }) => createElement('text', {
      key: `l${i}`, x: i * step + step / 2, y: height - 4,
      fontSize: 11, textAnchor: 'middle', style: { fill: 'var(--dsw-alias-label-secondary)' },
    }, d.label))
  const legend = seriesList.length > 1
    ? createElement('div', { className: 'xy-chart-legend' },
        ...seriesList.map((name, idx) => createElement('span', { key: name },
          createElement('i', { className: 'xy-dot', style: { background: seriesColor(idx), opacity: idx > 0 ? 0.55 : 1 } }), name)))
    : null
  const hovered = hoverIdx !== null ? data[hoverIdx] : undefined
  return createElement('div', null,
    legend,
    createElement('div', { onMouseLeave: () => onHover(null) },
      // 悬浮明细条：与成长页柱图同一组件语法（恒定占位，无数据时隐藏不跳版）
      createElement('div', { className: 'xy-tip', role: 'status' },
        hovered !== undefined ? labelValue(hovered) : ''),
      // 图表整体作为一张图暴露给读屏；逐条数值以屏内隐藏文本补充
      createElement('svg', {
        viewBox: `0 0 ${width} ${height}`, className: 'xy-svg',
        role: 'img', 'aria-label': event.title,
      },
        createElement('line', { x1: 0, y1: height - 18, x2: width, y2: height - 18, style: { stroke: 'var(--dsw-alias-border-l2)' } }),
        ...bars,
        ...labels)),
    createElement('span', { className: 'xy-visually-hidden' },
      data.map((d) => `${d.label} ${d.inactive === true ? noScheduleText : d.value}`).join(activeLocale() === 'en' ? '; ' : '；')))
}

export const CARD_VIEWS = {
  WishView,
  TaskView,
  CheckinView,
  ChartView,
  MicroView,
}
