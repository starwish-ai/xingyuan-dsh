/**
 * 完整性与口径回归：
 * - 启动一致性清扫（孤儿打卡/孤儿任务/悬挂微行动；幂等）
 * - global 串行写（并发读改写不丢更新——lost update 回归）
 * - 写路径新鲜化（过期任务不可经工具面补卡，须先复活——与页面同口径）
 * - once 无截止日任务今日常驻（待办/完成区/撤销入口闭环，明日不出现）
 * - 愿望进度 floor 口径（round 曾使 249/250 显示 100% 并提前归档）
 * - GET 日期参数 bad_date 契约（/api/day、/api/range 与 POST 面一致）
 */
import { describe, expect, it } from 'vitest'
import {
  claimTask,
  createTask,
  createWish,
  freshWish,
  mutateGlobal,
  performCheckIn,
  planForDay,
} from '../src/store.js'
import { sweepOrphans } from '../src/consistency-sweep.js'
import { getApi } from '../src/routes/api.js'
import type { ApiDeps } from '../src/routes/api.js'
import type { RoutesConfig } from '../src/routes/config.js'
import type { CheckinRecord, MicroActionState, TaskRecord, WishRecord } from '../src/domain.js'
import { addDays, todayIso } from '../src/opportunity.js'
import { memoryStore } from './memory-store.js'

const today = todayIso()

function putWish(store: ReturnType<typeof memoryStore>, wishId: string): void {
  void store.domain.table('wishes').put(wishId, {
    wishId, title: `愿望${wishId}`, categoryName: '学习',
    progress: 0, totalRequiredDays: 0, totalCompletedDays: 0, archived: false, createdAt: `${today}T00:00:00`,
  } satisfies WishRecord)
}

function putTask(store: ReturnType<typeof memoryStore>, taskId: string, patch: Partial<TaskRecord>): void {
  void store.domain.table('tasks').put(taskId, {
    taskId, name: `任务${taskId}`, checkInCycle: 'daily', source: 'ai', status: 'in_progress',
    requiredDays: 3, completedDays: 0, createdAt: `${today}T00:00:00`, ...patch,
  } satisfies TaskRecord)
}

function putCheckin(store: ReturnType<typeof memoryStore>, taskId: string, date: string): void {
  const key = `${taskId}|${date}`
  void store.domain.table('checkins').put(key, { checkinId: key, taskId, date, checkedAt: `${date}T10:00:00Z` } satisfies CheckinRecord)
}

function microState(taskId: string): MicroActionState {
  return {
    taskId,
    steps: [{ stepNumber: 1, instruction: '第一步', completed: false, skipped: false }],
    currentStepNumber: 1,
    updatedAt: `${today}T00:00:00Z`,
  }
}

describe('启动一致性清扫', () => {
  it('清除孤儿打卡、孤儿任务及其打卡、悬挂微行动；存活记录不动；幂等', async () => {
    const store = memoryStore()
    putWish(store, 'w1')
    putTask(store, 't1', { wishId: 'w1' })
    putCheckin(store, 't1', addDays(today, -1))
    putCheckin(store, 'ghost', addDays(today, -2)) // 打卡指向不存在的任务
    putTask(store, 'orphan', { wishId: 'ghost-wish' }) // 任务指向不存在的愿望
    putCheckin(store, 'orphan', addDays(today, -3))
    await store.domain.global.set({
      ...store.domain.global.get(),
      microActions: { t1: microState('t1'), 'ghost-micro': microState('ghost-micro') },
    })

    const report = await sweepOrphans(store)
    expect(report).toEqual({ orphanCheckins: 1, orphanTasks: 1, orphanMicroEntries: 1 })
    expect([...store.domain.table('checkins').keys()]).toEqual([`t1|${addDays(today, -1)}`])
    expect([...store.domain.table('tasks').keys()]).toEqual(['t1'])
    expect(Object.keys(store.domain.global.get().microActions!)).toEqual(['t1'])
    // 幂等：清扫后重跑零动作
    expect(await sweepOrphans(store)).toEqual({ orphanCheckins: 0, orphanTasks: 0, orphanMicroEntries: 0 })
  })

  it('清扫后再跑一遍零动作（幂等）', async () => {
    const store = memoryStore()
    putTask(store, 'loose', { wishId: undefined }) // 无愿望关联的独立任务是合法存活
    const report = await sweepOrphans(store)
    expect(report).toEqual({ orphanCheckins: 0, orphanTasks: 0, orphanMicroEntries: 0 })
    expect([...store.domain.table('tasks').keys()]).toContain('loose')
  })
})

describe('global 串行写（lost update 防护）', () => {
  it('并发变更不同字段互不覆盖', async () => {
    const store = memoryStore()
    await Promise.all([
      mutateGlobal(store, (global) => ({ ...global, coachStyle: 'strict' })),
      mutateGlobal(store, (global) => ({ ...global, categoryColors: { 学习: 'blue' } })),
    ])
    const global = store.domain.global.get()
    expect(global.coachStyle).toBe('strict')
    expect(global.categoryColors).toEqual({ 学习: 'blue' })
  })

  it('失败的一笔不阻塞后续写入', async () => {
    const store = memoryStore()
    await expect(mutateGlobal(store, () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    await mutateGlobal(store, (global) => ({ ...global, coachStyle: 'humorous' }))
    expect(store.domain.global.get().coachStyle).toBe('humorous')
  })
})

describe('写路径新鲜化（过期任务不可补卡）', () => {
  it('跨日过期后库存仍是 in_progress，工具面打卡被拒且不留记录', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '限时', checkInCycle: 'daily', dueDate: addDays(today, 1) }, today)
    await claimTask(store, task.taskId, today)
    const futureToday = addDays(today, 5)
    await expect(performCheckIn(store, task.taskId, addDays(today, 1), futureToday))
      .rejects.toMatchObject({ code: 'task_closed' })
    expect([...store.domain.table('checkins').keys()]).toHaveLength(0)
  })
})

describe('once 无截止日任务今日常驻', () => {
  it('今日可见可打卡；明日不出现；打卡后保留在完成区可撤销', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '随时做', checkInCycle: 'once' }, today)
    await claimTask(store, task.taskId, today)
    const todayItem = planForDay(store, today).items.find((item) => item.task.taskId === task.taskId)
    expect(todayItem?.canCheckIn).toBe(true)
    expect(planForDay(store, addDays(today, 1)).items).toHaveLength(0)
    await performCheckIn(store, task.taskId, undefined, today)
    const done = planForDay(store, today).items.find((item) => item.task.taskId === task.taskId)
    expect(done?.checked).toBe(true)
    expect(done?.canCancel).toBe(true)
  })
})

describe('愿望进度 floor 口径（提前归档回归）', () => {
  it('249/250 = 99% 不归档；250/250 = 100% 归档', () => {
    const store = memoryStore()
    putWish(store, 'w')
    putTask(store, 't', { wishId: 'w', requiredDays: 250, completedDays: 249 })
    const fresh = freshWish(store, store.domain.table('wishes').get('w')!)
    expect(fresh.progress).toBe(99)
    expect(fresh.archived).toBe(false)
    void store.domain.table('tasks').update('t', (task) => ({ ...(task as TaskRecord), completedDays: 250 }))
    const done = freshWish(store, store.domain.table('wishes').get('w')!)
    expect(done.progress).toBe(100)
    expect(done.archived).toBe(true)
  })
})

describe('愿望达成谓词（承诺口径：候选不进分母，但拦达成）', () => {
  it('满进度而有候选 = 待结算：不归档；候选删除（收尾）后达成', async () => {
    const store = memoryStore()
    putWish(store, 'w')
    putTask(store, 't-done', { wishId: 'w', requiredDays: 2, completedDays: 2, status: 'closed', closedReason: 'achieved' })
    putTask(store, 't-pending', { wishId: 'w', status: 'pending', requiredDays: 5, completedDays: 0 })
    const settled = freshWish(store, store.domain.table('wishes').get('w')!)
    expect(settled.progress).toBe(100) // 候选的 5 天不进分母
    expect(settled.totalRequiredDays).toBe(2)
    expect(settled.totalCompletedDays).toBe(2)
    expect(settled.archived).toBe(false) // 候选拦达成
    // 用户删除候选（修订计划收尾）→ 达成谓词满足
    await store.domain.table('tasks').delete('t-pending')
    const done = freshWish(store, store.domain.table('wishes').get('w')!)
    expect(done.progress).toBe(100)
    expect(done.archived).toBe(true)
  })

  it('全候选愿望：进度 0 且无分母（页面显示「计划中」的语义）', () => {
    const store = memoryStore()
    putWish(store, 'w')
    putTask(store, 't-pending', { wishId: 'w', status: 'pending', requiredDays: 5, completedDays: 0 })
    const fresh = freshWish(store, store.domain.table('wishes').get('w')!)
    expect(fresh.progress).toBe(0)
    expect(fresh.totalRequiredDays).toBe(0)
    expect(fresh.archived).toBe(false)
  })

  it('候选领取即扩大承诺范围：进度回落，愿望退出可达成态', () => {
    const store = memoryStore()
    putWish(store, 'w')
    putTask(store, 't-done', { wishId: 'w', requiredDays: 2, completedDays: 2, status: 'closed', closedReason: 'achieved' })
    putTask(store, 't-pending', { wishId: 'w', status: 'pending', requiredDays: 5, completedDays: 0 })
    // 领取候选（承诺口径下分母加入其 5 天）→ 进度回落、不再满足达成谓词
    void store.domain.table('tasks').update('t-pending', (task) => ({ ...(task as TaskRecord), status: 'in_progress', claimDate: todayIso() }))
    const claimed = freshWish(store, store.domain.table('wishes').get('w')!)
    expect(claimed.progress).toBe(Math.floor((2 / 7) * 100))
    expect(claimed.archived).toBe(false)
  })
})

describe('GET 日期参数 bad_date 契约', () => {
  const config: RoutesConfig = { rangeDefaultDays: 7, rangeMaxDays: 31, memoryListLimit: 500 }
  function deps(): ApiDeps {
    return { store: memoryStore(), config }
  }
  const url = (query: string): URL => new URL(`http://localhost/xingyuan/api${query}`)

  function catchCode(run: () => unknown): string | undefined {
    try {
      run()
      return undefined
    } catch (error) {
      return (error as { code?: string }).code
    }
  }

  it('/api/day 非法日期拒绝（此前静默返回空列表）', () => {
    expect(catchCode(() => getApi(deps(), '/api/day', url('/day?date=nope')))).toBe('bad_date')
    const payload = getApi(deps(), '/api/day', url(`/day?date=${today}`)) as { date: string }
    expect(payload.date).toBe(today)
  })

  it('/api/range 非法 start 拒绝（此前 RangeError 无 code）', () => {
    expect(catchCode(() => getApi(deps(), '/api/range', url('/range?start=garbage')))).toBe('bad_date')
    expect(catchCode(() => getApi(deps(), '/api/range', url(`/range?start=${today}&end=also-bad`)))).toBe('bad_date')
    const payload = getApi(deps(), '/api/range', url(`/range?start=${today}`)) as { days: unknown[] }
    expect(payload.days).toHaveLength(7)
  })
})

describe('任务详情网格窗口口径', () => {
  const config: RoutesConfig = { rangeDefaultDays: 7, rangeMaxDays: 31, memoryListLimit: 500 }
  const deps = (store: ReturnType<typeof memoryStore>): ApiDeps => ({ store, config })
  const url = (query: string): URL => new URL(`http://localhost/xingyuan/api${query}`)

  interface GridCell { date: string; state: string }

  it('窗口=截至今日的机会日末 28 格，预勾未来日并入；今天的打卡可见（回归：曾整体滑向未来尾部）', () => {
    const store = memoryStore()
    putWish(store, 'w1')
    const claim = addDays(today, -28)
    putTask(store, 't1', {
      wishId: 'w1', claimDate: claim, createdAt: `${claim}T00:00:00`,
      dueDate: addDays(today, 60), requiredDays: 89,
    })
    putCheckin(store, 't1', addDays(today, -1))
    putCheckin(store, 't1', today)
    putCheckin(store, 't1', addDays(today, 5)) // 未来预勾
    const payload = getApi(deps(store), '/api/task-detail', url('/task-detail?taskId=t1')) as { grid: GridCell[] }
    const dates = payload.grid.map((cell) => cell.date)
    expect(payload.grid).toHaveLength(28)
    expect(dates).toContain(today)
    expect(dates).toContain(addDays(today, -1))
    expect(dates).toContain(addDays(today, 5))
    expect(dates).not.toContain(addDays(today, 1)) // 未勾选的未来日归「接下来的机会日」，不进打卡记录
    expect(dates).not.toContain(addDays(today, -27)) // 窗口满 28 格：最旧一日被预勾挤出
    expect(dates[0]).toBe(addDays(today, -26))
    expect(payload.grid.find((cell) => cell.date === today)?.state).toBe('checked')
    expect(payload.grid.find((cell) => cell.date === addDays(today, -1))?.state).toBe('checked')
    expect(payload.grid.find((cell) => cell.date === addDays(today, 5))?.state).toBe('checked')
  })

  it('once 未来截止日任务：无历史机会日则网格为空，未来机会日只出现在 upcoming 预览', () => {
    const store = memoryStore()
    const due = addDays(today, 10)
    putTask(store, 't2', { checkInCycle: 'once', claimDate: today, dueDate: due })
    const payload = getApi(deps(store), '/api/task-detail', url('/task-detail?taskId=t2')) as { grid: GridCell[]; upcoming: string[] }
    expect(payload.grid).toEqual([])
    expect(payload.upcoming).toEqual([due])
  })

  it('今天未打卡：今天的格子在网格内且为 future 态（「今天该打卡」不被窗口吃掉）', () => {
    const store = memoryStore()
    const claim = addDays(today, -3)
    putTask(store, 't3', { claimDate: claim, createdAt: `${claim}T00:00:00`, dueDate: addDays(today, 30), requiredDays: 34 })
    const payload = getApi(deps(store), '/api/task-detail', url('/task-detail?taskId=t3')) as { grid: GridCell[] }
    expect(payload.grid.find((cell) => cell.date === today)?.state).toBe('future')
  })

  it('once 无截止日任务：打卡日期在机会日序列之外，仍必须进网格（详情页撤销入口依赖它）', () => {
    const store = memoryStore()
    putTask(store, 't4', { checkInCycle: 'once', claimDate: today, dueDate: undefined })
    putCheckin(store, 't4', today)
    const payload = getApi(deps(store), '/api/task-detail', url('/task-detail?taskId=t4')) as { grid: GridCell[] }
    expect(payload.grid).toEqual([{ date: today, state: 'checked' }])
  })

  it('无截止日周期任务（任意日补记）：网格=打卡历史，全部 checked、无 missed', () => {
    const store = memoryStore()
    const claim = addDays(today, -5)
    putTask(store, 't5', { claimDate: claim, createdAt: `${claim}T00:00:00`, dueDate: undefined })
    putCheckin(store, 't5', addDays(today, -2))
    putCheckin(store, 't5', addDays(today, -1))
    const payload = getApi(deps(store), '/api/task-detail', url('/task-detail?taskId=t5')) as { grid: GridCell[] }
    expect(payload.grid).toEqual([
      { date: addDays(today, -2), state: 'checked' },
      { date: addDays(today, -1), state: 'checked' },
    ])
  })

  it('极端量级预勾（>27 个未来打卡）：今天仍被保留在窗口内，不被截尾挤出', () => {
    const store = memoryStore()
    putTask(store, 't6', { claimDate: today, dueDate: addDays(today, 60), requiredDays: 61 })
    putCheckin(store, 't6', today)
    for (let i = 1; i <= 30; i++) putCheckin(store, 't6', addDays(today, i))
    const payload = getApi(deps(store), '/api/task-detail', url('/task-detail?taskId=t6')) as { grid: GridCell[] }
    expect(payload.grid).toHaveLength(28)
    expect(payload.grid.find((cell) => cell.date === today)?.state).toBe('checked')
    expect(payload.grid.some((cell) => cell.date === addDays(today, 30))).toBe(true)
    expect(payload.grid.some((cell) => cell.date === addDays(today, 3))).toBe(false) // 最旧的预勾被裁剪
  })
})

describe('API 愿望载荷三态下发位（展示谓词禁止重建闸门）', () => {
  const config: RoutesConfig = { rangeDefaultDays: 7, rangeMaxDays: 31, memoryListLimit: 500 }
  const deps = (store: ReturnType<typeof memoryStore>): ApiDeps => ({ store, config })
  const url = (query: string): URL => new URL(`http://localhost/xingyuan/api${query}`)

  interface WishRow { wishId: string; settled: boolean; planning: boolean; pendingCount: number; archived: boolean; progress: number }

  it('/api/wishes 携 settled/planning/pendingCount：待收尾（满进度有待领取）与计划中（裸愿望）各有其位', () => {
    const store = memoryStore()
    putWish(store, 'w-settled')
    putTask(store, 't-done', { wishId: 'w-settled', requiredDays: 2, completedDays: 2, status: 'closed', closedReason: 'achieved' })
    putTask(store, 't-cand', { wishId: 'w-settled', status: 'pending' })
    putWish(store, 'w-plain') // 裸愿望（无任务）：progress 0、计划中
    const payload = getApi(deps(store), '/api/wishes', url('/wishes')) as { wishes: WishRow[] }
    const settled = payload.wishes.find((w) => w.wishId === 'w-settled')!
    expect(settled.progress).toBe(100)
    expect(settled.archived).toBe(false)
    expect(settled.settled).toBe(true)
    expect(settled.planning, '有已领取任务 → 非计划中').toBe(false)
    expect(settled.pendingCount).toBe(1)
    const plain = payload.wishes.find((w) => w.wishId === 'w-plain')!
    expect(plain.settled).toBe(false)
    expect(plain.planning, '无任何已领取任务 → 计划中').toBe(true)
    expect(plain.pendingCount).toBe(0)
  })
})
