/**
 * 共享内存域桩：以 Map 实现 KvTable/domain.global 语义，供业务层/工具层/路由层
 * 单测复用（与 store.test.ts 内联桩同一形状；新测试一律从此导入）。
 */
import { xingyuanDomainSpec } from '../src/domain.js'
import type { XingyuanStore } from '../src/domain.js'
import { PREF_DEFAULTS } from '../src/pref-policy.js'
export function memoryStore(): XingyuanStore {
  const tables = new Map<string, Map<string, unknown>>()
  for (const name of Object.keys(xingyuanDomainSpec.tables)) tables.set(name, new Map())
  let globalValue: unknown = structuredClone(xingyuanDomainSpec.global!.initial)
  const idSeq = { n: 0 }
  const domain = {
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
  return {
    spec: xingyuanDomainSpec,
    domain,
    prefs: () => PREF_DEFAULTS,
    newId: () => `id-${++idSeq.n}`,
    checkinKey: (taskId: string, date: string) => `${taskId}|${date}`,
  }
}

