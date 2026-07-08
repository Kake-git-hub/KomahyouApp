// 対話用日程表 React ビューのシート描画。表示データは scheduleViewData.ts の純関数(view model)で
// 算出し、ここは描画のみを担う。生成HTML(印刷/PDF)と同じクラス名を使い scheduleView.css で見た目を共有。
// ⚠️ メモリ規律(spec-schedule-interactive-view §E): 行は React.memo＋signature 比較で分割し、
// 盤面編集で変化した行だけを再レンダーする(2026-06-05 メモリ障害の React 版再発防止)。
import { memo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { bumpMemCounter } from '../../utils/memoryDiagnostics'
import { scheduleDayLabels } from '../../utils/scheduleViewData'
import type {
  GroupRowData,
  ScheduleCountRow,
  ScheduleTimeRange,
  StudentCellCardData,
  StudentGridCellData,
  StudentGridRowData,
  StudentSheetViewModel,
  TeacherGridCellData,
  TeacherGridRowData,
  TeacherSalaryViewData,
  TeacherSheetViewModel,
} from '../../utils/scheduleViewData'

// React.memo の等価判定。view model は毎回新しいオブジェクトになるため、表示内容を確定する
// signature(純データのJSON)で比較し、内容が同じ行の再レンダーをスキップする。テストで固定する。
// dragActive(日程表コマ組みのドラッグ中ハイライト)はドラッグ開始/終了の2回だけ変わる想定で、
// 盤面編集ごとの再レンダー抑止(メモリ規律)は損なわない。
export function scheduleRowPropsAreEqual(
  prev: { row: { signature: string }; dragActive?: boolean; onCardPointerDown?: unknown },
  next: { row: { signature: string }; dragActive?: boolean; onCardPointerDown?: unknown },
) {
  return prev.row.signature === next.row.signature
    && Boolean(prev.dragActive) === Boolean(next.dragActive)
    && prev.onCardPointerDown === next.onCardPointerDown
}

// 日程表コマ組み: 授業カードの長押し開始ハンドラ(ScheduleView が供給。未指定ならD&D無効)。
export type ScheduleCardPointerDownHandler = (
  event: ReactPointerEvent<HTMLElement>,
  card: StudentCellCardData,
  cell: StudentGridCellData,
) => void

function TimeHeaderCell({ time, slotLabel }: { time: ScheduleTimeRange; slotLabel?: string }) {
  return (
    <th className="time-col">
      <div className="time-box">
        {slotLabel ? <div className="time-slot">{slotLabel}</div> : null}
        <div className="time-range">
          <span className="time-part">{time.start}</span>
          {time.end ? <span className="time-part">{time.end}</span> : null}
        </div>
      </div>
    </th>
  )
}

function buildSlotCellClassName(cell: { isHoliday: boolean; isUnavailable: boolean; isHighlighted?: boolean }) {
  const classes = ['slot-cell']
  if (cell.isHoliday) classes.push('is-holiday')
  if (cell.isUnavailable) classes.push('is-unavailable')
  if (cell.isHighlighted) classes.push('is-moving-highlight')
  return classes.join(' ')
}

function StudentLessonCard({ card, cell, onCardPointerDown }: { card: StudentCellCardData; cell: StudentGridCellData; onCardPointerDown?: ScheduleCardPointerDownHandler }) {
  const draggable = Boolean(card.draggable && onCardPointerDown)
  return (
    <div
      className={`lesson-card${draggable ? ' is-draggable-card' : ''}`}
      onPointerDown={draggable ? (event) => onCardPointerDown!(event, card, cell) : undefined}
    >
      <div className="lesson-main">{card.main}</div>
      <div className="lesson-sub">{card.sub}</div>
    </div>
  )
}

function StudentCellCards({ cell, onCardPointerDown }: { cell: StudentGridCellData; onCardPointerDown?: ScheduleCardPointerDownHandler }) {
  if (cell.cards.length === 0) return <div className="empty-label" />
  if (cell.cards.length === 1) {
    return <StudentLessonCard card={cell.cards[0]} cell={cell} onCardPointerDown={onCardPointerDown} />
  }
  return (
    <div className="lesson-card-stack">
      {cell.cards.map((card, index) => (
        <div key={index} className="lesson-card-stack-item">
          <StudentLessonCard card={card} cell={cell} onCardPointerDown={onCardPointerDown} />
        </div>
      ))}
    </div>
  )
}

const StudentGridRow = memo(function StudentGridRow({ row, dragActive, onCardPointerDown }: { row: StudentGridRowData; dragActive?: boolean; onCardPointerDown?: ScheduleCardPointerDownHandler }) {
  bumpMemCounter('schedule-view-row-render')
  return (
    <tr>
      <TimeHeaderCell time={row.time} />
      {row.cells.map((cell) => {
        // ドラッグ中は「開校日かつこの生徒の授業が無い空きセル」をドロップ候補として示す
        // (spec-student-schedule-dnd §C-1。実際の可否は机選択と executeMoveStudent が最終判定)。
        const isDropCandidate = Boolean(dragActive && !cell.isHoliday && cell.cards.length === 0)
        return (
          <td
            key={cell.slotKey}
            className={`${buildSlotCellClassName(cell)}${isDropCandidate ? ' is-drop-target' : ''}`}
            title={cell.title || undefined}
            data-role="schedule-view-student-cell"
            data-date-key={cell.dateKey}
            data-slot-number={cell.slotNumber}
            data-slot-key={cell.slotKey}
            data-drop-candidate={isDropCandidate ? 'true' : undefined}
          >
            <div className="slot-cell-content">
              <div className="slot-static">
                <StudentCellCards cell={cell} onCardPointerDown={onCardPointerDown} />
              </div>
            </div>
          </td>
        )
      })}
    </tr>
  )
}, scheduleRowPropsAreEqual)

const TeacherGridRow = memo(function TeacherGridRow({ row }: { row: TeacherGridRowData }) {
  bumpMemCounter('schedule-view-row-render')
  return (
    <tr>
      <TimeHeaderCell time={row.time} />
      {row.cells.map((cell) => (
        <td
          key={cell.slotKey}
          className={buildSlotCellClassName(cell)}
          title={cell.title || undefined}
          data-role="schedule-view-teacher-cell"
          data-date-key={cell.dateKey}
          data-slot-number={cell.slotNumber}
          data-slot-key={cell.slotKey}
        >
          <div className="slot-cell-content">
            <div className="slot-static">
              <TeacherCellCard cell={cell} />
            </div>
          </div>
        </td>
      ))}
    </tr>
  )
}, scheduleRowPropsAreEqual)

function TeacherCellCard({ cell }: { cell: TeacherGridCellData }) {
  if (cell.people.length === 0) return <div className="empty-label" />
  return (
    <div className={`lesson-card lesson-card-teacher ${cell.cardSizeClass}`}>
      {cell.people.map((person, index) => (
        <div key={index} className={`teacher-lesson-person${person.densityClass ? ` ${person.densityClass}` : ''}`}>
          <span className="teacher-lesson-line teacher-lesson-name">{person.name}</span>
          <span className="teacher-lesson-line teacher-lesson-meta">{person.meta}</span>
        </div>
      ))}
    </div>
  )
}

const GroupClassRow = memo(function GroupClassRow({ row }: { row: GroupRowData }) {
  bumpMemCounter('schedule-view-row-render')
  return (
    <tr className="group-class-row">
      <TimeHeaderCell time={row.time} slotLabel="集団" />
      {row.cells.map((cell, index) => (
        <td key={index} className={`slot-cell group-slot-cell${cell.isHoliday ? ' is-holiday' : ''}`}>
          <div className="slot-cell-content">
            {cell.state === 'none' ? null : (
              <span className={`group-slot-label${cell.state === 'absent' ? ' group-slot-absent' : cell.state === 'empty' ? ' group-slot-empty' : ''}`}>
                {cell.label}
              </span>
            )}
          </div>
        </td>
      ))}
    </tr>
  )
}, scheduleRowPropsAreEqual)

type SheetViewModel = StudentSheetViewModel | TeacherSheetViewModel

function SheetTableHead({ vm }: { vm: SheetViewModel }) {
  return (
    <thead>
      {vm.periodSegments.length > 0 ? (
        <tr className="period-row">
          <th className="time-col" />
          {vm.periodSegments.map((segment) => segment.type === 'band' ? (
            <th key={segment.key} colSpan={segment.colSpan} className="period-band">
              <span className="period-pill">
                <span className="period-pill-edge">◀</span>
                <span className="period-pill-center"><span className="period-pill-label">{segment.label}</span></span>
                <span className="period-pill-edge">▶</span>
              </span>
            </th>
          ) : (
            <th key={segment.key} colSpan={segment.colSpan} className="period-gap" />
          ))}
        </tr>
      ) : null}
      <tr className="month-row">
        <th className="time-col time-corner" rowSpan={3}>
          <div className="time-corner-box">
            {vm.years.map((year) => <span key={year} className="time-corner-year">{year}</span>)}
          </div>
        </th>
        {vm.monthGroups.map((group, index) => <th key={index} colSpan={group.count}>{group.month}月</th>)}
      </tr>
      <tr className="date-row">
        {vm.dateHeaders.map((header) => (
          <th key={header.dateKey} className={header.isOpenDay ? undefined : 'holiday-col'}>
            <span className="date-label">{Number(header.dateKey.split('-')[2])}</span>
          </th>
        ))}
      </tr>
      <tr className="weekday-row">
        {vm.dateHeaders.map((header) => {
          const classes = [
            !header.isOpenDay ? 'holiday-col' : '',
            header.weekday === 0 ? 'weekday-sun' : '',
            header.weekday === 6 ? 'weekday-sat' : '',
          ].filter(Boolean).join(' ')
          return (
            <th key={header.dateKey} className={classes || undefined}>
              <span className="weekday-label">{scheduleDayLabelFor(header.weekday)}</span>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

function scheduleDayLabelFor(weekday: number) {
  return scheduleDayLabels[weekday] ?? ''
}

function noteRowFontSize(note: string) {
  if (note.length > 40) return { fontSize: '7px' }
  if (note.length > 28) return { fontSize: '8px' }
  return undefined
}

function padNoteRows(notes: string[], minimumRowCount: number) {
  return Array.from({ length: Math.max(minimumRowCount, notes.length) }, (_, index) => notes[index] ?? '')
}

function NoteRowsTable({ notes, className, testId }: { notes: string[]; className: string; testId?: string }) {
  return (
    <table className={className} data-testid={testId}>
      <tbody>
        {padNoteRows(notes, 7).map((note, index) => (
          <tr key={index}><td colSpan={3} style={noteRowFontSize(note)}>{note}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

function CountTable({ rows }: { rows: ScheduleCountRow[] }) {
  return (
    <table className="count-table">
      <tbody>
        {rows.length === 0 ? (
          <tr><td>予定なし</td><td>0</td></tr>
        ) : rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.count}<span className="print-only-hidden">({row.desired})</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// 連絡事項テキストエリア。非制御(defaultValue)+blur確定にすることで、キーストロークごとの
// classroomSettings 更新→全体再レンダーを避ける(メモリ規律)。payload 側の値が変わったときは
// key(値を含む)で再マウントして最新値を反映する(編集中は値が変わらないため影響しない)。
function NoteTextarea({ noteKey, value, onCommit }: { noteKey: string; value: string; onCommit?: (noteKey: string, value: string) => void }) {
  return (
    <textarea
      key={`${noteKey}:${value}`}
      className="box-textarea memo-input"
      defaultValue={value}
      readOnly={!onCommit}
      onBlur={(event) => {
        if (onCommit && event.target.value !== value) onCommit(noteKey, event.target.value)
      }}
    />
  )
}

function OptionTextInput({ noteKey, value, onCommit }: { noteKey: string; value: string; onCommit?: (noteKey: string, value: string) => void }) {
  return (
    <input
      key={`${noteKey}:${value}`}
      type="text"
      className="option-input memo-input"
      defaultValue={value}
      readOnly={!onCommit}
      onBlur={(event) => {
        if (onCommit && event.target.value !== value) onCommit(noteKey, event.target.value)
      }}
    />
  )
}

// 給与計算(講師)。コマ数(実績)は view model、単価は旧HTMLタブと同じ localStorage キー
// (schedule-salary:{scope}:teacher:salary-unit-{cat}-{teacherId})で共有・永続化する。
// 編集した単価は state、未編集の単価は localStorage を直接参照する(同期エフェクト不要)。
function SalarySection({ salary, buildStorageKey }: { salary: TeacherSalaryViewData; buildStorageKey: (unitKey: string) => string }) {
  const [units, setUnits] = useState<Record<string, string>>({})

  const readStoredUnit = (unitKey: string) => {
    try {
      return window.localStorage.getItem(buildStorageKey(unitKey)) ?? ''
    } catch {
      return ''
    }
  }

  const resolveUnit = (unitKey: string) => units[unitKey] ?? readStoredUnit(unitKey)

  const updateUnit = (unitKey: string, value: string) => {
    setUnits((prev) => ({ ...prev, [unitKey]: value }))
    try {
      window.localStorage.setItem(buildStorageKey(unitKey), value)
    } catch {
      // localStorage が使えない環境でも表示は継続する
    }
  }

  const unitValue = (unitKey: string) => Number.parseInt(resolveUnit(unitKey), 10) || 0
  const commuteKey = `salary-unit-commute-${salary.teacherId}`
  const officeKey = `salary-unit-office-${salary.teacherId}`
  const lessonSubtotals = salary.rows.map((row) => row.count * unitValue(`salary-unit-${row.cat}-${salary.teacherId}`))
  const commuteSubtotal = salary.attendanceDays * unitValue(commuteKey)
  const officeSubtotal = unitValue(officeKey)
  const grandTotal = lessonSubtotals.reduce((sum, value) => sum + value, 0) + commuteSubtotal + officeSubtotal

  return (
    <div className="box-stack salary-section">
      <div className="box-table-title">給与計算</div>
      <table className="salary-table" data-salary-teacher-id={salary.teacherId}>
        <colgroup>
          <col className="salary-col-label" />
          <col className="salary-col-count" />
          <col className="salary-col-unit" />
          <col className="salary-col-sub" />
        </colgroup>
        <thead>
          <tr><th></th><th>コマ数(実績)</th><th>単価</th><th>小計</th></tr>
        </thead>
        <tbody>
          {salary.rows.map((row, index) => {
            const unitKey = `salary-unit-${row.cat}-${salary.teacherId}`
            return (
              <tr key={row.cat}>
                <td className="salary-label">{row.label}</td>
                <td className="salary-count">{row.count}</td>
                <td><input className="salary-input" type="number" min={0} value={resolveUnit(unitKey)} onChange={(event) => updateUnit(unitKey, event.target.value)} /></td>
                <td className="salary-subtotal">{lessonSubtotals[index] ? lessonSubtotals[index].toLocaleString() : ''}</td>
              </tr>
            )
          })}
          <tr>
            <td className="salary-label">交通費</td>
            <td className="salary-count">{salary.attendanceDays}日</td>
            <td><input className="salary-input" type="number" min={0} value={resolveUnit(commuteKey)} onChange={(event) => updateUnit(commuteKey, event.target.value)} /></td>
            <td className="salary-subtotal">{commuteSubtotal ? commuteSubtotal.toLocaleString() : ''}</td>
          </tr>
          <tr>
            <td className="salary-label">事務給</td>
            <td className="salary-count salary-count-fixed">-</td>
            <td><input className="salary-input" type="number" min={0} value={resolveUnit(officeKey)} onChange={(event) => updateUnit(officeKey, event.target.value)} /></td>
            <td className="salary-subtotal">{officeSubtotal ? officeSubtotal.toLocaleString() : ''}</td>
          </tr>
          <tr className="salary-total-row">
            <td className="salary-label">合計</td>
            <td></td>
            <td></td>
            <td className="salary-grand-total">{grandTotal ? `${grandTotal.toLocaleString()} 円` : ''}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SheetHeader({ nameLabel, subLabel, periodLabel, pageIndex, qr }: {
  nameLabel: string
  subLabel: string
  periodLabel: string
  pageIndex: number
  qr: { svg: string; submitted: boolean }
}) {
  return (
    <div className="sheet-top">
      <div className="logo-box"><span className="logo-placeholder">ロゴ欄</span></div>
      <div className="school-box" />
      <div className="title-box"><span className="title-input">授業日程表</span></div>
      <div className="meta-box">
        {(qr.svg || qr.submitted) ? (
          <div className="meta-qr-block">
            {qr.svg ? <span className="qr-code" dangerouslySetInnerHTML={{ __html: qr.svg }} /> : null}
            {qr.submitted ? <span className="submission-badge print-only-hidden">希望<br />提出済</span> : null}
          </div>
        ) : null}
        <div className="meta-info">
          <div className="meta-row"><span className="meta-label">期間:</span> {periodLabel}</div>
          <div className="meta-row person-meta-row"><span><span className="meta-label">{nameLabel}:</span> {subLabel}</span></div>
          <div className="meta-row"><span className="page-count print-only-hidden">{pageIndex + 1}ページ目</span></div>
        </div>
      </div>
    </div>
  )
}

export type StudentScheduleSheetProps = {
  vm: StudentSheetViewModel
  onScheduleNoteChange?: (noteKey: string, value: string) => void
  // 日程表コマ組み(D&D)。未指定なら従来どおり表示のみ。
  dragActive?: boolean
  onCardPointerDown?: ScheduleCardPointerDownHandler
}

export function StudentScheduleSheet({ vm, onScheduleNoteChange, dragActive, onCardPointerDown }: StudentScheduleSheetProps) {
  bumpMemCounter('schedule-view-sheet-render')
  return (
    <section className="sheet" data-role="student-sheet" data-student-id={vm.student.id}>
      <SheetHeader nameLabel="生徒名" subLabel={vm.headerName} periodLabel={vm.periodLabel} pageIndex={vm.studentIndex} qr={vm.qr} />
      <table className={`schedule-table ${vm.densityClass}`}>
        <SheetTableHead vm={vm} />
        <tbody>
          {vm.groupRows.map((row) => <GroupClassRow key={row.band} row={row} />)}
          {vm.rows.map((row) => <StudentGridRow key={row.slotNumber} row={row} dragActive={dragActive} onCardPointerDown={onCardPointerDown} />)}
        </tbody>
      </table>
      <div className={`bottom-grid${vm.optionFieldEnabled ? ' bottom-grid-option' : ''}`}>
        <div className="box-stack">
          <div className="box-table-title">共通連絡事項(学年別)</div>
          <div className="box-panel"><NoteTextarea noteKey={vm.commonNoteKey} value={vm.commonNoteValue} onCommit={onScheduleNoteChange} /></div>
        </div>
        <div className="box-stack">
          <div className="box-table-title">個別連絡事項</div>
          <div className="box-panel"><NoteTextarea noteKey={vm.individualNoteKey} value={vm.individualNoteValue} onCommit={onScheduleNoteChange} /></div>
        </div>
        {!vm.optionFieldEnabled ? (
          <div className="box-stack">
            <div className="box-table-title">休み</div>
            <NoteRowsTable notes={vm.absenceNotes} className="absence-table" testId={`student-schedule-absence-table-${vm.student.id}`} />
          </div>
        ) : null}
        <div className="box-stack">
          <div className="box-table-title">振替授業</div>
          <NoteRowsTable notes={vm.makeupNotes} className="makeup-table" />
        </div>
        {vm.optionFieldEnabled ? (
          <div className="box-stack">
            <div className="box-table-title">オプション</div>
            <table className="option-table">
              <colgroup><col className="option-col-label" /><col className="option-col-check" /></colgroup>
              <tbody>
                {vm.optionRows.map((row) => (
                  <tr key={row.noteKey}>
                    <td><OptionTextInput noteKey={row.noteKey} value={row.value} onCommit={onScheduleNoteChange} /></td>
                    <td className="option-check-cell">{row.checked ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="count-stack">
          <div className="count-stack-block">
            <div>
              <div className="box-table-title">通常回数<span className="print-only-hidden">(希望数)</span></div>
              <CountTable rows={vm.regularCountRows} />
            </div>
            {vm.regularCountMismatch ? <div className="count-warning-stamp print-only-hidden" data-testid="student-schedule-regular-count-warning">希望数と予定数が一致していません！</div> : null}
          </div>
          <div className="count-stack-block">
            <div>
              <div className="box-table-title">講習回数<span className="print-only-hidden">(希望数)</span></div>
              <CountTable rows={vm.lectureCountRows} />
            </div>
            {vm.lectureCountMismatch ? <div className="count-warning-stamp print-only-hidden" data-testid="student-schedule-lecture-count-warning">希望数と予定数が一致していません！</div> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export type TeacherScheduleSheetProps = {
  vm: TeacherSheetViewModel
  buildSalaryStorageKey: (unitKey: string) => string
}

export function TeacherScheduleSheet({ vm, buildSalaryStorageKey }: TeacherScheduleSheetProps) {
  bumpMemCounter('schedule-view-sheet-render')
  return (
    <section className="sheet" data-role="teacher-sheet" data-teacher-id={vm.teacher.id}>
      <SheetHeader nameLabel="講師名" subLabel={vm.headerName} periodLabel={vm.periodLabel} pageIndex={vm.teacherIndex} qr={vm.qr} />
      <table className={`schedule-table ${vm.densityClass}`}>
        <SheetTableHead vm={vm} />
        <tbody>
          {vm.groupRows.map((row) => <GroupClassRow key={row.band} row={row} />)}
          {vm.rows.map((row) => <TeacherGridRow key={row.slotNumber} row={row} />)}
        </tbody>
      </table>
      <div className="bottom-grid bottom-grid-teacher">
        <SalarySection salary={vm.salary} buildStorageKey={buildSalaryStorageKey} />
        <div className="box-stack">
          <div className="box-table-title">振替授業</div>
          <NoteRowsTable notes={vm.makeupNotes} className="makeup-table" />
        </div>
        <div className="count-stack">
          <div className="count-stack-block">
            <div>
              <div className="box-table-title">通常回数<span className="print-only-hidden">(希望数)</span></div>
              <CountTable rows={vm.regularCountRows} />
            </div>
          </div>
          <div className="count-stack-block">
            <div>
              <div className="box-table-title">講習回数<span className="print-only-hidden">(希望数)</span></div>
              <CountTable rows={vm.lectureCountRows} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
