/**
 * 星愿 bundle 常驻入口：
 * 1) 激活期把包内 preset 发布到用户根（preset-root.ts）；
 * 2) 打开 xingyuan 领域并发布同名服务；
 * 3) 注册 /xingyuan/* 数据 API 与页面路由；
 * 4) 激活期对会话日志做自愈（当前格式补 ignorable、旧格式去毒，见 session-log-repair.ts）。
 * （sqlite 后端在独立行 '@starwish-ai/xingyuan-dsh/sqlite'，见 cordis.patch.yml。）
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 纯类型导入：只取 dsh-settings 对 Context.settings 的声明合并，不留运行时 import
import type {} from '@deepseek-ai/dsh-settings'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { makeXingyuanStore, xingyuanDomainSpec } from './domain.js'
import { PrefSettingsFields, readPrefSettings } from './pref-settings.js'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { registerXingyuanRoutes } from './routes/index.js'
import { ensurePresetRoot } from './preset-root.js'
import { repairSessionLogs } from './session-log-repair.js'
import { sweepOrphans } from './consistency-sweep.js'
import { UiSettingsFields } from './ui-settings.js'

export { xingyuanDomainSpec, DOMAIN_VERSION, COACH_STYLES } from './domain.js'
export type { CoachStyle, WishRecord, TaskRecord, CheckinRecord, MemoryRecord, XingyuanStore } from './domain.js'

/** Cordis 插件名。 */
export const name = 'xingyuan'

/**
 * 主行配置字段表 = 技术参数（非 volatile，改之重启本行）+ 两组成员偏好
 * （volatile，改之原地生效且被宿主投影成「设置 → 星愿」的可编辑表单）。
 * 偏好字段表在 pref-settings.ts / ui-settings.ts 各自持有，此处只做组装。
 */
const configFields = {
  /** 区间查询默认天数窗。 */
  rangeDefaultDays: z.number().default(7),
  /** 区间查询天数窗上限。 */
  rangeMaxDays: z.number().default(31),
  /** 记忆列表单页条数（分页端点缺省 limit）。 */
  memoryListLimit: z.number().default(500),
  /**
   * 激活期会话日志自愈（默认开）：迁移边接受 ignorable 的那一侧（v3 起，含当前代）
   * 补 `"ignorable": true` 标记，更旧代的星愿事件替换为官方惰性事件（详见
   * session-log-repair.ts 头注；v0→v1/v1→v2/v2→v3 三条边拒绝未知历史事件）。
   * 不含星愿事件的文件零写入。
   */
  repairSessionLogs: z.boolean().default(true),
  ...PrefSettingsFields,
  ...UiSettingsFields,
}

/** 配置 schema（默认值写进 schema；volatile 标记即「界面可改、改了不重启」）。 */
export const Config = z.object(configFields)

/**
 * 解析后的配置形状，直接从字段表推出——不另写一份 interface，
 * 免得 schema 与类型各自漂移。volatile 字段在此是 `Volatile<T>` 引用，
 * 读当前值须 `.get()`。
 */
export type Config = Schemastery.ObjectT<typeof configFields>

/** 依赖：storageDomain（领域设施）、webServer（页面路由）、sessions（活会话枚举）、
 *  sqlite 后端生命周期键（官方 storage 契约：数据形式提供方注入它，使激活不与
 *  后端注册发生竞态——不依赖 patch 的行顺序）。 */
export const inject = ['webServer', 'storageDomain', 'sessions', storageBackendServiceKey('sqlite')]

export async function apply(ctx: Context, config: Config): Promise<void> {
  let disposed = false
  let domain: Domain<typeof xingyuanDomainSpec> | undefined
  // 服务访问须在 apply 活跃期完成——异步间隙访问 ctx.* 会命中 inactive context
  const { webServer, storageDomain, sessions } = ctx
  ctx.effect(() => async () => {
    disposed = true
    if (domain) await domain.close()
  })
  // 偏好读取 thunk：每次调用现取 volatile 引用的当前值。它由领域服务持有，
  // preset 层经 ctx.xingyuan.prefs() 读取。偏好挂在常驻主行上，故不存在
  // 「整页可见而数据缺席」的时序问题（来龙去脉见 src/pref-settings.ts 头注）。
  const readPrefs = () => readPrefSettings(config)
  // 本插件自带「设置 → 星愿」整页，关掉宿主对这一行的自动生成页
  ctx.inject(['settings'], (inv) => inv.effect(() => inv.settings.configure({ auto: false }, ctx.fiber)))
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
  // 路由注册经 ctx.effect 挂载：register 返回的 disposer 在卸载/HMR 时注销 /xingyuan
  // 前缀——否则重激活会因重复 (kind,path) 抛错，旧 handler 还会服务已关闭的领域
  ctx.effect(() => registerXingyuanRoutes(webServer, ctx.xingyuan, config))
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
        const parts: string[] = []
        if (report.eventsMarked > 0) parts.push(`补标 ${report.eventsMarked} 条卡片事件`)
        if (report.neutralized > 0) parts.push(`旧格式会话迁移前替换 ${report.neutralized} 条卡片事件（历史卡片不再回放）`)
        console.log(`[xingyuan] 会话日志自愈：${parts.join('，')}（${report.patched} 个会话，扫描 ${report.scanned}）`)
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
