// 保護者QRの講習コマ(日程公開・オーナー確定 2026-11-03・spec-parent-portal §0-8)。
// 公開ページの表示・タップ可否と、室長側(連絡の読み取り・選択肢)を固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildParentAbsenceMessageId, buildParentMessageDoc } from '../../../functions/src/parentPortal'
import {
  formatParentAbsenceLessonLabel,
  parseParentMessageEntry,
  PARENT_ABSENCE_CHOICES,
  PARENT_LECTURE_ABSENCE_CHOICES,
  resolveParentAbsenceChoices,
} from '../../utils/parentMessages'
import { buildParentScheduleRows, describeParentScheduleLesson, isParentLessonSameDayPhoneNotice } from './parentPortalPageModel'

describe('describeParentScheduleLesson: 講習コマ', () => {
  it('講習コマは科目に「講習」の補足を付ける', () => {
    expect(describeParentScheduleLesson({ slotNumber: 1, timeLabel: '13:00-14:30', subject: '数', kind: 'lecture', isTentative: false, isLecture: true })).toEqual({ main: '数', sub: '講習' })
  })

  it('講習の休み・振無休は「お休み」＋講習の科目。振替日の案内は出さない', () => {
    for (const kind of ['absent', 'absent-no-makeup'] as const) {
      expect(describeParentScheduleLesson({ slotNumber: 1, timeLabel: '', subject: '数', kind, isTentative: false, isLecture: true })).toEqual({ main: 'お休み', sub: '講習 数' })
    }
    expect(describeParentScheduleLesson({ slotNumber: 1, timeLabel: '', subject: '数', kind: 'attended', isTentative: false, isLecture: true })).toEqual({ main: '数', sub: '講習・出席済み' })
  })

  it('講習でない休みは従来どおり(振替日は調整中)', () => {
    expect(describeParentScheduleLesson({ slotNumber: 1, timeLabel: '', subject: '数', kind: 'absent', makeupDestination: null, isTentative: false })).toEqual({ main: 'お休み', sub: '振替日は調整中' })
  })
})

describe('buildParentScheduleRows: 講習コマのタップ', () => {
  const days = [{ dateKey: '2026-12-24', weekday: 4, kind: 'board' as const, lessons: [
    { slotNumber: 1, timeLabel: '13:00-14:30', subject: '数', kind: 'lecture' as const, isTentative: false, isLecture: true },
    { slotNumber: 2, timeLabel: '14:40-16:10', subject: '英', kind: 'absent' as const, isTentative: false, isLecture: true },
  ] }]

  it('明日以降の講習コマは休み連絡できる。講習の休みの記録はできない', () => {
    const rows = buildParentScheduleRows(days, '2026-12-03')
    expect(rows.map((row) => [row.slotNumber, row.canReportAbsence])).toEqual([[1, true], [2, false]])
  })

  it('当日の講習コマは電話の案内を出す', () => {
    expect(isParentLessonSameDayPhoneNotice('lecture', '2026-12-24', '2026-12-24')).toBe(true)
    const rows = buildParentScheduleRows(days, '2026-12-24')
    expect(rows[0]).toMatchObject({ canReportAbsence: false, showsSameDayPhoneNotice: true })
  })
})

describe('室長側: 講習コマの休み連絡', () => {
  it('サーバーが書いた講習の連絡(lessonKind lecture)を落とさず読む', () => {
    const fingerprint = '0123456789abcdef0123456789abcdef'
    const doc = buildParentMessageDoc({
      workspaceKey: 'main',
      classroomId: 'v8OZ7zH8vONNHjjYVcR1',
      studentId: 's001',
      studentName: '青木',
      absence: { dateKey: '2026-12-24', slotNumber: 1, subject: '数', lessonKind: 'lecture', isTentative: false },
      createdAt: '2026-12-03T01:00:00.000Z',
      token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345',
      tokenFingerprint: fingerprint,
    })
    const entry = parseParentMessageEntry(buildParentAbsenceMessageId(fingerprint, '2026-12-24', 1), doc)
    expect(entry?.absence).toEqual({ dateKey: '2026-12-24', slotNumber: 1, subject: '数', lessonKind: 'lecture', isTentative: false })
    expect(formatParentAbsenceLessonLabel(entry!.absence)).toBe('12月24日(木) 1限 数(講習)')
  })

  it('講習の選択肢は 休み / 振無休 / 何もしない(振替先を今決めるは出さない)。それ以外は従来の四択', () => {
    expect(resolveParentAbsenceChoices('lecture').map((choice) => choice.resolution)).toEqual(['absent', 'absent-no-makeup', 'manual'])
    expect(resolveParentAbsenceChoices('lecture')).toBe(PARENT_LECTURE_ABSENCE_CHOICES)
    for (const kind of ['regular', 'makeup', 'extra'] as const) {
      expect(resolveParentAbsenceChoices(kind)).toBe(PARENT_ABSENCE_CHOICES)
    }
  })

  it('連絡モーダルは連絡ごとに resolveParentAbsenceChoices で選択肢を出す', () => {
    const MODAL = readFileSync(fileURLToPath(new URL('./ParentMessagesModal.tsx', import.meta.url)), 'utf8')
    expect(MODAL).toContain('{resolveParentAbsenceChoices(entry.absence.lessonKind).map((choice) => (')
    expect(MODAL).not.toContain('{PARENT_ABSENCE_CHOICES.map(')
  })
})

describe('保護者QRの範囲(functions/src/index.ts)', () => {
  const FUNCTIONS_INDEX = readFileSync(fileURLToPath(new URL('../../../functions/src/index.ts', import.meta.url)), 'utf8')
  it('公開中の講習の終了月まで上限を延ばす(GET と POST が同じ resolveRange を通る)', () => {
    expect(FUNCTIONS_INDEX).toContain('resolveRange: (input, todayKey, payload) => resolveParentScheduleRange(input, todayKey, resolveParentPublishedLectureEndDateKey(payload, todayKey)),')
  })
})
