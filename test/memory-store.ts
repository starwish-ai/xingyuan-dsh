/**
 * 共享内存域桩：以 Map 实现 KvTable/domain.global 语义，供业务层/工具层/路由层
 * 单测复用（与 store.test.ts 内联桩同一形状；新测试一律从此导入）。
 */
import { xingyuanDomainSpec } from '../src/domain.js'
import type { XingyuanStore } from '../src/domain.js'
import { PREF_DEFAULTS, type PrefPatch, type PrefSettings, type UiSettings } from '../src/pref-policy.js'
import { normalizeHiddenTabs, TAB_VISIBILITY_DEFAULTS } from '../src/tab-policy.js'
/**
 * 偏好桩（可变且可写）：让「工具写偏好 → 读回比对」这条路径在测试里真走一遍。
 * 真机上写的是主行 volatile 字段，语义同为「宿主接受即生效、下次读即新值」。
 * 内联域桩的测试（store/growth/micro）展开本对象即可，勿再各写一份。
 */
export function memoryPrefs(): Pick<XingyuanStore, 'prefs' | 'uiPrefs' | 'setPrefs'> {
  const prefState: PrefSettings = { ...PREF_DEFAULTS, confirmOps: { ...PREF_DEFAULTS.confirmOps } }
  const uiState: UiSettings = {
    tabVisibilityMode: TAB_VISIBILITY_DEFAULTS.tabVisibilityMode,
    hiddenTabs: [...TAB_VISIBILITY_DEFAULTS.hiddenTabs],
  }
  return {
    prefs: () => ({ ...prefState, confirmOps: { ...prefState.confirmOps } }),
    uiPrefs: () => ({ ...uiState, hiddenTabs: [...uiState.hiddenTabs] }),
    setPrefs: async (patch: PrefPatch) => {
      if (patch.memoryInjectLimit !== undefined) prefState.memoryInjectLimit = patch.memoryInjectLimit
      if (patch.confirmLang !== undefined) prefState.confirmLang = patch.confirmLang
      if (patch.tabVisibilityMode !== undefined) uiState.tabVisibilityMode = patch.tabVisibilityMode
      if (patch.hiddenTabs !== undefined) uiState.hiddenTabs = normalizeHiddenTabs(patch.hiddenTabs)
    },
  }
}

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
          // 宿主契约：dsh-storage-domain 的 update 缺键时先抛 DomainError('missing-key')、
          // 根本不调用 fn——桩必须照此形状，否则「记录不存在」分支在测试里可达而真机不可达
          if (!map.has(key)) throw Object.assign(new Error('no record ' + key + ' to update'), { code: 'missing-key' })
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
    ...memoryPrefs(),
    newId: () => `id-${++idSeq.n}`,
    checkinKey: (taskId: string, date: string) => `${taskId}|${date}`,
  }
}

