/**
 * 路由层业务错误：携带稳定 code（客户端据此本地化文案）与中文兜底消息。
 * 与 client 半侧 `src/client/api.ts` 的 ActionErrorCode 集合保持一一对应；
 * 新增码时两处同批补齐。
 */

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

/** 业务校验失败：HTTP 400 + { error, code, params }。 */
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

/** 非 400 的 HTTP 层失败（404/405 等）。 */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}
