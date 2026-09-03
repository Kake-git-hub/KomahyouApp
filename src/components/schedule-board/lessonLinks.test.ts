import { describe, expect, it } from 'vitest'

import { buildLinkedLessonDestinationMap, resolveVisibleSlotDateLabel } from './lessonLinks'
import type { LessonType, StudentStatusKind } from './types'

// 緑が丘 室長報告(2026-09-04)「休みの振替を他の日に入れて出席にしたら、元コマの振替日が消える」の回帰防止。
// 振替コマを出席/振無休にすると studentSlots → statusSlots へ移るため、振替先の収集が配置(studentSlots)だけだと
// 元コマの「休」に添える振替先日付(リンク)が出席の瞬間に消えていた。在庫会計(collectMakeupUsageByKey)は出席済み
// 振替を消化として数えるので、表示だけが欠ける非対称だった。本番実データ(9/3 時点)で出席済み振替 13 件が全件リンク無し。
describe('buildLinkedLessonDestinationMap 出席済み振替への振替先リンク', () => {
  const absentStatus = {
    id: 'status-absent',
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'regular' as LessonType,
    status: 'absent' as StudentStatusKind,
  }
  const makeupOf = (status: StudentStatusKind, id = `status-${status}`) => ({
    id,
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'makeup' as LessonType,
    makeupSourceDate: '2026-04-01',
    makeupSourceLabel: '2026/4/1(水) 1限',
    status,
  })
  const placedMakeup = {
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'makeup' as LessonType,
    makeupSourceDate: '2026-04-01',
    makeupSourceLabel: '2026/4/1(水) 1限',
  }
  const originCell = { dateKey: '2026-04-01', slotNumber: 1, desks: [{ statusSlots: [absentStatus, null] }] }

  it('振替コマを出席にしても、元コマの休みから振替先へのリンクが維持される', () => {
    const cells = [
      originCell,
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('attended'), null] }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-absent')).toEqual({ dateKey: '2026-04-08', slotNumber: 2 })
  })

  it('振替コマを振無休にした場合も(消化済みなので)リンクを維持する', () => {
    const cells = [
      originCell,
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('absent-no-makeup'), null] }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-absent')).toEqual({ dateKey: '2026-04-08', slotNumber: 2 })
  })

  it('休みにした振替コマ・移動マーカーはリンク先にならず、実際に置かれているコマへリンクする', () => {
    const cells = [
      originCell,
      // 4/8 の振替は休み(在庫へ戻った)、4/10 は移動マーカー(会計は移動先が持つ)。どちらも振替先ではない。
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('absent'), null] }] },
      { dateKey: '2026-04-10', slotNumber: 3, desks: [{ statusSlots: [makeupOf('moved'), null] }] },
      { dateKey: '2026-04-15', slotNumber: 4, desks: [{ lesson: { studentSlots: [placedMakeup, null] } }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-absent')).toEqual({ dateKey: '2026-04-15', slotNumber: 4 })
  })

  it('出席済み振替しか無くても、休みだけの振替コマは振替先にしない', () => {
    const cells = [
      originCell,
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('absent'), null] }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).has('status-absent')).toBe(false)
  })
})

describe('resolveVisibleSlotDateLabel 移動日付の引き継ぎ防止', () => {
  // 回帰防止: 生徒を移動した先のスロットに、前の生徒の「移動元表示(moved)」ステータス(移)日付)が
  // 滞留していると、上書きしたはずの新しい生徒がその移動日付を引き継いで表示されていた不具合。
  // 実在の生徒が入っているスロットでは、ステータス由来の移動日付を表示してはいけない。
  it('実在の生徒がいるスロットでは滞留した moved ステータスの移動日付を引き継がない', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: true,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-08' },
      linkedDestinationDateKey: undefined,
    })

    expect(label).toBe('')
  })

  it('実在の振替生徒は自分の makeupSourceDate を表示する(滞留ステータスは無視)', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: true,
      hasContent: true,
      resolvedLessonType: 'makeup',
      effectiveMakeupSourceDate: '2026-04-10',
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-08' },
      linkedDestinationDateKey: undefined,
    })

    expect(label).toBe('4/10')
  })

  it('生徒がいない moved ステータスのみのスロットは移動先日付を表示する', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: false,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-08' },
      linkedDestinationDateKey: undefined,
    })

    expect(label).toBe('4/8')
  })

  it('実在の生徒がいるスロットではリンク先日付も引き継がない', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: true,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'absent', moveDestinationDateKey: undefined },
      linkedDestinationDateKey: '2026-04-12',
    })

    expect(label).toBe('')
  })
})
