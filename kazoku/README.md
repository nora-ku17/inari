# かぞく手帳

家族の予定（カレンダー・A4印刷）、家族でやりたい100のこと、家計簿、個別株・配当をまとめて管理するアプリです。

- 公開URL（GitHub Pages）: https://nora-ku17.github.io/inari/kazoku/
- スマホで開いて「ホーム画面に追加」すると、アプリとして全画面で使えます（オフラインでも開けます）。

## 夫婦で自動同期する（最初の1人だけ設定・約10分）

1. [Firebaseコンソール](https://console.firebase.google.com/)でプロジェクトを作成する（無料プランで十分）
2. **Authentication** →「始める」→ ログイン方法で **メール / パスワード** を有効にする
3. **Firestore Database** →「データベースを作成」（ロケーション: `asia-northeast1`（東京）、本番環境モード）
4. Firestore の **ルール** タブに [`firestore.rules`](firestore.rules) の中身を貼り付けて「公開」
5. プロジェクトの概要で「</>（ウェブ）」アプリを登録し、表示された `firebaseConfig` をコピー
6. アプリの「家族・設定 → 家族で同期」に貼り付け → アカウント作成 →「家族を新しく作る」（相手のメールアドレスを入力）
7. 「招待リンクを送る」で相手に送信。相手はリンクを開き、招待されたメールアドレスでアカウントを作って「家族に参加する」

## しくみ

| ファイル | 内容 |
| --- | --- |
| `index.html` / `style.css` / `app.js` | アプリ本体（ビルド不要） |
| `sync.js` | Firebase による家族同期。予定や家計簿を1件ずつ保存するので、同時に編集しても上書きし合いません |
| `firestore.rules` | 家族に登録したメールアドレスの人だけが読み書きできるルール |
| `sw.js` / `manifest.webmanifest` / `icons/` | アプリ化（PWA）・オフライン対応 |
| `vendor/firebase-10.14.1.js` | Firebase SDK（`firebase@10.14.1` を esbuild で1ファイルにまとめたもの） |

アプリのファイルを更新したときは、`sw.js` の `VERSION` を上げると各スマホに新しい版が届きます。
