import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from '../components/schedule-board/types'
import {
  OPERATION_TRACE_DIFF_ITEM_LIMIT,
  OPERATION_TRACE_LIMIT,
  OPERATION_TRACE_SUMMARY_LIMIT,
  appendOperationTrace,
  buildOperationTraceEntry,
  clearOperationTraceMemory,
  peekOperationTrace,
  recordOperationTrace,
  resetOperationTrace,
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
    expect(summary).toBe('2026-09-04 3限 机1: 田中: 青木(通常 数) / 空 → 田中: [青木 数] / 空')
    expect(summarizeWeeksDiff(before, before)).toBe('')
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
