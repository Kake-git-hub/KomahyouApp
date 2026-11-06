// 開発用教室だけに出す「確認事項チェックリスト」パネル(2026-09-12 オーナー指示)。
//
// 画面最前面(右下・fixed)に浮かび、操作しながら各項目を 未確認/OK/要改善 で記録し、
// どの項目にもメモを書ける(未確認で書くと要改善になる)。入力のたびに localStorage へ下書き保存し、リロードしても残る。
// 送信は**項目ごと**(2026-11-03 オーナー指示「送信をまとめてではなく一件ごとに」): 各項目の「この項目を送信」で 1 項目 = 1 通を
// 既存の「要望・報告」経路(submitDeveloperReport)へ送る＝新しい保存先は作らない。フリーメモも単独で送る。
// どの教室で確認済みか(2026-11-03 オーナー指示「開発用教室とテスト用教室の双方でチェックしているため、双方が重複チェックしないように
// どちらの教室がチェック済みかわかるようにして」): App が渡す loadSharedResults(Cloud Function listVerificationChecklistResults・読み取り専用)で
// 両教室の送信済み結果を読み、項目ごとに「開発用教室 OK 11/3 14:05」「テスト教室 要改善 …」と出す。集約は verificationChecklistResults.ts の純関数。
// 送った結果は developerReports に記録されるだけで、要望・報告と違いメール通知も Issue 起票もしない
// (サーバー側 isVerificationChecklistReport で判定・2026-09-13 オーナー指示)。
//
// ⚠️ 本番教室では**一切マウントしない**(App.tsx の isActingDevelopmentClassroom で条件付け)。
// 書式・下書きの入出力・進捗計算はすべて src/utils/verificationChecklist.ts の純関数に委譲する
// (このコンポーネントは入出力と見た目だけを担う)。
//
// 別タブ表示(2026-10-14 オーナー指示「確認リストを別タブでひらけるようにして」): 見出しの「別タブで開く」で
// 空のタブを開き、同じパネルを createPortal でそのタブへ描く(状態・送信・生徒名の解決はこのコンポーネントのまま)。
// 別タブを閉じるか「元の画面に戻す」で右下へ戻る。元のタブを閉じる/再読み込み/教室を切り替えると別タブも閉じる。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { DeveloperReportAttachment, DeveloperReportSubmitResult } from '../../utils/developerReport'
import {
  formatChecklistRecordedAt,
  selectPendingChecklistOtherNotes,
  summarizeChecklistResultsByClassroom,
  type ChecklistItemClassroomResults,
  type ChecklistPendingOtherNote,
  type ChecklistSharedReport,
} from '../../utils/verificationChecklistResults'
import {
  VERIFICATION_CHECKLIST,
  selectVerificationChecklistItems,
  type VerificationChecklistAudience,
  VERIFICATION_CHECKLIST_ATTACHMENT_MAX_PER_ITEM,
  VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS,
  VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY,
  addVerificationChecklistAttachment,
  collectStaleVerificationChecklistDraftKeys,
  buildVerificationChecklistItemReportAttachments,
  buildVerificationChecklistItemReportNote,
  buildVerificationChecklistMarkdown,
  buildVerificationChecklistOtherNotesReportNote,
  countVerificationChecklistProgress,
  getVerificationChecklistAttachments,
  getVerificationChecklistEntry,
  markVerificationChecklistItemSent,
  parseVerificationChecklistDraft,
  clearReworkedVerificationChecklistEntries,
  removeVerificationChecklistAttachment,
  resolveVerificationChecklistItemSendState,
  resolveVerificationChecklistText,
  serializeVerificationChecklistDraft,
  setVerificationChecklistEntry,
  setVerificationChecklistMemo,
  setVerificationChecklistOtherNotes,
  verificationChecklistStorageKey,
  type VerificationChecklistDraft,
  type VerificationChecklistStatus,
} from '../../utils/verificationChecklist'
import { createChecklistAttachmentId, pickChecklistImageFiles, shrinkChecklistImageToDataUrl } from './checklistImage'
import {
  VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT,
  VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY,
  openVerificationChecklistWindow,
  parseVerificationChecklistWindowZoom,
  prepareVerificationChecklistWindowDocument,
  stepVerificationChecklistWindowZoom,
  verificationChecklistWindowZoomToCss,
} from './verificationChecklistWindow'

export type VerificationChecklistPanelProps = {
  classroomId: string | null
  classroomName?: string
  /** 見る相手(2026-10-15): development=全項目(開発用教室)・sandbox=テンプレ関係だけ(テスト教室)。 */
  audience: VerificationChecklistAudience
  /**
   * 1通ぶんの本文を送る。App 側の submitDeveloperReport(source: 'board', category: 'request')へ委譲。
   * 1 項目 = 1 通(2026-11-03)。attachments はその項目に貼ったスクリーンショット(2026-10-14)。
   */
  onSubmitNote: (note: string, attachments?: DeveloperReportAttachment[]) => Promise<DeveloperReportSubmitResult>
  /**
   * 開発用教室・テスト教室から送られた、今の版の確認リスト送信を読む(2026-11-03・読み取り専用)。App が Cloud Function
   * listVerificationChecklistResults へ委譲する。無ければ「どの教室で確認済みか」を出さない。
   */
  loadSharedResults?: () => Promise<ChecklistSharedReport[]>
  /** 画像の縮小(既定は canvas で長辺 1600px の JPEG)。テストで差し替える。 */
  shrinkImage?: (file: File) => Promise<{ name: string; dataUrl: string }>
  /**
   * 文面の `{{student:<生徒ID>}}` を名前にする(2026-10-10 オーナー指示「開発用教室は名前を見ていい」)。
   * App が開いている教室(開発用教室)の生徒データから引く。送信本文(id と結果だけ)には使わない。
   */
  resolveStudentName?: (studentId: string) => string | null | undefined
  /**
   * 「画面を撮る」(2026-11-03 オーナー指示「画像を追加(スクショ)しかなくなり、タブを選んで撮影ができなくなっている」)。
   * ボタンを置いたタブ(view)からブラウザのタブ選択画面を出し、コマ表・生徒日程表などを 1 枚撮る(screenCapture.captureBrowserTabFromView)。
   * タブを選べないブラウザでは App が渡さない(ボタンを出さず、ファイル選択と貼り付けだけ)。
   */
  onCaptureTab?: (view: Window) => Promise<{ name: string; dataUrl: string }>
  /**
   * 「準備する」(2026-11-06 オーナー選択「案 C(段階導入)」・spec-developer-report §E-2-4)。autoPrep の項目に出すボタンから呼ぶ。
   * App が開いているコマ表へ一過性リクエスト(checklistPrepRequest)を渡し、結果文(どこに何を置いたか・残る手作業)を返す。
   * App は検証用教室(開発用・テスト教室)のときだけ渡す。無ければボタンを出さない。保存はしない(「保存」を押してもらう)。
   */
  onPrepare?: (itemId: string) => Promise<{ ok: boolean; message: string }>
}

const STATUS_OPTIONS: ReadonlyArray<{ value: VerificationChecklistStatus; label: string }> = [
  { value: 'unchecked', label: '未確認' },
  { value: 'ok', label: 'OK' },
  { value: 'needs-fix', label: '要改善' },
]

function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 保存できたら true。容量超過・プライベートモード等は false(下書きが残らないだけで操作は続けられる)。 */
function writeStorage(key: string, value: string): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** 同じ教室の別の版の下書き(画像つきだと数 MB)を消して、localStorage の容量を空ける(2026-10-14)。 */
function pruneStaleDrafts(classroomId: string | null) {
  try {
    if (typeof window === 'undefined') return
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index) ?? '')
    for (const key of collectStaleVerificationChecklistDraftKeys(keys, classroomId)) window.localStorage.removeItem(key)
  } catch {
    // 読めない・消せない環境では何もしない。
  }
}

// 教室を切り替えたときは App 側が key={classroomId} で作り直すため、下書きは初期化時に読み直される
// (他教室の入力を持ち越さない)。ここで effect を使って state を書き戻さない。
/** 送信中の印(フリーメモ用)。項目 id と重ならない。 */
const OTHER_NOTES_SEND_KEY = '__other-notes__'

type SharedResultsState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; results: ChecklistItemClassroomResults; pendingOtherNotes: ChecklistPendingOtherNote[] }
  | { status: 'error'; message: string; results: ChecklistItemClassroomResults; pendingOtherNotes: ChecklistPendingOtherNote[] }

export function VerificationChecklistPanel({ classroomId, classroomName, audience, onSubmitNote, loadSharedResults, resolveStudentName, onCaptureTab, onPrepare, shrinkImage = shrinkChecklistImageToDataUrl }: VerificationChecklistPanelProps) {
  const items = useMemo(() => selectVerificationChecklistItems(audience), [audience])
  const text = (line: string) => resolveVerificationChecklistText(line, resolveStudentName)
  const storageKey = verificationChecklistStorageKey(classroomId)
  const [draft, setDraft] = useState<VerificationChecklistDraft>(() => {
    pruneStaleDrafts(classroomId)
    // 要改善を受けて書き換えた項目は、書き換え前に送った結果・メモを消してから出す(2026-11-03 オーナー指示)。消したら保存し直す。
    const loaded = parseVerificationChecklistDraft(readStorage(storageKey))
    const cleaned = clearReworkedVerificationChecklistEntries(loaded)
    if (cleaned !== loaded) writeStorage(storageKey, serializeVerificationChecklistDraft(cleaned))
    return cleaned
  })
  const [collapsed, setCollapsed] = useState<boolean>(() => readStorage(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY) !== 'open')
  /** 送信中の項目 id(フリーメモは OTHER_NOTES_SEND_KEY)。同時に 1 件だけ送る。 */
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  /** 項目ごとの送信結果の一言(失敗の理由など)。 */
  const [itemMessages, setItemMessages] = useState<Record<string, string>>({})
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  /** 「準備する」を実行中の項目 id(同時に 1 件だけ)。 */
  const [preparingItemId, setPreparingItemId] = useState<string | null>(null)
  /** 「準備する」の結果文(項目ごと・画面だけ。下書きには保存しない)。 */
  const [prepResults, setPrepResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [shared, setShared] = useState<SharedResultsState>({ status: 'idle' })
  /** 別タブで表示中なら、そのタブと描き込み先。null = この画面の右下に表示。 */
  const [detached, setDetached] = useState<{ win: Window; root: HTMLElement } | null>(null)
  /**
   * 別タブだけの拡大率(%)(2026-10-14 オーナー指摘「別タブ時の拡大縮小は独立でできるようにして」)。ブラウザの拡大は同じサイトの
   * タブ全部に効くので、別タブのパネルに CSS zoom を当てる自前の拡大率を持つ。右下の浮き窓には当てない。
   */
  const [windowZoom, setWindowZoom] = useState<number>(() => parseVerificationChecklistWindowZoom(readStorage(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY)))
  const changeWindowZoom = useCallback((direction: 1 | -1) => {
    setWindowZoom((current) => {
      const next = stepVerificationChecklistWindowZoom(current, direction)
      writeStorage(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY, String(next))
      return next
    })
  }, [])
  const resetWindowZoom = useCallback(() => {
    setWindowZoom(VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT)
    writeStorage(VERIFICATION_CHECKLIST_WINDOW_ZOOM_STORAGE_KEY, String(VERIFICATION_CHECKLIST_WINDOW_ZOOM_DEFAULT))
  }, [])

  const updateDraft = useCallback((next: VerificationChecklistDraft) => {
    setDraft(next)
    writeStorage(verificationChecklistStorageKey(classroomId), serializeVerificationChecklistDraft(next))
  }, [classroomId])

  /**
   * 項目に画像を足す(貼り付け・ファイル選択の両方からここへ)。縮小 → 純関数で上限を見て下書きへ。
   * 断られた理由は結果欄に出す(1 枚ずつ・途中で止めない)。state の更新は関数形式で重ねる(連続貼り付けで前の分を失わない)。
   */
  const addImages = useCallback(async (itemId: string, files: ArrayLike<File> | null | undefined) => {
    const images = pickChecklistImageFiles(files)
    if (images.length === 0) return
    for (const file of images) {
      let shrunk: { name: string; dataUrl: string }
      try {
        shrunk = await shrinkImage(file)
      } catch (error) {
        setResultMessage(`画像を読めませんでした(${file.name || '貼り付け'}): ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      let failure: string | null = null
      let stored = true
      setDraft((current) => {
        const result = addVerificationChecklistAttachment(current, { itemId, name: shrunk.name, dataUrl: shrunk.dataUrl }, createChecklistAttachmentId())
        failure = result.error
        if (!result.error) stored = writeStorage(verificationChecklistStorageKey(classroomId), serializeVerificationChecklistDraft(result.draft))
        return result.draft
      })
      // setDraft の更新関数は同期に走る(React 18/19 とも)。ここで failure を読んで理由を出す。
      if (failure) setResultMessage(`画像を付けられませんでした(${itemId}): ${failure}`)
      else if (!stored) setResultMessage('画像は付きましたが、この端末の保存領域がいっぱいで下書きに残せません(再読み込みすると消えます)。先に送信するか、ほかの画像を外してください。')
      else setResultMessage(null)
    }
  }, [classroomId, shrinkImage])

  // 撮った画像は縮小済みの JPEG(screenCapture が CHECKLIST_IMAGE_MAX_EDGE へ縮める)なので、そのまま項目へ付ける。
  const [capturingItemId, setCapturingItemId] = useState<string | null>(null)
  const captureTabForItem = useCallback(async (itemId: string, view: Window) => {
    if (!onCaptureTab) return
    setCapturingItemId(itemId)
    try {
      const shot = await onCaptureTab(view)
      let failure: string | null = null
      let stored = true
      setDraft((current) => {
        const result = addVerificationChecklistAttachment(current, { itemId, name: shot.name, dataUrl: shot.dataUrl }, createChecklistAttachmentId())
        failure = result.error
        if (!result.error) stored = writeStorage(verificationChecklistStorageKey(classroomId), serializeVerificationChecklistDraft(result.draft))
        return result.draft
      })
      if (failure) setResultMessage(`画像を付けられませんでした(${itemId}): ${failure}`)
      else if (!stored) setResultMessage('画像は付きましたが、この端末の保存領域がいっぱいで下書きに残せません(再読み込みすると消えます)。先に送信するか、ほかの画像を外してください。')
      else setResultMessage(null)
    } catch (error) {
      // 選ばずに閉じたときは何も出さない(screenCapture.ts の TabCaptureCancelledError)。
      if (!(error instanceof Error && error.name === 'TabCaptureCancelledError')) {
        setResultMessage('選んだタブを撮れませんでした。スクリーンショットを撮って「画像を追加」から付けるか、Ctrl+V で貼り付けてください。')
      }
    } finally {
      setCapturingItemId(null)
    }
  }, [classroomId, onCaptureTab])

  const removeImage = useCallback((attachmentId: string) => {
    setDraft((current) => {
      const next = removeVerificationChecklistAttachment(current, attachmentId)
      writeStorage(verificationChecklistStorageKey(classroomId), serializeVerificationChecklistDraft(next))
      return next
    })
  }, [classroomId])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      writeStorage(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY, next ? 'collapsed' : 'open')
      return next
    })
  }, [])

  const handleOpenWindow = useCallback(() => {
    const win = openVerificationChecklistWindow(window)
    if (!win) {
      setResultMessage('別タブを開けませんでした。ブラウザのポップアップの許可を確認してください。')
      return
    }
    try {
      const root = prepareVerificationChecklistWindowDocument(document, win.document, `確認リスト ${VERIFICATION_CHECKLIST.version}`)
      setResultMessage(null)
      setDetached({ win, root })
      win.focus()
    } catch {
      try { win.close() } catch { /* 閉じられなくても右下の表示は続く */ }
      setResultMessage('別タブを開けませんでした。この画面のまま使ってください。')
    }
  }, [])

  const handleReturnFromWindow = useCallback(() => {
    setDetached(null)
  }, [])

  // 別タブの後始末: 別タブが閉じられたら右下へ戻す。元のタブが閉じる/再読み込み/このパネルが外れる(教室切り替え)
  // ときは別タブも閉じる(取り残された別タブで入力しても、下書きにも送信にも届かないため)。
  useEffect(() => {
    if (!detached) return undefined
    const { win } = detached
    const handleWindowGone = () => setDetached((current) => (current?.win === win ? null : current))
    const closeWindow = () => {
      try {
        if (!win.closed) win.close()
      } catch {
        // 既に閉じている等は無視する。
      }
    }
    win.addEventListener('pagehide', handleWindowGone)
    // pagehide を取りこぼすブラウザ向けの保険(閉じたかを 1 秒ごとに見る)。
    const timer = window.setInterval(() => {
      if (win.closed) handleWindowGone()
    }, 1000)
    window.addEventListener('pagehide', closeWindow)
    return () => {
      try {
        win.removeEventListener('pagehide', handleWindowGone)
      } catch {
        // 閉じたタブの window は触れないことがある。
      }
      window.clearInterval(timer)
      window.removeEventListener('pagehide', closeWindow)
      closeWindow()
    }
  }, [detached])

  const progress = useMemo(() => countVerificationChecklistProgress(draft, items), [draft, items])
  const groups = useMemo(() => {
    const map = new Map<string, typeof VERIFICATION_CHECKLIST.items[number][]>()
    for (const item of items) {
      const list = map.get(item.area) ?? []
      list.push(item)
      map.set(item.area, list)
    }
    return [...map.entries()]
  }, [items])

  // 両教室の送信済み結果を読む(開いたとき・送ったあと・「更新」)。失敗しても項目の入力・送信は続けられる。
  // App の再描画で関数の identity が変わっても読み直さない(読むのは開いたとき・送ったあと・「更新」だけ)。
  const loadSharedResultsRef = useRef(loadSharedResults)
  useLayoutEffect(() => {
    loadSharedResultsRef.current = loadSharedResults
  }, [loadSharedResults])
  const hasSharedResults = Boolean(loadSharedResults)
  const refreshShared = useCallback(async () => {
    const load = loadSharedResultsRef.current
    if (!load) return
    setShared((current) => (current.status === 'ready' || current.status === 'error' ? current : { status: 'loading' }))
    try {
      const reports = await load()
      setShared({
        status: 'ready',
        results: summarizeChecklistResultsByClassroom(reports, { currentClassroomId: classroomId }),
        pendingOtherNotes: selectPendingChecklistOtherNotes(reports, { currentClassroomId: classroomId, processedReportIds: VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS }),
      })
    } catch (error) {
      setShared((current) => ({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        results: current.status === 'ready' || current.status === 'error' ? current.results : {},
        pendingOtherNotes: current.status === 'ready' || current.status === 'error' ? current.pendingOtherNotes : [],
      }))
    }
  }, [classroomId])

  useEffect(() => {
    if (hasSharedResults) void refreshShared()
  }, [hasSharedResults, refreshShared])
  const pendingOtherNotes = shared.status === 'ready' || shared.status === 'error' ? shared.pendingOtherNotes : []

  const setItemMessage = useCallback((key: string, message: string | null) => {
    setItemMessages((current) => {
      const next = { ...current }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }, [])

  /** 「準備する」(2026-11-06)。同時に 1 件だけ。結果文は画面だけに出す(下書きには残さない)。 */
  const handlePrepare = useCallback(async (itemId: string) => {
    if (!onPrepare || preparingItemId !== null) return
    setPreparingItemId(itemId)
    try {
      const result = await onPrepare(itemId)
      setPrepResults((current) => ({ ...current, [itemId]: result }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPrepResults((current) => ({ ...current, [itemId]: { ok: false, message: `準備できませんでした: ${message}` } }))
    } finally {
      setPreparingItemId(null)
    }
  }, [onPrepare, preparingItemId])

  /** 1 項目を送る(2026-11-03)。1 項目 = 1 通。送れたら下書きに「送った内容」を残し、その項目の画像を下書きから外す。 */
  const handleSendItem = useCallback(async (itemId: string) => {
    if (sendingKey) return
    const note = buildVerificationChecklistItemReportNote(draft, itemId, { items })
    if (!note) {
      setItemMessage(itemId, 'OK か要改善を選んでから送信してください。')
      return
    }
    const attachments = buildVerificationChecklistItemReportAttachments(draft, itemId)
    setSendingKey(itemId)
    setItemMessage(itemId, null)
    const result = await onSubmitNote(note, attachments.length > 0 ? attachments : undefined)
    setSendingKey(null)
    if (!result.ok) {
      setItemMessage(itemId, `送れませんでした: ${result.error}`)
      return
    }
    setDraft((current) => {
      const next = markVerificationChecklistItemSent(current, itemId, { reportId: result.reportId, sentAt: new Date().toISOString(), attachmentCount: attachments.length })
      writeStorage(verificationChecklistStorageKey(classroomId), serializeVerificationChecklistDraft(next))
      return next
    })
    void refreshShared()
  }, [classroomId, draft, items, onSubmitNote, refreshShared, sendingKey, setItemMessage])

  /** フリーメモだけを送る。送れたら欄を空にする(同じメモを二重に送らない)。 */
  const handleSendOtherNotes = useCallback(async () => {
    if (sendingKey) return
    const note = buildVerificationChecklistOtherNotesReportNote(draft)
    if (!note) {
      setItemMessage(OTHER_NOTES_SEND_KEY, 'フリーメモが空です。')
      return
    }
    setSendingKey(OTHER_NOTES_SEND_KEY)
    setItemMessage(OTHER_NOTES_SEND_KEY, null)
    const result = await onSubmitNote(note)
    setSendingKey(null)
    if (!result.ok) {
      setItemMessage(OTHER_NOTES_SEND_KEY, `送れませんでした: ${result.error}`)
      return
    }
    setDraft((current) => {
      const next = setVerificationChecklistOtherNotes(current, '')
      writeStorage(verificationChecklistStorageKey(classroomId), serializeVerificationChecklistDraft(next))
      return next
    })
    setItemMessage(OTHER_NOTES_SEND_KEY, `送りました(受付番号 ${result.reportId})。`)
    // 送ったメモを下の「対応待ちのフリーメモ」に出す(2026-11-03)。
    void refreshShared()
  }, [classroomId, draft, onSubmitNote, refreshShared, sendingKey, setItemMessage])

  const handleCopy = useCallback(async () => {
    const markdown = buildVerificationChecklistMarkdown(draft, items)
    try {
      // 別タブで押したときは別タブの navigator を使う(元のタブはフォーカスが無くコピーを断られる)。
      await (detached?.win ?? window).navigator.clipboard.writeText(markdown)
      setResultMessage('Markdown をコピーしました。')
    } catch {
      setResultMessage('コピーできませんでした(ブラウザの権限)。文面は送信ボタンから送れます。')
    }
  }, [draft, detached, items])

  if (!detached && collapsed) {
    return (
      <button
        type="button"
        className="verification-checklist-toggle"
        onClick={toggleCollapsed}
        data-testid="verification-checklist-toggle"
      >
        確認リスト {progress.checked}/{progress.total}
        {progress.needsFix > 0 ? <span className="verification-checklist-toggle-badge">要改善 {progress.needsFix}</span> : null}
        {progress.unsent > 0 ? <span className="verification-checklist-toggle-badge">未送信 {progress.unsent}</span> : null}
      </button>
    )
  }

  const panel = (
    <section
      className={`verification-checklist-panel${detached ? ' is-detached' : ''}`}
      aria-label="確認事項チェックリスト"
      data-testid="verification-checklist-panel"
      // 別タブだけ自前の拡大率(CSS zoom)。右下の浮き窓には付けない(ブラウザの拡大と二重にならない)。
      style={detached ? { zoom: verificationChecklistWindowZoomToCss(windowZoom) } : undefined}
    >
      <header className="verification-checklist-header">
        <div>
          <div className="verification-checklist-title">確認リスト {VERIFICATION_CHECKLIST.version}</div>
          <div className="verification-checklist-subtitle">
            {audience === 'sandbox' ? 'テスト教室(テンプレ関係のみ)' : '開発用教室(全項目)'}{classroomName ? `／${classroomName}` : ''}・OK {progress.ok} / 要改善 {progress.needsFix} / 未確認 {progress.remaining}{progress.unsent > 0 ? ` / 未送信 ${progress.unsent}` : ''}
          </div>
          {loadSharedResults ? (
            <div className="verification-checklist-shared-status" data-testid="verification-checklist-shared-status">
              {shared.status === 'loading' || shared.status === 'idle' ? '両教室の送信済みを読み込み中…' : shared.status === 'error' ? `両教室の送信済みを読めませんでした(${shared.message})` : '項目ごとに、開発用教室・テスト教室で送信済みの結果を出しています'}
              <button type="button" className="link-button" onClick={() => { void refreshShared() }} data-testid="verification-checklist-shared-refresh">更新</button>
            </div>
          ) : null}
        </div>
        {detached ? (
          <div className="verification-checklist-header-actions">
            <div className="verification-checklist-zoom" role="group" aria-label="別タブの拡大率" data-testid="verification-checklist-zoom">
              <button type="button" className="verification-checklist-zoom-button" onClick={() => changeWindowZoom(-1)} aria-label="縮小" data-testid="verification-checklist-zoom-out">－</button>
              <button type="button" className="verification-checklist-zoom-value" onClick={resetWindowZoom} title="押すと 100% に戻す" data-testid="verification-checklist-zoom-value">{windowZoom}%</button>
              <button type="button" className="verification-checklist-zoom-button" onClick={() => changeWindowZoom(1)} aria-label="拡大" data-testid="verification-checklist-zoom-in">＋</button>
            </div>
            <button type="button" className="verification-checklist-window-button" onClick={handleReturnFromWindow} data-testid="verification-checklist-return">
              元の画面に戻す
            </button>
          </div>
        ) : (
          <div className="verification-checklist-header-actions">
            <button type="button" className="verification-checklist-window-button" onClick={handleOpenWindow} data-testid="verification-checklist-open-window">
              別タブで開く
            </button>
            <button type="button" className="verification-checklist-collapse" onClick={toggleCollapsed} aria-label="確認リストを閉じる">
              －
            </button>
          </div>
        )}
      </header>

      <div className="verification-checklist-body">
        {/* フリーメモ(2026-11-01 オーナー指示「フリーメモ欄を確認リストに追加」): 旧「その他の気づき」(末尾)を先頭へ移し、
            項目に関係ない気づき・判断項目への意見・質問を自由に書ける欄にした。送信本文では従来どおり「その他」として届く。 */}
        <div className="verification-checklist-group verification-checklist-free-memo">
          <div className="verification-checklist-area">フリーメモ</div>
          <textarea
            className="verification-checklist-memo"
            value={draft.otherNotes}
            rows={3}
            placeholder="項目に関係ない気づき・意見・質問を自由に(送信本文には「その他」として載ります)"
            onChange={(event) => updateDraft(setVerificationChecklistOtherNotes(draft, event.target.value))}
            data-testid="verification-checklist-other-notes"
          />
          <div className="verification-checklist-send-row">
            <button
              type="button"
              className="secondary-button verification-checklist-send-button"
              onClick={() => { void handleSendOtherNotes() }}
              disabled={sendingKey !== null || !draft.otherNotes.trim()}
              data-testid="verification-checklist-send-other-notes"
            >
              {sendingKey === OTHER_NOTES_SEND_KEY ? '送信中…' : 'フリーメモを送信'}
            </button>
            {itemMessages[OTHER_NOTES_SEND_KEY] ? <span className="verification-checklist-send-state">{itemMessages[OTHER_NOTES_SEND_KEY]}</span> : null}
          </div>
          {/* 送ったフリーメモの履歴(2026-11-03 オーナー指示「Claude で処理されるまでは送信内容が確認リストに履歴が残るように」)。
              Claude が対応済みにした受付(VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS)は出さない。 */}
          {pendingOtherNotes.length > 0 ? (
            <div className="verification-checklist-pending-notes" data-testid="verification-checklist-pending-notes">
              <div className="verification-checklist-pending-notes-title">送ったフリーメモ(Claude が対応するまで残ります)</div>
              <ul>
                {pendingOtherNotes.map((row) => (
                  <li key={row.reportId} data-testid={`verification-checklist-pending-note-${row.reportId}`}>
                    <span className="verification-checklist-pending-notes-meta">{formatChecklistRecordedAt(row.recordedAt)}・{row.classroomLabel}</span>
                    <span className="verification-checklist-pending-notes-text">{row.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {groups.map(([area, items]) => (
          <div key={area} className="verification-checklist-group">
            <div className="verification-checklist-area">{area}</div>
            {items.map((item) => {
              const entry = getVerificationChecklistEntry(draft, item.id)
              const attachments = getVerificationChecklistAttachments(draft, item.id)
              const sendState = resolveVerificationChecklistItemSendState(draft, item.id)
              const sentRecord = draft.sent[item.id]
              const sharedResults = shared.status === 'ready' || shared.status === 'error' ? shared.results[item.id] ?? [] : []
              const isSending = sendingKey === item.id
              return (
                <div key={item.id} className={`verification-checklist-item is-${entry.status}`} data-testid={`verification-checklist-item-${item.id}`}>
                  <div className="verification-checklist-item-title">
                    <span className="verification-checklist-item-id">{item.id}</span>
                    {text(item.title)}
                  </div>
                  {/* どの教室で確認済みか(2026-11-03): 両教室の送信済み結果。別の教室の結果は目立たせ、重複して確かめないようにする。 */}
                  {sharedResults.length > 0 ? (
                    <ul className="verification-checklist-shared" data-testid={`verification-checklist-shared-${item.id}`}>
                      {sharedResults.map((row) => (
                        <li
                          key={row.classroomId}
                          className={`verification-checklist-shared-row is-${row.result}${row.isCurrentClassroom ? ' is-current' : ' is-other'}`}
                          data-testid={`verification-checklist-shared-${item.id}-${row.classroomKind}`}
                        >
                          <span className="verification-checklist-shared-classroom">{row.classroomLabel}{row.isCurrentClassroom ? '(この教室)' : ''}</span>
                          <span className="verification-checklist-shared-result">{row.result === 'ok' ? 'OK' : '要改善'}</span>
                          <span className="verification-checklist-shared-time">{formatChecklistRecordedAt(row.recordedAt)} 送信済み</span>
                          {row.memo ? <span className="verification-checklist-shared-memo">{row.memo}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {/* オーナーが新たに決めたこと(2026-11-01 オーナー指示「私が行った新たな判断があるものは、確認リストの説明に新たに定義したことを記載しテスト担当者が分かるように」)。 */}
                  {item.ownerDecision ? <p className="verification-checklist-owner-decision" data-testid={`verification-checklist-owner-decision-${item.id}`}><span className="verification-checklist-label">オーナーの決定</span>{text(item.ownerDecision)}</p> : null}
                  {item.prep ? (
                    <div className="verification-checklist-prep-row">
                      {/* 「準備する」(2026-11-06・案 C 第 1 段・ボタンは文の左=ap-1): autoPrep の項目だけ・App が onPrepare を渡したとき(検証用教室)だけ。 */}
                      {item.autoPrep && onPrepare ? (
                        <button
                          type="button"
                          className="secondary-button verification-checklist-prep-button"
                          onClick={() => { void handlePrepare(item.id) }}
                          disabled={preparingItemId !== null}
                          data-testid={`verification-checklist-prep-${item.id}`}
                        >
                          {preparingItemId === item.id ? '準備中…' : '準備する'}
                        </button>
                      ) : null}
                      <p className="verification-checklist-prep"><span className="verification-checklist-label">準備</span>{text(item.prep)}</p>
                    </div>
                  ) : null}
                  {prepResults[item.id] ? (
                    <p
                      className={`verification-checklist-prep-result ${prepResults[item.id].ok ? 'is-ok' : 'is-error'}`}
                      data-testid="verification-checklist-prep-result"
                      data-item-id={item.id}
                      role="status"
                    >
                      {prepResults[item.id].message}
                    </p>
                  ) : null}
                  <div className="verification-checklist-label">やること</div>
                  <ol className="verification-checklist-steps">
                    {item.steps.map((step) => <li key={step}>{text(step)}</li>)}
                  </ol>
                  {item.check && item.check.length > 0 ? (
                    <>
                      <div className="verification-checklist-label">OKの目安</div>
                      <ul className="verification-checklist-check">
                        {item.check.map((line) => <li key={line}>{text(line)}</li>)}
                      </ul>
                    </>
                  ) : null}
                  <div className="verification-checklist-status" role="group" aria-label={`${item.title} の結果`}>
                    {STATUS_OPTIONS.map((option) => (
                      <label key={option.value} className={`verification-checklist-status-option${entry.status === option.value ? ' is-selected' : ''}`}>
                        <input
                          type="radio"
                          name={`verification-checklist-${item.id}`}
                          value={option.value}
                          checked={entry.status === option.value}
                          onChange={() => updateDraft(setVerificationChecklistEntry(draft, item.id, { status: option.value }))}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  {/* メモ欄は結果に関わらず常に出す(2026-09-13 オーナー指摘「テキストが入力できない」:
                      以前は要改善を選ぶまで入力欄が無く、OK/未確認のまま書けなかった)。未確認で書くと要改善になる。 */}
                  <textarea
                    className="verification-checklist-memo"
                    value={entry.memo}
                    rows={2}
                    placeholder={entry.status === 'needs-fix' ? 'どう直してほしいか(必須ではないが書いてほしい)。スクショは Ctrl+V で貼れます' : 'メモ(任意)。スクショは Ctrl+V で貼れます'}
                    onChange={(event) => updateDraft(setVerificationChecklistMemo(draft, item.id, event.target.value))}
                    onPaste={(event) => {
                      // クリップボードの画像(Win+Shift+S などのスクショ)をこの項目に添付する。文字の貼り付けは従来どおり。
                      const files = pickChecklistImageFiles(event.clipboardData?.files)
                      if (files.length === 0) return
                      event.preventDefault()
                      void addImages(item.id, files)
                    }}
                    data-testid={`verification-checklist-memo-${item.id}`}
                  />
                  {/* 添付画像(2026-10-14 オーナー要望「確認リストにスクショで画像毎保存できるようにしたい」)。貼り付けかファイル選択。 */}
                  <div className="verification-checklist-attachments" data-testid={`verification-checklist-attachments-${item.id}`}>
                    {attachments.map((attachment) => (
                      <figure key={attachment.id} className="verification-checklist-attachment">
                        <img src={attachment.dataUrl} alt={`${item.id} の画像 ${attachment.name}`} />
                        <figcaption>
                          <span>{attachment.name}({Math.max(1, Math.round(attachment.byteLength / 1024))}KB)</span>
                          <button type="button" className="link-button" onClick={() => removeImage(attachment.id)} data-testid={`verification-checklist-attachment-remove-${attachment.id}`}>外す</button>
                        </figcaption>
                      </figure>
                    ))}
                    {attachments.length < VERIFICATION_CHECKLIST_ATTACHMENT_MAX_PER_ITEM && onCaptureTab ? (
                      <button
                        type="button"
                        className="verification-checklist-attach"
                        onClick={(event) => { void captureTabForItem(item.id, event.currentTarget.ownerDocument.defaultView ?? window) }}
                        disabled={capturingItemId !== null}
                        title="コマ表・生徒日程表など、開いているタブを選んで 1 枚撮ります(ブラウザのタブ選択画面が出ます)"
                        data-testid={`verification-checklist-capture-${item.id}`}
                      >
                        {capturingItemId === item.id ? '撮影中…' : '画面を撮る'}
                      </button>
                    ) : null}
                    {attachments.length < VERIFICATION_CHECKLIST_ATTACHMENT_MAX_PER_ITEM ? (
                      <label className="verification-checklist-attach">
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => {
                            const files = event.target.files
                            void addImages(item.id, files)
                            event.target.value = ''
                          }}
                          data-testid={`verification-checklist-attach-${item.id}`}
                        />
                        画像を追加
                      </label>
                    ) : null}
                  </div>
                  {entry.status === 'needs-fix' && !entry.memo.trim() ? (
                    <p className="verification-checklist-memo-hint">改善内容を書くと、そのまま修正に取りかかれます。</p>
                  ) : null}
                  {/* 項目ごとの送信(2026-11-03 オーナー指示「送信をまとめてではなく一件ごとに」)。 */}
                  <div className="verification-checklist-send-row">
                    <button
                      type="button"
                      className={`${sendState === 'unsent' || sendState === 'changed' ? 'primary-button' : 'secondary-button'} verification-checklist-send-button`}
                      onClick={() => { void handleSendItem(item.id) }}
                      disabled={sendingKey !== null || sendState === 'unchecked' || sendState === 'sent'}
                      data-testid={`verification-checklist-send-${item.id}`}
                    >
                      {isSending ? '送信中…' : sendState === 'sent' ? '送信済み' : sendState === 'changed' ? '変更を送信' : 'この項目を送信'}
                    </button>
                    <span className={`verification-checklist-send-state is-${sendState}`} data-testid={`verification-checklist-send-state-${item.id}`}>
                      {itemMessages[item.id]
                        ?? (sendState === 'sent' && sentRecord
                          ? `送信済み ${formatChecklistRecordedAt(sentRecord.sentAt)}${sentRecord.attachmentCount > 0 ? `・画像 ${sentRecord.attachmentCount} 枚` : ''}`
                          : sendState === 'changed'
                            ? '送った後に変更があります(まだ送っていません)'
                            : sendState === 'unsent'
                              ? '未送信'
                              : 'OK か要改善を選ぶと送れます')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

      </div>

      <footer className="verification-checklist-footer">
        {resultMessage ? <p className="verification-checklist-result" data-testid="verification-checklist-result">{resultMessage}</p> : null}
        <div className="verification-checklist-actions">
          <button type="button" className="secondary-button" onClick={() => { void handleCopy() }} data-testid="verification-checklist-copy">
            Markdown をコピー
          </button>
          <span className="verification-checklist-unsent-count" data-testid="verification-checklist-unsent-count">
            {progress.unsent > 0 ? `未送信 ${progress.unsent} 件(各項目の「この項目を送信」で送ります)` : '未送信の項目はありません'}
          </span>
        </div>
      </footer>
    </section>
  )

  if (detached) {
    return (
      <>
        <button
          type="button"
          className="verification-checklist-toggle"
          onClick={() => detached.win.focus()}
          data-testid="verification-checklist-detached-toggle"
        >
          確認リスト 別タブで表示中 {progress.checked}/{progress.total}
        </button>
        {createPortal(panel, detached.root)}
      </>
    )
  }

  return panel
}

export default VerificationChecklistPanel
