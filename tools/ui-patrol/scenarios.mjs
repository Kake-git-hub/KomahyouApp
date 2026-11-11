// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5「台本(第 1 段)」)の台本。
// 教室ごとに 起動 → (c) 保存→読み込み直し → (b) 生徒の移動 → (a) テンプレ保存 → (d) テンプレを実際に変えて保存 の順で、室長と同じ画面操作をし、
// 操作のたびに「前の状態を読む → 操作 → 後の状態を読む → 点検 → 既知を外す → 報告へ足す」。
// ★点検は tools/ui-patrol/checks.ts、盤面の事実は boardFacts.ts(どちらも esbuild で束ねた app から呼ぶ)。ここで規則を書き直さない。
// ★報告に出すのは仮名・ID・件数・経路だけ(所見の message は checks.ts が作る。ここで足す注も ID と件数だけ)。
// ★前半(候補選び・変わってよい範囲)は純関数。runClassroomPatrol だけがブラウザを動かす。
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { addStep, createClassroomReport } from './report.mjs'
import * as realDriver from './driver.mjs'
import { PatrolAbortError } from './driver.mjs'
import { runRandomOps } from './randomOps.mjs'

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
 * 入れていないもの: 在庫(manualLectureStock*)・希望回数(scheduleCountAdjustments)・教室設定・保留の机(templatePendingDesks)。
 * 生徒の移動は commitWeeks へ今の値をそのまま渡す(元に戻すの履歴 createHistoryEntry もこれらを戻す)。
 * 出席不可コマへの移動の確認(confirmReopenForPlacements → App の applyReopenedSlotConversions)は specialSessions を変えるが、
 * 元に戻すで戻らない別の帳簿なので範囲に入れない(起きたらダイアログの文つきで「変」に出し、人が見る)。
 */
export const MOVE_ALLOWED_SECTIONS = [
  'boardState.suppressedRegularLessonOccurrences',
]

/**
 * 元か先の机に出欠記録があるときだけ足す部分: executeMoveStudent が、移動元の「移)」の印で上書きされた前の生徒の出欠記録を台帳へ確定する
 * (computeStudentMove の displacedStatusEntries → materializeDisplacedStatusEntryIntoLedgers → commitWeeks・Issue #57 / INV-06)。
 * 候補選び(pickMoveCandidates)は出欠記録のある机を元にも先にもしないので、今の台本では使わない(作業 5 修正 1・レビューの指摘)。
 */
export const MOVE_DISPLACED_STATUS_SECTIONS = [
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

/**
 * テンプレを実際に変えて保存(台本 d)で変わってよい範囲。考え方(docs/runbooks/ui-patrol.md の台本の表):
 * (i) 反映日以降の、テンプレ由来の部分(§2 の規則で説明がつく変化) (ii) 今回変えたテンプレの机に対応するコマの机。
 * (ii) のコマは反映日以降にしかない(テンプレ保存は反映日より前の机を触らない)ので、机の範囲は (i) と同じ「反映日以降」で足りる。
 * 部分は何も変えない保存(台本 a)と同じ: テンプレの中身が変わっても、保存が書き換える部分は buildTemplateDiffSavePlan の同じ所だけ
 * (TEMPLATE_SAVE_ALLOWED_SECTIONS の根拠のとおり)。手入力が消える・ずれる・講師なしになる、は範囲の内でも checks.ts の点検が「変」にする(INV-02)。
 */
export const TEMPLATE_EDIT_ALLOWED_SECTIONS = TEMPLATE_SAVE_ALLOWED_SECTIONS

/** 台本 d の範囲(反映日以降の机・TEMPLATE_EDIT_ALLOWED_SECTIONS)。 */
export function buildTemplateEditAllowedChange(fromDateKey) {
  return { fromDateKey, sections: new Set(TEMPLATE_EDIT_ALLOWED_SECTIONS) }
}

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

/** 移動で変わってよい範囲: 元と先の机・MOVE_ALLOWED_SECTIONS(元か先の机に出欠記録があるときは MOVE_DISPLACED_STATUS_SECTIONS も)。 */
export function buildMoveAllowedChange(candidate, { hasDisplacedStatuses = false } = {}) {
  return {
    deskKeys: new Set([`${candidate.from.cellId}#${candidate.from.deskIndex}`, `${candidate.to.cellId}#${candidate.to.deskIndex}`]),
    sections: new Set([...MOVE_ALLOWED_SECTIONS, ...(hasDisplacedStatuses ? MOVE_DISPLACED_STATUS_SECTIONS : [])]),
  }
}

/** dateKey(YYYY-MM-DD)から 7 日分。 */
export function weekDateKeysFrom(mondayKey) {
  const start = Date.parse(`${mondayKey}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10))
}

/** 生徒の移動の候補を探す週の月曜(来週の月曜から extraWeeks 週先まで)。 */
export function weekStartsFrom(mondayKey, extraWeeks = 3) {
  return Array.from({ length: extraWeeks + 1 }, (_, offset) => new Date(Date.parse(`${mondayKey}T00:00:00Z`) + offset * 7 * 86400000).toISOString().slice(0, 10))
}

/**
 * テンプレ自体が講師なしにしている授業の鍵「曜日|時限|生徒ID」(テンプレの机の teacherId が空で生徒がいる)と、そのテンプレの反映日。
 * テンプレの形: { effectiveStartDate, cells: [{ dayOfWeek(日曜 0), slotNumber, desks: [{ deskIndex, teacherId, students: [{ studentId, subject }] }] }] }。
 * checks.ts の checkTeacherlessStudentsNotAdded の templateTeacherless に渡す(テンプレどおりの講師なしは「変」ではない・作業 5 修正 1)。
 */
export function collectTemplateTeacherlessKeys(template) {
  const keys = new Set()
  for (const cell of Array.isArray(template?.cells) ? template.cells : []) {
    for (const desk of Array.isArray(cell?.desks) ? cell.desks : []) {
      if (typeof desk?.teacherId === 'string' && desk.teacherId.trim() !== '') continue
      for (const student of Array.isArray(desk?.students) ? desk.students : []) {
        if (student?.studentId) keys.add(`${cell.dayOfWeek}|${cell.slotNumber}|${student.studentId}`)
      }
    }
  }
  return { keys, fromDateKey: typeof template?.effectiveStartDate === 'string' ? template.effectiveStartDate : '' }
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
  const pick = (facts, cellId) => [...facts.desks.values()].filter((desk) => desk.cellId === cellId).map((desk) => {
    // メモの中身は出さず件数だけ(伏せ字で「メモ」になっているが二重の守り)。出欠記録の文字列は生徒キー・状態・科目・種類だけなのでそのまま。
    const { memos, pendingMemos } = desk
    const rest = Object.fromEntries(Object.entries(desk).filter(([key]) => !['signature', 'memos', 'pendingMemos'].includes(key)))
    return { ...rest, memoCount: memos.length, pendingMemoCount: pendingMemos.length }
  })
  try {
    writeFileSync(file, JSON.stringify({ findings: stops, cells: cells.map((cellId) => ({ cellId, before: pick(before, cellId), after: pick(after, cellId) })) }, null, 1))
    return file
  } catch {
    return null
  }
}

/**
 * テンプレ保存(台本 a と d)の点検の組み合わせ。両方の台本がここを通す(数え方を 2 つ作らない)。
 * 根拠を失った振替を消す件数(§9-12・確認の画面の詳細に出る)。その範囲で消えた振替と、同じ生徒×科目の振替元の「移)」の記録は info になる。
 * テンプレ自体が講師なしにしている授業は「変」ではない(保存のあとのテンプレ＝反映日以降に効く版から作る)。
 */
export function collectTemplateSaveFindings({ app, before, after, fromDateKey, confirmMessage, detailText, audit, allowed = { fromDateKey, sections: new Set(TEMPLATE_SAVE_ALLOWED_SECTIONS) } }) {
  const manualFindings = app.checkManualStudentsKeepTeacher(before.facts, after.facts, {
    announcedText: detailText,
    announcedOrphanedMakeupCount: app.parseAnnouncedOrphanedMakeupCount(detailText),
  })
  const releasedMovedStatuses = manualFindings
    .filter((finding) => finding.code === 'orphaned-makeup-removed-announced' && finding.studentId)
    .map((finding) => `${finding.studentId}|${finding.subject ?? ''}`)
  const templateTeacherless = collectTemplateTeacherlessKeys(after.payload?.classroomSettings?.regularLessonTemplate)
  return [
    ...app.checkOutsideAllowedRange(before.facts, after.facts, allowed),
    ...manualFindings,
    ...app.checkTeacherlessStudentsNotAdded(before.facts, after.facts, { templateTeacherless }),
    ...app.checkManualInputsNotLost(before.facts, after.facts, { releasedMovedStatuses }),
    ...app.checkAuditNotWorse(audit(before), audit(after)),
    ...app.checkPendingCountMatchesPreview(before.facts, after.facts, confirmMessage),
    ...app.summarizeChanges(before.facts, after.facts),
  ]
}

const TEMPLATE_WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const TEMPLATE_EDIT_LABELS = { 'add-student': '生徒を 1 人足す', 'change-teacher': '講師を替える', 'delete-desk': '机を消す' }

function describeTemplateDesk(desk) {
  return `テンプレ ${TEMPLATE_WEEKDAY_LABELS[desk.dayOfWeek] ?? '?'}曜 ${desk.slotNumber}限 机${desk.deskIndex + 1}`
}

/** 報告の「何をどこへ」(仮名と ID だけ)。anchorDates は確かめる日の日付。 */
function describeTemplateEdit(edit, desk, { studentName = '', anchorDates = [] } = {}) {
  const teacher = `${desk.teacher}(${desk.teacherId})`
  const range = anchorDates.length > 0 ? `・確かめる日 ${anchorDates.length} コマ(${anchorDates[0]}〜${anchorDates[anchorDates.length - 1]})` : ''
  if (edit.kind === 'add-student') return `${TEMPLATE_EDIT_LABELS[edit.kind]}: ${describeTemplateDesk(desk)} 席${(edit.seat ?? 0) + 1} ← ${studentName}(${edit.studentKeys[0]})(${teacher} の机)${range}`
  if (edit.kind === 'change-teacher') return `${TEMPLATE_EDIT_LABELS[edit.kind]}: ${describeTemplateDesk(desk)} ${teacher} → ${edit.newTeacher}(${edit.newTeacherId || 'ID なし'})${range}`
  return `${TEMPLATE_EDIT_LABELS[edit.kind]}: ${describeTemplateDesk(desk)} ${teacher}・生徒 ${edit.studentKeys.join('・') || 'なし'}${range}`
}

/**
 * 生徒の移動を 1 回: 長押しドラッグ → 読む → 点検。台本 b とでたらめ操作の両方から呼ぶ(点検の組み合わせを 1 か所にする)。
 * before は操作の前の状態({ payload, facts, auditResult })、read は状態を読む関数、audit は状態の保証台帳(状態にためて使い回す)。
 * 戻り値 outcome: 'moved'(状態が変わった・点検した)/ 'blocked'(状態が変わらずステータスの文が変わった＝アプリが断った・info move-blocked)/
 * 'nothing'(状態も文も変わらない＝押しても何も起きないか台本が画面に合っていない。呼んだ側が中断する・作業 5 修正 1)。
 * 元に戻す・やり直しは押さない(呼んだ側の手順で決める)。
 */
export async function attemptStudentMove({ session, driver, app, before, candidate, read, audit }) {
  const notes = [describeCandidate(candidate)]
  const findings = []
  const dialogsBefore = session.dialogs.length
  const statusBefore = await driver.readStatusText(session)
  const status = await driver.dragStudent(session, candidate.from, candidate.to)
  const moved = await read()
  notes.push(`ステータス: ${status}`)
  for (const dialog of session.dialogs.slice(dialogsBefore)) notes.push(`ダイアログ: ${dialog}`)
  const diff = app.diffBoardFacts(before.facts, moved.facts)
  if (diff.desks.length === 0 && diff.sections.length === 0) {
    // 状態が変わらない。ステータスの文が変わっていればアプリが断った移動(出席済み・メモ・同じコマに同じ生徒・休校日など)。
    // 文も変わらなければ「押しても何も起きない」か「台本が画面に合っていない」ので、黙って通さず中断する(作業 5 修正 1)。
    if (status === statusBefore) {
      return { outcome: 'nothing', notes, findings, moved, diff: null, message: `移動しても盤面もステータスの文も変わらず、何も起きません: ${describeCandidate(candidate)}` }
    }
    findings.push({ level: 'info', code: 'move-blocked', message: `アプリが移動を断った: ${describeSeat(candidate.from)} → ${describeSeat(candidate.to)}(${status})` })
    return { outcome: 'blocked', notes, findings, moved, diff: null }
  }
  const deskOf = (seat) => before.facts.desks.get(`${seat.cellId}#${seat.deskIndex}`)
  const hasDisplacedStatuses = [deskOf(candidate.from), deskOf(candidate.to)].some((desk) => (desk?.statuses.length ?? 0) > 0)
  const allowed = buildMoveAllowedChange(candidate, { hasDisplacedStatuses })
  const exclude = { excludeDeskKeys: allowed.deskKeys }
  findings.push(
    ...app.checkOutsideAllowedRange(before.facts, moved.facts, allowed),
    ...app.checkManualStudentsKeepTeacher(before.facts, moved.facts, exclude),
    ...app.checkTeacherlessStudentsNotAdded(before.facts, moved.facts, exclude),
    ...app.checkManualInputsNotLost(before.facts, moved.facts, exclude),
    ...app.checkAuditNotWorse(audit(before), audit(moved)),
  )
  const landed = moved.facts.desks.get(`${candidate.to.cellId}#${candidate.to.deskIndex}`)?.students[candidate.to.seat]
  if (!landed || landed.key !== candidate.studentId) {
    findings.push({ level: 'stop', code: 'move-not-applied', message: `動かした生徒が先の席にいない: ${describeCandidate(candidate)}`, studentId: candidate.studentId })
  }
  return { outcome: 'moved', notes, findings, moved, diff: { before: before.facts, after: moved.facts } }
}

/**
 * 生徒の移動の候補がある最初の週を探す(来週＋3 週先まで)。週ごとに「その週を開く → 読む → その週の事実で候補を選ぶ」。
 * ★アプリは週を開いたときに初めてその週を作る(ScheduleBoardScreen.tsx の週の移動・createBoardWeek)。開く前のデータで選ぶと、
 *   保存済みのデータに来週以降の週が無い教室では候補が 0 になり、開いたときに作り直された席を選ぶこともある(作業 5 修正 2)。
 * 週へ移るだけ(室長の操作だが盤面は変えない)なので操作に数えない。base は最後に開いた週で読んだ状態。
 */
export async function searchMoveWeek({ session, driver, read, nextMonday, today, count, seed }) {
  const searchedWeeks = []
  let base = null
  for (const monday of weekStartsFrom(nextMonday)) {
    searchedWeeks.push(monday)
    await driver.gotoWeekOf(session, monday)
    base = await read()
    const candidates = pickMoveCandidates(base.facts, { weekDateKeys: weekDateKeysFrom(monday), todayKey: today, count, seed })
    if (candidates.length > 0) return { searchedWeeks, weekStart: monday, candidates, base }
  }
  return { searchedWeeks, weekStart: null, candidates: [], base }
}

/**
 * 教室 1 つぶんの台本を流し、教室の報告(report.mjs の形)を返す。driver は差し替えられる(テストの偽の driver・既定は driver.mjs)。
 * 操作の数え方: 実際に押せた/効いたものだけ(断られた移動は 1、押せなかった元に戻す・やり直しは 0。週へ移るだけの準備は数えない)。
 */
export async function runClassroomPatrol({ session, app, classroom, seedSnapshot, options, outDir, known, today, driver = realDriver }) {
  const d = driver
  const { classroomId } = classroom
  let report = createClassroomReport(classroom)
  const scenarios = options.scenarios ?? ['boot', 'c', 'b', 'a', 'd']
  const nextMonday = app.resolveNextMondayDateKey(today)
  let shotCount = 0
  let lastScenario = 'boot'
  const shoot = async (scenario) => {
    shotCount += 1
    return d.takeScreenshot(session, path.join(outDir, `${classroomId}-${scenario}-${shotCount}.png`))
  }
  const toState = (read) => ({ payload: read.payload, facts: app.collectBoardFacts(read.payload), auditResult: null })
  const auditOf = (state) => {
    if (!state.auditResult) state.auditResult = app.auditClassroomSnapshot({ classroomId, payload: state.payload, today, known: [] })
    return state.auditResult
  }
  const sameState = (before, after, code) => app.checkSameState(before.facts, after.facts, code)
  const timings = { audit: 0, read: 0 }
  const timedAudit = (state) => { const started = Date.now(); const result = auditOf(state); timings.audit += Date.now() - started; return result }
  const timedRead = async () => { const started = Date.now(); const state = toState(await d.readClassroom(session)); timings.read += Date.now() - started; return state }

  /** 手順を報告へ足す(既知を外し、stop があれば画面写真と差分)。 */
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
  // 台本 b が使った週(でたらめ操作も同じ週で動かす)。
  let moveWeekStart = null
  try {
    // ── 起動: 種データ(伏せ字の payload)を「前」、開いた直後を「後」とする。手入力は変わってはいけない。
    {
      lastScenario = 'boot'
      const step = newStep('起動(種データを入れて開く)')
      const seededClassroom = seedSnapshot.classrooms.find((room) => room.id === classroomId)
      if (!seededClassroom) throw new PatrolAbortError('種データにこの教室がありません。')
      const before = toState({ payload: seededClassroom.data })
      await d.seedAndOpen(session, seedSnapshot)
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
      step.notes.push(`開いた直後のステータス: ${await d.readStatusText(session)}`, `保存ボタン: ${await d.readSaveState(session)}`)
      await finish('boot', step)
    }

    // ── (c) 保存→読み込み直し: 保存でも読み込み直しでも盤面は変わらない。
    if (scenarios.includes('c')) {
      lastScenario = 'c'
      const step = newStep('保存→読み込み直し')
      const pressed = await d.clickSave(session)
      if (pressed) step.operations += 1
      else step.notes.push('保存ボタンは既に clean で押せませんでした(保存する変更が無い・ローカルモードは変更の 5 秒後に自分で保存する)。')
      const saved = await timedRead()
      step.findings.push(...sameState(current, saved, 'save-changed'))
      await d.reloadApp(session)
      step.operations += 1
      current = await timedRead()
      step.findings.push(...sameState(saved, current, 'reload-changed'))
      step.notes.push(`読み込み直しのあとの保存ボタン: ${await d.readSaveState(session)}`)
      await finish('c', step)
    }

    // ── (b) 生徒の移動: 長押しドラッグ → 元に戻す → やり直し → 元に戻す。変わってよいのは元と先の机だけ。
    if (scenarios.includes('b')) {
      lastScenario = 'b'
      // 候補のある最初の週を使う(来週＋3 週先まで・searchMoveWeek)。
      const { searchedWeeks, weekStart, candidates, base } = await searchMoveWeek({ session, driver: d, read: timedRead, nextMonday, today, count: options.moves, seed: options.seed })
      moveWeekStart = weekStart
      current = base
      const step = newStep(`生徒の移動の準備(${weekStart ?? nextMonday} の週)`)
      const kinds = new Set(candidates.map((candidate) => candidate.kind))
      if (weekStart) step.notes.push(`使った週: ${weekStart} の週${weekStart !== nextMonday ? `(${searchedWeeks.slice(0, -1).join('・')} の週は開いても候補が無かった)` : ''}`)
      else step.notes.push(`動かせる生徒と空いた席の組が見つかりませんでした(開いた週: ${searchedWeeks.join('・')})。`)
      step.notes.push(`候補 ${candidates.length} か所(種類 ${kinds.size}/${MOVE_KINDS.length}: ${[...kinds].map((kind) => KIND_LABELS[kind]).join('・') || 'なし'})`)
      await finish('b', step)
      let effectiveMoves = 0
      for (const [index, candidate] of candidates.entries()) {
        const moveStep = newStep(`生徒の移動 ${index + 1}(${KIND_LABELS[candidate.kind]})`)
        const attempt = await attemptStudentMove({ session, driver: d, app, before: base, candidate, read: timedRead, audit: timedAudit })
        moveStep.operations += 1
        moveStep.notes.push(...attempt.notes)
        moveStep.findings.push(...attempt.findings)
        if (attempt.outcome === 'nothing') {
          await finish('b', moveStep)
          throw new PatrolAbortError(attempt.message)
        }
        // 断られた移動: 元に戻すは押さない(履歴が積まれていない)。
        if (attempt.outcome === 'blocked') {
          await finish('b', moveStep)
          continue
        }
        effectiveMoves += 1
        const { moved } = attempt
        moveStep.diff = attempt.diff
        // 元に戻す・やり直しが押せないのは、移動が効いたあとの室長にとって「変」(戻せない)。押せなかったボタンは操作に数えない。
        const cannotPress = (label, code) => ({ level: 'stop', code, message: `${label}が押せない(ボタンが無効): ${describeCandidate(candidate)}`, studentId: candidate.studentId })
        if (!(await d.clickUndo(session))) {
          moveStep.findings.push(cannotPress('移動のあと元に戻す', 'undo-not-restored'))
          current = moved
          moveStep.notes.push('盤面が移動のあとのまま戻せないので、残りの移動は流しません。')
          await finish('b', moveStep)
          break
        }
        moveStep.operations += 1
        moveStep.findings.push(...sameState(base, await timedRead(), 'undo-not-restored'))
        if (await d.clickRedo(session)) {
          moveStep.operations += 1
          moveStep.findings.push(...sameState(moved, await timedRead(), 'redo-not-restored'))
          if (!(await d.clickUndo(session))) {
            moveStep.findings.push(cannotPress('やり直しのあと元に戻す', 'undo-not-restored'))
            current = await timedRead()
            moveStep.notes.push('盤面が移動のあとのまま戻せないので、残りの移動は流しません。')
            await finish('b', moveStep)
            break
          }
          moveStep.operations += 1
          moveStep.findings.push(...sameState(base, await timedRead(), 'undo-not-restored'))
        } else {
          moveStep.findings.push(cannotPress('元に戻したあとやり直し', 'redo-not-restored'))
        }
        await finish('b', moveStep)
      }
      // 効いた移動が 1 回も無い台本 b は、中身が無いまま緑になる。台本 b を指定しているなら中断(作業 5 修正 1)。
      if (effectiveMoves === 0) throw new PatrolAbortError('台本 b で効いた移動が 1 回もありません(候補が無い・全部断られた)。')
      current = await timedRead()
    }

    // ── でたらめ操作(試験的・--random n が 1 以上のときだけ): 台本 b のあと・a の前。b が無くても流す(週は b と同じ探し方)。
    // 移動・元に戻す・やり直し・保存・読み込み直しを種つきの乱数で組み合わせる(tools/ui-patrol/randomOps.mjs)。
    if ((options.random ?? 0) > 0) {
      lastScenario = 'random'
      let weekStart = moveWeekStart
      if (!weekStart) {
        const searched = await searchMoveWeek({ session, driver: d, read: timedRead, nextMonday, today, count: options.moves, seed: options.seed })
        weekStart = searched.weekStart ?? nextMonday
        current = searched.base
      }
      const step = newStep(`でたらめ操作 ${options.random} 回(試験的・${weekStart} の週)`)
      let result
      try {
        result = await runRandomOps({
          session, app, options, today, driver: d, start: current, weekStart, read: timedRead, audit: timedAudit,
          onFinding: (finding) => step.findings.push(finding), onNote: (note) => step.notes.push(note),
        })
      } catch (error) {
        // driver の時間切れなどで抜けても、手順の 1 行(runRandomOps が notes へ出す)を報告に残してから中断する。
        await finish('random', step)
        throw error
      }
      step.operations = result.operations
      step.diff = result.diff
      await finish('random', step)
      if (result.aborted) throw new PatrolAbortError(result.aborted)
      current = result.current
    }

    // ── (a) テンプレ保存: テンプレ編集を開く → 反映日を来週の月曜 → 何も変えずに保存 → 保存 → 読み込み直し。
    if (scenarios.includes('a')) {
      lastScenario = 'a'
      const step = newStep(`テンプレ保存(反映日 ${nextMonday}・何も変えない)`)
      const before = current
      const defaultDate = await d.openTemplateEditor(session)
      step.operations += 1
      step.notes.push(`反映開始日の既定: ${defaultDate}`)
      if (defaultDate && defaultDate > nextMonday) {
        // 確認の画面は「テンプレの中身に変更はありません」と出すが、盤面には別の版が当たる(読む人が「何も変えない保存」と誤解しないため)。
        step.notes.push(`保存済みのテンプレ(反映日 ${defaultDate})を手前の日付で当てています(${nextMonday} 以降に、その版の中身が当たる)。`)
      } else if (defaultDate && defaultDate !== nextMonday) {
        step.notes.push(`既定の反映日 ${defaultDate} と違う日 ${nextMonday} で保存しています。`)
      }
      await d.setTemplateStartDate(session, nextMonday)
      step.operations += 1
      const { confirmMessage, detailText } = await d.requestTemplateSave(session)
      step.operations += 1
      step.notes.push(`確認の画面: ${confirmMessage}`)
      if (detailText) {
        const lines = detailText.split('\n').map((line) => line.trim()).filter(Boolean)
        step.notes.push(`確認の画面の詳細(${lines.length} 行): ${lines.slice(0, 12).join(' / ')}${lines.length > 12 ? ' / …' : ''}`)
      } else step.notes.push('確認の画面の詳細: なし')
      const downloadsBefore = session.downloads
      await d.confirmTemplateSave(session)
      step.operations += 1
      const after = await timedRead()
      step.diff = { before: before.facts, after: after.facts }
      step.notes.push(`保存のあとのステータス: ${await d.readStatusText(session)}`, `テンプレ保存前の盤面の PDF: ${session.downloads - downloadsBefore} 件(保存せず取り消し)`)
      step.findings.push(...collectTemplateSaveFindings({ app, before, after, fromDateKey: nextMonday, confirmMessage, detailText, audit: timedAudit }))
      await finish('a', step)
      current = after

      const persistStep = newStep('テンプレ保存のあと 保存→読み込み直し')
      if (await d.clickSave(session)) persistStep.operations += 1
      else persistStep.notes.push('保存ボタンは既に clean で押せませんでした。')
      const saved = await timedRead()
      persistStep.findings.push(...sameState(current, saved, 'save-changed'))
      await d.reloadApp(session)
      persistStep.operations += 1
      current = await timedRead()
      persistStep.findings.push(...sameState(saved, current, 'reload-changed'))
      await finish('a', persistStep)
    }

    // ── (d) テンプレを実際に変えて保存: 生徒を 1 人足す → 講師を替える → 机を消す を 1 回の保存に 1 種類ずつ(所見がどの変更のせいか分かるように)。
    // 1 回ごとに テンプレ編集を開く → 反映日を来週の月曜 → 机を変える → 保存 → 確認 → 読む → 点検。最後に 保存→読み込み直し。
    // 変える机・生徒・講師は種つきの乱数(--seed)で選ぶ(tools/ui-patrol/templateEdit.ts)。候補の無い種類は飛ばして注に理由を書く。
    if (scenarios.includes('d')) {
      lastScenario = 'd'
      const random = createSeededRandom((Number(options.seed) || 0) + 0x5d)
      const usedCellIds = new Set()
      let editsDone = 0
      const rosterById = new Map((current.payload?.students ?? []).map((row) => [row.id, row]))
      const isStudentActiveOnDate = (studentKey, dateKey) => {
        const row = rosterById.get(studentKey)
        return row ? app.isActiveOnDate(row.entryDate ?? '', row.withdrawDate ?? '', row.birthDate ?? '', dateKey) : true
      }
      const kinds = app.TEMPLATE_EDIT_KINDS ?? ['add-student', 'change-teacher', 'delete-desk']
      for (const [index, kind] of kinds.entries()) {
        const step = newStep(`テンプレを変えて保存 ${index + 1}(${TEMPLATE_EDIT_LABELS[kind]}・反映日 ${nextMonday})`)
        const before = current
        const target = app.pickTemplateEditTarget({ kind, desks: app.buildTemplateEditorDesks(before.payload, today), facts: before.facts, fromDateKey: nextMonday, random, excludeCellIds: usedCellIds })
        if (target.skip) {
          step.notes.push(`飛ばした(${TEMPLATE_EDIT_LABELS[kind]}): ${target.skip}`)
          await finish('d', step)
          continue
        }
        const { desk } = target
        usedCellIds.add(desk.cellId)
        const anchorDates = [...new Set(target.anchorCellIds.map((cellId) => cellId.split('_')[0]))].sort()
        const presence = app.collectCellPresence(before.facts, target.anchorCellIds)
        const position = { cellId: desk.cellId, deskIndex: desk.deskIndex }
        const defaultDate = await d.openTemplateEditor(session)
        step.operations += 1
        step.notes.push(`反映開始日の既定: ${defaultDate}`)
        // 台本 a を流さずに d だけ流すと、1 回目の保存は先の版の中身も手前の日付で当てる(変わった机にその分も混ざる)。読む人が取り違えないよう注を出す。
        if (defaultDate && defaultDate > nextMonday) step.notes.push(`保存済みのテンプレ(反映日 ${defaultDate})を手前の日付で当てています(${nextMonday} 以降に、その版の中身も当たる)。`)
        await d.setTemplateStartDate(session, nextMonday)
        step.operations += 1
        let edit = null
        let studentName = ''
        if (kind === 'add-student') {
          const inTemplateCell = new Set()
          for (const other of app.buildTemplateEditorDesks(before.payload, today)) {
            if (other.cellId !== desk.cellId) continue
            for (const entry of other.students) if (entry) inTemplateCell.add(entry.studentId)
          }
          const { studentId } = await d.templateAddStudent(session, { ...position, seat: target.seat }, (choices) => app.pickTemplateEditOption({
            options: choices, exclude: inTemplateCell, random,
            prefer: (value) => !presence.studentKeys.has(value) && anchorDates.every((dateKey) => isStudentActiveOnDate(value, dateKey)),
          }))
          if (studentId) {
            edit = { kind, dayOfWeek: desk.dayOfWeek, slotNumber: desk.slotNumber, deskIndex: desk.deskIndex, seat: target.seat, teacher: desk.teacher, teacherId: desk.teacherId, studentKeys: [studentId], anchorCellIds: target.anchorCellIds }
            const row = rosterById.get(studentId)
            studentName = row ? (row.displayName || row.name || '') : ''
          }
        } else if (kind === 'change-teacher') {
          const { teacher } = await d.templateChangeTeacher(session, position, (choices) => app.pickTemplateEditOption({
            options: choices, exclude: new Set([desk.teacher]), random, prefer: (value) => !presence.teachers.has(value),
          }))
          if (teacher) {
            edit = { kind, dayOfWeek: desk.dayOfWeek, slotNumber: desk.slotNumber, deskIndex: desk.deskIndex, teacher: desk.teacher, teacherId: desk.teacherId, newTeacher: teacher, newTeacherId: app.resolveTeacherIdByDisplayName(before.payload?.teachers, teacher), studentKeys: desk.students.filter(Boolean).map((entry) => entry.studentId), anchorCellIds: target.anchorCellIds }
          }
        } else {
          await d.templateDeleteDesk(session, { ...position, seats: [0, 1].filter((seat) => desk.students[seat] !== null) })
          edit = { kind, dayOfWeek: desk.dayOfWeek, slotNumber: desk.slotNumber, deskIndex: desk.deskIndex, teacher: desk.teacher, teacherId: desk.teacherId, studentKeys: desk.students.filter(Boolean).map((entry) => entry.studentId), anchorCellIds: target.anchorCellIds }
        }
        if (!edit) {
          // 選べる生徒・講師が画面に無かった。テンプレ編集を保存せずに閉じる。
          await d.closeTemplateEditor(session)
          step.notes.push(`飛ばした(${TEMPLATE_EDIT_LABELS[kind]}): ${describeTemplateDesk(desk)} で選べる${kind === 'add-student' ? '生徒' : '講師'}が画面にありません。`)
          await finish('d', step)
          continue
        }
        step.operations += 1
        editsDone += 1
        step.notes.push(describeTemplateEdit(edit, desk, { studentName, anchorDates }))
        const { confirmMessage, detailText } = await d.requestTemplateSave(session)
        step.operations += 1
        step.notes.push(`確認の画面: ${confirmMessage}`)
        if (detailText) {
          const lines = detailText.split('\n').map((line) => line.trim()).filter(Boolean)
          step.notes.push(`確認の画面の詳細(${lines.length} 行): ${lines.slice(0, 12).join(' / ')}${lines.length > 12 ? ' / …' : ''}`)
        } else step.notes.push('確認の画面の詳細: なし')
        await d.confirmTemplateSave(session)
        step.operations += 1
        const after = await timedRead()
        step.diff = { before: before.facts, after: after.facts }
        step.notes.push(`保存のあとのステータス: ${await d.readStatusText(session)}`)
        step.findings.push(
          ...collectTemplateSaveFindings({ app, before, after, fromDateKey: nextMonday, confirmMessage, detailText, audit: timedAudit, allowed: buildTemplateEditAllowedChange(nextMonday) }),
          ...app.checkTemplateEditSaved(after.payload?.classroomSettings?.regularLessonTemplate, edit),
          ...app.checkTemplateEditApplied(before.facts, after.facts, edit, { isStudentActiveOnDate }),
        )
        await finish('d', step)
        current = after
      }
      // 3 種類とも 1 度もできなければ、中身が無いまま緑になる。台本 d を指定しているなら中断(台本 b と同じ扱い)。
      if (editsDone === 0) throw new PatrolAbortError('台本 d でテンプレの変更が 1 回もできませんでした(候補の机・生徒・講師が無い)。')

      const persistStep = newStep('テンプレを変えて保存のあと 保存→読み込み直し')
      if (await d.clickSave(session)) persistStep.operations += 1
      else persistStep.notes.push('保存ボタンは既に clean で押せませんでした。')
      const saved = await timedRead()
      persistStep.findings.push(...sameState(current, saved, 'save-changed'))
      await d.reloadApp(session)
      persistStep.operations += 1
      current = await timedRead()
      persistStep.findings.push(...sameState(saved, current, 'reload-changed'))
      await finish('d', persistStep)
    }
  } catch (error) {
    const file = await shoot(`${lastScenario}-aborted`)
    const reason = error instanceof PatrolAbortError ? error.message : `巡回の途中で例外: ${error instanceof Error ? `${error.name}: ${error.message.split('\n')[0].slice(0, 200)}` : String(error)}`
    report = { ...report, aborted: `${lastScenario}: ${reason}${file ? `(画面写真 ${path.basename(file)})` : ''}` }
  }

  // ── 最後に、外への通信の試みと画面のエラーを所見にする(途中で止まっても出す)。
  const browserStep = newStep('ブラウザの記録(外への通信・画面のエラー)')
  for (const host of [...new Set(session.externalRequests)]) {
    browserStep.findings.push({ level: 'stop', code: 'external-request', message: `手元のサーバー以外への通信を試みた: ${host}(${session.externalRequests.filter((item) => item === host).length} 回)` })
  }
  for (const message of [...new Set(session.pageErrors)]) {
    browserStep.findings.push({ level: 'stop', code: 'page-error', message: `画面でエラーが出た: ${message}` })
  }
  browserStep.notes.push(`読み取り ${Math.round(timings.read / 100) / 10} 秒・保証台帳の洗い出し ${Math.round(timings.audit / 100) / 10} 秒`)
  const filtered = app.applyKnownIssues(browserStep.findings, known, { classroomId, step: 'browser' })
  report = addStep({ ...report, knownCount: report.knownCount + filtered.knownCount }, { name: 'browser', title: browserStep.title, durationMs: 0, operations: 0, findings: filtered.findings, notes: browserStep.notes })
  return report
}
