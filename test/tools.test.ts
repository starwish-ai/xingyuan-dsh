/**
 * 工具层行为测试：registerTools(fakeCtx) 注册真实 defineTool 后直调 execute。
 * HITL 经 userQuestions 桩自动「确认」；agent 缺省为 undefined（事件发射跳过，
 * 会话卡回放语义由 loader.test 与客户端负责）。覆盖：
 * - 删除级联：任务/愿望删除时打卡记录与微行动状态一并清理（双平面共用收口）
 * - 批量创建：愿望库存进度即时联动（syncWishProgress 不缺位）
 * - 分类改名：global 颜色覆盖键随改名迁移（与页面动作同一口径）
 * - 写确认门闩：confirmWrites=false 时打卡不再弹卡；删除始终弹
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { registerTools } from '../src/preset/tools.js'
import type { Config } from '../src/preset/tools.js'
import { createTask, claimTask, performCheckIn } from '../src/store.js'
import { startMicroAction, getMicroAction } from '../src/micro.js'
import { addDays, todayIso } from '../src/opportunity.js'
import type { WishRecord, XingyuanStore } from '../src/domain.js'
import { memoryStore } from './memory-store.js'

function makeConfig(confirmWrites: boolean): Config {
  return {
    batchWishLimit: 50,
    batchTaskLimit: 100,
    chartTrendDays: 14,
    chartDistributionDays: 30,
    chartMaxDays: 90,
    chartRankLimit: 10,
    chartRankMax: 20,
    confirmWrites,
    confirmLang: 'zh',
  }
}

interface ToolDef {
  name: string
  execute: (args: never, exec: never) => Promise<unknown>
}

/** fake ctx：捕获注册的工具定义；userQuestions 桩记录询问次数并自动选「确认」。 */
function setup(store: XingyuanStore, config: Config): {
  registered: ToolDef[]
  state: { asks: number }
  events: Array<{ kind: string; data: Record<string, unknown> }>
  run: (name: string, args: unknown) => Promise<unknown>
} {
  const registered: ToolDef[] = []
  const state = { asks: 0 }
  const events: Array<{ kind: string; data: Record<string, unknown> }> = []
  // agent 必须为真值：headless（无 agent）语义下 confirmAction 直接放行、不询问，
  // 门闩行为只能经「有 agent + userQuestions 桩」路径观测；事件记录器顺带可断言发射。
  const agent = { session: { append: (kind: string, data: Record<string, unknown>) => { events.push({ kind, data }) } } }
  const ctx = {
    xingyuan: store,
    tools: { register: (def: ToolDef) => registered.push(def) },
    userQuestions: {
      ask: async () => {
        state.asks += 1
        return { answers: [{ selected: ['确认'] }] }
      },
    },
  } as unknown as Context & { xingyuan: XingyuanStore }
  registerTools(ctx, config)
  const run = (name: string, args: unknown): Promise<unknown> => {
    const def = registered.find((tool) => tool.name === name)
    if (def === undefined) throw new Error(`工具未注册：${name}`)
    return def.execute(args as never, { agent, signal: undefined } as never)
  }
  return { registered, state, events, run }
}

async function seedWish(store: XingyuanStore, wishId: string, overrides: Partial<WishRecord> = {}): Promise<WishRecord> {
  const today = todayIso()
  const wish: WishRecord = {
    wishId,
    title: `愿望${wishId}`,
    categoryName: '学习',
    progress: 0,
    totalRequiredDays: 0,
    totalCompletedDays: 0,
    archived: false,
    createdAt: `${today}T00:00:00`,
    ...overrides,
  }
  await store.domain.table('wishes').put(wishId, wish)
  return wish
}

/** 建一个已领取、已打一次卡、已开始微行动的任务（删除级联的完整样本）。 */
async function seedLiveTask(store: XingyuanStore, name: string, wishId?: string): Promise<string> {
  const today = todayIso()
  const task = await createTask(store, {
    name,
    checkInCycle: 'daily',
    dueDate: addDays(today, 7),
    ...(wishId !== undefined ? { wishId } : {}),
  }, today)
  await claimTask(store, task.taskId, today)
  await performCheckIn(store, task.taskId, undefined, today)
  await startMicroAction(store, task.taskId, [
    { instruction: '第一步' },
    { instruction: '第二步' },
    { instruction: '第三步' },
  ])
  return task.taskId
}

describe('工具层：批量创建联动愿望进度', () => {
  it('batch_create_tasks：候选不进愿望进度分母（承诺口径），领取后计入', async () => {
    const store = memoryStore()
    const wishId = 'w-batch-sync'
    await seedWish(store, wishId)
    const today = todayIso()
    const { run } = setup(store, makeConfig(false))
    // 独立推算期望值：T1 daily 今天起至今天+3 共 4 个机会日；T2 once 无截止 = 1
    await run('batch_create_tasks', {
      tasks: [
        { wishId, name: 'T1', checkInCycle: 'daily', dueDate: addDays(today, 3) },
        { wishId, name: 'T2', checkInCycle: 'once' },
      ],
    })
    // 候选不进分母（§5.2 规则 7）：创建后愿望进度分母不变
    let stored = store.domain.table('wishes').get(wishId)!
    expect(stored.totalRequiredDays).toBe(0)
    expect(stored.totalCompletedDays).toBe(0)
    // 领取 T1 后其 4 天计入分母
    const t1 = [...store.domain.table('tasks').entries()].map(([, t]) => t).find((t) => t.name === 'T1')!
    await run('claim_task', { taskId: t1.taskId })
    stored = store.domain.table('wishes').get(wishId)!
    expect(stored.totalRequiredDays).toBe(4)
    expect(stored.totalCompletedDays).toBe(0)
  })
})

describe('工具层：写确认门闩（confirmWrites）', () => {
  it('check_in_task：confirmWrites=false 时不再弹确认卡，直接打卡成功', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '静默打卡', checkInCycle: 'daily', dueDate: addDays(today, 3) }, today)
    await claimTask(store, task.taskId, today)
    const { run, state } = setup(store, makeConfig(false))
    const reply = await run('check_in_task', { taskId: task.taskId }) as string
    expect(reply).toContain('已为')
    expect(state.asks).toBe(0)
    expect([...store.domain.table('checkins').entries()]).toHaveLength(1)
  })

  it('check_in_task：confirmWrites=true 时弹一次确认卡', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '确认打卡', checkInCycle: 'daily', dueDate: addDays(today, 3) }, today)
    await claimTask(store, task.taskId, today)
    const { run, state } = setup(store, makeConfig(true))
    await run('check_in_task', { taskId: task.taskId })
    expect(state.asks).toBe(1)
  })

  it('delete_task：删除始终弹确认卡（不受门闩控制）', async () => {
    const store = memoryStore()
    const taskId = await seedLiveTask(store, '必删任务')
    const { run, state } = setup(store, makeConfig(false))
    await run('delete_task', { taskId })
    expect(state.asks).toBe(1)
    expect(store.domain.table('tasks').get(taskId)).toBeUndefined()
  })
})

describe('工具层：分类改名迁移颜色覆盖键', () => {
  it('rename_wish_category：愿望批量改名，覆盖键随迁并补发 updated 事件', async () => {
    const store = memoryStore()
    const wishId = 'w-cat'
    await seedWish(store, wishId)
    await store.domain.global.set({
      ...store.domain.global.get(),
      categoryColors: { 学习: 'blue' },
    } as never)
    const { run, events } = setup(store, makeConfig(false))
    const reply = await run('rename_wish_category', { oldName: '学习', newName: '进修' }) as string
    expect(reply).toContain('1 个愿望')
    expect(store.domain.table('wishes').get(wishId)!.categoryName).toBe('进修')
    const global = store.domain.global.get() as { categoryColors?: Record<string, string> }
    expect(global.categoryColors?.['进修']).toBe('blue') // 覆盖键随迁（此前工具侧漏迁，孤儿键残留）
    expect(global.categoryColors?.['学习']).toBeUndefined()
    const wishEvents = events.filter((event) => event.kind === 'xingyuan/wish')
    expect(wishEvents).toHaveLength(1)
    expect((wishEvents[0]!.data as { op: string }).op).toBe('updated')
  })
})

describe('工具层：删除级联清理（打卡记录 + 微行动状态，不留孤儿）', () => {
  it('delete_task：级联清除打卡记录与微行动状态', async () => {
    const store = memoryStore()
    const taskId = await seedLiveTask(store, '每日阅读')
    const { run } = setup(store, makeConfig(false))
    await run('delete_task', { taskId })
    expect(store.domain.table('tasks').get(taskId)).toBeUndefined()
    expect([...store.domain.table('checkins').entries()]).toHaveLength(0)
    expect(getMicroAction(store, taskId)).toBeUndefined()
  })

  it('batch_delete_tasks：逐个级联清理', async () => {
    const store = memoryStore()
    const a = await seedLiveTask(store, '任务A')
    const b = await seedLiveTask(store, '任务B')
    const { run } = setup(store, makeConfig(false))
    const reply = await run('batch_delete_tasks', { taskIds: [a, b] }) as string
    expect(reply).toContain('成功 2 个')
    expect(store.domain.table('tasks').get(a)).toBeUndefined()
    expect(store.domain.table('tasks').get(b)).toBeUndefined()
    expect([...store.domain.table('checkins').entries()]).toHaveLength(0)
    expect(getMicroAction(store, a)).toBeUndefined()
    expect(getMicroAction(store, b)).toBeUndefined()
  })

  it('delete_wish：愿望、下属任务、打卡、微行动状态一并清理', async () => {
    const store = memoryStore()
    const wishId = 'w-del'
    await seedWish(store, wishId)
    const taskId = await seedLiveTask(store, '下属任务', wishId)
    const { run } = setup(store, makeConfig(false))
    await run('delete_wish', { wishId })
    expect(store.domain.table('wishes').get(wishId)).toBeUndefined()
    expect(store.domain.table('tasks').get(taskId)).toBeUndefined()
    expect([...store.domain.table('checkins').entries()]).toHaveLength(0)
    expect(getMicroAction(store, taskId)).toBeUndefined()
  })

  it('batch_delete_wishes：批量级联清理', async () => {
    const store = memoryStore()
    const w1 = 'w-b1'
    const w2 = 'w-b2'
    await seedWish(store, w1)
    await seedWish(store, w2)
    const t1 = await seedLiveTask(store, '甲任务', w1)
    const t2 = await seedLiveTask(store, '乙任务', w2)
    const { run } = setup(store, makeConfig(false))
    const reply = await run('batch_delete_wishes', { wishIds: [w1, w2] }) as string
    expect(reply).toContain('成功 2 个愿望')
    expect(store.domain.table('wishes').get(w1)).toBeUndefined()
    expect(store.domain.table('wishes').get(w2)).toBeUndefined()
    expect(store.domain.table('tasks').get(t1)).toBeUndefined()
    expect(store.domain.table('tasks').get(t2)).toBeUndefined()
    expect(getMicroAction(store, t1)).toBeUndefined()
    expect(getMicroAction(store, t2)).toBeUndefined()
  })
})

describe('工具面机械审计：HITL 超时与 ID 引用纪律（§5.4）', () => {
  /** 会弹确认卡（读 userQuestions，可能阻塞 agent 回合）的全部工具。 */
  const HITL_WAITING = [
    'create_wish_with_tasks', 'create_wish', 'create_task', 'batch_create_tasks',
    'delete_wish', 'batch_delete_wishes', 'check_in_task', 'cancel_check_in_task',
    'delete_task', 'batch_delete_tasks', 'delete_memory',
    'start_micro_action', 'complete_micro_step', 'restart_micro_action',
  ] as const

  it('HITL 等待类工具全部声明 timeoutMs=600_000（协作取消承诺）', () => {
    const store = memoryStore()
    const registered: Array<Record<string, unknown>> = []
    const agent = { session: { append: () => {} } }
    const ctx = {
      xingyuan: store,
      tools: { register: (def: Record<string, unknown>) => registered.push(def) },
      userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
    } as unknown as Parameters<typeof registerTools>[0]
    registerTools(ctx, makeConfig(true))
    const byName = new Map(registered.map((def) => [def.name as string, def]))
    expect(byName.size).toBe(45)
    for (const name of HITL_WAITING) {
      const def = byName.get(name)
      expect(def, `${name} 未注册`).toBeDefined()
      expect(def!['timeoutMs'], `${name} 缺 timeoutMs`).toBe(600_000)
    }
  })

  it('ID 类参数描述全部携带「取列表返回的真实值」纪律', () => {
    const store = memoryStore()
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      xingyuan: store,
      tools: { register: (def: Record<string, unknown>) => registered.push(def) },
      userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
    } as unknown as Parameters<typeof registerTools>[0]
    registerTools(ctx, makeConfig(true))
    for (const def of registered) {
      const parameters = (def.parameters ?? {}) as Record<string, { description?: string }>
      for (const [param, spec] of Object.entries(parameters)) {
        if (!/^(taskId|taskIds|wishId|wishIds)$/.test(param)) continue
        expect(spec.description ?? '', `${def.name as string}.${param} 缺 ID 纪律说明`).toContain('真实值')
      }
    }
  })
})

describe('工具层：达成闸门翻转联动（2026-09 承诺口径修订——翻转必须触达模型与卡面）', () => {
  /** 造一个「满进度而有候选」的待结算愿望：once 任务已领取并打卡完结 + 一个未领取候选。 */
  async function seedSettled(store: XingyuanStore): Promise<{ doneTaskId: string; candTaskId: string }> {
    const today = todayIso()
    await seedWish(store, 'w-gate')
    const done = await createTask(store, { wishId: 'w-gate', name: '冲刺交付', checkInCycle: 'once', dueDate: today }, today)
    await claimTask(store, done.taskId, today)
    const cand = await createTask(store, { wishId: 'w-gate', name: '复盘习惯', checkInCycle: 'daily', dueDate: addDays(today, 7) }, today)
    return { doneTaskId: done.taskId, candTaskId: cand.taskId }
  }

  it('check_in_task 触发进待结算：回包注明收尾路径，补发 wish 事件携 settled/pendingCount', async () => {
    const store = memoryStore()
    const { doneTaskId } = await seedSettled(store)
    const { run, events } = setup(store, makeConfig(false))
    const reply = await run('check_in_task', { taskId: doneTaskId }) as string
    expect(reply, '达成闸门翻转必须触达模型').toContain('就差最后一步')
    // 回包是逐字转述面：给模型的祈使句（第三人称「请让用户决定」「不要代做」）不得混入
    expect(reply).not.toContain('请让用户')
    expect(reply).not.toContain('不要代做')
    expect(reply).toContain('领了继续，或删掉就达成') // 收尾句固定句式（SETTLE_PHRASE 单源）
    const wishEvent = [...events].reverse().find((e) => e.kind === 'xingyuan/wish')
    expect(wishEvent, '任务工具达成翻转须补发愿望事件（卡面同步）').toBeDefined()
    const snapshot = (wishEvent!.data as { wish: Record<string, unknown> }).wish
    expect(snapshot.progress).toBe(100)
    expect(snapshot.settled).toBe(true)
    expect(snapshot.pendingCount).toBe(1)
  })

  it('delete_task 删除最后一个候选 = 收尾达成：回包注明 🎉，wish 事件定格达成', async () => {
    const store = memoryStore()
    const { candTaskId } = await seedSettled(store)
    const today = todayIso()
    const done = [...store.domain.table('tasks').entries()].map(([, t]) => t).find((t) => t.name === '冲刺交付')!
    await performCheckIn(store, done.taskId, undefined, today)
    const { run, events } = setup(store, makeConfig(false))
    const reply = await run('delete_task', { taskId: candTaskId }) as string
    expect(reply).toContain('已达成')
    const wishEvent = [...events].reverse().find((e) => e.kind === 'xingyuan/wish')
    const snapshot = (wishEvent!.data as { wish: Record<string, unknown> }).wish
    expect(snapshot.settled).toBe(false)
    expect(snapshot.pendingCount).toBe(0)
    expect(snapshot.achieved, '达成卡须带 achieved 位（聊天卡显已达成徽章，与页面/回包一致）').toBe(true)
    expect(store.domain.table('wishes').get('w-gate')!.archived).toBe(true)
  })

  it('get_wish_list：候选单列计数、满进度候选附收尾说明、删候选后达成 🎉（状态后缀同源 wishStatusNote）', async () => {
    const store = memoryStore()
    await seedWish(store, 'w-plain')
    await createTask(store, { wishId: 'w-plain', name: '候选甲', checkInCycle: 'daily', dueDate: addDays(todayIso(), 7) }, todayIso())
    const { run } = setup(store, makeConfig(false))
    // 全候选愿望（无已领取任务）：计划中口径（与愿望页/详情同一称呼）
    const list1 = await run('get_wish_list', {}) as string
    expect(list1).toContain('还没开始（计划中，1 个任务待领取）')
    expect(list1).not.toContain('就差最后一步')
    // 待结算愿望：附收尾说明
    const { candTaskId } = await seedSettled(store)
    const today = todayIso()
    const done = [...store.domain.table('tasks').entries()].map(([, t]) => t).find((t) => t.name === '冲刺交付')!
    await performCheckIn(store, done.taskId, undefined, today)
    const list2 = await run('get_wish_list', {}) as string
    expect(list2).toContain('答应自己的都做到了，还有 1 个任务待领取')
    // 删除最后一个候选（收尾）→ 达成 🎉
    await run('delete_task', { taskId: candTaskId })
    const list3 = await run('get_wish_list', {}) as string
    expect(list3).toContain('已达成 🎉')
  })

  it('claim_task：daily 无截止日候选（requiredDays=0）不扩分母，领取最后一个候选直接达成（R1 确证入口）', async () => {
    const store = memoryStore()
    await seedWish(store, 'w-claim')
    const today = todayIso()
    const done = await createTask(store, { wishId: 'w-claim', name: '有数任务', checkInCycle: 'once', dueDate: today }, today)
    await claimTask(store, done.taskId, today)
    await performCheckIn(store, done.taskId, undefined, today) // progress 100，有候选 → 待结算
    const zero = await createTask(store, { wishId: 'w-claim', name: '随心记录', checkInCycle: 'daily' }, today)
    expect(zero.requiredDays).toBe(0) // 前提：无截止日 daily 不进分母
    const { run, events } = setup(store, makeConfig(false))
    const reply = await run('claim_task', { taskId: zero.taskId }) as string
    expect(reply).toContain('已达成')
    expect(store.domain.table('wishes').get('w-claim')!.archived).toBe(true)
    const wishEvent = [...events].reverse().find((e) => e.kind === 'xingyuan/wish')
    expect(wishEvent, '领取致达成翻转须补发愿望事件').toBeDefined()
  })

  it('create_task 向已达成愿望追加候选：退档触达回包与愿望事件（不留假「已达成」卡）', async () => {
    const store = memoryStore()
    await seedWish(store, 'w-back')
    const today = todayIso()
    const done = await createTask(store, { wishId: 'w-back', name: '唯一承诺', checkInCycle: 'once', dueDate: today }, today)
    await claimTask(store, done.taskId, today)
    await performCheckIn(store, done.taskId, undefined, today) // 100% 无候选 → 达成归档
    expect(store.domain.table('wishes').get('w-back')!.archived).toBe(true)
    const { run, events } = setup(store, makeConfig(false))
    const reply = await run('create_task', { wishId: 'w-back', name: '新想法', checkInCycle: 'once', dueDate: addDays(today, 2) }) as string
    expect(reply, '追加候选使愿望退档，模型必须知情').toContain('就差最后一步')
    const wishEvent = [...events].reverse().find((e) => e.kind === 'xingyuan/wish')
    expect(wishEvent, '退档同样补发愿望事件').toBeDefined()
    expect(store.domain.table('wishes').get('w-back')!.archived).toBe(false)
  })

  it('cancel_check_in_task 使已达成愿望回退：回包注明并补发事件（三方同源）', async () => {
    const store = memoryStore()
    await seedWish(store, 'w-cancel')
    const today = todayIso()
    const done = await createTask(store, { wishId: 'w-cancel', name: '两步承诺', checkInCycle: 'daily', dueDate: addDays(today, 1) }, today)
    await claimTask(store, done.taskId, today)
    await performCheckIn(store, done.taskId, today, today)
    await performCheckIn(store, done.taskId, addDays(today, 1), today) // 2/2 达成
    expect(store.domain.table('wishes').get('w-cancel')!.archived).toBe(true)
    const { run } = setup(store, makeConfig(false))
    const reply = await run('cancel_check_in_task', { taskId: done.taskId, checkInDate: addDays(today, 1) }) as string
    expect(reply).toContain('取消达成')
    expect(store.domain.table('wishes').get('w-cancel')!.archived).toBe(false)
  })

  it('update_task 延长截止日使待结算愿望完成率跌破 100%：回退触达回包并补发事件（R2 确证缺口）', async () => {
    const store = memoryStore()
    await seedWish(store, 'w-extend')
    const today = todayIso()
    const done = await createTask(store, { wishId: 'w-extend', name: '每日小事', checkInCycle: 'daily', dueDate: today }, today)
    await claimTask(store, done.taskId, today)
    await performCheckIn(store, done.taskId, today, today)
    const cand = await createTask(store, { wishId: 'w-extend', name: '候选', checkInCycle: 'once', dueDate: addDays(today, 5) }, today)
    // 此刻：1/1 满进度 + 1 候选 = 待结算
    const { run, events } = setup(store, makeConfig(false))
    const reply = await run('update_task', { taskId: done.taskId, dueDate: addDays(today, 10) }) as string
    expect(reply, '分母扩大跌破 100% = 退出待结算回进行中，模型必须知情').toContain('退出待收尾')
    const wishEvent = [...events].reverse().find((e) => e.kind === 'xingyuan/wish')
    expect(wishEvent, '回退同样补发愿望事件（卡面摘掉待结算定格）').toBeDefined()
    expect(store.domain.table('tasks').get(cand.taskId)!.status).toBe('pending') // 候选不受影响
  })

  it('batch_create_tasks 向已达成愿望追加候选：愿望退档行进批量回包（单遍前视图比对）', async () => {
    const store = memoryStore()
    await seedWish(store, 'w-batch-back')
    const today = todayIso()
    const done = await createTask(store, { wishId: 'w-batch-back', name: '唯一承诺', checkInCycle: 'once', dueDate: today }, today)
    await claimTask(store, done.taskId, today)
    await performCheckIn(store, done.taskId, undefined, today)
    const { run } = setup(store, makeConfig(false))
    const reply = await run('batch_create_tasks', {
      tasks: [
        { wishId: 'w-batch-back', name: '新想法一', checkInCycle: 'once', dueDate: addDays(today, 2) },
        { wishId: 'w-batch-back', name: '新想法二', checkInCycle: 'weekly', dueDate: addDays(today, 30) },
      ],
    }) as string
    expect(reply).toContain('就差最后一步')
    expect(reply).not.toMatch(/🎉。/) // 行尾标点粘连回归锁
    expect(store.domain.table('wishes').get('w-batch-back')!.archived).toBe(false)
  })

  it('get_wish_detail：计划中愿望不报「进度 0%」、全候选双述消除、待结算附收尾句', async () => {
    const store = memoryStore()
    await seedWish(store, 'w-d1')
    const today = todayIso()
    await createTask(store, { wishId: 'w-d1', name: '纯候选', checkInCycle: 'daily', dueDate: addDays(today, 7) }, today)
    const { run } = setup(store, makeConfig(false))
    const planning = await run('get_wish_detail', { wishId: 'w-d1' }) as string
    expect(planning).toContain('计划中')
    expect(planning).not.toContain('进度 0%')
    expect(planning).not.toContain('进度 100%（') // 无鬼态：未兑现承诺不虚报满进度
    // 已领取 0 天任务（daily 无截止）：claimedCount>0 非计划中，但 required=0 无应打天数——
    // 报「进度 0%」但用文字说明无截止日，绝不得渲染出「0/0 天」坏显示（终审 P1 回归锁）
    await seedWish(store, 'w-d2')
    const zero = await createTask(store, { wishId: 'w-d2', name: '随心记录', checkInCycle: 'daily' }, today)
    await claimTask(store, zero.taskId, today)
    const claimedZero = await run('get_wish_detail', { wishId: 'w-d2' }) as string
    expect(claimedZero).not.toContain('计划中')
    expect(claimedZero).not.toContain('0/0')
    expect(claimedZero).toContain('无截止日')
  })

  it('claim_task 领取多日候选（待结算→回退）：回包同时含退出待结算与新增承诺两句（R3 P2-1 锁）', async () => {
    const store = memoryStore()
    const { doneTaskId } = await seedSettled(store)
    const today = todayIso()
    await performCheckIn(store, doneTaskId, undefined, today) // 满进度+1候选 = 待结算
    const { run } = setup(store, makeConfig(false))
    const list = await run('get_task_list', { status: 'pending' }) as string
    const candId = /\[([^\]]+)\]/.exec(list)?.[1]!
    const reply = await run('claim_task', { taskId: candId }) as string
    expect(reply).toContain('退出待收尾')
    expect(reply).toContain('新增承诺')
    expect(store.domain.table('wishes').get('w-gate')!.progress).toBeLessThan(100)
  })

  it('batch_query_user_data：wish 行携 archived/settled/pendingCount 与口径声明（模型汇总不误报达成）', async () => {
    const store = memoryStore()
    await seedSettled(store)
    const { run } = setup(store, makeConfig(false))
    const raw = await run('batch_query_user_data', {}) as string
    const parsed = JSON.parse(raw) as {
      wishProgressCaliber: string
      wishes: Array<{ wishId: string; progress: number; archived: boolean; settled: boolean; pendingCount: number }>
    }
    expect(parsed.wishProgressCaliber).toContain('待收尾')
    const gated = parsed.wishes.find((w) => w.wishId === 'w-gate')!
    expect(gated.progress).toBe(0) // 未打卡：0/1
    expect(gated.archived).toBe(false)
    expect(gated.pendingCount).toBe(1)
  })

  it('create_wish 裸愿望事件携派生位：卡显「计划中」与愿望页同源（终审 B1 回归锁）', async () => {
    const store = memoryStore()
    const { run, events } = setup(store, makeConfig(false))
    await run('create_wish', { title: '读一本书', categoryName: '阅读' })
    const wishEvent = events.find((e) => e.kind === 'xingyuan/wish')
    expect(wishEvent, '创建必发愿望事件').toBeDefined()
    const snapshot = (wishEvent!.data as { wish: Record<string, unknown> }).wish
    // 旧缺陷：裸库存记录无派生位 → 卡降级渲染「进度 0%」，与愿望页「计划中」分叉
    expect(snapshot).toHaveProperty('planning', true)
    expect(snapshot).toHaveProperty('pendingCount', 0)
    expect(snapshot).toHaveProperty('settled', false)
    expect(snapshot).toHaveProperty('achieved', false)
  })

  it('claim_task 独立任务（无所属愿望）：不谎报「已计入愿望进度」（终审 B2 回归锁）', async () => {
    const store = memoryStore()
    const today = todayIso()
    const standalone = await createTask(store, { wishId: undefined, name: '独立小事', checkInCycle: 'daily', dueDate: addDays(today, 7) }, today)
    const { run } = setup(store, makeConfig(false))
    const reply = await run('claim_task', { taskId: standalone.taskId }) as string
    expect(reply).toContain('已领取')
    expect(reply).not.toContain('计入')
    expect(reply).not.toContain('愿望')
  })

  it('待收尾愿望增删候选（计数漂移不翻转）：回包不加戏、事件必补发（终审 S4 三方同源锁）', async () => {
    const store = memoryStore()
    const { doneTaskId } = await seedSettled(store)
    const today = todayIso()
    await performCheckIn(store, doneTaskId, undefined, today) // 满进度 + 1 候选 = 待收尾
    const { run, events } = setup(store, makeConfig(false))
    const reply = await run('create_task', { wishId: 'w-gate', name: '又一个想法', checkInCycle: 'once', dueDate: addDays(today, 3) }) as string
    expect(reply, '状态未翻转，回包不得再报「就差最后一步」').not.toContain('就差最后一步')
    const wishEvent = [...events].reverse().find((e) => e.kind === 'xingyuan/wish')
    expect(wishEvent, '待领取数已变而卡定格旧数 = 三方分叉，必须补发').toBeDefined()
    const snapshot = (wishEvent!.data as { wish: Record<string, unknown> }).wish
    expect(snapshot.pendingCount).toBe(2)
    expect(snapshot.settled).toBe(true)
  })
})
