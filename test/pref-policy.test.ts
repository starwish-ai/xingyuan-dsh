/**
 * 对话偏好纯策略对拍（pref-policy.ts）+ 字段表 schema 解析（pref-settings.ts）。
 *
 * 覆盖三组事实：输入解析的整数与区间口径（设置页夹取回显的唯一事实源）；
 * memoryInjectLimit 的 step(1) 回归锁——缺 step 时 40.5 会被服务端接受，
 * 手改 profile 补丁里主行的 config 节或 RPC 直写即可绕过整数约束；
 * 以及「解析后的主行 Config → readPrefSettings」这条真实接线（漏标 volatile 即抛）。
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
import { Config } from '../src/index.js'
import { PrefSettingsFields, readPrefSettings } from '../src/pref-settings.js'
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

describe('主行 Config 解析对话偏好（volatile 引用形态）', () => {
  /** volatile 字段解析成引用、非 volatile 仍是裸值——摊平成可比对的裸值。 */
  function unwrap(value: unknown): unknown {
    return typeof value === 'object' && value !== null && 'get' in value
      ? (value as { get(): unknown }).get()
      : value
  }
  const plain = (section: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(section).map(([key, value]) => [key, unwrap(value)]))

  it('缺省解析为各项默认值', () => {
    expect(plain(Config() as unknown as Record<string, unknown>)).toMatchObject(PREF_DEFAULTS)
  })

  it('显式 false 不被 default 吃掉（关掉写确认是有效意图，不是缺省）', () => {
    const parsed = plain(Config({ confirmWrites: false }) as unknown as Record<string, unknown>)
    expect(parsed.confirmWrites).toBe(false)
  })

  /**
   * 真实接线对拍：把**已解析的主行 Config**直接喂给 host 侧读取函数。
   * 上面几条用 unwrap 容忍「引用 or 裸值」，所以漏标 `.volatile()` 时它们照样绿；
   * 而 `readPrefSettings` 走的是 `.get()`——漏标即在插件激活期抛 TypeError。
   * 这条就是那个漏网的负向对照（pref-settings.test.ts 只查 meta，查不到读取面）。
   */
  it('readPrefSettings 吃得下真实解析的 Config（volatile 引用面与 host 读取面接线正确）', () => {
    expect(readPrefSettings(Config() as never)).toEqual(PREF_DEFAULTS)
    expect(readPrefSettings(Config({ memoryInjectLimit: 9 }) as never).memoryInjectLimit).toBe(9)
  })

  it('默认值落在合法区间内', () => {
    expect(PREF_DEFAULTS.memoryInjectLimit).toBeGreaterThanOrEqual(MEMORY_LIMIT_MIN)
    expect(PREF_DEFAULTS.memoryInjectLimit).toBeLessThanOrEqual(MEMORY_LIMIT_MAX)
  })
})

describe('confirmOps（确认类目明细，分层模型见 AGENTS.md §10 决策 8）', () => {
  /** 该字段是 volatile 的：解析出引用，取裸值再比对。 */
  const parseOps = (input: unknown) =>
    PrefSettingsFields.confirmOps(input as never).get()

  it('schema 缺 confirmOps 键解析为类目默认（旧存量值零迁移）', () => {
    expect(parseOps({})).toEqual(CONFIRM_OP_DEFAULTS)
  })

  it('部分对象缺键由各键 default 补齐', () => {
    // 断言对象刻意缺键：schema 解析层负责补默认（类型层要求全键，运行时容错正是被测行为）
    expect(parseOps({ claim: true })).toEqual({ ...CONFIRM_OP_DEFAULTS, claim: true })
  })

  it('显式 false 不被 default 吃掉', () => {
    const allOff = Object.fromEntries(CONFIRM_OPS.map((op) => [op, false])) as PrefSettings['confirmOps']
    expect(parseOps(allOff).create).toBe(false)
  })

  it('normalizeConfirmOps：非对象/缺键/非布尔键一律回落类目默认', () => {
    expect(normalizeConfirmOps(undefined)).toEqual(CONFIRM_OP_DEFAULTS)
    expect(normalizeConfirmOps('junk')).toEqual(CONFIRM_OP_DEFAULTS)
    expect(normalizeConfirmOps({ claim: true })).toEqual({ ...CONFIRM_OP_DEFAULTS, claim: true })
    expect(normalizeConfirmOps({ create: 'yes' })).toEqual(CONFIRM_OP_DEFAULTS)
  })

  it('schema 键与 CONFIRM_OPS 一一对应（防漂移）', () => {
    expect(Object.keys(parseOps({})).sort()).toEqual([...CONFIRM_OPS].sort())
  })
})
