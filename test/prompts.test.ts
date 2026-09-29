/**
 * 提示词层回归（两件事）：
 * 1) 开场概览（xingyuan:today）必须消费 freshWishes 派生位——库存 progress/archived 只在
 *    写路径刷新，手改库等使库存失真的场景下，上下文与列表/页面必须同源（2026-09 审查修复）；
 *    全达成与从零两态分开表述，不得把完成过愿望的老用户当新客。
 * 2) 用语规范禁词锁（§5.2）：11 段静态提示词与全部动态上下文属「模型逐字转述面」，
 *    正文行禁内部词（候选/待结算/口径/锚点/分母/账本）；「教模型别说这些词」的
 *    教学行本身豁免（含「不说」字样）。回填即红。
 * 3) 提醒指南对宿主 schedule 能力保持中立（本包 peer 同时声明 0.1.7 与 0.2.0 两条宿主线，
 *    两版宿主的提醒能力不同，任何一侧的固定断言都会在另一侧失真）。
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

/**
 * 提醒指南的「宿主能力中立」锁（0.2.0-rc.1 迁移）。
 * 背景：宿主 schedule 子系统在 0.2.0 被重写——一次性/session-local 口径作废，
 * 现在支持 daily/weekly/cron 且 Host-wide 持久交付；而 0.1.7 那一版仍只有 at/after/every_seconds。
 * 本包 peer 同时声明这两条版本线，于是提示词**任何一方都不能断言**：
 * 写「不支持周期提醒」在 0.2.0 上是对用户撒谎，写「支持」在 0.1.7 上是让模型承诺做不到的事
 * （§5.8「工具描述一律不可断言」同一类坑，只是这次的载体是宿主工具而非本包工具）。
 * 因此锁：① 固定能力断言一律禁止；② 必须把判定权交给「本次工具实际接受的参数」。
 */
describe('提醒指南对宿主能力保持中立（两版宿主都不失真）', () => {
  function guideText(name: string): string {
    const { sections } = register(memoryStore())
    const text = sections.find((section) => section.name === name)?.text
    return typeof text === 'string' ? text : ''
  }

  /** 出现过时的固定口径＝红：这些句子只在一版宿主上成立。 */
  const FORBIDDEN = [
    /不支持(每天|每周|每月|周期)/,
    /周期提醒暂不支持/,
    /仅在当前会话(存活期间)?送达/,
    /会话结束后提醒不再触达/,
  ]

  it('xingyuan:reminder-guide 不含任一宿主版本的固定能力断言', () => {
    const text = guideText('xingyuan:reminder-guide')
    expect(text).not.toBe('')
    for (const pattern of FORBIDDEN) {
      expect(text, `指南含固定断言 ${pattern}，另一版宿主上即失真`).not.toMatch(pattern)
    }
  })

  it('xingyuan:capabilities 同样不得把提醒能力写死', () => {
    for (const pattern of FORBIDDEN) {
      expect(guideText('xingyuan:capabilities'), `能力段含固定断言 ${pattern}`).not.toMatch(pattern)
    }
  })

  it('判定口径写全：先看本次 schedule_create 接受的参数，且保留兜底话术', () => {
    const text = guideText('xingyuan:reminder-guide')
    expect(text).toContain('schedule_create')
    expect(text).toMatch(/实际接受的参数/)
    expect(text).toMatch(/daily/)
    expect(text).toMatch(/今日待打卡概览/)
  })
})
