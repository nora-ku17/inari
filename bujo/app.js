'use strict';
// バレットジャーナル 叩き台。データは localStorage に保存(端末内のみ)。
const SYM = { task: '•', event: '○', note: '–' };
const STATUS_SYM = { done: '×', migrated: '>', scheduled: '<', cancelled: '•' };
const $ = (s, r = document) => r.querySelector(s);
const GENRE_SYMBOLS = ['○', '●', '■', '□', '▲', '△', '◆', '◇', '★', '☆', '♥', '♪', '✚', '☀'];
const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
const ABROAD = '海外';
const GENRE_COLORS = ['#3b6ea8', '#d9822b', '#4a7c59', '#8e5ba8', '#c0562b', '#b8962e', '#2f8f9d', '#c2517a'];

let db = BujoStorage.empty();
let state = { tab: 'daily', date: today(), month: today().slice(0, 7) };

function save() { BujoStorage.save(db); }
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
  const closed = e.status !== 'open';
  const acts = [];
  if (e.type === 'task' && !closed) {
    if (opts.migrate) acts.push(`<button data-act="${opts.migrate.act}" data-id="${e.id}">${opts.migrate.label}</button>`);
    acts.push(`<button data-act="future" data-id="${e.id}" title="未来へ">&lt;未来</button>`);
  }
  if (!closed) acts.push(`<button data-act="cancel" data-id="${e.id}" title="不要になった">取消</button>`);
  acts.push(`<button data-act="del" data-id="${e.id}" title="削除">削除</button>`);
  return `<li class="st-${e.status}${e.priority ? ' pri' : ''}">
    <button class="sym" data-act="toggle" data-id="${e.id}" aria-label="完了切替"${symStyle(e)}>${entrySym(e)}</button>
    <span class="txt">${e.planned && e.date ? `<span class="hint">${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))}</span> ` : ''}${esc(e.text)}${tagHtml(e)}</span><span class="acts">${acts.join('')}</span></li>`;
}
function listHtml(arr, opts) {
  const sorted = [...arr].sort((a, b) => (a.type === 'event' ? 0 : 1) - (b.type === 'event' ? 0 : 1) || a.created - b.created);
  return `<ul class="log">${sorted.length ? sorted.map(e => rowHtml(e, opts)).join('') : '<li class="empty">まだ何もありません</li>'}</ul>`;
}
function addFormHtml(id, extra = '') {
  return `<form class="add" data-form="${id}"><input name="t" placeholder="書き出す… (例: o 15時 歯医者 / - メモ / * 大事なタスク)" autocomplete="off" required>${extra}${genreSelect()}<button class="btn primary">追加</button></form>`;
}

// ---- デイリー ----
function viewDaily() {
  const d = state.date;
  const items = db.entries.filter(e => e.date === d);
  return `<div class="nav"><button data-act="day" data-n="-1">‹</button>
    <h2>${fmtDate(d)}${d === today() ? ' · 今日' : ''}</h2>
    <button data-act="day" data-n="1">›</button></div>
    ${d !== today() ? '<p><button class="btn" data-act="gotoday">今日へ</button></p>' : ''}
    ${addFormHtml('daily')}
    <p class="hint">記号: 何も付けない=タスク• / o=予定○ / -=メモ– / *=優先★。左の記号をタップで完了×</p>
    ${listHtml(items, { migrate: { act: 'tomorrow', label: '>明日' } })}`;
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
function viewMonthly() {
  const m = state.month, first = parseYmd(m + '-01').getDay(), n = daysIn(m);
  let cells = DOW.map(x => `<div class="dow">${x}</div>`).join('') + '<div class="d blank"></div>'.repeat(first);
  for (let i = 1; i <= n; i++) {
    const ds = `${m}-${pad(i)}`;
    const on = db.entries.filter(e => e.date === ds);
    cells += `<button class="d${ds === today() ? ' today' : ''}" data-act="opendate" data-date="${ds}">${i}${dayMarks(on)}</button>`;
  }
  const monthly = db.entries.filter(e => e.month === m && !e.date);
  const events = db.entries.filter(e => e.date && e.date.startsWith(m) && (e.type === 'event' || e.planned)).sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="nav"><button data-act="mon" data-n="-1">‹</button><h2>${fmtMonth(m)}</h2><button data-act="mon" data-n="1">›</button></div>
    <div class="cal">${cells}</div>
    <h3>今月の予定</h3>
    <ul class="log">${events.length ? events.map(e => `<li class="st-${e.status}"><span class="sym"${symStyle(e)}>${entrySym(e)}</span><span class="txt">${parseYmd(e.date).getDate()}日 ${esc(e.text)}${tagHtml(e)}</span></li>`).join('') : '<li class="empty">予定なし</li>'}</ul>
    ${monthlyPlans(m)}
    <h3>今月のタスク</h3>
    ${addFormHtml('monthly')}
    ${listHtml(monthly)}
    <p><button class="btn" data-act="review">月末の見直し・移行</button></p>`;
}

// ---- フューチャー(今月から。月数は自分で増やせる) ----
function viewFuture() {
  const base = today().slice(0, 7);
  let h = '<h2>フューチャーログ</h2><p class="hint">まだ先の予定・やりたいことを月ごとに置いておく場所。その月になったらマンスリーに出てきます。</p>';
  const count = db.settings.futureCount;
  for (let i = 0; i < count; i++) {
    const m = addMonths(base, i);
    h += `<div class="card"><h3>${fmtMonth(m)}</h3>${addFormHtml('future:' + m, `<input type="date" name="d" min="${m}-01" max="${m}-${pad(daysIn(m))}" title="日付(任意)" aria-label="日付(任意)" style="max-width:130px;font-size:14px;border:1px solid var(--line);border-radius:8px;background:var(--paper)">`)}${listHtml(db.entries.filter(e => e.month === m && (e.planned || !e.date)))}</div>`;
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
const subLine = (list, it) => `<div class="sub"><label>予定月 ${monthField(list, it.id, 'plan', it.plan)}</label><label>達成月 ${monthField(list, it.id, 'doneMonth', it.doneMonth)}</label></div>`;

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
    <form class="add" data-form="shop"><input name="t" placeholder="品名" required><input name="p" type="number" min="0" inputmode="numeric" placeholder="金額" style="max-width:90px"><select name="r"><option>高</option><option selected>中</option><option>低</option></select><button class="btn primary">追加</button></form>
    <ul class="log">${items.length ? items.map(s => `<li class="${s.bought ? 'st-done' : ''}"><button class="sym" data-act="shopdone" data-id="${s.id}">${s.bought ? '×' : '•'}</button><span class="txt">${esc(s.name)} <span class="hint">優先:${s.pri}</span></span><span class="txt" style="flex:none;text-align:right">${yen(s.price)}</span><span class="acts">${delBtn('shop', s.id)}</span></li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
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
  const mk = (title, list, arr, sym0) => `<h3>${title}</h3><ul class="log">${arr.length ? arr.map(x => `<li class="${x.done ? 'st-done' : ''}"><button class="sym" data-act="${list === 'wishes' ? 'wishdone' : 'placedone'}" data-id="${x.id}">${x.done ? '×' : sym0}</button><span class="txt">${esc(x.text || x.name)}${x.pref ? ` <span class="tag" style="background:var(--sub)">${x.pref}</span>` : ''}${x.doneMonth === m ? ' <span class="hint">達成</span>' : ''}</span></li>`).join('') : '<li class="empty">なし</li>'}</ul>`;
  const w = db.wishes.filter(x => x.plan === m || x.doneMonth === m);
  const p = db.places.filter(x => x.plan === m || x.doneMonth === m);
  return mk('今月やりたいこと', 'wishes', w, '•') + mk('今月行きたい場所', 'places', p, '○');
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
    <ul class="log">${trades.length ? trades.map(t => `<li><span class="sym">${t.side === 'buy' ? '買' : '売'}</span><span class="txt">${esc(t.code)} ${t.qty}株 @${yen(t.price)}<br><span class="hint">${t.date}${t.memo ? ' ' + esc(t.memo) : ''}</span></span><span class="acts">${delBtn('trades', t.id)}</span></li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
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
  return `<div class="guide"><h2>設定・使い方</h2>${genreEditor()}
    <p>バレットジャーナルは「短く書き出し(ラピッドログ)・毎月見直して移行する」ためのノート術です。</p>
    <table><tr><td>•</td><td>タスク(やること)</td></tr><tr><td>×</td><td>完了</td></tr><tr><td>&gt;</td><td>移行(明日・来月へ持ち越し)</td></tr><tr><td>&lt;</td><td>未来へ(フューチャーログに送る)</td></tr><tr><td>○</td><td>予定・出来事</td></tr><tr><td>–</td><td>メモ</td></tr><tr><td>★</td><td>優先(入力の先頭に * )</td></tr></table>
    <ol><li><b>デイリー</b>: 今日のことを箇条書きで書き出す。</li>
    <li><b>マンスリー</b>: カレンダーで1か月を俯瞰し、今月のタスクを置く。</li>
    <li><b>フューチャー</b>: 先の予定・やりたいこと。月は「+1か月 / +6か月」で増やせます。</li>
    <li><b>月末の見直し</b>: 未完了のタスクを1つずつ「来月へ移行 / 未来へ / 不要なので取消」と判断する。これが核心です。</li>
    <li><b>やりたい100・行きたい場所</b>: 予定月を入れると、その月のマンスリーに出ます。</li></ol>
    <p class="hint">データはこの端末のブラウザ内にのみ保存されます。</p>
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
function toggleDone(x) {
  x.done = !x.done;
  x.doneMonth = x.done ? (x.doneMonth || today().slice(0, 7)) : '';
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
  const v = { daily: viewDaily, monthly: viewMonthly, future: viewFuture, wishes: viewWishes, shop: viewShop, places: viewPlaces, trades: viewTrades, guide: viewGuide }[state.tab];
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
      if (!e || e.type !== 'task') return;
      e.status = e.status === 'done' ? 'open' : e.status === 'open' ? 'done' : e.status; break;
    case 'tomorrow': if (e) migrateTo(e, { date: addDays(e.date, 1) }, 'migrated'); break;
    case 'future': if (e) migrateTo(e, { month: futureMonth(e) }, 'scheduled'); break;
    case 'cancel': if (e) e.status = 'cancelled'; break;
    case 'del': db.entries = db.entries.filter(x => x.id !== b.dataset.id); break;
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
    case 'shopdone': { const s = db.shop.find(x => x.id === b.dataset.id); if (s) s.bought = !s.bought; break; }
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
  const g = f.elements.g ? f.elements.g.value : '';
  if (kind === 'daily') {
    const p = parseRapid(raw, 'task'); if (p.text) addEntry({ ...p, g, date: state.date });
  } else if (kind === 'monthly') {
    const p = parseRapid(raw, 'task'); if (p.text) addEntry({ ...p, g, month: state.month });
  } else if (kind === 'future') {
    const p = parseRapid(raw, 'task'); const d = f.elements.d && f.elements.d.value;
    if (p.text) addEntry(d ? { ...p, g, month: d.slice(0, 7), date: d, planned: true } : { ...p, g, month: arg });
  } else if (kind === 'wish') {
    if (db.wishes.length < 100) db.wishes.push({ id: uid(), text: raw.trim(), done: false, plan: f.plan.value, doneMonth: '' });
  } else if (kind === 'shop') {
    db.shop.push({ id: uid(), name: raw.trim(), price: Number(f.p.value) || 0, pri: f.r.value, bought: false });
  } else if (kind === 'place') {
    db.places.push({ id: uid(), name: raw.trim(), pref: f.pref.value, memo: f.m.value.trim(), plan: f.plan.value, done: false, doneMonth: '' });
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
    if (x) { x[t.dataset.key] = t.value; if (t.dataset.key === 'doneMonth') x.done = !!t.value; save(); render(); }
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
BujoStorage.load().then(d => { db = migrateData(d); render(); });

// オフライン対応(PWA)。file:// など非対応環境では何もしない
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
