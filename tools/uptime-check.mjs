// 本番(と任意で staging)の主要エンドポイントを外形監視するスクリプト。
// GitHub Actions のスケジュール実行から使う(docs/runbooks/monitoring.md)。
//
// チェック内容:
//   1. hosting index (/) が 200
//   2. version.json が取得でき、JSON として version を持つ
//   3. QR提出 API (/api/submission/) が到達可能(403/5xx/接続不可は異常。400 は引数なしの正常応答)
//
// 一時的なネットワーク瞬断(GitHub Runner→Firebase Hosting の 15s タイムアウト等)で
// 赤くならないよう、問題があれば最大 ATTEMPTS 回まで再試行し、最後の試行でも問題が
// 残る場合だけ異常と判定する(連続失敗のみを異常扱い=誤報の抑制)。
//
// 異常が1つでもあれば exit 1(= ワークフロー赤)。結果サマリを標準出力と
// GITHUB_STEP_SUMMARY / GITHUB_OUTPUT(report) に書く。

import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TARGETS = [
  { name: 'prod', base: 'https://komahyouapp-prod.web.app' },
]
// staging も監視したい場合は MONITOR_STAGING=1 を渡す。
if ((process.env.MONITOR_STAGING || '').trim() === '1') {
  TARGETS.push({ name: 'staging', base: 'https://komahyouapp-staging.web.app' })
}

const TIMEOUT_MS = 15000
// 一時的な瞬断で誤検知しないための連続失敗回数。1回目で失敗しても RETRY_DELAY_MS 後に再確認し、
// 最後の試行でも問題が残る場合だけ異常扱いにする。CI から上書き可能(既定=3回)。
const ATTEMPTS = Number(process.env.UPTIME_ATTEMPTS) || 3
const RETRY_DELAY_MS = process.env.UPTIME_RETRY_DELAY_MS ? Number(process.env.UPTIME_RETRY_DELAY_MS) : 3000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchStatus(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
    return { ok: true, status: res.status, body: res }
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

// 対象を 1 回だけ確認する(3項目)。再試行なし。
export async function checkOnce(target, { fetchStatusFn = fetchStatus } = {}) {
  const problems = []
  const details = []

  // 1. index
  const index = await fetchStatusFn(`${target.base}/`)
  if (!index.ok || index.status !== 200) {
    problems.push(`index が異常 (status=${index.status}${index.error ? `, ${index.error}` : ''})`)
  }
  details.push(`index=${index.status || index.error}`)

  // 2. version.json
  const ver = await fetchStatusFn(`${target.base}/version.json`)
  let versionText = '?'
  if (!ver.ok || ver.status !== 200) {
    problems.push(`version.json が異常 (status=${ver.status}${ver.error ? `, ${ver.error}` : ''})`)
  } else {
    try {
      const json = await ver.body.json()
      if (!json || typeof json.version !== 'string') {
        problems.push('version.json に version がない')
      } else {
        versionText = json.version
      }
    } catch {
      problems.push('version.json が JSON として壊れている')
    }
  }
  details.push(`version=${versionText}`)

  // 3. submission API (到達性。400=引数なしの正常応答なので OK 扱い)
  const api = await fetchStatusFn(`${target.base}/api/submission/`)
  const apiBad = !api.ok || api.status === 403 || api.status >= 500 || api.status === 0
  if (apiBad) {
    problems.push(`submission API が異常 (status=${api.status}${api.error ? `, ${api.error}` : ''})`)
  }
  details.push(`api=${api.status || api.error}`)

  return { name: target.name, ok: problems.length === 0, problems, summary: details.join(' ') }
}

// 一時的な瞬断で赤くしないため、問題があれば最大 attempts 回まで再試行し、
// 最初に成功した(problems なし)結果を採用する。最後まで問題が残れば最終結果を返す。
export async function checkTarget(
  target,
  { fetchStatusFn = fetchStatus, attempts = ATTEMPTS, retryDelayMs = RETRY_DELAY_MS, sleepFn = sleep } = {},
) {
  const safeAttempts = Math.max(1, Math.floor(attempts))
  let last
  for (let i = 1; i <= safeAttempts; i++) {
    last = await checkOnce(target, { fetchStatusFn })
    if (last.ok) return { ...last, attempts: i }
    if (i < safeAttempts) await sleepFn(retryDelayMs)
  }
  return { ...last, attempts: safeAttempts }
}

export function buildReport(results) {
  const lines = results.map(
    (r) => `${r.ok ? '✅' : '❌'} [${r.name}] ${r.summary}${r.problems.length ? ` -- ${r.problems.join(' / ')}` : ''}${r.ok && r.attempts > 1 ? ` (${r.attempts}回目で回復)` : ''}`,
  )
  return { lines, report: lines.join('\n'), allOk: results.every((r) => r.ok) }
}

async function main() {
  const results = await Promise.all(TARGETS.map((t) => checkTarget(t)))
  const { lines, report, allOk } = buildReport(results)
  console.log(report)

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 外形監視結果\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`)
  }
  if (process.env.GITHUB_OUTPUT) {
    // 複数行を output に渡す(heredoc 形式)
    appendFileSync(process.env.GITHUB_OUTPUT, `report<<__REPORT__\n${report}\n__REPORT__\n`)
    appendFileSync(process.env.GITHUB_OUTPUT, `ok=${allOk ? 'true' : 'false'}\n`)
  }

  process.exitCode = allOk ? 0 : 1
}

// CLI として直接実行されたときだけ監視を走らせる(テストから import しても実行されない)。
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
