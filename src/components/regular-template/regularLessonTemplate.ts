import { getStudentDisplayName, getTeacherDisplayName, resolveScheduledStatus, resolveTeacherRosterStatus, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import { normalizeRegularLessonNote, normalizeRegularLessonStudentColumns, resolveOperationalSchoolYear, resolveSchoolYearDateRange, type RegularLessonRow } from '../basic-data/regularLessonModel'
import type { DeskCell, GradeLabel, SlotCell, StudentEntry, SubjectLabel } from '../schedule-board/types'
import { resolveDisplayedSubjectForBirthDate, resolveGradeLabelFromBirthDate } from '../../utils/studentGradeSubject'

type XlsxModule = typeof import('xlsx')

export type RegularLessonTemplateStudent = {
  studentId: string
  subject: SubjectLabel
  note?: string
}

export type RegularLessonTemplateDesk = {
  deskIndex: number
  teacherId: string
  students: [RegularLessonTemplateStudent | null, RegularLessonTemplateStudent | null]
}

export type RegularLessonTemplateCell = {
  dayOfWeek: number
  slotNumber: number
  desks: RegularLessonTemplateDesk[]
}

export type RegularLessonTemplate = {
  version: 1
  effectiveStartDate: string
  savedAt: string
  cells: RegularLessonTemplateCell[]
}

export const regularTemplateDayOptions = [1, 2, 3, 4, 5, 6, 0] as const
export const regularTemplateSlotNumbers = [1, 2, 3, 4, 5] as const

const subjectOptions: SubjectLabel[] = ['英', '数', '算', '算国', '国', '理', '生', '物', '化', '社']
const dayLabelByValue: Record<number, string> = {
  0: '日',
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function normalizeDateString(value: unknown, xlsx?: XlsxModule) {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = value.getMonth() + 1
    const d = value.getDate()
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return ''
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  if (typeof value === 'number') {
    const parsed = xlsx?.SSF?.parse_date_code(value)
    if (!parsed) return ''
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }

  const text = String(value ?? '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text

  const slashMatch = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/u)
  if (slashMatch) {
    const [, year, month, day] = slashMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  // M/D/YY or M/D/YYYY (Excel formatted text fallback)
  const mdyMatch = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/u)
  if (mdyMatch) {
    const [, monthStr, dayStr, yearStr] = mdyMatch
    const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr)
    return `${String(year).padStart(4, '0')}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`
  }

  return ''
}

function toWorkbookDateCellValue(value: string) {
  const normalized = normalizeDateString(value)
  if (!normalized) return ''
  const [yearText, monthText, dayText] = normalized.split('-')
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
}

function createWorkbookSheet(xlsx: XlsxModule, rows: Record<string, unknown>[], dateColumns: string[] = []) {
  const normalizedRows = rows.map((row) => {
    const nextRow: Record<string, unknown> = { ...row }
    for (const column of dateColumns) {
      if (!(column in nextRow)) continue
      nextRow[column] = toWorkbookDateCellValue(String(nextRow[column] ?? ''))
    }
    return nextRow
  })

  const sheet = normalizedRows.length > 0
    ? xlsx.utils.json_to_sheet(normalizedRows, { cellDates: true })
    : xlsx.utils.aoa_to_sheet([['開始日', '曜日', '時限', '机', '講師', '生徒1', '科目1', '注記1', '生徒2', '科目2', '注記2']])

  const headers = normalizedRows[0] ? Object.keys(normalizedRows[0]) : []
  for (const column of dateColumns) {
    const columnIndex = headers.indexOf(column)
    if (columnIndex < 0) continue
    for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
      const cellRef = xlsx.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })
      const cell = sheet[cellRef]
      if (!cell || !(cell.v instanceof Date)) continue
      cell.z = 'yyyy-mm-dd'
    }
  }

  return sheet
}

function createEmptyDesk(deskIndex: number): RegularLessonTemplateDesk {
  return {
    deskIndex,
    teacherId: '',
    students: [null, null],
  }
}

function createEmptyCell(dayOfWeek: number, slotNumber: number, deskCount: number): RegularLessonTemplateCell {
  return {
    dayOfWeek,
    slotNumber,
    desks: Array.from({ length: deskCount }, (_, index) => createEmptyDesk(index + 1)),
  }
}

function normalizeTemplateStudent(student: RegularLessonTemplateStudent | null | undefined): RegularLessonTemplateStudent | null {
  if (!student?.studentId) return null
  return {
    studentId: student.studentId,
    subject: subjectOptions.includes(student.subject) ? student.subject : '英',
    note: normalizeRegularLessonNote(student.note),
  }
}

function normalizeDayOfWeek(value: number) {
  return regularTemplateDayOptions.includes(value as (typeof regularTemplateDayOptions)[number]) ? value : 1
}

function normalizeSlotNumber(value: number) {
  return regularTemplateSlotNumbers.includes(value as (typeof regularTemplateSlotNumbers)[number]) ? value : 1
}

function buildTemplateCellKey(dayOfWeek: number, slotNumber: number) {
  return `${dayOfWeek}_${slotNumber}`
}

export function createRegularLessonTemplate(deskCount: number, effectiveStartDate = toDateKey(new Date())): RegularLessonTemplate {
  return {
    version: 1,
    effectiveStartDate: normalizeDateString(effectiveStartDate) || toDateKey(new Date()),
    savedAt: new Date().toISOString(),
    cells: regularTemplateDayOptions.flatMap((dayOfWeek) => regularTemplateSlotNumbers.map((slotNumber) => createEmptyCell(dayOfWeek, slotNumber, deskCount))),
  }
}

export function normalizeRegularLessonTemplate(template: RegularLessonTemplate | null | undefined, deskCount: number): RegularLessonTemplate {
  const fallback = createRegularLessonTemplate(deskCount)
  const source = template ?? fallback
  const cellByKey = new Map((source.cells ?? []).map((cell) => [buildTemplateCellKey(normalizeDayOfWeek(cell.dayOfWeek), normalizeSlotNumber(cell.slotNumber)), cell]))

  return {
    version: 1,
    effectiveStartDate: normalizeDateString(source.effectiveStartDate) || fallback.effectiveStartDate,
    savedAt: source.savedAt || new Date().toISOString(),
    cells: regularTemplateDayOptions.flatMap((dayOfWeek) => regularTemplateSlotNumbers.map((slotNumber) => {
      const existingCell = cellByKey.get(buildTemplateCellKey(dayOfWeek, slotNumber))
      const deskByIndex = new Map((existingCell?.desks ?? []).map((desk) => [desk.deskIndex, desk]))
      return {
        dayOfWeek,
        slotNumber,
        desks: Array.from({ length: Math.max(1, deskCount) }, (_, index) => {
          const deskIndex = index + 1
          const existingDesk = deskByIndex.get(deskIndex)
          return {
            deskIndex,
            teacherId: existingDesk?.teacherId ?? '',
            students: [
              normalizeTemplateStudent(existingDesk?.students?.[0]),
              normalizeTemplateStudent(existingDesk?.students?.[1]),
            ],
          }
        }),
      }
    })),
  }
}

export function filterTemplateParticipantsForReferenceDate(params: {
  template: RegularLessonTemplate | null | undefined
  deskCount: number
  teachers: TeacherRow[]
  students: StudentRow[]
}) {
  const { template, deskCount, teachers, students } = params
  const normalizedTemplate = normalizeRegularLessonTemplate(template, deskCount)
  const referenceDate = normalizedTemplate.effectiveStartDate
  const visibleTeacherIds = new Set(
    teachers
      .filter((teacher) => resolveTeacherRosterStatus(teacher, referenceDate) === '在籍')
      .map((teacher) => teacher.id),
  )
  const visibleStudentIds = new Set(
    students
      .filter((student) => {
        const status = resolveScheduledStatus(student.entryDate, student.withdrawDate, student.isHidden, referenceDate)
        return status !== '退塾' && status !== '非表示'
      })
      .map((student) => student.id),
  )

  return {
    ...normalizedTemplate,
    cells: normalizedTemplate.cells.map((cell) => ({
      ...cell,
      desks: cell.desks.map((desk) => ({
        ...desk,
        teacherId: visibleTeacherIds.has(desk.teacherId) ? desk.teacherId : '',
        students: desk.students.map((student) => {
          if (!student?.studentId) return null
          return visibleStudentIds.has(student.studentId) ? normalizeTemplateStudent(student) : null
        }) as RegularLessonTemplateDesk['students'],
      })),
    })),
  }
}

export function hasRegularLessonTemplateAssignments(template: RegularLessonTemplate | null | undefined) {
  return (template?.cells ?? []).some((cell) => cell.desks.some((desk) => (
    Boolean(desk.teacherId)
    || desk.students.some((student) => Boolean(student?.studentId))
  )))
}

export function buildRegularLessonsFromTemplate(params: {
  template: RegularLessonTemplate | null | undefined
  teachers: TeacherRow[]
  students: StudentRow[]
  maxSchoolYear?: number
}) {
  const { template, teachers: _teachers, students, maxSchoolYear = 2031 } = params
  if (!template || !hasRegularLessonTemplateAssignments(template)) return []

  const normalizedTemplate = normalizeRegularLessonTemplate(template, Math.max(...template.cells.map((cell) => cell.desks.length), 1))
  const studentById = new Map(students.map((student) => [student.id, student]))
  const effectiveStartDate = normalizedTemplate.effectiveStartDate
  const effectiveSchoolYear = resolveOperationalSchoolYear(parseDateKey(effectiveStartDate))
  const rows: RegularLessonRow[] = []

  for (let schoolYear = effectiveSchoolYear; schoolYear <= maxSchoolYear; schoolYear += 1) {
    const schoolYearRange = resolveSchoolYearDateRange(schoolYear)
    if (schoolYearRange.endDate < effectiveStartDate) continue
    const sharedStartDate = effectiveStartDate > schoolYearRange.startDate ? effectiveStartDate : schoolYearRange.startDate
    const sharedEndDate = schoolYearRange.endDate

    for (const cell of normalizedTemplate.cells) {
      for (const desk of cell.desks) {
        const student1 = normalizeTemplateStudent(desk.students[0])
        const student2 = normalizeTemplateStudent(desk.students[1])
        if (!desk.teacherId && !student1 && !student2) continue

        const student1Row = student1 ? studentById.get(student1.studentId) : null
        const student2Row = student2 ? studentById.get(student2.studentId) : null
        const referenceDate = sharedStartDate

        rows.push({
          id: `template_${schoolYear}_${cell.dayOfWeek}_${cell.slotNumber}_${desk.deskIndex}`,
          schoolYear,
          teacherId: desk.teacherId,
          student1Id: student1?.studentId ?? '',
          subject1: student1 ? resolveDisplayedSubjectForBirthDate(student1.subject, student1Row?.birthDate, referenceDate) : '',
          student1Note: normalizeRegularLessonNote(student1?.note),
          startDate: sharedStartDate,
          endDate: sharedEndDate,
          student2Id: student2?.studentId ?? '',
          subject2: student2 ? resolveDisplayedSubjectForBirthDate(student2.subject, student2Row?.birthDate, referenceDate) : '',
          student2Note: normalizeRegularLessonNote(student2?.note),
          student2StartDate: sharedStartDate,
          student2EndDate: sharedEndDate,
          nextStudent1Id: '',
          nextSubject1: '',
          nextStudent2Id: '',
          nextSubject2: '',
          dayOfWeek: cell.dayOfWeek,
          slotNumber: cell.slotNumber,
        })
      }
    }
  }

  // テンプレ由来の regularLessons はテンプレの deskIndex 順を保持する。
  // packSortRegularLessonRows の packPriority・講師名ソートは使わず、
  // (schoolYear, dayOfWeek, slotNumber, originalIndex) のみで安定ソートする。
  return rows
    .map((row, index) => ({ row: normalizeRegularLessonStudentColumns(row), index }))
    .sort((a, b) => {
      if (a.row.schoolYear !== b.row.schoolYear) return a.row.schoolYear - b.row.schoolYear
      if (a.row.dayOfWeek !== b.row.dayOfWeek) return a.row.dayOfWeek - b.row.dayOfWeek
      if (a.row.slotNumber !== b.row.slotNumber) return a.row.slotNumber - b.row.slotNumber
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

export function buildRegularLessonTemplateWorkbook(xlsx: XlsxModule, params: {
  template: RegularLessonTemplate | null | undefined
  templateHistory?: RegularLessonTemplate[]
  teachers: TeacherRow[]
  students: StudentRow[]
  deskCount: number
}) {
  const { template, templateHistory, teachers, students, deskCount } = params
  const workbook = xlsx.utils.book_new()
  const teacherNameById = new Map(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)]))
  const studentNameById = new Map(students.map((student) => [student.id, getStudentDisplayName(student)]))

  // 履歴と現在のテンプレを合算し、開始日昇順で並べる
  const allTemplates: RegularLessonTemplate[] = []
  for (const hist of templateHistory ?? []) {
    allTemplates.push(normalizeRegularLessonTemplate(hist, deskCount))
  }
  const current = normalizeRegularLessonTemplate(template, deskCount)
  // 現在のテンプレが履歴に含まれていない場合は追加
  if (!allTemplates.some((t) => t.effectiveStartDate === current.effectiveStartDate)) {
    allTemplates.push(current)
  }
  allTemplates.sort((a, b) => a.effectiveStartDate.localeCompare(b.effectiveStartDate))

  const rows = allTemplates.flatMap((tmpl) =>
    tmpl.cells.flatMap((cell) => cell.desks.map((desk) => ({
      開始日: tmpl.effectiveStartDate,
      曜日: dayLabelByValue[cell.dayOfWeek] ?? '月',
      時限: `${cell.slotNumber}限`,
      机: desk.deskIndex,
      講師: teacherNameById.get(desk.teacherId) ?? '',
      生徒1: studentNameById.get(desk.students[0]?.studentId ?? '') ?? '',
      科目1: desk.students[0]?.subject ?? '',
      注記1: normalizeRegularLessonNote(desk.students[0]?.note),
      生徒2: studentNameById.get(desk.students[1]?.studentId ?? '') ?? '',
      科目2: desk.students[1]?.subject ?? '',
      注記2: normalizeRegularLessonNote(desk.students[1]?.note),
    }))),
  )

  xlsx.utils.book_append_sheet(workbook, createWorkbookSheet(xlsx, rows, ['開始日']), '通常授業テンプレ')
  return workbook
}

export function listTemplateStartDatesFromWorkbook(xlsx: XlsxModule, workbook: import('xlsx').WorkBook): string[] {
  const sheet = workbook.Sheets['通常授業テンプレ']
  if (!sheet) return []
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
  const dateSet = new Set<string>()
  for (const row of rows) {
    const rawVal = row['開始日']
    const dateStr = normalizeDateString(rawVal, xlsx)
    if (dateStr) dateSet.add(dateStr)
  }
  const result = Array.from(dateSet).sort((a, b) => a.localeCompare(b))
  console.log('[template-import] detected dates:', result, '(row count:', rows.length, ')')
  return result
}

export function parseRegularLessonTemplateWorkbook(xlsx: XlsxModule, workbook: import('xlsx').WorkBook, params: {
  fallbackTemplate: RegularLessonTemplate | null | undefined
  teachers: TeacherRow[]
  students: StudentRow[]
  deskCount: number
  selectedStartDate?: string
}) {
  const sheet = workbook.Sheets['通常授業テンプレ']
  if (!sheet) return normalizeRegularLessonTemplate(params.fallbackTemplate, params.deskCount)

  const teacherIdByName = new Map<string, string>()
  for (const teacher of params.teachers) {
    teacherIdByName.set(teacher.name, teacher.id)
    teacherIdByName.set(getTeacherDisplayName(teacher), teacher.id)
  }

  const studentIdByName = new Map<string, string>()
  for (const student of params.students) {
    studentIdByName.set(student.name, student.id)
    studentIdByName.set(getStudentDisplayName(student), student.id)
  }

  const allRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  // selectedStartDate が指定されている場合、その日付の行のみ使用
  const rows = params.selectedStartDate
    ? allRows.filter((row) => normalizeDateString(row['開始日'], xlsx) === params.selectedStartDate)
    : allRows
  const fallback = normalizeRegularLessonTemplate(params.fallbackTemplate, params.deskCount)
  const effectiveStartDate = params.selectedStartDate
    || normalizeDateString(rows.find((row) => normalizeDateString(row['開始日'], xlsx))?.['開始日'], xlsx)
    || fallback.effectiveStartDate
  const nextTemplate = createRegularLessonTemplate(params.deskCount, effectiveStartDate)
  const nextCellByKey = new Map(nextTemplate.cells.map((cell) => [buildTemplateCellKey(cell.dayOfWeek, cell.slotNumber), cell]))

  for (const row of rows) {
    const dayText = String(row['曜日'] ?? '').trim()
    const dayOfWeek = Object.entries(dayLabelByValue).find(([, label]) => label === dayText || `${label}曜` === dayText)?.[0]
    const slotMatch = String(row['時限'] ?? '').match(/(\d+)/u)
    const deskIndex = Math.max(1, Number(row['机']) || 1)
    if (!dayOfWeek || !slotMatch) continue

    const cell = nextCellByKey.get(buildTemplateCellKey(Number(dayOfWeek), Number(slotMatch[1])))
    const desk = cell?.desks[deskIndex - 1]
    if (!cell || !desk) continue

    const student1Id = studentIdByName.get(String(row['生徒1'] ?? '').trim()) ?? ''
    const student2Id = studentIdByName.get(String(row['生徒2'] ?? '').trim()) ?? ''
    const subject1 = String(row['科目1'] ?? '').trim() as SubjectLabel
    const subject2 = String(row['科目2'] ?? '').trim() as SubjectLabel

    desk.teacherId = teacherIdByName.get(String(row['講師'] ?? '').trim()) ?? ''
    desk.students = [
      student1Id ? { studentId: student1Id, subject: subjectOptions.includes(subject1) ? subject1 : '英', note: normalizeRegularLessonNote(String(row['注記1'] ?? '')) } : null,
      student2Id ? { studentId: student2Id, subject: subjectOptions.includes(subject2) ? subject2 : '英', note: normalizeRegularLessonNote(String(row['注記2'] ?? '')) } : null,
    ]
  }

  return normalizeRegularLessonTemplate(nextTemplate, params.deskCount)
}

export function buildTemplateBoardCells(params: {
  template: RegularLessonTemplate
  teachers: TeacherRow[]
  students: StudentRow[]
  deskCount: number
}): SlotCell[] {
  const { template, teachers, students, deskCount } = params
  const normalized = normalizeRegularLessonTemplate(template, deskCount)
  const teacherNameById = new Map(teachers.map((t) => [t.id, getTeacherDisplayName(t)]))
  const studentById = new Map(students.map((s) => [s.id, s]))
  const today = new Date()

  return normalized.cells.map((cell) => {
    const cellId = `template_${cell.dayOfWeek}_${cell.slotNumber}`
    return {
      id: cellId,
      dateKey: `template_${cell.dayOfWeek}`,
      dayLabel: '',
      dateLabel: dayLabelByValue[cell.dayOfWeek] ?? '',
      slotLabel: `${cell.slotNumber}限`,
      slotNumber: cell.slotNumber,
      timeLabel: '',
      isOpenDay: true,
      desks: cell.desks.map((desk) => {
        const teacherName = teacherNameById.get(desk.teacherId) ?? ''
        const student1 = desk.students[0]
        const student2 = desk.students[1]
        const student1Row = student1 ? studentById.get(student1.studentId) : null
        const student2Row = student2 ? studentById.get(student2.studentId) : null
        const hasContent = Boolean(desk.teacherId || student1?.studentId || student2?.studentId)

        return {
          id: `${cellId}_${desk.deskIndex}`,
          teacher: teacherName,
          lesson: hasContent ? {
            id: `${cellId}_lesson_${desk.deskIndex}`,
            studentSlots: [
              student1?.studentId && student1Row ? {
                id: `${cellId}_s1_${desk.deskIndex}`,
                name: getStudentDisplayName(student1Row),
                managedStudentId: student1.studentId,
                grade: (resolveGradeLabelFromBirthDate(student1Row.birthDate, today) || '中1') as GradeLabel,
                birthDate: student1Row.birthDate,
                noteSuffix: normalizeRegularLessonNote(student1.note),
                subject: student1.subject,
                lessonType: 'regular' as const,
                teacherType: 'normal' as const,
              } : null,
              student2?.studentId && student2Row ? {
                id: `${cellId}_s2_${desk.deskIndex}`,
                name: getStudentDisplayName(student2Row),
                managedStudentId: student2.studentId,
                grade: (resolveGradeLabelFromBirthDate(student2Row.birthDate, today) || '中1') as GradeLabel,
                birthDate: student2Row.birthDate,
                noteSuffix: normalizeRegularLessonNote(student2.note),
                subject: student2.subject,
                lessonType: 'regular' as const,
                teacherType: 'normal' as const,
              } : null,
            ] as [import('../schedule-board/types').StudentEntry | null, import('../schedule-board/types').StudentEntry | null],
          } : undefined,
        }
      }),
    }
  })
}

export function copyBoardCellsForTemplate(cells: SlotCell[]): SlotCell[] {
  const calendarDayLabelsLocal = ['日', '月', '火', '水', '木', '金', '土'] as const

  return cells.map((cell) => {
    const date = parseDateKey(cell.dateKey)
    const jsDay = date.getDay()
    const templateCellId = `template_${jsDay}_${cell.slotNumber}`

    return {
      id: templateCellId,
      dateKey: `template_${jsDay}`,
      dayLabel: '',
      dateLabel: calendarDayLabelsLocal[jsDay],
      slotLabel: cell.slotLabel,
      slotNumber: cell.slotNumber,
      timeLabel: cell.timeLabel,
      isOpenDay: true,
      desks: cell.desks.map((desk, deskIdx) => {
        const s0 = desk.lesson?.studentSlots[0]
        const s1 = desk.lesson?.studentSlots[1]
        const regular0: StudentEntry | null = s0 && s0.lessonType === 'regular'
          ? { ...s0, id: `${templateCellId}_s0_${deskIdx}` }
          : null
        const regular1: StudentEntry | null = s1 && s1.lessonType === 'regular'
          ? { ...s1, id: `${templateCellId}_s1_${deskIdx}` }
          : null
        const hasContent = Boolean(desk.teacher) || Boolean(regular0) || Boolean(regular1)
        const result: DeskCell = {
          id: `${templateCellId}_desk_${deskIdx + 1}`,
          teacher: desk.teacher,
          lesson: hasContent && (regular0 || regular1)
            ? {
                id: `${templateCellId}_lesson_${deskIdx}`,
                studentSlots: [regular0, regular1],
              }
            : undefined,
        }
        return result
      }),
    }
  })
}

export function convertTemplateCellsToTemplate(params: {
  cells: SlotCell[]
  teachers: TeacherRow[]
  students: StudentRow[]
  effectiveStartDate: string
  deskCount: number
}): RegularLessonTemplate {
  const { cells: templateCells, teachers, students, effectiveStartDate, deskCount } = params
  const teacherIdByName = new Map(teachers.map((t) => [getTeacherDisplayName(t), t.id]))
  const studentIdByName = new Map(students.map((s) => [getStudentDisplayName(s), s.id]))

  const cellByKey = new Map<string, RegularLessonTemplateCell>()

  for (const cell of templateCells) {
    const parts = cell.id.replace('template_', '').split('_')
    const dayOfWeek = Number(parts[0])
    const slotNumber = Number(parts[1])
    const key = buildTemplateCellKey(dayOfWeek, slotNumber)
    if (cellByKey.has(key)) continue

    cellByKey.set(key, {
      dayOfWeek,
      slotNumber,
      desks: cell.desks.map((desk, idx) => {
        const teacherId = teacherIdByName.get(desk.teacher) ?? ''
        const s0 = desk.lesson?.studentSlots[0]
        const s1 = desk.lesson?.studentSlots[1]
        return {
          deskIndex: idx + 1,
          teacherId,
          students: [
            s0 ? { studentId: s0.managedStudentId ?? studentIdByName.get(s0.name) ?? '', subject: s0.subject, note: normalizeRegularLessonNote(s0.noteSuffix) } : null,
            s1 ? { studentId: s1.managedStudentId ?? studentIdByName.get(s1.name) ?? '', subject: s1.subject, note: normalizeRegularLessonNote(s1.noteSuffix) } : null,
          ],
        }
      }),
    })
  }

  const resultCells: RegularLessonTemplateCell[] = regularTemplateDayOptions.flatMap((dayOfWeek) =>
    regularTemplateSlotNumbers.map((slotNumber) => {
      const key = buildTemplateCellKey(dayOfWeek, slotNumber)
      return cellByKey.get(key) ?? createEmptyCell(dayOfWeek, slotNumber, deskCount)
    }),
  )

  return {
    version: 1,
    effectiveStartDate: normalizeDateString(effectiveStartDate) || toDateKey(new Date()),
    savedAt: new Date().toISOString(),
    cells: resultCells,
  }
}
