/**
 * 同源 HTTP 访问层：GET 数据 / POST 动作（页面按钮 = 用户本人授权，不经模型不走 HITL）。
 * 服务端错误优先取 payload.code 走 i18n 文案（err.* 键），未知 code 回落服务端 message 原文；
 * 非 JSON 响应兜底本地化文案而非直出英文异常。
 */
import { t, type XyKey } from './i18n.js'

/** 服务端动作错误码（与 routes 层 ActionError.code 及 store.ToolError.code 对齐；客户端按此本地化）。 */
export type ActionErrorCode =
  | 'missing_field'
  | 'not_found'
  | 'already_checked'
  | 'not_opportunity_day'
  | 'already_claimed'
  | 'task_closed'
  | 'due_past'
  | 'bad_category_name'
  | 'bad_color_key'
  | 'bad_date'
  | 'overwrite_required'

/** 携带稳定 code 的业务错误：message 为中文兜底文案，code 供客户端本地化。 */
export class ActionError extends Error {
  readonly code: ActionErrorCode
  readonly params?: Record<string, unknown>

  constructor(code: ActionErrorCode, message: string, params?: Record<string, unknown>) {
    super(message)
    this.name = 'ActionError'
    this.code = code
    this.params = params
  }
}

/** 服务端 code → i18n 键（编译期校验每个码都有文案）。 */
const ERROR_KEY: Record<ActionErrorCode, XyKey> = {
  missing_field: 'err.missing_field',
  not_found: 'err.not_found',
  already_checked: 'err.already_checked',
  not_opportunity_day: 'err.not_opportunity_day',
  already_claimed: 'err.already_claimed',
  task_closed: 'err.task_closed',
  due_past: 'err.due_past',
  bad_category_name: 'err.bad_category_name',
  bad_color_key: 'err.bad_color_key',
  bad_date: 'err.bad_date',
  overwrite_required: 'err.overwrite_required',
}

/** 把任意抛错转成用户可读文案：ActionError 按键本地化；其余直出消息。 */
export function describeError(e: unknown): string {
  if (e instanceof ActionError) return t(ERROR_KEY[e.code], e.params)
  const message = e instanceof Error ? e.message : String(e)
  // 兼容旧口径服务端纯中文消息里的「${date} 已打卡」模式（恢复卡片态用）
  return message
}

export async function postAction(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return postJson(`/xingyuan/api/action/${path}`, body)
}

export async function postJson<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parsePayload<T>(response, () => t('common.actionFailed'))
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  return parsePayload<T>(response, () => t('common.requestFailed'))
}

async function parsePayload<T>(response: Response, fallback: () => string): Promise<T> {
  let payload: T & { error?: string; code?: string; params?: Record<string, unknown> }
  try {
    payload = await response.json() as typeof payload
  } catch {
    throw new Error(`${fallback()}（${response.status}）`)
  }
  if (!response.ok) {
    if (typeof payload.code === 'string' && payload.code !== '') {
      throw new ActionError(payload.code as ActionErrorCode, payload.error ?? fallback(), payload.params)
    }
    throw new Error(payload.error ?? `${fallback()}（${response.status}）`)
  }
  return payload
}
