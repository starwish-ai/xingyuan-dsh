/**
 * 快速新建轻表单：愿望（标题+分类+颜色）与任务（名称+周期+截止日）两版。
 * POST 直连 create-wish / create-task（与工具层同校验口径：分类 2-6 字、截止≥今天）；
 * 文案明示复杂拆解请走对话。字段 label 在上、错误在下；成功 toast 后回调刷新。
 */
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { postAction } from '../api.js'
import { useXyT, t as translate } from '../i18n.js'
import { localYmd, useActionGuard } from '../hooks.js'
import { toast } from '../ui.js'
import { SwatchRow } from './color-swatch.js'
import { cycleLabel } from './format.js'

const CYCLE_KEYS = ['once', 'daily', 'weekly', 'monthly'] as const

/** 颜色选择行（可选：不选 = 跟随分类哈希/覆盖）。 */
function ColorField(props: { value: string; onPick: (key: string) => void }): ReactElement {
  const t = useXyT()
  return createElement('div', null,
    createElement('span', { className: 'xy-quick-label' }, t('quick.color')),
    createElement(SwatchRow, {
      picked: props.value === '' ? null : props.value,
      onPick: props.onPick,
    }))
}

export function WishQuickForm(props: { onCreated: () => void }): ReactElement {
  const t = useXyT()
  // 展开即聚焦首个字段：点「新建」后可直接打字，不再多点一跳（表单条件挂载，挂载=展开）
  const titleRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { titleRef.current?.focus() }, [])
  const [title, setTitle] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [colorKey, setColorKey] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>(undefined)
  const { busy, guard } = useActionGuard()

  // 输入即清除错误：错误提示与修正动作同帧反馈，不留「已改好还报错」的死循环
  const onTitleChange = (v: string): void => { setTitle(v); setFieldError(undefined) }
  const onCategoryChange = (v: string): void => { setCategoryName(v); setFieldError(undefined) }

  const submit = (): void => {
    const trimmedTitle = title.trim()
    const trimmedCategory = categoryName.trim()
    if (trimmedTitle === '' || trimmedCategory === '') { setFieldError(t('quick.fieldRequired')); return }
    if (trimmedCategory.length < 2 || trimmedCategory.length > 6) { setFieldError(t('err.bad_category_name')); return }
    setFieldError(undefined)
    guard(() => postAction('create-wish', {
      title: trimmedTitle,
      categoryName: trimmedCategory,
      ...(colorKey !== '' ? { colorKey } : {}),
    }).then(() => {
      toast(translate('toast.wishCreated', { title: trimmedTitle }), 'ok')
      setTitle(''); setCategoryName(''); setColorKey('')
      props.onCreated()
    }))
  }

  return createElement('form', { className: 'xy-quick', onSubmit: (e: { preventDefault(): void }) => { e.preventDefault(); submit() } },
    createElement('span', { className: 'xy-meta' }, t('quick.dialogHint')),
    createElement('div', { className: 'xy-quick-row' },
      createElement('label', { className: 'xy-quick-field' },
        createElement('span', { className: 'xy-quick-label' }, t('quick.wish.name')),
        createElement('input', {
          ref: titleRef,
          className: 'xy-input', maxLength: 50, value: title,
          name: 'wish-title', autoComplete: 'off',
          placeholder: t('quick.wish.namePlaceholder'),
          'aria-invalid': fieldError !== undefined || undefined,
          onChange: (e: { target: { value: string } }) => onTitleChange(e.target.value),
        })),
      createElement('label', { className: 'xy-quick-field' },
        createElement('span', { className: 'xy-quick-label' }, t('quick.category')),
        createElement('input', {
          className: 'xy-input', maxLength: 6, value: categoryName,
          name: 'wish-category', autoComplete: 'off',
          placeholder: t('quick.categoryPlaceholder'),
          'aria-invalid': fieldError !== undefined || undefined,
          ...(fieldError !== undefined ? { 'aria-describedby': 'xy-wish-form-error' } : {}),
          onChange: (e: { target: { value: string } }) => onCategoryChange(e.target.value),
        }))),
    ColorField({ value: colorKey, onPick: (key) => { setColorKey(colorKey === key ? '' : key); setFieldError(undefined) } }),
    fieldError !== undefined
      ? createElement('span', { id: 'xy-wish-form-error', className: 'xy-field-err', role: 'alert' }, fieldError)
      : null,
    createElement('div', { className: 'xy-quick-actions' },
      createElement('button', { type: 'submit', className: 'xy-btn xy-btn-primary', disabled: busy },
        busy ? t('quick.submitting') : t('quick.submit'))))
}

export function TaskQuickForm(props: { today: string; onCreated: () => void }): ReactElement {
  const t = useXyT()
  // 同 WishQuickForm：展开即聚焦名称字段
  const nameRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { nameRef.current?.focus() }, [])
  const [name, setName] = useState('')
  const [cycle, setCycle] = useState<string>('daily')
  const [dueDate, setDueDate] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>(undefined)
  const { busy, guard } = useActionGuard()

  // 输入即清除错误：与 WishQuickForm 同一反馈语义，不留「已改好还报错」的死循环
  const onNameChange = (v: string): void => { setName(v); setFieldError(undefined) }
  const onDueChange = (v: string): void => { setDueDate(v); setFieldError(undefined) }

  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') { setFieldError(t('quick.fieldRequired')); return }
    if (dueDate !== '' && dueDate < props.today) { setFieldError(t('quick.duePast')); return }
    setFieldError(undefined)
    guard(() => postAction('create-task', {
      name: trimmed,
      cycle,
      ...(dueDate !== '' ? { dueDate } : {}),
    }).then(() => {
      toast(translate('toast.taskCreated', { name: trimmed }), 'ok')
      setName(''); setDueDate('')
      props.onCreated()
    }))
  }

  return createElement('form', { className: 'xy-quick', onSubmit: (e: { preventDefault(): void }) => { e.preventDefault(); submit() } },
    createElement('span', { className: 'xy-meta' }, t('quick.dialogHint')),
    createElement('div', { className: 'xy-quick-row' },
      createElement('label', { className: 'xy-quick-field' },
        createElement('span', { className: 'xy-quick-label' }, t('quick.task.name')),
        createElement('input', {
          ref: nameRef,
          className: 'xy-input', maxLength: 100, value: name,
          name: 'task-name', autoComplete: 'off',
          placeholder: t('quick.task.namePlaceholder'),
          'aria-invalid': fieldError !== undefined || undefined,
          onChange: (e: { target: { value: string } }) => onNameChange(e.target.value),
        })),
      createElement('label', { className: 'xy-quick-field' },
        createElement('span', { className: 'xy-quick-label' }, t('quick.cycle')),
        createElement('select', {
          className: 'xy-input', value: cycle, name: 'task-cycle',
          onChange: (e: { target: { value: string } }) => setCycle(e.target.value),
        }, ...CYCLE_KEYS.map((c) => createElement('option', { key: c, value: c }, cycleLabel(c))))),
      createElement('label', { className: 'xy-quick-field' },
        createElement('span', { className: 'xy-quick-label' }, t('quick.due')),
        createElement('input', {
          type: 'date', className: 'xy-input', min: props.today || localYmd(new Date()), value: dueDate,
          name: 'task-due',
          'aria-invalid': fieldError !== undefined || undefined,
          onChange: (e: { target: { value: string } }) => onDueChange(e.target.value),
        }))),
    fieldError !== undefined ? createElement('span', { className: 'xy-field-err' }, fieldError) : null,
    createElement('div', { className: 'xy-quick-actions' },
      createElement('button', { type: 'submit', className: 'xy-btn xy-btn-primary', disabled: busy },
        busy ? t('quick.submitting') : t('quick.submit'))))
}
