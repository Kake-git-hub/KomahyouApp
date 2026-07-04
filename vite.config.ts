import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
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

export default defineConfig({
  base: '/',
  plugins: [
    react(),
  ],
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
})
