import { afterEach, describe, expect, it, vi } from 'vitest'
import * as xlsx from 'xlsx'
import { createTemplateBundle, parseImportedBundle } from './BasicDataScreen'
import { createInitialRegularLessons, resolveOperationalSchoolYear } from './regularLessonModel'
import { createPackedInitialBoardState } from '../schedule-board/ScheduleBoardScreen'

afterEach(() => {
  vi.useRealTimers()
})

describe('BasicDataScreen parseImportedBundle', () => {
  it('normalizes imported regular lesson math subjects to the student grade for the school year', () => {
    const workbook = xlsx.utils.book_new()
    const schoolYear = resolveOperationalSchoolYear(new Date('2026-03-25T00:00:00'))

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '数小学 生', 表示名: '数小', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2015-05-10', 表示: '表示' },
      { 名前: '数中学 生', 表示名: '数中', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2012-05-10', 表示: '表示' },
    ]), '生徒')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '田中講師', 表示名: '田中講師', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3', メモ: '' },
    ]), '講師')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 年度: `${schoolYear}年度`, 講師: '田中講師', 生徒1: '数小', 科目1: '数', 共通期間開始: '', 共通期間終了: '', 生徒2: '数中', 科目2: '数', 曜日: '月曜', 時限: 1 },
    ]), '通常授業')

    const parsed = parseImportedBundle(xlsx, workbook, {
      ...createTemplateBundle(),
      regularLessons: createInitialRegularLessons(new Date('2026-03-25T00:00:00')),
    })

    expect(parsed.regularLessons).toHaveLength(1)
    expect(parsed.regularLessons[0]).toMatchObject({
      subject1: '算',
      subject2: '数',
    })
  })

  it('keeps imported paired regular lessons visible on the board after a 4/1 math label transition', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-06T09:00:00'))

    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '福田 講師', 表示名: '福田', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3, 社:高3', メモ: '' },
    ]), '講師')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '山野 拓海', 表示名: '山野', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2013-05-10', 表示: '表示' },
      { 名前: '増田 里奈', 表示名: '増田', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-06-10', 表示: '表示' },
    ]), '生徒')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        年度: '2026年度',
        講師: '福田',
        生徒1: '山野',
        科目1: '数',
        共通期間開始: '2026-04-01',
        共通期間終了: '2027-03-31',
        生徒2: '増田',
        科目2: '社',
        曜日: '火曜',
        時限: '4限',
      },
    ]), '通常授業')

    const parsed = parseImportedBundle(xlsx, workbook, {
      ...createTemplateBundle(),
      regularLessons: createInitialRegularLessons(new Date('2026-04-06T09:00:00')),
    })

    const boardState = createPackedInitialBoardState({
      classroomSettings: parsed.classroomSettings,
      teachers: parsed.teachers,
      students: parsed.students,
      regularLessons: parsed.regularLessons,
    })

    const targetCell = boardState.weeks.flat().find((cell) => cell.id === '2026-04-07_4')
    const lesson = targetCell?.desks.find((desk) => desk.teacher === '福田')?.lesson
    const names = lesson?.studentSlots.map((student) => student?.name ?? '') ?? []

    expect(parsed.regularLessons).toHaveLength(1)
    expect(parsed.regularLessons[0]).toMatchObject({
      subject1: '数',
      subject2: '社',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      dayOfWeek: 2,
      slotNumber: 4,
    })
    expect(targetCell).toBeDefined()
    expect(names).toEqual(['山野', '増田'])
  })
})