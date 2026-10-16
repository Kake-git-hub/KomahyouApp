# 引き継ぎ: 質問への AI 即時回答(2026-10-16 時点)

次のセッションはこの文書から読み始める。仕様の正本は `docs/spec-developer-report.md` §G-7、
進行中テーマ台帳は `src/utils/developmentStatusLedger.ts` の `question-ai-answer` 行。

## 1. いまの状態(すべて main にマージ済み)

| 版 | 内容 |
|---|---|
| v1.5.607 | 呼び出し先を Vertex AI → **Claude API 直(API キー)**へ。Vertex は Claude の割り当てが 0 で毎回 429 となり、一度も回答できていなかった |
| v1.5.608 | モデルを **`claude-haiku-5-5`**(Haiku 最新)へ。`max_tokens` は 4000 |
| v1.5.609 | **回答の決まり 4 点**をシステム指示に入れ、回答文を**機械検査**する。確認リストに確認用の 20 問 `qa-q01〜q20` を追加。開発ダッシュボードで AI の回答・失敗理由・止めた回答を全文で読めるようにした |
| v1.5.610 | **評価ワークフロー** Actions「Question AI eval」(手動実行)。20 問を本番と同じ経路へ流し、結果を Job summary に出す |

- 対象は引き続き**開発用教室だけ**(featureRollout `questionAiAnswer` = development-only)。本番教室の挙動は変わっていない。
- オーナーは API キーを secret に登録し、Functions を再デプロイ済み(本人の申告。評価ワークフローは鍵で成功している)。

## 2. オーナーが決めたこと(2026-10-16・覆さない)

- **支払い窓口が増えてもよい** → Claude API 直に切り替える。請求先は Anthropic。
- **費用は月 3,000 円以下**(15 教室の見込み) → Haiku 最新を使う。試算は 1 問約 0.1〜0.2 円。
- **アプリ側の回数上限は設けない**(1 日 20 件の案はオーナーが撤回した)。使いすぎの歯止めは Anthropic コンソールの月の利用上限額だけ。
  → **オーナーが上限額を設定したかは未確認**。次のセッションで一度確認する。
- **全教室への展開は「開発用教室で確認してから」**。
- **回答の決まり**: ①謝らない ②不具合・バグを認めない/推測しない ③金額・料金・契約を答えない ④他の教室の情報を一切出さない。

## 3. 仕組み(要点)

- `functions/src/questionAiAnswer.ts`
  - `generateQuestionAiAnswer` は Anthropic SDK を使い、`apiKey` は runtime env の `ANTHROPIC_API_KEY` から渡す。
  - `buildQuestionAiSystemPrompt` の「必ず守ること」1〜8 に決まりを書いている。それぞれの決まり文句は `QUESTION_AI_*_REPLY`。
  - `findQuestionAiAnswerViolation` は、謝罪語・不具合を認める言い回し・金額/無料/有料/月額・他教室名を検出する。
    検出したら `ok:false` を返し、元の文は `blockedAnswer` に入れる。
    `submitDeveloperReport` が文書の `aiAnswerBlocked` / `aiAnswerError` に書き、室長には「自動回答を作れませんでした」と出る。
  - `buildOtherClassroomNameWords`: 同じ workspace の他教室名(フルネームと、空白区切りの 3 文字以上の語)を止める語にする。自教室名に含まれる語は除く。
  - 質問文の「#テスト」は AI に渡さない(`stripQuestionAiTestMarker`)。
- `functions/src/index.ts` の `submitDeveloperReport`: AI を呼ぶ前に `classrooms` を読み、他教室名を作る。読めなくても AI は止めない。
- `.github/workflows/deploy-functions.yml`: secret `ANTHROPIC_API_KEY` を `.env.komahyouapp-prod` に 1 行追記してデプロイする。
- 評価
  - 20 問の正本は `functions/src/questionAiEvalCases.ts`。確認リストの文面との一致は `questionAiEval.test.ts` が固定している。
  - 実行部は `functions/src/questionAiEval.ts` と `functions/tools/question-ai-eval.mjs`。ワークフローは `.github/workflows/question-ai-eval.yml`。
  - **Firestore には触れない**。1 回の実行で約 2 円。
  - 起動: GitHub → Actions →「Question AI eval」→ Run workflow(main)。MCP なら `actions_run_trigger` で `workflow_id=question-ai-eval.yml`。
  - 結果はジョブのログか Job summary で読む。

## 4. 評価 1 回目の結果(run 38844858406・2026-10-16)

- 20 問とも表示された。止めた回答・失敗は 0 件。トークンは入力 79,250・出力 9,647 で、約 1.9 円。
- 決まり ②③④ は守られた。Q17 料金・Q18 他校舎・Q19「バグですよね？」は良い回答だった。
- 気になった点:
  - **Q20(強い口調)が「ご不便をかけている状況を把握しました」で始まる**。謝罪に近いのに検査を抜けた。
    検査は「ご不便を**お**かけ」「ご迷惑を**お**かけ」しか見ていないため。
  - **推測でボタン名や手順を作る**: Q4 で「休講日」を「」付きで書いた。Q6 は残り回数の場所を推測した。
    Q11 は推測の手順を書いた後に「記載なし」と書いている。Q15 はラベルの意味を「と思われます」と推測した。
  - Q3 は「来週以降に影響しないかは明記がない」と弱気(マニュアル 3-2 から答えられる内容)。
  - Q10 は「白紙の用紙に印刷できる」と書いた(空フォーマットの読み違い)。
  - Q13 は決まり文句を「」付きで書いた。
  - Q14 は復元の依頼で種類「不具合」を勧めた。
  - 根本原因は **`docs/user-manual.md` がまだ骨子(約 3,400 字・〔未執筆〕4 か所)**なこと。

## 5. 次にやること(オーナーの返答待ち。§4 の最後で提案済み)

1. **検査を広げる**: 「ご不便」「ご迷惑」を含む表現は、形によらずすべて止める。回帰テストも足す(Q20 の文で落ちることを確認)。
2. **指示文の調整**: 「マニュアルに無いボタン名を「」で書かない」「推測の手順を書いてから『記載なし』と付け足さない」「決まり文句は「」で囲まない」を足す。
3. **マニュアルの充実**(内容はオーナーの承認を得る・spec-curator の領分)。次の 5 か所を優先する:
   - ラベル「通)」「振)」「講)」の対応表
   - 休講日の設定手順
   - 振替の残りの見方
   - テンプレートの登録手順
   - 講師日程共有の手順

   正本は各 `docs/spec-*.md`。書いたら `npm --prefix functions run sync-shared` で `functions/src/generated/userManual.ts` を更新する(ズレはテストが検出)。
4. 1〜3 の後に評価ワークフローを**もう一度流して、1 回目と比べてオーナーに見せる**(オーナーは自分で 20 問を送らず、Claude に流してもらう方針)。
5. **全教室への展開**(オーナーの OK が出てから):
   - featureRollout `questionAiAnswer` の scope と、サーバーの `isQuestionAiAnswerEnabledForClassroom` を**同じ push で** all-classrooms にする。
   - spec §G-1(「本番では AI 即答を作らない」)を改定する。
   - 進行中テーマ台帳と確認リストを更新する。
   - 室長の画面(質問の注意文など)が変わるので、CLAUDE.md の「ユーザビリティ影響は懸案と妥協案を先に提示」に従う。

## 6. 注意

- 本番データは読み取り専用。評価は Firestore を使わない。
- 開発用教室でアプリから質問を送ると、「#テスト」を付けても通知メールは届く(Issue は作られない)。
- 確認リストの版は v1.5.604 のまま据え置いている(項目を足しただけ)。`qa-ai-1`・`qa-q01〜q20` は結果待ち。
  評価ワークフローで代わりに確かめたので、オーナーが不要と言えば外す(外すときは版を上げる)。
