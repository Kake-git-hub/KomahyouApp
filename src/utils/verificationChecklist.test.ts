// 開発用教室の確認リスト(2026-09-12)の回帰防止テスト。
// パネルは開発用教室でしか出ないが、書式・下書き・分割は純関数なのでここで固定する。

import { readFileSync } from 'node:fs'
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
  VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS,
  VERIFICATION_CHECKLIST_STUDENT_PLACEHOLDER,
  buildVerificationChecklistItemReportNote,
  buildVerificationChecklistOtherNotesReportNote,
  buildVerificationChecklistItemReportAttachments,
  markVerificationChecklistItemSent,
  clearReworkedVerificationChecklistEntries,
  resolveVerificationChecklistItemSendState,
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

const byIdOf = <T extends { id: string }>(items: readonly T[]) => new Map(items.map((item) => [item.id, item]))

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

  // 第62版(2026-10-17・オーナー指示「確認リストの日本語が難しいのでもっとわかりやすくして」): 開発の内輪の言葉を文面へ戻さない。
  // 画面にある文字(ボタン名・メッセージ)は「」で引用してそのまま書いてよいので、「」の中は検査から外す。
  it('文面に内輪の言葉(盤面・四択・モーダル・確認文・実機・突き合わせ・上段/下段)を使わない(「」で引いた画面の文字は除く)', () => {
    const jargon = /盤面|四択|モーダル|確認文|実機|突き合わせ|上段|下段/u
    for (const item of VERIFICATION_CHECKLIST.items) {
      for (const line of [item.title, item.prep ?? '', ...item.steps, ...(item.check ?? [])]) {
        const outsideQuotes = line.replace(/「[^「」]*(?:「[^「」]*」[^「」]*)*」/gu, '')
        expect(outsideQuotes, `${item.id}: ${line}`).not.toMatch(jargon)
      }
    }
  })

  it('文面が名指しする別の項目(q-3・tp-48 など)は、今のリストに実在する(外した項目を前提にしない)', () => {
    const ids = new Set(VERIFICATION_CHECKLIST.items.map((item) => item.id))
    for (const item of VERIFICATION_CHECKLIST.items) {
      for (const line of [item.title, item.prep ?? '', ...item.steps, ...(item.check ?? [])]) {
        for (const match of line.matchAll(/\b(q|tp|sr|c)-(\d+)\b/gu)) expect(ids, `${item.id} が ${match[0]} を参照`).toContain(match[0])
      }
    }
  })

  it('第111版(2026-11-05・v1.5.689 据え置き): 退塾取消の確認 wc-1・wc-2 を足した(開発用教室だけ・項目を足しただけなので版は上げない)', () => {
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    for (const id of ['wc-1', 'wc-2']) {
      expect(byId.get(id)?.introducedIn, id).toBe('v1.5.691')
      expect(byId.get(id)?.area, id).toBe('基本データ')
      expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, id).not.toContain(id)
    }
    expect(byId.get('wc-1')!.check!.join('\n')).toContain('「戻らない授業」')
    expect(byId.get('wc-1')!.ownerDecision).toContain('オーナーが 11/5 に決めたこと')
    expect(byId.get('wc-2')!.check!.join('\n')).toContain('消えた授業の記録がありません')
    // 確認中の版へ項目を足すだけなので版は据え置く(上げるとテスト教室の書きかけの下書きが消える・CLAUDE.md)。
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.689')
  })

  it('第75版(2026-10-25・v1.5.639): 休日設定した振替元の追従(Q40-2・決定記録 45)で tp-49 の確認を書き換えた(tp-48 は第83版で OK 済みとして外した)', () => {
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    // 旧「休日なら未消化に 1 件だけ」はオーナー承認で撤回(休みにする前と同じ)。第76版(決定記録 48): 満席は未消化ではなく同じ机の下段(保留)へ。
    // 第97版(2026-11-01・決定記録 51): tp-49 はテスト教室 OK で外し、満席の形(上の行＝テンプレの振替／下の行＝手入力)の tp-68 に置き換えた。
    expect(byId.has('tp-49')).toBe(false)
    // 第110版(2026-11-05・第 2 版): 満席の押し出し(tp-68)と丸ごと振替の追従(tp-51)は形そのものが無くなった(付け替え方式 v2-4)ので外した。
    for (const id of ['tp-68', 'tp-51']) { expect(byId.has(id), id).toBe(false); expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, id).not.toContain(id) }
  })

  it('第84版(2026-10-27・v1.5.653・受付 20261027-144006023-5e34fa4b): OK の 7 件を外し、tp-51・sc-2・tp-64 を書き換え、tp-65(テスト教室にも)・hd-1(開発用教室だけ)を足して版を上げる', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    for (const okId of ['sc-1', 'sc-3', 'tx-1', 'tp-61', 'tp-48', 'tp-62', 'tp-63']) expect(ids, okId).not.toContain(okId)
    for (const okId of ['sc-1', 'sc-3', 'tx-1', 'tp-61', 'tp-48', 'tp-62', 'tp-63']) expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, okId).not.toContain(okId)
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    // tp-51 要改善(同じコマ内の科目変更で移した先の生徒が消える)→ 同じ机・同じ席で科目が入れ替わる確認へ → 第110版で外した(第 2 版 v2-4)。
    expect(byId.has('tp-51')).toBe(false)
    // sc-2: 机の途中で「…」切れ → 入りきらない机は「他N件」。
    // tp-65: 丸ごと振替で移した先の席のメモを残す(テスト教室にも出す)。
    // 第109版(2026-11-05): tp-65 は OK(受付 20261104-230323681-65226940)で外した。
    expect(byId.has('tp-65')).toBe(false)
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('tp-65')
    // hd-1(休日には生徒を置けない・開発用教室だけ)は 2026-10-30 にオーナー OK → 外した(第93版)。
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('hd-1')
  })


  // 第88〜89版の ab-1〜ab-4(自動バックアップの教室別化)・第82/83/84版の ed-1・ed-2・hd-1 は 2026-10-30 に OK → 外した(第92〜93版)。
  it('第86版(2026-10-28・v1.5.653 据え置き): 分割保存の確認 sp-1(段階 A)・sp-2 / sp-3(段階 B・受付 20261028-032942134-2f5ab955)は OK で外した', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    for (const okId of ['sp-1', 'sp-2', 'sp-3']) expect(ids, okId).not.toContain(okId)
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.689')
  })

  // 第80版の sc-2(操作痕跡の上限)は 2026-10-30 に Claude が丸ごと振替の記録を読んで OK → 外した(第91版)。
  it('第78版(2026-10-26・v1.5.644)→ 第84版(2026-10-27・オーナー確定「講師と生徒を別々に採用」): tp-64 を講師と生徒の別々の採用の確認へ書き換え、テスト教室にも出す', () => {
    const item = VERIFICATION_CHECKLIST.items.find((entry) => entry.id === 'tp-64')!
    expect(item).toBeDefined()
    expect(item.introducedIn).toBe('v1.5.653')
    expect(item.area).toBe('テンプレ作成')
    expect(item.title).toContain('生徒と講師を別々に採用できる')
    // 第109版(2026-11-05・フリーメモ 20261105-052334430): メニューの文言を「上段(テンプレ)／下段(手入力)」に揃えた。
    expect(item.steps.join('\n')).toContain('「上段(テンプレ)の講師を採用する」')
    expect(item.steps.join('\n')).toContain('「下段(手入力)の講師を採用する」')
    expect(item.steps.join('\n')).not.toContain('「手入力データを採用」')
    expect(item.check?.join('\n')).toContain('「よろしいですか？」が出ず')
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).toContain('tp-64')
  })

  it('第77版(2026-10-26・v1.5.643・決定記録 46): 時限を変えたときの追従は OK 済み → 第110版で tp-51 ごと外した(第 2 版では付け替え v2-4)', () => {
    expect(VERIFICATION_CHECKLIST.items.find((entry) => entry.id === 'tp-51')).toBeUndefined()
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('tp-51')
  })

  it('第76版(2026-10-25・v1.5.641・決定記録 48): 押し出された授業を保留(下段・緑)で残す。tp-49 を「満席なら下段へ」に書き換えた(tp-62・tp-63 は第83版で OK 済みとして外した)', () => {
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    // 第97版(2026-11-01・決定記録 51): tp-49 はテスト教室 OK で外し、満席の形は tp-68(上の行＝テンプレの振替／下の行＝手入力)へ。
    expect(byId.has('tp-49')).toBe(false)
    // 第110版: tp-68 も外した(第 2 版では押し出しが無い)。
    expect(byId.has('tp-68')).toBe(false)
  })

  it('第73版(2026-10-24・v1.5.635 据え置き): 結果待ちの項目は理由を「詳細」で読む書き方(tp-61 は第83版で OK 済みとして外した)', () => {
    // 確認の画面の本文は 1 行になったので、結果待ちの項目が「確認の画面に「…」が出る」と案内していない(理由は「詳細」の中)。
    for (const entry of VERIFICATION_CHECKLIST.items) {
      for (const line of [...entry.steps, ...(entry.check ?? [])]) expect(line, entry.id).not.toContain('確認の画面に「')
    }
  })

  it('第72版(2026-10-24・v1.5.635 据え置き): 受付 20261024-062027562-37618588 で OK の 12 件と、確認不要とされた AI 回答の 23 問 qa-q01〜qa-q23 を外す', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    for (const okId of ['qa-ai-5', 'qa-ai-6', 'qa-ai-7', 'tb-1', 'q-1', 'q-2', 'q-3', 'q-4', 'q-5', 'q-6', 'tp-15', 'q-7']) expect(ids, okId).not.toContain(okId)
    // その他欄「質問への AI 自動回答(20 問)は確認リストからの確認は不要」: 23 問は評価ワークフロー(functions/src/questionAiEvalCases.ts)だけが持つ。
    expect(ids.filter((id) => id.startsWith('qa-'))).toEqual([])
    expect(VERIFICATION_CHECKLIST.items.filter((item) => item.area.startsWith('質問への AI 自動回答'))).toEqual([])
    // 残りはテスト教室の結果待ちだけ(開発用教室にも同じものが出る)。
    // 第88版(2026-10-29): ab-1/ab-2(自動バックアップの教室別化・開発用教室だけ)を足した。
    // 第93版(2026-10-30): 開発用教室だけの項目(ed-1・ed-2・hd-1)も OK → 残りはテスト教室にも出す項目だけ。
    // 第94版(2026-10-30): 開発ダッシュボードの確認 d-5 だけは開発用教室だけ。第95版(同日): AI 回答の全教室展開の確認 ai-1 も開発用教室だけ。
    // vc-1(2026-11-03・項目ごとの送信と両教室の送信済み表示)も開発用教室だけ。
    // 第98版(2026-11-03): 講習の日程公開の確認 lp-1〜lp-4 も開発用教室だけ(保護者QRは開発用教室と staging だけの機能)。
    // 第104版(2026-11-03): d-5・ai-1 を外し、開発用教室だけの d-6・d-7・sc-4・bk-1 を足した。
    // 第105版(2026-11-03): vc-1・d-6・d-7・sc-4・bk-1 は OK で外し、開発用教室だけの qr-1・sc-5・fm-1・d-8・dv-1 を足した。
    // 第106版(2026-11-03): qr-1・sc-5・fm-1・d-8・dv-1・tb-2 も OK で外した(残る開発用教室だけの項目は qs-2・lp-6)。
    // 第107版(2026-11-03): qs-2・lp-6 は OK で外した。保護者QRの黄色い枠の確認 pq-1 と講師専用の講習の確認 to-1・to-2 は開発用教室だけ。
    // 第108版(2026-11-03): pq-1・to-1・to-2 は OK で外した。保護者用QRの名刺サイズ印刷の確認 pc-1 は開発用教室だけ。
    // 第109版(2026-11-05): pc-1 は OK(受付 20261104-225226706-9e21e4df)で外した。残りはテンプレ関係だけ(テスト教室にも出す)。
    // 第111版(2026-11-05): 退塾取消の確認 wc-1・wc-2 は開発用教室だけ(テスト教室には出さない)。
    const developmentOnly: string[] = ['wc-1', 'wc-2']
    for (const id of ids.filter((id) => !developmentOnly.includes(id) && !id.startsWith('lp-') && !id.startsWith('qs-'))) expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, id).toContain(id)
    // 外しただけなので版は据え置き(上げるとテスト教室の書きかけの下書きが消える・第14版の決まり)。
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.689')
  })

  it('第55版(v1.5.604・2026-10-15): 受付 20261015-151056959-a8890098 で OK だった c-5・tp-47・tp-53・tp-54 を外し、結果待ちの q-1〜q-6・tp-15・tp-48〜51・tp-55〜57 を残す', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    // 第56版(2026-10-16): 虫眼鏡の絞り込み sr-1〜sr-3 を足した(版は据え置き)。第57版(同日): AI 自動回答の Claude API 切り替え qa-ai-1 を足した(版は据え置き)。第58版(同日): AI 回答の確認用の質問 20 問 qa-q01〜qa-q20 を足した(版は据え置き)。第59版(同日夜): Sonnet・他責の言い回し禁止・説明書拡充の確認 qa-ai-2 を足した(版は据え置き)。第60版(同日夜): 妥協案 B・二重回答の確認 qa-ai-3・qa-q21〜23 を足した(版は据え置き)。第61版(同日夜): Haiku 確定・すぐ表示＋メール・訂正回答の qa-ai-3(書き換え)・qa-ai-4 を足した(版は据え置き)。第61版(同日夜): Haiku 確定・すぐ表示＋メール・訂正回答の qa-ai-3(書き換え)・qa-ai-4 を足した(版は据え置き)。
    // 第63版(2026-10-21・v1.5.622): テスト教室の結果(受付 20261020-092527755-56bbf675)で OK の tp-55 を外し、生徒ごとの理由 tp-58 を足した。
    // 第66版(2026-10-22・v1.5.629): 第64版の結果(受付 20261022-125601189-6663f16f / 20261022-154814822-97abc250)で OK の 14 件を外し、
    // メモへの対応の確認 qa-ai-5〜qa-ai-7・tb-1 を先頭に足した。
    // 第72版(2026-10-24): OK の 12 件と AI 回答の 23 問を外し、テスト教室の結果待ちの 7 件だけが残る。
    // 第73版(2026-10-24): テンプレの文章を 1 行にした確認 tp-61 を先頭に足した(版は据え置き)。
    // 第74版(2026-10-25): 長文を 1〜2 行にした確認 tx-1 を先頭に足した(開発用教室だけ・版は据え置き)。
    // 第79版(2026-10-27): 保存の圧縮を変えた確認 sc-1 を先頭に足した(開発用教室だけ・版は据え置き)。
    // 第80版(2026-10-27): 操作痕跡の上限を広げた確認 sc-2 を sc-1 の後に足した(開発用教室だけ・版は据え置き)。
    // 第81版(2026-10-27): 保存できなかった内容を開発者へ送る確認 sc-3 を sc-2 の後に足した(開発用教室だけ・版は据え置き)。
    // 第82版(2026-10-27): 編集で振替にしたコマが未消化を減らさない確認 ed-1 を先頭に足した(開発用教室だけ・版は据え置き)。
    // 第83版(2026-10-27): 分割保存の段階 A(読める版)の確認 sp-1 を sc-3 の後に足した(開発用教室だけ・版は据え置き)。
    // 第83版(2026-10-27): 編集で振替にした通常授業を消しても戻らない確認 ed-2 を先頭に足した(開発用教室だけ・版は据え置き)。
    // 第84版(2026-10-27): 受付 20261027-144006023-5e34fa4b で OK の 7 件を外し、hd-1 を ed-1 の後・tp-65 を tp-64 の後に足した。
    // 第85版(2026-10-28): 分割保存の段階 A の sp-1 をオーナー確認 OK で外し、段階 B の sp-2・sp-3 を同じ場所に足した(版は据え置き)。
    // 第86版(2026-10-28): sp-2・sp-3 も OK(受付 20261028-032942134-2f5ab955)で外した(版は据え置き)。
    // 第87版(2026-10-29): 質問・要望を別タブで開く確認 rp-4 を先頭に足した(開発用教室だけ・版は据え置き)。
    // 第88版(2026-10-29・v1.5.653 据え置き): 自動バックアップの教室別化の確認 ab-1(開発者の全体復元)・ab-2(自教室復元)を足した(開発用教室だけ)。
    // 第89版(2026-10-30・v1.5.663): 切り替え後の確認 ab-3・ab-4 を足した。
    // 第90版(2026-10-30): rp-4 は OK(受付 20261029-232853166-07156d5a)で外した。
    // 第91版(2026-10-30): sc-2 は丸ごと振替の記録を Claude が読んで OK → 外した。第92版(同日): ab-1〜ab-4 も OK → 外した。
    // 第93版(2026-10-30): ed-1・ed-2・hd-1 も OK → 外した(版を v1.5.667 へ)。
    // 第94版(2026-10-30・v1.5.667 据え置き): 開発ダッシュボードの作り直しの確認 d-5 を先頭に足した(開発用教室だけ)。
    // 第95版(2026-10-30・v1.5.667 据え置き): 質問への AI 即時回答の全教室展開の確認 ai-1 を先頭に足した(開発用教室だけ)。
    // 第96版(2026-11-01・v1.5.670): テスト教室の tp-59/tp-64「手置き講師が抹消される」のオーナー確認 tp-66 と、テンプレ保存後の「元に戻す」の tp-67 を足した。
    // 第98版(2026-11-03・v1.5.672 据え置き): 講習の日程公開の確認 lp-1〜lp-4 を先頭に足した(開発用教室だけ)。
    // 第104版(2026-11-03・v1.5.672 据え置き): ai-1 は OK・d-5 は要改善への対応の d-6・d-7 へ差し替え、sc-4・bk-1 を足した。
    // 第101版(2026-11-03): 提出用QRの書き直しを部分更新にした確認 qs-1 を先頭に足した(開発用教室だけ)。
    // 第102版(2026-11-03): 室長の「登録」「登録解除」も部分更新にした確認 qs-2 を先頭に足した(開発用教室だけ)。
    // 第105版(2026-11-03): 11/3 午後の送信を受けて OK の 8 件を外し、qs-2 を書き換え、qs-3・qr-1・lp-5・sc-5・fm-1・d-8・dv-1 を足した(lp-3 はオーナー判断待ちで残す)。
    // 第106版(2026-11-03): 11/3 夜の送信で OK の 11 件を外し、qs-2 を書き換え(iOS Safari)、lp-6(講習の休みの説明)を足した。
    // 第107版(2026-11-03): qs-2・lp-6・jd-3・jd-4 は OK、tp-74 はオーナー指示(休日には置けないので確認不要)で外し、pq-1 を先頭に足した。
    // 同じ第107版で、講師専用の講習の確認 to-1・to-2 を pq-1 の後に足した(開発用教室だけ・v1.5.685)。
    // 第108版(2026-11-03): pq-1・to-1・to-2 は OK で外し、pc-1(保護者用QRの名刺サイズ印刷)を先頭に足した。
    // 第109版(2026-11-05・v1.5.689): OK の pc-1・tp-65・tp-67・jd-1・jd-2・tp-57・tp-58 を外し、tp-71/72/73/75/59/70 を 11/5 の決定で書き換え、mn-1 を足した。
    // 同じ第109版(2026-11-05 午後・第 2 版 spec-template-conflict-v2): tp-75・tp-59 を「手入力が勝つ」へ書き換え、出自の印（青字・並び替え）の v2-1 を足した。
    // 同じ第109版(2026-11-05 午後・第 2 版 段 3): 講師の休み(講師欄の「休み」・休みが勝つ)の v2-2 を足した(版は据え置き)。
    // 同じ第109版(2026-11-05 夜・第 2 版 監査の追補 §9-14・§9-15): 下の行だけの手入力を上げる・手置き講師がテンプレの別の机にも居る机の v2-3 を足した(版は据え置き)。
    // 同じ第109版(2026-11-05 夜・第 2 版 段 4): 丸ごと振替の付け替え(同じ曜日だけ・テンプレに追従・解除)の v2-4 を足した(版は据え置き・テスト教室にも出す)。
    // 同じ第110版(2026-11-05 夜・段 4 の監査後の決定 §9-20・§9-21): 解除で移した手入力が元の日へ戻る・振替先に同じ生徒の手入力なら振替元は休みの v2-6 を足した(版は据え置き)。
    // 第111版(2026-11-05・v1.5.689 据え置き): 退塾取消の確認 wc-1・wc-2 を先頭に足した(開発用教室だけ)。
    expect(ids).toEqual(['wc-1', 'wc-2', 'tp-64', 'tp-66', 'tp-71', 'tp-72', 'tp-75', 'tp-59', 'tp-69', 'tp-70', 'mn-1', 'v2-1', 'v2-2', 'v2-3', 'v2-4', 'v2-5', 'v2-6'])
    // 第64版の結果(2026-10-22)で OK → 外す(sv-1 は開発者側の読み取り確認も合格)。
    for (const okId of ['c-7', 'rp-1', 'rp-2', 'rp-3', 'sv-1', 'sv-2', 'bs-1', 'sr-1', 'sr-2', 'sr-3', 'qa-ai-1', 'qa-ai-2', 'qa-ai-3', 'qa-ai-4']) expect(ids, okId).not.toContain(okId)
    for (const okId of ['tp-55']) expect(ids, okId).not.toContain(okId)
    // 第69版(2026-10-23): テスト教室の結果(受付 20261022-094354322-14472254)で OK の tp-50・tp-56 を外す(要改善の tp-48/49/51 は調査待ちで残す)。
    for (const okId of ['tp-50', 'tp-56']) expect(ids, okId).not.toContain(okId)
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
    // 第63版(2026-10-21): OK 済み tp-55 を外し tp-48/51/57 の文面を直したので次にデプロイされる版 v1.5.622 へ上げる(tp-48/tp-51 は再確認が要る)。
    // 第64版(2026-10-22): 並べ替えで生徒2→生徒1へ寄せた席が再マージで戻らない bs-1 を足し、次にデプロイされる版 v1.5.625 へ上げる。
    // 第65版(2026-10-22): 講師だけのテンプレ机の理由の文言(tp-59 の確認を書き換え)で、次にデプロイされる版 v1.5.627 へ上げる。
        // 第66版(2026-10-22): OK 済み 14 件を外し qa-ai-5〜7・tb-1 を足したので次にデプロイされる版 v1.5.629 へ上げる。
    // 第67版(2026-10-23): 講師だけのテンプレ机で手置き講師を残しテンプレの講師を空き机へずらす(Q41-13)で tp-59 を書き換え、v1.5.630 へ上げる。
    // 第68版(2026-10-23): ずらして置いた講師の講師欄を緑にする(保留ではない)を tp-59 に足し、v1.5.631 へ上げる。
    // 第70版(2026-10-23): 休み連絡の締切(前日の夜 0時00分・spec-parent-portal.md §0-7)の確認 q-7 を足したので v1.5.634 へ上げる。
    // 第71版(2026-10-23): 当日の行は押せるまま電話案内を大きく出す形に q-7 を書き換えたので v1.5.635 へ上げる。
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.689')
    // 第69版(2026-10-23): テスト教室の結果で OK の tp-50・tp-56 を外し、テスト担当の形を tp-60 に分けたので v1.5.633 へ上げる。
    // 第98版(2026-11-01・決定記録 52): ずらし(tp-60)は廃止 → tp-70(講師ごと緑 2 段)へ。
    expect(byIdOf(VERIFICATION_CHECKLIST.items).has('tp-60')).toBe(false)
    // 第109版(2026-11-05): tp-70 は「生徒は席に残し講師だけ緑」(オーナー決定 2026-11-05)へ書き換え。ずらしは出ない(文面からも外した)。
    expect((byIdOf(VERIFICATION_CHECKLIST.items).get('tp-70')?.check ?? []).some((line) => line.includes('手で置いた生徒は席に 1 行のまま'))).toBe(true)
    expect((byIdOf(VERIFICATION_CHECKLIST.items).get('tp-70')?.check ?? []).join('\n')).not.toContain('ずらす')
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    // 第54版(2026-10-15): 基本仕様の確認 tp-55〜57 は v1.5.602 で追加 → 第109版(2026-11-05): tp-57 は OK(受付 20261105-050513537-81cacbd0)で外した。
    expect(byId.has('tp-57')).toBe(false)
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('tp-57')
    // 第98版(2026-11-01・決定記録 52): 手置き講師の衝突は常に緑 2 段(tp-59・tp-69・tp-70)。
    // 第109版(2026-11-05・オーナー決定): tp-70 は生徒を席に残して講師だけ緑、tp-59 は別の机に同じ講師が入る形(講師の保留)へ書き換え。
    expect(byId.get('tp-69')!.introducedIn).toBe('v1.5.670')
    expect(byId.get('tp-70')!.introducedIn).toBe('v1.5.689')
    for (const id of ['tp-69', 'tp-70']) expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, id).toContain(id)
    expect(byId.get('tp-69')!.check!.join(' / ')).toContain('上の行のテンプレの講師は消え')
    expect(byId.get('tp-59')!.introducedIn).toBe('v1.5.689')
    expect(byId.get('tp-59')!.title).toContain('X が 2 つの机に出ない')
    // 第 2 版(2026-11-05 午後・§9-1): 手入力が勝つ＝テンプレの机 B に X を置かない(午前の「講師の保留」は取り消し)。
    expect(byId.get('tp-59')!.check!.join(' / ')).toContain('机 B はテンプレの生徒だけ入り、講師欄は空')
    expect(byId.get('tp-59')!.check!.join(' / ')).not.toContain('講師欄だけ上が空白・下が X の緑')
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).toContain('tp-59')
    // #75 の段 2(tp-48〜51): テスト教室で tp-48/tp-51 が要改善(2026-10-20)→ 修正して再確認。導入版は据え置き。
    // 第97版(2026-11-01): tp-49 は OK で外した(tp-68 へ)。第110版(第 2 版): tp-51・tp-68 も外した(付け替え v2-4)。
    expect(byId.has('tp-51')).toBe(false)
    // 第63版: 確認の画面の生徒ごとの理由(tp-58)→ 第109版(2026-11-05): OK(受付 20261105-052350338-ca5865e0)で外した。
    expect(byId.has('tp-58')).toBe(false)
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('tp-58')
    // 生徒名はソースに載せない(スナップショットの実名は「姓 + 全角スペース + 名」の形)。第43版(2026-10-10 オーナー指示「開発用教室は名前を見ていい」):
    // 代わりに {{student:<生徒ID>}} を書き、画面が開いている教室の生徒データから名前を差し込む。
    for (const item of VERIFICATION_CHECKLIST.items) {
      for (const line of [item.title, item.prep ?? '', ...item.steps, ...(item.check ?? [])]) expect(line, item.id).not.toMatch(/[一-龠ぁ-んァ-ヶ]+\u3000[一-龠ぁ-んァ-ヶ]+/u)
    }
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
    expect(verificationChecklistStorageKey('v8OZ7zH8vONNHjjYVcR1')).toBe('verification-checklist:v8OZ7zH8vONNHjjYVcR1:v1.5.689')
    expect(verificationChecklistStorageKey(null)).toBe('verification-checklist:unknown:v1.5.689')
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
    expect(buildVerificationChecklistMarker()).toBe('[確認リスト v1.5.689]')
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
    expect(selectVerificationChecklistItems('sandbox').map((item) => item.id)).toEqual(['tp-64', 'tp-66', 'tp-71', 'tp-72', 'tp-75', 'tp-59', 'tp-69', 'tp-70', 'mn-1', 'v2-1', 'v2-2', 'v2-3', 'v2-4', 'v2-5', 'v2-6'])
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

describe('第105版・第106版(2026-11-03・v1.5.672 据え置き): 11/3 午後・夜の送信を受けた項目', () => {
  const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))

  it('OK の項目を外した(残っていた qs-2・lp-6 も第107版で OK になり外した)', () => {
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    // 第105版で外した 8 件(＋それ以前の ai-1・d-5)と、第106版(受付 20261103-133733125〜20261103-141213137)で外した 11 件。
    for (const okId of ['qs-1', 'lp-1', 'lp-2', 'vc-1', 'd-6', 'd-7', 'sc-4', 'bk-1', 'ai-1', 'd-5']) expect(ids, okId).not.toContain(okId)
    for (const okId of ['qs-3', 'qr-1', 'lp-5', 'sc-5', 'fm-1', 'd-8', 'dv-1', 'qs-4', 'tb-2', 'lp-3', 'lp-4']) expect(ids, okId).not.toContain(okId)
    for (const okId of ['qs-2', 'lp-6']) expect(byId.has(okId), okId).toBe(false)
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.689')
  })

  it('qs-2 の書き換えと lp-6 の説明は第107版の送信で OK になった(項目は外した)', () => {
    expect(byId.has('qs-2')).toBe(false)
    expect(byId.has('lp-6')).toBe(false)
  })
})

describe('第96版(2026-11-01・v1.5.670): テスト教室 受付 20261101-015631116-44e2c036 を受けた項目', () => {
  const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))

  it('tp-58: 満席で手で置いた生徒が居るときの理由行 → 第109版で OK として外し、第110版(第 2 版)で押し出しそのものが無くなった(tp-73 も外した)', () => {
    expect(byId.has('tp-58')).toBe(false)
    expect(byId.has('tp-73')).toBe(false)
  })

  it('tp-66: 講師つきの保留の見え方をオーナーが見直す(保存データには講師の下の行が作られていた)', () => {
    const item = byId.get('tp-66')!
    expect(item.introducedIn).toBe('v1.5.670')
    expect(item.title).toContain('【オーナー確認】')
    expect(item.check?.join('\n')).toContain('講師欄が上下 2 段')
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).toContain('tp-66')
  })

  // 第109版(2026-11-05・オーナー決定「同じ日の中で手で動かした通常授業は手入力データとして残さない」): 決定記録 53 を取り消し、
  // 写しはテンプレどおりの位置へ戻す(緑も「※」の帯も出ない)。例外は出席・休みの記録がある日と、戻せない写しだけ。
  it('tp-71 / tp-72: 同日移動の写しはテンプレどおりに戻る(2026-11-05・決定記録 53 の取り消し)', () => {
    expect(byId.get('tp-71')!.check?.join('\n')).not.toContain('※4限にも')
    expect(byId.get('tp-71')!.check?.join('\n')).toContain('緑の机や「※」の帯は出ない')
    // 第 2 版(2026-11-05 午後・§6 Q36 の H-1 は廃止): 休みの記録があっても動かした授業はテンプレの位置へ戻る。
    expect(byId.get('tp-71')!.check?.join('\n')).not.toContain('出席・休みの記録を付けていた授業だけは動かした先に残り')
    expect(byId.get('tp-71')!.check?.join('\n')).toContain('休みの記録があっても、動かした授業はテンプレの位置へ戻る')
    expect(byId.get('tp-72')!.check?.join('\n')).toContain('A はテンプレの元の机に戻る')
    for (const id of ['tp-71', 'tp-72']) {
      expect(byId.get(id)!.introducedIn, id).toBe('v1.5.689')
      expect(byId.get(id)!.ownerDecision, id).toContain('オーナーが 11/5 に決めたこと')
      expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, id).toContain(id)
    }
  })

  it('tp-67: テンプレ保存のあとの「元に戻す」は第109版で OK(受付 20261104-230716260-18548acb)として外した', () => {
    expect(byId.has('tp-67')).toBe(false)
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('tp-67')
  })
})

describe('第100版(2026-11-01・v1.5.671): オーナーの決定の明記・判断項目 jd-1〜jd-4', () => {
  const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))

  it('オーナーが 11/1 に新たに決めた挙動の項目には ownerDecision が付く(テスト担当が判断の出所を分かるように)', () => {
    for (const id of ['tp-69']) expect(byId.get(id)!.ownerDecision, id).toContain('オーナーが 11/1 に決めたこと')
    // 第109版(2026-11-05): 11/5 に決め直した項目は「オーナーが 11/5 に決めたこと」。第110版: tp-68・tp-73 は外した。
    for (const id of ['tp-70', 'tp-71', 'tp-72', 'tp-59', 'v2-1', 'v2-2', 'v2-3', 'v2-4', 'v2-5', 'v2-6']) expect(byId.get(id)!.ownerDecision, id).toContain('オーナーが 11/5 に決めたこと')
  })

  // 第107版(2026-11-03): jd-3・jd-4 はオーナーが OK(今のまま)で外した。残る jd-1・jd-2 は結果待ち。
  // 第109版(2026-11-05): jd-1(メモ「出席記録も手入力扱いで緑・上が空けば自動採用」=今の動き)・jd-2 もオーナー OK で外した。
  it('判断項目 jd-1〜jd-4 は全部オーナーが判断して外した', () => {
    for (const okId of ['jd-1', 'jd-2', 'jd-3', 'jd-4']) {
      expect(byId.has(okId), okId).toBe(false)
      expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, okId).not.toContain(okId)
    }
  })

  // 第107版(2026-11-03): tp-74(休日解除で手で置いた生徒を下の行へ)は、オーナー指示「そもそも休みの日には置けないようにして。この確認は不要」で外した
  // (休日のコマへ生徒を置く操作は v1.5.653 の closedDayPlacementGuard で止めている)。
  it('tp-73: 時限変更の追従の押し出し(決定記録 58)。tp-74 は外した', () => {
    // 第109版(2026-11-05・オーナー回答「通常とはテンプレ由来のもの」): 手動追加の振替も押し出す → 第110版(第 2 版)で押し出しそのものが無くなり tp-73 を外した。
    expect(byId.has('tp-73')).toBe(false)
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('tp-73')
    expect(byId.has('tp-74')).toBe(false)
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('tp-74')
  })

  // 第 2 版(2026-11-05 午後・spec-template-conflict-v2 §2-2): 決定記録 57(テンプレ机が上の行・手入力が下の行)は取り消し。手入力が勝つ＝テンプレのその生徒は置かない。
  it('tp-75: 同じコマの別の机に手で置いた生徒が居れば、テンプレの机には置かない(手入力が勝つ・第 2 版 §2-2)', () => {
    expect(byId.get('tp-75')!.check?.join('\n')).not.toContain('上の行が空白のまま緑 2 段')
    expect(byId.get('tp-75')!.check?.join('\n')).toContain('同じコマに手入力の同じ生徒が先にあるため、テンプレのこの授業は置きません')
    expect(byId.get('tp-75')!.ownerDecision).toContain('オーナーが 11/5 に決めたこと(第 2 版')
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).toContain('tp-75')
  })

  it('ownerDecision も内輪の言葉を使わない', () => {
    const jargon = /盤面|四択|モーダル|確認文|実機|突き合わせ|上段|下段/u
    for (const item of VERIFICATION_CHECKLIST.items) {
      if (!item.ownerDecision) continue
      const outsideQuotes = item.ownerDecision.replace(/「[^「」]*(?:「[^「」]*」[^「」]*)*」/gu, '')
      expect(outsideQuotes, item.id).not.toMatch(jargon)
    }
  })
})

describe('第103版(2026-11-02・v1.5.672・決定記録 62): 「手入力データを採用」で通常授業を外したら単発削除と同じく予定数 −1', () => {
  const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
  it('tp-75 の OK の目安に予定数 −1(§4-2 規則 1)と 2 回目の保存で減らないこと(INV-03)が書かれている(tp-74 は第107版で外した)', () => {
    for (const id of ['tp-75']) {
      expect(byId.get(id)!.check?.join('\n'), id).toContain('予定数は 1 減')
      expect(byId.get(id)!.check?.join('\n'), id).not.toContain('希望回数は減らない')
      expect(byId.get(id)!.check?.join('\n'), id).toContain('予定数がさらに減らない')
    }
  })
})

// 2026-11-03 オーナー指示「送信をまとめてではなく一件ごとに」。
describe('項目ごとの送信', () => {
  const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')}`

  it('1 項目だけの本文(先頭マーカー＋結果行 1 行)。未確認・一覧に無い項目は null', () => {
    const draft = draftWith([['c-1', 'ok'], ['p-2', 'needs-fix', '行が高い\n文字も大きい']], 'その他メモ')
    const marker = buildVerificationChecklistMarker()
    expect(buildVerificationChecklistItemReportNote(draft, 'c-1', { items: FIXTURE_ITEMS })).toBe(`${marker}\n- c-1 OK`)
    // 他の項目・フリーメモは載せない。
    expect(buildVerificationChecklistItemReportNote(draft, 'p-2', { items: FIXTURE_ITEMS })).toBe(`${marker}\n- p-2 要改善: 行が高い / 文字も大きい`)
    expect(buildVerificationChecklistItemReportNote(draft, 'p-3', { items: FIXTURE_ITEMS })).toBeNull()
    expect(buildVerificationChecklistItemReportNote(draft, 'zz-9', { items: FIXTURE_ITEMS })).toBeNull()
  })

  it('長いメモでも必ず 1 通(分割しない・末尾を … で切る)', () => {
    const draft = draftWith([['c-1', 'needs-fix', 'あ'.repeat(5000)]])
    const note = buildVerificationChecklistItemReportNote(draft, 'c-1', { items: FIXTURE_ITEMS })!
    expect(note.length).toBeLessThanOrEqual(DEVELOPER_REPORT_NOTE_LIMIT)
    expect(note.startsWith(`${buildVerificationChecklistMarker()}\n- c-1 要改善: `)).toBe(true)
    expect(note.endsWith('…')).toBe(true)
    expect(note).not.toMatch(/\(\d+\/\d+\)/u)
  })

  it('フリーメモだけの本文。空なら null', () => {
    expect(buildVerificationChecklistOtherNotesReportNote(draftWith([['c-1', 'ok']], '印刷が重い'))).toBe(`${buildVerificationChecklistMarker()}\n- その他: 印刷が重い`)
    expect(buildVerificationChecklistOtherNotesReportNote(draftWith([['c-1', 'ok']], '  '))).toBeNull()
  })

  it('送信状態: 未確認→未送信→送信済み→(変えたら)変更あり。送ったらその項目の画像は下書きから外れる', () => {
    let draft = createEmptyVerificationChecklistDraft()
    expect(resolveVerificationChecklistItemSendState(draft, 'c-1')).toBe('unchecked')
    draft = setVerificationChecklistEntry(draft, 'c-1', { status: 'needs-fix', memo: '直して' })
    const added = addVerificationChecklistAttachment(draft, { itemId: 'c-1', name: 'a.png', dataUrl: PNG }, 'img-1')
    const other = addVerificationChecklistAttachment(added.draft, { itemId: 'p-2', name: 'b.png', dataUrl: PNG }, 'img-2')
    draft = other.draft
    expect(resolveVerificationChecklistItemSendState(draft, 'c-1')).toBe('unsent')
    expect(buildVerificationChecklistItemReportAttachments(draft, 'c-1').map((attachment) => attachment.label)).toEqual(['c-1'])

    draft = markVerificationChecklistItemSent(draft, 'c-1', { reportId: 'r-1', sentAt: '2026-11-03T00:00:00.000Z', attachmentCount: 1 })
    expect(resolveVerificationChecklistItemSendState(draft, 'c-1')).toBe('sent')
    expect(draft.sent['c-1']).toEqual({ status: 'needs-fix', memo: '直して', attachmentCount: 1, sentAt: '2026-11-03T00:00:00.000Z', reportId: 'r-1' })
    expect(draft.attachments.map((attachment) => attachment.itemId)).toEqual(['p-2'])
    expect(countVerificationChecklistProgress(draft, FIXTURE_ITEMS).unsent).toBe(1) // p-2 は画像で要改善になったまま未送信

    expect(resolveVerificationChecklistItemSendState(setVerificationChecklistMemo(draft, 'c-1', '直して(追記)'), 'c-1')).toBe('changed')
    expect(resolveVerificationChecklistItemSendState(setVerificationChecklistEntry(draft, 'c-1', { status: 'ok' }), 'c-1')).toBe('changed')
    const moreImage = addVerificationChecklistAttachment(draft, { itemId: 'c-1', name: 'c.png', dataUrl: PNG }, 'img-3').draft
    expect(resolveVerificationChecklistItemSendState(moreImage, 'c-1')).toBe('changed')
    // メモの改行や前後の空白だけの違いは変更扱いにしない(本文が同じになる)。
    expect(resolveVerificationChecklistItemSendState(setVerificationChecklistMemo(draft, 'c-1', ' 直して \n'), 'c-1')).toBe('sent')
  })

  it('送った記録は下書きの保存・読み戻しで残り、壊れた記録は捨てる', () => {
    const draft = markVerificationChecklistItemSent(draftWith([['c-1', 'ok']]), 'c-1', { reportId: 'r-1', sentAt: 'x', attachmentCount: 0 })
    expect(parseVerificationChecklistDraft(serializeVerificationChecklistDraft(draft)).sent).toEqual(draft.sent)
    const raw = JSON.stringify({ version: VERIFICATION_CHECKLIST.version, entries: {}, otherNotes: '', attachments: [], sent: { a: { status: 'unchecked' }, b: 'junk', c: { status: 'ok', memo: 1, attachmentCount: -3 } } })
    expect(parseVerificationChecklistDraft(raw).sent).toEqual({ c: { status: 'ok', memo: '', attachmentCount: 0, sentAt: '', reportId: '' } })
    // 送る前の旧形式(sent なし)の下書きも読める。
    expect(parseVerificationChecklistDraft(JSON.stringify({ version: VERIFICATION_CHECKLIST.version, entries: {} })).sent).toEqual({})
  })

  it('未確認の項目は送った記録を付けない', () => {
    const draft = createEmptyVerificationChecklistDraft()
    expect(markVerificationChecklistItemSent(draft, 'c-1', { reportId: 'r', sentAt: 'x', attachmentCount: 0 })).toBe(draft)
  })
})
// 2026-11-03 オーナー指示「(qs-2 を)対応したなら要改善の状態は外して、テキスト欄に前回のメモは残さなくていい。
// 上にある前回なにを送信したかの文章は残しても良い」。書き換えた項目(reworkedAt)の書き換え前の下書きを消す。
describe('書き換えた項目の下書きを消す(clearReworkedVerificationChecklistEntries)', () => {
  const item = (id: string, reworkedAt?: string) => ({ id, area: 'a', title: 't', steps: ['s'], introducedIn: 'v1.5.680', ...(reworkedAt ? { reworkedAt } : {}) })
  const sentDraft = (sentAt: string) => {
    let draft = setVerificationChecklistEntry(createEmptyVerificationChecklistDraft(), 'qs-2', { status: 'needs-fix', memo: '割当も解除して' })
    draft = markVerificationChecklistItemSent(draft, 'qs-2', { reportId: 'r1', sentAt, attachmentCount: 1 })
    return draft
  }

  it('書き換えより前に送った要改善とメモ・送った記録を消す(結果は未確認に戻る)', () => {
    const cleaned = clearReworkedVerificationChecklistEntries(sentDraft('2026-11-03T11:01:08.129Z'), [item('qs-2', '2026-11-03T11:40:00.000Z')])
    expect(getVerificationChecklistEntry(cleaned, 'qs-2')).toEqual({ status: 'unchecked', memo: '' })
    expect(cleaned.sent['qs-2']).toBeUndefined()
    expect(resolveVerificationChecklistItemSendState(cleaned, 'qs-2')).toBe('unchecked')
  })

  it('書き換え後に送り直した項目・書き換えていない項目は触らない(開き直しても消えない)', () => {
    const resent = sentDraft('2026-11-03T12:00:00.000Z')
    expect(clearReworkedVerificationChecklistEntries(resent, [item('qs-2', '2026-11-03T11:40:00.000Z')])).toBe(resent)
    const old = sentDraft('2026-11-03T11:01:08.129Z')
    expect(clearReworkedVerificationChecklistEntries(old, [item('qs-2')])).toBe(old)
  })

  it('まだ送っていない下書きは触らない', () => {
    const draft = setVerificationChecklistEntry(createEmptyVerificationChecklistDraft(), 'qs-2', { status: 'ok', memo: '' })
    expect(clearReworkedVerificationChecklistEntries(draft, [item('qs-2', '2026-11-03T11:40:00.000Z')])).toBe(draft)
  })

  it('正本で reworkedAt を付けた項目は、日時として読める(qs-2 は第107版で OK になり外した)', () => {
    for (const entry of VERIFICATION_CHECKLIST.items) {
      if (entry.reworkedAt) expect(Number.isNaN(Date.parse(entry.reworkedAt)), entry.id).toBe(false)
    }
    expect(VERIFICATION_CHECKLIST.items.some((entry) => entry.id === 'qs-2')).toBe(false)
  })

  it('パネルは開いたときに消してから出し、消したら保存し直す', () => {
    const panel = readFileSync(new URL('../components/developer-report/VerificationChecklistPanel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('const cleaned = clearReworkedVerificationChecklistEntries(loaded)')
    expect(panel).toContain('if (cleaned !== loaded) writeStorage(storageKey, serializeVerificationChecklistDraft(cleaned))')
  })
})

describe('第107版: 講師専用の特別講習(フリーメモ 20261103-105053536-c0f31680)', () => {
  it('講師専用のフリーメモは対応済み(to-1・to-2 は第108版で OK になり外した)', () => {
    expect(VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS).toContain('20261103-105053536-c0f31680')
    const ids = VERIFICATION_CHECKLIST.items.map((item) => item.id)
    expect(ids).not.toContain('to-1')
    expect(ids).not.toContain('to-2')
  })
})

describe('第107版(2026-11-03・v1.5.672 据え置き): 11/3 深夜の送信を受けた項目', () => {
  const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))

  it('OK の qs-2・lp-6・jd-3・jd-4 と、オーナーが不要とした tp-74 を外した', () => {
    for (const id of ['qs-2', 'lp-6', 'jd-3', 'jd-4', 'tp-74']) {
      expect(byId.has(id), id).toBe(false)
      expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS, id).not.toContain(id)
    }
  })

  it('保護者QRの黄色い枠のフリーメモは対応済み(pq-1 は第108版で OK になり外した)', () => {
    expect(byId.has('pq-1')).toBe(false)
    expect(VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS).toContain('20261103-142142896-15b7a2a8')
  })
})

describe('第108版(2026-11-03・v1.5.672 据え置き): 保護者用QRの名刺サイズ印刷', () => {
  const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))

  it('OK の pq-1・to-1・to-2 を外した', () => {
    for (const id of ['pq-1', 'to-1', 'to-2']) expect(byId.has(id), id).toBe(false)
  })

  it('pc-1 は第109版で OK(受付 20261104-225226706-9e21e4df)として外した。フリーメモ 2 件は対応済み', () => {
    expect(byId.has('pc-1')).toBe(false)
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).not.toContain('pc-1')
    expect(VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS).toContain('20261103-152520476-06446053')
    expect(VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS).toContain('20261103-152644666-20ccdda0')
    expect(VERIFICATION_CHECKLIST.version).toBe('v1.5.689')
  })
})

describe('第109版(2026-11-05・v1.5.689): 11/4 夜〜11/5 の送信(受付 20261104-225226706〜20261105-052350338)を受けた項目', () => {
  const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))

  it('OK の pc-1・tp-65・tp-67・jd-1・jd-2・tp-57・tp-58 を外した', () => {
    for (const id of ['pc-1', 'tp-65', 'tp-67', 'jd-1', 'jd-2', 'tp-57', 'tp-58']) expect(byId.has(id), id).toBe(false)
  })

  it('mn-1: 緑の机のメニューの文言とハイライト(フリーメモ 20261105-052334430-d93d690d)。残す項目のボタン名も新しい文言', () => {
    const item = byId.get('mn-1')!
    expect(item.introducedIn).toBe('v1.5.689')
    expect(item.check?.join('\n')).toContain('「上段(テンプレ)を採用する」「下段(手入力)を採用する」「下段(手入力)を移動する」「下段(手入力)を削除する」')
    expect(item.check?.join('\n')).toContain('上の行と下の行の両方に選択中の枠')
    expect(VERIFICATION_CHECKLIST_SANDBOX_ITEM_IDS).toContain('mn-1')
    for (const entry of VERIFICATION_CHECKLIST.items) {
      for (const line of [...entry.steps, ...(entry.check ?? [])]) {
        expect(line, entry.id).not.toContain('「手入力データを採用」')
        expect(line, entry.id).not.toContain('「テンプレ授業を採用」')
        expect(line, entry.id).not.toContain('「テンプレの講師を採用」')
        expect(line, entry.id).not.toContain('「手入力の講師を採用」')
      }
    }
    expect(VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS).toContain('20261105-052334430-d93d690d')
    // 「テンプレ保存で自動並び替えが悪さしている」はチャットで回答(保存は並び替えない)→ 対応済み。
    expect(VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS).toContain('20261105-051121999-f9830cf4')
  })

  it('tp-70: 講師だけのテンプレ机では手で置いた生徒を席に残し、講師だけ緑(オーナー決定 2026-11-05)', () => {
    const item = byId.get('tp-70')!
    expect(item.introducedIn).toBe('v1.5.689')
    expect(item.check?.join('\n')).toContain('手で置いた生徒は席に 1 行のまま')
    expect(item.check?.join('\n')).not.toContain('上の行の席は空')
  })
})
