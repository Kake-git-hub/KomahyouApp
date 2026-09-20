export type LessonType = 'extra' | 'regular' | 'makeup' | 'special' | 'trial'

export type TeacherType = 'normal' | 'substitute' | 'outside'

export type GradeLabel =
  | '小1'
  | '小2'
  | '小3'
  | '小4'
  | '小5'
  | '小6'
  | '中1'
  | '中2'
  | '中3'
  | '高1'
  | '高2'
  | '高3'

export type SubjectLabel = '英' | '数' | '算' | '算国' | '国' | '理' | '生' | '物' | '化' | '社' | '理社'

// 出欠記録の種別。
// ★'holiday'(2026-09-16・INV-06): 休日設定で授業が消えたコマの**表示専用**記録。在庫は休日設定の時点で
//   台帳/振替先へ返却済みなので、**会計上は 'moved' と完全に同じ扱い(=無視)** にすること。
//   在庫戻し(HOLIDAY_STOCK_RETURNABLE_STATUSES)・消化(collectMakeupUsageByKey)・義務
//   (computeOutstandingAbsenceOrigins)・台帳確定(resolveMakeupStatusOriginToMaterialize)・日程表の回数表の
//   どれかで absent/attended と同じ側に入れると二重計上になる(INV-06 違反)。status の分岐を足すときは
//   必ず 'moved' と同じ側へ入れる。
export type StudentStatusKind = 'absent' | 'absent-no-makeup' | 'attended' | 'moved' | 'holiday'

export type StudentEntry = {
  id: string
  name: string
  managedStudentId?: string
  grade: GradeLabel
  birthDate?: string
  noteSuffix?: string
  makeupSourceDate?: string
  makeupSourceLabel?: string
  sameDayMoveSourceDate?: string
  sameDayMoveSourceLabel?: string
  specialSessionId?: string
  specialStockSource?: 'session' | 'manual'
  manualAdded?: boolean
  warning?: string
  warningHighlight?: boolean
  // 出席不可コマに配置された生徒か。生徒名の赤文字ハイライトはこのフラグのみで判定する
  // (他の警告はセル背景=黄とツールチップで示し、名前は赤くしない。オーナー指示 2026-07-02)。
  warningUnavailableHighlight?: boolean
  subject: SubjectLabel
  lessonType: LessonType
  teacherType: TeacherType
}

// 休日設定で「未消化在庫へ返した内容」の控え(2026-09-20 オーナー確定・INV-06)。
// 休日**解除**を休日設定の逆操作(席へ復元＋在庫巻き戻し)にするため、`reconcileHolidayDeskStockReturns` が
// 返した会計をそのまま `holiday` 記録へ焼き込み、解除側はこの控えだけを見て巻き戻す。
// ★再導出しない理由: 同じ `holiday` 記録でも「配置授業から作った」ものと「出席済み記録から変換した」もので
//   設定時の会計が違い(前者は無条件に origin を積む・後者は台帳に origin があれば積まない)、記録だけからは
//   区別できない。推測で巻き戻すと誤増/誤減のどちらかになる。
// ★`kind:'none'`(返していない)も必ず入れる。**控えが無い = この改定より前に作られた記録**で、
//   巻き戻せないので解除で復元しない(安全側・件数だけ知らせる)という判別に使う。
export type HolidayStockReturnStamp = {
  /** 'makeup'=振替 origin を1件積んだ / 'lecture'=講習在庫 +1 と origin を積んだ / 'none'=在庫へ返していない。 */
  kind: 'none' | 'makeup' | 'lecture'
  /** 積んだ origin の日付(振替=元の通常授業日 / 講習=未消化講習の origin 日)。 */
  originDateKey?: string
  /** 積んだ origin の時限(分かるときだけ。振替は時限なし=同日ワイルドカード)。 */
  originSlotNumber?: number
  /** 未管理生徒の表示名フォールバックを**この休日設定で新規に**足したか(解除で消すかの判定)。 */
  fallbackAdded?: boolean
}

export type StudentStatusEntry = {
  id: string
  studentId: string
  sourceManagedLesson: boolean
  name: string
  managedStudentId?: string
  grade: GradeLabel
  birthDate?: string
  noteSuffix?: string
  makeupSourceDate?: string
  makeupSourceLabel?: string
  sameDayMoveSourceDate?: string
  sameDayMoveSourceLabel?: string
  specialSessionId?: string
  specialStockSource?: 'session' | 'manual'
  manualAdded?: boolean
  subject: SubjectLabel
  lessonType: LessonType
  teacherType: TeacherType
  teacherName: string
  dateKey: string
  slotNumber: number
  moveDestinationDateKey?: string
  moveDestinationSlotNumber?: number
  recordedAt: string
  status: StudentStatusKind
  /**
   * `status==='holiday'` のときだけ持つ「休日設定で在庫へ返した内容」の控え(2026-09-20)。
   * 休日解除の巻き戻しが設定時と厳密に対称になるようにするための唯一の根拠。
   */
  holidayStockReturn?: HolidayStockReturnStamp
  sourceLessonId: string
  sourceLessonNote?: string
  sourceLessonWarning?: string
}

export type DeskLesson = {
  id: string
  warning?: string
  note?: string
  studentSlots: [StudentEntry | null, StudentEntry | null]
}

export type DeskCell = {
  id: string
  teacher: string
  manualTeacher?: boolean
  teacherAssignmentSource?: 'manual' | 'manual-replaced' | 'schedule-registration' | 'deleted'
  teacherAssignmentSessionId?: string
  teacherAssignmentTeacherId?: string
  teacherUnavailableWarning?: boolean
  memoSlots?: [string | null, string | null]
  statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null]
  lesson?: DeskLesson
}

export type SlotCell = {
  id: string
  dateKey: string
  dayLabel: string
  dateLabel: string
  slotLabel: string
  slotNumber: number
  timeLabel: string
  isOpenDay: boolean
  desks: DeskCell[]
}

export type OpenIssue = {
  id: string
  category: '通常残' | '未解決振替'
  student: string
  teacher: string
  dateLabel: string
  detail: string
}