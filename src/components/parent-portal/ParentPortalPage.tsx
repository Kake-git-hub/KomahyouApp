import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PARENT_MESSAGE_BODY_LIMIT,
  PARENT_MESSAGE_NETWORK_ERROR_MESSAGE,
  PARENT_MESSAGE_SENDER_NAME_LIMIT,
  PARENT_MESSAGE_SENT_MESSAGE,
  PARENT_PORTAL_LOAD_FAILED_MESSAGE,
  PARENT_PORTAL_NETWORK_ERROR_MESSAGE,
  PARENT_PORTAL_NOTES,
  PARENT_SCHEDULE_TENTATIVE_LEGEND,
  buildParentPortalRequestUrl,
  buildParentScheduleRows,
  canShiftParentScheduleMonth,
  formatParentScheduleMonthLabel,
  formatParentScheduleRowDateLabel,
  formatParentSnapshotSavedAtLabel,
  getParentPortalApiBaseUrl,
  isParentPortalScheduleResponse,
  resolveParentMessageSendError,
  resolveParentPortalLoadError,
  resolveParentScheduleMonthNotice,
  shiftParentScheduleMonth,
  validateParentMessageInput,
  type ParentPortalScheduleResponse,
  type ParentScheduleRow,
  type ParentScheduleRange,
} from './parentPortalPageModel'

// 保護者向け固定QRの公開ページ(spec-parent-portal.md §C / §E)。
//
// SubmissionPage(講習提出)の骨格を写しているが、次の点は意図的に違う:
// - applySubmissionViewport(width=520 + zoom 0.7 の対)は使わない。device-width のまま通常のモバイル CSS
//   (16〜18px)で組む(片方だけ真似ると極小文字になる。k_map public-page-routing gotcha)。
// - App 本体を読み込まない(Firebase 認証・Firestore 直読みなし)。データは parentPortalApi の GET/POST のみ。
// - 内部 ID(studentId 等)は応答に含まれず、DOM にも出さない。
// index.css は全ルートで読み込まれ PC 向けの min-width:1280px / #root{padding:20px} を当てるため、
// すべての描画分岐で baseStyles(上書きブロック)を必ず含める。

function resolveApiBase() {
  if (typeof window === 'undefined') return ''
  return getParentPortalApiBaseUrl(window.location.origin, {
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    region: import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || '',
  })
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ParentPortalScheduleResponse }

export default function ParentPortalPage({ token }: { token: string }) {
  const apiBase = useMemo(() => resolveApiBase(), [])
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  // 「前の月／次の月」で要求した範囲。null=サーバー既定(今月の 1 日〜末日)。
  const [requestedRange, setRequestedRange] = useState<ParentScheduleRange | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [inlineError, setInlineError] = useState('')

  const [messageBody, setMessageBody] = useState('')
  const [senderName, setSenderName] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadSchedule() {
      try {
        const response = await fetch(buildParentPortalRequestUrl(apiBase, token, requestedRange), { cache: 'no-store' })
        if (cancelled) return
        // requestedRange が null なのは初回だけ(「前の月／次の月」は data 到着後にしか押せない)。
        // 初回の失敗は全面エラー、範囲移動の失敗は表示中の日程を残してインラインで知らせる。
        const isRefresh = requestedRange !== null
        const fail = (message: string) => {
          if (isRefresh) setInlineError(message)
          else setLoadState({ status: 'error', message })
        }
        if (!response.ok) {
          const result: unknown = await response.json().catch(() => null)
          if (cancelled) return
          fail(resolveParentPortalLoadError(response.status, result))
          return
        }
        const result: unknown = await response.json().catch(() => null)
        if (cancelled) return
        if (!isParentPortalScheduleResponse(result)) {
          fail(PARENT_PORTAL_LOAD_FAILED_MESSAGE)
          return
        }
        setLoadState({ status: 'ready', data: result })
        setInlineError('')
      } catch {
        if (cancelled) return
        if (requestedRange !== null) setInlineError(PARENT_PORTAL_NETWORK_ERROR_MESSAGE)
        else setLoadState({ status: 'error', message: PARENT_PORTAL_NETWORK_ERROR_MESSAGE })
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }
    loadSchedule()
    return () => {
      cancelled = true
    }
  }, [apiBase, token, requestedRange])

  const data = loadState.status === 'ready' ? loadState.data : null

  const shiftMonth = useCallback((deltaMonths: number) => {
    if (!data || refreshing) return
    const next = shiftParentScheduleMonth(data.range, deltaMonths, data.bounds)
    if (!next) return
    setInlineError('')
    setRefreshing(true)
    setRequestedRange(next)
  }, [data, refreshing])

  const handleSend = useCallback(async () => {
    if (sending || sent) return
    const validationError = validateParentMessageInput({ body: messageBody, senderName })
    if (validationError) {
      setSendError(validationError)
      return
    }
    setSendError('')
    setSending(true)
    try {
      const response = await fetch(buildParentPortalRequestUrl(apiBase, token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: messageBody, senderName: senderName.trim() }),
      })
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null)
        setSendError(resolveParentMessageSendError(response.status, result))
        return
      }
      setSent(true)
    } catch {
      setSendError(PARENT_MESSAGE_NETWORK_ERROR_MESSAGE)
    } finally {
      setSending(false)
    }
  }, [apiBase, token, messageBody, senderName, sending, sent])

  if (loadState.status === 'loading') {
    return (
      <div className="pp-container">
        <div className="pp-center-box">
          <div className="pp-spinner" />
          <p className="pp-muted">読み込み中...</p>
        </div>
        <style>{baseStyles}</style>
      </div>
    )
  }

  if (loadState.status === 'error') {
    return (
      <div className="pp-container">
        <div className="pp-center-box">
          <p className="pp-error-icon" aria-hidden="true">⚠</p>
          <p className="pp-error-text">{loadState.message}</p>
        </div>
        <style>{baseStyles}</style>
      </div>
    )
  }

  const schedule = loadState.data
  const canGoPrev = canShiftParentScheduleMonth(schedule.range, -1, schedule.bounds)
  const canGoNext = canShiftParentScheduleMonth(schedule.range, 1, schedule.bounds)
  const monthNotice = resolveParentScheduleMonthNotice(schedule)
  const scheduleRows = buildParentScheduleRows(schedule.days, schedule.today)
  const hasTentativeRow = scheduleRows.some((row) => row.isTentative)

  return (
    <div className="pp-container">
      <header className="pp-header">
        <div className="pp-header-classroom">{schedule.classroomName}</div>
        <h1 className="pp-header-title">{schedule.studentName} さんの授業予定</h1>
        <div className="pp-header-saved-at">{formatParentSnapshotSavedAtLabel(schedule.snapshotSavedAt)}</div>
      </header>

      <ul className="pp-notes">
        {PARENT_PORTAL_NOTES.map((note) => <li key={note}>{note}</li>)}
      </ul>

      {inlineError ? (
        <div className="pp-inline-error" role="alert">
          <span>{inlineError}</span>
          <button type="button" className="pp-dismiss" onClick={() => setInlineError('')} aria-label="閉じる">✕</button>
        </div>
      ) : null}

      <nav className="pp-range-nav" aria-label="表示期間">
        <button type="button" className="pp-range-button" onClick={() => shiftMonth(-1)} disabled={!canGoPrev || refreshing}>前の月</button>
        <div className="pp-range-label">
          {formatParentScheduleMonthLabel(schedule.range.from)}
          {refreshing ? <span className="pp-range-refreshing">更新中…</span> : null}
        </div>
        <button type="button" className="pp-range-button" onClick={() => shiftMonth(1)} disabled={!canGoNext || refreshing}>次の月</button>
      </nav>

      <section className="pp-days" aria-label="授業予定">
        {hasTentativeRow ? <p className="pp-rows-legend">{PARENT_SCHEDULE_TENTATIVE_LEGEND}</p> : null}
        {scheduleRows.length > 0 ? (
          <ul className="pp-rows">
            {scheduleRows.map((row) => <ParentScheduleRowItem key={row.key} row={row} />)}
          </ul>
        ) : null}
        {monthNotice ? <p className="pp-muted pp-days-empty">{monthNotice}</p> : null}
      </section>

      <section className="pp-contact" aria-label="教室へ連絡">
        <h2 className="pp-section-title">教室へ連絡</h2>
        {sent ? (
          <div className="pp-sent" role="status">
            <div className="pp-sent-icon" aria-hidden="true">✓</div>
            <p className="pp-sent-text">{PARENT_MESSAGE_SENT_MESSAGE}</p>
          </div>
        ) : (
          <div className="pp-form">
            <p className="pp-form-hint">欠席・変更のご連絡や質問をお送りください。返信はこのページには届きません。</p>
            <label className="pp-field">
              <span className="pp-field-label">ご連絡内容（必須・{PARENT_MESSAGE_BODY_LIMIT}字まで）</span>
              <textarea
                className="pp-textarea"
                value={messageBody}
                onChange={(event) => { setMessageBody(event.target.value); setSendError('') }}
                rows={5}
                maxLength={PARENT_MESSAGE_BODY_LIMIT * 2}
                disabled={sending}
                placeholder="例: 9月20日は学校行事のためお休みします。"
              />
              <span className="pp-field-count">{messageBody.length} / {PARENT_MESSAGE_BODY_LIMIT}</span>
            </label>
            <label className="pp-field">
              <span className="pp-field-label">お名前（任意・{PARENT_MESSAGE_SENDER_NAME_LIMIT}字まで）</span>
              <input
                className="pp-input"
                type="text"
                value={senderName}
                onChange={(event) => { setSenderName(event.target.value); setSendError('') }}
                maxLength={PARENT_MESSAGE_SENDER_NAME_LIMIT * 2}
                disabled={sending}
                placeholder="例: 保護者 太郎"
                autoComplete="name"
              />
            </label>
            {sendError ? <p className="pp-send-error" role="alert">{sendError}</p> : null}
            <button type="button" className={`pp-send-button${sending ? ' pp-disabled' : ''}`} onClick={handleSend} disabled={sending}>
              {sending ? '送信中...' : '送信する'}
            </button>
          </div>
        )}
      </section>

      <footer className="pp-footer">
        <p className="pp-muted">このページは教室から配布されたQRコード専用です。第三者に共有しないでください。</p>
      </footer>
      <style>{baseStyles}</style>
    </div>
  )
}

// 1 コマ 1 行(確認リスト その他 2026-09-14)。日付は同じ日の先頭行だけに出す。
function ParentScheduleRowItem({ row }: { row: ParentScheduleRow }) {
  const weekdayClass = row.weekday === 0 ? ' pp-row-sun' : row.weekday === 6 ? ' pp-row-sat' : ''
  const kindClass = row.rowKind === 'lesson' ? ` pp-lesson-${row.lessonKind}` : ` pp-row-${row.rowKind}`
  return (
    <li className={`pp-row${weekdayClass}${kindClass}${row.isFirstOfDay ? ' pp-row-first' : ''}${row.isToday ? ' pp-row-today' : ''}`}>
      <span className="pp-row-date">
        {row.isFirstOfDay ? formatParentScheduleRowDateLabel(row.dateKey, row.weekday) : ''}
      </span>
      <span className="pp-row-slot">
        {row.slotLabel}
        {row.timeLabel ? <span className="pp-lesson-time">{row.timeLabel}</span> : null}
      </span>
      <span className="pp-row-body">
        <span className="pp-lesson-main">{row.main}</span>
        {row.sub ? <span className="pp-lesson-sub">{row.sub}</span> : null}
        {row.isTentative ? <span className="pp-row-tentative">予定</span> : null}
        {row.isFirstOfDay && row.isToday ? <span className="pp-day-today-badge">今日</span> : null}
      </span>
    </li>
  )
}

const baseStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { min-width: 0 !important; width: 100% !important; max-width: 100% !important; overflow-x: hidden !important; }
  /* 共通の index.css は PC アプリ向けに html/body/#root へ min-width:1280px と #root{padding:20px} を当てている。
     保護者ページ(スマホ)では幅と余白を打ち消さないと、iOS の狭い表示幅で内容が右にはみ出して
     折り返し＝「拡大されたように」見える。padding も明示的に 0 に上書きする(SubmissionPage と同じ)。 */
  html { font-size: 16px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; height: 100%; }
  body { margin: 0; font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif; color: #111; background: #f5f5f5; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; position: relative; }
  #root { height: auto !important; min-height: 100% !important; padding: 0 !important; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .pp-container { min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom, 0); width: 100%; max-width: 640px; margin: 0 auto; overflow: hidden; font-size: 16px; line-height: 1.5; }
  .pp-center-box { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60dvh; padding: 24px; text-align: center; }
  .pp-spinner { width: 36px; height: 36px; border: 3px solid #ddd; border-top-color: #333; border-radius: 50%; animation: spin .8s linear infinite; margin-bottom: 12px; }
  .pp-muted { font-size: 14px; color: #666; }
  .pp-error-icon { font-size: 48px; color: #b00020; margin-bottom: 8px; }
  .pp-error-text { font-size: 17px; line-height: 1.6; }

  .pp-header { background: #fff; border-bottom: 1px solid #ddd; padding: 18px 16px 14px; text-align: center; }
  .pp-header-classroom { font-size: 14px; color: #1f5d96; font-weight: 700; margin-bottom: 4px; }
  .pp-header-title { font-size: 22px; font-weight: 700; line-height: 1.3; }
  .pp-header-saved-at { margin-top: 6px; font-size: 13px; color: #666; }

  .pp-notes { list-style: none; margin: 10px 12px 0; padding: 10px 12px; background: #fff8e1; border: 1px solid #f1e2a8; border-radius: 8px; font-size: 13px; color: #5a4a00; display: grid; gap: 4px; }
  .pp-notes li::before { content: '・'; }

  .pp-inline-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 12px 0; padding: 10px 12px; background: #fee; color: #c00; font-size: 14px; border-radius: 8px; }
  .pp-dismiss { background: none; border: none; color: #c00; font-size: 18px; cursor: pointer; padding: 0 4px; }

  .pp-range-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 12px 0; }
  .pp-range-button { flex: none; padding: 10px 12px; border: 1px solid #bbb; border-radius: 8px; background: #fff; font-size: 14px; font-weight: 700; color: #222; cursor: pointer; touch-action: manipulation; }
  .pp-range-button:disabled { opacity: .4; cursor: default; }
  .pp-range-label { flex: 1; min-width: 0; text-align: center; font-size: 13px; color: #444; line-height: 1.3; }
  .pp-range-refreshing { display: block; font-size: 12px; color: #888; }

  .pp-days { margin: 12px 12px 0; }
  .pp-days-empty { text-align: center; padding: 16px; }
  .pp-rows-legend { font-size: 12px; color: #666; margin: 0 0 6px; }
  .pp-rows { list-style: none; background: #fff; border: 1px solid #ddd; border-radius: 10px; overflow: hidden; }
  .pp-row { display: grid; grid-template-columns: 5.4em 5.2em minmax(0, 1fr); align-items: baseline; column-gap: 8px; padding: 6px 10px; font-size: 15px; line-height: 1.35; }
  .pp-row + .pp-row { border-top: 1px solid #eee; }
  .pp-row + .pp-row-first { border-top-color: #cfd8e3; }
  .pp-row-date { font-weight: 700; white-space: nowrap; }
  .pp-row-sun .pp-row-date { color: #d00; }
  .pp-row-sat .pp-row-date { color: #00c; }
  .pp-row-today { background: #eef4fb; box-shadow: inset 3px 0 0 #1f5d96; }
  .pp-day-today-badge { display: inline-block; font-size: 11px; font-weight: 700; color: #fff; background: #1f5d96; border-radius: 999px; padding: 0 5px; vertical-align: middle; }
  .pp-row-slot { font-weight: 700; color: #16314f; white-space: nowrap; }
  .pp-lesson-time { margin-left: 3px; font-size: 11px; font-weight: 400; color: #777; }
  .pp-row-body { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; min-width: 0; }
  .pp-lesson-main { font-weight: 700; }
  .pp-lesson-sub { font-size: 13px; color: #444; }
  .pp-row-tentative { font-size: 11px; color: #7a5b00; background: #f9e79f; border-radius: 999px; padding: 0 6px; }
  .pp-row-closed, .pp-row-status { color: #666; background: #f6f6f6; }
  .pp-row-closed .pp-lesson-main, .pp-row-status .pp-lesson-main { font-weight: 400; }
  .pp-lesson-makeup .pp-lesson-sub { color: #1f5d96; font-weight: 700; }
  .pp-lesson-absent .pp-lesson-main, .pp-lesson-absent-no-makeup .pp-lesson-main { color: #b00020; }
  .pp-lesson-absent .pp-lesson-sub { color: #1f5d96; font-weight: 700; }
  .pp-lesson-attended .pp-lesson-sub { color: #2a7e2a; }

  .pp-contact { margin: 20px 12px 0; background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 14px 12px; }
  .pp-section-title { font-size: 19px; font-weight: 700; margin-bottom: 8px; }
  .pp-form { display: grid; gap: 12px; }
  .pp-form-hint { font-size: 13px; color: #666; }
  .pp-field { display: grid; gap: 4px; }
  .pp-field-label { font-size: 14px; font-weight: 700; color: #333; }
  .pp-field-count { font-size: 12px; color: #888; text-align: right; }
  .pp-textarea, .pp-input { width: 100%; font-size: 16px; padding: 10px; border: 1px solid #bbb; border-radius: 8px; background: #fff; font-family: inherit; }
  .pp-textarea { resize: vertical; min-height: 120px; line-height: 1.5; }
  .pp-send-error { font-size: 14px; color: #c00; }
  .pp-send-button { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; background: #111; color: #fff; font-size: 18px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
  .pp-disabled { opacity: .5; cursor: not-allowed; }
  .pp-sent { display: flex; align-items: flex-start; gap: 12px; background: #e8f5e8; border: 1px solid #cfe6cf; border-radius: 8px; padding: 12px; }
  .pp-sent-icon { flex: none; width: 36px; height: 36px; line-height: 36px; text-align: center; border-radius: 50%; background: #2a7e2a; color: #fff; font-size: 20px; font-weight: 700; }
  .pp-sent-text { font-size: 15px; color: #1f5d1f; line-height: 1.5; }

  .pp-footer { padding: 20px 16px 28px; text-align: center; }
`
