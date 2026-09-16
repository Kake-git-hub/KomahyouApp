// CLI ツールの「直接実行されたときだけ動かす」判定を **1 か所**に集約する共通ヘルパ。
//
// ★なぜ集約したか(2026-09-16・複数会社展開 Phase 0 のレビュー指摘)
//   同じ判定が 3 通りに分かれていた:
//     A) resolve(process.argv[1]) === fileURLToPath(import.meta.url)
//     B) process.argv[1] === fileURLToPath(import.meta.url)          … 相対パス起動で不一致
//     C) import.meta.url === new URL(`file://${process.argv[1]}`).href … Windows のドライブレターや
//        空白・日本語のエスケープで不一致
//   いずれも **シンボリックリンク/ジャンクション越しの起動**(`node C:\link\tools\x.mjs` など)で
//   不一致になり、ツールが何も言わずに終了コード 0 で終わる(＝「実行したのに何も起きない」)。
//   判定を 1 か所にして `node:fs.realpathSync` で両側を実体パスへ正規化する。
//
// ★仕様
//   - argv[1] と呼び出し元モジュールの実体パスが同じなら true。
//   - 別ファイル(テストから import した等)なら false。
//   - argv[1] が未定義・空(REPL / `node -e`)なら false。
//   - 実体解決に失敗する(存在しないパス等)場合は resolve() したパス同士で比較する(fail-safe)。
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** パスを実体(シンボリックリンク解決済み・絶対)へ正規化する。解決できなければ絶対パス化だけ行う。 */
function canonicalizePath(path) {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

/**
 * 呼び出し元のモジュールが `node <このファイル>` で直接実行されたか。
 *
 * @param {string} importMetaUrl 呼び出し元の `import.meta.url`
 * @param {string | undefined} [argv1] 既定は `process.argv[1]`(テストから明示できるように引数化)
 * @returns {boolean}
 */
export function isInvokedDirectly(importMetaUrl, argv1 = process.argv[1]) {
  if (typeof argv1 !== 'string' || argv1.trim() === '') return false
  if (typeof importMetaUrl !== 'string' || importMetaUrl === '') return false
  let modulePath
  try {
    modulePath = fileURLToPath(importMetaUrl)
  } catch {
    return false
  }
  return canonicalizePath(argv1) === canonicalizePath(modulePath)
}
