import { lessonTypeLabels, teacherTypeLabels } from './mockData'
import { getMemoTextStyle } from './memoText'
import type { LessonType, SlotCell, StudentStatusEntry, StudentStatusKind, TeacherType } from './types'
import { normalizeRegularLessonNote } from '../basic-data/regularLessonModel'
import { resolveDisplayedSubjectForGrade } from '../../utils/studentGradeSubject'

function getStudentStatusLabel(status: StudentStatusKind) {
  return status === 'attended' ? '出' : '休'
}

function formatMakeupSourceDate(dateKey?: string) {
  if (!dateKey) return ''
  const [, month = '', day = ''] = dateKey.split('-')
  if (!month || !day) return ''
  return `${Number(month)}/${Number(day)}`
}

function getLessonPrefix(lessonType: LessonType) {
  switch (lessonType) {
    case 'regular':
      return { label: lessonTypeLabels[lessonType], text: '通)', className: 'prefix-lesson-regular' }
    case 'makeup':
      return { label: lessonTypeLabels[lessonType], text: '振)', className: 'prefix-lesson-makeup' }
    case 'special':
      return { label: lessonTypeLabels[lessonType], text: '講)', className: 'prefix-lesson-special' }
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
  onTeacherClick: (cellId: string, deskIndex: number, x: number, y: number) => void
  onStudentClick: (cellId: string, deskIndex: number, studentIndex: number, hasStudent: boolean, hasMemo: boolean, statusKind: StudentStatusKind | null, x: number, y: number) => void
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
    makeupSourceDate: string | undefined,
    makeupSourceLabel: string | undefined,
    studentSubject: string,
    noteSuffix: string | undefined,
    lessonType: LessonType | null,
    teacherType: TeacherType,
    studentWarning: string | undefined,
    lessonNote: string | undefined,
    isPicked: boolean,
    statusEntry: StudentStatusEntry | null = null,
    extraClassName = '',
  ) => {
    const effectiveName = studentName || statusEntry?.name || ''
    const effectiveGrade = studentName ? studentGrade : (statusEntry?.grade ?? studentGrade)
    const effectiveBirthDate = studentName ? studentBirthDate : (statusEntry?.birthDate ?? studentBirthDate)
    const effectiveSubject = studentName ? studentSubject : (statusEntry?.subject ?? studentSubject)
    const effectiveNoteSuffix = studentName ? normalizeRegularLessonNote(noteSuffix) : normalizeRegularLessonNote(statusEntry?.noteSuffix)
    const effectiveLessonType = studentName ? lessonType : (statusEntry?.lessonType ?? lessonType)
    const effectiveTeacherType = studentName ? teacherType : (statusEntry?.teacherType ?? teacherType)
    const effectiveMakeupSourceDate = studentName ? makeupSourceDate : (statusEntry?.makeupSourceDate ?? makeupSourceDate)
    const effectiveMakeupSourceLabel = studentName ? makeupSourceLabel : (statusEntry?.makeupSourceLabel ?? makeupSourceLabel)
    const statusLabel = statusEntry ? getStudentStatusLabel(statusEntry.status) : ''
    const resolvedLessonType = effectiveName ? resolveDisplayedLessonType(effectiveName, effectiveSubject, effectiveLessonType, cell.dateKey, cell.slotNumber) : effectiveLessonType
    const lessonPrefix = resolvedLessonType ? getLessonPrefix(resolvedLessonType) : null
    const teacherStar = getTeacherStar(effectiveTeacherType)
    const displayName = studentName
      ? resolveStudentDisplayName(studentName)
      : statusEntry
        ? `${resolveStudentDisplayName(statusEntry.name)}(${statusLabel}`
        : (memoLabel ?? '')
    const makeupSourceDateLabel = effectiveName && resolvedLessonType === 'makeup' ? formatMakeupSourceDate(effectiveMakeupSourceDate) : ''
    const displayGrade = effectiveName ? resolveStudentGradeLabel(effectiveName, effectiveGrade, cell.dateKey, effectiveBirthDate) : ''
    const displaySubject = resolveDisplayedSubjectForGrade(effectiveSubject, displayGrade || effectiveGrade)
    const displaySubjectWithNote = `${displaySubject}${effectiveNoteSuffix}`
    const missingTeacherWarning = studentName && !teacherName.trim() ? '講師なし' : undefined
    const visibleNote = lessonNote === '管理データ反映' ? undefined : lessonNote
    const hasWarning = Boolean(studentWarning || missingTeacherWarning)
    const hasMemo = !studentName && Boolean(memoLabel)
    const hasStatus = !studentName && Boolean(statusEntry)
    const memoNotice = hasMemo ? '手入力メモのため注意' : undefined
    const statusNotice = statusEntry
      ? [getStudentStatusLabel(statusEntry.status), lessonTypeLabels[statusEntry.lessonType], resolveDisplayedSubjectForGrade(statusEntry.subject, statusEntry.grade), statusEntry.teacherName].filter(Boolean).join(' / ')
      : undefined
    const originalLessonLabel = effectiveMakeupSourceLabel && (
      resolvedLessonType === 'makeup'
      || (resolvedLessonType === 'regular' && effectiveMakeupSourceDate === cell.dateKey)
    )
      ? `元の通常授業: ${effectiveMakeupSourceLabel}`
      : ''
    const hoverText = Array.from(new Set([
      memoNotice,
      statusNotice,
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
        onClick={(event) => onStudentClick(cell.id, deskIndex, studentIndex, Boolean(studentName), hasMemo, statusEntry?.status ?? null, event.clientX, event.clientY)}
        data-testid={`student-cell-${cell.id}-${deskIndex}-${studentIndex}`}
      >
        <div className="sa-student-inner">
          <span className="sa-student-name-row">
            <span
              className={`sa-student-name${hasWarning ? ' sa-student-name-warning' : ''}${hasMemo ? ' sa-student-name-note' : ''}${hasStatus ? ' sa-student-name-absence' : ''}`}
              data-testid={`student-name-${cell.id}-${deskIndex}-${studentIndex}`}
              title={hoverText}
              style={hasMemo ? getMemoTextStyle(displayName) : undefined}
            >
              {displayName}
            </span>
            {makeupSourceDateLabel ? <span className="sa-student-origin-date">{makeupSourceDateLabel}</span> : null}
          </span>
          {hasMemo ? null : (
            <span className={`sa-student-detail${hasStatus ? ' sa-student-detail-muted' : ''}`}>
              {lessonPrefix || teacherStar ? (
                <span className="sa-student-markers">
                  {lessonPrefix ? (
                    <span
                      className={`sa-student-detail-prefix ${lessonPrefix.className}`}
                      title={lessonPrefix.label}
                      aria-label={lessonPrefix.label}
                    >
                      {lessonPrefix.text}
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
                <span className="sa-student-detail-subject">{displaySubjectWithNote}</span>
              </>
            </span>
          )}
        </div>
      </td>
    )
  }

  const hasManualTeacherWarning = (desk: SlotCell['desks'][number]) => {
    return desk.teacherAssignmentSource === 'manual'
  }

  const getTeacherAssignmentHint = (desk: SlotCell['desks'][number]) => {
    if (desk.teacherAssignmentSource === 'schedule-registration') return '日程表より登録'
    if (desk.teacherAssignmentSource === 'manual') return '手動設定'
    return undefined
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
                      <div className="sa-period-band-button">
                        <span className="sa-period-band-inner">{segment.label}</span>
                      </div>
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
                  {day.dayLabel ? `${day.dateLabel}(${day.dayLabel})` : day.dateLabel}
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
                        <div className="sa-time-cell-inner">
                          <div className="sa-time-slot">{slotTemplate.slotLabel}</div>
                          <div className="sa-time-range">{slotTemplate.timeLabel}</div>
                        </div>
                      </td>
                    ) : null}
                    {days.flatMap((day) => {
                      const cell = cellByDayAndSlot.get(`${day.dateKey}_${slotNumber}`)
                      if (!cell) return []

                      const desk = cell.desks[deskIndex]
                      const lesson = desk.lesson
                      const teacherWarning = hasManualTeacherWarning(desk)
                      const teacherAssignmentHint = getTeacherAssignmentHint(desk)
                      const teacherClassName = [
                        'sa-teacher',
                        !cell.isOpenDay ? 'sa-inactive' : '',
                        teacherWarning ? 'sa-warning' : '',
                      ].filter(Boolean).join(' ')
                      const firstStudent = lesson?.studentSlots[0] ?? null
                      const secondStudent = lesson?.studentSlots[1] ?? null
                      const firstStatus = desk.statusSlots?.[0] ?? null
                      const secondStatus = desk.statusSlots?.[1] ?? null
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
                            title={teacherWarning ? '手動追加のため注意' : teacherAssignmentHint}
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
                          firstStudent?.makeupSourceDate,
                          firstStudent?.makeupSourceLabel,
                          firstStudent?.subject ?? '',
                          firstStudent?.noteSuffix,
                          firstStudent?.lessonType ?? null,
                          firstStudent?.teacherType ?? 'normal',
                          firstStudent?.warning,
                          lesson?.note,
                          firstSelected,
                          firstStatus,
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
                          secondStudent?.makeupSourceDate,
                          secondStudent?.makeupSourceLabel,
                          secondStudent?.subject ?? '',
                          secondStudent?.noteSuffix,
                          secondStudent?.lessonType ?? null,
                          secondStudent?.teacherType ?? 'normal',
                          secondStudent?.warning,
                          lesson?.note,
                          secondSelected,
                          secondStatus,
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