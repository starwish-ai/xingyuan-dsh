/**
 * 写路径守卫回归（0.6.5 缺陷批）。
 *
 * 覆盖四类曾经真实存在的失效形态：
 * 1. 宿主 `update` 缺键先抛 DomainError('missing-key')（不调回调），插件不接就会把
 *    无 code 的英文异常抛给模型/页面——现在必须换成本包 coded ToolError；
 * 2. 派生量同步（愿望进度联动）遇到父记录被并发删除时不得让主操作失败；
 * 3. 月视图按 [start,end] 逐日物化，极端年份/非法月份必须响亮拒绝（否则进程挂死）；
 * 4. 分类改名与任务名校验必须走 store 单一口径，且校验先于逐条落库（不留半改状态）。
 *
 * 桩的宿主语义（缺键抛 missing-key）在 test/memory-store.ts 里，改桩即全批重跑。
 */
import { describe, expect, it } from 'vitest'
import { memoryStore } from './memory-store.js'
import {
  claimTask,
  createTask,
  createWish,
  monthRange,
  categoryExists,
  renameCategory,
  setCategoryColor,
  syncWishProgress,
  updateTask,
  updateWish,
} from '../src/store.js'

const TODAY = '2026-09-24'

async function seedWishAndTask(store: ReturnType<typeof memoryStore>) {
  const wish = await createWish(store, { title: '读完《三体》', categoryName: '阅读' }, TODAY)
  const task = await createTask(store, {
    name: '每天读 30 页',
    checkInCycle: 'daily',
    dueDate: '2026-09-30',
    wishId: wish.wishId,
  }, TODAY)
  return { wish, task }
}

/** 取错误的 code（本包的契约字段；宿主异常没有它，正是过去的问题所在）。 */
function codeOf(error: unknown): unknown {
  return (error as { code?: unknown })?.code
}

describe('域表 update 缺键 → coded ToolError（宿主 missing-key 语义）', () => {
  it('updateWish / updateTask / claimTask 对不存在的记录给 not_found，而不是宿主英文异常', async () => {
    const store = memoryStore()
    for (const [label, run] of [
      ['updateWish', () => updateWish(store, 'ghost-wish', { title: '改个名' }, TODAY)],
      ['updateTask', () => updateTask(store, 'ghost-task', { name: '改个名' }, TODAY)],
      ['claimTask', () => claimTask(store, 'ghost-task', TODAY)],
    ] as const) {
      const error = await run().then(() => undefined, (e: unknown) => e)
      expect(error, `${label} 本应拒绝`).toBeTruthy()
      expect(codeOf(error), `${label} 必须携带稳定 code`).toBe('not_found')
      expect((error as Error).message).not.toMatch(/no record .* to update/)
    }
  })

  it('记录在写链中途消失（并发删除窗口）同样换码，不泄漏宿主措辞', async () => {
    const store = memoryStore()
    const { task } = await seedWishAndTask(store)
    // 模拟「读到任务后、update 落库前」记录被删：直接抹掉表内条目
    await store.domain.table('tasks').delete(task.taskId)
    const taskError = await updateTask(store, task.taskId, { name: '改个名' }, TODAY).then(() => null, (e: unknown) => e)
    expect(codeOf(taskError), '任务已被删除时应给 not_found').toBe('not_found')
    expect((taskError as Error).message).not.toMatch(/no record .* to update/)
  })

  it('愿望被并发删除时，派生的进度同步静默跳过而非让调用方失败', async () => {
    const store = memoryStore()
    const { wish } = await seedWishAndTask(store)
    await store.domain.table('wishes').delete(wish.wishId)
    await expect(syncWishProgress(store, wish.wishId)).resolves.toBeUndefined()
  })
})

describe('月视图年份/月份闸门（读侧不得挂死进程）', () => {
  it('极端年份与非法月份一律 bad_date', () => {
    const rejectCode = (month: string): unknown => {
      try {
        monthRange(month, TODAY)
        return null
      } catch (error) {
        return codeOf(error)
      }
    }
    // 逐日物化 [start,end]：0001-06 曾展开成数十万格并把进程挂死
    for (const bad of ['0001-06', '0099-06', '10000-01', '1800-01', '2026-13', '2026-00', '2026-1', 'abc']) {
      expect(rejectCode(bad), `${bad} 应被拒绝并带稳定 code`).toBe('bad_date')
    }
  })

  it('月末天数含闰年口径，且不再依赖 Date.UTC（0–99 年会被映射成 1900 年代）', () => {
    expect(monthRange('2024-02', TODAY)).toEqual(['2024-02-01', '2024-02-29'])
    expect(monthRange('2023-02', TODAY)).toEqual(['2023-02-01', '2023-02-28'])
    expect(monthRange('2023-04', TODAY)).toEqual(['2023-04-01', '2023-04-30'])
    expect(monthRange('2023-12', TODAY)).toEqual(['2023-12-01', '2023-12-31'])
    expect(monthRange(undefined, TODAY)).toEqual(['2026-09-01', '2026-09-30'])
  })
})

describe('校验单一口径：任务名与分类改名', () => {
  it('空白/超长任务名在 store 层即拒绝，且带 code', async () => {
    const store = memoryStore()
    for (const [name, expected] of [['   ', 'missing_field'], ['x'.repeat(101), 'name_too_long']] as const) {
      const error = await createTask(store, { name, checkInCycle: 'daily' }, TODAY).then(() => null, (e: unknown) => e)
      expect(codeOf(error), `createTask(${JSON.stringify(name)})`).toBe(expected)
    }
    const { task } = await seedWishAndTask(store)
    const error = await updateTask(store, task.taskId, { name: '  ' }, TODAY).then(() => null, (e: unknown) => e)
    expect(codeOf(error), 'updateTask 空白名').toBe('missing_field')
  })

  it('合法任务名去首尾空白后落库（页面与工具同一结果）', async () => {
    const store = memoryStore()
    const task = await createTask(store, { name: '  每天背单词  ', checkInCycle: 'daily' }, TODAY)
    expect(task.name).toBe('每天背单词')
  })

  it('非法新分类名不产生半改状态：三条愿望的分类全部保持原样', async () => {
    const store = memoryStore()
    await createWish(store, { title: '愿望甲', categoryName: '阅读' }, TODAY)
    await createWish(store, { title: '愿望乙', categoryName: '阅读' }, TODAY)
    await createWish(store, { title: '愿望丙', categoryName: '阅读' }, TODAY)
    const before = [...([...store.domain.table('wishes').entries()].map(([, w]) => w))].map((w) => w.categoryName)
    expect(before).toEqual(['阅读', '阅读', '阅读'])

    // 单字分类名越界：改前逐条 put 会在第二条抛 invalid_record，留下半改状态
    const error = await renameCategory(store, '阅读', 'X').then(() => null, (e: unknown) => e)
    expect(error, '单字分类名应被拒绝').toBeTruthy()
    expect([...([...store.domain.table('wishes').entries()].map(([, w]) => w))].map((w) => w.categoryName)).toEqual(before)

    // 合法改名仍然全量生效（守卫不得把正常路径一起拦掉）
    const renamed = await renameCategory(store, '阅读', '书本')
    expect(renamed).toHaveLength(3)
    expect([...([...store.domain.table('wishes').entries()].map(([, w]) => w))].map((w) => w.categoryName))
      .toEqual(['书本', '书本', '书本'])
  })
})

/**
 * 分类颜色覆盖（0.6.7 从路由面上移为 store 收口，供页面动作与对话工具共用）。
 * 上移前路由只做截断不校验：`name: ''` 会写出一个键为空串的幽灵覆盖，
 * 从此挂在分类面板上甩不掉；空串色键与「清除覆盖」的语义也必须在同一处判定。
 */
describe('写路径守卫：分类颜色覆盖收口', () => {
  it('空/单字分类名一律拒绝（bad_category_name），且不写出任何覆盖键', async () => {
    const store = memoryStore()
    for (const bad of ['', ' ', 'X']) {
      const error = await setCategoryColor(store, bad, 'blue').then(() => null, (e: unknown) => e)
      expect(error, `分类名「${bad}」应被拒绝`).toBeTruthy()
      expect(codeOf(error)).toBe('bad_category_name')
    }
    expect(store.domain.global.get().categoryColors, '拒绝即不得留下幽灵键').toBeUndefined()
  })

  it('未知色键拒绝（bad_color_key）；空串色键 = 清除覆盖而非报错', async () => {
    const store = memoryStore()
    const bad = await setCategoryColor(store, '阅读', 'chartreuse').then(() => null, (e: unknown) => e)
    expect(codeOf(bad)).toBe('bad_color_key')
    expect(await setCategoryColor(store, '阅读', 'blue')).toBe('blue')
    expect(store.domain.global.get().categoryColors).toEqual({ 阅读: 'blue' })
    expect(await setCategoryColor(store, '阅读', '  ')).toBeNull()
    expect(store.domain.global.get().categoryColors, '覆盖清空后整槽回落 undefined').toBeUndefined()
  })

  it('categoryExists：同名愿望或纯覆盖分类都算存在（工具面不得把后者当不存在）', async () => {
    const store = memoryStore()
    expect(categoryExists(store, '阅读')).toBe(false)
    await setCategoryColor(store, '阅读', 'blue')
    expect(categoryExists(store, '阅读'), '零愿望但设过色的分类是合法对象').toBe(true)
    await createWish(store, { title: '读完《三体》', categoryName: '书本' }, TODAY)
    expect(categoryExists(store, '书本')).toBe(true)
  })
})
