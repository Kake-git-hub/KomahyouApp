import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  PARENT_ABSENCE_CONFIRM_CANCEL_LABEL,
  PARENT_ABSENCE_CONFIRM_SUBMIT_LABEL,
  PARENT_ABSENCE_LIST_HINT,
  PARENT_ABSENCE_SENT_MESSAGE,
  PARENT_MESSAGE_NETWORK_ERROR_MESSAGE,
  PARENT_PORTAL_LOAD_FAILED_MESSAGE,
  PARENT_PORTAL_NETWORK_ERROR_MESSAGE,
  PARENT_PORTAL_NOTES,
  PARENT_SCHEDULE_TENTATIVE_LEGEND,
  buildParentAbsenceRowAriaLabel,
  buildParentPortalRequestUrl,
  buildParentScheduleRows,
  canShiftParentScheduleMonth,
  describeParentAbsenceBadge,
  describeParentAbsenceConfirm,
  formatParentScheduleMonthLabel,
  formatParentScheduleRowDateLabel,
  formatParentSnapshotSavedAtLabel,
  getParentPortalApiBaseUrl,
  isParentPortalScheduleResponse,
  readParentAbsenceNotices,
  resolveParentAbsenceSendError,
  resolveParentPortalLoadError,
  resolveParentScheduleMonthNotice,
  shiftParentScheduleMonth,
  shouldReloadParentScheduleAfterSendError,
  toParentAbsenceTarget,
  type ParentAbsenceNotice,
  type ParentAbsenceTarget,
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
//
// ★2026-09-18(オーナー指示): 自由記述の「教室へ連絡」フォームを廃止し、**授業行をタップ → 確認モーダル →
//   休み連絡**の 1 経路だけにした。本文・お名前の入力欄は復活させない(サーバーも受け付けない)。

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
  // 409 のあとに同じ範囲で引き直すための世代カウンタ(requestedRange だけだと同値で再取得されない)。
  const [reloadToken, setReloadToken] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [inlineError, setInlineError] = useState('')

  // 送信直後に「休み連絡済」を出すための楽観的な上乗せ(次の GET で正式な値に置き換わる)。
  const [optimisticNotices, setOptimisticNotices] = useState<ParentAbsenceNotice[]>([])
  const [absenceTarget, setAbsenceTarget] = useState<ParentAbsenceTarget | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sentMessage, setSentMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadSchedule() {
      try {
        const response = await fetch(buildParentPortalRequestUrl(apiBase, token, requestedRange), { cache: 'no-store' })
        if (cancelled) return
        // requestedRange が null なのは初回だけ(「前の月／次の月」は data 到着後にしか押せない)。
        // 初回の失敗は全面エラー、範囲移動の失敗は表示中の日程を残してインラインで知らせる。
        const isRefresh = requestedRange !== null || reloadToken > 0
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
        // サーバーの値が来たら楽観的な上乗せは捨てる(重複表示・取り消された連絡の残留を防ぐ)。
        setOptimisticNotices([])
      } catch {
        if (cancelled) return
        if (requestedRange !== null || reloadToken > 0) setInlineError(PARENT_PORTAL_NETWORK_ERROR_MESSAGE)
        else setLoadState({ status: 'error', message: PARENT_PORTAL_NETWORK_ERROR_MESSAGE })
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }
    loadSchedule()
    return () => {
      cancelled = true
    }
  }, [apiBase, token, requestedRange, reloadToken])

  const data = loadState.status === 'ready' ? loadState.data : null

  const shiftMonth = useCallback((deltaMonths: number) => {
    if (!data || refreshing) return
    const next = shiftParentScheduleMonth(data.range, deltaMonths, data.bounds)
    if (!next) return
    setInlineError('')
    setSentMessage('')
    setRefreshing(true)
    setRequestedRange(next)
  }, [data, refreshing])

  const reloadSchedule = useCallback(() => {
    setRefreshing(true)
    setReloadToken((current) => current + 1)
  }, [])

  const openAbsenceModal = useCallback((row: ParentScheduleRow) => {
    const target = toParentAbsenceTarget(row)
    if (!target) return
    setSendError('')
    setSentMessage('')
    setAbsenceTarget(target)
  }, [])

  const submitAbsence = useCallback(async () => {
    if (!absenceTarget || sending) return
    setSendError('')
    setSending(true)
    try {
      const response = await fetch(buildParentPortalRequestUrl(apiBase, token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey: absenceTarget.dateKey, slotNumber: absenceTarget.slotNumber }),
      })
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null)
        setSendError(resolveParentAbsenceSendError(response.status, result))
        // 画面の日程が古いために弾かれた(409)ときは取り直して、押せる行・バッジを最新にする。
        if (shouldReloadParentScheduleAfterSendError(response.status)) reloadSchedule()
        return
      }
      setOptimisticNotices((current) => [...current, { dateKey: absenceTarget.dateKey, slotNumber: absenceTarget.slotNumber, acknowledged: false }])
      setAbsenceTarget(null)
      setSentMessage(PARENT_ABSENCE_SENT_MESSAGE)
    } catch {
      setSendError(PARENT_MESSAGE_NETWORK_ERROR_MESSAGE)
    } finally {
      setSending(false)
    }
  }, [absenceTarget, apiBase, reloadSchedule, sending, token])

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
  const notices = [...readParentAbsenceNotices(schedule), ...optimisticNotices]
  const scheduleRows = buildParentScheduleRows(schedule.days, schedule.today, notices)
  const hasTentativeRow = scheduleRows.some((row) => row.isTentative)
  const hasReportableRow = scheduleRows.some((row) => row.canReportAbsence)
  const confirm = absenceTarget ? describeParentAbsenceConfirm(absenceTarget, schedule.today) : null

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

      {sentMessage ? (
        <div className="pp-sent-banner" role="status">
          <span className="pp-sent-icon" aria-hidden="true">✓</span>
          <span>{sentMessage}</span>
          <button type="button" className="pp-dismiss" onClick={() => setSentMessage('')} aria-label="閉じる">✕</button>
        </div>
      ) : null}

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
        {hasReportableRow ? <p className="pp-rows-hint">{PARENT_ABSENCE_LIST_HINT}</p> : null}
        {hasTentativeRow ? <p className="pp-rows-legend">{PARENT_SCHEDULE_TENTATIVE_LEGEND}</p> : null}
        {scheduleRows.length > 0 ? (
          <ul className="pp-rows">
            {scheduleRows.map((row) => <ParentScheduleRowItem key={row.key} row={row} onReportAbsence={openAbsenceModal} />)}
          </ul>
        ) : null}
        {monthNotice ? <p className="pp-muted pp-days-empty">{monthNotice}</p> : null}
      </section>

      <footer className="pp-footer">
        <p className="pp-muted">このページは教室から配布されたQRコード専用です。第三者に共有しないでください。</p>
      </footer>

      {confirm ? (
        <div className="pp-modal-backdrop" role="dialog" aria-modal="true" aria-label="お休みの連絡">
          <div className="pp-modal">
            <div className="pp-modal-target">{confirm.target}</div>
            <p className="pp-modal-question">{confirm.question}</p>
            <ul className="pp-modal-notes">
              {confirm.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
            {sendError ? <p className="pp-send-error" role="alert">{sendError}</p> : null}
            <div className="pp-modal-actions">
              <button
                type="button"
                className={`pp-send-button${sending ? ' pp-disabled' : ''}`}
                onClick={submitAbsence}
                disabled={sending}
              >
                {sending ? '送信中...' : PARENT_ABSENCE_CONFIRM_SUBMIT_LABEL}
              </button>
              <button type="button" className="pp-modal-cancel" onClick={() => setAbsenceTarget(null)} disabled={sending}>
                {PARENT_ABSENCE_CONFIRM_CANCEL_LABEL}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <style>{baseStyles}</style>
    </div>
  )
}

// 1 コマ 1 行(確認リスト その他 2026-09-14)。日付は同じ日の先頭行だけに出す。
// 休み連絡できる行だけボタン相当にする(role/tabIndex/キーボード操作・aria-label を付ける)。
// ★li のままボタンを内側に足すと 1 行(幅 390px)に収まらなくなるので、行そのものを押せるようにしている。
function ParentScheduleRowItem({ row, onReportAbsence }: { row: ParentScheduleRow; onReportAbsence: (row: ParentScheduleRow) => void }) {
  const weekdayClass = row.weekday === 0 ? ' pp-row-sun' : row.weekday === 6 ? ' pp-row-sat' : ''
  const kindClass = row.rowKind === 'lesson' ? ` pp-lesson-${row.lessonKind}` : ` pp-row-${row.rowKind}`
  const badge = describeParentAbsenceBadge(row.absenceStatus)
  const ariaLabel = buildParentAbsenceRowAriaLabel(row)
  const tappable = row.canReportAbsence
  return (
    <li
      className={`pp-row${weekdayClass}${kindClass}${row.isFirstOfDay ? ' pp-row-first' : ''}${row.isToday ? ' pp-row-today' : ''}${tappable ? ' pp-row-tappable' : ''}`}
      {...(tappable
        ? {
          role: 'button',
          tabIndex: 0,
          'aria-label': ariaLabel ?? undefined,
          onClick: () => onReportAbsence(row),
          onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onReportAbsence(row)
          },
        }
        : {})}
    >
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
        {badge ? <span className={`pp-row-absence pp-row-absence-${row.absenceStatus}`}>{badge}</span> : null}
        {row.isFirstOfDay && row.isToday ? <span className="pp-day-today-badge">今日</span> : null}
      </span>
      {tappable ? <span className="pp-row-chevron" aria-hidden="true">›</span> : null}
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
  .pp-sent-banner { display: flex; align-items: center; gap: 8px; margin: 10px 12px 0; padding: 10px 12px; background: #e8f5e8; border: 1px solid #cfe6cf; color: #1f5d1f; font-size: 15px; font-weight: 700; border-radius: 8px; }
  .pp-sent-banner .pp-dismiss { margin-left: auto; color: #1f5d1f; }
  .pp-sent-icon { flex: none; width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; background: #2a7e2a; color: #fff; font-size: 14px; font-weight: 700; }
  .pp-dismiss { background: none; border: none; color: #c00; font-size: 18px; cursor: pointer; padding: 0 4px; }

  .pp-range-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 12px 0; }
  .pp-range-button { flex: none; padding: 10px 12px; border: 1px solid #bbb; border-radius: 8px; background: #fff; font-size: 14px; font-weight: 700; color: #222; cursor: pointer; touch-action: manipulation; }
  .pp-range-button:disabled { opacity: .4; cursor: default; }
  .pp-range-label { flex: 1; min-width: 0; text-align: center; font-size: 13px; color: #444; line-height: 1.3; }
  .pp-range-refreshing { display: block; font-size: 12px; color: #888; }

  .pp-days { margin: 12px 8px 0; }
  .pp-days-empty { text-align: center; padding: 16px; }
  .pp-rows-hint { font-size: 13px; color: #1f5d96; font-weight: 700; margin: 0 0 6px; }
  .pp-rows-legend { font-size: 12px; color: #666; margin: 0 0 6px; }
  .pp-rows { list-style: none; background: #fff; border: 1px solid #ddd; border-radius: 10px; overflow: hidden; }
  /* 列幅は「14日(月)」「5限19:40」がちょうど入る幅に詰め、補足(振替の月日コマ)まで 1 行に収める(確認リスト k-11)。
     タップできる行だけ末尾に「›」の列を足す(幅は 0.8em で、1 行表示を崩さない)。 */
  .pp-row { display: grid; grid-template-columns: 4.7em 4.5em minmax(0, 1fr); align-items: baseline; column-gap: 6px; padding: 6px 8px; font-size: 15px; line-height: 1.35; }
  .pp-row-tappable { grid-template-columns: 4.7em 4.5em minmax(0, 1fr) 0.8em; cursor: pointer; touch-action: manipulation; }
  .pp-row-tappable:active { background: #eef4fb; }
  .pp-row-tappable:focus-visible { outline: 2px solid #1f5d96; outline-offset: -2px; }
  .pp-row-chevron { color: #1f5d96; font-weight: 700; text-align: right; }
  .pp-row + .pp-row { border-top: 1px solid #eee; }
  .pp-row + .pp-row-first { border-top-color: #cfd8e3; }
  .pp-row-date { font-weight: 700; white-space: nowrap; }
  .pp-row-sun .pp-row-date { color: #d00; }
  .pp-row-sat .pp-row-date { color: #00c; }
  .pp-row-today { background: #eef4fb; box-shadow: inset 3px 0 0 #1f5d96; }
  .pp-day-today-badge { display: inline-block; font-size: 11px; font-weight: 700; color: #fff; background: #1f5d96; border-radius: 999px; padding: 0 5px; vertical-align: middle; }
  .pp-row-slot { font-weight: 700; color: #16314f; white-space: nowrap; }
  .pp-lesson-time { margin-left: 2px; font-size: 11px; font-weight: 400; color: #777; }
  .pp-row-body { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; min-width: 0; }
  .pp-lesson-main { font-weight: 700; white-space: nowrap; }
  .pp-lesson-sub { font-size: 12px; color: #444; white-space: nowrap; }
  /* 教室休み・授業の無い日は時限欄が空なので、本文を時限欄まで広げて 1 行に収める(k-11)。 */
  .pp-row-closed .pp-row-slot, .pp-row-status .pp-row-slot { display: none; }
  .pp-row-closed .pp-row-body, .pp-row-status .pp-row-body { grid-column: 2 / -1; }
  /* 教室休みから複数コマを振替に回すと振替先が長くなるので、この行だけは折り返して切らない(レビュー指摘 A-4)。 */
  .pp-row-closed .pp-lesson-sub { white-space: normal; }
  .pp-row-tentative { font-size: 11px; color: #7a5b00; background: #f9e79f; border-radius: 999px; padding: 0 6px; }
  /* 休み連絡のバッジ。行が折り返してもよい(バッジが付く行だけの例外・オーナー了承 2026-09-18)。 */
  .pp-row-absence { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 0 6px; white-space: nowrap; }
  .pp-row-absence-reported { color: #7a3b00; background: #ffe0b2; }
  .pp-row-absence-acknowledged { color: #fff; background: #2a7e2a; }
  .pp-row-closed, .pp-row-status { color: #666; background: #f6f6f6; }
  .pp-row-closed .pp-lesson-main, .pp-row-status .pp-lesson-main { font-weight: 400; }
  .pp-lesson-makeup .pp-lesson-sub { color: #1f5d96; font-weight: 700; }
  .pp-lesson-absent .pp-lesson-main, .pp-lesson-absent-no-makeup .pp-lesson-main { color: #b00020; }
  .pp-lesson-absent .pp-lesson-sub { color: #1f5d96; font-weight: 700; }
  .pp-lesson-attended .pp-lesson-sub { color: #2a7e2a; }

  .pp-modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
  .pp-modal { width: 100%; max-width: 420px; background: #fff; border-radius: 12px; padding: 18px 16px; display: grid; gap: 10px; max-height: 90dvh; overflow-y: auto; }
  .pp-modal-target { font-size: 19px; font-weight: 700; line-height: 1.4; }
  .pp-modal-question { font-size: 16px; line-height: 1.5; }
  .pp-modal-notes { list-style: none; display: grid; gap: 4px; font-size: 13px; color: #555; line-height: 1.5; }
  .pp-modal-notes li::before { content: '・'; }
  .pp-modal-actions { display: grid; gap: 8px; margin-top: 4px; }
  .pp-send-error { font-size: 14px; color: #c00; }
  .pp-send-button { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; background: #111; color: #fff; font-size: 18px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
  .pp-modal-cancel { display: block; width: 100%; padding: 12px; border: 1px solid #bbb; border-radius: 8px; background: #fff; color: #222; font-size: 16px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
  .pp-disabled { opacity: .5; cursor: not-allowed; }

  .pp-footer { padding: 20px 16px 28px; text-align: center; }
`
