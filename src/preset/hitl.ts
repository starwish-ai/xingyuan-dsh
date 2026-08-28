/**
 * HITL 确认：userQuestions 阻塞式人机确认。
 * 创建/打卡/取消打卡经「写操作二次确认」开关控制（confirmWrites，可在设置关闭）；
 * 删除（含批量）始终确认；教练风格、画像与记忆保存/更新免确认（记忆采集刻意零摩擦，
 * 删除记忆仍走「始终确认」）——与设置页文案同一口径。
 *
 * 语言口径（rc.2 平台事实）：宿主不向 host 侧插件暴露用户界面语言（client 半侧的
 * locale 服务是浏览器专属 seam，工具执行期读不到），故确认卡文案按对话偏好
 * xingyuan-pref.confirmLang 选择（设置 → 星愿 → 对话偏好，默认中文），不猜测。
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
// 类型副作用：加载 userQuestions 的 Context 声明合并
import type {} from '@deepseek-ai/dsh-user-questions'
import { normalizeConfirmLang, type ConfirmLang } from '../pref-policy.js'

/** 确认卡文案按语言成对（label 是答案协议的匹配键：ask 返回被选项的 label 原文，
 * 故确认判定必须与渲染用同一份 label）。 */
const CONFIRM_LABELS: Record<ConfirmLang, {
  readonly approve: string
  readonly cancel: string
  readonly header: string
  readonly approveDesc: string
  readonly cancelDesc: string
}> = {
  zh: {
    approve: '确认',
    cancel: '再想想',
    header: '操作确认',
    approveDesc: '执行该操作',
    cancelDesc: '取消，不做任何改动',
  },
  en: {
    approve: 'Confirm',
    cancel: 'Let me think',
    header: 'Confirm action',
    approveDesc: 'Perform this action',
    cancelDesc: 'Cancel, no changes',
  },
}

/** 读取确认卡语言：xingyuan 服务缺席（极端组合）时回落 zh。 */
export function confirmLangOf(ctx: Context): ConfirmLang {
  try {
    return normalizeConfirmLang((ctx as { xingyuan?: { prefs(): { confirmLang: unknown } } | undefined }).xingyuan?.prefs().confirmLang)
  } catch {
    return 'zh'
  }
}

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
  const labels = CONFIRM_LABELS[confirmLangOf(ctx)]
  try {
    const answer = await ctx.userQuestions.ask({
      questions: [{
        id: 'xingyuan-confirm',
        header: labels.header,
        question,
        options: [
          { label: labels.approve, description: labels.approveDesc },
          { label: labels.cancel, description: labels.cancelDesc },
        ],
      }],
      agent: exec.agent,
      signal: exec.signal,
    })
    return answer.answers[0]?.selected[0] === labels.approve
  } catch (error) {
    // 无 UI provider（NO_PROVIDER）：交互面缺席，按声明语义放行而非让写操作失败
    if ((error as { code?: string } | undefined)?.code === 'NO_PROVIDER') return true
    throw error
  }
}
