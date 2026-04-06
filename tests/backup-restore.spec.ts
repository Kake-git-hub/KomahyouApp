import { expect, test } from '@playwright/test'
import { installFixedDate, navigateToBoard, setNumberInput, acceptNextDialog } from './helpers'

test.beforeEach(async ({ page }) => {
  await installFixedDate(page)
})

test.describe('バックアップと初期設定', () => {
  async function openBackupRestoreScreen(page: Parameters<typeof test>[0]['page']) {
    await navigateToBoard(page)
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-backup-restore-button').click()
    await expect(page.getByTestId('backup-restore-screen')).toBeVisible()
  }

  test('バックアップ/復元画面が表示される', async ({ page }) => {
    await openBackupRestoreScreen(page)

    // メインセクションが存在する
    await expect(page.getByTestId('backup-restore-export-button')).toBeVisible()
    await expect(page.getByTestId('backup-restore-import-button')).toBeVisible()
    await expect(page.getByTestId('initial-setup-panel')).toBeVisible()
  })

  test('初期設定パネルで机数を変更できる', async ({ page }) => {
    await openBackupRestoreScreen(page)

    const deskCountInput = page.getByTestId('setup-desk-count')
    await expect(deskCountInput).toBeVisible()

    // 机数を変更
    await setNumberInput(page, 'setup-desk-count', 8)
    await expect(deskCountInput).toHaveValue('8')
  })

  test('初期設定パネルで定休日を切り替えられる', async ({ page }) => {
    await openBackupRestoreScreen(page)

    // 日曜の定休日チップをクリック
    const sundayChip = page.getByTestId('setup-closed-day-0')
    await expect(sundayChip).toBeVisible()

    const initialClass = await sundayChip.getAttribute('class')
    await sundayChip.click()
    const newClass = await sundayChip.getAttribute('class')

    // クラスが変わった（active toggle）
    expect(newClass).not.toBe(initialClass)
  })

  test('初期設定で未消化振替ストックを追加できる', async ({ page }) => {
    await openBackupRestoreScreen(page)

    // 振替ストック行を追加
    const studentSelect = page.getByTestId('setup-makeup-student')
    await expect(studentSelect).toBeVisible()

    await studentSelect.selectOption({ index: 1 })
    await page.getByTestId('setup-makeup-subject').selectOption({ index: 1 })
    await setNumberInput(page, 'setup-makeup-count', 2)

    await page.getByTestId('setup-makeup-add').click()

    // 追加された行に削除ボタンが存在する
    const removeButtons = page.locator('[data-testid^="setup-makeup-remove-"]')
    await expect(removeButtons).toHaveCount(1)
  })

  test('初期設定で未消化振替ストックを削除できる', async ({ page }) => {
    await openBackupRestoreScreen(page)

    // ストックを追加
    await page.getByTestId('setup-makeup-student').selectOption({ index: 1 })
    await page.getByTestId('setup-makeup-subject').selectOption({ index: 1 })
    await setNumberInput(page, 'setup-makeup-count', 1)
    await page.getByTestId('setup-makeup-add').click()

    const removeButton = page.locator('[data-testid^="setup-makeup-remove-"]').first()
    await expect(removeButton).toBeVisible()

    // 削除
    await removeButton.click()
    await expect(page.locator('[data-testid^="setup-makeup-remove-"]')).toHaveCount(0)
  })

  test('初期設定で未消化講習ストックを追加できる', async ({ page }) => {
    await openBackupRestoreScreen(page)

    const studentSelect = page.getByTestId('setup-lecture-student')
    await expect(studentSelect).toBeVisible()

    await studentSelect.selectOption({ index: 1 })
    await page.getByTestId('setup-lecture-subject').selectOption({ index: 1 })

    // 講習セッションが存在する場合のみセッションを選択
    const sessionSelect = page.getByTestId('setup-lecture-session')
    if (await sessionSelect.count() && (await sessionSelect.locator('option').count()) > 1) {
      await sessionSelect.selectOption({ index: 1 })
    }

    await setNumberInput(page, 'setup-lecture-count', 3)
    await page.getByTestId('setup-lecture-add').click()

    const removeButtons = page.locator('[data-testid^="setup-lecture-remove-"]')
    await expect(removeButtons).toHaveCount(1)
  })

  test('初期設定を完了するとコマ表にリセットされる', async ({ page }) => {
    await openBackupRestoreScreen(page)

    // 机数を設定
    await setNumberInput(page, 'setup-desk-count', 6)

    // 完了ボタン
    acceptNextDialog(page)
    await page.getByTestId('setup-complete-button').click()

    // コマ表画面に戻る
    await expect(page.getByTestId('week-label')).toBeVisible({ timeout: 10000 })
  })

  test('コマ表へ戻るボタンで画面遷移できる', async ({ page }) => {
    await openBackupRestoreScreen(page)

    await page.getByTestId('backup-restore-open-board-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()
  })
})
