/**
 * 业务层测试：真实 sqlite（:memory:）+ defineDomain，不 mock 存储层。
 * 覆盖打卡语义（勾最早未勾/补卡/提前勾校验）、取消、进度联动、状态机。
 */
import { describe, expect, it } from 'vitest'
import { xingyuanDomainSpec } from '../src/domain.js'
import type { XingyuanStore } from '../src/domain.js'
import { PREF_DEFAULTS } from '../src/pref-policy.js'
import { createTask, createWish, performCheckIn, cancelCheckIn, claimTask, planForDay, updateTask, updateWish } from '../src/store.js'
import { removeTaskCompletely } from '../src/cascade.js'
import { addDays, todayIso } from '../src/opportunity.js'

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
    prefs: () => PREF_DEFAULTS,
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

  it('最后一个机会日打卡达标关闭后，当日 plan 仍保留该行（完成区撤销入口）', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '今日收尾', checkInCycle: 'daily', dueDate: today }, addDays(today, -2))
    await claimTask(store, task.taskId, addDays(today, -2))
    let done
    for (const d of [addDays(today, -2), addDays(today, -1), today]) {
      done = await performCheckIn(store, task.taskId, d, addDays(today, -1))
    }
    expect(done!.task.status).toBe('closed')
    expect(done!.task.closedReason).toBe('achieved')
    // 回归：此前达标关闭的任务被整体剔除出日程面——最后一个机会日打卡后行凭空
    // 消失、今日计数反而变少；当天有打卡的保留在完成区（撤销入口），取消打卡
    // 经新鲜化自动复活任务，语义自洽
    const plan = planForDay(store, today)
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.checked).toBe(true)
    expect(plan.items[0]!.canCancel).toBe(true)
    expect(plan.items[0]!.canCheckIn).toBe(false)
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

  it('截止日后才领取：拒绝领取（claim_expired）而非静默领成已过期（0.5.7 诚实化）', async () => {
    // 旧行为「领取即当场过期关闭」会伴随虚假回包（「进入进行中」/「去打卡吧」），
    // 且锚点=领取日时序列本为空、领取毫无产出的状态翻转——改为就地拒绝并引导
    // 先延长截止日复活（与工具描述/任务行提示/详情复活行同一口径）
    const store = memoryStore()
    const task = await createTask(store, { name: '过期任务', checkInCycle: 'daily', dueDate: '2026-08-10' }, '2026-08-01')
    await expect(claimTask(store, task.taskId, '2026-08-15')).rejects.toMatchObject({ code: 'claim_expired' })
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

describe('业务层：计划面新鲜化与按钮态口径', () => {
  it('过期关闭任务：过往机会日 canCheckIn=false（按钮不再可点后必失败）', async () => {
    const store = memoryStore()
    const today = todayIso()
    const anchor = addDays(today, -5)
    const task = await createTask(store, { name: '过期任务', checkInCycle: 'daily', dueDate: addDays(today, -3) }, anchor)
    await claimTask(store, task.taskId, anchor)
    const plan = planForDay(store, addDays(today, -4))
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.task.status).toBe('closed')
    expect(plan.items[0]!.canCheckIn).toBe(false)
  })

  it('读侧新鲜化：跨日未落库的陈旧状态，计划面按今日重算', async () => {
    const store = memoryStore()
    const today = todayIso()
    // 直写一份「昨天就该过期但状态仍进行中」的陈旧记录，模拟无写路径的跨日
    await store.domain.table('tasks').put('stale', {
      taskId: 'stale', name: '陈旧任务', checkInCycle: 'daily', source: 'ai',
      status: 'in_progress', claimDate: addDays(today, -4), dueDate: addDays(today, -1),
      requiredDays: 3, completedDays: 0, createdAt: `${addDays(today, -4)}T00:00:00`,
    } as never)
    const plan = planForDay(store, addDays(today, -2))
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]!.task.status).toBe('closed')
    expect(plan.items[0]!.task.closedReason).toBe('expired')
    expect(plan.items[0]!.canCheckIn).toBe(false)
  })
})

describe('业务层：update_task 空串清除语义', () => {
  it('清除 hint/dueDate 并按锚点重算应打天数（无截止日 daily → 不限）', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '提示任务', hint: '原提示', checkInCycle: 'daily', dueDate: addDays(today, 7) }, today)
    expect(task.requiredDays).toBeGreaterThan(0)
    const updated = await updateTask(store, task.taskId, { hint: '', dueDate: '' }, today)
    expect(updated.hint).toBeUndefined()
    expect(updated.dueDate).toBeUndefined()
    expect(updated.requiredDays).toBe(0)
  })

  it('once 任务清除截止日后应打 1 天；undefined=保留原值不误清', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '一次性', checkInCycle: 'once', dueDate: addDays(today, 3) }, today)
    const kept = await updateTask(store, task.taskId, { name: '一次性改名' }, today)
    expect(kept.dueDate).toBe(task.dueDate)
    const cleared = await updateTask(store, task.taskId, { dueDate: '' }, today)
    expect(cleared.dueDate).toBeUndefined()
    expect(cleared.requiredDays).toBe(1)
  })
})

describe('愿望收口：createWish/updateWish 校验同源', () => {
  it('打卡目标日期为不存在的日历日期时拒绝（无截止日任务的任意补记也不豁免）', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '自由补记', checkInCycle: 'daily' }, today)
    await claimTask(store, task.taskId, today)
    // 无截止日非一次任务允许任意真实日期补记，但 2026-02-30 会落进 checkins 表
    // 并把连续性重放滚动到 03-02——validateTargetDate 必须语义拒绝
    await expect(performCheckIn(store, task.taskId, '2026-02-30', today))
      .rejects.toMatchObject({ code: 'bad_date' })
    // 真实日期补记不受影响（既有语义保持）
    const ok = await performCheckIn(store, task.taskId, '2026-01-15', today)
    expect(ok.date).toBe('2026-01-15')
  })

  it('不存在的日历日期（月长度非法）在写路径拒绝：任务截止日与愿望预计完成日', async () => {
    const store = memoryStore()
    // Date.parse('2027-02-30') 是合法时间戳（滚动成 03-02），仅查 NaN 放行会导致
    // 机会日序列口径漂移；isIsoDate 往返校验必须在两条写路径同时拦截
    await expect(createTask(store, { name: '假日期', checkInCycle: 'daily', dueDate: '2027-02-30' }, '2026-08-20'))
      .rejects.toMatchObject({ code: 'bad_date' })
    await expect(updateWish(store, (await createWish(store, { title: '测试愿望', categoryName: '学习' }, '2026-08-20')).wishId,
      { estimatedCompletionDate: '2027-02-30' }, '2026-08-20'))
      .rejects.toMatchObject({ code: 'bad_date' })
  })

  it('分类长度/颜色键/预计日期过去/标题超长分别抛稳定错误', async () => {
    const store = memoryStore()
    await expect(createWish(store, { title: '学琴', categoryName: '学' }, '2026-08-01')).rejects.toMatchObject({ code: 'bad_category_name' })
    await expect(createWish(store, { title: '学琴', categoryName: '学习', colorKey: 'notacolor' }, '2026-08-01')).rejects.toMatchObject({ code: 'bad_color_key' })
    await expect(createWish(store, { title: '学琴', categoryName: '学习', estimatedCompletionDate: '2026-07-31' }, '2026-08-01')).rejects.toMatchObject({ code: 'due_past' })
    await expect(createWish(store, { title: 'x'.repeat(51), categoryName: '学习' }, '2026-08-01')).rejects.toThrow('标题不能超过')
  })

  it('部分更新保留未提及字段；空串/空白清除可选字段；title 清除被拒', async () => {
    const store = memoryStore()
    const wish = await createWish(store, {
      title: '读书', categoryName: '学习', description: '每日一章', colorKey: 'blue', estimatedCompletionDate: '2027-01-01',
    }, '2026-08-01')
    const updated = await updateWish(store, wish.wishId, { description: '', estimatedCompletionDate: '  ', title: '读完十本书' }, '2026-08-02')
    expect(updated.title).toBe('读完十本书')
    expect(updated.description).toBeUndefined()
    expect(updated.estimatedCompletionDate).toBeUndefined()
    expect(updated.colorKey).toBe('blue') // 未提及保留
    const clearedColor = await updateWish(store, wish.wishId, { colorKey: '' }, '2026-08-02')
    expect(clearedColor.colorKey).toBeUndefined()
    await expect(updateWish(store, wish.wishId, { title: '' }, '2026-08-02')).rejects.toThrow('标题不能为空')
    await expect(updateWish(store, 'no-such-wish', { title: '任意' }, '2026-08-02')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('createTask 内置进度联动；删除任务后回写归零（收口后调用方无需手抄）', async () => {
    const store = memoryStore()
    const wishId = 'w-auto'
    await store.domain.table('wishes').put(wishId, {
      wishId, title: '学琴', categoryName: '学习', progress: 0,
      totalRequiredDays: 0, totalCompletedDays: 0, archived: false, createdAt: '2026-08-01T00:00:00',
    } as never)
    const task = await createTask(store, { wishId, name: '练琴', checkInCycle: 'daily', dueDate: '2026-08-10' }, '2026-08-05')
    // createTask 返回前已完成联动（此前需调用方各自 sync）：应打 08-05..08-10 共 6 天
    expect(task.requiredDays).toBe(6)
    let stored = store.domain.table('wishes').get(wishId)!
    expect(stored.totalRequiredDays).toBe(6)
    expect(await removeTaskCompletely(store, 'no-such-task')).toBeUndefined()
    await removeTaskCompletely(store, task.taskId)
    stored = store.domain.table('wishes').get(wishId)!
    expect(stored.totalRequiredDays).toBe(0)
    expect(stored.totalCompletedDays).toBe(0)
    expect(stored.archived).toBe(false)
  })
})

describe('截止日地平线（远期截止会让机会日序列物化爆炸）', () => {
  it('createTask：超过 10 年地平线的截止日拒绝（due_too_far）', async () => {
    const store = memoryStore()
    await expect(createTask(store, {
      name: '远期任务', checkInCycle: 'daily', dueDate: '9999-12-31',
    })).rejects.toMatchObject({ code: 'due_too_far' })
  })

  it('updateTask：把截止日改到 10 年外地平线之外同样拒绝', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '正常任务', checkInCycle: 'daily', dueDate: addDays(todayIso(), 30) })
    await expect(updateTask(store, task.taskId, { dueDate: '9999-12-31' })).rejects.toMatchObject({ code: 'due_too_far' })
  })
})

describe('业务层：领取诚实化与撤销缺省口径', () => {
  it('截止日已过的待领取任务拒绝领取（claim_expired）；延长截止日后可正常领取', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '错过领取', checkInCycle: 'daily', dueDate: '2026-08-10' }, '2026-08-01')
    // 锚点=领取日（晚于截止日）时序列为空，领取即当场过期——写路径直接拒绝
    await expect(claimTask(store, task.taskId, '2026-08-12')).rejects.toMatchObject({ code: 'claim_expired' })
    // 页内复活路径对「已过期仍待领取」同样成立：延长截止日保持待领取，随后领取成功
    const revived = await updateTask(store, task.taskId, { dueDate: '2026-08-30' }, '2026-08-12')
    expect(revived.status).toBe('pending')
    const claimed = await claimTask(store, task.taskId, '2026-08-12')
    expect(claimed.status).toBe('in_progress')
    expect(claimed.claimDate).toBe('2026-08-12')
  })

  it('取消打卡不传日期 = 撤最近一次；撤到空报 no_checkins（工具面缺省行为收口）', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '回看', checkInCycle: 'daily', dueDate: '2026-08-30' }, '2026-08-01')
    await claimTask(store, task.taskId, '2026-08-05')
    await performCheckIn(store, task.taskId, '2026-08-06', '2026-08-07')
    await performCheckIn(store, task.taskId, '2026-08-07', '2026-08-07')
    const undone = await cancelCheckIn(store, task.taskId, undefined, '2026-08-07')
    expect(undone.date).toBe('2026-08-07')
    expect(undone.task.status).toBe('in_progress')
    await cancelCheckIn(store, task.taskId, undefined, '2026-08-07')
    await expect(cancelCheckIn(store, task.taskId, undefined, '2026-08-07')).rejects.toMatchObject({ code: 'no_checkins' })
  })
})
