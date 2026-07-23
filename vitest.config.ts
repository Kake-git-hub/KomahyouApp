import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // src(アプリ) と functions(Cloud Functions) の純粋ロジックに加え、tools(CI 用スクリプト)も対象にする。
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts', 'tools/**/*.test.mjs'],
  },
})