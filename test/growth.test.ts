/**
 * 成长统计测试：打卡 / 经验 / 连续口径逐用例回归，外加等级解析与聚合汇总。
 */
import { describe, expect, it } from 'vitest'
import { xingyuanDomainSpec } from '../src/domain.js'
import type { XingyuanStore } from '../src/domain.js'
import { PREF_DEFAULTS } from '../src/pref-policy.js'
import {
  BASE_EXPERIENCE,
  LEVEL_CONFIGS,
  calculateExperience,
  computeCheckInStats,
  growthSummary,
  resolveLevel,
} from '../src/growth.js'

/** 内存域桩：与 store.test.ts 同一装置语义。 */
function memoryStore(): XingyuanStore {
  const tables = new Map<string, Map<string, unknown>>()
  for (const name of Object.keys(xingyuanDomainSpec.tables)) tables.set(name, new Map())
  let globalValue: unknown = structuredClone(xingyuanDomainSpec.global!.initial)
  const domain = {
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
    newId: () => 'x',
    checkinKey: (taskId: string, date: string) => `${taskId}|${date}`,
  }
}

/** 写入一条打卡记录（键 = taskId|date，与真实存储一致）。 */
async function checkin(store: XingyuanStore, taskId: string, date: string): Promise<void> {
  await store.domain.table('checkins').put(store.checkinKey(taskId, date), {
    checkinId: store.checkinKey(taskId, date),
    taskId,
    date,
    checkedAt: `${date}T12:00:00Z`,
  })
}

/** 多任务同日：date 上落 count 条记录（经验按条发放的载体）。 */
async function checkinMany(store: XingyuanStore, date: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await checkin(store, `task-${i}`, date)
}

const d = (day: number): string => `2026-01-${String(day).padStart(2, '0')}`

describe('calculateExperience 连续加成', () => {
  it('1-2 天 ×1.0；3-6 天 ×1.2；≥7 天 ×1.5；四舍五入', () => {
    expect(BASE_EXPERIENCE).toBe(10)
    expect(calculateExperience(1)).toBe(10)
    expect(calculateExperience(2)).toBe(10)
    expect(calculateExperience(3)).toBe(12)
    expect(calculateExperience(6)).toBe(12)
    expect(calculateExperience(7)).toBe(15)
  })
})

describe('computeCheckInStats：CheckInStatsCalculatorTest 对拍', () => {
  it('空记录：全部归零、无 lastCheckInDate', async () => {
    const stats = computeCheckInStats(memoryStore(), d(10))
    expect(stats).toMatchObject({ totalCheckInDays: 0, continuousCheckInDays: 0, maxContinuousCheckInDays: 0, totalExperience: 0 })
    expect(stats.lastCheckInDate).toBeUndefined()
  })

  it('连续 3 天：连续 3、经验 10+10+12（3 天起 1.2 倍）', async () => {
    const store = memoryStore()
    await checkinMany(store, d(1), 1)
    await checkinMany(store, d(2), 1)
    await checkinMany(store, d(3), 1)
    expect(computeCheckInStats(store, d(3))).toMatchObject({
      totalCheckInDays: 3, continuousCheckInDays: 3, maxContinuousCheckInDays: 3,
      lastCheckInDate: d(3), totalExperience: 10 + 10 + 12,
    })
  })

  it('断更（D1,D2,D4，today=D10）：当前连续从 D4 倒推为 1 不归零；最长保留 2；经验 30', async () => {
    const store = memoryStore()
    for (const day of [1, 2, 4]) await checkinMany(store, d(day), 1)
    expect(computeCheckInStats(store, d(10))).toMatchObject({
      totalCheckInDays: 3, continuousCheckInDays: 1, maxContinuousCheckInDays: 2, totalExperience: 30,
    })
  })

  it('断更冻结（D1-D7 连续，today=D10）：当前连续冻结为 7', async () => {
    const store = memoryStore()
    for (const day of [1, 2, 3, 4, 5, 6, 7]) await checkinMany(store, d(day), 1)
    const stats = computeCheckInStats(store, d(10))
    expect(stats.continuousCheckInDays).toBe(7)
    expect(stats.maxContinuousCheckInDays).toBe(7)
  })

  it('取消中间一天后重放（D1,D3）：经验回到 20，杜绝增量扣减漂移（E1 回归）', async () => {
    const store = memoryStore()
    await checkinMany(store, d(1), 1)
    await checkinMany(store, d(3), 1)
    expect(computeCheckInStats(store, d(3))).toMatchObject({
      totalCheckInDays: 2, continuousCheckInDays: 1, totalExperience: 20,
    })
  })

  it('补卡乱序写入：按日期排序重放结果一致（E2 回归）——存储层天然有序', async () => {
    const store = memoryStore()
    // 写入顺序 D3,D1,D2；重放按日期排序 → 与有序写入等价
    await checkinMany(store, d(3), 1)
    await checkinMany(store, d(1), 1)
    await checkinMany(store, d(2), 1)
    expect(computeCheckInStats(store, d(3))).toMatchObject({
      totalCheckInDays: 3, continuousCheckInDays: 3, totalExperience: 32,
    })
  })

  it('同日多条记录：去重计 1 天，但每条记录各发一份经验（多劳多得）', async () => {
    const store = memoryStore()
    await checkinMany(store, d(1), 3)
    expect(computeCheckInStats(store, d(1))).toMatchObject({
      totalCheckInDays: 1, continuousCheckInDays: 1, totalExperience: 30,
    })
  })

  it('过去连续 7 天：经验 10+10+12×4+15', async () => {
    const store = memoryStore()
    for (const day of [1, 2, 3, 4, 5, 6, 7]) await checkinMany(store, d(day), 1)
    expect(computeCheckInStats(store, d(7)).totalExperience).toBe(10 + 10 + 12 * 4 + 15)
  })

  it('未来预勾不劫持当前连续（D1,D2 实打 + D15 预勾，today=D2）：当前连续 2、累计 3、最长 2、经验含未来记录', async () => {
    const store = memoryStore()
    await checkinMany(store, d(1), 1)
    await checkinMany(store, d(2), 1)
    await checkinMany(store, d(15), 1)
    expect(computeCheckInStats(store, d(2))).toMatchObject({
      totalCheckInDays: 3, continuousCheckInDays: 2, maxContinuousCheckInDays: 2,
      lastCheckInDate: d(15), totalExperience: 30,
    })
  })

  it('全部未来记录（today=D2）：当前连续 0，累计/最长/经验计入（纯预勾承诺）', async () => {
    const store = memoryStore()
    for (const day of [15, 16, 17]) await checkinMany(store, d(day), 1)
    expect(computeCheckInStats(store, d(2))).toMatchObject({
      totalCheckInDays: 3, continuousCheckInDays: 0, maxContinuousCheckInDays: 3, totalExperience: 10 + 10 + 12,
    })
  })

  it('跨月连续：1/31 与 2/1 相邻', async () => {
    const store = memoryStore()
    await checkin(store, 't', '2026-01-31')
    await checkin(store, 't', '2026-02-01')
    expect(computeCheckInStats(store, '2026-02-01')).toMatchObject({
      totalCheckInDays: 2, continuousCheckInDays: 2,
    })
  })
})

describe('resolveLevel 等级解析', () => {
  it('等级表为权威种子：10 级、阈值单调递增、Lv.10 为星愿大师', () => {
    expect(LEVEL_CONFIGS).toHaveLength(10)
    expect(LEVEL_CONFIGS[0]).toMatchObject({ levelName: '初心者', requiredExperience: 0 })
    expect(LEVEL_CONFIGS[9]).toMatchObject({ levelName: '星愿大师', requiredExperience: 5200 })
    for (let i = 1; i < LEVEL_CONFIGS.length; i++) {
      expect(LEVEL_CONFIGS[i]!.requiredExperience).toBeGreaterThan(LEVEL_CONFIGS[i - 1]!.requiredExperience)
    }
  })

  it('0 经验 → Lv.1；99 → Lv.1；100 → Lv.2；5200+ → Lv.10 满级进度 100', () => {
    expect(resolveLevel(0).level).toBe(1)
    expect(resolveLevel(99)).toMatchObject({ level: 1, nextLevelExperience: 100, levelProgress: 99 })
    expect(resolveLevel(100)).toMatchObject({ level: 2, nextLevelExperience: 300, levelProgress: 33 })
    const master = resolveLevel(9999)
    expect(master.level).toBe(10)
    expect(master.nextLevelExperience).toBeNull()
    expect(master.levelProgress).toBe(100)
  })
})

describe('growthSummary 聚合', () => {
  it('愿望/任务计数：已达成任务按 closed+achieved，愿望按应打完成', async () => {
    const store = memoryStore()
    await store.domain.table('wishes').put('w1', {
      wishId: 'w1', title: '健康生活', categoryName: '健康', progress: 100,
      totalRequiredDays: 10, totalCompletedDays: 10, archived: true, createdAt: '2026-01-01',
    })
    await store.domain.table('tasks').put('t1', {
      taskId: 't1', wishId: 'w1', name: '晨跑', checkInCycle: 'daily', source: 'user',
      status: 'closed', requiredDays: 10, completedDays: 10, closedReason: 'achieved', createdAt: '2026-01-01T00:00:00',
    })
    await store.domain.table('tasks').put('t2', {
      taskId: 't2', wishId: undefined, name: '随笔', checkInCycle: 'once', source: 'user',
      status: 'pending', requiredDays: 1, completedDays: 0, createdAt: '2026-01-01T00:00:00',
    })
    await checkinMany(store, '2026-01-05', 2)
    const summary = growthSummary(store, '2026-01-06')
    expect(summary.totalWishes).toBe(1)
    expect(summary.completedWishes).toBe(1)
    expect(summary.totalTasks).toBe(2)
    expect(summary.completedTasks).toBe(1)
    expect(summary.stats.totalCheckInDays).toBe(1)
    expect(summary.stats.totalExperience).toBe(20)
    expect(summary.level.level).toBe(1)
  })

  it('满进度仍有待领取任务：不计入已达成（消费位取派生 archived——旧 progress>=100 谓词会误计）', async () => {
    const store = memoryStore()
    await store.domain.table('wishes').put('w-hold', {
      wishId: 'w-hold', title: '差一步', categoryName: '学习', progress: 100,
      totalRequiredDays: 1, totalCompletedDays: 1, archived: true, createdAt: '2026-01-01',
    })
    await store.domain.table('tasks').put('t-done', {
      taskId: 't-done', wishId: 'w-hold', name: '已兑现', checkInCycle: 'once', source: 'user',
      status: 'closed', requiredDays: 1, completedDays: 1, closedReason: 'achieved', claimDate: '2026-01-01', createdAt: '2026-01-01T00:00:00',
    })
    await store.domain.table('tasks').put('t-pending', {
      taskId: 't-pending', wishId: 'w-hold', name: '还挂着', checkInCycle: 'once', source: 'ai',
      status: 'pending', requiredDays: 1, completedDays: 0, createdAt: '2026-01-01T00:00:00',
    })
    const summary = growthSummary(store, '2026-01-06')
    expect(summary.totalWishes).toBe(1)
    // freshWishes 派生 archived=false（进度满但有待领取 = 待收尾），达成计数必须为 0
    expect(summary.completedWishes).toBe(0)
  })
})

describe('等级词表对拍（客户端 i18n ↔ 服务端权威源）', () => {
  it('zh 词典的 growth.lv.N.name/reward 与 LEVEL_CONFIGS 逐字一致（漂移即红）', async () => {
    const { ZH_DICT } = await import('../src/client/i18n.js')
    for (const config of LEVEL_CONFIGS) {
      expect(ZH_DICT[`growth.lv.${config.level}.name` as keyof typeof ZH_DICT]).toBe(config.levelName)
      expect(ZH_DICT[`growth.lv.${config.level}.reward` as keyof typeof ZH_DICT]).toBe(config.rewardDescription)
    }
    // 词表恰好覆盖 1-10：多键（未来扩级未同步）或漏键都算漂移
    const levelKeys = Object.keys(ZH_DICT).filter((key) => key.startsWith('growth.lv.'))
    expect(levelKeys).toHaveLength(20)
  })
})
