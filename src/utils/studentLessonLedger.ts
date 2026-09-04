// 生徒授業台帳（生徒×科目ごとの授業実績と未消化を、元コマ一覧つきで定期記録する）。
//
// 背景（2026-09-04 オーナー指示）: 操作ログ（operationLog.ts）は「減った・消えた理由」を残すが、
// 「ある時点で各生徒の授業数・未消化数がいくつだったか」は復元できない（残数は保存せず毎回計算し、
// 過去の盤面は7日分のバックアップしか無い）。**未消化数は重要な項目**なので、任意の時点の状態を
// コマ単位で振り返れるよう、保存のたびにこの台帳を計算して保存に相乗りさせ、サーバーが日付ごとに残す。
//
// 設計の要点:
//  - **計算は盤面画面と同じ関数**（buildMakeupStockEntries / buildLecturePendingItemsByEntryKey）で行う。
//    画面に出ている未消化数と台帳の数字が食い違わないことが最優先。生徒キーの解決も盤面と同じ規則。
//  - 盤面の実績（出席／休み／振無休／配置）はコマ単位のトークン `YYYY-MM-DD#限` で持つ。
//  - **在庫の状態が変わったときだけ送る**（指紋比較）。日常の保存に毎回同じ台帳を載せて通信量を増やさない。
//  - 置き場所・保持は functions/src/lessonLedger.ts と docs/spec-save-restore.md §8-1c。
import { getStudentDisplayName, type StudentRow } from '../components/basic-data/basicDataModel'
import { applyClassroomAvailability } from '../components/schedule-board/ScheduleBoardScreen'
import { buildLecturePendingItemsByEntryKey, buildLectureStockEntries } from '../components/schedule-board/lectureStock'
import { buildMakeupStockEntries } from '../components/schedule-board/makeupStock'
import type { SlotCell, StudentEntry } from '../components/schedule-board/types'
import type { AppSnapshotPayload } from '../types/appState'

export const STUDENT_LESSON_LEDGER_VERSION = 1
/** 実績・配置トークンを台帳に載せる過去日数の上限（未消化の元コマ一覧はこの制限を受けない）。 */
export const LEDGER_HISTORY_DAYS = 400

/** 生徒×科目の1行。トークンは `YYYY-MM-DD#限` に `|` 区切りで付帯情報を続ける。 */
export type StudentLessonLedgerRow = {
  /** 名簿の生徒 id（未管理・手動追加は null） */
  studentId: string | null
  /** 在庫キーの生徒側（盤面と同じ規則: 管理生徒=ID／未管理=`name:表示名`／手動追加=`manual:` 付き） */
  studentKey: string
  name: string
  subject: string
  /** 未消化振替の残数（画面の「未消化振替」と同じ値） */
  makeupBalance: number
  /** 未消化振替の元コマ一覧 `YYYY-MM-DD#限|理由ラベル`（限が不明なら `#` の後は空） */
  makeupRemaining: string[]
  /** 出席済みのコマ `YYYY-MM-DD#限|授業種別` */
  attended: string[]
  /** 休み（振替あり）のコマ `YYYY-MM-DD#限|授業種別|振替元日` */
  absent: string[]
  /** 振無休のコマ `YYYY-MM-DD#限|授業種別` */
  absentNoMakeup: string[]
  /** 未出欠の配置コマ `YYYY-MM-DD#限|授業種別|振替元日`（振替・講習は元日／元コマを持つ） */
  placed: string[]
}

export type StudentLessonLedgerLectureRow = {
  studentId: string
  name: string
  sessionId: string
  sessionLabel: string
  subject: string
  /** 未消化講習の残数（画面の「未消化講習」と同じ値） */
  pending: number
  /** 未消化講習の元コマ一覧（休みで戻した分など。元コマが無い希望数分は空） */
  origins: string[]
}

export type StudentLessonLedger = {
  version: typeof STUDENT_LESSON_LEDGER_VERSION
  /** 計算した時刻（保存時刻と同じ ISO） */
  computedAt: string
  rows: StudentLessonLedgerRow[]
  lectureRows: StudentLessonLedgerLectureRow[]
  totals: {
    makeupBalance: number
    lecturePending: number
    attended: number
    placed: number
  }
}

function buildToken(dateKey: string, slotNumber: number | null | undefined, ...extra: Array<string | null | undefined>) {
  return [`${dateKey}#${slotNumber ?? ''}`, ...extra.map((value) => value ?? '')].join('|').replace(/\|+$/, '')
}

// 盤面画面 resolveBoardStudentStockId と同じ規則（tools/vanishedMakeupReportEntry.ts と同じ複製）。
// ★ScheduleBoardScreen 側を変えたらここも合わせる（台帳の数字が画面とズレる）。
function createStudentKeyResolver(students: StudentRow[]) {
  const studentByAnyName = new Map<string, StudentRow>()
  const displayNameByAnyName = new Map<string, string>()
  for (const student of students) {
    const displayName = getStudentDisplayName(student)
    studentByAnyName.set(student.name, student)
    studentByAnyName.set(displayName, student)
    displayNameByAnyName.set(student.name, displayName)
    displayNameByAnyName.set(displayName, displayName)
  }
  const resolveStudentKey = (student: Pick<StudentEntry, 'managedStudentId' | 'name' | 'manualAdded'>) => {
    const managedId = student.managedStudentId ?? studentByAnyName.get(student.name)?.id
    if (managedId) return managedId
    const fallbackId = `name:${displayNameByAnyName.get(student.name) ?? student.name}`
    return student.manualAdded ? `manual:${fallbackId}` : fallbackId
  }
  const resolveDisplayName = (name: string) => displayNameByAnyName.get(name) ?? name
  return { resolveStudentKey, resolveDisplayName, studentByAnyName }
}

export function buildStudentLessonLedger(params: { payload: AppSnapshotPayload; now?: Date }): StudentLessonLedger | null {
  const { payload } = params
  const now = params.now ?? new Date()
  const boardState = payload.boardState
  if (!boardState || !Array.isArray(boardState.weeks)) return null

  const students = payload.students ?? []
  const { resolveStudentKey, resolveDisplayName } = createStudentKeyResolver(students)
  const studentById = new Map(students.map((student) => [student.id, student]))
  const weeks: SlotCell[][] = applyClassroomAvailability(boardState.weeks, payload.classroomSettings)

  const entries = buildMakeupStockEntries({
    students,
    teachers: payload.teachers ?? [],
    regularLessons: payload.regularLessons ?? [],
    classroomSettings: payload.classroomSettings,
    weeks,
    manualAdjustments: boardState.manualMakeupAdjustments ?? {},
    suppressedOrigins: boardState.suppressedMakeupOrigins ?? {},
    fallbackStudents: boardState.fallbackMakeupStudents ?? {},
    resolveStudentKey: (student) => resolveStudentKey(student),
    today: now,
  })

  const rowByKey = new Map<string, StudentLessonLedgerRow>()
  const ensureRow = (studentKey: string, subject: string, name: string) => {
    const key = `${studentKey}__${subject}`
    let row = rowByKey.get(key)
    if (!row) {
      const normalizedStudentKey = studentKey.replace(/^manual:/, '')
      row = {
        studentId: studentById.has(normalizedStudentKey) ? normalizedStudentKey : null,
        studentKey,
        name,
        subject,
        makeupBalance: 0,
        makeupRemaining: [],
        attended: [],
        absent: [],
        absentNoMakeup: [],
        placed: [],
      }
      rowByKey.set(key, row)
    }
    return row
  }

  for (const entry of entries) {
    const [studentKey, subject = ''] = entry.key.split('__')
    const row = ensureRow(studentKey, subject, entry.displayName)
    row.makeupBalance = entry.balance
    row.makeupRemaining = entry.remainingOriginDates.map((dateKey, index) => (
      buildToken(dateKey, entry.remainingOriginSlots[index], entry.remainingOriginReasonLabels[index])
    ))
  }

  // 実績・配置は直近 LEDGER_HISTORY_DAYS 日より前のコマを載せない（盤面は無期限に週を保持するため、
  // 何年も経つと台帳が肥大化する。振り返りの対象は「1年分」なので余裕を持って 400 日に切る）。
  const historyFloor = new Date(now.getTime() - LEDGER_HISTORY_DAYS * 24 * 60 * 60 * 1000)
  const historyFloorKey = `${historyFloor.getFullYear()}-${`${historyFloor.getMonth() + 1}`.padStart(2, '0')}-${`${historyFloor.getDate()}`.padStart(2, '0')}`
  for (const week of weeks) {
    for (const cell of week) {
      if (cell.dateKey < historyFloorKey) continue
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (!student) continue
          const row = ensureRow(resolveStudentKey(student), student.subject, resolveDisplayName(student.name))
          row.placed.push(buildToken(cell.dateKey, cell.slotNumber, student.lessonType ?? '', student.makeupSourceDate))
        }
        for (const status of desk.statusSlots ?? []) {
          if (!status) continue
          const row = ensureRow(resolveStudentKey(status), status.subject, resolveDisplayName(status.name))
          if (status.status === 'attended') {
            row.attended.push(buildToken(cell.dateKey, cell.slotNumber, status.lessonType ?? ''))
          } else if (status.status === 'absent') {
            row.absent.push(buildToken(cell.dateKey, cell.slotNumber, status.lessonType ?? '', status.makeupSourceDate))
          } else if (status.status === 'absent-no-makeup') {
            row.absentNoMakeup.push(buildToken(cell.dateKey, cell.slotNumber, status.lessonType ?? ''))
          }
          // moved（移動元マーカー）は授業でも在庫でもないので載せない（移動先の配置が載る）。
        }
      }
    }
  }

  const referenceDate = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`
  const lecturePending = buildLecturePendingItemsByEntryKey({
    rawLectureStockEntries: buildLectureStockEntries({ specialSessions: payload.specialSessions ?? [], students, referenceDate }),
    specialSessions: payload.specialSessions ?? [],
    manualLectureStockCounts: boardState.manualLectureStockCounts ?? {},
    manualLectureStockOrigins: boardState.manualLectureStockOrigins ?? {},
    fallbackLectureStockStudents: boardState.fallbackLectureStockStudents ?? {},
  })
  const lectureRows: StudentLessonLedgerLectureRow[] = []
  for (const scoped of lecturePending.values()) {
    if (scoped.pendingItems.length === 0) continue
    const bySubject = new Map<string, { pending: number; origins: string[] }>()
    for (const item of scoped.pendingItems) {
      const current = bySubject.get(item.subject) ?? { pending: 0, origins: [] }
      current.pending += 1
      if (item.originDateKey) current.origins.push(buildToken(item.originDateKey, item.originSlotNumber))
      bySubject.set(item.subject, current)
    }
    for (const [subject, value] of bySubject) {
      lectureRows.push({
        studentId: scoped.studentId ?? '',
        name: scoped.displayName,
        sessionId: scoped.sessionId ?? '',
        sessionLabel: scoped.sessionLabel ?? '',
        subject,
        pending: value.pending,
        origins: value.origins.sort(),
      })
    }
  }

  const rows = Array.from(rowByKey.values())
    .map((row) => ({
      ...row,
      makeupRemaining: [...row.makeupRemaining].sort(),
      attended: [...row.attended].sort(),
      absent: [...row.absent].sort(),
      absentNoMakeup: [...row.absentNoMakeup].sort(),
      placed: [...row.placed].sort(),
    }))
    .sort((left, right) => left.studentKey.localeCompare(right.studentKey) || left.subject.localeCompare(right.subject, 'ja'))
  lectureRows.sort((left, right) => left.studentId.localeCompare(right.studentId) || left.sessionId.localeCompare(right.sessionId) || left.subject.localeCompare(right.subject, 'ja'))

  return {
    version: STUDENT_LESSON_LEDGER_VERSION,
    computedAt: now.toISOString(),
    rows,
    lectureRows,
    totals: {
      makeupBalance: rows.reduce((sum, row) => sum + row.makeupBalance, 0),
      lecturePending: lectureRows.reduce((sum, row) => sum + row.pending, 0),
      attended: rows.reduce((sum, row) => sum + row.attended.length, 0),
      placed: rows.reduce((sum, row) => sum + row.placed.length, 0),
    },
  }
}

// ---------------------------------------------------------------------------
// 送信の間引き（内容が変わったときだけ保存に載せる）
// ---------------------------------------------------------------------------

/** computedAt を除いた内容の指紋（FNV-1a 32bit）。同じ内容なら同じ値。 */
export function resolveStudentLessonLedgerFingerprint(ledger: StudentLessonLedger): string {
  const text = JSON.stringify({ ...ledger, computedAt: '' })
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}-${text.length.toString(36)}`
}

const lastSentFingerprintByClassroomId = new Map<string, string>()

/**
 * この教室へ前回送った台帳と内容が同じなら送らない。ただし**日付（JST）が変わったら内容が同じでも送る**
 * （その日の台帳ドキュメントを必ず1つ作り、「その日の状態」を日付キーで引けるようにするため）。
 */
export function shouldSendStudentLessonLedger(classroomId: string, fingerprint: string, jstDateKey: string): boolean {
  if (!classroomId) return false
  return lastSentFingerprintByClassroomId.get(classroomId) !== `${jstDateKey}:${fingerprint}`
}

export function markStudentLessonLedgerSent(classroomId: string, fingerprint: string, jstDateKey: string): void {
  if (!classroomId) return
  lastSentFingerprintByClassroomId.set(classroomId, `${jstDateKey}:${fingerprint}`)
}

export function clearStudentLessonLedgerSyncState(): void {
  lastSentFingerprintByClassroomId.clear()
}

/** ISO 時刻 → JST の日付キー（サーバー側 functions/src/lessonLedger.ts と同じ定義）。 */
export function toJstDateKey(iso: string): string {
  const time = Date.parse(iso)
  const jst = new Date((Number.isFinite(time) ? time : Date.now()) + 9 * 60 * 60 * 1000)
  return `${jst.getUTCFullYear()}-${`${jst.getUTCMonth() + 1}`.padStart(2, '0')}-${`${jst.getUTCDate()}`.padStart(2, '0')}`
}
