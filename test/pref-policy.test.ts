/**
 * 对话偏好纯策略对拍（pref-policy.ts）+ 命名空间 schema 解析（pref-settings.ts）。
 *
 * 覆盖两组事实：输入解析的整数与区间口径（设置页夹取回显的唯一事实源），
 * 以及 memoryInjectLimit 的 step(1) 回归锁——缺 step 时 40.5 会被服务端接受，
 * 手改设置文档或 RPC 直写即可绕过整数约束。
 */
import { describe, expect, it } from 'vitest'
import {
  CONFIRM_OPS,
  CONFIRM_OP_DEFAULTS,
  MEMORY_LIMIT_MAX,
  MEMORY_LIMIT_MIN,
  PREF_DEFAULTS,
  normalizeConfirmOps,
  parseMemoryLimit,
} from '../src/pref-policy.js'
import { PrefSettingsSchema } from '../src/pref-settings.js'
import type { PrefSettings } from '../src/pref-policy.js'

describe('parseMemoryLimit（记忆注入上限输入解析）', () => {
  it('合法值原样返回且不标夹取', () => {
    expect(parseMemoryLimit('40')).toEqual({ value: 40, clamped: false })
  })

  it('首尾空白容忍', () => {
    expect(parseMemoryLimit('  40  ')).toEqual({ value: 40, clamped: false })
  })

  it('低于下界夹取到下界', () => {
    expect(parseMemoryLimit('3')).toEqual({ value: MEMORY_LIMIT_MIN, clamped: true })
  })

  it('高于上界夹取到上界', () => {
    expect(parseMemoryLimit('999')).toEqual({ value: MEMORY_LIMIT_MAX, clamped: true })
  })

  it('边界值本身不算夹取', () => {
    expect(parseMemoryLimit('5')).toEqual({ value: 5, clamped: false })
    expect(parseMemoryLimit('200')).toEqual({ value: 200, clamped: false })
  })

  it('小数、非数字、空串一律拒绝', () => {
    expect(parseMemoryLimit('40.5')).toBeUndefined()
    expect(parseMemoryLimit('abc')).toBeUndefined()
    expect(parseMemoryLimit('')).toBeUndefined()
    expect(parseMemoryLimit('   ')).toBeUndefined()
  })
})

describe('PrefSettingsSchema（对话偏好命名空间 schema）', () => {
  it('缺省分节解析为默认值', () => {
    expect(PrefSettingsSchema()).toEqual(PREF_DEFAULTS)
  })

  it('step(1) 拒绝小数，防手改文档绕过整数约束', () => {
    expect(() => PrefSettingsSchema({ ...PREF_DEFAULTS, memoryInjectLimit: 40.5 })).toThrow()
  })

  it('越界值被拒绝', () => {
    expect(() => PrefSettingsSchema({ ...PREF_DEFAULTS, memoryInjectLimit: MEMORY_LIMIT_MIN - 1 })).toThrow()
    expect(() => PrefSettingsSchema({ ...PREF_DEFAULTS, memoryInjectLimit: MEMORY_LIMIT_MAX + 1 })).toThrow()
  })

  it('显式 false 不被 default 吃掉', () => {
    expect(PrefSettingsSchema({ ...PREF_DEFAULTS, confirmWrites: false }).confirmWrites).toBe(false)
  })

  it('默认值落在合法区间内', () => {
    expect(PREF_DEFAULTS.memoryInjectLimit).toBeGreaterThanOrEqual(MEMORY_LIMIT_MIN)
    expect(PREF_DEFAULTS.memoryInjectLimit).toBeLessThanOrEqual(MEMORY_LIMIT_MAX)
  })
})

describe('confirmOps（确认类目明细，分层模型见 AGENTS.md §10 决策 8）', () => {
  it('schema 缺 confirmOps 键解析为类目默认（旧存量值零迁移）', () => {
    expect(PrefSettingsSchema().confirmOps).toEqual(CONFIRM_OP_DEFAULTS)
  })

  it('部分对象缺键由各键 default 补齐', () => {
    // 断言对象刻意缺键：schema 解析层负责补默认（类型层要求全键，运行时容错正是被测行为）
    expect(PrefSettingsSchema({ ...PREF_DEFAULTS, confirmOps: { claim: true } as PrefSettings['confirmOps'] }).confirmOps)
      .toEqual({ ...CONFIRM_OP_DEFAULTS, claim: true })
  })

  it('显式 false 不被 default 吃掉', () => {
    const allOff = Object.fromEntries(CONFIRM_OPS.map((op) => [op, false])) as PrefSettings['confirmOps']
    expect(PrefSettingsSchema({ ...PREF_DEFAULTS, confirmOps: allOff }).confirmOps.create).toBe(false)
  })

  it('normalizeConfirmOps：非对象/缺键/非布尔键一律回落类目默认', () => {
    expect(normalizeConfirmOps(undefined)).toEqual(CONFIRM_OP_DEFAULTS)
    expect(normalizeConfirmOps('junk')).toEqual(CONFIRM_OP_DEFAULTS)
    expect(normalizeConfirmOps({ claim: true })).toEqual({ ...CONFIRM_OP_DEFAULTS, claim: true })
    expect(normalizeConfirmOps({ create: 'yes' })).toEqual(CONFIRM_OP_DEFAULTS)
  })

  it('schema 键与 CONFIRM_OPS 一一对应（防漂移）', () => {
    expect(Object.keys(PrefSettingsSchema().confirmOps).sort()).toEqual([...CONFIRM_OPS].sort())
  })
})
