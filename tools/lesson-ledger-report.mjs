#!/usr/bin/env node
// 生徒授業台帳（classroomSnapshots/{id}/lessonLedgerDays）を読み取り専用で表示するレポート。
//
// 「ある日時点で、各生徒の授業数・未消化数（元コマ一覧つき）がどうだったか」を後から確認するための道具。
// Firestore へは GET しかしない（書き込み API は一切呼ばない・本番データ保護ルール準拠）。
//
// 使い方（gcloud にログイン済みの PC で）:
//   node tools/lesson-ledger-report.mjs <classroomId> [--date YYYY-MM-DD] [--student 氏名の一部] [--project komahyouapp-prod] [--json]
//   - --date 省略時は最新の台帳。指定日の台帳が無ければ「その日以前で最新」を使う（保存が無い日はドキュメントが無い）。
//   - --student で生徒を絞る（部分一致）。
//   - --json で復号した台帳をそのまま出す（他ツールへ渡す用）。
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

function parseArgs(argv) {
  const options = { classroomId: '', date: '', student: '', project: 'komahyouapp-prod', workspaceKey: 'main', json: false, list: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--date') { options.date = argv[++index] ?? ''; continue }
    if (arg === '--student') { options.student = argv[++index] ?? ''; continue }
    if (arg === '--project') { options.project = argv[++index] ?? options.project; continue }
    if (arg === '--workspace') { options.workspaceKey = argv[++index] ?? options.workspaceKey; continue }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--list') { options.list = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (!options.classroomId) options.classroomId = arg
  }
  return options
}

function accessToken() {
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
}

async function firestoreGet(project, path, token, query = '') {
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}${query}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`Firestore GET failed: ${response.status} ${await response.text()}`)
  return response.json()
}

function fieldValue(field) {
  if (!field) return undefined
  if ('stringValue' in field) return field.stringValue
  if ('integerValue' in field) return Number(field.integerValue)
  if ('doubleValue' in field) return field.doubleValue
  if ('booleanValue' in field) return field.booleanValue
  if ('mapValue' in field) return Object.fromEntries(Object.entries(field.mapValue.fields ?? {}).map(([key, value]) => [key, fieldValue(value)]))
  if ('arrayValue' in field) return (field.arrayValue.values ?? []).map(fieldValue)
  return undefined
}

function decodeDoc(doc) {
  const fields = Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, value]) => [key, fieldValue(value)]))
  const body = fields.dataEncoding === 'gzip-base64' && typeof fields.data === 'string'
    ? JSON.parse(gunzipSync(Buffer.from(fields.data, 'base64')).toString('utf8'))
    : { rows: [], lectureRows: [] }
  return { ...fields, ...body, data: undefined }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.classroomId) {
    console.log('使い方: node tools/lesson-ledger-report.mjs <classroomId> [--date YYYY-MM-DD] [--student 氏名] [--list] [--json]')
    process.exitCode = options.help ? 0 : 1
    return
  }
  const token = accessToken()
  const basePath = `workspaces/${options.workspaceKey}/classroomSnapshots/${options.classroomId}/lessonLedgerDays`

  if (options.list) {
    const listing = await firestoreGet(options.project, basePath, token, '?pageSize=400&mask.fieldPaths=dateKey&mask.fieldPaths=totals&mask.fieldPaths=rowCount&mask.fieldPaths=updatedBy&mask.fieldPaths=savedAt')
    const rows = (listing.documents ?? []).map((doc) => {
      const fields = Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, value]) => [key, fieldValue(value)]))
      return { 日付: fields.dateKey, 未消化振替: fields.totals?.makeupBalance, 未消化講習: fields.totals?.lecturePending, 出席数: fields.totals?.attended, 配置数: fields.totals?.placed, 行数: fields.rowCount, 保存時刻: fields.savedAt }
    }).sort((left, right) => String(left.日付).localeCompare(String(right.日付)))
    console.table(rows)
    return
  }

  let doc = null
  if (options.date) {
    // 指定日が無ければ「その日以前で最新」を使う
    const listing = await firestoreGet(options.project, basePath, token, '?pageSize=400&mask.fieldPaths=dateKey')
    const keys = (listing.documents ?? []).map((entry) => entry.name.split('/').pop()).filter((key) => key <= options.date).sort()
    const target = keys[keys.length - 1]
    if (!target) throw new Error(`${options.date} 以前の台帳がありません。`)
    doc = await firestoreGet(options.project, `${basePath}/${target}`, token)
  } else {
    const listing = await firestoreGet(options.project, basePath, token, '?pageSize=400&mask.fieldPaths=dateKey')
    const keys = (listing.documents ?? []).map((entry) => entry.name.split('/').pop()).sort()
    const target = keys[keys.length - 1]
    if (!target) throw new Error('台帳がまだありません（台帳は保存のたびに作られます）。')
    doc = await firestoreGet(options.project, `${basePath}/${target}`, token)
  }

  const ledger = decodeDoc(doc)
  const matches = (name) => !options.student || String(name ?? '').replace(/\s/g, '').includes(options.student.replace(/\s/g, ''))
  const rows = (ledger.rows ?? []).filter((row) => matches(row.name))
  const lectureRows = (ledger.lectureRows ?? []).filter((row) => matches(row.name))

  if (options.json) {
    console.log(JSON.stringify({ ...ledger, rows, lectureRows }, null, 2))
    return
  }

  console.log(`台帳日付: ${ledger.dateKey}  保存時刻: ${ledger.savedAt}  実行者: ${ledger.updatedBy}`)
  console.log(`合計: 未消化振替 ${ledger.totals?.makeupBalance ?? '-'} / 未消化講習 ${ledger.totals?.lecturePending ?? '-'} / 出席 ${ledger.totals?.attended ?? '-'} / 配置 ${ledger.totals?.placed ?? '-'}`)
  console.log('\n--- 生徒×科目 ---')
  console.table(rows.map((row) => ({
    生徒: row.name,
    科目: row.subject,
    未消化振替: row.makeupBalance,
    未消化の元コマ: row.makeupRemaining.join(' '),
    出席数: row.attended.length,
    休み数: row.absent.length,
    振無休数: row.absentNoMakeup.length,
    配置数: row.placed.length,
  })))
  if (options.student) {
    for (const row of rows) {
      console.log(`\n[${row.name} ${row.subject}]`)
      console.log('  出席:', row.attended.join(' ') || '-')
      console.log('  休み:', row.absent.join(' ') || '-')
      console.log('  振無休:', row.absentNoMakeup.join(' ') || '-')
      console.log('  配置:', row.placed.join(' ') || '-')
      console.log('  未消化振替:', row.makeupRemaining.join(' ') || '-')
    }
  }
  if (lectureRows.length > 0) {
    console.log('\n--- 未消化講習 ---')
    console.table(lectureRows.map((row) => ({ 生徒: row.name, 講習: row.sessionLabel, 科目: row.subject, 未消化: row.pending, 元コマ: row.origins.join(' ') })))
  }
}

await main()
