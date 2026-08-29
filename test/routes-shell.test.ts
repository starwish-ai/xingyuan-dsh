/**
 * HTTP 壳测试（routes/index.ts 的 route()/readJsonBody()）：错误协议分层的机械锁定。
 * 此前该层零覆盖——删掉 ToolError.code 透传分支或把 HttpError 折成 400 时测试全绿，
 * 但客户端错误本地化整体退化。用内存 mock 的 IncomingMessage/ServerResponse 直调
 * 注册捕获的 handler（与宿主 webServer.register 契约一致，不启动真实监听）。
 */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerXingyuanRoutes } from '../src/routes/index.js'
import type { RoutesConfig } from '../src/routes/config.js'
import { memoryStore } from './memory-store.js'

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void

/** 捕获 registerXingyuanRoutes 注册的 handler（宿主契约：register 返回 disposer）。 */
function captureHandler(): RouteHandler {
  let captured: RouteHandler | undefined
  const fakeWebServer = {
    register: (opts: { handler: RouteHandler }) => {
      captured = opts.handler
      return () => undefined
    },
  }
  const config: RoutesConfig = { rangeDefaultDays: 7, rangeMaxDays: 31, memoryListLimit: 500 }
  registerXingyuanRoutes(fakeWebServer as unknown as Parameters<typeof registerXingyuanRoutes>[0], memoryStore(), config)
  if (captured === undefined) throw new Error('handler 未被注册')
  return captured
}

function mockReq(method: string, url: string, body?: string): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')]
  return {
    url,
    method,
    headers: {},
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve(chunks.length > 0 ? { value: chunks.shift()!, done: false } : { value: undefined, done: true }),
    }),
  } as unknown as IncomingMessage
}

interface ResState {
  status: number | undefined
  body: string | undefined
}

function mockRes(): { res: ServerResponse; state: ResState; done: Promise<void> } {
  const state: ResState = { status: undefined, body: undefined }
  let settle: () => void
  const done = new Promise<void>((resolve) => { settle = resolve })
  const res = {
    writeHead: (status: number) => { state.status = status },
    end: (data?: Buffer | string) => {
      state.body = data === undefined ? '' : Buffer.isBuffer(data) ? data.toString('utf8') : data
      settle()
    },
  }
  return { res: res as unknown as ServerResponse, state, done }
}

async function call(handler: RouteHandler, method: string, url: string, body?: string): Promise<{ status: number | undefined; payload: Record<string, unknown> }> {
  const { res, state, done } = mockRes()
  handler(mockReq(method, url, body), res)
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('响应未结束')), 2000))])
  return { status: state.status, payload: state.body === undefined ? {} : JSON.parse(state.body) as Record<string, unknown> }
}

describe('HTTP 壳：错误协议分层（客户端本地化依赖的稳定契约）', () => {
  const handler = captureHandler()

  it('未知 GET 路径 → 404 + code（HttpError 按状态码直出）', async () => {
    const { status, payload } = await call(handler, 'GET', '/xingyuan/api/unknown')
    expect(status).toBe(404)
    expect(payload.code).toBe('not_found')
  })

  it('非 GET/POST 方法 → 405', async () => {
    const { status, payload } = await call(handler, 'PUT', '/xingyuan/api/overview')
    expect(status).toBe(405)
    expect(payload.error).toContain('method not allowed')
  })

  it('非法 JSON 请求体 → 400 + bad_json_body', async () => {
    const { status, payload } = await call(handler, 'POST', '/xingyuan/api/action/checkin', '{oops')
    expect(status).toBe(400)
    expect(payload.code).toBe('bad_json_body')
  })

  it('非对象 JSON（数组/标量）→ 400 + bad_json_body', async () => {
    const { status, payload } = await call(handler, 'POST', '/xingyuan/api/action/checkin', '[1,2]')
    expect(status).toBe(400)
    expect(payload.code).toBe('bad_json_body')
  })

  it('请求体超 64KB 中途截断 → 413 + payload_too_large', async () => {
    const { status, payload } = await call(handler, 'POST', '/xingyuan/api/action/checkin', JSON.stringify({ pad: 'x'.repeat(70 * 1024) }))
    expect(status).toBe(413)
    expect(payload.code).toBe('payload_too_large')
  })

  it('领域校验失败（缺必填字段）→ 400 + ActionError 稳定 code + params（客户端插值载体）', async () => {
    const { status, payload } = await call(handler, 'POST', '/xingyuan/api/action/checkin', '{}')
    expect(status).toBe(400)
    expect(payload.code).toBe('missing_field')
    expect(typeof payload.error).toBe('string')
    expect((payload.params as Record<string, unknown> | undefined)?.field).toBe('taskId')
  })

  it('store.ToolError 携带稳定 code → 400 原样透传（客户端本地化的关键分支）', async () => {
    // 不存在的 taskId：performCheckIn 抛 ToolError('…', 'not_found')——非 ActionError 实例，
    // 走「带 code 领域错误透传」分支；删掉该分支时客户端错误码本地化整体退化
    const { status, payload } = await call(handler, 'POST', '/xingyuan/api/action/checkin', JSON.stringify({ taskId: 'no-such-task' }))
    expect(status).toBe(400)
    expect(payload.code).toBe('not_found')
    expect((payload.params as Record<string, unknown> | undefined)?.taskId).toBe('no-such-task')
    // 无 code 的普通 Error 兜底分支（index.ts 末段）无法从公共端点触达（全部端点错误
    // 均带 code），其行为由领域错误透传分支共用同一 json() 出口覆盖
  })

  it('正常 GET 数据路径 → 200 JSON', async () => {
    const { status, payload } = await call(handler, 'GET', '/xingyuan/api/overview')
    expect(status).toBe(200)
    expect(typeof payload).toBe('object')
  })
})
