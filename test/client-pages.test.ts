/**
 * 客户端页面纯函数回归测试。
 *
 * 背景 bug：记忆页搜索把 URL 拼成 `?q=词?offset=0`（第二个 ? 应为 &），
 * URLSearchParams 会把「词?offset=0」整体解析为 q 值 → 服务端永远搜不到 →
 * 用户症状「搜索功能有 bug，搜索不出来」。回归锁定两点：URL 语法只有一个 ?，
 * 以及「客户端构造的搜索 URL 交给服务端必须能命中」的往返闭环。
 */
import { describe, expect, it } from 'vitest'
import { calendarUrl, dayUrl } from '../src/client/api.js'
import { memoryListUrl } from '../src/client/pages/memory.js'
import { latestCheckedDate } from '../src/client/pages/detail.js'
import { getApi, postApi } from '../src/routes/api.js'
import type { ApiDeps } from '../src/routes/api.js'
import type { RoutesConfig } from '../src/routes/config.js'
import type { XingyuanStore } from '../src/domain.js'
import { todayIso } from '../src/opportunity.js'
import { claimTask, createTask, performCheckIn } from '../src/store.js'
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

describe('dayUrl / calendarUrl（日内/月历数据 URL 构造）', () => {
  it('query 参数经 URLSearchParams 构造，整条 URL 只有一个 ?', () => {
    expect(dayUrl('2026-08-28')).toBe('/xingyuan/api/day?date=2026-08-28')
    expect(dayUrl('2026-08-28').split('?')).toHaveLength(2)
    expect(calendarUrl('2026-08')).toBe('/xingyuan/api/calendar?month=2026-08')
    expect(calendarUrl('2026-08').split('?')).toHaveLength(2)
  })

  it('客户端构造的 day URL 交给服务端能命中（今日页/日历面板取数闭环）', async () => {
    const deps = makeDeps(memoryStore())
    const today = todayIso()
    const claimed = await createTask(deps.store, { name: '已领取', checkInCycle: 'once', dueDate: today }, today)
    await claimTask(deps.store, claimed.taskId, today)
    const payload = getApi(deps, '/api/day', new URL(`http://x.test${dayUrl(today)}`)) as {
      date: string
      tasks: Array<{ taskId: string; claimed: boolean }>
    }
    expect(payload.date).toBe(today)
    expect(payload.tasks[0]?.taskId).toBe(claimed.taskId)
    expect(payload.tasks[0]?.claimed).toBe(true) // 承诺口径布尔随 day API 落到取数面
  })

  it('客户端构造的 calendar URL 交给服务端能命中月历格子（承诺口径同源）', async () => {
    const deps = makeDeps(memoryStore())
    const today = todayIso()
    const claimed = await createTask(deps.store, { name: '月历项', checkInCycle: 'once', dueDate: today }, today)
    await claimTask(deps.store, claimed.taskId, today)
    await performCheckIn(deps.store, claimed.taskId, today, today)
    const payload = getApi(deps, '/api/calendar', new URL(`http://x.test${calendarUrl(today.slice(0, 7))}`)) as {
      weeks: Array<Array<{ date: string | null; due: number; checked: number }>>
    }
    const cell = payload.weeks.flat().find((c) => c.date === today)
    expect(cell?.due).toBe(1)
    expect(cell?.checked).toBe(1)
  })
})

describe('latestCheckedDate（任务详情撤销目标）', () => {
  const grid = (cells: Array<[string, 'checked' | 'missed' | 'future']>) =>
    cells.map(([date, state]) => ({ date, state }))

  it('今天已打卡 + 存在未来预勾：撤销目标=最近的预勾日（回归：弹框曾说「今天」、实际撤的是预勾日）', () => {
    const target = latestCheckedDate(grid([
      ['2026-08-27', 'missed'],
      ['2026-08-28', 'checked'],
      ['2026-09-29', 'checked'],
    ]))
    expect(target).toBe('2026-09-29')
  })

  it('只有今天打卡：目标=今天', () => {
    expect(latestCheckedDate(grid([['2026-08-28', 'checked']]))).toBe('2026-08-28')
  })

  it('无任何打卡（仅 missed/future）：无撤销目标', () => {
    expect(latestCheckedDate(grid([
      ['2026-08-27', 'missed'],
      ['2026-08-28', 'future'],
    ]))).toBeUndefined()
    expect(latestCheckedDate([])).toBeUndefined()
  })
})
