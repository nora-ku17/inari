'use strict';
// 保存の窓口。アプリ本体は BujoStorage.load()/save() だけを使う。
// - ブラウザ/PWA: localStorage(+ 永続化リクエストで OS による自動削除を避ける)
// - iOS ネイティブ(Capacitor): Preferences(UserDefaults)に保存。初回は localStorage から引き継ぐ
// iCloud 同期などに替えるときは、この中身だけ差し替える。
(function () {
  const KEY = 'bujo-v1';
  const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
  const SYMBOLS = ['○', '●', '■', '□', '▲', '△', '◆', '◇', '★', '☆', '♥', '♪', '✚', '☀'];
  const ABROAD = '海外';

  // ---- 受け取ったデータの検査(同期・JSON読み込み・保存データ共通) ----
  // 画面に出す文字列やスタイルに使う値が、想定の形でなければ捨てる/置き換える
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/, YMD_RE = /^\d{4}-\d{2}-\d{2}$/, YM_RE = /^\d{4}-\d{2}$/, COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const ymdOf = v => (typeof v === 'string' && YMD_RE.test(v) ? v : null);
  const ymOf = v => (typeof v === 'string' && YM_RE.test(v) ? v : '');
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);

  function normRecord(name, r) {
    if (!r || typeof r !== 'object') return null;
    const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : null;
    if (!id) return null;
    switch (name) {
      case 'entries': {
        const type = oneOf(r.type, ['task', 'event', 'note'], null);
        if (!type || !str(r.text).trim()) return null;
        return { id, type, status: oneOf(r.status, ['open', 'done', 'migrated', 'scheduled', 'cancelled'], 'open'), text: str(r.text),
          priority: r.priority === true, date: ymdOf(r.date), month: ymOf(r.month) || null, created: num(r.created),
          g: typeof r.g === 'string' && ID_RE.test(r.g) ? r.g : '', planned: r.planned === true };
      }
      case 'wishes':
        if (!str(r.text).trim()) return null;
        return { id, text: str(r.text), done: r.done === true, plan: ymOf(r.plan), doneMonth: ymOf(r.doneMonth) };
      case 'shop':
        if (!str(r.name).trim()) return null;
        return { id, name: str(r.name), price: Math.max(0, num(r.price)), pri: oneOf(r.pri, ['高', '中', '低'], '中'), bought: r.bought === true };
      case 'places': {
        if (!str(r.name).trim()) return null;
        const legacy = typeof r.visited === 'string' && r.visited ? ymOf(r.visited.slice(0, 7)) : '';   // 旧形式(行った日)の引き継ぎ
        return { id, name: str(r.name), pref: oneOf(r.pref, PREFS.concat(ABROAD), ''), memo: str(r.memo),
          plan: ymOf(r.plan), done: r.done === true || !!legacy, doneMonth: ymOf(r.doneMonth) || legacy };
      }
      case 'trades': {
        const date = ymdOf(r.date);
        if (!date || !str(r.code).trim()) return null;
        return { id, code: str(r.code, 100), side: oneOf(r.side, ['buy', 'sell'], 'buy'), date, qty: num(r.qty), price: Math.max(0, num(r.price)), memo: str(r.memo), created: num(r.created) };
      }
      case 'genres':
        if (!str(r.name, 50).trim()) return null;
        return { id, name: str(r.name, 50), color: typeof r.color === 'string' && COLOR_RE.test(r.color) ? r.color : '#888888', symbol: oneOf(r.symbol, SYMBOLS, '●') };
    }
    return null;
  }
  const clampMonths = v => Math.min(120, Math.max(1, Math.round(num(v)) || 6));
  function sanitizeDb(d) {
    const out = { ...d };
    for (const k of ['entries', 'wishes', 'shop', 'places', 'trades']) out[k] = Array.isArray(d[k]) ? d[k].map(r => normRecord(k, r)).filter(Boolean) : [];
    out.genres = Array.isArray(d.genres) ? d.genres.map(r => normRecord('genres', r)).filter(Boolean) : empty().genres;
    out.settings = { futureCount: clampMonths(d.settings && d.settings.futureCount) };
    return out;
  }
  const VERSION = 1;
  const empty = () => ({ version: VERSION, entries: [], wishes: [], shop: [], places: [], trades: [],
    settings: { futureCount: 6 },
    genres: [
      { id: 'g1', name: '仕事', color: '#3b6ea8', symbol: '■' },
      { id: 'g2', name: '家族', color: '#d9822b', symbol: '♥' },
      { id: 'g3', name: '友人', color: '#4a7c59', symbol: '◆' },
      { id: 'g4', name: '趣味', color: '#8e5ba8', symbol: '★' },
      { id: 'g5', name: '健康', color: '#c0562b', symbol: '▲' }
    ] });

  const cap = window.Capacitor;
  // ネイティブ側の Preferences プラグインを(バンドラなしで)名前で呼び出す
  const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const prefs = native ? (cap.registerPlugin ? cap.registerPlugin('Preferences') : cap.Plugins && cap.Plugins.Preferences) : null;

  const lsGet = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const lsSet = v => { try { localStorage.setItem(KEY, v); } catch (e) { /* 保存不可環境 */ } };

  function normalize(raw) {
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.entries)) return { ...sanitizeDb({ ...empty(), ...d }), version: VERSION };
    } catch (e) { /* 破損 */ }
    return null;
  }

  async function load() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    let raw = null;
    if (prefs) raw = (await prefs.get({ key: KEY })).value;
    if (!raw) raw = lsGet();
    return normalize(raw) || empty();
  }

  let pending = Promise.resolve();
  function save(db) {
    const json = JSON.stringify(db);
    lsSet(json);                                   // 常に控えを残す
    if (prefs) pending = pending.then(() => prefs.set({ key: KEY, value: json })).catch(() => {});
    return pending;
  }

  // 書き出し(JSON文字列)/読み込み(JSON文字列→db。不正なら null)
  // この端末のデータを消す(共用PCでのログアウト時など)
  async function wipe() {
    try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
    if (prefs) await prefs.remove({ key: KEY }).catch(() => {});
  }

  window.BujoStorage = { load, save, empty, wipe, normRecord, clampMonths, PREFS, SYMBOLS, ABROAD, exportJson: db => JSON.stringify(db, null, 2), parse: normalize };
})();
