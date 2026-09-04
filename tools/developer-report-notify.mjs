// 「開発者へ報告」の通知スクリプト(GitHub Actions のスケジュール実行から使う。
// .github/workflows/developer-reports.yml / docs/runbooks/monitoring.md)。
//
// 何をするか:
//   1. Firestore REST で workspaces/{ws}/developerReports のうち notifiedAt が null の報告を取る
//   2. 報告ごとに GitHub Issue を起票する(ラベル type:bug / status:triage / source:user-report)
//   3. 起票できた報告の notifiedAt / issueNumber / issueUrl を埋める(二重起票防止)
//
// ⚠️ リポジトリは公開なので、Issue 本文には**個人情報になり得る操作痕跡(生徒名を含む)や教室データは載せない**。
//    本文はメタ情報(教室名・時刻・版数・報告元・一言)と、詳細の置き場所(Firestore 文書 / Storage パス)だけ。
//
// 認証: Firestore はサービスアカウントのアクセストークン(FIRESTORE_ACCESS_TOKEN)、GitHub は GITHUB_TOKEN。
// 実ネットワークを使う部分は fetchImpl を注入できるようにし、整形ロジックはテスト(developer-report-notify.test.mjs)で固定する。

import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PROJECT_ID = 'komahyouapp-prod'
export const DEFAULT_WORKSPACE_KEY = 'main'
export const DEFAULT_STORAGE_BUCKET = 'komahyouapp-prod.firebasestorage.app'
export const ISSUE_LABELS = ['type:bug', 'status:triage', 'source:user-report']
export const ISSUE_LABELS_BY_CATEGORY = {
  bug: ['type:bug', 'status:triage', 'source:user-report'],
  request: ['type:feature', 'status:triage', 'source:user-report'],
}
export function resolveIssueLabels(report) {
  return ISSUE_LABELS_BY_CATEGORY[report?.category] ?? ISSUE_LABELS
}
const QUERY_LIMIT = 20

/** Firestore REST の値表現({ stringValue: 'x' } など)を素の JS 値へ戻す。 */
export function decodeFirestoreValue(value) {
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

export function decodeFirestoreFields(fields) {
  const result = {}
  for (const [key, value] of Object.entries(fields ?? {})) result[key] = decodeFirestoreValue(value)
  return result
}

/** runQuery の応答(配列。document を持たない要素が混じる)を報告オブジェクトの配列へ。 */
export function parseRunQueryResponse(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row) => row && row.document && row.document.fields)
    .map((row) => ({
      documentPath: row.document.name,
      ...decodeFirestoreFields(row.document.fields),
    }))
    // #テスト はサーバーが notifiedAt を埋めるので通常は来ないが、念のためここでも除外する(Issue を作らない)。
    .filter((report) => report.isTest !== true)
    .sort((a, b) => String(a.recordedAt ?? '').localeCompare(String(b.recordedAt ?? '')))
}

export function buildRunQueryBody() {
  return {
    structuredQuery: {
      from: [{ collectionId: 'developerReports' }],
      where: { unaryFilter: { op: 'IS_NULL', field: { fieldPath: 'notifiedAt' } } },
      limit: QUERY_LIMIT,
    },
  }
}

function toJstLabel(iso) {
  const ms = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(ms)) return String(iso ?? '(不明)')
  const jst = new Date(ms + 9 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())} JST`
}

const SOURCE_LABELS = { board: 'コマ表(盤面)', schedule: '日程表(別タブ)' }
const CATEGORY_LABELS = { bug: '不具合・おかしい', request: '追加してほしい・要望' }

export function buildIssueTitle(report) {
  const classroom = report.classroomName || report.classroomId || '教室不明'
  const noteHead = String(report.note ?? '').split('\n')[0].trim()
  const suffix = noteHead ? `: ${noteHead.slice(0, 40)}${noteHead.length > 40 ? '…' : ''}` : ''
  const kind = report.category === 'request' ? '利用者要望' : '利用者報告'
  return `📣 [${kind}] ${classroom}${suffix}`
}

/**
 * Issue 本文。公開リポジトリなので操作痕跡・教室データは載せず、置き場所だけ示す。
 */
export function buildIssueBody(report, options = {}) {
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID
  const bucket = options.storageBucket ?? DEFAULT_STORAGE_BUCKET
  const workspaceKey = options.workspaceKey ?? DEFAULT_WORKSPACE_KEY
  const note = String(report.note ?? '').trim()
  const scheduleContext = report.scheduleContext && typeof report.scheduleContext === 'object' ? report.scheduleContext : {}
  const contextLines = Object.entries(scheduleContext)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `  - ${key}: ${String(value)}`)
  const docPath = `workspaces/${workspaceKey}/developerReports/${report.reportId}`
  const consoleUrl = `https://console.firebase.google.com/project/${projectId}/firestore/databases/-default-/data/~2F${encodeURIComponent(docPath).replace(/%2F/g, '~2F')}`
  const lines = [
    '利用者が画面の「要望・報告」ボタンから送った内容です(自動起票)。',
    '',
    `- 教室: ${report.classroomName || '(名称不明)'} (\`${report.classroomId ?? ''}\`)`,
    `- 種類: ${CATEGORY_LABELS[report.category] ?? report.category ?? '(不明)'}`,
    `- 報告元: ${SOURCE_LABELS[report.source] ?? report.source ?? '(不明)'}`,
    `- 報告時刻: ${toJstLabel(report.reportedAt)} (サーバー受領 ${toJstLabel(report.recordedAt)})`,
    `- アプリ版数: ${report.appVersion || '(不明)'}`,
    `- 報告者の権限: ${report.reporterRole || '(不明)'}`,
    `- 未保存の変更: ${report.boardDirty ? 'あり(保存前の状態を含む)' : 'なし'} / 最終保存 ${report.lastSavedAt ? toJstLabel(report.lastSavedAt) : '(不明)'}`,
    `- 同梱された操作痕跡: ${Number(report.recentOperationCount ?? (Array.isArray(report.recentOperations) ? report.recentOperations.length : 0))} 件`,
  ]
  if (contextLines.length > 0) {
    lines.push('- 日程表の表示条件:', ...contextLines)
  }
  lines.push('', '## 利用者の一言', '', note ? `> ${note.replace(/\n/g, '\n> ')}` : '(空欄で送信)')
  lines.push(
    '',
    '## 詳細の置き場所(生徒名を含むため Issue には載せない)',
    '',
    `- Firestore 文書: \`${docPath}\` — [コンソールで開く](${consoleUrl})`,
    '  - `recentOperations` が直近の操作痕跡(時刻順)。`kind` と `summary` を上から読む。',
  )
  if (report.snapshotStoragePath) {
    lines.push(
      `- 報告時点の教室データ(gzip JSON): \`gs://${bucket}/${report.snapshotStoragePath}\``,
      '',
      '```bash',
      `gsutil cp "gs://${bucket}/${report.snapshotStoragePath}" ./report.json.gz && gunzip -f ./report.json.gz`,
      '```',
    )
  } else {
    lines.push('- 報告時点の教室データ: (保存されていません。関数ログ `[DeveloperReport]` を確認)')
  }
  lines.push(
    '',
    '## 進め方(オーナー指示 2026-09-04・厳守)',
    '',
    '⚠️ **この Issue を見て勝手に修正を始めないこと。** 調査・整理(triage)までは進めてよいが、',
    '**コード修正への着手は開発者(オーナー)が内容を確認し「進めて」と許可してから。**',
    '',
    '1. 開発者が Firestore 文書の操作痕跡と Storage の教室データを確認し、バグ／仕様の誤解／勘違いを切り分ける。',
    '2. 必要なら `bug-triage` の手順で再現手順・影響範囲・優先度をこの Issue に追記する(整理のみ)。',
    '3. 開発者の許可が出たら `dev-fix` で修正＋回帰防止テスト。仕様の誤解なら室長へ説明し、必要なら改善 Issue を切る。',
    '',
    `Run: ${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? 'Kake-git-hub/KomahyouApp'}/actions/runs/${process.env.GITHUB_RUN_ID ?? '(local)'}`,
  )
  return lines.join('\n')
}

export function buildMarkNotifiedBody(issueNumber, issueUrl, nowIso) {
  return {
    fields: {
      notifiedAt: { stringValue: nowIso },
      issueNumber: { integerValue: String(issueNumber) },
      issueUrl: { stringValue: issueUrl },
    },
  }
}

export async function fetchPendingReports({ projectId, workspaceKey, accessToken, fetchImpl = fetch }) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/workspaces/${workspaceKey}:runQuery`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRunQueryBody()),
  })
  if (!response.ok) throw new Error(`Firestore runQuery failed: HTTP ${response.status} ${await response.text()}`)
  return parseRunQueryResponse(await response.json())
}

export async function createIssue({ repository, githubToken, title, body, labels = ISSUE_LABELS, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'komahyou-developer-report-notify',
    },
    body: JSON.stringify({ title, body, labels }),
  })
  if (!response.ok) throw new Error(`GitHub issue create failed: HTTP ${response.status} ${await response.text()}`)
  const json = await response.json()
  return { number: json.number, url: json.html_url }
}

export async function markNotified({ projectId, documentPath, accessToken, issueNumber, issueUrl, nowIso = new Date().toISOString(), fetchImpl = fetch }) {
  const path = documentPath.startsWith('projects/') ? documentPath : `projects/${projectId}/databases/(default)/documents/${documentPath}`
  const url = `https://firestore.googleapis.com/v1/${path}?updateMask.fieldPaths=notifiedAt&updateMask.fieldPaths=issueNumber&updateMask.fieldPaths=issueUrl`
  const response = await fetchImpl(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMarkNotifiedBody(issueNumber, issueUrl, nowIso)),
  })
  if (!response.ok) throw new Error(`Firestore markNotified failed: HTTP ${response.status} ${await response.text()}`)
}

/** 1回分の処理。起票→記録の順(記録に失敗しても次回は同じ Issue タイトルで再起票されるより、二重起票の方が安全側)。 */
export async function notifyPendingReports(deps) {
  const reports = await fetchPendingReports(deps)
  const results = []
  for (const report of reports) {
    const issue = await createIssue({ ...deps, title: buildIssueTitle(report), body: buildIssueBody(report, deps), labels: resolveIssueLabels(report) })
    await markNotified({ ...deps, documentPath: report.documentPath, issueNumber: issue.number, issueUrl: issue.url })
    results.push({ reportId: report.reportId, issueNumber: issue.number, issueUrl: issue.url })
  }
  return results
}

async function main() {
  const accessToken = (process.env.FIRESTORE_ACCESS_TOKEN || '').trim()
  const githubToken = (process.env.GITHUB_TOKEN || '').trim()
  const repository = (process.env.GITHUB_REPOSITORY || '').trim()
  if (!accessToken || !githubToken || !repository) {
    throw new Error('FIRESTORE_ACCESS_TOKEN / GITHUB_TOKEN / GITHUB_REPOSITORY が必要です。')
  }
  const results = await notifyPendingReports({
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    workspaceKey: process.env.FIREBASE_WORKSPACE_KEY || DEFAULT_WORKSPACE_KEY,
    storageBucket: process.env.STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET,
    accessToken,
    githubToken,
    repository,
  })
  const summary = results.length === 0
    ? '新しい利用者報告はありません。'
    : results.map((r) => `- ${r.reportId} → ${r.issueUrl}`).join('\n')
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 利用者報告の通知\n\n${summary}\n`)
  }
}

// CLI として直接実行されたときだけ動かす(テストから import しても実行されない)。
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
