# Runbook: リリース前チェックリスト

本番（`komahyouapp-prod`）へマージする前に毎回確認する。判断フローの正本は
[safe-release スキル](../../.claude/skills/safe-release/SKILL.md)。ここはその確認票。

## 1. 着手前（同期）
- [ ] `git fetch` 済み・ローカル main が origin/main に追随
- [ ] `package.json` version とライブ `https://komahyouapp-prod.web.app/version.json` が一致
- [ ] 作業はブランチで行っている

## 2. 自動テスト（緑であること）
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:rules`（保存/権限/教室分離を触ったとき・要 Java + エミュレータ）
- [ ] `npm run build`
- [ ] バグ修正なら回帰防止テストを追加（修正なしで落ち・ありで通る）
- [ ] **在庫数量ゴールデンが緑**（`makeupStockSnapshot.test.ts` / `lectureStockSnapshot.test.ts`）。落ちた＝在庫計算が変わった合図。→ §6
- ※Playwright E2E は廃止（2026-06-29）。UI操作の回帰はユニット、実環境の通し動作は staging 実機確認で担保（`docs/test-strategy.md`）。

## 3. staging 実機確認（`komahyouapp-staging.web.app`）
- [ ] 「Deploy to Staging」ワークフローが緑
- [ ] ハードリロード（Ctrl+Shift+R）して開いた
- [ ] **変更箇所**が期待どおり動く
- [ ] 主要回帰観点が壊れていない:
  - [ ] 複数教室の切替
  - [ ] QR 提出 → 出席者一覧反映
  - [ ] 自動割振（指定時限禁止・通常講師判定・振替同時割当）
  - [ ] 手動保存（Cloud Function 経由）→ 再読込で保持
  - [ ] 生徒日程表の通常授業カウント

## 4. 記録
- [ ] `CHANGELOG.md` の `## 未リリース` に1行追記
- [ ] `git diff` を通読し、意図しない変更が無い（spread での補完欠落・回帰防止コメント削除に注意）

## 5. リリース
- [ ] main にマージ（CI が本番 Hosting に自動デプロイ）
- [ ] `## 未リリース` を次の版でラベル付けし、空の `## 未リリース` を新設
- [ ] functions を変えたら「Deploy Cloud Functions」も実行＋実反映を検証
- [ ] ライブ `version.json` 更新と本番アプリの動作を確認

## 6. 在庫数量（未消化振替 / 未消化講習）の非退行チェック（最重要）
**未消化振替・未消化講習の数量は運用上きわめて重要**（塾の授業回数そのもの）。版上げで「無操作なのに数量が変わる」事故を必ず防ぐ。

### 6-A. 自動ガード（CI・毎push・決定的）
- **正本**: `src/components/schedule-board/makeupStockSnapshot.test.ts` と `lectureStockSnapshot.test.ts`（fixture `__fixtures__/sampleMakeupStock.ts` / `sampleLectureStock.ts`）。
  在庫の「計算・消化・再ストック・抑制・手動調整」を fixture で固定し、`buildMakeupStockEntries` / `buildLectureStockEntries` の出力が1行=1ストック行の digest で凍結される。
- **ルール**: このスナップショットが落ちたら「在庫計算が変わった」合図。**意図的に仕様を変えたときだけ** `npx vitest -u src/components/schedule-board/makeupStockSnapshot.test.ts`（/ lecture）で更新し、**digest 差分（残数・自動/手動・配置数・次源・理由）が仕様どおりか目視レビュー**してからコミットする。意図せぬ差分のまま更新しない。
- **付随**: 在庫の科目選択は `lectureStockPlacement.test.ts`（講習の選択科目尊重）でも担保。

### 6-B. 在庫計算に触れる変更のときの本番スポットチェック（推奨）
`makeupStock.ts` / `lectureStock.ts` / 抑制(`suppressedMakeupOrigins`) / 手動調整 / 配置・消化ロジックを触った版では、fixture だけでなく**本番データでも無操作ドリフトが無いこと**を確認する。
1. 本番スナップショットを**読み取り専用**で取得（本番データ保護ルール厳守）: Firestore REST GET `workspaces/main/classroomSnapshots/{classroomId}`（本文は `compressedData` = base64+gzip の AppSnapshot）。
2. **デプロイ前後（無操作）**で同一スナップショットに対し `buildMakeupStockEntries`（残balance合計）/ `buildLectureStockEntries`（要求数合計）を実行し、**総数と教室別内訳が一致**することを確認（純粋関数なので同一コード＝同一データなら必ず一致。変われば計算が変わった証拠）。
3. 基準値（**2026-07-03** 時点・v1.5.364）:
   - 未消化振替 総balance = **294**（緑が丘88 / 日大前206 / 薬円台0）
   - 未消化講習 raw要求 総数 = **1436**（緑が丘766 / 日大前667 / 薬円台3）
   - 基準からの増減は運用（提出・配置・削除）由来か必ず説明できること。説明不能な変化＝退行を疑う。

## 異常時
- ロールバック手順は safe-release スキルの「ロールバック手順」を参照。
