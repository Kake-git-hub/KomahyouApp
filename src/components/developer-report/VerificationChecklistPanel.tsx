// 開発用教室だけに出す「確認事項チェックリスト」パネル(2026-09-12 オーナー指示)。
//
// 画面最前面(右下・fixed)に浮かび、操作しながら各項目を 未確認/OK/要改善 で記録し、
// 要改善にはメモを書ける。入力のたびに localStorage へ下書き保存し、リロードしても残る。
// 「保存して送信」で既存の「要望・報告」経路(submitDeveloperReport)へ送る＝新しい保存先は作らない。
//
// ⚠️ 本番教室では**一切マウントしない**(App.tsx の isActingDevelopmentClassroom で条件付け)。
// 書式・下書きの入出力・進捗計算はすべて src/utils/verificationChecklist.ts の純関数に委譲する
// (このコンポーネントは入出力と見た目だけを担う)。

import { useCallback, useMemo, useState } from 'react'

import type { DeveloperReportSubmitResult } from '../../utils/developerReport'
import {
  VERIFICATION_CHECKLIST,
  VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY,
  buildVerificationChecklistMarkdown,
  buildVerificationChecklistReportNotes,
  countVerificationChecklistProgress,
  getVerificationChecklistEntry,
  parseVerificationChecklistDraft,
  serializeVerificationChecklistDraft,
  setVerificationChecklistEntry,
  setVerificationChecklistOtherNotes,
  verificationChecklistStorageKey,
  type VerificationChecklistDraft,
  type VerificationChecklistStatus,
} from '../../utils/verificationChecklist'

export type VerificationChecklistPanelProps = {
  classroomId: string | null
  classroomName?: string
  /** 1通ぶんの本文を送る。App 側の submitDeveloperReport(source: 'board', category: 'request')へ委譲。 */
  onSubmitNote: (note: string) => Promise<DeveloperReportSubmitResult>
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

function writeStorage(key: string, value: string) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    // 容量超過・プライベートモード等は無視する(下書きが残らないだけで操作は続けられる)。
  }
}

// 教室を切り替えたときは App 側が key={classroomId} で作り直すため、下書きは初期化時に読み直される
// (他教室の入力を持ち越さない)。ここで effect を使って state を書き戻さない。
export function VerificationChecklistPanel({ classroomId, classroomName, onSubmitNote }: VerificationChecklistPanelProps) {
  const storageKey = verificationChecklistStorageKey(classroomId)
  const [draft, setDraft] = useState<VerificationChecklistDraft>(() => parseVerificationChecklistDraft(readStorage(storageKey)))
  const [collapsed, setCollapsed] = useState<boolean>(() => readStorage(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY) !== 'open')
  const [sending, setSending] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  const updateDraft = useCallback((next: VerificationChecklistDraft) => {
    setDraft(next)
    writeStorage(verificationChecklistStorageKey(classroomId), serializeVerificationChecklistDraft(next))
  }, [classroomId])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      writeStorage(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY, next ? 'collapsed' : 'open')
      return next
    })
  }, [])

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
    const reportIds: string[] = []
    let failure: string | null = null
    for (const note of notes) {
      // 送信は逐次(受付番号を順番に並べる・サーバー側の連投を避ける)。
      const result = await onSubmitNote(note)
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
    setResultMessage(`送りました(${reportIds.length}通・受付番号 ${reportIds.join(', ')})。下書きはこのまま残ります。`)
  }, [draft, onSubmitNote])

  const handleCopy = useCallback(async () => {
    const markdown = buildVerificationChecklistMarkdown(draft)
    try {
      await navigator.clipboard.writeText(markdown)
      setResultMessage('Markdown をコピーしました。')
    } catch {
      setResultMessage('コピーできませんでした(ブラウザの権限)。文面は送信ボタンから送れます。')
    }
  }, [draft])

  if (collapsed) {
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

  return (
    <section className="verification-checklist-panel" aria-label="確認事項チェックリスト" data-testid="verification-checklist-panel">
      <header className="verification-checklist-header">
        <div>
          <div className="verification-checklist-title">確認リスト {VERIFICATION_CHECKLIST.version}</div>
          <div className="verification-checklist-subtitle">
            開発用教室のみ{classroomName ? `／${classroomName}` : ''}・OK {progress.ok} / 要改善 {progress.needsFix} / 未確認 {progress.remaining}
          </div>
        </div>
        <button type="button" className="verification-checklist-collapse" onClick={toggleCollapsed} aria-label="確認リストを閉じる">
          －
        </button>
      </header>

      <div className="verification-checklist-body">
        {groups.map(([area, items]) => (
          <div key={area} className="verification-checklist-group">
            <div className="verification-checklist-area">{area}</div>
            {items.map((item) => {
              const entry = getVerificationChecklistEntry(draft, item.id)
              return (
                <div key={item.id} className={`verification-checklist-item is-${entry.status}`} data-testid={`verification-checklist-item-${item.id}`}>
                  <div className="verification-checklist-item-title">
                    <span className="verification-checklist-item-id">{item.id}</span>
                    {item.title}
                  </div>
                  <ol className="verification-checklist-steps">
                    {item.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
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
                  {entry.status === 'needs-fix' || entry.memo ? (
                    <textarea
                      className="verification-checklist-memo"
                      value={entry.memo}
                      rows={2}
                      placeholder={entry.status === 'needs-fix' ? 'どう直してほしいか(必須ではないが書いてほしい)' : 'メモ'}
                      onChange={(event) => updateDraft(setVerificationChecklistEntry(draft, item.id, { memo: event.target.value }))}
                      data-testid={`verification-checklist-memo-${item.id}`}
                    />
                  ) : null}
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
}

export default VerificationChecklistPanel
