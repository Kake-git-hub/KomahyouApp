// 本番ビルド(dist/)に開発用の読み口が入っていないかの番人。`npm run build` の最後に呼ぶ。
//
// ★なぜあるか
//   画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5)は、外から教室データを読む口
//   window.__komahyouUiPatrol を使う。これは App.tsx の `if (import.meta.env.DEV)` の中でだけ取り付け、
//   本番ビルドでは中身ごと消える前提。書き方を変えて消えなくなっても誰も気づかないので、
//   dist の文字を直接見て、1 つでも残っていればビルドを失敗させる。
//
// 使い方: node tools/check-dist-dev-hooks.mjs   (dist が無い・見つかったら終了コード 1)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInvokedDirectly } from './invoked-directly.mjs'

/** 本番ビルドに入ってはいけない文字。src/utils/uiPatrolHook.ts の UI_PATROL_GLOBAL_KEY と同じ(テストで突合)。 */
export const DEV_HOOK_MARKERS = ['__komahyouUiPatrol']

const CHECKED_EXTENSIONS = /\.(js|html|css)$/

/**
 * 開発用の読み口の文字を含むファイルの path を返す。
 * @param {Array<{ path: string, text: string }>} files
 * @returns {string[]}
 */
export function findDevHookMarkers(files) {
  return files.filter((file) => DEV_HOOK_MARKERS.some((marker) => file.text.includes(marker))).map((file) => file.path)
}

function listDistFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listDistFiles(full))
    else if (CHECKED_EXTENSIONS.test(name)) out.push(full)
  }
  return out
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const distDir = join(root, 'dist')
  if (!existsSync(distDir)) {
    console.error('dist/ がありません。先に vite build を実行してください。')
    process.exit(1)
  }
  const files = listDistFiles(distDir).map((full) => ({ path: relative(root, full), text: readFileSync(full, 'utf8') }))
  const found = findDevHookMarkers(files)
  if (found.length > 0) {
    console.error('開発用の読み口が本番ビルドに入っています:')
    for (const path of found) console.error(`  ${path}`)
    process.exit(1)
  }
  console.log(`開発用の読み口は本番ビルドに入っていません(${files.length} ファイルを確認)`)
}

if (isInvokedDirectly(import.meta.url)) main()
