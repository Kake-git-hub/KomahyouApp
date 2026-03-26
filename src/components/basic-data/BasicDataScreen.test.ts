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

  it('preserves imported regular lesson slot numbers', () => {
    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '田中講師', 表示名: '田中講師', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3, 英:高3', メモ: '' },
    ]), '講師')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '生徒A', 表示名: '生徒A', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-01', 表示: '表示' },
      { 名前: '生徒B', 表示名: '生徒B', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-02', 表示: '表示' },
      { 名前: '生徒C', 表示名: '生徒C', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-03', 表示: '表示' },
    ]), '生徒')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 年度: '2026年度', 講師: '田中講師', 生徒1: '生徒A', 科目1: '数', 共通期間開始: '', 共通期間終了: '', 生徒2: '', 科目2: '', 曜日: '火曜', 時限: 2 },
      { 年度: '2026年度', 講師: '田中講師', 生徒1: '生徒B', 科目1: '英', 共通期間開始: '', 共通期間終了: '', 生徒2: '', 科目2: '', 曜日: '火曜', 時限: 4 },
      { 年度: '2026年度', 講師: '田中講師', 生徒1: '生徒C', 科目1: '数', 共通期間開始: '', 共通期間終了: '', 生徒2: '', 科目2: '', 曜日: '木曜', 時限: 5 },
    ]), '通常授業')

    const parsed = parseImportedBundle(xlsx, workbook, createTemplateBundle())

    expect(parsed.regularLessons).toHaveLength(3)
    expect(parsed.regularLessons.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      student1Id: row.student1Id,
      slotNumber: row.slotNumber,
    }))).toEqual([
      expect.objectContaining({ dayOfWeek: 2, slotNumber: 2 }),
      expect.objectContaining({ dayOfWeek: 2, slotNumber: 4 }),
      expect.objectContaining({ dayOfWeek: 4, slotNumber: 5 }),
    ])
  })

  it('applies the same desk packing as the pack-sort button after import while keeping slot numbers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-06T09:00:00'))

    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '田中講師', 表示名: '田中講師', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3, 英:高3, 国:高3', メモ: '' },
      { 名前: '佐藤講師', 表示名: '佐藤講師', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3', メモ: '' },
      { 名前: '青木講師', 表示名: '青木講師', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '国:高3', メモ: '' },
    ]), '講師')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '生徒A', 表示名: '生徒A', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-01', 表示: '表示' },
      { 名前: '生徒B', 表示名: '生徒B', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-02', 表示: '表示' },
      { 名前: '生徒C', 表示名: '生徒C', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-03', 表示: '表示' },
      { 名前: '生徒D', 表示名: '生徒D', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-04', 表示: '表示' },
    ]), '生徒')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 年度: '2026年度', 講師: '田中講師', 生徒1: '生徒A', 科目1: '数', 共通期間開始: '', 共通期間終了: '', 生徒2: '生徒B', 科目2: '英', 曜日: '火曜', 時限: 4 },
      { 年度: '2026年度', 講師: '佐藤講師', 生徒1: '生徒C', 科目1: '数', 共通期間開始: '', 共通期間終了: '', 生徒2: '', 科目2: '', 曜日: '火曜', 時限: 4 },
      { 年度: '2026年度', 講師: '青木講師', 生徒1: '', 科目1: '', 共通期間開始: '', 共通期間終了: '', 生徒2: '生徒D', 科目2: '国', 曜日: '火曜', 時限: 4 },
    ]), '通常授業')

    const parsed = parseImportedBundle(xlsx, workbook, createTemplateBundle())

    expect(parsed.regularLessons).toHaveLength(3)
    expect(parsed.regularLessons.every((row) => row.slotNumber === 4)).toBe(true)
    expect(parsed.regularLessons[0]).toMatchObject({
      student1Id: expect.any(String),
      student2Id: expect.any(String),
    })
    expect(parsed.regularLessons.slice(1).map((row) => ({
      student2Id: row.student2Id,
      subject1: row.subject1,
    }))).toEqual(expect.arrayContaining([
      { student2Id: '', subject1: '国' },
      { student2Id: '', subject1: '数' },
    ]))

    const boardState = createPackedInitialBoardState({
      classroomSettings: parsed.classroomSettings,
      teachers: parsed.teachers,
      students: parsed.students,
      regularLessons: parsed.regularLessons,
    })

    const targetCell = boardState.weeks.flat().find((cell) => cell.id === '2026-04-07_4')
    const usedDesks = targetCell?.desks.filter((desk) => desk.teacher || desk.lesson?.studentSlots.some(Boolean)) ?? []

    expect(targetCell).toBeDefined()
    expect(usedDesks).toHaveLength(3)
    expect(usedDesks[0]?.teacher).toBe('田中講師')
    expect(usedDesks[0]?.lesson?.studentSlots.map((student) => student?.name ?? '')).toEqual(['生徒A', '生徒B'])
    expect(usedDesks[1]?.teacher).toBe('佐藤講師')
    expect(usedDesks[1]?.lesson?.studentSlots.map((student) => student?.name ?? '')).toEqual(['生徒C', ''])
    expect(usedDesks[2]?.teacher).toBe('青木講師')
    expect(usedDesks[2]?.lesson?.studentSlots.map((student) => student?.name ?? '')).toEqual(['生徒D', ''])
  })

  it('imports only visible regular lesson rows when Excel rows are hidden by filter or manual hide', () => {
    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '橋本', 表示名: '橋本', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '社:高3, 国:高3', メモ: '' },
      { 名前: '鈴木', 表示名: '鈴木', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '国:高3', メモ: '' },
      { 名前: '古谷', 表示名: '古谷', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3', メモ: '' },
    ]), '講師')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '杉山', 表示名: '杉山', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-01', 表示: '表示' },
      { 名前: '久井新', 表示名: '久井新', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-02', 表示: '表示' },
      { 名前: '佐藤藤', 表示名: '佐藤藤', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-03', 表示: '表示' },
    ]), '生徒')

    const regularSheet = xlsx.utils.json_to_sheet([
      { 年度: '2026年度', 講師: '橋本', 生徒1: '杉山', 科目1: '社', 共通期間開始: '', 共通期間終了: '', 生徒2: '', 科目2: '', 曜日: '火曜', 時限: 3 },
      { 年度: '2026年度', 講師: '鈴木', 生徒1: '久井新', 科目1: '国', 共通期間開始: '', 共通期間終了: '', 生徒2: '', 科目2: '', 曜日: '火曜', 時限: 3 },
      { 年度: '2026年度', 講師: '古谷', 生徒1: '佐藤藤', 科目1: '数', 共通期間開始: '', 共通期間終了: '', 生徒2: '', 科目2: '', 曜日: '火曜', 時限: 3 },
    ])
    regularSheet['!rows'] = [
      {},
      {},
      {},
      { hidden: true },
    ]
    xlsx.utils.book_append_sheet(workbook, regularSheet, '通常授業')

    const parsed = parseImportedBundle(xlsx, workbook, createTemplateBundle())

    expect(parsed.regularLessons).toHaveLength(2)
    expect(parsed.regularLessons.map((row) => row.teacherId)).toHaveLength(2)
    expect(parsed.regularLessons.map((row) => row.subject1)).toEqual(['社', '国'])
  })

  it('stops importing regular lesson rows after the first fully empty row', () => {
    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '橋本', 表示名: '橋本', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '社:高3', メモ: '' },
      { 名前: '鈴木', 表示名: '鈴木', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '国:高3', メモ: '' },
      { 名前: '古谷', 表示名: '古谷', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3', メモ: '' },
    ]), '講師')
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '杉山', 表示名: '杉山', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-01', 表示: '表示' },
      { 名前: '久井新', 表示名: '久井新', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-02', 表示: '表示' },
      { 名前: '佐藤藤', 表示名: '佐藤藤', メール: '', 入塾日: '2024-04-01', 退塾日: '', 生年月日: '2010-04-03', 表示: '表示' },
    ]), '生徒')

    const regularSheet = xlsx.utils.aoa_to_sheet([
      ['年度', '講師', '生徒1', '科目1', '共通期間開始', '共通期間終了', '生徒2', '科目2', '曜日', '時限'],
      ['2026年度', '橋本', '杉山', '社', '', '', '', '', '火曜', 3],
      ['2026年度', '鈴木', '久井新', '国', '', '', '', '', '火曜', 3],
      ['', '', '', '', '', '', '', '', '', ''],
      ['2026年度', '古谷', '佐藤藤', '数', '', '', '', '', '火曜', 3],
    ])
    xlsx.utils.book_append_sheet(workbook, regularSheet, '通常授業')

    const parsed = parseImportedBundle(xlsx, workbook, createTemplateBundle())

    expect(parsed.regularLessons).toHaveLength(2)
    expect(parsed.regularLessons.map((row) => row.subject1)).toEqual(['社', '国'])
  })
})