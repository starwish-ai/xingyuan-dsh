/**
 * 微行动业务测试：开始/恢复、顺序步进（complete/skip）、完成收敛、重开清除。
 * 状态挂 domain.global 节（microActions），与真实存储同一写路径。
 */
import { describe, expect, it } from 'vitest'
import { xingyuanDomainSpec } from '../src/domain.js'
import type { XingyuanGlobal, XingyuanStore } from '../src/domain.js'
import { PREF_DEFAULTS } from '../src/pref-policy.js'
import { completeMicroStep, getMicroAction, restartMicroAction, startMicroAction } from '../src/micro.js'

function memoryStore(): XingyuanStore {
  let globalValue: XingyuanGlobal = structuredClone(xingyuanDomainSpec.global!.initial) as XingyuanGlobal
  const domain = {
    global: {
      get: () => globalValue,
      set: async (v: unknown) => { globalValue = v as XingyuanGlobal },
    },
    table: () => { throw new Error('micro tests do not touch tables') },
    close: async () => {},
  } as unknown as XingyuanStore['domain']
  return {
    spec: xingyuanDomainSpec,
    domain,
    prefs: () => PREF_DEFAULTS,
    newId: () => 'x',
    checkinKey: (t: string, d: string) => `${t}|${d}`,
  }
}

const STEPS = [
  { instruction: '打开文档', rationale: '降低启动成本' },
  { instruction: '读第一段' },
  { instruction: '写一句总结' },
] as const

describe('startMicroAction', () => {
  it('新建拆解：3 步、当前步=1、步骤编号自动排布', async () => {
    const store = memoryStore()
    const { state, resumed } = await startMicroAction(store, 't1', STEPS)
    expect(resumed).toBe(false)
    expect(state.steps.map((s) => s.stepNumber)).toEqual([1, 2, 3])
    expect(state.currentStepNumber).toBe(1)
    expect(getMicroAction(store, 't1')?.steps[0]?.rationale).toBe('降低启动成本')
  })

  it('步骤数越界拒绝', async () => {
    const store = memoryStore()
    await expect(startMicroAction(store, 't1', STEPS.slice(0, 2))).rejects.toThrow('3-7')
  })

  it('已有进行中拆解 → 恢复语义原样返回', async () => {
    const store = memoryStore()
    const first = await startMicroAction(store, 't1', STEPS)
    await completeMicroStep(store, 't1', 1, 'complete')
    const again = await startMicroAction(store, 't1', [{ instruction: '完全不同的步骤' }, { instruction: 'x' }, { instruction: 'y' }])
    expect(again.resumed).toBe(true)
    expect(again.state.steps[0]?.instruction).toBe(first.state.steps[0]?.instruction)
  })
})

describe('completeMicroStep', () => {
  it('只允许当前步；完成推进；跳过同样推进', async () => {
    const store = memoryStore()
    await startMicroAction(store, 't1', STEPS)
    await expect(completeMicroStep(store, 't1', 2, 'complete')).rejects.toThrow('只能处理当前步')
    const skip = await completeMicroStep(store, 't1', 1, 'skip')
    expect(skip.finished).toBe(false)
    expect(skip.state.steps[0]?.skipped).toBe(true)
    expect(skip.state.currentStepNumber).toBe(2)
  })

  it('全部处理完 → currentStepNumber 归 null 且 finished=true', async () => {
    const store = memoryStore()
    await startMicroAction(store, 't1', STEPS)
    await completeMicroStep(store, 't1', 1, 'complete')
    await completeMicroStep(store, 't1', 2, 'skip')
    const last = await completeMicroStep(store, 't1', 3, 'complete')
    expect(last.finished).toBe(true)
    expect(last.state.currentStepNumber).toBeNull()
  })

  it('完成后重复处理同一步拒绝（先命中当前步守卫）', async () => {
    const store = memoryStore()
    await startMicroAction(store, 't1', STEPS)
    await completeMicroStep(store, 't1', 1, 'complete')
    await expect(completeMicroStep(store, 't1', 1, 'complete')).rejects.toThrow('只能处理当前步')
  })
})

describe('restartMicroAction', () => {
  it('清除后可重新开始；无拆解返回 false', async () => {
    const store = memoryStore()
    await startMicroAction(store, 't1', STEPS)
    expect(await restartMicroAction(store, 't1')).toBe(true)
    expect(getMicroAction(store, 't1')).toBeUndefined()
    expect(await restartMicroAction(store, 't1')).toBe(false)
  })
})
