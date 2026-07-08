// 対話用日程表 React ビュー本体(spec-schedule-interactive-view)。
// 盤面 state から親(ScheduleBoardScreen)が組んだ SchedulePayload を受け取り、
// scheduleViewData の純関数で view model を算出して描画する。同一 React ツリーのため
// 盤面編集は自動反映(リアルタイム同期は「同じ state で再レンダー」で成立)。
// 期間・人選択は下書き(draft)＋「反映」ボタンで適用する(旧生成HTMLの「最新表示」相当)。
//
// 日程表コマ組み(spec-student-schedule-dnd): 生徒ビューの授業カードを長押し(約250ms・盤面D&Dと
// 同じ)で掴み、空きコマへドロップ → 机選択モーダル(コマ表と同じ配置) → 盤面の executeMoveStudent を
// 直接呼ぶ(親から onExecuteMove として受け取る)。自動割振ルール・警告は評価も表示もしない。
// ⚠️ ポップアウト(子ウィンドウ)対応: pointer 操作は document への addEventListener ではなく、
// カード要素の React synthetic pointer events ＋ setPointerCapture で完結させる(別ウィンドウでも
// 確実にドロップ判定できる)。hit-test は event.view.document.elementFromPoint(発生元ウィンドウ)。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import type { ScheduleCardDragHandlers } from './ScheduleSheet'
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
  // 従来の生成HTML(印刷)を開くアクション。生徒ビューでのみ空フォーマット/講習集計を出す。
  onOpenPrintAll?: () => void
  onOpenEmptyFormat?: () => void
  onOpenLectureSummary?: () => void
  classroomStorageKey?: string
  // 別ウィンドウ表示: 日程表シートが下まで収まるよう zoom を自動調整する。
  fitToWindow?: boolean
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

function findDropCandidate(doc: Document, x: number, y: number): HTMLElement | null {
  const hit = doc.elementFromPoint(x, y)
  const td = hit instanceof Element ? hit.closest('[data-role="schedule-view-student-cell"][data-drop-candidate="true"]') : null
  return td instanceof HTMLElement ? td : null
}

function eventDocument(event: ReactPointerEvent<HTMLElement>): Document {
  // event.view は発生元ウィンドウ(ポップアウトなら子ウィンドウ)。その document で hit-test する。
  const view = event.view as unknown as { document?: Document } | null
  return view?.document ?? event.currentTarget.ownerDocument
}

export function ScheduleView({ viewType, payload, range, onRangeChange, onScheduleNoteChange, onOpenPrintAll, onOpenEmptyFormat, onOpenLectureSummary, classroomStorageKey, fitToWindow, onExecuteMove, resolveMoveTargetCell, resolveStudentDisplayName }: ScheduleViewProps) {
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

  // ===== 期間・生徒(講師)の下書き(draft)＋「反映」ボタン =====
  // 旧生成HTMLの「最新表示」に相当。開始日/終了日/講習期間/人選択を下書きに溜め、反映ボタンで適用する。
  const [draft, setDraft] = useState<{ startDate: string; endDate: string; periodValue: string; personId: string }>(() => ({
    startDate,
    endDate,
    periodValue: range.periodValue,
    personId: range.personId ?? '',
  }))
  const draftPersonId = draft.personId || resolvedPersonId

  const handlePeriodDraftChange = (value: string) => {
    if (!value) {
      setDraft((prev) => ({ ...prev, periodValue: '' }))
      return
    }
    const matched = periodOptions.find((option) => option.value === value)
    if (!matched) return
    setDraft((prev) => ({ ...prev, periodValue: value, startDate: matched.startDate, endDate: matched.endDate }))
  }

  const applyDraft = () => {
    const normalized = normalizeRangeDates(draft.startDate || startDate, draft.endDate || endDate)
    onRangeChange({
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      periodValue: draft.periodValue,
      personId: draftPersonId,
    })
  }

  const storageScope = encodeURIComponent(classroomStorageKey || 'default')
  const buildSalaryStorageKey = useMemo(
    () => (unitKey: string) => `schedule-salary:${storageScope}:teacher:${unitKey}`,
    [storageScope],
  )

  // 講習集計結果は表示期間に講習期間(specialSession)が重なるときだけ出す(旧生成HTMLと同じ出し分け)。
  const hasLectureSummary = useMemo(
    () => (payload.specialSessions || []).some((session) => session.startDate <= endDate && session.endDate >= startDate),
    [payload.specialSessions, startDate, endDate],
  )

  // ===== 別ウィンドウ fit: シートが下まで収まる zoom を計算して適用する =====
  // zoom は transform と違いレイアウト箱ごと縮むため縦スクロールが出ず、elementFromPoint も
  // 縮小後の座標で正しく当たる(D&Dの hit-test と両立)。印刷時は注入した print CSS が zoom:1 に戻す。
  const pagesRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!fitToWindow) return
    const pages = pagesRef.current
    if (!pages) return
    const applyFit = () => {
      const sheet = pages.querySelector('.sheet') as HTMLElement | null
      if (!sheet) return
      sheet.style.zoom = '1'
      const availW = pages.clientWidth - 16
      const availH = pages.clientHeight - 16
      const natW = sheet.offsetWidth
      const natH = sheet.offsetHeight
      if (!natW || !natH || availW <= 0 || availH <= 0) return
      const z = Math.min(availW / natW, availH / natH, 2)
      sheet.style.zoom = z > 0 ? String(z) : '1'
    }
    applyFit()
    const win = pages.ownerDocument.defaultView
    const observer = new ResizeObserver(applyFit)
    observer.observe(pages)
    win?.addEventListener('resize', applyFit)
    return () => {
      observer.disconnect()
      win?.removeEventListener('resize', applyFit)
    }
  }, [fitToWindow, resolvedPersonId, startDate, endDate, payload])

  // ===== 日程表コマ組み(D&D) =====
  const dndEnabled = viewType === 'student' && Boolean(onExecuteMove && resolveMoveTargetCell)
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const dragActive = dragLabel !== null
  const [deskPicker, setDeskPicker] = useState<DeskPickerState | null>(null)
  const [moveStatus, setMoveStatus] = useState('')
  const dragSourceRef = useRef<{ source: ScheduleViewMoveSource; label: string } | null>(null)
  const dragGhostRef = useRef<HTMLDivElement | null>(null)
  const hoverCellRef = useRef<HTMLElement | null>(null)
  const pressTimerRef = useRef<number | null>(null)
  const pressRef = useRef<{ startX: number; startY: number; card: StudentCellCardData; cell: StudentGridCellData } | null>(null)
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null)

  const setHoverCell = useCallback((td: HTMLElement | null) => {
    if (hoverCellRef.current === td) return
    hoverCellRef.current?.classList.remove('is-drop-hover')
    if (td) td.classList.add('is-drop-hover')
    hoverCellRef.current = td
  }, [])

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }, [])

  const releaseCapture = useCallback(() => {
    const capture = captureRef.current
    if (capture) {
      try {
        capture.el.releasePointerCapture(capture.pointerId)
      } catch {
        // すでに解放済み等は無視
      }
      captureRef.current = null
    }
  }, [])

  const finishDrag = useCallback(() => {
    clearPressTimer()
    pressRef.current = null
    dragSourceRef.current = null
    setHoverCell(null)
    setDragLabel(null)
  }, [clearPressTimer, setHoverCell])

  useEffect(() => () => {
    releaseCapture()
    finishDrag()
  }, [releaseCapture, finishDrag])

  const moveGhost = (clientX: number, clientY: number) => {
    const ghost = dragGhostRef.current
    if (!ghost) return
    ghost.style.left = `${clientX + 14}px`
    ghost.style.top = `${clientY + 14}px`
  }

  const openDeskPicker = useCallback((td: HTMLElement) => {
    const dragging = dragSourceRef.current
    if (!dragging || !resolveMoveTargetCell) return
    const dateKey = td.dataset.dateKey ?? ''
    const slotNumber = Number(td.dataset.slotNumber ?? '0')
    if (!dateKey || !slotNumber) return
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

  // カードに直接ぶら下げる pointer ハンドラ束。useMemo で安定参照にし行のメモ化を壊さない。
  const dragHandlers = useMemo<ScheduleCardDragHandlers | undefined>(() => {
    if (!dndEnabled) return undefined
    const onPointerDown = (event: ReactPointerEvent<HTMLElement>, card: StudentCellCardData, cell: StudentGridCellData) => {
      if (!card.entryId) return
      if (event.button !== 0 && event.pointerType === 'mouse') return
      if (dragSourceRef.current) return
      clearPressTimer()
      releaseCapture()
      setMoveStatus('')
      const el = event.currentTarget
      const pointerId = event.pointerId
      // 掴んでいる間 pointer をカードに固定する。以降の move/up はカードの synthetic event で受ける
      // (ポップアウト子ウィンドウでも document に頼らず確実に届く)。
      try {
        el.setPointerCapture(pointerId)
        captureRef.current = { el, pointerId }
      } catch {
        captureRef.current = null
      }
      pressRef.current = { startX: event.clientX, startY: event.clientY, card, cell }
      pressTimerRef.current = window.setTimeout(() => {
        const pressed = pressRef.current
        if (!pressed) return
        pressTimerRef.current = null
        const source: ScheduleViewMoveSource = {
          entryId: pressed.card.entryId!,
          studentId: pressed.card.studentId,
          sourceDateKey: pressed.cell.dateKey,
          sourceSlotNumber: pressed.cell.slotNumber,
          lessonType: pressed.card.lessonType ?? '',
          subject: pressed.card.subject ?? '',
          studentName: pressed.card.studentName ?? '',
        }
        const label = `${resolveStudentDisplayName ? resolveStudentDisplayName(source.studentName) : source.studentName} ${pressed.card.main}`
        dragSourceRef.current = { source, label }
        setDragLabel(label)
        moveGhost(pressed.startX, pressed.startY)
      }, LONG_PRESS_MS)
    }
    const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
      if (pressTimerRef.current !== null) {
        // 長押し前に動いたらスクロール等とみなして掴まない(盤面D&Dと同じ感覚)。
        const pressed = pressRef.current
        if (pressed && Math.hypot(event.clientX - pressed.startX, event.clientY - pressed.startY) > PRESS_MOVE_TOLERANCE_PX) {
          clearPressTimer()
          releaseCapture()
          pressRef.current = null
        }
        return
      }
      if (dragSourceRef.current) {
        event.preventDefault()
        moveGhost(event.clientX, event.clientY)
        setHoverCell(findDropCandidate(eventDocument(event), event.clientX, event.clientY))
      }
    }
    const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
      if (dragSourceRef.current) {
        const td = hoverCellRef.current ?? findDropCandidate(eventDocument(event), event.clientX, event.clientY)
        if (td) openDeskPicker(td)
      }
      releaseCapture()
      finishDrag()
    }
    const onPointerCancel = () => {
      releaseCapture()
      finishDrag()
    }
    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  }, [dndEnabled, clearPressTimer, releaseCapture, finishDrag, setHoverCell, openDeskPicker, resolveStudentDisplayName])

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
      {dragActive ? <div className="schedule-drag-frame" aria-hidden="true" data-testid="schedule-drag-frame" /> : null}
      <div className="toolbar schedule-view-toolbar">
        <div className="toolbar-field">
          <label>開始日</label>
          <input
            type="date"
            value={draft.startDate}
            onChange={(event) => setDraft((prev) => ({ ...prev, startDate: event.target.value || prev.startDate, periodValue: '' }))}
          />
        </div>
        <div className="toolbar-field">
          <label>終了日</label>
          <input
            type="date"
            value={draft.endDate}
            onChange={(event) => setDraft((prev) => ({ ...prev, endDate: event.target.value || prev.endDate, periodValue: '' }))}
          />
        </div>
        <div className="toolbar-field">
          <label>登録された講習期間を表示する</label>
          <select value={draft.periodValue} onChange={(event) => handlePeriodDraftChange(event.target.value)}>
            <option value="">選択してください</option>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-actions">
          {viewType === 'student' && onOpenEmptyFormat ? (
            <button type="button" className="secondary" onClick={onOpenEmptyFormat}>空フォーマット印刷</button>
          ) : null}
          {viewType === 'student' && hasLectureSummary && onOpenLectureSummary ? (
            <button type="button" className="secondary" onClick={onOpenLectureSummary}>講習集計結果</button>
          ) : null}
          {onOpenPrintAll ? (
            <button type="button" className="secondary" onClick={onOpenPrintAll} title="全員分を従来の印刷用タブで開きます">印刷用全員表示</button>
          ) : null}
        </div>
        <div className="toolbar-field toolbar-field--search">
          <label>{personLabel}名検索</label>
          <input type="search" placeholder={`${personLabel}名を検索`} value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} />
        </div>
        <div className="toolbar-field">
          <label>{personLabel}選択</label>
          <select
            value={filteredPeople.some((person) => person.id === draftPersonId) ? draftPersonId : (filteredPeople[0]?.id ?? '')}
            onChange={(event) => setDraft((prev) => ({ ...prev, personId: event.target.value }))}
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
        <div className="toolbar-actions">
          <button type="button" onClick={applyDraft} title="選択した期間・生徒/講師を反映して表示を更新します">期間・{personLabel}反映</button>
        </div>
      </div>
      {moveStatus ? (
        <div className="schedule-view-move-status" role="status" aria-live="polite" data-testid="schedule-view-move-status">{moveStatus}</div>
      ) : null}
      <main className="pages schedule-view-pages" ref={pagesRef}>
        {viewType === 'student' ? (
          vm.student ? (
            <StudentScheduleSheet
              vm={vm.student}
              onScheduleNoteChange={onScheduleNoteChange}
              dragHandlers={dragHandlers}
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
