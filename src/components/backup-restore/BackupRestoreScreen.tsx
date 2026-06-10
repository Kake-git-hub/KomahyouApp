import { useRef, useState } from 'react'
import { compareStudentsByCurrentGradeThenName, formatStudentSelectionLabel, isActiveOnDate } from '../basic-data/basicDataModel'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import { AppMenu } from '../navigation/AppMenu'
import type { ClassroomSettings, InitialSetupMakeupStockRow, InitialSetupLectureStockRow } from '../../types/appState'
import type { SubjectLabel } from '../schedule-board/types'
import { allStudentSubjectOptions } from '../../utils/studentGradeSubject'

// spec-save-restore §4: 教室画面の復元は「JSONバックアップを読み込む」一本。
// rollback／サーバーバックアップ／ローカル自動バックアップの復元UIは削除済み（サーバー復元は開発者画面のみ）。
type BackupRestoreScreenProps = {
  onBackToBoard: () => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
  onLogout: () => void
  persistenceMessage: string
  lastSavedAt: string
  onExportBackup: () => void
  onImportBackup: (file: File) => void
  classroomSettings: ClassroomSettings
  students: StudentRow[]
  specialSessions: SpecialSessionRow[]
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  onCompleteInitialSetup: () => void
  onExportBasicDataTemplate: () => void
  onExportBasicDataCurrent: () => void
  onImportInitialBasicDataWorkbook: (file: File) => void
  onImportDiffBasicDataWorkbook: (file: File) => void
  onExportSpecialDataTemplate: () => void
  onExportSpecialDataCurrent: () => void
  onImportSpecialDataWorkbook: (file: File) => void
  onExportAutoAssignTemplate: () => void
  onExportAutoAssignCurrent: () => void
  onImportAutoAssignWorkbook: (file: File) => void
  undoSnapshotLabel?: string | null
  onRestoreUndoSnapshot?: () => void
  onDismissUndoSnapshot?: () => void
  isDevelopmentClassroom?: boolean
  developmentClassroomCopySources?: Array<{ id: string; name: string }>
  onCopyClassroomDataToDevelopmentClassroom?: (sourceClassroomId: string) => void
}

const dayOptions = [
  { value: 0, label: '日曜' },
  { value: 1, label: '月曜' },
  { value: 2, label: '火曜' },
  { value: 3, label: '水曜' },
  { value: 4, label: '木曜' },
  { value: 5, label: '金曜' },
  { value: 6, label: '土曜' },
]

function formatSavedAt(savedAt: string) {
  if (!savedAt) return 'まだ保存されていません。'

  const parsed = new Date(savedAt)
  if (Number.isNaN(parsed.getTime())) return savedAt
  return parsed.toLocaleString('ja-JP')
}

function formatSetupStatus(done: boolean) {
  return done ? '設定済み' : '未設定'
}

export function BackupRestoreScreen({ onBackToBoard, onOpenBasicData, onOpenSpecialData, onOpenAutoAssignRules, onLogout, persistenceMessage, lastSavedAt, onExportBackup, onImportBackup, classroomSettings, students, specialSessions, onUpdateClassroomSettings, onCompleteInitialSetup, onExportBasicDataTemplate, onExportBasicDataCurrent, onImportInitialBasicDataWorkbook, onImportDiffBasicDataWorkbook, onExportSpecialDataTemplate, onExportSpecialDataCurrent, onImportSpecialDataWorkbook, onExportAutoAssignTemplate, onExportAutoAssignCurrent, onImportAutoAssignWorkbook, undoSnapshotLabel, onRestoreUndoSnapshot, onDismissUndoSnapshot, isDevelopmentClassroom = false, developmentClassroomCopySources = [], onCopyClassroomDataToDevelopmentClassroom }: BackupRestoreScreenProps) {
  const backupImportRef = useRef<HTMLInputElement | null>(null)
  const basicInitialImportRef = useRef<HTMLInputElement | null>(null)
  const basicDiffImportRef = useRef<HTMLInputElement | null>(null)
  const specialImportRef = useRef<HTMLInputElement | null>(null)
  const autoAssignImportRef = useRef<HTMLInputElement | null>(null)

  const [makeupDraftStudentId, setMakeupDraftStudentId] = useState('')
  const [makeupDraftSubject, setMakeupDraftSubject] = useState(allStudentSubjectOptions[0])
  const [makeupDraftCount, setMakeupDraftCount] = useState(1)
  const [makeupDraftOriginDate, setMakeupDraftOriginDate] = useState('')
  const [makeupDraftOriginSlot, setMakeupDraftOriginSlot] = useState(0)
  const [lectureDraftStudentId, setLectureDraftStudentId] = useState('')
  const [lectureDraftSubject, setLectureDraftSubject] = useState(allStudentSubjectOptions[0])
  const [lectureDraftSessionId, setLectureDraftSessionId] = useState('')
  const [lectureDraftCount, setLectureDraftCount] = useState(1)

  const [developmentCopyClassroomId, setDevelopmentCopyClassroomId] = useState('')

  const makeupStockRows = classroomSettings.initialSetupMakeupStocks ?? []
  const lectureStockRows = classroomSettings.initialSetupLectureStocks ?? []

  const referenceDate = new Date().toISOString().slice(0, 10)
  const activeStudents = students.filter((s) => isActiveOnDate(s.entryDate, s.withdrawDate, s.birthDate, referenceDate)).sort((a, b) => compareStudentsByCurrentGradeThenName(a, b))
  const selectedDevelopmentCopyClassroomId = developmentClassroomCopySources.some((classroom) => classroom.id === developmentCopyClassroomId)
    ? developmentCopyClassroomId
    : (developmentClassroomCopySources[0]?.id ?? '')

  const addMakeupStockRow = () => {
    if (!makeupDraftStudentId || makeupDraftCount < 1) return
    const newRow: InitialSetupMakeupStockRow = {
      id: `ms_${Date.now().toString(36)}`,
      studentId: makeupDraftStudentId,
      subject: makeupDraftSubject,
      count: makeupDraftCount,
      originDateKey: makeupDraftOriginDate || undefined,
      originSlotNumber: makeupDraftOriginSlot > 0 ? makeupDraftOriginSlot : undefined,
    }
    onUpdateClassroomSettings({ ...classroomSettings, initialSetupMakeupStocks: [...makeupStockRows, newRow] })
    setMakeupDraftCount(1)
    setMakeupDraftOriginDate('')
    setMakeupDraftOriginSlot(0)
  }

  const removeMakeupStockRow = (id: string) => {
    onUpdateClassroomSettings({ ...classroomSettings, initialSetupMakeupStocks: makeupStockRows.filter((r) => r.id !== id) })
  }

  const addLectureStockRow = () => {
    if (!lectureDraftStudentId || !lectureDraftSessionId || lectureDraftCount < 1) return
    const newRow: InitialSetupLectureStockRow = { id: `ls_${Date.now().toString(36)}`, studentId: lectureDraftStudentId, subject: lectureDraftSubject, sessionId: lectureDraftSessionId, count: lectureDraftCount }
    onUpdateClassroomSettings({ ...classroomSettings, initialSetupLectureStocks: [...lectureStockRows, newRow] })
    setLectureDraftCount(1)
  }

  const removeLectureStockRow = (id: string) => {
    onUpdateClassroomSettings({ ...classroomSettings, initialSetupLectureStocks: lectureStockRows.filter((r) => r.id !== id) })
  }

  const resolveStudentName = (studentId: string) => {
    const student = students.find((s) => s.id === studentId)
    return student ? formatStudentSelectionLabel(student) : studentId
  }

  const resolveSessionName = (sessionId: string) => {
    const session = specialSessions.find((s) => s.id === sessionId)
    return session ? session.label : sessionId
  }

  const updateSetupField = <K extends keyof ClassroomSettings>(key: K, value: ClassroomSettings[K]) => {
    onUpdateClassroomSettings({ ...classroomSettings, [key]: value })
  }

  return (
    <div className="page-shell page-shell-basic-data">
      <input ref={backupImportRef} className="basic-data-hidden-input" type="file" accept="application/json" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImportBackup(file)
        event.currentTarget.value = ''
      }} />
      <input ref={basicInitialImportRef} className="basic-data-hidden-input" type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImportInitialBasicDataWorkbook(file)
        event.currentTarget.value = ''
      }} />
      <input ref={basicDiffImportRef} className="basic-data-hidden-input" type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImportDiffBasicDataWorkbook(file)
        event.currentTarget.value = ''
      }} />
      <input ref={specialImportRef} className="basic-data-hidden-input" type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImportSpecialDataWorkbook(file)
        event.currentTarget.value = ''
      }} />
      <input ref={autoAssignImportRef} className="basic-data-hidden-input" type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImportAutoAssignWorkbook(file)
        event.currentTarget.value = ''
      }} />

      <section className="toolbar-panel" aria-label="バックアップと初期設定の操作バー">
        <div className="toolbar-row toolbar-row-primary">
          <div className="toolbar-group toolbar-group-compact">
            <AppMenu
              currentScreen="backup-restore"
              onNavigate={(screen) => {
                if (screen === 'board') onBackToBoard()
                if (screen === 'basic-data') onOpenBasicData()
                if (screen === 'special-data') onOpenSpecialData()
                if (screen === 'auto-assign-rules') onOpenAutoAssignRules()
              }}
              buttonTestId="backup-restore-menu-button"
              boardItemTestId="backup-restore-open-board-button"
              basicDataItemTestId="backup-restore-open-basic-data-button"
              specialDataItemTestId="backup-restore-open-special-data-button"
              autoAssignRulesItemTestId="backup-restore-open-auto-assign-rules-button"
              footerActionLabel="ログアウト"
              onFooterActionClick={onLogout}
              footerActionTestId="backup-restore-menu-logout-button"
            />
          </div>
        </div>
        <div className="toolbar-row toolbar-row-secondary">
          <div className="toolbar-status" data-testid="backup-restore-status">{persistenceMessage}</div>
        </div>
        {undoSnapshotLabel && (
          <div className="toolbar-row toolbar-undo-banner">
            <span>「{undoSnapshotLabel}」を実行しました。</span>
            <button className="secondary-button slim" type="button" onClick={onRestoreUndoSnapshot} data-testid="restore-undo-snapshot-button">直前の状態に戻す</button>
            <button className="icon-action-button toolbar-undo-dismiss" type="button" onClick={onDismissUndoSnapshot} data-testid="dismiss-undo-snapshot-button" aria-label="閉じる" title="閉じる">✕</button>
          </div>
        )}
      </section>

      <main className="page-main page-main-board-only">
        <section className="board-panel board-panel-unified special-session-panel" data-testid="backup-restore-screen">
          <div className="basic-data-header">
            <div>
              <p className="panel-kicker">バックアップ/復元/初期設定</p>
              <h2>データ保全と運用開始準備</h2>
              <p className="page-summary">バックアップと復元に加えて、初期設定フローと運用中の Excel 管理ツールを分けて配置しています。開始準備と日々の更新を混同しないための画面です。</p>
            </div>
          </div>

          <div className="backup-restore-grid">
            <section className="basic-data-section-card">
              <div className="basic-data-card-head">
                <h3>手動バックアップ</h3>
                <p>現在の画面状態と各種データを JSON で書き出します。</p>
              </div>
              <div className="basic-data-form-grid">
                <div className="toolbar-status">最終自動保存: {formatSavedAt(lastSavedAt)}</div>
                <button className="primary-button" type="button" onClick={onExportBackup} data-testid="backup-restore-export-button">バックアップを書き出す</button>
              </div>
            </section>
            <section className="basic-data-section-card">
              <div className="basic-data-card-head">
                <h3>復元</h3>
                <p>書き出した JSON を読み込み、現在の状態へ復元します。</p>
              </div>
              <div className="basic-data-form-grid">
                <button className="secondary-button slim" type="button" onClick={() => backupImportRef.current?.click()} data-testid="backup-restore-import-button">バックアップを読み込む</button>
              </div>
            </section>
            {isDevelopmentClassroom ? (
              <section className="basic-data-section-card" data-testid="backup-restore-development-copy-panel">
                <div className="basic-data-card-head">
                  <h3>他教室の現状データを再現</h3>
                  <p>選んだ教室の現在データを開発用教室へ丸ごとコピーします。共有用トークンは開発用教室向けに自動で外します。</p>
                </div>
                <div className="basic-data-form-grid">
                  <label className="basic-data-inline-field">
                    <span>コピー元教室</span>
                    <select value={selectedDevelopmentCopyClassroomId} onChange={(event) => setDevelopmentCopyClassroomId(event.target.value)} data-testid="backup-restore-development-copy-select">
                      {developmentClassroomCopySources.length > 0 ? developmentClassroomCopySources.map((classroom) => (
                        <option key={classroom.id} value={classroom.id}>{classroom.name}</option>
                      )) : <option value="">コピー可能な教室がありません</option>}
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => onCopyClassroomDataToDevelopmentClassroom?.(selectedDevelopmentCopyClassroomId)}
                    disabled={!selectedDevelopmentCopyClassroomId}
                    data-testid="backup-restore-development-copy-button"
                  >
                    現在データを開発用教室へコピー
                  </button>
                </div>
              </section>
            ) : null}
          </div>

          <section className="basic-data-section-card" data-testid="initial-setup-panel">
            <div className="basic-data-card-head">
              <h3>初期設定フロー</h3>
                <p>運用開始前に、管理データの初期取り込みと教室設定をここで完了します。</p>
            </div>

            <div className="auto-assign-priority-grid">
              <div className="auto-assign-priority-step">
                <strong>1. 管理データ Excel 初期取り込み</strong>
                <span>{formatSetupStatus(true)}</span>
                <span className="basic-data-subcopy">運用開始前に使う全体取り込みです。管理データを読み直し、コマ表作成の元データを確定します。</span>
                <div className="basic-data-row-actions">
                  <button className="secondary-button slim" type="button" onClick={onExportBasicDataTemplate} data-testid="setup-basic-export-template">テンプレート出力</button>
                  <button className="secondary-button slim" type="button" onClick={onExportBasicDataCurrent} data-testid="setup-basic-export-current">現データ出力</button>
                  <button className="primary-button" type="button" onClick={() => basicInitialImportRef.current?.click()} data-testid="setup-basic-import-initial">初期取り込み</button>
                </div>
              </div>

              <div className="auto-assign-priority-step">
                <strong>2. 教室運用確認</strong>
                <span>{formatSetupStatus(classroomSettings.deskCount > 0)}</span>
                <span className="basic-data-subcopy">机数、休校曜日を確認して、盤面作成の基準を整えます。</span>
                <label className="basic-data-inline-field basic-data-inline-field-short">
                  <span>机数</span>
                  <input type="number" min="1" max="30" value={classroomSettings.deskCount} onChange={(event) => updateSetupField('deskCount', Math.max(1, Number(event.target.value) || 1))} data-testid="setup-desk-count" />
                </label>
                <div className="basic-data-chip-row">
                  {dayOptions.map((day) => {
                    const isActive = classroomSettings.closedWeekdays.includes(day.value)
                    return (
                      <button
                        key={day.value}
                        type="button"
                        className={`basic-data-chip${isActive ? ' active' : ''}`}
                        onClick={() => updateSetupField('closedWeekdays', isActive ? classroomSettings.closedWeekdays.filter((value) => value !== day.value) : [...classroomSettings.closedWeekdays, day.value].sort((left, right) => left - right))}
                        data-testid={`setup-closed-day-${day.value}`}
                      >
                        {day.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="auto-assign-priority-step">
                <strong>3. 開始時点の未消化ストック</strong>
                <span>{formatSetupStatus(makeupStockRows.length > 0 || lectureStockRows.length > 0)}</span>
                <span className="basic-data-subcopy">運用開始時点で残っている未消化振替・未消化講習の件数を生徒ごとに登録します。</span>

                <div style={{ marginTop: 8 }}>
                  <strong style={{ fontSize: '0.85em' }}>未消化振替（{makeupStockRows.reduce((sum, r) => sum + r.count, 0)} コマ）</strong>
                  {makeupStockRows.length > 0 && (
                    <table className="basic-data-compact-table" style={{ marginTop: 4 }}>
                      <thead><tr><th>生徒</th><th>科目</th><th>件数</th><th>振替元日付</th><th>時限</th><th></th></tr></thead>
                      <tbody>
                        {makeupStockRows.map((row) => (
                          <tr key={row.id}>
                            <td>{resolveStudentName(row.studentId)}</td>
                            <td>{row.subject}</td>
                            <td>{row.count}</td>
                            <td>{row.originDateKey || '-'}</td>
                            <td>{row.originSlotNumber ? `${row.originSlotNumber}限` : '-'}</td>
                            <td><button type="button" className="menu-link-button danger" onClick={() => removeMakeupStockRow(row.id)} data-testid={`setup-makeup-remove-${row.id}`}>削除</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="basic-data-row-actions" style={{ marginTop: 4, gap: 4, flexWrap: 'wrap' }}>
                    <select value={makeupDraftStudentId} onChange={(e) => setMakeupDraftStudentId(e.target.value)} data-testid="setup-makeup-student">
                      <option value="">生徒を選択</option>
                      {activeStudents.map((s) => <option key={s.id} value={s.id}>{formatStudentSelectionLabel(s)}</option>)}
                    </select>
                    <select value={makeupDraftSubject} onChange={(e) => setMakeupDraftSubject(e.target.value as SubjectLabel)} data-testid="setup-makeup-subject">
                      {allStudentSubjectOptions.map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                    </select>
                    <input type="number" min="1" max="99" value={makeupDraftCount} onChange={(e) => setMakeupDraftCount(Math.max(1, Number(e.target.value) || 1))} style={{ width: 48 }} data-testid="setup-makeup-count" />
                    <input type="date" value={makeupDraftOriginDate} onChange={(e) => setMakeupDraftOriginDate(e.target.value)} style={{ width: 140 }} data-testid="setup-makeup-origin-date" title="振替元日付（任意）" />
                    <select value={makeupDraftOriginSlot} onChange={(e) => setMakeupDraftOriginSlot(Number(e.target.value))} style={{ width: 64 }} data-testid="setup-makeup-origin-slot" title="振替元時限（任意）">
                      <option value="0">時限</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}限</option>)}
                    </select>
                    <button type="button" className="secondary-button slim" onClick={addMakeupStockRow} data-testid="setup-makeup-add">追加</button>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <strong style={{ fontSize: '0.85em' }}>未消化講習（{lectureStockRows.reduce((sum, r) => sum + r.count, 0)} コマ）</strong>
                  {lectureStockRows.length > 0 && (
                    <table className="basic-data-compact-table" style={{ marginTop: 4 }}>
                      <thead><tr><th>生徒</th><th>科目</th><th>講習</th><th>件数</th><th></th></tr></thead>
                      <tbody>
                        {lectureStockRows.map((row) => (
                          <tr key={row.id}>
                            <td>{resolveStudentName(row.studentId)}</td>
                            <td>{row.subject}</td>
                            <td>{resolveSessionName(row.sessionId)}</td>
                            <td>{row.count}</td>
                            <td><button type="button" className="menu-link-button danger" onClick={() => removeLectureStockRow(row.id)} data-testid={`setup-lecture-remove-${row.id}`}>削除</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="basic-data-row-actions" style={{ marginTop: 4, gap: 4, flexWrap: 'wrap' }}>
                    <select value={lectureDraftStudentId} onChange={(e) => setLectureDraftStudentId(e.target.value)} data-testid="setup-lecture-student">
                      <option value="">生徒を選択</option>
                      {activeStudents.map((s) => <option key={s.id} value={s.id}>{formatStudentSelectionLabel(s)}</option>)}
                    </select>
                    <select value={lectureDraftSubject} onChange={(e) => setLectureDraftSubject(e.target.value as SubjectLabel)} data-testid="setup-lecture-subject">
                      {allStudentSubjectOptions.map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                    </select>
                    <select value={lectureDraftSessionId} onChange={(e) => setLectureDraftSessionId(e.target.value)} data-testid="setup-lecture-session">
                      <option value="">講習を選択</option>
                      {specialSessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    <input type="number" min="1" max="99" value={lectureDraftCount} onChange={(e) => setLectureDraftCount(Math.max(1, Number(e.target.value) || 1))} style={{ width: 48 }} data-testid="setup-lecture-count" />
                    <button type="button" className="secondary-button slim" onClick={addLectureStockRow} data-testid="setup-lecture-add">追加</button>
                  </div>
                </div>
              </div>

            </div>
            <div className="basic-data-actions-row">
              <button className="primary-button" type="button" onClick={onCompleteInitialSetup} data-testid="setup-complete-button">初期設定を完了してコマ表をリセットする</button>
            </div>
          </section>

          <section className="basic-data-section-card" data-testid="ongoing-excel-tools-panel" style={{ display: 'none' }}>
            <div className="basic-data-card-head">
              <h3>運用中の Excel 管理と追加ツール</h3>
              <p>初期設定後の更新で使う管理データ差分取り込みと、関連 Excel ツールをここにまとめています。</p>
            </div>

            <div className="auto-assign-priority-grid">
              <div className="auto-assign-priority-step">
                <strong>1. 管理データ Excel 差分取り込み</strong>
                <span>{formatSetupStatus(true)}</span>
                <span className="basic-data-subcopy">現データ出力の ID 列を残したまま再取込すると、特別講習・ルール・盤面・ストックを保持したまま差分更新できます。</span>
                <div className="basic-data-row-actions">
                  <button className="secondary-button slim" type="button" onClick={onExportBasicDataCurrent} data-testid="setup-basic-export-current">現データ出力</button>
                  <button className="primary-button" type="button" onClick={() => basicDiffImportRef.current?.click()} data-testid="setup-basic-import">差分取り込み</button>
                </div>
              </div>
            </div>

            <section className="basic-data-editor-block basic-data-inline-stack">
              <div className="basic-data-card-head">
                <h3>追加ツール</h3>
                <p>特別講習データと自動割振ルールの Excel 管理もこの画面へ集約しています。</p>
              </div>
              <div className="backup-restore-grid">
                <section className="basic-data-inline-stack">
                  <strong>特別講習データ Excel</strong>
                  <div className="basic-data-row-actions">
                    <button className="secondary-button slim" type="button" onClick={onExportSpecialDataTemplate} data-testid="setup-special-export-template">テンプレート出力</button>
                    <button className="secondary-button slim" type="button" onClick={onExportSpecialDataCurrent} data-testid="setup-special-export-current">現データ出力</button>
                    <button className="primary-button" type="button" onClick={() => specialImportRef.current?.click()} data-testid="setup-special-import">Excel 取り込み</button>
                  </div>
                </section>
                <section className="basic-data-inline-stack">
                  <strong>自動割振ルール Excel</strong>
                  <div className="basic-data-row-actions">
                    <button className="secondary-button slim" type="button" onClick={onExportAutoAssignTemplate} data-testid="setup-auto-assign-export-template">テンプレート出力</button>
                    <button className="secondary-button slim" type="button" onClick={onExportAutoAssignCurrent} data-testid="setup-auto-assign-export-current">現データ出力</button>
                    <button className="primary-button" type="button" onClick={() => autoAssignImportRef.current?.click()} data-testid="setup-auto-assign-import">Excel 取り込み</button>
                  </div>
                </section>
              </div>
            </section>
          </section>
        </section>
      </main>

    </div>
  )
}
