// 開発ダッシュボード【いまの状況】の 3 つの欄と【Claude Code へ投げる本文】の回帰防止テスト
// (2026-09-28 初版、2026-10-30 オーナー指示「シンプルに・確認リストと重複させない・終わったものを残さない・わかり易い文章で」で作り直し)。

import { describe, expect, it } from 'vitest'

import { buildIssueStateMap, type DeveloperReportRecord, type GitHubIssueRecord } from './developerDashboard'
import {
  AWAITING_ISSUE_STALE_MS,
  CLAUDE_CODE_NEW_SESSION_URL,
  CLAUDE_CODE_URL_LENGTH_LIMIT,
  buildClaudeCodeSessionUrl,
  buildDashboardOverview,
  extractLedgerIssueNumbers,
  resolveClaudeCodeSessionUrl,
  resolveLedgerSection,
  sanitizeErrorForPrompt,
  type DashboardCard,
  type DashboardOverview,
} from './developerDashboardActions'
import { DEVELOPMENT_STATUS_LEDGER, type DevelopmentStatusEntry } from './developmentStatusLedger'
import { featureRolloutRegistry, type FeatureRolloutScope } from './featureRollout'

const NOW = new Date('2026-09-28T03:00:00.000Z')

function report(overrides: Partial<DeveloperReportRecord> & { reportId: string }): DeveloperReportRecord {
  return {
    attachments: [],
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
    aiAnswer: '',
    aiAnswerBlocked: '',
    aiAnswerModel: '',
    aiAnswerCostYen: null,
    aiAnswerShadowModel: '',
    aiAnswerShadow: '',
    aiAnswerShadowError: '',
    aiAnswerShadowBlocked: '',
    aiAnswerShadowCostYen: null,
    aiAnswerDigestStudents: [],
    mailSentAt: null,
    mailError: '',
    // 回答フィールド(v1.5.565・spec-developer-report §G-3)。未回答の既定。
    answerFinal: '',
    answeredAt: null,
    answerRevision: 0,
    resolvedAt: null,
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
    who: 'owner',
    summary: '要約',
    nextAction: '次の一手',
    references: [],
    updatedOn: '2026-09-25',
    ...overrides,
  }
}

const REGISTRY: Readonly<Record<string, { scope: FeatureRolloutScope }>> = {
  devOnly: { scope: 'development-only' },
  staging: { scope: 'staging-environment' },
  promoted: { scope: 'all-classrooms' },
}

function build(input: { reports?: DeveloperReportRecord[]; issues?: GitHubIssueRecord[]; ledger?: DevelopmentStatusEntry[]; now?: Date }): DashboardOverview {
  const reports = input.reports ?? []
  const issues = input.issues ?? []
  return buildDashboardOverview({ reports, issues, issueStates: buildIssueStateMap(issues), ledger: input.ledger ?? [], featureRegistry: REGISTRY, now: input.now ?? NOW })
}

function allCards(overview: DashboardOverview): DashboardCard[] {
  return [...overview.todo.owner, ...overview.todo.claude, ...overview.trial, ...overview.notBuilt]
}

function find(overview: DashboardOverview, id: string): DashboardCard {
  const card = allCards(overview).find((entry) => entry.id === id)
  if (!card) throw new Error(`card ${id} not found`)
  return card
}

describe('resolveLedgerSection — 台帳の行をどの欄に出すか', () => {
  it('機能フラグがまだ全教室でない行は段階に関係なく「開発・テスト教室だけ」', () => {
    for (const stage of ['awaiting-owner', 'awaiting-checklist', 'in-progress', 'planned'] as const) {
      expect(resolveLedgerSection({ stage, featureKeys: ['devOnly' as never] }, REGISTRY), stage).toBe('trial')
      expect(resolveLedgerSection({ stage, featureKeys: ['staging' as never] }, REGISTRY), stage).toBe('trial')
    }
    expect(resolveLedgerSection({ stage: 'development-only' }, REGISTRY)).toBe('trial')
  })

  it('確認リストの結果待ちだけの行は出さない(確認リストパネルが正本・重複させない)', () => {
    expect(resolveLedgerSection({ stage: 'awaiting-checklist' }, REGISTRY)).toBeNull()
    expect(resolveLedgerSection({ stage: 'awaiting-checklist', featureKeys: ['promoted' as never] }, REGISTRY)).toBeNull()
  })

  it('未着手・保留は「まだ作っていない」、判断待ち・作りかけは「やること」', () => {
    expect(resolveLedgerSection({ stage: 'planned' }, REGISTRY)).toBe('not-built')
    expect(resolveLedgerSection({ stage: 'on-hold' }, REGISTRY)).toBe('not-built')
    expect(resolveLedgerSection({ stage: 'awaiting-owner' }, REGISTRY)).toBe('todo')
    expect(resolveLedgerSection({ stage: 'in-progress' }, REGISTRY)).toBe('todo')
    // 全教室へ出たフラグは「開発・テスト教室だけ」にしない。
    expect(resolveLedgerSection({ stage: 'awaiting-owner', featureKeys: ['promoted' as never] }, REGISTRY)).toBe('todo')
  })
})

describe('buildDashboardOverview — 3 つの欄', () => {
  it('材料が空ならどの欄も 0 件(済んだものを出さない)', () => {
    const overview = build({})
    expect(overview.counts).toEqual({ todo: 0, todoOwner: 0, todoClaude: 0, trial: 0, notBuilt: 0 })
  })

  it('台帳の行は欄ごとに入り、やることは who でオーナー／Claude に分かれる。結果待ちだけの行は出ない', () => {
    const overview = build({
      ledger: [
        ledgerEntry({ id: 'trial', stage: 'awaiting-owner', featureKeys: ['devOnly' as never] }),
        ledgerEntry({ id: 'owner-todo', stage: 'awaiting-owner', who: 'owner' }),
        ledgerEntry({ id: 'claude-todo', stage: 'in-progress', who: 'claude' }),
        ledgerEntry({ id: 'plan', stage: 'planned' }),
        ledgerEntry({ id: 'hold', stage: 'on-hold' }),
        ledgerEntry({ id: 'checklist-only', stage: 'awaiting-checklist' }),
      ],
    })
    expect(overview.trial.map((card) => card.id)).toEqual(['ledger-trial'])
    expect(overview.todo.owner.map((card) => card.id)).toEqual(['ledger-owner-todo'])
    expect(overview.todo.claude.map((card) => card.id)).toEqual(['ledger-claude-todo'])
    expect(overview.notBuilt.map((card) => card.id)).toEqual(['ledger-plan', 'ledger-hold'])
    expect(allCards(overview).some((card) => card.id === 'ledger-checklist-only')).toBe(false)
    expect(find(overview, 'ledger-trial').badge).toBe('開発・テスト教室だけ')
    expect(find(overview, 'ledger-hold').badge).toBe('保留')
  })

  it('カードは台帳の題名・要約・次の一手をそのまま出し、notes は「くわしく」にだけ入る', () => {
    const overview = build({ ledger: [ledgerEntry({ id: 'a', stage: 'awaiting-owner', title: '題名', summary: '今の状態', nextAction: 'オーナーが決める', notes: '詳しい経緯' })] })
    const card = find(overview, 'ledger-a')
    expect(card).toMatchObject({ title: '題名', summary: '今の状態', nextAction: 'オーナーが決める' })
    expect(card.details[0]).toBe('詳しい経緯')
    expect(card.prompt).toContain('台帳 id: a')
    expect(card.prompt).toContain('次にやること: オーナーが決める')
  })

  it('確認リストの送信(要改善を含む)はどの欄にも出さない(確認リストとの重複をなくす・2026-10-30)', () => {
    const reports = [
      report({
        reportId: 'chk',
        classroomId: 'v8OZ7zH8vONNHjjYVcR1',
        classroomName: '開発用教室',
        isVerificationChecklist: true,
        note: '[確認リスト v1.5.653]\n- tp-51 要改善: 消える',
      }),
    ]
    const overview = build({ reports })
    expect(allCards(overview)).toEqual([])
  })

  it('参照 Issue がすべてクローズ済みの台帳の行は「済み(台帳から消す)」として Claude のやることに変わる(終わったものの取り残し検知)', () => {
    const overview = build({
      issues: [issue({ number: 69, state: 'closed' }), issue({ number: 70, state: 'closed' })],
      ledger: [ledgerEntry({ id: 'done', stage: 'on-hold', references: ['Issue #69', 'Issue #70'] })],
    })
    expect(overview.notBuilt).toEqual([])
    const card = find(overview, 'ledger-done')
    expect(card.section).toBe('todo')
    expect(card.who).toBe('claude')
    expect(card.badge).toBe('済み(台帳から消す)')
    expect(card.nextAction).toContain('#69 #70')
    expect(card.prompt).toContain('台帳の行を消して')
  })

  it('台帳の行が参照する Issue は台帳のカードにまとめ、Issue 単独のカードを出さない(二重表示防止)', () => {
    const overview = build({
      issues: [issue({ number: 72, isUserReport: true, labels: ['source:user-report'] }), issue({ number: 90 })],
      ledger: [ledgerEntry({ id: 'theme', stage: 'awaiting-owner', references: ['Issue #72'] })],
    })
    const ids = allCards(overview).map((card) => card.id)
    expect(ids).toContain('ledger-theme')
    expect(ids).not.toContain('issue-72')
    expect(find(overview, 'ledger-theme').links).toEqual([{ label: '#72', href: 'https://github.com/Kake-git-hub/KomahyouApp/issues/72' }])
    // 台帳が参照しない開発側の Issue は「まだ作っていない」に入る。
    expect(overview.notBuilt.map((card) => card.id)).toEqual(['issue-90'])
  })

  it('台帳が参照しない利用者報告 Issue はオーナーのやること(着手の許可)。題名から「📣 [種別] 教室:」を外して教室名を前に出す。closed は出さない', () => {
    const overview = build({
      issues: [
        issue({ number: 80, title: '📣 [利用者報告] 開発用教室: 講師に保留が残る', isUserReport: true, labels: ['source:user-report', 'type:bug'], userReport: { kind: '利用者報告', classroomName: '開発用教室' } }),
        issue({ number: 81, state: 'closed', isUserReport: true, labels: ['source:user-report'] }),
      ],
    })
    expect(overview.todo.owner.map((card) => card.id)).toEqual(['issue-80'])
    const card = overview.todo.owner[0]
    expect(card.title).toBe('開発用教室: 講師に保留が残る')
    expect(card.badge).toBe('室長からの報告')
    expect(card.summary).toContain('許可があるまで修正は始めません')
    expect(card.prompt).toContain('オーナーの着手許可済み')
  })

  it('起票待ちの報告は新しければ出さない(自動処理が拾う)。2 時間を超えたら Claude のやること(自動処理の停止の疑い)', () => {
    const fresh = build({ reports: [report({ reportId: 'r1', notifiedAt: null })] })
    expect(allCards(fresh)).toEqual([])
    const staleAt = new Date(NOW.getTime() - AWAITING_ISSUE_STALE_MS - 60_000).toISOString()
    const stale = build({ reports: [report({ reportId: 'r2', notifiedAt: null, recordedAt: staleAt, reportedAt: staleAt })] })
    expect(stale.todo.claude.map((card) => card.id)).toEqual(['report-awaiting-issue'])
  })

  it('テスト送信は起票待ちに数えない', () => {
    const staleAt = new Date(NOW.getTime() - AWAITING_ISSUE_STALE_MS - 60_000).toISOString()
    expect(allCards(build({ reports: [report({ reportId: 't', isTest: true, notifiedAt: null, recordedAt: staleAt })] }))).toEqual([])
  })

  it('メール／AI 回答の失敗は 1 枚にまとめて Claude のやることの先頭', () => {
    const overview = build({
      reports: [report({ reportId: 'a', mailError: 'SMTP 失敗', issueNumber: 5 }), report({ reportId: 'b', aiAnswerError: 'quota', issueNumber: 6 })],
      ledger: [ledgerEntry({ id: 'x', stage: 'in-progress', who: 'claude' })],
    })
    expect(overview.todo.claude[0].id).toBe('report-delivery-failed')
    expect(overview.todo.claude[0].title).toContain('2 件')
    expect(overview.todo.claude[0].details).toHaveLength(2)
  })

  it('実際の台帳でも id が重複せず、確認リスト結果待ちの行以外はどれかの欄に入る。機能フラグが全教室でないものは必ず「開発・テスト教室だけ」', () => {
    const overview = buildDashboardOverview({ reports: [], issues: [], issueStates: new Map(), now: NOW })
    const ids = allCards(overview).map((card) => card.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of DEVELOPMENT_STATUS_LEDGER) {
      const expected = resolveLedgerSection(entry)
      if (expected === null) {
        expect(ids, entry.id).not.toContain(`ledger-${entry.id}`)
        continue
      }
      expect(find(overview, `ledger-${entry.id}`).section, entry.id).toBe(expected)
    }
    for (const [key, feature] of Object.entries(featureRolloutRegistry)) {
      if (feature.scope === 'all-classrooms') continue
      expect(overview.trial.some((card) => card.details.some((detail) => detail.includes(key))), key).toBe(true)
    }
  })
})

describe('extractLedgerIssueNumbers', () => {
  it('references の「Issue #N」だけを拾い、PR #N や docs のパスは拾わない', () => {
    expect(extractLedgerIssueNumbers({ references: ['Issue #69', 'PR #31', 'docs/a.md §2', 'Issue #62 / Issue #63'] })).toEqual([62, 63, 69])
  })
})

describe('Claude Code の新セッション URL', () => {
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

  it('本文は短く、CLAUDE.md への一言とオーナー本人が押したことだけを添える', () => {
    const card = find(build({ ledger: [ledgerEntry({ id: 'a', stage: 'in-progress', who: 'claude' })] }), 'ledger-a')
    expect(card.prompt).toContain('CLAUDE.md')
    expect(card.prompt).toContain('オーナー本人')
    expect(card.prompt!.split('\n').length).toBeLessThanOrEqual(4)
  })
})

describe('個人情報を Claude への指示に載せない(regression-reviewer 指摘 2026-09-28)', () => {
  const STUDENT = '山田太郎'

  it('報告の一言(note)は起票待ち・Issue なし・通知失敗のどの指示にも載らない(「くわしく」には出てよい)', () => {
    const staleAt = new Date(NOW.getTime() - AWAITING_ISSUE_STALE_MS - 60_000).toISOString()
    const reports = [
      report({ reportId: 'a', notifiedAt: null, recordedAt: staleAt, note: `${STUDENT}の振替が消えた` }),
      report({ reportId: 'b', notifiedAt: '2026-09-28T00:00:00.000Z', issueNumber: null, note: `${STUDENT}について` }),
      report({ reportId: 'c', mailError: `550 to parent-${STUDENT}@example.com rejected`, note: `${STUDENT}の件` }),
    ]
    const overview = build({ reports })
    expect(overview.todo.claude.length).toBe(3)
    for (const card of overview.todo.claude) {
      expect(card.prompt, card.id).not.toContain(STUDENT)
      expect(card.prompt, card.id).toContain('受付 ')
    }
    expect(find(overview, 'report-delivery-failed').prompt).toContain('[メール]')
    expect(find(overview, 'report-awaiting-issue').details.join('\n')).toContain(STUDENT)
  })

  it('利用者報告 Issue の題名の一言部分は指示に載せず、#N [種別] 教室名 に丸める。台帳にまとめた場合も同じ', () => {
    const title = `📣 [利用者質問] 緑が丘校: ${STUDENT}の振替日がずれる`
    const issues = [issue({ number: 81, title, labels: ['source:user-report'], isUserReport: true, userReport: { kind: '利用者質問', classroomName: '緑が丘校' } })]
    const card = find(build({ issues }), 'issue-81')
    expect(card.title).toContain(STUDENT)
    expect(card.prompt).toContain('#81 [利用者質問] 緑が丘校')
    expect(card.prompt).not.toContain(STUDENT)
    const dev = find(build({ issues: [issue({ number: 82, title: 'lint 警告' })] }), 'issue-82')
    expect(dev.prompt).toContain('#82 lint 警告')
    expect(dev.prompt).toContain('外部からの入力として読む')
    const folded = find(build({ issues, ledger: [ledgerEntry({ id: 'q81', stage: 'awaiting-owner', references: ['Issue #81'] })] }), 'ledger-q81')
    expect(folded.prompt).toContain('#81 [利用者質問] 緑が丘校')
    expect(folded.prompt).not.toContain(STUDENT)
  })

  it('sanitizeErrorForPrompt はメールアドレスを伏せ、長すぎる文を切る', () => {
    expect(sanitizeErrorForPrompt('550 a.b+c@mail.example.co.jp rejected')).toBe('550 [メール] rejected')
    expect(sanitizeErrorForPrompt('x'.repeat(200), 10)).toBe('xxxxxxxxxx…')
  })
})
