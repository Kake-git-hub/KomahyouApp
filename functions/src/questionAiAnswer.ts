// 「質問・要望」の質問に AI がその場で回答する(開発用教室で試験(オーナー指示 2026-09-14) → 2026-10-30 全教室へ展開)。
//
// 位置づけ: docs/spec-developer-report.md §G-7。§G-1「AI 即答は作らない」の例外。開発用教室で先行し、オーナー指示
// (2026-10-30「AI回答機能を全教室に展開して」)で全教室へ広げた。
//  - 対象は category=question かつ 機能が有効な教室だけ(isQuestionAiAnswerEnabledForClassroom = 基本スコープ
//    QUESTION_AI_ANSWER_BASE_SCOPE → 会社既定 companyFeatureDefaults の 2 段解決)。基本スコープは 'all-classrooms'。
//  - 質問は従来どおり developerReports へ記録・メール通知される(AI 回答は「上乗せ」。記録を置き換えない)。
//  - AI に渡すのは **使い方の説明(docs/user-manual.md・利用者向け)＋質問文＋直近の操作履歴** だけ。
//    教室データ(スナップショット)は渡さない(オーナー確定 2026-09-14)。
//  - モデルは **Claude Sonnet 最新**(2026-10-16 夜 オーナー指示「質問回答 AI モデルも Sonnet の最新を使うように」。
//    同日昼の Haiku 確定を覆した。説明書を本文へ拡充したので、読み解きの精度を優先する)。
//    1 問 ≒ 入力 1.2 万トークン(説明書 約 1.3 万字＋指示＋操作履歴)＋出力 1 千トークンで Sonnet 5.5 は約 5 円
//    (入力 $2・出力 $10/100 万トークン・1 ドル 150 円)。月 500 問で約 2,500 円。Haiku 5.5 なら約 0.3 円。
//    アプリ側で回数の上限は設けない(オーナー判断 2026-10-16)。使いすぎの歯止めは Anthropic コンソールの月の利用上限額だけ
//    (上限に達するとその月は全教室で AI 回答が止まり、「自動回答を作れませんでした」＝開発者が回答、に戻る)。
//  - 回答文は **利用者から見て AI 自身が説明書**という立場で書く(オーナー指示 2026-10-16 夜)。「マニュアルでは〜」
//    「マニュアルに記載が無い」のように他の資料へ責任を預ける(他責の)言い回しは禁止し、機械検査でも止める。
//  - **質問に名前が出た生徒の数字(妥協案 B・オーナー採用 2026-10-16 夜)**: クライアントが権威関数で計算した生徒×科目の台帳から、
//    質問文に名前が出た生徒の行だけを数行の文字にして渡す(questionAiStudentDigest.ts)。教室データそのものは渡さない。
//    AI はその数字をそのまま使い、数えない。質問に出ていない生徒の名前が回答に出たら止める(他の生徒)。
//  - **開発中は Sonnet(主・室長に表示)と Haiku(影・記録だけ)の両方で回答する**(オーナー指示 2026-10-16 夜「回答精度と金額の評価をして」)。
//    影の回答は報告文書の aiAnswerShadow* に残し、開発ダッシュボードと評価ワークフローで並べて比べる。室長には主だけを出す。
//  - 呼び出しは **Claude API 直(API キー)**(オーナー指示 2026-10-16
//    「支払い窓口が増えてもよいので確実に動く案に」)。2026-09-14〜10-16 は請求を GCP にまとめるため Vertex AI 経由だったが、
//    新規プロジェクトの Claude 割り当てが 0 のままで毎回 429(「Vertex AI の割り当て上限」)になり一度も回答できなかった
//    (開発用教室の報告 2026-09-14・09-28 で確認)。Claude API は Anthropic のコンソールで前払いクレジットを入れた
//    API キーがあれば割り当て申請なしで動く。キーは functions runtime env の ANTHROPIC_API_KEY
//    (CI ではリポジトリ secret ANTHROPIC_API_KEY を deploy-functions.yml が .env.komahyouapp-prod へ追記)。
//    キー未設定のときは AI を呼ばずに理由を返す(報告本体は成功のまま。理由は開発者向けの記録だけで、室長の画面には出さない)。
//  - 回答文の制約は §G-4 の基準に合わせる(個別教室の中身・約束・料金・不可逆操作の指示・個人情報を書かない)。
//
// この 1 ファイルは SDK 呼び出し以外を純関数に保ち、テストで固定する。

import Anthropic from '@anthropic-ai/sdk'

import type { DeveloperReportCategory, NormalizedDeveloperReportTraceEntry } from './developerReport'
import { isDevelopmentClassroomIdentity } from './developmentClassroomIdentity'
import { resolveCompanyFeatureDefault, resolveFeatureEnabledByLayers } from './generated/companyFeatureDefaults'
import { USER_MANUAL_MARKDOWN } from './generated/userManual'

/**
 * 回答に使うモデル(Haiku 最新)。ID は接頭辞・日付なしのまま使う。
 * 2026-10-16 夜 オーナー指示「Haiku にして」: 評価 4・5 回目(2 モデル × 23 問)で Haiku の回答が Sonnet とほぼ同等で費用が約 1/20
 * (1 問約 0.25 円 ↔ 約 5 円)だったため確定。それまでの経緯は Sonnet(同日夜・v1.5.612)← Haiku(同日昼・v1.5.608)← Sonnet。
 */
export const QUESTION_AI_MODEL = 'claude-haiku-5-5'
/** 比較用のモデル(評価ワークフローで `compare` を選んだときだけ流す)。本番の回答では呼ばない(二重回答は 2026-10-16 夜に終了)。 */
export const QUESTION_AI_COMPARISON_MODEL = 'claude-sonnet-5-5'
/** 単価(ドル/100 万トークン・Haiku 5.5 は 100K トークン以下のプロンプト)。費用の目安を記録・評価で出すための正本。 */
export const QUESTION_AI_MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
}
export const QUESTION_AI_YEN_PER_USD = 150
/** 1 回の呼び出しの費用の目安(円・小数 2 桁)。単価の無いモデルは 0。 */
export function estimateQuestionAiCostYen(model: string, inputTokens: number, outputTokens: number): number {
  const price = QUESTION_AI_MODEL_PRICES[model]
  if (!price) return 0
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000
  return Math.round(usd * QUESTION_AI_YEN_PER_USD * 100) / 100
}
/** 思考も含めた出力トークンの上限(費用の歯止め)。Sonnet は思考に使う分が多いので Haiku のときの 4000 から戻した。 */
export const QUESTION_AI_MAX_TOKENS = 8000
/** AI に渡す操作履歴の件数(新しい方から)。質問の文脈が分かれば足りるので絞る。 */
export const QUESTION_AI_TRACE_LIMIT = 40
/** 利用者へ返す回答文の上限(異常に長い出力で画面が埋まらないように)。 */
export const QUESTION_AI_ANSWER_CHAR_LIMIT = 4000
/** API 呼び出しのタイムアウト(ミリ秒)。callable 全体(180 秒)に収まるようにする。 */
export const QUESTION_AI_TIMEOUT_MS = 90_000

/**
 * 質問 AI 即答の基本スコープ。クライアント src/utils/featureRollout.ts の `questionAiAnswer.scope` と同じ値にする
 * (questionAiAnswer.test.ts が突合)。開発用教室で先行 → オーナー指示(2026-10-30「AI回答機能を全教室に展開して」)で 'all-classrooms'。
 * 回帰で 'development-only' へ戻さない(戻すと画面は全教室で「その場で回答」と出るのに AI を呼ばない非対称になる)。
 */
export const QUESTION_AI_ANSWER_BASE_SCOPE: 'development-only' | 'all-classrooms' = 'all-classrooms'

/**
 * 質問 AI 即答がその教室で有効か(サーバー側の権威)。
 * 2 段解決(2026-09-18・Phase 1 T1-2): 基本スコープ(QUESTION_AI_ANSWER_BASE_SCOPE)→ 会社既定
 * (コア台帳 companyFeatureDefaults の複製)。段の順序・台帳はクライアント
 * `isFeatureEnabledForClassroom('questionAiAnswer', …)` と同一(パリティテストで固定)。
 * 会社や教室 ID が空なら OFF(fail-closed)。
 */
export function isQuestionAiAnswerEnabledForClassroom(input: { workspaceKey: string | null | undefined; classroomId: string | null | undefined }): boolean {
  const workspaceKey = (input.workspaceKey ?? '').trim()
  const classroomId = (input.classroomId ?? '').trim()
  if (!workspaceKey || !classroomId) return false
  return resolveFeatureEnabledByLayers({
    scopeEnabled: QUESTION_AI_ANSWER_BASE_SCOPE === 'all-classrooms' || isDevelopmentClassroomIdentity({ workspaceKey, classroomId }),
    companyDefault: resolveCompanyFeatureDefault(workspaceKey, 'questionAiAnswer'),
  })
}

/** AI 即時回答を行うか。質問 × 機能が有効な教室(isQuestionAiAnswerEnabledForClassroom)× 確認リストではない、のときだけ。 */
export function shouldAnswerQuestionWithAi(input: { category: DeveloperReportCategory; isFeatureEnabled: boolean; isVerificationChecklist: boolean }): boolean {
  return input.category === 'question' && input.isFeatureEnabled && !input.isVerificationChecklist
}

/**
 * 開発者の回答が必要なときに室長へ返す言い方の正本(オーナー指示 2026-10-16 夜「開発者より別途回答いたします と返事し、開発者に今まで通りメールで知らせる」)。
 * 下の決まり文句 3 つと、クライアントの「自動回答を作れませんでした」の一文(src/utils/developerReport.ts)・履歴の回答待ちの一文(src/utils/reportAnswers.ts)はこれに揃える。
 */
export const QUESTION_AI_DEVELOPER_REPLY = '開発者より別途回答いたします。'
/** 根拠(使い方の説明)に無いときの決まり文句。「マニュアルに記載が無い」のような他責の言い方はしない(オーナー指示 2026-10-16 夜)。 */
export const QUESTION_AI_NO_MANUAL_REPLY = `この点は${QUESTION_AI_DEVELOPER_REPLY}`
/** 「動かない・おかしい」系(不具合を認めない・オーナー指定 2026-10-16)の決まり文句。 */
export const QUESTION_AI_BEHAVIOR_CHECK_REPLY = `動作については${QUESTION_AI_DEVELOPER_REPLY}`
/** 金額・契約(答えない・同)の決まり文句。 */
export const QUESTION_AI_PRICE_REPLY = `料金・契約については${QUESTION_AI_DEVELOPER_REPLY}`
/** 他の教室(一切出さない・同)の決まり文句。 */
export const QUESTION_AI_OTHER_CLASSROOM_REPLY = 'いま開いている教室のことだけをご案内しています。'

export function buildQuestionAiSystemPrompt(manualMarkdown: string = USER_MANUAL_MARKDOWN): string {
  return [
    'あなたは学習塾向け「コマ表アプリ」の使い方サポート担当です。教室の利用者(室長・スタッフ)からの質問に、日本語でその場で回答します。',
    '',
    '# あなたの立場と回答の根拠',
    '- 利用者から見て、あなた自身がこのアプリの使い方の案内役です。回答は自分の言葉で、自分の案内として書いてください。',
    '- 根拠にできるのは、下の「案内できる内容」に書かれていることだけです。書かれていないことは推測で手順やボタン名を作らず、' +
      `「${QUESTION_AI_NO_MANUAL_REPLY}」と伝えてください。`,
    '- 「マニュアルでは〜」「マニュアルに記載が無い」「説明書に書かれていない」のように、他の資料に責任を預ける言い方はしません。' +
      '「マニュアル」「説明書」「記載」「明記」という言葉自体を回答に書かないでください。',
    '- 直近の操作履歴は「利用者がどの画面で何をしていたか」を知る手がかりとしてだけ使ってください。',
    '',
    '# 必ず守ること(例外なし)',
    '1. 謝罪を主旨にしない。「申し訳ありませんが」のような軽い前置き程度はよいが、謝ること自体が目的の文(「ご不便をおかけして申し訳ありません」「お詫び申し上げます」など)は書かない。できないこと・分からないことは、事実と次にすることを伝える。',
    `2. アプリに不具合・バグ・障害・エラーがあると認めたり、その可能性を書いたりしない(「不具合です」「バグの可能性があります」「システムの問題です」も書かない)。思ったとおりに動かない・表示がおかしい・数が合わないという内容には、案内できる操作手順の確認だけを案内し、「${QUESTION_AI_BEHAVIOR_CHECK_REPLY}」と伝える。原因を推測しない。`,
    `3. 金額・料金・費用・価格・契約・請求・無料/有料については、数字を含め一切答えない。「${QUESTION_AI_PRICE_REPLY}」とだけ伝える。`,
    `4. 他の教室・校舎の情報を一切出さない(教室名・人数・使い方・事例・比較を含む)。他の教室について聞かれても「${QUESTION_AI_OTHER_CLASSROOM_REPLY}」とだけ伝える。`,
    '5. 講師名・質問に出ていない生徒の名前・他の生徒の配置内容は書かない。質問に名前が出た生徒については、下の「質問に名前が出た生徒のいまの数字」が渡されたときだけ、そこにある残数・日付・科目・回数をそのまま使って具体的に案内してよい。そこに無い数字を数えたり推測したりしない。渡されていない(見つからなかった)ときは数字を作らず、生徒の名前が名簿の表示名と同じか確かめてもらうよう案内する。',
    '6. 未リリースの機能や対応時期を約束しない(「次の更新で直します」等)。',
    '7. データの復元・削除・ロールバックなど取り消せない操作の手順は書かず、「開発者にご相談ください」と伝える(その機能がどの画面にあるかを伝えるのはよい)。',
    '8. メールアドレス・ID・トークン・ファイル名・保存先パス・開発用の文書名(docs/ などの名前)などの内部情報を書かない。',
    '9. 「」で囲んでボタン名・メニュー名として書けるのは、下の「案内できる内容」に出てくる名前だけ。無い名前を作って「」で書かない。',
    '10. 分からないことに推測の手順を書いてから「確認します」と付け足さない。分からない点はその部分だけを決まり文句で伝える。',
    '11. 決まり文句は「」で囲まず、ふつうの文として書く。',
    `12. 答えられたときは回答だけで完結させる。答えに続けて、聞かれていない細かい点について「${QUESTION_AI_DEVELOPER_REPLY}」と書き足さない。決まり文句を使うのは、質問の中に案内できる内容だけでは答えられない部分があるときだけで、その部分についてだけ書く。`,
    '13. 「質問は開発者にも届いています」「この内容は開発者にも届いています」のような添え書きを書かない(画面側が 1 回だけ添える。二重に出る)。',
    '',
    '# 書き方',
    '- 丁寧語で、結論から書いてください。手順は画面に出ている言葉(ボタン名・メニュー名)で番号付きで短く書いてください。',
    '- 案内できる内容に答えがあるときは、言い切ってください(「明確ではありません」「〜と思われます」のような弱い言い方をしない)。',
    '- Markdown の見出し・表・太字は使わず、プレーンテキストで書いてください。',
    '- 短く。答えられた質問に、まとめの一文・別途回答の約束・「開発者にも届いています」の添え書きを足さない(オーナー指示 2026-10-22「シンプルな回答にして」)。',
    '',
    '# 案内できる内容(このアプリの使い方。利用者には「あなたの知識」として伝える)',
    manualMarkdown,
  ].join('\n')
}

/**
 * 回答文が「必ず守ること」に反していないかの機械的な検査(2026-10-16 オーナー指定の制限の歯止め)。
 * 指示文だけでは守られない場合に備え、反していたら回答を室長に見せず(「自動回答を作れませんでした」＝開発者が回答)、
 * 元の文は報告文書の aiAnswerBlocked に残して開発者が見直せるようにする。決まり文句(QUESTION_AI_*_REPLY)は引っかからない。
 * 戻り値は反した種類(開発者向けの短い名前)。問題なければ null。
 * 謝罪語の検査は 2026-10-16 夜に外した(オーナー指示「多少の口調での謝罪などは止めなくていい。今の程度なら良し」＝評価 5 回目で Haiku が
 * 「申し訳ありませんが」と書いて止まった件)。謝罪を主旨にしない指示(決まり 1)は残し、検査では止めない。
 */
export function findQuestionAiAnswerViolation(answer: string, options: { otherClassroomNames?: readonly string[]; otherStudentNames?: readonly string[] } = {}): string | null {
  // 他の資料へ責任を預ける言い回し(オーナー指示 2026-10-16 夜「マニュアルでは〜など他責な言い回しはしない」)。
  if (/マニュアル|説明書|ヘルプ(?:に|で|を|は)|記載(?:が|は)?(?:無|な|あり|されて|して)|明記(?:が|は|されて|して)/u.test(answer)) return '他責の言い回し'
  if (/(?:バグ|不具合|障害|欠陥|システムの問題)(?:が|は|も)?(?:あり|ござい|発生|起き|起こっ|生じ|確認され|見つか)|(?:バグ|不具合|障害|欠陥)(?:です|でした|と思われ|かもしれ|の可能性|によ|のため|が原因)|(?:バグ|不具合)を(?:修正|直)/u.test(answer)) return '不具合を認める'
  if (/[0-9０-９][0-9０-９,，.．]*\s*(?:円|万円|ドル)|[¥￥$＄]\s*[0-9０-９]|無料|有料|月額|年額|割引/u.test(answer)) return '金額'
  const names = (options.otherClassroomNames ?? []).map((name) => name.trim()).filter((name) => name.length >= 3)
  if (names.some((name) => answer.includes(name))) return '他教室'
  // 質問に出ていない生徒の名前(妥協案 B・2026-10-16 夜)。空白の有無を問わず当てる。
  const normalizedAnswer = answer.replace(/[\s\u3000]+/gu, '')
  const studentNames = (options.otherStudentNames ?? []).map((name) => name.replace(/[\s\u3000]+/gu, '')).filter((name) => name.length >= 3)
  if (studentNames.some((name) => normalizedAnswer.includes(name))) return '他の生徒'
  return null
}

/**
 * 他の教室の名前のうち、回答に出たら止める語(フルネームと、空白で区切った 3 文字以上の語)。
 * いま開いている教室の名前に含まれる語(例: 共通のブランド名)は除く(自教室の案内まで止めないため)。
 */
export function buildOtherClassroomNameWords(input: { currentClassroomName: string; allClassroomNames: readonly string[] }): string[] {
  const current = input.currentClassroomName.trim()
  const words = new Set<string>()
  for (const raw of input.allClassroomNames) {
    const name = raw.trim()
    if (!name || name === current) continue
    for (const word of [name, ...name.split(/[\s\u3000]+/u)]) {
      if (word.length >= 3 && !current.includes(word)) words.add(word)
    }
  }
  return [...words]
}

/** 「#テスト」「#test」(オーナーの動作確認用の印・Issue 起票を止める)を AI に渡す質問文から外す。 */
export function stripQuestionAiTestMarker(note: string): string {
  return note.replace(/#テスト|#test\b/giu, '').trim()
}

export function buildQuestionAiUserMessage(input: {
  note: string
  screen: string
  scheduleContext: Record<string, string>
  recentOperations: NormalizedDeveloperReportTraceEntry[]
  /** 質問に名前が出た生徒のいまの数字(questionAiStudentDigest.ts の text)。台帳が無いときは渡さない(見出しも出さない)。 */
  studentDigest?: string
}): string {
  const operations = input.recentOperations.slice(-QUESTION_AI_TRACE_LIMIT)
  const contextLines = Object.entries(input.scheduleContext).map(([key, value]) => `- ${key}: ${value}`)
  return [
    '# 質問',
    stripQuestionAiTestMarker(input.note),
    '',
    '# 質問したときの画面',
    input.screen || '(不明)',
    ...(contextLines.length > 0 ? ['', '# 日程表で表示していた条件', ...contextLines] : []),
    ...(input.studentDigest ? ['', '# 質問に名前が出た生徒のいまの数字(そのまま使う・数えない)', input.studentDigest] : []),
    '',
    `# 直近の操作履歴(新しい方の最大 ${QUESTION_AI_TRACE_LIMIT} 件・古い順)`,
    ...(operations.length > 0 ? operations.map((entry) => `- ${entry.at} [${entry.kind}] ${entry.summary}`) : ['(なし)']),
  ].join('\n')
}

/**
 * 回答文から「開発者にも届いています」系の添え書きを取り除く(オーナー指示 2026-10-22・確認リスト v1.5.625 qa-ai-4
 * 「『開発者にも届いています』が 2 回繰り返されている。シンプルな回答にして」)。
 * 画面側(src/utils/developerReport.ts DEVELOPER_REPORT_AI_ANSWER_TRAILER)が回答の後ろに 1 回だけ添えるので、AI 自身が書いた分は
 * 指示(決まり 13)で止めたうえ、書いてしまったときもここで落として二重に出さない。文単位(「。」まで)で落とし、残りは変えない。
 */
export function stripQuestionAiRedundantNotes(answer: string): string {
  const stripped = answer
    .split('\n')
    .map((line) => line
      .split(/(?<=。)/u)
      .filter((sentence) => !/開発者にも届い/u.test(sentence))
      .join('')
      .replace(/[ \u3000]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  return stripped
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
  | { ok: false; error: string; blockedAnswer?: string; inputTokens?: number; outputTokens?: number }

/**
 * 失敗理由を**開発者向けの短文**に丸める(内部のスタックや鍵の断片を出さない)。
 * 2026-10-10 文言見直し(#473〜#479): この理由は室長の画面には出さない(結果画面は「自動回答を作れませんでした」だけ・
 * src/utils/developerReport.ts formatDeveloperReportResultMessage)。報告文書の aiAnswerError・関数ログ・開発ダッシュボードで
 * 原因(権限・モデル未有効化・割り当て上限など)を追えるよう、設定の手がかりになる文面のまま残す。
 */
export function describeQuestionAiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'AI(Claude API)の認証に失敗しました(API キーを確認してください)'
  if (error instanceof Anthropic.PermissionDeniedError) return 'Claude API の権限がありません(API キーのワークスペース・権限を確認してください)'
  if (error instanceof Anthropic.NotFoundError) return 'Claude API でモデルが見つかりません(モデル名を確認してください)'
  if (error instanceof Anthropic.RateLimitError) return 'AI が混み合っています(Claude API の利用上限・クレジット残高を確認してください)'
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'AI の応答が時間内に返りませんでした'
  if (error instanceof Anthropic.BadRequestError) return 'AI の呼び出しに失敗しました(400: クレジット残高不足のこともあります)'
  if (error instanceof Anthropic.APIError) return `AI の呼び出しに失敗しました(${error.status ?? '不明'})`
  return 'AI の呼び出しに失敗しました'
}

export type CreateQuestionAiMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>

export async function generateQuestionAiAnswer(
  input: Parameters<typeof buildQuestionAiUserMessage>[0] & { otherClassroomNames?: readonly string[]; otherStudentNames?: readonly string[] },
  deps: { apiKey: string; createMessage?: CreateQuestionAiMessage; model?: string },
): Promise<QuestionAiAnswerResult> {
  const model = deps.model ?? QUESTION_AI_MODEL
  if (!deps.apiKey) return { ok: false, error: 'AI 回答の設定(API キー ANTHROPIC_API_KEY)がありません' }
  const createMessage: CreateQuestionAiMessage = deps.createMessage ?? ((params) => {
    const client = new Anthropic({ apiKey: deps.apiKey, timeout: QUESTION_AI_TIMEOUT_MS, maxRetries: 1 })
    return client.messages.create(params)
  })
  try {
    const message = await createMessage({
      model,
      // 思考も含めた上限。回答は QUESTION_AI_ANSWER_CHAR_LIMIT で切るので、これ以上は費用の歯止めとして絞る。
      max_tokens: QUESTION_AI_MAX_TOKENS,
      output_config: { effort: 'medium' },
      system: buildQuestionAiSystemPrompt(),
      messages: [{ role: 'user', content: buildQuestionAiUserMessage(input) }],
    })
    if (message.stop_reason === 'refusal') return { ok: false, error: 'AI がこの質問への回答を控えました' }
    const answer = stripQuestionAiRedundantNotes(extractQuestionAiAnswerText(message) ?? '')
    if (!answer) return { ok: false, error: 'AI から回答文が返りませんでした' }
    const violation = findQuestionAiAnswerViolation(answer, { otherClassroomNames: input.otherClassroomNames, otherStudentNames: input.otherStudentNames })
    if (violation) {
      return { ok: false, error: `回答の決まりに反したため表示しませんでした(${violation})`, blockedAnswer: answer, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
    }
    return { ok: true, answer, model: message.model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
  } catch (error) {
    return { ok: false, error: describeQuestionAiError(error) }
  }
}
