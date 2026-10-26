---
name: komahyou-empty-format-standalone-persistence
description: 空フォーマットは専用ストレージで連絡事項/オプションを保持し編集してから印刷(自動印刷廃止)
metadata: 
  node_type: memory
  type: project
  originSessionId: ef47b5ac-c792-488b-965c-f290bbe2775b
---

空フォーマット(生徒日程表の emptyFormat=true 分岐)の「単体で入力・保持」実装の確定設計(v1.5.440・2026-07-11・オーナー確認済み)。

**保存先は実データから独立**: 空フォーマットの共通連絡事項(学年別)/個別連絡事項/オプションは、通常の生徒日程表が使う `DATA.scheduleNotes`(data-note-key/memo-input 経由)から**切り離し**、専用ストレージ `sharedGlobalStoragePrefix + 'empty-format:' + フィールド名`(localStorage)へ保存する。マークアップは emptyFormat のとき `data-empty-format-field="common|individual|option-N"` を出し、data-note-key と memo-input クラスを外す(`renderBottomSection`/`renderOptionSection`)。→ 空フォーマットで入力しても本物の生徒/学年の連絡事項・オプションは絶対に書き換わらない。オーナーは「空フォーマット単体で」＝実データと独立、を選択(共有案は却下)。

**編集してから印刷**: `openEmptyFormatPrintWindow` は自動印刷(旧 setTimeout window.print)を**廃止**。印刷ボタン(`.empty-format-toolbar` print-only-hidden)＋入力保持スクリプト `buildEmptyFormatEditorScript(prefix)` を注入。エディタは `window.opener.localStorage`(なければ自ウィンドウ)を PREFIX 付きキーで読み書きし、開き直しても保持する。埋め込み JS のエスケープ崩れは new Function パーステストで固定([[komahyou-schedulehtml-embedded-script]] の罠)。

**⚠️ pointer-events の罠(v1.5.441 で修正)**: 空フォーマットのポップアップは `<body class="all-view">` で書き出すが、CSS `body.all-view .sheet { pointer-events: none }`(一覧は非操作の設計・scheduleHtml.ts 1117付近)を欄が継承し、**クリックしても入力モードに入れない**不具合が出た。修正はポップアップに `<style>[data-empty-format-field]{pointer-events:auto;}</style>` を注入し、欄だけ再有効化(継承 none を子要素で auto へ上書き=標準的手法)。空フォーマットに新しい入力要素を足すときは all-view の pointer-events:none を必ず上書きすること。実ブラウザ検証は elementFromPoint がフィールドに当たるか(HITS-FIELD)で判定できる。

**ロゴ/校舎名TEL は生徒日程表と共通**: 従来の `applyEmptyFormatBranding`(共有ストレージ school-info/sheet-title/logo を文字列置換で流し込み)を維持。#4 は既実装で、その動作を保つだけ。

関連: 講習集計結果(生徒版)のオプション列は countSubmitted 済みのみ表示(希望科目/提出方法列と整合・`formatLectureOptionCell`)、DATA.optionFieldEnabled(開発用教室)限定。INV-04(日程表の経路一致・準観察)領域。回帰レビュー済み(巻き戻し/INV違反なし)。[[komahyou-invariant-registry-plan]]
