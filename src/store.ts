/**
 * 星愿业务操作：工具面与 /xingyuan/* 路由共用的领域逻辑。
 * 口径唯一来源：机会日/达标/复活判定全部走 opportunity.ts。
 */
import type { CheckinRecord, MemoryRecord, TaskRecord, WishRecord, XingyuanStore } from './domain.js'
import {
  addDays,
  calculateOpportunityDates,
  calculateRequiredDays,
  findFirstUncheckedOpportunityDate,
  isTaskDone,
  shouldRestartFromExpired,
  todayIso,
} from './opportunity.js'
export type Wish = WishRecord
export type Task = TaskRecord

/** 周期中文标签（工具回包/卡片/上下文共用）。 */
export const CYCLE_LABELS: Record<Task['checkInCycle'], string> = {
  once: '仅一次',
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
}

export interface DayPlan {
  readonly date: string
  readonly items: readonly DayItem[]
}

export interface DayItem {
  readonly task: Task
  readonly wish?: Wish
  readonly checked: boolean
  readonly canCheckIn: boolean
  readonly canCancel: boolean
}

/** 任务勾选集合：O(1) 判存在。 */
export function checkedDatesOf(store: XingyuanStore, taskId: string): Set<string> {
  const dates = new Set<string>()
  for (const [, record] of store.domain.table('checkins').entries()) {
    if (record.taskId === taskId) dates.add(record.date)
  }
  return dates
}

/** 锚点日：领取日，无领取日为创建日。 */
export function anchorOf(task: Task): string {
  return task.claimDate ?? task.createdAt.slice(0, 10)
}

/** 重算并写回任务状态/进度（打卡、取消打卡、更新、领取后调用）。 */
export async function syncTaskProgress(store: XingyuanStore, taskId: string, today = todayIso()): Promise<Task> {
  return store.domain.table('tasks').update(taskId, (task) => syncTaskValue(store, task, today))
}

/** 纯函数版状态推进（供 update 内使用）。 */
function syncTaskValue(store: XingyuanStore, task: Task, today: string): Task {
  const completed = countCheckins(store, task.taskId)
  const next: Task = { ...task, completedDays: completed }
  if (isTaskDone(next.requiredDays, completed)) {
    return { ...next, status: 'closed', closedReason: 'achieved' }
  }
  if (next.status === 'in_progress' && next.dueDate && next.dueDate < today) {
    return { ...next, status: 'closed', closedReason: 'expired' }
  }
  if (
    next.status === 'closed'
    && next.closedReason === 'achieved'
    && !isTaskDone(next.requiredDays, completed)
  ) {
    // 取消打卡导致不再达标（仅达成关闭可被取消打卡拉回进行中；过期关闭须延长截止日复活）
    return { ...next, status: 'in_progress', closedReason: undefined }
  }
  return next
}

function countCheckins(store: XingyuanStore, taskId: string): number {
  let n = 0
  for (const [, record] of store.domain.table('checkins').entries()) {
    if (record.taskId === taskId) n++
  }
  return n
}

/** 愿望进度重算：全部任务的应打/已打汇总，progress = 完成率百分比。 */
export async function syncWishProgress(store: XingyuanStore, wishId: string): Promise<void> {
  let required = 0
  let completed = 0
  for (const [, task] of store.domain.table('tasks').entries()) {
    if (task.wishId !== wishId) continue
    required += task.requiredDays
    completed += task.completedDays
  }
  const progress = required > 0 ? Math.min(100, Math.round((completed / required) * 100)) : 0
  await store.domain.table('wishes').update(wishId, (wish) => ({
    ...wish,
    totalRequiredDays: required,
    totalCompletedDays: completed,
    progress,
    archived: progress >= 100,
  }))
}

/**
 * 只读新鲜化：按今日重算任务状态（不落库——落库仍只发生在写路径）。
 * 跨日陈旧（截止关闭等）由读侧消除，模型与页面看到的状态恒为最新。
 */
export function freshTask(store: XingyuanStore, task: Task, today = todayIso()): Task {
  return syncTaskValue(store, task, today)
}

/** 愿望进度快照（只读新鲜计算，不落库）：下属任务应打/已打汇总 → 完成率。 */
export function freshWish(store: XingyuanStore, wish: Wish): Wish {
  let required = 0
  let completed = 0
  for (const [, task] of store.domain.table('tasks').entries()) {
    if (task.wishId !== wish.wishId) continue
    required += task.requiredDays
    completed += task.completedDays
  }
  const progress = required > 0 ? Math.min(100, Math.round((completed / required) * 100)) : 0
  return { ...wish, totalRequiredDays: required, totalCompletedDays: completed, progress, archived: progress >= 100 }
}

/**
 * 执行一次打卡。返回实际勾选的机会日。
 * - 不传日期：自动勾选今天（含）起最早未勾选机会日；
 *   once 无截止日 → 勾今天（打卡当天即打卡日）。
 * - 指定日期：必须可勾（once 无截止日限今天；其余限机会日内），过去日期即补卡。
 * - 未来日期由调用方先经 HITL 确认（提前打卡 = 承诺当天完成）。
 */
export async function performCheckIn(
  store: XingyuanStore,
  taskId: string,
  date: string | undefined,
  today = todayIso(),
): Promise<{ date: string; task: Task }> {
  const tasks = store.domain.table('tasks')
  const task = tasks.get(taskId)
  if (!task) throw new ToolError(`任务不存在：${taskId}`, 'not_found')
  if (task.status === 'pending') throw new ToolError('任务尚未领取，请先领取任务')
  if (task.status === 'closed') throw new ToolError('任务已完结，无法打卡', 'task_closed')

  const checked = checkedDatesOf(store, taskId)
  const target = date ?? findFirstUncheckedOpportunityDate(anchorOf(task), task.dueDate, task.checkInCycle, checked, today)
  if (!target) throw new ToolError('没有可勾选的打卡日：机会日已全部完成或截止')
  if (checked.has(target)) throw new ToolError(`${target} 已打卡`, 'already_checked', { date: target })
  validateTargetDate(task, target, today)

  const record: CheckinRecord = {
    checkinId: store.checkinKey(taskId, target),
    taskId,
    date: target,
    checkedAt: new Date().toISOString(),
  }
  await store.domain.table('checkins').put(record.checkinId, record)
  const updated = await syncTaskProgress(store, taskId, today)
  if (updated.wishId) await syncWishProgress(store, updated.wishId)
  return { date: target, task: updated }
}

function validateTargetDate(task: Task, target: string, today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new ToolError(`日期格式错误：${target}`)
  if (!task.dueDate && task.checkInCycle === 'once') {
    // once 无截止日：点击打卡即完成，打卡日=操作当天
    if (target !== today) throw new ToolError(`该任务为仅一次任务且未设截止日，只能打卡今天（${today}）`)
    return
  }
  if (!task.dueDate) {
    // 无截止日非一次任务无机会日约束：允许任意日期补记（与「无机会日约束」口径一致）
    return
  }
  const opportunities = calculateOpportunityDates(anchorOf(task), task.dueDate, task.checkInCycle)
  if (!opportunities.includes(target)) {
    throw new ToolError(`${target} 不是该任务的打卡日，只能勾选机会日内的日期`, 'not_opportunity_day', { date: target })
  }
}

/** 取消打卡：指定日期撤销；不传日期取消最近一次。 */
export async function cancelCheckIn(
  store: XingyuanStore,
  taskId: string,
  date: string | undefined,
  today = todayIso(),
): Promise<{ date: string; task: Task }> {
  const checkins = store.domain.table('checkins')
  let target = date
  if (!target) {
    let latest: CheckinRecord | undefined
    for (const [, record] of checkins.entries()) {
      if (record.taskId !== taskId) continue
      if (!latest || record.date > latest.date) latest = record
    }
    if (!latest) throw new ToolError('该任务暂无打卡记录')
    target = latest.date
  }
  const removed = await checkins.delete(store.checkinKey(taskId, target))
  if (!removed) throw new ToolError(`${target} 没有打卡记录`, 'not_found', { date: target })
  const updated = await syncTaskProgress(store, taskId, today)
  if (updated.wishId) await syncWishProgress(store, updated.wishId)
  return { date: target, task: updated }
}

/** 创建任务（requiredDays 由计算器唯一口径得出）。 */
export async function createTask(
  store: XingyuanStore,
  input: Pick<Task, 'name' | 'checkInCycle'> & Partial<Pick<Task, 'wishId' | 'hint' | 'dueDate' | 'source' | 'status'>>,
  today = todayIso(),
): Promise<Task> {
  const dueDate = normalizeDue(input.dueDate)
  if (input.dueDate && input.dueDate < today) throw new ToolError('截止日期不能早于今天', 'due_past')
  if (input.wishId !== undefined && store.domain.table('wishes').get(input.wishId) === undefined) {
    throw new ToolError(`愿望不存在：${input.wishId}`)
  }
  const requiredDays = calculateRequiredDays(today, dueDate, input.checkInCycle)
  const task: Task = {
    taskId: store.newId(),
    wishId: input.wishId,
    name: input.name,
    hint: input.hint,
    dueDate,
    checkInCycle: input.checkInCycle,
    source: input.source ?? 'ai',
    status: input.status ?? 'pending',
    claimDate: input.status === 'in_progress' ? today : undefined,
    requiredDays,
    completedDays: 0,
    createdAt: `${today}T00:00:00`,
  }
  await store.domain.table('tasks').put(task.taskId, task)
  return task
}

function normalizeDue(due: string | undefined): string | undefined {
  if (!due) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ToolError(`日期格式错误，请使用 yyyy-MM-dd：${due}`)
  return due
}

/**
 * 领取任务：pending → in_progress，锚点日=领取日。
 * 应打天数随锚点重算（与机会日序列同一口径）——否则「创建次日领取」后
 * 全部真实机会日勾完也永远达不到 requiredDays，任务无法达标完结。
 * 与 performCheckIn/cancelCheckIn 同为自足式写操作：内部完成进度联动。
 */
export async function claimTask(store: XingyuanStore, taskId: string, today = todayIso()): Promise<Task> {
  await store.domain.table('tasks').update(taskId, (task) => {
    if (task === undefined) throw new ToolError(`任务不存在：${taskId}`, 'not_found')
    if (task.status !== 'pending') throw new ToolError('只有待领取状态的任务可以领取', 'already_claimed')
    return {
      ...task,
      status: 'in_progress',
      claimDate: today,
      requiredDays: calculateRequiredDays(today, task.dueDate, task.checkInCycle),
    }
  })
  // 领取即过期（截止日已过）：立即落过期关闭，而非等下次读写路径新鲜化
  const synced = await syncTaskProgress(store, taskId, today)
  if (synced.wishId !== undefined) await syncWishProgress(store, synced.wishId)
  return synced
}

/** 更新任务（部分更新）；延长已过期任务的截止日触发重新开始。 */
export async function updateTask(
  store: XingyuanStore,
  taskId: string,
  patch: Partial<Pick<Task, 'name' | 'hint' | 'dueDate' | 'checkInCycle'>>,
  today = todayIso(),
): Promise<Task> {
  const dueDate = patch.dueDate === undefined ? undefined : normalizeDue(patch.dueDate)
  // 与 createTask 同一约束：截止日不得早于今天（否则立即触发过期关闭，违背用户意图）
  if (patch.dueDate !== undefined && dueDate !== undefined && dueDate < today) {
    throw new ToolError('截止日期不能早于今天')
  }
  const updated = await store.domain.table('tasks').update(taskId, (task) => {
    const merged: Task = {
      ...task,
      name: patch.name ?? task.name,
      hint: patch.hint ?? task.hint,
      dueDate: dueDate ?? task.dueDate,
      checkInCycle: patch.checkInCycle ?? task.checkInCycle,
    }
    if (patch.dueDate !== undefined || patch.checkInCycle !== undefined) {
      merged.requiredDays = calculateRequiredDays(anchorOf(merged), merged.dueDate, merged.checkInCycle)
      if (shouldRestartFromExpired(task.status, task.dueDate, today, task.requiredDays, task.completedDays)) {
        return { ...merged, status: 'in_progress', closedReason: undefined }
      }
    }
    return merged
  })
  return syncTaskProgress(store, taskId, today).then(() => store.domain.table('tasks').get(taskId)!)
}

/** 未来 N 天逐日安排（today 页/未来预览共用）。 */
export function planForRange(store: XingyuanStore, start: string, end: string): DayPlan[] {
  const plans: DayPlan[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) plans.push(planForDay(store, d))
  return plans
}

/** 单日安排：机会日落位 + 打卡状态。 */
export function planForDay(store: XingyuanStore, date: string): DayPlan {
  const wishes = store.domain.table('wishes')
  const items: DayItem[] = []
  for (const [taskId, task] of store.domain.table('tasks').entries()) {
    if (task.status === 'closed' && task.closedReason === 'achieved') continue
    const opportunities = calculateOpportunityDates(anchorOf(task), task.dueDate, task.checkInCycle)
    if (!opportunities.includes(date)) continue
    const checked = store.domain.table('checkins').get(store.checkinKey(taskId, date)) !== undefined
    items.push({
      task,
      wish: task.wishId ? wishes.get(task.wishId) : undefined,
      checked,
      canCheckIn: !checked && task.status !== 'pending',
      canCancel: checked,
    })
  }
  items.sort((a, b) => a.task.name.localeCompare(b.task.name))
  return { date, items }
}

/**
 * 分类改名（工具面与页面动作唯一写路径）：批量迁移同名愿望，
 * global 颜色覆盖键同步迁移——旧键不再可达，不迁即孤儿。
 * 返回改名后的愿望记录（供事件补发）；覆盖迁移与愿望是否存在解耦
 * （分类管理面板允许存在零愿望的纯覆盖分类）。
 */
export async function renameCategory(store: XingyuanStore, oldName: string, newName: string): Promise<Wish[]> {
  const renamed: Wish[] = []
  for (const [key, wish] of store.domain.table('wishes').entries()) {
    if (wish.categoryName !== oldName) continue
    const next = { ...wish, categoryName: newName }
    await store.domain.table('wishes').put(key, next)
    renamed.push(next)
  }
  const global = store.domain.global.get()
  const overrides = { ...(global.categoryColors ?? {}) }
  if (overrides[oldName] !== undefined) {
    overrides[newName] = overrides[oldName]!
    delete overrides[oldName]
    await store.domain.global.set({ ...global, categoryColors: overrides })
  }
  return renamed
}

/** 记忆全量（新→旧）。 */
export function allMemories(store: XingyuanStore): MemoryRecord[] {
  const list: MemoryRecord[] = []
  for (const [, memory] of store.domain.table('memories').entries()) list.push(memory)
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

/** 今日待打卡（未勾选且今天有机会日）的任务。 */
export function todayUnchecked(store: XingyuanStore, today = todayIso()): DayItem[] {
  return planForDay(store, today).items.filter((item) => !item.checked)
}

/** 记忆存取。 */
export async function saveMemory(store: XingyuanStore, key: string, value: string, category: MemoryRecord['category'], importance: MemoryRecord['importance']): Promise<void> {
  await store.domain.table('memories').put(key, { key, value, category, importance, createdAt: Date.now() })
}

export function searchMemories(store: XingyuanStore, keyword: string): MemoryRecord[] {
  const needle = keyword.toLowerCase()
  const hits: MemoryRecord[] = []
  for (const [, memory] of store.domain.table('memories').entries()) {
    if (memory.key.toLowerCase().includes(needle) || memory.value.toLowerCase().includes(needle)) hits.push(memory)
  }
  return hits.sort((a, b) => b.createdAt - a.createdAt)
}
/**
 * 工具层领域错误 → 模型可见失败文案（isError 结果）。
 * 可选携带稳定 code/params：路由层原样透传进 400 响应体，客户端按 code 本地化，
 * 不再依赖中文消息子串匹配（卡片状态恢复等场景）；message 保持不变——模型侧口径不动。
 */
export class ToolError extends Error {
  readonly code?: string
  readonly params?: Record<string, unknown>

  constructor(message: string, code?: string, params?: Record<string, unknown>) {
    super(message)
    this.name = 'ToolError'
    if (code !== undefined) this.code = code
    if (params !== undefined) this.params = params
  }
}

/** 自然月首尾（日历月视图用；无参取今天所在月）。 */
export function monthRange(month: string | undefined, today: string): [string, string] {
  const base = month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : `${today.slice(0, 7)}-01`
  const [y, m] = [Number(base.slice(0, 4)), Number(base.slice(5, 7))]
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return [base, end]
}
