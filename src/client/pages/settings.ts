/** 星愿设置整页（设置 → 星愿）：教练风格/画像（星愿库）+ 写操作确认与对话偏好 +
 * 标签页显隐（后三组同挂 bundle 主行的 volatile 配置表单，未选星愿也可调）。 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { getJson, postJson } from '../api.js'
import { toastError } from '../ui.js'
import { useXyT, activeLocale, type XyKey } from '../i18n.js'
import { TAB_IDS, TAB_VISIBILITY_DEFAULTS, normalizeHiddenTabs, type TabId, type TabVisibilityMode } from '../../tab-policy.js'
import {
  CONFIRM_OPS,
  MEMORY_LIMIT_MAX,
  MEMORY_LIMIT_MIN,
  PREF_DEFAULTS,
  normalizeConfirmOps,
  parseMemoryLimit,
  type ConfirmOp,
  type SettingsFormValue,
} from '../../pref-policy.js'

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

/** 确认类目的显示名键（与 pref-policy CONFIRM_OPS 一一对应）。 */
const CONFIRM_OP_LABEL_KEYS: Record<ConfirmOp, XyKey> = {
  create: 'settings.pref.confirmOps.create',
  checkin: 'settings.pref.confirmOps.checkin',
  cancelCheckin: 'settings.pref.confirmOps.cancelCheckin',
  claim: 'settings.pref.confirmOps.claim',
  update: 'settings.pref.confirmOps.update',
  memorySave: 'settings.pref.confirmOps.memorySave',
}

export function SettingsSection(props: { form: ConfigForm<SettingsFormValue> }): ReactElement {
  const t = useXyT()
  const form = props.form
  // 单表单订阅：对话偏好与界面偏好同挂一条 profile 行的 volatile 配置，宿主按行 id
  // 缓存表单实例，所以本页与 tab-visibility 拿到的就是同一个对象、同一条写队列。
  const snap = useSyncExternalStore(
    (listener) => form.subscribe(listener),
    () => form.getSnapshot(),
  )
  const writable = snap.status === 'ready' && snap.writable
  const limit = String(snap.value?.memoryInjectLimit ?? PREF_DEFAULTS.memoryInjectLimit)

  // 教练风格与画像存于星愿数据库 global 单例（与对话侧工具同一数据源），经 /xingyuan/api/profile 读写
  const [profile, setProfile] = useState<ProfilePayloadLike | undefined>(undefined)
  const [profileError, setProfileError] = useState<string | undefined>(undefined)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [occupationDraft, setOccupationDraft] = useState('')
  const [interestsDraft, setInterestsDraft] = useState('')
  // 记忆注入上限：草稿态编辑（null=显示快照值），失焦才校验提交——避免逐键持久化与非法中间值死锁。
  // 错误态分两档：invalid=未保存的就地报错；clamped=越界已按边界值保存的说明性提示（不是错误）
  const [limitDraft, setLimitDraft] = useState<string | null>(null)
  const [limitError, setLimitError] = useState<'invalid' | 'clamped' | undefined>(undefined)
  // 记忆注入上限：写入在途的乐观值（与开关的 pendingToggle 同款，用于禁用控件并顶住回显，
  // 否则提交后到快照回折前会闪回旧值）
  const [pendingLimit, setPendingLimit] = useState<number | undefined>(undefined)
  // 确认卡语言：乐观值（写入在途顶住回显），失败回滚 + toast
  const [pendingLang, setPendingLang] = useState<'zh' | 'en' | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  // 二次确认开关：本地乐观值（undefined=跟随远端快照）——写入在途时 UI 立即响应，失败回滚
  const [pendingToggle, setPendingToggle] = useState<boolean | undefined>(undefined)
  // 确认类目明细：乐观值为「合并后的完整对象」（每次写整体下发），失败回滚
  const [pendingOps, setPendingOps] = useState<Record<ConfirmOp, boolean> | undefined>(undefined)
  // 标签页显隐：模式与勾选各自乐观（写入在途时禁用对应控件，失败回滚 + toast）
  const [pendingMode, setPendingMode] = useState<TabVisibilityMode | undefined>(undefined)
  const [pendingHidden, setPendingHidden] = useState<readonly TabId[] | undefined>(undefined)
  const savedTimer = useRef<number | undefined>(undefined)
  // 档案加载代数守卫：慢响应不得覆盖用户已开始的草稿
  const profileSeqRef = useRef(0)
  // 开关显示值：乐观本地值优先（写入在途），否则远端快照，值缺席回落 schema 默认。
  // 不可写成 `!== false`——那样「值未知」会被渲染成「已开启」，安全策略类开关尤其不能撒谎。
  const confirmWrites = pendingToggle ?? snap.value?.confirmWrites ?? PREF_DEFAULTS.confirmWrites
  // 确认类目显示值：乐观优先 → 快照（脏键容错回落默认）→ 全默认
  const confirmOps = pendingOps ?? normalizeConfirmOps(snap.value?.confirmOps)
  // 确认卡语言显示值：乐观优先 → 快照 → 默认 zh（normalize 容脏值）
  const confirmLang: 'zh' | 'en' = pendingLang ?? (snap.value?.confirmLang === 'en' ? 'en' : 'zh')
  // 标签页显隐显示值：乐观优先，否则远端快照，再兜底 schema 默认
  // 标签页显隐显示值：乐观优先，否则远端快照，再兜底策略层默认（与 tab-policy 同源，
  // 不在此重写 'follow'/[]——默认值漂移会让回显与控制器判定分叉）
  const tabMode: TabVisibilityMode = pendingMode ?? snap.value?.tabVisibilityMode ?? TAB_VISIBILITY_DEFAULTS.tabVisibilityMode
  const hiddenTabs: readonly TabId[] = normalizeHiddenTabs(pendingHidden ?? snap.value?.hiddenTabs)

  // 表单级不可用提示（整页一次说清，不逐卡重复）。判定顺序不可换：memory 模式下
  // status 同样是 unavailable，先判 mode 才不会把「远程/临时模式」误报成「该行未就绪」。
  const formNoticeKey: XyKey | undefined =
    snap.status === 'loading' ? 'settings.pref.loading'
      : snap.mode === 'memory' ? 'settings.pref.unavailable'
      : snap.status === 'unavailable' ? 'settings.pref.notRegistered'
      : !snap.writable ? 'settings.pref.readOnly'
      : undefined

  /**
   * 提交一次偏好写入：乐观值由调用方先行落好，这里负责结算——宿主接受返回 true，
   * 被拒或跳过返回 false（0.1.7 起 set() 如实回报，不再需要写后比对快照），
   * 传输失败才 reject。写队列与取代栅栏归宿主表单实例所有。
   * field 收窄成表单键联合类型：写错字段名不再有编译期以外的发现途径（宿主只会把它
   * 当成不存在的键返回 false，用户看到的是一条含义模糊的「保存失败」toast）。
   */
  const writePref = (field: keyof SettingsFormValue, value: unknown, settle: () => void): void => {
    void form.set(field, value)
      .then((accepted) => {
        settle()
        if (!accepted) toastError(new Error(t('settings.pref.writeFailed')))
      })
      .catch((err: unknown) => {
        settle()
        toastError(err)
      })
  }

  /** 切换显隐模式。 */
  const switchTabMode = (next: TabVisibilityMode): void => {
    if (!writable || pendingMode !== undefined || next === tabMode) return
    setPendingMode(next)
    writePref('tabVisibilityMode', next, () => setPendingMode(undefined))
  }

  /** 勾选单个标签（勾选 = 显示）：成员关系按 TAB_IDS 稳定序重算，写入整体数组。 */
  const toggleTab = (id: TabId, willShow: boolean): void => {
    if (!writable || pendingHidden !== undefined || tabMode === 'hide') return
    const next = willShow
      ? TAB_IDS.filter((tid) => tid !== id && hiddenTabs.includes(tid))
      : TAB_IDS.filter((tid) => tid === id || hiddenTabs.includes(tid))
    setPendingHidden(next)
    writePref('hiddenTabs', next, () => setPendingHidden(undefined))
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

  /** 切换确认卡语言。 */
  const switchConfirmLang = (next: 'zh' | 'en'): void => {
    if (!writable || pendingLang !== undefined || next === confirmLang) return
    setPendingLang(next)
    writePref('confirmLang', next, () => setPendingLang(undefined))
  }

  /**
   * 切换单个确认类目：整体写合并后的 confirmOps 对象（与 hiddenTabs 整组写入同款），
   * 乐观值顶住回显、失败回滚 + toast。总开关关闭时明细行禁用（不弹卡由总开关决定）。
   */
  const toggleConfirmOp = (op: ConfirmOp, next: boolean): void => {
    if (!writable || pendingOps !== undefined || !confirmWrites || confirmOps[op] === next) return
    const merged = { ...confirmOps, [op]: next }
    setPendingOps(merged)
    writePref('confirmOps', merged, () => setPendingOps(undefined))
  }

  const commitLimit = (): void => {
    const raw = limitDraft
    setLimitDraft(null)
    setLimitError(undefined)
    if (raw === null || !writable) return
    // 空串视为放弃编辑：静默回显保存值。若在此报错，会同时出现「已填回旧值」与
    // 「请输入 5-200 的整数」两条互相矛盾的信息。
    if (raw.trim() === '') return
    const parsed = parseMemoryLimit(raw)
    // 非法输入就地报错（不再静默回弹）：用户明确知道哪里错、该怎么改
    if (parsed === undefined) { setLimitError('invalid'); return }
    if (parsed.clamped) {
      // 越界但可夹取：按夹取值提交并回显，给说明性提示而非报错——值已成功保存，
      // 「请输入合法整数」的报错口径与实际行为矛盾
      setPendingLimit(parsed.value)
      writePref('memoryInjectLimit', parsed.value, () => {
        setLimitDraft(String(parsed.value))
        setPendingLimit(undefined)
      })
      setLimitError('clamped')
      return
    }
    if (parsed.value === snap.value?.memoryInjectLimit) return
    setPendingLimit(parsed.value)
    writePref('memoryInjectLimit', parsed.value, () => setPendingLimit(undefined))
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

  // 分节各自成面板卡（与全站卡片语言一致）；开关类设置用 row 语法（标签+说明在左、
  // 控件在右），表单类字段保持 label 在上的纵排——两类各有惯例，不混用
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
      // 分段按钮已表达当前风格，说明行只讲作用不报状态；错误态保留重试入口
      createElement('p', { className: 'xy-hint' },
        profileError !== undefined ? t('settings.coach.loadFailed', { error: profileError })
          : profile === undefined ? t('common.loading') + '…'
          : t('settings.coach.hint')),
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
    // 表单不可用时整页一次说清（作用于下方三卡：写操作确认 / 对话偏好 / 标签页显示）。
    // 0.1.7 起本页只在宿主真的组装出那一行时才注册（configForms.whileServed），
    // 所以这里出现的不再是「命名空间缺席」而是「行未就绪 / 只读 / 临时模式」。
    formNoticeKey !== undefined
      ? createElement('p', { className: 'xy-hint' }, t(formNoticeKey))
      : null,
    // 写操作确认独立成卡：安全类设置自成一组，与一般行为参数分离
    createElement('section', { className: 'xy-panel' },
      createElement('h3', { className: 'xy-panel-head' }, t('settings.confirm.title')),
      createElement('label', { className: 'xy-setrow' },
        createElement('span', { className: 'xy-setrow-main' },
          createElement('span', { className: 'xy-setrow-label' }, t('settings.confirm.master')),
          createElement('span', { className: 'xy-setrow-desc' }, t('settings.pref.confirmWritesHint'))),
        createElement('input', {
          type: 'checkbox',
          className: 'xy-toggle',
          name: 'confirmWrites',
          checked: confirmWrites,
          disabled: !writable || pendingToggle !== undefined,
          onChange: (e: { target: { checked: boolean } }) => {
            if (!writable) return
            // 乐观写：先落 UI 再等持久化；宿主拒绝/跳过时回滚口径并 toast
            const next = e.target.checked
            setPendingToggle(next)
            writePref('confirmWrites', next, () => setPendingToggle(undefined))
          },
        })),
      // 确认类目明细（锁定删除行恒展示）：总开关关闭时整组禁用置灰——不弹卡由总开关
      // 决定；禁用原因由组尾 hint 承担（aria-describedby 关联），不在每行重复
      createElement('div', {
        className: `xy-confirm-ops${confirmWrites ? '' : ' xy-confirm-ops-off'}`,
        role: 'group',
        'aria-labelledby': 'xy-confirm-ops-head',
        'aria-describedby': 'xy-confirm-ops-hint',
      },
        createElement('span', { className: 'xy-op-group-head', id: 'xy-confirm-ops-head' }, t('settings.pref.confirmOps.group')),
        createElement('div', { className: 'xy-setrows' },
          ...CONFIRM_OPS.map((op) => createElement('label', { className: 'xy-setrow', key: op },
            createElement('span', { className: 'xy-setrow-main' },
              createElement('span', { className: 'xy-setrow-label' }, t(CONFIRM_OP_LABEL_KEYS[op]))),
            createElement('input', {
              type: 'checkbox',
              className: 'xy-toggle',
              name: `confirmOps.${op}`,
              checked: confirmOps[op],
              disabled: !writable || pendingOps !== undefined || !confirmWrites,
              onChange: (e: { target: { checked: boolean } }) => toggleConfirmOp(op, e.target.checked),
            }))),
          // 锁定类目：div + 「始终开启」徽章（不可交互，不用禁用开关表达恒开语义）
          createElement('div', { className: 'xy-setrow' },
            createElement('span', { className: 'xy-setrow-main' },
              createElement('span', { className: 'xy-setrow-label' }, t('settings.pref.confirmOps.delete')),
              createElement('span', { className: 'xy-setrow-desc' }, t('settings.pref.confirmOps.deleteHint'))),
            createElement('span', { className: 'xy-locked' }, t('settings.pref.confirmOps.locked'))))),
      createElement('span', { className: 'xy-hint', id: 'xy-confirm-ops-hint' }, t('settings.pref.confirmOps.hint'))),
    // 一般对话行为参数：记忆注入上限 + 确认卡语言
    createElement('section', { className: 'xy-panel' },
      createElement('h3', { className: 'xy-panel-head' }, t('settings.pref.title')),
      createElement('div', { className: 'xy-setrows' },
        createElement('label', { className: 'xy-setrow' },
          createElement('span', { className: 'xy-setrow-main' },
            createElement('span', { className: 'xy-setrow-label' }, t('settings.pref.memoryLimit')),
            createElement('span', { className: 'xy-setrow-desc' }, t('settings.pref.memoryLimitHint')),
            limitError === 'invalid'
              ? createElement('span', { id: 'xy-limit-error', className: 'xy-field-err', role: 'alert' }, t('settings.pref.limitInvalid'))
              : limitError === 'clamped'
                ? createElement('span', { id: 'xy-limit-error', className: 'xy-hint', role: 'status' }, t('settings.pref.limitClamped'))
                : null),
          createElement('input', {
            type: 'number', min: MEMORY_LIMIT_MIN, max: MEMORY_LIMIT_MAX,
            className: 'xy-input xy-input-num', name: 'memoryInjectLimit', inputMode: 'numeric',
            autoComplete: 'off',
            'aria-label': t('settings.pref.memoryLimit'),
            'aria-invalid': limitError === 'invalid' || undefined,
            ...(limitError ? { 'aria-describedby': 'xy-limit-error' } : {}),
            // 写入在途时顶住乐观值并禁用（与开关同款），避免闪回旧值与并发写交错
            value: limitDraft ?? (pendingLimit !== undefined ? String(pendingLimit) : limit),
            disabled: !writable || pendingLimit !== undefined,
            onChange: (e: { target: { value: string } }) => { setLimitDraft(e.target.value); setLimitError(undefined) },
            onBlur: commitLimit,
            onKeyDown: (e: { key: string; currentTarget: { blur(): void } }) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            },
          })),
        // 确认卡语言：平台不向 host 侧暴露界面语言（rc.2 实测），对话侧确认卡文案无法
        // 自动跟随界面语言——由此处显式选择，即时热生效（hitl/tools 每次执行读 thunk）。
        // 两档枚举与教练风格共用分段控件（下拉对小枚举过重）；行内是按钮组故不用 label
        createElement('div', { className: 'xy-setrow' },
          createElement('span', { className: 'xy-setrow-main' },
            createElement('span', { className: 'xy-setrow-label' }, t('settings.pref.confirmLang')),
            createElement('span', { className: 'xy-setrow-desc' }, t('settings.pref.confirmLangHint'))),
          createElement('span', { className: 'xy-seg', role: 'group', 'aria-label': t('settings.pref.confirmLang') },
            ...(['zh', 'en'] as const).map((lang) => createElement('button', {
              key: lang,
              type: 'button',
              className: `xy-seg-btn${confirmLang === lang ? ' xy-on' : ''}`,
              'aria-pressed': confirmLang === lang,
              disabled: !writable || pendingLang !== undefined,
              onClick: () => switchConfirmLang(lang),
            }, t(lang === 'zh' ? 'settings.pref.confirmLang.zh' : 'settings.pref.confirmLang.en'))))))),
    // 标签页显示：模式三态（跟随会话/始终显示/始终隐藏）+ 六个标签勾选 chips。
    // 与教练风格卡同一 xy-seg 视觉语法；「始终隐藏」时勾选区整组禁用置灰。
    // 不可用态由页级 formNoticeKey 一次说清（与上两卡同一表单、同一状态源）。
    createElement('section', { className: 'xy-panel' },
      createElement('h3', { className: 'xy-panel-head' }, t('settings.tabs.title')),
      createElement('div', { className: 'xy-seg', role: 'group', 'aria-label': t('settings.tabs.title') },
        ...MODE_OPTIONS.map((opt) => createElement('button', {
          key: opt.mode,
          className: `xy-seg-btn${tabMode === opt.mode ? ' xy-on' : ''}`,
          'aria-pressed': tabMode === opt.mode,
          disabled: !writable || pendingMode !== undefined,
          onClick: () => switchTabMode(opt.mode),
        }, t(opt.key)))),
      createElement('div', {
        className: 'xy-seg',
        role: 'group',
        'aria-label': t('settings.tabs.chooseTab'),
      },
        ...TAB_IDS.map((id) => {
          const shown = !hiddenTabs.includes(id)
          // 多选勾选态加勾形装饰（对读屏隐藏，状态由 aria-pressed 承担）：
          // 与上方单选的模式分段在视觉上区分「可多选」
          return createElement('button', {
            key: id,
            className: `xy-seg-btn${shown ? ' xy-on' : ''}`,
            'aria-pressed': shown,
            disabled: !writable || pendingHidden !== undefined || tabMode === 'hide',
            onClick: () => toggleTab(id, !shown),
          }, shown ? createElement('span', { 'aria-hidden': 'true' }, '✓ ') : null, t(TAB_LABEL_KEYS[id]))
        })),
      createElement('p', { className: 'xy-hint' }, t('settings.tabs.hint'))),
    createElement('p', { className: 'xy-hint' }, t('settings.dataHint')))
}
