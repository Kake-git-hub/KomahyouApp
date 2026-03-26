import { useRef, useState } from 'react'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import { AppMenu } from '../navigation/AppMenu'
import type { ClassroomSettings, InitialSetupLectureStockRow, InitialSetupMakeupStockRow } from '../../types/appState'

type BackupRestoreScreenProps = {
  onBackToBoard: () => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
  persistenceMessage: string
  lastSavedAt: string
  onExportBackup: () => void
  onImportBackup: (file: File) => void
  classroomSettings: ClassroomSettings
  students: StudentRow[]
  specialSessions: SpecialSessionRow[]
  googleHolidaySyncState: {
    status: 'idle' | 'syncing' | 'success' | 'error' | 'disabled'
    message: string
  }
  isGoogleHolidayApiConfigured: boolean
  onUpdateClassroomSettings: (settings: ClassroomSettings) => void
  onSyncGoogleHolidays: () => void
  onCompleteInitialSetup: () => void
  onExportBasicDataTemplate: () => void
  onExportBasicDataCurrent: () => void
  onImportBasicDataWorkbook: (file: File) => void
  onExportSpecialDataTemplate: () => void
  onExportSpecialDataCurrent: () => void
  onImportSpecialDataWorkbook: (file: File) => void
  onExportAutoAssignTemplate: () => void
  onExportAutoAssignCurrent: () => void
  onImportAutoAssignWorkbook: (file: File) => void
}

const subjectOptions = ['英', '数', '算', '国', '理', '社']
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

function createDraftId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function BackupRestoreScreen({ onBackToBoard, onOpenBasicData, onOpenSpecialData, onOpenAutoAssignRules, persistenceMessage, lastSavedAt, onExportBackup, onImportBackup, classroomSettings, students, specialSessions, googleHolidaySyncState, isGoogleHolidayApiConfigured, onUpdateClassroomSettings, onSyncGoogleHolidays, onCompleteInitialSetup, onExportBasicDataTemplate, onExportBasicDataCurrent, onImportBasicDataWorkbook, onExportSpecialDataTemplate, onExportSpecialDataCurrent, onImportSpecialDataWorkbook, onExportAutoAssignTemplate, onExportAutoAssignCurrent, onImportAutoAssignWorkbook }: BackupRestoreScreenProps) {
  const backupImportRef = useRef<HTMLInputElement | null>(null)
  const basicImportRef = useRef<HTMLInputElement | null>(null)
  const specialImportRef = useRef<HTMLInputElement | null>(null)
  const autoAssignImportRef = useRef<HTMLInputElement | null>(null)
  const [makeupDraft, setMakeupDraft] = useState<Omit<InitialSetupMakeupStockRow, 'id'>>({
    studentId: students[0]?.id ?? '',
    subject: '英',
    count: 1,
  })
  const [lectureDraft, setLectureDraft] = useState<Omit<InitialSetupLectureStockRow, 'id'>>({
    studentId: students[0]?.id ?? '',
    subject: '英',
    sessionId: specialSessions[0]?.id ?? '',
    count: 1,
  })

  const initialSetupMakeupStocks = classroomSettings.initialSetupMakeupStocks ?? []
  const initialSetupLectureStocks = classroomSettings.initialSetupLectureStocks ?? []
  const studentNameById = new Map(students.map((student) => [student.id, student.displayName || student.name]))
  const sessionLabelById = new Map(specialSessions.map((session) => [session.id, session.label]))

  const updateSetupField = <K extends keyof ClassroomSettings>(key: K, value: ClassroomSettings[K]) => {
    onUpdateClassroomSettings({ ...classroomSettings, [key]: value })
  }

  const addInitialMakeupStock = () => {
    const count = Math.max(0, Math.trunc(Number(makeupDraft.count) || 0))
    if (!makeupDraft.studentId || !makeupDraft.subject || count <= 0) return
    updateSetupField('initialSetupMakeupStocks', [...initialSetupMakeupStocks, { id: createDraftId('setup_makeup'), ...makeupDraft, count }])
  }

  const addInitialLectureStock = () => {
    const count = Math.max(0, Math.trunc(Number(lectureDraft.count) || 0))
    if (!lectureDraft.studentId || !lectureDraft.subject || !lectureDraft.sessionId || count <= 0) return
    updateSetupField('initialSetupLectureStocks', [...initialSetupLectureStocks, { id: createDraftId('setup_lecture'), ...lectureDraft, count }])
  }

  return (
    <div className="page-shell page-shell-basic-data">
      <input ref={backupImportRef} className="basic-data-hidden-input" type="file" accept="application/json" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImportBackup(file)
        event.currentTarget.value = ''
      }} />
      <input ref={basicImportRef} className="basic-data-hidden-input" type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onImportBasicDataWorkbook(file)
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
            />
          </div>
        </div>
        <div className="toolbar-row toolbar-row-secondary">
          <div className="toolbar-status" data-testid="backup-restore-status">{persistenceMessage}</div>
        </div>
      </section>

      <main className="page-main page-main-board-only">
        <section className="board-panel board-panel-unified special-session-panel" data-testid="backup-restore-screen">
          <div className="basic-data-header">
            <div>
              <p className="panel-kicker">バックアップ/復元/初期設定</p>
              <h2>データ保全と運用開始準備</h2>
              <p className="page-summary">バックアップと復元に加えて、運用開始時に必要な Excel 取り込み、開始時点ストック、教室設定確認をここへ集約します。</p>
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
          </div>

          <section className="basic-data-section-card" data-testid="initial-setup-panel">
            <div className="basic-data-card-head">
              <h3>初期設定ナビ</h3>
              <p>基本データ Excel は必須です。取り込み時に既存データがある場合は、盤面や各設定を含めてすべて削除してから入れ直します。特別講習データと自動割振ルールの Excel は、この画面に集約しましたが必要なときだけ実行できます。</p>
            </div>

            <div className="auto-assign-priority-grid">
              <div className="auto-assign-priority-step">
                <strong>1. 基本データ Excel</strong>
                <span>{formatSetupStatus(false)}</span>
                <span className="basic-data-subcopy">取り込みを確定すると、現在の既存データはすべて消えます。</span>
                <div className="basic-data-row-actions">
                  <button className="secondary-button slim" type="button" onClick={onExportBasicDataTemplate} data-testid="setup-basic-export-template">テンプレート出力</button>
                  <button className="secondary-button slim" type="button" onClick={onExportBasicDataCurrent} data-testid="setup-basic-export-current">現データ出力</button>
                  <button className="primary-button" type="button" onClick={() => basicImportRef.current?.click()} data-testid="setup-basic-import">Excel 取り込み</button>
                </div>
              </div>

              <div className="auto-assign-priority-step">
                <strong>2. 教室運用確認</strong>
                <span>{formatSetupStatus(classroomSettings.deskCount > 0)}</span>
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
                <div className="basic-data-form-grid">
                  <span className="basic-data-subcopy">公開祝日同期: {googleHolidaySyncState.message}</span>
                  <button className="secondary-button slim" type="button" onClick={onSyncGoogleHolidays} disabled={!isGoogleHolidayApiConfigured || googleHolidaySyncState.status === 'syncing'} data-testid="setup-google-holiday-sync">今すぐ同期</button>
                </div>
              </div>
            </div>

            <div className="backup-restore-grid">
              <section className="basic-data-editor-block basic-data-inline-stack" data-testid="setup-initial-makeup-stock">
                <div className="basic-data-card-head">
                  <h3>開始時点の振替ストック</h3>
                  <p>開始時点で持ち越している通常残を登録します。</p>
                </div>
                <div className="basic-data-form-row wrap align-center">
                  <select value={makeupDraft.studentId} onChange={(event) => setMakeupDraft((current) => ({ ...current, studentId: event.target.value }))}>
                    <option value="">生徒を選択</option>
                    {students.map((student) => <option key={student.id} value={student.id}>{student.displayName || student.name}</option>)}
                  </select>
                  <select value={makeupDraft.subject} onChange={(event) => setMakeupDraft((current) => ({ ...current, subject: event.target.value }))}>
                    {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                  </select>
                  <input type="number" min="1" value={makeupDraft.count} onChange={(event) => setMakeupDraft((current) => ({ ...current, count: Math.max(1, Number(event.target.value) || 1) }))} />
                  <button className="primary-button" type="button" onClick={addInitialMakeupStock} data-testid="setup-add-makeup-stock">追加</button>
                </div>
                <div className="auto-assign-pair-list">
                  {initialSetupMakeupStocks.length === 0 ? <span className="basic-data-muted-inline">未登録</span> : null}
                  {initialSetupMakeupStocks.map((row) => (
                    <span key={row.id} className="selection-pill auto-assign-target-chip">
                      {(studentNameById.get(row.studentId) ?? row.studentId)} / {row.subject} / {row.count}件
                      <button className="basic-data-capability-remove" type="button" onClick={() => updateSetupField('initialSetupMakeupStocks', initialSetupMakeupStocks.filter((entry) => entry.id !== row.id))}>×</button>
                    </span>
                  ))}
                </div>
              </section>

              <section className="basic-data-editor-block basic-data-inline-stack" data-testid="setup-initial-lecture-stock">
                <div className="basic-data-card-head">
                  <h3>開始時点の講習ストック</h3>
                  <p>開始時点で持ち越している講習残を登録します。</p>
                </div>
                <div className="basic-data-form-row wrap align-center">
                  <select value={lectureDraft.studentId} onChange={(event) => setLectureDraft((current) => ({ ...current, studentId: event.target.value }))}>
                    <option value="">生徒を選択</option>
                    {students.map((student) => <option key={student.id} value={student.id}>{student.displayName || student.name}</option>)}
                  </select>
                  <select value={lectureDraft.subject} onChange={(event) => setLectureDraft((current) => ({ ...current, subject: event.target.value }))}>
                    {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                  </select>
                  <select value={lectureDraft.sessionId} onChange={(event) => setLectureDraft((current) => ({ ...current, sessionId: event.target.value }))}>
                    <option value="">講習を選択</option>
                    {specialSessions.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
                  </select>
                  <input type="number" min="1" value={lectureDraft.count} onChange={(event) => setLectureDraft((current) => ({ ...current, count: Math.max(1, Number(event.target.value) || 1) }))} />
                  <button className="primary-button" type="button" onClick={addInitialLectureStock} data-testid="setup-add-lecture-stock">追加</button>
                </div>
                <div className="auto-assign-pair-list">
                  {initialSetupLectureStocks.length === 0 ? <span className="basic-data-muted-inline">未登録</span> : null}
                  {initialSetupLectureStocks.map((row) => (
                    <span key={row.id} className="selection-pill auto-assign-target-chip">
                      {(studentNameById.get(row.studentId) ?? row.studentId)} / {row.subject} / {(sessionLabelById.get(row.sessionId) ?? row.sessionId)} / {row.count}件
                      <button className="basic-data-capability-remove" type="button" onClick={() => updateSetupField('initialSetupLectureStocks', initialSetupLectureStocks.filter((entry) => entry.id !== row.id))}>×</button>
                    </span>
                  ))}
                </div>
              </section>
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

            <div className="basic-data-actions-row">
              <button className="primary-button" type="button" onClick={onCompleteInitialSetup} data-testid="setup-complete-button">初期設定を完了してコマ表へ進む</button>
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}