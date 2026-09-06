/**
 * 客户端样式兼容契约（机械门禁，评审结论落地）：
 *
 * 1. color-mix() 全面禁令：dsh 壳的浏览器矩阵存在不支持 color-mix 的环境，凡用它的
 *    属性按无效处理（空态线稿曾整体隐形）。STYLE_TEXT 与 gen-mock 产物都不得出现。
 * 2. 半透明衍生色只允许出现在令牌区（STYLE_TEXT 的 :root / 深色覆盖块，即
 *    「会话卡片」分段注释之前）：正文区一律引用 --xyd-* 令牌，防止单值透明度
 *    两主题共用导致深色下语义洗色不可见（打卡卡绿洗曾因此近乎消失）。
 *
 * mock 产物断言需要 debug/gen-mock.ts 可导入：它 import STYLE_TEXT 并写文件，
 * 在 vitest node 环境可直接 import 后调内部生成逻辑——gen-mock 未导出 html()，
 * 故此处直接读 STYLE_TEXT 断言 + 运行 vite-node 产物的替代方案：断言源码本身
 * 不含 color-mix（gen-mock 的 markup 由同一文件维护，源码无 color-mix 即产物无）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STYLE_TEXT } from '../src/client/styles.js'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 令牌区终点标记：此注释之后不允许再出现 rgba( 字面量。 */
const TOKEN_ZONE_END = '/* ===== 会话卡片'

describe('客户端样式兼容契约', () => {
  it('STYLE_TEXT 不含 color-mix()（兼容铁律）', () => {
    expect(STYLE_TEXT.includes('color-mix(')).toBe(false)
  })

  it('半透明衍生色只在令牌区出现，正文区一律引用令牌', () => {
    const endIndex = STYLE_TEXT.indexOf(TOKEN_ZONE_END)
    expect(endIndex).toBeGreaterThan(0)
    const body = STYLE_TEXT.slice(endIndex)
    const offenders: string[] = []
    let index = body.indexOf('rgba(')
    while (index >= 0) {
      const lineStart = body.lastIndexOf('\n', index) + 1
      const lineEnd = body.indexOf('\n', index)
      offenders.push(body.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim())
      index = body.indexOf('rgba(', index + 1)
    }
    expect(offenders).toEqual([])
  })

  it('debug/gen-mock.ts 源码不含 color-mix()（mock 是真实样式的验证器，不得自带违禁样式）', () => {
    const genMock = readFileSync(join(pkgRoot, 'debug', 'gen-mock.ts'), 'utf8')
    expect(genMock.includes('color-mix(')).toBe(false)
  })

  it('关键语义令牌在浅/深两主题都有定义（防新增令牌漏配深色档）', () => {
    for (const token of [
      '--xyd-accent', '--xyd-accent-strong', '--xyd-danger', '--xyd-warn', '--xyd-ok',
      '--xyd-label-on-2', '--xyd-ok-soft', '--xyd-ok-border', '--xyd-warn-soft',
      '--xyd-warn-border', '--xyd-ok-badge', '--xyd-shadow-card', '--xyd-shadow-toast',
      '--xyd-shadow-modal', '--xyd-hover', '--xyd-mask', '--xyd-on-c2', '--xyd-on-c3',
      '--xyd-on-dcell', '--xyd-on-warn',
    ]) {
      const light = STYLE_TEXT.includes(`${token}:`)
      const dark = STYLE_TEXT.includes(`body[data-ds-dark-theme]{`)
      expect(light, `${token} 浅色档缺失`).toBe(true)
      // 深色块整体存在性 + 该令牌在深色块内出现
      const darkStart = STYLE_TEXT.indexOf('body[data-ds-dark-theme]{')
      expect(dark, '深色令牌块缺失').toBe(true)
      const darkEnd = STYLE_TEXT.indexOf('}', darkStart)
      const darkBlock = STYLE_TEXT.slice(darkStart, darkEnd)
      expect(darkBlock.includes(`${token}:`), `${token} 深色档缺失`).toBe(true)
    }
  })

  it('warn-soft 底的前景对达标：--xyd-on-warn 复合底在浅/深两主题均 ≥4.5:1（WCAG 1.4.3，StaleBanner 文字）', () => {
    const darkStart = STYLE_TEXT.indexOf('body[data-ds-dark-theme]{')
    const lightBlock = STYLE_TEXT.slice(0, darkStart)
    const darkBlock = STYLE_TEXT.slice(darkStart, STYLE_TEXT.indexOf('}', darkStart))

    const tokenValue = (block: string, name: string): string => {
      const match = block.match(new RegExp(`${name}:([^;]+);`))
      expect(match, `${name} 未找到`).not.toBeNull()
      return match![1]!.trim()
    }
    const parseRgb = (value: string): [number, number, number] => {
      if (value.startsWith('#')) {
        const h = value.slice(1)
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
      }
      const nums = value.match(/[\d.]+/g)!.map(Number)
      return [nums[0]!, nums[1]!, nums[2]!]
    }
    const composite = (fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] =>
      [0, 1, 2].map((i) => Math.round(fg[i]! * alpha + bg[i]! * (1 - alpha))) as [number, number, number]
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const lin = [r, g, b].map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
    }
    const contrast = (a: [number, number, number], b: [number, number, number]): number => {
      const sorted = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (sorted[0]! + 0.05) / (sorted[1]! + 0.05)
    }

    // 底色假设 = debug/gen-mock.ts SHELL_LIGHT/SHELL_DARK 的 bg-layer-1 替身值
    // （仓库声明的壳观感基准）：StaleBanner 挂在宿主页面底上，替身值即审计口径。
    const scenarios = [
      { theme: '浅色', layer: [255, 255, 255] as [number, number, number], block: lightBlock },
      { theme: '深色', layer: [31, 39, 49] as [number, number, number], block: darkBlock },
    ]
    for (const { theme, layer, block } of scenarios) {
      const warnSoft = tokenValue(block, '--xyd-warn-soft')
      const onWarn = parseRgb(tokenValue(block, '--xyd-on-warn'))
      const nums = warnSoft.match(/[\d.]+/g)!.map(Number)
      const bg = composite([nums[0]!, nums[1]!, nums[2]!], nums[3]!, layer)
      const ratio = contrast(onWarn, bg)
      expect(ratio, `${theme} on-warn 对 warn-soft 复合底 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
