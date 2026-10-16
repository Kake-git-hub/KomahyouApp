// 生徒・講師を選ぶプルダウンに「虫眼鏡ボタン → 名前で絞り込み」を足す共通部品(オーナー要望 2026-10-16)。
//
// ネイティブ <select> はそのまま残す(id / data-testid / className / 選び方は従来どおり)。虫眼鏡を押したときだけ
// 検索欄が開き、打った文字で選択肢を絞り込む。選び直し・一致 0 件の扱いは src/utils/searchableSelect.ts の
// resolveSearchableSelectView が唯一の権威(見えていない人が選ばれたまま確定されないことを保証する)。

import { useState } from 'react'

import { resolveSearchableSelectView, type SearchableSelectOption } from '../../utils/searchableSelect'

export type { SearchableSelectOption } from '../../utils/searchableSelect'

export type SearchableSelectProps = {
  id?: string
  /** <select> に付ける className(従来の見た目を引き継ぐ)。 */
  className?: string
  /** 外枠(虫眼鏡・検索欄を含む)に足す className。横並びの行に置くときは 'inline'。 */
  wrapperClassName?: string
  value: string
  options: SearchableSelectOption[]
  onChange: (value: string) => void
  /** <select> の data-testid。虫眼鏡は `${testId}-search-toggle`、検索欄は `${testId}-search`。 */
  testId?: string
  /** 検索欄のプレースホルダ(既定: 名前で絞り込み)。 */
  searchPlaceholder?: string
  /**
   * 検索語を打ったとき、選択中が一致に含まれなければ先頭の一致へ選び直す(既定 true)。
   * 選んだ瞬間に処理が走る「1 回きりの選択」(例: 集団授業の中3追加)では false にする(打つたびに追加されてしまうため)。
   */
  autoSelectOnSearch?: boolean
  /** 最初から検索欄を開いておく(静的描画の確認用)。 */
  defaultSearchOpen?: boolean
  disabled?: boolean
}

export function SearchableSelect({
  id,
  className,
  wrapperClassName,
  value,
  options,
  onChange,
  testId,
  searchPlaceholder = '名前で絞り込み',
  autoSelectOnSearch = true,
  defaultSearchOpen = false,
  disabled = false,
}: SearchableSelectProps) {
  const [searchOpen, setSearchOpen] = useState(defaultSearchOpen)
  const [query, setQuery] = useState('')
  const viewOptions = { keepCurrentVisible: !autoSelectOnSearch }
  const view = resolveSearchableSelectView(options, value, searchOpen ? query : '', viewOptions)

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery)
    if (!autoSelectOnSearch) return
    const nextView = resolveSearchableSelectView(options, value, nextQuery, viewOptions)
    if (nextView.autoSelectValue !== null && nextView.autoSelectValue !== value) onChange(nextView.autoSelectValue)
  }

  const handleToggle = () => {
    setSearchOpen((current) => !current)
    setQuery('') // 閉じたら全件に戻す・開き直したら空から
  }

  return (
    <div className={wrapperClassName ? `searchable-select ${wrapperClassName}` : 'searchable-select'}>
      <div className="searchable-select-row">
        <select
          id={id}
          className={className}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          data-testid={testId}
        >
          {view.visibleOptions.map((option) => (
            <option key={option.key ?? option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button
          type="button"
          className={`searchable-select-toggle${searchOpen ? ' active' : ''}`}
          onClick={handleToggle}
          aria-label={searchOpen ? '絞り込みを閉じる' : '名前で絞り込み'}
          aria-pressed={searchOpen}
          title={searchOpen ? '絞り込みを閉じる' : '名前で絞り込み'}
          disabled={disabled}
          data-testid={testId ? `${testId}-search-toggle` : undefined}
        >
          <span aria-hidden="true">🔍</span>
        </button>
      </div>
      {searchOpen ? (
        <div className="searchable-select-search-row">
          <input
            type="search"
            className="searchable-select-search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); handleToggle() } }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            autoFocus
            data-testid={testId ? `${testId}-search` : undefined}
          />
          {query.trim() ? (
            <span className={`searchable-select-count${view.matchCount === 0 ? ' is-empty' : ''}`} data-testid={testId ? `${testId}-search-count` : undefined}>
              {view.matchCount === 0 ? '該当なし' : `${view.matchCount}件`}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default SearchableSelect
