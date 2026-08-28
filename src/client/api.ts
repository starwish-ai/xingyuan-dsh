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
  | 'due_too_far'
  | 'bad_category_name'
  | 'bad_color_key'
  | 'bad_date'
  | 'overwrite_required'
  | 'not_claimed'
  | 'no_opportunity_left'
  | 'no_checkins'
  | 'title_too_long'
  | 'name_too_long'
  | 'once_today_only'
  | 'payload_too_large'
  | 'bad_json_body'
  | 'bad_coach_style'
  | 'bad_interests'

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
  due_too_far: 'err.due_too_far',
  bad_category_name: 'err.bad_category_name',
  bad_color_key: 'err.bad_color_key',
  bad_date: 'err.bad_date',
  overwrite_required: 'err.overwrite_required',
  not_claimed: 'err.not_claimed',
  no_opportunity_left: 'err.no_opportunity_left',
  no_checkins: 'err.no_checkins',
  title_too_long: 'err.title_too_long',
  name_too_long: 'err.name_too_long',
  once_today_only: 'err.once_today_only',
  payload_too_large: 'err.payload_too_large',
  bad_json_body: 'err.bad_json_body',
  bad_coach_style: 'err.bad_coach_style',
  bad_interests: 'err.bad_interests',
}

/** 把任意抛错转成用户可读文案：ActionError 按键本地化；其余直出消息。 */
export function describeError(e: unknown): string {
  if (!(e instanceof ActionError)) return e instanceof Error ? e.message : String(e)
  // 服务端新增未知 code 时回落原始消息，避免渲染 undefined 或插值崩溃
  const key = ERROR_KEY[e.code]
  return key !== undefined ? t(key, e.params) : e.message
}

export async function postAction(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return postJson(`/xingyuan/api/action/${path}`, body)
}

/** 请求超时：手动 AbortController——AbortSignal.timeout 为 Baseline 2024 "Newly available"，
 * 不满足 dsh 壳的保守浏览器矩阵（同 color-mix 禁令的判断口径），不用。 */
const REQUEST_TIMEOUT_MS = 15_000

async function fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(path, { ...init, signal: controller.signal })
  } catch (e) {
    // 超时中止统一转本地化文案；真实网络错误原样抛出（保留连接拒绝等语义）
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error(t('common.requestTimeout'))
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}

export async function postJson<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parsePayload<T>(response, () => t('common.actionFailed'))
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(path, { headers: { accept: 'application/json' } })
  return parsePayload<T>(response, () => t('common.requestFailed'))
}

async function parsePayload<T>(response: Response, fallback: () => string): Promise<T> {
  // HTTP 层错误的状态码后缀走本地化键（zh 全角 / en 半角括号），不硬编码全角括号
  const withStatus = (message: string): string => `${message}${t('common.httpStatus', { status: response.status })}`
  let payload: T & { error?: string; code?: string; params?: Record<string, unknown> }
  try {
    payload = await response.json() as typeof payload
  } catch {
    throw new Error(withStatus(fallback()))
  }
  if (!response.ok) {
    if (typeof payload.code === 'string' && payload.code !== '') {
      throw new ActionError(payload.code as ActionErrorCode, payload.error ?? fallback(), payload.params)
    }
    throw new Error(payload.error !== undefined ? withStatus(payload.error) : withStatus(fallback()))
  }
  return payload
}
