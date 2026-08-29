/**
 * sqlite KV 后端：dsh-storage StorageBackend 契约的 node:sqlite 实现。
 *
 * 物理布局：一个 DB 文件；`xingyuan_meta(unit, version)` 戳介质版本并承载 global 槽；
 * 每张声明表一张物理表 `u_<unit>_<table>`（key TEXT PRIMARY KEY, value TEXT JSON）。
 * node:sqlite 同步写 + WAL；写入即持久（putRecord resolve 后崩溃重开可见）。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'

function expandHome(p: string): string {
  return p.startsWith('~') ? homedir() + p.slice(1) : p
}

interface MetaRow {
  version?: number
  global?: string | null
}

/** 打开的单元：内存直读快照由每次同步查询承担（node:sqlite 同步 API，无 await 分叉）。 */
class SqliteKvUnit implements KvUnit {
  constructor(
    private readonly db: DatabaseSync,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onDirty: () => void,
  ) {}

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const table of this.descriptor.tables) {
      const rows = this.db.prepare(`SELECT key, value FROM "${this.physical(table)}"`).all() as { key: string; value: string }[]
      const records: Record<string, unknown> = {}
      for (const row of rows) {
        // 行值损坏与 global 槽同一报错形态（malformed-medium）：此前裸 JSON.parse
        // 抛 SyntaxError，排障口径分裂
        try {
          records[row.key] = JSON.parse(row.value)
        } catch {
          throw new StorageError('malformed-medium', `unit '${this.descriptor.name}' table '${table}' record '${row.key}' is not valid JSON`)
        }
      }
      tables[table] = records
    }
    return { tables, global: this.readGlobal() }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertTable(table)
    this.db.prepare(`INSERT INTO "${this.physical(table)}" (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, JSON.stringify(value))
    this.onDirty()
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertTable(table)
    this.db.prepare(`DELETE FROM "${this.physical(table)}" WHERE key = ?`).run(key)
    this.onDirty()
  }

  async setGlobal(value: unknown): Promise<void> {
    if (!this.descriptor.hasGlobal) throw new StorageError('malformed-medium', `unit '${this.descriptor.name}' declared no global slot`)
    this.db.prepare('INSERT INTO xingyuan_meta (unit, version, global) VALUES (?, ?, ?) ON CONFLICT(unit) DO UPDATE SET global = excluded.global')
      .run(this.descriptor.name, this.descriptor.version, value === undefined ? null : JSON.stringify(value))
    this.onDirty()
  }

  async close(): Promise<void> {}

  private physical(table: string): string {
    return `u_${this.descriptor.name}_${table}`
  }

  private assertTable(table: string): void {
    if (!UNIT_NAME_RE.test(table) || !this.descriptor.tables.includes(table)) {
      throw new StorageError('malformed-medium', `table '${table}' is not declared in unit '${this.descriptor.name}'`)
    }
  }

  private readGlobal(): unknown {
    const row = this.db.prepare('SELECT global FROM xingyuan_meta WHERE unit = ?').get(this.descriptor.name) as MetaRow | undefined
    if (row?.global == null) return null
    try {
      return JSON.parse(row.global)
    } catch {
      throw new StorageError('malformed-medium', `unit '${this.descriptor.name}' global slot is not valid JSON`)
    }
  }
}

class SqliteBackend implements StorageBackend {
  readonly kv: KvFacet
  private db: DatabaseSync | null = null
  private readonly open = new Set<string>()
  private closed = false

  constructor(readonly path: string) {
    this.kv = {
      open: async (descriptor) => this.openUnit(descriptor),
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.open.clear()
    this.closed = true
  }

  private touch(): DatabaseSync {
    if (this.closed) throw new StorageError('closed', 'backend already closed')
    if (this.db) return this.db
    this.db = new DatabaseSync(this.path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('CREATE TABLE IF NOT EXISTS xingyuan_meta (unit TEXT PRIMARY KEY, version INTEGER NOT NULL, global TEXT)')
    return this.db
  }

  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      throw new StorageError('malformed-medium', `invalid unit name '${descriptor.name}'`)
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        throw new StorageError('malformed-medium', `invalid table name '${table}' in unit '${descriptor.name}'`)
      }
    }
    if (this.open.has(descriptor.name)) {
      throw new StorageError('malformed-medium', `unit '${descriptor.name}' is already open on this backend`)
    }
    const db = this.touch()
    const stamped = db.prepare('SELECT version FROM xingyuan_meta WHERE unit = ?').get(descriptor.name) as { version?: number } | undefined
    if (stamped && stamped.version !== descriptor.version) {
      throw new StorageError('version-mismatch', `unit '${descriptor.name}' medium version ${stamped.version} != spec ${descriptor.version}`)
    }
    // 无迁移机制：版本一开始定死（v1），不符直接拒绝。
    db.prepare('INSERT INTO xingyuan_meta (unit, version) VALUES (?, ?) ON CONFLICT(unit) DO NOTHING').run(descriptor.name, descriptor.version)
    for (const table of descriptor.tables) {
      db.exec(`CREATE TABLE IF NOT EXISTS "u_${descriptor.name}_${table}" (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    }
    this.open.add(descriptor.name)
    return new SqliteKvUnit(db, descriptor, () => {})
  }
}

/** Cordis 插件名。 */
export const name = 'xingyuan-sqlite'

/** 只依赖 storage hub；绝不反向依赖 storageDomain（会与领域设施互相等待形成死锁）。 */
export const inject = ['storage']

/** 插件配置。 */
export interface Config {
  path: string
}

export const Config: z<Config> = z.object({
  path: z.string().default('~/.dsh/xingyuan/xingyuan.sqlite'),
})

/** 独立行挂载入口。 */
export function apply(ctx: Context, config: Config): void {
  registerSqliteBackend(ctx, config.path)
}

/** 注册后端本体（供独立 apply 与测试复用）。 */
export function registerSqliteBackend(ctx: Context, path: string): void {
  const file = expandHome(path)
  // 目录必须在激活期同步就绪：领域 open 可能在事件循环下一拍触发 touch()，
  // 异步 mkdir 会与首次建库竞态（冷启动 ENOENT）
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    // 目录创建失败时不阻断挂载；打开阶段会以更明确的存储错误暴露
  }
  const backend = new SqliteBackend(file)
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register('sqlite', backend)
    return async () => {
      unregister()
      await backend.close()
    }
  })
  ctx.provide(storageBackendServiceKey('sqlite'), backend)
}
