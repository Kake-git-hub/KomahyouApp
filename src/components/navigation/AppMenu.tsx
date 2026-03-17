export type AppMenuScreen = 'board' | 'basic-data' | 'special-data' | 'backup-restore'

type AppMenuProps = {
  currentScreen: AppMenuScreen
  onNavigate: (screen: AppMenuScreen) => void
  buttonTestId?: string
  boardItemTestId?: string
  basicDataItemTestId?: string
  specialDataItemTestId?: string
  backupRestoreItemTestId?: string
}

const menuItems: Array<{ screen: AppMenuScreen; label: string }> = [
  { screen: 'board', label: 'コマ表' },
  { screen: 'basic-data', label: '基本データ' },
  { screen: 'special-data', label: '特別講習データ' },
  { screen: 'backup-restore', label: 'バックアップ/復元' },
]

export function AppMenu({
  currentScreen,
  onNavigate,
  buttonTestId,
  boardItemTestId,
  basicDataItemTestId,
  specialDataItemTestId,
  backupRestoreItemTestId,
}: AppMenuProps) {
  const testIdByScreen: Partial<Record<AppMenuScreen, string>> = {
    board: boardItemTestId,
    'basic-data': basicDataItemTestId,
    'special-data': specialDataItemTestId,
    'backup-restore': backupRestoreItemTestId,
  }

  return (
    <details className="menu-dropdown">
      <summary className="primary-button menu-button" data-testid={buttonTestId}>メニュー</summary>
      <div className="menu-dropdown-list">
        {menuItems.map((item) => (
          <button
            key={item.screen}
            className={`menu-link-button${currentScreen === item.screen ? ' active' : ''}`}
            type="button"
            disabled={currentScreen === item.screen}
            onClick={() => onNavigate(item.screen)}
            data-testid={testIdByScreen[item.screen]}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  )
}