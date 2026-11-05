import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildGeneratedContent, normalizeToLf, SHARED_HEADER, SHARED_OUTPUT_PATH, SHARED_SOURCE_PATH } from '../scripts/sync-shared.mjs'
// ⚠️ アプリ側の実装(正本)。functions 側の生成物がズレたらこのテストが落ちる。
import * as appModule from '../../src/utils/parentSchedule'
import {
  cloneParentScheduleFixturePayload,
  PARENT_SCHEDULE_FIXTURE_FORBIDDEN_STRINGS,
  PARENT_SCHEDULE_FIXTURE_TODAY,
  parentScheduleFixtureStudents,
} from '../../src/utils/parentSchedule.fixture'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function readRepoFile(relativePath: string) {
  return normalizeToLf(readFileSync(resolve(repoRoot, relativePath), 'utf8'))
}

describe('functions/src/generated/parentSchedule.ts は src/utils/parentSchedule.ts の複製(sync-shared)', () => {
  it('生成物 = ヘッダ 1 行 + 元ファイル(ズレていたら `npm --prefix functions run sync-shared` を実行してコミット)', () => {
    const source = readRepoFile(SHARED_SOURCE_PATH)
    const generated = readRepoFile(SHARED_OUTPUT_PATH)
    expect(generated.split('\n')[0]).toBe(SHARED_HEADER)
    expect(generated).toBe(`${SHARED_HEADER}\n${source}`)
    expect(generated).toBe(buildGeneratedContent(source))
  })

  it('元ファイルは自己完結(import / import.meta / require なし)で、複製先でも解決できる', () => {
    const source = readRepoFile(SHARED_SOURCE_PATH)
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toContain('import.meta')
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(() => buildGeneratedContent('import x from "y"\nexport const a = 1\n')).toThrow(/自己完結/)
    expect(() => buildGeneratedContent('export const a = import.meta.env\n')).toThrow(/自己完結/)
  })

  it('生成物を動的 import しても同じ export を持ち、同じ fixture で同じ結果を返す(二重実装のドリフト検出)', async () => {
    const generatedModule = await import('./generated/parentSchedule') as typeof appModule
    expect(Object.keys(generatedModule).sort()).toEqual(Object.keys(appModule).sort())
    expect(generatedModule.PARENT_SCHEDULE_MONTHS_BEFORE).toBe(appModule.PARENT_SCHEDULE_MONTHS_BEFORE)
    expect(generatedModule.PARENT_SCHEDULE_MONTHS_AFTER).toBe(appModule.PARENT_SCHEDULE_MONTHS_AFTER)

    const today = PARENT_SCHEDULE_FIXTURE_TODAY
    const ranges = [
      appModule.resolveParentScheduleRange({}, today),
      appModule.resolveParentScheduleRange({ from: '2026-08-24', to: '2026-10-12' }, today),
      appModule.resolveParentScheduleRange({ from: '2026-10-05' }, today),
    ]
    expect(generatedModule.resolveParentScheduleRange({}, today)).toEqual(ranges[0])
    expect(generatedModule.resolveParentScheduleRange({ from: '2026-01-01', to: '2027-01-01' }, today))
      .toEqual(appModule.resolveParentScheduleRange({ from: '2026-01-01', to: '2027-01-01' }, today))
    expect(generatedModule.toJstDateKey(new Date('2026-09-13T15:00:00.000Z'))).toBe(appModule.toJstDateKey(new Date('2026-09-13T15:00:00.000Z')))

    let comparedDays = 0
    for (const student of parentScheduleFixtureStudents) {
      expect(generatedModule.isParentStudentActiveOnDate(student, today)).toBe(appModule.isParentStudentActiveOnDate(student, today))
      for (const range of ranges) {
        const expected = appModule.buildParentScheduleView(cloneParentScheduleFixturePayload(), student.id, range)
        const actual = generatedModule.buildParentScheduleView(cloneParentScheduleFixturePayload(), student.id, range)
        expect(actual, `${student.id} ${range.from}..${range.to}`).toEqual(expected)
        expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
        comparedDays += expected?.days.length ?? 0
        // 本人の表示名だけは載る(それ以外の生徒名・講師名・内部 ID は 1 つも載らない)。
        const json = JSON.stringify({ ...actual, studentName: '' })
        for (const forbidden of PARENT_SCHEDULE_FIXTURE_FORBIDDEN_STRINGS) {
          expect(json).not.toContain(forbidden)
        }
      }
    }
    // 授業のある日・臨時休みの日だけが行になる(2026-09-14〜)ので、比較日数は全日展開だった頃より少ない。
    expect(comparedDays).toBeGreaterThan(50)
    expect(generatedModule.buildParentScheduleView(cloneParentScheduleFixturePayload(), 'missing', ranges[0])).toBeNull()
  })
})

// 段 4（丸ごと振替の付け替え・spec-template-conflict-v2 §3）の保護者向け日程。盤面の写しを読むだけなので本体と複製が同じ結果になる。
// 組のキー（WHOLE_DAY_PAIR__D__D'__0）は抑止キーに相乗りしているが、生徒の抑止キーとは形式上一致しないので何も抑止しない。
describe('丸ごと振替の付け替え（段 4）の保護者向け日程: 本体と複製が同じ', () => {
  const D = '2026-10-07'
  const D2 = '2026-10-14'
  const studentRow = { id: 'sA', name: '青木 太郎', displayName: '青木', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }
  const regularRow = {
    id: 'r0', schoolYear: 2026, teacherId: 't1', student1Id: 'sA', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '',
    nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5,
  }
  const record = (status: 'moved' | 'absent') => ({
    id: `wholedaypair_${D}_5_0_0_sA_数`, studentId: 'sA_2026-10-07_数', sourceManagedLesson: false, name: '青木 太郎', managedStudentId: 'sA', grade: '中2', subject: '数',
    lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey: D, slotNumber: 5, recordedAt: `${D}T00:00:00.000Z`, status, sourceLessonId: 'managed_r0_2026-10-07',
    ...(status === 'moved' ? { moveDestinationDateKey: D2, moveDestinationSlotNumber: 5 } : {}), wholeDayPairDerived: true, wholeDayPairTargetDate: D2,
  })
  const cell = (dateKey: string, desk: Record<string, unknown>) => ({ id: `${dateKey}_5`, dateKey, slotNumber: 5, timeLabel: '19:40-21:10', isOpenDay: true, desks: [desk, { id: 'd2', teacher: '' }] })
  const payload = (weeks: unknown[]) => ({
    students: [studentRow], regularLessons: [regularRow],
    classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, templateFreezeBeforeDate: D },
    boardState: { weeks, suppressedRegularLessonOccurrences: [`WHOLE_DAY_PAIR__${D}__${D2}__0`] },
  })
  const range = { from: '2026-10-05', to: '2026-10-18' }
  const compare = async (input: unknown) => {
    const generatedModule = await import('./generated/parentSchedule') as typeof appModule
    const expected = appModule.buildParentScheduleView(structuredClone(input), 'sA', range)
    expect(generatedModule.buildParentScheduleView(structuredClone(input), 'sA', range)).toEqual(expected)
    return Object.fromEntries((expected?.days ?? []).map((day) => [day.dateKey, day]))
  }

  it('§9-21: D\' に同じ生徒の手入力があり D の授業を置かなかった日は「D お休み」だけで振替先を出さない', async () => {
    const days = await compare(payload([
      [cell(D, { id: 'd1', teacher: '', statusSlots: [record('absent'), null] })],
      [cell(D2, { id: 'd1', teacher: '田中', lesson: { id: 'm', studentSlots: [{ id: 'mk', name: '青木 太郎', managedStudentId: 'sA', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30', makeupSourceLabel: '2026/9/30(水) 5限', origin: 'manual' }, null] } })],
    ]))
    expect(days[D]?.lessons).toEqual([expect.objectContaining({ kind: 'absent', makeupDestination: null })])
  })

  it('監査 要確認-2（今の挙動を固定・直すかはオーナー判断待ち）: 組の D\' の週が盤面に無いと、テンプレで補う経路は組を見ず D\' 自身のテンプレを「予定」で出す', async () => {
    const days = await compare(payload([[cell(D, { id: 'd1', teacher: '', statusSlots: [record('moved'), null] })]]))
    // D は移動元の記録だけ（振替先の授業が盤面に無いので行にならない）。D' は D' 自身のテンプレの通常（予定）が出る＝付け替えの「振替」にはならない。
    expect(days[D]).toBeUndefined()
    expect(days[D2]?.kind).toBe('template')
    expect(days[D2]?.lessons).toEqual([expect.objectContaining({ kind: 'regular', isTentative: true })])
  })
})
