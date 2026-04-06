import { expect, test } from '@playwright/test'
import { installFixedDate, navigateToBoard } from './helpers'

test.beforeEach(async ({ page }) => {
  await installFixedDate(page)
})

test.describe('画面遷移', () => {
  test('コマ表からすべてのサブ画面に遷移して戻れる', async ({ page }) => {
    await navigateToBoard(page)

    // コマ表 → 基本データ → コマ表
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await expect(page.getByTestId('basic-data-screen')).toBeVisible()
    await page.getByTestId('basic-data-menu-button').click()
    await page.getByTestId('basic-data-menu-open-board-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()

    // コマ表 → 特別講習データ → コマ表
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-special-data-button').click()
    await expect(page.getByTestId('special-data-screen')).toBeVisible()
    await page.getByTestId('special-data-menu-button').click()
    await page.getByTestId('special-data-menu-open-board-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()

    // コマ表 → 自動割振ルール → コマ表
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-auto-assign-rules-button').click()
    await expect(page.getByTestId('auto-assign-rules-screen')).toBeVisible()
    await page.getByTestId('auto-assign-rules-menu-button').click()
    await page.getByTestId('auto-assign-rules-menu-open-board-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()

    // コマ表 → バックアップ/復元 → コマ表
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-backup-restore-button').click()
    await expect(page.getByTestId('backup-restore-screen')).toBeVisible()
    await page.getByTestId('backup-restore-open-board-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()
  })

  test('ログアウトするとログイン画面が表示されWebdriver自動ログインで復帰する', async ({ page }) => {
    await navigateToBoard(page)

    // ログアウト
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-logout-button').click()

    // ログイン画面が一瞬表示されてWebdriver自動ログインで再びボードに戻る
    await expect(page.getByTestId('week-label')).toBeVisible({ timeout: 10000 })
  })

  test('表示週は画面遷移後も維持される', async ({ page }) => {
    await navigateToBoard(page)

    // 次週へ移動
    await page.getByTestId('next-week-button').click()
    const weekLabelAfterNext = await page.getByTestId('week-label').textContent()

    // 基本データへ遷移して戻る
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await expect(page.getByTestId('basic-data-screen')).toBeVisible()
    await page.getByTestId('basic-data-menu-button').click()
    await page.getByTestId('basic-data-menu-open-board-button').click()

    // 週表示が維持されている
    await expect(page.getByTestId('week-label')).toHaveText(weekLabelAfterNext!)
  })

  test('各サブ画面から他のサブ画面へ直接遷移できる', async ({ page }) => {
    await navigateToBoard(page)

    // コマ表 → 基本データ → 特別講習データ
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await expect(page.getByTestId('basic-data-screen')).toBeVisible()

    await page.getByTestId('basic-data-menu-button').click()
    await page.getByTestId('basic-data-menu-open-special-data-button').click()
    await expect(page.getByTestId('special-data-screen')).toBeVisible()

    // 特別講習データ → 自動割振ルール
    await page.getByTestId('special-data-menu-button').click()
    await page.getByTestId('special-data-menu-open-auto-assign-rules-button').click()
    await expect(page.getByTestId('auto-assign-rules-screen')).toBeVisible()

    // 自動割振ルール → コマ表
    await page.getByTestId('auto-assign-rules-menu-button').click()
    await page.getByTestId('auto-assign-rules-menu-open-board-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()
  })
})
