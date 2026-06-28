import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { groupClassBandTimeLabels, groupClassBands, groupClassEntryKey, resolveGroupClassDayFlags, type GroupClassBand, type GroupClassEntryMap } from './groupClass'
import { buildLinkedLessonDestinationMap, resolveVisibleSlotDateLabel } from './lessonLinks'
import { lessonTypeLabels, teacherTypeLabels } from './mockData'
import { getMemoLineHeight, getMemoTextStyle } from './memoText'
import type { LessonType, SlotCell, StudentStatusEntry, StudentStatusKind, TeacherType } from './types'
import { normalizeRegularLessonNote } from '../basic-data/regularLessonModel'
import { resolveDisplayedSubjectForGrade } from '../../utils/studentGradeSubject'

function getStudentStatusLabel(status: StudentStatusKind) {
  if (status === 'attended') return '出'
  if (status === 'absent-no-makeup') return '振無休'
  if (status === 'moved') return '移'
  return '休'
}

function getLessonPrefix(lessonType: LessonType) {
  switch (lessonType) {
    case 'extra':
      return { label: lessonTypeLabels[lessonType], text: '増)', className: 'prefix-lesson-extra' }
    case 'regular':
      return { label: lessonTypeLabels[lessonType], text: '通)', className: 'prefix-lesson-regular' }
    case 'makeup':
      return { label: lessonTypeLabels[lessonType], text: '振)', className: 'prefix-lesson-makeup' }
    case 'special':
      return { label: lessonTypeLabels[lessonType], text: '講)', className: 'prefix-lesson-special' }
    case 'trial':
      return { label: lessonTypeLabels[lessonType], text: '体)', className: 'prefix-lesson-trial' }
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

function fitFontSize(options: {
  initialFontSize: number
  minFontSize: number
  apply: (fontSize: number) => void
  overflows: () => boolean
}) {
  const { initialFontSize, minFontSize, apply, overflows } = options
  apply(initialFontSize)
  if (!overflows()) return

  let low = minFontSize
  let high = initialFontSize
  for (let index = 0; index < 6; index += 1) {
    const mid = (low + high) / 2
    apply(mid)
    if (overflows()) high = mid
    else low = mid
  }
  apply(low)
}

function fitTeacherTextForBoard(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.sa-teacher-name').forEach((node) => {
    if (!node.textContent?.trim()) return

    node.style.overflow = 'hidden'
    node.style.textOverflow = 'clip'
    // 講師名は必ず 1 行で表示し、幅が足りない場合はフォントを縮める (縦書き見えを避ける)
    node.style.whiteSpace = 'nowrap'
    node.style.width = '100%'
    node.style.height = '100%'

    fitFontSize({
      initialFontSize: 20,
      minFontSize: 7.5,
      apply: (fontSize) => {
        node.style.fontSize = `${fontSize}px`
        node.style.lineHeight = fontSize > 15 ? '1.02' : '1.08'
      },
      overflows: () => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
    })
  })
}

function hasVisibleText(node: HTMLElement) {
  return Boolean(node.textContent?.trim())
}

function fitStudentNameAndDetailTextForBoard(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.sa-student-inner').forEach((inner) => {
    if (!hasVisibleText(inner)) return

    const nameRow = inner.querySelector<HTMLElement>('.sa-student-name-row')
    const nameNode = nameRow
      ? Array.from(nameRow.querySelectorAll<HTMLElement>('.sa-student-name')).find((entry) => !entry.classList.contains('sa-student-name-note')) ?? null
      : null
    const originDateNode = nameRow?.querySelector<HTMLElement>('.sa-student-origin-date') ?? null
    const detail = inner.querySelector<HTMLElement>('.sa-student-detail')
    if (!nameNode && !originDateNode && !detail) return

    fitFontSize({
      initialFontSize: 19,
      minFontSize: 7,
      apply: (fontSize) => {
        if (nameNode) {
          nameNode.style.fontSize = `${fontSize}px`
          nameNode.style.lineHeight = '1'
          nameNode.style.minHeight = '0'
          nameNode.style.whiteSpace = 'nowrap'
        }
        if (originDateNode) {
          originDateNode.style.fontSize = `${fontSize}px`
          originDateNode.style.lineHeight = '1'
          originDateNode.style.minHeight = '0'
          originDateNode.style.whiteSpace = 'nowrap'
        }
        if (detail) {
          detail.style.fontSize = `${fontSize}px`
          detail.style.lineHeight = '1'
          detail.style.minHeight = '0'
          detail.style.gap = '0'
          detail.style.whiteSpace = 'nowrap'
          detail.style.overflow = 'hidden'
          detail.style.textOverflow = 'clip'
        }
      },
      overflows: () => {
        const nameOverflow = nameRow ? nameRow.scrollWidth > nameRow.clientWidth + 1 : false
        const detailOverflow = detail ? detail.scrollWidth > detail.clientWidth + 1 : false
        const heightOverflow = inner.scrollHeight > inner.clientHeight + 1
        return nameOverflow || detailOverflow || heightOverflow
      },
    })
  })
}

function fitMemoTextForBoard(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.sa-student-name-note').forEach((node) => {
    if (!node.textContent?.trim()) return

    node.style.whiteSpace = 'pre-line'
    node.style.overflow = 'hidden'
    node.style.textOverflow = 'clip'
    node.style.display = '-webkit-box'
    node.style.boxSizing = 'border-box'
    node.style.paddingBottom = '1px'
    node.style.setProperty('-webkit-box-orient', 'vertical')
    node.style.setProperty('-webkit-line-clamp', '2')

    fitFontSize({
      initialFontSize: 20,
      minFontSize: 5.5,
      apply: (fontSize) => {
      node.style.fontSize = `${fontSize}px`
        node.style.lineHeight = String(getMemoLineHeight(fontSize))
      },
      overflows: () => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
    })
  })
}

function applyBoardTextSizing(root: HTMLElement) {
  fitTeacherTextForBoard(root)
  fitMemoTextForBoard(root)
  fitStudentNameAndDetailTextForBoard(root)
}

type BoardGridProps = {
  cells: SlotCell[]
  linkResolutionCells?: SlotCell[]
  selectedStudentId: string | null
  highlightedCell: { cellId: string; deskIndex: number; studentIndex: number } | null
  highlightedHolidayDate: string | null
  yearLabel: string
  specialPeriods: Array<{ id: string; label: string; startDate: string; endDate: string }>
  // spec-group-lesson §A: 集団授業（特別講習を含む週のみ・期間内開校日だけ）。
  groupClassEntries?: GroupClassEntryMap
  resolveStudentDisplayName: (name: string) => string
  resolveStudentGradeLabel: (name: string, fallbackGrade: string, dateKey: string, birthDate?: string) => string
  resolveDisplayedLessonType: (name: string, subject: string, lessonType: LessonType | null, dateKey: string, slotNumber: number) => LessonType | null
  onDayHeaderClick: (dateKey: string, x: number, y: number) => void
  onTeacherClick: (cellId: string, deskIndex: number, x: number, y: number) => void
  onStudentClick: (cellId: string, deskIndex: number, studentIndex: number, hasStudent: boolean, hasMemo: boolean, statusKind: StudentStatusKind | null, x: number, y: number) => void
  // 長押しD&D移動(ライブ盤面のみ・開発用教室限定)。有効時のみハンドラを渡す。毎フレーム処理は親側の
  // window リスナと純CSS(:hover)で行い、ここでは mousedown の起点通知だけを担う(再描画を増やさない)。
  dragMoveActive?: boolean
  onStudentMouseDown?: (cellId: string, deskIndex: number, studentIndex: number, hasStudent: boolean, isAttended: boolean, button: number, x: number, y: number) => void
  // spec-group-lesson §A: 集団行のセル操作。空の科目セル→科目ピッカー、科目入り→メニュー(出席者一覧/削除)、講師セル→講師ピッカー。
  onGroupSubjectClick?: (dateKey: string, band: GroupClassBand, hasSubject: boolean, x: number, y: number) => void
  onGroupTeacherClick?: (dateKey: string, band: GroupClassBand, hasEntry: boolean, x: number, y: number) => void
}

function BoardGridComponent({
  cells,
  linkResolutionCells,
  selectedStudentId,
  highlightedCell,
  highlightedHolidayDate,
  yearLabel,
  specialPeriods,
  groupClassEntries,
  resolveStudentDisplayName,
  resolveStudentGradeLabel,
  resolveDisplayedLessonType,
  onDayHeaderClick,
  onTeacherClick,
  onStudentClick,
  dragMoveActive,
  onStudentMouseDown,
  onGroupSubjectClick,
  onGroupTeacherClick,
}: BoardGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const linkedLessonDestinationByStatusId = useMemo(
    () => buildLinkedLessonDestinationMap(linkResolutionCells ?? cells),
    [cells, linkResolutionCells],
  )

  useLayoutEffect(() => {
    const root = gridRef.current
    if (!root) return

    let frameId = window.requestAnimationFrame(() => applyBoardTextSizing(root))
    const handleResize = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => applyBoardTextSizing(root))
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
    }
    // groupClassEntries も依存に含める。集団講師/科目の選択は cells を変えず
    // groupClassEntries だけ更新するため、これが無いと選択直後に講師名の
    // 自動フォントフィットが走らず小さいまま表示される(リロード/週切替で初めて補正)。
  }, [cells, linkResolutionCells, groupClassEntries])

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
    warningHighlight: boolean | undefined,
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
    const linkedDestination = statusEntry ? linkedLessonDestinationByStatusId.get(statusEntry.id) : null
    const visibleDateLabel = resolveVisibleSlotDateLabel({
      hasStudent: Boolean(studentName),
      hasContent: Boolean(effectiveName),
      resolvedLessonType,
      effectiveMakeupSourceDate,
      statusEntry,
      linkedDestinationDateKey: linkedDestination?.dateKey,
    })
    const displayGrade = effectiveName ? resolveStudentGradeLabel(effectiveName, effectiveGrade, cell.dateKey, effectiveBirthDate) : ''
    const displaySubject = resolveDisplayedSubjectForGrade(effectiveSubject, displayGrade || effectiveGrade)
    const displaySubjectWithNote = `${displaySubject}${effectiveNoteSuffix}`
    const missingTeacherWarning = studentName && !teacherName.trim() ? '講師なし' : undefined
    const visibleNote = lessonNote === '管理データ反映' ? undefined : lessonNote
    const isTrial = resolvedLessonType === 'trial'
    const hasWarning = Boolean((warningHighlight && studentWarning) || missingTeacherWarning)
    const hasMemo = !studentName && Boolean(memoLabel)
    const hasStatus = !studentName && Boolean(statusEntry) && !hasMemo
    const memoText = hasMemo ? (memoLabel ?? '').replace(/\r/g, '').split('\n').slice(0, 2).join('\n') : ''
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
        className={`sa-student${!cell.isOpenDay ? ' sa-inactive' : ''}${hasWarning ? ' sa-warning' : ''}${isPicked ? ' sa-student-picked' : ''}${isTrial ? ' sa-student-trial' : ''}${extraClassName ? ` ${extraClassName}` : ''}`}
        onClick={(event) => onStudentClick(cell.id, deskIndex, studentIndex, Boolean(studentName), hasMemo, statusEntry?.status ?? null, event.clientX, event.clientY)}
        onMouseDown={onStudentMouseDown ? (event) => onStudentMouseDown(cell.id, deskIndex, studentIndex, Boolean(studentName), statusEntry?.status === 'attended', event.button, event.clientX, event.clientY) : undefined}
        data-cell-id={cell.id}
        data-desk-index={deskIndex}
        data-student-index={studentIndex}
        data-testid={`student-cell-${cell.id}-${deskIndex}-${studentIndex}`}
      >
        <div className="sa-student-inner">
          {hasMemo ? (
            <span
              className={`sa-student-name sa-student-name-note${hasWarning ? ' sa-student-name-warning' : ''}`}
              style={getMemoTextStyle(memoText)}
              data-testid={`student-name-${cell.id}-${deskIndex}-${studentIndex}`}
              title={hoverText}
            >
              {memoText}
            </span>
          ) : (
            <>
              <span className="sa-student-name-row">
                <span
                  className={`sa-student-name${hasWarning ? ' sa-student-name-warning' : ''}${hasStatus ? ' sa-student-name-absence' : ''}`}
                  data-testid={`student-name-${cell.id}-${deskIndex}-${studentIndex}`}
                  title={hoverText}
                >
                  {displayName}
                </span>
                {visibleDateLabel ? <span className="sa-student-origin-date">{visibleDateLabel}</span> : null}
              </span>
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
            </>
          )}
        </div>
      </td>
    )
  }

  const hasManualTeacherWarning = (_desk: SlotCell['desks'][number]) => false

  const hasUnavailableTeacherWarning = (desk: SlotCell['desks'][number]) => Boolean(desk.teacherUnavailableWarning)

  const getTeacherAssignmentHint = (desk: SlotCell['desks'][number]) => {
    if (desk.teacherAssignmentSource === 'schedule-registration') return '日程表より登録'
    if (desk.teacherAssignmentSource === 'manual' || desk.teacherAssignmentSource === 'manual-replaced') return '手動設定'
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
        colSpan: (startIndex - dayCursor) * 4,
      })
    }

    const daySpan = period.endIndex - startIndex + 1
    if (daySpan <= 0) continue

    specialPeriodSegments.push({
      type: 'band',
      key: period.id,
      colSpan: daySpan * 4,
      label: period.label,
    })
    dayCursor = period.endIndex + 1
  }

  if (dayCursor < days.length) {
    specialPeriodSegments.push({
      type: 'gap',
      key: `gap_tail_${dayCursor}`,
      colSpan: (days.length - dayCursor) * 4,
    })
  }

  // spec-group-lesson §A: この週で特別講習期間に入る日（列インデックス）の集合。
  // 集団2行はこの集合が空でないときだけ描画し、対象日かつ開校日のセルだけ操作可能にする。
  const { showGroupClassRows, specialDayIndexSet } = resolveGroupClassDayFlags(days, specialPeriods)
  const resolvedGroupClassEntries = groupClassEntries ?? {}

  return (
    <div ref={gridRef} className={`slot-adjust-grid${dragMoveActive ? ' slot-adjust-grid-dragging' : ''}`} role="grid" aria-label="週次のコマ調整テーブル" data-testid="slot-adjust-grid">
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
                  colSpan={4}
                  className={`sa-day-header sa-day-group-header${day.isOpenDay ? '' : ' sa-day-inactive'}${highlightedHolidayDate === day.dateKey ? ' sa-day-header-picked' : ''}`}
                  data-testid={`day-header-${day.dateKey}`}
                  onClick={(e) => onDayHeaderClick(day.dateKey, e.clientX, e.clientY)}
                >
                  {day.dayLabel ? `${day.dateLabel}(${day.dayLabel})` : day.dateLabel}
                </th>
              ))}
            </tr>
            <tr className={`sa-header-row2${specialPeriodSegments.length > 0 ? ' has-periods' : ''}`}>
              <th className="sa-time-sub-header"></th>
              {days.flatMap((day) => ([
                <th key={`${day.dateKey}_seat`} className={`sa-sub-header sa-seat-header sa-day-group-start${day.isOpenDay ? '' : ' sa-day-inactive'}`}>席</th>,
                <th key={`${day.dateKey}_teacher`} className={`sa-sub-header${day.isOpenDay ? '' : ' sa-day-inactive'}`}>講師</th>,
                <th key={`${day.dateKey}_student1`} className={`sa-sub-header${day.isOpenDay ? '' : ' sa-day-inactive'}`}>生徒</th>,
                <th key={`${day.dateKey}_student2`} className={`sa-sub-header sa-day-group-end${day.isOpenDay ? '' : ' sa-day-inactive'}`}>生徒</th>,
              ]))}
            </tr>
          </thead>
          <tbody>
            {showGroupClassRows ? groupClassBands.map((band) => (
              <tr key={`group_${band}`} className="sa-group-row" data-testid={`board-group-row-${band}`}>
                <td className="sa-time-cell sa-group-time-cell">
                  <div className="sa-time-cell-inner">
                    <div className="sa-time-slot">集団</div>
                    <div className="sa-time-range">{groupClassBandTimeLabels[band]}</div>
                  </div>
                </td>
                {days.flatMap((day, dayIndex) => {
                  const baseKey = `group_${band}_${day.dateKey}`
                  const isSpecialDay = specialDayIndexSet.has(dayIndex) && day.isOpenDay
                  if (!isSpecialDay) {
                    return [<td key={`${baseKey}_empty`} colSpan={4} className="sa-group-empty sa-inactive" />]
                  }
                  const entry = resolvedGroupClassEntries[groupClassEntryKey(day.dateKey, band)]
                  const hasSubject = Boolean(entry?.subject)
                  return [
                    <td key={`${baseKey}_seat`} className="sa-seat-number sa-day-group-start sa-group-seat" />,
                    <td
                      key={`${baseKey}_teacher`}
                      className="sa-teacher sa-group-teacher"
                      onClick={(event) => onGroupTeacherClick?.(day.dateKey, band, hasSubject, event.clientX, event.clientY)}
                      data-testid={`group-teacher-cell-${day.dateKey}-${band}`}
                    >
                      <div className="sa-teacher-name">{entry?.teacherName ?? ''}</div>
                    </td>,
                    <td
                      key={`${baseKey}_subject`}
                      colSpan={2}
                      className={`sa-student sa-group-subject sa-day-group-end${hasSubject ? '' : ' sa-group-subject-empty'}`}
                      onClick={(event) => onGroupSubjectClick?.(day.dateKey, band, hasSubject, event.clientX, event.clientY)}
                      data-testid={`group-subject-cell-${day.dateKey}-${band}`}
                    >
                      <div className="sa-group-subject-inner">{entry?.subject ?? ''}</div>
                    </td>,
                  ]
                })}
              </tr>
            )) : null}
            {slotNumbers.flatMap((slotNumber) => {
              const slotTemplate = slotTemplateByNumber.get(slotNumber)
              if (!slotTemplate) return []

              return Array.from({ length: deskCount }, (_, deskIndex) => {
                const isFirstDesk = deskIndex === 0
                const isLastDesk = deskIndex === deskCount - 1

                return (
                  <tr key={`${slotNumber}_${deskIndex}`} className={[isFirstDesk ? 'sa-slot-first' : '', isLastDesk ? 'sa-slot-last' : ''].filter(Boolean).join(' ')}>
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
                      const teacherManualWarning = hasManualTeacherWarning(desk)
                      const teacherUnavailableWarning = hasUnavailableTeacherWarning(desk)
                      const teacherWarning = teacherManualWarning || teacherUnavailableWarning
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
                          key={`${cell.id}_${deskIndex}_seat`}
                          className={`sa-seat-number sa-day-group-start${!cell.isOpenDay ? ' sa-inactive' : ''}`}
                          data-testid={`seat-number-cell-${cell.id}-${deskIndex}`}
                        >
                          {cell.isOpenDay ? deskIndex + 1 : ''}
                        </td>,
                        <td
                          key={`${cell.id}_${deskIndex}_teacher`}
                          className={teacherClassName}
                          onClick={(event) => onTeacherClick(cell.id, deskIndex, event.clientX, event.clientY)}
                          data-testid={`teacher-cell-${cell.id}-${deskIndex}`}
                        >
                          <div
                            className={`sa-teacher-name${teacherWarning ? ' sa-teacher-name-warning' : ''}`}
                            title={teacherUnavailableWarning ? '出席不可コマに講師が配置されています' : (teacherManualWarning ? '手動追加のため注意' : teacherAssignmentHint)}
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
                          firstStudent?.warningHighlight,
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
                          secondStudent?.warningHighlight,
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

// 盤面グリッドはセル数が多く再描画コストが大きい。props が変わらない限り再描画しない
// よう memo 化する（自動保存フラグ・進捗タイマー・ポインタプレビュー等、盤面データと
// 無関係な親の再描画でグリッド全体が作り直されるのを防ぐ）。
export const BoardGrid = memo(BoardGridComponent)