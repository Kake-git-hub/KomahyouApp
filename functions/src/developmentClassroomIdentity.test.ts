import { describe, expect, it } from 'vitest'
import { isDevelopmentClassroomIdentity } from './developmentClassroomIdentity'

// サーバー側の検証用(サンドボックス)教室判定。クライアント src/utils/developmentClassroom.ts の
// isDevelopmentClassroom と**同一規則**でなければならない(片方だけ許可しても機能しない/
// 片方だけ広げると混入防止ガードのない教室へコピーできてしまう)。
describe('isDevelopmentClassroomIdentity', () => {
  it('accepts the development classroom by name (本番は id=v8OZ... なので name 判定が要)', () => {
    expect(isDevelopmentClassroomIdentity('v8OZ7zH8vONNHjjYVcR1', '開発用教室')).toBe(true)
    expect(isDevelopmentClassroomIdentity('classroom-1', '開発用教室（検証用）')).toBe(true)
  })

  it('accepts ids containing development markers', () => {
    expect(isDevelopmentClassroomIdentity('development', '検証教室')).toBe(true)
    expect(isDevelopmentClassroomIdentity('dev', '検証教室')).toBe(true)
    expect(isDevelopmentClassroomIdentity('development_classroom', '検証教室')).toBe(true)
    expect(isDevelopmentClassroomIdentity('dev_room_001', '検証教室')).toBe(true)
  })

  // オーナー確定 2026-07-28: テスト教室でも他教室バックアップを読み込めるようにする(Feature B)。
  // 判定は【教室ID】(オーナー指示: 名前判定は不安)。名前を変えても効き続けること。
  it('accepts テスト教室 by classroom id, independent of its name (2026-07-28)', () => {
    expect(isDevelopmentClassroomIdentity('test_classroom_20260507_dai', 'テスト教室')).toBe(true)
    expect(isDevelopmentClassroomIdentity('test_classroom_20260507_dai', '石川先生 検証用')).toBe(true)
    expect(isDevelopmentClassroomIdentity('test_classroom_20260507_dai', '')).toBe(true)
  })

  // 名前判定は廃止。教室名を「テスト教室」にしただけの別教室(本番教室の改名を含む)は通さない。
  it('never accepts a classroom just because it is named テスト教室', () => {
    expect(isDevelopmentClassroomIdentity('5w5OMueETerSKrSf14HC', 'テスト教室')).toBe(false)
    expect(isDevelopmentClassroomIdentity('test_classroom_2', 'テスト教室2')).toBe(false)
  })

  // 許可リストは完全一致。似たIDや大小差では通さない。
  it('matches the allowed id exactly (no prefix / case slack)', () => {
    expect(isDevelopmentClassroomIdentity('test_classroom_20260507_dai_2', '')).toBe(false)
    expect(isDevelopmentClassroomIdentity('TEST_CLASSROOM_20260507_DAI', '')).toBe(false)
    expect(isDevelopmentClassroomIdentity(' test_classroom_20260507_dai ', '')).toBe(true)
  })

  // 本番3教室がサンドボックス扱いになると、その室長が他教室のバックアップを読み込めてしまう。
  // 本番データ保護の最重要ロック。
  it('never matches the production classrooms', () => {
    expect(isDevelopmentClassroomIdentity('5w5OMueETerSKrSf14HC', 'スクールIE 日大前校')).toBe(false)
    expect(isDevelopmentClassroomIdentity('KzFnOQoTFLsCxwUp1tvh', 'スクールIE 緑が丘校')).toBe(false)
    expect(isDevelopmentClassroomIdentity('6xnnbSTbwgGrBLy0EJKb', 'スクールIE 薬円台校')).toBe(false)
  })

  it('does not match names that merely contain テスト', () => {
    expect(isDevelopmentClassroomIdentity('classroom_002', 'テスト前対策校')).toBe(false)
  })

  it('tolerates missing id / name', () => {
    expect(isDevelopmentClassroomIdentity(null, null)).toBe(false)
    expect(isDevelopmentClassroomIdentity(undefined, undefined)).toBe(false)
    expect(isDevelopmentClassroomIdentity('  ', ' 開発用教室 ')).toBe(true)
  })
})
