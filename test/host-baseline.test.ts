/**
 * 宿主版本闸门对拍门禁（dsh 0.1.7-rc.1 新增机制，本仓库的响亮拦截防线）。
 *
 * 背景：rc.1 起 dsh 在装配前按包声明的 peerDependencies 校验宿主版本——
 * `dsh-app-boot` 的 `evaluatePluginCompatibility` 对每个 `@deepseek-ai/dsh` /
 * `@deepseek-ai/dsh-*` peer 跑 `semver.satisfies(宿主版本, 范围, { includePrerelease: true })`，
 * 不符者**整包静默跳过**（真机已见第三方包因此消失），豁免走 profile 的
 * compatibility.json + `dsh plugin allow-version`。这推翻了此前「peer 不是闸门」的记录：
 * 现在 peer 范围是唯一能在装/启阶段拦下不兼容升级的机制——而它**只看声明出来的 peer**。
 *
 * 本文件锁三件事：
 * 1. 每个 dsh-* peer 的范围必须被 devDependencies 钉住的那一版满足（否则 typecheck
 *    校的不是用户跑的那版，且范围本身写错）；
 * 2. node_modules 里真实解析到的版本 == 钉住版本（防锁文件漂到别代）；
 * 3. peer 集合必须覆盖「补丁里点名的宿主包 + dsh.client.inject 点名的宿主包」——
 *    client 半侧正是 0.1.7-alpha.2→rc.1 唯一真变了代码的那一半，漏声明即闸门不覆盖它。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CORE_SCHEMA, Type, load } from 'js-yaml'
import semver from 'semver'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const pkg = require('../package.json') as {
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
  dsh?: { client?: { inject?: string[] } }
}

/** 受闸门校验的 peer：宿主只查 @deepseek-ai/dsh 与 @deepseek-ai/dsh-* 两类键。 */
const gatedPeers = Object.entries(pkg.peerDependencies)
  .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))

/**
 * 用宿主补丁的方言读 cordis.patch.yml（`!!js` 与本测试无关，读成不透明表达式节点即可，
 * 与 test/preset-declaration.test.ts 同一套加载器）。
 */
const jsExprType = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data: string) => ({ __jsExpr: data }),
})

/** cordis.patch.yml 里以 name: 点名的宿主包（组合层依赖，与代码 import 同等真实）。 */
function patchedHostPackages(): string[] {
  const text = readFileSync(join(pkgRoot, 'cordis.patch.yml'), 'utf8')
  const document = load(text, { schema: CORE_SCHEMA.extend([jsExprType]) }) as unknown
  const names: string[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record.name === 'string') names.push(record.name)
      Object.values(record).forEach(walk)
    }
  }
  walk(document)
  return names
}

/** src/ 全量源码文本（host 与 client 两半侧的 import / declare module 都在里面）。 */
const allSource = readdirSync(join(pkgRoot, 'src'), { recursive: true })
  .filter((name): name is string => typeof name === 'string' && name.endsWith('.ts'))
  .map((name) => readFileSync(join(pkgRoot, 'src', name), 'utf8'))
  .join('\n')

function installedVersion(name: string): string {
  return require(`${name}/package.json`).version as string
}

describe('dsh 版本闸门对拍（peer 范围 ↔ 钉住版本 ↔ 实装版本）', () => {
  it('peer 列表非空且全部为受闸门校验的 dsh 包', () => {
    expect(gatedPeers.length).toBeGreaterThan(0)
  })

  it('每个 dsh-* peer 的范围被 devDependencies 钉住的那一版满足', () => {
    for (const [name, range] of gatedPeers) {
      const pinned = pkg.devDependencies[name]
      expect(pinned, `peer ${name} 缺 devDependencies 精确钉版`).toBeTruthy()
      expect(
        semver.satisfies(pinned!, range, { includePrerelease: true }),
        `peer ${name} 范围 ${range} 不被钉住版本 ${pinned} 满足`,
      ).toBe(true)
    }
  })

  it('node_modules 实装版本与 devDependencies 钉版一致（typecheck 面 == 发布声明面）', () => {
    for (const [name, range] of gatedPeers) {
      const installed = installedVersion(name)
      expect(installed, `${name} 实装 ${installed} != 钉住 ${pkg.devDependencies[name]}`)
        .toBe(pkg.devDependencies[name])
      expect(range).toMatch(/^\^\d+\.\d+\.\d+/)
    }
  })

  it('补丁与 client inject 点名的宿主包全部进了 peer（闸门覆盖面 = 真实依赖面）', () => {
    const declared = new Set(Object.keys(pkg.peerDependencies))
    const injected = pkg.dsh?.client?.inject ?? []
    expect(injected.length, '缺少 dsh.client.inject 声明').toBeGreaterThan(0)
    for (const name of [...patchedHostPackages(), ...injected]) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      expect(declared.has(name), `${name} 被本包点名使用，却未声明为 peer（不受闸门保护）`).toBe(true)
    }
  })

  it('不得虚标：每个 dsh-* peer 都被源码 import、补丁/inject 点名，或对应 inject 的服务键', () => {
    const used = new Set<string>([...patchedHostPackages(), ...(pkg.dsh?.client?.inject ?? [])])
    // 服务接缝型依赖（如 dsh-system-prompt：只用 ctx.systemPrompt，无值导入）的合法证据
    // 是对应的服务键出现在某个 inject 清单里——dsh 的服务键即包名的驼峰形式。
    const serviceKeys = [...allSource.matchAll(/inject\s*=\s*\[([^\]]*)\]/g)]
      .flatMap((match) => [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((item) => item[1]))
    const camel = (name: string): string => name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
    for (const [name] of gatedPeers) {
      const shortName = name.replace('@deepseek-ai/dsh-', '')
      const referenced = allSource.includes(name) || used.has(name) || serviceKeys.includes(camel(shortName))
      expect(referenced, `peer ${name} 既无源码引用、也不被补丁/inject/服务键证实（虚标）`).toBe(true)
    }
  })
})
