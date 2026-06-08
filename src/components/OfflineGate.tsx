import { useEffect, useState } from 'react'
import { isFirebaseBackendEnabled } from '../integrations/firebase/config'

// オフライン時のブロック(spec-save-restore.md §3)。
// このアプリはクラウド(Firebase)前提のため、オフラインでは盤面を表示せず操作を遮断する。
// アプリ本体はアンマウントせず、全画面オーバーレイで操作だけを遮断する(状態を保持し、
// 接続回復で自動的に解除)。ローカル開発(Firebase無効)では遮断しない。
export function OfflineGate() {
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)

  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    update()
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!isOffline || !isFirebaseBackendEnabled()) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="オフラインのため使用できません"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(20,24,33,0.94)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
        fontFamily: "'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif",
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 12 }} aria-hidden="true">⚠</div>
      <h2 style={{ fontSize: 20, margin: '0 0 8px', fontWeight: 700 }}>オフラインのため使用できません</h2>
      <p style={{ fontSize: 14, lineHeight: 1.7, maxWidth: 380, margin: 0 }}>
        このアプリはインターネット接続が必要です。<br />
        接続状況をご確認ください。<br />
        接続が回復すると自動的に操作できるようになります。
      </p>
    </div>
  )
}
