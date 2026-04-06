import { expect, test } from '@playwright/test'
import {
  installFixedDate,
  navigateToBoard,
  acceptNextDialog,
  findFirstEmptyStudentCellTestId,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await installFixedDate(page)
})

test.describe('通常授業テンプレート', () => {
  test('テンプレートモードに入り、コマ表に戻れる', async ({ page }) => {
    await navigateToBoard(page)

    await page.getByTestId('board-regular-template-button').click()

    // テンプレートモードUI確認
    await expect(page.getByTestId('template-close-button')).toBeVisible()
    await expect(page.getByTestId('template-save-overwrite-button')).toBeVisible()
    await expect(page.getByTestId('template-clear-button')).toBeVisible()
    await expect(page.getByTestId('template-effective-start-date')).toBeVisible()

    // 曜日ヘッダーが表示される（月〜土）
    await expect(page.getByTestId('day-header-template_1')).toBeVisible()
    await expect(page.getByTestId('day-header-template_6')).toBeVisible()

    // 通常ボードのボタンは非表示
    await expect(page.getByTestId('next-week-button')).toBeHidden()
    await expect(page.getByTestId('prev-week-button')).toBeHidden()

    // コマ表に戻る
    await page.getByTestId('template-close-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()
    await expect(page.getByTestId('template-close-button')).toBeHidden()
  })

  test('テンプレートの空セルに既存生徒を追加できる', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // 月曜1限の空セルを見つける
    const slotId = 'template_1_1'
    const emptyCellTestId = await findFirstEmptyStudentCellTestId(page, slotId)

    // 空セルをクリック
    await page.getByTestId(emptyCellTestId).click()
    await expect(page.getByTestId('student-action-menu')).toBeVisible()

    // 既存生徒追加
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('template-add-student-select').selectOption({ index: 1 })
    await page.getByTestId('template-add-subject-select').selectOption({ index: 1 })
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    // 追加後はセルに名前が表示される
    const nameCell = page.getByTestId(emptyCellTestId.replace('student-cell-', 'student-name-'))
    await expect(nameCell).not.toHaveText('')
  })

  test('テンプレートの既存生徒を編集できる', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // まず生徒を追加
    const slotId = 'template_1_1'
    const emptyCellTestId = await findFirstEmptyStudentCellTestId(page, slotId)
    await page.getByTestId(emptyCellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('template-add-student-select').selectOption({ index: 1 })
    await page.getByTestId('template-add-subject-select').selectOption({ index: 1 })
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    const nameCell = page.getByTestId(emptyCellTestId.replace('student-cell-', 'student-name-'))
    const addedName = await nameCell.textContent()
    expect(addedName).toBeTruthy()

    // 編集モードに入る
    await page.getByTestId(emptyCellTestId).click()
    await page.getByTestId('menu-edit-button').click()

    // 科目を変更
    const subjectSelect = page.getByTestId('template-edit-subject-select')
    await expect(subjectSelect).toBeVisible()
    const currentValue = await subjectSelect.inputValue()
    const options = await subjectSelect.locator('option').all()
    for (const option of options) {
      const optValue = await option.getAttribute('value')
      if (optValue && optValue !== currentValue && optValue !== '') {
        await subjectSelect.selectOption(optValue)
        break
      }
    }
    await page.getByTestId('menu-edit-confirm-button').click()

    // 生徒名がそのまま残っている
    await expect(nameCell).toHaveText(addedName!)
  })

  test('テンプレートの生徒を削除できる', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // 生徒を追加
    const slotId = 'template_1_1'
    const emptyCellTestId = await findFirstEmptyStudentCellTestId(page, slotId)
    await page.getByTestId(emptyCellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('template-add-student-select').selectOption({ index: 1 })
    await page.getByTestId('template-add-subject-select').selectOption({ index: 1 })
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    const nameCell = page.getByTestId(emptyCellTestId.replace('student-cell-', 'student-name-'))
    await expect(nameCell).not.toHaveText('')

    // 削除
    await page.getByTestId(emptyCellTestId).click()
    await page.getByTestId('menu-delete-button').click()

    // 空に戻る
    await expect(nameCell).toHaveText('')
  })

  test('テンプレートの生徒を別コマへ移動できる', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // 生徒を追加
    const sourceSlotId = 'template_1_1'
    const sourceCellTestId = await findFirstEmptyStudentCellTestId(page, sourceSlotId)
    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('template-add-student-select').selectOption({ index: 1 })
    await page.getByTestId('template-add-subject-select').selectOption({ index: 1 })
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    const sourceNameCell = page.getByTestId(sourceCellTestId.replace('student-cell-', 'student-name-'))
    const addedName = await sourceNameCell.textContent()
    expect(addedName).toBeTruthy()

    // 移動開始
    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-move-button').click()

    // 火曜1限の空セルを移動先にする
    const targetSlotId = 'template_2_1'
    const targetCellTestId = await findFirstEmptyStudentCellTestId(page, targetSlotId)
    await page.getByTestId(targetCellTestId).click()

    // 移動後: 移動元は空、移動先に名前が表示される
    await expect(sourceNameCell).toHaveText('')
    const targetNameCell = page.getByTestId(targetCellTestId.replace('student-cell-', 'student-name-'))
    await expect(targetNameCell).toHaveText(addedName!)
  })

  test('テンプレートモードのundo/redoが動作する', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // 生徒を追加
    const slotId = 'template_1_1'
    const emptyCellTestId = await findFirstEmptyStudentCellTestId(page, slotId)
    await page.getByTestId(emptyCellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('template-add-student-select').selectOption({ index: 1 })
    await page.getByTestId('template-add-subject-select').selectOption({ index: 1 })
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    const nameCell = page.getByTestId(emptyCellTestId.replace('student-cell-', 'student-name-'))
    const addedName = await nameCell.textContent()
    expect(addedName).toBeTruthy()

    // undo → 追加が元に戻る
    await page.getByTestId('undo-button').click()
    await expect(nameCell).toHaveText('')

    // redo → 追加がやり直される
    await page.getByTestId('redo-button').click()
    await expect(nameCell).toHaveText(addedName!)
  })

  test('テンプレを空にするで全セルが空になる', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // 生徒を追加
    const slotId = 'template_1_1'
    const emptyCellTestId = await findFirstEmptyStudentCellTestId(page, slotId)
    await page.getByTestId(emptyCellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('template-add-student-select').selectOption({ index: 1 })
    await page.getByTestId('template-add-subject-select').selectOption({ index: 1 })
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    const nameCell = page.getByTestId(emptyCellTestId.replace('student-cell-', 'student-name-'))
    await expect(nameCell).not.toHaveText('')

    // テンプレを空にする（confirmダイアログ）
    acceptNextDialog(page)
    await page.getByTestId('template-clear-button').click()

    await expect(nameCell).toHaveText('')
  })

  test('上書き保存の確認ダイアログでキャンセルすると保存されない', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // 上書き保存ボタンをクリック
    await page.getByTestId('template-save-overwrite-button').click()

    // 確認モーダルが表示される
    await expect(page.getByTestId('template-save-confirm-cancel-button')).toBeVisible()
    await expect(page.getByTestId('template-save-confirm-execute-button')).toBeVisible()

    // キャンセル
    await page.getByTestId('template-save-confirm-cancel-button').click()

    // モーダルが閉じてテンプレートモードが維持される
    await expect(page.getByTestId('template-save-confirm-cancel-button')).toBeHidden()
    await expect(page.getByTestId('template-close-button')).toBeVisible()
  })

  test('上書き保存を実行するとコマ表に反映される', async ({ page }) => {
    await navigateToBoard(page)
    await page.getByTestId('board-regular-template-button').click()

    // 生徒を追加
    const slotId = 'template_1_1'
    const emptyCellTestId = await findFirstEmptyStudentCellTestId(page, slotId)
    await page.getByTestId(emptyCellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('template-add-student-select').selectOption({ index: 1 })
    await page.getByTestId('template-add-subject-select').selectOption({ index: 1 })
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    const nameCell = page.getByTestId(emptyCellTestId.replace('student-cell-', 'student-name-'))
    const addedName = await nameCell.textContent()
    expect(addedName).toBeTruthy()

    // 上書き保存を実行
    await page.getByTestId('template-save-overwrite-button').click()
    await page.getByTestId('template-save-confirm-execute-button').click()

    // コマ表に戻り、ステータスバナーが表示される
    await expect(page.getByTestId('toolbar-status')).toContainText(/テンプレート|上書き|保存|反映/)
  })
})
