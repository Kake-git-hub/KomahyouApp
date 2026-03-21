import { AppMenu } from '../navigation/AppMenu'

type BackupRestoreScreenProps = {
  onBackToBoard: () => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
  onOpenAutoAssignRules: () => void
  persistenceMessage: string
  lastSavedAt: string
  onExportBackup: () => void
  onImportBackup: (file: File) => void
}

function formatSavedAt(savedAt: string) {
  if (!savedAt) return 'まだ保存されていません。'

  const parsed = new Date(savedAt)
  if (Number.isNaN(parsed.getTime())) return savedAt
  return parsed.toLocaleString('ja-JP')
}

export function BackupRestoreScreen({ onBackToBoard, onOpenBasicData, onOpenSpecialData, onOpenAutoAssignRules, persistenceMessage, lastSavedAt, onExportBackup, onImportBackup }: BackupRestoreScreenProps) {
  return (
    <div className="page-shell page-shell-basic-data">
      <section className="toolbar-panel" aria-label="バックアップと復元の操作バー">
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
              <p className="panel-kicker">バックアップ/復元</p>
              <h2>データ保全</h2>
              <p className="page-summary">この画面はメニューの着地点として追加しています。今後、手動バックアップ、復元履歴、差分確認をここへまとめられます。</p>
            </div>
          </div>

          <div className="backup-restore-grid">
            <section className="basic-data-section-card">
              <div className="basic-data-card-head">
                <h3>手動バックアップ</h3>
                <p>コマ表、基本データ、特別講習データ、日程表の表示範囲を JSON で書き出します。</p>
              </div>
              <div className="basic-data-form-grid">
                <div className="toolbar-status">最終自動保存: {formatSavedAt(lastSavedAt)}</div>
                <button className="primary-button" type="button" onClick={onExportBackup} data-testid="backup-restore-export-button">バックアップを書き出す</button>
              </div>
            </section>
            <section className="basic-data-section-card">
              <div className="basic-data-card-head">
                <h3>復元候補</h3>
                <p>書き出した JSON を読み込み、現在のデータ一式へ復元します。復元後は全画面が新しい状態へ切り替わります。</p>
              </div>
              <div className="basic-data-form-grid">
                <label className="secondary-button slim" htmlFor="backup-restore-import-input">バックアップを読み込む</label>
                <input
                  id="backup-restore-import-input"
                  type="file"
                  accept="application/json"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) onImportBackup(file)
                    event.currentTarget.value = ''
                  }}
                  data-testid="backup-restore-import-input"
                />
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}