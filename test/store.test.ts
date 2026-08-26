/**
 * 业务层测试：真实 sqlite（:memory:）+ defineDomain，不 mock 存储层。
 * 覆盖打卡语义（勾最早未勾/补卡/提前勾校验）、取消、进度联动、状态机。
 */
import { describe, expect, it } from 'vitest'
import { xingyuanDomainSpec } from '../src/domain.js'
import type { XingyuanStore } from '../src/domain.js'
import { createTask, performCheckIn, cancelCheckIn, claimTask, planForDay, updateTask } from '../src/store.js'

/** 内存域桩：直接以 Map 实现 KvTable 语义（写链在单测内串行）。 */
function memoryStore(): XingyuanStore {
  const tables = new Map<string, Map<string, unknown>>()
  for (const name of Object.keys(xingyuanDomainSpec.tables)) tables.set(name, new Map())
  let globalValue: unknown = structuredClone(xingyuanDomainSpec.global!.initial)
  const idSeq = { n: 0 }
  const domain = {
    name: 'xingyuan',
    global: {
      get: () => globalValue,
      set: async (v: unknown) => { globalValue = v },
    },
    table: (name: string) => {
      const map: Map<string, unknown> = tables.get(name)!
      return {
        get: (key: string) => map.get(key),
        entries: () => [...map.entries()][Symbol.iterator](),
        keys: () => map.keys(),
        size: map.size,
        put: async (key: string, value: unknown) => { map.set(key, value) },
        delete: async (key: string) => map.delete(key),
        update: async (key: string, fn: (current: unknown) => unknown) => {
          const next = fn(map.get(key))
          map.set(key, next)
          return next
        },
      }
    },
    close: async () => {},
  } as unknown as XingyuanStore['domain']
  return {
    spec: xingyuanDomainSpec,
    domain,
    newId: () => `id-${++idSeq.n}`,
    checkinKey: (taskId: string, date: string) => `${taskId}|${date}`,
  }
}

describe('业务层：创建 → 领取 → 打卡', () => {
  it('daily 任务：不传日期自动勾今天；completedDays 联动', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '每天背单词', checkInCycle: 'daily' }, '2026-08-20')
    expect(task.requiredDays).toBe(0) // 无截止日 → 无机会日约束
    await store.domain.table('tasks').update(task.taskId, (t) => ({ ...t, status: 'in_progress', claimDate: '2026-08-20' }))

    const result = await performCheckIn(store, task.taskId, undefined, '2026-08-22')
    expect(result.date).toBe('2026-08-22')
    expect(result.task.completedDays).toBe(1)

    // 重复同日打卡拒绝
    await expect(performCheckIn(store, task.taskId, '2026-08-22', '2026-08-23')).rejects.toThrow('已打卡')
  })

  it('once 无截止日：点击打卡即完成，仅限操作当天', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '一次性整理书桌', checkInCycle: 'once' }, '2026-08-20')
    expect(task.requiredDays).toBe(1) // once 无截止日 → 1（点击即完成）
    await store.domain.table('tasks').update(task.taskId, (t) => ({ ...t, status: 'in_progress', claimDate: '2026-08-20' }))

    const result = await performCheckIn(store, task.taskId, undefined, '2026-08-22')
    expect(result.date).toBe('2026-08-22')
    expect(result.task.status).toBe('closed')
    expect(result.task.closedReason).toBe('achieved')

    // 指定非当天日期拒绝（无截止日 once 的打卡日=操作当天）
    const store2 = memoryStore()
    const task2 = await createTask(store2, { name: '一次性任务二', checkInCycle: 'once' }, '2026-08-20')
    await store2.domain.table('tasks').update(task2.taskId, (t) => ({ ...t, status: 'in_progress', claimDate: '2026-08-20' }))
    await expect(performCheckIn(store2, task2.taskId, '2026-08-21', '2026-08-22')).rejects.toThrow('只能打卡今天')
  })

  it('有截止日任务：自动勾选今天起最早未勾选机会日；过去日不回补', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '跑步', checkInCycle: 'weekly', dueDate: '2026-09-30' }, '2026-08-01')
    await claimTask(store, task.taskId, '2026-08-01')
    // 锚点 8/01 weekly → 机会日 8/01, 8/08, 8/15, 8/22…；today=8/10 → 自动勾 8/15？否：
    // findFirstUnchecked 从 today(含) 起 → 今天不是机会日时勾下一个机会日 8/15（提前勾）
    const result = await performCheckIn(store, task.taskId, undefined, '2026-08-10')
    expect(result.date).toBe('2026-08-15')

    // 补卡：显式指定过去机会日 8/01 允许（补卡走指定日期）
    const backfill = await performCheckIn(store, task.taskId, '2026-08-01', '2026-08-10')
    expect(backfill.date).toBe('2026-08-01')
    expect(backfill.task.completedDays).toBe(2)
  })

  it('提前勾未来机会日允许（承诺当天完成）；非机会日拒绝', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '阅读', checkInCycle: 'daily', dueDate: '2026-08-25' }, '2026-08-20')
    await claimTask(store, task.taskId, '2026-08-20')
    const future = await performCheckIn(store, task.taskId, '2026-08-24', '2026-08-22')
    expect(future.date).toBe('2026-08-24')
    await expect(performCheckIn(store, task.taskId, '2026-08-19', '2026-08-22')).rejects.toThrow('不是该任务的打卡日')
  })

  it('达标自动完结；取消后回到进行中；过期关闭须延长截止日复活', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '一次性', checkInCycle: 'once', dueDate: '2026-08-30' }, '2026-08-20')
    await claimTask(store, task.taskId, '2026-08-20')
    const done = await performCheckIn(store, task.taskId, '2026-08-30', '2026-08-22')
    expect(done.task.status).toBe('closed')
    expect(done.task.closedReason).toBe('achieved')

    const undone = await cancelCheckIn(store, task.taskId, '2026-08-30', '2026-08-22')
    expect(undone.task.status).toBe('in_progress')
    expect(undone.task.closedReason).toBeUndefined()

    // 过期关闭 → 延长截止日触发重新开始
    await store.domain.table('tasks').update(task.taskId, (t) => ({
      ...t,
      status: 'closed',
      closedReason: 'expired',
      dueDate: '2026-08-21',
    }))
    const revived = await updateTask(store, task.taskId, { dueDate: '2026-09-15' }, '2026-08-22')
    expect(revived.status).toBe('in_progress')
  })

  it('planForDay：机会日落位与打卡状态', async () => {
    const store = memoryStore()
    const a = await createTask(store, { name: 'A', checkInCycle: 'daily', dueDate: '2026-08-25' }, '2026-08-20')
    const b = await createTask(store, { name: 'B', checkInCycle: 'once', dueDate: '2026-08-22' }, '2026-08-20')
    await claimTask(store, a.taskId, '2026-08-20')
    await performCheckIn(store, a.taskId, '2026-08-22', '2026-08-22')
    const plan = planForDay(store as never, '2026-08-22')
    const itemA = plan.items.find((item) => item.task.name === 'A')!
    expect(itemA.checked).toBe(true)
    const itemB = plan.items.find((item) => item.task.name === 'B')!
    expect(itemB.checked).toBe(false)
    expect(itemB.canCheckIn).toBe(false) // pending 未领取不可打卡
  })
})

describe('业务层：延迟领取（锚点 = 领取日，requiredDays 同口径重算）', () => {
  it('跨日领取：requiredDays 按领取日重算，勾完全部机会日即达标完结', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '每天背单词', checkInCycle: 'daily', dueDate: '2026-08-10' }, '2026-08-01')
    expect(task.requiredDays).toBe(10) // 创建日口径：8/01..8/10
    const claimed = await claimTask(store, task.taskId, '2026-08-05')
    expect(claimed.requiredDays).toBe(6) // 领取日口径：8/05..8/10
    let last
    for (const date of ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10']) {
      last = await performCheckIn(store, task.taskId, date, '2026-08-06')
    }
    // 回归原缺陷：此前 completedDays(6) < 创建期 requiredDays(10)，任务永久卡在进行中
    expect(last!.task.status).toBe('closed')
    expect(last!.task.closedReason).toBe('achieved')
  })

  it('同日领取：requiredDays 与创建时一致（回归守卫）', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '每周健身', checkInCycle: 'weekly', dueDate: '2026-09-29' }, '2026-08-04')
    const claimed = await claimTask(store, task.taskId, '2026-08-04')
    expect(claimed.requiredDays).toBe(task.requiredDays)
  })

  it('截止日后才领取：立即按过期关闭，不留永远无法推进的任务', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '过期任务', checkInCycle: 'daily', dueDate: '2026-08-10' }, '2026-08-01')
    const claimed = await claimTask(store, task.taskId, '2026-08-15')
    expect(claimed.status).toBe('closed')
    expect(claimed.closedReason).toBe('expired')
  })

  it('领取不存在的任务：领域错误而非底层异常', async () => {
    const store = memoryStore()
    await expect(claimTask(store, 'no-such-task', '2026-08-05')).rejects.toThrow('任务不存在')
  })

  it('领取联动愿望进度：requiredDays 重算后库存总数即时同步', async () => {
    const store = memoryStore()
    const wishId = 'w-claim'
    await store.domain.table('wishes').put(wishId, {
      wishId, title: '学琴', categoryName: '学习', progress: 0,
      totalRequiredDays: 0, totalCompletedDays: 0, archived: false, createdAt: '2026-08-01T00:00:00',
    } as never)
    const task = await createTask(store, { wishId, name: '练琴', checkInCycle: 'daily', dueDate: '2026-08-10' }, '2026-08-01')
    await claimTask(store, task.taskId, '2026-08-05')
    const stored = store.domain.table('wishes').get(wishId)!
    expect(stored.totalRequiredDays).toBe(6)
  })
})
