import { describe, expect, it } from 'vitest'
import {
  PARENT_MESSAGE_BODY_LIMIT,
  PARENT_MESSAGE_RATE_LIMIT_MESSAGE,
  PARENT_MESSAGE_SENDER_NAME_LIMIT,
  PARENT_PORTAL_DISABLED_MESSAGE,
  PARENT_PORTAL_NOTES,
  PARENT_PORTAL_UNAVAILABLE_MESSAGE,
  PARENT_SCHEDULE_NO_LESSON_MESSAGE,
  buildParentPortalRequestUrl,
  canShiftParentScheduleRange,
  describeParentScheduleDayStatus,
  describeParentScheduleLesson,
  formatJstDateTimeLabel,
  formatParentScheduleDayLabel,
  formatParentSnapshotSavedAtLabel,
  getParentPortalApiBaseUrl,
  isParentPortalScheduleResponse,
  isParentScheduleDayTentative,
  resolveParentMessageSendError,
  resolveParentPortalLoadError,
  shiftParentScheduleRange,
  validateParentMessageInput,
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

describe('shiftParentScheduleRange', () => {
  const bounds = { minFrom: '2026-07-19', maxTo: '2026-12-06' }

  it('28 日ずつ前後へ動かす', () => {
    const range = { from: '2026-09-06', to: '2026-10-11' }
    expect(shiftParentScheduleRange(range, 28, bounds)).toEqual({ from: '2026-10-04', to: '2026-11-08' })
    expect(shiftParentScheduleRange(range, -28, bounds)).toEqual({ from: '2026-08-09', to: '2026-09-13' })
  })

  it('下限を割ったら幅を保ったまま minFrom に寄せる', () => {
    const range = { from: '2026-08-09', to: '2026-09-13' }
    expect(shiftParentScheduleRange(range, -28, bounds)).toEqual({ from: '2026-07-19', to: '2026-08-23' })
  })

  it('上限を超えたら幅を保ったまま maxTo に寄せる', () => {
    const range = { from: '2026-10-04', to: '2026-11-08' }
    expect(shiftParentScheduleRange(range, 28, bounds)).toEqual({ from: '2026-11-01', to: '2026-12-06' })
  })

  it('端に達していれば canShift は false', () => {
    expect(canShiftParentScheduleRange({ from: '2026-07-19', to: '2026-08-23' }, -28, bounds)).toBe(false)
    expect(canShiftParentScheduleRange({ from: '2026-11-01', to: '2026-12-06' }, 28, bounds)).toBe(false)
    expect(canShiftParentScheduleRange({ from: '2026-09-06', to: '2026-10-11' }, 28, bounds)).toBe(true)
  })

  it('幅が上下限より広いときも下限を割らない', () => {
    const narrow = { minFrom: '2026-09-01', maxTo: '2026-09-10' }
    expect(shiftParentScheduleRange({ from: '2026-09-01', to: '2026-09-30' }, 28, narrow)).toEqual({ from: '2026-09-01', to: '2026-09-10' })
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
    expect(describeParentScheduleLesson(lesson({ kind: 'absent', makeupDestination: { dateKey: '2026-09-20', slotNumber: 2 } }))).toEqual({ main: 'お休み', sub: '振替: 9月20日 2限' })
    expect(describeParentScheduleLesson(lesson({ kind: 'absent', makeupDestination: null }))).toEqual({ main: 'お休み', sub: '振替日は調整中です' })
    expect(describeParentScheduleLesson(lesson({ kind: 'absent' }))).toEqual({ main: 'お休み', sub: '振替日は調整中です' })
  })

  it('振替なし欠席・出席済み', () => {
    expect(describeParentScheduleLesson(lesson({ kind: 'absent-no-makeup' }))).toEqual({ main: 'お休み（振替なし）' })
    expect(describeParentScheduleLesson(lesson({ kind: 'attended' }))).toEqual({ main: '数学', sub: '出席済み' })
  })

  it('科目が空でも空文字を出さない', () => {
    expect(describeParentScheduleLesson(lesson({ subject: '' })).main).toBe('授業')
  })
})

describe('describeParentScheduleDayStatus / isParentScheduleDayTentative', () => {
  it('休講・講習期間・情報なし', () => {
    expect(describeParentScheduleDayStatus(day({ kind: 'closed' }))).toBe('お休み（教室休講）')
    expect(describeParentScheduleDayStatus(day({ kind: 'lecture-period', lectureLabel: '冬期講習' }))).toBe('冬期講習（別途ご案内）')
    expect(describeParentScheduleDayStatus(day({ kind: 'lecture-period' }))).toBe('講習期間（別途ご案内）')
    expect(describeParentScheduleDayStatus(day({ kind: 'none' }))).toBe('予定の情報がありません')
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

describe('validateParentMessageInput (spec §E-1 P-3)', () => {
  it('本文 1〜500 字・送信者名 0〜30 字は通る', () => {
    expect(validateParentMessageInput({ body: 'あ', senderName: '' })).toBeNull()
    expect(validateParentMessageInput({ body: 'あ'.repeat(PARENT_MESSAGE_BODY_LIMIT), senderName: 'あ'.repeat(PARENT_MESSAGE_SENDER_NAME_LIMIT) })).toBeNull()
  })

  it('本文 0 字・空白のみ・制御文字のみは拒否', () => {
    expect(validateParentMessageInput({ body: '', senderName: '' })).toBe('本文を入力してください。')
    expect(validateParentMessageInput({ body: '   ', senderName: '' })).toBe('本文を入力してください。')
    expect(validateParentMessageInput({ body: String.fromCharCode(7) + String.fromCharCode(0), senderName: '' })).toBe('本文を入力してください。')
  })

  it('改行・タブは本文として残る', () => {
    expect(validateParentMessageInput({ body: '\n\tあ', senderName: '' })).toBeNull()
  })

  it('501 字は拒否・制御文字を除いて数える', () => {
    expect(validateParentMessageInput({ body: 'あ'.repeat(PARENT_MESSAGE_BODY_LIMIT + 1), senderName: '' })).toBe('本文は500字以内で入力してください。')
    expect(validateParentMessageInput({ body: 'あ'.repeat(PARENT_MESSAGE_BODY_LIMIT) + String.fromCharCode(7), senderName: '' })).toBeNull()
  })

  it('送信者名 31 字は拒否(前後の空白は数えない)', () => {
    expect(validateParentMessageInput({ body: 'あ', senderName: 'あ'.repeat(31) })).toBe('お名前は30字以内で入力してください。')
    expect(validateParentMessageInput({ body: 'あ', senderName: ` ${'あ'.repeat(30)} ` })).toBeNull()
  })
})

describe('resolveParentPortalLoadError / resolveParentMessageSendError', () => {
  it('サーバーの { error } を優先して表示する', () => {
    expect(resolveParentPortalLoadError(410, { error: 'サーバー文言' })).toBe('サーバー文言')
    expect(resolveParentMessageSendError(429, { error: '本日の上限' })).toBe('本日の上限')
  })

  it('410 は理由を出し分けない共通文言、403 は利用停止、400 は無効リンク', () => {
    expect(resolveParentPortalLoadError(410)).toBe(PARENT_PORTAL_UNAVAILABLE_MESSAGE)
    expect(resolveParentPortalLoadError(404, {})).toBe(PARENT_PORTAL_UNAVAILABLE_MESSAGE)
    expect(resolveParentPortalLoadError(403, { error: '' })).toBe(PARENT_PORTAL_DISABLED_MESSAGE)
    expect(resolveParentPortalLoadError(400)).toBe('このリンクは無効です。教室へお問い合わせください。')
    expect(resolveParentPortalLoadError(500)).toBe('データの読み込みに失敗しました。')
  })

  it('POST: 429 は回数制限文言、400 は入力確認、410/403 は GET と同じ', () => {
    expect(resolveParentMessageSendError(429)).toBe(PARENT_MESSAGE_RATE_LIMIT_MESSAGE)
    expect(resolveParentMessageSendError(400)).toBe('入力内容をご確認ください。')
    expect(resolveParentMessageSendError(410)).toBe(PARENT_PORTAL_UNAVAILABLE_MESSAGE)
    expect(resolveParentMessageSendError(403)).toBe(PARENT_PORTAL_DISABLED_MESSAGE)
    expect(resolveParentMessageSendError(503)).toBe('送信に失敗しました。時間をおいて再度お試しください。')
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

describe('PARENT_PORTAL_NOTES', () => {
  it('注記 3 種(保存時点・変更あり・連絡導線)を常時表示する', () => {
    expect(PARENT_PORTAL_NOTES).toHaveLength(3)
    expect(PARENT_PORTAL_NOTES[0]).toContain('保存された時点')
    expect(PARENT_PORTAL_NOTES[1]).toContain('変更になる')
    expect(PARENT_PORTAL_NOTES[2]).toContain('お電話')
  })
})
