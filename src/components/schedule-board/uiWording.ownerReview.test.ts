// 文言整理(オーナーレビュー 2026-10-10): 盤面・詳細パネル・出席モーダルなどの画面文言を固定する。
// 文言そのものが仕様なので、巻き戻り(旧「…不可です」「不利」等の復活)をソース文字列で検出する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildForcedConstraintScoreParts } from './ScheduleBoardScreen'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const BOARD = read('./ScheduleBoardScreen.tsx')

describe('盤面: 同コマ重複ブロックの語尾は「できません」(旧「不可です」)', () => {
  it('旧語尾が残っていない', () => {
    expect(BOARD).not.toMatch(/組まれているため[^`]*不可です/)
  })
  it.each([
    ['移動できません。'],
    ['入れ替えできません。'],
    ['振替できません。'],
    ['配置できません。'],
    ['追加できません。'],
  ])('「組まれているため%s」が使われている', (suffix) => {
    expect(BOARD).toContain(`が組まれているため${suffix}`)
  })
  it('テンプレ移動/テンプレ入れ替えも「移動できません/入れ替えできません」に統一(テンプレ接頭辞なし)', () => {
    expect(BOARD).not.toContain('テンプレ移動不可')
    expect(BOARD).not.toContain('テンプレ入れ替え不可')
  })
  it('画面中央表示の判定が新語尾に追随している(回帰防止: 旧語尾のままだと中央表示されない)', () => {
    expect(BOARD).toContain("statusMessage.includes('同コマにすでに') && statusMessage.includes('できません。')")
  })
})

describe('盤面: 案内文・確認ダイアログの言い回し', () => {
  it('既定ガイド・遠い週・出席不可コマ・未連携の文言', () => {
    expect(BOARD).toContain('生徒をクリックして選ぶか、空いたマスをクリックしてメモを書けます。')
    expect(BOARD).toContain('表示中の週から離れすぎているため移動できません（約${maxExtensionWeeks}週間まで）。表示週を近づけてからお試しください。')
    expect(BOARD).toContain('移動先は出席不可で提出されたコマです。「最新表示」で更新してから、確認画面で承認して移動してください。')
    expect(BOARD).toContain('は基本データの生徒と結び付いていないため、自動割振できません。')
    expect(BOARD).not.toContain('未連携のため、自動割振できません')
  })
  it('休日設定・丸ごと振替・授業削除・未消化削除の確認は全角「？」', () => {
    expect(BOARD).toContain('よろしいですか？`)')
    expect(BOARD).toContain("lines.push('よろしいですか？')")
    expect(BOARD).toContain('を休日に設定します。\\nこの日に入っている授業はすべてストックへ移行します。\\nよろしいですか？')
    expect(BOARD).toContain('のこの授業を削除します。\\n${confirmBody}\\nよろしいですか？')
    expect(BOARD).toContain('を削除します。よろしいですか？`)')
    expect(BOARD).not.toContain('の未消化講習 ${item.subject}${sessionLabel} を削除します。よろしいですか。')
    expect(BOARD).not.toContain('の未消化振替 ${item.subject} (${item.label}) を削除します。よろしいですか。')
  })
})

describe('自動割振の候補スコア内訳: 「不利」は「優先度低め」', () => {
  it('絶対事項の内訳', () => {
    const parts = buildForcedConstraintScoreParts({
      firstPeriodRuleApplied: true, firstPeriodPreferred: false,
      subjectCapableRuleApplied: true, subjectCapablePreferred: false,
      regularTeacherRuleApplied: false, regularTeacherPreferred: false,
    })
    const byLabel = Object.fromEntries(parts.map((p) => [p.label, p.detail]))
    expect(byLabel['指定時限回避']).toBe('指定時限のため優先度低め')
    expect(byLabel['科目対応講師']).toBe('科目対応外のため優先度低め')
    expect(byLabel['通常担当講師']).toBe('対象ルールなし')
  })
  it('盤面ソースに「不利」が残っておらず、隣接・相性・登校日集約も言い換え済み', () => {
    expect(BOARD).not.toContain('不利 /')
    expect(BOARD).not.toMatch(/(あり|ため|で)不利'/)
    expect(BOARD).toContain('隣接コマに同一科目があり優先度低め')
    expect(BOARD).toContain('相性制約で優先度低め')
    expect(BOARD).toContain('同じ登校日にまとまるため優先度低め')
  })
})

describe('DetailPanel / IssuesPanel / GroupAttendanceModal の文言', () => {
  const detail = read('./DetailPanel.tsx')
  const issues = read('./IssuesPanel.tsx')
  const group = read('./GroupAttendanceModal.tsx')
  it('DetailPanel: デバッグ用語を室長向けに・開発メモ調を削除', () => {
    expect(detail).not.toContain('デバッグコピー')
    expect(detail).not.toContain('報告テンプレートをコピー')
    expect(detail).not.toContain('問題報告を速くするために')
    expect(detail).not.toContain('使う想定です')
    expect(detail).toContain('この画面の内容をコピー')
    expect(detail).toContain('質問・要望に貼り付けられる形でコピーします。')
    expect(detail).toContain('質問・要望用にコピー')
    expect(detail).toContain('この机にはまだ授業が入っていません。</div>')
    // コピー動作自体は据え置き
    expect(detail).toContain('onClick={onCopyDebug}')
    expect(detail).toContain('onClick={onCopyIssueTemplate}')
  })
  it('IssuesPanel: 「最小版」を見出しに出さない', () => {
    expect(issues).not.toContain('最小版')
    expect(issues).not.toContain('通常残一覧画面')
    expect(issues).toContain('通常残 / 未解決一覧')
  })
  it('GroupAttendanceModal: 「デフォルト」を使わない', () => {
    expect(group).not.toContain('デフォルトは全員出席です')
    expect(group).toContain('はじめは全員出席です。欠席者だけクリックしてください。')
  })
})
