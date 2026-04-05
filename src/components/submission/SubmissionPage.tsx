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
}

type DateSlot = {
  dateKey: string
  label: string
  dayOfWeek: number
  slots: number[]
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const SLOT_LABELS = ['1限', '2限', '3限', '4限', '5限', '6限', '7限']

function getSubmissionApiBaseUrl() {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  // In production (Firebase Hosting), use the rewrite path
  if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
    return `${origin}/api/submission`
  }
  // In dev, call the Cloud Function directly
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
        slots: Array.from({ length: slotCount }, (_, i) => i + 1),
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
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

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

  const toggleSlot = useCallback((slotKey: string) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev)
      if (next.has(slotKey)) {
        next.delete(slotKey)
      } else {
        next.add(slotKey)
      }
      return next
    })
  }, [])

  const toggleAllSlotsForDate = useCallback((dateKey: string, slots: number[]) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev)
      const dateSlotKeys = slots.map((s) => `${dateKey}_${s}`)
      const allSelected = dateSlotKeys.every((k) => next.has(k))
      if (allSelected) {
        dateSlotKeys.forEach((k) => next.delete(k))
      } else {
        dateSlotKeys.forEach((k) => next.add(k))
      }
      return next
    })
  }, [])

  const handleSubjectChange = useCallback((subject: string, value: number) => {
    setSubjectSlots((prev) => ({ ...prev, [subject]: Math.max(0, value) }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted) return
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
      <div style={styles.container}>
        <div style={styles.loadingBox}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBox}>
          <p style={styles.errorIcon}>⚠</p>
          <p style={styles.errorText}>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <p style={styles.successIcon}>✓</p>
          <h2 style={styles.successTitle}>提出完了</h2>
          <p style={styles.successText}>
            {data.personName}さんの{data.sessionLabel}の希望を受け付けました。
          </p>
          <p style={styles.successNote}>このページを閉じてください。</p>
        </div>
      </div>
    )
  }

  const isStudent = data.personType === 'student'
  const totalUnavailable = selectedSlots.size
  const totalSubjectCount = Object.values(subjectSlots).reduce((sum, v) => sum + v, 0)

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>{data.sessionLabel}</h1>
        <p style={styles.headerSub}>{data.personName}</p>
        <p style={styles.headerPeriod}>
          {data.sessionStartDate.replace(/-/g, '/')} 〜 {data.sessionEndDate.replace(/-/g, '/')}
        </p>
      </header>

      {error && (
        <div style={styles.inlineError}>
          <p>{error}</p>
          <button type="button" onClick={() => setError('')} style={styles.dismissButton}>✕</button>
        </div>
      )}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>出席不可コマ</h2>
        <p style={styles.sectionDesc}>
          出席できないコマをタップしてください（選択中: {totalUnavailable}コマ）
        </p>
        <div style={styles.dateList}>
          {availableDates.map((dateSlot) => {
            const isExpanded = expandedDate === dateSlot.dateKey
            const dateUnavailableCount = dateSlot.slots.filter((s) => selectedSlots.has(`${dateSlot.dateKey}_${s}`)).length
            const isSunday = dateSlot.dayOfWeek === 0
            const isSaturday = dateSlot.dayOfWeek === 6

            return (
              <div key={dateSlot.dateKey} style={styles.dateGroup}>
                <button
                  type="button"
                  onClick={() => setExpandedDate(isExpanded ? null : dateSlot.dateKey)}
                  style={{
                    ...styles.dateHeader,
                    color: isSunday ? '#d00000' : isSaturday ? '#003cff' : '#111',
                  }}
                >
                  <span style={styles.dateLabel}>{dateSlot.label}</span>
                  {dateUnavailableCount > 0 && (
                    <span style={styles.dateBadge}>{dateUnavailableCount}コマ不可</span>
                  )}
                  <span style={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <div style={styles.slotList}>
                    <button
                      type="button"
                      onClick={() => toggleAllSlotsForDate(dateSlot.dateKey, dateSlot.slots)}
                      style={styles.selectAllButton}
                    >
                      {dateSlot.slots.every((s) => selectedSlots.has(`${dateSlot.dateKey}_${s}`))
                        ? '全解除'
                        : '全選択（終日不可）'}
                    </button>
                    {dateSlot.slots.map((slot) => {
                      const slotKey = `${dateSlot.dateKey}_${slot}`
                      const isSelected = selectedSlots.has(slotKey)
                      return (
                        <button
                          key={slotKey}
                          type="button"
                          onClick={() => toggleSlot(slotKey)}
                          style={{
                            ...styles.slotButton,
                            ...(isSelected ? styles.slotButtonSelected : {}),
                          }}
                        >
                          <span style={styles.slotLabel}>{SLOT_LABELS[slot - 1] ?? `${slot}限`}</span>
                          <span style={styles.slotStatus}>{isSelected ? '不可' : '可'}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {isStudent && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>希望科目数</h2>
          <p style={styles.sectionDesc}>
            受講を希望する科目ごとのコマ数を入力してください（合計: {totalSubjectCount}コマ）
          </p>
          <div style={styles.subjectList}>
            {data.availableSubjects.map((subject) => (
              <div key={subject} style={styles.subjectRow}>
                <label style={styles.subjectLabel}>{subject}</label>
                <div style={styles.subjectControls}>
                  <button
                    type="button"
                    onClick={() => handleSubjectChange(subject, (subjectSlots[subject] ?? 0) - 1)}
                    style={styles.counterButton}
                    disabled={(subjectSlots[subject] ?? 0) <= 0}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="999"
                    value={subjectSlots[subject] ?? 0}
                    onChange={(e) => handleSubjectChange(subject, parseInt(e.target.value, 10) || 0)}
                    style={styles.counterInput}
                  />
                  <button
                    type="button"
                    onClick={() => handleSubjectChange(subject, (subjectSlots[subject] ?? 0) + 1)}
                    style={styles.counterButton}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={regularOnly}
              onChange={(e) => setRegularOnly(e.target.checked)}
              style={styles.checkbox}
            />
            <span>通常授業のみ（講習なし）</span>
          </label>
        </section>
      )}

      <section style={styles.submitSection}>
        <div style={styles.summaryBox}>
          <p>出席不可: <strong>{totalUnavailable}</strong>コマ</p>
          {isStudent && <p>希望科目合計: <strong>{totalSubjectCount}</strong>コマ</p>}
          {isStudent && regularOnly && <p style={styles.regularOnlyLabel}>※ 通常授業のみ</p>}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            ...styles.submitButton,
            ...(submitting ? styles.submitButtonDisabled : {}),
          }}
        >
          {submitting ? '送信中...' : '提出する'}
        </button>
        <p style={styles.submitNote}>※ 提出後の変更はできません</p>
      </section>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100dvh',
    background: '#f5f5f5',
    fontFamily: "'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif",
    color: '#111',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
  // Loading
  loadingBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60dvh',
    gap: 16,
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #ddd',
    borderTopColor: '#333',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: { fontSize: 14, color: '#666' },
  // Error
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60dvh',
    padding: 24,
    textAlign: 'center',
  },
  errorIcon: { fontSize: 48, marginBottom: 8 },
  errorText: { fontSize: 16, color: '#333' },
  inlineError: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: '#fee',
    color: '#c00',
    fontSize: 14,
  },
  dismissButton: {
    background: 'none',
    border: 'none',
    color: '#c00',
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
  },
  // Success
  successBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60dvh',
    padding: 24,
    textAlign: 'center',
  },
  successIcon: {
    fontSize: 56,
    color: '#2a7e2a',
    background: '#e8f5e8',
    borderRadius: '50%',
    width: 80,
    height: 80,
    lineHeight: '80px',
    textAlign: 'center',
    marginBottom: 16,
  },
  successTitle: { fontSize: 22, fontWeight: 700, marginBottom: 8 },
  successText: { fontSize: 15, color: '#333', marginBottom: 8 },
  successNote: { fontSize: 13, color: '#666' },
  // Header
  header: {
    background: '#fff',
    borderBottom: '1px solid #ddd',
    padding: '20px 16px',
    textAlign: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: 700, margin: '0 0 4px' },
  headerSub: { fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#333' },
  headerPeriod: { fontSize: 13, color: '#666', margin: 0 },
  // Section
  section: {
    margin: '12px 0',
    background: '#fff',
    borderTop: '1px solid #ddd',
    borderBottom: '1px solid #ddd',
    padding: '16px',
  },
  sectionTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 4px' },
  sectionDesc: { fontSize: 13, color: '#666', margin: '0 0 12px' },
  // Date list
  dateList: { display: 'flex', flexDirection: 'column', gap: 2 },
  dateGroup: {
    borderBottom: '1px solid #eee',
  },
  dateHeader: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '12px 4px',
    background: 'none',
    border: 'none',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
    gap: 8,
  },
  dateLabel: { flex: 1 },
  dateBadge: {
    fontSize: 12,
    color: '#c00',
    fontWeight: 700,
    background: '#fee',
    padding: '2px 8px',
    borderRadius: 4,
  },
  chevron: { fontSize: 11, color: '#999' },
  // Slot list
  slotList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '0 4px 12px',
  },
  selectAllButton: {
    display: 'block',
    width: '100%',
    padding: '8px',
    border: '1px solid #ccc',
    borderRadius: 6,
    background: '#fafafa',
    fontSize: 13,
    fontWeight: 600,
    color: '#555',
    cursor: 'pointer',
    marginBottom: 4,
  },
  slotButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '12px 16px',
    border: '1px solid #ddd',
    borderRadius: 8,
    background: '#fff',
    fontSize: 15,
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  },
  slotButtonSelected: {
    background: '#fee5e5',
    borderColor: '#e88',
    color: '#c00',
  },
  slotLabel: { fontWeight: 600 },
  slotStatus: { fontSize: 13 },
  // Subject list
  subjectList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  subjectRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 4px',
    borderBottom: '1px solid #eee',
  },
  subjectLabel: {
    fontSize: 16,
    fontWeight: 600,
    minWidth: 40,
  },
  subjectControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  counterButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    border: '1px solid #ccc',
    background: '#f8f8f8',
    fontSize: 20,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterInput: {
    width: 56,
    height: 40,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 600,
    border: '1px solid #ccc',
    borderRadius: 6,
    MozAppearance: 'textfield',
  },
  // Checkbox
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    fontSize: 15,
    cursor: 'pointer',
  },
  checkbox: { width: 20, height: 20, accentColor: '#333' },
  // Submit
  submitSection: {
    padding: '16px',
    background: '#fff',
    borderTop: '1px solid #ddd',
    margin: '12px 0 0',
  },
  summaryBox: {
    background: '#f8f8f8',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 16,
    fontSize: 14,
  },
  regularOnlyLabel: { color: '#888', fontSize: 13 },
  submitButton: {
    display: 'block',
    width: '100%',
    padding: '16px',
    border: 'none',
    borderRadius: 10,
    background: '#111',
    color: '#fff',
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
  },
  submitButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  submitNote: {
    textAlign: 'center',
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
}
