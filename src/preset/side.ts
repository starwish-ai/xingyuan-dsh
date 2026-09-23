/**
 * 星愿 preset 侧入口：工具与提示词只注册在 preset 层，不出现在未选择星愿的会话里。
 * 本文件由 presets/xingyuan/agent.cordis.yml 以裸包名子路径装载；发布服务必须留在
 * isolate realm（本插件只向 ctx 注册贡献，不 provide 服务，天然合规）。
 *
 * 对话偏好（写操作二次确认 / 记忆注入上限 / 确认卡语言 / 标签页显隐）不在本层提供：
 * 设置整页由 bundle client 层常驻注册，而 preset 挂载是懒加载的——重启后未开过星愿
 * 会话时本层根本不存在，整页可见而数据缺席。0.1.7 起偏好落在 bundle 主行 `xy-bundle`
 * 的 volatile Config 字段上（字段表 src/pref-settings.ts 与 src/ui-settings.ts），
 * 本层经 ctx.xingyuan.prefs() 读取当前解析值。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { XingyuanStore } from '../domain.js'
import type { PrefSettings } from '../pref-policy.js'
import { registerTools, type Config as ToolsConfig } from './tools.js'
import { registerPrompts } from './prompts.js'

/** Cordis 插件名。 */
export const name = 'xingyuan-preset-side'

/** 依赖：宿主组装常驻层提供的注册表与星愿领域。 */
export const inject = ['tools', 'systemPrompt', 'userQuestions', 'xingyuan']

/** 插件配置：仅组合层可调参数（无 Web 设置界面；用户可编辑偏好见 pref-settings.ts）。 */
export interface Config {
  /** batch_query_user_data 愿望返回上限，默认 50。 */
  batchWishLimit: number
  /** batch_query_user_data 任务返回上限，默认 100。 */
  batchTaskLimit: number
  /** 趋势类图表默认天数窗，默认 14。 */
  chartTrendDays: number
  /** 分布类图表默认天数窗，默认 30。 */
  chartDistributionDays: number
  /** 图表天数窗上限，默认 90。 */
  chartMaxDays: number
  /** 排行/进度类默认返回条数，默认 10。 */
  chartRankLimit: number
  /** 排行/进度类返回条数上限，默认 20。 */
  chartRankMax: number
}

/** 配置 schema（默认值写进 schema；加载期校验失败即响亮报错）。 */
export const Config: z<Config> = z.object({
  batchWishLimit: z.number().default(50),
  batchTaskLimit: z.number().default(100),
  chartTrendDays: z.number().default(14),
  chartDistributionDays: z.number().default(30),
  chartMaxDays: z.number().default(90),
  chartRankLimit: z.number().default(10),
  chartRankMax: z.number().default(20),
})

export function apply(ctx: Context & { xingyuan: XingyuanStore }, config: Config): void {
  // 对话偏好：bundle 主行 volatile Config 的读取 thunk，每次调用取当前解析值
  const prefs = (): PrefSettings => ctx.xingyuan.prefs()
  // 组合层参数进程内不变，直接取 entry config；对话偏好用 getter，保证热改即时生效
  const toolsConfig: ToolsConfig = {
    batchWishLimit: config.batchWishLimit,
    batchTaskLimit: config.batchTaskLimit,
    chartTrendDays: config.chartTrendDays,
    chartDistributionDays: config.chartDistributionDays,
    chartMaxDays: config.chartMaxDays,
    chartRankLimit: config.chartRankLimit,
    chartRankMax: config.chartRankMax,
    get confirmWrites() { return prefs().confirmWrites },
    get confirmOps() { return prefs().confirmOps },
    get confirmLang() { return prefs().confirmLang },
  }
  registerTools(ctx, toolsConfig)
  registerPrompts(ctx, { get memoryInjectLimit() { return prefs().memoryInjectLimit } })
}
