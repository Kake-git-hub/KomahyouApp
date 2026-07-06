import { describe, expect, it } from 'vitest'
import { applyIssuedSubmissionTokensToSessions, buildClassroomScopedBoardShareToken, buildDevelopmentClassroomCopyPayload, buildSubmissionAcknowledgementEntries, buildTeacherAutoAssignItems, buildWorkspaceNavigationSnapshot, clampScreenForUserRole, hasPendingBoardSaveState, resolveHydratedScreenForUser, resolveInitialScreenForUser, resolveRemoteWorkspaceSnapshot, resolveWorkspaceSyncTargetClassrooms, sanitizeClassroomSettings, shouldInjectEditingStateIntoClassroom, shouldReturnDeveloperOnLogout, shouldSyncCurrentClassroomBeforeOpen, shouldSyncWorkspaceOnVisibilityHidden, type ClassroomSettings } from './App'
import type { AppSnapshotPayload, WorkspaceClassroom, WorkspaceSnapshot } from './types/appState'
import type { SpecialSessionRow } from './components/special-data/specialSessionModel'
import type { SubmissionChangeEntry } from './integrations/firebase/lectureSubmission'

describe('resolveWorkspaceSyncTargetClassrooms (本番データ混入防止)', () => {
  const cls = (id: string): WorkspaceClassroom => ({
    id, name: id, contractStatus: 'active', contractStartDate: '', contractEndDate: '',
    managerUserId: '', data: {} as never,
  })
  const all = [cls('dev'), cls('a'), cls('b')]

  it('対象ID指定時はそのID群だけを書く', () => {
    expect(resolveWorkspaceSyncTargetClassrooms(all, ['a'], 'dev').map((c) => c.id)).toEqual(['a'])
    expect(resolveWorkspaceSyncTargetClassrooms(all, ['a', 'b'], 'dev').map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('対象未指定でも【全教室】は書かず、操作中の教室のみに限定する(混入の増幅器を塞ぐ)', () => {
    expect(resolveWorkspaceSyncTargetClassrooms(all, undefined, 'dev').map((c) => c.id)).toEqual(['dev'])
    expect(resolveWorkspaceSyncTargetClassrooms(all, [], 'dev').map((c) => c.id)).toEqual(['dev'])
  })

  it('対象未指定かつ操作中教室不明なら何も書かない(安全側)', () => {
    expect(resolveWorkspaceSyncTargetClassrooms(all, undefined, null)).toEqual([])
  })
})

describe('shouldInjectEditingStateIntoClassroom (本番データ混入防止・2026-06-21 回帰防止)', () => {
  it('acting かつ編集stateの出所が acting と一致する教室にだけ編集 state を反映する', () => {
    expect(shouldInjectEditingStateIntoClassroom('A', 'A', 'A')).toBe(true)
  })

  it('編集 state の出所が acting と違う場合は書き込まない(別教室の名簿で上書き汚染を防ぐ)', () => {
    // 例: 開発者画面着地で acting=日大前(A) のまま、編集 state は前に開いた別教室(B)の名簿。
    // この状態で A へ書くと A が B のデータで汚染される。→ 反映しない。
    expect(shouldInjectEditingStateIntoClassroom('A', 'A', 'B')).toBe(false)
  })

  it('対象教室が acting でなければ反映しない', () => {
    expect(shouldInjectEditingStateIntoClassroom('B', 'A', 'A')).toBe(false)
  })

  it('acting 不明 / 出所不明なら反映しない(安全側)', () => {
    expect(shouldInjectEditingStateIntoClassroom('A', null, 'A')).toBe(false)
    expect(shouldInjectEditingStateIntoClassroom('A', 'A', null)).toBe(false)
    expect(shouldInjectEditingStateIntoClassroom('A', null, null)).toBe(false)
  })
})

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
      groupClassParticipation: {},
      optionChecks: {},
      regularOnly: false,
    }, {
      token: 'teacher-token',
      sessionId: 'session-1',
      personType: 'teacher',
      personId: 'teacher-1',
      unavailableSlots: [],
      subjectSlots: {},
      subjectDurations: {},
      groupClassParticipation: {},
      optionChecks: {},
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

  // A3(2026-07-06): 多端末 stale 書き戻し防止。savedAt(壁時計)ではローカルが新しく見えても、
  // 別端末が後からその教室を保存済み(サーバー版数がマーカー基準版数より進行)なら上書きしない。
  describe('教室単位の版数ゲート (別端末の後保存を stale ローカルで上書きしない)', () => {
    it('サーバー版数が基準版数より進んでいれば、savedAt がローカル勝ちでもリモートを優先する(修正前は落ちる)', () => {
      const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
      const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        {
          savedAt: localSnapshot.savedAt,
          authenticatedUserId: 'manager-1',
          targetClassroomIds: ['classroom-1'],
          baseClassroomVersions: { 'classroom-1': 3 },
        },
        'manager-1',
        // 別端末が後から classroom-1 を保存 → サーバー版数=5 > 基準版数=3。
        { 'classroom-1': 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(false)
      expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
    })

    it('サーバー版数が基準版数と一致していれば、従来どおりローカルを書き戻す', () => {
      const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
      const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        {
          savedAt: localSnapshot.savedAt,
          authenticatedUserId: 'manager-1',
          targetClassroomIds: ['classroom-1'],
          baseClassroomVersions: { 'classroom-1': 5 },
        },
        'manager-1',
        { 'classroom-1': 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(true)
      expect(result.pendingTargetClassroomIds).toEqual(['classroom-1'])
      expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual(['2026-08-13'])
    })

    it('版数情報の無い旧マーカーは従来の savedAt 挙動を維持する(後方互換)', () => {
      const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
      const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        { savedAt: localSnapshot.savedAt, authenticatedUserId: 'manager-1', targetClassroomIds: ['classroom-1'] },
        'manager-1',
        { 'classroom-1': 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(true)
      expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual(['2026-08-13'])
    })

    // 部分マージ分岐: 対象教室の一部だけが stale のとき、safe な教室のみローカルを書き戻し、
    // stale な教室はリモート最新を維持する。pendingTargetClassroomIds も safe のみに絞られ、
    // Firebase への書き戻し(queueFirebaseWorkspaceSync)に stale 教室が渡らないことを固定する。
    it('複数教室のうち stale な教室だけリモートを維持し、safe な教室のみローカルを書き戻す(部分マージ)', () => {
      const remoteSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:00:00.000Z', 'classroom-1')
      const localSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:01:00.000Z', 'classroom-1')
      const localClassroom1 = localSnapshot.classrooms.find((classroom) => classroom.id === 'classroom-1')
      const localDevelopment = localSnapshot.classrooms.find((classroom) => classroom.id === 'development')
      if (!localClassroom1 || !localDevelopment) throw new Error('test fixture classroom missing')
      localClassroom1.data.classroomSettings.holidayDates = ['2026-08-13']
      localDevelopment.data.classroomSettings.holidayDates = ['2026-08-14']

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        {
          savedAt: localSnapshot.savedAt,
          authenticatedUserId: 'developer-1',
          targetClassroomIds: ['classroom-1', 'development'],
          baseClassroomVersions: { 'classroom-1': 3, development: 5 },
        },
        'developer-1',
        // classroom-1 は別端末が後保存(5>3)= stale。development は一致(5=5)= safe。
        { 'classroom-1': 5, development: 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(true)
      expect(result.pendingTargetClassroomIds).toEqual(['development'])
      const mergedClassroom1 = result.snapshot.classrooms.find((classroom) => classroom.id === 'classroom-1')
      const mergedDevelopment = result.snapshot.classrooms.find((classroom) => classroom.id === 'development')
      // stale な classroom-1 はリモート(空)を維持し、safe な development はローカルを採用する。
      expect(mergedClassroom1?.data.classroomSettings.holidayDates).toEqual([])
      expect(mergedDevelopment?.data.classroomSettings.holidayDates).toEqual(['2026-08-14'])
    })

    // manager 専用パス(別ユーザーのマーカー→担当教室のみ書き戻し)にも版数ゲートが効くことを固定する。
    // App.test の他ケースは marker.authenticatedUserId===authenticatedUserId のため main パスに流れ、
    // resolvePendingLocalClassroomSnapshotForAuthenticatedUser 内のゲートを通らない。
    it('manager 専用パス: 別端末が担当教室を後保存済みならローカルで上書きしない', () => {
      const remoteSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:00:00.000Z', 'development')
      remoteSnapshot.currentUserId = 'manager-2'
      const localSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:01:00.000Z', 'development')
      const localDevelopment = localSnapshot.classrooms.find((classroom) => classroom.id === 'development')
      if (!localDevelopment) throw new Error('test fixture classroom missing')
      localDevelopment.data.classroomSettings.holidayDates = ['2026-08-13']

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        {
          savedAt: localSnapshot.savedAt,
          authenticatedUserId: 'developer-1',
          targetClassroomIds: ['development'],
          baseClassroomVersions: { development: 3 },
        },
        'manager-2',
        // 別端末が後から development を保存 → サーバー版数=5 > 基準版数=3。
        { development: 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(false)
      expect(result.snapshot.classrooms.find((classroom) => classroom.id === 'development')?.data.classroomSettings.holidayDates).toEqual([])
    })

    it('manager 専用パス: 版数が一致していれば従来どおり担当教室のローカルを書き戻す', () => {
      const remoteSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:00:00.000Z', 'development')
      remoteSnapshot.currentUserId = 'manager-2'
      const localSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:01:00.000Z', 'development')
      const localDevelopment = localSnapshot.classrooms.find((classroom) => classroom.id === 'development')
      if (!localDevelopment) throw new Error('test fixture classroom missing')
      localDevelopment.data.classroomSettings.holidayDates = ['2026-08-13']

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        {
          savedAt: localSnapshot.savedAt,
          authenticatedUserId: 'developer-1',
          targetClassroomIds: ['development'],
          baseClassroomVersions: { development: 5 },
        },
        'manager-2',
        { development: 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(true)
      expect(result.pendingTargetClassroomIds).toEqual(['development'])
      expect(result.snapshot.classrooms.find((classroom) => classroom.id === 'development')?.data.classroomSettings.holidayDates).toEqual(['2026-08-13'])
    })

    it('同一端末・自分の保存でも成立: 保存でサーバー版数が進んだ(v11>基準v10)なら、残存した旧マーカーの書き戻しをブロックする', () => {
      // 単一PCシーケンス: 編集(基準版数v10でマーカー記録)→保存成功(サーバーv11)。もしマーカーが
      // 何らかの理由で消えず残っていても、版数ゲートで stale と判定してリモート(=保存済み最新)を優先する。
      // これにより「割振り前のローカルキャッシュが再開時に書き戻されて割振りが消える」経路を、
      // 別端末に限らず同一端末でも塞ぐことを固定する。
      const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
      const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:05:00.000Z', ['2026-08-13'])

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        {
          savedAt: localSnapshot.savedAt,
          authenticatedUserId: 'manager-1',
          targetClassroomIds: ['classroom-1'],
          baseClassroomVersions: { 'classroom-1': 10 },
        },
        'manager-1',
        { 'classroom-1': 11 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(false)
      expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
    })
  })
})

// A4(2026-07-06): 講習提出トークン自動発行の反映は、await(writeSubmissionDocs)を挟むため
// current(最新)へ「新規発行トークンの追加/後埋め」だけをマージする。丸ごと置換だと await 中に
// 届いた別生徒のQR提出反映を古いスナップショットが巻き戻し、未提出配置除去 effect が割振済み講習を外す。
describe('applyIssuedSubmissionTokensToSessions (A4: トークン発行は current へマージ・巻き戻さない)', () => {
  const makeSession = (studentInputs: SpecialSessionRow['studentInputs']): SpecialSessionRow => ({
    id: 'sess1',
    label: '夏期講習',
    startDate: '2026-07-20',
    endDate: '2026-08-31',
    teacherInputs: {},
    studentInputs,
    createdAt: '',
    updatedAt: '',
  })

  it('await 中に別生徒が提出済みへ変わっても巻き戻さず、新規トークンだけ追加する', () => {
    const current = [makeSession({
      'stu-a': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 算数: 3 }, regularOnly: false, countSubmitted: true, updatedAt: '' },
    })]
    const result = applyIssuedSubmissionTokensToSessions(current, 'sess1', [
      { personType: 'student', personId: 'stu-b', token: 'tok-b' },
    ], '2026-07-06T00:00:00.000Z')
    const session = result[0]!
    // stu-a は current のまま(提出済み・subjectSlots 保持)。古いスナップショットで巻き戻さない。
    expect(session.studentInputs['stu-a']!.countSubmitted).toBe(true)
    expect(session.studentInputs['stu-a']!.subjectSlots).toEqual({ 算数: 3 })
    // stu-b は新規未提出エントリ + トークン。
    expect(session.studentInputs['stu-b']!.countSubmitted).toBe(false)
    expect(session.studentInputs['stu-b']!.submissionToken).toBe('tok-b')
  })

  it('既存エントリはトークンが無いときだけ後埋めし、countSubmitted は変えない', () => {
    const current = [makeSession({
      'stu-a': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 算数: 3 }, regularOnly: false, countSubmitted: true, updatedAt: '' },
    })]
    const result = applyIssuedSubmissionTokensToSessions(current, 'sess1', [
      { personType: 'student', personId: 'stu-a', token: 'tok-a' },
    ], '2026-07-06T00:00:00.000Z')
    expect(result[0]!.studentInputs['stu-a']!.countSubmitted).toBe(true)
    expect(result[0]!.studentInputs['stu-a']!.submissionToken).toBe('tok-a')
  })

  it('既にトークンを持つ既存エントリは変更しない(参照維持・上書きしない)', () => {
    const current = [makeSession({
      'stu-a': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 算数: 3 }, regularOnly: false, countSubmitted: true, submissionToken: 'orig', updatedAt: '' },
    })]
    const result = applyIssuedSubmissionTokensToSessions(current, 'sess1', [
      { personType: 'student', personId: 'stu-a', token: 'tok-new' },
    ], '2026-07-06T00:00:00.000Z')
    expect(result[0]!).toBe(current[0]!)
    expect(result[0]!.studentInputs['stu-a']!.submissionToken).toBe('orig')
  })

  it('発行トークンが空なら参照そのまま(no-op)', () => {
    const current = [makeSession({})]
    expect(applyIssuedSubmissionTokensToSessions(current, 'sess1', [], 'x')).toBe(current)
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

  // 【本番データ混入防止・回帰防止】コピー先(開発用)とコピー元(他教室)が参照を共有してはならない。
  // 共有していると、コピー後に開発用教室を編集するとコピー元(他教室)のデータが書き換わり、
  // 全教室保存で他教室の Firestore に開発用データが混入する(実際に発生した事故)。
  it('コピー先と元が一切の参照を共有しない(他教室データ混入防止)', () => {
    const sourcePayload: AppSnapshotPayload = {
      screen: 'board',
      classroomSettings: {
        closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 14,
        regularLessonTemplate: { version: 1, effectiveStartDate: '2026-04-01', savedAt: '', cells: [{ dayOfWeek: 1, slotNumber: 1, desks: [] }] } as never,
      },
      managers: [],
      teachers: [{ id: 't1', name: '田中', email: '', entryDate: '', withdrawDate: '未定', subjectCapabilities: [] } as never],
      students: [{ id: 's1', name: '生徒', displayName: '生徒', email: '', entryDate: '', withdrawDate: '未定', birthDate: '' } as never],
      regularLessons: [{ id: 'r1' } as never],
      groupLessons: [],
      specialSessions: [],
      autoAssignRules: [],
      pairConstraints: [],
      boardState: null,
    }

    const copied = buildDevelopmentClassroomCopyPayload(sourcePayload)

    // 配列・要素・テンプレが別参照であること
    expect(copied.students).not.toBe(sourcePayload.students)
    expect(copied.teachers).not.toBe(sourcePayload.teachers)
    expect(copied.regularLessons).not.toBe(sourcePayload.regularLessons)
    expect(copied.students[0]).not.toBe(sourcePayload.students[0])
    expect(copied.classroomSettings.regularLessonTemplate).not.toBe(sourcePayload.classroomSettings.regularLessonTemplate)

    // コピー先を編集してもコピー元は不変であること
    ;(copied.students[0] as { name: string }).name = 'DEV-EDIT'
    copied.students.push({ id: 'sX' } as never)
    ;(copied.regularLessons[0] as { id: string }).id = 'DEV'
    expect((sourcePayload.students[0] as { name: string }).name).toBe('生徒')
    expect(sourcePayload.students).toHaveLength(1)
    expect((sourcePayload.regularLessons[0] as { id: string }).id).toBe('r1')
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

describe('shouldSyncWorkspaceOnVisibilityHidden (A2: 放置タブの上書き防止)', () => {
  const base = {
    isHidden: true,
    hasWorkspaceData: true,
    isRemoteBackendEnabled: true,
    remoteSessionUserId: 'user-1',
    hasUnsavedChanges: true,
  }

  it('未変更ならタブを隠してもクラウド同期しない(放置タブ上書きの主因を断つ)', () => {
    expect(shouldSyncWorkspaceOnVisibilityHidden({ ...base, hasUnsavedChanges: false })).toBe(false)
  })

  it('未保存変更があり、隠れた・データあり・ログイン済みなら同期する', () => {
    expect(shouldSyncWorkspaceOnVisibilityHidden(base)).toBe(true)
  })

  it('まだ隠れていない(可視)なら同期しない', () => {
    expect(shouldSyncWorkspaceOnVisibilityHidden({ ...base, isHidden: false })).toBe(false)
  })

  it('ワークスペース未読込なら同期しない', () => {
    expect(shouldSyncWorkspaceOnVisibilityHidden({ ...base, hasWorkspaceData: false })).toBe(false)
  })

  it('リモート未ログインなら同期しない', () => {
    expect(shouldSyncWorkspaceOnVisibilityHidden({ ...base, remoteSessionUserId: null })).toBe(false)
    expect(shouldSyncWorkspaceOnVisibilityHidden({ ...base, isRemoteBackendEnabled: false })).toBe(false)
  })
})

describe('buildTeacherAutoAssignItems (QR一括提出で講師全員を配置・2026-06-30 回帰防止)', () => {
  const entry = (personType: 'student' | 'teacher', sessionId: string, personId: string) => ({ personType, sessionId, personId })

  it('同一バッチで複数講師が届いても全員ぶんの assign アイテムを作る(最後の1人に取りこぼさない)', () => {
    // 不具合の本体: 以前は1人ずつ setTeacherAutoAssignRequest で単一stateを上書きし、最後の講師しか
    // 盤面配置されなかった。全件を items にまとめることで取りこぼさない。
    const items = buildTeacherAutoAssignItems([
      entry('teacher', 's1', 't1'),
      entry('teacher', 's1', 't2'),
      entry('teacher', 's1', 't3'),
    ])
    expect(items).toEqual([
      { sessionId: 's1', teacherId: 't1', mode: 'assign' },
      { sessionId: 's1', teacherId: 't2', mode: 'assign' },
      { sessionId: 's1', teacherId: 't3', mode: 'assign' },
    ])
  })

  it('生徒の提出は対象外(講師ぶんだけを assign で返す)', () => {
    const items = buildTeacherAutoAssignItems([
      entry('student', 's1', 'stu1'),
      entry('teacher', 's1', 't1'),
      entry('student', 's2', 'stu2'),
    ])
    expect(items).toEqual([{ sessionId: 's1', teacherId: 't1', mode: 'assign' }])
  })

  it('講師が居なければ空配列(リクエストを発行しない)', () => {
    expect(buildTeacherAutoAssignItems([entry('student', 's1', 'stu1')])).toEqual([])
    expect(buildTeacherAutoAssignItems([])).toEqual([])
  })
})
