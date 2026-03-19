export type LessonType = 'regular' | 'makeup' | 'special'

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

export type SubjectLabel = '英' | '数' | '算' | '国' | '理' | '社' | 'IT'

export type StudentEntry = {
  id: string
  name: string
  managedStudentId?: string
  grade: GradeLabel
  birthDate?: string
  makeupSourceDate?: string
  makeupSourceLabel?: string
  manualAdded?: boolean
  warning?: string
  subject: SubjectLabel
  lessonType: LessonType
  teacherType: TeacherType
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
  teacherAssignmentSource?: 'manual' | 'schedule-registration'
  teacherAssignmentSessionId?: string
  teacherAssignmentTeacherId?: string
  memoSlots?: [string | null, string | null]
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