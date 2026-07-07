import { describe, expect, it } from 'vitest'
import { parseAppSnapshot, parseWorkspaceSnapshot, serializeAppSnapshot, serializeWorkspaceSnapshot } from './appSnapshotRepository'
import type { AppSnapshot, WorkspaceSnapshot } from '../types/appState'

// Phase 0(②保存)で手動バックアップを「1教室分の完全AppSnapshot」に変更した。
// この回帰テストは「書き出し⇄読み込みでデータが欠落せず、テンプレ・盤面・ストックまで
// 丸ごと往復できる」ことと、「AppSnapshot形式とWorkspace形式が正しく判別される(importBackupの
// フォールバック分岐の前提)」ことを固定する。

function buildClassroomPayload() {
  return {
    screen: 'board',
    classroomSettings: {
      closedWeekdays: [0],
      holidayDates: ['2026-05-05'],
      forceOpenDates: ['2026-05-03'],
      deskCount: 14,
      scheduleNotes: { '2026-05-01': '面談' },
      boardShareToken: 'token-123',
      // テンプレが書き出しに含まれること(=完全復元の肝)を担保する
      regularLessonTemplate: {
        version: 1,
        effectiveStartDate: '2026-04-01',
        savedAt: '2026-04-01T00:00:00.000Z',
        cells: [
          { dayOfWeek: 1, slotNumber: 1, desks: [{ deskIndex: 0, teacherId: 't001', students: [{ studentId: 's001', subject: '数' }, null] }] },
        ],
      },
      initialSetupCompletedAt: '2026-04-01T00:00:00.000Z',
      initialSetupMakeupStocks: [{ id: 'ms1', studentId: 's001', subject: '数', count: 2 }],
      initialSetupLectureStocks: [{ id: 'ls1', studentId: 's001', subject: '英', sessionId: 'sess1', count: 1 }],
    },
    managers: [],
    teachers: [{ id: 't001', name: '田中', email: '', entryDate: '2024-04-01', withdrawDate: '未定', subjectCapabilities: [], memo: '' }],
    students: [{ id: 's001', name: '生徒A', displayName: '生徒A', email: '', entryDate: '2024-04-01', withdrawDate: '未定', birthDate: '2014-05-01' }],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    // 盤面状態も往復で保持されること
    boardState: { weeks: [], weekIndex: 0, suppressedRegularLessonOccurrences: {}, scheduleCountAdjustments: {} },
  }
}

function buildAppSnapshot(): AppSnapshot {
  return { schemaVersion: 1, savedAt: '2026-06-08T00:00:00.000Z', ...buildClassroomPayload() } as unknown as AppSnapshot
}

function buildWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    savedAt: '2026-06-08T00:00:00.000Z',
    currentUserId: 'u1',
    actingClassroomId: 'c1',
    classrooms: [{
      id: 'c1',
      name: '教室',
      contractStatus: 'active',
      contractStartDate: '2024-04-01',
      contractEndDate: '',
      managerUserId: 'u1',
      isTemporarilySuspended: false,
      temporarySuspensionReason: '',
      data: buildClassroomPayload(),
    }],
    users: [{ id: 'u1', name: '室長', email: 'a@b.c', role: 'manager', assignedClassroomId: 'c1' }],
  } as unknown as WorkspaceSnapshot
}

describe('手動バックアップ(AppSnapshot)の書き出し⇄読み込み', () => {
  it('serialize→parse でデータが欠落せず完全に往復する', () => {
    const snapshot = buildAppSnapshot()
    const restored = parseAppSnapshot(serializeAppSnapshot(snapshot))
    expect(restored).toEqual(snapshot)
  })

  it('テンプレ・初期ストック・盤面状態が往復後も保持される', () => {
    const restored = parseAppSnapshot(serializeAppSnapshot(buildAppSnapshot()))
    expect(restored.classroomSettings.regularLessonTemplate?.cells).toHaveLength(1)
    expect(restored.classroomSettings.initialSetupMakeupStocks).toHaveLength(1)
    expect(restored.classroomSettings.initialSetupLectureStocks).toHaveLength(1)
    expect(restored.boardState).not.toBeNull()
  })

  it('壊れたJSONは読み込みを拒否する', () => {
    expect(() => parseAppSnapshot('{ not valid }')).toThrow()
    expect(() => parseAppSnapshot(JSON.stringify({ schemaVersion: 1 }))).toThrow()
  })
})

describe('AppSnapshot形式とWorkspace形式の判別(importBackupのフォールバック前提)', () => {
  it('Workspace形式のJSONはAppSnapshotとしては解釈できない', () => {
    const workspaceJson = serializeWorkspaceSnapshot(buildWorkspaceSnapshot())
    expect(() => parseAppSnapshot(workspaceJson)).toThrow()
  })

  it('Workspace形式はWorkspaceとして正しく読める', () => {
    const workspaceJson = serializeWorkspaceSnapshot(buildWorkspaceSnapshot())
    const restored = parseWorkspaceSnapshot(workspaceJson)
    expect(restored.classrooms).toHaveLength(1)
    expect(restored.classrooms[0]?.data.classroomSettings.regularLessonTemplate?.cells).toHaveLength(1)
  })

  // 回帰防止: サーバー自動バックアップに「新フィールド追加前に保存された教室データ」が
  // 1つでも混ざると、厳格な検証で parseWorkspaceSnapshot が throw し、開発者画面の
  // 「この時点へ復元」がモーダルを開けず無反応に見えるバグがあった。
  // 欠落配列(groupLessons / pairConstraints / autoAssignRules 等)を検証前に補完して許容する。
  it('教室データが旧フィールド欠落(groupLessons/pairConstraints/autoAssignRules)でも復元できる', () => {
    const workspace = buildWorkspaceSnapshot() as unknown as { classrooms: { data: Record<string, unknown> }[] }
    // 旧 classroomSnapshot を再現: 後から追加された配列フィールドを丸ごと欠落させる
    delete workspace.classrooms[0].data.groupLessons
    delete workspace.classrooms[0].data.pairConstraints
    delete workspace.classrooms[0].data.autoAssignRules

    const json = JSON.stringify(workspace)
    expect(() => parseWorkspaceSnapshot(json)).not.toThrow()
    const restored = parseWorkspaceSnapshot(json)
    expect(restored.classrooms).toHaveLength(1)
    // 補完されて配列になっていること
    expect(Array.isArray(restored.classrooms[0]?.data.groupLessons)).toBe(true)
    expect(Array.isArray(restored.classrooms[0]?.data.pairConstraints)).toBe(true)
    expect(Array.isArray(restored.classrooms[0]?.data.autoAssignRules)).toBe(true)
  })
})

