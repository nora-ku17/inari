'use strict';

/* =========================================================
   かぞく手帳 — 家族カレンダー / 印刷 / やりたい100 / 家計簿 / 株・配当
   データはこの端末のブラウザ（localStorage）に保存されます。
   ========================================================= */

/* ---------- ユーティリティ ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const dayNum = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
const diffDays = (a, b) => dayNum(b) - dayNum(a);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(/[,，¥円\s]/g, '')); return isFinite(n) ? n : 0; };
const yen = n => (n < 0 ? '-' : '') + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const pct = n => (isFinite(n) ? n : 0).toFixed(2) + '%';
const toMin = t => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const todayStr = () => ymd(new Date());
const fmtDateJa = ds => { const d = parseYmd(ds); return `${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）`; };

function textOn(hex) {
  const h = (hex || '#888888').replace('#', '');
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 168 ? '#1f1f1f' : '#ffffff';
}
function tint(hex, a) {
  const h = (hex || '#888888').replace('#', '');
  return `rgba(${parseInt(h.substr(0, 2), 16)},${parseInt(h.substr(2, 2), 16)},${parseInt(h.substr(4, 2), 16)},${a})`;
}

/* ---------- 日本の祝日 ---------- */
const holidayCache = {};
function jpHolidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const h = new Map();
  const set = (m, d, name) => h.set(`${y}-${pad(m)}-${pad(d)}`, name);
  const nthMonday = (m, n) => { const f = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - f) % 7) + (n - 1) * 7; };
  const base = y - 1980, leap = Math.floor(base / 4);
  set(1, 1, '元日');
  set(1, nthMonday(1, 2), '成人の日');
  set(2, 11, '建国記念の日');
  if (y >= 2020) set(2, 23, '天皇誕生日');
  set(3, Math.floor(20.8431 + 0.242194 * base - leap), '春分の日');
  set(4, 29, '昭和の日');
  set(5, 3, '憲法記念日');
  set(5, 4, 'みどりの日');
  set(5, 5, 'こどもの日');
  set(7, nthMonday(7, 3), '海の日');
  if (y >= 2016) set(8, 11, '山の日');
  set(9, nthMonday(9, 3), '敬老の日');
  set(9, Math.floor(23.2488 + 0.242194 * base - leap), '秋分の日');
  set(10, nthMonday(10, 2), 'スポーツの日');
  set(11, 3, '文化の日');
  set(11, 23, '勤労感謝の日');
  // 国民の休日（祝日に挟まれた平日）
  for (const k of [...h.keys()]) {
    const d = parseYmd(k), n1 = ymd(addDays(d, 1)), n2 = ymd(addDays(d, 2));
    if (h.has(n2) && !h.has(n1) && addDays(d, 1).getDay() !== 0) h.set(n1, '国民の休日');
  }
  // 振替休日
  for (const k of [...h.keys()].sort()) {
    const d = parseYmd(k);
    if (d.getDay() === 0) {
      let n = addDays(d, 1);
      while (h.has(ymd(n))) n = addDays(n, 1);
      h.set(ymd(n), '振替休日');
    }
  }
  holidayCache[y] = h;
  return h;
}
const holidayName = ds => jpHolidays(+ds.slice(0, 4)).get(ds) || '';

/* ---------- 定数 ---------- */
const STORE_KEY = 'kazoku-techo-v1';
const FAMILY_ID = 'family';
const PALETTE = [
  ['#D50000', 'トマト'], ['#E67C73', 'フラミンゴ'], ['#F4511E', 'ミカン'], ['#F6BF26', 'バナナ'],
  ['#33B679', 'セージ'], ['#0B8043', 'バジル'], ['#039BE5', 'ピーコック'], ['#3F51B5', 'ブルーベリー'],
  ['#7986CB', 'ラベンダー'], ['#8E24AA', 'グレープ'], ['#616161', 'グラファイト'], ['#8D6E63', 'ココア'],
];
const ROLES = { family: '家族全体', husband: '夫', wife: '妻', child: '子ども', other: 'その他' };
const REPEATS = { none: 'くりかえさない', weekly: '毎週', biweekly: '隔週', monthly: '毎月（同じ日）', yearly: '毎年' };
const DEFAULT_EXPENSE = ['食費', '日用品', '住居', '水道光熱', '通信', '交通', '車', '教育', '習い事', '医療', '衣服・美容', '娯楽', '交際', '保険', '税金', 'その他'];
const DEFAULT_INCOME = ['給与', '賞与', '副収入', '配当', '児童手当', '臨時収入', 'その他'];
const BUCKET_CATS = ['おでかけ・旅行', '体験', 'たべもの', '学び・挑戦', 'おうち', '季節のイベント', '記念・思い出', 'その他'];
const BUCKET_IDEAS = [
  ['家族みんなで富士山を見に行く', 'おでかけ・旅行'], ['キャンプで一泊する', '体験'], ['テントで星空観察', '体験'],
  ['飛行機で旅行する', 'おでかけ・旅行'], ['新幹線で遠くの街へ行く', 'おでかけ・旅行'], ['温泉旅館に泊まる', 'おでかけ・旅行'],
  ['海外旅行に行く', 'おでかけ・旅行'], ['47都道府県のうち10県に行く', 'おでかけ・旅行'], ['動物園の年間パスを作る', 'おでかけ・旅行'],
  ['水族館でお泊まりイベントに参加', '体験'], ['いちご狩り', 'たべもの'], ['ぶどう狩り', 'たべもの'], ['潮干狩り', '体験'],
  ['家族で餃子を100個つくる', 'たべもの'], ['手打ちうどんをつくる', 'たべもの'], ['パンを一から焼く', 'たべもの'],
  ['回転しないお寿司屋さんに行く', 'たべもの'], ['ご当地グルメを食べ歩く', 'たべもの'], ['梅干しを漬ける', 'おうち'],
  ['自転車で隣町まで行く', '学び・挑戦'], ['家族でマラソン大会に出る', '学び・挑戦'], ['山に登って山頂でおにぎり', '体験'],
  ['プラネタリウムに行く', '学び・挑戦'], ['博物館で恐竜を見る', '学び・挑戦'], ['家族で英語の歌を1曲覚える', '学び・挑戦'],
  ['野菜を育てて収穫する', 'おうち'], ['家族新聞をつくる', 'おうち'], ['おうち映画館の日', 'おうち'], ['家族でボードゲーム大会', 'おうち'],
  ['大掃除を1日で終わらせる', 'おうち'], ['花火大会に行く', '季節のイベント'], ['雪だるまをつくる', '季節のイベント'],
  ['お花見でお弁当', '季節のイベント'], ['紅葉を見に行く', '季節のイベント'], ['初日の出を見る', '季節のイベント'],
  ['ハロウィンの仮装をする', '季節のイベント'], ['家族写真をスタジオで撮る', '記念・思い出'], ['タイムカプセルを埋める', '記念・思い出'],
  ['子どもの手形アートを毎年残す', '記念・思い出'], ['ホームビデオで1年をまとめる', '記念・思い出'], ['家族でボランティアに参加', '体験'],
  ['釣りをして魚をさばく', '体験'], ['陶芸体験をする', '体験'], ['乗馬をする', '体験'], ['朝4時に起きて朝日を見る', '体験'],
];

function defaultState() {
  return {
    version: 1,
    members: [
      { id: FAMILY_ID, name: '家族みんな', role: 'family', color: '#F6BF26' },
      { id: 'm_husband', name: '夫', role: 'husband', color: '#039BE5' },
      { id: 'm_wife', name: '妻', role: 'wife', color: '#E67C73' },
      { id: 'm_child1', name: '子ども1', role: 'child', color: '#33B679' },
    ],
    events: [],
    bucket: [],
    budget: { tx: [], expenseCats: [...DEFAULT_EXPENSE], incomeCats: [...DEFAULT_INCOME], limits: {} },
    stocks: { holdings: [], receipts: [], taxRate: 20.315 },
    settings: {
      tab: 'calendar', calView: 'month', weekStart: 0, hidden: [],
      print: { layout: 'table', orient: 'portrait', members: null, memo: true, font: 'm', time: 'start' },
    },
  };
}

/* ---------- データの検査（読み込み・バックアップ・同期で受け取ったデータを安全な形にそろえる） ---------- */
const sStr = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').slice(0, max);
const sId = v => /^[A-Za-z0-9_-]{1,64}$/.test(sStr(v, 100)) ? String(v) : '';
const sDate = v => /^\d{4}-\d{2}-\d{2}$/.test(sStr(v, 20)) ? String(v) : '';
const sTime = v => /^\d{2}:\d{2}$/.test(sStr(v, 10)) ? String(v) : '';
const sColor = v => /^#[0-9a-fA-F]{6}$/.test(sStr(v, 10)) ? String(v) : '#888888';
const sNum = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const sArr = v => Array.isArray(v) ? v : [];
const sPick = (v, list, def) => list.includes(v) ? v : def;
const SCHEMA = {
  members: r => ({ id: sId(r.id), name: sStr(r.name, 20) || '？', role: sPick(r.role, Object.keys(ROLES), 'other'), color: sColor(r.color) }),
  events: r => {
    const e = {
      id: sId(r.id), title: sStr(r.title, 80), date: sDate(r.date), endDate: sDate(r.endDate), allDay: !!r.allDay,
      start: sTime(r.start), end: sTime(r.end), members: sArr(r.members).map(sId).filter(Boolean),
      repeat: sPick(r.repeat, Object.keys(REPEATS), 'none'), until: sDate(r.until),
      exdates: sArr(r.exdates).map(sDate).filter(Boolean), memo: sStr(r.memo, 1000),
    };
    if (!e.allDay && !e.start) e.allDay = true;
    return e.date ? e : null;
  },
  bucket: r => ({ id: sId(r.id), title: sStr(r.title, 80), cat: sStr(r.cat, 30), by: sId(r.by), done: !!r.done, doneDate: sDate(r.doneDate), memo: sStr(r.memo, 1000) }),
  tx: r => {
    const t = { id: sId(r.id), date: sDate(r.date), type: sPick(r.type, ['income', 'expense'], 'expense'), cat: sStr(r.cat, 30), amount: Math.round(sNum(r.amount)), who: sId(r.who), memo: sStr(r.memo, 200), created: sNum(r.created) };
    return t.date ? t : null;
  },
  holdings: r => ({
    id: sId(r.id), code: sStr(r.code, 10), name: sStr(r.name, 60), account: sPick(r.account, ['特定', '一般', 'NISA'], '特定'), owner: sId(r.owner),
    shares: sNum(r.shares), cost: sNum(r.cost), price: sNum(r.price), dps: sNum(r.dps),
    months: [...new Set(sArr(r.months).map(Number).filter(m => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b),
    yutai: sStr(r.yutai, 100), memo: sStr(r.memo, 200),
  }),
  receipts: r => {
    const x = { id: sId(r.id), date: sDate(r.date), holdingId: sId(r.holdingId), amount: Math.round(sNum(r.amount)), memo: sStr(r.memo, 200) };
    if (sId(r.txId)) x.txId = r.txId;
    if (r.name) x.name = sStr(r.name, 80);
    return x.date ? x : null;
  },
};
/** 1件のデータを検査して安全な形にする（不正なものは null） */
function normRecord(kind, r) {
  if (!r || typeof r !== 'object') return null;
  const out = SCHEMA[kind](r);
  return out && out.id ? out : null;
}
const normList = (kind, list) => sArr(list).map(r => normRecord(kind, r)).filter(Boolean);
function normCats(list, def) { const a = [...new Set(sArr(list).map(c => sStr(c, 30).trim()).filter(Boolean))]; return a.length ? a : [...def]; }
function normLimits(o) {
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (sNum(v) > 0) out[sStr(k, 30)] = Math.round(sNum(v));
  return out;
}

/* ---------- 保存・読み込み ---------- */
function mergeState(def, s) {
  if (!s || typeof s !== 'object') return def;
  const out = { ...def, ...s };
  out.budget = { ...def.budget, ...(s.budget || {}) };
  out.stocks = { ...def.stocks, ...(s.stocks || {}) };
  out.settings = { ...def.settings, ...(s.settings || {}) };
  out.settings.print = { ...def.settings.print, ...((s.settings || {}).print || {}) };
  if (!Array.isArray(out.members) || !out.members.length) out.members = def.members;
  if (!out.members.some(m => m.id === FAMILY_ID)) out.members.unshift(def.members[0]);
  for (const k of ['events', 'bucket']) if (!Array.isArray(out[k])) out[k] = [];
  for (const k of ['tx', 'expenseCats', 'incomeCats']) if (!Array.isArray(out.budget[k])) out.budget[k] = def.budget[k];
  for (const k of ['holdings', 'receipts']) if (!Array.isArray(out.stocks[k])) out.stocks[k] = [];
  if (!Array.isArray(out.settings.hidden)) out.settings.hidden = [];
  // 中身の検査
  out.members = normList('members', out.members);
  if (!out.members.some(m => m.id === FAMILY_ID)) out.members.unshift(def.members[0]);
  out.events = normList('events', out.events);
  out.bucket = normList('bucket', out.bucket);
  out.budget = { tx: normList('tx', out.budget.tx), expenseCats: normCats(out.budget.expenseCats, DEFAULT_EXPENSE), incomeCats: normCats(out.budget.incomeCats, DEFAULT_INCOME), limits: normLimits(out.budget.limits) };
  out.stocks = { holdings: normList('holdings', out.stocks.holdings), receipts: normList('receipts', out.stocks.receipts), taxRate: Math.min(100, Math.max(0, sNum(out.stocks.taxRate))) };
  const st = out.settings, pr = st.print;
  st.hidden = st.hidden.map(sId).filter(Boolean);
  st.weekStart = st.weekStart === 1 ? 1 : 0;
  st.calView = sPick(st.calView, ['month', 'week', 'agenda'], 'month');
  st.tab = sStr(st.tab, 20);
  pr.layout = sPick(pr.layout, ['table', 'calendar'], 'table');
  pr.orient = sPick(pr.orient, ['portrait', 'landscape'], 'portrait');
  pr.font = sPick(pr.font, ['s', 'm', 'l'], 'm');
  pr.time = sPick(pr.time, ['start', 'range', 'none'], 'start');
  pr.month = /^\d{4}-\d{2}$/.test(sStr(pr.month, 10)) ? pr.month : '';
  pr.memo = !!pr.memo;
  pr.members = Array.isArray(pr.members) ? pr.members.map(sId).filter(Boolean) : null;
  return out;
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? mergeState(defaultState(), JSON.parse(raw)) : defaultState();
  } catch (e) { return defaultState(); }
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('保存できませんでした（ブラウザの保存容量をご確認ください）'); }
  if (window.Sync) Sync.schedulePush();
}

/* ---------- 共通UI ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

let dlgCtx = null;
function openDialog(html, ctx = {}) {
  const d = $('#dlg');
  dlgCtx = ctx;
  d.innerHTML = html;
  if (!d.open) d.showModal();
  const f = d.querySelector('[autofocus]');
  if (f && window.innerWidth > 700) f.focus();
}
function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); dlgCtx = null; }

function choose(message, buttons) {
  return new Promise(resolve => {
    const d = $('#confirm');
    d.innerHTML = `<div class="confirm-body"><p>${esc(message).replace(/\n/g, '<br>')}</p>
      <div class="dlg-actions">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const onClick = e => {
      const b = e.target.closest('button[data-i]');
      if (!b && e.target !== d) return;
      d.removeEventListener('click', onClick);
      d.close();
      resolve(b ? buttons[+b.dataset.i].value : null);
    };
    d.addEventListener('click', onClick);
    d.addEventListener('cancel', () => { d.removeEventListener('click', onClick); resolve(null); }, { once: true });
    d.showModal();
  });
}
const confirmYes = (msg, label = '削除する') => choose(msg, [{ label: 'キャンセル', value: false }, { label, value: true, cls: 'danger' }]);

function dlgHead(title) {
  return `<div class="dlg-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-action="close-dialog" aria-label="閉じる">✕</button></div>`;
}
function memberOptions(selected, { blank = '—', includeFamily = true } = {}) {
  return (blank !== null ? `<option value="">${esc(blank)}</option>` : '') +
    state.members.filter(m => includeFamily || m.id !== FAMILY_ID)
      .map(m => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- タブ ---------- */
let currentTab = state.settings.tab || 'calendar';
const renderers = {};
function switchTab(t) {
  if (!renderers[t]) t = 'calendar';
  currentTab = t;
  state.settings.tab = t;
  save();
  $$('.tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === t);
    if (b.dataset.tab === t) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  $$('main > .tab').forEach(s => { s.hidden = s.id !== 'tab-' + t; });
  render();
}
function render() { renderers[currentTab](); }

/* =========================================================
   メンバー・予定
   ========================================================= */
const memberById = id => state.members.find(m => m.id === id);
const isHidden = id => state.settings.hidden.includes(id);
function evMembers(ev) {
  const ms = (ev.members || []).map(memberById).filter(Boolean);
  return ms.length ? ms : [memberById(FAMILY_ID)];
}
const evVisible = ev => evMembers(ev).some(m => !isHidden(m.id));
function evColors(ev) {
  const ms = evMembers(ev);
  const vis = ms.filter(m => !isHidden(m.id));
  return (vis.length ? vis : ms).map(m => m.color);
}
const spanLen = ev => (ev.endDate && ev.endDate > ev.date) ? diffDays(parseYmd(ev.date), parseYmd(ev.endDate)) : 0;
const isAllDayLike = ev => ev.allDay || spanLen(ev) > 0;

function isStartOn(ev, s) {
  const sk = ymd(s);
  if (sk < ev.date) return false;
  if (ev.repeat && ev.repeat !== 'none' && ev.until && sk > ev.until) return false;
  if (ev.exdates && ev.exdates.includes(sk)) return false;
  const start = parseYmd(ev.date);
  switch (ev.repeat) {
    case 'weekly': return diffDays(start, s) % 7 === 0;
    case 'biweekly': return diffDays(start, s) % 14 === 0;
    case 'monthly': return s.getDate() === start.getDate();
    case 'yearly': return s.getMonth() === start.getMonth() && s.getDate() === start.getDate();
    default: return sk === ev.date;
  }
}
/** その日に予定があれば、その回の開始日（YYYY-MM-DD）を返す */
function occStart(ev, d) {
  const len = spanLen(ev);
  for (let k = 0; k <= len; k++) {
    const s = addDays(d, -k);
    if (isStartOn(ev, s)) return ymd(s);
  }
  return null;
}
function cmpOcc(a, b) {
  const aa = isAllDayLike(a.ev) ? 0 : 1, bb = isAllDayLike(b.ev) ? 0 : 1;
  if (aa !== bb) return aa - bb;
  if (aa) return (a.ev.start || '').localeCompare(b.ev.start || '') || a.ev.title.localeCompare(b.ev.title);
  return a.ev.title.localeCompare(b.ev.title);
}
function occurrencesOn(ds, { all = false } = {}) {
  const d = parseYmd(ds);
  const out = [];
  for (const ev of state.events) {
    if (!all && !evVisible(ev)) continue;
    const s = occStart(ev, d);
    if (s) out.push({ ev, occ: s, day: ds });
  }
  return out.sort(cmpOcc);
}
function timeLabel(ev, withEnd = true) {
  if (isAllDayLike(ev)) return '終日';
  return ev.start + (withEnd && ev.end ? '–' + ev.end : '');
}
/** 複数メンバーの予定は右端に色の帯を重ねる */
function stripeShadow(cs, w) {
  if (cs.length < 2) return '';
  return 'box-shadow:' + cs.slice(1).map((c, i) => `inset -${(i + 1) * w}px 0 0 0 ${c}`).join(',') + ';';
}
function dotsHtml(colors) { return colors.map(c => `<i class="dot" style="background:${c}"></i>`).join(''); }

/* =========================================================
   カレンダー
   ========================================================= */
const cal = { cursor: new Date() };
const HOUR_H = 44;

function weekStartDate(d) { return addDays(d, -((d.getDay() - state.settings.weekStart + 7) % 7)); }
function calTitle() {
  const c = cal.cursor;
  if (state.settings.calView === 'week') {
    const s = weekStartDate(c), e = addDays(s, 6);
    return s.getMonth() === e.getMonth()
      ? `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 – ${e.getDate()}日`
      : `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 – ${e.getFullYear() !== s.getFullYear() ? e.getFullYear() + '年' : ''}${e.getMonth() + 1}月${e.getDate()}日`;
  }
  return `${c.getFullYear()}年${c.getMonth() + 1}月`;
}

renderers.calendar = function () {
  const view = state.settings.calView;
  const el = $('#tab-calendar');
  el.innerHTML = `
  <div class="cal-toolbar">
    <button class="btn" data-action="cal-today">今日</button>
    <div class="arrows">
      <button class="icon-btn" data-action="cal-move" data-dir="-1" aria-label="前へ">‹</button>
      <button class="icon-btn" data-action="cal-move" data-dir="1" aria-label="次へ">›</button>
    </div>
    <h2 class="cal-title">${calTitle()}</h2>
    <div class="seg" role="group" aria-label="表示">
      ${[['month', '月'], ['week', '週'], ['agenda', 'リスト']].map(([v, l]) =>
        `<button data-action="cal-view" data-view="${v}" class="${v === view ? 'on' : ''}">${l}</button>`).join('')}
    </div>
    <button class="btn primary add-btn" data-action="new-event">＋ 予定を追加</button>
  </div>
  <div class="member-filter" aria-label="表示するメンバー">
    ${state.members.map(m => `<button class="mchip ${isHidden(m.id) ? 'off' : ''}" data-action="toggle-member" data-id="${m.id}" style="--c:${m.color}" aria-pressed="${!isHidden(m.id)}">
      <span class="sw"></span>${esc(m.name)}</button>`).join('')}
  </div>
  <div class="cal-body">${view === 'week' ? weekHtml() : view === 'agenda' ? agendaHtml() : monthHtml()}</div>
  <button class="fab" data-action="new-event" aria-label="予定を追加">＋</button>`;
  if (view === 'week') {
    const b = $('.wk-scroll', el);
    if (b) b.scrollTop = 7 * HOUR_H - 10;
  }
};

function chipHtml(o) {
  const ev = o.ev, cs = evColors(ev);
  const attrs = `data-action="edit-event" data-id="${ev.id}" data-occ="${o.occ}" title="${esc(timeLabel(ev) + ' ' + ev.title)}"`;
  if (isAllDayLike(ev)) {
    return `<button class="chip allday" ${attrs} style="background:${cs[0]};color:${textOn(cs[0])};${stripeShadow(cs, 5)}">${esc(ev.title)}</button>`;
  }
  return `<button class="chip timed" ${attrs} style="--c:${cs[0]}"><span class="dots">${dotsHtml(cs)}</span><span class="t">${ev.start}</span><span class="ttl">${esc(ev.title)}</span></button>`;
}

function monthHtml() {
  const y = cal.cursor.getFullYear(), m = cal.cursor.getMonth(), ws = state.settings.weekStart;
  const first = new Date(y, m, 1);
  const offset = (first.getDay() - ws + 7) % 7;
  const start = addDays(first, -offset);
  const weeks = Math.ceil((offset + daysIn(y, m)) / 7);
  const today = todayStr();
  let head = '';
  for (let i = 0; i < 7; i++) {
    const dw = (ws + i) % 7;
    head += `<div class="mh ${dw === 0 ? 'sun' : dw === 6 ? 'sat' : ''}">${DOW[dw]}</div>`;
  }
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), ds = ymd(d), dw = d.getDay(), hol = holidayName(ds);
    const occ = occurrencesOn(ds);
    const max = 3;
    const cls = ['mc', d.getMonth() !== m ? 'other' : '', ds === today ? 'today' : '', (dw === 0 || hol) ? 'sun' : dw === 6 ? 'sat' : ''].join(' ');
    cells += `<div class="${cls}" data-action="cell-click" data-date="${ds}">
      <div class="mc-head"><button class="dnum" data-action="open-day" data-date="${ds}" aria-label="${fmtDateJa(ds)}">${d.getDate() === 1 ? `${d.getMonth() + 1}/` : ''}${d.getDate()}</button>${hol ? `<span class="hol">${esc(hol)}</span>` : ''}</div>
      <div class="mc-evs">${occ.slice(0, max).map(chipHtml).join('')}${occ.length > max ? `<button class="more" data-action="open-day" data-date="${ds}">他 ${occ.length - max} 件</button>` : ''}</div>
    </div>`;
  }
  return `<div class="month" style="--weeks:${weeks}"><div class="month-head">${head}</div><div class="month-grid">${cells}</div></div>`;
}

function layoutTimed(occs) {
  const items = occs.map(o => {
    const st = toMin(o.ev.start);
    let en = o.ev.end ? toMin(o.ev.end) : st + 60;
    if (en <= st) en = Math.min(st + 30, 24 * 60);
    return { o, st, en };
  }).sort((a, b) => a.st - b.st || b.en - a.en);
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex(end => end <= it.st);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = it.en;
      it.col = c;
    }
    cluster.forEach(it => { it.ncol = cols.length; });
    out.push(...cluster);
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.st >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.en);
  }
  if (cluster.length) flush();
  return out;
}

function weekHtml() {
  const s = weekStartDate(cal.cursor);
  const days = [...Array(7)].map((_, i) => addDays(s, i));
  const today = todayStr();
  const now = new Date();
  let head = '<div class="wk-corner"></div>', allday = '<div class="wk-label">終日</div>', cols = '';
  let times = '';
  for (let h = 0; h < 24; h++) times += `<div class="tl" style="height:${HOUR_H}px"><span>${h ? h + ':00' : ''}</span></div>`;
  for (const d of days) {
    const ds = ymd(d), dw = d.getDay(), hol = holidayName(ds);
    const cls = [(dw === 0 || hol) ? 'sun' : dw === 6 ? 'sat' : '', ds === today ? 'today' : ''].join(' ');
    const occ = occurrencesOn(ds);
    head += `<div class="wh ${cls}"><span class="wdow">${DOW[dw]}</span><button class="wdate" data-action="open-day" data-date="${ds}">${d.getDate()}</button>${hol ? `<span class="hol">${esc(hol)}</span>` : ''}</div>`;
    allday += `<div class="wk-ad ${cls}" data-action="new-event" data-date="${ds}">${occ.filter(o => isAllDayLike(o.ev)).map(chipHtml).join('')}</div>`;
    const timed = layoutTimed(occ.filter(o => !isAllDayLike(o.ev))).map(it => {
      const ev = it.o.ev, cs = evColors(ev), c = cs[0];
      const top = it.st / 60 * HOUR_H, hgt = Math.max((it.en - it.st) / 60 * HOUR_H - 2, 18);
      return `<button class="wev" data-action="edit-event" data-id="${ev.id}" data-occ="${it.o.occ}"
        style="top:${top}px;height:${hgt}px;left:calc(${it.col / it.ncol * 100}% + 1px);width:calc(${100 / it.ncol}% - 3px);background:${c};color:${textOn(c)};${stripeShadow(cs, 5)}">
        <b>${esc(ev.title)}</b><span>${timeLabel(ev)}${cs.length > 1 ? ' ' + evMembers(ev).map(m => esc(m.name)).join('・') : ''}</span></button>`;
    }).join('');
    const nowLine = ds === today ? `<div class="now-line" style="top:${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H}px"></div>` : '';
    cols += `<div class="wcol ${cls}" data-action="new-event-at" data-date="${ds}" style="height:${24 * HOUR_H}px;--hh:${HOUR_H}px">${timed}${nowLine}</div>`;
  }
  return `<div class="week">
    <div class="wk-grid wk-head">${head}</div>
    <div class="wk-grid wk-allday">${allday}</div>
    <div class="wk-scroll"><div class="wk-grid wk-bodygrid"><div class="wk-times">${times}</div>${cols}</div></div>
  </div>`;
}

function agendaHtml() {
  const y = cal.cursor.getFullYear(), m = cal.cursor.getMonth(), today = todayStr();
  let html = '';
  for (let d = 1; d <= daysIn(y, m); d++) {
    const date = new Date(y, m, d), ds = ymd(date), occ = occurrencesOn(ds);
    if (!occ.length) continue;
    const dw = date.getDay(), hol = holidayName(ds);
    html += `<div class="ag-day ${ds === today ? 'today' : ''} ${(dw === 0 || hol) ? 'sun' : dw === 6 ? 'sat' : ''}">
      <button class="ag-date" data-action="open-day" data-date="${ds}"><b>${d}</b><span>${DOW[dw]}${hol ? '・' + esc(hol) : ''}</span></button>
      <div class="ag-list">${occ.map(o => `<button class="ag-item" data-action="edit-event" data-id="${o.ev.id}" data-occ="${o.occ}">
        <span class="dots">${dotsHtml(evColors(o.ev))}</span><span class="ag-time">${timeLabel(o.ev)}</span>
        <span class="ag-title">${esc(o.ev.title)}</span><span class="ag-who">${evMembers(o.ev).map(mm => esc(mm.name)).join('・')}</span></button>`).join('')}</div>
    </div>`;
  }
  return `<div class="agenda card">${html || '<p class="empty">この月の予定はまだありません。「＋ 予定を追加」から登録しましょう。</p>'}</div>`;
}

/* ---------- 予定ダイアログ ---------- */
function openEventDialog(opts = {}) {
  const src = opts.ev;
  const ev = src ? { ...src, members: [...(src.members || [])] } : {
    id: null, title: '', date: opts.date || todayStr(), endDate: '',
    allDay: !opts.start, start: opts.start || '09:00', end: opts.end || '10:00',
    members: opts.members || [FAMILY_ID], repeat: 'none', until: '', memo: '',
  };
  if (!ev.members.length) ev.members = [FAMILY_ID];
  openDialog(`<form class="dlg-form" id="event-form" autocomplete="off">
    ${dlgHead(ev.id ? '予定を編集' : '予定を追加')}
    <input name="title" class="title-input" placeholder="タイトル（例：歯医者、運動会）" value="${esc(ev.title)}" required autofocus maxlength="80">
    <div class="field"><span class="lbl">だれの予定？（複数えらべます）</span>
      <div class="member-pick">${state.members.map(m => `<label class="mpick" style="--c:${m.color};--t:${textOn(m.color)}">
        <input type="checkbox" name="members" value="${m.id}" ${ev.members.includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}</div>
    </div>
    <div class="row">
      <label class="field"><span class="lbl">日付</span><input type="date" name="date" value="${ev.date}" required></label>
      <label class="field"><span class="lbl">終了日（何日か続くとき）</span><input type="date" name="endDate" value="${ev.endDate || ''}"></label>
    </div>
    <label class="check"><input type="checkbox" name="allDay" ${ev.allDay ? 'checked' : ''}> 終日（時間を決めない）</label>
    <div class="row time-row" ${ev.allDay ? 'hidden' : ''}>
      <label class="field"><span class="lbl">開始</span><input type="time" name="start" value="${ev.start || '09:00'}" step="300"></label>
      <label class="field"><span class="lbl">終了（任意）</span><input type="time" name="end" value="${ev.end || ''}" step="300"></label>
    </div>
    <div class="row">
      <label class="field"><span class="lbl">くりかえし</span><select name="repeat">${Object.entries(REPEATS).map(([k, v]) => `<option value="${k}" ${ev.repeat === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field until-field" ${ev.repeat === 'none' ? 'hidden' : ''}><span class="lbl">くりかえし終了日（任意）</span><input type="date" name="until" value="${ev.until || ''}"></label>
    </div>
    <label class="field"><span class="lbl">メモ</span><textarea name="memo" rows="2" placeholder="持ち物・場所など">${esc(ev.memo)}</textarea></label>
    ${ev.id && ev.repeat !== 'none' ? '<p class="hint">※ くりかえし予定の変更はすべての回に反映されます</p>' : ''}
    <div class="dlg-actions">
      ${ev.id ? '<button type="button" class="btn danger-text" data-action="delete-event">削除</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-action="close-dialog">キャンセル</button>
      <button class="btn primary">保存</button>
    </div>
  </form>`, { type: 'event', id: ev.id, occ: opts.occ });
}

function saveEventForm(form) {
  const fd = new FormData(form);
  const title = (fd.get('title') || '').trim();
  if (!title) { toast('タイトルを入力してください'); return; }
  const allDay = !!fd.get('allDay');
  const date = fd.get('date');
  let endDate = fd.get('endDate') || '';
  if (endDate && endDate <= date) endDate = '';
  let start = fd.get('start') || '09:00', end = fd.get('end') || '';
  if (!allDay && end && end <= start && !endDate) end = '';
  const repeat = fd.get('repeat');
  const data = {
    title, date, endDate, allDay, start: allDay ? '' : start, end: allDay ? '' : end,
    members: fd.getAll('members'), repeat, until: repeat === 'none' ? '' : (fd.get('until') || ''),
    memo: (fd.get('memo') || '').trim(),
  };
  if (!data.members.length) data.members = [FAMILY_ID];
  if (dlgCtx.id) {
    const ev = state.events.find(e => e.id === dlgCtx.id);
    if (goneRecord(ev)) return;
    Object.assign(ev, data);
  } else {
    state.events.push({ id: uid(), exdates: [], ...data });
  }
  save();
  closeDialog();
  render();
  toast('予定を保存しました');
}

async function deleteEvent() {
  const ev = state.events.find(e => e.id === dlgCtx.id);
  if (!ev) return;
  const occ = dlgCtx.occ;
  let how;
  if (ev.repeat && ev.repeat !== 'none' && occ) {
    how = await choose(`「${ev.title}」はくりかえし予定です。どれを削除しますか？`, [
      { label: 'キャンセル', value: null },
      { label: `この回（${fmtDateJa(occ)}）だけ`, value: 'one', cls: 'danger' },
      { label: 'すべての回', value: 'all', cls: 'danger' },
    ]);
  } else {
    how = (await confirmYes(`「${ev.title}」を削除しますか？`)) ? 'all' : null;
  }
  if (!how) return;
  if (how === 'one') (ev.exdates = ev.exdates || []).push(occ);
  else state.events = state.events.filter(e => e !== ev);
  save();
  closeDialog();
  render();
  toast('削除しました');
}

function openDayDialog(ds) {
  const occ = occurrencesOn(ds, { all: true });
  const hol = holidayName(ds);
  openDialog(`<div class="dlg-form">
    ${dlgHead(fmtDateJa(ds) + (hol ? ' ' + hol : ''))}
    <div class="day-list">${occ.length ? occ.map(o => `<button class="ag-item ${evVisible(o.ev) ? '' : 'dim'}" data-action="edit-event" data-id="${o.ev.id}" data-occ="${o.occ}">
      <span class="dots">${dotsHtml(evColors(o.ev))}</span><span class="ag-time">${timeLabel(o.ev)}</span>
      <span class="ag-title">${esc(o.ev.title)}</span><span class="ag-who">${evMembers(o.ev).map(m => esc(m.name)).join('・')}</span></button>`).join('')
      : '<p class="empty">予定はありません</p>'}</div>
    <div class="dlg-actions"><span class="spacer"></span><button class="btn primary" data-action="new-event" data-date="${ds}">＋ この日に予定を追加</button></div>
  </div>`, { type: 'day', date: ds });
}

/* =========================================================
   印刷（A4 ひと月）
   ========================================================= */
function printOpts() { return state.settings.print; }
function printMembers() {
  const o = printOpts();
  return state.members.filter(m => !o.members || o.members.includes(m.id));
}
function applyPageStyle() {
  $('#page-style').textContent = `@page { size: A4 ${printOpts().orient}; margin: 8mm; }`;
}

renderers.print = function () {
  const o = printOpts();
  if (!o.month) o.month = ym(new Date());
  const el = $('#tab-print');
  el.innerHTML = `<div class="print-wrap">
    <aside class="card print-controls">
      <h2>A4でひと月分を印刷</h2>
      <label class="field"><span class="lbl">月</span><input type="month" data-pr="month" value="${o.month}"></label>
      <div class="field"><span class="lbl">レイアウト</span>
        <div class="seg full">
          <button data-action="pr-set" data-k="layout" data-v="table" class="${o.layout === 'table' ? 'on' : ''}">日付 × 家族の表</button>
          <button data-action="pr-set" data-k="layout" data-v="calendar" class="${o.layout === 'calendar' ? 'on' : ''}">カレンダー型</button>
        </div></div>
      <div class="field"><span class="lbl">用紙の向き</span>
        <div class="seg full">
          <button data-action="pr-set" data-k="orient" data-v="portrait" class="${o.orient === 'portrait' ? 'on' : ''}">A4 たて</button>
          <button data-action="pr-set" data-k="orient" data-v="landscape" class="${o.orient === 'landscape' ? 'on' : ''}">A4 よこ</button>
        </div></div>
      <div class="field"><span class="lbl">のせる人（列）</span>
        <div class="member-pick">${state.members.map(m => `<label class="mpick" style="--c:${m.color};--t:${textOn(m.color)}">
          <input type="checkbox" data-pr="member" value="${m.id}" ${!o.members || o.members.includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}</div></div>
      <label class="check"><input type="checkbox" data-pr="memo" ${o.memo ? 'checked' : ''}> 手書き用のメモ欄を付ける（表のとき）</label>
      <div class="row">
        <label class="field"><span class="lbl">文字の大きさ</span><select data-pr="font">
          ${[['s', '小'], ['m', '中'], ['l', '大']].map(([k, v]) => `<option value="${k}" ${o.font === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">時刻の表示</span><select data-pr="time">
          ${[['start', '開始のみ'], ['range', '開始–終了'], ['none', '表示しない']].map(([k, v]) => `<option value="${k}" ${o.time === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <button class="btn primary big" data-action="do-print">🖨️ 印刷する</button>
      <p class="hint">印刷画面で「用紙サイズ：A4」「倍率：100%（既定）」「背景のグラフィック：オン」にするときれいに出ます。PDFに保存もできます。</p>
    </aside>
    <div class="paper-scroll"><div class="paper ${o.orient}" id="paper">${sheetHtml()}</div></div>
  </div>`;
  applyPageStyle();
  fitPaper();
};

function fitPaper() {
  const p = $('#paper');
  if (!p) return;
  p.style.zoom = 1;
  const avail = p.parentElement.clientWidth - 8;
  const w = p.offsetWidth;
  if (w > avail && avail > 0) p.style.zoom = (avail / w).toFixed(3);
}

function sheetHtml() {
  const o = printOpts();
  const [y, mo] = o.month.split('-').map(Number);
  return o.layout === 'calendar' ? calendarSheet(y, mo - 1) : tableSheet(y, mo - 1);
}
function printEvText(ev) {
  const o = printOpts();
  if (o.time === 'none' || isAllDayLike(ev)) return esc(ev.title);
  const t = o.time === 'range' && ev.end ? `${ev.start}–${ev.end}` : ev.start;
  return `<b class="pt-time">${t}</b> ${esc(ev.title)}`;
}
function sheetLegend(ms) {
  return `<span class="legend">${ms.map(m => `<span><i style="background:${m.color}"></i>${esc(m.name)}</span>`).join('')}</span>`;
}

function tableSheet(y, m) {
  const o = printOpts(), ms = printMembers();
  const n = daysIn(y, m);
  const H = o.orient === 'portrait' ? 281 : 194;
  const titleH = 9, headH = 7;
  const rowH = (H - titleH - headH - 3) / n;
  const memoCol = o.memo ? `<col style="width:${o.orient === 'portrait' ? 28 : 45}mm">` : '';
  let rows = '';
  for (let d = 1; d <= n; d++) {
    const date = new Date(y, m, d), ds = ymd(date), dw = date.getDay(), hol = holidayName(ds);
    const occ = occurrencesOn(ds, { all: true });
    const cls = (dw === 0 || hol) ? 'sun' : dw === 6 ? 'sat' : '';
    const cells = ms.map(mem => {
      const list = occ.filter(x => evMembers(x.ev).some(mm => mm.id === mem.id));
      return `<td><div class="pc" style="max-height:${(rowH - 0.6).toFixed(2)}mm">${list.map(x => `<div class="pe">${printEvText(x.ev)}</div>`).join('')}</div></td>`;
    }).join('');
    rows += `<tr class="${cls}" style="height:${rowH.toFixed(2)}mm">
      <td class="pd"><div class="pc" style="max-height:${(rowH - 0.6).toFixed(2)}mm"><b>${d}</b><span class="pdw">${DOW[dw]}</span>${hol ? `<div class="phol">${esc(hol)}</div>` : ''}</div></td>
      ${cells}${o.memo ? '<td></td>' : ''}</tr>`;
  }
  return `<div class="sheet font-${o.font}">
    <div class="sheet-title" style="height:${titleH}mm"><h1>${y}年${m + 1}月</h1><span class="sub">かぞくの予定</span>${sheetLegend(ms)}</div>
    <table class="ptable">
      <colgroup><col style="width:13mm">${ms.map(() => '<col>').join('')}${memoCol}</colgroup>
      <thead><tr style="height:${headH}mm"><th>日</th>${ms.map(mem => `<th style="background:${mem.color};color:${textOn(mem.color)}">${esc(mem.name)}</th>`).join('')}${o.memo ? '<th class="memo-h">メモ</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function calendarSheet(y, m) {
  const o = printOpts(), ms = printMembers(), ids = ms.map(x => x.id), ws = state.settings.weekStart;
  const first = new Date(y, m, 1), offset = (first.getDay() - ws + 7) % 7, start = addDays(first, -offset);
  const weeks = Math.ceil((offset + daysIn(y, m)) / 7);
  const H = o.orient === 'portrait' ? 281 : 194;
  const titleH = 11, dowH = 6;
  const rowH = (H - titleH - dowH - 3) / weeks;
  let head = '';
  for (let i = 0; i < 7; i++) { const dw = (ws + i) % 7; head += `<th class="${dw === 0 ? 'sun' : dw === 6 ? 'sat' : ''}">${DOW[dw]}</th>`; }
  let body = '';
  for (let w = 0; w < weeks; w++) {
    body += `<tr style="height:${rowH.toFixed(2)}mm">`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i), ds = ymd(d), dw = d.getDay(), hol = holidayName(ds);
      const inMonth = d.getMonth() === m;
      const occ = inMonth ? occurrencesOn(ds, { all: true }).filter(x => evMembers(x.ev).some(mm => ids.includes(mm.id))) : [];
      body += `<td class="${!inMonth ? 'other' : (dw === 0 || hol) ? 'sun' : dw === 6 ? 'sat' : ''}"><div class="pc" style="max-height:${(rowH - 0.8).toFixed(2)}mm">
        <div class="cdate"><b>${d.getDate()}</b>${hol && inMonth ? `<span>${esc(hol)}</span>` : ''}</div>
        ${occ.map(x => `<div class="pe">${evMembers(x.ev).filter(mm => ids.includes(mm.id)).map(mm => `<i style="background:${mm.color}"></i>`).join('')}${printEvText(x.ev)}</div>`).join('')}
      </div></td>`;
    }
    body += '</tr>';
  }
  return `<div class="sheet font-${o.font}">
    <div class="sheet-title" style="height:${titleH}mm"><h1>${y}年${m + 1}月</h1><span class="sub">かぞくの予定</span>${sheetLegend(ms)}</div>
    <table class="pcal"><thead><tr style="height:${dowH}mm">${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* =========================================================
   家族でやりたい100のこと
   ========================================================= */
const bucketView = { filter: 'all', cat: '' };
renderers.bucket = function () {
  const list = state.bucket;
  const done = list.filter(b => b.done).length;
  const total = list.length;
  const goal = 100;
  const shown = list.map((b, i) => ({ b, no: i + 1 }))
    .filter(({ b }) => bucketView.filter === 'all' || (bucketView.filter === 'done' ? b.done : !b.done))
    .filter(({ b }) => !bucketView.cat || b.cat === bucketView.cat);
  $('#tab-bucket').innerHTML = `
  <div class="bucket-top">
    <div class="card bucket-hero">
      <div class="ring" style="--p:${Math.min(done / goal, 1) * 100}"><div><b>${done}</b><span>/ ${goal}</span></div></div>
      <div class="hero-text">
        <h2>家族でやりたい100のこと</h2>
        <p>リストに <b>${total}</b> 個（${total >= goal ? '100個そろいました！🎉' : `あと ${goal - total} 個でリスト完成`}）・達成 <b>${done}</b> 個</p>
        <div class="bar"><span style="width:${Math.min(total / goal, 1) * 100}%"></span></div>
        <button class="btn" data-action="bucket-ideas">💡 アイデアから選んで追加</button>
      </div>
    </div>
    <form class="card bucket-add" id="bucket-form" autocomplete="off">
      <h3>やりたいことを追加</h3>
      <input name="title" placeholder="例：家族でキャンプに行く" required maxlength="80">
      <div class="row">
        <label class="field"><span class="lbl">ジャンル</span><select name="cat">${BUCKET_CATS.map(c => `<option>${c}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">言い出しっぺ</span><select name="by">${memberOptions('', { blank: '—' })}</select></label>
      </div>
      <button class="btn primary">追加</button>
    </form>
  </div>
  <div class="filter-row">
    <div class="seg">${[['all', 'すべて'], ['todo', 'これから'], ['done', '達成']].map(([k, v]) => `<button data-action="bucket-filter" data-v="${k}" class="${bucketView.filter === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <select data-bucket-cat><option value="">ジャンル：すべて</option>${BUCKET_CATS.map(c => `<option ${bucketView.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
  </div>
  <ol class="bucket-list">${shown.map(({ b, no }) => {
    const by = memberById(b.by);
    return `<li class="${b.done ? 'done' : ''}">
      <span class="no">${no}</span>
      <button class="check-btn" data-action="bucket-toggle" data-id="${b.id}" aria-label="${b.done ? '未達成に戻す' : '達成にする'}">${b.done ? '✓' : ''}</button>
      <div class="b-body" data-action="bucket-edit" data-id="${b.id}">
        <div class="b-title">${esc(b.title)}</div>
        <div class="b-meta"><span class="tag">${esc(b.cat)}</span>${by ? `<span class="who"><i class="dot" style="background:${by.color}"></i>${esc(by.name)}</span>` : ''}${b.done && b.doneDate ? `<span>🎉 ${b.doneDate.replace(/-/g, '/')} 達成</span>` : ''}</div>
        ${b.memo ? `<div class="b-memo">${esc(b.memo)}</div>` : ''}
      </div>
    </li>`;
  }).join('') || '<p class="empty">まだありません。上のフォームか「アイデアから選んで追加」で登録しましょう。</p>'}</ol>`;
};

function openBucketEdit(id) {
  const b = state.bucket.find(x => x.id === id);
  if (!b) return;
  openDialog(`<form class="dlg-form" id="bucket-edit-form">
    ${dlgHead('やりたいことを編集')}
    <label class="field"><span class="lbl">やりたいこと</span><input name="title" value="${esc(b.title)}" required maxlength="80"></label>
    <div class="row">
      <label class="field"><span class="lbl">ジャンル</span><select name="cat">${BUCKET_CATS.map(c => `<option ${b.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">言い出しっぺ</span><select name="by">${memberOptions(b.by)}</select></label>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" name="done" ${b.done ? 'checked' : ''}> 達成した！</label>
      <label class="field"><span class="lbl">達成日</span><input type="date" name="doneDate" value="${b.doneDate || ''}"></label>
    </div>
    <label class="field"><span class="lbl">思い出・メモ</span><textarea name="memo" rows="3">${esc(b.memo)}</textarea></label>
    <div class="dlg-actions">
      <button type="button" class="btn danger-text" data-action="bucket-delete">削除</button><span class="spacer"></span>
      <button type="button" class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary">保存</button>
    </div></form>`, { type: 'bucket', id });
}

function openBucketIdeas() {
  const have = new Set(state.bucket.map(b => b.title));
  const ideas = BUCKET_IDEAS.filter(([t]) => !have.has(t));
  openDialog(`<form class="dlg-form" id="bucket-ideas-form">
    ${dlgHead('アイデアから選ぶ')}
    <p class="hint">気になるものにチェックして追加してください（あとで編集できます）。</p>
    <div class="idea-list">${ideas.map(([t, c], i) => `<label class="check"><input type="checkbox" name="idea" value="${i}"> ${esc(t)} <span class="tag">${c}</span></label>`).join('') || '<p class="empty">すべて追加済みです</p>'}</div>
    <div class="dlg-actions"><span class="spacer"></span><button type="button" class="btn" data-action="close-dialog">閉じる</button><button class="btn primary">選んだものを追加</button></div>
  </form>`, { type: 'ideas', ideas });
}

/* =========================================================
   家計簿
   ========================================================= */
const bud = { cursor: new Date(), type: 'expense', lastDate: null };
const CAT_COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6', '#7B61FF', '#E91E63', '#795548', '#00897B', '#C0CA33', '#5C6BC0', '#F06292', '#8D6E63', '#26A69A', '#9E9E9E'];

function monthTx(key) { return state.budget.tx.filter(t => t.date.startsWith(key)); }
function sumBy(list, type) { return list.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0); }

renderers.budget = function () {
  const key = ym(bud.cursor), y = bud.cursor.getFullYear(), m = bud.cursor.getMonth();
  const list = monthTx(key);
  const inc = sumBy(list, 'income'), exp = sumBy(list, 'expense');
  const limits = state.budget.limits;
  const byCat = {};
  list.filter(t => t.type === 'expense').forEach(t => { byCat[t.cat] = (byCat[t.cat] || 0) + t.amount; });
  // 予算の残り：予算を設定したカテゴリだけで計算
  const budgeted = Object.keys(limits).filter(c => limits[c] > 0);
  const limitTotal = budgeted.reduce((s, c) => s + limits[c], 0);
  const budgetedSpend = budgeted.reduce((s, c) => s + (byCat[c] || 0), 0);
  const cats = [...new Set([...state.budget.expenseCats, ...Object.keys(byCat)])];
  const maxCat = Math.max(1, ...cats.map(c => Math.max(byCat[c] || 0, limits[c] || 0)));
  const defDate = bud.lastDate && bud.lastDate.startsWith(key) ? bud.lastDate : (ym(new Date()) === key ? todayStr() : `${key}-01`);
  const catList = bud.type === 'income' ? state.budget.incomeCats : state.budget.expenseCats;

  // 日付ごとの明細
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  let txHtml = '', lastD = '';
  for (const t of sorted) {
    if (t.date !== lastD) { txHtml += `<div class="tx-date">${fmtDateJa(t.date)}</div>`; lastD = t.date; }
    const who = memberById(t.who);
    const ci = state.budget.expenseCats.indexOf(t.cat);
    txHtml += `<button class="tx-row" data-action="tx-edit" data-id="${t.id}">
      <span class="tag" style="${t.type === 'expense' ? `background:${tint(CAT_COLORS[(ci < 0 ? 15 : ci) % CAT_COLORS.length], .15)}` : 'background:#e6f4ea;color:#137333'}">${esc(t.cat)}</span>
      <span class="tx-memo">${esc(t.memo || '')}${who ? ` <span class="who"><i class="dot" style="background:${who.color}"></i>${esc(who.name)}</span>` : ''}</span>
      <span class="tx-amt ${t.type}">${t.type === 'income' ? '+' : ''}${yen(t.amount)}</span></button>`;
  }

  // 年間
  let yearRows = '', yi = 0, ye = 0;
  const yearData = [];
  for (let i = 0; i < 12; i++) {
    const l = monthTx(`${y}-${pad(i + 1)}`);
    const a = sumBy(l, 'income'), b = sumBy(l, 'expense');
    yearData.push([a, b]); yi += a; ye += b;
  }
  const yMax = Math.max(1, ...yearData.flat());
  yearData.forEach(([a, b], i) => {
    yearRows += `<tr class="${i === m ? 'cur' : ''}" data-action="bud-goto" data-m="${i}">
      <td>${i + 1}月</td><td class="num inc">${a ? yen(a) : '—'}</td><td class="num exp">${b ? yen(b) : '—'}</td>
      <td class="num ${a - b < 0 ? 'neg' : ''}">${a || b ? yen(a - b) : '—'}</td>
      <td class="ybar"><span class="i" style="width:${a / yMax * 100}%"></span><span class="e" style="width:${b / yMax * 100}%"></span></td></tr>`;
  });

  $('#tab-budget').innerHTML = `
  <div class="page-toolbar">
    <div class="arrows"><button class="icon-btn" data-action="bud-move" data-dir="-1" aria-label="前の月">‹</button><button class="icon-btn" data-action="bud-move" data-dir="1" aria-label="次の月">›</button></div>
    <h2>${y}年${m + 1}月の家計簿</h2>
    <button class="btn" data-action="bud-today">今月</button>
    <span class="spacer"></span>
    <button class="btn" data-action="bud-csv">CSV書き出し</button>
  </div>
  <div class="stats">
    <div class="stat"><span>収入</span><b class="inc">${yen(inc)}</b></div>
    <div class="stat"><span>支出</span><b class="exp">${yen(exp)}</b></div>
    <div class="stat"><span>収支</span><b class="${inc - exp < 0 ? 'neg' : 'pos'}">${yen(inc - exp)}</b></div>
    <div class="stat"><span>予算の残り</span><b class="${limitTotal - budgetedSpend < 0 ? 'neg' : ''}">${limitTotal ? yen(limitTotal - budgetedSpend) : '未設定'}</b>${limitTotal ? `<small>予算 ${yen(limitTotal)} のうち</small>` : ''}</div>
  </div>
  <div class="two-col">
    <div class="col">
      <form class="card" id="tx-form" autocomplete="off">
        <h3>記録する</h3>
        <div class="seg full type-seg">
          <button type="button" data-action="bud-type" data-v="expense" class="${bud.type === 'expense' ? 'on exp' : ''}">支出</button>
          <button type="button" data-action="bud-type" data-v="income" class="${bud.type === 'income' ? 'on inc' : ''}">収入</button>
        </div>
        <div class="row">
          <label class="field"><span class="lbl">日付</span><input type="date" name="date" value="${defDate}" required></label>
          <label class="field"><span class="lbl">金額（円）</span><input name="amount" inputmode="numeric" placeholder="0" required></label>
        </div>
        <div class="row">
          <label class="field"><span class="lbl">カテゴリ</span><select name="cat">${catList.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span class="lbl">だれの</span><select name="who">${memberOptions('')}</select></label>
        </div>
        <label class="field"><span class="lbl">メモ</span><input name="memo" placeholder="例：スーパー、ガソリン"></label>
        <button class="btn primary">追加</button>
      </form>
      <div class="card">
        <h3>カテゴリ別の支出</h3>
        <div class="cat-bars">${cats.filter(c => byCat[c] || limits[c]).map(c => {
          const v = byCat[c] || 0, lim = limits[c] || 0, over = lim && v > lim;
          const color = CAT_COLORS[state.budget.expenseCats.indexOf(c) % CAT_COLORS.length] || '#9E9E9E';
          return `<div class="cat-bar ${over ? 'over' : ''}"><div class="cb-head"><span><i class="dot" style="background:${color}"></i>${esc(c)}</span><span>${yen(v)}${lim ? ` <small>/ ${yen(lim)}</small>` : ''}</span></div>
            <div class="cb-track">${lim ? `<span class="cb-limit" style="left:${lim / maxCat * 100}%"></span>` : ''}<span class="cb-fill" style="width:${v / maxCat * 100}%;background:${over ? 'var(--danger)' : color}"></span></div></div>`;
        }).join('') || '<p class="empty">まだ支出がありません</p>'}</div>
      </div>
    </div>
    <div class="col">
      <div class="card"><h3>明細（${list.length}件）</h3><div class="tx-list">${txHtml || '<p class="empty">この月の記録はありません</p>'}</div></div>
    </div>
  </div>
  <div class="card">
    <h3>${y}年のまとめ</h3>
    <div class="table-scroll"><table class="data year-table"><thead><tr><th>月</th><th class="num">収入</th><th class="num">支出</th><th class="num">収支</th><th class="ybar-h"><span class="lg i">収入</span><span class="lg e">支出</span></th></tr></thead>
    <tbody>${yearRows}</tbody>
    <tfoot><tr><td>合計</td><td class="num inc">${yen(yi)}</td><td class="num exp">${yen(ye)}</td><td class="num ${yi - ye < 0 ? 'neg' : ''}">${yen(yi - ye)}</td><td></td></tr></tfoot></table></div>
  </div>
  <details class="card settings-box">
    <summary>カテゴリと月の予算を設定</summary>
    <form id="bud-settings-form">
      <div class="row">
        <label class="field"><span class="lbl">支出カテゴリ（1行に1つ）</span><textarea name="exp" rows="8">${esc(state.budget.expenseCats.join('\n'))}</textarea></label>
        <label class="field"><span class="lbl">収入カテゴリ（1行に1つ）</span><textarea name="inc" rows="8">${esc(state.budget.incomeCats.join('\n'))}</textarea></label>
      </div>
      <span class="lbl">月の予算（円・空欄は予算なし）</span>
      <div class="limit-grid">${state.budget.expenseCats.map(c => `<label><span>${esc(c)}</span><input name="lim_${esc(c)}" inputmode="numeric" value="${limits[c] || ''}"></label>`).join('')}</div>
      <button class="btn primary">設定を保存</button>
    </form>
  </details>`;
};

function openTxEdit(id) {
  const t = state.budget.tx.find(x => x.id === id);
  if (!t) return;
  const cats = t.type === 'income' ? state.budget.incomeCats : state.budget.expenseCats;
  const catOpts = [...new Set([...cats, t.cat])];
  openDialog(`<form class="dlg-form" id="tx-edit-form">
    ${dlgHead(t.type === 'income' ? '収入を編集' : '支出を編集')}
    <div class="row">
      <label class="field"><span class="lbl">日付</span><input type="date" name="date" value="${t.date}" required></label>
      <label class="field"><span class="lbl">金額（円）</span><input name="amount" inputmode="numeric" value="${t.amount}" required></label>
    </div>
    <div class="row">
      <label class="field"><span class="lbl">カテゴリ</span><select name="cat">${catOpts.map(c => `<option ${c === t.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">だれの</span><select name="who">${memberOptions(t.who)}</select></label>
    </div>
    <label class="field"><span class="lbl">メモ</span><input name="memo" value="${esc(t.memo)}"></label>
    <div class="dlg-actions"><button type="button" class="btn danger-text" data-action="tx-delete">削除</button><span class="spacer"></span>
      <button type="button" class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary">保存</button></div>
  </form>`, { type: 'tx', id });
}

function budgetCsv() {
  const rows = [['日付', '種類', 'カテゴリ', '金額', 'だれの', 'メモ']];
  [...state.budget.tx].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
    rows.push([t.date, t.type === 'income' ? '収入' : '支出', t.cat, t.amount, (memberById(t.who) || {}).name || '', t.memo || '']);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  downloadFile(`家計簿_${todayStr()}.csv`, '﻿' + csv, 'text/csv');
}

/* =========================================================
   株・配当
   ========================================================= */
const stk = { owner: '', year: new Date().getFullYear() };

function holdingCalc(h) {
  const tax = h.account === 'NISA' ? 0 : state.stocks.taxRate;
  const price = h.price || h.cost;
  const value = h.shares * price, cost = h.shares * h.cost;
  const div = h.shares * h.dps;
  return {
    value, cost, pl: value - cost, plPct: cost ? (value - cost) / cost * 100 : 0,
    div, net: div * (1 - tax / 100), yld: price ? h.dps / price * 100 : 0, yoc: h.cost ? h.dps / h.cost * 100 : 0,
  };
}

renderers.stocks = function () {
  const hs = state.stocks.holdings.filter(h => !stk.owner || h.owner === stk.owner);
  const calc = hs.map(h => ({ h, c: holdingCalc(h) }));
  const T = calc.reduce((s, { c }) => ({ value: s.value + c.value, cost: s.cost + c.cost, div: s.div + c.div, net: s.net + c.net }), { value: 0, cost: 0, div: 0, net: 0 });
  // 月別の配当予想（税引後）
  const monthly = Array(12).fill(0);
  calc.forEach(({ h, c }) => { const ms = h.months || []; ms.forEach(mm => { monthly[mm - 1] += c.net / ms.length; }); });
  const mMax = Math.max(1, ...monthly);
  const curM = new Date().getMonth();
  // 受取記録
  const holdIds = new Set(hs.map(h => h.id));
  const recAll = state.stocks.receipts.filter(r => !stk.owner || holdIds.has(r.holdingId));
  const rec = recAll.filter(r => r.date.startsWith(String(stk.year))).sort((a, b) => b.date.localeCompare(a.date));
  const recTotal = rec.reduce((s, r) => s + r.amount, 0);
  const years = {};
  recAll.forEach(r => { const yy = r.date.slice(0, 4); years[yy] = (years[yy] || 0) + r.amount; });
  const owners = state.members.filter(mm => state.stocks.holdings.some(h => h.owner === mm.id));

  $('#tab-stocks').innerHTML = `
  <div class="page-toolbar">
    <h2>個別株・配当</h2>
    ${owners.length ? `<div class="seg"><button data-action="stk-owner" data-v="" class="${!stk.owner ? 'on' : ''}">全員</button>${owners.map(o => `<button data-action="stk-owner" data-v="${o.id}" class="${stk.owner === o.id ? 'on' : ''}">${esc(o.name)}</button>`).join('')}</div>` : ''}
    <span class="spacer"></span>
    <button class="btn" data-action="receipt-new">＋ 配当を記録</button>
    <button class="btn primary" data-action="holding-new">＋ 銘柄を追加</button>
  </div>
  <div class="stats">
    <div class="stat"><span>評価額</span><b>${yen(T.value)}</b></div>
    <div class="stat"><span>含み損益</span><b class="${T.value - T.cost < 0 ? 'neg' : 'pos'}">${T.value - T.cost >= 0 ? '+' : ''}${yen(T.value - T.cost)}</b><small>${T.cost ? pct((T.value - T.cost) / T.cost * 100) : ''}</small></div>
    <div class="stat"><span>年間配当（税引前）</span><b>${yen(T.div)}</b><small>利回り ${pct(T.value ? T.div / T.value * 100 : 0)}</small></div>
    <div class="stat"><span>年間配当（税引後）</span><b class="inc">${yen(T.net)}</b><small>月平均 ${yen(T.net / 12)}</small></div>
  </div>
  <div class="card">
    <h3>保有銘柄（${hs.length}）</h3>
    ${hs.length ? `<div class="table-scroll"><table class="data stock-table">
      <thead><tr><th>コード・銘柄</th><th>口座/名義</th><th class="num">保有数</th><th class="num">取得単価</th><th class="num">現在値</th><th class="num">評価額</th><th class="num">損益</th><th class="num">1株配当</th><th class="num">年間配当</th><th class="num">利回り<br><small>取得時</small></th><th>支払月</th></tr></thead>
      <tbody>${calc.map(({ h, c }) => {
        const ow = memberById(h.owner);
        return `<tr data-action="holding-edit" data-id="${h.id}" class="clickable">
          <td><b>${esc(h.code)}</b> ${esc(h.name)}${h.yutai ? `<div class="yutai">🎁 ${esc(h.yutai)}</div>` : ''}</td>
          <td><span class="tag ${h.account === 'NISA' ? 'nisa' : ''}">${esc(h.account)}</span>${ow ? `<div class="who"><i class="dot" style="background:${ow.color}"></i>${esc(ow.name)}</div>` : ''}</td>
          <td class="num">${fmt(h.shares)}</td><td class="num">${fmt(h.cost, 2)}</td><td class="num">${h.price ? fmt(h.price, 2) : '<span class="muted">未入力</span>'}</td>
          <td class="num">${yen(c.value)}</td><td class="num ${c.pl < 0 ? 'neg' : 'pos'}">${c.pl >= 0 ? '+' : ''}${yen(c.pl)}<br><small>${pct(c.plPct)}</small></td>
          <td class="num">${fmt(h.dps, 2)}</td><td class="num">${yen(c.div)}<br><small>手取 ${yen(c.net)}</small></td>
          <td class="num">${pct(c.yld)}<br><small>${pct(c.yoc)}</small></td>
          <td>${(h.months || []).map(x => x + '月').join('・') || '—'}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="empty">「＋ 銘柄を追加」から保有株を登録すると、評価額・配当予想・利回りを自動で計算します。</p>'}
  </div>
  <div class="two-col">
    <div class="col card">
      <h3>月別の配当予想（税引後）</h3>
      <div class="month-bars">${monthly.map((v, i) => `<div class="mb ${i === curM ? 'cur' : ''}"><span class="mb-val">${v ? fmt(Math.round(v / 100) / 10, 1) + '千' : ''}</span><div class="mb-track"><span style="height:${v / mMax * 100}%"></span></div><span class="mb-lbl">${i + 1}月</span></div>`).join('')}</div>
      <p class="hint">支払月ごとに年間配当を等分した目安です。税率 ${state.stocks.taxRate}%（NISAは非課税）。
        <button class="link-btn" data-action="stk-tax">税率を変更</button></p>
    </div>
    <div class="col card">
      <div class="card-head"><h3>受け取った配当</h3>
        <div class="arrows small"><button class="icon-btn" data-action="stk-year" data-dir="-1" aria-label="前の年">‹</button><b>${stk.year}年</b><button class="icon-btn" data-action="stk-year" data-dir="1" aria-label="次の年">›</button></div></div>
      <div class="recv-sum"><b class="inc">${yen(recTotal)}</b>${T.net ? `<span>予想（税引後）${yen(T.net)} の ${Math.round(recTotal / T.net * 100)}%</span><div class="bar"><span style="width:${Math.min(recTotal / T.net, 1) * 100}%"></span></div>` : ''}</div>
      <div class="tx-list">${rec.map(r => {
        const h = state.stocks.holdings.find(x => x.id === r.holdingId);
        return `<button class="tx-row" data-action="receipt-edit" data-id="${r.id}"><span class="tag">${r.date.slice(5).replace('-', '/')}</span>
          <span class="tx-memo">${h ? `<b>${esc(h.code)}</b> ${esc(h.name)}` : esc(r.name || '（削除した銘柄）')}${r.memo ? ` <span class="muted">${esc(r.memo)}</span>` : ''}</span>
          <span class="tx-amt income">+${yen(r.amount)}</span></button>`;
      }).join('') || '<p class="empty">この年の記録はありません</p>'}</div>
      ${Object.keys(years).length > 1 ? `<div class="year-hist">${Object.entries(years).sort().map(([yy, v]) => `<span>${yy}年 <b>${yen(v)}</b></span>`).join('')}</div>` : ''}
    </div>
  </div>
  <p class="hint">※ 株価は自動取得しません。現在値はときどき手入力で更新してください（銘柄の行をタップ）。</p>`;
};

function openHoldingDialog(id) {
  const h = id ? state.stocks.holdings.find(x => x.id === id) : { code: '', name: '', account: '特定', owner: '', shares: 100, cost: 0, price: 0, dps: 0, months: [], yutai: '', memo: '' };
  if (!h) return;
  openDialog(`<form class="dlg-form" id="holding-form" autocomplete="off">
    ${dlgHead(id ? '銘柄を編集' : '銘柄を追加')}
    <div class="row">
      <label class="field narrow"><span class="lbl">証券コード</span><input name="code" value="${esc(h.code)}" placeholder="7203" maxlength="10" required autofocus></label>
      <label class="field"><span class="lbl">銘柄名</span><input name="name" value="${esc(h.name)}" placeholder="トヨタ自動車" required></label>
    </div>
    <div class="row">
      <label class="field"><span class="lbl">口座</span><select name="account">${['特定', '一般', 'NISA'].map(a => `<option ${h.account === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">名義</span><select name="owner">${memberOptions(h.owner, { includeFamily: false })}</select></label>
    </div>
    <div class="row three">
      <label class="field"><span class="lbl">保有数（株）</span><input name="shares" inputmode="numeric" value="${h.shares || ''}" required></label>
      <label class="field"><span class="lbl">取得単価（円）</span><input name="cost" inputmode="decimal" value="${h.cost || ''}" required></label>
      <label class="field"><span class="lbl">現在値（円）</span><input name="price" inputmode="decimal" value="${h.price || ''}" placeholder="任意"></label>
    </div>
    <label class="field"><span class="lbl">1株あたり年間配当（円・予想）</span><input name="dps" inputmode="decimal" value="${h.dps || ''}" placeholder="例：90"></label>
    <div class="field"><span class="lbl">配当の支払月</span>
      <div class="month-pick">${[...Array(12)].map((_, i) => `<label><input type="checkbox" name="months" value="${i + 1}" ${(h.months || []).includes(i + 1) ? 'checked' : ''}><span>${i + 1}月</span></label>`).join('')}</div></div>
    <label class="field"><span class="lbl">株主優待</span><input name="yutai" value="${esc(h.yutai)}" placeholder="例：QUOカード1,000円（3月）"></label>
    <label class="field"><span class="lbl">メモ</span><input name="memo" value="${esc(h.memo)}"></label>
    <div class="dlg-actions">${id ? '<button type="button" class="btn danger-text" data-action="holding-delete">削除</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary">保存</button></div>
  </form>`, { type: 'holding', id });
}

function openReceiptDialog(id) {
  const r = id ? state.stocks.receipts.find(x => x.id === id) : { date: todayStr(), holdingId: '', amount: '', memo: '' };
  if (!r) return;
  const hs = state.stocks.holdings;
  if (!id && !hs.length) { toast('先に銘柄を追加してください'); return; }
  openDialog(`<form class="dlg-form" id="receipt-form" autocomplete="off">
    ${dlgHead(id ? '配当の記録を編集' : '配当を記録')}
    <label class="field"><span class="lbl">銘柄</span><select name="holdingId" required>${hs.map(h => `<option value="${h.id}" ${h.id === r.holdingId ? 'selected' : ''}>${esc(h.code)} ${esc(h.name)}</option>`).join('')}</select></label>
    <div class="row">
      <label class="field"><span class="lbl">受取日</span><input type="date" name="date" value="${r.date}" required></label>
      <label class="field"><span class="lbl">受取額（税引後・円）</span><input name="amount" inputmode="numeric" value="${r.amount}" required autofocus></label>
    </div>
    <label class="field"><span class="lbl">メモ</span><input name="memo" value="${esc(r.memo)}" placeholder="例：中間配当"></label>
    ${id ? (r.txId ? '<p class="hint">家計簿の収入（配当）と連動しています。</p>' : '') : '<label class="check"><input type="checkbox" name="toBudget" checked> 家計簿の収入（配当）にも記録する</label>'}
    <div class="dlg-actions">${id ? '<button type="button" class="btn danger-text" data-action="receipt-delete">削除</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary">保存</button></div>
  </form>`, { type: 'receipt', id });
}

/* =========================================================
   家族・設定
   ========================================================= */
renderers.settings = function () {
  $('#tab-settings').innerHTML = `
  ${window.Sync ? Sync.panel() : ''}
  ${installCardHtml()}
  <div class="card">
    <h3>家族メンバーと色</h3>
    <p class="hint">「家族みんな」は家族全体の予定用です（削除できません）。色はカレンダーや印刷に使われます。</p>
    <div class="member-rows">${state.members.map((m, i) => `<div class="member-row" style="--c:${m.color}">
      <span class="sw big"></span>
      <input class="m-name" data-mfield="name" data-id="${m.id}" value="${esc(m.name)}" aria-label="名前" maxlength="20">
      <select data-mfield="role" data-id="${m.id}" ${m.id === FAMILY_ID ? 'disabled' : ''} aria-label="続柄">${Object.entries(ROLES).filter(([k]) => (k === 'family') === (m.id === FAMILY_ID)).map(([k, v]) => `<option value="${k}" ${m.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div class="palette">${PALETTE.map(([c, n]) => `<button class="pal ${c.toLowerCase() === m.color.toLowerCase() ? 'on' : ''}" style="background:${c}" data-action="member-color" data-id="${m.id}" data-c="${c}" title="${n}" aria-label="${n}"></button>`).join('')}
        <input type="color" data-mfield="color" data-id="${m.id}" value="${m.color}" aria-label="好きな色"></div>
      <div class="m-actions">
        <button class="icon-btn" data-action="member-move" data-id="${m.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
        <button class="icon-btn" data-action="member-move" data-id="${m.id}" data-dir="1" ${i === state.members.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
        ${m.id === FAMILY_ID ? '<span class="icon-btn ghost"></span>' : `<button class="icon-btn danger-text" data-action="member-delete" data-id="${m.id}" aria-label="削除">🗑</button>`}
      </div>
    </div>`).join('')}</div>
    <div class="btn-row">
      <button class="btn" data-action="member-add" data-role="child">＋ 子どもを追加</button>
      <button class="btn" data-action="member-add" data-role="other">＋ そのほかの人を追加</button>
    </div>
  </div>
  <div class="card">
    <h3>カレンダー</h3>
    <label class="field inline"><span class="lbl">週のはじまり</span>
      <select data-setting="weekStart"><option value="0" ${state.settings.weekStart === 0 ? 'selected' : ''}>日曜日</option><option value="1" ${state.settings.weekStart === 1 ? 'selected' : ''}>月曜日</option></select></label>
  </div>
  <div class="card">
    <h3>データ</h3>
    <p class="hint">${window.Sync && Sync.isConnected()
      ? '家族で同期中です。データはクラウドと各スマホに保存されています。念のため、ときどきバックアップを書き出しておくと安心です。'
      : 'データはこの端末のブラウザの中に保存されます（上の「家族で同期」を設定すると、夫婦のスマホで自動的に共有されます）。ブラウザの履歴・サイトデータを消すとデータも消えるので、ときどきバックアップしてください。'}</p>
    <div class="btn-row">
      <button class="btn primary" data-action="data-export">バックアップを書き出す</button>
      <label class="btn">バックアップを読み込む<input type="file" accept="application/json,.json" data-action-change="data-import" hidden></label>
      <button class="btn" data-action="data-sample">お試しデータを入れる</button>
      <button class="btn danger-text" data-action="data-reset">すべて削除</button>
    </div>
  </div>`;
};

/* ---------- アプリとしてインストール（PWA） ---------- */
let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (currentTab === 'settings') render(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('ホーム画面に追加しました'); if (currentTab === 'settings') render(); });

function installCardHtml() {
  if (isStandalone()) return '';
  let body;
  if (installPrompt) body = '<button class="btn primary" data-action="app-install">📲 ホーム画面に追加する</button>';
  else if (isIOS()) body = '<ol class="mini-steps"><li>Safariでこのページを開く</li><li>画面下の共有ボタン（□に↑）をタップ</li><li>「ホーム画面に追加」→「追加」</li></ol>';
  else body = '<p class="hint">ブラウザのメニュー（︙）から「アプリをインストール」または「ホーム画面に追加」を選んでください。</p>';
  return `<div class="card"><h3>📲 アプリとして使う</h3><p class="hint">ホーム画面に追加すると、アイコンから全画面のアプリとして開けます。オフラインでも見られます。</p>${body}</div>`;
}

function addSampleData() {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  const d = n => ymd(new Date(y, m, n));
  const ids = state.members.map(x => x.id);
  const h = ids[1] || FAMILY_ID, w = ids[2] || FAMILY_ID, c = ids[3] || FAMILY_ID;
  const ev = (o) => state.events.push({ id: uid(), exdates: [], endDate: '', allDay: false, start: '', end: '', repeat: 'none', until: '', memo: '', ...o });
  ev({ title: 'ゴミ出し（燃えるゴミ）', date: d(1), allDay: true, members: [FAMILY_ID], repeat: 'weekly' });
  ev({ title: 'スイミング', date: d(2), start: '16:30', end: '17:30', members: [c], repeat: 'weekly' });
  ev({ title: 'ピアノ', date: d(4), start: '17:00', end: '17:45', members: [c], repeat: 'weekly' });
  ev({ title: '出張（大阪）', date: d(8), endDate: d(9), allDay: true, members: [h] });
  ev({ title: '美容院', date: d(11), start: '10:00', end: '11:30', members: [w] });
  ev({ title: '運動会', date: d(14), start: '08:30', end: '15:00', members: [FAMILY_ID, c] });
  ev({ title: '保護者会', date: d(17), start: '14:00', end: '15:00', members: [w] });
  ev({ title: '飲み会', date: d(17), start: '19:00', members: [h] });
  ev({ title: '歯医者', date: d(20), start: '15:30', end: '16:00', members: [c, w] });
  ev({ title: '家族でキャンプ', date: d(24), endDate: d(25), allDay: true, members: [FAMILY_ID] });
  ev({ title: '給料日', date: d(25), allDay: true, members: [h], repeat: 'monthly' });
  const tx = (date, type, cat, amount, memo, who = '') => state.budget.tx.push({ id: uid(), date, type, cat, amount, memo, who, created: Date.now() });
  tx(d(1), 'expense', '住居', 85000, '家賃'); tx(d(3), 'expense', '食費', 6280, 'スーパー'); tx(d(5), 'expense', '習い事', 7700, 'スイミング月謝', c);
  tx(d(7), 'expense', '水道光熱', 11200, '電気代'); tx(d(9), 'expense', '食費', 4510, 'スーパー'); tx(d(10), 'expense', '日用品', 2380, 'ドラッグストア');
  tx(d(12), 'expense', '通信', 6800, 'スマホ2台'); tx(d(14), 'expense', '娯楽', 3200, '運動会のお弁当材料');
  tx(d(25), 'income', '給与', 320000, '', h); tx(d(25), 'income', '給与', 120000, 'パート', w);
  state.budget.limits = { 食費: 60000, 日用品: 10000, 娯楽: 15000, ...state.budget.limits };
  const hold = (o) => { const x = { id: uid(), account: '特定', owner: h, yutai: '', memo: '', ...o }; state.stocks.holdings.push(x); return x; };
  const h1 = hold({ code: '8306', name: '三菱UFJフィナンシャル・グループ', shares: 200, cost: 1250, price: 1980, dps: 64, months: [6, 12], account: 'NISA' });
  hold({ code: '9433', name: 'KDDI', shares: 100, cost: 2300, price: 2550, dps: 78, months: [6, 12], yutai: 'カタログギフト（3月）' });
  hold({ code: '8058', name: '三菱商事', shares: 100, cost: 2600, price: 3100, dps: 110, months: [6, 12], owner: w });
  hold({ code: '2914', name: '日本たばこ産業', shares: 100, cost: 3900, price: 4400, dps: 194, months: [3, 9], owner: w, account: 'NISA' });
  state.stocks.receipts.push({ id: uid(), date: `${y}-06-20`, holdingId: h1.id, amount: 6400, memo: '期末配当' });
  if (!state.bucket.length) {
    BUCKET_IDEAS.slice(0, 12).forEach(([title, cat], i) => state.bucket.push({ id: uid(), title, cat, by: ids[1 + (i % 3)] || '', done: i % 4 === 0, doneDate: i % 4 === 0 ? d(1) : '', memo: '' }));
  }
  save();
}

/* =========================================================
   イベント処理
   ========================================================= */
const actions = {
  'close-dialog': () => closeDialog(),
  'go-settings': () => { switchTab('settings'); window.scrollTo(0, 0); },

  // カレンダー
  'cal-today': () => { cal.cursor = new Date(); render(); },
  'cal-move': t => {
    const dir = +t.dataset.dir;
    cal.cursor = state.settings.calView === 'week' ? addDays(cal.cursor, 7 * dir) : addMonths(cal.cursor, dir);
    render();
  },
  'cal-view': t => { state.settings.calView = t.dataset.view; save(); render(); },
  'toggle-member': t => {
    const id = t.dataset.id, h = state.settings.hidden;
    state.settings.hidden = h.includes(id) ? h.filter(x => x !== id) : [...h, id];
    save(); render();
  },
  'cell-click': t => window.innerWidth < 700 ? openDayDialog(t.dataset.date) : openEventDialog({ date: t.dataset.date }),
  'new-event': t => openEventDialog({ date: t.dataset.date || (currentTab === 'calendar' && state.settings.calView !== 'week' && ym(cal.cursor) !== ym(new Date()) ? ymd(new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), 1)) : todayStr()) }),
  'new-event-at': (t, e) => {
    const rect = t.getBoundingClientRect();
    const h = Math.max(0, Math.min(23, Math.floor((e.clientY - rect.top) / HOUR_H)));
    openEventDialog({ date: t.dataset.date, start: `${pad(h)}:00`, end: `${pad(Math.min(h + 1, 23))}:${h === 23 ? '59' : '00'}` });
  },
  'open-day': t => openDayDialog(t.dataset.date),
  'edit-event': t => { const ev = state.events.find(x => x.id === t.dataset.id); if (ev) openEventDialog({ ev, occ: t.dataset.occ }); },
  'delete-event': () => deleteEvent(),

  // 印刷
  'pr-set': t => {
    const o = printOpts();
    o[t.dataset.k] = t.dataset.v;
    if (t.dataset.k === 'layout') o.orient = t.dataset.v === 'calendar' ? 'landscape' : 'portrait';
    save(); render();
  },
  'do-print': () => { applyPageStyle(); const p = $('#paper'); if (p) p.style.zoom = 1; window.print(); setTimeout(fitPaper, 300); },

  // やりたい100
  'bucket-filter': t => { bucketView.filter = t.dataset.v; render(); },
  'bucket-toggle': t => {
    const b = state.bucket.find(x => x.id === t.dataset.id);
    if (!b) return;
    b.done = !b.done;
    b.doneDate = b.done ? (b.doneDate || todayStr()) : '';
    save(); render();
    if (b.done) toast('🎉 達成おめでとう！ タップして思い出を書き残せます');
  },
  'bucket-edit': t => openBucketEdit(t.dataset.id),
  'bucket-ideas': () => openBucketIdeas(),
  'bucket-delete': async () => {
    const b = state.bucket.find(x => x.id === dlgCtx.id);
    if (goneRecord(b) || !(await confirmYes(`「${b.title}」を削除しますか？`))) return;
    state.bucket = state.bucket.filter(x => x !== b);
    save(); closeDialog(); render();
  },

  // 家計簿
  'bud-move': t => { bud.cursor = addMonths(bud.cursor, +t.dataset.dir); render(); },
  'bud-today': () => { bud.cursor = new Date(); render(); },
  'bud-goto': t => { bud.cursor = new Date(bud.cursor.getFullYear(), +t.dataset.m, 1); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'bud-type': t => {
    bud.type = t.dataset.v;
    const f = $('#tx-form');
    $$('.type-seg button', f).forEach(b => { b.className = b.dataset.v === bud.type ? `on ${bud.type === 'income' ? 'inc' : 'exp'}` : ''; });
    const cats = bud.type === 'income' ? state.budget.incomeCats : state.budget.expenseCats;
    f.cat.innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join('');
  },
  'bud-csv': () => budgetCsv(),
  'tx-edit': t => openTxEdit(t.dataset.id),
  'tx-delete': async () => {
    if (!(await confirmYes('この記録を削除しますか？'))) return;
    const id = dlgCtx.id;
    state.budget.tx = state.budget.tx.filter(x => x.id !== id);
    state.stocks.receipts.forEach(r => { if (r.txId === id) delete r.txId; });
    save(); closeDialog(); render();
  },

  // 株
  'stk-owner': t => { stk.owner = t.dataset.v; render(); },
  'stk-year': t => { stk.year += +t.dataset.dir; render(); },
  'stk-tax': async () => {
    openDialog(`<form class="dlg-form" id="tax-form">${dlgHead('配当の税率')}
      <label class="field"><span class="lbl">税率（%）</span><input name="tax" inputmode="decimal" value="${state.stocks.taxRate}"></label>
      <p class="hint">日本の上場株の配当（申告不要）は 20.315%（所得税15%＋復興特別所得税0.315%＋住民税5%）。NISA口座は非課税で計算します。</p>
      <div class="dlg-actions"><span class="spacer"></span><button type="button" class="btn" data-action="close-dialog">キャンセル</button><button class="btn primary">保存</button></div></form>`, { type: 'tax' });
  },
  'holding-new': () => openHoldingDialog(null),
  'holding-edit': t => openHoldingDialog(t.dataset.id),
  'holding-delete': async () => {
    const h = state.stocks.holdings.find(x => x.id === dlgCtx.id);
    if (goneRecord(h) || !(await confirmYes(`「${h.name}」を削除しますか？\n（受け取った配当の記録は残ります）`))) return;
    state.stocks.receipts.forEach(r => { if (r.holdingId === h.id) r.name = `${h.code} ${h.name}`; });
    state.stocks.holdings = state.stocks.holdings.filter(x => x !== h);
    save(); closeDialog(); render();
  },
  'receipt-new': () => openReceiptDialog(null),
  'receipt-edit': t => openReceiptDialog(t.dataset.id),
  'receipt-delete': async () => {
    const r = state.stocks.receipts.find(x => x.id === dlgCtx.id);
    if (goneRecord(r) || !(await confirmYes(r.txId ? 'この配当の記録を削除しますか？\n（家計簿の収入からも削除されます）' : 'この配当の記録を削除しますか？'))) return;
    state.stocks.receipts = state.stocks.receipts.filter(x => x !== r);
    if (r.txId) state.budget.tx = state.budget.tx.filter(x => x.id !== r.txId);
    save(); closeDialog(); render();
  },

  // 設定
  'member-color': t => { const m = memberById(t.dataset.id); if (!m) return; m.color = t.dataset.c; save(); render(); },
  'member-move': t => {
    const i = state.members.findIndex(m => m.id === t.dataset.id), j = i + +t.dataset.dir;
    if (j < 0 || j >= state.members.length) return;
    [state.members[i], state.members[j]] = [state.members[j], state.members[i]];
    save(); render();
  },
  'member-add': t => {
    const role = t.dataset.role;
    const n = state.members.filter(m => m.role === role).length + 1;
    const used = new Set(state.members.map(m => m.color));
    const color = (PALETTE.find(([c]) => !used.has(c)) || PALETTE[0])[0];
    state.members.push({ id: 'm_' + uid(), name: role === 'child' ? `子ども${n}` : `メンバー${n}`, role, color });
    save(); render();
    const inputs = $$('.m-name'); const last = inputs[inputs.length - 1]; if (last) { last.focus(); last.select(); }
  },
  'member-delete': async t => {
    const m = memberById(t.dataset.id);
    const cnt = state.events.filter(e => (e.members || []).includes(m.id)).length;
    if (!(await confirmYes(`「${m.name}」を削除しますか？${cnt ? `\nこの人の予定 ${cnt} 件は、ほかに参加者がいなければ「家族みんな」の予定になります。` : ''}`))) return;
    state.members = state.members.filter(x => x !== m);
    state.events.forEach(e => { e.members = (e.members || []).filter(id => id !== m.id); if (!e.members.length) e.members = [FAMILY_ID]; });
    state.budget.tx.forEach(x => { if (x.who === m.id) x.who = ''; });
    state.stocks.holdings.forEach(x => { if (x.owner === m.id) x.owner = ''; });
    state.bucket.forEach(x => { if (x.by === m.id) x.by = ''; });
    state.settings.hidden = state.settings.hidden.filter(x => x !== m.id);
    const po = printOpts(); if (po.members) po.members = po.members.filter(x => x !== m.id);
    save(); render();
  },
  'app-install': async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    render();
  },
  'data-export': () => { downloadFile(`かぞく手帳_バックアップ_${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json'); toast('バックアップを書き出しました'); },
  'data-sample': async () => {
    if (!(await choose('今月のお試し予定・家計簿・株のデータを追加します。よろしいですか？', [{ label: 'キャンセル', value: false }, { label: '追加する', value: true, cls: 'primary' }]))) return;
    addSampleData(); toast('お試しデータを追加しました'); switchTab('calendar');
  },
  'data-reset': async () => {
    const shared = window.Sync && Sync.isConnected() ? '\n※ 家族で同期中のため、家族全員のスマホからも削除されます。' : '';
    if (!(await confirmYes('すべてのデータ（予定・家計簿・株・やりたいこと・家族設定）を削除します。元に戻せません。' + shared, 'すべて削除'))) return;
    state = { ...defaultState(), settings: state.settings }; save(); render(); toast('削除しました');
  },
};

document.addEventListener('click', e => {
  const tab = e.target.closest('.tabs button');
  if (tab) { switchTab(tab.dataset.tab); return; }
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const fn = actions[t.dataset.action];
  if (fn) { e.preventDefault(); fn(t, e); }
});

// ダイアログの外側クリックで閉じる
$('#dlg').addEventListener('click', e => { if (e.target === e.currentTarget) closeDialog(); });
$('#dlg').addEventListener('close', () => { dlgCtx = null; });

document.addEventListener('change', e => {
  const t = e.target;
  // 予定フォーム
  if (t.form && t.form.id === 'event-form') {
    if (t.name === 'allDay') t.form.querySelector('.time-row').hidden = t.checked;
    if (t.name === 'repeat') t.form.querySelector('.until-field').hidden = t.value === 'none';
    if (t.name === 'date' && t.form.endDate.value && t.form.endDate.value < t.value) t.form.endDate.value = '';
    if (t.name === 'start' && t.form.end.value && t.form.end.value <= t.value) {
      const m = toMin(t.value) + 60;
      t.form.end.value = m < 24 * 60 ? `${pad(Math.floor(m / 60))}:${pad(m % 60)}` : '';
    }
    return;
  }
  // 印刷オプション
  if (t.dataset.pr) {
    const o = printOpts();
    if (t.dataset.pr === 'member') {
      const ids = $$('[data-pr="member"]').filter(x => x.checked).map(x => x.value);
      o.members = ids.length === state.members.length ? null : ids;
    } else if (t.dataset.pr === 'memo') o.memo = t.checked;
    else if (t.dataset.pr === 'month') { if (t.value) o.month = t.value; }
    else o[t.dataset.pr] = t.value;
    save(); render();
    return;
  }
  if (t.matches('[data-bucket-cat]')) { bucketView.cat = t.value; render(); return; }
  if (t.dataset.mfield) {
    const m = memberById(t.dataset.id);
    if (!m) return;
    const v = t.value.trim();
    if (t.dataset.mfield === 'name') { if (!v) { t.value = m.name; return; } m.name = v; }
    else m[t.dataset.mfield] = v;
    save();
    if (t.dataset.mfield !== 'name') render();
    return;
  }
  if (t.dataset.setting === 'weekStart') { state.settings.weekStart = +t.value; save(); return; }
  if (t.dataset.actionChange === 'data-import') {
    const file = t.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.members)) throw new Error('format');
        if (!(await choose('バックアップを読み込むと、今のデータは置き換わります。' + (window.Sync && Sync.isConnected() ? '\n※ 家族で同期中のため、家族全員のデータが置き換わります。' : '') + 'よろしいですか？', [{ label: 'キャンセル', value: false }, { label: '読み込む', value: true, cls: 'primary' }]))) return;
        state = mergeState(defaultState(), { ...data, settings: state.settings });
        save(); render(); toast('読み込みました');
      } catch (err) { toast('読み込めませんでした（かぞく手帳のバックアップファイルを選んでください）'); }
      finally { t.value = ''; }
    };
    reader.readAsText(file);
  }
});

/** 相手のスマホで削除された記録を編集しようとしたとき */
function goneRecord(rec) {
  if (rec) return false;
  closeDialog(); render();
  toast('この記録はほかの家族によって削除されました');
  return true;
}

document.addEventListener('submit', e => {
  const f = e.target;
  e.preventDefault();
  const fd = new FormData(f);
  switch (f.id) {
    case 'event-form': saveEventForm(f); break;
    case 'bucket-form': {
      const title = (fd.get('title') || '').trim();
      if (!title) return;
      state.bucket.push({ id: uid(), title, cat: fd.get('cat'), by: fd.get('by') || '', done: false, doneDate: '', memo: '' });
      save(); render(); toast(`${state.bucket.length}個目を追加しました`);
      const inp = $('#bucket-form input[name="title"]'); if (inp) inp.focus();
      break;
    }
    case 'bucket-edit-form': {
      const b = state.bucket.find(x => x.id === dlgCtx.id);
      if (goneRecord(b)) return;
      const done = !!fd.get('done');
      Object.assign(b, { title: fd.get('title').trim() || b.title, cat: fd.get('cat'), by: fd.get('by') || '', done, doneDate: done ? (fd.get('doneDate') || todayStr()) : '', memo: fd.get('memo').trim() });
      save(); closeDialog(); render();
      break;
    }
    case 'bucket-ideas-form': {
      const picked = fd.getAll('idea').map(i => dlgCtx.ideas[+i]);
      picked.forEach(([title, cat]) => state.bucket.push({ id: uid(), title, cat, by: '', done: false, doneDate: '', memo: '' }));
      save(); closeDialog(); render();
      if (picked.length) toast(`${picked.length}個追加しました`);
      break;
    }
    case 'tx-form': {
      const amount = Math.round(num(fd.get('amount')));
      if (amount <= 0) { toast('金額を入力してください'); return; }
      const date = fd.get('date');
      state.budget.tx.push({ id: uid(), date, type: bud.type, cat: fd.get('cat'), amount, who: fd.get('who') || '', memo: fd.get('memo').trim(), created: Date.now() });
      bud.lastDate = date;
      if (!date.startsWith(ym(bud.cursor))) bud.cursor = parseYmd(date);
      save(); render(); toast('記録しました');
      const a = $('#tx-form input[name="amount"]'); if (a && window.innerWidth > 700) a.focus();
      break;
    }
    case 'tx-edit-form': {
      const t = state.budget.tx.find(x => x.id === dlgCtx.id);
      if (goneRecord(t)) return;
      const amount = Math.round(num(fd.get('amount')));
      if (amount <= 0) { toast('金額を入力してください'); return; }
      Object.assign(t, { date: fd.get('date'), amount, cat: fd.get('cat'), who: fd.get('who') || '', memo: fd.get('memo').trim() });
      save(); closeDialog(); render();
      break;
    }
    case 'bud-settings-form': {
      const lines = s => [...new Set(String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean))];
      const exp = lines(fd.get('exp')), inc = lines(fd.get('inc'));
      if (!exp.length || !inc.length) { toast('カテゴリを1つ以上入力してください'); return; }
      const limits = {};
      for (const [k, v] of fd.entries()) if (k.startsWith('lim_') && num(v) > 0) limits[k.slice(4)] = Math.round(num(v));
      state.budget.expenseCats = exp; state.budget.incomeCats = inc; state.budget.limits = limits;
      save(); render(); toast('設定を保存しました');
      break;
    }
    case 'holding-form': {
      const data = {
        code: fd.get('code').trim(), name: fd.get('name').trim(), account: fd.get('account'), owner: fd.get('owner') || '',
        shares: num(fd.get('shares')), cost: num(fd.get('cost')), price: num(fd.get('price')), dps: num(fd.get('dps')),
        months: fd.getAll('months').map(Number), yutai: fd.get('yutai').trim(), memo: fd.get('memo').trim(),
      };
      if (data.shares <= 0) { toast('保有数を入力してください'); return; }
      if (dlgCtx.id) {
        const h = state.stocks.holdings.find(x => x.id === dlgCtx.id);
        if (goneRecord(h)) return;
        Object.assign(h, data);
      }
      else state.stocks.holdings.push({ id: uid(), ...data });
      save(); closeDialog(); render(); toast('保存しました');
      break;
    }
    case 'receipt-form': {
      const amount = Math.round(num(fd.get('amount')));
      if (amount <= 0) { toast('受取額を入力してください'); return; }
      const h = state.stocks.holdings.find(x => x.id === fd.get('holdingId'));
      const data = { date: fd.get('date'), holdingId: fd.get('holdingId'), amount, memo: fd.get('memo').trim() };
      let r;
      if (dlgCtx.id) { r = state.stocks.receipts.find(x => x.id === dlgCtx.id); if (goneRecord(r)) return; Object.assign(r, data); }
      else { r = { id: uid(), ...data }; state.stocks.receipts.push(r); }
      const memo = h ? `${h.code} ${h.name} 配当` : '配当';
      if (!dlgCtx.id && fd.get('toBudget')) {
        if (!state.budget.incomeCats.includes('配当')) state.budget.incomeCats.push('配当');
        const tx = { id: uid(), date: r.date, type: 'income', cat: '配当', amount, who: h ? h.owner : '', memo, created: Date.now() };
        state.budget.tx.push(tx);
        r.txId = tx.id;
      } else if (r.txId) {
        const tx = state.budget.tx.find(x => x.id === r.txId);
        if (tx) Object.assign(tx, { date: r.date, amount, memo, who: h ? h.owner : tx.who });
      }
      stk.year = +r.date.slice(0, 4);
      save(); closeDialog(); render(); toast('配当を記録しました');
      break;
    }
    case 'tax-form': {
      const v = num(fd.get('tax'));
      if (v < 0 || v > 100) { toast('0〜100の数字で入力してください'); return; }
      state.stocks.taxRate = v; save(); closeDialog(); render();
      break;
    }
    default:
      if (window.Sync) Sync.onSubmit(f, fd, e.submitter);
  }
});

window.addEventListener('beforeprint', () => {
  // どのタブから印刷しても、印刷用シートを出す
  if (currentTab !== 'print') renderers.print();
  const p = $('#paper'); if (p) p.style.zoom = 1;
});
window.addEventListener('afterprint', () => { if (currentTab !== 'print') $('#tab-print').innerHTML = ''; else fitPaper(); });
window.addEventListener('resize', () => { if (currentTab === 'print') fitPaper(); });

// 日付が変わったら「今日」表示を更新
let lastDay = todayStr();
setInterval(() => { if (todayStr() !== lastDay) { lastDay = todayStr(); if (currentTab === 'calendar') render(); } }, 60000);

switchTab(currentTab);

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
}
