import { describe, expect, it } from 'vitest'
import { getLessonPrefix } from './BoardGrid'
import { LESSON_TYPES_WITH_MINUTES, resolveLessonMinutesNoteSuffix } from './mockData'
import type { LessonType } from './types'

const allLessonTypes: LessonType[] = ['regular', 'makeup', 'special', 'extra', 'trial']

// 外部生表示(2026-08-01・オーナー要望): 生徒基本データの「外部生」チェックが付いた生徒は
// すべての授業区分を 外) で表示する。lessonType の実データは書き換えない(在庫・集計は不変)。
describe('盤面の授業区分プレフィックス', () => {
  it('keeps the existing prefixes for internal students', () => {
    expect(getLessonPrefix('regular').text).toBe('通)')
    expect(getLessonPrefix('makeup').text).toBe('振)')
    expect(getLessonPrefix('special').text).toBe('講)')
    expect(getLessonPrefix('extra').text).toBe('増)')
    expect(getLessonPrefix('trial').text).toBe('体)')
  })

  // 修正なしでは 通)/振)/講) がそのまま出て落ちる回帰防止テスト。
  it('shows 外) for every lesson type when the student is external', () => {
    for (const lessonType of allLessonTypes) {
      const prefix = getLessonPrefix(lessonType, true)
      expect(prefix.text).toBe('外)')
      expect(prefix.label).toBe('外部生')
      expect(prefix.className).toBe('prefix-lesson-external')
    }
  })

  // 既定引数(未指定)は従来どおり=外部生扱いしない。BoardGrid 以外の呼び出し元を守る。
  it('defaults to the internal prefix when the external flag is omitted', () => {
    for (const lessonType of allLessonTypes) {
      expect(getLessonPrefix(lessonType)).toEqual(getLessonPrefix(lessonType, false))
    }
  })
})

// 振替の授業時間(2026-08-01・オーナー要望): 追加/編集メニューの保存で 90/60/45 分を保持する。
describe('授業時間(noteSuffix)を持てる授業区分', () => {
  it('includes 振替 alongside 通常/増コマ/講習', () => {
    expect(LESSON_TYPES_WITH_MINUTES).toContain('makeup')
    expect(LESSON_TYPES_WITH_MINUTES).toContain('regular')
    expect(LESSON_TYPES_WITH_MINUTES).toContain('extra')
    expect(LESSON_TYPES_WITH_MINUTES).toContain('special')
    expect(LESSON_TYPES_WITH_MINUTES).not.toContain('trial')
  })

  // 修正なしでは振替が undefined になり落ちる回帰防止テスト。
  it('keeps the selected minutes on 振替', () => {
    expect(resolveLessonMinutesNoteSuffix('makeup', '60')).toBe('60')
    expect(resolveLessonMinutesNoteSuffix('makeup', '45')).toBe('45')
    expect(resolveLessonMinutesNoteSuffix('makeup', '')).toBe('')
    // 90分(既定)は空文字。未選択の undefined も空文字へ正規化する。
    expect(resolveLessonMinutesNoteSuffix('makeup', undefined)).toBe('')
    // 想定外の値は 90 分扱いへ寄せる(normalizeRegularLessonNote と同じ規則)。
    expect(resolveLessonMinutesNoteSuffix('makeup', '30')).toBe('')
  })

  it('keeps the existing behaviour for the other lesson types', () => {
    expect(resolveLessonMinutesNoteSuffix('regular', '60')).toBe('60')
    expect(resolveLessonMinutesNoteSuffix('extra', '45')).toBe('45')
    expect(resolveLessonMinutesNoteSuffix('special', '60')).toBe('60')
    // 体験は名簿外の一時登録なので授業時間を持たせない(従来どおり)。
    expect(resolveLessonMinutesNoteSuffix('trial', '60')).toBeUndefined()
  })
})
