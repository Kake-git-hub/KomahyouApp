// 決定記録 46（2026-10-26・spec-template-behavior §H Q40-9）の配線テスト。
// 時限の追従は computeTemplateDiffApplyForBoard に「保存前のテンプレの行」を渡したときだけ動く（省略すると v1.5.642 までと同じ）。
// 盤面の保存（試し実行と保存本体が共有する buildTemplateDiffSavePlan）が必ず渡していることを字面で固定する（渡し忘れると黙って追従しない）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import { resolveTemplateSlotChange } from './templateTransferFollow'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

describe('時限の追従の配線（決定記録 46）', () => {
  it('盤面のテンプレ保存は保存前のテンプレの行（regularLessons）を previousRegularLessons として渡す', () => {
    const start = BOARD_TSX.indexOf('const buildTemplateDiffSavePlan = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = BOARD_TSX.slice(start, BOARD_TSX.indexOf('const handleSaveRegularLessonTemplateByDiff', start))
    expect(body).toContain('const diff = computeTemplateDiffApplyForBoard({')
    expect(body).toContain('previousRegularLessons: regularLessons,')
    // 新テンプレは正規化後の行（保存前の行と取り違えない）
    expect(body).toContain('regularLessons: normalizedTemplateRegularLessons,')
  })

  it('入口は時限の追従の結果（盤面・保留・触ったコマ）を保存結果へ合流させる', () => {
    const start = BOARD_TSX.indexOf('export function computeTemplateDiffApplyForBoard(')
    const body = BOARD_TSX.slice(start, BOARD_TSX.indexOf('function runTemplateDiffApplyWithCopyReverts', start))
    expect(body).toContain('const slotFollow = planSlotChangeTransferFollow({')
    expect(body).toContain('const nextWeeks = slotFollow.weeks.map(')
    expect(body).toContain('nextPendingDesks: slotFollow.nextPendingDesks,')
    expect(body).toContain('...slotFollow.touchedCellIds')
  })
})

describe('resolveTemplateSlotChange（時限が 1 つだけ入れ替わったかの判定）', () => {
  const row = (id: string, studentId: string, slotNumber: number, extra: Partial<RegularLessonRow> = {}): RegularLessonRow => ({
    id, schoolYear: 2026, teacherId: 't1', student1Id: studentId, subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '',
    nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber, ...extra,
  })
  it('5限 → 3限 なら旧時限 5 を返す。生徒 2 の席でも同じ', () => {
    expect(resolveTemplateSlotChange([row('a', 'sA', 5)], [row('a', 'sA', 3)], 3, 'sA', '数', 3)).toBe(5)
    expect(resolveTemplateSlotChange([row('a', '', 5, { student2Id: 'sA', subject2: '数' })], [row('a', '', 3, { student2Id: 'sA', subject2: '数' })], 3, 'sA', '数', 3)).toBe(5)
  })
  it('時限が変わっていない・別の曜日・科目違い・増減が 1 対 1 でない・増えた側が newSlot でない、はいずれも null', () => {
    expect(resolveTemplateSlotChange([row('a', 'sA', 5)], [row('a', 'sA', 5)], 3, 'sA', '数', 5)).toBeNull()
    expect(resolveTemplateSlotChange([row('a', 'sA', 5)], [row('a', 'sA', 3)], 4, 'sA', '数', 3)).toBeNull()
    expect(resolveTemplateSlotChange([row('a', 'sA', 5)], [row('a', 'sA', 3, { subject1: '英' })], 3, 'sA', '英', 3)).toBeNull()
    expect(resolveTemplateSlotChange([row('a', 'sA', 5)], [row('a', 'sA', 3), row('b', 'sA', 4)], 3, 'sA', '数', 3)).toBeNull()
    expect(resolveTemplateSlotChange([row('a', 'sA', 5), row('b', 'sA', 6)], [row('a', 'sA', 3)], 3, 'sA', '数', 3)).toBeNull()
    expect(resolveTemplateSlotChange([row('a', 'sA', 5)], [row('a', 'sA', 3)], 3, 'sA', '数', 4)).toBeNull()
  })
})
