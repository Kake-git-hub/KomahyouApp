# 次セッション用プロンプト（コピペ用）

> 下の「---」以降をそのまま新しいチャットに貼り付けてください。

---

コマ表アプリ（本番稼働中・複数教室）の続きをやります。まず `docs/SESSION-HANDOFF.md` の「0-A. 緊急：本番データ混入対応の現状」を読んでから着手して。直近セッション（2026-06-11）は教室間データ混入の連鎖バグ対応に切り替わった。その続きから。

## 現在地（2026-06-11 時点）
- 本番 = **v1.5.301**（main 同期）。test:unit = **286** グリーン。
- 2026-06-11 に混入の全経路を塞いだ：①コピーの参照共有→ディープクローン(v1.5.297) ②保存の全教室一括書込み→操作中教室のみ(v1.5.299) ③アカウント切替のundo残存→破棄(v1.5.300) ④in-memory他教室コピー廃止→「他教室バックアップを開発用教室へ読み込む」Feature B に置換(v1.5.301)。併せて 復元internalのgzip化(v1.5.298)・振替の過剰減算修正・注記→授業時間ボタン化 も実施。詳細は SESSION-HANDOFF §0-A とメモリ。
- ロードマップ（Phase 0〜6）は完了済み（§0 以降）。

## 最初にやること（最優先）
1. **日大前校（`5w5OMueETerSKrSf14HC`）の復旧がオーナー側で完了したか、読み取り専用で確認**：gcloud token で Storage `workspace-auto-backups/main/hourly/{key}.json` を GET し、各教室の stuHash（生徒IDソートのsha1先頭10桁）・テンプレ cell数/eff を照合。日大前が **生徒129・テンプレ35・eff 2026-09-07・stuHash `0c691a4075`** に戻っていれば復旧済み。まだ `d19bb93b16`(生徒73・テンプレ無)なら未復旧。
   - 未復旧ならオーナーに案内：各PCで Ctrl+Shift+R → 開発者画面 → サーバーバックアップ →「2026-06-11 07:10 毎時」→ 復元 → **日大前校だけ選択** → 保存。**私（Claude）は本番教室へ書込不可（CLAUDE.md 厳守）**。
2. 復旧確認後の持ち越し候補（オーナー判断）：
   - **localStorage キーのアカウント別分離**（混入の最後の残リスク。現状は同一ユーザー判定ガードで保護中、キーは全アカウント共通 `komahyouapp:workspace-snapshot`）。
   - 開発用教室のクリーンアップ（現状 日大前由来データ＋テスト残差。Feature B で正しい時点を読み込み直せる）。
   - ⑧の残オーナー判断（区分=制約のハードフィルタ化／旧時限ルール教室の自動移行）、多ルール×全員のパフォーマンス最適化、`docs/spec-template-behavior.md` Q1-Q20 確定。

## 厳守ルール（重要）
- **本番3教室（日大前/緑が丘/薬円台）は読み取り専用**。Firestore書込検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。復元/コピー系 Functions を本番に向けない（`CLAUDE.md`）。データ照合は GET のみ。
- **回帰防止（厳守）**：過去修正の踏襲が前提。既存ロジック書換前に `git log -L`/`git log -S`/`git blame` で意図を確認し、後の変更で巻き戻さない。spread単純化や衝突解決で消さない。バグ修正には回帰テスト必須。
- **改行コードの罠**：`src/components/schedule-board/__snapshots__/makeupStockSnapshot.test.ts.snap` は git 操作のたび LF/CRLF だけの差分で誤検知される。内容無変更なら `git checkout --` で戻す。コミットは**対象ファイルを明示**して add（`CLAUDE.md`/`.claude/` を巻き込まない）。原則 Edit ツールで編集（`sed -i` はCR剥がしで全行差分になる）。
- 検証：`npm run build`／`npm run test:unit`（286件）。デプロイ手順は SESSION-HANDOFF §4（version上げ→push→`npm run deploy:firebase`、Functions変更時は `:with-functions`）。**コミット/デプロイはオーナー指示後**。

## 参照
- 引き継ぎ `docs/SESSION-HANDOFF.md`（§0-A 最優先）、正本目次 `docs/spec-index.md`、計画 `docs/spec-implementation-plan.md`。
- メモリ：クロス汚染（第1〜3の真因・調査手法・Feature B）`memory/komahyou-classroom-restore-cross-contamination.md`、保存アーキ `memory/komahyou-save-architecture.md`、テンプレ編集フロー `memory/komahyou-template-editing-flow.md`、scheduleHtml埋め込みJSの罠 `memory/komahyou-schedulehtml-embedded-script.md`。
