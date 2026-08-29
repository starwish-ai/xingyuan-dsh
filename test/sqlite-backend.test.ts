/**
 * sqlite 后端数据安全门禁（评审结论落地）：
 * 无迁移机制（DOMAIN_VERSION 策略）的安全底座 = 介质版本门禁 + 损坏介质拒绝——
 * 此前零测试覆盖，回归会静默打开 v-future 介质并写坏它。直接对 StorageBackend 契约
 * 单测（不经 storageDomain，构造 KvUnitDescriptor 即可）。
 *
 * 后端生命周期事实（由实现决定，测试如实对拍）：同一后端实例对同一 unit 只允许
 * open 一次（open-set 防重入，unit.close() 是空操作）——「重开」必须整后端关闭后
 * 换新实例挂同一 DB 文件（这恰好就是「进程重启后冷读」的真实形态）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
// 类型副作用：storage 服务的 Context 声明合并
import type {} from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { registerSqliteBackend } from '../src/sqlite.js'

function descriptor(version: number): KvUnitDescriptor {
  return { name: 'xingyuan', version, tables: ['wishes'], hasGlobal: true }
}

/** 装配官方 storage hub + 手挂 sqlite 后端（与 loader 组合同一装配口径的最小面）。 */
async function mountBackend(path: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Loader)
  await ctx.loader.create({ id: 'storage', name: '@deepseek-ai/dsh-storage' } as Parameters<Loader['create']>[0])
  registerSqliteBackend(ctx, path)
  return ctx
}

/** 卸载 sqlite 行（触发 effect：注销后端并关闭 DB，open-set 清空）。 */
async function unmountBackend(ctx: Context): Promise<void> {
  try { await ctx.loader.remove('xingyuan-sqlite') } catch {}
  try { await ctx.loader.remove('storage') } catch {}
}

describe('sqlite 后端门禁', () => {
  let workDir: string
  const contexts: Context[] = []

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'xy-sqlite-'))
  })

  afterAll(async () => {
    for (const ctx of contexts) await unmountBackend(ctx)
  })

  it('落盘即持久：写入 → 进程态关闭 → 冷开（新后端实例挂同一文件）可见', async () => {
    const path = join(workDir, 'persist.sqlite')
    const writer = await mountBackend(path)
    contexts.push(writer)
    const unit = await writer.storage.backend.get('sqlite')!.kv!.open(descriptor(1))
    await unit.putRecord('wishes', 'w1', { wishId: 'w1', title: '持久化' })
    await unmountBackend(writer)

    const reader = await mountBackend(path)
    contexts.push(reader)
    const cold = await reader.storage.backend.get('sqlite')!.kv!.open(descriptor(1))
    const tables = await cold.loadAll()
    expect((tables.tables['wishes'] ?? {})['w1']).toMatchObject({ title: '持久化' })
  })

  it('版本门禁：介质版本与 spec 不符直接拒绝打开（无迁移策略的闸门）', async () => {
    const path = join(workDir, 'version.sqlite')
    const stamper = await mountBackend(path)
    contexts.push(stamper)
    // 以 version 9 首开戳介质版本，随后整后端关闭（模拟升级前的旧进程退出）
    await stamper.storage.backend.get('sqlite')!.kv!.open(descriptor(9))
    await unmountBackend(stamper)

    // 新进程以 v1 spec 打开 v9 介质：必须被版本门禁拒绝，而非静默打开
    const opener = await mountBackend(path)
    contexts.push(opener)
    await expect(opener.storage.backend.get('sqlite')!.kv!.open(descriptor(1))).rejects.toThrow(/version/)
  })

  it('损坏介质：global 槽非 JSON 时拒绝（malformed-medium），不静默当空数据', async () => {
    const path = join(workDir, 'corrupt.sqlite')
    const ctx = await mountBackend(path)
    contexts.push(ctx)
    const backend = ctx.storage.backend.get('sqlite')!
    const unit = await backend.kv!.open(descriptor(1))
    await unit.setGlobal({ coachStyle: 'gentle', profile: {} })
    // 第二连接直改库：把 global 槽写成非法 JSON（模拟介质损坏/手改文件）
    const db = new DatabaseSync(path)
    db.prepare('UPDATE xingyuan_meta SET global = ? WHERE unit = ?').run('{not-json', 'xingyuan')
    db.close()
    await expect(unit.loadAll()).rejects.toThrow(/global slot is not valid JSON/)
  })

  it('损坏介质：表行非 JSON 时同样报 malformed-medium（与 global 槽同一排障口径）', async () => {
    const path = join(workDir, 'corrupt-row.sqlite')
    const ctx = await mountBackend(path)
    contexts.push(ctx)
    const backend = ctx.storage.backend.get('sqlite')!
    const unit = await backend.kv!.open(descriptor(1))
    await unit.putRecord('wishes', 'w1', { wishId: 'w1', title: '完好行' })
    // 第二连接直改库：把表行写成非法 JSON（模拟介质损坏/手改文件）——此前裸
    // JSON.parse 抛 SyntaxError，与 global 槽的 malformed-medium 报错形态分裂
    const db = new DatabaseSync(path)
    db.prepare('UPDATE u_xingyuan_wishes SET value = ? WHERE key = ?').run('{not-json', 'w1')
    db.close()
    const err = await unit.loadAll().then(() => undefined, (e: unknown) => e)
    expect((err as Error).message).toMatch(/record 'w1' is not valid JSON/)
    expect((err as { code?: string }).code).toBe('malformed-medium')
  })
})
