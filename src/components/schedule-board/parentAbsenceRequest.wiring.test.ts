// 保護者からの休み連絡の自動処理(docs/spec-parent-portal.md §0-5)の配線ガード(source-scan)。
//
// 盤面の出欠処理は巨大コンポーネントのクロージャなので描画テストができない。落とすと事故になる配線を字面で固定する:
// - メニューの「休み / 振無休」と保護者連絡の自動処理が**同じ 1 本の処理**を通ること(会計 INV-06 の経路を分散させない)。
// - 一過性コマンドは成功でも失敗でも必ず結果を返すこと(返さないと App 側が消費できず、再マウントで再発火する・Issue #46 同型)。
// - テンプレ編集中は出欠を書き込まないこと。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

function sliceFrom(marker: string, length: number): string {
  const index = BOARD_TSX.indexOf(marker)
  expect(index, `marker not found: ${marker}`).toBeGreaterThan(0)
  return BOARD_TSX.slice(index, index + length)
}

describe('保護者からの休み連絡の自動処理(ScheduleBoardScreen.tsx)', () => {
  it('メニューの「休み」「振無休」は席を渡して共通の本体を呼ぶだけ(別実装を持たない)', () => {
    const absent = sliceFrom('const handleMarkStudentAbsent = () => {', 200)
    expect(absent).toContain('if (!studentMenu || !menuStudent) return')
    expect(absent).toContain('markStudentAbsentAt(studentMenu)')
    const noMakeup = sliceFrom('const handleMarkStudentAbsentNoMakeup = () => {', 200)
    expect(noMakeup).toContain('if (!studentMenu || !menuStudent) return')
    expect(noMakeup).toContain('markStudentAbsentNoMakeupAt(studentMenu)')
    // 本体は 1 つずつ。
    expect([...BOARD_TSX.matchAll(/const markStudentAbsentAt = /gu)]).toHaveLength(1)
    expect([...BOARD_TSX.matchAll(/const markStudentAbsentNoMakeupAt = /gu)]).toHaveLength(1)
  })

  it('共通の本体はメニュー state(studentMenu)を読まず、引数の席だけを使う', () => {
    const start = BOARD_TSX.indexOf('const markStudentAbsentAt = ')
    const end = BOARD_TSX.indexOf('const handleMarkStudentAbsent = () => {')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(BOARD_TSX.slice(start, end)).not.toContain('studentMenu')
    const noMakeupStart = BOARD_TSX.indexOf('const markStudentAbsentNoMakeupAt = ')
    const noMakeupEnd = BOARD_TSX.indexOf('const handleMarkStudentAbsentNoMakeup = () => {')
    expect(BOARD_TSX.slice(noMakeupStart, noMakeupEnd)).not.toContain('studentMenu')
  })

  it('自動処理は席を純関数で探し、メニューと同じ本体を呼ぶ。失敗の分岐もすべて finish で結果を返す', () => {
    const effect = sliceFrom('if (!shouldProcessParentAbsenceRequest(parentAbsenceRequest, processedParentAbsenceRequestIdRef.current)) return', 3200)
    expect(effect).toContain('resolveParentAbsenceTarget({')
    expect(effect).toContain('markStudentAbsentNoMakeupAt(resolution.target)')
    expect(effect).toContain('markStudentAbsentAt(resolution.target)')
    // finish = 重複ガードを立てて App へ結果を返す(App はここで一過性 state を消費する)。
    expect(effect).toContain('processedParentAbsenceRequestIdRef.current = request.requestId')
    expect(effect).toContain('onParentAbsenceRequestProcessed?.({ requestId: request.requestId, messageId: request.messageId, action: request.action, studentId: request.studentId, dateKey: request.dateKey, slotNumber: request.slotNumber, ok, message })')
    // 早期 return は「週のジャンプ待ち」の 1 か所を除き、必ず直前の行で finish を呼んでいる(結果を返さない抜け道を作らない)。
    const bodyEnd = effect.indexOf('}, [isTemplateMode, onParentAbsenceRequestProcessed, parentAbsenceRequest, students, weekIndex, weeks])')
    expect(bodyEnd).toBeGreaterThan(0)
    const lines = effect.slice(0, bodyEnd).split(/\r?\n/u)
    const returnsWithoutFinish = lines
      .map((line, index) => ({ line: line.trim(), previous: (lines[index - 1] ?? '').trim() }))
      .filter(({ line }) => line === 'return')
      .filter(({ previous }) => !previous.startsWith('finish('))
    // 唯一の例外は週のジャンプ待ち。移れたときだけ結果を返さずに次のレンダーへ回し、移れなければその場で失敗を返す
    // (返さないと state が何も変わらず effect が再実行されないので、App の保険タイマーまで「処理中…」のままになる)。
    expect(returnsWithoutFinish.map(({ previous }) => previous)).toEqual(['if (!jumpToWeekByDate(request.dateKey)) finish(false, PARENT_ABSENCE_TARGET_NOT_FOUND_MESSAGE)'])
    // 成功の経路も最後に finish(true) で返す。
    expect(effect.slice(0, bodyEnd)).toContain("finish(true, '')")
  })

  it('テンプレ編集中は処理せず失敗で返す(テンプレ用の cells に出欠を書き込まない)', () => {
    const effect = sliceFrom('if (!shouldProcessParentAbsenceRequest(parentAbsenceRequest, processedParentAbsenceRequestIdRef.current)) return', 1200)
    const templateIndex = effect.indexOf('if (isTemplateMode) {')
    const resolveIndex = effect.indexOf('const activeWeekCells')
    expect(templateIndex).toBeGreaterThan(0)
    expect(resolveIndex).toBeGreaterThan(templateIndex)
  })

  it('対象日の週が表示中でなければジャンプして次のレンダーで続ける。ジャンプ済みでも無ければ失敗で返す(無限に待たない)', () => {
    const effect = sliceFrom('const activeWeekCells = weeks[weekIndex] ?? []', 900)
    expect(effect).toContain('if (parentAbsenceJumpedRequestIdRef.current === request.requestId) {')
    expect(effect).toContain('parentAbsenceJumpedRequestIdRef.current = request.requestId')
    expect(effect).toContain('if (!jumpToWeekByDate(request.dateKey)) finish(false, PARENT_ABSENCE_TARGET_NOT_FOUND_MESSAGE)')
    // jumpToWeekByDate は移れたかを真偽で返す(早期 return は false)。
    const jump = sliceFrom('const jumpToWeekByDate = (dateKey: string): boolean => {', 1600)
    expect(jump).toContain('if (!dateKey) return false')
    expect(jump).toContain('if (!nextWeek?.length) return false')
    expect(jump).toContain('return true')
  })

  // オーナー確定(2026-09-18): 「振替先を今決める」= 休みにして未消化振替へ戻してから配置モードへ。途中でやめても休みは残る。
  it('「振替先を今決める」は休みの本体を通したあと、その振替元日付を選んだ状態で既存の振替配置モードへ入る', () => {
    const effect = sliceFrom("if (request.action === 'makeup-now' && applied.makeupStock) {", 200)
    expect(effect).toContain('setPendingParentMakeupPlacement(applied.makeupStock)')
    // 休みの本体は振替元を「日付＋時限」で返す(素の日付だけだと同日同科目 2 コマで別コマを指す・INV-06/INV-11)。
    const absentBody = sliceFrom('const markStudentAbsentAt = ', 9000)
    expect(absentBody).toContain('originSlotNumber: resolveOriginalRegularSlotNumber(targetStudent, targetCell.slotNumber),')
    const placement = sliceFrom('if (!pendingParentMakeupPlacement) return', 1500)
    // 入るかどうか・どの振替元を選ぶかは純関数 resolveParentMakeupPlacement(その科目の在庫行の残数＋在庫行自身の値で作るトークン)で決める。
    // 振る舞いは parentMakeupPlacement.test.ts が固定している。ここは「その結果をそのまま既存の配置モードへ渡している」ことだけを見る。
    expect(placement).toContain('resolveParentMakeupPlacement({')
    expect(placement).toContain('rawEntries: rawMakeupStockEntries,')
    expect(placement).toContain('originSlotNumber: pendingParentMakeupPlacement.originSlotNumber,')
    expect(placement).toContain('handleSelectMakeupStockEntry(placement.entry, {')
    expect(placement).toContain('hidePanelsDuringPlacement: true')
    expect(placement).toContain('rawKey: placement.rawKey')
    expect(placement).toContain('originDate: placement.originToken')
    // 残数が無い(先取りの相殺)ときは配置モードに入らず、終了を App へ知らせる(モーダルを開き直させる)。
    expect(placement).toContain('if (!placement) {')
    expect(placement).toContain('onParentAbsencePlacementSettled?.()')
  })

  // 表示データは盤面へのコマンド用に studentId を持つが、DOM には出さない(旧テストの「内部 ID を表示データに持ち込まない」の代替)。
  it('モーダルは内部 ID(studentId)を描画に使わない', () => {
    const MODAL_TSX = readFileSync(fileURLToPath(new URL('../parent-portal/ParentMessagesModal.tsx', import.meta.url)), 'utf8')
    expect(MODAL_TSX).not.toContain('studentId')
    expect(MODAL_TSX).not.toContain('classroomId')
  })

  it('配置モードの終了は「選択が実際に立ったあとで null に戻った」ときだけ知らせる(setState 反映前の誤判定を防ぐ)', () => {
    const effect = sliceFrom('if (!parentAbsencePlacementActiveRef.current) return', 500)
    expect(effect).toContain('parentAbsencePlacementSelectedSeenRef.current = true')
    expect(effect).toContain('if (!parentAbsencePlacementSelectedSeenRef.current) return')
    expect(effect).toContain('onParentAbsencePlacementSettled?.()')
  })
})
