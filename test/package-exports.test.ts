/**
 * 包装完整性门禁：package.json 的 exports 子路径与 dsh.bundle.patch 声明的每个
 * 目标文件必须真实存在于构建产物中（CI 顺序 build → test，lib/ 恒先于测试就绪）。
 *
 * 背景：./routes 曾指向不存在的 ./lib/routes.js（实际产物是 lib/routes/index.js），
 * 宿主运行时不走该子路径故未暴露，外部按子路径导入则会直接失败——
 * 用测试锁死「导出声明 ↔ 产物」的一致性，防止再次漂移。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as {
  exports: Record<string, unknown>
  dsh?: { bundle?: { patch?: string } }
}

describe('package.json 导出声明与构建产物一致', () => {
  it('exports 每个目标文件都存在', () => {
    const targets: string[] = []
    const walk = (value: unknown): void => {
      if (typeof value === 'string') targets.push(value)
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
    }
    Object.values(pkg.exports).forEach(walk)
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      if (target === './package.json') continue
      const resolved = fileURLToPath(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url))
      expect(existsSync(resolved), `exports 目标不存在：${target}`).toBe(true)
    }
  })

  it('dsh.bundle.patch 指向的补丁文件存在', () => {
    const patch = pkg.dsh?.bundle?.patch
    expect(patch, '缺少 dsh.bundle.patch 声明').toBeTruthy()
    const resolved = fileURLToPath(new URL(`../${patch!.replace(/^\.\//, '')}`, import.meta.url))
    expect(existsSync(resolved), `bundle patch 不存在：${patch}`).toBe(true)
  })
})
