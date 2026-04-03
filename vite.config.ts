import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// https://vite.dev/config/
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const githubPagesBase = repositoryName ? `/${repositoryName}/` : '/'
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }
const buildStamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? githubPagesBase : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD_STAMP__: JSON.stringify(buildStamp),
  },
})
