// 保護者向け日程計算の権威 `src/utils/parentSchedule.ts` を functions 側へ複製する(spec-parent-portal.md §D
// 「クライアントと Cloud Functions の二重実装を禁止」)。functions は rootDir=src の別 TS プロジェクトで
// アプリ側 src/ を import できないため、ビルド前(prebuild)にこのスクリプトでそのまま写す。
//
// - 出力: functions/src/generated/parentSchedule.ts(ヘッダ 1 行 + 元ファイル。LF・決定的)
// - 生成物は **コミットする**(CI の vitest は functions build 前に走る)。
//   ズレは functions/src/parentSchedule.parity.test.ts が「生成物 = 元ファイル + ヘッダ」の文字列比較で検出する。
// - 元ファイルは import 0 行・import.meta なしが前提(複製先で解決できない)。ここでも検査して違反なら失敗させる。
//
// 使い方: `npm --prefix functions run sync-shared`(build 時は prebuild で自動実行)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')

export const SHARED_SOURCE_PATH = 'src/utils/parentSchedule.ts'
export const SHARED_OUTPUT_PATH = 'functions/src/generated/parentSchedule.ts'
export const SHARED_HEADER = '// GENERATED FROM src/utils/parentSchedule.ts — 手で編集しない。npm --prefix functions run sync-shared で再生成。'

export function normalizeToLf(text) {
  return text.replace(/\r\n?/g, '\n')
}

export function buildGeneratedContent(sourceText) {
  const source = normalizeToLf(sourceText)
  const violations = []
  if (/^\s*import\s/m.test(source) || /^\s*export\s+.*\sfrom\s+['"]/m.test(source)) violations.push('import / re-export 行が含まれている')
  if (source.includes('import.meta')) violations.push('import.meta が含まれている')
  if (/\brequire\s*\(/.test(source)) violations.push('require() が含まれている')
  if (violations.length > 0) {
    throw new Error(`${SHARED_SOURCE_PATH} は自己完結でなければならない: ${violations.join(' / ')}`)
  }
  return `${SHARED_HEADER}\n${source}`
}

export function syncShared() {
  const sourcePath = resolve(repoRoot, SHARED_SOURCE_PATH)
  const outputPath = resolve(repoRoot, SHARED_OUTPUT_PATH)
  const generated = buildGeneratedContent(readFileSync(sourcePath, 'utf8'))
  mkdirSync(dirname(outputPath), { recursive: true })
  let current = null
  try {
    current = normalizeToLf(readFileSync(outputPath, 'utf8'))
  } catch {
    current = null
  }
  if (current === generated) {
    console.log(`[sync-shared] up to date: ${SHARED_OUTPUT_PATH}`)
    return false
  }
  writeFileSync(outputPath, generated, 'utf8')
  console.log(`[sync-shared] wrote ${SHARED_OUTPUT_PATH} (${generated.length} chars)`)
  return true
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    syncShared()
  } catch (error) {
    console.error(`[sync-shared] failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
