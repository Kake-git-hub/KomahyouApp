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
    expect(generatedModule.PARENT_SCHEDULE_DEFAULT_PAST_DAYS).toBe(appModule.PARENT_SCHEDULE_DEFAULT_PAST_DAYS)
    expect(generatedModule.PARENT_SCHEDULE_MAX_SPAN_DAYS).toBe(appModule.PARENT_SCHEDULE_MAX_SPAN_DAYS)

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
    expect(comparedDays).toBeGreaterThan(100)
    expect(generatedModule.buildParentScheduleView(cloneParentScheduleFixturePayload(), 'missing', ranges[0])).toBeNull()
  })
})
