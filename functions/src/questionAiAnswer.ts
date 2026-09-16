// 「質問・要望」の質問に AI がその場で回答する(試験実装・開発用教室のみ。オーナー指示 2026-09-14)。
//
// 位置づけ: docs/spec-developer-report.md §G-7。§G-1「AI 即答は作らない」を**開発用教室に限って**試す例外。
//  - 対象は category=question かつ 検証用教室だけ(isDevelopmentClassroomIdentity(workspaceKey, classroomId) =
//    登録台帳 src/utils/developmentClassroomRegistry.ts に (会社, 教室ID) があるか)。本番教室では呼ばない。
//  - 質問は従来どおり developerReports へ記録・メール通知される(AI 回答は「上乗せ」。記録を置き換えない)。
//  - AI に渡すのは **利用者マニュアル(docs/user-manual.md)＋質問文＋直近の操作履歴** だけ。
//    教室データ(スナップショット)は渡さない(オーナー確定 2026-09-14)。
//  - モデルは Claude Sonnet 最新(オーナー確定 2026-09-14)。**Claude on Google Cloud(Vertex AI)経由**で呼ぶ
//    (オーナー指示 2026-09-14「請求先を増やしたくない」＝GCP の請求にまとめる)。API キーは使わない:
//    Cloud Functions の実行サービスアカウント(ADC)で認証し、プロジェクトは実行中の GCP プロジェクト。
//    Vertex AI API 未有効・モデル未有効化・権限不足のときは、その旨を短く返す(報告本体は成功のまま)。
//  - 回答文の制約は §G-4 の基準に合わせる(個別教室の中身・約束・料金・不可逆操作の指示・個人情報を書かない)。
//
// この 1 ファイルは SDK 呼び出し以外を純関数に保ち、テストで固定する。

import Anthropic from '@anthropic-ai/sdk'
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk'

import type { DeveloperReportCategory, NormalizedDeveloperReportTraceEntry } from './developerReport'
import { USER_MANUAL_MARKDOWN } from './generated/userManual'

/** 回答に使うモデル(Sonnet 最新。オーナー確定 2026-09-14)。Vertex AI でも同じ ID(接頭辞・日付なし)。 */
export const QUESTION_AI_MODEL = 'claude-sonnet-5'
/** Vertex AI のリージョン。既定は `global` エンドポイント(推奨)。env QUESTION_AI_VERTEX_REGION で上書き可。 */
export const QUESTION_AI_VERTEX_DEFAULT_REGION = 'global'
/** AI に渡す操作履歴の件数(新しい方から)。質問の文脈が分かれば足りるので絞る。 */
export const QUESTION_AI_TRACE_LIMIT = 40
/** 利用者へ返す回答文の上限(異常に長い出力で画面が埋まらないように)。 */
export const QUESTION_AI_ANSWER_CHAR_LIMIT = 4000
/** API 呼び出しのタイムアウト(ミリ秒)。callable 全体(180 秒)に収まるようにする。 */
export const QUESTION_AI_TIMEOUT_MS = 90_000

/** AI 即時回答を行うか。質問 × 開発用教室 × 確認リストではない、のときだけ。 */
export function shouldAnswerQuestionWithAi(input: { category: DeveloperReportCategory; isDevelopmentClassroom: boolean; isVerificationChecklist: boolean }): boolean {
  return input.category === 'question' && input.isDevelopmentClassroom && !input.isVerificationChecklist
}

export function buildQuestionAiSystemPrompt(manualMarkdown: string = USER_MANUAL_MARKDOWN): string {
  return [
    'あなたは学習塾向け「コマ表アプリ」の使い方サポート担当です。教室の利用者(室長・スタッフ)からの質問に、日本語でその場で回答します。',
    '',
    '# 回答の根拠',
    '- 下の「利用者マニュアル」に書かれている内容だけを根拠にしてください。マニュアルに無いこと・〔未執筆〕の章については推測で手順を作らず、「マニュアルに記載が無いため、開発者が確認してから回答します」と伝えてください。',
    '- 直近の操作履歴は「利用者がどの画面で何をしていたか」を知る手がかりとしてだけ使ってください。',
    '',
    '# 回答に書いてはいけないこと',
    '1. 生徒名・講師名・具体的な配置内容など、個別教室の中身(一般化して書く)。',
    '2. 他の教室の名前や事例。',
    '3. 未リリースの機能や対応時期の約束(「次の更新で直します」等)。',
    '4. 料金・契約・請求についての確約(「開発者から個別に連絡します」と伝える)。',
    '5. データの復元・削除・ロールバックなど取り消せない操作の手順(「開発者にご相談ください」と伝える)。',
    '6. メールアドレス・ID・トークン・保存先パスなどの内部情報。',
    '',
    '# 書き方',
    '- 画面に出ている言葉(ボタン名・メニュー名)で、手順は番号付きで短く書いてください。Markdown の見出しや表は使わず、プレーンテキストで書いてください。',
    '- 不具合の可能性がある内容なら、その旨を添えてください(質問は開発者にも届いています)。',
    '',
    '# 利用者マニュアル',
    manualMarkdown,
  ].join('\n')
}

export function buildQuestionAiUserMessage(input: {
  note: string
  screen: string
  scheduleContext: Record<string, string>
  recentOperations: NormalizedDeveloperReportTraceEntry[]
}): string {
  const operations = input.recentOperations.slice(-QUESTION_AI_TRACE_LIMIT)
  const contextLines = Object.entries(input.scheduleContext).map(([key, value]) => `- ${key}: ${value}`)
  return [
    '# 質問',
    input.note,
    '',
    '# 質問したときの画面',
    input.screen || '(不明)',
    ...(contextLines.length > 0 ? ['', '# 日程表で表示していた条件', ...contextLines] : []),
    '',
    `# 直近の操作履歴(新しい方の最大 ${QUESTION_AI_TRACE_LIMIT} 件・古い順)`,
    ...(operations.length > 0 ? operations.map((entry) => `- ${entry.at} [${entry.kind}] ${entry.summary}`) : ['(なし)']),
  ].join('\n')
}

/** 応答のテキストブロックだけを連結して回答文にする。空なら null。 */
export function extractQuestionAiAnswerText(message: Pick<Anthropic.Message, 'content' | 'stop_reason'>): string | null {
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim()
  if (!text) return null
  return text.length > QUESTION_AI_ANSWER_CHAR_LIMIT ? `${text.slice(0, QUESTION_AI_ANSWER_CHAR_LIMIT)}…` : text
}

export type QuestionAiAnswerResult =
  | { ok: true; answer: string; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string }

/** 利用者へ見せてよい失敗理由に丸める(内部のスタックや鍵の断片を出さない)。 */
export function describeQuestionAiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'AI(Vertex AI)の認証に失敗しました'
  if (error instanceof Anthropic.PermissionDeniedError) return 'Vertex AI の権限がありません(API の有効化・実行サービスアカウントの権限を確認してください)'
  if (error instanceof Anthropic.NotFoundError) return 'Vertex AI で Claude のモデルが見つかりません(Model Garden でモデルを有効化してください)'
  if (error instanceof Anthropic.RateLimitError) return 'AI が混み合っています(Vertex AI の割り当て上限)'
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'AI の応答が時間内に返りませんでした'
  if (error instanceof Anthropic.APIError) return `AI の呼び出しに失敗しました(${error.status ?? '不明'})`
  return 'AI の呼び出しに失敗しました'
}

export type CreateQuestionAiMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>

export async function generateQuestionAiAnswer(
  input: Parameters<typeof buildQuestionAiUserMessage>[0],
  deps: { projectId: string; region?: string; createMessage?: CreateQuestionAiMessage },
): Promise<QuestionAiAnswerResult> {
  if (!deps.projectId) return { ok: false, error: 'AI 回答の設定(GCP プロジェクト)が分かりません' }
  const createMessage: CreateQuestionAiMessage = deps.createMessage ?? ((params) => {
    // 認証は実行サービスアカウントの ADC(google-auth-library)。キーは持たない。
    const client = new AnthropicVertex({
      projectId: deps.projectId,
      region: deps.region || QUESTION_AI_VERTEX_DEFAULT_REGION,
      timeout: QUESTION_AI_TIMEOUT_MS,
      maxRetries: 1,
    })
    return client.messages.create(params)
  })
  try {
    const message = await createMessage({
      model: QUESTION_AI_MODEL,
      max_tokens: 8000,
      output_config: { effort: 'medium' },
      system: buildQuestionAiSystemPrompt(),
      messages: [{ role: 'user', content: buildQuestionAiUserMessage(input) }],
    })
    if (message.stop_reason === 'refusal') return { ok: false, error: 'AI がこの質問への回答を控えました' }
    const answer = extractQuestionAiAnswerText(message)
    if (!answer) return { ok: false, error: 'AI から回答文が返りませんでした' }
    return { ok: true, answer, model: message.model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
  } catch (error) {
    return { ok: false, error: describeQuestionAiError(error) }
  }
}
