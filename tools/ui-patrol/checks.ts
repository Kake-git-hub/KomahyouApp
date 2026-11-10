// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5「操作のたびの点検」)の点検。
// 操作の前後の盤面の事実(boardFacts.ts)を比べ、「変なこと」(stop)と「知らせるだけのこと」(info)を所見にする。
//
// ★きっかけの事故(2026-11-10): テンプレを保存したら、手入力の振替の生徒が講師の机から講師のいない机へ移った。
//   画面のつなぎ方の取り違えはユニットテストでは見えないので、操作の結果を意味で比べて止める(checkManualStudentsKeepTeacher・
//   checkTeacherlessStudentsNotAdded)。
// ★所見の message は日本語 1 行。場所は「11/19(木) 3限 机5」、人は仮名(伏せ字のあとの名前)と生徒 ID だけ。
// ★純関数。入力を書き換えない。ネットワークにもファイルにも触れない。
import type { InvAuditFinding, InvAuditResult } from '../invAuditEntry'
import { diffBoardFacts, type BoardFacts, type DeskChange, type DeskChangeField, type DeskFact, type StudentFact } from './boardFacts'

export const PATROL_FINDING_CODES = [
  'outside-allowed-range', 'manual-student-teacher-changed', 'manual-student-teacher-changed-announced', 'manual-student-lost',
  'manual-student-to-pending', 'teacherless-student-added', 'manual-input-lost', 'inv-new-violation', 'inv-new-check',
  'undo-not-restored', 'redo-not-restored', 'save-changed', 'reload-changed', 'pending-count-mismatch',
  'external-request', 'page-error', 'move-not-applied', 'move-blocked', 'change-summary',
] as const
export type PatrolFindingCode = (typeof PATROL_FINDING_CODES)[number]
export type PatrolFinding = { level: 'stop' | 'info'; code: PatrolFindingCode; message: string; dateKey?: string; slotNumber?: number; deskIndex?: number; studentId?: string }
export type AllowedChange = { deskKeys?: ReadonlySet<string>; fromDateKey?: string; sections?: ReadonlySet<string> }
export type KnownPatrolIssue = { code?: string; classroomId?: string; step?: string; dateKey?: string; slotNumber?: number; studentId?: string; note?: string }

/** 机の所見を 1 件ずつ出す上限。越えた分は「ほか n 机」の 1 件にまとめる(数千机が変わったときに報告が読めなくなるため)。 */
const DESK_FINDING_LIMIT = 20

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const FIELD_LABELS: Record<DeskChangeField, string> = { teacher: '講師', students: '生徒', statuses: '出欠記録', memos: 'メモ', pending: '保留の下段' }
const LESSON_TYPE_LABELS: Record<string, string> = { regular: '通常', makeup: '振替', special: '講習', trial: '体験', extra: '増コマ' }
const STATUS_LABELS: Record<string, string> = { absent: '休み', 'absent-no-makeup': '振無休', attended: '出席', moved: '移動', holiday: '休)' }

/** 「11/19(木) 3限 机5」。曜日は日付から計算する(JST の日付として読む)。 */
function formatPlace(dateKey: string, slotNumber: number, deskIndex?: number): string {
  const [, month, day] = dateKey.split('-')
  const date = new Date(`${dateKey}T00:00:00`)
  const weekday = Number.isNaN(date.getTime()) ? '?' : WEEKDAY_LABELS[date.getDay()]
  const datePart = month && day ? `${Number(month)}/${Number(day)}(${weekday})` : `${dateKey}(${weekday})`
  return `${datePart} ${slotNumber}限${deskIndex === undefined ? '' : ` 机${deskIndex + 1}`}`
}

const placeOf = (fact: DeskFact) => formatPlace(fact.dateKey, fact.slotNumber, fact.deskIndex)
const locationOf = (fact: DeskFact) => ({ dateKey: fact.dateKey, slotNumber: fact.slotNumber, deskIndex: fact.deskIndex })
/** 名簿に結べない生徒の key は 'name:' + 仮名。ID としては「ID なし」と書く。 */
const studentIdText = (key: string) => (key.startsWith('name:') ? 'ID なし' : key)
const personOf = (student: StudentFact) => `${student.name}(${studentIdText(student.key)})`
const lessonOf = (student: StudentFact) => `${student.subject} ${LESSON_TYPE_LABELS[student.lessonType] ?? student.lessonType}`
const teacherText = (teacher: string) => teacher || '講師なし'
/** 同じ生徒の同じ授業か(机番号・講師・出自は見ない)。 */
const lessonIdentity = (student: StudentFact) => `${student.key}\u0000${student.subject}\u0000${student.lessonType}`

function groupByCell(facts: BoardFacts): Map<string, DeskFact[]> {
  const result = new Map<string, DeskFact[]>()
  for (const fact of facts.desks.values()) {
    const list = result.get(fact.cellId) ?? []
    list.push(fact)
    result.set(fact.cellId, list)
  }
  return result
}

/** 机の所見を先頭 20 件＋「ほか n 机」にまとめる。 */
function limitDeskFindings(findings: PatrolFinding[], level: PatrolFinding['level'], code: PatrolFindingCode, label: string): PatrolFinding[] {
  if (findings.length <= DESK_FINDING_LIMIT) return findings
  return [...findings.slice(0, DESK_FINDING_LIMIT), { level, code, message: `${label}: ほか ${findings.length - DESK_FINDING_LIMIT} 机` }]
}

function describeDeskChange(change: DeskChange): string {
  const fact = (change.after ?? change.before)!
  const fields = change.fields.map((field) => FIELD_LABELS[field]).join('・')
  const teacherPart = change.fields.includes('teacher') ? ` 講師 ${teacherText(change.before?.teacher ?? '')} → ${teacherText(change.after?.teacher ?? '')}` : ''
  return `${placeOf(fact)}（${fields}）${teacherPart}`
}

export function checkOutsideAllowedRange(before: BoardFacts, after: BoardFacts, allowed: AllowedChange): PatrolFinding[] {
  const diff = diffBoardFacts(before, after)
  const label = '変わってよい範囲の外の机が変わった'
  const deskFindings: PatrolFinding[] = []
  for (const change of diff.desks) {
    const fact = (change.after ?? change.before)!
    if (allowed.deskKeys?.has(change.key)) continue
    // 反映日以降は変わってよい(テンプレ保存の反映日など)。日付は YYYY-MM-DD の文字列で比べられる。
    if (allowed.fromDateKey && fact.dateKey >= allowed.fromDateKey) continue
    deskFindings.push({ level: 'stop', code: 'outside-allowed-range', message: `${label}: ${describeDeskChange(change)}`, ...locationOf(fact) })
  }
  const sectionFindings: PatrolFinding[] = diff.sections
    .filter((section) => !allowed.sections?.has(section))
    .map((section) => ({ level: 'stop', code: 'outside-allowed-range', message: `変わってよい範囲の外の部分が変わった: ${section}` }))
  return [...limitDeskFindings(deskFindings, 'stop', 'outside-allowed-range', label), ...sectionFindings]
}

type SeatOccurrence = { desk: DeskFact; student: StudentFact }

export function checkManualStudentsKeepTeacher(before: BoardFacts, after: BoardFacts, options: { announcedText?: string; excludeDeskKeys?: ReadonlySet<string> } = {}): PatrolFinding[] {
  const findings: PatrolFinding[] = []
  const afterByCell = groupByCell(after)
  for (const [cellId, beforeDesks] of groupByCell(before)) {
    // 操作前の手入力の生徒(除外の机は見ない＝動かした本人など、変わってよい机)。
    const manualByIdentity = new Map<string, SeatOccurrence[]>()
    for (const desk of beforeDesks) {
      if (options.excludeDeskKeys?.has(desk.key)) continue
      for (const student of desk.students) {
        if (!student || student.origin !== 'manual') continue
        const identity = lessonIdentity(student)
        manualByIdentity.set(identity, [...(manualByIdentity.get(identity) ?? []), { desk, student }])
      }
    }
    if (manualByIdentity.size === 0) continue
    // 操作後の同じコマ(同じ cellId)の席と保留の下段。出自は問わない(テンプレに取られた形でも「どこにいるか」で見る)。
    const seatsByIdentity = new Map<string, SeatOccurrence[]>()
    const pendingCountByIdentity = new Map<string, number>()
    for (const desk of afterByCell.get(cellId) ?? []) {
      for (const student of desk.students) {
        if (!student) continue
        const identity = lessonIdentity(student)
        seatsByIdentity.set(identity, [...(seatsByIdentity.get(identity) ?? []), { desk, student }])
      }
      for (const student of desk.pendingStudents) {
        const identity = lessonIdentity(student)
        pendingCountByIdentity.set(identity, (pendingCountByIdentity.get(identity) ?? 0) + 1)
      }
    }
    for (const [identity, manualList] of manualByIdentity) {
      // 数で突き合わせる(同じコマに同じ生徒が 2 か所いる既存の INV-12 違反でも、1 か所ずつ対にして落ちない)。
      const seats = [...(seatsByIdentity.get(identity) ?? [])]
      let pendingLeft = pendingCountByIdentity.get(identity) ?? 0
      const unmatched: SeatOccurrence[] = []
      // 1) 同じ講師の席(机番号だけの移動は数えない)。
      for (const occurrence of manualList) {
        const index = seats.findIndex((seat) => seat.desk.teacher === occurrence.desk.teacher)
        if (index >= 0) seats.splice(index, 1)
        else unmatched.push(occurrence)
      }
      for (const occurrence of unmatched) {
        const { desk, student } = occurrence
        const where = `${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}`
        const location = { ...locationOf(desk), studentId: student.key }
        // 2) 席にいるが講師が違う。
        const seat = seats.shift()
        if (seat) {
          const announced = Boolean(options.announcedText && student.name && options.announcedText.includes(student.name))
          findings.push({
            level: announced ? 'info' : 'stop',
            code: announced ? 'manual-student-teacher-changed-announced' : 'manual-student-teacher-changed',
            message: `手入力の生徒の講師が変わった${announced ? '(確認の画面に出ていた)' : ''}: ${where} 講師 ${teacherText(desk.teacher)} → ${teacherText(seat.desk.teacher)}（机${seat.desk.deskIndex + 1}）`,
            ...location,
          })
          continue
        }
        // 3) 同じコマの保留の下段へ移った(下段＝手入力の側。仕様どおり)。
        if (pendingLeft > 0) {
          pendingLeft -= 1
          findings.push({ level: 'info', code: 'manual-student-to-pending', message: `手入力の生徒が保留の下段へ移った: ${where}`, ...location })
          continue
        }
        // 4) どこにもいない。
        findings.push({ level: 'stop', code: 'manual-student-lost', message: `手入力の生徒が同じコマから消えた: ${where} 講師 ${teacherText(desk.teacher)}`, ...location })
      }
    }
  }
  return findings
}

/** 「生徒がいて本物の講師がおらず、講師の休みでもない机」か。 */
function isTeacherlessStudentDesk(desk: DeskFact): boolean {
  return desk.teacher === '' && !desk.teacherRest && desk.students.some((student) => student !== null)
}

export function checkTeacherlessStudentsNotAdded(before: BoardFacts, after: BoardFacts, options: { excludeDeskKeys?: ReadonlySet<string> } = {}): PatrolFinding[] {
  const beforeCounts = new Map<string, number>()
  for (const desk of before.desks.values()) {
    if (options.excludeDeskKeys?.has(desk.key) || !isTeacherlessStudentDesk(desk)) continue
    for (const student of desk.students) {
      if (!student) continue
      const key = `${desk.cellId}\u0000${student.key}`
      beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1)
    }
  }
  const findings: PatrolFinding[] = []
  const afterDesks = [...after.desks.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.slotNumber - right.slotNumber || left.deskIndex - right.deskIndex)
  for (const desk of afterDesks) {
    if (options.excludeDeskKeys?.has(desk.key) || !isTeacherlessStudentDesk(desk)) continue
    for (const student of desk.students) {
      if (!student) continue
      const key = `${desk.cellId}\u0000${student.key}`
      const left = beforeCounts.get(key) ?? 0
      if (left > 0) {
        beforeCounts.set(key, left - 1)
        continue
      }
      findings.push({
        level: 'stop', code: 'teacherless-student-added',
        message: `講師のいない机に座る生徒が増えた: ${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}`,
        ...locationOf(desk), studentId: student.key,
      })
    }
  }
  return findings
}

/** 出欠記録の文字列(生徒キー|status|科目|種類)を所見の文にする。 */
function describeStatus(status: string): { text: string; studentKey: string } {
  const [studentKey = '', kind = '', subject = '', lessonType = ''] = status.split('|')
  return { text: `${studentIdText(studentKey)} ${STATUS_LABELS[kind] ?? kind} ${subject} ${LESSON_TYPE_LABELS[lessonType] ?? lessonType}`, studentKey }
}

export function checkManualInputsNotLost(before: BoardFacts, after: BoardFacts, options: { excludeDeskKeys?: ReadonlySet<string> } = {}): PatrolFinding[] {
  // 操作後の同じコマに残っている数(席の上段・保留の下段のどちらでも盤面に残っている＝消えていない)。
  const afterCounts = new Map<string, number>()
  const bump = (key: string) => afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1)
  for (const desk of after.desks.values()) {
    for (const memo of [...desk.memos, ...desk.pendingMemos]) bump(`${desk.cellId}\u0000memo\u0000${memo}`)
    for (const status of [...desk.statuses, ...desk.pendingStatuses]) bump(`${desk.cellId}\u0000status\u0000${status}`)
  }
  const take = (key: string) => {
    const left = afterCounts.get(key) ?? 0
    if (left <= 0) return false
    afterCounts.set(key, left - 1)
    return true
  }
  const findings: PatrolFinding[] = []
  const beforeDesks = [...before.desks.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.slotNumber - right.slotNumber || left.deskIndex - right.deskIndex)
  for (const desk of beforeDesks) {
    if (options.excludeDeskKeys?.has(desk.key)) continue
    for (const memo of [...desk.memos, ...desk.pendingMemos]) {
      if (take(`${desk.cellId}\u0000memo\u0000${memo}`)) continue
      // メモの本文は出さない(伏せ字のあとでも、報告に人の書いた文を残さない)。
      findings.push({ level: 'stop', code: 'manual-input-lost', message: `メモが同じコマから消えた: ${placeOf(desk)}`, ...locationOf(desk) })
    }
    for (const status of [...desk.statuses, ...desk.pendingStatuses]) {
      if (take(`${desk.cellId}\u0000status\u0000${status}`)) continue
      const described = describeStatus(status)
      findings.push({
        level: 'stop', code: 'manual-input-lost', message: `出欠記録が同じコマから消えた: ${placeOf(desk)} ${described.text}`,
        ...locationOf(desk), studentId: described.studentKey,
      })
    }
  }
  return findings
}

const SAME_STATE_LABELS: Record<'undo-not-restored' | 'redo-not-restored' | 'save-changed' | 'reload-changed', string> = {
  'undo-not-restored': '元に戻すで操作前に戻らない',
  'redo-not-restored': 'やり直しで操作後に戻らない',
  'save-changed': '保存で盤面が変わった',
  'reload-changed': '読み込み直しで盤面が変わった',
}

export function checkSameState(before: BoardFacts, after: BoardFacts, code: 'undo-not-restored' | 'redo-not-restored' | 'save-changed' | 'reload-changed'): PatrolFinding[] {
  const diff = diffBoardFacts(before, after)
  const label = SAME_STATE_LABELS[code]
  const deskFindings: PatrolFinding[] = diff.desks.map((change) => ({
    level: 'stop', code, message: `${label}: ${describeDeskChange(change)}`, ...locationOf((change.after ?? change.before)!),
  }))
  const sectionFindings: PatrolFinding[] = diff.sections.map((section) => ({ level: 'stop', code, message: `${label}: ${section}` }))
  return [...limitDeskFindings(deskFindings, 'stop', code, label), ...sectionFindings]
}

function auditFindingKey(finding: InvAuditFinding): string {
  return [finding.rule, finding.severity, finding.kind, finding.studentId ?? '', finding.dateKey ?? '', finding.slotNumber ?? '', finding.deskIndex ?? '', finding.subject ?? '', finding.sessionId ?? ''].join('|')
}

export function checkAuditNotWorse(before: InvAuditResult, after: InvAuditResult): PatrolFinding[] {
  // 数で突き合わせる(同じ鍵の違反が 1 件 → 2 件に増えたのも「増えた」)。
  const beforeCounts = new Map<string, number>()
  for (const finding of before?.findings ?? []) {
    const key = auditFindingKey(finding)
    beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1)
  }
  const findings: PatrolFinding[] = []
  for (const finding of after?.findings ?? []) {
    const key = auditFindingKey(finding)
    const left = beforeCounts.get(key) ?? 0
    if (left > 0) {
      beforeCounts.set(key, left - 1)
      continue
    }
    const isBug = finding.severity === 'bug'
    findings.push({
      level: isBug ? 'stop' : 'info',
      code: isBug ? 'inv-new-violation' : 'inv-new-check',
      message: `${isBug ? '保証台帳の違反が増えた' : '保証台帳の要確認が増えた'}: ${finding.rule} ${finding.message}`,
      ...(finding.dateKey ? { dateKey: finding.dateKey } : {}),
      ...(finding.slotNumber !== undefined ? { slotNumber: finding.slotNumber } : {}),
      ...(finding.deskIndex !== undefined ? { deskIndex: finding.deskIndex } : {}),
      ...(finding.studentId ? { studentId: finding.studentId } : {}),
    })
  }
  return findings
}

/** 確認の文(templateDiffApply.ts の「置き換え n机・保留 m机」)から保留の数を読む。書いてなければ null。 */
export function parsePendingCountFromConfirm(message: string): number | null {
  const match = /保留\s*(\d+)\s*机/u.exec(typeof message === 'string' ? message : '')
  return match ? Number(match[1]) : null
}

export function checkPendingCountMatchesPreview(before: BoardFacts, after: BoardFacts, confirmMessage: string): PatrolFinding[] {
  const expected = parsePendingCountFromConfirm(confirmMessage)
  if (expected === null) return []
  const actual = after.pendingDeskCount - before.pendingDeskCount
  if (actual === expected) return []
  return [{ level: 'stop', code: 'pending-count-mismatch', message: `確認の画面の保留の数と実際に増えた保留の数が違う: 確認の画面 ${expected} 机・実際 ${actual} 机` }]
}

export function summarizeChanges(before: BoardFacts, after: BoardFacts): PatrolFinding[] {
  const diff = diffBoardFacts(before, after)
  const counts: Record<DeskChangeField, number> = { teacher: 0, students: 0, statuses: 0, memos: 0, pending: 0 }
  for (const change of diff.desks) for (const field of change.fields) counts[field] += 1
  const fieldText = (Object.keys(counts) as DeskChangeField[]).map((field) => `${FIELD_LABELS[field]} ${counts[field]}`).join('・')
  const sectionText = diff.sections.length > 0 ? `${diff.sections.length}（${diff.sections.join('・')}）` : '0'
  return [{ level: 'info', code: 'change-summary', message: `変わった机 ${diff.desks.length} 机（${fieldText}）・変わった部分 ${sectionText}` }]
}

/** 突き合わせに使う項目(note は理由なので使わない)。 */
const KNOWN_MATCH_FIELDS = ['code', 'classroomId', 'step', 'dateKey', 'slotNumber', 'studentId'] as const

export function applyKnownIssues(findings: PatrolFinding[], known: KnownPatrolIssue[], context: { classroomId: string; step: string }): { findings: PatrolFinding[]; knownCount: number } {
  // 突き合わせる項目が 1 つも無い既知はすべての所見に当たってしまうので使わない(書き損じで点検が黙るのを防ぐ)。
  const issues = (Array.isArray(known) ? known : []).filter((issue) => (
    Boolean(issue) && typeof issue === 'object' && KNOWN_MATCH_FIELDS.some((field) => issue[field] !== undefined && issue[field] !== null)
  ))
  const matches = (issue: KnownPatrolIssue, finding: PatrolFinding) => (
    (issue.code == null || issue.code === finding.code)
    && (issue.classroomId == null || issue.classroomId === context.classroomId)
    && (issue.step == null || issue.step === context.step)
    && (issue.dateKey == null || issue.dateKey === finding.dateKey)
    && (issue.slotNumber == null || Number(issue.slotNumber) === finding.slotNumber)
    && (issue.studentId == null || issue.studentId === finding.studentId)
  )
  let knownCount = 0
  const kept = findings.filter((finding) => {
    if (issues.some((issue) => matches(issue, finding))) {
      knownCount += 1
      return false
    }
    return true
  })
  return { findings: kept, knownCount }
}
