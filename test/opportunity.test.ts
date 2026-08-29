/**
 * opportunity.ts 对拍测试：TaskCheckInCalculatorUtilTest.java 全部用例逐条翻译。
 * 机会日 = 锚点日 + 周期 + 截止日；requiredDays 与机会日集合严格一致（唯一口径）。
 */
import { describe, expect, it } from 'vitest'
import {
  calculateOpportunityDates,
  calculateRequiredDays,
  findFirstUncheckedOpportunityDate,
  isIsoDate,
  isTaskDone,
  shouldRestartFromExpired,
} from '../src/opportunity.js'

describe('isIsoDate 语义校验（回归：Date.parse 只查「月01-12/日01-31」，不查月长度）', () => {
  it('月长度非法的日期必须拒绝（2026-02-30 会滚动成 03-02 的合法时间戳）', () => {
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isIsoDate('2026-04-31')).toBe(false)
  })
  it('月/日范围非法与格式非法拒绝；真实日历日期接受（含闰日与地平线远期）', () => {
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-00-10')).toBe(false)
    expect(isIsoDate('2026-1-1')).toBe(false)
    expect(isIsoDate('not-a-date')).toBe(false)
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2026-12-31')).toBe(true)
    expect(isIsoDate('9999-12-31')).toBe(true)
  })
})

describe('TaskCheckInCalculatorUtil 对拍：calculateOpportunityDates', () => {
  it('DAILY：锚点日起每天，含截止日', () => {
    expect(calculateOpportunityDates('2026-01-01', '2026-01-05', 'daily')).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05',
    ])
    expect(calculateRequiredDays('2026-01-01', '2026-01-05', 'daily')).toBe(5)
  })

  it('WEEKLY：锚点日起每 7 天', () => {
    expect(calculateOpportunityDates('2026-01-01', '2026-01-22', 'weekly')).toEqual([
      '2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22',
    ])
    expect(calculateRequiredDays('2026-01-01', '2026-01-22', 'weekly')).toBe(4)
  })

  it('MONTHLY 自然月：1/31 锚点 → 1/31, 2/28, 3/31（日期钳制）', () => {
    expect(calculateOpportunityDates('2026-01-31', '2026-03-31', 'monthly')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31',
    ])
    expect(calculateRequiredDays('2026-01-31', '2026-03-31', 'monthly')).toBe(3)
  })

  it('MONTHLY：1/15 锚点、截止 4/15 → 每月 15 号', () => {
    expect(calculateOpportunityDates('2026-01-15', '2026-04-15', 'monthly')).toEqual([
      '2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15',
    ])
  })

  it('ONCE：机会日仅截止日，可提前勾', () => {
    expect(calculateOpportunityDates('2026-01-01', '2026-01-10', 'once')).toEqual(['2026-01-10'])
    expect(calculateRequiredDays('2026-01-01', '2026-01-10', 'once')).toBe(1)
  })

  it('无截止日：机会日为空集合（无机会日约束），requiredDays=0，不产生死循环', () => {
    expect(calculateOpportunityDates('2026-01-01', undefined, 'daily')).toEqual([])
    expect(calculateRequiredDays('2026-01-01', undefined, 'daily')).toBe(0)
  })

  it('ONCE 无截止日：requiredDays=1（点击打卡即完成，打卡当天即打卡日）', () => {
    expect(calculateOpportunityDates('2026-01-01', undefined, 'once')).toEqual([])
    expect(calculateRequiredDays('2026-01-01', undefined, 'once')).toBe(1)
  })

  it('无效周期：空集合', () => {
    expect(calculateOpportunityDates('2026-01-01', '2026-01-10', 'unknown')).toEqual([])
  })
})

describe('TaskCheckInCalculatorUtil 对拍：shouldRestartFromExpired / isTaskDone / findFirstUnchecked', () => {
  it('重新开始：仅过期关闭且未达标可复活；已达成/未过期/非closed不允许', () => {
    // 过期未达标（旧截止日已过、completed < oldRequired）→ 允许
    expect(shouldRestartFromExpired('closed', '2026-01-10', '2026-01-15', 30, 29)).toBe(true)
    // 已达成（completed >= oldRequired）→ 不允许复活
    expect(shouldRestartFromExpired('closed', '2026-01-10', '2026-01-15', 30, 30)).toBe(false)
    // 未过期关闭（旧截止日 >= today）→ 不允许
    expect(shouldRestartFromExpired('closed', '2026-01-20', '2026-01-15', 30, 5)).toBe(false)
    // 非 closed → 不允许
    expect(shouldRestartFromExpired('in_progress', '2026-01-10', '2026-01-15', 30, 5)).toBe(false)
    // 无旧截止日 → 不允许
    expect(shouldRestartFromExpired('closed', null, '2026-01-15', 30, 5)).toBe(false)
  })

  it('isTaskDone：统一达标判定口径', () => {
    expect(isTaskDone(30, 30)).toBe(true)
    expect(isTaskDone(30, 29)).toBe(false)
    expect(isTaskDone(0, 0)).toBe(false)
    expect(isTaskDone(null, 5)).toBe(false)
  })

  it('findFirstUnchecked：从 today（含）起第一个未勾选机会日', () => {
    // 今天即打卡日且未勾 → 返回今天
    expect(findFirstUncheckedOpportunityDate('2026-08-20', '2026-08-25', 'daily', new Set(), '2026-08-22')).toBe('2026-08-22')
    // 今天已勾 → 返回明天
    const checked = new Set(['2026-08-22'])
    expect(findFirstUncheckedOpportunityDate('2026-08-20', '2026-08-25', 'daily', checked, '2026-08-22')).toBe('2026-08-23')
    // 过去的打卡日不回补：锚点 8/01 weekly → 机会日 8/01,8/08,8/15,8/22；today=8/22 未勾 → 返回今天
    const past = findFirstUncheckedOpportunityDate('2026-08-01', '2026-08-25', 'weekly', new Set(), '2026-08-22')
    expect(past).toBe('2026-08-22')
    // 无截止日 → 恒返回 today
    expect(findFirstUncheckedOpportunityDate('2026-08-01', undefined, 'daily', new Set(), '2026-08-22')).toBe('2026-08-22')
    // 全部勾完 → null
    const all = new Set(calculateOpportunityDates('2026-08-20', '2026-08-21', 'daily'))
    expect(findFirstUncheckedOpportunityDate('2026-08-20', '2026-08-21', 'daily', all, '2026-08-25')).toBe(null)
  })

  it('MONTHLY 钳制回归：1/29~1/31 锚点在平年 2 月钳到 2/28', () => {
    expect(calculateOpportunityDates('2026-01-29', '2026-04-01', 'monthly')).toEqual([
      '2026-01-29', '2026-02-28', '2026-03-29',
    ])
    expect(calculateOpportunityDates('2026-01-30', '2026-04-01', 'monthly')).toEqual([
      '2026-01-30', '2026-02-28', '2026-03-30',
    ])
  })
})

describe('机会日序列终止性（回归：ISO 字符串比较在 4 位年边界恒假导致死循环）', () => {
  it('锚点与截止同在 9999 年内：daily/weekly/monthly 有限收敛', () => {
    // 9999 年非闰年：365 天；weekly 每 7 天 53 个；monthly 逐月 12 个
    expect(calculateOpportunityDates('9999-01-01', '9999-12-31', 'daily')).toHaveLength(365)
    expect(calculateOpportunityDates('9999-01-01', '9999-12-31', 'weekly')).toHaveLength(53)
    expect(calculateOpportunityDates('9999-01-31', '9999-12-31', 'monthly')).toHaveLength(12)
  })

  it('远期截止（9999-12-31）逐期物化有限收敛，末日恰为截止日', () => {
    // 2026-01 至 9999-12 共 95688 个月；此前字符串比较下 '10000-xx' < '9999-xx' 恒真
    //（'1' < '9'），monthly 分支永不终止——数值比较后平凡到达终点
    const dates = calculateOpportunityDates('2026-01-31', '9999-12-31', 'monthly')
    expect(dates).toHaveLength(95688)
    expect(dates[dates.length - 1]).toBe('9999-12-31')
  })

  it('普通区间语义不变：数值比较与字典序同结果（对拍）', () => {
    expect(calculateOpportunityDates('2026-01-01', '2026-01-05', 'daily')).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05',
    ])
    expect(calculateOpportunityDates('2026-01-31', '2026-03-31', 'monthly')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31',
    ])
  })
})
