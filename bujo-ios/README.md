# バレットジャーナル iOS 版 (Capacitor)

Web アプリ本体は `../bujo`。ここはそれを iOS アプリに包むための設定です。
**Mac + Xcode が必要**です(この環境の Linux ではビルドできません)。

## 初回セットアップ(Mac)
```sh
cd bujo-ios
npm install
# capacitor.config.json の appId を、自分の逆ドメイン形式に変更(例: com.yourname.bujo)
npx cap add ios
npm run sync      # ../bujo を www にコピーして ios に反映
npm run open      # Xcode が開く
```
Xcode で Signing & Capabilities の Team を選び、実機かシミュレータで実行します。

## Web を直したあと
`npm run sync` してから Xcode で再ビルド。

## 保存データ
ネイティブでは `bujo/storage.js` が Capacitor の Preferences に保存します
(初回は localStorage の内容を引き継ぎ)。iCloud 同期にするなら storage.js の中身を差し替えます。

## App Store 申請前のチェック
- Apple Developer Program 登録(年額 $99 前後)
- appId / アプリ名 / アイコン(1024×1024)/ スクリーンショット
- プライバシーポリシーの URL(データは端末内のみ、と明記)
- 審査 4.2 対策: Web を包んだだけと見なされないよう、ネイティブ機能(通知・ウィジェット・Face ID ロックなど)を最低1つ入れる
- 株売買欄は「記録のみ」。売買の助言・推奨に見える表現は入れない
