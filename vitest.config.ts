import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // src(アプリ) と functions(Cloud Functions) の純粋ロジックの両方をユニットテスト対象にする。
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts'],
  },
})