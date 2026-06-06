import { describe, expect, it } from 'vitest'
import { buildMakeupStockEntries, type MakeupStockEntry } from './makeupStock'
import {
  MAKEUP_TODAY,
  resolveSampleStudentKey,
  sampleMakeupClassroomSettings,
  sampleMakeupManualAdjustments,
  sampleMakeupRegularLessons,
  sampleMakeupStudents,
  sampleMakeupTeachers,
  sampleMakeupWeeks,
} from './__fixtures__/sampleMakeupStock'

// 振替ストックのゴールデンスナップショット。
//
// 「計算・消化・再ストック」の崩れを 1 行 = 1 ストック行で固定する。
// digest 各列の意味:
//   残        balance(残ストック数。マイナスは過剰配置)
//   自動/手動 自動ショート件数 / 手動調整件数
//   配置振替  実際に盤面へ配置済みの振替数(plannedMakeups)
//   通常/上限 配置済み通常授業数 / 希望回数上限(totalLessonCount)・超過数
//   次源      次に消化すべきストックの発生元(日付/理由)
//
// 意図的に仕様を変えたときだけ
//   npx vitest -u src/components/schedule-board/makeupStockSnapshot.test.ts
// で更新し、差分が仕様どおりか目視確認する。

function digestEntries(entries: MakeupStockEntry[]): string {
  return entries
    .map((e) => [
      e.key,
      `残${e.balance}`,
      `自動${e.autoShortage}/手動${e.manualAdjustments}`,
      `配置振替${e.plannedMakeups}`,
      `通常${e.assignedRegularLessons}/上限${e.totalLessonCount}/超過${e.overAssignedRegularLessons}`,
      `次源:${e.nextOriginDate ?? '-'}(${e.nextOriginReasonLabel ?? '-'})`,
      e.negativeReason ? `理由:${e.negativeReason}` : '',
    ].filter(Boolean).join(' | '))
    .join('\n')
}

describe('振替ストックゴールデンスナップショット (buildMakeupStockEntries)', () => {
  const entries = buildMakeupStockEntries({
    students: sampleMakeupStudents,
    teachers: sampleMakeupTeachers,
    regularLessons: sampleMakeupRegularLessons,
    classroomSettings: sampleMakeupClassroomSettings,
    weeks: sampleMakeupWeeks,
    manualAdjustments: sampleMakeupManualAdjustments,
    resolveStudentKey: resolveSampleStudentKey,
    today: MAKEUP_TODAY,
  })

  const byKey = (key: string) => entries.find((e) => e.key === key)

  it('代表シナリオの振替ストック計算が固定スナップショットと一致する', () => {
    expect(digestEntries(entries)).toMatchSnapshot()
  })

  it('未消化ストック: 休日で潰れた通常授業が残ストック(+)として出る', () => {
    const e = byKey('s_short__数')
    expect(e?.balance).toBe(1)
    expect(e?.autoShortage).toBe(1)
    expect(e?.nextOriginDate).toBe('2026-04-06')
  })

  it('手動ストック消化(再ストック): 2件中1件を振替配置で消化 → 残り1件だけ残る', () => {
    const e = byKey('s_manual__英')
    expect(e?.balance).toBe(1)
    expect(e?.plannedMakeups).toBe(1) // 4/21 に配置した振替が消化
    expect(e?.remainingOriginDates).toEqual(['2026-04-14']) // 4/7 は消化済み、4/14 が残る
  })

  it('マイナス残: 短縮された希望回数を通常+振替が上回ると残数マイナス＋理由が付く', () => {
    const e = byKey('s_minus__数')
    expect(e?.balance).toBeLessThan(0)
    expect(e?.overAssignedRegularLessons).toBeGreaterThan(0)
    expect(e?.negativeReason).toBeTruthy()
  })
})
