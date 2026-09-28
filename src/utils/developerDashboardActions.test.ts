// 開発ダッシュボード【未対応一覧】と【Claude Code へ投げる本文】の回帰防止テスト(2026-09-28)。

import { describe, expect, it } from 'vitest'

import { buildIssueStateMap, summarizeVerificationChecklistStatus, type DeveloperReportRecord, type GitHubIssueRecord } from './developerDashboard'
import {
  AWAITING_ISSUE_STALE_MS,
  CLAUDE_CODE_NEW_SESSION_URL,
  CLAUDE_CODE_URL_LENGTH_LIMIT,
  buildClaudeCodePrompt,
  buildClaudeCodeSessionUrl,
  buildDashboardActions,
  extractLedgerIssueNumbers,
  resolveClaudeCodeSessionUrl,
  sanitizeErrorForPrompt,
  type DashboardActionItem,
} from './developerDashboardActions'
import type { DevelopmentStatusEntry } from './developmentStatusLedger'
import type { VerificationChecklistDefinition } from './verificationChecklist'

const NOW = new Date('2026-09-28T03:00:00.000Z')

function report(overrides: Partial<DeveloperReportRecord> & { reportId: string }): DeveloperReportRecord {
  return {
    classroomId: 'c1',
    classroomName: '教室1',
    source: 'board',
    category: 'bug',
    isTest: false,
    isVerificationChecklist: false,
    note: '一言',
    reportedAt: '2026-09-28T02:50:00.000Z',
    recordedAt: '2026-09-28T02:50:00.000Z',
    appVersion: '1.5.562',
    reporterRole: 'manager',
    notifiedAt: '2026-09-28T02:55:00.000Z',
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

function issue(overrides: Partial<GitHubIssueRecord> & { number: number }): GitHubIssueRecord {
  return {
    title: `題名 ${overrides.number}`,
    state: 'open',
    labels: [],
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    closedAt: null,
    htmlUrl: `https://github.com/Kake-git-hub/KomahyouApp/issues/${overrides.number}`,
    commentCount: 0,
    isUserReport: false,
    userReport: null,
    ...overrides,
  }
}

function ledgerEntry(overrides: Partial<DevelopmentStatusEntry> & { id: string }): DevelopmentStatusEntry {
  return {
    title: `テーマ ${overrides.id}`,
    stage: 'planned',
    summary: '要約',
    nextAction: '次の一手',
    references: [],
    updatedOn: '2026-09-25',
    ...overrides,
  }
}

const CHECKLIST: VerificationChecklistDefinition = {
  version: 'v1.5.556',
  items: [
    { id: 't-1', area: '盤面', title: '再移動で日付が追いつく', steps: ['操作'], introducedIn: 'v1.5.556' },
    { id: 'q-1', area: '保護者', title: 'QR が開く', steps: ['操作'], introducedIn: 'v1.5.512' },
    { id: 'd-1', area: '開発者画面', title: 'ダッシュボードが開く', steps: ['操作'], introducedIn: 'v1.5.557' },
  ],
}

function checklistReport(reportId: string, body: string, recordedAt: string): DeveloperReportRecord {
  return report({
    reportId,
    classroomId: 'v8OZ7zH8vONNHjjYVcR1',
    classroomName: '開発用教室',
    isVerificationChecklist: true,
    note: `[確認リスト v1.5.556]\n${body}`,
    recordedAt,
    reportedAt: recordedAt,
  })
}

const EMPTY_CHECKLIST: VerificationChecklistDefinition = { version: 'v1.5.556', items: [] }

/** 確認リストの定義は、確認リストを見るテストだけ CHECKLIST(3 項目)を渡す(それ以外は未確認行が混ざらないよう空定義)。 */
function build(input: { reports?: DeveloperReportRecord[]; issues?: GitHubIssueRecord[]; ledger?: DevelopmentStatusEntry[]; now?: Date; definition?: VerificationChecklistDefinition }) {
  const reports = input.reports ?? []
  const issues = input.issues ?? []
  return buildDashboardActions({
    reports,
    issues,
    issueStates: buildIssueStateMap(issues),
    checklist: summarizeVerificationChecklistStatus(reports, input.definition ?? EMPTY_CHECKLIST),
    ledger: input.ledger ?? [],
    now: input.now ?? NOW,
  })
}

describe('buildDashboardActions — 何を未対応として出すか', () => {
  it('材料が空なら未対応 0 件(済んだものを出さない)。確認リストの未確認は出さない(確認リストパネルが正本・d-4)', () => {
    const result = build({})
    expect(result.active).toEqual([])
    expect(result.waiting).toEqual([])
    expect(result.counts).toEqual({ total: 0, claude: 0, owner: 0, waiting: 0 })
    const withDefinition = build({ definition: CHECKLIST })
    expect(withDefinition.active).toEqual([])
    expect(withDefinition.waiting).toEqual([])
  })

  it('確認リストの要改善は 1 項目 1 行で Claude の番。未確認・OK はどこにも出さない(確認リストとの役割分担・d-4)', () => {
    const reports = [checklistReport('r1', '- t-1 要改善: 日付が 1 日ずれる\n- q-1 OK', '2026-09-27T10:00:00.000Z')]
    const result = build({ reports, definition: CHECKLIST })
    const needs = result.active.find((item) => item.id === 'checklist-t-1')
    expect(needs).toBeDefined()
    expect(needs!.turn).toBe('claude')
    expect(needs!.title).toContain('t-1')
    expect(needs!.detail).toContain('日付が 1 日ずれる')
    expect(needs!.prompt).toContain('要改善')
    expect(needs!.prompt).toContain('日付が 1 日ずれる')
    // 「内容」を押すと開く詳細にはメモ全文・分類が入る。
    expect(needs!.facts.join('\n')).toContain('メモ: 日付が 1 日ずれる')
    // 未確認(d-1 など)は行にならない。
    expect([...result.active, ...result.waiting].map((item) => item.id)).toEqual(['checklist-t-1'])
    // OK になった q-1 はどこにも出ない。
    expect([...result.active, ...result.waiting].some((item) => item.title.includes('q-1'))).toBe(false)
  })

  it('起票待ちの報告は新しければ「待ち」、2 時間を超えていれば Claude の番(ワークフロー停止の疑い)に上がる', () => {
    const fresh = build({ reports: [report({ reportId: 'a', notifiedAt: null, recordedAt: '2026-09-28T02:50:00.000Z' })] })
    expect(fresh.waiting.map((item) => item.id)).toEqual(['report-awaiting-issue'])
    expect(fresh.waiting[0].turn).toBe('waiting')
    expect(fresh.active).toEqual([])

    const staleAt = new Date(NOW.getTime() - AWAITING_ISSUE_STALE_MS - 60_000).toISOString()
    const stale = build({ reports: [report({ reportId: 'a', notifiedAt: null, recordedAt: staleAt }), report({ reportId: 'b', notifiedAt: null })] })
    expect(stale.active.map((item) => item.id)).toEqual(['report-awaiting-issue'])
    expect(stale.active[0].turn).toBe('claude')
    expect(stale.active[0].count).toBe(2)
    expect(stale.active[0].prompt).toContain('developer-reports.yml')
  })

  it('テスト送信・確認リストは起票待ちに数えない(従来の状態判定を踏襲)', () => {
    const result = build({ reports: [report({ reportId: 't', isTest: true, notifiedAt: null }), checklistReport('c', '- t-1 OK', '2026-09-27T10:00:00.000Z')] })
    expect([...result.active, ...result.waiting].some((item) => item.kind === 'report-awaiting-issue')).toBe(false)
  })

  it('メール／AI 回答の失敗は 1 行に畳んで Claude の番・最優先', () => {
    const reports = [
      report({ reportId: 'm', mailError: 'SMTP 550' }),
      report({ reportId: 'a', aiAnswerError: 'quota', category: 'question' }),
      checklistReport('c', '- t-1 要改善: x', '2026-09-27T10:00:00.000Z'),
    ]
    const result = build({ reports })
    expect(result.active[0].id).toBe('report-delivery-failed')
    expect(result.active[0].count).toBe(2)
    expect(result.active[0].prompt).toContain('SMTP 550')
    expect(result.active[0].prompt).toContain('quota')
  })

  it('open の Issue は利用者報告ならオーナーの番(着手可否)、開発側なら Claude の番。closed は出さない', () => {
    const issues = [
      issue({ number: 71, title: '📣 [利用者質問] 緑が丘校: 振替の表示', labels: ['source:user-report', 'type:question'], isUserReport: true, userReport: { kind: '利用者質問', classroomName: '緑が丘校' } }),
      issue({ number: 72, title: 'lint の警告', labels: ['type:chore'] }),
      issue({ number: 73, title: '済み', state: 'closed', closedAt: '2026-09-21T00:00:00.000Z' }),
    ]
    const result = build({ issues })
    const user = result.active.find((item) => item.id === 'issue-71')!
    expect(user.turn).toBe('owner')
    expect(user.kind).toBe('issue-user-report')
    expect(user.detail).toContain('緑が丘校')
    expect(user.href).toBe('https://github.com/Kake-git-hub/KomahyouApp/issues/71')
    expect(user.prompt).toContain('オーナーの着手許可')
    const dev = result.active.find((item) => item.id === 'issue-72')!
    expect(dev.turn).toBe('claude')
    expect(dev.kind).toBe('issue-dev')
    expect(dev.prompt).not.toContain('オーナーの着手許可')
    expect(result.active.some((item) => item.id === 'issue-73')).toBe(false)
    // 利用者報告(オーナー判断)が開発側 Issue より上。
    expect(result.active.findIndex((item) => item.id === 'issue-71')).toBeLessThan(result.active.findIndex((item) => item.id === 'issue-72'))
  })

  it('台帳の行が参照する Issue は台帳の行に畳み、Issue 単独の行を出さない(二重表示防止)', () => {
    const issues = [issue({ number: 69, title: '📣 [利用者質問] 緑が丘校: 日付', labels: ['source:user-report'], isUserReport: true, userReport: { kind: '利用者質問', classroomName: '緑が丘校' } })]
    const ledger = [ledgerEntry({ id: 'user-question-issue-69', stage: 'awaiting-owner', references: ['Issue #69', 'docs/spec-developer-report.md §E'] })]
    const result = build({ issues, ledger })
    expect(result.active.map((item) => item.id)).toEqual(['ledger-user-question-issue-69'])
    expect(result.active[0].turn).toBe('owner')
    expect(result.active[0].detail).toContain('#69')
    expect(result.active[0].href).toBe('https://github.com/Kake-git-hub/KomahyouApp/issues/69')
    expect(result.active[0].prompt).toContain('#69 [利用者質問] 緑が丘校')
  })

  it('参照 Issue がすべてクローズ済みの台帳の行は「台帳の行を消す」として Claude の番に変わる(更新漏れ検知)', () => {
    const issues = [issue({ number: 62, state: 'closed' }), issue({ number: 63, state: 'closed' })]
    const ledger = [ledgerEntry({ id: 'cleanup', stage: 'awaiting-owner', references: ['Issue #62', 'Issue #63'] })]
    const result = build({ issues, ledger })
    expect(result.active[0].turn).toBe('claude')
    expect(result.active[0].detail).toContain('台帳の行を消す')
    // GitHub から取れていない(不明)Issue が混ざるときは判定しない(消してよいと言い切れない)。
    const partial = build({ issues: [issue({ number: 62, state: 'closed' })], ledger })
    expect(partial.active[0].turn).toBe('owner')
  })

  it('台帳の段階ごとの番: 作業中・未着手は Claude、オーナー判断待ち・先行中はオーナー、結果待ち・保留は待ち', () => {
    const ledger = [
      ledgerEntry({ id: 'a', stage: 'in-progress' }),
      ledgerEntry({ id: 'b', stage: 'planned' }),
      ledgerEntry({ id: 'c', stage: 'awaiting-owner' }),
      ledgerEntry({ id: 'd', stage: 'development-only' }),
      ledgerEntry({ id: 'e', stage: 'awaiting-checklist' }),
      ledgerEntry({ id: 'f', stage: 'on-hold' }),
    ]
    const result = build({ ledger })
    const turnOf = (id: string) => [...result.active, ...result.waiting].find((item) => item.id === `ledger-${id}`)!.turn
    expect(turnOf('a')).toBe('claude')
    expect(turnOf('b')).toBe('claude')
    expect(turnOf('c')).toBe('owner')
    expect(turnOf('d')).toBe('owner')
    expect(turnOf('e')).toBe('waiting')
    expect(turnOf('f')).toBe('waiting')
    expect(result.counts).toEqual({ total: 6, claude: 2, owner: 2, waiting: 2 })
    // 並び: オーナー判断待ち → 作業中 → 未着手 → 先行中。
    expect(result.active.map((item) => item.id)).toEqual(['ledger-c', 'ledger-a', 'ledger-b', 'ledger-d'])
    // 台帳の行はどれも Claude に投げられる(本文に台帳ファイルと次の一手が入る)。
    for (const item of [...result.active, ...result.waiting]) {
      expect(item.prompt, item.id).toContain('developmentStatusLedger.ts')
      expect(item.prompt, item.id).toContain('次の一手')
    }
  })

  it('実際の台帳全体でも id が重複せず、全行が active か waiting のどちらかに入る', () => {
    const result = buildDashboardActions({ reports: [], issues: [], issueStates: new Map(), checklist: summarizeVerificationChecklistStatus([], EMPTY_CHECKLIST), now: NOW })
    const ids = [...result.active, ...result.waiting].map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.counts.total).toBeGreaterThan(0)
  })
})

describe('extractLedgerIssueNumbers', () => {
  it('references の「Issue #N」だけを拾い、PR #N や docs のパスは拾わない', () => {
    expect(extractLedgerIssueNumbers({ references: ['Issue #69', 'PR #31', 'Issue #38', 'Issue #38', 'docs/x.md §3'] })).toEqual([38, 69])
    expect(extractLedgerIssueNumbers({ references: [] })).toEqual([])
  })
})

describe('buildClaudeCodePrompt / URL', () => {
  const item = (overrides: Partial<DashboardActionItem> & { id: string }): DashboardActionItem => ({
    kind: 'issue-dev',
    kindLabel: 'Issue',
    turn: 'claude',
    title: '題名',
    detail: '',
    facts: [],
    href: null,
    prompt: '本文',
    count: 1,
    priority: 1,
    ...overrides,
  })

  it('本文は短く(d-4): 件数・CLAUDE.md への一言・各件の見出しと本文だけ。手順や完了条件は繰り返さず、投げられない件は除く', () => {
    const prompt = buildClaudeCodePrompt(
      [item({ id: 'a', kindLabel: '要改善', title: 't-1 日付', prompt: '- メモ: ずれる' }), item({ id: 'b', title: '投げられない', prompt: null })],
      { appVersion: '1.5.562', generatedAt: '2026-09-28T03:00:00.000Z' },
    )
    expect(prompt).toContain('次の 1 件')
    expect(prompt).toContain('CLAUDE.md')
    expect(prompt).toContain('v1.5.562')
    expect(prompt).toContain('## 1. [要改善] t-1 日付')
    expect(prompt).toContain('- メモ: ずれる')
    expect(prompt).not.toContain('投げられない')
    // 以前の長い定型文(着手前確認・完了条件)は載せない。
    expect(prompt).not.toContain('solo-git-workflow')
    expect(prompt).not.toContain('終わったら')
    expect(prompt.split('\n').length).toBeLessThanOrEqual(4)
  })

  it('URL は公式の入力済み形式(claude.ai/code?repositories=…&prompt=…)で、本文は URL エンコードされる', () => {
    const url = buildClaudeCodeSessionUrl('直す & test')
    expect(url.startsWith(`${CLAUDE_CODE_NEW_SESSION_URL}?`)).toBe(true)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('repositories')).toBe('Kake-git-hub/KomahyouApp')
    expect(parsed.searchParams.get('prompt')).toBe('直す & test')
  })

  it('長すぎる本文は URL にせず null(画面はクリップボード経由へ切り替える)', () => {
    expect(resolveClaudeCodeSessionUrl('短い')).not.toBeNull()
    expect(resolveClaudeCodeSessionUrl('あ'.repeat(CLAUDE_CODE_URL_LENGTH_LIMIT))).toBeNull()
  })
})

describe('個人情報を Claude への指示に載せない(regression-reviewer 指摘 2026-09-28)', () => {
  const STUDENT = '山田太郎'

  it('報告の一言(note)は起票待ち・Issue なし・通知失敗のどの指示にも載らない(画面の補足には出てよい)', () => {
    const staleAt = new Date(NOW.getTime() - AWAITING_ISSUE_STALE_MS - 60_000).toISOString()
    const reports = [
      report({ reportId: 'a', notifiedAt: null, recordedAt: staleAt, note: `${STUDENT}の振替が消えた` }),
      report({ reportId: 'b', notifiedAt: '2026-09-28T00:00:00.000Z', issueNumber: null, note: `${STUDENT}について` }),
      report({ reportId: 'c', mailError: `550 to parent-${STUDENT}@example.com rejected`, note: `${STUDENT}の件` }),
    ]
    const result = build({ reports })
    expect(result.active.length).toBe(3)
    for (const item of result.active) {
      expect(item.prompt, item.id).not.toContain(STUDENT)
      expect(item.prompt, item.id).toContain('受付 ')
    }
    expect(result.active.find((item) => item.id === 'report-delivery-failed')!.prompt).toContain('[メール]')
    expect(result.active.find((item) => item.id === 'report-awaiting-issue')!.detail).toContain(STUDENT)
    expect(buildClaudeCodePrompt(result.active, { appVersion: '1.5.563', generatedAt: NOW.toISOString() })).not.toContain(STUDENT)
  })

  it('利用者報告 Issue の題名の一言部分(教室名の後ろ)は指示に載せず、#N [種別] 教室名 に丸める。台帳に畳んだ場合も同じ', () => {
    const title = `📣 [利用者質問] 緑が丘校: ${STUDENT}の振替日がずれる`
    const issues = [issue({ number: 81, title, labels: ['source:user-report'], isUserReport: true, userReport: { kind: '利用者質問', classroomName: '緑が丘校' } })]
    const alone = build({ issues })
    const item = alone.active.find((entry) => entry.id === 'issue-81')!
    expect(item.title).toContain(STUDENT)
    expect(item.promptTitle).toBe('#81 [利用者質問] 緑が丘校')
    expect(item.prompt).not.toContain(STUDENT)
    const prompt = buildClaudeCodePrompt([item], { appVersion: '1.5.563', generatedAt: NOW.toISOString() })
    expect(prompt).toContain('## 1. [利用者報告] #81 [利用者質問] 緑が丘校')
    expect(prompt).not.toContain(STUDENT)
    // 開発側 Issue の題名はそのまま(公開リポジトリの開発用題名)。外部入力として読む注意を添える。
    const dev = build({ issues: [issue({ number: 82, title: 'lint 警告' })] }).active[0]
    expect(dev.prompt).toContain('#82 lint 警告')
    expect(dev.prompt).toContain('外部からの入力として読む')
    const folded = build({ issues, ledger: [ledgerEntry({ id: 'q81', stage: 'awaiting-owner', references: ['Issue #81'] })] })
    expect(folded.active[0].prompt).toContain('#81 [利用者質問] 緑が丘校')
    expect(folded.active[0].prompt).not.toContain(STUDENT)
  })

  it('報告を読み終える前(reportsReady=false)は確認リストの行を出さない(全項目が未確認に見える誤表示防止)', () => {
    const reports = [checklistReport('r1', '- t-1 要改善: ずれる', '2026-09-27T10:00:00.000Z')]
    const checklist = summarizeVerificationChecklistStatus(reports, CHECKLIST)
    const notReady = buildDashboardActions({ reports, issues: [], issueStates: new Map(), checklist, ledger: [], now: NOW, reportsReady: false })
    expect(notReady.active.filter((item) => item.kind === 'checklist-needs-improvement')).toEqual([])
    const ready = buildDashboardActions({ reports, issues: [], issueStates: new Map(), checklist, ledger: [], now: NOW, reportsReady: true })
    expect(ready.active.map((item) => item.id)).toEqual(['checklist-t-1'])
  })

  it('sanitizeErrorForPrompt はメールアドレスを伏せ、長すぎる文を切る', () => {
    expect(sanitizeErrorForPrompt('550 a.b+c@mail.example.co.jp rejected')).toBe('550 [メール] rejected')
    expect(sanitizeErrorForPrompt('x'.repeat(200), 10)).toBe('xxxxxxxxxx…')
  })
})
