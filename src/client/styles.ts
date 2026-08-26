/**
 * 星愿 client 半侧全站样式。
 *
 * 分层契约：
 * - 结构色一律引用壳令牌 --dsw-alias-*（跟随壳深浅切换，body[data-ds-dark-theme]）；
 * - 品牌强调色用自管 --xyd-* 对（星愿蓝：浅 #1a6fe0 / 深 #60a5fa，前景对比 ≥4.5:1）；
 * - 分类徽章走 --cat-* HSL 变量（JS 供色相/饱和度，CSS 按主题供亮度，与 Web 分层同构）；
 * - 形状纪律四档圆角：卡片 12 / 内嵌块 9 / 控件 8 / 胶囊 999；
 * - 动效刻度：交互 150ms ease-out，进度条 350ms cubic-bezier(.22,1,.36,1)，
 *   prefers-reduced-motion 下全部关闭。
 */
export const STYLE_TEXT = `
/* ===== 品牌与语义令牌 ===== */
:root{
  --xyd-accent:#1a6fe0;
  --xyd-on-accent:#ffffff;
  --xyd-accent-strong:#1e40af;
  --xyd-accent-soft:rgba(26,111,224,.12);
  --xyd-danger:#c0392b;
  --xyd-danger-bg:#c0392b;
  --xyd-warn:#b45309;
  --xyd-ok:#0f766e;
  /* 空态插画线稿色（结构色的弱化档） */
  --xyd-art-line:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent);
  /* 圆角刻度 */
  --xyd-r-card:12px;--xyd-r-inner:9px;--xyd-r-ctl:8px;
}
body[data-ds-dark-theme]{
  --xyd-accent:#60a5fa;
  --xyd-on-accent:#0f172a;
  --xyd-accent-strong:#93c5fd;
  --xyd-accent-soft:rgba(96,165,250,.16);
  --xyd-danger:#ff9b8f;
  --xyd-danger-bg:#e2635a;
  --xyd-warn:#fbbf24;
  --xyd-ok:#34d399;
}

.xy-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ===== 会话卡片 ===== */
.xy-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);padding:11px 14px;margin:6px 0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:14px}
.xy-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* 长内容纪律：徽章不收缩；标题允许断行收缩——杜绝长英文词横向溢出与整行抖动 */
.xy-badge{flex:none;font-size:11px;border-radius:6px;padding:1px 7px;color:var(--dsw-alias-label-primary)}
/* 分类徽章：HSL 变量供色，亮度按主题分层（对齐 Web wish-category 的 .dark 覆盖口径） */
.xy-badge-cat{background:hsl(var(--cat-h,275) calc(var(--cat-sbg,58)*1%) 92%);color:hsl(var(--cat-h,275) calc(var(--cat-sfg,46)*1%) 30%);border:1px solid hsl(var(--cat-h,275) calc(var(--cat-sbd,46)*1%) 55% / .12)}
body[data-ds-dark-theme] .xy-badge-cat{background:hsl(var(--cat-h,275) calc(var(--cat-sbg,58)*1%) 22%);color:hsl(var(--cat-h,275) calc(var(--cat-sfg,46)*1%) 80%);border-color:hsl(var(--cat-h,275) calc(var(--cat-sbd,46)*1%) 70% / .2)}
.xy-badge-task{background:var(--xyd-accent-soft)}
.xy-badge-chart{background:rgba(56,217,169,.18)}
.xy-badge-micro{background:rgba(255,169,77,.2)}
.xy-title{min-width:0;font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.xy-deleted{opacity:.55}
.xy-deleted .xy-title{text-decoration:line-through}
.xy-meta{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:4px;overflow-wrap:anywhere}
.xy-preview{margin-top:6px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:var(--xyd-r-inner);padding:6px 8px}
.xy-checkin{border-color:rgba(56,217,169,.45);background:rgba(56,217,169,.08)}
.xy-glyph{font-size:15px;font-weight:700;line-height:1}
.xy-glyph-ok{color:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-glyph-back{color:var(--dsw-alias-label-secondary)}
.xy-actioned{margin-left:auto;color:var(--dsw-alias-state-success-primary,var(--xyd-ok))}

/* 微行动卡 */
.xy-micro{border-color:rgba(255,169,77,.4)}
.xy-microsteps{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.xy-microstep{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-inner);background:var(--dsw-alias-bg-layer-2)}
.xy-microstep.xy-done{opacity:.66}
.xy-microstep.xy-done .xy-microsteptext{text-decoration:line-through}
.xy-microstep.xy-skipped{opacity:.5}
.xy-microstepnum{flex:none;width:20px;height:20px;border-radius:50%;background:var(--xyd-accent);color:var(--xyd-on-accent);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin-top:1px}
.xy-microsteptext{font-size:13px;display:flex;flex-direction:column;min-width:0}
.xy-microstate{margin-left:auto;flex:none}

/* 图表卡 */
.xy-chart{background:var(--dsw-alias-bg-layer-1)}
.xy-chart-legend{display:flex;gap:12px;margin-top:8px;font-size:11px;color:var(--dsw-alias-label-secondary);align-items:center}
.xy-arcwrap{margin-top:8px}
.xy-arcnum{font-size:22px;font-weight:700;color:var(--xyd-accent);font-variant-numeric:tabular-nums}
.xy-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);margin-top:6px;overflow:hidden}
.xy-bar-fill{height:100%;border-radius:inherit;background:var(--xyd-accent);transition:width .35s cubic-bezier(.22,1,.36,1)}
.xy-rows{list-style:none;margin-top:6px;display:flex;flex-direction:column;gap:4px;padding:0}
.xy-row{display:flex;justify-content:space-between;font-size:13px}
.xy-rowval{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.xy-heat{display:grid;grid-template-columns:repeat(auto-fill,minmax(14px,1fr));gap:2px;margin-top:8px}
.xy-heatcell{aspect-ratio:1;border-radius:3px;background:var(--dsw-alias-state-success-primary)}
.xy-svg{width:100%;height:auto;margin-top:6px}

/* ===== Toast 轻提示 ===== */
.xy-toasts{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:9999;pointer-events:none;max-width:min(92vw,460px)}
.xy-toast{pointer-events:auto;display:flex;align-items:center;gap:9px;padding:9px 14px;border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:0 8px 24px -8px rgba(15,23,42,.2),0 2px 8px -2px rgba(15,23,42,.1);animation:xy-toast-in .24s cubic-bezier(.22,1,.36,1);cursor:pointer}
.xy-toast-out{opacity:0;transform:translateY(-6px);transition:opacity .22s ease,transform .22s ease}
@keyframes xy-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.xy-toast-glyph{flex:none;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff}
.xy-toast-ok .xy-toast-glyph{background:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-toast-info .xy-toast-glyph{background:var(--xyd-accent);color:var(--xyd-on-accent)}
.xy-toast-error .xy-toast-glyph{background:var(--xyd-danger-bg)}

/* ===== 骨架屏加载态 ===== */
.xy-skel{border-radius:var(--xyd-r-inner);background:linear-gradient(90deg,var(--dsw-alias-bg-layer-2) 25%,var(--dsw-alias-bg-layer-1) 45%,var(--dsw-alias-bg-layer-2) 65%);background-size:200% 100%;animation:xy-shimmer 1.4s ease infinite}
.xy-skel-title{height:22px;width:38%;margin-bottom:14px}
.xy-skel-row{height:64px;margin-top:10px}
@keyframes xy-shimmer{from{background-position:180% 0}to{background-position:-20% 0}}

/* ===== 空态插画（T1-8）===== */
.xy-page-center{display:flex;flex-direction:column;align-items:center;gap:6px;padding:44px 0;text-align:center}
.xy-art{opacity:.92;margin-bottom:2px}
.xy-empty-title{font-weight:600;color:var(--dsw-alias-label-primary);margin-top:4px}
.xy-empty-hint{margin-top:2px;max-width:360px}

/* ===== 会话视图页骨架 ===== */
/* 节奏锁：页 padding 18/20 · 区块间 14（section-title 上边距）· 行间距 6/10 */
.xy-page{padding:18px 20px 26px;max-width:780px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:14px}
.xy-page-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.xy-page-title{font-size:17px;font-weight:700;margin:0;color:var(--dsw-alias-label-primary)}
.xy-section-title{font-size:12px;color:var(--dsw-alias-label-secondary);margin:14px 0 6px;font-weight:600;letter-spacing:.02em}
/* 页头动作组：单一 margin-left:auto 整体右置——多按钮各自 auto 会平分剩余空间 */
.xy-page-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap}

/* 控件体系 */
.xy-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:var(--xyd-r-ctl);padding:4px 12px;font-size:13px;cursor:pointer;line-height:1.5;transition:border-color .15s ease,background-color .15s ease,color .15s ease,filter .15s ease,transform .12s ease}
.xy-btn:hover:not(:disabled){border-color:var(--xyd-accent);color:var(--xyd-accent)}
.xy-btn:active:not(:disabled){transform:scale(.97)}
.xy-btn:disabled{opacity:.55;cursor:not-allowed}
.xy-btn:focus-visible,.xy-input:focus-visible,.xy-cell:focus-visible,.xy-seg-btn:focus-visible,.xy-toggle:focus-visible,.xy-swatch:focus-visible,.xy-growth-col:focus-visible{outline:2px solid var(--xyd-accent);outline-offset:2px}
/* 触控基线：消除移动端双击缩放延迟与系统点按高亮（交互反馈统一由 hover/active 承担） */
.xy-btn,.xy-seg-btn,.xy-cell,.xy-swatch,.xy-toggle,.xy-growth-col{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
/* 行内按钮：≥24px 命中目标（卡片头/操作行的紧凑主战按钮） */
.xy-btn-inline{margin-left:auto;padding:3px 10px;font-size:12px;min-height:24px;display:inline-flex;align-items:center}
.xy-btn-primary{background:var(--xyd-accent);border-color:transparent;color:var(--xyd-on-accent)}
.xy-btn-primary:hover:not(:disabled){filter:brightness(1.06);color:var(--xyd-on-accent)}
.xy-btn-danger{color:var(--xyd-danger);border-color:color-mix(in srgb, var(--xyd-danger) 40%, transparent);background:transparent}
.xy-btn-danger:hover:not(:disabled){background:color-mix(in srgb, var(--xyd-danger) 9%, transparent);color:var(--xyd-danger)}
.xy-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:var(--xyd-r-ctl);padding:5px 8px;font-size:13px;font-family:inherit;transition:border-color .15s ease}
.xy-input:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}
.xy-input::placeholder{color:var(--dsw-alias-label-secondary)}
.xy-input:disabled{opacity:.55;cursor:not-allowed}
.xy-field-err{color:var(--xyd-danger);font-size:12px;margin-top:4px}

/* 列表行 */
.xy-listrows{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:6px}
.xy-rowitem{list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-inner);background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease,box-shadow .15s ease}
.xy-rowitem:hover{border-color:var(--dsw-alias-border-l2);box-shadow:0 1px 4px rgba(15,23,42,.06)}
body[data-ds-dark-theme] .xy-rowitem:hover{box-shadow:0 1px 4px rgba(0,0,0,.3)}
.xy-rowmain{display:flex;flex-direction:column;gap:2px;min-width:0}
.xy-rowtitle{font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
/* 完成态行首装饰勾（aria-hidden，语义由行文案承担） */
.xy-done-glyph{color:var(--dsw-alias-state-success-primary,var(--xyd-ok));margin-right:2px}
/* 高重要度星标：琥珀警示色（不复用完成勾的绿色，语义不撞车） */
.xy-star-hi{color:var(--xyd-warn);margin-right:2px}
.xy-done{opacity:.72}
.xy-banner-ok{margin-top:10px;padding:10px 12px;border-radius:var(--xyd-r-inner);background:rgba(56,217,169,.09);border:1px solid rgba(56,217,169,.35);font-size:13px}

/* ===== 分组卡（任务页状态分桶 / 今日页待打卡·已完成共用）=====
 * 卡片容器 + 状态点标题行 + 分隔线行列表：替代裸堆叠的 section-title+wishtasks；
 * 组间距 12 与页头 margin-bottom 12 同拍，行内边距 11/14 对齐卡片体系节奏锁。 */
.xy-group{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.xy-group-head{display:flex;align-items:center;gap:8px;margin:0;padding:9px 14px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.xy-group-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.xy-group-dot-accent{background:var(--xyd-accent)}
.xy-group-dot-warn{background:var(--xyd-warn)}
.xy-group-dot-ok{background:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-group-count{margin-left:auto;flex:none;font-size:11px;line-height:1.7;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.xy-grouplist{list-style:none;display:flex;flex-direction:column;margin:0;padding:0}
.xy-grouprow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid var(--dsw-alias-border-l1);transition:background-color .15s ease}
.xy-grouprow:first-child{border-top:none}
.xy-grouprow:hover{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 42%, transparent)}
/* 分组卡的块级行变体（任务行 + 可选内联详情）；TaskLine 基类本身即两栏网格（见愿望卡段） */
.xy-taskrow{display:block}
.xy-taskrow .xy-detail{margin-bottom:2px}

/* ===== 面板卡（日历/成长图表/设置分节等通用容器）=====
 * 与愿望卡同一卡片语法但无 hover 态：纯容器。子元素间距由各页既有 margin 负责。 */
.xy-panel{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.xy-panel>.xy-skel:first-child{margin-top:0}
.xy-panel-head{margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary)}

/* ===== 今日概览卡 =====
 * 标题、完成计数与进度条同卡呈现：进度条不再作为裸条悬在页头下方
 * （0% 时即用户所见「空白横条」）；品牌色轻晕染提供今日页的视觉锚点。 */
.xy-todayhero{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);padding:13px 16px;display:flex;flex-direction:column;gap:9px;background:linear-gradient(135deg,var(--xyd-accent-soft),transparent 55%),var(--dsw-alias-bg-layer-1)}
.xy-todayhero-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.xy-todayhero-num{margin-left:auto;font-size:15px;font-weight:700;color:var(--xyd-accent);font-variant-numeric:tabular-nums}
.xy-todayhero-all .xy-todayhero-num{color:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-todayhero .xy-bar{height:10px;margin-top:0}
.xy-todayhero .xy-banner-ok{margin-top:0}

/* 愿望卡（页面） */
.xy-wishcard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:var(--xyd-r-card);padding:12px 14px;margin-top:10px;transition:border-color .15s ease,box-shadow .15s ease}
.xy-wishcard:hover{border-color:var(--dsw-alias-border-l2);box-shadow:0 2px 10px rgba(15,23,42,.07)}
body[data-ds-dark-theme] .xy-wishcard:hover{box-shadow:0 2px 10px rgba(0,0,0,.32)}
.xy-progress-num{margin-left:auto;flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
/* 卡内子任务列表：分隔线替代裸 gap 堆叠；行留白由任务行自身 padding 承担。
 * 结构为 [taskline, detail?, taskline, detail?] —— 相邻选择器精确命中「新任务行」边界。 */
.xy-wishtasks{margin-top:8px;display:flex;flex-direction:column;border-top:1px dashed var(--dsw-alias-border-l1)}
.xy-wishtasks>.xy-taskline+.xy-taskline,.xy-wishtasks>.xy-detail+.xy-taskline{border-top:1px solid var(--dsw-alias-border-l1)}
.xy-wishtasks>.xy-taskline{padding:9px 0}
/* TaskLine 基类 = 两栏网格：名称/元信息居左收缩换行，动作簇（领取/打卡 + 详情开关）右置垂直居中；
 * 愿望卡子任务与任务页共用同一行语法。 */
.xy-taskline{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;row-gap:2px;align-items:center}
.xy-taskname{grid-column:1;grid-row:1;font-weight:600;font-size:13px;overflow-wrap:anywhere}
.xy-taskline>.xy-meta{grid-column:1;grid-row:2;margin-top:0}
.xy-taskline>div:last-child{grid-column:2;grid-row:1/span 2;justify-self:end}
/* 愿望卡删除：紧凑危险键，hover/focus 才显底色（低频高危动作不抢视觉；键盘聚焦与鼠标等效） */
.xy-wishdel{padding:2px 8px;font-size:11px;opacity:.62}
.xy-wishdel:hover:not(:disabled),.xy-wishdel:focus-visible{opacity:1}

/* ===== 日历 ===== */
.xy-calhead{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:8px}
.xy-calhead-cell{text-align:center;font-size:11px;color:var(--dsw-alias-label-secondary)}
.xy-cal{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.xy-week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.xy-cell{aspect-ratio:1;border-radius:var(--xyd-r-inner);border:none;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;transition:box-shadow .15s ease}
.xy-empty{visibility:hidden}
.xy-c0{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:default}
/* 待打卡 = 空心虚线格（与部分完成的实心琥珀拉开明度与质感双重差距） */
.xy-c1{background:transparent;border:1px dashed var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.xy-c2{background:rgba(255,169,77,.48);color:#5f3c00}
.xy-c3{background:rgba(56,217,169,.42);color:#0b3d26}
body[data-ds-dark-theme] .xy-c2{background:rgba(255,169,77,.26);color:#ffd9a8}
body[data-ds-dark-theme] .xy-c3{background:rgba(46,160,105,.32);color:#a7f3c9}
.xy-today{outline:2px solid var(--xyd-accent);outline-offset:1px}
.xy-cell:not(.xy-empty):hover{box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--xyd-accent) 45%, transparent)}
.xy-picked{box-shadow:inset 0 0 0 2px var(--xyd-accent)}
.xy-legend{display:flex;gap:14px;margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary);align-items:center}
.xy-dot{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:4px;vertical-align:-1px}
.xy-dot.xy-c0{background:var(--dsw-alias-bg-layer-2)}
.xy-dot.xy-c1{background:transparent;border:1px dashed var(--dsw-alias-border-l3)}
.xy-dot.xy-c2{background:rgba(255,169,77,.48)}
.xy-dot.xy-c3{background:rgba(56,217,169,.42)}
body[data-ds-dark-theme] .xy-dot.xy-c2{background:rgba(255,169,77,.26)}
body[data-ds-dark-theme] .xy-dot.xy-c3{background:rgba(46,160,105,.32)}
/* 月历收进面板卡：星期头贴卡顶（抵消裸排版时代的 margin-top），图例随卡内节奏 */
.xy-calcard .xy-calhead{margin-top:0}
/* 详情面板常驻并升级为附卡：固定最小高度 + 超长内部滚动，点击不同日期不再引起整页高度抖动 */
.xy-daypanel{margin-top:10px;min-height:112px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);padding:11px 14px}
.xy-daypanel .xy-daydetail{max-height:300px;overflow-y:auto;scrollbar-gutter:stable}
/* 详情任务行复用分组卡行语法：贴面板内边距，不留双重大边距 */
.xy-daypanel .xy-grouprow{padding:9px 0}
.xy-daypanel .xy-section-title{margin-top:2px}
.xy-dayhint{padding-top:0}
/* 拾取加载行：点击日期取详情期间的细条骨架（占位高度恒定，面板不跳） */
.xy-pickline{height:12px;width:46%;margin-top:2px}

/* ===== 统计卡 & 成长 ===== */
.xy-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:8px}
.xy-statcard{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);padding:14px;text-align:center}
.xy-statnum{font-size:24px;font-weight:700;color:var(--xyd-accent);font-variant-numeric:tabular-nums}
.xy-growth{display:flex;gap:3px;align-items:stretch;height:120px;margin-top:10px}
.xy-growth-col{flex:1;display:flex;flex-direction:column;height:100%;min-width:0;border:none;background:transparent;padding:0;cursor:default;border-radius:3px 3px 0 0}
.xy-growth-stack{flex:1;display:flex;flex-direction:column;justify-content:flex-end;width:100%}
.xy-growth-bar{background:var(--xyd-accent);border-radius:2px 2px 0 0;width:100%;transition:height .35s cubic-bezier(.22,1,.36,1)}
.xy-growth-col.xy-full .xy-growth-bar{background:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-growth-missed{background:var(--dsw-alias-bg-layer-2);border-radius:2px 2px 0 0;width:100%}
button.xy-growth-col{cursor:pointer}
button.xy-growth-col:hover,button.xy-growth-col.xy-hover{box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--xyd-accent) 55%, transparent)}
.xy-growth-axis{position:relative;height:16px;margin-top:4px}
.xy-growth-tick{position:absolute;top:0;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
/* 成长页悬浮明细（T1-7） */
.xy-tip{position:relative;margin-top:0;min-height:20px;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-inner);padding:3px 10px;display:inline-block;font-variant-numeric:tabular-nums}
.xy-tip:empty{visibility:hidden}
/* 图表加载占位：与成品图等高，数据到达不引起下方内容位移 */
.xy-chartload{height:150px;margin-top:8px}

/* ===== 成长页：等级英雄卡 + 等级说明 ===== */
.xy-hero{display:flex;gap:14px;align-items:center;border-radius:var(--xyd-r-card);padding:18px;margin-top:12px;box-shadow:0 2px 10px rgba(30,25,60,.12)}
.xy-herobadge{width:54px;height:54px;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px;flex:none;text-shadow:0 1px 2px rgba(0,0,0,.18)}
.xy-heromain{flex:1;min-width:0}
.xy-onhero{color:rgba(255,255,255,.88)!important}
.xy-herotitle{font-size:19px;font-weight:700;margin:3px 0 8px;color:#fff}
.xy-bar-onhero{background:rgba(255,255,255,.28)}
.xy-bar-fill-solid{background:#fff}
.xy-heroreward{margin-top:8px}
.xy-levels{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);padding:4px 14px}
.xy-levelrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1);opacity:.55;font-size:13px}
.xy-levelrow:last-child{border-bottom:none}
.xy-levelhit{opacity:1}
.xy-lvnum{width:42px;height:24px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none}
.xy-lvname{font-weight:600;width:64px;color:var(--dsw-alias-label-primary)}
.xy-lvreward{margin-left:auto;text-align:right}

/* ===== 记忆页 ===== */
/* 添加/编辑记忆表单：虚线面板卡（与快速新建同一「可书写」语法） */
.xy-compose{margin-top:12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;gap:8px;flex-wrap:wrap}
.xy-compose .xy-input-grow{flex:1 1 170px;width:auto;min-width:140px}
.xy-compose select.xy-input{width:auto}
.xy-editing{display:flex;align-items:center;gap:10px;margin-top:12px;padding:7px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--xyd-r-inner)}
.xy-memactions{display:flex;gap:6px;flex:none}
.xy-membar{display:flex;align-items:center;gap:10px;margin-top:14px}
.xy-membar .xy-input-search{width:min(250px,100%)}
.xy-memcap{margin-top:6px}
.xy-saved{color:var(--dsw-alias-state-success-primary,var(--xyd-ok));font-size:13px}
.xy-memfoot{display:flex;align-items:center;gap:12px;margin-top:14px}

/* ===== 设置页 ===== */
.xy-settings{display:flex;flex-direction:column;gap:16px;max-width:560px;color:var(--dsw-alias-label-primary);font-size:14px}
/* 设置三个分节各自成面板卡；间距交给 xy-settings 的 gap，卡内子元素统一 10px 纵向节奏 */
.xy-settings .xy-panel{margin-top:0}
.xy-settings .xy-panel>*+*{margin-top:10px}
.xy-field{display:flex;flex-direction:column;gap:6px}
.xy-field-head{display:flex;align-items:center;gap:8px;font-weight:600}
.xy-input-wide{width:100%;max-width:360px;box-sizing:border-box}
.xy-seg{display:flex;gap:6px;flex-wrap:wrap}
.xy-seg-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:999px;padding:4px 14px;font-size:13px;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,color .15s ease}
.xy-seg-btn:hover{border-color:var(--xyd-accent)}
/* 选中态双选择器：类名与 aria-pressed 属性等价（组件侧用属性表达状态语义） */
.xy-seg-btn.xy-on,.xy-seg-btn[aria-pressed='true']{background:var(--xyd-accent);border-color:transparent;color:var(--xyd-on-accent)}
.xy-save-row{display:flex;align-items:center;gap:10px;margin-top:2px}
.xy-toggle{width:38px;height:22px;appearance:none;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);position:relative;cursor:pointer;transition:background .15s}
.xy-toggle:checked{background:var(--xyd-accent);border-color:transparent}
.xy-toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:left .15s}
.xy-toggle:checked::after{left:18px;background:var(--xyd-on-accent)}
.xy-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}

/* ===== 详情聚合视图（T1-1）===== */
.xy-detail{margin-top:8px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px;display:flex;flex-direction:column;gap:8px}
.xy-detail-grid{display:flex;flex-wrap:wrap;gap:4px;padding:4px 0}
/* 打卡格：22px + 11px 数字（可读性下限）；radius 6 为徽章级微元素例外档 */
.xy-dcell{width:22px;height:22px;border-radius:6px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;font-family:inherit;padding:0;border:none;cursor:default;font-variant-numeric:tabular-nums}
.xy-dcell-checked{background:rgba(56,217,169,.42);color:#0b3d26}
body[data-ds-dark-theme] .xy-dcell-checked{background:rgba(46,160,105,.32);color:#a7f3c9}
.xy-dcell-missed{background:transparent;border:1px dashed var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.xy-dcell-future{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}
/* 图例复用 xy-dot 时借格子的语义底色（同色系小尺寸） */
.xy-dot.xy-dcell-missed{background:transparent;border:1px dashed var(--dsw-alias-border-l3)}
.xy-dot.xy-dcell-future{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.xy-dot.xy-dcell-checked{background:rgba(56,217,169,.55)}
body[data-ds-dark-theme] .xy-dot.xy-dcell-checked{background:rgba(46,160,105,.45)}
.xy-detail-next{font-size:12px;color:var(--dsw-alias-label-secondary)}
.xy-detail-ops{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
/* 危险删除右置：与常规动作拉开距离，防误触邻接 */
.xy-detail-danger{margin-left:auto}

/* ===== 分类管理（T1-3）===== */
.xy-catpanel{margin-top:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.xy-catrow{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.xy-catrow:last-child{border-bottom:none}
.xy-catcount{margin-left:auto}
.xy-catops{display:flex;gap:6px}
.xy-swatchrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center}
/* 色板格：24px 命中目标 + hover 描边 + 主题令牌描边（深色下不再隐身） */
.xy-swatch{width:24px;height:24px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;padding:0;position:relative;transition:box-shadow .15s ease}
.xy-swatch:hover{box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--xyd-accent) 55%, transparent)}
.xy-swatch.xy-picked::after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;text-shadow:0 1px 2px rgba(0,0,0,.55)}
.xy-catloading{padding:6px 0}
.xy-rename{display:flex;gap:6px;align-items:center;margin-top:8px}

/* ===== 快速新建（T1-4）===== */
.xy-quick{margin-top:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--xyd-r-card);padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1)}
.xy-quick-row{display:flex;gap:10px;flex-wrap:wrap}
.xy-quick-field{display:flex;flex-direction:column;gap:4px;min-width:150px;flex:1}
.xy-quick-label{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}
.xy-quick-actions{display:flex;gap:10px;align-items:center}

/* ===== 滚动条槽位恒定（宽度防抖第二道保险）=====
 * 壳在输入框浮层模式下把滚动容器 gutter 放开为 auto，经典滚动条按需出现会抽走
 * ~15px 宽度（点「新建」展开表单即触发）。这里按 CSS Modules「哈希前缀_语义后缀」
 * 的稳定命名惯例匹配壳滚动容器，浮层模式也强制常驻槽位；与 useStableScrollbar
 * 运行时钉住互为冗余。 */
[class*='_scrollBody']:has([data-conversation-composer-overlay]){scrollbar-gutter:stable!important}

/* 弱化动画偏好：尊重 prefers-reduced-motion（含开关滑块、hover 过渡、插画无动画、toast 进出场） */
@media (prefers-reduced-motion: reduce){
  .xy-skel,.xy-toast{animation:none}
  .xy-toast-out{transition:none}
  .xy-bar-fill,.xy-btn,.xy-toggle,.xy-toggle::after,.xy-rowitem,.xy-wishcard,.xy-cell,.xy-growth-bar,.xy-seg-btn,.xy-input,.xy-swatch,.xy-grouprow{transition:none}
}
`
