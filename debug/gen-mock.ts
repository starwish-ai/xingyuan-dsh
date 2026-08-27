/**
 * 视觉验证回路：用真实 STYLE_TEXT + 手写镜像 DOM 生成深/浅两主题的静态 mock 页，
 * 供浏览器截图核对客户端样式改版（客户端 React 页面无法脱离 dsh 壳运行，见 AGENTS.md §5.10）。
 *
 * 运行：npx vite-node debug/gen-mock.ts
 *   → 产出 debug/ui-mock.html（深色）与 debug/ui-mock-light.html（浅色），本地起静态服务截图核对。
 * 纪律：markup 为真实 tsx 输出的手写镜像，仅用于视觉核对；对应组件结构变更时须同步本文件。
 *
 * 场景覆盖（与页面一一对应）：日历 / 今日 / 愿望（卡内展开详情）/ 任务（分组卡+已完结行）/
 * 成长（英雄卡+强调 streak 统计+近30天柱图）/ 记忆（撰写卡+图标行动作）/
 * 设置（三分节面板）/ 快速新建（任务轻表单）/ 空态·错误态·危险按钮（纯文字版式，插画已移除）。
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STYLE_TEXT } from '../src/client/styles.js'

/** 壳令牌替身（mock 自给自足；取值贴近 dsh 壳深浅两套观感）。 */
const SHELL_LIGHT = `
  --dsw-alias-bg-layer-1:#ffffff;--dsw-alias-bg-layer-2:#f1f5f9;--dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-bg-mask-1:rgba(15,23,42,.45);
  --dsw-alias-border-l1:#e2e8f0;--dsw-alias-border-l2:#cbd5e1;--dsw-alias-border-l3:#94a3b8;
  --dsw-alias-label-primary:#0f172a;--dsw-alias-label-secondary:#64748b;
  --dsw-alias-state-success-primary:#0f766e;`

const SHELL_DARK = `
  --dsw-alias-bg-layer-1:#1f2731;--dsw-alias-bg-layer-2:#2a3442;--dsw-alias-bg-overlay:#1a212c;
  --dsw-alias-bg-mask-1:rgba(0,0,0,.5);
  --dsw-alias-border-l1:#2e3947;--dsw-alias-border-l2:#3d4a5c;--dsw-alias-border-l3:#55647a;
  --dsw-alias-label-primary:#e6edf5;--dsw-alias-label-secondary:#8b98ab;
  --dsw-alias-state-success-primary:#34d399;`

// ===== 共享片段（镜像 src/client/ui.ts 的 IconTrash / IconEdit）=====
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" style="display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12"/><path d="M10 11v6M14 11v6" opacity="0.55"/></svg>'
const ICON_EDIT = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" style="display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M13.5 5l5.5 5.5"/><path d="M5 19l1-4L17.5 3.5a2.12 2.12 0 0 1 3 3L9 18z"/></svg>'

// 2026 年 8 月：1 日周六（周一头），首行 7/27–8/2，末行 8/31 + 9/1–9/6；
// 27 = today + 待打卡（验证环与状态底共存），20 = 选中态
const CELL = (cls: string, n: string, tag = 'button'): string =>
  `<${tag} class="xy-cell ${cls}"${tag === 'button' ? ' type="button"' : ''}><span class="xy-daynum">${n}</span></${tag}>`

const week = (cells: string[]): string => `<div class="xy-week">${cells.join('')}</div>`

const calBody = [
  week([CELL('xy-outside', '27', 'span'), CELL('xy-outside', '28', 'span'), CELL('xy-outside', '29', 'span'), CELL('xy-outside', '30', 'span'), CELL('xy-outside', '31', 'span'), CELL('xy-c0', '1'), CELL('xy-c0', '2')]),
  week([CELL('xy-c1', '3'), CELL('xy-c3', '4'), CELL('xy-c1', '5'), CELL('xy-c0', '6'), CELL('xy-c1', '7'), CELL('xy-c3', '8'), CELL('xy-c3', '9')]),
  week([CELL('xy-c1', '10'), CELL('xy-c2', '11'), CELL('xy-c1', '12'), CELL('xy-c1', '13'), CELL('xy-c3', '14'), CELL('xy-c0', '15'), CELL('xy-c0', '16')]),
  week([CELL('xy-c1', '17'), CELL('xy-c1', '18'), CELL('xy-c2', '19'), CELL('xy-c1 xy-picked', '20'), CELL('xy-c1', '21'), CELL('xy-c0', '22'), CELL('xy-c0', '23')]),
  week([CELL('xy-c3', '24'), CELL('xy-c1', '25'), CELL('xy-c1', '26'), CELL('xy-c1 xy-today', '27'), CELL('xy-c1', '28'), CELL('xy-c1', '29'), CELL('xy-c1', '30')]),
  week([CELL('xy-c2', '31'), CELL('xy-outside', '1', 'span'), CELL('xy-outside', '2', 'span'), CELL('xy-outside', '3', 'span'), CELL('xy-outside', '4', 'span'), CELL('xy-outside', '5', 'span'), CELL('xy-outside', '6', 'span')]),
].join('\n')

/** 详情打卡格（镜像 detail.ts）：7 列周对齐网格。窗口 2026-08-27 前推含占位——
 * 真实数据按机会日稀疏返回，首格前置隐形占位（blank）是常态；今日格带 accent 环。 */
const DCELL = (tone: string, n: string, extra = ''): string =>
  `<span class="xy-dcell ${tone}${extra}" aria-hidden="true" ${tone !== 'xy-dcell-blank' ? `title="镜像格 ${n}"` : ''}>${tone === 'xy-dcell-blank' ? '' : n}</span>`

const BLANK = DCELL('xy-dcell-blank', '')
const DC = (n: string, extra = ''): string => DCELL('xy-dcell-checked', n, extra)
const DM = (n: string): string => DCELL('xy-dcell-missed', n)
const DF = (n: string): string => DCELL('xy-dcell-future', n)

// 4 行 × 7 列：窗口 8/3(Mon)..8/30(Sun)，today=8/27（周四，第 4 行）；首行前 2 占位演示错位对齐
const dcells = [
  BLANK, BLANK,
  DC('3'), DM('4'), DC('5'), DF('6'), DF('7'), DC('8'), DC('9'),
  DC('10'), DM('11'), DC('12'), DC('13'), DC('14'), DM('15'), DC('16'),
  DC('17'), DF('18'), DF('19'), DF('20'), DC('21'), DC('22'), DC('23'),
  DC('24'), DC('25'), DC('26'), DC('27', ' xy-dcell-today'), DF('28'), DF('29'), DF('30'),
].join('')
const dgridSummary = '近 28 个机会日：已打 17，未打 4，未来 7'

const detailLegend = `
<div class="xy-legend">
  <span><i class="xy-dot xy-dcell-checked" aria-hidden="true"></i>已打卡</span>
  <span><i class="xy-dot xy-dcell-missed" aria-hidden="true"></i>未打卡</span>
  <span><i class="xy-dot xy-dcell-future" aria-hidden="true"></i>未来机会日</span>
</div>`

/** 展开详情（镜像 detail.ts）：周对齐网格 + 操作区 [主操作][辅助][危险] 单行成组，无重复元信息行。 */
const detailOps = `
<div class="xy-detail" id="mock-detail">
  <div>
    <span class="xy-quick-label">打卡记录</span>
    <div class="xy-detail-grid" role="img" aria-label="${dgridSummary}">${dcells}</div>
    ${detailLegend}
  </div>
  <div class="xy-detail-next">接下来的机会日：9月28日、10月5日、10月12日、10月19日</div>
  <div>
    <span class="xy-quick-label">微行动进度</span>
    <span class="xy-meta">尚未开始微行动拆解（可在对话里说「帮我拆解」）。</span>
  </div>
  <div>
    <span class="xy-quick-label">操作</span>
    <div class="xy-detail-ops">
      <button class="xy-btn xy-btn-primary" type="button">✓ 打卡</button>
      <button class="xy-btn" type="button">让 AI 总结</button>
      <button class="xy-btn xy-btn-danger" type="button">删除</button>
    </div>
  </div>
</div>`

/** 任务行（镜像 task-line.ts）：状态词仅已完结保留（进行中/待领取由旁侧按钮自解释）。 */
const taskLine = (name: string, meta: string, actions: string): string => `
  <div class="xy-taskline">
    <span class="xy-taskname">${name}</span>
    <span class="xy-meta">${meta}</span>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${actions}</div>
  </div>`

/** 今日页（镜像 today.ts）：概览英雄卡（大号完成计数锚点）+ 待完成/已完成分组卡。 */
const todaySection = `
<div class="xy-page">
  <section class="xy-todayhero">
    <div class="xy-todayhero-top">
      <h2 class="xy-page-title">今日打卡 · 8月27日 周四</h2>
      <span class="xy-todayhero-num">2/5 · 40%</span>
    </div>
    <div class="xy-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40" aria-label="今日打卡进度">
      <div class="xy-bar-fill" style="transform:scaleX(.4)"></div>
    </div>
  </section>
  <section class="xy-group">
    <h3 class="xy-group-head"><span class="xy-group-dot xy-group-dot-warn" aria-hidden="true"></span><span>待完成</span><span class="xy-group-count">3</span></h3>
    <ul class="xy-grouplist">
      <li class="xy-grouprow">
        <div class="xy-rowmain">
          <span class="xy-rowtitle">每天动手练习调用AI接口30分钟</span>
          <span class="xy-meta">每天 · AI token 自由 · 下班后先热身再上强度</span>
        </div>
        <button class="xy-btn xy-btn-primary" type="button">✓ 打卡</button>
      </li>
      <li class="xy-grouprow">
        <div class="xy-rowmain">
          <span class="xy-rowtitle">周末清晨拉伸十分钟</span>
          <span class="xy-meta">每周 · 身体健康</span>
        </div>
        <button class="xy-btn" type="button">领取</button>
      </li>
      <li class="xy-grouprow">
        <div class="xy-rowmain">
          <span class="xy-rowtitle">睡前阅读纸质书 20 页</span>
          <span class="xy-meta">每天 · 更好的睡眠</span>
        </div>
        <button class="xy-btn xy-btn-primary" type="button">✓ 打卡</button>
      </li>
    </ul>
  </section>
  <section class="xy-group">
    <h3 class="xy-group-head"><span class="xy-group-dot xy-group-dot-ok" aria-hidden="true"></span><span>已完成</span><span class="xy-group-count">2</span></h3>
    <ul class="xy-grouplist">
      <li class="xy-grouprow xy-done">
        <div class="xy-rowmain">
          <span class="xy-rowtitle"><span class="xy-done-glyph" aria-hidden="true">✓</span>晨间笔记三行</span>
          <span class="xy-meta">每天</span>
        </div>
        <button class="xy-btn" type="button">撤销</button>
      </li>
      <li class="xy-grouprow xy-done">
        <div class="xy-rowmain">
          <span class="xy-rowtitle"><span class="xy-done-glyph" aria-hidden="true">✓</span>喝够 8 杯水</span>
          <span class="xy-meta">每天</span>
        </div>
        <button class="xy-btn" type="button">撤销</button>
      </li>
    </ul>
  </section>
</div>`

/** 愿望页（镜像 wishes.ts）：卡头删除为图标幽灵危险键 + 卡内展开详情 + 任务行（无冗余状态词）。 */
const wishSection = `
<div class="xy-page">
  <div class="xy-page-head">
    <h2 class="xy-page-title">我的愿望</h2>
    <span class="xy-meta">1 个进行中</span>
    <div class="xy-page-actions"><button class="xy-btn" type="button">＋ 新建愿望</button><button class="xy-btn" type="button">分类管理</button></div>
  </div>
  <div class="xy-wishcard">
    <div class="xy-card-head">
      <span class="xy-badge xy-badge-cat" style="--cat-h:220;--cat-sbg:58;--cat-sfg:46;--cat-sbd:46">学习</span>
      <span class="xy-title">AI token 自由</span>
      <span class="xy-progress-num">进度 15%</span>
      <button class="xy-btn xy-btn-danger xy-btn-icon xy-wishdel" type="button" aria-label="删除 · AI token 自由" title="删除">${ICON_TRASH}</button>
    </div>
    <div class="xy-meta">拥有属于自己的 AI 接口额度与调用能力，想用就用，不受平台和次数限制。</div>
    <div class="xy-meta">预计完成 2026年11月24日</div>
    <div class="xy-bar"><div class="xy-bar-fill" style="transform:scaleX(.15)"></div></div>
    <div class="xy-wishtasks">
${taskLine('每周复盘token用量并优化调用方式', '每周 · 5/9 天 · 下次 9月28日 · 截止 10月19日', '<button class="xy-btn xy-btn-primary" type="button">提前打卡 9月28日</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="true">收起详情</button>')}
${detailOps}
${taskLine('每天动手练习调用AI接口30分钟', '每天 · 1/31 天 · 截止 9月23日', '<button class="xy-btn xy-btn-primary" type="button">✓ 打卡</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="false">展开详情</button>')}
    </div>
  </div>
</div>`

/** 任务页（镜像 tasks.ts）：进行中组（详情展开）+ 待领取组 + 已完结组（唯一保留状态词处）。 */
const tasksSection = `
<div class="xy-page">
  <div class="xy-page-head">
    <h2 class="xy-page-title">全部任务</h2>
    <span class="xy-meta">共 4 个</span>
    <div class="xy-page-actions"><button class="xy-btn" type="button">＋ 新建任务</button></div>
  </div>
  <section class="xy-group">
    <h3 class="xy-group-head"><span class="xy-group-dot xy-group-dot-accent" aria-hidden="true"></span><span>进行中</span><span class="xy-group-count">2</span></h3>
    <div class="xy-grouplist">
    <div class="xy-grouprow xy-taskrow">
${taskLine('每周复盘token用量并优化调用方式', '每周 · 5/9 天 · 下次 9月28日 · 截止 10月19日', '<button class="xy-btn xy-btn-primary" type="button">提前打卡 9月28日</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="true">收起详情</button>')}
${detailOps}
    </div>
${taskLine('每天动手练习调用AI接口30分钟', '每天 · 1/31 天 · 截止 9月23日', '<button class="xy-btn xy-btn-primary" type="button">✓ 打卡</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="false">展开详情</button>')}
    </div>
  </section>
  <section class="xy-group">
    <h3 class="xy-group-head"><span class="xy-group-dot xy-group-dot-warn" aria-hidden="true"></span><span>待领取</span><span class="xy-group-count">1</span></h3>
    <div class="xy-grouplist">
${taskLine('每两周给相机传感器做一次清洁', '每周 · 领取后开始计 6 次', '<button class="xy-btn" type="button">领取</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="false">展开详情</button>')}
    </div>
  </section>
  <section class="xy-group">
    <h3 class="xy-group-head"><span class="xy-group-dot xy-group-dot-ok" aria-hidden="true"></span><span>已完结</span><span class="xy-group-count">1</span></h3>
    <div class="xy-grouplist">
${taskLine('试用新的深呼吸 App 两周', '每天 · 14/14 天 · 已完结', '')}
    </div>
  </section>
</div>`

/** 日历页（镜像 calendar.ts）。 */
const calSection = `
<div class="xy-page">
  <div class="xy-page-head xy-calnav">
    <button class="xy-btn" type="button" aria-label="上个月">‹</button>
    <h2 class="xy-page-title">2026年8月</h2>
    <button class="xy-btn" type="button" aria-label="下个月">›</button>
    <button class="xy-btn xy-calnav-back" type="button">回到本月</button>
  </div>
  <div class="xy-panel xy-calcard">
    <div class="xy-calhead">
      <span class="xy-calhead-cell">一</span><span class="xy-calhead-cell">二</span><span class="xy-calhead-cell">三</span><span class="xy-calhead-cell">四</span><span class="xy-calhead-cell">五</span><span class="xy-calhead-cell">六</span><span class="xy-calhead-cell">日</span>
    </div>
    <div class="xy-cal">
${calBody}
    </div>
    <div class="xy-legend">
      <span><i class="xy-dot xy-c0" aria-hidden="true"></i>无安排</span>
      <span><i class="xy-dot xy-c1" aria-hidden="true"></i>待打卡</span>
      <span><i class="xy-dot xy-c2" aria-hidden="true"></i>部分完成</span>
      <span><i class="xy-dot xy-c3" aria-hidden="true"></i>全部完成</span>
    </div>
  </div>
  <div class="xy-daypanel" aria-live="polite">
    <div class="xy-daydetail">
      <h3 class="xy-section-title">8月27日 周四</h3>
      <ul class="xy-grouplist">
        <li class="xy-grouprow">
          <div class="xy-rowmain">
            <span class="xy-rowtitle">每天动手练习调用AI接口30分钟</span>
            <span class="xy-meta">每天 · 3/31 天 · 待打卡</span>
          </div>
          <button class="xy-btn xy-btn-primary" type="button">打卡这天</button>
        </li>
      </ul>
    </div>
  </div>
</div>`

/** 成长页（镜像 growth.ts）：等级英雄卡 + 统计（streak 强调卡、缺省「暂无」）+ 近30天柱图。 */
const GCOL = (mh: number, h: number, full = false): string =>
  `<button class="xy-growth-col${full ? ' xy-full' : ''}" type="button" aria-label="镜像柱">
     <div class="xy-growth-stack">${mh > 0 ? `<div class="xy-growth-missed" style="height:${mh}%"></div>` : ''}<div class="xy-growth-bar" style="height:${h}%"></div></div>
   </button>`

const GTICK = (left: number, align: string, label: string): string =>
  `<span class="xy-growth-tick" style="left:${left}%;transform:translateX(${align})">${label}</span>`

const growthSection = `
<div class="xy-page">
  <div class="xy-hero" style="background:linear-gradient(135deg, color-mix(in srgb, #2563eb 76%, #000), #2563eb)">
    <div class="xy-herobadge" style="background:#2563eb">Lv.4</div>
    <div class="xy-heromain">
      <div class="xy-meta xy-onhero">当前等级</div>
      <h2 class="xy-herotitle">Lv.4 · 渐入佳境</h2>
      <div class="xy-bar xy-bar-onhero"><div class="xy-bar-fill xy-bar-fill-solid" style="transform:scaleX(.55)"></div></div>
      <div class="xy-meta xy-onhero">520 / 1000 EXP</div>
    </div>
  </div>
  <div class="xy-meta xy-heroreward">当前等级权益：解锁连续加成统计视图</div>
  <div class="xy-stats">
    <div class="xy-statcard"><div class="xy-statnum">42</div><div class="xy-meta">累计打卡天数</div></div>
    <div class="xy-statcard xy-statcard-hot"><div class="xy-statnum">6</div><div class="xy-meta">连续坚持</div></div>
    <div class="xy-statcard"><div class="xy-statnum">13</div><div class="xy-meta">最长连续坚持</div></div>
    <div class="xy-statcard"><div class="xy-statnum">3</div><div class="xy-meta">累计愿望</div></div>
    <div class="xy-statcard"><div class="xy-statnum">1</div><div class="xy-meta">已实现愿望</div></div>
    <div class="xy-statcard xy-statcard-muted"><div class="xy-statnum">暂无</div><div class="xy-meta">累计任务</div></div>
    <div class="xy-statcard xy-statcard-muted"><div class="xy-statnum">暂无</div><div class="xy-meta">已达成任务</div></div>
  </div>
  <h3 class="xy-section-title">近 30 天打卡</h3>
  <div class="xy-panel">
    <div class="xy-tip" role="status"></div>
    <div class="xy-growth">
      ${GCOL(0, 30)}${GCOL(0, 55)}${GCOL(22, 40)}${GCOL(0, 70)}${GCOL(0, 45)}${GCOL(18, 60)}${GCOL(0, 80)}
      ${GCOL(0, 35)}${GCOL(0, 65)}${GCOL(0, 50)}${GCOL(25, 30)}${GCOL(0, 75)}${GCOL(0, 58)}${GCOL(0, 88, true)}
    </div>
    <div class="xy-growth-axis">
      ${GTICK(0, '0%', '8/3')}${GTICK(50, '-50%', '8/17')}${GTICK(100, '-100%', '8/27')}
    </div>
    <div class="xy-legend">
      <span><i class="xy-dot xy-dot-checked" aria-hidden="true"></i>已打卡</span>
      <span><i class="xy-dot xy-dot-gap" aria-hidden="true"></i>未完成缺口</span>
      <span class="xy-meta">蓝色为已打卡，斜纹为当日未完成缺口，绿色柱为全勤日；悬停或聚焦柱子可看逐日明细。</span>
    </div>
  </div>
  <h3 class="xy-section-title">等级说明</h3>
  <div class="xy-levels">
    <div class="xy-levelrow xy-levelhit"><span class="xy-lvnum" style="background:#2563eb;color:#fff">Lv.4</span><span class="xy-lvname">渐入佳境</span><span class="xy-meta">需要 600 经验</span><span class="xy-meta xy-lvreward">✓ 连续加成提示</span></div>
    <div class="xy-levelrow"><span class="xy-lvnum">Lv.5</span><span class="xy-lvname">小有所成</span><span class="xy-meta">需要 1000 经验</span><span class="xy-meta xy-lvreward">专属庆祝动画</span></div>
  </div>
</div>`

/** 记忆页（镜像 memory.ts）：撰写卡 + 搜索行 + 分组列表（编辑/删除图标幽灵键）。 */
const MEMROW = (high: boolean, key: string, value: string, cat: string, imp: string, date: string): string => `
  <li class="xy-grouprow">
    <div class="xy-rowmain">
      <span class="xy-rowtitle">${high ? '<span class="xy-star-hi" aria-hidden="true">★</span>' : ''}${key}</span>
      <span class="xy-meta">${value}</span>
      <span class="xy-meta">${cat} · 重要度 ${imp} · ${date}</span>
    </div>
    <div class="xy-memactions">
      <button class="xy-btn xy-btn-icon" type="button" aria-label="编辑 · ${key}" title="编辑">${ICON_EDIT}</button>
      <button class="xy-btn xy-btn-danger xy-btn-icon" type="button" aria-label="删除 · ${key}" title="删除">${ICON_TRASH}</button>
    </div>
  </li>`

const memorySection = `
<div class="xy-page">
  <div class="xy-page-head">
    <h2 class="xy-page-title">记忆</h2>
    <span class="xy-meta">共 128 条 · 对话时按上限自动注入</span>
  </div>
  <div class="xy-compose">
    <input class="xy-input xy-input-grow" placeholder="键名（如：生日）" aria-label="键名" name="memory-key">
    <input class="xy-input xy-input-grow" placeholder="内容（如：3 月 5 日）" aria-label="内容" name="memory-value">
    <select class="xy-input" aria-label="分类" name="memory-category"><option>个人</option><option selected>其他</option></select>
    <select class="xy-input" aria-label="重要度" name="memory-importance"><option selected>中</option><option>高</option><option>低</option></select>
    <button class="xy-btn xy-btn-primary" type="button">＋ 添加</button>
  </div>
  <div class="xy-membar">
    <input type="search" class="xy-input xy-input-search" placeholder="搜索键名或内容…" aria-label="搜索键名或内容" name="memory-search">
  </div>
  <section class="xy-group">
    <ul class="xy-grouplist">
      ${MEMROW(true, '生日', '3 月 5 日，喜欢手工礼物多于贵重物品', '个人', '高', '2026-07-02')}
      ${MEMROW(false, '咖啡口味', '拿铁少糖，下午两点后不喝咖啡因', '偏好', '中', '2026-07-18')}
      ${MEMROW(false, '跑鞋尺码', '43 码，宽楦', '事件', '低', '2026-08-11')}
    </ul>
  </section>
  <div class="xy-memfoot">
    <button class="xy-btn xy-btn-danger" type="button">清空全部记忆</button>
    <span class="xy-meta">删除与清空不可恢复；注入条数上限在 设置 → 星愿 调整。</span>
  </div>
</div>`

/** 设置页（镜像 settings.ts）：教练风格分段选择 + 画像字段 + 对话偏好开关与定宽数字输入。 */
const settingsSection = `
<div class="xy-page">
  <div class="xy-settings">
    <section class="xy-panel">
      <h3 class="xy-panel-head">教练风格</h3>
      <div class="xy-seg" role="group" aria-label="教练风格">
        <button class="xy-seg-btn" type="button" aria-pressed="false">温柔型</button>
        <button class="xy-seg-btn xy-on" type="button" aria-pressed="true">严格型</button>
        <button class="xy-seg-btn" type="button" aria-pressed="false">幽默型</button>
      </div>
      <p class="xy-hint">当前：严格型。决定对话语气与人设，也可在对话中说「对我严格一点」。</p>
    </section>
    <section class="xy-panel">
      <h3 class="xy-panel-head">昵称与画像</h3>
      <label class="xy-field"><span class="xy-quick-label">昵称</span><input class="xy-input xy-input-wide" placeholder="昵称：希望被怎么称呼（留空清除）" name="xy-nickname"></label>
      <label class="xy-field"><span class="xy-quick-label">职业</span><input class="xy-input xy-input-wide" placeholder="职业（留空清除）" name="xy-occupation"></label>
      <label class="xy-field"><span class="xy-quick-label">兴趣</span><input class="xy-input xy-input-wide" placeholder="兴趣：用顿号或逗号分隔（如 阅读、跑步）" name="xy-interests"></label>
      <div class="xy-save-row">
        <button class="xy-btn xy-btn-primary" type="button">保存画像</button>
        <span class="xy-saved" role="status"><span aria-hidden="true">✓ </span>画像已保存</span>
      </div>
      <p class="xy-hint">与对话侧共享同一份档案；对话里说「叫我小星」也会更新。</p>
    </section>
    <section class="xy-panel">
      <h3 class="xy-panel-head">对话偏好</h3>
      <label class="xy-field">
        <span class="xy-field-head"><input type="checkbox" class="xy-toggle" name="confirmWrites" checked>写操作二次确认</span>
        <p class="xy-hint">创建愿望/任务、打卡、取消打卡时先弹应用内确认卡（删除始终确认）；关闭后对话中的这类操作将直接执行。</p>
      </label>
      <label class="xy-field">
        <span class="xy-field-head">记忆注入上限</span>
        <input type="number" min="5" max="200" class="xy-input xy-input-num" name="memoryInjectLimit" inputmode="numeric" value="40">
        <span class="xy-hint">每次对话自动注入上下文的记忆条数上限（5-200，默认 40）；失焦后保存。</span>
      </label>
    </section>
    <p class="xy-hint">业务数据存于本机 ~/.dsh/xingyuan/，备份即拷贝该目录。</p>
  </div>
</div>`

/** 快速新建（镜像 quick-create.ts）：虚线可书写面板 + 字段纵排标签。 */
const quickSection = `
<div class="xy-page">
  <form class="xy-quick">
    <span class="xy-meta">轻量表单适合简单记录；需要 AI 推荐拆解、微行动规划请直接对话描述。</span>
    <div class="xy-quick-row">
      <label class="xy-quick-field">
        <span class="xy-quick-label">任务名称</span>
        <input class="xy-input" maxlength="100" name="task-name" placeholder="要养成的习惯（如：每天背 20 个单词）">
      </label>
      <label class="xy-quick-field">
        <span class="xy-quick-label">重复周期</span>
        <select class="xy-input" name="task-cycle"><option>仅一次</option><option selected>每日</option><option>每周</option><option>每月</option></select>
      </label>
      <label class="xy-quick-field">
        <span class="xy-quick-label">截止日期（可选）</span>
        <input type="date" class="xy-input" name="task-due">
      </label>
    </div>
    <div class="xy-quick-actions"><button type="submit" class="xy-btn xy-btn-primary">创建</button></div>
  </form>
</div>`

/** 空态/错误态（镜像 ui.ts 的 PageEmpty / PageError）：纯文字版式。
 * 历史坑：旧版带 SVG 线稿插画，描边色 color-mix() 在部分浏览器失效导致
 * 整稿隐形、只剩 accent 点缀孤点——本场景同时陈列危险按钮（兼容令牌描边）
 * 供双主题核对。 */
const emptySection = `
<div class="xy-page">
  <div class="xy-page-center">
    <div class="xy-empty-title">还没有愿望</div>
    <div class="xy-meta xy-empty-hint">告诉我最想实现什么，我来帮你拆解成可坚持的计划。</div>
  </div>
</div>
<div class="xy-page">
  <div class="xy-page-center">
    <div class="xy-empty-title">还没有任务</div>
    <div class="xy-meta xy-empty-hint">告诉我你想养成的习惯，或从「愿望」页开始规划。</div>
  </div>
</div>
<div class="xy-page">
  <div class="xy-page-center">
    <div class="xy-empty-title">加载失败：服务暂不可用</div>
    <button class="xy-btn" type="button">重试</button>
  </div>
  <div style="display:flex;gap:10px;justify-content:center;padding:10px 0 22px">
    <button class="xy-btn xy-btn-danger" type="button">删除愿望</button>
    <button class="xy-btn xy-btn-primary" type="button">＋ 新建愿望</button>
  </div>
</div>`

const html = (dark: boolean): string => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>[视觉 mock] 星愿视图样式核对（${dark ? 'dark' : 'light'}）</title>
<style>
  body{margin:0;${dark ? 'background:#141a22;' : SHELL_LIGHT}font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
  ${dark ? `body[data-ds-dark-theme]{${SHELL_DARK}}` : ''}
  .xy-page{background:var(--dsw-alias-bg-layer-1);margin-bottom:26px}
</style>
<style>${STYLE_TEXT}</style>
</head>
<body${dark ? ' data-ds-dark-theme' : ''}>
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">日历页</h1>
  ${calSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">今日页</h1>
  ${todaySection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">愿望页 · 卡内展开详情（周对齐打卡网格 / 图标删除键）</h1>
  ${wishSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">任务页 · 分组卡展开详情（已完结行保留状态词）</h1>
  ${tasksSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">成长页</h1>
  ${growthSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">记忆页</h1>
  ${memorySection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">设置页</h1>
  ${settingsSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">快速新建 · 任务轻表单</h1>
  ${quickSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">空态 / 错误态 / 危险按钮（纯文字版式 + 兼容令牌描边）</h1>
  ${emptySection}
</body>
</html>`

for (const dark of [true, false]) {
  const out = fileURLToPath(new URL(`./ui-mock${dark ? '' : '-light'}.html`, import.meta.url))
  writeFileSync(out, html(dark), 'utf8')
  console.log(`written: ${out} (${html(dark).length} bytes)`)
}
