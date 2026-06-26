# 引き継ぎ資料：生徒日程表「オプション欄」機能（開発用教室のみ）

最終更新: 2026-06-26 / ブランチ: `claude/koma-schedule-options-field-0hia1q`

このファイルだけ読めば、この機能の状態・残作業・デプロイ手順が分かるようにまとめてある。

---

## 0. 一言サマリ

生徒日程表の **休み欄を削除**し、**振替授業欄を左に詰め**、空いたスペースに **オプション欄（2列5行）** を追加した。
左列＝学年共通のテキスト入力、右列＝QR提出のチェック状態（✓）。**開発用教室（`開発用教室`）でのみ有効**。

実装は2フェーズとも**コード完了・テスト緑・ビルド成功・プッシュ済み**。
残るは **デプロイのみ**（フロントは main マージで自動、Cloud Function だけ PC で手動）。

---

## 1. ブランチとコミット

- ブランチ: `claude/koma-schedule-options-field-0hia1q`（origin にプッシュ済み）
- コミット:
  - `4c90e82` feat: 休み欄削除＋オプション欄(2列5行)追加（第1フェーズ：レイアウト＋文言入力）
  - `9918514` feat: オプション欄のQRチェック往復を実装（第2フェーズ）
  - （本ドキュメント追加コミット）

---

## 2. やったこと（仕様）

ユーザー指示の確定事項:
- オプション左列テキストは **学年で共通**（共通連絡事項(学年別)と同じ `scheduleNotes` の仕組み）。
- 右列は **チェックマーク1文字分**の細い列、左列を大きく。
- 右列は **QR提出のチェック状態**を反映。**既定は未チェック**。
- QR画面では **集団の下** にオプション欄（文言＋チェックボックス）を表示。
- **まず開発用教室のみ**。

### 第1フェーズ（レイアウト＋文言入力）
- `src/utils/featureRollout.ts`：`studentScheduleOptionField`（scope=`development-only`）を追加。
- `src/utils/scheduleHtml.ts`：`renderBottomSection` を分岐。フラグONで休み欄を出さず、
  `共通連絡事項｜個別連絡事項｜振替授業｜オプション｜回数` の並びに。`renderOptionSection`（2列5行）追加。
  - 左列の note キー: `student-option-grade-{学年}-{行0..4}`（保存形式は `student:` プレフィックス付き）。
- `src/components/schedule-board/ScheduleBoardScreen.tsx`：`isFeatureEnabledForClassroom(..., { name: classroomName })`
  で判定し、`optionFieldEnabled` を各 schedule 呼び出しへ渡す。

### 第2フェーズ（QRチェックの往復）
既存の集団参加（`groupClassParticipation`）と**同じ経路**に載せた。
- `src/integrations/firebase/lectureSubmission.ts`：提出ドキュメントに `optionLabels`（学年共通文言）/
  `optionChecks` を追加。reset・購読（`SubmissionChangeEntry`）・既発行QRの後埋め
  （`updateSubmissionOccupiedSlots`）にも反映。
- `functions/src/index.ts`（**Cloud Function `lectureSubmissionApi`**）：GET で `optionLabels`/`optionChecks`
  を返却、POST で `sanitizeOptionChecks`（非空ラベル行のみ true を保存）→ スナップショットの
  `studentInputs` へマージ。
- `src/App.tsx`：開発用教室のときだけ `scheduleNotes` から学年共通文言を解決して提出ドキュメントへ載せる。
  購読マージで `optionChecks` を `studentInputs` へ反映。
- `src/components/submission/SubmissionPage.tsx`：集団授業の下に「オプション」欄。文言のある行のみ
  チェックボックス表示、提出時 `optionChecks` 送信、提出済み画面は あり/なし の読み取り表示。
- `src/utils/scheduleHtml.ts`：重なるセッションの `studentInput.optionChecks` を直列化生徒へ載せ、右列に✓描画。
- `src/components/special-data/specialSessionModel.ts`：`SpecialSessionStudentInput.optionChecks` 追加。

### データの流れ（往復）
```
室長: 生徒日程表オプション左列に文言入力（学年共通・scheduleNotes）
  → QR発行/同期時に学年→文言を解決し lectureSubmissions ドキュメントへ optionLabels として保存
保護者/生徒: QR画面「オプション」でチェック → POST optionChecks
  → Cloud Function が sanitize して保存＋スナップショット studentInputs へマージ
室長アプリ: subscribeLectureSubmissions で optionChecks を studentInputs へ反映
  → 生徒日程表オプション右列に✓表示（重なるセッションの値を使用。既定=未チェック）
```

---

## 3. デプロイ手順（ここが重要）

CI（`.github/workflows/deploy-firebase-hosting.yml`）は **`main` への push で `--only hosting` のみ**自動デプロイする。
**Cloud Function は CI ではデプロイされない。**

### 3-1. フロント（ホスティング）＝スマホだけでも可
このブランチを `main` にマージすれば CI が自動でホスティングをデプロイする
（休み欄削除・オプション欄レイアウト・QR画面のオプションUI が反映される）。

### 3-2. Cloud Function ＝ PC で手動（必須・担当: オーナー）
QRチェックの「保存・返却・反映」を動かすには `lectureSubmissionApi` のデプロイが必要。
**未デプロイでもフロントは動く**が、QRでチェックしても右列に✓が反映されない（保存もされない）。

PC（Firebase 認証あり）で、リポジトリのルートで:
```bash
# 関数のみをデプロイ（推奨・最小影響）
npm --prefix functions run build
npx firebase-tools deploy --project komahyouapp-prod --only functions

# もしくは hosting/firestore も含めてまとめて（ローカルの正規フロー）
npm run deploy:firebase:with-functions
```
> `npm run deploy:firebase:with-functions` は内部で `build:functions` 後に
> `hosting,firestore,functions` をデプロイする（`tools/deploy-firebase.mjs`）。

### 3-3. デプロイ順序の注意（後方互換なので順不同で安全）
全変更は **後方互換**（フィールドは optional・既定空、既存の集団参加と同じ規約）。
フロント先行でもCloud Function先行でも、他教室・既存機能には影響しない。
完全動作には **両方** のデプロイが必要。

---

## 4. 検証状況（このセッションで実施済み）

- 型チェック: app（`tsc -b`）/ functions（`functions/` で `tsc`）ともにOK。
- ユニットテスト: **377 件すべてグリーン**（`npx vitest run`）。回帰防止テストを追加:
  - フラグの有無でレイアウト出し分け（休み欄/オプション欄）。
  - 提出セッションの `optionChecks` が直列化生徒→DATA→右列✓描画に流れること。
- 本番ビルド: app `npm run build` / functions `npm --prefix functions run build` 成功。
- Lint: 変更による新規エラー 0（既存エラー件数のみ）。
- 目視（Playwright/Chromium）:
  - 生徒日程表: 休み欄が消え、振替が左詰め、オプション欄が2列5行で表示。
    `optionChecks:{'0':true,'2':true}` が右列で `[✓, , ✓, , ]` に描画されることを確認。
  - QR画面(`#/submit-debug`): 「集団授業」の下に「オプション」欄。文言のある行のみチェックボックス表示を確認。

---

## 5. 仕様メモ・既知の注意点

- **開発用教室判定**は `isDevelopmentClassroom`（教室名に「開発用教室」を含むか等）に依存。
  本番教室では従来どおり休み欄が残る。
- **どのセッションのチェックを表示するか**: 既存の `findOverlappingSession`（表示期間に重なる講習）に従う。
  集団参加・提出済みバッジと同じ挙動。
- **学年共通文言の後埋め**: 文言は QR 発行時にドキュメントへスナップショットされるが、
  後から文言を編集しても `updateSubmissionOccupiedSlots`（盤面同期時に走る）で未提出QRへ反映される。
- **右列は表示専用**（室長が手でチェックする欄ではない）。チェックは QR 経由のみ。
- `optionLabels`/`optionChecks` は他教室でも空で保存されうるが、これは既存の
  `groupClassParticipation: {}` / `availableGroupClassSubjects: []` と同じ規約で**無害**。

---

## 6. 次フェーズ候補（未着手・必要なら）

- 全教室への展開（`featureRollout` を `all-classrooms` に昇格）。本番で検証後に。
- オプション文言の専用管理UI（現状は生徒日程表の左列に直接入力）。
- スマホだけで関数デプロイしたい場合: `workflow_dispatch` の手動トリガー Actions を追加すれば
  GitHubモバイルから関数デプロイ可能（要・サービスアカウントへの関数デプロイ権限）。

---

# 別案件：未消化振替の自動割り当て（アーキテクチャ設計／未実装）

> このセクションは**オプション欄とは独立した次の新機能**の設計メモ。PCで関数デプロイを終えた後に着手する想定。
> 実装前にこの設計を確認し、下記「回帰ガード」を必ず踏むこと。

## A. 何を作るか（確定仕様）

未消化講習の自動割り当て時に、**選択式（チェックボックス）で未消化振替も同時に自動割り当て**する。

- 未消化振替も、**未消化講習と同じ自動割り当て規則・条件**で割り振る。
- 順序：**先に未消化講習を割り振り**、**次に未消化振替を「振るい順」から割り振る**。
- 割り振り切れなかった分は、**講習と同様に未消化のままストックに残して完了**する（エラーにしない）。

## B. 現状の把握（既存コードの要点）

すべて `src/components/schedule-board/ScheduleBoardScreen.tsx`（巨大ファイル）に集中している。

### B-1. 未消化講習の自動割り当て（既存・流用元）
- 入口: `handleAutoAssignLectureStockEntry(entry)`（≈ L6724）。
  生徒1人分の未消化講習を、空きが無くなるまで貪欲ループで配置する。残りはストックに残す。
- 候補探索: `findBestLectureAutoAssignCandidate({ sourceWeeks, pendingItems, managedStudent, studentKey })`（≈ L4585）。
  **ここで自動割り当て規則をすべて適用**している（科目対応講師のみ / 通常講師のみ / 同日コマ数上限 /
  指定時限禁止・時限優先 / ペア制約 / 生徒の出席不可コマ / 同コマ重複 / 在籍日・開校日）。
  共通スコアは `buildCommonAutoAssignScoreParts` / `buildForcedConstraintScoreParts`（≈ L330〜）。
- 配置: ループ内で `lessonType: 'special'`・`makeupSourceDate`(=講習元) を立て、
  `manualLectureStockCounts`/`manualLectureStockOrigins` を減算 → 最後に `commitWeeks(...)`（≈ L6840）。
- UIトリガー: StockActionModal（type `'lecture'`）の「自動割振」ボタン（≈ L8497）→
  `runStockAutoAssign(key, () => handleAutoAssignLectureStockEntry(entry))`。

### B-2. 未消化振替（振替ストック）
- モデル: `makeupStock.ts` の `MakeupStockEntry`。`balance`（割り振るべき振替数）と
  `remainingOriginDates`/`remainingOriginLabels`/`remainingOriginReasonLabels`（**振替元の一覧＝振るい順**。
  **日付昇順＝古い順がそのまま振るい順**）、`nextOriginDate` を持つ。**科目ごと**のエントリ。
- グルーピング: `makeupStockEntries`（≈ L3890）が生徒単位に集約（`balance` は科目合算）。
  生徒の科目別 raw は `rawMakeupStockEntries`。
- **重要**: 振替の `balance` は**盤面から都度再計算**される（明示カウンタを持たない）。
  盤面に振替授業を1コマ置けば `assignedMakeupLessons` が増え、再計算で `balance` が1減る。
- 手動配置: `confirmMakeupPlacement` 相当（≈ L6582）。`lessonType: 'makeup'`、
  `makeupSourceDate/Label` を `resolveSelectedMakeupOrigin` で決め、note「元の通常授業: …（理由）」を付ける。
  配置は `normalizeLessonPlacement(...)` を通す（**この正規化を必ず踏襲する**）。
- UIトリガー: StockActionModal（type `'makeup'`、≈ L8529）は**手動配置のみ**で自動割振ボタンが無い。

### B-3. 既に用意済みの足場（流用できる）
- 型 `MakeupAutoAssignPendingItem`（subject / makeupSourceDate / makeupSourceLabel / makeupSourceReasonLabel）
  と `MakeupAutoAssignCandidate` が**定義済み**（≈ L221〜238）。
- `buildAutoAssignDebugReport`（≈ L4553）は `Array<LectureAutoAssignCandidate | MakeupAutoAssignCandidate>`
  を**既に受け取れる**。`commitWeeks` は振替系引数（`manualMakeupAdjustments` 等）も受け取れる。

## C. 設計（推奨アプローチ）

### C-1. 候補探索は「共通化」して規則のドリフトを防ぐ（回帰防止の肝）
`findBestLectureAutoAssignCandidate` の**セル×机×生徒スロットごとの規則評価**（L4607〜の二重ループ内、
forbidFirstPeriod / subjectCapableTeachersOnly / regularTeachersOnly / lessonLimit / pairConstraint /
studentUnavailable / duplicate / isOpenDay / isActiveOnDate）を、**講習・振替で共有する内部ヘルパ**に
切り出す。差分は以下の3点だけをパラメータ化する（`kind: 'lecture' | 'makeup'`）：

1. **matchedItem の絞り込み**
   - 講習: `isDateWithinRange(cell.dateKey, item.startDate, item.endDate)`（講習期間）＋ `item.unavailableSlots`。
   - 振替: **トリガーした講習の期間に限定**（確定）。`isDateWithinRange(cell.dateKey, session.startDate, session.endDate)`
     を適用する。`session` は結合フローの起点となった `GroupedLectureStockEntry` の `sessionId` から引く
     （`specialSessions.find(s => s.id === entry.sessionId)`）。`item.unavailableSlots` は無し。
     生徒の出席不可コマ・同コマ重複は**共通で適用**。
2. **スコア差分**（共通スコアは流用）
   - 講習: 「未消化講習由来(session優先)」＋「講習終了日優先」。
   - 振替: 上記2つの代わりに「**振替元の振るい順優先**（古い origin ほど高得点）」を入れる。
     例: `99999999 - Number(originDateKey.replace(/-/g,''))`（講習終了日優先と同じ作り）。
3. **配置時の差分**
   - 講習: `lessonType:'special'` ＋ `manualLectureStockCounts/Origins` 減算。
   - 振替: `lessonType:'makeup'` ＋ `makeupSourceDate/Label` 設定＋note付与。**カウンタ減算は不要**
     （`balance` は盤面から再計算）。ただし **origin を振るい順に1つずつ消費**し、同じ origin を二重割当しない。

> 代替案：共通化せず `findBestMakeupAutoAssignCandidate` を別関数で複製。実装は速いが、**規則ロジックが
> 二重管理になりドリフト＝回帰の温床**（CLAUDE.md 回帰防止ルール）。**共通化を推奨**。
> どうしても複製する場合は、両関数が同一規則であることを保証するテストを必ず置く。

### C-2. 振替の pending items（振るい順）の作り方
対象生徒の `rawMakeupStockEntries`（`balance > 0`）から、科目ごとに `balance` 個の
`MakeupAutoAssignPendingItem` を生成。各 item の origin は `remainingOriginDates[i]` を**昇順（振るい順）**で
割り当てる。配置で1つ置くたびに、その origin を「消費済み」にして次の item は次の origin を使う
（手動の `resolveSelectedMakeupOrigin` と整合させる）。

### C-3. 結合フロー（選択式ON時）
`handleAutoAssignLectureStockEntry` を拡張、または新規 `handleAutoAssignStockEntry(entry, { includeMakeup })`：

1. **講習を全て配置し終える**（既存ループそのまま）→ `nextWeeks` 更新。
   ※ 確定仕様：**講習を全部埋めてから**振替に着手する。講習が残っていても振替へ進む（残りはストックに残す）が、
   振替の配置は必ず講習ループ完了**後**に開始する（同一 `nextWeeks` を順に処理＝順序保証）。
2. `includeMakeup` のとき、**同じ生徒**の振替 pending items を振るい順で構築。
3. **同じ `nextWeeks` 上で**振替配置ループを回す（講習が埋めた後の空きに振替が入る＝指定順序を満たす）。
   候補探索は C-1 の共通ヘルパを `kind:'makeup'` で使用。**対象セルは講習期間内のみ**（C-1 の振替絞り込み）。
   残りはストックに残す。
4. `commitWeeks(...)` を**1回**で確定（講習ストック減算＋振替系引数の両方を渡す）。
5. レポートは講習・振替を合算（`buildAutoAssignDebugReport` は union 対応済み）。
   ステータス例：「講習Xコマ・振替Yコマ配置。講習A・振替Bは候補不足でストックに残しました。」

### C-4. UI（選択式）
StockActionModal（type `'lecture'`、≈ L8497 付近）に
**チェックボックス「未消化振替も同時に自動割り当てする」**を追加し、その値を結合フローへ渡す。
- 状態は `useState`、**既定 OFF（確定）**。必要なら盤面設定/ローカルへ記憶。
- 「未消化振替のみ」を単独自動割振したい要望が出たら、makeup モーダル（L8529）にも自動割振ボタンを足せる
  （結合フローの振替パートを単独実行）。**今回の仕様は講習トリガー時の選択式が主**。

## D. 触るファイル / 追加物

- `src/components/schedule-board/ScheduleBoardScreen.tsx`
  - 候補探索の規則評価を内部ヘルパへ抽出（C-1）。**できれば `autoAssignCandidate.ts` 等へ切り出し**て
    単体テスト可能にする（巨大ファイル＆ホットパスなので分離の価値大）。
  - 振替 pending builder（C-2）、結合ハンドラ（C-3）、モーダルのチェックボックス（C-4）。
- テスト（必須・回帰防止）
  - **ゴールデン**：抽出前後で**講習自動割振の結果が不変**であること（既存の `makeupStockSnapshot.test.ts` /
    `makeupStock.test.ts` の作法に倣い、代表盤面で配置結果スナップショット）。
  - 振替自動割振の新規テスト：振るい順で消費されること／規則（科目対応・コマ数上限・時限禁止・ペア）を
    講習と同条件で満たすこと／balance を超えて置かないこと／置けない分が残ること。

## E. 注意・落とし穴（CLAUDE.md 回帰防止に直結）

- **`{ ...a, ...b }` で生徒同一性フィールドを潰さない**（過去の `mergeManagedDeskLesson` 回帰／commit
  `6793374`→`2dce7b4`）。振替配置は手動の `normalizeLessonPlacement` と origin/note 付与を**完全踏襲**する。
- 振替の `balance` は盤面再計算ベース。**明示カウンタを足し引きしない**。二重配置防止は「origin 消費」で行う。
- 講習を**先**に置いてから振替を置く（同一 `nextWeeks`）こと。順序を逆にすると指定仕様に反する。
- 「割り振り切れない＝残す」。**例外やロールバックにしない**。部分成功で `commit` し、残数を報告。
- これは盤面（コマ表）操作であり**開発用教室で検証**してから本番運用へ（本番データ保護ルール）。
- 巨大ホットパスのため、抽出時に**スコア計算順序・配列順を変えない**（候補同点比較 `compareAutoAssignCandidateOrder`
  が順序依存）。スナップショットで担保する。

## F. 確定事項（2026-06-26 オーナー回答・実装はこれに従う）

1. **選択式チェックの既定 = OFF。** ユーザーが明示的に ON にしたときだけ振替も自動割り当てする。
2. **振替の配置対象期間 = 講習期間に限定。** トリガーした講習（`entry.sessionId` の session）の
   `startDate`〜`endDate` 内の開校日セルのみを振替の配置先にする（C-1 の振替絞り込み・C-3 を参照）。
3. **優先順位 = 講習を全て埋めてから振替に着手。** 講習配置ループを完了させた後に振替ループを開始する
   （同一 `nextWeeks` を順に処理＝順序保証。C-3 を参照）。

> これで設計は確定。未確定点なし。実装はこのセクションと C 章に従う。
