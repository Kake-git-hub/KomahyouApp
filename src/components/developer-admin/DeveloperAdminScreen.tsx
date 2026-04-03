import { useMemo, useRef, useState } from 'react'
import { isActiveOnDate } from '../basic-data/basicDataModel'
import type { ServerAutoBackupSummary } from '../../integrations/firebase/adminFunctions'
import type { AppSnapshotPayload, WorkspaceClassroom, WorkspaceUser } from '../../types/appState'

type DeveloperAdminScreenProps = {
  currentUser: WorkspaceUser
  authMode: 'local' | 'firebase'
  accountProvisioningLocked: boolean
  managerEmailLocked: boolean
  firebaseProjectId: string
  persistenceMessage: string
  developerPassword: string
  onDeveloperPasswordChange: (value: string) => void
  developerCloudBackupEnabled: boolean
  developerCloudBackupFolderName: string
  developerCloudBackupStatus: string
  onConnectDeveloperCloudBackupFolder: () => void
  onDisconnectDeveloperCloudBackupFolder: () => void
  classrooms: WorkspaceClassroom[]
  users: WorkspaceUser[]
  actingClassroomId: string | null
  onAddClassroom: (input?: {
    classroomName: string
    managerName: string
    managerEmail?: string
    managerPassword?: string
    managerUserId?: string
    contractStartDate?: string
    contractEndDate?: string
  }) => void
  blazeFreeTierEstimate: null | {
    currentClassroomCount: number
    currentWorkspaceDailyBytes: number
    currentWorkspaceRetentionBytes: number
    currentWorkspaceUsageRate: number
    currentWorkspaceMaxRetentionDays: number
    estimatedAverageClassroomBytes: number
    estimatedReferenceDailyBytes: number
    estimatedReferenceRetentionBytes: number
    estimatedReferenceUsageRate: number
    estimatedReferenceMaxRetentionDays: number
    referenceClassroomCount: number
    retentionDays: number
    freeTierStorageBytes: number
  }
  serverAutoBackupSummaries: ServerAutoBackupSummary[]
  serverAutoBackupLoading: boolean
  onLoadServerAutoBackupSummaries: () => void
  onRestoreServerAutoBackup: (backupDateKey: string) => void
  bulkTemporarySuspensionReason: string
  onBulkTemporarySuspensionReasonChange: (value: string) => void
  areAllContractedClassroomsTemporarilySuspended: boolean
  onToggleContractedClassroomsTemporarySuspension: () => void
  onUpdateClassroom: (classroomId: string, updates: {
    name?: string
    contractStatus?: WorkspaceClassroom['contractStatus']
    contractStartDate?: string
    contractEndDate?: string
    managerName?: string
    managerEmail?: string
  }) => void
  onReplaceClassroomManagerUid: (classroomId: string, managerUserId: string, managerEmail: string) => void
  onExportWorkspaceBackup: () => void
  onExportAnalysisData: () => void
  onImportWorkspaceBackup: (file: File, password: string) => void
  onRestoreAutoBackup: (backupDateKey: string, password: string) => void
  onLoadStudentHistory: (classroomId: string) => void
  studentHistoryState: null | {
    classroomName: string
    entries: Array<{ dateKey: string; count: number }>
    loading: boolean
  }
  onCloseStudentHistory: () => void
  restoreModalState: null | {
    sourceLabel: string
    savedAt: string
    options: Array<{
      classroomId: string
      classroomName: string
      managerName: string
      existsInCurrent: boolean
      selected: boolean
    }>
  }
  onToggleRestoreClassroom: (classroomId: string) => void
  onSelectAllRestoreClassrooms: () => void
  onClearAllRestoreClassrooms: () => void
  onConfirmRestoreSelection: () => void
  onCancelRestoreSelection: () => void
  onDeleteClassroom: (classroomId: string, password: string) => void
  onOpenClassroom: (classroomId: string) => void
  onLogout: () => void
}

function countSnapshotRows(snapshot: AppSnapshotPayload) {
  return {
    managers: snapshot.managers.length,
    teachers: snapshot.teachers.length,
    students: snapshot.students.length,
    specialSessions: snapshot.specialSessions.length,
  }
}

function countActiveStudents(snapshot: AppSnapshotPayload, referenceDate: string) {
  return snapshot.students.filter((student) => isActiveOnDate(student.entryDate, student.withdrawDate, student.isHidden, referenceDate)).length
}

function formatContractStatusLabel(status: WorkspaceClassroom['contractStatus']) {
  return status === 'active' ? '契約中' : '解約済'
}

function formatContractPeriod(startDate: string, endDate: string) {
  if (!startDate && !endDate) return '未設定'
  if (!startDate) return `終了 ${endDate}`
  if (!endDate) return `${startDate} から継続`
  return `${startDate} - ${endDate}`
}

function formatSavedAt(savedAt: string) {
  if (!savedAt) return 'まだありません。'

  const parsed = new Date(savedAt)
  if (Number.isNaN(parsed.getTime())) return savedAt
  return parsed.toLocaleString('ja-JP')
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  if (value >= 100) return `${value.toFixed(0)}%`
  if (value >= 10) return `${value.toFixed(1)}%`
  return `${value.toFixed(2)}%`
}

function requestDeveloperPassword(actionLabel: string) {
  return window.prompt(`${actionLabel}ため、開発者パスワードを入力してください。`, '')
}

function buildFirebaseConsoleUrl(projectId: string, path: string) {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return ''
  return `https://console.firebase.google.com/project/${encodeURIComponent(normalizedProjectId)}${path}`
}

export function DeveloperAdminScreen({ currentUser, authMode, accountProvisioningLocked, managerEmailLocked, firebaseProjectId, persistenceMessage, developerPassword, onDeveloperPasswordChange, developerCloudBackupEnabled, developerCloudBackupFolderName, developerCloudBackupStatus, onConnectDeveloperCloudBackupFolder, onDisconnectDeveloperCloudBackupFolder, classrooms, users, actingClassroomId, onAddClassroom, blazeFreeTierEstimate, serverAutoBackupSummaries, serverAutoBackupLoading, onLoadServerAutoBackupSummaries, onRestoreServerAutoBackup, bulkTemporarySuspensionReason, onBulkTemporarySuspensionReasonChange, areAllContractedClassroomsTemporarilySuspended, onToggleContractedClassroomsTemporarySuspension, onUpdateClassroom, onReplaceClassroomManagerUid, onExportWorkspaceBackup, onExportAnalysisData, onImportWorkspaceBackup, onLoadStudentHistory, studentHistoryState, onCloseStudentHistory, restoreModalState, onToggleRestoreClassroom, onSelectAllRestoreClassrooms, onClearAllRestoreClassrooms, onConfirmRestoreSelection, onCancelRestoreSelection, onDeleteClassroom, onOpenClassroom, onLogout }: DeveloperAdminScreenProps) {
  const workspaceBackupImportRef = useRef<HTMLInputElement | null>(null)
  const [showProvisioningGuide, setShowProvisioningGuide] = useState(false)
  const [subPage, setSubPage] = useState<'main' | 'classrooms'>('main')
  const [managerUidDrafts, setManagerUidDrafts] = useState<Record<string, string>>({})
  const [managerEmailDrafts, setManagerEmailDrafts] = useState<Record<string, string>>({})
  const [provisionDraft, setProvisionDraft] = useState(() => ({
    classroomName: `新規教室 ${classrooms.length + 1}`,
    managerName: `教室管理者 ${classrooms.length + 1}`,
    managerUserId: '',
    contractStartDate: new Date().toISOString().slice(0, 10),
    contractEndDate: '',
  }))
  const managerById = useMemo(() => new Map(users.filter((user) => user.role === 'manager').map((user) => [user.id, user])), [users])
  const sparkManualAdminMode = authMode === 'firebase' && accountProvisioningLocked
  const firebaseSummary = accountProvisioningLocked || managerEmailLocked
    ? 'Firebase Hosting / Auth / Firestore で運用します。教室追加はこの画面から実行でき、管理者アカウントは自動発行されます。既存教室の管理者 UID 差し替えもここで行えます。教室削除と管理者メール変更は Firebase Console で手動運用します。'
    : 'Firebase Hosting / Auth / Firestore / Functions で運用します。教室追加と削除は Functions が Auth ユーザー発行まで処理し、管理者メール変更も Firebase 側へ反映します。'
  const firebaseAuthUrl = buildFirebaseConsoleUrl(firebaseProjectId, '/authentication/users')
  const todayDateKey = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const todayLabel = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}年${now.getMonth() + 1}月現在`
  }, [])
  const STUDENT_UNIT_PRICE = 300
  const classroomActiveStudents = useMemo(() =>
    classrooms.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      count: countActiveStudents(classroom.data, todayDateKey),
    })),
    [classrooms, todayDateKey],
  )

  const handleAddClassroom = () => {
    if (authMode === 'local') {
      onAddClassroom()
      return
    }
    setShowProvisioningGuide(true)
  }

  const submitProvisionDraft = () => {
    const normalizedClassroomName = provisionDraft.classroomName.trim()
    const normalizedManagerName = provisionDraft.managerName.trim()
    const normalizedManagerUserId = provisionDraft.managerUserId.trim()

    if (!normalizedClassroomName || !normalizedManagerName || !normalizedManagerUserId) return

    onAddClassroom({
      classroomName: normalizedClassroomName,
      managerName: normalizedManagerName,
      managerUserId: normalizedManagerUserId,
      contractStartDate: provisionDraft.contractStartDate,
      contractEndDate: provisionDraft.contractEndDate,
    })
    setShowProvisioningGuide(false)
  }

  return (
    <div className="page-shell developer-shell">
      <input ref={workspaceBackupImportRef} className="basic-data-hidden-input" type="file" accept="application/json" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) {
          const password = authMode === 'local' ? requestDeveloperPassword('開発者バックアップを復元する') : ''
          if (password !== null) onImportWorkspaceBackup(file, password)
        }
        event.currentTarget.value = ''
      }} />

      <section className="toolbar-panel" aria-label="開発者画面の操作バー">
        <div className="toolbar-row toolbar-row-primary">
          <div>
            <p className="panel-kicker">Developer Control</p>
            <h2 className="developer-heading">教室運営管理</h2>
          </div>
          <div className="toolbar-group toolbar-group-end">
            <div className="toolbar-status">ログイン中: {currentUser.name}</div>
            <button className="secondary-button slim" type="button" onClick={onLogout}>ログアウト</button>
          </div>
        </div>
        <div className="toolbar-row toolbar-row-secondary">
          <div className="toolbar-status">{persistenceMessage}</div>
        </div>
      </section>

      {subPage === 'main' ? (
      <main className="developer-main">
        <section className="board-panel board-panel-unified">
          <div className="basic-data-header developer-header">
            <div>
              <p className="panel-kicker">全教室一覧</p>
              <h2>利用状況と契約状態</h2>
              <p className="page-summary">{authMode === 'firebase' ? firebaseSummary : '第三者認証やDB接続前の運営UIです。教室追加、停止切替、管理者更新、代理入室の動線を先に確定します。'}</p>
            </div>
          </div>
          <div className="developer-header-actions">
            <div className="basic-data-row-actions developer-actions-left">
              <label className="basic-data-inline-field developer-bulk-reason-field">
                <span>一時停止理由</span>
                <input value={bulkTemporarySuspensionReason} onChange={(event) => onBulkTemporarySuspensionReasonChange(event.target.value)} placeholder="UPDATE中のため一時停止 など" />
              </label>
              <button className="secondary-button slim" type="button" onClick={onToggleContractedClassroomsTemporarySuspension}>
                {areAllContractedClassroomsTemporarilySuspended ? '契約中教室の一時利用停止を解除' : '契約中教室の一時利用停止'}
              </button>
            </div>
            <div className="basic-data-row-actions developer-actions-right">
              <button className="primary-button" type="button" onClick={handleAddClassroom}>教室を追加</button>
            </div>
          </div>
          {sparkManualAdminMode ? <div className="toolbar-status">教室削除と管理者メール変更は Firebase Console で実施してください。</div> : null}

          <div className="developer-summary-grid">
            <article className="basic-data-section-card developer-summary-card" style={{ cursor: 'pointer' }} onClick={() => setSubPage('classrooms')}>
              <strong>{classrooms.length}</strong>
              <span>校舎数（{todayLabel}）</span>
            </article>
            {classroomActiveStudents.slice(0, 3).map((entry) => (
              <article key={entry.id} className="basic-data-section-card developer-summary-card" style={{ cursor: 'pointer' }} onClick={() => onLoadStudentHistory(entry.id)}>
                <strong>{entry.count}</strong>
                <span>{entry.name} 在籍生徒数</span>
              </article>
            ))}
            {classroomActiveStudents.length > 3 ? (
              <article className="basic-data-section-card developer-summary-card" style={{ cursor: 'pointer' }} onClick={() => setSubPage('classrooms')}>
                <strong>…</strong>
                <span>他 {classroomActiveStudents.length - 3} 校舎</span>
              </article>
            ) : null}
          </div>
          <div className="basic-data-row-actions" style={{ marginBottom: 12 }}>
            <button className="secondary-button slim" type="button" onClick={() => setSubPage('classrooms')}>生徒数・請求一覧を表示</button>
          </div>

          {authMode === 'firebase' && blazeFreeTierEstimate ? (
            <section className="basic-data-section-card developer-backup-panel">
              <div className="basic-data-card-head">
                <h3>Blaze 無料枠の目安</h3>
              </div>
              <div className="toolbar-status">Cloud Storage 5 GB 中 <strong>{formatPercent(blazeFreeTierEstimate.currentWorkspaceUsageRate)}</strong> 使用中（{blazeFreeTierEstimate.retentionDays} 日保持 × {blazeFreeTierEstimate.currentClassroomCount} 教室で概算）</div>
            </section>
          ) : null}

          <section className="basic-data-section-card developer-backup-panel">
            <div className="basic-data-card-head">
              <h3>サーバーバックアップ</h3>
              <p>ワークスペース全体を JSON で退避し、削除済み教室もまとめて復元できます。{authMode === 'firebase' ? 'Firebase サーバー側で毎日 02:10 JST に自動バックアップが作成されます。' : ''}</p>
            </div>
            <div className="developer-backup-grid">
              <label className="basic-data-inline-field developer-password-field">
                <span>開発者パスワード</span>
                <input type="password" value={developerPassword} onChange={(event) => onDeveloperPasswordChange(event.target.value)} />
              </label>
              {authMode === 'firebase' ? (
                <div className="toolbar-status">現在の本人確認: Firebase ログイン済み（教室削除に開発者パスワードが必要です）</div>
              ) : null}
              <div className="basic-data-row-actions">
                <button className="secondary-button slim" type="button" onClick={onExportWorkspaceBackup} data-testid="developer-export-workspace-backup-button">バックアップを書き出す</button>
                <button className="secondary-button slim" type="button" onClick={onExportAnalysisData}>AI分析用データを書き出す</button>
                <button className="secondary-button slim" type="button" onClick={() => workspaceBackupImportRef.current?.click()} data-testid="developer-import-workspace-backup-button">バックアップを読み込む</button>
              </div>
            </div>
            <div className="developer-cloud-backup-row">
              <div className="toolbar-status">{developerCloudBackupEnabled ? `保存先フォルダ: ${developerCloudBackupFolderName || '未接続'}` : '保存先フォルダ: 未設定'}</div>
              <div className="toolbar-status">{developerCloudBackupStatus}</div>
              <div className="basic-data-row-actions">
                <button className="secondary-button slim" type="button" onClick={onConnectDeveloperCloudBackupFolder}>同期フォルダを設定</button>
                {developerCloudBackupEnabled ? <button className="secondary-button slim" type="button" onClick={onDisconnectDeveloperCloudBackupFolder}>自動保存を停止</button> : null}
              </div>
            </div>
            {authMode === 'firebase' ? (
              <>
                <div className="basic-data-row-actions">
                  <button className="secondary-button slim" type="button" onClick={onLoadServerAutoBackupSummaries} disabled={serverAutoBackupLoading}>{serverAutoBackupLoading ? '読み込み中…' : 'サーバーバックアップ一覧を取得'}</button>
                </div>
                <div className="backup-restore-auto-backup-list">
                  {serverAutoBackupSummaries.length === 0 && !serverAutoBackupLoading ? <span className="basic-data-muted-inline">サーバーバックアップはありません。一覧を取得してください。</span> : null}
                  {serverAutoBackupSummaries.map((summary) => (
                    <div key={summary.backupDateKey} className="backup-restore-auto-backup-row">
                      <div className="backup-restore-auto-backup-meta">
                        <strong>{summary.backupDateKey}</strong>
                        <span className="basic-data-subcopy">保存日時: {formatSavedAt(summary.savedAt)}</span>
                        <span className="basic-data-subcopy">元データ日時: {formatSavedAt(summary.sourceSavedAt)}</span>
                      </div>
                      <button className="secondary-button slim" type="button" onClick={() => onRestoreServerAutoBackup(summary.backupDateKey)}>この時点へ復元</button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </section>

          <div className="developer-classroom-list">
            {classrooms.map((classroom) => {
              const manager = managerById.get(classroom.managerUserId)
              const counts = countSnapshotRows(classroom.data)
              const isActing = actingClassroomId === classroom.id
              return (
                <article key={classroom.id} className="basic-data-section-card developer-classroom-card" data-testid={`developer-classroom-${classroom.id}`}>
                  <div className="developer-classroom-head">
                    <div>
                      <div className="developer-classroom-title-row">
                        <h3>{classroom.name || '名称未設定の教室'}</h3>
                        <span className={`status-chip ${classroom.contractStatus === 'suspended' ? 'danger' : ''}`}>{formatContractStatusLabel(classroom.contractStatus)}</span>
                        {classroom.contractStatus === 'active' && classroom.isTemporarilySuspended ? <span className="status-chip warning">一時停止中</span> : null}
                        {isActing ? <span className="status-chip secondary">現在開いている教室</span> : null}
                      </div>
                      <p className="detail-note">契約期間: {formatContractPeriod(classroom.contractStartDate, classroom.contractEndDate)}</p>
                      {classroom.contractStatus === 'active' && classroom.isTemporarilySuspended && classroom.temporarySuspensionReason ? <p className="detail-note">停止理由: {classroom.temporarySuspensionReason}</p> : null}
                    </div>
                    <div className="basic-data-row-actions">
                      <button className="secondary-button slim" type="button" onClick={() => onOpenClassroom(classroom.id)}>この教室を開く</button>
                      <button className="secondary-button slim" type="button" onClick={() => {
                        const password = window.prompt(`「${classroom.name || 'この教室'}」を削除します。開発者パスワードを入力してください。`, '')
                        if (password === null) return
                        onDeleteClassroom(classroom.id, password)
                      }}>削除</button>
                    </div>
                  </div>

                  <div className="developer-classroom-grid">
                    <label className="basic-data-inline-field">
                      <span>教室名</span>
                      <input value={classroom.name} onChange={(event) => onUpdateClassroom(classroom.id, { name: event.target.value })} />
                    </label>
                    <label className="basic-data-inline-field">
                      <span>契約状態</span>
                      <select value={classroom.contractStatus} onChange={(event) => onUpdateClassroom(classroom.id, { contractStatus: event.target.value as WorkspaceClassroom['contractStatus'] })}>
                        <option value="active">契約中</option>
                        <option value="suspended">解約済</option>
                      </select>
                    </label>
                    <label className="basic-data-inline-field">
                      <span>利用開始日</span>
                      <input type="date" value={classroom.contractStartDate} onChange={(event) => onUpdateClassroom(classroom.id, { contractStartDate: event.target.value })} />
                    </label>
                    <label className="basic-data-inline-field">
                      <span>利用終了日</span>
                      <input type="date" value={classroom.contractEndDate} onChange={(event) => onUpdateClassroom(classroom.id, { contractEndDate: event.target.value })} />
                    </label>
                    <label className="basic-data-inline-field">
                      <span>管理者名</span>
                      <input value={manager?.name ?? ''} onChange={(event) => onUpdateClassroom(classroom.id, { managerName: event.target.value })} />
                    </label>
                    <label className="basic-data-inline-field">
                      <span>管理者メール</span>
                      <input type="email" value={manager?.email ?? ''} onChange={(event) => onUpdateClassroom(classroom.id, { managerEmail: event.target.value })} disabled={managerEmailLocked} />
                    </label>
                  </div>

                  {authMode === 'firebase' ? (
                    <div className="developer-classroom-grid">
                      <label className="basic-data-inline-field">
                        <span>現在の管理者 UID</span>
                        <input value={classroom.managerUserId} readOnly />
                      </label>
                      <label className="basic-data-inline-field">
                        <span>差し替え先 UID</span>
                        <input
                          value={managerUidDrafts[classroom.id] ?? ''}
                          onChange={(event) => setManagerUidDrafts((current) => ({ ...current, [classroom.id]: event.target.value }))}
                          placeholder="Authentication で取得した UID"
                        />
                      </label>
                      <label className="basic-data-inline-field">
                        <span>差し替え先メール</span>
                        <input
                          type="email"
                          value={managerEmailDrafts[classroom.id] ?? ''}
                          onChange={(event) => setManagerEmailDrafts((current) => ({ ...current, [classroom.id]: event.target.value }))}
                          placeholder={manager?.email ?? 'Authentication のメールアドレス'}
                        />
                      </label>
                      <div className="basic-data-row-actions">
                        {firebaseAuthUrl ? <a className="secondary-button slim developer-guide-link-button" href={firebaseAuthUrl} target="_blank" rel="noreferrer">Authentication</a> : null}
                        <button
                          className="secondary-button slim"
                          type="button"
                          onClick={() => onReplaceClassroomManagerUid(classroom.id, managerUidDrafts[classroom.id] ?? '', managerEmailDrafts[classroom.id] ?? '')}
                          disabled={!(managerUidDrafts[classroom.id] ?? '').trim() || !(managerEmailDrafts[classroom.id] ?? '').trim() || (managerUidDrafts[classroom.id] ?? '').trim() === classroom.managerUserId}
                        >
                          この UID に差し替え
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="developer-data-counts">
                    <span className="selection-pill">管理者 {counts.managers} 人</span>
                    <span className="selection-pill">講師 {counts.teachers} 人</span>
                    <span className="selection-pill">生徒 {counts.students} 人</span>
                    <span className="selection-pill">講習期間 {counts.specialSessions} 件</span>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </main>
    ) : (
      <main className="developer-main">
        <section className="board-panel board-panel-unified">
          <div className="basic-data-header developer-header">
            <div>
              <p className="panel-kicker">生徒数・請求管理</p>
              <h2>全校舎の生徒数と請求金額（{todayLabel}）</h2>
            </div>
          </div>
          <div className="developer-header-actions">
            <div className="basic-data-row-actions developer-actions-left">
              <button className="secondary-button slim" type="button" onClick={() => setSubPage('main')}>← 管理画面に戻る</button>
            </div>
          </div>

          <section className="basic-data-section-card developer-backup-panel">
            <div className="basic-data-card-head">
              <h3>請求金額サマリー（生徒単価 {STUDENT_UNIT_PRICE.toLocaleString()}円）</h3>
            </div>
            <table className="developer-billing-table">
              <thead>
                <tr>
                  <th>校舎名</th>
                  <th style={{ textAlign: 'right' }}>在籍生徒数</th>
                  <th style={{ textAlign: 'right' }}>単価</th>
                  <th style={{ textAlign: 'right' }}>請求金額</th>
                </tr>
              </thead>
              <tbody>
                {classroomActiveStudents.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.name || '名称未設定'}</td>
                    <td style={{ textAlign: 'right' }}>{entry.count} 人</td>
                    <td style={{ textAlign: 'right' }}>{STUDENT_UNIT_PRICE.toLocaleString()}円</td>
                    <td style={{ textAlign: 'right' }}>{(entry.count * STUDENT_UNIT_PRICE).toLocaleString()}円</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>合計（{classroomActiveStudents.length} 校舎）</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{classroomActiveStudents.reduce((sum, e) => sum + e.count, 0)} 人</strong></td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}><strong>{classroomActiveStudents.reduce((sum, e) => sum + e.count * STUDENT_UNIT_PRICE, 0).toLocaleString()}円</strong></td>
                </tr>
              </tfoot>
            </table>
          </section>

          <div className="developer-classroom-list">
            {classroomActiveStudents.map((entry) => (
              <article key={entry.id} className="basic-data-section-card developer-classroom-card">
                <div className="developer-classroom-head">
                  <div>
                    <h3>{entry.name || '名称未設定'}</h3>
                    <p className="detail-note">在籍生徒数: {entry.count} 人</p>
                  </div>
                  <div className="basic-data-row-actions">
                    <button className="secondary-button slim" type="button" onClick={() => onLoadStudentHistory(entry.id)}>推移を表示</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      )}

      {restoreModalState ? (
        <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onCancelRestoreSelection() }}>
          <div className="auto-assign-modal developer-restore-modal" role="dialog" aria-modal="true" aria-label="教室復元選択モーダル">
            <div className="auto-assign-modal-title">{restoreModalState.sourceLabel}から復元する教室を選択</div>
            <div className="detail-note">保存日時: {formatSavedAt(restoreModalState.savedAt)}</div>
            <div className="developer-restore-modal-actions-top">
              <button className="secondary-button slim" type="button" onClick={onSelectAllRestoreClassrooms}>すべて復元</button>
              <button className="secondary-button slim" type="button" onClick={onClearAllRestoreClassrooms}>すべて現状維持</button>
            </div>
            <div className="developer-restore-modal-list">
              {restoreModalState.options.map((option) => (
                <label key={option.classroomId} className="developer-restore-toggle-row">
                  <span className="developer-restore-toggle-copy">
                    <strong>{option.classroomName}</strong>
                    <span className="detail-note">管理者: {option.managerName}</span>
                    <span className="detail-note">{option.existsInCurrent ? '現在も存在する教室です。' : '現在は削除済みです。復元すると教室を追加します。'}</span>
                  </span>
                  <span className="developer-restore-toggle-control">
                    <input type="checkbox" checked={option.selected} onChange={() => onToggleRestoreClassroom(option.classroomId)} />
                    <span>{option.selected ? '復元する' : '現状維持'}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="auto-assign-modal-actions">
              <button className="primary-button" type="button" onClick={onConfirmRestoreSelection}>選択内容で復元</button>
              <button className="secondary-button slim" type="button" onClick={onCancelRestoreSelection}>キャンセル</button>
            </div>
          </div>
        </div>
      ) : null}

      {studentHistoryState ? (
        <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onCloseStudentHistory() }}>
          <div className="auto-assign-modal developer-restore-modal" role="dialog" aria-modal="true" aria-label="生徒数推移">
            <div className="auto-assign-modal-title">{studentHistoryState.classroomName} — 在籍生徒数の推移</div>
            {studentHistoryState.loading ? (
              <div className="toolbar-status">読み込み中…</div>
            ) : studentHistoryState.entries.length === 0 ? (
              <div className="toolbar-status">バックアップ履歴がありません。</div>
            ) : (
              <div className="developer-restore-modal-list">
                {studentHistoryState.entries.map((entry) => (
                  <div key={entry.dateKey} className="backup-restore-auto-backup-row">
                    <strong>{entry.dateKey}</strong>
                    <span>{entry.count} 人</span>
                  </div>
                ))}
              </div>
            )}
            <div className="auto-assign-modal-actions">
              <button className="secondary-button slim" type="button" onClick={onCloseStudentHistory}>閉じる</button>
            </div>
          </div>
        </div>
      ) : null}

      {showProvisioningGuide ? (
        <div className="auto-assign-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setShowProvisioningGuide(false) }}>
          <div className="auto-assign-modal developer-provision-guide-modal" role="dialog" aria-modal="true" aria-label="教室追加">
            <div className="auto-assign-modal-title">教室追加</div>
            <div className="detail-note">教室名・管理者情報を入力して追加します。Firebase Auth コンソールでアカウントを作成し、UID を貼り付けてください。</div>

            <section className="developer-guide-section">
              {firebaseAuthUrl ? <div className="detail-note"><a href={firebaseAuthUrl} target="_blank" rel="noopener noreferrer">Firebase Auth コンソールを開く</a>（UID をコピーできます）</div> : null}
              <div className="developer-classroom-grid developer-provision-form">
                <label className="basic-data-inline-field">
                  <span>教室名</span>
                  <input value={provisionDraft.classroomName} onChange={(event) => setProvisionDraft((current) => ({ ...current, classroomName: event.target.value }))} />
                </label>
                <label className="basic-data-inline-field">
                  <span>管理者名</span>
                  <input value={provisionDraft.managerName} onChange={(event) => setProvisionDraft((current) => ({ ...current, managerName: event.target.value }))} />
                </label>
                <label className="basic-data-inline-field">
                  <span>管理者 UID</span>
                  <input type="text" value={provisionDraft.managerUserId} onChange={(event) => setProvisionDraft((current) => ({ ...current, managerUserId: event.target.value }))} placeholder="Firebase Auth の UID を貼り付け" />
                </label>
                <label className="basic-data-inline-field">
                  <span>利用開始日</span>
                  <input type="date" value={provisionDraft.contractStartDate} onChange={(event) => setProvisionDraft((current) => ({ ...current, contractStartDate: event.target.value }))} />
                </label>
                <label className="basic-data-inline-field">
                  <span>利用終了日</span>
                  <input type="date" value={provisionDraft.contractEndDate} onChange={(event) => setProvisionDraft((current) => ({ ...current, contractEndDate: event.target.value }))} />
                </label>
              </div>
            </section>

            <div className="auto-assign-modal-actions">
              <button className="primary-button" type="button" onClick={submitProvisionDraft} disabled={!provisionDraft.classroomName.trim() || !provisionDraft.managerName.trim() || !provisionDraft.managerUserId.trim()}>
                教室を追加
              </button>
              <button className="secondary-button slim" type="button" onClick={() => setShowProvisioningGuide(false)}>閉じる</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}