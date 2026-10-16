import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'

import { buildUserManualModuleContent, normalizeToLf, USER_MANUAL_OUTPUT_PATH, USER_MANUAL_SOURCE_PATH } from '../scripts/sync-shared.mjs'
import { isDevelopmentClassroomIdentity } from './developmentClassroomIdentity'
import { USER_MANUAL_MARKDOWN } from './generated/userManual'
import {
  buildOtherClassroomNameWords,
  buildQuestionAiSystemPrompt,
  buildQuestionAiUserMessage,
  describeQuestionAiError,
  extractQuestionAiAnswerText,
  findQuestionAiAnswerViolation,
  generateQuestionAiAnswer,
  QUESTION_AI_ANSWER_CHAR_LIMIT,
  QUESTION_AI_BEHAVIOR_CHECK_REPLY,
  QUESTION_AI_MAX_TOKENS,
  QUESTION_AI_MODEL,
  QUESTION_AI_NO_MANUAL_REPLY,
  QUESTION_AI_OTHER_CLASSROOM_REPLY,
  QUESTION_AI_PRICE_REPLY,
  QUESTION_AI_TRACE_LIMIT,
  shouldAnswerQuestionWithAi,
  stripQuestionAiTestMarker,
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
    // 2026-09-16: 開発用教室の判定は登録台帳の (workspaceKey, 教室ID)。教室名では判定しない。
    const devClassroom = isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: 'v8OZ7zH8vONNHjjYVcR1' })
    expect(devClassroom).toBe(true)
    expect(shouldAnswerQuestionWithAi({ category: 'question', isFeatureEnabled: devClassroom, isVerificationChecklist: false })).toBe(true)
    // 本番3教室は台帳に無い＝AI を呼ばない。別会社(workspace)の同じ教室IDも呼ばない。
    for (const id of ['5w5OMueETerSKrSf14HC', 'KzFnOQoTFLsCxwUp1tvh', '6xnnbSTbwgGrBLy0EJKb']) {
      expect(shouldAnswerQuestionWithAi({ category: 'question', isFeatureEnabled: isDevelopmentClassroomIdentity({ workspaceKey: 'main', classroomId: id }), isVerificationChecklist: false })).toBe(false)
    }
    expect(shouldAnswerQuestionWithAi({ category: 'question', isFeatureEnabled: isDevelopmentClassroomIdentity({ workspaceKey: 'company-b', classroomId: 'v8OZ7zH8vONNHjjYVcR1' }), isVerificationChecklist: false })).toBe(false)
    expect(shouldAnswerQuestionWithAi({ category: 'request', isFeatureEnabled: true, isVerificationChecklist: false })).toBe(false)
    expect(shouldAnswerQuestionWithAi({ category: 'bug', isFeatureEnabled: true, isVerificationChecklist: false })).toBe(false)
    expect(shouldAnswerQuestionWithAi({ category: 'question', isFeatureEnabled: true, isVerificationChecklist: true })).toBe(false)
  })

  it('システム指示は使い方の説明の全文と §G-4 の禁止事項を含む', () => {
    const prompt = buildQuestionAiSystemPrompt()
    expect(prompt).toContain(USER_MANUAL_MARKDOWN)
    for (const keyword of [QUESTION_AI_NO_MANUAL_REPLY, '他の教室', '料金', '復元', 'トークン']) {
      expect(prompt).toContain(keyword)
    }
  })

  it('AI 自身が案内役(他責の言い回しをしない)という立場をシステム指示に書き、決まり文句も他責でない(オーナー指示 2026-10-16 夜)', () => {
    const prompt = buildQuestionAiSystemPrompt()
    expect(prompt).toContain('あなた自身がこのアプリの使い方の案内役')
    expect(prompt).toContain('他の資料に責任を預ける言い方はしません')
    expect(prompt).toContain('「マニュアル」「説明書」「記載」「明記」という言葉自体を回答に書かない')
    // 推測のボタン名・推測の手順＋「確認します」・決まり文句の「」囲みを禁じる(評価 1 回目 Q4/Q6/Q11/Q13/Q15 の反省)。
    expect(prompt).toContain('無い名前を作って「」で書かない')
    expect(prompt).toContain('推測の手順を書いてから「確認します」と付け足さない')
    expect(prompt).toContain('決まり文句は「」で囲まず')
    expect(QUESTION_AI_NO_MANUAL_REPLY).not.toMatch(/マニュアル|記載/u)
    // 根拠の見出しも「マニュアル」ではなく AI の知識として渡す。
    expect(prompt).toContain('# 案内できる内容')
    expect(prompt).not.toContain('# 利用者マニュアル')
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

  it('Sonnet 最新で呼び(2026-10-16 夜 オーナー指示で Haiku から戻した)、テキストだけを回答にする', async () => {
    const createMessage = vi.fn<CreateQuestionAiMessage>(async () => fakeMessage())
    const result = await generateQuestionAiAnswer(baseInput, { apiKey: 'sk-test', createMessage })
    expect(result).toEqual({ ok: true, answer: '基本データ画面で生徒を選びます。', model: QUESTION_AI_MODEL, inputTokens: 1200, outputTokens: 80 })
    const params = createMessage.mock.calls[0][0]
    expect(params.model).toBe('claude-sonnet-5-5')
    // 思考込みの出力上限(費用の歯止め)。回答文自体は QUESTION_AI_ANSWER_CHAR_LIMIT で切る。
    expect(params.max_tokens).toBe(QUESTION_AI_MAX_TOKENS)
    expect(QUESTION_AI_MAX_TOKENS).toBe(8000)
    // Sonnet 5.5 はサンプリング指定(temperature 等)の既定値以外を送ると 400 になるので送らない。思考の指定も送らない(省略＝adaptive)。
    expect(params).not.toHaveProperty('temperature')
    expect(params).not.toHaveProperty('thinking')
    expect(params.messages).toEqual([{ role: 'user', content: buildQuestionAiUserMessage(baseInput) }])
    expect(params.system).toBe(buildQuestionAiSystemPrompt())
  })

  it('API キー(ANTHROPIC_API_KEY)が無ければ AI を呼ばずに理由を返す(報告本体は成功のまま)', async () => {
    const createMessage = vi.fn<CreateQuestionAiMessage>()
    expect(await generateQuestionAiAnswer(baseInput, { apiKey: '', createMessage })).toEqual({ ok: false, error: 'AI 回答の設定(API キー ANTHROPIC_API_KEY)がありません' })
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('Claude API 直(API キー)で呼ぶ(2026-10-16 オーナー指示: Vertex AI は割り当て 0 の 429 で一度も動かなかったため切り替え)', () => {
    const source = readFileSync(resolve(repoRoot, 'functions/src/questionAiAnswer.ts'), 'utf8')
    expect(source).not.toContain('@anthropic-ai/vertex-sdk')
    expect(source).not.toContain('AnthropicVertex')
    expect(source).toContain('new Anthropic({ apiKey: deps.apiKey')
    // キーは runtime env から読む(ソースに鍵を書かない)。CI は secret ANTHROPIC_API_KEY を .env へ追記する。
    const indexSource = readFileSync(resolve(repoRoot, 'functions/src/index.ts'), 'utf8')
    expect(indexSource).toContain("process.env.ANTHROPIC_API_KEY")
    expect(indexSource).toContain('{ apiKey: QUESTION_AI_API_KEY }')
    expect(`${source}\n${indexSource}`).not.toMatch(/sk-ant-[A-Za-z0-9]/)
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/deploy-functions.yml'), 'utf8')
    expect(workflow).toContain('secrets.ANTHROPIC_API_KEY')
    expect(workflow).toContain('ANTHROPIC_API_KEY=')
    const functionsPackage = JSON.parse(readFileSync(resolve(repoRoot, 'functions/package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(functionsPackage.dependencies['@anthropic-ai/vertex-sdk']).toBeUndefined()
  })

  it('Claude API の失敗(認証・残高/上限)は設定の手がかりになる短い理由にする', () => {
    const headers = new Headers()
    expect(describeQuestionAiError(new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', headers))).toContain('API キー')
    expect(describeQuestionAiError(new Anthropic.RateLimitError(429, undefined, 'rate', headers))).toContain('クレジット')
    expect(describeQuestionAiError(new Anthropic.BadRequestError(400, undefined, 'credit balance is too low', headers))).toContain('クレジット残高不足')
    expect(describeQuestionAiError(new Anthropic.AuthenticationError(401, undefined, 'sk-ant-xxx', headers))).not.toContain('sk-ant')
  })

  it('拒否・空応答・例外は開発者向けの短い理由に丸める(内部情報やスタックを出さない・室長の画面には出さない 2026-10-10)', async () => {
    expect(await generateQuestionAiAnswer(baseInput, { apiKey: 'sk-test', createMessage: async () => fakeMessage({ stop_reason: 'refusal' }) })).toEqual({ ok: false, error: 'AI がこの質問への回答を控えました' })
    expect(await generateQuestionAiAnswer(baseInput, { apiKey: 'sk-test', createMessage: async () => fakeMessage({ content: [] }) })).toEqual({ ok: false, error: 'AI から回答文が返りませんでした' })
    expect(await generateQuestionAiAnswer(baseInput, { apiKey: 'sk-test', createMessage: async () => { throw new Error('secret sk-ant-xxx') } })).toEqual({ ok: false, error: 'AI の呼び出しに失敗しました' })
    expect(describeQuestionAiError(new Error('sk-ant-xxx'))).not.toContain('sk-ant')
  })

  it('回答の決まり(オーナー指定 2026-10-16: 謝らない・不具合を認めない・金額を答えない・他教室を出さない)をシステム指示に入れる', () => {
    const prompt = buildQuestionAiSystemPrompt()
    for (const keyword of ['謝罪の言葉を使わない', '不具合・バグ・障害・エラーがあると認めたり', '金額・料金・費用・価格', '他の教室・校舎の情報を一切出さない']) {
      expect(prompt).toContain(keyword)
    }
    for (const reply of [QUESTION_AI_BEHAVIOR_CHECK_REPLY, QUESTION_AI_PRICE_REPLY, QUESTION_AI_OTHER_CLASSROOM_REPLY, QUESTION_AI_NO_MANUAL_REPLY]) expect(prompt).toContain(reply)
    // 旧文面「不具合の可能性がある内容なら、その旨を添えて」は「不具合を認めない」と矛盾するので消した。
    expect(prompt).not.toContain('その旨を添えて')
  })

  it('決まり文句は機械検査に引っかからない(決まりどおりに答えたら止めない)', () => {
    for (const reply of [QUESTION_AI_BEHAVIOR_CHECK_REPLY, QUESTION_AI_PRICE_REPLY, QUESTION_AI_OTHER_CLASSROOM_REPLY, QUESTION_AI_NO_MANUAL_REPLY]) {
      expect(findQuestionAiAnswerViolation(`手順を確認してください。${reply}質問は開発者にも届いています。`), reply).toBeNull()
    }
    // 種類「不具合」を選ぶ案内は「不具合を認める」ではない。
    expect(findQuestionAiAnswerViolation('「質問・要望」で種類「不具合」を選んで送ってください。')).toBeNull()
    expect(findQuestionAiAnswerViolation('不具合かどうかは開発者が確認します。')).toBeNull()
  })

  it.each([
    ['申し訳ありませんが、マニュアルに記載がありません。', '謝罪'],
    ['ご不便をおかけしております。', '謝罪'],
    // 評価 1 回目(2026-10-16 run 38844858406)Q20 の冒頭。「をおかけ」でない形も止める。
    ['ご不便をかけている状況を把握しました。', '謝罪'],
    ['ご迷惑になり、', '謝罪'],
    // 他責の言い回し(オーナー指示 2026-10-16 夜)。
    ['マニュアルでは、休日設定は日付メニューから行います。', '他責の言い回し'],
    ['マニュアルに記載が無いため、お答えできません。', '他責の言い回し'],
    ['説明書に書かれていません。', '他責の言い回し'],
    ['この機能については明記されていません。', '他責の言い回し'],
    ['残り回数の場所は記載されておりません。', '他責の言い回し'],
    ['すみません、分かりません。', '謝罪'],
    ['これはアプリの不具合です。', '不具合を認める'],
    ['バグの可能性があります。', '不具合を認める'],
    ['現在、不具合が発生しています。', '不具合を認める'],
    ['次の更新で不具合を修正します。', '不具合を認める'],
    ['月額 5,000 円です。', '金額'],
    ['1教室 ３０００円 かかります。', '金額'],
    ['基本機能は無料です。', '金額'],
    ['¥1000 です。', '金額'],
  ])('決まりに反した回答は止める: %s → %s', (answer, expected) => {
    expect(findQuestionAiAnswerViolation(answer)).toBe(expected)
  })

  it('他の教室の名前が出た回答は止める。自教室の名前・共通のブランド名は止めない', () => {
    const words = buildOtherClassroomNameWords({ currentClassroomName: 'スクールIE 日大前校', allClassroomNames: ['スクールIE 緑が丘校', 'スクールIE 薬円台校', 'スクールIE 日大前校', '', 'A校'] })
    expect(words).toEqual(expect.arrayContaining(['スクールIE 緑が丘校', '緑が丘校', 'スクールIE 薬円台校', '薬円台校']))
    expect(words).not.toContain('スクールIE')
    expect(words).not.toContain('日大前校')
    expect(words).not.toContain('A校')
    expect(findQuestionAiAnswerViolation('緑が丘校では自動割振を使っています。', { otherClassroomNames: words })).toBe('他教室')
    expect(findQuestionAiAnswerViolation('スクールIE 日大前校の盤面で操作してください。', { otherClassroomNames: words })).toBeNull()
  })

  it('決まりに反した回答は室長に見せず(ok:false)、元の文とトークン数を返す(報告文書の aiAnswerBlocked に残す)', async () => {
    const blocked = await generateQuestionAiAnswer(baseInput, { apiKey: 'sk-test', createMessage: async () => fakeMessage({ content: [{ type: 'text', text: '申し訳ありません。これは不具合です。', citations: null }] }) })
    expect(blocked).toEqual({ ok: false, error: '回答の決まりに反したため表示しませんでした(謝罪)', blockedAnswer: '申し訳ありません。これは不具合です。', inputTokens: 1200, outputTokens: 80 })
    const other = await generateQuestionAiAnswer({ ...baseInput, otherClassroomNames: ['緑が丘校'] }, { apiKey: 'sk-test', createMessage: async () => fakeMessage({ content: [{ type: 'text', text: '緑が丘校の例です。', citations: null }] }) })
    expect(other).toMatchObject({ ok: false, error: '回答の決まりに反したため表示しませんでした(他教室)' })
  })

  it('「#テスト」の印は AI に渡す質問文から外す(オーナーの試験送信で AI が印に反応しないように)', () => {
    expect(stripQuestionAiTestMarker('生徒を登録するには？ #テスト')).toBe('生徒を登録するには？')
    expect(stripQuestionAiTestMarker('#test 振替は？')).toBe('振替は？')
    expect(buildQuestionAiUserMessage({ ...baseInput, note: '振替は？ #テスト' })).not.toContain('#テスト')
  })

  it('submitDeveloperReport は他教室名を渡し、止めた回答を aiAnswerBlocked に残す(配線)', () => {
    const indexSource = readFileSync(resolve(repoRoot, 'functions/src/index.ts'), 'utf8')
    expect(indexSource).toContain('otherClassroomNames,')
    expect(indexSource).toContain('buildOtherClassroomNameWords({')
    expect(indexSource).toContain('aiAnswerBlocked: aiResult.blockedAnswer')
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
