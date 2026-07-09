import { describe, expect, it } from 'vitest'
import { applyIssuedSubmissionTokensToSessions, buildClassroomScopedBoardShareToken, buildDevelopmentClassroomCopyPayload, buildSubmissionAcknowledgementEntries, buildTeacherAutoAssignItems, buildWorkspaceNavigationSnapshot, clampScreenForUserRole, hasPendingBoardSaveState, reflectIssuedSubmissionTokens, resolveHydratedScreenForUser, resolveInitialScreenForUser, resolveRemoteWorkspaceSnapshot, resolveWorkspaceSyncTargetClassrooms, sanitizeClassroomSettings, shouldInjectEditingStateIntoClassroom, shouldReturnDeveloperOnLogout, shouldSyncCurrentClassroomBeforeOpen, shouldSyncWorkspaceOnVisibilityHidden, type ClassroomSettings } from './App'
import { resolveNewlyUnsubmittedSessionStudents } from './components/schedule-board/ScheduleBoardScreen'
import { initialStudents, type StudentRow } from './components/basic-data/basicDataModel'
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
  // 「保存し忘れ救済」撤去(2026-07-07 オーナー決定・回帰防止):
  // 旧実装ならマーカー一致+savedAtローカル勝ちで書き戻しが発動した入力でも、常にサーバー最新を採用する。
  // 暗黙の書き戻しは 2026-07-06 本番障害(古い盤面が割振済み講習を上書き)の主因。復活させないこと。
  it('マーカーが揃い savedAt がローカル勝ちでも、ローカルを採用しない(救済撤去・修正前は落ちる)', () => {
    const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
    const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

    const result = resolveRemoteWorkspaceSnapshot(
      remoteSnapshot,
      localSnapshot,
      { savedAt: localSnapshot.savedAt, authenticatedUserId: 'manager-1' },
      'manager-1',
    )

    expect(result.usedPendingLocalSnapshot).toBe(false)
    expect(result.pendingTargetClassroomIds).toBeUndefined()
    expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
  })

  it('keeps Firebase as source of truth when the local snapshot is not marked pending', () => {
    const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
    const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

    const result = resolveRemoteWorkspaceSnapshot(remoteSnapshot, localSnapshot, null, 'manager-1')

    expect(result.usedPendingLocalSnapshot).toBe(false)
    expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
  })

  it('manager 専用パス相当の入力(別ユーザーのマーカー+担当教室)でもローカルを採用しない(救済撤去)', () => {
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

    expect(result.usedPendingLocalSnapshot).toBe(false)
    expect(result.pendingTargetClassroomIds).toBeUndefined()
    expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
  })

  it('preserves a recent developer classroom selection across reload', () => {
    const remoteSnapshot = createDeveloperWorkspaceSnapshot('2026-05-26T10:00:00.000Z', 'classroom-1', 'board')
    const localSnapshot = createDeveloperWorkspaceSnapshot(new Date().toISOString(), 'development', 'backup-restore')

    const result = resolveRemoteWorkspaceSnapshot(remoteSnapshot, localSnapshot, null, 'developer-1')

    expect(result.usedPendingLocalSnapshot).toBe(false)
    expect(result.snapshot.actingClassroomId).toBe('development')
    expect(result.snapshot.classrooms.find((classroom) => classroom.id === 'development')?.data.screen).toBe('backup-restore')
  })

  // 「保存し忘れ救済」撤去(2026-07-07 オーナー決定)の固定。
  // 旧実装(〜v1.5.40x)では以下の入力で「ローカル書き戻し」が発動していた(A3 版数ゲートの許可ケース)。
  // 撤去後はいかなるマーカー・版数条件でもローカルを採用せず、常にサーバー最新を正とする。
  // これらのテストは旧実装では落ちる(=黙った書き戻しが復活したら検知する)。
  describe('未保存ローカルの書き戻しはいかなる条件でも発動しない(救済撤去 2026-07-07)', () => {
    it('版数一致(旧実装なら書き戻し許可)でもローカルを採用しない', () => {
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

      expect(result.usedPendingLocalSnapshot).toBe(false)
      expect(result.pendingTargetClassroomIds).toBeUndefined()
      expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
    })

    it('版数情報の無い旧マーカー(旧実装なら savedAt 勝ちで書き戻し)でもローカルを採用しない', () => {
      const remoteSnapshot = createWorkspaceSnapshot('2026-05-26T10:00:00.000Z', [])
      const localSnapshot = createWorkspaceSnapshot('2026-05-26T10:01:00.000Z', ['2026-08-13'])

      const result = resolveRemoteWorkspaceSnapshot(
        remoteSnapshot,
        localSnapshot,
        { savedAt: localSnapshot.savedAt, authenticatedUserId: 'manager-1', targetClassroomIds: ['classroom-1'] },
        'manager-1',
        { 'classroom-1': 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(false)
      expect(result.snapshot.classrooms[0].data.classroomSettings.holidayDates).toEqual([])
    })

    it('複数教室の部分マージ条件(旧実装なら safe 教室だけ書き戻し)でも全教室リモートを維持する', () => {
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
        { 'classroom-1': 5, development: 5 },
      )

      expect(result.usedPendingLocalSnapshot).toBe(false)
      expect(result.pendingTargetClassroomIds).toBeUndefined()
      const mergedClassroom1 = result.snapshot.classrooms.find((classroom) => classroom.id === 'classroom-1')
      const mergedDevelopment = result.snapshot.classrooms.find((classroom) => classroom.id === 'development')
      expect(mergedClassroom1?.data.classroomSettings.holidayDates).toEqual([])
      expect(mergedDevelopment?.data.classroomSettings.holidayDates).toEqual([])
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

  // 混入防止(2026-07-09): 発行トークンに「発行元教室ID」を刻む。開発用教室で他教室由来トークンを弾く判定に使う。
  it('発行元教室IDを submissionTokenClassroomId に刻む(既存後埋め/新規生徒/新規講師すべて)', () => {
    const current = [makeSession({
      'stu-a': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false, updatedAt: '' },
    })]
    const result = applyIssuedSubmissionTokensToSessions(current, 'sess1', [
      { personType: 'student', personId: 'stu-a', token: 'tok-a' },
      { personType: 'student', personId: 'stu-new', token: 'tok-new' },
      { personType: 'teacher', personId: 'tch-1', token: 'tok-t' },
    ], '2026-07-06T00:00:00.000Z', 'dev-classroom-id')
    const s = result[0]!
    expect(s.studentInputs['stu-a']!.submissionTokenClassroomId).toBe('dev-classroom-id')
    expect(s.studentInputs['stu-new']!.submissionTokenClassroomId).toBe('dev-classroom-id')
    expect(s.teacherInputs['tch-1']!.submissionTokenClassroomId).toBe('dev-classroom-id')
  })

  // 混入防止/QR復活(2026-07-09): 開発用の再発行では、他教室由来・未タグの既存トークンを自教室タグ付きに
  // 差し替える。提出内容(countSubmitted/subjectSlots)は保持し、トークンだけ差し替える(巻き戻さない)。
  it('他教室由来/未タグの既存トークンは自教室タグ付きに差し替え、提出内容は保持する', () => {
    const current = [makeSession({
      'stu-foreign': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 算: 4 }, regularOnly: false, countSubmitted: true, submissionToken: 'old', submissionTokenClassroomId: '5w5OMueE', updatedAt: '' },
      'stu-legacy': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false, submissionToken: 'legacy', updatedAt: '' },
    })]
    const result = applyIssuedSubmissionTokensToSessions(current, 'sess1', [
      { personType: 'student', personId: 'stu-foreign', token: 'new-1' },
      { personType: 'student', personId: 'stu-legacy', token: 'new-2' },
    ], 'x', 'dev')
    const s = result[0]!
    expect(s.studentInputs['stu-foreign']!.submissionToken).toBe('new-1')
    expect(s.studentInputs['stu-foreign']!.submissionTokenClassroomId).toBe('dev')
    expect(s.studentInputs['stu-foreign']!.countSubmitted).toBe(true) // 提出内容は保持
    expect(s.studentInputs['stu-foreign']!.subjectSlots).toEqual({ 算: 4 })
    expect(s.studentInputs['stu-legacy']!.submissionToken).toBe('new-2')
    expect(s.studentInputs['stu-legacy']!.submissionTokenClassroomId).toBe('dev')
  })

  it('既に自教室タグのトークンは差し替えない(冪等・不要な巻き戻しをしない)', () => {
    const current = [makeSession({
      'stu-own': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false, submissionToken: 'own', submissionTokenClassroomId: 'dev', updatedAt: '' },
    })]
    const result = applyIssuedSubmissionTokensToSessions(current, 'sess1', [
      { personType: 'student', personId: 'stu-own', token: 'new' },
    ], 'x', 'dev')
    expect(result[0]!).toBe(current[0]!) // 変更なし=参照維持
    expect(result[0]!.studentInputs['stu-own']!.submissionToken).toBe('own')
  })

  // A4 配線ガード(regression-reviewer 指摘): 呼び出し側が「関数型アップデータで最新 current へマージ」
  // という形を守ることをテストで固定する。旧実装(クロージャに捕捉した stale スナップショットでの
  // 丸ごと置換)に戻すと、await 中に届いた提出反映が消えてこのテストが落ちる。
  it('reflectIssuedSubmissionTokens は関数型アップデータを渡し、setter 実行時点の最新 current にマージする', () => {
    // ensureScheduleSubmissionTokens 開始時点(スナップショット): stu-a は未提出。
    // await writeSubmissionDocs 中に stu-a の QR 提出が反映され、setter 実行時点の current では提出済み。
    const currentAtSetterTime = [makeSession({
      'stu-a': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 数: 4 }, regularOnly: false, countSubmitted: true, updatedAt: '' },
    })]
    let received: ((current: SpecialSessionRow[]) => SpecialSessionRow[]) | null = null
    reflectIssuedSubmissionTokens(
      (updater) => { received = updater },
      'sess1',
      [{ personType: 'student', personId: 'stu-b', token: 'tok-b' }],
      '2026-07-06T00:00:00.000Z',
    )
    // 関数型アップデータであること(=stale 配列の即値置換ではない)。
    expect(typeof received).toBe('function')
    const result = received!(currentAtSetterTime)
    // await 中に提出済みへ変わった stu-a を保持し、新規発行の stu-b だけ追加される。
    expect(result[0]!.studentInputs['stu-a']!.countSubmitted).toBe(true)
    expect(result[0]!.studentInputs['stu-a']!.subjectSlots).toEqual({ 数: 4 })
    expect(result[0]!.studentInputs['stu-b']!.submissionToken).toBe('tok-b')
  })

  // 症状連鎖の端到端固定: トークン発行反映(A4マージ)を挟んでも、提出済みで割振済みの生徒が
  // 「新たに未提出」と誤判定されて配置除去の対象にならないこと(=割り振った講習が数分後に戻らない)。
  it('トークン発行反映後も提出済み生徒は未提出除去の対象にならない(症状の端到端)', () => {
    const student = { ...(initialStudents[0] as StudentRow), id: 'stu-a', name: 'A太郎' }
    const submitted = [makeSession({
      'stu-a': { unavailableSlots: [], regularBreakSlots: [], subjectSlots: { 数: 4 }, regularOnly: false, countSubmitted: true, updatedAt: '' },
    })]
    // 1) stu-a 提出済みの時点で除去判定が走り、基準(提出済み集合)を取り込む。
    const seed = resolveNewlyUnsubmittedSessionStudents({
      specialSessions: submitted,
      students: [student],
      previousSubmittedKeys: null,
    })
    expect(seed.newlyUnsubmitted).toHaveLength(0)
    // 2) トークン発行反映(A4マージ)が走る(stu-b の新規トークン追加のみ・stu-a は保持)。
    const afterTokens = applyIssuedSubmissionTokensToSessions(submitted, 'sess1', [
      { personType: 'student', personId: 'stu-b', token: 'tok-b' },
    ], '2026-07-06T00:00:00.000Z')
    // 3) 再判定: stu-a は提出済みのままなので除去対象ゼロ(旧実装=丸ごと置換で未提出へ巻き戻ると、
    //    基準に居た stu-a が『新たに未提出』となり配置除去=講習巻き戻りが起きていた)。
    const afterReflect = resolveNewlyUnsubmittedSessionStudents({
      specialSessions: afterTokens,
      students: [student],
      previousSubmittedKeys: seed.nextBasisKeys,
    })
    expect(afterReflect.newlyUnsubmitted).toHaveLength(0)
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
            submissionTokenClassroomId: 'source-classroom',
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
            submissionTokenClassroomId: 'source-classroom',
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
    // 混入防止(2026-07-09): 発行元教室タグも外す。開発用側で自教室のトークンを再発行させるため。
    expect(copied.specialSessions[0]?.studentInputs['student-1']?.submissionTokenClassroomId).toBeUndefined()
    expect(copied.specialSessions[0]?.teacherInputs['teacher-1']?.submissionTokenClassroomId).toBeUndefined()
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
