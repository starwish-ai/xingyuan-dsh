/**
 * 「今日」页非星愿会话提示行的快照 store。
 *
 * 语义：仅「始终显示」模式 × 当前会话非星愿预设时为 true（该模式下标签页
 * 出现在每个会话里，页面数据与操作可用，但对话中的星愿能力不可用——一行
 * 轻提示点明落差）。跟随会话模式下非星愿会话标签页整体隐藏，无提示可言。
 *
 * 独立成模块：tab-visibility 控制器写入、今日页订阅，避免控制器 ↔ 页面
 * 双向依赖环；写侧只在值变化时通知，订阅侧 useSyncExternalStore 直接消费。
 */

let hintVisible = false
const listeners = new Set<() => void>()

function publish(value: boolean): void {
  if (value === hintVisible) return
  hintVisible = value
  for (const fn of [...listeners]) fn()
}

/** 今日页只读入口（getSnapshot/subscribe 满足 useSyncExternalStore 契约）。 */
export const todayHintStore = {
  getSnapshot: (): boolean => hintVisible,
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

/** 控制器在每次显隐重算后写入；值未变化时零通知。 */
export function setTodayHint(value: boolean): void {
  publish(value)
}

/** 控制器卸载时清场（值复位 + 断订；今日页随模块重载自动取新模块实例）。 */
export function clearTodayHint(): void {
  listeners.clear()
  hintVisible = false
}