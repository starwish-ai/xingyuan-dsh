/**
 * 星愿 bundle 常驻入口：
 * 1) 激活期把包内 preset 发布到用户根（preset-root.ts）；
 * 2) 打开 xingyuan 领域并发布同名服务；
 * 3) 注册 /xingyuan/* 数据 API 与页面路由；
 * 4) 激活期对会话日志做 ignorable 补标自愈（session-log-repair.ts）。
 * （sqlite 后端在独立行 '@starwish-ai/xingyuan-dsh/sqlite'，见 cordis.patch.yml。）
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { makeXingyuanStore, xingyuanDomainSpec } from './domain.js'
import { installPrefSettings } from './pref-settings.js'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { registerXingyuanRoutes } from './routes/index.js'
import { ensurePresetRoot } from './preset-root.js'
import { repairSessionLogs } from './session-log-repair.js'
import { sweepOrphans } from './consistency-sweep.js'
import { installUiSettings } from './ui-settings.js'

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
  /**
   * 激活期会话日志自愈（默认开）：为历史日志里的 xingyuan/* 卡片事件补
   * `"ignorable": true` 标记，修掉「重启后旧会话冷加载被整体拒绝」。
   * 不含星愿事件的文件零写入；详见 session-log-repair.ts 头注。
   */
  repairSessionLogs: boolean
}

/** 配置 schema（默认值写进 schema）。 */
export const Config: z<Config> = z.object({
  rangeDefaultDays: z.number().default(7),
  rangeMaxDays: z.number().default(31),
  memoryListLimit: z.number().default(500),
  repairSessionLogs: z.boolean().default(true),
})

/** 依赖：storageDomain（领域设施）、webServer（页面路由）、sessions（活会话枚举）。 */
export const inject = ['webServer', 'storageDomain', 'sessions']

export async function apply(ctx: Context, config: Config): Promise<void> {
  let disposed = false
  let domain: Domain<typeof xingyuanDomainSpec> | undefined
  // 服务访问须在 apply 活跃期完成——异步间隙访问 ctx.* 会命中 inactive context
  const { webServer, storageDomain, sessions } = ctx
  ctx.effect(() => async () => {
    disposed = true
    if (domain) await domain.close()
  })
  // 界面偏好命名空间（标签页显隐）常驻注册：不依赖 settings 服务存在，服务挂载后自动生效
  installUiSettings(ctx)
  // 对话偏好命名空间（二次确认 + 记忆注入上限）常驻注册：与界面偏好同款时序。
  // 返回的读取 thunk 由领域服务持有，preset 层经 ctx.xingyuan.prefs() 读取——
  // 命名空间必须常驻，否则整页可见而数据随 preset 懒加载缺席，写入静默失败。
  const readPrefs = installPrefSettings(ctx)
  // preset 发布成功后再开领域；两步就绪后才 provide，注入方（preset 子树）由
  // cordis inject 语义等待本行激活完成
  await ensurePresetRoot()
  const opened = await storageDomain.open(xingyuanDomainSpec)
  if (disposed) {
    void opened.close()
    return
  }
  domain = opened
  ctx.provide('xingyuan', makeXingyuanStore(opened, readPrefs))
  registerXingyuanRoutes(webServer, ctx.xingyuan, config)
  // 启动一致性清扫（契约内无事务的级联删除补偿控制）：fire-and-forget 不阻塞激活，
  // 异常只告警——清扫是收敛性补救，失败留给下次启动重试
  void sweepOrphans(ctx.xingyuan)
    .then((report) => {
      if (report.orphanCheckins + report.orphanTasks + report.orphanMicroEntries > 0) {
        console.log(`[xingyuan] 一致性清扫：清除孤儿打卡 ${report.orphanCheckins} 条、孤儿任务 ${report.orphanTasks} 个、悬挂微行动 ${report.orphanMicroEntries} 项`)
      }
    })
    .catch((error) => {
      console.warn('[xingyuan] 一致性清扫异常（已忽略，下次启动重试）：', error)
    })
  if (config.repairSessionLogs) {
    try {
      const report = await repairSessionLogs({ listLiveSessionIds: () => liveSessionIds(sessions) })
      if (report.patched > 0) {
        console.log(`[xingyuan] 会话日志自愈：补标 ${report.eventsMarked} 条卡片事件（${report.patched} 个会话，扫描 ${report.scanned}）`)
      }
      for (const warning of report.warnings) console.warn(`[xingyuan] 会话日志自愈跳过：${warning}`)
    } catch (error) {
      // 自愈是尽力而为的补救，任何异常不得阻断插件激活
      console.warn('[xingyuan] 会话日志自愈异常（已忽略）：', error)
    }
  }
}

// ===== 会话日志自愈的宿主接线 =====

/** 宿主 sessions 服务的最小结构面（避免对内部类型定义的耦合）。 */
interface MinimalSessionsService {
  list?: () => readonly unknown[]
}

/** 结构化读取活会话 id；服务缺席或形状不符时返回空集（自愈退化为全量尝试）。 */
function liveSessionIds(service: unknown): ReadonlySet<string> {
  try {
    const list = (service as MinimalSessionsService | undefined)?.list?.() ?? []
    const ids = new Set<string>()
    for (const session of list) {
      const record = session as { header?: { id?: unknown }; id?: unknown } | null
      const id = record?.header?.id ?? record?.id
      if (typeof id === 'string' && id !== '') ids.add(id)
    }
    return ids
  } catch {
    return new Set<string>()
  }
}
