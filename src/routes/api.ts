/**
 * /xingyuan/api/* 处理器：JSON 数据面 + 动作面（页面按钮直连 = 用户本人授权）。
 * 与对话侧工具共用 store 单写者函数（进度恒新鲜口径一致）；页面动作不经 HITL，
 * 模型侧写操作仍走 userQuestions 确认，页面动作与模型动作的授权语义保持分离。
 *
 * 校验失败抛 ActionError（400 + 稳定 code）；未知路径抛 HttpError(404)。
 */
import type { XingyuanStore, TaskRecord, MemoryRecord } from '../domain.js'
import type { DayPlan } from '../store.js'
import {
  allMemories,
  anchorOf,
  checkedDatesOf,
  checkinCountIndex,
  clearMemories,
  createTask,
  createWish,
  cancelCheckIn,
  claimTask,
  deleteMemory,
  freshTask,
  freshWish,
  freshWishes,
  isClaimed,
  monthRange,
  performCheckIn,
  planForDay,
  planForRange,
  renameCategory,
  saveMemory,
  searchMemories,
  updateProfileGlobal,
  updateTask,
  validateCategoryName,
  validateColorKey,
} from '../store.js'
import { addDays, calculateOpportunityDates, findFirstUncheckedOpportunityDate, isIsoDate, todayIso } from '../opportunity.js'
import { LEVEL_CONFIGS, growthSummary } from '../growth.js'
import { getMicroAction } from '../micro.js'
import { mutateGlobal } from '../store.js'
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
/** 打卡记录网格窗口上限（格）。窗口=截至今日的机会日末 N 格，预勾的未来日并入后仍按 N 截尾。 */
const GRID_DATES_LIMIT = 28

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
  // 语义校验收口到 opportunity.isIsoDate（唯一口径，往返比对拒绝 2026-02-30 这类
  // 「形似合法」日期——Date.parse 只查「月01-12/日01-31」，不查月长度）
  if (!isIsoDate(value)) throw new ActionError(code, `日期不存在或格式错误（yyyy-MM-dd）：${value}`)
  return value
}

// ===== GET 数据面 =====

export function getApi(deps: ApiDeps, path: string, url: URL): unknown {
  const { store, config } = deps
  if (path === '/api/overview' || path === '/api/today') return overview(deps)
  if (path === '/api/day') return day(deps, url.searchParams.get('date') ?? undefined)
  if (path === '/api/range') {
    // 日期参数校验与 POST 面同一契约（bad_date）：非法 start 此前会在 addDays 内
    // 抛无 code 的 RangeError，客户端只能看到原始英文异常
    const startRaw = url.searchParams.get('start') ?? todayIso()
    const start = isoDateOrThrow(startRaw)
    const endRaw = url.searchParams.get('end') ?? addDays(start, config.rangeDefaultDays - 1)
    const end = isoDateOrThrow(endRaw)
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
  throw new HttpError(404, '未找到请求的资源', 'not_found')
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
    case '/api/action/update-task':
      return actionUpdateTask(deps, body)
    case '/api/action/category-rename':
      return actionCategoryRename(deps, body)
    case '/api/action/category-color':
      return actionCategoryColor(deps, body)
    default:
      throw new HttpError(404, '未找到请求的资源', 'not_found')
  }
}

// ===== 任务/愿望视图 =====

export function taskView(store: XingyuanStore, task: TaskRecord, counts?: Map<string, number>): Record<string, unknown> {
  const fresh = freshTask(store, task, todayIso(), counts)
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
    // 关闭原因（achieved/expired）：客户端据此区分「已达成/已过期」并给出复活入口
    ...(fresh.closedReason !== undefined ? { closedReason: fresh.closedReason } : {}),
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
    // 承诺口径布尔：client 展示层只消费该字段，不重复写 status 谓词（§5.2 规则 7 单一判定）
    claimed: isClaimed(item.task),
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
  // 承诺口径：今日进度/待打卡只统计已领取任务——未领取处于候选池，未承诺不算义务
  const claimed = plan.items.filter((item) => isClaimed(item.task))
  const due = claimed.filter((item) => !item.checked)
  return {
    today,
    total: claimed.length,
    checked: claimed.length - due.length,
    uncheckedCount: due.length,
    unchecked: due.map((item) => ({
      taskId: item.task.taskId,
      name: item.task.name,
      cycle: item.task.checkInCycle,
      wishName: item.wish?.title,
      hint: item.task.hint,
      status: item.task.status,
    })),
    links: { calendar: '/xingyuan/calendar', growth: '/xingyuan/growth' },
  }
}

function day(deps: ApiDeps, date?: string): Record<string, unknown> {
  // GET 面同样按 bad_date 契约拒绝非法日期（此前静默返回空任务列表，客户端无从察觉拼参错误）
  const target = date === undefined ? todayIso() : isoDateOrThrow(date)
  const plan = planForDay(deps.store, target)
  return { date: plan.date, tasks: dayTasks(plan), taskCount: plan.items.length }
}

function rangePlans(deps: ApiDeps, start: string, end: string): Array<Record<string, unknown>> {
  // 承诺口径（§5.2 规则 7 / 决策 11）：区间图是「我的执行记录」——未领取任务的机会日
  // 不是失败缺口，与月历/今日页同口径按已领取过滤（未领取不构成斜纹缺口）。
  // store.planForRange 保持计划口径不变（工具面未来安排查询仍含未领取并标注）。
  return planForRange(deps.store, start < end ? start : end, end > start ? end : start).map((plan) => {
    const claimed = plan.items.filter((item) => isClaimed(item.task))
    return {
      date: plan.date,
      total: claimed.length,
      checked: claimed.filter((item) => item.checked).length,
      tasks: dayTasks({ date: plan.date, items: claimed }),
    }
  })
}

function calendarMonth(deps: ApiDeps, month?: string): Record<string, unknown> {
  const today = todayIso()
  // month 形参语义校验：2026-13 这类字符串此前正则放行、Date 计算静默漂移到次年
  if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ActionError('bad_date', `月份格式错误，请使用 yyyy-MM：${month}`, { month })
  }
  const [start, end] = monthRange(month, today)
  // 月视图含首尾补齐的相邻月日子，由前端网格排布；这里给整月机会日事实
  const plans = planForRange(deps.store, start, end)
  const weeks: Array<Array<{ date: string | null; checked: number; due: number }>> = []
  let week: Array<{ date: string | null; checked: number; due: number }> = []
  const firstDow = new Date(`${start}T00:00:00Z`).getUTCDay()
  for (let pad = 0; pad < (firstDow + 6) % 7; pad++) week.push({ date: null, checked: 0, due: 0 })
  for (const plan of plans) {
    // 月历完成判定同承诺口径：未领取任务的机会日不占格子色调、不拖完成率
    const claimed = plan.items.filter((item) => isClaimed(item.task))
    const checked = claimed.filter((item) => item.checked).length
    week.push({ date: plan.date, checked, due: claimed.length })
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
    // completionRate 字段已移除：无消费方，且 round 口径与愿望进度的 floor 口径相悖，
    // 留着只会诱惑未来误用（完成率口径唯一来源是愿望进度 floor 公式）
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
  // 批量读契约（store.ts）：freshWishes 单遍任务索引 + checkinCountIndex 一次全表计数，
  // 替代逐任务 freshTask 的 O(T×checkins) 嵌套扫描
  const fresh = freshWishes(store)
  const counts = checkinCountIndex(store)
  const tasksByWish = new Map<string, Array<Record<string, unknown>>>()
  for (const [, t] of store.domain.table('tasks').entries()) {
    if (t.wishId === undefined) continue
    let bucket = tasksByWish.get(t.wishId)
    if (bucket === undefined) tasksByWish.set(t.wishId, bucket = [])
    bucket.push(taskView(store, t, counts))
  }
  return {
    today: todayIso(),
    wishes: fresh.map((w) => ({
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
      tasks: (tasksByWish.get(w.wishId) ?? []).sort(byDisplayOrder),
    })),
  }
}

function tasks(deps: ApiDeps): Record<string, unknown> {
  const counts = checkinCountIndex(deps.store)
  const list: Array<Record<string, unknown>> = []
  for (const [, t] of deps.store.domain.table('tasks').entries()) list.push(taskView(deps.store, t, counts))
  return { today: todayIso(), tasks: list.sort(byDisplayOrder) }
}

/** 任务详情聚合：任务快照 + 打卡记录网格（截至今天的机会日末段 + 预勾） + 未来预览 + 微行动状态。 */
function taskDetail(deps: ApiDeps, taskId: string | undefined): Record<string, unknown> {
  const { store } = deps
  if (taskId === undefined || taskId.trim() === '') throw new ActionError('missing_field', '缺少必填字段：taskId', { field: 'taskId' })
  const raw = store.domain.table('tasks').get(taskId)
  if (raw === undefined) throw new ActionError('not_found', `任务不存在：${taskId}`)
  const fresh = freshTask(store, raw)
  const checked = checkedDatesOf(store, taskId)
  const today = todayIso()
  const series = calculateOpportunityDates(anchorOf(fresh), fresh.dueDate, fresh.checkInCycle)
  // 网格窗口（回归 2026-08：整条序列曾把客户端 slice(-28) 推向未来尾部，
  // 今天的打卡反而不可见）：截至今天的机会日末 28 格为底，已打卡日期无条件并入——
  // 预勾（未来）与机会日序列之外的打卡（once 无截止日、无截止日周期任务任意日补记）
  // 都是既成事实，序列为空时网格即打卡历史（撤销入口依赖它）；仍未勾选的
  // 未来日归 upcoming 预览。
  const window = new Set(series.filter((date) => date <= today).slice(-GRID_DATES_LIMIT))
  for (const date of checked) window.add(date)
  // 「今天」恒在窗口：极端量级的未来预勾（>27 个）理论上可把它挤出末 28 截尾，
  // 「今天该打卡」的提示不能被吃掉（与日历 today 环同一原则）
  const trimmed = [...window].sort().slice(-GRID_DATES_LIMIT)
  const gridDates = trimmed.includes(today) || !window.has(today) ? trimmed : [...trimmed.slice(1), today].sort()
  const grid = gridDates.map((date) => ({
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
  // 写路径收口至 store.updateProfileGlobal（工具面同一实现：夹取/清理/串行队列同源）。
  // 文本字段非字符串一律折叠为 null（= store 层的「清除」语义），不做 String() 强转——
  // 否则 JSON null 会落成昵称字面量 "null" 并注入每轮系统提示；coachStyle 仍强转后
  // 校验（垃圾值报错而非静默忽略，校验在 store 层）
  const clearOrValue = (value: unknown): string | null | undefined =>
    value === undefined ? undefined : typeof value === 'string' ? value : null
  await updateProfileGlobal(store, {
    coachStyle: body.coachStyle !== undefined ? String(body.coachStyle) : undefined,
    nickname: clearOrValue(body.nickname),
    occupation: clearOrValue(body.occupation),
    interests: body.interests as string[] | string | undefined,
  })
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
  const removed = await deleteMemory(deps.store, key)
  if (!removed) throw new ActionError('not_found', `未找到「${key}」`, { key })
  return { ok: true, key }
}

async function actionMemoryClear(deps: ApiDeps): Promise<unknown> {
  const count = await clearMemories(deps.store)
  return { ok: true, count }
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
  // 超长显式报错而非静默截断——与愿望标题（store 报错）同一口径，用户知情才可修正
  const rawName = String(body.name).trim()
  if (rawName === '') throw new ActionError('missing_field', '任务名不能为空', { field: 'name' })
  if (rawName.length > 100) throw new ActionError('name_too_long', '任务名不能超过 100 字符（当前 ' + String(rawName.length) + ' 字）', { length: rawName.length })
  const name = rawName
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

/**
 * 更新任务（页面侧最小编辑面）：目前仅服务「延长截止日」复活闭环——
 * 过期任务在详情页延长截止日即重新开始（与对话侧 update_task 同一 store 写路径）。
 * 部分更新语义与工具面一致：未提及字段保留原值。
 */
async function actionUpdateTask(deps: ApiDeps, body: JsonBody): Promise<unknown> {
  requireFields(body, ['taskId'])
  const { store } = deps
  const taskId = String(body.taskId)
  if (store.domain.table('tasks').get(taskId) === undefined) throw new ActionError('not_found', `任务不存在：${taskId}`)
  // dueDate 必须是显式字符串：非字符串/空白按 bad_date 拒绝而非静默 no-op
  if (typeof body.dueDate !== 'string' || body.dueDate.trim() === '') {
    throw new ActionError('bad_date', `截止日期必须是合法的 yyyy-MM-dd 字符串：${String(body.dueDate)}`)
  }
  const dueRaw = isoDateOrThrow(body.dueDate.trim())
  const task = await updateTask(store, taskId, { dueDate: dueRaw })
  return { ok: true, task: taskView(store, task) }
}

// ===== 分类管理 =====

async function setCategoryOverride(deps: ApiDeps, name: string, colorKey: string | null): Promise<void> {
  // 读-改-写整体进串行队列：并发改不同分类颜色互不覆盖
  await mutateGlobal(deps.store, (global) => {
    const overrides = { ...(global.categoryColors ?? {}) }
    if (colorKey === null) delete overrides[name]
    else overrides[name] = colorKey
    return { ...global, categoryColors: Object.keys(overrides).length > 0 ? overrides : undefined }
  })
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
