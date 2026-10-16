// 虫眼鏡つきプルダウン(SearchableSelect・オーナー要望 2026-10-16)の描画と、各画面への配線の回帰防止。
// 描画は react-dom/server の静的レンダリング、配線は各画面のソース字面で固定する。
// JSX を使わず createElement で描く(作成時は vitest の include が *.test.ts だけだった名残。2026-10-16 から *.test.tsx も走る)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SearchableSelect } from './SearchableSelect'

const readSource = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

const render = (props: Parameters<typeof SearchableSelect>[0]) => renderToStaticMarkup(createElement(SearchableSelect, props))

const options = [
  { value: '', label: '生徒を選択', pinned: true },
  { value: 's1', label: '中1 山田 太郎' },
  { value: 's2', label: '中2 佐藤 花子' },
]

describe('SearchableSelect', () => {
  it('従来の id / className / data-testid を <select> に引き継ぎ、虫眼鏡ボタンを並べる', () => {
    const html = render({ id: 'menu-add-student-select', className: 'student-menu-select', value: 's1', options, onChange: () => {}, testId: 'menu-add-student-select' })
    expect(html).toContain('id="menu-add-student-select"')
    expect(html).toContain('class="student-menu-select"')
    expect(html).toContain('data-testid="menu-add-student-select"')
    expect(html).toContain('data-testid="menu-add-student-select-search-toggle"')
    expect(html).toContain('🔍')
    expect(html).toContain('aria-label="名前で絞り込み"')
    // 検索欄は虫眼鏡を押すまで出さない(既存の操作感を変えない)
    expect(html).not.toContain('data-testid="menu-add-student-select-search"')
    expect(html).toContain('中2 佐藤 花子')
  })

  it('検索欄を開くと入力欄が出る', () => {
    const html = render({ value: '', options, onChange: () => {}, testId: 'x', defaultSearchOpen: true })
    expect(html).toContain('data-testid="x-search"')
    expect(html).toContain('type="search"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('wrapperClassName を外枠に足す', () => {
    const html = render({ value: '', options, onChange: () => {}, wrapperClassName: 'inline' })
    expect(html).toContain('class="searchable-select inline"')
  })
})

describe('生徒・講師を選ぶ画面への配線(すべて虫眼鏡つき)', () => {
  const board = readSource('../schedule-board/ScheduleBoardScreen.tsx')
  const groupAttendance = readSource('../schedule-board/GroupAttendanceModal.tsx')
  const backupRestore = readSource('../backup-restore/BackupRestoreScreen.tsx')
  const autoAssign = readSource('../auto-assign-rules/AutoAssignRuleScreen.tsx')

  it.each([
    'teacher-select-input', // 盤面の講師設定(手動の講師追加)
    'group-teacher-select', // 集団授業の担当講師
    'template-edit-student-select', // テンプレの生徒編集
    'template-add-student-select', // テンプレの既存生徒追加
    'menu-add-student-select', // 盤面の生徒追加(手動の生徒追加)
  ])('盤面の %s は SearchableSelect で描く', (testId) => {
    expect(board).toContain(`testId="${testId}"`)
    expect(board).not.toContain(`data-testid="${testId}"`)
  })

  it('集団授業の中3追加は SearchableSelect・選んだ瞬間に追加するので自動選択しない', () => {
    expect(groupAttendance).toMatch(/<SearchableSelect[\s\S]*?autoSelectOnSearch=\{false\}[\s\S]*?testId="group-attendance-add-select"/)
  })

  it('集団授業の担当講師は選んだ瞬間に保存するので自動選択しない', () => {
    expect(board).toMatch(/autoSelectOnSearch=\{false\}\s*testId="group-teacher-select"/)
  })

  it.each(['setup-makeup-student', 'setup-lecture-student'])('初期設定の %s は SearchableSelect', (testId) => {
    expect(backupRestore).toContain(`testId="${testId}"`)
    expect(backupRestore).not.toContain(`data-testid="${testId}"`)
  })

  it('自動割振ルールのペア制約(人物A/B)は SearchableSelect・保存済みの行は自動選択しない', () => {
    expect(autoAssign).toContain('testId="auto-assign-pair-draft-person-a-id"')
    expect(autoAssign).toContain('testId="auto-assign-pair-draft-person-b-id"')
    expect(autoAssign).toMatch(/autoSelectOnSearch=\{false\}\s*testId=\{`auto-assign-pair-person-a-id-\$\{row\.id\}`\}/)
    expect(autoAssign).toMatch(/autoSelectOnSearch=\{false\}\s*testId=\{`auto-assign-pair-person-b-id-\$\{row\.id\}`\}/)
  })

  it('自動割振ルールの「個人」生徒一覧に虫眼鏡と絞り込みがある', () => {
    expect(autoAssign).toContain('data-testid={`auto-assign-student-search-toggle-${rule.key}`}')
    expect(autoAssign).toContain('data-testid={`auto-assign-student-search-${rule.key}`}')
    expect(autoAssign).toMatch(/selectableStudents\s*\.filter\(\(student\) => !studentPickerSearch \|\| matchesSelectSearch\(/)
  })
})
