/**
 * 标签页显隐策略纯函数对拍（tab-policy.ts）。
 *
 * 设计结论口径：默认跟随会话（仅星愿预设的会话显示）；始终显示 = 所有会话；
 * 始终隐藏 = 任何会话不显示；hiddenTabs 在「显示」前提下按标签剔除。
 * 未知/重复 hiddenTabs 值容错忽略（手改 profile 补丁塞进脏值不炸）。
 */
import { describe, expect, it } from 'vitest'
import { TAB_IDS, TAB_VISIBILITY_DEFAULTS, currentSessionIsXingyuan, normalizeHiddenTabs, visibleTabIds, type SessionRowFacts } from '../src/tab-policy.js'

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

  /**
   * 生产路径的容错其实发生在 normalizeHiddenTabs（Config 元素类型是宽松的 string，
   * 见 src/ui-settings.ts——union 校验会在 Config 解析期抛，炸的是整条主行）。
   */
  it('normalizeHiddenTabs：只留合法 id、去重，非数组/缺席一律空集合', () => {
    expect(normalizeHiddenTabs(['tasks', 'bogus', 'tasks', 1, null])).toEqual(['tasks'])
    expect(normalizeHiddenTabs([...TAB_IDS])).toEqual([...TAB_IDS])
    expect(normalizeHiddenTabs(undefined)).toEqual([])
    expect(normalizeHiddenTabs('junk')).toEqual([])
    expect(normalizeHiddenTabs({})).toEqual([])
  })

  it('容错口径闭环：脏值经 normalize 后不剔除任何标签（与直接喂合法值同结果）', () => {
    expect(visibleTabIds('show', normalizeHiddenTabs(['bogus']), false)).toEqual(visibleTabIds('show', [], false))
  })

  it('缺省常量与策略同口径（默认 = follow + 全显示）', () => {
    expect(TAB_VISIBILITY_DEFAULTS.tabVisibilityMode).toBe('follow')
    expect(TAB_VISIBILITY_DEFAULTS.hiddenTabs).toEqual([])
  })
})

/**
 * 「当前会话是否星愿预设」对拍（currentSessionIsXingyuan）。
 *
 * 这个判定在宿主换代里断过两次：0.1.2 撤 `SessionSummary.agentPreset` 顶层字段、
 * 0.1.6 撤 `SessionListState.current`。断掉那次是**编译全绿、运行静默失效**，
 * 所以夹具必须照宿主真实形状写（`retainedBy` 在宿主类型里是必填），而不是照
 * 「全可选」的宽松视图写——后者让字段缺席合法，等于只测了自己那一代。
 */
const row = (preset: unknown, mainView = 0): SessionRowFacts => ({
  retainedBy: { mainView },
  projectionValues: { agentPreset: preset },
})

describe('currentSessionIsXingyuan（当前会话判定）', () => {
  it('主视图正在看星愿会话 → 显示', () => {
    expect(currentSessionIsXingyuan({ byId: { a: row('xingyuan', 1) } })).toBe(true)
  })

  it('星愿会话在后台、主视图看的是别的会话 → 不显示', () => {
    expect(currentSessionIsXingyuan({
      byId: { a: row('xingyuan'), b: row('coder', 1) },
    })).toBe(false)
  })

  it('多栏并行：任一主视图会话是星愿即显示（计数 >1 同样命中）', () => {
    expect(currentSessionIsXingyuan({
      byId: { a: row('coder', 1), b: row('xingyuan', 2) },
    })).toBe(true)
  })

  it('无会话 / 列表未就绪 / 快照缺席 → 不显示', () => {
    expect(currentSessionIsXingyuan({ byId: {} })).toBe(false)
    expect(currentSessionIsXingyuan(undefined)).toBe(false)
  })

  it('投影值缺席如实降级：未投影 / agentPreset 为 null / 前缀相近的脏值 → 不显示', () => {
    expect(currentSessionIsXingyuan({ byId: { a: { retainedBy: { mainView: 1 } } } })).toBe(false)
    expect(currentSessionIsXingyuan({ byId: { a: row(null, 1) } })).toBe(false)
    expect(currentSessionIsXingyuan({ byId: { a: row('xingyuan-ish', 1) } })).toBe(false)
  })

  it('mainView 缺席与为 0 都不算命中（宿主无引用时不写该键）', () => {
    expect(currentSessionIsXingyuan({ byId: { a: { retainedBy: {}, projectionValues: { agentPreset: 'xingyuan' } } } })).toBe(false)
    expect(currentSessionIsXingyuan({ byId: { a: row('xingyuan', 0) } })).toBe(false)
  })
})
