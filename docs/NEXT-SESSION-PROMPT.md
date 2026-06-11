# 次セッション用プロンプト（コピペ用）

> 下の「---」以降をそのまま新しいチャットに貼り付けてください。

---

コマ表アプリ（本番稼働中・複数教室）の続きをやります。まず `docs/SESSION-HANDOFF.md` の「0-A」を読んでから着手して。直近セッション（2026-06-11）は教室間データ混入の連鎖バグを修正し、日大前校はオーナーが手動復元済み。当面の能動タスクは無く、新規はオーナー指示待ち（下記）。

## 現在地（2026-06-11 時点）
- 本番 = **v1.5.301**（main 同期）。test:unit = **286** グリーン。
- 2026-06-11 に混入の全経路を塞いだ：①コピーの参照共有→ディープクローン(v1.5.297) ②保存の全教室一括書込み→操作中教室のみ(v1.5.299) ③アカウント切替のundo残存→破棄(v1.5.300) ④in-memory他教室コピー廃止→「他教室バックアップを開発用教室へ読み込む」Feature B に置換(v1.5.301)。併せて 復元internalのgzip化(v1.5.298)・振替の過剰減算修正・注記→授業時間ボタン化 も実施。詳細は SESSION-HANDOFF §0-A とメモリ。
- ロードマップ（Phase 0〜6）は完了済み（§0 以降）。

## 状況（2026-06-11 オーナー確認済み）
- **日大前校の復旧：✅ オーナー手動復元済み。** 念のため読み取り専用で各教室 stuHash を再照合（gcloud token で Storage `workspace-auto-backups/main/hourly/{key}.json` を GET）。日大前が **生徒129・テンプレ35・eff 2026-09-07・stuHash `0c691a4075`** で安定していればOK。万一ぶり返していたら「2026-06-11 07:10 毎時」→ 日大前校だけ選択 → 保存、をオーナーに案内（**私は本番教室へ書込不可**）。
- **テンプレ Q1〜Q20：✅ 確定＋実装済み（追加作業なし）。** `docs/spec-template-behavior.md` 正本に一致。デルタ Q4(定休日セル配置禁止)/Q11(単年度=反映日〜年度末3/31)/Q14(入会前＋在籍が対象・講師も)/Q16(履歴3件)/Q17(UIは保存1本) はコード反映済み。
- **⑧ 自動割振の「オーナー判断」2件：✅ 2026-06-11 で確定・クローズ。** 制約のハードフィルタ化＝**しない／全ソフト維持で確定**（唯一のハードは「絶対事項」のみ）。旧時限ルール移行＝対象教室ゼロで該当なし。コード変更なし。`docs/spec-auto-assign-rules.md` B節参照。

## 最初にやること（能動タスクは無し。オーナー指示待ち）
- 新規はオーナーの指示・バグ報告に対応。**着手前に必ず現状精査**。
- 持ち越し候補（オーナー指示後）：①**多ルール×「全員」のパフォーマンス最適化** → 専用引き継ぎ＋プロンプトは `docs/perf-multi-rule-optimization-handoff.md`（実運用で多ルール教室が出たらこれを開く）②localStorage キーのアカウント別分離（混入の最後の残リスク）③開発用教室のクリーンアップ（Feature B で正しい時点を読込）。

## 厳守ルール（重要）
- **本番3教室（日大前/緑が丘/薬円台）は読み取り専用**。Firestore書込検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。復元/コピー系 Functions を本番に向けない（`CLAUDE.md`）。データ照合は GET のみ。
- **回帰防止（厳守）**：過去修正の踏襲が前提。既存ロジック書換前に `git log -L`/`git log -S`/`git blame` で意図を確認し、後の変更で巻き戻さない。spread単純化や衝突解決で消さない。バグ修正には回帰テスト必須。
- **改行コードの罠**：`src/components/schedule-board/__snapshots__/makeupStockSnapshot.test.ts.snap` は git 操作のたび LF/CRLF だけの差分で誤検知される。内容無変更なら `git checkout --` で戻す。コミットは**対象ファイルを明示**して add（`CLAUDE.md`/`.claude/` を巻き込まない）。原則 Edit ツールで編集（`sed -i` はCR剥がしで全行差分になる）。
- 検証：`npm run build`／`npm run test:unit`（286件）。デプロイ手順は SESSION-HANDOFF §4（version上げ→push→`npm run deploy:firebase`、Functions変更時は `:with-functions`）。**コミット/デプロイはオーナー指示後**。

## 参照
- 引き継ぎ `docs/SESSION-HANDOFF.md`（§0-A 最優先）、正本目次 `docs/spec-index.md`、計画 `docs/spec-implementation-plan.md`。
- メモリ：クロス汚染（第1〜3の真因・調査手法・Feature B）`memory/komahyou-classroom-restore-cross-contamination.md`、保存アーキ `memory/komahyou-save-architecture.md`、テンプレ編集フロー `memory/komahyou-template-editing-flow.md`、scheduleHtml埋め込みJSの罠 `memory/komahyou-schedulehtml-embedded-script.md`。
