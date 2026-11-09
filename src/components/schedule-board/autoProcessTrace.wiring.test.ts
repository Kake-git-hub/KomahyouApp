// 自動処理を操作痕跡に残す配線(2026-11-09・オーナー「室長から『並べたとおりになっていない』と言われる」の理由を後から追う)。
//
// 記録する 4 か所(spec-developer-report §D-3):
//   - 再反映の effect(基本データ・テンプレの変更で setWeeks の関数更新を当てる) … 「再反映(基本データ・テンプレの変更)」
//   - マウント時の再反映(createInitialBoardSnapshot が保存版から作り直した差)        … 「盤面を開いたときの再反映」
//     (教室の読み込み・ほかの画面から戻ったとき。基本データの変更はほぼこちらに出る＝盤面は board 画面でだけ描かれ、戻ると作り直される)
//   - 起動時の自己修復(reconcileSubmittedTeacherPlacements)                          … 「起動時の自己修復(QR 提出の講師)」
//   - QR 提出の反映(App の購読が講師の自動配置を頼み、盤面が置いた差)                 … 「QR 提出の反映」
//
// 守ること:
//   - INV-02: 記録は盤面を変えない。再反映の関数更新の結果は今までと同じ(下の純関数のテストで固定)。
//   - INV-03: 1 回の処理は 1 回だけ記録する。setWeeks の関数更新の中では記録しない(StrictMode は関数更新を 2 回呼ぶ)。
//     マウント時の記録は ref で 1 回だけ・再反映の effect は同じ入力で 2 回走っても(StrictMode の effect の二重実行)1 回だけ。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { SlotCell } from './types'
import { buildManagedScheduleCellsForRange, buildRemergeWeeksUpdater, createInitialBoardSnapshot, isSameRemergeTraceInputs, remergeBoardWeeksWithManagedData } from './ScheduleBoardScreen'
import { summarizeWeeksDiff } from '../../utils/operationTrace'
import type { PersistedBoardState } from '../../types/appState'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8').replace(/\r\n/gu, '\n')
const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8').replace(/\r\n/gu, '\n')

/** `start` の位置の開き括弧に対応する閉じ括弧までを返す(文字列・テンプレートリテラルの中の括弧は数えない簡易版)。 */
function sliceBalanced(source: string, openIndex: number): string {
  let depth = 0
  let quote: string | null = null
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') { index += 1; continue }
      if (char === quote) quote = null
      continue
    }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, index + 1)
    }
  }
  throw new Error('括弧が閉じていない')
}

/** 名前の付いた useEffect の本体(コメントの目印から次の `}, [` まで)を返す。 */
function sliceFrom(source: string, marker: string, length = 4000): string {
  const start = source.indexOf(marker)
  expect(start, marker).toBeGreaterThan(-1)
  return source.slice(start, start + length)
}

describe('自動処理の操作痕跡: 4 か所が recordAutoBoardChange を呼ぶ', () => {
  it('再反映の effect・盤面を開いたときの再反映・起動時の自己修復・QR 提出の反映', () => {
    expect(BOARD_TSX).toContain("import { recordAutoBoardChange, recordOperationTrace, summarizeBoardCommitForTrace, summarizeWeeksDiff } from '../../utils/operationTrace'")
    expect(BOARD_TSX).toContain("recordAutoBoardChange('board-rebuild', '再反映(基本データ・テンプレの変更)', baseWeeks, remergedWeeks)")
    expect(BOARD_TSX).toContain("recordAutoBoardChange('board-rebuild', '盤面を開いたときの再反映', savedWeeks, initialWeeks)")
    expect(BOARD_TSX).toContain("recordAutoBoardChange('auto', '起動時の自己修復(QR 提出の講師)', weeks, result.nextWeeks)")
    expect(BOARD_TSX).toContain("recordAutoBoardChange('auto', 'QR 提出の反映', weeks, result.nextWeeks)")
  })

  it('setWeeks の関数更新の中では記録しない(StrictMode の二重実行で二重記録にしない・INV-03)', () => {
    const updaters: string[] = []
    let from = 0
    for (;;) {
      const at = BOARD_TSX.indexOf('setWeeks((', from)
      if (at < 0) break
      updaters.push(sliceBalanced(BOARD_TSX, at + 'setWeeks'.length))
      from = at + 1
    }
    for (const updater of updaters) {
      expect(updater).not.toContain('recordOperationTrace')
      expect(updater).not.toContain('recordAutoBoardChange')
    }
    // 再反映の関数更新を作る純関数の中にも記録は無い。
    const builder = sliceFrom(BOARD_TSX, 'export function buildRemergeWeeksUpdater(', 1200)
    const builderBody = builder.slice(0, builder.indexOf('\n}\n'))
    expect(builderBody).not.toContain('recordOperationTrace')
    expect(builderBody).not.toContain('recordAutoBoardChange')
  })

  it('再反映の effect: 今の盤面から 1 回だけ作り、同じ入力の 2 回目(StrictMode の effect の二重実行)は記録しない。setWeeks は関数更新のまま', () => {
    const effect = sliceFrom(BOARD_TSX, "bumpMemCounter('overlay-recompute')", 3000)
    const body = effect.slice(0, effect.indexOf('}, [classroomSettings, teachers, students, regularLessons, suppressedRegularLessonOccurrences, templateDiffApplyEnabled])'))
    expect(body).toContain('const baseWeeks = weeksRef.current')
    expect(body).toContain('const remerge = (currentWeeks: SlotCell[][]) => remergeBoardWeeksWithManagedData(currentWeeks, remergeParams)')
    expect(body).toContain('const remergedWeeks = remerge(baseWeeks)')
    expect(body).toContain('if (!isSameRemergeTraceInputs(lastRemergeTraceInputsRef.current, traceInputs)) {')
    expect(body).toContain('setWeeks(buildRemergeWeeksUpdater(baseWeeks, remergedWeeks, remerge))')
    // 記録は setWeeks より前(effect の本体)で済ませる。
    expect(body.indexOf("recordAutoBoardChange('board-rebuild'")).toBeLessThan(body.indexOf('setWeeks('))
    // 依存は今までと同じ(記録のために再反映を余分に走らせない)。
    expect(BOARD_TSX).toContain('}, [classroomSettings, teachers, students, regularLessons, suppressedRegularLessonOccurrences, templateDiffApplyEnabled])')
    // 退塾の掃除と同じ流れで作った盤面を土台にする 3746fda3 の注意書き(関数更新で最新 weeks に当てる)は残す。
    expect(body).toContain('退塾ボタン/編集での退塾日入力はどちらも students を更新するので、この effect でその場に盤面へ反映される。')
  })

  it('weeksRef は描画ごとに今の盤面を指す(effect の本体で読む今の盤面)', () => {
    expect(BOARD_TSX).toContain('const weeksRef = useRef(weeks)\n  weeksRef.current = weeks')
  })

  it('盤面を開いたときの再反映: マウントで 1 回だけ(ref)・保存版が無い(初期の盤面)ときは残さない', () => {
    const effect = sliceFrom(BOARD_TSX, 'if (didTraceInitialRemergeRef.current) return', 900)
    expect(effect).toContain('didTraceInitialRemergeRef.current = true')
    expect(effect).toContain('const savedWeeks = initialSavedWeeksRef.current')
    expect(effect).toContain('if (!savedWeeks?.length) return')
    expect(effect).toContain('const initialWeeks = initialBoardSnapshotRef.current?.weeks')
    // 保存版は createInitialBoardSnapshot に渡したものと同じ(最初の描画の initialBoardState.weeks)。
    expect(BOARD_TSX).toContain('const initialSavedWeeksRef = useRef<SlotCell[][] | null>(initialBoardState?.weeks ?? null)')
  })

  it('起動時の自己修復: ref で 1 回だけの effect の中・盤面を変えたときだけ', () => {
    const effect = sliceFrom(BOARD_TSX, 'if (didReconcileSubmittedTeachersRef.current) return', 2000)
    const changed = effect.slice(effect.indexOf('if (result.hasChanges) {'))
    expect(changed).toContain("recordOperationEvent('auto-teacher-reconcile'")
    expect(changed).toContain("recordAutoBoardChange('auto', '起動時の自己修復(QR 提出の講師)', weeks, result.nextWeeks)")
  })

  it('QR 提出の反映: App の購読が作る講師の自動配置の頼みに source を付け、盤面はその頼みで机を変えたときだけ残す(室長の手の「登録」は残さない)', () => {
    const submission = sliceFrom(APP_TSX, 'const submissionTeacherRequest: TeacherAutoAssignRequest = {', 300)
    expect(submission).toContain("source: 'qr-submission',")
    const manual = sliceFrom(APP_TSX, 'const teacherRequest: TeacherAutoAssignRequest = {', 400)
    expect(manual.slice(0, manual.indexOf('}]'))).not.toContain('source')
    expect(APP_TSX).toContain("source?: 'qr-submission'")
    const effect = sliceFrom(BOARD_TSX, 'const result = applyTeacherAutoAssignRequest({', 1500)
    const changed = effect.slice(effect.indexOf('if (result.hasChanges) {'))
    expect(changed).toContain("if (request.source === 'qr-submission') recordAutoBoardChange('auto', 'QR 提出の反映', weeks, result.nextWeeks)")
  })
})

describe('再反映の関数更新は今までと同じ盤面を返す(INV-02)', () => {
  const DATE = '2026-10-07'
  const students: StudentRow[] = [{ id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const teachers: TeacherRow[] = [{ id: 't1', name: '田中', email: 't1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }]
  const row = (slotNumber: number): RegularLessonRow => ({ id: 'r0', schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber })
  const classroomSettings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: DATE } as unknown as ClassroomSettings
  const savedWeek = buildManagedScheduleCellsForRange({ range: { startDate: '2026-10-05', endDate: '2026-10-11', periodValue: '', personId: '' }, fallbackStartDate: '2026-10-05', fallbackEndDate: '2026-10-11', classroomSettings, teachers, students, regularLessons: [row(5)], boardWeeks: [] })
  // 基本データで時限を 5 → 3 へ変えた後の再反映。
  const params = { classroomSettings, teachers, students, regularLessons: [row(3)], suppressedRegularLessonOccurrences: [], todayKey: '2026-09-29', templateOriginRules: null }
  const remerge = (weeks: SlotCell[][]) => remergeBoardWeeksWithManagedData(weeks, params)

  it('effect の時点の盤面のままなら、先に作った結果をそのまま返す(計算は 1 回・中身は関数更新で作るのと同じ)', () => {
    const base: SlotCell[][] = [savedWeek]
    const precomputed = remerge(base)
    const updater = buildRemergeWeeksUpdater(base, precomputed, remerge)
    const result = updater(base)
    expect(result).toBe(precomputed)
    expect(result).toEqual(remerge(base))
    // StrictMode が 2 回呼んでも同じ。
    expect(updater(base)).toBe(precomputed)
  })

  it('effect の後に盤面が変わっていた(待ちの更新がある)ら、今までどおりその盤面から作り直す', () => {
    const base: SlotCell[][] = [savedWeek]
    const precomputed = remerge(base)
    const pending: SlotCell[][] = [savedWeek.map((cell) => ({ ...cell, desks: cell.desks.map((desk) => ({ ...desk })) }))]
    let calls = 0
    const updater = buildRemergeWeeksUpdater(base, precomputed, (weeks) => {
      calls += 1
      return remerge(weeks)
    })
    const result = updater(pending)
    expect(calls).toBe(1)
    expect(result).not.toBe(precomputed)
    expect(result).toEqual(remerge(pending))
  })

  // 修正ラウンド 1(レビュー Minor-5 b): 再反映済みの盤面を保存版として開き直しても差は空＝普通に開いただけでは「盤面を開いたときの再反映」の行は出ない。
  it('再反映済みの盤面を保存版として createInitialBoardSnapshot に通すと机の差は空(開いただけでは記録の行が出ない)', () => {
    const changed = remerge([savedWeek])
    // 前提: 時限を変えた再反映は机を変える(差が空でない)。
    expect(summarizeWeeksDiff([savedWeek], changed)).not.toBe('')
    for (const applyTemplateOriginRules of [false, true]) {
      const reopened = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: [row(3)], initialBoardState: { weeks: changed } as unknown as PersistedBoardState, applyTemplateOriginRules })
      expect(summarizeWeeksDiff(changed, reopened.weeks), String(applyTemplateOriginRules)).toBe('')
      // もう一度開いても同じ(不動点)。
      const again = createInitialBoardSnapshot({ classroomSettings, teachers, students, regularLessons: [row(3)], initialBoardState: { weeks: reopened.weeks } as unknown as PersistedBoardState, applyTemplateOriginRules })
      expect(summarizeWeeksDiff(reopened.weeks, again.weeks), String(applyTemplateOriginRules)).toBe('')
    }
  })

  it('同じ入力かどうか(StrictMode の effect の二重実行で 2 回記録しない)', () => {
    const a = [classroomSettings, teachers, students]
    expect(isSameRemergeTraceInputs(null, a)).toBe(false)
    expect(isSameRemergeTraceInputs(a, [...a])).toBe(true)
    expect(isSameRemergeTraceInputs(a, [classroomSettings, teachers, [...students]])).toBe(false)
    expect(isSameRemergeTraceInputs(a, [classroomSettings, teachers])).toBe(false)
  })
})
