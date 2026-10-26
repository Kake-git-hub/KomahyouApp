---
name: komahyou-schedulehtml-embedded-script
description: scheduleHtml.ts のクライアントJSはテンプレートリテラル内の文字列。エスケープ崩れがビルドをすり抜け実行時に全停止する
metadata: 
  node_type: memory
  type: project
  originSessionId: 6e52e408-fe6f-4152-a9dc-57b2dec507eb
---

`src/utils/scheduleHtml.ts` の `createScheduleHtml` は、印刷用日程表ページ全体を**バッククォートのテンプレートリテラル**として返す。その中の `<script>…</script>` に入るクライアントJS（render/各種 buildXxxSheetHtml/イベントバインドなど数千行）は、すべて**テンプレートリテラル内のリテラル文字列**であって、tsc/vite はその中身を構文解析しない。

**落とし穴:** クライアントJS内で `\'`（エスケープしたシングルクォート）を書くと、外側のテンプレートリテラルがそれを評価して素の `'` に変換してしまい、出力された文字列リテラルが途中で閉じて**構文エラー**になる。スクリプト全体が実行されず、生徒/講師表示・講習期間・選択肢が出ずボタンも無反応の「真っ白」状態になる。ビルドは通るので気付きにくい（2026-06-09 に空フォーマット印刷機能で発生・修正）。

**書き方の鉄則:** 入れ子のクォートは「JS文字列はシングルクォート／HTML属性はダブルクォート」で揃え、`\'` `\"` やバッククォート・`${` をクライアントJSのリテラルに持ち込まない。動的に `<script>` を組むときも `'<scr' + 'ipt>'` のように分割する既存パターンに従う。

**回帰防止テスト:** `scheduleHtml.test.ts` に、生成HTMLから属性なし `<script>` ブロックを抽出して `new Function(block)` で構文検証するテストあり（"emits a syntactically valid inline client script"）。埋め込みスクリプトをいじったらこれが番人になる。

関連: [[komahyou-save-architecture]]
