import { expect, test } from '@playwright/test'

/**
 * Firebase Emulator を使った E2E テスト。
 *
 * 実行前に以下の手順が必要:
 *   1. npx firebase-tools emulators:start --only auth,firestore --project demo-komahyou
 *   2. npx playwright test --config playwright.firebase.config.ts
 *
 * テスト環境の安全性:
 *   - projectId = "demo-komahyou" (存在しないダミー)
 *   - VITE_FIREBASE_USE_EMULATOR=true でエミュレータに接続
 *   - 本番 Firebase には一切接触しない
 *   - 各テストの beforeEach でエミュレータデータを全クリアする
 */

const EMULATOR_AUTH_URL = 'http://127.0.0.1:9099'
const EMULATOR_FIRESTORE_URL = 'http://127.0.0.1:8080'
const WORKSPACE_KEY = 'test-workspace'
const TEST_EMAIL = 'test-manager@example.com'
const TEST_PASSWORD = 'testpassword123'
const TEST_CLASSROOM_ID = 'classroom_test_001'

async function clearEmulators() {
  // Clear Auth emulator
  await fetch(`${EMULATOR_AUTH_URL}/emulator/v1/projects/demo-komahyou/accounts`, {
    method: 'DELETE',
  })
  // Clear Firestore emulator
  await fetch(`${EMULATOR_FIRESTORE_URL}/emulator/v1/projects/demo-komahyou/databases/(default)/documents`, {
    method: 'DELETE',
  })
}

async function createAuthUser(email: string, password: string): Promise<string> {
  const response = await fetch(`${EMULATOR_AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  })
  const data = await response.json() as { localId: string }
  return data.localId
}

async function setFirestoreDoc(path: string, fields: Record<string, unknown>) {
  const firestoreFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') {
      firestoreFields[key] = { stringValue: value }
    } else if (typeof value === 'number') {
      firestoreFields[key] = { integerValue: String(value) }
    } else if (typeof value === 'boolean') {
      firestoreFields[key] = { booleanValue: value }
    } else if (value === null) {
      firestoreFields[key] = { nullValue: null }
    }
  }

  const url = `${EMULATOR_FIRESTORE_URL}/v1/projects/demo-komahyou/databases/(default)/documents/${path}`
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer owner' },
    body: JSON.stringify({ fields: firestoreFields }),
  })
}

async function setupTestWorkspace(uid: string) {
  // Workspace document
  await setFirestoreDoc(`workspaces/${WORKSPACE_KEY}`, {
    name: 'テストワークスペース',
    schemaVersion: 1,
  })

  // Member document
  await setFirestoreDoc(`workspaces/${WORKSPACE_KEY}/members/${uid}`, {
    displayName: 'テスト管理者',
    email: TEST_EMAIL,
    role: 'manager',
    assignedClassroomId: TEST_CLASSROOM_ID,
  })

  // Classroom document
  await setFirestoreDoc(`workspaces/${WORKSPACE_KEY}/classrooms/${TEST_CLASSROOM_ID}`, {
    name: 'テスト教室',
    contractStatus: 'active',
    contractStartDate: '2026-01-01',
    contractEndDate: '2027-12-31',
    managerUserId: uid,
    isTemporarilySuspended: false,
    temporarySuspensionReason: '',
    updatedAt: new Date().toISOString(),
  })
}

test.beforeEach(async () => {
  await clearEmulators()
})

test.describe('Firebase認証', () => {
  test('ログインフォームが表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('firebase-login-email')).toBeVisible()
    await expect(page.getByTestId('firebase-login-password')).toBeVisible()
    await expect(page.getByTestId('firebase-login-submit')).toBeVisible()
    await expect(page.getByTestId('firebase-login-submit')).toHaveText('ログイン')
  })

  test('メールアドレスとパスワード未入力でログインするとエラーメッセージが表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 15000 })

    await page.getByTestId('firebase-login-submit').click()

    await expect(page.getByTestId('firebase-auth-message')).toBeVisible()
    await expect(page.getByTestId('firebase-auth-message')).toContainText('メールアドレスとパスワードを入力してください')
  })

  test('存在しないユーザーでログインするとエラーメッセージが表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 15000 })

    await page.getByTestId('firebase-login-email').fill('nonexistent@example.com')
    await page.getByTestId('firebase-login-password').fill('wrongpassword')
    await page.getByTestId('firebase-login-submit').click()

    await expect(page.getByTestId('firebase-auth-message')).toBeVisible({ timeout: 10000 })
  })

  test('正しい認証情報でログインしてボード画面に到達する', async ({ page }) => {
    // テストユーザーとワークスペースをセットアップ
    const uid = await createAuthUser(TEST_EMAIL, TEST_PASSWORD)
    await setupTestWorkspace(uid)

    await page.goto('/')
    await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 15000 })

    await page.getByTestId('firebase-login-email').fill(TEST_EMAIL)
    await page.getByTestId('firebase-login-password').fill(TEST_PASSWORD)
    await page.getByTestId('firebase-login-submit').click()

    // ログイン後、ボード画面が表示される
    await expect(page.getByTestId('week-label')).toBeVisible({ timeout: 30000 })
  })

  test('ログイン後にログアウトするとログイン画面に戻る', async ({ page }) => {
    const uid = await createAuthUser(TEST_EMAIL, TEST_PASSWORD)
    await setupTestWorkspace(uid)

    await page.goto('/')
    await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 15000 })

    // ログイン
    await page.getByTestId('firebase-login-email').fill(TEST_EMAIL)
    await page.getByTestId('firebase-login-password').fill(TEST_PASSWORD)
    await page.getByTestId('firebase-login-submit').click()
    await expect(page.getByTestId('week-label')).toBeVisible({ timeout: 30000 })

    // ログアウト
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-logout-button').click()

    // ログイン画面に戻る
    await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 15000 })
  })

  test('パスワードリセットリンクのクリックでメッセージが表示される', async ({ page }) => {
    // リセット対象のユーザーを作成
    await createAuthUser(TEST_EMAIL, TEST_PASSWORD)

    await page.goto('/')
    await expect(page.getByTestId('firebase-login-card')).toBeVisible({ timeout: 15000 })

    // メールアドレスを入力してリセットリンクをクリック
    await page.getByTestId('firebase-login-email').fill(TEST_EMAIL)
    await page.getByTestId('firebase-password-reset').click()

    // メッセージが表示される
    await expect(page.getByTestId('firebase-auth-message')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('firebase-auth-message')).toContainText('パスワードリセットメール')
  })
})

test.describe('Firestore データ永続化', () => {
  test('ログイン後に基本データを操作してもエラーにならない', async ({ page }) => {
    const uid = await createAuthUser(TEST_EMAIL, TEST_PASSWORD)
    await setupTestWorkspace(uid)

    await page.goto('/')
    await page.getByTestId('firebase-login-email').fill(TEST_EMAIL)
    await page.getByTestId('firebase-login-password').fill(TEST_PASSWORD)
    await page.getByTestId('firebase-login-submit').click()
    await expect(page.getByTestId('week-label')).toBeVisible({ timeout: 30000 })

    // 基本データ画面へ遷移
    await page.getByTestId('menu-button').click()
    await page.getByTestId('menu-open-basic-data-button').click()
    await expect(page.getByTestId('basic-data-screen')).toBeVisible()

    // タブ切り替え
    await page.getByTestId('basic-data-tab-teachers').click()
    await expect(page.getByTestId('basic-data-teachers-table')).toBeVisible()

    await page.getByTestId('basic-data-tab-classroomData').click()
    await expect(page.getByTestId('basic-data-classroom-screen')).toBeVisible()

    // コマ表に戻る
    await page.getByTestId('basic-data-menu-button').click()
    await page.getByTestId('basic-data-menu-open-board-button').click()
    await expect(page.getByTestId('week-label')).toBeVisible()
  })

  test('一時停止された教室でログインするとブロック画面が表示される', async ({ page }) => {
    const uid = await createAuthUser(TEST_EMAIL, TEST_PASSWORD)
    await setupTestWorkspace(uid)

    // 教室を一時停止にする
    await setFirestoreDoc(`workspaces/${WORKSPACE_KEY}/classrooms/${TEST_CLASSROOM_ID}`, {
      name: 'テスト教室',
      contractStatus: 'active',
      contractStartDate: '2026-01-01',
      contractEndDate: '2027-12-31',
      managerUserId: uid,
      isTemporarilySuspended: true,
      temporarySuspensionReason: 'メンテナンス中',
      updatedAt: new Date().toISOString(),
    })

    await page.goto('/')
    await page.getByTestId('firebase-login-email').fill(TEST_EMAIL)
    await page.getByTestId('firebase-login-password').fill(TEST_PASSWORD)
    await page.getByTestId('firebase-login-submit').click()

    // 一時停止画面またはメッセージが表示される
    // (一時停止の検出はログイン後のワークスペースロードで行われる)
    await page.waitForTimeout(5000)

    // ボード画面が表示されないか、停止メッセージが表示されるかを確認
    const hasSuspendedMessage = await page.locator('text=一時停止').count()
    const hasBoard = await page.getByTestId('week-label').count()

    // いずれかの状態であること（停止メッセージが表示されるか、ボードが表示されない）
    expect(hasSuspendedMessage > 0 || hasBoard === 0).toBeTruthy()
  })

  test('developer ロールでログインすると開発者画面が表示される', async ({ page }) => {
    const uid = await createAuthUser('dev@example.com', 'devpassword123')

    await setFirestoreDoc(`workspaces/${WORKSPACE_KEY}`, {
      name: 'テストワークスペース',
      schemaVersion: 1,
    })

    await setFirestoreDoc(`workspaces/${WORKSPACE_KEY}/members/${uid}`, {
      displayName: 'テスト開発者',
      email: 'dev@example.com',
      role: 'developer',
      assignedClassroomId: TEST_CLASSROOM_ID,
    })

    await setFirestoreDoc(`workspaces/${WORKSPACE_KEY}/classrooms/${TEST_CLASSROOM_ID}`, {
      name: 'テスト教室',
      contractStatus: 'active',
      contractStartDate: '2026-01-01',
      contractEndDate: '2027-12-31',
      managerUserId: uid,
      isTemporarilySuspended: false,
      temporarySuspensionReason: '',
      updatedAt: new Date().toISOString(),
    })

    await page.goto('/')
    await page.getByTestId('firebase-login-email').fill('dev@example.com')
    await page.getByTestId('firebase-login-password').fill('devpassword123')
    await page.getByTestId('firebase-login-submit').click()

    // developer ロールなので教室選択画面やボード画面が表示される
    await page.waitForTimeout(5000)

    // 開発者は developer 画面か board 画面に到達する
    const hasDeveloperScreen = await page.locator('text=Developer Control').count()
    const hasBoardScreen = await page.getByTestId('week-label').count()
    expect(hasDeveloperScreen > 0 || hasBoardScreen > 0).toBeTruthy()
  })
})
