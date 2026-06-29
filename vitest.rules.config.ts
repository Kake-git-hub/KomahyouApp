import { defineConfig } from 'vitest/config'

// Firestore セキュリティルールの分離テスト専用。エミュレータが必要なため通常の
// `vitest run`(vitest.config.ts: src/functions のみ)には含めず、`npm run test:rules` から
// firestore エミュレータ起動下で実行する。
export default defineConfig({
  test: {
    include: ['firebase/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // ルールテストは共有エミュレータ状態を触るため直列実行にする。
    fileParallelism: false,
  },
})
