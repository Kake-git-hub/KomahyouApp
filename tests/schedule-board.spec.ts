import { expect, test } from '@playwright/test'
import { buildMakeupStockEntries } from '../src/components/schedule-board/makeupStock'

const REFERENCE_TODAY_ISO = '2026-03-23T09:00:00+09:00'
const RealDate = Date

class FixedDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor>) {
    if (args.length === 0) {
      super(REFERENCE_TODAY_ISO)
      return
    }

    super(...args)
  }

  static now() {
    return new RealDate(REFERENCE_TODAY_ISO).getTime()
  }

  static parse(dateString: string) {
    return RealDate.parse(dateString)
  }

  static UTC(...args: Parameters<typeof Date.UTC>) {
    return RealDate.UTC(...args)
  }
}

Object.setPrototypeOf(FixedDate, RealDate)
globalThis.Date = FixedDate as DateConstructor

test.beforeEach(async ({ page }) => {
  await page.addInitScript((referenceIso) => {
    const fixedTime = new Date(referenceIso).getTime()
    const BrowserRealDate = Date

    class BrowserFixedDate extends BrowserRealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(fixedTime)
          return
        }

        super(...args)
      }

      static now() {
        return fixedTime
      }

      static parse(dateString) {
        return BrowserRealDate.parse(dateString)
      }

      static UTC(...args) {
        return BrowserRealDate.UTC(...args)
      }
    }

    Object.setPrototypeOf(BrowserFixedDate, BrowserRealDate)
    window.Date = BrowserFixedDate
  }, REFERENCE_TODAY_ISO)
})

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

async function navigateFromAutoAssignRulesToBoard(page: Parameters<typeof test>[0]['page']) {
  await page.getByTestId('auto-assign-rules-menu-button').click()
  await page.getByTestId('auto-assign-rules-menu-open-board-button').click()
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

async function restoreBoardInteraction(page: Parameters<typeof test>[0]['page']) {
  await page.getByTestId('toolbar-status').click()
}

async function ensureLectureStockPanelVisible(page: Parameters<typeof test>[0]['page']) {
  await page.bringToFront()
  const panel = page.getByTestId('lecture-stock-panel')
  if (await panel.isVisible().catch(() => false)) return
  await restoreBoardInteraction(page)
  await page.getByTestId('lecture-stock-chip').evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
  await expect(panel).toBeVisible()
}

async function saveMemoToCell(
  page: Parameters<typeof test>[0]['page'],
  cellTestId: string,
  memo: string,
) {
  await page.getByTestId(cellTestId).evaluate((element) => {
    ;(element as HTMLElement).click()
  })
  if (await page.getByTestId('menu-open-memo-button').count()) {
    await page.getByTestId('menu-open-memo-button').click()
  }
  await page.getByTestId('menu-memo-textarea').fill(memo)
  await page.getByTestId('menu-memo-save-button').click()
}

async function openStockActionModal(page: Parameters<typeof test>[0]['page'], entryTestId: string) {
  await page.getByTestId(entryTestId).click()
  await expect(page.getByTestId('stock-action-modal')).toBeVisible()
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

async function findEmptyStudentCellTestIds(page: Parameters<typeof test>[0]['page'], slotId: string, count: number) {
  const results: string[] = []

  for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
    for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
      const nameLocator = page.getByTestId(`student-name-${slotId}-${deskIndex}-${studentIndex}`)
      if (await nameLocator.count() === 0) continue
      const text = await nameLocator.textContent()
      if ((text ?? '').trim() !== '') continue
      results.push(`student-cell-${slotId}-${deskIndex}-${studentIndex}`)
      if (results.length >= count) return results
    }
  }

  throw new Error(`empty student cells not found for ${slotId}: required ${count}, found ${results.length}`)
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
      if ((text ?? '').startsWith(studentName)) return true
    }
  }

  return false
}

async function hasTeacherInSlot(
  page: Parameters<typeof test>[0]['page'],
  dateKey: string,
  slotNumber: number,
  teacherName: string,
) {
  for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
    const locator = page.getByTestId(`teacher-cell-${dateKey}_${slotNumber}-${deskIndex}`)
    if (await locator.count() === 0) continue
    const text = ((await locator.textContent()) ?? '').trim()
    if (text.includes(teacherName)) return true
  }

  return false
}

async function countTeacherAssignmentsByDate(
  page: Parameters<typeof test>[0]['page'],
  dateKey: string,
  teacherName: string,
) {
  let count = 0

  for (let slotNumber = 1; slotNumber <= 5; slotNumber += 1) {
    for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
      const locator = page.getByTestId(`teacher-cell-${dateKey}_${slotNumber}-${deskIndex}`)
      if (await locator.count() === 0) continue
      const text = ((await locator.textContent()) ?? '').trim()
      if (text.includes(teacherName)) count += 1
    }
  }

  return count
}

async function countTeacherSourceTooltipsByDate(page: Parameters<typeof test>[0]['page'], dateKey: string) {
  let count = 0

  for (let slotNumber = 1; slotNumber <= 5; slotNumber += 1) {
    for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
      const locator = page.getByTestId(`teacher-cell-${dateKey}_${slotNumber}-${deskIndex}`).locator('.sa-teacher-name')
      if (await locator.count() === 0) continue
      const title = (await locator.getAttribute('title')) ?? ''
      if (title.includes('日程表より登録')) count += 1
    }
  }

  return count
}

async function countStudentOccurrencesInWeek(
  page: Parameters<typeof test>[0]['page'],
  _weekStart: Date,
  studentName: string,
) {
  return page.locator('[data-testid^="student-name-"]').filter({ hasText: studentName }).count()
}

async function findSlotWithEmptyCells(
  page: Parameters<typeof test>[0]['page'],
  weekStart: Date,
  count: number,
  excludedStudentName?: string,
  excludedSlotId?: string,
) {
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dateKey = toDateKey(addDays(weekStart, dayOffset))
    for (let slotNumber = 1; slotNumber <= 4; slotNumber += 1) {
      if (excludedStudentName && await hasStudentInSlot(page, dateKey, slotNumber, excludedStudentName)) continue
      const slotId = `${dateKey}_${slotNumber}`
      if (excludedSlotId === slotId) continue
      try {
        const cellTestIds = await findEmptyStudentCellTestIds(page, slotId, count)
        return { slotId, cellTestIds }
      } catch {
        continue
      }
    }
  }

  throw new Error(`slot with ${count} empty cells not found for week ${toDateKey(weekStart)}`)
}

async function findEmptyStudentCellWithTeacher(
  page: Parameters<typeof test>[0]['page'],
  weekStart: Date,
  excludedStudentName?: string,
  excludedSlotId?: string,
) {
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dateKey = toDateKey(addDays(weekStart, dayOffset))
    for (let slotNumber = 1; slotNumber <= 4; slotNumber += 1) {
      if (excludedStudentName && await hasStudentInSlot(page, dateKey, slotNumber, excludedStudentName)) continue
      const slotId = `${dateKey}_${slotNumber}`
      if (excludedSlotId === slotId) continue
      const target = await page.evaluate((currentSlotId) => {
        for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
          const teacherCell = document.querySelector<HTMLElement>(`[data-testid="teacher-cell-${currentSlotId}-${deskIndex}"]`)
          const teacherName = teacherCell?.textContent?.trim() ?? ''
          if (!teacherName) continue

          for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
            const nameCell = document.querySelector<HTMLElement>(`[data-testid="student-name-${currentSlotId}-${deskIndex}-${studentIndex}"]`)
            const studentName = nameCell?.textContent?.trim() ?? ''
            if (studentName) continue

            return {
              cellTestId: `student-cell-${currentSlotId}-${deskIndex}-${studentIndex}`,
              teacherName,
            }
          }
        }

        return null
      }, slotId)

      if (target) {
        return {
          ...target,
          slotId,
        }
      }
    }
  }

  throw new Error(`empty student cell with teacher not found for week ${toDateKey(weekStart)}`)
}

async function findEmptyStudentCellWithTeacherOnDifferentDate(
  page: Parameters<typeof test>[0]['page'],
  weekStart: Date,
  excludedDateKey: string,
  excludedStudentName?: string,
  excludedSlotId?: string,
) {
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dateKey = toDateKey(addDays(weekStart, dayOffset))
    if (dateKey === excludedDateKey) continue

    for (let slotNumber = 1; slotNumber <= 4; slotNumber += 1) {
      if (excludedStudentName && await hasStudentInSlot(page, dateKey, slotNumber, excludedStudentName)) continue
      const slotId = `${dateKey}_${slotNumber}`
      if (excludedSlotId === slotId) continue

      const target = await page.evaluate((currentSlotId) => {
        for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
          const teacherCell = document.querySelector<HTMLElement>(`[data-testid="teacher-cell-${currentSlotId}-${deskIndex}"]`)
          const teacherName = teacherCell?.textContent?.trim() ?? ''
          if (!teacherName) continue

          for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
            const nameCell = document.querySelector<HTMLElement>(`[data-testid="student-name-${currentSlotId}-${deskIndex}-${studentIndex}"]`)
            const studentName = nameCell?.textContent?.trim() ?? ''
            if (studentName) continue

            return {
              cellTestId: `student-cell-${currentSlotId}-${deskIndex}-${studentIndex}`,
              teacherName,
            }
          }
        }

        return null
      }, slotId)

      if (target) {
        return {
          ...target,
          slotId,
        }
      }
    }
  }

  throw new Error(`empty student cell with teacher not found outside ${excludedDateKey} for week ${toDateKey(weekStart)}`)
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

function toOriginDateLabel(date: Date) {
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土']
  return `${date.getMonth() + 1}/${date.getDate()}(${dayLabels[date.getDay()]})`
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

function getStableWeekStart(today = new Date(), requiredFutureDays = 0) {
  const currentWeekStart = getWeekStart(today)
  const currentSchoolYear = resolveOperationalSchoolYear(today)
  const schoolYearEnd = new Date(getSchoolYearStart(currentSchoolYear + 1))
  schoolYearEnd.setDate(schoolYearEnd.getDate() - 1)
  schoolYearEnd.setHours(0, 0, 0, 0)

  if (addDays(currentWeekStart, requiredFutureDays) <= schoolYearEnd) {
    return currentWeekStart
  }

  return addDays(getWeekStart(schoolYearEnd), -7 * Math.max(1, Math.ceil(requiredFutureDays / 7)))
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

    const firstStudentName = page.getByTestId('basic-data-student-name-input-s001')

    await expect(page.getByTestId('basic-data-student-name-s001')).toHaveText('青木 太郎')
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

    const latestTeacherRow = page.getByTestId('basic-data-teachers-table').locator('tbody tr').filter({ hasText: '新規講師' })
    await expect(latestTeacherRow).toContainText('新規講師')
    await expect(latestTeacherRow).toContainText('2025-04-01')
    await expect(latestTeacherRow).toContainText('理 中まで')

    await page.getByTestId('basic-data-tab-students').click()
    await page.getByTestId('basic-data-student-draft-name').fill('学年テスト生徒')
    await page.getByTestId('basic-data-student-draft-display-name').fill('テスト生徒')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', '2025-04-01')
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', currentGradeBirthDate)
    await page.getByTestId('basic-data-add-student-button').click()

    const latestStudentRow = page.getByTestId('basic-data-students-table').locator('tbody tr').filter({ hasText: '学年テスト生徒' })
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

  test('通常授業テンプレの講師のみコマは通常授業がなくてもコマ表へ講師だけ表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondayKey = toDateKey(currentWeekStart)

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-teachers').click()

    await page.getByTestId('basic-data-teacher-draft-name').fill('出勤講師')
    await page.getByTestId('basic-data-teacher-draft-email').fill('availability-teacher@example.com')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', '2024-04-01')
    await page.getByTestId('basic-data-add-teacher-button').click()

    await navigateFromBasicDataToBoard(page)
    await page.getByTestId('board-regular-template-button').click()
    await expect(page.locator('.template-mode-active')).toBeVisible()
    await setHiddenDateInput(page, 'template-effective-start-date', mondayKey)
    await page.getByTestId('teacher-cell-template_1_4-0').click()
    await page.getByTestId('teacher-select-input').selectOption({ label: '出勤講師' })
    await page.getByTestId('teacher-select-confirm-button').click()
    await page.getByTestId('template-save-normal-button').click()
    await page.getByTestId('template-save-confirm-execute-button').click()
    await expect.poll(async () => hasTeacherInSlot(page, mondayKey, 4, '出勤講師')).toBe(true)
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
    const studentRow = studentsTable.locator('tbody tr').filter({ hasText: '表示E2E' })
    await expect(studentRow).toContainText('表示E2E')
    await studentRow.getByRole('button', { name: '編集' }).click()
    await page.locator('input[value="E2E生徒"]').fill('E2E生徒改')
    await page.locator('input[value="表示E2E"]').fill('表示E2E改')
    await studentsTable.getByRole('button', { name: '編集終了' }).click()
    const updatedStudentRow = studentsTable.locator('tbody tr').filter({ hasText: 'E2E生徒改' })
    await expect(updatedStudentRow).toContainText('E2E生徒改')
    await expect(updatedStudentRow).toContainText('表示E2E改')
    acceptNextDialog(page, 'この生徒を削除します。')
    await updatedStudentRow.getByRole('button', { name: '削除' }).click()
    await expect(studentsTable.locator('tbody tr').filter({ hasText: 'E2E生徒改' })).toHaveCount(0)
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

  test('表示週は画面遷移後も維持される', async ({ page }) => {
    const targetWeekStart = addDays(getWeekStart(new Date()), 14)

    await page.goto('/')
    await moveBoardToWeek(page, targetWeekStart)

    const expectedLabel = await page.getByTestId('week-label').textContent()

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await navigateFromBasicDataToBoard(page)

    await expect(page.getByTestId('week-label')).toHaveText(expectedLabel ?? '')
    await expect(page.getByTestId(`day-header-${toDateKey(targetWeekStart)}`)).toBeVisible()
  })

  test('講師を削除しても生徒付きの盤面状態を保持できる', async ({ page }) => {
    const mondaySlotId = `${toDateKey(getWeekStart(new Date()))}_1`
    const teacherCell = page.getByTestId(`teacher-cell-${mondaySlotId}-0`)
    const studentCell = page.getByTestId(`student-name-${mondaySlotId}-0-0`)

    await page.goto('/')

    await expect(teacherCell).toContainText('田中講師')
    await expect(studentCell).toHaveText('青木太郎')

    await teacherCell.click()
    await page.getByTestId('teacher-delete-button').click()

    await expect(teacherCell).toHaveText('')
    await expect(teacherCell).not.toHaveClass(/sa-warning/)
    await expect(studentCell).toHaveText('青木太郎')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await navigateFromBasicDataToBoard(page)

    await expect(teacherCell).toHaveText('')
    await expect(studentCell).toHaveText('青木太郎')
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

  test('講習期間帯はコマ表上で静的表示され、クリック導線を持たない', async ({ page }) => {
    await page.goto('/')

    await moveBoardToWeek(page, new Date(2026, 2, 23))

    const periodBand = page.getByTestId('board-special-period-session_2026_spring')
    await expect(periodBand).toBeVisible()
    await expect(periodBand.locator('button')).toHaveCount(0)
  })

  test('メニューから自動割振ルールへ移動して対象を追加できる', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-auto-assign-rules-button').click()

    await expect(page.getByTestId('auto-assign-rules-screen')).toBeVisible()
    await expect(page.getByTestId('auto-assign-rules-back-button')).toHaveCount(0)
    await expect(page.locator('.auto-assign-rule-group-head', { hasText: '絶対事項' }).first()).toBeVisible()
    await expect(page.locator('.auto-assign-rule-group-head', { hasText: '制約事項' }).first()).toBeVisible()
    await expect(page.getByTestId('auto-assign-static-constraint-keep-existing')).toContainText('既存コマは変更しない')
    await expect(page.getByTestId('auto-assign-static-constraint-attendance-only')).toContainText('出席可能コマのみ')
    await expect(page.getByTestId('auto-assign-static-constraint-attendance-only')).toContainText('生徒の出席可能コマだけを候補にして割り振ります。')
    await expect(page.getByTestId('auto-assign-rule-card-subjectCapableTeachersOnly')).toContainText('科目対応講師のみ')
    await expect(page.getByTestId('auto-assign-rule-card-subjectCapableTeachersOnly')).toContainText('講師の科目担当に収まる生徒だけを配置候補にします。')
    await expect(page.getByTestId('auto-assign-rule-priority-subjectCapableTeachersOnly')).toContainText('制約事項')
    await expect(page.getByTestId('auto-assign-rule-priority-regularTeachersOnly')).toContainText('制約事項')
    await expect(page.getByTestId('auto-assign-rule-priority-forbidFirstPeriod')).toContainText('制約事項')
    await expect(page.getByTestId('auto-assign-rule-targets-subjectCapableTeachersOnly')).toContainText('なし')
    await expect(page.getByTestId('auto-assign-rule-targets-preferTwoStudentsPerTeacher')).toContainText('なし')
    await expect(page.locator('.auto-assign-rule-group-head', { hasText: '優先事項' }).first()).toBeVisible()
    await expect(page.getByTestId('auto-assign-pair-constraints-panel')).toBeVisible()
    await expect(page.getByTestId('auto-assign-pair-constraints-table')).toContainText('ペア制約はまだありません。')

    await page.getByTestId('auto-assign-pair-draft-person-a-type').selectOption('teacher')
    await page.getByTestId('auto-assign-pair-draft-person-a-id').selectOption('t002')
    await page.getByTestId('auto-assign-pair-draft-person-b-type').selectOption('student')
    await page.getByTestId('auto-assign-pair-draft-person-b-id').selectOption('s003')
    await page.getByTestId('auto-assign-pair-save-button').click()
    await expect(page.getByTestId('auto-assign-rules-status')).toContainText('ペア制約を追加しました。')
    await expect(page.getByTestId('auto-assign-pair-summary-list')).toContainText('上田陽介')

    await page.getByTestId('auto-assign-open-modal-preferTwoStudentsPerTeacher').click()
    await page.getByTestId('auto-assign-modal-confirm-preferTwoStudentsPerTeacher').click()
    await expect(page.getByTestId('auto-assign-rules-status')).toContainText('講師1人に生徒2人配置 に対象を追加しました。')
    await expect(page.getByTestId('auto-assign-rule-targets-preferTwoStudentsPerTeacher')).toContainText('全員')
    await expect(page.getByTestId('auto-assign-group-priority-two-students')).toContainText('優先 2')

    await page.getByTestId('auto-assign-open-modal-maxOneLesson').click()
    await page.getByTestId('auto-assign-type-grade-maxOneLesson').click()
    await page.getByTestId('auto-assign-grade-高1-maxOneLesson').click()
    await page.getByTestId('auto-assign-modal-confirm-maxOneLesson').click()
    await expect(page.getByTestId('auto-assign-rule-targets-maxOneLesson')).toContainText('高1')
    await expect(page.getByTestId('auto-assign-exclude-list-maxOneLesson')).toContainText('なし')

    await page.getByTestId('auto-assign-open-modal-maxTwoLessons').click()
    await page.getByTestId('auto-assign-type-grade-maxTwoLessons').click()
    await expect(page.getByTestId('auto-assign-grade-高1-maxTwoLessons')).toHaveCount(0)
    await page.getByTestId('auto-assign-type-students-maxTwoLessons').click()
    await page.getByTestId('auto-assign-student-toggle-maxTwoLessons-s003').click()
    await page.getByTestId('auto-assign-modal-confirm-maxTwoLessons').click()
    await expect(page.getByTestId('auto-assign-rule-targets-maxTwoLessons')).toContainText('上田陽介')
    await expect(page.getByTestId('auto-assign-exclude-list-maxOneLesson')).toContainText('上田陽介')
    await expect(page.getByTestId('auto-assign-exclude-list-maxTwoLessons')).toContainText('なし')

    await page.getByTestId('auto-assign-open-exclude-modal-maxOneLesson').click()
    await expect(page.getByTestId('auto-assign-type-all-maxOneLesson')).toHaveCount(0)
    await page.getByTestId('auto-assign-type-students-maxOneLesson').click()
    await page.getByTestId('auto-assign-exception-toggle-exclude-maxOneLesson-s001').click()
    await page.getByTestId('auto-assign-exception-confirm-exclude-maxOneLesson').click()
    await expect(page.getByTestId('auto-assign-rules-status')).toContainText('1コマ上限 に対象外を追加しました。')
    await expect(page.getByTestId('auto-assign-exclude-list-maxOneLesson')).toContainText('青木太郎')

    await page.getByTestId('auto-assign-open-modal-preferLateAfternoon').click()
    await page.getByTestId('auto-assign-type-grade-preferLateAfternoon').click()
    await page.getByTestId('auto-assign-grade-中1-preferLateAfternoon').click()
    await page.getByTestId('auto-assign-grade-高1-preferLateAfternoon').click()
    await page.getByTestId('auto-assign-modal-confirm-preferLateAfternoon').click()
    await expect(page.getByTestId('auto-assign-rule-targets-preferLateAfternoon')).toContainText('中1')
    await expect(page.getByTestId('auto-assign-rule-targets-preferLateAfternoon')).toContainText('高1')

    await page.getByTestId('auto-assign-open-modal-allowTwoConsecutiveLessons').click()
    await page.getByTestId('auto-assign-type-students-allowTwoConsecutiveLessons').click()
    await page.getByTestId('auto-assign-student-toggle-allowTwoConsecutiveLessons-s001').click()
    await page.getByTestId('auto-assign-student-toggle-allowTwoConsecutiveLessons-s002').click()
    await expect(page.getByTestId('auto-assign-student-toggle-allowTwoConsecutiveLessons-s028')).toHaveCount(0)
    await page.getByTestId('auto-assign-modal-confirm-allowTwoConsecutiveLessons').click()
    await expect(page.getByTestId('auto-assign-rule-targets-allowTwoConsecutiveLessons')).toContainText('青木太郎')
    await expect(page.getByTestId('auto-assign-rule-targets-allowTwoConsecutiveLessons')).toContainText('伊藤花')
    await expect(page.locator('[data-testid="auto-assign-pair-draft-person-a-id"] option[value="t009"]')).toHaveCount(0)

    await expect(page.getByTestId('auto-assign-rule-priority-allowTwoConsecutiveLessons')).toContainText('優先 4')
    await page.getByTestId('auto-assign-group-move-down-lesson-pattern').click()
    await expect(page.getByTestId('auto-assign-rule-priority-allowTwoConsecutiveLessons')).toContainText('優先 5')
    await expect(page.getByTestId('auto-assign-rules-status')).toContainText('制約グループの優先順位を下げました。')
    await expect(page.getByTestId('auto-assign-priority-slider-allowTwoConsecutiveLessons')).toHaveCount(0)

    await navigateFromAutoAssignRulesToBoard(page)
    await expect(page.getByTestId('week-label')).toBeVisible()
  })

  test('前週次週ボタンで実カレンダーに沿って週表示を切り替えられる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const currentWeekEnd = addDays(currentWeekStart, 6)
    const nextWeekStart = addDays(currentWeekStart, 7)
    const nextWeekEnd = addDays(currentWeekStart, 13)

    await page.goto('/')
    const boardGrid = page.getByTestId('slot-adjust-grid')
    await expect(boardGrid).toBeVisible()

    const overflowModes = await page.evaluate(() => ({
      bodyOverflowY: window.getComputedStyle(document.body).overflowY,
      gridOverflowY: window.getComputedStyle(document.querySelector('[data-testid="slot-adjust-grid"]') as Element).overflowY,
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
    const sourceCell = `student-cell-${slotId}-0-0`
    const targetCell = `student-cell-${slotId}-8-1`
    const sourceName = page.getByTestId(`student-name-${slotId}-0-0`)
    const targetName = page.getByTestId(`student-name-${slotId}-8-1`)

    await expect(sourceName).toHaveText('青木太郎')
    await expect(targetName).toHaveText('')

    await page.getByTestId(sourceCell).click()
    await expect(page.getByTestId('student-action-menu')).toBeVisible()
    await page.getByTestId('menu-move-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? を選択しました。/)
    await expect(page.getByTestId('cancel-selection-button')).toBeVisible()

    await page.getByTestId('cancel-selection-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('キャンセルしました。')

    await page.getByTestId(sourceCell).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(targetCell).click()

    await expect(page.getByTestId('toolbar-status')).toContainText(new RegExp(`青木太郎(?: \\([^)]*\\))? を ${toDateLabel(currentWeekStart).replace('/', '\\/')} 1限 / 9机目 へ移動しました。`))
    await expect(sourceName).toHaveText('')
    await expect(targetName).toHaveText('青木太郎')
  })

  test('選択した生徒を次週へまたいで移動できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const nextWeekStart = addDays(currentWeekStart, 7)
    const currentSlotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await page.getByTestId(`student-cell-${currentSlotId}-0-0`).click()
    await page.getByTestId('menu-move-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? を選択しました。/)

    await page.getByTestId('next-week-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('選択中の内容をこの週へ配置できます。')

    const { cellTestIds: [nextWeekTargetCellTestId] } = await findSlotWithEmptyCells(page, nextWeekStart, 1, '青木太郎')
    const nextWeekTarget = page.getByTestId(nextWeekTargetCellTestId.replace('student-cell-', 'student-name-'))

    await expect(nextWeekTarget).toHaveText('')

    await page.getByTestId(nextWeekTargetCellTestId).click()

    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? を/)
    await expect(nextWeekTarget).toHaveText('青木太郎')

    await page.getByTestId('prev-week-button').click()
    await expect(page.getByTestId(`student-name-${currentSlotId}-0-0`)).toHaveText('')
  })

  test('元に戻すとやり直しが動く', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const sourceName = page.getByTestId(`student-name-${slotId}-0-0`)
    const targetName = page.getByTestId(`student-name-${slotId}-8-1`)

    await page.goto('/')

    await page.getByTestId(`student-cell-${slotId}-0-0`).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(`student-cell-${slotId}-8-1`).click()
    await expect(targetName).toHaveText('青木太郎')

    await page.getByTestId('undo-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('1つ前の状態に戻しました。')
    await expect(sourceName).toHaveText('青木太郎')
    await expect(targetName).toHaveText('')

    await page.getByTestId('redo-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('取り消した操作をやり直しました。')
    await expect(sourceName).toHaveText('')
    await expect(targetName).toHaveText('青木太郎')
  })

  test('空欄の生徒マスに盤面専用メモを保存できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${slotId}-1-1`)
    const targetName = page.getByTestId(`student-name-${slotId}-1-1`)

    await page.goto('/')

    await expect(targetName).toHaveText('')
    await targetCell.click()
    await expect(page.getByTestId('student-action-menu')).toBeVisible()
    await page.getByTestId('menu-open-memo-button').click()
    await expect(targetCell).toHaveClass(/sa-student-picked/)
    await page.getByTestId('menu-memo-textarea').fill('要連絡\n電話希望')
    await page.getByTestId('menu-memo-save-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText(`${toDateLabel(currentWeekStart)} 1限 / 2机目 のメモを保存しました。`)
    await expect(targetName).toContainText('要連絡')
    await expect(targetName).toContainText('電話希望')
    await expect(targetCell.locator('.sa-student-detail')).toHaveCount(0)
    await expect(targetName).toHaveAttribute('title', /手入力メモのため注意/)
  })

  test('空欄の生徒マスでは空欄メニューからメモ入力へ進める', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${slotId}-1-1`)

    await page.goto('/')

    await targetCell.click()
    await expect(page.getByTestId('menu-open-add-existing-student-button')).toBeVisible()
    await expect(page.getByTestId('menu-open-memo-button')).toBeVisible()
    await page.getByTestId('menu-open-memo-button').click()
    await expect(page.getByTestId('menu-memo-textarea')).toBeVisible()
    await expect(page.getByTestId('menu-memo-save-button')).toBeVisible()
    await expect(page.getByTestId('menu-add-student-select')).toHaveCount(0)
    await expect(page.getByTestId('menu-add-existing-student-confirm-button')).toHaveCount(0)
  })

  test('保存済みメモは同じ生徒マスから再編集と削除ができる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const targetCell = page.getByTestId(`student-cell-${slotId}-1-1`)
    const targetName = page.getByTestId(`student-name-${slotId}-1-1`)

    await page.goto('/')

    await saveMemoToCell(page, `student-cell-${slotId}-1-1`, '初回メモ')
    await expect(targetName).toHaveText('初回メモ')

    await targetCell.evaluate((element) => {
      ;(element as HTMLElement).click()
    })
    if (await page.getByTestId('menu-open-memo-button').count()) {
      await page.getByTestId('menu-open-memo-button').click()
    }
    await expect(page.getByTestId('menu-memo-textarea')).toHaveValue('初回メモ')
    await page.getByTestId('menu-memo-textarea').fill('')
    await page.getByTestId('menu-memo-save-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText(`${toDateLabel(currentWeekStart)} 1限 / 2机目 のメモを削除しました。`)
    await expect(targetName).toHaveText('')
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
    const initialMakeupTitle = await page.getByTestId('makeup-stock-entry-s001__-').getAttribute('title')
    expect(initialMakeupTitle ?? '').toContain('残数: +2')
    expect(countOccurrences(initialMakeupTitle ?? '', '（休日振替）')).toBe(2)
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await targetCell.click()

    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? の振替を/)
    await expect(targetName).toHaveText('青木太郎')
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-entry-s001__-')).toContainText('+1')
    const afterPlacementMakeupTitle = await page.getByTestId('makeup-stock-entry-s001__-').getAttribute('title')
    expect(afterPlacementMakeupTitle ?? '').toContain('残数: +1')
    expect(countOccurrences(afterPlacementMakeupTitle ?? '', '（休日振替）')).toBe(1)
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
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await targetCell.click()

    const hoverTitle = await targetName.getAttribute('title')
    expect(hoverTitle).not.toBeNull()
    expect(countOccurrences(hoverTitle ?? '', '元の通常授業:')).toBe(1)
    expect(hoverTitle ?? '').toContain('1限')
  })

  test('振替ストック選択中はマウス追従プレビューが表示される', async ({ page }) => {
    const today = new Date()
    const mondayDates = getMonthWeekdayDates(today.getFullYear(), today.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(today))
    const [firstHoliday] = mondayDates

    test.skip(!firstHoliday, '現在月に判定用の月曜が必要です。')

    await page.goto('/')

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await moveBoardToWeek(page, parseDateKey(firstHoliday))
    await page.getByTestId(`day-header-${firstHoliday}`).click()

    await moveBoardToWeek(page, getWeekStart(today))
    await page.mouse.move(220, 260)
    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()

    await expect(page.getByTestId('move-preview')).toContainText('青木太郎')
    await expect(page.getByTestId('move-preview')).toContainText('振替先を選択中')
  })

  test('振替授業の移動中プレビューはオリジナルのコマ情報を表示する', async ({ page }) => {
    const today = new Date()
    const mondayDates = getMonthWeekdayDates(today.getFullYear(), today.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(today))
    const [firstHoliday] = mondayDates
    const currentWeekStart = getWeekStart(today)
    const targetDateKey = toDateKey(addDays(currentWeekStart, 1))
    const targetDate = parseDateKey(targetDateKey)
    const targetCell = page.getByTestId(`student-cell-${targetDateKey}_1-5-0`)

    test.skip(!firstHoliday, '現在月に判定用の月曜が必要です。')

    await page.goto('/')

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await moveBoardToWeek(page, parseDateKey(firstHoliday))
    await page.getByTestId(`day-header-${firstHoliday}`).click()

    await moveBoardToWeek(page, currentWeekStart)
    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await targetCell.click()

    await targetCell.click()
    await page.getByTestId('menu-move-button').click()

    await expect(page.getByTestId('move-preview')).toContainText('青木太郎')
    await expect(page.getByTestId('move-preview')).toContainText('数')
    await expect(page.getByTestId('move-preview')).toContainText(toOriginDateLabel(parseDateKey(firstHoliday)))
    await expect(page.getByTestId('move-preview')).not.toContainText(toOriginDateLabel(targetDate))
  })

  test('通常授業を移動してもヒントに初期の通常授業日が残る', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCell = `student-cell-${slotId}-0-0`
    const targetCell = `student-cell-${slotId}-8-1`
    const targetName = page.getByTestId(`student-name-${slotId}-8-1`)
    const targetPrefix = page.getByTestId(targetCell).locator('.sa-student-detail-prefix')

    await page.goto('/')

    await page.getByTestId(sourceCell).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(targetCell).click()

    await expect(targetPrefix).toHaveAttribute('aria-label', '通常')
    const hoverTitle = await targetName.getAttribute('title')
    expect(hoverTitle).not.toBeNull()
    expect(hoverTitle ?? '').toContain('元の通常授業:')
    expect(hoverTitle ?? '').toContain(toOriginDateLabel(currentWeekStart))
    expect(hoverTitle ?? '').toContain('1限')
  })

  test('振替授業を元の授業日へ戻すと通常扱いになる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const sourceSlotId = `${toDateKey(currentWeekStart)}_1`
    const temporaryDateKey = toDateKey(addDays(currentWeekStart, 1))
    const sourceCell = `student-cell-${sourceSlotId}-0-0`
    const temporaryCell = `student-cell-${temporaryDateKey}_1-5-0`
    const returnCell = `student-cell-${sourceSlotId}-8-1`
    const returnName = page.getByTestId(`student-name-${sourceSlotId}-8-1`)
    const returnPrefix = page.getByTestId(returnCell).locator('.sa-student-detail-prefix')

    await page.goto('/')

    await page.getByTestId(sourceCell).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(temporaryCell).click()

    await page.getByTestId(temporaryCell).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(returnCell).click()

    await expect(returnPrefix).toHaveAttribute('aria-label', '通常')
    const hoverTitle = await returnName.getAttribute('title')
    expect(hoverTitle).not.toBeNull()
    expect(hoverTitle ?? '').toContain('元の通常授業:')
    expect(hoverTitle ?? '').toContain(toOriginDateLabel(currentWeekStart))
    expect(hoverTitle ?? '').toContain('1限')
  })

  test('振替授業を移動してもヒントに初期の通常授業日が残る', async ({ page }) => {
    const today = new Date()
    const mondayDates = getMonthWeekdayDates(today.getFullYear(), today.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(today))
    const [firstHoliday] = mondayDates
    const currentWeekStart = getWeekStart(today)
    const targetDateKey = toDateKey(addDays(currentWeekStart, 1))
    const firstTargetCell = page.getByTestId(`student-cell-${targetDateKey}_1-5-0`)
    const movedTargetCell = page.getByTestId(`student-cell-${targetDateKey}_1-6-1`)
    const movedTargetName = page.getByTestId(`student-name-${targetDateKey}_1-6-1`)

    test.skip(!firstHoliday, '現在月に判定用の月曜が必要です。')

    await page.goto('/')

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await moveBoardToWeek(page, parseDateKey(firstHoliday))
    await page.getByTestId(`day-header-${firstHoliday}`).click()

    await moveBoardToWeek(page, currentWeekStart)
    await expect(movedTargetName).toHaveText('')
    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await firstTargetCell.click()

    await page.getByTestId(`student-cell-${targetDateKey}_1-5-0`).click()
    await page.getByTestId('menu-move-button').click()
    await movedTargetCell.click()

    const hoverTitle = await movedTargetName.getAttribute('title')
    expect(hoverTitle).not.toBeNull()
    expect(countOccurrences(hoverTitle ?? '', '元の通常授業:')).toBe(1)
    expect(hoverTitle ?? '').toContain(toOriginDateLabel(parseDateKey(firstHoliday)))
    expect(hoverTitle ?? '').toContain('1限')
  })


  test('管理データ反映の通常授業にはヒントを出さない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondaySlotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await expect(page.getByTestId(`student-name-${mondaySlotId}-0-0`)).not.toHaveAttribute('title', /管理データ反映/)
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

  test('通常授業はストックへ回せる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const sourceName = page.getByTestId(`student-name-${slotId}-0-0`)

    await page.goto('/')

    await expect(page.getByTestId('makeup-stock-chip')).toContainText('未消化振替')
    await page.getByTestId(`student-cell-${slotId}-0-0`).click()
    await expect(page.getByTestId('menu-stock-button')).toHaveText('未消化振替に戻す')
    await page.getByTestId('menu-stock-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('未消化振替へ戻しました。')
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('1')
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-panel')).toContainText('青木太郎')
    await expect(sourceName).toHaveText('')
  })

  test('休みにすると盤面へ薄字表示し、生徒日程表の休み欄へ載せる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCell = page.getByTestId(`student-cell-${slotId}-0-0`)
    const sourceName = page.getByTestId(`student-name-${slotId}-0-0`)

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise
    await restoreBoardInteraction(page)
    const teacherName = (((await page.getByTestId(`teacher-cell-${slotId}-0`).textContent()) ?? '').replace(/\s+/g, ' ')).trim()

    await sourceCell.click()
    await expect(page.getByTestId('menu-absence-button')).toBeVisible()
    await expect(page.getByTestId('menu-stock-button')).toHaveText('未消化振替に戻す')
    await page.getByTestId('menu-absence-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('未消化振替へ戻しました。')
    await expect(sourceName).toHaveText('青木太郎(休')
    await expect(sourceCell).toContainText('数')

    await sourceCell.click()
    await expect(page.getByTestId('student-action-menu')).toBeVisible()
    await expect(page.getByTestId('menu-open-add-existing-student-button')).toBeVisible()
    await expect(page.getByTestId('menu-clear-absence-button')).toBeVisible()

    const absenceTable = popup.getByTestId('student-schedule-absence-table-s001')
    await expect.poll(async () => ((await absenceTable.textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain(teacherName)
    await expect.poll(async () => ((await absenceTable.textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain('通常')
    await expect.poll(async () => ((await absenceTable.textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain('数')

    await page.getByTestId('menu-clear-absence-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('休みを解除しました。')
    await expect(sourceName).toHaveText('青木太郎')
    await expect(sourceName).not.toContainText('(休')
    await expect(sourceCell).not.toContainText('(休')
    await expect.poll(async () => ((await absenceTable.textContent()) ?? '').replace(/\s+/g, ' ').trim()).not.toContain(teacherName)
  })

  test('講師の科目対応外になった生徒名は赤表示になりツールチップで理由を出す', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-auto-assign-rules-button').click()
    await page.getByTestId('auto-assign-open-modal-subjectCapableTeachersOnly').click()
    await page.getByTestId('auto-assign-modal-confirm-subjectCapableTeachersOnly').click()
    await navigateFromAutoAssignRulesToBoard(page)

    await page.getByTestId(`teacher-cell-${slotId}-0`).click()
    await page.getByTestId('teacher-select-input').selectOption({ label: '高橋講師' })
    await page.getByTestId('teacher-select-confirm-button').click()

    const studentName = page.getByTestId(`student-name-${slotId}-0-0`)
    await expect(studentName).toHaveClass(/sa-student-name-warning/)
    await expect(studentName).toHaveAttribute('title', /制約違反/)
    await expect(studentName).toHaveAttribute('title', /制約事項: 科目対応講師のみ/)
  })

  test('一コマ空け違反では原因となる両方のコマを赤表示にする', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date('2026-03-23'))
    const dateKey = toDateKey(currentWeekStart)
    const sourceName = page.getByTestId(`student-name-${dateKey}_1-0-0`)

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-auto-assign-rules-button').click()
    await page.getByTestId('auto-assign-open-modal-requireBreakBetweenLessons').click()
    await page.getByTestId('auto-assign-type-students-requireBreakBetweenLessons').click()
    await page.getByTestId('auto-assign-student-toggle-requireBreakBetweenLessons-s001').click()
    await page.getByTestId('auto-assign-modal-confirm-requireBreakBetweenLessons').click()
    await navigateFromAutoAssignRulesToBoard(page)

    const target = await page.evaluate((currentDateKey) => {
      for (let deskIndex = 0; deskIndex < 14; deskIndex += 1) {
        const teacherCell = document.querySelector<HTMLElement>(`[data-testid="teacher-cell-${currentDateKey}_2-${deskIndex}"]`)
        const teacherName = teacherCell?.textContent?.trim() ?? ''
        if (!teacherName) continue

        for (let studentIndex = 0; studentIndex < 2; studentIndex += 1) {
          const studentNameCell = document.querySelector<HTMLElement>(`[data-testid="student-name-${currentDateKey}_2-${deskIndex}-${studentIndex}"]`)
          const studentName = studentNameCell?.textContent?.trim() ?? ''
          if (studentName) continue

          return {
            cellTestId: `student-cell-${currentDateKey}_2-${deskIndex}-${studentIndex}`,
            nameTestId: `student-name-${currentDateKey}_2-${deskIndex}-${studentIndex}`,
          }
        }
      }

      return null
    }, dateKey)
    expect(target).toBeTruthy()

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise
    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await restoreBoardInteraction(page)
    await page.getByTestId('lecture-stock-chip').click()
    await page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first().click()
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(target!.cellTestId).click()

    const targetName = page.getByTestId(target!.nameTestId)
    await expect(sourceName).toHaveClass(/sa-student-name-warning/)
    await expect(sourceName).toHaveAttribute('title', /制約: 一コマ空け/)
    await expect(targetName).toHaveClass(/sa-student-name-warning/)
    await expect(targetName).toHaveAttribute('title', /制約: 一コマ空け/)
  })

  test('通常授業がその日に一コマだけなら一コマ空け違反を出さない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date('2026-03-23'))
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const studentName = page.getByTestId(`student-name-${slotId}-0-0`)

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-auto-assign-rules-button').click()
    await page.getByTestId('auto-assign-open-modal-requireBreakBetweenLessons').click()
    await page.getByTestId('auto-assign-type-students-requireBreakBetweenLessons').click()
    await page.getByTestId('auto-assign-student-toggle-requireBreakBetweenLessons-s001').click()
    await page.getByTestId('auto-assign-modal-confirm-requireBreakBetweenLessons').click()
    await navigateFromAutoAssignRulesToBoard(page)

    await expect(studentName).not.toHaveClass(/sa-student-name-warning/)
    await expect(studentName).not.toHaveAttribute('title', /一コマ空け/)
  })

  test('振替ストックの表示はコマ表操作後も開いたまま残る', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()

    await page.getByTestId('pack-sort-button').click()

    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
  })

  test('振替ストックの自動割振期間開始は表示中の週初日を初期値にする', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())

    await page.goto('/')

    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-auto-assign-start')).toHaveValue(toDateKey(currentWeekStart))
  })

  test('生徒メニューは既存生徒で移動とストックを表示し、空欄では生徒追加とメモを表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`

    await page.goto('/')

    await page.getByTestId(`student-cell-${slotId}-0-0`).click()
    let menuButtons = await page.locator('[data-testid="student-action-menu"] .menu-link-button').allTextContents()
    expect(menuButtons).toEqual(['出席', '休み', '振替なし休み', '移動', '未消化振替に戻す', '削除'])

    await page.getByRole('button', { name: 'x' }).click()

    const emptyCellTestId = (await findEmptyStudentCellWithTeacher(page, currentWeekStart)).cellTestId
    await page.getByTestId(emptyCellTestId).click()
    await expect(page.getByTestId('student-action-menu')).toBeVisible()
    menuButtons = await page.locator('[data-testid="student-action-menu"] .menu-link-button').allTextContents()
    expect(menuButtons).toEqual(['生徒追加', 'メモ'])
  })

  test('出席にすると薄字表示し、再クリックでは出席解除だけを表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const slotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCell = page.getByTestId(`student-cell-${slotId}-0-0`)
    const sourceName = page.getByTestId(`student-name-${slotId}-0-0`)

    await page.goto('/')

    await sourceCell.click()
    await expect(page.getByTestId('menu-attendance-button')).toBeVisible()
    await page.getByTestId('menu-attendance-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('出席にしました。')
    await expect(sourceName).toHaveText('青木太郎(出')
    await expect(sourceCell).toContainText('数')

    await sourceCell.click()
    const menuButtons = await page.locator('[data-testid="student-action-menu"] .menu-link-button').allTextContents()
    expect(menuButtons).toEqual(['出席解除'])

    await page.getByTestId('menu-clear-attendance-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('出席を解除しました。')
    await expect(sourceName).toHaveText('青木太郎')
    await expect(sourceName).not.toContainText('(出')

    await sourceCell.click()
    const menuButtonsAfterClear = await page.locator('[data-testid="student-action-menu"] .menu-link-button').allTextContents()
    expect(menuButtonsAfterClear).toEqual(['出席', '休み', '振替なし休み', '移動', '未消化振替に戻す', '削除'])
  })

  test('空欄セルから既存生徒を講習追加しても講習ストックは増えず、手動追加警告を出す', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const specialWeekStart = addDays(currentWeekStart, 7)

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await restoreBoardInteraction(page)
    await page.getByTestId('lecture-stock-chip').click()
    const lectureEntry = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first()
    await expect(lectureEntry).toContainText('+1')

    await moveBoardToWeek(page, specialWeekStart)

    const target = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎')
    await page.getByTestId(target.cellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()

    await page.getByTestId('menu-add-student-select').selectOption('s001')
    await page.getByTestId('menu-add-lesson-type-special').click()
    await page.getByTestId('menu-add-subject-select').selectOption('数')
    await page.getByTestId('menu-add-existing-student-confirm-button').click()

    const targetName = page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))
    await expect(targetName).toHaveText('青木太郎')
    await expect(targetName).toHaveClass(/sa-student-name-warning/)
    await expect(targetName).toHaveAttribute('title', /手動追加/)

    await page.getByTestId(target.cellTestId).click()
    await expect(page.getByTestId('menu-stock-button')).toHaveCount(0)
    await expect(page.getByTestId('menu-stock-disabled-note')).toContainText('手動追加した講習は未消化講習へ戻せません。')
    await page.getByRole('button', { name: 'x' }).click()

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await expect(popup.getByTestId('student-schedule-period-button-s001-session_2026_spring')).toContainText('希望科目数登録済')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await expect(popup.getByTestId('student-schedule-count-modal')).toContainText('数')
    await expect(popup.getByTestId('student-schedule-count-modal')).toContainText('1')

    await restoreBoardInteraction(page)
    if (!await page.getByTestId('lecture-stock-panel').isVisible()) {
      await page.getByTestId('lecture-stock-chip').click()
    }
    await expect(lectureEntry).toContainText('+1')
  })

  test('手動追加した講習を休日化しても講習ストックは増えない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const specialWeekStart = addDays(currentWeekStart, 7)

    await page.goto('/')
    await moveBoardToWeek(page, specialWeekStart)

    const target = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎')
    const targetDateKey = target.slotId.split('_')[0]
    const targetName = page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))

    await page.getByTestId(target.cellTestId).click()
    await page.getByTestId('menu-open-add-existing-student-button').click()
    await page.getByTestId('menu-add-student-select').selectOption('s001')
    await page.getByTestId('menu-add-lesson-type-special').click()
    await page.getByTestId('menu-add-subject-select').selectOption('数')
    await page.getByTestId('menu-add-existing-student-confirm-button').click()
    await expect(targetName).toHaveText('青木太郎')

    acceptNextDialog(page)
    await page.getByTestId(`day-header-${targetDateKey}`).click()

    await expect(targetName).toHaveText('')
    await expect(page.getByTestId('toolbar-status')).toContainText('休日に設定しました。')
    await page.getByTestId('lecture-stock-chip').click()
    await expect(page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' })).toHaveCount(0)
  })

  test('振替授業を削除しても振替ストックへ戻らない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const tuesdayKey = toDateKey(addDays(currentWeekStart, 1))
    const targetCell = page.getByTestId(`student-cell-${tuesdayKey}_1-5-0`)
    const targetName = page.getByTestId(`student-name-${tuesdayKey}_1-5-0`)
    const mondayDates = getMonthWeekdayDates(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(new Date()))
    const [firstHoliday, secondHoliday] = mondayDates

    test.skip(!firstHoliday || !secondHoliday, '現在月に判定用の月曜が2回以上必要です。')

    await page.goto('/')

    for (const holiday of [firstHoliday, secondHoliday]) {
      acceptNextDialog(page)
      await moveBoardToWeek(page, parseDateKey(holiday))
      await page.getByTestId(`day-header-${holiday}`).click()
    }

    await moveBoardToWeek(page, currentWeekStart)
    await page.getByTestId('makeup-stock-chip').click()
    const initialBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await expect(page.getByTestId('makeup-stock-panel')).toBeHidden()
    await targetCell.click()
    await expect(targetName).toHaveText('青木太郎')

    await page.getByTestId('makeup-stock-chip').click()
    const afterPlacementBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    expect(afterPlacementBalance).toBe(initialBalance - 1)
    await page.getByTestId('cancel-selection-button').click()

    await targetCell.click()
    acceptNextDialog(page, '振替の対象になりません。')
    await page.getByTestId('menu-delete-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('振替対象にはしません。')
    await expect(targetName).toHaveText('')
    await page.getByTestId('makeup-stock-chip').click()
    const afterDeleteBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    expect(afterDeleteBalance).toBe(afterPlacementBalance)
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
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await targetCell.click()
    await expect(targetName).toHaveText('青木太郎')

    await page.getByTestId('makeup-stock-chip').click()
    const afterPlacementBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    expect(afterPlacementBalance).toBe(initialBalance - 1)
    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替移動中')
    await page.getByTestId('cancel-selection-button').click()

    await targetCell.click()
    await expect(page.getByTestId('menu-stock-button')).toHaveText('未消化振替に戻す')
    await page.getByTestId('menu-stock-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('未消化振替へ戻しました。')
    await expect(targetName).toHaveText('')
    await page.getByTestId('makeup-stock-chip').click()
    const afterReturnBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    expect(afterReturnBalance).toBe(initialBalance)
  })

  test('振替ストック行の自動割振で複数候補から配置できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondayDates = getMonthWeekdayDates(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(new Date()))
    const [holiday] = mondayDates

    test.skip(!holiday, '現在月に判定用の月曜が必要です。')

    await page.goto('/')

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await moveBoardToWeek(page, parseDateKey(holiday))
    await page.getByTestId(`day-header-${holiday}`).click()

    await moveBoardToWeek(page, currentWeekStart)
    const memoTarget = await findEmptyStudentCellWithTeacher(page, currentWeekStart, '青木太郎')
    const memoTargetName = page.getByTestId(memoTarget.cellTestId.replace('student-cell-', 'student-name-'))
    await saveMemoToCell(page, memoTarget.cellTestId, '振替回避メモ')
    await expect(memoTargetName).toHaveText('振替回避メモ')

    await page.getByTestId('makeup-stock-chip').click()
    const initialBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-auto').click()

    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? の振替を自動割振しました。1コマ配置しました。/)
    await expect(memoTargetName).toHaveText('振替回避メモ')
    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
    const remainingEntryCount = await page.getByTestId('makeup-stock-entry-s001__-').count()
    if (remainingEntryCount === 0) {
      expect(initialBalance - 1).toBe(0)
    } else {
      const nextBalance = extractSignedCount(await page.getByTestId('makeup-stock-entry-s001__-').textContent())
      expect(nextBalance).toBe(initialBalance - 1)
    }
  })

  test('通常授業を移動すると生徒日程表では振替元が消えて振替先だけが残る', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const sourceSlotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCellTestId = `student-cell-${sourceSlotId}-0-0`
    const sourceDateKey = sourceSlotId.split('_')[0]

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await restoreBoardInteraction(page)
    const target = await findEmptyStudentCellWithTeacherOnDifferentDate(page, currentWeekStart, sourceDateKey, '青木太郎', sourceSlotId)

    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(target.cellTestId).click()

    const sourcePopupCell = popup.getByTestId(`student-schedule-cell-s001-${sourceSlotId}`)
    const targetPopupCell = popup.getByTestId(`student-schedule-cell-s001-${target.slotId}`)

    await expect.poll(async () => ((await sourcePopupCell.textContent()) ?? '').replace(/\s+/g, '').trim()).toBe('')
    await expect.poll(async () => ((await targetPopupCell.textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain('振替')
  })

  test('通常授業をストックへ回すと生徒日程表では未割当のまま表示しない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const sourceSlotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCellTestId = `student-cell-${sourceSlotId}-0-0`

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await restoreBoardInteraction(page)
    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-stock-button').click()

    const sourcePopupCell = popup.getByTestId(`student-schedule-cell-s001-${sourceSlotId}`)
    await expect.poll(async () => ((await sourcePopupCell.textContent()) ?? '').replace(/\s+/g, '').trim()).toBe('')
  })

  test('通常授業をストックへ回しても画面遷移後に元の通常授業は復活しない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const sourceSlotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCellTestId = `student-cell-${sourceSlotId}-0-0`
    const sourceName = page.getByTestId(`student-name-${sourceSlotId}-0-0`)

    await page.goto('/')

    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-stock-button').click()
    await expect(sourceName).toHaveText('')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-special-data-button').click()
    await navigateFromSpecialDataToBoard(page)

    await expect(sourceName).toHaveText('')
    await page.getByTestId('makeup-stock-chip').click()
    await expect(page.getByTestId('makeup-stock-entry-s001__-')).toContainText('+1')
  })

  test('振替が元のコマへ戻ると通常授業表示に戻る', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const sourceSlotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCellTestId = `student-cell-${sourceSlotId}-0-0`
    const sourceName = page.getByTestId(`student-name-${sourceSlotId}-0-0`)
    const sourcePrefix = page.getByTestId(sourceCellTestId).locator('.sa-student-detail-prefix')

    await page.goto('/')

    const target = await findEmptyStudentCellWithTeacher(page, currentWeekStart, '青木太郎', sourceSlotId)
    const targetName = page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))

    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(target.cellTestId).click()
    await expect(targetName).toHaveText('青木太郎')

    await page.getByTestId(target.cellTestId).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(sourceCellTestId).click()

    await expect(targetName).toHaveText('')
    await expect(sourceName).toHaveText('青木太郎')
    await expect(sourcePrefix).toHaveAttribute('aria-label', '通常')
  })

  test('振替ストックを元のコマへ戻すとストック残数から消える', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const sourceSlotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCellTestId = `student-cell-${sourceSlotId}-0-0`
    const sourceName = page.getByTestId(`student-name-${sourceSlotId}-0-0`)
    const sourcePrefix = page.getByTestId(sourceCellTestId).locator('.sa-student-detail-prefix')

    await page.goto('/')

    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-stock-button').click()
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('1')

    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(sourceCellTestId).click()

    await expect(sourceName).toHaveText('青木太郎')
    await expect(sourcePrefix).toHaveAttribute('aria-label', '通常')

    await expect(page.getByTestId('makeup-stock-panel')).toBeVisible()
    await expect(page.getByTestId('makeup-stock-panel')).not.toContainText('青木太郎')
  })

  test('講習ストックを割り振れて再移動しても振替にならない', async ({ page }) => {
    test.slow()

    const currentWeekStart = getWeekStart(new Date())
    const specialWeekStart = addDays(currentWeekStart, 7)
    const lectureSubjects = ['数', '英'] as const

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-subject-英').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await expect(page.getByTestId('lecture-stock-chip')).toContainText('1')
    await moveBoardToWeek(page, specialWeekStart)

    const firstTarget = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎')
    await page.getByTestId('lecture-stock-chip').click()
    const lectureEntry = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first()
    await expect(lectureEntry).toBeVisible()
    const initialLectureTitle = (await lectureEntry.getAttribute('title')) ?? ''
    expect(initialLectureTitle).toContain('残数: +2')
    expect(initialLectureTitle).toContain('数: +1')
    expect(initialLectureTitle).toContain('英: +1')
    const initialLectureCount = extractSignedCount(await lectureEntry.textContent())
    await lectureEntry.click()
    await page.getByTestId('stock-action-modal-manual').click()

    await expect(page.getByTestId('move-preview')).toContainText('青木太郎')
    await expect(page.getByTestId('move-preview')).toContainText('未消化講習の配置先を選択中')
    const firstPreviewText = (await page.getByTestId('move-preview').textContent()) ?? ''
    const firstSubject = lectureSubjects.find((subject) => firstPreviewText.includes(subject))
    expect(firstSubject).toBeTruthy()

    await page.getByTestId(firstTarget.cellTestId).click()
    const firstTargetName = page.getByTestId(firstTarget.cellTestId.replace('student-cell-', 'student-name-'))
    await expect(firstTargetName).toHaveText('青木太郎')
    await expect(page.getByTestId('lecture-stock-panel')).toBeHidden()
    await expect(page.getByTestId('move-preview')).toContainText('青木太郎')
    await expect(page.getByTestId('move-preview')).toContainText('未消化講習の配置先を選択中')

    const secondPlacementTarget = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎', firstTarget.slotId)
    await expect(page.getByTestId('move-preview')).toContainText('青木太郎')
    await expect(page.getByTestId('move-preview')).toContainText('未消化講習の配置先を選択中')
    const secondPreviewText = (await page.getByTestId('move-preview').textContent()) ?? ''
    const secondSubject = lectureSubjects.find((subject) => secondPreviewText.includes(subject))
    expect(secondSubject).toBeTruthy()
    expect(secondSubject).not.toBe(firstSubject)

    await page.getByTestId(secondPlacementTarget.cellTestId).click()
    const secondPlacementTargetName = page.getByTestId(secondPlacementTarget.cellTestId.replace('student-cell-', 'student-name-'))
    await expect(secondPlacementTargetName).toHaveText('青木太郎')
    await expect.poll(async () => {
      const matchingEntries = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' })
      return matchingEntries.count()
    }).toBe(0)

    const secondTarget = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎', secondPlacementTarget.slotId)
    await page.getByTestId(firstTarget.cellTestId).click()
    await page.getByTestId('menu-move-button').click({ force: true })
    await page.getByTestId(secondTarget.cellTestId).click({ force: true })

    const secondTargetName = page.getByTestId(secondTarget.cellTestId.replace('student-cell-', 'student-name-'))
    await expect(firstTargetName).toHaveText('')
    await expect(secondTargetName).toHaveText('青木太郎')
    expect((await secondTargetName.getAttribute('title')) ?? '').not.toContain('元の通常授業:')
  })

  test('講習授業を削除しても希望数は減らず講習ストックへは戻らない', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const specialWeekStart = addDays(currentWeekStart, 7)

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await moveBoardToWeek(page, specialWeekStart)

    const target = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎')
    await page.getByTestId('lecture-stock-chip').click()
    await page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first().click()
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(target.cellTestId).click()

    const targetName = page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))
    await expect(targetName).toHaveText('青木太郎')

    await page.getByTestId(target.cellTestId).click()
    acceptNextDialog(page, '振替の対象になりません。')
    await page.getByTestId('menu-delete-button').click()

    await expect(page.getByTestId('toolbar-status')).toContainText('講習の予定を削除しました。')
    await expect(targetName).toHaveText('')
    if (!await page.getByTestId('lecture-stock-panel').isVisible()) {
      await page.getByTestId('lecture-stock-chip').click()
    }
    await expect(page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' })).toHaveCount(0)

    await popup.close()
    await expect.poll(async () => await page.getByTestId('board-student-schedule-button').isDisabled()).toBe(false)

    const reopenedPopupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const reopenedPopup = await reopenedPopupPromise
    await setScheduleRangeInPopup(reopenedPopup, '2026-03-23', '2026-03-29')
    await reopenedPopup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await expect(reopenedPopup.getByTestId('student-schedule-count-unregister')).toBeVisible()
    await expect(reopenedPopup.locator('.count-modal-table tr').filter({ hasText: '数' })).toContainText('1')
  })

  test('講習を期間外へ手動配置しても赤字ツールチップで絶対制約違反を表示する', async ({ page }) => {
    const outOfPeriodWeekStart = getWeekStart(new Date('2026-04-06'))

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await moveBoardToWeek(page, outOfPeriodWeekStart)
    const target = await findEmptyStudentCellWithTeacher(page, outOfPeriodWeekStart, '青木太郎')
    await page.getByTestId('lecture-stock-chip').click()
    await page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).filter({ hasText: '2026 新年度準備講座' }).click()
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(target.cellTestId).click({ force: true })

    const targetName = page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))
    await expect(targetName).toHaveText('青木太郎')
    await expect(targetName).toHaveClass(/sa-student-name-warning/)
    await expect(targetName).toHaveAttribute('title', /制約違反/)
    await expect(targetName).toHaveAttribute('title', /絶対事項: 講習期間内割振/)
  })

  test('参加不可コマへ手動移動しても赤字ツールチップで絶対制約違反を表示する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date('2026-03-23'))
    const sourceSlotId = `${toDateKey(currentWeekStart)}_1`
    const sourceCellTestId = `student-cell-${sourceSlotId}-0-0`

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise
    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')

    let target = await findEmptyStudentCellWithTeacher(page, currentWeekStart, '青木太郎', sourceSlotId)
    const sourceDateKey = sourceSlotId.split('_')[0]
    if (target.slotId.startsWith(`${sourceDateKey}_`)) {
      target = await findEmptyStudentCellWithTeacher(page, currentWeekStart, '青木太郎', target.slotId)
    }
    const targetDateKey = target.slotId.split('_')[0]

    await popup.getByTestId(`student-schedule-day-toggle-s001-${targetDateKey}`).click()
    await expect(popup.getByTestId(`student-schedule-day-toggle-s001-${targetDateKey}`)).toHaveClass(/is-unavailable/)

    await restoreBoardInteraction(page)
    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-move-button').click()
    await page.getByTestId(target.cellTestId).click()

    const targetName = page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))
    await expect(targetName).toHaveText('青木太郎')
    await expect(targetName).toHaveClass(/sa-student-name-warning/)
    await expect(targetName).toHaveAttribute('title', /制約違反/)
    await expect(targetName).toHaveAttribute('title', /絶対事項: 出席可能コマのみ/)
  })

  test('複数講習期間を登録しても講習ストックは期間ごとに分かれ、登録解除も対象期間だけに効く', async ({ page }) => {
    test.slow()
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-06-05')

    await expect(popup.getByTestId('student-schedule-period-button-s001-session_2026_spring')).toBeVisible()
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click({ force: true })
    await expect(popup.getByTestId('student-schedule-count-modal')).toBeVisible()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await expect(popup.getByTestId('student-schedule-period-button-s001-session_2026_exam')).toBeVisible()
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_exam').click({ force: true })
    await expect(popup.getByTestId('student-schedule-count-modal')).toBeVisible()
    await popup.getByTestId('student-schedule-count-subject-英').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await ensureLectureStockPanelVisible(page)
    await expect(page.getByTestId('lecture-stock-chip')).toContainText('2')
    const springEntry = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '2026 新年度準備講座' })
    const examEntry = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '2026 定期試験対策' })
    await expect(springEntry).toHaveCount(1)
    await expect(examEntry).toHaveCount(1)

  await popup.bringToFront()
  await expect(popup.getByTestId('student-schedule-period-button-s001-session_2026_exam')).toBeVisible()
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_exam').click({ force: true })
    await expect(popup.getByTestId('student-schedule-count-modal')).toBeVisible()
    await popup.getByTestId('student-schedule-count-unregister').click()

    await ensureLectureStockPanelVisible(page)
    await expect(page.getByTestId('lecture-stock-chip')).toContainText('1')
    await expect(springEntry).toHaveCount(1)
    await expect(examEntry).toHaveCount(0)
  })

  test('講習ストック行の自動割振で複数コマをまとめて配置できる', async ({ page }) => {
    const specialWeekStart = getWeekStart(new Date('2026-03-23'))
    const nextSessionWeekStart = addDays(specialWeekStart, 7)

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-subject-英').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await restoreBoardInteraction(page)
    await moveBoardToWeek(page, specialWeekStart)
    const memoTarget = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎')
    const memoTargetName = page.getByTestId(memoTarget.cellTestId.replace('student-cell-', 'student-name-'))
    await saveMemoToCell(page, memoTarget.cellTestId, '講習回避メモ')
    await expect(memoTargetName).toHaveText('講習回避メモ')

    const countStudentOccurrencesInSessionWeeks = async () => {
      await moveBoardToWeek(page, specialWeekStart)
      const firstWeekCount = await countStudentOccurrencesInWeek(page, specialWeekStart, '青木太郎')
      await moveBoardToWeek(page, nextSessionWeekStart)
      const secondWeekCount = await countStudentOccurrencesInWeek(page, nextSessionWeekStart, '青木太郎')
      return firstWeekCount + secondWeekCount
    }

    const beforeCount = await countStudentOccurrencesInSessionWeeks()

    await page.getByTestId('lecture-stock-chip').click()
    await page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first().waitFor()
    const lectureEntry = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first()
    await lectureEntry.click()
    await page.getByTestId('stock-action-modal-auto').click()

    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? を自動割振しました。/)
    await moveBoardToWeek(page, specialWeekStart)
    await expect(page.locator('[data-testid^="student-name-"]').filter({ hasText: '講習回避メモ' }).first()).toHaveText('講習回避メモ')
    await expect.poll(countStudentOccurrencesInSessionWeeks).toBe(beforeCount + 2)
    await expect(page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' })).toHaveCount(0)
  })

  test('登校日集約の講習自動割振は期間前半の週も使いながら日を広く取る', async ({ page }) => {
    const firstWeekStart = getWeekStart(new Date('2026-03-23'))
    const secondWeekStart = getWeekStart(new Date('2026-03-30'))

    await page.goto('/')

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-auto-assign-rules-button').click()
    await page.getByTestId('auto-assign-open-modal-preferDateConcentration').click()
    await page.getByTestId('auto-assign-modal-confirm-preferDateConcentration').click()
    await navigateFromAutoAssignRulesToBoard(page)

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-04-05')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('5')
    await popup.getByTestId('student-schedule-count-register').click()

    await restoreBoardInteraction(page)
    await moveBoardToWeek(page, firstWeekStart)
    await page.getByTestId('lecture-stock-chip').click()
    const lectureEntry = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first()
    await lectureEntry.click()
    await page.getByTestId('stock-action-modal-auto').click()

    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? を自動割振しました。/)
    await expect.poll(async () => await countStudentOccurrencesInWeek(page, firstWeekStart, '青木太郎')).toBeGreaterThan(0)

    await moveBoardToWeek(page, secondWeekStart)
    await expect.poll(async () => await countStudentOccurrencesInWeek(page, secondWeekStart, '青木太郎')).toBeGreaterThan(0)
  })

  test('講習ストック自動割振の取り消しとやり直しでストック数も戻る', async ({ page }) => {
    const specialWeekStart = getWeekStart(new Date('2026-03-23'))

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-英').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await restoreBoardInteraction(page)
    await moveBoardToWeek(page, specialWeekStart)
    await page.getByTestId('lecture-stock-chip').click()
    const lectureEntries = page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' })
    await expect(lectureEntries.first()).toContainText('+1')
    await lectureEntries.first().click()
    await page.getByTestId('stock-action-modal-auto').click()

    await expect(lectureEntries).toHaveCount(0)

    await page.getByTestId('undo-button').click()
    await expect(lectureEntries.first()).toContainText('+1')

    await page.getByTestId('redo-button').click()
    await expect(lectureEntries).toHaveCount(0)
  })

  test('stock に戻した講習も session 情報を保って再割振できる', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date('2026-03-30'))
    const specialWeekStart = getWeekStart(new Date('2026-03-23'))
    const nextSessionWeekStart = addDays(specialWeekStart, 7)

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await restoreBoardInteraction(page)
    await moveBoardToWeek(page, specialWeekStart)
    const target = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎')

    await page.getByTestId('lecture-stock-chip').click()
    await page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first().click()
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(target.cellTestId).click()
    await expect(page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))).toHaveText('青木太郎')

    await page.getByTestId(target.cellTestId).click()
    await expect(page.getByTestId('menu-stock-button')).toHaveText('未消化講習に戻す')
    await page.getByTestId('menu-stock-button').click()
    await expect(page.getByTestId('toolbar-status')).toContainText('未消化講習へ戻しました。')

    const countStudentOccurrencesInSessionWeeks = async () => {
      await moveBoardToWeek(page, specialWeekStart)
      const firstWeekCount = await countStudentOccurrencesInWeek(page, specialWeekStart, '青木太郎')
      await moveBoardToWeek(page, nextSessionWeekStart)
      const secondWeekCount = await countStudentOccurrencesInWeek(page, nextSessionWeekStart, '青木太郎')
      return firstWeekCount + secondWeekCount
    }

    const beforeReassignCount = await countStudentOccurrencesInSessionWeeks()
    await moveBoardToWeek(page, currentWeekStart)
    await expect(page.getByTestId('lecture-stock-panel')).toBeVisible()
    await page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first().click()
    await page.getByTestId('stock-action-modal-auto').click()
    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? を自動割振しました。1コマ配置しました。/)

    await expect.poll(countStudentOccurrencesInSessionWeeks).toBe(beforeReassignCount + 1)
  })

  test('小学生の希望科目数モーダルでは算のみ表示し数を表示しない', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s008-session_2026_spring').click()

    await expect(popup.getByTestId('student-schedule-count-modal')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-subject-算')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-subject-数')).toHaveCount(0)
  })

  test('高校生の希望科目数モーダルでは理を出さず生物化を表示する', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s019-session_2026_spring').click()

    await expect(popup.getByTestId('student-schedule-count-modal')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-subject-理')).toHaveCount(0)
    await expect(popup.getByTestId('student-schedule-count-subject-生')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-subject-物')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-subject-化')).toBeVisible()
  })

  test('希望科目数が出席可能コマ数を上回ると登録不可にして見直しを促す', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')

    const studentId = 's001'
    const targetSheet = popup.locator(`[data-role="student-sheet"][data-student-id="${studentId}"]`)
    await popup.getByTestId(`student-schedule-day-toggle-${studentId}-2026-03-23`).click()
    await popup.getByTestId(`student-schedule-day-toggle-${studentId}-2026-03-24`).click()
    await popup.getByTestId(`student-schedule-day-toggle-${studentId}-2026-03-25`).click()
    await popup.getByTestId(`student-schedule-day-toggle-${studentId}-2026-03-26`).click()
    await expect.poll(async () => targetSheet.locator('.slot-cell.is-unavailable').count()).toBeGreaterThan(0)

    const periodButton = popup.getByTestId('student-schedule-period-button-s001-session_2026_spring')
    await periodButton.click()
    await expect(popup.getByTestId('student-schedule-count-modal')).toBeVisible()
    await popup.getByTestId('student-schedule-count-subject-数').fill('99')

    popup.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('希望科目数が出席可能コマ数を上回っているため登録できません。出席不可コマを見直してください。')
      await dialog.accept()
    })
    await popup.getByTestId('student-schedule-count-register').click()

    await expect(popup.getByTestId('student-schedule-count-modal')).toHaveCount(0)
    await expect(periodButton).toContainText('希望科目数設定はここをクリック')
    await expect.poll(async () => targetSheet.locator('[data-role="toggle-student-unavailable-date"]').count()).toBeGreaterThan(0)
  })

  test('希望数が残っている表だけ警告スタンプを表示する', async ({ page }) => {
    const targetWeekStart = getWeekStart(new Date())
    const targetWeekStartKey = toDateKey(targetWeekStart)
    const targetWeekEndKey = toDateKey(addDays(targetWeekStart, 6))
    const sourceSlotId = `${targetWeekStartKey}_1`
    const sourceCellTestId = `student-cell-${sourceSlotId}-0-0`

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, targetWeekStartKey, targetWeekEndKey)
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    await restoreBoardInteraction(page)
    await moveBoardToWeek(page, targetWeekStart)
    await page.getByTestId(sourceCellTestId).click()
    await page.getByTestId('menu-stock-button').click()

    const targetSheet = popup.locator('[data-role="student-sheet"][data-student-id="s001"]')
    const countBlocks = targetSheet.locator('.count-stack-block')

    await expect(countBlocks.nth(0).getByTestId('student-schedule-regular-count-warning')).toBeVisible()
    await expect(countBlocks.nth(1).getByTestId('student-schedule-lecture-count-warning')).toBeVisible()
  })

  test('生徒日程表の講習回数表は表示期間で件数がある科目だけを表示する', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')
    await popup.getByTestId('student-schedule-period-button-s001-session_2026_spring').click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()

    const targetSheet = popup.locator('[data-role="student-sheet"][data-student-id="s001"]')
    const lectureCountBlock = targetSheet.locator('.count-stack-block').nth(1)

    await expect(lectureCountBlock).toContainText('数')
    await expect(lectureCountBlock).not.toContainText('英')
    await expect(lectureCountBlock).not.toContainText('国')
    await expect(lectureCountBlock).not.toContainText('理')
    await expect(lectureCountBlock.locator('tbody tr')).toHaveCount(1)
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
    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await blockerCell.click()

    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await duplicateTarget.click()

    await expect(page.getByTestId('toolbar-status')).toContainText('同コマにすでに青木太郎が組まれているため振替不可です。')
    await expect(page.getByTestId('center-status-banner')).toContainText('同コマにすでに青木太郎が組まれているため振替不可です。')
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替移動中')
    await expect(page.getByTestId('cancel-selection-button')).toBeVisible()
    await expect(page.getByTestId('makeup-stock-panel')).toBeHidden()

    await validTarget.click()
    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? の振替を/)
    await expect(validName).toHaveText('青木太郎')
  })

  test('同コマに同生徒がいる場合は移動不可で移動中状態を維持する', async ({ page }) => {
    const currentWeekStart = getWeekStart(new Date())
    const mondayDates = getMonthWeekdayDates(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), 1)
      .filter((dateKey) => dateKey < toDateKey(currentWeekStart))
    const [firstHoliday, secondHoliday] = mondayDates.slice(-2)

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
    const { slotId: blockedSlotId, cellTestIds: [blockerCellTestId, blockedTargetTestId] } = await findSlotWithEmptyCells(page, currentWeekStart, 2, '青木太郎')
    const sourceCell = page.getByTestId(`student-cell-${toDateKey(currentWeekStart)}_1-0-0`)
    const blockedTarget = page.getByTestId(blockedTargetTestId)
    const blockedTargetName = page.getByTestId(blockedTargetTestId.replace('student-cell-', 'student-name-'))
    const { cellTestIds: [validTargetTestId] } = await findSlotWithEmptyCells(page, currentWeekStart, 1, '青木太郎', blockedSlotId)
    const validTarget = page.getByTestId(validTargetTestId)
    const validName = page.getByTestId(validTargetTestId.replace('student-cell-', 'student-name-'))

    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(blockerCellTestId).click()
    await expect(page.getByTestId(blockerCellTestId.replace('student-cell-', 'student-name-'))).toHaveText('青木太郎')
    await expect(blockedTargetName).toHaveText('')

    await page.getByTestId('cancel-selection-button').click()

    await sourceCell.click()
    await page.getByTestId('menu-move-button').click()
    await blockedTarget.click()

    await expect(page.getByTestId('toolbar-status')).toContainText('同コマにすでに青木太郎が組まれているため移動不可です。')
    await expect(page.getByTestId('cancel-selection-button')).toBeVisible()

    await validTarget.click()
    await expect(page.getByTestId('toolbar-status')).toContainText(/青木太郎(?: \([^)]*\))? を/)
    await expect(validName).toHaveText('青木太郎')
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

  test('月途中で始まり終わる通常授業は対象曜日の回数だけ契約回数に数える', async () => {
    const currentSchoolYear = resolveOperationalSchoolYear(new Date())
    const schoolYearStart = new Date(currentSchoolYear, 3, 1)
    const schoolYearEnd = new Date(currentSchoolYear + 1, 2, 31)

    let targetMonthTuesdays: string[] | null = null
    for (let year = schoolYearStart.getFullYear(); year <= schoolYearEnd.getFullYear() && !targetMonthTuesdays; year += 1) {
      const monthStart = year === schoolYearStart.getFullYear() ? schoolYearStart.getMonth() : 0
      const monthEnd = year === schoolYearEnd.getFullYear() ? schoolYearEnd.getMonth() : 11
      for (let monthIndex = monthStart; monthIndex <= monthEnd; monthIndex += 1) {
        const tuesdays = getMonthWeekdayDates(year, monthIndex, 2)
        if (tuesdays.length >= 5) {
          targetMonthTuesdays = tuesdays
          break
        }
      }
    }

    if (!targetMonthTuesdays) throw new Error('5回ある火曜の月が見つかりません')

    const weeks = targetMonthTuesdays.slice(1, 5).map((dateKey, index) => [{
      id: `${dateKey}_5`,
      dateKey,
      dayLabel: '火',
      dateLabel: `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`,
      slotLabel: '5限',
      slotNumber: 5,
      timeLabel: '19:40-21:10',
      isOpenDay: true,
      desks: [{
        id: `${dateKey}_5_desk_1`,
        teacher: '契約回数検証講師',
        lesson: {
          id: `managed_quota-lesson_${dateKey}`,
          studentSlots: [{
            id: 'quota-student',
            name: '契約回数検証生徒',
            grade: '中2',
            subject: '数',
            lessonType: 'regular',
            teacherType: 'normal',
          }, null],
        },
      }],
    }])

    const entries = buildMakeupStockEntries({
      students: [{
        id: 'quota-student',
        name: '契約回数検証生徒',
        displayName: '契約回数検証生徒',
        email: 'quota-student@example.com',
        entryDate: `${currentSchoolYear}-04-01`,
        withdrawDate: '未定',
        birthDate: '2011-04-10',
        isHidden: false,
      }],
      teachers: [{
        id: 'quota-teacher',
        name: '契約回数検証講師',
        email: 'quota-teacher@example.com',
        entryDate: `${currentSchoolYear}-04-01`,
        withdrawDate: '未定',
        isHidden: false,
        subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
        memo: '',
      }],
      regularLessons: [{
        id: 'quota-lesson',
        schoolYear: currentSchoolYear,
        teacherId: 'quota-teacher',
        student1Id: 'quota-student',
        subject1: '数',
        startDate: targetMonthTuesdays[1],
        endDate: targetMonthTuesdays[3],
        student2Id: '',
        subject2: '',
        student2StartDate: '',
        student2EndDate: '',
        nextStudent1Id: '',
        nextSubject1: '',
        nextStudent2Id: '',
        nextSubject2: '',
        dayOfWeek: 2,
        slotNumber: 5,
      }],
      classroomSettings: {
        closedWeekdays: [0],
        holidayDates: [],
        forceOpenDates: [],
        deskCount: 1,
      },
      weeks,
      manualAdjustments: {},
      resolveStudentKey: (student) => student.id,
    })

    const stockEntry = entries.find((entry) => entry.studentId === 'quota-student' && entry.subject === '数')
    expect(stockEntry).toBeTruthy()
    expect(stockEntry?.totalLessonCount).toBe(3)
    expect(stockEntry?.assignedRegularLessons).toBe(4)
    expect(stockEntry?.overAssignedRegularLessons).toBe(1)
    expect(stockEntry?.balance).toBe(-1)
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

  test('生徒日程を開いたまま生徒追加を反映できる', async ({ page }) => {
    const activeEntryDate = '2024-04-01'

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await expect(popup.locator('.sheet').first()).toBeVisible()
    await restoreBoardInteraction(page)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-students').click()
    await page.getByTestId('basic-data-student-draft-name').fill('開いたまま追加E2E生徒')
    await page.getByTestId('basic-data-student-draft-display-name').fill('開いたまま追加E2E生徒')
    await setHiddenDateInput(page, 'basic-data-student-draft-entry-date-input', activeEntryDate)
    await setHiddenDateInput(page, 'basic-data-student-draft-birthdate-input', '2012-04-10')
    await page.getByTestId('basic-data-add-student-button').click()

    await expect(popup.locator('section.sheet').filter({ hasText: '開いたまま追加E2E生徒' }).first()).toBeVisible()
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

  test('講師日程を開いたまま講師追加を反映できる', async ({ page }) => {
    const activeEntryDate = '2024-04-01'

    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-teacher-schedule-button').click()
    const popup = await popupPromise

    await expect(popup.locator('.sheet').first()).toBeVisible()
    await restoreBoardInteraction(page)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-teachers').click()
    await page.getByTestId('basic-data-teacher-draft-name').fill('開いたまま追加E2E講師')
    await page.getByTestId('basic-data-teacher-draft-email').fill('open-popup-teacher@example.com')
    await setHiddenDateInput(page, 'basic-data-teacher-draft-entry-date-input', activeEntryDate)
    await page.getByTestId('basic-data-add-teacher-button').click()

    await expect(popup.locator('section.sheet').filter({ hasText: '開いたまま追加E2E講師' }).first()).toBeVisible()
  })

  test('開いた日程表は生徒と講師の退塾を即座に反映する', async ({ page }) => {
    const withdrawnDateKey = toDateKey(addDays(getWeekStart(new Date()), -1))

    await page.goto('/')

    const studentPopupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const studentPopup = await studentPopupPromise
    await expect(studentPopup.locator('[data-role="student-sheet"][data-student-id="s001"]')).toHaveCount(1)
    await restoreBoardInteraction(page)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-students').click()

    await page.getByTestId('basic-data-edit-student-s001').click()
    const editableStudentRow = page.getByTestId('basic-data-edit-student-s001').locator('xpath=ancestor::tr')
    await editableStudentRow.locator('input[type="date"]').nth(1).fill(withdrawnDateKey)
    await expect(studentPopup.locator('[data-role="student-sheet"][data-student-id="s001"]')).toHaveCount(0)

    await studentPopup.close()
    await navigateFromBasicDataToBoard(page)
    await expect(page.getByTestId('board-student-schedule-button')).toBeEnabled()

    const teacherPopupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-teacher-schedule-button').click()
    const teacherPopup = await teacherPopupPromise
    await expect(teacherPopup.locator('[data-role="teacher-sheet"][data-teacher-id="t001"]')).toHaveCount(1)
    await restoreBoardInteraction(page)

    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await page.getByTestId('basic-data-tab-teachers').click()

    await page.getByTestId('basic-data-edit-teacher-t001').click()
    const editableTeacherRow = page.getByTestId('basic-data-edit-teacher-t001').locator('xpath=ancestor::tr')
    await editableTeacherRow.locator('input[type="date"]').nth(1).fill(withdrawnDateKey)
    await expect(teacherPopup.locator('[data-role="teacher-sheet"][data-teacher-id="t001"]')).toHaveCount(0)
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

  test('生徒日程で出席不可グレーアウトと希望科目数提出を登録解除まで操作できる', async ({ page }) => {
    await page.goto('/')

    const specialWeekStart = getWeekStart(new Date('2026-03-23'))

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')

    const targetSheet = popup.locator('[data-role="student-sheet"][data-student-id="s001"]')
    const dayToggle = targetSheet.locator('[data-role="toggle-student-unavailable-date"]').first()
    const periodButton = popup.getByTestId('student-schedule-period-button-s001-session_2026_spring')

    await expect(dayToggle).toBeVisible()
    await expect(periodButton).toContainText('希望科目数設定はここをクリック')

    await dayToggle.click()
    await expect.poll(async () => targetSheet.locator('.slot-cell.is-unavailable').count()).toBeGreaterThan(0)

    await periodButton.click()
    await expect(popup.getByTestId('student-schedule-count-modal')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-subject-数')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-subject-算')).toHaveCount(0)
    await expect(popup.getByTestId('student-schedule-count-unregister')).toHaveCount(0)
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()
    await expect(periodButton).toContainText('希望科目数登録済')
    await expect(targetSheet.locator('[data-role="toggle-student-unavailable-date"]')).toHaveCount(0)

    await restoreBoardInteraction(page)
    await moveBoardToWeek(page, specialWeekStart)
    const target = await findEmptyStudentCellWithTeacher(page, specialWeekStart, '青木太郎')
    const targetMatch = target.cellTestId.match(/^student-cell-(.+)-(\d+)-(\d+)$/)
    expect(targetMatch).toBeTruthy()
    const teacherCell = page.getByTestId(`teacher-cell-${targetMatch?.[1]}-${targetMatch?.[2]}`)
    await expect(teacherCell).toContainText(target.teacherName)
    await page.getByTestId('lecture-stock-chip').click()
    await page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' }).first().click()
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(target.cellTestId).click()
    const targetName = page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))
    const targetPopupCell = popup.getByTestId(`student-schedule-cell-s001-${target.slotId}`)
    await expect(targetName).toHaveText('青木太郎')
    await expect.poll(async () => ((await targetPopupCell.textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain('講習')

    await periodButton.click()
    await expect(popup.getByTestId('student-schedule-count-unregister')).toBeVisible()
    await expect(popup.getByText('登録解除すると、コマ表からこの生徒だけ外します。講師は残ります。')).toBeVisible()
    await expect(popup.getByTestId('student-schedule-count-register')).toHaveCount(0)
    await expect(popup.getByTestId('student-schedule-count-subject-数')).toHaveCount(0)
    await expect(popup.getByTestId('student-schedule-count-regular-only')).toHaveCount(0)
    await popup.getByTestId('student-schedule-count-unregister').click()
    await expect(periodButton).toContainText('希望科目数設定はここをクリック')
    await expect.poll(async () => targetSheet.locator('[data-role="toggle-student-unavailable-date"]').count()).toBeGreaterThan(0)
    await expect(targetName).toHaveText('')
    await expect.poll(async () => ((await targetPopupCell.textContent()) ?? '').replace(/\s+/g, '').trim()).toBe('')
    await expect(teacherCell).toContainText(target.teacherName)

    await page.getByTestId('lecture-stock-chip').click()
    await expect(page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' })).toHaveCount(0)

    await periodButton.click()
    await popup.getByTestId('student-schedule-count-subject-数').fill('1')
    await popup.getByTestId('student-schedule-count-register').click()
    await expect(periodButton).toContainText('希望科目数登録済')
    await page.getByTestId('lecture-stock-chip').click()
    await expect(page.locator('[data-testid^="lecture-stock-entry-"]').filter({ hasText: '青木太郎' })).toContainText('+1')
  })

  test('講師日程で参加不可グレーアウトと講習期間登録を登録解除まで操作できる', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-teacher-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-23', '2026-03-29')

    const targetSheet = popup.locator('[data-role="teacher-sheet"]').first()
    const dayToggle = targetSheet.locator('[data-role="toggle-teacher-unavailable-date"]').first()
    const periodButton = targetSheet.locator('[data-role="open-teacher-register-modal"]').first()

    await expect(dayToggle).toBeVisible()
    await expect(periodButton).toContainText('講師予定をここをクリックして登録')

    await dayToggle.click()
    await expect.poll(async () => targetSheet.locator('.slot-cell.is-unavailable').count()).toBeGreaterThan(0)

    await periodButton.click()
    await expect(popup.getByTestId('teacher-schedule-register-modal')).toBeVisible()
    await expect(popup.getByTestId('teacher-schedule-register-unregister')).toHaveCount(0)
    await popup.getByTestId('teacher-schedule-register-submit').click()
    await expect(periodButton).toContainText('講師予定登録済')
    await expect(targetSheet.locator('[data-role="toggle-teacher-unavailable-date"]')).toHaveCount(0)

    await periodButton.click()
    await expect(popup.getByTestId('teacher-schedule-register-unregister')).toBeVisible()
    await expect(popup.getByText('登録解除すると、コマ表からこの講師だけ外します。生徒は残ります。')).toBeVisible()
    await expect(popup.getByTestId('teacher-schedule-register-submit')).toHaveCount(0)
    await popup.getByTestId('teacher-schedule-register-unregister').click()
    await expect(periodButton).toContainText('講師予定をここをクリックして登録')
    await expect.poll(async () => targetSheet.locator('[data-role="toggle-teacher-unavailable-date"]').count()).toBeGreaterThan(0)
  })

  test('講師日程の講習期間登録で参加可能コマへ講師をコマ表に自動登録する', async ({ page }) => {
    await page.goto('/')

    const popupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-teacher-schedule-button').click()
    const popup = await popupPromise

    await setScheduleRangeInPopup(popup, '2026-03-30', '2026-04-05')

    const teacherId = 't009'
    const targetSheet = popup.locator(`[data-role="teacher-sheet"][data-teacher-id="${teacherId}"]`)
    await expect(targetSheet).toBeVisible()

    await popup.getByTestId(`teacher-schedule-day-toggle-${teacherId}-2026-04-01`).click()
    await expect.poll(async () => targetSheet.locator('.slot-cell.is-unavailable').count()).toBeGreaterThan(0)

    await popup.getByTestId(`teacher-schedule-period-button-${teacherId}-session_2026_spring`).click()
    await expect(popup.getByTestId('teacher-schedule-register-modal')).toBeVisible()
    await popup.getByTestId('teacher-schedule-register-submit').click()

    await moveBoardToWeek(page, new Date(2026, 2, 30))

    await expect.poll(async () => countTeacherAssignmentsByDate(page, '2026-04-01', '加藤講師')).toBe(0)
    await expect.poll(async () => countTeacherSourceTooltipsByDate(page, '2026-04-01')).toBe(0)
    await expect.poll(async () => {
      const april2 = await countTeacherAssignmentsByDate(page, '2026-04-02', '加藤講師')
      const april3 = await countTeacherAssignmentsByDate(page, '2026-04-03', '加藤講師')
      const april4 = await countTeacherAssignmentsByDate(page, '2026-04-04', '加藤講師')
      return april2 + april3 + april4
    }).toBeGreaterThan(0)
    await expect.poll(async () => {
      const april2 = await countTeacherSourceTooltipsByDate(page, '2026-04-02')
      const april3 = await countTeacherSourceTooltipsByDate(page, '2026-04-03')
      const april4 = await countTeacherSourceTooltipsByDate(page, '2026-04-04')
      return april2 + april3 + april4
    }).toBeGreaterThan(0)

    await popup.getByTestId(`teacher-schedule-period-button-${teacherId}-session_2026_spring`).click()
    await expect(popup.getByTestId('teacher-schedule-register-unregister')).toBeVisible()
    await popup.getByTestId('teacher-schedule-register-unregister').click()

    await expect.poll(async () => {
      const april2 = await countTeacherAssignmentsByDate(page, '2026-04-02', '加藤講師')
      const april3 = await countTeacherAssignmentsByDate(page, '2026-04-03', '加藤講師')
      const april4 = await countTeacherAssignmentsByDate(page, '2026-04-04', '加藤講師')
      return april2 + april3 + april4
    }).toBe(0)
    await expect.poll(async () => {
      const april2 = await countTeacherSourceTooltipsByDate(page, '2026-04-02')
      const april3 = await countTeacherSourceTooltipsByDate(page, '2026-04-03')
      const april4 = await countTeacherSourceTooltipsByDate(page, '2026-04-04')
      return april2 + april3 + april4
    }).toBe(0)
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
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()

    await expect(page.getByTestId('makeup-stock-panel')).toBeHidden()
    await expect(page.getByTestId('makeup-stock-chip')).toContainText('振替移動中')

    await targetCell.click()

    await expect(page.getByTestId('makeup-stock-panel')).toBeHidden()
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
    await restoreBoardInteraction(page)
    await page.getByTestId(`day-header-${currentMondayKey}`).click()

    await expect.poll(async () => popup.locator('.slot-cell.is-holiday').count()).toBeGreaterThan(holidayCountBefore)
  })

  test('振替を配置すると開いた生徒日程と講師日程の振替欄が同期する', async ({ page }) => {
    const today = new Date()
    const mondayDates = getMonthWeekdayDates(today.getFullYear(), today.getMonth(), 1).filter((dateKey) => dateKey <= toDateKey(today))
    const [firstHoliday] = mondayDates
    const currentWeekStart = getWeekStart(today)

    test.skip(!firstHoliday, '現在月に判定用の月曜が必要です。')

    await page.goto('/')

    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await moveBoardToWeek(page, parseDateKey(firstHoliday))
    await page.getByTestId(`day-header-${firstHoliday}`).click()

    await moveBoardToWeek(page, currentWeekStart)

    const studentPopupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-student-schedule-button').click()
    const studentPopup = await studentPopupPromise
    await restoreBoardInteraction(page)

    const teacherPopupPromise = page.waitForEvent('popup')
    await page.getByTestId('board-teacher-schedule-button').click()
    const teacherPopup = await teacherPopupPromise
    await restoreBoardInteraction(page)

    const target = await findEmptyStudentCellWithTeacher(page, currentWeekStart, '青木太郎')
    const slotMatch = target.slotId.match(/^(\d{4}-\d{2}-\d{2})_(\d+)$/)
    if (!slotMatch) throw new Error(`target slot id parse failed: ${target.slotId}`)
    const [, targetDateKey, targetSlotNumberText] = slotMatch
    const expectedTargetLabel = `${toOriginDateLabel(parseDateKey(targetDateKey))}${targetSlotNumberText}限`

    await page.getByTestId('makeup-stock-chip').click()
    await openStockActionModal(page, 'makeup-stock-entry-s001__-')
    await page.getByTestId('stock-action-modal-manual').click()
    await page.getByTestId(target.cellTestId).click()

    await expect(page.getByTestId(target.cellTestId.replace('student-cell-', 'student-name-'))).toHaveText('青木太郎')

    const studentSheet = studentPopup.locator('section.sheet[data-student-id="s001"]')
    const teacherSheet = teacherPopup.locator('section.sheet').filter({ hasText: target.teacherName }).first()

    await expect.poll(async () => ((await studentSheet.locator('.makeup-table').textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain('→')
    await expect.poll(async () => ((await studentSheet.locator('.makeup-table').textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain(expectedTargetLabel)
    await expect.poll(async () => ((await teacherSheet.locator('.makeup-table').textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain('→')
    await expect.poll(async () => ((await teacherSheet.locator('.makeup-table').textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain('青木太郎')
    await expect.poll(async () => ((await teacherSheet.locator('.makeup-table').textContent()) ?? '').replace(/\s+/g, ' ').trim()).toContain(expectedTargetLabel)
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

    await expect(page.getByTestId('toolbar-status')).toContainText('休校セルにはメモを保存できません。')
    await expect(page.getByTestId('student-action-menu')).toHaveCount(0)
  })
})