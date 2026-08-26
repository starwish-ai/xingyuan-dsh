/**
 * mount 诊断脚本：Loader + 真实宿主行 + discover/mountPreset + scoped 工具查询。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILE = process.env.XY_PROFILE ?? join(DSH_HOME, 'profiles', 'xytest')
const require_ = createRequire(pathToFileURL(PROFILE + '/x.js').href)
const imp = (spec) => import(pathToFileURL(require_.resolve(spec)).href)

const { Context } = await imp('@deepseek-ai/cordis')
const Loader = (await imp('@deepseek-ai/cordis-plugin-loader')).default
const { discoverPresets, mountPreset } = await imp('@deepseek-ai/dsh-agent-presets')
const { createScope, scopeOf } = await imp('@deepseek-ai/dsh-scope')

const ctx = new Context()
ctx.baseUrl = pathToFileURL(PROFILE + '/').href + '/'
ctx.provide('webServer', { register() {} })
await ctx.plugin(Loader)
const loader = ctx.loader
const mount = async (id, name, config) => { await loader.create({ id, name, config }) }

await mount('storage', '@deepseek-ai/dsh-storage')
await mount('xingyuan-sqlite', '@starwish-ai/dsh/sqlite', { path: ':memory:' })
await mount('storage-domain', '@deepseek-ai/dsh-storage-domain', { backend: 'sqlite', routes: { xingyuan: 'sqlite' } })
await mount('system-prompt', '@deepseek-ai/dsh-system-prompt')
await mount('user-questions', '@deepseek-ai/dsh-user-questions')
await mount('tools', '@deepseek-ai/dsh-tools')
await mount('xingyuan-bundle', '@starwish-ai/dsh')

console.log('host rows ready; xingyuan service =', ctx.xingyuan !== undefined)

const presets = await discoverPresets([{ path: join(DSH_HOME, '.agent-presets'), trust: 'user' }])
const target = presets.find((p) => p?.id === (process.env.XY_PRESET ?? 'xingyuan'))
if (!target) { console.log('not discovered:', presets.map((p) => p?.id)); process.exit(0) }
console.log('found:', target.id)

const scopeHandle = createScope(ctx, 'xy-diag-standing')
try {
  await mountPreset(scopeHandle.ctx, target)
  console.log('MOUNT OK')
  const names = ctx.tools.schemas(scopeOf(scopeHandle.ctx)).map((s) => s.name)
  console.log('scoped tool count:', names.length)
  console.log('has create_wish:', names.includes('create_wish'), '| has check_in_task:', names.includes('check_in_task'))
} catch (error) {
  console.log('MOUNT FAILED:', error.message)
  if (error.cause) console.log('cause:', String(error.cause.stack ?? error.cause).slice(0, 1200))
} finally {
  await scopeHandle.dispose()
}
process.exit(0)
