import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { makeXingyuanStore, xingyuanDomainSpec } from '../src/domain.js'
import { PREF_DEFAULTS } from '../src/pref-policy.js'
import { registerSqliteBackend } from '../src/sqlite.js'

const ctx = new Context()
new Storage(ctx)
const fiber = await ctx.plugin({
  name: 'test-sqlite',
  apply: (c) => registerSqliteBackend(c, ':memory:'),
})
console.log('plugin mounted:', typeof fiber)
const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
const domain = await facility.open(xingyuanDomainSpec)
// 探针不装载 settings 服务，偏好读取退化为常量（与生产端缺席时的行为一致）
const store = makeXingyuanStore(domain, () => PREF_DEFAULTS)
await store.domain.table('wishes').put('w1', {
  wishId: 'w1', title: '测试愿望', categoryName: '学习', progress: 0,
  totalRequiredDays: 0, totalCompletedDays: 0, archived: false, createdAt: '2026-08-23T00:00:00',
})
console.log('read back:', store.domain.table('wishes').get('w1')?.title)
// global roundtrip
await store.domain.global.set({ coachStyle: 'strict', profile: { nickname: '小明' } })
console.log('global:', store.domain.global.get())
// dispose → backend unregistered
await fiber.dispose()
try {
  ctx.storage.backend.get('sqlite')
  console.log('backend still registered: FAIL')
} catch (e) {
  console.log('backend unregistered after dispose: OK —', e instanceof Error ? e.message : e)
}
