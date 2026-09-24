/**
 * 插件显示元数据门禁（dsh 官方约定：`@deepseek-ai/dsh-agent-preset` 的
 * skills/cordis-plugin-development/references/host-plugin.md「Display metadata and icon」）。
 *
 * 后果说明：宿主读这些元数据时**不激活插件**，且把「解析不到资源」当成「没有元数据」
 * （missingResource 只认 ERR_PACKAGE_PATH_NOT_EXPORTED / MODULE_NOT_FOUND / ENOENT 等），
 * 所以 exports 少一条 `./locale/*.json`、locale 文件名不是语言 id、icon 越界——
 * 全都表现为「插件管理卡与设置页插件列表回落到包名 + 默认图」，无报错。故机械锁死。
 *
 * 判定参数逐字取自宿主实现（安装副本 @deepseek-ai/dsh-app-boot/lib/index.js 的
 * package-meta 段）：LANGUAGE_ID、MAX_ICON_BYTES=256*1024、ICON_MEDIA_TYPES、
 * `${specifier}/locale/en.json` 的解析方式、以及「语言文件须与 en 同目录」这条硬校验。
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  name: string
  icon?: string
  files: string[]
  exports: Record<string, string>
}

/** 宿主的语言 id 文件名规则。 */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u
/** 宿主的 icon 体积上限与媒体类型表。 */
const MAX_ICON_BYTES = 256 * 1024
const MEDIA_TYPES = ['.svg', '.png', '.jpg', '.jpeg', '.webp']

const localeDir = join(pkgRoot, 'locale')
const localeFiles = existsSync(localeDir)
  ? readdirSync(localeDir).filter((name) => name.endsWith('.json')).sort()
  : []

describe('插件显示元数据符合宿主读取契约（icon + locale meta）', () => {
  it('icon 声明为包内相对路径、扩展名受支持、不超 256 KiB、且自包含', () => {
    const icon = pkg.icon
    expect(typeof icon === 'string' && icon.length > 0, 'package.json 缺顶层 icon 字段').toBe(true)
    expect(/^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon!), 'icon 不得是 URL/绝对路径').toBe(false)
    expect(icon!.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(icon!), 'icon 不得是绝对路径').toBe(false)
    const file = resolve(pkgRoot, icon!)
    const inside = relative(pkgRoot, file)
    // 宿主的判据（package-meta.js iconOf）：realpath 后仍在清单目录内——
    // 相对路径既不能是空（指回目录本身）、不能以 .. 越出、也不能是绝对路径
    expect(inside !== '' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside),
      `icon 必须留在包目录内：${icon}`).toBe(true)
    expect(MEDIA_TYPES).toContain(file.slice(file.lastIndexOf('.')).toLowerCase())
    const stat = statSync(file)
    expect(stat.isFile(), 'icon 必须是普通文件').toBe(true)
    expect(stat.size, `icon 超过 ${MAX_ICON_BYTES} 字节`).toBeLessThanOrEqual(MAX_ICON_BYTES)

    if (file.toLowerCase().endsWith('.svg')) {
      const text = readFileSync(file, 'utf8')
      expect(text, 'SVG icon 需自带 xmlns（data URI 内联进 <img>）')
        .toMatch(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
      expect(text, 'SVG icon 不得含 <script>').not.toMatch(/<script/i)
      expect(text, 'SVG icon 不得引外部资源').not.toMatch(/(xlink:href|href)=["']?(https?:|file:)/i)
      expect(text, 'SVG icon 不得用外部字体渲染文字（文字在 data URI 里不可靠）').not.toMatch(/<text|<font/i)
    }
  })

  it('locale/*.json 每个文件名都是语言 id，且 meta.title / meta.description 非空', () => {
    expect(localeFiles.length, 'locale/ 目录缺失或无 json').toBeGreaterThan(0)
    expect(localeFiles).toContain('en.json')
    for (const name of localeFiles) {
      expect(LANGUAGE_ID.test(name.slice(0, -5)), `${name} 文件名必须是语言 id`).toBe(true)
      const parsed = JSON.parse(readFileSync(join(localeDir, name), 'utf8')) as { meta?: Record<string, unknown> }
      const keys = Object.keys(parsed)
      expect(keys, `${name} 顶层只应有一个 meta 节（宿主只读 meta）`).toEqual(['meta'])
      for (const field of ['title', 'description'] as const) {
        const value = parsed.meta?.[field]
        expect(typeof value === 'string' && value.trim().length > 0, `${name}: meta.${field} 必须是非空字符串`).toBe(true)
      }
    }
  })

  it('exports 与 files 收录了资源（发包后宿主才解析得到）', () => {
    const pattern = Object.entries(pkg.exports).find(([key]) => key.startsWith('./locale/'))
    expect(pattern, 'exports 未暴露 ./locale/*.json → 宿主解析即 ERR_PACKAGE_PATH_NOT_EXPORTED').toBeTruthy()
    expect(pattern![1]).toMatch(/^\.\/locale\/\*\.json$/)
    expect(pkg.exports['./package.json'], 'exports 须含 ./package.json（宿主从 manifest 读 icon）').toBe('./package.json')
    for (const name of localeFiles) {
      expect(pkg.files.some((entry) => entry === 'locale/*.json' || entry === `locale/${name}`),
        `files 未收录 locale/${name}（npm 发包会漏）`).toBe(true)
    }
    expect(pkg.files.some((entry) => entry === pkg.icon?.replace(/^\.\//, '')), 'files 未收录 icon').toBe(true)
  })

  describe('按宿主方式解析：临时 consumer 包经 node_modules 链接指向本包', () => {
    const consumerDir = mkdtempSync(join(tmpdir(), 'xy-meta-consumer-'))

    beforeAll(() => {
      // 官方 practices.md 对临时资源的要求：唯一自有目录、有界执行、afterAll 清理
      writeFileSync(join(consumerDir, 'package.json'), '{"name":"consumer","private":true,"type":"module"}')
      const ownerDir = join(consumerDir, 'node_modules', ...pkg.name.split('/').slice(0, -1))
      mkdirSync(ownerDir, { recursive: true })
      symlinkSync(pkgRoot, join(ownerDir, pkg.name.split('/').at(-1)!), process.platform === 'win32' ? 'junction' : 'dir')
    })

    afterAll(() => {
      rmSync(consumerDir, { recursive: true, force: true, maxRetries: 3 })
    })

    it(`${pkg.name}/package.json 与 /locale/<语言>.json 全部解析到包内真实文件`, () => {
      const consumerRequire = createRequire(join(consumerDir, 'entry.js'))
      expect(consumerRequire.resolve(`${pkg.name}/package.json`)).toBe(join(pkgRoot, 'package.json'))
      for (const name of localeFiles) {
        expect(consumerRequire.resolve(`${pkg.name}/locale/${name}`), `${name} 未被 exports 模式覆盖`)
          .toBe(join(localeDir, name))
      }
      // 宿主按 en.json 所在目录枚举语言文件：目录里不得混入非语言 id 的 json
      const enDir = dirname(consumerRequire.resolve(`${pkg.name}/locale/en.json`) as string)
      expect(readdirSync(enDir).filter((name) => name.endsWith('.json')).length).toBe(localeFiles.length)
    })
  })
})
