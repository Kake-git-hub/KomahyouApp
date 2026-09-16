import { describe, expect, it } from 'vitest'
import { isDevelopmentClassroomIdentity, resolveDevelopmentClassroomId } from './developmentClassroomIdentity'

// サーバー側の検証用(開発用・サンドボックス)教室判定。
// 【2026-09-16 仕様変更】規則を手書きで二重実装せず、クライアントの登録台帳
// src/utils/developmentClassroomRegistry.ts の複製(generated/)へ委譲する。判定は
// **(workspaceKey, classroomId) の完全一致**で、教室名・ID の曖昧一致(dev/development)は廃止。
// 旧テストにあった「名前『開発用教室』で通る」期待は、他社が同名教室を作ると誤発火するので反転させた。
describe('isDevelopmentClassroomIdentity', () => {
  it('登録済みの開発用教室・テスト教室だけ true(会社 main)', () => {
    expect(isDevelopmentClassroomIdentity('main', 'v8OZ7zH8vONNHjjYVcR1')).toBe(true)
    // オーナー確定 2026-07-28(commit 020cd46)。台帳から落とさない。
    expect(isDevelopmentClassroomIdentity('main', 'test_classroom_20260507_dai')).toBe(true)
  })

  // ★回帰防止: 教室名は引数にすら無い。名前を「開発用教室」にした未登録教室が通らないことを、
  //   クライアント側(src/utils/developmentClassroom.test.ts)と対称に固定する。
  it('未登録の教室IDは false(教室名では決して通らない)', () => {
    expect(isDevelopmentClassroomIdentity('main', 'classroom-1')).toBe(false)
    expect(isDevelopmentClassroomIdentity('main', 'renamed_to_kaihatsuyou')).toBe(false)
  })

  // ★回帰防止(会社の壁): 別 workspace の同じ教室IDは他人の教室。
  it('登録済みの教室IDでも workspaceKey が違えば false', () => {
    expect(isDevelopmentClassroomIdentity('company-b', 'v8OZ7zH8vONNHjjYVcR1')).toBe(false)
    expect(isDevelopmentClassroomIdentity('company-b', 'test_classroom_20260507_dai')).toBe(false)
  })

  it('dev / development などの曖昧な教室IDは通さない(2026-09-16 廃止・復活させない)', () => {
    for (const id of ['development', 'dev', 'development_classroom', 'dev_room_001']) {
      expect(isDevelopmentClassroomIdentity('main', id), id).toBe(false)
    }
  })

  // 台帳は完全一致。似たIDや大小差では通さない。
  it('matches the registered id exactly (no prefix / case slack)', () => {
    expect(isDevelopmentClassroomIdentity('main', 'test_classroom_20260507_dai_2')).toBe(false)
    expect(isDevelopmentClassroomIdentity('main', 'TEST_CLASSROOM_20260507_DAI')).toBe(false)
    expect(isDevelopmentClassroomIdentity('main', ' test_classroom_20260507_dai ')).toBe(true)
  })

  // 本番3教室がサンドボックス扱いになると、その室長が他教室のバックアップを読み込めてしまう。
  // 本番データ保護の最重要ロック。
  it('never matches the production classrooms', () => {
    expect(isDevelopmentClassroomIdentity('main', '5w5OMueETerSKrSf14HC')).toBe(false)
    expect(isDevelopmentClassroomIdentity('main', 'KzFnOQoTFLsCxwUp1tvh')).toBe(false)
    expect(isDevelopmentClassroomIdentity('main', '6xnnbSTbwgGrBLy0EJKb')).toBe(false)
  })

  it('tolerates missing workspaceKey / id (fail-closed)', () => {
    expect(isDevelopmentClassroomIdentity(null, null)).toBe(false)
    expect(isDevelopmentClassroomIdentity(undefined, undefined)).toBe(false)
    expect(isDevelopmentClassroomIdentity('main', '  ')).toBe(false)
    expect(isDevelopmentClassroomIdentity('', 'v8OZ7zH8vONNHjjYVcR1')).toBe(false)
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
