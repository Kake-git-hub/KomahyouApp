import { describe, expect, it } from 'vitest'
import { requiresClassroomExistenceCheck, resolveClassroomAccessDecision } from './classroomAccess'

// 越境ガード(T0-3)の回帰防止。修正前は developer が classroomId を一切検証されず素通りしていたので、
// 「存在しない教室 ID で developer が通らない」ケースは修正なしでは落ちる。
describe('resolveClassroomAccessDecision(テナント越境ガード)', () => {
  it('開発者は「その会社に実在する教室」なら通る', () => {
    expect(resolveClassroomAccessDecision({ role: 'developer' }, 'A', true)).toEqual({ allowed: true, via: 'developer' })
  })

  it('開発者でも存在しない教室 ID は not-found(別会社の教室 ID を渡しても通らない)', () => {
    expect(resolveClassroomAccessDecision({ role: 'developer' }, 'A', false)).toEqual({ allowed: false, reason: 'classroom-not-found' })
  })

  it('開発者で存在確認をしていない(undefined)ときは通さない(fail closed)', () => {
    expect(resolveClassroomAccessDecision({ role: 'developer' }, 'A')).toEqual({ allowed: false, reason: 'classroom-not-found' })
  })

  it('室長は担当教室なら通る(存在確認は不要＝読み取りを増やさない)', () => {
    expect(resolveClassroomAccessDecision({ role: 'manager', assignedClassroomId: 'A' }, 'A')).toEqual({ allowed: true, via: 'assigned-manager' })
  })

  it('室長は担当外の教室では通らない(既存の教室分離)', () => {
    expect(resolveClassroomAccessDecision({ role: 'manager', assignedClassroomId: 'A' }, 'B')).toEqual({ allowed: false, reason: 'forbidden' })
  })

  it('担当教室が未設定のメンバーは通らない', () => {
    expect(resolveClassroomAccessDecision({ role: 'manager' }, 'A')).toEqual({ allowed: false, reason: 'forbidden' })
    expect(resolveClassroomAccessDecision({ role: 'manager', assignedClassroomId: null }, 'A')).toEqual({ allowed: false, reason: 'forbidden' })
    expect(resolveClassroomAccessDecision(undefined, 'A')).toEqual({ allowed: false, reason: 'forbidden' })
  })

  it('role 未設定でも assignedClassroomId 一致なら通る(既存挙動を変えない)', () => {
    expect(resolveClassroomAccessDecision({ assignedClassroomId: 'A' }, 'A')).toEqual({ allowed: true, via: 'assigned-manager' })
  })

  it('存在確認が要るのは開発者だけ(室長の保存で Firestore 読み取りを増やさない)', () => {
    expect(requiresClassroomExistenceCheck({ role: 'developer' })).toBe(true)
    expect(requiresClassroomExistenceCheck({ role: 'manager', assignedClassroomId: 'A' })).toBe(false)
    expect(requiresClassroomExistenceCheck(undefined)).toBe(false)
  })
})
