import { lessonTypeLabels, teacherTypeLabels } from './mockData'
import { getMemoTextStyle } from './memoText'
import type { LessonType, SlotCell, TeacherType } from './types'

function getLessonStar(lessonType: LessonType) {
  switch (lessonType) {
    case 'regular':
      return { label: lessonTypeLabels[lessonType], className: 'star-lesson-regular' }
    case 'makeup':
      return { label: lessonTypeLabels[lessonType], className: 'star-lesson-makeup' }
    default:
      return null
  }
}

function getTeacherStar(teacherType: TeacherType) {
  switch (teacherType) {
    case 'substitute':
      return { label: teacherTypeLabels[teacherType], className: 'star-teacher-substitute' }
    case 'outside':
      return { label: teacherTypeLabels[teacherType], className: 'star-teacher-outside' }
    default:
      return null
  }
}

type BoardGridProps = {
  cells: SlotCell[]
  selectedStudentId: string | null
  highlightedCell: { cellId: string; deskIndex: number; studentIndex: number } | null
  highlightedHolidayDate: string | null
  yearLabel: string
  specialPeriods: Array<{ id: string; label: string; startDate: string; endDate: string }>
  resolveStudentDisplayName: (name: string) => string
  resolveStudentGradeLabel: (name: string, fallbackGrade: string, dateKey: string, birthDate?: string) => string
  resolveDisplayedLessonType: (name: string, subject: string, lessonType: LessonType | null, dateKey: string, slotNumber: number) => LessonType | null
  onDayHeaderClick: (dateKey: string) => void
  onSpecialPeriodClick: (periodId: string) => void
  onTeacherClick: (cellId: string, deskIndex: number, x: number, y: number) => void
  onStudentClick: (cellId: string, deskIndex: number, studentIndex: number, hasStudent: boolean, hasMemo: boolean, x: number, y: number) => void
}

export function BoardGrid({
  cells,
  selectedStudentId,
  highlightedCell,
  highlightedHolidayDate,
  yearLabel,
  specialPeriods,
  resolveStudentDisplayName,
  resolveStudentGradeLabel,
  resolveDisplayedLessonType,
  onDayHeaderClick,
  onSpecialPeriodClick,
  onTeacherClick,
  onStudentClick,
}: BoardGridProps) {
  const renderStudentCell = (
    cell: SlotCell,
    deskIndex: number,
    studentIndex: number,
    teacherName: string,
    studentName: string,
    memoLabel: string | undefined,
    studentGrade: string,
    studentBirthDate: string | undefined,
    makeupSourceLabel: string | undefined,
    studentSubject: string,
    lessonType: LessonType | null,
    teacherType: TeacherType,
    studentWarning: string | undefined,
    lessonNote: string | undefined,
    isPicked: boolean,
    extraClassName = '',
  ) => {
    const resolvedLessonType = studentName ? resolveDisplayedLessonType(studentName, studentSubject, lessonType, cell.dateKey, cell.slotNumber) : lessonType
    const lessonStar = resolvedLessonType ? getLessonStar(resolvedLessonType) : null
    const teacherStar = getTeacherStar(teacherType)
    const displayName = studentName ? resolveStudentDisplayName(studentName) : (memoLabel ?? '')
    const displayGrade = studentName ? resolveStudentGradeLabel(studentName, studentGrade, cell.dateKey, studentBirthDate) : ''
    const missingTeacherWarning = studentName && !teacherName.trim() ? '講師なし' : undefined
    const visibleNote = lessonNote === '管理データ反映' ? undefined : lessonNote
    const hasWarning = Boolean(studentWarning || missingTeacherWarning)
    const hasMemo = !studentName && Boolean(memoLabel)
    const memoNotice = hasMemo ? '手入力メモのため注意' : undefined
    const originalLessonLabel = makeupSourceLabel ? `元の通常授業: ${makeupSourceLabel}` : ''
    const hoverText = Array.from(new Set([
      memoNotice,
      studentWarning,
      missingTeacherWarning,
      visibleNote,
      originalLessonLabel && visibleNote?.includes(originalLessonLabel) ? '' : originalLessonLabel,
    ].filter(Boolean)))
      .join('\n') || undefined

    return (
    <td
      key={`${cell.id}_${deskIndex}_student${studentIndex + 1}`}
      className={`sa-student${!cell.isOpenDay ? ' sa-inactive' : ''}${hasWarning ? ' sa-warning' : ''}${isPicked ? ' sa-student-picked' : ''}${extraClassName ? ` ${extraClassName}` : ''}`}
      onClick={(event) => onStudentClick(cell.id, deskIndex, studentIndex, Boolean(studentName), hasMemo, event.clientX, event.clientY)}
      data-testid={`student-cell-${cell.id}-${deskIndex}-${studentIndex}`}
    >
      <div className="sa-student-inner">
        <span className="sa-student-name-row">
          <span
            className={`sa-student-name${hasWarning ? ' sa-student-name-warning' : ''}${hasMemo ? ' sa-student-name-note' : ''}`}
            data-testid={`student-name-${cell.id}-${deskIndex}-${studentIndex}`}
            title={hoverText}
            style={hasMemo ? getMemoTextStyle(displayName) : undefined}
          >
            {displayName}
          </span>
        </span>
        {hasMemo ? null : (
          <span className="sa-student-detail">
            {lessonStar || teacherStar ? (
              <span className="sa-student-markers">
                {lessonStar ? (
                  <span
                    className={`sa-student-star ${lessonStar.className}`}
                    title={lessonStar.label}
                    aria-label={lessonStar.label}
                  >
                    ★
                  </span>
                ) : null}
                {teacherStar ? (
                  <span
                    className={`sa-student-star ${teacherStar.className}`}
                    title={teacherStar.label}
                    aria-label={teacherStar.label}
                  >
                    ★
                  </span>
                ) : null}
              </span>
            ) : null}
            <>
              <span className="sa-student-detail-grade">{displayGrade}</span>
              {' '}
              <span className="sa-student-detail-subject">{studentSubject}</span>
            </>
          </span>
        )}
      </div>
    </td>
    )
  }

  const hasManualTeacherWarning = (desk: SlotCell['desks'][number]) => {
    if (desk.manualTeacher) return true
    const lesson = desk.lesson
    return Boolean(lesson && (lesson.id?.includes('_manual') || lesson.studentSlots.some((student) => student?.manualAdded)))
  }

  const days = Array.from(
    cells.reduce((map, cell) => {
      if (!map.has(cell.dateKey)) {
        map.set(cell.dateKey, {
          dateKey: cell.dateKey,
          dateLabel: cell.dateLabel,
          dayLabel: cell.dayLabel,
          isOpenDay: cell.isOpenDay,
        })
      }

      return map
    }, new Map<string, { dateKey: string; dateLabel: string; dayLabel: string; isOpenDay: boolean }>()),
  ).map(([, day]) => day)

  const slotNumbers = Array.from(new Set(cells.map((cell) => cell.slotNumber))).sort((left, right) => left - right)
  const slotTemplateByNumber = new Map(slotNumbers.map((slotNumber) => [
    slotNumber,
    cells.find((cell) => cell.slotNumber === slotNumber),
  ]))
  const cellByDayAndSlot = new Map(cells.map((cell) => [`${cell.dateKey}_${cell.slotNumber}`, cell]))
  const deskCount = Math.max(0, ...cells.map((cell) => cell.desks.length))
  const specialPeriodSpans = specialPeriods
    .map((period) => {
      const visibleIndexes = days
        .map((day, index) => (day.dateKey >= period.startDate && day.dateKey <= period.endDate ? index : -1))
        .filter((index) => index >= 0)

      if (visibleIndexes.length === 0) return null

      return {
        id: period.id,
        label: period.label,
        startIndex: visibleIndexes[0],
        endIndex: visibleIndexes[visibleIndexes.length - 1],
      }
    })
    .filter((period): period is { id: string; label: string; startIndex: number; endIndex: number } => period !== null)
    .sort((left, right) => left.startIndex - right.startIndex)

  const specialPeriodSegments: Array<
    | { type: 'gap'; key: string; colSpan: number }
    | { type: 'band'; key: string; colSpan: number; label: string }
  > = []
  let dayCursor = 0
  for (const period of specialPeriodSpans) {
    const startIndex = Math.max(dayCursor, period.startIndex)
    if (startIndex > dayCursor) {
      specialPeriodSegments.push({
        type: 'gap',
        key: `gap_${dayCursor}`,
        colSpan: (startIndex - dayCursor) * 3,
      })
    }

    const daySpan = period.endIndex - startIndex + 1
    if (daySpan <= 0) continue

    specialPeriodSegments.push({
      type: 'band',
      key: period.id,
      colSpan: daySpan * 3,
      label: period.label,
    })
    dayCursor = period.endIndex + 1
  }

  if (dayCursor < days.length) {
    specialPeriodSegments.push({
      type: 'gap',
      key: `gap_tail_${dayCursor}`,
      colSpan: (days.length - dayCursor) * 3,
    })
  }

  return (
    <div className="slot-adjust-grid" role="grid" aria-label="週次のコマ調整テーブル" data-testid="slot-adjust-grid">
      <table>
          <thead>
            {specialPeriodSegments.length > 0 ? (
              <tr className="sa-period-row" data-testid="board-special-periods">
                <th className="sa-time-col"></th>
                {specialPeriodSegments.map((segment) => (segment.type === 'gap'
                  ? <th key={segment.key} colSpan={segment.colSpan} className="sa-period-gap"></th>
                  : (
                    <th key={segment.key} colSpan={segment.colSpan} className="sa-period-band" data-testid={`board-special-period-${segment.key}`}>
                      <button type="button" className="sa-period-band-button" onClick={() => onSpecialPeriodClick(segment.key)}>
                        <span className="sa-period-band-inner">{segment.label}</span>
                      </button>
                    </th>
                  ))) }
              </tr>
            ) : null}
            <tr className={`sa-header-row1${specialPeriodSegments.length > 0 ? ' has-periods' : ''}`}>
              <th className="sa-year-col"><span className="sa-year-label">{yearLabel}</span></th>
              {days.map((day) => (
                <th
                  key={day.dateKey}
                  colSpan={3}
                  className={`sa-day-header sa-day-group-header${day.isOpenDay ? '' : ' sa-day-inactive'}${highlightedHolidayDate === day.dateKey ? ' sa-day-header-picked' : ''}`}
                  data-testid={`day-header-${day.dateKey}`}
                  onClick={() => onDayHeaderClick(day.dateKey)}
                >
                  {day.dateLabel}({day.dayLabel})
                </th>
              ))}
            </tr>
            <tr className={`sa-header-row2${specialPeriodSegments.length > 0 ? ' has-periods' : ''}`}>
              <th className="sa-time-sub-header"></th>
              {days.flatMap((day) => ([
                <th key={`${day.dateKey}_teacher`} className={`sa-sub-header sa-day-group-start${day.isOpenDay ? '' : ' sa-day-inactive'}`}>講師</th>,
                <th key={`${day.dateKey}_student1`} className={`sa-sub-header${day.isOpenDay ? '' : ' sa-day-inactive'}`}>生徒</th>,
                <th key={`${day.dateKey}_student2`} className={`sa-sub-header sa-day-group-end${day.isOpenDay ? '' : ' sa-day-inactive'}`}>生徒</th>,
              ]))}
            </tr>
          </thead>
          <tbody>
            {slotNumbers.flatMap((slotNumber) => {
              const slotTemplate = slotTemplateByNumber.get(slotNumber)
              if (!slotTemplate) return []

              return Array.from({ length: deskCount }, (_, deskIndex) => {
                const isFirstDesk = deskIndex === 0

                return (
                  <tr key={`${slotNumber}_${deskIndex}`} className={isFirstDesk ? 'sa-slot-first' : ''}>
                    {isFirstDesk ? (
                      <td className="sa-time-cell" rowSpan={deskCount}>
                        <div className="sa-time-slot">{slotTemplate.slotLabel}</div>
                        <div className="sa-time-range">{slotTemplate.timeLabel}</div>
                      </td>
                    ) : null}
                    {days.flatMap((day) => {
                      const cell = cellByDayAndSlot.get(`${day.dateKey}_${slotNumber}`)
                      if (!cell) return []

                      const desk = cell.desks[deskIndex]
                      const lesson = desk.lesson
                      const teacherWarning = hasManualTeacherWarning(desk)
                      const teacherClassName = [
                        'sa-teacher',
                        !cell.isOpenDay ? 'sa-inactive' : '',
                        teacherWarning ? 'sa-warning' : '',
                      ].filter(Boolean).join(' ')
                      const firstStudent = lesson?.studentSlots[0] ?? null
                      const secondStudent = lesson?.studentSlots[1] ?? null
                      const firstSelected =
                        (selectedStudentId !== null && firstStudent?.id === selectedStudentId) ||
                        (highlightedCell?.cellId === cell.id && highlightedCell.deskIndex === deskIndex && highlightedCell.studentIndex === 0)
                      const secondSelected =
                        (selectedStudentId !== null && secondStudent?.id === selectedStudentId) ||
                        (highlightedCell?.cellId === cell.id && highlightedCell.deskIndex === deskIndex && highlightedCell.studentIndex === 1)
                      return [
                        <td
                          key={`${cell.id}_${deskIndex}_teacher`}
                          className={`${teacherClassName} sa-day-group-start`}
                          onClick={(event) => onTeacherClick(cell.id, deskIndex, event.clientX, event.clientY)}
                          data-testid={`teacher-cell-${cell.id}-${deskIndex}`}
                        >
                          <div
                            className={`sa-teacher-name${teacherWarning ? ' sa-teacher-name-warning' : ''}`}
                            title={teacherWarning ? '手動追加のため注意' : undefined}
                          >
                            {cell.isOpenDay ? desk.teacher : ''}
                          </div>
                        </td>,
                        renderStudentCell(
                          cell,
                          deskIndex,
                          0,
                          desk.teacher,
                          firstStudent?.name ?? '',
                          desk.memoSlots?.[0] ?? undefined,
                          firstStudent?.grade ?? '',
                          firstStudent?.birthDate,
                          firstStudent?.makeupSourceLabel,
                          firstStudent?.subject ?? '',
                          firstStudent?.lessonType ?? null,
                          firstStudent?.teacherType ?? 'normal',
                          firstStudent?.warning,
                          lesson?.note,
                          firstSelected,
                        ),
                        renderStudentCell(
                          cell,
                          deskIndex,
                          1,
                          desk.teacher,
                          secondStudent?.name ?? '',
                          desk.memoSlots?.[1] ?? undefined,
                          secondStudent?.grade ?? '',
                          secondStudent?.birthDate,
                          secondStudent?.makeupSourceLabel,
                          secondStudent?.subject ?? '',
                          secondStudent?.lessonType ?? null,
                          secondStudent?.teacherType ?? 'normal',
                          secondStudent?.warning,
                          lesson?.note,
                          secondSelected,
                          'sa-day-group-end',
                        ),
                      ]
                    })}
                  </tr>
                )
              })
            })}
          </tbody>
      </table>
    </div>
  )
}