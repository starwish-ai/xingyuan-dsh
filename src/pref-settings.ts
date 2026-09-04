/**
 * 星愿 bundle 层「对话偏好」设置命名空间（xingyuan-pref）：
 * 写操作二次确认（confirmWrites）与记忆注入上限（memoryInjectLimit）。
 *
 * 挂在 bundle 常驻层而非 preset 层的理由（本次根因，实测结论）：
 * 设置整页（settings.section）由 bundle client 层无条件注册、常驻可见；而 preset
 * 挂载是**按 preset 常驻但懒加载**的（官方 agent-presets：per-preset standing
 * mount，进程内只挂一次、只随整棵树卸载），首次开星愿会话才建立。于是每次 dsh
 * 重启后、开过星愿会话之前，整页可见而命名空间不存在：两项均 unavailable，
 * 写入静默失败（client scope.set() 失败是 resolve 而非 reject），表现为
 * 「点了弹回原样、没有任何提示」。
 *
 * 官方 cookbook 的 settings.plugin.item 卡片按「Host 是否服务该命名空间」自动显隐，
 * 整页 section 没有这层保护——slots.d.ts 契约把失败呈现的责任明确交给注册方。
 * 故此处让数据常驻以对齐常驻 UI，而非让 UI 跟随数据（那会让设置页出现
 * 部分字段时有时无的割裂，且安全策略类设置「有时候找不到」不可接受）。
 *
 * dsh 0.1.2-rc.1 起 settings 子系统重排：命名空间安装收进服务面
 * `settings.installSection(owner, ns, schema, entry, hooks)`（独立函数
 * installSettingsSection/settingsNamespace 已删除）。本模块经 ctx.inject(['settings'],
 * (inv) => …) 等待 settings 服务挂载后在回调形参 inv 上访问（cordis 4.0.2 服务属性守卫：
 * 未声明依赖的 fiber 上读 ctx.settings 会抛），服务缺席（headless 等）时整段不运行，
 * bundle 激活不依赖它。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 纯类型导入：只取 dsh-settings 对 Context.settings 的声明合并，不留运行时 import
import type {} from '@deepseek-ai/dsh-settings'
import {
  CONFIRM_LANGS,
  MEMORY_LIMIT_MAX,
  MEMORY_LIMIT_MIN,
  PREF_DEFAULTS,
  type PrefSettings,
} from './pref-policy.js'

/** 对话偏好命名空间（client 半侧 settingsScope 同名配对，勿改；小写连字符文法由新 API 类型校验）。 */
export const PREF_NS = 'xingyuan-pref'

/** 配置 schema（默认值写进 schema；step(1) 让服务端也拒绝小数，防手改文档/RPC 直写）。 */
export const PrefSettingsSchema: z<PrefSettings> = z.object({
  confirmWrites: z.boolean().default(PREF_DEFAULTS.confirmWrites),
  memoryInjectLimit: z.number().step(1).min(MEMORY_LIMIT_MIN).max(MEMORY_LIMIT_MAX)
    .default(PREF_DEFAULTS.memoryInjectLimit),
  // schemastery 无 z.enum，两值枚举用 const+union 表达（与 ui-settings 的显隐三态同款）
  confirmLang: z.union(CONFIRM_LANGS.map((lang) => z.const(lang))).default(PREF_DEFAULTS.confirmLang),
})

/**
 * bundle 层安装对话偏好命名空间，并返回偏好读取 thunk。
 *
 * thunk 每次调用都读「当前解析值」（schema 默认 → base → 用户层），故设置热改后
 * 下一次读取即生效，无需重建任何注册；settings 服务缺席时返回 PREF_DEFAULTS。
 */
export function installPrefSettings(ctx: Context): () => PrefSettings {
  // 闭包局部，非模块级单例（AGENTS.md §8：不做任何跨重载的模块级单例状态）
  let read = (): PrefSettings => PREF_DEFAULTS
  // 回调形参 inv 才是声明了 settings 依赖的上下文：cordis 4.0.2 起，
  // 未在当前 fiber 声明的服务属性不得访问（外层 ctx 直接读 ctx.settings 会
  // 抛 "cannot get property without inject"），注册归属（owner）仍传插件 fiber。
  ctx.inject(['settings'], (inv) => {
    inv.settings.installSection(ctx, PREF_NS, PrefSettingsSchema, PREF_DEFAULTS, {
      setSource: (current) => { read = current },
      // 消费方（工具/提示词）每次执行即时读 thunk，无需在此重建任何东西
      onChange: () => {},
    })
  })
  return () => read()
}
