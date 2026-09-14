import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import { buildUserManualModuleContent, normalizeToLf, USER_MANUAL_OUTPUT_PATH, USER_MANUAL_SOURCE_PATH } from '../scripts/sync-shared.mjs'
import { isDevelopmentClassroomIdentity } from './developmentClassroomIdentity'
import { USER_MANUAL_MARKDOWN } from './generated/userManual'
import {
  buildQuestionAiSystemPrompt,
  buildQuestionAiUserMessage,
  describeQuestionAiError,
  extractQuestionAiAnswerText,
  generateQuestionAiAnswer,
  QUESTION_AI_ANSWER_CHAR_LIMIT,
  QUESTION_AI_MODEL,
  QUESTION_AI_TRACE_LIMIT,
  QUESTION_AI_VERTEX_DEFAULT_REGION,
  shouldAnswerQuestionWithAi,
  type CreateQuestionAiMessage,
} from './questionAiAnswer'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function fakeMessage(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: QUESTION_AI_MODEL,
    content: [{ type: 'text', text: '基本データ画面で生徒を選びます。', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 80 } as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message
}

const baseInput = {
  note: '休みにした生徒の振替先を後から変えるには？',
  screen: 'board',
  scheduleContext: {},
  recentOperations: [],
}

describe('questionAiAnswer: 質問への AI 即時回答(開発用教室のみ・spec-developer-report §G-7)', () => {
  it('AI を呼ぶのは 質問 × 開発用教室 × 確認リストでない ときだけ(本番教室・要望・不具合では呼ばない)', () => {
    const devClassroom = isDevelopmentClassroomIdentity('v8OZ7zH8vONNHjjYVcR1', '開発用教室')
    expect(devClassroom).toBe(true)
    expect(shouldAnswerQuestionWithAi({ category: 'question', isDevelopmentClassroom: devClassroom, isVerificationChecklist: false })).toBe(true)
    // 本番3教室は ID/名前とも開発用教室判定に当たらない＝AI を呼ばない。
    for (const [id, name] of [['5w5OMueETerSKrSf14HC', 'スクールIE 日大前校'], ['KzFnOQoTFLsCxwUp1tvh', 'スクールIE 緑が丘校'], ['6xnnbSTbwgGrBLy0EJKb', 'スクールIE 薬円台校']]) {
      expect(shouldAnswerQuestionWithAi({ category: 'question', isDevelopmentClassroom: isDevelopmentClassroomIdentity(id, name), isVerificationChecklist: false })).toBe(false)
    }
    expect(shouldAnswerQuestionWithAi({ category: 'request', isDevelopmentClassroom: true, isVerificationChecklist: false })).toBe(false)
    expect(shouldAnswerQuestionWithAi({ category: 'bug', isDevelopmentClassroom: true, isVerificationChecklist: false })).toBe(false)
    expect(shouldAnswerQuestionWithAi({ category: 'question', isDevelopmentClassroom: true, isVerificationChecklist: true })).toBe(false)
  })

  it('システム指示は利用者マニュアル全文と §G-4 の禁止事項を含む', () => {
    const prompt = buildQuestionAiSystemPrompt()
    expect(prompt).toContain(USER_MANUAL_MARKDOWN)
    for (const keyword of ['マニュアルに記載が無いため', '他の教室', '料金', '復元', 'トークン']) {
      expect(prompt).toContain(keyword)
    }
  })

  it('利用者メッセージは質問文＋画面＋直近の操作履歴(新しい方から上限件数)だけで、教室データは載せない', () => {
    const operations = Array.from({ length: QUESTION_AI_TRACE_LIMIT + 5 }, (_, index) => ({ at: `2026-09-14T00:00:${String(index).padStart(2, '0')}.000Z`, kind: 'board-commit' as const, summary: `op-${index}` }))
    const message = buildQuestionAiUserMessage({ ...baseInput, scheduleContext: { viewType: 'student' }, recentOperations: operations })
    expect(message).toContain(baseInput.note)
    expect(message).toContain('- viewType: student')
    expect(message).not.toContain('op-4\n')
    expect(message).toContain(`op-${QUESTION_AI_TRACE_LIMIT + 4}`)
    expect(message).not.toContain('] op-0\n')
    expect(message.match(/\[board-commit\]/g)).toHaveLength(QUESTION_AI_TRACE_LIMIT)
  })

  it('Sonnet 最新で呼び、テキストだけを回答にする', async () => {
    const createMessage = vi.fn<CreateQuestionAiMessage>(async () => fakeMessage())
    const result = await generateQuestionAiAnswer(baseInput, { projectId: 'komahyouapp-prod', createMessage })
    expect(result).toEqual({ ok: true, answer: '基本データ画面で生徒を選びます。', model: QUESTION_AI_MODEL, inputTokens: 1200, outputTokens: 80 })
    const params = createMessage.mock.calls[0][0]
    expect(params.model).toBe('claude-sonnet-5')
    expect(params.messages).toEqual([{ role: 'user', content: buildQuestionAiUserMessage(baseInput) }])
    expect(params.system).toBe(buildQuestionAiSystemPrompt())
  })

  it('GCP プロジェクトが分からなければ AI を呼ばずに理由を返す(報告本体は成功のまま)', async () => {
    const createMessage = vi.fn<CreateQuestionAiMessage>()
    expect(await generateQuestionAiAnswer(baseInput, { projectId: '', createMessage })).toEqual({ ok: false, error: 'AI 回答の設定(GCP プロジェクト)が分かりません' })
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('Claude on Google Cloud(Vertex AI)経由で呼ぶ(API キーを使わない・請求は GCP)。既定リージョンは global', () => {
    const source = readFileSync(resolve(repoRoot, 'functions/src/questionAiAnswer.ts'), 'utf8')
    expect(source).toContain("import { AnthropicVertex } from '@anthropic-ai/vertex-sdk'")
    expect(source).toContain('new AnthropicVertex({')
    expect(source).not.toContain('apiKey')
    expect(QUESTION_AI_VERTEX_DEFAULT_REGION).toBe('global')
    const indexSource = readFileSync(resolve(repoRoot, 'functions/src/index.ts'), 'utf8')
    expect(indexSource).not.toContain('ANTHROPIC_API_KEY')
  })

  it('Vertex AI 特有の失敗(権限不足・モデル未有効化)は設定の手がかりになる短い理由にする', () => {
    const headers = new Headers()
    expect(describeQuestionAiError(new Anthropic.PermissionDeniedError(403, undefined, 'denied', headers))).toContain('Vertex AI の権限')
    expect(describeQuestionAiError(new Anthropic.NotFoundError(404, undefined, 'not found', headers))).toContain('Model Garden')
  })

  it('拒否・空応答・例外は利用者向けの短い理由に丸める(内部情報やスタックを出さない)', async () => {
    expect(await generateQuestionAiAnswer(baseInput, { projectId: 'p', createMessage: async () => fakeMessage({ stop_reason: 'refusal' }) })).toEqual({ ok: false, error: 'AI がこの質問への回答を控えました' })
    expect(await generateQuestionAiAnswer(baseInput, { projectId: 'p', createMessage: async () => fakeMessage({ content: [] }) })).toEqual({ ok: false, error: 'AI から回答文が返りませんでした' })
    expect(await generateQuestionAiAnswer(baseInput, { projectId: 'p', createMessage: async () => { throw new Error('secret sk-ant-xxx') } })).toEqual({ ok: false, error: 'AI の呼び出しに失敗しました' })
    expect(describeQuestionAiError(new Error('sk-ant-xxx'))).not.toContain('sk-ant')
  })

  it('長すぎる回答は上限で切る', () => {
    const long = 'あ'.repeat(QUESTION_AI_ANSWER_CHAR_LIMIT + 50)
    const text = extractQuestionAiAnswerText(fakeMessage({ content: [{ type: 'text', text: long, citations: null }] }))
    expect(text).toHaveLength(QUESTION_AI_ANSWER_CHAR_LIMIT + 1)
  })

  it('functions/src/generated/userManual.ts は docs/user-manual.md の複製(ズレたら `npm --prefix functions run sync-shared`)', () => {
    const source = readFileSync(resolve(repoRoot, USER_MANUAL_SOURCE_PATH), 'utf8')
    const generated = normalizeToLf(readFileSync(resolve(repoRoot, USER_MANUAL_OUTPUT_PATH), 'utf8'))
    expect(generated).toBe(buildUserManualModuleContent(source))
    expect(USER_MANUAL_MARKDOWN).toBe(normalizeToLf(source))
  })
})
