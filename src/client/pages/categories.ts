/**
 * 分类管理（T1-3）：愿望页顶部入口的面板——分类列表（计数）、改名（批量同步同名愿望，
 * 确认后提交）、22 键配色（写入 global 覆盖，作为该分类默认色）、删空分类（仅清覆盖记录）。
 * 数据经 GET /api/categories；动作 POST category-rename / category-color。
 */
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { getJson, postAction, describeError } from '../api.js'
import { useXyT, t as translate } from '../i18n.js'
import { softConfirm, useActionGuard } from '../hooks.js'
import { toast } from '../ui.js'
import { categoryVars } from '../../category-color.js'
import { SwatchRow } from './color-swatch.js'

interface CategoryRow {
  readonly name: string
  readonly wishCount: number
  readonly colorKey: string | null
  readonly hasOverride: boolean
}

interface CategoriesPayload {
  readonly categories: ReadonlyArray<CategoryRow>
}

/** 展开中的配色行：22 键 + 清除覆盖（「跟随愿望」）。 */
function ColorPicker(props: { name: string; current: string | null; onDone: () => void }): ReactElement {
  const t = useXyT()
  const { busy, guard } = useActionGuard()
  const pick = (colorKey: string | ''): void => {
    guard(() => postAction('category-color', { name: props.name, colorKey }).then(() => {
      // 「跟随愿望」= 重置覆盖，不是删除分类——反馈必须如实区分两种语义
      toast(colorKey === ''
        ? translate('toast.categoryColorReset', { name: props.name })
        : translate('toast.categoryColored', { name: props.name }), 'ok')
      props.onDone()
    }))
  }
  return createElement(SwatchRow, {
    picked: props.current,
    busy,
    onPick: (key) => pick(key),
    followLabel: t('catmgr.followWish'),
    onFollow: () => pick(''),
  })
}

/** 行内改名编辑器：Enter 提交 / Esc 取消 / 空名就地报错——键盘流闭环不静默。 */
function RenameEditor(props: {
  original: string
  wishCount: number
  busy: boolean
  onCommit: (newName: string) => void
  onCancel: () => void
}): ReactElement {
  const t = useXyT()
  const [draft, setDraft] = useState(props.original)
  const [error, setError] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const commit = (): void => {
    const newName = draft.trim()
    if (newName === '') { setError(t('quick.fieldRequired')); return }
    if (newName === props.original) { props.onCancel(); return }
    if (!softConfirm(translate('confirm.renameCategory', { old: props.original, new: newName, count: props.wishCount }))) {
      props.onCancel()
      return
    }
    props.onCommit(newName)
  }

  return createElement('div', { className: 'xy-rename' },
    createElement('input', {
      ref: inputRef,
      className: 'xy-input', maxLength: 6, value: draft,
      'aria-label': translate('catmgr.newName'),
      placeholder: translate('catmgr.newName'),
      'aria-invalid': error !== undefined || undefined,
      ...(error !== undefined ? { 'aria-describedby': 'xy-rename-error' } : {}),
      onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); setError(undefined) },
      onKeyDown: (e: { key: string; preventDefault(): void }) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        else if (e.key === 'Escape') props.onCancel()
      },
    }),
    createElement('button', { className: 'xy-btn xy-btn-primary', disabled: props.busy, onClick: commit }, t('common.save')),
    createElement('button', { className: 'xy-btn', onClick: props.onCancel }, t('common.cancel')),
    error !== undefined
      ? createElement('span', { id: 'xy-rename-error', className: 'xy-field-err', role: 'alert' }, error)
      : null)
}

/** 分类管理面板：由 WishesPage 的「分类管理」按钮切换显隐；onChanged 供宿主列表同步刷新。 */
export function CategoryManager(props: { readonly onChanged?: () => void }): ReactElement {
  const t = useXyT()
  const { onChanged } = props
  const [data, setData] = useState<CategoriesPayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [coloring, setColoring] = useState<string | undefined>(undefined)
  const { busy, guard } = useActionGuard()

  const load = (): void => {
    setError(undefined)
    getJson<CategoriesPayload>('/xingyuan/api/categories')
      .then(setData)
      .catch((e: unknown) => setError(describeError(e)))
  }
  useEffect(load, [])

  // 本面板重取 + 通知宿主（改名会同步全部同名愿望，愿望列表的分类名/配色必须跟着新）
  const reload = (): void => { load(); setColoring(undefined); onChanged?.() }

  const commitRename = (oldName: string, newName: string): void => {
    guard(() => postAction('category-rename', { oldName, newName }).then(() => {
      toast(translate('toast.categoryRenamed', { name: newName }), 'ok')
      setRenaming(undefined)
      reload()
    }))
  }

  const rows = data?.categories ?? []
  return createElement('div', { className: 'xy-catpanel' },
    createElement('div', { className: 'xy-card-head' },
      createElement('span', { className: 'xy-title' }, t('catmgr.title'))),
    createElement('div', { className: 'xy-meta' }, t('catmgr.intro')),
    error !== undefined
      ? createElement('div', null,
          createElement('div', { className: 'xy-field-err' }, error),
          // 与全站数据面同一闭环：失败可见且可重试（此前只能收起重开面板触发重挂载）
          createElement('button', { className: 'xy-btn', onClick: load }, t('common.retry')))
      : null,
    data === undefined && error === undefined
      ? // 取数中：骨架占位（面板不再空白等待）
        createElement('div', { className: 'xy-catloading', role: 'status', 'aria-busy': 'true' },
          createElement('div', { className: 'xy-skel xy-pickline' }),
          createElement('span', { className: 'xy-visually-hidden' }, translate('common.loading')))
      : data !== undefined && rows.length === 0
        ? createElement('div', { className: 'xy-meta' }, t('catmgr.empty'))
        : rows.map((row) => createElement('div', { key: row.name, className: 'xy-catrow' },
            createElement('span', {
              className: 'xy-badge xy-badge-cat',
              style: row.colorKey !== null ? categoryVars(row.colorKey, row.name) : categoryVars(undefined, row.name),
            }, row.name),
            createElement('span', { className: 'xy-meta xy-catcount' }, t('catmgr.count', { n: row.wishCount })),
            createElement('span', { className: 'xy-catops' },
              createElement('button', {
                className: 'xy-btn',
                disabled: busy,
                onClick: () => { setRenaming(row.name); setColoring(undefined) },
              }, t('catmgr.rename')),
              createElement('button', {
                className: 'xy-btn',
                disabled: busy,
                onClick: () => setColoring(coloring === row.name ? undefined : row.name),
              }, t('catmgr.color')),
              row.wishCount === 0 && row.hasOverride
                ? createElement('button', {
                    className: 'xy-btn xy-btn-danger',
                    disabled: busy,
                    onClick: () => {
                      if (!softConfirm(translate('confirm.deleteEmptyCategory', { name: row.name }))) return
                      guard(() => postAction('category-color', { name: row.name, colorKey: '' }).then(() => {
                        toast(translate('toast.categoryDeleted', { name: row.name }), 'ok')
                        reload()
                      }))
                    },
                  }, t('catmgr.deleteEmpty'))
                : null),
            renaming === row.name
              ? createElement(RenameEditor, {
                  original: row.name,
                  wishCount: row.wishCount,
                  busy,
                  onCommit: (newName) => commitRename(row.name, newName),
                  onCancel: () => setRenaming(undefined),
                })
              : null,
            coloring === row.name
              ? createElement(ColorPicker, { name: row.name, current: row.colorKey, onDone: reload })
              : null)))
}
