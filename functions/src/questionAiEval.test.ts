import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import { VERIFICATION_CHECKLIST } from '../../src/utils/verificationChecklist'
import { QUESTION_AI_MODEL, type CreateQuestionAiMessage } from './questionAiAnswer'
import { formatQuestionAiEvalReport, runQuestionAiEval, summarizeQuestionAiEval } from './questionAiEval'
import { QUESTION_AI_EVAL_CASES } from './questionAiEvalCases'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function textMessage(text: string): Anthropic.Message {
  return {
    id: 'msg', type: 'message', role: 'assistant', model: QUESTION_AI_MODEL,
    content: [{ type: 'text', text, citations: null }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 6000, output_tokens: 400 } as Anthropic.Usage,
  } as Anthropic.Message
}

describe('質問 AI 回答の評価(2026-10-16 オーナー指示「テスト質問と回答はあなたの方で」)', () => {
  it('評価の 20 問は確認リスト qa-q01〜q20 と同じ質問文・見るところ(片方だけ直して食い違わない)', () => {
    expect(QUESTION_AI_EVAL_CASES).toHaveLength(20)
    const byId = new Map(VERIFICATION_CHECKLIST.items.map((item) => [item.id, item]))
    QUESTION_AI_EVAL_CASES.forEach((evalCase, index) => {
      expect(evalCase.id).toBe(`qa-q${String(index + 1).padStart(2, '0')}`)
      const item = byId.get(evalCase.id)!
      expect(item, evalCase.id).toBeDefined()
      expect(item.title).toBe(`Q${index + 1} ${evalCase.title}`)
      expect(item.steps[0]).toContain(`「${evalCase.question} #テスト」`)
      for (const expectation of evalCase.expectations) expect(item.check, evalCase.id).toContain(expectation)
    })
  })

  it('本番と同じ generateQuestionAiAnswer へ 1 問ずつ流し、他教室名の検査も効かせる', async () => {
    const createMessage = vi.fn<CreateQuestionAiMessage>(async (params) => {
      const content = params.messages[0].content as string
      if (content.includes('料金')) return textMessage('月額 5,000 円です。')
      if (content.includes('他の校舎')) return textMessage('緑が丘校ではこう使っています。')
      return textMessage('基本データから登録します。')
    })
    let clock = 0
    const results = await runQuestionAiEval(QUESTION_AI_EVAL_CASES, { apiKey: 'sk-test', createMessage, now: () => (clock += 500) })
    expect(createMessage).toHaveBeenCalledTimes(20)
    // 質問文に #テスト は付けない(評価は確認リストと違い Issue を作らないので印が要らない)。
    expect(createMessage.mock.calls[0][0].messages[0].content).toContain(QUESTION_AI_EVAL_CASES[0].question)
    const price = results.find((entry) => entry.case.id === 'qa-q17')!
    expect(price.result).toMatchObject({ ok: false, error: '回答の決まりに反したため表示しませんでした(金額)', blockedAnswer: '月額 5,000 円です。' })
    const other = results.find((entry) => entry.case.id === 'qa-q18')!
    expect(other.result).toMatchObject({ ok: false, error: '回答の決まりに反したため表示しませんでした(他教室)' })
    const summary = summarizeQuestionAiEval(results)
    expect(summary).toMatchObject({ shown: 18, blocked: 2, failed: 0, inputTokens: 120000, outputTokens: 8000 })
    // Haiku 5.5: 入力 $0.10・出力 $0.50 / 100 万トークン、1 ドル 150 円 → (0.012 + 0.004) × 150 = 2.4 円。
    expect(summary.costYen).toBe(2.4)
    const report = formatQuestionAiEvalReport(results, { ranAt: '2026-10-16T00:00:00.000Z' })
    expect(report).toContain('表示 18 件 / 決まりに反して止めた 2 件 / 失敗 0 件')
    expect(report).toContain('## Q17 料金(金額を答えない) — 止めた(回答の決まりに反したため表示しませんでした(金額))')
    expect(report).toContain('回答(室長には表示しない):\n> 月額 5,000 円です。')
    expect(report).toContain('回答(室長に表示):\n> 基本データから登録します。')
  })

  it('Actions「Question AI eval」は手動実行だけで、secret の鍵を使い Firestore に触れない', () => {
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/question-ai-eval.yml'), 'utf8')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/^\s+push:/mu)
    expect(workflow).toContain('ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}')
    expect(workflow).not.toContain('RE_FIREBASE_SERVICE_ACCOUNT')
    const tool = readFileSync(resolve(repoRoot, 'functions/tools/question-ai-eval.mjs'), 'utf8')
    expect(tool).not.toContain('firebase-admin')
  })
})
