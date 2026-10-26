---
name: komahyou-plan-2026-09-11-five-requests
description: 2026-09-11 起案(第2版)のオーナー要望6件の計画の所在・確定事項・モデル分担。2026-09-13 時点: U-0/P/H/Q-2/K 完了・P は全教室昇格(v1.5.510)・Q-2 質問種別(v1.5.511)・K 保護者QR 第1段は開発用教室限定で本番反映(v1.5.512)・残は Q-3〜Q-6 と O-1/O-2(保留)
metadata: 
  node_type: memory
  type: project
  originSessionId: ccb7180d-501e-4caf-97a0-875464d309b8
  modified: 2026-09-13T11:39:21.567Z
---

# オーナー要望6件の実装計画（2026-09-11 起案・第2版・v1.5.499 で docs 反映）

**正本**: `docs/plan-2026-09-11-five-requests.md`（§0 に起動プロンプト、§1 に着手順、§9 にオーナー回答欄）。コード変更なし。

## オーナー確定事項（2026-09-11）
- **戻るボタンの再定義は保留**。実施は U-0（保存後に undo/redo を押すと盤面が保存済み扱いになり保存不能・リロードで巻き戻る疑い）のみ。
  機序: `ScheduleBoardScreen.tsx` handleUndo(:11310)/handleRedo が版数を上げず publish effect(:5458)が userInitiated:false → `App.tsx:2510` が
  `markStateLoadedClean()`。undo 履歴は保存で消えない。②`restoreUndoSnapshot`(App.tsx:2213)も同型。INV-02 に分類。統一 undo の障害一覧は計画 §2-3 に記録。
- **盤面PDF**: A3 縦固定のまま（用紙は利用者が印刷設定で変える）。曜日×時限のグリッド選択→選択コマだけ A3 に最大化。初期状態は全選択＝現状と同一出力。
- **質問種別**: AI 提供者非依存・即時不要・**利用者への即答なし**（承認済み回答のみ見せる。類似QA提示は「公開してよい回答」の定義後）。
  第1段=ルートB（承認画面の「AI用プロンプトをコピー」→任意AIに貼付→回答案を貼り戻し）。ルートA=Claude Code スキル（下書き表示のみ・Firestore へ書かない）。
  ルートC=Cloud Functions 自動（`@anthropic-ai/sdk`・既定 claude-opus-5・Batches 半額）は API 契約決定後。
  費用試算: 入力23K+出力1K/件で Opus 5 ≈¥21、Sonnet 5 ≈¥8、Batches で半額、固定費なし（月100件で ¥840〜2,100）。
- **（2026-09-12 追加・第3版）報告・要望・質問のすべてを当面は API 不使用**。Firestore に蓄積し、開発者が後から AI でまとめて読む
  （読み取り専用ツール `tools/developer-report-digest.mjs` でダイジェスト作成→Claude Code スキル `report-digest` か任意の AI に貼る）。
  **【第4版で上書き】AI には全データを渡してよい設計（オーナー指示 2026-09-12）＝伏字化・除外はしない**（操作痕跡・教室データ・送信者も渡す）。
  3種別は同じ扱いで「ストック→メール通知→後で開発者が対応」、実行頻度は決めない。
  ダイジェストを公開リポにコミットしない（`local/report-digests/`）のは AI 制限ではなく公開リポへの流出防止。
  スキルは整理結果を表示するだけで Issue コメントや Firestore 書込はしない。API 自動処理は将来オプション（Q-7）。
  Claude API は月額契約不要の前払いクレジット従量制（Console で上限と自動チャージ設定可）とオーナーに説明済み。
- **講習履歴**: 承知（`lessonLedgerDays` を callable で読み、日程表タブ内オーバーレイ・全授業種別・保存済み記録のみ）。
- **保護者向け固定QR（新規）** 壁打ち4点: 表示=通常＋振替／連絡=アプリ内通知のみ／返信=一方向／配布=基本データの生徒ごとに表示・印刷。
  設計: QR講習提出と同じ **Cloud Function オンデマンド型**（`parentPortalApi` GET/POST・`/p/{token}`・App を読まない軽量経路）。
  権威は `studentPortalTokens/{token}`(CF のみ)・`StudentRow.parentPortalToken` は写し・コピー時に剥がす・関数側で所有権＋在籍(isActiveOnDate)検証・回数制限。
  配布用盤面型(公開 read 文書)は生徒数×編集回数の書込と個人情報常駐のため不採用。サーバー側の日程計算は存在せず新規（純関数を1本書き functions へビルド同梱）。
  室長通知は QR提出通知の三点セット流用（`parentMessages` 購読＋モーダル＋既読 notifiedAt）。

## 着手順
U-0 → O-1 教室別オプション基盤 → H 講習履歴 → P 盤面PDF → K 保護者QR（仕様 K-1 から）→ Q 質問種別（B/A 先行）→ O-2 フラグ量産（Sonnet）。

## 進捗（2026-09-12 セッション・**v1.5.502 で本番反映済**・CI 3本緑・functions 自動デプロイ緑）
- **O-1/O-2 はオーナー指示で保留**（「オプションはまだどうするか決めてない」）。新機能のフラグは既存の `development-only` scope（教室名判定）のまま。
- **U-0 完了**（fix/undo-dirty-state → main）: applyHistoryEntry 純関数＋版数 bump＋userInitiated:true publish／②復元は resolveRestoreFlagLifecycle で「未保存扱い・教室切替/読込でフラグ必ず落とす」／undo・redo で丸ごと振替選択解除（INV-03 兄弟）。inv02 マトリクス +13 件。**残: staging 実機で「②復元の受動 publish が1回で足りるか」（レビュー必須確認 B）**。dev-local は保存署名の外で自動永続化されるため dirty 確認に使えない。
- **P 完了**（feat/board-print-selection → main）: boardPrintSelection.ts 純関数＋pdf.ts の pruneBoardTableForSelection/exportBoardPdfSelection（全選択・空選択は無改変経路へ委譲、空選択は no-op）＋モーダル。jsdom を devDependency に追加（当該テストのみ `@vitest-environment jsdom`）。フラグ `boardPrintSelection`。INV-04 への注記追加は spec-curator 経由の宿題。
- **H 完了**（feat/lesson-history → main）: lessonHistory.ts / lessonHistoryMessage.ts ＋ callable getStudentLessonHistory（functions/src/lessonLedgerHistory.ts・読み取りのみ）＋日程表タブ「講習履歴」ボタン/オーバーレイ。フラグ `lessonHistory`。トークン解析は src↔functions 二重で fixture パリティテストが門番。**functions デプロイ要**（main マージで自動発火・409 誤成功に注意）。
- **K-1 / Q-1 の仕様ドラフト作成済み・未マージ**: `feat/parent-portal-qr`（docs/spec-parent-portal.md・§0 に仮置き12点=§7-5の8点+P-9〜P-12）と `feat/report-question`（spec-developer-report.md §G/§H/§I＋user-manual.md 骨子・仮置き4点）。**オーナーが §0/仮置き表を確定してから main へ**。K-2 以降・Q-2 以降は確定後に着手。
- K-1 で見つけた要判断: 振替先が出席済みでも「休み→振替先」を保護者ページに出す(P-10)は盤面 lessonLinks の表示バグ(2026-09-04 緑が丘報告)と非対称・P-8 講習期間中は一律非表示が最大論点。


## モデル分担（オーナー指示 2026-09-11）
計画審査＝主セッション(Fable 5.1) / 仕様・実装・原因特定・レビュー＝Opus 最新 / 単純作業（種別追加・フラグ量産・UI実装・docs）＝Sonnet 最新。

**Why:** オーナーは要望を一括で出し「計画→次セッション着手」を求め、壁打ちで製品判断を先に確定した。undo の現行バグ疑いは計画の先頭。
**How to apply:** 次セッションは正本 §0 の起動プロンプトどおり。§9 の未回答は推奨で仮置きし AskUserQuestion で確認。保護者QRは公開エンドポイントなので K-1 仕様→関数側検証のテストを先に。
関連: [[komahyou-developer-report-button]] [[komahyou-dev-classroom-qr-token-contamination]] [[komahyou-operation-log-and-lesson-ledger]]
[[komahyou-ops-model-assignment]] [[komahyou-invariant-registry-plan]] [[komahyou-firebase-cost-scaling]]

## 進捗(2026-09-13 セッション)
- **P 全教室昇格**: オーナー指示「指定コマPDFは完了したので全教室展開して」→ `boardPrintSelection` を all-classrooms へ(v1.5.510)。
- **Q-2 完了**(feat/report-question → main・v1.5.511): 質問種別 question(client/server/Issue ラベル/メール件名/両モーダルの注意文)。Q-1 の仕様 §G/§H/§I と user-manual 骨子も main へ取り込み。Q-3〜Q-6 は未着手。
- **K 着手**: オーナー指示「保護者からのQR読み込みによる室長連絡機能を開発用教室のみで実装して」→ spec §0 の仮置き P-1〜P-12 を **推奨案のまま既定値として採用**し、
  実装契約(API/純関数/コレクション/担当割)を scratchpad `k_contract.md` に定めて 4 並列実装→統合→4 レビュー→修正のワークフローで実装(feat/parent-portal-qr)。
  契約上の差分: parentMessages と回数制限カウンタは `classroomSnapshots/{id}` 配下(ルール helper と retention が効く)／有効トークン索引 `studentPortalTokenOwners`／発行は QR ボタン初回押下時の getOrIssue(生徒追加時の自動発行はしない)／サーバー側も開発用教室判定でゲート(昇格時は両側同時)／全体 1 分 30 件の制限は未実装。
- **K 完了(v1.5.512・2026-09-13 本番反映)**: 保護者向け固定QR 第1段を実装し main マージ。Firestore ルールも反映済み。
  4視点レビュー(INV/セキュリティ/日程計算/統合運用)の major 指摘を同一 push で修正。詳細は [[komahyou-parent-portal-qr]]。
  残: 開発用教室の確認リスト第6版(k-1〜k-9)をオーナーが実機確認 → 結果を見て本番1教室へ昇格(フラグ両側同時)。
- **次の候補**: Q-3〜Q-6(報告ダイジェスト・スキル・承認画面・返答通知)／O-1 教室別オプション基盤(保留中)／
  連絡履歴の一覧・保護者ページの実機調整(第2段)。
