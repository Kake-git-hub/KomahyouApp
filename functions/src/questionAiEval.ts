// 質問への AI 即時回答の評価(2026-10-16 オーナー指示「テスト質問とテスト回答はあなたの方で行なって、結果を見せて」)。
// 確認用の質問(questionAiEvalCases.ts)を本番と同じ generateQuestionAiAnswer(同じ指示文・同じ機械検査)へ流し、結果を Markdown にまとめる。
// 2026-10-16 夜(オーナー指示「開発中は Sonnet と Haiku の両方で回答し、精度と金額を評価」): 主(Sonnet)と影(Haiku)の 2 モデルで同じ質問を流し、
// 1 問ずつ並べて出す。妥協案 B の「質問に名前が出た生徒の数字」も本番と同じ関数(questionAiStudentDigest.ts)で評価用の台帳から作る。
// Firestore には何も書かない(教室データにも触れない)。実行は Actions「Question AI eval」。

import { buildOtherClassroomNameWords, estimateQuestionAiCostYen, generateQuestionAiAnswer, QUESTION_AI_MODEL, QUESTION_AI_SHADOW_MODEL, QUESTION_AI_YEN_PER_USD, type CreateQuestionAiMessage, type QuestionAiAnswerResult } from './questionAiAnswer'
import { QUESTION_AI_EVAL_NOW, QUESTION_AI_EVAL_STUDENT_LEDGER, type QuestionAiEvalCase } from './questionAiEvalCases'
import { buildQuestionAiStudentDigest } from './questionAiStudentDigest'

/**
 * 他教室名の検査に使う名前(評価用)。開発用教室で質問した想定で、同じ運営会社の本番 3 教室を「他の教室」として渡す
 * (教室名は CLAUDE.md の教室一覧と同じ・個人情報ではない)。
 */
export const QUESTION_AI_EVAL_CURRENT_CLASSROOM = '開発用教室'
export const QUESTION_AI_EVAL_OTHER_CLASSROOMS = ['スクールIE 日大前校', 'スクールIE 緑が丘校', 'スクールIE 薬円台校'] as const
/** 評価で流すモデル(主・影の順)。 */
export const QUESTION_AI_EVAL_MODELS = [QUESTION_AI_MODEL, QUESTION_AI_SHADOW_MODEL] as const

export type QuestionAiEvalResult = { case: QuestionAiEvalCase; result: QuestionAiAnswerResult; elapsedMs: number }
export type QuestionAiEvalModelRun = { model: string; results: QuestionAiEvalResult[] }

export async function runQuestionAiEval(
  cases: readonly QuestionAiEvalCase[],
  deps: { apiKey: string; createMessage?: CreateQuestionAiMessage; now?: () => number; model?: string },
): Promise<QuestionAiEvalResult[]> {
  const now = deps.now ?? (() => Date.now())
  const otherClassroomNames = buildOtherClassroomNameWords({ currentClassroomName: QUESTION_AI_EVAL_CURRENT_CLASSROOM, allClassroomNames: QUESTION_AI_EVAL_OTHER_CLASSROOMS })
  const results: QuestionAiEvalResult[] = []
  // 1 問ずつ順に流す(並列にすると利用上限に当たりやすく、本番の 1 問ずつの呼ばれ方とも違う)。
  for (const evalCase of cases) {
    const startedAt = now()
    // 本番と同じ関数で「質問に名前が出た生徒の数字」を作る(台帳は評価用の架空データ・今日は固定)。
    const digest = buildQuestionAiStudentDigest({ note: evalCase.question, ledger: QUESTION_AI_EVAL_STUDENT_LEDGER, now: QUESTION_AI_EVAL_NOW })
    const result = await generateQuestionAiAnswer({
      note: evalCase.question,
      screen: 'board',
      scheduleContext: {},
      recentOperations: [],
      otherClassroomNames,
      ...(digest ? { studentDigest: digest.text, otherStudentNames: digest.otherStudentNames } : {}),
    }, { apiKey: deps.apiKey, createMessage: deps.createMessage, model: deps.model })
    results.push({ case: evalCase, result, elapsedMs: now() - startedAt })
  }
  return results
}

/** 主・影の順に、同じ質問を各モデルへ流す(モデルごとに 1 問ずつ)。 */
export async function runQuestionAiEvalForModels(
  cases: readonly QuestionAiEvalCase[],
  models: readonly string[],
  deps: { apiKey: string; createMessage?: CreateQuestionAiMessage; now?: () => number },
): Promise<QuestionAiEvalModelRun[]> {
  const runs: QuestionAiEvalModelRun[] = []
  for (const model of models) runs.push({ model, results: await runQuestionAiEval(cases, { ...deps, model }) })
  return runs
}

export type QuestionAiEvalSummary = { shown: number; blocked: number; failed: number; inputTokens: number; outputTokens: number; costYen: number; averageSeconds: number }

export function summarizeQuestionAiEval(results: readonly QuestionAiEvalResult[], model: string = QUESTION_AI_MODEL): QuestionAiEvalSummary {
  let shown = 0
  let blocked = 0
  let failed = 0
  let inputTokens = 0
  let outputTokens = 0
  let elapsedMs = 0
  for (const { result, elapsedMs: elapsed } of results) {
    if (result.ok) shown += 1
    else if (result.blockedAnswer) blocked += 1
    else failed += 1
    inputTokens += result.inputTokens ?? 0
    outputTokens += result.outputTokens ?? 0
    elapsedMs += elapsed
  }
  return {
    shown,
    blocked,
    failed,
    inputTokens,
    outputTokens,
    costYen: estimateQuestionAiCostYen(model, inputTokens, outputTokens),
    averageSeconds: results.length > 0 ? Math.round((elapsedMs / results.length / 1000) * 10) / 10 : 0,
  }
}

function quoteLines(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n')
}

function describeStatus(result: QuestionAiAnswerResult): string {
  return result.ok ? '表示' : result.blockedAnswer ? `止めた(${result.error})` : `失敗(${result.error})`
}

function describeTokens(result: QuestionAiAnswerResult): string {
  if (result.ok) return `入力 ${result.inputTokens} / 出力 ${result.outputTokens}`
  return result.inputTokens !== undefined ? `入力 ${result.inputTokens} / 出力 ${result.outputTokens ?? 0}` : '—'
}

/** 1 モデルぶんの報告(従来の形)。 */
export function formatQuestionAiEvalReport(results: readonly QuestionAiEvalResult[], meta: { ranAt: string; model?: string }): string {
  const model = meta.model ?? QUESTION_AI_MODEL
  const summary = summarizeQuestionAiEval(results, model)
  const lines = [
    `# 質問 AI 回答の評価(${results.length} 問)`,
    '',
    `- 実行 ${meta.ranAt} / モデル ${model}`,
    `- 表示 ${summary.shown} 件 / 決まりに反して止めた ${summary.blocked} 件 / 失敗 ${summary.failed} 件`,
    `- トークン 入力 ${summary.inputTokens} / 出力 ${summary.outputTokens}(約 ${summary.costYen} 円・1 ドル ${QUESTION_AI_YEN_PER_USD} 円換算)`,
    '',
  ]
  results.forEach(({ case: evalCase, result, elapsedMs }, index) => {
    lines.push(`## Q${index + 1} ${evalCase.title} — ${describeStatus(result)}`)
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
    lines.push(`(${(elapsedMs / 1000).toFixed(1)} 秒・トークン ${describeTokens(result)})`)
    lines.push('')
  })
  return lines.join('\n')
}

/** 複数モデルを並べた報告(2026-10-16 夜)。冒頭にモデルごとの表、以降は 1 問ごとに各モデルの回答。 */
export function formatQuestionAiEvalComparisonReport(runs: readonly QuestionAiEvalModelRun[], meta: { ranAt: string }): string {
  const caseCount = runs[0]?.results.length ?? 0
  const lines = [
    `# 質問 AI 回答の評価(${caseCount} 問 × ${runs.length} モデル)`,
    '',
    `- 実行 ${meta.ranAt}(1 ドル ${QUESTION_AI_YEN_PER_USD} 円換算)`,
    '',
    '| モデル | 表示 | 止めた | 失敗 | 入力トークン | 出力トークン | 費用の目安 | 1 問あたり | 平均秒 |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const run of runs) {
    const summary = summarizeQuestionAiEval(run.results, run.model)
    const perQuestion = run.results.length > 0 ? Math.round((summary.costYen / run.results.length) * 100) / 100 : 0
    lines.push(`| ${run.model} | ${summary.shown} | ${summary.blocked} | ${summary.failed} | ${summary.inputTokens} | ${summary.outputTokens} | 約 ${summary.costYen} 円 | 約 ${perQuestion} 円 | ${summary.averageSeconds} |`)
  }
  lines.push('')
  for (let index = 0; index < caseCount; index += 1) {
    const evalCase = runs[0].results[index].case
    lines.push(`## Q${index + 1} ${evalCase.title}`)
    lines.push('')
    lines.push(`質問: ${evalCase.question}`)
    lines.push('')
    lines.push(`見るところ: ${evalCase.expectations.join(' / ')}`)
    lines.push('')
    for (const run of runs) {
      const entry = run.results[index]
      if (!entry) continue
      lines.push(`### ${run.model} — ${describeStatus(entry.result)}(${(entry.elapsedMs / 1000).toFixed(1)} 秒・トークン ${describeTokens(entry.result)}・約 ${estimateQuestionAiCostYen(run.model, entry.result.inputTokens ?? 0, entry.result.outputTokens ?? 0)} 円)`)
      lines.push('')
      const answer = entry.result.ok ? entry.result.answer : entry.result.blockedAnswer
      if (answer) {
        lines.push(entry.result.ok ? '回答(室長に表示する側のモデルなら表示):' : '回答(表示しない):')
        lines.push(quoteLines(answer))
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}
