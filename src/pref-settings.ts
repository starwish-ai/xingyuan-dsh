/**
 * 星愿「对话偏好」的字段定义与读取映射（confirmWrites / confirmOps /
 * memoryInjectLimit / confirmLang），host/client 两半侧共用同一份字段表。
 *
 * dsh 0.1.7 起设置模型整体换了：**不再有「插件向宿主注册命名空间」这回事**
 * （`settings.installSection` 与 client 侧 `settingsScope` 均已撤除）。可编辑项
 * 就是 profile 行 Config schema 里标了 `.volatile()` 的字段——宿主 `settings.describe()`
 * 按行 id 把它们投影成表单，客户端经 `ctx.configForms.get(行 id)` 读写。
 * 故本模块只提供字段表与「配置引用 → 偏好快照」的映射，不再安装任何东西；
 * 字段表由 src/index.ts 并入主行 Config（行 id 见 pref-policy 的 SETTINGS_ENTRY_ID）。
 *
 * 偏好为什么落在 bundle 常驻行而不是 preset 层（结论未变、理由换了形态）：
 * 设置整页由 client 半侧无条件注册、常驻可见，而 preset 挂载是懒加载的——
 * 重启后、开过星愿会话之前那一层并不存在。0.1.7 的表单按 profile 行索引，
 * 挂在主行 Config 上天然常驻，与常驻 UI 对齐（旧版靠「命名空间注册在 bundle 层」
 * 达成同一目的）。
 *
 * volatile 的另一半收益：改这些字段不再触发整行重启（宿主走
 * `loader/volatile-update` 原地换引用），工具与提示词每次执行现读即得新值。
 */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  CONFIRM_LANGS,
  CONFIRM_OP_DEFAULTS,
  MEMORY_LIMIT_MAX,
  MEMORY_LIMIT_MIN,
  PREF_DEFAULTS,
  type ConfirmLang,
  type ConfirmOp,
  type PrefSettings,
} from './pref-policy.js'

/** 可配确认类目的字段字典（键与 pref-policy 的 CONFIRM_OPS 一一对应，测试对拍）。 */
const confirmOpsDict = {
  create: z.boolean().default(CONFIRM_OP_DEFAULTS.create),
  checkin: z.boolean().default(CONFIRM_OP_DEFAULTS.checkin),
  cancelCheckin: z.boolean().default(CONFIRM_OP_DEFAULTS.cancelCheckin),
  claim: z.boolean().default(CONFIRM_OP_DEFAULTS.claim),
  update: z.boolean().default(CONFIRM_OP_DEFAULTS.update),
  memorySave: z.boolean().default(CONFIRM_OP_DEFAULTS.memorySave),
}

/**
 * 对话偏好字段表（全部 volatile：用户改完即生效，不重启承载它们的 bundle 行）。
 * step(1) 让服务端也拒绝小数，防手改文档 / RPC 直写绕过界面。
 */
export const PrefSettingsFields = {
  /** 写操作总开关：关闭时除锁定的删除类目外一律不弹确认卡。 */
  confirmWrites: z.boolean().default(PREF_DEFAULTS.confirmWrites).volatile(),
  /** 确认类目明细：整体作为一个字段下发（客户端每次写合并后的完整对象）。 */
  confirmOps: z.object(confirmOpsDict).default({ ...CONFIRM_OP_DEFAULTS }).volatile(),
  /** 每次对话自动注入上下文的记忆条数上限。 */
  memoryInjectLimit: z.number().step(1).min(MEMORY_LIMIT_MIN).max(MEMORY_LIMIT_MAX)
    .default(PREF_DEFAULTS.memoryInjectLimit).volatile(),
  /** 对话内确认卡语言（平台不向 host 侧暴露界面语言，见 pref-policy 头注）。 */
  confirmLang: z.union(CONFIRM_LANGS.map((lang) => z.const(lang))).default(PREF_DEFAULTS.confirmLang).volatile(),
}

/** 对话偏好字段的读取面（src/index.ts 的 Config 结构上满足它）。 */
export interface PrefConfig {
  readonly confirmWrites: Volatile<boolean>
  readonly confirmOps: Volatile<Record<ConfirmOp, boolean>>
  readonly memoryInjectLimit: Volatile<number>
  readonly confirmLang: Volatile<ConfirmLang>
}

/**
 * 读当前偏好快照：每次调用现取各引用的当前值。
 *
 * 引用本身由宿主原地更新，所以这里不缓存任何结果——工具与提示词的每次执行都
 * 经此读一遍，设置热改后下一次执行即生效。
 */
export function readPrefSettings(config: PrefConfig): PrefSettings {
  return {
    confirmWrites: config.confirmWrites.get(),
    confirmOps: config.confirmOps.get(),
    memoryInjectLimit: config.memoryInjectLimit.get(),
    confirmLang: config.confirmLang.get(),
  }
}
