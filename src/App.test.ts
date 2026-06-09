import { describe, expect, it } from 'vitest'
import { buildClassroomScopedBoardShareToken, buildDevelopmentClassroomCopyPayload, buildSubmissionAcknowledgementEntries, buildWorkspaceNavigationSnapshot, clampScreenForUserRole, hasPendingBoardSaveState, resolveHydratedScreenForUser, resolveInitialScreenForUser, resolveRemoteWorkspaceSnapshot, sanitizeClassroomSettings, shouldReturnDeveloperOnLogout, shouldSyncCurrentClassroomBeforeOpen, type ClassroomSettings } from './App'
import type { AppSnapshotPayload, WorkspaceSnapshot } from './types/appState'
import type { SubmissionChangeEntry } from './integrations/firebase/lectureSubmission'

describe('sanitizeClassroomSettings', () => {
  it('preserves saved holiday dates when a classroom snapshot is loaded again', () => {
    const settings: ClassroomSettings = {
      closedWeekdays: [0],
      holidayDates: ['2026-08-15', '2026-08-10', '2026-08-10'],
      forceOpenDates: [],
      deskCount: 14,
    }

    expect(sanitizeClassroomSettings(settings).holidayDates).toEqual(['2026-08-10', '2026-08-15'])
  })
})

describe('clampScreenForUserRole', () => {
  it('keeps classroom screens for developers', () => {
    expect(clampScreenForUserRole('board', 'developer')).toBe('board')
    expect(clampScreenForUserRole('backup-restore', 'developer')).toBe('backup-restore')
  })

  it('keeps managers out of the developer screen', () => {
    expect(clampScreenForUserRole('developer', 'manager')).toBe('board')
  })
})

describe('resolveInitialScreenForUser', () => {
  it('starts developers on the developer screen even when a classroom is active', () => {
    expect(resolveInitialScreenForUser('board', 'developer')).toBe('developer')
    expect(resolveInitialScreenForUser('backup-restore', 'developer')).toBe('developer')
  })

  it('keeps managers on the classroom screen', () => {
    expect(resolveInitialScreenForUser('board', 'manager')).toBe('board')
  })
})

describe('resolveHydratedScreenForUser', () => {
  it('starts a newly logged-in developer on the developer screen', () => {
    expect(resolveHydratedScreenForUser({
      classroomScreen: 'board',
      role: 'developer',
      currentScreen: 'board',
      previousUserId: '',
      nextUserId: 'developer-1',
    })).toBe('developer')
  })

  it('keeps a developer in the opened classroom during the same session', () => {
    expect(resolveHydratedScreenForUser({
      classroomScreen: 'backup-restore',
      role: 'developer',
      currentScreen: 'backup-restore',
      previousUserId: 'developer-1',
      nextUserId: 'developer-1',
    })).toBe('backup-restore')
  })
})

describe('shouldReturnDeveloperOnLogout', () => {
  it('returns developers from classroom screens to the developer screen', () => {
    expect(shouldReturnDeveloperOnLogout('board', 'developer')).toBe(true)
    expect(shouldReturnDeveloperOnLogout('backup-restore', 'developer')).toBe(true)
  })

  it('does not intercept real logout from the developer screen or manager screens', () => {
    expect(shouldReturnDeveloperOnLogout('developer', 'developer')).toBe(false)
    expect(shouldReturnDeveloperOnLogout('board', 'manager')).toBe(false)
  })
})

describe('shouldSyncCurrentClassroomBeforeOpen', () => {
  it('skips classroom sync when opening a classroom from the developer screen', () => {
    expect(shouldSyncCurrentClassroomBeforeOpen('developer', 'developer')).toBe(false)
  })

  it('keeps sync enabled for classroom sessions', () => {
    expect(shouldSyncCurrentClassroomBeforeOpen('board', 'developer')).toBe(true)
    expect(shouldSyncCurrentClassroomBeforeOpen('board', 'manager')).toBe(true)
  })
})

describe('buildClassroomScopedBoardShareToken', () => {
  it('教室IDで一意化し、別教室がトークンをコピーしても衝突しない', () => {
    const base = 'abc-123'
    const tokenForA = buildClassroomScopedBoardShareToken('classroomA', base)
    const tokenForB = buildClassroomScopedBoardShareToken('classroomB', base)
    expect(tokenForA).toBe('classroomA__abc-123')
    expect(tokenForB).toBe('classroomB__abc-123')
    expect(tokenForA).not.toBe(tokenForB)
  })

  it('既にスコープ済みのトークンを二重接頭辞しない（冪等）', () => {
    const scoped = buildClassroomScopedBoardShareToken('classroomA', 'abc-123')
    expect(buildClassroomScopedBoardShareToken('classroomA', scoped)).toBe(scoped)
  })

  it('別教室がスコープ済みトークンをコピーしても自教室スコープへ付け替える', () => {
    const scopedForA = buildClassroomScopedBoardShareToken('classroomA', 'abc-123')
    const scopedForB = buildClassroomScopedBoardShareToken('classroomB', scopedForA)
    expect(scopedForB).toBe('classroomB__classroomA__abc-123')
    expect(scopedForB).not.toBe(scopedForA)
    // B 側で再解決しても冪等
    expect(buildClassroomScopedBoardShareToken('classroomB', scopedForB)).toBe(scopedForB)
  })
})

describe('hasPendingBoardSaveState', () => {
  it('keeps the board save button active while any save is still pending', () => {
    expect(hasPendingBoardSaveState({ isDirty: true, isSavingNow: false, isRemoteSyncPending: false })).toBe(true)
    expect(hasPendingBoardSaveState({ isDirty: false, isSavingNow: true, isRemoteSyncPending: false })).toBe(true)
    expect(hasPendingBoardSaveState({ isDirty: false, isSavingNow: false, isRemoteSyncPending: true })).toBe(true)
  })

  it('returns false only when the board is fully synced', () => {
    expect(hasPendingBoardSaveState({ isDirty: false, isSavingNow: false, isRemoteSyncPending: false })).toBe(false)
  })
})

describe('buildSubmissionAcknowledgementEntries', () => {
  it('builds modal entries with resolved person and session labels', () => {
    const entries: SubmissionChangeEntry[] = [{
      token: 'student-token',
      sessionId: 'session-1',
      personType: 'student',
      personId: 'student-1',
      unavailableSlots: [],
      subjectSlots: { 数: 2 },
      subjectDurations: {},
      regularOnly: false,
    }, {
      token: 'teacher-token',
      sessionId: 'session-1',
      personType: 'teacher',
      personId: 'teacher-1',
      unavailableSlots: [],
      subjectSlots: {},
      subjectDurations: {},
      regularOnly: false,
    }]

    const result = buildSubmissionAcknowledgementEntries(entries, {
      classroomName: '開発用教室',
      specialSessions: [{
        id: 'session-1',
        label: '夏期講習',
        startDate: '2026-07-20',
        endDate: '2026-08-31',
        createdAt: '2026-06-01T00:00:00.000Z',
        studentInputs: {},
        teacherInputs: {},
        updatedAt: '2026-06-03T00:00:00.000Z',
      }],
      students: [{
        id: 'student-1',
        name: '山田 花子',
        displayName: '山田',
        email: '',
        entryDate: '2026-04-01',
        withdrawDate: '未定',
        birthDate: '2012-05-01',
      }],
      teachers: [{
        id: 'teacher-1',
        name: '田中 一郎',
        displayName: '田中',
        email: '',
        entryDate: '2026-04-01',
        withdrawDate: '未定',
        subjectCapabilities: [],
      }],
    })

    expect(result).toEqual([
      expect.objectContaining({
        id: 'student-token:session-1:student:student-1',
        classroomName: '開発用教室',
        sessionLabel: '夏期講習',
        personType: 'student',
        personName: '山田',
      }),
      expect.objectContaining({
        id: 'teacher-token:session-1:teacher:teacher-1',
        classroomName: '開発用教室',
        sessionLabel: '夏期講習',
        personType: 'teacher',
        personName: '田中',
      }),
    ])
  })
})

function createWorkspaceSnapshot(savedAt: string, holidayDates: string[]): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    savedAt,
    developerCloudBackupEnabled: false,
    developerCloudBackupFolderName: '',
    developerCloudSyncedAutoBackupKeys: [],
    currentUserId: 'manager-1',
    actingClassroomId: 'classroom-1',
    users: [
      { id: 'manager-1', name: 'Manager', email: 'manager@example.com', role: 'manager', assignedClassroomId: 'classroom-1' },
    ],
    classrooms: [
      {
        id: 'classroom-1',
        name: '教室',
        contractStatus: 'active',
        contractStartDate: '2026-01-01',
        contractEndDate: '2026-12-31',
        managerUserId: 'manager-1',
        data: {
          screen: 'board',
          classroomSettings: { closedWeekdays: [0], holidayDates, forceOpenDates: [], deskCount: 14 },
          managers: [],
          teachers: [],
          students: [],
          regularLessons: [],
          groupLessons: [],
          specialSessions: [],
          autoAssignRules: [],
          pairConstraints: [],
          boardState: null,
        },
      },
    ],
  }
}

function createDeveloperWorkspaceSnapshot(savedAt: string, actingClassroomId: string, screen: 'board' | 'backup-restore' = 'board'): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    savedAt,
    developerCloudBackupEnabled: false,
    developerCloudBackupFolderName: '',
    developerCloudSyncedAutoBackupKeys: [],
    currentUserId: 'developer-1',
    actingClassroomId,
    users: [
      { id: 'developer-1', name: 'Developer', email: 'developer@example.com', role: 'developer', assignedClassroomId: null },
      { id: 'manager-1', name: 'Manager', email: 'manager@example.com', role: 'manager', assignedClassroomId: 'classroom-1' },
      { id: 'manager-2', name: 'Manager 2', email: 'manager2@example.com', role: 'manager', assignedClassroomId: 'development' },
    ],
    classrooms: [
      {
        id: 'classroom-1',
        name: 'スクールIE 日大前校',
        contractStatus: 'active',
        contractStartDate: '2026-01-01',
        contractEndDate: '2026-12-31',
        managerUserId: 'manager-1',
        data: {
          screen: actingClassroomId === 'classroom-1' ? screen : 'board',
          classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 14 },
          managers: [],
          teachers: [],
          students: [],
          regularLessons: [],
          groupLessons: [],
          specialSessions: [],
          autoAssignRules: [],
          pairConstraints: [],
          boardState: null,
        },
      },
      {
        id: 'development',
        name: '開発用教室',
        contractStatus: 'active',
        contractStartDate: '2026-01-01',
        contractEndDate: '2026-12-31',
        managerUserId: 'manager-2',
        data: {
          screen: actingClassroomId === 'development' ? screen : 'board',
          classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 14 },
          managers: [],
          teachers: [],
          students: [],
          regularLessons: [],
          groupLessons: [],
          specialSessions: [],
          autoAssignRules: [],
          pairConstraints: [],
          boardState: null,
        },
      },
    ],
  }
}

describe('resolveRemoteWorkspaceSnapshot', () => {
  it('restores a newer marked local close snapshot over an older Firebase snapshot', () => {
    const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
    const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

    const result = resolveRemoteWorkspaceSnapshot(
      remoteSnapshot,
      localSnapshot,
      { savedAt: localSnapshot.savedAt, authenticatedUserId: 'manager-1' },
      'manager-1',
    )

    expect(result.usedPendingLocalSnapshot).toBe(true)
    expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual(['2026-08-13'])
  })

  it('keeps Firebase as source of truth when the local snapshot is not marked pending', () => {
    const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
    const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

    const result = resolveRemoteWorkspaceSnapshot(remoteSnapshot, localSnapshot, null, 'manager-1')

    expect(result.usedPendingLocalSnapshot).toBe(false)
    expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
  })

  it('reuses a newer pending local classroom snapshot for the assigned manager classroom', () => {
    const remoteSnapshot: WorkspaceSnapshot = {
      schemaVersion: 1,
      savedAt: '2026-05-26T10:00:00.000Z',
      developerCloudBackupEnabled: false,
      developerCloudBackupFolderName: '',
      developerCloudSyncedAutoBackupKeys: [],
      currentUserId: 'manager-2',
      actingClassroomId: 'development',
      users: [
        { id: 'manager-2', name: 'Manager 2', email: 'manager2@example.com', role: 'manager', assignedClassroomId: 'development' },
      ],
      classrooms: [
        {
          id: 'development',
          name: '開発用教室',
          contractStatus: 'active',
          contractStartDate: '2026-01-01',
          contractEndDate: '2026-12-31',
          managerUserId: 'manager-2',
          data: {
            screen: 'board',
            classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 14 },
            managers: [],
            teachers: [],
            students: [],
            regularLessons: [],
            groupLessons: [],
            specialSessions: [],
            autoAssignRules: [],
            pairConstraints: [],
            boardState: null,
          },
        },
      ],
    }
    const localSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:01:00.000Z', 'development')
    const developmentClassroom = localSnapshot.classrooms.find((classroom) => classroom.id === 'development')
    if (!developmentClassroom) throw new Error('development classroom missing in test fixture')
    developmentClassroom.data.classroomSettings.holidayDates = ['2026-08-13']

    const result = resolveRemoteWorkspaceSnapshot(
      remoteSnapshot,
      localSnapshot,
      { savedAt: localSnapshot.savedAt, authenticatedUserId: 'developer-1', targetClassroomIds: ['development'] },
      'manager-2',
    )

    expect(result.usedPendingLocalSnapshot).toBe(true)
    expect(result.pendingTargetClassroomIds).toEqual(['development'])
    expect(result.snapshot.currentUserId).toBe('manager-2')
    expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual(['2026-08-13'])
  })

  it('preserves a recent developer classroom selection across reload', () => {
    const remoteSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:00:00.000Z', 'classroom-1', 'board')
    const localSnapshot = createDeveloperWorkspaceSnapshot(new Date().toISOString(), 'development', 'backup-restore')

    const result = resolveRemoteWorkspaceSnapshot(remoteSnapshot, localSnapshot, null, 'developer-1')

    expect(result.usedPendingLocalSnapshot).toBe(false)
    expect(result.snapshot.actingClassroomId).toBe('development')
    expect(result.snapshot.classrooms.find((classroom) => classroom.id === 'development')?.data.screen).toBe('backup-restore')
  })
})

describe('buildDevelopmentClassroomCopyPayload', () => {
  it('keeps classroom data while removing environment-specific sharing tokens', () => {
    const sourcePayload: AppSnapshotPayload = {
      screen: 'special-data',
      classroomSettings: {
        closedWeekdays: [0],
        holidayDates: ['2026-08-13'],
        forceOpenDates: ['2026-08-14'],
        deskCount: 14,
        boardShareToken: 'board-share-token',
      },
      managers: [],
      teachers: [],
      students: [],
      regularLessons: [],
      groupLessons: [],
      specialSessions: [{
        id: 'session-1',
        label: '夏期講習',
        startDate: '2026-08-10',
        endDate: '2026-08-20',
        teacherInputs: {
          'teacher-1': {
            unavailableSlots: ['2026-08-12_2'],
            countSubmitted: true,
            submissionToken: 'teacher-token',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        },
        studentInputs: {
          'student-1': {
            unavailableSlots: ['2026-08-12_1'],
            regularBreakSlots: ['2026-08-13_2'],
            subjectSlots: { 数: 2 },
            regularOnly: false,
            countSubmitted: true,
            submissionToken: 'student-token',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        },
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }],
      autoAssignRules: [],
      pairConstraints: [],
      boardState: null,
    }

    const copied = buildDevelopmentClassroomCopyPayload(sourcePayload)

    expect(copied.screen).toBe('board')
    expect(copied.classroomSettings.boardShareToken).toBe('')
    expect(copied.classroomSettings.holidayDates).toEqual(['2026-08-13'])
    expect(copied.specialSessions[0]?.studentInputs['student-1']).toEqual(expect.objectContaining({
      unavailableSlots: ['2026-08-12_1'],
      regularBreakSlots: ['2026-08-13_2'],
      subjectSlots: { 数: 2 },
      regularOnly: false,
      countSubmitted: true,
      updatedAt: '2026-08-01T00:00:00.000Z',
    }))
    expect(copied.specialSessions[0]?.studentInputs['student-1']?.submissionToken).toBeUndefined()
    expect(copied.specialSessions[0]?.teacherInputs['teacher-1']?.submissionToken).toBeUndefined()
    expect(sourcePayload.classroomSettings.boardShareToken).toBe('board-share-token')
    expect(sourcePayload.specialSessions[0]?.studentInputs['student-1']?.submissionToken).toBe('student-token')
    expect(sourcePayload.specialSessions[0]?.teacherInputs['teacher-1']?.submissionToken).toBe('teacher-token')
  })
})

describe('buildWorkspaceNavigationSnapshot', () => {
  it('updates the acting classroom and persists the opened classroom screen', () => {
    const snapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:00:00.000Z', 'classroom-1', 'board')

    const result = buildWorkspaceNavigationSnapshot({
      snapshot,
      classroomId: 'development',
      nextScreen: 'backup-restore',
      savedAt: '2026-05-26T10:00:05.000Z',
    })

    expect(result.actingClassroomId).toBe('development')
    expect(result.savedAt).toBe('2026-05-26T10:00:05.000Z')
    expect(result.classrooms.find((classroom) => classroom.id === 'development')?.data.screen).toBe('backup-restore')
  })
})
