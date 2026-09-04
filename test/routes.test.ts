/**
 * 路由动作面测试：直调导出的 postApi（页面按钮 = 用户本人授权的同一写路径）。
 * 覆盖双平面一致性：删除级联（含微行动状态）、领取联动愿望进度、
 * 分类改名的覆盖键迁移与对话侧工具同口径。
 */
import { describe, expect, it } from 'vitest'
import { getApi, postApi } from '../src/routes/api.js'
import type { ApiDeps } from '../src/routes/api.js'
import type { RoutesConfig } from '../src/routes/config.js'
import { createTask, claimTask, performCheckIn } from '../src/store.js'
import { startMicroAction, getMicroAction } from '../src/micro.js'
import { addDays, todayIso } from '../src/opportunity.js'
import type { WishRecord, XingyuanStore } from '../src/domain.js'
import { memoryStore } from './memory-store.js'

function makeDeps(store: XingyuanStore): ApiDeps {
  const config: RoutesConfig = { rangeDefaultDays: 7, rangeMaxDays: 31, memoryListLimit: 500 }
  return { store, config }
}

async function seedWish(store: XingyuanStore, wishId: string): Promise<WishRecord> {
  const wish: WishRecord = {
    wishId,
    title: `愿望${wishId}`,
    categoryName: '学习',
    progress: 0,
    totalRequiredDays: 0,
    totalCompletedDays: 0,
    archived: false,
    createdAt: `${todayIso()}T00:00:00`,
  }
  await store.domain.table('wishes').put(wishId, wish)
  return wish
}

async function seedLiveTask(store: XingyuanStore, name: string, wishId?: string): Promise<string> {
  const today = todayIso()
  const task = await createTask(store, {
    name,
    checkInCycle: 'daily',
    dueDate: today,
    ...(wishId !== undefined ? { wishId } : {}),
  }, today)
  await claimTask(store, task.taskId, today)
  await performCheckIn(store, task.taskId, today, today)
  await startMicroAction(store, task.taskId, [
    { instruction: '第一步' },
    { instruction: '第二步' },
    { instruction: '第三步' },
  ])
  return task.taskId
}

describe('路由动作面：删除级联（与工具面共用收口）', () => {
  it('/api/action/delete-task：打卡与微行动状态一并清理，愿望进度同步', async () => {
    const store = memoryStore()
    const wishId = 'w-route-del'
    await seedWish(store, wishId)
    const taskId = await seedLiveTask(store, '路由删除样本', wishId)
    const deps = makeDeps(store)
    const reply = await postApi(deps, '/api/action/delete-task', { taskId }) as { ok: boolean }
    expect(reply.ok).toBe(true)
    expect(store.domain.table('tasks').get(taskId)).toBeUndefined()
    expect([...store.domain.table('checkins').entries()]).toHaveLength(0)
    expect(getMicroAction(store, taskId)).toBeUndefined()
    const storedWish = store.domain.table('wishes').get(wishId)!
    expect(storedWish.totalRequiredDays).toBe(0)
    expect(storedWish.totalCompletedDays).toBe(0)
  })

  it('/api/action/delete-wish：整棵子树级联清理', async () => {
    const store = memoryStore()
    const wishId = 'w-route-cascade'
    await seedWish(store, wishId)
    const taskId = await seedLiveTask(store, '子树任务', wishId)
    const deps = makeDeps(store)
    const reply = await postApi(deps, '/api/action/delete-wish', { wishId }) as { ok: boolean }
    expect(reply.ok).toBe(true)
    expect(store.domain.table('wishes').get(wishId)).toBeUndefined()
    expect(store.domain.table('tasks').get(taskId)).toBeUndefined()
    expect([...store.domain.table('checkins').entries()]).toHaveLength(0)
    expect(getMicroAction(store, taskId)).toBeUndefined()
  })

  it('/api/action/delete-task：任务不存在返回 not_found 码', async () => {
    const deps = makeDeps(memoryStore())
    await expect(postApi(deps, '/api/action/delete-task', { taskId: 'ghost' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('路由动作面：领取联动愿望进度', () => {
  it('/api/action/claim：requiredDays 按领取日重算并同步愿望库存总数', async () => {
    const store = memoryStore()
    const wishId = 'w-route-claim'
    await seedWish(store, wishId)
    const today = todayIso()
    const task = await createTask(store, {
      wishId,
      name: '延迟领取',
      checkInCycle: 'daily',
      dueDate: today,
    }, today)
    const deps = makeDeps(store)
    await postApi(deps, '/api/action/claim', { taskId: task.taskId })
    const stored = store.domain.table('wishes').get(wishId)!
    expect(stored.totalRequiredDays).toBe(1) // 领取日=截止日 → 唯一机会日
  })
})

describe('承诺口径：未领取任务不计入今日进度与月历完成判定', () => {
  const url = (query: string): URL => new URL(`http://localhost/xingyuan/api${query}`)

  it('overview：今日进度/待打卡只统计已领取任务，未领取不拖分母', async () => {
    const store = memoryStore()
    const today = todayIso()
    const claimed = await createTask(store, { name: '已领取', checkInCycle: 'daily', dueDate: today }, today)
    await claimTask(store, claimed.taskId, today)
    await createTask(store, { name: '未领取', checkInCycle: 'daily', dueDate: today }, today)
    const payload = getApi(makeDeps(store), '/api/overview', url('/overview')) as {
      total: number
      checked: number
      uncheckedCount: number
      unchecked: Array<{ name: string; status: string }>
    }
    expect(payload.total).toBe(1) // 未领取机会日落位今天，但不进承诺分母
    expect(payload.uncheckedCount).toBe(1)
    expect(payload.unchecked.map((t) => t.name)).toEqual(['已领取'])
  })

  it('overview：已领取任务全部打卡后 全部完成 判定不被未领取任务挡住', async () => {
    const store = memoryStore()
    const today = todayIso()
    const claimed = await createTask(store, { name: '已领取', checkInCycle: 'daily', dueDate: today }, today)
    await claimTask(store, claimed.taskId, today)
    await performCheckIn(store, claimed.taskId, today, today)
    await createTask(store, { name: '未领取', checkInCycle: 'daily', dueDate: today }, today)
    const payload = getApi(makeDeps(store), '/api/overview', url('/overview')) as {
      total: number
      checked: number
      uncheckedCount: number
    }
    expect(payload).toMatchObject({ total: 1, checked: 1, uncheckedCount: 0 })
  })

  it('calendar：月历格子 due/checked 只统计已领取任务，完成判定同口径', async () => {
    const store = memoryStore()
    const today = todayIso()
    const claimed = await createTask(store, { name: '已领取', checkInCycle: 'daily', dueDate: today }, today)
    await claimTask(store, claimed.taskId, today)
    await performCheckIn(store, claimed.taskId, today, today)
    await createTask(store, { name: '未领取', checkInCycle: 'daily', dueDate: today }, today)
    const payload = getApi(makeDeps(store), '/api/calendar', url(`/calendar?month=${today.slice(0, 7)}`)) as {
      weeks: Array<Array<{ date: string | null; checked: number; due: number }>>
    }
    const cell = payload.weeks.flat().find((c) => c.date === today)!
    expect(cell.due).toBe(1) // 未领取任务的机会日不占格子、不拖完成判定
    expect(cell.checked).toBe(1)
  })

  it('day：once 无截止日任务打卡当天保留完成区行，次日起退出日程面（已完结不占承诺尺度）', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '一次整理', checkInCycle: 'once' }, today)
    await claimTask(store, task.taskId, today)
    await performCheckIn(store, task.taskId, today, today)
    // 打卡当天：行以 checked 形式保留（完成区撤销入口），不产生待打卡
    const sameDay = getApi(makeDeps(store), '/api/day', url(`/day?date=${today}`)) as {
      tasks: Array<Record<string, unknown>>
    }
    const sameRow = sameDay.tasks.find((t) => t.taskId === task.taskId)
    expect(sameRow).toBeDefined()
    expect(sameRow!.checked).toBe(true)
    // 次日起：closed+achieved 且未勾当天 → 退出日程面——不占待打卡/进度分母/日历格，
    // 「今天全部完成」不被已完成任务永久挡住（评审 C2 回归锁定）
    const tomorrow = addDays(today, 1)
    const nextDay = getApi(makeDeps(store), '/api/day', url(`/day?date=${tomorrow}`)) as {
      tasks: Array<Record<string, unknown>>
    }
    expect(nextDay.tasks.some((t) => t.taskId === task.taskId)).toBe(false)
  })

  it('range：成长区间图按已领取口径——未领取任务不构成失败缺口', async () => {
    const store = memoryStore()
    const today = todayIso()
    await createTask(store, { name: '未领取', checkInCycle: 'daily', dueDate: today }, today)
    const base = getApi(makeDeps(store), '/api/range', url(`/range?start=${today}&end=${today}`)) as {
      days: Array<{ date: string; total: number; checked: number; tasks: Array<Record<string, unknown>> }>
    }
    // 未领取任务的机会日落位今天，但区间图（已领取口径）不产缺口、不列行
    expect(base.days[0]).toMatchObject({ date: today, total: 0, checked: 0 })
    expect(base.days[0]!.tasks).toEqual([])
    const claimed = await createTask(store, { name: '已领取', checkInCycle: 'daily', dueDate: today }, today)
    await claimTask(store, claimed.taskId, today)
    const after = getApi(makeDeps(store), '/api/range', url(`/range?start=${today}&end=${today}`)) as {
      days: Array<{ date: string; total: number; checked: number; tasks: Array<Record<string, unknown>> }>
    }
    expect(after.days[0]).toMatchObject({ date: today, total: 1, checked: 0 })
    expect(after.days[0]!.tasks.map((t) => t.taskId)).toEqual([claimed.taskId])
  })

  it('day：过期关闭任务保留在截止日所在日程面（失败记录），claimed=true 且不可打卡', async () => {
    const store = memoryStore()
    const today = todayIso()
    const anchor = addDays(today, -5)
    const task = await createTask(store, { name: '过期任务', checkInCycle: 'daily', dueDate: addDays(today, -3) }, anchor)
    await claimTask(store, task.taskId, anchor)
    // 截止日已过（读侧新鲜化 → closed/expired）：行不抹去、已领取、未勾、不可打卡——
    // 月历格/区间图的错过记录由此而来；复活走详情页延长截止日（§5.2 规则 7 澄清）
    const payload = getApi(makeDeps(store), '/api/day', url(`/day?date=${addDays(today, -3)}`)) as {
      tasks: Array<{ taskId: string; claimed: boolean; checked: boolean; canCheckIn: boolean }>
    }
    const row = payload.tasks.find((t) => t.taskId === task.taskId)
    expect(row).toBeDefined()
    expect(row!.claimed).toBe(true) // isClaimed 对 closed 复真
    expect(row!.checked).toBe(false)
    expect(row!.canCheckIn).toBe(false)
  })
})
