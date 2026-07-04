import { describe, expect, it } from 'vitest'
import { buildLectureStockEntries, type LectureStockEntry } from './lectureStock'
import { lectureSpecialSessions, lectureStockReferenceDate, lectureStudents } from './__fixtures__/sampleLectureStock'

// 講習ストックのゴールデンスナップショット。
//
// 「講習回数の集計・除外条件・並び」の崩れを 1 行 = 1 ストック行で固定する。
// digest 各列: セッション | 生徒 | 科目 | 希望回数
//
// 意図的に仕様を変えたときだけ
//   npx vitest -u src/components/schedule-board/lectureStockSnapshot.test.ts
// で更新し、差分が仕様どおりか目視確認する。

const entries = buildLectureStockEntries({
  specialSessions: lectureSpecialSessions,
  students: lectureStudents,
  referenceDate: lectureStockReferenceDate,
})

function digestEntries(list: LectureStockEntry[]): string {
  return list
    .map((e) => `${e.sessionLabel} | ${e.displayName} | ${e.subject} | 希望${e.requestedCount}`)
    .join('\n')
}

describe('講習ストックゴールデンスナップショット (buildLectureStockEntries)', () => {
  it('referenceDate を渡すと学年ラベルがその日基準で固定される(年度替わりでゴールデンが揺れない)', () => {
    // birthDate 2011-06-10(2018年度入学): 2026年度=中3 / 2028年度=高2。
    // 基準日を固定しない(=今日基準の)ままだと、この差が毎年4/1に両ゴールデンを落とす。
    const future = buildLectureStockEntries({
      specialSessions: lectureSpecialSessions,
      students: lectureStudents,
      referenceDate: '2028-07-01',
    })
    expect(future.find((e) => e.studentId === 's_a')?.displayName).toBe('青木太郎 (高2)')
    expect(entries.find((e) => e.studentId === 's_a')?.displayName).toBe('青木太郎 (中3)')
  })

  it('代表講習データの集計が固定スナップショットと一致する', () => {
    expect(digestEntries(entries)).toMatchSnapshot()
  })

  it('提出済み・通常のみでない生徒の各科目がストックになる(数3・英2)', () => {
    const summer = entries.filter((e) => e.sessionId === 'sess_summer' && e.studentId === 's_a')
    expect(summer.map((e) => `${e.subject}:${e.requestedCount}`).sort()).toEqual(['数:3', '英:2'])
  })

  it('未提出(countSubmitted=false)の生徒はストックに出ない', () => {
    expect(entries.some((e) => e.studentId === 's_b')).toBe(false)
  })

  it('通常のみ(regularOnly=true)の生徒はストックに出ない', () => {
    expect(entries.some((e) => e.studentId === 's_c')).toBe(false)
  })

  it('0回の科目は除外され、回数>0の科目だけ残る(s_d は国2のみ)', () => {
    const sd = entries.filter((e) => e.studentId === 's_d')
    expect(sd.map((e) => `${e.subject}:${e.requestedCount}`)).toEqual(['国:2'])
  })

  it('複数セッションが集計され、セッションラベル順(localeCompare ja)に決定的に整列する', () => {
    const labels = Array.from(new Set(entries.map((e) => e.sessionLabel)))
    expect(labels).toEqual(['夏期講習', '冬期講習'])
  })
})
