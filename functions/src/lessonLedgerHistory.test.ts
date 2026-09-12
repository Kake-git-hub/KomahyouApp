import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { lessonHistoryFixtureRows } from '../../src/utils/lessonHistory.fixture'
// ⚠️ アプリ側の実装（正本の片割れ）。functions 側の複製がズレたらこのテストが落ちる。
import {
  filterLessonHistory as appFilterLessonHistory,
  parseLessonLedgerRows as appParseLessonLedgerRows,
  resolveLessonHistoryRange as appResolveLessonHistoryRange,
} from '../../src/utils/lessonHistory'
// 授業種別ラベルの正本（src/utils/scheduleViewData.ts）。functions 側の複製(LESSON_TYPE_LABELS)が
// ズレたら（キー漏れ・値の文言差）このテストが落ちる。
import { scheduleLessonTypeLabels } from '../../src/utils/scheduleViewData'
import { encodeLessonLedgerBody, LESSON_LEDGER_ENCODING } from './lessonLedger'
import {
  buildLatestLedgerQuery,
  buildStudentLessonHistoryResponse,
  filterLessonHistory,
  handleGetStudentLessonHistory,
  LATEST_LEDGER_CANDIDATE_LIMIT,
  LESSON_TYPE_LABELS,
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
  it('授業種別ラベル表(LESSON_TYPE_LABELS)がキー・値ともに scheduleLessonTypeLabels と一致する', () => {
    expect(LESSON_TYPE_LABELS).toEqual(scheduleLessonTypeLabels)
  })

  it('同じ台帳行から同じイベント配列を作る（extra/trial を含む全種別で検査）', () => {
    expect(parseLessonLedgerRows(lessonHistoryFixtureRows)).toEqual(appParseLessonLedgerRows(lessonHistoryFixtureRows))
    // fixture に含まれる全種別トークンを実際に展開し、両実装のラベルが一致することを直接確認する。
    const lessonTypes = new Set(parseLessonLedgerRows(lessonHistoryFixtureRows).map((event) => event.lessonType).filter(Boolean))
    expect(Array.from(lessonTypes).sort()).toEqual(['extra', 'makeup', 'regular', 'special', 'trial'])
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

// ---------------------------------------------------------------------------
// 確認リスト v1.5.504 h-2「通常授業履歴を取得できませんでした: INTERNAL」の回帰防止(2026-09-12)。
// 真因: 文書 ID(__name__)の降順クエリは複合インデックスが必要で、未作成だと Firestore が
// FAILED_PRECONDITION を返し、firebase-functions は非 HttpsError を汎用「INTERNAL」に潰していた。
// 修正: フィールド dateKey(単一フィールド索引は両方向とも自動)で並べる＋想定外例外は原因文つき HttpsError に包む。
// ---------------------------------------------------------------------------
type RecordedCall = ['where', string, string, string] | ['orderBy', string, string] | ['limit', number]

class FakeLedgerQuery {
  calls: RecordedCall[] = []
  where(field: string, op: '<=', value: string) { this.calls.push(['where', field, op, value]); return this }
  orderBy(field: string, direction: 'desc') { this.calls.push(['orderBy', field, direction]); return this }
  limit(count: number) { this.calls.push(['limit', count]); return this }
}

describe('buildLatestLedgerQuery（INTERNAL 回帰防止・h-2）', () => {
  it('フィールド dateKey で「to 以前」を降順に数件読む（文書 ID __name__ では並べない）', () => {
    const query = buildLatestLedgerQuery(new FakeLedgerQuery(), '2026-12-31')
    expect(query.calls).toEqual([
      ['where', 'dateKey', '<=', '2026-12-31'],
      ['orderBy', 'dateKey', 'desc'],
      ['limit', LATEST_LEDGER_CANDIDATE_LIMIT],
    ])
    expect(query.calls.some((call) => String(call[1]).includes('__name__'))).toBe(false)
  })

  it('候補件数は 1 件ではなく数件（先頭が不正 ID でも捨てて null にしない・従来の挙動を保つ）', () => {
    expect(LATEST_LEDGER_CANDIDATE_LIMIT).toBeGreaterThan(1)
  })
})

describe('index.ts の getStudentLessonHistory（ソース検査・h-2）', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('export const getStudentLessonHistory'), source.indexOf('export const submitDeveloperReport'))

  it('台帳の読み出しは buildLatestLedgerQuery を使い、FieldPath.documentId() の並べ替えへ戻していない', () => {
    expect(body).toContain('buildLatestLedgerQuery(collection, to)')
    expect(body).not.toContain('FieldPath.documentId()')
  })

  it('想定外の例外は toLessonHistoryHttpsError で原因文つきの HttpsError に包む（汎用 INTERNAL に潰さない）', () => {
    expect(body).toContain('throw toLessonHistoryHttpsError(error)')
    expect(body).toContain("if (error instanceof HttpsError) return error")
    expect(body).toContain("new HttpsError('internal', `サーバーで履歴を読めませんでした(")
  })
})
