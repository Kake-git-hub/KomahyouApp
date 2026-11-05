// 退塾取消(オーナー確定 2026-11-05・docs/spec-basic-data.md §H)。
//
// 背景: 室長が誤って生徒を退塾にした。退塾後の行は編集できず(isStudentRowLockedByWithdrawal)「削除」しか無かったので、
// 「退塾生徒」一覧に「退塾取消」を足す。取り消すと退塾日を未入力に戻して在籍へ戻す。
//   - 戻るもの: 未消化の振替・講習の残数(台帳に残っていて一覧で隠していただけ)と、テンプレ由来の通常授業(再マージで戻る)。
//   - 戻らないもの: 退塾スイープが消した「今日以降に手で置いたコマと出欠記録」。今後の退塾だけ、消した内容を
//     名簿行の withdrawSweepRemovedLessons に残し、取消の確認画面に一覧で出す。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { StudentRow, StudentWithdrawRemovedLesson } from './basicDataModel'
import {
  appendStudentWithdrawSweepRemovedLessons,
  applyStudentWithdrawCancel,
  applyStudentWithdrawToday,
  buildStudentWithdrawCancelConfirmation,
  canCancelStudentWithdrawal,
  canWithdrawStudentToday,
  formatStudentWithdrawRemovedLesson,
  isStudentRowLockedByWithdrawal,
  preserveWithdrawnStudentRowsOnImport,
} from './withdrawGuard'

const TODAY = '2026-11-05' // 木

function row(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 's001',
    name: '生徒 A',
    displayName: '生徒A',
    email: '',
    entryDate: '2025-04-01',
    withdrawDate: '',
    birthDate: '2012-05-01',
    ...overrides,
  }
}

const makeupSeat: StudentWithdrawRemovedLesson = { dateKey: '2026-11-12', slotNumber: 3, kind: 'seat', lessonType: 'makeup', subject: '国' }
const holidayRecord: StudentWithdrawRemovedLesson = { dateKey: '2026-11-03', slotNumber: 3, kind: 'status', lessonType: 'regular', subject: '国', status: 'holiday' }

describe('canCancelStudentWithdrawal(「退塾取消」ボタンを出す条件)', () => {
  it('退塾日を迎えて非在籍(行がロック中)の生徒には出す(当日・過去の退塾日)', () => {
    expect(canCancelStudentWithdrawal(row({ withdrawDate: TODAY }), TODAY)).toBe(true)
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '2026-10-01' }), TODAY)).toBe(true)
    // スラッシュ書式(Excel 由来)も共有の在籍判定どおり。
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '2026/10/1' }), TODAY)).toBe(true)
  })

  it('在籍中(退塾日なし・未定・未来の退塾日)には出さない(退塾日は今までどおり直接直せる)', () => {
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '' }), TODAY)).toBe(false)
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '未定' }), TODAY)).toBe(false)
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '2026-11-06' }), TODAY)).toBe(false)
  })

  it('アプリ上で削除済み(deletedAt)の生徒には出さない', () => {
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '2026-10-01', deletedAt: '2026-10-02T00:00:00.000Z' }), TODAY)).toBe(false)
  })

  it('高3卒業済み(退塾日を外しても非在籍)には出さない(生年月日の打ち間違いは「生年月日を修正」で直す)', () => {
    // 2007-05 生まれ = 2026-03-31 卒業。卒業の自動入力 3/31 が入っていても、手で入れた退塾日でも出さない。
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '2026-03-31', birthDate: '2007-05-01', graduationWithdrawAutoFilledAt: '2026-04-01T00:00:00.000Z' }), TODAY)).toBe(false)
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '2026-02-01', birthDate: '2007-05-01' }), TODAY)).toBe(false)
    expect(canCancelStudentWithdrawal(row({ withdrawDate: '', birthDate: '2007-05-01' }), TODAY)).toBe(false)
  })
})

describe('applyStudentWithdrawCancel(退塾日を未入力へ戻して在籍に戻す)', () => {
  const students: StudentRow[] = [
    row({ id: 's001', withdrawDate: TODAY, withdrawSweepRemovedLessons: [makeupSeat], graduationWithdrawAutoFilledAt: '2026-04-01T00:00:00.000Z', isExternal: true, parentPortalToken: 'tok', parentPortalTokenClassroomId: 'c1' }),
    row({ id: 's002', name: '生徒 B', withdrawDate: '2026-10-01', withdrawSweepRemovedLessons: [holidayRecord] }),
  ]

  it('対象の生徒だけ: 退塾日を「未入力」(新規生徒行の既定値と同じ空文字)にし、卒業の自動入力の印と戻らない授業の記録を外す', () => {
    const next = applyStudentWithdrawCancel(students, 's001')
    expect(next).toHaveLength(2)
    expect(next[0].withdrawDate).toBe('')
    expect('graduationWithdrawAutoFilledAt' in next[0]).toBe(false)
    expect('withdrawSweepRemovedLessons' in next[0]).toBe(false)
    // 他の項目は変えない。
    const { withdrawDate: _a, graduationWithdrawAutoFilledAt: _b, withdrawSweepRemovedLessons: _c, ...rest } = students[0]
    void _a; void _b; void _c
    expect(next[0]).toEqual({ ...rest, withdrawDate: '' })
    // 他の生徒は同じ参照のまま。
    expect(next[1]).toBe(students[1])
  })

  it('取り消した生徒は行のロックが解け、在籍の扱い(「退塾」ボタンが出る)に戻る', () => {
    const [cancelled] = applyStudentWithdrawCancel(students, 's001')
    expect(isStudentRowLockedByWithdrawal(students[0], TODAY)).toBe(true)
    expect(isStudentRowLockedByWithdrawal(cancelled, TODAY)).toBe(false)
    expect(canWithdrawStudentToday(cancelled, TODAY)).toBe(true)
    expect(canCancelStudentWithdrawal(cancelled, TODAY)).toBe(false)
  })

  it('入力を書き換えない・該当なしなら同じ内容を返す・削除済みの行は触らない', () => {
    const frozen = students.map((entry) => Object.freeze({ ...entry }))
    applyStudentWithdrawCancel(frozen, 's001')
    expect(frozen[0].withdrawDate).toBe(TODAY)
    expect(applyStudentWithdrawCancel(students, 's999')).toEqual(students)
    const deleted = [row({ id: 's003', withdrawDate: '2026-10-01', deletedAt: '2026-10-02T00:00:00.000Z' })]
    expect(applyStudentWithdrawCancel(deleted, 's003')[0]).toBe(deleted[0])
  })
})

describe('applyStudentWithdrawToday は「戻らない授業」の記録を始める(記録あり 0 件 と 記録なし を区別する)', () => {
  it('退塾ボタンで退塾した生徒には withdrawSweepRemovedLessons: [] が入る(他の生徒は不変)', () => {
    const students = [row({ id: 's001' }), row({ id: 's002' })]
    const next = applyStudentWithdrawToday(students, 's001', TODAY)
    expect(next[0]).toEqual({ ...students[0], withdrawDate: TODAY, withdrawSweepRemovedLessons: [] })
    expect(next[1]).toBe(students[1])
  })
})

describe('appendStudentWithdrawSweepRemovedLessons(退塾スイープが消した内容を名簿行へ追記)', () => {
  it('該当の生徒の記録へ追記し、同じ内容は二重に足さない。他の生徒は同じ参照のまま', () => {
    const students = [row({ id: 's001', withdrawDate: TODAY, withdrawSweepRemovedLessons: [makeupSeat] }), row({ id: 's002' })]
    const next = appendStudentWithdrawSweepRemovedLessons(students, [{ studentId: 's001', removedLessons: [makeupSeat, holidayRecord, { ...holidayRecord }] }])
    expect(next[0].withdrawSweepRemovedLessons).toEqual([makeupSeat, holidayRecord])
    expect(next[1]).toBe(students[1])
    // 入力は書き換えない。
    expect(students[0].withdrawSweepRemovedLessons).toEqual([makeupSeat])
  })

  it('記録の無い生徒(日付入力で退塾日を入れた生徒)にも、消した分から記録を作る', () => {
    const students = [row({ id: 's001', withdrawDate: TODAY })]
    const next = appendStudentWithdrawSweepRemovedLessons(students, [{ studentId: 's001', removedLessons: [makeupSeat] }])
    expect(next[0].withdrawSweepRemovedLessons).toEqual([makeupSeat])
  })

  it('足すものが無ければ同じ配列を返す(開いただけで未保存にしない)・名簿に居ない生徒は無視する', () => {
    const students = [row({ id: 's001', withdrawDate: TODAY, withdrawSweepRemovedLessons: [makeupSeat] })]
    expect(appendStudentWithdrawSweepRemovedLessons(students, [])).toBe(students)
    expect(appendStudentWithdrawSweepRemovedLessons(students, [{ studentId: 's001', removedLessons: [] }])).toBe(students)
    expect(appendStudentWithdrawSweepRemovedLessons(students, [{ studentId: 's001', removedLessons: [{ ...makeupSeat }] }])).toBe(students)
    expect(appendStudentWithdrawSweepRemovedLessons(students, [{ studentId: 's999', removedLessons: [holidayRecord] }])).toBe(students)
  })
})

describe('buildStudentWithdrawCancelConfirmation(確認の画面の文)', () => {
  it('取り消して在籍に戻すこと、戻るもの・戻らないものを伝える', () => {
    const confirmation = buildStudentWithdrawCancelConfirmation({ name: '生徒A', removedLessons: [] })
    expect(confirmation.title).toBe('生徒A の退塾を取り消します')
    expect(confirmation.summary).toBe('生徒A の退塾を取り消して在籍に戻します。')
    expect(confirmation.message).toContain('未消化の振替・講習の残数と通常授業')
    expect(confirmation.message).toContain('退塾後に消えた手置きのコマ・出欠記録')
    expect(confirmation.message).toContain('必要なら置き直してください')
  })

  it('記録あり 1 件以上: 「戻らない授業」を日付・曜日・時限・種類・科目で日付順に並べる', () => {
    const confirmation = buildStudentWithdrawCancelConfirmation({ name: '生徒A', removedLessons: [makeupSeat, holidayRecord] })
    expect(confirmation.removedLessonsState).toBe('listed')
    expect(confirmation.removedLessonsHeading).toContain('戻らない授業')
    expect(confirmation.removedLessonLines).toEqual(['11/3(火) 3限 休日の記録 国', '11/12(木) 3限 振替 国'])
  })

  it('記録あり 0 件: 「退塾後に消えた授業はありません」', () => {
    const confirmation = buildStudentWithdrawCancelConfirmation({ name: '生徒A', removedLessons: [] })
    expect(confirmation.removedLessonsState).toBe('none')
    expect(confirmation.removedLessonsHeading).toBe('退塾後に消えた授業はありません。')
    expect(confirmation.removedLessonLines).toEqual([])
  })

  it('記録なし(この機能より前の退塾など): 記録が無いことを伝える', () => {
    const confirmation = buildStudentWithdrawCancelConfirmation({ name: '', removedLessons: undefined })
    expect(confirmation.title).toBe('この生徒 の退塾を取り消します')
    expect(confirmation.removedLessonsState).toBe('unrecorded')
    expect(confirmation.removedLessonsHeading).toBe('消えた授業の記録がありません（この機能を入れる前の退塾など）。')
    expect(confirmation.removedLessonLines).toEqual([])
  })

  it('種類のラベルは盤面と同じ語彙(通常・振替・講習・増コマ・体験 / 出席・休み・振無休・移動元・休日の記録)', () => {
    const base = { dateKey: '2026-11-05', slotNumber: 1, subject: '数' }
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'seat', lessonType: 'special' })).toBe('11/5(木) 1限 講習 数')
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'seat', lessonType: 'extra' })).toBe('11/5(木) 1限 増コマ 数')
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'seat', lessonType: 'trial' })).toBe('11/5(木) 1限 体験 数')
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'seat', lessonType: 'regular' })).toBe('11/5(木) 1限 通常 数')
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'status', lessonType: 'regular', status: 'attended' })).toBe('11/5(木) 1限 出席の記録 数')
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'status', lessonType: 'regular', status: 'absent' })).toBe('11/5(木) 1限 休みの記録 数')
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'status', lessonType: 'regular', status: 'absent-no-makeup' })).toBe('11/5(木) 1限 振無休の記録 数')
    expect(formatStudentWithdrawRemovedLesson({ ...base, kind: 'status', lessonType: 'regular', status: 'moved' })).toBe('11/5(木) 1限 移動元の記録 数')
  })
})

describe('新しい項目(withdrawSweepRemovedLessons)が名簿の取り込みで落ちない', () => {
  it('Excel 差分取り込みでも退塾済みの行は取り込み前のまま(記録ごと残る)', () => {
    const current = [row({ id: 's001', withdrawDate: TODAY, withdrawSweepRemovedLessons: [makeupSeat] })]
    // 取り込み結果(Excel には列が無い)は記録を持たない。
    const imported = [row({ id: 's001', withdrawDate: TODAY })]
    expect(preserveWithdrawnStudentRowsOnImport(imported, current, TODAY)[0].withdrawSweepRemovedLessons).toEqual([makeupSeat])
  })

  it('保存(JSON)→読み込みで落ちない', () => {
    const students = [row({ id: 's001', withdrawDate: TODAY, withdrawSweepRemovedLessons: [makeupSeat, holidayRecord] })]
    expect(JSON.parse(JSON.stringify(students))).toEqual(students)
  })
})

// 配線(巨大コンポーネントは描画テストができないので字面で固定する)。
const BASIC_TSX = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

function sliceFrom(source: string, marker: string, length: number): string {
  const index = source.indexOf(marker)
  expect(index, `marker not found: ${marker}`).toBeGreaterThan(0)
  return source.slice(index, index + length)
}

describe('退塾取消の配線', () => {
  it('「退塾生徒」一覧だけに、出す条件 canCancelStudentWithdrawal を満たす行へ「退塾取消」を出す(機能フラグなし)', () => {
    expect(BASIC_TSX).toContain("studentRosterView === 'withdrawn' && canCancelStudentWithdrawal(row, todayReferenceDate)")
    expect(BASIC_TSX).toContain('data-testid={`basic-data-cancel-withdraw-student-${row.id}`}>退塾取消</button>')
  })

  it('確定は名簿の退塾日を戻すだけ(盤面・在庫台帳に触らない)・操作痕跡に残す', () => {
    const confirm = sliceFrom(BASIC_TSX, 'const confirmStudentWithdrawCancel = () => {', 900)
    expect(confirm).toContain('applyStudentWithdrawCancel(current, withdrawCancelModalState.id)')
    expect(confirm).toContain("recordOperationTrace('navigation'")
    expect(confirm).not.toContain('manualMakeupAdjustments')
    expect(confirm).not.toContain('manualLectureStockCounts')
  })

  it('確認の画面は退塾の確認と同じ作法(1 行＋畳んだ詳細)で、文は buildStudentWithdrawCancelConfirmation から作る', () => {
    const modal = sliceFrom(BASIC_TSX, 'const confirmation = buildStudentWithdrawCancelConfirmation({', 2600)
    expect(modal).toContain('data-testid="basic-data-withdraw-cancel-summary"')
    expect(modal).toContain('data-testid="basic-data-withdraw-cancel-detail"')
    expect(modal).toContain('data-testid="basic-data-withdraw-cancel-confirm-button"')
    expect(modal).toContain('confirmation.removedLessonLines.map(')
  })

  it('盤面の退塾スイープが消した内容は、App が開いている教室の名簿行へだけ追記する(INV-08)', () => {
    expect(APP_TSX).toContain('onStudentWithdrawSweepApplied={handleStudentWithdrawSweepApplied}')
    const handler = sliceFrom(APP_TSX, 'const handleStudentWithdrawSweepApplied = useCallback(', 700)
    expect(handler).toContain('loadedEditingClassroomIdRef.current !== actingClassroomId')
    expect(handler).toContain('setStudents((current) => appendStudentWithdrawSweepRemovedLessons(current, results))')
  })
})
