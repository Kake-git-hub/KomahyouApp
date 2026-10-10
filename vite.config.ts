import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// https://vite.dev/config/
// base は常に '/'（本番 Firebase Hosting はルート配信）。
// 回帰防止(2026-06-25 本番障害): かつて GitHub Pages(サブパス /<repo>/ 配信)への副次デプロイがあり、
// GitHub Actions 上では FIREBASE_DEPLOY=1 の有無で base を切り替えていた。この切替の漏れで
// 本番の資産パスが /<repo>/assets/... になり 404→index.html リライト→画面が真っ白になった。
// Pages デプロイは 2026-07-04 に廃止(deploy-pages.yml 削除)したため base は '/' 固定。
// サブパス配信を再導入する場合は、本番(Firebase)ビルドの base が '/' のままであることを最優先に検証すること。
const buildStamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

// 会社レイヤ P-1(2026-10-10): ビルドする会社を env VITE_COMPANY_KEY(無ければ VITE_FIREBASE_WORKSPACE_KEY・どちらも無ければ main)で
// 選ぶ。対応する src/company/profiles/<会社キー>.ts が無ければ**ここでビルドを止める**(fail-closed。既定の main に黙って
// 落とすと「会社B のサイトにアーチのプロファイル」が配信される)。両方あって食い違う場合も止める(workspace の混線防止)。
// 実行時の選択本体は src/company/profile.ts(同じ規則)。
export function resolveCompanyKeyForBuild(env: Record<string, string | undefined>, profilesDir = resolve('src/company/profiles')) {
  const companyKey = (env.VITE_COMPANY_KEY ?? '').trim()
  const workspaceKey = (env.VITE_FIREBASE_WORKSPACE_KEY ?? '').trim()
  if (companyKey && workspaceKey && companyKey !== workspaceKey) {
    throw new Error(`[company] VITE_COMPANY_KEY=${companyKey} と VITE_FIREBASE_WORKSPACE_KEY=${workspaceKey} が食い違っています。同じ会社キーに揃えてください。`)
  }
  const key = companyKey || workspaceKey || 'main'
  if (!/^[a-z0-9]{3,16}$/.test(key)) {
    throw new Error(`[company] 会社キー "${key}" が命名規則(英小文字と数字・3〜16 文字)に合いません。`)
  }
  if (!existsSync(resolve(profilesDir, `${key}.ts`))) {
    throw new Error(`[company] 会社プロファイル src/company/profiles/${key}.ts がありません。会社キー "${key}" のビルドを中止します。`)
  }
  return key
}

export default defineConfig(({ mode }) => {
  const companyKey = resolveCompanyKeyForBuild(loadEnv(mode, process.cwd(), 'VITE_'))
  console.log(`[company] building profile: ${companyKey}`)
  return {
    base: '/',
    plugins: [
      react(),
    ],
    // 会社レイヤ(docs/spec-multi-tenant.md §11・Phase 1): コア本体は `@company/profile` で会社プロファイルを読む。
    // フォーク(会社リポジトリ)が差し替えてよいのは src/company/ 配下だけ。vitest.config.ts・tsconfig.app.json と同じ定義。
    resolve: {
      alias: {
        '@company': resolve('src/company'),
      },
    },
    define: {
      __APP_BUILD_STAMP__: JSON.stringify(buildStamp),
      __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve('index.html'),
          share: resolve('share.html'),
        },
      },
    },
  }
})
