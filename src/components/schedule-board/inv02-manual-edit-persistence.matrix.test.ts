import { describe, expect, it } from 'vitest'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import type { TeacherRow } from '../basic-data/basicDataModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import type { ClassroomSettings } from '../../types/appState'
import {
  overlayBoardWeeksOnScheduleCells,
  packSortCellDesks,
  repackTeacherOnlyDesks,
  reconcileSubmittedTeacherPlacements,
  computeStudentMove,
} from './ScheduleBoardScreen'
import { resolveSelectedLecturePlacementItem } from './lectureStockPlacement'

// ============================================================================
// INV-02 操作マトリクステスト（保証: 盤面への手動編集は自動処理で巻き戻らない）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-02・強制）:
//   盤面への手動編集（配置/削除/移動/入替/科目選択/出欠入力）は、自動処理
//   （テンプレ再マージ/自動割当/詰め直し/リロード）で巻き戻らない。
//
// 例外（オーナー裁定 2026-07-11）:
//   テンプレの反映日を決めて適用したときのみ、反映日以降はテンプレが正となり
//   上書きする。それ以外のときはユーザーの配置が正。
//
// マトリクス:
//   手動編集 = { 配置(生徒) / 削除(講師) / 移動(生徒) / 入替(生徒swap) / 科目選択 / 出欠入力 }
//   自動処理 = { テンプレ再マージ(overlay=mergeManagedWeek)
//                / 講習自動割当(reconcileSubmittedTeacherPlacements=reconcile+autoAssign)
//                / 詰め直し(repackTeacherOnlyDesks / packSortCellDesks)
//                / リロード相当(serialize/snapshot 往復) }
//
// 各セル = 小さな fixture + 手動編集1回 + 自動処理1回 + 「編集が残る」assert。
//
// 既存の担保（重複を作らない・薄い確認/参照に留める）:
//   - 削除(講師)×全列: ScheduleBoardScreen.test.ts の tombstone 群（v1.5.435 / 2255・5016）
//   - 配置×再マージ: overlayBoardWeeks.test.ts（テンプレ silent で盤面授業保持）
//   - 出欠×詰め直し: ScheduleBoardScreen.test.ts:1031（skipStatusSlotPack）
//   本ファイルは上記を薄く再確認しつつ、これまで空だったセル
//   （入替×再マージ/詰め直し/リロード・科目選択×再マージ/リロード・
//     移動×自動割当/リロード・配置×リロード 等）を厚く埋める。
// ============================================================================

const classroomSettings: ClassroomSettings = {
  closedWeekdays: [0],
  holidayDates: [],
  forceOpenDates: [],
  deskCount: 14,
}

// --- fixture ヘルパー（新ファイル内に自前・既存テストのパターンを踏襲） --------------

function createStudent(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'sA_2026-06-01_数',
    name: '生徒A',
    managedStudentId: 'sA',
    grade: '中3',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function createDesk(overrides: Partial<DeskCell> = {}): DeskCell {
  return {
    id: 'desk-1',
    teacher: '',
    ...overrides,
  }
}

function createCell(overrides: Partial<SlotCell> = {}): SlotCell {
  return {
    id: '2026-06-01_1',
    dateKey: '2026-06-01',
    dayLabel: '月',
    dateLabel: '6/1',
    slotLabel: '1限',
    slotNumber: 1,
    timeLabel: '',
    isOpenDay: true,
    desks: [],
    ...overrides,
  }
}

function createAttendedStatus(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  return {
    id: 'status-1',
    studentId: 'sA',
    sourceManagedLesson: true,
    name: '生徒A',
    managedStudentId: 'sA',
    grade: '中3',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '講師A',
    dateKey: '2026-06-01',
    slotNumber: 1,
    recordedAt: '2026-06-01T10:00:00.000Z',
    status: 'attended',
    sourceLessonId: 'managed_x_2026-06-01',
    ...overrides,
  }
}

// テンプレがこのコマについて「沈黙している」（生徒行を持たない）状態の管理セル。
// overlay(mergeManagedWeek) は同一 id の管理セルとだけマージするので id を合わせる。
function silentManagedCell(boardCell: SlotCell): SlotCell {
  return createCell({
    id: boardCell.id,
    dateKey: boardCell.dateKey,
    dateLabel: boardCell.dateLabel,
    slotNumber: boardCell.slotNumber,
    slotLabel: boardCell.slotLabel,
    isOpenDay: true,
    desks: boardCell.desks.map((_, index) => createDesk({ id: `m_${boardCell.id}_${index}`, teacher: '' })),
  })
}

// リロード相当（手動保存 → Firestore serialize → 再ロードの往復）。
// JSON 往復で失われる状態（非直列化フィールド等）が無いことも同時に固定する。
function reloadRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function findStudentInCells(cells: SlotCell[], managedStudentId: string): { cell: SlotCell; student: StudentEntry } | null {
  for (const cell of cells) {
    for (const desk of cell.desks) {
      for (const student of desk.lesson?.studentSlots ?? []) {
        if (student && student.managedStudentId === managedStudentId) return { cell, student }
      }
    }
  }
  return null
}

function makeTeacher(id: string, name: string): TeacherRow {
  return { id, name, entryDate: '', withdrawDate: '' } as TeacherRow
}

function makeSession(overrides: Partial<SpecialSessionRow> = {}): SpecialSessionRow {
  return {
    id: 'sess1',
    label: '夏期講習',
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    teacherInputs: {
      tX: { unavailableSlots: [], countSubmitted: true, updatedAt: '' },
    },
    studentInputs: {},
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as SpecialSessionRow
}

const moveDefaults = {
  suppressedRegularLessonOccurrences: [] as string[],
  managedStudentByAnyName: new Map<string, never>(),
  resolveBoardStudentDisplayName: (name: string) => name,
}

describe('INV-02 手動編集の永続化マトリクス（自動処理で巻き戻らない）', () => {
  // ------------------------------------------------------------------------
  // 行: 配置(生徒) — 未消化ストック等をユーザーが手動で机へ置く
  // ------------------------------------------------------------------------
  describe('手動編集=配置(生徒)', () => {
    // 盤面に手動配置した講習生徒（非managed・manualAdded）を持つセル。
    function boardWithPlacement(): SlotCell {
      return createCell({
        id: '2026-06-01_1',
        desks: [
          createDesk({
            id: 'b-0',
            teacher: '',
            lesson: {
              id: 'lecture_sA_placed',
              studentSlots: [
                createStudent({ id: 'lec_sA', managedStudentId: 'sA', lessonType: 'special', manualAdded: true, subject: '数', specialSessionId: 'sess1' }),
                null,
              ],
            },
          }),
          createDesk({ id: 'b-1' }),
          createDesk({ id: 'b-2' }),
        ],
      })
    }

    it('×テンプレ再マージ: 手動配置した生徒はテンプレ silent の再マージで消えない（overlayBoardWeeks の担保を薄く再確認）', () => {
      const board = boardWithPlacement()
      const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(board)], [[board]])
      expect(findStudentInCells([merged], 'sA')?.student.subject).toBe('数')
    })

    it('×詰め直し(packSort): 手動配置した生徒は詰め直しで残る', () => {
      const packed = packSortCellDesks(boardWithPlacement())
      expect(findStudentInCells([{ ...boardWithPlacement(), desks: packed }], 'sA')).not.toBeNull()
    })

    it('×講習自動割当(reconcile): 提出済み講師を空き机へ配置しても手動配置の生徒は動かない', () => {
      const result = reconcileSubmittedTeacherPlacements({
        weeks: [[boardWithPlacement()]],
        specialSessions: [makeSession({ startDate: '2026-06-01', endDate: '2026-06-01' })],
        teachers: [makeTeacher('tX', '講師X')],
        students: [],
        regularLessons: [],
        classroomSettings,
      })
      expect(findStudentInCells(result.nextWeeks.flat(), 'sA')).not.toBeNull()
    })

    it('×リロード相当(serialize往復): 手動配置した生徒はスナップショット往復後も残る', () => {
      const restored = reloadRoundTrip([[boardWithPlacement()]])
      expect(findStudentInCells(restored.flat(), 'sA')?.student.manualAdded).toBe(true)
    })
  })

  // ------------------------------------------------------------------------
  // 行: 削除(講師) — 室長が講師を意図的に消した削除tombstone
  //   （teacher='' / manualTeacher=true / source='deleted'）。
  //   全列とも ScheduleBoardScreen.test.ts で厚く担保済みのため、ここでは薄く再確認する。
  // ------------------------------------------------------------------------
  describe('手動編集=削除(講師) [tombstone]（既存 v1.5.435 群を薄く再確認）', () => {
    function tombstoneDesk(): DeskCell {
      return createDesk({ id: 'b-0', teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: '落合講師' })
    }

    it('×テンプレ再マージ: 削除した講師はテンプレに残っていても再付与されない', () => {
      const board = createCell({ desks: [tombstoneDesk(), createDesk({ id: 'b-1' })] })
      // テンプレは同コマに「落合講師」を持つ（=削除前の姿）。
      const managed = createCell({
        id: board.id,
        desks: [createDesk({ id: 'm-0', teacher: '落合講師', teacherAssignmentTeacherId: 't025' }), createDesk({ id: 'm-1' })],
      })
      const [merged] = overlayBoardWeeksOnScheduleCells([managed], [[board]])
      expect(merged.desks.some((desk) => desk.teacher === '落合講師')).toBe(false)
    })

    it('×詰め直し(repack): 削除tombstoneは詰め直しで消えない', () => {
      const out = repackTeacherOnlyDesks([tombstoneDesk(), createDesk({ id: 'b-1', teacher: '永山講師' })])
      expect(out.some((desk) => desk.teacherAssignmentSource === 'deleted' && desk.teacherAssignmentTeacherId === '落合講師')).toBe(true)
    })

    it('×リロード相当(serialize往復): 削除tombstoneはスナップショット往復後も残る', () => {
      const restored = reloadRoundTrip([[createCell({ desks: [tombstoneDesk()] })]])
      const desk = restored[0][0].desks[0]
      expect(desk.manualTeacher).toBe(true)
      expect(desk.teacherAssignmentSource).toBe('deleted')
    })
  })

  // ------------------------------------------------------------------------
  // 行: 移動(生徒) — computeStudentMove（別コマへ移す）
  // ------------------------------------------------------------------------
  describe('手動編集=移動(生徒)', () => {
    // 6/1・1限 の生徒Aを 6/2・1限 の空き机へ移動した直後の weeks を返す。
    function movedWeeks(): SlotCell[][] {
      const source = createCell({
        id: '2026-06-01_1',
        dateKey: '2026-06-01',
        desks: [
          createDesk({ id: 'src-0', teacher: '講師A', lesson: { id: 'board_src', studentSlots: [createStudent({ id: 'sA_2026-06-01_数', managedStudentId: 'sA' }), null] } }),
          createDesk({ id: 'src-1' }),
        ],
      })
      const target = createCell({
        id: '2026-06-02_1',
        dateKey: '2026-06-02',
        dateLabel: '6/2',
        desks: [createDesk({ id: 'tgt-0' }), createDesk({ id: 'tgt-1' })],
      })
      const weeks = [[source, target]]
      const result = computeStudentMove({
        weeks,
        weekIndex: 0,
        cells: weeks[0],
        movingStudentId: 'sA_2026-06-01_数',
        cellId: '2026-06-02_1',
        deskIndex: 0,
        studentIndex: 0,
        ...moveDefaults,
      })
      if (result.status !== 'moved') throw new Error(`expected moved, got ${result.status}`)
      return result.nextWeeks
    }

    it('移動が成立し生徒Aは移動先(6/2)にいて移動元(6/1)には戻らない（前提固定）', () => {
      const weeks = movedWeeks()
      expect(findStudentInCells(weeks.flat(), 'sA')?.cell.dateKey).toBe('2026-06-02')
    })

    it('×テンプレ再マージ: 移動先に置いた生徒はテンプレ silent の再マージで移動元へ戻らない', () => {
      const weeks = movedWeeks()
      const managed = weeks[0].map(silentManagedCell)
      const merged = overlayBoardWeeksOnScheduleCells(managed, weeks)
      expect(findStudentInCells(merged, 'sA')?.cell.dateKey).toBe('2026-06-02')
    })

    it('×詰め直し(packSort): 移動先セルを詰め直しても移動生徒は残る', () => {
      const weeks = movedWeeks()
      const targetCell = weeks[0].find((cell) => cell.dateKey === '2026-06-02')!
      const packed = { ...targetCell, desks: packSortCellDesks(targetCell) }
      expect(findStudentInCells([packed], 'sA')).not.toBeNull()
    })

    it('×講習自動割当(reconcile): 講師を自動配置しても移動生徒は移動先に残る', () => {
      const result = reconcileSubmittedTeacherPlacements({
        weeks: movedWeeks(),
        specialSessions: [makeSession()],
        teachers: [makeTeacher('tX', '講師X')],
        students: [],
        regularLessons: [],
        classroomSettings,
      })
      expect(findStudentInCells(result.nextWeeks.flat(), 'sA')?.cell.dateKey).toBe('2026-06-02')
    })

    it('×リロード相当(serialize往復): 移動結果はスナップショット往復後も維持される', () => {
      const restored = reloadRoundTrip(movedWeeks())
      expect(findStudentInCells(restored.flat(), 'sA')?.cell.dateKey).toBe('2026-06-02')
    })
  })

  // ------------------------------------------------------------------------
  // 行: 入替(生徒swap) — computeStudentMove（配置済みの席へ落として2人を入れ替え）
  //   これまで空セルだった箇所を厚く埋める。
  // ------------------------------------------------------------------------
  describe('手動編集=入替(生徒swap)', () => {
    // 6/1・1限の生徒A と 6/2・1限の生徒B を入れ替えた直後の weeks を返す。
    function swappedWeeks(): SlotCell[][] {
      const source = createCell({
        id: '2026-06-01_1',
        dateKey: '2026-06-01',
        desks: [
          createDesk({ id: 'src-0', teacher: '講師A', lesson: { id: 'board_src', studentSlots: [createStudent({ id: 'sA_2026-06-01_数', managedStudentId: 'sA', name: '生徒A' }), null] } }),
          createDesk({ id: 'src-1' }),
        ],
      })
      const target = createCell({
        id: '2026-06-02_1',
        dateKey: '2026-06-02',
        dateLabel: '6/2',
        desks: [
          createDesk({ id: 'tgt-0', teacher: '講師B', lesson: { id: 'board_tgt', studentSlots: [createStudent({ id: 'sB_2026-06-02_英', managedStudentId: 'sB', name: '生徒B', subject: '英' }), null] } }),
          createDesk({ id: 'tgt-1' }),
        ],
      })
      const weeks = [[source, target]]
      const result = computeStudentMove({
        weeks,
        weekIndex: 0,
        cells: weeks[0],
        movingStudentId: 'sA_2026-06-01_数',
        cellId: '2026-06-02_1',
        deskIndex: 0,
        studentIndex: 0,
        ...moveDefaults,
      })
      if (result.status !== 'moved') throw new Error(`expected moved(swap), got ${result.status}`)
      return result.nextWeeks
    }

    it('入替が成立し A↔B が入れ替わる（前提固定）', () => {
      const weeks = swappedWeeks()
      expect(findStudentInCells(weeks.flat(), 'sA')?.cell.dateKey).toBe('2026-06-02')
      expect(findStudentInCells(weeks.flat(), 'sB')?.cell.dateKey).toBe('2026-06-01')
    })

    it('×テンプレ再マージ往復: 入れ替えた2人はテンプレ silent の再マージで元位置へ戻らない', () => {
      const weeks = swappedWeeks()
      const managed = weeks[0].map(silentManagedCell)
      const merged = overlayBoardWeeksOnScheduleCells(managed, weeks)
      expect(findStudentInCells(merged, 'sA')?.cell.dateKey).toBe('2026-06-02')
      expect(findStudentInCells(merged, 'sB')?.cell.dateKey).toBe('2026-06-01')
    })

    it('×詰め直し(packSort): 入替後の各セルを詰め直しても2人は入替後の位置に残る', () => {
      const weeks = swappedWeeks()
      const packedCells = weeks[0].map((cell) => ({ ...cell, desks: packSortCellDesks(cell) }))
      expect(findStudentInCells(packedCells, 'sA')?.cell.dateKey).toBe('2026-06-02')
      expect(findStudentInCells(packedCells, 'sB')?.cell.dateKey).toBe('2026-06-01')
    })

    it('×講習自動割当(reconcile): 講師を自動配置しても入替結果は保たれる', () => {
      const result = reconcileSubmittedTeacherPlacements({
        weeks: swappedWeeks(),
        specialSessions: [makeSession()],
        teachers: [makeTeacher('tX', '講師X')],
        students: [],
        regularLessons: [],
        classroomSettings,
      })
      expect(findStudentInCells(result.nextWeeks.flat(), 'sA')?.cell.dateKey).toBe('2026-06-02')
      expect(findStudentInCells(result.nextWeeks.flat(), 'sB')?.cell.dateKey).toBe('2026-06-01')
    })

    it('×リロード相当(serialize往復): 入替結果はスナップショット往復後も維持される', () => {
      const restored = reloadRoundTrip(swappedWeeks())
      expect(findStudentInCells(restored.flat(), 'sA')?.cell.dateKey).toBe('2026-06-02')
      expect(findStudentInCells(restored.flat(), 'sB')?.cell.dateKey).toBe('2026-06-01')
    })
  })

  // ------------------------------------------------------------------------
  // 行: 科目選択 — 複数科目を持つ生徒で「ユーザーが選んだ科目」を配置する。
  //   resolveSelectedLecturePlacementItem（v1.5.364 回帰）で選んだ科目が
  //   自動処理後も維持されるか（これまで空セルだった箇所を厚く埋める）。
  // ------------------------------------------------------------------------
  describe('手動編集=科目選択', () => {
    const pendingItems = [
      { subject: '英', sessionId: 'sess1' },
      { subject: '数', sessionId: 'sess1' },
    ]

    it('resolveSelectedLecturePlacementItem は選択した科目(数)を返す（先頭[英]にフォールバックしない）', () => {
      const picked = resolveSelectedLecturePlacementItem(pendingItems, { subject: '数', sessionId: 'sess1' })
      expect(picked?.subject).toBe('数')
    })

    // 選択科目(数)で配置した講習生徒を持つ盤面セル。
    function boardWithSubjectChoice(): SlotCell {
      const picked = resolveSelectedLecturePlacementItem(pendingItems, { subject: '数', sessionId: 'sess1' })!
      return createCell({
        id: '2026-06-01_1',
        desks: [
          createDesk({
            id: 'b-0',
            lesson: {
              id: 'lecture_sA_数',
              studentSlots: [
                createStudent({ id: 'lec_sA_数', managedStudentId: 'sA', lessonType: 'special', manualAdded: true, subject: picked.subject as StudentEntry['subject'], specialSessionId: 'sess1' }),
                null,
              ],
            },
          }),
          createDesk({ id: 'b-1' }),
        ],
      })
    }

    it('×テンプレ再マージ: 選択した科目(数)は再マージ後も先頭科目に置き換わらない', () => {
      const board = boardWithSubjectChoice()
      const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(board)], [[board]])
      expect(findStudentInCells([merged], 'sA')?.student.subject).toBe('数')
    })

    it('×リロード相当(serialize往復): 選択した科目(数)はスナップショット往復後も維持される', () => {
      const restored = reloadRoundTrip([[boardWithSubjectChoice()]])
      expect(findStudentInCells(restored.flat(), 'sA')?.student.subject).toBe('数')
    })
  })

  // ------------------------------------------------------------------------
  // 行: 出欠入力 — statusSlots に出席実績を記録する。
  //   ×詰め直し は既存 1031 で担保済みのため薄く再確認し、×再マージ/×リロードを埋める。
  // ------------------------------------------------------------------------
  describe('手動編集=出欠入力(attended)', () => {
    // 生徒Aを出席にした机（studentSlots は空・実績は statusSlots に退避）。
    function boardWithAttendance(): SlotCell {
      return createCell({
        id: '2026-06-01_1',
        desks: [
          createDesk({ id: 'b-0', teacher: '講師A', statusSlots: [createAttendedStatus(), null] }),
          createDesk({ id: 'b-1' }),
        ],
      })
    }

    it('×詰め直し(packSort skipStatusSlotPack): 出席実績のスロットは詰め直しで潰れない（既存 1031 を薄く再確認）', () => {
      const desk = createDesk({
        id: 'b-0',
        teacher: '講師A',
        statusSlots: [createAttendedStatus(), null],
        lesson: { id: 'right-only', studentSlots: [null, createStudent({ id: 'sReal', managedStudentId: 'sReal', name: '右側生徒', subject: '英' })] },
      })
      const cell = createCell({ id: '2026-06-01_1', desks: [desk] })
      const packed = packSortCellDesks(cell, { skipStatusSlotPack: true })
      expect(packed[0]?.statusSlots?.[0]?.status).toBe('attended')
      expect(packed[0]?.lesson?.studentSlots[1]?.name).toBe('右側生徒')
    })

    it('×テンプレ再マージ: 記録した出席実績は再マージで消えない（講師名も保持される）', () => {
      const board = boardWithAttendance()
      const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(board)], [[board]])
      const attendedDesk = merged.desks.find((desk) => desk.statusSlots?.[0]?.status === 'attended')
      expect(attendedDesk).toBeDefined()
      expect(attendedDesk?.teacher).toBe('講師A')
    })

    it('×講習自動割当(reconcile): 講師を自動配置しても出席実績は消えない', () => {
      const result = reconcileSubmittedTeacherPlacements({
        weeks: [[boardWithAttendance()]],
        specialSessions: [makeSession({ startDate: '2026-06-01', endDate: '2026-06-01' })],
        teachers: [makeTeacher('tX', '講師X')],
        students: [],
        regularLessons: [],
        classroomSettings,
      })
      const attendedDesk = result.nextWeeks.flat().flatMap((cell) => cell.desks).find((desk) => desk.statusSlots?.[0]?.status === 'attended')
      expect(attendedDesk).toBeDefined()
    })

    it('×リロード相当(serialize往復): 出席実績はスナップショット往復後も維持される', () => {
      const restored = reloadRoundTrip([[boardWithAttendance()]])
      expect(restored[0][0].desks[0].statusSlots?.[0]?.status).toBe('attended')
    })
  })

  // ------------------------------------------------------------------------
  // 仕様未決セル（it.todo）
  // ------------------------------------------------------------------------
  describe('仕様未決（現実装と INV-02 裁定の乖離・修正待ち）', () => {
    // オーナー裁定 2026-07-11: テンプレ反映日を適用したとき以外はユーザー配置が正。
    // 現実装(mergeManagedWeek の teacher: desk.manualTeacher ? ... 分岐 / 2620・2729付近)は、
    // 非manual かつ記録ステータスの無い机に置かれた講師を、通常のテンプレ再マージでも常にクリアする。
    // これは上記裁定と乖離しており修正待ち（別タスク）。実装も既存ロック
    // （ScheduleBoardScreen.test.ts:2074 が現挙動をロック中）も本ファイルでは変更しない。
    it.todo('非manual経路で置かれた講師×テンプレ再マージ: 反映日適用時以外はユーザー配置(講師)が正だが現実装はクリア（乖離・修正待ち・別タスク）')
  })
})
