/**
 * 客户端页面纯函数回归测试。
 *
 * 背景 bug：记忆页搜索把 URL 拼成 `?q=词?offset=0`（第二个 ? 应为 &），
 * URLSearchParams 会把「词?offset=0」整体解析为 q 值 → 服务端永远搜不到 →
 * 用户症状「搜索功能有 bug，搜索不出来」。回归锁定两点：URL 语法只有一个 ?，
 * 以及「客户端构造的搜索 URL 交给服务端必须能命中」的往返闭环。
 */
import { describe, expect, it } from 'vitest'
import { memoryListUrl } from '../src/client/pages/memory.js'
import { getApi, postApi } from '../src/routes/api.js'
import type { ApiDeps } from '../src/routes/api.js'
import type { RoutesConfig } from '../src/routes/config.js'
import type { XingyuanStore } from '../src/domain.js'
import { memoryStore } from './memory-store.js'

function makeDeps(store: XingyuanStore): ApiDeps {
  const config: RoutesConfig = { rangeDefaultDays: 7, rangeMaxDays: 31, memoryListLimit: 500 }
  return { store, config }
}

describe('memoryListUrl（记忆搜索 URL 构造）', () => {
  it('搜索词与分页参数之间用 & 连接，整条 URL 只有一个 ?', () => {
    const url = memoryListUrl('经济', 0, 50)
    expect(url.split('?')).toHaveLength(2)
    expect(url).toBe(`/xingyuan/api/memories?q=${encodeURIComponent('经济')}&offset=0&limit=50`)
  })

  it('空搜索词不带 q 参数', () => {
    expect(memoryListUrl('   ', 0, 50)).toBe('/xingyuan/api/memories?offset=0&limit=50')
  })

  it('客户端构造的搜索 URL 交给服务端能命中（「搜索不出来」症状闭环）', async () => {
    const deps = makeDeps(memoryStore())
    await postApi(deps, '/api/action/memory-add', { key: '经济状况', value: '紧张，优先省钱', category: 'personal', importance: 'high', overwrite: true })
    await postApi(deps, '/api/action/memory-add', { key: '运动偏好', value: '不喜欢跑步', category: 'habit', importance: 'medium', overwrite: true })
    const url = memoryListUrl('经济', 0, 50)
    const payload = getApi(deps, '/api/memories', new URL(`http://x.test${url}`)) as {
      total: number
      memories: ReadonlyArray<{ key: string }>
    }
    expect(payload.total).toBe(1)
    expect(payload.memories[0]?.key).toBe('经济状况')
  })
})
