import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BoardShareScreen } from './components/board-share/BoardShareScreen'
import './App.css'

function extractShareToken() {
  const queryToken = new URLSearchParams(window.location.search).get('token')?.trim()
  if (queryToken) return queryToken

  const legacyQueryToken = new URLSearchParams(window.location.search).get('boardShare')?.trim()
  if (legacyQueryToken) return legacyQueryToken

  const hashMatch = window.location.hash.match(/^#\/?board-share\/([^/?#]+)/)
  if (hashMatch?.[1]) return decodeURIComponent(hashMatch[1]).trim()

  const pathMatch = window.location.pathname.match(/^\/board-share\/([^/]+)\/?$/)
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim()

  return ''
}

function ShareEntry() {
  const token = extractShareToken()
  if (!token) {
    return <div className="board-share-shell"><div className="board-share-message">配布用URLが正しくありません。</div></div>
  }
  return <BoardShareScreen token={token} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShareEntry />
  </StrictMode>,
)