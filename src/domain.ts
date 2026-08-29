/**
 * 星愿领域：defineDomain 声明一次（zod 记录 schema），sqlite 后端落库。
 * 无迁移机制，介质版本 v1 一次定死；演进策略 = 版本号 + 重导出工具（从 v1 规划）。
 *
 * 打卡以 `${taskId}|${date}` 为键：O(1) 判存在，规避「无二级索引」限制；
 * 「某任务的机会日序列」不逐日展开落库，按需由 opportunity.ts 现算。
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { domainTable, defineDomain, type Domain, type DomainTableSpec, type KvTable, type TableKeyOf, type TableValueOf } from '@deepseek-ai/dsh-storage-domain'
import { z, type ZodType } from 'zod'
import type { PrefSettings } from './pref-policy.js'

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
   * 分类颜色覆盖：分类名 → 22 键 colorKey。解析顺序 = 此覆盖 > 愿望显式
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
  /** 对话偏好：bundle 层常驻命名空间的解析值（非领域数据），每次调用读当前值。 */
  prefs(): PrefSettings
  newId(): string
  checkinKey(taskId: string, date: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    xingyuan: XingyuanStore
  }
}
 
 type TableValue<S extends DomainTableSpec> = S extends DomainTableSpec<string, infer V> ? V : never

/**
 * 写路径越界（领域 schema 在落库前拒绝）：稳定 code 供路由层透传，客户端对未知
 * code 回落服务端原文（ERROR_KEY 无此码——最后防线，可接受）。
 * 放在 domain.ts 而非复用 store.ToolError——store 反向导入本模块，会成环。
 */
export class RecordInvalidError extends Error {
  readonly code = 'invalid_record'
  constructor(message: string) {
    super(message)
    this.name = 'RecordInvalidError'
  }
}

/** 落库前按声明 schema 校验（合法记录 parse 为恒等；违规拒绝并给出可读字段路径）。 */
function guardSchema<V>(schema: ZodType<V>, label: string, value: V): void {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue !== undefined && issue.path.length > 0 ? `.${issue.path.join('.')}` : ''
    throw new RecordInvalidError(
      `记录未通过领域 schema 校验，拒绝落库（${label}${path}）：${issue?.message ?? '不符合声明结构'}`,
    )
  }
}

/** 包一层写校验的表句柄：读侧原样透传，put/update 在落库前先过 schema。 */
function guardTable<K extends string, V>(table: KvTable<K, V>, schema: ZodType<V>, label: string): KvTable<K, V> {
  return {
    get: (key) => table.get(key),
    entries: () => table.entries(),
    keys: () => table.keys(),
    // 活值 getter：KvTable 契约是「当前记录数」，快照会在持有句柄跨写后失真
    get size(): number { return table.size },
    put: async (key, value) => {
      guardSchema(schema, label, value)
      await table.put(key, value)
    },
    delete: (key) => table.delete(key),
    update: (key, fn) => table.update(key, (current) => {
      const next = fn(current)
      guardSchema(schema, label, next)
      return next
    }),
  }
}

/**
 * 写路径 schema 闸门：dsh-storage-domain 只在冷启动 open 时校验存量记录，写句柄
 * 明确「不 re-check」（验证发生在 durable read 边界）——写路径若漏校验，一条越界
 * 记录会落库成功、下次启动 open 整体失败（invalid-record 拒绝打开，插件永久无法
 * 激活，只能手工改库）。业务层的字段校验只覆盖各自路径，此处单点拦截全部
 * put/update/global.set 作为最后防线；读侧零开销，写路径仅多一次本地 parse。
 */
function guardDomain(domain: Domain<typeof xingyuanDomainSpec>): Domain<typeof xingyuanDomainSpec> {
  const tables = xingyuanDomainSpec.tables
  const global = domain.global
  return {
    name: domain.name,
    global: {
      get: () => global.get(),
      set: async (value) => {
        guardSchema(GlobalSchema, 'global', value)
        await global.set(value)
      },
    },
    table: <N extends keyof typeof tables & string>(name: N) => {
      const spec = tables[name]
      return guardTable(
        domain.table(name),
        spec.valueSchema as ZodType<TableValueOf<typeof xingyuanDomainSpec, N>>,
        `table:${name}`,
      ) as KvTable<TableKeyOf<typeof xingyuanDomainSpec, N>, TableValueOf<typeof xingyuanDomainSpec, N>>
    },
    close: () => domain.close(),
  }
}

/** 由已打开领域构造服务句柄（bundle 入口组装用）。 */
export function makeXingyuanStore(
  domain: Domain<typeof xingyuanDomainSpec>,
  readPrefs: () => PrefSettings,
): XingyuanStore {
  return {
    spec: xingyuanDomainSpec,
    domain: guardDomain(domain),
    prefs: readPrefs,
    newId: () => randomUUID(),
    checkinKey: (taskId, date) => `${taskId}|${date}`,
  }
}
