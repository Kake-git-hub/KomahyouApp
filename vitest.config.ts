import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 会社レイヤの alias(vite.config.ts と同じ定義)。
  resolve: {
    alias: {
      '@company': resolve('src/company'),
    },
  },
  test: {
    // src(アプリ) と functions(Cloud Functions) の純粋ロジックに加え、tools(CI 用スクリプト)も対象にする。
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts', 'tools/**/*.test.mjs'],
  },
})