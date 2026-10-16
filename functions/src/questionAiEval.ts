// 質問への AI 即時回答の評価(2026-10-16 オーナー指示「テスト質問とテスト回答はあなたの方で行なって、結果を見せて」)。
// 確認用の 20 問(questionAiEvalCases.ts)を本番と同じ generateQuestionAiAnswer(同じ指示文・同じモデル・同じ機械検査)へ流し、
// 結果を Markdown にまとめる。Firestore には何も書かない(教室データにも触れない)。実行は Actions「Question AI eval」。

import { buildOtherClassroomNameWords, generateQuestionAiAnswer, QUESTION_AI_MODEL, type CreateQuestionAiMessage, type QuestionAiAnswerResult } from './questionAiAnswer'
import type { QuestionAiEvalCase } from './questionAiEvalCases'

/** Haiku 5.5 の単価(100K トークン以下のプロンプト・ドル/100 万トークン)と、円換算の目安レート。 */
export const QUESTION_AI_EVAL_PRICE_PER_MTOK = { input: 0.1, output: 0.5 } as const
export const QUESTION_AI_EVAL_YEN_PER_USD = 150

/**
 * 他教室名の検査に使う名前(評価用)。開発用教室で質問した想定で、同じ運営会社の本番 3 教室を「他の教室」として渡す
 * (教室名は CLAUDE.md の教室一覧と同じ・個人情報ではない)。
 */
export const QUESTION_AI_EVAL_CURRENT_CLASSROOM = '開発用教室'
export const QUESTION_AI_EVAL_OTHER_CLASSROOMS = ['スクールIE 日大前校', 'スクールIE 緑が丘校', 'スクールIE 薬円台校'] as const

export type QuestionAiEvalResult = { case: QuestionAiEvalCase; result: QuestionAiAnswerResult; elapsedMs: number }

export async function runQuestionAiEval(
  cases: readonly QuestionAiEvalCase[],
  deps: { apiKey: string; createMessage?: CreateQuestionAiMessage; now?: () => number },
): Promise<QuestionAiEvalResult[]> {
  const now = deps.now ?? (() => Date.now())
  const otherClassroomNames = buildOtherClassroomNameWords({ currentClassroomName: QUESTION_AI_EVAL_CURRENT_CLASSROOM, allClassroomNames: QUESTION_AI_EVAL_OTHER_CLASSROOMS })
  const results: QuestionAiEvalResult[] = []
  // 1 問ずつ順に流す(並列にすると利用上限に当たりやすく、本番の 1 問ずつの呼ばれ方とも違う)。
  for (const evalCase of cases) {
    const startedAt = now()
    const result = await generateQuestionAiAnswer({ note: evalCase.question, screen: 'board', scheduleContext: {}, recentOperations: [], otherClassroomNames }, { apiKey: deps.apiKey, createMessage: deps.createMessage })
    results.push({ case: evalCase, result, elapsedMs: now() - startedAt })
  }
  return results
}

export function summarizeQuestionAiEval(results: readonly QuestionAiEvalResult[]): { shown: number; blocked: number; failed: number; inputTokens: number; outputTokens: number; costYen: number } {
  let shown = 0
  let blocked = 0
  let failed = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const { result } of results) {
    if (result.ok) shown += 1
    else if (result.blockedAnswer) blocked += 1
    else failed += 1
    inputTokens += result.inputTokens ?? 0
    outputTokens += result.outputTokens ?? 0
  }
  const usd = (inputTokens * QUESTION_AI_EVAL_PRICE_PER_MTOK.input + outputTokens * QUESTION_AI_EVAL_PRICE_PER_MTOK.output) / 1_000_000
  return { shown, blocked, failed, inputTokens, outputTokens, costYen: Math.round(usd * QUESTION_AI_EVAL_YEN_PER_USD * 100) / 100 }
}

function quoteLines(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n')
}

export function formatQuestionAiEvalReport(results: readonly QuestionAiEvalResult[], meta: { ranAt: string }): string {
  const summary = summarizeQuestionAiEval(results)
  const lines = [
    `# 質問 AI 回答の評価(${results.length} 問)`,
    '',
    `- 実行 ${meta.ranAt} / モデル ${QUESTION_AI_MODEL}`,
    `- 表示 ${summary.shown} 件 / 決まりに反して止めた ${summary.blocked} 件 / 失敗 ${summary.failed} 件`,
    `- トークン 入力 ${summary.inputTokens} / 出力 ${summary.outputTokens}(約 ${summary.costYen} 円・1 ドル ${QUESTION_AI_EVAL_YEN_PER_USD} 円換算)`,
    '',
  ]
  results.forEach(({ case: evalCase, result, elapsedMs }, index) => {
    const status = result.ok ? '表示' : result.blockedAnswer ? `止めた(${result.error})` : `失敗(${result.error})`
    lines.push(`## Q${index + 1} ${evalCase.title} — ${status}`)
    lines.push('')
    lines.push(`質問: ${evalCase.question}`)
    lines.push('')
    const answer = result.ok ? result.answer : result.blockedAnswer
    if (answer) {
      lines.push(result.ok ? '回答(室長に表示):' : '回答(室長には表示しない):')
      lines.push(quoteLines(answer))
      lines.push('')
    }
    lines.push(`見るところ: ${evalCase.expectations.join(' / ')}`)
    const tokens = result.ok ? `入力 ${result.inputTokens} / 出力 ${result.outputTokens}` : result.inputTokens !== undefined ? `入力 ${result.inputTokens} / 出力 ${result.outputTokens ?? 0}` : '—'
    lines.push(`(${(elapsedMs / 1000).toFixed(1)} 秒・トークン ${tokens})`)
    lines.push('')
  })
  return lines.join('\n')
}
