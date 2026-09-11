import { describe, expect, it, vi } from 'vitest'

import { lessonHistoryFixtureRows } from '../../src/utils/lessonHistory.fixture'
// ⚠️ アプリ側の実装（正本の片割れ）。functions 側の複製がズレたらこのテストが落ちる。
import {
  filterLessonHistory as appFilterLessonHistory,
  parseLessonLedgerRows as appParseLessonLedgerRows,
  resolveLessonHistoryRange as appResolveLessonHistoryRange,
} from '../../src/utils/lessonHistory'
import { encodeLessonLedgerBody, LESSON_LEDGER_ENCODING } from './lessonLedger'
import {
  buildStudentLessonHistoryResponse,
  filterLessonHistory,
  handleGetStudentLessonHistory,
  normalizeStudentLessonHistoryRequest,
  parseLessonLedgerRows,
  readLessonLedgerRows,
  resolveLessonHistoryRange,
  selectLessonLedgerDateKey,
  selectLessonLedgerRowsForStudent,
  type LessonLedgerDayDocLike,
} from './lessonLedgerHistory'

function buildLedgerDoc(overrides: Partial<LessonLedgerDayDocLike> = {}): LessonLedgerDayDocLike {
  return {
    dateKey: '2026-09-12',
    savedAt: '2026-09-12T10:00:00.000Z',
    computedAt: '2026-09-12T10:00:00.000Z',
    updatedBy: 'uid-1',
    dataEncoding: LESSON_LEDGER_ENCODING,
    data: encodeLessonLedgerBody({
      version: 1,
      computedAt: '2026-09-12T10:00:00.000Z',
      rows: lessonHistoryFixtureRows,
      lectureRows: [],
      totals: { makeupBalance: 3, lecturePending: 0, attended: 4, placed: 4 },
    }),
    ...overrides,
  }
}

describe('アプリ側パーサとのパリティ（複製がズレたら落ちる）', () => {
  it('同じ台帳行から同じイベント配列を作る', () => {
    expect(parseLessonLedgerRows(lessonHistoryFixtureRows)).toEqual(appParseLessonLedgerRows(lessonHistoryFixtureRows))
  })

  it('期間フィルタ・期間の丸めも同じ結果', () => {
    const events = parseLessonLedgerRows(lessonHistoryFixtureRows)
    expect(filterLessonHistory(events, { from: '2026-09-01', to: '2026-09-10' }))
      .toEqual(appFilterLessonHistory(appParseLessonLedgerRows(lessonHistoryFixtureRows), { from: '2026-09-01', to: '2026-09-10' }))
    expect(resolveLessonHistoryRange({ from: '2020-01-01', to: '2026-09-12', today: '2026-09-12' }))
      .toEqual(appResolveLessonHistoryRange({ from: '2020-01-01', to: '2026-09-12', today: '2026-09-12' }))
  })
})

describe('selectLessonLedgerDateKey', () => {
  it('指定日以前で最新の台帳を選ぶ（その日に保存が無くても遡る）', () => {
    expect(selectLessonLedgerDateKey(['2026-09-01', '2026-09-05', '2026-09-20'], '2026-09-10')).toBe('2026-09-05')
    expect(selectLessonLedgerDateKey(['2026-09-05'], '2026-09-05')).toBe('2026-09-05')
  })

  it('指定日以前が無ければ null・不正な日付キーは無視する', () => {
    expect(selectLessonLedgerDateKey(['2026-09-20'], '2026-09-10')).toBeNull()
    expect(selectLessonLedgerDateKey(['latest', '2026/09/01'], '2026-09-10')).toBeNull()
  })
})

describe('readLessonLedgerRows', () => {
  it('gzip+base64 の本文を解凍して行を取り出す', () => {
    expect(readLessonLedgerRows(buildLedgerDoc())).toEqual(lessonHistoryFixtureRows)
  })

  it('壊れた本文・未知の符号化でも落ちない', () => {
    expect(readLessonLedgerRows(buildLedgerDoc({ data: 'not-gzip' }))).toEqual([])
    expect(readLessonLedgerRows({ dataEncoding: 'plain', rows: [{ subject: '数' }] })).toEqual([{ subject: '数' }])
    expect(readLessonLedgerRows(null)).toEqual([])
  })
})

describe('selectLessonLedgerRowsForStudent', () => {
  it('名簿 id で対象生徒の全科目を抜き出す（他の生徒は混ぜない）', () => {
    const rows = selectLessonLedgerRowsForStudent(lessonHistoryFixtureRows, 's001')
    expect(rows.map((row) => row.subject)).toEqual(['数', '英'])
  })

  it('未管理生徒は在庫キー（name: 付き）で引ける・manual: 前置は無視して一致させる', () => {
    expect(selectLessonLedgerRowsForStudent(lessonHistoryFixtureRows, 'name:未管理 花子')).toHaveLength(1)
    expect(selectLessonLedgerRowsForStudent(lessonHistoryFixtureRows, 'manual:name:未管理 花子')).toHaveLength(1)
    expect(selectLessonLedgerRowsForStudent(lessonHistoryFixtureRows, 's999')).toEqual([])
  })
})

describe('buildStudentLessonHistoryResponse', () => {
  it('対象生徒・期間内のイベントと集計を返す', () => {
    const response = buildStudentLessonHistoryResponse({
      classroomId: 'c1',
      studentId: 's001',
      range: { from: '2026-09-01', to: '2026-09-15', clamped: false },
      doc: buildLedgerDoc(),
    })
    expect(response.studentName).toBe('青木 太郎')
    expect(response.ledgerDateKey).toBe('2026-09-12')
    expect(response.savedAt).toBe('2026-09-12T10:00:00.000Z')
    expect(response.subjects).toEqual(['英', '数'])
    expect(response.makeupBalanceBySubject).toEqual([{ subject: '数', balance: 1 }])
    // 期間外（2026-09-22 / 2026-09-29 / 2026-10-01）は落ちる。他生徒の 8 月分も入らない。
    expect(response.events.map((event) => `${event.date}:${event.status}`)).toEqual([
      '2026-09-01:attended',
      '2026-09-02:absent',
      '2026-09-03:makeupRemaining',
      '2026-09-05:attended',
      '2026-09-05:placed',
      '2026-09-08:attended',
      '2026-09-10:placed',
      '2026-09-15:absent',
    ])
    expect(response.summary).toEqual({ attended: 3, absent: 2, absentNoMakeup: 0, placed: 2, makeupRemaining: 1, total: 8 })
  })

  it('台帳がまだ無い教室でも空の結果を返す（エラーにしない）', () => {
    const response = buildStudentLessonHistoryResponse({
      classroomId: 'c1', studentId: 's001', range: { from: '2026-09-01', to: '2026-09-15', clamped: false }, doc: null,
    })
    expect(response).toMatchObject({ events: [], ledgerDateKey: null, savedAt: null, studentName: '', subjects: [] })
  })
})

describe('normalizeStudentLessonHistoryRequest', () => {
  it('必須項目が欠けていれば理由つきで拒否する', () => {
    expect(normalizeStudentLessonHistoryRequest(null)).toEqual({ ok: false, reason: 'request.data の形式が不正です。' })
    expect(normalizeStudentLessonHistoryRequest({ classroomId: 'c1', studentId: 's1' })).toMatchObject({ ok: false })
    expect(normalizeStudentLessonHistoryRequest({ workspaceKey: 'main', studentId: 's1' })).toMatchObject({ ok: false })
    expect(normalizeStudentLessonHistoryRequest({ workspaceKey: 'main', classroomId: 'c1', studentId: '  ' })).toMatchObject({ ok: false })
  })

  it('不正な日付は未指定扱い（既定期間へ倒す）', () => {
    expect(normalizeStudentLessonHistoryRequest({ workspaceKey: 'main', classroomId: 'c1', studentId: 's1', from: '2026/09/01', to: 42 })).toEqual({
      ok: true, value: { workspaceKey: 'main', classroomId: 'c1', studentId: 's1', from: '', to: '' },
    })
  })
})

describe('handleGetStudentLessonHistory', () => {
  const baseDeps = () => ({
    requireAccess: vi.fn(async () => ({})),
    loadLatestLedgerDoc: vi.fn(async () => buildLedgerDoc()),
    invalidArgument: (message: string) => new Error(message),
    todayJst: '2026-09-12',
  })

  it('教室メンバー権限を確認してから台帳を読む', async () => {
    const deps = baseDeps()
    await handleGetStudentLessonHistory({ workspaceKey: 'main', classroomId: 'c1', studentId: 's001', from: '2026-09-01', to: '2026-09-15' }, deps)
    expect(deps.requireAccess).toHaveBeenCalledWith('main', 'c1')
    expect(deps.loadLatestLedgerDoc).toHaveBeenCalledWith({ workspaceKey: 'main', classroomId: 'c1', to: '2026-09-15' })
  })

  it('権限エラーはそのまま伝播し、台帳を読まない', async () => {
    const deps = { ...baseDeps(), requireAccess: vi.fn(async () => { throw new Error('permission-denied') }) }
    await expect(handleGetStudentLessonHistory({ workspaceKey: 'main', classroomId: 'c1', studentId: 's001' }, deps)).rejects.toThrow('permission-denied')
    expect(deps.loadLatestLedgerDoc).not.toHaveBeenCalled()
  })

  it('入力不正は権限確認の前に弾く', async () => {
    const deps = baseDeps()
    await expect(handleGetStudentLessonHistory({ workspaceKey: 'main', classroomId: 'c1' }, deps)).rejects.toThrow('studentId は文字列で指定してください。')
    expect(deps.requireAccess).not.toHaveBeenCalled()
  })

  it('366 日を超える期間は開始日を丸める（clamped=true）', async () => {
    const deps = baseDeps()
    const response = await handleGetStudentLessonHistory({ workspaceKey: 'main', classroomId: 'c1', studentId: 's001', from: '2020-01-01', to: '2026-09-12' }, deps)
    expect(response).toMatchObject({ from: '2025-09-12', to: '2026-09-12', clamped: true })
  })

  it('期間未指定なら JST の今日を終了日に直近 1 年', async () => {
    const deps = baseDeps()
    const response = await handleGetStudentLessonHistory({ workspaceKey: 'main', classroomId: 'c1', studentId: 's001' }, deps)
    expect(response).toMatchObject({ from: '2025-09-12', to: '2026-09-12', clamped: false })
  })
})
