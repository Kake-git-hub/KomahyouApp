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
    expect(confirm).toMatch(/if \(templateDiffApplyEnabled\) \{\n\s+handleSaveRegularLessonTemplateByDiff\(templateSaveConfirm\.template\)\n\s+return\n\s+\}\n\s+handleSaveRegularLessonTemplate\(templateSaveConfirm\.template, true\)/)
    // 保存前の自動バックアップは差分反映でも呼ぶ（Q32-2）
    const byDiff = sliceBody(BOARD_TSX, 'const handleSaveRegularLessonTemplateByDiff = useCallback(', 'const handleSaveRegularLessonTemplate = useCallback(')
    expect(byDiff).toContain('void onPreTemplateSaveBackup()')
    // 在庫台帳は差分反映で書き換えない（publish は現在値の複製だけ・INV-06 拡張）。希望回数補正は Q35-8（2026-10-02・オーナー決定）の −1 だけ積む
    // （クリアはしない＝Q10。積み方は単発削除と同じ resolveDeletedStudentCountAccounting・対象は差分反映の wholeDayTransferCountAdjustments だけ）。
    expect(byDiff).not.toMatch(/setManualMakeupAdjustments|setManualLectureStockCounts|setManualLectureStockOrigins|setSuppressedMakeupOrigins|filterTemplateOverwriteHolidayDates/)
    expect(byDiff.match(/setScheduleCountAdjustments\(/g)).toHaveLength(1)
    expect(byDiff).toContain('for (const target of plan.diff.wholeDayTransferCountAdjustments) {')
    expect(byDiff).not.toContain('setScheduleCountAdjustments([])')
  })

  it('確認文の件数（試し実行）は保存本体と同じ計画関数から出す（Q32-1）', () => {
    expect(BOARD_TSX).toContain("...(templateDiffApplyEnabled ? { diffSummary: buildTemplateDiffSavePlan(template, '').diff.summary } : {}),")
    const byDiff = sliceBody(BOARD_TSX, 'const handleSaveRegularLessonTemplateByDiff = useCallback(', 'const handleSaveRegularLessonTemplate = useCallback(')
    expect(byDiff).toContain('const plan = buildTemplateDiffSavePlan(template, new Date().toISOString())')
    const plan = sliceBody(BOARD_TSX, 'const buildTemplateDiffSavePlan = useCallback(', 'const handleSaveRegularLessonTemplateByDiff = useCallback(')
    expect(plan).toContain('computeTemplateDiffApplyForBoard({')
    expect(plan).not.toMatch(/filterTemplateOverwriteHolidayDates\(/)
  })
})
