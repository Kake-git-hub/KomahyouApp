import { describe, expect, it } from 'vitest'
import * as xlsx from 'xlsx'
import { createTemplateBundle, mergeImportedBundle, parseImportedBundle } from './BasicDataScreen'

describe('BasicDataScreen parseImportedBundle', () => {
  it('parses imported teacher available slots', () => {
    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '田中講師', 表示名: '田中講師', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3', 出勤可能コマ: '月4限, 木2限, 日5限', メモ: '' },
    ]), '講師')

    const parsed = parseImportedBundle(xlsx, workbook, createTemplateBundle())

    expect(parsed.teachers[0]).toMatchObject({
      availableSlots: [
        { dayOfWeek: 1, slotNumber: 4 },
        { dayOfWeek: 4, slotNumber: 2 },
        { dayOfWeek: 0, slotNumber: 5 },
      ],
    })
  })

  it('assigns sequential ids to imported rows without id columns', () => {
    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: '新規講師A', 表示名: '講師A', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '数:高3', メモ: '' },
      { 名前: '新規講師B', 表示名: '講師B', メール: '', 入塾日: '2024-04-01', 退塾日: '', 表示: '表示', 担当科目: '英:高3', メモ: '' },
    ]), '講師')

    const parsed = parseImportedBundle(xlsx, workbook, createTemplateBundle())

    expect(parsed.teachers.map((row) => row.id)).toEqual(['t011', 't012'])
  })

  it('merges imported basic data as diffs while preserving existing ids and unrelated rows', () => {
    const fallback = createTemplateBundle()
    const targetTeacher = fallback.teachers[0]
    const untouchedTeacher = fallback.teachers[1]
    const targetStudent = fallback.students[0]
    const untouchedStudent = fallback.students[1]

    expect(targetTeacher).toBeDefined()
    expect(untouchedTeacher).toBeDefined()
    expect(targetStudent).toBeDefined()
    expect(untouchedStudent).toBeDefined()

    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        講師ID: targetTeacher?.id,
        名前: targetTeacher?.name,
        表示名: '田中先生',
        メール: 'tanaka-updated@example.com',
        入塾日: targetTeacher?.entryDate,
        退塾日: '',
        表示: '表示',
        担当科目: '数:高3, 英:高3',
        メモ: '差分更新',
      },
    ]), '講師')

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        生徒ID: targetStudent?.id,
        名前: targetStudent?.name,
        表示名: '青木たろう',
        メール: 'aoki-updated@example.com',
        入塾日: targetStudent?.entryDate,
        退塾日: '',
        生年月日: targetStudent?.birthDate,
        表示: '表示',
      },
    ]), '生徒')

    const imported = parseImportedBundle(xlsx, workbook, fallback)
    const merged = mergeImportedBundle(imported, fallback)

    expect(merged.teachers).toHaveLength(fallback.teachers.length)
    expect(merged.students).toHaveLength(fallback.students.length)
    expect(merged.teachers.find((row) => row.id === targetTeacher?.id)).toEqual(expect.objectContaining({
      displayName: '田中先生',
      email: 'tanaka-updated@example.com',
      memo: '差分更新',
    }))
    expect(merged.teachers.find((row) => row.id === untouchedTeacher?.id)).toEqual(untouchedTeacher)
    expect(merged.students.find((row) => row.id === targetStudent?.id)).toEqual(expect.objectContaining({
      displayName: '青木たろう',
      email: 'aoki-updated@example.com',
    }))
    expect(merged.students.find((row) => row.id === untouchedStudent?.id)).toEqual(untouchedStudent)
  })

  it('merges imported rows by visible names when id columns are absent', () => {
    const fallback = createTemplateBundle()
    const targetTeacher = fallback.teachers[0]
    const targetStudent = fallback.students[0]

    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        名前: targetTeacher?.name,
        表示名: targetTeacher?.displayName,
        メール: 'tanaka-name-match@example.com',
        入塾日: targetTeacher?.entryDate,
        退塾日: '',
        表示: '表示',
        担当科目: '数:高3',
        メモ: '名前照合',
      },
    ]), '講師')

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        名前: targetStudent?.name,
        表示名: targetStudent?.displayName,
        メール: 'aoki-name-match@example.com',
        入塾日: targetStudent?.entryDate,
        退塾日: '',
        生年月日: targetStudent?.birthDate,
        表示: '表示',
      },
    ]), '生徒')

    const imported = parseImportedBundle(xlsx, workbook, fallback)
    const merged = mergeImportedBundle(imported, fallback)

    expect(merged.teachers.find((row) => row.id === targetTeacher?.id)).toEqual(expect.objectContaining({
      email: 'tanaka-name-match@example.com',
      memo: '名前照合',
    }))
    expect(merged.students.find((row) => row.id === targetStudent?.id)).toEqual(expect.objectContaining({
      email: 'aoki-name-match@example.com',
    }))
  })
})