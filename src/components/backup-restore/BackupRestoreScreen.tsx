import { AppMenu } from '../navigation/AppMenu'

type BackupRestoreScreenProps = {
  onBackToBoard: () => void
  onOpenBasicData: () => void
  onOpenSpecialData: () => void
}

export function BackupRestoreScreen({ onBackToBoard, onOpenBasicData, onOpenSpecialData }: BackupRestoreScreenProps) {
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
              }}
              buttonTestId="backup-restore-menu-button"
              boardItemTestId="backup-restore-open-board-button"
              basicDataItemTestId="backup-restore-open-basic-data-button"
              specialDataItemTestId="backup-restore-open-special-data-button"
            />
          </div>
          <div className="toolbar-group toolbar-group-end">
            <button className="secondary-button slim" type="button" onClick={onBackToBoard} data-testid="backup-restore-back-button">コマ表へ戻る</button>
          </div>
        </div>
        <div className="toolbar-row toolbar-row-secondary">
          <div className="toolbar-status" data-testid="backup-restore-status">バックアップ/復元の詳細機能は次段で接続できます。現状は画面導線と配置だけ先に揃えています。</div>
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
                <p>コマ表、基本データ、特別講習データをまとめて保存する操作をここに集約します。</p>
              </div>
            </section>
            <section className="basic-data-section-card">
              <div className="basic-data-card-head">
                <h3>復元候補</h3>
                <p>自動保存や手動保存のスナップショット一覧、復元前の確認差分を表示する想定です。</p>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}