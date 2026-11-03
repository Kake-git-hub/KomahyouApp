// 講習の日程公開トグル(オーナー確定 2026-11-03・spec-special-session-submission §B-2)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as xlsx from 'xlsx'
import {
  isSpecialSessionSchedulePublished,
  resolveNewSpecialSessionScheduleFields,
  setSpecialSessionSchedulePublished,
  type SpecialSessionRow,
} from './specialSessionModel'
import { buildSpecialSessionWorkbook, parseSpecialSessionWorkbook } from './SpecialSessionScreen'

function createSession(overrides: Partial<SpecialSessionRow> = {}): SpecialSessionRow {
  return {
    id: 'ss1',
    label: '2026 冬期講習',
    startDate: '2026-12-22',
    endDate: '2027-01-07',
    teacherInputs: {},
    studentInputs: {},
    createdAt: '2026-11-01 10:00',
    updatedAt: '2026-11-01 10:00',
    ...overrides,
  }
}

describe('isSpecialSessionSchedulePublished', () => {
  it('false のときだけ非公開。未設定(この項目ができる前に作った講習)は公開として扱う', () => {
    expect(isSpecialSessionSchedulePublished(createSession({ schedulePublished: false }))).toBe(false)
    expect(isSpecialSessionSchedulePublished(createSession({ schedulePublished: true }))).toBe(true)
    expect(isSpecialSessionSchedulePublished(createSession())).toBe(true)
    expect(isSpecialSessionSchedulePublished(null)).toBe(true)
  })
})

describe('resolveNewSpecialSessionScheduleFields', () => {
  it('トグルが使える教室では新しい講習を非公開で作る。使えない教室では項目を付けない(=公開のまま)', () => {
    expect(resolveNewSpecialSessionScheduleFields(true)).toEqual({ schedulePublished: false })
    expect(resolveNewSpecialSessionScheduleFields(false)).toEqual({})
  })
})

describe('setSpecialSessionSchedulePublished', () => {
  it('対象の講習だけを切り替え、他の講習・提出の入力は触らない', () => {
    const other = createSession({ id: 'ss2', schedulePublished: false })
    const target = createSession({ schedulePublished: false, studentInputs: { s001: { unavailableSlots: ['2026-12-24_1'], regularBreakSlots: [], subjectSlots: { 数: 2 }, regularOnly: false, countSubmitted: true, updatedAt: 'x' } } })
    const next = setSpecialSessionSchedulePublished([target, other], 'ss1', true, '2026-11-03 09:00')
    expect(next[0]).toEqual({ ...target, schedulePublished: true, updatedAt: '2026-11-03 09:00' })
    expect(next[1]).toBe(other)
    const back = setSpecialSessionSchedulePublished(next, 'ss1', false, '2026-11-03 09:05')
    expect(back[0]?.schedulePublished).toBe(false)
  })

  it('同じ値なら同じ配列を返す(不要な更新を出さない)', () => {
    const sessions = [createSession({ schedulePublished: true })]
    expect(setSpecialSessionSchedulePublished(sessions, 'ss1', true, 't')).toBe(sessions)
    expect(setSpecialSessionSchedulePublished(sessions, 'missing', false, 't')).toBe(sessions)
  })
})

describe('Excel 取り込みで日程公開を落とさない', () => {
  it('既存の講習の schedulePublished を保つ(Excel に列は無い)', () => {
    const existing = [createSession({ schedulePublished: false })]
    const workbook = buildSpecialSessionWorkbook(xlsx, existing, [], [])
    const parsed = parseSpecialSessionWorkbook(xlsx, workbook, existing)
    expect(parsed[0]?.schedulePublished).toBe(false)
  })

  it('項目の無い既存講習は項目を付けない(公開のまま)', () => {
    const existing = [createSession()]
    const workbook = buildSpecialSessionWorkbook(xlsx, existing, [], [])
    const parsed = parseSpecialSessionWorkbook(xlsx, workbook, existing)
    expect(parsed[0]).not.toHaveProperty('schedulePublished')
  })
})

// 描画テスト環境が無いので、落としやすい配線を字面で固定する(作法は submissionNotification.wiring.test.ts と同じ)。
describe('日程公開の配線(SpecialSessionScreen / App)', () => {
  const SCREEN = readFileSync(fileURLToPath(new URL('./SpecialSessionScreen.tsx', import.meta.url)), 'utf8')
  const APP = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

  it('講習を作るときは resolveNewSpecialSessionScheduleFields(フラグ)で初期値を付ける', () => {
    expect(SCREEN).toContain('...resolveNewSpecialSessionScheduleFields(schedulePublishToggleEnabled),')
  })

  it('トグル列はフラグ ON のときだけ出る', () => {
    expect(SCREEN).toContain("{schedulePublishToggleEnabled ? <th>日程</th> : null}")
  })

  it('App は機能フラグ lectureSchedulePublishToggle を講習データ画面へ渡す', () => {
    expect(APP).toContain("schedulePublishToggleEnabled={isFeatureEnabledForClassroom('lectureSchedulePublishToggle', actingClassroom)}")
  })

  it('提出用QRへ載せる組まれたコマは、フラグ OFF なら常に公開・ON なら講習の公開状態で講習コマを含めるか決める', () => {
    expect(APP).toContain("const schedulePublished = !isFeatureEnabledForClassroom('lectureSchedulePublishToggle', actingClassroom) || isSpecialSessionSchedulePublished(session)")
    expect(APP).toContain('includeLectureLessons: schedulePublished,')
    // 新規トークンにも既発行トークンにも公開状態を書く。
    expect(APP).toContain('await ensureSubmissionTokens(sessionForIssue, studentsWithSubjects, teacherList, classroomSettings, slotNumbers, { schedulePublished })')
    expect(APP.match(/reopenedSlots: (student|teacher)Input\?\.reopenedSlots \?\? \[\], schedulePublished \}\)/g)?.length).toBe(2)
  })
})
