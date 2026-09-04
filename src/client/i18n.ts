/**
 * 星愿 client 半侧唯一文案源（zh/en 双语）。
 *
 * 平台事实（dsh-client-locale）：壳 locale 插件持有 ns×locale 字典注册表，
 * `bind(ns)` 返回「调用时读当前语言」的翻译函数；语言切换 bump revision。
 * 本文件经 ctx.get('locale') 取服务（结构化最小类型，不新增依赖）：
 * - 有：注册 zh/en 两份字典（disposer 随插件 effect 卸载），t = bind(XY_NS)；
 * - 无（headless/异常环境）：回落 zh 字典直查，功能不受损。
 *
 * 组件内一律 useXyT()（useSyncExternalStore 订阅 revision——卡片槽被壳钉死
 * 'conversation' 命名空间、类型不可换源，故用订阅驱动重渲而非 slot 注入席位）；
 * 命令式场景（toast/confirm）直接调用模块级 t()。键集同构由类型约束：
 * EN_DICT 显式声明为 Record<keyof typeof ZH_DICT, string>，缺键/多键即编译错误。
 */
import { useSyncExternalStore } from 'react'

/** locale 命名空间（插件私有；与壳 common 词汇互不干扰）。 */
export const XY_NS = 'xingyuan'

// 把本插件命名空间并入 slot 系统的命名空间表：register 的 `locale:` 选项与
// 标签 thunk 的语言跟随机制据此放行。值类型 string = 宽键域（标签场景无需窄化）。
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    xingyuan: string
  }
}

/** 翻译函数形状（与 dsh-client-ui-slots 的 Translate 结构等价）。 */
export type XyTranslate = (key: string, params?: Record<string, unknown>) => string

/** 结构化最小 LocaleFace（避免对技术预览期包的版本钉死）。 */
interface LocaleFaceLike {
  getSnapshot(): { readonly revision: number }
  subscribe(fn: () => void): () => void
  bind(ns: string): XyTranslate
}

function asFace(value: unknown): LocaleFaceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<LocaleFaceLike>
  if (typeof candidate.bind !== 'function' || typeof candidate.subscribe !== 'function') return undefined
  return candidate as LocaleFaceLike
}

// ===== 中文词典（key 权威源；导出供测试做「客户端词表 ↔ 服务端权威源」对拍）=====

export const ZH_DICT = {
  // --- 通用 ---
  'common.retry': '重试',
  'tab.today': '今日',
  'tab.wishes': '愿望',
  'tab.tasks': '任务',
  'tab.calendar': '日历',
  'tab.growth': '成长',
  'tab.memory': '记忆',
  'common.loading': '加载中',
  'common.cancel': '取消',
  'common.confirm': '确认',
  'common.save': '保存',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.requestFailed': '请求失败',
  'common.actionFailed': '操作失败',
  'common.requestTimeout': '请求超时，请重试',
  'common.networkError': '网络连接失败，请确认星愿服务已启动后重试',
  'common.dayUnit': '{n} 天',
  'common.countUnit': '{n} 次',
  'common.countUnitOne': '{n} 次',
  'common.dateSuffix': '（{date}）',
  'common.httpStatus': '（{status}）',
  'common.staleData': '数据刷新失败，当前显示的可能不是最新数据。',

  // --- 卡片徽章与状态 ---
  'badge.wish': '愿望',
  'badge.task': '任务',
  'badge.chart': '图表',
  'badge.micro': '微行动',
  'state.deleted': '已删除「{title}」',
  'state.done': '已完成',

  // --- 愿望卡 / 愿望页 ---
  'wish.progress': '进度 {percent}%',
  'wish.progressHasPending': '含未领取任务',
  'wish.eta': '预计完成 {date}',
  'wish.noTasks': '暂无下属任务——在对话里告诉我，让我为它推荐打卡任务',
  'wish.pageTitle': '我的愿望',
  'wish.summary': '{active} 个进行中{achieved}',  'wish.achievedSuffix': ' · {n} 个已达成',
  'wish.sectionAchieved': '已达成',
  'wish.empty.title': '还没有愿望',
  'wish.empty.hint': '告诉我想实现什么，我来帮你拆解成可坚持的计划。',

  // --- 任务 ---
  'task.upcoming': '近期打卡日：{dates}',
  'task.status.pending': '待领取',
  'task.status.in_progress': '进行中',
  'task.status.closed': '已完结',
  'task.status.achieved': '已达成',
  'task.status.expired': '已过期',
  'task.nextDate': '下次 {date}',
  'task.due': '截止 {date}',
  'task.group.in_progress': '进行中',
  'task.group.pending': '待领取',
  'task.group.achieved': '已达成',
  'task.group.expired': '已过期',
  'task.claimExpiredHint': '该任务截止日已过，无法领取——可展开详情延长截止日重新开始',
  'task.expiredHint': '截止日已过——在下方延长截止日即可重新开始，也可以在对话里让我处理。',
  'task.pageTitle': '全部任务',
  'task.totalCount': '共 {n} 个',
  'task.empty.title': '还没有任务',
  'task.empty.hint': '告诉我你想养成的习惯，或从「愿望」页开始规划。',

  // --- 周期 ---
  'cycle.once': '仅一次',
  'cycle.daily': '每日',
  'cycle.weekly': '每周',
  'cycle.monthly': '每月',

  // --- 动作按钮 ---
  'action.claim': '领取',
  'action.checkin': '✓ 打卡',
  'action.checkinFuture': '提前打卡 {date}',
  'action.checkinThisDay': '打卡此日',
  'action.undoCheckin': '撤销',
  'action.cancelCheckin': '取消打卡',
  'action.cancelCheckinAria': '撤销{date}的打卡',  'action.expand': '展开详情',
  'action.collapse': '收起详情',
  'action.createWish': '＋ 新建愿望',
  'action.createTask': '＋ 新建任务',
  'action.manageCategories': '分类管理',
  'action.askAi': '让 AI 总结',

  // --- 动作反馈 toast ---
  'toast.claimed': '已领取「{name}」，去打卡吧',
  'toast.checkinOk': '打卡成功',
  'toast.undone': '打卡已撤销',
  'toast.undoneAt': '已撤销{date}的打卡',
  'toast.wishCreated': '已创建愿望「{title}」',
  'toast.taskCreated': '已创建任务「{name}」，领取后开始打卡',
  'toast.deleted': '已删除「{name}」',
  'toast.categoryRenamed': '分类已改名为「{name}」',
  'toast.categoryColored': '「{name}」配色已更新',
  'toast.categoryColorReset': '「{name}」配色已重置，跟随愿望默认色',
  'toast.categoryDeleted': '已清除「{name}」的自定义颜色',

  // --- 确认弹窗 ---
  'confirm.futureCheckin': '「{name}」的打卡日 {date} 在今天之后，提前打卡表示承诺当天完成。确认？',
  'confirm.undoToday': '确定撤销「{name}」今天的打卡吗？进度将回退。',
  'confirm.undoAt': '确定撤销「{name}」在{date}的打卡吗？进度将回退。',
  'confirm.futureAt': '「{name}」的打卡日 {date} 在今天之后，提前打卡表示承诺当天完成。确认？',
  'confirm.deleteTask': '确定删除任务「{name}」吗？其打卡记录与微行动拆解将一并删除，不可恢复。',
  'confirm.deleteWish': '确定删除愿望「{name}」吗？下属任务、打卡记录与微行动拆解将一并删除，不可恢复。',
  'confirm.renameCategory': '把分类「{old}」下的全部愿望改名为「{new}」吗？（共 {count} 个）',  'confirm.deleteEmptyCategory': '删除空分类「{name}」的自定义颜色吗？',

  // --- 今日页 ---
  'today.title': '今日打卡 · {date}',
  'today.noneToday': '今天没有安排',
  'today.summary': '{checked}/{total} · {ratio}%',
  'today.allDone': '今天的打卡已全部完成，干得漂亮！',
  'today.sectionOpen': '待完成',
  'today.sectionDone': '已完成',
  'today.empty.title': '今天没有安排打卡任务',
  'today.empty.hint': '去「愿望」页看看，或直接告诉我想养成的新习惯。',

  // --- 日历页 ---
  'cal.weekday.1': '一',
  'cal.weekday.2': '二',
  'cal.weekday.3': '三',
  'cal.weekday.4': '四',
  'cal.weekday.5': '五',
  'cal.weekday.6': '六',
  'cal.weekday.7': '日',
  'cal.backToMonth': '回到本月',
  'cal.prevMonth': '上个月',
  'cal.nextMonth': '下个月',
  'cal.legend.c0': '无打卡安排',
  'cal.legend.c1': '待打卡',
  'cal.legend.c2': '部分完成',
  'cal.legend.c3': '全部完成',
  'cal.cellAria.none': '{date}，无打卡安排',
  'cal.cellAria.some': '{date}，已完成 {checked}/{due}',
  'cal.cellTitle.none': '{date}，无打卡安排',
  'cal.cellTitle.some': '{date}，打卡 {checked}/{due}',
  'cal.panelHint': '点击日期查看当日任务，可直接补卡或取消打卡。',
  'cal.dayLoadFailed': '当日任务加载失败，请重试。',
  'cal.dayEmpty': '这一天没有任务安排。',
  'cal.state.checked': '✓ 已打卡',
  'cal.state.todo': '○ 待打卡',

  // --- 成长页 ---
  'growth.levelLabel': '当前等级',
  'growth.levelFallback': '初心者',
  'growth.maxed': '已满级',
  'growth.expFormat': '{cur} / {next} 经验',
  'growth.levelRequire': '需要 {exp} 经验',
  'growth.rewardPrefix': '当前等级荣誉：{reward}',
  'growth.stat.checkinDays': '累计打卡天数',
  'growth.stat.streak': '连续坚持',
  'growth.stat.maxStreak': '最长连续坚持',
  'growth.stat.wishTotal': '累计愿望',
  'growth.stat.wishDone': '已实现愿望',
  'growth.stat.taskTotal': '累计任务',
  'growth.stat.taskDone': '已达成任务',
  'growth.stat.none': '暂无',
  'growth.chart.title': '近 30 天打卡',
  'growth.chart.empty': '暂无打卡数据，完成第一次打卡后这里会长出你的趋势图。',
  'growth.chart.hint': '蓝色为已打卡，斜纹为当日未完成缺口，绿色柱为全勤日；悬停或聚焦柱子可看逐日明细。',
  'growth.chart.tooltip': '{date}：已打 {checked}/{total}',
  'growth.chart.legend.checked': '已打卡',
  'growth.chart.legend.missed': '未完成缺口',
  'growth.levels.title': '等级说明',
  // 等级词表（服务端 LEVEL_CONFIGS 为中文权威源；客户端按等级序号本地化显示，
  // 未知等级回落服务端原文）：zh 侧与服务端逐字一致，由 test 锁定防漂移
  'growth.lv.1.name': '初心者',
  'growth.lv.1.reward': '开启星愿之旅',
  'growth.lv.2.name': '探索者',
  'growth.lv.2.reward': '晋升「探索者」称号',
  'growth.lv.3.name': '实践者',
  'growth.lv.3.reward': '晋升「实践者」称号',
  'growth.lv.4.name': '坚持者',
  'growth.lv.4.reward': '晋升「坚持者」称号',
  'growth.lv.5.name': '奋斗者',
  'growth.lv.5.reward': '晋升「奋斗者」称号',
  'growth.lv.6.name': '进取者',
  'growth.lv.6.reward': '晋升「进取者」称号',
  'growth.lv.7.name': '成就者',
  'growth.lv.7.reward': '晋升「成就者」称号',
  'growth.lv.8.name': '卓越者',
  'growth.lv.8.reward': '晋升「卓越者」称号',
  'growth.lv.9.name': '领航者',
  'growth.lv.9.reward': '晋升「领航者」称号',
  'growth.lv.10.name': '星愿大师',
  'growth.lv.10.reward': '晋升「星愿大师」——星愿之旅的最高荣誉',

  // --- 记忆页 ---
  'memory.pageTitle': '记忆',
  'memory.summary': '共 {total} 条 · 对话时按上限自动注入',
  'memory.editing': '正在编辑「{key}」（键名不可改）',
  'memory.cancelEdit': '取消编辑',
  'memory.keyPlaceholder': '键名（如：生日）',
  'memory.valuePlaceholder': '内容（如：3 月 5 日）',
  'memory.searchPlaceholder': '搜索键名或内容…',
  'memory.importanceLabel': '重要度 {level}',
  'memory.add': '＋ 添加',
  'memory.saveEdit': '保存修改',
  'memory.capNote': '共 {total} 条，列表仅显示最近 {shown} 条；可用搜索缩小范围。',
  'memory.more': '加载更多',
  'memory.loadedAll': '已显示全部 {n} 条',
  'memory.empty.title': '还没有记忆',
  'memory.empty.hint': '在对话里告诉我你的喜好与近况，或在上方手动添加。',
  'memory.searchEmpty.title': '没有匹配的记忆',
  'memory.footNote': '删除与清空不可恢复；注入条数上限在 设置 → 星愿 调整。',
  'memory.clearAll': '清空全部记忆',
  'memory.needKeyAndValue': '键名和内容都要填写。',
  'memory.keyTooShort': '键名至少需要 2 个字符。',
  'memory.overwriteAsk': '「{key}」已存在，覆盖原内容吗？',
  'memory.confirmDelete': '删除记忆「{key}：{value}」？删除后不可恢复。',
  'memory.confirmClear': '清空全部 {total} 条记忆？此操作不可恢复！',
  'memory.savedNew': '已添加「{key}」',
  'memory.savedOverwrite': '已保存「{key}」',
  'memory.deletedOne': '已删除「{key}」',
  'memory.clearedAll': '已清空全部记忆',
  'memory.cat.personal': '个人',
  'memory.cat.preference': '偏好',
  'memory.cat.habit': '习惯',
  'memory.cat.event': '事件',
  'memory.cat.other': '其他',
  'memory.imp.high': '高',
  'memory.imp.medium': '中',
  'memory.imp.low': '低',
  'memory.fieldKey': '键名',
  'memory.fieldValue': '内容',
  'memory.fieldCategory': '分类',
  'memory.fieldImportance': '重要度',
  'memory.searchAria': '搜索键名或内容',

  // --- 设置页 ---
  'settings.tabLabel': '星愿',
  'settings.coach.title': '教练风格',
  'settings.coach.gentle': '温柔型',
  'settings.coach.strict': '严格型',
  'settings.coach.humorous': '幽默型',
  'settings.coach.current': '当前：{label}。决定对话语气与人设，也可在对话中说「对我严格一点」。',
  'settings.coach.saved': '教练风格已更新，对后续对话生效',
  'settings.coach.loadFailed': '加载失败：{error}',
  'settings.profile.title': '昵称与画像',
  'settings.profile.nickname': '昵称',
  'settings.profile.occupation': '职业',
  'settings.profile.interests': '兴趣',
  'settings.profile.nicknamePlaceholder': '昵称：希望被怎么称呼（留空清除）',
  'settings.profile.occupationPlaceholder': '职业（留空清除）',
  'settings.profile.interestsPlaceholder': '兴趣：用顿号或逗号分隔（如 阅读、跑步）',
  'settings.profile.save': '保存画像',
  'settings.profile.saving': '保存中…',
  'settings.profile.saved': '画像已保存',
  'settings.profile.sharedHint': '与对话侧共享同一份档案；对话里说「叫我小星」也会更新。',
  'settings.pref.title': '对话偏好',
  'settings.pref.unavailable': '当前连接不支持持久化偏好（远程或临时模式），以下选项不可用。',
  'settings.pref.loading': '偏好加载中…',
  'settings.pref.notRegistered': '偏好暂不可用（组件未就绪），请稍后重试。',
  'settings.pref.readOnly': '当前设置为只读，无法保存修改。',
  'settings.pref.confirmWrites': '写操作二次确认',
  'settings.pref.confirmWritesHint': '创建愿望/任务、打卡、取消打卡时先弹应用内确认卡（删除始终确认）；关闭后对话中的这类操作将直接执行。',
  'settings.pref.memoryLimit': '记忆注入上限',
  'settings.pref.memoryLimitHint': '每次对话自动注入上下文的记忆条数上限（5-200，默认 40）；失焦后保存。',
  'settings.pref.limitInvalid': '请输入 5-200 的整数',
  'settings.pref.writeFailed': '保存未生效，请重试。',
  'settings.pref.confirmLang': '确认卡语言',
  'settings.pref.confirmLangHint': '对话中写操作确认卡与问题的显示语言。确认卡无法自动跟随界面语言，需在此选择；默认中文。',
  'settings.pref.confirmLang.zh': '中文',
  'settings.pref.confirmLang.en': 'English',
  'settings.tabs.title': '标签页显示',
  'settings.tabs.mode.follow': '跟随会话',
  'settings.tabs.mode.show': '始终显示',
  'settings.tabs.mode.hide': '始终隐藏',
  'settings.tabs.chooseTab': '显示的标签页',
  'settings.tabs.loading': '标签页选项加载中…',
  'settings.tabs.unavailable': '当前连接不支持持久化设置（远程或临时模式），标签页显示选项不可用。',
  'settings.tabs.readOnly': '当前设置为只读，无法保存修改。',
  'settings.tabs.hint': '跟随会话：仅星愿预设的会话显示标签页；其他会话自动隐藏。可单独勾选/取消各标签。',
  'settings.dataHint': '业务数据存于本机 ~/.dsh/xingyuan/，备份即拷贝该目录。',
  'today.noPresetHint': '当前会话未启用星愿预设：页面数据可浏览、操作可用，但对话中的星愿能力不可用。',

  // --- 微行动卡 ---
  'micro.cleared': '已清除「{task}」的拆解',
  'micro.finished': '「{task}」微行动完成（可打卡了）',
  'micro.step': '「{task}」拆解执行 · 第 {current}/{total} 步',
  'micro.state.current': '▶ 当前',
  'micro.state.skipped': '↷ 已跳过',
  'micro.progress': '进度 {done}/{total} 完成',

  // --- 打卡卡 ---
  'checkin.success': '「{task}」打卡成功',
  'checkin.cancelled': '已取消「{task}」{date}的打卡',

  // --- 图表卡 ---
  'chart.noData': '暂无数据',
  'chart.noSchedule': '无安排',
  'chart.generatedAt': '生成于 {date}',

  // --- 图表词表本地化（服务端 charts.ts 内建词为中文权威源；客户端按 chartKey 与
  // 已知中文标签映射本地化，未知值原样回显）：zh 侧与服务端逐字一致，由 test 锁定 ---
  'chart.title.checkinTrend': '打卡趋势',
  'chart.title.checkinCalendar': '打卡日历',
  'chart.title.taskCompletionRate': '任务完成率',
  'chart.title.checkinRateTrend': '打卡完成率',
  'chart.title.weekComparison': '本周打卡对比',
  'chart.title.taskStatus': '任务状态分布',
  'chart.title.checkinByCategory': '分类打卡分布',
  'chart.title.wishCategory': '愿望分类分布',
  'chart.title.checkinRanking': '打卡排行',
  'chart.title.taskDistribution': '任务分布',
  'chart.title.wishProgress': '愿望进度',
  'chart.title.wishAchievement': '愿望达成率',
  'chart.title.continuousCheckin': '连续打卡',
  'chart.title.checkinTimeDistribution': '打卡时间分布',
  'chart.title.weeklyActivity': '周度活跃度',
  'chart.weekday.1': '周一',
  'chart.weekday.2': '周二',
  'chart.weekday.3': '周三',
  'chart.weekday.4': '周四',
  'chart.weekday.5': '周五',
  'chart.weekday.6': '周六',
  'chart.weekday.7': '周日',
  'chart.hour.0': '凌晨(0-5)',
  'chart.hour.1': '早晨(6-8)',
  'chart.hour.2': '上午(9-11)',
  'chart.hour.3': '中午(12-13)',
  'chart.hour.4': '下午(14-17)',
  'chart.hour.5': '傍晚(18-19)',
  'chart.hour.6': '夜间(20-23)',
  'chart.uncategorized': '未分类',
  'chart.unlinked': '未关联',
  'chart.label.completionRate': '完成率',
  'chart.label.achievementRate': '达成率',
  'chart.label.currentVsBest': '当前/最长',
  'chart.series.this': '本周',
  'chart.series.last': '上周',
  'chart.subtitle.lastYear': '最近一年',
  'chart.subtitle.byTaskTopN': '按任务 TopN',
  'chart.subtitle.byWishTopN': '按愿望 TopN',
  'chart.subtitle.byHourBucket': '按实际打卡时刻分桶；过滤范围为打卡日区间',
  'chart.subtitle.progressPercent': '%（应打天数完成率）',
  'chart.subtitle.progressPercentPending': '%（应打天数完成率，含未领取任务）',
  'chart.subtitle.lastDays': '近 {n} 天',
  'chart.subtitle.daysInclPending': '{done}/{due} 天（含未领取任务）',
  'chart.subtitle.daysRatio': '{done}/{due} 天',
  'chart.subtitle.streak': '当前 {current} 天 / 最长 {best} 天',

  // --- 详情聚合视图 ---
  'detail.grid.title': '打卡记录',
  'detail.grid.summary': '近 {total} 格：已打 {checked}，未打 {missed}，待打卡 {future}',
  'detail.legend.checked': '已打卡',
  'detail.legend.missed': '未打卡',
  'detail.legend.future': '待打卡',
  'detail.grid.checked': '{date} 已打卡',
  'detail.grid.missed': '{date} 未打卡',
  'detail.grid.future': '{date} 待打卡',
  'detail.next.title': '接下来的打卡日：{dates}',
  'detail.revive.label': '延长截止日（重新开始）',
  'detail.revive.action': '延长并重新开始',
  'detail.revive.done': '截止日已延长，任务重新开始',
  'detail.micro.title': '微行动进度',
  'detail.micro.idle': '尚未开始微行动拆解（可在对话里说「帮我拆解」）。',
  'detail.micro.stepN': '第 {current}/{total} 步 · {instruction}',
  'detail.micro.done': '已完成 {done}/{total} 步',
  'detail.ops.title': '操作',
  'detail.askAi.copied': '总结提示词已复制，粘贴到对话即可让 AI 分析',
  'detail.askAi.manual': '无法访问剪贴板：请在对话里直接说「总结分析这个任务」',
  'detail.loading': '详情加载中…',
  'detail.loadFailed': '详情加载失败：{error}',

  // --- 分类管理 ---
  'catmgr.title': '分类管理',
  'catmgr.intro': '分类来自愿望；改名会同步全部同名愿望，颜色作为新愿望的默认色。',
  'catmgr.count': '{n} 个愿望',
  'catmgr.empty': '还没有分类，创建愿望时填写分类即可。',
  'catmgr.rename': '改名',
  'catmgr.color': '颜色',
  'catmgr.deleteEmpty': '清配色',
  'catmgr.newName': '新分类名（2-6 字）',
  'catmgr.followWish': '跟随愿望',
  'catmgr.countOne': '{n} 个愿望',

  // --- 快速新建 ---
  'quick.wish.name': '愿望标题',
  'quick.wish.namePlaceholder': '想实现什么？（如：三个月学会 Python）',
  'quick.task.name': '任务名称',
  'quick.task.namePlaceholder': '要养成的习惯（如：每天背 20 个单词）',
  'quick.cycle': '重复周期',
  'quick.due': '截止日期（可选）',
  'quick.category': '分类（2-6 字）',
  'quick.categoryPlaceholder': '如：学习',
  'quick.color': '分类颜色',
  'quick.submit': '创建',
  'quick.submitting': '创建中…',
  'quick.dialogHint': '轻量表单适合简单记录；需要 AI 推荐拆解、微行动规划请直接对话描述。',
  'quick.fieldRequired': '必填',
  'quick.duePast': '截止日期不能早于今天',
  'quick.dupWish': '已存在同名愿望「{title}」，仍要创建吗？',
  'quick.dupTask': '已存在同名任务「{name}」，仍要创建吗？',

  // --- 分类颜色名（色板可访问名；title 保留原始键） ---
  'color.slate': '石板灰',
  'color.gray': '灰',
  'color.zinc': '锌灰',
  'color.neutral': '中性',
  'color.stone': '岩石灰',
  'color.red': '红',
  'color.orange': '橙',
  'color.amber': '琥珀',
  'color.yellow': '黄',
  'color.lime': '青柠',
  'color.green': '绿',
  'color.emerald': '翠绿',
  'color.teal': '蓝绿',
  'color.cyan': '青',
  'color.sky': '天蓝',
  'color.blue': '蓝',
  'color.indigo': '靛蓝',
  'color.violet': '紫罗兰',
  'color.purple': '紫',
  'color.fuchsia': '品红',
  'color.pink': '粉',
  'color.rose': '玫红',

  // --- 空态插画：辅助文案由各页 empty.* 提供 ---

  // --- 错误码本地化（服务端 code → 文案；未知 code 回落服务端消息） ---
  'err.missing_field': '缺少必填字段：{field}',
  'err.not_found': '目标不存在或已被删除',
  'err.already_checked': '该日期已打卡；如需修改，请先撤销当日打卡',
  'err.not_opportunity_day': '该日期不是打卡日；可在日历页选择最近的打卡日',
  'err.already_claimed': '该任务已领取过',
  'err.claim_expired': '该任务截止日已过，无法领取——请先延长截止日使任务重新开始',
  'err.task_closed': '任务已完结，无法再打卡',
  'err.due_past': '截止日期不能早于今天',
  'err.due_too_far': '截止日期不能超过今天起 10 年',
  'err.bad_category_name': '分类名需 2-6 个字符',
  'err.bad_color_key': '未知颜色键',
  'err.bad_date': '日期格式或取值不合法（yyyy-MM-dd，且不得早于今天）',
  'err.overwrite_required': '已存在同名记录，需确认覆盖',
  'err.not_claimed': '任务尚未领取，请先领取',
  'err.no_opportunity_left': '没有可勾选的打卡日：应打卡的日期已全部完成或截止',
  'err.no_checkins': '该任务暂无打卡记录',
  'err.title_too_long': '标题不能超过 50 字符',
  'err.name_too_long': '任务名不能超过 100 字符',
  'err.once_today_only': '仅一次且未设截止日的任务只能打卡今天',
  'err.payload_too_large': '请求体过大',
  'err.bad_json_body': '请求体必须是合法 JSON',
  'err.bad_coach_style': '教练风格取值不合法',
  'err.bad_interests': '兴趣格式错误：应为字符串数组或逗号分隔字符串',
} as const

export type XyKey = keyof typeof ZH_DICT

// ===== 英文词典（键集同构：缺键/多键编译报错）=====

const EN_DICT: Record<XyKey, string> = {
  'common.retry': 'Retry',
  'tab.today': 'Today',
  'tab.wishes': 'Wishes',
  'tab.tasks': 'Tasks',
  'tab.calendar': 'Calendar',
  'tab.growth': 'Growth',
  'tab.memory': 'Memories',
  'common.loading': 'Loading',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.requestFailed': 'Request failed',
  'common.actionFailed': 'Action failed',
  'common.requestTimeout': 'Request timed out, please retry',
  'common.networkError': 'Network request failed. Make sure the XingYuan service is running, then try again',
  'common.dayUnit': '{n} days',
  'common.countUnit': '{n} times',
  'common.countUnitOne': '{n} time',
  'common.dateSuffix': ' ({date})',
  'common.httpStatus': ' ({status})',
  'common.staleData': 'Refresh failed — the data shown may be out of date.',

  'badge.wish': 'Wish',
  'badge.task': 'Task',
  'badge.chart': 'Chart',
  'badge.micro': 'Micro-step',
  'state.deleted': 'Deleted “{title}”',
  'state.done': 'Done',

  'wish.progress': 'Progress {percent}%',
  'wish.progressHasPending': 'includes unclaimed tasks',
  'wish.eta': 'Target date {date}',
  'wish.noTasks': 'No tasks yet — tell me in chat and I will suggest check-in tasks for it',
  'wish.pageTitle': 'My Wishes',
  'wish.summary': '{active} in progress{achieved}',
  'wish.achievedSuffix': ' · {n} achieved',
  'wish.sectionAchieved': 'Achieved',
  'wish.empty.title': 'No wishes yet',
  'wish.empty.hint': 'Tell me what you want to achieve and I will break it into a plan you can stick with.',

  'task.upcoming': 'Upcoming dates: {dates}',
  'task.status.pending': 'Unclaimed',
  'task.status.in_progress': 'In progress',
  'task.status.closed': 'Closed',
  'task.status.achieved': 'Achieved',
  'task.status.expired': 'Expired',
  'task.nextDate': 'Next {date}',
  'task.due': 'Due {date}',
  'task.group.in_progress': 'In progress',
  'task.group.pending': 'Unclaimed',
  'task.group.achieved': 'Achieved',
  'task.group.expired': 'Expired',
  'task.claimExpiredHint': 'Past its due date and unclaimed — open the task detail to extend the due date and restart it',
  'task.expiredHint': 'The due date has passed — extend it below to restart the task, or just ask me in chat.',
  'task.pageTitle': 'All Tasks',
  'task.totalCount': '{n} in total',
  'task.empty.title': 'No tasks yet',
  'task.empty.hint': 'Tell me the habit you want to build, or start planning from the Wishes tab.',

  'cycle.once': 'Once',
  'cycle.daily': 'Daily',
  'cycle.weekly': 'Weekly',
  'cycle.monthly': 'Monthly',

  'action.claim': 'Claim',
  'action.checkin': '✓ Check in',
  'action.checkinFuture': 'Early check-in · {date}',
  'action.checkinThisDay': 'Check in',
  'action.undoCheckin': 'Undo',
  'action.cancelCheckin': 'Undo check-in',
  'action.cancelCheckinAria': 'Undo the check-in on {date}',
  'action.expand': 'Details',
  'action.collapse': 'Hide',
  'action.createWish': '+ New wish',
  'action.createTask': '+ New task',
  'action.manageCategories': 'Categories',
  'action.askAi': 'AI summary',

  'toast.claimed': 'Claimed “{name}”. Time to check in!',
  'toast.checkinOk': 'Checked in',
  'toast.undone': 'Check-in reverted',
  'toast.undoneAt': 'Reverted the check-in on {date}',
  'toast.wishCreated': 'Wish “{title}” created',
  'toast.taskCreated': 'Task “{name}” created — claim it to start checking in',
  'toast.deleted': '“{name}” deleted',
  'toast.categoryRenamed': 'Category renamed to “{name}”',
  'toast.categoryColored': 'Color updated for “{name}”',
  'toast.categoryColorReset': 'Color of “{name}” reset to follow wish colors',
  'toast.categoryDeleted': 'Custom color of “{name}” cleared',

  'confirm.futureCheckin': 'The check-in day {date} for “{name}” is after today. Checking in early means committing to finish it that day. Continue?',
  'confirm.undoToday': "Undo today’s check-in for “{name}”? Progress will roll back.",
  'confirm.undoAt': 'Undo the check-in of “{name}” on {date}? Progress will roll back.',
  'confirm.futureAt': 'The check-in day {date} for “{name}” is after today. Checking in early means committing to finish it that day. Continue?',
  'confirm.deleteTask': 'Delete task “{name}”? Its check-ins and micro-step plan will be removed too. This cannot be undone.',
  'confirm.deleteWish': 'Delete wish “{name}”? Its tasks, check-ins and micro-step plans will be removed too. This cannot be undone.',
  'confirm.renameCategory': 'Rename category “{old}” to “{new}” everywhere? ({count} affected)',
  'confirm.deleteEmptyCategory': 'Remove the custom color of empty category “{name}”?',

  'today.title': "Today’s Check-ins · {date}",
  'today.noneToday': 'Nothing scheduled today',
  'today.summary': '{checked}/{total} · {ratio}%',
  'today.allDone': "All check-ins done today. Great job!",
  'today.sectionOpen': 'To do',
  'today.sectionDone': 'Completed',
  'today.empty.title': 'No check-ins scheduled today',
  'today.empty.hint': 'Take a look at the Wishes tab, or just tell me a new habit you want to build.',

  'cal.weekday.1': 'Mo',
  'cal.weekday.2': 'Tu',
  'cal.weekday.3': 'We',
  'cal.weekday.4': 'Th',
  'cal.weekday.5': 'Fr',
  'cal.weekday.6': 'Sa',
  'cal.weekday.7': 'Su',
  'cal.backToMonth': 'This month',
  'cal.prevMonth': 'Previous month',
  'cal.nextMonth': 'Next month',
  'cal.legend.c0': 'No check-in planned',
  'cal.legend.c1': 'To check',
  'cal.legend.c2': 'Partial',
  'cal.legend.c3': 'Complete',
  'cal.cellAria.none': '{date}, no check-in planned',
  'cal.cellAria.some': '{date}, completed {checked}/{due}',
  'cal.cellTitle.none': '{date}, no check-in planned',
  'cal.cellTitle.some': '{date}, checked {checked}/{due}',
  'cal.panelHint': 'Pick a date to see its tasks; make up or cancel check-ins inline.',
  'cal.dayLoadFailed': 'Failed to load tasks for this day. Please retry.',
  'cal.dayEmpty': 'Nothing scheduled on this day.',
  'cal.state.checked': '✓ Checked in',
  'cal.state.todo': '○ To check in',

  'growth.levelLabel': 'Current level',
  'growth.levelFallback': 'Beginner',
  'growth.maxed': 'Max level',
  'growth.expFormat': '{cur} / {next} EXP',
  'growth.levelRequire': 'Requires {exp} EXP',
  'growth.rewardPrefix': 'Level reward: {reward}',
  'growth.stat.checkinDays': 'Check-in days',
  'growth.stat.streak': 'Current streak',
  'growth.stat.maxStreak': 'Longest streak',
  'growth.stat.wishTotal': 'Wishes created',
  'growth.stat.wishDone': 'Wishes achieved',
  'growth.stat.taskTotal': 'Tasks created',
  'growth.stat.taskDone': 'Tasks achieved',
  'growth.stat.none': 'None',
  'growth.chart.title': 'Check-ins · last 30 days',
  'growth.chart.empty': 'No data yet. Your trend chart grows after the first check-in.',
  'growth.chart.hint': 'Blue = checked in, striped = missed gap, green = full day. Hover or focus a bar for daily details.',
  'growth.chart.tooltip': '{date}: checked {checked}/{total}',
  'growth.chart.legend.checked': 'Checked',
  'growth.chart.legend.missed': 'Missed gap',
  'growth.levels.title': 'Levels',
  'growth.lv.1.name': 'Novice',
  'growth.lv.1.reward': 'Begin your journey',
  'growth.lv.2.name': 'Explorer',
  'growth.lv.2.reward': 'Earn the “Explorer” title',
  'growth.lv.3.name': 'Practitioner',
  'growth.lv.3.reward': 'Earn the “Practitioner” title',
  'growth.lv.4.name': 'Perseverer',
  'growth.lv.4.reward': 'Earn the “Perseverer” title',
  'growth.lv.5.name': 'Striver',
  'growth.lv.5.reward': 'Earn the “Striver” title',
  'growth.lv.6.name': 'Go-getter',
  'growth.lv.6.reward': 'Earn the “Go-getter” title',
  'growth.lv.7.name': 'Achiever',
  'growth.lv.7.reward': 'Earn the “Achiever” title',
  'growth.lv.8.name': 'Paragon',
  'growth.lv.8.reward': 'Earn the “Paragon” title',
  'growth.lv.9.name': 'Pathfinder',
  'growth.lv.9.reward': 'Earn the “Pathfinder” title',
  'growth.lv.10.name': 'XingYuan Master',
  'growth.lv.10.reward': 'Earn the “XingYuan Master” title — the highest honor of the journey',

  'memory.pageTitle': 'Memories',
  'memory.summary': '{total} in total · auto-injected up to the limit during chats',
  'memory.editing': 'Editing “{key}” (key is fixed)',
  'memory.cancelEdit': 'Stop editing',
  'memory.keyPlaceholder': 'Key (e.g. Birthday)',
  'memory.valuePlaceholder': 'Content (e.g. March 5th)',
  'memory.searchPlaceholder': 'Search keys or content…',
  'memory.importanceLabel': 'Importance: {level}',
  'memory.add': '+ Add',
  'memory.saveEdit': 'Save changes',
  'memory.capNote': '{total} in total, showing the latest {shown} entries; narrow down with search.',
  'memory.more': 'Load more',
  'memory.loadedAll': 'All {n} shown',
  'memory.empty.title': 'No memories yet',
  'memory.empty.hint': 'Share your preferences in chat, or add one manually above.',
  'memory.searchEmpty.title': 'No matching memories',
  'memory.footNote': 'Deletions are permanent; adjust the injection limit under Settings → XingYuan.',
  'memory.clearAll': 'Clear all memories',
  'memory.needKeyAndValue': 'Both key and content are required.',
  'memory.keyTooShort': 'Key must be at least 2 characters.',
  'memory.overwriteAsk': '“{key}” already exists. Overwrite it?',
  'memory.confirmDelete': 'Delete memory “{key}: {value}”? This cannot be undone.',
  'memory.confirmClear': 'Clear all memories ({total})? This cannot be undone!',
  'memory.savedNew': 'Added “{key}”',
  'memory.savedOverwrite': 'Saved “{key}”',
  'memory.deletedOne': '“{key}” deleted',
  'memory.clearedAll': 'All memories cleared',
  'memory.cat.personal': 'Personal',
  'memory.cat.preference': 'Preference',
  'memory.cat.habit': 'Habit',
  'memory.cat.event': 'Event',
  'memory.cat.other': 'Other',
  'memory.imp.high': 'High',
  'memory.imp.medium': 'Medium',
  'memory.imp.low': 'Low',
  'memory.fieldKey': 'Key',
  'memory.fieldValue': 'Content',
  'memory.fieldCategory': 'Category',
  'memory.fieldImportance': 'Importance',
  'memory.searchAria': 'Search keys or content',

  'settings.tabLabel': 'XingYuan',
  'settings.coach.title': 'Coach style',
  'settings.coach.gentle': 'Gentle',
  'settings.coach.strict': 'Strict',
  'settings.coach.humorous': 'Humorous',
  'settings.coach.current': 'Current: {label}. Shapes the coaching tone; you can also say “be tougher on me” in chat.',
  'settings.coach.saved': 'Coach style updated; applies to future chats',
  'settings.coach.loadFailed': 'Failed to load: {error}',
  'settings.profile.title': 'Nickname & profile',
  'settings.profile.nickname': 'Nickname',
  'settings.profile.occupation': 'Occupation',
  'settings.profile.interests': 'Interests',
  'settings.profile.nicknamePlaceholder': 'Nickname: how should I call you? (empty clears)',
  'settings.profile.occupationPlaceholder': 'Occupation (empty clears)',
  'settings.profile.interestsPlaceholder': 'Interests: separate with commas (e.g. reading, running)',
  'settings.profile.save': 'Save profile',
  'settings.profile.saving': 'Saving…',
  'settings.profile.saved': 'Profile saved',
  'settings.profile.sharedHint': 'Shared with the chat side; saying “call me Star” in chat updates it too.',
  'settings.pref.title': 'Chat preferences',
  'settings.pref.unavailable': 'This connection cannot persist preferences (remote or temporary mode); the options below are disabled.',
  'settings.pref.loading': 'Loading preferences…',
  'settings.pref.notRegistered': 'Preferences are unavailable right now (component not ready); please retry later.',
  'settings.pref.readOnly': 'Settings are read-only; changes cannot be saved.',
  'settings.pref.confirmWrites': 'Confirm write actions',
  'settings.pref.confirmWritesHint': 'Show an in-app confirmation before creating wishes/tasks, checking in or canceling (deletes always confirm). Turn off to execute directly.',
  'settings.pref.memoryLimit': 'Memory injection limit',
  'settings.pref.memoryLimitHint': 'Max memories auto-injected per chat (5-200, default 40); saved when you leave the field.',
  'settings.pref.limitInvalid': 'Enter an integer between 5 and 200',
  'settings.pref.writeFailed': 'The change did not save; please try again.',
  'settings.pref.confirmLang': 'Confirm card language',
  'settings.pref.confirmLangHint': 'Language of the in-chat confirmation card and its question. The card cannot follow the interface language automatically, so pick it here; defaults to Chinese.',
  'settings.pref.confirmLang.zh': '中文',
  'settings.pref.confirmLang.en': 'English',
  'settings.tabs.title': 'Tab visibility',
  'settings.tabs.mode.follow': 'Follow session',
  'settings.tabs.mode.show': 'Always show',
  'settings.tabs.mode.hide': 'Always hide',
  'settings.tabs.chooseTab': 'Visible tabs',
  'settings.tabs.loading': 'Loading tab options…',
  'settings.tabs.unavailable': 'This connection cannot persist settings (remote or temporary mode); tab visibility options are unavailable.',
  'settings.tabs.readOnly': 'Settings are read-only; changes cannot be saved.',
  'settings.tabs.hint': 'Follow session: tabs appear only in sessions using the XingYuan preset; other sessions hide them automatically. Toggle individual tabs below.',
  'settings.dataHint': 'Data lives locally at ~/.dsh/xingyuan/ — back it up by copying the folder.',
  'today.noPresetHint': 'This session is not using the XingYuan preset: pages stay browsable and usable, but XingYuan chat capabilities are unavailable.',

  'micro.cleared': 'Cleared the micro-step plan of “{task}”',
  'micro.finished': 'Micro-steps of “{task}” finished (ready to check in)',
  'micro.step': '“{task}” micro-steps · step {current}/{total}',
  'micro.state.current': '▶ current',
  'micro.state.skipped': '↷ skipped',
  'micro.progress': 'Progress {done}/{total} done',

  'checkin.success': '“{task}” checked in',
  'checkin.cancelled': 'Cancelled the check-in of “{task}” on {date}',

  'chart.noData': 'No data yet',
  'chart.noSchedule': 'Not scheduled',
  'chart.generatedAt': 'Generated on {date}',

  'chart.title.checkinTrend': 'Check-in trend',
  'chart.title.checkinCalendar': 'Check-in calendar',
  'chart.title.taskCompletionRate': 'Task completion rate',
  'chart.title.checkinRateTrend': 'Check-in rate',
  'chart.title.weekComparison': 'This week vs last week',
  'chart.title.taskStatus': 'Task status breakdown',
  'chart.title.checkinByCategory': 'Check-ins by category',
  'chart.title.wishCategory': 'Wishes by category',
  'chart.title.checkinRanking': 'Check-in ranking',
  'chart.title.taskDistribution': 'Task distribution',
  'chart.title.wishProgress': 'Wish progress',
  'chart.title.wishAchievement': 'Wish achievement',
  'chart.title.continuousCheckin': 'Check-in streak',
  'chart.title.checkinTimeDistribution': 'Check-in time of day',
  'chart.title.weeklyActivity': 'Weekly activity',
  'chart.weekday.1': 'Mon',
  'chart.weekday.2': 'Tue',
  'chart.weekday.3': 'Wed',
  'chart.weekday.4': 'Thu',
  'chart.weekday.5': 'Fri',
  'chart.weekday.6': 'Sat',
  'chart.weekday.7': 'Sun',
  'chart.hour.0': 'Early AM (0-5)',
  'chart.hour.1': 'Morning (6-8)',
  'chart.hour.2': 'AM (9-11)',
  'chart.hour.3': 'Noon (12-13)',
  'chart.hour.4': 'Afternoon (14-17)',
  'chart.hour.5': 'Evening (18-19)',
  'chart.hour.6': 'Night (20-23)',
  'chart.uncategorized': 'Uncategorized',
  'chart.unlinked': 'Unlinked',
  'chart.label.completionRate': 'Completion rate',
  'chart.label.achievementRate': 'Achievement rate',
  'chart.label.currentVsBest': 'Current / best',
  'chart.series.this': 'This week',
  'chart.series.last': 'Last week',
  'chart.subtitle.lastYear': 'Past year',
  'chart.subtitle.byTaskTopN': 'By task (top N)',
  'chart.subtitle.byWishTopN': 'By wish (top N)',
  'chart.subtitle.byHourBucket': 'Bucketed by actual check-in time; filtered to the check-in date range',
  'chart.subtitle.progressPercent': '% of scheduled-day completion',
  'chart.subtitle.progressPercentPending': '% of scheduled-day completion (incl. unclaimed)',
  'chart.subtitle.lastDays': 'Last {n} days',
  'chart.subtitle.daysInclPending': '{done}/{due} days (incl. unclaimed)',
  'chart.subtitle.daysRatio': '{done}/{due} days',
  'chart.subtitle.streak': 'Current {current}d / best {best}d',

  'detail.grid.title': 'Check-in record',
  'detail.grid.summary': 'Last {total} shown: {checked} checked, {missed} missed, {future} to check in',
  'detail.legend.checked': 'Checked in',
  'detail.legend.missed': 'Missed',
  'detail.legend.future': 'To check in',
  'detail.grid.checked': '{date} checked in',
  'detail.grid.missed': '{date} missed',
  'detail.grid.future': '{date} pending check-in',
  'detail.next.title': 'Upcoming opportunity dates: {dates}',
  'detail.revive.label': 'Extend due date (restart)',
  'detail.revive.action': 'Extend & restart',
  'detail.revive.done': 'Due date extended — task restarted',
  'detail.micro.title': 'Micro-step progress',
  'detail.micro.idle': 'No micro-step plan yet (ask “help me break it down” in chat).',
  'detail.micro.stepN': 'Step {current}/{total} · {instruction}',
  'detail.micro.done': '{done}/{total} steps completed',
  'detail.ops.title': 'Actions',
  'detail.askAi.copied': 'Summary prompt copied — paste it into the chat to have AI analyze',
  'detail.askAi.manual': 'Clipboard unavailable: just say “summarize this task” in the chat',
  'detail.loading': 'Loading details…',
  'detail.loadFailed': 'Failed to load details: {error}',

  'catmgr.title': 'Categories',
  'catmgr.intro': 'Categories come from wishes; renaming updates every wish in it, and the color becomes the default for new wishes.',
  'catmgr.count': '{n} wishes',
  'catmgr.empty': 'No categories yet; fill one in when creating a wish.',
  'catmgr.rename': 'Rename',
  'catmgr.color': 'Color',
  'catmgr.deleteEmpty': 'Clear color',
  'catmgr.newName': 'New name (2-6 chars)',
  'catmgr.followWish': 'Follow wish',
  'catmgr.countOne': '{n} wish',

  'quick.wish.name': 'Wish title',
  'quick.wish.namePlaceholder': 'What do you want to achieve? (e.g. Learn Python in 3 months)',
  'quick.task.name': 'Task name',
  'quick.task.namePlaceholder': 'The habit to build (e.g. Memorize 20 words daily)',
  'quick.cycle': 'Repeat cycle',
  'quick.due': 'Due date (optional)',
  'quick.category': 'Category (2-6 chars)',
  'quick.categoryPlaceholder': 'e.g. Learning',
  'quick.color': 'Category color',
  'quick.submit': 'Create',
  'quick.submitting': 'Creating…',
  'quick.dialogHint': 'This quick form suits simple entries; for AI-recommended breakdowns and micro-steps, describe it in chat.',
  'quick.fieldRequired': 'Required',
  'quick.duePast': 'Due date cannot be before today',
  'quick.dupWish': 'A wish titled “{title}” already exists. Create anyway?',
  'quick.dupTask': 'A task named “{name}” already exists. Create anyway?',

  'color.slate': 'Slate',
  'color.gray': 'Gray',
  'color.zinc': 'Zinc',
  'color.neutral': 'Neutral',
  'color.stone': 'Stone',
  'color.red': 'Red',
  'color.orange': 'Orange',
  'color.amber': 'Amber',
  'color.yellow': 'Yellow',
  'color.lime': 'Lime',
  'color.green': 'Green',
  'color.emerald': 'Emerald',
  'color.teal': 'Teal',
  'color.cyan': 'Cyan',
  'color.sky': 'Sky',
  'color.blue': 'Blue',
  'color.indigo': 'Indigo',
  'color.violet': 'Violet',
  'color.purple': 'Purple',
  'color.fuchsia': 'Fuchsia',
  'color.pink': 'Pink',
  'color.rose': 'Rose',

  'err.missing_field': 'Missing required field: {field}',
  'err.not_found': 'Not found, or already deleted',
  'err.already_checked': 'Already checked in on this date — undo it first to change',
  'err.not_opportunity_day': 'Not a check-in day — pick the nearest one in the Calendar tab',
  'err.already_claimed': 'Already claimed',
  'err.claim_expired': 'This task is past its due date — extend the due date first to restart it',
  'err.task_closed': 'Task is closed and cannot be checked in',
  'err.due_past': 'Due date cannot be before today',
  'err.due_too_far': 'Due date cannot be more than 10 years ahead',
  'err.bad_category_name': 'Category name needs 2-6 characters',
  'err.bad_color_key': 'Unknown color key',
  'err.bad_date': 'Invalid date (yyyy-MM-dd, not before today)',
  'err.overwrite_required': 'Already exists; confirmation required to overwrite',
  'err.not_claimed': 'Task must be claimed first',
  'err.no_opportunity_left': 'No check-in day left to tick — all scheduled days are done or past the deadline',
  'err.no_checkins': 'No check-in records for this task',
  'err.title_too_long': 'Title exceeds 50 characters',
  'err.name_too_long': 'Task name exceeds 100 characters',
  'err.once_today_only': 'A once-only task without a due date can only be checked in today',
  'err.payload_too_large': 'Request body too large',
  'err.bad_json_body': 'Request body must be valid JSON',
  'err.bad_coach_style': 'Invalid coach style',
  'err.bad_interests': 'Invalid interests: expected an array or comma-separated string',
}

/** 两份词典必须键集一致（EN 侧类型已强制；这里再兜底运行时断言一次）。 */
const ZH_KEYS = Object.keys(ZH_DICT).sort()
const EN_KEYS = Object.keys(EN_DICT).sort()
if (ZH_KEYS.join('\u0001') !== EN_KEYS.join('\u0001')) {
  throw new Error('xingyuan i18n dictionaries diverge: zh/en key sets differ')
}

// ===== 绑定层 =====

type Dict = Partial<Record<XyKey, string>>

/** 当前生效翻译函数：默认 zh 直查（含 {name} 插值）。 */
let translate: XyTranslate = fallbackTranslate
let localeFace: LocaleFaceLike | undefined

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (raw, name: string) => {
    const value = params[name]
    return value === undefined ? raw : String(value)
  })
}

function fallbackTranslate(key: string, params?: Record<string, unknown>): string {
  const template = (ZH_DICT as Dict)[key as XyKey]
  return interpolate(template ?? key, params)
}

/**
 * apply 时调用：绑定壳 locale 服务并注册双语字典。
 * @param locale ctx.get('locale') 的原始值（可能为 undefined）
 * @param registerEffect 接收 effect execute（返回清理函数的函数），挂到当前 Fiber
 */
export function setupLocale(locale: unknown, registerEffect: (execute: () => () => void) => void): void {
  localeFace = asFace(locale)
  if (localeFace === undefined) {
    translate = fallbackTranslate
    return
  }
  translate = localeFace.bind(XY_NS)
  const face = localeFace
  const registry = face as LocaleFaceLike & {
    register?: (ns: string, localeId: string, dict: Record<string, string>) => (() => void) | void
  }
  if (typeof registry.register === 'function') {
    const disposers: Array<() => void> = []
    for (const [localeId, dict] of [['zh', ZH_DICT], ['en', EN_DICT]] as const) {
      const dispose = registry.register(XY_NS, localeId, dict as Record<string, string>)
      if (typeof dispose === 'function') disposers.push(dispose)
    }
    if (disposers.length > 0) {
      const all = disposers
      registerEffect(() => () => { for (const dispose of all) dispose() })
    }
  }
}

/** 命令式取词（toast/confirm 等 React 树外场景）：调用时读当前语言。 */
export function t(key: XyKey, params?: Record<string, unknown>): string {
  const result = translate(key, params)
  return result
}

const noopSubscribe = (_fn: () => void): (() => void) => () => {}

/**
 * 组件内取词 Hook：订阅 locale 修订号，语言切换即触发所在组件树重渲；
 * 返回的函数身份稳定（translate 在 apply 期绑定后不再更换引用）。
 */
export function useXyT(): XyT {
  const revision = useSyncExternalStore(
    localeFace?.subscribe.bind(localeFace) ?? noopSubscribe,
    () => localeFace?.getSnapshot().revision ?? 0,
  )
  void revision
  return xyTranslateStable
}

/** useXyT 返回的取词函数：键受查（拼错键名编译报错），引用恒定避免下游 memo 失效。 */
export type XyT = (key: XyKey, params?: Record<string, unknown>) => string

const xyTranslateStable: XyT = (key, params) => t(key, params)

/** 当前语言（供调试/埋点类场景；无 face 时返回 'zh' 兜底口径）。
 * 平台事实（rc.2 实测）：宿主发布的 LocaleFace 契约（dsh-client-ui-slots
 * renderer.d.ts）只声明 getSnapshot(): { revision } 与 bind(ns)，快照的 `active`
 * 字段不在类型面内但运行时存在——本函数依赖它做语言判定，读取处已做 unknown
 * 收窄，字段缺席时静默回落 zh（en 用户会看到英文正文配中文日期，而非崩溃）。
 * 上游若把 active 纳入正式契约，此处无需改动。 */
export function activeLocale(): 'zh' | 'en' {
  if (localeFace === undefined) return 'zh'
  const snapshot = localeFace.getSnapshot() as { readonly active?: unknown }
  return snapshot.active === 'en' ? 'en' : 'zh'
}
