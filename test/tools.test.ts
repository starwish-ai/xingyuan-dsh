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
  it('batch_create_tasks：创建后即时同步愿望库存总数（与单个 create_task 同口径）', async () => {
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
    const stored = store.domain.table('wishes').get(wishId)!
    expect(stored.totalRequiredDays).toBe(5)
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
