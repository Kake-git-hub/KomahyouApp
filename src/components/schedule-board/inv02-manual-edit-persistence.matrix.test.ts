import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import type { ClassroomSettings } from '../../types/appState'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import {
  applyTeacherAutoAssignRequest,
  buildManagedOccurrenceKey,
  buildManagedScheduleCellsForRange,
  computeTemplateDiffApplyForBoard,
  remergeBoardWeeksWithManagedData,
  overlayBoardWeeksOnScheduleCells,
  packSortCellDesks,
  repackTeacherOnlyDesks,
  reconcileSubmittedTeacherPlacements,
  applyUserDeletedTeacherTombstone,
  computeStudentMove,
  applyHistoryEntry,
  remergeBoardWeekWithManagedData,
  stripWithdrawnStudentsFromBoardWeek,
  computeStudentWithdrawSweep,
  computePendingDeskResolution,
  computePendingLowerStudentMove,
  type HistoryEntry,
  type TemplatePendingResolutionLedgers,
} from './ScheduleBoardScreen'
import { hasUnsavedUserEditBeforeBoardPublish, resolveBoardStateChangeCleanMarking, resolveRestoreFlagLifecycle } from '../../App'
import { resolveSelectedLecturePlacementItem } from './lectureStockPlacement'
import { collectStudentWithdrawSweepTargets } from './studentWithdrawSweep'
import { buildTemplatePendingDeskKey, collectTemplatePendingCellIds, collectTemplatePendingDeskIdsInCell, type TemplatePendingDeskMap } from './templatePendingDesks'
import { seatSortCells } from './deskSort'
import { trimBoardWeeksForMemory } from './boardWeekTrim'

// ============================================================================
// INV-02 操作マトリクステスト（保証: 盤面への手動編集は自動処理で巻き戻らない）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-02・強制）:
//   盤面への手動編集（配置/削除/移動/入替/科目選択/出欠入力）は、自動処理
//   （テンプレ再マージ/自動割当/詰め直し/リロード）で巻き戻らない。
//
// 仕様確定（オーナー確定 2026-07-11: テンプレ由来講師はテンプレ追従・ユーザー配置は全経路manual扱いで不可侵）:
//   - ユーザーが講師/生徒を触る全経路（講師セル選択/削除/生徒移動ピン/講師D&D/
//     QR講習自動割当）は manualTeacher=true で記録され、日常の自動処理では不可侵
//     （＝裁定「ユーザーの配置が正」の実装形）。
//   - テンプレ由来（非manual＝テンプレが自動で置いた足場）の講師はテンプレに追従する。
//     テンプレ/基本データ編集で盤面の足場講師が変わる・消えるのは正（既知乖離ではなく確定仕様）。
//   - テンプレの反映日を決めて適用したときのみ、反映日以降はテンプレが正となり全て上書きする
//     （適用ハンドラ内の挙動で、このマトリクスの対象外）。
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

    // 回帰防止(2026-09-14・案A): 提出済み講師の「その講習での最後の登録机」を削除すると、reconcile が
    // tombstone を数えず「未配置」と誤判定し、盤面の再マウント(画面切替・リロード)毎に同コマの別の空き机へ
    // 置き直していた(開発用教室 9/22 1・2限の能勢: 消すたびに tombstone が増え別机に再出)。
    // 判定は tombstone の講習ID一致に限定(講習IDはユーザーが登録机を削除したときだけ残る)。
    describe('×講習自動割当(reconcile): 提出済み講師の最後の登録机を削除しても再マウントで別机に再出しない', () => {
      const noseTeacher = { id: 't039', name: '能勢　大和', displayName: '能勢', entryDate: '', withdrawDate: '' } as TeacherRow
      // 実データ(9/22)と同形: 1限・2限とも能勢の講習登録机があり、他の机は空き。
      function registeredWeeks(): SlotCell[][] {
        const makeSlot = (slotNumber: number) => createCell({
          id: `2026-06-01_${slotNumber}`,
          slotNumber,
          slotLabel: `${slotNumber}限`,
          desks: [
            createDesk({ id: `b${slotNumber}-0`, teacher: '能勢', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'sess1', teacherAssignmentTeacherId: 't039' }),
            createDesk({ id: `b${slotNumber}-1` }),
            createDesk({ id: `b${slotNumber}-2` }),
          ],
        })
        return [[makeSlot(1), makeSlot(2)]]
      }
      // 講師メニューの「削除」(handleDeleteTeacher)と同じ処理で全登録机を消す。
      function deleteAllRegisteredDesks(weeks: SlotCell[][]) {
        for (const cell of weeks.flat()) applyUserDeletedTeacherTombstone(cell.desks[0])
        return weeks
      }
      // 旧データ/通常授業の机の削除/丸ごと振替と同形: 講習IDの無い tombstone。
      function legacyTombstoneWeeks(tombstoneTeacherId = '能勢'): SlotCell[][] {
        const weeks = registeredWeeks()
        for (const cell of weeks.flat()) {
          cell.desks[0] = createDesk({ id: cell.desks[0].id, teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: tombstoneTeacherId })
        }
        return weeks
      }
      const noseOnBoard = (weeks: SlotCell[][]) => weeks.flat().flatMap((cell) => cell.desks).some((desk) => desk.teacher === '能勢')
      const run = (weeks: SlotCell[][], sessionId = 'sess1') => reconcileSubmittedTeacherPlacements({
        weeks,
        specialSessions: [makeSession({ id: sessionId, startDate: '2026-06-01', endDate: '2026-06-01', teacherInputs: { t039: { unavailableSlots: [], countSubmitted: true, updatedAt: '' } } })],
        teachers: [noseTeacher], students: [], regularLessons: [], classroomSettings,
      })

      it('ユーザー削除の tombstone は講習登録の講習IDを保持する(通常の机の削除では持たない)', () => {
        const [registered] = registeredWeeks()[0][0].desks
        applyUserDeletedTeacherTombstone(registered)
        expect(registered).toMatchObject({ teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentSessionId: 'sess1', teacherAssignmentTeacherId: '能勢' })

        const regularDesk = createDesk({ teacher: '能勢', manualTeacher: false, teacherAssignmentTeacherId: 't039' })
        applyUserDeletedTeacherTombstone(regularDesk)
        expect(regularDesk.teacherAssignmentSessionId).toBeUndefined()
        expect(regularDesk.teacherAssignmentSource).toBe('deleted')
      })

      it('全登録机を削除した講師は再マウント(reconcile)で置き直さない', () => {
        // 修正前: placedCount=1 / 1限・2限の空き机に「能勢」が再出して落ちる。
        const result = run(deleteAllRegisteredDesks(registeredWeeks()))
        expect(result.hasChanges).toBe(false)
        expect(result.placedCount).toBe(0)
        expect(noseOnBoard(result.nextWeeks)).toBe(false)
      })

      it('再マウントを繰り返しても(保存往復＋reconcile 2回)再出しない', () => {
        const once = run(deleteAllRegisteredDesks(registeredWeeks()))
        const twice = run(reloadRoundTrip(once.nextWeeks))
        expect(noseOnBoard(twice.nextWeeks)).toBe(false)
      })

      it('tombstone の講習IDはテンプレ再マージ(overlay)を通っても保持される', () => {
        const weeks = deleteAllRegisteredDesks(registeredWeeks())
        const merged = overlayBoardWeeksOnScheduleCells(weeks[0].map(silentManagedCell), weeks)
        expect(merged[0].desks[0]).toMatchObject({ teacherAssignmentSource: 'deleted', teacherAssignmentSessionId: 'sess1' })
        expect(noseOnBoard(run([merged]).nextWeeks)).toBe(false)
      })

      it('兄弟: 講習IDの無い tombstone(通常授業の机の削除・丸ごと振替・旧データ)は数えず、揮発した提出配置は従来どおり自己修復する', () => {
        const result = run(legacyTombstoneWeeks())
        expect(result.placedCount).toBe(1)
        expect(noseOnBoard(result.nextWeeks)).toBe(true)
      })

      it('兄弟: 別講習の講習IDを持つ tombstone は数えない', () => {
        const result = run(deleteAllRegisteredDesks(registeredWeeks()), 'sess2')
        expect(result.placedCount).toBe(1)
      })
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

    // 兄弟監査(2026-08-07・INV-01 の実障害から): 詰め直しは「lesson の無い机＝講師だけの机」と
    // みなして講師名を左へ寄せるが、出欠記録のある机を巻き込むと statusSlots はその場に残り、
    // 実績だけが別講師（または講師なし）のものになる。盤面そのものが壊れるため据え置く。
    it('×詰め直し(repack): 出席実績のある机の講師は他の机へ寄せられない', () => {
      const out = repackTeacherOnlyDesks([
        createDesk({ id: 'b-0' }),
        createDesk({ id: 'b-1', teacher: '講師A', statusSlots: [createAttendedStatus(), null] }),
      ])
      expect(out[1].teacher).toBe('講師A')
      expect(out[1].statusSlots?.[0]?.status).toBe('attended')
      expect(out[0].teacher).toBe('')
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
  // 行: 手動編集=講師配置の帰属境界（オーナー確定 2026-07-11:
  //   テンプレ由来はテンプレ追従・ユーザー配置は不可侵）
  //
  //   調査で前提が訂正された: ユーザーが講師を置く全経路（講師セル選択/削除/生徒移動ピン/
  //   講師D&D/QR講習自動割当）は manualTeacher=true で記録され、日常の自動処理では不可侵
  //   （既に実装済み）。よって「非manual講師」＝テンプレが自動で置いた足場講師に限られる。
  //   足場講師はテンプレに追従するのが確定仕様（mergeManagedWeek 2620・2729 でクリア →
  //   テンプレから再付与 2763-2803 する現挙動が仕様）。既存ロック
  //   ScheduleBoardScreen.test.ts:2074（「manualTeacher の机は講師が消えない／非manual
  //   かつ記録ステータス無しでは消える」）と整合する。
  // ------------------------------------------------------------------------
  describe('手動編集=講師配置の帰属境界（オーナー確定 2026-07-11: テンプレ由来はテンプレ追従・ユーザー配置は不可侵）', () => {
    // テンプレが自動で置いた足場講師（非manual・source undefined・lessonなし・記録ステータス無し）の机。
    function boardWithScaffoldTeacher(): SlotCell {
      return createCell({
        id: '2026-06-01_1',
        desks: [
          createDesk({ id: 'b-0', teacher: '講師X', manualTeacher: false, teacherAssignmentTeacherId: 'tX' }),
          createDesk({ id: 'b-1' }),
        ],
      })
    }

    it('×テンプレ再マージ[仕様ロック]: テンプレ由来(非manual)の足場講師は、テンプレから外れると再マージでクリアされる（テンプレ追従が仕様）', () => {
      const board = boardWithScaffoldTeacher()
      // テンプレは同コマについて沈黙し、講師Xも持たない（＝テンプレから外れた足場講師）。
      const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(board)], [[board]])
      expect(merged.desks.some((desk) => desk.teacher === '講師X')).toBe(false)
    })

    it('×テンプレ再マージ[仕様ロック]: テンプレに講師が居続ける場合は再マージ後も同じ講師が置き直され見た目が維持される（追従の正方向）', () => {
      const board = boardWithScaffoldTeacher()
      // テンプレは同コマに講師X（足場講師）を持ち続ける（teacher-only の管理デスク）。
      const managed = createCell({
        id: board.id,
        desks: [
          createDesk({ id: 'm-0', teacher: '講師X', teacherAssignmentTeacherId: 'tX' }),
          createDesk({ id: 'm-1' }),
        ],
      })
      const [merged] = overlayBoardWeeksOnScheduleCells([managed], [[board]])
      expect(merged.desks.some((desk) => desk.teacher === '講師X')).toBe(true)
    })

    it('×テンプレ再マージ[不可侵]: ユーザー配置(manual)の講師はテンプレ沈黙でも保持される（既存2074系の再確認）', () => {
      const board = createCell({
        id: '2026-06-01_1',
        desks: [
          createDesk({ id: 'b-0', teacher: '講師M', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 'tM' }),
          createDesk({ id: 'b-1' }),
        ],
      })
      const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(board)], [[board]])
      const desk = merged.desks.find((d) => d.teacher === '講師M')
      expect(desk).toBeDefined()
      expect(desk?.manualTeacher).toBe(true)
    })

    it('×テンプレ再マージ[不可侵]: QR講習自動割当由来(manual・source=schedule-registration)の講師も保持される', () => {
      const board = createCell({
        id: '2026-06-01_1',
        desks: [
          createDesk({ id: 'b-0', teacher: '講師Q', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'sess1', teacherAssignmentTeacherId: 'tQ' }),
          createDesk({ id: 'b-1' }),
        ],
      })
      const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(board)], [[board]])
      const desk = merged.desks.find((d) => d.teacher === '講師Q')
      expect(desk).toBeDefined()
      expect(desk?.teacherAssignmentSource).toBe('schedule-registration')
    })

    // オーナー確定 2026-08-02（丸ごと振替 Issue #40 の追随・INV-02）:
    // 「丸ごと振替」で QR 提出講師(schedule-registration)の机を**講習期間外の日へ意図的に移した**とき、
    // 起動時の自己修復(reconcileSubmittedTeacherPlacements)が期間内へ置き直すと移動が巻き戻る
    // （移動先にも残るため同じ講師が2か所に見える）。配置済み判定は盤面**全体**で行う。
    // ★この判定を「講習期間内だけ」に戻すと再発する（消してはならないガード）。
    it('×講習自動割当(reconcile)[不可侵]: 丸ごと振替で講習期間外へ移した提出講師は期間内へ置き直されない', () => {
      const insideCell = createCell({ id: '2026-06-01_1', dateKey: '2026-06-01', desks: [createDesk({ id: 'b-0' }), createDesk({ id: 'b-1' })] })
      // 講習期間(6/1-6/2)外の 6/3 へ移送済みの登録机
      const movedCell = createCell({
        id: '2026-06-03_1',
        dateKey: '2026-06-03',
        desks: [
          createDesk({ id: 'c-0', teacher: '講師X', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'sess1', teacherAssignmentTeacherId: 'tX' }),
        ],
      })

      const result = reconcileSubmittedTeacherPlacements({
        weeks: [[insideCell, movedCell]],
        specialSessions: [makeSession()],
        teachers: [makeTeacher('tX', '講師X')],
        students: [],
        regularLessons: [],
        classroomSettings,
      })

      expect(result.hasChanges).toBe(false)
      const inside = result.nextWeeks.flat().find((cell) => cell.dateKey === '2026-06-01')
      expect(inside?.desks.every((desk) => !desk.teacher.trim())).toBe(true)
      const moved = result.nextWeeks.flat().find((cell) => cell.dateKey === '2026-06-03')
      expect(moved?.desks[0]?.teacher).toBe('講師X')
    })
  })
  // ==========================================================================
  // 行: 戻す/やり直し(undo/redo) ・ ②一段スナップショット復元
  // 列: 「保存済み扱い（clean 署名の上書き）」→ リロードで巻き戻る
  //
  // U-0（2026-09-12・計画書 docs/plan-2026-09-11-five-requests.md §2-4）:
  //   handleUndo/handleRedo は版数 bump も onBoardStateChange も行わず、後追いの publish effect が
  //   userInitiated:false で発火していた。App 側 handleBoardStateChange はそれを「ロード」と見なして
  //   markStateLoadedClean() するため、戻した直後の盤面が clean 署名になり保存ボタンが効かず、
  //   リロードで undo 前の状態が復活していた。手動編集の永続化が publish 経路の既定値（受動扱い）で
  //   壊れる構造なので INV-02 に分類する。
  //
  // 兄弟監査:
  //   - redo（やり直し）… 同型なので同じ列で固定する（下の it）。
  //   - ②一段スナップショット復元（黄バナー「戻す」・App.tsx restoreUndoSnapshot）… 同型。
  //     復元は盤面を再マウントするので「再マウント由来の受動 publish で clean 化しない」側で固定する。
  //   - ③テンプレモード undo（templateUndoStack / pushTemplateUndo）… テンプレ編集は「テンプレ保存」で
  //     別経路（onReplaceRegularLessons）に流れ、盤面の clean 署名経路を通らない。**対象外**。
  // ==========================================================================
  describe('戻す/やり直し/一段スナップショット復元 × 保存済み扱い（U-0・publish の userInitiated 経路）', () => {
    const boardSource = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
    const appSource = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

    function sliceFunctionBody(source: string, startMarker: string, endMarker: string): string {
      const start = source.indexOf(startMarker)
      expect(start).toBeGreaterThan(-1)
      const end = source.indexOf(endMarker, start)
      expect(end).toBeGreaterThan(start)
      return source.slice(start, end)
    }

    // 手動編集（生徒を配置した状態）を持つ履歴エントリ。
    function createHistoryEntryFixture(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
      const cell = createCell({
        id: '2026-06-01_1',
        dateKey: '2026-06-01',
        desks: [createDesk({ id: 'b-0', teacher: '講師A', lesson: { id: 'lesson-1', studentSlots: [createStudent(), null] } })],
      })
      return {
        weeks: [[cell]],
        weekIndex: 0,
        selectedCellId: cell.id,
        selectedDeskIndex: 0,
        holidayDates: [],
        forceOpenDates: [],
        suppressedRegularLessonOccurrences: [],
        scheduleCountAdjustments: [],
        manualMakeupAdjustments: {},
        suppressedMakeupOrigins: {},
        fallbackMakeupStudents: {},
        manualLectureStockCounts: {},
        manualLectureStockOrigins: {},
        fallbackLectureStockStudents: {},
        ...overrides,
      }
    }

    const historyContext = {
      classroomSettings,
      groupClassEntries: {},
      isLectureStockOpen: false,
      isMakeupStockOpen: false,
      studentScheduleRange: null,
      teacherScheduleRange: null,
    }

    it('undo: applyHistoryEntry が「戻した盤面そのもの」を publish payload にする（保存対象になる）', () => {
      const entry = createHistoryEntryFixture()
      const applied = applyHistoryEntry(entry, historyContext)
      const desk = applied.publishPayload.weeks[0][0].desks[0]
      expect(desk.teacher).toBe('講師A')
      expect(desk.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
      expect(applied.publishPayload.weekIndex).toBe(0)
      expect(applied.publishPayload.selectedCellId).toBe('2026-06-01_1')
      // 参照を共有しない（publish 後の編集が履歴エントリを汚染しない）
      expect(applied.publishPayload.weeks[0]).not.toBe(entry.weeks[0])
    })

    it('undo: 休日/強制開校が変わる履歴なら教室設定も戻し、その設定で開校判定を掛けた週を publish する', () => {
      const entry = createHistoryEntryFixture({ holidayDates: ['2026-06-01'] })
      const applied = applyHistoryEntry(entry, historyContext)
      expect(applied.classroomSettingsChanged).toBe(true)
      expect(applied.nextClassroomSettings.holidayDates).toEqual(['2026-06-01'])
      expect(applied.publishPayload.weeks[0][0].isOpenDay).toBe(false)
      // 変化が無いときは教室設定を触らない（余計な書き込みを増やさない）
      expect(applyHistoryEntry(createHistoryEntryFixture(), historyContext).classroomSettingsChanged).toBe(false)
    })

    it('undo: handleUndo が版数 bump ＋ userInitiated:true で publish する（commitWeeks と同じ形）', () => {
      const handleUndo = sliceFunctionBody(boardSource, 'const handleUndo = () => {', 'const handleRedo = () => {')
      expect(handleUndo).toContain('applyHistoryEntry(previous, {')
      expect(handleUndo).toContain('committedBoardChangeVersionRef.current += 1')
      expect(handleUndo).toContain('onBoardStateChange?.(applied.publishPayload, { userInitiated: true })')
    })

    it('redo[兄弟]: handleRedo も版数 bump ＋ userInitiated:true で publish する', () => {
      const handleRedo = sliceFunctionBody(boardSource, 'const handleRedo = () => {', 'const handleBoardSort =')
      expect(handleRedo).toContain('applyHistoryEntry(next, {')
      expect(handleRedo).toContain('committedBoardChangeVersionRef.current += 1')
      expect(handleRedo).toContain('onBoardStateChange?.(applied.publishPayload, { userInitiated: true })')
    })

    it('②一段スナップショット復元[兄弟]: 復元直後の受動 publish では clean 署名を更新しない（＝未保存のまま）', () => {
      expect(resolveBoardStateChangeCleanMarking({ userInitiated: false, pendingUnsavedRestore: true, hasUnsavedUserEditBeforePublish: false })).toEqual({
        markClean: false,
        persist: false,
        consumePendingUnsavedRestore: true,
      })
      // 通常のロード/教室切替（復元直後でない）は従来どおり clean 化する
      expect(resolveBoardStateChangeCleanMarking({ userInitiated: false, pendingUnsavedRestore: false, hasUnsavedUserEditBeforePublish: false }).markClean).toBe(true)
      // userInitiated は従来どおり保存対象（clean 化しない）
      expect(resolveBoardStateChangeCleanMarking({ userInitiated: true, pendingUnsavedRestore: false, hasUnsavedUserEditBeforePublish: false })).toEqual({
        markClean: false,
        persist: true,
        consumePendingUnsavedRestore: true,
      })
    })

    it('②一段スナップショット復元[兄弟]: restoreUndoSnapshot は clean 化せず未保存フラグを立てる', () => {
      const restore = sliceFunctionBody(appSource, 'const restoreUndoSnapshot = useCallback(', 'const dismissUndoSnapshot =')
      // markStateLoadedClean(sig) の形で書き戻されてもすり抜けないよう、呼び出し自体を禁じる。
      expect(restore).not.toMatch(/markStateLoadedClean\s*\(/)
      expect(restore).toContain("event: 'undo-snapshot-restore'")
      expect(restore).toMatch(/pendingUnsavedUndoSnapshotRestoreRef\.current = resolveRestoreFlagLifecycle\(/)
    })

    // 2026-09-20(確認リスト その他): 休日設定の直後、再マージ effect が出す 2 回目の受動 publish が未保存の編集を clean 化し、
    // 保存ボタンが「最新データ」になって自動保存も手動保存も走らなかった(リロードで休日設定が消える)。
    it('ユーザー編集の直後の受動 publish[兄弟: 休日設定/丸ごと振替/全コマ削除の再マージ]: 未保存の編集があれば clean 化しない', () => {
      expect(resolveBoardStateChangeCleanMarking({ userInitiated: false, pendingUnsavedRestore: false, hasUnsavedUserEditBeforePublish: true })).toEqual({
        markClean: false,
        persist: false,
        consumePendingUnsavedRestore: true,
      })
      // 直前に未保存の編集が無い受動 publish(ロード/教室切替/マウント)は従来どおり clean 化する(U-0c を壊さない)。
      expect(resolveBoardStateChangeCleanMarking({ userInitiated: false, pendingUnsavedRestore: false, hasUnsavedUserEditBeforePublish: false }).markClean).toBe(true)
    })

    it('「未保存のユーザー編集があるか」は、直前の署名が clean と違い、かつ編集後に clean 署名が進んでいないときだけ true', () => {
      // 休日設定の直後: 編集時の clean 署名のまま・署名は clean と違う → 未保存あり。
      expect(hasUnsavedUserEditBeforeBoardPublish({ signatureBeforePublish: 'edited', cleanSignature: 'saved-1', cleanSignatureAtLastUserEdit: 'saved-1' })).toBe(true)
      // 保存が成功して clean 署名が進んだあとの受動 publish → 未保存なし。
      expect(hasUnsavedUserEditBeforeBoardPublish({ signatureBeforePublish: 'edited', cleanSignature: 'edited', cleanSignatureAtLastUserEdit: 'saved-1' })).toBe(false)
      // 教室切替/読み直しで clean 署名が差し替わったあと、読込時の正規化差で署名がずれていても、ユーザー編集由来ではない → 未保存扱いにしない
      // (開いただけの教室が未保存になって自動保存が走るのを防ぐ・U-0c / クロス教室汚染ガード)。
      expect(hasUnsavedUserEditBeforeBoardPublish({ signatureBeforePublish: 'normalized-diff', cleanSignature: 'other-classroom', cleanSignatureAtLastUserEdit: 'saved-1' })).toBe(false)
      // この起動で一度もユーザー編集していない → 未保存なし。
      expect(hasUnsavedUserEditBeforeBoardPublish({ signatureBeforePublish: 'x', cleanSignature: 'y', cleanSignatureAtLastUserEdit: null })).toBe(false)
      // 編集して元に戻した(署名が clean と同じ)→ 未保存なし。
      expect(hasUnsavedUserEditBeforeBoardPublish({ signatureBeforePublish: 'saved-1', cleanSignature: 'saved-1', cleanSignatureAtLastUserEdit: 'saved-1' })).toBe(false)
    })

    it('handleBoardStateChange は setBoardState の前に未保存判定を測り、ユーザー編集時の clean 署名を控える', () => {
      const handler = sliceFunctionBody(appSource, 'const handleBoardStateChange = useCallback(', 'writePendingWorkspaceSnapshotForRemoteSync()')
      const measureIndex = handler.indexOf('hasUnsavedUserEditBeforeBoardPublish({')
      const setIndex = handler.indexOf('setBoardState(nextBoardState)')
      expect(measureIndex).toBeGreaterThan(0)
      expect(setIndex).toBeGreaterThan(measureIndex)
      expect(handler).toContain('if (meta.userInitiated) cleanSignatureAtLastUserBoardEditRef.current = cleanSignatureRef.current')
      expect(handler).toContain('hasUnsavedUserEditBeforePublish,')
      // 明示 clean 化(読込/教室切替/ユーザー切替)では目印を落とす(中身が同じ教室をまたいでも未保存扱いにしない)。
      const markClean = sliceFunctionBody(appSource, 'const markStateLoadedClean = useCallback(', 'setCleanSignature(nextCleanSignature)')
      expect(markClean).toContain('if (expectedCleanSignature) cleanSignatureAtLastUserBoardEditRef.current = null')
    })

    it('クロス教室汚染ガードは温存する（userInitiated:false では一切書き込まない）', () => {
      expect(resolveBoardStateChangeCleanMarking({ userInitiated: false, pendingUnsavedRestore: true, hasUnsavedUserEditBeforePublish: false }).persist).toBe(false)
      expect(resolveBoardStateChangeCleanMarking({ userInitiated: false, pendingUnsavedRestore: false, hasUnsavedUserEditBeforePublish: false }).persist).toBe(false)
    })

    // ======================================================================
    // U-0c: ②復元フラグの寿命（盤面が未マウントのまま復元→教室切替した場合の残留）
    //
    // restoreUndoSnapshot は盤面以外（基本データの初期取込・開発者画面のバックアップ復元）からも
    // 起動できる。その場合は受動 publish が来ないためフラグが消費されず、次に開いた教室の盤面の
    // 正当な userInitiated:false publish が clean 化をスキップし、開いただけの教室が未保存扱いに
    // なって自動保存が走る（他教室データへの書き戻しリスク）。明示 clean 化経路で必ず落とす。
    // ======================================================================
    type LifecycleStep =
      | { type: 'undo-snapshot-restore' | 'snapshot-load' | 'classroom-switch' | 'user-switch' }
      | { type: 'board-publish'; userInitiated: boolean }

    function simulateRestoreFlag(steps: LifecycleStep[]): { pending: boolean; publishResults: Array<'clean' | 'dirty'> } {
      let pending = false
      const publishResults: Array<'clean' | 'dirty'> = []
      for (const step of steps) {
        if (step.type === 'board-publish') {
          const marking = resolveBoardStateChangeCleanMarking({ userInitiated: step.userInitiated, pendingUnsavedRestore: pending, hasUnsavedUserEditBeforePublish: false })
          publishResults.push(marking.markClean ? 'clean' : 'dirty')
          pending = resolveRestoreFlagLifecycle({ event: 'board-publish', pending, userInitiated: step.userInitiated }).pendingAfter
          continue
        }
        pending = resolveRestoreFlagLifecycle({ event: step.type, pending }).pendingAfter
      }
      return { pending, publishResults }
    }

    it('②復元[兄弟]: 教室切替・読込・ユーザー切替では復元フラグが消える（残留させない）', () => {
      expect(simulateRestoreFlag([{ type: 'undo-snapshot-restore' }, { type: 'classroom-switch' }]).pending).toBe(false)
      expect(simulateRestoreFlag([{ type: 'undo-snapshot-restore' }, { type: 'snapshot-load' }]).pending).toBe(false)
      expect(simulateRestoreFlag([{ type: 'undo-snapshot-restore' }, { type: 'user-switch' }]).pending).toBe(false)
    })

    it('②復元[兄弟]: 盤面未マウントで復元→後から盤面を開いた最初の受動 publish は clean 化しない（未保存のまま）', () => {
      const result = simulateRestoreFlag([
        { type: 'undo-snapshot-restore' },
        { type: 'board-publish', userInitiated: false },
        { type: 'board-publish', userInitiated: false },
      ])
      expect(result.publishResults).toEqual(['dirty', 'clean'])
      expect(result.pending).toBe(false)
    })

    it('②復元[兄弟]: 復元→教室切替のあと、切替先の盤面マウント publish は clean 化する（開いただけの教室を未保存にしない）', () => {
      const result = simulateRestoreFlag([
        { type: 'undo-snapshot-restore' },
        { type: 'classroom-switch' },
        { type: 'board-publish', userInitiated: false },
      ])
      expect(result.publishResults).toEqual(['clean'])
      expect(result.pending).toBe(false)
    })

    it('②復元[兄弟]: markStateLoadedClean が明示経路でフラグを落とす配線になっている（App 本体ロック）', () => {
      const markClean = sliceFunctionBody(appSource, 'const markStateLoadedClean = useCallback(', 'const applySnapshot = useCallback(')
      expect(markClean).toMatch(/pendingUnsavedUndoSnapshotRestoreRef\.current = resolveRestoreFlagLifecycle\(/)
      expect(markClean).toContain('event: lifecycleEvent')
      // 教室切替・ユーザー切替・読込はライフサイクルイベントを明示して呼ぶ
      expect(appSource).toContain("markStateLoadedClean(buildClassroomDataSignature(nextClassroom.data), 'classroom-switch')")
      expect(appSource).toContain("markStateLoadedClean(buildClassroomDataSignature(targetClassroom?.data), 'user-switch')")
      expect(appSource).toContain("markStateLoadedClean(buildClassroomDataSignature(sanitizedSnapshot), 'snapshot-load')")
    })

    it('handleBoardStateChange は resolveBoardStateChangeCleanMarking の裁定に従う（直書き分岐へ戻さない・App 本体ロック）', () => {
      const handler = sliceFunctionBody(appSource, 'const handleBoardStateChange = useCallback(', 'writePendingWorkspaceSnapshotForRemoteSync()')
      expect(handler).toContain('resolveBoardStateChangeCleanMarking({')
      expect(handler).toContain('pendingUnsavedRestore: pendingUnsavedUndoSnapshotRestoreRef.current')
      expect(handler).toContain('if (cleanMarking.markClean) markStateLoadedClean()')
      // 旧実装（userInitiated だけで clean 化を決める直書き分岐）へ戻っていないこと
      expect(handler).not.toMatch(/if \(!meta\.userInitiated\) \{[\s\S]*markStateLoadedClean\(\)/)
    })

    it('丸ごと振替[INV-03 兄弟]: 選択中に undo/redo すると振替元の選択モードが解除される', () => {
      const handleUndo = sliceFunctionBody(boardSource, 'const handleUndo = () => {', 'const handleRedo = () => {')
      const handleRedo = sliceFunctionBody(boardSource, 'const handleRedo = () => {', 'const handleBoardSort =')
      for (const body of [handleUndo, handleRedo]) {
        expect(body).toContain('setWholeDayTransferSourceDate(null)')
        expect(body).toContain('setTeacherMenu(null)')
      }
      // commitWeeks と同じ安全側の解除（INV-03: 古い振替元での誤実行防止）であること
      const commitWeeks = sliceFunctionBody(boardSource, 'const commitWeeks = (', 'committedBoardChangeVersionRef.current += 1')
      expect(commitWeeks).toContain('setWholeDayTransferSourceDate(null)')
    })
  })
})

// ============================================================================
// 行: 退塾生徒の剥がし(stripWithdrawnStudentsFromBoardWeek / remergeBoardWeekWithManagedData)
//   × 手動編集(出欠記録・manualTeacher・席入替/同日移動・振替元 tombstone・テンプレ固定日前の週)
//   オーナー決定 2026-09-15(確認リスト v1.5.527 b-2): 生徒の退塾日は「その日から非在籍」。
//   テンプレ由来の通常授業だけを max(退塾日, 今日[JST]) 以降で外す。手動編集の結果は巻き戻さない・消さない。
//   各行は「剥がすべき退塾生徒のテンプレ授業が外れる」assert を必ず含む(剥がしを外すと落ちる)。
// ============================================================================
describe('INV-02 × 退塾生徒の剥がし(手動編集は消さない・テンプレ由来だけ外す)', () => {
  const TODAY = '2026-06-01'
  const withdrawn = [{ id: 'sW', withdrawDate: TODAY }, { id: 'sB', withdrawDate: '' }]
  const managedLesson = (id: string, slots: [StudentEntry | null, StudentEntry | null]) => ({ id, note: '管理データ反映', studentSlots: slots })
  const regularOf = (managedStudentId: string, dateKey = TODAY, extra: Partial<StudentEntry> = {}) =>
    createStudent({ id: `${managedStudentId}_${dateKey}_数`, managedStudentId, name: managedStudentId, ...extra })
  const regularIn = (cells: SlotCell[], managedStudentId: string) => {
    const found: Array<{ cellId: string; deskId: string; student: StudentEntry }> = []
    for (const cell of cells) {
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (student && student.managedStudentId === managedStudentId) found.push({ cellId: cell.id, deskId: desk.id, student })
        }
      }
    }
    return found
  }

  it('出欠記録のある机で片側に退塾生徒の通常授業: 通常授業だけ外れ、出欠記録と講師は残る(再マージ後も)', () => {
    const board = [createCell({
      id: `${TODAY}_1`,
      desks: [createDesk({
        id: 'd0',
        teacher: '講師A',
        lesson: managedLesson(`managed_rW_${TODAY}`, [regularOf('sW'), null]),
        statusSlots: [null, createAttendedStatus({ id: 'status-sB', studentId: 'sB', managedStudentId: 'sB', name: 'sB' })],
      })],
    })]
    const stripped = stripWithdrawnStudentsFromBoardWeek(board, withdrawn, TODAY)
    expect(regularIn(stripped, 'sW')).toEqual([])
    expect(stripped[0].desks[0].statusSlots?.[1]?.managedStudentId).toBe('sB')
    expect(stripped[0].desks[0].teacher).toBe('講師A')
    const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(stripped[0])], [stripped])
    expect(regularIn([merged], 'sW')).toEqual([])
    expect(merged.desks[0].statusSlots?.[1]?.managedStudentId).toBe('sB')
    expect(merged.desks[0].teacher).toBe('講師A')
  })

  it('manualTeacher の机が退塾で空になっても講師は残る(非 manual の机は講師も外れる=INV-01 今日以降のみ)', () => {
    const board = [createCell({
      id: `${TODAY}_1`,
      desks: [
        createDesk({ id: 'd0', teacher: '講師M', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: managedLesson(`managed_rW_${TODAY}`, [regularOf('sW'), null]) }),
        createDesk({ id: 'd1', teacher: '講師T', teacherAssignmentTeacherId: 'tT', lesson: managedLesson(`managed_rW2_${TODAY}`, [regularOf('sW', TODAY, { id: 'sW_2', subject: '英' }), null]) }),
      ],
    })]
    const stripped = stripWithdrawnStudentsFromBoardWeek(board, withdrawn, TODAY)
    expect(regularIn(stripped, 'sW')).toEqual([])
    expect(stripped[0].desks[0]).toMatchObject({ teacher: '講師M', manualTeacher: true, teacherAssignmentSource: 'manual' })
    expect(stripped[0].desks[1].teacher).toBe('')
    const [merged] = overlayBoardWeeksOnScheduleCells([silentManagedCell(stripped[0])], [stripped])
    expect(merged.desks[0]).toMatchObject({ teacher: '講師M', manualTeacher: true })
  })

  it('同じコマ内の席入替・同日移動の後: 手で動かした退塾生徒は消さず、動かしていないテンプレ授業だけ外す', () => {
    const cell1 = createCell({
      id: `${TODAY}_1`,
      desks: [
        createDesk({ id: 'd0', teacher: '講師A', lesson: managedLesson(`managed_rW_${TODAY}`, [regularOf('sW'), null]) }),
        createDesk({ id: 'd1', teacher: '講師B', lesson: managedLesson(`managed_rB_${TODAY}`, [regularOf('sB'), null]) }),
        createDesk({ id: 'd2' }),
      ],
    })
    // 2 限: 退塾生徒の別科目のテンプレ授業(動かしていない＝剥がす対象)。
    const cell2 = createCell({
      id: `${TODAY}_2`, slotNumber: 2, slotLabel: '2限',
      desks: [createDesk({ id: 'e0', teacher: '講師C', lesson: managedLesson(`managed_rW3_${TODAY}`, [regularOf('sW', TODAY, { id: 'sW_eng', subject: '英' }), null]) }), createDesk({ id: 'e1' })],
    })
    for (const [label, deskIndex] of [['席入替', 1], ['同コマ空き机へ移動', 2]] as const) {
      const moved = computeStudentMove({
        weeks: [[cell1, cell2]], weekIndex: 0, cells: [cell1, cell2],
        movingStudentId: `sW_${TODAY}_数`, cellId: `${TODAY}_1`, deskIndex, studentIndex: 0, ...moveDefaults,
      })
      if (moved.status !== 'moved') throw new Error(`${label}: expected moved, got ${moved.status}`)
      const stripped = stripWithdrawnStudentsFromBoardWeek(moved.nextWeeks[0], withdrawn, TODAY)
      const remaining = regularIn(stripped, 'sW')
      // 手で動かした数学(sameDayMoveSourceDate 付き)は残り、動かしていない 2 限の英語テンプレ授業は外れる。
      expect(remaining.map((entry) => entry.student.subject), label).toEqual(['数'])
      expect(remaining[0].student.sameDayMoveSourceDate, label).toBe(TODAY)
      // 在籍生徒 B は入替/移動の結果どおり残る。
      expect(regularIn(stripped, 'sB'), label).toHaveLength(1)
    }
    // 同日の別コマ(3 限の空き机)へ移動した後も同じ。
    const cell3 = createCell({ id: `${TODAY}_3`, slotNumber: 3, slotLabel: '3限', desks: [createDesk({ id: 'f0' }), createDesk({ id: 'f1' })] })
    const movedOtherSlot = computeStudentMove({
      weeks: [[cell1, cell2, cell3]], weekIndex: 0, cells: [cell1, cell2, cell3],
      movingStudentId: `sW_${TODAY}_数`, cellId: `${TODAY}_3`, deskIndex: 0, studentIndex: 0, ...moveDefaults,
    })
    if (movedOtherSlot.status !== 'moved') throw new Error(`expected moved, got ${movedOtherSlot.status}`)
    const strippedOther = stripWithdrawnStudentsFromBoardWeek(movedOtherSlot.nextWeeks[0], withdrawn, TODAY)
    expect(regularIn(strippedOther, 'sW').map((entry) => `${entry.cellId}:${entry.student.subject}`)).toEqual([`${TODAY}_3:数`])
  })

  it('別の日から移動してきた生徒(prepareStudentForMove で makeup 扱い)は、退塾日以降の日付にあっても外さない', () => {
    // 退塾日=TODAY(6/1)。5/30 のテンプレ授業を手で 6/3 の在籍生徒 B の机へ移動する(＝振替扱い)。
    const sourceDate = '2026-05-30'
    const targetDate = '2026-06-03'
    const sourceCell = createCell({
      id: `${sourceDate}_1`, dateKey: sourceDate, dayLabel: '土', dateLabel: '5/30',
      desks: [createDesk({ id: 's0', teacher: '講師A', lesson: managedLesson(`managed_rW_${sourceDate}`, [regularOf('sW', sourceDate), null]) })],
    })
    // 6/2: 動かしていない退塾生徒のテンプレ授業(剥がす対象＝剥がしが効いていることの確認)。
    const untouchedCell = createCell({
      id: '2026-06-02_1', dateKey: '2026-06-02', dayLabel: '火', dateLabel: '6/2',
      desks: [createDesk({ id: 'u0', teacher: '講師C', lesson: managedLesson('managed_rW_2026-06-02', [regularOf('sW', '2026-06-02', { id: 'sW_2026-06-02_英', subject: '英' }), null]) })],
    })
    const targetCell = createCell({
      id: `${targetDate}_1`, dateKey: targetDate, dayLabel: '水', dateLabel: '6/3',
      desks: [createDesk({ id: 't0', teacher: '講師B', lesson: managedLesson(`managed_rB_${targetDate}`, [regularOf('sB', targetDate), null]) })],
    })
    const cells = [sourceCell, untouchedCell, targetCell]
    const moved = computeStudentMove({
      weeks: [cells], weekIndex: 0, cells,
      movingStudentId: `sW_${sourceDate}_数`, cellId: `${targetDate}_1`, deskIndex: 0, studentIndex: 1, ...moveDefaults,
    })
    if (moved.status !== 'moved') throw new Error(`expected moved, got ${moved.status}`)
    const before = regularIn(moved.nextWeeks[0], 'sW').find((entry) => entry.cellId === `${targetDate}_1`)
    // 前提: 移動先では makeup(振替元=5/30)として置かれている。
    expect(before?.student).toMatchObject({ lessonType: 'makeup', makeupSourceDate: sourceDate })

    const stripped = stripWithdrawnStudentsFromBoardWeek(moved.nextWeeks[0], withdrawn, TODAY)
    const remaining = regularIn(stripped, 'sW')
    // 移動してきた 6/3 の振替は残り、動かしていない 6/2 のテンプレ授業は外れる。
    expect(remaining.map((entry) => `${entry.cellId}:${entry.student.lessonType}`)).toEqual([`${targetDate}_1:makeup`])
    expect(regularIn(stripped, 'sB').map((entry) => entry.cellId)).toEqual([`${targetDate}_1`])
  })

  it('振替元 tombstone(suppressedRegularLessonOccurrences)がある日: 休の記録と抑止キーは残し、テンプレ授業は外し、再マージで湧かない', () => {
    const suppressedKey = `sW__数__${TODAY}__1`
    const board = [
      createCell({
        id: `${TODAY}_1`,
        desks: [createDesk({ id: 'd0', teacher: '講師A', statusSlots: [createAttendedStatus({ id: 'status-sW', studentId: 'sW', managedStudentId: 'sW', name: 'sW', status: 'absent' }), null] })],
      }),
      createCell({
        id: `${TODAY}_2`, slotNumber: 2, slotLabel: '2限',
        desks: [createDesk({ id: 'e0', teacher: '講師C', lesson: managedLesson(`managed_rW3_${TODAY}`, [regularOf('sW', TODAY, { id: 'sW_eng', subject: '英' }), null]) })],
      }),
    ]
    const stripped = stripWithdrawnStudentsFromBoardWeek(board, withdrawn, TODAY)
    expect(regularIn(stripped, 'sW')).toEqual([])
    expect(stripped[0].desks[0].statusSlots?.[0]).toMatchObject({ managedStudentId: 'sW', status: 'absent' })
    expect(stripped[0].desks[0].teacher).toBe('講師A')
    const merged = overlayBoardWeeksOnScheduleCells(stripped.map(silentManagedCell), [stripped], [suppressedKey])
    expect(regularIn(merged, 'sW')).toEqual([])
    expect(merged[0].desks[0].statusSlots?.[0]).toMatchObject({ managedStudentId: 'sW', status: 'absent' })
  })

  it('テンプレ固定日より前の週: 今日以降だけ外れ、昨日以前は残る(テンプレ再マージはしない=INV-10)', () => {
    const frozen: ClassroomSettings = { ...classroomSettings, templateFreezeBeforeDate: '2026-10-01' }
    // 月(6/1)〜土(6/6)。今日=6/3(水)、退塾日=6/2(火)。
    const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06']
    const week = days.map((dateKey) => createCell({
      id: `${dateKey}_1`, dateKey,
      desks: [createDesk({ id: `${dateKey}-d0`, teacher: '講師A', lesson: managedLesson(`managed_rW_${dateKey}`, [regularOf('sW', dateKey), null]) })],
    }))
    const result = remergeBoardWeekWithManagedData(week, {
      classroomSettings: frozen,
      teachers: [],
      students: [{ id: 'sW', name: 'sW', displayName: 'sW', email: '', entryDate: '2024-04-01', withdrawDate: '2026-06-02', birthDate: '2012-05-01' }],
      regularLessons: [],
      suppressedRegularLessonOccurrences: [],
      todayKey: '2026-06-03',
    })
    expect(regularIn(result, 'sW').map((entry) => entry.student.id.split('_')[1])).toEqual(['2026-06-01', '2026-06-02'])
    // 昨日以前のセルは同じ参照(触っていない)。
    expect(result[0]).toBe(week[0])
    expect(result[1]).toBe(week[1])
  })
})

// ============================================================================
// 行: 退塾スイープ(computeStudentWithdrawSweep) × 手動編集
//   オーナー確定 2026-09-20(確認リスト b-2 要改善): 「退塾」ボタンは名簿の退塾日を記録するだけでなく、
//   **その生徒の今日以降の盤面の痕跡**(手置きの講習・振替・増コマ・体験・手動追加・移動の席と出欠記録)も消す。
//   2026-09-20 夜 改定: 退塾ボタンだけでなく**日付入力で退塾日を入れた場合・未来の退塾日がその日を過ぎた場合**も
//   同じ消去が黙って走る。命令(キュー)ではなく盤面側の検出(collectStudentWithdrawSweepTargets)で起こす。
//   ここで固定するのは「消してよいものだけ消す」側 ＝ 他の生徒の手動編集・講師・メモ・**昨日以前**は不変で、
//   再マージを何回通しても結果が変わらないこと(INV-02/INV-03)。在庫側は INV-06 マトリクスが固定する。
// ============================================================================
describe('INV-02 × 退塾スイープ(今日以降だけ消す・他の手動編集と昨日以前は不変)', () => {
  const TODAY = '2026-06-03'
  const YESTERDAY = '2026-06-02'
  const roster: StudentRow[] = [
    { id: 'sW', name: 'sW', displayName: 'sW', email: '', entryDate: '2024-04-01', withdrawDate: TODAY, birthDate: '2012-05-01' },
    { id: 'sB', name: 'sB', displayName: 'sB', email: '', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2012-06-01' },
  ]
  const lessonOf = (id: string, slots: [StudentEntry | null, StudentEntry | null]) => ({ id, note: '', studentSlots: slots })
  const entryOf = (managedStudentId: string, overrides: Partial<StudentEntry> = {}) => createStudent({
    id: `${managedStudentId}_seat`, managedStudentId, name: managedStudentId, ...overrides,
  })
  const statusOf = (managedStudentId: string, overrides: Partial<StudentStatusEntry> = {}) => createAttendedStatus({
    id: `status_${managedStudentId}`, studentId: managedStudentId, managedStudentId, name: managedStudentId, ...overrides,
  })
  const tracesOf = (cells: SlotCell[], managedStudentId: string) => {
    const found: string[] = []
    for (const cell of cells) {
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (student?.managedStudentId === managedStudentId) found.push(`${cell.dateKey}:seat:${student.lessonType}`)
        }
        for (const entry of desk.statusSlots ?? []) {
          if (entry?.managedStudentId === managedStudentId) found.push(`${cell.dateKey}:status:${entry.status}`)
        }
      }
    }
    return found
  }
  const sweepFor = (weeks: SlotCell[][]) => computeStudentWithdrawSweep({
    weeks,
    students: roster,
    studentId: 'sW',
    fromDateKey: TODAY,
    suppressedMakeupOrigins: {},
    resolveStockId: (student) => student.managedStudentId ?? student.id,
  })

  it('手置きの講習・振替と出欠記録は今日以降だけ消え、他の生徒の手動編集・manualTeacher・メモ・昨日以前は残る', () => {
    const yesterdayCell = createCell({
      id: `${YESTERDAY}_1`, dateKey: YESTERDAY, dateLabel: '6/2',
      desks: [createDesk({
        id: 'y0', teacher: '講師A',
        lesson: lessonOf('lesson_y', [entryOf('sW', { id: 'sW_y', lessonType: 'special', specialSessionId: 'sess-1' }), null]),
        statusSlots: [null, statusOf('sW', { id: 'status_y', dateKey: YESTERDAY, status: 'absent' })],
      })],
    })
    const todayCell = createCell({
      id: `${TODAY}_1`, dateKey: TODAY, dateLabel: '6/3',
      desks: [
        createDesk({
          id: 't0', teacher: '講師M', manualTeacher: true, teacherAssignmentSource: 'manual', memoSlots: ['連絡事項', null],
          lesson: lessonOf('lesson_t0', [entryOf('sW', { id: 'sW_t0', lessonType: 'makeup', makeupSourceDate: '2026-05-20' }), entryOf('sB', { id: 'sB_t0' })]),
          statusSlots: [null, statusOf('sB', { id: 'status_sB', dateKey: TODAY })],
        }),
        createDesk({ id: 't1', teacher: '講師C', statusSlots: [statusOf('sW', { id: 'status_sW_today', dateKey: TODAY, status: 'moved' }), null] }),
      ],
    })
    const weeks = [[yesterdayCell, todayCell]]
    const result = sweepFor(weeks)

    expect(result.changed).toBe(true)
    // 今日以降の痕跡だけが消え、昨日のセルは**同じ参照**で残る。
    expect(tracesOf(result.nextWeeks[0], 'sW')).toEqual([`${YESTERDAY}:seat:special`, `${YESTERDAY}:status:absent`])
    expect(result.nextWeeks[0][0]).toBe(yesterdayCell)
    // 他の生徒の席・出欠記録・手動講師・メモは不変(INV-02/INV-01)。
    const sweptToday = result.nextWeeks[0][1]
    expect(tracesOf([sweptToday], 'sB')).toEqual([`${TODAY}:seat:regular`, `${TODAY}:status:attended`])
    expect(sweptToday.desks[0]).toMatchObject({ teacher: '講師M', manualTeacher: true, teacherAssignmentSource: 'manual' })
    expect(sweptToday.desks[0].memoSlots).toEqual(['連絡事項', null])
    expect(sweptToday.desks[1].teacher).toBe('講師C')
  })

  it('スイープ後にテンプレ再マージを 2 回通しても痕跡は湧かず、昨日以前の記録も消えない(INV-03)', () => {
    const yesterdayCell = createCell({
      id: `${YESTERDAY}_1`, dateKey: YESTERDAY, dateLabel: '6/2',
      desks: [createDesk({ id: 'y0', teacher: '講師A', statusSlots: [statusOf('sW', { id: 'status_y', dateKey: YESTERDAY, status: 'absent' }), null] })],
    })
    const todayCell = createCell({
      id: `${TODAY}_1`, dateKey: TODAY, dateLabel: '6/3',
      desks: [createDesk({
        id: 't0', teacher: '講師A',
        lesson: lessonOf('lesson_t0', [entryOf('sW', { id: 'sW_t0', lessonType: 'extra' }), null]),
        statusSlots: [null, statusOf('sW', { id: 'status_sW_today', dateKey: TODAY })],
      })],
    })
    const swept = sweepFor([[yesterdayCell, todayCell]]).nextWeeks[0]
    let merged = swept
    for (let pass = 0; pass < 2; pass += 1) {
      merged = overlayBoardWeeksOnScheduleCells(merged.map(silentManagedCell), [merged])
      expect(tracesOf(merged, 'sW')).toEqual([`${YESTERDAY}:status:absent`])
    }
    // 退塾生徒の剥がし(再マージの先頭で走る派生処理)を続けて通しても同じ。
    expect(tracesOf(stripWithdrawnStudentsFromBoardWeek(merged, roster, TODAY), 'sW')).toEqual([`${YESTERDAY}:status:absent`])
  })

  // 行(2026-09-20 夜・オーナー確定): 検出方式。**日付入力での退塾日**も退塾ボタンと同じ扱いで、盤面を開いた時点で
  // 黙って掃除する。逆に「掃除するものが無いのに盤面を書き換える」のは INV-02 違反(開いただけで未保存になり、
  // 室長の未保存編集が自動保存に巻き込まれる/「最新データ」の表示が嘘になる)ので、対象 0 を厳格に固定する。
  it('★日付入力で退塾日を入れた生徒も検出して掃除する(退塾ボタンと同じ扱い・命令は要らない)', () => {
    const todayCell = createCell({
      id: `${TODAY}_1`, dateKey: TODAY, dateLabel: '6/3',
      desks: [createDesk({
        id: 't0', teacher: '講師A',
        lesson: lessonOf('lesson_t0', [entryOf('sW', { id: 'sW_t0', lessonType: 'special', specialSessionId: 'sess-1' }), entryOf('sB', { id: 'sB_t0' })]),
      })],
    })
    // 退塾日は roster 上に入っているだけ(＝日付入力で入れた状態)。ボタン経由の命令は一切無い。
    const targets = collectStudentWithdrawSweepTargets({ weeks: [[todayCell]], students: roster, todayKey: TODAY })
    expect(targets).toEqual([{ studentId: 'sW', displayName: 'sW', fromDateKey: TODAY }])
    const swept = sweepFor([[todayCell]])
    expect(tracesOf(swept.nextWeeks[0], 'sW')).toEqual([])
    expect(tracesOf(swept.nextWeeks[0], 'sB')).toEqual([`${TODAY}:seat:regular`])
  })

  it('★INV-02: 掃除するものが無ければ何も返さない(盤面を開いただけで未保存にしない)', () => {
    // 昨日以前にしか痕跡が無い / 在籍中の生徒だけ / 未来の退塾日 のいずれも対象 0。
    const yesterdayOnly = createCell({
      id: `${YESTERDAY}_1`, dateKey: YESTERDAY, dateLabel: '6/2',
      desks: [createDesk({ id: 'y0', teacher: '講師A', lesson: lessonOf('lesson_y', [entryOf('sW', { id: 'sW_y' }), null]) })],
    })
    const stayingOnly = createCell({
      id: `${TODAY}_1`, dateKey: TODAY, dateLabel: '6/3',
      desks: [createDesk({ id: 't0', teacher: '講師A', lesson: lessonOf('lesson_t0', [entryOf('sB', { id: 'sB_t0' }), null]) })],
    })
    expect(collectStudentWithdrawSweepTargets({ weeks: [[yesterdayOnly, stayingOnly]], students: roster, todayKey: TODAY })).toEqual([])
    // 未来の退塾日はまだ在籍＝その日が来るまで触らない(痕跡は残したまま)。
    const futureRoster = roster.map((row) => (row.id === 'sW' ? { ...row, withdrawDate: '2026-07-01' } : row))
    const futureCell = createCell({
      id: '2026-07-02_2', dateKey: '2026-07-02', dateLabel: '7/2', slotNumber: 2,
      desks: [createDesk({ id: 't1', teacher: '講師A', lesson: lessonOf('lesson_t1', [entryOf('sW', { id: 'sW_t1' }), null]) })],
    })
    expect(collectStudentWithdrawSweepTargets({ weeks: [[futureCell]], students: futureRoster, todayKey: TODAY })).toEqual([])
    expect(collectStudentWithdrawSweepTargets({ weeks: [[futureCell]], students: futureRoster, todayKey: '2026-07-01' }))
      .toEqual([{ studentId: 'sW', displayName: 'sW', fromDateKey: '2026-07-01' }])
  })
})

// ============================================================================
// INV-02 × テンプレ差分反映の保留（2 行）の解決操作（Issue #72・第 1 段 (B)・spec-template-behavior Q26-6・条件 20）
//
// 採用ボタン（テンプレを採用／既存を採用）・下段の削除・下段の移動は、どれも純関数の結果を commitWeeks へ 1 回だけ渡す
// （版数 bump・userInitiated の publish・履歴 1 段＝ templatePendingBoard.wiring.test.ts で字面固定）。
// ここでは「戻す 1 回で操作前の盤面・保留マップ・台帳（希望回数を含む）へ完全に戻り、やり直しで再適用される」ことを、
// 操作前・操作後の状態から作った履歴エントリを applyHistoryEntry に通して固定する（commitWeeks が積むのと同じ形）。
// 純関数は入力（盤面・保留マップ・台帳）を書き換えない＝履歴に積んだ操作前の状態が操作で汚れない。
// ============================================================================
describe('INV-02 × 保留（2 行）の解決操作: 戻す 1 回で操作前へ、やり直しで再適用（条件 20・Q26-6）', () => {
  const DATE = '2026-06-01'
  const CELL = `${DATE}_1`
  const pendingKey = buildTemplatePendingDeskKey(CELL, 'q0')
  const baseLedgers: TemplatePendingResolutionLedgers = {
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    manualMakeupAdjustments: {},
    fallbackLectureStockStudents: {},
    fallbackMakeupStudents: {},
    suppressedMakeupOrigins: {},
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
  }
  const context = {
    managedStudentByAnyName: new Map<string, StudentRow>(),
    resolveDisplayName: (name: string) => name,
    resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name,
    ledgerOriginDatesByKey: {} as Record<string, string[]>,
  }
  const historyContext = { classroomSettings, groupClassEntries: {}, isLectureStockOpen: false, isMakeupStockOpen: false, studentScheduleRange: null, teacherScheduleRange: null }

  // 机 q0 = 上段 C（テンプレ）＋下段 A（在庫由来の振替）・メモ。机 q1 は空。
  function fixture() {
    const weeks: SlotCell[][] = [[createCell({
      id: CELL,
      dateKey: DATE,
      desks: [
        createDesk({ id: 'q0', teacher: '講師B', lesson: { id: 'managed_r0', studentSlots: [createStudent({ id: 'c-upper', name: '生徒C', managedStudentId: 'sC' }), null] } }),
        createDesk({ id: 'q1', teacher: '講師A' }),
      ],
    })]]
    const pending: TemplatePendingDeskMap = {
      [pendingKey]: {
        lower: {
          lesson: { id: 'lower', studentSlots: [createStudent({ id: 'a-lower', name: '生徒A', managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: '2026-05-25' }), null] },
          memoSlots: [null, '連絡'],
        },
        effectiveStartDate: DATE,
        createdAt: '2026-05-30T00:00:00.000Z',
      },
    }
    return { weeks, pending }
  }

  function entryOf(weeks: SlotCell[][], pending: TemplatePendingDeskMap, ledgers: TemplatePendingResolutionLedgers): HistoryEntry {
    return {
      weeks,
      weekIndex: 0,
      selectedCellId: CELL,
      selectedDeskIndex: 0,
      holidayDates: [],
      forceOpenDates: [],
      suppressedRegularLessonOccurrences: ledgers.suppressedRegularLessonOccurrences,
      scheduleCountAdjustments: ledgers.scheduleCountAdjustments,
      manualMakeupAdjustments: ledgers.manualMakeupAdjustments,
      suppressedMakeupOrigins: ledgers.suppressedMakeupOrigins,
      fallbackMakeupStudents: ledgers.fallbackMakeupStudents,
      manualLectureStockCounts: ledgers.manualLectureStockCounts,
      manualLectureStockOrigins: ledgers.manualLectureStockOrigins,
      fallbackLectureStockStudents: ledgers.fallbackLectureStockStudents,
      templatePendingDesks: pending,
    }
  }

  type Operation = { label: string; run: (weeks: SlotCell[][], pending: TemplatePendingDeskMap) => { nextWeeks: SlotCell[][]; nextTemplatePendingDesks: TemplatePendingDeskMap; ledgers: TemplatePendingResolutionLedgers } }
  const resolveOrThrow = (mode: 'adopt-template' | 'adopt-existing' | 'delete-lower-student', weeks: SlotCell[][], pending: TemplatePendingDeskMap) => {
    const r = computePendingDeskResolution({ mode, weeks, cellId: CELL, deskId: 'q0', lowerIndex: 0, templatePendingDesks: pending, ledgers: baseLedgers, ...context })
    if (r.status !== 'applied') throw new Error(r.message)
    return r
  }
  const operations: Operation[] = [
    { label: 'テンプレを採用', run: (weeks, pending) => resolveOrThrow('adopt-template', weeks, pending) },
    { label: '既存を採用（希望回数 −1 を含む）', run: (weeks, pending) => resolveOrThrow('adopt-existing', weeks, pending) },
    { label: '下段の削除', run: (weeks, pending) => resolveOrThrow('delete-lower-student', weeks, pending) },
    {
      label: '下段の移動',
      run: (weeks, pending) => {
        const r = computePendingLowerStudentMove({
          weeks, weekIndex: 0, cells: weeks[0], templatePendingDesks: pending,
          source: { cellId: CELL, deskId: 'q0', lowerIndex: 0 }, cellId: CELL, deskIndex: 1, studentIndex: 0,
          suppressedRegularLessonOccurrences: [], managedStudentByAnyName: new Map(), resolveBoardStudentDisplayName: (n: string) => n,
        })
        if (r.status !== 'moved') throw new Error(r.message)
        return { nextWeeks: r.nextWeeks, nextTemplatePendingDesks: r.nextTemplatePendingDesks, ledgers: baseLedgers }
      },
    },
  ]

  for (const operation of operations) {
    it(`${operation.label}: 入力を書き換えず、戻すで操作前（保留マップ・台帳ごと）へ、やり直しで操作後へ publish される`, () => {
      const { weeks, pending } = fixture()
      const before = JSON.stringify({ weeks, pending, baseLedgers })
      const result = operation.run(weeks, pending)
      expect(JSON.stringify({ weeks, pending, baseLedgers })).toBe(before)
      // この操作で保留は解けている（机は 1 行）
      expect(result.nextTemplatePendingDesks[pendingKey]).toBeUndefined()

      const undo = applyHistoryEntry(entryOf(weeks, pending, baseLedgers), historyContext).publishPayload
      expect(undo.templatePendingDesks).toEqual(pending)
      expect(undo.weeks[0][0].desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sC')
      expect(undo.scheduleCountAdjustments).toEqual([])
      expect(undo.suppressedRegularLessonOccurrences).toEqual([])

      const redo = applyHistoryEntry(entryOf(result.nextWeeks, result.nextTemplatePendingDesks, result.ledgers), historyContext).publishPayload
      expect('templatePendingDesks' in redo).toBe(false)
      // publish の週は教室の机数まで空机で埋まる（applyClassroomAvailability）ので、フィクスチャの机（q0・q1）だけ比べる。
      const seatsOf = (cellWeeks: SlotCell[][]) => cellWeeks[0][0].desks
        .filter((desk) => desk.id === 'q0' || desk.id === 'q1')
        .map((desk) => [desk.id, (desk.lesson?.studentSlots ?? []).map((student) => student?.managedStudentId ?? null), desk.memoSlots ?? null])
      expect(seatsOf(redo.weeks)).toEqual(seatsOf(result.nextWeeks))
      expect(redo.scheduleCountAdjustments).toEqual(result.ledgers.scheduleCountAdjustments)
    })
  }

  it('既存を採用の希望回数 −1 と抑止キーは、戻すで消え、やり直しで戻る（台帳ごと 1 段）', () => {
    const { weeks, pending } = fixture()
    const result = resolveOrThrow('adopt-existing', weeks, pending)
    expect(result.ledgers.scheduleCountAdjustments).toEqual([{ studentKey: 'sC', subject: '数', countKind: 'regular', dateKey: DATE, delta: -1 }])
    expect(result.ledgers.suppressedRegularLessonOccurrences).toHaveLength(1)
    const undo = applyHistoryEntry(entryOf(weeks, pending, baseLedgers), historyContext).publishPayload
    expect(undo.scheduleCountAdjustments).toEqual([])
    expect(undo.suppressedRegularLessonOccurrences).toEqual([])
    const redo = applyHistoryEntry(entryOf(result.nextWeeks, result.nextTemplatePendingDesks, result.ledgers), historyContext).publishPayload
    expect(redo.scheduleCountAdjustments).toEqual(result.ledgers.scheduleCountAdjustments)
    expect(redo.suppressedRegularLessonOccurrences).toEqual(result.ledgers.suppressedRegularLessonOccurrences)
    expect(redo.weeks[0][0].desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
  })
})

// ============================================================================
// INV-02 × 列「テンプレ差分反映」（Issue #72・機能フラグ templateDiffApply・regression-reviewer R-3）
//
// 保証（docs/spec-invariants.md INV-02「テンプレ差分反映での例外文言（改定）」）:
//   (1) 机の講師はテンプレ机の講師に揃う（テンプレ机に講師がいなければユーザーが置いた講師は残り、足場講師は外れる）。
//       QR 自動割振り講師は置き換えず、盤面で削除した講師（削除記録）は保存でも再マージでも戻らない。
//   (2) 生徒側に手入力の印の無い机だけ生徒がテンプレで置き換わる。講師の配置（手置き・QR）は印に数えない。講師系の印は削除記録だけ。
//   (3) 印のある机の生徒・出欠記録・メモは保存で消えない（机に残るか下段に残る。会計を持つ出欠記録は机に残す）。
// 行: 印を 1 種類ずつ × { テンプレ机に生徒なし（残す）/ テンプレ机に別の生徒（保留または即時合流）}・講師系の印・削除記録の机・休日のコマ・QR 講師。
// 各行で「保存 → 再マージ 2 回」を通し、保存の結果が再マージで書き換わらない（自動処理で巻き戻らない）ことも見る。
// 出典: templateDiffApply.test.ts の Q22（印）・条件 2〜8・21・22 を、保証の単位でここへ写した（経路テストは元ファイルにも残す）。
// ============================================================================
describe('INV-02 × テンプレ差分反映: 印のある机の中身は保存でも再マージでも消えない（列「テンプレ差分反映」）', () => {
  const WEEK_START = '2026-10-05'
  const WEEK_END = '2026-10-11'
  const DATE = '2026-10-07'
  const CELL = `${DATE}_5`
  const studentRows: StudentRow[] = [['sA', '青木'], ['sB', '馬場'], ['sC', '千葉'], ['sM', '三浦']].map(([id, name]) => ({
    id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01',
  }))
  const teacherRows: TeacherRow[] = [['t1', '田中'], ['t2', '鈴木'], ['t3', '佐藤'], ['t4', '高橋']].map(([id, name]) => ({
    id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
  }))
  const row = (id: string, teacherId: string, student1Id = ''): RegularLessonRow => ({
    id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id: '', subject2: '',
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5,
  })
  const diffSettings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, ...extra }) as ClassroomSettings
  // 旧テンプレ: 机0=田中(A)・机1=鈴木(B)・机2=佐藤(講師だけ)
  const OLD_ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3')]
  // 新テンプレ（机0 にテンプレの生徒 C＝中身が違う）／（机0 は講師だけ＝テンプレ机に生徒なし）
  //   （同じコマに同じ講師を 2 机置かない＝再マージの講師重複の整理と混ざらない形にする）
  const ROWS_WITH_C = [row('r0', 't2', 'sC'), row('r1', 't1', 'sB'), row('r2', 't3')]
  const ROWS_TEACHER_ONLY = [row('r0', 't3'), row('r1', 't2', 'sB'), row('r2', 't1')]
  const entry = (studentId: string, overrides: Partial<StudentEntry> = {}): StudentEntry => {
    const source = studentRows.find((item) => item.id === studentId)!
    return createStudent({ id: `${studentId}_board_${overrides.lessonType ?? 'regular'}`, name: source.name, managedStudentId: studentId, grade: '中2', ...overrides })
  }
  const record = (studentId: string, statusKind: StudentStatusEntry['status']): StudentStatusEntry => {
    const source = studentRows.find((item) => item.id === studentId)!
    return createAttendedStatus({ id: `status_${studentId}_${statusKind}`, studentId, name: source.name, managedStudentId: studentId, dateKey: DATE, slotNumber: 5, status: statusKind })
  }

  function board(update: (desk: DeskCell) => DeskCell, classroom = diffSettings(), deskIndex = 0) {
    const week = buildManagedScheduleCellsForRange({
      range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
      fallbackStartDate: WEEK_START,
      fallbackEndDate: WEEK_END,
      classroomSettings: classroom,
      teachers: teacherRows,
      students: studentRows,
      regularLessons: OLD_ROWS,
      boardWeeks: [],
    })
    return week.map((cell) => (cell.id !== CELL ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === deskIndex ? update(desk) : desk)) }))
  }

  // 保存本体（computeTemplateDiffApplyForBoard）→ 保存直後の再マージ 2 回（教室設定・通常授業の変更 effect と同じ合成関数）。
  // 休日のコマは、再マージが机の講師の手置き印を「未設定」で持つ（差分反映は false）ので、中身（講師・生徒・記録・メモ）で比べる。
  const contentOf = (cell: SlotCell) => cell.desks.map((desk) => ({
    id: desk.id, teacher: desk.teacher, manualTeacher: Boolean(desk.manualTeacher), source: desk.teacherAssignmentSource ?? null,
    students: (desk.lesson?.studentSlots ?? []).map((student) => (student ? `${student.managedStudentId}:${student.lessonType}` : null)),
    records: (desk.statusSlots ?? []).map((item) => (item ? `${item.managedStudentId}:${item.status}` : null)),
    memos: desk.memoSlots ?? null,
  }))
  function saveAndRemerge(week: SlotCell[], rows: RegularLessonRow[], options: { suppressed?: string[]; classroom?: ClassroomSettings; compare?: 'strict' | 'content' } = {}) {
    const classroom = options.classroom ?? diffSettings({ templateFreezeBeforeDate: DATE })
    const saved = computeTemplateDiffApplyForBoard({
      weeks: [week], classroomSettings: classroom, teachers: teacherRows, students: studentRows, regularLessons: rows,
      effectiveStartDate: DATE, suppressedRegularLessonOccurrences: options.suppressed ?? [], templatePendingDesks: {}, createdAt: '2026-09-29T10:00:00.000Z',
    })
    const suppressed = [...(options.suppressed ?? []), ...saved.addedSuppressedRegularLessonOccurrences]
    const remerge = (weeks: SlotCell[][]) => remergeBoardWeeksWithManagedData(weeks, {
      classroomSettings: classroom, teachers: teacherRows, students: studentRows, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: '2026-09-29',
    })
    const once = remerge(saved.nextWeeks)
    const twice = remerge(once)
    const cellOf = (weeks: SlotCell[][]) => weeks.flat().find((cell) => cell.id === CELL)!
    // 再マージで巻き戻らない＝保存の結果が不動点
    if (options.compare === 'content') {
      expect(contentOf(cellOf(once))).toEqual(contentOf(cellOf(saved.nextWeeks)))
      expect(contentOf(cellOf(twice))).toEqual(contentOf(cellOf(saved.nextWeeks)))
    } else {
      expect(cellOf(once)).toEqual(cellOf(saved.nextWeeks))
      expect(cellOf(twice)).toEqual(cellOf(saved.nextWeeks))
    }
    const desk0 = cellOf(saved.nextWeeks).desks[0]
    return { saved, desk0, lower: saved.nextPendingDesks[buildTemplatePendingDeskKey(CELL, desk0.id)]?.lower }
  }
  const liveIds = (lesson: DeskCell['lesson'] | undefined) => (lesson?.studentSlots ?? []).filter(Boolean).map((student) => student!.managedStudentId)
  const statusKinds = (slots: DeskCell['statusSlots'] | undefined) => (slots ?? []).filter(Boolean).map((item) => item!.status)
  const memos = (slots: DeskCell['memoSlots'] | undefined) => (slots ?? []).filter((memo) => typeof memo === 'string' && memo.trim() !== '')

  // 生徒単位の印（1 種類ずつ・生徒 M を机 0 に置く。旧テンプレの A は外した形）
  const studentMarks: Array<[string, Partial<StudentEntry>]> = [
    ['種別 振替（makeup）', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }],
    ['種別 講習（special）', { lessonType: 'special', specialSessionId: 'ss1', specialStockSource: 'session' }],
    ['種別 体験（trial）', { lessonType: 'trial' }],
    ['種別 増コマ（extra）', { lessonType: 'extra' }],
    ['手動追加（manualAdded）', { manualAdded: true }],
    ['同日移動（sameDayMoveSourceDate）', { sameDayMoveSourceDate: DATE, sameDayMoveSourceLabel: '10/7(水) 4限' }],
    ['別日移動（makeupSourceDate）', { makeupSourceDate: '2026-09-30' }],
  ]

  describe.each(studentMarks)('生徒の印 %s', (_label, overrides) => {
    const markedDesk = (desk: DeskCell): DeskCell => ({ ...desk, lesson: { id: `${desk.id}_hand`, studentSlots: [entry('sM', overrides), null] } })

    it('テンプレ机に生徒なし → 1 行で残る（講師はテンプレの講師）', () => {
      const { saved, desk0, lower } = saveAndRemerge(board(markedDesk), ROWS_TEACHER_ONLY)
      expect(liveIds(desk0.lesson)).toEqual(['sM'])
      expect(desk0.teacher).toBe('佐藤')
      expect(lower).toBeUndefined()
      expect(saved.summary.kept).toBeGreaterThanOrEqual(1)
    })

    it('テンプレ机に別の生徒 → 保留の下段に残る（上段はテンプレの生徒）', () => {
      const { desk0, lower } = saveAndRemerge(board(markedDesk), ROWS_WITH_C)
      expect(liveIds(desk0.lesson)).toEqual(['sC'])
      expect(liveIds(lower?.lesson)).toEqual(['sM'])
    })
  })

  // 席ごと（オーナー指示 2026-09-30・確認リスト v1.5.572 その他欄「生徒 1 と生徒 2 の重複は別々で処理して」）:
  // 旧テンプレの A（印なし）が生徒 1、印のある M が生徒 2 の机。テンプレの生徒 2 の席が空なら M は 1 行のまま残り（保留にしない）、
  // 生徒 1 は印が無いのでテンプレで置き換わる／同じ A なら採用。再マージ 2 回でも変わらない（saveAndRemerge が不動点を見る）。
  // 例外: テンプレの授業に同居させると再マージで落ちる印（別日移動の通常授業＝元の日付でない makeupSourceDate）は下段へ入れる。
  const DROPPED_BY_REMERGE_IN_MANAGED_LESSON = new Set(['別日移動（makeupSourceDate）'])
  const ROWS_SAME_A_NEW_TEACHER = [row('r0', 't2', 'sA'), row('r1', 't1', 'sB'), row('r2', 't3')]
  describe.each(studentMarks)('席ごと: 生徒の印 %s を生徒 2 の席に（生徒 1 は旧テンプレの A）', (label, overrides) => {
    const markedSeat2 = (desk: DeskCell): DeskCell => ({ ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], entry('sM', overrides)] } })
    it.each([
      ['テンプレの生徒 1 が別の生徒 C（生徒 2 は空）', ROWS_WITH_C, 'sC'],
      ['テンプレの生徒 1 が同じ A（講師だけ交代・生徒 2 は空）', ROWS_SAME_A_NEW_TEACHER, 'sA'],
    ] as const)('%s → 生徒 2 の M は 1 行のまま残る（保留にしない）', (_case, rows, seat1) => {
      const { saved, desk0, lower } = saveAndRemerge(board(markedSeat2), rows)
      expect(desk0.teacher).toBe('鈴木')
      if (DROPPED_BY_REMERGE_IN_MANAGED_LESSON.has(label)) {
        expect(liveIds(desk0.lesson)).toEqual([seat1])
        expect(liveIds(lower?.lesson)).toEqual(['sM'])
        return
      }
      expect(desk0.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([seat1, 'sM'])
      expect(lower).toBeUndefined()
      expect(saved.summary.pending).toBe(0)
      expect(saved.summary.seatMerged).toBe(1)
    })

    it('テンプレが生徒 1・生徒 2 の両方を埋める → 生徒 2 の席だけ保留（下段は M だけ・生徒 1 の A は下段に入れない）', () => {
      const bothSeats = [{ ...row('r0', 't2', 'sA'), student2Id: 'sC', subject2: '数' }, row('r1', 't1', 'sB'), row('r2', 't3')]
      const { desk0, lower } = saveAndRemerge(board(markedSeat2), bothSeats)
      expect(liveIds(desk0.lesson)).toEqual(['sA', 'sC'])
      expect(lower?.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sM'])
    })
  })

  describe.each(['absent', 'absent-no-makeup', 'attended'] as const)('机の印 会計を持つ出欠記録 %s', (statusKind) => {
    const markedDesk = (desk: DeskCell): DeskCell => ({ ...desk, lesson: undefined, statusSlots: [record('sA', statusKind), null] })
    it.each([['テンプレ机に生徒なし', ROWS_TEACHER_ONLY], ['テンプレ机に別の生徒', ROWS_WITH_C]] as const)('%s → 記録は机に残る（下段へ入れない）', (_label, rows) => {
      const { desk0, lower } = saveAndRemerge(board(markedDesk), rows, { suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, 5)] })
      expect(statusKinds(desk0.statusSlots)).toEqual([statusKind])
      expect(lower?.statusSlots ?? null).toBeNull()
    })
  })

  describe.each(['moved', 'holiday'] as const)('机の印 表示専用の出欠記録 %s', (statusKind) => {
    const markedDesk = (desk: DeskCell): DeskCell => ({ ...desk, lesson: undefined, statusSlots: [record('sA', statusKind), null] })
    it('テンプレ机に生徒なし → 記録は机に残る', () => {
      const { desk0 } = saveAndRemerge(board(markedDesk), ROWS_TEACHER_ONLY, { suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, 5)] })
      expect(statusKinds(desk0.statusSlots)).toEqual([statusKind])
    })
    it('テンプレ机に別の生徒・生きている生徒なし → その場で 1 行（表示専用の記録は会計を持たないので捨てる＝Q28-6・Q28-3）', () => {
      const { saved, desk0, lower } = saveAndRemerge(board(markedDesk), ROWS_WITH_C, { suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, 5)] })
      expect(liveIds(desk0.lesson)).toEqual(['sC'])
      expect(statusKinds(desk0.statusSlots)).toEqual([])
      expect(lower).toBeUndefined()
      expect(saved.summary.collapsedOnCreate).toBe(1)
    })
  })

  describe('机の印 メモ', () => {
    const markedDesk = (desk: DeskCell): DeskCell => ({ ...desk, lesson: undefined, memoSlots: ['連絡', null] })
    it.each([['テンプレ机に生徒なし', ROWS_TEACHER_ONLY], ['テンプレ机に別の生徒（即時合流でメモは空いた席へ）', ROWS_WITH_C]] as const)('%s → メモは机に残る', (_label, rows) => {
      const { desk0, lower } = saveAndRemerge(board(markedDesk), rows, { suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, 5)] })
      expect(memos(desk0.memoSlots)).toEqual(['連絡'])
      expect(lower).toBeUndefined()
    })
  })

  describe('机の印 その日の通常授業の削除記録（抑止キー）', () => {
    const suppressed = [buildManagedOccurrenceKey(entry('sA'), DATE, 5)]
    it('テンプレ机（抑止前）の生徒が削除済み → 印ありとして扱い、削除した A は湧かない。新テンプレの別の生徒は空いた机に即時合流で載る', () => {
      const { saved, desk0, lower } = saveAndRemerge(board((desk) => ({ ...desk, lesson: undefined })), [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3')], { suppressed })
      expect(liveIds(desk0.lesson)).toEqual([])
      expect(lower).toBeUndefined()
      expect(saved.summary.replaced).toBe(0)
    })
  })

  describe('講師系の印は削除記録だけ（講師の配置は印に数えない）', () => {
    it.each([
      ['手置き（manual）', { manualTeacher: true, teacherAssignmentSource: 'manual' as const }],
      ['入替（manual-replaced）', { manualTeacher: true, teacherAssignmentSource: 'manual-replaced' as const }],
    ])('講師 %s だけの机 → 印なし＝生徒はテンプレで置き換わり、講師はテンプレ机の講師に揃う', (_label, teacherFields) => {
      const { desk0, lower } = saveAndRemerge(board((desk) => ({ ...desk, teacher: '佐藤', ...teacherFields })), ROWS_WITH_C)
      expect(liveIds(desk0.lesson)).toEqual(['sC'])
      expect(desk0.teacher).toBe('鈴木')
      expect(desk0.manualTeacher).toBe(false)
      expect(lower).toBeUndefined()
    })

    it('QR 自動割振り講師だけの机 → 印なし＝生徒は置き換わるが、講師は置き換えず QR 講師（由来・講習期間 ID）のまま（例外 1）', () => {
      const { saved, desk0, lower } = saveAndRemerge(board((desk) => ({ ...desk, teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 't4' })), ROWS_WITH_C)
      expect(liveIds(desk0.lesson)).toEqual(['sC'])
      expect(desk0).toMatchObject({ teacher: '高橋', teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1' })
      expect(lower).toBeUndefined()
      expect(saved.summary.qrTeacherKept).toBe(1)
    })

    it('講師の削除記録の机 → 印あり。テンプレ机に講師がいても講師欄は削除のまま（例外 2）・再マージでも戻らない', () => {
      const tombstone = (desk: DeskCell): DeskCell => ({ ...desk, teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: 't1', lesson: undefined })
      const teacherOnly = saveAndRemerge(board(tombstone), ROWS_TEACHER_ONLY, { suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, 5)] })
      expect(teacherOnly.desk0).toMatchObject({ teacher: '', teacherAssignmentSource: 'deleted' })
      const withStudent = saveAndRemerge(board(tombstone), ROWS_WITH_C, { suppressed: [buildManagedOccurrenceKey(entry('sA'), DATE, 5)] })
      expect(withStudent.desk0).toMatchObject({ teacher: '', teacherAssignmentSource: 'deleted' })
      expect(liveIds(withStudent.desk0.lesson)).toEqual(['sC'])
      expect(withStudent.saved.summary.deletedTeacherDeskFilled).toBe(1)
    })

    it('削除記録だけの空き机で、テンプレ机も空 → 削除記録を外す（従来どおり・Q21-3 の 5 行目）', () => {
      // 机 2（旧テンプレでは講師だけの机）を削除記録にし、新テンプレは 2 行だけ（机 2 は空）。
      const tombstone = (desk: DeskCell): DeskCell => ({ ...desk, teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', lesson: undefined })
      const { saved } = saveAndRemerge(board(tombstone, diffSettings(), 2), [row('r0', 't1', 'sA'), row('r1', 't2', 'sB')])
      const desk2 = saved.nextWeeks.flat().find((cell) => cell.id === CELL)!.desks[2]
      expect(desk2.teacherAssignmentSource).toBeUndefined()
      expect(desk2.teacher).toBe('')
      expect(saved.summary.tombstoneCleared).toBe(1)
    })
  })

  describe('QR 講師の机が保留（2 行）になっても講師は QR のまま・下段は講師を持たない', () => {
    it('再マージ 2 回でも QR 講師が別の机へ動かず、講師も入れ替わらない', () => {
      const { desk0, lower, saved } = saveAndRemerge(board((desk) => ({
        ...desk, teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 't4',
        lesson: { id: `${desk.id}_special`, studentSlots: [entry('sM', { lessonType: 'special', specialSessionId: 'ss1', specialStockSource: 'session' }), null] },
      })), ROWS_WITH_C)
      expect(desk0.teacher).toBe('高橋')
      expect(liveIds(lower?.lesson)).toEqual(['sM'])
      expect(lower).not.toHaveProperty('teacher')
      expect(saved.nextWeeks.flat().find((cell) => cell.id === CELL)!.desks.filter((desk) => desk.teacher === '高橋')).toHaveLength(1)
    })
  })

  // 旧・既知の穴（2026-09-29 R-3 のマトリクス作成で判明）: 机に残した QR 講師／手置き講師／削除記録の講師名と同じ講師が、
  // 新テンプレの**別の机に講師だけ**で居ると、差分反映はその足場講師を置くが、再マージ（mergeManagedWeek の「同じコマに既に居る講師・
  // 削除した講師は足さない」）が外すため、保存の結果が再マージの不動点にならなかった（中身は失われない・保存直後の effect で足場講師が外れるだけ）。
  // 2026-09-30（regression-reviewer L-7 兄弟 2）: 差分反映の入口が保存結果へ再マージの重ね合わせを 1 回当てるようにしたので、保存の時点で
  // 足場講師は外れた形になる（保存直後の effect の結果と同じ＝利用者に見える結果は従来と同じ）。saveAndRemerge が再マージ 2 回の不動点を検査する。
  it('QR 講師と同名のテンプレ足場講師（講師だけの机）が同じコマの別の机にあっても、保存結果が再マージの不動点になる（足場講師は置かず QR 講師は 1 人のまま）', () => {
    const qrDesk = (desk: DeskCell): DeskCell => ({
      ...desk, teacher: '田中', manualTeacher: true, teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1', teacherAssignmentTeacherId: 't1',
      lesson: { id: `${desk.id}_special`, studentSlots: [entry('sM', { lessonType: 'special', specialSessionId: 'ss1', specialStockSource: 'session' }), null] },
    })
    // 新テンプレ: 机 0＝佐藤（講師だけ）・机 1＝鈴木（B）・机 2＝田中（講師だけ）→ 机 0 の QR 講師 田中と同名の足場講師が机 2 に来る。
    const { saved, desk0 } = saveAndRemerge(board(qrDesk), ROWS_TEACHER_ONLY)
    expect(desk0).toMatchObject({ teacher: '田中', teacherAssignmentSource: 'schedule-registration', teacherAssignmentSessionId: 'ss1' })
    expect(liveIds(desk0.lesson)).toEqual(['sM'])
    expect(saved.nextWeeks.flat().find((cell) => cell.id === CELL)!.desks.filter((desk) => desk.teacher === '田中')).toHaveLength(1)
  })

  describe('休日のコマ（テンプレ机を空とみなす・Q21-6）', () => {
    it('印ありの机の会計記録は残り、印なしの机は空席になる（再マージでも変わらない）', () => {
      const holiday = diffSettings({ templateFreezeBeforeDate: DATE, holidayDates: [DATE] })
      const week = board((desk) => desk).map((cell) => (cell.id !== CELL ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 1 ? { ...desk, lesson: undefined, statusSlots: [record('sB', 'absent'), null] as DeskCell['statusSlots'] } : desk)) }))
      const { saved } = saveAndRemerge(week, OLD_ROWS, { classroom: holiday, compare: 'content' })
      const cell = saved.nextWeeks.flat().find((item) => item.id === CELL)!
      expect(cell.isOpenDay).toBe(false)
      expect(liveIds(cell.desks[0].lesson)).toEqual([])
      expect(statusKinds(cell.desks[1].statusSlots)).toEqual(['absent'])
    })
  })
})

// ============================================================================
// INV-02 × 列「保留中の自動処理」（Issue #72・spec-template-behavior Q31・regression-reviewer R-3）
//
// 保証（INV-02 改定文言の末尾）: 保留の下段は明示の解決操作でしか消えず、再マージ・詰め直し・講習の講師自動割当・QR 提出講師の自己修復・
// 週トリム・リロードで消えも変わりもしない。保留マップのキーは机 ID なので、「保留の机の講師・位置・ID を動かさない」ことが下段を守ることになる。
// 行: 詰め直し（repackTeacherOnlyDesks）・講習の講師自動割当（applyTeacherAutoAssignRequest）・QR 自己修復（reconcileSubmittedTeacherPlacements）・
//     詰め替え（packSortCellDesks）・同席番並べ替え（seatSortCells）・週トリム（trimBoardWeeksForMemory）。
// 各行の最後で「保留マップを渡さない（固定しない）と保留の机が動く」ことも確かめる（ガードが効いている証拠）。
// 出典: templatePendingPeripherals.test.ts の該当ケースを保証の単位でここへ写した（経路テストは元ファイルにも残す）。
// ============================================================================
describe('INV-02 × 保留中の自動処理: 保留の机（講師・位置・ID）を触らない（列「保留中の自動処理」）', () => {
  const DATE = '2026-10-07'
  const CELL = `${DATE}_5`
  const lowerStudent = createStudent({ id: 'm-lower', name: '生徒M', managedStudentId: 'sM', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
  // 机1 = 保留の机（上段の生徒なし・講師なし）・机2 = 手置き講師だけ・机3 = 空。
  function stuckPendingCell(): { cell: SlotCell; map: TemplatePendingDeskMap } {
    const cell = createCell({
      id: CELL, dateKey: DATE, slotNumber: 5,
      desks: [
        createDesk({ id: `${CELL}_desk_1`, teacher: '', memoSlots: ['上段のメモ', '上段のメモ2'] }),
        createDesk({ id: `${CELL}_desk_2`, teacher: '鈴木', manualTeacher: true, teacherAssignmentSource: 'manual' }),
        createDesk({ id: `${CELL}_desk_3`, teacher: '' }),
      ],
    })
    const map: TemplatePendingDeskMap = {
      [buildTemplatePendingDeskKey(CELL, `${CELL}_desk_1`)]: { lower: { lesson: { id: 'lower', studentSlots: [lowerStudent, null] }, memoSlots: ['下段のメモ', null] }, effectiveStartDate: DATE, createdAt: '2026-09-29T10:00:00.000Z' },
    }
    return { cell, map }
  }
  const occupiedThirdDesk = (cell: SlotCell): SlotCell => ({ ...cell, desks: [cell.desks[0], cell.desks[1], { ...cell.desks[2], teacher: '田中', lesson: { id: 'x', studentSlots: [createStudent({ id: 'a', managedStudentId: 'sA' }), null] } }] })
  const sato: TeacherRow = { id: 't3', name: '佐藤', email: 't3@example.com', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] }
  const session = (): SpecialSessionRow => ({
    id: 'ss1', label: '秋期講習', startDate: DATE, endDate: DATE,
    teacherInputs: { t3: { unavailableSlots: [], countSubmitted: true, updatedAt: '' } }, studentInputs: {}, createdAt: '', updatedAt: '',
  }) as unknown as SpecialSessionRow
  const settingsFor = { ...classroomSettings, deskCount: 3, closedWeekdays: [] } as ClassroomSettings

  it('詰め直し: 保留の机は講師の入れ先にならず、机に居る講師も抜かれない（固定しないと保留の机の講師が先頭へ詰められる）', () => {
    const { cell, map } = stuckPendingCell()
    const withTeacher = [cell.desks[1], { ...cell.desks[0], teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual' as const }, cell.desks[2]]
    const withoutDeskTwoTeacher = [{ ...withTeacher[0], teacher: '', manualTeacher: false, teacherAssignmentSource: undefined }, withTeacher[1], withTeacher[2]]
    const locked = repackTeacherOnlyDesks(withoutDeskTwoTeacher, collectTemplatePendingDeskIdsInCell(map, CELL))
    expect(locked[1]).toBe(withoutDeskTwoTeacher[1])
    expect(locked.map((desk) => desk.teacher)).toEqual(['', '佐藤', ''])
    expect(repackTeacherOnlyDesks(withoutDeskTwoTeacher).map((desk) => desk.teacher)).toEqual(['佐藤', '', ''])
    // 保留の机（上段が空）に講師を詰め込まない
    const repacked = repackTeacherOnlyDesks(cell.desks, collectTemplatePendingDeskIdsInCell(map, CELL))
    expect(repacked[0]).toBe(cell.desks[0])
  })

  it('講習の講師自動割当: 空き机が保留の机だけなら置かない（渡さないと保留の机に置いてしまう）', () => {
    const { cell, map } = stuckPendingCell()
    const params = { weeks: [[occupiedThirdDesk(cell)]], items: [{ sessionId: 'ss1', teacherId: 't3', mode: 'assign' as const }], specialSessions: [session()], teachers: [sato], students: [], regularLessons: [], classroomSettings: settingsFor }
    const locked = applyTeacherAutoAssignRequest({ ...params, templatePendingDesks: map })
    expect(locked.nextWeeks[0][0].desks[0].teacher).toBe('')
    expect(locked.hasChanges).toBe(false)
    expect(applyTeacherAutoAssignRequest(params).nextWeeks[0][0].desks[0].teacher).toBe('佐藤')
  })

  it('QR 提出講師の自己修復: 上段の空いた保留の机は置き先にしない（渡さないと置いてしまう）', () => {
    const { cell, map } = stuckPendingCell()
    const params = { weeks: [[occupiedThirdDesk(cell)]], specialSessions: [session()], teachers: [sato], students: [], regularLessons: [], classroomSettings: settingsFor }
    const locked = reconcileSubmittedTeacherPlacements({ ...params, templatePendingDesks: map })
    expect(locked.placedCount).toBe(0)
    expect(locked.nextWeeks[0][0].desks[0].teacher).toBe('')
    expect(reconcileSubmittedTeacherPlacements(params).nextWeeks[0][0].desks[0].teacher).toBe('佐藤')
  })

  it('詰め替え: 保留の机はその位置・その ID・中身のまま（固定しないと先頭へ動き ID が付け替わる）', () => {
    const pendingDesk = createDesk({ id: `${CELL}_desk_3`, teacher: '鈴木', lesson: { id: 'p', studentSlots: [null, createStudent({ id: 'c', managedStudentId: 'sC' })] } })
    const cell = createCell({ id: CELL, dateKey: DATE, slotNumber: 5, desks: [createDesk({ id: `${CELL}_desk_1` }), createDesk({ id: `${CELL}_desk_2`, teacher: '田中' }), pendingDesk] })
    const packed = packSortCellDesks(cell, { skipStatusSlotPack: true, lockedDeskIds: new Set([pendingDesk.id]) })
    expect(packed[2]).toBe(pendingDesk)
    expect(packed.map((desk) => desk.id)).toEqual([`${CELL}_desk_1`, `${CELL}_desk_2`, `${CELL}_desk_3`])
    const unlocked = packSortCellDesks(cell, { skipStatusSlotPack: true })
    expect(unlocked[0].teacher).toBe('鈴木')
  })

  it('同席番並べ替え: 保留の机は今の席・今の ID のまま（固定しないと動く）', () => {
    const lessonOf = (id: string) => ({ id: `l_${id}`, studentSlots: [createStudent({ id, managedStudentId: id }), null] as [StudentEntry | null, StudentEntry | null] })
    const cell1 = createCell({ id: `${DATE}_4`, dateKey: DATE, slotNumber: 4, desks: [createDesk({ id: `${DATE}_4_desk_1`, teacher: '馬場先生', lesson: lessonOf('sB') }), createDesk({ id: `${DATE}_4_desk_2`, teacher: '青木先生', lesson: lessonOf('sA') })] })
    const cell2 = createCell({ id: `${DATE}_5`, dateKey: DATE, slotNumber: 5, desks: [createDesk({ id: `${DATE}_5_desk_1`, teacher: '青木先生', lesson: lessonOf('sC') }), createDesk({ id: `${DATE}_5_desk_2`, teacher: '馬場先生', lesson: lessonOf('sD') })] })
    const pendingId = `${DATE}_4_desk_2`
    const locked = seatSortCells([cell1, cell2], { skipStatusSlotPack: true, resolveLockedDeskIds: (cellId) => (cellId === cell1.id ? new Set([pendingId]) : undefined) })
    expect(locked[0].desks[1]).toBe(cell1.desks[1])
    expect(locked[0].desks.map((desk) => desk.id)).toEqual([`${DATE}_4_desk_1`, pendingId])
    expect(seatSortCells([cell1, cell2], { skipStatusSlotPack: true })[0].desks[0].teacher).toBe('青木先生')
  })

  it('週トリム: 手動編集の無い遠い週でも、保留のコマを含む週は破棄しない（守らないと破棄される）', () => {
    const plainCell = (id: string, dateKey: string) => createCell({ id, dateKey, desks: [createDesk({ id: `${id}_desk_1` })] })
    const near = [plainCell('2026-09-30_5', '2026-09-30')]
    const farPending = [plainCell('2027-06-02_5', '2027-06-02')]
    const farPlain = [plainCell('2027-06-09_5', '2027-06-09')]
    const pending: TemplatePendingDeskMap = { [buildTemplatePendingDeskKey('2027-06-02_5', '2027-06-02_5_desk_1')]: { lower: { memoSlots: ['x', null] }, effectiveStartDate: '2027-06-02', createdAt: 'x' } }
    const referenceDate = new Date('2026-09-29T00:00:00')
    expect(trimBoardWeeksForMemory([near, farPending, farPlain], { referenceDate, protectedCellIds: collectTemplatePendingCellIds(pending) })).toEqual([near, farPending])
    expect(trimBoardWeeksForMemory([near, farPending, farPlain], { referenceDate })).toEqual([near])
  })
})
