// 開発ダッシュボードの「Issue を閉じる」(2026-11-03 オーナー指示・確認リスト v1.5.672 d-5)のクライアント側。
// callable `closeGitHubIssue`(requireDeveloperMember・このアプリのリポジトリの Issue だけ・PR は断る)を呼ぶだけ。
// ブラウザは GitHub のトークンを持たない(トークンは Cloud Functions の runtime env だけ)。Firestore には書かない。
import { httpsCallable } from 'firebase/functions'

import { ensureFirebaseAuthenticatedUser, getFirebaseFunctionsInstance } from './client'
import { getFirebaseBackendConfig } from './config'

export type CloseGitHubIssueReason = 'completed' | 'not_planned'
export type CloseGitHubIssueResult = { issueNumber: number; closed: boolean; alreadyClosed: boolean; closedAt: string }

const CLOSE_GITHUB_ISSUE_TIMEOUT_MS = 30_000

export async function closeGitHubIssueViaFunction(input: { issueNumber: number; reason: CloseGitHubIssueReason }): Promise<CloseGitHubIssueResult> {
  await ensureFirebaseAuthenticatedUser()
  const functions = getFirebaseFunctionsInstance()
  if (!functions) throw new Error('サーバーに接続できません。通信状態を確認してください。')
  const config = getFirebaseBackendConfig()
  const callable = httpsCallable<{ workspaceKey: string; issueNumber: number; reason: CloseGitHubIssueReason }, unknown>(functions, 'closeGitHubIssue', { timeout: CLOSE_GITHUB_ISSUE_TIMEOUT_MS })
  const result = await callable({ workspaceKey: config.workspaceKey, issueNumber: input.issueNumber, reason: input.reason })
  const data = typeof result.data === 'object' && result.data !== null ? (result.data as Record<string, unknown>) : {}
  return {
    issueNumber: typeof data.issueNumber === 'number' ? data.issueNumber : input.issueNumber,
    closed: data.closed === true,
    alreadyClosed: data.alreadyClosed === true,
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : '',
  }
}
