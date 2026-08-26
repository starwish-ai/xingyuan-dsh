/**
 * 微行动（拆解执行）：Web micro-action 三端点的本地等价实现，状态挂 domain.global 节
 * （optional 字段向后兼容，DOMAIN_VERSION 保持 1；量大再按既定策略升 v2 建表+迁移）。
 * 与 Web 的差异如实声明：步骤由模型现拆（本地无服务端再生成链路）；
 * 完成全部步骤后引导用户打卡，不自动代打。
 */
import type { MicroActionState, XingyuanStore } from './domain.js'
import { ToolError } from './store.js'

/** 步骤数约束（对齐 Web AI 拆解 3-7 步）。 */
export const MICRO_STEPS_MIN = 3
export const MICRO_STEPS_MAX = 7

/** 读取任务的微行动状态。 */
export function getMicroAction(store: XingyuanStore, taskId: string): MicroActionState | undefined {
  return store.domain.global.get().microActions?.[taskId]
}

async function writeGlobal(store: XingyuanStore, taskId: string, next: MicroActionState | undefined): Promise<void> {
  const global = store.domain.global.get()
  const rest = { ...global.microActions }
  if (next === undefined) delete rest[taskId]
  else rest[taskId] = next
  const microActions = Object.keys(rest).length > 0 ? rest : undefined
  await store.domain.global.set({ ...global, microActions })
}

/**
 * 开始或恢复微行动。已有进行中的拆解 → 原样返回（恢复语义，不覆盖步骤）；
 * 否则以传入步骤新建（步骤由模型现拆，3-7 条）。
 */
export async function startMicroAction(
  store: XingyuanStore,
  taskId: string,
  steps: ReadonlyArray<{ readonly instruction: string; readonly rationale?: string }>,
  now: string = new Date().toISOString(),
): Promise<{ state: MicroActionState; resumed: boolean }> {
  const existing = getMicroAction(store, taskId)
  if (existing !== undefined && existing.currentStepNumber !== null) {
    return { state: existing, resumed: true }
  }
  if (steps.length < MICRO_STEPS_MIN || steps.length > MICRO_STEPS_MAX) {
    throw new ToolError(`微行动需要 ${MICRO_STEPS_MIN}-${MICRO_STEPS_MAX} 个步骤，收到 ${steps.length} 个`)
  }
  const state: MicroActionState = {
    taskId,
    steps: steps.map((step, index) => ({
      stepNumber: index + 1,
      instruction: step.instruction.trim(),
      ...(step.rationale !== undefined && step.rationale.trim() !== '' ? { rationale: step.rationale.trim() } : {}),
      completed: false,
      skipped: false,
    })),
    currentStepNumber: 1,
    updatedAt: now,
  }
  await writeGlobal(store, taskId, state)
  return { state, resumed: false }
}

/**
 * 推进一步（complete/skip）：只允许处理当前步，保持引导式顺序流。
 * 全部步骤处理完毕 → currentStepNumber 归 null 并标记 finished。
 */
export async function completeMicroStep(
  store: XingyuanStore,
  taskId: string,
  stepNumber: number,
  action: 'complete' | 'skip',
  now: string = new Date().toISOString(),
): Promise<{ state: MicroActionState; finished: boolean }> {
  const existing = getMicroAction(store, taskId)
  if (existing === undefined) throw new ToolError('该任务还没有进行中的微行动，请先开始拆解')
  if (existing.currentStepNumber === null) throw new ToolError('该任务的微行动已全部完成')
  if (stepNumber !== existing.currentStepNumber) {
    throw new ToolError(`当前是第 ${existing.currentStepNumber} 步，只能处理当前步（收到第 ${stepNumber} 步）`)
  }
  const steps = existing.steps.map((step) => (
    step.stepNumber === stepNumber ? { ...step, completed: action === 'complete', skipped: action === 'skip' } : step
  ))
  const nextPending = steps.find((step) => !step.completed && !step.skipped)
  const state: MicroActionState = {
    ...existing,
    steps,
    currentStepNumber: nextPending?.stepNumber ?? null,
    updatedAt: now,
  }
  await writeGlobal(store, taskId, state)
  return { state, finished: state.currentStepNumber === null }
}

/** 重开微行动：清除现有拆解（重开前是否确认由工具层决定）。返回是否存在过。 */
export async function restartMicroAction(store: XingyuanStore, taskId: string): Promise<boolean> {
  const existed = getMicroAction(store, taskId) !== undefined
  if (existed) await writeGlobal(store, taskId, undefined)
  return existed
}
