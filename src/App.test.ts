import { describe, expect, it } from 'vitest'
import { buildDevelopmentClassroomCopyPayload, clampScreenForUserRole, resolveHydratedScreenForUser, resolveInitialScreenForUser, resolveRemoteWorkspaceSnapshot, sanitizeClassroomSettings, shouldReturnDeveloperOnLogout, shouldSyncCurrentClassroomBeforeOpen, type ClassroomSettings } from './App'
import type { AppSnapshotPayload, WorkspaceSnapshot } from './types/appState'

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
