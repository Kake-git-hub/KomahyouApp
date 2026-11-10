// tools/ui-patrol/seed.mjs(伏せ字の教室データ → ローカルモードの教室データ一式)を固定する。
// アプリの読み込み(parseWorkspaceSnapshot)がそのまま受け付け、室長でログイン済み・担当教室の盤面が開く形であること。
// フィクスチャは架空の伏せ字データだけ。
import { describe, it, expect } from 'vitest'
import { buildPatrolWorkspaceSnapshot, PATROL_CLASSROOM_NAME, PATROL_MANAGER_USER_ID } from './seed.mjs'
import { parseWorkspaceSnapshot } from '../../src/data/appSnapshotRepository'
import { anonymizeClassroomPayload } from './anonymize.ts'

const SAVED_AT = '2026-11-11T00:00:00.000Z'

function makePayload() {
  return {
    screen: 'basic-data',
    classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 2 },
    managers: [{ id: 'm1', name: '室長1', email: '' }],
    teachers: [{ id: 't005', name: '講師005', email: '', entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [] }],
    students: [{ id: 's092', name: '生徒092', displayName: '', email: '', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: null,
  }
}

function collectStrings(value, key, out) {
  if (typeof value === 'string') out.push([key, value])
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, key, out))
  else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) collectStrings(child, childKey, out)
  return out
}

describe('種データ(buildPatrolWorkspaceSnapshot)', () => {
  it('アプリの読み込み（parseWorkspaceSnapshot）が受け付ける形', () => {
    const payload = makePayload()
    const seed = buildPatrolWorkspaceSnapshot({ classroomId: 'room1', payload, savedAt: SAVED_AT })
    expect(parseWorkspaceSnapshot(JSON.stringify(seed))).not.toBeNull()
    expect(seed.savedAt).toBe(SAVED_AT)
  })

  it('室長でログイン済み・担当教室が開く形（currentUserId・assignedClassroomId・actingClassroomId・screen=board）', () => {
    const payload = makePayload()
    const frozen = JSON.stringify(payload)
    const seed = buildPatrolWorkspaceSnapshot({ classroomId: 'room1', payload, savedAt: SAVED_AT })
    expect(PATROL_MANAGER_USER_ID).toBe('patrol_manager')
    expect(seed.currentUserId).toBe('patrol_manager')
    expect(seed.actingClassroomId).toBe('room1')
    const manager = seed.users.find((user) => user.id === 'patrol_manager')
    expect(manager).toMatchObject({ role: 'manager', assignedClassroomId: 'room1' })
    expect(seed.users.filter((user) => user.role === 'developer')).toHaveLength(1)
    expect(seed.users.find((user) => user.role === 'developer').assignedClassroomId).toBeNull()
    expect(seed.classrooms).toHaveLength(1)
    const [classroom] = seed.classrooms
    expect(classroom).toMatchObject({ id: 'room1', name: PATROL_CLASSROOM_NAME, managerUserId: 'patrol_manager', contractStatus: 'active' })
    expect(PATROL_CLASSROOM_NAME).toBe('巡回用教室')
    expect(classroom.data.screen).toBe('board')
    expect(classroom.data.students).toEqual(payload.students)
    // 入力の payload は書き換えない
    expect(JSON.stringify(payload)).toBe(frozen)
  })

  it('メールアドレスは example.invalid。実在の値を持たない', () => {
    const seed = buildPatrolWorkspaceSnapshot({ classroomId: 'room1', payload: makePayload(), savedAt: SAVED_AT })
    for (const user of seed.users) expect(user.email).toMatch(/@example\.invalid$/)
    const emails = collectStrings(seed, '', []).filter(([key]) => key === 'email').map(([, value]) => value)
    expect(emails.length).toBeGreaterThan(0)
    for (const email of emails) expect(email === '' || email.endsWith('@example.invalid')).toBe(true)
    expect(seed.developerPassword).toBeUndefined()
  })

  it('伏せ字のあとの payload を種データにしても parseWorkspaceSnapshot が通る', () => {
    const input = makePayload()
    input.students[0].name = '甲野　一郎'
    input.students[0].email = 'someone@example.com'
    const { payload } = anonymizeClassroomPayload(input)
    const seed = buildPatrolWorkspaceSnapshot({ classroomId: 'room1', payload, savedAt: SAVED_AT })
    const parsed = parseWorkspaceSnapshot(JSON.stringify(seed))
    expect(parsed.classrooms[0].data.students[0].name).toBe('生徒092　名')
    expect(JSON.stringify(parsed)).not.toContain('甲野')
  })
})
