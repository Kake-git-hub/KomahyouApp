import { expect, test } from '@playwright/test'
import { buildMakeupStockEntries } from '../src/components/schedule-board/makeupStock'

async function setHiddenDateInput(page: Parameters<typeof test>[0]['page'], testId: string, value: string) {
  await page.getByTestId(testId).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(input, String(nextValue))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

async function setNumberInput(page: Parameters<typeof test>[0]['page'], testId: string, value: number) {
  await page.getByTestId(testId).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

function acceptNextDialog(page: Parameters<typeof test>[0]['page'], expectedText?: string) {
  page.once('dialog', async (dialog) => {
    if (expectedText) {
      expect(dialog.message()).toContain(expectedText)
    }
    await dialog.accept()
  })
}

async function navigateFromBasicDataToBoard(page: Parameters<typeof test>[0]['page']) {
  await page.getByTestId('basic-data-menu-button').click()
  await page.getByTestId('basic-data-menu-open-board-button').click()
}

async function navigateFromSpecialDataToBoard(page: Parameters<typeof test>[0]['page']) {
  await page.getByTestId('special-data-menu-button').click()
  await page.getByTestId('special-data-menu-open-board-button').click()
}

async function setScheduleRangeInPopup(popup: Parameters<typeof test>[0]['page'], startDate: string, endDate: string) {
  await popup.evaluate(([nextStartDate, nextEndDate]) => {
    ;(window as Window & { setRangeAndRender?: (startDate: string, endDate: string, periodValue: string) => void }).setRangeAndRender?.(
      nextStartDate,
      nextEndDate,
      '',
    )
  }, [startDate, endDate])
}

async function addSpecialStudentToCell(
  page: Parameters<typeof test>[0]['page'],
  cellTestId: string,
  name: string,
  birthDate = '2009-05-01',
) {
  await page.getByTestId(cellTestId).click()
  const addTab = page.getByTestId('menu-add-tab-new')
  if (await addTab.count()) {
    await addTab.click()
  }
  await page.getByTestId('menu-add-name-input').fill(name)
  await page.getByTestId('menu-add-full-name-input').fill(name)
  await page.getByTestId('menu-add-birthdate-input').fill(birthDate)
  await page.getByTestId('menu-add-lesson-type-special').click()
  acceptNextDialog(page, '追加は振替ストックにカウントされません')
  await page.getByTestId('menu-add-submit-button').click()
}

async function findFirstEmptyStudentCellTestId(page: Parameters<typeof test>[0]['page'], slotId: string) {
  for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
    for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
      const nameLocator = page.getByTestId(`student-name-${slotId}-${deskIndex}-${studentIndex}`)
      if (await nameLocator.count() === 0) continue
      const text = await nameLocator.textContent()
      if ((text ?? '').trim() === '') {
        return `student-cell-${slotId}-${deskIndex}-${studentIndex}`
      }
    }
  }

  throw new Error(`empty student cell not found for ${slotId}`)
}

async function hasStudentInSlot(
  page: Parameters<typeof test>[0]['page'],
  dateKey: string,
  slotNumber: number,
  studentName: string,
) {
  for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
    for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
      const locator = page.getByTestId(`student-name-${dateKey}_${slotNumber}-${deskIndex}-${studentIndex}`)
      if (await locator.count() === 0) continue
      const text = (await locator.textContent())?.trim()
      if (text === studentName) return true
    }
  }

  return false
}

async function addRegularLessonDraft(
  page: Parameters<typeof test>[0]['page'],
  lesson: {
    teacher: string
    student1: string
    subject1: string
    dayOfWeek: string
    slotNumber: string
    startDate?: string
    endDate?: string
    student2?: string
    subject2?: string
    student2StartDate?: string
    student2EndDate?: string
  },
) {
  const sharedStartDate = lesson.student2StartDate ?? lesson.startDate
  const sharedEndDate = lesson.student2EndDate ?? lesson.endDate

  await page.getByTestId('basic-data-regular-draft-teacher').selectOption({ label: lesson.teacher })
  await page.getByTestId('basic-data-regular-draft-student1').selectOption({ label: lesson.student1 })
  await page.getByTestId('basic-data-regular-draft-subject1').selectOption(lesson.subject1)
  await page.getByTestId('basic-data-regular-draft-day').selectOption(lesson.dayOfWeek)
  await page.getByTestId('basic-data-regular-draft-slot-number').fill(lesson.slotNumber)

  if (sharedStartDate) {
    await setHiddenDateInput(page, 'basic-data-regular-draft-start-input', sharedStartDate)
  }
  if (sharedEndDate) {
    await setHiddenDateInput(page, 'basic-data-regular-draft-end-input', sharedEndDate)
  }
  if (lesson.student2) {
    await page.getByTestId('basic-data-regular-draft-student2').selectOption({ label: lesson.student2 })
  }
  if (lesson.subject2) {
    await page.getByTestId('basic-data-regular-draft-subject2').selectOption(lesson.subject2)
  }

  acceptNextDialog(page, 'この通常授業をコマ表に反映します。')
  await page.getByTestId('basic-data-add-regular-lesson-button').click()
  await expect(page.getByTestId('basic-data-status')).toContainText('通常授業を追加しました。')
}

function addDays(date: Date, offset: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + offset)
  return next
}

function getWeekStart(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)
  start.setHours(0, 0, 0, 0)
  return start
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDateLabel(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function resolveExpectedSchoolStatus(birthDate: string, today = new Date()) {
  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)

  let age = today.getFullYear() - birthYear
  if (today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)) {
    age -= 1
  }

  if (age < 6) return '未就学'
  if (age <= 11) return `小${age - 5}`
  if (age <= 14) return `中${age - 11}`
  if (age <= 17) return `高${age - 14}`
  return '退塾'
}

function resolveExpectedBoardGrade(birthDate: string, lessonDate: Date) {
  const [yearText, monthText, dayText] = birthDate.split('-')
  const birthYear = Number(yearText)
  const birthMonth = Number(monthText)
  const birthDay = Number(dayText)
  const schoolYear = resolveOperationalSchoolYear(lessonDate)
  const enrollmentYear = birthMonth < 4 || (birthMonth === 4 && birthDay === 1) ? birthYear + 6 : birthYear + 7
  const gradeNumber = schoolYear - enrollmentYear + 1

  if (gradeNumber <= 1) return '小1'
  if (gradeNumber === 2) return '小2'
  if (gradeNumber === 3) return '小3'
  if (gradeNumber === 4) return '小4'
  if (gradeNumber === 5) return '小5'
  if (gradeNumber === 6) return '小6'
  if (gradeNumber === 7) return '中1'
  if (gradeNumber === 8) return '中2'
  if (gradeNumber === 9) return '中3'
  if (gradeNumber === 10) return '高1'
  if (gradeNumber === 11) return '高2'
  return '高3'
}

function getSchoolYearStart(year: number) {
  const date = new Date(year, 3, 1)
  date.setHours(0, 0, 0, 0)
  return date
}

function resolveOperationalSchoolYear(today = new Date()) {
  return today >= getSchoolYearStart(today.getFullYear()) ? today.getFullYear() : today.getFullYear() - 1
}

function resolveExpectedSpecialDraft(today = new Date()) {
  const month = today.getMonth() + 1
  if (month <= 4) {
    return { label: `${today.getFullYear()} 春期講習`, startDate: `${today.getFullYear()}-03-20`, endDate: `${today.getFullYear()}-04-07` }
  }
  if (month <= 9) {
    return { label: `${today.getFullYear()} 夏期講習`, startDate: `${today.getFullYear()}-07-21`, endDate: `${today.getFullYear()}-08-28` }
  }
  return { label: `${today.getFullYear()} 冬期講習`, startDate: `${today.getFullYear()}-12-24`, endDate: `${today.getFullYear() + 1}-01-07` }
}

function countOccurrences(text: string, needle: string) {
  return text.split(needle).length - 1
}

function extractSignedCount(text: string | null) {
  const match = text?.match(/([+-]\d+)/)
  if (!match) throw new Error(`signed count not found in: ${text}`)
  return Number(match[1])
}

async function moveBoardToWeek(page: Parameters<typeof test>[0]['page'], targetDate: Date) {
  const targetWeekStart = getWeekStart(targetDate)
  const targetWeekKey = toDateKey(targetWeekStart)

  for (let step = 0; step < 24; step += 1) {
    if (await page.getByTestId(`day-header-${targetWeekKey}`).count()) return

    const weekLabel = await page.getByTestId('week-label').textContent()
    if (!weekLabel) break

    const [currentStartLabel] = weekLabel.split(' - ')
    const [monthText, dayText] = currentStartLabel.split('/')
    const currentWeekStart = new Date(targetWeekStart.getFullYear(), Number(monthText) - 1, Number(dayText))

    if (toDateKey(currentWeekStart) < targetWeekKey) {
      await page.getByTestId('next-week-button').click()
    } else {
      await page.getByTestId('prev-week-button').click()
    }
  }

  throw new Error(`target week ${targetWeekKey} not found`)
}

function getMonthWeekdayDates(year: number, monthIndex: number, dayOfWeek: number) {
  const cursor = new Date(year, monthIndex, 1)
  const dates: string[] = []

  while (cursor.getMonth() === monthIndex) {
    if (cursor.getDay() === dayOfWeek) {
      dates.push(toDateKey(cursor))
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

test.describe('コマ調整表', () => {
  test('メニューから基本データへ移動してコマ表へ戻れる', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()

    await expect(page.getByTestId('basic-data-screen')).toBeVisible()
    await expect(page.getByRole('heading', { name: '管理データ' })).toBeVisible()
    await expect(page.getByTestId('basic-data-tab-students')).toHaveClass(/active/)
    await expect(page.getByTestId('basic-data-student-name-s001')).toHaveText('青木 太郎')
    await expect(page.getByTestId('basic-data-excel-menu-button')).toBeVisible()
    await expect(page.getByRole('button', { name: '未入力' })).toHaveCount(0)

    await page.getByTestId('basic-data-tab-teachers').click()
    await expect(page.getByTestId('basic-data-teacher-name-t001')).toHaveText('田中講師')

    await navigateFromBasicDataToBoard(page)
    await expect(page.getByTestId('week-label')).toBeVisible()
  })

  test('基本データの既存行は編集ボタンを押すまで編集できない', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()

    const firstStudentRow = page.getByTestId('basic-data-students-table').locator('tbody tr').first()
    const firstStudentName = page.getByTestId('basic-data-student-name-input-s001')

    await expect(firstStudentRow).toContainText('青木 太郎')
    await expect(firstStudentName).toHaveCount(0)
    await page.getByTestId('basic-data-edit-student-s001').click()
    await expect(firstStudentName).toBeVisible()
    await expect(firstStudentName).toHaveValue('青木 太郎')
  })

  test('講師の担当科目上限学年と生徒の自動学年を基本データで管理できる', async ({ page }) => {
    const currentGradeBirthDate = '2012-05-01'
    const expectedCurrentGrade = resolveExpectedSchoolStatus(currentGradeBirthDate)

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-teachers').click()
    await page.getByTestId('basic-data-teacher-draft-capabilities-summary').click()

    await page.getByTestId('basic-data-teacher-draft-name').fill('新規講師')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', '2025-04-01')
    await page.getByTestId('basic-data-teacher-draft-subject-chip-算').click()
    await expect(page.getByTestId('basic-data-teacher-draft-capabilities')).toContainText('算 小まで')
    await page.getByTestId('basic-data-teacher-draft-subject-chip-理').click()
    await page.getByTestId('basic-data-teacher-draft-grade-chip-中').click()
    await expect(page.getByTestId('basic-data-teacher-draft-capabilities')).toContainText('理 中まで')
    await page.getByTestId('basic-data-add-teacher-button').click()

    const latestTeacherRow = page.getByTestId('basic-data-teachers-table').locator('tbody tr').last()
    await expect(latestTeacherRow).toContainText('新規講師')
    await expect(latestTeacherRow).toContainText('2025-04-01')
    await expect(latestTeacherRow).toContainText('理 中まで')

    await page.getByTestId('basic-data-tab-students').click()
    await page.getByTestId('basic-data-student-draft-name').fill('学年テスト生徒')
    await page.getByTestId('basic-data-student-draft-display-name').fill('テスト生徒')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2025-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', currentGradeBirthDate)
    await page.getByTestId('basic-data-add-student-button').click()

    const latestStudentRow = page.getByTestId('basic-data-students-table').locator('tbody tr').last()
    await expect(latestStudentRow).toContainText('学年テスト生徒')
    await expect(latestStudentRow).toContainText('テスト生徒')
    await expect(latestStudentRow).toContainText('2025-04-01')
    await expect(latestStudentRow.locator('.status-chip').first()).toContainText(expectedCurrentGrade)

    await page.getByTestId('basic-data-student-draft-name').fill('卒業済みテスト生徒')
    await page.getByTestId('basic-data-student-draft-display-name').fill('卒業済み')
    await setHiddenDateInput(page, 'basic-data-student-draft-withdraw-date-input', '2024-03-31')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2000-05-01')
    await page.getByTestId('basic-data-add-student-button').click()

    await expect(page.getByTestId('basic-data-students-table')).not.toContainText('卒業済みテスト生徒')
    await page.getByTestId('basic-data-student-roster-withdrawn').click()
    await expect(page.getByTestId('basic-data-withdrawn-students-table')).toContainText('卒業済みテスト生徒')
  })

  test('通常授業と集団授業は年度別タブで見られ、追加時に年度を選べる', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const nextSchoolYear = currentSchoolYear + 1
    const nextSchoolYearEnd = `${nextSchoolYear + 1}-03-31`

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()

    await page.getByTestId('basic-data-tab-regularLessons').click()
    await expect(page.getByTestId(`basic-data-regular-year-${currentSchoolYear}`)).toHaveClass(/active/)
    await expect(page.getByTestId('basic-data-regular-lessons-table')).toContainText('田中講師')
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(nextSchoolYear))
    await expect(page.getByTestId('basic-data-regular-draft-start-input')).toHaveValue('')
    await expect(page.getByTestId('basic-data-regular-draft-end-input')).toHaveValue('')
    await page.getByTestId('basic-data-regular-draft-teacher').selectOption({ label: '田中講師' })
    await page.getByTestId('basic-data-regular-draft-student1').selectOption({ label: '青木太郎' })
    await page.getByTestId('basic-data-regular-draft-subject1').selectOption('数')
    await page.getByTestId('basic-data-regular-draft-day').selectOption('1')
    await page.getByTestId('basic-data-regular-draft-slot-number').fill('4')
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('この通常授業をコマ表に反映します。該当箇所がすでに埋まっている場合は振替ストックに蓄積します')
      await dialog.accept()
    })
    await page.getByTestId('basic-data-add-regular-lesson-button').click()
    await page.getByTestId(`basic-data-regular-year-${nextSchoolYear}`).click()
    await expect(page.getByTestId('basic-data-regular-lessons-table')).toContainText('田中講師')
    await expect(page.getByTestId('basic-data-regular-lessons-table')).toContainText('青木太郎')

    await page.getByTestId('basic-data-regular-draft-teacher').selectOption({ label: '田中講師' })
    await page.getByTestId('basic-data-regular-draft-student1').selectOption({ label: '青木太郎' })
    await setHiddenDateInput(page, 'basic-data-regular-draft-start-input', `${currentSchoolYear}-03-31`)
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain(`${nextSchoolYear}年度の範囲外です。`)
      await dialog.accept()
    })
    await page.getByTestId('basic-data-add-regular-lesson-button').click()
    await expect(page.getByTestId('basic-data-status')).toContainText('年度範囲外の期間があるため通常授業を追加できませんでした。')
    await expect(page.getByTestId('basic-data-regular-draft-teacher')).toHaveValue('t001')
    await expect(page.getByTestId('basic-data-regular-draft-student1')).toHaveValue('s001')
    await expect(page.getByTestId('basic-data-regular-draft-start-input')).toHaveValue(`${currentSchoolYear}-03-31`)
    await expect(page.getByTestId('basic-data-regular-draft-end-input')).toHaveValue('')

    await page.getByTestId('basic-data-tab-groupLessons').click()
    await expect(page.getByTestId(`basic-data-group-year-${currentSchoolYear}`)).toHaveClass(/active/)
    await expect(page.getByTestId('basic-data-group-lessons-table')).toContainText('佐藤講師')
    await page.getByTestId('basic-data-group-year-select').selectOption(String(nextSchoolYear))
    await page.getByTestId('basic-data-group-draft-teacher').selectOption({ label: '佐藤講師' })
    await page.getByTestId('basic-data-group-draft-subject').selectOption('英')
    await page.getByTestId('basic-data-group-draft-day').selectOption('3')
    await page.getByTestId('basic-data-group-draft-slot-label').fill('3限')
    await page.getByRole('button', { name: '伊藤花' }).click()
    await page.getByRole('button', { name: '上田陽介' }).click()
    await page.getByTestId('basic-data-add-group-lesson-button').click()
    await page.getByTestId(`basic-data-group-year-${nextSchoolYear}`).click()
    const groupRows = page.getByTestId('basic-data-group-lessons-table').locator('tbody tr')
    await expect(groupRows.first()).toContainText('佐藤講師')
    await expect(groupRows.first().locator('input').last()).toHaveValue('3限')
  })

  test('2026年度の初期通常授業データを年度タブで確認できる', async ({ page }) => {
    const nextSchoolYear = resolveOperationalSchoolYear(new Date()) + 1

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId(`basic-data-regular-year-${nextSchoolYear}`).click()

    await expect(page.getByTestId('basic-data-regular-lessons-table')).toContainText('清水結衣')
    await expect(page.getByTestId('basic-data-regular-lessons-table')).not.toContainText('2026年度 の通常授業はまだありません。')
  })

  test('基本データで講師と生徒を追加編集削除できる', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-teachers').click()

    await page.getByTestId('basic-data-teacher-draft-name').fill('E2E講師')
    await page.getByTestId('basic-data-teacher-draft-email').fill('e2e-teacher@example.com')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', '2025-04-01')
    await page.getByTestId('basic-data-add-teacher-button').click()

    const teachersTable = page.getByTestId('basic-data-teachers-table')
    const teacherRow = teachersTable.locator('tbody tr').last()
    await expect(teacherRow).toContainText('E2E講師')
    await teacherRow.getByRole('button', { name: '編集' }).click()
    await teacherRow.locator('input').first().fill('E2E講師改')
    await teacherRow.getByRole('button', { name: '編集終了' }).click()
    await expect(teacherRow).toContainText('E2E講師改')
    acceptNextDialog(page, 'この講師を削除します。')
    await teacherRow.getByRole('button', { name: '削除' }).click()
    await expect(teachersTable.locator('tbody tr').filter({ hasText: 'E2E講師改' })).toHaveCount(0)

    await page.getByTestId('basic-data-tab-students').click()
    await page.getByTestId('basic-data-student-draft-name').fill('E2E生徒')
    await page.getByTestId('basic-data-student-draft-display-name').fill('表示E2E')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2025-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2011-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    const studentsTable = page.getByTestId('basic-data-students-table')
    const studentRow = studentsTable.locator('tbody tr').last()
    await expect(studentRow).toContainText('表示E2E')
    await studentRow.getByRole('button', { name: '編集' }).click()
    await studentRow.locator('input').first().fill('E2E生徒改')
    await studentRow.locator('input').nth(1).fill('表示E2E改')
    await studentRow.getByRole('button', { name: '編集終了' }).click()
    await expect(studentRow).toContainText('E2E生徒改')
    await expect(studentRow).toContainText('表示E2E改')
    acceptNextDialog(page, 'この生徒を削除します。')
    await studentRow.getByRole('button', { name: '削除' }).click()
    await expect(studentsTable.locator('tbody tr').filter({ hasText: 'E2E生徒改' })).toHaveCount(0)
  })

  test('通常授業の追加と期間変更と削除がコマ表へ反映される', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const nextTuesdayKey = toDateKey(addDays(nextWeekStart, 1))
    const nextWednesdayKey = toDateKey(addDays(nextWeekStart, 2))
    const boardGrid = page.getByTestId('slot-adjust-grid')
    const findStudentInTuesdayFifthSlot = async () => {
      for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
        for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
          const nameText = await page.getByTestId(`student-name-${nextTuesdayKey}_5-${deskIndex}-${studentIndex}`).textContent()
          if ((nameText ?? '').trim() === '福田翔太') return true
        }
      }
      return false
    }

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))
    await page.getByTestId('basic-data-regular-draft-teacher').selectOption({ label: '伊藤講師' })
    await page.getByTestId('basic-data-regular-draft-student1').selectOption({ label: '福田翔太' })
    await page.getByTestId('basic-data-regular-draft-subject1').selectOption('社')
    await page.getByTestId('basic-data-regular-draft-day').selectOption('2')
    await page.getByTestId('basic-data-regular-draft-slot-number').fill('5')
    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByTestId('basic-data-add-regular-lesson-button').click()

    const regularTable = page.getByTestId('basic-data-regular-lessons-table')
    const newRow = regularTable.locator('tbody tr').filter({ hasText: '福田翔太' }).filter({ hasText: '火曜' }).filter({ hasText: '5限' }).first()
    await expect(newRow).toContainText('伊藤講師')

    await navigateFromBasicDataToBoard(page)
    await page.getByTestId('next-week-button').click()
    await expect.poll(findStudentInTuesdayFifthSlot).toBe(true)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    const periodRow = regularTable.locator('tbody tr').filter({ hasText: '福田翔太' }).filter({ hasText: '火曜' }).filter({ hasText: '5限' }).first()
    const rowTestId = await periodRow.getAttribute('data-testid')
    const rowId = rowTestId?.replace('basic-data-regular-row-', '')
    if (!rowId) throw new Error('regular lesson row id not found')

    await periodRow.getByRole('button', { name: '編集' }).click()
    const editablePeriodRow = page.getByTestId(`basic-data-regular-row-${rowId}`)
    await setHiddenDateInput(page, `basic-data-regular-period-start-${rowId}-input`, nextWednesdayKey)
    await editablePeriodRow.getByRole('button', { name: '編集終了' }).click()
    await navigateFromBasicDataToBoard(page)

    await page.getByTestId('next-week-button').click()
    await expect.poll(findStudentInTuesdayFifthSlot).toBe(false)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    const deleteRow = regularTable.locator('tbody tr').filter({ hasText: '福田翔太' }).filter({ hasText: '火曜' }).filter({ hasText: '5限' }).first()
    acceptNextDialog(page, 'この通常授業を削除します。')
    await deleteRow.getByRole('button', { name: '削除' }).click()
    await expect(regularTable.locator('tbody tr').filter({ hasText: '福田翔太' }).filter({ hasText: '火曜' }).filter({ hasText: '5限' })).toHaveCount(0)
  })

  test('通常授業の期間設定は全パターンでコマ表へ反映される', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const previousWeekStart = addDays(getWeekStart(new Date()), -7)
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const afterNextWeekStart = addDays(currentWeekStart, 14)
    const previousTuesdayKey = toDateKey(addDays(previousWeekStart, 1))
    const currentTuesdayKey = toDateKey(addDays(currentWeekStart, 1))
    const nextTuesdayKey = toDateKey(addDays(nextWeekStart, 1))
    const afterNextTuesdayKey = toDateKey(addDays(afterNextWeekStart, 1))
    const periodCases = [
      {
        name: '青木太郎',
        lesson: { teacher: '田中講師', student1: '青木太郎', subject1: '数', dayOfWeek: '2', slotNumber: '5' },
        expected: [true, true, true, true],
      },
      {
        name: '伊藤花',
        lesson: { teacher: '佐藤講師', student1: '伊藤花', subject1: '英', dayOfWeek: '2', slotNumber: '5', startDate: nextTuesdayKey },
        expected: [false, false, true, true],
      },
      {
        name: '上田陽介',
        lesson: { teacher: '鈴木講師', student1: '上田陽介', subject1: '数', dayOfWeek: '2', slotNumber: '5', endDate: currentTuesdayKey },
        expected: [true, true, false, false],
      },
      {
        name: '岡本美咲',
        lesson: { teacher: '高橋講師', student1: '岡本美咲', subject1: '英', dayOfWeek: '2', slotNumber: '5', startDate: currentTuesdayKey, endDate: nextTuesdayKey },
        expected: [false, true, true, false],
      },
      {
        name: '木村陸',
        lesson: { teacher: '伊藤講師', student1: '加藤未来', subject1: '国', dayOfWeek: '2', slotNumber: '5', student2: '木村陸', subject2: '数' },
        expected: [true, true, true, true],
      },
      {
        name: '小泉蒼',
        lesson: { teacher: '渡辺講師', student1: '工藤玲奈', subject1: '理', dayOfWeek: '2', slotNumber: '5', student2: '小泉蒼', subject2: 'IT', student2StartDate: nextTuesdayKey },
        expected: [false, false, true, true],
      },
      {
        name: '坂本翔',
        lesson: { teacher: '中村講師', student1: '斎藤由奈', subject1: '英', dayOfWeek: '2', slotNumber: '5', student2: '坂本翔', subject2: '数', student2EndDate: currentTuesdayKey },
        expected: [true, true, false, false],
      },
      {
        name: '菅原大智',
        lesson: { teacher: '小林講師', student1: '清水結衣', subject1: '数', dayOfWeek: '2', slotNumber: '5', student2: '菅原大智', subject2: '英', student2StartDate: currentTuesdayKey, student2EndDate: nextTuesdayKey },
        expected: [false, true, true, false],
      },
    ] as const

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))

    for (const periodCase of periodCases) {
      await addRegularLessonDraft(page, periodCase.lesson)
    }

    await navigateFromBasicDataToBoard(page)

    const weeks = [
      { start: previousWeekStart, dateKey: previousTuesdayKey, index: 0 },
      { start: currentWeekStart, dateKey: currentTuesdayKey, index: 1 },
      { start: nextWeekStart, dateKey: nextTuesdayKey, index: 2 },
      { start: afterNextWeekStart, dateKey: afterNextTuesdayKey, index: 3 },
    ]

    for (const week of weeks) {
      await moveBoardToWeek(page, week.start)
      for (const periodCase of periodCases) {
        await expect.poll(
          () => hasStudentInSlot(page, week.dateKey, 5, periodCase.name),
          { message: `${periodCase.name} on ${week.dateKey}` },
        ).toBe(periodCase.expected[week.index])
      }
    }
  })

  test('2人生徒の通常授業期間設定は共通期間としてコマ表へ反映される', async ({ page }) => {
    test.setTimeout(60000)

    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const schoolYearEnd = new Date(currentSchoolYear + 1, 2, 31)
    let currentWeekStart = getWeekStart(new Date())
    if (addDays(currentWeekStart, 18) > schoolYearEnd) {
      currentWeekStart = addDays(getWeekStart(schoolYearEnd), -21)
    }
    const previousWeekStart = addDays(currentWeekStart, -7)
    const nextWeekStart = addDays(currentWeekStart, 7)
    const afterNextWeekStart = addDays(currentWeekStart, 14)
    const weekStarts = [previousWeekStart, currentWeekStart, nextWeekStart, afterNextWeekStart]
    const participantPatterns = [
      {
        name: 'なし',
        apply: () => ({}),
        expected: [true, true, true, true],
      },
      {
        name: '開始のみ',
        apply: (dateKeys: string[]) => ({ startDate: dateKeys[2] }),
        expected: [false, false, true, true],
      },
      {
        name: '終了のみ',
        apply: (dateKeys: string[]) => ({ endDate: dateKeys[1] }),
        expected: [true, true, false, false],
      },
      {
        name: '開始終了',
        apply: (dateKeys: string[]) => ({ startDate: dateKeys[1], endDate: dateKeys[2] }),
        expected: [false, true, true, false],
      },
    ] as const
    const dayOptions = [2, 3, 4, 5] as const
    const teacherOptions = ['2人期間E2E講師A', '2人期間E2E講師B', '2人期間E2E講師C', '2人期間E2E講師D'] as const
    const slotOptions = ['1', '2', '3', '4'] as const
    const dualCases = participantPatterns.map((pattern, index) => {
      const dayOfWeek = dayOptions[index]
      const slotNumber = slotOptions[index]
      const dateKeys = weekStarts.map((weekStart) => toDateKey(addDays(weekStart, dayOfWeek - 1)))
      return {
        label: pattern.name,
        dayOfWeek,
        slotNumber,
        dateKeys,
        lesson: {
          teacher: teacherOptions[index],
          student1: '2人期間E2E生徒A',
          subject1: '数',
          student2: '2人期間E2E生徒B',
          subject2: '英',
          dayOfWeek: String(dayOfWeek),
          slotNumber,
          ...pattern.apply(dateKeys),
        },
        expected: pattern.expected,
      }
    })

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()

    await page.getByTestId('basic-data-tab-teachers').click()
    for (const [teacherIndex, teacherName] of teacherOptions.entries()) {
      await page.getByTestId('basic-data-teacher-draft-name').fill(teacherName)
      await page.getByTestId('basic-data-teacher-draft-email').fill(`dual-period-teacher-${teacherIndex + 1}@example.com`)
      await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', '2024-04-01')
      await page.getByTestId('basic-data-add-teacher-button').click()
    }

    await page.getByTestId('basic-data-tab-students').click()
    await page.getByTestId('basic-data-student-draft-name').fill('2人期間E2E生徒A')
    await page.getByTestId('basic-data-student-draft-display-name').fill('2人期間E2E生徒A')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2024-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2011-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await page.getByTestId('basic-data-student-draft-name').fill('2人期間E2E生徒B')
    await page.getByTestId('basic-data-student-draft-display-name').fill('2人期間E2E生徒B')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2024-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2012-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))

    for (const dualCase of dualCases) {
      await addRegularLessonDraft(page, dualCase.lesson)
    }

    await navigateFromBasicDataToBoard(page)

    for (let weekIndex = 0; weekIndex < weekStarts.length; weekIndex += 1) {
      await moveBoardToWeek(page, weekStarts[weekIndex])
      for (const dualCase of dualCases) {
        await expect.poll(
          () => hasStudentInSlot(page, dualCase.dateKeys[weekIndex], Number(dualCase.slotNumber), '2人期間E2E生徒A'),
          { message: `student1 ${dualCase.label} on ${dualCase.dateKeys[weekIndex]}` },
        ).toBe(dualCase.expected[weekIndex])
        await expect.poll(
          () => hasStudentInSlot(page, dualCase.dateKeys[weekIndex], Number(dualCase.slotNumber), '2人期間E2E生徒B'),
          { message: `student2 ${dualCase.label} on ${dualCase.dateKeys[weekIndex]}` },
        ).toBe(dualCase.expected[weekIndex])
      }
    }
  })

  test('本番相当データでも通常授業の追加内容が複数週のコマ表へ反映される', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const afterNextWeekStart = addDays(currentWeekStart, 14)
    const currentTuesdayKey = toDateKey(addDays(currentWeekStart, 1))
    const nextTuesdayKey = toDateKey(addDays(nextWeekStart, 1))
    const afterNextTuesdayKey = toDateKey(addDays(afterNextWeekStart, 1))
    const currentThursdayKey = toDateKey(addDays(currentWeekStart, 3))
    const nextThursdayKey = toDateKey(addDays(nextWeekStart, 3))
    const afterNextThursdayKey = toDateKey(addDays(afterNextWeekStart, 3))

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()

    await page.getByTestId('basic-data-tab-teachers').click()
    await page.getByTestId('basic-data-teacher-draft-name').fill('本番E2E講師')
    await page.getByTestId('basic-data-teacher-draft-email').fill('prod-like-teacher@example.com')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', '2024-04-01')
    await page.getByTestId('basic-data-add-teacher-button').click()
    await expect(page.getByTestId('basic-data-teachers-table')).toContainText('本番E2E講師')

    await page.getByTestId('basic-data-tab-students').click()

    await page.getByTestId('basic-data-student-draft-name').fill('本番E2E生徒A')
    await page.getByTestId('basic-data-student-draft-display-name').fill('本番E2E生徒A')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2024-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2010-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await page.getByTestId('basic-data-student-draft-name').fill('本番E2E生徒B')
    await page.getByTestId('basic-data-student-draft-display-name').fill('本番E2E生徒B')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2024-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2011-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await page.getByTestId('basic-data-student-draft-name').fill('本番E2E生徒C')
    await page.getByTestId('basic-data-student-draft-display-name').fill('本番E2E生徒C')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2024-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2012-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))

    await addRegularLessonDraft(page, {
      teacher: '本番E2E講師',
      student1: '本番E2E生徒A',
      subject1: '数',
      dayOfWeek: '2',
      slotNumber: '4',
    })

    await addRegularLessonDraft(page, {
      teacher: '本番E2E講師',
      student1: '本番E2E生徒B',
      subject1: '英',
      dayOfWeek: '2',
      slotNumber: '5',
      startDate: currentTuesdayKey,
      endDate: nextTuesdayKey,
    })

    await addRegularLessonDraft(page, {
      teacher: '本番E2E講師',
      student1: '本番E2E生徒C',
      subject1: '国',
      dayOfWeek: '4',
      slotNumber: '2',
      student2: '本番E2E生徒A',
      subject2: '算',
      student2StartDate: nextThursdayKey,
      student2EndDate: nextThursdayKey,
    })

    await navigateFromBasicDataToBoard(page)

    await moveBoardToWeek(page, currentWeekStart)
    await expect.poll(() => hasStudentInSlot(page, currentTuesdayKey, 4, '本番E2E生徒A')).toBe(true)
    await expect.poll(() => hasStudentInSlot(page, currentTuesdayKey, 5, '本番E2E生徒B')).toBe(true)
    await expect.poll(() => hasStudentInSlot(page, currentThursdayKey, 2, '本番E2E生徒C')).toBe(false)
    await expect.poll(() => hasStudentInSlot(page, currentThursdayKey, 2, '本番E2E生徒A')).toBe(false)

    await moveBoardToWeek(page, nextWeekStart)
    await expect.poll(() => hasStudentInSlot(page, nextTuesdayKey, 4, '本番E2E生徒A')).toBe(true)
    await expect.poll(() => hasStudentInSlot(page, nextTuesdayKey, 5, '本番E2E生徒B')).toBe(true)
    await expect.poll(() => hasStudentInSlot(page, nextThursdayKey, 2, '本番E2E生徒C')).toBe(true)
    await expect.poll(() => hasStudentInSlot(page, nextThursdayKey, 2, '本番E2E生徒A')).toBe(true)

    await moveBoardToWeek(page, afterNextWeekStart)
    await expect.poll(() => hasStudentInSlot(page, afterNextTuesdayKey, 4, '本番E2E生徒A')).toBe(true)
    await expect.poll(() => hasStudentInSlot(page, afterNextTuesdayKey, 5, '本番E2E生徒B')).toBe(false)
    await expect.poll(() => hasStudentInSlot(page, afterNextThursdayKey, 2, '本番E2E生徒C')).toBe(false)
    await expect.poll(() => hasStudentInSlot(page, afterNextThursdayKey, 2, '本番E2E生徒A')).toBe(false)
  })

  test('期間付き通常授業は月内4回を上限に配置する', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const schoolYearStart = new Date(currentSchoolYear, 3, 1)
    const schoolYearEnd = new Date(currentSchoolYear + 1, 2, 31)
    const today = new Date()
    const searchStart = today > schoolYearStart ? today : schoolYearStart

    let targetMonthStart: Date | null = null
    for (let year = searchStart.getFullYear(); year <= schoolYearEnd.getFullYear() && !targetMonthStart; year += 1) {
      const monthStart = year === searchStart.getFullYear() ? searchStart.getMonth() : 0
      const monthEnd = year === schoolYearEnd.getFullYear() ? schoolYearEnd.getMonth() : 11
      for (let monthIndex = monthStart; monthIndex <= monthEnd; monthIndex += 1) {
        const tuesdays = getMonthWeekdayDates(year, monthIndex, 2)
        if (tuesdays.length >= 5) {
          targetMonthStart = new Date(year, monthIndex, 1)
          break
        }
      }
    }
    if (!targetMonthStart) throw new Error('5回ある火曜の月が見つかりません')

    const monthTuesdays = getMonthWeekdayDates(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), 2)
    const periodStart = monthTuesdays[0]
    const periodEnd = monthTuesdays[monthTuesdays.length - 1]

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-students').click()
    await page.getByTestId('basic-data-student-draft-name').fill('契約月数検証生徒')
    await page.getByTestId('basic-data-student-draft-display-name').fill('契約月数検証生徒')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', `${currentSchoolYear}-04-01`)
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2010-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))
    await addRegularLessonDraft(page, {
      teacher: '田中講師',
      student1: '契約月数検証生徒',
      subject1: '数',
      dayOfWeek: '2',
      slotNumber: '5',
      startDate: periodStart,
      endDate: periodEnd,
    })

    await navigateFromBasicDataToBoard(page)

    for (const dateKey of monthTuesdays.slice(0, 4)) {
      await moveBoardToWeek(page, parseDateKey(dateKey))
      await expect.poll(() => hasStudentInSlot(page, dateKey, 5, '契約月数検証生徒')).toBe(true)
    }

    await moveBoardToWeek(page, parseDateKey(monthTuesdays[4]))
    await expect.poll(() => hasStudentInSlot(page, monthTuesdays[4], 5, '契約月数検証生徒')).toBe(false)

    await page.getByTestId('makeup-stock-chip').click()
    const stockRow = page.locator('.makeup-stock-row').filter({ hasText: '契約月数検証生徒' }).filter({ hasText: '数' }).first()
    await expect(stockRow).toHaveCount(0)
  })

  test('現状の通常授業管理データがコマ表にも表示される', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await expect(page.getByTestId(`teacher-cell-${mondaySlotId}-0`)).toContainText('田中講師')
    await expect(page.getByTestId(`student-name-${mondaySlotId}-0-0`)).toHaveText('青木太郎')
    await expect(page.getByTestId(`student-cell-${mondaySlotId}-0-0`).locator('.sa-student-detail')).toContainText('数')
  })

  test('空き講師セルは教室番号だけを表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await expect(page.getByTestId(`teacher-cell-${mondaySlotId}-9`)).toHaveText('')
    await expect(page.getByTestId(`teacher-cell-${mondaySlotId}-9`)).not.toContainText('10')
  })

  test('空欄の講師セルをクリックして講師を設定できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`
    const teacherCell = page.getByTestId(`teacher-cell-${mondaySlotId}-9`)

    await page.goto('/')

    await teacherCell.click()
    await expect(page.getByTestId('teacher-action-menu')).toBeVisible()
    await page.getByTestId('teacher-select-input').selectOption({ label: '田中講師' })
    await page.getByTestId('teacher-select-confirm-button').click()

    await expect(teacherCell).toContainText('田中講師')
  })

  test('メニューから特別講習データへ移動してセッションを作成できる', async ({ page }) => {
    const expectedDraft = resolveExpectedSpecialDraft()

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-special-data-button').click()

    await expect(page.getByTestId('special-data-screen')).toBeVisible()
    await expect(page.getByTestId('special-data-create-form')).toHaveCount(0)

  await page.getByTestId('special-data-toggle-create-button').click()
  await expect(page.getByTestId('special-data-create-form')).toBeVisible()
  await expect(page.locator('.special-session-calendar-weekdays span').first()).toHaveText('月')
  await expect(page.getByTestId('special-data-draft-label')).toHaveValue(expectedDraft.label)
  await page.getByTestId('special-data-create-form').getByRole('button', { name: '次月' }).click()
  await page.getByTestId('special-data-create-form').getByRole('button', { name: '前月' }).click()

    await page.getByTestId('special-data-create-button').click()
  await expect(page.getByTestId('special-data-create-form')).toHaveCount(0)

    const latestSessionRow = page.getByTestId('special-data-sessions-table').locator('tbody tr').first()
    await expect(latestSessionRow).toContainText(expectedDraft.label)
    await expect(latestSessionRow).toContainText(`${expectedDraft.startDate} 〜 ${expectedDraft.endDate}`)

  await page.getByTestId('special-data-toggle-create-button').click()
  await page.getByTestId('special-data-create-button').click()
  await expect(page.getByTestId('special-data-status')).toContainText('重複')
  await expect(page.getByTestId('special-data-create-form')).toBeVisible()

    await navigateFromSpecialDataToBoard(page)
    await moveBoardToWeek(page, parseDateKey(expectedDraft.startDate))
    await expect(page.getByTestId('board-special-periods')).toContainText(expectedDraft.label)
    await expect(page.getByTestId('week-label')).toBeVisible()
  })

  test('講習期間帯をクリックすると別タブで欠席不可入力を開ける', async ({ page }) => {
    await page.goto('/')

    await moveBoardToWeek(page, new Date(2026, 2, 23))

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('board-special-period-session_2026_spring').click(),
    ])

    await expect(popup.getByTestId('special-session-popup-screen')).toBeVisible()
    await expect(popup).toHaveTitle('特別講習入力')
    await expect(popup.locator('.person-row').first()).toContainText('未入力')

    await popup.getByTestId('special-session-popup-tab-student').click()
    const selectedStudent = popup.locator('.person-row').first()
    const selectedStudentName = ((await selectedStudent.locator('strong').textContent()) ?? '').trim()
    await selectedStudent.click()
    await popup.locator('.cell-button').first().click()
    await setNumberInput(popup, 'special-session-popup-subject-英', 2)
    await expect(popup.getByTestId('special-session-popup-subject-英')).toHaveValue('2')
    await popup.getByRole('button', { name: '保存' }).click()

    await page.getByTestId('lecture-stock-chip').click()
    await expect(page.getByTestId('lecture-stock-panel')).toBeVisible()
    const lectureStockPanel = page.getByTestId('lecture-stock-panel')
    await expect(lectureStockPanel.locator('.lecture-stock-row').filter({ hasText: selectedStudentName }).filter({ hasText: '英' })).toContainText('+2')

    await expect(selectedStudent).toContainText('1コマ不可')
    await popup.getByTestId('special-session-popup-regular-only').check()
    await popup.getByRole('button', { name: '保存' }).click()

    await expect(page.getByTestId('lecture-stock-panel')).toBeVisible()
    await expect(lectureStockPanel.locator('.lecture-stock-row').filter({ hasText: selectedStudentName })).toHaveCount(0)
    await popup.close()
  })

  test('前週次週ボタンで実カレンダーに沿って週表示を切り替えられる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const currentWeekEnd = addDays(currentWeekStart, 6)
    const nextWeekStart = addDays(currentWeekStart, 7)
    const nextWeekEnd = addDays(currentWeekStart, 13)

    await page.goto('/')

    const overflowModes = await page.evaluate(() => ({
      bodyOverflowY: window.getComputedStyle(document.body).overflowY,
      gridOverflowY: window.getComputedStyle(document.querySelector('[data-testid="slot-adjust-grid"]') as HTMLElement).overflowY,
    }))

    expect(overflowModes.bodyOverflowY).toBe('auto')
    expect(overflowModes.gridOverflowY).toBe('auto')

    await expect(page.getByTestId('week-label')).toHaveText(`${toDateLabel(currentWeekStart)} - ${toDateLabel(currentWeekEnd)}`)
    await expect(page.getByTestId('prev-week-button')).toBeEnabled()
    await expect(page.getByTestId('next-week-button')).toBeEnabled()

    await page.getByTestId('next-week-button').click()

    await expect(page.getByTestId('week-label')).toHaveText(`${toDateLabel(nextWeekStart)} - ${toDateLabel(nextWeekEnd)}`)
    await expect(page.getByTestId(`day-header-${toDateKey(nextWeekStart)}`)).toContainText(toDateLabel(nextWeekStart))
    await expect(page.getByTestId(`day-header-${toDateKey(nextWeekEnd)}`)).toContainText(toDateLabel(nextWeekEnd))
    await expect(page.getByTestId('toolbar-status')).toContainText(`${toDateLabel(nextWeekStart)} 週を表示しています。`)
    await expect(page.getByTestId('prev-week-button')).toBeEnabled()
    await expect(page.getByTestId('next-week-button')).toBeEnabled()

    await page.getByTestId('prev-week-button').click()
    await expect(page.getByTestId('week-label')).toHaveText(`${toDateLabel(currentWeekStart)} - ${toDateLabel(currentWeekEnd)}`)
  })

  test('7日表示と固定ヘッダを維持しつつ生徒を正確に移動できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondayKey = toDateKey(currentWeekStart)

    await page.goto('/')

    await expect(page.getByTestId(`day-header-${mondayKey}`)).toContainText(toDateLabel(currentWeekStart))
    await expect(page.getByTestId(`day-header-${toDateKey(addDays(currentWeekStart, 6))}`)).toContainText(toDateLabel(addDays(currentWeekStart, 6)))

    const grid = page.getByTestId('slot-adjust-grid')
    const firstHeader = page.getByTestId(`day-header-${mondayKey}`)
    const headerBefore = await firstHeader.boundingBox()
    if (!headerBefore) throw new Error('headerBefore not found')

    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    const headerAfter = await firstHeader.boundingBox()
    if (!headerAfter) throw new Error('headerAfter not found')
    expect(Math.abs(headerAfter.y - headerBefore.y)).toBeLessThan(4)

    const slotId = `${mondayKey}_1`
    const sourceCell = `student-cell-${slotId}-9-0`
    const targetCell = `student-cell-${slotId}-8-1`
    const sourceName = page.getByTestId(`student-name-${slotId}-9-0`)
    const targetName = page.getByTestId(`student-name-${slotId}-8-1`)

    await addSpecialStudentToCell(page, sourceCell, '移動太郎')
    await expect(sourceName).toHaveText('移動太郎')
    await expect(targetName).toHaveText('')

    await page.getByTestId(sourceCell).click()
    await expect(page.getByTestId('student-action-menu')).toBeVisible()
    await page.getByTestId('menu-move-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('移動太郎 を選択しました。')
    await expect(page.getByTestId('cancel-selection-button')).toBeVisible()

    await page.getByTestId('cancel-selection-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('キャンセルしました。')

    await page.getByTestId(sourceCell).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(targetCell).click()

    await expect(page.getByTestId('toolbar-status')).toContainText(`移動太郎 を ${toDateLabel(currentWeekStart)} 1限 / 9机目 へ移動しました。`)
    await expect(sourceName).toHaveText('')
    await expect(targetName).toHaveText('移動太郎')
  })

  test('選択した生徒を次週へまたいで移動できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const currentSlotId = `${toDateKey(currentWeekStart)}_1`
    const nextSlotId = `${toDateKey(nextWeekStart)}_1`

    await page.goto('/')

    await addSpecialStudentToCell(page, `student-cell-${currentSlotId}-9-0`, '次週移動太郎')

    await page.getByTestId(`student-cell-${currentSlotId}-9-0`).click()
    await page.getByTestId('menu-move-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('次週移動太郎 を選択しました。')

    await page.getByTestId('next-week-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('選択中の内容をこの週へ配置できます。')

    const nextWeekTarget = page.getByTestId(`student-name-${nextSlotId}-1-1`)
    await expect(nextWeekTarget).toHaveText('')

    await page.getByTestId(`student-cell-${nextSlotId}-1-1`).click()

    await expect(page.getByTestId('toolbar-status')).toContainText('次週移動太郎 を')
    await expect(nextWeekTarget).toHaveText('次週移動太郎')

    await page.getByTestId('prev-week-button').click()
    await expect(page.getByTestId(`student-name-${currentSlotId}-9-0`)).toHaveText('')
  })

  test('元に戻すとやり直しが動く', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const sourceName = page.getByTestId(`student-name-${slotId}-9-0`)
    const targetName = page.getByTestId(`student-name-${slotId}-8-1`)

    await page.goto('/')

    await addSpecialStudentToCell(page, `student-cell-${slotId}-9-0`, 'Undo移動太郎')

    await page.getByTestId(`student-cell-${slotId}-9-0`).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(`student-cell-${slotId}-8-1`).click()
    await expect(targetName).toHaveText('Undo移動太郎')

    await page.getByTestId('undo-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('1つ前の状態に戻しました。')
    await expect(sourceName).toHaveText('Undo移動太郎')
    await expect(targetName).toHaveText('')

    await page.getByTestId('redo-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('取り消した操作をやり直しました。')
    await expect(sourceName).toHaveText('')
    await expect(targetName).toHaveText('Undo移動太郎')
  })

  test('生徒メニューから科目を編集できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const subjectDetail = page.getByTestId(`student-cell-${slotId}-0-0`).locator('.sa-student-detail')
    const expectedGrade = resolveExpectedBoardGrade('2010-05-14', currentWeekStart)

    await page.goto('/')

    await expect(subjectDetail).toContainText(expectedGrade)
    await expect(subjectDetail).toContainText('数')
    await page.getByTestId(`student-cell-${slotId}-0-0`).click()
    await page.getByTestId('menu-edit-button').click()
    await expect(page.getByTestId('menu-edit-name-input')).toHaveCount(0)
    await expect(page.getByTestId('menu-edit-name-display')).toHaveCount(0)
    await expect(page.getByTestId('menu-edit-grade-display')).toHaveCount(0)
    await expect(page.getByTestId('menu-edit-grade-select')).toHaveCount(0)
    await page.getByTestId('menu-subject-select').selectOption('社')
    await page.getByTestId('menu-edit-confirm-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('青木太郎 の情報を更新しました。')
    await expect(subjectDetail).toContainText(expectedGrade)
    await expect(subjectDetail).toContainText('社')
  })

  test('片方の生徒だけ講師区分を編集してももう一人には連動しない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await page.getByTestId(`student-cell-${slotId}-0-0`).click()
    await page.getByTestId('menu-edit-button').click()
    await page.getByTestId('menu-teacher-type-outside').click()
    await page.getByTestId('menu-edit-confirm-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('青木太郎 の情報を更新しました。')

    await page.getByText('森本陽').click()
    await page.getByTestId('menu-edit-button').click()
    await expect(page.getByTestId('menu-teacher-type-normal')).toHaveClass(/active/)
    await expect(page.getByTestId('menu-teacher-type-outside')).not.toHaveClass(/active/)
  })

  test('空欄の生徒マスから新規生徒を追加できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${slotId}-1-1`)
    const targetName = page.getByTestId(`student-name-${slotId}-1-1`)
    const targetDetail = targetCell.locator('.sa-student-detail')

    await page.goto('/')

    await expect(targetName).toHaveText('')
    await targetCell.click()
    await expect(page.getByTestId('student-action-menu')).toBeVisible()
    await expect(targetCell).toHaveClass(/sa-student-picked/)
    await page.getByTestId('menu-add-tab-new').click()
    await expect(page.getByTestId('menu-add-grade-select')).toHaveCount(0)
    await page.getByTestId('menu-add-name-input').fill('追加太郎')
    await page.getByTestId('menu-add-full-name-input').fill('追加太郎')
    await page.getByTestId('menu-add-birthdate-input').fill('2009-05-01')
    await expect(page.getByTestId('menu-add-grade-display')).toContainText('高1')
    await page.getByTestId('menu-add-subject-select').selectOption('理')
    await page.getByTestId('menu-add-lesson-type-makeup').click()
    await page.getByTestId('menu-add-teacher-type-substitute').click()
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText(`追加太郎 を ${toDateLabel(currentWeekStart)} 1限 / 2机目 に追加しました。`)
    await expect(targetName).toHaveText('追加太郎')
    await expect(targetDetail).toContainText('高1')
    await expect(targetDetail).toContainText('理')
    await expect(targetName).toHaveAttribute('title', /講師なし/)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-students').click()
    await expect(page.getByTestId('basic-data-students-table')).toContainText('追加太郎')
  })

  test('生徒追加メニューの既存候補は重複せず、新規追加は必須項目とヒントを表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${slotId}-1-1`)

    await page.goto('/')

    await targetCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    const optionTexts = await page.getByTestId('menu-add-existing-select').locator('option').allTextContents()
    expect(new Set(optionTexts).size).toBe(optionTexts.length)

    await page.getByTestId('menu-add-tab-new').click()
    await expect(page.getByTestId('menu-add-withdraw-date-input')).toHaveCount(0)
    await expect(page.getByText('未定の場合は未入力のままにしてください。')).toBeVisible()
    await page.getByTestId('menu-add-submit-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('追加する氏名を入力してください。')
    await page.getByTestId('menu-add-name-input').fill('必須確認')
    await page.getByTestId('menu-add-full-name-input').fill('必須確認')
    await page.getByTestId('menu-add-submit-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('生年月日を入力してください。')
  })

  test('空欄の生徒マスから既存生徒を追加できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${slotId}-1-1`)
    const targetName = page.getByTestId(`student-name-${slotId}-1-1`)
    const targetDetail = targetCell.locator('.sa-student-detail')

    await page.goto('/')

    await targetCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    await expect(page.getByTestId('menu-add-grade-display')).toContainText(resolveExpectedBoardGrade('2009-07-22', currentWeekStart))
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText(`上田陽介 を ${toDateLabel(currentWeekStart)} 1限 / 2机目 に追加しました。`)
    await expect(targetName).toHaveText('上田陽介')
    await expect(targetDetail).toContainText('英')
  })

  test('年度をまたぐ週ではコマ表の学年が年度基準で進級する', async ({ page }) => {
    const nextSchoolYearWeek = new Date(2026, 3, 6)
    const weekStart = getWeekStart(nextSchoolYearWeek)
    const slotId = `${toDateKey(weekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${slotId}-1-1`)
    const targetDetail = targetCell.locator('.sa-student-detail')

    await page.goto('/')
    await moveBoardToWeek(page, nextSchoolYearWeek)

    await targetCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await expect(targetDetail).toContainText(resolveExpectedBoardGrade('2009-07-22', weekStart))
  })

  test('コマ表の休日設定から通常授業の振替ストックを自動計算し、コマ表で消化できる', async ({ page }) => {
    const today = new Date()
    const mondayDates = getMonthWeekdayDates(today.getFullYear(), today.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(today))
    const [firstHoliday, secondHoliday] = mondayDates
    const currentWeekStart = getWeekStart(today)
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const targetDateKey = toDateKey(addDays(currentWeekStart, 1))
    const targetCell = page.getByTestId(`student-cell-${targetDateKey}_1-5-0`)
    const targetName = page.getByTestId(`student-name-${targetDateKey}_1-5-0`)

    test.skip(!firstHoliday || !secondHoliday, '現在月に判定用の月曜が2回以上必要です。')

    await page.goto('/')

    for (const holiday of [firstHoliday, secondHoliday]) {
      page.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await moveBoardToWeek(page, parseDateKey(holiday))
      await page.getByTestId(`day-header-${holiday}`).click()
      await expect(page.getByTestId('toolbar-status')).toContainText(`${holiday} を休日に設定しました。`)
    }

    await moveBoardToWeek(page, currentWeekStart)
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-panel')).toContainText('青木太郎')
    await expect(page.getByTestId('makeup-stock-panel')).toContainText('数')
    await expect(page.getByTestId('makeup-stock-entry-s001__-')).toContainText('+2')
    await expect(page.getByTestId('makeup-stock-entry-s001__-')).toHaveAttribute('title', /休日/)
    await page.getByTestId('makeup-stock-entry-s001__-').click()
    await targetCell.click()

    await expect(page.getByTestId('toolbar-status')).toContainText('青木太郎 の振替を')
    await expect(targetName).toHaveText('青木太郎')
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-entry-s001__-')).toContainText('+1')
  })

  test('振替元の通常授業情報はマウスオーバーで一度だけ表示される', async ({ page }) => {
    const today = new Date()
    const mondayDates = getMonthWeekdayDates(today.getFullYear(), today.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(today))
    const [firstHoliday, secondHoliday] = mondayDates
    const currentWeekStart = getWeekStart(today)
    const targetDateKey = toDateKey(addDays(currentWeekStart, 1))
    const targetCell = page.getByTestId(`student-cell-${targetDateKey}_1-5-0`)
    const targetName = page.getByTestId(`student-name-${targetDateKey}_1-5-0`)

    test.skip(!firstHoliday || !secondHoliday, '現在月に判定用の月曜が2回以上必要です。')

    await page.goto('/')

    for (const holiday of [firstHoliday, secondHoliday]) {
      page.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await moveBoardToWeek(page, parseDateKey(holiday))
      await page.getByTestId(`day-header-${holiday}`).click()
    }

    await moveBoardToWeek(page, currentWeekStart)
    await page.getByTestId('makeup-stock-chip').click()
    await page.getByTestId('makeup-stock-entry-s001__-').click()
    await targetCell.click()

    const hoverTitle = await targetName.getAttribute('title')
    expect(hoverTitle).not.toBeNull()
    expect(countOccurrences(hoverTitle ?? '', '元の通常授業:')).toBe(1)
    expect(hoverTitle ?? '').toContain('1限')
  })

  test('手入力した通常と振替は振替ストック計算に含まれず、通常は緑星を表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`
    const tuesdaySlotId = `${toDateKey(addDays(currentWeekStart, 1))}_1`
    const regularCell = page.getByTestId(`student-cell-${mondaySlotId}-1-1`)
    const makeupCell = page.getByTestId(`student-cell-${tuesdaySlotId}-1-1`)

    await page.goto('/')

    await regularCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    await page.getByTestId('menu-add-subject-select').selectOption('社')
    await page.getByTestId('menu-add-lesson-type-regular').click()
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await expect(regularCell.locator('.star-lesson-regular')).toBeVisible()

    await makeupCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    await page.getByTestId('menu-add-subject-select').selectOption('理')
    await page.getByTestId('menu-add-lesson-type-makeup').click()
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-panel')).toContainText('現在の振替ストックはありません。')
  })

  test('手動追加した生徒は注意表示になり振替できないが編集と削除はできる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${mondaySlotId}-1-1`)
    const targetName = page.getByTestId(`student-name-${mondaySlotId}-1-1`)
    const targetTeacherCell = page.getByTestId(`teacher-cell-${mondaySlotId}-1`)

    await page.goto('/')

    await targetTeacherCell.click()
    await page.getByTestId('teacher-select-input').selectOption({ label: '田中講師' })
    await page.getByTestId('teacher-select-confirm-button').click()

    // 講師を手動設定した瞬間から赤文字になる（生徒追加前）
    await expect(targetTeacherCell.locator('.sa-teacher-name')).toHaveClass(/sa-teacher-name-warning/)

    await targetCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await expect(targetName).toHaveClass(/sa-student-name-warning/)
    await expect(targetTeacherCell.locator('.sa-teacher-name')).toHaveClass(/sa-teacher-name-warning/)
    await expect(targetName).toHaveAttribute('title', /手動追加のため注意/)
    await targetCell.click()
    await expect(page.getByTestId('menu-transfer-button')).toBeDisabled()
    await expect(page.getByTestId('menu-transfer-button')).toHaveText('手動追加のため振替不可')
    await expect(page.getByTestId('menu-edit-button')).toBeEnabled()
    await expect(page.getByTestId('menu-delete-button')).toBeEnabled()
  })

  test('管理データ反映の通常授業にはヒントを出さない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await expect(page.getByTestId(`student-name-${mondaySlotId}-0-0`)).not.toHaveAttribute('title', /管理データ反映/)
  })

  test('違反赤文字は手動追加した生徒だけに反映され、隣の生徒には波及しない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`
    const manualCell = page.getByTestId(`student-cell-${mondaySlotId}-0-1`)
    const regularName = page.getByTestId(`student-name-${mondaySlotId}-0-0`)
    const manualName = page.getByTestId(`student-name-${mondaySlotId}-0-1`)

    await page.goto('/')

    await manualCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '伊藤花' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await expect(manualName).toHaveClass(/sa-student-name-warning/)
    await expect(manualName).toHaveAttribute('title', /手動追加のため注意/)
    await expect(regularName).not.toHaveClass(/sa-student-name-warning/)
    await expect(regularName).not.toHaveAttribute('title', /手動追加のため注意/)
  })

  test('定休日の日付もクリックで営業日に切り替えられる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const sunday = addDays(currentWeekStart, 6)
    const sundayKey = toDateKey(sunday)
    const sundayStudentCell = page.getByTestId(`student-cell-${sundayKey}_4-6-0`)

    await page.goto('/')

    await expect(page.getByTestId(`day-header-${sundayKey}`)).toHaveClass(/sa-day-inactive/)
    await expect(sundayStudentCell).toHaveClass(/sa-inactive/)

    await page.getByTestId(`day-header-${sundayKey}`).click()
    await expect(page.getByTestId('toolbar-status')).toContainText('定休日を解除しました')
    await expect(page.getByTestId(`day-header-${sundayKey}`)).not.toHaveClass(/sa-day-inactive/)
    await expect(sundayStudentCell).not.toHaveClass(/sa-inactive/)

    await page.getByTestId(`day-header-${sundayKey}`).click()
    await expect(page.getByTestId('toolbar-status')).toContainText('定休日に戻しました')
    await expect(page.getByTestId(`day-header-${sundayKey}`)).toHaveClass(/sa-day-inactive/)
  })

  test('休日に当たる通常授業追加はコマ表へ配置せず振替ストックへ入る', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const nextMondayKey = toDateKey(nextWeekStart)

    await page.goto('/')

    await page.getByTestId('next-week-button').click()
    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByTestId(`day-header-${nextMondayKey}`).click()
    await expect(page.getByTestId('toolbar-status')).toContainText('休日に設定しました')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))
    await page.getByTestId('basic-data-regular-draft-teacher').selectOption({ label: '田中講師' })
    await page.getByTestId('basic-data-regular-draft-student1').selectOption({ label: '伊藤花' })
    await page.getByTestId('basic-data-regular-draft-subject1').selectOption('数')
    await page.getByTestId('basic-data-regular-draft-day').selectOption('1')
    await page.getByTestId('basic-data-regular-draft-slot-number').fill('4')
    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByTestId('basic-data-add-regular-lesson-button').click()
    await navigateFromBasicDataToBoard(page)

    await expect(page.getByTestId(`student-name-${nextMondayKey}_4-0-0`)).toHaveCount(0)
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-entry-s002__-')).toContainText('+1')
  })

  test('振替は削除せず振替ストックに積まれる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const sourceName = page.getByTestId(`student-name-${slotId}-0-0`)

    await page.goto('/')

    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替ストック')
    await page.getByTestId(`student-cell-${slotId}-0-0`).click()
    await page.getByTestId('menu-transfer-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('振替ストックへ回しました。振替ストックから配置できます。')
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('1')
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-panel')).toContainText('青木太郎')
    await expect(sourceName).toHaveText('')
  })

  test('削除は確認メッセージを出し振替ストックに加算しない', async ({ page }) => {
    const sourceName = page.getByTestId('slot-adjust-grid').getByText('森本陽')
    let confirmMessage = ''

    page.once('dialog', async (dialog) => {
      confirmMessage = dialog.message()
      await dialog.accept()
    })

    await page.goto('/')

    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替ストック')
    await sourceName.click()
    await page.getByTestId('menu-delete-button').click()

    expect(confirmMessage).toContain('削除は振替ストックにカウントされません')
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-panel')).toContainText('現在の振替ストックはありません。')
    await expect(sourceName).toHaveCount(0)
  })

  test('詰めて並び替えで埋まっている机が上へ寄る', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const tuesdayKey = toDateKey(addDays(currentWeekStart, 1))
    const targetCell = page.getByTestId(`student-cell-${tuesdayKey}_1-7-0`)
    const sourceStudent = page.getByTestId(`student-name-${tuesdayKey}_1-7-0`)
    const packedStudent = page.getByTestId(`student-name-${tuesdayKey}_1-0-0`)

    await page.goto('/')

    await targetCell.click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await expect(sourceStudent).toHaveText('上田陽介')
    await expect(packedStudent).toHaveText('')

    await page.getByTestId('pack-sort-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('埋まっている机を上に詰めて並び替えました。')
    await expect(packedStudent).toHaveText('上田陽介')
    await expect(sourceStudent).toHaveText('')
  })

  test('振替ストックの表示はコマ表操作後も開いたまま残る', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()

    await page.getByTestId('pack-sort-button').click()

    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
  })

  test('詰めて並び替えは生徒数優先で、同数なら講師名順に並ぶ', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const tuesdayKey = toDateKey(addDays(currentWeekStart, 1))
    const slotId = `${tuesdayKey}_1`
    const findDeskIndexByStudent = async (studentName: string) => {
      for (let deskIndex = 0; deskIndex < 10; deskIndex += 1) {
        const firstName = await page.getByTestId(`student-name-${slotId}-${deskIndex}-0`).textContent()
        const secondName = await page.getByTestId(`student-name-${slotId}-${deskIndex}-1`).textContent()
        if (firstName === studentName || secondName === studentName) {
          return deskIndex
        }
      }
      throw new Error(`${studentName} not found`)
    }

    await page.goto('/')

    await page.getByTestId(`student-cell-${slotId}-7-0`).click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await page.getByTestId(`student-cell-${slotId}-7-1`).click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '伊藤花' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await page.getByTestId(`student-cell-${slotId}-5-0`).click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '岡本美咲' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await page.getByTestId('pack-sort-button').click()

    await expect(page.getByTestId(`student-name-${slotId}-0-0`)).toHaveText('上田陽介')
    await expect(page.getByTestId(`student-name-${slotId}-0-1`)).toHaveText('伊藤花')
    const uedaDesk = await findDeskIndexByStudent('上田陽介')
    const itoDesk = await findDeskIndexByStudent('伊藤花')
    const okamotoDesk = await findDeskIndexByStudent('岡本美咲')

    expect(uedaDesk).toBe(itoDesk)
    expect(uedaDesk).toBeLessThan(okamotoDesk)
  })

  test('詰めて並び替えは表示中の週だけに反映される', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const currentTuesdayKey = toDateKey(addDays(currentWeekStart, 1))
    const nextTuesdayKey = toDateKey(addDays(nextWeekStart, 1))
    const nextWeekSource = page.getByTestId(`student-name-${nextTuesdayKey}_1-7-0`)
    const nextWeekPacked = page.getByTestId(`student-name-${nextTuesdayKey}_1-0-0`)

    await page.goto('/')

    await page.getByTestId('next-week-button').click()
    await page.getByTestId(`student-cell-${nextTuesdayKey}_1-7-0`).click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '上田陽介' })
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()
    await expect(nextWeekSource).toHaveText('上田陽介')

    await page.getByTestId('prev-week-button').click()
    await expect(page.getByTestId(`day-header-${currentTuesdayKey}`)).toBeVisible()
    await page.getByTestId('pack-sort-button').click()

    await page.getByTestId('next-week-button').click()
    await expect(nextWeekSource).toHaveText('上田陽介')
    await expect(nextWeekPacked).toHaveText('')
  })

  test('生徒メニューは通常授業と振替授業なら振替、特別講習なら移動を表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const specialSlotId = `${toDateKey(addDays(currentWeekStart, 1))}_1`
    const mondayDates = getMonthWeekdayDates(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(new Date()))
    const [firstHoliday, secondHoliday] = mondayDates

    test.skip(!firstHoliday || !secondHoliday, '現在月に判定用の月曜が2回以上必要です。')

    await page.goto('/')

    await page.getByTestId(`student-cell-${slotId}-0-0`).click()
    let menuButtons = await page.locator('[data-testid="student-action-menu"] .menu-link-button').allTextContents()
    expect(menuButtons).toEqual(['振替', '編集', '削除'])

    for (const holiday of [firstHoliday, secondHoliday]) {
      page.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await moveBoardToWeek(page, parseDateKey(holiday))
      await page.getByTestId(`day-header-${holiday}`).click()
    }

    await moveBoardToWeek(page, currentWeekStart)
    await page.getByTestId('makeup-stock-chip').click()
    await page.getByTestId('makeup-stock-entry-s001__-').click()
    await page.getByTestId(`student-cell-${toDateKey(addDays(currentWeekStart, 1))}_1-5-0`).click()
    await page.getByTestId(`student-cell-${toDateKey(addDays(currentWeekStart, 1))}_1-5-0`).click()
    menuButtons = await page.locator('[data-testid="student-action-menu"] .menu-link-button').allTextContents()
    expect(menuButtons).toEqual(['振替', '編集', '削除'])
    await page.getByRole('button', { name: 'x' }).click()

    const emptyCellTestId = await findFirstEmptyStudentCellTestId(page, specialSlotId)
    await addSpecialStudentToCell(page, emptyCellTestId, 'メニュー確認太郎')
    await page.getByTestId(emptyCellTestId).click()
    menuButtons = await page.locator('[data-testid="student-action-menu"] .menu-link-button').allTextContents()
    expect(menuButtons).toEqual(['移動', '編集', '削除'])
  })

  test('振替授業も振替操作で再度振替ストックへ戻せる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const tuesdayKey = toDateKey(addDays(currentWeekStart, 1))
    const targetCell = page.getByTestId(`student-cell-${tuesdayKey}_1-5-0`)
    const targetName = page.getByTestId(`student-name-${tuesdayKey}_1-5-0`)
    const mondayDates = getMonthWeekdayDates(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(new Date()))
    const [firstHoliday, secondHoliday] = mondayDates

    test.skip(!firstHoliday || !secondHoliday, '現在月に判定用の月曜が2回以上必要です。')

    await page.goto('/')

    for (const holiday of [firstHoliday, secondHoliday]) {
      page.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await moveBoardToWeek(page, parseDateKey(holiday))
      await page.getByTestId(`day-header-${holiday}`).click()
    }

    await moveBoardToWeek(page, currentWeekStart)
    await page.getByTestId('makeup-stock-chip').click()
    const initialBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    await page.getByTestId('makeup-stock-entry-s001__-').click()
    await targetCell.click()
    await expect(targetName).toHaveText('青木太郎')

    await page.getByTestId('makeup-stock-chip').click()
    const afterPlacementBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    expect(afterPlacementBalance).toBe(initialBalance - 1)
    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替移動中')
    await page.getByTestId('cancel-selection-button').click()

    await targetCell.click()
    await expect(page.getByTestId('menu-transfer-button')).toHaveText('振替')
    await page.getByTestId('menu-transfer-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('振替ストックへ回しました。')
    await expect(targetName).toHaveText('')
    await page.getByTestId('makeup-stock-chip').click()
    const afterReturnBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    expect(afterReturnBalance).toBe(initialBalance)
  })

  test('同コマに同生徒がいる場合は振替不可で振替中状態を維持する', async ({ page }) => {
    const today = new Date()
    const mondayDates = getMonthWeekdayDates(today.getFullYear(), today.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(today))
    const [firstHoliday, secondHoliday] = mondayDates
    const currentWeekStart = getWeekStart(today)
    const currentMondayKey = toDateKey(currentWeekStart)
    const targetDateKey = toDateKey(addDays(currentWeekStart, 1))
    const blockerCell = page.getByTestId(`student-cell-${targetDateKey}_1-6-0`)
    const duplicateTarget = page.getByTestId(`student-cell-${targetDateKey}_1-5-0`)
    const validTarget = page.getByTestId(`student-cell-${toDateKey(addDays(currentWeekStart, 2))}_1-5-0`)
    const validName = page.getByTestId(`student-name-${toDateKey(addDays(currentWeekStart, 2))}_1-5-0`)

    test.skip(!firstHoliday || !secondHoliday, '現在月に判定用の月曜が2回以上必要です。')

    await page.goto('/')

    for (const holiday of [firstHoliday, secondHoliday]) {
      page.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await moveBoardToWeek(page, parseDateKey(holiday))
      await page.getByTestId(`day-header-${holiday}`).click()
    }

    await moveBoardToWeek(page, currentWeekStart)
  await blockerCell.click()
  await page.getByTestId('menu-add-tab-existing').click()
  await page.getByTestId('menu-add-existing-select').selectOption({ label: '青木太郎' })
  acceptNextDialog(page, '追加は振替ストックにカウントされません')
  await page.getByTestId('menu-add-submit-button').click()

    await page.getByTestId('makeup-stock-chip').click()
    await page.getByTestId('makeup-stock-entry-s001__-').click()
    await duplicateTarget.click()

    await expect(page.getByTestId('toolbar-status')).toContainText('同コマにすでに青木太郎が組まれているため振替不可です。')
    await expect(page.getByTestId('center-status-banner')).toContainText('同コマにすでに青木太郎が組まれているため振替不可です。')
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替移動中')
    await expect(page.getByTestId('cancel-selection-button')).toBeVisible()
    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()

    await validTarget.click()
    await expect(page.getByTestId('toolbar-status')).toContainText('青木太郎 の振替を')
    await expect(validName).toHaveText('青木太郎')
  })

  test('同コマに同生徒がいる場合は移動不可で移動中状態を維持する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`
    const tuesdaySlotId = `${toDateKey(addDays(currentWeekStart, 1))}_1`
    const sourceCell = `student-cell-${mondaySlotId}-9-0`
    const duplicateCell = `student-cell-${mondaySlotId}-8-0`
    const blockedTarget = page.getByTestId(`student-cell-${mondaySlotId}-7-1`)
    const validTarget = page.getByTestId(`student-cell-${tuesdaySlotId}-7-1`)
    const validName = page.getByTestId(`student-name-${tuesdaySlotId}-7-1`)

    await page.goto('/')

    await addSpecialStudentToCell(page, sourceCell, '移動重複太郎')
    await addSpecialStudentToCell(page, duplicateCell, '移動重複太郎')

    await page.getByTestId(sourceCell).click()
    await page.getByTestId('menu-move-button').click()
    await blockedTarget.click()

    await expect(page.getByTestId('toolbar-status')).toContainText('同コマにすでに移動重複太郎が組まれているため移動不可です。')
    await expect(page.getByTestId('cancel-selection-button')).toBeVisible()

    await validTarget.click()
    await expect(page.getByTestId('toolbar-status')).toContainText('移動重複太郎 を')
    await expect(validName).toHaveText('移動重複太郎')
  })

  test('通常授業の重複は追加できず重複文言で案内される', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))
    await page.getByTestId('basic-data-regular-draft-teacher').selectOption({ label: '田中講師' })
    await page.getByTestId('basic-data-regular-draft-student1').selectOption({ label: '青木太郎' })
    await page.getByTestId('basic-data-regular-draft-subject1').selectOption('数')
    await page.getByTestId('basic-data-regular-draft-day').selectOption('1')
    await page.getByTestId('basic-data-regular-draft-slot-number').fill('1')

    let duplicateDialogMessage = ''
    page.once('dialog', async (dialog) => {
      duplicateDialogMessage = dialog.message()
      await dialog.accept()
    })
    await page.getByTestId('basic-data-add-regular-lesson-button').click()
    expect(duplicateDialogMessage).toContain('重複があるため通常授業を追加できません。')
    expect(duplicateDialogMessage).toContain('講師重複')
    expect(duplicateDialogMessage).toContain('生徒重複')

    await expect(page.getByTestId('basic-data-status')).toContainText('重複があるため通常授業を追加できませんでした。')
  })

  test('通常授業は期間が重複しなければ同じコマの同講師と同生徒でも追加でき、表示と振替計算が崩れない', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const currentWeekStart = getWeekStart(new Date())
    const currentMondayKey = toDateKey(currentWeekStart)
    const previousDayKey = toDateKey(addDays(currentWeekStart, -1))
    const mondaySlotId = `${currentMondayKey}_1`

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))

    const existingRow = page.getByTestId('basic-data-regular-lessons-table').locator('tbody tr')
      .filter({ hasText: '田中講師' })
      .filter({ hasText: '青木太郎' })
      .filter({ hasText: '月曜' })
      .filter({ hasText: '1限' })
      .first()
    const rowTestId = await existingRow.getAttribute('data-testid')
    const rowId = rowTestId?.replace('basic-data-regular-row-', '')
    if (!rowId) throw new Error('regular lesson row id not found')

    await existingRow.getByRole('button', { name: '編集' }).click()
    const editableExistingRow = page.getByTestId(`basic-data-regular-row-${rowId}`)
    await setHiddenDateInput(page, `basic-data-regular-period-end-${rowId}-input`, previousDayKey)
    await editableExistingRow.getByRole('button', { name: '編集終了' }).click()

    await page.getByTestId('basic-data-regular-draft-teacher').selectOption({ label: '田中講師' })
    await page.getByTestId('basic-data-regular-draft-student1').selectOption({ label: '青木太郎' })
    await page.getByTestId('basic-data-regular-draft-subject1').selectOption('数')
    await page.getByTestId('basic-data-regular-draft-day').selectOption('1')
    await page.getByTestId('basic-data-regular-draft-slot-number').fill('1')
    await setHiddenDateInput(page, 'basic-data-regular-draft-start-input', currentMondayKey)

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByTestId('basic-data-add-regular-lesson-button').click()
    await expect(page.getByTestId('basic-data-status')).toContainText('通常授業を追加しました。')

    await navigateFromBasicDataToBoard(page)
    await expect(page.getByTestId(`student-name-${mondaySlotId}-0-0`)).toHaveText('青木太郎')

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByTestId(`day-header-${currentMondayKey}`).click()
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-entry-s001__-')).toContainText('+1')
  })

  test('別枠で埋まっているコマに反映できない通常授業は振替ストックへ入る', async () => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const currentWeekStart = getWeekStart(new Date())
    const currentMondayKey = toDateKey(currentWeekStart)

    const entries = buildMakeupStockEntries({
      students: [
        {
          id: 'stock-student',
          name: 'ストック検証生徒',
          displayName: 'ストック検証生徒',
          email: 'stock-student@example.com',
          entryDate: '2024-04-01',
          withdrawDate: '未定',
          birthDate: '2011-04-10',
          isHidden: false,
        },
      ],
      teachers: [
        {
          id: 'stock-teacher',
          name: 'ストック検証講師',
          email: 'stock-teacher@example.com',
          entryDate: '2024-04-01',
          withdrawDate: '未定',
          isHidden: false,
          subjectCapabilities: [{ subject: '英', maxGrade: '高3' }],
          memo: '',
        },
      ],
      regularLessons: [
        {
          id: 'stock-lesson',
          schoolYear: currentSchoolYear,
          teacherId: 'stock-teacher',
          student1Id: 'stock-student',
          subject1: '英',
          startDate: '',
          endDate: '',
          student2Id: '',
          subject2: '',
          student2StartDate: '',
          student2EndDate: '',
          nextStudent1Id: '',
          nextSubject1: '',
          nextStudent2Id: '',
          nextSubject2: '',
          dayOfWeek: 1,
          slotNumber: 5,
        },
      ],
      classroomSettings: {
        closedWeekdays: [0],
        holidayDates: [],
        forceOpenDates: [],
        deskCount: 1,
      },
      weeks: [[
        {
          id: `${currentMondayKey}_5`,
          dateKey: currentMondayKey,
          dayLabel: '月',
          dateLabel: `${Number(currentMondayKey.slice(5, 7))}/${Number(currentMondayKey.slice(8, 10))}`,
          slotLabel: '5限',
          slotNumber: 5,
          timeLabel: '19:40-21:10',
          isOpenDay: true,
          desks: [
            {
              id: `${currentMondayKey}_5_desk_1`,
              teacher: '別枠講師',
              lesson: {
                id: 'occupied-special',
                note: '特別講習',
                studentSlots: [
                  {
                    id: 'occupied-student',
                    name: '別枠埋まり生徒',
                    grade: '中2',
                    subject: '数',
                    lessonType: 'special',
                    teacherType: 'normal',
                  },
                  null,
                ],
              },
            },
          ],
        },
      ]],
      manualAdjustments: {},
      resolveStudentKey: (student) => student.id,
    })

    const stockEntry = entries.find((entry) => entry.studentId === 'stock-student' && entry.subject === '英')
    expect(stockEntry).toBeTruthy()
    expect(stockEntry?.autoShortage).toBe(1)
    expect(stockEntry?.remainingOriginDates).toEqual([currentMondayKey])
    expect(stockEntry?.balance).toBe(1)
  })

  test('PDF出力ボタンが表示される', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('board-student-schedule-button')).toBeVisible()
    await expect(page.getByTestId('board-teacher-schedule-button')).toBeVisible()
    await expect(page.getByTestId('board-print-pdf-button')).toBeVisible()
  })

  test('生徒日程をポップアップで開いて期間変更UIを表示できる', async ({ page }) => {
    await page.goto('/')

    const studentScheduleButton = page.getByTestId('board-student-schedule-button')
    const popupPromise = page.waitForEvent('popup')
    await studentScheduleButton.click()
    const popup = await popupPromise

    await expect(studentScheduleButton).toBeDisabled()
    await expect(studentScheduleButton).toHaveText('生徒日程は別タブで表示中')
    await expect(popup.locator('.toolbar-title')).toHaveText('生徒日程表')
    await expect(popup.locator('#schedule-start-date')).toBeVisible()
    await expect(popup.locator('#schedule-end-date')).toBeVisible()
    await expect(popup.locator('#schedule-apply-button')).toHaveCount(0)
    await expect(popup.locator('#schedule-period-select')).toBeVisible()
    await expect(popup.locator('#schedule-summary-label')).toContainText('表示中:')
    await expect(popup.locator('.sheet').first()).toBeVisible()
  })

  test('講師日程をポップアップで開いて生徒日程と同じ期間変更UIを表示できる', async ({ page }) => {
    await page.goto('/')

    const teacherScheduleButton = page.getByTestId('board-teacher-schedule-button')
    const popupPromise = page.waitForEvent('popup')
    await teacherScheduleButton.click()
    const popup = await popupPromise

    await expect(teacherScheduleButton).toBeDisabled()
    await expect(teacherScheduleButton).toHaveText('講師日程は別タブで表示中')
    await expect(popup.locator('.toolbar-title')).toHaveText('講師日程表')
    await expect(popup.locator('#schedule-start-date')).toBeVisible()
    await expect(popup.locator('#schedule-end-date')).toBeVisible()
    await expect(popup.locator('#schedule-apply-button')).toHaveCount(0)
    await expect(popup.locator('#schedule-period-select')).toBeVisible()
    await expect(popup.locator('#schedule-summary-label')).toContainText('表示中:')
    await expect(popup.locator('.sheet').first()).toBeVisible()
  })

  test('生徒日程は遠い期間も管理データ基準で生成し、開いたまま通常授業追加を反映できる', async ({ page }) => {
    const targetWeekStart = addDays(getWeekStart(new Date()), 28)
    const targetStartKey = toDateKey(targetWeekStart)
    const targetEndKey = toDateKey(addDays(targetWeekStart, 6))
    const targetSchoolYear = resolveOperationalSchoolYear(targetWeekStart)
    const activeEntryDate = '2024-04-01'

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()

    await page.getByTestId('basic-data-tab-teachers').click()
    await page.getByTestId('basic-data-teacher-draft-name').fill('日程反映E2E講師')
    await page.getByTestId('basic-data-teacher-draft-email').fill('schedule-sync-teacher@example.com')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', activeEntryDate)
    await page.getByTestId('basic-data-add-teacher-button').click()

    await page.getByTestId('basic-data-tab-students').click()
    await page.getByTestId('basic-data-student-draft-name').fill('日程反映E2E生徒')
    await page.getByTestId('basic-data-student-draft-display-name').fill('日程反映E2E生徒')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', activeEntryDate)
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2012-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await navigateFromBasicDataToBoard(page)

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, targetStartKey, targetEndKey)
    await expect(popup.locator('#schedule-start-date')).toHaveValue(targetStartKey)
    await expect(popup.locator('#schedule-end-date')).toHaveValue(targetEndKey)
    await expect(popup.locator('#schedule-summary-label')).toContainText(`${targetWeekStart.getMonth() + 1}月${targetWeekStart.getDate()}日`)

    const existingManagedSheet = popup.locator('section.sheet').filter({ hasText: '青木太郎' }).first()
    await expect(existingManagedSheet).toContainText('数')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(targetSchoolYear))

    await addRegularLessonDraft(page, {
      teacher: '日程反映E2E講師',
      student1: '日程反映E2E生徒',
      subject1: '英',
      dayOfWeek: '2',
      slotNumber: '5',
    })

    const newStudentSheet = popup.locator('section.sheet').filter({ hasText: '日程反映E2E生徒' }).first()
    await expect(newStudentSheet).toContainText('英')
  })

  test('通常授業データの編集もコマ表と開いた生徒日程へ反映される', async ({ page }) => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const currentMondayKey = toDateKey(currentWeekStart)
    const nextTuesdayKey = toDateKey(addDays(nextWeekStart, 1))

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise
    await setScheduleRangeInPopup(popup, nextTuesdayKey, nextTuesdayKey)
    await expect(popup.locator('#schedule-summary-label')).toContainText(`${nextWeekStart.getMonth() + 1}月${nextWeekStart.getDate() + 1}日`)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-regularLessons').click()
    await page.getByTestId('basic-data-regular-year-select').selectOption(String(currentSchoolYear))

    const existingRow = page.getByTestId('basic-data-regular-lessons-table').locator('tbody tr').filter({ hasText: '青木太郎' }).filter({ hasText: '月曜' }).filter({ hasText: '1限' }).first()
    const rowTestId = await existingRow.getAttribute('data-testid')
    const rowId = rowTestId?.replace('basic-data-regular-row-', '')
    if (!rowId) throw new Error('regular lesson row id not found')

    const editableRow = page.getByTestId(`basic-data-regular-row-${rowId}`)
    await editableRow.getByRole('button', { name: '編集' }).click()
    await editableRow.locator('select').nth(5).selectOption('2')
    await editableRow.locator('input[type="number"]').fill('4')
    await editableRow.getByRole('button', { name: '編集終了' }).click()
    await expect(page.getByTestId('basic-data-status')).toContainText('通常授業を更新しました。')

    await navigateFromBasicDataToBoard(page)

    await expect.poll(() => hasStudentInSlot(page, currentMondayKey, 1, '青木太郎')).toBe(false)
    await moveBoardToWeek(page, nextWeekStart)
    await expect.poll(() => hasStudentInSlot(page, nextTuesdayKey, 4, '青木太郎')).toBe(true)

    const studentSheet = popup.locator('section.sheet').filter({ hasText: '青木' }).first()
    await expect(studentSheet).toContainText('数')
    await expect(popup.locator('#schedule-summary-label')).toContainText(`${nextWeekStart.getMonth() + 1}月${nextWeekStart.getDate() + 1}日`)
  })

  test('生徒日程の講習期間セレクターは開始日順で並び、選択と日付入力で即反映される', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    const options = await popup.locator('#schedule-period-select option').allTextContents()
    expect(options).toEqual([
      '選択してください',
      '2026 新年度準備講座 (3月23日 - 4月5日)',
      '2026 定期試験対策 (5月18日 - 6月5日)',
      '2026 夏期講習 (7月21日 - 8月28日)',
      '2026 冬期講習 (12月24日 - 1月7日)',
    ])

    await popup.locator('#schedule-period-select').selectOption({ label: '2026 定期試験対策 (5月18日 - 6月5日)' })
    await expect(popup.locator('#schedule-start-date')).toHaveValue('2026-05-18')
    await expect(popup.locator('#schedule-end-date')).toHaveValue('2026-06-05')
    await expect(popup.locator('#schedule-summary-label')).toContainText('5月18日 ～ 6月5日')
    await expect.poll(async () => popup.locator('.holiday-col').count()).toBeGreaterThan(0)

    await popup.locator('#schedule-end-date').fill('2026-08-28')
    await expect(popup.locator('#schedule-summary-label')).toContainText('5月18日 ～ 8月28日')
    await popup.locator('#schedule-start-date').fill('2026-07-21')
    await expect(popup.locator('#schedule-summary-label')).toContainText('7月21日 ～ 8月28日')
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('schedule-shared:student:range:start'))).toBe('2026-07-21')
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('schedule-shared:student:range:end'))).toBe('2026-08-28')

    await popup.close()
    await expect.poll(async () => await page.getByTestId('board-student-schedule-button').isDisabled()).toBe(false)

    const reopenPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const reopenedPopup = await reopenPromise
    const reopenedState = await reopenedPopup.evaluate(() => {
      const payload = JSON.parse(document.getElementById('schedule-data')?.textContent || '{}')
      return {
        defaultStartDate: payload.defaultStartDate ?? null,
        defaultEndDate: payload.defaultEndDate ?? null,
        availableStartDate: payload.availableStartDate ?? null,
        availableEndDate: payload.availableEndDate ?? null,
        storedStartDate: window.localStorage.getItem('schedule-shared:student:range:start'),
        storedEndDate: window.localStorage.getItem('schedule-shared:student:range:end'),
        currentStartDate: (document.getElementById('schedule-start-date') as HTMLInputElement | null)?.value ?? null,
        currentEndDate: (document.getElementById('schedule-end-date') as HTMLInputElement | null)?.value ?? null,
      }
    })
    expect(reopenedState).toEqual(expect.objectContaining({
      defaultStartDate: '2026-07-21',
      defaultEndDate: '2026-08-28',
      storedStartDate: '2026-07-21',
      storedEndDate: '2026-08-28',
    }))
    await expect(reopenedPopup.locator('#schedule-start-date')).toHaveValue('2026-07-21')
    await expect(reopenedPopup.locator('#schedule-end-date')).toHaveValue('2026-08-28')
  })

  test('講師日程の講習期間セレクターは開始日順で並び、選択と日付入力で即反映される', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-teacher-schedule-button').click()
    const popup = await popupPromise

    const options = await popup.locator('#schedule-period-select option').allTextContents()
    expect(options).toEqual([
      '選択してください',
      '2026 新年度準備講座 (3月23日 - 4月5日)',
      '2026 定期試験対策 (5月18日 - 6月5日)',
      '2026 夏期講習 (7月21日 - 8月28日)',
      '2026 冬期講習 (12月24日 - 1月7日)',
    ])

    await popup.locator('#schedule-period-select').selectOption({ label: '2026 定期試験対策 (5月18日 - 6月5日)' })
    await expect(popup.locator('#schedule-start-date')).toHaveValue('2026-05-18')
    await expect(popup.locator('#schedule-end-date')).toHaveValue('2026-06-05')
    await expect(popup.locator('#schedule-summary-label')).toContainText('5月18日 ～ 6月5日')
    await expect.poll(async () => popup.locator('.holiday-col').count()).toBeGreaterThan(0)

    await popup.locator('#schedule-end-date').fill('2026-08-28')
    await expect(popup.locator('#schedule-summary-label')).toContainText('5月18日 ～ 8月28日')
    await popup.locator('#schedule-start-date').fill('2026-07-21')
    await expect(popup.locator('#schedule-summary-label')).toContainText('7月21日 ～ 8月28日')
  })

  test('講師日程は生徒名と科目と授業区分だけを表示し振替欄は空欄のまま', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await page.getByTestId(`teacher-cell-${mondaySlotId}-9`).click()
    await page.getByTestId('teacher-select-input').selectOption({ label: '田中講師' })
    await page.getByTestId('teacher-select-confirm-button').click()

    await page.getByTestId(`student-cell-${mondaySlotId}-9-0`).click()
    await page.getByTestId('menu-add-tab-existing').click()
    await page.getByTestId('menu-add-existing-select').selectOption({ label: '斎藤由奈' })
    await page.getByTestId('menu-add-subject-select').selectOption('英')
    acceptNextDialog(page, '追加は振替ストックにカウントされません')
    await page.getByTestId('menu-add-submit-button').click()

    await page.getByTestId(`student-cell-${mondaySlotId}-9-0`).click()
    await page.getByTestId('menu-edit-button').click()
    await page.getByTestId('menu-teacher-type-substitute').click()
    await page.getByTestId('menu-edit-confirm-button').click()

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-teacher-schedule-button').click()
    const popup = await popupPromise
    const targetSheet = popup.locator('section.sheet').filter({ hasText: '田中講師' }).first()

    await expect(targetSheet).toContainText('斎藤由奈')
    await expect(targetSheet).toContainText('英')
    await expect(targetSheet).toContainText('通常(代行)')
    await expect.poll(async () => targetSheet.locator('.makeup-table').evaluate((element) => (element.textContent ?? '').trim())).toBe('')
  })

  test('振替作業中に振替ストックは閉じず連続操作できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondayDates = getMonthWeekdayDates(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(new Date()))
    const [firstHoliday, secondHoliday] = mondayDates
    const targetCell = page.getByTestId(`student-cell-${toDateKey(addDays(currentWeekStart, 1))}_1-5-0`)

    test.skip(!firstHoliday || !secondHoliday, '現在月に判定用の月曜が2回以上必要です。')

    await page.goto('/')

    for (const holiday of [firstHoliday, secondHoliday]) {
      page.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await moveBoardToWeek(page, parseDateKey(holiday))
      await page.getByTestId(`day-header-${holiday}`).click()
    }

    await moveBoardToWeek(page, currentWeekStart)
    await page.getByTestId('makeup-stock-chip').click()
    await page.getByTestId('makeup-stock-entry-s001__-').click()

    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替移動中')

    await targetCell.click()

    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替移動中')
  })

  test('開いた生徒日程はコマ表の休日変更に追従する', async ({ page }) => {
    await page.goto('/')

    const currentWeekStart = getWeekStart(new Date())
    const currentMondayKey = toDateKey(currentWeekStart)

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    const holidayCountBefore = await popup.locator('.slot-cell.is-holiday').count()

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByTestId(`day-header-${currentMondayKey}`).click()

    await expect.poll(async () => popup.locator('.slot-cell.is-holiday').count()).toBeGreaterThan(holidayCountBefore)
  })

  test('生徒日程は最新状態に更新ボタンで再描画できる', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await expect(popup.locator('#schedule-refresh-button')).toBeVisible()
    await popup.evaluate(() => {
      const pages = document.getElementById('schedule-pages')
      if (pages) pages.innerHTML = '<div id="broken-schedule">broken</div>'
    })
    await expect(popup.locator('#broken-schedule')).toBeVisible()

    await popup.locator('#schedule-refresh-button').click()
    await expect(popup.locator('#broken-schedule')).toHaveCount(0)
    await expect(popup.locator('section.sheet').first()).toBeVisible()
  })

  test('休校セルには手入力で生徒追加できない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const currentMondayKey = toDateKey(currentWeekStart)
    const targetCell = page.getByTestId(`student-cell-${currentMondayKey}_1-1-1`)

    await page.goto('/')

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.getByTestId(`day-header-${currentMondayKey}`).click()

    await targetCell.click()

    await expect(page.getByTestId('toolbar-status')).toContainText('休校セルには手入力で生徒を追加できません。')
    await expect(page.getByTestId('student-action-menu')).toHaveCount(0)
  })
})