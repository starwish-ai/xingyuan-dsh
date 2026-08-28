/** 星愿设置整页（设置 → 星愿）：教练风格/画像（星愿库）+ 二次确认开关与注入上限
 * （bundle 常驻命名空间 xingyuan-pref）+ 标签页显隐（bundle 常驻命名空间 xingyuan-ui，
 * 未选星愿也可调）。 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { getJson, postJson } from '../api.js'
import { toastError } from '../ui.js'
import { useXyT, activeLocale, type XyKey } from '../i18n.js'
import { TAB_IDS, type TabId, type TabVisibilityMode } from '../../tab-policy.js'
import {
  MEMORY_LIMIT_MAX,
  MEMORY_LIMIT_MIN,
  PREF_DEFAULTS,
  parseMemoryLimit,
} from '../../pref-policy.js'

/** xingyuan-pref 命名空间快照（对话偏好字段）。 */
interface PrefScopeSnapshotLike {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value?: { readonly confirmWrites?: boolean; readonly memoryInjectLimit?: number }
  readonly writable: boolean
  /** `host` 与宿主文档同步；`memory` 为远程/临时模式，此时任何写入都不会落盘。 */
  readonly mode: 'host' | 'memory'
}

/** xingyuan-ui 命名空间快照（标签页显隐字段）。 */
interface UiScopeSnapshotLike {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value?: {
    readonly tabVisibilityMode?: TabVisibilityMode
    readonly hiddenTabs?: readonly TabId[]
  }
  readonly writable: boolean
}

/** xingyuan-ui 命名空间的 scope 形状（bind 返回结构，见 dsh-client-runtime contract/settings-scope）。 */
export interface UiScopeLike {
  getSnapshot(): UiScopeSnapshotLike
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/**
 * settingsScope.bind() 返回的真实形状：getSnapshot()/subscribe()/set()/unset()。
 * 注意 scope 本身没有 .value 字段——值在快照里（此前直接读 scope.value 导致整节渲染崩溃）。
 * 另：set() 失败是 resolve 而非 reject（内部 catch 后静默 recover），故调用方须事后
 * 比对快照确认落盘，见下方 verifyWritten。
 */
export interface PrefScopeLike {
  getSnapshot(): PrefScopeSnapshotLike
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

/** 显隐三态（顺序即分段按钮顺序；与 tab-policy 字面量同源）。 */
const MODE_OPTIONS: ReadonlyArray<{ readonly mode: TabVisibilityMode; readonly key: XyKey }> = [
  { mode: 'follow', key: 'settings.tabs.mode.follow' },
  { mode: 'show', key: 'settings.tabs.mode.show' },
  { mode: 'hide', key: 'settings.tabs.mode.hide' },
]

/** 六个标签的显示名键（与 tab-visibility 的 entry labelKey 同源）。 */
const TAB_LABEL_KEYS: Record<TabId, XyKey> = {
  today: 'tab.today',
  wishes: 'tab.wishes',
  tasks: 'tab.tasks',
  calendar: 'tab.calendar',
  growth: 'tab.growth',
  memory: 'tab.memory',
}

export function SettingsSection(props: { scope: PrefScopeLike; uiscope: UiScopeLike }): ReactElement {
  const t = useXyT()
  const scope = props.scope
  // 正确订阅：useSyncExternalStore + getSnapshot（scope 契约见 dsh-client-runtime contract/settings-scope）
  const snap = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const writable = snap.status === 'ready' && snap.writable
  const limit = String(snap.value?.memoryInjectLimit ?? PREF_DEFAULTS.memoryInjectLimit)

  // 界面偏好命名空间（标签页显隐）独立订阅：两个命名空间各自走自己的快照
  const uisnap = useSyncExternalStore(
    (listener) => props.uiscope.subscribe(listener),
    () => props.uiscope.getSnapshot(),
  )
  const uiWritable = uisnap.status === 'ready' && uisnap.writable

  // 教练风格与画像存于星愿数据库 global 单例（与对话侧工具同一数据源），经 /xingyuan/api/profile 读写
  const [profile, setProfile] = useState<ProfilePayloadLike | undefined>(undefined)
  const [profileError, setProfileError] = useState<string | undefined>(undefined)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [occupationDraft, setOccupationDraft] = useState('')
  const [interestsDraft, setInterestsDraft] = useState('')
  // 记忆注入上限：草稿态编辑（null=显示快照值），失焦才校验提交——避免逐键持久化与非法中间值死锁
  const [limitDraft, setLimitDraft] = useState<string | null>(null)
  const [limitError, setLimitError] = useState(false)
  // 记忆注入上限：写入在途的乐观值（与开关的 pendingToggle 同款，用于禁用控件并顶住回显，
  // 否则提交后到快照回折前会闪回旧值）
  const [pendingLimit, setPendingLimit] = useState<number | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  // 二次确认开关：本地乐观值（undefined=跟随远端快照）——写入在途时 UI 立即响应，失败回滚
  const [pendingToggle, setPendingToggle] = useState<boolean | undefined>(undefined)
  // 标签页显隐：模式与勾选各自乐观（写入在途时禁用对应控件，失败回滚 + toast）
  const [pendingMode, setPendingMode] = useState<TabVisibilityMode | undefined>(undefined)
  const [pendingHidden, setPendingHidden] = useState<readonly TabId[] | undefined>(undefined)
  const savedTimer = useRef<number | undefined>(undefined)
  // 档案加载代数守卫：慢响应不得覆盖用户已开始的草稿
  const profileSeqRef = useRef(0)
  // 偏好写序号：两个控件共用同一个 scope（即同一条写队列）。控制器以 writeGeneration
  // 做栅栏——一次写被更新的写取代时只记 pendingRevision、不回折快照，而其 .then 又
  // 先于后继写执行，此时比对快照必然读到旧值。故只有最后结算的那次有权判定成败。
  const writeSeqRef = useRef(0)
  // 开关显示值：乐观本地值优先（写入在途），否则远端快照，值缺席回落 schema 默认。
  // 不可写成 `!== false`——那样「值未知」会被渲染成「已开启」，安全策略类开关尤其不能撒谎。
  const confirmWrites = pendingToggle ?? snap.value?.confirmWrites ?? PREF_DEFAULTS.confirmWrites
  // 偏好区提示：判定顺序不可换——memory 模式下 status 同样是 unavailable，
  // 先判 mode 才不会把「远程/临时模式」误报成「命名空间未就绪」
  const prefNoticeKey: XyKey | undefined =
    snap.status === 'loading' ? 'settings.pref.loading'
      : snap.mode === 'memory' ? 'settings.pref.unavailable'
      : snap.status === 'unavailable' ? 'settings.pref.notRegistered'
      : !snap.writable ? 'settings.pref.readOnly'
      : undefined
  // 标签页显隐显示值：乐观优先，否则远端快照，再兜底 schema 默认
  const tabMode: TabVisibilityMode = pendingMode ?? uisnap.value?.tabVisibilityMode ?? 'follow'
  const hiddenTabs: readonly TabId[] = pendingHidden ?? uisnap.value?.hiddenTabs ?? []

  /** 切换显隐模式：乐观写，失效即回滚（分段按钮视觉与持久化口径一致）。 */
  const switchTabMode = (next: TabVisibilityMode): void => {
    if (!uiWritable || pendingMode !== undefined || next === tabMode) return
    setPendingMode(next)
    void props.uiscope.set('tabVisibilityMode', next)
      .then(() => setPendingMode(undefined))
      .catch((err: unknown) => {
        setPendingMode(undefined)
        toastError(err)
      })
  }

  /** 勾选单个标签（勾选 = 显示）：成员关系按 TAB_IDS 稳定序重算，写入整体数组。 */
  const toggleTab = (id: TabId, willShow: boolean): void => {
    if (!uiWritable || pendingHidden !== undefined || tabMode === 'hide') return
    const next = willShow
      ? TAB_IDS.filter((tid) => tid !== id && hiddenTabs.includes(tid))
      : TAB_IDS.filter((tid) => tid === id || hiddenTabs.includes(tid))
    setPendingHidden(next)
    void props.uiscope.set('hiddenTabs', next)
      .then(() => setPendingHidden(undefined))
      .catch((err: unknown) => {
        setPendingHidden(undefined)
        toastError(err)
      })
  }

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

  /**
   * 校验偏好是否真的落盘：scope.set() 失败时是 resolve 而非 reject（内部 catch 后静默
   * recover），故只能在写入结算后比对快照——值没变即视为未保存，须显式告知用户。
   *
   * seq 为发起写时取的号：只有仍是队列里最后一次写才校验，否则快照本就不会回折本次
   * 的结果（被更新的写取代），比对必然误报。见 writeSeqRef。
   */
  const verifyWritten = (
    seq: number,
    field: 'confirmWrites' | 'memoryInjectLimit',
    value: boolean | number,
  ): void => {
    if (seq !== writeSeqRef.current) return
    if (scope.getSnapshot().value?.[field] !== value) toastError(new Error(t('settings.pref.writeFailed')))
  }

  const commitLimit = (): void => {
    const raw = limitDraft
    setLimitDraft(null)
    setLimitError(false)
    if (raw === null || !writable) return
    // 空串视为放弃编辑：静默回显保存值。若在此报错，会同时出现「已填回旧值」与
    // 「请输入 5-200 的整数」两条互相矛盾的信息。
    if (raw.trim() === '') return
    const parsed = parseMemoryLimit(raw)
    // 非法输入就地报错（不再静默回弹）：用户明确知道哪里错、该怎么改
    if (parsed === undefined) { setLimitError(true); return }
    if (parsed.clamped) {
      // 越界但可夹取：按夹取值提交并回显，同时给出行内提示
      const seq = ++writeSeqRef.current
      setPendingLimit(parsed.value)
      void scope.set('memoryInjectLimit', parsed.value)
        .then(() => {
          setLimitDraft(String(parsed.value))
          setPendingLimit(undefined)
          verifyWritten(seq, 'memoryInjectLimit', parsed.value)
        })
        .catch((err: unknown) => { setPendingLimit(undefined); toastError(err) })
      setLimitError(true)
      return
    }
    if (parsed.value === snap.value?.memoryInjectLimit) return
    const seq = ++writeSeqRef.current
    setPendingLimit(parsed.value)
    void scope.set('memoryInjectLimit', parsed.value)
      .then(() => {
        setPendingLimit(undefined)
        verifyWritten(seq, 'memoryInjectLimit', parsed.value)
      })
      .catch((err: unknown) => { setPendingLimit(undefined); toastError(err) })
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
      // 整页 section 没有官方卡片那套「按命名空间自动显隐」的保护，失败呈现归注册方
      prefNoticeKey !== undefined
        ? createElement('p', { className: 'xy-hint' }, t(prefNoticeKey))
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
              const seq = ++writeSeqRef.current
              void scope.set('confirmWrites', next)
                .then(() => { setPendingToggle(undefined); verifyWritten(seq, 'confirmWrites', next) })
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
          type: 'number', min: MEMORY_LIMIT_MIN, max: MEMORY_LIMIT_MAX,
          className: 'xy-input xy-input-num', name: 'memoryInjectLimit', inputMode: 'numeric',
          'aria-label': t('settings.pref.memoryLimit'),
          'aria-invalid': limitError || undefined,
          ...(limitError ? { 'aria-describedby': 'xy-limit-error' } : {}),
          // 写入在途时顶住乐观值并禁用（与开关同款），避免闪回旧值与并发写交错
          value: limitDraft ?? (pendingLimit !== undefined ? String(pendingLimit) : limit),
          disabled: !writable || pendingLimit !== undefined,
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
    // 标签页显示：模式三态（跟随会话/始终显示/始终隐藏）+ 六个标签勾选 chips。
    // 与教练风格卡同一 xy-seg 视觉语法；「始终隐藏」时勾选区整组禁用置灰。
    // 命名空间常驻于 bundle 层（未选星愿预设也可调），见 src/ui-settings.ts 头注。
    createElement('section', { className: 'xy-panel' },
      createElement('h3', { className: 'xy-panel-head' }, t('settings.tabs.title')),
      uisnap.status === 'unavailable'
        ? createElement('p', { className: 'xy-hint' }, t('settings.tabs.unavailable'))
        : uisnap.status === 'loading'
          ? createElement('p', { className: 'xy-hint' }, t('settings.tabs.loading'))
          : null,
      createElement('div', { className: 'xy-seg', role: 'group', 'aria-label': t('settings.tabs.title') },
        ...MODE_OPTIONS.map((opt) => createElement('button', {
          key: opt.mode,
          className: `xy-seg-btn${tabMode === opt.mode ? ' xy-on' : ''}`,
          'aria-pressed': tabMode === opt.mode,
          disabled: !uiWritable || pendingMode !== undefined,
          onClick: () => switchTabMode(opt.mode),
        }, t(opt.key)))),
      createElement('div', {
        className: 'xy-seg',
        role: 'group',
        'aria-label': t('settings.tabs.chooseTab'),
      },
        ...TAB_IDS.map((id) => {
          const shown = !hiddenTabs.includes(id)
          return createElement('button', {
            key: id,
            className: `xy-seg-btn${shown ? ' xy-on' : ''}`,
            'aria-pressed': shown,
            disabled: !uiWritable || pendingHidden !== undefined || tabMode === 'hide',
            onClick: () => toggleTab(id, !shown),
          }, t(TAB_LABEL_KEYS[id]))
        })),
      createElement('p', { className: 'xy-hint' }, t('settings.tabs.hint'))),
    createElement('p', { className: 'xy-hint' }, t('settings.dataHint')))
}
