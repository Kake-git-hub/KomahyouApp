import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyStudentWithdrawToday, buildStudentWithdrawConfirmation, canWithdrawStudentToday } from './withdrawGuard'

const TODAY = '2026-09-13'

describe('canWithdrawStudentToday（退塾ボタンを出す条件）', () => {
  it('退塾日が未定の在籍生徒には出す', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '', birthDate: '2012-05-01' }, TODAY)).toBe(true)
    expect(canWithdrawStudentToday({ withdrawDate: '未定', birthDate: '2012-05-01' }, TODAY)).toBe(true)
  })

  it('将来の退塾日が入っている在籍生徒にも出す（押すと今日付けに置き換え）', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '2026-10-31', birthDate: '2012-05-01' }, TODAY)).toBe(true)
  })

  it('今日付けで退塾済み（当日はまだ在籍表示）の生徒には出さない＝二度押し防止', () => {
    expect(canWithdrawStudentToday({ withdrawDate: TODAY, birthDate: '2012-05-01' }, TODAY)).toBe(false)
  })

  it('退塾日を過ぎた非在籍の生徒・高3卒業後の生徒には出さない', () => {
    expect(canWithdrawStudentToday({ withdrawDate: '2026-08-31', birthDate: '2012-05-01' }, TODAY)).toBe(false)
    expect(canWithdrawStudentToday({ withdrawDate: '', birthDate: '2000-05-01' }, TODAY)).toBe(false)
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

describe('基本データ画面: 生徒は削除せず退塾ボタン（オーナー指示 2026-09-13）', () => {
  const source = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8')

  it('生徒名簿から行を取り除く削除経路が無い', () => {
    expect(source).not.toMatch(/onUpdateStudents\(\(current\) => current\.filter\(/)
    expect(source).not.toContain('removeStudent(')
  })

  it('退塾ボタンが applyStudentWithdrawToday で退塾日を記録する', () => {
    expect(source).toContain('basic-data-withdraw-student-')
    expect(source).toContain('applyStudentWithdrawToday(current, withdrawModalState.id, today)')
  })
})
