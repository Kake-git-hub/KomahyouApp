// 講習履歴(H-3)のメッセージ往復と応答整形の回帰防止。
// 経路: 日程表タブ → `schedule-lesson-history-request` → 本体が callable → `schedule-lesson-history-result`。
// ここが壊れると別タブは 20 秒沈黙してから「本体から応答がありません」になる（原因が見えない）。
import { describe, expect, it } from 'vitest'
import {
  LESSON_HISTORY_CLASSROOM_MISMATCH_ERROR,
  SCHEDULE_LESSON_HISTORY_REQUEST_MESSAGE_TYPE,
  SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE,
  buildScheduleLessonHistoryResultMessage,
  formatLessonHistoryErrorMessage,
  isLessonHistoryClassroomMismatch,
  normalizeStudentLessonHistoryResponse,
  parseScheduleLessonHistoryRequestMessage,
  resolveLessonHistoryStudentId,
} from './lessonHistoryMessage'

describe('parseScheduleLessonHistoryRequestMessage', () => {
  it('type が違うメッセージは無視する（他機能の postMessage を食わない）', () => {
    expect(parseScheduleLessonHistoryRequestMessage(null)).toBeNull()
    expect(parseScheduleLessonHistoryRequestMessage('x')).toBeNull()
    expect(parseScheduleLessonHistoryRequestMessage({ type: 'schedule-developer-report' })).toBeNull()
    expect(parseScheduleLessonHistoryRequestMessage({ type: 'schedule-range-update', personId: 'stu-1' })).toBeNull()
  })

  it('requestId / personId / 期間 / classroomId を取り出す', () => {
    expect(parseScheduleLessonHistoryRequestMessage({
      type: SCHEDULE_LESSON_HISTORY_REQUEST_MESSAGE_TYPE,
      requestId: 'lh-1',
      personId: ' stu-1 ',
      from: '2026-01-01',
      to: '2026-09-12',
      classroomId: 'c1',
    })).toEqual({ requestId: 'lh-1', studentId: 'stu-1', from: '2026-01-01', to: '2026-09-12', classroomId: 'c1' })
  })

  it('日付が `YYYY-MM-DD` でなければ未指定（空文字）にしてサーバー既定へ倒す・classroomId 欠落は空文字', () => {
    const parsed = parseScheduleLessonHistoryRequestMessage({
      type: SCHEDULE_LESSON_HISTORY_REQUEST_MESSAGE_TYPE,
      personId: 'stu-1',
      from: '2026/01/01',
      to: 42,
    })
    expect(parsed).toEqual({ requestId: '', studentId: 'stu-1', from: '', to: '', classroomId: '' })
  })

  it('personId は名簿 id をそのまま渡す（在庫キー `name:`/`manual:` 形もサーバー側が引けるので素通し）', () => {
    expect(resolveLessonHistoryStudentId('stu-1')).toBe('stu-1')
    expect(resolveLessonHistoryStudentId('name:山田太郎')).toBe('name:山田太郎')
    expect(resolveLessonHistoryStudentId(undefined)).toBe('')
  })
})

describe('isLessonHistoryClassroomMismatch', () => {
  it('要求時点の教室と現在の教室が一致すれば false', () => {
    expect(isLessonHistoryClassroomMismatch('c1', 'c1')).toBe(false)
  })

  it('教室が切り替わっていれば true（教室分離・INV-08）', () => {
    expect(isLessonHistoryClassroomMismatch('c1', 'c2')).toBe(true)
  })

  it('どちらかが空（未特定）ならフェイルクローズで true', () => {
    expect(isLessonHistoryClassroomMismatch('', 'c1')).toBe(true)
    expect(isLessonHistoryClassroomMismatch('c1', '')).toBe(true)
  })

  it('エラー文は利用者に「開き直して」と促す', () => {
    expect(LESSON_HISTORY_CLASSROOM_MISMATCH_ERROR).toContain('開き直して')
  })
})

describe('normalizeStudentLessonHistoryResponse: 状態欄のまとめ(確認リスト その他 2026-09-14)', () => {
  it('サーバーの statusText・振替元・振替先・未消化を落とさず別タブへ渡す(落とすと状態欄が素のラベルに戻る)', () => {
    const history = normalizeStudentLessonHistoryResponse({
      events: [{
        date: '2026-09-02', slot: 2, status: 'absent', subject: '数', lessonType: 'regular', token: 't',
        makeupDestination: { date: '2026-09-09', slot: 1 }, makeupOrigin: { date: 'bad', slot: 1 }, makeupPending: true,
        statusText: '休み（振替先 9/9 1限）',
      }],
    })
    expect(history.events[0]).toMatchObject({
      statusText: '休み（振替先 9/9 1限）',
      makeupDestination: { date: '2026-09-09', slot: 1 },
      makeupOrigin: null,
      makeupPending: true,
    })
    // 旧サーバー(フィールド無し)でも壊れない。
    expect(normalizeStudentLessonHistoryResponse({ events: [{ date: '2026-09-02', status: 'absent' }] }).events[0]).toMatchObject({
      statusText: '', makeupOrigin: null, makeupDestination: null, makeupPending: false,
    })
  })
})

describe('buildScheduleLessonHistoryResultMessage', () => {
  const history = normalizeStudentLessonHistoryResponse({ classroomId: 'c1', studentId: 'stu-1', events: [] })

  it('成功は ok:true と history を requestId 付きで返す', () => {
    expect(buildScheduleLessonHistoryResultMessage({ requestId: 'lh-1', result: { ok: true, history } })).toEqual({
      type: SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE,
      requestId: 'lh-1',
      ok: true,
      history,
    })
  })

  it('失敗は ok:false と利用者向けの文を返す', () => {
    expect(buildScheduleLessonHistoryResultMessage({ requestId: 'lh-2', result: { ok: false, error: '教室が特定できませんでした。' } })).toEqual({
      type: SCHEDULE_LESSON_HISTORY_RESULT_MESSAGE_TYPE,
      requestId: 'lh-2',
      ok: false,
      message: '教室が特定できませんでした。',
    })
  })

  it('formatLessonHistoryErrorMessage は Error でも文字列でも 1 文にする', () => {
    expect(formatLessonHistoryErrorMessage(new Error('permission-denied'))).toContain('permission-denied')
    expect(formatLessonHistoryErrorMessage('')).toBe('通常授業履歴を取得できませんでした。時間をおいて、もう一度お試しください。')
  })
})

describe('normalizeStudentLessonHistoryResponse', () => {
  it('callable の応答をそのまま表示に使える形へ整える', () => {
    const response = normalizeStudentLessonHistoryResponse({
      classroomId: 'c1',
      studentId: 'stu-1',
      studentName: '山田 太郎',
      from: '2026-01-01',
      to: '2026-09-12',
      clamped: true,
      ledgerDateKey: '2026-09-11',
      savedAt: '2026-09-11T12:00:00.000Z',
      computedAt: '2026-09-11T12:00:01.000Z',
      events: [{
        date: '2026-09-01',
        slot: 3,
        status: 'attended',
        statusLabel: '出席',
        lessonType: 'regular',
        lessonTypeLabel: '通常',
        subject: '英',
        studentId: 'stu-1',
        studentKey: 'stu-1',
        name: '山田 太郎',
        makeupSourceDate: null,
        reasonLabel: null,
        token: '2026-09-01#3|regular',
      }],
      summary: { attended: 1, absent: 0, absentNoMakeup: 0, placed: 0, makeupRemaining: 0, total: 1 },
      subjects: ['英'],
      makeupBalanceBySubject: [{ subject: '数', balance: 2 }],
    })
    expect(response.studentName).toBe('山田 太郎')
    expect(response.clamped).toBe(true)
    expect(response.ledgerDateKey).toBe('2026-09-11')
    expect(response.events).toHaveLength(1)
    expect(response.summary.total).toBe(1)
    expect(response.makeupBalanceBySubject).toEqual([{ subject: '数', balance: 2 }])
  })

  it('壊れた要素は落とし、ラベル欠落はクライアント側の正本で補う', () => {
    const response = normalizeStudentLessonHistoryResponse({
      events: [
        null,
        { status: 'unknown-status', date: '2026-09-01' },
        { status: 'makeupRemaining', date: '2026-09-02', slot: null, lessonType: '', reasonLabel: '休講' },
        { status: 'placed', date: '2026-09-03', slot: 1, lessonType: 'makeup', makeupSourceDate: '2026-08-20' },
      ],
    })
    expect(response.events.map((event) => event.status)).toEqual(['makeupRemaining', 'placed'])
    expect(response.events[0].statusLabel).toBe('未消化')
    expect(response.events[0].reasonLabel).toBe('休講')
    expect(response.events[1].lessonTypeLabel).toBe('振替')
    expect(response.events[1].makeupSourceDate).toBe('2026-08-20')
  })

  it('summary が欠けていたらイベントから数え直す（表示が空にならない保険）', () => {
    const response = normalizeStudentLessonHistoryResponse({
      events: [
        { status: 'attended', date: '2026-09-01', slot: 1 },
        { status: 'attended', date: '2026-09-02', slot: 1 },
        { status: 'absent', date: '2026-09-03', slot: 2 },
      ],
    })
    expect(response.summary).toEqual({ attended: 2, absent: 1, absentNoMakeup: 0, placed: 0, makeupRemaining: 0, total: 3 })
  })

  it('応答が空/不正でも例外にせず空の履歴を返す', () => {
    const response = normalizeStudentLessonHistoryResponse(undefined)
    expect(response.events).toEqual([])
    expect(response.summary.total).toBe(0)
    expect(response.subjects).toEqual([])
    expect(response.makeupBalanceBySubject).toEqual([])
  })
})
