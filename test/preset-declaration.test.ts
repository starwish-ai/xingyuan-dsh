/**
 * preset 注册门禁（dsh 0.1.7 机制迁移，2026-09-23）。
 *
 * 宿主自 0.1.7 起**不再扫描任何 preset 目录**（旧形态 `$DSH_HOME/.agent-presets/<id>/`
 * 含 preset.yml + agent.cordis.yml 已废，官方口径见 dsh-agent-preset 的
 * skills/editing-cordis-compositions）：一个 preset 就是 bundle 补丁里的一行
 * `@deepseek-ai/dsh-agent-preset` 声明，激活期由该插件提交给 agentPresets 注册表。
 * 声明行缺席的后果是「Agent 预设」选择器里根本不出现星愿，而 typecheck 全绿、
 * 运行零报错——与 §5.11 那次标签页静默失效同一类坑，故必须机械锁死。
 *
 * 锁两面：
 *  A 补丁文本：声明行存在，且行 id / config.id / 显示字段 / 子插件行逐字对拍
 *    （config.id 与 tab-policy 的 XINGYUAN_PRESET_ID 同源，不一致则跟随判定静默失效）；
 *  B 真实宿主插件：把 A 取到的 config 交给 @deepseek-ai/dsh-agent-preset 装载，
 *    注册表须收到该定义，本行 dispose 后须收到注销（注册表不留幽灵定义）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CORE_SCHEMA, Type, load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { XINGYUAN_PRESET_ID } from '../src/tab-policy.js'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { exports: Record<string, unknown> }

/** 宿主声明行的插件名（补丁按此名装载）。 */
const PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset'

/** Loader 行 id：官方约定 `preset-<config.id>`。 */
const PRESET_ENTRY_ID = `preset-${XINGYUAN_PRESET_ID}`

/** preset 层的子插件行（本包子路径导出）。 */
const PRESET_SIDE = '@starwish-ai/xingyuan-dsh/preset/side'

/** 补丁里的一行（裸行与 insert 项同形状；`!!js` 节点保留成宿主同形状的表达式包）。 */
interface PatchRow {
  id?: string
  name?: string
  config?: Record<string, any>
  insert?: PatchRow[]
}

/**
 * 用宿主补丁的方言读 cordis.patch.yml。`!!js` 本测试不求值——
 * 它落在这里只需是「一个不透明的表达式节点」，真实求值发生在宿主 boot。
 */
const jsExprType = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data: string) => ({ __jsExpr: data }),
})

function readPatchRows(): PatchRow[] {
  const text = readFileSync(join(pkgRoot, 'cordis.patch.yml'), 'utf8')
  const ops = load(text, { schema: CORE_SCHEMA.extend([jsExprType]) }) as PatchRow[]
  expect(Array.isArray(ops), 'cordis.patch.yml 顶层应为补丁条目数组').toBe(true)
  return ops.flatMap((op) => (Array.isArray(op.insert) ? op.insert : [op]))
}

describe('bundle 补丁声明星愿 preset（0.1.7 注册机制）', () => {
  const rows = readPatchRows()
  const presetRow = rows.find((row) => row.name === PRESET_PLUGIN)

  it('A1 补丁含 @deepseek-ai/dsh-agent-preset 声明行，行 id 为 preset-<id>', () => {
    expect(presetRow, `补丁里没有 ${PRESET_PLUGIN} 声明行：星愿 preset 不会出现在选择器里`).toBeDefined()
    expect(presetRow!.id).toBe(PRESET_ENTRY_ID)
  })

  it('A2 声明行 config 的身份与显示字段齐备，身份与跟随判定同源', () => {
    const config = presetRow!.config
    expect(config!.id, 'config.id 是会话落盘的 preset 身份，必填').toBe(XINGYUAN_PRESET_ID)
    expect(config!.name, '选择器显示名').toBe('星愿')
    expect(typeof config!.description).toBe('string')
    expect((config!.description as string).length).toBeGreaterThan(0)
    expect(typeof config!.order).toBe('number')
  })

  it('A3 子插件行指向本包 preset/side 子路径（导出声明与产物一致由包装门禁另锁）', () => {
    const plugins = presetRow!.config!.plugins as { name: string }[]
    expect(Array.isArray(plugins), 'plugins 必填：注册表按它挂载会话').toBe(true)
    expect(plugins.map((row) => row.name)).toEqual([PRESET_SIDE])
    expect(pkg.exports['./preset/side'], `${PRESET_SIDE} 不是本包声明的子路径导出`).toBeDefined()
  })

  it('A4 星愿业务行只经 preset 层挂载，补丁不重复注册工具/提示词', () => {
    // 分层铁律：工具与提示词只在 preset 层。主行与 preset 声明行是两行，
    // 主行的 name 若与 preset 子插件行相同，preset 挂载会与本行组装互踩。
    const mainRow = rows.find((row) => row.name === '@starwish-ai/xingyuan-dsh')
    expect(mainRow, '补丁缺少 bundle 主行').toBeDefined()
    expect(mainRow!.id).toBe('xy-bundle')
    expect(mainRow!.id).not.toBe(PRESET_ENTRY_ID)
    expect(XINGYUAN_PRESET_ID).not.toBe(mainRow!.id)
  })
})

describe('声明行经真实宿主插件挂载（loader 级）', () => {
  let ctx: Context
  let loader: Loader
  /** 注册表收到的定义与注销记录（桩按宿主 register→disposer 契约实现）。 */
  const received: { id: string }[] = []
  const released: string[] = []

  beforeAll(async () => {
    const presetRow = readPatchRows().find((row) => row.name === PRESET_PLUGIN)
    expect(presetRow, '补丁缺少 preset 声明行').toBeDefined()
    ctx = new Context()
    ctx.baseUrl = `${pathToFileURL(pkgRoot).href}/`
    ctx.provide('agentPresets', {
      register(config: { id: string }) {
        received.push(config)
        return () => released.push(config.id)
      },
    })
    await ctx.plugin(Loader)
    loader = ctx.loader
    // Loader.create 的类型层 Omit 掉了 id（运行时按 id 定位）——转接口径同 loader.test.ts
    await loader.create({ id: presetRow!.id!, name: presetRow!.name!, config: presetRow!.config } as Parameters<Loader['create']>[0])
  })

  afterAll(async () => {
    // B2 已就地拔除时，此处重复 remove 无意义——收尾只保证不留活行，不为失败买单
    try {
      await loader.remove(PRESET_ENTRY_ID)
    } catch {}
  })

  it('B1 宿主插件把定义提交给注册表', () => {
    expect(received.map((item) => item.id)).toEqual([XINGYUAN_PRESET_ID])
  })

  it('B2 本行 dispose 即注销定义（升级/HMR 不留幽灵 preset）', async () => {
    await loader.remove(PRESET_ENTRY_ID)
    expect(released).toEqual([XINGYUAN_PRESET_ID])
  })
})
