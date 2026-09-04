/**
 * 星愿 bundle 层「界面偏好」设置命名空间（xingyuan-ui）：
 * 会话视图标签页显隐（跟随会话/始终显示/始终隐藏 + 单标签勾选）。
 *
 * 挂在 bundle 常驻层而非 preset 层的理由（设计评审结论）：
 * preset 层命名空间（xingyuan）随星愿会话挂载/卸载而存在/消失——用户处于
 * 「全部隐藏」状态想找回标签时，恰恰可能没有任何星愿会话在跑，开关不可达。
 * bundle 层命名空间常驻：未选过星愿预设也能调整，且与 dsh host-backed
 * settings 惯例一致（跟随 $DSH_HOME/settings.yaml 跨 Web 端口）。
 *
 * dsh 0.1.2-rc.1 起命名空间安装收进服务面 ctx.settings.installSection；
 * 本模块经 ctx.inject(['settings']) 等待 settings 服务挂载，
 * 服务缺席（headless 等）时整段不运行，bundle 激活不依赖它。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 纯类型导入：只取 dsh-settings 对 Context.settings 的声明合并，不留运行时 import
import type {} from '@deepseek-ai/dsh-settings'
import { TAB_IDS, TAB_VISIBILITY_DEFAULTS, type TabId, type TabVisibilityMode } from './tab-policy.js'

/** 界面偏好命名空间（client 半侧 settingsScope 同名配对，勿改；小写连字符文法由新 API 类型校验）。 */
export const UI_NS = 'xingyuan-ui'

/** 命名空间解析值（schema 默认 → base 层 → 用户层）。 */
export interface UiSettings {
  tabVisibilityMode: TabVisibilityMode
  hiddenTabs: TabId[]
}

/** 配置 schema（默认值写进 schema；schemastery 无 z.enum，枚举用 const+union）。 */
export const UiSettingsSchema: z<UiSettings> = z.object({
  tabVisibilityMode: z.union([
    z.const('follow'),
    z.const('show'),
    z.const('hide'),
  ]).default(TAB_VISIBILITY_DEFAULTS.tabVisibilityMode),
  hiddenTabs: z.array(z.union(TAB_IDS.map((id) => z.const(id)))).default([]),
})

/** bundle 层安装界面偏好命名空间（幂等：注册随插件 fiber 生命周期自动清理）。 */
export function installUiSettings(ctx: Context): void {
  ctx.inject(['settings'], (inv) => {
    inv.settings.installSection(ctx, UI_NS, UiSettingsSchema, TAB_VISIBILITY_DEFAULTS as UiSettings, {
      // 本命名空间只有 client 半侧消费（经 wire 读快照），host 侧无派生事实
      setSource: () => {},
      onChange: () => {},
    })
  })
}