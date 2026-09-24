/**
 * 包装完整性门禁：package.json 的 exports 子路径与 dsh.bundle.patch 声明的每个
 * 目标文件必须真实存在于构建产物中（CI 顺序 build → test，lib/ 恒先于测试就绪）。
 *
 * 背景：./routes 曾指向不存在的 ./lib/routes.js（实际产物是 lib/routes/index.js），
 * 宿主运行时不走该子路径故未暴露，外部按子路径导入则会直接失败——
 * 用测试锁死「导出声明 ↔ 产物」的一致性，防止再次漂移。
 */
import { existsSync, readdirSync } from 'node:fs'
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
      // 通配目标（如 ./locale/*.json）不能按字面路径存在性判：目录内每个实文件
      // 都要落在该模式内，否则宿主按 `${包名}/locale/<语言>.json` 解析会撞
      // ERR_PACKAGE_PATH_NOT_EXPORTED（插件显示元数据即静默丢失）。
      if (target.includes('*')) {
        const dir = target.split('/*')[0] ?? ''
        const suffix = target.slice(target.indexOf('*') + 1)
        const absolute = fileURLToPath(new URL(`../${dir.replace(/^\.\//, '')}/`, import.meta.url))
        const pattern = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
        const files = readdirSync(absolute).filter((name) => name.endsWith(suffix))
        expect(files.length, `通配目标目录内无匹配文件：${dir}`).toBeGreaterThan(0)
        for (const name of files) {
          expect(pattern.test(`${dir}/${name}`), `目录内文件未被模式覆盖：${dir}/${name}`).toBe(true)
        }
        continue
      }
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
