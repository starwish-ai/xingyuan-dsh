/** 星愿设置整页（设置 → 星愿）：教练风格/画像（星愿库）+ 二次确认开关与注入上限（设置命名空间）。 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { getJson, postJson } from '../api.js'
import { toastError } from '../ui.js'
import { useXyT, activeLocale } from '../i18n.js'

/** 与 dsh-client-runtime 的 SettingsScope 快照对齐的叶子视图（只读字段）。 */
interface ScopeSnapshotLike {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value?: { readonly confirmWrites?: boolean; readonly memoryInjectLimit?: number }
  readonly writable: boolean
}

/**
 * settingsScope.bind() 返回的真实形状：getSnapshot()/subscribe()/set()/unset()。
 * 注意 scope 本身没有 .value 字段——值在快照里（此前直接读 scope.value 导致整节渲染崩溃）。
 */
export interface SettingsScopeLike {
  getSnapshot(): ScopeSnapshotLike
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

interface ProfilePayloadLike {
  readonly coachStyle?: string
  readonly nickname?: string
  readonly occupation?: string
  readonly interests?: ReadonlyArray<string>
}

const COACH_IDS = ['gentle', 'strict', 'humorous'] as const
const COACH_KEYS = ['settings.coach.gentle', 'settings.coach.strict', 'settings.coach.humorous'] as const

export function SettingsSection(props: { scope: SettingsScopeLike }): ReactElement {
  const t = useXyT()
  const scope = props.scope
  // 正确订阅：useSyncExternalStore + getSnapshot（scope 契约见 dsh-client-runtime contract/settings-scope）
  const snap = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const writable = snap.status === 'ready' && snap.writable
  const limit = String(snap.value?.memoryInjectLimit ?? 40)

  // 教练风格与画像存于星愿数据库 global 单例（与对话侧工具同一数据源），经 /xingyuan/api/profile 读写
  const [profile, setProfile] = useState<ProfilePayloadLike | undefined>(undefined)
  const [profileError, setProfileError] = useState<string | undefined>(undefined)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [occupationDraft, setOccupationDraft] = useState('')
  const [interestsDraft, setInterestsDraft] = useState('')
  // 记忆注入上限：草稿态编辑（null=显示快照值），失焦才校验提交——避免逐键持久化与非法中间值死锁
  const [limitDraft, setLimitDraft] = useState<string | null>(null)
  const [limitError, setLimitError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  // 二次确认开关：本地乐观值（undefined=跟随远端快照）——写入在途时 UI 立即响应，失败回滚
  const [pendingToggle, setPendingToggle] = useState<boolean | undefined>(undefined)
  const savedTimer = useRef<number | undefined>(undefined)
  // 档案加载代数守卫：慢响应不得覆盖用户已开始的草稿
  const profileSeqRef = useRef(0)
  // 开关显示值：乐观本地值优先（写入在途），否则跟随远端快照
  const confirmWrites = pendingToggle !== undefined ? pendingToggle : snap.value?.confirmWrites !== false

  const loadProfile = (): void => {
    const seq = ++profileSeqRef.current
    setProfileError(undefined)
    getJson<ProfilePayloadLike>('/xingyuan/api/profile')
      .then((p) => {
        if (seq !== profileSeqRef.current) return
        setProfile(p)
        setNicknameDraft(p.nickname ?? '')
        setOccupationDraft(p.occupation ?? '')
        setInterestsDraft((p.interests ?? []).join(activeLocale() === 'en' ? ', ' : '、'))
      })
      .catch((e: unknown) => { if (seq === profileSeqRef.current) setProfileError(e instanceof Error ? e.message : String(e)) })
  }

  useEffect(loadProfile, [])

  useEffect(() => () => {
    if (savedTimer.current !== undefined) window.clearTimeout(savedTimer.current)
  }, [])

  const flashSaved = (text: string): void => {
    setSavedMsg(text)
    if (savedTimer.current !== undefined) window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSavedMsg(''), 2400)
  }

  /** 写操作统一入口：防重入 + 失败 toast（成功回调由调用方提供）。 */
  const runSave = (run: () => Promise<void>): void => {
    if (saving) return
    setSaving(true)
    run().catch(toastError).finally(() => setSaving(false))
  }

  const commitLimit = (): void => {
    const raw = limitDraft
    setLimitDraft(null)
    setLimitError(false)
    if (raw === null || !writable || raw.trim() === '') return
    const n = Number(raw)
    // 非法输入就地报错（不再静默回弹）：用户明确知道哪里错、该怎么改
    if (!Number.isFinite(n) || Math.round(n) !== n) { setLimitError(true); return }
    const clamped = Math.min(200, Math.max(5, Math.round(n)))
    if (clamped !== Number(raw)) {
      // 越界但可夹取：直接按夹取值提交并回显，同时给出行内提示
      void scope.set('memoryInjectLimit', clamped).then(() => setLimitDraft(String(clamped))).catch(toastError)
      setLimitError(true)
      return
    }
    if (clamped === snap.value?.memoryInjectLimit) return
    void scope.set('memoryInjectLimit', clamped).catch(toastError)
  }

  const coachLabel = (id: string | undefined): string => {
    const index = COACH_IDS.indexOf(id as (typeof COACH_IDS)[number])
    return index >= 0 ? t(COACH_KEYS[index]!) : (id ?? '')
  }

  const saveCoach = (style: string): void => {
    if (saving || style === profile?.coachStyle) return
    runSave(() => postJson<{ coachStyle: string }>('/xingyuan/api/profile', { coachStyle: style })
      .then((p) => {
        setProfile((current) => ({ ...(current ?? {}), coachStyle: p.coachStyle }))
        flashSaved(t('settings.coach.saved'))
      }))
  }

  const saveProfile = (): void => {
    if (saving) return
    runSave(() => postJson<ProfilePayloadLike>('/xingyuan/api/profile', {
      nickname: nicknameDraft,
      occupation: occupationDraft,
      interests: interestsDraft,
    })
      .then((p) => {
        setProfile(p)
        setNicknameDraft(p.nickname ?? '')
        setOccupationDraft(p.occupation ?? '')
        setInterestsDraft((p.interests ?? []).join(activeLocale() === 'en' ? ', ' : '、'))
        flashSaved(t('settings.profile.saved'))
      }))
  }

  // 三个分节各自成面板卡（与全站卡片语言一致），字段不再裸堆叠；卡内节奏由样式层统一
  return createElement('div', { className: 'xy-settings' },
    createElement('section', { className: 'xy-panel' },
      createElement('h3', { className: 'xy-panel-head' }, t('settings.coach.title')),
      createElement('div', { className: 'xy-seg', role: 'group', 'aria-label': t('settings.coach.title') },
        ...COACH_IDS.map((id, i) => createElement('button', {
          key: id,
          className: `xy-seg-btn${profile?.coachStyle === id ? ' xy-on' : ''}`,
          'aria-pressed': profile?.coachStyle === id,
          disabled: saving,
          onClick: () => saveCoach(id),
        }, t(COACH_KEYS[i]!)))),
      createElement('p', { className: 'xy-hint' },
        profileError !== undefined ? t('settings.coach.loadFailed', { error: profileError })
          : profile === undefined ? t('common.loading') + '…'
          : t('settings.coach.current', { label: coachLabel(profile.coachStyle) })),
      profileError !== undefined
        ? createElement('button', { className: 'xy-btn', onClick: loadProfile }, t('common.retry'))
        : null),
    // 画像字段：label 包裹关联控件（可点击标签聚焦输入），小标题在上、示例 placeholder 在下，
    // 与「快速新建」表单同一视觉语法
    createElement('section', { className: 'xy-panel' },
      createElement('h3', { className: 'xy-panel-head' }, t('settings.profile.title')),
      createElement('label', { className: 'xy-field' },
        createElement('span', { className: 'xy-quick-label' }, t('settings.profile.nickname')),
        createElement('input', {
          className: 'xy-input xy-input-wide', placeholder: t('settings.profile.nicknamePlaceholder'), maxLength: 50,
          autoComplete: 'off', name: 'xy-nickname',
          value: nicknameDraft, onChange: (e: { target: { value: string } }) => setNicknameDraft(e.target.value),
        })),
      createElement('label', { className: 'xy-field' },
        createElement('span', { className: 'xy-quick-label' }, t('settings.profile.occupation')),
        createElement('input', {
          className: 'xy-input xy-input-wide', placeholder: t('settings.profile.occupationPlaceholder'), maxLength: 100,
          autoComplete: 'off', name: 'xy-occupation',
          value: occupationDraft, onChange: (e: { target: { value: string } }) => setOccupationDraft(e.target.value),
        })),
      createElement('label', { className: 'xy-field' },
        createElement('span', { className: 'xy-quick-label' }, t('settings.profile.interests')),
        createElement('input', {
          className: 'xy-input xy-input-wide', placeholder: t('settings.profile.interestsPlaceholder'),
          autoComplete: 'off', name: 'xy-interests',
          value: interestsDraft, onChange: (e: { target: { value: string } }) => setInterestsDraft(e.target.value),
        })),
      createElement('div', { className: 'xy-save-row' },
        createElement('button', {
          className: 'xy-btn xy-btn-primary', disabled: saving, onClick: saveProfile,
        }, saving ? t('settings.profile.saving') : t('settings.profile.save')),
        savedMsg !== '' ? createElement('span', { className: 'xy-saved', role: 'status' },
          // 勾形装饰对读屏隐藏（语义由文案承担），与卡片完成态同一语法
          createElement('span', { 'aria-hidden': 'true' }, '✓ '),
          savedMsg) : null),
      createElement('p', { className: 'xy-hint' }, t('settings.profile.sharedHint'))),
    createElement('section', { className: 'xy-panel' },
      createElement('h3', { className: 'xy-panel-head' }, t('settings.pref.title')),
      snap.status === 'unavailable'
        ? createElement('p', { className: 'xy-hint' }, t('settings.pref.unavailable'))
        : snap.status === 'loading'
          ? createElement('p', { className: 'xy-hint' }, t('settings.pref.loading'))
          : null,
      createElement('label', { className: 'xy-field' },
        createElement('span', { className: 'xy-field-head' },
          createElement('input', {
            type: 'checkbox',
            className: 'xy-toggle',
            name: 'confirmWrites',
            checked: confirmWrites,
            disabled: !writable || pendingToggle !== undefined,
            onChange: (e: { target: { checked: boolean } }) => {
              if (!writable) return
              // 乐观写：先落 UI 再等持久化；失败回滚到快照口径并 toast
              const next = e.target.checked
              setPendingToggle(next)
              void scope.set('confirmWrites', next)
                .then(() => setPendingToggle(undefined))
                .catch((err: unknown) => {
                  setPendingToggle(undefined)
                  toastError(err)
                })
            },
          }),
          t('settings.pref.confirmWrites')),
        createElement('p', { className: 'xy-hint' }, t('settings.pref.confirmWritesHint'))),
      createElement('label', { className: 'xy-field' },
        createElement('span', { className: 'xy-field-head' }, t('settings.pref.memoryLimit')),
        createElement('input', {
          type: 'number', min: 5, max: 200, className: 'xy-input xy-input-num', name: 'memoryInjectLimit', inputMode: 'numeric',
          'aria-label': t('settings.pref.memoryLimit'),
          'aria-invalid': limitError || undefined,
          ...(limitError ? { 'aria-describedby': 'xy-limit-error' } : {}),
          value: limitDraft ?? limit, disabled: !writable,
          onChange: (e: { target: { value: string } }) => { setLimitDraft(e.target.value); setLimitError(false) },
          onBlur: commitLimit,
          onKeyDown: (e: { key: string; currentTarget: { blur(): void } }) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          },
        }),
        createElement('span', { className: 'xy-hint' }, t('settings.pref.memoryLimitHint')),
        limitError
          ? createElement('span', { id: 'xy-limit-error', className: 'xy-field-err', role: 'alert' }, t('settings.pref.limitInvalid'))
          : null)),
    createElement('p', { className: 'xy-hint' }, t('settings.dataHint')))
}
