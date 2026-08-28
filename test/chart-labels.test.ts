/**
 * 图表词表本地化覆盖对拍（评审结论落地）：
 * 服务端 charts.ts 的内建标题/枚举标签/固定副标题是中文权威源，客户端 chart-labels.ts
 * 按映射表本地化。本测试用真实 buildChart 产出对拍映射表——服务端新增/改动内建词而
 * 映射表未跟 → 这里的覆盖断言变红（防「en 用户看到新中文词」的回归）。
 *
 * locale 无关：不切语言，只断言「每个产出词 ∈ 映射表 ∪ 用户数据」与标题逐字同源。
 */
import { describe, expect, it } from 'vitest'
import { buildChart, CHART_KEYS, type ChartConfig, type ChartKey } from '../src/preset/charts.js'
import {
  CHART_DEFAULT_TITLES,
  CHART_LABEL_KEYS,
  CHART_SERIES_KEYS,
  CHART_SUBTITLE_KEYS,
  localizeChartLabel,
  localizeChartSeries,
} from '../src/client/chart-labels.js'
import { createWish, createTask, claimTask, performCheckIn } from '../src/store.js'
import { memoryStore } from './memory-store.js'
import { todayIso } from '../src/opportunity.js'
import type { XingyuanStore } from '../src/domain.js'

const CONFIG: ChartConfig = {
  trendDays: 14,
  distributionDays: 30,
  maxDays: 90,
  rankLimit: 10,
  rankMax: 20,
}

/** 种子数据：愿望/任务/分类名是「用户数据」，不在词表映射范围（原样回显是有意行为）。 */
const USER_DATA_LABELS = new Set(['学会编程', '每日练习', '学习'])

/** 日期轴标签（趋势/比率类的 MM-DD、热力图的 yyyy-MM-dd）：纯数字轴，无需映射。 */
const DATE_LABEL_PATTERNS = [/^\d{2}-\d{2}$/, /^\d{4}-\d{2}-\d{2}$/]

async function seed(store: XingyuanStore): Promise<void> {
  const today = todayIso()
  const wish = await createWish(store, { title: '学会编程', categoryName: '学习' }, today)
  const task = await createTask(store, { name: '每日练习', wishId: wish.wishId, checkInCycle: 'daily', dueDate: today }, today)
  await claimTask(store, task.taskId, today)
  await performCheckIn(store, task.taskId, today, today)
}

describe('图表词表本地化覆盖', () => {
  const store = memoryStore()

  it('服务端内建默认标题与客户端映射逐字同源（双向锁定）', async () => {
    await seed(store)
    for (const key of CHART_KEYS) {
      const spec = buildChart(key as ChartKey, {}, store, CONFIG)
      if (spec === undefined) continue
      expect(spec.title, `${key} 内建标题与 CHART_DEFAULT_TITLES 漂移`).toBe(CHART_DEFAULT_TITLES[key])
    }
  })

  it('每个图表产出的数据点标签 ∈ 词表映射 ∪ 用户数据（新内建词必须同步映射）', async () => {
    await seed(store)
    const seen: Array<{ key: ChartKey; label: string; kind: 'label' | 'series' }> = []
    for (const key of CHART_KEYS) {
      const spec = buildChart(key as ChartKey, { days: 30, limit: 20 }, store, CONFIG)
      if (spec === undefined) continue
      for (const datum of spec.data) {
        seen.push({ key: spec.chartKey, label: datum.label, kind: 'label' })
        if (datum.series !== undefined) seen.push({ key: spec.chartKey, label: datum.series, kind: 'series' })
      }
    }
    expect(seen.length).toBeGreaterThan(0)
    for (const { key, label, kind } of seen) {
      if (USER_DATA_LABELS.has(label) || DATE_LABEL_PATTERNS.some((re) => re.test(label))) {
        // 用户数据与日期轴：本地化必须原样回显
        expect(kind === 'series' ? localizeChartSeries(label) : localizeChartLabel(label), `${key} 标签「${label}」被误改写`).toBe(label)
        continue
      }
      const mapped = kind === 'series' ? CHART_SERIES_KEYS[label] : CHART_LABEL_KEYS[label]
      expect(mapped, `${key} 产出的中文词「${label}」不在 ${kind} 映射表内`).toBeDefined()
    }
  })

  it('每个图表产出的副标题 ∈ 固定映射 ∪ 数字模板 ∪ 月份（本地化不漏词）', async () => {
    await seed(store)
    const templates = [
      /^近 \d+ 天$/, /^\d+\/\d+ 天（含未领取任务）$/, /^\d+\/\d+ 天$/,
      /^当前 \d+ 天 \/ 最长 \d+ 天$/, /^\d{4}-\d{2}$/,
      /^\d+\/\d+$/, // 纯数字达成计数（如 wishAchievement 的 3/3）：无语言词，无需映射
    ]
    for (const key of CHART_KEYS) {
      const spec = buildChart(key as ChartKey, { days: 30, limit: 20 }, store, CONFIG)
      if (spec === undefined || spec.subtitle === undefined) continue
      const covered = CHART_SUBTITLE_KEYS[spec.subtitle] !== undefined || templates.some((re) => re.test(spec.subtitle!))
      expect(covered, `${key} 的副标题「${spec.subtitle}」无本地化覆盖`).toBe(true)
    }
  })

  it('已知中文枚举标签在 zh 回落下恒等（映射表 zh 值 = 原词）', () => {
    for (const [zh, key] of Object.entries(CHART_LABEL_KEYS)) {
      expect(localizeChartLabel(zh), `标签 ${zh} 映射后应保持 zh 原文`).toBe(zh)
      expect(key.startsWith('chart.') || key.startsWith('task.status.')).toBe(true)
    }
    for (const [zh, key] of Object.entries(CHART_SERIES_KEYS)) {
      expect(localizeChartSeries(zh)).toBe(zh)
      expect(key.startsWith('chart.series.')).toBe(true)
    }
  })
})
