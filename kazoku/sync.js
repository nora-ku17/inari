'use strict';

/* =========================================================
   家族同期（Firebase Authentication + Cloud Firestore）
   - 予定・家計簿などを1件ずつ別ドキュメントとして保存するので、
     夫婦が同時に別々の記録を追加・編集しても上書きし合いません。
   - 変更はリアルタイムに相手の端末へ反映されます。
   - オフライン中の変更は端末に保存され、つながったときに送信されます。
   データ構造: families/{familyId} … emails（参加できるメールアドレス）
              families/{familyId}/{members|events|bucket|tx|holdings|receipts|config}/{id}
   ========================================================= */
const Sync = (() => {
  const CONF_KEY = 'kazoku-sync-v1';
  const FB_URL = './vendor/firebase-10.14.1.js';

  /** 同期するデータの種類（ordered=並び順も同期する） */
  const COLS = {
    members: { get: () => state.members, set: a => { state.members = a; }, ordered: true },
    events: { get: () => state.events, set: a => { state.events = a; } },
    bucket: { get: () => state.bucket, set: a => { state.bucket = a; }, ordered: true },
    tx: { get: () => state.budget.tx, set: a => { state.budget.tx = a; } },
    holdings: { get: () => state.stocks.holdings, set: a => { state.stocks.holdings = a; } },
    receipts: { get: () => state.stocks.receipts, set: a => { state.stocks.receipts = a; } },
    config: {
      get: () => [{ id: 'shared', expenseCats: state.budget.expenseCats, incomeCats: state.budget.incomeCats, limits: state.budget.limits, taxRate: state.stocks.taxRate }],
      set: a => {
        const c = a[0];
        if (!c) return;
        if (Array.isArray(c.expenseCats) && c.expenseCats.length) state.budget.expenseCats = c.expenseCats;
        if (Array.isArray(c.incomeCats) && c.incomeCats.length) state.budget.incomeCats = c.incomeCats;
        state.budget.limits = c.limits || {};
        if (typeof c.taxRate === 'number') state.stocks.taxRate = c.taxRate;
      },
    },
  };

  let conf = loadConf();
  let fb = null, auth = null, db = null, user = null, authReady = false;
  let unsubs = [], familyUnsub = null, family = null;
  let synced = {}, ready = false, pushTimer = null, pending = 0, lastError = '';
  let initError = '';

  function loadConf() {
    try { return JSON.parse(localStorage.getItem(CONF_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConf() { try { localStorage.setItem(CONF_KEY, JSON.stringify(conf)); } catch (e) { /* noop */ } }

  /** キー順をそろえたJSON（変更の検出用） */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const clean = r => JSON.parse(JSON.stringify(r));
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(15))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  const isConnected = () => !!(conf.config && conf.fid && user);

  /* ---------- 招待リンク ---------- */
  function encodeInvite() {
    const json = JSON.stringify({ c: conf.config, f: conf.fid });
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${location.origin}${location.pathname}#invite=${b64}`;
  }
  function readInviteFromUrl() {
    const m = location.hash.match(/invite=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const inv = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!inv.c || !inv.c.apiKey || !inv.f) throw new Error('bad');
      if (conf.fid === inv.f) return false;
      if (conf.config && conf.config.projectId !== inv.c.projectId) conf = {};
      conf.config = inv.c;
      conf.invite = inv.f;
      saveConf();
      return true;
    } catch (e) {
      setTimeout(() => toast('招待リンクを読み取れませんでした'), 300);
      return false;
    }
  }

  /** Firebaseの設定（コンソールに表示される firebaseConfig）を貼り付けた文字列から取り出す */
  function parseConfig(text) {
    const out = {};
    for (const k of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) {
      const m = text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
      if (m) out[k] = m[1];
    }
    return out.apiKey && out.projectId && out.appId ? out : null;
  }

  /* ---------- 状態表示 ---------- */
  function statusInfo() {
    if (!conf.config) return null;
    if (initError) return { cls: 'err', icon: '⚠', text: '同期エラー' };
    if (!authReady) return { cls: 'busy', icon: '⟳', text: '接続中' };
    if (!user) return { cls: 'off', icon: '☁', text: 'ログインしてください' };
    if (!conf.fid) return { cls: 'off', icon: '☁', text: '家族未設定' };
    if (lastError) return { cls: 'err', icon: '⚠', text: '同期エラー' };
    if (!navigator.onLine) return { cls: 'off', icon: '⚠', text: 'オフライン' };
    if (!ready) return { cls: 'busy', icon: '⟳', text: '読み込み中' };
    if (pending) return { cls: 'busy', icon: '⟳', text: '送信中' };
    return { cls: 'ok', icon: '✓', text: '同期済み' };
  }
  function updateBadge() {
    const b = document.getElementById('sync-badge');
    if (!b) return;
    const s = statusInfo();
    b.hidden = !s;
    if (!s) return;
    b.className = 'sync-badge ' + s.cls;
    b.innerHTML = `<span aria-hidden="true">${s.icon}</span>${esc(s.text)}`;
  }

  /* ---------- 再描画（入力中は待つ） ---------- */
  let renderWaiting = false;
  function typingInMain() {
    const a = document.activeElement;
    return a && a.closest && a.closest('main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }
  function scheduleRender() {
    if (typingInMain()) { renderWaiting = true; return; }
    renderWaiting = false;
    render();
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (renderWaiting && !typingInMain()) scheduleRender(); }, 50));

  /* ---------- 初期化 ---------- */
  async function init() {
    readInviteFromUrl() && switchTab('settings');
    updateBadge();
    if (!conf.config) return;
    try {
      fb = await import(FB_URL);
      const app = fb.initializeApp(conf.config);
      auth = fb.getAuth(app);
      db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
      const emu = localStorage.getItem('kazoku-emulator'); // テスト用
      if (emu) {
        fb.connectAuthEmulator(auth, `http://${emu}:9099`, { disableWarnings: true });
        fb.connectFirestoreEmulator(db, emu, 8080);
      }
      fb.onAuthStateChanged(auth, u => {
        user = u;
        authReady = true;
        if (u && conf.fid) listen(); else stopListen();
        updateBadge();
        if (currentTab === 'settings') scheduleRender();
      });
    } catch (e) {
      console.error(e);
      initError = 'Firebaseの初期化に失敗しました。設定内容を確認してください。';
      authReady = true;
      updateBadge();
      if (currentTab === 'settings') scheduleRender();
    }
  }

  /* ---------- 受信 ---------- */
  function stopListen() {
    unsubs.forEach(u => u());
    unsubs = [];
    if (familyUnsub) familyUnsub();
    familyUnsub = null;
    family = null;
    ready = false;
  }

  function sortOrdered(name, arr) {
    const o = id => { const j = synced[name].get(id); if (!j) return Infinity; const v = JSON.parse(j)._o; return typeof v === 'number' ? v : Infinity; };
    // 同じ順番のときはidで並べ、どの端末でも同じ並びになるようにする
    return arr.sort((a, b) => (o(a.id) - o(b.id)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  function docRecord(d) {
    const rec = d.data();
    delete rec._o;
    rec.id = d.id;
    return rec;
  }

  function listen() {
    stopListen();
    const fid = conf.fid;
    const firstDone = new Set();
    familyUnsub = fb.onSnapshot(fb.doc(db, 'families', fid), s => {
      family = s.exists() ? s.data() : null;
      if (currentTab === 'settings') scheduleRender();
    }, err => onError(err));
    for (const name of Object.keys(COLS)) {
      synced[name] = new Map();
      const ref = fb.collection(db, 'families', fid, name);
      unsubs.push(fb.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
        if (!firstDone.has(name)) {
          // オフラインで端末にまだ何もない状態の「空」は信用せず、サーバーからの返事を待つ
          if (snap.metadata.fromCache && snap.empty) return;
          firstDone.add(name);
          synced[name] = new Map(snap.docs.map(d => [d.id, stable(d.data())]));
          const recs = snap.docs.map(docRecord);
          COLS[name].set(COLS[name].ordered ? sortOrdered(name, recs) : recs);
          if (firstDone.size === Object.keys(COLS).length) onReady();
          return;
        }
        applyChanges(name, snap.docChanges());
        updateBadge();
      }, err => onError(err)));
    }
  }

  function onReady() {
    if (!state.members.some(m => m.id === FAMILY_ID)) state.members.unshift(defaultState().members[0]);
    ready = true;
    lastError = '';
    save();
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
      if (s.get(id) === j) continue; // 自分が送った変更
      s.set(id, j);
      const rec = docRecord(ch.doc);
      const i = arr.findIndex(r => r.id === id);
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      changed = true;
    }
    if (!changed) return;
    c.set(c.ordered ? sortOrdered(name, arr) : arr);
    if (name === 'members' && !state.members.some(m => m.id === FAMILY_ID)) state.members.unshift(defaultState().members[0]);
    save();
    scheduleRender();
  }

  function onError(err) {
    console.error(err);
    lastError = err && err.code === 'permission-denied'
      ? 'この家族のデータを見る権限がありません（招待されたメールアドレスでログインしているか確認してください）'
      : `同期でエラーが起きました（${(err && err.code) || err}）`;
    updateBadge();
    if (currentTab === 'settings') scheduleRender();
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
      for (const id of [...s.keys()]) if (!cur.has(id)) { ops.push({ name, id, del: true }); s.delete(id); }
    }
    if (!ops.length) return;
    for (let i = 0; i < ops.length; i += 400) {
      const batch = fb.writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        const ref = fb.doc(db, 'families', conf.fid, op.name, op.id);
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

  /* ---------- 家族の作成・参加 ---------- */
  async function createFamily(emailsText) {
    const me = (user.email || '').toLowerCase();
    const others = String(emailsText || '').split(/[\s,、]+/).map(x => x.trim().toLowerCase()).filter(x => x && x.includes('@'));
    const fid = randomId();
    await fb.setDoc(fb.doc(db, 'families', fid), { emails: [...new Set([me, ...others])], createdBy: me, createdAt: fb.serverTimestamp() });
    conf.fid = fid;
    delete conf.invite;
    saveConf();
    // このスマホのデータをそのままアップロード
    for (const name of Object.keys(COLS)) synced[name] = new Map();
    ready = true;
    push();
    listen();
  }

  async function joinFamily(fid) {
    fid = String(fid || '').trim();
    if (!fid) return;
    try {
      const s = await fb.getDoc(fb.doc(db, 'families', fid));
      if (!s.exists()) { toast('家族が見つかりません。招待コードを確認してください'); return; }
    } catch (e) {
      toast(e.code === 'permission-denied' ? 'このメールアドレスは招待されていません。招待した人に「家族に追加」してもらってください' : '参加できませんでした（' + (e.code || e) + '）');
      return;
    }
    const ok = await choose('家族のデータに参加します。\nこのスマホに入っているデータは、家族の共有データに置き換わります。', [
      { label: 'キャンセル', value: false }, { label: '参加する', value: true, cls: 'primary' }]);
    if (!ok) return;
    conf.fid = fid;
    delete conf.invite;
    saveConf();
    listen();
    toast('家族に参加しました');
  }

  /* ---------- 設定画面 ---------- */
  function setupSteps() {
    return `<details class="setup-steps"><summary>はじめての設定方法（最初の1人だけ・約10分）</summary>
      <ol>
        <li><a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebaseコンソール</a>をGoogleアカウントで開き、「プロジェクトを作成」（名前は例：kazoku-techo。Googleアナリティクスはオフで可）。</li>
        <li>左メニュー「構築 → Authentication」→「始める」→ ログイン方法で「メール / パスワード」を有効にする。</li>
        <li>「構築 → Firestore Database」→「データベースを作成」（ロケーションは asia-northeast1（東京）がおすすめ、「本番環境モード」で開始）。</li>
        <li>Firestoreの「ルール」タブを開き、<a href="https://github.com/nora-ku17/inari/blob/main/kazoku/firestore.rules" target="_blank" rel="noopener">このルール（firestore.rules）</a>の内容をすべて貼り付けて「公開」。</li>
        <li>プロジェクトの概要の「&lt;/&gt;（ウェブ）」でアプリを登録し、表示された <code>firebaseConfig</code> の部分をコピーして、下の欄に貼り付ける。</li>
      </ol>
      <p class="hint">2人目（夫・妻）は、設定後に表示される「招待リンク」を開くだけで参加できます。無料枠で十分に使えます。</p>
    </details>`;
  }

  function panel() {
    const s = statusInfo();
    let body = '';
    if (!conf.config) {
      body = `<p>夫婦それぞれのスマホで、予定や家計簿の変更が自動で反映されるようにします。データは家族専用のクラウド（あなたのFirebase）に保存され、招待したメールアドレスの人だけが見られます。</p>
        ${setupSteps()}
        <form id="sync-config-form" class="sync-form">
          <label class="field"><span class="lbl">firebaseConfig を貼り付け</span>
            <textarea name="config" rows="5" placeholder="const firebaseConfig = {&#10;  apiKey: &quot;...&quot;,&#10;  authDomain: &quot;...&quot;,&#10;  projectId: &quot;...&quot;, ...&#10;};" required></textarea></label>
          <button class="btn primary">設定する</button>
        </form>
        <p class="hint">招待リンクを受け取った人は、ここで何もせず招待リンクを開いてください。</p>`;
    } else if (initError) {
      body = `<p class="sync-err">${esc(initError)}</p><button class="btn" data-action="sync-forget">同期の設定をやり直す</button>`;
    } else if (!authReady) {
      body = '<p class="hint">接続しています…</p>';
    } else if (!user) {
      body = `${conf.invite ? '<p class="sync-note">📩 家族から招待されています。招待されたメールアドレスでアカウントを作るか、ログインしてください。</p>' : ''}
        <form id="sync-login-form" class="sync-form" autocomplete="on">
          <div class="row">
            <label class="field"><span class="lbl">メールアドレス</span><input type="email" name="email" autocomplete="username" required></label>
            <label class="field"><span class="lbl">パスワード（6文字以上）</span><input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
          </div>
          <div class="btn-row">
            <button class="btn primary" name="mode" value="login">ログイン</button>
            <button class="btn" name="mode" value="signup">はじめて（アカウントを作る）</button>
            <button type="button" class="link-btn" data-action="sync-reset-pw">パスワードを忘れた</button>
          </div>
        </form>
        <p class="hint"><button class="link-btn" data-action="sync-forget">同期の設定を削除</button></p>`;
    } else if (!conf.fid) {
      body = `<p>ログイン中：<b>${esc(user.email)}</b></p>
        ${conf.invite ? `<div class="sync-note">📩 家族から招待されています。<div class="btn-row" style="margin-top:8px"><button class="btn primary" data-action="sync-join-invite">家族に参加する</button></div></div>` : ''}
        <div class="sync-choice">
          <form id="sync-create-form" class="sync-box">
            <h4>家族を新しく作る</h4>
            <p class="hint">このスマホのデータを家族の共有データにします（最初の1人）。</p>
            <label class="field"><span class="lbl">一緒に使う人のメールアドレス（夫・妻など）</span><input type="email" name="emails" placeholder="partner@example.com" multiple></label>
            <button class="btn primary">作成して同期を始める</button>
          </form>
          <form id="sync-join-form" class="sync-box">
            <h4>招待コードで参加</h4>
            <p class="hint">家族のデータに参加します（このスマホのデータは置き換わります）。</p>
            <label class="field"><span class="lbl">招待コード</span><input name="fid" required autocomplete="off"></label>
            <button class="btn">参加する</button>
          </form>
        </div>
        <p class="hint"><button class="link-btn" data-action="sync-logout">ログアウト</button></p>`;
    } else {
      const emails = family && Array.isArray(family.emails) ? family.emails : [];
      body = `<p>ログイン中：<b>${esc(user.email)}</b></p>
        ${lastError ? `<p class="sync-err">${esc(lastError)}</p>` : ''}
        <div class="sync-box">
          <h4>この家族のメンバー（ログインできる人）</h4>
          <ul class="email-list">${emails.map(e => `<li>${esc(e)}${e === (user.email || '').toLowerCase() ? '（あなた）' : ''}</li>`).join('') || '<li class="hint">読み込み中…</li>'}</ul>
          <form id="sync-add-email-form" class="inline-form"><input type="email" name="email" placeholder="追加するメールアドレス" required><button class="btn">家族に追加</button></form>
        </div>
        <div class="sync-box">
          <h4>夫・妻のスマホを招待</h4>
          <ol class="mini-steps">
            <li>上の「家族に追加」で相手のメールアドレスを登録</li>
            <li>下の招待リンクを LINE などで送る</li>
            <li>相手がリンクを開き、そのメールアドレスでアカウントを作って「家族に参加する」</li>
          </ol>
          <div class="btn-row">
            <button class="btn primary" data-action="sync-share">招待リンクを送る</button>
            <button class="btn" data-action="sync-copy">リンクをコピー</button>
          </div>
          <p class="hint">招待コード：<code>${esc(conf.fid)}</code></p>
        </div>
        <div class="btn-row">
          <button class="btn" data-action="sync-logout">ログアウト</button>
          <button class="btn danger-text" data-action="sync-leave">このスマホの同期をやめる</button>
        </div>`;
    }
    return `<div class="card sync-card" id="sync-card">
      <div class="card-head"><h3>☁ 家族で同期</h3>${s ? `<span class="sync-badge ${s.cls}">${s.icon} ${esc(s.text)}</span>` : ''}</div>
      ${body}</div>`;
  }

  /* ---------- 操作 ---------- */
  Object.assign(actions, {
    'sync-forget': async () => {
      if (!(await confirmYes('このスマホの同期設定を削除します（このスマホのデータは残ります）。', '削除する'))) return;
      try { if (auth) await fb.signOut(auth); } catch (e) { /* noop */ }
      localStorage.removeItem(CONF_KEY);
      location.reload();
    },
    'sync-logout': async () => { await fb.signOut(auth); toast('ログアウトしました'); },
    'sync-leave': async () => {
      if (!(await confirmYes('このスマホの同期をやめます。\n家族の共有データは消えません。このスマホのデータもそのまま残ります。', '同期をやめる'))) return;
      stopListen();
      delete conf.fid;
      saveConf();
      render();
    },
    'sync-join-invite': () => joinFamily(conf.invite),
    'sync-share': async () => {
      const url = encodeInvite();
      const text = 'かぞく手帳で予定を共有しよう！このリンクを開いて、招待されたメールアドレスでアカウントを作ってね。';
      if (navigator.share) { try { await navigator.share({ title: 'かぞく手帳への招待', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      actions['sync-copy']();
    },
    'sync-copy': async () => {
      const url = encodeInvite();
      try { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました'); }
      catch (e) { openDialog(`<div class="dlg-form">${dlgHead('招待リンク')}<textarea rows="5" readonly onclick="this.select()">${esc(url)}</textarea></div>`); }
    },
    'sync-reset-pw': async () => {
      const f = document.getElementById('sync-login-form');
      const email = f && f.email.value.trim();
      if (!email) { toast('メールアドレスを入力してから押してください'); return; }
      try { await fb.sendPasswordResetEmail(auth, email); toast('パスワード再設定のメールを送りました'); }
      catch (e) { toast('送信できませんでした（' + (e.code || e) + '）'); }
    },
  });

  const AUTH_ERRORS = {
    'auth/invalid-credential': 'メールアドレスかパスワードが違います',
    'auth/wrong-password': 'パスワードが違います',
    'auth/user-not-found': 'このメールアドレスのアカウントがありません。「はじめて」から作ってください',
    'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。「ログイン」してください',
    'auth/weak-password': 'パスワードは6文字以上にしてください',
    'auth/invalid-email': 'メールアドレスの形式が正しくありません',
    'auth/operation-not-allowed': 'Firebaseで「メール / パスワード」ログインが有効になっていません',
    'auth/network-request-failed': 'ネットワークにつながっていません',
    'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからお試しください',
  };

  async function onSubmit(f, fd, submitter) {
    switch (f.id) {
      case 'sync-config-form': {
        const c = parseConfig(fd.get('config') || '');
        if (!c) { toast('apiKey・projectId・appId が見つかりません。firebaseConfig をそのまま貼り付けてください'); return true; }
        conf = { config: c };
        saveConf();
        location.reload();
        return true;
      }
      case 'sync-login-form': {
        const email = fd.get('email').trim(), pw = fd.get('password');
        const mode = submitter && submitter.value === 'signup' ? 'signup' : 'login';
        try {
          if (mode === 'signup') await fb.createUserWithEmailAndPassword(auth, email, pw);
          else await fb.signInWithEmailAndPassword(auth, email, pw);
          toast('ログインしました');
        } catch (e) { toast(AUTH_ERRORS[e.code] || `ログインできませんでした（${e.code || e}）`); }
        return true;
      }
      case 'sync-create-form': {
        try { await createFamily(fd.get('emails')); toast('家族を作成しました。招待リンクを送りましょう'); }
        catch (e) { console.error(e); toast('作成できませんでした（' + (e.code || e) + '）。Firestoreのルールを確認してください'); }
        return true;
      }
      case 'sync-join-form': await joinFamily(fd.get('fid')); return true;
      case 'sync-add-email-form': {
        const email = fd.get('email').trim().toLowerCase();
        try { await fb.updateDoc(fb.doc(db, 'families', conf.fid), { emails: fb.arrayUnion(email) }); toast(`${email} を家族に追加しました`); }
        catch (e) { toast('追加できませんでした（' + (e.code || e) + '）'); }
        return true;
      }
    }
    return false;
  }

  window.addEventListener('online', updateBadge);
  window.addEventListener('offline', updateBadge);

  return { init, panel, schedulePush, onSubmit, isConnected, updateBadge };
})();

window.Sync = Sync;
Sync.init();
