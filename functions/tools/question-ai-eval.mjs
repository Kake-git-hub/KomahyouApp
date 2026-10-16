// 質問 AI 回答の評価を流す(Actions「Question AI eval」から実行)。functions をビルドした lib を使う。
// 必要: env ANTHROPIC_API_KEY。結果は標準出力・$GITHUB_STEP_SUMMARY・question-ai-eval-result.md に出す。Firestore には触れない。
import { appendFileSync, writeFileSync } from 'node:fs'
import evalModule from '../lib/questionAiEval.js'
import casesModule from '../lib/questionAiEvalCases.js'

const { formatQuestionAiEvalReport, runQuestionAiEval, summarizeQuestionAiEval } = evalModule
const { QUESTION_AI_EVAL_CASES } = casesModule

const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY が未設定です(リポジトリ secret を確認してください)')
  process.exit(1)
}

const results = await runQuestionAiEval(QUESTION_AI_EVAL_CASES, { apiKey })
const report = formatQuestionAiEvalReport(results, { ranAt: new Date().toISOString() })
console.log(report)
writeFileSync('question-ai-eval-result.md', report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
const summary = summarizeQuestionAiEval(results)
// 全問が設定・通信の失敗なら赤にする(鍵の間違いなどに気づけるように)。止めた回答は評価の結果なので赤にしない。
if (summary.failed === results.length) process.exit(1)
