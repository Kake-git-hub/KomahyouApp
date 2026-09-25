// 開発ダッシュボードのデータ取得が **読み取り専用** であることを字面で固定する(本番データ保護ルール)。
// 作法は VerificationChecklistPanel.wiring.test.ts と同じ(描画・接続の環境が無いのでソース走査で担保する)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { fetchGitHubIssues } from '../github/issues'

const STORE_TS = readFileSync(fileURLToPath(new URL('./developerReportsStore.ts', import.meta.url)), 'utf8')
const ISSUES_TS = readFileSync(fileURLToPath(new URL('../github/issues.ts', import.meta.url)), 'utf8')

describe('developerReportsStore(報告の読み取り)', () => {
  it('firebase/firestore から読み取り用の関数だけを import し、書き込み関数は import しない', () => {
    expect(STORE_TS).toContain("import { collection, doc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'")
    // コメントでの言及は許し、呼び出し(`名前(`)が無いことを見る。
    for (const forbidden of ['setDoc', 'updateDoc', 'deleteDoc', 'addDoc', 'writeBatch', 'runTransaction']) {
      expect(STORE_TS, forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\(`, 'u'))
    }
  })

  it('developerReports を recordedAt の範囲＋件数で絞って読む(全期間を読まない・複合インデックス不要の形)', () => {
    expect(STORE_TS).toContain("collection(doc(firestore, 'workspaces', config.workspaceKey), 'developerReports')")
    expect(STORE_TS).toContain("where('recordedAt', '>=', options.sinceIso), orderBy('recordedAt', 'desc'), limit(options.limit)")
  })
})

describe('GitHub Issue の読み取り', () => {
  it('公開 API を GET するだけ(トークン無し・書き込み無し)', () => {
    expect(ISSUES_TS).toContain("method: 'GET'")
    expect(ISSUES_TS).not.toMatch(/Authorization/u)
    expect(ISSUES_TS).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'/u)
  })

  it('成功時は正規化した Issue を返し、回数制限(403 + remaining 0)は理由つきで失敗する', async () => {
    const ok = await fetchGitHubIssues((async () => new Response(JSON.stringify([
      { number: 69, title: '📣 [利用者質問] 緑が丘校: 丸ごと振替', state: 'open', labels: [{ name: 'source:user-report' }] },
      { number: 31, title: 'pr', state: 'open', labels: [], pull_request: {} },
    ]), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch)
    expect(ok.map((issue) => issue.number)).toEqual([69])
    await expect(fetchGitHubIssues((async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })) as typeof fetch))
      .rejects.toThrow('回数制限')
    await expect(fetchGitHubIssues((async () => new Response('{}', { status: 500 })) as typeof fetch)).rejects.toThrow('HTTP 500')
  })
})
