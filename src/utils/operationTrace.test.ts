import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from '../components/schedule-board/types'
import {
  OPERATION_TRACE_DIFF_ITEM_LIMIT,
  OPERATION_TRACE_LIMIT,
  OPERATION_TRACE_SAVE_LIMIT,
  OPERATION_TRACE_SUMMARY_LIMIT,
  appendOperationTrace,
  buildOperationTraceEntry,
  clearOperationTraceMemory,
  collectOperationTraceSinceLastSave,
  markOperationTraceSaved,
  peekOperationTrace,
  recordOperationTrace,
  resetOperationTrace,
  selectOperationTraceSinceMarker,
  setOperationTraceClassroomId,
  summarizeBoardCommitForTrace,
  summarizeWeeksDiff,
} from './operationTrace'
import { clearOperationEvents, recordOperationEvent, setOperationLogClassroomId } from './operationLog'

function student(name: string, overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: `s-${name}`,
    name,
    grade: '中1',
    subject: '数',
    lessonType: '通常',
    teacherType: '通常',
    ...overrides,
  } as StudentEntry
}

function desk(teacher: string, slots: [StudentEntry | null, StudentEntry | null], overrides: Partial<DeskCell> = {}): DeskCell {
  return { id: `d-${teacher}`, teacher, lesson: { id: 'l', studentSlots: slots }, ...overrides }
}

function cell(dateKey: string, slotNumber: number, desks: DeskCell[]): SlotCell {
  return { id: `${dateKey}-${slotNumber}`, dateKey, dayLabel: '月', dateLabel: dateKey, slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

// localStorage の簡易スタブ(jsdom 無しの node 環境で永続化経路も検証する)。
function installStorage() {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  vi.stubGlobal('window', { localStorage: storage })
  return store
}

describe('operationTrace: リングバッファと要約', () => {
  it('上限を超えたら古いものから捨てる', () => {
    let buffer = [] as ReturnType<typeof buildOperationTraceEntry>[]
    for (let index = 0; index < OPERATION_TRACE_LIMIT + 5; index += 1) {
      buffer = appendOperationTrace(buffer, buildOperationTraceEntry('board-commit', `op-${index}`))
    }
    expect(buffer).toHaveLength(OPERATION_TRACE_LIMIT)
    expect(buffer[0]?.summary).toBe('op-5')
    expect(buffer[buffer.length - 1]?.summary).toBe(`op-${OPERATION_TRACE_LIMIT + 4}`)
  })

  it('要約は空白を畳み、上限長で切る', () => {
    const entry = buildOperationTraceEntry('save', `  a\n\n b   ${'x'.repeat(1000)}`, new Date('2026-09-04T01:02:03.000Z'))
    expect(entry.at).toBe('2026-09-04T01:02:03.000Z')
    expect(entry.summary.startsWith('a b x')).toBe(true)
    expect(entry.summary.length).toBe(OPERATION_TRACE_SUMMARY_LIMIT)
    expect(entry.summary.endsWith('…')).toBe(true)
  })

  it('summarizeWeeksDiff は変わった机だけを「日付 限 机番: 前 → 後」で列挙する', () => {
    const before = [[cell('2026-09-04', 3, [desk('田中', [student('青木'), null]), desk('鈴木', [null, null])])]]
    const after = [[cell('2026-09-04', 3, [desk('田中', [null, null], { statusSlots: [{ id: 'st', studentId: 's-青木', sourceManagedLesson: false, name: '青木', grade: '中1', subject: '数', lessonType: '通常', teacherType: '通常', teacherName: '田中', dateKey: '2026-09-04', slotNumber: 3 } as unknown as StudentStatusEntry, null] }), desk('鈴木', [null, null])])]]
    const summary = summarizeWeeksDiff(before, after)
    // 生徒名に加えて生徒ID(#managedStudentId・無ければ盤面id)を添える(2026-09-04: 誰の何がバグかを取り違えない)。
    expect(summary).toBe('2026-09-04 3限 机1: 田中: 青木#s-青木(通常 数) / 空 → 田中: [青木#s-青木 数] / 空')
    expect(summarizeWeeksDiff(before, before)).toBe('')
  })

  it('名簿の生徒ID(managedStudentId)があればそれを優先して添える', () => {
    const before = [[cell('2026-09-04', 3, [desk('田中', [null, null])])]]
    const after = [[cell('2026-09-04', 3, [desk('田中', [student('青木', { managedStudentId: 's012' }), null])])]]
    expect(summarizeWeeksDiff(before, after)).toBe('2026-09-04 3限 机1: 田中: 空 / 空 → 田中: 青木#s012(通常 数) / 空')
  })

  it('summarizeWeeksDiff は列挙上限を超えた分を「他N件」にまとめ、机の追加/削除も拾う', () => {
    const manyDesks = Array.from({ length: OPERATION_TRACE_DIFF_ITEM_LIMIT + 3 }, (_, index) => desk(`T${index}`, [null, null]))
    const before = [[cell('2026-09-05', 1, manyDesks)]]
    const after = [[cell('2026-09-05', 1, manyDesks.map((_, index) => desk(`T${index}`, [student(`生徒${index}`), null])))]]
    const summary = summarizeWeeksDiff(before, after)
    expect(summary).toContain(`他${3}件`)
    expect(summary.split(' | ')).toHaveLength(OPERATION_TRACE_DIFF_ITEM_LIMIT + 1)

    const removed = summarizeWeeksDiff([[cell('2026-09-05', 1, [desk('A', [null, null])])]], [[cell('2026-09-05', 1, [])]])
    expect(removed).toBe('2026-09-05 1限 机1: A: 空 / 空 → (机なし)')
  })

  it('summarizeBoardCommitForTrace は机の変化が無くても付随変更(休日/在庫/補正)を名前で残す', () => {
    const weeks = [[cell('2026-09-04', 1, [desk('田中', [null, null])])]]
    expect(summarizeBoardCommitForTrace({ previousWeeks: weeks, nextWeeks: weeks, holidayChanged: true, suppressedMakeupChanged: true })).toBe('机の変化なし / 付随変更: 休日設定・未消化振替(抑制)')
    expect(summarizeBoardCommitForTrace({ previousWeeks: weeks, nextWeeks: weeks })).toBe('机の変化なし')
  })
})

describe('operationTrace: 教室ごとの記録と localStorage 永続化', () => {
  beforeEach(() => {
    clearOperationTraceMemory()
    clearOperationEvents()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('教室未登録なら記録しない(別教室への混入防止)', () => {
    installStorage()
    expect(recordOperationTrace('board-commit', 'x')).toBeNull()
    expect(peekOperationTrace('c1')).toEqual([])
  })

  it('記録は教室ごとに分かれ、localStorage にも書かれ、メモリを捨てても読み戻せる', () => {
    const store = installStorage()
    setOperationTraceClassroomId('c1')
    recordOperationTrace('board-commit', '操作A')
    setOperationTraceClassroomId('c2')
    recordOperationTrace('undo', '操作B')
    expect(peekOperationTrace('c1').map((e) => e.summary)).toEqual(['操作A'])
    expect(peekOperationTrace('c2').map((e) => e.summary)).toEqual(['操作B'])
    expect(store.has('operation-trace:c1')).toBe(true)

    // 再読み込み相当: メモリを捨てても localStorage から復元される。
    clearOperationTraceMemory()
    expect(peekOperationTrace('c1').map((e) => e.summary)).toEqual(['操作A'])
    // peek はバッファを消さない(報告後も痕跡は残る)。
    expect(peekOperationTrace('c1')).toHaveLength(1)

    resetOperationTrace('c1')
    expect(peekOperationTrace('c1')).toEqual([])
    expect(store.has('operation-trace:c1')).toBe(false)
  })

  it('localStorage が壊れていても落ちず、無いときも記録できる(メモリのみ)', () => {
    const store = installStorage()
    store.set('operation-trace:c3', '{not json')
    setOperationTraceClassroomId('c3')
    expect(recordOperationTrace('save', 'ok')).not.toBeNull()
    expect(peekOperationTrace('c3').map((e) => e.summary)).toEqual(['ok'])

    vi.unstubAllGlobals()
    clearOperationTraceMemory()
    setOperationTraceClassroomId('c4')
    expect(recordOperationTrace('save', 'no-window')).not.toBeNull()
    expect(peekOperationTrace('c4')).toHaveLength(1)
  })

  it('操作ログ(operationLog)の記録は痕跡にも写る(1本の時系列で読める)', () => {
    installStorage()
    setOperationLogClassroomId('c5')
    setOperationTraceClassroomId('c5')
    recordOperationEvent('lesson-delete', { studentName: '青木 太郎', subject: '数' })
    const trace = peekOperationTrace('c5')
    expect(trace).toHaveLength(1)
    expect(trace[0]?.kind).toBe('operation-event')
    expect(trace[0]?.summary).toBe('lesson-delete studentName=青木 太郎 subject=数')
  })
})

describe('operationTrace: 要約は本体の操作を止めない', () => {
  it('壊れた盤面データでも例外を出さず、失敗を示す文字列を返す', () => {
    const broken = [[{ dateKey: '2026-09-04', slotNumber: 1, desks: null }]] as unknown as SlotCell[][]
    expect(summarizeWeeksDiff(broken, broken)).toBe('(差分要約に失敗)')
    expect(summarizeBoardCommitForTrace({ previousWeeks: broken, nextWeeks: broken, holidayChanged: true })).toBe('(差分要約に失敗) / 付随変更: 休日設定')
  })
})

describe('operationTrace: 保存への相乗り(2026-10-22 案 2・前回保存以降の切り出しと印)', () => {
  beforeEach(() => {
    clearOperationTraceMemory()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('端末内の保持は 1000 件・保存に載せるのは最大 300 件(報告と同じ)', () => {
    expect(OPERATION_TRACE_LIMIT).toBe(1000)
    expect(OPERATION_TRACE_SAVE_LIMIT).toBe(300)
  })

  it('selectOperationTraceSinceMarker: 印より新しい痕跡だけを古い順に返し、上限を超えたら新しい方を残す', () => {
    const entries = ['01', '02', '03', '04'].map((m) => ({ at: `2026-10-22T06:${m}:00.000Z`, kind: 'board-commit' as const, summary: m }))
    expect(selectOperationTraceSinceMarker(entries, '2026-10-22T06:02:00.000Z').map((e) => e.summary)).toEqual(['03', '04'])
    // 印が無ければ全部(初回)。上限は新しい方から。
    expect(selectOperationTraceSinceMarker(entries, '').map((e) => e.summary)).toEqual(['01', '02', '03', '04'])
    expect(selectOperationTraceSinceMarker(entries, '', 2).map((e) => e.summary)).toEqual(['03', '04'])
    // 印と同じ時刻の痕跡は「載せた」扱い(> で比較)。
    expect(selectOperationTraceSinceMarker(entries, '2026-10-22T06:04:00.000Z')).toEqual([])
  })

  it('collect → markOperationTraceSaved で印が進み、次の collect は新しい分だけ。印は localStorage にも残る', () => {
    const store = installStorage()
    setOperationTraceClassroomId('c1')
    recordOperationTrace('board-commit', '操作A')
    recordOperationTrace('undo', '操作B')
    const first = collectOperationTraceSinceLastSave('c1')
    expect(first.map((e) => e.summary)).toEqual(['操作A', '操作B'])
    // collect はバッファを消さない(報告の recentOperations は引き続き全件)。
    expect(peekOperationTrace('c1')).toHaveLength(2)

    markOperationTraceSaved('c1', first)
    expect(store.get('operation-trace-saved:c1')).toBe(first[1].at)
    expect(collectOperationTraceSinceLastSave('c1')).toEqual([])

    // 次の操作は印より後の時刻になるように少し待ってから記録する。
    const later = new Date(Date.parse(first[1].at) + 5).toISOString()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(later))
    recordOperationTrace('save', '操作C')
    vi.useRealTimers()
    expect(collectOperationTraceSinceLastSave('c1').map((e) => e.summary)).toEqual(['操作C'])

    // 再読み込み相当: メモリを捨てても印は localStorage から戻る。
    clearOperationTraceMemory()
    expect(collectOperationTraceSinceLastSave('c1').map((e) => e.summary)).toEqual(['操作C'])
  })

  it('保存に失敗したら印を進めない(次の保存に同じ分がもう一度乗る)・空の送信では印を触らない・教室未指定は空', () => {
    installStorage()
    setOperationTraceClassroomId('c2')
    recordOperationTrace('board-commit', 'X')
    const sent = collectOperationTraceSinceLastSave('c2')
    expect(sent).toHaveLength(1)
    // 失敗 = markOperationTraceSaved を呼ばない → もう一度同じ分が返る。
    expect(collectOperationTraceSinceLastSave('c2')).toEqual(sent)
    markOperationTraceSaved('c2', [])
    expect(collectOperationTraceSinceLastSave('c2')).toEqual(sent)
    expect(collectOperationTraceSinceLastSave('')).toEqual([])
    markOperationTraceSaved('c2', sent)
    // 古い印で上書きしない。
    markOperationTraceSaved('c2', [{ at: '2000-01-01T00:00:00.000Z', kind: 'save', summary: 'old' }])
    expect(collectOperationTraceSinceLastSave('c2')).toEqual([])
  })

  it('localStorage が無くても動く(メモリの印だけ)', () => {
    vi.unstubAllGlobals()
    setOperationTraceClassroomId('c3')
    recordOperationTrace('auto', 'Y')
    const sent = collectOperationTraceSinceLastSave('c3')
    markOperationTraceSaved('c3', sent)
    expect(collectOperationTraceSinceLastSave('c3')).toEqual([])
  })
})
