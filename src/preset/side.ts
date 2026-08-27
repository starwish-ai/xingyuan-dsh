/**
 * 星愿 preset 侧入口：工具与提示词只注册在 preset 层，不出现在未选择星愿的会话里。
 * 本文件由 presets/xingyuan/agent.cordis.yml 以裸包名子路径装载；发布服务必须留在
 * isolate realm（本插件只向 ctx 注册贡献，不 provide 服务，天然合规）。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { XingyuanStore } from '../domain.js'
import { registerTools, type Config as ToolsConfig } from './tools.js'
import { registerPrompts } from './prompts.js'

/** Cordis 插件名。 */
export const name = 'xingyuan-preset-side'

/** 依赖：宿主组装常驻层提供的注册表与星愿领域。 */
export const inject = ['tools', 'systemPrompt', 'userQuestions', 'xingyuan']

/** 插件配置。 */
export interface Config {
  /** 记忆注入上限（条），默认 40。 */
  memoryInjectLimit: number
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
  /** 创建/取消打卡类写操作二次确认（默认开；删除类始终确认）。 */
  confirmWrites: boolean
}

/** 配置 schema（默认值写进 schema；加载期校验失败即响亮报错）。 */
export const Config: z<Config> = z.object({
  // 5-200 与设置页文案/客户端夹取范围同口径，服务端兜底防越界
  memoryInjectLimit: z.number().default(40).min(5).max(200),
  batchWishLimit: z.number().default(50),
  batchTaskLimit: z.number().default(100),
  chartTrendDays: z.number().default(14),
  chartDistributionDays: z.number().default(30),
  chartMaxDays: z.number().default(90),
  chartRankLimit: z.number().default(10),
  chartRankMax: z.number().default(20),
  confirmWrites: z.boolean().default(true),
})

/** 星愿设置命名空间（与浏览器半侧卡片配对）。 */
export const SETTINGS_NS = settingsNamespace('xingyuan')

export function apply(ctx: Context & { xingyuan: XingyuanStore }, config: Config): void {
  let source = () => config
  // 设置卡命名空间：客户端经 settingsScope 写入，onChange 热生效（HMR 安全）
  installSettingsSection(ctx, SETTINGS_NS, Config, config, {
    setSource: (current) => { source = current },
    onChange: () => { /* 动态上下文与工具回包每次执行即时读取 source()，无需重建 */ },
  })
  const current = () => source()
  // 以 getter 对象透传：设置卡热改后工具下一次 execute 即读新值（满足 ToolsConfig 形状）
  const toolsConfig: ToolsConfig = {
    get batchWishLimit() { return current().batchWishLimit },
    get batchTaskLimit() { return current().batchTaskLimit },
    get chartTrendDays() { return current().chartTrendDays },
    get chartDistributionDays() { return current().chartDistributionDays },
    get chartMaxDays() { return current().chartMaxDays },
    get chartRankLimit() { return current().chartRankLimit },
    get chartRankMax() { return current().chartRankMax },
    get confirmWrites() { return current().confirmWrites },
  }
  registerTools(ctx, toolsConfig)
  registerPrompts(ctx, { get memoryInjectLimit() { return current().memoryInjectLimit } })
}
