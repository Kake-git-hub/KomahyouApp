// QR 提出通知の「通知済み(notifiedAt)」をサーバーから外して、その教室の PC で次回起動時にもう一度通知させるツール。
//
// 背景(2026-09-26): 開発者画面(v1.5.558 以前)や、開発者が本番教室を開いたとき(v1.5.559 以前)に表示した QR 提出通知が
// notifiedAt=submittedAt として記録され、室長の PC が閉じていた提出は次回起動の通知(selectStartupSubmissionsToNotify)
// から外れていた。実例: 坂口講師の提出(開発者画面で表示された)。本ツールで notifiedAt を外すと、室長 PC の次回起動で
// 通知が出る(ただし条件がもう一つある・下記「再通知の条件」)。
//
// ★本番データ保護(CLAUDE.md): これは **本番教室の提出ドキュメント(lectureSubmissions/{token})への書き込み** を伴う。
//   Claude のセッションからは実行しない。オーナーが GitHub Actions「Reset QR submission notified flag」から実行する
//   (サービスアカウントの資格情報は CI 側にある)。書き込みは `--apply --token <token>` を付けたときだけ・notifiedAt
//   フィールドの削除だけ(提出内容は触らない・INV-07)。対象 doc の classroomId が --classroom と違えば書かない(INV-08)。
//
// ★再通知の条件: 室長 PC の起動時通知は「submittedAt が教室の前回保存(classroomSnapshots/{id}.savedAt)より後」も要る。
//   室長が提出のあとに一度でも保存していれば、notifiedAt を外しても通知は出ない(list で判定を表示する)。
//
// 使い方(GitHub Actions 経由が基本。ローカルなら gcloud auth 済みで):
//   一覧: node tools/lecture-submission-notified-reset.mjs --workspace main --classroom <教室ID>
//   実行: node tools/lecture-submission-notified-reset.mjs --workspace main --classroom <教室ID> --token <token> --apply

import { execFileSync } from 'node:child_process'
import { isInvokedDirectly } from './invoked-directly.mjs'

const DEFAULT_PROJECT_ID = 'komahyouapp-prod'

export const USAGE = '使い方: node tools/lecture-submission-notified-reset.mjs --workspace <key> --classroom <教室ID> [--token <token> --apply] [--project komahyouapp-prod]'

export function parseArgs(argv) {
  const options = { workspaceKey: '', classroomId: '', token: '', apply: false, project: DEFAULT_PROJECT_ID }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--workspace') { options.workspaceKey = argv[++index] ?? ''; continue }
    if (arg === '--classroom') { options.classroomId = argv[++index] ?? ''; continue }
    if (arg === '--token') { options.token = argv[++index] ?? ''; continue }
    if (arg === '--project') { options.project = argv[++index] ?? options.project; continue }
    if (arg === '--apply') { options.apply = true; continue }
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  if (!options.workspaceKey) errors.push('--workspace <key> は必須です。')
  if (!options.classroomId) errors.push('--classroom <教室ID> は必須です(教室を取り違えないため既定値は無い)。')
  if (options.apply && !options.token) errors.push('--apply には --token <token> が必須です(1 件ずつしか外さない)。')
  return errors
}

function accessToken() {
  if (process.env.FIRESTORE_ACCESS_TOKEN) return process.env.FIRESTORE_ACCESS_TOKEN
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
}

export function fieldValue(field) {
  if (!field || typeof field !== 'object') return undefined
  if ('stringValue' in field) return field.stringValue
  if ('integerValue' in field) return Number(field.integerValue)
  if ('booleanValue' in field) return field.booleanValue
  if ('nullValue' in field) return null
  if ('timestampValue' in field) return field.timestampValue
  return undefined
}

/** 当該教室の提出済み(status=submitted)の提出 doc を全件取る構造化クエリ(App の subscribeLectureSubmissions と同じ where)。 */
export function buildSubmittedQuery(classroomId) {
  return {
    structuredQuery: {
      from: [{ collectionId: 'lectureSubmissions' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'classroomId' }, op: 'EQUAL', value: { stringValue: classroomId } } },
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'submitted' } } },
          ],
        },
      },
    },
  }
}

/** notifiedAt を外したとき、室長 PC の次回起動で通知が出るか(App の selectStartupSubmissionsToNotify と同じ判定)。 */
export function wouldRenotifyAfterReset(submittedAt, classroomSavedAt) {
  if (typeof submittedAt !== 'string' || !submittedAt) return false
  const submittedMs = new Date(submittedAt).getTime()
  const savedMs = classroomSavedAt ? new Date(classroomSavedAt).getTime() : Number.NaN
  if (Number.isNaN(submittedMs) || Number.isNaN(savedMs)) return false
  return submittedMs > savedMs
}

/** 一覧の 1 行。個人名は提出 doc の personName(室長が配布時に入れた表示名)をそのまま出す。 */
export function summarizeSubmission(name, fields, classroomSavedAt) {
  const token = name.split('/').pop() ?? name
  const submittedAt = fieldValue(fields.submittedAt) ?? null
  const notifiedAt = fieldValue(fields.notifiedAt) ?? null
  return {
    token,
    personType: fieldValue(fields.personType) ?? '',
    personName: fieldValue(fields.personName) ?? '',
    sessionLabel: fieldValue(fields.sessionLabel) ?? '',
    submittedAt,
    notifiedAt,
    notified: typeof notifiedAt === 'string' && notifiedAt === submittedAt,
    wouldRenotify: wouldRenotifyAfterReset(submittedAt, classroomSavedAt),
  }
}

/**
 * notifiedAt だけを削除する PATCH(部分更新)。updateMask に notifiedAt を載せて本文に含めないと、その 1 フィールドが消える。
 * 提出内容(unavailableSlots 等)は updateMask に無いので触らない(INV-07)。
 */
export function buildDeleteNotifiedRequest(project, token) {
  const docPath = `projects/${project}/databases/(default)/documents/lectureSubmissions/${encodeURIComponent(token)}`
  return {
    url: `https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=notifiedAt`,
    method: 'PATCH',
    body: { fields: {} },
  }
}

/** 書く前の安全確認: doc が存在し、教室が一致し、今 notifiedAt が付いていること。 */
export function resolveApplyGuard(fields, expectedClassroomId) {
  if (!fields) return { ok: false, reason: '提出ドキュメントが見つからない' }
  const classroomId = fieldValue(fields.classroomId)
  if (classroomId !== expectedClassroomId) return { ok: false, reason: `教室が一致しない(doc=${classroomId ?? '(無し)'} / 指定=${expectedClassroomId})` }
  if (typeof fieldValue(fields.notifiedAt) !== 'string') return { ok: false, reason: 'notifiedAt は付いていない(外すものが無い)' }
  return { ok: true, reason: '' }
}

async function firestoreFetch(token, url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`Firestore ${init.method ?? 'GET'} ${response.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const errors = validateArgs(options)
  if (errors.length > 0) {
    console.error(USAGE)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  const token = accessToken()
  const base = `https://firestore.googleapis.com/v1/projects/${options.project}/databases/(default)/documents`

  const snapshotDoc = await firestoreFetch(token, `${base}/workspaces/${options.workspaceKey}/classroomSnapshots/${options.classroomId}?mask.fieldPaths=savedAt&mask.fieldPaths=name`).catch(() => null)
  const classroomSavedAt = snapshotDoc ? fieldValue(snapshotDoc.fields?.savedAt) ?? '' : ''
  console.log(`[classroom] ${options.classroomId} 前回保存(savedAt)=${classroomSavedAt || '(取得できず)'}`)

  const rows = await firestoreFetch(token, `${base}:runQuery`, { method: 'POST', body: JSON.stringify(buildSubmittedQuery(options.classroomId)) })
  const submissions = (rows ?? []).filter((row) => row.document).map((row) => summarizeSubmission(row.document.name, row.document.fields ?? {}, classroomSavedAt))
  submissions.sort((a, b) => String(b.submittedAt ?? '').localeCompare(String(a.submittedAt ?? '')))
  console.log(`[list] 提出済み ${submissions.length} 件(新しい順)。notified=通知済み記録あり / renotify=notifiedAt を外せば室長 PC の次回起動で通知が出る`)
  for (const row of submissions) {
    console.log(`  ${row.token}  ${row.personType === 'teacher' ? '講師' : '生徒'} ${row.personName}  ${row.sessionLabel}  submittedAt=${row.submittedAt ?? '-'}  notified=${row.notified ? 'yes' : 'no'}  renotify=${row.wouldRenotify ? 'yes' : 'no(前回保存より前)'}`)
  }

  if (!options.token) return
  const target = submissions.find((row) => row.token === options.token)
  const doc = await firestoreFetch(token, `${base}/lectureSubmissions/${encodeURIComponent(options.token)}`).catch(() => null)
  const guard = resolveApplyGuard(doc?.fields, options.classroomId)
  if (!guard.ok) {
    console.error(`[apply] 中止: ${guard.reason}`)
    process.exitCode = 2
    return
  }
  console.log(`[target] ${options.token} ${target ? `${target.personName} ${target.sessionLabel} submittedAt=${target.submittedAt}` : ''}`)
  if (!target?.wouldRenotify) console.log('[note] 教室の前回保存が提出より後なので、notifiedAt を外しても室長 PC の起動時通知は出ない(集計の「提出済」で確認してもらう)。')
  if (!options.apply) {
    console.log('[dry-run] --apply が無いので書き込まない。')
    return
  }
  const request = buildDeleteNotifiedRequest(options.project, options.token)
  await firestoreFetch(token, request.url, { method: request.method, body: JSON.stringify(request.body) })
  console.log('[apply] notifiedAt を外した。室長 PC の次回起動(ハードリロード)で通知が出る(上の note が無ければ)。')
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
}
