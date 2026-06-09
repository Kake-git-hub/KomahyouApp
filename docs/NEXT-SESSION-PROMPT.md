# 次セッション用プロンプト（コピペ用）

> 下の「---」以降をそのまま新しいチャットに貼り付けてください。

---

コマ表アプリ（本番稼働中・複数教室）の段階的実装を継続します。まず `docs/SESSION-HANDOFF.md` を読んでから着手して。

## 現在地（2026-06-10 時点）
- 本番 = **v1.5.291**（main 同期）。Phase 0〜5 ＋ テンプレ挙動デルタ まで本番反映済み。
- いま **Phase 6（最終）** の途中。
  - **⑧ 自動割振**：ブランチ `phase6-auto-assign`（push済・**未マージ・未デプロイ**）に
    - ✅ TODO5 ペア制約2区分／✅ TODO4 groupLessons種データ空／✅ TODO3 指定時限禁止スライダー（build/test:unit 272 グリーン）
    - ⏳ TODO2 時限優先スライダー（3ルール統合＋並べ替えUI＋スコア書換）
    - ⏳ TODO1 区分許可リスト（全ルールへ category＋許可リスト、`forcedRuleKeys`置換、グルーピング再構成）
    - TODO2/TODO1 は相互依存・最重量。詳細＝`docs/spec-auto-assign-rules.md` 実装状況。
  - **② 保存クラウド一本化 本体**：未着手・**最高リスク**（保存アーキ＝クロス汚染事故領域）。詳細＝`docs/spec-save-restore.md`。

## 最初にやること（どれかを私に確認してから進めて）
A. **`phase6-auto-assign` を PR→マージ→デプロイ**して TODO5/4/3 を先に本番反映（推奨の区切り）。
   - 手順：`gh pr create --base main --head phase6-auto-assign ...` → `gh pr merge --merge` → `git checkout main && git pull` → package.json の version を上げる（1.5.291→1.5.292）→ commit/push → `npm run deploy:firebase`（functions変更が無ければ functions 無しで可。⑧は functions 不変なので通常 `deploy:firebase` でOK）→ live検証。
B. **⑧ TODO2/TODO1 を同ブランチで続行**（一体設計）。`AutoAssignRuleScreen.tsx`（区分グルーピング/renderRuleCard）＋ `ScheduleBoardScreen.tsx`（時限スコアリング L4211-4248）＋ `autoAssignRuleModel.ts`。
C. **② に着手**するなら**現状精査を最優先**（Phase0/2 で多くが実装済の可能性大。既存充足を見極める）。書込検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。

## 厳守ルール（重要）
- **本番3教室（日大前/緑が丘/薬円台）は読み取り専用**。Firestoreへの書込検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。復元/コピー系 Functions を本番に向けない（`CLAUDE.md`）。
- **着手前に必ず現状精査**（Phase 3/4/5/⑧ 同様、核心が既に実装済みのことが多い）。
- **改行コードの罠**：`src/components/schedule-board/__snapshots__/makeupStockSnapshot.test.ts.snap` は git 操作のたび LF/CRLF だけの差分で誤検知される。内容無変更なら `git checkout --` で戻す。コミットは**対象ファイルを明示**して add（`CLAUDE.md`/`.claude/` を巻き込まない）。原則 Edit ツールで編集（`sed -i` はCR剥がしで全行差分になる）。
- 検証：`npm run build`／`npm run test:unit`（現在 272 件）。コミット/PR/デプロイは**オーナーの指示があってから**。

## 参照
- 正本目次 `docs/spec-index.md`、計画 `docs/spec-implementation-plan.md`。
- メモリ：保存アーキ `memory/komahyou-save-architecture.md`、クロス汚染 `memory/komahyou-classroom-restore-cross-contamination.md`、テンプレ編集フロー `memory/komahyou-template-editing-flow.md`、scheduleHtml埋め込みJSの罠 `memory/komahyou-schedulehtml-embedded-script.md`。
