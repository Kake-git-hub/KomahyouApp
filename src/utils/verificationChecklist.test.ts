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
  setVerificationChecklistMemo,
  setVerificationChecklistOtherNotes,
  verificationChecklistStorageKey,
  type VerificationChecklistItem,
} from './verificationChecklist'

// 書式・進捗のテストは版ごとに変わる実項目に依存させない(第4版で項目が p-2/p-3 だけになり壊れたため固定の項目一覧を使う)。
const FIXTURE_ITEMS: VerificationChecklistItem[] = [
  { id: 'c-1', area: '確認リスト', title: 'あ', steps: ['あ'], introducedIn: 'v1.5.506' },
  { id: 'p-2', area: 'PDF', title: 'い', steps: ['い'], introducedIn: 'v1.5.502' },
  { id: 'p-3', area: 'PDF', title: 'う', steps: ['う'], introducedIn: 'v1.5.502' },
  { id: 'h-2', area: '日程表', title: 'え', steps: ['え'], introducedIn: 'v1.5.502' },
  { id: 'h-8', area: '日程表', title: 'お', steps: ['お'], introducedIn: 'v1.5.506' },
  { id: 'p-11', area: 'PDF', title: 'か', steps: ['か'], introducedIn: 'v1.5.506' },
]

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
      // 第16版(オーナー指示 2026-09-17「手順が多すぎて大変」): 操作は 1〜2 個・見るところは最大 4 つ・前提は1行。
      expect(item.steps.length, `${item.id} の操作が多すぎる`).toBeLessThanOrEqual(2)
      expect(item.check?.length ?? 0, `${item.id} の見るところが多すぎる`).toBeLessThanOrEqual(4)
      if (item.prep !== undefined) expect(item.prep, item.id).not.toContain('\n')
      for (const line of [...item.steps, ...(item.check ?? [])]) expect(line.trim(), item.id).not.toBe('')
      expect(item.title.trim(), item.id).not.toBe('')
      expect(item.area.trim(), item.id).not.toBe('')
    }
  })

  it('第25版(v1.5.558): 第23版の結果待ち(b-2/b-3/c-2/t-1/s-4/q-1〜q-6)に d-1(第24版)と t-2(第25版)を足しただけ(OK 済みは載せない運用)', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    expect(ids).toEqual(['b-2', 'b-3', 'c-2', 't-1', 't-2', 's-4', 'q-1', 'q-2', 'q-3', 'q-4', 'q-5', 'q-6', 'd-1'])
    // ★版は v1.5.556 据え置き: 項目を足しただけ(差し替え・削除なし)のときは上げない(第14版の決まり・CLAUDE.md)。
    //   上げると結果待ち項目の下書き(localStorage は版ごと)が消え、送信済みの結果もダッシュボードで「未確認」に戻る。
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.556')
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    // 第24版(2026-09-25): 開発ダッシュボード(開発者画面のサブページ)。読むだけの画面なので「教室のデータは何も変わらない」を必ず見る。
    const d1 = byId.get('d-1')!
    expect(d1.introducedIn).toBe('v1.5.557')
    expect(d1.area).toBe('開発者画面')
    expect(d1.steps.join(' / ')).toContain('開発ダッシュボード')
    expect((d1.check ?? []).join(' / ')).toContain('教室のデータは何も変わらない')
    // 版番号を手順に書かない(版を据え置いたまま項目を足す運用と食い違うため)。
    expect([d1.prep ?? '', ...d1.steps, ...(d1.check ?? [])].join(' / ')).not.toMatch(/v1\.5\.\d+/u)
    // 退塾の新仕様(オーナー確定 2026-09-20 夜): b-2 は「元に戻せません」、b-3 は日付入力での退塾と行ロック。
    for (const id of ['b-2', 'b-3']) expect(byId.get(id)!.introducedIn, id).toBe('v1.5.553')
    expect(byId.get('b-2')!.check!.join(' / ')).toContain('「退塾生徒」を押すと出る')
    expect(byId.get('b-2')!.check!.join(' / ')).not.toContain('非在籍生徒表示')
    expect(byId.get('b-3')!.steps.join(' / ')).toContain('退塾日に**今日**を入力')
    expect(byId.get('b-3')!.check!.join(' / ')).toContain('確認なしに')
    expect(byId.get('b-3')!.check!.join(' / ')).toContain('元に戻せません')
    // 保護者QRを休み連絡専用へ(2026-09-19・spec-parent-portal §0-5)。スマホ(保護者ページ)と PC(盤面の四択)の両方を確かめる。
    for (const id of ['q-1', 'q-2', 'q-3', 'q-4', 'q-5']) expect(byId.get(id)!.introducedIn, id).toBe('v1.5.550')
    // 「保護者連絡」ボタン(休み連絡の履歴・2026-09-19)。
    expect(byId.get('q-6')!.introducedIn).toBe('v1.5.552')
    expect(byId.get('q-6')!.check!.join(' / ')).toContain('四択のどれかを押した時点で')
    expect(byId.get('q-1')!.check!.join(' / ')).toContain('来月へは進めない')
    expect(byId.get('q-2')!.check!.join(' / ')).toContain('休み／振無休／振替先を今決める／何もしない')
    // オーナー確定: 処理済みは盤面を保存できた時点。保存せず閉じたら再通知されることを確かめる項目を必ず持つ。
    expect(byId.get('q-5')!.steps.join(' / ')).toContain('保存せずにPCをリロード')
    // 第23版(v1.5.556・2026-09-22): c-2 は要改善「すべての文字サイズが今の倍に」→ 2 倍(24〜36px)・幅 1120px の確認へ差し替え。
    const c2 = byId.get('c-2')!
    expect(c2.introducedIn).toBe('v1.5.556')
    expect((c2.check ?? []).join(' / ')).toContain('2 倍')
    expect((c2.check ?? []).join(' / ')).toContain('1120px')
    expect((c2.check ?? []).join(' / ')).not.toContain('本文 15px 程度')
    // その他欄(2026-09-22)「振替をさらに別日へ動かすと元の授業の振替先日が追いつかない」の修正確認 t-1。
    // A→B→C の 2 段の移動と、盤面・配布用盤面・生徒日程表の 3 か所を見る(兄弟監査)。
    const t1 = byId.get('t-1')!
    expect(t1.introducedIn).toBe('v1.5.556')
    expect(t1.steps.join(' / ')).toContain('C へドラッグ')
    expect((t1.check ?? []).join(' / ')).toContain('B ではなく C の日付')
    expect((t1.check ?? []).join(' / ')).toContain('配布用盤面')
    expect((t1.check ?? []).join(' / ')).toContain('生徒日程表')
    // 第25版(2026-09-26): 緑が丘 室長指摘「講師日程共有で振替先日付が追従しない」の修正確認 t-2。
    // 共有は今週以降だけなので「先週へ動かし直す」ことと、配布用盤面を見ることが確認の要。
    const t2 = byId.get('t-2')!
    expect(t2.introducedIn).toBe('v1.5.558')
    expect(t2.steps.join(' / ')).toContain('先週の C へドラッグ')
    expect((t2.check ?? []).join(' / ')).toContain('配布用盤面')
    // その他欄(2026-09-22)「サーバーバックアップから復元(直近3日)は機能問題ないので本番へ展開して」→ 全教室昇格の確認 s-4。
    // ★本番教室では「見るだけ」。復元を確定させる手順を書かない(本番データ保護ルール)。
    const s4 = byId.get('s-4')!
    expect(s4.introducedIn).toBe('v1.5.556')
    expect(s4.title).toContain('本番教室')
    expect(s4.prep).toContain('「この時点へ復元」は押さない')
    expect([...s4.steps, ...(s4.check ?? [])].join(' / ')).not.toContain('この時点を読み込む')
    expect((s4.check ?? []).join(' / ')).toContain('別教室の時点が混ざっていない')
    // 第22版の結果(2026-09-22・受付 e541141c)で OK だった項目は載せない。
    for (const okId of ['r-2', 'r-5', 'v-1', 'r-8', 'c-3', 'm-1', 'm-2', 'm-3', 's-1', 's-2', 's-3']) expect(ids, okId).not.toContain(okId)
    // 予行 y-1〜y-4 はオーナー判断で中止(2026-09-22「本番教室では以降の丸ごと振替だけ今の仕様なら問題ないので、この予行は不要」)。
    for (const okId of ['y-1', 'y-2', 'y-3', 'y-4']) expect(ids, okId).not.toContain(okId)
    // 2026-09-20: r-1/r-3/r-4/r-6/r-7 は OK 済み。
    for (const okId of ['r-1', 'r-3', 'r-4', 'r-6', 'r-7']) expect(ids, okId).not.toContain(okId)
    const b2 = byId.get('b-2')!
    const steps = [b2.prep ?? '', ...b2.steps, ...(b2.check ?? [])].join(' / ')
    // 旧定義(今日までは在籍・削除ボタンは翌日から)の手順を残さない。
    expect(steps).not.toContain('今日までは在籍')
    expect(steps).not.toContain('翌日から出る')
    // 旧仕様(手置きのコマは残る)の確認観点へ戻さない。
    expect(steps).not.toContain('講習・振替のコマは残っている')
    // 第21版(v1.5.553・オーナー確定 2026-09-20 夜): 一覧の呼び名は「退塾生徒」・退塾後の行は編集不可で削除だけ。
    expect(steps).toContain('「退塾生徒」を押すと出る')
    expect(steps).not.toContain('非在籍生徒表示')
    expect(steps).toContain('「編集」が無く「削除」だけ')
    expect(steps).toContain('退塾にすると元に戻せません')
    expect(steps).toContain('出欠の記録がすべて消えている')
    expect(steps).toContain('昨日以前の週')
    expect(steps).toContain('残数が控えより増えていない')
    // 第10版で k-11 / k-12 / h-10 は OK。
    for (const okId of ['k-11', 'k-12', 'h-10']) expect(ids, okId).not.toContain(okId)
    // 第9版で k-10 / h-9 / b-1 は OK。
    for (const okId of ['k-10', 'h-9', 'b-1']) expect(ids, okId).not.toContain(okId)
    // 第8版で k-4 は OK。
    expect(ids).not.toContain('k-4')
    // 第7版で k-5(月の移動)は OK。
    expect(ids).not.toContain('k-5')
    // v1.5.504〜v1.5.509 で OK だった項目(Issue #63〜#66)が残っていない。p-3 / p-12 は Issue #66 で OK。
    for (const okId of ['u0-1', 'u0-2', 'u0-3', 'u0-4', 'u0-5', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9', 'p-10', 'p-11', 'p-12', 'h-1', 'h-2', 'h-3', 'h-4', 'h-5', 'h-6', 'h-7', 'h-8', 'c-1']) {
      expect(ids, okId).not.toContain(okId)
    }
    // 第6版で OK だった保護者QRの項目(k-8 本番で入口が出ない / k-9 他教室コピー直後 = INV-08 の実経路を含む)も載せない。
    for (const okId of ['k-1', 'k-2', 'k-3', 'k-6', 'k-7', 'k-8', 'k-9']) {
      expect(ids, okId).not.toContain(okId)
    }
  })
})

describe('下書きの保存キーと往復', () => {
  it('教室別・版別のキーになる', () => {
    expect(verificationChecklistStorageKey('v8OZ7zH8vONNHjjYVcR1')).toBe('verification-checklist:v8OZ7zH8vONNHjjYVcR1:v1.5.556')
    expect(verificationChecklistStorageKey(null)).toBe('verification-checklist:unknown:v1.5.556')
    expect(VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY).toBe('verification-checklist:collapsed')
  })

  it('serialize → parse で内容が戻る', () => {
    const draft = draftWith([['c-1', 'ok'], ['p-2', 'needs-fix', '文字が細い']], 'ほかは問題なし')
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
    expect(parseVerificationChecklistDraft(JSON.stringify({ version: 'v0.0.1', entries: { 'c-1': { status: 'ok', memo: '' } } }))).toEqual(empty)
  })

  it('想定外の status は未確認へ丸める(メモがなければ捨てる)', () => {
    const restored = parseVerificationChecklistDraft(JSON.stringify({
      version: VERIFICATION_CHECKLIST.version,
      entries: { 'c-1': { status: 'bogus', memo: '' }, 'p-3': { status: 'bogus', memo: '気になる' }, 'h-2': 'x' },
      otherNotes: 5,
    }))
    expect(restored.entries['c-1']).toBeUndefined()
    expect(restored.entries['p-3']).toEqual({ status: 'unchecked', memo: '気になる' })
    expect(restored.entries['h-2']).toBeUndefined()
    expect(restored.otherNotes).toBe('')
  })

  it('setVerificationChecklistEntry は元の下書きを壊さない(純関数)', () => {
    const base = createEmptyVerificationChecklistDraft()
    const next = setVerificationChecklistEntry(base, 'c-1', { status: 'ok' })
    expect(base.entries['c-1']).toBeUndefined()
    expect(getVerificationChecklistEntry(next, 'c-1')).toEqual({ status: 'ok', memo: '' })
    // メモだけ足しても状態は保たれる。
    const withMemo = setVerificationChecklistEntry(next, 'c-1', { memo: 'いい感じ' })
    expect(getVerificationChecklistEntry(withMemo, 'c-1')).toEqual({ status: 'ok', memo: 'いい感じ' })
  })
})

describe('進捗カウント', () => {
  it('OK / 要改善 / 未確認を数える', () => {
    const draft = draftWith([['c-1', 'ok'], ['p-3', 'ok'], ['p-2', 'needs-fix', 'メモ']])
    const progress = countVerificationChecklistProgress(draft, FIXTURE_ITEMS)
    expect(progress.total).toBe(FIXTURE_ITEMS.length)
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
    const draft = draftWith([['c-1', 'ok'], ['p-2', 'needs-fix', '文字が細い']], '全体的に良い')
    const notes = buildVerificationChecklistReportNotes(draft, { items: FIXTURE_ITEMS })
    expect(notes).toHaveLength(1)
    expect(notes[0].split('\n')).toEqual([
      buildVerificationChecklistMarker(),
      '- c-1 OK',
      '- p-2 要改善: 文字が細い',
      '- その他: 全体的に良い',
    ])
    expect(notes[0]).not.toContain('p-3')
    expect(buildVerificationChecklistMarker()).toBe('[確認リスト v1.5.556]')
  })

  it('OK にメモがあれば残す・改行メモは1行に畳む', () => {
    const draft = draftWith([['c-1', 'ok', '問題なし'], ['p-3', 'needs-fix', '1行目\n2行目']])
    const [note] = buildVerificationChecklistReportNotes(draft, { items: FIXTURE_ITEMS })
    expect(note).toContain('- c-1 OK: 問題なし')
    expect(note).toContain('- p-3 要改善: 1行目 / 2行目')
  })

  it('全部未確認なら空配列(= 送らない)', () => {
    expect(buildVerificationChecklistReportNotes(createEmptyVerificationChecklistDraft())).toEqual([])
    // メモだけ書いて状態が未確認のままの項目も送らない。
    const memoOnly = setVerificationChecklistEntry(createEmptyVerificationChecklistDraft(), 'c-1', { memo: 'あとで見る' })
    expect(buildVerificationChecklistReportNotes(memoOnly)).toEqual([])
  })

  it('その他の気づきだけでも送れる', () => {
    const draft = setVerificationChecklistOtherNotes(createEmptyVerificationChecklistDraft(), '印刷が重い')
    expect(buildVerificationChecklistReportNotes(draft)).toEqual([`${buildVerificationChecklistMarker()}\n- その他: 印刷が重い`])
  })

  it('2000字を超えると複数通に分かれ、各通の先頭に同じマーカーと (i/n) が付く', () => {
    const draft = draftWith(FIXTURE_ITEMS.map((item) => [item.id, 'needs-fix', 'あ'.repeat(600)] as [string, 'needs-fix', string]))
    const notes = buildVerificationChecklistReportNotes(draft, { items: FIXTURE_ITEMS })
    expect(notes.length).toBeGreaterThan(1)
    notes.forEach((note, index) => {
      expect(note.length).toBeLessThanOrEqual(DEVELOPER_REPORT_NOTE_LIMIT)
      expect(note.split('\n')[0]).toBe(`${buildVerificationChecklistMarker()} (${index + 1}/${notes.length})`)
    })
    // どの項目も必ずどこかの通に載る(落ちない)。
    const joined = notes.join('\n')
    for (const item of FIXTURE_ITEMS) expect(joined).toContain(`- ${item.id} 要改善`)
  })

  it('1行だけで上限を超える長文メモは切り詰めて必ず収める', () => {
    const draft = draftWith([['c-1', 'needs-fix', 'い'.repeat(5000)]])
    const notes = buildVerificationChecklistReportNotes(draft, { items: FIXTURE_ITEMS })
    for (const note of notes) expect(note.length).toBeLessThanOrEqual(DEVELOPER_REPORT_NOTE_LIMIT)
    expect(notes[0]).toContain('- c-1 要改善: ')
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
    const draft = draftWith([['c-1', 'ok'], ['p-2', 'needs-fix', '文字が細い']], '印刷が重い')
    const markdown = buildVerificationChecklistMarkdown(draft, FIXTURE_ITEMS)
    expect(markdown).toContain(`# ${buildVerificationChecklistMarker()}`)
    expect(markdown).toContain('- [x] c-1')
    expect(markdown).toContain('- [ ] p-2')
    expect(markdown).toContain('  - メモ: 文字が細い')
    expect(markdown).toContain('## その他の気づき')
    expect(markdown).toContain('- 印刷が重い')
    // 全項目が載る(未確認も含む)。
    for (const item of FIXTURE_ITEMS) expect(markdown).toContain(item.id)
  })
})

describe('メモ欄の入力(常時表示・2026-09-13)', () => {
  // 項目は版ごとに差し替わるので、現行版の先頭項目で検証する(特定 id に依存させない)。
  const itemId = VERIFICATION_CHECKLIST.items[0].id

  it('未確認のままメモを書くと要改善に切り替わり、送信本文に載る(黙って捨てない)', () => {
    const draft = setVerificationChecklistMemo(createEmptyVerificationChecklistDraft(), itemId, '文言を直して')
    expect(draft.entries[itemId]).toEqual({ status: 'needs-fix', memo: '文言を直して' })
    expect(buildVerificationChecklistReportNotes(draft).join('\n')).toContain(`- ${itemId} 要改善: 文言を直して`)
  })

  it('OK のままメモを書いても OK のまま(OK: メモ で送る)', () => {
    const ok = setVerificationChecklistEntry(createEmptyVerificationChecklistDraft(), itemId, { status: 'ok' })
    const draft = setVerificationChecklistMemo(ok, itemId, '問題なし')
    expect(draft.entries[itemId]).toEqual({ status: 'ok', memo: '問題なし' })
  })

  it('空白だけのメモでは未確認のまま(入力途中で勝手に要改善にしない)', () => {
    const draft = setVerificationChecklistMemo(createEmptyVerificationChecklistDraft(), itemId, '  ')
    expect(draft.entries[itemId]?.status).toBe('unchecked')
  })
})
