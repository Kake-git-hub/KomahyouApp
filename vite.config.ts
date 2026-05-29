import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// https://vite.dev/config/
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const githubPagesBase = repositoryName ? `/${repositoryName}/` : '/'
const buildStamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? githubPagesBase : '/',
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
