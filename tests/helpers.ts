import type { Page } from '@playwright/test'

export const REFERENCE_TODAY_ISO = '2026-03-23T09:00:00+09:00'

/**
 * Inject date-fixed addInitScript into page (must be called before page.goto)
 */
export function installFixedDate(page: Page) {
  return page.addInitScript((referenceIso) => {
    const fixedTime = new Date(referenceIso).getTime()
    const BrowserRealDate = Date

    class BrowserFixedDate extends BrowserRealDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        if (args.length === 0) {
          super(fixedTime)
          return
        }
        // @ts-expect-error spread
        super(...args)
      }

      static now() {
        return fixedTime
      }

      static parse(dateString: string) {
        return BrowserRealDate.parse(dateString)
      }

      static UTC(...args: Parameters<typeof Date.UTC>) {
        return BrowserRealDate.UTC(...args)
      }
    }

    Object.setPrototypeOf(BrowserFixedDate, BrowserRealDate)
    window.Date = BrowserFixedDate as DateConstructor
  }, REFERENCE_TODAY_ISO)
}

export async function setHiddenDateInput(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(input, String(nextValue))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

export async function setNumberInput(page: Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

export function acceptNextDialog(page: Page, expectedText?: string) {
  page.once('dialog', async (dialog) => {
    if (expectedText) {
      const { expect } = await import('@playwright/test')
      expect(dialog.message()).toContain(expectedText)
    }
    await dialog.accept()
  })
}

export function dismissNextDialog(page: Page) {
  page.once('dialog', async (dialog) => {
    await dialog.dismiss()
  })
}

export async function navigateToBoard(page: Page) {
  await page.goto('/')
  const { expect } = await import('@playwright/test')
  await expect(page.getByTestId('week-label')).toBeVisible({ timeout: 15000 })
}

export async function navigateFromBasicDataToBoard(page: Page) {
  await page.getByTestId('basic-data-menu-button').click()
  await page.getByTestId('basic-data-menu-open-board-button').click()
}

export async function navigateFromSpecialDataToBoard(page: Page) {
  await page.getByTestId('special-data-menu-button').click()
  await page.getByTestId('special-data-menu-open-board-button').click()
}

export async function navigateFromAutoAssignRulesToBoard(page: Page) {
  await page.getByTestId('auto-assign-rules-menu-button').click()
  await page.getByTestId('auto-assign-rules-menu-open-board-button').click()
}

export function addDays(date: Date, offset: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + offset)
  return next
}

export function getWeekStart(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)
  start.setHours(0, 0, 0, 0)
  return start
}

export function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function findFirstEmptyStudentCellTestId(page: Page, slotId: string) {
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

export async function restoreBoardInteraction(page: Page) {
  await page.getByTestId('toolbar-status').click()
}

export function parseSpecialCalendarMonthKey(label: string) {
  const match = label.match(/(\d+)年(\d+)月/)
  if (!match) throw new Error(`unexpected special calendar label: ${label}`)
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

export async function getSpecialSessionDateButton(page: Page, dateKey: string) {
  const targetMonthKey = dateKey.slice(0, 7)
  const previousMonthButton = page.getByTestId('special-data-create-form').getByRole('button', { name: '前月' })
  const nextMonthButton = page.getByTestId('special-data-create-form').getByRole('button', { name: '次月' })

  for (let step = 0; step < 18; step += 1) {
    const locator = page.getByTestId(`special-data-period-date-${dateKey}`)
    if (await locator.count()) return locator

    const visibleMonthKeys = (await page.locator('.special-session-calendar-head').allTextContents()).map(parseSpecialCalendarMonthKey)
    const firstVisibleMonthKey = visibleMonthKeys[0]
    const lastVisibleMonthKey = visibleMonthKeys[visibleMonthKeys.length - 1]
    if (!firstVisibleMonthKey || !lastVisibleMonthKey) break

    if (targetMonthKey < firstVisibleMonthKey) {
      await previousMonthButton.click()
      continue
    }

    if (targetMonthKey > lastVisibleMonthKey) {
      await nextMonthButton.click()
      continue
    }

    break
  }

  throw new Error(`special session date button not found for ${dateKey}`)
}
