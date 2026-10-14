// 開発用教室だけに出す「確認事項チェックリスト」パネル(2026-09-12 オーナー指示)。
//
// 画面最前面(右下・fixed)に浮かび、操作しながら各項目を 未確認/OK/要改善 で記録し、
// どの項目にもメモを書ける(未確認で書くと要改善になる)。入力のたびに localStorage へ下書き保存し、リロードしても残る。
// 「保存して送信」で既存の「要望・報告」経路(submitDeveloperReport)へ送る＝新しい保存先は作らない。
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import type { DeveloperReportAttachment, DeveloperReportSubmitResult } from '../../utils/developerReport'
import {
  VERIFICATION_CHECKLIST,
  VERIFICATION_CHECKLIST_ATTACHMENT_MAX_PER_ITEM,
  VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY,
  addVerificationChecklistAttachment,
  collectStaleVerificationChecklistDraftKeys,
  buildVerificationChecklistMarkdown,
  buildVerificationChecklistReportAttachments,
  buildVerificationChecklistReportNotes,
  countVerificationChecklistProgress,
  getVerificationChecklistAttachments,
  getVerificationChecklistEntry,
  parseVerificationChecklistDraft,
  removeVerificationChecklistAttachment,
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
  /**
   * 1通ぶんの本文を送る。App 側の submitDeveloperReport(source: 'board', category: 'request')へ委譲。
   * attachments は項目に貼ったスクリーンショット(2026-10-14)。複数通に分かれるときは 1 通目にだけ付ける。
   */
  onSubmitNote: (note: string, attachments?: DeveloperReportAttachment[]) => Promise<DeveloperReportSubmitResult>
  /** 画像の縮小(既定は canvas で長辺 1600px の JPEG)。テストで差し替える。 */
  shrinkImage?: (file: File) => Promise<{ name: string; dataUrl: string }>
  /**
   * 文面の `{{student:<生徒ID>}}` を名前にする(2026-10-10 オーナー指示「開発用教室は名前を見ていい」)。
   * App が開いている教室(開発用教室)の生徒データから引く。送信本文(id と結果だけ)には使わない。
   */
  resolveStudentName?: (studentId: string) => string | null | undefined
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
export function VerificationChecklistPanel({ classroomId, classroomName, onSubmitNote, resolveStudentName, shrinkImage = shrinkChecklistImageToDataUrl }: VerificationChecklistPanelProps) {
  const text = (line: string) => resolveVerificationChecklistText(line, resolveStudentName)
  const storageKey = verificationChecklistStorageKey(classroomId)
  const [draft, setDraft] = useState<VerificationChecklistDraft>(() => {
    pruneStaleDrafts(classroomId)
    return parseVerificationChecklistDraft(readStorage(storageKey))
  })
  const [collapsed, setCollapsed] = useState<boolean>(() => readStorage(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY) !== 'open')
  const [sending, setSending] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
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

  const progress = useMemo(() => countVerificationChecklistProgress(draft), [draft])
  const groups = useMemo(() => {
    const map = new Map<string, typeof VERIFICATION_CHECKLIST.items[number][]>()
    for (const item of VERIFICATION_CHECKLIST.items) {
      const list = map.get(item.area) ?? []
      list.push(item)
      map.set(item.area, list)
    }
    return [...map.entries()]
  }, [])

  const handleSubmit = useCallback(async () => {
    const notes = buildVerificationChecklistReportNotes(draft)
    if (notes.length === 0) {
      setResultMessage('まだ何も記録されていません。OK か要改善を付けてから送信してください。')
      return
    }
    setSending(true)
    setResultMessage(null)
    // 添付画像は 1 通目にだけ載せる(分割されても画像は 1 回・label=項目 id で何の画像か分かる)。
    const attachments = buildVerificationChecklistReportAttachments(draft)
    const reportIds: string[] = []
    let failure: string | null = null
    for (const [index, note] of notes.entries()) {
      // 送信は逐次(受付番号を順番に並べる・サーバー側の連投を避ける)。
      const result = await onSubmitNote(note, index === 0 && attachments.length > 0 ? attachments : undefined)
      if (result.ok) reportIds.push(result.reportId)
      else {
        failure = result.error
        break
      }
    }
    setSending(false)
    if (failure) {
      setResultMessage(`送れませんでした: ${failure}${reportIds.length > 0 ? `(送信済み ${reportIds.length}通: ${reportIds.join(', ')})` : ''}`)
      return
    }
    setResultMessage(`送りました(${reportIds.length}通${attachments.length > 0 ? `・画像 ${attachments.length} 枚` : ''}・受付番号 ${reportIds.join(', ')})。下書きはこのまま残ります。`)
  }, [draft, onSubmitNote])

  const handleCopy = useCallback(async () => {
    const markdown = buildVerificationChecklistMarkdown(draft)
    try {
      // 別タブで押したときは別タブの navigator を使う(元のタブはフォーカスが無くコピーを断られる)。
      await (detached?.win ?? window).navigator.clipboard.writeText(markdown)
      setResultMessage('Markdown をコピーしました。')
    } catch {
      setResultMessage('コピーできませんでした(ブラウザの権限)。文面は送信ボタンから送れます。')
    }
  }, [draft, detached])

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
            開発用教室のみ{classroomName ? `／${classroomName}` : ''}・OK {progress.ok} / 要改善 {progress.needsFix} / 未確認 {progress.remaining}
          </div>
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
        {groups.map(([area, items]) => (
          <div key={area} className="verification-checklist-group">
            <div className="verification-checklist-area">{area}</div>
            {items.map((item) => {
              const entry = getVerificationChecklistEntry(draft, item.id)
              const attachments = getVerificationChecklistAttachments(draft, item.id)
              return (
                <div key={item.id} className={`verification-checklist-item is-${entry.status}`} data-testid={`verification-checklist-item-${item.id}`}>
                  <div className="verification-checklist-item-title">
                    <span className="verification-checklist-item-id">{item.id}</span>
                    {text(item.title)}
                  </div>
                  {item.prep ? <p className="verification-checklist-prep"><span className="verification-checklist-label">前提</span>{text(item.prep)}</p> : null}
                  <div className="verification-checklist-label">操作</div>
                  <ol className="verification-checklist-steps">
                    {item.steps.map((step) => <li key={step}>{text(step)}</li>)}
                  </ol>
                  {item.check && item.check.length > 0 ? (
                    <>
                      <div className="verification-checklist-label">見るところ</div>
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
                        画像を追加(スクショ)
                      </label>
                    ) : null}
                  </div>
                  {entry.status === 'needs-fix' && !entry.memo.trim() ? (
                    <p className="verification-checklist-memo-hint">改善内容を書くと、そのまま修正に取りかかれます。</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}

        <div className="verification-checklist-group">
          <div className="verification-checklist-area">その他の気づき</div>
          <textarea
            className="verification-checklist-memo"
            value={draft.otherNotes}
            rows={3}
            placeholder="リストに無い気づき・要望"
            onChange={(event) => updateDraft(setVerificationChecklistOtherNotes(draft, event.target.value))}
            data-testid="verification-checklist-other-notes"
          />
        </div>
      </div>

      <footer className="verification-checklist-footer">
        {resultMessage ? <p className="verification-checklist-result" data-testid="verification-checklist-result">{resultMessage}</p> : null}
        <div className="verification-checklist-actions">
          <button type="button" className="secondary-button" onClick={() => { void handleCopy() }} data-testid="verification-checklist-copy">
            Markdown をコピー
          </button>
          <button type="button" className="primary-button" onClick={() => { void handleSubmit() }} disabled={sending} data-testid="verification-checklist-submit">
            {sending ? '送信中…' : '保存して送信'}
          </button>
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
