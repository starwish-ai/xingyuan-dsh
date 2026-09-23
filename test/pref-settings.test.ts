/**
 * 主行偏好配置的回归锁。
 *
 * dsh 0.1.7 把设置模型换了：不再有「插件注册命名空间」，可编辑项 = profile 行
 * Config 里标了 `.volatile()` 的字段，客户端按**行 id** 取表单。于是原来那三条
 * 不变量换了形态，本文件逐一对应锁住：
 * 1. 偏好读取每次现取 volatile 引用——热改后下一次执行即生效（旧：setSource 热改）。
 * 2. 每个偏好字段都真的带 volatile——漏标即从表单里消失，且不会有任何报错
 *    （宿主按 volatile 投影表单，非 volatile 字段根本不进 describe()）。
 * 3. 客户端绑定的行 id 确实存在于 bundle 补丁里——这是一处纯字符串耦合
 *    （cordis.patch.yml 的 `id:` ↔ pref-policy 的 SETTINGS_ENTRY_ID），
 *    对不上时整页只会显示「未就绪」，与 0.1.6 那次静默失效同一类坑。
 * 4. 分层不变量（AGENTS.md §10 决策 10）的新形态：设置页要写的行必须由 bundle
 *    常驻层组装；preset 层不得声明任何可编辑配置行（它懒加载，重启后未开星愿
 *    会话之前根本不存在）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TAB_VISIBILITY_DEFAULTS, normalizeHiddenTabs } from '../src/tab-policy.js'
import { PREF_DEFAULTS, SETTINGS_ENTRY_ID, type ConfirmLang, type ConfirmOp } from '../src/pref-policy.js'
import { PrefSettingsFields, readPrefSettings } from '../src/pref-settings.js'
import { UiSettingsFields } from '../src/ui-settings.js'
import { Config } from '../src/index.js'

/** 可编辑偏好字段的全集（新增偏好必须同时进这张表与主行 Config，漏一项即红）。 */
const EDITABLE_FIELDS = [
  'confirmWrites',
  'confirmOps',
  'memoryInjectLimit',
  'confirmLang',
  'tabVisibilityMode',
  'hiddenTabs',
] as const

describe('readPrefSettings（对话偏好读取面）', () => {
  /** 可变引用桩：宿主原地换值即体现为 get() 返回新值。 */
  function refs(initial: {
    confirmWrites: boolean
    confirmOps: Record<ConfirmOp, boolean>
    memoryInjectLimit: number
    confirmLang: ConfirmLang
  }) {
    let value = initial
    return {
      config: {
        confirmWrites: { get: () => value.confirmWrites },
        confirmOps: { get: () => value.confirmOps },
        memoryInjectLimit: { get: () => value.memoryInjectLimit },
        confirmLang: { get: () => value.confirmLang },
      },
      set(next: Partial<typeof value>): void { value = { ...value, ...next } },
    }
  }

  it('每次调用现取引用：热改后无需重建任何注册即生效', () => {
    const h = refs({ ...PREF_DEFAULTS })
    expect(readPrefSettings(h.config)).toEqual(PREF_DEFAULTS)
    h.set({ confirmWrites: false, memoryInjectLimit: 7 })
    expect(readPrefSettings(h.config)).toMatchObject({ confirmWrites: false, memoryInjectLimit: 7 })
  })
})

describe('主行 Config 的表单投影', () => {
  const dict = Config.dict as Record<string, { meta?: { volatile?: boolean } }>

  it('六个偏好字段全部标了 volatile——漏标即从设置页消失且无报错', () => {
    for (const field of EDITABLE_FIELDS) {
      expect(dict[field], `主行 Config 缺少字段 ${field}`).toBeDefined()
      expect(dict[field]?.meta?.volatile, `${field} 未标 volatile`).toBe(true)
    }
  })

  it('反向：主行 Config 的 volatile 字段恰为该清单——新增偏好未登记测试即红', () => {
    // 只测「清单里的字段是 volatile」会漏掉反方向：新加一个 volatile 字段却不进清单，
    // 上一条照样绿。设置页/控制器的表单形状（SettingsFormValue）也按清单维护，故两侧必须等集。
    const volatile = Object.entries(dict)
      .filter(([, field]) => field?.meta?.volatile === true)
      .map(([key]) => key)
      .sort()
    expect(volatile).toEqual([...EDITABLE_FIELDS].sort())
  })

  it('技术参数保持非 volatile（改它们要走重启，不该出现在偏好表单里）', () => {
    for (const field of ['rangeDefaultDays', 'rangeMaxDays', 'memoryListLimit', 'repairSessionLogs']) {
      expect(dict[field]?.meta?.volatile, `${field} 不该是 volatile`).toBeFalsy()
    }
  })

  it('默认值写进 schema，与 pref-policy / tab-policy 的缺失常量同源', () => {
    expect(PrefSettingsFields.confirmWrites.meta.default).toBe(PREF_DEFAULTS.confirmWrites)
    expect(PrefSettingsFields.memoryInjectLimit.meta.default).toBe(PREF_DEFAULTS.memoryInjectLimit)
    expect(PrefSettingsFields.confirmLang.meta.default).toBe(PREF_DEFAULTS.confirmLang)
    expect(UiSettingsFields.tabVisibilityMode.meta.default).toBe(TAB_VISIBILITY_DEFAULTS.tabVisibilityMode)
    expect(UiSettingsFields.hiddenTabs.meta.default).toEqual(TAB_VISIBILITY_DEFAULTS.hiddenTabs)
  })

  it('memoryInjectLimit 服务端也拒小数（step(1) 防手改文档 / RPC 直写绕过界面）', () => {
    const parse = PrefSettingsFields.memoryInjectLimit
    expect(() => parse(40.5 as never)).toThrow()
    expect(() => parse(4 as never)).toThrow()
    expect(() => parse(201 as never)).toThrow()
    // volatile 字段解析出来是引用而非裸值——这正是「原地更新、不重启」的载体
    expect(parse(40).get()).toBe(40)
  })

  it('手改补丁塞进脏 hiddenTabs 不得炸整条主行（Config 解析期必须通过）', () => {
    // 回归锁：hiddenTabs 与存储/路由/preset 发布同挂本行，解析期抛错 = 整个插件不激活。
    // 元素类型放宽为 string + 读取侧 normalize 之后，脏值只能让该偏好失灵，不能上炸。
    const { hiddenTabs } = Config({ hiddenTabs: ['bogus', 'today'] }) as never as { hiddenTabs: { get(): unknown } }
    expect(hiddenTabs.get()).toEqual(['bogus', 'today'])
    expect(normalizeHiddenTabs(hiddenTabs.get())).toEqual(['today'])
  })
})

describe('分层不变量（AGENTS.md §10 决策 10 的新形态）', () => {
  it('preset 层的 Config 不含任何 volatile 字段——用户偏好不得挂在懒加载的会话级层', async () => {
    const { Config: SideConfig } = await import('../src/preset/side.js')
    const dict = (SideConfig as { dict: Record<string, { meta?: { volatile?: boolean } }> }).dict
    const volatileFields = Object.entries(dict)
      .filter(([, field]) => field?.meta?.volatile === true)
      .map(([key]) => key)
    expect(volatileFields, `preset 层承载了偏好字段：${volatileFields.join('/')}`).toEqual([])
  })
})

describe('表单绑定的行 id（client ↔ cordis.patch.yml 的字符串耦合）', () => {
  const patchText = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
  const rowIds = [...patchText.matchAll(/^\s*-?\s*id:\s*([\w-]+)/gm)].map((m) => m[1])

  it('SETTINGS_ENTRY_ID 确实是补丁里的一条行 id', () => {
    expect(rowIds, `cordis.patch.yml 的行 id 为 ${rowIds.join('/')}`).toContain(SETTINGS_ENTRY_ID)
  })

  it('主行 id 不与任何 preset 目录名同名（同名会让会话挂载 preset 死锁，§4 硬约束 1）', () => {
    // 读真实目录名而不是 grep agent.cordis.yml 的文本——后者恒含包名里的
    // "xingyuan"，断言 `toContain('xingyuan')` 无论怎么改都会绿，属自欺。
    const presetNames = readdirSync(fileURLToPath(new URL('../presets/', import.meta.url)), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    expect(presetNames.length, 'presets/ 下没有目录，夹具布局已变').toBeGreaterThan(0)
    expect(presetNames, `主行 id 与 preset 目录同名：${presetNames.join('/')}`).not.toContain(SETTINGS_ENTRY_ID)
  })
})
