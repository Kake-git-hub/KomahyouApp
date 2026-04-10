import { useEffect, useRef, useState } from 'react'

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
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const testIdByScreen: Partial<Record<AppMenuScreen, string>> = {
    board: boardItemTestId,
    'basic-data': basicDataItemTestId,
    'special-data': specialDataItemTestId,
    'auto-assign-rules': autoAssignRulesItemTestId,
    'backup-restore': backupRestoreItemTestId,
  }

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleNavigate = (screen: AppMenuScreen) => {
    setIsOpen(false)
    onNavigate(screen)
  }

  const handleFooterActionClick = () => {
    setIsOpen(false)
    onFooterActionClick?.()
  }

  if (actionButtonLabel && onActionButtonClick) {
    return (
      <button className="primary-button menu-button" type="button" onClick={onActionButtonClick} data-testid={actionButtonTestId}>
        {actionButtonLabel}
      </button>
    )
  }

  return (
    <div className="menu-dropdown" ref={rootRef}>
      <button
        className="primary-button menu-button"
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        data-testid={buttonTestId}
      >
        メニュー
      </button>
      {isOpen ? (
        <div className="menu-dropdown-list">
          {menuItems.map((item) => (
            <button
              key={item.screen}
              className={`menu-link-button${currentScreen === item.screen ? ' active' : ''}`}
              type="button"
              disabled={currentScreen === item.screen}
              onClick={() => handleNavigate(item.screen)}
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
                onClick={handleFooterActionClick}
                data-testid={footerActionTestId}
              >
                {footerActionLabel}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}