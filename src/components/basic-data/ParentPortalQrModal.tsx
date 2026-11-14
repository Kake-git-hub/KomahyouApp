import { PARENT_PORTAL_QR_TEXT, buildParentPortalQrBulkProgressLabel } from './parentPortalQr'

// 基本データ画面の「保護者用QR」モーダル(spec-parent-portal.md §K-6 / P-7)。
// 盤面の配布用QR(ScheduleBoardScreen distributionQrModal)と同じ .distribution-qr-* を流用し、
// 保護者用に固有の要素(案内文・エラー・3 ボタン)だけ App.css 末尾の .parent-portal-qr-* で足す。
// 発行・再発行・印刷の判断は呼び出し側(BasicDataScreen)が持ち、ここは表示だけ。

export type ParentPortalQrModalProps = {
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
  // 全員分印刷(spec-parent-portal §K-6・オーナー指示 2026-11-14)。無ければボタンを出さない。
  // 1 人分の QR がエラーでも押せる(全員分は独立)。読み込み中・再発行中は押せない。
  onPrintAll?: () => void
  // 保存待ちの生徒がいる・在籍 0 人など、押せない理由があるとき true。理由は bulkPrintNote に出す。
  bulkPrintDisabled?: boolean
  bulkPrintNote?: string | null
  // 実行中の進み具合。あるあいだはボタンに「作成中 n/N」を出し、ほかのボタンも閉じるも押せない。
  bulkProgress?: { done: number; total: number } | null
  // 全員分印刷の結果(失敗した生徒の名前・保存の案内)。
  bulkMessage?: string | null
  // 「全員分印刷」を押したあとの確認(window.confirm は使わない・2026-11-14 レビュー)。あるあいだ確認文と「印刷する」「やめる」を出す。
  // ★「印刷する」のクリックの中で同期的に印刷ウィンドウを開く(ユーザー操作の扱いが切れるとポップアップが止められる)。
  bulkConfirmMessage?: string | null
  onConfirmPrintAll?: () => void
  onCancelPrintAll?: () => void
}

export function ParentPortalQrModal({ classroomName, studentName, url, svg, isLoading, error, busy, onReissue, onPrint, onClose, onPrintAll, bulkPrintDisabled = false, bulkPrintNote = null, bulkProgress = null, bulkMessage = null, bulkConfirmMessage = null, onConfirmPrintAll, onCancelPrintAll }: ParentPortalQrModalProps) {
  const bulkConfirming = Boolean(bulkConfirmMessage)
  const bulkRunning = Boolean(bulkProgress)
  const canAct = !isLoading && !busy && !bulkRunning && !error && Boolean(svg)
  const canClose = !busy && !isLoading && !bulkRunning
  return (
    <div
      className="distribution-qr-modal-overlay"
      onClick={(event) => { if (event.target === event.currentTarget && canClose) onClose() }}
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
          {onPrintAll ? (
            <button className="secondary-button slim" type="button" onClick={onPrintAll} disabled={isLoading || busy || bulkRunning || bulkConfirming || bulkPrintDisabled} aria-busy={bulkRunning || undefined} data-testid="parent-portal-qr-print-all-button">
              {bulkProgress ? buildParentPortalQrBulkProgressLabel(bulkProgress.done, bulkProgress.total) : PARENT_PORTAL_QR_TEXT.bulkPrintLabel}
            </button>
          ) : null}
          <button className="secondary-button slim" type="button" onClick={onReissue} disabled={isLoading || busy || bulkRunning} data-testid="parent-portal-qr-reissue-button">{busy ? '再発行中…' : '再発行'}</button>
          <button className="secondary-button slim" type="button" onClick={onClose} disabled={!canClose} data-testid="parent-portal-qr-close-button">閉じる</button>
        </div>
        {onPrintAll && bulkConfirmMessage && !bulkRunning ? (
          <div className="parent-portal-qr-bulk-confirm" role="group" aria-label={PARENT_PORTAL_QR_TEXT.bulkPrintLabel} data-testid="parent-portal-qr-print-all-confirm">
            <p className="parent-portal-qr-bulk-confirm-text">{bulkConfirmMessage}</p>
            <div className="parent-portal-qr-bulk-confirm-actions">
              <button className="primary-button slim" type="button" onClick={onConfirmPrintAll} disabled={isLoading || busy || bulkPrintDisabled} data-testid="parent-portal-qr-print-all-confirm-button">{PARENT_PORTAL_QR_TEXT.bulkConfirmButton}</button>
              <button className="secondary-button slim" type="button" onClick={onCancelPrintAll} data-testid="parent-portal-qr-print-all-cancel-button">{PARENT_PORTAL_QR_TEXT.bulkCancelButton}</button>
            </div>
          </div>
        ) : null}
        {onPrintAll && bulkPrintNote && !bulkRunning ? <p className="parent-portal-qr-bulk-note" data-testid="parent-portal-qr-print-all-note">{bulkPrintNote}</p> : null}
        {bulkMessage ? <p className="parent-portal-qr-bulk-message" role="status" data-testid="parent-portal-qr-print-all-message">{bulkMessage}</p> : null}
      </div>
    </div>
  )
}
