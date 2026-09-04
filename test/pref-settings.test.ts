/**
 * 对话偏好命名空间的回归锁（P0b）。
 *
 * 锁三条不变量，对应「设置页常驻可见、偏好却在 preset 层缺席」这次 P0 的三个面：
 * 1. bundle 层在 settings 服务可用时**立即**注册 `xingyuan-pref`（不依赖 preset 挂载）。
 * 2. 读取 thunk 每次取当前解析值——设置热改后无需重建任何注册即生效。
 * 3. 分层不变量：**设置页绑定的任何命名空间，都不得由 preset 层注册**。
 *    这是本次根因的抽象形态，比"禁止某个具体字段放在 preset 层"更耐久——
 *    按 AGENTS.md §5.8 的判定口径，会话级能力仍可挂 preset 层，但凡出现在
 *    常驻设置页里的必须是 bundle 层常驻命名空间。
 *
 * 说明：本文件只测宿主半侧。服务桩仅实现 `ctx.settings.installSection`（0.1.2 起的
 * 服务面安装法）真正被调用的一面（记录注册 + 经 setSource 暴露解析值），不继承
 * `SettingsProvider`，避免把测试绑死在 dsh 的 Service 生命周期上。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { PREF_DEFAULTS, type PrefSettings } from '../src/pref-policy.js'
import { installPrefSettings, PREF_NS } from '../src/pref-settings.js'

/** settings 服务桩：记录注册请求，并可改写 scope 的解析值以模拟热改。 */
function settingsStub(initial: Record<string, unknown> = {}) {
  const registered: string[] = []
  let value: Record<string, unknown> = initial
  return {
    registered,
    /** 模拟用户在设置页改值（Host 层解析后的结果）。 */
    setResolved(next: Record<string, unknown>): void { value = next },
    /** 新服务面桩：installSection 真实行为 = register + setSource(scope.get)。 */
    installSection(_owner: unknown, ns: unknown, _schema: unknown, _entry: unknown, hooks: {
      setSource: (current: () => Record<string, unknown>) => void
      onChange: () => void
    }): void {
      registered.push(String(ns))
      hooks.setSource(() => value)
      hooks.onChange()
    },
  }
}

interface Harness {
  fiber: Fiber
  read: () => PrefSettings
  settings: ReturnType<typeof settingsStub>
}

/**
 * 以插件行装载安装函数（而非裸函数调用）：拿到 Fiber 才能逐例 dispose，
 * 且 `ctx.inject` 无论依赖是否已就绪都在后续微任务才回调——故返回后须 await 一拍。
 */
function mount(settings?: ReturnType<typeof settingsStub>): Harness {
  const ctx = new Context()
  if (settings !== undefined) ctx.provide('settings', settings)
  let read: (() => PrefSettings) | undefined
  const fiber = ctx.plugin((c: Context) => { read = installPrefSettings(c) })
  return { fiber, read: () => read!(), settings: settings ?? settingsStub() }
}

/** 等一拍：注册回调在后续微任务才触发（实测结论，勿改成同步断言）。 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const harnesses: Harness[] = []
afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.fiber.dispose()
})

describe('installPrefSettings（bundle 层常驻注册）', () => {
  it('settings 服务可用时注册 xingyuan-pref，且不依赖 preset 挂载', async () => {
    // 只跑 bundle 层的安装函数，未装载任何 preset——这正是 P0 的缺席场景
    const h = mount(settingsStub())
    harnesses.push(h)
    await settle()

    expect(PREF_NS).toBe('xingyuan-pref')
    expect(h.settings.registered).toContain(PREF_NS)
  })

  it('读取 thunk 每次取当前解析值：设置热改即时生效，无需重建注册', async () => {
    const h = mount(settingsStub({ ...PREF_DEFAULTS }))
    harnesses.push(h)
    await settle()
    expect(h.read()).toEqual(PREF_DEFAULTS)

    h.settings.setResolved({ confirmWrites: false, memoryInjectLimit: 7 })
    expect(h.read().confirmWrites).toBe(false)
    expect(h.read().memoryInjectLimit).toBe(7)
  })

  it('settings 服务缺席时回落 schema 默认且不抛错（headless 路径）', async () => {
    const h = mount()
    harnesses.push(h)
    await settle()
    expect(h.read()).toEqual(PREF_DEFAULTS)
  })
})

describe('设置命名空间的分层不变量', () => {
  const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))

  /** 递归列出目录下所有 .ts 文件（相对 src/ 的路径）。 */
  function listTs(relDir: string): string[] {
    const abs = srcRoot + relDir
    return readdirSync(abs).flatMap((entry) => {
      const rel = `${relDir}${entry}`
      return statSync(srcRoot + rel).isDirectory() ? listTs(`${rel}/`) : rel.endsWith('.ts') ? [rel] : []
    })
  }

  /**
   * 收集一个文件里所有「注册到 settings 的命名空间名」：
   * `ctx.settings.installSection(owner, ns, ...)`（ns 为字面量或同文件的字符串常量）。
   * 0.1.2 起旧 `settingsNamespace('x')` 独立函数已删除，注册面收进服务方法。
   */
  function collectRegistered(rel: string): string[] {
    const text = readFileSync(srcRoot + rel, 'utf8')
    const out: string[] = []
    for (const m of text.matchAll(/installSection\(\s*[^,]+,\s*(?:'([^']+)'|([A-Za-z_]\w*))/g)) {
      if (m[1] !== undefined) {
        out.push(m[1])
        continue
      }
      const def = new RegExp(`const ${m[2]}\\s*(?::[^=]+)?=\\s*'([^']+)'`).exec(text)
      const name = def?.[1]
      if (name !== undefined) out.push(name)
    }
    return out
  }

  const BOUND = /settingsScope\.bind\(\s*\{\s*namespace:\s*'([^']+)'/g

  /** 收集源码里 `bind({ namespace: 'x' })` 的绑定名。 */
  function collectBound(rel: string): string[] {
    const text = readFileSync(srcRoot + rel, 'utf8')
    return [...text.matchAll(BOUND)].map((m) => m[1]).filter((ns): ns is string => ns !== undefined)
  }

  it('设置页绑定的命名空间无一由 preset 层注册', () => {
    const presetFiles = listTs('preset/')
    const clientFiles = listTs('client/')
    expect(presetFiles.length).toBeGreaterThan(0)
    expect(clientFiles.length).toBeGreaterThan(0)

    // 设置页（常驻可见）实际绑定的命名空间
    const bound = new Set(clientFiles.flatMap((rel) => collectBound(rel)))
    expect(bound.size, '未从 client 层解析到任何绑定，正则可能已失效').toBeGreaterThan(0)

    // preset 层注册的命名空间——懒加载，首次开星愿会话才存在
    const byPreset = new Set(presetFiles.flatMap((rel) => collectRegistered(rel)))

    // 交集必须为空：设置页常驻可见，其数据若来自 preset 层就会「整页可见而数据缺席」
    expect([...bound].filter((ns) => byPreset.has(ns))).toEqual([])
  })

  it('两个偏好命名空间都在 bundle 层注册', () => {
    const bundleFiles = ['index.ts', 'ui-settings.ts', 'pref-settings.ts']
    const registered = new Set(bundleFiles.flatMap((rel) => collectRegistered(rel)))
    for (const ns of ['xingyuan-pref', 'xingyuan-ui']) {
      expect(registered, `bundle 层未注册 ${ns}`).toContain(ns)
    }
  })
})
