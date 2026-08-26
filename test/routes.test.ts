/**
 * 路由动作面测试：直调导出的 postApi（页面按钮 = 用户本人授权的同一写路径）。
 * 覆盖双平面一致性：删除级联（含微行动状态）、领取联动愿望进度、
 * 分类改名的覆盖键迁移与对话侧工具同口径。
 */
import { describe, expect, it } from 'vitest'
import { postApi } from '../src/routes/api.js'
import type { ApiDeps } from '../src/routes/api.js'
import type { RoutesConfig } from '../src/routes/config.js'
import { createTask, claimTask, performCheckIn } from '../src/store.js'
import { startMicroAction, getMicroAction } from '../src/micro.js'
import { todayIso } from '../src/opportunity.js'
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
