/**
 * HITL 确认：userQuestions 阻塞式人机确认。
 * 创建/打卡/取消打卡经「写操作二次确认」开关控制（confirmWrites，可在设置关闭）；
 * 删除（含批量）始终确认；教练风格与画像修改免确认——与设置页文案同一口径。
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
// 类型副作用：加载 userQuestions 的 Context 声明合并
import type {} from '@deepseek-ai/dsh-user-questions'

export const APPROVE_LABEL = '确认'
export const CANCEL_LABEL = '再想想'

/**
 * 弹出确认并等待用户选择。返回 true = 用户确认。
 * - 无 live agent（headless 单发任务）时不阻塞、直接放行——headless 语义是「一次指令跑完」；
 * - 有 agent 但环境未注册 UI provider（如 headless 组合）：同样自动放行。
 *   该语义与 README Known Limitations 声明一致：确认卡是 Web GUI 交互面；
 *   无界面的单发场景里任务文本本身即用户指令，视为已授权。
 *
 * 契约注意（dsh-user-questions ask() 校验）：plan-review 意图要求 detail 为被审阅
 * 的计划文本——星愿这里是动作确认（打卡/删除），不是计划审批，因此不挂意图标签，
 * 走通用选项列表渲染（answer 协议与专用渲染完全一致）。
 */
export async function confirmAction(
  ctx: Context,
  exec: Pick<ToolRunContext, 'agent' | 'signal'>,
  question: string,
): Promise<boolean> {
  if (!exec.agent) return true
  try {
    const answer = await ctx.userQuestions.ask({
      questions: [{
        id: 'xingyuan-confirm',
        header: '操作确认',
        question,
        options: [
          { label: APPROVE_LABEL, description: '执行该操作' },
          { label: CANCEL_LABEL, description: '取消，不做任何改动' },
        ],
      }],
      agent: exec.agent,
      signal: exec.signal,
    })
    return answer.answers[0]?.selected[0] === APPROVE_LABEL
  } catch (error) {
    // 无 UI provider（NO_PROVIDER）：交互面缺席，按声明语义放行而非让写操作失败
    if ((error as { code?: string } | undefined)?.code === 'NO_PROVIDER') return true
    throw error
  }
}
