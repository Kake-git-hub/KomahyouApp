import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClassroomSettings } from '../../types/appState'
import { getStudentDisplayName, getTeacherDisplayName, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import { allStudentSubjectOptions } from '../../utils/studentGradeSubject'
import {
  buildRegularLessonTemplateWorkbook,
  createRegularLessonTemplate,
  normalizeRegularLessonTemplate,
  parseRegularLessonTemplateWorkbook,
  regularTemplateDayOptions,
  regularTemplateSlotNumbers,
  type RegularLessonTemplate,
  type RegularLessonTemplateDesk,
} from './regularLessonTemplate'

type RegularLessonTemplateEditorProps = {
  open: boolean
  classroomSettings: ClassroomSettings
  teachers: TeacherRow[]
  students: StudentRow[]
  onClose: () => void
  onSave: (template: RegularLessonTemplate) => void
}

type SelectedDeskState = {
  dayOfWeek: number
  slotNumber: number
  deskIndex: number
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createDefaultSelectedDesk(): SelectedDeskState {
  return {
    dayOfWeek: regularTemplateDayOptions[0],
    slotNumber: regularTemplateSlotNumbers[0],
    deskIndex: 1,
  }
}

function buildCellKey(dayOfWeek: number, slotNumber: number) {
  return `${dayOfWeek}_${slotNumber}`
}

const dayLabelByValue: Record<number, string> = {
  0: '日',
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
}

export function RegularLessonTemplateEditor({ open, classroomSettings, teachers, students, onClose, onSave }: RegularLessonTemplateEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [draftTemplate, setDraftTemplate] = useState<RegularLessonTemplate>(() => normalizeRegularLessonTemplate(classroomSettings.regularLessonTemplate, classroomSettings.deskCount))
  const [selectedDesk, setSelectedDesk] = useState<SelectedDeskState>(createDefaultSelectedDesk)
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setDraftTemplate(normalizeRegularLessonTemplate(classroomSettings.regularLessonTemplate, classroomSettings.deskCount))
    setSelectedDesk(createDefaultSelectedDesk())
    setStatusMessage('')
  }, [classroomSettings.deskCount, classroomSettings.regularLessonTemplate, open])

  const normalizedTemplate = useMemo(
    () => normalizeRegularLessonTemplate(draftTemplate, classroomSettings.deskCount),
    [classroomSettings.deskCount, draftTemplate],
  )

  const cellByKey = useMemo(
    () => new Map(normalizedTemplate.cells.map((cell) => [buildCellKey(cell.dayOfWeek, cell.slotNumber), cell])),
    [normalizedTemplate.cells],
  )

  const selectedCell = cellByKey.get(buildCellKey(selectedDesk.dayOfWeek, selectedDesk.slotNumber)) ?? normalizedTemplate.cells[0]
  const selectedDeskDraft = selectedCell?.desks[selectedDesk.deskIndex - 1] ?? selectedCell?.desks[0] ?? null

  const teacherOptions = useMemo(
    () => teachers.slice().sort((left, right) => getTeacherDisplayName(left).localeCompare(getTeacherDisplayName(right), 'ja')),
    [teachers],
  )

  const studentOptions = useMemo(
    () => students.slice().sort((left, right) => getStudentDisplayName(left).localeCompare(getStudentDisplayName(right), 'ja')),
    [students],
  )

  const occupiedDeskCount = useMemo(
    () => normalizedTemplate.cells.reduce((total, cell) => total + cell.desks.filter((desk) => desk.teacherId || desk.students.some((student) => student?.studentId)).length, 0),
    [normalizedTemplate.cells],
  )

  if (!open) return null

  const updateDesk = (mutator: (desk: RegularLessonTemplateDesk) => RegularLessonTemplateDesk) => {
    setDraftTemplate((current) => {
      const next = normalizeRegularLessonTemplate(current, classroomSettings.deskCount)
      next.cells = next.cells.map((cell) => {
        if (cell.dayOfWeek !== selectedDesk.dayOfWeek || cell.slotNumber !== selectedDesk.slotNumber) return cell
        return {
          ...cell,
          desks: cell.desks.map((desk) => (desk.deskIndex === selectedDesk.deskIndex ? mutator(desk) : desk)),
        }
      })
      return {
        ...next,
        savedAt: new Date().toISOString(),
      }
    })
  }

  const handleSelectFirstEmptyDesk = (dayOfWeek: number, slotNumber: number) => {
    const cell = cellByKey.get(buildCellKey(dayOfWeek, slotNumber))
    const targetDesk = cell?.desks.find((desk) => !desk.teacherId && desk.students.every((student) => !student?.studentId)) ?? cell?.desks[0]
    if (!targetDesk) return
    setSelectedDesk({ dayOfWeek, slotNumber, deskIndex: targetDesk.deskIndex })
  }

  const handleExport = async () => {
    const xlsx = await import('xlsx')
    xlsx.writeFile(
      buildRegularLessonTemplateWorkbook(xlsx, {
        template: normalizedTemplate,
        teachers,
        students,
        deskCount: classroomSettings.deskCount,
      }),
      '通常授業テンプレート.xlsx',
    )
    setStatusMessage('通常授業テンプレートを Excel 出力しました。')
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(buffer, { type: 'array' })
      const importedTemplate = parseRegularLessonTemplateWorkbook(xlsx, workbook, {
        fallbackTemplate: normalizedTemplate,
        teachers,
        students,
        deskCount: classroomSettings.deskCount,
      })
      setDraftTemplate(importedTemplate)
      setSelectedDesk(createDefaultSelectedDesk())
      setStatusMessage('通常授業テンプレートを Excel から取り込みました。')
    } catch {
      setStatusMessage('通常授業テンプレートの Excel 取り込みに失敗しました。列名を確認してください。')
    }
  }

  const handleReset = () => {
    if (!window.confirm('通常授業テンプレートを空に戻します。よろしいですか。')) return
    setDraftTemplate(createRegularLessonTemplate(classroomSettings.deskCount, normalizedTemplate.effectiveStartDate || toDateKey(new Date())))
    setSelectedDesk(createDefaultSelectedDesk())
    setStatusMessage('通常授業テンプレートを空に戻しました。')
  }

  const handleSave = () => {
    onSave({
      ...normalizeRegularLessonTemplate(draftTemplate, classroomSettings.deskCount),
      savedAt: new Date().toISOString(),
    })
    onClose()
  }

  const renderDeskSummary = (desk: RegularLessonTemplateDesk) => {
    const teacherLabel = desk.teacherId ? getTeacherDisplayName(teachers.find((teacher) => teacher.id === desk.teacherId) ?? { ...teachers[0], id: '', name: '講師未設定', displayName: '講師未設定', email: '', entryDate: '', withdrawDate: '', isHidden: false, subjectCapabilities: [], memo: '' }) : '講師未設定'
    const studentLabels = desk.students
      .map((student) => {
        if (!student?.studentId) return null
        const managedStudent = students.find((entry) => entry.id === student.studentId)
        return `${getStudentDisplayName(managedStudent ?? { id: '', name: student.studentId, displayName: student.studentId, email: '', entryDate: '', withdrawDate: '', birthDate: '', isHidden: false })} ${student.subject}`
      })
      .filter(Boolean)

    return [teacherLabel, ...studentLabels].join(' / ')
  }

  return (
    <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="auto-assign-modal regular-template-modal" role="dialog" aria-modal="true" aria-label="通常授業テンプレート編集" data-testid="regular-template-editor">
        <div className="regular-template-modal-header">
          <div>
            <div className="auto-assign-modal-title">通常授業テンプレート</div>
            <div className="detail-note">保存すると開始日以降の通常授業に即時反映します。配置済みの盤面内容は上書きせず、そのまま優先します。</div>
          </div>
          <div className="regular-template-header-actions">
            <button className="secondary-button slim" type="button" onClick={handleImportClick}>Excel取込</button>
            <button className="secondary-button slim" type="button" onClick={() => void handleExport()}>Excel出力</button>
            <button className="secondary-button slim" type="button" onClick={handleReset}>空に戻す</button>
            <button className="secondary-button slim" type="button" onClick={onClose} data-testid="regular-template-close-button">閉じる</button>
            <button className="primary-button" type="button" onClick={handleSave} data-testid="regular-template-save-button">保存</button>
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(event) => { void handleImportFile(event) }} />

        <div className="regular-template-topbar">
          <label className="basic-data-inline-field basic-data-inline-field-short">
            <span>反映開始日</span>
            <input
                data-testid="regular-template-effective-start-date"
              type="date"
              value={normalizedTemplate.effectiveStartDate}
              onChange={(event) => setDraftTemplate((current) => ({
                ...normalizeRegularLessonTemplate(current, classroomSettings.deskCount),
                effectiveStartDate: event.target.value || toDateKey(new Date()),
              }))}
            />
          </label>
          <div className="selection-pill">使用中の机設定 {classroomSettings.deskCount} 台</div>
          <div className="selection-pill">設定済み {occupiedDeskCount} コマ</div>
          {statusMessage ? <div className="toolbar-status">{statusMessage}</div> : null}
        </div>

        <div className="regular-template-layout">
          <div className="regular-template-board">
            <table className="regular-template-table">
              <thead>
                <tr>
                  <th>時限</th>
                  {regularTemplateDayOptions.map((dayOfWeek) => <th key={dayOfWeek}>{dayLabelByValue[dayOfWeek]}</th>)}
                </tr>
              </thead>
              <tbody>
                {regularTemplateSlotNumbers.map((slotNumber) => (
                  <tr key={slotNumber}>
                    <th>{slotNumber}限</th>
                    {regularTemplateDayOptions.map((dayOfWeek) => {
                      const cell = cellByKey.get(buildCellKey(dayOfWeek, slotNumber))
                      const occupiedDesks = cell?.desks.filter((desk) => desk.teacherId || desk.students.some((student) => student?.studentId)) ?? []
                      return (
                        <td key={`${dayOfWeek}_${slotNumber}`}>
                          <div className="regular-template-cell">
                            {occupiedDesks.length === 0 ? <div className="regular-template-empty">未設定</div> : null}
                            {occupiedDesks.map((desk) => {
                              const isSelected = selectedDesk.dayOfWeek === dayOfWeek && selectedDesk.slotNumber === slotNumber && selectedDesk.deskIndex === desk.deskIndex
                              return (
                                <button
                                  key={desk.deskIndex}
                                  className={`regular-template-desk-chip${isSelected ? ' active' : ''}`}
                                  type="button"
                                  data-testid={`regular-template-desk-${dayOfWeek}-${slotNumber}-${desk.deskIndex}`}
                                  onClick={() => setSelectedDesk({ dayOfWeek, slotNumber, deskIndex: desk.deskIndex })}
                                >
                                  <strong>{desk.deskIndex}机</strong>
                                  <span>{renderDeskSummary(desk)}</span>
                                </button>
                              )
                            })}
                            <button className="secondary-button slim regular-template-add-button" type="button" data-testid={`regular-template-add-${dayOfWeek}-${slotNumber}`} onClick={() => handleSelectFirstEmptyDesk(dayOfWeek, slotNumber)}>机を設定</button>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="regular-template-editor-panel">
            <div className="basic-data-card-head">
              <h3>選択中のコマ</h3>
              <p>{dayLabelByValue[selectedDesk.dayOfWeek]}曜 {selectedDesk.slotNumber}限 / {selectedDesk.deskIndex}机</p>
            </div>
            {selectedDeskDraft ? (
              <div className="regular-template-editor-fields">
                <label className="basic-data-inline-field basic-data-inline-field-short">
                  <span>机</span>
                  <select
                    value={selectedDesk.deskIndex}
                    onChange={(event) => setSelectedDesk((current) => ({ ...current, deskIndex: Number(event.target.value) || 1 }))}
                  >
                    {Array.from({ length: classroomSettings.deskCount }, (_, index) => index + 1).map((deskIndex) => <option key={deskIndex} value={deskIndex}>{deskIndex}机</option>)}
                  </select>
                </label>
                <label className="basic-data-inline-field basic-data-inline-field-medium">
                  <span>講師</span>
                  <select
                    data-testid="regular-template-teacher-select"
                    value={selectedDeskDraft.teacherId}
                    onChange={(event) => updateDesk((desk) => ({ ...desk, teacherId: event.target.value }))}
                  >
                    <option value="">講師未設定</option>
                    {teacherOptions.map((teacher) => <option key={teacher.id} value={teacher.id}>{getTeacherDisplayName(teacher)}</option>)}
                  </select>
                </label>

                {[0, 1].map((studentIndex) => {
                  const draftStudent = selectedDeskDraft.students[studentIndex]
                  return (
                    <div key={studentIndex} className="regular-template-student-block">
                      <strong>生徒{studentIndex + 1}</strong>
                      <label className="basic-data-inline-field basic-data-inline-field-medium">
                        <span>生徒</span>
                        <select
                          data-testid={`regular-template-student-select-${studentIndex + 1}`}
                          value={draftStudent?.studentId ?? ''}
                          onChange={(event) => updateDesk((desk) => {
                            const nextStudents = [...desk.students] as RegularLessonTemplateDesk['students']
                            nextStudents[studentIndex] = event.target.value
                              ? {
                                  studentId: event.target.value,
                                  subject: draftStudent?.subject ?? allStudentSubjectOptions[0],
                                  note: draftStudent?.note ?? '',
                                }
                              : null
                            return { ...desk, students: nextStudents }
                          })}
                        >
                          <option value="">生徒なし</option>
                          {studentOptions.map((student) => <option key={student.id} value={student.id}>{getStudentDisplayName(student)}</option>)}
                        </select>
                      </label>
                      <label className="basic-data-inline-field basic-data-inline-field-short">
                        <span>科目</span>
                        <select
                          data-testid={`regular-template-subject-select-${studentIndex + 1}`}
                          value={draftStudent?.subject ?? allStudentSubjectOptions[0]}
                          disabled={!draftStudent?.studentId}
                          onChange={(event) => updateDesk((desk) => {
                            const nextStudents = [...desk.students] as RegularLessonTemplateDesk['students']
                            if (!nextStudents[studentIndex]) return desk
                            nextStudents[studentIndex] = {
                              ...nextStudents[studentIndex],
                              subject: event.target.value as typeof allStudentSubjectOptions[number],
                            }
                            return { ...desk, students: nextStudents }
                          })}
                        >
                          {allStudentSubjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                        </select>
                      </label>
                      <label className="basic-data-inline-field basic-data-inline-field-short">
                        <span>注記</span>
                        <input
                          data-testid={`regular-template-note-input-${studentIndex + 1}`}
                          value={draftStudent?.note ?? ''}
                          maxLength={4}
                          disabled={!draftStudent?.studentId}
                          onChange={(event) => updateDesk((desk) => {
                            const nextStudents = [...desk.students] as RegularLessonTemplateDesk['students']
                            if (!nextStudents[studentIndex]) return desk
                            nextStudents[studentIndex] = {
                              ...nextStudents[studentIndex],
                              note: event.target.value.slice(0, 4),
                            }
                            return { ...desk, students: nextStudents }
                          })}
                        />
                      </label>
                    </div>
                  )
                })}

                <div className="regular-template-editor-actions">
                  <button
                    className="secondary-button slim"
                    type="button"
                    data-testid="regular-template-clear-desk-button"
                    onClick={() => updateDesk((desk) => ({ ...desk, teacherId: '', students: [null, null] }))}
                  >
                    この机を削除
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  )
}