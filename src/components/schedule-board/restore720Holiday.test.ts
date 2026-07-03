// ⚠️【一時機能のテスト・室長クリック後に本ファイルごと撤去する】(2026-07-03)
// 7/20休日振替の復帰ボタン(restore720Holiday.ts)の回帰防止テスト。
// 検証すること:
//  1. applyRestore720HolidayMakeup が対象キーに「手動追加 + 抑制解除」を適用する(冪等)。
//  2. buildMakeupStockEntries と組み合わせて、対象キーが balance 0→1 になる(remain に 7/20)。
//  3. 「手動追加のみ(抑制解除なし)」では +0 のまま = 両方の手順が必須(前回失敗の再発防止)。
//  4. 対象外キーは不変。getRestore720TargetKeys が教室別に正しく引ける。
import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import { buildMakeupStockEntries, type ManualMakeupOrigin } from './makeupStock'
import {
  applyRestore720HolidayMakeup,
  getRestore720TargetKeys,
  RESTORE_720_ORIGIN_DATE,
  RESTORE_720_TARGET_KEYS_BY_CLASSROOM,
} from './restore720Holiday'

type OriginMap = Record<string, ManualMakeupOrigin[]>

const TODAY = new Date('2026-07-03')

function createStudent(id: string): StudentRow {
  return {
    id,
    name: `生徒 ${id}`,
    displayName: `生徒 ${id}`,
    email: '',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2011-05-01',
  }
}

// テンプレ凍結を模す: 期間を 8/31 以降にして、7/20 が auto shortage 対象外になるようにする。
function createFrozenRegularLesson(id: string, studentId: string, subject: string): RegularLessonRow {
  return {
    id,
    schoolYear: 2026,
    teacherId: 'teacher-1',
    student1Id: studentId,
    subject1: subject,
    startDate: '2026-08-31',
    endDate: '2027-03-31',
    student2Id: '',
    subject2: '',
    student2StartDate: '',
    student2EndDate: '',
    nextStudent1Id: '',
    nextSubject1: '',
    nextStudent2Id: '',
    nextSubject2: '',
    dayOfWeek: 1,
    slotNumber: 1,
  }
}

function createSettings(): ClassroomSettings {
  return {
    closedWeekdays: [],
    holidayDates: [RESTORE_720_ORIGIN_DATE], // 7/20 は休日 → 理由ラベル「休日振替」
    forceOpenDates: [],
    deskCount: 1,
  }
}

// buildMakeupStockEntries を回して key→balance を返す。balance 0(entry除外)は 0 とみなす。
function balancesFor(manual: OriginMap, suppressed: OriginMap, students: StudentRow[], regularLessons: RegularLessonRow[]) {
  const entries = buildMakeupStockEntries({
    students,
    teachers: [],
    regularLessons,
    classroomSettings: createSettings(),
    weeks: [],
    manualAdjustments: manual,
    suppressedOrigins: suppressed,
    fallbackStudents: {},
    resolveStudentKey: (student) => student.managedStudentId ?? student.id,
    today: TODAY,
  })
  const map = new Map(entries.map((entry) => [entry.key, entry]))
  return { balanceOf: (key: string) => map.get(key)?.balance ?? 0, entryOf: (key: string) => map.get(key) ?? null }
}

describe('restore720Holiday — pure map mechanism', () => {
  it('adds 7/20 to manual (idempotent) and removes it from suppressed', () => {
    const manual: OriginMap = {}
    const suppressed: OriginMap = { 's031__数': [{ dateKey: '2026-07-06' }, { dateKey: RESTORE_720_ORIGIN_DATE }, { dateKey: '2026-07-27' }] }

    const result = applyRestore720HolidayMakeup(manual, suppressed, ['s031__数'])

    expect(result.manualAdjustments['s031__数']).toEqual([{ dateKey: RESTORE_720_ORIGIN_DATE }])
    // 7/20 のみ除去され、他の抑制日は保持される
    expect(result.suppressedMakeupOrigins['s031__数']).toEqual([{ dateKey: '2026-07-06' }, { dateKey: '2026-07-27' }])

    // 冪等: もう一度適用しても manual は重複しない
    const again = applyRestore720HolidayMakeup(result.manualAdjustments, result.suppressedMakeupOrigins, ['s031__数'])
    expect(again.manualAdjustments['s031__数']).toEqual([{ dateKey: RESTORE_720_ORIGIN_DATE }])
  })

  it('removes the suppressed key entirely when 7/20 was its only entry', () => {
    const result = applyRestore720HolidayMakeup({}, { 's024__英': [{ dateKey: RESTORE_720_ORIGIN_DATE }] }, ['s024__英'])
    expect(result.suppressedMakeupOrigins['s024__英']).toBeUndefined()
  })
})

describe('restore720Holiday — effect on makeup stock balance', () => {
  it('restores 7/20 to +1 for the target key, and manual-only stays +0 (both steps required)', () => {
    const students = [createStudent('s031'), createStudent('s024')]
    const regularLessons = [createFrozenRegularLesson('r1', 's031', '数'), createFrozenRegularLesson('r2', 's024', '英')]
    const targetKeys = ['s031__数', 's024__英']

    // 初期: 7/20 は凍結で auto=0、抑制されている → balance 0
    const baseSuppressed: OriginMap = {
      's031__数': [{ dateKey: RESTORE_720_ORIGIN_DATE }],
      's024__英': [{ dateKey: RESTORE_720_ORIGIN_DATE }],
    }
    const before = balancesFor({}, baseSuppressed, students, regularLessons)
    expect(before.balanceOf('s031__数')).toBe(0)
    expect(before.balanceOf('s024__英')).toBe(0)

    // 手動追加のみ(抑制はそのまま) → +0（片方だけでは効かない）
    const manualOnly = applyRestore720HolidayMakeup({}, baseSuppressed, targetKeys).manualAdjustments
    const afterManualOnly = balancesFor(manualOnly, baseSuppressed, students, regularLessons)
    expect(afterManualOnly.balanceOf('s031__数')).toBe(0)

    // 手動追加 + 抑制解除(両方) → +1、remain に 7/20、理由は休日振替
    const applied = applyRestore720HolidayMakeup({}, baseSuppressed, targetKeys)
    const after = balancesFor(applied.manualAdjustments, applied.suppressedMakeupOrigins, students, regularLessons)
    expect(after.balanceOf('s031__数')).toBe(1)
    expect(after.balanceOf('s024__英')).toBe(1)
    const entry = after.entryOf('s031__数')
    expect(entry?.remainingOriginDates).toContain(RESTORE_720_ORIGIN_DATE)
    expect(entry?.remainingOriginReasonLabels).toContain('休日振替')
  })

  it('leaves non-target keys untouched', () => {
    const students = [createStudent('s031'), createStudent('s099')]
    const regularLessons = [createFrozenRegularLesson('r1', 's031', '数'), createFrozenRegularLesson('r9', 's099', '数')]
    const baseSuppressed: OriginMap = {
      's031__数': [{ dateKey: RESTORE_720_ORIGIN_DATE }],
      's099__数': [{ dateKey: RESTORE_720_ORIGIN_DATE }],
    }
    // 対象は s031 のみ
    const applied = applyRestore720HolidayMakeup({}, baseSuppressed, ['s031__数'])
    // 非対象 s099 の抑制は残り、手動は付かない
    expect(applied.suppressedMakeupOrigins['s099__数']).toEqual([{ dateKey: RESTORE_720_ORIGIN_DATE }])
    expect(applied.manualAdjustments['s099__数']).toBeUndefined()

    const after = balancesFor(applied.manualAdjustments, applied.suppressedMakeupOrigins, students, regularLessons)
    expect(after.balanceOf('s099__数')).toBe(0) // 非対象は不変(+0)
    expect(after.balanceOf('s031__数')).toBe(1)
  })
})

describe('restore720Holiday — classroom gating', () => {
  it('returns target keys for the two target classrooms and empty for others', () => {
    expect(getRestore720TargetKeys('KzFnOQoTFLsCxwUp1tvh')).toEqual(['s031__数', 's024__英'])
    expect(getRestore720TargetKeys('5w5OMueETerSKrSf14HC')).toEqual(['s068__数', 's076__理'])
    expect(getRestore720TargetKeys('6xnnbSTbwgGrBLy0EJKb')).toEqual([]) // 薬円台: 対象なし
    expect(getRestore720TargetKeys('v8OZ7zH8vONNHjjYVcR1')).toEqual([]) // 開発用教室
    expect(getRestore720TargetKeys(undefined)).toEqual([])
  })

  it('target map covers exactly the two production classrooms with 2 keys each', () => {
    expect(Object.keys(RESTORE_720_TARGET_KEYS_BY_CLASSROOM)).toHaveLength(2)
    for (const keys of Object.values(RESTORE_720_TARGET_KEYS_BY_CLASSROOM)) {
      expect(keys).toHaveLength(2)
    }
  })
})
