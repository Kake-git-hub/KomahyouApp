import { describe, expect, it } from 'vitest'
import * as xlsx from 'xlsx'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { SpecialSessionRow } from './specialSessionModel'
import { buildSpecialSessionWorkbook, parseSpecialSessionWorkbook } from './SpecialSessionScreen'

const students: StudentRow[] = [
  {
    id: 's001',
    name: '青木 太郎',
    displayName: '青木太郎',
    email: 'aoki@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    birthDate: '2010-05-14',
    isHidden: false,
  },
]

const teachers: TeacherRow[] = [
  {
    id: 't001',
    name: '田中講師',
    email: 'tanaka@example.com',
    entryDate: '2024-04-01',
    withdrawDate: '未定',
    isHidden: false,
    subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
    memo: '',
  },
]

const sessions: SpecialSessionRow[] = [
  {
    id: 'session_2026_spring',
    label: '2026 春期講習',
    startDate: '2026-03-23',
    endDate: '2026-04-05',
    studentInputs: {
      s001: {
        unavailableSlots: ['2026-03-24_2'],
        regularBreakSlots: ['2026-03-25_3'],
        subjectSlots: { 数: 2, 英: 1 },
        regularOnly: false,
        countSubmitted: true,
        updatedAt: '2026-03-20 12:00',
      },
    },
    teacherInputs: {
      t001: {
        unavailableSlots: ['2026-03-26_4'],
        countSubmitted: true,
        updatedAt: '2026-03-20 12:30',
      },
    },
    createdAt: '2026-03-15 09:00',
    updatedAt: '2026-03-20 12:45',
  },
]

describe('SpecialSessionScreen Excel workbook', () => {
  it('exports student and teacher input sheets', () => {
    const workbook = buildSpecialSessionWorkbook(xlsx, sessions, students, teachers)

    const studentRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['生徒日程入力'], { defval: '' })
    const teacherRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['講師日程入力'], { defval: '' })

    expect(studentRows).toEqual([
      expect.objectContaining({
        講習ID: 'session_2026_spring',
        講習名: '2026 春期講習',
        生徒ID: 's001',
        生徒名: '青木太郎',
        参加不可コマ: '2026-03-24_2',
        希望科目数: '英:1, 数:2',
        通常のみ: false,
        希望科目数提出済: true,
        入力更新日時: '2026/3/20 12:00',
      }),
    ])
    expect(teacherRows).toEqual([
      expect.objectContaining({
        講習ID: 'session_2026_spring',
        講習名: '2026 春期講習',
        講師ID: 't001',
        講師名: '田中講師',
        参加不可コマ: '2026-03-26_4',
        講師予定提出済: true,
      }),
    ])
  })

  it('imports student and teacher input sheets', () => {
    const workbook = xlsx.utils.book_new()

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        講習ID: 'session_2026_spring',
        講習名: '2026 春期講習',
        開始日: '2026/3/23',
        終了日: '2026/4/5',
        作成日時: '2026/3/15 09:00',
        更新日時: '2026/3/21 10:00',
      },
    ]), '特別講習')

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        講習ID: 'session_2026_spring',
        講習名: '2026 春期講習',
        生徒ID: 's001',
        生徒名: '青木太郎',
        参加不可コマ: '2026-03-24_2, 2026-03-27_1',
        希望科目数: '数:2, 英:1',
        通常のみ: false,
        希望科目数提出済: true,
        入力更新日時: '2026/3/21 10:30',
      },
    ]), '生徒日程入力')

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      {
        講習ID: 'session_2026_spring',
        講習名: '2026 春期講習',
        講師ID: 't001',
        講師名: '田中講師',
        参加不可コマ: '2026-03-26_4',
        講師予定提出済: true,
        入力更新日時: '2026/3/21 10:40',
      },
    ]), '講師日程入力')

    const parsed = parseSpecialSessionWorkbook(xlsx, workbook, [])

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual(expect.objectContaining({
      id: 'session_2026_spring',
      label: '2026 春期講習',
      startDate: '2026-03-23',
      endDate: '2026-04-05',
    }))
    expect(parsed[0]?.studentInputs.s001).toEqual({
      unavailableSlots: ['2026-03-24_2', '2026-03-27_1'],
      regularBreakSlots: [],
      subjectSlots: { 数: 2, 英: 1 },
      regularOnly: false,
      countSubmitted: true,
      updatedAt: '2026-03-21 10:30',
    })
    expect(parsed[0]?.teacherInputs.t001).toEqual({
      unavailableSlots: ['2026-03-26_4'],
      countSubmitted: true,
      updatedAt: '2026-03-21 10:40',
    })
  })
})