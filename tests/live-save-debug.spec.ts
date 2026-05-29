import { expect, test, type Page } from '@playwright/test'

const enabled = process.env.RUN_LIVE_FIREBASE_SAVE_DEBUG === '1'
const email = process.env.LIVE_FIREBASE_EMAIL ?? ''
const password = process.env.LIVE_FIREBASE_PASSWORD ?? ''
const targetClassroomId = process.env.LIVE_FIREBASE_CLASSROOM_ID ?? 'v8OZ7zH8vONNHjjYVcR1'

type SaveDiagnosticEntry = {
  at: string
  elapsedMs: number
  stage: string
  percent?: number
  label?: string
  details?: Record<string, unknown>
}

async function login(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 20000 })
  await page.getByTestId('firebase-login-email').fill(email)
  await page.getByTestId('firebase-login-password').fill(password)
  await page.getByTestId('firebase-login-submit').click()
}

async function openTargetClassroom(page: Page) {
  const saveButton = page.getByTestId('save-board-button')
  if (await saveButton.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false)) return

  const classroomCard = page.getByTestId(`developer-classroom-${targetClassroomId}`)
  await expect(classroomCard).toBeVisible({ timeout: 30000 })
  await classroomCard.getByRole('button', { name: 'この教室を開く' }).click()
  await expect(saveButton).toBeVisible({ timeout: 30000 })
}

async function copyDiagnostics(page: Page) {
  await page.getByTestId('copy-save-diagnostics-button').click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  return JSON.parse(text) as SaveDiagnosticEntry[]
}

function getLatestFirebaseRun(diagnostics: SaveDiagnosticEntry[]) {
  const lastStartIndex = diagnostics.map((entry) => entry.stage).lastIndexOf('firebase-start')
  if (lastStartIndex < 0) return diagnostics
  return diagnostics.slice(lastStartIndex)
}

async function waitForLatestFirebaseRun(page: Page, timeoutMs: number) {
  const startedAt = Date.now()
  let latestRun: SaveDiagnosticEntry[] = []
  while (Date.now() - startedAt < timeoutMs) {
    const diagnostics = await copyDiagnostics(page)
    latestRun = getLatestFirebaseRun(diagnostics)
    const success = latestRun.find((entry) => entry.stage === 'firebase-success')
    if (success) return latestRun
    const failure = latestRun.find((entry) => entry.stage === 'firebase-failure')
    if (failure) throw new Error(`Firebase save failed: ${JSON.stringify(failure, null, 2)}`)
    await page.waitForTimeout(5000)
  }
  throw new Error(`Firebase save did not complete within ${timeoutMs}ms. Latest run: ${JSON.stringify(latestRun, null, 2)}`)
}

test.describe('live Firebase save diagnostics', () => {
  test.skip(!enabled, 'Set RUN_LIVE_FIREBASE_SAVE_DEBUG=1 to run this opt-in live Firebase diagnostic test.')
  test.skip(!email || !password, 'Set LIVE_FIREBASE_EMAIL and LIVE_FIREBASE_PASSWORD for the live Firebase diagnostic test.')

  test('manual save uses the no-op or small-save atomic batch path and completes', async ({ context, page }) => {
    test.setTimeout(240000)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    await login(page)
    await openTargetClassroom(page)

    await page.getByTestId('save-board-button').click()
    const latestRun = await waitForLatestFirebaseRun(page, 180000)
    const initialWrite = latestRun.find((entry) => entry.stage === 'firebase-progress' && entry.details?.payloadDocCount !== undefined)
    const success = latestRun.find((entry) => entry.stage === 'firebase-success')

    expect(success).toBeTruthy()
    expect(['no-op', 'parallel-set-doc']).toContain(initialWrite?.details?.writeMode)
    expect(Number(initialWrite?.details?.payloadDocCount ?? 0)).toBeLessThanOrEqual(50)

    console.log(JSON.stringify({
      savedAt: success?.details?.savedAt,
      elapsedMs: success?.elapsedMs,
      writeMode: initialWrite?.details?.writeMode,
      payloadDocCount: initialWrite?.details?.payloadDocCount,
      totalBytes: initialWrite?.details?.totalBytes,
      maxKind: initialWrite?.details?.maxKind,
      maxBytes: initialWrite?.details?.maxBytes,
      largestDocs: initialWrite?.details?.largestDocs,
    }, null, 2))
  })
})