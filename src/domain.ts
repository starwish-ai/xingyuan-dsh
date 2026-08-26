/**
 * 星愿领域：defineDomain 声明一次（zod 记录 schema），sqlite 后端落库。
 * 无迁移机制，介质版本 v1 一次定死；演进策略 = 版本号 + 重导出工具（从 v1 规划）。
 *
 * 打卡以 `${taskId}|${date}` 为键：O(1) 判存在，规避「无二级索引」限制；
 * 「某任务的机会日序列」不逐日展开落库，按需由 opportunity.ts 现算。
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { domainTable, defineDomain, type Domain, type DomainTableSpec } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const DOMAIN_VERSION = 1

/** 教练风格。 */
export const COACH_STYLES = ['gentle', 'strict', 'humorous'] as const
export type CoachStyle = (typeof COACH_STYLES)[number]

/** 全局单例：教练配置 + 用户画像。 */
export interface XingyuanGlobal {
  coachStyle: CoachStyle
  profile: {
    nickname?: string
    occupation?: string
    interests?: string[]
  }
  /**
   * 微行动状态（按 taskId 挂载；对齐 Web micro-action 三端点语义，本地由模型现拆步骤）。
   * optional 字段：zod 对旧 JSON 缺键解析为 undefined，向后兼容，DOMAIN_VERSION 无需变更。
   */
  microActions?: Record<string, MicroActionState>
  /**
   * 分类颜色覆盖（T1-3）：分类名 → 22 键 colorKey。解析顺序 = 此覆盖 > 愿望显式
   * colorKey > 分类名哈希兜底；optional 字段同款向后兼容模式。
   */
  categoryColors?: Record<string, string>
}

/** 微行动单步。 */
export interface MicroStep {
  readonly stepNumber: number
  readonly instruction: string
  readonly rationale?: string
  completed: boolean
  skipped: boolean
}

/** 微行动状态（一次拆解 3-7 步；全部处理完 currentStepNumber 归 null）。 */
export interface MicroActionState {
  readonly taskId: string
  steps: MicroStep[]
  currentStepNumber: number | null
  updatedAt: string
}

export const CYCLES = ['once', 'daily', 'weekly', 'monthly'] as const
export type Cycle = (typeof CYCLES)[number]


/** 微行动步骤 schema（3-7 步，指令 ≤200 字）。 */
const MicroStepSchema = z.object({
  stepNumber: z.number().int().min(1).max(7),
  instruction: z.string().min(1).max(200),
  rationale: z.string().max(300).optional(),
  completed: z.boolean(),
  skipped: z.boolean(),
})

/** 全局单例 schema：显式钉住输出类型，避免推断出 {} 联合。 */
const GlobalSchema: z.ZodType<XingyuanGlobal> = z.object({
  coachStyle: z.enum(COACH_STYLES),
  profile: z.object({
    nickname: z.string().optional(),
    occupation: z.string().optional(),
    interests: z.array(z.string()).optional(),
  }),
  microActions: z.record(z.string(), z.object({
    taskId: z.string(),
    steps: z.array(MicroStepSchema).min(3).max(7),
    currentStepNumber: z.number().int().min(1).max(7).nullable(),
    updatedAt: z.string(),
  })).optional(),
  categoryColors: z.record(z.string(), z.string()).optional(),
})

const INITIAL_GLOBAL: XingyuanGlobal = { coachStyle: 'gentle', profile: {} }
export const xingyuanDomainSpec = defineDomain({
  name: 'xingyuan',
  version: DOMAIN_VERSION,
  global: {
    schema: GlobalSchema,
    initial: INITIAL_GLOBAL,
  },
  tables: {
    wishes: domainTable(
      z.object({
        wishId: z.string(),
        title: z.string().min(1).max(50),
        description: z.string().max(500).optional(),
        categoryName: z.string().min(2).max(6),
        colorKey: z.string().optional(),
        estimatedCompletionDate: z.string().optional(),
        progress: z.number().int().min(0).max(100),
        totalRequiredDays: z.number().int().min(0),
        totalCompletedDays: z.number().int().min(0),
        archived: z.boolean(),
        createdAt: z.string(),
      }),
    ),
    tasks: domainTable(
      z.object({
        taskId: z.string(),
        wishId: z.string().optional(),
        name: z.string().min(1).max(100),
        hint: z.string().max(500).optional(),
        dueDate: z.string().optional(),
        checkInCycle: z.enum(CYCLES),
        source: z.enum(['user', 'ai']),
        status: z.enum(['pending', 'in_progress', 'closed']),
        claimDate: z.string().optional(),
        requiredDays: z.number().int().min(0),
        completedDays: z.number().int().min(0),
        closedReason: z.enum(['achieved', 'expired']).optional(),
        createdAt: z.string(),
      }),
    ),
    checkins: domainTable(
      z.object({
        checkinId: z.string(),
        taskId: z.string(),
        date: z.string(),
        checkedAt: z.string(),
      }),
    ),
    memories: domainTable(
      z.object({
        key: z.string().min(2).max(50),
        value: z.string().min(1).max(1000),
        category: z.enum(['personal', 'preference', 'habit', 'event', 'other']),
        importance: z.enum(['high', 'medium', 'low']),
        createdAt: z.number(),
      }),
    ),
  },
})

export type WishRecord = TableValue<(typeof xingyuanDomainSpec.tables)['wishes']>
export type TaskRecord = TableValue<(typeof xingyuanDomainSpec.tables)['tasks']>
export type CheckinRecord = TableValue<(typeof xingyuanDomainSpec.tables)['checkins']>
export type MemoryRecord = TableValue<(typeof xingyuanDomainSpec.tables)['memories']>

export interface XingyuanStore {
  readonly spec: typeof xingyuanDomainSpec
  readonly domain: Domain<typeof xingyuanDomainSpec>
  newId(): string
  checkinKey(taskId: string, date: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    xingyuan: XingyuanStore
  }
}
 
 type TableValue<S extends DomainTableSpec> = S extends DomainTableSpec<string, infer V> ? V : never

/** 由已打开领域构造服务句柄（bundle 入口组装用）。 */
export function makeXingyuanStore(domain: Domain<typeof xingyuanDomainSpec>): XingyuanStore {
  return {
    spec: xingyuanDomainSpec,
    domain,
    newId: () => randomUUID(),
    checkinKey: (taskId, date) => `${taskId}|${date}`,
  }
}
