import { describe, expect, it } from 'vitest'
import type { BoardShareStatusEntry, BoardShareStudentEntry } from '../../integrations/firebase/boardShare'
import { formatStudentLabel, getStudentStatusLabel, getVisibleDateLabel, resolveBoardShareSeatView } from './BoardShareScreen'

// 配布用盤面(講師日程共有)の席 1 つ分の表示規則。盤面(BoardGrid renderStudentCell)と同じく
// 「配置された生徒がいる席では、同じ index に残った出欠記録を表示に使わない」ことを固定する。
//
// 緑が丘 室長報告(2026-09-28): 9/28(月) 4限 体)小5算 の体験生が配布用盤面で「休み」表示になった。
// 実データ = 同じ席の statusSlots[0] に**別の生徒**(中2 数・通常)の absent 記録が残ったまま、
// studentSlots[0] に体験生を追加していた。盤面は生徒を普通に出すのに、配布用盤面だけ体験生に「(休」が付いた(INV-04 準拠の内容乖離)。
function createStudent(overrides: Partial<BoardShareStudentEntry> = {}): BoardShareStudentEntry {
  return {
    id: '2026-09-28_4_1_0_trial',
    name: '体験 花子',
    managedStudentId: undefined,
    grade: '小5',
    noteSuffix: '',
    makeupSourceDate: undefined,
    makeupSourceLabel: undefined,
    subject: '算',
    lessonType: 'trial',
    teacherType: 'normal',
    ...overrides,
  }
}

function createAbsentStatus(overrides: Partial<BoardShareStatusEntry> = {}): BoardShareStatusEntry {
  return {
    id: 's026_2026-09-28_数_absent',
    name: '欠席 太郎',
    managedStudentId: 's026',
    grade: '中2',
    noteSuffix: '',
    makeupSourceDate: undefined,
    makeupSourceLabel: undefined,
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    moveDestinationDateKey: undefined,
    status: 'absent',
    linkedDestinationDateKey: '2026-10-05',
    ...overrides,
  }
}

// 画面(BoardShareScreen の studentSlots.map)と同じ組み立てで、席 1 つ分の見え方をまとめて出す。
function renderSeat(student: BoardShareStudentEntry | null, status: BoardShareStatusEntry | null, cell = { dateKey: '2026-09-28' }) {
  const { visibleStudent, visibleStatus } = resolveBoardShareSeatView(student, status)
  const label = `${formatStudentLabel(visibleStudent)}${visibleStatus ? `(${getStudentStatusLabel(visibleStatus.status)}` : ''}`
  const dateLabel = getVisibleDateLabel(visibleStudent, visibleStatus, cell, visibleStatus?.linkedDestinationDateKey)
  return { label, dateLabel, isStatusStyle: Boolean(visibleStatus) }
}

describe('配布用盤面 resolveBoardShareSeatView: 生徒がいる席では同じ index の出欠記録を使わない', () => {
  // 修正なしでは label が「体) 体験 花子 / 小5 / 算(休」・dateLabel が 10/5・灰色スタイルになって落ちる回帰防止テスト。
  it('別の生徒の休み記録が残る席に体験生を置いても、体験生に「(休」を付けない(緑が丘 9/28 4限)', () => {
    const seat = renderSeat(createStudent(), createAbsentStatus())
    expect(seat.label).toBe('体) 体験 花子 / 小5 / 算')
    expect(seat.label).not.toContain('(休')
    expect(seat.label).not.toContain('欠席 太郎')
    expect(seat.dateLabel).toBe('')
    expect(seat.isStatusStyle).toBe(false)
  })

  it('同じ生徒でも、配置があるあいだは記録を出さない(盤面と同じ。振替コマは自分の振替元日だけ出す)', () => {
    const makeupStudent = createStudent({ id: 's026_2026-09-28_数_makeup', name: '欠席 太郎', managedStudentId: 's026', grade: '中2', subject: '数', lessonType: 'makeup', makeupSourceDate: '2026-09-21' })
    const seat = renderSeat(makeupStudent, createAbsentStatus())
    expect(seat.label).toBe('振) 欠席 太郎 / 中2 / 数')
    expect(seat.dateLabel).toBe('9/21')
    expect(seat.isStatusStyle).toBe(false)
  })

  it('生徒がいない席では従来どおり記録を「(休」＋振替先日付で出す(既存挙動の維持)', () => {
    const seat = renderSeat(null, createAbsentStatus())
    expect(seat.label).toBe('通) 欠席 太郎 / 中2 / 数(休')
    expect(seat.dateLabel).toBe('10/5')
    expect(seat.isStatusStyle).toBe(true)
  })

  it('記録が無い席は生徒だけ、どちらも無い席は空', () => {
    expect(renderSeat(createStudent(), null)).toEqual({ label: '体) 体験 花子 / 小5 / 算', dateLabel: '', isStatusStyle: false })
    expect(renderSeat(null, null)).toEqual({ label: '', dateLabel: '', isStatusStyle: false })
  })

  it('全ての記録種別(absent / absent-no-makeup / attended / moved / holiday)で、生徒がいる席には付けない', () => {
    for (const status of ['absent', 'absent-no-makeup', 'attended', 'moved', 'holiday'] as const) {
      const seat = renderSeat(createStudent(), createAbsentStatus({ status, moveDestinationDateKey: '2026-10-01' }))
      expect(seat.label, status).toBe('体) 体験 花子 / 小5 / 算')
      expect(seat.dateLabel, status).toBe('')
      expect(seat.isStatusStyle, status).toBe(false)
    }
  })

  it('visibleStudent は生徒 → 記録 の順(名前は従来どおり生徒優先)、visibleStatus は生徒がいなければ記録', () => {
    const student = createStudent()
    const status = createAbsentStatus()
    expect(resolveBoardShareSeatView(student, status)).toEqual({ visibleStudent: student, visibleStatus: null })
    expect(resolveBoardShareSeatView(null, status)).toEqual({ visibleStudent: status, visibleStatus: status })
    expect(resolveBoardShareSeatView(undefined, undefined)).toEqual({ visibleStudent: null, visibleStatus: null })
  })
})

// 画面の組み立てが純関数を経由し続けることをソースで固定する(結果だけ直して配線が戻る回帰を防ぐ)。
describe('配布用盤面の配線: 席の表示は resolveBoardShareSeatView を通す', () => {
  it('BoardShareScreen は status を直接ラベル・日付・スタイルに使わない', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./BoardShareScreen.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(source).toContain('resolveBoardShareSeatView(student, status)')
    expect(source).not.toContain('const visibleStudent = student ?? status')
    expect(source).not.toContain("${status ? ' board-share-status' : ''}")
    expect(source).toContain("${visibleStatus ? ' board-share-status' : ''}")
    expect(source).toContain('getStudentStatusLabel(visibleStatus.status')
  })
})
