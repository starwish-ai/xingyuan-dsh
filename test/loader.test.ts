/**
 * Loader 级真实组合测试（§4.3：手动 ctx.plugin() 不算）。
 * 经 cordis-plugin-loader 以 cordis.yml 语义启动最小完整组合：
 * storage hub → 星愿 sqlite 后端 → 领域路由（xingyuan→sqlite）→
 * system-prompt / user-questions / tools → bundle 主行（领域服务+/xingyuan/* 路由）→ preset 侧工具行。
 * 断言：模型可见工具面注册、领域落库回读、逐行 dispose 清理（工具注销/服务注销/后端注销）。
 * 运行前置：pnpm build（preset 侧经 ./lib/preset/side.js 相对路径装载，与发布形态一致）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
// 类型副作用：组合内各服务的 Context 声明合并
import type {} from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-tools'
import type { XingyuanStore } from '../src/domain.js'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 组合内由本测试创建的行（收尾倒序拆除）。 */
const ENTRIES = ['xingyuan-side', 'xingyuan', 'tools', 'user-questions', 'system-prompt', 'storage-domain', 'xingyuan-sqlite', 'storage'] as const

describe('loader 级组合启动', () => {
  let ctx: Context
  let loader: Loader

  /** 装配一行（运行时接受 id 定位；类型层 Omit 掉了它——单一转接点注明）。 */
  async function mount(entry: { id: string; name: string; config?: unknown }): Promise<void> {
    await loader.create(entry as Parameters<Loader['create']>[0])
  }

  /** 模型可见工具名集合（registry 公开面 schemas()）。 */
  function visibleTools(): string[] {
    return ctx.tools.schemas().map((schema) => schema.name)
  }

  /**
   * 轮询等待服务出现。激活链（preset 发布 → 开领域 → provide）在 apply 返回后的
   * 微/宏任务中完成，registry 无公开的就绪事件可 await——只能观测其公开读取面。
   */
  async function untilDefined<T>(get: () => T | undefined, what: string): Promise<T> {
    for (let i = 0; i < 500; i++) {
      const value = get()
      if (value !== undefined) return value
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`等待超时：${what}`)
  }

  beforeAll(async () => {
    // 隔离：preset 发布指向临时 DSH_HOME，不触碰真实用户目录
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'xy-loader-'))
    ctx = new Context()
    // 宿主 boot 同款：baseUrl 挂 ctx 供裸包名解析；Loader 以插件行装载
    ctx.baseUrl = `${pathToFileURL(pkgRoot).href}/`
    // webServer 桩：bundle 主行 inject webServer；组合测试不启真实 HTTP 服务
    ctx.provide('webServer', { register() {} })
    await ctx.plugin(Loader)
    loader = ctx.loader
    await mount({ id: 'storage', name: '@deepseek-ai/dsh-storage' })
    // 本包三行用相对路径：裸包名会从 loader 包自身位置解析（宿主经安装闭包解析，
    // 测试组合无闭包）；相对路径按 ctx.baseUrl 解析，装载同一份构建产物。
    await mount({ id: 'xingyuan-sqlite', name: './lib/sqlite.js', config: { path: ':memory:' } })
    await mount({ id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'sqlite', routes: { xingyuan: 'sqlite' } } })
    await mount({ id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' })
    await mount({ id: 'user-questions', name: '@deepseek-ai/dsh-user-questions' })
    await mount({ id: 'tools', name: '@deepseek-ai/dsh-tools' })
    await mount({ id: 'xingyuan', name: './lib/index.js' })
    await mount({ id: 'xingyuan-side', name: './lib/preset/side.js' })
  })

  afterAll(async () => {
    for (const id of ENTRIES) {
      try {
        await loader.remove(id)
      } catch {}
    }
  })

  it('bundle 主行打开领域并发布服务，落库可回读', async () => {
    const store = await untilDefined(() => ctx.xingyuan, 'xingyuan 服务')
    await store.domain.table('wishes').put('w-loader', {
      wishId: 'w-loader',
      title: '组合测试愿望',
      categoryName: '学习',
      progress: 0,
      totalRequiredDays: 0,
      totalCompletedDays: 0,
      archived: false,
      createdAt: '2026-08-24T00:00:00',
    })
    expect(store.domain.table('wishes').get('w-loader')?.title).toBe('组合测试愿望')
  })

  it('preset 侧经 Loader 注册星愿工具面（模型可见 schemas）', () => {
    const names = visibleTools()
    for (const name of ['create_wish', 'create_task', 'check_in_task', 'search_wishes', 'get_wish_detail', 'generate_chart']) {
      expect(names).toContain(name)
    }
  })

  it('逐行 dispose：工具注销、领域服务注销、sqlite 后端注销', async () => {
    await loader.remove('xingyuan-side')
    const names = visibleTools()
    expect(names).not.toContain('create_wish')
    expect(names).not.toContain('check_in_task')

    await loader.remove('xingyuan')
    expect(ctx.xingyuan).toBeUndefined()

    await loader.remove('xingyuan-sqlite')
    expect(() => ctx.storage.backend.get('sqlite')).toThrow()
  })
})
