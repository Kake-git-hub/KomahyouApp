// 講習集計結果の「提出方法」。'qr'=保護者/講師がQRから提出、'manual'=室長が日程表の登録操作で確定。
// 未設定=不明(この機能導入前に登録済みだった既存データ)。後方互換のため optional。
export type SubmissionMethod = 'qr' | 'manual'

export type SpecialSessionTeacherInput = {
  unavailableSlots: string[]
  // 「後から出席可能に変更」されたコマ(2026-07-18 塚田先生要望)。提出された unavailableSlots は
  // 不変のまま(INV-07)、室長の明示操作(講師日程表のセルクリック→確認)でここに追記する上書きレイヤ。
  // 実効不可 = unavailableSlots − reopenedSlots(resolveEffectiveUnavailableSlots)。
  // 登録解除では保持し、QRからの新規再提出で空にリセットする(新しい提出が正)。戻す操作は設けない(ラチェット)。
  reopenedSlots?: string[]
  countSubmitted: boolean
  submissionToken?: string
  // 講習集計結果表示用。提出(登録)された日時(ISO文字列)と方法。登録解除で null/undefined に戻す。
  // 既存データ(未搬送)や登録前は未設定=表示は '—'。後方互換のため optional。
  submittedAt?: string | null
  submissionMethod?: SubmissionMethod
  // 混入防止(2026-07-09): このトークンを発行した教室ID。開発用教室が他教室の生データを
  // コピーしたときに「他教室由来のトークン」を見分けて弾くために使う(開発用教室でのみ判定)。
  // 本番教室ではこの値を参照せず、既存(未タグ)トークンも従来どおり動く。後方互換のため optional。
  submissionTokenClassroomId?: string
  updatedAt: string
}

export type SpecialSessionStudentInput = {
  unavailableSlots: string[]
  // 「後から出席可能に変更」されたコマ(2026-07-18 塚田先生要望)。提出された unavailableSlots は
  // 不変のまま(INV-07)、室長が不可コマへ配置/移動を確認ダイアログで承認したときにここへ追記する上書きレイヤ。
  // 実効不可 = unavailableSlots − reopenedSlots(resolveEffectiveUnavailableSlots)。日程表/QRでは黄色表示。
  // 登録解除では保持し、QRからの新規再提出で空にリセットする(新しい提出が正)。戻す操作は設けない(ラチェット)。
  reopenedSlots?: string[]
  regularBreakSlots: string[]
  subjectSlots: Record<string, number>
  // spec-lecture-stock §6 / TODO4: 科目ごとの授業時間(分)。未設定=90分扱い。
  // 既存提出データとの後方互換のため追加(optional)。subjectSlots は回数のまま維持する。
  subjectDurations?: Record<string, number>
  // spec-group-lesson §C: 集団授業(中3)の参加/不参加。科目('集団理科'|'集団社会') -> true=参加。
  // 回数ではなく参加可否。未設定=不参加。既存提出データとの後方互換のため optional。
  // 講習ストック/振替には影響させず、回数表(集理/集社)にのみ反映する。
  groupClassParticipation?: Record<string, boolean>
  // 生徒日程表のオプション欄(開発用教室)。QRで提出されたチェック状態。
  // キー=行番号('0'..'4') -> true=チェック。未設定/false=未チェック(既定)。後方互換のため optional。
  optionChecks?: Record<string, boolean>
  regularOnly: boolean
  countSubmitted: boolean
  submissionToken?: string
  // 混入防止(2026-07-09): このトークンを発行した教室ID。開発用教室が他教室の生データを
  // コピーしたときに「他教室由来のトークン」を見分けて弾くために使う(開発用教室でのみ判定)。
  // 本番教室ではこの値を参照せず、既存(未タグ)トークンも従来どおり動く。後方互換のため optional。
  submissionTokenClassroomId?: string
  // 講習集計結果表示用。提出(登録)された日時(ISO文字列)と方法。登録解除で null/undefined に戻す。
  // 既存データ(未搬送)や登録前は未設定=表示は '—'。後方互換のため optional。
  submittedAt?: string | null
  submissionMethod?: SubmissionMethod
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

// 「後から出席可能に変更」レイヤの共有ヘルパ群(2026-07-18)。
// 不可コマの実効判定(警告・自動割振・○×記号・在庫アイテム)は必ずこの関数を通す。
// unavailableSlots を直接読むと reopenedSlots(出席可能に変更)が効かず、黄色コマに赤警告が出続ける回帰になる。
export function resolveEffectiveUnavailableSlots(
  input: Pick<SpecialSessionStudentInput, 'unavailableSlots' | 'reopenedSlots'> | Pick<SpecialSessionTeacherInput, 'unavailableSlots' | 'reopenedSlots'> | null | undefined,
): string[] {
  if (!input) return []
  const unavailable = Array.isArray(input.unavailableSlots) ? input.unavailableSlots : []
  const reopened = new Set(Array.isArray(input.reopenedSlots) ? input.reopenedSlots : [])
  if (reopened.size === 0) return unavailable
  return unavailable.filter((slotKey) => !reopened.has(slotKey))
}

// 表示用: 「不可提出かつ出席可能に変更済み」= 黄色コマの集合(交差)。
// reopenedSlots 単独では表示しない(新規再提出後の残骸を黄色に出さないため、必ず unavailableSlots との交差を取る)。
export function resolveReopenedUnavailableSlots(
  input: Pick<SpecialSessionStudentInput, 'unavailableSlots' | 'reopenedSlots'> | Pick<SpecialSessionTeacherInput, 'unavailableSlots' | 'reopenedSlots'> | null | undefined,
): string[] {
  if (!input) return []
  const reopened = new Set(Array.isArray(input.reopenedSlots) ? input.reopenedSlots : [])
  if (reopened.size === 0) return []
  const unavailable = Array.isArray(input.unavailableSlots) ? input.unavailableSlots : []
  return unavailable.filter((slotKey) => reopened.has(slotKey))
}

export type ReopenSlotTarget = {
  personType: 'student' | 'teacher'
  personId: string
  slotKey: string
}

// 「出席可能に変更」のラチェット追記(純関数)。対象者の unavailableSlots に含まれ、まだ reopenedSlots に
// 無い slotKey だけを追加する(冪等・再実行しても二重追加しない)。該当が無いセッション/入力は参照を維持する。
// 提出データ(unavailableSlots)自体は変更しない(INV-07: 提出はユーザーの登録解除でのみ消える)。
export function appendReopenedSlots(
  sessions: SpecialSessionRow[],
  targets: ReopenSlotTarget[],
  updatedAt: string,
): SpecialSessionRow[] {
  if (targets.length === 0) return sessions
  return sessions.map((session) => {
    let studentInputs = session.studentInputs
    let teacherInputs = session.teacherInputs
    let changed = false
    for (const target of targets) {
      const dateKey = target.slotKey.split('_')[0] ?? ''
      if (!dateKey || dateKey < session.startDate || dateKey > session.endDate) continue
      if (target.personType === 'student') {
        const input = studentInputs[target.personId]
        if (!input || !input.unavailableSlots.includes(target.slotKey)) continue
        if ((input.reopenedSlots ?? []).includes(target.slotKey)) continue
        studentInputs = {
          ...studentInputs,
          [target.personId]: {
            ...input,
            reopenedSlots: [...(input.reopenedSlots ?? []), target.slotKey].sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
            updatedAt,
          },
        }
        changed = true
      } else {
        const input = teacherInputs[target.personId]
        if (!input || !input.unavailableSlots.includes(target.slotKey)) continue
        if ((input.reopenedSlots ?? []).includes(target.slotKey)) continue
        teacherInputs = {
          ...teacherInputs,
          [target.personId]: {
            ...input,
            reopenedSlots: [...(input.reopenedSlots ?? []), target.slotKey].sort((left, right) => left.localeCompare(right, 'ja', { numeric: true })),
            updatedAt,
          },
        }
        changed = true
      }
    }
    if (!changed) return session
    return { ...session, studentInputs, teacherInputs, updatedAt }
  })
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