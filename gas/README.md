# GAS導入手順（まだデプロイしていません）

## 構成

- `receiver/Code.gs`：提供された受信用コードを基に、data_type の検証と末尾列への保存だけを追加。既存の公開URLで使います。
- `admin/Code.gs`、`admin/Admin.html`、`admin/appsscript.json`：**別の管理者専用プロジェクト**用。受信用プロジェクトへ混在させないでください。
- 元の one-second-data は対象外です。GitHub Pages に管理データや認証情報を置きません。

## 1. 先に受信用GASを更新

1. 現在のコード・デプロイのバージョン番号とシートのバックアップを保存します。
2. 受信用プロジェクトのコードを `receiver/Code.gs` に更新します。既存のシートを削除・作り直ししないでください。
3. `migrateDataType_` をエディタから実行します。既存の110列を照合し、111列目（DG列）に `data_type` ヘッダーだけを追加します。既存行は書き換えません。不一致なら中断します。再実行しても既存列を変更しません。初回受信時にも同じ確認をロック内で行います。
4. 「デプロイを管理」から**既存の受信用デプロイを新バージョンに更新**し、URLを維持します。実行：自分、アクセス：全員を維持します。
5. その後、参加者アプリの更新を公開します（今回コミット・push・公開は行っていません）。

旧クライアントの data_type 省略は production として保存します。明示された不正値・空文字・null は拒否します。既存の空欄・列未追加のデータは管理画面で production とみなし、区分未記録件数も示します。旧行を本番と断定して書き換えることはありません。schema_version は後方互換の追加項目として 1 を維持します。

## 2. 管理者専用GASを新規作成

1. 自分のGoogleアカウントで別のApps Scriptプロジェクトを作成します。
2. `admin/Code.gs`、HTMLファイル名 `Admin`、`admin/appsscript.json` を追加します。マニフェストはプロジェクト設定で表示できます。
3. プロジェクト設定 → スクリプトプロパティに次を設定します（GitHubには書かないでください）。
   - `SPREADSHEET_ID`：既存の実験データスプレッドシートのID。
   - `ADMIN_EMAIL`：デプロイするご本人のGoogleアカウントのメールアドレス。
4. Web Appとして新規デプロイします。**次のユーザーとして実行：自分、アクセスできるユーザー：自分のみ**を確認します。マニフェストも `USER_DEPLOYING` / `MYSELF` を指定しています。
5. 必要な権限を承認し、管理者URLをブックマークします。全員公開や参加者用URLへの差し替えはしません。

全公開関数で ActiveUser のメールを照合し、取得できない場合も拒否します。EffectiveUser（実行所有者）だけでアクセス者の認証を代替しません。設定が不一致なら画面もデータも返しません。別アカウント・未ログインで開けないことは実デプロイ後に確認してください。

## 管理画面

受付状態・ON/OFF切替、全体の本番／テスト／全件／区分不明件数、区分未記録件数、最新受信日時、目標時間・フィードバック・予定回数別集計を表示します。全体集計は検索条件で変わらず、抽出件数・一覧・CSVだけが検索条件に従います。

検索は全条件のANDです。受信日の両端を含み、スプレッドシートのタイムゾーンで判定します。一覧は1ページ50件、新しい行から表示します。測定値も横スクロールで全列確認できます。CSVは一覧ページによらず抽出全件・元の全保存列を出力し、区分未記録の空欄も保持します。一覧の effective_data_type / legacy_data_type は補助表示です。CSVはUTF-8 BOM・CRLF・引用符エスケープ付きで、数値は丸めません。数式として解釈される文字列には安全のため先頭にアポストロフィを付けます。

削除・行削除・初期化のAPIやボタンはありません。唯一の管理画面からの書き込みは settings の accepting 値です。受信用 setup は元コードの非破壊的な空シート作成処理で、管理画面には公開しません。

OFF切替前に受信側で受付判定を通過した処理は、切替後にも保存される場合があります。別GAS間でスクリプトロックは共有されません。受付ロジックは元の挙動を維持しています。

現在は検索・CSV時にシート全体を読みます。大量データではGAS実行時間や応答サイズの上限に達する可能性があり、その場合は受信日などで絞り込んでCSVを分割してください（読み込み量自体の最適化は将来対応）。失敗時に途中までのCSVを成功扱いでダウンロードする機能はありません。

## 3. ローカルからテスト送信

受信用GAS更新後、Macでは `tools/start-test.command` をダブルクリックするか、リポジトリで `zsh tools/start-test.command` を実行します（Node.jsまたはCodex同梱Nodeを使用）。他の環境では `node tools/test-server.cjs` を実行します。その後、`http://127.0.0.1:8765` を開きます。TEST表示のページだけが test を送ります。実際にGASへ保存するため受付をONにしてください。終了はCtrl+Cです。

公開ファイルを上書きせず、ローカルサーバーが設定を付加します。127.0.0.1だけにバインドし、提供ファイルも参加者アプリだけに限定します。公開版はURLパラメーター・localStorageから切り替わらず、公開ホストでは localTest 設定があっても production を送ります。data_type は分類情報であり、公開受信APIの送信者認証には使いません。

## ローカル検証

```
node --test tests/stats.test.cjs tests/submission.test.cjs tests/gas.test.cjs tests/test-server.test.cjs
node tests/browser.cjs
node tests/submission.browser.cjs
node tests/admin.browser.cjs
```

ブラウザテストはPlaywrightが必要です。必要なら NODE_PATH / CHROME_PATH を指定します。GASサービス・認証・通信はローカルで模擬し、実データにはアクセスしません。実際の権限・GASの保存・管理画面の操作は、デプロイ後の別途確認事項です。

参考：[GAS Web Apps](https://developers.google.com/apps-script/guides/web)、[Session](https://developers.google.com/apps-script/reference/base/session)、[HTML Service通信](https://developers.google.com/apps-script/guides/html/communication)。
