// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5「台本(第 1 段)」)の台本。
// 教室ごとに 起動 → (c) 保存→読み込み直し → (b) 生徒の移動 → (a) テンプレ保存 の順で、室長と同じ画面操作をし、
// 操作のたびに「前の状態を読む → 操作 → 後の状態を読む → 点検 → 既知を外す → 報告へ足す」。
// ★点検は tools/ui-patrol/checks.ts、盤面の事実は boardFacts.ts(どちらも esbuild で束ねた app から呼ぶ)。ここで規則を書き直さない。
// ★報告に出すのは仮名・ID・件数・経路だけ(所見の message は checks.ts が作る。ここで足す注も ID と件数だけ)。
// ★前半(候補選び・変わってよい範囲)は純関数。runClassroomPatrol だけがブラウザを動かす。
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { addStep, createClassroomReport } from './report.mjs'
import {
  PatrolAbortError, clickRedo, clickSave, clickUndo, confirmTemplateSave, dragStudent, gotoWeekOf, openTemplateEditor, readClassroom,
  readSaveState, readStatusText, reloadApp, requestTemplateSave, seedAndOpen, setTemplateStartDate, takeScreenshot,
} from './driver.mjs'

export const MOVE_KINDS = ['regular-same-slot', 'regular-other-day', 'makeup-same-slot', 'makeup-other-day', 'special-same-slot', 'special-other-day']
const KIND_LABELS = {
  'regular-same-slot': '通常・同じコマの別の机', 'regular-other-day': '通常・別の日',
  'makeup-same-slot': '振替・同じコマの別の机', 'makeup-other-day': '振替・別の日',
  'special-same-slot': '講習・同じコマの別の机', 'special-other-day': '講習・別の日',
}

/**
 * 生徒の移動で、元と先の机のほかに変わってよい部分(boardFacts.ts の BOARD_FACT_SECTIONS の名前)。根拠(ScheduleBoardScreen.tsx):
 * - boardState.suppressedRegularLessonOccurrences: computeStudentMove が通常授業を動かすと移動元の日の抑止キーを積む
 *   (resolveSuppressedRegularLessonOccurrenceKeys → nextSuppressedRegularLessonOccurrences → commitWeeks)。
 * - boardState.manualMakeupAdjustments・boardState.fallbackMakeupStudents: executeMoveStudent が、移動元の「移)」の印で上書きされた前の生徒の
 *   出欠記録を台帳へ確定する(displacedStatusEntries → materializeDisplacedStatusEntryIntoLedgers → commitWeeks・Issue #57 / INV-06)。
 * 入れていないもの: 在庫(manualLectureStock*)・希望回数(scheduleCountAdjustments)・教室設定・保留の机(templatePendingDesks)。
 * 生徒の移動は commitWeeks へ今の値をそのまま渡す(元に戻すの履歴 createHistoryEntry もこれらを戻す)。
 * 出席不可コマへの移動の確認(confirmReopenForPlacements → App の applyReopenedSlotConversions)は specialSessions を変えるが、
 * 元に戻すで戻らない別の帳簿なので範囲に入れない(起きたらダイアログの文つきで「変」に出し、人が見る)。
 */
export const MOVE_ALLOWED_SECTIONS = [
  'boardState.suppressedRegularLessonOccurrences',
  'boardState.manualMakeupAdjustments',
  'boardState.fallbackMakeupStudents',
]

/**
 * テンプレ保存(差分反映・handleSaveRegularLessonTemplateByDiff)で、反映日以降の机のほかに変わってよい部分。根拠:
 * - classroomSettings.template: buildTemplateDiffSavePlan の nextClassroomSettings(regularLessonTemplate・regularLessonTemplateHistory・
 *   preTemplateRegularLessons・templateFreezeBeforeDate だけを差し替え、ほかの教室設定は ...classroomSettings のまま)→ onUpdateClassroomSettings。
 * - regularLessons: onReplaceRegularLessons(normalizedTemplateRegularLessons)。
 * - boardState.suppressedRegularLessonOccurrences: plan.diff.addedSuppressed… / removedSuppressed…(Q21-11・Q35・Q36)。
 * - boardState.scheduleCountAdjustments: plan.diff.wholeDayTransferCountAdjustments の −1(Q35-8)。
 * - boardState.manualMakeupAdjustments: plan.diff.manualMakeupOriginAdditions / Removals(Q40-2-4・INV-06 の唯一の例外)。
 * 入れていないもの: boardState.templatePendingDesks.unmatched(盤面の週に無い机の保留)。差分反映は盤面の週の机だけを突き合わせて
 * 保留を足し引きする(templateDiffApply.ts の computeTemplateDiffApply が nextPendingDesks を { ...params.pendingDesks } から作る)ので、
 * 週に無い机の保留は変わらないはず。在庫(manualLectureStock*・fallback*)も触らない(Q7〜Q9 改定)。
 */
export const TEMPLATE_SAVE_ALLOWED_SECTIONS = [
  'classroomSettings.template',
  'regularLessons',
  'boardState.suppressedRegularLessonOccurrences',
  'boardState.scheduleCountAdjustments',
  'boardState.manualMakeupAdjustments',
]

/** 種つきの乱数(mulberry32)。0 以上 1 未満・同じ種なら同じ列。 */
export function createSeededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(list, random) {
  const result = [...list]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1))
    ;[result[index], result[pick]] = [result[pick], result[index]]
  }
  return result
}

/** 保留(2 行)の机か(下段に何かある)。保留の机には動かせない・保留の机の上段を掴むと保留の解消になる(Q26-5)ので元にも先にもしない。 */
function isPendingDesk(fact) {
  return fact.pendingStudents.length > 0 || fact.pendingTeacher !== '' || fact.pendingStatuses.length > 0 || fact.pendingMemos.length > 0
}

const comparePosition = (left, right) => left.dateKey.localeCompare(right.dateKey) || left.slotNumber - right.slotNumber || left.cellId.localeCompare(right.cellId) || left.deskIndex - right.deskIndex
const seatKey = (desk, seat) => `${desk.key}/${seat}`

/**
 * 生徒の移動の候補。元＝その週で今日以降のコマの生徒(出欠記録のある机・保留の机・講師の休みの机は除く)。
 * 先＝空いた席(生徒なし)で、本物の講師がいて、メモも出欠記録も無く、保留でも講師の休みでもない机。
 * ★出欠記録・メモは机ごとにしか持っていない(DeskFact の statuses / memos は席を区別しない)ので、席ではなく机ごとに除く(安全側)。
 * same-slot＝同じコマの別の机、other-day＝同じ週の別の日のコマで、動かす生徒がそのコマ(上段・保留の下段)にまだいないもの。
 * 種類ごとに 1 つずつ、種つきの乱数で選ぶ。count が種類の数より多ければ 2 周目に入る。同じ席を 2 回使わない。
 */
export function pickMoveCandidates(facts, { weekDateKeys, todayKey, count, seed }) {
  const week = new Set(weekDateKeys)
  const desks = [...facts.desks.values()].filter((desk) => week.has(desk.dateKey) && desk.dateKey >= todayKey).sort(comparePosition)
  const keysByCell = new Map()
  for (const desk of desks) {
    const keys = keysByCell.get(desk.cellId) ?? new Set()
    for (const student of [...desk.students, ...desk.pendingStudents]) if (student) keys.add(student.key)
    keysByCell.set(desk.cellId, keys)
  }
  const sources = desks.filter((desk) => !desk.teacherRest && !isPendingDesk(desk) && desk.statuses.length === 0)
  const targets = desks.filter((desk) => desk.teacher !== '' && !desk.teacherRest && !isPendingDesk(desk) && desk.statuses.length === 0 && desk.memos.length === 0)
  const sourcesByKind = new Map(MOVE_KINDS.map((kind) => [kind, []]))
  for (const desk of sources) {
    desk.students.forEach((student, seat) => {
      if (!student || !['regular', 'makeup', 'special'].includes(student.lessonType)) return
      for (const scope of ['same-slot', 'other-day']) sourcesByKind.get(`${student.lessonType}-${scope}`).push({ desk, seat, student })
    })
  }
  const random = createSeededRandom(seed)
  const used = new Set()
  const picked = []
  const wanted = Math.max(0, Number(count) || 0)
  for (;;) {
    let addedInRound = false
    for (const kind of MOVE_KINDS) {
      if (picked.length >= wanted) return picked
      const sameSlot = kind.endsWith('same-slot')
      for (const source of shuffled(sourcesByKind.get(kind), random)) {
        if (used.has(seatKey(source.desk, source.seat))) continue
        const options = []
        for (const desk of targets) {
          if (sameSlot ? (desk.cellId !== source.desk.cellId || desk.deskIndex === source.desk.deskIndex) : (desk.dateKey === source.desk.dateKey || keysByCell.get(desk.cellId)?.has(source.student.key))) continue
          desk.students.forEach((student, seat) => {
            if (student === null && !used.has(seatKey(desk, seat))) options.push({ desk, seat })
          })
        }
        if (options.length === 0) continue
        const target = options[Math.floor(random() * options.length)]
        used.add(seatKey(source.desk, source.seat))
        used.add(seatKey(target.desk, target.seat))
        picked.push({
          kind,
          from: { cellId: source.desk.cellId, deskIndex: source.desk.deskIndex, seat: source.seat },
          to: { cellId: target.desk.cellId, deskIndex: target.desk.deskIndex, seat: target.seat },
          studentId: source.student.key,
        })
        addedInRound = true
        break
      }
    }
    if (!addedInRound || picked.length >= wanted) return picked
  }
}

/** 移動で変わってよい範囲: 元と先の机・MOVE_ALLOWED_SECTIONS。 */
export function buildMoveAllowedChange(candidate) {
  return {
    deskKeys: new Set([`${candidate.from.cellId}#${candidate.from.deskIndex}`, `${candidate.to.cellId}#${candidate.to.deskIndex}`]),
    sections: new Set(MOVE_ALLOWED_SECTIONS),
  }
}

/** dateKey(YYYY-MM-DD)から 7 日分。 */
export function weekDateKeysFrom(mondayKey) {
  const start = Date.parse(`${mondayKey}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10))
}

function describeSeat(seat) {
  return `${seat.cellId} 机${seat.deskIndex + 1} 席${seat.seat + 1}`
}

function describeCandidate(candidate) {
  return `${KIND_LABELS[candidate.kind] ?? candidate.kind}: ${describeSeat(candidate.from)} → ${describeSeat(candidate.to)}(生徒 ${candidate.studentId.startsWith('name:') ? 'ID なし' : candidate.studentId})`
}

/**
 * stop の所見が指すコマ(日付×時限)の、操作の前後の机の事実をファイルに残す(人が画面写真と突き合わせて見立てるため)。
 * 中身は伏せ字のあとの仮名と ID だけ(出力先はスクラッチ領域)。コマは 40 まで。
 */
function writeStopDiff(file, stops, before, after) {
  const cells = [...new Set(stops.filter((finding) => finding.dateKey && finding.slotNumber !== undefined).map((finding) => `${finding.dateKey}_${finding.slotNumber}`))].slice(0, 40)
  if (cells.length === 0) return null
  const pick = (facts, cellId) => [...facts.desks.values()].filter((desk) => desk.cellId === cellId).map((desk) => Object.fromEntries(Object.entries(desk).filter(([key]) => key !== 'signature')))
  try {
    writeFileSync(file, JSON.stringify({ findings: stops, cells: cells.map((cellId) => ({ cellId, before: pick(before, cellId), after: pick(after, cellId) })) }, null, 1))
    return file
  } catch {
    return null
  }
}

/** 教室 1 つぶんの台本を流し、教室の報告(report.mjs の形)を返す。 */
export async function runClassroomPatrol({ session, app, classroom, seedSnapshot, options, outDir, known, today }) {
  const { classroomId } = classroom
  let report = createClassroomReport(classroom)
  const scenarios = options.scenarios ?? ['boot', 'c', 'b', 'a']
  const nextMonday = app.resolveNextMondayDateKey(today)
  let shotCount = 0
  let lastScenario = 'boot'
  const shoot = async (scenario) => {
    shotCount += 1
    return takeScreenshot(session, path.join(outDir, `${classroomId}-${scenario}-${shotCount}.png`))
  }
  const toState = (read) => ({ payload: read.payload, facts: app.collectBoardFacts(read.payload), auditResult: null })
  const auditOf = (state) => {
    if (!state.auditResult) state.auditResult = app.auditClassroomSnapshot({ classroomId, payload: state.payload, today, known: [] })
    return state.auditResult
  }
  const read = async () => toState(await readClassroom(session))
  const sameState = (before, after, code) => app.checkSameState(before.facts, after.facts, code)
  const timings = { audit: 0, read: 0 }
  const timedAudit = (state) => { const started = Date.now(); const result = auditOf(state); timings.audit += Date.now() - started; return result }
  const timedRead = async () => { const started = Date.now(); const state = await read(); timings.read += Date.now() - started; return state }

  /** 手順を報告へ足す(既知を外し、stop があれば画面写真)。 */
  const finish = async (scenario, step) => {
    const filtered = app.applyKnownIssues(step.findings, known, { classroomId, step: scenario })
    report = { ...report, knownCount: report.knownCount + filtered.knownCount }
    const notes = [...step.notes]
    const stops = filtered.findings.filter((finding) => finding.level === 'stop')
    if (stops.length > 0) {
      const file = await shoot(scenario)
      if (file) notes.push(`画面写真: ${path.basename(file)}`)
      if (step.diff) {
        const diffFile = writeStopDiff(path.join(outDir, `${classroomId}-${scenario}-${shotCount}.diff.json`), stops, step.diff.before, step.diff.after)
        if (diffFile) notes.push(`差分: ${path.basename(diffFile)}`)
      }
    }
    report = addStep(report, { name: scenario, title: step.title, durationMs: Date.now() - step.started, operations: step.operations, findings: filtered.findings, notes })
  }
  const newStep = (title) => ({ title, started: Date.now(), operations: 0, findings: [], notes: [] })

  let current = null
  try {
    // ── 起動: 種データ(伏せ字の payload)を「前」、開いた直後を「後」とする。手入力は変わってはいけない。
    {
      lastScenario = 'boot'
      const step = newStep('起動(種データを入れて開く)')
      const seededClassroom = seedSnapshot.classrooms.find((room) => room.id === classroomId)
      if (!seededClassroom) throw new PatrolAbortError('種データにこの教室がありません。')
      const before = toState({ payload: seededClassroom.data })
      await seedAndOpen(session, seedSnapshot)
      step.operations += 1
      current = await timedRead()
      step.diff = { before: before.facts, after: current.facts }
      step.findings.push(
        ...app.checkManualStudentsKeepTeacher(before.facts, current.facts),
        ...app.checkTeacherlessStudentsNotAdded(before.facts, current.facts),
        ...app.checkManualInputsNotLost(before.facts, current.facts),
        ...app.checkAuditNotWorse(timedAudit(before), timedAudit(current)),
        ...app.summarizeChanges(before.facts, current.facts),
      )
      step.notes.push(`開いた直後のステータス: ${await readStatusText(session)}`, `保存ボタン: ${await readSaveState(session)}`)
      await finish('boot', step)
    }

    // ── (c) 保存→読み込み直し: 保存でも読み込み直しでも盤面は変わらない。
    if (scenarios.includes('c')) {
      lastScenario = 'c'
      const step = newStep('保存→読み込み直し')
      const pressed = await clickSave(session)
      if (pressed) step.operations += 1
      else step.notes.push('保存ボタンは既に clean で押せませんでした(保存する変更が無い)。')
      const saved = await timedRead()
      step.findings.push(...sameState(current, saved, 'save-changed'))
      await reloadApp(session)
      step.operations += 1
      current = await timedRead()
      step.findings.push(...sameState(saved, current, 'reload-changed'))
      step.notes.push(`読み込み直しのあとの保存ボタン: ${await readSaveState(session)}`)
      await finish('c', step)
    }

    // ── (b) 生徒の移動: 長押しドラッグ → 元に戻す → やり直し → 元に戻す。変わってよいのは元と先の机だけ。
    if (scenarios.includes('b')) {
      lastScenario = 'b'
      const step = newStep(`生徒の移動の準備(${nextMonday} の週)`)
      await gotoWeekOf(session, nextMonday)
      step.operations += 1
      const base = await timedRead()
      const candidates = pickMoveCandidates(base.facts, { weekDateKeys: weekDateKeysFrom(nextMonday), todayKey: today, count: options.moves, seed: options.seed })
      const kinds = new Set(candidates.map((candidate) => candidate.kind))
      step.notes.push(`候補 ${candidates.length} か所(種類 ${kinds.size}/${MOVE_KINDS.length}: ${[...kinds].map((kind) => KIND_LABELS[kind]).join('・') || 'なし'})`)
      if (candidates.length === 0) step.notes.push('動かせる生徒と空いた席の組が見つかりませんでした。')
      await finish('b', step)
      const baseAudit = candidates.length > 0 ? timedAudit(base) : null
      for (const [index, candidate] of candidates.entries()) {
        const moveStep = newStep(`生徒の移動 ${index + 1}(${KIND_LABELS[candidate.kind]})`)
        moveStep.notes.push(describeCandidate(candidate))
        const dialogsBefore = session.dialogs.length
        const status = await dragStudent(session, candidate.from, candidate.to)
        moveStep.operations += 1
        const moved = await timedRead()
        moveStep.notes.push(`ステータス: ${status}`)
        for (const dialog of session.dialogs.slice(dialogsBefore)) moveStep.notes.push(`ダイアログ: ${dialog}`)
        const diff = app.diffBoardFacts(base.facts, moved.facts)
        if (diff.desks.length === 0 && diff.sections.length === 0) {
          // アプリが断った移動(出席済み・メモ・同じコマに同じ生徒・休校日など)。元に戻すは押さない(履歴が積まれていない)。
          moveStep.findings.push({ level: 'info', code: 'move-blocked', message: `アプリが移動を断った: ${describeSeat(candidate.from)} → ${describeSeat(candidate.to)}(${status})` })
          await finish('b', moveStep)
          continue
        }
        const allowed = buildMoveAllowedChange(candidate)
        const exclude = { excludeDeskKeys: allowed.deskKeys }
        moveStep.diff = { before: base.facts, after: moved.facts }
        moveStep.findings.push(
          ...app.checkOutsideAllowedRange(base.facts, moved.facts, allowed),
          ...app.checkManualStudentsKeepTeacher(base.facts, moved.facts, exclude),
          ...app.checkTeacherlessStudentsNotAdded(base.facts, moved.facts, exclude),
          ...app.checkManualInputsNotLost(base.facts, moved.facts, exclude),
          ...app.checkAuditNotWorse(baseAudit, timedAudit(moved)),
        )
        const landed = moved.facts.desks.get(`${candidate.to.cellId}#${candidate.to.deskIndex}`)?.students[candidate.to.seat]
        if (!landed || landed.key !== candidate.studentId) {
          moveStep.findings.push({ level: 'stop', code: 'move-not-applied', message: `動かした生徒が先の席にいない: ${describeCandidate(candidate)}`, studentId: candidate.studentId })
        }
        if (!(await clickUndo(session))) moveStep.notes.push('元に戻すが押せませんでした(履歴が無い)。')
        moveStep.operations += 1
        moveStep.findings.push(...sameState(base, await timedRead(), 'undo-not-restored'))
        if (!(await clickRedo(session))) moveStep.notes.push('やり直しが押せませんでした。')
        moveStep.operations += 1
        moveStep.findings.push(...sameState(moved, await timedRead(), 'redo-not-restored'))
        if (!(await clickUndo(session))) moveStep.notes.push('2 回目の元に戻すが押せませんでした。')
        moveStep.operations += 1
        current = await timedRead()
        moveStep.findings.push(...sameState(base, current, 'undo-not-restored'))
        await finish('b', moveStep)
      }
      current = await timedRead()
    }

    // ── (a) テンプレ保存: テンプレ編集を開く → 反映日を来週の月曜 → 何も変えずに保存 → 保存 → 読み込み直し。
    if (scenarios.includes('a')) {
      lastScenario = 'a'
      const step = newStep(`テンプレ保存(反映日 ${nextMonday}・何も変えない)`)
      const before = current
      const defaultDate = await openTemplateEditor(session)
      step.operations += 1
      step.notes.push(`反映開始日の既定: ${defaultDate}`)
      await setTemplateStartDate(session, nextMonday)
      step.operations += 1
      const { confirmMessage, detailText } = await requestTemplateSave(session)
      step.operations += 1
      step.notes.push(`確認の画面: ${confirmMessage}`)
      if (detailText) {
        const lines = detailText.split('\n').map((line) => line.trim()).filter(Boolean)
        step.notes.push(`確認の画面の詳細(${lines.length} 行): ${lines.slice(0, 12).join(' / ')}${lines.length > 12 ? ' / …' : ''}`)
      } else step.notes.push('確認の画面の詳細: なし')
      const downloadsBefore = session.downloads
      await confirmTemplateSave(session)
      step.operations += 1
      const after = await timedRead()
      step.diff = { before: before.facts, after: after.facts }
      step.notes.push(`保存のあとのステータス: ${await readStatusText(session)}`, `テンプレ保存前の盤面の PDF: ${session.downloads - downloadsBefore} 件(保存せず取り消し)`)
      // 根拠を失った振替を消す件数(§9-12・確認の画面の詳細に出る)。その範囲で消えた振替と、その振替元の「移)」の記録は info になる。
      const manualFindings = app.checkManualStudentsKeepTeacher(before.facts, after.facts, {
        announcedText: detailText,
        announcedOrphanedMakeupCount: app.parseAnnouncedOrphanedMakeupCount(detailText),
      })
      const releasedMovedStatusStudentKeys = new Set(manualFindings.filter((finding) => finding.code === 'orphaned-makeup-removed-announced' && finding.studentId).map((finding) => finding.studentId))
      step.findings.push(
        ...app.checkOutsideAllowedRange(before.facts, after.facts, { fromDateKey: nextMonday, sections: new Set(TEMPLATE_SAVE_ALLOWED_SECTIONS) }),
        ...manualFindings,
        ...app.checkTeacherlessStudentsNotAdded(before.facts, after.facts),
        ...app.checkManualInputsNotLost(before.facts, after.facts, { releasedMovedStatusStudentKeys }),
        ...app.checkAuditNotWorse(timedAudit(before), timedAudit(after)),
        ...app.checkPendingCountMatchesPreview(before.facts, after.facts, confirmMessage),
        ...app.summarizeChanges(before.facts, after.facts),
      )
      await finish('a', step)
      current = after

      const persistStep = newStep('テンプレ保存のあと 保存→読み込み直し')
      if (await clickSave(session)) persistStep.operations += 1
      else persistStep.notes.push('保存ボタンは既に clean で押せませんでした。')
      const saved = await timedRead()
      persistStep.findings.push(...sameState(current, saved, 'save-changed'))
      await reloadApp(session)
      persistStep.operations += 1
      current = await timedRead()
      persistStep.findings.push(...sameState(saved, current, 'reload-changed'))
      await finish('a', persistStep)
    }
  } catch (error) {
    const file = await shoot(`${lastScenario}-aborted`)
    const reason = error instanceof PatrolAbortError ? error.message : `巡回の途中で例外: ${error instanceof Error ? `${error.name}: ${error.message.split('\n')[0].slice(0, 200)}` : String(error)}`
    report = { ...report, aborted: `${lastScenario}: ${reason}${file ? `(画面写真 ${path.basename(file)})` : ''}` }
  }

  // ── 最後に、外への通信の試みと画面のエラーを所見にする(途中で止まっても出す)。
  const browserStep = newStep('ブラウザの記録(外への通信・画面のエラー)')
  for (const host of [...new Set(session.externalRequests)]) {
    browserStep.findings.push({ level: 'stop', code: 'external-request', message: `localhost 以外への通信を試みた: ${host}(${session.externalRequests.filter((item) => item === host).length} 回)` })
  }
  for (const message of [...new Set(session.pageErrors)]) {
    browserStep.findings.push({ level: 'stop', code: 'page-error', message: `画面でエラーが出た: ${message}` })
  }
  browserStep.notes.push(`読み取り ${Math.round(timings.read / 100) / 10} 秒・保証台帳の洗い出し ${Math.round(timings.audit / 100) / 10} 秒`)
  const filtered = app.applyKnownIssues(browserStep.findings, known, { classroomId, step: 'browser' })
  report = addStep({ ...report, knownCount: report.knownCount + filtered.knownCount }, { name: 'browser', title: browserStep.title, durationMs: 0, operations: 0, findings: filtered.findings, notes: browserStep.notes })
  return report
}
