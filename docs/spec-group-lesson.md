# 確定仕様：集団授業（特別講習）— 正本

> 2026-06-12 オーナーQ&Aで確定。特別講習期間に中3向けの集団授業（集団理科／集団社会）を導入する。
> **既存の個別授業（`DeskLesson`）には一切干渉しない**。新しい行・新しいデータ経路として実装する。

## 0. 全体方針（最優先）

- **個別授業に非干渉**：本番3教室の稼働中データに影響を出さない。集団は独立構造で追加のみ。
- **検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。問題なしを確認してから全教室へ反映。
- 旧「グループ授業」(`groupLessons` / `GroupLessonRow`、廃止済の死蔵)は**流用しない**。別概念。
- 「特別講習を含む週」「期間帯ヘッダ」は既存の `specialPeriods`（`BoardGrid.tsx` の `specialPeriodSegments`）を流用。
- 科目は **集団理科／集団社会の2種固定**（集団英数国などは無し）。
- 参加対象は **中3のみ**（`grade === '中3'`）。

## A. コマ表盤面

- 1限の上に、**特別講習期間を含む週だけ** 集団行を **2行** 追加する。
  - 集団①：左端時限セル `集団 10:00-11:00`
  - 集団②：左端時限セル `集団 11:10-12:10`
- 各行は **特別講習期間内の全開校日** にだけセルを出す（期間外の日・休校日は空白/非活性）。期間が週またぎ・複数重複でも日単位（開校日かつ期間内）で判定。
- 1日 × 1バンドのセル構成（既存4サブ列 席/講師/生徒/生徒 を流用）：
  - 席列＝**空欄**
  - 講師列＝**担当講師セル（手入力・1名／共同担当なし）**
  - 生徒2列＝**結合した1セル＝科目セル**（集団理科／集団社会を表示）
- セルのクリック挙動（2段階）：
  - **空の科目セル** → 科目ピッカー（集団理科／集団社会）
  - **科目入りの科目セル** → クリックメニュー（**出席者一覧** ／ **削除**）
    - 出席者一覧 → 出席者モーダル（§B）
    - 削除 → その日その時間帯の集団授業を消去（科目・担当・出欠をクリアして空セルに戻す）
- 集団行のセルは**専用ハンドラ**で処理し、個別の `DeskLesson` のセル選択/講師割当ロジックには混ぜない。

## B. 出席者モーダル ＋ PDF

- 科目セル → クリックメニュー →「出席者一覧」で出席者モーダルを開く。
- **名簿の初期メンバー＝その科目に「参加」提出した中3**。**全員デフォルト出席**、欠席者だけクリックで欠席に切替。
- **手動追加（確定・入れる）**：当日参加した中3を名簿に手動追加できる。提出前/未提出の参加者や飛び込み参加でデータ欠落しないための安全弁。追加した生徒も出席・給与・回数に反映。
  - データは studentId 基準の出欠マップで保持し、手動追加に耐える設計とする。
- **出欠の入力点はこのモーダルのみ**（唯一の真実）。講師日程表（給与）・生徒日程表はこの結果を反映するだけ。
- **キャンセル＝未入力で閉じる**（変更破棄）／保存ボタンで確定。
- **PDF印刷**：ヘッダ（教室名・日付・時間帯・科目・担当講師）＋出欠一覧（出席/欠席の別）＋末尾に出席◯名/欠席◯名の集計。

## C. 希望提出（中3のみ）

- 既存の希望提出フォームに **集団(理科)／集団(社会)** を追加。**中3以外には表示しない**。
- 入力は回数ではなく **参加／不参加**。**デフォルト＝不参加**。特別講習ごと（`SpecialSessionStudentInput`）に保持。
- 室長の日程表登録UIからも参加/不参加を切替可能（既存の希望科目数と同じ二経路）。
- **講習ストック・振替には一切影響させない**（集団は振替を行わない）。

## D. 回数欄（日程表 右下／講習回数表）

- 講習回数表に科目として **集理（集団理科）／集社（集団社会）** を追加（中3参加者のみ）。
- 個別と同じく **日程表の表示期間中だけ** で集計する：
  - **希望回数（右括弧／planned）＝表示期間中に盤面へ置かれた当該集団科目のコマ数**
  - **講習回数（左／actual）＝表示期間中のその生徒の出席数**
- 不一致は既存の警告スタンプで「欠席のあった参加者」を可視化（既存挙動を流用）。

## E. 生徒日程表

- 中3全員に集団行を追加。表示は **「登録」状態** で出し分ける：
  - **未登録（室長の日程表登録 countSubmitted=OFF かつ 生徒QR提出も無い）→ 中3全員に集団(理科)/集団(社会)を表示**（周知目的）。
  - **登録済み（室長が日程表で登録 countSubmitted=ON、または 生徒がQR提出済み）→ 参加を選んだ生徒のみ表示＋その生徒の出欠を反映**。
- 「登録済み」の定義＝既存の提出フローと同様（室長登録 or 生徒QR提出）。

## F. 講師日程表 ＋ 給与

- 特別講習を含む期間に集団行を追加。担当に割当たった講師の日程に集団(理科)/集団(社会)を表示。
- 給与＝既存 A/B/C/D とは別の **専用カテゴリ「集団」1種**。
  - **1バンド＝1コマ**。**出席1名以上で実施1コマ** としてカウント。
  - 理科/社会・時間帯・授業時間で単価は分けない（1単価）。
- **交通費（出勤日数 attendanceDays）に集団のみ担当した日も加算**する（漏れ防止）。

## G. 保存 / スナップショット

- 集団の割当（日 × バンド：科目＋担当講師）と出欠（インスタンスごとの出欠マップ）を `PersistedBoardState`（盤面スナップショット）に新構造で保存。**既存フィールドは非破壊で追加のみ**。
- スナップショット往復（保存→復元）で欠落しないこと、Firestore 分割保存（`workspaceStore.ts`）でも往復することをテストで保証。

## H. 移行（夏期講習が提出中・2026-06 時点）

- 集団の参加/不参加は新規 optional フィールド。**未設定＝不参加** として読むため、**既存の提出データは書き換えない**。
- 既に提出済みの中3は自動的に「不参加」。**提出状況（提出済み/ロック）も変えない**。
- 特定の中3を参加させたい場合は、**室長が日程表の登録UIから参加に切替**（生徒の提出ロックには触れない＝提出状況を保持）。

## I. 安全側の既定（実装で織り込む）

1. 科目を変更/削除したらそのセルの**出欠をクリア**（理科の欠席が社会名簿に残らない）。
2. 名簿（参加者）が後から変わっても、**確定済みの出欠記録（studentId基準）は保持**。増えた参加者のみ default 出席。
3. 給与の attendanceDays に**集団実施日も加算**。
4. 集団行は専用ハンドラで個別ロジックと分離。

## J. 確定済み（旧オーナー確認待ち）

- **#1 出席者モーダルの手動追加 → 入れる（2026-06-12 確定）**。名簿初期＝参加提出者、当日参加の中3を手動追加可。追加分も出席・給与・回数へ反映。
  - データ構造は studentId 基準（手動追加に耐える形）。
- これにより全仕様の未決事項なし。実装着手可。

---

## 実装計画（フェーズ分割）

> 各フェーズで回帰防止テストを追加し、**修正なしで落ち・修正ありで通る**ことを確認する（CLAUDE.md 回帰防止ルール）。
> 個別授業のスナップショット・回数・給与が**変化しない**ことを各フェーズのゴールデン/回帰テストで保証する。

- **Phase 0 — データモデル＆保存 ✅ 実装（未コミット）**：型追加（盤面の集団割当・出欠／`SpecialSessionStudentInput` の集団参加）。`PersistedBoardState` とスナップショット往復、分割保存読込の Pick 追加、ダーティ判定署名への組込み。UIなし・既存に非干渉。
  - 新規 `src/components/schedule-board/groupClass.ts`：型（`GroupClassSubject`/`GroupClassBand`/`GroupClassEntry`/`GroupClassEntryMap`）＋ `groupClassEntryKey`・`normalizeGroupClassEntryMap`（防御的パース）・`cloneGroupClassEntryMap`。テスト `groupClass.test.ts`（JSON往復含む）。
  - `specialSessionModel.ts`：`SpecialSessionStudentInput.groupClassParticipation?`（科目→bool・未設定=不参加）＋ `groupClassSubmissionSubjects`・`resolveGroupClassParticipation`。テスト追加。
  - `appState.ts`：`PersistedBoardState.groupClassEntries?`（optional・後方互換）。
  - `workspaceStore.ts`：`FirebaseClassroomBoardStockDoc` の Pick に `groupClassEntries` 追加（分割読込 `boardUi && boardStock` 経路で復元）。
  - `ScheduleBoardScreen.tsx`：state（パススルー）＋ `createInitialBoardSnapshot` 復元＋ 3 publish 経路で再送出＋ effect deps。**編集UIなし（Phase 1）**。
  - `App.tsx`：`buildBoardDataForSignature` に `groupClassEntries`（集団変更を未保存検知）＋ studentInput 明示再構築2経路で `groupClassParticipation` 保全。
  - 検証：`tsc -b` クリーン、`vitest` 全 **325 通過**（既存スナップショット無傷＝個別非干渉）、新規/変更ファイルの eslint クリーン。
  - **Phase 0 残（後続フェーズで対応）**：undo/redo 履歴(`createHistoryEntry`)への集団取り込み（編集UI登場の Phase 1）／QR提出 Cloud Function の studentInputs サニタイザに `groupClassParticipation` 追加（Phase 3。在宅保存は汎用 `sanitizeForFirestore` で既に保持）。
- **Phase 1 — 盤面描画 ✅ 実装（未コミット）**：集団2行（特別講習を含む週・期間内開校日のみ）・科目ピッカー・担当講師セル・クリックメニュー（出席者一覧/削除）・科目変更で出欠クリア。
  - `groupClass.ts`：`resolveGroupClassDayFlags`（週内のどの日に集団行を出すかの純粋判定）＋テスト。
  - `BoardGrid.tsx`：`tbody` 先頭に集団2行を描画（時限セル「集団 10:00-11:00 / 11:10-12:10」・席空・講師セル・科目結合セル）。`onGroupSubjectClick`/`onGroupTeacherClick` プロップ。
  - `ScheduleBoardScreen.tsx`：`GroupClassMenuState`（subject-pick / subject-actions / teacher）＋ハンドラ（commit/科目選択/講師選択/削除/出席者一覧を開く）。`setGroupClassEntries` の変更は effect(3244) で publish。科目変更時は出欠クリア。専用ハンドラで個別と分離。
  - `App.css`：集団行のスタイル。
  - 検証：`tsc -b` クリーン、`vite build` 成功、`vitest` 全 **329 通過**、プレビュー起動でコンソールエラーなし（盤面到達は認証要のため未確認＝本番ログイン/書込みは規約上回避）。
  - **Phase 1 残**：出席者モーダル本体＋PDF は Phase 2（現状は最小モーダル＝ヘッダ表示＋閉じる）。undo/redo への集団取り込みは未対応（group 変更は publish/保存はされるが Ctrl+Z 非対応）→ Phase 2 で対応検討。
- **Phase 2 — 出席者モーダル＋PDF ✅ 実装（未コミット）**：名簿（参加提出者＋手動追加）・default出席・欠席トグル・キャンセル・PDF（ヘッダ＋出欠＋集計）。
  - 新規 `groupAttendanceHtml.ts`：`buildGroupAttendanceHtml`（印刷用HTML・教室/日付/時間帯/科目/講師＋出欠一覧＋人数集計）＋ `openGroupAttendancePrint`（別窓印刷）。テスト6件（内容・集計・空・HTMLエスケープ）。
  - 新規 `GroupAttendanceModal.tsx`：ローカル状態で出欠編集（既定出席・欠席トグル）・中3手動追加（在籍中3から）・保存/キャンセル・PDF印刷。出欠の唯一の入力点。
  - `ScheduleBoardScreen.tsx`：最小モーダルを本モーダルへ差し替え。名簿初期＝被覆する特別講習で `resolveGroupClassParticipation` が true の中3、手動追加候補＝在籍中3（`resolveCurrentStudentGradeLabel`）。保存は `commitGroupClassEntry` で absent/added を集団エントリへ。
  - `App.css`：モーダルのスタイル。
  - 検証：`tsc -b` クリーン、`vite build` 成功、`vitest` 全 **335 通過**、新規 lint クリーン。モーダル本体は認証の先のため live 未確認（PDFはユニットテストで担保）。
  - **Phase 2 残**：undo/redo への集団取り込みは引き続き未対応（保存は反映されるが Ctrl+Z 非対応）。
- **Phase 3 — 希望提出 ✅ 実装（未コミット）**：中3のみ集団(理科)/集団(社会)の参加/不参加（既定不参加）。subjectDurations の全レイヤーにならって移植。
  - `lectureSubmission.ts`：`LectureSubmissionDoc` に `availableGroupClassSubjects?`（中3のみ非空）/`groupClassParticipation?`。トークン生成・リセット・`SubmissionChangeEntry`・購読に反映。
  - `App.tsx`：トークン生成元で `availableGroupClassSubjects`（講習開始日基準で中3判定）を付与。購読反映パスで `groupClassParticipation` を反映。
  - `SubmissionPage.tsx`：中3（availableGroupClassSubjects 非空）に「集団授業（中3）」セクション＝科目ごと参加/不参加（既定不参加）。state/load/payload に追加。
  - `functions/src/index.ts`：`sanitizeGroupClassParticipation`（allowed＝中3の集団科目のみ・true のみ保存）。GET/POST/スナップショット studentInputs に反映。Functions ビルド通過。
  - 検証：app `tsc -b` クリーン、Functions `build` 成功、`vitest` 全 **335 通過**（App.test 修正含む）、`vite build` 成功。
  - **移行**：既存提出ドキュメントは `availableGroupClassSubjects` を持たない→提出ページに集団欄が出ず、`groupClassParticipation` 未設定＝不参加。既存 studentInputs も未設定＝不参加で**提出状況不変**。現行の夏期講習の中3を参加にする経路（室長が日程表で設定）は Phase 4 で追加。
- **Phase 4 — 生徒日程表＋回数欄 ✅ 実装（未コミット）**：未登録=全員表示／登録後=参加者のみ＋出欠反映。講習回数表に集理/集社（表示期間内：希望=盤面コマ数 / actual=出席数）。
  - `scheduleHtml.ts`：`SchedulePayload.groupClassEntries`＋`SerializedStudentSpecialSessionInput.groupClassParticipation` をシリアライズ。埋め込みJSに集団ヘルパ（`getGroupClassEntry`/`getGroupSessionInputForStudent`/`isGroupRegistered`/`isGroupParticipant`/`isInGroupRoster`/`isGroupAbsent`/`buildStudentGroupRowsHtml`/`injectGroupClassCounts`）。
  - `buildStudentSheetHtml`：中3に集団2行を `<tbody>` 先頭へ差し込み。`visibleLectureCounts`/`visibleDesiredLectureCounts` に集理/集社を注入（→ 既存の講習回数警告も集団の欠席を拾う）。集団行/欠席のCSS追加。
  - `ScheduleBoardScreen.tsx`：5つの schedule HTML 呼び出しに `groupClassEntries` を渡す。
  - 検証：`tsc -b` クリーン、`vite build` 成功、`vitest` 全 **336 通過**（埋め込みスクリプト構文検証38件＋集団シリアライズ/ヘルパ存在テスト追加）。
  - **Phase 4 残**：室長が日程表から集団参加を設定する経路は未実装（open-questions Q2）。現行夏期講習で「登録後=参加者のみ」を使うには室長設定経路 or QR再発行が必要。
- **Phase 5 — 講師日程表＋給与 ✅ 実装（未コミット）**：集団行表示・専用カテゴリ「集団」1コマ集計（出席1名以上）・交通費日数に集団実施日加算。
  - `scheduleHtml.ts` 埋め込みJS：`teacherMatchesGroupEntry`（担当一致＝entry.teacherName と teacher.name/fullName 照合）・`getTeacherGroupEntriesInRange`・`getGroupPresentCount`（名簿=参加 or 手動追加−欠席）・`buildTeacherGroupRowsHtml`（未実施はグレー）。
  - `buildTeacherSalaryData(entries, teacher, startDate, endDate)`：カテゴリ G を追加。担当集団コマで出席1名以上=実施1コマ、交通費(attendanceDays)にも加算。`renderSalarySection` に「集団 (1コマ)」行（count≥1で表示・単価1種・既存 recalcSalary が自動合算）。
  - `buildTeacherSheetHtml`：集団2行を tbody 先頭へ。salary 呼び出しに teacher＋range を渡す。
  - 検証：`tsc -b` クリーン、`vite build` 成功、`vitest` 全 **337 通過**（給与カテゴリ/講師ヘルパ存在テスト追加・構文検証含む）。
- **Phase 7 — 室長参加設定＋既存QR対応 ✅ 実装（オーナー回答 Q1 反映・未デプロイ）**：
  - **日程表モーダル（室長）**：`scheduleHtml.ts` の希望科目数モーダルに中3のみ集団参加トグル＋「集団参加を保存」ボタン。**登録済みでも編集可**（既存データ・登録状態を維持したまま参加を切替）。`schedule-student-group-save` メッセージ／`updateStudentCountLocally` で集団参加を明示保全。
  - **App.tsx**：`schedule-student-group-save` ハンドラ（`{...previousInput, groupClassParticipation}` で既存・提出状況を維持）。
  - **既存QR対応**：`lectureSubmission.ts` `updateSubmissionGroupClassEligibility`（未提出ドキュメントへ集団科目を後埋め・冪等・提出済みは触らない）。App.tsx のトークン同期で未提出中3に後埋め→**配布済みQRのままでも生徒が集団を選べる**。
  - 検証：app `tsc -b` クリーン、Functions `build` 成功、`vitest` 全 **337 通過**（埋め込みスクリプト構文検証含む）、`vite build` 成功。
  - **移行**：提出済み(登録済み)生徒は室長モーダルから集団参加を設定でき、既存の提出データ・提出状況は維持。

- **Phase 6 — 結合検証→反映（オーナー実施・Claudeはデプロイ/本番書込み不可）**：
  1. **デプロイ**：Cloud Functions の提出サニタイザ変更（Phase 3）を反映するため `firebase deploy --only functions` が必要（未デプロイでも在宅保存経路は汎用サニタイズで保持されるが、生徒QRの集団参加取込はデプロイ後に有効）。Hosting は `npm run deploy`。
  2. **開発用教室 `v8OZ7zH8vONNHjjYVcR1` でE2E**：特別講習を作成→盤面に集団行が出る→科目/講師入力→出席者モーダルで出欠＋PDF→中3提出ページに集団参加→生徒/講師日程表に集団行・回数・給与が出る。
  3. **本番3教室の個別データ不変を確認**（読み取り専用での照合）。集団は optional フィールドの追加のみ・個別 `DeskLesson` 非干渉。
  4. 問題なければ全教室へ反映。
  - **移行**：既存の夏期講習提出は集団欄なし＝不参加・提出状況不変。現行夏期講習で参加者を設定するには open-questions Q2 の判断が必要。
