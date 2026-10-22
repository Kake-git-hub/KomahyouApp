// 画面の描画エラーの受け皿(2026-10-22 オーナー採用「即時対応のための案 3」)。
// React の描画中の例外は window.onerror に届かない(React が握って木ごと外す = 白画面)。ここで捕まえて
// (1) 操作痕跡＋自動報告(src/utils/clientErrorCapture.ts)へ渡し、(2) 室長には再読み込みの案内を出す。
// 文言は室長向け(内部語を出さない)。本体の state は触らない(壊れている可能性があるため)。

import { Component, type ErrorInfo, type ReactNode } from 'react'

import { describeClientError, handleCapturedClientError } from '../../utils/clientErrorCapture'

export const APP_ERROR_FALLBACK_TEXT = {
  title: '画面の表示で問題が起きました',
  lead: '内容は開発者へ自動で届いています。「再読み込み」を押すと続けて使えます。',
  note: '保存済みの内容は失われていません。保存していない変更があったときは、再読み込みのあとに画面で確かめてください。',
  reload: '再読み込み',
} as const

export function AppErrorFallback({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={APP_ERROR_FALLBACK_TEXT.title}
      data-testid="app-error-fallback"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        background: '#f5f7fb',
        color: '#16314f',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
        gap: 14,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700 }}>{APP_ERROR_FALLBACK_TEXT.title}</div>
      <div style={{ fontSize: 17, lineHeight: 1.7, maxWidth: 640 }}>{APP_ERROR_FALLBACK_TEXT.lead}</div>
      <div style={{ fontSize: 15, lineHeight: 1.7, maxWidth: 640, color: '#36506d' }}>{APP_ERROR_FALLBACK_TEXT.note}</div>
      <button
        type="button"
        onClick={onReload}
        data-testid="app-error-reload"
        style={{ marginTop: 8, padding: '12px 28px', fontSize: 17, border: 'none', borderRadius: 10, background: '#1a73e8', color: '#fff', cursor: 'pointer' }}
      >
        {APP_ERROR_FALLBACK_TEXT.reload}
      </button>
      {message ? <div style={{ fontSize: 12, color: '#7a8aa0', maxWidth: 720, overflowWrap: 'anywhere' }}>({message})</div> : null}
    </div>
  )
}

type AppErrorBoundaryState = { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    try {
      handleCapturedClientError(describeClientError({ source: 'react-render', error, componentStack: info.componentStack }))
    } catch {
      // エラー処理の中で落ちても本体の案内は出す。
    }
  }

  render() {
    if (this.state.error) {
      return <AppErrorFallback message={this.state.error.message} onReload={() => { window.location.reload() }} />
    }
    return this.props.children
  }
}
