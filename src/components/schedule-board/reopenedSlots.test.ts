// 「後から出席可能に変更」(黄色コマ・2026-07-18 塚田先生要望) の盤面側純関数の回帰防止。
// - 不可コマへの配置/移動/入替の着地検出(確認ダイアログ対象の列挙)
// - 実効不可(unavailableSlots − reopenedSlots)を講師○×記号が尊重すること
// 生徒・講師とも「変換済みコマは再確認しない/警告しない」= 実効集合で判定するのが要。
import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../basic-data/basicDataModel'
import {
  buildReopenConfirmMessage,
  collectReopenTargetsForPlacements,
  collectStudentMoveLandingPlacements,
  resolveTeacherLectureSlotMark,
} from './ScheduleBoardScreen'
import type { DeskCell, SlotCell, StudentEntry } from './types'

const buildStudent = (overrides: Partial<StudentEntry> = {}): StudentEntry => ({
  id: 'entry-1',
  name: '山田 太郎',
  managedStudentId: 'stu-1',
  grade: '中3',
  subject: '数',
  lessonType: 'special',
  teacherType: 'normal',
  ...overrides,
})

const buildDesk = (overrides: Partial<DeskCell> = {}): DeskCell => ({
  id: 'desk-1',
  teacher: '講師A',
  ...overrides,
})

const buildCell = (overrides: Partial<SlotCell> = {}): SlotCell => ({
  id: 'cell-1',
  dateKey: '2026-07-25',
  dayLabel: '土',
  dateLabel: '7/25',
  slotLabel: '3限',
  slotNumber: 3,
  timeLabel: '14:50-16:20',
  isOpenDay: true,
  desks: [buildDesk()],
  ...overrides,
})

describe('collectReopenTargetsForPlacements', () => {
  const effectiveUnavailable = new Map<string, Set<string>>([
    ['stu-1', new Set(['2026-07-25_3'])],
  ])

  it('実効不可コマへの着地だけを変換対象として返す', () => {
    const targets = collectReopenTargetsForPlacements({
      placements: [
        { managedStudentId: 'stu-1', displayName: '山田', dateKey: '2026-07-25', slotNumber: 3 },
        { managedStudentId: 'stu-1', displayName: '山田', dateKey: '2026-07-26', slotNumber: 2 }, // 実効不可でない
        { managedStudentId: null, displayName: '未連携', dateKey: '2026-07-25', slotNumber: 3 }, // 名簿未連携=提出なし
      ],
      studentUnavailableSlotsById: effectiveUnavailable,
    })
    expect(targets).toEqual([
      expect.objectContaining({ personType: 'student', personId: 'stu-1', slotKey: '2026-07-25_3', displayName: '山田' }),
    ])
  })

  it('同一生徒×同一コマは重複排除する', () => {
    const targets = collectReopenTargetsForPlacements({
      placements: [
        { managedStudentId: 'stu-1', displayName: '山田', dateKey: '2026-07-25', slotNumber: 3 },
        { managedStudentId: 'stu-1', displayName: '山田', dateKey: '2026-07-25', slotNumber: 3 },
      ],
      studentUnavailableSlotsById: effectiveUnavailable,
    })
    expect(targets).toHaveLength(1)
  })

  it('確認メッセージに生徒名と日付・時限が入る', () => {
    const message = buildReopenConfirmMessage([{ displayName: '山田', dateKey: '2026-07-25', slotNumber: 3 }])
    expect(message).toContain('山田')
    expect(message).toContain('7/25 3限')
    expect(message).toContain('出席可能(黄色)')
  })
})

describe('collectStudentMoveLandingPlacements (移動/入替の着地列挙)', () => {
  const managedStudentByAnyName = new Map<string, StudentRow>([
    ['佐藤 花子', { id: 'stu-2' } as StudentRow],
  ])
  const displayName = (name: string) => name

  it('移動: 移動生徒が移動先コマに着地する', () => {
    const movingStudent = buildStudent({ id: 'entry-move', managedStudentId: 'stu-1' })
    const sourceCell = buildCell({ id: 'cell-src', dateKey: '2026-07-24', slotNumber: 2, desks: [buildDesk({ lesson: { id: 'l1', studentSlots: [movingStudent, null] } })] })
    const targetCell = buildCell({ id: 'cell-dst', dateKey: '2026-07-25', slotNumber: 3, desks: [buildDesk({ id: 'desk-dst' })] })
    const weeks: SlotCell[][] = [[sourceCell, targetCell]]

    const placements = collectStudentMoveLandingPlacements({
      weeks,
      cells: weeks[0],
      movingStudentId: 'entry-move',
      cellId: 'cell-dst',
      deskIndex: 0,
      studentIndex: 0,
      managedStudentByAnyName,
      resolveBoardStudentDisplayName: displayName,
    })
    expect(placements).toEqual([
      expect.objectContaining({ managedStudentId: 'stu-1', dateKey: '2026-07-25', slotNumber: 3 }),
    ])
  })

  it('入替: 相手生徒は移動元コマへ着地する(相手の不可コマ確認も対象になる)', () => {
    const movingStudent = buildStudent({ id: 'entry-move', managedStudentId: 'stu-1' })
    const partner = buildStudent({ id: 'entry-partner', managedStudentId: undefined, name: '佐藤 花子' })
    const sourceCell = buildCell({ id: 'cell-src', dateKey: '2026-07-24', slotNumber: 2, desks: [buildDesk({ lesson: { id: 'l1', studentSlots: [movingStudent, null] } })] })
    const targetCell = buildCell({ id: 'cell-dst', dateKey: '2026-07-25', slotNumber: 3, desks: [buildDesk({ id: 'desk-dst', lesson: { id: 'l2', studentSlots: [partner, null] } })] })
    const weeks: SlotCell[][] = [[sourceCell, targetCell]]

    const placements = collectStudentMoveLandingPlacements({
      weeks,
      cells: weeks[0],
      movingStudentId: 'entry-move',
      cellId: 'cell-dst',
      deskIndex: 0,
      studentIndex: 0,
      managedStudentByAnyName,
      resolveBoardStudentDisplayName: displayName,
    })
    expect(placements).toEqual([
      expect.objectContaining({ managedStudentId: 'stu-1', dateKey: '2026-07-25', slotNumber: 3 }),
      // 相手は managedStudentId 未設定でも名前逆引き(managedStudentByAnyName)で解決される
      expect.objectContaining({ managedStudentId: 'stu-2', dateKey: '2026-07-24', slotNumber: 2 }),
    ])
  })

  it('同一コマ内の移動/入替は対象外(既存配置の置き直しで確認を出さない)', () => {
    const movingStudent = buildStudent({ id: 'entry-move', managedStudentId: 'stu-1' })
    const partner = buildStudent({ id: 'entry-partner', managedStudentId: 'stu-2', name: '佐藤 花子' })
    const cell = buildCell({
      id: 'cell-same',
      dateKey: '2026-07-25',
      slotNumber: 3,
      desks: [
        buildDesk({ id: 'desk-a', lesson: { id: 'l1', studentSlots: [movingStudent, null] } }),
        buildDesk({ id: 'desk-b', lesson: { id: 'l2', studentSlots: [partner, null] } }),
      ],
    })
    const weeks: SlotCell[][] = [[cell]]

    const placements = collectStudentMoveLandingPlacements({
      weeks,
      cells: weeks[0],
      movingStudentId: 'entry-move',
      cellId: 'cell-same',
      deskIndex: 1,
      studentIndex: 0,
      managedStudentByAnyName,
      resolveBoardStudentDisplayName: displayName,
    })
    expect(placements).toEqual([])
  })
})

// 実効不可の尊重: 講師の○×記号は「出席可能に変更」(reopenedSlots)済みコマを ○(可能)にする。
// unavailableSlots を直接読む実装へ巻き戻すとこのテストが落ちる。
describe('resolveTeacherLectureSlotMark (黄色コマは○扱い)', () => {
  const sessions = [{
    id: 'session-1',
    label: '夏期講習',
    startDate: '2026-07-21',
    endDate: '2026-08-28',
    teacherInputs: {
      t1: {
        unavailableSlots: ['2026-07-25_3', '2026-07-26_2'],
        reopenedSlots: ['2026-07-25_3'],
        countSubmitted: true,
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
    },
    studentInputs: {},
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  }]

  it('変換済み(黄色)コマは○・未変換の不可コマは×のまま', () => {
    expect(resolveTeacherLectureSlotMark({ specialSessions: sessions, teacherId: 't1', dateKey: '2026-07-25', slotNumber: 3 })).toBe('○')
    expect(resolveTeacherLectureSlotMark({ specialSessions: sessions, teacherId: 't1', dateKey: '2026-07-26', slotNumber: 2 })).toBe('×')
  })
})
