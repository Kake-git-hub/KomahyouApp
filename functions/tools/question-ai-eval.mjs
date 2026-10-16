// 質問 AI 回答の評価を流す(Actions「Question AI eval」から実行)。functions をビルドした lib を使う。
// 必要: env ANTHROPIC_API_KEY。結果は標準出力・$GITHUB_STEP_SUMMARY・question-ai-eval-result.md に出す。Firestore には触れない。
// 2026-10-16 夜: 主(Sonnet)と影(Haiku)の両方で流し、1 問ごとに並べて比べる(オーナー指示「回答精度と金額の評価をして」)。
import { appendFileSync, writeFileSync } from 'node:fs'
import evalModule from '../lib/questionAiEval.js'
import casesModule from '../lib/questionAiEvalCases.js'

const { formatQuestionAiEvalComparisonReport, QUESTION_AI_EVAL_MODELS, runQuestionAiEvalForModels, summarizeQuestionAiEval } = evalModule
const { QUESTION_AI_EVAL_CASES } = casesModule

const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY が未設定です(リポジトリ secret を確認してください)')
  process.exit(1)
}

const runs = await runQuestionAiEvalForModels(QUESTION_AI_EVAL_CASES, QUESTION_AI_EVAL_MODELS, { apiKey })
const report = formatQuestionAiEvalComparisonReport(runs, { ranAt: new Date().toISOString() })
console.log(report)
writeFileSync('question-ai-eval-result.md', report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
// 全モデル・全問が設定・通信の失敗なら赤にする(鍵の間違いなどに気づけるように)。止めた回答は評価の結果なので赤にしない。
if (runs.every((run) => summarizeQuestionAiEval(run.results, run.model).failed === run.results.length)) process.exit(1)
