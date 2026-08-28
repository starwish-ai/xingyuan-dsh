/** 记忆页：搜索/新增/编辑/删除/清空 + 分页加载更多（offset/limit，任意条数可浏览）。 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { getJson, postAction, ActionError } from '../api.js'
import { useXyT, t as translate } from '../i18n.js'
import { softConfirm, softConfirmDanger, useActionGuard, usePageData, useStableScrollbar } from '../hooks.js'
import { PageEmpty, PageError, PageSkeleton, toast, IconEdit, IconTrash } from '../ui.js'
import type { MemoriesPayload, MemoryItem } from './types.js'

const MEMORY_CATEGORY_KEYS = ['memory.cat.personal', 'memory.cat.preference', 'memory.cat.habit', 'memory.cat.event', 'memory.cat.other'] as const
const MEMORY_CATEGORY_IDS = ['personal', 'preference', 'habit', 'event', 'other'] as const
const MEMORY_IMPORTANCE_KEYS = ['memory.imp.high', 'memory.imp.medium', 'memory.imp.low'] as const
const MEMORY_IMPORTANCE_IDS = ['high', 'medium', 'low'] as const
/** 首屏/每页条数（客户端 UI 常量；服务端缺省仍为 memoryListLimit）。 */
const PAGE_SIZE = 50

/** 未知分类/重要度原样回显（防御服务端新增枚举）。模块级取词：标签函数在渲染期被组件调用。 */
function catLabel(id: string): string {
  const index = MEMORY_CATEGORY_IDS.indexOf(id as (typeof MEMORY_CATEGORY_IDS)[number])
  return index >= 0 ? translate(MEMORY_CATEGORY_KEYS[index]!) : id
}

/** 记忆列表请求 URL：搜索词与分页参数在此统一拼装（首屏与加载更多共用同一构造，防口径漂移）。
 * 参数统一走 URLSearchParams——此前手工拼接在有搜索词时产出 `?q=词?offset=0`（分隔符误用 ?），
 * 服务端把「词?offset=0」整体当关键词导致搜索永远为空。 */
export function memoryListUrl(keyword: string, offset: number, limit: number): string {
  const params = new URLSearchParams()
  const q = keyword.trim()
  if (q !== '') params.set('q', q)
  params.set('offset', String(offset))
  params.set('limit', String(limit))
  return `/xingyuan/api/memories?${params.toString()}`
}

function impLabel(id: string): string {
  const index = MEMORY_IMPORTANCE_IDS.indexOf(id as (typeof MEMORY_IMPORTANCE_IDS)[number])
  return index >= 0 ? translate(MEMORY_IMPORTANCE_KEYS[index]!) : id
}

export function MemoryPage(): ReactElement {
  const t = useXyT()
  const stabilize = useStableScrollbar()
  const [query, setQuery] = useState('')
  // 防抖取数：搜索词变化 250ms 后才请求，避免逐键打接口
  const [debounced, setDebounced] = useState('')
  const debounceRef = useRef<number | undefined>(undefined)
  useEffect(() => () => { if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current) }, [])
  useEffect(() => {
    if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setDebounced(query), 250)
  }, [query])

  const page = usePageData<MemoriesPayload>(() => memoryListUrl(debounced, 0, PAGE_SIZE), [debounced])
  const { busy, guard } = useActionGuard()

  // 加载更多：追加页累积；搜索词变化时重置（usePageData 换首屏，more 必须清空）。
  // 追加请求带代数守卫：防抖换词/写后刷新触发的重置会让在途旧页失效——慢响应不得再追加
  const [more, setMore] = useState<ReadonlyArray<MemoryItem>>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const moreSeqRef = useRef(0)
  useEffect(() => {
    moreSeqRef.current += 1
    // 使在途加载失效的同时必须复位按钮态：否则在途请求的 finally 因 seq 失配
    // 跳过复位，loadingMore 永挂 true——「加载更多」自此点不动（P0 级交互死锁）
    setLoadingMore(false)
    setMore([])
    setLoadError(undefined)
  }, [debounced])
  const data0 = page.data
  const shownCount = (data0?.memories.length ?? 0) + more.length
  const hasMore = data0 !== undefined && shownCount < data0.total

  const loadMore = (): void => {
    if (data0 === undefined || loadingMore) return
    const seq = ++moreSeqRef.current
    setLoadingMore(true)
    setLoadError(undefined)
    getJson<MemoriesPayload>(memoryListUrl(debounced, shownCount, PAGE_SIZE))
      .then((payload) => { if (seq === moreSeqRef.current) setMore((current) => [...current, ...payload.memories]) })
      .catch((e: unknown) => { if (seq === moreSeqRef.current) setLoadError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (seq === moreSeqRef.current) setLoadingMore(false) })
  }

  /** 写操作后的全量刷新：追加页必须丢弃（offset 语义已失效），回到首屏。 */
  const refreshAll = (): void => {
    moreSeqRef.current += 1
    // 同 useEffect 的失效点：在途加载被弃时按钮态就地复位（防死锁）
    setLoadingMore(false)
    setMore([])
    setLoadError(undefined)
    void page.reload()
  }

  const [keyDraft, setKeyDraft] = useState('')
  const [valueDraft, setValueDraft] = useState('')
  const [category, setCategory] = useState<string>('other')
  const [importance, setImportance] = useState<string>('medium')
  // 写成功短通知（搜索行尾 ✓ 文案）；表单校验错误就地显示（role=alert）——输入即清除
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const noticeTimer = useRef<number | undefined>(undefined)
  // 编辑态：预填现有记忆（键名不可改，对齐 Web MemoryManage）；null = 新增模式
  const [editingKey, setEditingKey] = useState<string | undefined>(undefined)
  // 编辑聚焦目标：点击远处行的「编辑」后焦点落到内容输入框——视口随之滚到表单，操作不迷路
  const valueInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => () => {
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
  }, [])

  const flash = useCallback((text: string): void => {
    setNotice(text)
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice((current) => (current === text ? undefined : current)), 2600)
  }, [])

  if (page.error !== undefined) return createElement(PageError, { message: page.error, onRetry: page.reload })
  const data = page.data
  if (data === undefined) return createElement(PageSkeleton)

  // 首屏 + 已加载追加页合并后再做本地关键词过滤（服务端 q 为服务端匹配，二者互补）
  const allItems: ReadonlyArray<MemoryItem> = [...data.memories, ...more]
  const filtered = allItems.filter((m) => {
    const q = query.trim().toLowerCase()
    if (q === '') return true
    return m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
  })

  const resetForm = (): void => {
    setEditingKey(undefined); setKeyDraft(''); setValueDraft(''); setCategory('other'); setImportance('medium'); setFormError(undefined)
  }

  const startEdit = (m: MemoryItem): void => {
    setEditingKey(m.key); setKeyDraft(m.key); setValueDraft(m.value); setCategory(m.category); setImportance(m.importance); setFormError(undefined)
    window.setTimeout(() => valueInputRef.current?.focus(), 0)
  }

  /** 保存记忆本体（写成功 → 刷新 + 短通知 + 复位表单）。 */
  const submitMemory = (overwrite: boolean): Promise<void> =>
    postAction('memory-add', { key: keyDraft.trim(), value: valueDraft.trim(), category, importance, overwrite })
      .then((payload) => {
        refreshAll()
        flash(payload.overwrote === true || overwrite
          ? t('memory.savedOverwrite', { key: keyDraft.trim() })
          : t('memory.savedNew', { key: keyDraft.trim() }))
        resetForm()
      })

  /** 实际保存：服务端因「已存在未带 overwrite」拒绝时（code=overwrite_required）补确认重试一次。 */
  const doSave = (overwrite: boolean): void => {
    guard(() =>
      submitMemory(overwrite).catch((e: unknown) => {
        // 稳定错误码判定（不再嗅探 message 文本）：需要覆盖确认时弹应用内确认重试一次；
        // 用户拒绝则维持原错误（toast 呈现 overwrite_required 文案）
        if (e instanceof ActionError && e.code === 'overwrite_required') {
          return softConfirm(t('memory.overwriteAsk', { key: keyDraft.trim() })).then((ok) => {
            if (!ok) throw e
            return submitMemory(true)
          })
        }
        throw e
      }))
  }

  const saveForm = (): void => {
    const key = keyDraft.trim()
    const value = valueDraft.trim()
    if (key === '' || value === '') { setFormError(t('memory.needKeyAndValue')); return }
    setFormError(undefined)
    const knownExists = editingKey !== undefined || allItems.some((m) => m.key === key)
    if (knownExists && editingKey === undefined) {
      void softConfirm(t('memory.overwriteAsk', { key })).then((ok) => { if (ok) doSave(false) })
      return
    }
    doSave(knownExists)
  }

  const removeOne = (m: MemoryItem): void => {
    void softConfirmDanger(t('memory.confirmDelete', { key: m.key, value: m.value })).then((ok) => {
      if (!ok) return
      // 删除的正是正在编辑的条目：成功后必须复位编辑态，否则残留的 editingKey
      // 会让下一次保存以 overwrite:true 静默重建这条已删除记录（无确认、无感知）。
      // 复位挂在成功分支——删除失败时草稿照常保留
      const wasEditing = editingKey === m.key
      guard(() => postAction('memory-delete', { key: m.key }).then(() => {
        refreshAll()
        flash(t('memory.deletedOne', { key: m.key }))
        if (wasEditing) resetForm()
      }))
    })
  }

  const clearAll = (): void => {
    if (data.total === 0) return
    // 清空后任何编辑态都失去载体（同 removeOne 的复活风险），成功后一并复位
    void softConfirmDanger(t('memory.confirmClear', { total: data.total })).then((ok) => {
      if (!ok) return
      guard(() => postAction('memory-clear', {}).then(() => {
        refreshAll()
        flash(t('memory.clearedAll'))
        resetForm()
      }))
    })
  }

  const rows = filtered.map((m) => createElement('li', { key: m.key, className: 'xy-grouprow' },
    createElement('div', { className: 'xy-rowmain' },
      createElement('span', { className: 'xy-rowtitle' },
        m.importance === 'high' ? createElement('span', { className: 'xy-star-hi', 'aria-hidden': 'true' }, '★') : null,
        m.key),
      createElement('span', { className: 'xy-meta' }, m.value),
      createElement('span', { className: 'xy-meta' },
        `${catLabel(m.category)} · ${t('memory.importanceLabel', { level: impLabel(m.importance) })} · ${m.createdAt.slice(0, 10)}`)),
    createElement('div', { className: 'xy-memactions' },
      // 行内图标幽灵键（≥26px 命中目标）：长列表降噪，语义走 aria-label 带 key 上下文
      createElement('button', {
        className: 'xy-btn xy-btn-icon', disabled: busy, onClick: () => startEdit(m),
        'aria-label': `${t('common.edit')} · ${m.key}`, title: t('common.edit'),
      }, createElement(IconEdit)),
      createElement('button', {
        className: 'xy-btn xy-btn-danger xy-btn-icon', disabled: busy, onClick: () => removeOne(m),
        'aria-label': `${t('common.delete')} · ${m.key}`, title: t('common.delete'),
      }, createElement(IconTrash)))))

  return createElement('div', { className: 'xy-page', ref: stabilize },
    createElement('div', { className: 'xy-page-head' },
      createElement('h2', { className: 'xy-page-title' }, t('memory.pageTitle')),
      createElement('span', { className: 'xy-meta' }, t('memory.summary', { total: data.total }))),
    editingKey !== undefined
      ? createElement('div', { className: 'xy-meta xy-editing' },
          t('memory.editing', { key: editingKey }),
          createElement('button', { className: 'xy-btn', onClick: resetForm }, t('memory.cancelEdit')))
      : null,
    // 添加/编辑表单收进虚线面板卡：与快速新建同一「可书写」视觉语法，不再是一行悬空输入框
    createElement('div', { className: 'xy-compose' },
      createElement('input', {
        className: 'xy-input xy-input-grow', placeholder: t('memory.keyPlaceholder'), maxLength: 50,
        'aria-label': t('memory.fieldKey'), autoComplete: 'off', name: 'memory-key', spellCheck: false,
        disabled: editingKey !== undefined,
        value: keyDraft, onChange: (e: { target: { value: string } }) => { setKeyDraft(e.target.value); setFormError(undefined) },
      }),
      createElement('input', {
        className: 'xy-input xy-input-grow', placeholder: t('memory.valuePlaceholder'), maxLength: 1000,
        'aria-label': t('memory.fieldValue'), autoComplete: 'off', name: 'memory-value',
        ref: valueInputRef,
        'aria-invalid': formError !== undefined || undefined,
        ...(formError !== undefined ? { 'aria-describedby': 'xy-memory-form-error' } : {}),
        value: valueDraft, onChange: (e: { target: { value: string } }) => { setValueDraft(e.target.value); setFormError(undefined) },
      }),
      createElement('select', {
        className: 'xy-input', value: category, 'aria-label': t('memory.fieldCategory'), name: 'memory-category',
        onChange: (e: { target: { value: string } }) => setCategory(e.target.value),
      }, ...MEMORY_CATEGORY_IDS.map((id, i) => createElement('option', { key: id, value: id }, t(MEMORY_CATEGORY_KEYS[i]!)))),
      createElement('select', {
        className: 'xy-input', value: importance, 'aria-label': t('memory.fieldImportance'), name: 'memory-importance',
        onChange: (e: { target: { value: string } }) => setImportance(e.target.value),
      }, ...MEMORY_IMPORTANCE_IDS.map((id, i) => createElement('option', { key: id, value: id }, t(MEMORY_IMPORTANCE_KEYS[i]!)))),
      createElement('button', { className: 'xy-btn xy-btn-primary', disabled: busy, onClick: saveForm },
        editingKey !== undefined ? t('memory.saveEdit') : t('memory.add'))),
    formError !== undefined
      ? createElement('span', { id: 'xy-memory-form-error', className: 'xy-field-err', role: 'alert' }, formError)
      : null,
    createElement('div', { className: 'xy-membar' },
      createElement('input', {
        type: 'search', className: 'xy-input xy-input-search', placeholder: t('memory.searchPlaceholder'),
        'aria-label': t('memory.searchAria'), autoComplete: 'off', name: 'memory-search', enterKeyHint: 'search',
        value: query, onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
      }),
      notice !== undefined ? createElement('span', { className: 'xy-saved', role: 'status' }, notice) : null),
    data.total > allItems.length
      ? createElement('div', { className: 'xy-meta xy-memcap' }, t('memory.capNote', { total: data.total, shown: allItems.length }))
      : null,
    data.total === 0
      ? createElement(PageEmpty, { title: t('memory.empty.title'), hint: t('memory.empty.hint') })
      : filtered.length === 0
        ? createElement(PageEmpty, { title: t('memory.searchEmpty.title') })
        : // 列表收进单张分组卡：分隔线行替代逐行描边盒子，长列表不再满屏边框噪音
          createElement('section', { className: 'xy-group' },
            createElement('ul', { className: 'xy-grouplist' }, rows)),
    hasMore
      ? createElement('div', { className: 'xy-memfoot' },
          createElement('button', { className: 'xy-btn', disabled: loadingMore || busy, onClick: loadMore },
            loadingMore ? `${t('common.loading')}…` : t('memory.more')),
          loadError !== undefined ? createElement('span', { className: 'xy-field-err' }, loadError) : null)
      : shownCount > PAGE_SIZE
        ? createElement('div', { className: 'xy-meta xy-memcap' }, t('memory.loadedAll', { n: shownCount }))
        : null,
    data.total > 0
      ? createElement('div', { className: 'xy-memfoot' },
          createElement('button', { className: 'xy-btn xy-btn-danger', disabled: busy, onClick: clearAll }, t('memory.clearAll')),
          createElement('span', { className: 'xy-meta' }, t('memory.footNote')))
      : null)
}
