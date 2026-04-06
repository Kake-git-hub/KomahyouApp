import { defineConfig, devices } from '@playwright/test'

/**
 * Firebase Emulator を使った E2E テスト用設定。
 * 実行コマンド: npx playwright test --config playwright.firebase.config.ts
 *
 * 前提: Firebase Emulator が別ターミナルで起動済みであること。
 *   npx firebase-tools emulators:start --only auth,firestore
 */
export default defineConfig({
  testDir: './tests',
  testMatch: 'firebase-*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --force',
    url: 'http://127.0.0.1:4174',
    env: {
      ...process.env,
      VITE_EXTERNAL_BACKEND_MODE: 'firebase',
      VITE_FIREBASE_API_KEY: 'fake-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
      VITE_FIREBASE_PROJECT_ID: 'demo-komahyou',
      VITE_FIREBASE_STORAGE_BUCKET: '',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '',
      VITE_FIREBASE_APP_ID: 'demo-app-id',
      VITE_FIREBASE_WORKSPACE_KEY: 'test-workspace',
      VITE_FIREBASE_USE_EMULATOR: 'true',
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
