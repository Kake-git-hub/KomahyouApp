// Firestore セキュリティルールの分離保証テスト(層2: 本番critical)。
// 2026-06-06 の教室クロス汚染インシデント級を「ルールが弾く」ことをエミュレータで検証する。
// 実行: `npm run test:rules`(firestore エミュレータを起動して走らせる)。毎push ゲートには含めない。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const WORKSPACE = 'main'
let testEnv: RulesTestEnvironment

// 開発者(billing対象メール) / 教室A担当マネージャー / 教室B担当マネージャー
const DEV = 'dev-uid'
const MGR_A = 'mgrA-uid'
const MGR_B = 'mgrB-uid'

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-komahyou-rules',
    firestore: {
      rules: readFileSync(resolve('firebase/firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  // ルール迂回でメンバー台帳と教室ドキュメントを用意する。
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, `workspaces/${WORKSPACE}/members/${DEV}`), { role: 'developer', email: 'bkkdmzn@gmail.com' })
    await setDoc(doc(db, `workspaces/${WORKSPACE}/members/${MGR_A}`), { role: 'manager', assignedClassroomId: 'A', email: 'a@example.com' })
    await setDoc(doc(db, `workspaces/${WORKSPACE}/members/${MGR_B}`), { role: 'manager', assignedClassroomId: 'B', email: 'b@example.com' })
    await setDoc(doc(db, `workspaces/${WORKSPACE}/classrooms/A`), { name: '教室A' })
    await setDoc(doc(db, `workspaces/${WORKSPACE}/classrooms/B`), { name: '教室B' })
    await setDoc(doc(db, `workspaces/${WORKSPACE}/classroomSnapshots/A`), { version: 1 })
  })
})

const dbFor = (uid: string, email: string) => testEnv.authenticatedContext(uid, { email }).firestore()
const mgrAdb = () => dbFor(MGR_A, 'a@example.com')
const devdb = () => dbFor(DEV, 'bkkdmzn@gmail.com')

describe('Firestore rules: 教室アクセスの分離', () => {
  it('マネージャーは自分の担当教室を読める', async () => {
    await assertSucceeds(getDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/classrooms/A`)))
  })

  it('マネージャーは担当外の教室を読めない(クロス汚染の入口を塞ぐ)', async () => {
    await assertFails(getDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/classrooms/B`)))
  })

  it('開発者は任意の教室を読める', async () => {
    await assertSucceeds(getDoc(doc(devdb(), `workspaces/${WORKSPACE}/classrooms/B`)))
  })

  it('未参加ユーザーは教室を読めない', async () => {
    const outsider = testEnv.authenticatedContext('outsider-uid', { email: 'x@example.com' }).firestore()
    await assertFails(getDoc(doc(outsider, `workspaces/${WORKSPACE}/classrooms/A`)))
  })
})

describe('Firestore rules: 保存の裏口を塞ぐ(直書きは開発者のみ)', () => {
  it('マネージャーは自教室でも classroomSnapshots を直書きできない(CF経由のみ)', async () => {
    await assertFails(setDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A`), { version: 2 }))
  })

  it('マネージャーは担当外教室の classroomSnapshots を直書きできない', async () => {
    await assertFails(setDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/classroomSnapshots/B`), { version: 2 }))
  })

  it('開発者は classroomSnapshots を直書きできる(教室作成の初期化用)', async () => {
    await assertSucceeds(setDoc(doc(devdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A`), { version: 2 }))
  })

  it('マネージャーは classrooms/classroomSettings を直書きできない', async () => {
    await assertFails(setDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/classrooms/A`), { name: 'x' }))
    await assertFails(setDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/classroomSettings/A`), { foo: 1 }))
  })
})

describe('Firestore rules: members(権限台帳)の保護', () => {
  it('マネージャーは自分の member doc を読めるが他人のは読めない', async () => {
    await assertSucceeds(getDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/members/${MGR_A}`)))
    await assertFails(getDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/members/${MGR_B}`)))
  })

  it('マネージャーは member doc を書き換えられない(権限昇格を防ぐ)', async () => {
    await assertFails(setDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/members/${MGR_A}`), { role: 'developer', email: 'a@example.com' }))
  })

  it('開発者は member doc を読み書きできる', async () => {
    await assertSucceeds(getDoc(doc(devdb(), `workspaces/${WORKSPACE}/members/${MGR_B}`)))
    await assertSucceeds(setDoc(doc(devdb(), `workspaces/${WORKSPACE}/members/${MGR_A}`), { role: 'manager', assignedClassroomId: 'A', email: 'a@example.com' }))
  })
})

describe('Firestore rules: billing は billing開発者のみ', () => {
  it('billing対象メールの開発者は billingMonths を読める', async () => {
    await assertSucceeds(getDoc(doc(devdb(), `workspaces/${WORKSPACE}/billingMonths/2026-06`)))
  })

  it('マネージャーは billingMonths を読めない', async () => {
    await assertFails(getDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/billingMonths/2026-06`)))
  })
})
