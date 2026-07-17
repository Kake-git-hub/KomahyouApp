import { describe, expect, it } from 'vitest'
import { appendReopenedSlots, groupClassSubmissionSubjects, initialSpecialSessions, removedDefaultSpecialSessionIds, resolveEffectiveUnavailableSlots, resolveGroupClassParticipation, resolveLectureSubjectDuration, resolveReopenedUnavailableSlots, resolveSavedGroupClassParticipation, type SpecialSessionRow } from './specialSessionModel'

describe('specialSessionModel', () => {
  it('starts with no default special sessions', () => {
    expect(initialSpecialSessions).toEqual([])
  })

  it('keeps the legacy default session ids for cleanup migrations', () => {
    expect(removedDefaultSpecialSessionIds).toEqual([
      'session_2026_summer',
      'session_2026_spring',
      'session_2026_exam',
      'session_2026_winter',
    ])
  })
})

// spec-lecture-stock §6 / TODO4: 授業時間。未設定=90、60/45 を許容、それ以外は90へ丸め。
describe('resolveLectureSubjectDuration', () => {
  it('defaults to 90 when unset', () => {
    expect(resolveLectureSubjectDuration(undefined, '数')).toBe(90)
    expect(resolveLectureSubjectDuration({ subjectDurations: undefined }, '数')).toBe(90)
    expect(resolveLectureSubjectDuration({ subjectDurations: {} }, '数')).toBe(90)
  })

  it('returns 60/45 when explicitly set', () => {
    expect(resolveLectureSubjectDuration({ subjectDurations: { 数: 60 } }, '数')).toBe(60)
    expect(resolveLectureSubjectDuration({ subjectDurations: { 英: 45 } }, '英')).toBe(45)
  })

  it('rounds invalid values to 90', () => {
    expect(resolveLectureSubjectDuration({ subjectDurations: { 数: 30 } }, '数')).toBe(90)
    expect(resolveLectureSubjectDuration({ subjectDurations: { 数: 0 } }, '数')).toBe(90)
  })
})

// spec-group-lesson §C: 集団授業の参加可否。未設定=不参加(既定)、明示 true のみ参加。
describe('resolveGroupClassParticipation', () => {
  it('exposes the two group submission subjects', () => {
    expect(groupClassSubmissionSubjects).toEqual(['集団理科', '集団社会'])
  })

  it('defaults to 不参加 (false) when unset', () => {
    expect(resolveGroupClassParticipation(undefined, '集団理科')).toBe(false)
    expect(resolveGroupClassParticipation({ groupClassParticipation: undefined }, '集団理科')).toBe(false)
    expect(resolveGroupClassParticipation({ groupClassParticipation: {} }, '集団理科')).toBe(false)
  })

  it('returns 参加 (true) only when explicitly true', () => {
    expect(resolveGroupClassParticipation({ groupClassParticipation: { 集団理科: true } }, '集団理科')).toBe(true)
    expect(resolveGroupClassParticipation({ groupClassParticipation: { 集団理科: true } }, '集団社会')).toBe(false)
    expect(resolveGroupClassParticipation({ groupClassParticipation: { 集団社会: false } }, '集団社会')).toBe(false)
  })
})

// 回帰防止: 生徒日程表の「登録」で送られた集団参加(schedule-student-count-save の groupClassParticipation)を
// 反映しないと出席者一覧に出ない不具合(Phase 7 で QR 以外の登録経路が取りこぼしていた)を固定する。
describe('resolveSavedGroupClassParticipation (生徒日程表での集団登録の反映)', () => {
  it('登録メッセージの集団参加を採用する（出席者一覧に反映される）', () => {
    expect(resolveSavedGroupClassParticipation({ 集団理科: true }, undefined)).toEqual({ 集団理科: true })
    expect(resolveSavedGroupClassParticipation({ 集団理科: true, 集団社会: true }, {})).toEqual({ 集団理科: true, 集団社会: true })
  })

  it('既知の集団科目だけを true で抽出する（未知科目や true 以外は捨てる）', () => {
    expect(resolveSavedGroupClassParticipation({ 集団理科: true, 数: true, 集団社会: false }, undefined)).toEqual({ 集団理科: true })
    expect(resolveSavedGroupClassParticipation({ 集団社会: 'true' }, undefined)).toEqual({})
  })

  it('明示的な空オブジェクト＝全不参加を尊重し、既存値を消す', () => {
    expect(resolveSavedGroupClassParticipation({}, { 集団理科: true })).toEqual({})
  })

  it('未指定（undefined）のときは既存値を保全して消さない（unsubmit 等）', () => {
    expect(resolveSavedGroupClassParticipation(undefined, { 集団理科: true })).toEqual({ 集団理科: true })
    expect(resolveSavedGroupClassParticipation(undefined, undefined)).toEqual({})
  })

  it('object でない不正値は安全側で空にする', () => {
    expect(resolveSavedGroupClassParticipation(null, { 集団社会: true })).toEqual({})
    expect(resolveSavedGroupClassParticipation('集団理科', undefined)).toEqual({})
  })
})

// 「後から出席可能に変更」(黄色コマ・2026-07-18 塚田先生要望)。
// 実効不可 = unavailableSlots − reopenedSlots / 表示黄色 = unavailableSlots ∩ reopenedSlots。
describe('resolveEffectiveUnavailableSlots / resolveReopenedUnavailableSlots', () => {
  it('reopenedSlots を実効不可から除外する(黄色化で赤警告が消え・自動割振の候補になる)', () => {
    const input = { unavailableSlots: ['2026-07-25_3', '2026-07-26_2'], reopenedSlots: ['2026-07-25_3'] }
    expect(resolveEffectiveUnavailableSlots(input)).toEqual(['2026-07-26_2'])
    expect(resolveReopenedUnavailableSlots(input)).toEqual(['2026-07-25_3'])
  })

  it('reopenedSlots が無い/空なら不可提出をそのまま返す(後方互換)', () => {
    expect(resolveEffectiveUnavailableSlots({ unavailableSlots: ['2026-07-25_3'] })).toEqual(['2026-07-25_3'])
    expect(resolveEffectiveUnavailableSlots(null)).toEqual([])
    expect(resolveReopenedUnavailableSlots({ unavailableSlots: ['2026-07-25_3'] })).toEqual([])
  })

  it('新規再提出後の残骸(不可提出に無い reopened)は黄色にしない(交差のみ)', () => {
    const input = { unavailableSlots: ['2026-07-26_2'], reopenedSlots: ['2026-07-25_3'] }
    expect(resolveReopenedUnavailableSlots(input)).toEqual([])
    expect(resolveEffectiveUnavailableSlots(input)).toEqual(['2026-07-26_2'])
  })
})

describe('appendReopenedSlots (黄色化のラチェット追記)', () => {
  const buildSession = (overrides: Partial<SpecialSessionRow> = {}): SpecialSessionRow => ({
    id: 'session-1',
    label: '夏期講習',
    startDate: '2026-07-21',
    endDate: '2026-08-28',
    teacherInputs: {
      t1: { unavailableSlots: ['2026-07-25_3'], countSubmitted: true, updatedAt: '2026-07-18T00:00:00.000Z' },
    },
    studentInputs: {
      s1: { unavailableSlots: ['2026-07-25_3', '2026-07-26_2'], regularBreakSlots: [], subjectSlots: { 数: 4 }, regularOnly: false, countSubmitted: true, updatedAt: '2026-07-18T00:00:00.000Z' },
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  })

  it('不可提出コマだけを reopenedSlots へ追加し、提出データ(unavailableSlots)は不変(INV-07)', () => {
    const next = appendReopenedSlots([buildSession()], [{ personType: 'student', personId: 's1', slotKey: '2026-07-25_3' }], '2026-07-18T10:00:00.000Z')
    expect(next[0].studentInputs.s1.reopenedSlots).toEqual(['2026-07-25_3'])
    expect(next[0].studentInputs.s1.unavailableSlots).toEqual(['2026-07-25_3', '2026-07-26_2'])
    expect(next[0].updatedAt).toBe('2026-07-18T10:00:00.000Z')
  })

  it('冪等(同じ変換を再適用しても二重追加しない・参照維持)', () => {
    const once = appendReopenedSlots([buildSession()], [{ personType: 'student', personId: 's1', slotKey: '2026-07-25_3' }], '2026-07-18T10:00:00.000Z')
    const twice = appendReopenedSlots(once, [{ personType: 'student', personId: 's1', slotKey: '2026-07-25_3' }], '2026-07-18T11:00:00.000Z')
    expect(twice[0].studentInputs.s1.reopenedSlots).toEqual(['2026-07-25_3'])
    expect(twice[0]).toBe(once[0]) // 変更なし=参照維持(不要な再描画・保存差分を出さない)
  })

  it('不可提出に無いコマ・期間外のコマは追加しない', () => {
    const next = appendReopenedSlots([buildSession()], [
      { personType: 'student', personId: 's1', slotKey: '2026-07-27_1' }, // 不可提出に無い
      { personType: 'student', personId: 's1', slotKey: '2026-09-01_3' }, // 期間外
      { personType: 'student', personId: 'unknown', slotKey: '2026-07-25_3' }, // 入力なし
    ], '2026-07-18T10:00:00.000Z')
    expect(next[0]).toBe(next[0])
    expect(next[0].studentInputs.s1.reopenedSlots).toBeUndefined()
  })

  it('講師の変換(講師日程表クリック経路)も同じ規則で追加する', () => {
    const next = appendReopenedSlots([buildSession()], [{ personType: 'teacher', personId: 't1', slotKey: '2026-07-25_3' }], '2026-07-18T10:00:00.000Z')
    expect(next[0].teacherInputs.t1.reopenedSlots).toEqual(['2026-07-25_3'])
    expect(next[0].studentInputs.s1.reopenedSlots).toBeUndefined() // 生徒側は不変
  })
})