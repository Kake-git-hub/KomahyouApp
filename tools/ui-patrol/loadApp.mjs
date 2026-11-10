// tools/ui-patrol/entry.ts を esbuild で束ねて読み込む(tools/inv-audit.mjs の loadAuditor と同じ設定)。
// アプリの @company 別名と import.meta.env を vite と同じに当てる。束ね先は node_modules/.cache/ui-patrol-* で、cleanup で消す。
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ENTRY_PATH = path.join(import.meta.dirname, 'entry.ts')
const REPO_ROOT = path.join(import.meta.dirname, '..', '..')

export async function loadPatrolApp() {
  const { build } = await import('esbuild')
  // 依存パッケージは external のままにするので、repo の node_modules から解決できる場所(node_modules/.cache)へ置く。
  const cacheRoot = path.join(REPO_ROOT, 'node_modules', '.cache')
  mkdirSync(cacheRoot, { recursive: true })
  const outDir = await mkdtemp(path.join(cacheRoot, 'ui-patrol-'))
  const cleanup = () => rm(outDir, { recursive: true, force: true })
  try {
    const outfile = path.join(outDir, 'app.mjs')
    await build({
      entryPoints: [ENTRY_PATH],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      logLevel: 'silent',
      loader: { '.css': 'empty' },
      // qrcode / xlsx などの CJS パッケージはバンドルすると dynamic require で落ちるため外に出す(inv-audit と同じ)。
      packages: 'external',
      alias: { '@company': path.join(REPO_ROOT, 'src', 'company') },
      // vite の import.meta.env が無いとアプリの会社設定の読み込みで落ちる。既定の会社(env なし)として読む。
      define: { 'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }) },
    })
    const app = await import(pathToFileURL(outfile).href)
    return { app, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
