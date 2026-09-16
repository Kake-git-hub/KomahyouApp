// 開発用教室から送られた「確認リスト」結果を読み取る読み取り専用ツール。
//
// 開発用教室(v8OZ7zH8vONNHjjYVcR1)の画面に出す確認チェックリストは、「保存して送信」で
// 既存の要望・報告経路(Cloud Function `submitDeveloperReport` → Firestore
// `workspaces/{ws}/developerReports/{id}`)へ本文を送る。本文の先頭行は固定マーカー
// `[確認リスト vX.Y.Z]`(分割時は `[確認リスト vX.Y.Z] (1/2)` のように続く)。
//
// このツールは Firestore を GET するだけ（書き込みは一切しない・本番データ保護ルール準拠）。
// マーカー付きの報告だけを集め、分割を受付順に結合し、項目 id ごとに最新の結果を Markdown へ整形する。
//
// 使い方（gcloud にログイン済みの PC で）:
//   node tools/verification-checklist-report.mjs --workspace <key> [--since YYYY-MM-DD] [--classroom <id>] [--version vX.Y.Z] [--json]
//   - --workspace は必須（会社＝workspace のキー。既定値は廃止済み・2026-09-16 複数会社展開 Phase 0 T0-4）。
//   - --since 省略時は 14 日前から。
//   - --classroom 省略時は開発用教室 v8OZ7zH8vONNHjjYVcR1。
//   - --version でマーカーの版を絞る（例: v1.5.502。先頭の v は付けても付けなくてもよい）。
//   - --json で集約結果をそのまま出す（他ツールへ渡す用）。
import { execFileSync, execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeChecklistReports, summarizeChecklistResults, buildChecklistMarkdown, toChecklistReport } from './verification-checklist-report.lib.mjs'

const DEFAULT_PROJECT_ID = 'komahyouapp-prod'
const DEFAULT_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1' // 開発用教室（書き込み可能な唯一の教室・読み取りのみ使用）
const DEFAULT_SINCE_DAYS = 14

export const USAGE = '使い方: node tools/verification-checklist-report.mjs --workspace <key> [--since YYYY-MM-DD] [--classroom <id>] [--version vX.Y.Z] [--json]'

export function parseArgs(argv) {
  const options = {
    since: '',
    classroomId: DEFAULT_CLASSROOM_ID,
    version: '',
    project: DEFAULT_PROJECT_ID,
    workspaceKey: '',
    json: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--since') { options.since = argv[++index] ?? ''; continue }
    if (arg === '--classroom') { options.classroomId = argv[++index] ?? options.classroomId; continue }
    if (arg === '--version') { options.version = (argv[++index] ?? '').replace(/^v/u, ''); continue }
    if (arg === '--project') { options.project = argv[++index] ?? options.project; continue }
    if (arg === '--workspace') { options.workspaceKey = argv[++index] ?? options.workspaceKey; continue }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  if (!options.workspaceKey) errors.push('--workspace <key> は必須です。')
  return errors
}

function defaultSinceIso(days) {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString()
}

function accessToken() {
  // Windows では gcloud が .cmd のため shell 経由で呼ぶ(既存 tools と同じ引数)。
  if (process.platform === 'win32') return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim()
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('nullValue' in value) return null
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decodeFirestoreValue)
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields ?? {})
  return null
}

function decodeFirestoreFields(fields) {
  const result = {}
  for (const [key, value] of Object.entries(fields ?? {})) result[key] = decodeFirestoreValue(value)
  return result
}

// classroomId の等価フィルタだけにする（単一フィールドの等価フィルタは複合インデックス不要）。
// recordedAt の絞り込みは取得後にクライアント側で行う（範囲フィルタ＋orderBy の組み合わせは
// 複合インデックスを要求し、未作成だと失敗するため避ける。developer-report-notify.mjs と同じ方針）。
function buildRunQueryBody({ classroomId }) {
  return {
    structuredQuery: {
      from: [{ collectionId: 'developerReports' }],
      where: { fieldFilter: { field: { fieldPath: 'classroomId' }, op: 'EQUAL', value: { stringValue: classroomId } } },
      limit: 1000,
    },
  }
}

async function firestoreRunQuery(project, workspaceKey, token, body) {
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/workspaces/${workspaceKey}:runQuery`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Firestore runQuery failed: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}

function parseRunQueryResponse(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row) => row && row.document && row.document.fields)
    .map((row) => ({ documentPath: row.document.name, ...decodeFirestoreFields(row.document.fields) }))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const errors = validateArgs(options)
  if (errors.length > 0) {
    console.error(USAGE)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  const sinceIso = options.since ? new Date(`${options.since}T00:00:00.000Z`).toISOString() : defaultSinceIso(DEFAULT_SINCE_DAYS)
  const token = accessToken()
  const raw = await firestoreRunQuery(options.project, options.workspaceKey, token, buildRunQueryBody({ classroomId: options.classroomId }))
  const reports = parseRunQueryResponse(raw)
    .filter((report) => String(report.recordedAt ?? report.reportedAt ?? '') >= sinceIso)
    .map(toChecklistReport)
    .filter((report) => report !== null)
    .filter((report) => !options.version || report.version === options.version)

  const merged = mergeChecklistReports(reports)
  const summary = summarizeChecklistResults(merged)

  if (options.json) {
    console.log(JSON.stringify({ since: sinceIso, classroomId: options.classroomId, mergedCount: merged.length, ...summary }, null, 2))
    return
  }

  const versionsFound = [...new Set(merged.map((entry) => entry.version))].sort()
  const heading = `# 確認リスト結果（${options.classroomId} / ${sinceIso.slice(0, 10)} 以降${versionsFound.length > 0 ? ` / 版: ${versionsFound.join(', ')}` : ''}）`
  console.log(buildChecklistMarkdown(summary, { heading }))
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  await main()
}
