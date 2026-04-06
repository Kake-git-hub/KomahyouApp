import { expect, test } from '@playwright/test'
import { installFixedDate, navigateToBoard, acceptNextDialog } from './helpers'

test.beforeEach(async ({ page }) => {
  await installFixedDate(page)
})

test.describe('自動割振ルール', () => {
  async function openAutoAssignRulesScreen(page: Parameters<typeof test>[0]['page']) {
    await navigateToBoard(page)
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-auto-assign-rules-button').click()
    await expect(page.getByTestId('auto-assign-rules-screen')).toBeVisible()
  }

  test('ルールに「全員」対象を追加して表示されることを確認', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // preferDateConcentration ルールに全員を追加
    await page.getByTestId('auto-assign-open-modal-preferDateConcentration').click()
    await page.getByTestId('auto-assign-type-all-preferDateConcentration').click()
    await page.getByTestId('auto-assign-modal-confirm-preferDateConcentration').click()

    // 対象に「全員」が表示される
    await expect(page.getByTestId('auto-assign-rule-targets-preferDateConcentration')).toContainText('全員')
  })

  test('ルールに学年単位で対象を追加できる', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // forbidFirstPeriod ルールに中学生を追加
    await page.getByTestId('auto-assign-open-modal-forbidFirstPeriod').click()
    await page.getByTestId('auto-assign-type-grade-forbidFirstPeriod').click()

    // 中学生の学年ボタンをクリック
    const gradeButton = page.getByTestId('auto-assign-grade-中-forbidFirstPeriod')
    if (await gradeButton.count()) {
      await gradeButton.click()
    }
    await page.getByTestId('auto-assign-modal-confirm-forbidFirstPeriod').click()

    await expect(page.getByTestId('auto-assign-rule-targets-forbidFirstPeriod')).toContainText(/中/)
  })

  test('ルールに個人単位で対象を追加できる', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // preferNextDayOrLater ルールに個人を追加
    await page.getByTestId('auto-assign-open-modal-preferNextDayOrLater').click()
    await page.getByTestId('auto-assign-type-students-preferNextDayOrLater').click()

    // 最初の生徒をトグル
    const firstStudentToggle = page.locator('[data-testid^="auto-assign-student-toggle-preferNextDayOrLater-"]').first()
    if (await firstStudentToggle.count()) {
      await firstStudentToggle.click()
    }
    await page.getByTestId('auto-assign-modal-confirm-preferNextDayOrLater').click()

    await expect(page.getByTestId('auto-assign-rule-targets-preferNextDayOrLater')).not.toBeEmpty()
  })

  test('対象クリアで追加した対象を削除できる', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // まず全員を追加
    await page.getByTestId('auto-assign-open-modal-preferDateConcentration').click()
    await page.getByTestId('auto-assign-type-all-preferDateConcentration').click()
    await page.getByTestId('auto-assign-modal-confirm-preferDateConcentration').click()
    await expect(page.getByTestId('auto-assign-rule-targets-preferDateConcentration')).toContainText('全員')

    // クリア
    acceptNextDialog(page)
    await page.getByTestId('auto-assign-clear-targets-preferDateConcentration').click()

    // 対象が空になる
    await expect(page.getByTestId('auto-assign-rule-targets-preferDateConcentration')).not.toContainText('全員')
  })

  test('除外対象を追加して表示できる', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // まず全員を追加
    await page.getByTestId('auto-assign-open-modal-preferDateConcentration').click()
    await page.getByTestId('auto-assign-type-all-preferDateConcentration').click()
    await page.getByTestId('auto-assign-modal-confirm-preferDateConcentration').click()

    // 除外モーダルを開く
    await page.getByTestId('auto-assign-open-exclude-modal-preferDateConcentration').click()
    await page.getByTestId('auto-assign-type-students-preferDateConcentration').click()

    // 最初の生徒を除外
    const firstToggle = page.locator('[data-testid^="auto-assign-exception-toggle-exclude-preferDateConcentration-"]').first()
    if (await firstToggle.count()) {
      await firstToggle.click()
    }
    await page.getByTestId('auto-assign-exception-confirm-exclude-preferDateConcentration').click()

    // 除外リストに表示される
    await expect(page.getByTestId('auto-assign-exclude-list-preferDateConcentration')).not.toBeEmpty()
  })

  test('グループの優先順位を変更できる', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // day-spacingグループの優先順を取得
    const daySpacingPriority = page.getByTestId('auto-assign-group-priority-day-spacing')
    const originalPriority = await daySpacingPriority.textContent()

    // 下へ移動
    await page.getByTestId('auto-assign-group-move-down-day-spacing').click()
    const newPriority = await daySpacingPriority.textContent()

    // 優先順が変わったことを確認
    expect(newPriority).not.toBe(originalPriority)

    // 上へ戻す
    await page.getByTestId('auto-assign-group-move-up-day-spacing').click()
    await expect(daySpacingPriority).toHaveText(originalPriority!)
  })

  test('ペア制約を追加して一覧に表示される', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // ペア制約パネルまでスクロール
    const pairPanel = page.getByTestId('auto-assign-pair-constraints-panel')
    await pairPanel.scrollIntoViewIfNeeded()

    // 人物Aを設定
    await page.getByTestId('auto-assign-pair-draft-person-a-type').selectOption('student')
    await page.getByTestId('auto-assign-pair-draft-person-a-id').selectOption({ index: 1 })

    // 人物Bを設定
    await page.getByTestId('auto-assign-pair-draft-person-b-type').selectOption('student')
    await page.getByTestId('auto-assign-pair-draft-person-b-id').selectOption({ index: 2 })

    // 保存
    await page.getByTestId('auto-assign-pair-save-button').click()

    // テーブルに行が追加される
    const pairTable = page.getByTestId('auto-assign-pair-constraints-table')
    await expect(pairTable.locator('tbody tr')).toHaveCount(1)
  })

  test('ペア制約を削除できる', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    // ペア制約を追加
    const pairPanel = page.getByTestId('auto-assign-pair-constraints-panel')
    await pairPanel.scrollIntoViewIfNeeded()

    await page.getByTestId('auto-assign-pair-draft-person-a-type').selectOption('student')
    await page.getByTestId('auto-assign-pair-draft-person-a-id').selectOption({ index: 1 })
    await page.getByTestId('auto-assign-pair-draft-person-b-type').selectOption('student')
    await page.getByTestId('auto-assign-pair-draft-person-b-id').selectOption({ index: 2 })
    await page.getByTestId('auto-assign-pair-save-button').click()

    const pairTable = page.getByTestId('auto-assign-pair-constraints-table')
    await expect(pairTable.locator('tbody tr')).toHaveCount(1)

    // 削除
    acceptNextDialog(page)
    const removeButton = pairTable.locator('[data-testid^="auto-assign-pair-remove-"]').first()
    await removeButton.click()

    // テーブルが空になる
    await expect(pairTable.locator('tbody tr')).toHaveCount(0)
  })

  test('モーダルをキャンセルしても対象は変更されない', async ({ page }) => {
    await openAutoAssignRulesScreen(page)

    const targets = page.getByTestId('auto-assign-rule-targets-preferDateConcentration')
    const before = await targets.textContent()

    // モーダルを開いてキャンセル
    await page.getByTestId('auto-assign-open-modal-preferDateConcentration').click()
    await page.getByTestId('auto-assign-type-all-preferDateConcentration').click()
    await page.getByTestId('auto-assign-modal-cancel-target-preferDateConcentration').click()

    // 対象が変わっていない
    await expect(targets).toHaveText(before ?? '')
  })
})
