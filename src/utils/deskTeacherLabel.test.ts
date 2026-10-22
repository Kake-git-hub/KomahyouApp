// 机の講師欄の埋め草「講師未割当」を室長の画面に出さない(オーナー指示 2026-10-22・確認リスト v1.5.625 その他欄)。
// データ(desk.teacher)は変えず、表示だけ空白にする。共有画面が以前から持っていた判定をここへ一本化した。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DESK_TEACHER_PLACEHOLDER_LABELS, formatDeskTeacherLabel, isDeskTeacherPlaceholder } from './deskTeacherLabel'

describe('deskTeacherLabel: 講師欄の埋め草を表示だけ空白にする', () => {
  it('「講師未割当」「講師未設定」は空白。前後の空白があっても埋め草と判定する', () => {
    expect(DESK_TEACHER_PLACEHOLDER_LABELS).toEqual(['講師未割当', '講師未設定'])
    expect(formatDeskTeacherLabel('講師未割当')).toBe('')
    expect(formatDeskTeacherLabel('講師未設定')).toBe('')
    expect(formatDeskTeacherLabel(' 講師未割当 ')).toBe('')
    expect(isDeskTeacherPlaceholder('講師未割当')).toBe(true)
  })

  it('ふつうの講師名はそのまま(trim もしない)。空・null・undefined は空文字', () => {
    expect(formatDeskTeacherLabel('三井')).toBe('三井')
    expect(formatDeskTeacherLabel(' 田中 ')).toBe(' 田中 ')
    expect(formatDeskTeacherLabel('')).toBe('')
    expect(formatDeskTeacherLabel(null)).toBe('')
    expect(formatDeskTeacherLabel(undefined)).toBe('')
    // 埋め草を含むだけの名前(例: 「講師未割当」が名字の一部になることは無いが、部分一致では落とさない)。
    expect(formatDeskTeacherLabel('講師未割当2')).toBe('講師未割当2')
    expect(isDeskTeacherPlaceholder('三井')).toBe(false)
  })

  it('配線: コマ表の講師欄(BoardGrid)・右の詳細(DetailPanel)・共有画面(BoardShareScreen)が同じ関数で講師欄を描く。日程表タブの机一覧も同じ 2 語を空白にする', () => {
    const grid = readFileSync(new URL('../components/schedule-board/BoardGrid.tsx', import.meta.url), 'utf8')
    expect(grid).toContain("import { formatDeskTeacherLabel } from '../../utils/deskTeacherLabel'")
    expect(grid).toContain("{cell.isOpenDay ? formatDeskTeacherLabel(desk.teacher) : ''}")
    // 「講師が居る机か」の判定(ドラッグ可否)は元の文字のまま(データの意味は変えない)。
    expect(grid).toContain("Boolean(cell.isOpenDay && desk.teacher.trim())")
    const detail = readFileSync(new URL('../components/schedule-board/DetailPanel.tsx', import.meta.url), 'utf8')
    expect(detail).toContain('<span>{formatDeskTeacherLabel(desk.teacher)}</span>')
    const share = readFileSync(new URL('../components/board-share/BoardShareScreen.tsx', import.meta.url), 'utf8')
    expect(share).toContain('<div className="board-share-teacher">{formatDeskTeacherLabel(desk.teacher)}</div>')
    expect(share).not.toContain("desk.teacher !== '講師未設定'")
    const scheduleHtml = readFileSync(new URL('./scheduleHtml.ts', import.meta.url), 'utf8')
    expect(scheduleHtml).toContain(`'<td class="dp-teacher">' + escapeHtml(desk.teacher === '講師未割当' || desk.teacher === '講師未設定' ? '' : (desk.teacher || '')) + '</td>'`)
    // 机の同一性の照合(data-desk-teacher)は元の文字のまま。
    expect(scheduleHtml).toContain(`' data-desk-teacher="' + escapeHtml(desk.teacher || '') + '"'`)
  })
})
