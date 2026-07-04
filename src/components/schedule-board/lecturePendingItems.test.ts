import { describe, expect, it } from 'vitest'
import {
  buildLectureStockEntries,
  buildLectureStockKey,
  buildLecturePendingItemsByEntryKey,
  type LecturePendingScopedEntry,
} from './lectureStock'
import { lectureSpecialSessions, lectureStudents } from './__fixtures__/sampleLectureStock'

// 未消化講習の残数（デルタ台帳適用後の pending items）のゴールデン。
//
// 講習残数は盤面を走査せず、提出希望数(requestedCount)の pending 展開に
// manualLectureStockCounts のデルタ台帳（負=session 配置消費・正=盤面戻し/繰越）を適用して算出する
// (spec-lecture-stock データモデル・仕様監査2026-07 領域5 C2 で明文化)。
// 既存の lectureStockSnapshot.test.ts は希望数(buildLectureStockEntries)のみ固定しており、
// デルタ適用後の残数は本ファイルが唯一の自動ゲート。
//
// ★回帰観点（符号・順序を触ると残数が静かにズレる）:
//   - 負デルタは該当 stockKey の pending 展開の先頭から個数分だけ削る（他科目・他セッションに波及しない）
//   - 負デルタ超過は 0 にクランプ（マイナス残を作らない）
//   - 正デルタは manualLectureStockOrigins のメタデータを先頭から対応付けて manual 項目として追加
//
// 意図的に仕様を変えたときだけ
//   npx vitest -u src/components/schedule-board/lecturePendingItems.test.ts
// で更新し、差分が仕様どおりか目視確認する。

const rawLectureStockEntries = buildLectureStockEntries({
  specialSessions: lectureSpecialSessions,
  students: lectureStudents,
})

function buildPending(params?: {
  manualLectureStockCounts?: Record<string, number>
  manualLectureStockOrigins?: Record<string, { displayName: string; sessionId?: string; originDateKey?: string; originSlotNumber?: number }[]>
  fallbackLectureStockStudents?: Record<string, { displayName: string; subject?: string }>
}) {
  return buildLecturePendingItemsByEntryKey({
    rawLectureStockEntries,
    specialSessions: lectureSpecialSessions,
    manualLectureStockCounts: params?.manualLectureStockCounts ?? {},
    manualLectureStockOrigins: params?.manualLectureStockOrigins ?? {},
    fallbackLectureStockStudents: params?.fallbackLectureStockStudents ?? {},
  })
}

function digest(map: Map<string, LecturePendingScopedEntry>): string {
  return Array.from(map.entries())
    .map(([scopeKey, entry]) => {
      const items = entry.pendingItems.map((item) => `${item.subject}(${item.source})`).join(' ')
      return `${scopeKey} | ${entry.displayName} | 残${entry.pendingItems.length} | ${items}`
    })
    .join('\n')
}

function subjectCounts(entry: LecturePendingScopedEntry | undefined): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of entry?.pendingItems ?? []) {
    counts[item.subject] = (counts[item.subject] ?? 0) + 1
  }
  return counts
}

const SUMMER_MATH_KEY = buildLectureStockKey('s_a', '数', 'sess_summer')

describe('未消化講習の残数ゴールデン (buildLecturePendingItemsByEntryKey)', () => {
  it('デルタ無し: 提出希望数がそのまま pending 展開される(s_a 夏期は数3+英2=5)', () => {
    const map = buildPending()
    const summer = map.get('s_a__sess_summer')
    expect(subjectCounts(summer)).toEqual({ 数: 3, 英: 2 })
    expect(summer?.pendingItems.every((item) => item.source === 'session')).toBe(true)
    // 別セッションは別スコープ（冬期 数1 は夏期に混ざらない）
    expect(subjectCounts(map.get('s_a__sess_winter'))).toEqual({ 数: 1 })
  })

  it('配置1回(負デルタ-1)で該当科目だけがちょうど1減る(数3→2・英2は不変)', () => {
    const map = buildPending({ manualLectureStockCounts: { [SUMMER_MATH_KEY]: -1 } })
    expect(subjectCounts(map.get('s_a__sess_summer'))).toEqual({ 数: 2, 英: 2 })
    // 他生徒・他セッションに波及しない
    expect(subjectCounts(map.get('s_a__sess_winter'))).toEqual({ 数: 1 })
    expect(subjectCounts(map.get('s_d__sess_summer'))).toEqual({ 国: 2 })
  })

  it('負デルタが希望数を超えても0にクランプ(マイナス残を作らない)', () => {
    const map = buildPending({ manualLectureStockCounts: { [SUMMER_MATH_KEY]: -99 } })
    expect(subjectCounts(map.get('s_a__sess_summer'))).toEqual({ 英: 2 })
  })

  it('正デルタ(戻し/繰越)は manual 項目として追加され、fallback の表示名・科目を使う(name:キーは studentId null)', () => {
    const manualKey = buildLectureStockKey('name:体験 太郎', '理')
    const map = buildPending({
      manualLectureStockCounts: { [manualKey]: 1 },
      fallbackLectureStockStudents: { [manualKey]: { displayName: '体験太郎', subject: '理' } },
    })
    const entry = map.get('name:体験 太郎__-')
    expect(entry?.studentId).toBeNull()
    expect(entry?.displayName).toBe('体験太郎')
    expect(entry?.pendingItems).toEqual([
      expect.objectContaining({ stockKey: manualKey, subject: '理', source: 'manual' }),
    ])
  })

  it('正デルタは manualLectureStockOrigins のメタデータを先頭から対応付ける(sessionId解決・元日付引き継ぎ)', () => {
    const manualKey = buildLectureStockKey('s_a', '数', 'sess_summer')
    const map = buildPending({
      manualLectureStockCounts: { [manualKey]: 1 },
      manualLectureStockOrigins: {
        [manualKey]: [{ displayName: '青木太郎', sessionId: 'sess_summer', originDateKey: '2026-07-25', originSlotNumber: 3 }],
      },
    })
    const manualItems = map.get('s_a__sess_summer')?.pendingItems.filter((item) => item.source === 'manual')
    expect(manualItems).toEqual([
      expect.objectContaining({
        sessionId: 'sess_summer',
        sessionLabel: '夏期講習',
        originDateKey: '2026-07-25',
        originSlotNumber: 3,
      }),
    ])
  })

  it('同一スコープ内で負デルタ(超過消費)と正デルタ(戻し)が別キーに混在しても互いに干渉せず、残が負に振れない', () => {
    const summerEngKey = buildLectureStockKey('s_a', '英', 'sess_summer')
    const map = buildPending({
      manualLectureStockCounts: {
        [SUMMER_MATH_KEY]: -99,
        [summerEngKey]: 1,
      },
      manualLectureStockOrigins: {
        [summerEngKey]: [{ displayName: '青木太郎', sessionId: 'sess_summer', originDateKey: '2026-07-28' }],
      },
    })
    const summer = map.get('s_a__sess_summer')
    // 数は0にクランプ(超過消費がマイナス残にならない)・英は session 2 + 戻し(manual) 1 = 3
    expect(subjectCounts(summer)).toEqual({ 英: 3 })
    expect(summer?.pendingItems.filter((item) => item.source === 'manual')).toHaveLength(1)
    expect(summer?.pendingItems.length).toBe(3)
  })

  it('正デルタ複数件は manualLectureStockOrigins のメタデータが投入順(FIFO)どおりに対応する', () => {
    const manualKey = buildLectureStockKey('s_a', '数', 'sess_summer')
    const map = buildPending({
      manualLectureStockCounts: { [manualKey]: 2 },
      manualLectureStockOrigins: {
        [manualKey]: [
          { displayName: '青木太郎', sessionId: 'sess_summer', originDateKey: '2026-07-22' },
          { displayName: '青木太郎', sessionId: 'sess_summer', originDateKey: '2026-07-29' },
        ],
      },
    })
    const manualItems = map.get('s_a__sess_summer')?.pendingItems.filter((item) => item.source === 'manual')
    expect(manualItems?.map((item) => item.originDateKey)).toEqual(['2026-07-22', '2026-07-29'])
  })

  it('代表シナリオ(消費+戻し+繰越の混在)の残数がゴールデンと一致する', () => {
    const trialKey = buildLectureStockKey('name:体験 太郎', '理')
    const map = buildPending({
      manualLectureStockCounts: {
        [SUMMER_MATH_KEY]: -1,
        [trialKey]: 1,
      },
      fallbackLectureStockStudents: { [trialKey]: { displayName: '体験太郎', subject: '理' } },
    })
    expect(digest(map)).toMatchSnapshot()
  })
})
