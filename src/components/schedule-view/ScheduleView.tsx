// 対話用日程表 React ビュー本体(spec-schedule-interactive-view)。
// 盤面 state から親(ScheduleBoardScreen)が組んだ SchedulePayload を受け取り、
// scheduleViewData の純関数で view model を算出して描画する。同一 React ツリーのため
// 盤面編集は自動反映(リアルタイム同期は「同じ state で再レンダー」で成立)。
// 期間・人選択の絞り込みは即時適用(旧「最新表示」ボタンは不要になった)。
//
// 日程表コマ組み(spec-student-schedule-dnd): 生徒ビューの授業カードを長押し(約250ms・盤面D&Dと
// 同じ)で掴み、空きコマへドロップ → 机選択モーダル(コマ表と同じ配置) → 盤面の executeMoveStudent を
// 直接呼ぶ(親から onExecuteMove として受け取る)。自動割振ルール・警告は評価も表示もしない。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { bumpMemCounter } from '../../utils/memoryDiagnostics'
import { buildSubmissionQrSvg } from '../../utils/scheduleHtml'
import type { SchedulePayload, SerializedStudent, SerializedTeacher } from '../../utils/scheduleHtml'
import {
  buildPeriodOptions,
  buildStudentSheetViewModel,
  buildTeacherSheetViewModel,
  filterPeopleByQuery,
  formatMonthDay,
  formatStudentHeaderName,
  formatTeacherHeaderName,
  getVisibleStudents,
  getVisibleTeachers,
  resolveDefaultPersonId,
  scheduleLessonTypeLabels,
} from '../../utils/scheduleViewData'
import type { ScheduleViewType, StudentCellCardData, StudentGridCellData } from '../../utils/scheduleViewData'
import type { SlotCell } from '../schedule-board/types'
import { StudentScheduleSheet, TeacherScheduleSheet } from './ScheduleSheet'
import { buildDeskPickerDesks } from './scheduleViewMove'
import type { DeskPickerDesk, ScheduleViewMoveSeat, ScheduleViewMoveSource } from './scheduleViewMove'

export type ScheduleViewRange = {
  startDate: string
  endDate: string
  periodValue: string
  personId?: string
}

export type ScheduleViewMoveResult = { ok: boolean; message: string }

export type ScheduleViewProps = {
  viewType: ScheduleViewType
  payload: SchedulePayload
  range: ScheduleViewRange
  onRangeChange: (range: ScheduleViewRange) => void
  onScheduleNoteChange?: (noteKey: string, value: string) => void
  onOpenPrintAll?: () => void
  classroomStorageKey?: string
  // 日程表コマ組み(生徒ビューのみ)。両方が揃ったときだけD&Dが有効になる。
  onExecuteMove?: (source: ScheduleViewMoveSource, seat: ScheduleViewMoveSeat) => ScheduleViewMoveResult
  resolveMoveTargetCell?: (dateKey: string, slotNumber: number) => SlotCell | null
  resolveStudentDisplayName?: (name: string) => string
}

function normalizeRangeDates(startDate: string, endDate: string) {
  if (startDate && endDate && startDate > endDate) return { startDate: endDate, endDate: startDate }
  return { startDate, endDate }
}

type DeskPickerState = {
  source: ScheduleViewMoveSource
  targetDateKey: string
  targetSlotNumber: number
  targetLabel: string
  desks: DeskPickerDesk[]
}

// 長押し判定(盤面D&D studentDragAndDropMove と同じ約250ms)と、掴み中の移動許容距離。
const LONG_PRESS_MS = 250
const PRESS_MOVE_TOLERANCE_PX = 8

export function ScheduleView({ viewType, payload, range, onRangeChange, onScheduleNoteChange, onOpenPrintAll, classroomStorageKey, onExecuteMove, resolveMoveTargetCell, resolveStudentDisplayName }: ScheduleViewProps) {
  const [personSearch, setPersonSearch] = useState('')

  const { startDate, endDate } = normalizeRangeDates(
    range.startDate || payload.defaultStartDate || payload.availableStartDate,
    range.endDate || payload.defaultEndDate || payload.availableEndDate,
  )

  const periodOptions = useMemo(() => buildPeriodOptions(payload), [payload])

  const visiblePeople = useMemo<Array<SerializedStudent | SerializedTeacher>>(
    () => (viewType === 'student' ? getVisibleStudents(payload, startDate, endDate) : getVisibleTeachers(payload, startDate, endDate)),
    [payload, viewType, startDate, endDate],
  )
  const filteredPeople = useMemo(() => filterPeopleByQuery(visiblePeople, personSearch), [visiblePeople, personSearch])

  const resolvedPersonId = useMemo(
    () => resolveDefaultPersonId(payload, viewType, startDate, endDate, range.personId),
    [payload, viewType, startDate, endDate, range.personId],
  )

  const vm = useMemo(() => {
    bumpMemCounter('schedule-view-vm-build')
    if (viewType === 'student') {
      return { student: buildStudentSheetViewModel(payload, { startDate, endDate, studentId: resolvedPersonId, resolveQrSvg: buildSubmissionQrSvg }), teacher: null }
    }
    return { student: null, teacher: buildTeacherSheetViewModel(payload, { startDate, endDate, teacherId: resolvedPersonId, resolveQrSvg: buildSubmissionQrSvg }) }
  }, [payload, viewType, startDate, endDate, resolvedPersonId])

  const applyRange = (next: Partial<ScheduleViewRange>) => {
    onRangeChange({
      startDate,
      endDate,
      periodValue: range.periodValue,
      personId: resolvedPersonId,
      ...next,
    })
  }

  const handlePeriodChange = (value: string) => {
    if (!value) {
      applyRange({ periodValue: '' })
      return
    }
    const matched = periodOptions.find((option) => option.value === value)
    if (!matched) return
    applyRange({ periodValue: value, startDate: matched.startDate, endDate: matched.endDate })
  }

  const storageScope = encodeURIComponent(classroomStorageKey || 'default')
  const buildSalaryStorageKey = useMemo(
    () => (unitKey: string) => `schedule-salary:${storageScope}:teacher:${unitKey}`,
    [storageScope],
  )

  // ===== 日程表コマ組み(D&D) =====
  const dndEnabled = viewType === 'student' && Boolean(onExecuteMove && resolveMoveTargetCell)
  // ドラッグ中はゴーストのラベルを state に持つ(null=非ドラッグ)。source はハンドラ専用に ref で持つ
  // (レンダー中に ref を読まない react-hooks/refs 対応)。
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const dragActive = dragLabel !== null
  const [deskPicker, setDeskPicker] = useState<DeskPickerState | null>(null)
  const [moveStatus, setMoveStatus] = useState('')
  const dragSourceRef = useRef<{ source: ScheduleViewMoveSource; label: string } | null>(null)
  const dragGhostRef = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<{
    timer: number
    startX: number
    startY: number
    card: StudentCellCardData
    cell: StudentGridCellData
    doc: Document
  } | null>(null)
  const listenersRef = useRef<{ doc: Document; move: (event: PointerEvent) => void; up: (event: PointerEvent) => void; cancel: () => void } | null>(null)

  const detachDocListeners = useCallback(() => {
    const attached = listenersRef.current
    if (!attached) return
    attached.doc.removeEventListener('pointermove', attached.move)
    attached.doc.removeEventListener('pointerup', attached.up)
    attached.doc.removeEventListener('pointercancel', attached.cancel)
    listenersRef.current = null
  }, [])

  const clearPress = useCallback(() => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer)
      pressRef.current = null
    }
  }, [])

  const endDrag = useCallback(() => {
    dragSourceRef.current = null
    setDragLabel(null)
    detachDocListeners()
    clearPress()
  }, [detachDocListeners, clearPress])

  useEffect(() => endDrag, [endDrag])

  const moveGhost = (clientX: number, clientY: number) => {
    const ghost = dragGhostRef.current
    if (!ghost) return
    ghost.style.left = `${clientX + 12}px`
    ghost.style.top = `${clientY + 12}px`
  }

  const handleDrop = useCallback((doc: Document, clientX: number, clientY: number) => {
    const dragging = dragSourceRef.current
    if (!dragging) return
    const hit = doc.elementFromPoint(clientX, clientY)
    const cellElement = hit instanceof Element ? hit.closest('[data-role="schedule-view-student-cell"][data-drop-candidate="true"]') : null
    if (!(cellElement instanceof HTMLElement)) return
    const dateKey = cellElement.dataset.dateKey ?? ''
    const slotNumber = Number(cellElement.dataset.slotNumber ?? '0')
    if (!dateKey || !slotNumber || !resolveMoveTargetCell) return
    const boardCell = resolveMoveTargetCell(dateKey, slotNumber)
    if (!boardCell) {
      setMoveStatus('移動先のコマ情報を取得できませんでした。')
      return
    }
    if (!boardCell.isOpenDay) {
      setMoveStatus('移動先は休校日のため移動できません。')
      return
    }
    setDeskPicker({
      source: dragging.source,
      targetDateKey: dateKey,
      targetSlotNumber: slotNumber,
      targetLabel: `${formatMonthDay(dateKey)} ${slotNumber}限`,
      desks: buildDeskPickerDesks(boardCell, resolveStudentDisplayName),
    })
  }, [resolveMoveTargetCell, resolveStudentDisplayName])

  const handleCardPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, card: StudentCellCardData, cell: StudentGridCellData) => {
    if (!dndEnabled || !card.entryId) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const doc = event.currentTarget.ownerDocument
    clearPress()
    setMoveStatus('')
    const startX = event.clientX
    const startY = event.clientY
    const timer = window.setTimeout(() => {
      const pressed = pressRef.current
      if (!pressed) return
      pressRef.current = null
      const source: ScheduleViewMoveSource = {
        entryId: card.entryId!,
        studentId: card.studentId,
        sourceDateKey: cell.dateKey,
        sourceSlotNumber: cell.slotNumber,
        lessonType: card.lessonType ?? '',
        subject: card.subject ?? '',
        studentName: card.studentName ?? '',
      }
      const label = `${resolveStudentDisplayName ? resolveStudentDisplayName(source.studentName) : source.studentName} ${card.main}`
      dragSourceRef.current = { source, label }
      setDragLabel(label)
      moveGhost(startX, startY)
    }, LONG_PRESS_MS)
    pressRef.current = { timer, startX, startY, card, cell, doc }

    const handleMove = (moveEvent: PointerEvent) => {
      const pressed = pressRef.current
      if (pressed) {
        // 長押し前に動いたらスクロール等とみなして掴まない(盤面D&Dと同じ感覚)。
        const distance = Math.hypot(moveEvent.clientX - pressed.startX, moveEvent.clientY - pressed.startY)
        if (distance > PRESS_MOVE_TOLERANCE_PX) {
          window.clearTimeout(pressed.timer)
          pressRef.current = null
          detachDocListeners()
        }
        return
      }
      if (dragSourceRef.current) {
        moveEvent.preventDefault()
        moveGhost(moveEvent.clientX, moveEvent.clientY)
      }
    }
    const handleUp = (upEvent: PointerEvent) => {
      const wasDragging = Boolean(dragSourceRef.current)
      if (wasDragging) handleDrop(doc, upEvent.clientX, upEvent.clientY)
      endDrag()
    }
    const handleCancel = () => endDrag()

    doc.addEventListener('pointermove', handleMove, { passive: false })
    doc.addEventListener('pointerup', handleUp)
    doc.addEventListener('pointercancel', handleCancel)
    listenersRef.current = { doc, move: handleMove, up: handleUp, cancel: handleCancel }
  }, [dndEnabled, clearPress, detachDocListeners, endDrag, handleDrop, resolveStudentDisplayName])

  const handleSeatSelect = (deskIndex: number, studentIndex: number) => {
    if (!deskPicker || !onExecuteMove) return
    const result = onExecuteMove(deskPicker.source, {
      targetDateKey: deskPicker.targetDateKey,
      targetSlotNumber: deskPicker.targetSlotNumber,
      deskIndex,
      studentIndex,
    })
    setDeskPicker(null)
    setMoveStatus(result.message)
  }

  const personLabel = viewType === 'student' ? '生徒' : '講師'

  return (
    <div className="schedule-view-body">
      <div className="toolbar schedule-view-toolbar">
        <div className="toolbar-field">
          <label>開始日</label>
          <input
            type="date"
            value={startDate}
            onChange={(event) => applyRange({ startDate: event.target.value || startDate, periodValue: '' })}
          />
        </div>
        <div className="toolbar-field">
          <label>終了日</label>
          <input
            type="date"
            value={endDate}
            onChange={(event) => applyRange({ endDate: event.target.value || endDate, periodValue: '' })}
          />
        </div>
        <div className="toolbar-field">
          <label>登録された講習期間を表示する</label>
          <select value={range.periodValue} onChange={(event) => handlePeriodChange(event.target.value)}>
            <option value="">選択してください</option>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="toolbar-spacer" />
        {onOpenPrintAll ? (
          <div className="toolbar-actions">
            <button type="button" className="secondary" onClick={onOpenPrintAll} title="従来どおり印刷用の全員表示タブ(生成HTML)を開きます">印刷用全員表示</button>
          </div>
        ) : null}
        <div className="toolbar-field toolbar-field--search">
          <label>{personLabel}名検索</label>
          <input type="search" placeholder={`${personLabel}名を検索`} value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} />
        </div>
        <div className="toolbar-field">
          <label>{personLabel}選択</label>
          <select
            value={filteredPeople.some((person) => person.id === resolvedPersonId) ? resolvedPersonId : (filteredPeople[0]?.id ?? '')}
            onChange={(event) => applyRange({ personId: event.target.value })}
          >
            {filteredPeople.length === 0 ? <option value="">該当なし</option> : null}
            {filteredPeople.map((person) => (
              <option key={person.id} value={person.id}>
                {viewType === 'student'
                  ? formatStudentHeaderName(person as SerializedStudent, startDate)
                  : formatTeacherHeaderName(person as SerializedTeacher)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {moveStatus ? (
        <div className="schedule-view-move-status" role="status" aria-live="polite" data-testid="schedule-view-move-status">{moveStatus}</div>
      ) : null}
      {dndEnabled && !dragActive && !deskPicker ? (
        <div className="schedule-view-dnd-hint">授業カードを長押しすると空きコマへ移動できます(日程表コマ組み)</div>
      ) : null}
      <main className="pages schedule-view-pages">
        {viewType === 'student' ? (
          vm.student ? (
            <StudentScheduleSheet
              vm={vm.student}
              onScheduleNoteChange={onScheduleNoteChange}
              dragActive={dragActive}
              onCardPointerDown={dndEnabled ? handleCardPointerDown : undefined}
            />
          ) : (
            <div className="empty-state">表示できる生徒が見つかりません。</div>
          )
        ) : vm.teacher ? (
          <TeacherScheduleSheet vm={vm.teacher} buildSalaryStorageKey={buildSalaryStorageKey} />
        ) : (
          <div className="empty-state">表示できる講師が見つかりません。</div>
        )}
      </main>
      {dragLabel !== null ? (
        <div className="schedule-drag-ghost" ref={dragGhostRef} aria-hidden="true">{dragLabel}</div>
      ) : null}
      {deskPicker ? (
        <div className="schedule-desk-picker-overlay" onClick={(event) => { if (event.target === event.currentTarget) setDeskPicker(null) }}>
          <div className="schedule-desk-picker" role="dialog" aria-modal="true" aria-label="移動先の席を選択" data-testid="schedule-desk-picker">
            <div className="schedule-desk-picker-title">{deskPicker.targetLabel} へ移動 — 席を選択</div>
            <div className="schedule-desk-picker-source">
              {(resolveStudentDisplayName ? resolveStudentDisplayName(deskPicker.source.studentName) : deskPicker.source.studentName)}
              {' '}{deskPicker.source.subject}
              （{scheduleLessonTypeLabels[deskPicker.source.lessonType] || deskPicker.source.lessonType}）
            </div>
            {deskPicker.source.lessonType === 'regular' ? (
              <div className="schedule-desk-picker-note">通常授業は<strong>この回のみの振替</strong>として移動します(基本データ・他の週は変わりません)。</div>
            ) : null}
            <div className="schedule-desk-picker-desks">
              {deskPicker.desks.map((desk) => (
                <div key={desk.deskIndex} className="schedule-desk-picker-desk">
                  <div className="schedule-desk-picker-teacher">{desk.teacher || '講師未定'}</div>
                  {desk.seats.map((seat) => (
                    <button
                      key={seat.studentIndex}
                      type="button"
                      className={`schedule-desk-picker-seat${seat.selectable ? ' is-selectable' : ' is-blocked'}`}
                      disabled={!seat.selectable}
                      onClick={() => handleSeatSelect(desk.deskIndex, seat.studentIndex)}
                      data-testid={`schedule-desk-picker-seat-${desk.deskIndex}-${seat.studentIndex}`}
                    >
                      {seat.occupied ? seat.label : seat.blockedByMemo ? 'メモあり' : seat.statusLabel ? `空席 (${seat.statusLabel})` : '空席'}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="schedule-desk-picker-actions">
              <button type="button" onClick={() => setDeskPicker(null)}>キャンセル</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
