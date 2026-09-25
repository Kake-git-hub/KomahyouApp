// 開発ダッシュボード用: GitHub Issues を **公開 API の GET だけ** で読む。
//
// リポジトリ Kake-git-hub/KomahyouApp は公開リポジトリなので、認証なしで Issues を読める
// (制限は 1 時間 60 回/IP。ダッシュボードを開いたとき・再読込のときだけ呼ぶ)。
// トークンは持たない・書き込み(Issue 作成・コメント・クローズ)はしない。起票は従来どおり
// .github/workflows/developer-reports.yml が行う。

import { GITHUB_ISSUES_API_URL, normalizeGitHubIssues, type GitHubIssueRecord } from '../../utils/developerDashboard'

export async function fetchGitHubIssues(fetchImpl: typeof fetch = fetch): Promise<GitHubIssueRecord[]> {
  const response = await fetchImpl(GITHUB_ISSUES_API_URL, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
    credentials: 'omit',
  })
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const detail = response.status === 403 && remaining === '0' ? '(GitHub API の回数制限。しばらく待って再読込)' : `(HTTP ${response.status})`
    throw new Error(`GitHub Issue を読み込めませんでした ${detail}`)
  }
  return normalizeGitHubIssues(await response.json())
}
