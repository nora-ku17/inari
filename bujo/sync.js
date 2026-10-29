'use strict';

/* =========================================================
   端末どうしの同期(Firebase Authentication + Cloud Firestore)
   - 会社PC・自宅PC・スマホなど、同じアカウントでログインした端末でデータを共有します。
   - 項目を1件ずつ別ドキュメントとして保存するので、別々の端末で別々の項目を
     追加・編集しても上書きし合いません(同じ項目を同時に編集したときは後の書き込みが勝ちます)。
   - オフライン中の変更は端末に残り、つながったときに送信されます。
   - 保存先: users/{uid}/{entries|wishes|shop|places|trades|genres|config}/{id}
     ルールは自分(uid)のデータだけ、メール確認済みのアカウントだけ読み書き可(kazoku/firestore.rules)。
   - 受け取ったデータは BujoStorage.normRecord で必ず検査してから使います。
   ========================================================= */
const Sync = (() => {
  const CONF_KEY = 'bujo-sync-v1';
  const FB_URL = './vendor/firebase-10.14.1.js';
  const App = () => window.BujoApp;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 同期するデータの種類(ordered=並び順も同期する) */
  const COLS = {
    entries: { get: () => App().getDb().entries, set: a => { App().getDb().entries = a; } },
    wishes: { get: () => App().getDb().wishes, set: a => { App().getDb().wishes = a; }, ordered: true },
    shop: { get: () => App().getDb().shop, set: a => { App().getDb().shop = a; } },
    places: { get: () => App().getDb().places, set: a => { App().getDb().places = a; } },
    trades: { get: () => App().getDb().trades, set: a => { App().getDb().trades = a; } },
    genres: { get: () => App().getDb().genres, set: a => { App().getDb().genres = a; }, ordered: true },
    config: {
      get: () => [{ id: 'shared', futureCount: App().getDb().settings.futureCount }],
      set: a => { const c = a[0]; if (c) App().getDb().settings.futureCount = BujoStorage.clampMonths(c.futureCount); },
    },
  };

  let conf = loadConf();
  let fb = null, auth = null, db = null, user = null, authReady = false;
  let unsubs = [], synced = {}, ready = false, pushTimer = null, pending = 0, lastError = '', initError = '';

  function loadConf() {
    try { return JSON.parse(localStorage.getItem(CONF_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConf() { try { localStorage.setItem(CONF_KEY, JSON.stringify(conf)); } catch (e) { /* noop */ } }

  /** キー順をそろえたJSON(変更の検出用) */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const clean = r => JSON.parse(JSON.stringify(r));
  const verified = () => !!(user && user.emailVerified);
  const isConnected = () => !!(conf.config && verified());
  const toast = m => (window.toast ? window.toast(m) : null);

  /* ---------- 他の端末への設定リンク ---------- */
  function encodeConfigLink() {
    const json = JSON.stringify({ c: conf.config });
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${location.origin}${location.pathname}#cfg=${b64}`;
  }
  function readConfigFromUrl() {
    const m = location.hash.match(/cfg=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const inv = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
      const c = pickConfig(inv.c);
      if (!c) throw new Error('bad');
      if (!conf.config || conf.config.projectId !== c.projectId) conf = { config: c };
      saveConf();
      return true;
    } catch (e) {
      setTimeout(() => toast('設定リンクを読み取れませんでした'), 300);
      return false;
    }
  }
  const CONF_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  function pickConfig(o) {
    if (!o || typeof o !== 'object') return null;
    const out = {};
    for (const k of CONF_KEYS) if (typeof o[k] === 'string' && /^[\w.:\-]{1,200}$/.test(o[k])) out[k] = o[k];
    return out.apiKey && out.projectId && out.appId ? out : null;
  }
  /** コンソールの firebaseConfig を貼り付けた文字列から取り出す */
  function parseConfig(text) {
    const o = {};
    for (const k of CONF_KEYS) {
      const m = text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
      if (m) o[k] = m[1];
    }
    return pickConfig(o);
  }
  /** かぞく手帳を同じブラウザで設定済みなら、その設定を借りる */
  function kazokuConfig() {
    try { return pickConfig((JSON.parse(localStorage.getItem('kazoku-sync-v1')) || {}).config); } catch (e) { return null; }
  }

  /* ---------- 状態表示 ---------- */
  function statusInfo() {
    if (!conf.config) return null;
    if (initError) return { cls: 'err', icon: '⚠', text: '同期エラー' };
    if (!authReady) return { cls: 'busy', icon: '⟳', text: '接続中' };
    if (!user) return { cls: 'off', icon: '☁', text: 'ログインしてください' };
    if (!verified()) return { cls: 'off', icon: '✉', text: 'メール確認待ち' };
    if (lastError) return { cls: 'err', icon: '⚠', text: '同期エラー' };
    if (!navigator.onLine) return { cls: 'off', icon: '⚠', text: 'オフライン' };
    if (!ready) return { cls: 'busy', icon: '⟳', text: '読み込み中' };
    if (pending) return { cls: 'busy', icon: '⟳', text: '送信中' };
    return { cls: 'ok', icon: '✓', text: '同期済み' };
  }
  function updateBadge() {
    const b = $('#sync-badge');
    if (!b) return;
    const s = statusInfo();
    b.hidden = !s;
    if (!s) return;
    b.className = 'sync-badge ' + s.cls;
    b.innerHTML = `<span aria-hidden="true">${s.icon}</span>${esc(s.text)}`;
  }

  /* ---------- 再描画(入力中は待つ) ---------- */
  let renderWaiting = false;
  const onSettings = () => App().tab() === 'guide';
  function typingInMain() {
    const a = document.activeElement;
    return a && a.closest && a.closest('main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }
  function scheduleRender() {
    if (typingInMain()) { renderWaiting = true; return; }
    renderWaiting = false;
    App().render();
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (renderWaiting && !typingInMain()) scheduleRender(); }, 50));

  /* ---------- 初期化 ---------- */
  async function init() {
    await App().loaded;
    if (readConfigFromUrl()) App().goSettings();
    updateBadge();
    if (!conf.config) return;
    try {
      fb = await import(FB_URL);
      const app = fb.initializeApp(conf.config);
      auth = fb.getAuth(app);
      db = fb.initializeFirestore(app, {
        localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
        experimentalAutoDetectLongPolling: true,   // 会社のプロキシ越しでもつながりやすくする
      });
      fb.onAuthStateChanged(auth, u => {
        user = u;
        authReady = true;
        if (u && u.emailVerified) listen(); else stopListen();
        updateBadge();
        if (onSettings()) scheduleRender();
      });
    } catch (e) {
      console.error(e);
      initError = 'Firebaseの初期化に失敗しました。設定内容を確認してください。';
      authReady = true;
      updateBadge();
      if (onSettings()) scheduleRender();
    }
  }

  /* ---------- 受信 ---------- */
  function stopListen() {
    unsubs.forEach(u => u());
    unsubs = [];
    ready = false;
  }
  function sortOrdered(name, arr) {
    const o = id => { const j = synced[name].get(id); if (!j) return Infinity; const v = JSON.parse(j)._o; return typeof v === 'number' ? v : Infinity; };
    return arr.sort((a, b) => (o(a.id) - o(b.id)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  /** 受け取ったデータは必ず検査してから使う(不正なデータは無視) */
  function docRecord(name, d) {
    const rec = d.data();
    delete rec._o;
    rec.id = d.id;
    if (name === 'config') return d.id === 'shared' ? { id: 'shared', futureCount: BujoStorage.clampMonths(rec.futureCount) } : null;
    return BujoStorage.normRecord(name, rec);
  }

  function listen() {
    stopListen();
    const firstDone = new Set();
    const names = Object.keys(COLS);
    for (const name of names) {
      synced[name] = new Map();
      const ref = fb.collection(db, 'users', user.uid, name);
      unsubs.push(fb.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
        if (!firstDone.has(name)) {
          // オフラインで端末にまだ何もない状態の「空」は信用せず、サーバーからの返事を待つ
          if (snap.metadata.fromCache && snap.empty) return;
          firstDone.add(name);
          synced[name] = new Map(snap.docs.map(d => [d.id, stable(d.data())]));
          // 最初のつなぎ込みは「合体」: クラウドにある項目 + この端末にだけある項目(後で送信)
          const remote = snap.docs.map(d => docRecord(name, d)).filter(Boolean);
          const ids = new Set(remote.map(r => r.id));
          const localOnly = COLS[name].get().filter(r => r && !ids.has(r.id));
          COLS[name].set(COLS[name].ordered ? [...sortOrdered(name, remote), ...localOnly] : [...remote, ...localOnly]);
          if (firstDone.size === names.length) onReady();
          return;
        }
        applyChanges(name, snap.docChanges());
        updateBadge();
      }, err => onError(err)));
    }
  }

  function onReady() {
    ready = true;
    lastError = '';
    BujoStorage.save(App().getDb());
    push();               // この端末にだけあった項目をクラウドへ
    updateBadge();
    scheduleRender();
  }

  function applyChanges(name, changes) {
    if (!ready || !changes.length) return;
    const c = COLS[name], s = synced[name];
    let arr = [...c.get()], changed = false;
    for (const ch of changes) {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (s.has(id)) { s.delete(id); arr = arr.filter(r => r.id !== id); changed = true; }
        continue;
      }
      const j = stable(ch.doc.data());
      if (s.get(id) === j) continue;                // 自分が送った変更
      const rec = docRecord(name, ch.doc);
      if (!rec) continue;
      s.set(id, j);
      const i = arr.findIndex(r => r.id === id);
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      changed = true;
    }
    if (!changed) return;
    c.set(c.ordered ? sortOrdered(name, arr) : arr);
    BujoStorage.save(App().getDb());
    scheduleRender();
  }

  function onError(err) {
    console.error(err);
    lastError = err && err.code === 'permission-denied'
      ? 'データを読み書きする権限がありません(Firestoreのルールにバレットジャーナル用の設定が入っているか確認してください)'
      : `同期でエラーが起きました(${(err && err.code) || err})`;
    updateBadge();
    if (onSettings()) scheduleRender();
  }

  /* ---------- 送信 ---------- */
  function schedulePush() {
    if (!ready || !isConnected()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 300);
  }

  function push() {
    if (!ready || !isConnected()) return;
    const ops = [];
    for (const [name, c] of Object.entries(COLS)) {
      const s = synced[name];
      const cur = new Map();
      c.get().forEach((r, i) => {
        if (!r || !r.id) return;
        const d = clean(r);
        delete d._o;
        if (c.ordered) d._o = i;
        cur.set(String(r.id), d);
      });
      for (const [id, d] of cur) {
        const j = stable(d);
        if (s.get(id) !== j) { ops.push({ name, id, d }); s.set(id, j); }
      }
      if (name !== 'config') for (const id of [...s.keys()]) if (!cur.has(id)) { ops.push({ name, id, del: true }); s.delete(id); }
    }
    if (!ops.length) return;
    for (let i = 0; i < ops.length; i += 400) {
      const batch = fb.writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        const ref = fb.doc(db, 'users', user.uid, op.name, op.id);
        if (op.del) batch.delete(ref); else batch.set(ref, op.d);
      }
      pending++;
      updateBadge();
      batch.commit()
        .then(() => { lastError = ''; })
        .catch(err => onError(err))
        .finally(() => { pending--; updateBadge(); });
    }
  }

  /* ---------- 設定画面 ---------- */
  const AUTH_ERRORS = {
    'auth/invalid-credential': 'メールアドレスかパスワードが違います',
    'auth/wrong-password': 'パスワードが違います',
    'auth/user-not-found': 'このメールアドレスのアカウントがありません。「はじめて」から作ってください',
    'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。「ログイン」してください',
    'auth/weak-password': 'パスワードは10文字以上にしてください',
    'auth/invalid-email': 'メールアドレスの形式が正しくありません',
    'auth/operation-not-allowed': 'Firebaseで「メール / パスワード」ログインが有効になっていません',
    'auth/network-request-failed': 'ネットワークにつながっていません',
    'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからお試しください',
  };

  function panel() {
    const s = statusInfo();
    let body = '';
    if (!conf.config) {
      const kz = kazokuConfig();
      body = `<p class="hint">会社PC・自宅PC・スマホで、データを自動で共有します。「かぞく手帳」と同じFirebaseと、同じアカウントを使えます。</p>
        ${kz ? '<p><button class="btn primary" data-sact="use-kazoku">かぞく手帳の設定を使う</button></p>' : ''}
        <form class="sync-form" data-sync="config">
          <label class="field"><span class="lbl">firebaseConfig を貼り付け</span>
            <textarea name="config" rows="5" placeholder="const firebaseConfig = {&#10;  apiKey: &quot;...&quot;,&#10;  projectId: &quot;...&quot;, ...&#10;};" required></textarea></label>
          <button class="btn primary">設定する</button>
        </form>
        <p class="hint">すでに同期している端末の「設定リンク」を開いても設定できます。</p>`;
    } else if (initError) {
      body = `<p class="sync-err">${esc(initError)}</p><button class="btn" data-sact="forget">同期の設定をやり直す</button>`;
    } else if (!authReady) {
      body = '<p class="hint">接続しています…</p>';
    } else if (!user) {
      body = `<form class="sync-form" data-sync="login" autocomplete="on">
          <label class="field"><span class="lbl">メールアドレス</span><input type="email" name="email" autocomplete="username" required></label>
          <label class="field"><span class="lbl">パスワード(10文字以上)</span><input type="password" name="password" autocomplete="current-password" minlength="10" required></label>
          <div class="btn-row">
            <button class="btn primary" name="mode" value="login">ログイン</button>
            <button class="btn" name="mode" value="signup">はじめて(アカウントを作る)</button>
            <button type="button" class="link-btn" data-sact="reset-pw">パスワードを忘れた</button>
          </div>
        </form>
        <p class="hint">かぞく手帳で作ったアカウントがあれば、そのまま「ログイン」できます。<br><button class="link-btn" data-sact="forget">同期の設定を削除</button></p>`;
    } else if (!verified()) {
      body = `<p>ログイン中:<b>${esc(user.email)}</b></p>
        <div class="sync-note">✉ <b>${esc(user.email)}</b> に確認メールを送りました。メールのリンクを開いてから、「確認しました」を押してください。</div>
        <div class="btn-row">
          <button class="btn primary" data-sact="verified">確認しました</button>
          <button class="btn" data-sact="resend">確認メールを再送</button>
          <button class="btn" data-sact="logout">ログアウト</button>
        </div>`;
    } else {
      body = `<p>ログイン中:<b>${esc(user.email)}</b></p>
        ${lastError ? `<p class="sync-err">${esc(lastError)}</p>` : ''}
        <p class="hint">同じメールアドレスでログインした端末と、データが自動で共有されます。</p>
        <div class="btn-row">
          <button class="btn" data-sact="copy-link">他の端末用の設定リンクをコピー</button>
          <button class="btn" data-sact="logout">ログアウト</button>
        </div>`;
    }
    return `<div class="card sync-card"><h3>☁ 端末どうしの同期 ${s ? `<span class="sync-badge ${s.cls}">${s.icon} ${esc(s.text)}</span>` : ''}</h3>${body}</div>`;
  }

  /* ---------- 操作 ---------- */
  const actions = {
    'use-kazoku': () => {
      const c = kazokuConfig();
      if (!c) return;
      conf = { config: c }; saveConf(); location.reload();
    },
    forget: () => {
      if (!confirm('この端末の同期設定を削除します(この端末のデータは残ります)。')) return;
      Promise.resolve(auth && fb.signOut(auth)).catch(() => null).finally(() => { localStorage.removeItem(CONF_KEY); location.reload(); });
    },
    logout: async () => {
      if (!confirm('ログアウトします。')) return;
      const wipe = confirm('この端末に入っているデータも消しますか?\n会社PCなど共用の端末では「OK」を選んでください。クラウドのデータは消えません。\n\nOK=データも消す / キャンセル=消さない');
      stopListen();
      await fb.signOut(auth).catch(() => null);
      if (wipe) {
        await BujoStorage.wipe();
        try { if (indexedDB.databases) (await indexedDB.databases()).forEach(d => d.name && d.name.startsWith('firestore/') && indexedDB.deleteDatabase(d.name)); } catch (e) { /* noop */ }
        location.reload();
        return;
      }
      toast('ログアウトしました');
    },
    resend: async () => {
      try { await fb.sendEmailVerification(user); toast('確認メールを送りました'); }
      catch (e) { toast(AUTH_ERRORS[e.code] || '送信できませんでした(' + (e.code || e) + ')'); }
    },
    verified: async () => {
      try { await user.reload(); await user.getIdToken(true); } catch (e) { toast('確認できませんでした(' + (e.code || e) + ')'); return; }
      user = auth.currentUser;
      if (!verified()) { toast('まだ確認されていません。メールのリンクを開いてください'); return; }
      toast('メールアドレスを確認しました');
      listen();
      updateBadge();
      App().render();
    },
    'copy-link': async () => {
      const url = encodeConfigLink();
      try { await navigator.clipboard.writeText(url); toast('設定リンクをコピーしました'); }
      catch (e) { prompt('このリンクを他の端末で開いてください', url); }
    },
    'reset-pw': async () => {
      const f = $('[data-sync=login]');
      const email = f && f.email.value.trim();
      if (!email) { toast('メールアドレスを入力してから押してください'); return; }
      try { await fb.sendPasswordResetEmail(auth, email); toast('パスワード再設定のメールを送りました'); }
      catch (e) { toast('送信できませんでした(' + (e.code || e) + ')'); }
    },
  };

  async function onSubmit(f, fd, submitter) {
    if (f.dataset.sync === 'config') {
      const c = parseConfig(fd.get('config') || '');
      if (!c) { toast('apiKey・projectId・appId が見つかりません。firebaseConfig をそのまま貼り付けてください'); return; }
      conf = { config: c }; saveConf(); location.reload();
    } else if (f.dataset.sync === 'login') {
      const email = fd.get('email').trim(), pw = fd.get('password');
      const signup = submitter && submitter.value === 'signup';
      if (signup && pw.length < 10) { toast('パスワードは10文字以上にしてください'); return; }
      try {
        if (signup) {
          const cred = await fb.createUserWithEmailAndPassword(auth, email, pw);
          await fb.sendEmailVerification(cred.user).catch(() => null);
        } else await fb.signInWithEmailAndPassword(auth, email, pw);
        toast('ログインしました');
      } catch (e) { toast(AUTH_ERRORS[e.code] || `ログインできませんでした(${e.code || e})`); }
    }
  }

  document.addEventListener('submit', ev => {
    const f = ev.target.closest('[data-sync]');
    if (!f) return;
    ev.preventDefault();
    onSubmit(f, new FormData(f), ev.submitter);
  });
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-sact]');
    if (b && actions[b.dataset.sact]) actions[b.dataset.sact]();
  });
  window.addEventListener('online', updateBadge);
  window.addEventListener('offline', updateBadge);

  return { init, panel, schedulePush };
})();

window.Sync = Sync;
Sync.init();
