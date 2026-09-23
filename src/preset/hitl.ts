/**
 * HITL 确认：userQuestions 阻塞式人机确认。
 * 分层模型（AGENTS.md §10 决策 8）：总开关 confirmWrites 关→
 * 除删除外一律不弹；开→按类目明细 confirmOps 决定（创建/打卡/取消默认确认，
 * 领取/修改/记忆保存默认免确认，可在设置开启）。删除（含批量）始终确认；
 * 教练风格、画像与微行动步进不设门闩——与设置页文案同一口径。
 *
 * 语言口径（0.1.7 复核仍成立的平台事实）：宿主不向 host 侧插件暴露用户界面语言（client 半侧的
 * locale 服务是浏览器专属 seam，工具执行期读不到），故确认卡文案按对话偏好
 * confirmLang（bundle 主行的 volatile 字段，设置 → 星愿 → 对话偏好，默认中文）选择，不猜测。
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
// 类型副作用：加载 userQuestions 的 Context 声明合并
import type {} from '@deepseek-ai/dsh-user-questions'
import { normalizeConfirmLang, type ConfirmLang } from '../pref-policy.js'
import { ToolError } from '../store.js'

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
 * - 有 agent 但当前调用方没有任何确认 UI 可言：同样自动放行（NO_PROVIDER=环境未
 *   注册 UI provider；CALLER_NOT_LIVE=调用方非注册表内精确 live 实例）。确认卡是
 *   Web GUI 交互面；无界面的场景里任务文本本身即用户指令，视为已授权。
 * - 委派调用方（DELEGATED_CALLER，如会话派生的 subagent）：fail-closed 并给出指引
 *   （回主会话确认后由主会话执行）——父 agent 有 UI，「删除始终确认」不因委派被绕过。
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
    const code = (error as { code?: string } | undefined)?.code
    // 无任何确认 UI 可言的调用方：放行（与 headless「任务文本本身即用户指令」语义
    // 一致，而非让写操作以平台原始错误失败）：
    // - NO_PROVIDER：环境未注册 UI provider；
    // - CALLER_NOT_LIVE（ask() 在 NO_PROVIDER 检查之前抛出）：调用方不是注册表内的
    //   精确 live 实例——该调用方没有可阻塞的确认 UI，拒绝也无法换路径执行。
    if (code === 'NO_PROVIDER' || code === 'CALLER_NOT_LIVE') return true
    // DELEGATED_CALLER（被其他 agent 拥有的委派调用方，如会话派生的 subagent）：
    // fail-closed——父 agent 有完整 UI，平台口径是「把未决问题写进子 agent 的最终
    // 结果」；在此拒绝并给出可执行指引（回主会话确认后由主会话执行），保住
    // 「删除始终确认」等安全策略在委派路径上不被静默绕过
    if (code === 'DELEGATED_CALLER') {
      throw new ToolError(
        '当前处于委派（subagent）上下文，无法向用户弹出操作确认卡：请在最终结果中如实告知用户该操作需要确认，回到主会话确认后由主会话直接执行。',
      )
    }
    throw error
  }
}
