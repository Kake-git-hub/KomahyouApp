// 「質問・要望」の別タブ(2026-10-29 オーナー指示「質問・要望ボタンのページは別タブで開くようにして。
// AI 回答を見ながら画面操作する可能性があるので」・全教室)の App 配線ガード(source-scan)。
// App は巨大で描画テストが無いので、落としやすい配線を字面で固定する(開閉の挙動そのものは useDeveloperReportWindow.test.ts)。
//  - 盤面の「質問・要望」ボタンは useDeveloperReportWindow の open(別タブを開く・開けなければモーダル)。
//  - 中身は別タブへ createPortal し、別タブで開いているときは盤面のモーダルを出さない(二重に出さない)。
//  - どの画面も renderScreen 経由で、別タブの中身を同じ位置に置く(基本データ等へ移っても入力・回答が消えない)。
//  - 教室切替・ログアウトで閉じる(resetKey に教室とユーザーを入れる・INV-08)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const APP_TSX = read('../../App.tsx')

describe('質問・要望の別タブ: App の配線', () => {
  it('盤面のボタンは useDeveloperReportWindow の open。教室とユーザーが変わったら閉じる(resetKey・INV-08)', () => {
    expect(APP_TSX).toContain("import { useDeveloperReportWindow } from './components/developer-report/useDeveloperReportWindow'")
    expect(APP_TSX).toContain("const developerReport = useDeveloperReportWindow({ classroomName: actingClassroom?.name ?? '', resetKey: `${actingClassroomId ?? ''}|${currentUserId}` })")
    expect(APP_TSX).toContain('onReportToDeveloper={developerReport.open}')
    // 旧来の「押したら盤面のモーダル」の状態は残っていない(開閉の権威はフック 1 つ)。
    expect(APP_TSX).not.toContain('setDeveloperReportModal')
  })

  it('中身は別タブへ createPortal し、別タブで開いているときは盤面のモーダルを出さない', () => {
    expect(APP_TSX).toContain("import { createPortal } from 'react-dom'")
    expect(APP_TSX).toContain("presentation={developerReport.target ? 'window' : 'modal'}")
    expect(APP_TSX).toContain('windowBlocked={developerReport.session.windowBlocked}')
    expect(APP_TSX).toContain('const developerReportWindowPortal = developerReportContent && developerReport.target ? createPortal(developerReportContent, developerReport.target.root) : null')
    expect(APP_TSX).toContain('{developerReport.target ? null : developerReportContent}')
    // 送信は従来の 1 本(submitDeveloperReport・source board)。結果は送った回にだけ出す(runSubmit)。
    expect(APP_TSX).toContain("await runDeveloperReportSubmit(async () => formatDeveloperReportResultMessage(await submitDeveloperReport({ source: 'board', category, note, ...(attachments.length > 0 ? { attachments } : {}) })))")
    // 「画面を撮る」は元のタブ(盤面)を写す既存の関数のまま。
    expect(APP_TSX).toContain('onCaptureScreen={captureScreenToDataUrl}')
  })

  it('どの画面も renderScreen 経由で、別タブの中身を確認リストの直後(同じ位置)に置く', () => {
    expect(APP_TSX).toContain('const renderScreen = (content: ReactNode) => renderWithSubmissionAcknowledgement(content, developerReportWindowPortal)')
    expect(APP_TSX).not.toContain('return renderWithSubmissionAcknowledgement(')
    expect(APP_TSX.split('return renderScreen(').length - 1).toBeGreaterThanOrEqual(11)
    // 通知が無いとき・あるときの 2 つの形で、別タブの中身は 3 番目(確認リストの直後)＝画面を移っても描き直しにならない。
    expect(APP_TSX).toContain('return <>{suspendedContent}{verificationChecklistPanel}{detachedOverlay}</>')
    expect(APP_TSX).toContain('        {verificationChecklistPanel}\r\n        {detachedOverlay}\r\n        {staleConflictBanner}')
  })
})
