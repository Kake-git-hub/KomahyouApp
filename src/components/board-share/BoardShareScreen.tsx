import { useEffect, useMemo, useState } from 'react'
import { loadBoardShare, subscribeBoardShare, type BoardShareCell, type BoardSharePayload, type BoardShareStatusEntry, type BoardShareStudentEntry } from '../../integrations/firebase/boardShare'
import { lessonTypeLabels, teacherTypeLabels } from '../schedule-board/mockData'
import { groupClassBandTimeLabels, groupClassBands, groupClassEntryKey, type GroupClassEntry } from '../schedule-board/groupClass'
import { buildLinkedLessonDestinationMap, formatShortDateLabel } from '../schedule-board/lessonLinks'
import type { LessonType, StudentStatusKind, TeacherType } from '../schedule-board/types'
import { normalizeRegularLessonNote } from '../basic-data/regularLessonModel'

type BoardShareScreenProps = {
  token: string
}

type BoardShareSelection = {
  dateKey: string
  slotNumber: number
}

function getSelectionStorageKey(token: string) {
  return `boardShareSelection:${token}`
}

function readStoredSelection(token: string): BoardShareSelection | null {
  try {
    const rawValue = window.localStorage.getItem(getSelectionStorageKey(token))
    if (!rawValue) return null
    const parsed = JSON.parse(rawValue) as Partial<BoardShareSelection>
    if (typeof parsed.dateKey !== 'string' || typeof parsed.slotNumber !== 'number') return null
    return { dateKey: parsed.dateKey, slotNumber: parsed.slotNumber }
  } catch {
    return null
  }
}

function writeStoredSelection(token: string, selection: BoardShareSelection) {
  try {
    window.localStorage.setItem(getSelectionStorageKey(token), JSON.stringify(selection))
  } catch {
    // localStorage が使えない環境では表示状態の保存だけ諦める。
  }
}

function getStudentStatusLabel(status: StudentStatusKind) {
  if (status === 'attended') return '出'
  if (status === 'absent-no-makeup') return '振無休'
  if (status === 'moved') return '移'
  return '休'
}

function getLessonShortLabel(lessonType: LessonType) {
  if (lessonType === 'extra') return '増'
  if (lessonType === 'regular') return '通'
  if (lessonType === 'makeup') return '振'
  if (lessonType === 'special') return '講'
  return '体'
}

function getTeacherTypeLabel(teacherType: TeacherType) {
  if (teacherType === 'normal') return ''
  return teacherTypeLabels[teacherType]
}

function formatStudentLabel(student: BoardShareStudentEntry | BoardShareStatusEntry | null | undefined) {
  if (!student) return ''
  const noteSuffix = normalizeRegularLessonNote(student.noteSuffix)
  const lessonLabel = getLessonShortLabel(student.lessonType)
  const teacherTypeLabel = getTeacherTypeLabel(student.teacherType)
  return [
    `${lessonLabel}) ${student.name}`,
    student.grade,
    `${student.subject}${noteSuffix}`,
    teacherTypeLabel,
  ].filter(Boolean).join(' / ')
}

function getVisibleDateLabel(student: BoardShareStudentEntry | BoardShareStatusEntry | null | undefined, status: BoardShareStatusEntry | null, cell: BoardShareCell, linkedDestinationDateKey?: string) {
  if (!student) return ''
  if (status?.status === 'moved') return formatShortDateLabel(status.moveDestinationDateKey)
  if (status) return formatShortDateLabel(linkedDestinationDateKey)
  if (student.lessonType === 'makeup' && student.makeupSourceDate && student.makeupSourceDate !== cell.dateKey) {
    return formatShortDateLabel(student.makeupSourceDate)
  }
  return ''
}

function sortCells(cells: BoardShareCell[]) {
  return [...cells].sort((left, right) => {
    const dateCompare = left.dateKey.localeCompare(right.dateKey)
    if (dateCompare !== 0) return dateCompare
    return left.slotNumber - right.slotNumber
  })
}

function pickInitialDate(cells: BoardShareCell[]) {
  const todayKey = new Date().toLocaleDateString('sv-SE')
  const dateKeys = Array.from(new Set(cells.map((cell) => cell.dateKey))).sort()
  return dateKeys.find((dateKey) => dateKey >= todayKey) ?? dateKeys[0] ?? ''
}

export function BoardShareScreen({ token }: BoardShareScreenProps) {
  const initialSelection = useMemo(() => readStoredSelection(token), [token])
  const [payload, setPayload] = useState<BoardSharePayload | null>(null)
  const [message, setMessage] = useState('配布用盤面を読み込んでいます。')
  const [selectedDateKey, setSelectedDateKey] = useState(initialSelection?.dateKey ?? '')
  const [selectedSlotNumber, setSelectedSlotNumber] = useState(initialSelection?.slotNumber ?? 1)

  const applyPayload = (nextPayload: BoardSharePayload) => {
    setPayload(nextPayload)
    setSelectedDateKey((currentDateKey) => {
      if (nextPayload.cells.some((cell) => cell.dateKey === currentDateKey)) return currentDateKey
      const storedSelection = readStoredSelection(token)
      if (storedSelection && nextPayload.cells.some((cell) => cell.dateKey === storedSelection.dateKey)) return storedSelection.dateKey
      return pickInitialDate(nextPayload.cells)
    })
    setSelectedSlotNumber((currentSlotNumber) => {
      if (nextPayload.cells.some((cell) => cell.slotNumber === currentSlotNumber)) return currentSlotNumber
      const storedSelection = readStoredSelection(token)
      if (storedSelection && nextPayload.cells.some((cell) => cell.slotNumber === storedSelection.slotNumber)) return storedSelection.slotNumber
      return Math.min(...nextPayload.cells.map((cell) => cell.slotNumber))
    })
    setMessage('')
  }

  useEffect(() => {
    let cancelled = false
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setMessage('配布用盤面の読み込みに時間がかかっています。通信状態を確認してください。')
    }, 10000)

    loadBoardShare(token).then((nextPayload) => {
      if (cancelled || !nextPayload) return
      window.clearTimeout(slowTimer)
      applyPayload(nextPayload)
    }).catch(() => {
      // live subscription below will surface the readable error if the first read fails too.
    })

    const unsubscribe = subscribeBoardShare(
      token,
      (nextPayload) => {
        if (cancelled) return
        window.clearTimeout(slowTimer)
        if (!nextPayload) {
          setMessage('配布用盤面が見つかりませんでした。URLを確認してください。')
          return
        }
        applyPayload(nextPayload)
      },
      (error) => {
        if (cancelled) return
        window.clearTimeout(slowTimer)
        setMessage(error instanceof Error ? error.message : '配布用盤面の読み込みに失敗しました。')
      },
    )
    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
      unsubscribe()
    }
  }, [token])

  const sortedCells = useMemo(() => sortCells(payload?.cells ?? []), [payload])
  const dateOptions = useMemo(() => Array.from(new Map(sortedCells.map((cell) => [cell.dateKey, cell])).values()), [sortedCells])
  const slotOptions = useMemo(() => Array.from(new Set(sortedCells.map((cell) => cell.slotNumber))).sort((left, right) => left - right), [sortedCells])
  const linkedLessonDestinationByStatusId = useMemo(() => buildLinkedLessonDestinationMap(sortedCells), [sortedCells])
  const currentCell = sortedCells.find((cell) => cell.dateKey === selectedDateKey && cell.slotNumber === selectedSlotNumber) ?? null
  // spec-group-lesson §A: 選択日の集団授業(2バンド)。デスク一覧の上に表示する。
  const groupEntriesForDate = useMemo<GroupClassEntry[]>(() => {
    const map = payload?.groupClassEntries ?? {}
    return groupClassBands
      .map((band) => map[groupClassEntryKey(selectedDateKey, band)])
      .filter((entry): entry is GroupClassEntry => Boolean(entry && entry.subject))
  }, [payload, selectedDateKey])

  useEffect(() => {
    if (!selectedDateKey || !selectedSlotNumber) return
    writeStoredSelection(token, { dateKey: selectedDateKey, slotNumber: selectedSlotNumber })
  }, [selectedDateKey, selectedSlotNumber, token])

  const moveDate = (offset: number) => {
    if (dateOptions.length === 0) return
    const currentIndex = Math.max(0, dateOptions.findIndex((cell) => cell.dateKey === selectedDateKey))
    const nextIndex = Math.min(dateOptions.length - 1, Math.max(0, currentIndex + offset))
    setSelectedDateKey(dateOptions[nextIndex]?.dateKey ?? selectedDateKey)
  }

  const moveSlot = (offset: number) => {
    if (slotOptions.length === 0) return
    const currentIndex = Math.max(0, slotOptions.findIndex((slotNumber) => slotNumber === selectedSlotNumber))
    const nextIndex = Math.min(slotOptions.length - 1, Math.max(0, currentIndex + offset))
    setSelectedSlotNumber(slotOptions[nextIndex] ?? selectedSlotNumber)
  }

  const selectToday = () => {
    if (dateOptions.length === 0) return
    const todayKey = new Date().toLocaleDateString('sv-SE')
    const exactDate = dateOptions.find((cell) => cell.dateKey === todayKey)
    const nextDate = exactDate ?? dateOptions.find((cell) => cell.dateKey >= todayKey) ?? dateOptions[dateOptions.length - 1]
    setSelectedDateKey(nextDate?.dateKey ?? selectedDateKey)
  }

  if (message) {
    return <div className="board-share-shell"><div className="board-share-message">{message}</div></div>
  }

  const currentDateLabel = currentCell ? `${currentCell.dateLabel}${currentCell.dayLabel ? `(${currentCell.dayLabel})` : ''}` : selectedDateKey
  const currentSlotLabel = currentCell?.slotLabel ?? `${selectedSlotNumber}限`
  const firstDateKey = dateOptions[0]?.dateKey
  const lastDateKey = dateOptions[dateOptions.length - 1]?.dateKey
  const firstSlotNumber = slotOptions[0]
  const lastSlotNumber = slotOptions[slotOptions.length - 1]

  return (
    <div className="board-share-shell">
      <main className="board-share-main" aria-label="配布用盤面">
        {groupEntriesForDate.length > 0 ? (
          <div className="board-share-group-list" aria-label="集団授業">
            {groupEntriesForDate.map((entry) => (
              <div className="board-share-group" key={`${entry.dateKey}_${entry.band}`}>
                <span className="board-share-group-time">集団 {groupClassBandTimeLabels[entry.band]}</span>
                <span className="board-share-group-subject">{entry.subject}</span>
                {entry.teacherName ? <span className="board-share-group-teacher">{entry.teacherName}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {currentCell ? (
          <div className="board-share-desk-list" style={{ '--board-share-desk-count': currentCell.desks.length } as React.CSSProperties}>
            {currentCell.desks.map((desk, deskIndex) => {
              const firstStudent = desk.lesson?.studentSlots[0] ?? null
              const secondStudent = desk.lesson?.studentSlots[1] ?? null
              const firstStatus = desk.statusSlots?.[0] ?? null
              const secondStatus = desk.statusSlots?.[1] ?? null
              const studentSlots = [
                { student: firstStudent, status: firstStatus },
                { student: secondStudent, status: secondStatus },
              ]
              return (
                <section className="board-share-desk" key={desk.id}>
                  <div className="board-share-seat">{deskIndex + 1}</div>
                  <div className="board-share-desk-body">
                    <div className="board-share-teacher">{desk.teacher && desk.teacher !== '講師未設定' && desk.teacher !== '講師未割当' ? desk.teacher : ''}</div>
                    <div className="board-share-students">
                      {studentSlots.map(({ student, status }, studentIndex) => {
                        const visibleStudent = student ?? status
                        const visibleDateLabel = getVisibleDateLabel(visibleStudent, status, currentCell, status ? linkedLessonDestinationByStatusId.get(status.id)?.dateKey : undefined)
                        return (
                        <div className={`board-share-student${status ? ' board-share-status' : ''}`} key={`${desk.id}-student-${studentIndex}`}>
                          <span className="board-share-student-label">
                            {formatStudentLabel(visibleStudent)}{status ? `(${getStudentStatusLabel(status.status)}` : ''}
                          </span>
                          {visibleDateLabel ? <span className="board-share-origin-date">{visibleDateLabel}</span> : null}
                          {visibleStudent ? <span className="board-share-lesson-type">{lessonTypeLabels[visibleStudent.lessonType]}</span> : null}
                        </div>
                        )
                      })}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="board-share-message">この日の盤面は配布データに含まれていません。</div>
        )}
      </main>

      <footer className="board-share-footer">
        <label className="board-share-footer-info" aria-label="表示日を選択">
          <span className="board-share-date-text">{currentDateLabel}</span>
          <span className="board-share-slot-text">{currentSlotLabel}</span>
          <input
            type="date"
            value={selectedDateKey}
            min={firstDateKey}
            max={lastDateKey}
            onChange={(event) => setSelectedDateKey(event.currentTarget.value)}
          />
        </label>
        <div className="board-share-controls" aria-label="表示切り替え">
          <button type="button" onClick={() => moveDate(-1)} disabled={firstDateKey === selectedDateKey}>◀前日</button>
          <button type="button" onClick={() => moveSlot(-1)} disabled={firstSlotNumber === selectedSlotNumber}>▲前コマ</button>
          <button type="button" onClick={() => moveSlot(1)} disabled={lastSlotNumber === selectedSlotNumber}>▼後コマ</button>
          <button type="button" onClick={() => moveDate(1)} disabled={lastDateKey === selectedDateKey}>翌日▶</button>
          <button type="button" className="board-share-today-button" onClick={selectToday}>今日</button>
        </div>
      </footer>
    </div>
  )
}