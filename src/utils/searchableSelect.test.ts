// 生徒・講師プルダウンの虫眼鏡絞り込み(オーナー要望 2026-10-16)の純粋ロジック。
// 守るのは「絞り込みで見えていない人が選ばれたまま確定されない」こと(<select> の見た目と保存値のズレ防止)。

import { describe, expect, it } from 'vitest'

import { matchesSelectSearch, normalizeSelectSearchText, resolveSearchableSelectView, type SearchableSelectOption } from './searchableSelect'

const students: SearchableSelectOption[] = [
  { value: '', label: '生徒なし', pinned: true },
  { value: 's1', label: '中1 山田 太郎', searchText: '山田太郎' },
  { value: 's2', label: '中2 佐藤 花子' },
  { value: 's3', label: '高1 山本 けん', searchText: 'やまもと' },
  { value: 's4', label: '小6 Smith ＡＢＣ' },
]

describe('normalizeSelectSearchText', () => {
  it('全角/半角・大文字小文字・空白・ひらがな/カタカナを同一視する', () => {
    expect(normalizeSelectSearchText('ＡＢＣ abc')).toBe('abcabc')
    expect(normalizeSelectSearchText('やまもと')).toBe(normalizeSelectSearchText('ヤマモト'))
    expect(normalizeSelectSearchText('ﾔﾏﾓﾄ')).toBe(normalizeSelectSearchText('やまもと'))
    expect(normalizeSelectSearchText(' 山田　太郎 ')).toBe('山田太郎')
    expect(normalizeSelectSearchText(undefined)).toBe('')
  })
})

describe('matchesSelectSearch', () => {
  it('表示名でも searchText でも当たる', () => {
    expect(matchesSelectSearch(students[1], '山田太郎')).toBe(true) // 表示名は空白入りだが空白無視で当たる
    expect(matchesSelectSearch(students[3], 'ヤマ')).toBe(true) // searchText のひらがなにカタカナで当たる
    expect(matchesSelectSearch(students[4], 'abc')).toBe(true)
    expect(matchesSelectSearch(students[2], '山田')).toBe(false)
    expect(matchesSelectSearch(students[2], '')).toBe(true)
  })
})

describe('resolveSearchableSelectView', () => {
  it('検索語が空なら全件・自動選択なし', () => {
    const view = resolveSearchableSelectView(students, 's2', '  ')
    expect(view.visibleOptions).toEqual(students)
    expect(view.matchCount).toBe(4)
    expect(view.autoSelectValue).toBeNull()
  })

  it('一致だけを残し、pinned(生徒なし)は常に残す', () => {
    const view = resolveSearchableSelectView(students, 's1', '山')
    expect(view.visibleOptions.map((option) => option.value)).toEqual(['', 's1', 's3'])
    expect(view.matchCount).toBe(2)
  })

  it('選択中が一致に含まれていれば選び直さない', () => {
    expect(resolveSearchableSelectView(students, 's3', '山').autoSelectValue).toBeNull()
  })

  it('選択中が絞り込みで隠れるなら先頭の一致へ選び直す(見えない人が選ばれたまま確定されない)', () => {
    const view = resolveSearchableSelectView(students, 's2', '山')
    expect(view.autoSelectValue).toBe('s1')
    expect(view.visibleOptions.some((option) => option.value === 's2')).toBe(false)
  })

  it('選択中が「生徒なし」(pinned)でも、名前を打てば先頭の一致を選ぶ', () => {
    expect(resolveSearchableSelectView(students, '', '佐藤').autoSelectValue).toBe('s2')
  })

  it('一致 0 件なら選択中の 1 件を残し、選び直さない(<select> の見た目と保存値を揃える)', () => {
    const view = resolveSearchableSelectView(students, 's2', '該当しない名前')
    expect(view.matchCount).toBe(0)
    expect(view.autoSelectValue).toBeNull()
    expect(view.visibleOptions.map((option) => option.value)).toEqual(['', 's2'])
  })

  it('pinned は検索語に当たっても一致数・自動選択に数えない', () => {
    const view = resolveSearchableSelectView(students, 's1', '生徒なし')
    expect(view.matchCount).toBe(0)
    expect(view.autoSelectValue).toBeNull()
  })

  it('keepCurrentVisible(選び直さない使い方)では、選択中を絞り込みに関係なく残し、選び直さない', () => {
    // 集団授業の担当講師・保存済みのペア制約: 選んだ瞬間に反映するので自動選択しない。選択中が隠れると
    // ネイティブ select が別の行(先頭)を選択中のように見せ、その行を選び直しても change が起きない。
    const view = resolveSearchableSelectView(students, 's2', '山', { keepCurrentVisible: true })
    expect(view.autoSelectValue).toBeNull()
    expect(view.visibleOptions.map((option) => option.value)).toEqual(['', 's1', 's2', 's3'])
    expect(view.matchCount).toBe(2)
  })
})
