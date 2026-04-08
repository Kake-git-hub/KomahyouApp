import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// https://vite.dev/config/
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const githubPagesBase = repositoryName ? `/${repositoryName}/` : '/'
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }
const buildStamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? githubPagesBase : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      includeAssets: ['KomahyouAppIcon.png'],
      manifest: {
        name: 'コマ表アプリ',
        short_name: 'コマ表',
        description: 'コマ表管理アプリ',
        theme_color: '#1976d2',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD_STAMP__: JSON.stringify(buildStamp),
  },
})
