/**
 * 视觉验证回路：用真实 STYLE_TEXT + 手写镜像 DOM 生成深/浅两主题的静态 mock 页，
 * 供浏览器截图核对客户端样式改版（客户端 React 页面无法脱离 dsh 壳运行，见 AGENTS.md §5.10）。
 *
 * 运行：npx vite-node debug/gen-mock.ts
 *   → 产出 debug/ui-mock.html（深色）与 debug/ui-mock-light.html（浅色），本地起静态服务截图核对。
 * 纪律：markup 为真实 tsx 输出的手写镜像，仅用于视觉核对；对应组件结构变更时须同步本文件。
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

const dcells = [
  ...[24, 31, 7, 14, 21, 28, 5, 12, 19].map((n) => `<span class="xy-dcell xy-dcell-checked" aria-hidden="true">${n}</span>`),
  ...[26, 2, 9].map((n) => `<span class="xy-dcell xy-dcell-missed" aria-hidden="true">${n}</span>`),
  ...[16, 23, 30].map((n) => `<span class="xy-dcell xy-dcell-future" aria-hidden="true">${n}</span>`),
].join('')

/** 展开详情（镜像 detail.ts）：操作区为 [主操作][辅助][危险] 单行成组，无重复元信息行。 */
const detailOps = `
<div class="xy-detail" id="mock-detail">
  <div>
    <span class="xy-quick-label">打卡记录</span>
    <div class="xy-detail-grid" role="img" aria-label="近 28 天：已打卡 9，未打卡 3，未来 3">${dcells}</div>
    <div class="xy-legend">
      <span><i class="xy-dot xy-dcell-checked" aria-hidden="true"></i>已打卡</span>
      <span><i class="xy-dot xy-dcell-missed" aria-hidden="true"></i>未打卡</span>
      <span><i class="xy-dot xy-dcell-future" aria-hidden="true"></i>未来机会日</span>
    </div>
  </div>
  <div class="xy-detail-next">接下来的机会日：2026-09-28、2026-10-05、2026-10-12、2026-10-19</div>
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

/** 任务行（镜像 task-line.ts）。 */
const taskLine = (name: string, meta: string, actions: string): string => `
  <div class="xy-taskline">
    <span class="xy-taskname">${name}</span>
    <span class="xy-meta">${meta}</span>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${actions}</div>
  </div>`

/** 任务页分组卡：展开详情 + 下一条任务行（核对详情底部分割线间距）。 */
const tasksSection = `
<div class="xy-page">
  <div class="xy-page-head">
    <h2 class="xy-page-title">全部任务</h2>
    <span class="xy-meta">共 3 个</span>
    <div class="xy-page-actions"><button class="xy-btn" type="button">＋ 新建任务</button></div>
  </div>
  <section class="xy-group">
    <h3 class="xy-group-head"><span class="xy-group-dot xy-group-dot-accent" aria-hidden="true"></span><span>进行中</span><span class="xy-group-count">2</span></h3>
    <div class="xy-grouplist">
    <div class="xy-grouprow xy-taskrow">
${taskLine('每周复盘token用量并优化调用方式', '每周 · 5/9 天 · 进行中 · 下次 2026-09-28 · 截止 2026-10-19', '<button class="xy-btn xy-btn-primary" type="button">提前打卡 9月28日</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="true">收起详情</button>')}
${detailOps}
    </div>
${taskLine('每天动手练习调用AI接口30分钟', '每天 · 1/31 天 · 进行中 · 截止 2026-09-23', '<button class="xy-btn xy-btn-primary" type="button">✓ 打卡</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="false">展开详情</button>')}
    </div>
  </section>
</div>`

/** 愿望卡嵌套（镜像 wishes.ts）：wishtasks 内 [任务行, 展开详情, 任务行]——分割线间距的原始问题场景。 */
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
      <button class="xy-btn xy-btn-danger xy-wishdel" type="button">删除</button>
    </div>
    <div class="xy-meta">拥有属于自己的 AI 接口额度与调用能力，想用就用，不受平台和次数限制。</div>
    <div class="xy-meta">预计完成 2026-11-24</div>
    <div class="xy-bar"><div class="xy-bar-fill" style="transform:scaleX(.15)"></div></div>
    <div class="xy-wishtasks">
${taskLine('每周复盘token用量并优化调用方式', '每周 · 5/9 天 · 进行中 · 下次 2026-09-28 · 截止 2026-10-19', '<button class="xy-btn xy-btn-primary" type="button">提前打卡 9月28日</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="true">收起详情</button>')}
${detailOps}
${taskLine('每天动手练习调用AI接口30分钟', '每天 · 1/31 天 · 进行中 · 截止 2026-09-23', '<button class="xy-btn xy-btn-primary" type="button">✓ 打卡</button><button class="xy-btn xy-btn-inline" type="button" aria-expanded="false">展开详情</button>')}
    </div>
  </div>
</div>`

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
      <h3 class="xy-section-title">2026-08-27 <span style="font-weight:400;margin-left:6px">周四</span></h3>
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

const html = (dark: boolean): string => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>[视觉 mock] 星愿视图样式核对（${dark ? 'dark' : 'light'}）</title>
<style>
  body{margin:0;${dark ? 'background:#141a22;' : SHELL_LIGHT}font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
  ${dark ? `body[data-ds-dark-theme]{${SHELL_DARK}}` : ''}
  .xy-page{background:var(--dsw-alias-bg-layer-1)}
</style>
<style>${STYLE_TEXT}</style>
</head>
<body${dark ? ' data-ds-dark-theme' : ''}>
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">日历页</h1>
  ${calSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">愿望页 · 卡内展开详情（分割线间距核对）</h1>
  ${wishSection}
  <h1 style="color:var(--dsw-alias-label-primary);font-size:14px;padding:12px 20px 0">任务页 · 分组卡展开详情</h1>
  ${tasksSection}
</body>
</html>`

for (const dark of [true, false]) {
  const out = fileURLToPath(new URL(`./ui-mock${dark ? '' : '-light'}.html`, import.meta.url))
  writeFileSync(out, html(dark), 'utf8')
  console.log(`written: ${out} (${html(dark).length} bytes)`)
}
