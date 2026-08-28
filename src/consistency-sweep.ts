/**
 * 启动一致性清扫（bundle 常驻层）。
 *
 * 背景：sqlite 后端为契约内的单键写（dsh-storage StorageBackend 仅有
 * putRecord/deleteRecord/setGlobal，无批量/事务原语），删除级联（cascade.ts）
 * 由多条独立写组成，进程在级联中途崩溃会留下孤儿记录。本模块在激活期做一次
 * 幂等的补偿性清扫（Git gc / Kafka recovery 同款收敛思路）：
 * - 打卡记录指向不存在的任务 → 删除打卡；
 * - 任务指向不存在的愿望 → 经级联收口 removeTaskCompletely 删除（含其打卡与微行动）；
 * - global 微行动状态指向不存在的任务 → 移除该键（mutator 执行时**新鲜重读**任务集，
 *   清扫运行期间新建任务的微行动键不会被陈旧快照误删）。
 * 分类颜色覆盖不参与清扫：按设计允许存在零愿望的纯覆盖分类（见 store.renameCategory）。
 *
 * 性能：全表扫描量级为个人数据（千行内），激活期 fire-and-forget 执行不阻塞
 * provide；异常由调用方折算为警告日志，绝不阻断插件激活。
 */
import type { XingyuanStore } from './domain.js'
import { mutateGlobal } from './store.js'
import { removeTaskCompletely } from './cascade.js'

export interface SweepReport {
  /** 清除的孤儿打卡记录数（taskId 无对应任务）。 */
  orphanCheckins: number
  /** 清除的孤儿任务数（wishId 无对应愿望）。 */
  orphanTasks: number
  /** 移除的悬挂微行动状态键数。 */
  orphanMicroEntries: number
}

export async function sweepOrphans(store: XingyuanStore): Promise<SweepReport> {
  const report: SweepReport = { orphanCheckins: 0, orphanTasks: 0, orphanMicroEntries: 0 }
  const tasks = store.domain.table('tasks')
  const checkins = store.domain.table('checkins')
  const wishIds = new Set([...store.domain.table('wishes').entries()].map(([id]) => id))
  // 先收集后删：不依赖表迭代中删除的语义
  const orphanTaskIds: string[] = []
  const liveTaskIds = new Set<string>()
  for (const [id, task] of tasks.entries()) {
    liveTaskIds.add(id)
    if (task.wishId !== undefined && !wishIds.has(task.wishId)) orphanTaskIds.push(id)
  }
  const orphanCheckinKeys: string[] = []
  for (const [key, record] of checkins.entries()) {
    if (!liveTaskIds.has(record.taskId)) orphanCheckinKeys.push(key)
  }
  for (const key of orphanCheckinKeys) {
    if (await checkins.delete(key)) report.orphanCheckins += 1
  }
  // 孤儿任务走级联唯一收口（打卡 + 微行动 + 本体一并清）；愿望已不存在，
  // removeTaskCompletely 内部的进度回写按其自身守卫自然跳过
  for (const taskId of orphanTaskIds) {
    if (await removeTaskCompletely(store, taskId) !== undefined) report.orphanTasks += 1
  }
  // 微行动悬挂键：任务集在 mutator 执行时新鲜重读（串行队列保证与并发写互斥）
  await mutateGlobal(store, (global) => {
    const microActions = global.microActions
    if (microActions === undefined) return global
    const freshTaskIds = new Set([...store.domain.table('tasks').entries()].map(([id]) => id))
    const dangling = Object.keys(microActions).filter((taskId) => !freshTaskIds.has(taskId))
    if (dangling.length === 0) return global
    const rest = { ...microActions }
    for (const taskId of dangling) delete rest[taskId]
    report.orphanMicroEntries += dangling.length
    return { ...global, microActions: Object.keys(rest).length > 0 ? rest : undefined }
  })
  return report
}
