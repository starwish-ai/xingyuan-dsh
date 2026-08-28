/**
 * /xingyuan/* 前缀路由注册（薄分发层）：路由注册表一处可见全部端点。
 *
 * - GET 页面：today、calendar、growth（自包含 HTML，无 GUI 场景 URL 直开）
 * - GET 数据：overview、day、range、calendar、growth、wishes、tasks、profile、
 *   memories、task-detail、categories
 * - POST 动作与写面：checkin、cancel-checkin、claim、profile、memory-add、
 *   memory-delete、memory-clear、create-wish、create-task、delete-task、
 *   delete-wish、category-rename、category-color
 *
 * 错误语义：HttpError 按状态码；ActionError 返回 400 携带 error/code/params
 * （code 供客户端本地化）；其余 Error 按 400 直出领域校验消息。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// 类型副作用：加载 webServer 服务的 Context 声明合并
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { XingyuanStore } from '../domain.js'
import { getApi, postApi, type ApiDeps, type JsonBody } from './api.js'
import { pageCalendar, pageGrowth, pageToday } from './pages-html.js'
import { ActionError, HttpError } from './errors.js'
import type { RoutesConfig } from './config.js'

export type { RoutesConfig } from './config.js'

/** 动作请求体上限（防误用；正常动作体 <1KB）。 */
const BODY_MAX_BYTES = 64 * 1024

const GET_PAGES = new Set(['/', '/today', '/calendar', '/growth'])

/**
 * 注册 /xingyuan/* 前缀路由：JSON 数据/动作 API + today/calendar/growth 页面。
 * @param webServer - 宿主 web 服务（bundle 入口注入）
 * @param store - 星愿领域服务（bundle 入口打开领域后传入）
 * @param config - 天数窗等可调参数（默认值见 bundle 行 Config）
 */
export function registerXingyuanRoutes(webServer: Context['webServer'], store: XingyuanStore, config: RoutesConfig): void {
  const deps: ApiDeps = { store, config }
  webServer.register({
    kind: 'prefix',
    path: '/xingyuan',
    handler: (req, res) => void route(req, res),
  })

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/^\/xingyuan/, '') || '/'
    try {
      if (req.method === 'GET') {
        if (GET_PAGES.has(path)) {
          // Accept-Encoding 透传给页面响应做内容协商（RFC 9110 §12.5.3）
          const acceptEncoding = req.headers['accept-encoding']
          const ae = Array.isArray(acceptEncoding) ? acceptEncoding.join(',') : acceptEncoding
          if (path === '/calendar') return pageCalendar(res, ae)
          if (path === '/growth') return pageGrowth(res, ae)
          return pageToday(res, ae)
        }
        return json(res, 200, getApi(deps, path, url))
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      const body = await readJsonBody(req)
      return json(res, 200, await postApi(deps, path, body))
    } catch (error) {
      if (error instanceof HttpError) return json(res, error.status, { error: error.message })
      if (error instanceof ActionError) {
        return json(res, 400, { error: error.message, code: error.code, ...(error.params !== undefined ? { params: error.params } : {}) })
      }
      // 领域校验类失败（如「已打卡」「不是打卡日」）按 400 语义返回；
      // 领域错误若携带稳定 code/params（store.ToolError），原样透传供客户端本地化
      const message = error instanceof Error ? error.message : String(error)
      const maybe = error as { code?: unknown; params?: unknown }
      if (typeof maybe.code === 'string' && maybe.code !== '') {
        return json(res, 400, {
          error: message,
          code: maybe.code,
          ...(maybe.params !== undefined && typeof maybe.params === 'object' ? { params: maybe.params } : {}),
        })
      }
      json(res, 400, { error: message })
    }
  }
}

/** JSON 响应。 */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** 读取并解析 JSON 请求体（超限拒绝）。 */
async function readJsonBody(req: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_MAX_BYTES) throw new HttpError(413, '请求体过大')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(400, '请求体必须是合法 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, '请求体必须是 JSON 对象')
  return parsed as JsonBody
}
