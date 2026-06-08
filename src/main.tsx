import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import packageJson from '../package.json'
import { startMemoryDiagnostics } from './utils/memoryDiagnostics'
import { OfflineGate } from './components/OfflineGate'

// ?memlog=1 のときだけメモリ診断ログを開始する（通常は何もしない）。
startMemoryDiagnostics()

// 旧 PWA (Service Worker) を導入していたユーザー向けに登録解除と CacheStorage 掃除を実施。
// PWA 機能は廃止済みのため、残存する SW がアプリ更新を阻害しないよう一度だけ無効化する。
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister().catch(() => { /* noop */ })
    })
  }).catch(() => { /* noop */ })
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => {
      keys.forEach((key) => {
        caches.delete(key).catch(() => { /* noop */ })
      })
    }).catch(() => { /* noop */ })
  }
}

const SubmissionPage = lazy(() => import('./components/submission/SubmissionPage'))
const BoardShareScreen = lazy(() => import('./components/board-share/BoardShareScreen').then((module) => ({ default: module.BoardShareScreen })))

function extractSubmissionToken() {
  // Hash route: /#/submit/{token}
  const hashMatch = window.location.hash.match(/^#\/submit\/([A-Za-z0-9_-]{16,64})$/)
  if (hashMatch) return hashMatch[1]
  // Short path: /s/{token} (Firebase Hosting serves index.html for all paths)
  const pathMatch = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]{16,64})$/)
  if (pathMatch) return pathMatch[1]
  return null
}

function extractBoardShareToken() {
  const queryToken = new URLSearchParams(window.location.search).get('boardShare')?.trim()
  if (queryToken) return queryToken

  const hashMatch = window.location.hash.match(/^#\/?board-share\/([^/?#]+)/)
  if (hashMatch?.[1]) return decodeURIComponent(hashMatch[1]).trim()

  const pathMatch = window.location.pathname.match(/^\/board-share\/([^/]+)\/?$/)
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim()

  return null
}

const submissionToken = extractSubmissionToken()
const boardShareToken = extractBoardShareToken()

if (submissionToken) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', fontFamily: 'sans-serif', color: '#666' }}>読み込み中...</div>}>
        <SubmissionPage token={submissionToken} />
      </Suspense>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </StrictMode>,
  )
} else if (boardShareToken) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', fontFamily: 'sans-serif', color: '#666' }}>読み込み中...</div>}>
        <BoardShareScreen token={boardShareToken} />
      </Suspense>
    </StrictMode>,
  )
} else {
  import('./App').then(({ default: App }) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
        <OfflineGate />
        <div className="app-version-badge">v{packageJson.version}</div>
      </StrictMode>,
    )
  })
}
