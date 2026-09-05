/**
 * 提示词层回归（两件事）：
 * 1) 开场概览（xingyuan:today）必须消费 freshWishes 派生位——库存 progress/archived 只在
 *    写路径刷新，手改库等使库存失真的场景下，上下文与列表/页面必须同源（2026-09 审查修复）；
 *    全达成与从零两态分开表述，不得把完成过愿望的老用户当新客。
 * 2) 用语规范禁词锁（§5.2）：11 段静态提示词与全部动态上下文属「模型逐字转述面」，
 *    正文行禁内部词（候选/待结算/口径/锚点/分母/账本）；「教模型别说这些词」的
 *    教学行本身豁免（含「不说」字样）。回填即红。
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { XingyuanStore, TaskRecord, WishRecord, MemoryRecord } from '../src/domain.js'
import { registerPrompts } from '../src/preset/prompts.js'
import { todayIso } from '../src/opportunity.js'
import { memoryStore } from './memory-store.js'

interface SectionDef { name: string; order: number; text: unknown }
interface ContextDef { name: string; order: number; text: () => string }

function register(store: XingyuanStore): { sections: SectionDef[]; contexts: ContextDef[] } {
  const sections: SectionDef[] = []
  const contexts: ContextDef[] = []
  const ctx = {
    xingyuan: store,
    systemPrompt: {
      section: (def: SectionDef) => { sections.push(def) },
      context: (def: ContextDef) => { contexts.push(def) },
    },
  } as unknown as Context & { xingyuan: XingyuanStore }
  registerPrompts(ctx, { memoryInjectLimit: 40 })
  return { sections, contexts }
}

function todayContextText(store: XingyuanStore): string {
  return register(store).contexts.find((def) => def.name === 'xingyuan:today')?.text() ?? ''
}

describe('开场概览承诺口径（派生位单一来源）', () => {
  const today = todayIso()

  it('库存失真愿望（archived=true 而有待领取任务，如手改库）：概览按派生呈「进行中 + 待收尾」，不按库存位漏计', () => {
    const store = memoryStore()
    void store.domain.table('wishes').put('w', {
      wishId: 'w', title: '库存失真愿望', categoryName: '学习',
      progress: 100, totalRequiredDays: 1, totalCompletedDays: 1, archived: true, createdAt: `${today}T00:00:00`,
    } satisfies WishRecord)
    void store.domain.table('tasks').put('t-done', {
      taskId: 't-done', wishId: 'w', name: '已兑现承诺', checkInCycle: 'once', source: 'user', status: 'closed',
      closedReason: 'achieved', claimDate: today, requiredDays: 1, completedDays: 1, createdAt: `${today}T00:00:00`,
    } satisfies TaskRecord)
    void store.domain.table('tasks').put('t', {
      taskId: 't', wishId: 'w', name: '待领取的', checkInCycle: 'once', source: 'user',
      status: 'pending', requiredDays: 1, completedDays: 0, createdAt: `${today}T00:00:00`,
    } satisfies TaskRecord)
    const text = todayContextText(store)
    // 直读库存 archived 的旧实现会得「进行中的愿望 0 个」并入「还没有任何愿望」引导语
    expect(text).toContain('进行中的愿望 1 个')
    expect(text).toContain('1 个待收尾')
    expect(text).not.toContain('还没有任何愿望')
  })

  it('真达成（承诺完成且无待领取）：报「均已达成」引导许新愿，不得误当无愿望新客；裸愿望算进行中不标待收尾', () => {
    const store = memoryStore()
    void store.domain.table('wishes').put('w', {
      wishId: 'w', title: '已达成愿望', categoryName: '学习',
      progress: 100, totalRequiredDays: 1, totalCompletedDays: 1, archived: true, createdAt: `${today}T00:00:00`,
    } satisfies WishRecord)
    void store.domain.table('tasks').put('t', {
      taskId: 't', wishId: 'w', name: '唯一承诺', checkInCycle: 'once', source: 'user', status: 'closed',
      closedReason: 'achieved', claimDate: today, requiredDays: 1, completedDays: 1, createdAt: `${today}T00:00:00`,
    } satisfies TaskRecord)
    const achievedOnly = todayContextText(store)
    expect(achievedOnly).not.toContain('待收尾')
    // 终审 T5 锁：曾一律报「还没有任何愿望」——完成全部愿望的老用户被当新客自我介绍
    expect(achievedOnly).toContain('均已达成')
    expect(achievedOnly).not.toContain('还没有任何愿望')
    // 从零：真正无任何愿望才走新客引导
    const empty = todayContextText(memoryStore())
    expect(empty).toContain('还没有任何愿望')
    // 裸愿望（无任何任务）：派生 progress 0 → 算进行中（§11 已知限制：无达成出口），不得误标待收尾
    const bare = memoryStore()
    void bare.domain.table('wishes').put('w2', {
      wishId: 'w2', title: '裸愿望', categoryName: '生活',
      progress: 0, totalRequiredDays: 0, totalCompletedDays: 0, archived: false, createdAt: `${today}T00:00:00`,
    } satisfies WishRecord)
    const bareText = todayContextText(bare)
    expect(bareText).toContain('进行中的愿望 1 个')
    expect(bareText).not.toContain('待收尾')
  })
})

describe('用语规范禁词锁（§5.2：提示词属模型逐字转述面）', () => {
  const JARGON = /候选|待结算|口径|锚点|分母|账本/

  // 教学行豁免：WISH_GUIDE 有一行专门「教模型别说这些词」，禁词以反例身份出现属必需
  const exempt = (line: string): boolean => line.includes('不说')

  function offendingLines(text: string): string[] {
    return text.split('\n').filter((line) => !exempt(line) && JARGON.test(line))
  }

  it('11 段静态提示词正文无内部词（回填即红）', () => {
    const { sections } = register(memoryStore())
    expect(sections.length).toBeGreaterThanOrEqual(11)
    for (const section of sections) {
      const text = typeof section.text === 'string' ? section.text : ''
      expect(offendingLines(text), `节「${section.name}」含禁词正文`).toEqual([])
    }
  })

  it('动态上下文（教练风格/记忆/开场概览）求值后无内部词', () => {
    const store = memoryStore()
    void store.domain.table('wishes').put('w', {
      wishId: 'w', title: '待收尾愿望', categoryName: '学习',
      progress: 100, totalRequiredDays: 1, totalCompletedDays: 1, archived: false, createdAt: `${todayIso()}T00:00:00`,
    } satisfies WishRecord)
    void store.domain.table('tasks').put('t-done', {
      taskId: 't-done', wishId: 'w', name: '已兑现', checkInCycle: 'once', source: 'user', status: 'closed',
      closedReason: 'achieved', claimDate: todayIso(), requiredDays: 1, completedDays: 1, createdAt: `${todayIso()}T00:00:00`,
    } satisfies TaskRecord)
    void store.domain.table('tasks').put('t-pending', {
      taskId: 't-pending', wishId: 'w', name: '挂着', checkInCycle: 'once', source: 'ai',
      status: 'pending', requiredDays: 1, completedDays: 0, createdAt: `${todayIso()}T00:00:00`,
    } satisfies TaskRecord)
    void store.domain.table('memories').put('m', {
      key: '昵称', value: '小星', category: 'personal', importance: 'high', createdAt: Date.now(),
    } satisfies MemoryRecord)
    const { contexts } = register(store)
    expect(contexts.length).toBe(3)
    for (const context of contexts) {
      expect(offendingLines(context.text()), `动态上下文「${context.name}」含禁词正文`).toEqual([])
    }
  })

  it('收尾句固定句式在指南中原样出现（SETTLE_PHRASE 单源对拍）', () => {
    const { sections } = register(memoryStore())
    const wishGuide = sections.find((section) => section.name.includes('wish'))
    expect(typeof wishGuide?.text === 'string' ? wishGuide.text : '').toContain('领了继续，或删掉就达成')
  })
})
