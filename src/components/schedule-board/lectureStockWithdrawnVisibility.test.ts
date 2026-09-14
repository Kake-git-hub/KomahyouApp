import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { excludeWithdrawnStudentStockEntries } from './lectureStock'

// オーナー指示(2026-09-14): 未消化のまま退塾した生徒を未消化一覧から外す(表示だけ・データは残す)。
const student = (id: string, withdrawDate = '', birthDate = '2012-05-01', entryDate = '2024-04-01') => ({
  id, entryDate, withdrawDate, birthDate,
})

describe('excludeWithdrawnStudentStockEntries', () => {
  const students = [
    student('s001'),
    student('s002', '2026-09-10'),
    student('s003', '2026-09-14'),
    student('s004', '', '2012-05-01', '2026-10-01'),
    // 高3卒業(2007-05生まれ → 2026-03-31 卒業)
    student('s005', '', '2007-05-01'),
  ]
  const entries = [
    { key: 'a', studentId: 's001' },
    { key: 'b', studentId: 's002' },
    { key: 'c', studentId: 's003' },
    { key: 'd', studentId: 's004' },
    { key: 'e', studentId: 's005' },
    { key: 'f', studentId: null },
    { key: 'g', studentId: 's999' },
  ]

  it('退塾日を過ぎた生徒と高3卒業生だけを外し、それ以外は残す', () => {
    const result = excludeWithdrawnStudentStockEntries(entries, students, '2026-09-14')
    expect(result.map((entry) => entry.key)).toEqual(['a', 'c', 'd', 'f', 'g'])
  })

  it('退塾日当日はまだ在籍として一覧に残る', () => {
    const result = excludeWithdrawnStudentStockEntries(entries, students, '2026-09-10')
    expect(result.map((entry) => entry.key)).toContain('b')
  })

  it('元の配列(データ)は変更しない', () => {
    const copy = [...entries]
    excludeWithdrawnStudentStockEntries(entries, students, '2026-09-14')
    expect(entries).toEqual(copy)
  })
})

describe('盤面の配線', () => {
  const source = readFileSync(new URL('./ScheduleBoardScreen.tsx', import.meta.url), 'utf8')

  it('未消化一覧モーダルとバッジは絞り込み後の一覧を使う', () => {
    expect(source).toContain('visibleLectureStockEntries.length === 0')
    expect(source).toContain('visibleMakeupStockEntries.length === 0')
    expect(source).toContain('sumLectureStockRequestedCount(visibleLectureStockEntries)')
    expect(source).toContain('visibleMakeupStockEntries.reduce(')
  })

  it('削除確認の残数警告は絞り込み前の一覧を使う(退塾生の在庫を見落とさない)', () => {
    expect(source).toMatch(/deriveStudentDeletionStockSummary\(\s*lectureStockEntries\.map/)
    expect(source).toMatch(/makeupStockEntries\.map\(\(entry\) => \(\{ studentId: entry\.studentId, balance/)
  })
})
