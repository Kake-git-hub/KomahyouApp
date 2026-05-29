import { describe, expect, it } from 'vitest'
import { resolveRemoteWorkspaceSnapshot, sanitizeClassroomSettings, type ClassroomSettings } from './App'
import type { WorkspaceSnapshot } from './types/appState'

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