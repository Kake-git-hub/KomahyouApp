#!/usr/bin/env node
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
//   node tools/verification-checklist-report.mjs [--since YYYY-MM-DD] [--classroom <id>] [--version vX.Y.Z] [--json]
//   - --since 省略時は 14 日前から。
//   - --classroom 省略時は開発用教室 v8OZ7zH8vONNHjjYVcR1。
//   - --version でマーカーの版を絞る（例: v1.5.502。先頭の v は付けても付けなくてもよい）。
//   - --json で集約結果をそのまま出す（他ツールへ渡す用）。
import { execFileSync } from 'node:child_process'
import { mergeChecklistReports, summarizeChecklistResults, buildChecklistMarkdown, toChecklistReport } from './verification-checklist-report.lib.mjs'

const DEFAULT_PROJECT_ID = 'komahyouapp-prod'
const DEFAULT_WORKSPACE_KEY = 'main'
const DEFAULT_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1' // 開発用教室（書き込み可能な唯一の教室・読み取りのみ使用）
const DEFAULT_SINCE_DAYS = 14

function parseArgs(argv) {
  const options = {
    since: '',
    classroomId: DEFAULT_CLASSROOM_ID,
    version: '',
    project: DEFAULT_PROJECT_ID,
    workspaceKey: DEFAULT_WORKSPACE_KEY,
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

function defaultSinceIso(days) {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString()
}

function accessToken() {
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
    console.log('使い方: node tools/verification-checklist-report.mjs [--since YYYY-MM-DD] [--classroom <id>] [--version vX.Y.Z] [--json]')
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

await main()
