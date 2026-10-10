// 2 社目の初期データ受け入れ用 Excel 雛形を作る(P-7・2026-10-10・計画 plan-2026-09-18 §3)。
//
//   node tools/build-company-onboarding-template.mjs [--out docs/runbooks/company-onboarding-template.xlsx]
//
// シート名・列名は基本データ画面の「現データ出力 / 取込」(src/components/basic-data/BasicDataScreen.tsx の
// buildWorkbook / parseImportedBundle)と**同じ**にしてあり、会社に記入してもらった雛形をそのまま取込できる。
// 列名の同期は tools/build-company-onboarding-template.test.mjs が BasicDataScreen.tsx の字面と突き合わせて検査する。
// 個人情報は入れない(記入例は架空)。会社からの受け渡し方法は docs/runbooks/company-onboarding.md §3-7。
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as xlsx from 'xlsx'
import { isInvokedDirectly } from './invoked-directly.mjs'

export const TEMPLATE_SHEETS = [
  { name: 'マネージャー', columns: ['管理ID', '名前', 'メール'] },
  { name: '講師', columns: ['講師ID', '名前', '表示名', 'メール', '入塾日', '退塾日', '担当科目'] },
  { name: '生徒', columns: ['生徒ID', '名前', '表示名', 'メール', '入塾日', '退塾日', '生年月日', '外部生'] },
  { name: '通常授業テンプレ', columns: ['開始日', '曜日', '時限', '机', '講師', '生徒1', '科目1', '注記1', '生徒2', '科目2', '注記2'] },
  { name: '教室データ', columns: ['休校曜日', '机数'] },
]

/** 記入例(架空)。ID 列は空のまま = 取込時に自動採番。 */
export const TEMPLATE_SAMPLE_ROWS = {
  'マネージャー': [{ 管理ID: '', 名前: '室長 太郎', メール: 'manager@example.com' }],
  '講師': [
    { 講師ID: '', 名前: '講師 一郎', 表示名: '', メール: '', 入塾日: '2026-04-01', 退塾日: '', 担当科目: '英:高3, 数:中' },
  ],
  '生徒': [
    { 生徒ID: '', 名前: '生徒 花子', 表示名: '', メール: '', 入塾日: '2026-04-01', 退塾日: '', 生年月日: '2012-05-01', 外部生: '' },
  ],
  '通常授業テンプレ': [
    { 開始日: '2026-04-06', 曜日: '月', 時限: '1限', 机: 1, 講師: '講師 一郎', 生徒1: '生徒 花子', 科目1: '英', 注記1: '', 生徒2: '', 科目2: '', 注記2: '' },
  ],
  '教室データ': [{ 休校曜日: '日曜', 机数: 14 }],
}

export const TEMPLATE_NOTES = [
  { 項目: '記入の前に', 説明: 'この雛形は 1 教室ぶんです。教室ごとにファイルを分けてください(教室名をファイル名に)。記入例の行は消して使います。' },
  { 項目: '各ID列', 説明: '新規の会社では空欄のままにしてください(取込時に自動採番)。空欄でも取り込めます。' },
  { 項目: '講師.担当科目', 説明: '英:高3, 数:中 のように 科目:上限学年 をカンマ区切りで記入します。' },
  { 項目: '講師/生徒.入塾日', 説明: 'YYYY-MM-DD 形式か Excel の日付セル。空欄なら即時在籍として扱います。' },
  { 項目: '講師/生徒.退塾日', 説明: 'YYYY-MM-DD 形式か Excel の日付セル。空欄と 未定 はどちらも日付未設定として扱います。' },
  { 項目: '生徒.生年月日', 説明: 'YYYY-MM-DD 形式か Excel の日付セル。学年はアプリ側で自動計算します。' },
  { 項目: '生徒.外部生', 説明: 'はい / ○ / 1 / true のいずれかで外部生。空欄は通常の在籍生徒です。' },
  { 項目: '通常授業テンプレ', 説明: '講師名と生徒名は各シートの「名前」列に一致させてください。開始日はテンプレの反映開始日(週の月曜)。無ければシートごと削除して構いません(導入後に室長がコマ表から作れます)。' },
  { 項目: '教室データ', 説明: '休校曜日 は 日曜, 月曜 のように曜日名をカンマ区切り。机数は同時に授業できる席の数。' },
  { 項目: '個人情報の受け渡し', 説明: 'メールにそのまま添付しない。パスワード付き zip(パスワードは別経路)か、会社の共有ドライブの期限付きリンクで渡す(docs/runbooks/company-onboarding.md)。' },
]

export function buildTemplateWorkbook() {
  const workbook = xlsx.utils.book_new()
  for (const sheet of TEMPLATE_SHEETS) {
    const rows = TEMPLATE_SAMPLE_ROWS[sheet.name] ?? []
    const worksheet = xlsx.utils.json_to_sheet(rows, { header: sheet.columns })
    worksheet['!cols'] = sheet.columns.map((column) => ({ wch: Math.max(12, column.length * 2 + 4) }))
    xlsx.utils.book_append_sheet(workbook, worksheet, sheet.name)
  }
  const notes = xlsx.utils.json_to_sheet(TEMPLATE_NOTES, { header: ['項目', '説明'] })
  notes['!cols'] = [{ wch: 22 }, { wch: 110 }]
  xlsx.utils.book_append_sheet(workbook, notes, '説明')
  return workbook
}

function main() {
  const outIndex = process.argv.indexOf('--out')
  const outPath = resolve(outIndex > -1 ? process.argv[outIndex + 1] : 'docs/runbooks/company-onboarding-template.xlsx')
  const buffer = xlsx.write(buildTemplateWorkbook(), { type: 'buffer', bookType: 'xlsx' })
  writeFileSync(outPath, buffer)
  console.log(`wrote ${outPath}`)
}

if (isInvokedDirectly(import.meta.url)) main()
