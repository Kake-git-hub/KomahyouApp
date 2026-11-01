// テンプレ保存のあとに「元に戻す／やり直し」の履歴を空にする配線（オーナー指示 2026-11-01「テンプレ保存後の元に戻すの巻き戻し範囲を調べる」）。
//
// ★なぜ要るか: テンプレ保存(差分反映・旧方式の上書きとも)は盤面の履歴(undoStack)に自分の項目を積まない。そのため保存後に「元に戻す」を押すと
//   保存の 1 つ前の手操作の項目が当たり、テンプレ保存の結果とその手操作がまとめて巻き戻っていた(テスト教室 2026-10-31 の操作痕跡:
//   手で置いた講習とテンプレで足した生徒が 1 回の「元に戻す」で一度に消えた)。テンプレ保存はテンプレ定義も変えるので盤面だけ戻すと再マージで
//   食い違う。保存後は履歴を空にし、戻したいときはテンプレを直して保存し直す運用にする。
// このテストは ScheduleBoardScreen.tsx の 2 つの保存経路(差分反映／旧方式)の盤面更新の直前で履歴を空にしている配線を固定する。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'ScheduleBoardScreen.tsx'), 'utf8')

function sliceBody(start: string, end: string) {
  const startIndex = source.indexOf(start)
  expect(startIndex, start).toBeGreaterThanOrEqual(0)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(endIndex, end).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('テンプレ保存後は盤面の「元に戻す／やり直し」の履歴を空にする（2026-11-01）', () => {
  it('差分反映の保存: 盤面を差し替える直前に undo / redo の履歴を空にする', () => {
    const body = sliceBody('const nextWeeks = plan.diff.nextWeeks', 'setWeeks(nextWeeks)')
    expect(body).toContain('setUndoStack([])')
    expect(body).toContain('setRedoStack([])')
  })

  it('旧方式(反映日以降を作り直す)の保存: 盤面を差し替える直前に undo / redo の履歴を空にする', () => {
    const marker = 'setWeeks(overlaidWeeks)'
    const index = source.indexOf(marker)
    expect(index).toBeGreaterThan(0)
    const before = source.slice(Math.max(0, index - 1200), index)
    expect(before).toContain('setUndoStack([])')
    expect(before).toContain('setRedoStack([])')
  })

  it('テンプレ保存の経路は履歴に自分の項目を積まない(積むなら「空にする」をやめて部分的な戻しを設計し直すこと)', () => {
    const diffBody = sliceBody('const nextWeeks = plan.diff.nextWeeks', "recordOperationTrace('board-rebuild'")
    expect(diffBody).not.toContain('appendHistoryEntry(')
  })
})
