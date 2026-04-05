import { useCallback, useEffect, useMemo, useState } from 'react'

type SubmissionData = {
  personName: string
  personType: 'student' | 'teacher'
  sessionLabel: string
  sessionStartDate: string
  sessionEndDate: string
  closedWeekdays: number[]
  forceOpenDates: string[]
  availableSubjects: string[]
  slotCount: number
  status: 'pending' | 'submitted'
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  regularOnly: boolean
  occupiedSlots: Record<string, string>
}

type DateSlot = {
  dateKey: string
  label: string
  dayOfWeek: number
  slots: number[]
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function getSubmissionApiBaseUrl() {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
    return `${origin}/api/submission`
  }
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || ''
  const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-northeast1'
  if (projectId) {
    return `https://${region}-${projectId}.cloudfunctions.net/lectureSubmissionApi`
  }
  return `${origin}/api/submission`
}

function buildAvailableDates(startDate: string, endDate: string, closedWeekdays: number[], forceOpenDates: string[], slotCount: number): DateSlot[] {
  const dates: DateSlot[] = []
  const forceOpenSet = new Set(forceOpenDates)
  const current = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  while (current <= end) {
    const year = current.getFullYear()
    const month = String(current.getMonth() + 1).padStart(2, '0')
    const day = String(current.getDate()).padStart(2, '0')
    const dateKey = `${year}-${month}-${day}`
    const dayOfWeek = current.getDay()

    const isClosed = closedWeekdays.includes(dayOfWeek) && !forceOpenSet.has(dateKey)
    if (!isClosed) {
      const displayMonth = current.getMonth() + 1
      const displayDay = current.getDate()
      dates.push({
        dateKey,
        label: `${displayMonth}/${displayDay}(${WEEKDAY_LABELS[dayOfWeek]})`,
        dayOfWeek,
        slots: Array.from({ length: Math.min(slotCount, 5) }, (_, i) => i + 1),
      })
    }
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export default function SubmissionPage({ token }: { token: string }) {
  const [data, setData] = useState<SubmissionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set())
  const [subjectSlots, setSubjectSlots] = useState<Record<string, number>>({})
  const [regularOnly, setRegularOnly] = useState(false)

  const apiBase = useMemo(() => getSubmissionApiBaseUrl(), [])

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch(`${apiBase}/${encodeURIComponent(token)}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('このリンクは無効です。QRコードを再度確認してください。')
          } else {
            setError('データの読み込みに失敗しました。')
          }
          return
        }
        const result = await response.json() as SubmissionData
        setData(result)
        if (result.status === 'submitted') {
          setSubmitted(true)
        }
        setSelectedSlots(new Set(result.unavailableSlots ?? []))
        setSubjectSlots(result.subjectSlots ?? {})
        setRegularOnly(result.regularOnly ?? false)
      } catch {
        setError('通信エラーが発生しました。インターネット接続を確認してください。')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [apiBase, token])

  const availableDates = useMemo(() => {
    if (!data) return []
    return buildAvailableDates(data.sessionStartDate, data.sessionEndDate, data.closedWeekdays, data.forceOpenDates, data.slotCount)
  }, [data])

  const toggleSlot = useCallback((slotKey: string, occupiedLabel?: string) => {
    setSelectedSlots((prev) => {
      const wasSelected = prev.has(slotKey)
      if (wasSelected) {
        const next = new Set(prev)
        next.delete(slotKey)
        return next
      }
      // Selecting as unavailable — confirm if occupied
      if (occupiedLabel && !window.confirm(`${occupiedLabel}が組まれていますが出席不可として提出しますか？`)) {
        return prev
      }
      const next = new Set(prev)
      next.add(slotKey)
      return next
    })
  }, [])

  const toggleAllSlotsForDate = useCallback((dateKey: string, slots: number[], occupiedMap: Record<string, string>) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev)
      const keys = slots.map((s) => `${dateKey}_${s}`)
      const allSelected = keys.every((k) => next.has(k))
      if (allSelected) {
        keys.forEach((k) => next.delete(k))
      } else {
        const occupiedKeys = keys.filter((k) => !next.has(k) && occupiedMap[k])
        if (occupiedKeys.length > 0) {
          const labels = [...new Set(occupiedKeys.map((k) => occupiedMap[k]))].join('・')
          if (!window.confirm(`${labels}が組まれている日ですが終日不可として提出しますか？`)) return prev
        }
        keys.forEach((k) => next.add(k))
      }
      return next
    })
  }, [])

  const handleSubjectChange = useCallback((subject: string, value: number) => {
    setSubjectSlots((prev) => ({ ...prev, [subject]: Math.max(0, value) }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted) return
    if (!window.confirm('提出します。提出後の変更はできません。よろしいですか？')) return
    setSubmitting(true)
    try {
      const response = await fetch(`${apiBase}/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unavailableSlots: Array.from(selectedSlots),
          subjectSlots,
          regularOnly,
        }),
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        if (response.status === 409) {
          setError('既に提出済みです。')
          setSubmitted(true)
          return
        }
        setError(result.error || '提出に失敗しました。')
        return
      }
      setSubmitted(true)
    } catch {
      setError('通信エラーが発生しました。再度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }, [apiBase, token, selectedSlots, subjectSlots, regularOnly, submitting, submitted])

  if (loading) {
    return (
      <div className="sub-container">
        <div className="sub-center-box">
          <div className="sub-spinner" />
          <p className="sub-muted">読み込み中...</p>
        </div>
        <style>{baseStyles}</style>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="sub-container">
        <div className="sub-center-box">
          <p style={{ fontSize: 48 }}>⚠</p>
          <p>{error}</p>
        </div>
        <style>{baseStyles}</style>
      </div>
    )
  }

  if (!data) return null

  if (submitted) {
    return (
      <div className="sub-container">
        <div className="sub-center-box">
          <p className="sub-success-icon">✓</p>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>提出完了</h2>
          <p style={{ fontSize: 14, color: '#333' }}>
            {data.personName}さんの{data.sessionLabel}の希望を受け付けました。
          </p>
          <p className="sub-muted" style={{ marginTop: 8 }}>このページを閉じてください。</p>
        </div>
        <style>{baseStyles}</style>
      </div>
    )
  }

  const isStudent = data.personType === 'student'
  const totalUnavailable = selectedSlots.size
  const totalSubjectCount = Object.values(subjectSlots).reduce((sum, v) => sum + v, 0)
  const occupiedSlots = data.occupiedSlots ?? {}
  const maxSlot = availableDates.length > 0 ? Math.max(...availableDates.map((d) => d.slots.length)) : 5

  return (
    <div className="sub-container">
      <header className="sub-header">
        <div className="sub-header-title">{data.sessionLabel}</div>
        <div className="sub-header-name">{data.personName}</div>
        <div className="sub-muted" style={{ fontSize: 12 }}>
          {data.sessionStartDate.replace(/-/g, '/')} 〜 {data.sessionEndDate.replace(/-/g, '/')}
        </div>
      </header>

      {error && (
        <div className="sub-inline-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="sub-dismiss">✕</button>
        </div>
      )}

      <section className="sub-section">
        <div className="sub-section-head">
          <span className="sub-section-title">出席不可コマ</span>
          <span className="sub-muted">不可: <strong>{totalUnavailable}</strong>コマ</span>
        </div>
        <p className="sub-muted" style={{ margin: '0 0 8px', fontSize: 11, lineHeight: 1.4 }}>
          出席できないコマをタップしてください。日付をタップすると終日不可になります。
        </p>

        <div className="sub-table-wrap">
          <table className="sub-slot-table">
            <thead>
              <tr>
                <th className="sub-th-date">日付</th>
                {Array.from({ length: maxSlot }, (_, i) => (
                  <th key={i} className="sub-th-slot">{i + 1}限</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {availableDates.map((dateSlot) => {
                const isSunday = dateSlot.dayOfWeek === 0
                const isSaturday = dateSlot.dayOfWeek === 6
                const dateColor = isSunday ? '#d00' : isSaturday ? '#00c' : undefined
                const allSelected = dateSlot.slots.every((s) => selectedSlots.has(`${dateSlot.dateKey}_${s}`))

                return (
                  <tr key={dateSlot.dateKey} className={allSelected ? 'sub-row-all' : ''}>
                    <td
                      className="sub-td-date"
                      style={dateColor ? { color: dateColor } : undefined}
                      onPointerDown={() => toggleAllSlotsForDate(dateSlot.dateKey, dateSlot.slots, occupiedSlots)}
                    >
                      {dateSlot.label}
                    </td>
                    {dateSlot.slots.map((slot) => {
                      const slotKey = `${dateSlot.dateKey}_${slot}`
                      const isSelected = selectedSlots.has(slotKey)
                      const occupied = occupiedSlots[slotKey]

                      return (
                        <td
                          key={slot}
                          className={`sub-td-slot${isSelected ? ' sub-slot-x' : ''}${occupied && !isSelected ? ' sub-slot-occ' : ''}`}
                          onPointerDown={() => toggleSlot(slotKey, occupied)}
                        >
                          {isSelected
                            ? (occupied ? <><span className="sub-x-mark">✕</span><span className="sub-x-label">{occupied}</span></> : '✕')
                            : (occupied || '')}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {isStudent && (
        <section className="sub-section">
          <div className="sub-section-head">
            <span className="sub-section-title">希望科目数</span>
            <span className="sub-muted">合計: <strong>{totalSubjectCount}</strong>コマ</span>
          </div>
          <div className="sub-subject-list">
            {data.availableSubjects.map((subject) => (
              <div key={subject} className="sub-subject-row">
                <span className="sub-subject-label">{subject}</span>
                <div className="sub-subject-ctrl">
                  <button
                    type="button"
                    className="sub-counter-btn"
                    onClick={() => handleSubjectChange(subject, (subjectSlots[subject] ?? 0) - 1)}
                    disabled={(subjectSlots[subject] ?? 0) <= 0}
                  >−</button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="999"
                    className="sub-counter-input"
                    value={subjectSlots[subject] ?? 0}
                    onChange={(e) => handleSubjectChange(subject, parseInt(e.target.value, 10) || 0)}
                  />
                  <button
                    type="button"
                    className="sub-counter-btn"
                    onClick={() => handleSubjectChange(subject, (subjectSlots[subject] ?? 0) + 1)}
                  >+</button>
                </div>
              </div>
            ))}
          </div>
          <label className="sub-checkbox-row">
            <input
              type="checkbox"
              checked={regularOnly}
              onChange={(e) => setRegularOnly(e.target.checked)}
              className="sub-checkbox"
            />
            <span>通常授業のみ（講習なし）</span>
          </label>
        </section>
      )}

      <section className="sub-section sub-submit-section">
        <div className="sub-summary">
          <span>不可: <strong>{totalUnavailable}</strong>コマ</span>
          {isStudent && <span>科目計: <strong>{totalSubjectCount}</strong>コマ</span>}
          {isStudent && regularOnly && <span style={{ color: '#888' }}>通常のみ</span>}
        </div>
        <button
          type="button"
          className={`sub-submit-btn${submitting ? ' sub-disabled' : ''}`}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? '送信中...' : '提出する'}
        </button>
        <p className="sub-muted" style={{ textAlign: 'center', marginTop: 6, fontSize: 11 }}>※ 提出後の変更はできません</p>
      </section>

      <style>{baseStyles}</style>
    </div>
  )
}

const baseStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 14px; -webkit-text-size-adjust: 100%; }
  body { margin: 0; font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif; color: #111; background: #f5f5f5; overflow-x: hidden; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .sub-container { min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom, 0); max-width: 100vw; overflow-x: hidden; }
  .sub-center-box { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60dvh; padding: 24px; text-align: center; }
  .sub-spinner { width: 36px; height: 36px; border: 3px solid #ddd; border-top-color: #333; border-radius: 50%; animation: spin .8s linear infinite; margin-bottom: 12px; }
  .sub-muted { font-size: 13px; color: #666; }
  .sub-success-icon { font-size: 48px; color: #2a7e2a; background: #e8f5e8; border-radius: 50%; width: 72px; height: 72px; line-height: 72px; text-align: center; margin-bottom: 12px; }

  .sub-header { background: #fff; border-bottom: 1px solid #ddd; padding: 16px 12px; text-align: center; }
  .sub-header-title { font-size: 17px; font-weight: 700; margin-bottom: 2px; }
  .sub-header-name { font-size: 15px; font-weight: 600; color: #333; margin-bottom: 2px; }

  .sub-inline-error { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #fee; color: #c00; font-size: 13px; }
  .sub-dismiss { background: none; border: none; color: #c00; font-size: 16px; cursor: pointer; padding: 0 4px; }

  .sub-section { background: #fff; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 8px; margin: 8px 0; }
  .sub-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; padding: 0 4px; }
  .sub-section-title { font-size: 15px; font-weight: 700; }

  /* Slot table — fit viewport width */
  .sub-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .sub-slot-table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 12px; touch-action: manipulation; }
  .sub-slot-table th, .sub-slot-table td { border: 1px solid #ccc; text-align: center; padding: 0; }
  .sub-th-date { width: 64px; min-width: 54px; padding: 5px 1px; background: #f0f0f0; font-weight: 600; font-size: 10px; position: sticky; left: 0; z-index: 1; }
  .sub-th-slot { padding: 5px 0; background: #f0f0f0; font-weight: 600; font-size: 11px; }
  .sub-td-date { padding: 6px 1px; font-weight: 600; font-size: 11px; cursor: pointer; user-select: none; white-space: nowrap; background: #fff; position: sticky; left: 0; z-index: 1; touch-action: manipulation; }
  .sub-td-slot { padding: 2px 1px; min-width: 0; height: 40px; cursor: pointer; user-select: none; font-size: 11px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .sub-slot-x { background: #fee5e5 !important; color: #c00; font-weight: 700; }
  .sub-x-mark { display: block; font-size: 14px; line-height: 1; }
  .sub-x-label { display: block; font-size: 8px; line-height: 1; margin-top: 1px; }
  .sub-slot-occ { background: #e8f0ff; color: #336; font-size: 10px; font-weight: 600; }
  .sub-row-all .sub-td-date { background: #fff0f0; }

  /* Subject */
  .sub-subject-list { display: flex; flex-direction: column; gap: 6px; padding: 0 4px; }
  .sub-subject-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 2px; border-bottom: 1px solid #eee; }
  .sub-subject-label { font-size: 15px; font-weight: 600; min-width: 36px; }
  .sub-subject-ctrl { display: flex; align-items: center; gap: 6px; }
  .sub-counter-btn { width: 36px; height: 36px; border-radius: 6px; border: 1px solid #ccc; background: #f8f8f8; font-size: 18px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; touch-action: manipulation; }
  .sub-counter-btn:disabled { opacity: .3; }
  .sub-counter-input { width: 48px; height: 36px; text-align: center; font-size: 16px; font-weight: 600; border: 1px solid #ccc; border-radius: 6px; -moz-appearance: textfield; }
  .sub-counter-input::-webkit-inner-spin-button, .sub-counter-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .sub-checkbox-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 0 4px; font-size: 14px; cursor: pointer; }
  .sub-checkbox { width: 18px; height: 18px; accent-color: #333; }

  /* Submit */
  .sub-submit-section { padding: 12px; }
  .sub-summary { display: flex; gap: 12px; flex-wrap: wrap; background: #f8f8f8; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
  .sub-submit-btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; background: #111; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
  .sub-disabled { opacity: .5; cursor: not-allowed; }

  @media (max-width: 360px) {
    .sub-th-date { width: 52px; min-width: 48px; font-size: 9px; padding: 4px 0; }
    .sub-td-date { font-size: 10px; padding: 5px 0; }
    .sub-th-slot { font-size: 10px; }
    .sub-td-slot { height: 38px; font-size: 10px; }
    .sub-x-label { font-size: 7px; }
    .sub-slot-occ { font-size: 9px; }
    .sub-section { padding: 6px; }
  }
`
