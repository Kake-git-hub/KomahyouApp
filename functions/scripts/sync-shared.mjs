// アプリ側 `src/` にある**権威モジュール**を functions 側へ複製する(spec-parent-portal.md §D /
// docs/spec-multi-tenant.md 「クライアントと Cloud Functions の二重実装を禁止」)。functions は
// rootDir=src の別 TS プロジェクトでアプリ側 src/ を import できないため、ビルド前(prebuild)にそのまま写す。
//
// - 複製対象は下の SHARED_TS_FILES の一覧(ファイルを増やすときはここへ 1 行足す)。
//   - src/utils/parentSchedule.ts          → functions/src/generated/parentSchedule.ts
//   - src/utils/developmentClassroomRegistry.ts → functions/src/generated/developmentClassroomRegistry.ts
// - 出力はヘッダ 1 行 + 元ファイル(LF・決定的)。
// - 生成物は **コミットする**(CI の vitest は functions build 前に走る)。
//   ズレは `functions/src/<name>.parity.test.ts` が「生成物 = 元ファイル + ヘッダ」の文字列比較で検出する。
// - 元ファイルは import 0 行・import.meta なしが前提(複製先で解決できない)。ここでも検査して違反なら失敗させる。
//
// 使い方: `npm --prefix functions run sync-shared`(build 時は prebuild で自動実行)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')

export function buildSharedHeader(sourcePath) {
  return `// GENERATED FROM ${sourcePath} — 手で編集しない。npm --prefix functions run sync-shared で再生成。`
}

// 保護者向け日程計算の権威(既存)。export 名は parentSchedule.parity.test.ts が参照しているので変えない。
export const SHARED_SOURCE_PATH = 'src/utils/parentSchedule.ts'
export const SHARED_OUTPUT_PATH = 'functions/src/generated/parentSchedule.ts'
export const SHARED_HEADER = buildSharedHeader(SHARED_SOURCE_PATH)

// 検証用(開発用・サンドボックス)教室の登録台帳(2026-09-16・docs/spec-multi-tenant.md)。
// クライアントとサーバーが同じ (workspaceKey, classroomId) の一覧で判定するための複製。
export const DEVELOPMENT_CLASSROOM_REGISTRY_SOURCE_PATH = 'src/utils/developmentClassroomRegistry.ts'
export const DEVELOPMENT_CLASSROOM_REGISTRY_OUTPUT_PATH = 'functions/src/generated/developmentClassroomRegistry.ts'
export const DEVELOPMENT_CLASSROOM_REGISTRY_HEADER = buildSharedHeader(DEVELOPMENT_CLASSROOM_REGISTRY_SOURCE_PATH)

/** そのまま複製する TypeScript 権威モジュールの一覧(増やすときはここへ足す)。 */
export const SHARED_TS_FILES = [
  { sourcePath: SHARED_SOURCE_PATH, outputPath: SHARED_OUTPUT_PATH },
  { sourcePath: DEVELOPMENT_CLASSROOM_REGISTRY_SOURCE_PATH, outputPath: DEVELOPMENT_CLASSROOM_REGISTRY_OUTPUT_PATH },
]

export function normalizeToLf(text) {
  return text.replace(/\r\n?/g, '\n')
}

// 既定値は parentSchedule(既存の呼び出し・テストを無改変で通すため)。他ファイルは sourcePath を渡す。
export function buildGeneratedContent(sourceText, sourcePath = SHARED_SOURCE_PATH) {
  const source = normalizeToLf(sourceText)
  const violations = []
  if (/^\s*import\s/m.test(source) || /^\s*export\s+.*\sfrom\s+['"]/m.test(source)) violations.push('import / re-export 行が含まれている')
  if (source.includes('import.meta')) violations.push('import.meta が含まれている')
  if (/\brequire\s*\(/.test(source)) violations.push('require() が含まれている')
  if (violations.length > 0) {
    throw new Error(`${sourcePath} は自己完結でなければならない: ${violations.join(' / ')}`)
  }
  return `${buildSharedHeader(sourcePath)}\n${source}`
}

// 質問への AI 即時回答(functions/src/questionAiAnswer.ts・開発用教室のみ試験)が根拠にする利用者マニュアル。
// functions のデプロイには docs/ が含まれないため、文字列定数として複製する。
// ズレは functions/src/questionAiAnswer.test.ts が「生成物 = buildUserManualModuleContent(元ファイル)」で検出する。
export const USER_MANUAL_SOURCE_PATH = 'docs/user-manual.md'
export const USER_MANUAL_OUTPUT_PATH = 'functions/src/generated/userManual.ts'
export const USER_MANUAL_HEADER = '// GENERATED FROM docs/user-manual.md — 手で編集しない。npm --prefix functions run sync-shared で再生成。'

export function buildUserManualModuleContent(sourceText) {
  return `${USER_MANUAL_HEADER}\nexport const USER_MANUAL_MARKDOWN = ${JSON.stringify(normalizeToLf(sourceText))}\n`
}

export function syncShared() {
  let changed = writeIfChanged(USER_MANUAL_OUTPUT_PATH, buildUserManualModuleContent(readFileSync(resolve(repoRoot, USER_MANUAL_SOURCE_PATH), 'utf8')))
  for (const { sourcePath, outputPath } of SHARED_TS_FILES) {
    const generated = buildGeneratedContent(readFileSync(resolve(repoRoot, sourcePath), 'utf8'), sourcePath)
    if (writeIfChanged(outputPath, generated)) changed = true
  }
  return changed
}

function writeIfChanged(outputRelativePath, generated) {
  const outputPath = resolve(repoRoot, outputRelativePath)
  mkdirSync(dirname(outputPath), { recursive: true })
  let current = null
  try {
    current = normalizeToLf(readFileSync(outputPath, 'utf8'))
  } catch {
    current = null
  }
  if (current === generated) {
    console.log(`[sync-shared] up to date: ${outputRelativePath}`)
    return false
  }
  writeFileSync(outputPath, generated, 'utf8')
  console.log(`[sync-shared] wrote ${outputRelativePath} (${generated.length} chars)`)
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
