import { describe, expect, it } from 'vitest'

import { resolveVisibleSlotDateLabel } from './lessonLinks'

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
