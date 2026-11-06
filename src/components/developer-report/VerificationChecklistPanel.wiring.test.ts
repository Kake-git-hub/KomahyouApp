// 確認リストパネルの配線ガード(source-scan・2026-09-12)。
//
// ⚠️ 本番データ保護: 確認リストは**開発用教室だけ**の道具で、本番教室(日大前・緑が丘・薬円台)では
// 一切マウントしてはいけない。レンダリングを isActingDevelopmentClassroom の外へ出す変更を落とすため、
// App.tsx の字面で条件付けを固定する(描画テスト環境が無いのでソース走査で担保する。
// 作法は inv02-manual-edit-persistence.matrix.test.ts / SpecialSessionScreen.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const PANEL_TSX = readFileSync(fileURLToPath(new URL('./VerificationChecklistPanel.tsx', import.meta.url)), 'utf8')

describe('確認リストパネルの配線(App.tsx)', () => {
  it('VerificationChecklistPanel を import している', () => {
    expect(APP_TSX).toContain("import { VerificationChecklistPanel } from './components/developer-report/VerificationChecklistPanel'")
  })

  it('描画は isActingDevelopmentClassroom で条件付けされている(本番教室ではマウントしない)', () => {
    const usages = [...APP_TSX.matchAll(/<VerificationChecklistPanel/gu)]
    expect(usages).toHaveLength(1)
    const index = usages[0].index ?? 0
    // 直前の条件式に isActingDevelopmentClassroom が入っていること。
    const preceding = APP_TSX.slice(Math.max(0, index - 200), index)
    expect(preceding).toMatch(/isActingDevelopmentClassroom\s*\?\s*\(\s*$/u)
  })

  it('「準備する」(2026-11-06・案 C 第 1 段): パネルへ onPrepare、コマ表へ一過性リクエストと結果の受け口を渡す', () => {
    // パネル自体が検証用教室(開発用・テスト教室)のときしかマウントされないので、onPrepare は常に渡してよい。
    const panelIndex = APP_TSX.indexOf('<VerificationChecklistPanel')
    const panelEnd = APP_TSX.indexOf('/>', panelIndex)
    expect(APP_TSX.slice(panelIndex, panelEnd)).toContain('onPrepare={handleChecklistPrepare}')
    expect(APP_TSX).toContain('checklistPrepRequest={checklistPrepRequest}')
    expect(APP_TSX).toContain('onChecklistPrepRequestProcessed={handleChecklistPrepRequestProcessed}')
    // Issue #46 同型: 処理結果を受けたら requestId で消費(null 化)する。保険タイマーも同じ消費を通す。
    expect(APP_TSX).toContain('setChecklistPrepRequest((current) => consumeChecklistPrepRequest(current, result.requestId))')
    expect(APP_TSX).toContain('const CHECKLIST_PREP_TIMEOUT_MS = 10000')
    // 押した教室をリクエストに載せる(コマ表は自分の教室と違うリクエストを処理しない・取りやめの effect より先に走っても前の教室へ置かない・要確認 1)。
    expect(APP_TSX).toContain('setChecklistPrepRequest({ requestId, itemId, classroomId: actingClassroomId, kind })')
    // 教室を切り替えた・教室データが差し替わったら、リクエストを捨てて待っている結果は失敗で返す(前の教室へ準備を置かない・INV-08)。
    expect(APP_TSX).toMatch(/useEffect\(\(\) => \{\r?\n\s+cancelChecklistPrep\(CHECKLIST_PREP_CANCELLED_MESSAGE\)\r?\n\s+\}, \[actingClassroomId, boardMountKey, cancelChecklistPrep\]\)/u)
  })

  it('「後片づけ」(2026-11-06 第 2 段・§E-2-4-2 決定 4): パネルへ onCleanup。準備と同じ待ち合わせ・保険タイマーで kind: cleanup のリクエストを立てる', () => {
    const panelIndex = APP_TSX.indexOf('<VerificationChecklistPanel')
    const panelEnd = APP_TSX.indexOf('/>', panelIndex)
    expect(APP_TSX.slice(panelIndex, panelEnd)).toContain('onCleanup={handleChecklistCleanup}')
    const cleanupStart = APP_TSX.indexOf('const handleChecklistCleanup = useCallback(')
    expect(cleanupStart).toBeGreaterThan(0)
    const cleanupBody = APP_TSX.slice(cleanupStart, APP_TSX.indexOf('}, [', cleanupStart))
    // 二重のガード(パネルは検証用教室だけ・コマ表も開いている教室で断る)。
    expect(cleanupBody).toContain('if (!isActingDevelopmentClassroom) return Promise.resolve({ ok: false, message: CHECKLIST_PREP_CLEANUP_NOT_VERIFICATION_MESSAGE })')
    expect(cleanupBody).toContain("return startChecklistPrepRequest('', 'cleanup')")
    // 準備と後片づけは同じ入口(同じ待ち合わせ・同じ保険タイマー・同じ取りやめ)。
    const startBody = APP_TSX.slice(APP_TSX.indexOf('const startChecklistPrepRequest = useCallback('), APP_TSX.indexOf('const handleChecklistPrepare = useCallback('))
    expect(startBody).toContain('}, CHECKLIST_PREP_TIMEOUT_MS)')
    expect(startBody).toContain('checklistPrepPendingRef.current = { requestId, resolve, timeoutId }')
    expect(startBody).toContain('setChecklistPrepRequest({ requestId, itemId, classroomId: actingClassroomId, kind })')
  })

  it('「準備する」(第 2 段): テンプレへ登録する項目は、確認用の生徒を名簿へ足してからリクエストを立てる(id は基本データの生徒追加と同じ作り方)', () => {
    const start = APP_TSX.indexOf('const handleChecklistPrepare = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = APP_TSX.slice(start, APP_TSX.indexOf('}, [', start))
    const needs = body.indexOf('if (checklistPrepNeedsTemplate(itemId)) {')
    const ensure = body.indexOf('ensureChecklistPrepStudents(')
    const set = body.indexOf('if (ensured.added.length > 0) setStudents(ensured.students)')
    const request = body.indexOf("return startChecklistPrepRequest(itemId, 'prep')")
    expect(needs).toBeGreaterThan(0)
    expect(ensure).toBeGreaterThan(needs)
    expect(set).toBeGreaterThan(ensure)
    expect(request).toBeGreaterThan(set)
    // 足す人数はどの曜日・時限に当たっても足りる数(Task 1 の resolveChecklistPrepStudentCount)。
    expect(body).toContain('resolveChecklistPrepStudentCount(classroomSettingsRef.current.regularLessonTemplate, studentsRef.current, CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT[itemId])')
    expect(body).toContain("createId: (taken) => createNextManagedId('student', [...taken])")
    // 二重のガードは名簿へ足す前(本番 3 校の名簿に確認用の生徒を足さない)。
    expect(body.indexOf('if (!isActingDevelopmentClassroom) return Promise.resolve(')).toBeLessThan(needs)
    // 基本データ画面の生徒追加と同じ関数(BasicDataScreen.tsx の addStudent)。
    const BASIC_TSX = readFileSync(fileURLToPath(new URL('../basic-data/BasicDataScreen.tsx', import.meta.url)), 'utf8')
    expect(BASIC_TSX).toContain("id: createNextManagedId('student', current.map((row) => row.id)),")
    expect(BASIC_TSX).toContain('export function createNextManagedId(')
  })

  it('App.tsx は CRLF のまま(-text 扱い・書き換えで LF に変わると差分が全行になる)', () => {
    expect(APP_TSX).toContain('\r\n')
    expect(APP_TSX.replace(/\r\n/gu, '')).not.toContain('\n')
  })

  it('画面分岐の外側(renderWithSubmissionAcknowledgement)に置かれ、確認通知の有無に関わらず出る', () => {
    expect(APP_TSX).toContain('const verificationChecklistPanel = isActingDevelopmentClassroom ? (')
    // 早期 return 側と通常 return 側の両方に差し込まれている(片方だけだと画面によって消える)。
    const references = [...APP_TSX.matchAll(/\{verificationChecklistPanel\}/gu)]
    expect(references.length).toBeGreaterThanOrEqual(2)
  })

  it('項目の中の見出しは「準備」「やること」「OKの目安」(第62版・オーナー指示「確認リストの日本語が難しい」)', () => {
    expect(PANEL_TSX).toContain('<span className="verification-checklist-label">準備</span>')
    expect(PANEL_TSX).toContain('<div className="verification-checklist-label">やること</div>')
    expect(PANEL_TSX).toContain('<div className="verification-checklist-label">OKの目安</div>')
    for (const old of ['>前提<', '>操作<', '>見るところ<']) expect(PANEL_TSX).not.toContain(old)
  })

  it('両教室の送信済み結果は読み取り専用の Cloud Function 経由で、今の版だけを読む(2026-11-03)', () => {
    expect(APP_TSX).toContain('loadSharedResults={loadVerificationChecklistSharedResults}')
    expect(APP_TSX).toContain('return listVerificationChecklistResultsViaFunction({ classroomId: actingClassroomId, version: VERIFICATION_CHECKLIST.version })')
    // まとめ送りのボタンは無い(オーナー指示「送信をまとめてではなく一件ごとに」)。
    expect(PANEL_TSX).not.toContain('verification-checklist-submit')
    expect(PANEL_TSX).not.toContain('保存して送信')
  })

  it('送信は既存の「要望・報告」経路(source: board / category: request)を使う', () => {
    expect(APP_TSX).toContain("return submit({ source: 'board', category: 'request', note, attachments })")
    expect(APP_TSX).toContain('submitDeveloperReportRef.current = submitDeveloperReport')
  })
})

describe('確認リストパネル本体', () => {
  it('生徒名は App が開いている教室の生徒データから差し込む(ソースに実名を置かない・2026-10-10)', () => {
    expect(APP_TSX).toContain('resolveStudentName={resolveVerificationChecklistStudentName}')
    // 2026-10-15: 見る相手(開発用教室=全項目・テスト教室=テンプレ関係だけ)は App が台帳から決めて渡し、パネルは selectVerificationChecklistItems で絞る。
    expect(APP_TSX).toContain("audience={verificationChecklistAudience ?? 'sandbox'}")
    expect(APP_TSX).toContain('const verificationChecklistAudience = useMemo(() => resolveVerificationChecklistAudience(actingClassroom), [actingClassroom])')
    expect(PANEL_TSX).toContain('const items = useMemo(() => selectVerificationChecklistItems(audience), [audience])')
    expect(PANEL_TSX).toContain('countVerificationChecklistProgress(draft, items)')
    // 2026-11-03: 送信は項目ごと(1 項目 = 1 通)。見る相手の項目一覧で本文を作る。
    expect(PANEL_TSX).toContain('buildVerificationChecklistItemReportNote(draft, itemId, { items })')
    expect(PANEL_TSX).toContain('buildVerificationChecklistMarkdown(draft, items)')
    expect(APP_TSX).toContain('const student = students.find((row) => row.id === studentId)')
    expect(PANEL_TSX).toContain('resolveVerificationChecklistText')
    expect(PANEL_TSX).toContain('resolveStudentName')
    for (const field of ['item.title', 'item.prep', 'step', 'line']) expect(PANEL_TSX).toContain(`{text(${field})}`)
  })

  it('下書きは localStorage、送信は props 経由(独自の保存先・直送を作らない)', () => {
    expect(PANEL_TSX).toContain('window.localStorage')
    expect(PANEL_TSX).not.toMatch(/\bfetch\(/u)
    expect(PANEL_TSX).not.toContain('firebase')
  })

  it('別タブ表示は同じパネルを createPortal で描くだけ(状態・送信経路を別タブ用に作らない・2026-10-14)', () => {
    expect(PANEL_TSX).toContain("import { createPortal } from 'react-dom'")
    expect(PANEL_TSX).toContain('createPortal(panel, detached.root)')
    expect(PANEL_TSX).toContain("from './verificationChecklistWindow'")
    // 元のタブが閉じる/再読み込みするときは別タブも閉じる(取り残された別タブの入力は届かない)。
    expect(PANEL_TSX).toContain("window.addEventListener('pagehide', closeWindow)")
  })

  it('書式・下書き・進捗の計算は純関数モジュールへ委譲している', () => {
    expect(PANEL_TSX).toContain("from '../../utils/verificationChecklist'")
    expect(PANEL_TSX).toContain('buildVerificationChecklistItemReportNote')
    expect(PANEL_TSX).toContain('markVerificationChecklistItemSent')
    expect(PANEL_TSX).toContain('resolveVerificationChecklistItemSendState')
    expect(PANEL_TSX).toContain('countVerificationChecklistProgress')
    // どの教室で確認済みか(2026-11-03)の集約は純関数。
    expect(PANEL_TSX).toContain('summarizeChecklistResultsByClassroom(reports, { currentClassroomId: classroomId })')
  })

  it('メモ欄は結果(要改善)に関わらず常に描画し、入力は setVerificationChecklistMemo を通す(2026-09-13)', () => {
    expect(PANEL_TSX).not.toContain("entry.status === 'needs-fix' || entry.memo ? (")
    expect(PANEL_TSX).toContain('updateDraft(setVerificationChecklistMemo(draft, item.id, event.target.value))')
  })
})

// 2026-11-03 オーナー指示(確認リスト その他欄)「画像を追加(スクショ)しかなくなり、タブを選んで撮影ができなくなっている」。
describe('確認リストの「画面を撮る」(タブを選んで撮る)', () => {
  it('App はタブを選べるブラウザのときだけ captureBrowserTabFromView を渡す', () => {
    expect(APP_TSX).toContain("onCaptureTab={canCaptureBrowserTab(typeof navigator !== 'undefined' ? navigator.mediaDevices : null) ? captureBrowserTabFromView : undefined}\r\n      />\r\n    ) : null")
  })

  it('項目ごとに「画面を撮る」を出し、押したタブ(ownerDocument.defaultView)から撮って項目へ付ける', () => {
    expect(PANEL_TSX).toContain('onClick={(event) => { void captureTabForItem(item.id, event.currentTarget.ownerDocument.defaultView ?? window) }}')
    expect(PANEL_TSX).toContain("{capturingItemId === item.id ? '撮影中…' : '画面を撮る'}")
    expect(PANEL_TSX).toContain('addVerificationChecklistAttachment(current, { itemId, name: shot.name, dataUrl: shot.dataUrl }, createChecklistAttachmentId())')
  })
})
