// 生徒・講師を選ぶプルダウンの「虫眼鏡で絞り込み」(オーナー要望 2026-10-16)の純粋ロジック。
//
// 表示側(src/components/common/SearchableSelect.tsx)はネイティブ <select> を残したまま、
// ここで決めた「見せる選択肢」と「自動で選び直す値」だけを使う。
//
// 守ること:
//  - 選択中の値が絞り込みで隠れたまま確定されない(<select> の見た目と保存値がズレると、見えていない生徒を
//    追加してしまう)。→ 選択中が一致に含まれなければ先頭の一致を選び直す(autoSelectValue)。一致 0 件なら選択中の 1 件も残す。
//  - 「生徒なし」「未設定」など値の空な選択肢(pinned)は絞り込んでも常に残し、自動選択の対象にしない。
//  - 照合は表記ゆれに寛容に: 全角/半角(NFKC)・大文字小文字・空白・ひらがな/カタカナを同一視する。

export type SearchableSelectOption = {
  /** React の key(同名の講師など value が重なりうるときに渡す)。未指定なら value。 */
  key?: string
  value: string
  label: string
  /** 表示名以外でも当てたい文字列(フルネームなど)。 */
  searchText?: string
  /** 絞り込み中も常に表示する(「生徒なし」「未設定」など)。自動選択の対象外。 */
  pinned?: boolean
}

export type SearchableSelectView = {
  visibleOptions: SearchableSelectOption[]
  /** 検索語に一致した(pinned 以外の)選択肢の数。検索語が空なら pinned 以外の総数。 */
  matchCount: number
  /** 選び直すべき値。現在の値のままでよいときは null。 */
  autoSelectValue: string | null
}

export function normalizeSelectSearchText(value: string | undefined | null) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    // ひらがな → カタカナ(ぁ U+3041 〜 ゖ U+3096)
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
}

export function matchesSelectSearch(option: SearchableSelectOption, query: string) {
  const normalizedQuery = normalizeSelectSearchText(query)
  if (!normalizedQuery) return true
  return [option.label, option.searchText].some((text) => normalizeSelectSearchText(text).includes(normalizedQuery))
}

export type ResolveSearchableSelectViewOptions = {
  /**
   * 選び直さない使い方(autoSelectOnSearch=false)では true。選択中を絞り込みに関係なく残す
   * (隠すとネイティブ <select> が別の行を選択中のように見せ、その行を選んでも change が起きない)。
   */
  keepCurrentVisible?: boolean
}

export function resolveSearchableSelectView(
  options: SearchableSelectOption[],
  value: string,
  query: string,
  { keepCurrentVisible = false }: ResolveSearchableSelectViewOptions = {},
): SearchableSelectView {
  const normalizedQuery = normalizeSelectSearchText(query)
  if (!normalizedQuery) {
    return { visibleOptions: options, matchCount: options.filter((option) => !option.pinned).length, autoSelectValue: null }
  }
  const matched = new Set(options.filter((option) => !option.pinned && matchesSelectSearch(option, normalizedQuery)))
  const firstMatch = options.find((option) => matched.has(option)) ?? null
  const currentIsMatched = options.some((option) => option.value === value && matched.has(option))
  // 一致 0 件のときは、選択中の 1 件を残して <select> の見た目と保存値を揃える。
  const keepCurrent = keepCurrentVisible || !firstMatch
  const visibleOptions = options.filter((option) => option.pinned || matched.has(option) || (keepCurrent && option.value === value))
  return {
    visibleOptions,
    matchCount: matched.size,
    // 名前を打った＝その人を選びたい。選択中が「生徒なし」等(pinned)でも先頭の一致へ選び直す。
    autoSelectValue: !keepCurrentVisible && firstMatch && !currentIsMatched ? firstMatch.value : null,
  }
}
