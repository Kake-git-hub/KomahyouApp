# 次セッション用プロンプト（コピペ用）

> 下の「---」以降をそのまま新しいチャットに貼り付けてください。

---

コマ表アプリ（本番稼働中・複数教室）の段階的実装を継続します。まず `docs/SESSION-HANDOFF.md` を読んでから着手して。

## 現在地（2026-06-10 時点）
- 本番 = **v1.5.293**（main 同期）。Phase 0〜5 ＋ テンプレ挙動デルタ ＋ **⑧自動割振** まで本番反映済み（v1.5.293=PR #25 ハイライト挙動変更＋指定時限禁止デバッグ表示修正）。
- いま **Phase 6（最終）**。**⑧は完了・デプロイ済（PR #24・v1.5.292）**。残るは **②クラウド一本化本体**のみ。
  - **⑧ 自動割振 ✅ 完了**：TODO5/4/3/2/1 すべて実装・デプロイ済（build/test:unit 278 グリーン）。
    - 残オーナー判断：区分=制約のハードフィルタ化（現状ソフト＝割振結果不変）／旧「2限寄り/5限寄り」設定教室の自動移行（未移行＝既定へ戻る）。⚠️ 実機検証は未実施＝開発用教室での目視確認推奨。詳細＝`docs/spec-auto-assign-rules.md`。
  - **② 保存クラウド一本化 本体**：未着手・**最高リスク**（保存アーキ＝クロス汚染事故領域）。詳細＝`docs/spec-save-restore.md`。

## 最初にやること
A. **② に着手**（Phase 6 で残る唯一の大物）。**現状精査を最優先**（Phase0/2 で多くが実装済の可能性大。既存充足を見極める）。書込検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。
B. もしくは ⑧の残オーナー判断（ハードフィルタ化等）を確定して追加実装、または開発用教室での目視確認。

## 厳守ルール（重要）
- **本番3教室（日大前/緑が丘/薬円台）は読み取り専用**。Firestoreへの書込検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。復元/コピー系 Functions を本番に向けない（`CLAUDE.md`）。
- **着手前に必ず現状精査**（Phase 3/4/5/⑧ 同様、核心が既に実装済みのことが多い）。
- **改行コードの罠**：`src/components/schedule-board/__snapshots__/makeupStockSnapshot.test.ts.snap` は git 操作のたび LF/CRLF だけの差分で誤検知される。内容無変更なら `git checkout --` で戻す。コミットは**対象ファイルを明示**して add（`CLAUDE.md`/`.claude/` を巻き込まない）。原則 Edit ツールで編集（`sed -i` はCR剥がしで全行差分になる）。
- 検証：`npm run build`／`npm run test:unit`（現在 272 件）。コミット/PR/デプロイは**オーナーの指示があってから**。

## 参照
- 正本目次 `docs/spec-index.md`、計画 `docs/spec-implementation-plan.md`。
- メモリ：保存アーキ `memory/komahyou-save-architecture.md`、クロス汚染 `memory/komahyou-classroom-restore-cross-contamination.md`、テンプレ編集フロー `memory/komahyou-template-editing-flow.md`、scheduleHtml埋め込みJSの罠 `memory/komahyou-schedulehtml-embedded-script.md`。
