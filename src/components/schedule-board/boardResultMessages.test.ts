// オーナー指示 2026-10-25「三行以上の長文を 1 行くらいに」: 盤面の上の帯の結果メッセージは 1 行・件数だけ。
import { describe, expect, it } from 'vitest'
import { buildAutoAssignResultMessage, buildHolidayReleaseResultMessage, buildWholeDayTransferResultMessage, joinResultNotes } from './boardResultMessages'

describe('joinResultNotes', () => {
  it('空の要素を落として括る。全部空なら空文字', () => {
    expect(joinResultNotes(['A', '', 'B'])).toBe('（A・B）')
    expect(joinResultNotes(['', ''])).toBe('')
  })
})

describe('buildAutoAssignResultMessage', () => {
  it('振替を含む: 配置件数と、候補不足の残りだけ（0 件の内訳は出さない）', () => {
    expect(buildAutoAssignResultMessage({ displayName: '青木', includeMakeup: true, placedLecture: 3, placedMakeup: 1, remainingLecture: 2, remainingMakeup: 0 }))
      .toBe('青木 を自動割振しました（講習3・振替1コマ・候補なしで残り 講習2）。')
    expect(buildAutoAssignResultMessage({ displayName: '青木', includeMakeup: true, placedLecture: 3, placedMakeup: 1, remainingLecture: 2, remainingMakeup: 1 }))
      .toBe('青木 を自動割振しました（講習3・振替1コマ・候補なしで残り 講習2・振替1）。')
    expect(buildAutoAssignResultMessage({ displayName: '青木', includeMakeup: true, placedLecture: 3, placedMakeup: 1, remainingLecture: 0, remainingMakeup: 0 }))
      .toBe('青木 を自動割振しました（講習3・振替1コマ）。')
  })
  it('講習だけ', () => {
    expect(buildAutoAssignResultMessage({ displayName: '青木', includeMakeup: false, placedLecture: 3, placedMakeup: 0, remainingLecture: 2, remainingMakeup: 0 }))
      .toBe('青木 を自動割振しました（3コマ・候補なしで残り 2コマ）。')
    expect(buildAutoAssignResultMessage({ displayName: '青木', includeMakeup: false, placedLecture: 3, placedMakeup: 0, remainingLecture: 0, remainingMakeup: 0 }))
      .toBe('青木 を自動割振しました（3コマ）。')
  })
})

describe('buildHolidayReleaseResultMessage', () => {
  it('休日・休校の別と、元の席へ戻した件数・消した別日のコマ・戻せない件数（理由つき）を 1 行で', () => {
    expect(buildHolidayReleaseResultMessage({ dateKey: '2026-10-07', isClosedWeekday: false, restoredCount: 2, removedMakeupCount: 1, skippedCount: 1, skippedSummary: '席が埋まっている' }))
      .toBe('2026-10-07 の休日を解除しました（元の席へ 2件・別日のコマ 1件を削除・戻せない 1件: 席が埋まっている）。')
    expect(buildHolidayReleaseResultMessage({ dateKey: '2026-10-07', isClosedWeekday: true, restoredCount: 0, removedMakeupCount: 0, skippedCount: 0, skippedSummary: '' }))
      .toBe('2026-10-07 の休校を解除しました。')
  })
})

describe('buildWholeDayTransferResultMessage', () => {
  it('移した件数と未消化へ戻した件数（0 なら出さない）', () => {
    expect(buildWholeDayTransferResultMessage({ sourceDateKey: '2026-08-05', targetDateKey: '2026-08-19', movedStudentCount: 12, movedTeacherCount: 4, returnedCount: 3 }))
      .toBe('2026-08-05 → 2026-08-19 へ丸ごと振替しました（生徒12・講師4・未消化へ 3件）。')
    expect(buildWholeDayTransferResultMessage({ sourceDateKey: '2026-08-05', targetDateKey: '2026-08-19', movedStudentCount: 1, movedTeacherCount: 1, returnedCount: 0 }))
      .toBe('2026-08-05 → 2026-08-19 へ丸ごと振替しました（生徒1・講師1）。')
  })
  it('どれも改行を含まない（1 行）', () => {
    expect(buildWholeDayTransferResultMessage({ sourceDateKey: 'a', targetDateKey: 'b', movedStudentCount: 1, movedTeacherCount: 1, returnedCount: 1 })).not.toContain('\n')
    expect(buildHolidayReleaseResultMessage({ dateKey: 'a', isClosedWeekday: false, restoredCount: 1, removedMakeupCount: 1, skippedCount: 1, skippedSummary: 'x' })).not.toContain('\n')
  })
})
