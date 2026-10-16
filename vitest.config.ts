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
    // src の *.test.tsx(JSX で描画を確かめるテスト・BusyOverlay.test.tsx など)も含める。以前は外れていて CI で走っていなかった(2026-10-16)。
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'functions/src/**/*.test.ts', 'tools/**/*.test.mjs'],
  },
})