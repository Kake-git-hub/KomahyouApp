# 計画: オーナー要望5件（2026-09-11 起案・次セッション着手用）

> **作成**: 2026-09-11（主セッション＝計画審査役、Fable 5.1）。**前提版**: v1.5.497（ローカル main ＝ origin/main ＝ ライブ）。
> **役割分担（オーナー指示）**: 計画審査＝主セッション（利用可能な最上位モデル。今回は Fable 5.1）／
> 仕様策定・実装・原因特定・レビュー＝**Opus 最新**（spec-curator / dev-fix / regression-reviewer）／
> 手順が確立した単純作業＝**Sonnet 最新**（`Agent` 起動時に `model: sonnet` を明示）。
> 特定モデルIDに固定しない（CLAUDE.md「モデル割当方針」）。
>
> この文書は「次セッションが読めばそのまま着手できる」ことを目的にした**作業台帳**。仕様の正本ではない
> （仕様が確定したら `docs/spec-*.md` へ移し、ここからは参照に置き換える）。

---

## 0. 次セッションの起動手順（コピペ用）

```
コマ表アプリの続き。docs/plan-2026-09-11-five-requests.md の「§1 全体の順番」に従って着手して。
まず solo-git-workflow の同期確認（git fetch / version.json）→ §8 のオーナー回答欄を確認 →
未回答の判断点は推奨案で仮置きして進め、着手前に AskUserQuestion で選択式にして確認して。
1テーマ1ブランチ。変更には必ずテストを同コミット。UX 系は INV 完了定義4点。main マージ前に regression-reviewer。
```

進め方の原則（既存ルールの再掲・厳守）:
- 編集前に `git fetch` と `version.json` の一致確認（CI が毎 push で bump するためローカルは遅れがち）。
- **1テーマ＝1ブランチ**（`feat/undo-unify` / `feat/report-question` / `feat/classroom-feature-options` /
  `feat/board-print-selection` / `feat/lesson-history`）。テーマ内の段階（U-0 など）は同ブランチで小さくコミット。
- 変更ごとに `CHANGELOG.md` の `## 未リリース` へ1行。`package.json` の version は触らない。
- UX 系の修正は INV 完了定義4点（台帳で INV 特定／マトリクス拡張／兄弟監査／コミットに INV-ID）。
- Firestore への書き込み検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。本番3教室は読み取り専用。
- 新機能は **staging** で実機確認（着手直前に最新 main を staging へ反映して版を揃える）。
- functions を触る段は **Actions「Deploy Cloud Functions」** で反映。`firestore.rules` は
  `firebase deploy --only firestore:rules` を別途実行（main マージでは反映されない）。

---

## 1. 全体の順番と役割（推奨）

| 順 | ID | 内容 | 主担当 | 目安 | 先行条件 |
|---|---|---|---|---|---|
| 1 | **U-0** | 【バグ】戻る／やり直し後に盤面が「保存済み」扱いになり保存できない疑いの再現テスト＋修正 | dev-fix（Opus） | 0.5 セッション | なし。**最初にやる** |
| 2 | **O-1** | 教室別オプションの基盤（`classrooms/{id}.featureOverrides` ＋ 上書き層 ＋ 開発者画面） | dev-fix（Opus） | 1〜2 | オーナー回答 §8-3 |
| 3 | **U-1** | 「戻る」の仕様正本 `docs/spec-undo.md` 新設（対象操作表・対象状態表・サーバー副作用の扱い） | spec-curator（Opus） | 0.5〜1 | オーナー回答 §8-1（**早めに集める**） |
| 4 | **H-1〜H-4** | 講習履歴（生徒の休み・振替・出席の一覧、期間指定・最大1年） | dev-fix（Opus）＋Sonnet | 2〜3 | オーナー回答 §8-5 |
| 5 | **P-1〜P-3** | 盤面PDF印刷（曜日×コマのグリッド選択 → 選択コマだけを A4 最大化） | dev-fix（Opus）＋Sonnet | 2〜3 | オーナー回答 §8-4 |
| 6 | **Q-1〜Q-6** | 要望・報告に「質問」＋AI回答案＋開発者承認＋類似QA提示 | spec-curator→dev-fix（Opus）＋Sonnet | 5〜7 | オーナー回答 §8-2、**Anthropic API キー**（オーナー取得） |
| 7 | **U-2〜U-5** | 統一 undo の実装（差分化・自動処理の非積載・別タブ操作の取り込み・テンプレ undo の統合） | dev-fix（Opus） | 5〜8 | U-1 確定、U-0 完了 |
| 8 | **O-2** | 容易度 A の機能を1件ずつオプション登録（量産） | **Sonnet** | 各 0.2 | O-1 |

理由: U-0 は小さく実害が大きい。O-1 は後続の新機能（T4/T5/T2）を**教室ごとに段階公開**する土台になるので先に置く。
T5・T4 は読み取り専用の独立機能で盤面状態を変えないため回帰リスクが低く、統一 undo（T1）と干渉しない。
T2 はオーナー側の準備（API キー・QA 公開範囲の判断）が要るので中盤。T1 の実装は最大・最難で
オーナー判断が多いため、仕様（U-1）だけ先行させて実装は最後にまとめる。

---

## 2. テーマ1: 戻るボタンの統一（完全に一つ前の状態へ）

### 2-1. 現状（調査結果の要点）

「戻る」は **3つの独立した機構が併存**し、連動していない（`src/components/schedule-board/ScheduleBoardScreen.tsx`）。

| 機構 | 実体 | 深さ | 契機 | 戻すもの |
|---|---|---|---|---|
| ① 盤面 undo/redo | `undoStack`/`redoStack`（`HistoryEntry` :69-87、`createHistoryEntry` :8314、`handleUndo` :11310、`handleRedo` :11353） | 10 段（`MAX_HISTORY_DEPTH` :735） | `commitWeeks` :8348 が呼ばれた時（37 経路） | weeks 全週・holiday/forceOpen・抑止キー・回数調整・振替/講習在庫・削除の希望数差分 |
| ② 一段スナップショット | `undoSnapshot`（`src/App.tsx:1478`、`saveUndoSnapshot` :2193、`restoreUndoSnapshot` :2213） | 1 段（黄バナー） | 破壊的一括操作 5 箇所（復元・テンプレ上書き・JSON復元・他教室読込・初期取込） | 教室データ丸ごと |
| ③ テンプレモード undo | `templateUndoStack`（:5089、`pushTemplateUndo` :5181） | 無制限・浅いクローン | テンプレ編集 | テンプレセル |

①が**戻さない**もの（＝オーナーが例示した2点を含む）:
- **黄色コマ `reopenedSlots`**（:8979 ほかで `commitWeeks` の後に別経路 `onApplyReopenedSlots`。確認文言 :435「元(不可)へ戻すことはできません」。`specialSessionModel.ts:10,30` で「戻す操作は設けない（ラチェット）」と仕様化。Firestore 提出文書にも書く `App.tsx:3574-3588`）。
- **希望数の正本 `studentInputs.subjectSlots`**（INV-07 でスナップショット復元禁止。削除1経路だけ差分 `specialSessionSubjectDelta` で逆適用＝v1.5.482。全コマ削除／丸ごと振替の振替先処分／休日化／テンプレ上書きは未対応）。
- 集団授業 `groupClassEntries`（`commitGroupClassEntry` :8098。`docs/spec-group-lesson.md:111` で「undo 非対応で確定」）。
- 別タブ日程表からの操作（出席不可トグル／講師コマ黄色化／登録・登録解除）は本体 `App.tsx:3715/3870/3896/3932` で処理され履歴に積まれない（D&D 移動だけは盤面経由で undo 可）。
- 基本データ／特別講習／自動割振ルールの編集・Excel 差分取込（`App.tsx:4939/5000/5024`）は capture が一切ない。
- 監査ログ `operationEvents`・台帳 `lessonLedgerDays`（設計上あえて巻き戻さない `operationLog.ts:8-12`）。

### 2-2. ★先に出す「障害・影響」（オーナー要請）

| # | 障害・影響 | 根拠 | 重さ |
|---|---|---|---|
| A | **現行バグの疑い（最優先）**: 保存後に「戻る」を押すと盤面が「保存済み（最新データ）」表示になり保存ボタンが効かず、**リロードで undo 前の状態が復活**する。`handleUndo` が版数 `committedBoardChangeVersionRef` を上げず `onBoardStateChange` も直接呼ばないため、publish effect（:5458-5486）が `userInitiated:false` で発火 → `App.tsx:2510-2513` が `markStateLoadedClean()` して clean 署名を undo 後の状態にする。undo 履歴は保存で消えない（`setUndoStack` は :8378/:11320/:11359 の3箇所のみ）ので「保存→戻る」は普通に起きる。 | `ScheduleBoardScreen.tsx:11310-11351`, `:5458-5486`, `App.tsx:2116-2120`, `:2509-2521` | 高（実害・要再現テスト） |
| B | **黄色コマは「戻せない」が確定仕様**。undo 対象にするには (a) 仕様撤回のオーナー合意 (b) Firestore 提出文書への逆書込（`updateSubmissionReopenedSlots` で削除後配列を送る） (c) ロックテスト `lectureSubmission.test.ts:183-201` の見直し (d) 途中で QR 再提出があり `unavailableSlots` が変わった場合の扱い、の4点が要る。 | `specialSessionModel.ts:10,30,115-123`, `App.tsx:3574-3588,3932` | 中（仕様変更） |
| C | **希望数は差分方式しか使えない（INV-07）**。希望数を動かす経路ごとに差分設計が必要: 全コマ削除 :8858／丸ごと振替 :8752／休日化 :8660／テンプレ上書き `App.tsx:4573`。QR提出・室長登録は「ユーザーの明示操作」なので undo 対象外が妥当（戻し手段は登録解除）。 | `docs/spec-invariants.md:305-319` INV-05 | 中 |
| D | **自動処理が履歴を消費し、undo が自動処理を再発火させうる**。QR反映の講師自動配置 :5567／起動時自己修復 :5601／登録解除要求 :5647／未提出戻りの除去 :5708 が `commitWeeks` を呼ぶ。undo で state が戻ると `prevSubmittedSessionStudentKeysRef` :5127 等の基準集合が不整合になり同じ変更を再適用する恐れ（INV-03 の領域）。 | `ScheduleBoardScreen.tsx:5567-5708,5127-5131,3452-3469` | 中〜高 |
| E | **画面遷移で履歴が全消滅**。`App.tsx:5373` の `key={boardMountKey}` で盤面が再マウントされる（基本データ画面へ行って戻るだけで undo 不能）。画面をまたいで保持するなら履歴を App へ持ち上げ、**教室切替時は必ず破棄**（v1.5.300 のクロス汚染ガード `App.tsx:2292-2294, 3116-3119` を履歴にも適用）。 | INV-08 | 中 |
| F | **メモリ**: 1 エントリ＝全週ディープクローン（上限 10 の由来 :735-737, `CHANGELOG` v1.5.4xx「週自動拡張×10 で増幅」）。対象を広げるなら差分方式か構造共有が前提。 | :8315 `cloneWeeks` | 中 |
| G | **②の一段 undo もサーバーへ書き戻さない**（`restoreUndoSnapshot` は `markStateLoadedClean()` で clean 化するだけ :2231）。A と同型で、復元→戻す→端末だけ戻りサーバーは復元後のまま、の乖離が起きうる。 | `App.tsx:2213-2234` | 中（要確認） |
| H | **監査ログとの整合**。undo は `recordOperationTrace('undo')`（端末内）だけで `recordOperationEvent` を呼ばない（:11313）。「削除した」記録がサーバーに残り続ける。ログは巻き戻さないのが正（設計意図）だが、undo を**補償イベント**として記録するかは判断が要る。 | `operationLog.ts:8-12` | 低〜中 |
| I | **undo が無い画面が多い**（基本データ／特別講習／自動割振ルール／Excel 取込）。「アプリ上のすべて」を文字通り満たすには3画面に新規の履歴機構が要り、削除ガード文言 `deleteGuard.ts:35`「削除したデータは元に戻せません」とも衝突。 | `App.tsx:4939,5000,5024` | 大（範囲判断） |
| J | **別タブ日程表・QR提出ページに「戻る」が無い**。日程表タブの破壊的操作（出席不可トグル・黄色化・登録解除）を戻すには、本体の履歴へ経路を通し、日程表タブに「戻る」ボタン（本体へ undo 要求の postMessage）を足す必要。 | `scheduleHtml.ts:4862-5037,5448,5511` | 中 |
| K | **同期タイミング**: 本番教室は日程表自動同期 OFF（:7202-7207）。undo しても別タブは「最新表示」を押すまで古い。 | — | 低 |
| L | **テンプレ undo は深さ無制限＋浅いクローン**（`memoSlots`/`statusSlots` 配列を履歴と共有）。①の規約へ寄せると「無制限に戻れる」が 10 段になる等の挙動差。 | :5181-5204 | 低 |

### 2-3. オーナー判断が要る点（→ §8-1 に回答欄）

推奨案を先に置く。回答が無ければ推奨で仮置きして進める。

1. **範囲**（推奨: 第1段＝盤面操作＋別タブ日程表からの操作。基本データ等は第2段で別途判断）。
2. **黄色コマを undo 対象にする**（＝ラチェット仕様の撤回、Firestore 逆書込あり）か（推奨: する。ただし「黄色化から undo までに QR 再提出があった場合は戻さない」を仕様化）。
3. **QR提出・室長登録は undo 対象外**（推奨: 対象外。登録解除が正規の戻し手段・INV-07）。
4. **自動処理は履歴に積まない**（推奨: 積まない。ユーザー操作だけが「一つ前」）。
5. **画面をまたいだ保持**（推奨: 盤面セッション内のみ。教室切替・ログアウトで破棄）。
6. **深さ**（推奨: 差分化後に 10→30 へ。②の一段バナーは「復元系だけの別 UI」として残す）。
7. **集団授業を履歴へ入れる**（推奨: 入れる。過去の「非対応で確定」を再オープン）。
8. **undo を監査ログに補償イベントとして残す**（推奨: 残す。kind `'undo'`・元イベント参照つき）。

### 2-4. 段階計画

| ID | 内容 | 担当 | テスト（同コミット必須） |
|---|---|---|---|
| **U-0** | 【バグ修正】`handleUndo`/`handleRedo` で版数 bump ＋ `onBoardStateChange(..., {userInitiated:true})` を `commitWeeks` :8405-8430 と同じ形で発行し、undo 後を dirty にして保存可能にする。②`restoreUndoSnapshot` :2213 も同様に「戻した結果を保存対象」にする（G）。**INV-02（手動編集の永続化）に分類**（undo の結果がリロードで巻き戻る＝自動処理で手動編集が消える構造）。 | dev-fix（Opus） | undo の適用を純関数 `applyHistoryEntry(state, entry)`＋publish payload 生成に切り出し、「保存→操作→undo→publish が userInitiated:true」を固定。`inv02-manual-edit-persistence.matrix.test.ts` に経路追加（台帳 `spec-invariants.md` INV-02 の同 push 改定が CI 条件）。修正なしで落ちることを確認。 |
| **U-1** | 仕様正本 `docs/spec-undo.md` 新設: (a) 対象操作表（§2-1 の 37 経路＋別タブ操作＋集団＋黄色化を「積む／積まない／対象外」で全件） (b) 対象状態表（何を戻すか） (c) サーバー副作用の扱い（提出文書・監査ログ・共有盤面） (d) UI（盤面の1ボタン＋日程表タブの「戻る」） (e) 深さ・破棄条件。**INV-13 候補「戻るの完全対称」**（1操作の undo は、その操作が変えた全対象状態を操作前と deep-equal に戻す）を台帳へ提案（強制・マトリクス義務・オーナー承認）。 | spec-curator（Opus） | — |
| **U-2** | `HistoryEntry` の**副作用差分の一般化**: `specialSessionSubjectDelta` を `sideEffects: SideEffectDelta[]`（`subjectSlots` / `reopenedSlots` / `groupClass` / `submissionLock`）へ拡張。`commitWeeks` の外で呼んでいる `onApplyReopenedSlots` と `commitGroupClassEntry` を commit に同梱。希望数を動かす残り経路（全コマ削除・丸ごと振替・休日化）へ delta 記録を追加。黄色コマの逆適用は Firestore 逆書込を伴う（B）。 | dev-fix（Opus） | 新設 `inv13-undo-symmetry.matrix.test.ts`: 対象操作 × 「操作→undo→deep-equal」「操作→undo→redo→操作直後と deep-equal」。`applySubjectSlotsDeltaToSessions` の既存3件を維持。`lectureSubmission.test.ts:183-201` は仕様改定に合わせて改訂（薄化ではなく置換）。 |
| **U-3** | 自動処理の非積載＋再発火防止: 4 経路（:5567/:5601/:5647/:5708）を `commitWeeks({ recordHistory:false })` に。undo 後に `prevSubmittedSessionStudentKeysRef` 等の基準集合を「undo 後の状態」で再初期化。 | dev-fix（Opus） | INV-03 マトリクス（未整備）を新設し「undo 直後に自動処理が同じ変更を再適用しない」を固定。 |
| **U-4** | 別タブ日程表の操作を履歴へ: 出席不可トグル／講師コマ黄色化／登録・登録解除の本体側ハンドラ（`App.tsx:3715-3945`）を履歴付き commit に通す。日程表タブに「戻る」ボタン（`schedule-undo-request` postMessage → 本体 `handleUndo` → `schedule-data-update` で反映）。 | dev-fix（Opus） | `scheduleHtml.test.ts` の new Function 構文検証を通す＋メッセージ往復のパーステスト（`developerReport.test.ts` の作法）。 |
| **U-5** | テンプレモード undo を同じ `HistoryEntry` 規約（深さ上限・ディープクローン）へ。 | dev-fix（Opus。判断済みなら Sonnet 可） | `appendHistoryEntry` の既存テスト流用。 |
| **U-6** | （§8-1 の 1 で「全画面」を選んだ場合のみ）基本データ／特別講習／ルール画面の履歴。 | 別計画 | — |

触るファイル: `ScheduleBoardScreen.tsx`（履歴型・commit・undo/redo・自動処理4経路）、`App.tsx`（②の同期・別タブハンドラ）、
`src/utils/scheduleHtml.ts`（戻るボタン＋postMessage）、`src/components/special-data/specialSessionModel.ts`（黄色の逆適用）、
`src/integrations/firebase/lectureSubmission.ts`（逆書込）、`docs/spec-undo.md`（新規）、`docs/spec-invariants.md`（INV-02 改定・INV-13 追加）。

---

## 3. テーマ2: 要望・報告に「質問」を追加（AI回答案 → 開発者承認 → 返答／類似QAの即時提示）

### 3-1. 現状（要点）

- 種別は `bug | request` の2種（`src/utils/developerReport.ts:22-23`、サーバー側 `functions/src/developerReport.ts:24-25`）。モーダルは本体 React（`DeveloperReportModal.tsx`）と別タブ日程表の埋め込み JS（`scheduleHtml.ts:7043-7180`、`postMessage('schedule-developer-report')` → `App.tsx:3658-3668`）の2箇所で**同じロジックを共用**。
- 送信 → Cloud Function `submitDeveloperReport`（`functions/src/index.ts:1721-1798`）→ Firestore `workspaces/{ws}/developerReports/{id}`＋Storage。メール即時通知 `notifyDeveloperReportByMail`（:1808-1844、nodemailer）。GitHub Issue は 15 分毎の `tools/developer-report-notify.mjs`（ラベルは種別で分岐 :22-28）。
- **アプリ→利用者への返信チャネルは存在しない**（`developerReports` は開発者のみ read、`firestore.rules:106-109`）。
- **LLM 連携はゼロ**（`package.json`/`functions/package.json` に SDK なし）。ヘルプ/FAQ の UI も無い。
- 流用できる「起動時にサーバーから通知を出す」仕組み: QR提出通知（サーバー既読 `notifiedAt`＋起動時ウォーターマーク＋全画面モーダル `App.tsx:178-254, 1521-1597, 4195-4226`）。

### 3-2. 設計方針（推奨）

- **種別 `question` を追加**し、送信経路は既存をそのまま使う（Issue ラベル `type:question`、メール件名に【質問】）。
- **AI回答案は Cloud Function 側で生成**（`onDocumentCreated` で `category === 'question'` のときだけ）。SDK は `@anthropic-ai/sdk`（Node 22・TypeScript）。モデルは既定 `claude-opus-5`（オーナーがコスト優先なら `claude-sonnet-5` を選べるよう env `REPORT_QA_MODEL` で切替）。adaptive thinking（既定）＋ `output_config.effort: 'medium'`。**API キーは既存の functions env 運用に相乗り**（ローカル `functions/.env`・CI は repo secret `PROD_FUNCTIONS_ENV`。キーはオーナーが取得して設定。Claude は値を見ない）。
- **回答の材料**: (a) 承認済み QA（Firestore `qaEntries`） (b) 利用者向けマニュアル `docs/user-manual.md`（新規・spec-curator が `docs/spec-*.md` から利用者語で起こす。functions のビルド時に `functions/src/generated/manual.ts` へ同梱） (c) 質問本文と `scheduleContext`（画面・期間）。マニュアルは system に置き `cache_control` で prompt caching（同一プレフィックス）。**教室データ・操作痕跡（生徒名）は AI に送らない**（公開 Issue と同じ方針）。
- **開発者承認 UI**: `DeveloperAdminScreen.tsx` に subPage `'questions'`（未回答→回答済みの一覧、AI案の編集 textarea、「承認して返答」「QAに公開」チェック）。確定は callable `answerDeveloperReport`（`requireDeveloperMember`）が `developerReports/{id}` に `answerFinal/answeredAt/answeredBy` を書き、公開時は `qaEntries/{id}` を作る。
- **利用者への返答通知**: 報告文書そのものは開けない（内部情報）ので、**軽量な別コレクション `reportAnswers/{id}`**（classroomId・質問要約・回答・answeredAt・readAt）を作り、教室メンバーが read できるルールを追加。本体起動時／実行中に購読し、QR提出通知と同じ全画面モーダルで「質問への回答が届きました」→「確認」で `readAt`（callable `markReportAnswerRead`）。
- **類似QAの即時提示**: モーダルの内容欄に入力中（500ms デバウンス・8文字以上）、callable `searchSimilarQa` を呼び `qaEntries` から上位3件を返して欄の下に「似た質問と回答」を表示。第1段は**サーバー側の字句一致（2-gram 重なり）**で LLM を使わない（件数が少ないうちは十分・無料）。第2段（任意）で Claude による再ランク。別タブ日程表のモーダルは opener 経由（`schedule-qa-search` postMessage）。
- **QA 公開範囲**: `qaEntries.visibility: 'all' | 'classroom'`。開発者が公開時に本文を編集（教室名・生徒名を除く）。

### 3-3. オーナー判断が要る点（→ §8-2）

1. モデル: `claude-opus-5`（推奨・品質）か `claude-sonnet-5`（コスト）か。目安は 1 質問あたり数円〜十数円（マニュアル 2 万トークンをキャッシュ読み＋回答 1 千トークン程度）。
2. QA の公開範囲の既定（推奨: 全教室共有・公開時に開発者が編集）。
3. AI案をメールにも載せるか（推奨: 載せる。開発者はメールで案を見て承認画面へ）。
4. 利用者側に「回答待ち一覧」画面を出すか（推奨: 第1段は通知モーダルのみ）。
5. 別タブ日程表のモーダルにも類似QA提示を第1段から入れるか（推奨: 第2段）。
6. Anthropic API キーの取得と `PROD_FUNCTIONS_ENV`／`functions/.env` への設定（オーナー作業）。

### 3-4. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **Q-1** | `docs/spec-developer-report.md` に §G「質問」を追記（送信・AI案・承認・返答通知・QA・公開範囲・非送信情報）。`docs/user-manual.md` の骨子作成。 | spec-curator（Opus） | — |
| **Q-2** | 種別 `question` の追加（client 型・server normalize・React モーダルのラジオ・埋め込みモーダル・notify スクリプトのラベル `type:question`・メール件名）。 | **Sonnet**（機械的。scheduleHtml は構文テストが門番） | 既存テスト 5 ファイルへ `question` ケース追加（`developerReport.test.ts` / `functions/src/developerReport.test.ts` / `scheduleHtml.test.ts:4430-4488` / `tools/developer-report-notify.test.mjs`）。 |
| **Q-3** | Cloud Function `draftDeveloperReportAnswer`（onDocumentCreated）: マニュアル同梱ビルド、Claude 呼び出し、`answerDraft/answerDraftModel/answerDraftAt/similarQaIds` の書込、失敗時 `answerDraftError`。`stop_reason` の確認・`refusal` は案なしで通知。 | dev-fix（Opus） | 呼び出し部を薄いアダプタに隔離し、プロンプト組立て（純関数）と応答パースをテスト。SDK はモック。 |
| **Q-4** | 開発者承認画面（subPage `'questions'`）＋ callable `answerDeveloperReport`＋`qaEntries` 作成。 | dev-fix（Opus） | 画面の状態遷移を純関数化して固定・CF 入力検証テスト。 |
| **Q-5** | 返答通知: `reportAnswers` コレクション＋ルール（教室メンバー read・write は CF のみ）＋起動時/実行中モーダル＋`markReportAnswerRead`。 | dev-fix（Opus） | `selectStartupSubmissionsToNotify` と同型の純関数テスト＋ `npm run test:rules`（教室分離）。 |
| **Q-6** | 類似QA提示（`searchSimilarQa` 字句一致・モーダル UI・別タブは opener 経由）。 | dev-fix（Opus）／UI 部は Sonnet | 類似度関数の純関数テスト（日本語 2-gram・しきい値）。 |

触るファイル: `src/utils/developerReport.ts`、`src/components/developer-report/DeveloperReportModal.tsx`、`src/utils/scheduleHtml.ts`、
`src/App.tsx`（通知・購読）、`src/components/developer-admin/DeveloperAdminScreen.tsx`、`functions/src/index.ts`、
`functions/src/developerReport.ts`、新規 `functions/src/reportAnswer.ts`／`functions/src/qaSearch.ts`、`functions/package.json`（SDK 追加）、
`firebase/firestore.rules`（`reportAnswers`・`qaEntries`）、`tools/developer-report-notify.mjs`、`.github/workflows/developer-reports.yml`。

---

## 4. テーマ3: 機能を教室ごとにオプション化（開示／非表示）

### 4-1. 回答: 「仕様変更せず、非表示にするだけで ON/OFF できる」機能の一覧

容易度 **A**＝入口を隠すだけで成立（既存データ・自動処理に影響なし）。**B**＝入口に加えて表示側／自動処理の停止が要る。**C**＝仕様変更が要る。

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
| 振替も同時に自動割当 | `:11621-11629` | チェック 1 個（既定 false で挙動同一） |
| 自動割振デバッグ結果パネル | `:11907-11940` | 開発用途 |
| PDF出力 | `BoardToolbar.tsx:277-279` | テーマ4と同居 |
| 講師日程（別タブ） | `BoardToolbar.tsx:274-276` | 生徒日程は基幹なので対象外 |
| 集団授業の盤面2行＋メニュー | `BoardGrid.tsx:505-506`、`:11976-12022` | A〜B。既存割当がある教室は日程表に残る |

**B（入口＋もう一手が要る）**: 外部生チェック（`isExternal` の表示側も切る）／休日設定（代替入口が要る）／自動割振ルール画面・ペア制約（既存ルールは効き続ける＝自動割振ボタンとセットなら A）／通常授業テンプレ作成（既存テンプレは効く。危険操作なので隠す価値は高い）／未消化チップ（在庫は裏で動く＝実質不可）／バックアップ・復元タブ（セクション単位なら A、初期設定が同居）／QR提出・講習提出（購読と起動時自己修復の停止が要る）／後から出席可能に変更（既存 `reopenedSlots` は効き続ける）。

**C（仕様変更が要る／切らない）**: 特別講習データ画面／集団出席者一覧（集団とセットなら可）／盤面ベース予定数 `boardBasedPlannedCount`（切替で過去月の数字が動く。教室別 ON/OFF にせず一方向の段階導入に留める）。

### 4-2. 開発者側のオプション管理手法（推奨＝案A）

既存の2つの仕組みをつなぐだけで、新しい概念を増やさない。

- **置き場**: `classrooms/{id}.featureOverrides: Partial<Record<FeatureRolloutKey, boolean>>`。
  `firestore.rules:58-61` で **read＝教室アクセス権／write＝開発者のみ**が既に整っており、ルール変更ゼロ。
  室長はログイン時に自教室 1 件を読むので配信コストもゼロ（`workspaceStore.ts:629-633`）。
- **判定**: `src/utils/featureRollout.ts:111-120` の `isFeatureEnabledForClassroom(key, classroom, overrides?)` に
  「override があれば scope より優先、無ければ現行 scope 判定」を追加。レジストリ（`:22-95`）の `description` を UI ラベルに流用。
- **UI**: `DeveloperAdminScreen.tsx:442` 直後（UID 差し替えグリッドの下）に教室カードごとのチェックボックス群。保存は既存の
  `onUpdateClassroom → App.tsx:2672 updateClassroom → :1708 queueRemoteWorkspaceClassroomUpdate → CF updateWorkspaceClassroom (functions/src/index.ts:1471)` に相乗り。
- **配線 7 箇所**: `appState.ts:147-158`／`workspaceStore.ts:21-30`・`:574-586`（読み戻し）／`adminFunctions.ts:90-99`／
  `functions/src/index.ts:1508-1516`（既知キーのみ許可）／`App.tsx:1708-1743`・`:2672-2724`／`featureRollout.ts`。
  ⚠️ **`studentUnitPrice` は同じ経路で配線漏れ（Firestore に到達せずリロードで消える）**。同じ穴を繰り返さないため「7 箇所すべて」をテストで固定。
- **必須の付随修正**: `ScheduleBoardScreen.tsx:4956-4970` は `{ name: classroomName }` しか渡していない（ID 不使用）。
  `classroomStorageKey`（＝教室ID、`App.tsx:5376`）と overrides を props で受けて `{ id, name }` で判定する。
- **名前ベース判定を持ち込まない**（`developmentClassroom.ts:28-29` の「開発用教室」名一致はリネーム事故に弱い）。オプションは教室ID固定。
- 案B（レジストリに `classroomIds` 許可リストを直書き）は「1教室で先行検証」の橋渡し用途のみ。オーナーが自分で切れないので本命にしない。

### 4-3. オーナー判断（→ §8-3）

1. 新しいフラグの既定は「全教室 ON（現状維持）で開発者が個別に OFF」でよいか（推奨: はい）。
2. OFF の教室で「この機能は無効です」と見せるか、単に消すか（推奨: 消す）。
3. B 群のうち欲しいもの（外部生／テンプレ作成／QR提出／黄色コマ…）。それぞれ「もう一手」の設計を個別に起こす。
4. 反映タイミングは室長側のリロード／再ログイン後でよいか（推奨: はい。即時反映は購読が要る）。

### 4-4. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **O-1** | 基盤（4-2 の配線 7 箇所＋判定の上書き層＋開発者画面 UI＋ID 判定への是正） | dev-fix（Opus） | `featureRollout.test.ts`（override 優先・未指定は scope）／CF 入力検証／`queueRemoteWorkspaceClassroomUpdate` の送信フィールド固定（純関数化）／`npm run test:rules`（室長は `classrooms` を書けない・既存 :88-91 維持） |
| **O-2** | A 群を1件ずつレジストリ登録（キー追加＋入口ゲート＋テスト1件）。優先: 要望・報告／講師日程共有／空フォーマット印刷／講習集計結果／丸ごと振替／並べ替え／自動割振／PDF出力／集団2行。 | **Sonnet**（`model: sonnet`、1件＝1コミット） | 各機能「OFF で入口が出ない・ON で従来どおり」の経路テスト |
| **O-3** | B 群は個別に spec-curator → dev-fix | Opus | — |

---

## 5. テーマ4: 盤面PDF印刷（曜日×コマのグリッド選択 → 選択コマだけを A4 に最大化）

### 5-1. 現状（要点）

- 入口は `BoardToolbar.tsx:277-279`「PDF出力」→ `handlePrintPdf`（`ScheduleBoardScreen.tsx:10380-10399`）→ `exportBoardPdf`（`src/utils/pdf.ts:237-479`）。**オプション画面は無く即出力**。
- 方式: 表示中の週の DOM をクローン → sticky 解除・列幅固定 px（`applyBoardPdfColumnWidths` :215-235）→ `html2canvas(scale 1.1)` → `jsPDF` **A3 縦固定**、1 週間を必ず 1 ページ（`docs/board-pdf-design.md`、`docs/spec-schedule-pdf.md` §I）。
- フィットは `renderScale = Math.min(contentW/canvasW, contentH/canvasH)`（:470-476）＝アスペクト比維持の最大化。生徒文字は縮小方向のみ（`fitStudentTextForPdf` :202-213、最大 34px）。
- 「曜日×時限」の行列は `BoardGrid.tsx:428-450`（`days` / `slotNumbers`）が既に作っている。時限は `slotTimes.ts:3-9`（1〜5限固定）。定休日は `SlotCell.isOpenDay`。
- **テストは無い**（`pdf.test.ts` 不在、印刷ボタンの経路テストも無し）。

### 5-2. 設計方針（推奨）

- **選択 UI**: 「PDF出力」→ モーダル。行＝時限・列＝曜日（表示週の営業日）のチェックボックス表。行頭／列頭で一括トグル。
  任意セル選択を許す（矩形に限定しない）。空選択は無効。既存の「1 週間まるごと A3」もモーダル内の別ボタンとして**残す**（運用習慣の維持・§8-4 で確認）。
- **描画**: 表示ルールの二重管理を避けるため**既存 BoardGrid の DOM をクローンして間引く**（案(a)）。
  `BoardGrid` のセルに `data-date-key` / `data-slot-number` を付け、クローン側で (1) 選択に含まれない曜日の列グループ（4 サブ列）を `<col>`/`<td>` ごと除去 (2) 選択に含まれない時限の行を除去 (3) 矩形内で未選択のセルは空白化。
- **用紙**: 間引き後の表の縦横比で **A4 縦／横を自動選択**（横長なら landscape）。`renderScale` は既存のまま拡大も効く。
  `html2canvas` の `scale` を選択数に応じて上げる（少数コマほど高解像度、上限 3）。文字は縮小ロジックを維持しつつ、上限 34px を「セル高に応じた拡大」へ緩める。
- 選択が多い（例: 15 コマ超）ときはモーダルで「A4 では小さくなります」を警告（分割印刷は第2段・§8-4 で確認）。

### 5-3. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **P-1** | 純関数の設計と実装: `buildBoardPrintGrid(cells)`（曜日×時限の行列）／`resolveBoardPrintSelection(grid, checked)`（含める曜日・時限・空白セル）／`resolveBoardPrintPaper(cols, rows, cellAspect)`（A4 縦横）／`resolveBoardPrintCanvasScale(cellCount)`。`BoardGrid` へ data 属性追加。 | dev-fix（Opus） | 各純関数のユニット（定休日除外・空選択・1 コマ・全選択・縦横判定）。data 属性は `BoardGrid` 描画テストで固定。 |
| **P-2** | `pdf.ts` に `exportBoardPdfSelection(element, selection, paper)` を追加（既存 `exportBoardPdf` は無改変で残す）。クローンの間引き処理は jsdom で合成テーブルを作って検証。 | dev-fix（Opus） | 間引き後の列数・行数・空白セルの位置を固定。 |
| **P-3** | 選択モーダル UI（`BoardPrintSelectionModal.tsx`）＋ツールバー配線＋`docs/board-pdf-design.md`・`spec-schedule-pdf.md §I` の追記。 | **Sonnet**（設計済み UI の実装・docs） | モーダルの状態遷移（トグル・一括・無効化）を純関数化してテスト。staging で実機 PDF を目視。 |

### 5-4. オーナー判断（→ §8-4）

1. 任意セル選択（推奨）か、曜日集合×時限集合の矩形のみか。
2. 既存の「1 週間 A3」を残す（推奨）か置き換えるか。
3. 選択が多いときの扱い: 常に A4 1 枚に収める（推奨・第1段）／A4 複数ページに分割／A3 へ自動切替。
4. 印刷対象に**振替・講習ストックのパネルは含めない**（現状踏襲）でよいか。

---

## 6. テーマ5: 講習履歴（生徒の休み・振替・出席の詳細一覧、期間指定・最大1年）

### 6-1. 現状（要点）

- 「講習集計結果」は `scheduleHtml.ts:2782` のボタン（ツールバー `toolbar-actions` 内、左が「空フォーマット印刷」:2781）。クリックで `buildLectureSummaryHtml`（:6736-6812）が**別タブに自己完結 HTML**を開く。本体との通信なし。「開いている生徒」は `#schedule-person-select` の `appliedPersonId`（本体側は `studentScheduleRange.personId`、`ScheduleBoardScreen.tsx:5820-5849` で受信）。
- 履歴データの正本は **`lessonLedgerDays`**（`classroomSnapshots/{id}/lessonLedgerDays/{YYYY-MM-DD}`、保存のたび生成・**直近 400 日分のトークンを 1 文書に保持**・保持 2 年）。まさに「1年分を振り返れる」目的で 2026-09-04 に新設された機構（`src/utils/studentLessonLedger.ts:1-13`）。
  トークン `YYYY-MM-DD#限|授業種別|振替元日` で `attended / absent / absentNoMakeup / placed / makeupRemaining` を生徒×科目ごとに持つ（講師名は持たない）。
- **クライアントからは読めない**（`firestore.rules` に `lessonLedgerDays` の match が無い）。`tools/lesson-ledger-report.mjs` は gcloud トークンの REST 直読み（ルールを通らない）。
- 盤面 `weeks` だけでは不十分: 過去週はメモリ節約でトリムされ（`boardWeekTrim.ts:56-57`、手動データのある週は保持）、`ensureWeeksCoverDateRange` は**テンプレから空週を再合成**するだけで記録は復元しない。

### 6-2. 設計方針（推奨）

- **データ**: 新規 callable `getStudentLessonHistory({ classroomId, studentId, from, to })`。`requireClassroomAccessMember` で権限確認 → `to` 以前で最新の `lessonLedgerDays` を Admin SDK で取得・解凍 → 対象生徒の行だけトークンをパースして日付順イベント配列で返す（種別: 出席／休み（振替あり・振替先）／振無休／未出欠の配置／未消化の元コマ）。当日の未保存編集は含まれない旨を画面に明記。ロード済み週の範囲では盤面 `weeks` から**講師名を補完**（任意・第2段）。
- **表示**: 「講習集計結果」の左に**「講習履歴」ボタン**（`scheduleHtml.ts:2782` 直前）。クリック → opener へ `schedule-lesson-history-request {studentId, from, to}` → 本体が callable を呼び → 結果を `schedule-lesson-history-result` で返す → 日程表タブ内の**自己完結オーバーレイ**（要望・報告モーダルと同じ往復パターン `:7043-7180`）に表として表示。期間は開始／終了 `input[type=date]`（既定＝終了日から 1 年前・366 日超は丸める）。種別フィルタ（通常／振替／講習）と印刷ボタン。
  代替案＝本体の React モーダル（Firebase 直アクセス・テスト容易だがタブ切替が要る）。埋め込み UI が大きくなりすぎる場合はこちらへ切替。
- 名称: ボタンは「講習履歴」でも、内容は**全授業種別**（通常／振替／講習）を出し、種別で絞る（§8-5 で確認）。

### 6-3. 段階計画

| ID | 内容 | 担当 | テスト |
|---|---|---|---|
| **H-1** | トークンのパーサ `parseLessonLedgerTokens(row) → LessonHistoryEvent[]` と期間フィルタ／並べ替えを `src/utils/studentLessonLedger.ts` に追加（`tools/lesson-ledger-report.mjs` の表示ロジックを純関数へ移す）。 | dev-fix（Opus） | 実トークン形（`日付#限|種別|振替元日`・限なし・付帯なし）の往復テスト。 |
| **H-2** | callable `getStudentLessonHistory`（`functions/src/lessonLedgerHistory.ts`）: 権限・日付選択・解凍・生徒フィルタ・上限 366 日。 | dev-fix（Opus） | 純関数部（文書選択・フィルタ）のテスト。権限は既存 `requireClassroomAccessMember` の再利用。 |
| **H-3** | 本体側: `schedule-lesson-history-request` の受信（`ScheduleBoardScreen.tsx:5820` 台の作法）→ callable → 結果返信。 | dev-fix（Opus） | メッセージのパース・結果整形の純関数テスト。 |
| **H-4** | 日程表タブのボタン＋オーバーレイ（期間・フィルタ・表・印刷）。 | **Sonnet**（UI）＋Opus レビュー | `scheduleHtml.test.ts` の new Function 構文検証を必ず通す＋ボタン露出・メッセージ種別の固定（:3635-3697 の作法）。 |

### 6-4. オーナー判断（→ §8-5）

1. 対象は講習のみか、**全授業種別**（推奨）か。
2. 表示場所: 日程表タブ内オーバーレイ（推奨）か本体モーダルか。
3. 「保存済みの記録のみ（当日の未保存分は含まない）」でよいか（推奨: はい）。
4. 講師名の補完（第2段）まで要るか。

---

## 7. 横断事項

- **INV**: U-0 は INV-02、U-3 は INV-03、T1 全体で INV-13 候補を新設（spec-curator 経由・オーナー承認）。T2/T3/T4/T5 は盤面状態を変えないため既存 INV の対象外だが、T3 は INV-08（教室分離：他教室の overrides を読まない）を `test:rules` で確認。
- **回帰防止**: `lectureSubmission.test.ts:183-201`（黄色ラチェット）は U-2 で「薄化」せず**仕様改定に合わせて置換**し、`spec-invariants.md` の改定を同 push に含める（`inv-guard`）。`scheduleHtml.ts` を触る段はすべて new Function 構文検証が門番。
- **functions デプロイ**: T2（Q-3/Q-4/Q-5/Q-6）・T5（H-2）は Actions「Deploy Cloud Functions」で反映し、ライブ GET で実反映を検証（409 誤成功に注意）。
- **rules デプロイ**: T2（`reportAnswers`・`qaEntries`）のみ。`firebase deploy --only firestore:rules`。
- **秘密情報**: Anthropic API キーは `functions/.env`（ローカル）と repo secret `PROD_FUNCTIONS_ENV`（CI）。Claude は値を扱わない・ログに出さない。
- **staging**: T4/T5/T2 は staging で実機確認（PDF の見た目・オーバーレイ・通知モーダル）。開始前に「Deploy to Staging」で版を揃える。
- **メモリ**: 計画の所在は memory `komahyou-plan-2026-09-11-five-requests` に記録済み。

---

## 8. オーナー確認事項（回答欄）

回答が無い項目は「推奨」で仮置きし、着手時に AskUserQuestion で再確認する。

### 8-1. 戻るボタン
- [ ] 範囲（推奨: 第1段＝盤面＋日程表タブ操作）: ______
- [ ] 黄色コマを undo 対象にする（推奨: する・再提出後は戻さない）: ______
- [ ] QR提出・室長登録は対象外（推奨: 対象外）: ______
- [ ] 自動処理は履歴に積まない（推奨: 積まない）: ______
- [ ] 画面をまたいだ保持（推奨: 盤面セッション内のみ）: ______
- [ ] 深さ（推奨: 差分化後 30）: ______
- [ ] 集団授業を履歴へ（推奨: 入れる）: ______
- [ ] undo を監査ログの補償イベントに（推奨: 残す）: ______
- [ ] **U-0 のバグ修正を計画に先行して即着手してよいか**（推奨: よい。回帰テスト同梱で main へ）: ______

### 8-2. 質問種別＋AI回答案
- [ ] モデル（推奨: `claude-opus-5`）: ______
- [ ] QA 公開範囲の既定（推奨: 全教室共有・公開時に編集）: ______
- [ ] AI案をメールにも載せる（推奨: 載せる）: ______
- [ ] 回答待ち一覧画面（推奨: 第1段は通知のみ）: ______
- [ ] 日程表タブでも類似QA提示（推奨: 第2段）: ______
- [ ] API キー取得と env 設定（オーナー作業）: ______

### 8-3. 教室別オプション
- [ ] 既定＝全教室 ON・開発者が個別 OFF（推奨: はい）: ______
- [ ] OFF 時は消す（推奨）／「無効」と見せる: ______
- [ ] B 群で欲しいもの: ______
- [ ] 反映はリロード後（推奨: はい）: ______

### 8-4. 盤面PDF印刷
- [ ] 任意セル選択（推奨）／矩形のみ: ______
- [ ] 1 週間 A3 を残す（推奨）: ______
- [ ] 多数選択時（推奨: A4 1 枚固定＋警告）: ______
- [ ] ストックパネルは含めない（現状踏襲）: ______

### 8-5. 講習履歴
- [ ] 全授業種別（推奨）／講習のみ: ______
- [ ] 日程表タブ内オーバーレイ（推奨）／本体モーダル: ______
- [ ] 保存済み記録のみ（推奨）: ______
- [ ] 講師名補完は第2段（推奨）: ______
