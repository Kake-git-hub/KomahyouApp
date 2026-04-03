import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { resolveCurrentLegacyLessonScheduleShortUrl } from './utils/scheduleQrConfig'
import './index.css'
import App from './App.tsx'

const redirectTarget = resolveCurrentLegacyLessonScheduleShortUrl(window.location.pathname)

if (redirectTarget) {
  window.location.replace(redirectTarget)
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <div className="app-version-badge">
        <span>v{__APP_VERSION__}</span>
        <span>{__APP_BUILD_STAMP__}</span>
      </div>
    </StrictMode>,
  )
}
