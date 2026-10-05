# kakeibo

楽天カードの利用通知メールから、広告なしで「今月いくら使ったか」を見る自分用の家計簿（PWA）。

- 時間帯と季節で、ホームの写真と色が変わる（朝・夕方／昼／夜 × 春夏秋冬）
- 費用は0円：Gmail → Google Apps Script → スプレッドシート → GitHub Pages
- Gmail は読み取り専用の権限だけ。インターネットから呼ばれる API は Gmail の権限を持たない別の Apps Script

## 構成

| フォルダ | 中身 |
|---|---|
| `web/` | PWA（GitHub Pages で公開） |
| `gas/` | Google Apps Script（取り込み・API）。`node gas/build.js` で貼り付け用にまとめる |
| `docs/` | 要件定義・画面設計・システム設計・準備の手順・安全の確認 |

API の URL と合言葉はリポジトリに置かない。アプリの最初の画面で入れて、端末にだけ保存する。

## テスト

```bash
node gas/test/test.js
node gas/test/test_api.js
node web/test/test.mjs
```

見本のデータで画面を見るときは、URL の後ろに `?mock=1` を付ける。

## 写真

Unsplash（Unsplash License）。一覧は `web/images/CREDITS.md`。
