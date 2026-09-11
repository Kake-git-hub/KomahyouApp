# 計画: オーナー要望6件（2026-09-11 起案・第2版・次セッション着手用）

> **作成**: 2026-09-11（主セッション＝計画審査役、Fable 5.1）。**第2版（同日）**: オーナー回答を反映
> （戻るは再定義保留・現行バグのみ／盤面PDFは A3 縦固定のまま／質問種別は AI 提供者非依存・即答なし・費用規模を明記）
> と、追加要望「**保護者向け固定QR**（通常日程の確認＋室長へのテキスト連絡）」を追加（§7）。
> **前提版**: v1.5.498（docs のみ）。
> **役割分担（オーナー指示）**: 計画審査＝主セッション（利用可能な最上位モデル。今回は Fable 5.1）／
> 仕様策定・実装・原因特定・レビュー＝**Opus 最新**（spec-curator / dev-fix / regression-reviewer）／
> 手順が確立した単純作業＝**Sonnet 最新**（`Agent` 起動時に `model: sonnet` を明示）。特定モデルIDに固定しない。
>
> この文書は「次セッションが読めばそのまま着手できる」ことを目的にした**作業台帳**。仕様の正本ではない
> （仕様が確定したら `docs/spec-*.md` へ移し、ここからは参照に置き換える）。

---

## 0. 次セッションの起動手順（コピペ用）

```
コマ表アプリの続き。docs/plan-2026-09-11-five-requests.md（第2版）の「§1 全体の順番」に従って着手して。
まず solo-git-workflow の同期確認（git fetch / version.json）→ §9 のオーナー回答欄を確認 →
未回答の判断点は推奨案で仮置きして進め、着手前に AskUserQuestion で選択式にして確認して。
1テーマ1ブランチ。変更には必ずテストを同コミット。UX 系は INV 完了定義4点。main マージ前に regression-reviewer。
```

進め方の原則（既存ルールの再掲・厳守）:
- 編集前に `git fetch` と `version.json` の一致確認（CI が毎 push で bump するためローカルは遅れがち）。
- **1テーマ＝1ブランチ**（`fix/undo-dirty-state` / `feat/classroom-feature-options` / `feat/lesson-history` /
  `feat/board-print-selection` / `feat/parent-portal-qr` / `feat/report-question`）。段階（U-0 など）は同ブランチで小さくコミット。
- 変更ごとに `CHANGELOG.md` の `## 未リリース` へ1行。`package.json` の version は触らない。
- UX 系の修正は INV 完了定義4点（台帳で INV 特定／マトリクス拡張／兄弟監査／コミットに INV-ID）。
- Firestore への書き込み検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。本番3教室は読み取り専用。
- 新機能は **staging** で実機確認（着手直前に最新 main を staging へ反映して版を揃える）。
- functions を触る段は **Actions「Deploy Cloud Functions」** で反映。`firestore.rules` は
  `firebase deploy --only firestore:rules` を別途実行（main マージでは反映されない）。

---

## 1. 全体の順番と役割（推奨・第2版）

| 順 | ID | 内容 | 主担当 | 目安 | 先行条件 |
|---|---|---|---|---|---|
| 1 | **U-0** | 【バグ】戻る／やり直し後に盤面が「保存済み」扱いになり保存できない疑いの再現テスト＋修正（**戻るはこれだけ**） | dev-fix（Opus） | 0.5 セッション | なし。**最初にやる** |
| 2 | **O-1** | 教室別オプションの基盤（`classrooms/{id}.featureOverrides` ＋ 上書き層 ＋ 開発者画面） | dev-fix（Opus） | 1〜2 | §9-3 |
| 3 | **H-1〜H-4** | 講習履歴（生徒の休み・振替・出席の一覧、期間指定・最大1年） | dev-fix（Opus）＋Sonnet | 2〜3 | 承知済み |
| 4 | **P-1〜P-3** | 盤面PDF印刷（曜日×コマのグリッド選択 → 選択コマだけを **A3 縦**に最大化） | dev-fix（Opus）＋Sonnet | 1.5〜2 | A3 固定で確定 |
| 5 | **K-1〜K-5** | 保護者向け固定QR（生徒別トークン → 通常＋振替の日程閲覧 ＋ 室長へテキスト連絡） | spec-curator→dev-fix（Opus）＋Sonnet | 5〜7 | §9-6（壁打ち済み 4 点＋残り） |
| 6 | **Q-1〜Q-5** | 要望・報告に「質問」＋**AI 提供者非依存**の回答案フロー＋開発者承認＋返答通知（即答なし） | spec-curator→dev-fix（Opus）＋Sonnet | 3〜5 | §9-2（AI 契約は未定でも第1段は進められる） |
| 7 | **O-2** | 容易度 A の機能を1件ずつオプション登録（量産・隙間で） | **Sonnet** | 各 0.2 | O-1 |
| 保留 | U-1〜U-6 | 戻るボタンの再定義（統一 undo） | — | — | **オーナー判断 2026-09-11: 保留**（§2-4 に記録を残す） |

理由: U-0 は小さく実害が大きい。O-1 は後続の新機能（T4/T5/T6/T2）を**教室ごとに段階公開**する土台。
T5・T4 は読み取り専用で盤面状態を変えず回帰リスクが低い。T6（保護者QR）は利用者要望で価値が高いが
公開エンドポイントと個人情報を扱うため仕様を先に固める。T2 は AI 契約が未定でも「プロンプト書き出し＋貼り戻し」の第1段は進められる。

---

## 2. テーマ1: 戻るボタン（**再定義は保留・現行バグの疑いのみ修正**）

### 2-1. オーナー判断（2026-09-11）

「戻るボタンの再定義（すべて一段前へ完全復元）」は**一旦保留**。**U-0（現行バグの疑い）だけを修正**する。
§2-2〜2-3 は保留解除時の参考記録として残す。

### 2-2. 現状（調査結果の要点・参考）

「戻る」は **3つの独立した機構が併存**し、連動していない（`src/components/schedule-board/ScheduleBoardScreen.tsx`）。

| 機構 | 実体 | 深さ | 契機 | 戻すもの |
|---|---|---|---|---|
| ① 盤面 undo/redo | `undoStack`/`redoStack`（`HistoryEntry` :69-87、`createHistoryEntry` :8314、`handleUndo` :11310、`handleRedo` :11353） | 10 段（`MAX_HISTORY_DEPTH` :735） | `commitWeeks` :8348 が呼ばれた時（37 経路） | weeks 全週・holiday/forceOpen・抑止キー・回数調整・振替/講習在庫・削除の希望数差分 |
| ② 一段スナップショット | `undoSnapshot`（`src/App.tsx:1478`、`saveUndoSnapshot` :2193、`restoreUndoSnapshot` :2213） | 1 段（黄バナー） | 破壊的一括操作 5 箇所 | 教室データ丸ごと |
| ③ テンプレモード undo | `templateUndoStack`（:5089、`pushTemplateUndo` :5181） | 無制限・浅いクローン | テンプレ編集 | テンプレセル |

①が戻さないもの: 黄色コマ `reopenedSlots`（ラチェット仕様）／希望数の正本 `subjectSlots`（INV-07・削除1経路のみ差分）／
集団授業 `groupClassEntries`／別タブ日程表からの操作／基本データ・特別講習・ルール画面／監査ログ・台帳（設計上あえて）。

### 2-3. 保留中の障害・影響（再定義を再開するときの入口）

A 現行バグ疑い（→ U-0 で修正）／B 黄色コマはラチェット仕様＋Firestore 逆書込が要る／C 希望数は差分方式のみ（全コマ削除・丸ごと振替・
休日化・テンプレ上書きに差分設計が要る）／D 自動処理 4 経路が履歴を消費し undo 後に再発火しうる（INV-03）／E 画面遷移で履歴消滅
（`App.tsx:5373` 再マウント）／F 1 エントリ＝全週ディープクローン（差分化が前提）／G ②もサーバーへ書き戻さない／H 監査ログの補償イベント／
I undo が無い画面が多い／J 別タブ日程表・QR提出ページに「戻る」が無い／K 同期タイミング／L テンプレ undo は浅いクローン。
再開時のオーナー判断 8 点（範囲・黄色・QR提出・自動処理・画面またぎ・深さ・集団・監査）と段階 U-1〜U-6 は第1版（git 履歴 `0c00a3c`）を参照。

### 2-4. 実施する作業（U-0 のみ）

**症状（疑い）**: 保存後に「戻る」または「やり直し」を押すと盤面が「最新データ（保存済み）」表示になり、保存ボタンが効かず、
リロードで undo 前の状態が復活する。

**機序（コードで裏取り済み）**:
- `handleUndo` :11310-11351 ／ `handleRedo` :11353-11396 は `committedBoardChangeVersionRef` を上げず、`onBoardStateChange` も直接呼ばない。
- publish effect :5458-5486 が版数一致で通過し `userInitiated: isGroupClassUserEdit`（＝false）で発火。
- `App.tsx:2509-2521` `handleBoardStateChange` は `userInitiated:false` で `markStateLoadedClean()`（:2116-2120）→ clean 署名が undo 後の状態になる → `isBoardDirty` false → `BoardToolbar` の保存は `hasPendingSave` false でスキップ。
- undo 履歴は保存で消えない（`setUndoStack` の呼び出しは :8378／:11320／:11359 の3箇所のみ）ので「保存→戻る」は普通に起きる。
- ②`restoreUndoSnapshot` :2213-2234 も `markStateLoadedClean()` :2231 で clean 化するだけで書き戻さない（同型）。

| ID | 内容 | 担当 | テスト（同コミット必須） |
|---|---|---|---|
| **U-0a** | undo/redo の適用を純関数 `applyHistoryEntry(state, entry) → { nextState, publishPayload }` に切り出し、`handleUndo`/`handleRedo` で版数 bump ＋ `onBoardStateChange(payload, { userInitiated: true })` を `commitWeeks` :8405-8430 と同じ形で発行する。クロス汚染ガード（`App.tsx:2510-2513`）は**触らない**。 | dev-fix（Opus） | 「保存→操作→undo→publish が userInitiated:true」「undo 後の署名が clean と一致しない」を固定。**修正なしで落ちる**ことを確認。 |
| **U-0b** | ②`restoreUndoSnapshot` を「戻した結果を未保存（dirty）として扱う」に是正（clean 署名を更新しない or 保存対象にする）。 | dev-fix（Opus） | 「復元→戻す→dirty」の経路テスト。 |
| **U-0c** | INV 完了定義: **INV-02（手動編集の永続化）**に分類（undo の結果がリロードで巻き戻る＝手動編集が自動処理で消える構造）。`inv02-manual-edit-persistence.matrix.test.ts` に undo/redo/②の3経路を追加し、`spec-invariants.md` INV-02 の違反履歴に追記（同 push・`inv-guard`）。兄弟監査＝redo・②・テンプレ undo（③はテンプレ保存で別経路のため対象外を明記）。 | dev-fix→regression-reviewer | — |

**開発用教室での実機確認**: 保存→コマ移動→戻る→保存ボタンが青（dirty）→保存→リロードで戻した状態が残る。

---

## 3. テーマ2: 要望・報告に「質問」を追加（AI 提供者非依存の回答案 → 開発者承認 → 返答。即答なし）

### 3-1. オーナー判断（2026-09-11）と設計の前提

- **Claude API の利用金額規模を知りたい** → §3-2。
- **Claude を契約するか別の AI かは未定**。**AI を変えても回答案を作れる**こと。**即時でなくてよい**。
- **利用者への即答（自動回答）はしない**。公開したくない回答が出る不安があり、「公開してよい内容」の定義も未了。
  → 利用者に見えるのは**開発者が承認した回答だけ**。類似QAの即時提示も**定義ができるまで保留**（第2段）。

### 3-2. Claude API の費用規模（試算）

前提: 1 質問あたり入力 ≈ 23K トークン（利用者マニュアル 20K ＋ 質問と画面文脈 1K ＋ 承認済み類似QA 2K）、出力 ≈ 1K トークン。
日本語は「1文字 ≈ 1トークン」と仮置き（実測は `count_tokens` で要確認。実際は少し少なめになる見込み）。為替 ¥150/$。
料金（2026-06 時点の一次料金）: Opus 5 ＝ 入力 $5／出力 $25 per 100万トークン。Sonnet 5 ＝ $2／$10。Batches API は 50% 引き。

| 条件 | Opus 5 | Sonnet 5 |
|---|---|---|
| 1 件（即時・キャッシュなし） | ≈ $0.14 ≈ **¥21** | ≈ $0.056 ≈ **¥8** |
| 1 件（Batches・非即時） | ≈ ¥11 | ≈ ¥4 |
| 月 30 件 | ¥630（Batches ¥330） | ¥250（¥130） |
| 月 100 件 | ¥2,100（¥1,050） | ¥840（¥420） |
| 月 300 件 | ¥6,300（¥3,150） | ¥2,500（¥1,260） |

- **固定費なし**（従量・前払いクレジット。数ドル単位から）。Claude Code／claude.ai の契約とは**別枠**の API 契約。
- 比較: Firebase の現状原価は 2 教室で約 ¥300/月（memory）。質問が月数十件なら同程度の規模。
- prompt caching（マニュアルを system に固定）が効けば 1 件 ¥3〜8 に下がるが、質問が散発だとキャッシュ切れ（5 分／1 時間）が多く、上の「なし」を基準にするのが安全。
- 類似QA検索を LLM 化しても入力が小さく 1 回 ¥1〜2。第1段は字句一致（無料）。
- **API を使わないルート（下記 A/B）は追加費用ゼロ**。

### 3-3. AI 提供者非依存の設計（3 ルートを同じ「回答案パック」で束ねる）

「質問文＋画面文脈＋マニュアル抜粋＋承認済み類似QA」を **1 つのプロンプト文字列（回答案パック）**に組み立てる純関数
`buildAnswerDraftPrompt()` を正本にし、どのルートも同じパックを使う。

| ルート | 仕組み | 即時性 | 費用 | 契約 |
|---|---|---|---|---|
| **B（第1段・推奨）** プロンプト書き出し | 開発者承認画面に「AI用プロンプトをコピー」ボタン。開発者が任意の AI（claude.ai／ChatGPT／Gemini／Claude Code）に貼り付け、返答を「回答案」欄に貼り戻して編集・承認。 | 非即時 | 0 | 不要（既存契約のまま） |
| **A** Claude Code スキル | `.claude/skills/answer-question`：質問を読み取り専用 REST（gcloud トークン）で取得 → パックと `docs/` を読んで下書きを**画面に表示するだけ**（Firestore へは書かない。承認画面へ貼り付けるのは開発者）。 | 非即時 | 0（Claude Code の契約内） | 不要 |
| **C** Cloud Functions 自動生成 | `onDocumentCreated` → 提供者アダプタ `AnswerDraftProvider`（第1実装は `@anthropic-ai/sdk`・Node 22・既定 `claude-opus-5`・Batches 可）→ `answerDraft` を保存しメールに同梱。他社 AI はアダプタ追加で対応（この計画では Anthropic 実装のみ）。 | 即時／Batches なら翌営業日 | §3-2 | API 契約が決まってから |

**教室データ・操作痕跡（生徒名）はどのルートでも AI に送らない**（公開 Issue と同じ方針）。

### 3-4. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **Q-1** | `docs/spec-developer-report.md` に §G「質問」を追記: 種別・回答フロー（承認前は利用者に見せない）・**「公開してよい回答」の定義（教室固有情報／個人名／未リリース仕様／料金は不可 等）**・QA の公開範囲・AI に送らない情報。`docs/user-manual.md` の骨子（利用者語のマニュアル。AI の材料兼ヘルプ）。 | spec-curator（Opus） | — |
| **Q-2** | 種別 `question` の追加（client 型 `developerReport.ts:22-23`・server `functions/src/developerReport.ts:24-25`・React モーダル・埋め込みモーダル `scheduleHtml.ts:7070-7093`・Issue ラベル `type:question`・メール件名【質問】）。 | **Sonnet** | 既存 5 テストへ `question` ケース追加（`developerReport.test.ts` / functions 側 / `scheduleHtml.test.ts:4430-4488` の構文検証 / `tools/developer-report-notify.test.mjs`）。 |
| **Q-3** | 開発者承認画面（`DeveloperAdminScreen.tsx` に subPage `'questions'`）: 未回答／回答済み一覧・回答案パックのコピー（ルート B）・回答案欄・「承認して返答」・「QA として公開」チェック。確定は callable `answerDeveloperReport`（`requireDeveloperMember`）が `developerReports/{id}` に `answerFinal/answeredAt/answeredBy` を書き、公開時は `qaEntries/{id}` を作る。`buildAnswerDraftPrompt()` を `src/utils/answerDraftPrompt.ts` に純関数で。 | dev-fix（Opus） | パック組立て（含めない情報の除外を固定）・画面状態遷移の純関数・CF 入力検証。 |
| **Q-4** | 返答通知: 軽量コレクション `reportAnswers/{id}`（classroomId・質問要約・回答・answeredAt・readAt）＋ルール（教室メンバー read・write は CF のみ）＋起動時／実行中モーダル（QR提出通知 `App.tsx:178-254, 1521-1597, 4195-4226` の同型）＋callable `markReportAnswerRead`。 | dev-fix（Opus） | `selectStartupSubmissionsToNotify` 同型の純関数テスト＋`npm run test:rules`。 |
| **Q-5** | ルート A: Claude Code スキル `answer-question`（読み取り専用・下書き表示のみ）。 | dev-fix（Opus。手順化後は Sonnet） | スキルの読み取りスクリプトは `tools/*.test.mjs` の作法で。 |
| **Q-6（契約後）** | ルート C: `functions/src/answerDraftProvider.ts`（アダプタ境界）＋ Anthropic 実装（`draftDeveloperReportAnswer` onDocumentCreated・Batches 選択・`stop_reason` 確認・失敗は `answerDraftError`）。API キーは `functions/.env`／repo secret `PROD_FUNCTIONS_ENV`（Claude は値を扱わない）。 | dev-fix（Opus） | SDK はモック。プロンプトはパック純関数を再利用。 |
| **Q-7（定義後）** | 類似QA の即時提示（承認・公開済み `qaEntries` のみ。第1段は字句一致 2-gram・500ms デバウンス）。 | dev-fix（Opus）／UI は Sonnet | 類似度純関数テスト。 |

触るファイル: `src/utils/developerReport.ts`、`DeveloperReportModal.tsx`、`scheduleHtml.ts`、`App.tsx`（通知）、`DeveloperAdminScreen.tsx`、
`functions/src/index.ts`／`developerReport.ts`、新規 `src/utils/answerDraftPrompt.ts`・`functions/src/reportAnswer.ts`、`firebase/firestore.rules`、
`tools/developer-report-notify.mjs`、`.claude/skills/answer-question/`（Q-5）。

---

## 4. テーマ3: 機能を教室ごとにオプション化（開示／非表示）

### 4-1. 回答: 「仕様変更せず、非表示にするだけで ON/OFF できる」機能の一覧

容易度 **A**＝入口を隠すだけで成立。**B**＝入口に加えて表示側／自動処理の停止が要る。**C**＝仕様変更が要る。

**A（そのままオプション化できる）**

| 機能 | 入口の所在 | 備考 |
|---|---|---|
| 要望・報告（盤面） | `BoardToolbar.tsx:235-237`（`onReportToDeveloper` を渡さなければ消える） | optional prop 方式の見本 |
| 要望・報告（日程表タブ） | `scheduleHtml.ts:2777` | HTML 1 行 |
| 講師日程共有（QR/URL） | `BoardToolbar.tsx:232-234` | **既に配った URL は生き続ける**（`boardShares` 公開読み） |
| 空フォーマット印刷 | `scheduleHtml.ts:2781` | 最も安全（localStorage のみ） |
| 講習集計結果 | `scheduleHtml.ts:2782` | 表示専用 |
| 印刷用全員表示 | `scheduleHtml.ts:2783` | — |
| 生徒名の長押しD&D | `ScheduleBoardScreen.tsx:4962` / `:9741` | **既にフラグ化済み** |
| 講師の長押しD&D／入替 | `:4964` / `:9912` | 既にフラグ化済み |
| 日程表コマ組みD&D | `:4967` → payload | 既にフラグ化済み |
| 日程表の自動同期 | `:4970` / `:7205` | 既にフラグ化済み（OFF＝「最新表示」運用） |
| 生徒日程表のオプション欄 | `:4956` → payload・QR 側 `App.tsx:3356-3362` | 既にフラグ化済み・全経路が 1 フラグで揃う理想形 |
| 丸ごと振替 | `ScheduleBoardScreen.tsx:11775-11789` | メニュー項目 1 個 |
| 生徒を空にする（日付メニュー） | `:11799-11806` | — |
| 並べ替え（席詰め／席順） | `BoardToolbar.tsx:231`、`:12065-12088` | — |
| 自動割振ボタン（在庫モーダル） | `:11631-11656` | 個別割振は残る |
| 振替も同時に自動割当 | `:11621-11629` | チェック 1 個 |
| 自動割振デバッグ結果パネル | `:11907-11940` | 開発用途 |
| PDF出力 | `BoardToolbar.tsx:277-279` | テーマ4と同居 |
| 講師日程（別タブ） | `BoardToolbar.tsx:274-276` | 生徒日程は基幹なので対象外 |
| 集団授業の盤面2行＋メニュー | `BoardGrid.tsx:505-506`、`:11976-12022` | A〜B。既存割当がある教室は日程表に残る |
| （新規）保護者QR（§7）・講習履歴（§6）・コマ選択印刷（§5）・質問種別（§3） | 実装時にフラグ登録 | **新機能は最初からフラグ付きで作る** |

**B（入口＋もう一手が要る）**: 外部生チェック（表示側も切る）／休日設定（代替入口が要る）／自動割振ルール画面・ペア制約（既存ルールは効き続ける）／
通常授業テンプレ作成（既存テンプレは効く。危険操作なので隠す価値は高い）／未消化チップ（在庫は裏で動く＝実質不可）／バックアップ・復元タブ
（セクション単位なら A）／QR提出・講習提出（購読と起動時自己修復の停止が要る）／後から出席可能に変更（既存 `reopenedSlots` は効き続ける）。

**C（仕様変更が要る／切らない）**: 特別講習データ画面／集団出席者一覧（集団とセットなら可）／盤面ベース予定数 `boardBasedPlannedCount`
（切替で過去月の数字が動く。教室別 ON/OFF にせず一方向の段階導入に留める）。

### 4-2. 開発者側のオプション管理手法（推奨＝案A）

- **置き場**: `classrooms/{id}.featureOverrides: Partial<Record<FeatureRolloutKey, boolean>>`。`firestore.rules:58-61` で
  **read＝教室アクセス権／write＝開発者のみ**が既に整っており、ルール変更ゼロ。室長はログイン時に自教室 1 件を読むので配信コストもゼロ。
- **判定**: `src/utils/featureRollout.ts:111-120` の `isFeatureEnabledForClassroom(key, classroom, overrides?)` に「override があれば scope より優先」を追加。
  レジストリ（`:22-95`）の `description` を UI ラベルに流用。
- **UI**: `DeveloperAdminScreen.tsx:442` 直後（UID 差し替えグリッドの下）に教室カードごとのチェックボックス群。保存は既存の
  `onUpdateClassroom → App.tsx:2672 → :1708 queueRemoteWorkspaceClassroomUpdate → CF updateWorkspaceClassroom (functions/src/index.ts:1471)` に相乗り。
- **配線 7 箇所**: `appState.ts:147-158`／`workspaceStore.ts:21-30`・`:574-586`（読み戻し）／`adminFunctions.ts:90-99`／
  `functions/src/index.ts:1508-1516`（既知キーのみ許可）／`App.tsx:1708-1743`・`:2672-2724`／`featureRollout.ts`。
  ⚠️ **`studentUnitPrice` は同じ経路で配線漏れ（Firestore に到達せずリロードで消える）**。同じ穴を避けるため「7 箇所すべて」をテストで固定。
- **必須の付随修正**: `ScheduleBoardScreen.tsx:4956-4970` は `{ name: classroomName }` しか渡していない。`classroomStorageKey`（教室ID、`App.tsx:5376`）と overrides を props で受けて `{ id, name }` で判定。
- **名前ベース判定を持ち込まない**（`developmentClassroom.ts:28-29`）。オプションは教室ID固定。
- 案B（レジストリに `classroomIds` 直書き）は「1教室で先行検証」の橋渡し用途のみ。

### 4-3. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **O-1** | 基盤（配線 7 箇所＋判定の上書き層＋開発者画面 UI＋ID 判定への是正） | dev-fix（Opus） | `featureRollout.test.ts`／CF 入力検証／送信フィールド固定（純関数化）／`npm run test:rules`（室長は `classrooms` を書けない・既存 :88-91 維持） |
| **O-2** | A 群を1件ずつレジストリ登録（キー追加＋入口ゲート＋テスト1件）。優先: 要望・報告／講師日程共有／空フォーマット印刷／講習集計結果／丸ごと振替／並べ替え／自動割振／PDF出力／集団2行。 | **Sonnet**（1件＝1コミット） | 「OFF で入口が出ない・ON で従来どおり」 |
| **O-3** | B 群は個別に spec-curator → dev-fix | Opus | — |

---

## 5. テーマ4: 盤面PDF印刷（曜日×コマのグリッド選択 → 選択コマだけを **A3 縦**に最大化）

### 5-1. オーナー判断（2026-09-11）

用紙は **現状の A3 縦固定のまま**（用紙サイズは利用者が印刷設定で変える）。A4 化・縦横自動選択は**やらない**。

### 5-2. 現状（要点）

- 入口 `BoardToolbar.tsx:277-279`「PDF出力」→ `handlePrintPdf`（`ScheduleBoardScreen.tsx:10380-10399`）→ `exportBoardPdf`（`src/utils/pdf.ts:237-479`）。オプション画面は無く即出力。
- 方式: 表示中の週の DOM をクローン → sticky 解除・列幅固定 px（`applyBoardPdfColumnWidths` :215-235）→ `html2canvas(scale 1.1)` → `jsPDF` A3 縦、1 週間を 1 ページ。
  フィットは `renderScale = Math.min(contentW/canvasW, contentH/canvasH)`（:470-476）＝アスペクト比維持の最大化（**拡大も効く**）。生徒文字は縮小方向のみ（最大 34px）。
- 「曜日×時限」の行列は `BoardGrid.tsx:428-450`（`days` / `slotNumbers`）が既に作っている。時限は `slotTimes.ts:3-9`。定休日は `SlotCell.isOpenDay`。
- テストは無い（`pdf.test.ts` 不在）。

### 5-3. 設計方針（推奨）

- **選択 UI**: 「PDF出力」→ モーダル。行＝時限・列＝曜日（表示週の営業日）のチェックボックス表。**初期状態は全選択**（＝現状の 1 週間出力と同じ結果）。
  行頭／列頭で一括トグル。任意セル選択可（§9-4 で最終確認）。空選択は無効。
- **描画**: 表示ルールの二重管理を避けるため**既存 BoardGrid の DOM をクローンして間引く**。`BoardGrid` のセルに `data-date-key` / `data-slot-number` を付け、クローン側で
  (1) 未選択曜日の列グループ（4 サブ列）を `<col>`/`<td>` ごと除去 (2) 未選択時限の行を除去 (3) 矩形内の未選択セルは空白化。
- **フィット**: A3 縦固定のまま、既存 `renderScale` で最大化（少数コマなら自然に拡大）。`html2canvas` の `scale` を選択数に応じて上げる（少数ほど高解像度・上限 3）。
  生徒文字の上限 34px を「セル高に応じた拡大」へ緩める。全選択時は現状と同一出力（間引きなし）を保証。

### 5-4. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **P-1** | 純関数: `buildBoardPrintGrid(cells)`（曜日×時限の行列）／`resolveBoardPrintSelection(grid, checked)`（含める曜日・時限・空白セル）／`resolveBoardPrintCanvasScale(cellCount)`。`BoardGrid` へ data 属性追加。 | dev-fix（Opus） | 定休日除外・空選択・1 コマ・全選択（＝間引きなし）を固定。 |
| **P-2** | `pdf.ts` に `exportBoardPdfSelection(element, selection)` を追加（既存 `exportBoardPdf` は無改変で残し、全選択時はそれを呼ぶ）。間引きは jsdom で合成テーブルを作って検証。 | dev-fix（Opus） | 間引き後の列数・行数・空白セルの位置。 |
| **P-3** | 選択モーダル UI（`BoardPrintSelectionModal.tsx`）＋ツールバー配線＋`docs/board-pdf-design.md`・`spec-schedule-pdf.md §I` 追記。 | **Sonnet** | 状態遷移（トグル・一括・無効化）の純関数テスト。staging で実機 PDF を目視。 |

---

## 6. テーマ5: 講習履歴（生徒の休み・振替・出席の詳細一覧、期間指定・最大1年）— **承知済み**

### 6-1. 現状（要点）

- 「講習集計結果」は `scheduleHtml.ts:2782` のボタン（左が「空フォーマット印刷」:2781）。別タブに自己完結 HTML を開く（:6736-6812）。「開いている生徒」は `#schedule-person-select` の `appliedPersonId`（本体側 `studentScheduleRange.personId`、`ScheduleBoardScreen.tsx:5820-5849`）。
- 履歴の正本は **`lessonLedgerDays`**（`classroomSnapshots/{id}/lessonLedgerDays/{YYYY-MM-DD}`、保存のたび生成・**直近 400 日分を 1 文書に保持**・保持 2 年。`src/utils/studentLessonLedger.ts:1-13`）。
  トークン `YYYY-MM-DD#限|授業種別|振替元日` で `attended / absent / absentNoMakeup / placed / makeupRemaining` を生徒×科目ごとに持つ（講師名は持たない）。
- **クライアントからは読めない**（`firestore.rules` に match が無い）。盤面 `weeks` だけでは不十分（過去週はトリム `boardWeekTrim.ts:56-57`・再合成はテンプレ由来）。

### 6-2. 設計（推奨案で確定扱い）

- **データ**: callable `getStudentLessonHistory({ classroomId, studentId, from, to })`。`requireClassroomAccessMember` → `to` 以前で最新の `lessonLedgerDays` を Admin SDK で取得・解凍 → 対象生徒の行をパースして日付順イベント配列。当日の未保存編集は含まれない旨を明記。全授業種別（通常／振替／講習）を出し種別フィルタ。
- **表示**: 「講習集計結果」の左に「講習履歴」ボタン（`scheduleHtml.ts:2782` 直前）→ opener へ `schedule-lesson-history-request` → 本体が callable → `schedule-lesson-history-result` → 日程表タブ内オーバーレイ（要望・報告モーダルの往復パターン `:7043-7180`）。期間は開始／終了 `input[type=date]`（既定＝終了日から 1 年・366 日超は丸める）。印刷ボタン。
- 講師名の補完（盤面 `weeks` から）は第2段。

### 6-3. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **H-1** | パーサ `parseLessonLedgerTokens(row) → LessonHistoryEvent[]`＋期間フィルタ／並べ替え（`studentLessonLedger.ts` に追加。`tools/lesson-ledger-report.mjs` の表示ロジックを純関数へ）。 | dev-fix（Opus） | 実トークン形の往復テスト。 |
| **H-2** | callable `getStudentLessonHistory`（`functions/src/lessonLedgerHistory.ts`）: 権限・日付選択・解凍・生徒フィルタ・上限 366 日。 | dev-fix（Opus） | 純関数部のテスト。 |
| **H-3** | 本体側: 受信（`ScheduleBoardScreen.tsx:5820` 台の作法）→ callable → 結果返信。 | dev-fix（Opus） | メッセージのパース・結果整形。 |
| **H-4** | 日程表タブのボタン＋オーバーレイ（期間・フィルタ・表・印刷）。 | **Sonnet**＋Opus レビュー | `scheduleHtml.test.ts` の new Function 構文検証＋ボタン露出・メッセージ種別（:3635-3697 の作法）。 |

---

## 7. テーマ6（新規）: 保護者向け固定QR — 通常＋振替の日程閲覧 ＋ 室長へのテキスト連絡

### 7-1. 要望と壁打ちで決まったこと（2026-09-11）

- 要望: **生徒登録時に生徒別の固定QR**を作り、保護者がその QR から (a) **講習期間を除く通常授業の日程**を確認 (b) **室長へテキストで連絡**できる。
- 壁打ち回答: **表示範囲＝通常＋振替**（休み→振替先も表示）／**連絡はアプリ内通知のみ**／**返信は一方向（保護者→室長）のみ**／
  **QR の配布形＝基本データの生徒ごとに表示・印刷**。

### 7-2. 既存の土台（調査結果の要点）

| 部品 | 所在 | 今回への含意 |
|---|---|---|
| QR 講習提出ページ | `src/components/submission/SubmissionPage.tsx:94-106, 233-263, 341-374`。**未認証ブラウザから Cloud Function `lectureSubmissionApi` を fetch するだけ**（Firestore 直読みなし・匿名認証なし）。ルーティングは `src/main.tsx:66-74, 94-118`（`/s/{token}`・`#/submit/{token}`。App を読み込まない軽量経路）。Hosting rewrite `firebase.json:92-99`。 | **保護者ページの型はこれ**（オンデマンド関数型）。 |
| `lectureSubmissionApi` | `functions/src/index.ts:2654-2802`（onRequest・cors・asia-northeast1）。**トークン検証は長さのみ／教室所有権検証なし／レート制限なし**。教室スナップショットの読み出しヘルパ `readStoredSnapshotPayload` :1032-1045（gzip 対応）。 | 新 API は所有権検証・回数制限を**関数側で**入れる（既存の穴を新規では埋める）。 |
| 講師日程共有（配布用盤面） | `boardShares/{token}` 公開 read（`firestore.rules:134-138`）。盤面 state が変わるたび `setDoc`（`App.tsx:2430-2488`・デバウンスなし）。再発行／失効 UI なし。 | **生徒別には不適**（生徒数×編集回数の書込・個人情報の公開文書が常駐・失効不能）。 |
| QR 生成 | `src/utils/qrcode.ts:1-20` `generateQrSvg(text, size)`。表示モーダル `ScheduleBoardScreen.tsx:10406-10410`。短縮 URL `scheduleQrConfig.ts:49-58` `buildSubmissionUrl`。 | そのまま流用。 |
| 生徒データ | `StudentRow`（`basicDataModel.ts:16-30`: id/name/displayName/email/entryDate/withdrawDate/birthDate/isExternal）。追加 `BasicDataScreen.tsx:1047-1061`。在籍判定 `isActiveOnDate`（:193-200）・高3卒業 `resolveGraduationWithdrawDate`（:246-256）。 | 失効判定にそのまま使える。 |
| 本体への通知 | QR提出通知の三点セット（購読 `lectureSubmission.ts:492-535`・選別 `App.tsx:223-254`・モーダル `App.tsx:1521-1597`・既読 `notifiedAt` サーバー記録 :444-473）。 | 保護者連絡の室長通知に流用。 |
| 開発用教室QR混入対策 | 発行元教室タグ `submissionTokenClassroomId`（`specialSessionModel.ts:44-47`）・所有権チェック `developmentClassroom.ts:41-48`・剥がし `:54-81`・doc の classroomId を権威にするガード `lectureSubmission.ts:260-267`。**関数側には未実装**。 | 新トークンでも踏襲し、**関数側でも検証**。他教室コピー時に剥がす。 |
| サーバー側の日程計算 | **存在しない**（`functions/` は別 TS プロジェクト。クライアントの `regularLessonTemplate.ts:258-324` 曜日展開・`scheduleViewData.ts:305-335` 生徒配置抽出が参考）。講習期間は `SpecialSessionRow.startDate/endDate`（`specialSessionModel.ts:181-190`）。 | **新規移植が要る**（最大の実装コスト）。 |
| レート制限・TTL | いずれも無し（`saveAttempts` は冪等保存の記録）。 | 新規に最小限を入れる。 |

### 7-3. 設計方針（推奨）

- **トークン**: 権威は Firestore `studentPortalTokens/{token}`（`workspaceKey・classroomId・studentId・createdAt・revokedAt`。**クライアントはルールで読み書き不可・CF のみ**）。
  `StudentRow.parentPortalToken` に**表示用の写し**を持つ（QR 描画用）。発行は callable `issueStudentPortalToken`（室長認証）を基本データ画面の生徒編集から呼ぶ（生徒追加時に自動発行）。
  他教室バックアップ読込・開発用教室コピー時は `parentPortalToken` を**剥がす**（`stripSubmissionToken` と同型）。
- **公開ページ**: `main.tsx` に `/p/{token}` を追加（`/s/{token}` と同じ軽量経路・App を読まない）。スマホ前提。内容＝生徒表示名・教室名・
  **期間内（既定: 今日の 1 週間前〜4 週間後）の通常＋振替**（日付・曜日・時限・時刻・科目。休みは「休み → 振替: ○月○日○限」）。講習期間に入る日は「講習期間（別途ご案内）」として除外。
  講師名・他生徒・在庫数は出さない。下部に「室長へ連絡」フォーム（本文 500 字まで・送信者名は任意・送信後に受付表示）。
- **API**: `parentPortalApi`（onRequest・`firebase.json` に `/api/parent/**` rewrite）。
  GET: トークン → `studentPortalTokens` 参照 → `revokedAt` 無し → 教室スナップショットを `readStoredSnapshotPayload` で読む → 生徒が存在し `isActiveOnDate` 真 →
  盤面 `weeks` にある日はその内容（振替反映）、無い日は**テンプレ展開（通常のみ）**で補う → 講習期間除外 → JSON。
  POST: 本文検証（長さ・空・制御文字）→ **回数制限（トークンあたり 1 日 5 件・全体で 1 分 30 件）** → `parentMessages/{id}`（classroomId・studentId・studentName・body・senderName・createdAt・notifiedAt:null）。
- **室長通知**: `parentMessages` を教室 ID で購読（ルール: 教室メンバー read・write は CF のみ）→ QR提出通知と同じ起動時／実行中モーダル →「確認」で `notifiedAt`（callable `markParentMessagesNotified`）。
  過去の連絡は**基本データ画面の生徒詳細に「連絡履歴」**として一覧（第1段は最小: 日時・本文）。
- **再発行／失効**: 生徒編集画面に「QR を再発行」（旧トークンを `revokedAt` 化）。退塾日翌日・高3卒業後は GET が自動で拒否（`isActiveOnDate`）。
- **機能フラグ**: `parentPortalQr`（O-1 の基盤で教室別に段階公開。まず開発用教室→1 教室）。
- **既存との分離**: 講習提出トークン（セッションごと）とは別物。`lectureSubmissionApi` は無改変。

### 7-4. 懸案（トレードオフ・副作用・回帰リスク）と妥協案

| 懸案 | 内容 | 妥協案／対策 |
|---|---|---|
| 固定QRは「持ち主＝閲覧者」 | 写真が出回れば第三者が日程を見られる・連絡を送れる（ベアラートークン）。 | 表示情報を最小化（講師名・住所なし）／再発行ボタン／退塾で自動失効／URL は推測不能な 32 文字。Firestore に公開文書を置かない（関数型）。 |
| なりすまし連絡 | 誰でも「保護者です」と送れる。 | 送信者名は自由記入だが「本人確認はしていない」注記を室長側に表示／回数制限／本文に URL を含む場合は警告表示。 |
| スパム・コスト | 公開エンドポイントへの連打。 | 関数側の回数制限＋本文長制限＋`maxInstances`。GET は読み取りのみで書込コストなし。 |
| 未来の日程の正確さ | 盤面 `weeks` は今日から 26 週先までしか保持されず、未来週は端末で生成される。サーバー側に「無い週」がある。 | 無い日はテンプレ展開で補い「予定（変更の可能性あり）」と明記。表示期間を 4 週間に絞る。**保存済みの状態**が見える（未保存の編集は反映されない）旨を注記。 |
| 講習期間の「除外」の境界 | 講習期間中に通常授業がある教室・期間の重なり。 | 第1段は「講習セッションの `startDate〜endDate` に入る日は表示しない」で固定し、境界は spec-curator が仕様化（§9-6）。 |
| サーバー側計算の二重実装 | 曜日展開・生徒配置抽出をクライアントと別に持つと、盤面の仕様変更で食い違う。 | 純関数を `src/utils/parentSchedule.ts` に**1 本**書き、functions のビルドで同梱（`functions/src/generated/` に複製をビルド時生成・手書き禁止）。テストは同じ fixture で両側から実行。 |
| 個人情報の所在 | `parentMessages` に保護者の文面が残る。 | 保持期間（既定 1 年）を `retentionCleanup` に追加。Issue・メール・AI へは送らない。 |
| 開発用教室での検証 | 本番トークンが開発用教室へ混入すると本番生徒の日程が見える。 | 発行元教室タグ＋コピー時の剥がし＋**関数側で「トークンの教室に生徒が実在し在籍」**を検証。実機は staging。 |

### 7-5. 残りの壁打ち（→ §9-6。推奨で仮置き可）

1. 表示期間（推奨: 1 週間前〜4 週間後。ページ内で前後に送れる）。
2. 講師名を出すか（推奨: 出さない）。
3. 送信者名欄（推奨: 任意）と本文上限（推奨: 500 字）。
4. 送信回数上限（推奨: トークンあたり 1 日 5 件）。
5. 連絡履歴の置き場（推奨: 基本データの生徒詳細＋通知モーダル）。
6. 退塾後の扱い（推奨: 退塾日翌日から閲覧不可・連絡不可）。
7. QR の紙（推奨: 生徒編集画面から個別印刷。カード PDF・日程表への印字は第2段）。
8. 講習期間中の通常授業（推奨: 期間内は一律非表示）。

### 7-6. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **K-1** | 仕様正本 `docs/spec-parent-portal.md` 新設（トークン・表示範囲・除外規則・連絡・通知・失効・回数制限・非表示情報・INV-08 との関係）。 | spec-curator（Opus） | — |
| **K-2** | トークン基盤: `studentPortalTokens` ＋ callable `issueStudentPortalToken`／`revokeStudentPortalToken` ＋ `StudentRow.parentPortalToken`（写し）＋コピー時の剥がし＋ルール。 | dev-fix（Opus） | 発行・失効・剥がしの純関数／`npm run test:rules`（クライアント不可）／教室分離（INV-08 経路）。 |
| **K-3** | 日程計算の純関数 `buildParentScheduleView(payload, studentId, from, to)`（通常＋振替・講習期間除外・テンプレ補完）を `src/utils/parentSchedule.ts` に。functions へビルド時同梱。 | dev-fix（Opus） | 本番形の fixture（休み→振替先／講習期間またぎ／未来週なし／退塾）。両側から同 fixture。 |
| **K-4** | `parentPortalApi`（GET/POST・所有権検証・在籍検証・回数制限）＋ `/p/{token}` ページ（閲覧＋連絡フォーム）＋ `firebase.json` rewrite。 | dev-fix（Opus）／ページ UI は Sonnet | 関数側の検証ロジックを純関数化してテスト（`lectureSubmissionApi` には無かった単体テストをここで作る）。 |
| **K-5** | 室長通知（`parentMessages` 購読＋モーダル＋既読）＋連絡履歴（基本データ）＋保持期間＋フラグ `parentPortalQr`。 | dev-fix（Opus） | 選別純関数／ルール／retention。 |
| **K-6** | 基本データ画面: 生徒追加時の自動発行・QR 表示・印刷・再発行。 | **Sonnet**（設計済み UI） | 表示条件（在籍のみ）の純関数テスト。 |

**検証**: 開発用教室で発行→staging の `/p/{token}` をスマホで開く→連絡送信→本体の通知モーダル→既読。本番は 1 教室から段階公開。

---

## 8. 横断事項

- **INV**: U-0 は INV-02。T6 は INV-08（教室分離: トークンの教室に生徒が実在し在籍）を関数側テストで固定。T2/T3/T4/T5 は盤面状態を変えない。
- **回帰防止**: `scheduleHtml.ts` を触る段（H-4・Q-2）は new Function 構文検証が門番。T4 は「全選択＝現状と同一出力」をテストで保証。
- **functions デプロイ**: T5（H-2）・T6（K-2/K-4/K-5）・T2（Q-3/Q-4/Q-6）。Actions「Deploy Cloud Functions」→ ライブ GET で実反映を検証（409 誤成功に注意）。
- **rules デプロイ**: T6（`studentPortalTokens`・`parentMessages`）・T2（`reportAnswers`・`qaEntries`）。`firebase deploy --only firestore:rules`。
- **Hosting**: T6 は `firebase.json` に `/api/parent/**` rewrite 追加（main マージで反映）。
- **秘密情報**: Anthropic API キーはルート C 採用時のみ。`functions/.env`／`PROD_FUNCTIONS_ENV`。Claude は値を扱わない。
- **staging**: T4/T5/T6/T2 は staging で実機確認。開始前に「Deploy to Staging」で版を揃える。
- **メモリ**: memory `komahyou-plan-2026-09-11-five-requests` を第2版に更新済み。

---

## 9. オーナー確認事項（回答欄）

回答が無い項目は「推奨」で仮置きし、着手時に AskUserQuestion で再確認する。

### 9-1. 戻るボタン — **回答済み（2026-09-11）**
- 再定義は保留。U-0（現行バグの疑い）のみ修正。
- [ ] U-0 の修正を main へ自動マージしてよいか（推奨: よい。回帰テスト同梱・開発用教室で確認後）: ______

### 9-2. 質問種別＋AI回答案 — **一部回答済み**
- 回答済み: AI 提供者非依存・即時不要／利用者への即答なし／費用規模は §3-2。
- [ ] 第1段はルート B（プロンプト書き出し）でよいか。ルート A（Claude Code スキル）も足すか（推奨: B＋A）: ______
- [ ] ルート C（API 自動）は契約決定後に着手（推奨: はい。モデル既定 `claude-opus-5`・Batches で半額）: ______
- [ ] 「公開してよい回答」の定義は spec-curator の叩き台をオーナーが確定（Q-1）: ______
- [ ] QA の公開範囲の既定（推奨: 全教室共有・公開時に開発者が編集）: ______

### 9-3. 教室別オプション
- [ ] 既定＝全教室 ON・開発者が個別 OFF（推奨: はい）: ______
- [ ] OFF 時は消す（推奨）／「無効」と見せる: ______
- [ ] B 群で欲しいもの: ______
- [ ] 反映はリロード後（推奨: はい）: ______

### 9-4. 盤面PDF印刷 — **回答済み（A3 縦固定のまま）**
- [ ] 任意セル選択（推奨）／矩形のみ: ______
- [ ] 初期状態＝全選択（現状と同一出力）でよいか（推奨: はい）: ______

### 9-5. 講習履歴 — **承知済み**
- 推奨で確定扱い（全授業種別・日程表タブ内オーバーレイ・保存済み記録のみ・講師名は第2段）。変更があれば記入: ______

### 9-6. 保護者向け固定QR — **壁打ち 4 点回答済み**
- 回答済み: 通常＋振替／アプリ内通知のみ／一方向／基本データで個別表示・印刷。
- [ ] 表示期間（推奨: 1 週間前〜4 週間後）: ______
- [ ] 講師名（推奨: 出さない）: ______
- [ ] 送信者名は任意・本文 500 字（推奨）: ______
- [ ] 回数上限 1 日 5 件（推奨）: ______
- [ ] 連絡履歴は基本データの生徒詳細（推奨）: ______
- [ ] 退塾日翌日から失効（推奨）: ______
- [ ] 講習期間中は一律非表示（推奨）: ______
- [ ] 段階公開の最初の教室: ______
