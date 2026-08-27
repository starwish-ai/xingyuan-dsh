/**
 * 标签页显隐策略纯函数对拍（tab-policy.ts）。
 *
 * 设计结论口径：默认跟随会话（仅星愿预设的会话显示）；始终显示 = 所有会话；
 * 始终隐藏 = 任何会话不显示；hiddenTabs 在「显示」前提下按标签剔除。
 * 未知/重复 hiddenTabs 值容错忽略（settings.yaml 手改脏值不炸）。
 */
import { describe, expect, it } from 'vitest'
import { TAB_IDS, TAB_VISIBILITY_DEFAULTS, visibleTabIds } from '../src/tab-policy.js'

describe('visibleTabIds（标签页显隐策略）', () => {
  it('默认模式 follow：星愿会话显示全部标签', () => {
    expect(visibleTabIds('follow', [], true)).toEqual(TAB_IDS)
  })

  it('默认模式 follow：非星愿会话一个都不显示（死标签消灭于默认态）', () => {
    expect(visibleTabIds('follow', [], false)).toEqual([])
  })

  it('follow + 无当前会话（列表未就绪/空白态）：不显示', () => {
    expect(visibleTabIds('follow', [], false)).toEqual([])
  })

  it('始终显示：任何会话都显示全部标签', () => {
    expect(visibleTabIds('show', [], false)).toEqual(TAB_IDS)
    expect(visibleTabIds('show', [], true)).toEqual(TAB_IDS)
  })

  it('始终隐藏：任何会话都不显示（勾选数据不再参与判定）', () => {
    expect(visibleTabIds('hide', [], true)).toEqual([])
    expect(visibleTabIds('hide', ['today'], false)).toEqual([])
  })

  it('hiddenTabs 按标签剔除，其余保持原序', () => {
    expect(visibleTabIds('show', ['tasks', 'memory'], false)).toEqual(['today', 'wishes', 'calendar', 'growth'])
    expect(visibleTabIds('follow', ['today'], true)).toEqual(['wishes', 'tasks', 'calendar', 'growth', 'memory'])
  })

  it('hiddenTabs 全部勾掉 = 空集合（环里只剩 Chat 等官方标签）', () => {
    expect(visibleTabIds('show', [...TAB_IDS], false)).toEqual([])
  })

  it('脏值容错：未知 id 与重复项忽略，不抛出', () => {
    const dirty = ['tasks', 'bogus', 'tasks'] as never[]
    expect(visibleTabIds('show', dirty as never[], false)).toEqual(['today', 'wishes', 'calendar', 'growth', 'memory'])
  })

  it('缺省常量与策略同口径（默认 = follow + 全显示）', () => {
    expect(TAB_VISIBILITY_DEFAULTS.tabVisibilityMode).toBe('follow')
    expect(TAB_VISIBILITY_DEFAULTS.hiddenTabs).toEqual([])
  })
})