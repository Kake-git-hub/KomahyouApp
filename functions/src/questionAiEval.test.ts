import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import { VERIFICATION_CHECKLIST } from '../../src/utils/verificationChecklist'
import { QUESTION_AI_COMPARISON_MODEL, QUESTION_AI_MODEL, type CreateQuestionAiMessage } from './questionAiAnswer'
import { formatQuestionAiEvalComparisonReport, formatQuestionAiEvalReport, QUESTION_AI_EVAL_COMPARISON_MODELS, QUESTION_AI_EVAL_MODELS, runQuestionAiEval, runQuestionAiEvalForModels, summarizeQuestionAiEval } from './questionAiEval'
import { QUESTION_AI_EVAL_CASES, QUESTION_AI_EVAL_STUDENT_LEDGER } from './questionAiEvalCases'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function textMessage(text: string): Anthropic.Message {
  return {
    id: 'msg', type: 'message', role: 'assistant', model: QUESTION_AI_MODEL,
    content: [{ type: 'text', text, citations: null }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 6000, output_tokens: 400 } as Anthropic.Usage,
  } as Anthropic.Message
}

describe('質問 AI 回答の評価(2026-10-16 オーナー指示「テスト質問と回答はあなたの方で」)', () => {
  it('評価の 23 問は qa-q01〜q23 の連番で、質問文と見るところを持つ(確認リストには載せない・2026-10-24 オーナー指示)', () => {
    expect(QUESTION_AI_EVAL_CASES).toHaveLength(23)
    QUESTION_AI_EVAL_CASES.forEach((evalCase, index) => {
      expect(evalCase.id).toBe(`qa-q${String(index + 1).padStart(2, '0')}`)
      expect(evalCase.title.trim(), evalCase.id).not.toBe('')
      expect(evalCase.question.trim(), evalCase.id).not.toBe('')
      expect(evalCase.question, evalCase.id).not.toContain('#テスト')
      expect(evalCase.expectations.length, evalCase.id).toBeGreaterThan(0)
    })
    // 確認リストの「質問への AI 自動回答(20 問)」は不要(受付 20261024-062027562-37618588 のその他欄)。正本はこの評価だけ。
    const checklistIds = new Set(VERIFICATION_CHECKLIST.items.map((item) => item.id))
    for (const evalCase of QUESTION_AI_EVAL_CASES) expect(checklistIds, evalCase.id).not.toContain(evalCase.id)
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
    expect(createMessage).toHaveBeenCalledTimes(23)
    // 質問文に #テスト は付けない(評価は確認リストと違い Issue を作らないので印が要らない)。
    expect(createMessage.mock.calls[0][0].messages[0].content).toContain(QUESTION_AI_EVAL_CASES[0].question)
    const price = results.find((entry) => entry.case.id === 'qa-q17')!
    expect(price.result).toMatchObject({ ok: false, error: '回答の決まりに反したため表示しませんでした(金額)', blockedAnswer: '月額 5,000 円です。' })
    const other = results.find((entry) => entry.case.id === 'qa-q18')!
    expect(other.result).toMatchObject({ ok: false, error: '回答の決まりに反したため表示しませんでした(他教室)' })
    const summary = summarizeQuestionAiEval(results)
    expect(summary).toMatchObject({ shown: 21, blocked: 2, failed: 0, inputTokens: 138000, outputTokens: 9200 })
    // Haiku 5.5(オーナー確定 2026-10-16 夜): 入力 $0.1・出力 $0.5 / 100 万トークン、1 ドル 150 円 → (0.0138 + 0.0046) × 150 = 2.76 円。
    expect(summary.costYen).toBe(2.76)
    // 妥協案 B: 山田太郎の質問には評価用の台帳から作った数字が渡り、名前の無い質問には「見つからなかった」の一文が渡る。
    const yamada = createMessage.mock.calls.find(([params]) => (params.messages[0].content as string).includes('山田太郎さんの振替'))!
    expect(yamada[0].messages[0].content).toContain('## 山田 太郎')
    expect(yamada[0].messages[0].content).toContain('未消化振替 残 2 回(元コマ: 10/2(金) 2限(休み) / 10/9(金) 2限(休み))')
    expect(yamada[0].messages[0].content).not.toContain('佐藤')
    expect(createMessage.mock.calls[0][0].messages[0].content).toContain('質問文に名簿の生徒名は見つかりませんでした')
    const report = formatQuestionAiEvalReport(results, { ranAt: '2026-10-16T00:00:00.000Z' })
    expect(report).toContain('表示 21 件 / 決まりに反して止めた 2 件 / 失敗 0 件')
    expect(report).toContain('## Q17 料金(金額を答えない) — 止めた(回答の決まりに反したため表示しませんでした(金額))')
    expect(report).toContain('回答(室長には表示しない):\n> 月額 5,000 円です。')
    expect(report).toContain('回答(室長に表示):\n> 基本データから登録します。')
  })

  it('既定は本番と同じ 1 モデル(Haiku)。compare では比較用(Sonnet)も流し、モデルごとの費用と 1 問ごとの回答を並べる(2026-10-16 夜)', async () => {
    const createMessage = vi.fn<CreateQuestionAiMessage>(async (params) => {
      const content = params.messages[0].content as string
      // 比較用(Sonnet)が質問に出ていない生徒の名前を出したら「他の生徒」で止まる(妥協案 B の歯止め)。
      if (params.model === QUESTION_AI_COMPARISON_MODEL && content.includes('全員教えてください')) return { ...textMessage('佐藤花子さんと山田太郎さんです。'), model: QUESTION_AI_COMPARISON_MODEL } as Anthropic.Message
      return { ...textMessage('案内です。'), model: params.model } as Anthropic.Message
    })
    expect(QUESTION_AI_EVAL_MODELS).toEqual(['claude-haiku-5-5'])
    expect(QUESTION_AI_EVAL_COMPARISON_MODELS).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5'])
    const runs = await runQuestionAiEvalForModels(QUESTION_AI_EVAL_CASES, QUESTION_AI_EVAL_COMPARISON_MODELS, { apiKey: 'sk-test', createMessage, now: () => 0 })
    expect(runs.map((run) => run.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5'])
    expect(createMessage).toHaveBeenCalledTimes(46)
    expect(createMessage.mock.calls.filter(([params]) => params.model === 'claude-haiku-5-5')).toHaveLength(23)
    const comparison = runs[1].results.find((entry) => entry.case.id === 'qa-q23')!
    expect(comparison.result).toMatchObject({ ok: false, error: '回答の決まりに反したため表示しませんでした(他の生徒)' })
    expect(QUESTION_AI_EVAL_STUDENT_LEDGER.rows.map((row) => row.name)).toEqual(['山田 太郎', '佐藤 花子'])
    const report = formatQuestionAiEvalComparisonReport(runs, { ranAt: '2026-10-16T00:00:00.000Z' })
    expect(report).toContain('# 質問 AI 回答の評価(23 問 × 2 モデル)')
    // Haiku 5.5: 入力 $0.1・出力 $0.5 → (0.0138 + 0.0046) × 150 = 2.76 円。Sonnet は 55.2 円。
    expect(report).toContain('| claude-haiku-5-5 | 23 | 0 | 0 | 138000 | 9200 | 約 2.76 円 | 約 0.12 円 |')
    expect(report).toContain('| claude-sonnet-5-5 | 22 | 1 | 0 | 138000 | 9200 | 約 55.2 円 | 約 2.4 円 |')
    expect(report).toContain('### claude-sonnet-5-5 — 止めた(回答の決まりに反したため表示しませんでした(他の生徒))')
    // 既定(1 モデル)の実行でも同じ関数で通る。
    const single = await runQuestionAiEvalForModels(QUESTION_AI_EVAL_CASES, QUESTION_AI_EVAL_MODELS, { apiKey: 'sk-test', createMessage, now: () => 0 })
    expect(single.map((run) => run.model)).toEqual(['claude-haiku-5-5'])
    expect(formatQuestionAiEvalComparisonReport(single, { ranAt: '2026-10-16T00:00:00.000Z' })).toContain('# 質問 AI 回答の評価(23 問 × 1 モデル)')
  })

  it('Actions「Question AI eval」は手動実行だけで、secret の鍵を使い Firestore に触れない', () => {
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/question-ai-eval.yml'), 'utf8')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/^\s+push:/mu)
    expect(workflow).toContain('ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}')
    // 比較(Sonnet も流す)は入力 compare で選ぶ(既定 false・費用約 20 倍)。
    expect(workflow).toContain("QUESTION_AI_EVAL_COMPARE: ${{ inputs.compare && '1' || '0' }}")
    expect(workflow).toMatch(/compare:\n\s+description:/u)
    expect(workflow).not.toContain('RE_FIREBASE_SERVICE_ACCOUNT')
    const tool = readFileSync(resolve(repoRoot, 'functions/tools/question-ai-eval.mjs'), 'utf8')
    expect(tool).not.toContain('firebase-admin')
    expect(tool).toContain("process.env.QUESTION_AI_EVAL_COMPARE === '1' ? QUESTION_AI_EVAL_COMPARISON_MODELS : QUESTION_AI_EVAL_MODELS")
  })
})
