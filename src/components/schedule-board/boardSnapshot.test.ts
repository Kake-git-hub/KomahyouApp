import { describe, expect, it } from 'vitest'
import type { SlotCell } from './types'
import { buildScheduleCellsForRange } from './ScheduleBoardScreen'
import {
  sampleClassroomSettings,
  sampleRegularLessons,
  sampleScheduleRange,
  sampleStudents,
  sampleTeachers,
  SAMPLE_RANGE_END,
  SAMPLE_RANGE_START,
} from './__fixtures__/sampleClassroom'

// コマ配置のゴールデンスナップショット。
//
// なぜ digest 文字列にするか:
//   - 生の SlotCell[] JSON は空デスクだらけで巨大・ノイズが多く、差分が読めない。
//   - 「いつ・どのコマ・どの講師・どの生徒(学年/科目)が配置されたか」だけを
//     1 行 = 1 配置で書き出すと、人間も Claude も差分を即読できる。
//   - 配置が消える/増える/学年や科目が変わる等の回帰がそのまま行差分に出る。
//
// 仕様を意図的に変えたときだけ `npx vitest -u` で更新する。
// それ以外でこのスナップショットが変わったら回帰の可能性が高い。

function digestBoard(cells: SlotCell[]): string {
  const lines: string[] = []
  for (const cell of cells) {
    for (const desk of cell.desks) {
      const hasStudents = desk.lesson?.studentSlots?.some(Boolean) ?? false
      const hasTeacher = desk.teacher.trim().length > 0
      if (!hasStudents && !hasTeacher) continue // 空デスクは出力しない

      const students = (desk.lesson?.studentSlots ?? [])
        .flatMap((s) => s != null ? [`${s.name}(${s.grade}/${s.subject})`] : [])
        .join(' + ')
      const teacher = desk.teacher.trim() || '(講師なし)'
      const who = students || '(生徒なし)'
      lines.push(`${cell.dateKey} (${cell.dayLabel}) ${cell.slotLabel} | ${teacher} | ${who}`)
    }
  }
  // dateKey → slot の決定的な順序に整列(デスク順の揺れを吸収)
  return lines.sort((a, b) => a.localeCompare(b)).join('\n')
}

describe('コマ配置ゴールデンスナップショット (buildScheduleCellsForRange)', () => {
  const cells = buildScheduleCellsForRange({
    range: sampleScheduleRange,
    fallbackStartDate: SAMPLE_RANGE_START,
    fallbackEndDate: SAMPLE_RANGE_END,
    classroomSettings: sampleClassroomSettings,
    teachers: sampleTeachers,
    students: sampleStudents,
    regularLessons: sampleRegularLessons,
    boardWeeks: [],
  })

  it('代表教室データの配置が固定スナップショットと一致する', () => {
    expect(digestBoard(cells)).toMatchSnapshot()
  })

  // スナップショットに加え、開発ルール.md の不変条件を機械チェック(③への橋渡し)。
  // スナップショットがうっかり間違ったまま更新されても、ここで仕様違反を止める。

  const digest = digestBoard(cells)
  const placedOn = (dateKey: string, studentName: string) =>
    digest.split('\n').some((line) => line.startsWith(dateKey) && line.includes(studentName))

  it('月初から在籍の生徒は休日を除く全該当曜日に配置される(6月の月曜=1,8,15,22,29、休日6/8を除く)', () => {
    expect(placedOn('2026-06-01', '青木太郎')).toBe(true)
    expect(placedOn('2026-06-08', '青木太郎')).toBe(false) // 休日
    expect(placedOn('2026-06-15', '青木太郎')).toBe(true)
    expect(placedOn('2026-06-22', '青木太郎')).toBe(true)
    expect(placedOn('2026-06-29', '青木太郎')).toBe(true)
  })

  it('月途中開始(6/15〜)の通常授業は開始日以降の該当曜日だけ配置される(水曜=17,24)', () => {
    expect(placedOn('2026-06-03', '伊藤花')).toBe(false) // 開始前
    expect(placedOn('2026-06-10', '伊藤花')).toBe(false) // 開始前
    expect(placedOn('2026-06-17', '伊藤花')).toBe(true)
    expect(placedOn('2026-06-24', '伊藤花')).toBe(true)
  })

  it('月途中退塾(6/15退塾)の生徒は退塾日以降は配置されない(金曜=5,12のみ、19・26は出ない)', () => {
    expect(placedOn('2026-06-05', '上田陽介')).toBe(true)
    expect(placedOn('2026-06-12', '上田陽介')).toBe(true)
    expect(placedOn('2026-06-19', '上田陽介')).toBe(false)
    expect(placedOn('2026-06-26', '上田陽介')).toBe(false)
  })
})
