import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const SubmissionPage = lazy(() => import('./components/submission/SubmissionPage'))

function extractSubmissionToken() {
  // Hash route: /#/submit/{token}
  const hashMatch = window.location.hash.match(/^#\/submit\/([A-Za-z0-9_-]{16,64})$/)
  if (hashMatch) return hashMatch[1]
  // Short path: /s/{token} (Firebase Hosting serves index.html for all paths)
  const pathMatch = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]{16,64})$/)
  if (pathMatch) return pathMatch[1]
  return null
}

const submissionToken = extractSubmissionToken()

if (submissionToken) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', fontFamily: 'sans-serif', color: '#666' }}>読み込み中...</div>}>
        <SubmissionPage token={submissionToken} />
      </Suspense>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </StrictMode>,
  )
} else {
  import('./App').then(({ default: App }) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
        <div className="app-version-badge">
          <span>v{__APP_VERSION__}</span>
          <span>{__APP_BUILD_STAMP__}</span>
        </div>
      </StrictMode>,
    )
  })
}
