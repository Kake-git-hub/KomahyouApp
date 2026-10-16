// QA 候補パック(tools/question-qa-digest.mjs)の純関数の回帰防止。Firestore は呼ばない(import しても main は走らない)。
import { describe, expect, it } from 'vitest'

import {
  buildQaDigestMarkdown,
  buildRunQueryBody,
  parseArgs,
  parseCurationLog,
  QA_CURATION_INSTRUCTIONS,
  selectReportsForQaDigest,
  summarizeQaDigest,
  toDigestReport,
  validateArgs,
} from './question-qa-digest.mjs'

const report = (overrides) => toDigestReport({
  reportId: '20261010-120000000-aaaaaa',
  recordedAt: '2026-10-10T03:00:00.000Z',
  classroomId: 'v8OZ7zH8vONNHjjYVcR1',
  classroomName: '開発用教室',
  category: 'question',
  note: '休みにした生徒の振替先を後から変えるには？',
  aiAnswer: '未消化振替の一覧から選び直せます。',
  aiAnswerModel: 'claude-sonnet-5-5',
  ...overrides,
})

describe('question-qa-digest: 引数', () => {
  it('--workspace は必須。--since は日付の形だけ受ける', () => {
    expect(parseArgs(['--workspace', 'main', '--since', '2026-09-01', '--all']).workspaceKey).toBe('main')
    expect(parseArgs(['--workspace', 'main', '--all']).all).toBe(true)
    expect(validateArgs(parseArgs([]))).toEqual(['--workspace <key> は必須です。'])
    expect(validateArgs(parseArgs(['--workspace', 'main', '--since', '9/1']))).toEqual(['--since は YYYY-MM-DD で指定してください。'])
    expect(validateArgs(parseArgs(['--workspace', 'main']))).toEqual([])
  })

  it('Firestore の問い合わせは教室の等価フィルタだけ(複合インデックス不要)。教室未指定なら全件', () => {
    expect(buildRunQueryBody({ classroomId: 'c1' }).structuredQuery.where.fieldFilter.value).toEqual({ stringValue: 'c1' })
    expect(buildRunQueryBody({ classroomId: '' }).structuredQuery).not.toHaveProperty('where')
  })
})

describe('question-qa-digest: 整理済みの記録と選別', () => {
  it('記録の表の 1 列目から受付番号を読む(バッククォートの有無を問わない)', () => {
    const log = [
      '# 記録', '', '| 受付番号 | 処理日 | 結果 | 反映先 |', '|---|---|---|---|',
      '| `20261010-120000000-aaaaaa` | 2026-10-16 | QA 追加 | 11 章 |',
      '| 20261011-120000000-bbbbbb | 2026-10-16 | 対象外 | |',
      '| not-an-id | 2026-10-16 | | |',
    ].join('\n')
    expect([...parseCurationLog(log)]).toEqual(['20261010-120000000-aaaaaa', '20261011-120000000-bbbbbb'])
    expect(parseCurationLog('').size).toBe(0)
  })

  it('質問・要望だけを残し、テスト・確認リスト・整理済み・期間外を除いて古い順に並べる', () => {
    const reports = [
      report({ reportId: '20261012-000000000-c00001', recordedAt: '2026-10-12T00:00:00.000Z' }),
      report({ reportId: '20261011-000000000-c00002', recordedAt: '2026-10-11T00:00:00.000Z', category: 'request', note: '印刷を A3 にしたい' }),
      report({ reportId: '20261011-000000000-c00003', recordedAt: '2026-10-11T00:00:00.000Z', category: 'bug' }),
      report({ reportId: '20261011-000000000-c00004', recordedAt: '2026-10-11T00:00:00.000Z', isTest: true }),
      report({ reportId: '20261011-000000000-c00005', recordedAt: '2026-10-11T00:00:00.000Z', note: '[確認リスト v1.5.604]\n…' }),
      report({ reportId: '20261001-000000000-c00006', recordedAt: '2026-10-01T00:00:00.000Z' }),
      report({ reportId: '20261013-000000000-c00007', recordedAt: '2026-10-13T00:00:00.000Z' }),
    ]
    const selected = selectReportsForQaDigest(reports, { sinceIso: '2026-10-05T00:00:00.000Z', processedIds: new Set(['20261013-000000000-c00007']) })
    expect(selected.map((entry) => entry.reportId)).toEqual(['20261011-000000000-c00002', '20261012-000000000-c00001'])
    // --all なら整理済みも載せる(見直し用)。
    expect(selectReportsForQaDigest(reports, { sinceIso: '2026-10-05T00:00:00.000Z', processedIds: new Set(['20261013-000000000-c00007']), includeAll: true }).map((entry) => entry.reportId)).toContain('20261013-000000000-c00007')
  })

  it('受付番号は文書パスの末尾からも拾い、確認リストの印は本文からも判定する', () => {
    expect(toDigestReport({ documentPath: 'projects/p/databases/(default)/documents/workspaces/main/developerReports/20261010-120000000-zzzzzz', note: 'x' }).reportId).toBe('20261010-120000000-zzzzzz')
    expect(toDigestReport({ reportId: 'r', note: '[確認リスト v1.5.604] OK' }).isVerificationChecklist).toBe(true)
  })
})

describe('question-qa-digest: パック本文', () => {
  it('先頭に整理の指示文、要約、AI が答えられなかった質問を最優先に、最後に記録用の表の雛形', () => {
    const reports = [
      report({ reportId: '20261010-000000000-d00001', aiAnswer: '', aiAnswerError: '回答の決まりに反したため表示しませんでした(謝罪)', aiAnswerBlocked: '申し訳ありません。' }),
      report({ reportId: '20261011-000000000-d00002', recordedAt: '2026-10-11T03:00:00.000Z', answerFinal: '未消化振替の一覧で選び直してください。', answeredAt: '2026-10-12T00:00:00.000Z', aiAnswerShadow: 'Haiku の回答', aiAnswerShadowModel: 'claude-haiku-5-5', aiAnswerDigestStudents: ['山田 太郎'] }),
      report({ reportId: '20261012-000000000-d00003', recordedAt: '2026-10-12T03:00:00.000Z', category: 'request', note: '印刷を A3 にしたい', aiAnswer: '', issueNumber: 80, resolvedAt: '2026-10-13T00:00:00.000Z' }),
    ]
    const markdown = buildQaDigestMarkdown(reports, { workspaceKey: 'main', sinceLabel: '2026-07-18 以降', generatedAt: '2026-10-16T05:00:00.000Z' })
    expect(markdown.startsWith(QA_CURATION_INSTRUCTIONS)).toBe(true)
    expect(QA_CURATION_INSTRUCTIONS).toContain('オーナーの承認を得てから')
    expect(QA_CURATION_INSTRUCTIONS).toContain('docs/qa-curation-log.md')
    expect(markdown).toContain('# QA 候補パック(main・2026-07-18 以降・作成 2026-10-16 14:00)')
    expect(markdown).toContain('- 件数 3(質問 2・要望 1)。')
    expect(markdown).toContain('- AI 即時回答: 表示 1 / 答えられなかった 1 / 呼んでいない(本番教室・要望など) 1')
    expect(markdown).toContain('開発者の回答あり 1(うち AI の回答も両方あり 1 → 食い違いを見る)/ 解決済み 1')
    // 最優先の節に、AI が答えられなかった質問だけが入る。
    const priority = markdown.slice(markdown.indexOf('## 最優先'), markdown.indexOf('## そのほか'))
    expect(priority).toContain('20261010-000000000-d00001')
    expect(priority).toContain('AI は答えられなかった: 回答の決まりに反したため表示しませんでした(謝罪)')
    expect(priority).toContain('> 申し訳ありません。')
    expect(priority).not.toContain('20261011-000000000-d00002')
    // そのほかの節に、AI と開発者の両方の回答・影の回答・数字を渡した生徒の人数・Issue・解決済みが出る。
    expect(markdown).toContain('AI の回答(室長に表示・claude-sonnet-5-5・数字を渡した生徒 1 人):')
    expect(markdown).toContain('比較用(claude-haiku-5-5)の回答:\n> Haiku の回答')
    expect(markdown).toContain('開発者の回答(2026-10-12 09:00):\n> 未消化振替の一覧で選び直してください。')
    expect(markdown).toContain('— 要望 / 開発用教室 / 2026-10-12 12:00')
    expect(markdown).toContain('状態: 解決済み / Issue #80')
    expect(markdown).toContain('| `20261010-000000000-d00001` | 2026-10-16 | (QA 追加／本文修正／要望 Issue／保留／対象外) | |')
    expect(summarizeQaDigest([])).toMatchObject({ total: 0, aiFailed: 0 })
  })
})
