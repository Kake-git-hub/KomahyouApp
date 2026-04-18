import type { DeskCell, GradeLabel, LessonType, OpenIssue, SlotCell, StudentEntry, SubjectLabel, TeacherType } from './types'

const dayLabels = ['月', '火', '水', '木', '金', '土', '日'] as const

const slotTimes = [
  '13:00-14:30',
  '14:40-16:10',
  '16:20-17:50',
  '18:00-19:30',
  '19:40-21:10',
] as const

const deskTeachers = [
  '山田先生',
  '村上先生',
  '高橋先生',
  '斎藤先生',
  '吉田先生',
  '加藤先生',
  '中島先生',
  '林先生',
  '清水先生',
  '松本先生',
  '井上先生',
  '石井先生',
  '近藤先生',
  '橋本先生',
] as const

function createStudent(
  id: string,
  name: string,
  grade: GradeLabel,
  subject: SubjectLabel,
  lessonType: LessonType = 'regular',
  teacherType: TeacherType = 'normal',
): StudentEntry {
  return { id, name, grade, subject, lessonType, teacherType }
}

function createLesson(
  id: string,
  studentSlots: [StudentEntry | null, StudentEntry | null],
  warning?: string,
  note?: string,
) {
  return {
    id,
    studentSlots,
    warning,
    note,
  }
}

function createDesk(slotId: string, deskIndex: number): DeskCell {
  return {
    id: `${slotId}_desk_${deskIndex + 1}`,
    teacher: deskTeachers[deskIndex],
  }
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateLabel(dateKey: string) {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}/${Number(day)}`
}

export function shiftDate(date: Date, offsetDays: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + offsetDays)
  return next
}

export function getWeekStart(date: Date) {
  const weekStart = new Date(date)
  const day = weekStart.getDay()
  const diff = day === 0 ? -6 : 1 - day
  weekStart.setDate(weekStart.getDate() + diff)
  weekStart.setHours(0, 0, 0, 0)
  return weekStart
}

function createWeekDays(weekStart: Date) {
  return dayLabels.map((dayLabel, index) => {
    const date = shiftDate(weekStart, index)
    const dateKey = toDateKey(date)

    return {
      dateKey,
      dateLabel: formatDateLabel(dateKey),
      dayLabel,
    }
  })
}

function createWeekSlotCells(weekStart: Date): SlotCell[] {
  const days = createWeekDays(weekStart)

  return days.flatMap((day) =>
  Array.from({ length: 5 }, (_, slotIndex) => {
    const slotNumber = slotIndex + 1
    const slotId = `${day.dateKey}_${slotNumber}`

    return {
      id: slotId,
      dateKey: day.dateKey,
      dayLabel: day.dayLabel,
      dateLabel: day.dateLabel,
      slotLabel: `${slotNumber}限`,
      slotNumber,
      timeLabel: slotTimes[slotIndex],
      isOpenDay: true,
      desks: Array.from({ length: 14 }, (_, deskIndex) => createDesk(slotId, deskIndex)),
    }
  }))
}

const seededLessons: Array<{
  dayOffset: number
  slotNumber: number
  deskIndex: number
  lesson: ReturnType<typeof createLesson>
}> = [
  {
    dayOffset: 0,
    slotNumber: 1,
    deskIndex: 0,
    lesson: createLesson(
      'regular-a',
      [createStudent('s1', '田中花', '中2', '英'), createStudent('s2', '佐藤蒼', '中3', '数')],
      undefined,
      '通常固定',
    ),
  },
  {
    dayOffset: 0,
    slotNumber: 1,
    deskIndex: 1,
    lesson: createLesson(
      'regular-b',
      [createStudent('s3', '木村紬', '中1', '数'), createStudent('s4', '青木陽', '中2', '英')],
      undefined,
      '2人ペア優先',
    ),
  },
  {
    dayOffset: 0,
    slotNumber: 2,
    deskIndex: 2,
    lesson: createLesson(
      'makeup-a',
      [createStudent('s5', '中村凛', '高1', '英', 'makeup'), null],
      undefined,
      '生徒理由の通常振替',
    ),
  },
  {
    dayOffset: 0,
    slotNumber: 2,
    deskIndex: 4,
    lesson: createLesson(
      'special-a',
      [createStudent('s6', '伊藤心', '高2', '理', 'special'), null],
      '通常残の解消後に見直し',
      '講習の仮置き',
    ),
  },
  {
    dayOffset: 0,
    slotNumber: 3,
    deskIndex: 3,
    lesson: createLesson(
      'substitute-a',
      [
        createStudent('s7', '小林蓮', '中3', '数', 'regular', 'substitute'),
        createStudent('s8', '白石遥', '中2', '英', 'regular', 'substitute'),
      ],
      '講師相性に注意',
      '講師理由の代行',
    ),
  },
  {
    dayOffset: 1,
    slotNumber: 1,
    deskIndex: 0,
    lesson: createLesson(
      'special-b',
      [createStudent('s9', '森奏', '高1', '国', 'special'), createStudent('s10', '西村湊', '高1', '数', 'special')],
      undefined,
      '特別講習',
    ),
  },
  {
    dayOffset: 1,
    slotNumber: 1,
    deskIndex: 1,
    lesson: createLesson(
      'regular-c',
      [createStudent('s11', '近藤結', '中1', '英'), createStudent('s12', '大野蓮', '中1', '国')],
      undefined,
      '通常固定',
    ),
  },
  {
    dayOffset: 1,
    slotNumber: 4,
    deskIndex: 7,
    lesson: createLesson(
      'regular-d',
      [null, createStudent('s13', '高木葵', '小6', '算')],
      '1対1のためペア候補待ち',
      '追加申込',
    ),
  },
  {
    dayOffset: 2,
    slotNumber: 2,
    deskIndex: 5,
    lesson: createLesson(
      'makeup-b',
      [createStudent('s14', '山口光', '中2', '英', 'makeup'), null],
      undefined,
      '元講師優先の別日振替',
    ),
  },
  {
    dayOffset: 2,
    slotNumber: 3,
    deskIndex: 5,
    lesson: createLesson(
      'regular-e',
      [createStudent('s15', '前田楓', '高2', '英'), createStudent('s16', '長谷川凛', '高2', '英')],
      undefined,
      '優先ペア',
    ),
  },
  {
    dayOffset: 3,
    slotNumber: 5,
    deskIndex: 8,
    lesson: createLesson(
      'outside-b',
      [
        createStudent('s17', '鈴木暖', '中3', '理', 'regular', 'outside'),
        createStudent('s18', '川村陽', '中3', '数', 'regular', 'outside'),
      ],
      '科目担当外で暫定確定',
      '担当科目外講師で暫定確定',
    ),
  },
  {
    dayOffset: 4,
    slotNumber: 2,
    deskIndex: 10,
    lesson: createLesson(
      'special-c',
      [createStudent('s19', '平野彩', '高3', '国', 'special'), null],
      '通常残が解消したら再確認',
      '講習保留',
    ),
  },
  {
    dayOffset: 4,
    slotNumber: 5,
    deskIndex: 12,
    lesson: createLesson(
      'regular-f',
      [createStudent('s20', '岡田凪', '中2', '数'), createStudent('s21', '松田悠', '中2', '理')],
      undefined,
      '週末固定',
    ),
  },
  {
    dayOffset: 5,
    slotNumber: 2,
    deskIndex: 2,
    lesson: createLesson(
      'regular-g',
      [createStudent('s22', '三浦凛', '小5', '算'), createStudent('s23', '野口湊', '小5', '国')],
      undefined,
      '土曜固定',
    ),
  },
  {
    dayOffset: 6,
    slotNumber: 4,
    deskIndex: 6,
    lesson: createLesson(
      'special-d',
      [createStudent('s24', '福田結菜', '高1', '理', 'special'), null],
      '日曜講習',
      '日曜のみ',
    ),
  },
]

export function createSeededWeek(weekStart: Date, weekId: string) {
  const cells = createWeekSlotCells(weekStart)

  for (const { dayOffset, slotNumber, deskIndex, lesson } of seededLessons) {
    const targetDay = shiftDate(weekStart, dayOffset)
    const slotId = `${toDateKey(targetDay)}_${slotNumber}`
    const slot = cells.find((cell) => cell.id === slotId)
    if (!slot) continue

    slot.desks[deskIndex] = {
      ...slot.desks[deskIndex],
      lesson: {
        ...lesson,
        id: `${lesson.id}_${weekId}`,
        studentSlots: lesson.studentSlots.map((student) => (
          student ? { ...student, id: `${student.id}_${weekId}` } : null
        )) as [StudentEntry | null, StudentEntry | null],
      },
    }
  }

  return cells
}

const currentWeekStart = getWeekStart(new Date())
const previousWeekStart = shiftDate(currentWeekStart, -7)
const nextWeekStart = shiftDate(currentWeekStart, 7)

export const defaultWeekIndex = 1
export const slotCellWeeks: SlotCell[][] = [
  createSeededWeek(previousWeekStart, 'prev'),
  createSeededWeek(currentWeekStart, 'current'),
  createSeededWeek(nextWeekStart, 'next'),
]
export const slotCells = slotCellWeeks[defaultWeekIndex]

export const openIssues: OpenIssue[] = [
  {
    id: 'issue-1',
    category: '通常残',
    student: '中村凛',
    teacher: '村上先生',
    dateLabel: '7/19 発生',
    detail: '生徒欠席。元講師の同日別コマを優先して探索中。',
  },
  {
    id: 'issue-2',
    category: '未解決振替',
    student: '小林蓮',
    teacher: '山田先生',
    dateLabel: '7/18 発生',
    detail: '講師欠席。同日代行失敗後に別日振替へ回っている。',
  },
  {
    id: 'issue-3',
    category: '通常残',
    student: '木村紬',
    teacher: '高橋先生',
    dateLabel: '7/20 発生',
    detail: '特別講習に仮置き中。通常残を優先して再割当待ち。',
  },
]

export const lessonTypeLabels: Record<LessonType, string> = {
  regular: '通常',
  makeup: '振替',
  special: '講習',
  trial: '体験',
}

export const teacherTypeLabels: Record<TeacherType, string> = {
  normal: '通常講師',
  substitute: '代行講師',
  outside: '担当科目外講師',
}