/**
 * 图表读侧口径回归：状态/进度类图表采用新鲜化值（与任务页/愿望页一致），
 * 打卡日历未指定月时仅含最近一年（与副标题「最近一年」如实对应）。
 */
import { describe, expect, it } from 'vitest'
import { buildChart, type ChartConfig } from '../src/preset/charts.js'
import type { CheckinRecord } from '../src/domain.js'
import { memoryStore } from './memory-store.js'
import { addDays, todayIso } from '../src/opportunity.js'
import { claimTask, createTask, performCheckIn } from '../src/store.js'

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

  it('满进度有待领取任务：wishProgress 仍上榜（100%）、wishAchievement 不计达成（候选拦达成·消费侧锁）', async () => {
    const store = memoryStore()
    const today = todayIso()
    void store.domain.table('wishes').put('w-hold', {
      wishId: 'w-hold', title: '差一步', categoryName: '学习',
      progress: 100, totalRequiredDays: 1, totalCompletedDays: 1, archived: true, createdAt: `${addDays(today, -2)}T00:00:00`,
    } as never)
    await store.domain.table('tasks').put('t-done', {
      taskId: 't-done', wishId: 'w-hold', name: '已兑现', checkInCycle: 'once', source: 'user',
      status: 'closed', requiredDays: 1, completedDays: 1, closedReason: 'achieved', claimDate: addDays(today, -2), dueDate: addDays(today, -1), createdAt: `${addDays(today, -2)}T00:00:00`,
    } as never)
    await store.domain.table('tasks').put('t-pending', {
      taskId: 't-pending', wishId: 'w-hold', name: '还挂着', checkInCycle: 'once', source: 'ai',
      status: 'pending', requiredDays: 1, completedDays: 0, dueDate: addDays(today, 5), createdAt: `${addDays(today, -2)}T00:00:00`,
    } as never)
    // 旧 `progress < 100` 排行谓词会把满进度愿望剔掉——派生 archived=false（有待领取）必须在榜且显示 100%
    const progress = buildChart('wishProgress', {}, store, CONFIG)
    expect(progress?.data.map((d) => d.value)).toEqual([100])
    // 旧 `progress >= 100` 达成谓词会误报 1/1——候选拦达成后应为 0/1
    const achievement = buildChart('wishAchievement', {}, store, CONFIG)
    expect(achievement?.subtitle).toBe('0/1')
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

describe('统计窗与无安排日口径', () => {
  function putFact(store: ReturnType<typeof memoryStore>, taskId: string, date: string): void {
    const key = `${taskId}|${date}`
    void store.domain.table('checkins').put(key, { checkinId: key, taskId, date, checkedAt: `${date}T10:00:00Z` } satisfies CheckinRecord)
  }

  it('weekComparison：未来预勾（含下周）不进任何桶——此前会错算进本周同星期柱', async () => {
    const store = memoryStore()
    const today = todayIso()
    putFact(store, 't1', today)
    putFact(store, 't1', addDays(today, 7)) // 下周同星期几的未来预勾
    const spec = buildChart('weekComparison', {}, store, CONFIG)
    expect(spec).toBeDefined()
    const sum = (series: string): number =>
      spec!.data.filter((d) => d.series === series).reduce((acc, d) => acc + d.value, 0)
    expect(sum('本周')).toBe(1)
    expect(sum('上周')).toBe(0)
  })

  it('checkinRateTrend：无安排日产出 inactive 点而非 0%', async () => {
    const store = memoryStore()
    const today = todayIso()
    const task = await createTask(store, { name: '每日', checkInCycle: 'daily', dueDate: addDays(today, 2) }, today)
    await claimTask(store, task.taskId, today)
    await performCheckIn(store, task.taskId, undefined, today)
    const spec = buildChart('checkinRateTrend', { days: 5 }, store, CONFIG)
    expect(spec).toBeDefined()
    const data = spec!.data
    expect(data).toHaveLength(5)
    // 今日（锚点=领取日）有安排且已打卡 → 真实 100%
    expect(data[4]!.inactive).toBeUndefined()
    expect(data[4]!.value).toBe(100)
    // 领取前的日子无机会日 → 缺失而非零
    expect(data.slice(0, 4).every((d) => d.inactive === true)).toBe(true)
  })

  it('checkinTrend：窗口内只有未来预勾时返回 undefined（统计不含未来）', () => {
    const store = memoryStore()
    putFact(store, 't1', addDays(todayIso(), 3))
    expect(buildChart('checkinTrend', {}, store, CONFIG)).toBeUndefined()
  })

  it('checkinByCategory：统计窗只含今天（含）以前，未来预勾不混入', async () => {
    const store = memoryStore()
    const today = todayIso()
    putFact(store, 't1', today)
    putFact(store, 't1', addDays(today, 10))
    const spec = buildChart('checkinByCategory', {}, store, CONFIG)
    expect(spec).toBeDefined()
    expect(spec!.data.reduce((acc, d) => acc + d.value, 0)).toBe(1)
  })

  it('taskCompletionRate：分母只计已领取任务（承诺口径），全候选时不出图', async () => {
    const store = memoryStore()
    void store.domain.table('wishes').put('w', {
      wishId: 'w', title: '愿望w', categoryName: '学习',
      progress: 0, totalRequiredDays: 0, totalCompletedDays: 0, archived: false, createdAt: `${todayIso()}T00:00:00`,
    } as never)
    await createTask(store, { name: '未领取', wishId: 'w', checkInCycle: 'daily', dueDate: addDays(todayIso(), 5) }, todayIso())
    // 全候选：无已领取应打天数 → 不出图（不产误导性的 0/0）
    expect(buildChart('taskCompletionRate', {}, store, CONFIG)).toBeUndefined()
    const claimed = await createTask(store, { name: '已领取', wishId: 'w', checkInCycle: 'daily', dueDate: addDays(todayIso(), 5) }, todayIso())
    await claimTask(store, claimed.taskId, todayIso())
    const spec = buildChart('taskCompletionRate', {}, store, CONFIG)
    // 分母 = 已领取任务应打天数；候选的 6 天不计入，副标题恒标注口径
    expect(spec?.subtitle).toBe(`0/${claimed.requiredDays} 天（已领取任务）`)
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
