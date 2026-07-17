import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { IOS_VIEWPORT_WIDTH, IOS_ZOOM, ANDROID_VIEWPORT_WIDTH, ANDROID_ZOOM, isIOS as detectIOS, isAndroid as detectAndroid, buildSubmissionViewportContent } from './iosViewport'

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
  // 「後から出席可能に変更」されたコマ(2026-07-18)。unavailableSlots との交差を黄色表示する。
  // 登録解除では維持・新規提出でサーバーが空にリセットする(配布情報)。後方互換のため optional。
  reopenedSlots?: string[]
  subjectSlots: Record<string, number>
  subjectDurations: Record<string, number>
  // spec-group-lesson §C: 集団授業(中3のみ)。availableGroupClassSubjects が非空なら参加/不参加欄を表示。
  availableGroupClassSubjects?: string[]
  groupClassParticipation?: Record<string, boolean>
  // 生徒日程表のオプション欄(開発用教室)。optionLabels=学年共通のオプション文言(行0..4。空文字は表示しない)。
  // optionChecks=提出されたチェック状態(キー=行番号'0'..'4' -> true)。未設定=未チェック(既定)。後方互換のため optional。
  optionLabels?: string[]
  optionChecks?: Record<string, boolean>
  regularOnly: boolean
  occupiedSlots: Record<string, string>
  // spec-group-lesson §E: 中3の集団授業コマ。key=`${dateKey}_${band}`(band=1|2)、value=科目('集団理科'|'集団社会')。
  groupClassSlots?: Record<string, string>
}

export type DateSlot = {
  dateKey: string
  label: string
  dayOfWeek: number
  slots: number[]
  isClosed: boolean
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

// iOS 表示倍率の補正値・判定は ./iosViewport に集約(main.tsx の初回ペイント前適用と共有)。

// 実機デバッグ用のダミーデータ(#/submit-debug)。実際のレイアウトを一通り確認できるよう、
// 通常コマ/休校日/既存予定/科目/集団授業(中3)を含めてある。
const DEBUG_DUMMY_DATA: SubmissionData = {
  personName: '山田 太郎',
  personType: 'student',
  sessionLabel: '春期講習 出欠・希望調査',
  sessionStartDate: '2026-03-25',
  sessionEndDate: '2026-04-05',
  closedWeekdays: [0],
  holidayDates: ['2026-03-30'],
  forceOpenDates: [],
  availableSubjects: ['英語', '数学', '国語', '理科', '社会'],
  slotCount: 5,
  slotNumbers: [1, 2, 3, 4, 5],
  status: 'pending',
  unavailableSlots: [],
  reopenedSlots: [],
  subjectSlots: { 英語: 2, 数学: 3 },
  subjectDurations: { 数学: 60 },
  availableGroupClassSubjects: ['集団理科', '集団社会'],
  groupClassParticipation: { 集団理科: true },
  optionLabels: ['英検対策希望', '定期テスト前補習', '夏期講習案内', '', ''],
  optionChecks: { '0': true },
  regularOnly: false,
  occupiedSlots: { '2026-03-26_3': '英', '2026-03-27_1': '数', '2026-04-01_2': '国' },
  groupClassSlots: { '2026-03-28_1': '集団理科', '2026-04-04_2': '集団社会' },
}

// spec-group-lesson §E: 集団授業の2バンド(1=10:00-11:00 / 2=11:10-12:10)。提出ページでは1限の左に2列出す。
const GROUP_CLASS_BANDS = [1, 2] as const

// 生徒日程表と同じ短縮表記。集団理科→集理 / 集団社会→集社。
function groupClassShortLabel(subject: string): string {
  if (subject === '集団理科') return '集理'
  if (subject === '集団社会') return '集社'
  return subject
}

// オプション欄(開発用教室): 行番号を保持したまま、文言が入っている行のみ提出ページに出す。
function buildOptionItems(optionLabels: string[] | undefined): Array<{ index: number; label: string }> {
  return (optionLabels ?? [])
    .map((label, index) => ({ index, label: String(label ?? '').trim() }))
    .filter((item) => item.label !== '')
}

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

export default function SubmissionPage({ token, debug = false }: { token: string; debug?: boolean }) {
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
  // オプション欄(開発用教室): チェック状態。キー=行番号('0'..'4') -> true。未設定=未チェック(既定)。
  const [optionChecks, setOptionChecks] = useState<Record<string, boolean>>({})
  const [regularOnly, setRegularOnly] = useState(false)

  const selectedSlotsRef = useRef<Set<string>>(new Set())
  selectedSlotsRef.current = selectedSlots

  const apiBase = useMemo(() => getSubmissionApiBaseUrl(), [])

  const isIOS = useMemo(() => detectIOS(), [])
  const isAndroid = useMemo(() => detectAndroid(), [])
  // 検出プラットフォームの確定補正値(本番で実際に使う値)。iOS / Android / その他(無補正)。
  const platformViewportWidth = isIOS ? IOS_VIEWPORT_WIDTH : isAndroid ? ANDROID_VIEWPORT_WIDTH : null
  const platformZoom = isIOS ? IOS_ZOOM : isAndroid ? ANDROID_ZOOM : 1

  // デバッグ時はパネルでライブ調整する初期値(検出プラットフォームの確定値から開始)。
  const [debugViewportWidth, setDebugViewportWidth] = useState<number | null>(platformViewportWidth)
  const [debugZoom, setDebugZoom] = useState<number>(platformZoom)

  // 実際に適用する補正値: デバッグ時はパネル値、本番は検出プラットフォームの確定値。
  const viewportWidthOverride = debug ? debugViewportWidth : platformViewportWidth
  const zoomOverride = debug ? debugZoom : platformZoom
  const containerStyle = zoomOverride !== 1 ? ({ zoom: zoomOverride } as CSSProperties) : undefined
  // Android のみ: コンテナ全体を zoom 0.7 で縮めつつ、出席不可コマの表だけは逆ズーム(1/zoom)で
  // 打ち消して現状の全幅に戻す(オーナー要望: 表は現状の幅・それ以外は 520+0.7)。
  // iOS は表も 0.7 のまま(従来どおり)なので逆ズームしない。
  const tableWrapStyle = (isAndroid && zoomOverride !== 1)
    ? ({ zoom: 1 / zoomOverride } as CSSProperties)
    : undefined

  // Lock viewport scale for mobile.
  // 本番(iOS)の初回幅は main.tsx が初回ペイント前に同期適用済み。この effect は
  // デバッグ画面でのライブ調整と、念のための再適用を担う。
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]')
    if (!meta) return
    meta.setAttribute('content', buildSubmissionViewportContent(viewportWidthOverride))
  }, [viewportWidthOverride])

  // 提出完了/既提出の閲覧画面へ切り替わったら画面先頭へ戻す。
  // このページは body がスクロール領域(overflow-y:auto)なので window だけでなく
  // body/documentElement も明示的に 0 にし、描画確定後(rAF)にも再度トップへ寄せる。
  useEffect(() => {
    if (!submitted) return
    const toTop = () => {
      window.scrollTo(0, 0)
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }
    toTop()
    const raf = requestAnimationFrame(toTop)
    return () => cancelAnimationFrame(raf)
  }, [submitted])

  useEffect(() => {
    // デバッグ画面(#/submit-debug)はネットワークを使わずダミーデータで描画する。
    if (debug) {
      const dummy = DEBUG_DUMMY_DATA
      setData(dummy)
      setSelectedSlots(new Set(dummy.unavailableSlots ?? []))
      setSubjectSlots(dummy.subjectSlots ?? {})
      setSubjectDurations(dummy.subjectDurations ?? {})
      setGroupClassParticipation(dummy.groupClassParticipation ?? {})
      setOptionChecks(dummy.optionChecks ?? {})
      setRegularOnly(dummy.regularOnly ?? false)
      setLoading(false)
      return
    }
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
        setOptionChecks(result.optionChecks ?? {})
        setRegularOnly(result.regularOnly ?? false)
      } catch {
        setError('通信エラーが発生しました。インターネット接続を確認してください。')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [apiBase, token, debug])

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
          optionChecks,
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
  }, [apiBase, token, selectedSlots, subjectSlots, subjectDurations, groupClassParticipation, optionChecks, regularOnly, submitting, submitted])

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

  // 実機デバッグ用パネル(#/submit-debug のときだけ表示)。
  // 拡縮中の補正値を画面外(zoom 非適用)に固定表示し、値をコピーできるようにする。
  // ここで求めた値を上部の IOS_VIEWPORT_WIDTH / IOS_ZOOM に反映すると本番 iOS に適用される。
  // 検出プラットフォームに応じて、調整値をどの定数へ反映すべきかを示す(iosViewport.ts)。
  const debugPlatform = isIOS ? 'iOS' : isAndroid ? 'Android' : 'その他'
  const widthConstName = isAndroid ? 'ANDROID_VIEWPORT_WIDTH' : 'IOS_VIEWPORT_WIDTH'
  const zoomConstName = isAndroid ? 'ANDROID_ZOOM' : 'IOS_ZOOM'
  const readout = `${widthConstName} = ${debugViewportWidth === null ? 'null' : Math.round(debugViewportWidth)} / ${zoomConstName} = ${debugZoom.toFixed(2)}`
  const debugPanel = debug ? (
    <div className="sub-dbg">
      <div className="sub-dbg-head">表示調整（デバッグ・{debugPlatform}）</div>
      <div className="sub-dbg-readout">{readout}</div>
      <div className="sub-dbg-info">
        innerWidth={typeof window !== 'undefined' ? window.innerWidth : '-'} / dpr={typeof window !== 'undefined' ? window.devicePixelRatio : '-'} / screen={typeof window !== 'undefined' ? window.screen?.width : '-'}
      </div>

      <div className="sub-dbg-row">
        <span className="sub-dbg-label">幅(width)</span>
        <input
          type="range" min={300} max={520} step={1}
          value={debugViewportWidth ?? 393}
          onChange={(e) => setDebugViewportWidth(parseInt(e.target.value, 10))}
        />
        <span className="sub-dbg-val">{debugViewportWidth === null ? '無補正' : Math.round(debugViewportWidth)}</span>
      </div>
      <div className="sub-dbg-presets">
        <button type="button" onClick={() => setDebugViewportWidth(null)}>無補正</button>
        <button type="button" onClick={() => setDebugViewportWidth(360)}>360</button>
        <button type="button" onClick={() => setDebugViewportWidth(393)}>393</button>
        <button type="button" onClick={() => setDebugViewportWidth(412)}>412</button>
      </div>

      <div className="sub-dbg-row">
        <span className="sub-dbg-label">zoom</span>
        <input
          type="range" min={0.7} max={1.3} step={0.01}
          value={debugZoom}
          onChange={(e) => setDebugZoom(parseFloat(e.target.value))}
        />
        <span className="sub-dbg-val">{debugZoom.toFixed(2)}</span>
      </div>
      <div className="sub-dbg-presets">
        <button type="button" onClick={() => setDebugZoom(1)}>zoom=1</button>
        <button
          type="button"
          onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(readout).catch(() => {}) }}
        >値をコピー</button>
      </div>
    </div>
  ) : null

  // spec-group-lesson §E: 1限の左に集団授業(集理/集社)の2列を出す。中3かつ盤面に集団コマがある場合のみ。
  // 出欠選択の対象ではなく、生徒日程表と同じく盤面の集団コマを案内表示する読み取り専用列。
  const groupClassSlots = data.groupClassSlots ?? {}
  const showGroupCols = data.personType === 'student'
    && (data.availableGroupClassSubjects?.length ?? 0) > 0
    && Object.keys(groupClassSlots).length > 0
  const groupColCount = showGroupCols ? GROUP_CLASS_BANDS.length : 0
  const renderGroupHeaderCells = () => showGroupCols
    ? GROUP_CLASS_BANDS.map((band) => <th key={`gh${band}`} className="sub-th-slot sub-th-group">集</th>)
    : null
  const renderGroupBodyCells = (dateKey: string) => showGroupCols
    ? GROUP_CLASS_BANDS.map((band) => {
        const subject = groupClassSlots[`${dateKey}_${band}`]
        return (
          <td key={`gb${band}`} className={`sub-td-slot sub-td-group${subject ? ' sub-slot-group-on' : ''}`}>
            {subject ? groupClassShortLabel(subject) : ''}
          </td>
        )
      })
    : null

  // 提出後／既提出リンク: 提出した内容を「閲覧専用(編集不可)」で表示する。
  if (submitted) {
    const isStudentView = data.personType === 'student'
    const viewOccupiedSlots = data.occupiedSlots ?? {}
    // 「後から出席可能に変更」(2026-07-18): 提出済みの不可コマ(✕)のうち教室が出席可能へ変更したコマは黄色表示。
    const viewReopenedSlots = new Set((data.reopenedSlots ?? []).filter((slotKey) => selectedSlots.has(slotKey)))
    const viewMaxSlot = availableDates.length > 0 ? Math.max(...availableDates.map((d) => d.slots.length)) : 5
    const viewUnavailableCount = selectedSlots.size
    const viewSubjectTotal = Object.values(subjectSlots).reduce((sum, v) => sum + v, 0)
    const submittedSubjects = data.availableSubjects.filter((subject) => (subjectSlots[subject] ?? 0) > 0)
    const viewOptionItems = buildOptionItems(data.optionLabels)
    return (
      <>
      <div className="sub-container" style={containerStyle}>
        <header className="sub-header">
          <div className="sub-header-title">{data.sessionLabel}</div>
          <div className="sub-header-name">{data.personName}</div>
          <div className="sub-muted" style={{ fontSize: 22 }}>
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

        <section className="sub-section sub-section-lg">
          <div className="sub-section-head">
            <span className="sub-section-title">出席不可コマ</span>
            <span className="sub-muted">不可: <strong>{viewUnavailableCount}</strong>コマ</span>
          </div>
          <div className="sub-table-wrap" style={tableWrapStyle}>
            <table className="sub-slot-table sub-slot-table-readonly" style={{ ['--slot-n' as string]: viewMaxSlot + groupColCount } as CSSProperties}>
              <thead>
                <tr>
                  <th className="sub-th-date">日付</th>
                  {renderGroupHeaderCells()}
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
                        <td className="sub-td-slot sub-slot-closed sub-slot-closed-merged" colSpan={viewMaxSlot + groupColCount}>休校日</td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={dateSlot.dateKey} className={`${isSunday ? ' sub-row-sun' : ''}${isSaturday ? ' sub-row-sat' : ''}`}>
                      <td className="sub-td-date">{dateSlot.label}</td>
                      {renderGroupBodyCells(dateSlot.dateKey)}
                      {dateSlot.slots.map((slot) => {
                        const slotKey = `${dateSlot.dateKey}_${slot}`
                        const isSelected = selectedSlots.has(slotKey)
                        const isReopened = isSelected && viewReopenedSlots.has(slotKey)
                        const occupied = viewOccupiedSlots[slotKey]
                        if (isReopened) {
                          // 黄色=教室で出席可能に変更されたコマ。✕は出さず、組まれた授業(occupied)があれば表示する。
                          return (
                            <td key={slot} className="sub-td-slot sub-slot-reopened" data-testid={`sub-slot-reopened-${slotKey}`}>
                              {occupied || ''}
                            </td>
                          )
                        }
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
          {viewReopenedSlots.size > 0 && (
            <div className="sub-reopened-note" data-testid="sub-reopened-note">
              <span className="sub-reopened-swatch" />黄色のコマは、提出後に教室で「出席可能」に変更されたコマです
            </div>
          )}
        </section>

        {isStudentView && (
          <section className="sub-section sub-section-lg">
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

        {isStudentView && (data.availableGroupClassSubjects?.length ?? 0) > 0 && (
          <section className="sub-section sub-section-lg">
            <div className="sub-section-head">
              <span className="sub-section-title">集団授業（中3）</span>
            </div>
            <div className="sub-subject-list">
              {data.availableGroupClassSubjects!.map((subject) => {
                const participate = groupClassParticipation[subject] === true
                return (
                  <div key={subject} className="sub-group-row">
                    <span className="sub-subject-label">{subject}</span>
                    <span className={`sub-group-state${participate ? ' is-on' : ''}`}>{participate ? '参加' : '不参加'}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {isStudentView && viewOptionItems.length > 0 && (
          <section className="sub-section sub-section-lg">
            <div className="sub-section-head">
              <span className="sub-section-title">オプション</span>
            </div>
            <div className="sub-subject-list">
              {viewOptionItems.map((item) => {
                const checked = optionChecks[String(item.index)] === true
                return (
                  <div key={item.index} className="sub-group-row">
                    <span className="sub-subject-label">{item.label}</span>
                    <span className={`sub-group-state${checked ? ' is-on' : ''}`}>{checked ? 'あり' : 'なし'}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section className="sub-section sub-submit-section">
          <p className="sub-muted" style={{ textAlign: 'center', fontSize: 12 }}>変更が必要な場合は教室にお問い合わせください。</p>
        </section>

        <style>{baseStyles}</style>
      </div>
      {debugPanel}
      </>
    )
  }

  const isStudent = data.personType === 'student'
  const optionItems = buildOptionItems(data.optionLabels)
  const totalUnavailable = selectedSlots.size
  const totalSubjectCount = Object.values(subjectSlots).reduce((sum, v) => sum + v, 0)
  const occupiedSlots = data.occupiedSlots ?? {}
  const maxSlot = availableDates.length > 0 ? Math.max(...availableDates.map((d) => d.slots.length)) : 5
  // 集団希望ラベル: 参加(true)の集団科目を短縮表示(「集団理科」→「理」)。中3など対象生徒のみ表示。
  const hasGroupClass = (data.availableGroupClassSubjects?.length ?? 0) > 0
  const groupWishLabel = hasGroupClass
    ? ((data.availableGroupClassSubjects ?? []).filter((s) => groupClassParticipation[s] === true)
        .map((s) => s.replace(/^集団/, '').charAt(0)).join('、') || 'なし')
    : ''

  return (
    <>
    <div className="sub-container" style={containerStyle}>
      <header className="sub-header">
        <div className="sub-header-title">{data.sessionLabel}</div>
        <div className="sub-header-name">{data.personName}</div>
        <div className="sub-muted" style={{ fontSize: 22 }}>
          {data.sessionStartDate.replace(/-/g, '/')} 〜 {data.sessionEndDate.replace(/-/g, '/')}
        </div>
      </header>

      {error && (
        <div className="sub-inline-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="sub-dismiss">✕</button>
        </div>
      )}

      <section className="sub-section sub-section-lg">
        <div className="sub-section-head">
          <span className="sub-section-title">出席不可コマ</span>
          <span className="sub-muted">不可: <strong>{totalUnavailable}</strong>コマ</span>
        </div>
        <p className="sub-muted" style={{ margin: '0 0 8px', fontSize: 26, lineHeight: 1.45 }}>
          出席できないコマをタップしてください。日付をタップすると終日不可になります。
        </p>

        <div className="sub-table-wrap" style={tableWrapStyle}>
          <table className="sub-slot-table" style={{ ['--slot-n' as string]: maxSlot + groupColCount } as CSSProperties}>
            <thead>
              <tr>
                <th className="sub-th-date">日付</th>
                {renderGroupHeaderCells()}
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
                      <td className="sub-td-slot sub-slot-closed sub-slot-closed-merged" colSpan={maxSlot + groupColCount}>休校日</td>
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
                    {renderGroupBodyCells(dateSlot.dateKey)}
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
        <section className="sub-section sub-section-lg">
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
                  <div className="sub-duration-slot">
                    {subjectCount > 0 && (
                      <select
                        className="sub-duration-select"
                        aria-label={`${subject}の授業時間`}
                        value={selectedDuration}
                        onChange={(e) => handleDurationChange(subject, parseInt(e.target.value, 10))}
                      >
                        <option value={90}>90分</option>
                        <option value={60}>60分</option>
                        <option value={45}>45分</option>
                      </select>
                    )}
                  </div>
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
        <section className="sub-section sub-section-lg">
          <div className="sub-section-head">
            <span className="sub-section-title">集団授業（中3）</span>
          </div>
          <p className="sub-muted" style={{ margin: '0 0 8px', fontSize: 28 }}>参加する科目に<strong>チェック</strong>を入れてください（未チェックは不参加）。</p>
          <div className="sub-subject-list">
            {data.availableGroupClassSubjects!.map((subject) => {
              const participate = groupClassParticipation[subject] === true
              return (
                <label key={subject} className="sub-group-row">
                  <span className="sub-subject-label">{subject}</span>
                  <input
                    type="checkbox"
                    className="sub-group-check"
                    checked={participate}
                    onChange={(e) => setGroupClassParticipation((current) => ({ ...current, [subject]: e.target.checked }))}
                  />
                  <span className={`sub-group-state${participate ? ' is-on' : ''}`}>{participate ? '参加' : '不参加'}</span>
                </label>
              )
            })}
          </div>
        </section>
      )}

      {isStudent && optionItems.length > 0 && (
        <section className="sub-section sub-section-lg">
          <div className="sub-section-head">
            <span className="sub-section-title">オプション</span>
          </div>
          <p className="sub-muted" style={{ margin: '0 0 8px', fontSize: 28 }}>希望する項目に<strong>チェック</strong>を入れてください（未チェックはなし）。</p>
          <div className="sub-subject-list">
            {optionItems.map((item) => {
              const checked = optionChecks[String(item.index)] === true
              return (
                <label key={item.index} className="sub-group-row">
                  <span className="sub-subject-label">{item.label}</span>
                  <input
                    type="checkbox"
                    className="sub-group-check"
                    checked={checked}
                    onChange={(e) => setOptionChecks((current) => ({ ...current, [String(item.index)]: e.target.checked }))}
                  />
                </label>
              )
            })}
          </div>
        </section>
      )}

      <section className="sub-section sub-submit-section">
        <button
          type="button"
          className={`sub-submit-btn${submitting ? ' sub-disabled' : ''}`}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? '送信中...' : '提出する'}
        </button>
        <div className="sub-summary">
          <span>参加不可コマ: <strong>{totalUnavailable}</strong>コマ</span>
          {isStudent && <span>希望科目計: <strong>{totalSubjectCount}</strong>コマ</span>}
          {isStudent && hasGroupClass && <span>集団希望: <strong>{groupWishLabel}</strong></span>}
          {isStudent && regularOnly && <span style={{ color: '#888' }}>通常のみ</span>}
        </div>
        <p className="sub-muted" style={{ textAlign: 'center', marginTop: 6, fontSize: 13 }}>※ 提出後に変更が必要な場合は教室にお問い合わせください</p>
      </section>

      <style>{baseStyles}</style>
    </div>
    {debugPanel}
    </>
  )
}

const baseStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { min-width: 0 !important; width: 100% !important; max-width: 100% !important; overflow-x: hidden !important; }
  /* 共通の index.css は PC アプリ向けに html/body/#root へ min-width:1280px と #root{padding:20px} を当てている。
     提出ページ(スマホ)では幅と余白を打ち消さないと、iOS の狭い表示幅で内容が右にはみ出して
     折り返し＝「拡大されたように」見える。padding も明示的に 0 に上書きする。 */
  html { font-size: 14px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; height: 100%; }
  body { margin: 0; font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif; color: #111; background: #f5f5f5; height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; position: relative; }
  #root { height: auto !important; min-height: 100% !important; padding: 0 !important; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .sub-container { min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom, 0); width: 100%; overflow: hidden; }
  .sub-center-box { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60dvh; padding: 24px; text-align: center; }
  .sub-spinner { width: 36px; height: 36px; border: 3px solid #ddd; border-top-color: #333; border-radius: 50%; animation: spin .8s linear infinite; margin-bottom: 12px; }
  .sub-muted { font-size: 15px; color: #666; }
  .sub-success-icon { font-size: 48px; color: #2a7e2a; background: #e8f5e8; border-radius: 50%; width: 72px; height: 72px; line-height: 72px; text-align: center; margin-bottom: 12px; }

  .sub-header { background: #fff; border-bottom: 1px solid #ddd; padding: 20px 12px; text-align: center; }
  /* 幅の狭い端末(iPhone 等)でも 1 行に収まるよう、px の上限を保ったまま vw で頭打ちにする。
     基準幅 ~420px 以上は従来の px のまま(Android の表示を変えない)、それより狭い端末だけ縮む。 */
  .sub-header-title { font-size: min(42px, 10vw); font-weight: 700; margin-bottom: 8px; line-height: 1.2; }
  .sub-header-name { font-size: min(34px, 8vw); font-weight: 600; color: #333; margin-bottom: 8px; }

  .sub-inline-error { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #fee; color: #c00; font-size: 13px; }
  .sub-dismiss { background: none; border: none; color: #c00; font-size: 16px; cursor: pointer; padding: 0 4px; }

  .sub-section { background: #fff; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 8px; margin: 8px 0; }
  .sub-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; padding: 0 4px; }
  .sub-section-title { font-size: 21px; font-weight: 700; }

  /* Slot table — 日付列:コマ列=2.375:1 / 正方形マス という現状のレイアウト比を保ったまま、
     画面横幅いっぱいになるよう拡大する。--u はコマ1マスの一辺(=列幅=行高)で画面幅から算出。
     --slot-n は実際のコマ数(JSXから注入。既定5)。全寸法・文字を --u 比で指定し比率を厳守。 */
  .sub-table-wrap { overflow: hidden; width: 100%; }
  .sub-slot-table {
    border-collapse: collapse; width: auto; margin: 0 auto; table-layout: fixed;
    --u: calc((100vw - 26px) / (var(--slot-n, 5) + 2.375));
  }
  .sub-slot-table th, .sub-slot-table td { border: 1px solid #ccc; text-align: center; padding: 0; }
  .sub-th-date, .sub-td-date { width: calc(var(--u) * 2.375); font-weight: 700; font-size: calc(var(--u) * 0.469); white-space: nowrap; }
  .sub-th-date { background: #f0f0f0; }
  .sub-td-date { background: #fff; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .sub-th-slot, .sub-td-slot { width: var(--u); height: var(--u); padding: 0; cursor: pointer; user-select: none; font-size: calc(var(--u) * 0.4375); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .sub-th-slot { background: #f0f0f0; font-weight: 700; }
  .sub-slot-x { background: #fee5e5 !important; color: #c00; font-weight: 700; }
  /* 「後から出席可能に変更」(2026-07-18)。日程表の is-reopened と同じ暫定=黄色(#f9e79f) */
  .sub-slot-reopened { background: #f9e79f !important; color: #7a5b00; font-weight: 700; }
  .sub-reopened-note { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: calc(var(--u) * 0.4); color: #555; }
  .sub-reopened-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; background: #f9e79f; border: 1px solid #d8c46a; }
  .sub-x-mark { display: block; font-size: calc(var(--u) * 0.5); line-height: 1; }
  .sub-x-label { display: block; font-size: calc(var(--u) * 0.25); line-height: 1.05; margin-top: 1px; }
  .sub-slot-occ { background: #e8f0ff; color: #336; font-size: calc(var(--u) * 0.344); font-weight: 700; }
  /* spec-group-lesson §E: 1限の左の集団授業列(集理/集社)。生徒日程表と同じ淡橙＋茶字。読み取り専用。 */
  .sub-th-group { background: #fbecd6; color: #7c3a00; font-size: calc(var(--u) * 0.4); }
  .sub-td-group { background: #fff7ec; cursor: default; font-size: calc(var(--u) * 0.34); font-weight: 700; color: #7c3a00; }
  .sub-td-group.sub-slot-group-on { background: #fff2dd; }
  .sub-row-all .sub-td-date { background: #fff0f0; }
  .sub-row-sun .sub-td-date { color: #d00; }
  .sub-row-sat .sub-td-date { color: #00c; }
  .sub-row-closed .sub-td-date { color: #999; cursor: default; }
  .sub-slot-closed { background: #f0f0f0 !important; cursor: default; }

  /* 希望科目数/集団授業の枠は文字・ボタンを2倍に拡大(sub-section-lg)。
     見出し+右肩の集計が狭い端末で折り返さないよう px 上限つき vw で頭打ちにする。 */
  .sub-section-lg .sub-section-title { font-size: min(42px, 10vw); }
  .sub-section-lg .sub-section-head .sub-muted { font-size: min(30px, 7vw); }

  /* Subject — 授業時間(プルダウン)→回数 を、並び順そのままで幅の中央に寄せる。 */
  .sub-subject-list { display: flex; flex-direction: column; gap: 6px; padding: 0 6px; }
  .sub-subject-row { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; padding: 8px 4px; border-bottom: 1px solid #eee; }
  .sub-subject-label { font-size: 40px; font-weight: 700; min-width: 60px; flex: none; }
  /* 授業時間プルダウン(回数0のときは枠だけ確保して回数の位置を揃える) */
  .sub-duration-slot { flex: none; width: 200px; }
  .sub-duration-select { width: 100%; height: 84px; border: 1px solid #ccc; border-radius: 14px; background: #f8f8f8; font-size: 32px; font-weight: 600; padding: 0 12px; touch-action: manipulation; }
  .sub-subject-ctrl { display: flex; align-items: center; gap: 12px; flex: none; }
  .sub-counter-btn { width: 84px; height: 84px; border-radius: 14px; border: 1px solid #ccc; background: #f8f8f8; font-size: 48px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; touch-action: manipulation; flex: none; }
  .sub-counter-btn:disabled { opacity: .3; }
  .sub-counter-input { width: 80px; height: 84px; text-align: center; font-size: 44px; font-weight: 700; border: 1px solid #ccc; border-radius: 14px; -moz-appearance: textfield; flex: none; }
  .sub-counter-input::-webkit-inner-spin-button, .sub-counter-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .sub-checkbox-row { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 12px; padding: 16px 6px; font-size: 36px; cursor: pointer; }
  .sub-checkbox { width: 56px; height: 56px; accent-color: #333; flex: none; }
  /* 集団授業: チェックボックスと参加/不参加テキストを、並び順そのままで幅の中央に寄せる */
  .sub-group-row { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 14px 4px; border-bottom: 1px solid #eee; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .sub-group-check { width: 76px; height: 76px; accent-color: #111; flex: none; }
  .sub-group-row .sub-subject-label { font-size: 40px; flex: none; }
  .sub-group-state { font-size: 34px; font-weight: 700; color: #999; min-width: 104px; text-align: right; }
  .sub-group-state.is-on { color: #111; }

  /* Submit */
  .sub-submit-section { padding: 12px; }
  .sub-summary { display: flex; gap: 16px; flex-wrap: wrap; background: #f8f8f8; border-radius: 6px; padding: 18px 16px; margin: 14px 0; font-size: 30px; }
  .sub-submit-btn { display: block; width: 100%; padding: 18px; border: none; border-radius: 8px; background: #111; color: #fff; font-size: 63px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
  .sub-disabled { opacity: .5; cursor: not-allowed; }

  /* 休校日: 1〜5限を結合したグレーセル(マス比に合わせて拡大) */
  .sub-slot-closed-merged { background: #ebebeb !important; color: #888; font-size: calc(var(--u) * 0.5625); font-weight: 700; letter-spacing: 2px; text-align: center; }

  /* 提出済み(閲覧専用)バナー */
  .sub-submitted-banner { display: flex; align-items: center; gap: 12px; background: #e8f5e8; border-bottom: 1px solid #cfe6cf; padding: 14px 14px; }
  .sub-submitted-check { flex: none; width: 52px; height: 52px; line-height: 52px; text-align: center; border-radius: 50%; background: #2a7e2a; color: #fff; font-size: 30px; font-weight: 700; }
  .sub-submitted-text { min-width: 0; }
  .sub-submitted-title { font-size: 42px; font-weight: 700; color: #1f5d1f; line-height: 1.2; }
  .sub-submitted-sub { font-size: 15px; color: #3a6b3a; margin-top: 4px; line-height: 1.4; }

  /* 閲覧専用テーブル(操作不可) */
  .sub-slot-table-readonly .sub-th-slot,
  .sub-slot-table-readonly .sub-td-slot,
  .sub-slot-table-readonly .sub-td-date { cursor: default; }

  /* 希望科目数(閲覧専用) */
  .sub-subject-row-readonly { justify-content: space-between; }
  .sub-subject-readonly-value { font-size: 15px; font-weight: 700; color: #222; }
  .sub-readonly-minutes { font-size: 12px; font-weight: 600; color: #777; margin-left: 6px; }

  /* 実機デバッグパネル(#/submit-debug のみ)。zoom 非適用にするため .sub-container の外側に置く。 */
  .sub-dbg { position: fixed; left: 8px; right: 8px; bottom: 8px; z-index: 99999;
    background: rgba(17,17,17,.92); color: #fff; border-radius: 10px; padding: 10px 12px;
    font-size: 13px; line-height: 1.3; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
  .sub-dbg-head { font-weight: 700; font-size: 13px; margin-bottom: 4px; color: #9fd; }
  .sub-dbg-readout { font-family: monospace; font-size: 13px; background: #000; color: #6f6;
    padding: 6px 8px; border-radius: 6px; margin-bottom: 4px; word-break: break-all; }
  .sub-dbg-info { font-size: 11px; color: #bbb; margin-bottom: 8px; }
  .sub-dbg-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .sub-dbg-label { flex: none; width: 64px; font-size: 12px; }
  .sub-dbg-row input[type=range] { flex: 1; min-width: 0; }
  .sub-dbg-val { flex: none; width: 56px; text-align: right; font-family: monospace; font-size: 13px; }
  .sub-dbg-presets { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 2px; }
  .sub-dbg-presets button { background: #333; color: #fff; border: 1px solid #555;
    border-radius: 6px; padding: 6px 10px; font-size: 12px; }
`
