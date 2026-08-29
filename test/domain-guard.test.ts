/**
 * 写路径 schema 闸门回归（架构评审 P1 落地）：dsh-storage-domain 只在冷启动 open
 * 时校验存量记录、写句柄明确「不 re-check」——此前业务层只做零散手工校验，模型侧
 * 超长字符串（如 200 字任务名）会落库成功、下次启动 open 整体失败（invalid-record
 * 拒绝打开，插件永久无法激活）。修复 = makeXingyuanStore 单点拦截全部
 * put/update/global.set。本文件锁死：违规写入必须在写路径当场拒绝、落库零副作用；
 * 合法写入原样透传（loader/integrity 组合测试经同一组装点写入并回读，覆盖透传路径；
 * sqlite-backend.test.ts 另行覆盖冷读持久化，但该测试绕过闸门直连后端契约）。
 */
import { describe, expect, it } from 'vitest'
import { makeXingyuanStore, RecordInvalidError, xingyuanDomainSpec } from '../src/domain.js'
import type { XingyuanStore } from '../src/domain.js'
import { PREF_DEFAULTS } from '../src/pref-policy.js'

/** 内存域桩（仅本文件用：刻意绕过闸门的裸域，用于验证闸门本身的拦截行为）。 */
function rawMemoryDomain(): XingyuanStore['domain'] {
  const tables = new Map<string, Map<string, unknown>>()
  for (const name of Object.keys(xingyuanDomainSpec.tables)) tables.set(name, new Map())
  let globalValue: unknown = structuredClone(xingyuanDomainSpec.global!.initial)
  return {
    name: 'xingyuan',
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
}

function guardedStore(): { store: XingyuanStore; raw: XingyuanStore['domain'] } {
  const raw = rawMemoryDomain()
  return { store: makeXingyuanStore(raw, () => PREF_DEFAULTS), raw }
}

describe('写路径 schema 闸门', () => {
  it('合法任务写入原样落库、可读回（parse 为恒等）', async () => {
    const { store } = guardedStore()
    await store.domain.table('tasks').put('t1', {
      taskId: 't1', name: '晨间散步', checkInCycle: 'daily', source: 'ai',
      status: 'pending', requiredDays: 3, completedDays: 0, createdAt: '2026-08-29T00:00:00',
    })
    expect(store.domain.table('tasks').get('t1')).toMatchObject({ name: '晨间散步' })
  })

  it('超长任务名在写路径当场拒绝（落库零副作用），不再静默砖化下次启动', async () => {
    const { store } = guardedStore()
    const err = await store.domain.table('tasks').put('t1', {
      taskId: 't1', name: '长'.repeat(200), checkInCycle: 'daily', source: 'ai',
      status: 'pending', requiredDays: 3, completedDays: 0, createdAt: '2026-08-29T00:00:00',
    }).then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(RecordInvalidError)
    expect((err as RecordInvalidError).code).toBe('invalid_record')
    expect((err as Error).message).toContain('tasks.name')
    expect(store.domain.table('tasks').get('t1')).toBeUndefined()
  })

  it('update 合并结果同样过闸：改名为空串拒绝、原值保留', async () => {
    const { store } = guardedStore()
    await store.domain.table('tasks').put('t1', {
      taskId: 't1', name: '晨间散步', checkInCycle: 'daily', source: 'ai',
      status: 'pending', requiredDays: 3, completedDays: 0, createdAt: '2026-08-29T00:00:00',
    })
    const err = await store.domain.table('tasks').update('t1', (t) => ({ ...t, name: '' }))
      .then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(RecordInvalidError)
    expect(store.domain.table('tasks').get('t1')).toMatchObject({ name: '晨间散步' })
  })

  it('记忆 value 超上限（>1000）拒绝——工具描述声明的上限此前无强制', async () => {
    const { store } = guardedStore()
    const err = await store.domain.table('memories').put('m1', {
      key: '偏好', value: 'x'.repeat(1001), category: 'preference', importance: 'high', createdAt: 1,
    }).then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(RecordInvalidError)
    expect((err as Error).message).toContain('memories.value')
  })

  it('global.set 违规（未知教练风格）拒绝；合法微行动结构放行', async () => {
    const { store } = guardedStore()
    const bad = await store.domain.global.set({ coachStyle: 'sarcastic', profile: {} } as never)
      .then(() => undefined, (e: unknown) => e)
    expect(bad).toBeInstanceOf(RecordInvalidError)
    await store.domain.global.set({
      coachStyle: 'gentle',
      profile: {},
      microActions: { t1: { taskId: 't1', steps: [
        { stepNumber: 1, instruction: 'a', completed: false, skipped: false },
        { stepNumber: 2, instruction: 'b', completed: false, skipped: false },
        { stepNumber: 3, instruction: 'c', completed: false, skipped: false },
      ], currentStepNumber: 1, updatedAt: '2026-08-29T00:00:00' } },
    })
    expect(store.domain.global.get().microActions?.t1?.steps).toHaveLength(3)
  })
})
