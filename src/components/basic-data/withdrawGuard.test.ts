import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isActiveOnDate, isStudentDeletedFromApp, resolveManagedRosterStatus, resolveManagedStudentRosterStatus } from './basicDataModel'
import { applyStudentWithdrawToday, buildStudentWithdrawConfirmation, canDeleteStudentFromApp, canWithdrawStudentToday, filterStudentsVisibleInBasicData, isStudentInWithdrawnRosterList, markStudentDeletedFromApp } from './withdrawGuard'

const TODAY = '2026-09-13'

describe('canWithdrawStudentToday（退塾ボタンを出す条件）', () => {
  it('退塾日が未定の在籍生徒には出す', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '', birthDate: '2012-05-01' }, TODAY)).toBe(true)
    expect(canWithdrawStudentToday({ withdrawDate: '未定', birthDate: '2012-05-01' }, TODAY)).toBe(true)
  })

  it('将来の退塾日が入っている在籍生徒にも出す（押すと今日付けに置き換え）', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '2026-10-31', birthDate: '2012-05-01' }, TODAY)).toBe(true)
  })

  it('今日付けで退塾済み（当日から非在籍）の生徒には出さない＝二度押し防止', () => {
    expect(canWithdrawStudentToday({ withdrawDate: TODAY, birthDate: '2012-05-01' }, TODAY)).toBe(false)
  })

  it('退塾日を過ぎた非在籍の生徒・高3卒業後の生徒には出さない', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '2026-08-31', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(canWithdrawStudentToday({ withdrawDate: '', birthDate: '2000-05-01' }, TODAY)).toBe(false)
  })
})

describe('isStudentInWithdrawnRosterList（退塾ボタンを押したらすぐ一覧から外す・2026-09-15）', () => {
  it('退塾日が今日の生徒は、押した直後から非在籍一覧に入る（在籍一覧に残らない）', () => {
    const [withdrawn] = applyStudentWithdrawToday([{ id: 's001', withdrawDate: '', birthDate: '2012-05-01' }], 's001', TODAY)
    expect(isStudentInWithdrawnRosterList(withdrawn, TODAY)).toBe(true)
  })

  // 2026-09-15 改定(確認リスト v1.5.527 b-2): 生徒の退塾日は「その日から非在籍」。退塾日は今日のまま記録し(前日付けにしない)、
  // 共有の生徒在籍判定(盤面/請求/保護者QR が使う isActiveOnDate)も今日から非在籍になる＝一覧の特別扱いと食い違わない。
  it('退塾日は今日のまま記録し、共有の生徒在籍判定でも今日から非在籍になる（前日=在籍/当日=非在籍/翌日=非在籍）', () => {
    const [withdrawn] = applyStudentWithdrawToday([{ id: 's001', withdrawDate: '', birthDate: '2012-05-01' }], 's001', TODAY)
    expect(withdrawn.withdrawDate).toBe(TODAY)
    expect(isActiveOnDate('', withdrawn.withdrawDate, withdrawn.birthDate, '2026-09-12')).toBe(true)
    expect(isActiveOnDate('', withdrawn.withdrawDate, withdrawn.birthDate, TODAY)).toBe(false)
    expect(isActiveOnDate('', withdrawn.withdrawDate, withdrawn.birthDate, '2026-09-14')).toBe(false)
    expect(resolveManagedStudentRosterStatus(withdrawn.withdrawDate, withdrawn.birthDate, '2026-09-12')).toBe('在籍')
    expect(resolveManagedStudentRosterStatus(withdrawn.withdrawDate, withdrawn.birthDate, TODAY)).toBe('非在籍')
    expect(isStudentInWithdrawnRosterList(withdrawn, '2026-09-12')).toBe(false)
    expect(isStudentInWithdrawnRosterList(withdrawn, TODAY)).toBe(true)
    expect(isStudentInWithdrawnRosterList(withdrawn, '2026-09-14')).toBe(true)
  })

  it('講師用の判定(退職日当日は在籍)は変えていない＝生徒の一覧振り分けを講師用へ戻すと当日在籍一覧に残る', () => {
    expect(resolveManagedRosterStatus(TODAY, '', TODAY)).toBe('在籍')
  })

  it('未定・将来の退塾日は在籍一覧、過去の退塾日・高3卒業後は非在籍一覧', () => {
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '未定', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '2026-09-14', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '2026-08-31', birthDate: '2012-05-01' }, TODAY)).toBe(true)
    expect(isStudentInWithdrawnRosterList({ withdrawDate: '', birthDate: '2000-05-01' }, TODAY)).toBe(true)
  })

  it('基本データ画面の在籍/非在籍一覧はこの判定で振り分ける（当日在籍の判定に戻さない）', () => {
    const source = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8')
    expect(source).toContain('filterStudentsVisibleInBasicData(students).filter((student) => !isStudentInWithdrawnRosterList(student, todayReferenceDate))')
    expect(source).toContain('filterStudentsVisibleInBasicData(students).filter((student) => isStudentInWithdrawnRosterList(student, todayReferenceDate))')
  })
})

describe('applyStudentWithdrawToday（押した日を退塾日として記録・データは残す）', () => {
  const students = [
    { id: 's001', name: '生徒A', withdrawDate: '', birthDate: '2012-05-01' },
    { id: 's002', name: '生徒B', withdrawDate: '未定', birthDate: '2011-05-01' },
  ]

  it('対象生徒の退塾日だけを今日にし、行は削除しない', () => {
    const next = applyStudentWithdrawToday(students, 's002', TODAY)
    expect(next).toHaveLength(2)
    expect(next.map((row) => row.id)).toEqual(['s001', 's002'])
    expect(next[1]).toEqual({ ...students[1], withdrawDate: TODAY })
    expect(next[0]).toBe(students[0])
  })

  it('元の配列を書き換えない', () => {
    applyStudentWithdrawToday(students, 's001', TODAY)
    expect(students[0].withdrawDate).toBe('')
  })
})

describe('buildStudentWithdrawConfirmation', () => {
  it('今日の日付と「データは削除されず残る」ことを伝える', () => {
    const confirmation = buildStudentWithdrawConfirmation({ name: '生徒A', today: TODAY, currentWithdrawDate: '' })
    expect(confirmation.title).toBe('生徒A を退塾にします')
    expect(confirmation.message).toContain(TODAY)
    expect(confirmation.message).toContain('削除されず残ります')
    expect(confirmation.message).toContain('非在籍生徒表示')
    // 2026-09-15 改定: 「本日まで在籍扱い」とは言わず、本日から盤面の通常授業などから外れ、手置きの講習・振替は残ると伝える。
    expect(confirmation.message).not.toContain('本日まで在籍')
    expect(confirmation.message).toContain('本日から非在籍')
    expect(confirmation.message).toContain('講習・振替のコマは残ります')
    expect(confirmation.overwriteNote).toBeNull()
    expect(confirmation.stockWarning).toBeNull()
  })

  it('将来の退塾日が入っているときは置き換えを明示する（未定は置き換え扱いにしない）', () => {
    expect(buildStudentWithdrawConfirmation({ name: 'A', today: TODAY, currentWithdrawDate: '2026-10-31' }).overwriteNote).toContain('2026-10-31')
    expect(buildStudentWithdrawConfirmation({ name: 'A', today: TODAY, currentWithdrawDate: '未定' }).overwriteNote).toBeNull()
  })

  it('未消化の講習/振替が残るときは件数を出す', () => {
    const confirmation = buildStudentWithdrawConfirmation({ name: 'A', today: TODAY, currentWithdrawDate: '', stock: { lecture: 4, makeup: 1 } })
    expect(confirmation.stockWarning).toContain('未消化の講習 4 件')
    expect(confirmation.stockWarning).toContain('未消化の振替 1 件')
  })
})

describe('非在籍一覧の削除（アプリ上から消す・データは残す／オーナー指示 2026-09-13）', () => {
  it('削除ボタンは非在籍(退塾済み・高3卒業後)で未削除の生徒だけ', () => {
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-08-31', birthDate: '2012-05-01' }, TODAY)).toBe(true)
    expect(canDeleteStudentFromApp({ withdrawDate: '', birthDate: '2000-05-01' }, TODAY)).toBe(true)
    // 確認リスト v1.5.527 b-2(2026-09-15): 今日付けで退塾した生徒は当日から非在籍なので、非在籍一覧で当日から削除できる
    expect(canDeleteStudentFromApp({ withdrawDate: TODAY, birthDate: '2012-05-01' }, TODAY)).toBe(true)
    // 在籍中(未定・明日以降の退塾日)は削除できない
    expect(canDeleteStudentFromApp({ withdrawDate: '', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-09-14', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-10-31', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    // 削除済みは二度出さない
    expect(canDeleteStudentFromApp({ withdrawDate: '2026-08-31', birthDate: '2012-05-01', deletedAt: '2026-09-13T01:00:00.000Z' }, TODAY)).toBe(false)
  })

  it('削除しても行は残り、削除日時だけが記録される（最初の削除日時は上書きしない）', () => {
    const students: Array<{ id: string; name: string; withdrawDate: string; birthDate: string; deletedAt?: string }> = [
      { id: 's001', name: 'A', withdrawDate: '2026-08-31', birthDate: '2012-05-01' },
      { id: 's002', name: 'B', withdrawDate: '2026-08-31', birthDate: '2012-05-01' },
    ]
    const next = markStudentDeletedFromApp(students, 's001', '2026-09-13T01:00:00.000Z')
    expect(next).toHaveLength(2)
    expect(next[0]).toEqual({ ...students[0], deletedAt: '2026-09-13T01:00:00.000Z' })
    expect(next[1]).toBe(students[1])
    const again = markStudentDeletedFromApp(next, 's001', '2026-09-20T01:00:00.000Z')
    expect(again[0].deletedAt).toBe('2026-09-13T01:00:00.000Z')
  })

  it('基本データ画面の一覧からは削除済みを外す（空白だけの deletedAt は未削除扱い）', () => {
    const rows = [{ id: 's001' }, { id: 's002', deletedAt: '2026-09-13T01:00:00.000Z' }, { id: 's003', deletedAt: '  ' }]
    expect(filterStudentsVisibleInBasicData(rows).map((row) => row.id)).toEqual(['s001', 's003'])
    expect(isStudentDeletedFromApp(undefined)).toBe(false)
  })
})

describe('基本データ画面: 生徒は削除せず退塾ボタン（オーナー指示 2026-09-13）', () => {
  const source = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8')

  it('生徒名簿から行を取り除く削除経路が無い（削除は deletedAt の記録）', () => {
    expect(source).not.toMatch(/onUpdateStudents\(\(current\) => current\.filter\(/)
    expect(source).toContain('markStudentDeletedFromApp(current, id, new Date().toISOString())')
  })

  it('削除ボタンは非在籍一覧だけに出し、在籍/非在籍の両一覧から削除済みを外す', () => {
    expect(source).toContain("studentRosterView === 'withdrawn' && canDeleteStudentFromApp(row, todayReferenceDate)")
    expect(source.match(/filterStudentsVisibleInBasicData\(students\)\.filter\(/g)).toHaveLength(2)
  })

  it('退塾ボタンが applyStudentWithdrawToday で退塾日を記録する', () => {
    expect(source).toContain('basic-data-withdraw-student-')
    expect(source).toContain('applyStudentWithdrawToday(current, withdrawModalState.id, today)')
  })
})
