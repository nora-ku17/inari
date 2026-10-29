'use strict';
// 保存の窓口。アプリ本体は BujoStorage.load()/save() だけを使う。
// - ブラウザ/PWA: localStorage(+ 永続化リクエストで OS による自動削除を避ける)
// - iOS ネイティブ(Capacitor): Preferences(UserDefaults)に保存。初回は localStorage から引き継ぐ
// iCloud 同期などに替えるときは、この中身だけ差し替える。
(function () {
  const KEY = 'bujo-v1';
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
      if (d && Array.isArray(d.entries)) return { ...empty(), ...d, settings: { ...empty().settings, ...d.settings }, version: VERSION };
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
  window.BujoStorage = { load, save, empty, exportJson: db => JSON.stringify(db, null, 2), parse: normalize };
})();
