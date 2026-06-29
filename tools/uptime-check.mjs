// 本番(と任意で staging)の主要エンドポイントを外形監視するスクリプト。
// GitHub Actions のスケジュール実行から使う(docs/runbooks/monitoring.md)。
//
// チェック内容:
//   1. hosting index (/) が 200
//   2. version.json が取得でき、JSON として version を持つ
//   3. QR提出 API (/api/submission/) が到達可能(403/5xx/接続不可は異常。400 は引数なしの正常応答)
//
// 異常が1つでもあれば exit 1(= ワークフロー赤)。結果サマリを標準出力と
// GITHUB_STEP_SUMMARY / GITHUB_OUTPUT(report) に書く。

import { appendFileSync } from 'node:fs'

const TARGETS = [
  { name: 'prod', base: 'https://komahyouapp-prod.web.app' },
]
// STScheck staging も監視したい場合は MONITOR_STAGING=1 を渡す。
if ((process.env.MONITOR_STAGING || '').trim() === '1') {
  TARGETS.push({ name: 'staging', base: 'https://komahyouapp-staging.web.app' })
}

const TIMEOUT_MS = 15000

async function fetchStatus(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    return { ok: true, status: res.status, body: res }
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

async function checkTarget(target) {
  const problems = []
  const details = []

  // 1. index
  const index = await fetchStatus(`${target.base}/`)
  if (!index.ok || index.status !== 200) {
    problems.push(`index が異常 (status=${index.status}${index.error ? `, ${index.error}` : ''})`)
  }
  details.push(`index=${index.status || index.error}`)

  // 2. version.json
  const ver = await fetchStatus(`${target.base}/version.json`)
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
  const api = await fetchStatus(`${target.base}/api/submission/`)
  const apiBad = !api.ok || api.status === 403 || api.status >= 500 || api.status === 0
  if (apiBad) {
    problems.push(`submission API が異常 (status=${api.status}${api.error ? `, ${api.error}` : ''})`)
  }
  details.push(`api=${api.status || api.error}`)

  return { name: target.name, ok: problems.length === 0, problems, summary: details.join(' ') }
}

const results = await Promise.all(TARGETS.map(checkTarget))
const allOk = results.every((r) => r.ok)

const lines = results.map((r) => `${r.ok ? '✅' : '❌'} [${r.name}] ${r.summary}${r.problems.length ? ` -- ${r.problems.join(' / ')}` : ''}`)
const report = lines.join('\n')
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
