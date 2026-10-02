# 1 SECOND DATA — 実験データ収集版

このリポジトリ `one-second-data-experiment` は、既存の `one-second-data` を複製した **「1 SECOND DATA の実験データ収集版」** です。元アプリの測定機能・統計計算・画面構成・デザイン・CSVダウンロードを維持しています。

測定完了時に、1セッション分の実験データを専用のGoogle Apps Script（GAS）Web Appへ1回だけPOSTします。元アプリのアクセス記録GET送信は含みません。

設定は元アプリと同じく、目標時間 **1秒／3秒／5秒**、測定回数 **10回／30回／50回／100回**、フィードバック **「毎回の測定結果を見る」／「測定中は結果を見ない」** に対応します。

時計を見ずに一定の間隔でタップして、自分の時間感覚を統計で観察するアプリです。HTML / CSS / JavaScriptのみ。外部ライブラリ、ログイン、ビルドは不要です。測定・結果表示・CSV保存はオフラインでも動作し、実験データ送信にのみ通信を使用します。

## 使い方

`index.html` をブラウザで開くか、ローカルサーバー（例：`python3 -m http.server 8000`）で表示します。
目標時間・回数・フィードバックを設定して「準備する」で測定画面へ進みます。この時点では計測しません。中央の START を押した瞬間から第1回を測定し、同じボタンは STOP に変わります。各 STOP は前回の測定終了と次回の測定開始を兼ねます。指定回数の最後の STOP で自動終了します。タッチ、マウス、中央ボタンにフォーカスした状態でのスペース／Enterに対応します。

## GitHub Pages

ファイルをリポジトリにpushし、GitHubの **Settings → Pages → Build and deployment → Deploy from a branch** で `main` ブランチの `/ (root)` を選んで保存します。サブディレクトリでの公開にも対応しています。

## 計算と表示

- `performance.now()` の未丸めミリ秒値を保持。統計量は元データで計算。
- 平均、中央値、母分散（nで除算）、標準偏差、最小値、最大値を表示。
- 時間は秒に換算して小数第2位、分散は秒²に換算して小数第4位で表示。
- ヒストグラムは目標時間の5%（1秒なら0.05秒）を基本候補に階級幅を調整。四分位範囲を使って極端な値を検出し、端の開区間に集約。データの除外はしません。表とグラフは同じ階級データを使用します。
- 測定順グラフは全測定値を順番どおりに表示し、外れ値も軸の範囲に含めます。
- ページを閉じたり再読み込みしたりするとブラウザ内の測定データは消えます（送信先に保存済みのデータは削除されません）。タブの切り替え中も経過時間に含まれます。

## 検証

`node --test tests/stats.test.cjs tests/submission.test.cjs` で測定・統計・階級・送信処理・ID生成の単体テストを実行できます。

ブラウザ統合テストは Playwright を利用して `node tests/browser.cjs` で実行します（テスト時のみ必要）。必要に応じて `CHROME_PATH` にChromeの実行ファイルを指定します。時刻を制御した全24条件（3種類の目標時間 × 4種類の測定回数 × 2種類のフィードバック）で、全測定間隔、終了回数、統計量、グラフの順序、表との一致を検証し、CSVの内容と390px・768px・1440px幅の表示を確認します。この回帰テストでは送信先を無効化し、外部HTTP通信が発生しないことも検証します。

`node tests/submission.browser.cjs` は全24条件の送信タイミング・設定値・未丸めデータ・ISO日時・重複防止を検証します。途中リセット、再測定時の別ID、通信の例外／拒否／未完了、受付OFFを模擬した場合の結果・グラフ・CSVも確認します。送信はモックで捕捉し、実際のGASへの通信は行いません。

## CSVダウンロード

結果画面の「CSVダウンロード」から、測定回・測定時間（秒）と、目標・平均・中央値・母分散（秒²）・標準偏差・最小値・最大値・測定回数を保存できます。数値は画面表示用に丸める前の値を出力します。日本語版Excelで文字化けしにくいUTF-8 BOM付き、CRLF改行のCSVです。保存はブラウザ内で処理します。

## 実験データ送信

- `experiment-config.js` の `endpoint` に実験データ専用のGAS Web App URLを設定しています。空文字なら送信を無効化できます。`appVersion` は `one-second-data-experiment/1.0.0`、スキーマは `1` です。
- 「準備する」ではセッションを作らず、中央のSTARTで `session_id` と `started_at` を生成します。日時はUTCのISO 8601形式です。IDは `crypto.randomUUID()`、利用不可なら `crypto.getRandomValues()` によるUUID v4、Web Crypto自体がなければ日時・連番・ランダム値の組み合わせを使います。
- 測定時間は従来どおり `performance.now()` で記録します。指定回数の最後のSTOPで `completed_at` を記録し、結果表示後に `session.values` の未丸めミリ秒値を順序どおりJSONへコピーしてPOSTします。
- 送信開始前に送信対象を消費し、失敗しても再送しません。描画・CSV保存・リセット・再測定は再送の契機になりません。未完了の測定は送信しません。次のSTARTでは新しいIDを生成します。
- JSON本文は `Content-Type: text/plain;charset=UTF-8`、`mode: no-cors` で送ります。GAS側は `JSON.parse(e.postData.contents)` で読み取る想定です。`application/json` のContent-Typeを必須にするGAS実装では調整が必要です。
- `no-cors` の応答は読み取れないため、保存成功・受付OFF・サーバーエラーをブラウザから判定しません。通信失敗・応答待ちの状態でも測定・結果・CSVは継続でき、技術情報を参加者画面に表示しません。自動再試行・送信待ちデータの永続化は行いません。
- クライアントは各完了セッションにつきPOSTを1回だけ試みます。サーバー側の保存成功は保証せず、保存段階の重複排除が必要な場合はGAS側でも `session_id` をキーにしてください。

送信例（1秒・10回・フィードバックあり）：

```json
{
  "session_id": "47868c7a-29a8-4302-9a65-5a5380b30441",
  "started_at": "2026-10-02T12:00:00.000Z",
  "completed_at": "2026-10-02T12:00:10.000Z",
  "target_seconds": 1,
  "planned_count": 10,
  "feedback_mode": "on",
  "measurements_ms": [957.5, 978.75, 1000, 1021.25, 1042.5, 957.5, 978.75, 1000, 1021.25, 1042.5],
  "app_version": "one-second-data-experiment/1.0.0",
  "schema_version": "1"
}
```

通信方式の参考：[GAS Web Apps](https://developers.google.com/apps-script/guides/web)、[Fetch APIのno-cors制約](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)。
