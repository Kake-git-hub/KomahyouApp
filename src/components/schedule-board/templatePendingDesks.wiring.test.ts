// テンプレ差分反映の保留マップ（templatePendingDesks）の配線テスト（spec-template-behavior §H Q24-3・Q24-4・Q33-3）。
//
// 新フィールドは groupClassEntries と同じ流儀で全経路に通す必要があり、1 つ漏れると**黙って消える**
// （spec-makeup-stock.md §B-2-3 の教訓「専用フィールドは約 40 箇所の配線が要る」）。
// ここでは「保存 → 読込（JSON・初期スナップショット）→ publish → undo/redo」の往復で deep-equal に残ることと、
// 描画テスト環境の無い経路（publish の各呼び出し・App の署名・週トリム・在庫の走査）を字面で固定する。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AppSnapshot, ClassroomSettings, PersistedBoardState } from '../../types/appState'
import type { SlotCell } from './types'
import { applyHistoryEntry, createInitialBoardSnapshot, type HistoryEntry } from './ScheduleBoardScreen'
import { parseAppSnapshot, serializeAppSnapshot } from '../../data/appSnapshotRepository'
import { trimBoardWeeksForMemory } from './boardWeekTrim'
import { featureRolloutRegistry, isFeatureScopeEnabled } from '../../utils/featureRollout'
import {
  buildTemplatePendingDeskKey,
  buildTemplatePendingDesksPayload,
  buildTemplatePendingLowerScanWeeks,
  cloneTemplatePendingDeskMap,
  collectTemplatePendingCellIds,
  normalizeTemplatePendingDeskMap,
  pruneTemplatePendingDesksOnOrAfter,
  templatePendingDesksForSignature,
  type TemplatePendingDeskMap,
} from './templatePendingDesks'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const WORKSPACE_STORE_TS = readFileSync(fileURLToPath(new URL('../../integrations/firebase/workspaceStore.ts', import.meta.url)), 'utf8')
const LEDGER_TS = readFileSync(fileURLToPath(new URL('../../utils/studentLessonLedger.ts', import.meta.url)), 'utf8')

function sliceBody(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  expect(startIndex, start).toBeGreaterThanOrEqual(0)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(endIndex, end).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

const settings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 1 } as unknown as ClassroomSettings

function cell(id: string, dateKey: string): SlotCell {
  return { id, dateKey, dayLabel: '水', dateLabel: '', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true, desks: [{ id: `${id}_desk_1`, teacher: '田中' }] }
}

const PENDING: TemplatePendingDeskMap = {
  [buildTemplatePendingDeskKey('2026-10-07_5', '2026-10-07_5_desk_1')]: {
    lower: {
      lesson: { id: 'l1', studentSlots: [{ id: 'e1', name: '三浦', managedStudentId: 'sM', grade: '中2', subject: '数', lessonType: 'makeup', teacherType: 'normal', makeupSourceDate: '2026-09-30' }, null] },
      statusSlots: [null, { id: 'st1', studentId: 'e2', sourceManagedLesson: true, name: '土屋', managedStudentId: 'sD', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey: '2026-10-07', slotNumber: 5, recordedAt: 'x', status: 'moved', sourceLessonId: 'l0' }],
      memoSlots: ['連絡', null],
    },
    effectiveStartDate: '2026-10-07',
    createdAt: '2026-09-29T10:00:00.000Z',
  },
}

function boardState(extra: Partial<PersistedBoardState> = {}): PersistedBoardState {
  return {
    weeks: [[cell('2026-10-07_5', '2026-10-07')]],
    weekIndex: 0,
    selectedCellId: '2026-10-07_5',
    selectedDeskIndex: 0,
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
    manualMakeupAdjustments: {},
    suppressedMakeupOrigins: {},
    fallbackMakeupStudents: {},
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    fallbackLectureStockStudents: {},
    isLectureStockOpen: false,
    isMakeupStockOpen: false,
    studentScheduleRange: null,
    teacherScheduleRange: null,
    ...extra,
  }
}

function historyEntry(templatePendingDesks?: TemplatePendingDeskMap): HistoryEntry {
  return {
    weeks: [[cell('2026-10-07_5', '2026-10-07')]],
    weekIndex: 0,
    selectedCellId: '2026-10-07_5',
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
    ...(templatePendingDesks ? { templatePendingDesks } : {}),
  }
}

const historyContext = { classroomSettings: settings, groupClassEntries: {}, isLectureStockOpen: false, isMakeupStockOpen: false, studentScheduleRange: null, teacherScheduleRange: null }

describe('保留マップの往復（保存 → 読込 → publish → undo/redo → JSON で deep-equal・条件 24）', () => {
  it('JSON スナップショット（書き出し/読み込み・自動バックアップと同じ直列化）で残る', () => {
    const snapshot = { screen: 'board', classroomSettings: settings, managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [], boardState: boardState({ templatePendingDesks: PENDING }), updatedAt: 'x', schemaVersion: 1, savedAt: 'x' } as unknown as AppSnapshot
    const parsed = parseAppSnapshot(serializeAppSnapshot(snapshot))
    expect(parsed.boardState?.templatePendingDesks).toEqual(PENDING)
  })

  it('読込（createInitialBoardSnapshot）で復元され、保留の無い教室には項目自体が生えない', () => {
    const restored = createInitialBoardSnapshot({ classroomSettings: settings, teachers: [], students: [], regularLessons: [], initialBoardState: boardState({ templatePendingDesks: PENDING }) })
    expect(restored.templatePendingDesks).toEqual(PENDING)
    expect(restored.templatePendingDesks).not.toBe(PENDING)
    const none = createInitialBoardSnapshot({ classroomSettings: settings, teachers: [], students: [], regularLessons: [], initialBoardState: boardState() })
    expect('templatePendingDesks' in none).toBe(false)
  })

  it('undo/redo（applyHistoryEntry）の publish payload に履歴エントリの保留マップが載る（複製・空なら載せない）', () => {
    const applied = applyHistoryEntry(historyEntry(PENDING), historyContext)
    expect(applied.publishPayload.templatePendingDesks).toEqual(PENDING)
    expect(applied.publishPayload.templatePendingDesks).not.toBe(PENDING)
    expect('templatePendingDesks' in applyHistoryEntry(historyEntry({}), historyContext).publishPayload).toBe(false)
    expect('templatePendingDesks' in applyHistoryEntry(historyEntry(), historyContext).publishPayload).toBe(false)
  })

  it('保存 → JSON → 読込 → undo の一続きでも deep-equal のまま', () => {
    const snapshot = { screen: 'board', classroomSettings: settings, managers: [], teachers: [], students: [], regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [], boardState: boardState({ templatePendingDesks: PENDING }), updatedAt: 'x', schemaVersion: 1, savedAt: 'x' } as unknown as AppSnapshot
    const loaded = createInitialBoardSnapshot({ classroomSettings: settings, teachers: [], students: [], regularLessons: [], initialBoardState: parseAppSnapshot(serializeAppSnapshot(snapshot)).boardState })
    const applied = applyHistoryEntry(historyEntry(loaded.templatePendingDesks), historyContext)
    expect(applied.publishPayload.templatePendingDesks).toEqual(PENDING)
  })

  it('正規化は壊れた値だけ落とし、盤面に無い（孤児）キーは落とさない（Q24-5）', () => {
    const orphanKey = buildTemplatePendingDeskKey('2099-01-01_1', '2099-01-01_1_desk_1')
    const normalized = normalizeTemplatePendingDeskMap({ ...PENDING, [orphanKey]: { lower: {}, effectiveStartDate: 'x', createdAt: 'y' }, broken: 1, 'no-separator': { lower: {} } })
    expect(Object.keys(normalized).sort()).toEqual([...Object.keys(PENDING), orphanKey].sort())
    expect(normalized[Object.keys(PENDING)[0]]).toEqual(PENDING[Object.keys(PENDING)[0]])
    expect(normalizeTemplatePendingDeskMap(null)).toEqual({})
    expect(normalizeTemplatePendingDeskMap([])).toEqual({})
  })

  it('複製は深い（publish 後の編集が状態を汚さない）', () => {
    const cloned = cloneTemplatePendingDeskMap(PENDING)
    const key = Object.keys(PENDING)[0]
    cloned[key].lower.memoSlots![0] = '変更'
    cloned[key].lower.lesson!.studentSlots[0]!.name = '変更'
    expect(PENDING[key].lower.memoSlots![0]).toBe('連絡')
    expect(PENDING[key].lower.lesson!.studentSlots[0]!.name).toBe('三浦')
  })

  it('ダーティ署名では空と未設定を同一視する（読込直後に未保存扱いにしない）', () => {
    expect(templatePendingDesksForSignature({})).toBeUndefined()
    expect(templatePendingDesksForSignature(undefined)).toBeUndefined()
    expect(templatePendingDesksForSignature(PENDING)).toBe(PENDING)
    expect(buildTemplatePendingDesksPayload({})).toEqual({})
  })
})

describe('週トリム（Q24-4）: 保留のある週は破棄しない', () => {
  it('手動編集の無い遠い週でも、保留マップのキーが指すコマを含む週は残る', () => {
    const near = [cell('2026-09-30_5', '2026-09-30')]
    const farPending = [cell('2027-06-02_5', '2027-06-02')]
    const farPlain = [cell('2027-06-09_5', '2027-06-09')]
    const pending: TemplatePendingDeskMap = { [buildTemplatePendingDeskKey('2027-06-02_5', '2027-06-02_5_desk_1')]: { lower: { memoSlots: ['x', null] }, effectiveStartDate: '2027-06-02', createdAt: 'x' } }
    const referenceDate = new Date('2026-09-29T00:00:00')
    const trimmedWithout = trimBoardWeeksForMemory([near, farPending, farPlain], { referenceDate })
    expect(trimmedWithout).toEqual([near])
    const trimmed = trimBoardWeeksForMemory([near, farPending, farPlain], { referenceDate, protectedCellIds: collectTemplatePendingCellIds(pending) })
    expect(trimmed).toEqual([near, farPending])
  })
})

describe('旧方式（フラグ OFF の上書き）は反映日以降の保留だけを消す（Q33-3）', () => {
  it('反映日以降のコマの保留は消え、反映日より前・盤面に無い（孤児）キーは残る。保留が無ければ同じ参照', () => {
    const weeks = [[cell('2026-10-06_5', '2026-10-06'), cell('2026-10-07_5', '2026-10-07')]]
    const beforeKey = buildTemplatePendingDeskKey('2026-10-06_5', '2026-10-06_5_desk_1')
    const afterKey = buildTemplatePendingDeskKey('2026-10-07_5', '2026-10-07_5_desk_1')
    const orphanKey = buildTemplatePendingDeskKey('2099-01-01_1', 'd')
    const entry = { lower: { memoSlots: ['x', null] as [string | null, string | null] }, effectiveStartDate: '2026-10-01', createdAt: 'x' }
    const pruned = pruneTemplatePendingDesksOnOrAfter({ [beforeKey]: entry, [afterKey]: entry, [orphanKey]: entry }, weeks, '2026-10-07')
    expect(Object.keys(pruned).sort()).toEqual([beforeKey, orphanKey].sort())
    const empty = {}
    expect(pruneTemplatePendingDesksOnOrAfter(empty, weeks, '2026-10-07')).toBe(empty)
  })
})

describe('在庫の走査の 3 本目（INV-06 拡張・Q25-4）', () => {
  it('下段の生徒・出欠記録を疑似セルにし、開校判定は盤面のコマから引く（メモだけの下段は走査しない）', () => {
    const board = [[{ ...cell('2026-10-07_5', '2026-10-07'), isOpenDay: false }]]
    const scan = buildTemplatePendingLowerScanWeeks(board, {
      ...PENDING,
      [buildTemplatePendingDeskKey('2026-10-07_5', 'memo-only')]: { lower: { memoSlots: ['x', null] }, effectiveStartDate: 'x', createdAt: 'x' },
    })
    expect(scan).toHaveLength(1)
    expect(scan[0]).toHaveLength(1)
    expect(scan[0][0].isOpenDay).toBe(false)
    expect(scan[0][0].desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sM')
    expect(scan[0][0].desks[0].statusSlots?.[1]?.status).toBe('moved')
    expect(buildTemplatePendingLowerScanWeeks(board, {})).toEqual([])
  })
})

describe('配線の字面固定（描画テスト環境が無い経路）', () => {
  it('publish の全経路（commitWeeks・publish effect・テンプレ保存の新旧・undo/redo）が保留マップを載せる', () => {
    const commitWeeks = sliceBody(BOARD_TSX, 'const commitWeeks = (', 'const handleSelectDesk')
    expect(commitWeeks).toContain('...buildTemplatePendingDesksPayload(nextTemplatePendingDesks)')
    expect(commitWeeks).toContain('createHistoryEntry(weeks, weekIndex')
    const publishEffect = sliceBody(BOARD_TSX, "bumpMemCounter('board-sync-publish')", "bumpMemCounter('overlay-recompute')")
    expect(publishEffect).toContain('...buildTemplatePendingDesksPayload(templatePendingDesks)')
    expect(publishEffect).toContain('    templatePendingDesks,\n')
    const byDiff = sliceBody(BOARD_TSX, 'const handleSaveRegularLessonTemplateByDiff = useCallback(', 'const handleSaveRegularLessonTemplate = useCallback(')
    expect(byDiff).toContain('...buildTemplatePendingDesksPayload(plan.diff.nextPendingDesks)')
    expect(byDiff).toContain('setTemplatePendingDesks(plan.diff.nextPendingDesks)')
    expect(byDiff).toContain('{ userInitiated: true }')
    expect(byDiff).toContain('committedBoardChangeVersionRef.current += 1')
    const overwrite = sliceBody(BOARD_TSX, 'const handleSaveRegularLessonTemplate = useCallback(', 'useEffect(() => {')
    expect(overwrite).toContain('pruneTemplatePendingDesksOnOrAfter(templatePendingDesks, weeks, effectiveStart)')
    expect(overwrite).toContain('...buildTemplatePendingDesksPayload(nextTemplatePendingDesks)')
    expect(BOARD_TSX).toContain('...buildTemplatePendingDesksPayload(entry.templatePendingDesks)')
  })

  it('履歴エントリに保留マップを積み、戻す/やり直しで状態へ戻す', () => {
    const createHistory = sliceBody(BOARD_TSX, 'const createHistoryEntry = (', 'const commitWeeks = (')
    expect(createHistory).toContain('templatePendingDesks: cloneTemplatePendingDeskMap(sourceTemplatePendingDesks)')
    const undo = sliceBody(BOARD_TSX, 'const handleUndo = () => {', 'const handleRedo = () => {')
    expect(undo).toContain('setTemplatePendingDesks(cloneTemplatePendingDeskMap(previous.templatePendingDesks))')
    const redo = sliceBody(BOARD_TSX, 'const handleRedo = () => {', 'const handleBoardSort')
    expect(redo).toContain('setTemplatePendingDesks(cloneTemplatePendingDeskMap(next.templatePendingDesks))')
  })

  it('盤面の未消化振替（一覧・台帳 origin）は保留マップを在庫の走査へ渡す', () => {
    const stock = sliceBody(BOARD_TSX, 'const rawMakeupStockEntries = useMemo(() => buildMakeupStockEntries({', 'const rawLectureStockEntries')
    expect(stock.match(/templatePendingDesks,\n/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(APP_TSX).toContain('templatePendingDesks: latestBoardState.templatePendingDesks,')
    expect(LEDGER_TS).toContain('templatePendingDesks: boardState.templatePendingDesks,')
  })

  it('App のダーティ署名・週トリム・分割読込の型が保留マップを含む', () => {
    expect(APP_TSX).toContain('templatePendingDesks: templatePendingDesksForSignature(boardState.templatePendingDesks),')
    expect(APP_TSX).toContain('protectedCellIds: collectTemplatePendingCellIds(boardState.templatePendingDesks)')
    expect(WORKSPACE_STORE_TS).toContain("| 'templatePendingDesks'")
  })

  it('日程表・PDF・盤面共有の入力には保留マップを渡さない（INV-13・下段は盤面画面専用）', () => {
    const studentSchedule = sliceBody(BOARD_TSX, 'const handleOpenStudentSchedule = ', 'const handleOpenTeacherSchedule = ')
    expect(studentSchedule).not.toContain('templatePendingDesks')
    const teacherSchedule = sliceBody(BOARD_TSX, 'const handleOpenTeacherSchedule = ', '// 出欠付与(休み/振無休/出席)の操作ログ')
    expect(teacherSchedule).not.toContain('templatePendingDesks')
    expect(BOARD_TSX).not.toMatch(/exportBoardPdf[^\n]*templatePendingDesks/)
  })
})

describe('機能フラグ templateDiffApply（Q33-2・条件 26）', () => {
  it('scope は development-only（開発用教室だけ・本番 3 教室は OFF）', () => {
    expect(featureRolloutRegistry.templateDiffApply.scope).toBe('development-only')
    expect(isFeatureScopeEnabled(featureRolloutRegistry.templateDiffApply.scope, { isStaging: false, isDevelopmentClassroom: false })).toBe(false)
    expect(isFeatureScopeEnabled(featureRolloutRegistry.templateDiffApply.scope, { isStaging: true, isDevelopmentClassroom: false })).toBe(false)
    expect(isFeatureScopeEnabled(featureRolloutRegistry.templateDiffApply.scope, { isStaging: false, isDevelopmentClassroom: true })).toBe(true)
  })

  it('フラグ ON だけ差分反映へ分岐し、OFF は旧方式（handleSaveRegularLessonTemplate の上書き）を呼ぶ', () => {
    expect(BOARD_TSX).toContain("const templateDiffApplyEnabled = isFeatureEnabledForClassroom('templateDiffApply', { id: classroomStorageKey })")
    const confirm = sliceBody(BOARD_TSX, 'const handleTemplateSaveConfirm = async () => {', 'const handleTemplateClear = () => {')
    // Q39（2026-10-14）: 差分反映には確認モーダルで決めた絞り込み（slotFilter）と範囲の説明を渡す。旧方式の呼び出しは不変。
    expect(confirm).toMatch(/if \(templateDiffApplyEnabled\) \{\n\s+handleSaveRegularLessonTemplateByDiff\(templateSaveConfirm\.template, \{ applyScope: templateSaveConfirm\.applyScope \}\)\n\s+return\n\s+\}\n\s+handleSaveRegularLessonTemplate\(templateSaveConfirm\.template, true\)/)
    // 保存前の自動バックアップは差分反映でも呼ぶ（Q32-2）
    const byDiff = sliceBody(BOARD_TSX, 'const handleSaveRegularLessonTemplateByDiff = useCallback(', 'const handleSaveRegularLessonTemplate = useCallback(')
    expect(byDiff).toContain('void onPreTemplateSaveBackup()')
    // 在庫台帳は差分反映で書き換えない（publish は現在値の複製だけ・INV-06 拡張）。希望回数補正は Q35-8（2026-10-02・オーナー決定）の −1 だけ積む
    // （クリアはしない＝Q10。積み方は単発削除と同じ resolveDeletedStudentCountAccounting・対象は差分反映の wholeDayTransferCountAdjustments だけ）。
    // Q40-2-4（2026-10-14・オーナー確定・INV-06 の唯一の例外）: 丸ごと振替した日に足した生徒で振替先に空きが無く休日でないときだけ、
    // 未消化振替の origin を台帳へ 1 件積む（計画関数が返す manualMakeupOriginAdditions の分だけ。それ以外の台帳は触らない）。
    expect(byDiff).not.toMatch(/setManualLectureStockCounts|setManualLectureStockOrigins|setSuppressedMakeupOrigins|filterTemplateOverwriteHolidayDates/)
    expect(byDiff).toContain('for (const addition of plan.diff.manualMakeupOriginAdditions) {')
    // 積む形は理由ラベルつき（appendTemplateTransferMakeupOrigin）。以前の保存が積んだ分の取り下げ（M-2）は removeMakeupOrigin を同じ形で（計画関数が返す manualMakeupOriginRemovals の分だけ）。
    expect(byDiff).toContain('appendTemplateTransferMakeupOrigin(nextManualMakeupAdjustments, resolveTemplateTransferStockKey(addition.student), addition.dateKey, addition.slotNumber)')
    expect(byDiff).toContain('for (const removal of plan.diff.manualMakeupOriginRemovals) {')
    expect(byDiff).toContain('removeTemplateTransferMakeupOrigin(nextManualMakeupAdjustments, removal.stockKey, removal.dateKey, removal.slotNumber)')
    expect(byDiff).not.toContain('appendMakeupOrigin(')
    expect(byDiff).not.toContain('removeMakeupOrigin(')
    expect(byDiff).toContain('manualMakeupAdjustments: cloneOriginMap(nextManualMakeupAdjustments),')
    expect(byDiff.match(/setManualMakeupAdjustments\(/g)).toHaveLength(1)
    expect(byDiff.match(/setScheduleCountAdjustments\(/g)).toHaveLength(1)
    expect(byDiff).toContain('for (const target of plan.diff.wholeDayTransferCountAdjustments) {')
    expect(byDiff).not.toContain('setScheduleCountAdjustments([])')
  })

  it('INV-12(2026-10-14): テンプレ編集の追加・変更は同コマ重複を止め、保存は重複のあるテンプレを受け付けない（templateEditorGuards を配線）', () => {
    expect(BOARD_TSX).toContain("import { buildTemplateDuplicateStudentsMessage, findTemplateDuplicateStudents } from './templateEditorGuards'")
    // 1 席ぶんの検査は移動(Issue #56)と同じ findDuplicateStudentInCell(= findDuplicateStudentInCellByKey の包み)を使う(写しを作らない)。
    expect(BOARD_TSX).not.toContain('findTemplateSeatDuplicate')
    const add = sliceBody(BOARD_TSX, 'const handleTemplateConfirmAdd = () => {', 'const handleTemplateSelectDesk = (')
    expect(add).toContain('findDuplicateStudentInCell(addTargetCell,')
    expect(add.indexOf('findDuplicateStudentInCell(')).toBeLessThan(add.indexOf('pushTemplateUndo(templateCells)'))
    expect(add).toContain('が組まれているため追加できません。')
    const edit = sliceBody(BOARD_TSX, 'const handleTemplateConfirmEdit = () => {', 'const handleTemplateOpenAdd = () => {')
    expect(edit).toContain('findDuplicateStudentInCell(editTargetCell, candidateKey, [editTargetStudent.id])')
    // 止めたときに中身の変わらない undo を残さない(検査は undo を積む前)。
    expect(edit.indexOf('findDuplicateStudentInCell(')).toBeLessThan(edit.indexOf('pushTemplateUndo(templateCells)'))
    expect(edit).toContain('が組まれているため変更できません。')
    const request = sliceBody(BOARD_TSX, 'const handleTemplateSaveRequest = () => {', 'const handleTemplateSaveConfirm = async () => {')
    expect(request).toContain('findTemplateDuplicateStudents(templateCells,')
    expect(request.indexOf('findTemplateDuplicateStudents(')).toBeLessThan(request.indexOf('convertTemplateCellsToTemplate({'))
    // オーナー指示 2026-10-14「そもそも同じ生徒を同じコマに配置できないように」→ 保存の検査は全教室(フラグで分けない)。
    expect(request).toContain('const duplicates = findTemplateDuplicateStudents(templateCells,')
    expect(request).not.toContain('templateDiffApplyEnabled\n      ? findTemplateDuplicateStudents')
    // Excel 取り込みも同じ検査で止める(取り込まない・文言でコマと生徒を示す)。
    const importBody = sliceBody(BOARD_TSX, 'const applyTemplateImport = (', 'const handleTemplateImportWithDate = (')
    expect(importBody).toContain('findTemplateDuplicateStudents(importedCells,')
    expect(importBody.indexOf('findTemplateDuplicateStudents(')).toBeLessThan(importBody.indexOf('setTemplateCells(importedCells)'))
    expect(importBody).toContain(", 'import'))")
    expect(request).toContain('buildTemplateDuplicateStudentsMessage(duplicates,')
  })

  it('確認文の件数（試し実行）は保存本体と同じ計画関数から出す（Q32-1）', () => {
    // Q39（2026-10-14）: 試し実行も保存本体も同じ計画関数（buildTemplateDiffSavePlan）が applyScope から絞り込みを作り直す（確認文と保存結果が食い違わない）。
    expect(BOARD_TSX).toContain("const plan = buildTemplateDiffSavePlan(template, '')")
    expect(BOARD_TSX).toContain("setTemplateSaveConfirm({ mode: 'overwrite', template, diffSummary: plan.diff.summary, studentNotes: plan.diff.studentNotes, definitionDiff: plan.definitionDiff, applyScope: plan.applyScope, scopeNote: plan.scopeNote, scopedSlotCount: plan.scopedSlotCount, todayKey: toDateKey(new Date()) })")
    // 2026-10-21: 確認の画面には件数に加えて生徒ごとの理由（名前つき）を出す（試し実行の結果をそのまま渡す＝保存本体と同じ入力）。
    expect(BOARD_TSX).toContain("buildTemplateDiffConfirmMessage(templateSaveConfirm.template.effectiveStartDate, templateSaveConfirm.diffSummary, { scopeNote: templateSaveConfirm.scopeNote, todayKey: templateSaveConfirm.todayKey, studentNotes: templateSaveConfirm.studentNotes })")
    // Q40-3（2026-10-21 H-A）: 精算済みの集合は本体（resolveWholeDayTransferSettlement）が決め、配置計画は同じ集合を参照で受ける。材料の在庫の正本は保存前の盤面・台帳で引き、希望回数の補正は読むだけ。
    expect(BOARD_TSX).toContain("settled: new Set(run.diff.wholeDayTransferSettled)")
    expect(BOARD_TSX).toContain("wholeDayTransferSettlement: params.wholeDayTransferSettlement,")
    expect(BOARD_TSX).toContain("      scheduleCountAdjustments,\n      teachers,")
    expect(BOARD_TSX).toContain("const plan = buildTemplateDiffSavePlan(template, new Date().toISOString(), { applyScope: options?.applyScope })")
    // 2026-10-15（確認リスト v1.5.596 tp-44/tp-46 メモ「選択肢は不要で、自動的に変更のあったコマだけ反映。何も変更なかったときだけ全コマ」）:
    // 確認モーダルの範囲のラジオ（変えたコマだけ／すべてのコマ）は外し、範囲は計画関数の既定（resolveDefaultTemplateDiffApplyScope）だけで決まる。
    expect(BOARD_TSX).not.toContain('template-save-scope-all')
    expect(BOARD_TSX).not.toContain('template-save-scope-changed')
    expect(BOARD_TSX).not.toContain('handleTemplateSaveScopeChange')
    expect(BOARD_TSX).toContain('const applyScope = options?.applyScope ?? resolveDefaultTemplateDiffApplyScope(definitionDiff)')
    expect(BOARD_TSX).toContain('data-testid="template-save-changed-desks"')
    // 絞り込みは差分反映の本体と保存直後の再マージの重ね合わせの両方に効く（絞り込みの外は参照ごと不変）。
    expect(BOARD_TSX).toContain('slotFilter: params.slotFilter,')
    expect(BOARD_TSX).toContain('if (!isCellInTemplateDiffScope(cell, params.slotFilter)) return cell')
    // 入口は同日移動の写しがある日を全コマにしてから本体・重ね合わせへ渡す（Q39-9・regression-reviewer H-1）。
    expect(BOARD_TSX).toContain('slotFilter: expandTemplateDiffSlotFilterForSameDayMoves({ weeks: input.weeks, pendingDesks: input.templatePendingDesks, effectiveStartDate: input.effectiveStartDate, filter: input.slotFilter })')
    // 範囲の権威は計画関数 1 か所: 基準は保存時点の保存済みテンプレ（編集画面と同じ在籍フィルタ）、範囲は定義の差 ∪ 盤面の行との差（regression-reviewer H-2）。
    const planFn = sliceBody(BOARD_TSX, 'const buildTemplateDiffSavePlan = useCallback(', 'const handleSaveRegularLessonTemplateByDiff = useCallback(')
    expect(planFn).toContain('filterTemplateParticipantsForReferenceDate({ template: classroomSettings.regularLessonTemplate, deskCount: classroomSettings.deskCount, teachers, students, referenceDate: toDateKey(new Date()) })')
    expect(planFn).toContain('const definitionDiff = diffTemplateDefinitions(baselineTemplate, template)')
    expect(planFn).toContain('const extraSlotKeys = diffRegularLessonRowsBySlot(regularLessons, normalizedTemplateRegularLessons, resolveTemplateSchoolYear(template.effectiveStartDate))')
    expect(planFn).toContain('resolveTemplateDiffSlotFilter({ diff: definitionDiff, scope: applyScope, previousEffectiveStartDate, extraSlotKeys })')
    // Q39-9: 入口がその日を全コマにした日は計画関数が範囲の説明に写す（確認文と件数が食い違わない・regression-reviewer M-1）。
    expect(planFn).toContain("baseScopeNote.scope === 'changed-slots' && diff.scopedFullDates.length > 0 ? { ...baseScopeNote, fullDates: diff.scopedFullDates } : baseScopeNote")
    // 旧方式（フラグ OFF）の既定日と保存ボタンの文言は不変（差分反映の教室だけ来週の月曜・「反映（変えたコマだけ）」）。
    expect(BOARD_TSX).toContain("      : (filteredTemplate?.effectiveStartDate || today))")
    expect(BOARD_TSX).toContain("templateSaveButtonLabel={templateDiffApplyEnabled ? '反映開始日以降にこのテンプレを反映（変えたコマだけ）' : undefined}")
    // 試し実行は数秒かかる同期計算。先に BusyOverlay を描いて 1 フレーム待ってから計算する(2026-10-14 オーナー指摘「ボタンを押して
    // つぎのモーダルが出るまで操作できないのにローディングスピンがでない」)。差分反映 OFF の教室は従来どおり即モーダル。
    const request = sliceBody(BOARD_TSX, 'const handleTemplateSaveRequest = () => {', 'const handleTemplateSaveConfirm = async () => {')
    expect(request).toContain('setBusyOverlayMessage(TEMPLATE_DIFF_PREVIEW_BUSY_MESSAGE)')
    expect(request).toContain('void waitForNextPaint().then(() => {')
    expect(request.indexOf('setBusyOverlayMessage(TEMPLATE_DIFF_PREVIEW_BUSY_MESSAGE)')).toBeLessThan(request.indexOf("buildTemplateDiffSavePlan(template, '')"))
    expect(request).toContain('setBusyOverlayMessage(null)')
    expect(request).toContain("if (!templateDiffApplyEnabled) {\n      setTemplateSaveConfirm({ mode: 'overwrite', template })")
    // 待っている間にテンプレ画面を離れた／連打されたら、その回の確認モーダルは開かない(古いテンプレの保存に進ませない)。
    expect(request).toContain('if (templateSavePreviewSeqRef.current !== previewSeq || !isTemplateModeRef.current) {')
    expect(request.indexOf('templateSavePreviewSeqRef.current !== previewSeq')).toBeLessThan(request.indexOf("buildTemplateDiffSavePlan(template, '')"))
    const byDiff = sliceBody(BOARD_TSX, 'const handleSaveRegularLessonTemplateByDiff = useCallback(', 'const handleSaveRegularLessonTemplate = useCallback(')
    expect(byDiff).toContain('const plan = buildTemplateDiffSavePlan(template, new Date().toISOString(), { applyScope: options?.applyScope })')
    const plan = sliceBody(BOARD_TSX, 'const buildTemplateDiffSavePlan = useCallback(', 'const handleSaveRegularLessonTemplateByDiff = useCallback(')
    expect(plan).toContain('computeTemplateDiffApplyForBoard({')
    // Q40: 在庫台帳・抑止した origin は計画関数に渡して読むだけ（根拠 (b)・取り下げ M-2）。書くのは保存本体だけ。
    expect(plan).toContain('manualMakeupAdjustments,\n      suppressedMakeupOrigins,\n    })')
    expect(plan).not.toMatch(/filterTemplateOverwriteHolidayDates\(/)
    // Q40-1 根拠 (b) は在庫の正本 collectMakeupOriginDatesByKey を、取り下げ後の台帳・保存後の盤面（上段＋保留の下段）・同じ抑止で呼ぶ（監査 H-A/M-A・判定を在庫と分けない）。
    const entry = sliceBody(BOARD_TSX, 'export function computeTemplateDiffApplyForBoard(', '// Q36 の反復本体')
    expect(entry).toContain('resolveLedgerOriginDates: (ledgerAfterRemovals) => collectMakeupOriginDatesByKey({')
    expect(entry).toContain('manualAdjustments: ledgerAfterRemovals, suppressedOrigins: params.suppressedMakeupOrigins ?? {}, resolveStudentKey: buildTemplateTransferStockIdResolver(params.students),')
    expect(entry).toContain('includeAbsentMakeupOrigins: true, templatePendingDesks: run.diff.nextPendingDesks,')
    // 鍵解決は盤面と同じ対応表（登録名＋表示名）から（監査 M-C）。
    expect(BOARD_TSX).toContain('const managedStudentByAnyName = useMemo(() => buildManagedStudentByAnyNameMap(students), [students])')
    expect(BOARD_TSX).toContain('const byAnyName = buildManagedStudentByAnyNameMap(students)')
    expect(entry).toContain('manualMakeupAdjustments: MakeupOriginMap\n')
    // 追従で触ったセルは再マージの重ね合わせにだけ足す（Q36 の反復の絞り込みを書き換えない・監査 M-1）。
    expect(entry).not.toMatch(/params\.slotFilter\s*=/)
    expect(entry).toContain('slotFilter: settleSlotFilter,')
  })
})
