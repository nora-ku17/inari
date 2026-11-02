'use strict';
// バレットジャーナル 叩き台。データは localStorage に保存(端末内のみ)。
const SYM = { task: '•', event: '○', note: '–' };
const STATUS_SYM = { done: '×', migrated: '>', scheduled: '<', cancelled: '•' };
const $ = (s, r = document) => r.querySelector(s);
const GENRE_SYMBOLS = BujoStorage.SYMBOLS;
const PREFS = BujoStorage.PREFS;
const ABROAD = BujoStorage.ABROAD;
const GENRE_COLORS = ['#3b6ea8', '#d9822b', '#4a7c59', '#8e5ba8', '#c0562b', '#b8962e', '#2f8f9d', '#c2517a'];

let db = BujoStorage.empty();
let state = { tab: 'daily', date: today(), month: today().slice(0, 7), week: weekStartOf(today()) };

function save() { BujoStorage.save(db); if (window.Sync) Sync.schedulePush(); }
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3000);
}
window.toast = toast;
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function today() { return ymd(new Date()); }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function addMonths(m, n) { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function daysIn(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const fmtDate = s => { const d = parseYmd(s); return `${d.getMonth() + 1}月${d.getDate()}日(${DOW[d.getDay()]})`; };
const fmtMonth = m => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;

// ---- ラピッドログ入力: 先頭記号で種別/優先を指定 ("- メモ" "o 予定" "* 重要なタスク") ----
function parseRapid(raw, defType) {
  let t = raw.trim(), type = defType, priority = false;
  const m = t.match(/^([-–oO○•*★])\s+(.*)$/);
  if (m) {
    const c = m[1];
    if (c === '-' || c === '–') type = 'note';
    else if (c === 'o' || c === 'O' || c === '○') type = 'event';
    else if (c === '•') type = 'task';
    else priority = true;
    t = m[2];
  }
  return { type, priority, text: t.trim() };
}
// 予定が、その日にかかっているか(開始日〜終了日)
// 週の始まり(日曜)。マンスリーのカレンダーと同じ並びにそろえる
function weekStartOf(ds) { return addDays(ds, -parseYmd(ds).getDay()); }
const REF_LABEL = { wishes: 'やりたい', shop: '買いたい', places: '行きたい' };
const refSource = e => e.ref && db[e.ref.list] && db[e.ref.list].find(x => x.id === e.ref.id);
// 「やりたい/買いたい/行きたい」から反映した項目は、元の項目の完了状態に合わせて表示する
function withRef(e) {
  const src = refSource(e);
  return src && (e.status === 'open' || e.status === 'done') ? { ...e, status: (src.done || src.bought) ? 'done' : 'open' } : e;
}
const covers = (e, ds) => !!e.date && e.date <= ds && ds <= (e.endDate || e.date);
const shortDate = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`;
const rangeLabel = e => (e.endDate ? `${shortDate(e.date)}〜${shortDate(e.endDate)}` : (e.planned || e.week) && e.date ? shortDate(e.date) : '');
const genreOf = e => e.g && db.genres.find(g => g.id === e.g);
const genreSelect = (name = 'g', cur = '') => `<select name="${name}" aria-label="ジャンル"><option value="">ジャンルなし</option>${db.genres.map(g => `<option value="${g.id}"${g.id === cur ? ' selected' : ''}>${g.symbol} ${esc(g.name)}</option>`).join('')}</select>`;
const prefOptions = cur => `<option value="">県を選ぶ</option>${PREFS.concat(ABROAD).map(p => `<option${p === cur ? ' selected' : ''}>${p}</option>`).join('')}`;
function entrySym(e) {
  if (e.type === 'task') return STATUS_SYM[e.status] || SYM.task;
  const g = genreOf(e);
  return e.type === 'event' && g ? g.symbol : SYM[e.type];
}
const symStyle = e => { const g = genreOf(e); return g ? ` style="color:${g.color}"` : ''; };
const tagHtml = e => { const g = genreOf(e); return g ? ` <span class="tag" style="background:${g.color}">${esc(g.name)}</span>` : ''; };
function addEntry(fields) {
  db.entries.push({ id: uid(), status: 'open', priority: false, date: null, month: null, created: Date.now(), ...fields });
  save();
}
const find = id => db.entries.find(e => e.id === id);

// ---- 共通: 1行の描画 ----
function rowHtml(e, opts = {}) {
  e = withRef(e);
  const closed = e.status !== 'open';
  const acts = [];
  if (e.type === 'task' && !closed) {
    if (opts.migrate) acts.push(`<button data-act="${opts.migrate.act}" data-id="${e.id}">${opts.migrate.label}</button>`);
    acts.push(`<button data-act="future" data-id="${e.id}" title="未来へ">&lt;未来</button>`);
  }
  if (!closed) acts.push(`<button data-act="cancel" data-id="${e.id}" title="不要になった">取消</button>`);
  acts.push(`<button data-act="edit" data-id="${e.id}">編集</button>`);
  acts.push(`<button data-act="del" data-id="${e.id}" title="削除">削除</button>`);
  const range = rangeLabel(e);
  return `<li class="st-${e.status}${e.priority ? ' pri' : ''}">
    <button class="sym" data-act="toggle" data-id="${e.id}" aria-label="完了切替"${symStyle(e)}>${entrySym(e)}</button>
    <span class="txt">${range ? `<span class="hint">${range}</span> ` : ''}${esc(e.text)}${tagHtml(e)}${e.ref ? ` <span class="tag" style="background:var(--sub)">${REF_LABEL[e.ref.list]}</span>` : ''}</span><span class="acts">${acts.join('')}</span></li>`;
}
function listHtml(arr, opts) {
  const byDate = opts && opts.byDate;    // 日付順(日付なしは最後)
  const sorted = [...arr].sort(byDate
    ? (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.created - b.created
    : (a, b) => (a.type === 'event' ? 0 : 1) - (b.type === 'event' ? 0 : 1) || a.created - b.created);
  return `<ul class="log">${sorted.length ? sorted.map(e => rowHtml(e, opts)).join('') : '<li class="empty">まだ何もありません</li>'}</ul>`;
}
function addFormHtml(id, extra = '', ph = '書き出す… (例: o 15時 歯医者 / - メモ / * 大事なタスク)') {
  return `<form class="add" data-form="${id}"><input name="t" placeholder="${ph}" autocomplete="off" required>${extra}${genreSelect()}<button class="btn primary">追加</button></form>`;
}

// ---- デイリー ----
function viewDaily() {
  const d = state.date;
  const items = db.entries.filter(e => covers(e, d));
  return `<div class="nav"><button data-act="day" data-n="-1">‹</button>
    <h2>${fmtDate(d)}${d === today() ? ' · 今日' : ''}</h2>
    <button data-act="day" data-n="1">›</button></div>
    ${d !== today() ? '<p><button class="btn" data-act="gotoday">今日へ</button></p>' : ''}
    ${addFormHtml('daily', `<label class="fld">終了日 <input type="date" name="end" min="${d}" title="2日以上のとき"></label>`)}
    <p class="hint">記号: 何も付けない=タスク• / o=予定○ / -=メモ– / *=優先★。左の記号をタップで完了×</p>
    ${dailyRoutines(d)}
    ${listHtml(items, { migrate: { act: 'tomorrow', label: '>明日' } })}`;
}
// ウィークリーのルーティンを、その日のデイリーにも出す(チェックはウィークリーと共通)
function dailyRoutines(d) {
  if (!db.routines.length) return '';
  const w = weekStartOf(d), days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
  return `<h3>ルーティン</h3><ul class="log">${db.routines.map(r => {
    const on = r.days.includes(d), n = days.filter(x => r.days.includes(x)).length, g = genreOf(r);
    return `<li><button class="sym" data-act="rcheck" data-id="${r.id}" data-date="${d}"${g ? ` style="color:${g.color}"` : ''} aria-label="${esc(r.name)}">${on ? '✓' : '□'}</button><span class="txt">${esc(r.name)}</span><span class="hint" style="flex:none;margin:0">今週 ${n}/${r.target}</span></li>`;
  }).join('')}</ul><h3>今日のこと</h3>`;
}

// ---- ウィークリー ----
function toggleRef(e) {
  const src = refSource(e);
  if (!src) return;
  if (e.ref.list === 'shop') toggleBought(src); else toggleDone(src);
}
const dayOpts = w => `<select name="day" aria-label="曜日"><option value="">曜日は未定</option>${Array.from({ length: 7 }, (_, i) => { const d = addDays(w, i); return `<option value="${d}">${shortDate(d)}(${DOW[i]})</option>`; }).join('')}</select>`;

// 今週に反映できる、まだ終わっていない「やりたい/買いたい/行きたい」
// マンスリーに入っている(予定月がこの週の月)ものを先に並べる
function reflectOptions(w) {
  const used = new Set(db.entries.filter(e => e.week === w && e.ref).map(e => e.ref.list + ':' + e.ref.id));
  const months = [...new Set([w.slice(0, 7), addDays(w, 6).slice(0, 7)])];
  const defs = [['やりたい', 'wishes', db.wishes.filter(x => !x.done), 'text'], ['買いたい', 'shop', db.shop.filter(x => !x.bought), 'name'], ['行きたい', 'places', db.places.filter(x => !x.done), 'name']];
  const opts = (list, arr, name) => arr.map(x => `<option value="${list}:${x.id}">${esc(x[name])}</option>`).join('');
  let inMonthly = '', others = '';
  for (const [label, list, arr, name] of defs) {
    const free = arr.filter(x => !used.has(list + ':' + x.id));
    const pl = free.filter(x => months.includes(x.plan)), ot = free.filter(x => !months.includes(x.plan));
    if (pl.length) inMonthly += `<optgroup label="マンスリー:${label}">${opts(list, pl, name)}</optgroup>`;
    if (ot.length) others += `<optgroup label="ほか:${label}">${opts(list, ot, name)}</optgroup>`;
  }
  return inMonthly + others;
}

function viewWeekly() {
  const w = state.week, days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
  const cur = weekStartOf(today());
  const grid = db.routines.length ? `<table class="rgrid"><tr><th></th>${days.map(d => `<th class="${d === today() ? 'today' : ''}">${DOW[parseYmd(d).getDay()]}<br>${Number(d.slice(8))}</th>`).join('')}<th></th></tr>${db.routines.map(r => {
    const n = days.filter(d => r.days.includes(d)).length, g = genreOf(r);
    return `<tr><td class="name"><button class="link-btn" data-act="redit" data-id="${r.id}">${g ? `<span style="color:${g.color}">●</span> ` : ''}${esc(r.name)}</button></td>${days.map(d => {
      const on = r.days.includes(d);
      return `<td><button class="cell${on ? ' on' : ''}" data-act="rcheck" data-id="${r.id}" data-date="${d}" aria-label="${esc(r.name)} ${shortDate(d)}">${on ? '✓' : ''}</button></td>`;
    }).join('')}<td class="cnt${n >= r.target ? ' ok' : ''}">${n}/${r.target}</td></tr>`;
  }).join('')}</table>` : '<p class="hint">毎週くり返すこと(ジムに行く、など)を、下の欄に追加すると、ここで曜日ごとにチェックできます。</p>';
  const spot = db.entries.filter(e => e.week === w).sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || a.created - b.created);
  const others = days.map(d => ({ d, items: db.entries.filter(e => covers(e, d) && e.week !== w) })).filter(x => x.items.length);
  const opts = reflectOptions(w);
  return `<div class="nav"><button data-act="wk" data-n="-7">‹</button><h2>${shortDate(w)}〜${shortDate(days[6])}${w === cur ? ' · 今週' : ''}</h2><button data-act="wk" data-n="7">›</button></div>
    ${w !== cur ? '<p><button class="btn" data-act="wkcur">今週へ</button></p>' : ''}
    <h3>毎週のルーティン</h3>
    ${grid}
    <form class="add" data-form="newroutine" style="margin-top:8px"><input name="t" placeholder="毎週くり返すこと (例: ジムいく)" autocomplete="off" required><select name="target" aria-label="週に何回">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}"${n === 3 ? ' selected' : ''}>週${n}回</option>`).join('')}</select>${genreSelect()}<button class="btn primary">追加</button></form>
    <h3>今週やること(その週だけ)</h3>
    ${addFormHtml('weekly', dayOpts(w), '今週やること (例: AI学ぶ / o 15時 打合せ)')}
    ${opts ? `<form class="add" data-form="reflect"><select name="t" aria-label="リストから選ぶ" required><option value="">マンスリーの やりたい・買いたい・行きたい から選ぶ</option>${opts}</select>${dayOpts(w).replace('name="day"', 'name="day2"')}<button class="btn">今週に反映</button></form>` : ''}
    ${listHtml(spot, { migrate: { act: 'nextweek', label: '>来週' } })}
    <h3>日ごとの予定</h3>
    ${others.length ? others.map(x => `<h3 class="dayh" data-act="opendate" data-date="${x.d}" style="margin-top:12px">${shortDate(x.d)}(${DOW[parseYmd(x.d).getDay()]})</h3>${listHtml(x.items)}`).join('') : '<p class="hint">この週に日付のある予定はありません。</p>'}`;
}

function openRoutineEdit(id) {
  const r = db.routines.find(x => x.id === id), dlg = $('#edit-dialog');
  if (!r) return;
  dlg.innerHTML = `<form data-form="editroutine:${r.id}" class="sync-form">
    <h2>ルーティンを編集</h2>
    <label class="field"><span class="lbl">内容</span><input name="t" value="${esc(r.name)}" required></label>
    <label class="field"><span class="lbl">週に何回</span><select name="target">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}"${n === r.target ? ' selected' : ''}>週${n}回</option>`).join('')}</select></label>
    <label class="field"><span class="lbl">ジャンル</span>${genreSelect('g', r.g || '')}</label>
    <div class="btn-row"><button class="btn primary">保存</button><button type="button" class="btn" data-act="edit-close">キャンセル</button><button type="button" class="btn" data-act="rdel" data-id="${r.id}">削除</button></div>
  </form>`;
  if (!dlg.open) dlg.showModal();
}

// ---- マンスリー ----
// 日ごとの「記号+件数」。同じ記号・色は1つにまとめて件数を付ける(予定を先に、取消・移行済みは数えない)
function dayMarks(on) {
  const groups = new Map();
  on.filter(e => !['cancelled', 'migrated', 'scheduled'].includes(e.status))
    .sort((a, b) => (a.type === 'event' ? 0 : 1) - (b.type === 'event' ? 0 : 1))
    .forEach(e => {
      const g = genreOf(e);
      const sym = e.type === 'event' ? entrySym(e) : e.type === 'note' ? SYM.note : SYM.task;
      const key = sym + (g ? g.color : '');
      const x = groups.get(key) || { sym, color: g ? g.color : '', n: 0 };
      x.n++; groups.set(key, x);
    });
  if (!groups.size) return '';
  return `<span class="mk">${[...groups.values()].map(x => `<b${x.color ? ` style="color:${x.color}"` : ''}>${x.sym}<small>${x.n}</small></b>`).join('')}</span>`;
}
// マンスリー一覧の日付表示(例: 5日 / 5〜7日 / 30日〜11/2)
function eventDays(e, m) {
  const day = s => Number(s.slice(8));
  if (!e.endDate) return `${day(e.date)}日`;
  const sameStart = e.date.startsWith(m);
  if (e.endDate.startsWith(e.date.slice(0, 7))) return `${day(e.date)}〜${day(e.endDate)}日`;
  return sameStart ? `${day(e.date)}日〜${shortDate(e.endDate)}` : `${shortDate(e.date)}〜${day(e.endDate)}日`;
}
function viewMonthly() {
  const m = state.month, first = parseYmd(m + '-01').getDay(), n = daysIn(m);
  let cells = DOW.map(x => `<div class="dow">${x}</div>`).join('') + '<div class="d blank"></div>'.repeat(first);
  for (let i = 1; i <= n; i++) {
    const ds = `${m}-${pad(i)}`;
    const on = db.entries.filter(e => covers(e, ds));
    cells += `<button class="d${ds === today() ? ' today' : ''}" data-act="opendate" data-date="${ds}">${i}${dayMarks(on)}</button>`;
  }
  const monthly = db.entries.filter(e => e.month === m && !e.date);
  const mStart = m + '-01', mEnd = `${m}-${pad(n)}`;
  const events = db.entries.filter(e => e.date && e.date <= mEnd && (e.endDate || e.date) >= mStart && (e.type === 'event' || e.planned)).sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="nav"><button data-act="mon" data-n="-1">‹</button><h2>${fmtMonth(m)}</h2><button data-act="mon" data-n="1">›</button></div>
    <div class="cal">${cells}</div>
    <h3>今月の予定</h3>
    <ul class="log">${events.length ? events.map(e => `<li class="st-${e.status}"><span class="sym"${symStyle(e)}>${entrySym(e)}</span><span class="txt">${eventDays(e, m)} ${esc(e.text)}${tagHtml(e)}</span><span class="acts"><button data-act="edit" data-id="${e.id}">編集</button></span></li>`).join('') : '<li class="empty">予定なし</li>'}</ul>
    ${monthlyPlans(m)}
    <h3>今月のタスク</h3>
    ${addFormHtml('monthly')}
    ${listHtml(monthly)}
    <p><button class="btn" data-act="review">月末の見直し・移行</button></p>`;
}

// ---- フューチャー(今月から。月数は自分で増やせる) ----
// ジャンルごとにまとめて、その中を日付順に並べる(ジャンルなしは最後)
function byGenre(items) {
  const groups = [...db.genres, null].map(g => ({ g, items: items.filter(e => (g ? e.g === g.id : !genreOf(e))) })).filter(x => x.items.length);
  if (!groups.length) return listHtml([]);
  return groups.map(x => `<h4 class="gh" style="color:${x.g ? x.g.color : 'var(--sub)'}">${x.g ? `${x.g.symbol} ${esc(x.g.name)}` : 'ジャンルなし'} <span class="hint">${x.items.length}</span></h4>${listHtml(x.items, { byDate: true })}`).join('');
}
function viewFuture() {
  const base = today().slice(0, 7);
  let h = '<h2>フューチャーログ</h2><p class="hint">まだ先の予定・やりたいことを月ごとに置いておく場所。その月になったらマンスリーに出てきます。</p>';
  const count = db.settings.futureCount;
  for (let i = 0; i < count; i++) {
    const m = addMonths(base, i);
    h += `<div class="card"><h3>${fmtMonth(m)}</h3>${addFormHtml('future:' + m, `<input type="date" name="d" min="${m}-01" max="${m}-${pad(daysIn(m))}" title="日付(任意)" aria-label="日付(任意)" style="max-width:130px;font-size:14px;border:1px solid var(--line);border-radius:8px;background:var(--paper)"><label class="fld">〜 <input type="date" name="end" min="${m}-01" title="終了日(2日以上のとき)" aria-label="終了日(任意)"></label>`)}${byGenre(db.entries.filter(e => e.month === m && (e.planned || !e.date)))}</div>`;
  }
  const last = addMonths(base, count - 1);
  const lastUsed = db.entries.some(e => e.month === last);
  h += `<div class="nav" style="justify-content:center;gap:8px"><button data-act="fadd" data-n="1">+1か月</button><button data-act="fadd" data-n="6">+6か月</button>${count > 1 && !lastUsed ? '<button data-act="fsub">−1か月</button>' : ''}</div><p class="hint" style="text-align:center">${fmtMonth(last)}まで表示中</p>`;
  return h;
}

// ---- やりたいこと100 / 買いたいもの / 行きたい場所 / 個別株売買 ----
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const delBtn = (list, id) => `<button data-act="rm" data-list="${list}" data-id="${id}">削除</button>`;

const monthField = (list, id, key, val) => `<input type="month" value="${val || ''}" data-set="${list}" data-id="${id}" data-key="${key}" aria-label="${key === 'plan' ? '予定月' : '達成月'}">`;
const subLine = (list, it) => `<div class="sub"><label>予定月 ${monthField(list, it.id, 'plan', it.plan)}</label><label>${list === 'shop' ? '購入月' : '達成月'} ${monthField(list, it.id, 'doneMonth', it.doneMonth)}</label></div>`;

function viewWishes() {
  const done = db.wishes.filter(w => w.done).length, total = 100;
  return `<h2>2026年やりたいこと100</h2>
    <p><b>${done}</b> / ${total} 達成 <progress value="${done}" max="${total}" style="width:100%"></progress></p>
    ${db.wishes.length < total ? `<form class="add" data-form="wish"><input name="t" placeholder="やりたいこと (あと${total - db.wishes.length}個)" required><label class="fld">予定月 <input type="month" name="plan"></label><button class="btn primary">追加</button></form>` : '<p class="hint">100個そろいました!</p>'}
    <p class="hint">予定月を入れると、その月のマンスリーに出ます。完了にすると達成月が入ります。</p>
    <ul class="log">${db.wishes.length ? db.wishes.map((w, i) => `<li class="wrap ${w.done ? 'st-done' : ''}"><span class="hint" style="width:26px;margin:0;flex:none;text-align:right">${i + 1}</span><button class="sym" data-act="wishdone" data-id="${w.id}">${w.done ? '×' : '•'}</button><span class="txt">${esc(w.text)}</span><span class="acts">${delBtn('wishes', w.id)}</span>${subLine('wishes', w)}</li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
}

function viewShop() {
  const rank = { 高: 0, 中: 1, 低: 2 };
  const items = [...db.shop].sort((a, b) => a.bought - b.bought || rank[a.pri] - rank[b.pri]);
  const total = db.shop.filter(s => !s.bought).reduce((s, x) => s + x.price, 0);
  return `<h2>買いたいもの</h2><p>未購入の合計: <b>${yen(total)}</b></p>
    <form class="add" data-form="shop"><input name="t" placeholder="品名" required><input name="p" type="number" min="0" inputmode="numeric" placeholder="金額" style="max-width:90px"><select name="r"><option>高</option><option selected>中</option><option>低</option></select><label class="fld">予定月 <input type="month" name="plan"></label><button class="btn primary">追加</button></form>
    <p class="hint">予定月を入れると、その月のマンスリーに出ます。購入済みにすると購入月が入ります。</p>
    <ul class="log">${items.length ? items.map(s => `<li class="wrap ${s.bought ? 'st-done' : ''}"><button class="sym" data-act="shopdone" data-id="${s.id}">${s.bought ? '×' : '•'}</button><span class="txt">${esc(s.name)} <span class="hint">優先:${s.pri}</span></span><span class="txt" style="flex:none;text-align:right">${yen(s.price)}</span><span class="acts">${delBtn('shop', s.id)}</span>${subLine('shop', s)}</li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
}

function viewPlaces() {
  const f = state.placeFilter || 'all', fp = state.placePref || '';
  const items = db.places.filter(p => (f === 'all' || (f === 'visited') === !!p.done) && (!fp || p.pref === fp));
  const visited = new Set(db.places.filter(p => p.done && PREFS.includes(p.pref)).map(p => p.pref)).size;
  return `<h2>行きたい場所</h2>
    <p>行った都道府県: <b>${visited}</b> / 47</p>
    <div class="nav" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">${[['all', 'すべて'], ['todo', 'これから'], ['visited', '行った']].map(([k, l]) => `<button data-act="pfilter" data-f="${k}" ${f === k ? 'style="border-color:var(--accent)"' : ''}>${l}</button>`).join('')}
      <select data-filter="pref" aria-label="県で絞り込み"><option value="">全県</option>${PREFS.concat(ABROAD).map(p => `<option${p === fp ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
    <form class="add" data-form="place"><input name="t" placeholder="場所名" required><select name="pref" aria-label="県">${prefOptions('')}</select><label class="fld">予定月 <input type="month" name="plan"></label><input name="m" placeholder="メモ"><button class="btn primary">追加</button></form>
    <p class="hint">予定月を入れると、その月のマンスリーに出ます。行ったら○をタップすると達成月が入ります。</p>
    <ul class="log">${items.length ? items.map(p => `<li class="wrap ${p.done ? 'st-done' : ''}"><button class="sym" data-act="placedone" data-id="${p.id}">${p.done ? '×' : '○'}</button><span class="txt">${esc(p.name)}${p.pref ? ` <span class="tag" style="background:var(--sub)">${p.pref}</span>` : ''}${p.memo ? ` <span class="hint">${esc(p.memo)}</span>` : ''}</span><span class="acts">${delBtn('places', p.id)}</span>${subLine('places', p)}</li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
}

// マンスリーに出す: 予定月/達成月がその月のやりたいこと・行きたい場所
function monthlyPlans(m) {
  const mk = (title, list, arr, sym0) => `<h3>${title}</h3><ul class="log">${arr.length ? arr.map(x => `<li class="${x.done || x.bought ? 'st-done' : ''}"><button class="sym" data-act="${{ wishes: 'wishdone', shop: 'shopdone', places: 'placedone' }[list]}" data-id="${x.id}">${x.done || x.bought ? '×' : sym0}</button><span class="txt">${esc(x.text || x.name)}${x.pref ? ` <span class="tag" style="background:var(--sub)">${x.pref}</span>` : ''}${x.doneMonth === m ? ` <span class="hint">${list === 'shop' ? '購入' : '達成'}</span>` : ''}${list === 'shop' && x.price ? ` <span class="hint">${yen(x.price)}</span>` : ''}</span></li>`).join('') : '<li class="empty">なし</li>'}</ul>`;
  const w = db.wishes.filter(x => x.plan === m || x.doneMonth === m);
  const p = db.places.filter(x => x.plan === m || x.doneMonth === m);
  const s = db.shop.filter(x => x.plan === m || x.doneMonth === m);
  return mk('今月やりたいこと', 'wishes', w, '•') + mk('今月買いたいもの', 'shop', s, '•') + mk('今月行きたい場所', 'places', p, '○');
}

// 総平均法で保有数・平均取得単価・実現損益を計算
function tradeSummary() {
  const by = {};
  [...db.trades].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created).forEach(t => {
    const s = by[t.code] || (by[t.code] = { qty: 0, cost: 0, pnl: 0 });
    if (t.side === 'buy') { s.qty += t.qty; s.cost += t.qty * t.price; }
    else {
      const avg = s.qty ? s.cost / s.qty : 0, q = Math.min(t.qty, s.qty);
      s.pnl += (t.price - avg) * t.qty; s.cost -= avg * q; s.qty -= q;
    }
  });
  return by;
}
function viewTrades() {
  const sum = tradeSummary(), codes = Object.keys(sum);
  const totalPnl = codes.reduce((s, c) => s + sum[c].pnl, 0);
  const trades = [...db.trades].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  return `<h2>個別株売買リスト</h2>
    <p>実現損益 合計: <b style="color:${totalPnl >= 0 ? 'var(--ok)' : 'var(--accent)'}">${totalPnl >= 0 ? '+' : ''}${yen(totalPnl)}</b></p>
    <form class="card" data-form="trade" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <input name="c" placeholder="銘柄 (例: 7203 トヨタ)" required style="grid-column:1/-1;padding:8px;font-size:16px">
      <select name="s" style="padding:8px;font-size:16px"><option value="buy">買い</option><option value="sell">売り</option></select>
      <input name="d" type="date" value="${today()}" required style="padding:8px;font-size:16px">
      <input name="q" type="number" min="1" inputmode="numeric" placeholder="数量(株)" required style="padding:8px;font-size:16px">
      <input name="p" type="number" min="0" step="any" inputmode="decimal" placeholder="単価(円)" required style="padding:8px;font-size:16px">
      <input name="m" placeholder="理由・メモ" style="grid-column:1/-1;padding:8px;font-size:16px">
      <button class="btn primary" style="grid-column:1/-1">記録</button></form>
    <h3>銘柄ごと</h3>
    <ul class="log">${codes.length ? codes.map(c => { const s = sum[c]; return `<li><span class="txt">${esc(c)}<br><span class="hint">保有 ${s.qty}株${s.qty ? ` / 平均 ${yen(s.cost / s.qty)}` : ''}</span></span><span class="txt" style="flex:none;text-align:right;color:${s.pnl >= 0 ? 'var(--ok)' : 'var(--accent)'}">${s.pnl >= 0 ? '+' : ''}${yen(s.pnl)}</span></li>`; }).join('') : '<li class="empty">まだありません</li>'}</ul>
    <h3>売買履歴</h3>
    <ul class="log">${trades.length ? trades.map(t => `<li><span class="sym">${t.side === 'buy' ? '買' : '売'}</span><span class="txt">${esc(t.code)} ${t.qty}株 @${yen(t.price)}<br><span class="hint">${t.date}${t.memo ? ' ' + esc(t.memo) : ''}</span></span><span class="acts"><button data-act="edittrade" data-id="${t.id}">編集</button>${delBtn('trades', t.id)}</span></li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
}

// ---- 使い方 ----
function genreEditor() {
  return `<h3>ジャンル(予定の色と記号)</h3>
    <p class="hint">予定やタスクを入れるとき、ジャンルを選ぶと色と記号が付きます。</p>
    <ul class="log">${db.genres.length ? db.genres.map(g => `<li><input type="color" value="${g.color}" data-gset="color" data-id="${g.id}" aria-label="色">
      <select data-gset="symbol" data-id="${g.id}" aria-label="記号">${GENRE_SYMBOLS.map(s => `<option${s === g.symbol ? ' selected' : ''}>${s}</option>`).join('')}</select>
      <input value="${esc(g.name)}" data-gset="name" data-id="${g.id}" aria-label="名前" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:16px">
      <span class="acts"><button data-act="gdel" data-id="${g.id}">削除</button></span></li>`).join('') : '<li class="empty">ジャンルなし</li>'}</ul>
    <form class="add" data-form="newgenre" style="margin-top:8px"><input name="t" placeholder="ジャンル名を追加 (例: 旅行)" required><button class="btn primary">追加</button></form>`;
}
function viewGuide() {
  return `<div class="guide"><h2>設定・使い方</h2>${window.Sync ? Sync.panel() : ''}${genreEditor()}
    <p>バレットジャーナルは「短く書き出し(ラピッドログ)・毎月見直して移行する」ためのノート術です。</p>
    <table><tr><td>•</td><td>タスク(やること)</td></tr><tr><td>×</td><td>完了</td></tr><tr><td>&gt;</td><td>移行(明日・来月へ持ち越し)</td></tr><tr><td>&lt;</td><td>未来へ(フューチャーログに送る)</td></tr><tr><td>○</td><td>予定・出来事</td></tr><tr><td>–</td><td>メモ</td></tr><tr><td>★</td><td>優先(入力の先頭に * )</td></tr></table>
    <ol><li><b>デイリー</b>: 今日のことを箇条書きで書き出す。</li>
    <li><b>マンスリー</b>: カレンダーで1か月を俯瞰し、今月のタスクを置く。</li>
    <li><b>フューチャー</b>: 先の予定・やりたいこと。月は「+1か月 / +6か月」で増やせます。</li>
    <li><b>月末の見直し</b>: 未完了のタスクを1つずつ「来月へ移行 / 未来へ / 不要なので取消」と判断する。これが核心です。</li>
    <li><b>やりたい100・行きたい場所</b>: 予定月を入れると、その月のマンスリーに出ます。</li></ol>
    <p class="hint">ログインしていないときは、データはこの端末の中にだけ保存されます。</p>
    <p><button class="btn" data-act="export">データを書き出す(JSON)</button>
    <button class="btn" data-act="import">読み込む</button>
    <input id="import-file" type="file" accept="application/json,.json" hidden></p>
    <p class="hint">機種変更やバックアップに。読み込むと今のデータは置き換わります。</p></div>`;
}

// ---- 月末の見直し(移行ダイアログ) ----
function openReview() {
  const m = state.month, next = addMonths(m, 1);
  const open = db.entries.filter(e => e.type === 'task' && e.status === 'open' && (e.month === m || (e.date && e.date.startsWith(m))));
  const dlg = $('#migrate-dialog');
  dlg.innerHTML = `<h2>${fmtMonth(m)}の見直し</h2><p class="hint">未完了のタスクを1つずつ判断します。本当にやる価値があるか?を問い直しましょう。</p>
    <ul class="log">${open.length ? open.map(e => `<li><span class="txt">${esc(e.text)}</span><span class="acts">
      <button data-act="mig-next" data-id="${e.id}">&gt;来月</button><button data-act="mig-future" data-id="${e.id}">&lt;未来</button><button data-act="mig-cancel" data-id="${e.id}">取消</button></span></li>`).join('') : '<li class="empty">未完了のタスクはありません 🎉</li>'}</ul>
    <p><button class="btn" data-act="close-dlg">閉じる</button></p>`;
  dlg.dataset.next = next;
  if (!dlg.open) dlg.showModal();
}
// 完了にしたら達成月を今月に。戻したら達成月を消す
function toggleBought(s) {
  s.bought = !s.bought;
  s.doneMonth = s.bought ? (s.doneMonth || today().slice(0, 7)) : '';
}
function toggleDone(x) {
  x.done = !x.done;
  x.doneMonth = x.done ? (x.doneMonth || today().slice(0, 7)) : '';
}
// ---- 予定・タスクの編集 ----
function openEdit(id) {
  const e = find(id), dlg = $('#edit-dialog');
  if (!e) return;
  dlg.innerHTML = `<form data-form="edit:${e.id}" class="sync-form">
    <h2>編集</h2>
    <label class="field"><span class="lbl">内容</span><input name="t" value="${esc(e.text)}" required></label>
    <label class="field"><span class="lbl">種類</span><select name="type">${[['event', '予定 ○'], ['task', 'タスク •'], ['note', 'メモ –']].map(([v, l]) => `<option value="${v}"${v === e.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span class="lbl">ジャンル</span>${genreSelect('g', e.g || '')}</label>
    <label class="field"><span class="lbl">開始日(日付がある予定)</span><input type="date" name="d" value="${e.date || ''}"></label>
    <label class="field"><span class="lbl">終了日(2日以上のとき)</span><input type="date" name="end" value="${e.endDate || ''}"></label>
    <label class="field"><span class="lbl">月(日付を入れないとき)</span><input type="month" name="month" value="${e.month || (e.date || '').slice(0, 7)}"></label>
    <label class="fld"><input type="checkbox" name="pri"${e.priority ? ' checked' : ''}> 優先 ★</label>
    <div class="btn-row"><button class="btn primary">保存</button><button type="button" class="btn" data-act="edit-close">キャンセル</button></div>
  </form>`;
  if (!dlg.open) dlg.showModal();
}
function openTradeEdit(id) {
  const t = db.trades.find(x => x.id === id), dlg = $('#edit-dialog');
  if (!t) return;
  dlg.innerHTML = `<form data-form="edittrade:${t.id}" class="sync-form">
    <h2>株の記録を編集</h2>
    <label class="field"><span class="lbl">銘柄</span><input name="c" value="${esc(t.code)}" required></label>
    <label class="field"><span class="lbl">売買</span><select name="s"><option value="buy"${t.side === 'buy' ? ' selected' : ''}>買い</option><option value="sell"${t.side === 'sell' ? ' selected' : ''}>売り</option></select></label>
    <label class="field"><span class="lbl">日付</span><input type="date" name="d" value="${t.date}" required></label>
    <label class="field"><span class="lbl">数量(株)</span><input type="number" name="q" min="1" inputmode="numeric" value="${t.qty}" required></label>
    <label class="field"><span class="lbl">単価(円)</span><input type="number" name="p" min="0" step="any" inputmode="decimal" value="${t.price}" required></label>
    <label class="field"><span class="lbl">理由・メモ</span><input name="m" value="${esc(t.memo || '')}"></label>
    <div class="btn-row"><button class="btn primary">保存</button><button type="button" class="btn" data-act="edit-close">キャンセル</button></div>
  </form>`;
  if (!dlg.open) dlg.showModal();
}
function saveTradeEdit(f, id) {
  const t = db.trades.find(x => x.id === id);
  if (!t) return;
  const code = f.c.value.trim(), qty = Number(f.q.value), price = Number(f.p.value);
  if (!code || !f.d.value || !(qty >= 1) || !(price >= 0)) { toast('銘柄・日付・数量・単価を確認してください'); return; }
  Object.assign(t, { code, side: f.s.value, date: f.d.value, qty, price, memo: f.m.value.trim() });
  $('#edit-dialog').close();
  save(); render();
}
function saveEdit(f, id) {
  const e = find(id);
  if (!e) return;
  const d = f.d.value, end = f.end.value, month = f.month.value, text = f.t.value.trim();
  if (!text) return;
  if (end && !d) { toast('終了日を入れるときは、開始日も入れてください'); return; }
  if (end && end < d) { toast('終了日は開始日より後にしてください'); return; }
  if (!d && !month && !e.week) { toast('開始日か月のどちらかを入れてください'); return; }
  e.text = text; e.type = f.type.value; e.g = f.g.value; e.priority = f.pri.checked;
  if (e.type !== 'task' && e.status === 'done') e.status = 'open';
  if (d) {
    const wasPlain = e.date && !e.month && !e.planned;       // デイリーで入れた予定は、そのまま
    e.date = d; e.endDate = end > d ? end : null;
    if (!wasPlain && !e.week) { e.planned = true; e.month = d.slice(0, 7); }
  } else {
    e.month = month || (e.week ? null : e.month); e.date = null; e.endDate = null; e.planned = false;
  }
  $('#edit-dialog').close();
  save(); render();
}
function migrateTo(e, fields, status) {
  addEntry({ type: 'task', text: e.text, priority: e.priority, g: e.g || '', ...fields });
  e.status = status;
}
function futureMonth(e) {
  const base = today().slice(0, 7);
  const cur = e.month || (e.date || base).slice(0, 7);
  return addMonths(cur > base ? cur : base, 1);
}

// ---- 描画 ----
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const v = { daily: viewDaily, weekly: viewWeekly, monthly: viewMonthly, future: viewFuture, wishes: viewWishes, shop: viewShop, places: viewPlaces, trades: viewTrades, guide: viewGuide }[state.tab];
  $('#view').innerHTML = v();
}

// ---- イベント ----
document.addEventListener('click', ev => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; render(); return; }
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act, e = b.dataset.id && find(b.dataset.id);
  switch (a) {
    case 'day': state.date = addDays(state.date, +b.dataset.n); break;
    case 'gotoday': state.date = today(); break;
    case 'mon': state.month = addMonths(state.month, +b.dataset.n); break;
    case 'opendate': state.date = b.dataset.date; state.tab = 'daily'; break;
    case 'toggle':
      if (e && e.ref && refSource(e)) { toggleRef(e); break; }
      if (!e || e.type !== 'task') return;
      e.status = e.status === 'done' ? 'open' : e.status === 'open' ? 'done' : e.status; break;
    case 'tomorrow': if (e) migrateTo(e, { date: addDays(e.date, 1) }, 'migrated'); break;
    case 'future': if (e) migrateTo(e, { month: futureMonth(e) }, 'scheduled'); break;
    case 'cancel': if (e) e.status = 'cancelled'; break;
    case 'del': db.entries = db.entries.filter(x => x.id !== b.dataset.id); break;
    case 'wk': state.week = addDays(state.week, +b.dataset.n); break;
    case 'wkcur': state.week = weekStartOf(today()); break;
    case 'nextweek': if (e) migrateTo(e, { week: addDays(e.week || weekStartOf(e.date || today()), 7), date: null, ref: e.ref || null }, 'migrated'); break;
    case 'rcheck': { const r = db.routines.find(x => x.id === b.dataset.id); if (r) { const d = b.dataset.date, i = r.days.indexOf(d); if (i >= 0) r.days.splice(i, 1); else r.days.push(d); } break; }
    case 'redit': openRoutineEdit(b.dataset.id); return;
    case 'rdel': if (!confirm('このルーティンを削除しますか?(チェックの記録も消えます)')) return; db.routines = db.routines.filter(x => x.id !== b.dataset.id); $('#edit-dialog').close(); break;
    case 'edit': openEdit(b.dataset.id); return;
    case 'edittrade': openTradeEdit(b.dataset.id); return;
    case 'edit-close': $('#edit-dialog').close(); return;
    case 'review': openReview(); return;
    case 'close-dlg': $('#migrate-dialog').close(); render(); return;
    case 'mig-next': if (e) migrateTo(e, { month: $('#migrate-dialog').dataset.next }, 'migrated'); save(); openReview(); return;
    case 'mig-future': if (e) migrateTo(e, { month: addMonths($('#migrate-dialog').dataset.next, 1) }, 'scheduled'); save(); openReview(); return;
    case 'mig-cancel': if (e) e.status = 'cancelled'; save(); openReview(); return;
    case 'import': $('#import-file').click(); return;
    case 'export': {
      const url = URL.createObjectURL(new Blob([BujoStorage.exportJson(db)], { type: 'application/json' }));
      const l = document.createElement('a'); l.href = url; l.download = `bujo-${today()}.json`; l.click(); URL.revokeObjectURL(url); return;
    }
    case 'wishdone': { const w = db.wishes.find(x => x.id === b.dataset.id); if (w) toggleDone(w); break; }
    case 'shopdone': { const s = db.shop.find(x => x.id === b.dataset.id); if (s) toggleBought(s); break; }
    case 'placedone': { const p = db.places.find(x => x.id === b.dataset.id); if (p) toggleDone(p); break; }
    case 'fadd': db.settings.futureCount += +b.dataset.n; break;
    case 'fsub': db.settings.futureCount = Math.max(1, db.settings.futureCount - 1); break;
    case 'gdel': db.genres = db.genres.filter(g => g.id !== b.dataset.id); break;
    case 'pfilter': state.placeFilter = b.dataset.f; break;
    case 'rm': if (db[b.dataset.list]) db[b.dataset.list] = db[b.dataset.list].filter(x => x.id !== b.dataset.id); break;
    default: return;
  }
  save(); render();
});

document.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  const raw = f.elements.t ? f.elements.t.value : f.elements.c.value;
  if (!raw.trim()) return;
  const [kind, arg] = f.dataset.form.split(':');
  if (kind === 'edit') { saveEdit(f, arg); return; }
  if (kind === 'editroutine') {
    const r = db.routines.find(x => x.id === arg);
    if (r) { r.name = raw.trim(); r.target = +f.target.value; r.g = f.g.value; $('#edit-dialog').close(); save(); render(); }
    return;
  }
  if (kind === 'edittrade') { saveTradeEdit(f, arg); return; }
  const g = f.elements.g ? f.elements.g.value : '';
  if (kind === 'daily') {
    const p = parseRapid(raw, 'task'); const end = f.elements.end ? f.elements.end.value : '';
    if (end && end < state.date) { toast('終了日は開始日より後にしてください'); return; }
    if (p.text) addEntry({ ...p, g, date: state.date, endDate: end > state.date ? end : null });
  } else if (kind === 'monthly') {
    const p = parseRapid(raw, 'task'); if (p.text) addEntry({ ...p, g, month: state.month });
  } else if (kind === 'future') {
    const p = parseRapid(raw, 'task'); const d = f.elements.d && f.elements.d.value;
    const end = f.elements.end ? f.elements.end.value : '';
    if (end && !d) { toast('終了日を入れるときは、日付も選んでください'); return; }
    if (end && end < d) { toast('終了日は開始日より後にしてください'); return; }
    if (p.text) addEntry(d ? { ...p, g, month: d.slice(0, 7), date: d, endDate: end > d ? end : null, planned: true } : { ...p, g, month: arg });
  } else if (kind === 'wish') {
    if (db.wishes.length < 100) db.wishes.push({ id: uid(), text: raw.trim(), done: false, plan: f.plan.value, doneMonth: '' });
  } else if (kind === 'shop') {
    db.shop.push({ id: uid(), name: raw.trim(), price: Number(f.p.value) || 0, pri: f.r.value, bought: false, plan: f.plan.value, doneMonth: '' });
  } else if (kind === 'place') {
    db.places.push({ id: uid(), name: raw.trim(), pref: f.pref.value, memo: f.m.value.trim(), plan: f.plan.value, done: false, doneMonth: '' });
  } else if (kind === 'newroutine') {
    db.routines.push({ id: uid(), name: raw.trim(), target: +f.target.value, g, days: [] });
  } else if (kind === 'weekly') {
    const p = parseRapid(raw, 'task');
    if (p.text) addEntry({ ...p, g, week: state.week, date: f.elements.day.value || null });
  } else if (kind === 'reflect') {
    const [list, rid] = raw.split(':'), src = db[list] && db[list].find(x => x.id === rid);
    if (src && REF_LABEL[list]) addEntry({ type: 'task', text: src.text || src.name, g: '', week: state.week, date: f.elements.day2.value || null, ref: { list, id: rid } });
  } else if (kind === 'newgenre') {
    const n = db.genres.length;
    db.genres.push({ id: uid(), name: raw.trim(), color: GENRE_COLORS[n % GENRE_COLORS.length], symbol: GENRE_SYMBOLS[n % GENRE_SYMBOLS.length] });
  } else if (kind === 'trade') {
    db.trades.push({ id: uid(), code: raw.trim(), side: f.s.value, date: f.d.value, qty: Number(f.q.value), price: Number(f.p.value), memo: f.m.value.trim(), created: Date.now() });
  }
  save(); render();
});

document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.dataset.set) {                       // やりたい/行きたいの予定月・達成月
    const x = db[t.dataset.set].find(i => i.id === t.dataset.id);
    if (x) { x[t.dataset.key] = t.value; if (t.dataset.key === 'doneMonth') { if (t.dataset.set === 'shop') x.bought = !!t.value; else x.done = !!t.value; } save(); render(); }
    return;
  }
  if (t.dataset.gset) {                      // ジャンルの名前・色・記号
    const g = db.genres.find(i => i.id === t.dataset.id);
    if (g) { g[t.dataset.gset] = t.dataset.gset === 'name' ? (t.value.trim() || g.name) : t.value; save(); render(); }
    return;
  }
  if (t.dataset.filter === 'pref') { state.placePref = t.value; render(); return; }
  if (t.id !== 'import-file' || !t.files[0]) return;
  const d = BujoStorage.parse(await ev.target.files[0].text());
  if (!d) { alert('読み込めないファイルです'); return; }
  if (!confirm('今のデータを、このファイルの内容に置き換えますか?')) return;
  db = migrateData(d); save(); render();
});

// 旧データの引き継ぎ(行きたい場所: visited(日付) → done / doneMonth)
function migrateData(d) {
  d.places.forEach(p => { if (p.visited !== undefined) { p.done = p.done || !!p.visited; p.doneMonth = p.doneMonth || (p.visited || '').slice(0, 7); delete p.visited; } });
  return d;
}
const loaded = BujoStorage.load().then(d => { db = migrateData(d); render(); });
// 同期(sync.js)から使う窓口
window.BujoApp = { loaded, getDb: () => db, render, tab: () => state.tab, goSettings: () => { state.tab = 'guide'; render(); } };

// オフライン対応(PWA)。file:// など非対応環境では何もしない
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
