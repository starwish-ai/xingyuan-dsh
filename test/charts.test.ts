/**
 * 图表读侧口径回归：状态/进度类图表采用新鲜化值（与任务页/愿望页一致），
 * 打卡日历未指定月时仅含最近一年（与副标题「最近一年」如实对应）。
 */
import { describe, expect, it } from 'vitest'
import { buildChart, type ChartConfig } from '../src/preset/charts.js'
import type { CheckinRecord } from '../src/domain.js'
import { memoryStore } from './memory-store.js'
import { addDays, todayIso } from '../src/opportunity.js'

const CONFIG: ChartConfig = {
  trendDays: 14,
  distributionDays: 30,
  maxDays: 90,
  rankLimit: 10,
  rankMax: 20,
}

describe('图表读侧新鲜化', () => {
  it('taskStatus：跨日陈旧的 in_progress 记录按今日重算为已完结', () => {
    const store = memoryStore()
    const today = todayIso()
    void store.domain.table('tasks').put('stale', {
      taskId: 'stale', name: '陈旧任务', checkInCycle: 'daily', source: 'ai',
      status: 'in_progress', claimDate: addDays(today, -4), dueDate: addDays(today, -1),
      requiredDays: 3, completedDays: 0, createdAt: `${addDays(today, -4)}T00:00:00`,
    } as never)
    const spec = buildChart('taskStatus', {}, store, CONFIG)
    expect(spec).toBeDefined()
    const labels = spec!.data.map((d) => d.label)
    expect(labels).toContain('已完结')
    expect(labels).not.toContain('进行中')
  })

  it('wishProgress/wishAchievement 采用新鲜进度而非库存陈旧值', async () => {
    const store = memoryStore()
    await createAchievedWish(store)
    const progress = buildChart('wishProgress', {}, store, CONFIG)
    // 新鲜化后 progress=100 → archived=true → 从进行中排行剔除
    expect(progress?.data ?? []).toHaveLength(0)
    const achievement = buildChart('wishAchievement', {}, store, CONFIG)
    expect(achievement?.subtitle).toBe('1/1')
  })

  it('checkinCalendar 未指定月仅返回最近一年内的打卡日', () => {
    const store = memoryStore()
    const today = todayIso()
    const putCheckin = (key: string, taskId: string, date: string): void => {
      void store.domain.table('checkins').put(key, { checkinId: key, taskId, date, checkedAt: `${date}T10:00:00Z` } satisfies CheckinRecord)
    }
    putCheckin('t1|old', 't1', addDays(today, -400))
    putCheckin('t1|recent', 't1', addDays(today, -3))
    const spec = buildChart('checkinCalendar', {}, store, CONFIG)
    expect(spec).toBeDefined()
    const labels = spec!.data.map((d) => d.label)
    expect(labels).toContain(addDays(today, -3))
    expect(labels).not.toContain(addDays(today, -400))
  })
})

/** 库存 archived=false 但任务已全部完成的愿望（模拟跨日未回写的陈旧库存）。 */
async function createAchievedWish(store: ReturnType<typeof memoryStore>): Promise<void> {
  const wishId = 'w-stale'
  void store.domain.table('wishes').put(wishId, {
    wishId, title: '已读完的愿望', categoryName: '学习',
    progress: 0, totalRequiredDays: 0, totalCompletedDays: 0, archived: false, createdAt: `${addDays(todayIso(), -10)}T00:00:00`,
  } as never)
  await store.domain.table('tasks').put('done-task', {
    taskId: 'done-task', wishId, name: '完成一步', checkInCycle: 'once', source: 'ai',
    status: 'closed', claimDate: addDays(todayIso(), -9), dueDate: addDays(todayIso(), -8),
    requiredDays: 1, completedDays: 1, closedReason: 'achieved', createdAt: `${addDays(todayIso(), -10)}T00:00:00`,
  } as never)
}
