// Firestore セキュリティルールの分離保証テスト(層2: 本番critical)。
// 2026-06-06 の教室クロス汚染インシデント級を「ルールが弾く」ことをエミュレータで検証する。
// 実行: `npm run test:rules`(firestore エミュレータを起動して走らせる)。毎push ゲートには含めない。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'

const WORKSPACE = 'main'
// 複数会社展開(Phase 0 / T0-3): 会社 = workspace。2 社目をわざと用意し、**同じ教室 ID 'A'** を持たせて
// 「教室 ID が偶然一致しても会社の壁を越えられない」ことを検証する。
const OTHER_WORKSPACE = 'other'
let testEnv: RulesTestEnvironment

// 開発者(billing対象メール) / 教室A担当マネージャー / 教室B担当マネージャー
const DEV = 'dev-uid'
const MGR_A = 'mgrA-uid'
const MGR_B = 'mgrB-uid'
// 2 社目(other)の開発者・室長(担当は other 側の教室 A)
const DEV_OTHER = 'devO-uid'
const MGR_OTHER = 'mgrO-uid'
// 保護者向け固定QR(docs/spec-parent-portal.md §B-1)のトークン(32 文字・[A-Za-z0-9_-])。
const PORTAL_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'

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
    // 保護者向け固定QR: 教室 A/B に未読の連絡を 1 件ずつ、トークン・索引・回数制限カウンタを 1 件ずつ(すべて CF が書く想定)。
    await setDoc(doc(db, `workspaces/${WORKSPACE}/classroomSnapshots/A/parentMessages/m-A`), { classroomId: 'A', studentId: 's1', body: 'A', notifiedAt: null, createdAt: '2026-09-13T00:00:00.000Z' })
    await setDoc(doc(db, `workspaces/${WORKSPACE}/classroomSnapshots/B/parentMessages/m-B`), { classroomId: 'B', studentId: 's9', body: 'B', notifiedAt: null, createdAt: '2026-09-13T00:00:00.000Z' })
    await setDoc(doc(db, `workspaces/${WORKSPACE}/classroomSnapshots/A/parentPortalRateLimits/classroom__2026-09-13T10`), { count: 1, createdAt: '2026-09-13T01:00:00.000Z', updatedAt: '2026-09-13T01:00:00.000Z' })
    await setDoc(doc(db, `studentPortalTokens/${PORTAL_TOKEN}`), { workspaceKey: WORKSPACE, classroomId: 'A', studentId: 's1', createdAt: '2026-09-13T00:00:00.000Z', createdByUid: MGR_A, revokedAt: null })
    await setDoc(doc(db, `studentPortalTokenOwners/A__s1`), { workspaceKey: WORKSPACE, classroomId: 'A', studentId: 's1', token: PORTAL_TOKEN, updatedAt: '2026-09-13T00:00:00.000Z' })
    // 2 社目(other)。教室 ID は main とわざと同じ 'A'(会社が違えば別物であることを確かめる)。
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}`), { name: OTHER_WORKSPACE, schemaVersion: 1 })
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}/members/${DEV_OTHER}`), { role: 'developer', email: 'dev@other.example.com' })
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}/members/${MGR_OTHER}`), { role: 'manager', assignedClassroomId: 'A', email: 'mgr@other.example.com' })
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}/classrooms/A`), { name: '他社の教室A' })
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}/classroomSnapshots/A`), { version: 1 })
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}/classroomSnapshots/A/parentMessages/m-O`), { classroomId: 'A', studentId: 's1', body: 'O', notifiedAt: null, createdAt: '2026-09-13T00:00:00.000Z' })
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}/billingMonths/2026-06`), { total: 1 })
    await setDoc(doc(db, `workspaces/${OTHER_WORKSPACE}/studentCountLedger/2026-06-15`), { studentCountTotal: 1 })
  })
})

const dbFor = (uid: string, email: string) => testEnv.authenticatedContext(uid, { email }).firestore()
const mgrAdb = () => dbFor(MGR_A, 'a@example.com')
const mgrBdb = () => dbFor(MGR_B, 'b@example.com')
const devdb = () => dbFor(DEV, 'bkkdmzn@gmail.com')
const otherDevdb = () => dbFor(DEV_OTHER, 'dev@other.example.com')
const otherMgrdb = () => dbFor(MGR_OTHER, 'mgr@other.example.com')
const anondb = () => testEnv.unauthenticatedContext().firestore()

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

// 在籍生徒数の恒久記録(台帳)。請求の根拠なので、クライアントからは**読めるだけ**。
// 書き込みは Cloud Function の Admin SDK 経由のみ(ルールを迂回する)。
describe('Firestore rules: studentCountLedger は読み取り専用', () => {
  it('billing対象メールの開発者は台帳を読める', async () => {
    await assertSucceeds(getDoc(doc(devdb(), `workspaces/${WORKSPACE}/studentCountLedger/2026-06-15`)))
    await assertSucceeds(getDoc(doc(devdb(), `workspaces/${WORKSPACE}/studentCountLedger/2026-06-15/classrooms/A`)))
  })

  it('マネージャーは台帳を読めない', async () => {
    await assertFails(getDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/studentCountLedger/2026-06-15`)))
  })

  it('billing開発者でも台帳へは書き込めない(恒久記録を画面操作で動かさない)', async () => {
    await assertFails(setDoc(doc(devdb(), `workspaces/${WORKSPACE}/studentCountLedger/2026-06-15`), { studentCountTotal: 999 }))
    await assertFails(setDoc(doc(devdb(), `workspaces/${WORKSPACE}/studentCountLedger/2026-06-15/classrooms/A`), { studentCount: 999 }))
  })
})

// 保護者向け固定QR(docs/spec-parent-portal.md §B-1 / §E-2・受け入れ条件 K-2 / K-5)。
// 連絡(parentMessages)は自教室のみ read・write は全員不可。トークン・索引・回数制限カウンタは開発者でも read/write 不可。
describe('Firestore rules: 保護者向け固定QR(parentMessages は自教室のみ read・書き込みは CF のみ)', () => {
  const messageA = () => `workspaces/${WORKSPACE}/classroomSnapshots/A/parentMessages/m-A`
  const messageB = () => `workspaces/${WORKSPACE}/classroomSnapshots/B/parentMessages/m-B`

  it('室長(mgrA)は自教室 A の連絡を読める(通知モーダルの購読)', async () => {
    await assertSucceeds(getDoc(doc(mgrAdb(), messageA())))
  })

  it('室長(mgrA)は未読(notifiedAt == null)の一覧クエリを自教室で実行できる(クライアントの購読と同じ形)', async () => {
    const unread = query(collection(mgrAdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A/parentMessages`), where('notifiedAt', '==', null))
    await assertSucceeds(getDocs(unread))
  })

  it('室長(mgrB)は教室 A の連絡を読めない(他教室の連絡は購読しない = 教室分離)', async () => {
    await assertFails(getDoc(doc(mgrBdb(), messageA())))
    const unreadOfA = query(collection(mgrBdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A/parentMessages`), where('notifiedAt', '==', null))
    await assertFails(getDocs(unreadOfA))
  })

  it('開発者は任意の教室の連絡を読める', async () => {
    await assertSucceeds(getDoc(doc(devdb(), messageB())))
  })

  it('未認証は連絡を読めない(保護者ページは Firestore を直読みしない)', async () => {
    await assertFails(getDoc(doc(anondb(), messageA())))
  })

  it('連絡は誰も書けない(作成・既読化・削除は Cloud Function のみ)', async () => {
    await assertFails(setDoc(doc(mgrAdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A/parentMessages/m-new`), { body: 'x', notifiedAt: null }))
    await assertFails(updateDoc(doc(mgrAdb(), messageA()), { notifiedAt: '2026-09-13T01:00:00.000Z' }))
    await assertFails(setDoc(doc(devdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A/parentMessages/m-new`), { body: 'x', notifiedAt: null }))
    await assertFails(updateDoc(doc(devdb(), messageA()), { notifiedAt: '2026-09-13T01:00:00.000Z' }))
    await assertFails(setDoc(doc(anondb(), `workspaces/${WORKSPACE}/classroomSnapshots/A/parentMessages/m-new`), { body: 'x' }))
  })

  it('studentPortalTokens は開発者・室長・未認証のいずれも read/write 不可(権威は CF のみ・公開 read 文書を作らない)', async () => {
    for (const db of [devdb(), mgrAdb(), anondb()]) {
      await assertFails(getDoc(doc(db, `studentPortalTokens/${PORTAL_TOKEN}`)))
      await assertFails(setDoc(doc(db, `studentPortalTokens/${PORTAL_TOKEN}`), { revokedAt: null }))
      await assertFails(setDoc(doc(db, `studentPortalTokens/${'x'.repeat(32)}`), { workspaceKey: WORKSPACE, classroomId: 'A', studentId: 's1', revokedAt: null }))
    }
  })

  it('studentPortalTokenOwners(索引)は開発者でも read/write 不可', async () => {
    for (const db of [devdb(), mgrAdb(), anondb()]) {
      await assertFails(getDoc(doc(db, 'studentPortalTokenOwners/A__s1')))
      await assertFails(setDoc(doc(db, 'studentPortalTokenOwners/A__s1'), { token: 'y'.repeat(32) }))
    }
  })

  it('parentPortalRateLimits(回数制限カウンタ)は開発者でも read/write 不可', async () => {
    const path = `workspaces/${WORKSPACE}/classroomSnapshots/A/parentPortalRateLimits/classroom__2026-09-13T10`
    for (const db of [devdb(), mgrAdb(), anondb()]) {
      await assertFails(getDoc(doc(db, path)))
      await assertFails(setDoc(doc(db, path), { count: 0 }))
    }
  })
})

// 複数会社展開(docs/plan-2026-09-15-multi-company-architecture.md §6 / Phase 0 T0-3)。
// 会社 = workspaces/{key}。DB は分けないので「会社の壁」はルールとメンバー台帳だけが担保する。
// ★ ある会社の開発者は、別会社では**ただの他人**でなければならない(開発者権限は会社の中だけ)。
// ★ 教室 ID は会社を跨いで衝突しうる(ここでは両社に教室 'A' がある)。ID 一致で通らないことを固定する。
describe('Firestore rules: ワークスペース(会社)越境の遮断', () => {
  it('会社Aの開発者は会社Bの workspace ドキュメントを読み書きできない', async () => {
    await assertFails(getDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}`)))
    await assertFails(setDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}`), { name: 'hijacked' }))
  })

  it('会社Aの開発者は会社Bの教室を読み書きできない(教室 ID が同じ A でも)', async () => {
    await assertFails(getDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/classrooms/A`)))
    await assertFails(setDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/classrooms/A`), { name: 'hijacked' }))
  })

  it('会社Aの開発者は会社Bの classroomSnapshots を読み書きできない(データ本体の越境を塞ぐ)', async () => {
    await assertFails(getDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/classroomSnapshots/A`)))
    await assertFails(setDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/classroomSnapshots/A`), { version: 99 }))
    await assertFails(getDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/classroomSnapshots/A/parentMessages/m-O`)))
  })

  it('会社Aの開発者は会社Bの members を読み書きできない(権限台帳の乗っ取りを塞ぐ)', async () => {
    await assertFails(getDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/members/${MGR_OTHER}`)))
    await assertFails(setDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/members/${DEV}`), { role: 'developer', email: 'bkkdmzn@gmail.com' }))
  })

  it('会社Aの billing 開発者でも会社Bの billingMonths / studentCountLedger は読めない(請求の越境参照を塞ぐ)', async () => {
    await assertFails(getDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/billingMonths/2026-06`)))
    await assertFails(setDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/billingMonths/2026-06`), { total: 999 }))
    await assertFails(getDoc(doc(devdb(), `workspaces/${OTHER_WORKSPACE}/studentCountLedger/2026-06-15`)))
  })

  it('会社Aの室長は会社Bの同 ID 教室(A)を読めない', async () => {
    await assertFails(getDoc(doc(mgrAdb(), `workspaces/${OTHER_WORKSPACE}/classrooms/A`)))
    await assertFails(getDoc(doc(mgrAdb(), `workspaces/${OTHER_WORKSPACE}/classroomSnapshots/A`)))
    await assertFails(getDoc(doc(mgrAdb(), `workspaces/${OTHER_WORKSPACE}/classroomSnapshots/A/parentMessages/m-O`)))
  })

  it('会社Bの開発者は会社Aの members / 教室 / スナップショットを読み書きできない(逆向きも塞ぐ)', async () => {
    await assertFails(getDoc(doc(otherDevdb(), `workspaces/${WORKSPACE}/members/${MGR_A}`)))
    await assertFails(setDoc(doc(otherDevdb(), `workspaces/${WORKSPACE}/members/${MGR_A}`), { role: 'developer', email: 'a@example.com' }))
    await assertFails(getDoc(doc(otherDevdb(), `workspaces/${WORKSPACE}/classrooms/A`)))
    await assertFails(setDoc(doc(otherDevdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A`), { version: 99 }))
  })

  it('会社Bの室長は会社Aの同 ID 教室(A)を読めない(担当 ID が一致していても会社が違えば他人)', async () => {
    await assertFails(getDoc(doc(otherMgrdb(), `workspaces/${WORKSPACE}/classrooms/A`)))
    await assertFails(getDoc(doc(otherMgrdb(), `workspaces/${WORKSPACE}/classroomSnapshots/A`)))
  })

  it('未認証はどちらの会社も読めない', async () => {
    await assertFails(getDoc(doc(anondb(), `workspaces/${WORKSPACE}/classrooms/A`)))
    await assertFails(getDoc(doc(anondb(), `workspaces/${OTHER_WORKSPACE}/classrooms/A`)))
  })

  it('それぞれの会社の中では従来どおり読める(壁は越境だけを止める・機能を壊していない)', async () => {
    await assertSucceeds(getDoc(doc(otherDevdb(), `workspaces/${OTHER_WORKSPACE}/classrooms/A`)))
    await assertSucceeds(getDoc(doc(otherMgrdb(), `workspaces/${OTHER_WORKSPACE}/classrooms/A`)))
    await assertSucceeds(getDoc(doc(devdb(), `workspaces/${WORKSPACE}/classrooms/A`)))
  })
})
