// 確認リストの「準備する」(2026-11-06 案 C 第 1 段・spec-developer-report §E-2-4)のコマ表側の配線ガード(source-scan)。
// 判断は純関数(resolveChecklistPrepStep / planChecklistPrep / applyChecklistPrepOps・checklistPrep.test.ts)で固定し、ここでは
// 巨大コンポーネントの effect が落とすと事故になる配線を字面で固定する:
// - 処理済み requestId は ref(一過性リクエストを 1 回だけ処理・Issue #46 同型)。成功でも失敗でも必ず結果を返す。
// - 検証用教室・テンプレ編集中の判断を純関数へ渡す(断る分岐を effect に持たない)。
// - 置くのは室長の操作と同じ commitWeeks を 1 回(既定引数のまま)。保存は自動でしない。
// - 保護者連絡(parentAbsenceRequest)とは別の state・別の ref。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

function effectBody(): string {
  const start = BOARD_TSX.indexOf('if (!shouldProcessChecklistPrepRequest(checklistPrepRequest, processedChecklistPrepRequestIdRef.current, {')
  expect(start, 'checklist prep effect not found').toBeGreaterThan(0)
  const end = BOARD_TSX.indexOf('}, [', start)
  expect(end).toBeGreaterThan(start)
  return BOARD_TSX.slice(start, end)
}

describe('確認リストの「準備する」(ScheduleBoardScreen.tsx)', () => {
  it('props で一過性リクエストと結果の返し口を受ける', () => {
    expect(BOARD_TSX).toContain('checklistPrepRequest?: ChecklistPrepRequest | null')
    expect(BOARD_TSX).toContain('onChecklistPrepRequestProcessed?: (result: ChecklistPrepRequestResult) => void')
  })

  it('処理済みの requestId は保護者連絡とは別の ref で持ち、結果は成功でも失敗でも finish で返す', () => {
    expect(BOARD_TSX).toContain('const processedChecklistPrepRequestIdRef = useRef<number | null>(null)')
    const body = effectBody()
    expect(body).toContain('processedChecklistPrepRequestIdRef.current = request.requestId')
    // 第119版(2026-11-07): 成功の結果は項目の文に差し込む facts(いつ・どの机・誰)も返す(無ければ載せない)。
    expect(body).toContain('const finish = (ok: boolean, message: string, facts?: ChecklistPrepFacts) => {')
    expect(body).toContain('onChecklistPrepRequestProcessed?.({ requestId: request.requestId, ok, message, ...(facts ? { facts } : {}) })')
    expect(body).not.toContain('processedParentAbsenceRequestIdRef')
    expect(body).not.toContain('parentAbsenceJumpedRequestIdRef')
    // 早期 return の直前は finish か、週を移る・テンプレ保存の段を積んで App へ知らせる(次のレンダーで続ける)・保存の段をその場で行う(必ず finish する)だけ。
    const lines = body.split(/\r?\n/u)
    lines.forEach((line, index) => {
      if (line.trim() !== 'return') return
      const previous = (lines[index - 1] ?? '').trim()
      // wait(盤面を当てたのと同じレンダー)は何もしないで次のレンダーを待つ(このガードの対象に入れるため if ブロックの中の単独の return にしてある)。
      // 第 4 段(§6): 段を続ける準備の wait(段を当てたのと同じレンダー)と、必ず finish か次の段を積んで知らせる runChecklistPrepSequence も同じ扱い。
      expect(previous, `return without finish: ${previous}`).toMatch(/finish\(|jumpToWeekByDate\(|if \(templatePhaseTiming === 'wait'\) \{|if \(sequenceTiming === 'wait'\) \{|checklistPrepTemplatePhaseRef\.current = |onChecklistPrepRequestProgress\?\.\(\{ requestId: request\.requestId, stage: 'board-applied'|runChecklistPrepTemplatePhase\(|runChecklistPrepSequence\(/u)
    })
  })

  it('断る判断(検証用教室でない・テンプレ編集中)と置き場は純関数 resolveChecklistPrepStep に渡す', () => {
    const body = effectBody()
    expect(body).toContain('resolveChecklistPrepStep({')
    expect(body).toContain('isVerificationClassroom: isDevelopmentClassroom({ id: classroomStorageKey ?? null })')
    expect(body).toContain('isTemplateMode,')
    // 置き場は開校ルール適用後の週(休校日を isOpenDay で見る)。保留の机は保留マップで避ける。
    expect(body).toContain('weeks: normalizedWeeks,')
    expect(body).toContain('templatePendingDesks: activeTemplatePendingDesks,')
  })

  it('押した教室(request.classroomId)とコマ表の教室が違う・教室データの読み込みが済んでいない間は処理しない(消費もせず待つ・要確認 1・INV-08)', () => {
    const body = effectBody()
    // 判断は純関数 shouldProcessChecklistPrepRequest(checklistPrep.test.ts で固定)。effect はコマ表の教室と読み込み済みの印を渡すだけ。
    expect(body).toContain('classroomId: classroomStorageKey ?? null,')
    expect(body).toContain('isEditingStateLoaded: isEditingStateLoadedForActingClassroom,')
    expect(body.indexOf('isEditingStateLoaded: isEditingStateLoadedForActingClassroom,')).toBeLessThan(body.indexOf('const finish = '))
    const depsStart = BOARD_TSX.indexOf('}, [', BOARD_TSX.indexOf(body))
    const deps = BOARD_TSX.slice(depsStart, BOARD_TSX.indexOf('])', depsStart))
    expect(deps).toContain('isEditingStateLoadedForActingClassroom')
    expect(deps).toContain('classroomStorageKey')
  })

  it('置くのは applyChecklistPrepOps → commitWeeks を 1 回(既定引数のまま)。置けなかった操作があれば commitWeeks を呼ばず失敗で返す。保存は呼ばない', () => {
    const body = effectBody()
    expect(body).toContain('const applied = applyChecklistPrepOps(weeks, step.plan.ops, buildTeacherAliasResolver(teachers))')
    const skippedIndex = body.indexOf('if (applied.skipped > 0) {')
    expect(skippedIndex).toBeGreaterThan(0)
    expect(body.slice(skippedIndex, skippedIndex + 200)).toContain('finish(false, CHECKLIST_PREP_DESK_SHORTAGE_MESSAGE)')
    expect(skippedIndex).toBeLessThan(body.indexOf('commitWeeks(applied.weeks'))
    expect(body).toContain('commitWeeks(applied.weeks, weekIndex, step.plan.cellId, step.plan.deskIndex)')
    // 準備と後片づけで 1 回ずつ(どちらも 1 リクエストで 1 回だけ)。第 4 段(§6)の段を続ける準備は盤面の段ごとに 1 回(1 レンダーに 1 段)。
    expect([...body.matchAll(/commitWeeks\(/gu)]).toHaveLength(3)
    expect(body).not.toContain('onSaveBoard')
    expect(body).not.toContain('setWeeks(')
  })

  it('第 2 段(tp-64): テンプレの土台と確認用の生徒を planner へ渡し、assignChecklistPrepTemplateStudents の結果を盤面を当てる前に作る', () => {
    const body = effectBody()
    // 土台は保存済みテンプレを buildTemplateDiffSavePlan の baseline と同じ在籍の絞り込みに通したもの。
    // M-4: 基準は 1 つの関数 resolveTemplateDiffBaseline(buildTemplateDiffSavePlan・テンプレ作成を開くときと同じ)。
    expect(body).toContain('resolveTemplateDiffBaseline({ template: classroomSettings.regularLessonTemplate, deskCount: classroomSettings.deskCount, teachers, students, todayKey })')
    expect(BOARD_TSX).not.toContain('filterTemplateParticipantsForReferenceDate({ template: classroomSettings.regularLessonTemplate')
    expect(BOARD_TSX).not.toContain('filterTemplateParticipantsForReferenceDate({ template: savedTemplate')
    const planStart = BOARD_TSX.indexOf('const buildTemplateDiffSavePlan = useCallback(')
    expect(BOARD_TSX.slice(planStart, planStart + 800)).toContain('const baselineTemplate = resolveTemplateDiffBaseline({ template: classroomSettings.regularLessonTemplate, deskCount: classroomSettings.deskCount, teachers, students, todayKey: toDateKey(new Date()) })')
    expect(body).toContain('template: prepTemplate,')
    expect(body).toContain('prepStudents: needsTemplate ? students.filter(isChecklistPrepStudent) : undefined,')
    // 差分反映が無い教室は第 1 段のまま(テンプレを渡さない)。
    expect(body).toContain('const needsTemplate = checklistPrepNeedsTemplate(request.itemId) && templateDiffApplyEnabled')
    // 登録は prepareChecklistPrepTemplateSave(内部で assignChecklistPrepTemplateStudents)。失敗なら盤面を当てずに finish。
    const prepareIndex = body.indexOf('const templateSave = step.plan.templateRegistrations.length > 0')
    expect(prepareIndex).toBeGreaterThan(0)
    expect(body.slice(prepareIndex, prepareIndex + 400)).toContain('prepareChecklistPrepTemplateSave({')
    expect(prepareIndex).toBeLessThan(body.indexOf('const applied = applyChecklistPrepOps('))
    expect(body).toContain('if (templateSave && !templateSave.ok) {')
  })

  it('第 2 段: commitWeeks の後は ref に保存の段を積んで finish せず、次のレンダーで handleSaveRegularLessonTemplateByDiff → finish(true, buildChecklistPrepDoneMessage(', () => {
    const body = effectBody()
    expect(BOARD_TSX).toContain('const checklistPrepTemplatePhaseRef = useRef<ChecklistPrepTemplatePhase | null>(null)')
    const commitIndex = body.indexOf('commitWeeks(applied.weeks, weekIndex, step.plan.cellId, step.plan.deskIndex)')
    const deferIndex = body.indexOf("checklistPrepTemplatePhaseRef.current = { kind: 'prep',")
    expect(deferIndex).toBeGreaterThan(commitIndex)
    // 積むときは盤面を当てる前の weeks の参照を持つ(I-1: 同じレンダーのクロージャ=準備前の weeks では保存しない)。
    expect(body.slice(deferIndex, deferIndex + 450)).toContain('queuedFromWeeks: weeks, queuedFromPendingDesks: templatePendingDesks')
    // 積んだら App へ「盤面を置いた」を知らせ(I-2: 保険タイマーを延ばし、以後の取りやめの文を切り替える)、finish せずに return。
    const deferLines = body.slice(deferIndex).split(/\r?\n/u)
    expect(deferLines[1]?.trim()).toBe("onChecklistPrepRequestProgress?.({ requestId: request.requestId, stage: 'board-applied', kind: 'prep' })")
    expect(deferLines[2]?.trim()).toBe('return')
    // 保存の段: 同じリクエストの段が積まれていれば、ほかより先にそれを行う。いつ走らせるかは純関数で決める(none / stale / wait / run)。
    const timingIndex = body.indexOf('const templatePhaseTiming = resolveChecklistPrepTemplatePhaseTiming({ phase: checklistPrepTemplatePhaseRef.current, requestId: request.requestId, weeks, pendingDesks: templatePendingDesks })')
    expect(timingIndex).toBeGreaterThan(0)
    const phaseIndex = body.indexOf("if (templatePhaseTiming === 'run') {")
    expect(phaseIndex).toBeGreaterThan(timingIndex)
    expect(phaseIndex).toBeLessThan(body.indexOf('resolveChecklistPrepStep({'))
    expect(body.slice(timingIndex, phaseIndex)).toContain("if (templatePhaseTiming === 'stale') checklistPrepTemplatePhaseRef.current = null")
    // wait(StrictMode の 2 回目など盤面を当てたのと同じレンダー)は何もせず待つ(finish も保存もしない)。
    expect(body.slice(timingIndex, phaseIndex)).toMatch(/if \(templatePhaseTiming === 'wait'\) \{\r?\n\s+return\r?\n\s+\}/u)
    const runner = body.slice(body.indexOf('const runChecklistPrepTemplatePhase = '), phaseIndex)
    // 見直し(テンプレ編集中・教室)→ 違えば失敗の文(盤面は置いたまま)。
    expect(runner).toContain('resolveChecklistPrepTemplatePhaseBlock({ phaseClassroomId: phase.classroomId, classroomId: classroomStorageKey ?? null, isTemplateMode })')
    expect(runner).toContain('finish(false, buildChecklistPrepTemplateFailedMessage({ kind: phase.kind, reason: blocked, boardMessage: phase.boardMessage }))')
    // 手で保存するときと同じ関数(確認画面の「保存を実行」と同じ・反映範囲は既定)。
    expect(runner).toContain('saved = handleSaveRegularLessonTemplateByDiff(phase.template)')
    // M-3: 手で保存するときと同じ INV-12 の重複ガード(findTemplateDuplicateStudents)をテンプレの盤面の形に当て、重複があれば保存しない。
    const duplicateIndex = runner.indexOf('const duplicates = findTemplateDuplicateStudents(buildTemplateBoardCells({ template: phase.template, teachers, students, deskCount: classroomSettings.deskCount }), (student) => resolveStockComparableStudentKey(student, managedStudentByAnyName, resolveBoardStudentDisplayName))')
    expect(duplicateIndex).toBeGreaterThan(0)
    expect(duplicateIndex).toBeLessThan(runner.indexOf('saved = handleSaveRegularLessonTemplateByDiff(phase.template)'))
    expect(runner).toContain('finish(false, buildChecklistPrepTemplateFailedMessage({ kind: phase.kind, reason: buildTemplateDuplicateStudentsMessage(duplicates, resolveBoardStudentDisplayName, (cell) => `${cell.dateLabel}曜 ${cell.slotLabel}`), boardMessage: phase.boardMessage }))')
    // 第119版: 成功の文は 2 行だけ(buildChecklistPrepDoneMessage)。facts はテンプレへの登録で決まった確認用の生徒の名前を保存後に足して返す。
    expect(runner).toContain('finish(true, buildChecklistPrepDoneMessage({ slot: phase.facts.slot, templateSaved: true }), completeChecklistPrepFacts(phase.facts, phase.assigned))')
    expect(body).not.toContain('buildChecklistPrepTemplateSavedMessage')
    // 盤面だけの準備(テンプレ保存なし)も短い文と facts。段を続ける準備も同じ(state.facts)。
    expect(body).toContain('finish(true, step.plan.doneMessage, step.plan.facts)')
    expect(body).not.toContain('finish(true, step.plan.message)')
    expect(body).toContain('finish(true, buildChecklistPrepSequenceMessage(nextSequenceState), nextSequenceState.facts)')
    expect(body).toContain('finish(true, buildChecklistPrepSequenceMessage(action.state), action.state.facts)')
    expect(runner).toContain('finish(true, buildChecklistPrepCleanupMessage({')
    // 保存前の盤面の PDF・確認画面は出さない。
    expect(body).not.toContain('exportTemplateOverwriteReport')
    expect(body).not.toContain('setTemplateSaveConfirm')
    // finish は積んだ段を捨てる(次のリクエストへ持ち越さない)。
    expect(body.slice(body.indexOf('const finish = '), body.indexOf('const finish = ') + 300)).toContain('checklistPrepTemplatePhaseRef.current = null')
  })

  it('後片づけ(kind: cleanup): 断る判断 → cleanupChecklistPrepBoard を含む計画 → commitWeeks → テンプレの確認用があれば同じ保存の段 → 消した件数の文。何も無ければ「片づけるものはありません」', () => {
    const body = effectBody()
    const cleanupIndex = body.indexOf("if (request.kind === 'cleanup') {")
    expect(cleanupIndex).toBeGreaterThan(0)
    expect(cleanupIndex).toBeLessThan(body.indexOf('resolveChecklistPrepStep({'))
    const cleanup = body.slice(cleanupIndex, body.indexOf('resolveChecklistPrepStep({'))
    expect(cleanup).toContain('resolveChecklistPrepCleanupBlock({ isVerificationClassroom: isDevelopmentClassroom({ id: classroomStorageKey ?? null }), isTemplateMode })')
    expect(cleanup).toContain('planChecklistPrepCleanup({ weeks, pendingDesks: templatePendingDesks,')
    expect(cleanup).toContain('finish(true, CHECKLIST_PREP_CLEANUP_NOTHING_MESSAGE)')
    const commit = cleanup.indexOf('commitWeeks(')
    expect(commit).toBeGreaterThan(cleanup.indexOf('if (cleanupPlan.nothing) {'))
    // 第 4 段(§6): 確認用の生徒の台帳の分を外した台帳(led)も渡すので引数が長くなった(窓を広げた・保留マップを渡すことは同じ)。
    expect(cleanup.slice(commit, commit + 500)).toContain('cleanupPlan.pendingDesks ?? templatePendingDesks')
    // 盤面を変えたら次のレンダーで保存(準備と同じ段)、変えていなければその場で保存。
    expect(cleanup).toContain('checklistPrepTemplatePhaseRef.current = cleanupPhase')
    expect(cleanup).toContain("onChecklistPrepRequestProgress?.({ requestId: request.requestId, stage: 'board-applied', kind: 'cleanup' })")
    expect(cleanup).toContain('runChecklistPrepTemplatePhase(cleanupPhase)')
    // 後片づけの段も盤面を当てる前の weeks を持つ(I-1 と同じ守り)。
    // 後片づけは保留の下の行だけを消すと weeks が同じ参照のままなので、保留マップの参照も持つ(修正ラウンド 2)。
    expect(cleanup).toContain('queuedFromWeeks: weeks, queuedFromPendingDesks: templatePendingDesks')
    // 主セッションの判断: 後片づけのテンプレ保存の反映開始日は max(今日, 保存済みの反映開始日)。
    expect(body).toContain('effectiveStartDate: resolveChecklistPrepCleanupEffectiveStartDate(todayKey, savedEffectiveStartDate)')
  })

  it('effect の deps に weeks と templatePendingDesks がある(テンプレ保存の段は commitWeeks が変えた weeks で次のレンダーに走る・M-8)', () => {
    const body = effectBody()
    const depsStart = BOARD_TSX.indexOf('}, [', BOARD_TSX.indexOf(body))
    const deps = BOARD_TSX.slice(depsStart + 4, BOARD_TSX.indexOf('])', depsStart)).split(',').map((token) => token.trim())
    expect(deps).toContain('weeks')
    expect(deps).toContain('templatePendingDesks')
    expect(deps).toContain('checklistPrepRequest')
  })

  it('props でコマ表 → App の途中経過(盤面を置いた)の知らせ口を受ける(I-2)', () => {
    expect(BOARD_TSX).toContain('onChecklistPrepRequestProgress?: (progress: ChecklistPrepRequestProgress) => void')
  })

  it('講師メニューの「保存」の出自は権威関数 resolveManualTeacherAssignmentSource(準備と同じ 1 本)を通す(式を画面に複製しない)', () => {
    expect(BOARD_TSX).toContain('const teacherAssignmentSource = resolveManualTeacherAssignmentSource(targetDesk)')
    expect(BOARD_TSX).not.toContain("!targetDesk.lesson && targetDesk.teacher.trim() && !targetDesk.manualTeacher")
  })
})
