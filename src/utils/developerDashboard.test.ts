// 開発ダッシュボードの純粋ロジックの回帰防止テスト(2026-09-25)。

import { describe, expect, it } from 'vitest'

import {
  buildFeatureRolloutOverview,
  buildIssueStateMap,
  formatDashboardDateTime,
  normalizeDeveloperReportRecord,
  normalizeGitHubIssues,
  parseUserReportIssueTitle,
  resolveDeveloperDashboardSinceIso,
  resolveDeveloperReportStatus,
  sortDeveloperReportsNewestFirst,
  summarizeDeveloperReportNote,
  summarizeDeveloperReportsByClassroom,
  summarizeVerificationChecklistStatus,
  type DeveloperReportRecord,
} from './developerDashboard'
import type { VerificationChecklistDefinition } from './verificationChecklist'

function report(overrides: Partial<DeveloperReportRecord> & { reportId: string }): DeveloperReportRecord {
  return {
    classroomId: 'c1',
    classroomName: '教室1',
    source: 'board',
    category: 'bug',
    isTest: false,
    isVerificationChecklist: false,
    note: '一言',
    reportedAt: '2026-09-20T00:00:00.000Z',
    recordedAt: '2026-09-20T00:00:01.000Z',
    appVersion: '1.5.556',
    reporterRole: 'manager',
    notifiedAt: null,
    notifySkipped: null,
    issueNumber: null,
    issueUrl: '',
    hasAiAnswer: false,
    aiAnswerError: '',
    mailSentAt: null,
    mailError: '',
    ...overrides,
  }
}

describe('normalizeDeveloperReportRecord', () => {
  it('Firestore 文書の項目を読み、壊れた値は既定値へ丸める', () => {
    const record = normalizeDeveloperReportRecord({
      reportId: 'r1', classroomId: 'c1', classroomName: '緑が丘', category: 'question', isTest: false, note: '振替は？',
      reportedAt: '2026-09-16T07:00:00.000Z', recordedAt: '2026-09-16T07:00:01.000Z', issueNumber: 69, issueUrl: 'https://github.com/x/y/issues/69',
      aiAnswer: '回答', notifiedAt: '2026-09-16T07:15:00.000Z',
    }, 'fallback')
    expect(record).toMatchObject({ reportId: 'r1', category: 'question', issueNumber: 69, hasAiAnswer: true, notifiedAt: '2026-09-16T07:15:00.000Z', isVerificationChecklist: false })
    const broken = normalizeDeveloperReportRecord({ category: 'weird', issueNumber: 'abc', aiAnswer: '   ' }, 'doc-id')
    expect(broken).toMatchObject({ reportId: 'doc-id', category: 'bug', issueNumber: null, hasAiAnswer: false, notifiedAt: null })
    expect(normalizeDeveloperReportRecord({ issueNumber: '12' }, 'x').issueNumber).toBe(12)
  })

  it('確認リストの判定はサーバーのフラグが権威。フラグが無い古い文書だけ本文の先頭マーカーで補う', () => {
    expect(normalizeDeveloperReportRecord({ note: '[確認リスト v1.5.556]\n- t-1 OK' }, 'x').isVerificationChecklist).toBe(true)
    expect(normalizeDeveloperReportRecord({ isVerificationChecklist: true, note: 'x' }, 'x').isVerificationChecklist).toBe(true)
    expect(normalizeDeveloperReportRecord({ note: '確認リストではない' }, 'x').isVerificationChecklist).toBe(false)
    // 本番教室が同じ書式で送った報告はサーバーが false と記録する。マーカーがあっても確認リストに混ぜない(regression-reviewer 指摘 2026-09-25)。
    expect(normalizeDeveloperReportRecord({ isVerificationChecklist: false, note: '[確認リスト v1.5.556]\n- t-1 OK' }, 'x').isVerificationChecklist).toBe(false)
  })
})

describe('GitHub Issue の正規化', () => {
  it('PR を除き、ラベル・利用者報告の種別と教室名を取り出す', () => {
    const issues = normalizeGitHubIssues([
      { number: 69, title: '📣 [利用者質問] スクールIE 緑が丘校: 丸ごと振替で対応した後に…', state: 'open', labels: [{ name: 'status:triage' }, { name: 'source:user-report' }, { name: 'type:question' }], created_at: '2026-09-16T07:36:41Z', updated_at: '2026-09-16T08:32:20Z', closed_at: null, html_url: 'https://github.com/Kake-git-hub/KomahyouApp/issues/69', comments: 2 },
      { number: 31, title: 'ci(functions): …', state: 'open', labels: [], pull_request: { url: 'x' } },
      { number: 48, title: 'テンプレ上書き分岐C…', state: 'closed', labels: ['type:bug'], closed_at: '2026-09-01T00:00:00Z' },
      { number: 'bad' },
      null,
    ])
    expect(issues.map((issue) => issue.number)).toEqual([69, 48])
    expect(issues[0]).toMatchObject({ isUserReport: true, userReport: { kind: '利用者質問', classroomName: 'スクールIE 緑が丘校' }, commentCount: 2, labels: ['status:triage', 'source:user-report', 'type:question'] })
    expect(issues[1]).toMatchObject({ state: 'closed', isUserReport: false, userReport: null, labels: ['type:bug'], htmlUrl: 'https://github.com/Kake-git-hub/KomahyouApp/issues/48' })
    expect(normalizeGitHubIssues({ message: 'rate limited' })).toEqual([])
  })

  it('利用者報告タイトルの解析(tools/developer-report-notify.mjs buildIssueTitle の書式)', () => {
    expect(parseUserReportIssueTitle('📣 [利用者要望] 開発用教室: [確認リスト v1.5.509]')).toEqual({ kind: '利用者要望', classroomName: '開発用教室' })
    expect(parseUserReportIssueTitle('📣 [利用者報告] 日大前校')).toEqual({ kind: '利用者報告', classroomName: '日大前校' })
    expect(parseUserReportIssueTitle('テンプレ講師が出勤不可')).toBeNull()
  })
})

describe('報告の状態と教室別集計', () => {
  const issueStates = buildIssueStateMap(normalizeGitHubIssues([
    { number: 69, title: 'q', state: 'open', labels: [] },
    { number: 63, title: 'c', state: 'closed', labels: [] },
  ]))

  it('状態は 確認リスト > テスト > 起票待ち(notifiedAt 空) > 通知済み(Issue なし) > Issue の open/closed/不明 の順に決まる', () => {
    const notified = '2026-09-20T00:15:00.000Z'
    expect(resolveDeveloperReportStatus(report({ reportId: 'a', isVerificationChecklist: true, isTest: true }), issueStates)).toBe('checklist')
    expect(resolveDeveloperReportStatus(report({ reportId: 'b', isTest: true, issueNumber: 69, notifiedAt: notified }), issueStates)).toBe('test')
    // 起票待ちは仕様 §E-3 どおり notifiedAt が空で決まる(Issue 番号の有無ではない)。
    expect(resolveDeveloperReportStatus(report({ reportId: 'c' }), issueStates)).toBe('awaiting-issue')
    expect(resolveDeveloperReportStatus(report({ reportId: 'c2', issueNumber: 69 }), issueStates)).toBe('awaiting-issue')
    expect(resolveDeveloperReportStatus(report({ reportId: 'g', notifiedAt: notified }), issueStates)).toBe('notified-no-issue')
    expect(resolveDeveloperReportStatus(report({ reportId: 'd', issueNumber: 69, notifiedAt: notified }), issueStates)).toBe('issue-open')
    expect(resolveDeveloperReportStatus(report({ reportId: 'e', issueNumber: 63, notifiedAt: notified }), issueStates)).toBe('issue-closed')
    expect(resolveDeveloperReportStatus(report({ reportId: 'f', issueNumber: 999, notifiedAt: notified }), issueStates)).toBe('issue-unknown')
  })

  it('教室一覧の順に並べ、0 件の教室も出し、削除済み教室は末尾に足す。テスト・確認リストは種別に数えない', () => {
    const rows = summarizeDeveloperReportsByClassroom([
      report({ reportId: 'r1', classroomId: 'c2', classroomName: '緑が丘', category: 'question', issueNumber: 69, notifiedAt: '2026-09-16T07:15:00.000Z', reportedAt: '2026-09-16T07:00:00.000Z' }),
      report({ reportId: 'r2', classroomId: 'c2', classroomName: '緑が丘', category: 'request', reportedAt: '2026-09-17T07:00:00.000Z' }),
      report({ reportId: 'r3', classroomId: 'dev', classroomName: '開発用教室', isVerificationChecklist: true, note: '[確認リスト v1.5.556]\n- t-1 OK', notifiedAt: '2026-09-22T00:00:00.000Z' }),
      report({ reportId: 'r4', classroomId: 'dev', classroomName: '開発用教室', isTest: true, note: '#テスト', notifiedAt: '2026-09-22T00:00:00.000Z' }),
      report({ reportId: 'r5', classroomId: 'gone', classroomName: '薬円台校', category: 'bug', issueNumber: 63, notifiedAt: '2026-09-01T00:15:00.000Z' }),
    ], [{ id: 'c1', name: '日大前' }, { id: 'c2', name: '緑が丘' }, { id: 'dev', name: '開発用教室' }], {
      issueStates,
      isDevelopmentClassroom: (id) => id === 'dev',
    })
    expect(rows.map((row) => row.classroomId)).toEqual(['c1', 'c2', 'dev', 'gone'])
    expect(rows[0]).toMatchObject({ classroomName: '日大前', isKnownClassroom: true, counts: { question: 0, request: 0, bug: 0, checklist: 0, test: 0 }, awaitingIssue: 0, openIssueNumbers: [], latestReportedAt: '' })
    expect(rows[1]).toMatchObject({ counts: { question: 1, request: 1, bug: 0, checklist: 0, test: 0 }, awaitingIssue: 1, openIssueNumbers: [69], latestReportedAt: '2026-09-17T07:00:00.000Z' })
    expect(rows[2]).toMatchObject({ isDevelopmentClassroom: true, counts: { question: 0, request: 0, bug: 0, checklist: 1, test: 1 }, awaitingIssue: 0 })
    expect(rows[3]).toMatchObject({ classroomName: '薬円台校', isKnownClassroom: false, counts: { bug: 1 }, openIssueNumbers: [] })
  })

  it('新しい順の並べ替えと一言の要約', () => {
    const sorted = sortDeveloperReportsNewestFirst([
      report({ reportId: 'old', reportedAt: '2026-09-01T00:00:00.000Z' }),
      report({ reportId: 'new', reportedAt: '2026-09-20T00:00:00.000Z' }),
      report({ reportId: 'no-reported', reportedAt: '', recordedAt: '2026-09-10T00:00:00.000Z' }),
    ])
    expect(sorted.map((entry) => entry.reportId)).toEqual(['new', 'no-reported', 'old'])
    expect(summarizeDeveloperReportNote('\n\n  9/3 の振替が消えた  \n詳細')).toBe('9/3 の振替が消えた')
    expect(summarizeDeveloperReportNote('あ'.repeat(100), 10)).toBe(`${'あ'.repeat(10)}…`)
  })
})

describe('機能フラグの段階', () => {
  it('まだ全教室に出ていないフラグを先に並べ、台帳の題名を添える', () => {
    const rows = buildFeatureRolloutOverview(
      { a: { scope: 'all-classrooms', description: 'A' }, b: { scope: 'development-only', description: 'B' }, c: { scope: 'staging-environment', description: 'C' } },
      [{ id: 'x', title: 'B の題名', stage: 'development-only', summary: 's', featureKeys: ['b' as never], nextAction: 'n', references: ['r'], updatedOn: '2026-09-25' }],
    )
    expect(rows.map((row) => `${row.key}:${row.scopeLabel}`)).toEqual(['b:開発用教室のみ', 'c:staging＋検証用教室', 'a:全教室'])
    expect(rows[0].title).toBe('B の題名')
    expect(rows[1].title).toBe('C')
  })
})

describe('確認リストの確認済み/未確認', () => {
  const definition: VerificationChecklistDefinition = {
    version: 'v1.5.557',
    items: [
      { id: 'b-2', area: '基本データ', title: '退塾', steps: ['s'], introducedIn: 'v1.5.553' },
      { id: 't-1', area: '盤面', title: '振替', steps: ['s'], introducedIn: 'v1.5.556' },
      { id: 'd-1', area: '開発者画面', title: 'ダッシュボード', steps: ['s'], introducedIn: 'v1.5.557' },
    ],
  }

  it('現行版の結果だけを OK/要改善に数え、前の版の結果は参考として添え、定義に無い id は件数だけ出す', () => {
    const summary = summarizeVerificationChecklistStatus([
      report({ reportId: 'c1', isVerificationChecklist: true, note: '[確認リスト v1.5.556]\n- t-1 OK\n- b-2 要改善: 昨日の分も消えた\n- r-2 OK\n- その他: 文字を大きく', recordedAt: '2026-09-22T00:00:00.000Z' }),
      report({ reportId: 'c2', isVerificationChecklist: true, note: '[確認リスト v1.5.557]\n- t-1 OK', recordedAt: '2026-09-26T00:00:00.000Z' }),
      report({ reportId: 'q', category: 'question', note: '普通の質問' }),
    ], definition)
    expect(summary.version).toBe('v1.5.557')
    expect(summary.counts).toEqual({ ok: 1, needsImprovement: 0, unanswered: 2 })
    const byId = new Map(summary.rows.map((row) => [row.id, row]))
    expect(byId.get('t-1')).toMatchObject({ status: 'ok', recordedAt: '2026-09-26T00:00:00.000Z', reportIds: ['c2'], previousVersionResult: null })
    expect(byId.get('b-2')).toMatchObject({ status: 'unanswered', memo: '' })
    expect(byId.get('b-2')!.previousVersionResult).toMatchObject({ result: 'needs-improvement', memo: '昨日の分も消えた', version: '1.5.556' })
    expect(byId.get('d-1')).toMatchObject({ status: 'unanswered', previousVersionResult: null })
    expect(summary.otherNotes).toEqual([{ version: '1.5.556', recordedAt: '2026-09-22T00:00:00.000Z', note: '文字を大きく' }])
    expect(summary.latestSubmissionAt).toBe('2026-09-26T00:00:00.000Z')
    expect(summary.resultsOutsideDefinition).toBe(1)
  })

  it('結果が 1 件も無ければ全項目が未確認', () => {
    const summary = summarizeVerificationChecklistStatus([], definition)
    expect(summary.counts).toEqual({ ok: 0, needsImprovement: 0, unanswered: 3 })
    expect(summary.latestSubmissionAt).toBe('')
  })
})

describe('期間と日時の表示', () => {
  it('直近 N 日の ISO を作り、不正な日数は既定(90 日)へ', () => {
    const now = new Date('2026-09-25T00:00:00.000Z')
    expect(resolveDeveloperDashboardSinceIso(30, now)).toBe('2026-08-26T00:00:00.000Z')
    expect(resolveDeveloperDashboardSinceIso(0, now)).toBe('2026-06-27T00:00:00.000Z')
  })

  it('日時は JST で出し、空・不正はそのまま', () => {
    expect(formatDashboardDateTime('')).toBe('—')
    expect(formatDashboardDateTime('not-a-date')).toBe('not-a-date')
    expect(formatDashboardDateTime('2026-09-16T07:36:41Z')).toContain('16:36')
  })
})
