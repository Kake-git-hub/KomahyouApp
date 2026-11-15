// 講師日程共有(BoardShareScreen)の生徒の欄に出す 2 段の文字(docs/spec-schedule-pdf.md §N・2026-11-15 オーナー確定)。
// 上段 = 名前＋記録の印(記録だけの席は「(休」・名前とは別の欄で「…」に巻き込まない)、下段 = 授業の印・学年・科目＋授業時間・講師の種別(通常講師は空)。
// 見た目だけの変更なので、印・授業時間・講師の種別・記録の印は既存の規則(getLessonShortLabel ほか)と同じ結果になることを固定する。
import { describe, expect, it } from 'vitest'
import type { BoardShareStatusEntry, BoardShareStudentEntry } from '../../integrations/firebase/boardShare'
import { resolveBoardShareSeatLines, resolveBoardShareSeatView } from './BoardShareScreen'

function createStudent(overrides: Partial<BoardShareStudentEntry> = {}): BoardShareStudentEntry {
  return {
    id: '2026-09-28_4_1_0_trial',
    name: '体験 花子',
    managedStudentId: undefined,
    grade: '小5',
    noteSuffix: '',
    makeupSourceDate: undefined,
    makeupSourceLabel: undefined,
    subject: '算',
    lessonType: 'trial',
    teacherType: 'normal',
    ...overrides,
  }
}

function createAbsentStatus(overrides: Partial<BoardShareStatusEntry> = {}): BoardShareStatusEntry {
  return {
    id: 's026_2026-09-28_数_absent',
    name: '欠席 太郎',
    managedStudentId: 's026',
    grade: '中2',
    noteSuffix: '',
    makeupSourceDate: undefined,
    makeupSourceLabel: undefined,
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    moveDestinationDateKey: undefined,
    status: 'absent',
    linkedDestinationDateKey: '2026-10-05',
    ...overrides,
  }
}

describe('resolveBoardShareSeatLines: 生徒の欄の 2 段', () => {
  it('通常の生徒: 上段は名前だけ、下段は 通・学年・科目、通常講師は種別を出さない', () => {
    expect(resolveBoardShareSeatLines(createStudent({ name: '山田 太郎', grade: '中2', subject: '数', lessonType: 'regular' }), null))
      .toEqual({ name: '山田 太郎', statusLabel: '', marker: '通', markerLabel: '通常', grade: '中2', subject: '数', teacherTypeLabel: '' })
  })

  it('授業時間は科目に続ける(数60)', () => {
    expect(resolveBoardShareSeatLines(createStudent({ subject: '数', noteSuffix: '60' }), null)?.subject).toBe('数60')
  })

  it('授業の印 5 種: 通 / 振 / 講 / 増 / 体 と、その全角の名前', () => {
    const cases = [
      ['regular', '通', '通常'],
      ['makeup', '振', '振替'],
      ['special', '講', '講習'],
      ['extra', '増', '増コマ'],
      ['trial', '体', '体験'],
    ] as const
    for (const [lessonType, marker, markerLabel] of cases) {
      expect(resolveBoardShareSeatLines(createStudent({ lessonType }), null), lessonType).toMatchObject({ marker, markerLabel })
    }
  })

  it('外部生: どの授業の種類でも 外 / 外部生', () => {
    expect(resolveBoardShareSeatLines(createStudent({ lessonType: 'makeup' }), null, { isExternalStudent: true }))
      .toMatchObject({ marker: '外', markerLabel: '外部生' })
    expect(resolveBoardShareSeatLines(createStudent({ lessonType: 'regular' }), null, { isExternalStudent: true }))
      .toMatchObject({ marker: '外', markerLabel: '外部生' })
  })

  it('講師の種別: 代行講師 / 担当科目外講師', () => {
    expect(resolveBoardShareSeatLines(createStudent({ teacherType: 'substitute' }), null)?.teacherTypeLabel).toBe('代行講師')
    expect(resolveBoardShareSeatLines(createStudent({ teacherType: 'outside' }), null)?.teacherTypeLabel).toBe('担当科目外講師')
  })

  it('記録だけの席: 名前は名前だけ、記録の印は statusLabel に分ける(名前の「…」に印を巻き込まない)', () => {
    const absent = createAbsentStatus({ name: '欠席 太郎', status: 'absent' })
    expect(resolveBoardShareSeatLines(absent, absent)).toMatchObject({ name: '欠席 太郎', statusLabel: '(休' })
  })

  it('記録の印: 振無休 / 出 / 移(フラグ ON で休) / 休日は休', () => {
    const noMakeup = createAbsentStatus({ status: 'absent-no-makeup' })
    expect(resolveBoardShareSeatLines(noMakeup, noMakeup)?.statusLabel).toBe('(振無休')
    const attended = createAbsentStatus({ status: 'attended' })
    expect(resolveBoardShareSeatLines(attended, attended)?.statusLabel).toBe('(出')
    const moved = createAbsentStatus({ status: 'moved' })
    expect(resolveBoardShareSeatLines(moved, moved)?.statusLabel).toBe('(移')
    expect(resolveBoardShareSeatLines(moved, moved, { transferSourceRestDisplayEnabled: true })?.statusLabel).toBe('(休')
    const holiday = createAbsentStatus({ status: 'holiday' })
    expect(resolveBoardShareSeatLines(holiday, holiday)?.statusLabel).toBe('(休')
    for (const status of [noMakeup, attended, moved, holiday]) expect(resolveBoardShareSeatLines(status, status)?.name, status.status).toBe('欠席 太郎')
  })

  it('空の席は null', () => {
    expect(resolveBoardShareSeatLines(null, null)).toBeNull()
    expect(resolveBoardShareSeatLines(undefined, undefined)).toBeNull()
  })

  it('INV-04: 別の生徒の休み記録が残る席に体験生が居る → 体験生の名前に (休 が付かない', () => {
    const view = resolveBoardShareSeatView(createStudent({ name: '体験 花子', lessonType: 'trial' }), createAbsentStatus())
    const lines = resolveBoardShareSeatLines(view.visibleStudent, view.visibleStatus)
    expect(lines?.name).toBe('体験 花子')
    expect(lines?.statusLabel).toBe('')
    expect(lines?.marker).toBe('体')
    expect(lines?.grade).toBe('小5')
  })
})
