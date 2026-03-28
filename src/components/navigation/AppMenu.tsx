export type AppMenuScreen = 'board' | 'basic-data' | 'special-data' | 'auto-assign-rules' | 'backup-restore'

type AppMenuProps = {
  currentScreen: AppMenuScreen
  onNavigate: (screen: AppMenuScreen) => void
  actionButtonLabel?: string
  onActionButtonClick?: () => void
  actionButtonTestId?: string
  buttonTestId?: string
  boardItemTestId?: string
  basicDataItemTestId?: string
  specialDataItemTestId?: string
  autoAssignRulesItemTestId?: string
  backupRestoreItemTestId?: string
  footerActionLabel?: string
  onFooterActionClick?: () => void
  footerActionTestId?: string
}

const menuItems: Array<{ screen: AppMenuScreen; label: string }> = [
  { screen: 'board', label: 'コマ表' },
  { screen: 'basic-data', label: '基本データ' },
  { screen: 'special-data', label: '特別講習データ' },
  { screen: 'auto-assign-rules', label: '自動割振ルール' },
  { screen: 'backup-restore', label: 'バックアップ/復元/初期設定' },
]

export function AppMenu({
  currentScreen,
  onNavigate,
  actionButtonLabel,
  onActionButtonClick,
  actionButtonTestId,
  buttonTestId,
  boardItemTestId,
  basicDataItemTestId,
  specialDataItemTestId,
  autoAssignRulesItemTestId,
  backupRestoreItemTestId,
  footerActionLabel,
  onFooterActionClick,
  footerActionTestId,
}: AppMenuProps) {
  const testIdByScreen: Partial<Record<AppMenuScreen, string>> = {
    board: boardItemTestId,
    'basic-data': basicDataItemTestId,
    'special-data': specialDataItemTestId,
    'auto-assign-rules': autoAssignRulesItemTestId,
    'backup-restore': backupRestoreItemTestId,
  }

  if (actionButtonLabel && onActionButtonClick) {
    return (
      <button className="primary-button menu-button" type="button" onClick={onActionButtonClick} data-testid={actionButtonTestId}>
        {actionButtonLabel}
      </button>
    )
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
        {footerActionLabel && onFooterActionClick ? (
          <>
            <div className="menu-dropdown-divider" aria-hidden="true" />
            <button
              className="menu-link-button menu-link-button-footer"
              type="button"
              onClick={onFooterActionClick}
              data-testid={footerActionTestId}
            >
              {footerActionLabel}
            </button>
          </>
        ) : null}
      </div>
    </details>
  )
}