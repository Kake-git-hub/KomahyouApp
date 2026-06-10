# 次セッション用プロンプト（コピペ用）

> 下の「---」以降をそのまま新しいチャットに貼り付けてください。

---

コマ表アプリ（本番稼働中・複数教室）の段階的実装を継続します。まず `docs/SESSION-HANDOFF.md` を読んでから着手して。

## 現在地（2026-06-10 時点）
- 本番 = **v1.5.295**（main 同期）。**Phase 0〜6 すべて本番反映済み＝Phase 6 完了**。
  - **⑧ 自動割振 ✅ 完了・実機検証済**（PR #24/#25・TODO5/4/3/2/1）。残オーナー判断：区分=制約のハードフィルタ化（現状ソフト＝割振結果不変）／旧「2限寄り/5限寄り」設定教室の自動移行（未移行＝既定へ戻る）。詳細＝`docs/spec-auto-assign-rules.md`。
  - **② クラウド一本化 ✅ 完了**（PR #27）：復元UIをJSON一本へ整理。TODO2 二段階保存=見送り(維持)・TODO9 室長コピー=見送り(開発者のみ)はオーナー決定。詳細＝`docs/spec-save-restore.md`。
- **大型ロードマップは消化済み。** 以降はオーナー指示の個別課題・バグ対応が中心。

## 最初にやること
- オーナーの新規指示・バグ報告に対応。持ち越し候補：⑧の残オーナー判断（ハードフィルタ化／旧時限ルール移行）、多ルール×全員のパフォーマンス最適化、開発用教室のテスト残差クリーンアップ。
- 着手前に必ず現状精査。書込検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。

## 厳守ルール（重要）
- **本番3教室（日大前/緑が丘/薬円台）は読み取り専用**。Firestoreへの書込検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。復元/コピー系 Functions を本番に向けない（`CLAUDE.md`）。
- **着手前に必ず現状精査**（Phase 3/4/5/⑧ 同様、核心が既に実装済みのことが多い）。
- **回帰防止（厳守）**：このアプリは過去修正の踏襲が前提。既存ロジック書換前に `git log -L`/`git log -S`/`git blame` で過去の修正意図を確認し、後の変更で巻き戻さない。spread単純化や衝突解決で消さない。バグ修正には回帰テスト必須。詳細＝`CLAUDE.md` 冒頭「回帰防止ルール」。
- **改行コードの罠**：`src/components/schedule-board/__snapshots__/makeupStockSnapshot.test.ts.snap` は git 操作のたび LF/CRLF だけの差分で誤検知される。内容無変更なら `git checkout --` で戻す。コミットは**対象ファイルを明示**して add（`CLAUDE.md`/`.claude/` を巻き込まない）。原則 Edit ツールで編集（`sed -i` はCR剥がしで全行差分になる）。
- 検証：`npm run build`／`npm run test:unit`（現在 279 件）。コミット/PR/デプロイは**オーナーの指示があってから**。

## 参照
- 正本目次 `docs/spec-index.md`、計画 `docs/spec-implementation-plan.md`。
- メモリ：保存アーキ `memory/komahyou-save-architecture.md`、クロス汚染 `memory/komahyou-classroom-restore-cross-contamination.md`、テンプレ編集フロー `memory/komahyou-template-editing-flow.md`、scheduleHtml埋め込みJSの罠 `memory/komahyou-schedulehtml-embedded-script.md`。
