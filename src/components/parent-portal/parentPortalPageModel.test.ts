import { describe, expect, it } from 'vitest'
import {
  PARENT_ABSENCE_BADGE_ACKNOWLEDGED,
  PARENT_ABSENCE_BADGE_REPORTED,
  PARENT_ABSENCE_CONFIRM_NOTE_ACKNOWLEDGE,
  PARENT_ABSENCE_CONFIRM_NOTE_CANCEL,
  PARENT_ABSENCE_CONFIRM_NOTE_SAME_DAY,
  PARENT_ABSENCE_CONFIRM_QUESTION,
  PARENT_ABSENCE_CONFLICT_MESSAGE,
  PARENT_MESSAGE_RATE_LIMIT_MESSAGE,
  PARENT_PORTAL_DISABLED_MESSAGE,
  PARENT_PORTAL_NOTES,
  PARENT_PORTAL_UNAVAILABLE_MESSAGE,
  PARENT_SCHEDULE_EMPTY_MONTH_MESSAGE,
  PARENT_SCHEDULE_LECTURE_ONLY_MONTH_MESSAGE,
  PARENT_SCHEDULE_NO_LESSON_MESSAGE,
  buildParentAbsenceRowAriaLabel,
  buildParentPortalRequestUrl,
  buildParentScheduleRows,
  canShiftParentScheduleMonth,
  describeParentAbsenceBadge,
  describeParentAbsenceConfirm,
  describeParentScheduleDayStatus,
  describeParentScheduleLesson,
  formatJstDateTimeLabel,
  formatParentAbsenceTargetLabel,
  formatParentScheduleDayLabel,
  formatParentScheduleMonthLabel,
  formatParentScheduleRowDateLabel,
  formatParentSnapshotSavedAtLabel,
  getParentPortalApiBaseUrl,
  isParentPortalScheduleResponse,
  isParentScheduleDayTentative,
  readParentAbsenceNotices,
  resolveParentAbsenceSendError,
  resolveParentPortalLoadError,
  resolveParentScheduleMonthNotice,
  shiftParentScheduleMonth,
  shouldReloadParentScheduleAfterSendError,
  toParentAbsenceTarget,
  type ParentScheduleDay,
  type ParentScheduleLesson,
} from './parentPortalPageModel'

const lesson = (overrides: Partial<ParentScheduleLesson> = {}): ParentScheduleLesson => ({
  slotNumber: 3,
  timeLabel: '16:00',
  subject: '数学',
  kind: 'regular',
  isTentative: false,
  ...overrides,
})

const day = (overrides: Partial<ParentScheduleDay> = {}): ParentScheduleDay => ({
  dateKey: '2026-09-14',
  weekday: 1,
  kind: 'board',
  lessons: [],
  ...overrides,
})

describe('getParentPortalApiBaseUrl', () => {
  it('Hosting 上は同一オリジンの /api/parent (firebase.json rewrite 経由)', () => {
    expect(getParentPortalApiBaseUrl('https://komahyouapp-prod.web.app', {})).toBe('https://komahyouapp-prod.web.app/api/parent')
    expect(getParentPortalApiBaseUrl('https://komahyouapp-staging.web.app/', { projectId: 'komahyouapp-staging' })).toBe('https://komahyouapp-staging.web.app/api/parent')
  })

  it('localhost は cloudfunctions.net の parentPortalApi 直(region 既定 asia-northeast1)', () => {
    expect(getParentPortalApiBaseUrl('http://localhost:5173', { projectId: 'komahyouapp-staging' })).toBe('https://asia-northeast1-komahyouapp-staging.cloudfunctions.net/parentPortalApi')
    expect(getParentPortalApiBaseUrl('http://127.0.0.1:5173', { projectId: 'p', region: 'us-central1' })).toBe('https://us-central1-p.cloudfunctions.net/parentPortalApi')
  })

  it('localhost で projectId が無ければ同一オリジンへフォールバック、origin 空なら空文字', () => {
    expect(getParentPortalApiBaseUrl('http://localhost:5173', {})).toBe('http://localhost:5173/api/parent')
    expect(getParentPortalApiBaseUrl('', { projectId: 'p' })).toBe('')
  })
})

describe('buildParentPortalRequestUrl', () => {
  it('トークンを最後のパスセグメントに置き、範囲指定は ?from&to で付ける', () => {
    expect(buildParentPortalRequestUrl('https://x/api/parent', 'abcDEF123_-abcDEF123_-abcDEF123_')).toBe('https://x/api/parent/abcDEF123_-abcDEF123_-abcDEF123_')
    expect(buildParentPortalRequestUrl('https://x/api/parent', 'tok', { from: '2026-09-01', to: '2026-09-28' })).toBe('https://x/api/parent/tok?from=2026-09-01&to=2026-09-28')
  })
})

describe('formatParentScheduleDayLabel / formatParentScheduleDateShort', () => {
  it("'2026-09-14' + 月曜 → '9月14日(月)'", () => {
    expect(formatParentScheduleDayLabel('2026-09-14', 1)).toBe('9月14日(月)')
    expect(formatParentScheduleDayLabel('2026-12-06', 0)).toBe('12月6日(日)')
  })

  it('曜日はサーバー応答の値をそのまま使う(端末 TZ で再計算しない)', () => {
    expect(formatParentScheduleDayLabel('2026-09-14', 6)).toBe('9月14日(土)')
  })

  it('壊れた dateKey はそのまま返す', () => {
    expect(formatParentScheduleDayLabel('bad', 1)).toBe('bad(月)')
  })
})

describe('formatJstDateTimeLabel / formatParentSnapshotSavedAtLabel', () => {
  it('ISO を JST で整形する(UTC 05:05 → 14:05)', () => {
    expect(formatJstDateTimeLabel('2026-09-13T05:05:00.000Z')).toBe('9月13日 14:05')
    expect(formatParentSnapshotSavedAtLabel('2026-09-13T05:05:00.000Z')).toBe('9月13日 14:05 時点')
  })

  it('JST で日付をまたぐ(UTC 15:30 → 翌日 0:30)', () => {
    expect(formatJstDateTimeLabel('2026-09-13T15:30:00.000Z')).toBe('9月14日 0:30')
  })

  it('null/壊れた値は不明表示', () => {
    expect(formatJstDateTimeLabel(null)).toBeNull()
    expect(formatJstDateTimeLabel('not-a-date')).toBeNull()
    expect(formatParentSnapshotSavedAtLabel(null)).toBe('保存時刻は不明です')
  })
})

// 移動は暦の 1 か月単位(k-5)。どこまで動けるかの権威は**サーバーが返す bounds**
// (2026-09-18 に来月を閉じた = 実際の bounds は先月 1 日〜今月末日になる)。ここでは bounds を明示して境界を固定する。
describe('shiftParentScheduleMonth (月単位・bounds の端で止まる)', () => {
  const bounds = { minFrom: '2026-08-01', maxTo: '2026-10-31' }
  const september = { from: '2026-09-01', to: '2026-09-30' }

  it('表示中の月の 1 日〜末日を 1 か月ずつ前後へ動かす', () => {
    expect(shiftParentScheduleMonth(september, 1, bounds)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(shiftParentScheduleMonth(september, -1, bounds)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('bounds の外へは動かない(null)・canShift は false', () => {
    expect(shiftParentScheduleMonth({ from: '2026-08-01', to: '2026-08-31' }, -1, bounds)).toBeNull()
    expect(shiftParentScheduleMonth({ from: '2026-10-01', to: '2026-10-31' }, 1, bounds)).toBeNull()
    expect(canShiftParentScheduleMonth({ from: '2026-08-01', to: '2026-08-31' }, -1, bounds)).toBe(false)
    expect(canShiftParentScheduleMonth({ from: '2026-10-01', to: '2026-10-31' }, 1, bounds)).toBe(false)
    expect(canShiftParentScheduleMonth(september, 1, bounds)).toBe(true)
    expect(canShiftParentScheduleMonth(september, -1, bounds)).toBe(true)
  })

  it('年またぎ・閏年の月末', () => {
    const wide = { minFrom: '2026-01-01', maxTo: '2028-12-31' }
    expect(shiftParentScheduleMonth({ from: '2026-12-01', to: '2026-12-31' }, 1, wide)).toEqual({ from: '2027-01-01', to: '2027-01-31' })
    expect(shiftParentScheduleMonth({ from: '2028-01-01', to: '2028-01-31' }, 1, wide)).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(shiftParentScheduleMonth({ from: 'bad', to: 'bad' }, 1, wide)).toBeNull()
  })

  it('見出しは「2026年9月」', () => {
    expect(formatParentScheduleMonthLabel('2026-09-01')).toBe('2026年9月')
  })
})

describe('describeParentScheduleLesson (spec §D-3)', () => {
  it('通常・増コマは科目のみ(種別ラベルなし)', () => {
    expect(describeParentScheduleLesson(lesson({ kind: 'regular' }))).toEqual({ main: '数学' })
    expect(describeParentScheduleLesson(lesson({ kind: 'extra' }))).toEqual({ main: '数学' })
  })

  it('振替は「振替」を添える', () => {
    expect(describeParentScheduleLesson(lesson({ kind: 'makeup', subject: '英語' }))).toEqual({ main: '英語', sub: '振替' })
  })

  it('お休みは振替先(日付+限)か「調整中」', () => {
    expect(describeParentScheduleLesson(lesson({ kind: 'absent', makeupDestination: { dateKey: '2026-09-20', slotNumber: 2 } }))).toEqual({ main: 'お休み', sub: '9/20 2限に振替' })
    expect(describeParentScheduleLesson(lesson({ kind: 'absent', makeupDestination: null }))).toEqual({ main: 'お休み', sub: '振替日は調整中' })
    expect(describeParentScheduleLesson(lesson({ kind: 'absent' }))).toEqual({ main: 'お休み', sub: '振替日は調整中' })
  })

  // 1 コマ 1 行に収まる短い言い回し(確認リスト k-11 2026-09-14「振替日付も含めて1行表示」)。
  it('振替コマは振替元を、休みは振替先を「月日コマ」の短い形で出す(確認リスト その他 2026-09-14 / k-11)', () => {
    const origin = { dateKey: '2026-09-21', slotNumber: 1 }
    expect(describeParentScheduleLesson(lesson({ kind: 'makeup', subject: '英語', makeupOrigin: origin }))).toEqual({ main: '英語', sub: '9/21 1限の振替' })
    expect(describeParentScheduleLesson(lesson({ kind: 'attended', makeupOrigin: origin }))).toEqual({ main: '数学', sub: '出席（9/21 1限の振替）' })
    expect(describeParentScheduleLesson(lesson({ kind: 'absent-no-makeup', makeupOrigin: origin }))).toEqual({ main: 'お休み', sub: '9/21 1限分 振替なし' })
    // 元コマ不明なら日付だけ。
    expect(describeParentScheduleLesson(lesson({ kind: 'makeup', makeupOrigin: { dateKey: '2026-09-21', slotNumber: null } })).sub).toBe('9/21の振替')
    // 補足は 12 文字以内(スマホ幅で日付・時限の列と並べて 1 行に収まる長さ)。
    for (const described of [
      describeParentScheduleLesson(lesson({ kind: 'absent', makeupDestination: { dateKey: '2026-12-31', slotNumber: 5 } })),
      describeParentScheduleLesson(lesson({ kind: 'makeup', makeupOrigin: { dateKey: '2026-12-31', slotNumber: 5 } })),
    ]) {
      expect(described.sub!.length).toBeLessThanOrEqual(12)
    }
    // 通常授業は振替元を持っていても出さない(応答には来ない前提の保険)。
    expect(describeParentScheduleLesson(lesson({ kind: 'regular', makeupOrigin: origin }))).toEqual({ main: '数学' })
  })

  it('振替なし欠席・出席済み', () => {
    expect(describeParentScheduleLesson(lesson({ kind: 'absent-no-makeup' }))).toEqual({ main: 'お休み', sub: '振替なし' })
    expect(describeParentScheduleLesson(lesson({ kind: 'attended' }))).toEqual({ main: '数学', sub: '出席済み' })
  })

  it('科目が空でも空文字を出さない', () => {
    expect(describeParentScheduleLesson(lesson({ subject: '' })).main).toBe('授業')
  })
})

describe('describeParentScheduleDayStatus / isParentScheduleDayTentative', () => {
  it('臨時・祝日休みは「教室休み」。講習期間の「別途ご案内」は出さない(k-4)', () => {
    expect(describeParentScheduleDayStatus(day({ kind: 'closed' }))).toBe('教室休み')
    expect(describeParentScheduleDayStatus(day({ kind: 'board', lessons: [lesson()] }))).toBeNull()
  })

  it('盤面にある日で配置 0 件は「授業の予定はありません」(テンプレで補わない・§D-2)', () => {
    expect(describeParentScheduleDayStatus(day({ kind: 'board', lessons: [] }))).toBe(PARENT_SCHEDULE_NO_LESSON_MESSAGE)
    expect(describeParentScheduleDayStatus(day({ kind: 'board', lessons: [lesson()] }))).toBeNull()
    expect(describeParentScheduleDayStatus(day({ kind: 'template', lessons: [lesson({ isTentative: true })] }))).toBeNull()
  })

  it('テンプレ補完の日だけ「予定(変更の可能性あり)」', () => {
    expect(isParentScheduleDayTentative(day({ kind: 'template', lessons: [lesson({ isTentative: true })] }))).toBe(true)
    expect(isParentScheduleDayTentative(day({ kind: 'board', lessons: [lesson()] }))).toBe(false)
  })
})

describe('buildParentScheduleRows: 1 コマ 1 行(確認リスト その他 2026-09-14)', () => {
  it('授業ごとに 1 行。日付は同じ日の先頭行だけ、時刻は開始時刻だけ', () => {
    const rows = buildParentScheduleRows([
      day({ dateKey: '2026-09-14', weekday: 1, kind: 'board', lessons: [lesson({ slotNumber: 4, timeLabel: '18:00-19:30', subject: '英' }), lesson({ slotNumber: 5, timeLabel: '19:40-21:10', subject: '数', kind: 'absent', makeupDestination: { dateKey: '2026-09-20', slotNumber: 2 } })] }),
      day({ dateKey: '2026-09-15', weekday: 2, kind: 'template', lessons: [lesson({ slotNumber: 3, timeLabel: '16:20-17:50', isTentative: true })] }),
    ], '2026-09-15')
    expect(rows.map((row) => [row.dateKey, row.isFirstOfDay, row.slotLabel, row.timeLabel, row.main, row.sub ?? '', row.isTentative, row.isToday])).toEqual([
      ['2026-09-14', true, '4限', '18:00', '英', '', false, false],
      ['2026-09-14', false, '5限', '19:40', 'お休み', '9/20 2限に振替', false, false],
      ['2026-09-15', true, '3限', '16:20', '数学', '', true, true],
    ])
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })

  it('教室休み・授業の無い日は 1 行にまとめる', () => {
    const rows = buildParentScheduleRows([
      day({ dateKey: '2026-09-21', weekday: 1, kind: 'closed', lessons: [] }),
      day({ dateKey: '2026-09-22', weekday: 2, kind: 'board', lessons: [] }),
    ], '2026-09-01')
    expect(rows.map((row) => [row.rowKind, row.main, row.slotLabel, row.isFirstOfDay])).toEqual([
      ['closed', '教室休み', '', true],
      ['status', PARENT_SCHEDULE_NO_LESSON_MESSAGE, '', true],
    ])
    expect(buildParentScheduleRows([], '2026-09-01')).toEqual([])
  })

  it('教室休みの日から出した振替は、教室休みの行に振替先を添える(確認リスト k-11)', () => {
    const rows = buildParentScheduleRows([
      day({ dateKey: '2026-09-23', weekday: 3, kind: 'closed', lessons: [], makeupDestinations: [{ dateKey: '2026-09-30', slotNumber: 1 }, { dateKey: '2026-10-02', slotNumber: 3 }] }),
    ], '2026-09-01')
    expect(rows.map((row) => [row.rowKind, row.main, row.sub ?? ''])).toEqual([['closed', '教室休み', '9/30 1限・10/2 3限に振替']])
  })

  it('行の日付は「14日(月)」(月は見出しにある)', () => {
    expect(formatParentScheduleRowDateLabel('2026-09-14', 1)).toBe('14日(月)')
    expect(formatParentScheduleRowDateLabel('bad', 0)).toBe('bad(日)')
  })
})

describe('resolveParentPortalLoadError / resolveParentAbsenceSendError', () => {
  it('サーバーの { error } を優先して表示する', () => {
    expect(resolveParentPortalLoadError(410, { error: 'サーバー文言' })).toBe('サーバー文言')
    expect(resolveParentAbsenceSendError(429, { error: '本日の上限' })).toBe('本日の上限')
    expect(resolveParentAbsenceSendError(409, { error: 'このコマはすでにお休みの連絡を受け付けています。' })).toBe('このコマはすでにお休みの連絡を受け付けています。')
  })

  it('410 は理由を出し分けない共通文言、403 は利用停止、400 は無効リンク', () => {
    expect(resolveParentPortalLoadError(410)).toBe(PARENT_PORTAL_UNAVAILABLE_MESSAGE)
    expect(resolveParentPortalLoadError(404, {})).toBe(PARENT_PORTAL_UNAVAILABLE_MESSAGE)
    expect(resolveParentPortalLoadError(403, { error: '' })).toBe(PARENT_PORTAL_DISABLED_MESSAGE)
    expect(resolveParentPortalLoadError(400)).toBe('このリンクは無効です。教室へお問い合わせください。')
    expect(resolveParentPortalLoadError(500)).toBe('データの読み込みに失敗しました。')
  })

  it('休み連絡 POST: 409/400 は連絡できない案内、429 は回数制限、410/403 は GET と同じ', () => {
    expect(resolveParentAbsenceSendError(409)).toBe(PARENT_ABSENCE_CONFLICT_MESSAGE)
    expect(resolveParentAbsenceSendError(400)).toBe(PARENT_ABSENCE_CONFLICT_MESSAGE)
    expect(resolveParentAbsenceSendError(429)).toBe(PARENT_MESSAGE_RATE_LIMIT_MESSAGE)
    expect(resolveParentAbsenceSendError(410)).toBe(PARENT_PORTAL_UNAVAILABLE_MESSAGE)
    expect(resolveParentAbsenceSendError(403)).toBe(PARENT_PORTAL_DISABLED_MESSAGE)
    expect(resolveParentAbsenceSendError(503)).toBe('送信に失敗しました。時間をおいて再度お試しください。')
  })

  // ★409 = 画面の日程が古い。取り直さないと「押せるのに必ず失敗する行」が残る。
  it('409 のときだけ日程を取り直す', () => {
    expect(shouldReloadParentScheduleAfterSendError(409)).toBe(true)
    for (const status of [400, 403, 410, 429, 500]) {
      expect(shouldReloadParentScheduleAfterSendError(status), String(status)).toBe(false)
    }
  })
})

describe('isParentPortalScheduleResponse', () => {
  it('契約の必須フィールドが揃っていれば真', () => {
    expect(isParentPortalScheduleResponse({
      studentName: '青木', classroomName: '開発用教室', snapshotSavedAt: null, today: '2026-09-13',
      range: { from: '2026-09-06', to: '2026-10-11' }, bounds: { minFrom: '2026-07-19', maxTo: '2026-12-06' }, days: [],
    })).toBe(true)
  })

  it('HTML(catch-all rewrite)や欠けた JSON は偽', () => {
    expect(isParentPortalScheduleResponse('<!doctype html>')).toBe(false)
    expect(isParentPortalScheduleResponse({ studentName: 'x' })).toBe(false)
    expect(isParentPortalScheduleResponse(null)).toBe(false)
  })
})

// 2026-09-18: 休み連絡(自由記述の廃止)。
describe('readParentAbsenceNotices', () => {
  it('応答の absenceNotices を読み、壊れた行は捨てる', () => {
    expect(readParentAbsenceNotices({
      absenceNotices: [
        { dateKey: '2026-09-20', slotNumber: 3, acknowledged: false },
        { dateKey: '2026-09-21', slotNumber: 1, acknowledged: true },
        { dateKey: '2026-09-22' },
        { slotNumber: 2, acknowledged: true },
        { dateKey: '2026-09-23', slotNumber: '2' },
        null,
      ],
    })).toEqual([
      { dateKey: '2026-09-20', slotNumber: 3, acknowledged: false },
      { dateKey: '2026-09-21', slotNumber: 1, acknowledged: true },
    ])
  })

  // ★Hosting が先に出て旧 functions が応答している間でも壊れない(k-4 の hasLectureLessons と同じ作法)。
  it('フィールドが無い旧応答・壊れた値は空配列', () => {
    expect(readParentAbsenceNotices({ days: [] })).toEqual([])
    expect(readParentAbsenceNotices({ absenceNotices: 'x' })).toEqual([])
    expect(readParentAbsenceNotices(null)).toEqual([])
  })

  it('acknowledged は真偽値 true のときだけ真(安全側 = 未確認扱い)', () => {
    expect(readParentAbsenceNotices({ absenceNotices: [{ dateKey: '2026-09-20', slotNumber: 3, acknowledged: 'yes' }] }))
      .toEqual([{ dateKey: '2026-09-20', slotNumber: 3, acknowledged: false }])
  })
})

describe('休み連絡できる行とバッジ(buildParentScheduleRows + notices)', () => {
  const days = [day({
    dateKey: '2026-09-20',
    weekday: 0,
    kind: 'board',
    lessons: [
      lesson({ slotNumber: 1, timeLabel: '13:00-14:30', subject: '英', kind: 'regular' }),
      lesson({ slotNumber: 2, timeLabel: '14:40-16:10', subject: '数', kind: 'regular' }),
      lesson({ slotNumber: 3, timeLabel: '16:20-17:50', subject: '国', kind: 'attended' }),
      lesson({ slotNumber: 4, timeLabel: '18:00-19:30', subject: '理', kind: 'absent' }),
    ],
  })]

  it('これから受ける授業で、まだ連絡していない行だけタップできる', () => {
    const rows = buildParentScheduleRows(days, '2026-09-13', [])
    expect(rows.map((row) => [row.slotNumber, row.canReportAbsence, row.absenceStatus])).toEqual([
      [1, true, 'none'],
      [2, true, 'none'],
      // 出席済み・お休みのコマは連絡できない(サーバーの 409 と同じ判定)。
      [3, false, 'none'],
      [4, false, 'none'],
    ])
  })

  it('連絡済みの行はタップ不可で、未確認なら「休み連絡済」・確認済みなら「教室確認済」', () => {
    const rows = buildParentScheduleRows(days, '2026-09-13', [
      { dateKey: '2026-09-20', slotNumber: 1, acknowledged: false },
      { dateKey: '2026-09-20', slotNumber: 2, acknowledged: true },
    ])
    expect(rows.map((row) => [row.slotNumber, row.canReportAbsence, row.absenceStatus])).toEqual([
      [1, false, 'reported'],
      [2, false, 'acknowledged'],
      [3, false, 'none'],
      [4, false, 'none'],
    ])
    expect(describeParentAbsenceBadge('reported')).toBe(PARENT_ABSENCE_BADGE_REPORTED)
    expect(describeParentAbsenceBadge('acknowledged')).toBe(PARENT_ABSENCE_BADGE_ACKNOWLEDGED)
    expect(describeParentAbsenceBadge('none')).toBeNull()
  })

  it('別の日・別の限の連絡はこの行のバッジにしない', () => {
    const rows = buildParentScheduleRows(days, '2026-09-13', [
      { dateKey: '2026-09-21', slotNumber: 1, acknowledged: true },
      { dateKey: '2026-09-20', slotNumber: 5, acknowledged: true },
    ])
    expect(rows.every((row) => row.absenceStatus === 'none')).toBe(true)
  })

  it('当日のコマもタップできる・過去の日はできない(オーナー確定 3)', () => {
    expect(buildParentScheduleRows(days, '2026-09-20', [])[0].canReportAbsence).toBe(true)
    expect(buildParentScheduleRows(days, '2026-09-21', [])[0].canReportAbsence).toBe(false)
  })

  it('教室休み・授業の無い日の行はタップできない', () => {
    const rows = buildParentScheduleRows([
      day({ dateKey: '2026-09-23', kind: 'closed', lessons: [] }),
      day({ dateKey: '2026-09-24', kind: 'board', lessons: [] }),
    ], '2026-09-13', [])
    expect(rows.every((row) => !row.canReportAbsence && row.absenceStatus === 'none')).toBe(true)
  })

  it('テンプレ補完(予定)のコマもタップできる(盤面がまだ無い先の予定こそ事前連絡が要る)', () => {
    const rows = buildParentScheduleRows([
      day({ dateKey: '2026-09-28', kind: 'template', lessons: [lesson({ slotNumber: 2, kind: 'regular', isTentative: true })] }),
    ], '2026-09-13', [])
    expect(rows[0].canReportAbsence).toBe(true)
    expect(rows[0].isTentative).toBe(true)
  })

  it('連絡先の特定に必要な値(限・科目)を行が持つ', () => {
    const rows = buildParentScheduleRows(days, '2026-09-13', [])
    expect(toParentAbsenceTarget(rows[0])).toEqual({ dateKey: '2026-09-20', weekday: 0, slotNumber: 1, timeLabel: '13:00', subject: '英' })
    // タップできない行からは対象を作らない(押せない行が押されても送らない)。
    expect(toParentAbsenceTarget(rows[2])).toBeNull()
    expect(buildParentAbsenceRowAriaLabel(rows[2])).toBeNull()
    expect(buildParentAbsenceRowAriaLabel(rows[0])).toBe('9月20日(日) 1限 13:00〜 英 のお休みを連絡する')
  })

  it('既定の notices 引数は空(旧応答でもバッジが出ない・タップ判定は変わらない)', () => {
    expect(buildParentScheduleRows(days, '2026-09-13').map((row) => row.absenceStatus)).toEqual(['none', 'none', 'none', 'none'])
  })
})

describe('休み連絡の確認モーダル', () => {
  const target = { dateKey: '2026-09-20', weekday: 6, slotNumber: 3, timeLabel: '16:20', subject: '英' }

  it('対象は「9月20日(土) 3限 16:20〜 英」の形', () => {
    expect(formatParentAbsenceTargetLabel(target)).toBe('9月20日(土) 3限 16:20〜 英')
    // 科目・時刻が欠けても空白だけの見出しにしない。
    expect(formatParentAbsenceTargetLabel({ ...target, subject: '', timeLabel: '' })).toBe('9月20日(土) 3限')
  })

  it('確認文と注意書き(確認済み表示・取り消しは電話)を出す', () => {
    const described = describeParentAbsenceConfirm(target, '2026-09-13')
    expect(described.target).toBe('9月20日(土) 3限 16:20〜 英')
    expect(described.question).toBe(PARENT_ABSENCE_CONFIRM_QUESTION)
    expect(described.notes).toEqual([PARENT_ABSENCE_CONFIRM_NOTE_ACKNOWLEDGE, PARENT_ABSENCE_CONFIRM_NOTE_CANCEL])
    expect(described.notes[0]).toContain(PARENT_ABSENCE_BADGE_ACKNOWLEDGED)
    expect(described.notes[1]).toContain('お電話')
  })

  // ★当日は教室が気づくのが遅れる恐れがあるので電話併用を促す(オーナー指示 2026-09-18)。
  it('当日のコマだけ「電話でも連絡を」の注意を足す', () => {
    const sameDay = describeParentAbsenceConfirm(target, '2026-09-20')
    expect(sameDay.notes).toHaveLength(3)
    expect(sameDay.notes[2]).toBe(PARENT_ABSENCE_CONFIRM_NOTE_SAME_DAY)
    expect(sameDay.notes[2]).toContain('お電話')
    expect(describeParentAbsenceConfirm(target, '2026-09-19').notes).toHaveLength(2)
  })
})

// 確認リスト k-4 再報告(2026-09-14・オーナー回答): 講習だけの月は注記、講習も無い月は従来どおり。
describe('resolveParentScheduleMonthNotice', () => {
  const closed: ParentScheduleDay = { dateKey: '2026-08-10', weekday: 1, kind: 'closed', lessons: [] }
  const lessonDay: ParentScheduleDay = { dateKey: '2026-08-03', weekday: 1, kind: 'board', lessons: [{ slotNumber: 1, timeLabel: '16:00', subject: '数', kind: 'attended', isTentative: false }] }

  it('通常授業の日が無く講習があった月は講習の注記(臨時休みの行があっても出す)', () => {
    expect(resolveParentScheduleMonthNotice({ days: [closed], hasLectureLessons: true })).toBe(PARENT_SCHEDULE_LECTURE_ONLY_MONTH_MESSAGE)
    expect(resolveParentScheduleMonthNotice({ days: [], hasLectureLessons: true })).toBe(PARENT_SCHEDULE_LECTURE_ONLY_MONTH_MESSAGE)
  })

  it('通常授業の日があれば講習があっても注記しない', () => {
    expect(resolveParentScheduleMonthNotice({ days: [lessonDay, closed], hasLectureLessons: true })).toBeNull()
  })

  it('講習が無い月は従来どおり: 行が無ければ「予定はありません」、休みだけなら何も出さない。印の無い旧応答も同じ', () => {
    expect(resolveParentScheduleMonthNotice({ days: [], hasLectureLessons: false })).toBe(PARENT_SCHEDULE_EMPTY_MONTH_MESSAGE)
    expect(resolveParentScheduleMonthNotice({ days: [] })).toBe(PARENT_SCHEDULE_EMPTY_MONTH_MESSAGE)
    expect(resolveParentScheduleMonthNotice({ days: [closed] })).toBeNull()
  })
})

describe('PARENT_PORTAL_NOTES', () => {
  it('注記 3 種(保存時点・変更あり・連絡導線)を常時表示する', () => {
    expect(PARENT_PORTAL_NOTES).toHaveLength(3)
    expect(PARENT_PORTAL_NOTES[0]).toContain('保存された時点')
    expect(PARENT_PORTAL_NOTES[1]).toContain('変更になる')
    // ★2026-09-18: 導線は「ページ下部のフォーム」ではなく「授業の行をタップ」(フォームは廃止)。
    expect(PARENT_PORTAL_NOTES[2]).toContain('授業の行をタップ')
    expect(PARENT_PORTAL_NOTES[2]).toContain('お電話')
    expect(PARENT_PORTAL_NOTES[2]).not.toContain('ページ下部')
  })
})
