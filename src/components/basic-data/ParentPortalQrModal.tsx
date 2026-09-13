import { PARENT_PORTAL_QR_TEXT } from './parentPortalQr'

// 基本データ画面の「保護者用QR」モーダル(spec-parent-portal.md §K-6 / P-7)。
// 盤面の配布用QR(ScheduleBoardScreen distributionQrModal)と同じ .distribution-qr-* を流用し、
// 保護者用に固有の要素(案内文・エラー・3 ボタン)だけ App.css 末尾の .parent-portal-qr-* で足す。
// 発行・再発行・印刷の判断は呼び出し側(BasicDataScreen)が持ち、ここは表示だけ。

type ParentPortalQrModalProps = {
  classroomName: string
  studentName: string
  url: string
  svg: string
  // 発行(callable)待ち。QR の代わりにスピナーを出す。
  isLoading: boolean
  error?: string | null
  // 再発行の実行中(ボタンを無効化)。
  busy: boolean
  onReissue: () => void
  onPrint: () => void
  onClose: () => void
}

export function ParentPortalQrModal({ classroomName, studentName, url, svg, isLoading, error, busy, onReissue, onPrint, onClose }: ParentPortalQrModalProps) {
  const canAct = !isLoading && !busy && !error && Boolean(svg)
  return (
    <div
      className="distribution-qr-modal-overlay"
      onClick={(event) => { if (event.target === event.currentTarget && !busy && !isLoading) onClose() }}
    >
      <div className="distribution-qr-modal parent-portal-qr-modal" role="dialog" aria-modal="true" aria-label={PARENT_PORTAL_QR_TEXT.title} data-testid="parent-portal-qr-modal">
        {classroomName ? <div className="distribution-qr-classroom">{classroomName}</div> : null}
        <div className="distribution-qr-title">{PARENT_PORTAL_QR_TEXT.title}</div>
        <div className="parent-portal-qr-student" data-testid="parent-portal-qr-student">{studentName} さん</div>
        {isLoading ? (
          <div className="distribution-qr-loading" role="status" aria-live="polite">
            <span className="distribution-qr-spinner" aria-hidden="true" />
            <span>QRを作成しています</span>
          </div>
        ) : error ? (
          <p className="parent-portal-qr-error" role="alert" data-testid="parent-portal-qr-error">{error}</p>
        ) : (
          <>
            <div className="distribution-qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="distribution-qr-url" data-testid="parent-portal-qr-url">{url}</div>
          </>
        )}
        <p className="parent-portal-qr-guidance">{PARENT_PORTAL_QR_TEXT.guidance}</p>
        <p className="parent-portal-qr-caution">{PARENT_PORTAL_QR_TEXT.caution}</p>
        <div className="distribution-qr-actions parent-portal-qr-actions">
          <button className="primary-button slim" type="button" onClick={onPrint} disabled={!canAct} data-testid="parent-portal-qr-print-button">印刷</button>
          <button className="secondary-button slim" type="button" onClick={onReissue} disabled={isLoading || busy} data-testid="parent-portal-qr-reissue-button">{busy ? '再発行中…' : '再発行'}</button>
          <button className="secondary-button slim" type="button" onClick={onClose} disabled={busy || isLoading} data-testid="parent-portal-qr-close-button">閉じる</button>
        </div>
      </div>
    </div>
  )
}
