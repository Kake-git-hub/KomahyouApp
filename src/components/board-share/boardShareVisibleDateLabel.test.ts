import { describe, expect, it } from 'vitest'
import { getVisibleDateLabel } from './BoardShareScreen'

// 配布用盤面の日付ラベル。盤面(lessonLinks.ts resolveVisibleSlotDateLabel)と同じ規則で moved を解決することを固定する。
// 確認リスト v1.5.555 その他欄(2026-09-22)「振替をさらに別日へ動かすと元の授業の振替先日が追いつかない」の兄弟監査:
// 盤面だけ直して配布用盤面が古い B を出し続けると、同じ記録が盤面では C・配布では B になる(INV-04 準拠の内容乖離)。
describe('配布用盤面 getVisibleDateLabel: 移動元マーカーの日付', () => {
  const cell = { dateKey: '2026-04-01' }
  const movedStatus = { status: 'moved' as const, moveDestinationDateKey: '2026-04-15' }
  const movedStudent = { lessonType: 'regular' as const, makeupSourceDate: undefined }

  it('A→B→C と動かしたら、リンク先(今置かれている C)を出す', () => {
    expect(getVisibleDateLabel(movedStudent, movedStatus, cell, '2026-04-20')).toBe('4/20')
  })

  it('リンクが引けないときは自分の移動先 B を出す(従来どおり)', () => {
    expect(getVisibleDateLabel(movedStudent, movedStatus, cell, undefined)).toBe('4/15')
  })

  it('移動先日付を持たない古い moved 記録はリンク先があっても空(盤面と同じ回帰防止)', () => {
    expect(getVisibleDateLabel(movedStudent, { status: 'moved', moveDestinationDateKey: undefined }, cell, '2026-04-20')).toBe('')
  })

  it('moved 以外の記録(休み)はリンク先を出し、振替コマは自分の振替元を出す(既存挙動の維持)', () => {
    expect(getVisibleDateLabel(movedStudent, { status: 'absent', moveDestinationDateKey: undefined }, cell, '2026-04-20')).toBe('4/20')
    expect(getVisibleDateLabel({ lessonType: 'makeup', makeupSourceDate: '2026-03-25' }, null, cell)).toBe('3/25')
    expect(getVisibleDateLabel(null, null, cell, '2026-04-20')).toBe('')
  })
})
