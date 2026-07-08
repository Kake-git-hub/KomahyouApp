// 対話用日程表 React ビュー本体(spec-schedule-interactive-view)。
// 盤面 state から親(ScheduleBoardScreen)が組んだ SchedulePayload を受け取り、
// scheduleViewData の純関数で view model を算出して描画する。同一 React ツリーのため
// 盤面編集は自動反映(リアルタイム同期は「同じ state で再レンダー」で成立)。
// 期間・人選択の絞り込みは即時適用(旧「最新表示」ボタンは不要になった)。
import { useMemo, useState } from 'react'
import { bumpMemCounter } from '../../utils/memoryDiagnostics'
import { buildSubmissionQrSvg } from '../../utils/scheduleHtml'
import type { SchedulePayload, SerializedStudent, SerializedTeacher } from '../../utils/scheduleHtml'
import {
  buildPeriodOptions,
  buildStudentSheetViewModel,
  buildTeacherSheetViewModel,
  filterPeopleByQuery,
  formatStudentHeaderName,
  formatTeacherHeaderName,
  getVisibleStudents,
  getVisibleTeachers,
  resolveDefaultPersonId,
} from '../../utils/scheduleViewData'
import type { ScheduleViewType } from '../../utils/scheduleViewData'
import { StudentScheduleSheet, TeacherScheduleSheet } from './ScheduleSheet'

export type ScheduleViewRange = {
  startDate: string
  endDate: string
  periodValue: string
  personId?: string
}

export type ScheduleViewProps = {
  viewType: ScheduleViewType
  payload: SchedulePayload
  range: ScheduleViewRange
  onRangeChange: (range: ScheduleViewRange) => void
  onScheduleNoteChange?: (noteKey: string, value: string) => void
  onOpenPrintAll?: () => void
  classroomStorageKey?: string
}

function normalizeRangeDates(startDate: string, endDate: string) {
  if (startDate && endDate && startDate > endDate) return { startDate: endDate, endDate: startDate }
  return { startDate, endDate }
}

export function ScheduleView({ viewType, payload, range, onRangeChange, onScheduleNoteChange, onOpenPrintAll, classroomStorageKey }: ScheduleViewProps) {
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
      <main className="pages schedule-view-pages">
        {viewType === 'student' ? (
          vm.student ? (
            <StudentScheduleSheet vm={vm.student} onScheduleNoteChange={onScheduleNoteChange} />
          ) : (
            <div className="empty-state">表示できる生徒が見つかりません。</div>
          )
        ) : vm.teacher ? (
          <TeacherScheduleSheet vm={vm.teacher} buildSalaryStorageKey={buildSalaryStorageKey} />
        ) : (
          <div className="empty-state">表示できる講師が見つかりません。</div>
        )}
      </main>
    </div>
  )
}
