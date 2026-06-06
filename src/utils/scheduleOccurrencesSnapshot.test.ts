import { describe, expect, it } from 'vitest'
import { buildExpectedRegularOccurrences } from './scheduleHtml'
import {
  occRegularLessons,
  occStudents,
  OCC_RANGE_END,
  OCC_RANGE_START,
} from '../components/schedule-board/__fixtures__/sampleScheduleOccurrences'

// 日程表の「通常授業 想定回数」ゴールデンスナップショット。
//
// buildExpectedRegularOccurrences は日程表ポップアップへ渡す
// 「各生徒・各科目が通常授業として出現する想定日」を計算する純関数。
// 開発ルール.md「通常授業の契約回数は月途中開始/終了時は有効な残り週数分だけ」
// 「基本データの追加・編集・削除がコマ表/日程表へ反映されること」を機械検知する。
//
// 注意: この関数は休日(holidayDates)では間引かない。在籍期間・授業期間に基づく
// 「想定回数」のベースライン(休日調整前)であり、表示レンジではなく row の授業期間で返す。
//
// 入力 fixture: __fixtures__/sampleScheduleOccurrences.ts(row 期間を月内へ束ねている)
// 意図的に仕様を変えたときだけ
//   npx vitest -u src/utils/scheduleOccurrencesSnapshot.test.ts
// で更新し、差分が仕様どおりか目視確認する。

const occurrences = buildExpectedRegularOccurrences({
  students: occStudents,
  regularLessons: occRegularLessons,
  startDate: OCC_RANGE_START,
  endDate: OCC_RANGE_END,
})

const nameById = new Map(occStudents.map((s) => [s.id, s.displayName]))

function digestOccurrences(): string {
  const byKey = new Map<string, string[]>()
  for (const o of occurrences) {
    const key = `${nameById.get(o.linkedStudentId) ?? o.linkedStudentId}__${o.subject}`
    const list = byKey.get(key) ?? []
    list.push(o.dateKey)
    byKey.set(key, list)
  }
  return Array.from(byKey.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'ja'))
    .map(([key, dates]) => `${key} | 計${dates.length} | ${dates.sort().join(', ')}`)
    .join('\n')
}

describe('日程表 想定回数ゴールデンスナップショット (buildExpectedRegularOccurrences)', () => {
  it('代表教室データの通常授業 想定出現が固定スナップショットと一致する', () => {
    expect(digestOccurrences()).toMatchSnapshot()
  })

  const datesOf = (studentName: string, subject: string) =>
    occurrences
      .filter((o) => (nameById.get(o.linkedStudentId) === studentName) && o.subject === subject)
      .map((o) => o.dateKey)
      .sort()

  it('月初から在籍の生徒は6月の全該当曜日に想定が出る(休日は間引かない=月曜5回)', () => {
    expect(datesOf('青木太郎', '数')).toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'])
  })

  it('月途中開始(row.startDate=6/15)の通常授業は開始日以降だけ想定が出る(水曜=17,24)', () => {
    expect(datesOf('伊藤花', '英')).toEqual(['2026-06-17', '2026-06-24'])
  })

  it('月途中退塾(withdrawDate=6/15)の生徒は退塾日以降は想定が出ない(金曜=5,12のみ)', () => {
    expect(datesOf('上田陽介', '数')).toEqual(['2026-06-05', '2026-06-12'])
  })
})
