// 外形監視スクリプトの回帰防止テスト。
// 主目的: 一時的なネットワーク瞬断(version.json が status=0 で abort など)で
// 誤って異常(赤=incident 起票+失敗メール)にしないこと。実ネットワークは使わず
// fetchStatusFn を注入してリトライ挙動を検証する。
import { describe, it, expect } from 'vitest'
import { checkOnce, checkTarget, buildReport } from './uptime-check.mjs'

const target = { name: 'prod', base: 'https://example.test' }

// URL ごとに応答を返す偽 fetchStatus を作る。各 URL に対して配列を渡すと
// 呼ばれるたびに次の応答を返す(試行ごとに結果を変えられる)。
function makeFetcher(responsesByPath) {
  const queues = new Map(
    Object.entries(responsesByPath).map(([path, list]) => [path, [...list]]),
  )
  return async (url) => {
    const path = url.replace(target.base, '')
    const queue = queues.get(path)
    if (!queue || queue.length === 0) throw new Error(`no stub for ${path}`)
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return next
  }
}

const ok200 = { ok: true, status: 200, body: null }
const versionOk = { ok: true, status: 200, body: { json: async () => ({ version: '1.2.3' }) } }
const api400 = { ok: true, status: 400 } // 引数なしの正常応答
const aborted = { ok: false, status: 0, error: 'This operation was aborted' }

const noSleep = async () => {}

describe('checkTarget リトライ(誤報抑制)', () => {
  it('全項目正常なら1回で健全', async () => {
    const fetchStatusFn = makeFetcher({
      '/': [ok200],
      '/version.json': [versionOk],
      '/api/submission/': [api400],
    })
    const r = await checkTarget(target, { fetchStatusFn, sleepFn: noSleep })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(1)
  })

  it('1回目だけ version.json が瞬断(status=0)→2回目で回復すれば健全(誤報を出さない)', async () => {
    // これがまさに Issue #50 の状況: index=200 / version=status0 abort / api=400。
    const fetchStatusFn = makeFetcher({
      '/': [ok200, ok200],
      '/version.json': [aborted, versionOk],
      '/api/submission/': [api400, api400],
    })
    const r = await checkTarget(target, { fetchStatusFn, attempts: 3, sleepFn: noSleep })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
    expect(r.problems).toEqual([])
  })

  it('全試行で異常が続くなら異常(=本当の障害は検知する)', async () => {
    const fetchStatusFn = makeFetcher({
      '/': [ok200],
      '/version.json': [aborted], // 常に瞬断
      '/api/submission/': [api400],
    })
    const r = await checkTarget(target, { fetchStatusFn, attempts: 3, sleepFn: noSleep })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(3)
    expect(r.problems.join(' ')).toContain('version.json が異常')
  })

  it('submission API が 403/5xx/接続不可なら異常(400 は正常扱い)', async () => {
    const bad = await checkOnce(target, {
      fetchStatusFn: makeFetcher({
        '/': [ok200],
        '/version.json': [versionOk],
        '/api/submission/': [{ ok: true, status: 503 }],
      }),
    })
    expect(bad.ok).toBe(false)
    expect(bad.problems.join(' ')).toContain('submission API')

    const good = await checkOnce(target, {
      fetchStatusFn: makeFetcher({
        '/': [ok200],
        '/version.json': [versionOk],
        '/api/submission/': [api400],
      }),
    })
    expect(good.ok).toBe(true)
  })
})

describe('buildReport', () => {
  it('健全/異常の集約と回復回数の注記', () => {
    const { report, allOk } = buildReport([
      { name: 'prod', ok: true, problems: [], summary: 'index=200 version=1.2.3 api=400', attempts: 2 },
    ])
    expect(allOk).toBe(true)
    expect(report).toContain('✅ [prod]')
    expect(report).toContain('2回目で回復')

    const bad = buildReport([
      { name: 'prod', ok: false, problems: ['version.json が異常'], summary: 'x', attempts: 3 },
    ])
    expect(bad.allOk).toBe(false)
    expect(bad.report).toContain('❌ [prod]')
  })
})
