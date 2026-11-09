#!/usr/bin/env node
// 保証台帳(docs/spec-invariants.md)に違反している状態を、1 教室の教室データから洗い出す読み取り専用ツール。
//
// ★なぜ作ったか(2026-11-09・オーナー確定)
//   室長からの曖昧な連絡やバグのとき、影響した生徒を全員見つけて正しく処理するため。洗い出しの物差しは
//   「決めつけずに保証台帳に違反しているものがバグ」と「休日に設定した日に残る授業はバグ」。毎朝の健診
//   (docs/runbooks/morning-health-check.md §4)で、教室別バックアップに当てる。
//
// ★判定はアプリの権威関数(tools/invAuditEntry.ts が束ねて呼ぶ)。ここは引数・ファイル読み・出力の整形だけ。
//   ルール: INV-12(同じコマに同じ生徒が 2 か所)・INV-06(在庫が負／根拠を失った振替)・HOLIDAY(休日に授業)・
//   INV-01(講師日程表で 2 人の講師に出る)・INV-13(保留の下段が日程表に出る)・INV-08(写しトークンの教室違い)・INV-14(教室データの欠け)。
//
// ★読み取り専用(本番データ保護ルール準拠)
//   - ネットワークへは一切アクセスしない。入力は手元のファイルだけ。
//   - 書くのは esbuild の束ね先(node_modules/.cache/inv-audit-*)だけで、終わったら消す。
//   - ★出力に生徒名・講師名を出さない(ID だけ)。--show-names のときだけ名簿の名前を添える(その出力はスクラッチ領域にだけ置く)。
//
// 使い方:
//   node tools/inv-audit.mjs <教室ファイル> --classroom <id> [--today YYYY-MM-DD] [--known <json>] [--json] [--show-names]
//   - 教室ファイル: 教室別バックアップ({classroomId}.json.gz)・教室の版履歴・バックアップ書き出しの JSON(gzip 可)。
//     形の判定と教室の取り出しは tools/snapshot-diff.mjs と同じ。
//   - --today: これより前の日付を「今日より前」に数える(既定は JST の今日)。
//   - --known: 既知の除外 [{ rule, classroomId, dateKey, slotNumber, studentId, note }](tools/board-health-known-issues.json)。
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isInvokedDirectly } from './invoked-directly.mjs'
import { decodeJsonBuffer, extractClassroomSnapshot } from './snapshot-diff.mjs'

export const USAGE = '使い方: node tools/inv-audit.mjs <教室ファイル> --classroom <id> [--today YYYY-MM-DD] [--known <json>] [--json] [--show-names]'

const ENTRY_PATH = path.join(import.meta.dirname, 'invAuditEntry.ts')
const REPO_ROOT = path.join(import.meta.dirname, '..')

const VALUE_FLAGS = { '--classroom': 'classroomId', '--today': 'today', '--known': 'knownFile' }

export function parseArgs(argv) {
  const options = { files: [], classroomId: '', today: '', knownFile: '', json: false, showNames: false, help: false, unknown: [], missingValue: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--json') { options.json = true; continue }
    if (arg === '--show-names') { options.showNames = true; continue }
    if (VALUE_FLAGS[arg]) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) { options.missingValue.push(arg); continue }
      options[VALUE_FLAGS[arg]] = value
      index += 1
      continue
    }
    if (arg.startsWith('--')) { options.unknown.push(arg); continue }
    options.files.push(arg)
  }
  return options
}

export function validateArgs(options) {
  const errors = []
  for (const flag of options.unknown ?? []) errors.push(`知らないオプションです: ${flag}`)
  for (const flag of options.missingValue ?? []) errors.push(`${flag} の値がありません。`)
  if (!options.classroomId) errors.push('--classroom を指定してください。')
  if (options.files.length !== 1) errors.push(`教室のファイルを 1 つ指定してください(指定 ${options.files.length} 個)。`)
  if (options.today && !/^\d{4}-\d{2}-\d{2}$/.test(options.today)) errors.push('--today は YYYY-MM-DD で指定してください。')
  return errors
}

/** JST の今日(YYYY-MM-DD)。 */
export function jstToday(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const RULE_ORDER = ['INV-12', 'INV-06', 'HOLIDAY', 'INV-01', 'INV-13', 'INV-08', 'INV-14']

/**
 * 文字の出力。1 行目に教室と件数の要約、続けて今日以降 → 今日より前の順に 1 件 1 行。
 * studentNames(Map<生徒ID, 名前>)を渡したときだけ名前を添える(--show-names)。
 */
export function formatInvAuditText(result, options = {}) {
  const label = options.classroomLabel ?? ''
  const rules = RULE_ORDER.filter((rule) => (result.counts[rule] ?? 0) > 0)
  const summary = rules.length === 0
    ? '保証台帳の違反: なし'
    : `保証台帳の違反: ${rules.map((rule) => `${rule} ${result.counts[rule]} 件(今日以降 ${result.counts[`${rule}.future`]} 件)`).join('・')}`
  const knownText = result.counts.known > 0 ? `(既知 ${result.counts.known} 件を除く)` : ''
  const lines = [`■ ${label}${options.today ? `(${options.today} 時点)` : ''}: ${summary}${knownText}`]
  const nameOf = (finding) => {
    if (!options.studentNames || !finding.studentId) return ''
    const name = options.studentNames.get(finding.studentId)
    return name ? ` 〔${name}〕` : ''
  }
  for (const [period, heading] of [['future', '--- 今日以降 ---'], ['past', '--- 今日より前 ---']]) {
    const items = result.findings.filter((finding) => finding.period === period)
    if (items.length === 0) continue
    lines.push(heading)
    for (const finding of items) lines.push(`[${finding.severity}] ${finding.rule} ${finding.message}${nameOf(finding)}`)
  }
  for (const note of result.notes ?? []) lines.push(`注: ${note}`)
  return lines.join('\n')
}

/** invAuditEntry.ts を束ねて読み込む(アプリの @company 別名と import.meta.env を vite と同じに当てる)。 */
export async function loadAuditor() {
  const { build } = await import('esbuild')
  // 依存パッケージは external のままにするので、repo の node_modules から解決できる場所(node_modules/.cache)へ置く。
  const cacheRoot = path.join(REPO_ROOT, 'node_modules', '.cache')
  mkdirSync(cacheRoot, { recursive: true })
  const outDir = await mkdtemp(path.join(cacheRoot, 'inv-audit-'))
  const cleanup = () => rm(outDir, { recursive: true, force: true })
  try {
    const outfile = path.join(outDir, 'audit.mjs')
    await build({
      entryPoints: [ENTRY_PATH],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      logLevel: 'silent',
      loader: { '.css': 'empty' },
      // qrcode / xlsx などの CJS パッケージはバンドルすると dynamic require で落ちるため外に出す(vanished-makeup-report と同じ)。
      packages: 'external',
      alias: { '@company': path.join(REPO_ROOT, 'src', 'company') },
      // vite の import.meta.env が無いとアプリの会社設定の読み込みで落ちる。既定の会社(env なし)として読む。
      define: { 'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }) },
    })
    const module = await import(pathToFileURL(outfile).href)
    return { auditClassroomSnapshot: module.auditClassroomSnapshot, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

function readKnownFile(file) {
  if (!file) return []
  const value = decodeJsonBuffer(readFileSync(file))
  return Array.isArray(value) ? value : []
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
  let auditor = null
  try {
    const [file] = options.files
    const snapshot = extractClassroomSnapshot(decodeJsonBuffer(readFileSync(file)), { file: path.basename(file), classroomId: options.classroomId })
    if (snapshot.classroomId && snapshot.classroomId !== options.classroomId) {
      throw new Error(`${file} は教室 ${snapshot.classroomId} のデータです(--classroom ${options.classroomId} と一致しません)。`)
    }
    const today = options.today || jstToday()
    auditor = await loadAuditor()
    const result = auditor.auditClassroomSnapshot({ classroomId: options.classroomId, payload: snapshot.payload, today, known: readKnownFile(options.knownFile) })
    const studentNames = options.showNames
      ? new Map((Array.isArray(snapshot.payload.students) ? snapshot.payload.students : []).map((student) => [student.id, student.name]))
      : null
    if (options.showNames) console.error('注意: --show-names の出力には生徒名が入ります。スクラッチ領域にだけ置き、リポジトリ・Issue・報告に貼らないでください。')
    if (options.json) {
      const output = studentNames
        ? { ...result, findings: result.findings.map((finding) => ({ ...finding, ...(finding.studentId && studentNames.get(finding.studentId) ? { name: studentNames.get(finding.studentId) } : {}) })) }
        : result
      console.log(JSON.stringify({ classroomId: options.classroomId, today, ...output }, null, 2))
    } else {
      console.log(formatInvAuditText(result, { classroomLabel: options.classroomId, today, studentNames }))
    }
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    if (auditor) await auditor.cleanup()
  }
}

// import しただけでは何も実行しない(テストから純関数だけを読むため・tools/invoked-directly.mjs)。
if (isInvokedDirectly(import.meta.url)) {
  await main()
}
