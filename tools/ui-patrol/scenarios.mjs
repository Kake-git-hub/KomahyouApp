// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5「台本(第 1 段)」)の台本。
// 教室ごとに 起動 → (c) 保存→読み込み直し → (b) 生徒の移動 → (e) 出欠 → (f) 講師の移動・入れ替え・休み → (a) テンプレ保存 → (d) テンプレを実際に変えて保存
// (→ (g) 休日設定と解除・丸ごと振替〔既定では流さない・--scenario で挙げたときだけ〕)の順で、室長と同じ画面操作をし、
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

// ── 台本 e(出欠・2026-11-11 第 2 段の 2 本目)。盤面の生徒メニューの「休み」「振無休」「出席」と、未消化振替の一覧から振替先へ置く。
// 出欠の処理の入口は生徒メニュー(ScheduleBoardScreen.tsx の handleMarkStudentAbsent → markStudentAbsentAt〔保護者の休み連絡の四択と同じ 1 本〕・
// handleMarkStudentAbsentNoMakeup → markStudentAbsentNoMakeupAt・handleMarkStudentAttended)。振替先は 未消化振替 → 生徒 → 振替元 → 空欄の席
// (handleSelectMakeupStockEntry → handlePlaceMakeupFromStock)。室長がふだん使う道。

/** 台本 e の操作の並び(この順に流す)。振替先を決める は、最初の「通常・休み」で増えた振替を別のコマへ置く。 */
export const ATTENDANCE_SLOTS = [
  { name: 'regular-absent', kind: 'mark', status: 'absent', lessonType: 'regular', label: '通常・休み' },
  { name: 'makeup-place', kind: 'place', label: '振替先を決める(休みで増えた振替を別のコマへ置く)' },
  { name: 'regular-absent-no-makeup', kind: 'mark', status: 'absent-no-makeup', lessonType: 'regular', label: '通常・振無休' },
  { name: 'regular-attended', kind: 'mark', status: 'attended', lessonType: 'regular', label: '通常・出席' },
  { name: 'makeup-absent', kind: 'mark', status: 'absent', lessonType: 'makeup', label: '振替・休み' },
  { name: 'special-attended', kind: 'mark', status: 'attended', lessonType: 'special', label: '講習・出席' },
]

/**
 * 出欠の操作で、操作した机のほかに変わってよい部分(boardFacts.ts の BOARD_FACT_SECTIONS の名前)。根拠(ScheduleBoardScreen.tsx):
 * - 休み(markStudentAbsentAt → computeStudentAbsentMark): 振替の台帳 manualMakeupAdjustments に振替元を積む・suppressedMakeupOrigins の抑止を外す・
 *   名簿外の生徒は fallbackMakeupStudents・通常授業の抑止キー suppressedRegularLessonOccurrences を積む(commitWeeks へ渡す ledgers)。
 *   講習の休みは在庫(講習)の台帳を変えるが、台本 e は講習の休みを選ばない(講習は出席だけ)ので入れない。
 * - 振無休・出席(markStudentAbsentNoMakeupAt・handleMarkStudentAttended): 抑止キーだけ。上書きで消える前の出欠記録の台帳への確定(Issue #57)は
 *   記録のある机を選ばないので起きない(起きたら「変」に出る)。
 * - 振替先へ置く(handlePlaceMakeupFromStock): commitWeeks へ盤面だけを渡す。出席不可コマへ置く確認(onApplyReopenedSlots)は specialSessions を変えるが、
 *   台本 b と同じく範囲に入れない(起きたらダイアログの文つきで「変」に出し、人が見る)。
 * 回数の調整(scheduleCountAdjustments)はどの操作も渡さない(変わったら「変」)。
 */
export const ATTENDANCE_ALLOWED_SECTIONS = {
  absent: ['boardState.manualMakeupAdjustments', 'boardState.suppressedMakeupOrigins', 'boardState.fallbackMakeupStudents', 'boardState.suppressedRegularLessonOccurrences'],
  'absent-no-makeup': ['boardState.suppressedRegularLessonOccurrences'],
  attended: ['boardState.suppressedRegularLessonOccurrences'],
  place: [],
}

const attendanceDeskKey = (op) => (op.kind === 'place' ? `${op.to.cellId}#${op.to.deskIndex}` : `${op.seat.cellId}#${op.seat.deskIndex}`)

/** 出欠の操作で変わってよい範囲: 操作した机(休み・振無休・出席はその生徒の席の机、振替先へ置くは先の机)と ATTENDANCE_ALLOWED_SECTIONS。 */
export function buildAttendanceAllowedChange(op) {
  return { deskKeys: new Set([attendanceDeskKey(op)]), sections: new Set(ATTENDANCE_ALLOWED_SECTIONS[op.kind === 'place' ? 'place' : op.status] ?? []) }
}

/**
 * 在庫の仕様の増減(INV-06・鍵は 生徒キー__科目＝buildMakeupStockKey)。書いていない鍵はすべて ±0。
 * 休み(通常・振替)= 未消化振替 +1(通常は振替元を台帳へ積む・振替は消化が外れて元の振替元が戻る)／振無休・出席 = ±0／振替先へ置く = −1。
 * 講習の休みは選ばない(講習の在庫を戻すかは講習の期間で変わる・shouldReturnLectureStockOnAbsence)ので、未消化講習はどの操作も ±0。
 */
export function expectedStockDeltas(op) {
  const key = `${op.studentKey}__${op.subject}`
  if (op.kind === 'place') return { makeup: { [key]: -1 }, lecture: {} }
  if (op.status === 'absent' && op.lessonType !== 'special') return { makeup: { [key]: 1 }, lecture: {} }
  return { makeup: {}, lecture: {} }
}

function normalizePayloadWeeks(payload) {
  const weeks = Array.isArray(payload?.boardState?.weeks) ? payload.boardState.weeks : []
  return weeks.map((week) => (Array.isArray(week) ? week : Array.isArray(week?.cells) ? week.cells : []))
}

/**
 * 在庫の数え方が通常と違う生徒の席(`${cellId}#${deskIndex}/${seat}`)。手動追加(manualAdded)・編集で振替にした／通常から変えた
 * (editedToMakeup・editedFromRegular)の生徒は、未消化振替の消化に数えない・在庫へ戻せないなど別の決まり(makeupStock.ts の collectMakeupUsageByKey・
 * isStockNeutralEditedMakeup)なので、台本 e の「休み=+1」などの決まった増減では確かめられない。台本 e はこの席を選ばない(boardFacts.ts の生徒の事実は
 * この印を持たないので、教室データから集める)。
 */
export function collectStockIneligibleSeatKeys(payload) {
  const keys = new Set()
  for (const week of normalizePayloadWeeks(payload)) {
    for (const boardCell of week) {
      if (!boardCell || typeof boardCell.id !== 'string' || !Array.isArray(boardCell.desks)) continue
      boardCell.desks.forEach((boardDesk, deskIndex) => {
        const slots = Array.isArray(boardDesk?.lesson?.studentSlots) ? boardDesk.lesson.studentSlots : []
        slots.forEach((entry, seat) => {
          if (entry && (entry.manualAdded || entry.editedToMakeup || entry.editedFromRegular)) keys.add(`${boardCell.id}#${deskIndex}/${seat}`)
        })
      })
    }
  }
  return keys
}

/**
 * 台本 e の操作を選ぶ(ATTENDANCE_SLOTS の順に 1 つずつ・種つきの乱数)。対象＝その週で今日以降の開いている日のコマの生徒で、
 * 本物の講師がいて、講師の休み・保留・出欠記録・メモの無い机(生徒の移動の候補選び pickMoveCandidates と同じ考え。記録のある机は上書きの確定〔Issue #57〕が
 * 混ざるので選ばない)。名簿に結べない生徒(鍵が name:)と excludeSeatKeys(collectStockIneligibleSeatKeys)の席は選ばない。
 * 操作ごとに別の机・別の生徒。振替先＝最初の「通常・休み」の生徒が居ない別のコマの、同じ条件の机の空いた席。
 * 候補の無い操作は飛ばし、skipped に理由(「通常・休み」が無ければ振替先も飛ばす)。
 */
export function pickAttendancePlan(facts, { weekDateKeys, todayKey, seed, excludeSeatKeys = new Set() }) {
  const week = new Set(weekDateKeys)
  const desks = [...facts.desks.values()].filter((desk) => week.has(desk.dateKey) && desk.dateKey >= todayKey && desk.cellOpen).sort(comparePosition)
  const keysByCell = new Map()
  for (const desk of desks) {
    const keys = keysByCell.get(desk.cellId) ?? new Set()
    for (const entry of [...desk.students, ...desk.pendingStudents]) if (entry) keys.add(entry.key)
    for (const record of [...desk.statuses, ...desk.pendingStatuses]) keys.add(record.split('|')[0])
    keysByCell.set(desk.cellId, keys)
  }
  const usable = (desk) => desk.teacher !== '' && !desk.teacherRest && !isPendingDesk(desk) && !desk.pendingRecorded && desk.statuses.length === 0 && desk.memos.length === 0
  const random = createSeededRandom(seed)
  const usedDesks = new Set()
  const usedStudents = new Set()
  // 休み・振無休・出席を先に選び、振替先はそのあとに残った机から選ぶ(振替先が生徒の机の空いた席を取って、出欠の候補を減らさないように)。
  const chosen = new Map()
  for (const slot of ATTENDANCE_SLOTS) {
    if (slot.kind !== 'mark') continue
    const sources = []
    for (const desk of desks) {
      if (!usable(desk) || usedDesks.has(desk.key)) continue
      desk.students.forEach((entry, seat) => {
        if (!entry || entry.lessonType !== slot.lessonType || entry.key.startsWith('name:') || usedStudents.has(entry.key) || excludeSeatKeys.has(`${desk.key}/${seat}`)) return
        sources.push({ desk, seat, entry })
      })
    }
    if (sources.length === 0) continue
    const { desk, seat, entry } = sources[Math.floor(random() * sources.length)]
    usedDesks.add(desk.key)
    usedStudents.add(entry.key)
    chosen.set(slot.name, {
      slot: slot.name, kind: 'mark', label: slot.label, status: slot.status,
      seat: { cellId: desk.cellId, deskIndex: desk.deskIndex, seat },
      studentKey: entry.key, studentName: entry.name, subject: entry.subject, lessonType: entry.lessonType, dateKey: desk.dateKey, slotNumber: desk.slotNumber,
    })
  }
  const absentOp = chosen.get('regular-absent') ?? null
  const placeSlot = ATTENDANCE_SLOTS.find((slot) => slot.kind === 'place')
  if (absentOp) {
    const options = []
    for (const desk of desks) {
      if (!usable(desk) || usedDesks.has(desk.key) || desk.cellId === absentOp.seat.cellId || keysByCell.get(desk.cellId)?.has(absentOp.studentKey)) continue
      desk.students.forEach((entry, seat) => { if (entry === null) options.push({ desk, seat }) })
    }
    if (options.length > 0) {
      const target = options[Math.floor(random() * options.length)]
      usedDesks.add(target.desk.key)
      chosen.set(placeSlot.name, {
        slot: placeSlot.name, kind: 'place', label: placeSlot.label,
        to: { cellId: target.desk.cellId, deskIndex: target.desk.deskIndex, seat: target.seat },
        studentKey: absentOp.studentKey, studentName: absentOp.studentName, subject: absentOp.subject,
        sourceDateKey: absentOp.dateKey, sourceSlotNumber: absentOp.slotNumber, dateKey: target.desk.dateKey, slotNumber: target.desk.slotNumber,
      })
    }
  }
  const ops = []
  const skipped = []
  for (const slot of ATTENDANCE_SLOTS) {
    const op = chosen.get(slot.name)
    if (op) ops.push(op)
    else if (slot.kind === 'place') skipped.push(`${slot.label}: ${absentOp ? '休みにした生徒を置ける空いた席(別のコマ・本物の講師)が無い' : '「通常・休み」の候補が無いので飛ばした'}`)
    else skipped.push(`${slot.label}: 候補の生徒が無い`)
  }
  return { ops, skipped }
}

/**
 * 未消化振替の振替元の一覧(画面の行の文字)から、置く振替元を選ぶ。label(stock.ts の findMakeupOriginLabel)と科目の両方を含む行を先に、
 * 無ければ科目だけ合う行。見つからなければ -1。
 */
export function chooseMakeupOriginItem(items, { subject, label }) {
  const exact = label ? items.findIndex((text) => text.includes(label) && text.includes(subject)) : -1
  return exact >= 0 ? exact : items.findIndex((text) => text.includes(subject))
}

function describeAttendanceOp(op) {
  const person = `${op.studentName}(${op.studentKey})`
  if (op.kind === 'place') return `${op.label}: ${person} ${op.subject}(元 ${op.sourceDateKey} ${op.sourceSlotNumber}限の休み)→ ${describeSeat(op.to)}`
  return `${op.label}: ${describeSeat(op.seat)} ${person} ${op.subject}`
}

// ── 台本 f(講師の移動・入れ替え・休み・2026-11-11 第 2 段の 3 本目)。盤面の講師欄の長押しドラッグ(同じコマの中だけ)・講師メニュー
// (講師を選んで「保存」・「休み」／「休みを解除する(講師名)」)。入口は ScheduleBoardScreen.tsx の handleTeacherMouseDown → computeTeacherMove
// (生徒が絡むと「講師だけ入れ替え／生徒ごと席を入れ替え」を選ぶ画面 → executePendingTeacherMove)・handleConfirmTeacher → setManualTeacherAssignment・
// handleToggleTeacherRest → computeToggleDeskTeacherRest。§9-25(休みの講師を同じコマへ手で置いたらそのコマの休みを全部消す)は releaseTeacherRestInCellIfSameTeacherPlaced。

/** 台本 f の操作の並び(この順に流す)。休みの流れは 休み → 代わりの講師 → 休みの講師を別の机へ手で置く → 元に戻す の 4 手順。 */
export const TEACHER_OPS = [
  { name: 'move', label: '講師の移動(講師の居ない机へ・長押しドラッグ)' },
  { name: 'teacher-swap', label: '講師だけ入替(長押しドラッグ)' },
  { name: 'seat-swap', label: '生徒ごと席入替(長押しドラッグ)' },
  { name: 'menu-teacher', label: '講師メニューで講師を替える' },
  { name: 'rest-flow', label: '講師の休み → 代わりの講師 → 休みの講師を同じコマの別の机へ手で置く(§9-25) → 元に戻す' },
  { name: 'rest-toggle', label: '講師の休み → 同じボタンで解除' },
]

/** ドラッグで休みの講師を置く形を作らない理由(要件は「できればもう 1 か所はドラッグ」・報告の注に出す)。 */
export const TEACHER_REST_DRAG_NOTE = '休みの講師を置くのは講師メニューだけ: ドラッグは同じコマの机に居る講師しか掴めず、休みにした講師はそのコマのどの机にも居ないので、ドラッグで休みの講師を同じコマへ置く形は画面で作れない。'

/**
 * 台本 f の操作を選ぶ(種つきの乱数・操作ごとに別のコマ)。対象＝その週で今日以降の開いている日のコマで、保留の机・休みの記録・講師の削除記録の机が 1 つも無いコマ
 * (前からある保留・休みと混ざらないように)。講師の机＝本物の講師がいて出欠記録の無い机(記録のある机は上書きの確定〔Issue #57〕が混ざる・台本 e の机も避ける)。
 * 空き机＝講師も生徒も出欠記録もメモも無い机。
 * - 講師の移動・休みの流れ: 講師の机＋空き机のあるコマ(休みの流れは生徒のいる講師の机を優先＝「生徒は残る」を確かめる)。
 * - 講師だけ入替・生徒ごと席入替: 講師の机が 2 つ以上で、どちらかに生徒がいるコマ(生徒が絡むと選ぶ画面が出る)。
 * - 講師メニューで替える・休みと解除: 講師の机のあるコマ。
 * 空き机が要る操作から先に選ぶ(残りのコマを取り合わないように)。候補の無い操作は飛ばし、skipped に理由。
 */
export function pickTeacherPlan(facts, { weekDateKeys, todayKey, seed }) {
  const week = new Set(weekDateKeys)
  const byCell = new Map()
  for (const desk of [...facts.desks.values()].filter((item) => week.has(item.dateKey) && item.dateKey >= todayKey && item.cellOpen).sort(comparePosition)) {
    const list = byCell.get(desk.cellId) ?? []
    list.push(desk)
    byCell.set(desk.cellId, list)
  }
  const cells = [...byCell.entries()]
    .filter(([, desks]) => desks.every((desk) => !isPendingDesk(desk) && !desk.pendingRecorded && !desk.teacherRest && !desk.teacherDeleted))
    .map(([cellId, desks]) => ({ cellId, desks }))
  const hasStudents = (desk) => desk.students.some(Boolean)
  const teacherDesks = (entry) => entry.desks.filter((desk) => desk.teacher !== '' && desk.statuses.length === 0)
  const emptyDesks = (entry) => entry.desks.filter((desk) => desk.teacher === '' && !hasStudents(desk) && desk.statuses.length === 0 && desk.memos.length === 0)
  const random = createSeededRandom(seed)
  const pickOne = (list) => list[Math.floor(random() * list.length)]
  const usedCells = new Set()
  const chosen = new Map()
  const base = (desk, label, name) => ({ name, label, cellId: desk.cellId, dateKey: desk.dateKey, slotNumber: desk.slotNumber, deskIndex: desk.deskIndex, teacher: desk.teacher })
  const pickFor = (name) => {
    const label = TEACHER_OPS.find((op) => op.name === name).label
    const options = []
    for (const entry of cells) {
      if (usedCells.has(entry.cellId)) continue
      const sources = teacherDesks(entry)
      if (name === 'move' || name === 'rest-flow') {
        const empties = emptyDesks(entry)
        if (empties.length === 0) continue
        const withStudents = sources.filter(hasStudents)
        for (const source of name === 'rest-flow' && withStudents.length > 0 ? withStudents : sources) for (const target of empties) options.push({ source, target })
      } else if (name === 'teacher-swap' || name === 'seat-swap') {
        for (const source of sources) for (const target of sources) {
          if (source.deskIndex >= target.deskIndex || !(hasStudents(source) || hasStudents(target))) continue
          // 生徒ごと席入替は中身が違う 2 机だけ(同じなら講師だけ入替と見分けが付かない)。
          if (name === 'seat-swap' && JSON.stringify([source.students, source.memos]) === JSON.stringify([target.students, target.memos])) continue
          options.push({ source, target })
        }
      } else {
        for (const source of sources) options.push({ source, target: null })
      }
    }
    if (options.length === 0) return
    const { source, target } = pickOne(options)
    usedCells.add(source.cellId)
    chosen.set(name, { ...base(source, label, name), ...(target ? { targetDeskIndex: target.deskIndex, targetTeacher: target.teacher } : {}) })
  }
  for (const name of ['rest-flow', 'move', 'teacher-swap', 'seat-swap', 'menu-teacher', 'rest-toggle']) pickFor(name)
  const ops = []
  const skipped = []
  for (const { name, label } of TEACHER_OPS) {
    const op = chosen.get(name)
    if (op) ops.push(op)
    else skipped.push(`${label}: ${name === 'move' || name === 'rest-flow' ? '講師の机と空き机のある別のコマが無い' : name.endsWith('swap') ? '講師が 2 人以上いて生徒のいる別のコマが無い' : '講師の机のある別のコマが無い'}`)
  }
  return { ops, skipped }
}

/** 講師の操作で変わってよい範囲: 操作した机(入れ替え・移動は 2 机)。部分は無し(講師の操作は commitWeeks へ今の台帳をそのまま渡す)。 */
export function buildTeacherOpAllowedChange(op, extraDeskKeys = []) {
  const keys = [`${op.cellId}#${op.deskIndex}`]
  if (op.targetDeskIndex !== undefined) keys.push(`${op.cellId}#${op.targetDeskIndex}`)
  return { deskKeys: new Set([...keys, ...extraDeskKeys]), sections: new Set() }
}

/**
 * 同じコマ(cellId)で、置いた講師 placed({ teacher, teacherId })の休みの記録が消えただけの机(講師・講師の出自・中身は前と同じ)。
 * 休みの講師を同じコマへ手で置いたとき(§9-25)に変わってよい机。照合はアプリの doesTeacherRestMatch(facts.restMatchesTeacher)。
 * 別の講師の休みの記録が消えた机・休みの記録のほかに何か変わった机は入れない(範囲の外として「変」に出る)。
 */
export function collectRestReleasedDeskKeys(before, after, cellId, placed) {
  const keys = new Set()
  for (const desk of before.desks.values()) {
    if (desk.cellId !== cellId || !desk.teacherRest || !desk.teacherRestRecord) continue
    if (!placed || !before.restMatchesTeacher(desk.teacherRestRecord, placed)) continue
    const next = after.desks.get(desk.key)
    if (!next || next.teacherRest) continue
    const same = JSON.stringify([desk.teacher, desk.teacherOrigin, desk.students, desk.statuses, desk.memos, desk.pendingStudents, desk.pendingTeacher, desk.pendingStatuses, desk.pendingMemos])
      === JSON.stringify([next.teacher, next.teacherOrigin, next.students, next.statuses, next.memos, next.pendingStudents, next.pendingTeacher, next.pendingStatuses, next.pendingMemos])
    if (same) keys.add(desk.key)
  }
  return keys
}

/**
 * その講師(講師メニューの選択肢の名前)がそのコマに居るか(講師欄・保留の下段・休みの記録)。講師メニューで「そのコマに居ない講師」を選ぶのに使う。
 * 照合はアプリの権威関数(facts.isSameTeacher＝isSameTeacherRecord・facts.restMatchesTeacher＝doesTeacherRestMatch・呼び名の対応表)。
 */
export function isTeacherInCell(facts, cellId, teacherName) {
  const target = { teacher: teacherName }
  for (const desk of facts.desks.values()) {
    if (desk.cellId !== cellId) continue
    if (desk.teacher && facts.isSameTeacher({ teacher: desk.teacher, teacherId: desk.teacherId || undefined }, target)) return true
    if (desk.pendingTeacher && facts.isSameTeacher({ teacher: desk.pendingTeacher }, target)) return true
    if (desk.teacherRestRecord && facts.restMatchesTeacher(desk.teacherRestRecord, target)) return true
  }
  return false
}

// ── 台本 g(休日設定と解除・丸ごと振替〔作成と解除〕・2026-11-11 第 2 段の 4 本目・既定では流さない)。盤面の日付の見出しを押して出るメニュー
// 「休日設定」「丸ごと振替」「丸ごと振替を解除」と、休日の見出しを押す(解除)・丸ごと振替の振替先の見出しを押す。入口は ScheduleBoardScreen.tsx の
// handleDayHeaderClick → handleToggleHolidayDate(休日にする・解除は逆操作〔computeHolidayReleaseRestoration〕)・handleWholeDayTransferTargetClick →
// handleWholeDayTransferPairTarget(付け替えの組 WHOLE_DAY_PAIR__・同じ曜日だけ・在庫中立)・handleReleaseWholeDayTransferPair(§9-20 作成→解除で元の形)。
// 日付の選び方・休日設定の在庫の仕様の増減は tools/ui-patrol/dayOps.ts(束ねた app)。

/**
 * 休日設定で、その日の机のほかに変わってよい部分。根拠(handleToggleHolidayDate の休日にする側の commitWeeks):
 * - classroomSettings.other: 休日の日付(holidayDates)・定休日を開けた日(forceOpenDates)。
 * - 在庫の台帳: reconcileHolidayDeskStockReturns の ledgers(manualMakeupAdjustments・fallbackMakeupStudents・manualLectureStockCounts・
 *   manualLectureStockOrigins・fallbackLectureStockStudents)と、科目だけ編集したテンプレの授業の自動発生を重ねない suppressedMakeupOrigins
 *   (collectHolidayTemplateSubjectSuppressions)。
 * 入れていないもの: 抑止キー(suppressedRegularLessonOccurrences)・回数の調整(scheduleCountAdjustments)・保留(templatePendingDesks)。休日にする側は渡さない。
 */
export const HOLIDAY_ALLOWED_SECTIONS = [
  'classroomSettings.other',
  'boardState.manualMakeupAdjustments',
  'boardState.suppressedMakeupOrigins',
  'boardState.fallbackMakeupStudents',
  'boardState.manualLectureStockCounts',
  'boardState.manualLectureStockOrigins',
  'boardState.fallbackLectureStockStudents',
]

/**
 * 休日の解除で変わってよい部分: 休日設定と同じ(台帳を控えどおり巻き戻す)＋抑止キー(resolveHolidayReleaseSuppressedOccurrences が、席へ戻せなかった
 * 通常授業がテンプレから湧き直さないよう積み、席へ戻した授業の鍵は外す)。保留(下段へ戻す・決定記録 48)は机の事実に入るので部分には足さない。
 * ★解除のあとは、休日にする前の盤面・在庫と全部同じか(作成→解除)を別に確かめる(round-trip-not-restored)。ここは操作 1 回の範囲だけ。
 */
export const HOLIDAY_RELEASE_ALLOWED_SECTIONS = [...HOLIDAY_ALLOWED_SECTIONS, 'boardState.suppressedRegularLessonOccurrences']

/**
 * 丸ごと振替(付け替え)の作成と解除で、振替元 D・振替先 D' の机のほかに変わってよい部分。根拠(handleWholeDayTransferPairTarget・
 * handleReleaseWholeDayTransferPair の commitWeeks は盤面・抑止キー・保留だけを渡す): 組の鍵 WHOLE_DAY_PAIR__D__D'__0 と、差分反映が積む抑止キー
 * (settleWholeDayTransferPairDates の addedSuppressedRegularLessonOccurrences)。保留は D・D' の机の事実に入る。在庫の台帳は渡さない(在庫中立)。
 * ほかの日の机を範囲に入れない理由: 組を当てるのは D と D' のコマだけ(settleWholeDayTransferPairDates が日付で絞る)で、その日を振替元に持つ
 * 「休)」の作り直し(settleWholeDayPairBlockedRecords)も組の振替元の日だけを触る。台本は前から組のある日・その日を含む抑止キーのある日を選ばない。
 */
export const WHOLE_DAY_TRANSFER_ALLOWED_SECTIONS = ['boardState.suppressedRegularLessonOccurrences']

/** dateKey(YYYY-MM-DD)の週の月曜(盤面の週は月曜から)。 */
export function mondayOf(dateKey) {
  const time = Date.parse(`${dateKey}T00:00:00Z`)
  const offset = (new Date(time).getUTCDay() + 6) % 7
  return new Date(time - offset * 86400000).toISOString().slice(0, 10)
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

const SECTION_DIFF_LIMIT = 40
/** 差分ファイルの値 1 つの大きさの上限(テンプレのように大きい値は長さだけ残す)。 */
const SECTION_VALUE_CHAR_LIMIT = 2000
const clipValue = (value) => {
  const text = JSON.stringify(value)
  return text !== undefined && text.length > SECTION_VALUE_CHAR_LIMIT ? { clipped: true, length: text.length } : value
}

/**
 * 部分(boardFacts.ts の sections の署名＝キーを並べ替えた JSON)の違いを、人が読める形にする。配列は増えた・減った要素(数で突き合わせる)、
 * オブジェクトは値の違う鍵の前と後。40 件まで(越えた数は more)。署名が JSON でなければ前と後の文字列の長さだけ。
 */
export function summarizeSectionDiff(beforeSignature, afterSignature) {
  let left
  let right
  try {
    left = JSON.parse(beforeSignature)
    right = JSON.parse(afterSignature)
  } catch {
    return { beforeLength: String(beforeSignature).length, afterLength: String(afterSignature).length }
  }
  if (Array.isArray(left) || Array.isArray(right) || left === null || right === null) {
    if ((left === null || Array.isArray(left)) && (right === null || Array.isArray(right))) {
      const counts = new Map()
      for (const item of left ?? []) { const key = JSON.stringify(item); counts.set(key, (counts.get(key) ?? 0) + 1) }
      const added = []
      for (const item of right ?? []) {
        const key = JSON.stringify(item)
        const count = counts.get(key) ?? 0
        if (count > 0) counts.set(key, count - 1)
        else added.push(item)
      }
      const removed = [...counts.entries()].flatMap(([key, count]) => Array.from({ length: count }, () => JSON.parse(key)))
      const total = added.length + removed.length
      const result = { added: added.slice(0, SECTION_DIFF_LIMIT).map(clipValue), removed: removed.slice(0, Math.max(0, SECTION_DIFF_LIMIT - Math.min(added.length, SECTION_DIFF_LIMIT))).map(clipValue) }
      if (total > SECTION_DIFF_LIMIT) result.more = total - SECTION_DIFF_LIMIT
      return result
    }
  }
  const changed = {}
  let total = 0
  for (const key of [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort()) {
    const beforeValue = left?.[key] ?? null
    const afterValue = right?.[key] ?? null
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue
    total += 1
    if (total <= SECTION_DIFF_LIMIT) changed[key] = { before: clipValue(beforeValue), after: clipValue(afterValue) }
  }
  return total > SECTION_DIFF_LIMIT ? { changed, more: total - SECTION_DIFF_LIMIT } : { changed }
}

/**
 * stop の所見が指すコマ(日付×時限)の、操作の前後の机の事実と、前後で違う部分(sections・summarizeSectionDiff)をファイルに残す
 * (人が画面写真と突き合わせて見立てるため)。中身は伏せ字のあとの仮名と ID だけ(出力先はスクラッチ領域)。コマは 40 まで。
 */
function writeStopDiff(file, stops, before, after) {
  const cells = [...new Set(stops.filter((finding) => finding.dateKey && finding.slotNumber !== undefined).map((finding) => `${finding.dateKey}_${finding.slotNumber}`))].slice(0, 40)
  const sections = Object.fromEntries(Object.keys({ ...before.sections, ...after.sections })
    .filter((name) => (before.sections[name] ?? 'null') !== (after.sections[name] ?? 'null'))
    .map((name) => [name, summarizeSectionDiff(before.sections[name] ?? 'null', after.sections[name] ?? 'null')]))
  if (cells.length === 0 && Object.keys(sections).length === 0) return null
  const pick = (facts, cellId) => [...facts.desks.values()].filter((desk) => desk.cellId === cellId).map((desk) => {
    // メモの中身は出さず件数だけ(伏せ字で「メモ」になっているが二重の守り)。出欠記録の文字列は生徒キー・状態・科目・種類だけなのでそのまま。
    const { memos, pendingMemos } = desk
    const rest = Object.fromEntries(Object.entries(desk).filter(([key]) => !['signature', 'memos', 'pendingMemos'].includes(key)))
    return { ...rest, memoCount: memos.length, pendingMemoCount: pendingMemos.length }
  })
  try {
    writeFileSync(file, JSON.stringify({ findings: stops, cells: cells.map((cellId) => ({ cellId, before: pick(before, cellId), after: pick(after, cellId) })), sections }, null, 1))
    return file
  } catch {
    return null
  }
}

/**
 * テンプレ保存(台本 a と d)の点検の組み合わせ。両方の台本がここを通す(数え方を 2 つ作らない)。
 * 出欠記録のあるコマに生徒を置き直していないか(§2-4・checkAttendanceRecordsHold)も見る(台本 e が先に付けた記録が対象になる)。
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
    // 台本 e(出欠)が先に流れていれば、出欠記録のあるコマに生徒を置き直さないか(§2-4 記録が勝つ)もここで見える。
    ...app.checkAttendanceRecordsHold(before.facts, after.facts, { fromDateKey }),
    // 講師のコマの形(どの台本のあとでも): 休みの講師をテンプレが置かない・手で置いた講師がテンプレで 2 机にならない(§9-25・INV-01)。
    ...app.checkTeacherCellIntegrity(before.facts, after.facts),
    ...app.checkAuditNotWorse(audit(before), audit(after)),
    ...app.checkPendingCountMatchesPreview(before.facts, after.facts, confirmMessage, { fromDateKey }),
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
    ...app.checkTeacherCellIntegrity(before.facts, moved.facts),
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
  const scenarios = options.scenarios ?? ['boot', 'c', 'b', 'e', 'f', 'a', 'd']
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
  const timings = { audit: 0, read: 0, stock: 0 }
  const timedAudit = (state) => { const started = Date.now(); const result = auditOf(state); timings.audit += Date.now() - started; return result }
  // 在庫(未消化振替・未消化講習)の残。状態にためて使い回す(台本 e・tools/ui-patrol/stock.ts)。
  const stockOf = (state) => {
    if (!state.stock) {
      const started = Date.now()
      state.stock = app.collectStockBalances(state.payload, today)
      timings.stock += Date.now() - started
    }
    return state.stock
  }
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
        // 前からある講師のコマの形(種データにある休みの講師・2 机の講師)は知らせるだけ。開いたときに新しくできたら「変」。
        ...app.checkTeacherCellIntegrity(before.facts, current.facts, { reportExisting: true }),
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

    // ── (e) 出欠: 生徒メニューで 休み・振無休・出席、未消化振替から振替先へ置く(ATTENDANCE_SLOTS の順・1 回ずつ)。a の前に流す
    // (付けた出欠記録のコマに、a のテンプレ保存が生徒を置き直さないか〔§2-4〕も a の点検で見える)。最初の休みで 元に戻す・やり直し を確かめる。
    // 最後に 保存→読み込み直し。付けた記録・置いた振替は戻さない(a・d はこの盤面から流れる)。
    if (scenarios.includes('e')) {
      lastScenario = 'e'
      const searchedWeeks = []
      let plan = { ops: [], skipped: [] }
      let weekStart = null
      for (const monday of weekStartsFrom(nextMonday)) {
        searchedWeeks.push(monday)
        await d.gotoWeekOf(session, monday)
        current = await timedRead()
        plan = pickAttendancePlan(current.facts, {
          weekDateKeys: weekDateKeysFrom(monday), todayKey: today, seed: (Number(options.seed) || 0) + 0xe5, excludeSeatKeys: collectStockIneligibleSeatKeys(current.payload),
        })
        if (plan.ops.length > 0) {
          weekStart = monday
          break
        }
      }
      const prepStep = newStep(`出欠の準備(${weekStart ?? nextMonday} の週)`)
      if (weekStart) prepStep.notes.push(`使った週: ${weekStart} の週${weekStart !== nextMonday ? `(${searchedWeeks.slice(0, -1).join('・')} の週は開いても候補が無かった)` : ''}`)
      else prepStep.notes.push(`出欠を付けられる生徒が見つかりませんでした(開いた週: ${searchedWeeks.join('・')})。`)
      prepStep.notes.push(`操作 ${plan.ops.length} 個(${plan.ops.map((op) => op.label.split('(')[0]).join('・') || 'なし'})`)
      for (const reason of plan.skipped) prepStep.notes.push(`飛ばした: ${reason}`)
      await finish('e', prepStep)

      let effectiveOps = 0
      let absentApplied = false
      const recordedCells = []
      for (const [index, op] of plan.ops.entries()) {
        const step = newStep(`出欠 ${index + 1}(${op.label.split('(')[0]})`)
        const before = current
        step.notes.push(describeAttendanceOp(op))
        if (op.kind === 'place' && !absentApplied) {
          step.notes.push('飛ばした: 先の「通常・休み」が効いていないので、置く振替がありません。')
          await finish('e', step)
          continue
        }
        const dialogsBefore = session.dialogs.length
        const statusBefore = await d.readStatusText(session)
        let status = ''
        if (op.kind === 'place') {
          const label = app.findMakeupOriginLabel(stockOf(before), `${op.studentKey}__${op.subject}`, op.sourceDateKey, op.sourceSlotNumber)
          const result = await d.placeMakeupFromStock(session, { stockStudentKey: op.studentKey, choose: (items) => chooseMakeupOriginItem(items, { subject: op.subject, label }) }, op.to)
          status = result.status ?? ''
          if (result.chosenText) step.notes.push(`選んだ振替元: ${result.chosenText}${label && !result.chosenText.includes(label) ? `(休みにしたコマ ${label} の行が無く、同じ科目の行を選んだ)` : ''}`)
          if (!result.placed) {
            // 休みで増えたはずの振替が、未消化振替の一覧から選べない(室長は置けない)。
            step.findings.push({ level: 'stop', code: 'attendance-not-applied', message: `休みで増えた振替を未消化振替の一覧から選べない: ${op.studentName}(${op.studentKey}) ${op.subject}(${result.reason ?? '一覧に無い'})`, studentId: op.studentKey })
            await finish('e', step)
            continue
          }
        } else {
          status = await d.markStudentAttendance(session, op.seat, op.status)
        }
        step.operations += 1
        step.notes.push(`ステータス: ${status}`)
        for (const dialog of session.dialogs.slice(dialogsBefore)) step.notes.push(`ダイアログ: ${dialog}`)
        const after = await timedRead()
        const diff = app.diffBoardFacts(before.facts, after.facts)
        if (diff.desks.length === 0 && diff.sections.length === 0) {
          if (status === statusBefore) {
            await finish('e', step)
            throw new PatrolAbortError(`出欠を付けても盤面もステータスの文も変わらず、何も起きません: ${describeAttendanceOp(op)}`)
          }
          step.findings.push({ level: 'info', code: 'attendance-blocked', message: `アプリが出欠の操作を断った: ${describeAttendanceOp(op)}(${status})`, studentId: op.studentKey })
          await finish('e', step)
          continue
        }
        effectiveOps += 1
        if (op.slot === 'regular-absent') absentApplied = true
        if (op.kind === 'mark') recordedCells.push(op.seat.cellId)
        step.diff = { before: before.facts, after: after.facts }
        const allowed = buildAttendanceAllowedChange(op)
        const exclude = { excludeDeskKeys: allowed.deskKeys }
        step.findings.push(
          ...app.checkOutsideAllowedRange(before.facts, after.facts, allowed),
          ...app.checkManualStudentsKeepTeacher(before.facts, after.facts, exclude),
          ...app.checkTeacherlessStudentsNotAdded(before.facts, after.facts, exclude),
          ...app.checkManualInputsNotLost(before.facts, after.facts, exclude),
          ...app.checkTeacherCellIntegrity(before.facts, after.facts),
          ...app.checkAuditNotWorse(timedAudit(before), timedAudit(after)),
          ...app.checkAttendanceApplied(before.facts, after.facts, op),
          ...app.checkStockDeltas(stockOf(before), stockOf(after), expectedStockDeltas(op)),
        )
        current = after
        // 最初の「通常・休み」だけ: 元に戻す → 操作の前と同じ(盤面と在庫)→ やり直し → 操作のあとと同じ。
        if (op.slot === 'regular-absent') {
          if (!(await d.clickUndo(session))) {
            step.findings.push({ level: 'stop', code: 'undo-not-restored', message: `出欠のあと元に戻すが押せない(ボタンが無効): ${describeAttendanceOp(op)}`, studentId: op.studentKey })
          } else {
            step.operations += 1
            const undone = await timedRead()
            step.findings.push(...sameState(before, undone, 'undo-not-restored'), ...app.checkStockDeltas(stockOf(before), stockOf(undone), {}, { code: 'undo-not-restored', label: '元に戻すで在庫が操作前に戻らない' }))
            if (await d.clickRedo(session)) {
              step.operations += 1
              const redone = await timedRead()
              step.findings.push(...sameState(after, redone, 'redo-not-restored'), ...app.checkStockDeltas(stockOf(after), stockOf(redone), {}, { code: 'redo-not-restored', label: 'やり直しで在庫が操作後に戻らない' }))
              current = redone
            } else {
              step.findings.push({ level: 'stop', code: 'redo-not-restored', message: `出欠を元に戻したあとやり直しが押せない(ボタンが無効): ${describeAttendanceOp(op)}`, studentId: op.studentKey })
              current = undone
              absentApplied = false
            }
          }
        }
        await finish('e', step)
      }
      // 効いた操作が 1 回も無い台本 e は、中身が無いまま緑になる。台本 e を指定しているなら中断(台本 b・d と同じ扱い)。
      if (effectiveOps === 0) throw new PatrolAbortError('台本 e で効いた出欠の操作が 1 回もありません(候補が無い・全部断られた)。')

      const persistStep = newStep('出欠のあと 保存→読み込み直し')
      if (recordedCells.length > 0) persistStep.notes.push(`出欠記録を付けたコマ ${recordedCells.length} か所(${[...new Set(recordedCells)].join('・')})。台本 a・d のテンプレ保存(反映日 ${nextMonday})がこのコマに生徒を置き直さないか(§2-4)も見る。`)
      if (await d.clickSave(session)) persistStep.operations += 1
      else persistStep.notes.push('保存ボタンは既に clean で押せませんでした(ローカルモードは変更の 5 秒後に自分で保存する)。')
      const saved = await timedRead()
      persistStep.findings.push(...sameState(current, saved, 'save-changed'), ...app.checkStockDeltas(stockOf(current), stockOf(saved), {}, { code: 'save-changed', label: '保存で在庫が変わった' }))
      await d.reloadApp(session)
      persistStep.operations += 1
      const reloaded = await timedRead()
      persistStep.findings.push(...sameState(saved, reloaded, 'reload-changed'), ...app.checkStockDeltas(stockOf(saved), stockOf(reloaded), {}, { code: 'reload-changed', label: '読み込み直しで在庫が変わった' }))
      current = reloaded
      await finish('e', persistStep)
    }

    // ── (f) 講師の移動・入れ替え・休み: 講師欄の長押しドラッグ(移動・講師だけ入替・生徒ごと席入替)・講師メニュー(替える・休み・解除)と、
    // 休みの流れ(休み → 代わりの講師 → 休みの講師を同じコマの別の机へ手で置く〔§9-25〕→ 元に戻す)。TEACHER_OPS の順に 1 回ずつ・別々のコマ。
    // a の前に流す(手で置いた講師・休みの講師を a・d のテンプレ保存がどう扱うかも a・d の点検で見える)。最後に 保存→読み込み直し。
    if (scenarios.includes('f')) {
      lastScenario = 'f'
      const searchedWeeks = []
      let plan = { ops: [], skipped: [] }
      let weekStart = null
      for (const monday of weekStartsFrom(nextMonday)) {
        searchedWeeks.push(monday)
        await d.gotoWeekOf(session, monday)
        current = await timedRead()
        plan = pickTeacherPlan(current.facts, { weekDateKeys: weekDateKeysFrom(monday), todayKey: today, seed: (Number(options.seed) || 0) + 0xf6 })
        if (plan.ops.length > 0) {
          weekStart = monday
          break
        }
      }
      const prepStep = newStep(`講師の操作の準備(${weekStart ?? nextMonday} の週)`)
      if (weekStart) prepStep.notes.push(`使った週: ${weekStart} の週${weekStart !== nextMonday ? `(${searchedWeeks.slice(0, -1).join('・')} の週は開いても候補が無かった)` : ''}`)
      else prepStep.notes.push(`講師を動かせる机が見つかりませんでした(開いた週: ${searchedWeeks.join('・')})。`)
      prepStep.notes.push(`操作 ${plan.ops.length} 個(${plan.ops.map((op) => op.label.split('(')[0]).join('・') || 'なし'})`)
      for (const reason of plan.skipped) prepStep.notes.push(`飛ばした: ${reason}`)
      prepStep.notes.push(TEACHER_REST_DRAG_NOTE)
      await finish('f', prepStep)

      const teacherIdOf = (name) => (name ? (app.resolveTeacherIdByDisplayName?.(current.payload?.teachers, name) || 'ID なし') : '')
      const who = (name) => (name ? `${name}(${teacherIdOf(name)})` : '講師なし')
      const at = (cellId, deskIndex) => `${cellId} 机${deskIndex + 1}`
      // 講師の操作を 1 回: 画面で押す → 読む → 点検(範囲・講師のコマの形・中身・在庫・保証台帳)。戻り値 { outcome: 'applied' | 'blocked' | 'nothing', after }。
      const runTeacherOp = async (step, op, press) => {
        const before = current
        const dialogsBefore = session.dialogs.length
        const statusBefore = await d.readStatusText(session)
        const pressed = await press()
        if (pressed.skip) {
          step.notes.push(`飛ばした: ${pressed.skip}`)
          return { outcome: 'skipped', after: before }
        }
        step.operations += 1
        step.notes.push(`ステータス: ${pressed.status ?? ''}`)
        for (const dialog of session.dialogs.slice(dialogsBefore)) step.notes.push(`ダイアログ: ${dialog}`)
        const after = await timedRead()
        const diff = app.diffBoardFacts(before.facts, after.facts)
        if (diff.desks.length === 0 && diff.sections.length === 0) {
          if ((pressed.status ?? '') === statusBefore) {
            await finish('f', step)
            throw new PatrolAbortError(`講師の操作をしても盤面もステータスの文も変わらず、何も起きません: ${step.title}`)
          }
          step.findings.push({ level: 'info', code: 'teacher-op-blocked', message: `アプリが講師の操作を断った: ${step.title}(${pressed.status ?? ''})` })
          return { outcome: 'blocked', after }
        }
        step.diff = { before: before.facts, after: after.facts }
        const placedDesk = op.kind === 'place-rested' ? after.facts.desks.get(`${op.cellId}#${op.deskIndex}`) : null
        const released = placedDesk ? [...collectRestReleasedDeskKeys(before.facts, after.facts, op.cellId, { teacher: placedDesk.teacher || op.teacher, teacherId: placedDesk.teacherId || undefined })] : []
        const allowed = buildTeacherOpAllowedChange(op, released)
        const exclude = { excludeDeskKeys: allowed.deskKeys }
        step.findings.push(
          ...app.checkOutsideAllowedRange(before.facts, after.facts, allowed),
          ...app.checkManualStudentsKeepTeacher(before.facts, after.facts, exclude),
          ...app.checkTeacherlessStudentsNotAdded(before.facts, after.facts, exclude),
          ...app.checkManualInputsNotLost(before.facts, after.facts, exclude),
          ...app.checkTeacherCellIntegrity(before.facts, after.facts),
          ...app.checkTeacherOpApplied(before.facts, after.facts, op),
          ...app.checkStockDeltas(stockOf(before), stockOf(after), {}, { label: '講師の操作で在庫が変わった' }),
          ...app.checkAuditNotWorse(timedAudit(before), timedAudit(after)),
        )
        current = after
        return { outcome: 'applied', after }
      }
      const menuRandom = createSeededRandom((Number(options.seed) || 0) + 0xf7)
      // 講師メニューの選択肢から、そのコマに居ない講師(講師欄・保留の下段・休みの記録)を種つきの乱数で選ぶ。無ければ null(その操作は飛ばす)。
      // 今の講師・休みの講師もそのコマに居る扱いなので、ここで別に外さない(照合を 2 つ作らない)。
      const pickMenuTeacher = (cellId) => (choices) => {
        const options = choices.filter((choice) => choice.value && !isTeacherInCell(current.facts, cellId, choice.value))
        return options.length > 0 ? options[Math.floor(menuRandom() * options.length)].value : null
      }
      let effectiveOps = 0
      for (const [index, planned] of plan.ops.entries()) {
        const label = planned.label.split('(')[0]
        if (planned.name === 'move' || planned.name === 'teacher-swap' || planned.name === 'seat-swap') {
          const swapMode = planned.name === 'seat-swap' ? 'seat' : 'teacher'
          const step = newStep(`講師 ${index + 1}(${label})`)
          step.notes.push(`${planned.label}: ${at(planned.cellId, planned.deskIndex)} ${who(planned.teacher)} → ${at(planned.cellId, planned.targetDeskIndex)} ${who(planned.targetTeacher)}`)
          const op = { kind: planned.name, cellId: planned.cellId, deskIndex: planned.deskIndex, targetDeskIndex: planned.targetDeskIndex }
          const result = await runTeacherOp(step, op, async () => {
            const dragged = await d.dragTeacher(session, { cellId: planned.cellId, deskIndex: planned.deskIndex }, { cellId: planned.cellId, deskIndex: planned.targetDeskIndex }, swapMode)
            step.notes.push(dragged.modal ? `選ぶ画面: ${swapMode === 'seat' ? '生徒ごと席を入れ替え' : '講師だけ入れ替え'} を押した` : '選ぶ画面は出なかった(どちらの机にも生徒がいない)')
            return dragged
          })
          if (result.outcome === 'applied') effectiveOps += 1
          await finish('f', step)
          continue
        }
        if (planned.name === 'menu-teacher') {
          const step = newStep(`講師 ${index + 1}(${label})`)
          const op = { kind: 'menu-teacher', cellId: planned.cellId, deskIndex: planned.deskIndex }
          const result = await runTeacherOp(step, op, async () => {
            const set = await d.setBoardTeacher(session, { cellId: planned.cellId, deskIndex: planned.deskIndex }, pickMenuTeacher(planned.cellId))
            if (!set.teacher) return { skip: `${at(planned.cellId, planned.deskIndex)} で選べる講師(そのコマに居ない講師)が講師メニューにありません。` }
            op.teacher = set.teacher
            step.notes.push(`${planned.label}: ${at(planned.cellId, planned.deskIndex)} ${who(planned.teacher)} → ${who(set.teacher)}`)
            return set
          })
          if (result.outcome === 'applied') effectiveOps += 1
          await finish('f', step)
          continue
        }
        if (planned.name === 'rest-toggle') {
          const step = newStep(`講師 ${index + 1}(${label})`)
          step.notes.push(`${planned.label}: ${at(planned.cellId, planned.deskIndex)} ${who(planned.teacher)}`)
          const rest = await runTeacherOp(step, { kind: 'rest', cellId: planned.cellId, deskIndex: planned.deskIndex }, () => d.toggleTeacherRest(session, { cellId: planned.cellId, deskIndex: planned.deskIndex }))
          if (rest.outcome === 'applied') {
            effectiveOps += 1
            // 解除で盤面が前に保存した形へ戻ると、ローカルモードは自動保存を飛ばし、編集のたびの控え(IndexedDB)に休みの形が残って
            // 読み込み直しで休みが戻る(本番は起動時にサーバーを読むので起きない・2026-11-11 の実走で分かった)。先に保存してから解除する。
            if (await d.clickSave(session)) step.operations += 1
            const release = await runTeacherOp(step, { kind: 'release', cellId: planned.cellId, deskIndex: planned.deskIndex }, async () => {
              const toggled = await d.toggleTeacherRest(session, { cellId: planned.cellId, deskIndex: planned.deskIndex })
              if (toggled.label) step.notes.push(`2 回目のボタン: ${toggled.label}`)
              return toggled
            })
            if (release.outcome === 'applied') step.notes.push(`休みを解除した(記録が消えた。講師欄: ${who(current.facts.desks.get(`${planned.cellId}#${planned.deskIndex}`)?.teacher ?? '')}・解除のあとの再マージでテンプレの講師が戻るのは仕様どおり・§2-4)。`)
          }
          await finish('f', step)
          continue
        }
        // 休みの流れ(rest-flow): 1) 休み 2) 代わりの講師 Y 3) 休みの講師 X を同じコマの空き机へ講師メニューで置く 4) 元に戻す。
        const X = planned.teacher
        const restStep = newStep(`講師 ${index + 1}(休みの流れ 1: 講師の休み)`)
        restStep.notes.push(`休み: ${at(planned.cellId, planned.deskIndex)} ${who(X)}(机の生徒は残る)`)
        const rested = await runTeacherOp(restStep, { kind: 'rest', cellId: planned.cellId, deskIndex: planned.deskIndex }, () => d.toggleTeacherRest(session, { cellId: planned.cellId, deskIndex: planned.deskIndex }))
        await finish('f', restStep)
        if (rested.outcome !== 'applied') continue
        effectiveOps += 1
        const restedDesk = current.facts.desks.get(`${planned.cellId}#${planned.deskIndex}`)
        const restedName = restedDesk?.teacherRestName || X
        const restRecord = restedDesk?.teacherRestRecord ?? { teacher: X }
        const subStep = newStep(`講師 ${index + 1}(休みの流れ 2: 休みの机に代わりの講師を置く)`)
        const subOp = { kind: 'menu-teacher', cellId: planned.cellId, deskIndex: planned.deskIndex }
        const substituted = await runTeacherOp(subStep, subOp, async () => {
          const set = await d.setBoardTeacher(session, { cellId: planned.cellId, deskIndex: planned.deskIndex }, pickMenuTeacher(planned.cellId))
          if (!set.teacher) return { skip: `${at(planned.cellId, planned.deskIndex)} で代わりに置ける講師(そのコマに居ない講師)が講師メニューにありません。` }
          subOp.teacher = set.teacher
          subStep.notes.push(`代わりの講師: ${at(planned.cellId, planned.deskIndex)} ${who(set.teacher)}(休み ${who(X)} の記録は残る・§2-4)`)
          return set
        })
        await finish('f', subStep)
        if (substituted.outcome !== 'applied') continue
        const baseBeforePlace = current
        const placeStep = newStep(`講師 ${index + 1}(休みの流れ 3: 休みの講師を同じコマの別の机へ手で置く・§9-25)`)
        const placeOp = { kind: 'place-rested', cellId: planned.cellId, deskIndex: planned.targetDeskIndex, teacher: X, restedName }
        const placed = await runTeacherOp(placeStep, placeOp, async () => {
          const set = await d.setBoardTeacher(session, { cellId: planned.cellId, deskIndex: planned.targetDeskIndex }, (choices) => (choices.find((choice) => choice.value && current.facts.restMatchesTeacher(restRecord, { teacher: choice.value }))?.value ?? null))
          if (!set.teacher) return { skip: `${at(planned.cellId, planned.targetDeskIndex)} の講師メニューに休みの講師 ${who(X)} がありません。` }
          placeOp.teacher = set.teacher
          placeStep.notes.push(`休みの講師を置く: ${at(planned.cellId, planned.targetDeskIndex)} ← ${who(X)}(代わりの講師 ${who(subOp.teacher)} と ${at(planned.cellId, planned.deskIndex)} の生徒はそのまま)`)
          return set
        })
        if (placed.outcome === 'applied') {
          // 元に戻す 1 回で、X の配置と休みの記録が戻る(代わりの講師を置いたあとと同じ)。前に保存した形へ戻る操作なので、先に保存する(解除と同じ理由)。
          if (await d.clickSave(session)) placeStep.operations += 1
          if (await d.clickUndo(session)) {
            placeStep.operations += 1
            const undone = await timedRead()
            placeStep.findings.push(...sameState(baseBeforePlace, undone, 'undo-not-restored'))
            current = undone
            placeStep.notes.push('元に戻す: 休みの講師の配置と休みの記録が戻るかを確かめた。')
          } else {
            placeStep.findings.push({ level: 'stop', code: 'undo-not-restored', message: `休みの講師を置いたあと元に戻すが押せない(ボタンが無効): ${at(planned.cellId, planned.targetDeskIndex)} ${X}` })
          }
        }
        await finish('f', placeStep)
      }
      // 効いた操作が 1 回も無い台本 f は、中身が無いまま緑になる。台本 f を指定しているなら中断(台本 b・d・e と同じ扱い)。
      if (effectiveOps === 0) throw new PatrolAbortError('台本 f で効いた講師の操作が 1 回もありません(候補が無い・全部断られた)。')

      const persistStep = newStep('講師の操作のあと 保存→読み込み直し')
      if (await d.clickSave(session)) persistStep.operations += 1
      else persistStep.notes.push('保存ボタンは既に clean で押せませんでした(ローカルモードは変更の 5 秒後に自分で保存する)。')
      const saved = await timedRead()
      persistStep.findings.push(...sameState(current, saved, 'save-changed'))
      await d.reloadApp(session)
      persistStep.operations += 1
      const reloaded = await timedRead()
      persistStep.findings.push(...sameState(saved, reloaded, 'reload-changed'), ...app.checkTeacherCellIntegrity(saved.facts, reloaded.facts))
      persistStep.diff = { before: saved.facts, after: reloaded.facts }
      current = reloaded
      await finish('f', persistStep)
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
          // 確かめる日のコマに既に居る講師へ替えると「新しい講師が居る」が素通りするので、居ない講師が選べなければこの種類は飛ばす(レビュー M-2)。
          const { teacher } = await d.templateChangeTeacher(session, position, (choices) => app.pickTemplateEditOption({
            options: choices, exclude: new Set([desk.teacher]), random, prefer: (value) => !presence.teachers.has(value), requirePreferred: true,
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
          step.notes.push(`飛ばした(${TEMPLATE_EDIT_LABELS[kind]}): ${describeTemplateDesk(desk)} で選べる${kind === 'add-student' ? '生徒' : '講師(確かめる日のコマに居ない講師)'}が画面にありません。`)
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
          ...app.checkTemplateEditApplied(before.facts, after.facts, edit, {
            isStudentActiveOnDate,
            // 保存の前からある削除記録だけ(この保存が自分で積んだ抑止キーで「置かない」を説明させない)。
            suppressedOccurrences: before.payload?.boardState?.suppressedRegularLessonOccurrences ?? [],
          }),
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

    // ── (g) 休日設定と解除・丸ごと振替〔作成と解除〕(既定では流さない・--scenario で挙げたときだけ)。来週から 4 週を開き、今日より後の日から
    // 種つきの乱数で選ぶ(dayOps.ts の pickDayOpsPlan)。作ったものは解除して元の形へ戻すので最後に流す。
    // 休日: メニュー「休日設定」→ 在庫が仕様どおり戻る → 元に戻す・やり直し → 保存→読み込み直し → 休日の見出しを押して解除 → 休日にする前と同じ。
    // 丸ごと振替: メニュー「丸ごと振替」→ 振替先(同じ曜日)の見出し → 在庫 ±0 → 保存→読み込み直し → メニュー「丸ごと振替を解除」→ 作成の前と同じ。
    // ★ローカルモードの控えの罠(台本 f と同じ): 前に保存した形へ戻る操作(元に戻す・やり直し・解除)の前に保存ボタンを押す。
    if (scenarios.includes('g')) {
      lastScenario = 'g'
      const openedWeeks = weekStartsFrom(nextMonday)
      for (const monday of openedWeeks) await d.gotoWeekOf(session, monday)
      current = await timedRead()
      const plan = app.pickDayOpsPlan({
        facts: current.facts, payload: current.payload, dateKeys: openedWeeks.flatMap((monday) => weekDateKeysFrom(monday)), todayKey: today,
        random: createSeededRandom((Number(options.seed) || 0) + 0x9a),
      })
      const prepStep = newStep(`日付の操作の準備(${openedWeeks[0]}〜の 4 週)`)
      prepStep.notes.push(`開いた週: ${openedWeeks.join('・')}`)
      if (plan.holiday) prepStep.notes.push(`休日にする日: ${plan.holiday.dateKey}(席の生徒 ${plan.holiday.studentCount} 人)`)
      if (plan.transfer) prepStep.notes.push(`丸ごと振替: 振替元 ${plan.transfer.sourceDateKey}(席の生徒 ${plan.transfer.studentCount} 人)→ 振替先の候補 ${plan.transfer.targetDateKeys.join('・')}(近い順・断られたら次)`)
      for (const reason of plan.skipped) prepStep.notes.push(`飛ばした: ${reason}`)
      await finish('g', prepStep)

      const ineligibleSeatKeys = collectStockIneligibleSeatKeys(current.payload)
      // 日付の操作を 1 回: 押す → 読む。盤面が変わらなければ、アプリが断った(文が変わった・断りの画面)か何も起きない(中断)。
      const runDayOp = async (step, label, press) => {
        const before = current
        const dialogsBefore = session.dialogs.length
        const statusBefore = await d.readStatusText(session)
        const pressed = await press()
        if (pressed.missing) {
          step.notes.push(`飛ばした: ${label}(メニューにボタンが無い・ステータス: ${pressed.status ?? ''})`)
          return { outcome: 'missing', before, after: before }
        }
        step.operations += 1
        step.notes.push(`ステータス: ${pressed.status ?? ''}`)
        for (const dialog of session.dialogs.slice(dialogsBefore)) step.notes.push(`ダイアログ: ${dialog}`)
        if (pressed.blocked) step.notes.push(`断りの画面: ${pressed.blocked}`)
        const after = await timedRead()
        const diff = app.diffBoardFacts(before.facts, after.facts)
        if (diff.desks.length === 0 && diff.sections.length === 0) {
          if (!pressed.blocked && (pressed.status ?? '') === statusBefore) {
            await finish('g', step)
            throw new PatrolAbortError(`${label}をしても盤面もステータスの文も変わらず、何も起きません。`)
          }
          step.findings.push({ level: 'info', code: 'day-op-blocked', message: `アプリが日付の操作を断った: ${label}(${pressed.blocked || pressed.status || ''})` })
          return { outcome: 'blocked', before, after }
        }
        step.diff = { before: before.facts, after: after.facts }
        return { outcome: 'applied', before, after }
      }
      // 日付の操作のあとに毎回当てる点検(範囲・手入力・講師のコマの形・保証台帳)。exclude は操作した日の机。
      const dayOpFindings = (before, after, dateKeys, sections, { restedPresentAsInfo = false } = {}) => {
        const allowed = { deskKeys: app.collectDateDeskKeys([before.facts, after.facts], dateKeys), sections: new Set(sections) }
        const exclude = { excludeDeskKeys: allowed.deskKeys }
        return [
          ...app.checkOutsideAllowedRange(before.facts, after.facts, allowed),
          ...app.checkManualStudentsKeepTeacher(before.facts, after.facts, exclude),
          ...app.checkTeacherlessStudentsNotAdded(before.facts, after.facts, exclude),
          ...app.checkManualInputsNotLost(before.facts, after.facts, exclude),
          ...app.checkTeacherCellIntegrity(before.facts, after.facts, { restedPresentAsInfo }),
          ...app.checkAuditNotWorse(timedAudit(before), timedAudit(after)),
        ]
      }
      // 保存 → 読み込み直し で盤面と在庫が変わらない(作った休日・丸ごと振替の組が保存を通って残るか)。
      const persist = async (title, { restedPresentAsInfo = false } = {}) => {
        const step = newStep(title)
        if (await d.clickSave(session)) step.operations += 1
        else step.notes.push('保存ボタンは既に clean で押せませんでした(ローカルモードは変更の 5 秒後に自分で保存する)。')
        const saved = await timedRead()
        step.findings.push(...sameState(current, saved, 'save-changed'), ...app.checkStockDeltas(stockOf(current), stockOf(saved), {}, { code: 'save-changed', label: '保存で在庫が変わった' }))
        await d.reloadApp(session)
        step.operations += 1
        const reloaded = await timedRead()
        step.findings.push(
          ...sameState(saved, reloaded, 'reload-changed'),
          ...app.checkStockDeltas(stockOf(saved), stockOf(reloaded), {}, { code: 'reload-changed', label: '読み込み直しで在庫が変わった' }),
          ...app.checkTeacherCellIntegrity(saved.facts, reloaded.facts, { restedPresentAsInfo }),
        )
        step.diff = { before: saved.facts, after: reloaded.facts }
        current = reloaded
        await finish('g', step)
      }
      // 解除のあと、作る前(base)と盤面・部分・在庫が全部同じか(休日解除は逆操作・§9-20 作成→解除で元の形)。
      // 休日は、休日にした日のメモが消えて戻らないのだけ仕様なので知らせるだけ(checkHolidayRoundTrip)。
      const roundTripFindings = (base, after, what, holidayDateKey = null) => [
        ...(holidayDateKey ? app.checkHolidayRoundTrip(base.facts, after.facts, holidayDateKey) : sameState(base, after, 'round-trip-not-restored')),
        ...app.checkStockDeltas(stockOf(base), stockOf(after), {}, { code: 'round-trip-not-restored', label: `${what}を解除しても在庫が元に戻らない` }),
      ]
      let effectiveOps = 0

      if (plan.holiday) {
        const H = plan.holiday.dateKey
        await d.gotoWeekOf(session, mondayOf(H))
        const base = current
        const step = newStep(`休日設定(${H})`)
        step.notes.push(`休日にする: ${H}(席の生徒 ${plan.holiday.studentCount} 人・授業はすべて未消化へ)`)
        const set = await runDayOp(step, `${H} を休日にする`, () => d.chooseDayMenuItem(session, H, 'holiday'))
        let holidayActive = false
        if (set.outcome === 'applied') {
          effectiveOps += 1
          holidayActive = true
          const { before, after } = set
          const stockPlan = app.expectedHolidayStockDeltas(before.facts, H, ineligibleSeatKeys)
          step.notes.push(`在庫: 比べた鍵 ${stockPlan.checkedCount}(未消化振替 +1)・比べない鍵 ${stockPlan.ignore.makeup.size + stockPlan.ignore.lecturePrefixes.length}(講習・手動追加・編集で振替・同じ日に同じ科目 2 つ など。ほかの鍵は ±0)`)
          step.findings.push(
            ...dayOpFindings(before, after, [H], HOLIDAY_ALLOWED_SECTIONS),
            ...app.checkHolidayApplied(before.facts, after.facts, H),
            ...app.checkStockDeltas(stockOf(before), stockOf(after), stockPlan.expected, { ignore: stockPlan.ignore, label: '休日設定で在庫の増減が仕様と違う' }),
          )
          current = after
          // 元に戻す → やり直し(1 か所だけ)。どちらも前に保存した形へ戻りうるので、先に保存する(ローカルモードの控えの罠)。
          if (await d.clickSave(session)) step.operations += 1
          if (await d.clickUndo(session)) {
            step.operations += 1
            const undone = await timedRead()
            step.findings.push(...sameState(before, undone, 'undo-not-restored'), ...app.checkStockDeltas(stockOf(before), stockOf(undone), {}, { code: 'undo-not-restored', label: '元に戻すで在庫が休日にする前に戻らない' }))
            current = undone
            step.notes.push('元に戻す: 休日にする前の盤面・在庫に戻るかを確かめた。')
            if (await d.clickSave(session)) step.operations += 1
            if (await d.clickRedo(session)) {
              step.operations += 1
              step.notes.push('やり直し: 休日にしたあとの盤面・在庫に戻るかを確かめた。')
              const redone = await timedRead()
              step.findings.push(...sameState(after, redone, 'redo-not-restored'), ...app.checkStockDeltas(stockOf(after), stockOf(redone), {}, { code: 'redo-not-restored', label: 'やり直しで在庫が休日のあとに戻らない' }))
              current = redone
            } else {
              step.findings.push({ level: 'stop', code: 'redo-not-restored', message: `休日設定を元に戻したあとやり直しが押せない(ボタンが無効): ${H}` })
              holidayActive = false
            }
          } else {
            step.findings.push({ level: 'stop', code: 'undo-not-restored', message: `休日設定のあと元に戻すが押せない(ボタンが無効): ${H}` })
          }
        }
        await finish('g', step)
        if (holidayActive) {
          await persist(`休日設定のあと 保存→読み込み直し(${H})`)
          await d.gotoWeekOf(session, mondayOf(H))
          const releaseStep = newStep(`休日を解除(${H})`)
          releaseStep.notes.push(`休日の見出しを押して解除: ${H}(休日にする前の盤面・在庫に戻るかを確かめる)`)
          const released = await runDayOp(releaseStep, `${H} の休日を解除する`, () => d.clickDayHeader(session, H))
          if (released.outcome === 'applied') {
            releaseStep.findings.push(
              ...dayOpFindings(released.before, released.after, [H], HOLIDAY_RELEASE_ALLOWED_SECTIONS),
              ...roundTripFindings(base, released.after, '休日', H),
            )
            releaseStep.diff = { before: base.facts, after: released.after.facts }
            current = released.after
          } else if (released.outcome === 'blocked') {
            releaseStep.findings.push({ level: 'stop', code: 'round-trip-not-restored', message: `休日を解除できない(アプリが断った): ${H}` })
          }
          await finish('g', releaseStep)
        }
      }

      if (plan.transfer) {
        const D = plan.transfer.sourceDateKey
        const base = current
        const step = newStep(`丸ごと振替(振替元 ${D})`)
        let applied = null
        for (const T of plan.transfer.targetDateKeys) {
          await d.gotoWeekOf(session, mondayOf(D))
          const started = await d.chooseDayMenuItem(session, D, 'transfer')
          if (started.missing) {
            step.notes.push(`飛ばした: ${D} のメニューに「丸ごと振替」がありません。`)
            break
          }
          step.operations += 1
          if (started.blocked) {
            step.findings.push({ level: 'info', code: 'day-op-blocked', message: `アプリが丸ごと振替を断った(振替元 ${D}): ${started.blocked}` })
            break
          }
          await d.gotoWeekOf(session, mondayOf(T))
          step.notes.push(`丸ごと振替: ${D} → ${T}(同じ曜日)`)
          const result = await runDayOp(step, `${D} → ${T} の丸ごと振替`, () => d.clickDayHeader(session, T))
          if (result.outcome === 'applied') {
            applied = { T, ...result }
            break
          }
          // 断られた(振替先の手入力・机の数など)。選ぶ状態を取り消して次の振替先を試す。
          if (await d.cancelWholeDayTransfer(session)) step.operations += 1
        }
        if (applied) {
          effectiveOps += 1
          const { T, before, after } = applied
          step.findings.push(
            ...dayOpFindings(before, after, [D, T], WHOLE_DAY_TRANSFER_ALLOWED_SECTIONS, { restedPresentAsInfo: true }),
            ...app.checkWholeDayTransferApplied(before.facts, after.facts, { sourceDateKey: D, targetDateKey: T }),
            ...app.checkStockDeltas(stockOf(before), stockOf(after), {}, { label: '丸ごと振替で在庫が動いた(移送は在庫中立)' }),
          )
          current = after
          await finish('g', step)
          await persist(`丸ごと振替のあと 保存→読み込み直し(${D} → ${T})`, { restedPresentAsInfo: true })
          await d.gotoWeekOf(session, mondayOf(T))
          const releaseStep = newStep(`丸ごと振替を解除(${D} → ${T})`)
          releaseStep.notes.push(`メニュー「丸ごと振替を解除」: ${T}(作成の前の盤面・在庫に戻るかを確かめる・§9-20)`)
          const released = await runDayOp(releaseStep, `${D} → ${T} の丸ごと振替を解除する`, () => d.chooseDayMenuItem(session, T, 'transfer-release'))
          if (released.outcome === 'applied') {
            releaseStep.findings.push(
              ...dayOpFindings(released.before, released.after, [D, T], WHOLE_DAY_TRANSFER_ALLOWED_SECTIONS, { restedPresentAsInfo: true }),
              ...roundTripFindings(base, released.after, '丸ごと振替'),
            )
            releaseStep.diff = { before: base.facts, after: released.after.facts }
            current = released.after
          } else {
            releaseStep.findings.push({ level: 'stop', code: 'round-trip-not-restored', message: `丸ごと振替を解除できない(${released.outcome === 'missing' ? 'メニューに「丸ごと振替を解除」が無い' : 'アプリが断った'}): ${D} → ${T}` })
          }
          await finish('g', releaseStep)
        } else {
          step.notes.push('丸ごと振替は、どの振替先でもできませんでした(上の理由)。')
          await finish('g', step)
        }
      }
      // 効いた操作が 1 回も無い台本 g は、中身が無いまま緑になる。台本 g を指定しているなら中断(台本 b・d・e・f と同じ扱い)。
      if (effectiveOps === 0) throw new PatrolAbortError('台本 g で効いた日付の操作が 1 回もありません(候補が無い・全部断られた)。')
      await persist('日付の操作のあと 保存→読み込み直し')
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
  browserStep.notes.push(`読み取り ${Math.round(timings.read / 100) / 10} 秒・保証台帳の洗い出し ${Math.round(timings.audit / 100) / 10} 秒${timings.stock > 0 ? `・在庫の数え ${Math.round(timings.stock / 100) / 10} 秒` : ''}`)
  const filtered = app.applyKnownIssues(browserStep.findings, known, { classroomId, step: 'browser' })
  report = addStep({ ...report, knownCount: report.knownCount + filtered.knownCount }, { name: 'browser', title: browserStep.title, durationMs: 0, operations: 0, findings: filtered.findings, notes: browserStep.notes })
  return report
}
