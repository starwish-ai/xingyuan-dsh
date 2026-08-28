/**
 * 星愿模型工具面：7 组工具（愿望/任务/打卡/记忆/配置/图表/汇总）。
 * 口径铁律：
 * - ID 引用纪律：ID 必须取列表返回的真实值，模糊指代先查列表定位；
 * - 部分更新原则：只传用户明确提及的字段，未提及不传、禁止编造；
 * - 内部工具禁提：【内部工具】描述约定原样迁移；
 * - 写确认：创建/打卡/取消打卡经 userQuestions 确认且可在设置关闭（confirmWrites）；删除（含批量）始终确认；教练风格与画像免确认；
 * - 业务事实：写操作成功即发 xingyuan/* 会话事件驱动卡片（可回放）；
 * - 周期提醒：harness schedule 仅一次性触发，原生 schedule_create 直接可用，
 *   差异在提示词指南中如实告知，不另造包装工具。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { XingyuanStore, WishRecord, TaskRecord } from '../domain.js'
import { COACH_STYLES } from '../domain.js'
import { CATEGORY_COLOR_KEYS } from '../category-color.js'
import { addDays, calculateOpportunityDates, findFirstUncheckedOpportunityDate, todayIso } from '../opportunity.js'
import type { XingyuanCheckinEventData, XingyuanMicroEventData, XingyuanTaskEventData, XingyuanWishEventData } from '../events.js'
import { confirmAction } from './hitl.js'
import { buildChart, CHART_KEYS, type ChartKey, type ChartParams } from './charts.js'
import { growthSummary } from '../growth.js'
import { MICRO_STEPS_MAX, MICRO_STEPS_MIN, completeMicroStep, restartMicroAction, startMicroAction } from '../micro.js'
import { removeTaskCompletely, removeWishCompletely } from '../cascade.js'
import {
  allMemories,
  anchorOf,
  cancelCheckIn,
  checkedDatesOf,
  claimTask,
  createTask,
  createWish,
  CYCLE_LABELS,
  freshTask,
  freshWish,
  performCheckIn,
  planForDay,
  planForRange,
  renameCategory,
  saveMemory,
  searchMemories,
  updateTask,
  updateWish,
  ToolError,
  validateEstimatedDate,
} from '../store.js'

export const inject = ['tools', 'xingyuan', 'userQuestions']

/** 工具配置：无硬编码可调参数。 */
export interface Config {
  /** 批量汇总返回上限（愿望）。 */
  batchWishLimit: number
  /** 批量汇总返回上限（任务）。 */
  batchTaskLimit: number
  /** 趋势类图表默认天数窗。 */
  chartTrendDays: number
  /** 分布类图表默认天数窗。 */
  chartDistributionDays: number
  /** 图表天数窗上限。 */
  chartMaxDays: number
  /** 排行/进度类默认返回条数。 */
  chartRankLimit: number
  /** 排行/进度类返回条数上限。 */
  chartRankMax: number
  /** 创建/取消打卡类写操作是否需要二次确认（默认 true；删除类始终确认）。 */
  confirmWrites: boolean
}

const STATUS_LABELS: Record<TaskRecord['status'], string> = {
  pending: '待领取',
  in_progress: '进行中',
  closed: '已完结',
}

const STYLE_LABELS: Record<(typeof COACH_STYLES)[number], string> = {
  gentle: '温柔型',
  strict: '严格型',
  humorous: '幽默型',
}

function cycleLabel(cycle: TaskRecord['checkInCycle']): string {
  return CYCLE_LABELS[cycle]
}

function statusLabel(status: TaskRecord['status']): string {
  return STATUS_LABELS[status]
}

function styleLabel(style: (typeof COACH_STYLES)[number]): string {
  return STYLE_LABELS[style]
}

function taskLine(task: TaskRecord): string {
  const due = task.dueDate ? `，截止 ${task.dueDate}` : ''
  const days = task.requiredDays > 0 ? `${task.completedDays}/${task.requiredDays} 天` : `${task.completedDays} 次`
  return `${task.name}（${cycleLabel(task.checkInCycle)}${due}，${days}）`
}

function wishSnapshot(wish: WishRecord): XingyuanWishEventData['wish'] {
  return {
    wishId: wish.wishId,
    title: wish.title,
    categoryName: wish.categoryName,
    ...(wish.colorKey ? { colorKey: wish.colorKey } : {}),
    ...(wish.description ? { description: wish.description } : {}),
    ...(wish.estimatedCompletionDate ? { estimatedCompletionDate: wish.estimatedCompletionDate } : {}),
    progress: wish.progress,
    totalRequiredDays: wish.totalRequiredDays,
    totalCompletedDays: wish.totalCompletedDays,
    createdAt: wish.createdAt,
  }
}

/** 未来机会日预览（≤5 个）。 */
function taskPreview(store: XingyuanStore, task: TaskRecord): string[] {
  return calculateOpportunityDates(anchorOf(task), task.dueDate, task.checkInCycle)
    .filter((date) => date >= todayIso())
    .slice(0, 5)
}

function taskSnapshot(store: XingyuanStore, task: TaskRecord): XingyuanTaskEventData['task'] {
  const checked = checkedDatesOf(store, task.taskId)
  const next = findFirstUncheckedOpportunityDate(anchorOf(task), task.dueDate, task.checkInCycle, checked, todayIso())
  return {
    taskId: task.taskId,
    ...(task.wishId ? { wishId: task.wishId } : {}),
    ...(task.wishId ? { wishName: store.domain.table('wishes').get(task.wishId)?.title } : {}),
    name: task.name,
    ...(task.hint ? { hint: task.hint } : {}),
    ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    checkInCycle: task.checkInCycle,
    status: task.status,
    requiredDays: task.requiredDays,
    completedDays: task.completedDays,
    ...(next ? { nextOpportunityDate: next } : {}),
    createdAt: task.createdAt,
  }
}

function emitWish(agent: Agent | undefined, op: XingyuanWishEventData['op'], wish: WishRecord): void {
  agent?.session.append('xingyuan/wish', { op, wish: wishSnapshot(wish) })
}

function emitTask(store: XingyuanStore, agent: Agent | undefined, op: XingyuanTaskEventData['op'], task: TaskRecord): void {
  agent?.session.append('xingyuan/task', {
    op,
    task: taskSnapshot(store, task),
    opportunityPreview: taskPreview(store, task),
  })
}

function emitCheckin(agent: Agent | undefined, store: XingyuanStore, event: Omit<XingyuanCheckinEventData, 'checkedAt'>): void {
  agent?.session.append('xingyuan/checkin', { ...event, checkedAt: new Date().toISOString() })
}

function emitMicro(agent: Agent | undefined, event: XingyuanMicroEventData): void {
  agent?.session.append('xingyuan/micro', event)
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
} as const

function clampInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  return Math.min(Math.max(Math.round(value), 1), max)
}

/** 按键取记录，缺失即抛模型可见的 ToolError（收口十余处 get→undefined→throw 样板）。 */
function requireWish(store: XingyuanStore, wishId: string): WishRecord {
  const wish = store.domain.table('wishes').get(wishId)
  if (wish === undefined) throw new ToolError(`愿望不存在：${wishId}`)
  return wish
}

function requireTask(store: XingyuanStore, taskId: string): TaskRecord {
  const task = store.domain.table('tasks').get(taskId)
  if (task === undefined) throw new ToolError(`任务不存在：${taskId}`)
  return task
}

/** 任务所属愿望标题（卡片/回包共用；无关联或愿望已删返回 undefined）。 */
function wishNameOf(store: XingyuanStore, task: TaskRecord): string | undefined {
  return task.wishId !== undefined ? store.domain.table('wishes').get(task.wishId)?.title : undefined
}

/**
 * 写操作的模型侧提示文案（拼进工具 description）。
 *
 * 两类不可混用：
 * - `DELETE_NOTE`：删除类**始终**弹确认卡，不受设置开关影响，故可以断言「会弹卡」。
 * - `CREATE_NOTE` / `CANCEL_CHECKIN_NOTE`：受「写操作二次确认」开关门控（见
 *   `confirmGate`），而工具描述是注册时烘焙的静态字符串——dsh-tools 校验
 *   `description` 必须是 string（不支持 getter），改设置也不会重建描述。故这两条
 *   一律写成「开与关都成立」的措辞：绝不可断言会弹卡，否则关掉开关后模型会向用户
 *   宣称已弹出确认卡，而实际没有卡片。
 */
const DELETE_NOTE = '删除不可恢复：会弹出系统确认卡片，直接调用等待确认结果即可，无需事先询问用户。'
const CREATE_NOTE = '无需事先询问用户，直接调用即可；结果返回前不要宣称已创建。若系统弹出确认卡片且用户在卡片上取消，则向用户说明并询问要调整的地方。'
const CANCEL_CHECKIN_NOTE = '无需事先询问用户，直接调用即可；结果返回前不要宣称已取消。'

/** 分类颜色白名单（schema enum 与展示色共用同一事实源）。 */
const COLOR_KEY_ENUM: readonly string[] = CATEGORY_COLOR_KEYS
const COLOR_KEY_NOTE = `可选值：${CATEGORY_COLOR_KEYS.join('/')}（不传则按分类名自动配色）`

/** 创建/取消类写操作的确认门闩：设置可关；删除类始终确认（破坏性操作不设开关）。 */
function confirmGate(config: Config): boolean {
  return config.confirmWrites !== false
}

/** 字段清空约定说明（update 类工具的可选字段参数描述复用）。 */
const CLEARABLE_NOTE = '传空字符串表示清除该字段；不传则保留原值。'

/** 注册全部星愿工具（preset 层 scope；插件 dispose 自动注销）。 */
export function registerTools(ctx: Context & { xingyuan: XingyuanStore }, config: Config): void {
  const store = ctx.xingyuan

  // ===== 愿望 =====

  ctx.tools.register(defineTool({
    name: 'check_similar_wishes',
    description: '【内部工具】检查是否存在相似愿望，用于创建愿望前查重。何时使用：在创建新愿望前自动调用，检查用户是否已有相似愿望，避免重复创建。禁止在回复中提及此工具。',
    parameters: {
      title: { type: 'string', required: true, description: '愿望标题。不超过50字符。示例：学习编程' },
      categoryName: { type: 'string', description: '愿望分类名称，可选。2-6个中文字符。示例：学习' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const needle = args.title.toLowerCase()
      const hits = new Set<string>()
      for (const [, wish] of store.domain.table('wishes').entries()) {
        if (!wish.title.toLowerCase().includes(needle)) continue
        hits.add(wish.title)
        if (hits.size >= 5) break
      }
      if (hits.size === 0) return '无相似愿望，可以创建。'
      return `发现 ${hits.size} 个相似愿望：${[...hits].join('、')}。请先向用户确认是否重复。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_wish_with_tasks',
    description: '创建愿望并同时创建推荐任务。何时使用：当用户想要创建新愿望时调用，AI自动分析愿望内容并生成3个量身定制的推荐任务（名称+截止日期+打卡周期），帮助用户快速开始执行。'
      + '依赖关系：创建前必须先调用check_similar_wishes检查是否已有相似愿望，确认无相似项后才可创建。'
      + '推荐任务默认生成 3 个；用户可删减/修改（0-3 个均支持，0 个即纯愿望）；用户明确表示不需要任务时才改用create_wish。'
      + CREATE_NOTE,
    parameters: {
      title: { type: 'string', required: true, description: '愿望标题。不超过50字符，简洁描述愿望内容。示例：3个月学会Python' },
      categoryName: { type: 'string', required: true, description: '愿望分类名称。2-6个中文字符，优先2-3个字。可选值：学习、健康、工作、生活、旅行、财务等。示例：学习' },
      colorKey: { type: 'string', enum: COLOR_KEY_ENUM, description: `分类颜色标识，可选。${COLOR_KEY_NOTE}示例：blue` },
      description: { type: 'string', description: '愿望描述，可选。不超过500字符，补充说明愿望细节。' },
      estimatedCompletionDate: { type: 'string', description: '预计完成日期，可选。yyyy-MM-dd；用户未指定时由你按愿望指南的补全规则推算后填入，不得省略' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: '任务名称' },
            dueDate: { type: 'string', description: '截止日期 yyyy-MM-dd；仅一次任务可不设截止日（点击打卡即完成）' },
            checkInCycle: { type: 'string', required: true, enum: ['once', 'daily', 'weekly', 'monthly'], description: '打卡周期：once一次性/daily每日/weekly每周/monthly每月' },
          },
        },
        description: '推荐任务列表，默认生成3个，最多3个',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const today = todayIso()
      // 落库前预检字段（分类/日期校验与 store 同源），确认卡被拒或字段非法都不产生半成品
      validateEstimatedDate(args.estimatedCompletionDate, today)
      if ((args.tasks?.length ?? 0) > 3) throw new ToolError('推荐任务最多 3 个')
      if (confirmGate(config)) {
        const plan = (args.tasks ?? []).map((t, i) => `${i + 1}. ${t.name}（${CYCLE_LABELS[t.checkInCycle]}${t.dueDate ? `，截止 ${t.dueDate}` : ''}）`).join('\n')
        const approved = await confirmAction(ctx, exec,
          `确认创建愿望「${args.title}」（${args.categoryName}）吗？`
          + (plan.length > 0 ? `\n将同时创建 ${args.tasks!.length} 个推荐任务：\n${plan}` : '\n不创建推荐任务。'))
        if (!approved) return '已取消创建。可以告诉我要调整的地方（任务内容、周期、截止日等），我重新规划后再确认。'
      }
      const wish = await createWish(store, args, today)
      const created: TaskRecord[] = []
      const failed: string[] = []
      for (const item of args.tasks ?? []) {
        try {
          created.push(await createTask(store, {
            wishId: wish.wishId,
            name: item.name,
            dueDate: item.dueDate,
            checkInCycle: item.checkInCycle,
            source: 'ai',
          }, today))
        } catch (error) {
          failed.push(`${item.name}：${error instanceof Error ? error.message : '未知原因'}`)
        }
      }
      const finalWish = store.domain.table('wishes').get(wish.wishId)!
      emitWish(exec.agent, 'created', finalWish)
      for (const task of created) emitTask(store, exec.agent, 'created', task)
      const lines = created.map((task, index) => `${index + 1}. ${taskLine(task)}`).join('\n')
      const note = failed.length ? `\n部分任务创建失败：${failed.join('；')}` : ''
      return `已创建愿望「${wish.title}」（分类：${wish.categoryName}）${created.length > 0 ? `，含 ${created.length} 个推荐任务：\n${lines}` : ''}。${note}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_wish',
    description: '创建单个愿望。何时使用：用户只想创建愿望而不需要AI推荐任务时调用，适用于明确只需要记录愿望目标的场景。依赖关系：创建前必须先调用check_similar_wishes查重。' + CREATE_NOTE,
    parameters: {
      title: { type: 'string', required: true, description: '愿望标题。不超过50字符。示例：3个月学会Python' },
      categoryName: { type: 'string', required: true, description: '愿望分类名称。2-6个中文字符，优先2-3个字。示例：学习' },
      colorKey: { type: 'string', enum: COLOR_KEY_ENUM, description: `分类颜色标识，可选。${COLOR_KEY_NOTE}示例：blue` },
      description: { type: 'string', description: '愿望描述，可选。不超过500字符。' },
      estimatedCompletionDate: { type: 'string', description: '预计完成日期，可选。yyyy-MM-dd' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const today = todayIso()
      validateEstimatedDate(args.estimatedCompletionDate, today)
      if (confirmGate(config)) {
        const approved = await confirmAction(ctx, exec,
          `确认创建愿望「${args.title}」（${args.categoryName}）吗？${args.estimatedCompletionDate !== undefined ? `\n预计完成：${args.estimatedCompletionDate}` : ''}`)
        if (!approved) return '已取消创建。可以告诉我要调整的地方，我修改后再确认。'
      }
      const wish = await createWish(store, args, today)
      emitWish(exec.agent, 'created', wish)
      return `已创建愿望「${wish.title}」（分类：${wish.categoryName}）。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_wish_list',
    description: '获取所有愿望列表。何时使用：展示所有愿望、查看概览或统计时调用。返回愿望ID、标题、分类、进度等。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const wishes = [...store.domain.table('wishes').entries()].map(([, w]) => freshWish(store, w))
      if (wishes.length === 0) return '暂无愿望。可以告诉我你的第一个愿望，我来帮你拆解执行计划。'
      return `共 ${wishes.length} 个愿望：\n${wishes.map((w) => `- [${w.wishId}] 「${w.title}」(${w.categoryName})，进度 ${w.progress}%${w.archived ? '，已达成 🎉' : ''}`).join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'search_wishes',
    description: '搜索愿望。何时使用：用户需要按关键词、分类或标题查找特定愿望时调用，适用于愿望数量较多时的快速定位。三个条件可任意组合。',
    parameters: {
      keyword: { type: 'string', description: '搜索词，可选。不超过20字符，匹配标题或描述。示例：Python' },
      categoryName: { type: 'string', description: '分类名称，可选。精确匹配。示例：学习' },
      title: { type: 'string', description: '标题，可选。精确匹配' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const keyword = args.keyword?.toLowerCase()
      const hits: WishRecord[] = []
      for (const [, wish] of store.domain.table('wishes').entries()) {
        if (keyword !== undefined && !wish.title.toLowerCase().includes(keyword) && !(wish.description ?? '').toLowerCase().includes(keyword)) continue
        if (args.categoryName !== undefined && wish.categoryName !== args.categoryName) continue
        if (args.title !== undefined && wish.title !== args.title) continue
        hits.push(freshWish(store, wish))
      }
      if (hits.length === 0) return '没有符合条件的愿望。'
      return `找到 ${hits.length} 个愿望：\n${hits.map((w) => `- [${w.wishId}] 「${w.title}」(${w.categoryName})，进度 ${w.progress}%`).join('\n')}\n引用愿望时必须使用方括号内的真实 ID。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_wish_categories',
    description: '获取愿望分类列表。何时使用：查看所有分类、了解分类分布或获取分类名用于创建愿望时调用。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const counts = new Map<string, number>()
      for (const [, wish] of store.domain.table('wishes').entries()) counts.set(wish.categoryName, (counts.get(wish.categoryName) ?? 0) + 1)
      if (counts.size === 0) return '暂无分类。'
      return [...counts.entries()].map(([name, count]) => `${name}（${count} 个愿望）`).join('、')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_wish_category_color_keys',
    description: '【内部工具】获取分类颜色白名单。何时使用：创建愿望分类前调用，获取可用颜色标识列表。禁止在回复中提及此工具。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      return CATEGORY_COLOR_KEYS.join(', ')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_latest_wish',
    description: '获取最近创建的愿望。何时使用：查看最新创建的愿望详情、确认最近操作结果或展示最新愿望时调用。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      let latest: WishRecord | undefined
      for (const [, wish] of store.domain.table('wishes').entries()) {
        if (latest === undefined || wish.createdAt > latest.createdAt) latest = wish
      }
      if (latest === undefined) return '当前暂无愿望。'
      const fresh = freshWish(store, latest)
      return `[${fresh.wishId}] 「${fresh.title}」(${fresh.categoryName})，进度 ${fresh.progress}%${fresh.archived ? '，已达成 🎉' : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_wish_detail',
    description: '【内部工具】获取愿望详情及其下属任务。何时使用：需要查看单个愿望完整信息（含任务清单）时内部调用。禁止在回复中提及此工具。',
    parameters: { wishId: { type: 'string', required: true, description: '愿望ID，取列表返回的真实值' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const wish = requireWish(store, args.wishId)
      const detail = freshWish(store, wish)
      const tasks: TaskRecord[] = []
      for (const [, task] of store.domain.table('tasks').entries()) {
        if (task.wishId === args.wishId) tasks.push(freshTask(store, task))
      }
      const desc = detail.description !== undefined ? `\n描述：${detail.description}` : ''
      const due = detail.estimatedCompletionDate !== undefined ? `，预计完成 ${detail.estimatedCompletionDate}` : ''
      const head = `[${detail.wishId}] 「${detail.title}」(${detail.categoryName})，进度 ${detail.progress}%（已完成 ${detail.totalCompletedDays}/${detail.totalRequiredDays > 0 ? detail.totalRequiredDays : '不限'} 天）${due}${desc}`
      if (tasks.length === 0) return `${head}\n暂无下属任务。`
      return `${head}\n下属任务 ${tasks.length} 个：\n${tasks.map((t) => `- [${t.taskId}] ${taskLine(t)}，${statusLabel(t.status)}（${t.completedDays}/${t.requiredDays > 0 ? t.requiredDays : '不限'}）`).join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'update_wish',
    description: '更新愿望信息。何时使用：修改已有愿望的标题、描述、分类或预计完成日期时调用；修改分类时可同时指定颜色标识（colorKey）。'
      + '部分更新：只传用户明确提及的字段，未提及的字段一律不传（服务端保留原值），禁止编造或推断未提及字段的内容。'
      + 'wishId 必须取愿望列表返回的真实ID，禁止猜测或编造；表述模糊（如「那个学英语的愿望」）时先查询列表定位。',
    parameters: {
      wishId: { type: 'string', required: true, description: '愿望ID，取列表返回的真实值' },
      title: { type: 'string', description: '新标题，可选。不超过50字符' },
      description: { type: 'string', description: `新描述，可选。不超过500字符。${CLEARABLE_NOTE}` },
      categoryName: { type: 'string', description: '新分类名，可选。2-6个中文字符' },
      colorKey: { type: 'string', description: `分类颜色标识，可选。${COLOR_KEY_NOTE}${CLEARABLE_NOTE}示例：blue` },
      estimatedCompletionDate: { type: 'string', description: `新预计完成日期，可选。yyyy-MM-dd。${CLEARABLE_NOTE}` },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      validateEstimatedDate(args.estimatedCompletionDate, todayIso())
      const updated = await updateWish(store, args.wishId, {
        title: args.title,
        description: args.description,
        categoryName: args.categoryName,
        colorKey: args.colorKey,
        estimatedCompletionDate: args.estimatedCompletionDate,
      })
      emitWish(exec.agent, 'updated', updated)
      return `已更新愿望「${updated.title}」。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rename_wish_category',
    description: '重命名分类。何时使用：修改分类名称时调用，原分类下所有愿望移至新分类。适用于分类改名或合并分类。',
    parameters: {
      oldName: { type: 'string', required: true, description: '原分类名称。2-6个中文字符' },
      newName: { type: 'string', required: true, description: '新分类名称。2-6个中文字符，优先2-3个字' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const renamed = await renameCategory(store, args.oldName, args.newName)
      if (renamed.length === 0) throw new ToolError(`分类「${args.oldName}」不存在`)
      for (const wish of renamed) emitWish(exec.agent, 'updated', wish)
      return `已将 ${renamed.length} 个愿望的分类从「${args.oldName}」改为「${args.newName}」。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'delete_wish',
    description: `删除愿望。何时使用：删除单个愿望及其关联的所有任务时调用，适用于愿望已完成、取消或误创建的场景。${DELETE_NOTE}回复时向用户说明影响范围。`,
    parameters: { wishId: { type: 'string', required: true, description: '愿望ID，取列表返回的真实值' } },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const wish = requireWish(store, args.wishId)
      const approved = await confirmAction(ctx, exec, `确定删除愿望「${wish.title}」吗？其下所有任务与打卡记录将一并删除，不可恢复。`)
      if (!approved) return '已取消删除。'
      const removedTasks = await removeWishCompletely(store, args.wishId)
      // 级联删除同样补发任务事件：会话内任务卡同步转「已删除」，回放状态与库一致
      for (const task of removedTasks) emitTask(store, exec.agent, 'deleted', task)
      emitWish(exec.agent, 'deleted', wish)
      return `已删除愿望「${wish.title}」及 ${removedTasks.length} 个关联任务。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'batch_delete_wishes',
    description: `批量删除愿望。何时使用：一次性删除多个愿望时调用，最多10个。${DELETE_NOTE}返回成功和失败数量。`,
    parameters: {
      wishIds: { type: 'array', items: { type: 'string' }, required: true, description: '愿望ID列表，1-10个，取列表返回的真实值' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      if (args.wishIds.length < 1 || args.wishIds.length > 10) throw new ToolError('愿望ID列表需 1-10 个')
      const titles: string[] = []
      for (const id of args.wishIds) titles.push(store.domain.table('wishes').get(id)?.title ?? id)
      const approved = await confirmAction(ctx, exec, `确定批量删除 ${titles.length} 个愿望吗？「${titles.join('」「')}」及其关联任务将被删除，不可恢复。`)
      if (!approved) return '已取消删除。'
      let success = 0
      const failed: string[] = []
      const removedTasks: TaskRecord[] = []
      const removedWishes: WishRecord[] = []
      for (const id of args.wishIds) {
        const wish = store.domain.table('wishes').get(id)
        if (wish === undefined) {
          failed.push(id)
          continue
        }
        removedTasks.push(...await removeWishCompletely(store, id))
        removedWishes.push(wish)
        success++
      }
      // 与单个删除同口径：级联任务卡先转「已删除」，再定格愿望删除事实
      for (const task of removedTasks) emitTask(store, exec.agent, 'deleted', task)
      for (const wish of removedWishes) emitWish(exec.agent, 'deleted', wish)
      return `批量删除完成：成功 ${success} 个愿望、${removedTasks.length} 个任务${failed.length > 0 ? `；失败 ${failed.length} 个（不存在：${failed.join('、')}）` : ''}。`
    },
  }))

  // ===== 任务 =====

  ctx.tools.register(defineTool({
    name: 'check_similar_tasks',
    description: '【内部工具】检查是否存在相似任务，用于创建任务前查重。何时使用：在 create_task 或 batch_create_tasks 之前调用。禁止在回复中提及此工具。',
    parameters: { taskName: { type: 'string', required: true, description: '任务名称关键词。示例：背单词' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const needle = args.taskName.toLowerCase()
      const hits = new Set<string>()
      for (const [, task] of store.domain.table('tasks').entries()) {
        if (!task.name.toLowerCase().includes(needle)) continue
        hits.add(task.name)
        if (hits.size >= 5) break
      }
      if (hits.size === 0) return '无相似任务，可以创建。'
      return `发现 ${hits.size} 个相似任务：${[...hits].join('、')}。请先向用户确认是否重复。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_task',
    description: '创建单个任务。何时使用：用户明确要求创建一个具体任务时使用。依赖关系：创建前必须先调用check_similar_tasks查重，确认无相似项后才可创建。'
      + `输出：创建成功返回任务信息（任务ID、名称、截止日期、打卡周期）；不指定wish_id时任务不关联任何愿望。${CREATE_NOTE}`,
    parameters: {
      wishId: { type: 'string', description: '关联愿望ID，可选。取列表返回的真实值' },
      name: { type: 'string', required: true, description: '任务名称。1-100字符。示例：每天背单词30分钟' },
      dueDate: { type: 'string', description: '截止日期 yyyy-MM-dd，不得早于今天；用户未指定时按任务指南的补全规则推算后填入；仅当用户明确表示不设置截止日期时不传（仅一次任务无截止日=点击打卡即完成）' },
      checkInCycle: { type: 'string', required: true, enum: ['once', 'daily', 'weekly', 'monthly'], description: '打卡周期：once(仅一次)/daily(每日)/weekly(每周)/monthly(每月)。示例：daily' },
      hint: { type: 'string', description: '任务提示，可选。不超过500字符。示例：使用APP背单词，记录新学单词' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      if (confirmGate(config)) {
        const approved = await confirmAction(ctx, exec,
          `确认创建任务「${args.name}」吗？\n打卡周期：${CYCLE_LABELS[args.checkInCycle]}${args.dueDate !== undefined ? `，截止 ${args.dueDate}` : ''}${args.wishId !== undefined ? `，关联愿望 ${store.domain.table('wishes').get(args.wishId)?.title ?? args.wishId}` : ''}`)
        if (!approved) return '已取消创建。可以告诉我要调整的地方，我修改后再确认。'
      }
      const task = await createTask(store, {
        wishId: args.wishId,
        name: args.name,
        dueDate: args.dueDate,
        checkInCycle: args.checkInCycle,
        source: 'ai',
        hint: args.hint,
      })
      emitTask(store, exec.agent, 'created', task)
      const preview = taskPreview(store, task)
      return `已创建任务「${task.name}」（${cycleLabel(task.checkInCycle)}${task.dueDate !== undefined ? `，截止 ${task.dueDate}` : ''}），应打卡 ${task.requiredDays > 0 ? `${task.requiredDays} 天` : '不限'}，当前待领取。${preview.length > 0 ? `近期打卡日：${preview.join('、')}。` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'batch_create_tasks',
    description: '批量创建多个任务。何时使用：AI为用户推荐多个任务时一次性创建。限制：最多10个。依赖关系：创建前必须先调用check_similar_tasks查重。' + CREATE_NOTE,
    parameters: {
      tasks: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            wishId: { type: 'string', description: '关联愿望ID，可选' },
            name: { type: 'string', required: true, description: '任务名称' },
            dueDate: { type: 'string', description: '截止日期 yyyy-MM-dd' },
            checkInCycle: { type: 'string', required: true, enum: ['once', 'daily', 'weekly', 'monthly'], description: '打卡周期' },
            hint: { type: 'string', description: '任务提示，可选' },
          },
        },
        description: '任务列表，1-10 个',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      if (args.tasks.length < 1 || args.tasks.length > 10) throw new ToolError('单次最多创建10个任务')
      if (confirmGate(config)) {
        const plan = args.tasks.map((t, i) => `${i + 1}. ${t.name}（${CYCLE_LABELS[t.checkInCycle]}${t.dueDate ? `，截止 ${t.dueDate}` : ''}）`).join('\n')
        const approved = await confirmAction(ctx, exec, `确认批量创建以下 ${args.tasks.length} 个任务吗？\n${plan}`)
        if (!approved) return '已取消创建。可以告诉我要调整的地方，我修改后再确认。'
      }
      const created: TaskRecord[] = []
      const failed: string[] = []
      for (const item of args.tasks) {
        try {
          created.push(await createTask(store, { ...item, source: 'ai' }))
        } catch (error) {
          failed.push(`${item.name}：${error instanceof Error ? error.message : '未知原因'}`)
        }
      }
      // 愿望库存进度由 createTask 内部联动落库（读侧 fresh 兜底，但
      // overview/开场上下文消费的是库存 archived 原值，不回写会短暂失真）
      for (const task of created) emitTask(store, exec.agent, 'created', task)
      const lines = created.map((task, index) => `${index + 1}. ${taskLine(task)}`).join('\n')
      return `已创建 ${created.length} 个任务：\n${lines}${failed.length > 0 ? `\n失败：${failed.join('；')}` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_task_list',
    description: '获取任务列表。何时使用：查看自己的任务列表或按条件筛选时使用。支持按愿望、状态、打卡周期、关键词筛选。',
    parameters: {
      wishId: { type: 'string', description: '按愿望筛选，可选' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'closed'], description: '按状态筛选，可选：pending(待领取)/in_progress(进行中)/closed(完结)' },
      checkInCycle: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly'], description: '按周期筛选，可选' },
      keyword: { type: 'string', description: '按任务名称模糊匹配，可选' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const hits: TaskRecord[] = []
      for (const [, task] of store.domain.table('tasks').entries()) {
        if (args.wishId !== undefined && task.wishId !== args.wishId) continue
        if (args.status !== undefined && task.status !== args.status) continue
        if (args.checkInCycle !== undefined && task.checkInCycle !== args.checkInCycle) continue
        if (args.keyword !== undefined && !task.name.toLowerCase().includes(args.keyword.toLowerCase())) continue
        hits.push(freshTask(store, task))
      }
      if (hits.length === 0) return '没有符合条件的任务。'
      return `找到 ${hits.length} 个任务：\n${hits.map((t) => `- [${t.taskId}] ${taskLine(t)}，${statusLabel(t.status)}`).join('\n')}\n引用任务时必须使用方括号内的真实 ID。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'claim_task',
    description: '领取任务。何时使用：将待领取(pending)状态的任务改为进行中。依赖关系：任务状态必须为 pending 才能领取；领取日成为机会日锚点。',
    parameters: { taskId: { type: 'string', required: true, description: '任务ID，取列表返回的真实值' } },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const task = await claimTask(store, args.taskId)
      emitTask(store, exec.agent, 'updated', task)
      const preview = taskPreview(store, task)
      return `已领取任务「${task.name}」，进入进行中。${preview.length > 0 ? `近期打卡日：${preview.join('、')}。` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'update_task',
    description: '更新任务信息。何时使用：修改任务名称、提示、截止日期或打卡周期时使用。'
      + '部分更新：只传用户明确提及的字段，未提及的字段一律不传（服务端保留原值），禁止编造或推断。taskId 必须取任务列表返回的真实ID。'
      + '任务状态由系统管理（领取/打卡达标/截止/重新开始），不接受直接修改；对已过期关闭的任务延长截止日即可触发重新开始。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务ID，取列表返回的真实值' },
      name: { type: 'string', description: '新名称，可选。1-100字符' },
      hint: { type: 'string', description: `新提示，可选。不超过500字符。${CLEARABLE_NOTE}` },
      dueDate: { type: 'string', description: `新截止日期，可选。yyyy-MM-dd，不得早于今天；${CLEARABLE_NOTE}清除后任务不再受机会日约束` },
      checkInCycle: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly'], description: '新打卡周期，可选' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const before = requireTask(store, args.taskId)

      const after = await updateTask(store, args.taskId, {
        name: args.name,
        hint: args.hint,
        dueDate: args.dueDate,
        checkInCycle: args.checkInCycle,
      })
      emitTask(store, exec.agent, 'updated', after)
      const changes = [
        args.name !== undefined ? `名称 →「${after.name}」` : undefined,
        args.hint !== undefined ? '提示已更新' : undefined,
        args.dueDate !== undefined ? `截止日 → ${after.dueDate ?? '不限'}` : undefined,
        args.checkInCycle !== undefined ? `周期 → ${cycleLabel(after.checkInCycle)}（应打卡 ${after.requiredDays > 0 ? `${after.requiredDays} 天` : '不限'}）` : undefined,
      ].filter((change) => change !== undefined)
      const restarted = before.status === 'closed' && after.status === 'in_progress'
      return `已更新任务「${after.name}」：${changes.join('，')}${restarted ? '。任务已重新开始' : ''}。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'check_in_task',
    description: '任务打卡。何时使用：用户完成任务并需要记录打卡时使用。支持指定日期打卡（日历补卡/提前勾），不传日期则自动勾选今天（含）起最早未勾选的打卡日——过去的日期不会自动补，补卡请在日历中指定日期。'
      // 与 CREATE_NOTE 同口径：是否弹卡受设置门控，描述里不可断言（见 DELETE_NOTE 组注释）
      + '注意：无需事先询问用户，直接调用即可；今天不是打卡日时自动勾选的是未来日期（提前打卡 = 承诺当天完成），回复时请用「打卡日」等通俗用语并如实告知勾选日期。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务ID，取列表返回的真实值' },
      checkInDate: { type: 'string', description: '打卡日期，可选。yyyy-MM-dd，必须是任务的打卡日；不传则自动勾选今天（含）起最早未勾选的打卡日' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const task = requireTask(store, args.taskId)

      const today = todayIso()
      const target = args.checkInDate
        ?? findFirstUncheckedOpportunityDate(anchorOf(task), task.dueDate, task.checkInCycle, checkedDatesOf(store, task.taskId), today)
      if (target === null) throw new ToolError('没有可勾选的打卡日：机会日已全部完成或截止')

      // 打卡确认与创建/取消同受「写操作二次确认」开关控制（设置 → 星愿）；
      // 关闭后直接执行——提前勾的承诺语义由回复文案如实告知兜底
      if (confirmGate(config)) {
        const question = target > today
          ? `今天不是「${task.name}」的打卡日，确认提前打卡 ${target} 吗？提前打卡表示承诺当天完成。`
          : `确认完成「${task.name}」在 ${target} 的打卡吗？`
        const approved = await confirmAction(ctx, exec, question)
        if (!approved) return '已取消打卡。需要时随时告诉我。'
      }

      const result = await performCheckIn(store, task.taskId, target, today)
      const wishName = wishNameOf(store, result.task)

      emitCheckin(exec.agent, store, {
        op: 'checked',
        taskId: result.task.taskId,
        taskName: result.task.name,
        ...(wishName !== undefined ? { wishName } : {}),
        date: result.date,
        completedDays: result.task.completedDays,
        requiredDays: result.task.requiredDays,
      })
      const achieved = result.task.status === 'closed' && result.task.closedReason === 'achieved'
      return `已为「${result.task.name}」勾选 ${result.date} 的打卡 ✓（${result.task.completedDays}/${result.task.requiredDays > 0 ? result.task.requiredDays : '不限'} 天）。${achieved ? '🎉 任务达标完结！继续保持！' : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cancel_check_in_task',
    description: '取消打卡。何时使用：撤销误打卡记录时使用。可指定日期取消；不传日期则自动取消该任务最近一次打卡记录。' + CANCEL_CHECKIN_NOTE,
    parameters: {
      taskId: { type: 'string', required: true, description: '任务ID' },
      checkInDate: { type: 'string', description: '取消打卡日期，可选。yyyy-MM-dd；仅当用户明确指定某天时传' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const task = requireTask(store, args.taskId)

      if (confirmGate(config)) {
        const approved = await confirmAction(ctx, exec,
          args.checkInDate !== undefined
            ? `确定取消「${task.name}」在 ${args.checkInDate} 的打卡吗？该日进度将回退。`
            : `确定取消「${task.name}」最近一次打卡吗？对应日期的进度将回退。`)
        if (!approved) return '已取消操作，打卡记录保持不变。'
      }
      const result = await cancelCheckIn(store, args.taskId, args.checkInDate)
      const wishName = wishNameOf(store, result.task)

      emitCheckin(exec.agent, store, {
        op: 'cancelled',
        taskId: result.task.taskId,
        taskName: result.task.name,
        ...(wishName !== undefined ? { wishName } : {}),
        date: result.date,
        completedDays: result.task.completedDays,
        requiredDays: result.task.requiredDays,
      })
      return `已取消「${result.task.name}」在 ${result.date} 的打卡（当前 ${result.task.completedDays}/${result.task.requiredDays > 0 ? result.task.requiredDays : '不限'} 天）。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'delete_task',
    description: `删除任务。何时使用：删除进行中或完结状态的任务时使用。${DELETE_NOTE}`,
    parameters: { taskId: { type: 'string', required: true, description: '任务ID' } },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const task = requireTask(store, args.taskId)

      const approved = await confirmAction(ctx, exec, `确定删除任务「${task.name}」吗？其打卡记录将一并删除，不可恢复。`)
      if (!approved) return '已取消删除。'
      await removeTaskCompletely(store, task.taskId)
      emitTask(store, exec.agent, 'deleted', task)
      return `已删除任务「${task.name}」。如需重新添加，随时告诉我！`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'batch_delete_tasks',
    description: `批量删除任务。何时使用：一次性删除多个任务时使用，最多10个。${DELETE_NOTE}`,
    parameters: {
      taskIds: { type: 'array', items: { type: 'string' }, required: true, description: '任务ID列表，最多10个' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      if (args.taskIds.length < 1 || args.taskIds.length > 10) throw new ToolError('任务ID列表需 1-10 个')
      const names: string[] = []
      for (const id of args.taskIds) names.push(store.domain.table('tasks').get(id)?.name ?? id)
      const approved = await confirmAction(ctx, exec, `确定批量删除 ${names.length} 个任务吗？「${names.join('」「')}」及其打卡记录将被删除，不可恢复。`)
      if (!approved) return '已取消删除。'
      let success = 0
      const failed: string[] = []
      for (const id of args.taskIds) {
        const task = store.domain.table('tasks').get(id)
        if (task === undefined) {
          failed.push(id)
          continue
        }
        await removeTaskCompletely(store, id)
        emitTask(store, exec.agent, 'deleted', task)
        success++
      }
      return `批量删除完成：成功 ${success} 个${failed.length > 0 ? `，失败 ${failed.length} 个（不存在）` : ''}。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_today_unchecked_tasks',
    description: '获取今日待打卡任务。何时使用：用户想查看今天需要完成但尚未打卡的任务时使用。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const plan = planForDay(store, todayIso())
      const due = plan.items.filter((item) => !item.checked)
      if (due.length === 0) return '今天没有待打卡的任务，太棒了！'
      return `今天有 ${due.length} 个任务待打卡：\n${due.map((item) => `- [${item.task.taskId}] ${item.task.name}（${cycleLabel(item.task.checkInCycle)}）`).join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_today_checked_tasks',
    description: '获取今日已打卡任务。何时使用：查看今天已完成任务时使用。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const plan = planForDay(store, todayIso())
      const done = plan.items.filter((item) => item.checked)
      if (done.length === 0) return '今天还没有打卡记录。'
      return `今天已完成 ${done.length} 个打卡：\n${done.map((item) => `- ${item.task.name} ✓`).join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_tasks_for_date',
    description: '获取指定日期的任务安排。何时使用：查看某一天的所有任务及打卡状态时使用。输出：该日期的任务清单与数量。',
    parameters: { date: { type: 'string', required: true, description: '日期 yyyy-MM-dd。示例：2026-08-15' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new ToolError('日期格式错误，请使用yyyy-MM-dd')
      const plan = planForDay(store, args.date)
      if (plan.items.length === 0) return `${args.date} 没有任务安排。`
      return `${args.date} 共 ${plan.items.length} 项：\n${plan.items.map((item) => `- [${item.task.taskId}] ${item.task.name}（${cycleLabel(item.task.checkInCycle)}）${item.checked ? '✓ 已打卡' : item.canCheckIn ? '○ 待打卡' : '— 未领取'}`).join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_tasks_for_next_days',
    description: '获取未来N天的任务安排。何时使用：查看近期任务计划时使用。限制：默认7天，最多31天。',
    parameters: { days: { type: 'integer', description: '天数 1-31，默认7' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const n = clampInt(args.days, 7, 31)
      const today = todayIso()
      const plans = planForRange(store, today, addDays(today, n - 1))
      const sections = plans.map((plan) => {
        const pending = plan.items.filter((item) => !item.checked)
        if (pending.length === 0) return `${plan.date}：无待打卡任务`
        return `${plan.date}：${pending.length} 项待打卡\n${pending.map((item) => `  - [${item.task.taskId}] ${item.task.name}${item.task.status === 'pending' ? '（未领取）' : ''}`).join('\n')}`
      })
      return `未来 ${n} 天安排：\n${sections.join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_tasks_for_date_range',
    description: '获取日期范围内的任务安排。限制：最多31天（超出自动截断）。',
    parameters: {
      startDate: { type: 'string', required: true, description: '开始日期 yyyy-MM-dd' },
      endDate: { type: 'string', required: true, description: '结束日期 yyyy-MM-dd，不早于开始日期' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(args.endDate)) {
        throw new ToolError('日期格式错误，请使用yyyy-MM-dd')
      }
      if (args.endDate < args.startDate) throw new ToolError('结束日期不能早于开始日期')
      const cappedEnd = args.endDate > addDays(args.startDate, 30) ? addDays(args.startDate, 30) : args.endDate
      const plans = planForRange(store, args.startDate, cappedEnd)
      const sections = plans.map((plan) => {
        const pending = plan.items.filter((item) => !item.checked).length
        return `${plan.date}：共 ${plan.items.length} 项${pending > 0 ? `，待打卡 ${pending} 项` : ''}`
      })
      return `${args.startDate} 至 ${cappedEnd}：\n${sections.join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_recommended_tasks',
    description: '获取AI推荐任务。何时使用：想基于历史数据获取个性化任务推荐时使用。返回最值得继续坚持的任务。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const scored: Array<{ task: TaskRecord; count: number }> = []
      for (const [, task] of store.domain.table('tasks').entries()) {
        if (task.status !== 'in_progress') continue
        scored.push({ task, count: checkedDatesOf(store, task.taskId).size })
      }
      if (scored.length === 0) return '暂无可推荐的任务。可以先创建一个任务。'
      scored.sort((a, b) => b.count - a.count)
      return `为你推荐继续坚持这些任务：\n${scored.slice(0, 5).map((item, index) => `${index + 1}. [${item.task.taskId}] ${taskLine(item.task)}（已打 ${item.count} 次）`).join('\n')}`
    },
  }))

  // ===== 记忆 =====

  ctx.tools.register(defineTool({
    name: 'save_memory',
    description: '【保存用户信息】使用场景：用户提供个人资料、偏好设置、生活习惯、重要事件等信息需要长期记忆时使用。例如："我生日是5月15日"、"我喜欢打篮球"、"我是软件工程师"。注意：保存前应先用search_memory检查是否已存在相同键名，存在则使用update_memory更新。',
    parameters: {
      key: { type: 'string', required: true, description: '键名。2-50字符。示例：生日、爱好_运动、职业、目标_2024' },
      value: { type: 'string', required: true, description: '内容。1-1000字符。示例：1990年5月15日、篮球/游泳/跑步' },
      category: { type: 'string', required: true, enum: ['personal', 'preference', 'habit', 'event', 'other'], description: '分类：personal(个人资料)/preference(偏好)/habit(习惯)/event(事件)/other(其他)' },
      importance: { type: 'string', enum: ['high', 'medium', 'low'], description: '重要性，可选，默认medium。high(核心信息)/medium(一般信息)会自动加载到上下文，low不会' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (store.domain.table('memories').get(args.key) !== undefined) {
        return '该信息已存在。如需修改，请告诉我「把XX改成YY」。'
      }
      await saveMemory(store, args.key, args.value, args.category, args.importance ?? 'medium')
      const autoLoaded = args.importance === undefined || args.importance === 'high' || args.importance === 'medium'
      return `已记住：${args.key} = ${args.value}${autoLoaded ? '（已自动加载到上下文）' : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'update_memory',
    description: '【更新用户信息】使用场景：修改或更正已保存的信息。例如："把我生日改成6月1日"。注意：更新前必须确认该键名信息已存在，不存在则使用save_memory保存。',
    parameters: {
      key: { type: 'string', required: true, description: '键名，须与已保存键名完全一致（区分大小写）。不确定时先search_memory' },
      value: { type: 'string', required: true, description: '新内容。1-1000字符' },
      importance: { type: 'string', enum: ['high', 'medium', 'low'], description: '新重要性，可选，默认保持原值' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const existing = store.domain.table('memories').get(args.key)
      if (existing === undefined) return `未找到「${args.key}」这条信息。请先保存，或检查键名是否正确。`
      await saveMemory(store, args.key, args.value, existing.category, args.importance ?? existing.importance)
      return `已更新：「${args.key}」从「${existing.value}」改为「${args.value}」`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'search_memory',
    description: '【搜索用户信息】使用场景：查找已保存的特定信息但不确定键名时使用。例如"我之前说过喜欢什么运动吗"。支持模糊匹配键名或内容，不区分大小写。',
    parameters: { keyword: { type: 'string', required: true, description: '搜索关键词。1-50字符。示例：生日、爱好、工作' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const matched = searchMemories(store, args.keyword)
      if (matched.length === 0) return `未找到包含「${args.keyword}」的信息。`
      return `找到 ${matched.length} 条：\n${matched.map((m) => `- ${m.key}：${m.value}`).join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_memory',
    description: '【获取指定用户信息】使用场景：精确查询某一项已保存的信息。需要精确键名，不确定时先用search_memory搜索。',
    parameters: { key: { type: 'string', required: true, description: '键名，完全一致（区分大小写）' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const memory = store.domain.table('memories').get(args.key)
      return memory !== undefined ? `${args.key} = ${memory.value}` : `未找到：「${args.key}」`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_all_memories',
    description: '【获取所有用户信息】使用场景：全面了解用户已保存的所有信息。例如"你都记得我什么"、查看完整记忆库。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const memories = allMemories(store)
      if (memories.length === 0) return '暂无已保存的信息。'
      return `已保存 ${memories.length} 条信息：\n${memories.map((m) => `${m.importance === 'high' ? '⭐' : '●'} ${m.key}：${m.value}`).join('\n')}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'delete_memory',
    description: `【删除用户信息】使用场景：用户要求删除某条已保存的信息时使用。例如"删除我的生日信息"。${DELETE_NOTE}`,
    parameters: { key: { type: 'string', required: true, description: '键名，完全一致（区分大小写）' } },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const memory = store.domain.table('memories').get(args.key)
      if (memory === undefined) throw new ToolError(`未找到「${args.key}」，无法删除`)
      const approved = await confirmAction(ctx, exec, `确定删除信息「${args.key}：${memory.value}」吗？删除后不可恢复。`)
      if (!approved) return '已取消删除。'
      await store.domain.table('memories').delete(args.key)
      return `已删除：「${args.key}」`
    },
  }))

  // ===== 用户配置（教练风格/画像，免确认）=====

  ctx.tools.register(defineTool({
    name: 'get_coach_config',
    description: '获取教练风格配置。何时使用：用户询问当前教练风格（如「你现在是什么风格」「你是什么教练」）时使用。返回当前风格类型（温柔型gentle/严格型strict/幽默型humorous）。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      return `教练风格：${styleLabel(store.domain.global.get().coachStyle)}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'update_coach_style',
    description: '更新教练风格。何时使用：用户要求设置或更换教练风格（如「对我严格一点」「换个幽默的风格」）时使用，免确认直接执行。修改后影响后续所有回复的语气与措辞，需一句话告知用户当前风格。',
    parameters: {
      style: { type: 'string', required: true, enum: COACH_STYLES, description: '风格类型：gentle(温柔型)/strict(严格型)/humorous(幽默型)。示例：strict' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      await store.domain.global.set({ ...store.domain.global.get(), coachStyle: args.style })
      return `已更新教练风格为：${styleLabel(args.style)}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'get_profile',
    description: '获取用户画像。何时使用：用户询问个人画像信息（如「你还记得我吗」「我的职业是什么」）时使用。返回昵称、职业、兴趣等已设置信息；某项未设置则不返回。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const profile = store.domain.global.get().profile
      const lines = [
        profile.nickname !== undefined ? `- 昵称：${profile.nickname}` : undefined,
        profile.occupation !== undefined ? `- 职业：${profile.occupation}` : undefined,
        profile.interests !== undefined && profile.interests.length > 0 ? `- 兴趣：${profile.interests.join('、')}` : undefined,
      ].filter((line) => line !== undefined)
      return lines.length > 0 ? `用户画像：\n${lines.join('\n')}` : '暂无用户画像'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'update_profile',
    description: '更新用户画像。何时使用：用户提供或修改个人信息（昵称/职业/兴趣）时使用，免确认直接执行，支持只更新提及的项。已提供的信息优先使用，不重复询问；修改后简要确认。',
    parameters: {
      nickname: { type: 'string', description: '昵称，可选。用户希望被称呼的名称。最多50字符' },
      occupation: { type: 'string', description: '职业，可选。最多100字符' },
      interests: { type: 'array', items: { type: 'string' }, description: '兴趣列表，可选。如 ["阅读","运动","音乐"]' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const current = store.domain.global.get()
      const profile = { ...current.profile }
      if (args.nickname !== undefined) profile.nickname = args.nickname
      if (args.occupation !== undefined) profile.occupation = args.occupation
      if (args.interests !== undefined) profile.interests = [...args.interests]
      await store.domain.global.set({ ...current, profile })
      return '已更新用户画像。'
    },
  }))

  // ===== 图表（内部）=====

  ctx.tools.register(defineTool({
    name: 'generate_chart',
    description: `【内部工具】生成统计图表。何时使用：用户询问打卡/任务/愿望的统计、趋势、分布、排行、进度等可视化数据时使用。chartKey 必须 15 选 1（对应图表展示指南选型速查表，禁止编造其他值）：${CHART_KEYS.join(' / ')}。用户未明确统计维度时优先 checkinTrend。口径提示：checkinTimeDistribution 按「实际打卡时刻」分桶；checkinRateTrend 副标题为整段整体率。输出：图表自动渲染为卡片；文字回复基于 subtitle 与数据概括结论与建议，不得只说「已生成图表」。禁止在回复中提及此工具。`,
    parameters: {
      chartKey: { type: 'string', required: true, enum: CHART_KEYS, description: '图表类型标识，15选1，见图表展示指南速查表' },
      days: { type: 'integer', description: '天数，可选。仅趋势/分布类生效：趋势类默认14，分布类默认30，最大90' },
      wishId: { type: 'string', description: '愿望ID，可选。仅 task_completion_rate/task_status 类生效（指定则仅统计该愿望）' },
      month: { type: 'string', description: '月份，可选。仅打卡日历使用，yyyy-MM 如 2026-08；不传统计最近一年' },
      limit: { type: 'integer', description: '返回数量，可选。仅排行/进度类生效，默认10最大20' },
      title: { type: 'string', description: '图表标题，可选。不传时用内建默认标题' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const spec = buildChart(args.chartKey as ChartKey, args satisfies ChartParams, store, {
        trendDays: config.chartTrendDays,
        distributionDays: config.chartDistributionDays,
        maxDays: config.chartMaxDays,
        rankLimit: config.chartRankLimit,
        rankMax: config.chartRankMax,
      })
      if (spec === undefined) throw new ToolError('暂无相关数据，无法生成该图表')
      exec.agent?.session.append('xingyuan/chart', {
        chartKey: spec.chartKey,
        title: spec.title,
        ...(spec.subtitle !== undefined ? { subtitle: spec.subtitle } : {}),
        chartType: spec.chartType,
        data: spec.data,
      })
      const top = spec.data
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
      const highlights = top.map((d) => d.label).join('、')
      return `已生成图表「${spec.title}」${spec.subtitle !== undefined ? `（${spec.subtitle}）` : ''}。${highlights.length > 0 ? `数据要点：${highlights}。` : ''}`
    },
  }))

  // ===== 数据汇总（内部）=====

  ctx.tools.register(defineTool({
    name: 'batch_query_user_data',
    description: '【内部工具】批量查询用户数据。何时使用：需要同时掌握全部愿望与任务数据（全面统计、跨愿望/任务汇总）时使用。数据量大时会截断并在返回中标注 truncated。禁止在回复中提及此工具。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const wishes = [...store.domain.table('wishes').entries()].map(([, w]) => freshWish(store, w))
      const tasks = [...store.domain.table('tasks').entries()].map(([, t]) => freshTask(store, t))
      const wishesTruncated = wishes.length > config.batchWishLimit
      const tasksTruncated = tasks.length > config.batchTaskLimit
      return JSON.stringify({
        wishCount: wishes.length,
        taskCount: tasks.length,
        ...(wishesTruncated || tasksTruncated
          ? { truncated: true, truncatedHint: '数据量较大已截断，请基于已返回数据回答；如需细节请询问具体愿望/任务名称' }
          : {}),
        wishes: wishes.slice(0, config.batchWishLimit).map((w) => ({
          wishId: w.wishId,
          title: w.title,
          categoryName: w.categoryName,
          progress: w.progress,
          ...(w.estimatedCompletionDate !== undefined ? { estimatedCompletionDate: w.estimatedCompletionDate } : {}),
        })),
        tasks: tasks.slice(0, config.batchTaskLimit).map((t) => ({
          taskId: t.taskId,
          wishId: t.wishId,
          name: t.name,
          dueDate: t.dueDate,
          statusDesc: STATUS_LABELS[t.status],
          checkInCycleDesc: CYCLE_LABELS[t.checkInCycle],
          requiredDays: t.requiredDays,
          completedDays: t.completedDays,
        })),
      })
    },
  }))

  // ===== 成长统计 =====

  ctx.tools.register(defineTool({
    name: 'get_growth_stats',
    description: `获取用户成长统计。何时使用：用户询问等级、经验值、升级进度、连续打卡天数、累计打卡天数、愿望/任务达成数量等成长数据时调用。返回当前等级（Lv.1-10）、经验与下一级门槛、连续/最长连续（承诺账本口径：未来预勾计入累计与最长但不参与当前连续）。`,
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      const summary = growthSummary(store)
      const { stats, level } = summary
      const nextText = level.nextLevelExperience === null
        ? '已满级'
        : `距下一级还需 ${level.nextLevelExperience - level.totalExperience} 经验`
      return [
        `等级：Lv.${level.level} ${level.levelName}（${level.totalExperience} EXP，${nextText}）`,
        `等级权益：${level.rewardDescription}`,
        `打卡：累计 ${stats.totalCheckInDays} 天 · 当前连续 ${stats.continuousCheckInDays} 天 · 最长连续 ${stats.maxContinuousCheckInDays} 天`,
        `愿望：共 ${summary.totalWishes} 个 · 已实现 ${summary.completedWishes} 个`,
        `任务：共 ${summary.totalTasks} 个 · 已达成 ${summary.completedTasks} 个`,
      ].join('\n')
    },
  }))

  // ===== 微行动（拆解执行）=====

  ctx.tools.register(defineTool({
    name: 'start_micro_action',
    description: `微行动拆解执行（开始/恢复）。何时使用：进行中任务让用户感到无从下手、希望拆成小步骤逐步推进时调用。把任务拆成 ${MICRO_STEPS_MIN}-${MICRO_STEPS_MAX} 个「两分钟到半小时内可完成」的具体小步骤，每步一句可执行指令（可附一句为什么）。已有进行中的拆解时自动恢复原步骤不覆盖；全部步骤处理完后引导用户完成打卡。${CREATE_NOTE}`,
    parameters: {
      taskId: { type: 'string', required: true, description: '任务ID，取列表返回的真实值' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            instruction: { type: 'string', required: true, description: '这一步做什么。一句话、可立即执行的指令。示例：打开教材翻到第 3 页，只读第一段' },
            rationale: { type: 'string', description: '为什么安排这一步，可选。一句话' },
          },
        },
        description: `拆解出的步骤列表，${MICRO_STEPS_MIN}-${MICRO_STEPS_MAX} 条，按执行顺序排列`,
      },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const task = requireTask(store, args.taskId)

      if (task.status !== 'in_progress') throw new ToolError('只有进行中的任务可以拆解微行动，请先领取任务')
      if (args.steps === undefined || args.steps.length < MICRO_STEPS_MIN || args.steps.length > MICRO_STEPS_MAX) {
        throw new ToolError(`微行动需要 ${MICRO_STEPS_MIN}-${MICRO_STEPS_MAX} 个步骤`)
      }
      if (confirmGate(config)) {
        const plan = args.steps.map((s, i) => `${i + 1}. ${s.instruction}`).join('\n')
        const approved = await confirmAction(ctx, exec, `为「${task.name}」开始微行动拆解吗？\n${plan}`)
        if (!approved) return '已取消。可以告诉我要调整的地方，我重新拆解后再确认。'
      }
      const { state, resumed } = await startMicroAction(store, task.taskId, args.steps)
      emitMicro(exec.agent, { op: resumed ? 'stepped' : 'started', taskId: task.taskId, taskName: task.name, steps: state.steps, currentStepNumber: state.currentStepNumber })
      const current = state.steps.find((s) => s.stepNumber === state.currentStepNumber)
      return resumed
        ? `「${task.name}」已有进行中的微行动，已为你恢复：当前第 ${state.currentStepNumber} 步——${current?.instruction ?? ''}`
        : `「${task.name}」的微行动已开始，共 ${state.steps.length} 步。从第 1 步开始：${state.steps[0]?.instruction ?? ''} 完成或想跳过某步时告诉我。`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'complete_micro_step',
    description: '微行动步进：标记当前步完成或跳过。何时使用：用户说某步做完了（action=complete）或想做下一不做这步（action=skip）时调用。只允许处理当前步；用户口头说明进度即为授权，不再弹确认卡。全部步骤处理完会提示引导打卡。',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务ID' },
      stepNumber: { type: 'integer', required: true, description: '要处理的步骤序号（必须是当前步）' },
      action: { type: 'string', required: true, enum: ['complete', 'skip'], description: 'complete=完成该步；skip=跳过该步' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const task = requireTask(store, args.taskId)

      const result = await completeMicroStep(store, task.taskId, args.stepNumber, args.action)
      emitMicro(exec.agent, {
        op: result.finished ? 'finished' : 'stepped',
        taskId: task.taskId,
        taskName: task.name,
        steps: result.state.steps,
        currentStepNumber: result.state.currentStepNumber,
      })
      const done = result.state.steps.filter((s) => s.completed).length
      const skipped = result.state.steps.filter((s) => s.skipped).length
      if (result.finished) {
        return `「${task.name}」微行动全部完成（完成 ${done} 步、跳过 ${skipped} 步）🎉 计划走完了——现在可以打卡这个任务，告诉我或去「今日」页点打卡都行。`
      }
      const next = result.state.steps.find((s) => s.stepNumber === result.state.currentStepNumber)
      return `第 ${args.stepNumber} 步已${args.action === 'complete' ? '完成 ✓' : '跳过 ↷'}（${done}/${result.state.steps.length} 完成）。下一步 第 ${result.state.currentStepNumber} 步：${next?.instruction ?? ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'restart_micro_action',
    description: `重开微行动：清除现有拆解以便重新规划。何时使用：用户明确说"重新拆/换个方式拆"时调用。${DELETE_NOTE}`,
    parameters: { taskId: { type: 'string', required: true, description: '任务ID' } },
    output: TEXT_OUTPUT,
    timeoutMs: 600_000,
    async execute(args, exec) {
      const task = requireTask(store, args.taskId)

      const approved = await confirmAction(ctx, exec, `确定清除「${task.name}」现有的微行动拆解吗？清除后需重新拆解。`)
      if (!approved) return '已取消，现有拆解保持不变。'
      const existed = await restartMicroAction(store, task.taskId)
      if (!existed) return `「${task.name}」本来就没有微行动拆解，直接用 start_micro_action 开始即可。`
      emitMicro(exec.agent, { op: 'restarted', taskId: task.taskId, taskName: task.name, steps: [], currentStepNumber: null })
      return `已清除「${task.name}」的微行动拆解。告诉我你的想法，我重新帮你拆。`
    },
  }))
}
