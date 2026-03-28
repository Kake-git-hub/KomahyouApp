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
    </StrictMode>,
  )
}
