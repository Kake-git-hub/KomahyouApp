// 開発ダッシュボードの「Issue を閉じる」(callable closeGitHubIssue)の純粋ロジック(2026-11-03・確認リスト v1.5.672 d-5)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  GITHUB_ISSUE_CLOSE_REPOSITORY,
  buildCloseIssueRequest,
  buildGetIssueRequest,
  interpretCloseIssueResponse,
  interpretGetIssueResponse,
  normalizeCloseGitHubIssueRequest,
  readGitHubIssueCloseToken,
} from './githubIssueClose'

const INDEX_TS = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

describe('normalizeCloseGitHubIssueRequest', () => {
  it('workspaceKey と正の整数の Issue 番号だけを受け付ける。理由の既定は completed', () => {
    expect(normalizeCloseGitHubIssueRequest({ workspaceKey: 'main', issueNumber: 62 })).toEqual({ ok: true, value: { workspaceKey: 'main', issueNumber: 62, reason: 'completed' } })
    expect(normalizeCloseGitHubIssueRequest({ workspaceKey: 'main', issueNumber: 62, reason: 'not_planned' })).toEqual({ ok: true, value: { workspaceKey: 'main', issueNumber: 62, reason: 'not_planned' } })
    expect(normalizeCloseGitHubIssueRequest({ workspaceKey: '', issueNumber: 62 }).ok).toBe(false)
    expect(normalizeCloseGitHubIssueRequest({ workspaceKey: 'main', issueNumber: '62' }).ok).toBe(false)
    expect(normalizeCloseGitHubIssueRequest({ workspaceKey: 'main', issueNumber: 0 }).ok).toBe(false)
    expect(normalizeCloseGitHubIssueRequest({ workspaceKey: 'main', issueNumber: 1.5 }).ok).toBe(false)
    expect(normalizeCloseGitHubIssueRequest({ workspaceKey: 'main', issueNumber: 62, reason: 'reopen' }).ok).toBe(false)
    expect(normalizeCloseGitHubIssueRequest(null).ok).toBe(false)
  })

  it('リポジトリ名は入力から受け取らない(画面から別のリポジトリを指せない)', () => {
    const parsed = normalizeCloseGitHubIssueRequest({ workspaceKey: 'main', issueNumber: 5, repository: 'someone/else' })
    expect(parsed).toEqual({ ok: true, value: { workspaceKey: 'main', issueNumber: 5, reason: 'completed' } })
    expect(buildCloseIssueRequest('t', 5, 'completed').url).toBe(`https://api.github.com/repos/${GITHUB_ISSUE_CLOSE_REPOSITORY}/issues/5`)
  })
})

describe('GitHub への要求', () => {
  it('トークンは env の ISSUE_CLOSE_TOKEN(空白は外す・無ければ空)', () => {
    expect(readGitHubIssueCloseToken({ ISSUE_CLOSE_TOKEN: '  abc \n' })).toBe('abc')
    expect(readGitHubIssueCloseToken({})).toBe('')
  })

  it('GET で状態を見てから PATCH で state=closed と理由を送る', () => {
    const get = buildGetIssueRequest('tok', 62)
    expect(get.init.method).toBe('GET')
    expect(get.init.headers.Authorization).toBe('Bearer tok')
    const close = buildCloseIssueRequest('tok', 62, 'not_planned')
    expect(close.init.method).toBe('PATCH')
    expect(JSON.parse(close.init.body ?? '{}')).toEqual({ state: 'closed', state_reason: 'not_planned' })
  })
})

describe('応答の読み方', () => {
  it('開いた Issue だけ閉じに行く。PR・閉じ済み・見つからない・権限なしは閉じない', () => {
    expect(interpretGetIssueResponse(200, { state: 'open' })).toEqual({ action: 'close' })
    expect(interpretGetIssueResponse(200, { state: 'closed' })).toEqual({ action: 'already-closed' })
    expect(interpretGetIssueResponse(200, { state: 'open', pull_request: { url: 'x' } })).toMatchObject({ action: 'reject', code: 'failed-precondition' })
    expect(interpretGetIssueResponse(404, {})).toMatchObject({ action: 'reject', code: 'not-found' })
    expect(interpretGetIssueResponse(401, {})).toMatchObject({ action: 'reject', code: 'permission-denied' })
    expect(interpretGetIssueResponse(500, {})).toMatchObject({ action: 'reject', code: 'internal' })
  })

  it('PATCH の成功は closed_at を返す。失敗は理由つき', () => {
    expect(interpretCloseIssueResponse(200, { closed_at: '2026-11-03T10:00:00Z' })).toEqual({ ok: true, closedAt: '2026-11-03T10:00:00Z' })
    expect(interpretCloseIssueResponse(403, {})).toMatchObject({ ok: false, code: 'permission-denied' })
    expect(interpretCloseIssueResponse(422, {})).toMatchObject({ ok: false, code: 'internal' })
  })
})

describe('callable closeGitHubIssue の配線(index.ts)', () => {
  const start = INDEX_TS.indexOf('export const closeGitHubIssue = onCall(')
  const body = INDEX_TS.slice(start, INDEX_TS.indexOf('\n})\n', start))
  it('開発者だけが呼べ、トークンが無ければ GitHub へ行かない。Firestore には書かない', () => {
    expect(start).toBeGreaterThan(0)
    expect(body.indexOf('requireDeveloperMember(')).toBeGreaterThan(0)
    expect(body.indexOf('requireDeveloperMember(')).toBeLessThan(body.indexOf('fetch('))
    expect(body.indexOf("'token-missing'")).toBeLessThan(body.indexOf('fetch('))
    expect(body.indexOf('interpretGetIssueResponse(')).toBeLessThan(body.indexOf('buildCloseIssueRequest('))
    expect(body).not.toMatch(/firestore\.|\.set\(|\.update\(/u)
    expect(body).not.toContain('${token}')
  })
})
