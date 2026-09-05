/**
 * 星愿 client 半侧全站样式。
 *
 * 分层契约：
 * - 结构色一律引用壳令牌 --dsw-alias-*（跟随壳深浅切换，body[data-ds-dark-theme]）；
 * - 品牌强调色用自管 --xyd-* 对（星愿蓝：浅 #1a6fe0 / 深 #60a5fa，前景对比 ≥4.5:1）；
 * - 分类徽章走 --cat-* HSL 变量（JS 供色相/饱和度，CSS 按主题供亮度，与 Web 分层同构）；
 * - 形状纪律四档圆角：卡片 12 / 内嵌块 9 / 控件 8 / 胶囊 999（6px 仅限徽章级微元素）；
 * - 动效刻度：交互 150ms ease-out，进度条 350ms cubic-bezier(.22,1,.36,1)，
 *   prefers-reduced-motion 下全部关闭；过渡只用 transform/opacity（合成器），
 *   纯装饰性 hover 一律门控在 (hover:hover) and (pointer:fine) 内（触屏不粘滞）。
 *
 * 兼容性铁律：**禁用 color-mix() 等新式取色函数**。用户的 dsh 壳里存在不支持
 * color-mix() 的浏览器，凡用它的属性在该环境下按无效处理（装饰线稿曾因此整体
 * 隐形）。半透明衍生色一律在下方令牌区按主题写显式 rgba——并且**只允许出现在
 * 令牌区**（：root 与深色覆盖块，即「会话卡片」分段注释之前），正文区一律引用
 * 令牌；该约束由 test/style-contract.test.ts 机械锁定（含 gen-mock 产物）。
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
  /* 彩底小圆标的前景对：按主题配对保证 ≥4.5:1（深色亮底配深字） */
  --xyd-on-ok:#ffffff;
  --xyd-on-danger:#ffffff;
  /* 次要文字在次级面板底（layer-2）上的专用对：壳通用次要色对 layer-2 只有
   * ≈4.3:1，本对按 5.0+:1 校准（预览条/组计数/等级编号/未来格/成长轴刻度） */
  --xyd-label-on-2:#5d6a7d;
  /* 半透明衍生色（禁 color-mix，按主题显式 rgba）：强调描边 / 强调悬停环 /
     危险描边 / 危险悬停底 / 中性行悬停底 / 斜纹纹理与弱化底 */
  --xyd-accent-border:rgba(26,111,224,.38);
  --xyd-accent-ring:rgba(26,111,224,.72);
  --xyd-accent-ring-soft:rgba(26,111,224,.55);
  --xyd-danger-border:rgba(192,57,43,.4);
  --xyd-danger-soft:rgba(192,57,43,.09);
  --xyd-hover:rgba(15,23,42,.05);
  --xyd-hatch:rgba(100,116,139,.36);
  --xyd-hatch-faint:rgba(100,116,139,.14);
  /* 成功/警示语义柔和底与描边对（打卡卡/微行动卡/成功横幅/图表徽章）：
   * 此前单值透明度两主题共用，深色下 .08 绿洗几乎不可见 */
  --xyd-ok-soft:rgba(56,217,169,.09);
  --xyd-ok-border:rgba(56,217,169,.4);
  --xyd-ok-badge:rgba(56,217,169,.18);
  --xyd-warn-soft:rgba(255,169,77,.2);
  --xyd-warn-border:rgba(255,169,77,.4);
  /* 日历状态底（部分/全部完成）与打卡记录格（已打卡）的成对底色 */
  --xyd-c2-soft:rgba(255,169,77,.32);
  --xyd-c3-soft:rgba(16,185,129,.22);
  --xyd-c3-soft-dot:rgba(16,185,129,.30);
  --xyd-dcell-checked:rgba(56,217,169,.42);
  --xyd-dcell-checked-dot:rgba(56,217,169,.55);
  /* 上述成对底色的前景伙伴（同使用点收进令牌区，漂移即红） */
  --xyd-on-c2:#7c4a03;
  --xyd-on-c3:#065f46;
  --xyd-on-dcell:#0b3d26;
  /* 阴影对（卡片悬停/toast/弹窗/英雄卡）：深浅各自配档，禁止正文区裸写 rgba */
  --xyd-shadow-card:0 2px 10px rgba(15,23,42,.07);
  --xyd-shadow-toast:0 8px 24px -8px rgba(15,23,42,.2),0 2px 8px -2px rgba(15,23,42,.1);
  --xyd-shadow-modal:0 24px 48px -16px rgba(15,23,42,.35),0 4px 12px -4px rgba(15,23,42,.2);
  --xyd-shadow-hero:0 2px 10px rgba(30,25,60,.16);
  --xyd-hero-border:rgba(255,255,255,.16);
  --xyd-on-hero:rgba(255,255,255,.92);
  --xyd-bar-on-hero:rgba(255,255,255,.28);
  --xyd-swatch-ring:rgba(255,255,255,.85);
  --xyd-swatch-glyph-shadow:0 0 2px rgba(0,0,0,.85),0 1px 3px rgba(0,0,0,.6);
  --xyd-herobadge-glyph-shadow:0 1px 2px rgba(0,0,0,.18);
  /* 壳遮罩令牌缺席时的兜底（不再在规则行内裸写 rgba 兜底值） */
  --xyd-mask:rgba(15,23,42,.45);
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
  --xyd-on-ok:#052e21;
  --xyd-on-danger:#3f1008;
  --xyd-label-on-2:#9aa6b7;
  --xyd-accent-border:rgba(96,165,250,.38);
  --xyd-accent-ring:rgba(96,165,250,.72);
  --xyd-accent-ring-soft:rgba(96,165,250,.55);
  --xyd-danger-border:rgba(255,155,143,.4);
  --xyd-danger-soft:rgba(255,155,143,.12);
  --xyd-hover:rgba(148,163,184,.1);
  --xyd-hatch:rgba(139,152,171,.4);
  --xyd-hatch-faint:rgba(139,152,171,.16);
  --xyd-ok-soft:rgba(52,211,153,.14);
  --xyd-ok-border:rgba(52,211,153,.55);
  --xyd-ok-badge:rgba(52,211,153,.22);
  --xyd-warn-soft:rgba(255,169,77,.26);
  --xyd-warn-border:rgba(255,169,77,.5);
  --xyd-c2-soft:rgba(255,169,77,.24);
  --xyd-c3-soft:rgba(52,211,153,.22);
  --xyd-c3-soft-dot:rgba(52,211,153,.30);
  --xyd-dcell-checked:rgba(46,160,105,.32);
  --xyd-dcell-checked-dot:rgba(46,160,105,.45);
  --xyd-on-c2:#ffd9a8;
  --xyd-on-c3:#a7f3c9;
  --xyd-on-dcell:#a7f3c9;
  --xyd-shadow-card:0 2px 10px rgba(0,0,0,.32);
  --xyd-shadow-toast:0 8px 24px -8px rgba(0,0,0,.5),0 2px 8px -2px rgba(0,0,0,.35);
  --xyd-shadow-modal:0 24px 48px -16px rgba(0,0,0,.55),0 4px 12px -4px rgba(0,0,0,.4);
  --xyd-shadow-hero:0 2px 10px rgba(0,0,0,.4);
  --xyd-hero-border:rgba(255,255,255,.16);
  --xyd-on-hero:rgba(255,255,255,.92);
  --xyd-bar-on-hero:rgba(255,255,255,.28);
  --xyd-swatch-ring:rgba(255,255,255,.85);
  --xyd-swatch-glyph-shadow:0 0 2px rgba(0,0,0,.85),0 1px 3px rgba(0,0,0,.6);
  --xyd-herobadge-glyph-shadow:0 1px 2px rgba(0,0,0,.18);
  --xyd-mask:rgba(0,0,0,.5);
}

.xy-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ===== 会话卡片 ===== */
.xy-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);padding:11px 14px;margin:6px 0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:14px}
.xy-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* 长内容纪律：徽章不收缩；标题允许断行收缩——杜绝长英文词横向溢出与整行抖动 */
.xy-badge{flex:none;font-size:12px;border-radius:6px;padding:1px 7px;color:var(--dsw-alias-label-primary)}
/* 分类徽章：HSL 变量供色，亮度按主题分层（对齐 Web wish-category 的 .dark 覆盖口径） */
.xy-badge-cat{background:hsl(var(--cat-h,275) calc(var(--cat-sbg,58)*1%) 92%);color:hsl(var(--cat-h,275) calc(var(--cat-sfg,46)*1%) 30%);border:1px solid hsl(var(--cat-h,275) calc(var(--cat-sbd,46)*1%) 55% / .12)}
body[data-ds-dark-theme] .xy-badge-cat{background:hsl(var(--cat-h,275) calc(var(--cat-sbg,58)*1%) 22%);color:hsl(var(--cat-h,275) calc(var(--cat-sfg,46)*1%) 80%);border-color:hsl(var(--cat-h,275) calc(var(--cat-sbd,46)*1%) 70% / .2)}
.xy-badge-task{background:var(--xyd-accent-soft)}
.xy-badge-chart{background:var(--xyd-ok-badge)}
.xy-badge-micro{background:var(--xyd-warn-soft)}
.xy-title{min-width:0;font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.xy-deleted{opacity:.65}
.xy-deleted .xy-title{text-decoration:line-through}
.xy-meta{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:4px;overflow-wrap:anywhere}
/* 次级面板底上的次要文字用专用对（壳通用次要色对 layer-2 仅 ≈4.3:1，双主题同病） */
.xy-preview{margin-top:6px;font-size:12px;color:var(--xyd-label-on-2);background:var(--dsw-alias-bg-layer-2);border-radius:var(--xyd-r-inner);padding:6px 8px}
.xy-checkin{border-color:var(--xyd-ok-border);background:var(--xyd-ok-soft)}
.xy-glyph{font-size:15px;font-weight:700;line-height:1}
.xy-glyph-ok{color:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-glyph-back{color:var(--dsw-alias-label-secondary)}
.xy-actioned{margin-left:auto;color:var(--dsw-alias-state-success-primary,var(--xyd-ok))}

/* 微行动卡 */
.xy-micro{border-color:var(--xyd-warn-border)}
.xy-microsteps{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.xy-microstep{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-inner);background:var(--dsw-alias-bg-layer-2)}
.xy-microstep.xy-done .xy-microsteptext{text-decoration:line-through}
/* 完成/跳过步的文字降权走次要色而非整行 opacity（对比度依据同上 .xy-done 注） */
.xy-microstep.xy-done .xy-microsteptext,.xy-microstep.xy-skipped .xy-microsteptext{color:var(--dsw-alias-label-secondary)}
.xy-microstepnum{flex:none;width:20px;height:20px;border-radius:50%;background:var(--xyd-accent);color:var(--xyd-on-accent);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin-top:1px}
.xy-microsteptext{font-size:13px;display:flex;flex-direction:column;min-width:0}
/* 卡内步骤说明/状态词的背景是 layer-2：次要文字用 label-on-2 专用对（壳通用
   * 次要色对 layer-2 仅 ≈4.3:1，双主题同病——与 xy-preview 同一治理线） */
.xy-microstep .xy-meta{color:var(--xyd-label-on-2)}
.xy-microstate{margin-left:auto;flex:none}

/* 图表卡 */
.xy-chart{background:var(--dsw-alias-bg-layer-1)}
.xy-chart-legend{display:flex;gap:12px;margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary);align-items:center}
.xy-arcwrap{margin-top:8px}
.xy-arcnum{font-size:22px;font-weight:700;color:var(--xyd-accent);font-variant-numeric:tabular-nums}
.xy-bar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);margin-top:6px;overflow:hidden}
/* 填充走 scaleX（合成器动画）：width 过渡会逐帧触发布局，transform 只进合成器 */
.xy-bar-fill{height:100%;border-radius:inherit;background:var(--xyd-accent);transform-origin:0 50%;transition:transform .35s cubic-bezier(.22,1,.36,1)}
.xy-rows{list-style:none;margin-top:6px;display:flex;flex-direction:column;gap:4px;padding:0}
.xy-row{display:flex;justify-content:space-between;font-size:13px}
.xy-rowval{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.xy-heat{display:grid;grid-template-columns:repeat(auto-fill,minmax(14px,1fr));gap:2px;margin-top:8px}
.xy-heatcell{aspect-ratio:1;border-radius:3px;background:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-svg{width:100%;height:auto;margin-top:6px}

/* ===== Toast 轻提示 ===== */
.xy-toasts{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:9999;pointer-events:none;max-width:min(92vw,460px)}
.xy-toast{pointer-events:auto;display:flex;align-items:center;gap:9px;padding:9px 14px;border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:var(--xyd-shadow-toast);animation:xy-toast-in .24s cubic-bezier(.22,1,.36,1);cursor:pointer}
.xy-toast-out{opacity:0;transform:translateY(-6px);transition:opacity .22s ease,transform .22s ease}
@keyframes xy-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.xy-toast-glyph{flex:none;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.xy-toast-ok .xy-toast-glyph{background:var(--dsw-alias-state-success-primary,var(--xyd-ok));color:var(--xyd-on-ok)}
.xy-toast-info .xy-toast-glyph{background:var(--xyd-accent);color:var(--xyd-on-accent)}
.xy-toast-error .xy-toast-glyph{background:var(--xyd-danger-bg);color:var(--xyd-on-danger)}
.xy-toast-text{min-width:0;overflow-wrap:anywhere}

/* ===== 应用内确认弹窗 =====
 * 原生 window.confirm 的替代：遮罩 + 面板卡，全部走主题令牌（深浅色自适应）。
 * 动效只用 opacity/transform；z-index 压过 toast 层，避免轻提示浮在弹窗之上。 */
.xy-modal-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--dsw-alias-bg-mask-1,var(--xyd-mask));animation:xy-fade-in .16s ease-out}
.xy-modal-backdrop.xy-modal-out{opacity:0;transition:opacity .15s ease}
.xy-modal{width:min(400px,100%);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);border-radius:var(--xyd-r-card);padding:16px 18px;box-shadow:var(--xyd-shadow-modal);animation:xy-pop-in .18s cubic-bezier(.22,1,.36,1)}
.xy-modal-out .xy-modal{transform:scale(.98);transition:transform .15s ease}
.xy-modal-msg{margin:0;font-size:14px;line-height:1.65;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;max-height:min(56vh,440px);overflow-y:auto}
.xy-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
@keyframes xy-fade-in{from{opacity:0}to{opacity:1}}
@keyframes xy-pop-in{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
/* 实心危险确认键（删除类动作专用）：与描边危险键区分「已确认将执行」的重量 */
.xy-btn-danger-solid{background:var(--xyd-danger-bg);border-color:transparent;color:var(--xyd-on-danger)}
@media (hover:hover) and (pointer:fine){
  .xy-btn-danger-solid:hover:not(:disabled){filter:brightness(1.08);color:var(--xyd-on-danger)}
}

/* ===== 骨架屏加载态 ===== */
.xy-skel{border-radius:var(--xyd-r-inner);background:linear-gradient(90deg,var(--dsw-alias-bg-layer-2) 25%,var(--dsw-alias-bg-layer-1) 45%,var(--dsw-alias-bg-layer-2) 65%);background-size:200% 100%;animation:xy-shimmer 1.4s ease infinite}
.xy-skel-title{height:22px;width:38%;margin-bottom:14px}
.xy-skel-row{height:64px;margin-top:10px}
@keyframes xy-shimmer{from{background-position:180% 0}to{background-position:-20% 0}}

/* ===== 空态（纯文字版式，插画已移除：见 PageEmpty 注释）===== */
.xy-page-center{display:flex;flex-direction:column;align-items:center;gap:6px;padding:44px 0;text-align:center}
.xy-empty-title{font-weight:600;color:var(--dsw-alias-label-primary);margin-top:4px}
.xy-empty-hint{margin-top:2px;max-width:360px}

/* ===== 会话视图页骨架 ===== */
/* 节奏锁：页 padding 18/20 · 区块间 14（section-title 上边距）· 行间距 6/10 */
.xy-page{box-sizing:border-box;width:100%;max-width:min(780px,100%);min-width:0;margin:0 auto;padding:18px 20px 26px;color:var(--dsw-alias-label-primary);font-size:14px;overflow-x:clip}
.xy-page-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
/* 居中行内的 .xy-meta 关闭默认 4px 上边距：flex 按含 margin 的盒子居中，顶距会让
 * 次要文字恒定低 2px（与 .xy-detail>div>.xy-meta 同一条治理线，头部漏治点在此收口） */
.xy-card-head .xy-meta,.xy-page-head .xy-meta{margin-top:0}
.xy-page-title{font-size:17px;font-weight:700;margin:0;color:var(--dsw-alias-label-primary)}
.xy-section-title{font-size:12px;color:var(--dsw-alias-label-secondary);margin:14px 0 6px;font-weight:600;letter-spacing:.02em}
/* 页头动作组：单一 margin-left:auto 整体右置——多按钮各自 auto 会平分剩余空间 */
.xy-page-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap}

/* 控件体系 */
.xy-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:var(--xyd-r-ctl);padding:5px 12px;min-height:28px;font-size:13px;cursor:pointer;line-height:1.5;transition:border-color .15s ease,background-color .15s ease,color .15s ease,filter .15s ease,transform .12s ease}
/* 悬停反馈仅在「真悬停」设备生效：触屏没有可靠的 hover 退出，行/格/按钮的
 * 悬停底色会粘滞到下一次点按（hover 门控 = (hover:hover) and (pointer:fine)） */
@media (hover:hover) and (pointer:fine){
  .xy-btn:hover:not(:disabled){border-color:var(--xyd-accent);color:var(--xyd-accent-strong)}
}
.xy-btn:active:not(:disabled){transform:scale(.97)}
.xy-btn:disabled{opacity:.55;cursor:not-allowed}
.xy-btn:focus-visible,.xy-input:focus-visible,.xy-cell:focus-visible,.xy-seg-btn:focus-visible,.xy-toggle:focus-visible,.xy-swatch:focus-visible,.xy-growth-col:focus-visible,.xy-wishtoggle:focus-visible{outline:2px solid var(--xyd-accent);outline-offset:2px}
/* 触控基线：消除移动端双击缩放延迟与系统点按高亮（交互反馈统一由 hover/active 承担） */
.xy-btn,.xy-seg-btn,.xy-cell,.xy-swatch,.xy-toggle,.xy-growth-col,.xy-wishtoggle{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
/* 行内按钮：≥26px 命中目标（卡片头/操作行的紧凑主战按钮） */
.xy-btn-inline{margin-left:auto;padding:3px 10px;font-size:12px;min-height:26px;display:inline-flex;align-items:center}
/* 图标幽灵键（≥26px 方形命中目标）：编辑/删除这类高频重复的行内低频动作降噪——
 * 图标线稿承许可义、文字语义走 aria-label；hover/focus 才显底色。 */
.xy-btn-icon{width:26px;height:26px;min-height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:none}
.xy-btn-primary{background:var(--xyd-accent);border-color:transparent;color:var(--xyd-on-accent)}
@media (hover:hover) and (pointer:fine){
  .xy-btn-primary:hover:not(:disabled){filter:brightness(1.06);color:var(--xyd-on-accent)}
}
.xy-btn-danger{color:var(--xyd-danger);border-color:var(--xyd-danger-border);background:transparent}
@media (hover:hover) and (pointer:fine){
  .xy-btn-danger:hover:not(:disabled){background:var(--xyd-danger-soft);color:var(--xyd-danger)}
}
.xy-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:var(--xyd-r-ctl);padding:5px 8px;font-size:13px;font-family:inherit;transition:border-color .15s ease}
@media (hover:hover) and (pointer:fine){
  .xy-input:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}
}
.xy-input::placeholder{color:var(--dsw-alias-label-secondary)}
.xy-input:disabled{opacity:.55;cursor:not-allowed}
.xy-field-err{color:var(--xyd-danger);font-size:12px;margin-top:4px}
/* 数字微输入（设置页注入上限等）：按内容长度定宽，不随浏览器默认 size 拉成宽条 */
.xy-input-num{width:96px}

/* 列表行 */
.xy-rowmain{display:flex;flex-direction:column;gap:2px;min-width:0}
.xy-rowtitle{font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
/* 完成态行首装饰勾（aria-hidden，语义由行文案承担） */
.xy-done-glyph{color:var(--dsw-alias-state-success-primary,var(--xyd-ok));margin-right:2px}
/* 高重要度星标：琥珀警示色（不复用完成勾的绿色，语义不撞车） */
.xy-star-hi{color:var(--xyd-warn);margin-right:2px}
/* 完成态行：标题用次要色降权（secondary 实测浅 4.76 / 深 5.15 ≥4.5:1）——不用整行
 * opacity：0.78 混底后文字有效对比仅 ≈3.1:1，跌破 WCAG 1.4.3 AA（opacity 只留给
 * aria-hidden 的装饰元素，行内可读文字一律走颜色降权） */
.xy-done .xy-rowtitle{color:var(--dsw-alias-label-secondary)}
.xy-banner-ok{margin-top:10px;padding:10px 12px;border-radius:var(--xyd-r-inner);background:var(--xyd-ok-soft);border:1px solid var(--xyd-ok-border);font-size:13px}
/* 刷新失败但旧数据仍在的诚实降级横幅：琥珀虚线面板（警示但不恐吓——动作已成功） */
.xy-stalerow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding:8px 12px;border:1px dashed var(--xyd-warn-border);border-radius:var(--xyd-r-inner);background:var(--xyd-warn-soft)}
.xy-stalerow .xy-btn-inline{margin-left:0}

/* ===== 分组卡（任务页状态分桶 / 今日页待打卡·已完成共用）=====
 * 卡片容器 + 状态点标题行 + 分隔线行列表：替代裸堆叠的 section-title+wishtasks；
 * 组间距 12 与页头 margin-bottom 12 同拍，行内边距 11/14 对齐卡片体系节奏锁。 */
.xy-group{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.xy-group-head{display:flex;align-items:center;gap:8px;margin:0;padding:9px 14px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.xy-group-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.xy-group-dot-accent{background:var(--xyd-accent)}
.xy-group-dot-warn{background:var(--xyd-warn)}
.xy-group-dot-ok{background:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-group-count{margin-left:auto;flex:none;font-size:12px;line-height:1.7;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--xyd-label-on-2);font-variant-numeric:tabular-nums}
.xy-grouplist{list-style:none;display:flex;flex-direction:column;margin:0;padding:0}
.xy-grouprow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid var(--dsw-alias-border-l1);transition:background-color .15s ease}
.xy-grouprow:first-child{border-top:none}
@media (hover:hover) and (pointer:fine){
  .xy-grouprow:hover{background:var(--xyd-hover)}
}
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
/* 完成计数是今日页的视觉锚点（habit 类 App 头部惯例）：升大号 tabular 数字 */
.xy-todayhero-num{margin-left:auto;font-size:22px;font-weight:700;color:var(--xyd-accent);font-variant-numeric:tabular-nums;line-height:1.2}
.xy-todayhero-all .xy-todayhero-num{color:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
.xy-todayhero .xy-bar{height:10px;margin-top:0}
.xy-todayhero .xy-banner-ok{margin-top:0}

/* 愿望卡（页面） */
.xy-wishcard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:var(--xyd-r-card);padding:12px 14px;margin-top:10px;transition:border-color .15s ease,box-shadow .15s ease}
@media (hover:hover) and (pointer:fine){
  .xy-wishcard:hover{border-color:var(--dsw-alias-border-l2);box-shadow:var(--xyd-shadow-card)}
}
.xy-progress-num{margin-left:auto;flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
/* 任务区披露开关（默认收起，展开集合走 view-state）：整行按钮继承虚线分隔（原属
 * .xy-wishtasks 的卡内分界），箭头旋转只动 transform；按钮文本含任务数（口语化，无状态词）。 */
.xy-wishtoggle{margin-top:8px;display:flex;align-items:center;gap:5px;width:100%;padding:8px 0 5px;background:none;border:0;border-top:1px dashed var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;text-align:left}
@media (hover:hover) and (pointer:fine){
  .xy-wishtoggle:hover{color:var(--dsw-alias-label-primary)}
}
.xy-wishtoggle svg{flex:none;transition:transform .15s ease}
.xy-wishtoggle[aria-expanded='true'] svg{transform:rotate(180deg)}
/* 卡内子任务列表：分隔线已上移到披露开关，行留白由任务行自身 padding 承担。
 * 结构为 [taskline, detail?, taskline, detail?] —— 相邻选择器精确命中「新任务行」边界。 */
.xy-wishtasks{display:flex;flex-direction:column}
.xy-wishtasks>.xy-taskline+.xy-taskline,.xy-wishtasks>.xy-detail+.xy-taskline{border-top:1px solid var(--dsw-alias-border-l1)}
.xy-wishtasks>.xy-taskline{padding:9px 0}
/* 展开详情是卡内最后一个元素时收掉底部留白：卡片自身 padding 已承担收尾 */
.xy-wishtasks>.xy-detail:last-child{margin-bottom:0}
/* TaskLine 基类 = 两栏网格：名称/元信息居左收缩换行，动作簇（领取/打卡 + 详情开关）右置垂直居中；
 * 愿望卡子任务与任务页共用同一行语法。 */
.xy-taskline{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;row-gap:2px;align-items:center}
.xy-taskname{grid-column:1;grid-row:1;font-weight:600;font-size:13px;overflow-wrap:anywhere}
.xy-taskline>.xy-meta{grid-column:1;grid-row:2;margin-top:0}
.xy-taskline>div:last-child{grid-column:2;grid-row:1/span 2;justify-self:end}
/* 危险图标键统一静默档（长列表逐行重复的低频高危动作：愿望卡头删除 / 记忆行删除）：
 * 基础透明度 0.78——混底后图标描边对比浅色 3.73 / 深色 5.06，满足 WCAG 1.4.11
 * 非文字 ≥3:1（原注「≥4.5:1」仅深色成立，已按非文字口径更正），hover/focus 恢复
 * 满强度；文字危险键（.xy-btn-danger 无 .xy-btn-icon）保持满强度不受此档。 */
.xy-btn-danger.xy-btn-icon{opacity:.78}
.xy-btn-danger.xy-btn-icon:focus-visible{opacity:1}
@media (hover:hover) and (pointer:fine){
  .xy-btn-danger.xy-btn-icon:hover:not(:disabled){opacity:1}
}

/* ===== 日历 ===== */
/* 现代日历语法（Apple/Google Calendar 惯例）：无边框连续网格，日期号坐在圆章上，
 * 状态语义全部由圆章承载（待打卡=中性计划底、部分完成=琥珀、全部完成=绿），
 * today/picked 走圆章的环与实底，不再整格刷色/整格描边。
 * 邻月补位日 = 低透明度数字（纯视觉延续，切月残行不碎片化）。 */
.xy-calcard{padding:0;overflow:hidden}
/* 月份导航成组居中；「回到本月」绝对定位贴右缘，不挤占中轴（窄屏改随流避免相撞） */
.xy-calnav{position:relative;justify-content:center}
.xy-calnav-back{position:absolute;right:0}
@media (max-width:520px){.xy-calnav-back{position:static;margin-left:4px}}
.xy-calhead{display:grid;grid-template-columns:repeat(7,1fr);padding:11px 0 8px}
.xy-calhead-cell{text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.xy-cal{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l1)}
.xy-week{display:grid;grid-template-columns:repeat(7,1fr)}
.xy-cell{height:42px;border:none;background:transparent;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;padding:0;font-family:inherit;color:var(--dsw-alias-label-primary)}
/* 圆章：32px 圆形，状态底色/环/实底都挂这里 */
.xy-daynum{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-variant-numeric:tabular-nums;transition:background-color .15s ease,box-shadow .15s ease,color .15s ease}
.xy-cell:focus-visible{outline-offset:-3px}
/* 邻月补位日：弱化数字（不可聚焦不可点）。opacity .45 在浅色下仅 1.8:1，
 * 提到 .55 保持「低一档」的视觉次序同时不再近乎隐形 */
.xy-outside{cursor:default}
.xy-outside .xy-daynum{color:var(--dsw-alias-label-secondary);opacity:.55}
/* 无安排 = 留白 + 次要字 */
.xy-c0{cursor:default}
.xy-c0 .xy-daynum{color:var(--dsw-alias-label-secondary)}
/* 待打卡 = 中性计划底（高频状态不作警示色）；inset 描边让 c1 圆章与图例点同构
 * （c1 底色对卡底仅 ≈1.1:1，图例点有描边而圆章没有——两侧观感不一致） */
.xy-c1 .xy-daynum{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
/* 部分完成 / 全部完成 = 柔和语义底，字色按主题配对保证 ≥4.5:1 */
.xy-c2 .xy-daynum{background:var(--xyd-c2-soft);color:var(--xyd-on-c2)}
.xy-c3 .xy-daynum{background:var(--xyd-c3-soft);color:var(--xyd-on-c3)}
body[data-ds-dark-theme] .xy-c2 .xy-daynum{color:var(--xyd-on-c2)}
body[data-ds-dark-theme] .xy-c3 .xy-daynum{color:var(--xyd-on-c3)}
/* hover 晕底排除已选中格与语义状态格：specificity 高于单类选择器，不排除的话
 * 悬停在已选日上会用晕底盖掉选中实底（视觉上「取消选中」）；c2/c3 同理——
 * 状态底色正是用户悬停核对的那个信息，不能在悬停瞬间被晕底抹掉 */
@media (hover:hover) and (pointer:fine){
  .xy-cell:not(.xy-outside):not(.xy-picked):not(.xy-c2):not(.xy-c3):hover .xy-daynum{background:var(--xyd-accent-soft)}
}
/* 今日 = accent 环包圆章：不覆盖状态底色（「今天该打卡」的提示不能被吃掉） */
.xy-today .xy-daynum{box-shadow:0 0 0 2px var(--xyd-accent)}
/* 选中 = accent 实底圆章（即时反馈短暂态，覆盖状态色可接受，详情面板紧随其下） */
.xy-picked .xy-daynum{background:var(--xyd-accent);color:var(--xyd-on-accent)}
.xy-legend{display:flex;gap:14px;margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary);align-items:center;flex-wrap:wrap}
.xy-dot{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:4px;vertical-align:-1px}
.xy-dot.xy-dot-checked{background:var(--xyd-accent)}
/* 图例缺口点：与柱体同一斜纹语法（单一事实源，两处永不漂移） */
.xy-dot.xy-dot-gap{border:1px solid var(--dsw-alias-border-l2);background:repeating-linear-gradient(135deg,var(--xyd-hatch) 0 2px,transparent 2px 4px)}
/* 图例与圆章同构：无安排=描边空心、待打卡=中性底、部分/全部完成=语义柔和底 */
.xy-dot.xy-c0{background:transparent;border:1px solid var(--dsw-alias-border-l2)}
.xy-dot.xy-c1{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2)}
.xy-dot.xy-c2{background:var(--xyd-c2-soft)}
.xy-dot.xy-c3{background:var(--xyd-c3-soft-dot)}
/* 卡即表后：图例贴卡底并以 hairline 与网格分界 */
.xy-calcard .xy-legend{margin-top:0;padding:10px 14px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
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
/* 层级：普通统计数字用主文字色（页面更安静），仅「当前连续」这张卡以品牌色+浅晕底突出
 * （habit 类 App 把 streak 作为英雄指标置于热力图旁的惯例） */
.xy-statnum{font-size:24px;font-weight:700;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.xy-statcard-hot{border-color:var(--xyd-accent-border);background:linear-gradient(160deg,var(--xyd-accent-soft),transparent 62%),var(--dsw-alias-bg-layer-1)}
.xy-statcard-hot .xy-statnum{color:var(--xyd-accent)}
/* 缺省值（暂无/N/A）：次要色小一号，缺失信息不得比真实数据更响 */
.xy-statcard-muted .xy-statnum{color:var(--dsw-alias-label-secondary);font-size:18px}
/* 窄面板（会话视图页随壳收缩）下 30 根柱被 flex 挤压到 ~10px 宽，触屏难以命中：
 * 容器横向滚动 + 最小宽兜底（≤520px 与日历断点同口径）把柱宽抬到 ~13px——
 * 是命中体验的改善但未达 WCAG 2.5.8 的 24px（达标需 min-width ~810px，滚动成本
 * 远超误触代价，图表 tooltip 属低风险信息查询，有意取舍）；宽面板（独立
 * /xingyuan/growth 页）内容不超宽、滚动容器无感知 */
.xy-growth-scroll{overflow-x:auto}
.xy-growth{display:flex;gap:3px;align-items:stretch;height:120px;margin-top:10px}
.xy-growth-col{flex:1;display:flex;flex-direction:column;height:100%;min-width:0;border:none;background:transparent;padding:0;cursor:default;border-radius:3px 3px 0 0}
.xy-growth-stack{flex:1;display:flex;flex-direction:column;justify-content:flex-end;width:100%}
.xy-growth-bar{background:var(--xyd-accent);border-radius:2px 2px 0 0;width:100%}
.xy-growth-col.xy-full .xy-growth-bar{background:var(--dsw-alias-state-success-primary,var(--xyd-ok))}
/* 未完成缺口：斜纹冗余编码（跟随主题文字色混合）——layer-2 实色在深色壳与面板底
 * 几乎同亮度而隐形，斜纹在两种主题下都有稳定的纹理可见度，且与实心完成柱形成
 * 「形状 × 颜色」双通道区分，不依赖色觉单通道 */
.xy-growth-missed{width:100%;border-radius:2px 2px 0 0;background:repeating-linear-gradient(135deg,var(--xyd-hatch) 0 2px,transparent 2px 5px),var(--xyd-hatch-faint)}
button.xy-growth-col{cursor:pointer}
button.xy-growth-col.xy-hover{box-shadow:inset 0 0 0 2px var(--xyd-accent-ring)}
@media (hover:hover) and (pointer:fine){
  button.xy-growth-col:hover{box-shadow:inset 0 0 0 2px var(--xyd-accent-ring)}
}
@media (max-width:520px){
  .xy-growth-scroll .xy-growth,.xy-growth-scroll .xy-growth-axis{min-width:480px}
}
/* 基线贴柱底（与聊天图表卡的 SVG 基线同一语法），刻度层下移让出线的位置 */
.xy-growth-axis{position:relative;height:20px;margin-top:0;border-top:1px solid var(--dsw-alias-border-l2)}
.xy-growth-tick{position:absolute;top:4px;font-size:12px;line-height:16px;color:var(--xyd-label-on-2);white-space:nowrap;font-variant-numeric:tabular-nums}
/* 成长页悬浮明细 */
.xy-tip{position:relative;margin-top:0;min-height:20px;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-inner);padding:3px 10px;display:inline-block;font-variant-numeric:tabular-nums}
.xy-tip:empty{visibility:hidden}
/* 图表加载占位：与成品图等高，数据到达不引起下方内容位移 */
.xy-chartload{height:150px;margin-top:8px}

/* ===== 成长页：等级英雄卡 + 等级说明 ===== */
/* 渐变两端均为实色（深档→基档，growth.ts 内联 darkenHex 预混），白字对底色 ≥4.5:1
 * 在浅色壳下同样成立——半透明渐变混入页面白底后右端会跌破 3:1，已弃用。 */
.xy-hero{display:flex;gap:14px;align-items:center;border-radius:var(--xyd-r-card);padding:18px;margin-top:12px;border:1px solid var(--xyd-hero-border);box-shadow:var(--xyd-shadow-hero)}
.xy-herobadge{width:54px;height:54px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px;flex:none;text-shadow:var(--xyd-herobadge-glyph-shadow)}
.xy-heromain{flex:1;min-width:0}
.xy-onhero{color:var(--xyd-on-hero)!important}
.xy-herotitle{font-size:19px;font-weight:700;margin:3px 0 8px;color:#fff}
.xy-bar-onhero{background:var(--xyd-bar-on-hero)}
.xy-bar-fill-solid{background:#fff}
.xy-heroreward{margin-top:8px}
.xy-levels{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);padding:4px 14px}
/* 等级行的「未达成」降权走文字色而非整行 opacity（0.68 混底后 label-on-2/secondary
 * 均跌破 AA，最低 ≈2.6:1）：名称/奖励用 secondary（≥4.5:1），徽章本就是中性底 +
 * label-on-2（校准 5.0:1）；命中行恢复主文字色 + 彩色徽章，层级感不靠透明度 */
.xy-levelrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:13px}
.xy-levelrow:last-child{border-bottom:none}
.xy-levelrow .xy-lvname{color:var(--dsw-alias-label-secondary)}
.xy-levelhit .xy-lvname{color:var(--dsw-alias-label-primary)}
.xy-lvnum{width:42px;height:24px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--xyd-label-on-2);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:none}
.xy-lvname{font-weight:600;width:64px;color:var(--dsw-alias-label-primary)}
.xy-lvreward{margin-left:auto;text-align:right}

/* ===== 记忆页 ===== */
/* 添加/编辑记忆表单：虚线面板卡（与快速新建同一「可书写」语法） */
.xy-compose{margin-top:12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;gap:8px;flex-wrap:wrap}
.xy-compose .xy-input-grow{flex:1 1 170px;width:auto;min-width:140px}
.xy-compose select.xy-input{width:auto}
.xy-editing{display:flex;align-items:center;gap:10px;margin-top:12px;padding:7px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--xyd-r-inner)}
.xy-memactions{display:flex;gap:6px;flex:none}
.xy-membar{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}
.xy-membar .xy-input-search{width:min(250px,100%)}
.xy-memcap{margin-top:6px}
/* 超长记忆值 3 行截断（≤1000 字符记录不再撑出数屏高行；完整值在删除确认弹窗可见） */
.xy-memval{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
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
.xy-seg-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:999px;padding:5px 14px;font-size:13px;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,color .15s ease}
@media (hover:hover) and (pointer:fine){
  .xy-seg-btn:hover{border-color:var(--xyd-accent)}
}
/* 选中态双选择器：类名与 aria-pressed 属性等价（组件侧用属性表达状态语义） */
.xy-seg-btn.xy-on,.xy-seg-btn[aria-pressed='true']{background:var(--xyd-accent);border-color:transparent;color:var(--xyd-on-accent)}
.xy-save-row{display:flex;align-items:center;gap:10px;margin-top:2px}
.xy-toggle{width:38px;height:22px;appearance:none;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);position:relative;cursor:pointer;transition:background .15s}
.xy-toggle:checked{background:var(--xyd-accent);border-color:transparent}
.xy-toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .15s}
.xy-toggle:checked::after{transform:translateX(16px);background:var(--xyd-on-accent)}
.xy-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}

/* ===== 详情聚合视图 ===== */
/* 段间 10px 呼吸；每段内部「标签 → 内容」固定 5px 纵向节奏（label 不再与内容文字挤行）。
 * 底部留 8px：操作按钮与下一条任务的分割线不得贴死（愿望卡里分割线直接压在详情下缘），
 * 任务页由 xy-taskrow 覆盖为 2px（分组卡行自带 11px 内边距，总量已够）。 */
.xy-detail{margin-top:8px;margin-bottom:8px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:10px;display:flex;flex-direction:column;gap:10px}
.xy-detail>div{display:flex;flex-direction:column;gap:5px;align-items:flex-start;min-width:0}
.xy-detail>div>.xy-meta{margin-top:0}
.xy-detail-grid{display:grid;grid-template-columns:repeat(7,max-content);gap:4px;padding:2px 0}
/* 打卡格：22px + 11px 数字（可读性下限）；radius 6 为徽章级微元素例外档。
 * 网格按周对齐（周一始，与日历页表头同构）：连续性一眼可读（GitHub/Streaks 惯例），
 * 首行前置空位由 .xy-dcell-blank 占位。 */
.xy-dcell{width:22px;height:22px;border-radius:6px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;font-family:inherit;padding:0;border:none;cursor:default;font-variant-numeric:tabular-nums}
.xy-dcell-blank{visibility:hidden}
/* 今日格 = accent 环包底色：与日历页圆章的 today 环同一语法 */
.xy-dcell.xy-dcell-today{box-shadow:0 0 0 2px var(--xyd-accent)}
.xy-dcell-checked{background:var(--xyd-dcell-checked);color:var(--xyd-on-dcell)}
body[data-ds-dark-theme] .xy-dcell-checked{color:var(--xyd-on-dcell)}
.xy-dcell-missed{background:transparent;border:1px dashed var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.xy-dcell-future{background:var(--dsw-alias-bg-layer-2);color:var(--xyd-label-on-2);border:1px solid var(--dsw-alias-border-l1)}
/* 图例复用 xy-dot 时借格子的语义底色（同色系小尺寸） */
.xy-dot.xy-dcell-missed{background:transparent;border:1px dashed var(--dsw-alias-border-l3)}
.xy-dot.xy-dcell-future{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.xy-dot.xy-dcell-checked{background:var(--xyd-dcell-checked-dot)}
.xy-detail-next{font-size:12px;color:var(--dsw-alias-label-secondary)}
/* 操作行与全站按钮组同拍（gap 8）：删除在同一行流内靠 danger 描边区分，
 * 确认弹窗兜底防误触——不再 margin-left:auto 漂到卡缘（窄面板里是一段突兀空白，
 * 愿望卡里还会与卡头的愿望级删除同侧对齐造成语义混淆） */
.xy-detail-ops{display:flex;gap:8px;flex-wrap:wrap;align-items:center}

/* ===== 分类管理 ===== */
.xy-catpanel{margin-top:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--xyd-r-card);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.xy-catrow{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.xy-catrow:last-child{border-bottom:none}
.xy-catcount{margin-left:auto}
.xy-catops{display:flex;gap:6px}
.xy-swatchrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center}
/* 色板格：24px 命中目标 + hover 描边 + 主题令牌描边（深色下不再隐身） */
.xy-swatch{width:24px;height:24px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;padding:0;position:relative;transition:box-shadow .15s ease}
.xy-swatch:disabled{opacity:.55;cursor:not-allowed}
@media (hover:hover) and (pointer:fine){
  .xy-swatch:hover:not(:disabled){box-shadow:inset 0 0 0 2px var(--xyd-accent-ring-soft)}
}
/* 选中态双环（内白隙 + 外强调圈）：任何色相下都清晰可辨，不依赖对勾本身的对冲 */
.xy-swatch.xy-picked{box-shadow:inset 0 0 0 2px var(--xyd-swatch-ring),0 0 0 2px var(--xyd-accent)}
.xy-swatch.xy-picked::after{content:'✓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;text-shadow:var(--xyd-swatch-glyph-shadow)}
.xy-catloading{padding:6px 0}
/* 行内改名编辑器：输入在窄面板收缩（无 min-width:0 时 input 固有宽度会把
 * 保存/取消键挤出 320px 面板被 overflow-x:clip 无声裁掉） */
.xy-rename{display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap}
.xy-rename .xy-input{flex:1 1 120px;min-width:0;width:auto}

/* ===== 快速新建 ===== */
.xy-quick{margin-top:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--xyd-r-card);padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1)}
.xy-quick-row{display:flex;gap:10px;flex-wrap:wrap}
.xy-quick-field{display:flex;flex-direction:column;gap:4px;min-width:150px;flex:1}
.xy-quick-label{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}
.xy-quick-actions{display:flex;gap:10px;align-items:center}

/* ===== 滚动条槽位恒定（宽度防抖第二道保险）=====
 * 壳的会话滚动容器（CSS Modules「哈希前缀_语义后缀」稳定命名 + data-conversation-scroll
 * 标记）默认 gutter stable，但输入框浮层模式会主动放开为 auto——经典滚动条按需出现会抽走
 * ~15px 宽度（点「新建」展开表单、展开详情即触发），居中页面随之整帧左右弹跳。
 * 这里对滚动容器本身无条件强制常驻槽位；与 useStableScrollbar 的 useLayoutEffect
 * 运行时钉住互为冗余（样式先于首帧，运行时兜底壳侧节点替换）。 */
[class*='_scrollBody'][data-conversation-scroll]{scrollbar-gutter:stable!important}

/* 弱化动画偏好：尊重 prefers-reduced-motion（含开关滑块、hover 过渡、插画无动画、toast 进出场、确认弹窗） */
@media (prefers-reduced-motion: reduce){
  .xy-skel,.xy-toast,.xy-modal-backdrop,.xy-modal{animation:none}
  .xy-toast-out,.xy-modal-backdrop.xy-modal-out,.xy-modal-out .xy-modal{transition:none}
  .xy-bar-fill,.xy-btn,.xy-toggle,.xy-toggle::after,.xy-wishcard,.xy-cell,.xy-daynum,.xy-seg-btn,.xy-input,.xy-swatch,.xy-grouprow,.xy-wishtoggle svg{transition:none}
}
`
