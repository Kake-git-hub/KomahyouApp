#!/usr/bin/env node
// 質問・要望の蓄積を QA の充実へつなげる「QA 候補パック」を作る(オーナー指示 2026-10-16 夜
// 「質問や要望が蓄積されて、フィードバックや QA の充実に繋げられるような仕組みにして」)。
//
// 仕組み(docs/runbooks/question-qa-loop.md):
//  1. 蓄積 … 「質問・要望」で届いた報告は developerReports に残る(質問文・AI の回答(主/影)・開発者の回答・解決済み・Issue 番号)。
//  2. 集める … このツールが **読み取りだけ** で、まだ整理していない質問・要望を集めて 1 本の Markdown(パック)にする。
//     先頭に整理のための固定の指示文(QA_CURATION_INSTRUCTIONS)を付けるので、Claude にそのまま読ませて QA 案・要望の整理案を作れる。
//  3. 直す … オーナーが承認した QA を docs/user-manual.md「11. よくある質問」へ足す → sync-shared → デプロイ。
//     説明書は AI 即時回答の根拠なので、QA が増えるほど AI の回答も良くなる(フィードバックの輪)。
//  4. 記録 … 整理した受付番号を docs/qa-curation-log.md に書く。次回のパックには載らない。
//
// 使い方(読み取り専用トークン・tools/prod-readonly-token.mjs):
//   export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)
//   node tools/question-qa-digest.mjs --workspace main [--since YYYY-MM-DD] [--classroom <id>] [--all]
// 出力は local/qa-digests/qa-digest-<時刻>.md(生徒名を含むので Git 管理外・リポジトリや Issue へ貼らない)。
// Firestore へは一切書かない(本番データ保護ルール)。
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInvokedDirectly } from './invoked-directly.mjs'

const DEFAULT_PROJECT_ID = 'komahyouapp-prod'
const DEFAULT_SINCE_DAYS = 90
export const DEFAULT_OUT_DIR = 'local/qa-digests'
export const DEFAULT_LOG_PATH = 'docs/qa-curation-log.md'
export const USAGE = '使い方: node tools/question-qa-digest.mjs --workspace <key> [--since YYYY-MM-DD] [--classroom <id>] [--all] [--out <dir>] [--log <path>]'

/** 種別の表示名(メール・Issue と同じ呼び方)。 */
export const CATEGORY_LABELS = { question: '質問', request: '要望', bug: '不具合' }

/** パック先頭の固定の指示文(Claude に読ませて整理するときの約束。QA の中身は docs/user-manual.md の書き方に合わせる)。 */
export const QA_CURATION_INSTRUCTIONS = [
  '# この文書の使い方(QA 候補パック)',
  '',
  'これは「質問・要望」で届いた報告のうち、まだ QA や要望として整理していないものの一覧です。次の順で整理してください。',
  '',
  '1. **似た質問を束ねる**。言い回しが違っても同じことを聞いている質問は 1 つの QA にまとめる(何件あったかを添える)。',
  '2. **QA 案を書く**。読み手は教室の利用者。画面に出ている言葉(ボタン名・メニュー名)だけで書き、生徒名・講師名・教室名・日付など個別の中身は一般化する。',
  '   根拠は docs/user-manual.md と docs/spec-*.md。説明書に無いことは推測で書かず「要確認」と印を付ける。開発者の回答(answerFinal)があればそれを正とする。',
  '   AI の回答と開発者の回答が食い違っている報告は、説明書の直し方(どの章に何を足すか)も書く。',
  '3. **要望は要望として一覧にする**(1 行要約・件数・影響範囲の見立て)。Issue が無いものは bug-triage スキルで起票する候補にする。',
  '4. **「AI が答えられなかった質問」は最優先**。説明書に章を足すか、QA を足すかを書く。',
  '5. 出力は「QA 案(説明書 11 章へ足す候補)」「説明書の本文を直す候補」「要望の一覧」「対象外(テスト・重複・個別対応で完了)」の 4 つの見出しで。',
  '',
  '整理した QA と本文の修正は **Claude がそのまま** docs/user-manual.md「11. よくある質問」へ足し、`npm --prefix functions run sync-shared` を回して main へマージする(オーナー承認は要らない・2026-10-16 夜。何を足したかは CHANGELOG と記録で分かる)。仕様が無い・曖昧な QA だけは足さず「要確認」として返す。',
  '整理した受付番号は docs/qa-curation-log.md に書く(次回のパックに載らない)。このパックには生徒名が含まれるので、リポジトリ・Issue・公開ログへ貼らない。',
].join('\n')

export function parseArgs(argv) {
  const options = { workspaceKey: '', project: DEFAULT_PROJECT_ID, since: '', classroomId: '', all: false, outDir: DEFAULT_OUT_DIR, logPath: DEFAULT_LOG_PATH, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--workspace') options.workspaceKey = String(argv[index + 1] ?? '').trim(), index += 1
    else if (arg === '--project') options.project = String(argv[index + 1] ?? '').trim(), index += 1
    else if (arg === '--since') options.since = String(argv[index + 1] ?? '').trim(), index += 1
    else if (arg === '--classroom') options.classroomId = String(argv[index + 1] ?? '').trim(), index += 1
    else if (arg === '--out') options.outDir = String(argv[index + 1] ?? '').trim(), index += 1
    else if (arg === '--log') options.logPath = String(argv[index + 1] ?? '').trim(), index += 1
    else if (arg === '--all') options.all = true
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  if (!options.workspaceKey) errors.push('--workspace <key> は必須です。')
  if (options.since && !/^\d{4}-\d{2}-\d{2}$/.test(options.since)) errors.push('--since は YYYY-MM-DD で指定してください。')
  return errors
}

/** 整理済みの受付番号を docs/qa-curation-log.md から読む(表の 1 列目。`20261015-151056959-a8890098` の形)。 */
export function parseCurationLog(markdown) {
  const ids = new Set()
  for (const line of String(markdown ?? '').split('\n')) {
    const match = /^\|\s*`?(\d{8}-\d{9}-[0-9a-f]{6,12})`?\s*\|/u.exec(line)
    if (match) ids.add(match[1])
  }
  return ids
}

/** 報告 1 件を、パックに載せる形へ整える(文字列化・無い項目は空)。 */
export function toDigestReport(raw) {
  const str = (value) => (typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value))
  const reportId = str(raw.reportId) || String(raw.documentPath ?? '').split('/').pop() || ''
  return {
    reportId,
    recordedAt: str(raw.recordedAt) || str(raw.reportedAt),
    classroomId: str(raw.classroomId),
    classroomName: str(raw.classroomName),
    category: str(raw.category) || 'bug',
    isTest: raw.isTest === true,
    isVerificationChecklist: raw.isVerificationChecklist === true || /^\[確認リスト/u.test(str(raw.note)),
    note: str(raw.note),
    screen: str(raw.screen),
    source: str(raw.source),
    aiAnswer: str(raw.aiAnswer),
    aiAnswerError: str(raw.aiAnswerError),
    aiAnswerBlocked: str(raw.aiAnswerBlocked),
    aiAnswerModel: str(raw.aiAnswerModel),
    aiAnswerShadow: str(raw.aiAnswerShadow),
    aiAnswerShadowModel: str(raw.aiAnswerShadowModel),
    aiAnswerDigestStudents: Array.isArray(raw.aiAnswerDigestStudents) ? raw.aiAnswerDigestStudents.map(str).filter(Boolean) : [],
    answerFinal: str(raw.answerFinal),
    answeredAt: str(raw.answeredAt),
    resolvedAt: str(raw.resolvedAt),
    issueNumber: typeof raw.issueNumber === 'number' && Number.isFinite(raw.issueNumber) ? raw.issueNumber : null,
  }
}

/** パックに載せる報告を選ぶ: 質問・要望だけ、テスト・確認リスト・整理済みを除き、期間で絞り、古い順に並べる。 */
export function selectReportsForQaDigest(reports, options) {
  const { sinceIso = '', processedIds = new Set(), includeAll = false } = options ?? {}
  return reports
    .filter((report) => report.reportId && !report.isTest && !report.isVerificationChecklist)
    .filter((report) => report.category === 'question' || report.category === 'request')
    .filter((report) => includeAll || !processedIds.has(report.reportId))
    .filter((report) => !sinceIso || report.recordedAt >= sinceIso)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.reportId.localeCompare(right.reportId))
}

/** 件数の要約(種別・AI の結果・開発者の回答の有無)。 */
export function summarizeQaDigest(reports) {
  const summary = { total: reports.length, question: 0, request: 0, aiAnswered: 0, aiFailed: 0, aiNotCalled: 0, developerAnswered: 0, resolved: 0, aiAndDeveloperBoth: 0 }
  for (const report of reports) {
    if (report.category === 'question') summary.question += 1
    if (report.category === 'request') summary.request += 1
    if (report.aiAnswer) summary.aiAnswered += 1
    else if (report.aiAnswerError) summary.aiFailed += 1
    else summary.aiNotCalled += 1
    if (report.answerFinal) summary.developerAnswered += 1
    if (report.resolvedAt) summary.resolved += 1
    if (report.aiAnswer && report.answerFinal) summary.aiAndDeveloperBoth += 1
  }
  return summary
}

function quote(text) {
  return String(text).split('\n').map((line) => `> ${line}`).join('\n')
}

function formatJst(iso) {
  if (!iso) return '(不明)'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const pad = (value) => String(value).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
}

function describeReport(report) {
  const lines = [
    `### ${report.reportId} — ${CATEGORY_LABELS[report.category] ?? report.category} / ${report.classroomName || report.classroomId || '(教室不明)'} / ${formatJst(report.recordedAt)}`,
    '',
    `状態: ${report.resolvedAt ? '解決済み' : report.answerFinal ? '開発者が回答済み' : '未回答'}${report.issueNumber !== null ? ` / Issue #${report.issueNumber}` : ''}${report.screen ? ` / 画面 ${report.screen}` : ''}`,
    '',
    '利用者の文:',
    quote(report.note || '(本文なし)'),
    '',
  ]
  if (report.aiAnswer) {
    lines.push(`AI の回答(室長に表示・${report.aiAnswerModel || 'モデル不明'}${report.aiAnswerDigestStudents.length > 0 ? `・数字を渡した生徒 ${report.aiAnswerDigestStudents.length} 人` : ''}):`, quote(report.aiAnswer), '')
  } else if (report.aiAnswerError) {
    lines.push(`AI は答えられなかった: ${report.aiAnswerError}`)
    if (report.aiAnswerBlocked) lines.push('', '止めた回答(室長には未表示):', quote(report.aiAnswerBlocked))
    lines.push('')
  }
  if (report.aiAnswerShadow) lines.push(`比較用(${report.aiAnswerShadowModel || '影'})の回答:`, quote(report.aiAnswerShadow), '')
  if (report.answerFinal) lines.push(`開発者の回答(${formatJst(report.answeredAt)}):`, quote(report.answerFinal), '')
  return lines
}

/** パック本体(Markdown)。先頭に指示文、次に要約、最優先の「AI が答えられなかった質問」、残りの報告、最後に記録用の表の雛形。 */
export function buildQaDigestMarkdown(reports, meta) {
  const summary = summarizeQaDigest(reports)
  const lines = [
    QA_CURATION_INSTRUCTIONS,
    '',
    '---',
    '',
    `# QA 候補パック(${meta.workspaceKey}・${meta.sinceLabel ?? '全期間'}・作成 ${formatJst(meta.generatedAt)})`,
    '',
    `- 件数 ${summary.total}(質問 ${summary.question}・要望 ${summary.request})。整理済み・テスト・確認リストは除いてある。`,
    `- AI 即時回答: 表示 ${summary.aiAnswered} / 答えられなかった ${summary.aiFailed} / 呼んでいない(本番教室・要望など) ${summary.aiNotCalled}`,
    `- 開発者の回答あり ${summary.developerAnswered}(うち AI の回答も両方あり ${summary.aiAndDeveloperBoth} → 食い違いを見る)/ 解決済み ${summary.resolved}`,
    '',
  ]
  const unanswered = reports.filter((report) => report.category === 'question' && !report.aiAnswer)
  lines.push(`## 最優先: AI が答えられなかった・呼べなかった質問(${unanswered.length} 件)`, '')
  if (unanswered.length === 0) lines.push('(なし)', '')
  for (const report of unanswered) lines.push(...describeReport(report))
  const rest = reports.filter((report) => !unanswered.includes(report))
  lines.push(`## そのほかの質問・要望(${rest.length} 件・古い順)`, '')
  if (rest.length === 0) lines.push('(なし)', '')
  for (const report of rest) lines.push(...describeReport(report))
  lines.push('## 記録用(整理が終わったら docs/qa-curation-log.md へ写す)', '', '| 受付番号 | 処理日 | 結果 | 反映先 |', '|---|---|---|---|')
  for (const report of reports) lines.push(`| \`${report.reportId}\` | ${meta.generatedAt.slice(0, 10)} | (QA 追加／本文修正／要望 Issue／保留／対象外) | |`)
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 以下は Firestore を読む部分(tools/verification-checklist-report.mjs と同じ作法・読み取りだけ)
// ---------------------------------------------------------------------------

function accessToken() {
  if (process.env.FIRESTORE_ACCESS_TOKEN) return process.env.FIRESTORE_ACCESS_TOKEN.trim()
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

// 複合インデックスを要求しないよう、絞り込みは classroomId の等価だけ(無ければ全件)。期間・種別は取得後にクライアント側で絞る。
export function buildRunQueryBody({ classroomId }) {
  return {
    structuredQuery: {
      from: [{ collectionId: 'developerReports' }],
      ...(classroomId ? { where: { fieldFilter: { field: { fieldPath: 'classroomId' }, op: 'EQUAL', value: { stringValue: classroomId } } } } : {}),
      limit: 1000,
    },
  }
}

async function firestoreRunQuery(project, workspaceKey, token, body) {
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/workspaces/${workspaceKey}:runQuery`
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Firestore runQuery failed: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}

function parseRunQueryResponse(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => row && row.document && row.document.fields).map((row) => ({ documentPath: row.document.name, ...decodeFirestoreFields(row.document.fields) }))
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
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const sinceIso = options.since ? new Date(`${options.since}T00:00:00.000Z`).toISOString() : new Date(Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let processedIds = new Set()
  try {
    processedIds = parseCurationLog(readFileSync(resolve(repoRoot, options.logPath), 'utf8'))
  } catch {
    console.warn(`[qa-digest] 記録 ${options.logPath} が読めないので、整理済みの除外なしで作ります`)
  }
  const token = accessToken()
  const raw = await firestoreRunQuery(options.project, options.workspaceKey, token, buildRunQueryBody({ classroomId: options.classroomId }))
  const reports = selectReportsForQaDigest(parseRunQueryResponse(raw).map(toDigestReport), { sinceIso, processedIds, includeAll: options.all })
  const generatedAt = new Date().toISOString()
  const markdown = buildQaDigestMarkdown(reports, { workspaceKey: options.workspaceKey, sinceLabel: `${sinceIso.slice(0, 10)} 以降`, generatedAt })
  const outDir = resolve(repoRoot, options.outDir)
  mkdirSync(outDir, { recursive: true })
  const outPath = resolve(outDir, `qa-digest-${generatedAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')}.md`)
  writeFileSync(outPath, markdown, 'utf8')
  const summary = summarizeQaDigest(reports)
  console.log(`[qa-digest] ${summary.total} 件(質問 ${summary.question}・要望 ${summary.request}・AI が答えられなかった質問 ${reports.filter((r) => r.category === 'question' && !r.aiAnswer).length})→ ${outPath}`)
  console.log('[qa-digest] このファイルは生徒名を含みます。リポジトリ・Issue・公開ログへ貼らないでください。')
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`[qa-digest] 失敗: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
