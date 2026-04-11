import { expect, test } from '@playwright/test'
import {
  installFixedDate,
  navigateToBoard,
  setHiddenDateInput,
  setNumberInput,
  acceptNextDialog,
  navigateFromBasicDataToBoard,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await installFixedDate(page)
})

test.describe('基本データ管理', () => {
  async function openBasicDataScreen(page: Parameters<typeof test>[0]['page']) {
    await navigateToBoard(page)
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await expect(page.getByTestId('basic-data-screen')).toBeVisible()
  }

  test('4つのタブを切り替えて各セクションが表示される', async ({ page }) => {
    await openBasicDataScreen(page)

    // 生徒タブ（初期表示）
    await expect(page.getByTestId('basic-data-tab-students')).toHaveClass(/active/)
    await expect(page.getByTestId('basic-data-students-table')).toBeVisible()

    // 講師タブ
    await page.getByTestId('basic-data-tab-teachers').click()
    await expect(page.getByTestId('basic-data-tab-teachers')).toHaveClass(/active/)
    await expect(page.getByTestId('basic-data-teachers-table')).toBeVisible()

    // マネージャータブ
    await page.getByTestId('basic-data-tab-managers').click()
    await expect(page.getByTestId('basic-data-tab-managers')).toHaveClass(/active/)
    await expect(page.getByTestId('basic-data-managers-table')).toBeVisible()

    // 教室データタブ
    await page.getByTestId('basic-data-tab-classroomData').click()
    await expect(page.getByTestId('basic-data-tab-classroomData')).toHaveClass(/active/)
    await expect(page.getByTestId('basic-data-classroom-screen')).toBeVisible()
  })

  test('教室データタブで机数と定休日を設定できる', async ({ page }) => {
    await openBasicDataScreen(page)
    await page.getByTestId('basic-data-tab-classroomData').click()

    // 机数を変更
    const deskInput = page.getByTestId('basic-data-classroom-desk-count')
    await expect(deskInput).toBeVisible()
    await setNumberInput(page, 'basic-data-classroom-desk-count', 10)

    // 定休日を切り替え（日曜）
    const sundayChip = page.getByTestId('basic-data-classroom-closed-day-0')
    await expect(sundayChip).toBeVisible()
    const initialClass = await sundayChip.getAttribute('class')
    await sundayChip.click()
    const newClass = await sundayChip.getAttribute('class')
    expect(newClass).not.toBe(initialClass)
  })

  test('講師名簿トグルで在籍と退塾を切り替えられる', async ({ page }) => {
    await openBasicDataScreen(page)
    await page.getByTestId('basic-data-tab-teachers').click()

    // 名簿トグル
    await expect(page.getByTestId('basic-data-teacher-roster-active')).toBeVisible()
    await expect(page.getByTestId('basic-data-teacher-roster-withdrawn')).toBeVisible()

    // 退塾講師表示に切り替え
    await page.getByTestId('basic-data-teacher-roster-withdrawn').click()
    // 在籍講師に戻す
    await page.getByTestId('basic-data-teacher-roster-active').click()
    await expect(page.getByTestId('basic-data-teachers-table')).toBeVisible()
  })

  test('生徒名簿トグルで在籍と退塾を切り替えられる', async ({ page }) => {
    await openBasicDataScreen(page)

    // 名簿トグル
    await expect(page.getByTestId('basic-data-student-roster-active')).toBeVisible()
    await expect(page.getByTestId('basic-data-student-roster-withdrawn')).toBeVisible()

    // 退塾生徒を表示
    await page.getByTestId('basic-data-student-roster-withdrawn').click()
    await expect(page.getByTestId('basic-data-withdrawn-students-table')).toBeVisible()

    // 在籍に戻す
    await page.getByTestId('basic-data-student-roster-active').click()
    await expect(page.getByTestId('basic-data-students-table')).toBeVisible()
  })

  test('新しい生徒を追加して一覧に表示される', async ({ page }) => {
    await openBasicDataScreen(page)

    // 生徒追加フォーム
    await page.getByTestId('basic-data-student-draft-name').fill('テスト 生徒A')
    await page.getByTestId('basic-data-student-draft-display-name').fill('生徒A')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2026-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2013-06-15')
    await page.getByTestId('basic-data-add-student-button').click()

    // テーブルに追加された
    const studentsTable = page.getByTestId('basic-data-students-table')
    await expect(studentsTable.locator('tbody tr').filter({ hasText: 'テスト 生徒A' })).toHaveCount(1)
  })

  test('追加した生徒を削除すると一覧から消える', async ({ page }) => {
    await openBasicDataScreen(page)

    await page.getByTestId('basic-data-student-draft-name').fill('テスト 生徒削除')
    await page.getByTestId('basic-data-student-draft-display-name').fill('生徒削除')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2026-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2013-07-01')
    await page.getByTestId('basic-data-add-student-button').click()

    const studentsTable = page.getByTestId('basic-data-students-table')
    const createdRow = studentsTable.locator('tbody tr').filter({ hasText: 'テスト 生徒削除' })
    await expect(createdRow).toHaveCount(1)

    acceptNextDialog(page)
    await createdRow.getByRole('button', { name: '削除' }).click()

    await expect(createdRow).toHaveCount(0)
  })

  test('新しい講師を追加して一覧に表示される', async ({ page }) => {
    await openBasicDataScreen(page)
    await page.getByTestId('basic-data-tab-teachers').click()

    // 科目エリアを開く
    await page.getByTestId('basic-data-teacher-draft-capabilities-summary').click()

    // 講師追加
    await page.getByTestId('basic-data-teacher-draft-name').fill('新規テスト講師')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', '2026-03-01')
    await page.getByTestId('basic-data-teacher-draft-subject-chip-英').click()
    await page.getByRole('button', { name: '完了' }).click()
    await page.getByTestId('basic-data-add-teacher-button').click()

    // テーブルに追加された
    const teachersTable = page.getByTestId('basic-data-teachers-table')
    await expect(teachersTable.locator('tbody tr').filter({ hasText: '新規テスト講師' })).toHaveCount(1)
  })

  test('追加した講師を削除すると一覧から消える', async ({ page }) => {
    await openBasicDataScreen(page)
    await page.getByTestId('basic-data-tab-teachers').click()

    await page.getByTestId('basic-data-teacher-draft-capabilities-summary').click()
    await page.getByTestId('basic-data-teacher-draft-name').fill('削除対象講師')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', '2026-03-01')
    await page.getByTestId('basic-data-teacher-draft-subject-chip-英').click()
    await page.getByRole('button', { name: '完了' }).click()
    await page.getByTestId('basic-data-add-teacher-button').click()

    const teachersTable = page.getByTestId('basic-data-teachers-table')
    const createdRow = teachersTable.locator('tbody tr').filter({ hasText: '削除対象講師' })
    await expect(createdRow).toHaveCount(1)

    acceptNextDialog(page)
    await createdRow.getByRole('button', { name: '削除' }).click()

    await expect(createdRow).toHaveCount(0)
  })

  test('既存生徒の編集ボタンで名前を変更できる', async ({ page }) => {
    await openBasicDataScreen(page)

    // 最初の生徒を編集
    await expect(page.getByTestId('basic-data-student-name-s001')).toHaveText('青木 太郎')
    await page.getByTestId('basic-data-edit-student-s001').click()

    // 名前入力が表示される
    const nameInput = page.getByTestId('basic-data-student-name-input-s001')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveValue('青木 太郎')

    // 名前を変更
    await nameInput.fill('青木 太郎更新')

    // 編集ボタンを再度押して確定
    await page.getByTestId('basic-data-edit-student-s001').click()

    // 変更が反映される
    await expect(page.getByTestId('basic-data-student-name-s001')).toHaveText('青木 太郎更新')
  })

  test('既存講師の編集で名前を変更できる', async ({ page }) => {
    await openBasicDataScreen(page)
    await page.getByTestId('basic-data-tab-teachers').click()

    // 最初の講師を編集
    await expect(page.getByTestId('basic-data-teacher-name-t001')).toHaveText('田中講師')
    await page.getByTestId('basic-data-edit-teacher-t001').click()

    const nameInput = page.getByTestId('basic-data-teacher-name-input-t001')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveValue('田中講師')

    await nameInput.fill('田中講師A')
    await page.getByTestId('basic-data-edit-teacher-t001').click()

    await expect(page.getByTestId('basic-data-teacher-name-t001')).toHaveText('田中講師A')
  })

  test('基本データ画面からコマ表に戻れる', async ({ page }) => {
    await openBasicDataScreen(page)
    await navigateFromBasicDataToBoard(page)
    await expect(page.getByTestId('week-label')).toBeVisible()
  })

  test('退塾生徒が退塾リストに表示される', async ({ page }) => {
    await openBasicDataScreen(page)

    // 退塾生徒に切り替え
    await page.getByTestId('basic-data-student-roster-withdrawn').click()

    // s028（三浦 蓮）は withdrawDate=2026-02-28 なので退塾リストにいるはず
    const withdrawnTable = page.getByTestId('basic-data-withdrawn-students-table')
    await expect(withdrawnTable).toBeVisible()
    await expect(withdrawnTable.locator('tbody tr').filter({ hasText: '三浦' })).toHaveCount(1)
  })
})
