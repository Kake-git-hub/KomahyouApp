import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../components/basic-data/basicDataModel'
import { isDevelopmentClassroom, isParentPortalTokenOwnedByClassroom, isSubmissionTokenOwnedByClassroom, stripForeignParentPortalToken, stripForeignParentPortalTokensFromStudents, stripForeignSubmissionToken, stripForeignSubmissionTokensFromInputs, stripParentPortalToken, stripParentPortalTokensFromStudents, stripSubmissionToken, stripSubmissionTokensFromInputs } from './developmentClassroom'

// 【2026-09-16 仕様変更】検証用教室の判定は登録台帳 src/utils/developmentClassroomRegistry.ts の
// (workspaceKey, classroomId) 完全一致だけになった(docs/spec-multi-tenant.md)。
// 教室名「開発用教室」・教室ID の dev/development 曖昧一致は**廃止**。以前このファイルにあった
// 「名前で通る」期待は、複数会社展開で他社が同名教室を作ると誤発火するため反転させてある。
// workspaceKey は既定が env(テストでは空)なので、ここでは必ず第2引数で明示する。
describe('isDevelopmentClassroom', () => {
  it('登録済みの開発用教室・テスト教室だけ true(会社 main)', () => {
    expect(isDevelopmentClassroom({ id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室' }, 'main')).toBe(true)
    // オーナー確定 2026-07-28(commit 020cd46): テスト教室も検証用教室。名前を変えても効き続ける。
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai', name: 'テスト教室' }, 'main')).toBe(true)
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai', name: '石川先生 検証用' }, 'main')).toBe(true)
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai', name: '' }, 'main')).toBe(true)
  })

  // ★回帰防止(6-2 の本丸): 教室名が「開発用教室」でも、台帳に無い教室IDなら false。
  //   旧実装(name === '開発用教室' / name.includes('開発用教室'))ではここが true になり、
  //   他社が同名教室を作るだけで Feature B・先行機能・混入防止ガードの対象になっていた。
  it('名前が「開発用教室」でも未登録の教室IDなら false', () => {
    expect(isDevelopmentClassroom({ id: 'classroom-1', name: '開発用教室' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'classroom-1', name: '開発用教室（検証用）' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'other-company-room', name: '開発用教室' }, 'company-b')).toBe(false)
  })

  // ★回帰防止(会社の壁): 教室IDが登録済みでも、別の会社(workspace)なら false。
  it('登録済みの教室IDでも workspaceKey が違えば false', () => {
    expect(isDevelopmentClassroom({ id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室' }, 'company-b')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai', name: 'テスト教室' }, 'company-b')).toBe(false)
  })

  // 2026-09-16 廃止した曖昧一致。復活させない(他社の 'dev_*' 教室を巻き込む)。
  it('dev / development などの曖昧な教室IDは通さない', () => {
    for (const id of ['development', 'dev', 'development_classroom', 'dev_room_001']) {
      expect(isDevelopmentClassroom({ id, name: '検証教室' }, 'main'), id).toBe(false)
    }
  })

  // 名前判定は廃止済み。教室名を「テスト教室」にしただけの別教室は絶対に通さない
  // (本番教室を改名して他教室データを読み込めてしまう穴を塞ぐ・オーナー指示 2026-07-28)。
  it('never accepts a classroom just because it is named テスト教室', () => {
    expect(isDevelopmentClassroom({ id: '5w5OMueETerSKrSf14HC', name: 'テスト教室' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'test_classroom_2', name: 'テスト教室2' }, 'main')).toBe(false)
  })

  it('does not match normal classrooms', () => {
    expect(isDevelopmentClassroom({ id: 'classroom_001', name: '本校' }, 'main')).toBe(false)
  })

  // 本番3教室が誤ってサンドボックス扱いにならないこと(混入防止ガードの適用先が広がらないため
  // ではなく、本番から他教室データを読み込めてしまわないための最重要ロック)。
  it('never matches the production classrooms', () => {
    expect(isDevelopmentClassroom({ id: '5w5OMueETerSKrSf14HC', name: 'スクールIE 日大前校' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'KzFnOQoTFLsCxwUp1tvh', name: 'スクールIE 緑が丘校' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: '6xnnbSTbwgGrBLy0EJKb', name: 'スクールIE 薬円台校' }, 'main')).toBe(false)
  })

  it('does not match names that merely contain テスト', () => {
    expect(isDevelopmentClassroom({ id: 'classroom_002', name: 'テスト前対策校' }, 'main')).toBe(false)
  })

  // 台帳は完全一致。似たIDや大小差では通さない。
  it('matches the registered id exactly (no prefix / case slack)', () => {
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai_2', name: '' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'TEST_CLASSROOM_20260507_DAI', name: '' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: ' test_classroom_20260507_dai ', name: '' }, 'main')).toBe(true)
  })

  it('教室・workspaceKey が無ければ false(ローカルモードは workspaceKey が空なので常に false)', () => {
    expect(isDevelopmentClassroom(null, 'main')).toBe(false)
    expect(isDevelopmentClassroom(undefined, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室' }, '')).toBe(false)
  })
})

// 混入防止(2026-07-09): 開発用教室が他教室の生データをコピーしてテストする際、コピー元(本番)の
// 提出トークンが日程表でQR表示され、スキャンで本番へ誤書き込みした事故の是正ガード。
describe('isSubmissionTokenOwnedByClassroom', () => {
  it('trusts a token only when its issuing classroom tag matches', () => {
    expect(isSubmissionTokenOwnedByClassroom({ submissionToken: 't', submissionTokenClassroomId: 'dev' }, 'dev')).toBe(true)
  })
  it('rejects a token issued by another classroom (本番トークンの混入)', () => {
    expect(isSubmissionTokenOwnedByClassroom({ submissionToken: 't', submissionTokenClassroomId: '5w5OMueE' }, 'dev')).toBe(false)
  })
  it('rejects an untagged legacy token (発行元不明は信用しない)', () => {
    expect(isSubmissionTokenOwnedByClassroom({ submissionToken: 't' }, 'dev')).toBe(false)
  })
  it('rejects when there is no token or no acting classroom', () => {
    expect(isSubmissionTokenOwnedByClassroom({ submissionTokenClassroomId: 'dev' }, 'dev')).toBe(false)
    expect(isSubmissionTokenOwnedByClassroom({ submissionToken: 't', submissionTokenClassroomId: 'dev' }, '')).toBe(false)
  })
})

// 一本化(2026-07-12): 教室コピー時の「提出トークン消し」を唯一の権威関数へ集約したことのガード。
// buildDevelopmentClassroomCopyPayload の別実装(インライン分割代入)を廃し、ここへ委譲した。
describe('stripSubmissionToken (無条件・教室コピー用の唯一の権威)', () => {
  it('発行元教室に関係なく token+tag を無条件で剥がす(コピー元の全トークンを消す)', () => {
    const result = stripSubmissionToken({ submissionToken: 't', submissionTokenClassroomId: 'dev', countSubmitted: true })
    // stripForeign と違い、自教室タグ付きでも剥がす(コピー時は再発行前提)
    expect(result.submissionToken).toBeUndefined()
    expect(result.submissionTokenClassroomId).toBeUndefined()
    expect(result.countSubmitted).toBe(true) // 他フィールドは保持
  })
  it('タグなしレガシートークンも剥がす', () => {
    const result = stripSubmissionToken({ submissionToken: 't', regularOnly: false })
    expect(result.submissionToken).toBeUndefined()
    expect(result.regularOnly).toBe(false)
  })
  it('トークンが無い入力はそのまま返す(参照不変)', () => {
    const input = { unavailableSlots: [], submissionToken: undefined, submissionTokenClassroomId: undefined }
    expect(stripSubmissionToken(input)).toBe(input)
  })
  it('元オブジェクトは破壊しない(純関数)', () => {
    const input = { submissionToken: 't', submissionTokenClassroomId: 'dev' }
    stripSubmissionToken(input)
    expect(input.submissionToken).toBe('t')
    expect(input.submissionTokenClassroomId).toBe('dev')
  })
})

describe('stripSubmissionTokensFromInputs (Record単位・無条件)', () => {
  it('全 input のトークンを発行元に関係なく剥がす', () => {
    const inputs: Record<string, { submissionToken?: string; submissionTokenClassroomId?: string; countSubmitted: boolean }> = {
      own: { submissionToken: 'a', submissionTokenClassroomId: 'dev', countSubmitted: true },
      foreign: { submissionToken: 'b', submissionTokenClassroomId: '5w5OMueE', countSubmitted: false },
      legacy: { submissionToken: 'c', countSubmitted: false },
    }
    const result = stripSubmissionTokensFromInputs(inputs)
    expect(result.own!.submissionToken).toBeUndefined()
    expect(result.foreign!.submissionToken).toBeUndefined()
    expect(result.legacy!.submissionToken).toBeUndefined()
    expect(result.own!.submissionTokenClassroomId).toBeUndefined()
    expect(result.own!.countSubmitted).toBe(true) // 他フィールドは保持
  })
})

describe('stripForeignSubmissionToken', () => {
  it('keeps own-classroom tokens intact', () => {
    const input = { submissionToken: 't', submissionTokenClassroomId: 'dev', countSubmitted: true }
    expect(stripForeignSubmissionToken(input, 'dev')).toBe(input)
  })
  it('removes token+tag for foreign tokens (QRを出せなくする)', () => {
    const result = stripForeignSubmissionToken({ submissionToken: 't', submissionTokenClassroomId: '5w5OMueE', countSubmitted: false }, 'dev')
    expect(result.submissionToken).toBeUndefined()
    expect(result.submissionTokenClassroomId).toBeUndefined()
    expect(result.countSubmitted).toBe(false) // 他フィールドは保持
  })
  it('removes untagged legacy tokens too', () => {
    const result = stripForeignSubmissionToken({ submissionToken: 't', regularOnly: false }, 'dev')
    expect(result.submissionToken).toBeUndefined()
  })
  it('leaves tokenless inputs untouched (参照そのまま)', () => {
    const input = { unavailableSlots: [], submissionToken: undefined, submissionTokenClassroomId: undefined }
    expect(stripForeignSubmissionToken(input, 'dev')).toBe(input)
  })
})

describe('stripForeignSubmissionTokensFromInputs (日程表へ渡す前の防波堤・開発用のみ)', () => {
  it('自教室のトークンは残し、他教室由来トークンだけQRを出せなくする', () => {
    const inputs = {
      own: { submissionToken: 'a', submissionTokenClassroomId: 'dev', countSubmitted: true },
      foreign: { submissionToken: 'b', submissionTokenClassroomId: '5w5OMueE', countSubmitted: false },
      legacy: { submissionToken: 'c', countSubmitted: false },
    }
    const result = stripForeignSubmissionTokensFromInputs(inputs, 'dev')
    expect(result.own!.submissionToken).toBe('a')
    expect(result.foreign!.submissionToken).toBeUndefined()
    expect(result.legacy!.submissionToken).toBeUndefined()
    // 他フィールドは保持(登録状態などを壊さない)
    expect(result.foreign!.countSubmitted).toBe(false)
  })
})

// ---- 保護者向け固定QR(docs/spec-parent-portal.md §B-3・2026-09-13) ----
// 提出トークン b2e2048 / v1.5.415 と同型の事故(他教室コピーで本番生徒の QR が開発用教室に出る)を防ぐ剥がし。
// StudentRow 全体で型付けする(`{ parentPortalToken?: ... }` の弱い型に対し、トークン無しの素の行を渡すと TS2559 になるため)。
const studentBase: StudentRow = { id: 's001', name: '青木 太郎', displayName: '青木', email: '', entryDate: '2026-04-01', withdrawDate: '未定', birthDate: '2012-05-01' }

describe('isParentPortalTokenOwnedByClassroom', () => {
  it('発行元教室タグが一致するときだけ信用する', () => {
    expect(isParentPortalTokenOwnedByClassroom({ parentPortalToken: 'tok', parentPortalTokenClassroomId: 'dev' }, 'dev')).toBe(true)
  })
  it('別教室タグ・タグ無し・トークン無し・教室未指定は信用しない', () => {
    expect(isParentPortalTokenOwnedByClassroom({ parentPortalToken: 'tok', parentPortalTokenClassroomId: '5w5OMueETerSKrSf14HC' }, 'dev')).toBe(false)
    expect(isParentPortalTokenOwnedByClassroom({ parentPortalToken: 'tok' }, 'dev')).toBe(false)
    expect(isParentPortalTokenOwnedByClassroom({ parentPortalTokenClassroomId: 'dev' }, 'dev')).toBe(false)
    expect(isParentPortalTokenOwnedByClassroom({ parentPortalToken: 'tok', parentPortalTokenClassroomId: 'dev' }, '')).toBe(false)
    expect(isParentPortalTokenOwnedByClassroom(null, 'dev')).toBe(false)
  })
})

describe('stripParentPortalToken (無条件・教室コピー用の唯一の権威)', () => {
  it('発行元教室に関係なく token と発行元タグの両方を剥がし、他フィールドは保持する', () => {
    const result = stripParentPortalToken({ ...studentBase, parentPortalToken: 'tok', parentPortalTokenClassroomId: 'dev', isExternal: true })
    expect(result.parentPortalToken).toBeUndefined()
    expect(result.parentPortalTokenClassroomId).toBeUndefined()
    expect('parentPortalToken' in result).toBe(false) // undefined 代入ではなく delete(toEqual/Firestore payload を汚さない)
    expect('parentPortalTokenClassroomId' in result).toBe(false)
    expect(result).toEqual({ ...studentBase, isExternal: true })
  })
  it('タグだけ残った行・タグ無しトークンの行も剥がす(片方だけの状態を作らない)', () => {
    expect('parentPortalTokenClassroomId' in stripParentPortalToken({ ...studentBase, parentPortalTokenClassroomId: 'dev' })).toBe(false)
    expect('parentPortalToken' in stripParentPortalToken({ ...studentBase, parentPortalToken: 'tok' })).toBe(false)
  })
  it('トークンが無い行はそのまま返す(参照不変)', () => {
    const row: StudentRow = { ...studentBase }
    expect(stripParentPortalToken(row)).toBe(row)
  })
  it('元オブジェクトは破壊しない(純関数)', () => {
    const row = { ...studentBase, parentPortalToken: 'tok', parentPortalTokenClassroomId: 'dev' }
    stripParentPortalToken(row)
    expect(row.parentPortalToken).toBe('tok')
    expect(row.parentPortalTokenClassroomId).toBe('dev')
  })
})

describe('stripParentPortalTokensFromStudents (配列単位・無条件)', () => {
  it('自教室タグ付きも本番教室タグ付きもタグ無しも全て剥がす', () => {
    const rows: StudentRow[] = [
      { ...studentBase, id: 's001', parentPortalToken: 'a', parentPortalTokenClassroomId: 'dev' },
      { ...studentBase, id: 's002', parentPortalToken: 'b', parentPortalTokenClassroomId: '5w5OMueETerSKrSf14HC' },
      { ...studentBase, id: 's003', parentPortalToken: 'c' },
      { ...studentBase, id: 's004' },
    ]
    const result = stripParentPortalTokensFromStudents(rows)
    expect(result.map((row) => row.id)).toEqual(['s001', 's002', 's003', 's004']) // 順序と件数は不変
    expect(result.every((row) => !('parentPortalToken' in row) && !('parentPortalTokenClassroomId' in row))).toBe(true)
    expect(result[3]).toBe(rows[3]) // トークンの無い行は同一参照
    expect(rows[0].parentPortalToken).toBe('a') // 入力は破壊しない
  })
  it('どの行も変わらなければ配列も同一参照を返す', () => {
    const rows: StudentRow[] = [{ ...studentBase, id: 's001' }, { ...studentBase, id: 's002' }]
    expect(stripParentPortalTokensFromStudents(rows)).toBe(rows)
  })
})

describe('stripForeignParentPortalToken (開発用教室のみ・他教室由来だけ除去)', () => {
  it('自教室が発行したトークンは残す(参照そのまま)', () => {
    const row = { ...studentBase, parentPortalToken: 'tok', parentPortalTokenClassroomId: 'dev' }
    expect(stripForeignParentPortalToken(row, 'dev')).toBe(row)
  })
  it('本番教室由来・タグ無しは剥がす', () => {
    const foreign = stripForeignParentPortalToken({ ...studentBase, parentPortalToken: 'tok', parentPortalTokenClassroomId: '5w5OMueETerSKrSf14HC' }, 'dev')
    expect('parentPortalToken' in foreign).toBe(false)
    expect('parentPortalTokenClassroomId' in foreign).toBe(false)
    expect('parentPortalToken' in stripForeignParentPortalToken({ ...studentBase, parentPortalToken: 'tok' }, 'dev')).toBe(false)
  })
})

describe('stripForeignParentPortalTokensFromStudents (配列単位・開発用教室のみ)', () => {
  it('自教室の行は残し、他教室由来・タグ無しの行だけ剥がす', () => {
    const rows: StudentRow[] = [
      { ...studentBase, id: 's001', parentPortalToken: 'a', parentPortalTokenClassroomId: 'dev' },
      { ...studentBase, id: 's002', parentPortalToken: 'b', parentPortalTokenClassroomId: '5w5OMueETerSKrSf14HC' },
      { ...studentBase, id: 's003', parentPortalToken: 'c' },
    ]
    const result = stripForeignParentPortalTokensFromStudents(rows, 'dev')
    expect(result[0]).toBe(rows[0])
    expect(result[0]!.parentPortalToken).toBe('a')
    expect('parentPortalToken' in result[1]!).toBe(false)
    expect('parentPortalToken' in result[2]!).toBe(false)
  })
  it('全行が自教室なら配列も同一参照', () => {
    const rows: StudentRow[] = [{ ...studentBase, parentPortalToken: 'a', parentPortalTokenClassroomId: 'dev' }]
    expect(stripForeignParentPortalTokensFromStudents(rows, 'dev')).toBe(rows)
  })
  // 本番3教室はサンドボックスではないので、そもそもこの剥がしは App 側(isActingDevelopmentClassroom)で呼ばれない。
  // 判定関数の側でも本番IDが絶対にサンドボックス扱いにならないことを、保護者QR文脈でも固定する。
  it('本番3教室の ID は保護者QR文脈でも決してサンドボックス扱いにならない', () => {
    expect(isDevelopmentClassroom({ id: '5w5OMueETerSKrSf14HC', name: 'スクールIE 日大前校' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'KzFnOQoTFLsCxwUp1tvh', name: 'スクールIE 緑が丘校' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: '6xnnbSTbwgGrBLy0EJKb', name: 'スクールIE 薬円台校' }, 'main')).toBe(false)
    expect(isDevelopmentClassroom({ id: 'v8OZ7zH8vONNHjjYVcR1', name: '開発用教室' }, 'main')).toBe(true)
  })
})
