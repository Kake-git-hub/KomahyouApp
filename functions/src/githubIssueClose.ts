// 開発ダッシュボードの「Issue を閉じる」(2026-11-03 オーナー指示「ダッシュボード上で Close できるようにしたい」・確認リスト v1.5.672 d-5)。
//
// callable `closeGitHubIssue` が使う純粋ロジック(入力の検査・GitHub API への要求・応答の読み方)。
//  - 閉じられるのは **このアプリのリポジトリ(GITHUB_ISSUE_CLOSE_REPOSITORY)の Issue だけ**。リポジトリ名は画面から受け取らない。
//  - プルリクエストは閉じない(issues API は PR も閉じられてしまうので、先に GET して pull_request があれば断る)。
//  - トークンは runtime env の ISSUE_CLOSE_TOKEN(同名の GitHub repository secret から(GitHub は secret 名の先頭に GITHUB_ を使えない) deploy-functions.yml が書き込む)。
//    未設定なら何もせず「未設定」と返す(画面がオーナーへ設定の手順を案内する)。値はログ・応答に出さない。
//  - 呼べるのは開発者だけ(index.ts の requireDeveloperMember)。Firestore には何も書かない。

export const GITHUB_ISSUE_CLOSE_REPOSITORY = 'Kake-git-hub/KomahyouApp'
export const GITHUB_ISSUE_CLOSE_TOKEN_ENV = 'ISSUE_CLOSE_TOKEN'
const GITHUB_API_BASE = 'https://api.github.com'

/** 閉じるときの理由。completed = 対応した／済んだ、not_planned = 対応しない。 */
export const GITHUB_ISSUE_CLOSE_REASONS = ['completed', 'not_planned'] as const
export type GitHubIssueCloseReason = (typeof GITHUB_ISSUE_CLOSE_REASONS)[number]

export type CloseGitHubIssueRequest = { workspaceKey: string; issueNumber: number; reason: GitHubIssueCloseReason }

export function normalizeCloseGitHubIssueRequest(raw: unknown): { ok: true; value: CloseGitHubIssueRequest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: '入力の形式が正しくありません。' }
  const data = raw as Record<string, unknown>
  const workspaceKey = typeof data.workspaceKey === 'string' ? data.workspaceKey.trim() : ''
  if (!workspaceKey) return { ok: false, reason: 'workspaceKey を指定してください。' }
  const issueNumber = data.issueNumber
  if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber) || issueNumber < 1 || issueNumber > 10_000_000) {
    return { ok: false, reason: 'Issue 番号が正しくありません。' }
  }
  const reason = data.reason === undefined ? 'completed' : data.reason
  if (!GITHUB_ISSUE_CLOSE_REASONS.includes(reason as GitHubIssueCloseReason)) return { ok: false, reason: '閉じる理由が正しくありません。' }
  return { ok: true, value: { workspaceKey, issueNumber, reason: reason as GitHubIssueCloseReason } }
}

/** runtime env からトークンを読む(前後の空白は外す)。無ければ空文字。 */
export function readGitHubIssueCloseToken(env: Readonly<Record<string, string | undefined>>): string {
  return String(env[GITHUB_ISSUE_CLOSE_TOKEN_ENV] ?? '').trim()
}

export type GitHubRequest = { url: string; init: { method: 'GET' | 'PATCH'; headers: Record<string, string>; body?: string } }

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'komahyouapp-functions',
  }
}

export function buildGetIssueRequest(token: string, issueNumber: number): GitHubRequest {
  return { url: `${GITHUB_API_BASE}/repos/${GITHUB_ISSUE_CLOSE_REPOSITORY}/issues/${issueNumber}`, init: { method: 'GET', headers: githubHeaders(token) } }
}

export function buildCloseIssueRequest(token: string, issueNumber: number, reason: GitHubIssueCloseReason): GitHubRequest {
  return {
    url: `${GITHUB_API_BASE}/repos/${GITHUB_ISSUE_CLOSE_REPOSITORY}/issues/${issueNumber}`,
    init: { method: 'PATCH', headers: { ...githubHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'closed', state_reason: reason }) },
  }
}

export type GitHubIssueCloseCheck =
  | { action: 'close' }
  | { action: 'already-closed' }
  | { action: 'reject'; code: 'not-found' | 'failed-precondition' | 'permission-denied' | 'internal'; message: string }

/** GET の結果から、閉じに行ってよいかを決める。 */
export function interpretGetIssueResponse(status: number, body: unknown): GitHubIssueCloseCheck {
  if (status === 404) return { action: 'reject', code: 'not-found', message: 'この Issue は見つかりません(番号違いか、リポジトリが違います)。' }
  if (status === 401 || status === 403) return { action: 'reject', code: 'permission-denied', message: tokenProblemMessage(status) }
  if (status < 200 || status >= 300) return { action: 'reject', code: 'internal', message: `GitHub から Issue を読めませんでした(HTTP ${status})。` }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (record.pull_request) return { action: 'reject', code: 'failed-precondition', message: 'これはプルリクエストなので、ここでは閉じません。' }
  if (record.state === 'closed') return { action: 'already-closed' }
  return { action: 'close' }
}

/** PATCH の結果。成功なら閉じた時刻(GitHub の closed_at)を返す。 */
export function interpretCloseIssueResponse(status: number, body: unknown): { ok: true; closedAt: string } | { ok: false; code: 'not-found' | 'permission-denied' | 'internal'; message: string } {
  if (status === 404) return { ok: false, code: 'not-found', message: 'この Issue は見つかりません。' }
  if (status === 401 || status === 403) return { ok: false, code: 'permission-denied', message: tokenProblemMessage(status) }
  if (status < 200 || status >= 300) return { ok: false, code: 'internal', message: `GitHub で Issue を閉じられませんでした(HTTP ${status})。` }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  return { ok: true, closedAt: typeof record.closed_at === 'string' ? record.closed_at : '' }
}

function tokenProblemMessage(status: number): string {
  return `GitHub のトークンで Issue を閉じられません(HTTP ${status})。トークンの期限と「Issues: Read and write」の権限を確かめてください。`
}

export const GITHUB_ISSUE_CLOSE_TOKEN_MISSING_MESSAGE =
  'GitHub のトークンが未設定のため、Issue を閉じられません。GitHub のリポジトリの secret「ISSUE_CLOSE_TOKEN」を登録して、Actions の「Deploy Cloud Functions」を実行してください。'
