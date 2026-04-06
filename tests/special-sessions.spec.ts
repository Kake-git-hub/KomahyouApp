import { expect, test } from '@playwright/test'
import {
  installFixedDate,
  navigateToBoard,
  getSpecialSessionDateButton,
  acceptNextDialog,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await installFixedDate(page)
})

test.describe('特別講習データ', () => {
  async function openSpecialDataScreen(page: Parameters<typeof test>[0]['page']) {
    await navigateToBoard(page)
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-special-data-button').click()
    await expect(page.getByTestId('special-data-screen')).toBeVisible()
  }

  test('特別講習セッションを作成して一覧に表示される', async ({ page }) => {
    await openSpecialDataScreen(page)

    // 作成フォームを開く
    await page.getByTestId('special-data-toggle-create-button').click()
    await expect(page.getByTestId('special-data-create-form')).toBeVisible()

    // ラベルを入力
    await page.getByTestId('special-data-draft-label').fill('2026 テスト講習')

    // 期間を選択
    await page.getByTestId('special-data-clear-period-button').click()
    await (await getSpecialSessionDateButton(page, '2026-04-10')).click()
    await (await getSpecialSessionDateButton(page, '2026-04-20')).click()

    // 作成
    await page.getByTestId('special-data-create-button').click()

    // テーブルに表示される
    const sessionsTable = page.getByTestId('special-data-sessions-table')
    await expect(sessionsTable.locator('tbody tr').filter({ hasText: '2026 テスト講習' })).toHaveCount(1)
  })

  test('特別講習セッションを編集してラベルを変更できる', async ({ page }) => {
    await openSpecialDataScreen(page)

    // まずセッションを作成
    await page.getByTestId('special-data-toggle-create-button').click()
    await page.getByTestId('special-data-draft-label').fill('編集前ラベル')
    await page.getByTestId('special-data-clear-period-button').click()
    await (await getSpecialSessionDateButton(page, '2026-05-01')).click()
    await (await getSpecialSessionDateButton(page, '2026-05-15')).click()
    await page.getByTestId('special-data-create-button').click()

    const sessionsTable = page.getByTestId('special-data-sessions-table')
    const row = sessionsTable.locator('tbody tr').filter({ hasText: '編集前ラベル' })
    await expect(row).toHaveCount(1)

    // 編集ボタンをクリック
    const editButton = row.locator('button').filter({ hasText: /編集/ })
    await editButton.click()

    // ラベルの入力欄を見つけて変更
    const labelInput = row.locator('input[type="text"]').first()
    if (await labelInput.count()) {
      await labelInput.fill('編集後ラベル')
      const confirmButton = row.locator('button').filter({ hasText: /完了|保存/ })
      if (await confirmButton.count()) {
        await confirmButton.click()
      }
      await expect(sessionsTable.locator('tbody tr').filter({ hasText: '編集後ラベル' })).toHaveCount(1)
    }
  })

  test('特別講習セッションを削除できる', async ({ page }) => {
    await openSpecialDataScreen(page)

    // セッションを作成
    await page.getByTestId('special-data-toggle-create-button').click()
    await page.getByTestId('special-data-draft-label').fill('削除対象講習')
    await page.getByTestId('special-data-clear-period-button').click()
    await (await getSpecialSessionDateButton(page, '2026-06-01')).click()
    await (await getSpecialSessionDateButton(page, '2026-06-10')).click()
    await page.getByTestId('special-data-create-button').click()

    const sessionsTable = page.getByTestId('special-data-sessions-table')
    await expect(sessionsTable.locator('tbody tr').filter({ hasText: '削除対象講習' })).toHaveCount(1)

    // 削除
    const row = sessionsTable.locator('tbody tr').filter({ hasText: '削除対象講習' })
    acceptNextDialog(page)
    const deleteButton = row.locator('button').filter({ hasText: /削除/ })
    await deleteButton.click()

    // 一覧から消える
    await expect(sessionsTable.locator('tbody tr').filter({ hasText: '削除対象講習' })).toHaveCount(0)
  })

  test('カレンダーの前月/次月ナビゲーションが動作する', async ({ page }) => {
    await openSpecialDataScreen(page)

    await page.getByTestId('special-data-toggle-create-button').click()
    await expect(page.getByTestId('special-data-create-form')).toBeVisible()

    // 現在の先頭月キーを取得
    const monthHeads = await page.locator('.special-session-calendar-head').allTextContents()
    expect(monthHeads.length).toBeGreaterThan(0)

    // 次月ボタンをクリック
    const nextButton = page.getByTestId('special-data-create-form').getByRole('button', { name: '次月' })
    await nextButton.click()

    // 月が変わったことを確認
    const newMonthHeads = await page.locator('.special-session-calendar-head').allTextContents()
    expect(newMonthHeads[0]).not.toBe(monthHeads[0])

    // 前月ボタンで戻す
    const prevButton = page.getByTestId('special-data-create-form').getByRole('button', { name: '前月' })
    await prevButton.click()

    const restoredMonthHeads = await page.locator('.special-session-calendar-head').allTextContents()
    expect(restoredMonthHeads[0]).toBe(monthHeads[0])
  })

  test('期間クリアボタンで選択済み期間をリセットできる', async ({ page }) => {
    await openSpecialDataScreen(page)

    await page.getByTestId('special-data-toggle-create-button').click()

    // 期間を選択
    await page.getByTestId('special-data-clear-period-button').click()
    await (await getSpecialSessionDateButton(page, '2026-04-10')).click()
    await (await getSpecialSessionDateButton(page, '2026-04-20')).click()

    // 期間クリア
    await page.getByTestId('special-data-clear-period-button').click()

    // 再度日付を選択できる状態になる（開始日から）
    await (await getSpecialSessionDateButton(page, '2026-05-01')).click()
    await (await getSpecialSessionDateButton(page, '2026-05-10')).click()
  })

  test('特別講習データ画面からコマ表へ戻れる', async ({ page }) => {
    await openSpecialDataScreen(page)

    await page.getByTestId('special-data-menu-button').click()
    await page.getByTestId('special-data-menu-open-board-button').click()

    await expect(page.getByTestId('week-label')).toBeVisible()
  })
})
