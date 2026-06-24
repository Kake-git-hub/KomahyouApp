export type SpecialSessionTeacherInput = {
  unavailableSlots: string[]
  countSubmitted: boolean
  submissionToken?: string
  updatedAt: string
}

export type SpecialSessionStudentInput = {
  unavailableSlots: string[]
  regularBreakSlots: string[]
  subjectSlots: Record<string, number>
  // spec-lecture-stock §6 / TODO4: 科目ごとの授業時間(分)。未設定=90分扱い。
  // 既存提出データとの後方互換のため追加(optional)。subjectSlots は回数のまま維持する。
  subjectDurations?: Record<string, number>
  // spec-group-lesson §C: 集団授業(中3)の参加/不参加。科目('集団理科'|'集団社会') -> true=参加。
  // 回数ではなく参加可否。未設定=不参加。既存提出データとの後方互換のため optional。
  // 講習ストック/振替には影響させず、回数表(集理/集社)にのみ反映する。
  groupClassParticipation?: Record<string, boolean>
  regularOnly: boolean
  countSubmitted: boolean
  submissionToken?: string
  updatedAt: string
}

// 講習の授業時間(分)。90=既定、60/45 を許容。未設定や不正値は 90 に丸める。
export const lectureDurationOptions = [90, 60, 45] as const
export type LectureDurationMinutes = (typeof lectureDurationOptions)[number]

export function resolveLectureSubjectDuration(
  input: Pick<SpecialSessionStudentInput, 'subjectDurations'> | null | undefined,
  subject: string,
): LectureDurationMinutes {
  const raw = input?.subjectDurations?.[subject]
  return raw === 60 || raw === 45 ? raw : 90
}

// spec-group-lesson §C: 集団授業の希望提出科目（中3のみ表示）。
// 盤面の GroupClassSubject と同じラベルでキーを揃える。
export const groupClassSubmissionSubjects = ['集団理科', '集団社会'] as const
export type GroupClassSubmissionSubject = (typeof groupClassSubmissionSubjects)[number]

// 集団授業の参加可否。未設定や true 以外は不参加（既定）として扱う。
export function resolveGroupClassParticipation(
  input: Pick<SpecialSessionStudentInput, 'groupClassParticipation'> | null | undefined,
  subject: string,
): boolean {
  return input?.groupClassParticipation?.[subject] === true
}

// spec-group-lesson §C / Phase 7（2026-06-16）: 生徒日程表の「登録」で集団参加チェックをまとめて保存する。
// 室長の登録メッセージ（schedule-student-count-save）が運ぶ groupClassParticipation を反映するためのヘルパ。
//   raw === undefined（unsubmit 等で集団情報を送らないケース）→ 既存値を保全（消さない）。
//   raw が指定された場合 → 既知の集団科目だけを true で抽出して採用（空オブジェクト＝全不参加も尊重）。
// これを反映しないと生徒日程表での集団登録が出席者一覧に出ない回帰になる（QR提出は別経路で反映されるため気付きにくい）。
export function resolveSavedGroupClassParticipation(
  raw: unknown,
  previous: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  if (raw === undefined) return previous ?? {}
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const result: Record<string, boolean> = {}
  for (const subject of groupClassSubmissionSubjects) {
    if (source[subject] === true) result[subject] = true
  }
  return result
}

export type SpecialSessionRow = {
  id: string
  label: string
  startDate: string
  endDate: string
  teacherInputs: Record<string, SpecialSessionTeacherInput>
  studentInputs: Record<string, SpecialSessionStudentInput>
  createdAt: string
  updatedAt: string
}

export const removedDefaultSpecialSessionIds = [
  'session_2026_summer',
  'session_2026_spring',
  'session_2026_exam',
  'session_2026_winter',
]

export const initialSpecialSessions: SpecialSessionRow[] = []