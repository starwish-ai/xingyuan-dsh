/**
 * /xingyuan/api/* 处理器：JSON 数据面 + 动作面（页面按钮直连 = 用户本人授权）。
 * 与对话侧工具共用 store 单写者函数（进度恒新鲜口径一致）；页面动作不经 HITL，
 * 模型侧写操作仍走 userQuestions 确认，页面动作与模型动作的授权语义保持分离。
 *
 * 校验失败抛 ActionError（400 + 稳定 code）；未知路径抛 HttpError(404)。
 */
import type { XingyuanStore, TaskRecord, MemoryRecord } from '../domain.js'
import { COACH_STYLES } from '../domain.js'
import type { DayPlan } from '../store.js'
import {
  allMemories,
  anchorOf,
  checkedDatesOf,
  createTask,
  createWish,
  cancelCheckIn,
  claimTask,
  freshTask,
  freshWish,
  monthRange,
  performCheckIn,
  planForDay,
  planForRange,
  renameCategory,
  saveMemory,
  searchMemories,
  validateCategoryName,
  validateColorKey,
} from '../store.js'
import { addDays, calculateOpportunityDates, findFirstUncheckedOpportunityDate, todayIso } from '../opportunity.js'
import { LEVEL_CONFIGS, growthSummary } from '../growth.js'
import { getMicroAction } from '../micro.js'
import { removeTaskCompletely, removeWishCompletely } from '../cascade.js'
import { ActionError, HttpError } from './errors.js'
import type { RoutesConfig } from './config.js'

export interface ApiDeps {
  readonly store: XingyuanStore
  readonly config: RoutesConfig
}

export interface JsonBody { readonly [key: string]: unknown }

const MEMORY_CATEGORIES = ['personal', 'preference', 'habit', 'event', 'other'] as const
const MEMORY_IMPORTANCE = ['high', 'medium', 'low'] as const
const CYCLES = ['once', 'daily', 'weekly', 'monthly'] as const
/** 详情页打卡网格展示的「未来机会日」数量上限。 */
const UPCOMING_DATES_LIMIT = 8

const STATUS_RANK: Record<TaskRecord['status'], number> = { in_progress: 0, pending: 1, closed: 2 }

/** 展示排序:进行中 → 待领取 → 已完结;组内新创建在前。 */
function byDisplayOrder(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const rank = (x: Record<string, unknown>): number => STATUS_RANK[x.status as TaskRecord['status']] ?? 9
  return (rank(a) - rank(b)) || (String(a.createdAt ?? '') < String(b.createdAt ?? '') ? 1 : -1)
}

function clampStr(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function requireFields(body: JsonBody, fields: string[]): void {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw new ActionError('missing_field', `缺少必填字段：${field}`, { field })
    }
  }
}

function strOrUndef(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function isoDateOrThrow(value: string, code: 'bad_date' | 'due_past' = 'bad_date'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ActionError(code, `日期格式错误，请使用 yyyy-MM-dd：${value}`)
  return value
}

// ===== GET 数据面 =====

export function getApi(deps: ApiDeps, path: string, url: URL): unknown {
  const { store, config } = deps
  if (path === '/api/overview' || path === '/api/today') return overview(deps)
  if (path === '/api/day') return day(deps, url.searchParams.get('date') ?? undefined)
  if (path === '/api/range') {
    const start = url.searchParams.get('start') ?? todayIso()
    const end = url.searchParams.get('end') ?? addDays(start, config.rangeDefaultDays - 1)
    const cap = addDays(start, config.rangeMaxDays - 1)
    return { days: rangePlans(deps, start, end >= start && end <= cap ? end : cap) }
  }
  if (path === '/api/calendar') return calendarMonth(deps, url.searchParams.get('month') ?? undefined)
  if (path === '/api/growth') return growth(deps)
  if (path === '/api/wishes') return wishes(deps)
  if (path === '/api/tasks') return tasks(deps)
  if (path === '/api/profile') return profilePayload(deps)
  if (path === '/api/memories') {
    return memoriesPayload(
      deps,
      url.searchParams.get('q') ?? undefined,
      intParam(url, 'offset'),
      intParam(url, 'limit') ?? config.memoryListLimit,
    )
  }
  if (path === '/api/task-detail') return taskDetail(deps, url.searchParams.get('taskId') ?? undefined)
  if (path === '/api/categories') return categoriesPayload(deps)
  throw new HttpError(404, 'not found')
}

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

// ===== 动作面 =====

export async function postApi(deps: ApiDeps, path: string, body: JsonBody): Promise<unknown> {
  switch (path) {
    case '/api/action/checkin': {
      requireFields(body, ['taskId'])
      const result = await performCheckIn(deps.store, String(body.taskId), strOrUndef(body.date), todayIso())
      return { ok: true, action: 'checkin', date: result.date, task: taskView(deps.store, result.task) }
    }
    case '/api/action/cancel-checkin': {
      requireFields(body, ['taskId'])
      const result = await cancelCheckIn(deps.store, String(body.taskId), strOrUndef(body.date), todayIso())
      return { ok: true, action: 'cancel-checkin', date: result.date, task: taskView(deps.store, result.task) }
    }
    case '/api/action/claim': {
      requireFields(body, ['taskId'])
      const task = await claimTask(deps.store, String(body.taskId), todayIso())
      return { ok: true, action: 'claim', task: taskView(deps.store, task) }
    }
    case '/api/profile':
      return actionUpdateProfile(deps, body)
    case '/api/action/memory-add':
      return actionMemoryAdd(deps, body)
    case '/api/action/memory-delete':
      return actionMemoryDelete(deps, body)
    case '/api/action/memory-clear':
      return actionMemoryClear(deps)
    case '/api/action/create-wish':
      return actionCreateWish(deps, body)
    case '/api/action/create-task':
      return actionCreateTask(deps, body)
    case '/api/action/delete-task':
      return actionDeleteTask(deps, body)
    case '/api/action/delete-wish':
      return actionDeleteWish(deps, body)
    case '/api/action/category-rename':
      return actionCategoryRename(deps, body)
    case '/api/action/category-color':
      return actionCategoryColor(deps, body)
    default:
      throw new HttpError(404, 'not found')
  }
}

// ===== 任务/愿望视图 =====

export function taskView(store: XingyuanStore, task: TaskRecord): Record<string, unknown> {
  const fresh = freshTask(store, task)
  const checked = checkedDatesOf(store, task.taskId)
  const next = findFirstUncheckedOpportunityDate(anchorOf(fresh), fresh.dueDate, fresh.checkInCycle, checked, todayIso())
  return {
    taskId: fresh.taskId,
    wishId: fresh.wishId,
    wishName: fresh.wishId !== undefined ? store.domain.table('wishes').get(fresh.wishId)?.title : undefined,
    name: fresh.name,
    hint: fresh.hint,
    dueDate: fresh.dueDate,
    // 原始枚举（once/daily/…）：文案本地化归客户端 format.ts；中文标签仅限工具回包
    cycle: fresh.checkInCycle,
    status: fresh.status,
    requiredDays: fresh.requiredDays,
    completedDays: fresh.completedDays,
    nextOpportunityDate: next ?? undefined,
    createdAt: fresh.createdAt,
  }
}

function dayTasks(plan: DayPlan): Array<Record<string, unknown>> {
  return plan.items.map((item) => ({
    taskId: item.task.taskId,
    name: item.task.name,
    cycle: item.task.checkInCycle,
    wishName: item.wish?.title,
    hint: item.task.hint,
    status: item.task.status,
    checked: item.checked,
    canCheckIn: item.canCheckIn,
    canCancel: item.canCancel,
  }))
}

// ===== 数据组装 =====

function overview(deps: ApiDeps): Record<string, unknown> {
  const { store } = deps
  const today = todayIso()
  const plan = planForDay(store, today)
  const due = plan.items.filter((item) => !item.checked)
  const openWishes = [...store.domain.table('wishes').entries()].map(([, w]) => w).filter((w) => !w.archived)
  return {
    today,
    total: plan.items.length,
    checked: plan.items.length - due.length,
    uncheckedCount: due.length,
    unchecked: due.map((item) => ({
      taskId: item.task.taskId,
      name: item.task.name,
      cycle: item.task.checkInCycle,
      wishName: item.wish?.title,
      hint: item.task.hint,
      status: item.task.status,
    })),
    openWishCount: openWishes.length,
    links: { calendar: '/xingyuan/calendar', growth: '/xingyuan/growth' },
  }
}

function day(deps: ApiDeps, date?: string): Record<string, unknown> {
  const target = date ?? todayIso()
  const plan = planForDay(deps.store, target)
  return { date: plan.date, tasks: dayTasks(plan), taskCount: plan.items.length }
}

function rangePlans(deps: ApiDeps, start: string, end: string): Array<Record<string, unknown>> {
  return planForRange(deps.store, start < end ? start : end, end > start ? end : start).map((plan) => ({
    date: plan.date,
    total: plan.items.length,
    checked: plan.items.filter((item) => item.checked).length,
    tasks: dayTasks(plan),
  }))
}

function calendarMonth(deps: ApiDeps, month?: string): Record<string, unknown> {
  const today = todayIso()
  const [start, end] = monthRange(month, today)
  // 月视图含首尾补齐的相邻月日子，由前端网格排布；这里给整月机会日事实
  const plans = planForRange(deps.store, start, end)
  const weeks: Array<Array<{ date: string | null; checked: number; due: number }>> = []
  let week: Array<{ date: string | null; checked: number; due: number }> = []
  const firstDow = new Date(`${start}T00:00:00Z`).getUTCDay()
  for (let pad = 0; pad < (firstDow + 6) % 7; pad++) week.push({ date: null, checked: 0, due: 0 })
  for (const plan of plans) {
    const checked = plan.items.filter((item) => item.checked).length
    week.push({ date: plan.date, checked, due: plan.items.length })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push({ date: null, checked: 0, due: 0 })
    weeks.push(week)
  }
  return { month: start.slice(0, 7), weeks, today }
}

function growth(deps: ApiDeps): Record<string, unknown> {
  const { store } = deps
  const summary = growthSummary(store)
  const { stats, level } = summary
  let totalRequired = 0
  let totalCompleted = 0
  for (const [, task] of store.domain.table('tasks').entries()) {
    totalRequired += task.requiredDays
    totalCompleted += task.completedDays
  }
  return {
    today: summary.today,
    level: level.level,
    levelName: level.levelName,
    rewardDescription: level.rewardDescription,
    totalExperience: level.totalExperience,
    nextLevelExperience: level.nextLevelExperience,
    levelProgress: level.levelProgress,
    levels: LEVEL_CONFIGS,
    currentStreak: stats.continuousCheckInDays,
    maxStreak: stats.maxContinuousCheckInDays,
    totalCheckinDays: stats.totalCheckInDays,
    lastCheckInDate: stats.lastCheckInDate,
    completionRate: totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : null,
    wishTotal: summary.totalWishes,
    wishAchieved: summary.completedWishes,
    taskTotal: summary.totalTasks,
    taskAchieved: summary.completedTasks,
    memoryCount: allMemories(store).length,
    links: { today: '/xingyuan/today', calendar: '/xingyuan/calendar' },
  }
}

function wishes(deps: ApiDeps): Record<string, unknown> {
  const { store } = deps
  return {
    today: todayIso(),
    // freshWish：读路径按今日重算进度/状态（与工具侧「进度恒新鲜」同口径）
    wishes: [...store.domain.table('wishes').entries()].map(([, raw]) => {
      const w = freshWish(store, raw)
      const tasks: Array<Record<string, unknown>> = []
      for (const [, t] of store.domain.table('tasks').entries()) {
        if (t.wishId === w.wishId) tasks.push(taskView(store, t))
      }
      return {
        wishId: w.wishId,
        title: w.title,
        categoryName: w.categoryName,
        colorKey: w.colorKey,
        description: w.description,
        progress: w.progress,
        archived: w.archived,
        estimatedCompletionDate: w.estimatedCompletionDate,
        totalRequiredDays: w.totalRequiredDays,
        totalCompletedDays: w.totalCompletedDays,
        tasks: tasks.sort(byDisplayOrder),
      }
    }),
  }
}

function tasks(deps: ApiDeps): Record<string, unknown> {
  const list: Array<Record<string, unknown>> = []
  for (const [, t] of deps.store.domain.table('tasks').entries()) list.push(taskView(deps.store, t))
  return { today: todayIso(), tasks: list.sort(byDisplayOrder) }
}

/** 任务详情聚合：任务快照 + 全部机会日网格事实 + 未来预览 + 微行动状态。 */
function taskDetail(deps: ApiDeps, taskId: string | undefined): Record<string, unknown> {
  const { store } = deps
  if (taskId === undefined || taskId.trim() === '') throw new ActionError('missing_field', '缺少必填字段：taskId', { field: 'taskId' })
  const raw = store.domain.table('tasks').get(taskId)
  if (raw === undefined) throw new ActionError('not_found', `任务不存在：${taskId}`)
  const fresh = freshTask(store, raw)
  const checked = checkedDatesOf(store, taskId)
  const today = todayIso()
  const series = calculateOpportunityDates(anchorOf(fresh), fresh.dueDate, fresh.checkInCycle)
  const grid = series.map((date) => ({
    date,
    state: checked.has(date) ? ('checked' as const) : date < today ? ('missed' as const) : ('future' as const),
  }))
  const upcoming = series.filter((date) => date >= today && !checked.has(date)).slice(0, UPCOMING_DATES_LIMIT)
  const micro = getMicroAction(store, taskId)
  return {
    task: taskView(store, raw),
    grid,
    upcoming,
    micro: micro === undefined
      ? undefined
      : {
          steps: micro.steps.map((step) => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            completed: step.completed,
            skipped: step.skipped,
          })),
          currentStepNumber: micro.currentStepNumber,
        },
  }
}

/** 分类清单：名称来自愿望分组；颜色解析顺序 global 覆盖 > 首个愿望显式键。 */
function categoriesPayload(deps: ApiDeps): Record<string, unknown> {
  const { store } = deps
  const counts = new Map<string, { count: number; wishColorKey?: string }>()
  for (const [, wish] of store.domain.table('wishes').entries()) {
    const entry = counts.get(wish.categoryName) ?? { count: 0 }
    entry.count += 1
    if (entry.wishColorKey === undefined && wish.colorKey !== undefined) entry.wishColorKey = wish.colorKey
    counts.set(wish.categoryName, entry)
  }
  const overrides = deps.store.domain.global.get().categoryColors ?? {}
  const names = new Set([...counts.keys(), ...Object.keys(overrides)])
  const categories = [...names].map((name) => ({
    name,
    wishCount: counts.get(name)?.count ?? 0,
    colorKey: overrides[name] ?? counts.get(name)?.wishColorKey ?? null,
    hasOverride: overrides[name] !== undefined,
  })).sort((a, b) => b.wishCount - a.wishCount || a.name.localeCompare(b.name, 'zh'))
  return { today: todayIso(), categories }
}

// ===== 档案与记忆 =====

function profilePayload(deps: ApiDeps): Record<string, unknown> {
  const { store } = deps
  const global = store.domain.global.get()
  return {
    today: todayIso(),
    coachStyle: global.coachStyle,
    nickname: global.profile.nickname,
    occupation: global.profile.occupation,
    interests: global.profile.interests ?? [],
    memoryCount: allMemories(store).length,
  }
}

async function actionUpdateProfile(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  const { store } = deps
  const current = store.domain.global.get()
  const next = { ...current, profile: { ...current.profile } }
  if (body.coachStyle !== undefined) {
    const style = String(body.coachStyle)
    if (!(COACH_STYLES as readonly string[]).includes(style)) {
      throw new Error('教练风格必须是 gentle（温柔型）/ strict（严格型）/ humorous（幽默型）')
    }
    next.coachStyle = style as (typeof COACH_STYLES)[number]
  }
  if (body.nickname !== undefined) {
    const nickname = clampStr(body.nickname, 50)
    if (nickname === '') delete next.profile.nickname
    else next.profile.nickname = nickname
  }
  if (body.occupation !== undefined) {
    const occupation = clampStr(body.occupation, 100)
    if (occupation === '') delete next.profile.occupation
    else next.profile.occupation = occupation
  }
  if (body.interests !== undefined) {
    const raw = Array.isArray(body.interests)
      ? body.interests
      : typeof body.interests === 'string' ? body.interests.split(/[,，、\s]+/) : null
    if (raw === null) throw new Error('兴趣格式错误：应为字符串数组或逗号分隔字符串')
    const cleaned: string[] = []
    for (const item of raw) {
      const v = clampStr(item, 50)
      if (v !== '') cleaned.push(v)
      if (cleaned.length >= 20) break
    }
    if (cleaned.length === 0) delete next.profile.interests
    else next.profile.interests = cleaned
  }
  await store.domain.global.set(next)
  return profilePayload(deps)
}

/** 记忆列表（q 命中后与全量同样按 offset/limit 切页；limit 缺省走 bundle 配置）。 */
function memoriesPayload(deps: ApiDeps, keyword?: string, offset?: number, limit?: number): Record<string, unknown> {
  const { store } = deps
  const list = keyword !== undefined && keyword.trim() !== '' ? searchMemories(store, keyword) : allMemories(store)
  const pageOffset = offset ?? 0
  const pageSize = limit ?? 500
  const memories = list.slice(pageOffset, pageOffset + pageSize).map((m: MemoryRecord) => ({
    key: m.key,
    value: m.value,
    category: m.category,
    importance: m.importance,
    createdAt: new Date(m.createdAt).toISOString(),
  }))
  return { today: todayIso(), total: list.length, offset: pageOffset, memories }
}

async function actionMemoryAdd(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  const key = clampStr(body.key, 50)
  const value = clampStr(body.value, 1000)
  if (key.length < 2) throw new ActionError('missing_field', '键名至少需要 2 个字符（如「生日」「偏好」）', { field: 'key' })
  if (value === '') throw new ActionError('missing_field', '内容不能为空', { field: 'value' })
  const category = strOrUndef(body.category) ?? 'other'
  if (!(MEMORY_CATEGORIES as readonly string[]).includes(category)) throw new ActionError('missing_field', `分类必须是：${MEMORY_CATEGORIES.join('/')}`, { field: 'category' })
  const importance = strOrUndef(body.importance) ?? 'medium'
  if (!(MEMORY_IMPORTANCE as readonly string[]).includes(importance)) throw new ActionError('missing_field', `重要度必须是：${MEMORY_IMPORTANCE.join('/')}`, { field: 'importance' })
  const existed = deps.store.domain.table('memories').get(key) !== undefined
  if (existed && body.overwrite !== true) {
    throw new ActionError('overwrite_required', `「${key}」已存在，确认覆盖需携带 overwrite:true`, { key })
  }
  await saveMemory(deps.store, key, value, category as MemoryRecord['category'], importance as MemoryRecord['importance'])
  return { ok: true, key, overwrote: existed }
}

async function actionMemoryDelete(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['key'])
  const key = clampStr(body.key, 50)
  const removed = await deps.store.domain.table('memories').delete(key)
  if (!removed) throw new ActionError('not_found', `未找到「${key}」`, { key })
  return { ok: true, key }
}

async function actionMemoryClear(deps: ApiDeps): Promise<unknown> {
  const keys = [...deps.store.domain.table('memories').entries()].map(([key]) => key)
  for (const key of keys) await deps.store.domain.table('memories').delete(key)
  return { ok: true, count: keys.length }
}

// ===== 快速新建 / 删除 =====

// 分类名/颜色键校验已收口至 store（validateCategoryName/validateColorKey），
// 与对话工具同源抛稳定 code，客户端本地化文案保持一致。

async function actionCreateWish(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['title', 'categoryName'])
  // 记录构造与校验统一走 store.createWish（工具面同一收口）；此处不再静默截断字段
  const wish = await createWish(deps.store, {
    title: String(body.title),
    categoryName: String(body.categoryName),
    ...(strOrUndef(body.colorKey) !== undefined ? { colorKey: strOrUndef(body.colorKey) } : {}),
    ...(strOrUndef(body.description) !== undefined ? { description: strOrUndef(body.description) } : {}),
    ...(strOrUndef(body.estimatedCompletionDate) !== undefined ? { estimatedCompletionDate: strOrUndef(body.estimatedCompletionDate) } : {}),
  }, todayIso())
  return { ok: true, wish: { ...freshWish(deps.store, wish) } }
}

async function actionCreateTask(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['name', 'cycle'])
  const name = clampStr(body.name, 100)
  if (name === '') throw new ActionError('missing_field', '任务名不能为空', { field: 'name' })
  const cycle = String(body.cycle)
  if (!(CYCLES as readonly string[]).includes(cycle)) {
    throw new ActionError('missing_field', `周期必须是：${CYCLES.join('/')}`, { field: 'cycle' })
  }
  const dueRaw = strOrUndef(body.dueDate)
  if (dueRaw !== undefined) isoDateOrThrow(dueRaw)
  const hint = strOrUndef(body.hint)
  const wishId = strOrUndef(body.wishId)
  const task = await createTask(deps.store, {
    name,
    checkInCycle: cycle as (typeof CYCLES)[number],
    ...(dueRaw !== undefined ? { dueDate: dueRaw } : {}),
    ...(wishId !== undefined ? { wishId } : {}),
    ...(hint !== undefined ? { hint } : {}),
    source: 'user',
  }, todayIso())
  // 愿望库存进度由 createTask 内部联动落库（与工具面同一收口）
  return { ok: true, task: taskView(deps.store, task) }
}

async function actionDeleteTask(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['taskId'])
  const { store } = deps
  const taskId = String(body.taskId)
  const task = await removeTaskCompletely(store, taskId)
  if (task === undefined) throw new ActionError('not_found', `任务不存在：${taskId}`)
  return { ok: true, taskId: task.taskId, name: task.name }
}

async function actionDeleteWish(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['wishId'])
  const { store } = deps
  const wishId = String(body.wishId)
  const wish = store.domain.table('wishes').get(wishId)
  if (wish === undefined) throw new ActionError('not_found', `愿望不存在：${wishId}`)
  // 子树级联清理（任务/打卡/微行动状态）；愿望本体已删，进度无需回写
  await removeWishCompletely(store, wishId)
  return { ok: true, wishId, title: wish.title }
}

// ===== 分类管理 =====

async function setCategoryOverride(deps: ApiDeps, name: string, colorKey: string | null): Promise<void> {
  const global = deps.store.domain.global.get()
  const overrides = { ...(global.categoryColors ?? {}) }
  if (colorKey === null) delete overrides[name]
  else overrides[name] = colorKey
  const next = { ...global, categoryColors: Object.keys(overrides).length > 0 ? overrides : undefined }
  await deps.store.domain.global.set(next)
}

async function actionCategoryRename(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['oldName', 'newName'])
  const oldName = clampStr(body.oldName, 6)
  const newName = validateCategoryName(clampStr(body.newName, 6))
  if (oldName === newName) return { ok: true, renamed: 0 }
  // 与对话侧 rename_wish_category 同一写路径：愿望改名 + 覆盖键迁移（store 层收口）
  const renamed = await renameCategory(deps.store, oldName, newName)
  return { ok: true, renamed: renamed.length }
}

async function actionCategoryColor(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['name'])
  const name = clampStr(body.name, 6)
  // colorKey 为空串 = 清除覆盖（跟随愿望显式色/哈希兜底）
  const rawColor = typeof body.colorKey === 'string' && body.colorKey !== '' ? validateColorKey(body.colorKey) : null
  const colorKey: string | null = rawColor ?? null
  await setCategoryOverride(deps, name, colorKey)
  return { ok: true, name, colorKey }
}
