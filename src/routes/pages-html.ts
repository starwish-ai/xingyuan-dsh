/**
 * /xingyuan/* 三张自包含备用页（today/calendar/growth）：零构建依赖的内联 HTML +
 * 原生 fetch + 双主题（prefers-color-scheme）。壳内六标签页是主入口；本文件是无
 * GUI 场景的 URL 直开兜底。文案维持中文单语（壳内已双语，此处跟随 navigator.language
 * 的双语化随 T1-5 备用页补齐一并处理）。
 */
import { gzipSync } from 'node:zlib'
import type { ServerResponse } from 'node:http'

/** 输出 gzip HTML（no-store；页面体量小、内容动态）。 */
export function html(res: ServerResponse, body: string): void {
  const gz = gzipSync(Buffer.from(body, 'utf8'))
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-encoding': 'gzip',
    'cache-control': 'no-store',
  })
  res.end(gz)
}

export function pageToday(res: ServerResponse): void {
  html(res, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>今日打卡 · 星愿</title>${STYLE}
</head><body><header><h1>⭐ 今日待办</h1><nav><a href="/xingyuan/growth">成长</a><a href="/xingyuan/calendar">日历</a></nav></header>
<main id="app"><p class="muted">加载中…</p></main>
<script>
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
async function act(btn,taskId,date){
  btn.disabled=true;
  try{ await post('/xingyuan/api/action/checkin',{taskId,date}); load(); }
  catch(e){ btn.disabled=false; alert(e.message); }
}
async function claim(btn,taskId){
  btn.disabled=true;
  try{ await post('/xingyuan/api/action/claim',{taskId}); load(); }
  catch(e){ btn.disabled=false; alert(e.message); }
}
async function load(){
  try{
  const r = await fetch('/xingyuan/api/overview'); if(!r.ok) throw new Error('HTTP '+r.status); const o = await r.json();
  const el = document.getElementById('app');
  if(!o.total){ el.innerHTML = '<p class="muted">今天没有安排打卡任务。</p>'; return }
  var CZ={once:'仅一次',daily:'每日',weekly:'每周',monthly:'每月'};
  el.innerHTML = '<p class="summary">今日打卡进度：<b>' + o.checked + '</b> / ' + o.total +
    (o.uncheckedCount===0 ? ' 🎉 全部完成' : '') + '</p>' +
    (o.uncheckedCount===0 ? '' :
    '<ul class="list">' + o.unchecked.map(t =>
      '<li><div class="t">' + esc(t.name) + '</div><div class="m muted">' + esc(CZ[t.cycle]||t.cycle||'') + (t.wishName? ' · '+esc(t.wishName):'') +
      (t.status==='pending' ? ' · 待领取' : '') + '</div>' +
      (t.status==='pending'
        ? '<button onclick="claim(this,\\''+t.taskId+'\\')">领取任务</button>'
        : '<button onclick="act(this,\\''+t.taskId+'\\')">✓ 打卡</button>') +
      '</li>'
    ).join('') + '</ul>');
  }catch(e){ document.getElementById('app').innerHTML = '<p class="muted">加载失败：'+esc(e instanceof Error ? e.message : e)+'（<button class="linkbtn" onclick="location.reload()">重试</button>）</p>'; }
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
load()
</script></body></html>`)
}

export function pageCalendar(res: ServerResponse): void {
  html(res, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>打卡日历 · 星愿</title>${STYLE}
</head><body><header><h1>📅 打卡日历</h1><nav><a href="/xingyuan/today">今日</a><a href="/xingyuan/growth">成长</a></nav></header>
<main><p class="calbar" id="label">…</p><div id="grid" class="cal"></div>
<p class="legend"><span class="dot c0"></span>无安排<span class="dot c1"></span>待打卡<span class="dot c2"></span>部分完成<span class="dot c3"></span>全部完成</p>
<p class="muted" id="detail"></p></main>
<script>
let offset=0;
function monthStr(off){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+off);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')}
async function load(){
  const m = monthStr(offset);
  const r = await fetch('/xingyuan/api/calendar?month='+m);
  if(!r.ok){ document.getElementById('label').textContent='加载失败'; return }
  const c = await r.json();
  document.getElementById('label').innerHTML =
    '<button onclick="offset--;load()">‹ 上月</button> <b>'+c.month+'</b> <button onclick="offset++;load()">下月 ›</button>';
  document.getElementById('grid').innerHTML=c.weeks.map(w=>'<div class="week">'+
    w.map(cell=>{
      if(!cell.date)return'<span class="cell empty"></span>';
      const cls=!cell.due?'c0':(cell.checked>=cell.due?'c3':(cell.checked>0?'c2':'c1'));
      return '<button type="button" class="cell '+cls+(cell.date===c.today?' today':'')+'" title="'+cell.date+'" aria-label="'+cell.date+'，'+(cell.due===0?'无安排':'已完成 '+cell.checked+'/'+cell.due)+'" onclick="pick(this)" data-date="'+cell.date+'">'+Number(cell.date.slice(8))+'</button>';
    }).join('')+'</div>').join('');
  document.getElementById('detail').textContent='';
}
async function pick(el){
  const date=el.getAttribute('data-date');
  try{
  const r=await fetch('/xingyuan/api/day?date='+date); if(!r.ok) throw new Error('HTTP '+r.status); const d=await r.json();
  document.getElementById('detail').innerHTML = d.tasks.length===0
    ? date+'：无任务安排'
    : date+'：'+d.tasks.map(t=>esc(t.name)+'（'+esc(t.cycle)+'）'+(t.checked?'✓ 已打卡':(t.canCheckIn?'○ 待打卡':'— 未领取'))).join('；');
  }catch(e){ document.getElementById('detail').textContent='加载失败：'+(e instanceof Error ? e.message : e); }
}
load()
</script></body></html>`)
}

export function pageGrowth(res: ServerResponse): void {
  html(res, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>成长中心 · 星愿</title>${STYLE}
</head><body><header><h1>🌱 成长中心</h1><nav><a href="/xingyuan/today">今日</a><a href="/xingyuan/calendar">日历</a></nav></header>
<main id="app"><p class="muted">加载中…</p></main>
<script>
const LEVEL_TINTS=['#475569','#2563eb','#047857','#0e7490','#0369a1','#1d4ed8','#6d28d9','#b45309','#c2410c','#be123c'];
function levelTint(l){return LEVEL_TINTS[Math.min(10,Math.max(1,l|0))-1]||LEVEL_TINTS[0]}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(){
  try{
  const r=await fetch('/xingyuan/api/growth'); if(!r.ok) throw new Error('HTTP '+r.status); const g=await r.json();
  const tint=levelTint(g.level);
  const expText = g.nextLevelExperience==null ? '已满级' : (g.totalExperience+' / '+g.nextLevelExperience+' EXP');
  let html =
   '<div class="hero" style="background:linear-gradient(135deg,'+tint+'e6,'+tint+'99)">'+
     '<div class="hero-badge" style="background:'+tint+'">Lv.'+g.level+'</div>'+
     '<div class="hero-main"><p class="muted on-hero">当前等级</p><h2>Lv.'+g.level+' · '+esc(g.levelName)+'</h2>'+
     '<div class="bar"><i style="width:'+g.levelProgress+'%"></i></div>'+
     '<p class="muted on-hero">'+esc(expText)+'</p></div></div>'+
   '<div class="cards">'+
   stat(g.totalCheckinDays,'累计打卡天数')+stat(g.currentStreak,'连续坚持')+stat(g.maxStreak,'最长连续坚持')+
   stat(g.wishTotal,'累计愿望')+stat(g.wishAchieved,'已实现愿望')+
   stat(g.taskTotal,'累计任务')+stat(g.taskAchieved==null?'—':g.taskAchieved,'已达成任务')+
   '</div>'+
   '<div class="lvcard"><h3>等级说明</h3>'+(g.levels||[]).map(l=>
     '<div class="lv'+(g.level>=l.level?' hit':'')+'"><span class="lvnum" style="'+(g.level>=l.level?'background:'+levelTint(l.level):'')+'">Lv.'+l.level+'</span>'+
     '<span class="lvname">'+esc(l.levelName)+'</span><span class="lvreq muted">需要 '+l.requiredExperience+' 经验</span>'+
     '<span class="lvreward muted">'+esc(l.rewardDescription)+'</span></div>').join('')+'</div>'+
   '<p class="muted">口径：当前连续从最后一条 ≤ 今天的记录倒推（未来预勾不参与）；最长连续包含未来预勾段——承诺账本语义。</p>';
  document.getElementById('app').innerHTML = html;
  }catch(e){ document.getElementById('app').innerHTML = '<p class="muted">加载失败：'+esc(e instanceof Error ? e.message : e)+'（<button class="linkbtn" onclick="location.reload()">重试</button>）</p>'; }
}
function stat(v,label){return '<div class="card"><p class="num">'+v+'</p><p class="muted">'+label+'</p></div>'}
load()
</script></body></html>`)
}

/** 双主题：浅色为基，prefers-color-scheme: dark 时整组变量翻转。 */
const STYLE = `<style>
:root{
  color-scheme:light dark;
  --xy-bg:#faf9f7; --xy-card:#ffffff; --xy-text:#26221e; --xy-muted:#8b857c;
  --xy-border:#e2dfd8; --xy-shadow:rgba(30,25,60,.06); --xy-accent:#1a6fe0; --xy-accent-strong:#1e40af;
  --xy-c0:#f0efec; --xy-c0-t:#a09a90; --xy-c1:#0000; --xy-c1-t:#55504a;
  --xy-c2:#ffb267; --xy-c2-t:#5f3c00; --xy-c3:#69db7c; --xy-c3-t:#14532d;
}
@media (prefers-color-scheme: dark){
  :root{
    --xy-bg:#1c1b22; --xy-card:#26252e; --xy-text:#e9e7ee; --xy-muted:#9a95a6;
    --xy-border:#3a3944; --xy-shadow:rgba(0,0,0,.35); --xy-accent:#60a5fa; --xy-accent-strong:#93c5fd;
    --xy-c0:#33323c; --xy-c0-t:#8f8a9c; --xy-c1:#0000; --xy-c1-t:#b6b1c4;
    --xy-c2:#8a5423; --xy-c2-t:#ffd9a8; --xy-c3:#2b7a3f; --xy-c3-t:#a5f0b5;
  }
}
*{box-sizing:border-box;margin:0;padding:0}
html{scrollbar-gutter:stable}
:focus-visible{outline:2px solid var(--xy-accent);outline-offset:2px}
button,a,.cell{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
body{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--xy-bg);color:var(--xy-text);padding:24px;max-width:720px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
h1{font-size:20px}
nav a{margin-left:14px;color:var(--xy-accent);text-decoration:none;font-size:14px}
.summary{margin:12px 0;font-size:15px}
.list{list-style:none;display:flex;flex-direction:column;gap:10px}
.list li{background:var(--xy-card);border-radius:12px;padding:14px 16px;box-shadow:0 1px 3px var(--xy-shadow)}
.t{font-size:15px;font-weight:600}
.m{font-size:13px;margin-top:4px}
.muted{color:var(--xy-muted);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0}
.card{background:var(--xy-card);border-radius:14px;padding:18px;text-align:center;box-shadow:0 1px 3px var(--xy-shadow)}
.num{font-size:28px;font-weight:700;color:var(--xy-accent-strong)}
.hero{display:flex;gap:16px;align-items:center;border-radius:16px;padding:20px;margin-top:4px;box-shadow:0 2px 8px var(--xy-shadow)}
.hero-badge{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:17px;flex:none}
.hero-main{flex:1;min-width:0}
.hero h2{font-size:19px;margin:2px 0 8px}
.on-hero{color:rgba(255,255,255,.85)!important}
.bar{height:8px;border-radius:99px;background:rgba(255,255,255,.25);overflow:hidden;margin-bottom:6px}
.bar i{display:block;height:100%;border-radius:99px;background:#fff}
.lvcard{background:var(--xy-card);border-radius:14px;padding:6px 16px;box-shadow:0 1px 3px var(--xy-shadow);margin-bottom:12px}
.lvcard h3{font-size:14px;padding:10px 0 6px;border-bottom:1px solid var(--xy-border)}
.lv{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--xy-border);opacity:.55}
.lv.hit{opacity:1}
.lv:last-child{border-bottom:none}
.lvnum{width:38px;height:26px;border-radius:8px;background:var(--xy-c0);color:var(--xy-c0-t);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:none}
.lv.hit .lvnum{color:#fff}
.lvname{font-weight:600;font-size:14px;width:70px}
.lvreq{flex:none}
.lvreward{margin-left:auto;text-align:right}
.calbar{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.cal{display:flex;flex-direction:column;gap:6px;background:var(--xy-card);border-radius:14px;padding:14px;box-shadow:0 1px 3px var(--xy-shadow)}
.week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.cell{aspect-ratio:1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;border:none;padding:0;font-family:inherit;background:transparent;color:inherit}
.cell.empty{visibility:hidden}
.c0{background:var(--xy-c0);color:var(--xy-c0-t)}
.c1{background:var(--xy-c1);color:var(--xy-c1-t);border:1px dashed var(--xy-border)}
.c2{background:var(--xy-c2);color:var(--xy-c2-t)}.c3{background:var(--xy-c3);color:var(--xy-c3-t)}
.cell.today{outline:2px solid var(--xy-accent);outline-offset:1px}
.legend{margin-top:12px;display:flex;gap:10px;align-items:center;font-size:12px;color:var(--xy-muted)}
.dot{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:4px;vertical-align:-2px}
button{border:1px solid var(--xy-border);background:var(--xy-card);color:var(--xy-text);border-radius:8px;padding:4px 12px;cursor:pointer;font-size:13px}
button:hover{border-color:var(--xy-accent)}
button.linkbtn{border:none;background:none;color:var(--xy-accent);cursor:pointer;padding:0;font-size:inherit}
#detail{margin-top:12px;line-height:1.8;overflow-wrap:anywhere}
</style>`
