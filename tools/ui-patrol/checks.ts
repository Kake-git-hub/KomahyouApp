// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5「操作のたびの点検」)の点検。
// 操作の前後の盤面の事実(boardFacts.ts)を比べ、「変なこと」(stop)と「知らせるだけのこと」(info)を所見にする。
//
// ★きっかけの事故(2026-11-10): テンプレを保存したら、手入力の振替の生徒が講師の机から講師のいない机へ移った。
//   画面のつなぎ方の取り違えはユニットテストでは見えないので、操作の結果を意味で比べて止める(checkManualStudentsKeepTeacher・
//   checkTeacherlessStudentsNotAdded)。
// ★所見の message は日本語 1 行。場所は「11/19(木) 3限 机5」、人は仮名(伏せ字のあとの名前)と生徒 ID だけ。
// ★純関数。入力を書き換えない。ネットワークにもファイルにも触れない。
import type { InvAuditFinding, InvAuditResult } from '../invAuditEntry'
import { isTemplateBlockingRecordStatus } from '../../src/components/schedule-board/templateConflictRules'
import type { StudentStatusKind } from '../../src/components/schedule-board/types'
import { countPendingDesksFrom, diffBoardFacts, type BoardFacts, type DeskChange, type DeskChangeField, type DeskFact, type StudentFact, type TeacherCellAnomaly } from './boardFacts'

export const PATROL_FINDING_CODES = [
  'outside-allowed-range', 'manual-student-teacher-changed', 'manual-student-teacher-changed-announced', 'manual-student-lost',
  'manual-student-to-pending', 'teacherless-student-added', 'manual-input-lost', 'inv-new-violation', 'inv-new-check',
  'undo-not-restored', 'redo-not-restored', 'save-changed', 'reload-changed', 'pending-count-mismatch',
  'external-request', 'page-error', 'move-not-applied', 'move-blocked', 'change-summary',
  // 作業 5(実データで流した結果): テンプレ保存が根拠を失った振替を消した(spec-template-conflict-v2 §9-12・Q40-1・仕様どおり)。確認の画面の件数の範囲だけ。
  'orphaned-makeup-removed-announced',
  // 作業 5 修正 1: テンプレ自体がその授業を講師なしにしている(テンプレの机の teacherId が空)。テンプレどおりの結果なので info。
  'teacherless-student-by-template',
  // 室長が講師を消した机(講師の削除記録)にテンプレの生徒が置かれた。仕様どおり(オーナー決定 2026-11-11・Issue #85・spec-template-conflict-v2)なので info。
  'teacherless-student-at-deleted-teacher-desk',
  // 台本 d(テンプレを実際に変えて保存・2026-11-11 第 2 段): 変えたテンプレの机で起きるはずの変化が盤面に起きない(stop)／
  // 保存したテンプレにその変更が入っていない(stop)／§2 の規則(手入力・出欠記録・講師の休みが勝つ・在籍していない日)で置かれない(info)。
  'template-edit-not-applied', 'template-edit-not-saved', 'template-edit-held-by-rule',
  // 台本 e(出欠・2026-11-11 第 2 段の 2 本目): 在庫の増減が仕様(INV-06)と合わない(stop)／出欠記録が付かない・振替先に置かれない(stop)／
  // アプリが出欠の操作を断った(info)／テンプレ保存が出欠記録のあるコマにその生徒を置き直した(stop・§2-4 記録が勝つ)。
  'stock-delta-mismatch', 'attendance-not-applied', 'attendance-blocked', 'attendance-record-overridden',
  // 台本 f(講師の移動・入れ替え・休み・2026-11-11 第 2 段の 3 本目)と、どの台本のあとでも当てる講師のコマの点検:
  // 休みの記録があるコマにその講師が居る(stop・§9-25)／同じ講師が 1 コマに 2 机(stop・INV-01)／前からある同じ形(info・起動のときだけ)／
  // 講師の操作が盤面に効いていない・別の所まで変わった(stop)／アプリが講師の操作を断った(info)。
  'teacher-rested-but-present', 'teacher-duplicated-in-cell', 'teacher-cell-anomaly-existing', 'teacher-op-not-applied', 'teacher-op-blocked',
  // 台本 g(休日設定と解除・丸ごと振替・2026-11-11 第 2 段の 4 本目): 日付の操作が盤面に効いていない(stop)／休日の解除・丸ごと振替の解除で
  // 操作の前の盤面・在庫に戻らない(stop・§9-20・休日解除は逆操作)／アプリが日付の操作を断った(info)／丸ごと振替の作成・解除でできた
  // 「休みの記録があるコマにその講師が居る」(info・§9-25 の対象外の既知の形・2026-11-11 オーナー決定で今のまま〔講師の休みが本番で使われ始めてから見直す〕)。
  'day-op-not-applied', 'round-trip-not-restored', 'day-op-blocked', 'teacher-rested-present-by-whole-day-transfer',
  // 休日のまま読み込み直す(再マージ)とそのコマのメモは消え、解除しても戻らない(休日にした時点では残る＝convertHolidayDeskEntriesToRecords は触らない)
  // (info・仕様: 休日のコマは再マージで授業・講師・メモを持ち込まない＝spec-makeup-stock §B-2-2c・
  // inv06-holiday-record-retention.matrix.test.ts で固定)。室長から見ると手入力が消えるので知らせる。
  'holiday-memo-dropped',
  // 休日の解除で、その日の抑止キーが休日にする前と違う(info・仕様: 席へ戻した通常授業の鍵は外し、戻せなかった授業の鍵は積む＝
  // ScheduleBoardScreen.tsx の resolveHolidayReleaseSuppressedOccurrences。盤面の机が同じかは別に止める)。
  'holiday-release-suppression-changed',
  // 休日のまま読み込み直す(再マージ)と、その日の生徒も出欠記録も無い机の手入力の講師は消え、解除しても戻らない(休日にした時点では残る・
  // テンプレの講師が戻ることはある)(info・仕様: 休日のコマは再マージで
  // 記録のある机に限り講師を引き継ぐ＝spec-makeup-stock §B-2-2c・inv06-holiday-record-retention.matrix.test.ts で固定)。
  'holiday-teacher-dropped',
  // 台本 h(講習の自動割振・2026-11-11 第 2 段の 5 本目・既定では流さない): 自動割振で置いた席のほかが変わった(stop・INV-02)／
  // 置いた席が決まりに反する(講習の期間の外・講師のいない机・休校のコマ・同じコマに同じ生徒が 2 席・出席不可のコマ・制約事項・stop・INV-01)／
  // 画面の文の件数と置いた席の数が違う(stop・INV-06)／アプリが割り振らなかった(info)／2 回目の自動割振で盤面か在庫が変わった(stop・INV-03)。
  'auto-assign-outside-placement', 'auto-assign-rule-violated', 'auto-assign-count-mismatch', 'auto-assign-blocked', 'auto-assign-rerun-changed',
] as const
export type PatrolFindingCode = (typeof PATROL_FINDING_CODES)[number]
export type PatrolFinding = { level: 'stop' | 'info'; code: PatrolFindingCode; message: string; dateKey?: string; slotNumber?: number; deskIndex?: number; studentId?: string; subject?: string }
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

const DIGIT = /[0-9０-９]/u

/**
 * 確認の文にこの生徒の名前が出ているか(修正 1・レビュー Minor 2)。伏せ字の仮名は「生徒092」「生092」のように数字で終わるので、
 * 部分一致だと「生徒09」が「生徒092」に当たる。名前の直後が数字でない(文の終わりを含む)ときだけ「出ている」。名前が空なら出ていない。
 */
function isNameAnnounced(text: string | undefined, name: string): boolean {
  if (!text || !name) return false
  for (let index = text.indexOf(name); index >= 0; index = text.indexOf(name, index + 1)) {
    const next = text.charAt(index + name.length)
    if (!next || !DIGIT.test(next)) return true
  }
  return false
}

function pushOccurrence(map: Map<string, SeatOccurrence[]>, occurrence: SeatOccurrence) {
  const identity = lessonIdentity(occurrence.student)
  const list = map.get(identity)
  if (list) list.push(occurrence)
  else map.set(identity, [occurrence])
}

/**
 * 確認の画面の「テンプレから外した生徒の振替n件を消します」の n(templateDiffApply.ts の buildTemplateDiffConfirmDetail・
 * summary.orphanedMakeupsRemoved)。書いてなければ 0。
 */
export function parseAnnouncedOrphanedMakeupCount(text: string | undefined): number {
  const match = /テンプレから外した生徒の振替\s*(\d+)\s*件を消します/u.exec(typeof text === 'string' ? text : '')
  return match ? Number(match[1]) : 0
}

export function checkManualStudentsKeepTeacher(before: BoardFacts, after: BoardFacts, options: { announcedText?: string; excludeDeskKeys?: ReadonlySet<string>; announcedOrphanedMakeupCount?: number } = {}): PatrolFinding[] {
  const findings: PatrolFinding[] = []
  // 作業 5(実データ・日大前校で確認): テンプレ保存は、休日設定の日の授業の振替を別の日へ置いた後でテンプレからその授業が無くなると、
  // 置いた振替を消す(spec-template-conflict-v2 §9-12「今どおり消す」・旧 Q40-1・ScheduleBoardScreen.tsx の orphaned.removals)。
  // 確認の画面は件数を出し、名前は「ほか n 件」に畳まれることがあるので、件数の範囲で「消えた手入力の振替」だけを info に下げる。
  let orphanedMakeupLeft = Math.max(0, options.announcedOrphanedMakeupCount ?? 0)
  const afterByCell = groupByCell(after)
  for (const [cellId, beforeDesks] of groupByCell(before)) {
    // 操作前の手入力の生徒(除外の机は見ない＝動かした本人など、変わってよい机)。
    // 上段の席は出自が手入力の生徒、保留の下段は全員(下段＝手入力の側・spec-template-conflict-v2「2 行の席」)。
    // ★回帰防止(修正 1・レビュー Important-1): 下段を集めないと、テンプレ保存の 2 回目や「上段を採用」で下段の生徒が盤面から消えても
    //   どの点検も止めなかった(メモ・出欠記録の点検は生徒を見ない・範囲の点検はテンプレ保存の反映日以降を通す)。
    const upperByIdentity = new Map<string, SeatOccurrence[]>()
    const lowerByIdentity = new Map<string, SeatOccurrence[]>()
    for (const desk of beforeDesks) {
      if (options.excludeDeskKeys?.has(desk.key)) continue
      for (const student of desk.students) {
        if (student && student.origin === 'manual') pushOccurrence(upperByIdentity, { desk, student })
      }
      for (const student of desk.pendingStudents) pushOccurrence(lowerByIdentity, { desk, student })
    }
    if (upperByIdentity.size === 0 && lowerByIdentity.size === 0) continue
    // 操作後の同じコマ(同じ cellId)の席と保留の下段。出自は問わない(テンプレに取られた形でも「どこにいるか」で見る)。
    const seatsByIdentity = new Map<string, SeatOccurrence[]>()
    const afterLowerCountByIdentity = new Map<string, number>()
    for (const desk of afterByCell.get(cellId) ?? []) {
      for (const student of desk.students) {
        if (student) pushOccurrence(seatsByIdentity, { desk, student })
      }
      for (const student of desk.pendingStudents) {
        const identity = lessonIdentity(student)
        afterLowerCountByIdentity.set(identity, (afterLowerCountByIdentity.get(identity) ?? 0) + 1)
      }
    }
    const identities = new Set([...upperByIdentity.keys(), ...lowerByIdentity.keys()])
    for (const identity of identities) {
      // 数で突き合わせる(同じコマに同じ生徒が 2 か所いる既存の INV-12 違反でも、1 か所ずつ対にして落ちない)。
      const seats = [...(seatsByIdentity.get(identity) ?? [])]
      let lowerLeft = afterLowerCountByIdentity.get(identity) ?? 0
      // 0) 前から下段にいた分は、操作後の下段の同じ生徒と先に対にする(下段のまま＝所見なし)。
      //    先に対にしないと、上段から消えた同じ生徒を「下段へ移った」と数えて stop が info に下がる(レビュー Minor 4)。
      const lowerGone: SeatOccurrence[] = []
      for (const occurrence of lowerByIdentity.get(identity) ?? []) {
        if (lowerLeft > 0) lowerLeft -= 1
        else lowerGone.push(occurrence)
      }
      // 1) 上段の手入力の生徒を同じ講師の席と対にする(机番号だけの移動は数えない)。
      const upperUnmatched: SeatOccurrence[] = []
      for (const occurrence of upperByIdentity.get(identity) ?? []) {
        const index = seats.findIndex((seat) => seat.desk.teacher === occurrence.desk.teacher)
        if (index >= 0) seats.splice(index, 1)
        else upperUnmatched.push(occurrence)
      }
      // 2) 下段から上段の席へ上がった(室長が下段を採用した、など)。消えていない。講師は比べない
      //    (下段にいた間の担当の講師は、机の上段の講師とは限らないため)。
      const lowerLost: SeatOccurrence[] = []
      for (const occurrence of lowerGone) {
        if (seats.length > 0) seats.shift()
        else lowerLost.push(occurrence)
      }
      for (const occurrence of upperUnmatched) {
        const { desk, student } = occurrence
        const where = `${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}`
        const location = { ...locationOf(desk), studentId: student.key }
        // 3) 席にいるが講師が違う。
        const seat = seats.shift()
        if (seat) {
          const announced = isNameAnnounced(options.announcedText, student.name)
          findings.push({
            level: announced ? 'info' : 'stop',
            code: announced ? 'manual-student-teacher-changed-announced' : 'manual-student-teacher-changed',
            message: `手入力の生徒の講師が変わった${announced ? '(確認の画面に出ていた)' : ''}: ${where} 講師 ${teacherText(desk.teacher)} → ${teacherText(seat.desk.teacher)}（机${seat.desk.deskIndex + 1}）`,
            ...location,
          })
          continue
        }
        // 4) 同じコマの保留の下段へ移った(下段＝手入力の側。仕様どおり)。
        if (lowerLeft > 0) {
          lowerLeft -= 1
          findings.push({ level: 'info', code: 'manual-student-to-pending', message: `手入力の生徒が保留の下段へ移った: ${where}`, ...location })
          continue
        }
        // 5) どこにもいない。振替で、確認の画面が「根拠を失った振替を消す」と件数を出していた分は info(§9-12)。
        if (student.lessonType === 'makeup' && orphanedMakeupLeft > 0) {
          orphanedMakeupLeft -= 1
          findings.push({ level: 'info', code: 'orphaned-makeup-removed-announced', message: `根拠を失った振替が消えた(確認の画面に件数が出ていた): ${where} 講師 ${teacherText(desk.teacher)}`, ...location, subject: student.subject })
          continue
        }
        findings.push({ level: 'stop', code: 'manual-student-lost', message: `手入力の生徒が同じコマから消えた: ${where} 講師 ${teacherText(desk.teacher)}`, ...location })
      }
      for (const { desk, student } of lowerLost) {
        findings.push({
          level: 'stop', code: 'manual-student-lost',
          message: `保留の下段の手入力の生徒が同じコマから消えた: ${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}`,
          ...locationOf(desk), studentId: student.key,
        })
      }
    }
  }
  return findings
}

/** 「生徒がいて本物の講師がおらず、講師の休みでもない机」か。 */
function isTeacherlessStudentDesk(desk: DeskFact): boolean {
  return desk.teacher === '' && !desk.teacherRest && desk.students.some((student) => student !== null)
}

/** dateKey(YYYY-MM-DD)の曜日(日曜 0)。テンプレの dayOfWeek と同じ数え方。 */
function dayOfWeekOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay()
}

/**
 * テンプレ自体が講師なしにしている授業(鍵は「曜日|時限|生徒キー」・fromDateKey はそのテンプレの反映日)。
 * 当たる生徒はテンプレどおりの結果なので info に下げる(作業 5 修正 1・緑が丘 11/10 朝の形の 12/3 木 4限)。
 */
export type TemplateTeacherless = { keys: ReadonlySet<string>; fromDateKey: string }

export function checkTeacherlessStudentsNotAdded(before: BoardFacts, after: BoardFacts, options: { excludeDeskKeys?: ReadonlySet<string>; templateTeacherless?: TemplateTeacherless } = {}): PatrolFinding[] {
  const beforeCounts = new Map<string, number>()
  for (const desk of before.desks.values()) {
    if (options.excludeDeskKeys?.has(desk.key) || !isTeacherlessStudentDesk(desk)) continue
    for (const student of desk.students) {
      if (!student) continue
      const key = `${desk.cellId}\u0000${student.key}`
      beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1)
    }
  }
  // コマ(cellId)ごとの、室長が講師を消した記録のある机の数(操作の前・後)。
  const deletedCountOf = (facts: BoardFacts) => {
    const counts = new Map<string, number>()
    for (const fact of facts.desks.values()) if (fact.teacherDeleted) counts.set(fact.cellId, (counts.get(fact.cellId) ?? 0) + 1)
    return counts
  }
  const deletedBefore = deletedCountOf(before)
  const deletedAfter = deletedCountOf(after)
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
      const byTemplate = options.templateTeacherless
      if (byTemplate && desk.dateKey >= byTemplate.fromDateKey && byTemplate.keys.has(`${dayOfWeekOf(desk.dateKey)}|${desk.slotNumber}|${student.key}`)) {
        findings.push({
          level: 'info', code: 'teacherless-student-by-template',
          message: `テンプレ自体が講師なしの授業を講師のいない机に置いた: ${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}`,
          ...locationOf(desk), studentId: student.key,
        })
        continue
      }
      // 講師を消した机(室長がその日その講師を消した記録)に置かれたテンプレの生徒は仕様どおり(講師は置かない・生徒は置く・講師なしの赤字)。
      // 手入力の生徒・消した記録の無い机は今までどおり stop。テンプレ自体が講師なし(上)に当たれば、そちらを優先する。
      // 操作が削除記録を増やしていないこと(コマ単位・下の deletedCountOf)。操作そのものが記録を作ったのは「室長が消した」と言えないので stop のまま。
      // 机単位(同じ机番号)にしないのは、テンプレ保存の机の並べ直しで削除記録ごと別の机の番号へ動くため(実データで確認・机番号の移動は仕様の範囲)。
      if (desk.teacherDeleted && student.origin === 'template' && (deletedAfter.get(desk.cellId) ?? 0) <= (deletedBefore.get(desk.cellId) ?? 0)) {
        findings.push({
          level: 'info', code: 'teacherless-student-at-deleted-teacher-desk',
          message: `講師を消した机にテンプレの生徒が置かれた(仕様どおり): ${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}`,
          ...locationOf(desk), studentId: student.key,
        })
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

export function checkManualInputsNotLost(before: BoardFacts, after: BoardFacts, options: { excludeDeskKeys?: ReadonlySet<string>; releasedMovedStatuses?: ReadonlyArray<string> } = {}): PatrolFinding[] {
  // 根拠を失った振替を消すと、振替元の「移)」の記録(status 'moved')も一緒に消える(§9-12)。checkManualStudentsKeepTeacher が info に下げた
  // 振替(呼び出し側が「生徒キー|科目」で 1 件ずつ渡す)と同じ生徒×科目の「移動」の記録だけ、消えた振替の数まで info にする。
  // 休み・出席などほかの記録・別の科目の「移動」は下げない。
  // 限界: アプリが「どの振替を消すか」を取り違えても、生徒×科目と件数が合っていればこの点検では見分けられない。
  const releasedLeft = new Map<string, number>()
  for (const key of options.releasedMovedStatuses ?? []) releasedLeft.set(key, (releasedLeft.get(key) ?? 0) + 1)
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
      const [, statusKind = '', statusSubject = ''] = status.split('|')
      const releasedKey = `${described.studentKey}|${statusSubject}`
      if (statusKind === 'moved' && (releasedLeft.get(releasedKey) ?? 0) > 0) {
        releasedLeft.set(releasedKey, (releasedLeft.get(releasedKey) ?? 0) - 1)
        findings.push({
          level: 'info', code: 'orphaned-makeup-removed-announced', message: `根拠を失った振替の振替元の記録が消えた: ${placeOf(desk)} ${described.text}`,
          ...locationOf(desk), studentId: described.studentKey,
        })
        continue
      }
      findings.push({
        level: 'stop', code: 'manual-input-lost', message: `出欠記録が同じコマから消えた: ${placeOf(desk)} ${described.text}`,
        ...locationOf(desk), studentId: described.studentKey,
      })
    }
  }
  return findings
}

type SameStateCode = 'undo-not-restored' | 'redo-not-restored' | 'save-changed' | 'reload-changed' | 'round-trip-not-restored' | 'auto-assign-rerun-changed'

const SAME_STATE_LABELS: Record<SameStateCode, string> = {
  'undo-not-restored': '元に戻すで操作前に戻らない',
  // 台本 g: 休日設定 → 解除・丸ごと振替 → 解除 で、操作の前の盤面に戻らない(休日解除は逆操作・§9-20 作成→解除で元の形)。
  'round-trip-not-restored': '解除しても操作の前の盤面に戻らない',
  'redo-not-restored': 'やり直しで操作後に戻らない',
  'save-changed': '保存で盤面が変わった',
  'reload-changed': '読み込み直しで盤面が変わった',
  // 台本 h: 同じ生徒の自動割振をもう一度押したら盤面が変わった(置けるものは 1 回目で置き切る・INV-03 相当)。
  'auto-assign-rerun-changed': '2 回目の自動割振で盤面が変わった',
}

export function checkSameState(before: BoardFacts, after: BoardFacts, code: SameStateCode): PatrolFinding[] {
  const diff = diffBoardFacts(before, after)
  const label = SAME_STATE_LABELS[code]
  const deskFindings: PatrolFinding[] = diff.desks.map((change) => ({
    level: 'stop', code, message: `${label}: ${describeDeskChange(change)}`, ...locationOf((change.after ?? change.before)!),
  }))
  const sectionFindings: PatrolFinding[] = diff.sections.map((section) => ({ level: 'stop', code, message: `${label}: ${section}` }))
  return [...limitDeskFindings(deskFindings, 'stop', code, label), ...sectionFindings]
}

/**
 * 保証台帳の所見の照合の鍵。机番号は入れない(修正 1・レビュー Minor 3): テンプレ保存では机の並びが変わるので、前からある違反
 * (同じコマに同じ生徒が 2 か所など)が机番号だけ変わって「新しい違反」と出てしまう。鍵ごとの件数で比べる。
 */
function auditFindingKey(finding: InvAuditFinding): string {
  return [finding.rule, finding.severity, finding.kind, finding.studentId ?? '', finding.dateKey ?? '', finding.slotNumber ?? '', finding.subject ?? '', finding.sessionId ?? ''].join('|')
}

export function checkAuditNotWorse(before: InvAuditResult, after: InvAuditResult): PatrolFinding[] {
  // 鍵ごとの件数で突き合わせる(操作後の件数が操作前より多い鍵だけ、増えた分を所見にする。1 件 → 2 件も「増えた」)。
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

/**
 * 確認の画面の「保留 n机」と、保存で実際にできた保留の数が合うか。
 * ★n は「反映日以降の開いている日のコマの机のうち、保存のあとに保留になっている机」の数(templateConflictRules.ts の computeTemplateDiffApply の summary.pending。
 *   新しく作った保留と、前からの保留を保存し直した机の両方で 1 ずつ増える・休日のコマは飛ばす)。前から保留がある盤面では「増えた数」と一致しない
 *   (台本 d・2026-11-11 の日大前の形: 前に 30 机・確認 28 机)。options.fromDateKey(反映日)を渡すと、その数え方(boardFacts.ts の countPendingDesksFrom)と等号で比べる。
 *   渡さないときは従来どおり「増えた数＝n」。
 */
export function checkPendingCountMatchesPreview(before: BoardFacts, after: BoardFacts, confirmMessage: string, options: { fromDateKey?: string } = {}): PatrolFinding[] {
  const expected = parsePendingCountFromConfirm(confirmMessage)
  if (expected === null) return []
  if (options.fromDateKey) {
    const actual = countPendingDesksFrom(after, options.fromDateKey)
    if (actual === expected) return []
    return [{
      level: 'stop', code: 'pending-count-mismatch',
      message: `確認の画面の保留の数と実際の保留の数が違う: 確認の画面 ${expected} 机・保存のあと反映日以降の保留 ${actual} 机(増えた ${after.pendingDeskCount - before.pendingDeskCount} 机)`,
    }]
  }
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

/**
 * 台本 d が変えたテンプレの机 1 つ(tools/ui-patrol/templateEdit.ts の pickTemplateEditTarget で選び、画面で変えたもの)。
 * teacher/newTeacher は講師の表示名(盤面の講師欄と同じ)、studentKeys は生徒のキー(managedStudentId)。
 * anchorCellIds は確かめる日(反映日以降で、盤面に前の版のその机が当たっていたコマ・templateEdit.ts の findTemplateDeskAnchorCells)。
 */
export type TemplateEdit = {
  kind: 'add-student' | 'change-teacher' | 'delete-desk'
  dayOfWeek: number
  slotNumber: number
  /** 0 始まり(テンプレの deskIndex - 1)。 */
  deskIndex: number
  /** 生徒を足した席(add-student)。 */
  seat?: number
  teacher: string
  teacherId: string
  newTeacher?: string
  newTeacherId?: string
  /** add-student: 足した生徒 1 人／delete-desk: 消した机の生徒／change-teacher: 机の生徒(確かめには使わない)。 */
  studentKeys: string[]
  anchorCellIds: string[]
}

/**
 * 変えたテンプレの机で、起きるはずの変化が確かめる日のコマに起きたか(spec-template-conflict-v2 §2)。
 * - 生徒を足す: 足した生徒がそのコマ(上段か保留の下段)に居る。居なくても、そのコマにその生徒の出欠記録がある(§2-4 記録が勝つ)・
 *   その日その時限の通常授業の削除記録がある(options.suppressedOccurrences・§1-1 #10)・在籍していない日(options.isStudentActiveOnDate)は info。手入力の同じ生徒が先にある(§2-2)はコマに居るので所見にならない。
 * - 講師を替える: 新しい講師がそのコマ(講師欄か保留の下段)に居る。居なくても、そのコマに新しい講師の休みの記録がある(§2-4)なら info。
 *   前の講師がテンプレ由来のまま残っていたら stop(前の講師はテンプレのそのコマに居なくなった。手置き〔青字〕で残るのは手入力なので見ない)。
 * - 机を消す: 消した机の講師・生徒が、そのコマにテンプレ由来で残っていたら stop(手入力で残るのは見ない)。
 * 規則で説明できない「反映されていない」だけを stop にする。日ごと・机ごとに 1 件(20 件まで＋「ほか n 机」)。
 */
export function checkTemplateEditApplied(before: BoardFacts, after: BoardFacts, edit: TemplateEdit, options: { isStudentActiveOnDate?: (studentKey: string, dateKey: string) => boolean; suppressedOccurrences?: ReadonlyArray<string> } = {}): PatrolFinding[] {
  const anchors = new Set(edit.anchorCellIds)
  // 通常授業の削除記録(抑止キー「生徒キー__科目__日付__時限」・templateDiffApply.ts の buildTemplateOccurrenceKey)。科目は表示の科目に直されることがあるので見ない。
  const suppressedSlots = new Set<string>()
  for (const key of options.suppressedOccurrences ?? []) {
    const parts = typeof key === 'string' ? key.split('__') : []
    if (parts.length >= 4) suppressedSlots.add(`${parts[0]}|${parts[parts.length - 2]}|${parts[parts.length - 1]}`)
  }
  const desksOf = (facts: BoardFacts) => {
    const map = new Map<string, DeskFact[]>()
    for (const desk of facts.desks.values()) {
      if (!anchors.has(desk.cellId)) continue
      const list = map.get(desk.cellId) ?? []
      list.push(desk)
      map.set(desk.cellId, list)
    }
    return map
  }
  const beforeByCell = desksOf(before)
  const afterByCell = desksOf(after)
  const stops: PatrolFinding[] = []
  const infos: PatrolFinding[] = []
  const label = '変えたテンプレの机が盤面に反映されていない'
  const where = (cellDesks: DeskFact[], cellId: string) => {
    const [dateKey = '', slotText = ''] = cellId.split('_')
    const slotNumber = cellDesks[0]?.slotNumber ?? Number(slotText)
    return { text: formatPlace(dateKey, slotNumber), location: { dateKey, slotNumber } }
  }
  for (const cellId of [...anchors].sort()) {
    const beforeDesks = beforeByCell.get(cellId) ?? []
    const afterDesks = afterByCell.get(cellId) ?? []
    const place = where(afterDesks.length > 0 ? afterDesks : beforeDesks, cellId)
    if (edit.kind === 'add-student') {
      const key = edit.studentKeys[0] ?? ''
      if (!key) continue
      const present = afterDesks.some((desk) => [...desk.students, ...desk.pendingStudents].some((student) => student?.key === key))
      if (present) continue
      const hasStatus = [...beforeDesks, ...afterDesks].some((desk) => [...desk.statuses, ...desk.pendingStatuses].some((status) => status.split('|')[0] === key))
      const inactive = options.isStudentActiveOnDate ? !options.isStudentActiveOnDate(key, place.location.dateKey) : false
      const suppressed = suppressedSlots.has(`${key}|${place.location.dateKey}|${place.location.slotNumber}`)
      if (hasStatus || inactive || suppressed) {
        const why = hasStatus ? 'その生徒の出欠記録が先にある・§2-4' : suppressed ? 'そのコマのその日の通常授業の削除記録がある・§1-1 #10' : '在籍していない日'
        infos.push({
          level: 'info', code: 'template-edit-held-by-rule',
          message: `テンプレに足した生徒を規則どおり置かなかった(${why}): ${place.text} ${studentIdText(key)}`,
          ...place.location, studentId: key,
        })
        continue
      }
      stops.push({ level: 'stop', code: 'template-edit-not-applied', message: `${label}: テンプレに足した生徒がいない ${place.text} ${studentIdText(key)}`, ...place.location, studentId: key })
      continue
    }
    if (edit.kind === 'change-teacher') {
      const next = edit.newTeacher ?? ''
      const present = next !== '' && afterDesks.some((desk) => desk.teacher === next || desk.pendingTeacher === next)
      if (!present && next !== '') {
        const rested = [...beforeDesks, ...afterDesks].some((desk) => desk.teacherRestName === next)
        if (rested) infos.push({ level: 'info', code: 'template-edit-held-by-rule', message: `テンプレで替えた講師を規則どおり置かなかった(その講師の休みが先にある・§2-4): ${place.text} ${next}`, ...place.location })
        else stops.push({ level: 'stop', code: 'template-edit-not-applied', message: `${label}: テンプレで替えた講師 ${next} がいない ${place.text}`, ...place.location })
      }
    }
    // 講師を替える・机を消す: 前の講師と消した机の生徒は、テンプレのそのコマに居なくなった。テンプレ由来のまま残っていたら「変」。
    for (const desk of afterDesks) {
      if (edit.teacher && desk.teacher === edit.teacher && desk.teacherOrigin === 'template') {
        stops.push({ level: 'stop', code: 'template-edit-not-applied', message: `${label}: テンプレから外した講師 ${edit.teacher} がテンプレのまま残った ${placeOf(desk)}`, ...locationOf(desk) })
      }
      if (edit.kind !== 'delete-desk') continue
      for (const student of desk.students) {
        if (student && student.origin === 'template' && edit.studentKeys.includes(student.key)) {
          stops.push({ level: 'stop', code: 'template-edit-not-applied', message: `${label}: テンプレで消した机の生徒がテンプレのまま残った ${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}`, ...locationOf(desk), studentId: student.key })
        }
      }
    }
  }
  return [...limitDeskFindings(stops, 'stop', 'template-edit-not-applied', label), ...limitDeskFindings(infos, 'info', 'template-edit-held-by-rule', 'テンプレの変更を規則どおり置かなかった')]
}

/**
 * 保存したテンプレ(教室設定の regularLessonTemplate)に、画面で変えた内容が入っているか。入っていなければ stop(室長が変えたのに保存されていない)。
 * 生徒を足す＝その席にその生徒／講師を替える＝その机の講師が新しい講師の ID／机を消す＝その机に講師も生徒もいない(机ごと無いのも「消えた」)。
 */
export function checkTemplateEditSaved(template: unknown, edit: TemplateEdit): PatrolFinding[] {
  type SavedDesk = { deskIndex?: number; teacherId?: string; students?: Array<{ studentId?: string } | null> }
  type SavedCell = { dayOfWeek?: number; slotNumber?: number; desks?: SavedDesk[] }
  const record = (template && typeof template === 'object' ? template : null) as { cells?: SavedCell[] } | null
  const fail = (what: string): PatrolFinding[] => [{
    level: 'stop', code: 'template-edit-not-saved',
    message: `画面で変えたテンプレが保存されていない(${what}): ${WEEKDAY_LABELS[edit.dayOfWeek] ?? '?'}曜 ${edit.slotNumber}限 机${edit.deskIndex + 1}`,
  }]
  if (!record || !Array.isArray(record.cells)) return fail('テンプレが無い')
  const cell = record.cells.find((item) => item?.dayOfWeek === edit.dayOfWeek && item?.slotNumber === edit.slotNumber)
  const desk = (Array.isArray(cell?.desks) ? cell!.desks : []).find((item) => item?.deskIndex === edit.deskIndex + 1)
  const students = Array.isArray(desk?.students) ? desk!.students : []
  if (edit.kind === 'add-student') {
    return students[edit.seat ?? 0]?.studentId === edit.studentKeys[0] ? [] : fail(`足した生徒 ${studentIdText(edit.studentKeys[0] ?? '')} が席に無い`)
  }
  if (edit.kind === 'change-teacher') {
    return desk?.teacherId === edit.newTeacherId ? [] : fail(`講師が ${edit.newTeacher ?? ''} になっていない`)
  }
  const empty = !desk || (!desk.teacherId && students.every((student) => !student?.studentId))
  return empty ? [] : fail('講師か生徒が残っている')
}

// ── 台本 e(出欠)の点検 ───────────────────────────────────────────────────────────────

/** 在庫の残(tools/ui-patrol/stock.ts の collectStockBalances の makeup・lecture)。鍵ごとの残。無い鍵は 0。 */
export type StockBalanceMaps = { makeup: Record<string, number>; lecture: Record<string, number> }
export type StockDeltaCode = 'stock-delta-mismatch' | 'undo-not-restored' | 'redo-not-restored' | 'save-changed' | 'reload-changed' | 'round-trip-not-restored' | 'auto-assign-rerun-changed'
/**
 * 比べない鍵(台本 g の休日設定)。数え方が通常と違う生徒(手動追加・編集で振替にした・講習・同じ日に同じ科目が 2 つ)の鍵は、仕様の増減を
 * 1 つに決められないので比べない(dayOps.ts の expectedHolidayStockDeltas が集める)。lecturePrefixes は講習の在庫の行の鍵の頭(生徒キー__)。
 */
export type StockDeltaIgnore = { makeup?: ReadonlySet<string>; lecturePrefixes?: ReadonlyArray<string> }

const signed = (value: number) => (value > 0 ? `+${value}` : String(value))

/**
 * 在庫の増減が仕様どおりか。expected は鍵ごとの増減(書いていない鍵は 0＝変わらない)。数え方はアプリの権威関数(stock.ts)の結果をそのまま比べる
 * (道具の側に別の数え方を作らない・INV-06)。合わない鍵ごとに 1 件(20 件まで＋「ほか n 件」)。
 * 元に戻す・読み込み直しでも使う(expected を空にし、code と label を渡す)。
 */
export function checkStockDeltas(before: StockBalanceMaps, after: StockBalanceMaps, expected: { makeup?: Record<string, number>; lecture?: Record<string, number> }, options: { code?: StockDeltaCode; label?: string; ignore?: StockDeltaIgnore } = {}): PatrolFinding[] {
  const code = options.code ?? 'stock-delta-mismatch'
  const label = options.label ?? '在庫の増減が仕様と違う'
  const findings: PatrolFinding[] = []
  for (const [part, partLabel] of [['makeup', '未消化振替'], ['lecture', '未消化講習']] as const) {
    const left = before?.[part] ?? {}
    const right = after?.[part] ?? {}
    const want = expected[part] ?? {}
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right), ...Object.keys(want)])].sort()
    for (const key of keys) {
      if (part === 'makeup' && options.ignore?.makeup?.has(key)) continue
      if (part === 'lecture' && (options.ignore?.lecturePrefixes ?? []).some((prefix) => key.startsWith(prefix))) continue
      const delta = (right[key] ?? 0) - (left[key] ?? 0)
      const wanted = want[key] ?? 0
      if (delta === wanted) continue
      // 未消化振替の鍵は「生徒キー__科目」。講習の鍵は在庫の行の鍵(生徒 ID・科目・講習 ID を含む)をそのまま出す(名前は入らない)。
      const [studentKey = '', subject = ''] = part === 'makeup' ? key.split('__') : [key, '']
      const what = part === 'makeup' ? `${studentIdText(studentKey)} ${subject}` : key
      findings.push({
        level: 'stop', code,
        message: `${label}: ${partLabel} ${what} 残 ${left[key] ?? 0} → ${right[key] ?? 0}(増減 ${signed(delta)}・仕様では ${signed(wanted)})`,
        ...(part === 'makeup' && studentKey && !studentKey.includes(':') ? { studentId: studentKey, subject } : {}),
      })
    }
  }
  return limitDeskFindings(findings, 'stop', code, label)
}

/** 台本 e の 1 つの操作(tools/ui-patrol/scenarios.mjs の pickAttendancePlan が選ぶ)。seat / to は { cellId, deskIndex(0 始まり), seat }。 */
export type AttendanceSeat = { cellId: string; deskIndex: number; seat: number }
export type AttendanceOp =
  | { kind: 'mark'; status: 'absent' | 'absent-no-makeup' | 'attended'; seat: AttendanceSeat; studentKey: string; subject: string; lessonType: string }
  | { kind: 'place'; to: AttendanceSeat; studentKey: string; subject: string }

/**
 * 出欠の操作が盤面に効いたか。
 * - 休み・振無休・出席: その席からその生徒が外れ、その机にその生徒のその記録(生徒キー|状態|科目|種類)が 1 件増えた(buildStudentStatusEntry の形)。
 * - 振替先へ置く: 先の席にその生徒の振替(同じ科目・種類 makeup)が座った(computeMakeupStockPlacement の形)。
 * 効いていなければ stop attendance-not-applied(押したのに記録が付かない・置かれない)。
 */
export function checkAttendanceApplied(before: BoardFacts, after: BoardFacts, op: AttendanceOp): PatrolFinding[] {
  return [...checkAttendanceSeatApplied(before, after, op), ...checkAttendanceDeskNeighbors(before, after, op)]
}

/**
 * 変わってよい範囲は「操作した机」だが、机の中でも変わってよいのは操作した席(とその席の出欠記録 1 件)だけ。ほかの席の生徒・講師・メモ・保留の下段・
 * ほかの出欠記録が変わったら stop outside-allowed-range(机の中の巻き込み。checkOutsideAllowedRange は机ごとにしか見ない)。
 */
function checkAttendanceDeskNeighbors(before: BoardFacts, after: BoardFacts, op: AttendanceOp): PatrolFinding[] {
  const json = (value: unknown) => JSON.stringify(value)
  const seat = op.kind === 'place' ? op.to : op.seat
  const key = `${seat.cellId}#${seat.deskIndex}`
  const left = before.desks.get(key)
  const right = after.desks.get(key)
  if (!left || !right) return []
  const changed: string[] = []
  const other = 1 - seat.seat
  if (json(left.students[other] ?? null) !== json(right.students[other] ?? null)) changed.push(`席${other + 1}の生徒`)
  if (json([left.teacher, left.teacherOrigin, left.teacherRest, left.teacherRestName]) !== json([right.teacher, right.teacherOrigin, right.teacherRest, right.teacherRestName])) changed.push('講師')
  if (json(left.memos) !== json(right.memos)) changed.push('メモ')
  if (json([left.pendingStudents, left.pendingTeacher, left.pendingStatuses, left.pendingMemos]) !== json([right.pendingStudents, right.pendingTeacher, right.pendingStatuses, right.pendingMemos])) changed.push('保留の下段')
  // 出欠記録: ほかの生徒の記録は変わらない(操作した生徒の記録が付いたかは checkAttendanceSeatApplied が見る)。
  const othersOf = (statuses: string[]) => statuses.filter((record) => record.split('|')[0] !== op.studentKey)
  if (json(othersOf(left.statuses)) !== json(othersOf(right.statuses))) changed.push('ほかの生徒の出欠記録')
  if (changed.length === 0) return []
  return [{
    level: 'stop', code: 'outside-allowed-range',
    message: `出欠の操作で同じ机のほかの部分が変わった(${changed.join('・')}): ${placeOf(right)} 席${seat.seat + 1} ${studentIdText(op.studentKey)}`,
    ...locationOf(right), studentId: op.studentKey,
  }]
}

function checkAttendanceSeatApplied(before: BoardFacts, after: BoardFacts, op: AttendanceOp): PatrolFinding[] {
  if (op.kind === 'place') {
    const desk = after.desks.get(`${op.to.cellId}#${op.to.deskIndex}`)
    const seated = desk?.students[op.to.seat]
    if (seated && seated.key === op.studentKey && seated.subject === op.subject && seated.lessonType === 'makeup') return []
    const place = desk ? placeOf(desk) : `${op.to.cellId} 机${op.to.deskIndex + 1}`
    return [{
      level: 'stop', code: 'attendance-not-applied',
      message: `振替先に選んだ席に振替が置かれていない: ${place} 席${op.to.seat + 1} ${studentIdText(op.studentKey)} ${op.subject}${seated ? `(座っているのは ${personOf(seated)} ${lessonOf(seated)})` : ''}`,
      ...(desk ? locationOf(desk) : {}), studentId: op.studentKey,
    }]
  }
  const key = `${op.seat.cellId}#${op.seat.deskIndex}`
  const beforeDesk = before.desks.get(key)
  const afterDesk = after.desks.get(key)
  const record = `${op.studentKey}|${op.status}|${op.subject}|${op.lessonType}`
  const count = (desk: DeskFact | undefined) => (desk?.statuses ?? []).filter((item) => item === record).length
  const stillSeated = afterDesk?.students[op.seat.seat]?.key === op.studentKey
  const recorded = count(afterDesk) > count(beforeDesk)
  if (!stillSeated && recorded) return []
  const place = afterDesk ?? beforeDesk
  const why = [recorded ? '' : `記録「${STATUS_LABELS[op.status] ?? op.status}」が付かない`, stillSeated ? '生徒が席に残った' : ''].filter(Boolean).join('・')
  return [{
    level: 'stop', code: 'attendance-not-applied',
    message: `出欠を付けたのに盤面に効いていない(${why}): ${place ? placeOf(place) : key} 席${op.seat.seat + 1} ${studentIdText(op.studentKey)} ${op.subject} ${LESSON_TYPE_LABELS[op.lessonType] ?? op.lessonType}`,
    ...(place ? locationOf(place) : {}), studentId: op.studentKey,
  }]
}

/**
 * 「記録が勝つ」の対象の記録(休み・振無休・出席・「移)」)。判定はテンプレ保存が同じ判断に使う権威関数 isTemplateBlockingRecordStatus
 * (templateConflictRules.ts・§2-4)をそのまま使う(休日の表示専用の記録〔休)〕は入らない)。「移)」も入るので、台本 b が付けた記録も守る。
 */
const isRecordWinsStatus = (kind: string) => isTemplateBlockingRecordStatus(kind as StudentStatusKind)

/**
 * テンプレ保存が、出欠記録のあるコマにその生徒を置き直していないか(spec-template-conflict-v2 §2-4「生徒の記録が勝つ」)。
 * 操作の前にそのコマ(上段の記録)に休み・振無休・出席・「移)」の記録があり、同じコマのどの席(上段・保留の下段)にもその生徒がいなかったのに、
 * 操作のあと同じコマの上段の席に座ったら stop attendance-record-overridden。fromDateKey(反映日)より前のコマは見ない(テンプレ保存は触らない)。
 * 生徒は生徒キーで見る(科目は見ない。同じコマに同じ生徒が 2 か所は INV-12 で別に止まる)。コマ×生徒ごとに 1 件。
 */
export function checkAttendanceRecordsHold(before: BoardFacts, after: BoardFacts, options: { fromDateKey?: string } = {}): PatrolFinding[] {
  const afterByCell = groupByCell(after)
  const findings: PatrolFinding[] = []
  const cells = [...groupByCell(before).entries()].sort(([left], [right]) => left.localeCompare(right))
  for (const [cellId, desks] of cells) {
    const first = desks[0]
    if (!first || (options.fromDateKey && first.dateKey < options.fromDateKey)) continue
    const seatedBefore = new Set<string>()
    const recordedKeys = new Map<string, DeskFact>()
    for (const desk of desks) {
      for (const student of [...desk.students, ...desk.pendingStudents]) if (student) seatedBefore.add(student.key)
      for (const record of desk.statuses) {
        const [studentKey = '', kind = ''] = record.split('|')
        if (studentKey && isRecordWinsStatus(kind) && !recordedKeys.has(studentKey)) recordedKeys.set(studentKey, desk)
      }
    }
    for (const [studentKey, recordDesk] of recordedKeys) {
      if (seatedBefore.has(studentKey)) continue
      const seated = (afterByCell.get(cellId) ?? []).flatMap((desk) => desk.students.filter((student): student is StudentFact => student?.key === studentKey).map((student) => ({ desk, student })))
      if (seated.length === 0) continue
      const { desk, student } = seated[0]
      findings.push({
        level: 'stop', code: 'attendance-record-overridden',
        message: `出欠記録のあるコマに生徒が置き直された(記録が勝つ・§2-4): ${placeOf(desk)} ${personOf(student)} ${lessonOf(student)}(記録は机${recordDesk.deskIndex + 1})`,
        ...locationOf(desk), studentId: studentKey,
      })
    }
  }
  return limitDeskFindings(findings, 'stop', 'attendance-record-overridden', '出欠記録のあるコマに生徒が置き直された')
}

// ── 台本 f(講師の移動・入れ替え・休み)と、講師のコマの点検 ───────────────────────────────────────

const TEACHER_ANOMALY_LABELS: Record<TeacherCellAnomaly['kind'], { code: PatrolFindingCode; label: string }> = {
  'rested-present': { code: 'teacher-rested-but-present', label: '休みの記録があるコマにその講師が居る(§9-25)' },
  duplicate: { code: 'teacher-duplicated-in-cell', label: '同じ講師が 1 コマに 2 机(INV-01)' },
}

/**
 * どの台本のあとでも当てる講師のコマの点検(boardFacts.ts の teacherAnomalies・判定はアプリの権威関数)。
 * 操作の前に無かった形(種類×コマ×講師・数で突き合わせる)が操作のあとにできたら stop。前からある形は止めない
 * (種データに最初からある形＝丸ごと振替の付け替えでできうる休みの講師〔§9-25 の対象外〕など)。reportExisting なら前からある形を info で知らせる(起動のときだけ使う)。
 */
export function checkTeacherCellIntegrity(before: BoardFacts, after: BoardFacts, options: { reportExisting?: boolean; restedPresentAsInfoDates?: ReadonlySet<string> } = {}): PatrolFinding[] {
  const keyOf = (item: TeacherCellAnomaly) => `${item.kind}\u0000${item.cellId}\u0000${item.teacher}`
  const left = new Map<string, number>()
  for (const item of before?.teacherAnomalies ?? []) left.set(keyOf(item), (left.get(keyOf(item)) ?? 0) + 1)
  const stops: PatrolFinding[] = []
  const existing: PatrolFinding[] = []
  const transferRested: PatrolFinding[] = []
  for (const item of after?.teacherAnomalies ?? []) {
    const { code, label } = TEACHER_ANOMALY_LABELS[item.kind]
    const location = { dateKey: item.dateKey, slotNumber: item.slotNumber, deskIndex: item.deskIndex }
    const where = `${formatPlace(item.dateKey, item.slotNumber, item.deskIndex)} ${item.teacher}`
    const count = left.get(keyOf(item)) ?? 0
    if (count > 0) {
      left.set(keyOf(item), count - 1)
      if (options.reportExisting) existing.push({ level: 'info', code: 'teacher-cell-anomaly-existing', message: `前からある形: ${label}: ${where}`, ...location })
      continue
    }
    // 台本 g: 丸ごと振替(付け替え)は講師の欄だけを別の日へ移し、休みの記録は元の日に残る(§9-25 の対象外・作成→解除で元の形 §9-20 と両立させるため)。
    // 作成・解除でできた「休みなのに居る」は仕様の範囲でできうる既知の形なので知らせるだけ(2026-11-11 オーナー決定: 今のまま・
    // 講師の休みが本番で使われ始めてから見直す)。同じ講師が 2 机は止める。
    // 知らせるだけにするのは、丸ごと振替の振替元・振替先の日のコマにできた形だけ(ほかの日にできたものは止める・手直し 1 M-1)。
    if (options.restedPresentAsInfoDates?.has(item.dateKey) && item.kind === 'rested-present') {
      transferRested.push({ level: 'info', code: 'teacher-rested-present-by-whole-day-transfer', message: `丸ごと振替でできた形(知らせるだけ・今のまま。講師の休みが本番で使われ始めたら見直す): ${label}: ${where}`, ...location })
      continue
    }
    stops.push({ level: 'stop', code, message: `${label}: ${where}`, ...location })
  }
  // まとめる行の code は種類ごと(休みの講師が居る形を「2 机」の code にまとめない・手直し 1 M-4)。
  const limited = (['rested-present', 'duplicate'] as const).flatMap((kind) => {
    const { code, label } = TEACHER_ANOMALY_LABELS[kind]
    return limitDeskFindings(stops.filter((finding) => finding.code === code), 'stop', code, label)
  })
  return [
    ...limited,
    ...limitDeskFindings(transferRested, 'info', 'teacher-rested-present-by-whole-day-transfer', '丸ごと振替でできた休みの講師の形'),
    ...limitDeskFindings(existing, 'info', 'teacher-cell-anomaly-existing', '前からある講師のコマの形'),
  ]
}

/**
 * 台本 f の 1 つの操作(tools/ui-patrol/scenarios.mjs の pickTeacherPlan が選ぶ)。deskIndex / targetDeskIndex は 0 始まり・同じコマ。
 * - move / teacher-swap: 長押しドラッグで deskIndex の講師を targetDeskIndex へ(講師だけ入替・移動は相手が講師なし)。
 * - seat-swap: 同じく「生徒ごと席入替」。
 * - menu-teacher: deskIndex の講師を講師メニューで teacher に替える。
 * - rest / release: deskIndex の講師を「休み」にする／「休みを解除する」。
 * - place-rested: 休みにした講師 teacher(休みの記録の名前 restedName)を、同じコマの deskIndex へ講師メニューで置く。
 */
export type TeacherOp = {
  kind: 'move' | 'teacher-swap' | 'seat-swap' | 'menu-teacher' | 'rest' | 'release' | 'place-rested'
  cellId: string
  deskIndex: number
  targetDeskIndex?: number
  teacher?: string
  restedName?: string
}

const deskContentJson = (fact: DeskFact | undefined) => JSON.stringify(fact ? [fact.students, fact.statuses, fact.memos, fact.pendingStudents, fact.pendingTeacher, fact.pendingStatuses, fact.pendingMemos] : null)

type TeacherDeskExpectation = { deskIndex: number; teacher: string; manual: boolean; teacherRest: boolean; restName: string; contentFrom: number }

/**
 * 講師の操作が盤面に効いたか(操作した机ごと)。机ごとに 講師・講師の出自(入った講師は手入力)・休みの記録・中身(生徒・出欠記録・メモ・保留の下段)を
 * 仕様の形と比べ、違えば stop teacher-op-not-applied(机ごとに 1 件・違った所を並べる)。根拠(ScheduleBoardScreen.tsx・teacherRest.ts):
 * - 講師だけ入替・移動(computeTeacherMove swapMode='teacher'): 講師ブロックだけ入れ替わり、中身は机に残る。講師が入った机は manualTeacher=true(手入力)。
 * - 生徒ごと席入替(swapMode='seat'): 講師と中身が一緒に入れ替わる。
 * - 講師メニューの保存(setManualTeacherAssignment): その机の講師が替わり手入力に。休みの記録は残る(§2-4「別の講師を手で置いて上書きできる」)。
 * - 休み(restDeskTeacher): 講師なし・休みの記録(休みにした講師の名前)・中身は残る(§9-7)。解除(releaseDeskTeacherRest): 記録だけ消える(講師欄は今のまま。
 *   続く再マージでテンプレの講師が戻るのは認める)。
 * - 休みの講師を手で置く(§9-25): 置いた机にその講師・そのコマにその講師の休みの記録が 1 つも残らない(ほかの机の記録の消え方は呼んだ側が範囲で見る)。
 */
export function checkTeacherOpApplied(before: BoardFacts, after: BoardFacts, op: TeacherOp): PatrolFinding[] {
  const deskAt = (facts: BoardFacts, deskIndex: number) => facts.desks.get(`${op.cellId}#${deskIndex}`)
  const a = deskAt(before, op.deskIndex)
  const b = op.targetDeskIndex === undefined ? undefined : deskAt(before, op.targetDeskIndex)
  const keep = (fact: DeskFact | undefined, deskIndex: number) => ({ teacherRest: fact?.teacherRest ?? false, restName: fact?.teacherRestName ?? '', contentFrom: deskIndex })
  const expectations: TeacherDeskExpectation[] = []
  if ((op.kind === 'move' || op.kind === 'teacher-swap' || op.kind === 'seat-swap') && op.targetDeskIndex !== undefined) {
    const seat = op.kind === 'seat-swap'
    expectations.push(
      { deskIndex: op.deskIndex, teacher: b?.teacher ?? '', manual: Boolean(b?.teacher), ...keep(a, op.deskIndex), contentFrom: seat ? op.targetDeskIndex : op.deskIndex },
      { deskIndex: op.targetDeskIndex, teacher: a?.teacher ?? '', manual: Boolean(a?.teacher), ...keep(b, op.targetDeskIndex), contentFrom: seat ? op.deskIndex : op.targetDeskIndex },
    )
  } else if (op.kind === 'menu-teacher' || op.kind === 'place-rested') {
    expectations.push({ deskIndex: op.deskIndex, teacher: op.teacher ?? '', manual: true, ...keep(a, op.deskIndex) })
  } else if (op.kind === 'rest') {
    expectations.push({ deskIndex: op.deskIndex, teacher: '', manual: false, teacherRest: true, restName: a?.teacher ?? '', contentFrom: op.deskIndex })
  } else if (op.kind === 'release') {
    // 解除は記録を消すだけ(講師欄は今のまま)。そのあとの再マージでテンプレの講師が戻ってよい(§2-4「次の反映でテンプレの講師が戻る」・
    // 2026-11-11 の実走で、解除した直後に同じ画面のうちにテンプレの講師が戻ることを確かめた)。戻った講師はテンプレ由来のときだけ認める。
    const got = deskAt(after, op.deskIndex)
    const templateReturned = (a?.teacher ?? '') === '' && got !== undefined && got.teacher !== '' && got.teacherOrigin === 'template'
    expectations.push({ deskIndex: op.deskIndex, teacher: templateReturned ? got.teacher : (a?.teacher ?? ''), manual: !templateReturned && a?.teacherOrigin === 'manual', teacherRest: false, restName: '', contentFrom: op.deskIndex })
  }
  const findings: PatrolFinding[] = []
  for (const expected of expectations) {
    const got = deskAt(after, expected.deskIndex)
    const source = deskAt(before, expected.contentFrom)
    const place = got ?? deskAt(before, expected.deskIndex)
    if (!got) {
      findings.push({ level: 'stop', code: 'teacher-op-not-applied', message: `講師の操作のあと机が無い: ${op.cellId} 机${expected.deskIndex + 1}`, ...(place ? locationOf(place) : {}) })
      continue
    }
    const wrong: string[] = []
    if (got.teacher !== expected.teacher) wrong.push(`講師 ${teacherText(got.teacher)}(仕様では ${teacherText(expected.teacher)})`)
    else if (expected.teacher !== '' && expected.manual && got.teacherOrigin !== 'manual') wrong.push(`講師 ${got.teacher} が手入力になっていない(${got.teacherOrigin ?? 'なし'})`)
    if (got.teacherRest !== expected.teacherRest || (expected.teacherRest && got.teacherRestName !== expected.restName)) {
      wrong.push(`休みの記録 ${got.teacherRest ? got.teacherRestName : 'なし'}(仕様では ${expected.teacherRest ? expected.restName : 'なし'})`)
    }
    if (deskContentJson(got) !== deskContentJson(source)) {
      wrong.push(expected.contentFrom === expected.deskIndex ? '生徒・出欠記録・メモが変わった(机に残るはず)' : `生徒・出欠記録・メモが机${expected.contentFrom + 1}の中身になっていない(生徒ごと入れ替わるはず)`)
    }
    if (wrong.length === 0) continue
    findings.push({ level: 'stop', code: 'teacher-op-not-applied', message: `講師の操作が仕様どおりに効いていない: ${placeOf(got)} ${wrong.join('・')}`, ...locationOf(got) })
  }
  if (op.kind === 'place-rested') {
    // 置いた講師(置いた机の講師欄の名前と講師 ID)の休みの記録がそのコマに残っていないか。照合はアプリの doesTeacherRestMatch(呼び名の対応表)。
    const placedDesk = deskAt(after, op.deskIndex)
    const placed = { teacher: placedDesk?.teacher || op.teacher || '', teacherId: placedDesk?.teacherId || undefined }
    for (const fact of after.desks.values()) {
      if (fact.cellId !== op.cellId || !fact.teacherRestRecord || !after.restMatchesTeacher(fact.teacherRestRecord, placed)) continue
      findings.push({ level: 'stop', code: 'teacher-op-not-applied', message: `休みの講師を同じコマへ手で置いたのに、休みの記録が残った(§9-25): ${placeOf(fact)} 休 ${fact.teacherRestName}`, ...locationOf(fact) })
    }
  }
  return findings
}

// ── 台本 g(休日設定と解除・丸ごと振替)の点検 ───────────────────────────────────────────────

const desksOnDate = (facts: BoardFacts, dateKey: string) => [...facts.desks.values()].filter((fact) => fact.dateKey === dateKey)

/**
 * 休日設定が盤面に効いたか(ScheduleBoardScreen.tsx の handleToggleHolidayDate・休日にする側)。その日の机ごとに、
 * 前に席(上段)に居た生徒が席から外れ、同じ机にその生徒の「休)」の記録(status='holiday'・convertHolidayDeskEntriesToRecords〔フラグ
 * transferSourceRestDisplay・全教室〕)が付いていれば所見なし。体験(trial)は記録を作らない(仕様)ので席から外れたことだけ見る。
 * 在庫の増減は checkStockDeltas(dayOps.ts の expectedHolidayStockDeltas)・ほかの日が変わらないかは checkOutsideAllowedRange が見る。
 */
export function checkHolidayApplied(before: BoardFacts, after: BoardFacts, dateKey: string): PatrolFinding[] {
  const findings: PatrolFinding[] = []
  for (const left of desksOnDate(before, dateKey).sort((a, b) => a.slotNumber - b.slotNumber || a.deskIndex - b.deskIndex)) {
    const right = after.desks.get(left.key)
    left.students.forEach((entry, seat) => {
      if (!entry) return
      const what = `${placeOf(left)} 席${seat + 1} ${personOf(entry)} ${lessonOf(entry)}`
      if (right?.students[seat]?.key === entry.key) {
        findings.push({ level: 'stop', code: 'day-op-not-applied', message: `休日にしたのに生徒が席に残った: ${what}`, ...locationOf(left), studentId: entry.key })
        return
      }
      if (entry.lessonType === 'trial') return
      const prefix = `${entry.key}|holiday|${entry.subject}|`
      if (!(right?.statuses ?? []).some((record) => record.startsWith(prefix))) {
        findings.push({ level: 'stop', code: 'day-op-not-applied', message: `休日にしたのに「休)」の記録が付かない: ${what}`, ...locationOf(left), studentId: entry.key })
      }
    })
  }
  return limitDeskFindings(findings, 'stop', 'day-op-not-applied', '休日設定が盤面に効いていない')
}

/**
 * 丸ごと振替(付け替え・docs/spec-template-conflict-v2.md §3)が盤面に効いたか。振替先 D' の机ごとに、同じ時限・同じ机番号の振替元 D の机の
 * 席(生徒と科目)がそのまま乗っていれば所見なし(授業の種類は振替〔振)〕に変わるので比べない・D' 自身のテンプレの授業は出さない＝決定記録 2)。
 * 振替元に生徒が居た机は、講師も振替元の講師(D のテンプレの講師・手置きの講師は移る)。振替元の席は空になり、テンプレの生徒の席には
 * 表示専用の「休)」(status='moved'・wholeDayPairDerived)が付く。D' の保留の下段に人が居るのも形が違う(台本は手入力の無い D' を選ぶ)。
 * 在庫は全部の鍵で ±0(移送は在庫中立)を checkStockDeltas で別に見る。
 */
export function checkWholeDayTransferApplied(before: BoardFacts, after: BoardFacts, op: { sourceDateKey: string; targetDateKey: string }): PatrolFinding[] {
  const findings: PatrolFinding[] = []
  const seatText = (entry: StudentFact | null) => (entry ? `${personOf(entry)} ${entry.subject}` : '空き')
  const sourceBySlotDesk = new Map(desksOnDate(before, op.sourceDateKey).map((fact) => [`${fact.slotNumber}#${fact.deskIndex}`, fact]))
  for (const right of desksOnDate(after, op.targetDateKey).sort((a, b) => a.slotNumber - b.slotNumber || a.deskIndex - b.deskIndex)) {
    const source = sourceBySlotDesk.get(`${right.slotNumber}#${right.deskIndex}`)
    // D' で前から置いてあった手入力の生徒は残る(§9-20)。台本は振替元の授業と重ならない D' を選ぶ(dayOps.ts の isTargetCompatible)。
    const targetBefore = before.desks.get(right.key)
    const wrong: string[] = []
    for (const seat of [0, 1]) {
      const kept = targetBefore?.students[seat]?.origin === 'manual' ? targetBefore.students[seat] : null
      const want = source?.students[seat] ?? kept ?? null
      const got = right.students[seat] ?? null
      const same = want === null ? got === null : got !== null && got.key === want.key && got.subject === want.subject
      if (!same) wrong.push(`席${seat + 1} ${seatText(got)}(振替元は ${seatText(want)})`)
    }
    if (source && source.students.some(Boolean) && right.teacher !== source.teacher) wrong.push(`講師 ${teacherText(right.teacher)}(振替元は ${teacherText(source.teacher)})`)
    if (right.pendingStudents.length > 0) wrong.push(`保留の下段に ${right.pendingStudents.map(personOf).join('・')}`)
    if (wrong.length > 0) findings.push({ level: 'stop', code: 'day-op-not-applied', message: `丸ごと振替の振替先が振替元と同じ形になっていない: ${placeOf(right)} ${wrong.join('・')}`, ...locationOf(right) })
  }
  for (const left of desksOnDate(before, op.sourceDateKey).sort((a, b) => a.slotNumber - b.slotNumber || a.deskIndex - b.deskIndex)) {
    const right = after.desks.get(left.key)
    left.students.forEach((entry, seat) => {
      if (!entry) return
      const what = `${placeOf(left)} 席${seat + 1} ${personOf(entry)} ${entry.subject}`
      if (right?.students[seat]?.key === entry.key) {
        findings.push({ level: 'stop', code: 'day-op-not-applied', message: `丸ごと振替したのに振替元の席に生徒が残った: ${what}`, ...locationOf(left), studentId: entry.key })
        return
      }
      if (entry.origin !== 'template' || entry.key.startsWith('name:')) return
      const prefix = `${entry.key}|moved|${entry.subject}|`
      if (!(right?.statuses ?? []).some((record) => record.startsWith(prefix))) {
        findings.push({ level: 'stop', code: 'day-op-not-applied', message: `丸ごと振替したのに振替元の席に「休)」が付かない: ${what}`, ...locationOf(left), studentId: entry.key })
      }
    })
  }
  return limitDeskFindings(findings, 'stop', 'day-op-not-applied', '丸ごと振替が盤面に効いていない')
}

/**
 * 休日を解除したあと、休日にする前(base)と盤面・部分が同じか(休日解除は休日設定の逆操作・2026-09-20 オーナー確定)。checkSameState と同じに比べ、
 * 休日にした日の机で、仕様で戻らないものだけが違う机は知らせるだけにする(消えて戻らないことを室長目線で知らせる。休日にした時点では残るが、休日のまま読み込み直す
 * 〔再マージ〕と、休日のコマは授業・講師・メモを持ち込まず、
 * 講師は記録のある机に限り引き継ぐ＝spec-makeup-stock §B-2-2c・inv06-holiday-record-retention.matrix.test.ts で固定):
 * メモが消えた(holiday-memo-dropped)・生徒も出欠記録も無い机の手入力の講師が消えたかテンプレの講師に替わった(holiday-teacher-dropped)。
 * その日の抑止キーの出入りも知らせるだけ(holiday-release-suppression-changed)。
 * メモの中身が変わった・生徒の居る机の講師・テンプレの講師が消えた・ほかの日・ほかの部分の違いは stop round-trip-not-restored。
 */
export function checkHolidayRoundTrip(base: BoardFacts, after: BoardFacts, dateKey: string): PatrolFinding[] {
  const diff = diffBoardFacts(base, after)
  const label = SAME_STATE_LABELS['round-trip-not-restored']
  const findings: PatrolFinding[] = []
  const stops: PatrolFinding[] = []
  /** 仕様で消えた手入力の講師(生徒も記録も無い机・休日にした日)か。 */
  const isSpecDroppedTeacher = (left: DeskFact | null | undefined, right: DeskFact | null | undefined) => Boolean(left && right
    && left.students.every((entry) => entry === null) && left.statuses.length === 0 && left.teacherOrigin === 'manual' && !left.teacherRest && !right.teacherRest
    && (right.teacher === '' || right.teacherOrigin === 'template'))
  const isMemoOrTeacherOnly = (change: (typeof diff.desks)[number]) => change.fields.every((field) => field === 'memos' || field === 'teacher')
  // 消えた手入力の講師 X の兄弟(手直し 1・B-2): 同じコマの講師が居なかった机に、X がテンプレの講師として入った分(変わったのは講師だけ)は知らせるだけ。
  // 解除のあとテンプレの X が置かれただけで、生徒と手入力は失われていない。数は消えた X の数まで(コマ×講師で数える)。
  // 手入力のまま別の机へ動いた・別の講師・別のコマ・生徒の居る机は止めるまま。
  const droppedByCellTeacher = new Map<string, number>()
  for (const change of diff.desks) {
    const left = change.before
    if (left && left.dateKey === dateKey && change.fields.includes('teacher') && isMemoOrTeacherOnly(change) && isSpecDroppedTeacher(left, change.after) && left.teacher) {
      const key = `${left.cellId}\u0000${left.teacher}`
      droppedByCellTeacher.set(key, (droppedByCellTeacher.get(key) ?? 0) + 1)
    }
  }
  const takeTemplatePlacedSibling = (left: DeskFact | null | undefined, right: DeskFact | null | undefined) => {
    if (!left || !right || left.dateKey !== dateKey || left.teacher !== '' || !right.teacher || right.teacherOrigin !== 'template' || right.teacherRest || left.teacherRest) return false
    // 机の中身(生徒・出欠記録・メモ)は変わっていない(呼ぶ側が「変わったのは講師だけ」の机に限る)。講師なしで座っていた生徒の机にテンプレの X が戻った形も含む
    // (緑が丘 11/11 03:00 の台本 g の形)。
    const key = `${right.cellId}\u0000${right.teacher}`
    const left0 = droppedByCellTeacher.get(key) ?? 0
    if (left0 <= 0) return false
    droppedByCellTeacher.set(key, left0 - 1)
    return true
  }
  for (const change of diff.desks) {
    const fact = (change.after ?? change.before)!
    const left = change.before
    const right = change.after
    if (change.fields.length === 1 && change.fields[0] === 'teacher' && takeTemplatePlacedSibling(left, right)) {
      findings.push({ level: 'info', code: 'holiday-teacher-template-placed', message: `休日のまま読み込み直して消えた手入力の講師が、解除のあと同じコマの講師の居なかった机にテンプレの講師として入った(上の「消えて戻らない」の兄弟・生徒と手入力は失われていない): ${placeOf(fact)} 講師 ${teacherText(right?.teacher ?? '')}(テンプレ)`, ...locationOf(fact) })
      continue
    }
    // 休日にした日の机で、仕様で戻らないもの(メモ・生徒も記録も無い机の手入力の講師)だけが違う机は知らせるだけ。
    const memoDropped = !change.fields.includes('memos') || (right?.memos.length ?? 0) === 0
    const teacherDropped = !change.fields.includes('teacher') || isSpecDroppedTeacher(left, right)
    if (fact.dateKey === dateKey && isMemoOrTeacherOnly(change) && memoDropped && teacherDropped) {
      if (change.fields.includes('teacher')) {
        findings.push({ level: 'info', code: 'holiday-teacher-dropped', message: `休日のまま読み込み直すと生徒の居ない机の手入力の講師は消え、解除しても戻らない(仕様・休日にした時点では残るが、再マージで休日のコマは記録のある机の講師だけ引き継ぐ): ${placeOf(fact)} 講師 ${teacherText(left?.teacher ?? '')} → ${teacherText(right?.teacher ?? '')}${right?.teacher ? '(テンプレ)' : ''}`, ...locationOf(fact) })
      }
      if (change.fields.includes('memos')) {
        findings.push({ level: 'info', code: 'holiday-memo-dropped', message: `休日のまま読み込み直すとメモは消え、解除しても戻らない(仕様・休日にした時点では残るが、再マージで休日のコマはメモを持ち込まない): ${placeOf(fact)} メモ ${left?.memos.length ?? 0} 件`, ...locationOf(fact) })
      }
      continue
    }
    stops.push({ level: 'stop', code: 'round-trip-not-restored', message: `${label}: ${describeDeskChange(change)}`, ...locationOf(fact) })
  }
  const SUPPRESSED = 'boardState.suppressedRegularLessonOccurrences'
  const sectionFindings: PatrolFinding[] = []
  for (const section of diff.sections) {
    if (section === SUPPRESSED) {
      const keysOf = (signature: string | undefined) => {
        try {
          const value = JSON.parse(signature ?? 'null')
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
        } catch {
          return null
        }
      }
      const left = keysOf(base.sections[section])
      const right = keysOf(after.sections[section])
      if (left && right) {
        const removed = left.filter((key) => !right.includes(key))
        const added = right.filter((key) => !left.includes(key))
        const noDuplicates = JSON.stringify([...left].sort()) === JSON.stringify([...new Set(left)].sort()) && JSON.stringify([...right].sort()) === JSON.stringify([...new Set(right)].sort())
        // その日の通常授業の抑止キー(生徒__科目__日付__時限)の出入りだけなら仕様(席へ戻した授業の鍵を外す・戻せなかった授業の鍵を積む)。
        if (noDuplicates && [...removed, ...added].every((key) => key.includes(`__${dateKey}__`))) {
          sectionFindings.push({ level: 'info', code: 'holiday-release-suppression-changed', message: `休日の解除で、その日の抑止キーが休日にする前と違う(仕様・席へ戻した授業の鍵は外し戻せなかった授業の鍵は積む): 外れた ${removed.length}・増えた ${added.length}(盤面の机は別に比べる)`, dateKey })
          continue
        }
      }
    }
    sectionFindings.push({ level: 'stop', code: 'round-trip-not-restored', message: `${label}: ${section}` })
  }
  // 止めるものは 20 件＋「ほか n 机」、知らせるものも同じ。机の並び順(日付・時限・机)で 1 本にまとめる。
  const position = (finding: PatrolFinding) => `${finding.dateKey ?? '\uffff'}\u0000${String(finding.slotNumber ?? 0).padStart(3, '0')}\u0000${String(finding.deskIndex ?? 0).padStart(3, '0')}`
  const merged = [
    ...limitDeskFindings(stops, 'stop', 'round-trip-not-restored', label),
    ...limitDeskFindings(findings.filter((finding) => finding.code === 'holiday-teacher-dropped'), 'info', 'holiday-teacher-dropped', '休日のまま読み込み直すと消えて戻らない手入力の講師'),
    ...limitDeskFindings(findings.filter((finding) => finding.code === 'holiday-memo-dropped'), 'info', 'holiday-memo-dropped', '休日のまま読み込み直すと消えて戻らないメモ'),
    ...limitDeskFindings(findings.filter((finding) => finding.code === 'holiday-teacher-template-placed'), 'info', 'holiday-teacher-template-placed', '消えた手入力の講師がテンプレの講師として入った机'),
  ].sort((left, right) => position(left).localeCompare(position(right)))
  return [...merged, ...sectionFindings]
}

// ── 台本 h(講習の自動割振・2026-11-11 第 2 段の 5 本目・既定では流さない)。入口は「未消化講習」の生徒の行 → 自動割振(振替も同時に、の選択つき)
// = ScheduleBoardScreen.tsx の handleAutoAssignLectureStockEntry。置くのは生徒の席だけ(講師は置かない・在庫の台帳は講習の分だけ書く)。

/** 台本 h の 1 回の自動割振。studentKey＝生徒 ID・entryKey＝未消化講習の行の鍵(生徒キー__講習 ID)・期間は講習の期間(YYYY-MM-DD)。announced は押したあとの画面の文。 */
export type AutoAssignOp = { studentKey: string; entryKey: string; includeMakeup: boolean; periodStart: string; periodEnd: string; announced?: string }
/** 自動割振で置かれた 1 席(前は空いていた席に、その生徒が座った)。deskIndex・seat は 0 始まり。 */
export type AutoAssignPlacement = { cellId: string; dateKey: string; slotNumber: number; deskIndex: number; seat: number; lessonType: string; subject: string; deskKey: string }

/** 前は空いていた席に、その生徒(studentKey)が座った席。並びは日付・時限・机・席。 */
export function collectAutoAssignPlacements(before: BoardFacts, after: BoardFacts, studentKey: string): AutoAssignPlacement[] {
  const placements: AutoAssignPlacement[] = []
  for (const change of diffBoardFacts(before, after).desks) {
    const next = change.after
    if (!next) continue
    next.students.forEach((entry, seat) => {
      if (!entry || entry.key !== studentKey || (change.before?.students[seat] ?? null) !== null) return
      placements.push({ cellId: next.cellId, dateKey: next.dateKey, slotNumber: next.slotNumber, deskIndex: next.deskIndex, seat, lessonType: entry.lessonType, subject: entry.subject, deskKey: next.key })
    })
  }
  return placements
}

/**
 * 自動割振の画面の文(boardResultMessages.ts の buildAutoAssignResultMessage)から、置いた数を読む。
 * 「…を自動割振しました（3コマ…」→ 講習 3・振替 0／「…（講習2・振替1コマ…」→ 講習 2・振替 1。割り振れなかった文などは null。
 */
export function parseAutoAssignAnnouncedCounts(message: string | undefined): { lecture: number; makeup: number } | null {
  const text = message ?? ''
  const both = /を自動割振しました（講習(\d+)・振替(\d+)コマ/u.exec(text)
  if (both) return { lecture: Number(both[1]), makeup: Number(both[2]) }
  const only = /を自動割振しました（(\d+)コマ/u.exec(text)
  return only ? { lecture: Number(only[1]), makeup: 0 } : null
}

/**
 * 自動割振が盤面に正しく効いたか(在庫の増減は呼んだ側が checkStockDeltas で見る)。根拠は handleAutoAssignLectureStockEntry と findBestAutoAssignCandidate:
 * - 変わってよいのは、前は空いていた席にその生徒の講習(振替も同時に、なら振替も)が座ることだけ。机の講師・出欠記録・メモ・保留の下段・ほかの席が変わったら
 *   stop auto-assign-outside-placement(手入力・通常授業が動く・消える＝INV-02)。
 * - 見るのは講習の期間の机だけ(期間の外の机の変化は checkOutsideAllowedRange の範囲の外として出る・2 回出さない)。
 * - 置いた席は、開いているコマ・本物の講師がいた机(desk.teacher が空の机は候補にしない)。外れたら stop auto-assign-rule-violated。
 *   同じコマに同じ生徒が 2 席(INV-01)・出席不可のコマ・制約事項は autoAssign.ts の checkAutoAssignPlacementRules が見る(アプリの関数を呼ぶ)。
 * - 画面の文の件数(講習・振替)と置いた席の数が違えば stop auto-assign-count-mismatch(INV-06 の「置いた数と減った数」の片方)。
 */
export function checkAutoAssignApplied(before: BoardFacts, after: BoardFacts, op: AutoAssignOp): PatrolFinding[] {
  const outside: PatrolFinding[] = []
  const violated: PatrolFinding[] = []
  const allowedTypes = new Set(op.includeMakeup ? ['special', 'makeup'] : ['special'])
  const placements: AutoAssignPlacement[] = []
  for (const change of diffBoardFacts(before, after).desks) {
    const fact = (change.after ?? change.before)!
    // 期間の外の机の変化は、ほかの台本と同じく checkOutsideAllowedRange(範囲＝期間の机)が拾う。ここでも拾うと同じ所が 2 回出る(手直し 1 M-3)。
    if (fact.dateKey < op.periodStart || fact.dateKey > op.periodEnd) continue
    const other = change.fields.filter((field) => field !== 'students')
    if (other.length > 0 || !change.after) {
      outside.push({ level: 'stop', code: 'auto-assign-outside-placement', message: `自動割振で置いた席のほかが変わった: ${describeDeskChange(change)}`, ...locationOf(fact) })
    }
    if (!change.after) continue
    change.after.students.forEach((entry, seat) => {
      const previous = change.before?.students[seat] ?? null
      if (JSON.stringify(previous) === JSON.stringify(entry)) return
      if (previous === null && entry && entry.key === op.studentKey && allowedTypes.has(entry.lessonType)) {
        placements.push({ cellId: fact.cellId, dateKey: fact.dateKey, slotNumber: fact.slotNumber, deskIndex: fact.deskIndex, seat, lessonType: entry.lessonType, subject: entry.subject, deskKey: fact.key })
        return
      }
      const was = previous ? `${personOf(previous)} ${lessonOf(previous)}` : '空き'
      const now = entry ? `${personOf(entry)} ${lessonOf(entry)}` : '空き'
      outside.push({ level: 'stop', code: 'auto-assign-outside-placement', message: `自動割振で置いた席のほかが変わった: ${placeOf(fact)} 席${seat + 1} ${was} → ${now}`, ...locationOf(fact), ...(previous && !previous.key.startsWith('name:') ? { studentId: previous.key } : {}) })
    })
  }
  for (const placed of placements) {
    const where = `${formatPlace(placed.dateKey, placed.slotNumber, placed.deskIndex)} 席${placed.seat + 1} ${placed.subject} ${LESSON_TYPE_LABELS[placed.lessonType] ?? placed.lessonType}`
    const location = { dateKey: placed.dateKey, slotNumber: placed.slotNumber, deskIndex: placed.deskIndex, studentId: op.studentKey }
    const reasons: string[] = []
    const previousDesk = before.desks.get(placed.deskKey)
    if (!previousDesk || previousDesk.teacher === '') reasons.push('講師のいない机')
    if (!after.desks.get(placed.deskKey)?.cellOpen) reasons.push('休校のコマ')
    for (const reason of reasons) violated.push({ level: 'stop', code: 'auto-assign-rule-violated', message: `自動割振で置いた席が決まりに反する(${reason}): ${where} ${op.studentKey}`, ...location })
  }
  const counted: PatrolFinding[] = []
  const announced = parseAutoAssignAnnouncedCounts(op.announced)
  if (announced) {
    const lecture = placements.filter((item) => item.lessonType === 'special').length
    const makeup = placements.filter((item) => item.lessonType === 'makeup').length
    if (announced.lecture !== lecture || announced.makeup !== makeup) {
      counted.push({ level: 'stop', code: 'auto-assign-count-mismatch', message: `自動割振の画面の文の件数と置いた席の数が違う: 文 講習 ${announced.lecture}・振替 ${announced.makeup}／盤面 講習 ${lecture}・振替 ${makeup}(${op.studentKey})`, studentId: op.studentKey })
    }
  }
  return [
    ...limitDeskFindings(outside, 'stop', 'auto-assign-outside-placement', '自動割振で置いた席のほかが変わった'),
    ...limitDeskFindings(violated, 'stop', 'auto-assign-rule-violated', '自動割振で置いた席が決まりに反する'),
    ...counted,
  ]
}
