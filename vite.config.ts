import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// https://vite.dev/config/
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const githubPagesBase = repositoryName ? `/${repositoryName}/` : '/'
// GitHub Pages はサブパス(/<repo>/)配信なので base を付ける。一方 Firebase Hosting は
// ルート(/)配信なので base は '/' でなければならない。両デプロイとも GitHub Actions 上で
// 走るため GITHUB_ACTIONS だけでは判別できない。Firebase デプロイのビルドでは
// FIREBASE_DEPLOY=1 を立てて base を '/' に固定する。これを誤ると資産パスが
// /<repo>/assets/... になり、Firebase 上で 404→index.html リライト→画面が真っ白になる
// (2026-06-25 の本番障害の原因。回帰防止: この分岐を単純化して GITHUB_ACTIONS だけに戻さない)。
const isGithubPagesBuild = Boolean(process.env.GITHUB_ACTIONS) && process.env.FIREBASE_DEPLOY !== '1'
const buildStamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

export default defineConfig({
  base: isGithubPagesBuild ? githubPagesBase : '/',
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
