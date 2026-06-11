# セッション引き継ぎ資料（2026-06-11 時点）

新しいチャットはまずこのファイルを読む。プロジェクト「コマ表アプリ」の**全体見直し→段階的実装**を継続中。
**直近セッション（2026-06-11）は緊急のデータ混入対応に切り替わった。下記「0-A」を最優先で確認すること。**

---

## 0-A. 緊急：本番データ混入対応の現状（2026-06-11・最優先）

**本番＝v1.5.301（main 同期）。** 2026-06-11 セッションで、教室間データ混入の連鎖バグを調査・修正し、複数回デプロイした。

### 日大前校の復旧：✅ 完了（2026-06-11・オーナーが手動復元）
- 日大前校（`5w5OMueETerSKrSf14HC`）は「2026-06-11 07:10 毎時」から**オーナーが手動復元済み**。本物データ＝生徒129名・テンプレ35セル(eff 2026-09-07, stuHash `0c691a4075`)。
  - 新セッションは念のため**読み取り専用で再照合**（gcloud token で Storage `workspace-auto-backups/main/hourly/{key}.json` を GET、各教室 stuHash＝生徒IDソートのsha1先頭10桁・テンプレ cell数/eff を照合）し、日大前が `0c691a4075`/生徒129/テンプレ35 で安定しているか確認。万一ぶり返していたら同手順で再復元を案内（私は本番教室へ書込不可）。手法は memory `komahyou-classroom-restore-cross-contamination.md` 参照。
  - 開発用教室スロットには日大前由来データ(生徒129)が残っている可能性あり。クリーンアップは Feature B（下記）で正しい時点を読み込み直せる。
- **全端末でハードリロード徹底**：今回の混入の最大の引き金は「旧バンドルのキャッシュのまま操作」。各PCで一度 Ctrl+Shift+R（v1.5.301以降を読込）。

### 2026-06-11 に入れた修正（すべて本番デプロイ済み）
| 版 | 内容 |
|---|---|
| v1.5.296 | （前セッション分・生徒日程表テンプレ衝突修正）|
| v1.5.297 | コピーの参照共有を断つディープクローン化（`buildDevelopmentClassroomCopyPayload`）|
| v1.5.298 | サーバーバックアップ復元の `internal` 修正＝応答を gzip+base64 化（44MB→約2.8MB・callable 10MB上限対策）。併せて旧フィールド欠落バックアップの復元失敗も `parseWorkspaceSnapshot` の検証前補完で解消 |
| v1.5.299 | 保存経路の「対象未指定なら全教室を書く」フォールバック廃止＝`resolveWorkspaceSyncTargetClassrooms` で操作中教室のみに限定。開発者復元は復元教室IDを明示指定 |
| v1.5.300 | アカウント切替で前教室の undoSnapshot が残り別教室を汚染する不具合を修正（logout/applyWorkspaceSnapshot で破棄）。コピー確認に規模表示 |
| v1.5.301 | **Feature B**：他教室コピー廃止→「他教室バックアップを開発用教室へ読み込む」方式に置換。`listDevelopmentClassroomBackupSources`(新設)＋`downloadClassroomFromServerAutoBackup`(gzip化・権限緩和)。開発用教室の**室長アカウントでも**動作。教室画面バックアップ/復元タブの開発用パネル |
| 別途 | 振替ストックの「未消化1配置で残2減る」過剰減算修正（`makeupStock.ts` balance から overAssigned 減算撤去）／注記→授業時間ボタン化（テンプレ生徒入力 90/60/45分）|

### 混入の根本原因と対策（全経路を塞いだ）
1. コピーの参照共有 → ディープクローン（v1.5.297）
2. 保存時の全教室一括書込み → 操作中教室のみ（v1.5.299）
3. アカウント切替の undo 残存 → 破棄（v1.5.300）
4. in-memory 他教室コピー自体 → 廃止しバックアップ読込に置換（v1.5.301）
- **残リスク**：localStorage キーは全アカウント共通（`komahyouapp:workspace-snapshot`）で、同一ユーザー判定ガードで保護中。将来ガードが緩むと再発しうるため、キーをアカウント別に分離するのが恒久対策候補。
- 詳細は memory `komahyou-classroom-restore-cross-contamination.md`（第1〜3の真因・調査手法・Feature B）に集約。

### この時点での test:unit = 286 グリーン。型チェック・本番ビルドOK。

### 残っている持ち越し（2026-06-11 オーナー確認反映）
- **テンプレ挙動 Q1〜Q20：✅ 確定済み＋実装済み（追加作業なし）。** オーナー回答は `docs/spec-template-behavior.md` の正本と一致。実装デルタ Q4(定休日セル配置禁止)/Q11(単年度=反映日〜年度末3/31生成・2031上限撤廃)/Q14(入会前＋在籍を対象・講師も)/Q16(履歴3件上限)/Q17(UIは保存1本・内部overwriteは性能で保持) は**コードに反映済み**（2026-06-11 再検証：`REGULAR_LESSON_TEMPLATE_HISTORY_LIMIT=3`・`isTemplateClosedDayCell`・`filterTemplateParticipantsForReferenceDate`・regularLessonTemplate.ts に 2031/maxSchoolYear 無し）。⇒ **テンプレは完了**。Q15補足=高3は3/31まで在籍。
- **⑧ 自動割振の「オーナー判断」2件：✅ 2026-06-11 で確定・クローズ（コード変更なし）。**
  - 「区分=制約のハードフィルタ化」→ **しない／全ソフト維持で確定**（オーナー再確認）。理由＝ハードだと候補が無いときコマが空く。ソフトで必ず埋め違反は赤字警告で気づく運用。唯一のハード除外は「絶対事項」のみ。`docs/spec-auto-assign-rules.md` B節に明記。
  - 「旧『2限寄り/5限寄り』設定教室の自動移行」→ 対象教室ゼロで該当なし（クローズ）。
  - ⇒ ⑧は完全クローズ。次セッションで能動対応は不要。
- **【引き継ぎ：要対応候補】多ルール×「全員」対象のパフォーマンス最適化**：→ **専用引き継ぎ＋コピペ用プロンプトを `docs/perf-multi-rule-optimization-handoff.md` に用意済み**（ホットパスのファイル:行・最適化案・厳守事項・完了定義まで具体化）。実運用で多ルール教室が出て重くなったらそれを開いて着手。要点＝`boardStudentWarningsByLocation` useMemo の O(n²) `students.find` を Map 化、`isAutoAssignRuleApplicable`/講師解決を (studentId,dateKey) でメモ化。**挙動完全不変が絶対条件**。
- **混入の最後の残リスク**：localStorage キーのアカウント別分離（上記「残リスク」）。恒久対策候補。
- 開発用教室のクリーンアップ（日大前由来データ＋⑧テスト残差）。Feature B で正しい時点を読み込み直せる。

---

## 0. いま何をしているか（ロードマップ：Phase 0〜6 完了）※2026-06-10 時点

**本番＝v1.5.295（main 同期）。Phase 0〜6 すべて本番反映済み＝Phase 6 完了。**
（直近: v1.5.294 生徒日程表の通常授業カウント回帰修正〔PR #26〕／v1.5.295 ②復元UI整理〔PR #27〕。）
**Phase 6（最終フェーズ）完了**：⑧自動割振・②クラウド一本化ともデプロイ済。**当面の大型ロードマップは消化済み**。

### Phase 6 の状態
- **⑧ 自動割振ルール ✅ 完了・デプロイ済（v1.5.292・PR #24 マージ済・ブランチ削除済）**：build・typecheck・test:unit(278) グリーン。
  - ✅ **TODO5 ペア制約2区分**（`category` 既定=制約／優先。`pairConstraint.ts`＋`resolvePairConstraintSeverity`＋UI区分トグル＋Excel）
  - ✅ **TODO4 groupLessons 種データ空**（`initialGroupLessons=[]`。型/配管は維持＝オーナー判断）
  - ✅ **TODO3 指定時限禁止スライダー**（`forbidFirstPeriod`一般化→`forbiddenPeriods`既定[1]。1〜5限トグルUI＋スコア/警告＋Excel）
  - ✅ **TODO2 時限優先スライダー**（preferLateAfternoon/Second/Fifth 3ルール統合→「時限優先」1ルール＋並べ替えUI＋`periodPriorityOrder`＋スコア書換。既定[5,4,3,2,1]）
  - ✅ **TODO1 区分許可リスト**（編集可能 `category`＋許可リスト、`forcedRuleKeys`置換、制約/優先セクション動的振り分け＋区分トグルUI。**割振はソフト維持＝本番割振結果不変＝オーナー確認済み**）
  - ✅ **実機検証済（2026-06-10・開発用教室）**：本番アプリで講習自動割振2件実行（期間内配置・ルール対応率＝科目対応/2人同席/同日上限/時限希望 各100%）。ハイライト挙動（制約=ハイライト・優先=非ハイライト）も確認。
  - ⚠️ 残（オーナー判断）：区分=制約のハードフィルタ化（現状ソフト）／旧「2限寄り/5限寄り」設定教室の自動移行（現状未移行＝既定へ戻る・スライダー再設定で対応）。詳細＝`docs/spec-auto-assign-rules.md` 実装状況。
  - ⚠️ **【課題】多ルール×「全員」対象でのパフォーマンス**：実機（開発用教室・既配置222マス）で6ルールに「全員」を設定したところ、盤面の警告再計算＋割振が重く、1講習（6コマ/5597候補）の自動割振で**操作が数十秒ブロック**する場面があった。原因候補＝セルごとの `isAutoAssignRuleApplicable`/`resolveTargetStudentIds` 再評価が対象「全員」で全生徒×全セルに効くこと、警告 useMemo の依存再計算。実運用で多ルール運用の教室が出たら、対象判定のメモ化（studentId→適用可否のキャッシュ）や警告計算の分割を検討。
  - ⚠️ 開発用教室にテスト残差あり：6ルールに「全員」対象＋講習2件（三好/佐藤=10コマ）配置済・残ストック4件。必要なら対象クリア＋手動削除で戻す。
- **② クラウド一本化（保存・復元）✅ 完了・デプロイ済（v1.5.295・PR #27）**：
  - TODO7 復元UI整理＝教室画面の復元3種（rollback/サーバー/ローカル自動）を削除しJSON読み込み一本へ。サーバー復元は開発者画面に既設のまま。
  - TODO2 二段階保存廃止＝**見送り（維持）**：クラウドが唯一の正本だがローカルはクラッシュ復旧キャッシュとして維持（パフォーマンス主因でないためオーナー判断）。
  - TODO9 開発用コピー室長開放＝**見送り（開発者のみ）**。
  - 他項目（5s/20s・常時緑・離脱確認・オフラインブロック・保存失敗JSON DL・JSONフルスナップ）は既存充足。詳細＝`docs/spec-save-restore.md`。

### 次セッションの最初の判断（Phase 6 完了後）
- 大型ロードマップは消化済み。新規はオーナー指示の個別課題・バグ対応が中心。
- 持ち越し候補：⑧の残オーナー判断（区分=制約のハードフィルタ化／旧時限ルール教室の自動移行）、多ルール×全員のパフォーマンス最適化（§Phase6 ⑧の課題）、開発用教室のテスト残差クリーンアップ。
- **着手前に必ず現状精査**（このプロジェクトは過去修正の踏襲が前提＝`CLAUDE.md` 回帰防止ルール厳守）。書込検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。

### このセッションの完了事項（2026-06-09）
- **Phase 4-B 欠席登録UI＝実装済みと精査確認**（PR #16）。下記詳細参照。
- **Phase 4 残数差分検証 完了**（PR #17・読み取り専用）：最新本番バックアップで OLD(v1.5.289)/NEW(main) を同一入力比較 → **本番3教室は差分ゼロ**、変化は開発用教室の1キー(戸髙咲耶/算 −1→0)のみ。詳細は `spec-makeup-stock.md` §移行チェック。
- **テンプレ×休日の力関係を確認**：テンプレ反映日以降の個別休日は反映時にクリア＝営業日に戻りテンプレが入る（`filterTemplateOverwriteHolidayDates`、テスト有）。「テンプレ＞個別休日」は実装済みで正。
- **テンプレ全挙動の質問群**：`docs/spec-template-behavior.md`（Q1-Q20）。→ **2026-06-11 オーナー回答で確定済み・実装デルタも反映済み（§0-A 参照）。追加作業なし。**
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
| 6 ② 保存一本化 | 復元UI整理(JSON一本)/二段階保存=見送り(維持)/室長コピー=見送り | ✅ 完了・デプロイ済（v1.5.295・PR #27） |

### Phase 3/4 の教訓（パターン）
- 「仕様策定時の想定」と「現状実装」がズレ、**核心が既に実装済み**のことが多い。**実装前に必ず現状精査**。
- ④：`autoShortage` は「休日で潰れた通常授業の振替自動計上」だった→**残す**（仕様訂正済み）。A=未来休日も即時計上(todayキャップ撤廃)。C=残0下限＋過剰配置は一覧除外(`balance !== 0`)。

---

## 4. 本番との差・デプロイ

- **本番 = v1.5.301（2026-06-11 デプロイ）＝ main 同期。** 0-A の混入対応＋Feature B まで反映済み。差分なし。
- （以下は Phase 0〜4 当時のメモ。履歴として残置）
- ~~**本番 = v1.5.290（2026-06-09 デプロイ）＝ main 同期**~~（Phase 0〜4 反映）。
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

1. `git checkout main && git pull`（本番＝v1.5.301）。
2. `npm run test:unit`（**286件**グリーン確認）。
3. **日大前校の復旧：✅ オーナー手動復元済み（2026-06-11）。** 念のため読み取り専用で各教室 stuHash を再照合（日大前が `0c691a4075`/生徒129/テンプレ35 で安定していればOK）。万一ぶり返していたら同手順で再復元を案内。
4. 持ち越し候補（いずれも能動着手はオーナー指示後。優先度順）：
   - **多ルール×「全員」対象のパフォーマンス最適化**（実運用で多ルール教室が出たら）→ **専用引き継ぎ `docs/perf-multi-rule-optimization-handoff.md`**（コピペ用プロンプト同梱）。
   - localStorage キーのアカウント別分離（混入の最後の残リスク・§0-A）。
   - 開発用教室のクリーンアップ（日大前由来データ＋⑧テスト残差。Feature B で正しい時点を読み込み直せる）。
   - **テンプレ Q1-Q20＝確定＋実装済み（追加作業なし）／⑧オーナー判断2件＝2026-06-11 確定・クローズ（制約は全ソフト維持・コード変更なし）（§0-A）。** ＝当面の能動タスクは無し。新規はオーナー指示待ち。
5. **着手前に必ず現状精査**（このプロジェクトは過去修正の踏襲が前提＝`CLAUDE.md` 回帰防止ルール厳守）。書込検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。
6. sed を使うなら §5 の改行コード正規化を忘れない（原則 Edit ツール使用）。
