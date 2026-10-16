// 質問 AI 回答の評価を流す(Actions「Question AI eval」から実行)。functions をビルドした lib を使う。
// 必要: env ANTHROPIC_API_KEY。結果は標準出力・$GITHUB_STEP_SUMMARY・question-ai-eval-result.md に出す。Firestore には触れない。
// 2026-10-16 夜: 既定は本番と同じ 1 モデル(Haiku)。env QUESTION_AI_EVAL_COMPARE=1(Actions の入力 compare)なら比較用(Sonnet)も流して 1 問ごとに並べる。
import { appendFileSync, writeFileSync } from 'node:fs'
import evalModule from '../lib/questionAiEval.js'
import casesModule from '../lib/questionAiEvalCases.js'

const { formatQuestionAiEvalComparisonReport, QUESTION_AI_EVAL_COMPARISON_MODELS, QUESTION_AI_EVAL_MODELS, runQuestionAiEvalForModels, summarizeQuestionAiEval } = evalModule
const { QUESTION_AI_EVAL_CASES } = casesModule

const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY が未設定です(リポジトリ secret を確認してください)')
  process.exit(1)
}

const models = process.env.QUESTION_AI_EVAL_COMPARE === '1' ? QUESTION_AI_EVAL_COMPARISON_MODELS : QUESTION_AI_EVAL_MODELS
const runs = await runQuestionAiEvalForModels(QUESTION_AI_EVAL_CASES, models, { apiKey })
const report = formatQuestionAiEvalComparisonReport(runs, { ranAt: new Date().toISOString() })
console.log(report)
writeFileSync('question-ai-eval-result.md', report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
// 全モデル・全問が設定・通信の失敗なら赤にする(鍵の間違いなどに気づけるように)。止めた回答は評価の結果なので赤にしない。
if (runs.every((run) => summarizeQuestionAiEval(run.results, run.model).failed === run.results.length)) process.exit(1)
