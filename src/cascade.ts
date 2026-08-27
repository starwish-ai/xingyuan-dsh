/**
 * 删除级联收口：任务/愿望的彻底删除——打卡记录与微行动状态一并清理。
 * 工具面与页面动作面的全部删除入口共用本模块，任何一条路径都不留孤儿数据
 * （微行动状态挂在 domain.global 槽，不随任务表删除自动消失）。
 * 层位：opportunity（纯函数）← store（领域操作）← cascade（组合删除）← tools/routes。
 */
import type { TaskRecord, XingyuanStore } from './domain.js'
import { restartMicroAction } from './micro.js'
import { syncWishProgress } from './store.js'

/** 删除任务的全部打卡记录。 */
export async function removeAllCheckins(store: XingyuanStore, taskId: string): Promise<void> {
  const keys: string[] = []
  for (const [key, record] of store.domain.table('checkins').entries()) {
    if (record.taskId === taskId) keys.push(key)
  }
  for (const key of keys) await store.domain.table('checkins').delete(key)
}

/** 销毁任务本体及其打卡/微行动痕迹（不联动愿望进度——由调用方按语义决定是否回写）。 */
async function destroyTask(store: XingyuanStore, taskId: string): Promise<TaskRecord | undefined> {
  const task = store.domain.table('tasks').get(taskId)
  if (task === undefined) return undefined
  await removeAllCheckins(store, taskId)
  // 微行动状态复用 restart 的清除语义（存在才清，幂等）
  await restartMicroAction(store, taskId)
  await store.domain.table('tasks').delete(taskId)
  return task
}

/**
 * 彻底删除单个任务并回写所属愿望的库存进度（应打/已打随之减少）。
 * 返回被删任务快照（供事件补发）；任务不存在时返回 undefined。
 */
export async function removeTaskCompletely(store: XingyuanStore, taskId: string): Promise<TaskRecord | undefined> {
  const task = await destroyTask(store, taskId)
  // 愿望可能已被并发删除：仅在存续时回写进度（不吞存储层异常）
  if (task !== undefined && task.wishId !== undefined && store.domain.table('wishes').get(task.wishId) !== undefined) {
    await syncWishProgress(store, task.wishId)
  }
  return task
}

/**
 * 彻底删除愿望及其下属全部任务（含各自打卡与微行动状态）。
 * 愿望本体同删，无需进度回写；返回被级联的任务快照。
 */
export async function removeWishCompletely(store: XingyuanStore, wishId: string): Promise<TaskRecord[]> {
  const removed: TaskRecord[] = []
  for (const [, task] of store.domain.table('tasks').entries()) {
    if (task.wishId !== wishId) continue
    const destroyed = await destroyTask(store, task.taskId)
    if (destroyed !== undefined) removed.push(destroyed)
  }
  await store.domain.table('wishes').delete(wishId)
  return removed
}
