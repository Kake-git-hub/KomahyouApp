import type { OpenIssue } from './types'

type IssuesPanelProps = {
  issues: OpenIssue[]
}

export function IssuesPanel({ issues }: IssuesPanelProps) {
  return (
    <section className="issues-panel" aria-label="通常残一覧画面の最小版">
      <div className="issues-panel-head">
        <div>
          <p className="panel-kicker">通常残一覧画面</p>
          <h2>通常残 / 未解決一覧</h2>
        </div>
        <button className="secondary-button" type="button">
          バックアップ/復元画面へ
        </button>
      </div>
      <div className="issue-table">
        <div className="issue-table-head">
          <span>分類</span>
          <span>生徒</span>
          <span>元講師</span>
          <span>発生日</span>
          <span>状態</span>
        </div>
        {issues.map((issue) => (
          <button key={issue.id} className="issue-row" type="button">
            <span>{issue.category}</span>
            <span>{issue.student}</span>
            <span>{issue.teacher}</span>
            <span>{issue.dateLabel}</span>
            <span>{issue.detail}</span>
          </button>
        ))}
      </div>
    </section>
  )
}