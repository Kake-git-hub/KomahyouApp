import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { isDevelopmentClassroomIdentity, resolveDevelopmentClassroomId } from './developmentClassroomIdentity'

// サーバー側の検証用(開発用・サンドボックス)教室判定。
// 【2026-09-16 仕様変更】規則を手書きで二重実装せず、クライアントの登録台帳
// src/utils/developmentClassroomRegistry.ts の複製(generated/)へ委譲する。判定は
// **(workspaceKey, classroomId) の完全一致**で、教室名・ID の曖昧一致(dev/development)は廃止。
// 旧テストにあった「名前『開発用教室』で通る」期待は、他社が同名教室を作ると誤発火するので反転させた。
describe('isDevelopmentClassroomIdentity', () => {
  it('登録済みの開発用教室・テスト教室だけ true(会社 main)', () => {
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'v8OZ7zH8vONNHjjYVcR1' })).toBe(true)
    // オーナー確定 2026-07-28(commit 020cd46)。台帳から落とさない。
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'test_classroom_20260507_dai' })).toBe(true)
  })

  // ★回帰防止: 教室名は引数にすら無い。名前を「開発用教室」にした未登録教室が通らないことを、
  //   クライアント側(src/utils/developmentClassroom.test.ts)と対称に固定する。
  it('未登録の教室IDは false(教室名では決して通らない)', () => {
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'classroom-1' })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'renamed_to_kaihatsuyou' })).toBe(false)
  })

  // ★回帰防止(会社の壁): 別 workspace の同じ教室IDは他人の教室。
  it('登録済みの教室IDでも workspaceKey が違えば false', () => {
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'company-b', classroomId: 'v8OZ7zH8vONNHjjYVcR1' })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'company-b', classroomId: 'test_classroom_20260507_dai' })).toBe(false)
  })

  it('dev / development などの曖昧な教室IDは通さない(2026-09-16 廃止・復活させない)', () => {
    for (const id of ['development', 'dev', 'development_classroom', 'dev_room_001']) {
      expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: id }), id).toBe(false)
    }
  })

  // 台帳は完全一致。似たIDや大小差では通さない。
  it('matches the registered id exactly (no prefix / case slack)', () => {
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'test_classroom_20260507_dai_2' })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'TEST_CLASSROOM_20260507_DAI' })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: ' test_classroom_20260507_dai ' })).toBe(true)
  })

  // 本番3教室がサンドボックス扱いになると、その室長が他教室のバックアップを読み込めてしまう。
  // 本番データ保護の最重要ロック。
  it('never matches the production classrooms', () => {
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: '5w5OMueETerSKrSf14HC' })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'KzFnOQoTFLsCxwUp1tvh' })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: '6xnnbSTbwgGrBLy0EJKb' })).toBe(false)
  })

  it('tolerates missing workspaceKey / id (fail-closed)', () => {
    expect(isDevelopmentClassroomIdentity({ workspaceKey: null, classroomId: null })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: undefined, classroomId: undefined })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: '  ' })).toBe(false)
    expect(isDevelopmentClassroomIdentity({ workspaceKey: '', classroomId: 'v8OZ7zH8vONNHjjYVcR1' })).toBe(false)
  })
})

// index.ts の developmentOnly 分岐(saveDevelopmentClassroomSnapshot)は教室IDの直書き定数をやめ、
// ここから会社ごとに解決する。未登録の会社では null → failed-precondition で止まる。
describe('resolveDevelopmentClassroomId', () => {
  it('会社ごとに開発用教室IDを返し、未登録なら null', () => {
    expect(resolveDevelopmentClassroomId('main')).toBe('v8OZ7zH8vONNHjjYVcR1')
    expect(resolveDevelopmentClassroomId('company-b')).toBeNull()
    expect(resolveDevelopmentClassroomId('')).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 引数の形(2026-09-16 レビュー指摘の是正)。
// 旧シグネチャ `(workspaceKey: string, id: string)` は**同型の位置引数 2 つ**で、取り違えても
// 型が通り、静かに false を返した(＝検証用教室の特権・開発用教室限定機能・保護者ポータルが
// 理由不明のまま無効になる)。名前付き引数へ変えて取り違えをコンパイル時に落とす。
// ⚠️ functions/tsconfig.json は `src/**/*.test.ts` を除外していてテストは型検査されないため、
//    「位置引数へ戻していない」ことは**字面**で固定する(作法は developerReport.test.ts と同じ)。
// ───────────────────────────────────────────────────────────────────────────
describe('isDevelopmentClassroomIdentity の引数は名前付き(オブジェクト)', () => {
  const readSource = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

  it('宣言は { workspaceKey, classroomId } を受ける(同型 string 2 引数へ戻さない)', () => {
    const source = readSource('./developmentClassroomIdentity.ts')
    expect(source).toContain('export function isDevelopmentClassroomIdentity({ workspaceKey, classroomId }: DevelopmentClassroomLookup): boolean')
    expect(source).not.toMatch(/export function isDevelopmentClassroomIdentity\(\s*\r?\n?\s*workspaceKey:/u)
  })

  it('呼び出し側(index.ts・parentPortal.ts・questionAiAnswer.ts)はすべて名前付きで渡す', () => {
    // 2026-09-18(Phase 1 T1-2): 質問 AI の判定は index.ts から questionAiAnswer.ts の isQuestionAiAnswerEnabledForClassroom へ移動(index 5→4・questionAiAnswer 1)。
    for (const [relativePath, expectedCalls] of [['./index.ts', 4], ['./parentPortal.ts', 1], ['./questionAiAnswer.ts', 1]] as const) {
      const calls = readSource(relativePath).match(/isDevelopmentClassroomIdentity\([^)]*\)/gu) ?? []
      expect(calls.length, relativePath).toBe(expectedCalls)
      for (const call of calls) {
        expect(call, `${relativePath}: ${call}`).toMatch(/^isDevelopmentClassroomIdentity\(\{\s*workspaceKey[,:]/u)
        expect(call, `${relativePath}: ${call}`).toContain('classroomId')
      }
    }
  })

  it('会社キーと教室IDを入れ替えて渡しても通らない(取り違えは fail-closed)', () => {
    expect(isDevelopmentClassroomIdentity({ workspaceKey: 'v8OZ7zH8vONNHjjYVcR1', classroomId: 'main' })).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// saveDevelopmentClassroomSnapshot(開発用教室限定の保存実験)の配線。
// 教室IDの直書き定数をやめ、会社(workspaceKey)ごとに登録台帳から解決する。**開発用教室が未登録の
// 会社では必ず failed-precondition で止まる**(null を「制限なし」と読み替えて素通りさせない)。
// 落ちる改悪の例: null チェックを消す / `classroomId !== developmentClassroomId` の比較を外す /
// resolveDevelopmentClassroomId をやめて教室IDを直書きに戻す。
// ───────────────────────────────────────────────────────────────────────────
describe('saveDevelopmentClassroomSnapshot の developmentOnly 分岐(index.ts)', () => {
  const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
  const start = indexTs.indexOf('if (options?.developmentOnly) {')
  const branch = indexTs.slice(start, start + 600)

  it('会社ごとに台帳から解決し、未登録なら failed-precondition で止める', () => {
    expect(start).toBeGreaterThan(-1)
    expect(branch).toContain('const developmentClassroomId = resolveDevelopmentClassroomId(workspaceKey)')
    expect(branch).toContain('if (!developmentClassroomId) {')
    expect(branch).toMatch(/if \(!developmentClassroomId\) \{\s*\r?\n\s*throw new HttpsError\('failed-precondition'/u)
  })

  it('解決した開発用教室以外の教室IDでは止める(比較を外さない)', () => {
    expect(branch).toContain('if (classroomId !== developmentClassroomId) {')
    expect(branch).toMatch(/if \(classroomId !== developmentClassroomId\) \{\s*\r?\n\s*throw new HttpsError\('failed-precondition'/u)
  })

  it('教室IDの直書き定数へ戻していない(台帳が唯一の正本)', () => {
    expect(branch).not.toContain('v8OZ7zH8vONNHjjYVcR1')
    // 未登録の会社は null。null のときに「何でも通す」へ倒す分岐を足さない。
    expect(branch).not.toMatch(/developmentClassroomId == null\s*\|\|/u)
  })

  it('呼び出し口は saveDevelopmentClassroomSnapshot だけ(通常保存に developmentOnly を付けない)', () => {
    const calls = indexTs.match(/saveClassroomSnapshotFromCallable\(request, \{ developmentOnly: true \}\)/gu) ?? []
    expect(calls.length).toBe(1)
  })
})
