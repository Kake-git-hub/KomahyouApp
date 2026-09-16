import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

// ───────────────────────────────────────────────────────────────────────────
// 配線(source-scan): 純関数が正しくても、index.ts の呼び出し側が事実を取り違えるとガードは死ぬ。
// 作法は developerReport.test.ts と同じ字面スキャン(functions には実行/描画テスト環境が無い)。
// ここが落ちる代表的な改悪:
//  - classroomExists に定数 true を渡す(＝ developer が常に通り、会社の壁＝越境ガードが消える)
//  - developer 以外にも教室 doc の読みを常に走らせる(＝室長の保存ごとに Firestore 読み取りが 1 回増える)
// ───────────────────────────────────────────────────────────────────────────
describe('requireClassroomAccessMember の配線(index.ts・2026-09-16 Phase 0 / T0-3)', () => {
  const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
  const start = indexTs.indexOf('async function requireClassroomAccessMember')
  const body = indexTs.slice(start, indexTs.indexOf('function buildTemporaryPassword', start))

  it('判定は純関数 resolveClassroomAccessDecision に委譲する(index.ts 側に規則を書き戻さない)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(indexTs).toContain("import { requiresClassroomExistenceCheck, resolveClassroomAccessDecision } from './classroomAccess'")
    expect(body).toContain('const decision = resolveClassroomAccessDecision(member, classroomId, classroomExists)')
  })

  it('教室 doc の存在は「実際に読んだ結果」を渡す(定数 true を渡さない)', () => {
    expect(body).toContain("? (await firestore.collection('workspaces').doc(workspaceKey).collection('classrooms').doc(classroomId).get()).exists")
    expect(body).not.toMatch(/resolveClassroomAccessDecision\(member, classroomId, (true|false)\)/u)
    expect(body).not.toMatch(/const classroomExists = (true|false)\b/u)
  })

  it('読みは developer のときだけ(条件は requiresClassroomExistenceCheck・未確認は undefined で fail closed)', () => {
    expect(body).toContain('const classroomExists = requiresClassroomExistenceCheck(member)')
    expect(body).toContain(': undefined')
    // 教室 doc の読みはこの三項の中に 1 回だけ。無条件の読み(常時 await)へ広げない。
    const classroomReads = body.match(/collection\('classrooms'\)\.doc\(classroomId\)\.get\(\)/gu) ?? []
    expect(classroomReads.length).toBe(1)
    const readLine = body.split(/\r?\n/u).find((line) => line.includes("collection('classrooms').doc(classroomId).get()")) ?? ''
    expect(readLine.trimStart().startsWith('? '), readLine).toBe(true)
  })

  it('拒否理由の出し分け(not-found / permission-denied)を保つ', () => {
    expect(body).toContain("if (decision.reason === 'classroom-not-found')")
    expect(body).toContain("throw new HttpsError('not-found'")
    expect(body).toContain("throw new HttpsError('permission-denied'")
  })
})
