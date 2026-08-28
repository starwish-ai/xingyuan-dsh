/**
 * 视图页跨切换的轻量状态快照（模块级 Map，非 React state）。
 *
 * 背景：conversation.view 标签页在切换时卸载重挂，组件 useState 里的交互态
 * （记忆搜索词、日历月份偏移、展开的详情行集合）随之清零——「搜到一半切去别页、
 * 回来搜索词没了」是切标签场景的真实损失。本模块按 key 存最近一次写入值，
 * 页面挂载时读回（useState 初始化器），写入即同步，无需订阅（页面重挂即重读）。
 *
 * 形态对标 tab-hint.ts 的模块级快照 store；均为 client bundle 闭包内状态，
 * HMR 重载随模块实例整体更换，无跨重载残留（AGENTS.md §8 纪律）。
 */

const store = new Map<string, unknown>()

/** 读取快照值；无写入历史时返回 fallback。 */
export function getViewState<T>(key: string, fallback: T): T {
  const value = store.get(key)
  return value === undefined ? fallback : value as T
}

/** 写入快照值（undefined 视为清除，回落 fallback 语义）。 */
export function setViewState(key: string, value: unknown): void {
  if (value === undefined) store.delete(key)
  else store.set(key, value)
}
