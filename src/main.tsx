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

const CHUNK_RELOAD_GUARD_KEY = 'app-chunk-reload-guard'

// 動的 import 失敗(旧チャンク掴み)からの自動復帰。キャッシュ回避付きで1回だけ再読込し、
// それでも失敗する場合はループを防ぐため手動再読込を促すメッセージを表示する。
function recoverFromChunkLoadError(error: unknown) {
  console.error('[App chunk load failed]', error)

  let alreadyReloaded = false
  try {
    alreadyReloaded = window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === '1'
    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1')
  } catch {
    // sessionStorage が使えない場合はガードできないため、再読込せずメッセージ表示にフォールバック。
    alreadyReloaded = true
  }

  if (!alreadyReloaded) {
    const target = new URL(window.location.href)
    target.searchParams.set('r', String(Date.now()))
    window.location.replace(target.toString())
    return
  }

  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100dvh;gap:12px;font-family:sans-serif;color:#444;padding:24px;text-align:center;">'
      + '<div>最新版の読み込みに失敗しました。</div>'
      + '<div>ページを再読み込みしてください。</div>'
      + '<button onclick="location.reload()" style="padding:10px 20px;font-size:16px;border:none;border-radius:8px;background:#1976d2;color:#fff;">再読み込み</button>'
      + '</div>'
  }
}

import { applySubmissionViewport } from './components/submission/iosViewport'

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

// 実機デバッグ用: iOS 表示倍率の調整画面。ダミーデータで提出ページを描画する。
function isSubmissionDebug() {
  return window.location.hash === '#/submit-debug' || window.location.pathname === '/submit-debug'
}

const submissionToken = extractSubmissionToken()
const boardShareToken = extractBoardShareToken()

if (isSubmissionDebug()) {
  // iOS/Android とも初回ペイント前に viewport 幅を確定させる(描画後の変更だと再フィットせず見切れる)。
  applySubmissionViewport()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', fontFamily: 'sans-serif', color: '#666' }}>読み込み中...</div>}>
        <SubmissionPage token="__debug__" debug />
      </Suspense>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </StrictMode>,
  )
} else if (submissionToken) {
  // iOS/Android とも初回ペイント前に viewport 幅を確定させる(描画後の変更だと再フィットせず見切れる)。
  applySubmissionViewport()
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
  }).catch((error) => {
    // デプロイ直後にブラウザが旧 index/チャンクをキャッシュしていると、削除済みの
    // 旧チャンクを掴んで動的 import が失敗し、画面が真っ白のまま固まることがある。
    // その場合はキャッシュ回避クエリ付きで一度だけ自動リロードして最新へ復帰させる。
    // 無限ループ防止: sessionStorage で1セッション1回までに制限する。
    recoverFromChunkLoadError(error)
  })
}
