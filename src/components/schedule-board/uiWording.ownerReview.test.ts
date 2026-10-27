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
    expect(BOARD).toContain('${existing}よろしいですか？`')
    expect(BOARD).toContain('を休日にします（授業はすべてストックへ）。よろしいですか？')
    expect(BOARD).toContain('のこの授業を削除します（${confirmBody}）。よろしいですか？')
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

describe('テンプレの流れは 1 行（オーナー指示 2026-10-24「モーダルやナビバーの文章が長すぎる。1 行くらいに大事なことだけ」）', () => {
  it('編集開始・保留の席の案内・採用の確認・旧方式の上書き確認は 1 行の文言', () => {
    expect(BOARD).toContain("'テンプレ編集中（前回のテンプレを読み込みました）。'")
    expect(BOARD).toContain("setStatusMessage('保留の席です。残す方を選んでください。')")
    expect(BOARD).toContain('return `テンプレ授業を採用します。${dropped ? `下段の ${dropped} は外します。` : \'\'}よろしいですか？`')
    expect(BOARD).toContain('return `手入力データを採用します。${upperNames ? `テンプレ授業の ${upperNames} は取り下げます。` : \'\'}よろしいですか？`')
    // tp-64（2026-10-27）: 講師欄の 2 択の確認文も 1 行（講師だけを決める）。
    expect(read('./templatePendingResolution.ts')).toContain("if (choice === 'template') return `テンプレの講師 ${templateName} を採用します。手で置いた講師 ${manualName} はこの机から外れます。よろしいですか？`")
    expect(BOARD).toContain('以降をテンプレだけで作り直します。手入力・メモ・振替・講習は消えます。')
  })
  it('旧来の長い文が戻っていない', () => {
    expect(BOARD).not.toContain('通常授業テンプレート編集モードです。')
    expect(BOARD).not.toContain('の席のメニューを開きました。')
    expect(BOARD).not.toContain('手入力・メモ・振替・講習を含むすべてのデータが消去され')
    expect(BOARD).not.toContain('通常授業テンプレートを上書き保存しました。')
  })
})

describe('三行以上の長文を 1〜2 行に（オーナー指示 2026-10-25）', () => {
  const read2 = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  const APP = read2('../../App.tsx')
  const BASIC = read2('../basic-data/BasicDataScreen.tsx')
  const RESTORE = read2('../backup-restore/BackupRestoreScreen.tsx')
  it('盤面の結果は 1 行の組み立て関数へ（旧来の長文が戻っていない）', () => {
    expect(BOARD).toContain('setStatusMessage(buildAutoAssignResultMessage({')
    expect(BOARD).toContain('setStatusMessage(buildHolidayReleaseResultMessage({')
    expect(BOARD).toContain('setStatusMessage(buildWholeDayTransferResultMessage({')
    expect(BOARD).not.toContain('候補不足でストックに残しています')
    expect(BOARD).not.toContain('の休日設定を解除しました。通常営業に戻しました。')
    expect(BOARD).not.toContain('移動先の空いている席を左クリックしてください（入れ替え・2 行の机への移動はできません）')
    expect(BOARD).not.toContain('・生徒ごと席を入れ替える（講師と生徒のペアはそのまま、席番号を交換）')
  })
  it('確認ダイアログは 1〜2 行（全コマ削除・休日の解除・出席不可）', () => {
    expect(BOARD).toContain('の全コマの生徒を削除します（講師は残す・振替/講習は未消化へ・通常/体験/増コマは回数 −1）。\\nよろしいですか？')
    expect(BOARD).not.toContain('\\n講師はそのまま残ります。\\n振替・講習は未消化ストックへ戻します。')
    expect(BOARD).toContain('if (!window.confirm(confirmText))')
    expect(BOARD).toContain('（不可には戻せません）')
  })
  it('保存失敗・別の端末で更新は 2 行（手順の箇条書きは無い）', () => {
    expect(APP).not.toContain('お手数ですが、次の手順でご対応ください。')
    expect(APP).not.toContain('  1. インターネット接続を確認する')
    expect(APP).toContain('保存に失敗しました。接続を確認して、もう一度「保存」してください。')
  })
  it('退塾・自教室復元のモーダルは 1 行＋「詳細」。「元に戻せません」は畳まない', () => {
    expect(BASIC).toContain('{confirmation.summary}</p>')
    expect(BASIC).toContain('data-testid="basic-data-withdraw-detail"')
    expect(RESTORE).toContain('{managerSelfRestoreConfirmation.keyWarning}</p>')
    expect(RESTORE.indexOf('managerSelfRestoreConfirmation.keyWarning')).toBeLessThan(RESTORE.indexOf('data-testid="backup-restore-self-restore-detail"'))
    // 取り違え防止の規模の行は畳まない（2026-06-06 上書き事故の再発防止）
    expect(RESTORE.indexOf('managerSelfRestoreConfirmation.scaleLine')).toBeLessThan(RESTORE.indexOf('data-testid="backup-restore-self-restore-detail"'))
  })
})
