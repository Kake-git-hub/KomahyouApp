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
  resolveVerificationChecklistText,
  serializeVerificationChecklistDraft,
  setVerificationChecklistEntry,
  setVerificationChecklistMemo,
  setVerificationChecklistOtherNotes,
  verificationChecklistStorageKey,
  VERIFICATION_CHECKLIST_ATTACHMENT_MAX_BYTES,
  VERIFICATION_CHECKLIST_ATTACHMENT_MAX_PER_ITEM,
  VERIFICATION_CHECKLIST_ATTACHMENT_MAX_TOTAL,
  VERIFICATION_CHECKLIST_ATTACHMENT_TOTAL_MAX_BYTES,
  addVerificationChecklistAttachment,
  collectStaleVerificationChecklistDraftKeys,
  buildVerificationChecklistReportAttachments,
  getVerificationChecklistAttachments,
  removeVerificationChecklistAttachment,
  type VerificationChecklistItem,
  selectVerificationChecklistItems,
  VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS,
  VERIFICATION_CHECKLIST_STUDENT_PLACEHOLDER,
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

  it('第55版(v1.5.604・2026-10-15): 受付 20261015-151056959-a8890098 で OK だった c-5・tp-47・tp-53・tp-54 を外し、結果待ちの q-1〜q-6・tp-15・tp-48〜51・tp-55〜57 を残す', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    // 同日のオーナー指示(保護者QR §0-7)で q-7〜q-9 を tp-15 の後ろに足した(確認中の版へ足すだけなので版は据え置き)。
    expect(ids).toEqual(['q-1', 'q-2', 'q-3', 'q-4', 'q-5', 'q-6', 'tp-15', 'q-7', 'q-8', 'q-9', 'tp-48', 'tp-49', 'tp-50', 'tp-51', 'tp-55', 'tp-56', 'tp-57'])
    // 第54版の結果(2026-10-15・受付 20261015-151056959-a8890098)で OK → 外す。
    for (const okId of ['c-5', 'tp-47', 'tp-53', 'tp-54']) expect(ids, okId).not.toContain(okId)
    // 第54版の結果(2026-10-15・受付 20261015-133308495-046ae8de)で OK → 外す。
    for (const okId of ['tp-39', 'tp-41', 'tp-40', 'c-6', 'tp-42', 'tp-43', 'tp-44', 'tp-45', 'tp-46', 'tp-52']) expect(ids, okId).not.toContain(okId)
    // 第49版の結果(2026-10-14・受付 20261014-062117803-c223100f)で OK → 外す。
    for (const okId of ['tp-32', 'tp-33', 'tp-36', 'tp-37', 'tp-38', 'pm-1', 'c-4']) expect(ids, okId).not.toContain(okId)
    // 第41版の結果(2026-10-10・受付 20261010-144912762-45a17afb)で OK → 外す(タブ名 mc-1・請求画面 bl-1〜bl-4・テンプレ保留 tp-31/tp-34/tp-35・講習の重複 tp-30)。
    for (const okId of ['tp-31', 'tp-34', 'tp-35', 'tp-30', 'mc-1', 'bl-1', 'bl-2', 'bl-3', 'bl-4']) expect(ids, okId).not.toContain(okId)
    // 第39版の結果(2026-10-07・受付 20261007-114407125-114ac7b6)で hm-1〜hm-4 がすべて OK。
    for (const okId of ['hm-1', 'hm-2', 'hm-3', 'hm-4']) expect(ids, okId).not.toContain(okId)
    // 第37版の結果(2026-10-03・受付 20261003-141217458-0166a9a2)で OK。
    for (const okId of ['tp-26', 'tp-27', 'tp-28', 'tp-29']) expect(ids, okId).not.toContain(okId)
    // 第36版の結果(2026-10-02・受付 20261002-045333221-35108a3e)で OK。
    for (const okId of ['tp-19', 'tp-22', 'tp-24', 'tp-25']) expect(ids, okId).not.toContain(okId)
    // 第35版の結果(2026-10-02・受付 20261002-031208925-c9dbe6ee)で OK。
    for (const okId of ['tp-17', 'tp-18', 'tp-20', 'tp-21', 'tp-23']) expect(ids, okId).not.toContain(okId)
    // 第34版の結果(2026-09-30・受付 20260930-024853040-0e2c42f6)で OK。
    for (const okId of ['a-4', 'tp-1', 'tp-2', 'tp-3', 'tp-4', 'tp-5', 'tp-6', 'tp-7', 'tp-8', 'tp-9', 'tp-10', 'tp-11', 'tp-12', 'tp-13', 'tp-14', 'tp-16']) expect(ids, okId).not.toContain(okId)
    // 第31版の結果(2026-09-28・受付 20260928-103642968-d4c32a94)で OK。
    for (const okId of ['t-2', 't-3', 'd-1', 'd-2', 'd-3', 'd-4', 'a-1', 'a-2', 'a-3']) expect(ids, okId).not.toContain(okId)
    for (const okId of ['b-2', 'b-3', 'c-2', 't-1', 's-4']) expect(ids, okId).not.toContain(okId)
    // 第49版(2026-10-14): OK 済み 7 件を外したので v1.5.596 へ。第50〜53版は項目を足しただけで据え置き。
    // 第54版(2026-10-15): OK 済み 10 件を外したので v1.5.602 へ。第55版(同日): OK 済み 4 件を外したので次にデプロイされる版 v1.5.604 へ上げる。
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.604')
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    // tp-15 は要改善「確認リストの保護者連絡の欄に入れて」→ 保護者QR(休み連絡)の欄へ移し、q-6 の直後に置く(中身は据え置き)。
    expect(byId.get('tp-15')!.area).toBe('保護者QR(休み連絡)')
    expect(byId.get('tp-15')!.area).toBe(byId.get('q-6')!.area)
    expect(ids.indexOf('tp-15')).toBe(ids.indexOf('q-6') + 1)
    expect(byId.get('tp-15')!.introducedIn).toBe('v1.5.572')
    expect(byId.get('tp-15')!.check!.join(' / ')).toContain('自動では処理しませんでした')
    // 第47版: 今の緑の机(10/16(金) 5限の机 2)を名指し。上段を先に休みにすると机が 1 行に戻って下段でなくなるので、下段→上段の順。
    expect(byId.get('tp-15')!.prep).toContain('10/16(金) 5限の机 2')
    expect(byId.get('tp-15')!.steps[0]).toMatch(/先に下段の\{\{student:s079\}\}.*次に上段の\{\{student:s085\}\}/u)
    // 第54版(2026-10-15): 基本仕様の確認 tp-55〜57 は v1.5.602 で追加。
    for (const id of ['tp-55', 'tp-56', 'tp-57']) expect(byId.get(id)!.introducedIn, id).toBe('v1.5.602')
    // オーナー指示「未消化数が変化しないこと・日程表とコマ表に差異がないこと・コマ表から意図してない変更が発生してないこと(基本仕様のデバッグ)」: テスト教室にも出す。
    for (const id of ['tp-55', 'tp-56', 'tp-57']) {
      expect(byId.get(id)!.title, id).toContain('【基本仕様】')
      expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, id).toContain(id)
    }
    expect(byId.get('tp-55')!.title).toContain('未消化振替・未消化講習の残数が変わらない')
    expect(byId.get('tp-55')!.check!.join(' / ')).toContain('生徒ごとに保存前と同じ')
    expect(byId.get('tp-56')!.title).toContain('コマ表(盤面)と生徒日程表・講師日程表の内容が一致する')
    expect(byId.get('tp-56')!.check!.join(' / ')).toContain('盤面に無いコマが日程表にだけ出たり')
    expect(byId.get('tp-57')!.title).toContain('意図しない変更が起きない')
    expect(byId.get('tp-57')!.check!.join(' / ')).toContain('反映開始日より前の週の机は、どちらの保存でも変わらない')
    // #75 の段 2(tp-48〜51)はまだ結果が無いので残す(文面は据え置き)。
    for (const id of ['tp-48', 'tp-49', 'tp-50', 'tp-51']) expect(byId.get(id)!.introducedIn, id).toBe('v1.5.599')
    // 生徒名はソースに載せない(スナップショットの実名は「姓 + 全角スペース + 名」の形)。第43版(2026-10-10 オーナー指示「開発用教室は名前を見ていい」):
    // 代わりに {{student:<生徒ID>}} を書き、画面が開いている教室の生徒データから名前を差し込む。
    for (const item of VERIFICATION_CHECKLIST.items) {
      for (const line of [item.title, item.prep ?? '', ...item.steps, ...(item.check ?? [])]) expect(line, item.id).not.toMatch(/[一-龠ぁ-んァ-ヶ]+\u3000[一-龠ぁ-んァ-ヶ]+/u)
    }
    // 保護者QRを休み連絡専用へ(2026-09-19・spec-parent-portal §0-5)。スマホ(保護者ページ)と PC(盤面の四択)の両方を確かめる。
    for (const id of ['q-1', 'q-2', 'q-3', 'q-4', 'q-5']) expect(byId.get(id)!.introducedIn, id).toBe('v1.5.550')
    // 「保護者連絡」ボタン(休み連絡の履歴・2026-09-19)。
    expect(byId.get('q-6')!.introducedIn).toBe('v1.5.552')
    expect(byId.get('q-6')!.check!.join(' / ')).toContain('四択のどれかを押した時点で')
    expect(byId.get('q-1')!.check!.join(' / ')).toContain('来月へは進めない')
    expect(byId.get('q-2')!.check!.join(' / ')).toContain('休み／振無休／振替先を今決める／何もしない')
    // オーナー確定: 処理済みは盤面を保存できた時点。保存せず閉じたら再通知されることを確かめる項目を必ず持つ。
    expect(byId.get('q-5')!.steps.join(' / ')).toContain('保存せずにPCをリロード')
    // 第22版の結果(2026-09-22・受付 e541141c)で OK だった項目は載せない。
    for (const okId of ['r-2', 'r-5', 'v-1', 'r-8', 'c-3', 'm-1', 'm-2', 'm-3', 's-1', 's-2', 's-3']) expect(ids, okId).not.toContain(okId)
    // 予行 y-1〜y-4 はオーナー判断で中止(2026-09-22「本番教室では以降の丸ごと振替だけ今の仕様なら問題ないので、この予行は不要」)。
    for (const okId of ['y-1', 'y-2', 'y-3', 'y-4']) expect(ids, okId).not.toContain(okId)
    // 2026-09-20: r-1/r-3/r-4/r-6/r-7 は OK 済み。
    for (const okId of ['r-1', 'r-3', 'r-4', 'r-6', 'r-7']) expect(ids, okId).not.toContain(okId)
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

describe('生徒名の差し込み(resolveVerificationChecklistText・2026-10-10)', () => {
  const names: Record<string, string> = { s069: '山田太郎', s063: '鈴木花子' }
  const resolve = (id: string) => names[id] ?? null

  it('{{student:ID}} を開いている教室の生徒名に置き換える(複数・同じ ID の繰り返しも)', () => {
    expect(resolveVerificationChecklistText('机 9 の生徒 2({{student:s069}}・中2・社)と{{student:s063}}、再び{{student:s069}}', resolve))
      .toBe('机 9 の生徒 2(山田太郎・中2・社)と鈴木花子、再び山田太郎')
  })

  it('名前が引けない ID は「名前不明(ID)」にして学年・科目で探せる形を残す。空文字も不明扱い', () => {
    expect(resolveVerificationChecklistText('({{student:s999}}・小6・算)', resolve)).toBe('(名前不明(s999)・小6・算)')
    expect(resolveVerificationChecklistText('{{student:s001}}', () => '  ')).toBe('名前不明(s001)')
  })

  it('resolver が無ければ全部「名前不明(ID)」。プレースホルダの無い文面はそのまま', () => {
    expect(resolveVerificationChecklistText('{{student:s069}}')).toBe('名前不明(s069)')
    expect(resolveVerificationChecklistText('机 2 の生徒 1(小6・算)', resolve)).toBe('机 2 の生徒 1(小6・算)')
  })

  it('定義の全プレースホルダが生徒 ID の形(s + 数字)で、画面に残らない', () => {
    for (const item of VERIFICATION_CHECKLIST.items) {
      for (const line of [item.title, item.prep ?? '', ...item.steps, ...(item.check ?? [])]) {
        for (const match of line.matchAll(/\{\{student:([^}]*)\}\}/gu)) expect(match[1], item.id).toMatch(/^s\d{3}$/u)
        expect(resolveVerificationChecklistText(line, () => '生徒名'), item.id).not.toContain('{{')
      }
    }
  })
})

describe('下書きの保存キーと往復', () => {
  it('教室別・版別のキーになる', () => {
    expect(verificationChecklistStorageKey('v8OZ7zH8vONNHjjYVcR1')).toBe('verification-checklist:v8OZ7zH8vONNHjjYVcR1:v1.5.604')
    expect(verificationChecklistStorageKey(null)).toBe('verification-checklist:unknown:v1.5.604')
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
    expect(buildVerificationChecklistMarker()).toBe('[確認リスト v1.5.604]')
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

describe('添付画像(2026-10-14 オーナー要望「確認リストにスクショで画像毎保存できるようにしたい」)', () => {
  const dataUrlOfBytes = (bytes: number, mime = 'image/jpeg') => `data:${mime};base64,${Buffer.alloc(bytes, 1).toString('base64')}`

  it('項目に画像を足すと下書きに残り、未確認なら要改善に切り替わる。OK のままなら OK のまま', () => {
    const base = createEmptyVerificationChecklistDraft()
    const added = addVerificationChecklistAttachment(base, { itemId: 'p-2', name: 'shot.png', dataUrl: dataUrlOfBytes(30) }, 'att-1')
    expect(added.error).toBeNull()
    expect(base.attachments).toEqual([]) // 純関数
    expect(getVerificationChecklistAttachments(added.draft, 'p-2')).toEqual([{ id: 'att-1', itemId: 'p-2', name: 'shot.png', mimeType: 'image/jpeg', dataUrl: dataUrlOfBytes(30), byteLength: 30 }])
    expect(getVerificationChecklistEntry(added.draft, 'p-2').status).toBe('needs-fix')
    const okDraft = setVerificationChecklistEntry(base, 'c-1', { status: 'ok' })
    const okAdded = addVerificationChecklistAttachment(okDraft, { itemId: 'c-1', name: '', dataUrl: dataUrlOfBytes(3, 'image/png') }, 'att-2')
    expect(getVerificationChecklistEntry(okAdded.draft, 'c-1').status).toBe('ok')
    expect(getVerificationChecklistAttachments(okAdded.draft, 'c-1')[0].name).toBe('image')
  })

  it('断る理由: 画像でない・1 枚の上限・項目の枚数上限・合計上限・同じ id', () => {
    const base = createEmptyVerificationChecklistDraft()
    expect(addVerificationChecklistAttachment(base, { itemId: 'p-2', name: 'a', dataUrl: 'data:text/plain;base64,QUJD' }, 'a').error).toContain('画像')
    expect(addVerificationChecklistAttachment(base, { itemId: 'p-2', name: 'a', dataUrl: dataUrlOfBytes(VERIFICATION_CHECKLIST_ATTACHMENT_MAX_BYTES + 3) }, 'a').error).toContain('大きすぎます')
    let draft = base
    for (let index = 0; index < VERIFICATION_CHECKLIST_ATTACHMENT_MAX_PER_ITEM; index += 1) {
      const result = addVerificationChecklistAttachment(draft, { itemId: 'p-2', name: `${index}`, dataUrl: dataUrlOfBytes(3) }, `att-${index}`)
      expect(result.error).toBeNull()
      draft = result.draft
    }
    expect(addVerificationChecklistAttachment(draft, { itemId: 'p-2', name: 'x', dataUrl: dataUrlOfBytes(3) }, 'att-x').error).toContain(`${VERIFICATION_CHECKLIST_ATTACHMENT_MAX_PER_ITEM} 枚まで`)
    // 別の項目には足せる
    expect(addVerificationChecklistAttachment(draft, { itemId: 'p-3', name: 'x', dataUrl: dataUrlOfBytes(3) }, 'att-y').error).toBeNull()
    expect(addVerificationChecklistAttachment(draft, { itemId: 'p-3', name: 'x', dataUrl: dataUrlOfBytes(3) }, 'att-0').error).toContain('既に')
    // 合計上限: 1 枚ずつは上限内でも合計で止まる
    const big = VERIFICATION_CHECKLIST_ATTACHMENT_MAX_BYTES - 3
    let total = base
    let stopped: string | null = null
    for (let index = 0; index < 10 && !stopped; index += 1) {
      const result = addVerificationChecklistAttachment(total, { itemId: `h-${index}`, name: 'b', dataUrl: dataUrlOfBytes(big) }, `big-${index}`)
      stopped = result.error
      total = result.draft
    }
    expect(stopped).toContain('合計')
    expect(total.attachments.length).toBe(Math.floor(VERIFICATION_CHECKLIST_ATTACHMENT_TOTAL_MAX_BYTES / big))
  })

  it('下書き全体の枚数は 1 通に付けられる枚数(8)で止める＝送信時に黙って切られない(regression-reviewer 指摘)', () => {
    expect(VERIFICATION_CHECKLIST_ATTACHMENT_MAX_TOTAL).toBe(8)
    let draft = createEmptyVerificationChecklistDraft()
    for (let index = 0; index < VERIFICATION_CHECKLIST_ATTACHMENT_MAX_TOTAL; index += 1) {
      const result = addVerificationChecklistAttachment(draft, { itemId: `h-${index}`, name: 'a', dataUrl: dataUrlOfBytes(3) }, `n-${index}`)
      expect(result.error, `${index}`).toBeNull()
      draft = result.draft
    }
    const ninth = addVerificationChecklistAttachment(draft, { itemId: 'h-9', name: 'a', dataUrl: dataUrlOfBytes(3) }, 'n-9')
    expect(ninth.error).toContain('8 枚まで')
    expect(ninth.draft).toBe(draft)
    // 送信に同梱する枚数と下書きの枚数が一致する(未確認の項目は無い＝全部要改善に切り替わっている)。
    const items = Array.from({ length: VERIFICATION_CHECKLIST_ATTACHMENT_MAX_TOTAL }, (_, index) => ({ id: `h-${index}`, area: 'A', title: 't', steps: ['s'], introducedIn: 'v1.5.0' }))
    expect(buildVerificationChecklistReportAttachments(draft, items)).toHaveLength(VERIFICATION_CHECKLIST_ATTACHMENT_MAX_TOTAL)
  })

  it('同じ教室の別の版の下書きキーだけを列挙する(今の版・他の教室・折りたたみ・別タブの拡大率は触らない)', () => {
    const keys = [
      'verification-checklist:c1:v1.5.590',
      'verification-checklist:c1:v1.5.596',
      'verification-checklist:c1:v1.5.587',
      'verification-checklist:c2:v1.5.587',
      'verification-checklist:collapsed',
      'verification-checklist:window-zoom',
      'verification-checklist:c1:draft',
      'operation-trace:c1',
    ]
    expect(collectStaleVerificationChecklistDraftKeys(keys, 'c1', 'v1.5.596')).toEqual(['verification-checklist:c1:v1.5.590', 'verification-checklist:c1:v1.5.587'])
    expect(collectStaleVerificationChecklistDraftKeys(keys, 'c2', 'v1.5.596')).toEqual(['verification-checklist:c2:v1.5.587'])
    expect(collectStaleVerificationChecklistDraftKeys(keys, null, 'v1.5.596')).toEqual([])
  })

  it('外すと消える(無い id なら同じ内容)。serialize → parse で画像も戻り、壊れた画像だけ落ちる', () => {
    const added = addVerificationChecklistAttachment(createEmptyVerificationChecklistDraft(), { itemId: 'p-2', name: 'a', dataUrl: dataUrlOfBytes(6) }, 'att-1').draft
    expect(removeVerificationChecklistAttachment(added, 'nope')).toEqual(added)
    expect(removeVerificationChecklistAttachment(added, 'att-1').attachments).toEqual([])
    expect(parseVerificationChecklistDraft(serializeVerificationChecklistDraft(added))).toEqual(added)
    const restored = parseVerificationChecklistDraft(JSON.stringify({
      version: VERIFICATION_CHECKLIST.version,
      entries: {},
      otherNotes: '',
      attachments: [
        { id: 'ok', itemId: 'p-2', name: 'a', dataUrl: dataUrlOfBytes(6) },
        { id: 'ok', itemId: 'p-2', name: 'dup', dataUrl: dataUrlOfBytes(6) },
        { id: 'bad', itemId: 'p-2', name: 'a', dataUrl: 'data:text/plain;base64,QUJD' },
        { id: 'huge', itemId: 'p-2', name: 'a', dataUrl: dataUrlOfBytes(VERIFICATION_CHECKLIST_ATTACHMENT_MAX_BYTES + 3) },
        { id: '', itemId: 'p-2', dataUrl: dataUrlOfBytes(6) },
        'junk',
      ],
    }))
    expect(restored.attachments.map((attachment) => attachment.id)).toEqual(['ok'])
    expect(restored.attachments[0].byteLength).toBe(6)
    // 古い下書き(attachments 無し)も読める
    expect(parseVerificationChecklistDraft(JSON.stringify({ version: VERIFICATION_CHECKLIST.version, entries: {}, otherNotes: 'x' })).attachments).toEqual([])
  })

  it('送信本文には枚数の印 [画像n枚] が付き、添付は項目順・label=項目 id で組み立てる(未確認の項目は送らない)', () => {
    let draft = draftWith([['c-1', 'ok'], ['p-2', 'needs-fix', '白抜き']])
    draft = addVerificationChecklistAttachment(draft, { itemId: 'p-2', name: '2.png', dataUrl: dataUrlOfBytes(6) }, 'a').draft
    draft = addVerificationChecklistAttachment(draft, { itemId: 'c-1', name: '1.png', dataUrl: dataUrlOfBytes(3, 'image/png') }, 'b').draft
    draft = addVerificationChecklistAttachment(draft, { itemId: 'p-2', name: '3.png', dataUrl: dataUrlOfBytes(9) }, 'c').draft
    const notes = buildVerificationChecklistReportNotes(draft, { items: FIXTURE_ITEMS })
    expect(notes[0].split('\n')).toEqual([buildVerificationChecklistMarker(), '- c-1 OK: [画像1枚]', '- p-2 要改善: 白抜き [画像2枚]'])
    const attachments = buildVerificationChecklistReportAttachments(draft, FIXTURE_ITEMS)
    expect(attachments.map((attachment) => `${attachment.label}:${attachment.name}:${attachment.mimeType}`)).toEqual(['c-1:1.png:image/png', 'p-2:2.png:image/jpeg', 'p-2:3.png:image/jpeg'])
    // 未確認へ戻した項目の画像は送らない(本文にも載らない)
    const unchecked = setVerificationChecklistEntry(draft, 'c-1', { status: 'unchecked' })
    expect(buildVerificationChecklistReportAttachments(unchecked, FIXTURE_ITEMS).map((attachment) => attachment.label)).toEqual(['p-2', 'p-2'])
    expect(buildVerificationChecklistReportNotes(unchecked, { items: FIXTURE_ITEMS })[0]).not.toContain('c-1')
    // Markdown にも枚数と名前
    expect(buildVerificationChecklistMarkdown(draft, FIXTURE_ITEMS)).toContain('  - 画像: 2 枚(2.png, 3.png)')
  })
})

describe('テスト教室(sandbox)に出す項目(2026-10-15 オーナー指示「テスト教室にはテンプレ関係の確認リストだけ・開発用教室はすべて」)', () => {
  it('development は全項目・sandbox は VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS だけ(正本の順)', () => {
    expect(selectVerificationChecklistItems('development')).toBe(VERIFICATION_CHECKLIST.items)
    expect(selectVerificationChecklistItems('sandbox').map((item) => item.id)).toEqual(['tp-48', 'tp-49', 'tp-50', 'tp-51', 'tp-55', 'tp-56', 'tp-57'])
  })

  it('sandbox の項目は存在し、テンプレ作成の分類で、特定教室の生徒名プレースホルダを使わず、開発用教室だけの前提(tp-41)に依らない', () => {
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    for (const id of VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS) {
      const item = byId.get(id)
      expect(item, id).toBeDefined()
      expect(item!.area, id).toBe('テンプレ作成')
      const text = [item!.title, item!.prep ?? '', ...item!.steps, ...(item!.check ?? [])].join('\n')
      expect(text, id).not.toMatch(VERIFICATION_CHECKLIST_STUDENT_PLACEHOLDER)
      expect(text, id).not.toContain('tp-41')
      expect(text, id).not.toContain('開発用教室で')
    }
  })
})
