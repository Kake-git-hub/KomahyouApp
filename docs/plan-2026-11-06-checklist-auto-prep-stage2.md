# 確認リストの「準備する」第 2 段（データ作りまで自動・後片づけ）— 実装計画（2026-11-06）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.
> 実装係は `dev-fix`（判断を伴う Task 1〜4 は Opus 最新・Task 5 は Sonnet 最新）、レビューは `regression-reviewer` 1 人（CLAUDE.md 決定表 #3・#4）。

**Goal:** 確認リスト tp-64 の「準備する」1 回で、確認用の生徒の名簿追加・盤面の準備・テンプレ登録・テンプレ保存まで行い、「後片づけ」で確認用だけを消す。

**Architecture:** 置き場とテンプレの登録内容は純関数（`checklistPrep.ts`＋新規 `checklistPrepTemplate.ts`）で決める。App が名簿へ確認用の生徒を足してから一過性リクエストを立て、コマ表の effect が「盤面の準備（commitWeeks）」→ 次のレンダーで「テンプレ保存（手で保存するときと同じ差分反映の関数）」の 2 段で処理する。後片づけも同じリクエストの別種別。

**Tech Stack:** React + TypeScript・vitest（jsdom／react-dom/server の静的描画・字面テスト）。

**Spec:** `docs/spec-developer-report.md` §E-2-4・§E-2-4-2（第 1 段の計画 `docs/plan-2026-11-06-checklist-auto-prep.md`）。

## Global Constraints

- 開発用教室とテスト教室だけ（`isActingDevelopmentClassroom`・コマ表は `isDevelopmentClassroom({ id: classroomStorageKey })` の二重ガード）。本番 3 校にはボタンも処理も出さない。
- 確認用の生徒の名前は「確認用 生徒A」「確認用 生徒B」…（`CHECKLIST_PREP_STUDENT_NAME_PREFIX = '確認用 生徒'`＋英大文字）。入塾日＝今日・退塾日なし・生年月日は小学生の固定値（`CHECKLIST_PREP_STUDENT_BIRTH_DATE`＝準備した年度に小 4 になる 4/2 生まれ）。名簿から消さない（使い回す）。
- 体験・メモの名前は第 1 段のまま（`確認用 体験n`・`確認用メモn`）。
- テンプレ保存は確認画面・保存前 PDF（`exportTemplateOverwriteReport`）を出さず、`handleSaveRegularLessonTemplateByDiff` と同じ処理を通す。「詳細」の文は `buildTemplateDiffConfirmDetail`＋`buildTemplateDiffStudentNoteLines` で組む（言い回しを二重に持たない）。
- サーバーへの保存は自動でしない（結果の文の最後に「保存」を押す一言）。
- 消すのは「確認用」の名前のもの・準備の印の付いた講師・確認用の生徒のテンプレ登録だけ（INV-02）。ほかの生徒の予定数・未消化は動かさない（INV-06）。同じコマに同じ生徒を 2 か所置かない（INV-12）。教室の切り替えで取りやめ（INV-08）。
- `src/App.tsx` は CRLF。書き換え後に `file src/App.tsx` で CRLF を確かめる。
- 公開リポジトリ: コード・テストに実在の生徒・講師名を書かない。

## Review Focus

1. 2 回目の「準備する」が同じ曜日・時限に当たる → 確認用 生徒A は使わず次の確認用の生徒（足りなければ名簿に足す）。Task 1 のテストで固定。
2. 準備で置いた講師を室長があとで手で替えた → その机は準備の印が消え、後片づけで消さない。Task 2 のテストで固定。
3. テンプレ保存の段で失敗（テンプレ編集中に切り替わった・教室を切り替えた）→ 盤面の準備は残り、結果の文に「盤面は置いたがテンプレは保存していない」と出る。Task 3 のテストで固定。
4. 準備の講師が保留の下の行（講師のぶつかり）に入ったまま後片づけ → 下の行の講師も消え、テンプレの講師の 1 行に戻る。Task 2 のテストで固定。
5. 後片づけを確認用が何も無い状態で押す → 何も変えずに「片づけるものはありません」。Task 2 のテストで固定。

---

### Task 1: 確認用の生徒とテンプレ登録の純関数

**Files:**
- Create: `src/components/schedule-board/checklistPrepTemplate.ts`
- Modify: `src/components/schedule-board/checklistPrep.ts`（`ChecklistPrepInput` に `template` と `prepStudents`、`ChecklistPrepPlanOk` に `templateRegistrations`、`planTp64` が テンプレの席の空きも見る・結果の文）
- Test: `src/components/schedule-board/checklistPrepTemplate.test.ts`・`checklistPrep.test.ts`

**Interfaces:**
- Produces:
  - `CHECKLIST_PREP_STUDENT_NAME_PREFIX = '確認用 生徒'`・`CHECKLIST_PREP_STUDENT_BIRTH_DATE(todayKey: string): string`
  - `isChecklistPrepStudent(student: Pick<StudentRow, 'name'>): boolean`
  - `ensureChecklistPrepStudents(students: readonly StudentRow[], count: number, params: { todayKey: string; createId: (taken: ReadonlySet<string>) => string }): { students: StudentRow[]; added: StudentRow[] }`（在籍の確認用の生徒が `count` 人未満なら A, B, … の空いている文字で足す。足りていれば同じ配列を返し `added` は空）
  - `type ChecklistPrepTemplateRegistration = { dayOfWeek: number; slotNumber: number; deskIndex: number; studentIndex: 0 | 1; subject: SubjectLabel; label: string }`（label は結果の文の「(1)」「(2)」）
  - `assignChecklistPrepTemplateStudents(template: RegularLessonTemplate, registrations: readonly ChecklistPrepTemplateRegistration[], prepStudents: readonly StudentRow[]): { ok: true; template: RegularLessonTemplate; assigned: Array<ChecklistPrepTemplateRegistration & { studentId: string; studentName: string }> } | { ok: false; reason: string }`（席が埋まっていれば失敗。その曜日・時限に既に居る確認用の生徒は使わない。1 回の準備で同じ生徒を 2 つ使わない）
  - `removeChecklistPrepTemplateStudents(template: RegularLessonTemplate, prepStudentIds: ReadonlySet<string>): { template: RegularLessonTemplate; removed: number }`
  - `checklistPrep.ts`: `ChecklistPrepInput.template?: RegularLessonTemplate | null`、`ChecklistPrepPlanOk.templateRegistrations: ChecklistPrepTemplateRegistration[]`（v2-1 は空配列）、`CHECKLIST_PREP_TEMPLATE_ITEM_IDS = ['tp-64'] as const`・`checklistPrepNeedsTemplate(itemId: string): boolean`・`CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT: Record<'tp-64', number> = { 'tp-64': 2 }`

- [ ] **Step 1: 失敗するテストを書く**（`checklistPrepTemplate.test.ts`）
  - `ensureChecklistPrepStudents`: 空の名簿で count 2 → 「確認用 生徒A」「確認用 生徒B」が足され、入塾日＝todayKey・withdrawDate ''・birthDate＝`CHECKLIST_PREP_STUDENT_BIRTH_DATE(todayKey)`。A が居れば B だけ足す。2 人居れば `added` は空で入力と同じ参照。退塾済みの「確認用 生徒A」は数えず、名前の重複を避けて C を足す。
  - `assignChecklistPrepTemplateStudents`: 空いている席に A・B が入る。同じ曜日・時限に A が既に居れば B・C を使う（足りなければ `ok:false`・理由に「確認用の生徒が足りません」）。席が埋まっていれば `ok:false`（理由に曜日・時限・机）。入力の template は書き換えない。
  - `removeChecklistPrepTemplateStudents`: 確認用の生徒の席だけ null・ほかの生徒・講師はそのまま・removed は件数。
- [ ] **Step 2:** `npx vitest run src/components/schedule-board/checklistPrepTemplate.test.ts` → モジュールが無くて FAIL
- [ ] **Step 3: 実装**（`checklistPrepTemplate.ts`。テンプレのセルが無い曜日・時限・机は作る＝`RegularLessonTemplateDesk` の teacherId は ''）
- [ ] **Step 4: `checklistPrep.test.ts` に tp-64 のテストを足す**: 入力に template を渡すと、テンプレのその曜日・時限・机の席 2 が埋まっている机は (1)・(2) に選ばない。plan の `templateRegistrations` は (1)・(2) の席（label「(1)」「(2)」・科目は体験と同じ）。結果の文から「残る手作業（必須）」が消え、「テンプレの (1)・(2) の席に確認用の生徒を登録して保存します」の行がある。v2-1 の `templateRegistrations` は空。
- [ ] **Step 5:** 落ちるのを見てから `planTp64` を直し、`npx vitest run src/components/schedule-board/checklistPrep` で PASS
- [ ] **Step 6: Commit** `feat: 確認リストの準備 第 2 段の純関数(確認用の生徒・テンプレ登録)`

### Task 2: 準備の印と後片づけの純関数

**Files:**
- Modify: `src/components/schedule-board/types.ts`（`DeskCell.checklistPrepTeacher?: true`）
- Modify: `src/components/schedule-board/deskTeacherAssignment.ts`（`setManualTeacherAssignment` は印を消す）
- Modify: `src/components/schedule-board/checklistPrep.ts`（`applyChecklistPrepOps` の manual-teacher で印を付ける）
- Modify: `src/components/schedule-board/templatePendingDesks.ts`（`TemplatePendingLowerTeacher` に `checklistPrepTeacher` を含める）と、下の行の講師を作る箇所（`lower.teacher` を組み立てる所を grep し、印を写す）
- Modify: `src/components/schedule-board/checklistPrepTemplate.ts`（後片づけ）
- Test: `checklistPrepTemplate.test.ts`・`checklistPrep.test.ts`・`deskTeacherAssignment` のテスト（既存があればそこへ）

**Interfaces:**
- Consumes: Task 1 の `isChecklistPrepStudent`。第 1 段の `CHECKLIST_PREP_TRIAL_NAME_PREFIX`・`CHECKLIST_PREP_MEMO_PREFIX`。
- Produces: `cleanupChecklistPrepBoard(weeks: SlotCell[][], pendingDesks: TemplatePendingDeskMap | null): { weeks: SlotCell[][]; pendingDesks: TemplatePendingDeskMap | null; removed: { trials: number; memos: number; teachers: number } }`

- [ ] **Step 1: 失敗するテストを書く**
  - `applyChecklistPrepOps` の manual-teacher で机に `checklistPrepTeacher: true`。体験・メモの机には付かない。
  - `setManualTeacherAssignment` を印の付いた机に呼ぶと印が消える。
  - `cleanupChecklistPrepBoard`: 上の行と保留の下の行の「確認用 体験」（`manualAdded` の体験だけ・名前が「確認用 体験」で始まる）を消す。「確認用メモ」で始まるメモを消す。印の付いた机の講師は teacher '' ・手置きの項目を外し印も消す。下の行の講師に印があれば下の行の講師を消す（講師のぶつかりが解けてテンプレの講師の 1 行）。下の行が空になった保留は消す。名前が「確認用」で始まらない体験・印の無い手置き講師は残す。何も無ければ removed がすべて 0 で、weeks・pendingDesks は入力と同じ参照。入力は書き換えない。
- [ ] **Step 2:** 対象テストを流して FAIL を見る
- [ ] **Step 3: 実装**。下の行の講師を組み立てる箇所（`lower.teacher` に `teacher`/`manualTeacher` などを写している所）で `checklistPrepTeacher` も写す。保存・読み込みは机を丸ごと持つので配線不要（`teacherRest` と同じ）だが、`templatePendingDesks.wiring.test.ts` の作法で往復を 1 件固定する。
- [ ] **Step 4:** `npx vitest run src/components/schedule-board/` で PASS
- [ ] **Step 5: Commit** `feat: 準備で置いた講師の印と後片づけの純関数`

### Task 3: コマ表の 2 段処理（盤面の準備 → テンプレ保存）と後片づけ

**Files:**
- Modify: `src/components/schedule-board/checklistPrep.ts`（`ChecklistPrepRequest` に `kind: 'prep' | 'cleanup'`・既定 'prep'）
- Modify: `src/components/schedule-board/ScheduleBoardScreen.tsx`（15646 行付近の effect・`handleSaveRegularLessonTemplateByDiff` 8843 行付近）
- Test: `src/components/schedule-board/checklistPrepRequest.wiring.test.ts`（字面）と新しい純関数のテスト

**Interfaces:**
- Consumes: Task 1・2 の関数。
- Produces:
  - `handleSaveRegularLessonTemplateByDiff` が保存した plan の `{ summary, studentNotes, scopeNote }` を返す（呼び出し側の今の動きは不変）。
  - 純関数 `buildChecklistPrepTemplateSavedMessage(params: { boardMessage: string; assigned: …[]; effectiveStartDate: string; summary: TemplateDiffApplySummary; studentNotes?: TemplateDiffStudentNote[]; scopeNote?: …; todayKey: string }): string`（`checklistPrepTemplate.ts`。盤面の行 → 「テンプレの (1) 火 3限 机 5 の生徒 2 に 確認用 生徒A …を登録して保存しました」→ 「詳細:」＋`buildTemplateDiffConfirmDetail`＋生徒ごとの理由 → 保存の一言）
  - 文言定数 `CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER`（「盤面とテンプレはまだサーバーに保存していません。「保存」を押してから、項目の「やること」を行ってください。」）・`CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX`（「盤面には置きましたが、テンプレは保存していません: 」）・`CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE`（「片づけるものはありません。」）

- [ ] **Step 1: 失敗するテストを書く**
  - `buildChecklistPrepTemplateSavedMessage` の文（登録した席・確認用の生徒の名前・「詳細:」の行・最後が `CHECKLIST_PREP_TEMPLATE_SAVE_REMINDER`）。
  - 字面テスト（`checklistPrepRequest.wiring.test.ts` に追加）: effect は tp-64 のとき `assignChecklistPrepTemplateStudents` を呼び、`commitWeeks` の後は ref（`checklistPrepTemplatePhaseRef`）に保存の段を積んで `finish` せず、次のレンダーで `handleSaveRegularLessonTemplateByDiff(` を呼んでから `finish(true, buildChecklistPrepTemplateSavedMessage(`。保存の段は `isTemplateMode`・教室 ID を見直し、違えば `CHECKLIST_PREP_TEMPLATE_FAILED_PREFIX` で finish。`exportTemplateOverwriteReport` を呼ばない。cleanup は `cleanupChecklistPrepBoard` → `commitWeeks` → 確認用の登録があれば同じ保存の段 → 消した件数の文。何も無ければ `CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE`。
- [ ] **Step 2:** FAIL を見る
- [ ] **Step 3: 実装**。テンプレの土台は `classroomSettings.regularLessonTemplate` を `filterTemplateParticipantsForReferenceDate`（`buildTemplateDiffSavePlan` の baseline と同じ）に通したもの、反映開始日は第 1 段と同じ `effectiveStartDate`。保存の段は weeks が変わった次のレンダーで走るので `buildTemplateDiffSavePlan` のクロージャは準備後の盤面を見る。生徒は props の `students`（App が先に足している）から `isChecklistPrepStudent` で拾う。足りなければ `ok:false`（App の足し忘れ）。
- [ ] **Step 4:** `npx vitest run src/components/schedule-board/` で PASS
- [ ] **Step 5: Commit** `feat: 準備する(tp-64)でテンプレ登録と保存まで行う・後片づけ`

### Task 4: App（名簿へ足す・後片づけの入口）とパネルの「後片づけ」ボタン

**Files:**
- Modify: `src/App.tsx`（1901 行付近 `handleChecklistPrepare`・CRLF 維持）
- Modify: `src/components/developer-report/VerificationChecklistPanel.tsx`（`onCleanup?: () => Promise<ChecklistPrepResult>`・ボタン `data-testid="verification-checklist-cleanup"`・結果文 `verification-checklist-cleanup-result`）
- Test: `VerificationChecklistPanel.prep.test.ts`・`VerificationChecklistPanel.wiring.test.ts`（App の配線の字面）

**Interfaces:**
- Consumes: Task 1 の `ensureChecklistPrepStudents`・`checklistPrepNeedsTemplate`・`CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT`、Task 3 の `ChecklistPrepRequest.kind`。
- Produces: App の `handleChecklistCleanup(): Promise<ChecklistPrepResult>`（`handleChecklistPrepare` と同じ待ち合わせ・同じ保険タイマー・`kind: 'cleanup'`）。

- [ ] **Step 1: 失敗するテストを書く**
  - パネル: `onCleanup` があれば「後片づけ」ボタンが出る（無ければ出ない＝本番 3 校）。押すと `onCleanup`、実行中は「後片づけ中…」で無効、結果文が出る。準備中は後片づけも押せない（逆も）。
  - App の字面: `handleChecklistPrepare` は `checklistPrepNeedsTemplate(itemId)` のとき `ensureChecklistPrepStudents(` の結果で `setStudents(` してから `setChecklistPrepRequest(`。id は名簿の追加と同じ作り方（基本データ画面の生徒追加が使う関数を grep して使う）。`handleChecklistCleanup` は `kind: 'cleanup'`。パネルへ `onCleanup={handleChecklistCleanup}`。
- [ ] **Step 2:** FAIL を見る
- [ ] **Step 3: 実装**（`file src/App.tsx` で CRLF を確認）
- [ ] **Step 4:** `npx vitest run src/components/developer-report/ src/components/schedule-board/checklistPrep` で PASS
- [ ] **Step 5: Commit** `feat: 確認リストの後片づけボタンと確認用の生徒の名簿追加`

### Task 5: 確認リスト・台帳・CHANGELOG・仕様の追随（Sonnet）

**Files:** `src/utils/verificationChecklist.ts`・`.test.ts`・`src/utils/developmentStatusLedger.ts`・`CHANGELOG.md`・`docs/spec-developer-report.md`・`docs/plan-2026-11-06-checklist-auto-prep.md`

- [ ] **Step 1:** `VERIFICATION_CHECKLIST_VERSION` を次の版（`package.json` の patch +1）へ。tp-64 の prep を「『準備する』を押す（確認用の生徒の名簿追加・体験と手置き講師・テンプレの (1)・(2) の席への登録と保存まで自動）。結果の文を読んでから「保存」を押す」に（`/^「準備する」を押す/` を保つ）。ap-3（後片づけ・テスト教室にも出す・分類「確認リスト」）を足す: 準備のあと「後片づけ」を押す → 確認用の体験・メモ・準備の講師・テンプレの確認用の生徒の登録が消え、確認用の生徒は名簿に残り、ほかの生徒の未消化は変わらない。OK の ap-2 は結果待ちなので残す。テストを追随。
- [ ] **Step 2:** 台帳 `checklist-auto-prep` の summary・nextAction（オーナーが tp-64 と ap-3 で試す）、CHANGELOG の `## 未リリース` に feat 1 行（INV-02・06・08・12）、仕様 §E-2-4-2 に実装の関数名を 1 行。
- [ ] **Step 3:** `npx vitest run src/utils/` で PASS・Commit

### 仕上げ（主セッション）

- `regression-reviewer` で全体レビュー → 指摘の修正 → `npx vitest run`・`npm run lint`・`npm run build` → CHANGELOG を版でラベル → main マージ → ライブの version.json と CSS/JS の確認。
