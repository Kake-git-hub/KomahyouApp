# セッション引き継ぎ資料（2026-06-10 時点）

新しいチャットはまずこのファイルを読む。プロジェクト「コマ表アプリ」の**全体見直し→段階的実装**を継続中。

---

## 0. いま何をしているか（最重要・即時タスク）※2026-06-10 更新

**本番＝v1.5.293（main 同期）。Phase 0〜5 ＋ テンプレ挙動デルタ ＋ ⑧自動割振 まで本番反映済み。**
（v1.5.293＝PR #25: 優先事項違反のハイライト抑制〔制約違反・講師なしのみ〕＋指定時限禁止のデバッグ表示修正。実機で割振実行・ルール対応率を確認済み。）
いまは **Phase 6（最終フェーズ）** を実装中。**⑧は完了・デプロイ済**。残るは **②クラウド一本化本体**。

### Phase 6 の状態
- **⑧ 自動割振ルール ✅ 完了・デプロイ済（v1.5.292・PR #24 マージ済・ブランチ削除済）**：build・typecheck・test:unit(278) グリーン。
  - ✅ **TODO5 ペア制約2区分**（`category` 既定=制約／優先。`pairConstraint.ts`＋`resolvePairConstraintSeverity`＋UI区分トグル＋Excel）
  - ✅ **TODO4 groupLessons 種データ空**（`initialGroupLessons=[]`。型/配管は維持＝オーナー判断）
  - ✅ **TODO3 指定時限禁止スライダー**（`forbidFirstPeriod`一般化→`forbiddenPeriods`既定[1]。1〜5限トグルUI＋スコア/警告＋Excel）
  - ✅ **TODO2 時限優先スライダー**（preferLateAfternoon/Second/Fifth 3ルール統合→「時限優先」1ルール＋並べ替えUI＋`periodPriorityOrder`＋スコア書換。既定[5,4,3,2,1]）
  - ✅ **TODO1 区分許可リスト**（編集可能 `category`＋許可リスト、`forcedRuleKeys`置換、制約/優先セクション動的振り分け＋区分トグルUI。**割振はソフト維持＝本番割振結果不変＝オーナー確認済み**）
  - ⚠️ 残（オーナー判断）：区分=制約のハードフィルタ化（現状ソフト）／旧「2限寄り/5限寄り」設定教室の自動移行（現状未移行＝既定へ戻る・スライダー再設定で対応）。詳細＝`docs/spec-auto-assign-rules.md` 実装状況。
  - ⚠️ 実機検証は未実施（dev=本番Firebase接続・教室を開く必要／本番保護のため実機操作せず）。**開発用教室 `v8OZ7zH8vONNHjjYVcR1` での目視確認を推奨**。
- **② クラウド一本化（保存・復元）本体**：**未着手・最高リスク**（保存アーキ＝クロス汚染事故領域）。残＝二段階保存廃止/復元UI整理/開発用コピー室長開放。多くは Phase0/2 で実装済（5s/20s・常時緑・オフラインブロック・JSON復元）。詳細＝`docs/spec-save-restore.md`。

### 次セッションの最初の判断
1. **② に着手**（Phase 6 で残る唯一の大物・最高リスク）。**現状精査を最優先**（既存充足を見極めてから・開発用教室でのみ書込検証）。
2. もしくは ⑧の残オーナー判断（ハードフィルタ化等）を確定して追加実装。
3. ⑧の開発用教室での目視確認。

### このセッションの完了事項（2026-06-09）
- **Phase 4-B 欠席登録UI＝実装済みと精査確認**（PR #16）。下記詳細参照。
- **Phase 4 残数差分検証 完了**（PR #17・読み取り専用）：最新本番バックアップで OLD(v1.5.289)/NEW(main) を同一入力比較 → **本番3教室は差分ゼロ**、変化は開発用教室の1キー(戸髙咲耶/算 −1→0)のみ。詳細は `spec-makeup-stock.md` §移行チェック。
- **テンプレ×休日の力関係を確認**：テンプレ反映日以降の個別休日は反映時にクリア＝営業日に戻りテンプレが入る（`filterTemplateOverwriteHolidayDates`、テスト有）。「テンプレ＞個別休日」は実装済みで正。
- **テンプレ全挙動の質問群を作成**：`docs/spec-template-behavior.md`（Q1-Q20・未回答）。
- **デプロイ実施**：version 1.5.289 → **1.5.290**、`npm run deploy:firebase`。

### Phase 4-B 精査結果（spec-makeup-stock.md §1-B 全要件を満たす）
生徒メニュー「休み」ボタン（`menu-absence-button` → `handleMarkStudentAbsent`、ScheduleBoardScreen.tsx L7245-7361）が §1-B を実装済み：
- 欠席→生徒×科目の振替+1：通常コマで `appendMakeupOrigin(...)`（L7330）。
- コマは消さず「欠席」表示で残す：`removeStudentFromDeskLesson`＋`setDeskStudentStatus('absent')`、ラベル「休み」（L1510）。
- 席はロックせず別生徒・体験・メモ追加可：`status==='absent'` の空欄メニュー（L8457-8465）。`attended` のような入替/追加ブロックなし。
- 振替元の日付・時限記録：`resolveOriginalRegularDate`＋`appendSuppressedRegularLessonOccurrence`＋`buildLinkedLessonDestinationMap`。
- 理由ラベルなし：absent 経路は `休日振替/定休日振替` を付けない（§1-A 自動経路のみ）。
- 残数会計：通常欠席の status slot は `lessonType:'regular'` なので `makeupStock.ts` の count ループ（L359/391 の `!=='makeup'`）で二重計上なし。L360/392 の `absent` continue は「配置済みの**振替**コマが欠席→消化扱いにせずストックへ戻す」専用で §1-B とは別経路。→ 通常欠席は origin +1・usage 0 で純増 +1。
- テスト済み：`ScheduleBoardScreen.test.ts` の absent→振替リンク4件（L424/503/577/660）。
- UI呼称：「休み」(=振替+1) と「振無休」(=absent-no-makeup・振替なし) の2系統。spec の「欠席登録」=「休み」ボタン。

---

## 1. プロジェクト概要・本番保護

- React + TypeScript + Firebase。本番 `komahyouapp-prod`、`https://komahyouapp-prod.web.app/`。**本番稼働中**（複数教室の実データ）。
- ルール：`CLAUDE.md` / `開発ルール.md` / `README.md`。
- ★**本番データ保護（厳守）**：書き込みは**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。本番3教室（日大前/緑が丘/薬円台）は読み取り専用。復元/コピー系 Functions を本番に向けない。

---

## 2. 全体の流れ

1. **仕様確定（見直し一周）**：全10ブロックを確認し `docs/spec-*.md` に正本化。目次＝`docs/spec-index.md`。
2. **実装計画**：`docs/spec-implementation-plan.md`（Phase 0〜6）。
3. **段階実装**：Phase 0〜4 実施。各PRマージ＋都度デプロイ。

### 正本（docs/）
`spec-index.md`(目次) / `spec-save-restore.md` / `spec-board-regular-placement.md` / `spec-makeup-stock.md` / `spec-lecture-stock.md` / `spec-basic-data.md` / `spec-special-session-submission.md` / `spec-auto-assign-rules.md` / `spec-schedule-pdf.md` / `spec-classroom-auth.md` / `spec-implementation-plan.md`

---

## 3. 進捗（Phase）

| Phase | 内容 | 状態 |
|---|---|---|
| 0 安全網 | ②JSONフル復元・保存失敗ダイアログ | ✅ デプロイ済 |
| 1 削除 | ⑥マネージャータブ・①AI分析・①Spark廃止・⑧グループ授業整理 | ✅ デプロイ済 |
| 2 簡素化 | ②保存UX(5s/20s・常時緑・オフラインブロック)・色撤廃・⑥isHidden廃止＋高3卒業・講師の出勤可能コマ/メモ削除 | ✅ デプロイ済 |
| 3 テンプレ一本化 | 核心は既に実装済みと確認。死蔵 `capRegularLessonDatesPerMonth` 削除 | ✅ デプロイ済（v1.5.290） |
| 4 振替 A/C | A 休日振替の即時計上 / C マイナス残廃止（PR #15） | ✅ デプロイ済（v1.5.290・残数差分検証済 PR #17） |
| 4 振替 B | 欠席登録UI | ✅ 実装済み確認（PR #16）・デプロイ済（v1.5.290） |
| 5 ⑤⑦⑨ | 講習ストック/提出/日程表 | ✅ デプロイ済（v1.5.291・PR #23） |
| 6 ⑧ 自動割振 | TODO5/4/3/2/1（2区分・空種データ・指定時限禁止・時限優先・区分許可リスト） | ✅ デプロイ済（v1.5.292・PR #24） |
| 6 ② 保存一本化 | 二段階保存廃止/復元UI整理/コピー開放 | ⏳ 未着手・最高リスク |

### Phase 3/4 の教訓（パターン）
- 「仕様策定時の想定」と「現状実装」がズレ、**核心が既に実装済み**のことが多い。**実装前に必ず現状精査**。
- ④：`autoShortage` は「休日で潰れた通常授業の振替自動計上」だった→**残す**（仕様訂正済み）。A=未来休日も即時計上(todayキャップ撤廃)。C=残0下限＋過剰配置は一覧除外(`balance !== 0`)。

---

## 4. 本番との差・デプロイ

- **本番 = v1.5.290（2026-06-09 デプロイ）＝ main 同期**（Phase 0〜4 すべて反映済み）。差分なし。
- ★**Phase 4 A・C は本番の振替残数を意図的に変える**設計（特に A は未来休日を持つ教室で残数増）だったが、**デプロイ前の残数差分検証（2026-06-09・読み取り専用 PR #17）で本番3教室は差分ゼロ**を確認済み（A：唯一の未来休日=お盆がテンプレ有効期間 09-07/08-31 より前で対象0件／C：本番にマイナス残なし）。詳細は `spec-makeup-stock.md` §移行チェック。注意：A は今後 有効期間内に休日設定すると顕在化する時点依存挙動。
- デプロイ手順：`package.json` の version を上げる → `git push origin main` → `npm run deploy:firebase`（自前で build→hosting,firestore deploy→live検証→retention まで実施）。
  - Hosting が**一時的に HTTP 500**→そのまま再実行で成功。version を上げないと更新検知されない。

---

## 5. 開発フロー・ツール

- **PR**：`gh` 認証済（`Kake-git-hub`、トークンはキーリング）。
  フロー：`git checkout -b X` → 変更 → build/test → commit → `git push -u origin X` → `gh pr create --base main --head X ...` → `gh pr merge X --merge --delete-branch` → `git checkout main && git pull`。
- **検証**：`npm run build` / `npm run test:unit`（**262件**）。ゴールデンスナップショット `__snapshots__/*.snap` は意図的変更時のみ `npx vitest run -u <path>`。

### ★★ 改行コードの罠（大事故注意）
- `core.autocrlf=true` だが既存blobはCRLF混在。**`sed -i` は CR を剥がしてファイル全体が差分（数千行）になる**（前セッションで App.tsx が9778行差分）。
- **対策**：原則 **Edit ツールを使う**。sed を使ったらコミット前に各ファイルを元blobの改行に合わせ正規化：
  ```bash
  for f in $(git diff --name-only); do [ -f "$f" ] || continue; \
    if git show "HEAD:$f" 2>/dev/null | rg -q $'\r'; then sed -i 's/\r$//; s/$/\r/' "$f"; else sed -i 's/\r$//' "$f"; fi; done
  git -c core.autocrlf=false add -u && git -c core.autocrlf=false commit ...
  ```
  正規化後 `git diff --cached --stat` が小さければOK。
- `.gitignore` に `.claude/` 追加済み。`git add -A` は `.claude/`・`CLAUDE.md` を巻き込むので**対象ファイルを明示**して add。

### ★ セキュリティ
- オーナーが GitHub トークンをチャットに平文共有済み。**区切りで Revoke 推奨**。失効後は最小スコープ(`repo`,`workflow`)の新トークンで再 `gh auth login --with-token`。

---

## 6. 残りロードマップ

- ~~**Phase 0〜5＋テンプレ挙動**~~ → ✅ 完了・**v1.5.291 デプロイ済（2026-06-09・PR #23）**。functions(`lectureSubmissionApi`含む)/hosting/firestore 反映済・live検証 passed。
- **テンプレ仕様確定＋実装**：✅ 完了・デプロイ済（`docs/spec-template-behavior.md` 正本化）。
- **Phase 5（デプロイ済の実装メモ）**：
  - **⑤講習ストック ✅ ほぼ完了（未コミット/未デプロイ）**：TODO1(削除で希望数−1)・TODO4(授業時間モデル+手動追加の時間選択)実装。TODO3(コマ表編集)は**廃止**（編集=削除+手動追加）。手動追加は希望数に含めず講習回数(actual)に計上(既存)。残：日付一括「生徒を空にする」の希望数一括−1は保留。詳細 `docs/spec-lecture-stock.md` 実装状況。
  - **⑦提出**：**TODO3(提出に授業時間90/60/45)＝コード全層実装✅（要 functions deploy）／TODO2(登録削除で再提出モデル・unlock撤去)✅／TODO4(「すでに提出済みです」・無効リンク文言)✅**（いずれも未コミット/未デプロイ）。残＝TODO1(別タブ廃止・⑨一体)。詳細 `docs/spec-special-session-submission.md` 実装状況。
  - **⑨日程表**：精査の結果 TODO1(最新表示)/2(actualのみ)/3(色撤廃)/6(QR全教室)/7(planned=テンプレ由来)は**既存充足**。**TODO4(授業時間反映)✅ 実装**（日程表セルに分表示＋盤面session講習に noteSuffix 付与）。詳細 `docs/spec-schedule-pdf.md` 実装状況。
  - **⑦TODO1=⑨TODO5（別タブ欠席不可入力経路の廃止）✅ 実装**：死蔵 `specialSessionAvailabilityHtml.ts`(+test) 削除、App.tsx の sync/メッセージhandler/runtime fields 撤去、SpecialSessionScreen 文言更新。登録は日程表＋QRに一本化。
  - **→ Phase 5（⑤⑦⑨）＝v1.5.291 で本番反映済。**
- **Phase 6（次タスク）**：②クラウド一本化本体／⑧自動割振スライダー化・区分許可リスト。②は保存経路の最高リスク領域、着手前に現状精査必須。
- 手順・対象ファイルは `docs/spec-implementation-plan.md`。

---

## 7. 次セッション冒頭チェックリスト

1. `git checkout main && git pull`。
2. `npm run test:unit`（262件グリーン確認）。
3. 再開タスク：①`docs/spec-template-behavior.md` のテンプレ質問群Q1-Q20をオーナーと確定 → 正本化、または ②Phase 5 着手。**着手前に必ず現状精査**（Phase 3/4 同様、核心が既に実装済みの可能性大）。
4. sed を使うなら §5 の改行コード正規化を忘れない。
