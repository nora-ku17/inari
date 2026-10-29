'use strict';
// バレットジャーナル 叩き台。データは localStorage に保存(端末内のみ)。
const SYM = { task: '•', event: '○', note: '–' };
const STATUS_SYM = { done: '×', migrated: '>', scheduled: '<', cancelled: '•' };
const $ = (s, r = document) => r.querySelector(s);

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
function addEntry(fields) {
  db.entries.push({ id: uid(), status: 'open', priority: false, date: null, month: null, created: Date.now(), ...fields });
  save();
}
const find = id => db.entries.find(e => e.id === id);

// ---- 共通: 1行の描画 ----
function rowHtml(e, opts = {}) {
  const sym = e.type === 'task' ? (STATUS_SYM[e.status] || SYM.task) : SYM[e.type];
  const closed = e.status !== 'open';
  const acts = [];
  if (e.type === 'task' && !closed) {
    if (opts.migrate) acts.push(`<button data-act="${opts.migrate.act}" data-id="${e.id}">${opts.migrate.label}</button>`);
    acts.push(`<button data-act="future" data-id="${e.id}" title="未来へ">&lt;未来</button>`);
  }
  if (!closed) acts.push(`<button data-act="cancel" data-id="${e.id}" title="不要になった">取消</button>`);
  acts.push(`<button data-act="del" data-id="${e.id}" title="削除">削除</button>`);
  return `<li class="st-${e.status}${e.priority ? ' pri' : ''}">
    <button class="sym" data-act="toggle" data-id="${e.id}" aria-label="完了切替">${sym}</button>
    <span class="txt">${e.planned && e.date ? `<span class="hint">${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))}</span> ` : ''}${esc(e.text)}</span><span class="acts">${acts.join('')}</span></li>`;
}
function listHtml(arr, opts) {
  const sorted = [...arr].sort((a, b) => (a.type === 'event' ? 0 : 1) - (b.type === 'event' ? 0 : 1) || a.created - b.created);
  return `<ul class="log">${sorted.length ? sorted.map(e => rowHtml(e, opts)).join('') : '<li class="empty">まだ何もありません</li>'}</ul>`;
}
function addFormHtml(id, extra = '') {
  return `<form class="add" data-form="${id}"><input name="t" placeholder="書き出す… (例: o 15時 歯医者 / - メモ / * 大事なタスク)" autocomplete="off" required>${extra}<button class="btn primary">追加</button></form>`;
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
function viewMonthly() {
  const m = state.month, first = parseYmd(m + '-01').getDay(), n = daysIn(m);
  let cells = DOW.map(x => `<div class="dow">${x}</div>`).join('') + '<div class="d blank"></div>'.repeat(first);
  for (let i = 1; i <= n; i++) {
    const ds = `${m}-${pad(i)}`;
    const on = db.entries.filter(e => e.date === ds);
    const open = on.filter(e => e.type === 'task' && e.status === 'open').length;
    cells += `<button class="d${ds === today() ? ' today' : ''}${on.some(e => e.type === 'event') ? ' ev' : ''}" data-act="opendate" data-date="${ds}">${i}${open ? `<i>${open}</i>` : ''}</button>`;
  }
  const monthly = db.entries.filter(e => e.month === m && !e.date);
  const events = db.entries.filter(e => e.date && e.date.startsWith(m) && (e.type === 'event' || e.planned)).sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="nav"><button data-act="mon" data-n="-1">‹</button><h2>${fmtMonth(m)}</h2><button data-act="mon" data-n="1">›</button></div>
    <div class="cal">${cells}</div>
    <h3>今月の予定</h3>
    <ul class="log">${events.length ? events.map(e => `<li class="st-${e.status}"><span class="sym">${e.type === 'task' ? (STATUS_SYM[e.status] || SYM.task) : SYM[e.type]}</span><span class="txt">${parseYmd(e.date).getDate()}日 ${esc(e.text)}</span></li>`).join('') : '<li class="empty">予定なし</li>'}</ul>
    <h3>今月のタスク</h3>
    ${addFormHtml('monthly')}
    ${listHtml(monthly)}
    <p><button class="btn" data-act="review">月末の見直し・移行</button></p>`;
}

// ---- フューチャー(今月から6か月) ----
function viewFuture() {
  const base = today().slice(0, 7);
  let h = '<h2>フューチャーログ</h2><p class="hint">まだ先の予定・やりたいことを月ごとに置いておく場所。その月になったらマンスリーに出てきます。</p>';
  for (let i = 0; i < 6; i++) {
    const m = addMonths(base, i);
    h += `<div class="card"><h3>${fmtMonth(m)}</h3>${addFormHtml('future:' + m, `<input type="date" name="d" min="${m}-01" max="${m}-${pad(daysIn(m))}" title="日付(任意)" aria-label="日付(任意)" style="max-width:130px;font-size:14px;border:1px solid var(--line);border-radius:8px;background:var(--paper)">`)}${listHtml(db.entries.filter(e => e.month === m && (e.planned || !e.date)))}</div>`;
  }
  return h;
}

// ---- コレクション ----
function viewCollections() {
  const cols = db.collections.map(c => `<div class="card"><h3>${esc(c.name)} <button class="acts-del btn" data-act="delcol" data-id="${c.id}" style="float:right;font-size:12px">削除</button></h3>
    <ul class="log">${c.items.length ? c.items.map(it => `<li class="${it.done ? 'st-done' : ''}"><button class="sym" data-act="colitem" data-id="${c.id}" data-item="${it.id}">${it.done ? '×' : '•'}</button><span class="txt">${esc(it.text)}</span><span class="acts"><button data-act="delitem" data-id="${c.id}" data-item="${it.id}">削除</button></span></li>`).join('') : '<li class="empty">空です</li>'}</ul>
    <form class="add" data-form="colitem:${c.id}" style="margin-bottom:0"><input name="t" placeholder="項目を追加" required><button class="btn primary">追加</button></form></div>`).join('');
  return `<h2>コレクション</h2><p class="hint">読みたい本・行きたい場所・買い物リストなど、テーマ別のリスト。</p>
    <form class="add" data-form="newcol"><input name="t" placeholder="新しいコレクション名 (例: 読みたい本)" required><button class="btn primary">作成</button></form>${cols}`;
}

// ---- 習慣トラッカー ----
function viewHabits() {
  const m = state.month, n = daysIn(m);
  const head = Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('');
  const rows = db.habits.map(h => `<tr><td class="name">${esc(h.name)} <button class="btn" data-act="delhabit" data-id="${h.id}" style="font-size:10px;padding:0 4px">×</button></td>${Array.from({ length: n }, (_, i) => {
    const ds = `${m}-${pad(i + 1)}`;
    return `<td><button class="cell${h.days[ds] ? ' on' : ''}" data-act="habit" data-id="${h.id}" data-date="${ds}">${h.days[ds] ? '✓' : ''}</button></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="nav"><button data-act="mon" data-n="-1">‹</button><h2>${fmtMonth(m)}の習慣</h2><button data-act="mon" data-n="1">›</button></div>
    <form class="add" data-form="newhabit"><input name="t" placeholder="習慣を追加 (例: 早起き)" required><button class="btn primary">追加</button></form>
    <div class="habit-grid">${db.habits.length ? `<table><tr><th></th>${head}</tr>${rows}</table>` : '<p class="hint">習慣を追加すると、日ごとにチェックできます。</p>'}</div>`;
}


// ---- やりたいこと100 / 買いたいもの / 行きたい場所 / 個別株売買 ----
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const delBtn = (list, id) => `<button data-act="rm" data-list="${list}" data-id="${id}">削除</button>`;

function viewWishes() {
  const done = db.wishes.filter(w => w.done).length, total = 100;
  return `<h2>2026年やりたいこと100</h2>
    <p><b>${done}</b> / ${total} 達成 <progress value="${done}" max="${total}" style="width:100%"></progress></p>
    ${db.wishes.length < total ? `<form class="add" data-form="wish"><input name="t" placeholder="やりたいこと (あと${total - db.wishes.length}個)" required><button class="btn primary">追加</button></form>` : '<p class="hint">100個そろいました!</p>'}
    <ul class="log">${db.wishes.length ? db.wishes.map((w, i) => `<li class="${w.done ? 'st-done' : ''}"><span class="hint" style="width:26px;margin:0;flex:none;text-align:right">${i + 1}</span><button class="sym" data-act="wishdone" data-id="${w.id}">${w.done ? '×' : '•'}</button><span class="txt">${esc(w.text)}</span><span class="acts">${delBtn('wishes', w.id)}</span></li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
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
  const f = state.placeFilter || 'all';
  const items = db.places.filter(p => f === 'all' || (f === 'visited') === !!p.visited);
  return `<h2>行きたい場所</h2>
    <div class="nav" style="justify-content:flex-start;gap:6px">${[['all', 'すべて'], ['todo', 'これから'], ['visited', '行った']].map(([k, l]) => `<button data-act="pfilter" data-f="${k}" ${f === k ? 'style="border-color:var(--accent)"' : ''}>${l}</button>`).join('')}</div>
    <form class="add" data-form="place"><input name="t" placeholder="場所名" required><input name="m" placeholder="メモ"><button class="btn primary">追加</button></form>
    <ul class="log">${items.length ? items.map(p => `<li class="${p.visited ? 'st-done' : ''}"><button class="sym" data-act="placedone" data-id="${p.id}">${p.visited ? '×' : '○'}</button><span class="txt">${esc(p.name)}${p.memo ? ` <span class="hint">${esc(p.memo)}</span>` : ''}${p.visited ? ` <span class="hint">${p.visited}</span>` : ''}</span><span class="acts">${delBtn('places', p.id)}</span></li>`).join('') : '<li class="empty">まだありません</li>'}</ul>`;
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
function viewGuide() {
  return `<div class="guide"><h2>使い方</h2>
    <p>バレットジャーナルは「短く書き出し(ラピッドログ)・毎月見直して移行する」ためのノート術です。</p>
    <table><tr><td>•</td><td>タスク(やること)</td></tr><tr><td>×</td><td>完了</td></tr><tr><td>&gt;</td><td>移行(明日・来月へ持ち越し)</td></tr><tr><td>&lt;</td><td>未来へ(フューチャーログに送る)</td></tr><tr><td>○</td><td>予定・出来事</td></tr><tr><td>–</td><td>メモ</td></tr><tr><td>★</td><td>優先(入力の先頭に * )</td></tr></table>
    <ol><li><b>デイリー</b>: 今日のことを箇条書きで書き出す。</li>
    <li><b>マンスリー</b>: カレンダーで1か月を俯瞰し、今月のタスクを置く。</li>
    <li><b>フューチャー</b>: 半年先までの予定・やりたいこと。</li>
    <li><b>月末の見直し</b>: 未完了のタスクを1つずつ「来月へ移行 / 未来へ / 不要なので取消」と判断する。これが核心です。</li>
    <li><b>コレクション・習慣</b>: テーマ別リストと習慣チェック。</li></ol>
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
function migrateTo(e, fields, status) {
  addEntry({ type: 'task', text: e.text, priority: e.priority, ...fields });
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
  const v = { daily: viewDaily, monthly: viewMonthly, future: viewFuture, wishes: viewWishes, shop: viewShop, places: viewPlaces, trades: viewTrades, collections: viewCollections, habits: viewHabits, guide: viewGuide }[state.tab];
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
    case 'delcol': db.collections = db.collections.filter(c => c.id !== b.dataset.id); break;
    case 'colitem': { const it = db.collections.find(c => c.id === b.dataset.id)?.items.find(i => i.id === b.dataset.item); if (it) it.done = !it.done; break; }
    case 'delitem': { const c = db.collections.find(c => c.id === b.dataset.id); if (c) c.items = c.items.filter(i => i.id !== b.dataset.item); break; }
    case 'habit': { const h = db.habits.find(h => h.id === b.dataset.id); if (h) { if (h.days[b.dataset.date]) delete h.days[b.dataset.date]; else h.days[b.dataset.date] = true; } break; }
    case 'delhabit': if (confirm('この習慣を削除しますか?')) db.habits = db.habits.filter(h => h.id !== b.dataset.id); break;
    case 'import': $('#import-file').click(); return;
    case 'export': {
      const url = URL.createObjectURL(new Blob([BujoStorage.exportJson(db)], { type: 'application/json' }));
      const l = document.createElement('a'); l.href = url; l.download = `bujo-${today()}.json`; l.click(); URL.revokeObjectURL(url); return;
    }
    case 'wishdone': { const w = db.wishes.find(x => x.id === b.dataset.id); if (w) w.done = !w.done; break; }
    case 'shopdone': { const s = db.shop.find(x => x.id === b.dataset.id); if (s) s.bought = !s.bought; break; }
    case 'placedone': { const p = db.places.find(x => x.id === b.dataset.id); if (p) p.visited = p.visited ? '' : today(); break; }
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
  if (kind === 'daily') {
    const p = parseRapid(raw, 'task'); if (p.text) addEntry({ ...p, date: state.date });
  } else if (kind === 'monthly') {
    const p = parseRapid(raw, 'task'); if (p.text) addEntry({ ...p, month: state.month });
  } else if (kind === 'future') {
    const p = parseRapid(raw, 'task'); const d = f.elements.d && f.elements.d.value;
    if (p.text) addEntry(d ? { ...p, month: d.slice(0, 7), date: d, planned: true } : { ...p, month: arg });
  } else if (kind === 'newcol') {
    db.collections.push({ id: uid(), name: raw.trim(), items: [] });
  } else if (kind === 'colitem') {
    db.collections.find(c => c.id === arg)?.items.push({ id: uid(), text: raw.trim(), done: false });
  } else if (kind === 'wish') {
    if (db.wishes.length < 100) db.wishes.push({ id: uid(), text: raw.trim(), done: false });
  } else if (kind === 'shop') {
    db.shop.push({ id: uid(), name: raw.trim(), price: Number(f.p.value) || 0, pri: f.r.value, bought: false });
  } else if (kind === 'place') {
    db.places.push({ id: uid(), name: raw.trim(), memo: f.m.value.trim(), visited: '' });
  } else if (kind === 'trade') {
    db.trades.push({ id: uid(), code: raw.trim(), side: f.s.value, date: f.d.value, qty: Number(f.q.value), price: Number(f.p.value), memo: f.m.value.trim(), created: Date.now() });
  } else if (kind === 'newhabit') {
    db.habits.push({ id: uid(), name: raw.trim(), days: {} });
  }
  save(); render();
});

document.addEventListener('change', async ev => {
  if (ev.target.id !== 'import-file' || !ev.target.files[0]) return;
  const d = BujoStorage.parse(await ev.target.files[0].text());
  if (!d) { alert('読み込めないファイルです'); return; }
  if (!confirm('今のデータを、このファイルの内容に置き換えますか?')) return;
  db = d; save(); render();
});

BujoStorage.load().then(d => { db = d; render(); });

// オフライン対応(PWA)。file:// など非対応環境では何もしない
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
