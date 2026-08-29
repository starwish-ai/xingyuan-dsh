/** 成长页：等级英雄卡 + 七项统计 + 近 30 天柱状图（悬浮明细/全勤高亮/图例）+ 等级说明。 */
import { createElement, useState, type ReactElement } from 'react'
import { useXyT, activeLocale, type XyKey } from '../i18n.js'
import { t as translate } from '../i18n.js'
import { recentRangeDays, usePageData, useScrollTopOnMount, useStableScrollbar } from '../hooks.js'
import { PageError, PageSkeleton, StaleBanner } from '../ui.js'
import { formatShortDate } from './format.js'
import type { GrowthPayload, RangePayload } from './types.js'
/**
 * 等级色阶（Lv.1 灰 → Lv.10 玫瑰红）：全部选用深色档（slate-600 → rose-700），
 * 白字对比 ≥4.5:1，深浅两种壳主题下都成立；standalone /xingyuan/growth 页内联同表。
 */
const LEVEL_TINTS = ['#475569', '#2563eb', '#047857', '#0e7490', '#0369a1', '#1d4ed8', '#6d28d9', '#b45309', '#c2410c', '#be123c'] as const

function levelTint(level: number): string {
  return LEVEL_TINTS[Math.min(LEVEL_TINTS.length, Math.max(1, level)) - 1] ?? LEVEL_TINTS[0]
}

/** 按比例调暗 #RRGGBB 色值（等价于 color-mix(in srgb, tint ratio%, #000)）。
 * 用 JS 预混而非 CSS color-mix()：后者在不支持的浏览器里整条声明失效（AGENTS.md §5.10 兼容铁律）。 */
export function darkenHex(hex: string, ratio: number): string {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift: number): number => Math.round(((value >> shift) & 0xff) * ratio)
  return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1)}`
}

/**
 * 等级词本地化：服务端 LEVEL_CONFIGS 是中文权威源（zh 值与 growth.lv.N.* 逐字一致，
 * test 锁定）；客户端按等级序号取词，未知序号（未来扩级）回落服务端原文。
 */
function levelNameKey(level: number): XyKey {
  return `growth.lv.${level}.name` as XyKey
}
function levelRewardKey(level: number): XyKey {
  return `growth.lv.${level}.reward` as XyKey
}
function localLevelName(level: number, fallback: string | undefined): string {
  const dict = translate(levelNameKey(level))
  // 键缺词时 t() 回落键名本身——zh 词表覆盖 1-10，命中即用；否则用服务端原文；
  // 两者皆缺（未知等级且服务端未带名）落到词典兜底键，读屏不再得到空等级名
  return dict !== levelNameKey(level) ? dict : (fallback ?? translate('growth.levelFallback'))
}
function localLevelReward(level: number, fallback: string | undefined): string {
  const dict = translate(levelRewardKey(level))
  return dict !== levelRewardKey(level) ? dict : fallback ?? ''
}

export function GrowthPage(): ReactElement {
  const t = useXyT()
  const stabilize = useStableScrollbar()
  useScrollTopOnMount()
  const growth = usePageData<GrowthPayload>('/xingyuan/api/growth')
  const range = usePageData<RangePayload>(() => {
    const { start, end } = recentRangeDays(30)
    return `/xingyuan/api/range?start=${start}&end=${end}`
  }, [])
  // 悬停列数据源（null = 未悬停）
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // 整页错误只看主端点：区间图失败不拖垮已加载的英雄卡与统计——
  // 图表区自带「错误 + 重试」分支（下方），两路状态各自闭环
  const error = growth.error
  const reload = (): void => { growth.reload(); range.reload() }
  if (error !== undefined && growth.data === undefined) return createElement(PageError, { message: error, onRetry: reload })
  if (growth.data === undefined) return createElement(PageSkeleton)
  const g = growth.data
  const r = range.data

  // 图表构建是普通渲染期函数（30 列量级，无需 memo）。注意：绝不能放在下方早退之后
  // 以 Hook 形式出现——骨架屏首渲染会跳过它，数据到达后 Hook 数量变多，React 会直接
  // 卸载整棵树（表现为整页空白）。
  const chart = ((): {
    cols: ReadonlyArray<ReactElement>
    ticks: ReadonlyArray<ReactElement | null>
    days: RangePayload['days']
  } | null => {
    if (r === undefined) return null
    const max = Math.max(...r.days.map((day) => day.total), 1)
    const count = r.days.length
    const cols = r.days.map((day, i) => {
      // 微值可见性下限：有数据但按比例不足 2% 的段给 2%，避免「有记录却看不见」；
      // 缺口段封顶 100-h，两段取整叠加不会溢出柱体
      const h = day.checked > 0 ? Math.max(Math.round((day.checked / max) * 100), 2) : 0
      const missed = day.total - day.checked
      const mh = missed > 0 ? Math.min(Math.max(Math.round((missed / max) * 100), 2), 100 - h) : 0
      const full = day.total > 0 && day.checked >= day.total
      return createElement('button', {
        key: day.date,
        className: `xy-growth-col${full ? ' xy-full' : ''}${hoverIdx === i ? ' xy-hover' : ''}`,
        // 读屏与可见悬浮条同一短日期口径（aria 与 tooltip 同源同文案）
        'aria-label': t('growth.chart.tooltip', { date: formatShortDate(day.date), checked: day.checked, total: day.total }),
        onMouseEnter: () => setHoverIdx(i),
        onFocus: () => setHoverIdx(i),
        onBlur: () => setHoverIdx(null),
        onMouseLeave: () => setHoverIdx(null),
      },
        createElement('div', { className: 'xy-growth-stack' },
          createElement('div', { className: 'xy-growth-missed', style: { height: `${mh}%` } }),
          createElement('div', { className: 'xy-growth-bar', style: { height: `${h}%` } })))
    })
    // 横坐标 = 独立刻度层：按时间轴比例绝对定位；首端左对齐、末端右对齐防出界。
    // 刻度文案走 Intl：en 用短月份（Aug 27），zh 保持紧凑数字（8/27）——两种语言都不超宽
    const tickFormat = new Intl.DateTimeFormat(activeLocale() === 'en' ? 'en-US' : 'zh-CN', {
      month: activeLocale() === 'en' ? 'short' : 'numeric',
      day: 'numeric',
    })
    const ticks = r.days.map((day, i) => {
      if (!(i % 5 === 0 || i === count - 1)) return null
      const align = i === 0 ? '0%' : i === count - 1 ? '-100%' : '-50%'
      const left = count > 1 ? (i / (count - 1)) * 100 : 0
      const parsed = new Date(Number(day.date.slice(0, 4)), Number(day.date.slice(5, 7)) - 1, Number(day.date.slice(8)), 12)
      return createElement('span', {
        key: day.date,
        className: 'xy-growth-tick',
        style: { left: `${left}%`, transform: `translateX(${align})` },
      }, Number.isNaN(parsed.getTime()) ? day.date : tickFormat.format(parsed))
    })
    return { cols, ticks, days: r.days }
  })()

  /** 统计卡：hot = 强调变体（当前连续是习惯坚持的核心指标）；muted = 缺省值弱化，
   * 「暂无」不得比真实数据更响。 */
  const stat = (value: string | number, label: string, variant?: 'hot' | 'muted'): ReactElement =>
    createElement('div', { className: `xy-statcard${variant === 'hot' ? ' xy-statcard-hot' : ''}${variant === 'muted' ? ' xy-statcard-muted' : ''}` },
      createElement('div', { className: 'xy-statnum' }, String(value)),
      createElement('div', { className: 'xy-meta' }, label))

  // 等级英雄卡：色阶随等级推进（Web Growth.vue 同款进阶感），进度 = 总经验/下一级门槛
  const levelNumber = g.level ?? 1
  const tint = levelTint(levelNumber)
  const expText = g.nextLevelExperience == null
    ? t('growth.maxed')
    : t('growth.expFormat', { cur: g.totalExperience ?? 0, next: g.nextLevelExperience })

  const levelRows = (g.levels ?? []).map((config) => {
    const hit = levelNumber >= config.level
    return createElement('div', { key: config.level, className: `xy-levelrow${hit ? ' xy-levelhit' : ''}` },
      createElement('span', {
        className: 'xy-lvnum',
        style: hit ? { background: levelTint(config.level), color: '#fff' } : undefined,
      }, `Lv.${config.level}`),
      createElement('span', { className: 'xy-lvname' }, localLevelName(config.level, config.levelName)),
      createElement('span', { className: 'xy-meta' }, t('growth.levelRequire', { exp: config.requiredExperience })),
      createElement('span', { className: 'xy-meta xy-lvreward' },
        hit ? '✓ ' : '', localLevelReward(config.level, config.rewardDescription)))
  })

  const hoverDay = chart !== null && hoverIdx !== null ? chart.days[hoverIdx] : undefined
  const stale = growth.error !== undefined

  return createElement('div', { className: 'xy-page', ref: stabilize },
    createElement('div', {
      className: 'xy-hero',
      // 实色双档渐变（78% 混黑深档 → 基档）：白色文字对底色对比 ≥4.5:1 在两种壳主题下
      // 都恒成立；半透明渐变（旧版 tint+d9/tint+73）在浅色壳会混入页面白底，右端跌破 3:1。
      // 深档用 darkenHex 预混（曾用 color-mix 内联，兼容性见 styles.ts 头注铁律）
      style: { background: `linear-gradient(135deg, ${darkenHex(tint, 0.76)}, ${tint})` },
    },
      createElement('div', { className: 'xy-herobadge', style: { background: tint } }, `Lv.${levelNumber}`),
      createElement('div', { className: 'xy-heromain' },
        createElement('div', { className: 'xy-meta xy-onhero' }, t('growth.levelLabel')),
        createElement('h2', { className: 'xy-herotitle' }, `Lv.${levelNumber} · ${localLevelName(levelNumber, g.levelName)}`),
        createElement('div', { className: 'xy-bar xy-bar-onhero' },
          createElement('div', { className: 'xy-bar-fill xy-bar-fill-solid', style: { transform: `scaleX(${Math.min(Math.max(g.levelProgress ?? 0, 0), 100) / 100})` } })),
        createElement('div', { className: 'xy-meta xy-onhero' }, expText))),
    g.rewardDescription !== undefined
      ? createElement('div', { className: 'xy-meta xy-heroreward' }, t('growth.rewardPrefix', { reward: localLevelReward(levelNumber, g.rewardDescription) }))
      : null,
    stale ? createElement(StaleBanner, { onRetry: reload }) : null,
    createElement('div', { className: 'xy-stats' },
      stat(g.totalCheckinDays ?? g.totalCheckins ?? 0, t('growth.stat.checkinDays')),
      stat(g.currentStreak, t('growth.stat.streak'), 'hot'),
      stat(g.maxStreak, t('growth.stat.maxStreak')),
      stat(g.wishTotal, t('growth.stat.wishTotal')),
      stat(g.wishAchieved, t('growth.stat.wishDone')),
      stat(g.taskTotal ?? t('growth.stat.none'), t('growth.stat.taskTotal'), g.taskTotal === undefined ? 'muted' : undefined),
      stat(g.taskAchieved ?? t('growth.stat.none'), t('growth.stat.taskDone'), g.taskAchieved === undefined ? 'muted' : undefined)),
    createElement('h3', { className: 'xy-section-title' }, t('growth.chart.title')),
    // 图表三态整体收进面板卡（加载/失败/空数据/就绪同一容器，与全站卡片语言一致）：
    // 「加载中」不得误报为「暂无打卡数据」；区间为空时同样走 empty 文案而非渲染空白坐标系。
    createElement('div', { className: 'xy-panel' },
      range.data === undefined && range.error === undefined
        ? createElement('div', { key: 'xy-chart-loading', className: 'xy-skel xy-chartload', role: 'status' },
            createElement('span', { className: 'xy-visually-hidden' }, t('common.loading')))
        : range.error !== undefined
          ? createElement('div', { key: 'xy-chart-error' },
              createElement('span', { className: 'xy-field-err' }, range.error),
              createElement('button', {
                className: 'xy-btn', style: { marginLeft: 8 }, onClick: () => range.reload(),
              }, t('common.retry')))
          : chart === null || chart.days.length === 0
            ? createElement('div', { key: 'xy-chart-empty', className: 'xy-meta' }, t('growth.chart.empty'))
            : [createElement('div', { key: 'xy-chart-body' },
                createElement('div', { className: 'xy-tip', role: 'status' },
                  hoverDay !== undefined
                    ? t('growth.chart.tooltip', { date: formatShortDate(hoverDay.date), checked: hoverDay.checked, total: hoverDay.total })
                    : ''),
                // 柱体与刻度同收进横向滚动容器：窄面板下保持最小柱宽（触屏可命中），
                // 刻度与柱体同步滚动，宽面板内容不超宽、容器无感知
                createElement('div', { className: 'xy-growth-scroll' },
                  createElement('div', { className: 'xy-growth' }, chart.cols),
                  createElement('div', { className: 'xy-growth-axis' }, chart.ticks))),
              // 图例与柱体编码一致：蓝柱 = 已打卡，斜纹柱 = 当日未完成缺口，绿柱 = 全勤日
              createElement('div', { key: 'xy-chart-legend', className: 'xy-legend' },
                createElement('span', null, createElement('i', { className: 'xy-dot xy-dot-checked', 'aria-hidden': 'true' }), t('growth.chart.legend.checked')),
                createElement('span', null, createElement('i', { className: 'xy-dot xy-dot-gap', 'aria-hidden': 'true' }), t('growth.chart.legend.missed')),
                createElement('span', { className: 'xy-meta' }, t('growth.chart.hint')))]),
    createElement('h3', { className: 'xy-section-title' }, t('growth.levels.title')),
    createElement('div', { className: 'xy-levels' }, ...levelRows))
}
