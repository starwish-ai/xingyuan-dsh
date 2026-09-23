/**
 * 星愿「界面偏好」的字段定义（标签页显隐：跟随会话 / 始终显示 / 始终隐藏 + 单标签勾选）。
 *
 * 与对话偏好同款形态：dsh 0.1.7 起不再有命名空间注册，可编辑项 = 主行 Config 里
 * 标了 `.volatile()` 的字段，客户端经 `ctx.configForms.get(SETTINGS_ENTRY_ID)` 读写
 * （来龙去脉见 src/pref-settings.ts 头注）。
 *
 * 为什么这些字段仍与对话偏好同挂 bundle 常驻行而不是 preset 层（设计评审结论未变）：
 * 用户处于「全部隐藏」状态想找回标签时，恰恰可能没有任何星愿会话在跑，开关必须可达。
 *
 * 本模块只被 client 半侧消费（tab-visibility 与设置页），host 侧不读这些字段——
 * 它们出现在 host Config 里只是为了让宿主把它们投影成表单。
 */
import z from '@deepseek-ai/schemastery'
import { TAB_VISIBILITY_DEFAULTS } from './tab-policy.js'

/**
 * 界面偏好字段表。schemastery 无 z.enum，枚举用 const+union 表达；
 * 默认值与 tab-policy 的 TAB_VISIBILITY_DEFAULTS 同源（测试对拍）。
 */
export const UiSettingsFields = {
  /** 显隐三态：follow 星愿会话才显示 / show 任何会话都显示 / hide 任何会话不显示。 */
  tabVisibilityMode: z.union([
    z.const('follow'),
    z.const('show'),
    z.const('hide'),
  ]).default(TAB_VISIBILITY_DEFAULTS.tabVisibilityMode).volatile(),
  /**
   * 在「显示」前提下被勾掉的单个标签（空数组 = 六个全显示；脏值容错忽略）。
   *
   * **元素类型故意放宽成 string**：本字段与存储、路由、preset 发布同挂一条主行，
   * schemastery 的 union 校验在 **Config 解析期** 就抛——`hiddenTabs: ['bogus']`
   * 会让整行装配失败（实测 `$.hiddenTabs[0] expected "today" | …`），而不是只有
   * 这一个偏好失灵。容错口径改由 `tab-policy.normalizeHiddenTabs` 在读取侧收敛，
   * 写入侧仍只由设置页产生合法 id。
   */
  hiddenTabs: z.array(z.string()).default(TAB_VISIBILITY_DEFAULTS.hiddenTabs).volatile(),
}
