// 講習の日程公開トグル(オーナー確定 2026-11-03・spec-special-session-submission §B-2)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as xlsx from 'xlsx'
import {
  buildSchedulePublishedMap,
  isSpecialSessionSchedulePublished,
  resolveNewSpecialSessionScheduleFields,
  resolveSubmissionSchedulePublished,
  selectSchedulePublishChangedSessionIds,
  setSpecialSessionSchedulePublished,
  type SpecialSessionRow,
} from './specialSessionModel'
import { compareFeatureRolloutScope, FEATURE_ROLLBACKS, featureRolloutRegistry, resolveExpectedFeatureScope } from '../../utils/featureRollout'
import { isSubmissionSchedulePublished } from '../submission/submissionScheduleVisibility'
import { buildParentScheduleView, resolveParentPublishedLectureEndDateKey } from '../../utils/parentSchedule'
import { buildSpecialSessionWorkbook, parseSpecialSessionWorkbook } from './SpecialSessionScreen'
import { parseAppSnapshot, serializeAppSnapshot } from '../../data/appSnapshotRepository'
import { assembleClassroomSnapshotPayload, splitClassroomSnapshotPayload } from '../../utils/classroomSnapshotParts'
import type { AppSnapshot } from '../../types/appState'

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
  it('true のときだけ公開。未設定(この項目ができる前に作った講習)も非公開として扱う(オーナー指示 2026-11-08「作成済みの特別講習をすべて非公開に」)', () => {
    expect(isSpecialSessionSchedulePublished(createSession({ schedulePublished: false }))).toBe(false)
    expect(isSpecialSessionSchedulePublished(createSession({ schedulePublished: true }))).toBe(true)
    expect(isSpecialSessionSchedulePublished(createSession())).toBe(false)
    expect(isSpecialSessionSchedulePublished(null)).toBe(false)
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

  it('Excel で新しく増えた講習は、フラグ ON なら非公開で始める(画面から作ったときと同じ・レビュー指摘 M1)', () => {
    const imported = [createSession({ id: 'ss-new', label: '2027 春期講習', startDate: '2027-03-20', endDate: '2027-04-07' })]
    const workbook = buildSpecialSessionWorkbook(xlsx, imported, [], [])
    expect(parseSpecialSessionWorkbook(xlsx, workbook, [], { schedulePublishToggleEnabled: true })[0]?.schedulePublished).toBe(false)
    expect(parseSpecialSessionWorkbook(xlsx, workbook, [], { schedulePublishToggleEnabled: false })[0]).not.toHaveProperty('schedulePublished')
    expect(parseSpecialSessionWorkbook(xlsx, workbook, [])[0]).not.toHaveProperty('schedulePublished')
  })

  it('項目の無い既存講習は項目を付けない(公開のまま)', () => {
    const existing = [createSession()]
    const workbook = buildSpecialSessionWorkbook(xlsx, existing, [], [])
    const parsed = parseSpecialSessionWorkbook(xlsx, workbook, existing)
    expect(parsed[0]).not.toHaveProperty('schedulePublished')
  })
})

describe('selectSchedulePublishChangedSessionIds(切り替えた講習の提出用QRをすぐ書き直す・レビュー指摘 M2)', () => {
  it('前回から公開状態が変わった講習だけを返す。初回・新しく増えた講習は返さない', () => {
    const before = [createSession({ schedulePublished: false }), createSession({ id: 'ss2' })]
    expect(selectSchedulePublishChangedSessionIds(null, before)).toEqual([])
    const previous = buildSchedulePublishedMap(before)
    expect(selectSchedulePublishChangedSessionIds(previous, before)).toEqual([])
    const after = [createSession({ schedulePublished: true }), createSession({ id: 'ss2', schedulePublished: true }), createSession({ id: 'ss3', schedulePublished: false })]
    // ss2 は未設定(非公開・2026-11-08〜)→ true(公開)で変化あり。ss3 は前回に無い。
    expect(selectSchedulePublishChangedSessionIds(previous, after)).toEqual(['ss1', 'ss2'])
  })
})

describe('「true のときだけ公開」の判定がそろっている(レビュー指摘 L2・2026-11-08 に未設定=非公開へ)', () => {
  const cases = [false, true, undefined] as const
  it('講習データ・提出用QR・保護者QRの 3 か所が同じ答えを返す', () => {
    for (const value of cases) {
      const session = createSession(value === undefined ? {} : { schedulePublished: value })
      const expected = value === true
      expect(isSpecialSessionSchedulePublished(session), String(value)).toBe(expected)
      expect(isSubmissionSchedulePublished({ schedulePublished: value }), String(value)).toBe(expected)
      // 保護者QR: 公開中ならまだ終わっていない講習の終了日が延長の日付として返る。
      expect(resolveParentPublishedLectureEndDateKey({ specialSessions: [session] }, '2026-12-01') !== '', String(value)).toBe(expected)
    }
    expect(buildParentScheduleView({}, 's001', { from: '2026-12-01', to: '2026-12-31' })).toBeNull()
  })

  // 戻すとき(FEATURE_ROLLBACKS にどちらかの記録がある)は同じ値でなくてよいが、「保護者QRの範囲 ≦ 講習の公開の範囲」の向きは
  // 記録があっても無条件で守る(講習の公開だけを戻すと、隠す手段の無いまま講習が保護者に出る。手順書 docs/runbooks/feature-flag-rollback.md の向きの注意)。
  it('このフラグは保護者QR(parentPortalQr)と同じ範囲(保護者QRだけ先に広げると、隠す手段のないまま講習が出る・記録された戻しのときも保護者QRの範囲 ≦ 講習の公開の範囲)', () => {
    const portal = featureRolloutRegistry.parentPortalQr.scope
    const toggle = featureRolloutRegistry.lectureSchedulePublishToggle.scope
    expect(compareFeatureRolloutScope(portal, toggle), `保護者QR(${portal}) が講習の公開(${toggle}) より広い`).toBeLessThanOrEqual(0)
    const rolledBack = Boolean(FEATURE_ROLLBACKS.lectureSchedulePublishToggle || FEATURE_ROLLBACKS.parentPortalQr)
    if (!rolledBack) {
      expect(toggle).toBe(portal)
    }
    // 2026-11-08 オーナー指示で保護者QRと同じ push で全教室へ昇格。回帰で staging-environment へ戻さない(戻すのは記録した戻しだけ)。
    expect(featureRolloutRegistry.lectureSchedulePublishToggle.scope).toBe(resolveExpectedFeatureScope('lectureSchedulePublishToggle'))
    expect(featureRolloutRegistry.parentPortalQr.scope).toBe(resolveExpectedFeatureScope('parentPortalQr'))
  })
})

// 描画テスト環境が無いので、落としやすい配線を字面で固定する(作法は submissionNotification.wiring.test.ts と同じ)。
describe('日程公開の配線(SpecialSessionScreen / App)', () => {
  const SCREEN = readFileSync(fileURLToPath(new URL('./SpecialSessionScreen.tsx', import.meta.url)), 'utf8')
  const APP = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

  it('講習を作るときは resolveNewSpecialSessionScheduleFields(フラグ)で初期値を付ける', () => {
    // 講師専用で作るときだけ非公開の項目を付けない(2026-11-03 レビュー指摘 M-2・teacherOnlySpecialSession.test.ts)。
    expect(SCREEN).toContain('...resolveNewSpecialSessionScheduleFields(schedulePublishToggleEnabled && !(teacherOnlyEnabled && draft.teacherOnly === true)),')
  })

  it('トグル列はフラグ ON のときだけ出る', () => {
    expect(SCREEN).toContain("{schedulePublishToggleEnabled ? <th>保護者への公開</th> : null}")
    // オーナー指示 2026-11-03(確認リスト lp-1 メモ):「日程」ではなく「保護者への公開」という名前にする。
    expect(SCREEN).not.toContain("<th>日程</th>")
  })

  it('Excel 取り込みにもフラグを渡す(M1)・公開状態が変わった講習は講習自身の期間で提出用QRを書き直す(M2)', () => {
    expect(APP).toContain("parseSpecialSessionWorkbook(xlsx, workbook, specialSessions, { schedulePublishToggleEnabled: isFeatureEnabledForClassroom('lectureSchedulePublishToggle', actingClassroom) })")
    expect(APP).toContain('const changedIds = selectSchedulePublishChangedSessionIds(previousSchedulePublishedRef.current, specialSessions)')
    expect(APP).toContain('void ensureScheduleSubmissionTokens(session.startDate, session.endDate)')
  })

  it('App は機能フラグ lectureSchedulePublishToggle を講習データ画面へ渡す', () => {
    expect(APP).toContain("schedulePublishToggleEnabled={isFeatureEnabledForClassroom('lectureSchedulePublishToggle', actingClassroom)}")
  })

  it('提出用QRへ載せる組まれたコマは、フラグ OFF なら常に公開・ON なら講習の公開状態で講習コマを含めるか決める', () => {
    // 判定は resolveSubmissionSchedulePublished(フラグ OFF=公開・講師専用=公開・それ以外は schedulePublished)へ切り出した(2026-11-03)。
    expect(APP).toContain("const schedulePublished = resolveSubmissionSchedulePublished(session, isFeatureEnabledForClassroom('lectureSchedulePublishToggle', actingClassroom))")
    expect(APP).toContain('includeLectureLessons: schedulePublished,')
    // 新規トークンにも既発行トークンにも公開状態を書く。
    expect(APP).toContain('await ensureSubmissionTokens(sessionForIssue, studentsWithSubjects, teacherList, classroomSettings, slotNumbers, { schedulePublished })')
    expect(APP.match(/reopenedSlots: (student|teacher)Input\?\.reopenedSlots \?\? \[\], schedulePublished \}\)/g)?.length).toBe(2)
  })
})

// 戻し互換(2026-11-08・全教室展開した lectureSchedulePublishToggle をすぐ OFF に戻せるようにする準備・INV-06)。
describe('戻し互換: フラグ OFF の版でも非公開の講習の項目を消さない(2026-11-08)', () => {
  it('フラグ OFF の教室では schedulePublished:false の講習も公開として扱うが、項目は保存で消えない(ON に戻せば再び非公開)', () => {
    const hidden = createSession({ schedulePublished: false })
    // OFF: 提出用QRは公開扱い(トグルが無いので隠したままにしない)。ON: 非公開。
    expect(resolveSubmissionSchedulePublished(hidden, false)).toBe(true)
    expect(resolveSubmissionSchedulePublished(hidden, true)).toBe(false)

    // OFF の版の保存・読み込み(JSON の書き出し/読み込み・分割保存の部品の往復・Excel の取り込み)で項目が残る。
    const snapshot = { screen: 'board', classroomSettings: {}, managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [], specialSessions: [hidden], autoAssignRules: [], pairConstraints: [], boardState: null, schemaVersion: 1, savedAt: 'x' } as unknown as AppSnapshot
    const parsed = parseAppSnapshot(serializeAppSnapshot(snapshot)).specialSessions
    expect(parsed[0]?.schedulePublished).toBe(false)
    const split = splitClassroomSnapshotPayload(snapshot)
    const assembled = assembleClassroomSnapshotPayload({ core: split.core, board: split.board, weeks: split.weeks.map((week) => week.cells), ui: split.ui, hasBoardState: split.hasBoardState }) as { specialSessions: SpecialSessionRow[] }
    expect(assembled.specialSessions[0]?.schedulePublished).toBe(false)
    const workbook = buildSpecialSessionWorkbook(xlsx, parsed, [], [])
    const reimported = parseSpecialSessionWorkbook(xlsx, workbook, parsed, { schedulePublishToggleEnabled: false })
    expect(reimported[0]?.schedulePublished).toBe(false)

    // ON に戻すと、残っていた項目のとおり再び非公開になる。
    for (const session of [parsed[0]!, assembled.specialSessions[0]!, reimported[0]!]) {
      expect(isSpecialSessionSchedulePublished(session)).toBe(false)
      expect(resolveSubmissionSchedulePublished(session, true)).toBe(false)
    }
  })
})
