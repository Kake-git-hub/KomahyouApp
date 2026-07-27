import { describe, expect, it } from 'vitest'
import { isDevelopmentClassroom, isSubmissionTokenOwnedByClassroom, stripForeignSubmissionToken, stripForeignSubmissionTokensFromInputs, stripSubmissionToken, stripSubmissionTokensFromInputs } from './developmentClassroom'

describe('isDevelopmentClassroom', () => {
  it('accepts exact and extended development classroom names', () => {
    expect(isDevelopmentClassroom({ id: 'development', name: '開発用教室' })).toBe(true)
    expect(isDevelopmentClassroom({ id: 'classroom-1', name: '開発用教室（検証用）' })).toBe(true)
  })

  it('accepts ids containing development markers', () => {
    expect(isDevelopmentClassroom({ id: 'development_classroom', name: '検証教室' })).toBe(true)
    expect(isDevelopmentClassroom({ id: 'dev_room_001', name: '検証教室' })).toBe(true)
  })

  // オーナー確定 2026-07-28: 手動テスト手順書をテスト教室で他教室データを使って回すため、
  // テスト教室も検証用(サンドボックス)教室に含める。Feature B の解放と混入防止ガードはセットで付く。
  // 判定は【教室ID】(オーナー指示: 名前判定は不安)。名前を変えても効き続けること。
  it('accepts テスト教室 by classroom id, independent of its name (2026-07-28)', () => {
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai', name: 'テスト教室' })).toBe(true)
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai', name: '石川先生 検証用' })).toBe(true)
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai', name: '' })).toBe(true)
  })

  // 名前判定は廃止した。教室名を「テスト教室」にしただけの別教室は絶対に通さない
  // (本番教室を改名して他教室データを読み込めてしまう穴を塞ぐ・オーナー指示 2026-07-28)。
  it('never accepts a classroom just because it is named テスト教室', () => {
    expect(isDevelopmentClassroom({ id: '5w5OMueETerSKrSf14HC', name: 'テスト教室' })).toBe(false)
    expect(isDevelopmentClassroom({ id: 'test_classroom_2', name: 'テスト教室2' })).toBe(false)
  })

  it('does not match normal classrooms', () => {
    expect(isDevelopmentClassroom({ id: 'classroom_001', name: '本校' })).toBe(false)
  })

  // 本番3教室が誤ってサンドボックス扱いにならないこと(混入防止ガードの適用先が広がらないため
  // ではなく、本番から他教室データを読み込めてしまわないための最重要ロック)。
  it('never matches the production classrooms', () => {
    expect(isDevelopmentClassroom({ id: '5w5OMueETerSKrSf14HC', name: 'スクールIE 日大前校' })).toBe(false)
    expect(isDevelopmentClassroom({ id: 'KzFnOQoTFLsCxwUp1tvh', name: 'スクールIE 緑が丘校' })).toBe(false)
    expect(isDevelopmentClassroom({ id: '6xnnbSTbwgGrBLy0EJKb', name: 'スクールIE 薬円台校' })).toBe(false)
  })

  it('does not match names that merely contain テスト', () => {
    expect(isDevelopmentClassroom({ id: 'classroom_002', name: 'テスト前対策校' })).toBe(false)
  })

  // 許可リストは完全一致。似たIDや大小差では通さない。
  it('matches the allowed id exactly (no prefix / case slack)', () => {
    expect(isDevelopmentClassroom({ id: 'test_classroom_20260507_dai_2', name: '' })).toBe(false)
    expect(isDevelopmentClassroom({ id: 'TEST_CLASSROOM_20260507_DAI', name: '' })).toBe(false)
    expect(isDevelopmentClassroom({ id: ' test_classroom_20260507_dai ', name: '' })).toBe(true)
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
