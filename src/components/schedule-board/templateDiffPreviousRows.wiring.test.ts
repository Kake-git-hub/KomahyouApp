// 2026-11-10（緑が丘の報告・INV-02）の配線テストと、保存前のテンプレの行を日付ごとに引く関数のテスト。
// テンプレ差分反映の「並びの戻しの基準」（§9-22 案 A）と「時限の追従の比較相手」（決定記録 46）は、保存前の行だけでなく保存**前**の履歴から
// 「その日付に効いていた保存前のテンプレ」を作る。盤面の保存（試し実行と保存本体が共有する buildTemplateDiffSavePlan）が保存前の履歴を渡していることを
// 字面で固定する（渡し忘れると黙って保存前の行だけになり、保存済みのテンプレが未来の反映日の版だと手入力が講師の机から離れる）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import { buildRegularLessonsFromTemplate, type RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import { resolveTemplateDiffPreviousRows, selectTemplateDiffPreviousRowsOnDate } from './ScheduleBoardScreen'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

describe('保存前のテンプレの履歴の配線（2026-11-10・INV-02）', () => {
  it('盤面のテンプレ保存は保存**前**の履歴とテンプレ適用前の通常授業を渡す（保存後の nextClassroomSettings ではない）', () => {
    const start = BOARD_TSX.indexOf('const buildTemplateDiffSavePlan = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = BOARD_TSX.slice(start, BOARD_TSX.indexOf('const handleSaveRegularLessonTemplateByDiff', start))
    const call = body.slice(body.indexOf('const diff = computeTemplateDiffApplyForBoard({'))
    expect(call).toContain('previousRegularLessons: regularLessons,')
    expect(call).toContain('previousRegularLessonTemplateHistory: classroomSettings.regularLessonTemplateHistory,')
    expect(call).toContain('previousPreTemplateRegularLessons: classroomSettings.preTemplateRegularLessons,')
    expect(call).not.toContain('previousRegularLessonTemplateHistory: nextClassroomSettings')
  })

  it('入口は保存前の行を日付ごとに引く形にし、並びの戻しの基準と時限の追従の両方に渡す', () => {
    const start = BOARD_TSX.indexOf('export function computeTemplateDiffApplyForBoard(')
    const body = BOARD_TSX.slice(start, BOARD_TSX.indexOf('\nfunction runTemplateDiffApplyV2(', start))
    expect(body).toContain('const previousTemplateRows = resolveTemplateDiffPreviousRows(input)')
    expect(body).toContain('previousTemplateRows }')
    expect(body).toContain('resolvePreviousRegularLessonsOnDate: previousTemplateRows ? (dateKey) => selectTemplateDiffPreviousRowsOnDate(previousTemplateRows, dateKey) : undefined,')
    const runStart = BOARD_TSX.indexOf('\nfunction runTemplateDiffApplyV2(')
    const runBody = BOARD_TSX.slice(runStart, BOARD_TSX.indexOf('\nexport type TemplateDiffPreviousRows', runStart))
    expect(runBody).toContain('buildTemplateDiffAnchorCellsByDate(')
  })
})

describe('resolveTemplateDiffPreviousRows / selectTemplateDiffPreviousRowsOnDate', () => {
  const teachers: TeacherRow[] = [{ id: 't1', name: '田中', email: 't1@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [] }]
  const students: StudentRow[] = [{ id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }]
  const templateOf = (effectiveStartDate: string, slotNumber: number, studentId: string): RegularLessonTemplate => ({
    version: 1, effectiveStartDate, savedAt: '2026-09-01T00:00:00.000Z',
    cells: [{ dayOfWeek: 3, slotNumber, desks: [{ deskIndex: 1, teacherId: 't1', students: [studentId ? { studentId, subject: '数' } : null, null] }] }],
  })
  const CURRENT = templateOf('2026-09-02', 5, 'sA')
  const FUTURE = templateOf('2027-02-01', 3, '')
  const futureRows = buildRegularLessonsFromTemplate({ template: FUTURE, teachers, students })

  it('履歴が無ければ保存前の行をそのまま全日付に当てる（従来どおり・合成しない）', () => {
    const previous = resolveTemplateDiffPreviousRows({ previousRegularLessons: futureRows, previousRegularLessonTemplateHistory: [], teachers, students })
    expect(previous).toEqual({ rows: futureRows, byDate: false })
    expect(selectTemplateDiffPreviousRowsOnDate(previous!, '2026-11-16')).toBe(futureRows)
    expect(resolveTemplateDiffPreviousRows({ previousRegularLessons: null, previousRegularLessonTemplateHistory: [CURRENT], teachers, students })).toBeNull()
  })

  it('履歴があれば、その日付に効いていた版の行だけを返す（未来版の講師だけの行を前の日付へ漏らさない）', () => {
    const previous = resolveTemplateDiffPreviousRows({ previousRegularLessons: futureRows, previousRegularLessonTemplateHistory: [CURRENT, FUTURE], teachers, students })!
    expect(previous.byDate).toBe(true)
    const onNov = selectTemplateDiffPreviousRowsOnDate(previous, '2026-11-16')
    expect(onNov.map((item) => [item.slotNumber, item.student1Id, item.startDate, item.endDate])).toEqual([[5, 'sA', '2026-09-02', '2027-01-31']])
    const onFeb = selectTemplateDiffPreviousRowsOnDate(previous, '2027-02-03')
    expect(onFeb.map((item) => [item.slotNumber, item.student1Id, item.startDate])).toEqual([[3, '', '2027-02-01']])
  })
})
