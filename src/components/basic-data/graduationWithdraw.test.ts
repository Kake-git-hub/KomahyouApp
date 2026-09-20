// 高3卒業の退塾日 自動入力(オーナー確定 2026-09-20 夜・案A)。
//
// 保証(docs/spec-invariants.md):
//   INV-02 手動編集の永続化 … 室長が入れた退塾日を上書きしない。一度自動入力したら二度と触らない(印で固定)。
//   INV-08 教室分離       … 走らせる条件(編集 state の出所が開いている教室か)は App 側の配線テストで固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyGraduationWithdrawAutoFill, buildGraduationWithdrawAutoFillMessage } from './graduationWithdraw'
import { isActiveOnDate, resolveGraduationWithdrawDate, resolveManagedStudentRosterStatus, type StudentRow } from './basicDataModel'

// 2007-05-01 生まれ = 2014 年度入学 → 高3 学年度末 = 卒業日 2026-03-31(境界は resolveGraduationWithdrawDate が権威)。
const GRADUATE_BIRTH = '2007-05-01'
const GRADUATION_DATE = '2026-03-31'
const NOW = '2026-04-01T00:10:00.000Z'

function student(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 's001',
    name: '卒業 太郎',
    displayName: '卒業',
    email: '',
    entryDate: '2022-04-01',
    withdrawDate: '',
    birthDate: GRADUATE_BIRTH,
    ...overrides,
  }
}

describe('applyGraduationWithdrawAutoFill(4/1 になったら卒業した高3の退塾日へ 3/31 を入れる)', () => {
  it('前提: 入れる日付は表示補完と同じ卒業日で、4/1 が境界', () => {
    expect(resolveGraduationWithdrawDate(GRADUATE_BIRTH)).toBe(GRADUATION_DATE)
  })

  it('★4/1 から自動入力する。3/31 はまだ在籍なので入れない(境界は hasGraduatedHighSchool のまま)', () => {
    const before = applyGraduationWithdrawAutoFill({ students: [student()], todayKey: GRADUATION_DATE, nowIso: NOW })
    expect(before.changed).toBe(false)
    expect(before.students[0].withdrawDate).toBe('')

    const after = applyGraduationWithdrawAutoFill({ students: [student()], todayKey: '2026-04-01', nowIso: NOW })
    expect(after.changed).toBe(true)
    expect(after.filledStudentIds).toEqual(['s001'])
    expect(after.students[0].withdrawDate).toBe(GRADUATION_DATE)
    expect(after.students[0].graduationWithdrawAutoFilledAt).toBe(NOW)
  })

  it('★自動入力は 1 人につき 1 回だけ: 印が付いていれば退塾日が空でも入れ直さない', () => {
    const cleared = student({ withdrawDate: '', graduationWithdrawAutoFilledAt: NOW })
    const result = applyGraduationWithdrawAutoFill({ students: [cleared], todayKey: '2026-06-01', nowIso: '2026-06-01T00:00:00.000Z' })
    expect(result.changed).toBe(false)
    expect(result.students[0]).toBe(cleared)
  })

  it('既に退塾日が入っている生徒は上書きしない(室長の入力・退塾ボタンが優先)', () => {
    const manual = student({ withdrawDate: '2025-12-31' })
    const result = applyGraduationWithdrawAutoFill({ students: [manual], todayKey: '2026-04-01', nowIso: NOW })
    expect(result.changed).toBe(false)
    expect(result.students[0].withdrawDate).toBe('2025-12-31')
    expect(result.students[0].graduationWithdrawAutoFilledAt).toBeUndefined()
  })

  it('高3以外(まだ卒業していない)・生年月日が無い生徒は対象外', () => {
    const others = [
      student({ id: 's002', birthDate: '2012-05-01' }), // 在学中
      student({ id: 's003', birthDate: '' }), // 生年月日なし
      student({ id: 's004', birthDate: '未定' }), // 壊れた値
    ]
    const result = applyGraduationWithdrawAutoFill({ students: others, todayKey: '2026-04-01', nowIso: NOW })
    expect(result.changed).toBe(false)
    expect(result.students.map((row) => row.withdrawDate)).toEqual(['', '', ''])
  })

  it('入力配列は書き換えない(純関数)。対象が複数なら全員に入る', () => {
    const students = [student(), student({ id: 's002', birthDate: '2006-05-01' }), student({ id: 's003', birthDate: '2012-05-01' })]
    const snapshot = JSON.parse(JSON.stringify(students))
    const result = applyGraduationWithdrawAutoFill({ students, todayKey: '2026-04-01', nowIso: NOW })
    expect(students).toEqual(snapshot)
    expect(result.filledStudentIds).toEqual(['s001', 's002'])
    expect(result.students[2].withdrawDate).toBe('')
  })

  it('入れた退塾日で共有の在籍判定が「非在籍」になる(請求の在籍数も自然に外れる・判定関数は無改変)', () => {
    const filled = applyGraduationWithdrawAutoFill({ students: [student()], todayKey: '2026-04-01', nowIso: NOW }).students[0]
    expect(resolveManagedStudentRosterStatus(filled.withdrawDate, filled.birthDate, '2026-04-01')).toBe('非在籍')
    expect(isActiveOnDate(filled.entryDate, filled.withdrawDate, filled.birthDate, '2026-04-01')).toBe(false)
    // 卒業日の前日は在籍のまま(遡って在籍を消さない)。
    expect(isActiveOnDate(filled.entryDate, filled.withdrawDate, filled.birthDate, '2026-03-30')).toBe(true)
  })

  it('メッセージは人数を出す(0 人なら空文字=何も知らせない)', () => {
    expect(buildGraduationWithdrawAutoFillMessage(0)).toBe('')
    expect(buildGraduationWithdrawAutoFillMessage(2)).toContain('卒業した高3 2 名')
  })
})

describe('配線: App は教室が一致するときだけ自動入力し、ユーザー編集として保存する', () => {
  const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

  it('編集 state の出所が開いている教室のときだけ走らせる(教室切替直後の窓で走らせない・INV-08)', () => {
    const index = APP_TSX.indexOf('const result = applyGraduationWithdrawAutoFill({')
    expect(index).toBeGreaterThan(0)
    const effect = APP_TSX.slice(index - 600, index + 500)
    expect(effect).toContain('if (!actingClassroomId) return')
    expect(effect).toContain('if (loadedEditingClassroomIdRef.current !== actingClassroomId) return')
    // 対象が無ければ state を触らない(開いただけで未保存にしない)。
    expect(effect).toContain('if (!result.changed) return')
    expect(effect).toContain('setStudents(result.students)')
  })

  it('判定関数は変えずデータ(withdrawDate)を入れて実現する(共有判定のロックテストを壊さない)', () => {
    const model = readFileSync(fileURLToPath(new URL('./basicDataModel.ts', import.meta.url)), 'utf8')
    expect(model).toContain('export function isActiveOnDate(entryDate: string, withdrawDate: string, birthDate: string, referenceDate: string) {')
    expect(model).toContain('if (hasGraduatedHighSchool(birthDate, referenceDate)) return false')
    // 卒業の表示補完(resolveEffectiveManagedWithdrawDate)も従来どおり残す(印が無い旧データの表示用)。
    expect(model).toContain('export function resolveEffectiveManagedWithdrawDate(withdrawDate: string, birthDate: string, referenceDate: string): string {')
  })
})
