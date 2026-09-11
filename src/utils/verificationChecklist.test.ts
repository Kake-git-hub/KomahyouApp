// 開発用教室の確認リスト(2026-09-12)の回帰防止テスト。
// パネルは開発用教室でしか出ないが、書式・下書き・分割は純関数なのでここで固定する。

import { describe, expect, it } from 'vitest'

import { DEVELOPER_REPORT_NOTE_LIMIT } from './developerReport'
import {
  VERIFICATION_CHECKLIST,
  VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY,
  buildVerificationChecklistMarkdown,
  buildVerificationChecklistMarker,
  buildVerificationChecklistReportNotes,
  countVerificationChecklistProgress,
  createEmptyVerificationChecklistDraft,
  getVerificationChecklistEntry,
  parseVerificationChecklistDraft,
  serializeVerificationChecklistDraft,
  setVerificationChecklistEntry,
  setVerificationChecklistOtherNotes,
  verificationChecklistStorageKey,
  type VerificationChecklistItem,
} from './verificationChecklist'

function draftWith(entries: Array<[string, 'ok' | 'needs-fix', string?]>, otherNotes = '') {
  let draft = createEmptyVerificationChecklistDraft()
  for (const [id, status, memo] of entries) {
    draft = setVerificationChecklistEntry(draft, id, { status, memo: memo ?? '' })
  }
  return otherNotes ? setVerificationChecklistOtherNotes(draft, otherNotes) : draft
}

describe('確認リストの項目定義', () => {
  it('id が一意', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('全項目が版(introducedIn)と手順を持つ', () => {
    for (const item of VERIFICATION_CHECKLIST.items) {
      expect(item.introducedIn, item.id).toMatch(/^v\d+\.\d+\.\d+$/u)
      expect(item.steps.length, item.id).toBeGreaterThan(0)
      expect(item.title.trim(), item.id).not.toBe('')
      expect(item.area.trim(), item.id).not.toBe('')
    }
  })

  it('初版の3領域(U-0 / PDF / 講習履歴)が入っている', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    expect(ids).toContain('u0-1')
    expect(ids).toContain('u0-5')
    expect(ids).toContain('p-1')
    expect(ids).toContain('p-7')
    expect(ids).toContain('h-1')
    expect(ids).toContain('h-7')
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.504')
  })
})

describe('下書きの保存キーと往復', () => {
  it('教室別・版別のキーになる', () => {
    expect(verificationChecklistStorageKey('v8OZ7zH8vONNHjjYVcR1')).toBe('verification-checklist:v8OZ7zH8vONNHjjYVcR1:v1.5.504')
    expect(verificationChecklistStorageKey(null)).toBe('verification-checklist:unknown:v1.5.504')
    expect(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY).toBe('verification-checklist:collapsed')
  })

  it('serialize → parse で内容が戻る', () => {
    const draft = draftWith([['u0-1', 'ok'], ['p-2', 'needs-fix', '文字が細い']], 'ほかは問題なし')
    const restored = parseVerificationChecklistDraft(serializeVerificationChecklistDraft(draft))
    expect(restored).toEqual(draft)
  })

  it('壊れた JSON・別の型・別版は空の下書きとして扱う', () => {
    const empty = createEmptyVerificationChecklistDraft()
    expect(parseVerificationChecklistDraft('{壊れ')).toEqual(empty)
    expect(parseVerificationChecklistDraft('[1,2]')).toEqual(empty)
    expect(parseVerificationChecklistDraft('null')).toEqual(empty)
    expect(parseVerificationChecklistDraft(null)).toEqual(empty)
    expect(parseVerificationChecklistDraft('')).toEqual(empty)
    expect(parseVerificationChecklistDraft(JSON.stringify({ version: 'v0.0.1', entries: { 'u0-1': { status: 'ok', memo: '' } } }))).toEqual(empty)
  })

  it('想定外の status は未確認へ丸める(メモがなければ捨てる)', () => {
    const restored = parseVerificationChecklistDraft(JSON.stringify({
      version: VERIFICATION_CHECKLIST.version,
      entries: { 'u0-1': { status: 'bogus', memo: '' }, 'u0-2': { status: 'bogus', memo: '気になる' }, 'u0-3': 'x' },
      otherNotes: 5,
    }))
    expect(restored.entries['u0-1']).toBeUndefined()
    expect(restored.entries['u0-2']).toEqual({ status: 'unchecked', memo: '気になる' })
    expect(restored.entries['u0-3']).toBeUndefined()
    expect(restored.otherNotes).toBe('')
  })

  it('setVerificationChecklistEntry は元の下書きを壊さない(純関数)', () => {
    const base = createEmptyVerificationChecklistDraft()
    const next = setVerificationChecklistEntry(base, 'u0-1', { status: 'ok' })
    expect(base.entries['u0-1']).toBeUndefined()
    expect(getVerificationChecklistEntry(next, 'u0-1')).toEqual({ status: 'ok', memo: '' })
    // メモだけ足しても状態は保たれる。
    const withMemo = setVerificationChecklistEntry(next, 'u0-1', { memo: 'いい感じ' })
    expect(getVerificationChecklistEntry(withMemo, 'u0-1')).toEqual({ status: 'ok', memo: 'いい感じ' })
  })
})

describe('進捗カウント', () => {
  it('OK / 要改善 / 未確認を数える', () => {
    const draft = draftWith([['u0-1', 'ok'], ['u0-2', 'ok'], ['p-2', 'needs-fix', 'メモ']])
    const progress = countVerificationChecklistProgress(draft)
    expect(progress.total).toBe(VERIFICATION_CHECKLIST.items.length)
    expect(progress.ok).toBe(2)
    expect(progress.needsFix).toBe(1)
    expect(progress.checked).toBe(3)
    expect(progress.remaining).toBe(progress.total - 3)
  })

  it('定義に無い id は数えない', () => {
    const draft = setVerificationChecklistEntry(createEmptyVerificationChecklistDraft(), 'nope', { status: 'ok' })
    expect(countVerificationChecklistProgress(draft).checked).toBe(0)
  })
})

describe('送信本文の書式', () => {
  it('先頭行が固定マーカー・未確認は省略・要改善はメモ付き', () => {
    const draft = draftWith([['u0-1', 'ok'], ['p-2', 'needs-fix', '文字が細い']], '全体的に良い')
    const notes = buildVerificationChecklistReportNotes(draft)
    expect(notes).toHaveLength(1)
    expect(notes[0].split('\n')).toEqual([
      buildVerificationChecklistMarker(),
      '- u0-1 OK',
      '- p-2 要改善: 文字が細い',
      '- その他: 全体的に良い',
    ])
    expect(notes[0]).not.toContain('u0-2')
    expect(buildVerificationChecklistMarker()).toBe('[確認リスト v1.5.504]')
  })

  it('OK にメモがあれば残す・改行メモは1行に畳む', () => {
    const draft = draftWith([['u0-1', 'ok', '問題なし'], ['u0-2', 'needs-fix', '1行目\n2行目']])
    const [note] = buildVerificationChecklistReportNotes(draft)
    expect(note).toContain('- u0-1 OK: 問題なし')
    expect(note).toContain('- u0-2 要改善: 1行目 / 2行目')
  })

  it('全部未確認なら空配列(= 送らない)', () => {
    expect(buildVerificationChecklistReportNotes(createEmptyVerificationChecklistDraft())).toEqual([])
    // メモだけ書いて状態が未確認のままの項目も送らない。
    const memoOnly = setVerificationChecklistEntry(createEmptyVerificationChecklistDraft(), 'u0-1', { memo: 'あとで見る' })
    expect(buildVerificationChecklistReportNotes(memoOnly)).toEqual([])
  })

  it('その他の気づきだけでも送れる', () => {
    const draft = setVerificationChecklistOtherNotes(createEmptyVerificationChecklistDraft(), '印刷が重い')
    expect(buildVerificationChecklistReportNotes(draft)).toEqual([`${buildVerificationChecklistMarker()}\n- その他: 印刷が重い`])
  })

  it('2000字を超えると複数通に分かれ、各通の先頭に同じマーカーと (i/n) が付く', () => {
    const draft = draftWith(VERIFICATION_CHECKLIST.items.map((item) => [item.id, 'needs-fix', 'あ'.repeat(300)] as [string, 'needs-fix', string]))
    const notes = buildVerificationChecklistReportNotes(draft)
    expect(notes.length).toBeGreaterThan(1)
    notes.forEach((note, index) => {
      expect(note.length).toBeLessThanOrEqual(DEVELOPER_REPORT_NOTE_LIMIT)
      expect(note.split('\n')[0]).toBe(`${buildVerificationChecklistMarker()} (${index + 1}/${notes.length})`)
    })
    // どの項目も必ずどこかの通に載る(落ちない)。
    const joined = notes.join('\n')
    for (const item of VERIFICATION_CHECKLIST.items) expect(joined).toContain(`- ${item.id} 要改善`)
  })

  it('1行だけで上限を超える長文メモは切り詰めて必ず収める', () => {
    const draft = draftWith([['u0-1', 'needs-fix', 'い'.repeat(5000)]])
    const notes = buildVerificationChecklistReportNotes(draft)
    for (const note of notes) expect(note.length).toBeLessThanOrEqual(DEVELOPER_REPORT_NOTE_LIMIT)
    expect(notes[0]).toContain('- u0-1 要改善: ')
  })

  it('項目一覧と上限は差し替えられる(将来の版でも同じ書式)', () => {
    const items: VerificationChecklistItem[] = [
      { id: 'x-1', area: 'テスト', title: 'あ', steps: ['あ'], introducedIn: 'v9.9.9' },
      { id: 'x-2', area: 'テスト', title: 'い', steps: ['い'], introducedIn: 'v9.9.9' },
    ]
    const draft = draftWith([['x-1', 'ok'], ['x-2', 'needs-fix', 'なおして']])
    const notes = buildVerificationChecklistReportNotes(draft, { items, limit: 40 })
    expect(notes.length).toBeGreaterThan(1)
    for (const note of notes) expect(note.length).toBeLessThanOrEqual(40)
  })
})

describe('Markdown コピー', () => {
  it('未確認も含めた全項目と、その他の気づきが出る', () => {
    const draft = draftWith([['u0-1', 'ok'], ['p-2', 'needs-fix', '文字が細い']], '印刷が重い')
    const markdown = buildVerificationChecklistMarkdown(draft)
    expect(markdown).toContain(`# ${buildVerificationChecklistMarker()}`)
    expect(markdown).toContain('- [x] u0-1')
    expect(markdown).toContain('- [ ] p-2')
    expect(markdown).toContain('  - メモ: 文字が細い')
    expect(markdown).toContain('## その他の気づき')
    expect(markdown).toContain('- 印刷が重い')
    // 全項目が載る(未確認も含む)。
    for (const item of VERIFICATION_CHECKLIST.items) expect(markdown).toContain(item.id)
  })
})
