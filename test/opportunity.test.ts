/**
 * opportunity.ts 对拍测试：TaskCheckInCalculatorUtilTest.java 全部用例逐条翻译。
 * 机会日 = 锚点日 + 周期 + 截止日；requiredDays 与机会日集合严格一致（唯一口径）。
 */
import { describe, expect, it } from 'vitest'
import {
  calculateOpportunityDates,
  calculateRequiredDays,
  findFirstUncheckedOpportunityDate,
  isTaskDone,
  shouldRestartFromExpired,
} from '../src/opportunity.js'

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
