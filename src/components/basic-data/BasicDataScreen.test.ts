import { describe, expect, it } from 'vitest'
import * as xlsx from 'xlsx'
import { buildWorkbook, createTemplateBundle, mergeImportedBundle, parseImportedBundle } from './BasicDataScreen'

describe('BasicDataScreen parseImportedBundle', () => {
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
    }))
    expect(merged.students.find((row) => row.id === targetStudent?.id)).toEqual(expect.objectContaining({
      email: 'aoki-name-match@example.com',
    }))
  })
})

// 保護者向け固定QR(docs/spec-parent-portal.md §J-3 / §K-2): 写しトークンは Excel の列に無いため、
// 差分取込で一致行を丸ごと置き換えると消える。一致行から引き継ぐこと、Excel には出力しないことを固定する。
describe('BasicDataScreen parentPortalToken と Excel 取込/出力 (2026-09-13)', () => {
  const DEV_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1'

  function createFallbackWithToken() {
    const fallback = createTemplateBundle()
    const [first, second, ...rest] = fallback.students
    if (!first || !second) throw new Error('template students missing')
    return {
      ...fallback,
      students: [
        { ...first, parentPortalToken: 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAA', parentPortalTokenClassroomId: DEV_CLASSROOM_ID },
        second,
        ...rest,
      ],
    }
  }

  it('差分取込(ID 一致)で一致行の parentPortalToken と発行元教室タグを引き継ぐ', () => {
    const fallback = createFallbackWithToken()
    const target = fallback.students[0]
    const workbook = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 生徒ID: target.id, 名前: target.name, 表示名: '改名後', メール: '', 入塾日: target.entryDate, 退塾日: '', 生年月日: target.birthDate, 表示: '表示' },
    ]), '生徒')

    const merged = mergeImportedBundle(parseImportedBundle(xlsx, workbook, fallback), fallback)
    expect(merged.students.find((row) => row.id === target.id)).toEqual(expect.objectContaining({
      displayName: '改名後',
      parentPortalToken: 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      parentPortalTokenClassroomId: DEV_CLASSROOM_ID,
    }))
  })

  it('差分取込(名前一致・ID 列なし)でも引き継ぐ', () => {
    const fallback = createFallbackWithToken()
    const target = fallback.students[0]
    const workbook = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 名前: target.name, 表示名: target.displayName, メール: 'name-match@example.com', 入塾日: target.entryDate, 退塾日: '', 生年月日: target.birthDate, 表示: '表示' },
    ]), '生徒')

    const merged = mergeImportedBundle(parseImportedBundle(xlsx, workbook, fallback), fallback)
    expect(merged.students.find((row) => row.id === target.id)).toEqual(expect.objectContaining({
      email: 'name-match@example.com',
      parentPortalToken: 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      parentPortalTokenClassroomId: DEV_CLASSROOM_ID,
    }))
  })

  it('未発行の一致行・新規行にはトークン系フィールドを作らない(undefined キーも作らない)', () => {
    const fallback = createFallbackWithToken()
    const untouched = fallback.students[1]
    const workbook = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { 生徒ID: untouched.id, 名前: untouched.name, 表示名: untouched.displayName, メール: '', 入塾日: untouched.entryDate, 退塾日: '', 生年月日: untouched.birthDate, 表示: '表示' },
      { 名前: '新規 生徒', 表示名: '新規', メール: '', 入塾日: '2026-04-01', 退塾日: '', 生年月日: '2014-04-02', 表示: '表示' },
    ]), '生徒')

    const merged = mergeImportedBundle(parseImportedBundle(xlsx, workbook, fallback), fallback)
    const mergedUntouched = merged.students.find((row) => row.id === untouched.id)
    expect(mergedUntouched).toBeDefined()
    expect(Object.keys(mergedUntouched ?? {})).not.toContain('parentPortalToken')
    expect(Object.keys(mergedUntouched ?? {})).not.toContain('parentPortalTokenClassroomId')
    const added = merged.students.find((row) => row.name === '新規 生徒')
    expect(added).toBeDefined()
    expect(Object.keys(added ?? {})).not.toContain('parentPortalToken')
  })

  it('Excel 出力(buildWorkbook)にはトークンを一切載せない(ベアラートークンの漏えい防止)', () => {
    const fallback = createFallbackWithToken()
    const workbook = buildWorkbook(xlsx, fallback)
    const studentSheet = workbook.Sheets['生徒']
    expect(studentSheet).toBeDefined()
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(studentSheet)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('parentPortalToken')
      expect(Object.keys(row)).not.toContain('parentPortalTokenClassroomId')
    }
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain('tokenAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(serialized).not.toContain(DEV_CLASSROOM_ID)
  })
})
