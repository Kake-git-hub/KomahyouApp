import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type SubmissionData = {
  personName: string
  personType: 'student' | 'teacher'
  sessionLabel: string
  sessionStartDate: string
  sessionEndDate: string
  closedWeekdays: number[]
  // コマ表側で個別に休日設定した日付(YYYY-MM-DD)。定休日と合わせて提出不可(休校日)にする。
  holidayDates?: string[]
  forceOpenDates: string[]
  availableSubjects: string[]
  slotCount: number
  slotNumbers?: number[]
  status: 'pending' | 'submitted'
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  subjectDurations: Record<string, number>
  // spec-group-lesson §C: 集団授業(中3のみ)。availableGroupClassSubjects が非空なら参加/不参加欄を表示。
  availableGroupClassSubjects?: string[]
  groupClassParticipation?: Record<string, boolean>
  regularOnly: boolean
  occupiedSlots: Record<string, string>
}

export type DateSlot = {
  dateKey: string
  label: string
  dayOfWeek: number
  slots: number[]
  isClosed: boolean
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

function normalizeSlotNumbers(slotNumbers: number[] | undefined, slotCount: number) {
  const source = Array.isArray(slotNumbers) && slotNumbers.length > 0
    ? slotNumbers
    : Array.from({ length: Math.max(1, Math.min(20, slotCount || 7)) }, (_, index) => index + 1)

  return Array.from(new Set(source
    .map((slotNumber) => Math.trunc(Number(slotNumber)))
    .filter((slotNumber) => Number.isFinite(slotNumber) && slotNumber > 0 && slotNumber <= 20)))
    .sort((left, right) => left - right)
}

export function buildAvailableDates(startDate: string, endDate: string, closedWeekdays: number[], forceOpenDates: string[], holidayDates: string[], slotNumbers: number[]): DateSlot[] {
  const dates: DateSlot[] = []
  const forceOpenSet = new Set(forceOpenDates)
  const holidaySet = new Set(holidayDates)
  const current = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  while (current <= end) {
    const year = current.getFullYear()
    const month = String(current.getMonth() + 1).padStart(2, '0')
    const day = String(current.getDate()).padStart(2, '0')
    const dateKey = `${year}-${month}-${day}`
    const dayOfWeek = current.getDay()

    // 定休日(曜日) または コマ表で個別設定した休日 はいずれも「休校日」として提出不可にする。
    const isClosed = (closedWeekdays.includes(dayOfWeek) && !forceOpenSet.has(dateKey)) || holidaySet.has(dateKey)
    const displayMonth = current.getMonth() + 1
    const displayDay = current.getDate()
    dates.push({
      dateKey,
      label: `${displayMonth}/${displayDay}(${WEEKDAY_LABELS[dayOfWeek]})`,
      dayOfWeek,
      slots: [...slotNumbers],
      isClosed,
    })
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
  // リンクを開いた時点で既に提出済みだった場合（=今回の提出ではない）。「すでに提出済みです」を出し分ける。
  const [loadedAsSubmitted, setLoadedAsSubmitted] = useState(false)
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set())
  const [subjectSlots, setSubjectSlots] = useState<Record<string, number>>({})
  // 科目ごとの授業時間(分)。90(既定)は保持せず、60/45 のみ保持する。
  const [subjectDurations, setSubjectDurations] = useState<Record<string, number>>({})
  // spec-group-lesson §C: 集団授業の参加/不参加。未設定/false=不参加(既定)。
  const [groupClassParticipation, setGroupClassParticipation] = useState<Record<string, boolean>>({})
  const [regularOnly, setRegularOnly] = useState(false)

  const selectedSlotsRef = useRef<Set<string>>(new Set())
  selectedSlotsRef.current = selectedSlots

  const apiBase = useMemo(() => getSubmissionApiBaseUrl(), [])

  // Lock viewport scale for mobile
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]')
    if (meta) {
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover')
    }
  }, [])

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch(`${apiBase}/${encodeURIComponent(token)}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('このリンクは無効です。管理者にお問い合わせください。')
          } else {
            setError('データの読み込みに失敗しました。')
          }
          return
        }
        const result = await response.json() as SubmissionData
        setData(result)
        if (result.status === 'submitted') {
          setSubmitted(true)
          setLoadedAsSubmitted(true)
        }
        setSelectedSlots(new Set(result.unavailableSlots ?? []))
        setSubjectSlots(result.subjectSlots ?? {})
        setSubjectDurations(result.subjectDurations ?? {})
        setGroupClassParticipation(result.groupClassParticipation ?? {})
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
    return buildAvailableDates(
      data.sessionStartDate,
      data.sessionEndDate,
      data.closedWeekdays,
      data.forceOpenDates,
      data.holidayDates ?? [],
      normalizeSlotNumbers(data.slotNumbers, data.slotCount),
    )
  }, [data])

  const toggleSlot = useCallback((slotKey: string, occupiedLabel?: string) => {
    if (selectedSlotsRef.current.has(slotKey)) {
      setSelectedSlots((prev) => { const next = new Set(prev); next.delete(slotKey); return next })
      return
    }
    if (occupiedLabel && !window.confirm(`${occupiedLabel}が組まれていますが出席不可として提出しますか？`)) return
    setSelectedSlots((prev) => { const next = new Set(prev); next.add(slotKey); return next })
  }, [])

  const toggleAllSlotsForDate = useCallback((dateKey: string, slots: number[], occupiedMap: Record<string, string>) => {
    const keys = slots.map((s) => `${dateKey}_${s}`)
    const allSelected = keys.every((k) => selectedSlotsRef.current.has(k))
    if (allSelected) {
      setSelectedSlots((prev) => { const next = new Set(prev); keys.forEach((k) => next.delete(k)); return next })
      return
    }
    const occupiedKeys = keys.filter((k) => !selectedSlotsRef.current.has(k) && occupiedMap[k])
    if (occupiedKeys.length > 0) {
      const labels = [...new Set(occupiedKeys.map((k) => occupiedMap[k]))].join('・')
      if (!window.confirm(`${labels}が組まれている日ですが終日不可として提出しますか？`)) return
    }
    setSelectedSlots((prev) => { const next = new Set(prev); keys.forEach((k) => next.add(k)); return next })
  }, [])

  const openDates = useMemo(() => availableDates.filter((d) => !d.isClosed), [availableDates])

  const toggleAllSlotsForColumn = useCallback((slotNumber: number, occupiedMap: Record<string, string>) => {
    const keys = openDates.map((d) => `${d.dateKey}_${slotNumber}`)
    const allSelected = keys.every((k) => selectedSlotsRef.current.has(k))
    if (allSelected) {
      setSelectedSlots((prev) => { const next = new Set(prev); keys.forEach((k) => next.delete(k)); return next })
      return
    }
    const occupiedKeys = keys.filter((k) => !selectedSlotsRef.current.has(k) && occupiedMap[k])
    if (occupiedKeys.length > 0) {
      const labels = [...new Set(occupiedKeys.map((k) => occupiedMap[k]))].join('・')
      if (!window.confirm(`${labels}が組まれているコマがありますが全て不可として提出しますか？`)) return
    }
    setSelectedSlots((prev) => { const next = new Set(prev); keys.forEach((k) => next.add(k)); return next })
  }, [openDates])

  const handleSubjectChange = useCallback((subject: string, value: number) => {
    const nextValue = Math.max(0, value)
    setSubjectSlots((prev) => ({ ...prev, [subject]: nextValue }))
    // 希望数が0になったら授業時間の保持も解除（既定90へ戻す）。
    if (nextValue <= 0) {
      setSubjectDurations((prev) => {
        if (!(subject in prev)) return prev
        const next = { ...prev }
        delete next[subject]
        return next
      })
    }
  }, [])

  const handleDurationChange = useCallback((subject: string, minutes: number) => {
    setSubjectDurations((prev) => {
      const next = { ...prev }
      if (minutes === 60 || minutes === 45) next[subject] = minutes
      else delete next[subject] // 90(既定)は保持しない
      return next
    })
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted) return
    if (!window.confirm('提出します。よろしいですか？')) return
    setSubmitting(true)
    try {
      const response = await fetch(`${apiBase}/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unavailableSlots: Array.from(selectedSlots),
          subjectSlots,
          subjectDurations,
          groupClassParticipation,
          regularOnly,
        }),
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        if (response.status === 409) {
          setSubmitted(true)
          setLoadedAsSubmitted(true)
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
  }, [apiBase, token, selectedSlots, subjectSlots, subjectDurations, groupClassParticipation, regularOnly, submitting, submitted])

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

  // 提出後／既提出リンク: 提出した内容を「閲覧専用(編集不可)」で表示する。
  if (submitted) {
    const isStudentView = data.personType === 'student'
    const viewOccupiedSlots = data.occupiedSlots ?? {}
    const viewMaxSlot = availableDates.length > 0 ? Math.max(...availableDates.map((d) => d.slots.length)) : 5
    const viewUnavailableCount = selectedSlots.size
    const viewSubjectTotal = Object.values(subjectSlots).reduce((sum, v) => sum + v, 0)
    const submittedSubjects = data.availableSubjects.filter((subject) => (subjectSlots[subject] ?? 0) > 0)
    return (
      <div className="sub-container">
        <header className="sub-header">
          <div className="sub-header-title">{data.sessionLabel}</div>
          <div className="sub-header-name">{data.personName}</div>
          <div className="sub-muted" style={{ fontSize: 12 }}>
            {data.sessionStartDate.replace(/-/g, '/')} 〜 {data.sessionEndDate.replace(/-/g, '/')}
          </div>
        </header>

        <div className="sub-submitted-banner">
          <span className="sub-submitted-check">✓</span>
          <div className="sub-submitted-text">
            <div className="sub-submitted-title">{loadedAsSubmitted ? 'すでに提出済みです' : '提出が完了しました'}</div>
            <div className="sub-submitted-sub">以下の内容で提出されています（閲覧のみ・編集はできません）</div>
          </div>
        </div>

        <section className="sub-section">
          <div className="sub-section-head">
            <span className="sub-section-title">出席不可コマ</span>
            <span className="sub-muted">不可: <strong>{viewUnavailableCount}</strong>コマ</span>
          </div>
          <div className="sub-table-wrap">
            <table className="sub-slot-table sub-slot-table-readonly">
              <thead>
                <tr>
                  <th className="sub-th-date">日付</th>
                  {Array.from({ length: viewMaxSlot }, (_, i) => (
                    <th key={i} className="sub-th-slot">{i + 1}限</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {availableDates.map((dateSlot) => {
                  const isSunday = dateSlot.dayOfWeek === 0
                  const isSaturday = dateSlot.dayOfWeek === 6
                  if (dateSlot.isClosed) {
                    return (
                      <tr key={dateSlot.dateKey} className={`sub-row-closed${isSunday ? ' sub-row-sun' : ''}${isSaturday ? ' sub-row-sat' : ''}`}>
                        <td className="sub-td-date">{dateSlot.label}</td>
                        <td className="sub-td-slot sub-slot-closed sub-slot-closed-merged" colSpan={viewMaxSlot}>休校日</td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={dateSlot.dateKey} className={`${isSunday ? ' sub-row-sun' : ''}${isSaturday ? ' sub-row-sat' : ''}`}>
                      <td className="sub-td-date">{dateSlot.label}</td>
                      {dateSlot.slots.map((slot) => {
                        const slotKey = `${dateSlot.dateKey}_${slot}`
                        const isSelected = selectedSlots.has(slotKey)
                        const occupied = viewOccupiedSlots[slotKey]
                        return (
                          <td key={slot} className={`sub-td-slot${isSelected ? ' sub-slot-x' : ''}${occupied && !isSelected ? ' sub-slot-occ' : ''}`}>
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

        {isStudentView && (
          <section className="sub-section">
            <div className="sub-section-head">
              <span className="sub-section-title">希望科目数</span>
              <span className="sub-muted">合計: <strong>{viewSubjectTotal}</strong>コマ</span>
            </div>
            {submittedSubjects.length > 0 ? (
              <div className="sub-subject-list">
                {submittedSubjects.map((subject) => {
                  const count = subjectSlots[subject] ?? 0
                  const minutes = subjectDurations[subject] === 60 ? 60 : subjectDurations[subject] === 45 ? 45 : 90
                  return (
                    <div key={subject} className="sub-subject-row sub-subject-row-readonly">
                      <span className="sub-subject-label">{subject}</span>
                      <span className="sub-subject-readonly-value">{count}コマ<span className="sub-readonly-minutes">/ {minutes}分</span></span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="sub-muted" style={{ padding: '6px 4px' }}>希望科目はありません。</p>
            )}
            {regularOnly && (
              <p className="sub-muted" style={{ padding: '6px 4px', color: '#555' }}>※ 通常授業のみ（講習なし）で提出</p>
            )}
          </section>
        )}

        <section className="sub-section sub-submit-section">
          <p className="sub-muted" style={{ textAlign: 'center', fontSize: 12 }}>変更が必要な場合は教室にお問い合わせください。</p>
        </section>

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
                  <th key={i} className="sub-th-slot" onClick={() => toggleAllSlotsForColumn(i + 1, occupiedSlots)}>{i + 1}限</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {availableDates.map((dateSlot) => {
                const isSunday = dateSlot.dayOfWeek === 0
                const isSaturday = dateSlot.dayOfWeek === 6

                if (dateSlot.isClosed) {
                  return (
                    <tr key={dateSlot.dateKey} className={`sub-row-closed${isSunday ? ' sub-row-sun' : ''}${isSaturday ? ' sub-row-sat' : ''}`}>
                      <td className="sub-td-date">{dateSlot.label}</td>
                      <td className="sub-td-slot sub-slot-closed sub-slot-closed-merged" colSpan={maxSlot}>休校日</td>
                    </tr>
                  )
                }

                const allSelected = dateSlot.slots.every((s) => selectedSlots.has(`${dateSlot.dateKey}_${s}`))

                return (
                    <tr key={dateSlot.dateKey} className={`${allSelected ? 'sub-row-all' : ''}${isSunday ? ' sub-row-sun' : ''}${isSaturday ? ' sub-row-sat' : ''}`}>
                    <td
                      className="sub-td-date"
                      onClick={() => toggleAllSlotsForDate(dateSlot.dateKey, dateSlot.slots, occupiedSlots)}
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
                          onClick={() => toggleSlot(slotKey, occupied)}
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
            {data.availableSubjects.map((subject) => {
              const subjectCount = subjectSlots[subject] ?? 0
              const selectedDuration = subjectDurations[subject] === 60 ? 60 : subjectDurations[subject] === 45 ? 45 : 90
              return (
                <div key={subject} className="sub-subject-row">
                  <span className="sub-subject-label">{subject}</span>
                  <div className="sub-subject-ctrl">
                    <button
                      type="button"
                      className="sub-counter-btn"
                      onClick={() => handleSubjectChange(subject, subjectCount - 1)}
                      disabled={subjectCount <= 0}
                    >−</button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="999"
                      className="sub-counter-input"
                      value={subjectCount}
                      onChange={(e) => handleSubjectChange(subject, parseInt(e.target.value, 10) || 0)}
                    />
                    <button
                      type="button"
                      className="sub-counter-btn"
                      onClick={() => handleSubjectChange(subject, subjectCount + 1)}
                    >+</button>
                  </div>
                  {subjectCount > 0 && (
                    <div className="sub-duration-ctrl" role="group" aria-label={`${subject}の授業時間`}>
                      {[90, 60, 45].map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className={`sub-duration-btn${selectedDuration === minutes ? ' sub-duration-active' : ''}`}
                          onClick={() => handleDurationChange(subject, minutes)}
                        >{minutes}分</button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
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

      {isStudent && (data.availableGroupClassSubjects?.length ?? 0) > 0 && (
        <section className="sub-section">
          <div className="sub-section-head">
            <span className="sub-section-title">集団授業（中3）</span>
          </div>
          <p className="sub-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>参加する科目に<strong>チェック</strong>を入れてください（既定は不参加）。</p>
          <div className="sub-subject-list">
            {data.availableGroupClassSubjects!.map((subject) => {
              const participate = groupClassParticipation[subject] === true
              return (
                <label key={subject} className="sub-group-row">
                  <span className="sub-subject-label">{subject}</span>
                  <span className={`sub-group-state${participate ? ' is-on' : ''}`}>{participate ? '参加' : '不参加'}</span>
                  <input
                    type="checkbox"
                    className="sub-group-check"
                    checked={participate}
                    onChange={(e) => setGroupClassParticipation((current) => ({ ...current, [subject]: e.target.checked }))}
                  />
                </label>
              )
            })}
          </div>
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
        <p className="sub-muted" style={{ textAlign: 'center', marginTop: 6, fontSize: 11 }}>※ 提出後に変更が必要な場合は教室にお問い合わせください</p>
      </section>

      <style>{baseStyles}</style>
    </div>
  )
}

const baseStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { min-width: 0 !important; width: 100% !important; max-width: 100% !important; overflow-x: hidden !important; }
  html { font-size: 14px; -webkit-text-size-adjust: 100%; height: 100%; }
  body { margin: 0; font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif; color: #111; background: #f5f5f5; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; position: relative; }
  #root { height: auto !important; min-height: 100% !important; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .sub-container { min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom, 0); width: 100%; overflow: hidden; }
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
  .sub-table-wrap { overflow: hidden; width: 100%; }
  /* テーブルは画面幅いっぱいにフィット。文字は読みやすい大きさに。 */
  .sub-slot-table { border-collapse: collapse; width: 100%; table-layout: auto; font-size: 15px; }
  .sub-slot-table th, .sub-slot-table td { border: 1px solid #ccc; text-align: center; padding: 0; }
  .sub-th-date { padding: 6px 8px; background: #f0f0f0; font-weight: 700; font-size: 13px; white-space: nowrap; }
  .sub-th-slot { padding: 7px 10px; background: #f0f0f0; font-weight: 700; font-size: 15px; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .sub-td-date { padding: 7px 8px; font-weight: 700; font-size: 14px; cursor: pointer; user-select: none; white-space: nowrap; background: #fff; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .sub-td-slot { padding: 4px 6px; min-width: 46px; height: 46px; cursor: pointer; user-select: none; font-size: 16px; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .sub-slot-x { background: #fee5e5 !important; color: #c00; font-weight: 700; }
  .sub-x-mark { display: block; font-size: 18px; line-height: 1; }
  .sub-x-label { display: block; font-size: 11px; line-height: 1.05; margin-top: 2px; }
  .sub-slot-occ { background: #e8f0ff; color: #336; font-size: 13px; font-weight: 700; }
  .sub-row-all .sub-td-date { background: #fff0f0; }
  .sub-row-sun .sub-td-date { color: #d00; }
  .sub-row-sat .sub-td-date { color: #00c; }
  .sub-row-closed .sub-td-date { color: #999; cursor: default; }
  .sub-slot-closed { background: #f0f0f0 !important; cursor: default; }

  /* Subject */
  .sub-subject-list { display: flex; flex-direction: column; gap: 6px; padding: 0 4px; }
  .sub-subject-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; padding: 6px 2px; border-bottom: 1px solid #eee; }
  .sub-duration-ctrl { flex-basis: 100%; display: flex; gap: 6px; justify-content: flex-end; }
  .sub-duration-btn { min-width: 52px; height: 32px; border-radius: 6px; border: 1px solid #ccc; background: #f8f8f8; font-size: 13px; font-weight: 600; cursor: pointer; touch-action: manipulation; }
  .sub-duration-active { background: #111; color: #fff; border-color: #111; }
  .sub-subject-label { font-size: 15px; font-weight: 600; min-width: 36px; }
  .sub-subject-ctrl { display: flex; align-items: center; gap: 6px; }
  .sub-counter-btn { width: 36px; height: 36px; border-radius: 6px; border: 1px solid #ccc; background: #f8f8f8; font-size: 18px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; touch-action: manipulation; }
  .sub-counter-btn:disabled { opacity: .3; }
  .sub-counter-input { width: 48px; height: 36px; text-align: center; font-size: 16px; font-weight: 600; border: 1px solid #ccc; border-radius: 6px; -moz-appearance: textfield; }
  .sub-counter-input::-webkit-inner-spin-button, .sub-counter-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .sub-checkbox-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 0 4px; font-size: 14px; cursor: pointer; }
  .sub-checkbox { width: 18px; height: 18px; accent-color: #333; }
  /* 集団授業: 参加チェックボックス */
  .sub-group-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid #eee; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .sub-group-check { width: 28px; height: 28px; accent-color: #111; flex: none; }
  .sub-group-row .sub-subject-label { font-size: 16px; flex: 1; }
  .sub-group-state { font-size: 14px; font-weight: 700; color: #999; min-width: 48px; text-align: right; }
  .sub-group-state.is-on { color: #111; }

  /* Submit */
  .sub-submit-section { padding: 12px; }
  .sub-summary { display: flex; gap: 12px; flex-wrap: wrap; background: #f8f8f8; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
  .sub-submit-btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; background: #111; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
  .sub-disabled { opacity: .5; cursor: not-allowed; }

  /* 休校日: 1〜5限を結合したグレーセル */
  .sub-slot-closed-merged { background: #ebebeb !important; color: #888; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-align: center; }

  /* 提出済み(閲覧専用)バナー */
  .sub-submitted-banner { display: flex; align-items: center; gap: 12px; background: #e8f5e8; border-bottom: 1px solid #cfe6cf; padding: 14px 14px; }
  .sub-submitted-check { flex: none; width: 40px; height: 40px; line-height: 40px; text-align: center; border-radius: 50%; background: #2a7e2a; color: #fff; font-size: 22px; font-weight: 700; }
  .sub-submitted-text { min-width: 0; }
  .sub-submitted-title { font-size: 16px; font-weight: 700; color: #1f5d1f; }
  .sub-submitted-sub { font-size: 12px; color: #3a6b3a; margin-top: 2px; line-height: 1.4; }

  /* 閲覧専用テーブル(操作不可) */
  .sub-slot-table-readonly .sub-th-slot,
  .sub-slot-table-readonly .sub-td-slot,
  .sub-slot-table-readonly .sub-td-date { cursor: default; }

  /* 希望科目数(閲覧専用) */
  .sub-subject-row-readonly { justify-content: space-between; }
  .sub-subject-readonly-value { font-size: 15px; font-weight: 700; color: #222; }
  .sub-readonly-minutes { font-size: 12px; font-weight: 600; color: #777; margin-left: 6px; }

  @media (max-width: 360px) {
    .sub-th-date, .sub-td-date { font-size: 12px; padding: 6px 5px; }
    .sub-th-slot { font-size: 13px; padding: 6px 6px; }
    .sub-td-slot { height: 42px; min-width: 40px; font-size: 14px; }
    .sub-x-mark { font-size: 16px; }
    .sub-x-label { font-size: 10px; }
    .sub-slot-occ { font-size: 11px; }
    .sub-section { padding: 6px; }
  }
`
