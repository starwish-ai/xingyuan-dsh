/**
 * 星愿 bundle 常驻入口：
 * 1) 激活期把包内 preset 发布到用户根（preset-root.ts）；
 * 2) 打开 xingyuan 领域并发布同名服务；
 * 3) 注册 /xingyuan/* 数据 API 与页面路由。
 * （sqlite 后端在独立行 '@starwish-ai/dsh/sqlite'，见 cordis.patch.yml。）
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { makeXingyuanStore, xingyuanDomainSpec } from './domain.js'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { registerXingyuanRoutes } from './routes/index.js'
import { ensurePresetRoot } from './preset-root.js'

export { xingyuanDomainSpec, DOMAIN_VERSION, COACH_STYLES } from './domain.js'
export type { CoachStyle, WishRecord, TaskRecord, CheckinRecord, MemoryRecord, XingyuanStore } from './domain.js'

/** Cordis 插件名。 */
export const name = 'xingyuan'

/** 插件配置。 */
export interface Config {
  /** 区间查询默认天数窗。 */
  rangeDefaultDays: number
  /** 区间查询天数窗上限。 */
  rangeMaxDays: number
  /** 记忆列表单页条数（分页端点缺省 limit）。 */
  memoryListLimit: number
}

/** 配置 schema（默认值写进 schema）。 */
export const Config: z<Config> = z.object({
  rangeDefaultDays: z.number().default(7),
  rangeMaxDays: z.number().default(31),
  memoryListLimit: z.number().default(500),
})

/** 依赖：storageDomain（领域设施）、webServer（页面路由）。 */
export const inject = ['webServer', 'storageDomain']

export async function apply(ctx: Context, config: Config): Promise<void> {
  let disposed = false
  let domain: Domain<typeof xingyuanDomainSpec> | undefined
  // 服务访问须在 apply 活跃期完成——异步间隙访问 ctx.* 会命中 inactive context
  const { webServer, storageDomain } = ctx
  ctx.effect(() => async () => {
    disposed = true
    if (domain) await domain.close()
  })
  // preset 发布成功后再开领域；两步就绪后才 provide，注入方（preset 子树）由
  // cordis inject 语义等待本行激活完成
  await ensurePresetRoot()
  const opened = await storageDomain.open(xingyuanDomainSpec)
  if (disposed) {
    void opened.close()
    return
  }
  domain = opened
  ctx.provide('xingyuan', makeXingyuanStore(opened))
  registerXingyuanRoutes(webServer, ctx.xingyuan, config)
}
