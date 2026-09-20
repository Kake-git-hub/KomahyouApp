import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
  applyUserDeletedTeacherTombstone,
  computeStudentMove,
  applyHistoryEntry,
  remergeBoardWeekWithManagedData,
  stripWithdrawnStudentsFromBoardWeek,
  type HistoryEntry,
} from './ScheduleBoardScreen'
import { hasUnsavedUserEditBeforeBoardPublish, resolveBoardStateChangeCleanMarking, resolveRestoreFlagLifecycle } from '../../App'
import { resolveSelectedLecturePlacementItem } from './lectureStockPlacement'

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
