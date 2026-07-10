# 改修作業手順書：対話用日程表 同期 ＋ 日程表コマ組み

> ## 🔴 2026-07-08 最終方針転換（これを最優先で読む・以降の「React化」記述は棚上げ）
>
> **「React 化」方式は棚上げした。** 別ブラウザウィンドウへの React portal では pointer 操作
> （D&D の drop）が確実に届かず移動が成立しない・従来タブと操作感が変わる、という理由で、
> オーナー確定により **「既存の別タブ（生成HTML日程表）の中に同期＋コマ組みを実装する」方式へ回帰**した。
> 現状（作業ブランチ `feature/schedule-react-view`・staging デプロイ済み・main マージ禁止）：
>
> - **React ビューは棚上げ（コード温存）**：`ScheduleBoardScreen.tsx` の `scheduleReactViewEnabled = false`。
>   日程表ボタンは従来の生成HTML別タブ（`openStudentScheduleHtml`/`openTeacherScheduleHtml`）を開く。
>   `src/components/schedule-view/*`・featureRollout `scheduleInteractiveReactView`・`scheduleViewData.ts` は削除せず温存。
> - **実装済み・staging 反映済み**：
>   - Phase A：React ビュー無効化＝別タブ主経路化（コミット 61868ce）。
>   - Phase B：**別タブ日程表への自動同期（デバウンス約1.5秒）**。`ScheduleBoardScreen.tsx` のデバウンス
>     effect が `scheduleSyncTrigger` を bump→既存 `sync*ScheduleHtml` が送信。受信側 `buildPayloadFingerprint`
>     で等価再描画スキップ＋表示範囲限定で 2026-06-05 メモリ障害を防ぐ。オーナー「感触だいたいOK」。
>   - 同期スピナー（4a89e38）：反映までの数秒、別タブ最前面に「コマ表の最新を反映中…」。本体が編集時に
>     埋め込みJS `window.__showScheduleSyncing()` を即時呼び、`flushIncomingPayload` で自動消去。
> - **残作業＝Phase C：別タブ（生成HTML 埋め込みJS）のコマ組みD&D**（未着手・オーナー最重要要望）：
>   1. 生徒日程表の授業カード長押しD&D→空きコマへドロップ→**机選択モーダル（ポップアップ内）**→席確定。
>   2. ⚠️設計課題：机選択には移動先コマの**全机レイアウト**が要るが `serializeCells` は空席の机を落とす。
>      →対話用の生徒ペイロードにだけ全机レイアウトを載せる（`serializeCells` に flag・印刷は不変）方針、
>      または drop 時 postMessage 往復で机情報取得（旧設計）。
>   3. `schedule-student-move-request` を opener(本体)へ postMessage→App.tsx の `StudentScheduleRequest`
>      （`src/App.tsx:149`・現状 `mode:'unassign'` のみ）を `mode:'move'` 拡張で受ける→盤面が
>      **既存の `executeScheduleViewMove`（React 作業で実装済み・`scheduleViewMove.ts` の純関数群を利用）**で実行
>      （通常＝振替manual追加+抑制の両方／講習＝科目維持／週自動拡張）→自動同期で別タブ更新。
>   4. 一過性リクエスト規律（memory `komahyou-transient-request-remount-refire`・Issue#46）踏襲。埋め込みJSの
>      エスケープ罠（memory `komahyou-schedulehtml-embedded-script`・`new Function` 構文検証テストあり）に注意。
>      **テストは同コミット必須**。
> - memory `komahyou-popup-sync-and-dnd-plan` に要約あり。以下の「React 化」記述（§0〜）は歴史的記録として残す。

> 次セッションの実装担当（AIモデル問わず）向けの自己完結手順書。2026-07-08 作成・同日3回改訂。
> 仕様の正本（**この順に読む**）：
> 1. `docs/spec-schedule-interactive-view.md`（**土台**：対話用日程表の React 化＋ドック/ポップアウト）
> 2. `docs/spec-schedule-popup-realtime-sync.md`（機能1：リアルタイム同期。§0 で大部分が土台に吸収）
> 3. `docs/spec-student-schedule-dnd.md`（機能2＝**日程表コマ組み**。§0 で実装が簡素化）
>
> **本書と正本3つを読んでから着手すること**。行番号は 2026-07-08（v1.5.406）時点の目安。
> ズレていたらシンボル名で検索する。
>
> ⚠️ **方式転換（2026-07-08 オーナー確定・最重要）**：staging では**対話用の生成HTMLタブを
> React ビューへ置き換える**（印刷／PDFの生成HTMLは残す）。日程表ビューが本体と同一 React
> ツリーになるため、リアルタイム同期は「同じ state なので自動反映」に、日程表コマ組みは
> 「実盤面の `executeMoveStudent` を直接呼ぶ」に単純化される。**旧設計（postMessage・
> デバウンス送信・埋め込みJS・一過性リクエスト）はこの土台の上では不要**。本書の §2〜§3 は
> React 土台版に書き換え済み。旧設計版は各 spec の §0 以降に歴史的記録として残す。
>
> ⚠️ **リリース方針**：3つとも staging だけに実装しオーナーチェックを待つ。合格まで
> main（＝本番）へマージしない（§4）。日程表コマ組みでは**自動割振ルール・警告は一切無関係**。

## 0. 着手前チェック（毎回必須）

1. `CLAUDE.md` と `.claude/skills/solo-git-workflow/SKILL.md` に従う：
   `git fetch origin && git status -sb` でローカル main が origin/main に追随、
   `node -p "require('./package.json').version"` と
   `https://komahyouapp-prod.web.app/version.json` の一致を確認してから編集開始。
2. **本番データ保護**：Firestore への書き込み検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。
3. 機能実装なので**必ずブランチを切る**。**土台（React化）→機能1→機能2の順**で、
   土台のブランチ（例 `feature/schedule-react-view`）を先に仕上げ、その上に機能を積む。
   土台が大きいので、土台だけ先に staging でオーナーに見せて方向性を確認してもよい。
4. 編集ごとに `CHANGELOG.md` の `## 未リリース` へ1行追記。`package.json` の version は触らない。
5. **変更には必ずユニットテストを同コミットで添える**（テストゲート・オーナー厳命）。

## 1. 関連コードの地図（実装調査済み・2026-07-08）

| 場所 | 内容 |
|------|------|
| `src/utils/scheduleHtml.ts` | 日程表HTML生成（約5900行）。**React 化後は印刷／PDF用途のみ残す**（対話には使わない・削除しない）。表示算出ロジックの再利用元＝ `serializeCells`(≈267) が `desks`（講師名・statusSlots・lesson）まで持つ／`build*Payload`(≈691〜) ／生徒カード描画 `renderStudentCellCard`(≈3062) ／セル索引 `buildCellMap`(≈2788)。これらの**表示算出を純関数として切り出し**、React ビューと印刷HTMLで共有する。埋め込みJS・postMessage(≈5801)・`buildPayloadFingerprint`(≈2376) は対話では登場しなくなる。 |
| `src/App.tsx` | `syncStudentSchedulePopup` / `syncTeacherSchedulePopup`(≈3268-3345・`if (!force) return` ゲート)、`handleScheduleRangeMessage`(≈3360)、`StudentScheduleRequest`(≈149) は**旧・生成HTMLタブ用の配線**。React ビュー移行後は対話では不要になるが、**印刷が独立と確認できるまで剥がさない**（§F 移行ガード）。日程表ビューの起動（ドック/ポップアウト）配線をここか盤面に足す。 |
| `src/components/schedule-board/ScheduleBoardScreen.tsx` | 盤面本体（8000行超）。**再利用の要**：移動の純関数 `computeStudentMove`(≈3358・export済・テストあり)、実移動 `executeMoveStudent(cellId, deskIndex, studentIndex, …)`(≈7617)。盤面 state（`boardState` / `weeks` / `suppressed*`）と `ensureWeeksCoverDateRange`。React 日程表ビューはこの state を参照し、この移動関数を直接呼ぶ。 |
| `src/share-main.tsx` | **2つ目の React エントリ（講師日程共有）**。別コンテキストで React を描く前例。ポップアウト（子ウィンドウへの portal）実装の参考。 |
| `src/main.tsx` / `src/index.css` / `src/App.css` | 素の CSS（CSS-in-JS 不使用）。子ウィンドウへの `<style>` 複製で見た目を移送できる根拠。 |
| `src/utils/featureRollout.ts` | `featureRolloutRegistry` にキー追加。**staging 環境判定ヘルパーを新設**（`projectId==='komahyouapp-staging'` で有効）。前例キー `studentDragAndDropMove`。 |
| `src/utils/memoryDiagnostics.ts` | `?memlog=1` で 5秒ごとに heap と `bumpMemCounter` の delta を出力。React ビューのメモリ規律（§E）実測に使う。 |

### 必読 memory / 過去修正（巻き戻し厳禁）

- commit `bff131c`・`b51c49d`（2026-06-05）：旧同期のメモリ障害の真因（**毎編集で全量再生成・二重同期**）。React 化後も §E のメモ化規律で同種再発を防ぐ。**印刷が依存する force ゲート等を早まって削らない**。
- Issue #46（v1.5.406）：一過性リクエストの再マウント再発火。React 化で move の一過性リクエスト自体が不要になるが、**paradigm（ワンショットを永続 state に残さない）は踏襲**。
- v1.5.364：講習移動の選択科目（rawKey）尊重。v1.5.388：`resolveRegularTeacherIds` の移動生徒除外ガード。
- 7/20振替消失事故：通常→振替化は「振替 manual 追加＋振替元抑制」の**両方必須**。
- `mergeManagedDeskLesson` の生徒同一性補完（spread 単純化で消さない）。
- 表示ロジックは純関数化して React／印刷で共有（二重定義でズレさせない）。

## 2. Phase 0：対話用日程表の React 化（土台・`spec-schedule-interactive-view.md`）

**先にこれを仕上げる。** 機能1・2 はこの上でほぼ自明になる。

1. **staging 環境判定ヘルパー**（`featureRollout.ts`）：`isStagingEnvironment()`＝
   firebaseConfig の `projectId === 'komahyouapp-staging'`。対話 React ビューは当面これで有効化
   （本番は従来の生成HTMLタブのまま）。本番展開形はオーナーチェック後に決める。
2. **表示算出の純関数化**：`scheduleHtml.ts` の `build*Payload` / `serializeCells` /
   カード表示ロジックから、**盤面 state → 日程表表示データ**の算出を純関数として切り出す
   （`src/utils/scheduleView*.ts` 等）。React ビューと印刷HTMLの双方から呼ぶ。既存テストが
   緑のままであることを確認（表示のズレ＝二重定義を作らない）。
3. **`ScheduleView` React コンポーネント新設**：切り出した純関数で盤面 state から表示を描く。
   生徒／講師行は **`React.memo`＋安定 id key** で分割（spec-interactive-view §E のメモリ規律）。
   既存の生成HTMLと**見た目・期間絞り込み・QR・不可時間編集などの機能等価**を目標にする
   （まずは表示と絞り込み。編集系は段階的に）。
4. **ドック表示**：本体レイアウト内のパネル/ドロワーに `ScheduleView` を描く。
5. **ポップアウト表示（React portal → 子ウィンドウ）**：
   - `window.open('', name)` → 子ウィンドウの `document.head` へ親の `<style>`/`<link>` を複製
     （動的分は MutationObserver で追随）。
   - `createPortal(<ScheduleView/>, childWindow.document.body)` で描画（同一 React ツリー）。
   - 子の open/closed を state 管理、`closed`/`beforeunload` で portal 破棄、フォーカス管理、
     親リロード時の孤児化処理。参考＝ `share-main.tsx`。
   - 「別ウィンドウで開く ⇄ 画面内に戻す」トグルUI（どのコンテナへ portal するかの差）。
6. **回帰確認**：`npm run build`＋全ユニット green。**印刷／PDF（全員表示・空フォーマット）が
   従来どおり動く**ことを必ず確認（生成HTML経路を壊していない）。regression-reviewer に
   「印刷経路・force ゲート等を早まって削っていないか」を検査させる。

## 3. Phase 1：リアルタイム同期（機能1・土台の上ではほぼ自明）

React 化により、`ScheduleView` は盤面 state を直接参照するので**盤面編集で自動再レンダー＝
自動反映**。実装作業は「自動反映の確認」と「メモリ規律の担保」が中心。

1. **自動反映の確認**：ドック・ポップアウトのどちらでも、盤面の出席編集・配置変更・Undo が
   追加操作なしで即反映されること。specialSessions（QR提出）変更も反映されること。
2. **メモリ規律**（spec-interactive-view §E・最重要）：`ScheduleView` を盤面編集ごとに
   巨大サブツリー全再レンダーしない。行メモ化・`useMemo`（安定 deps）・必要なら仮想化。
   `bumpMemCounter('schedule-view-render')` 等を仕込み、`?memlog=1` で編集連打時の
   再レンダー回数・heap を実測（手順は §7-2）。
3. **「最新表示」ボタンの扱い**：React ビューでは自動反映なので、期間・絞り込み適用のUIは
   残しつつ「最新表示」の語は不要（適用ボタンとして残すか、絞り込みは即時適用にするか実装時判断）。
4. **旧同期機構は触らない**：`App.tsx` の force ゲート等は印刷が独立と確認できるまで残置（§F）。
5. **テスト**：`ScheduleView` の表示が盤面 state から正しく算出されること（純関数テスト）、
   同一 state 変化で行が再レンダーされること、変化のない行が再レンダーされないこと（メモ化）。

## 4. Phase 2：日程表コマ組み（機能2・React DnD＋executeMoveStudent 直呼び）

**設計方針**：`ScheduleView` 内で React DnD を行い、席確定で**盤面の `executeMoveStudent` を
直接呼ぶ**（同一ツリー・メッセージ不要）。

1. **feature ゲート**：日程表コマ組みは staging 環境判定（＋必要なら専用フラグ）で有効化。
2. **カードの長押しD&D**（`ScheduleView` 内・React DnD／Pointer Events でマウス・タッチ両対応）：
   - 授業カード（`通)`/`振)`/`講)`）に entryId / studentId / dateKey / slotNumber /
     lessonType / subject を持たせる。集団授業カードは対象外（掴めない）。
   - 長押し約250ms→ドラッグ（盤面D&D `studentDragAndDropMove` のUX踏襲）。
     ドロップ可能セル（開校日・当該生徒の空きセル）をハイライト。休校日・期間外は不可。
3. **机選択モーダル（React）**：ドロップで対象コマ（dateKey×slotNumber）の机テーブルを
   盤面 state から描画（講師名・着席生徒・空席・コマ表と同じ見た目）。空席のみ選択可、
   キャンセル可。**自動割振ルール・警告は評価も表示もしない**（spec §B-4）。
4. **移動実行**：席確定で `executeMoveStudent(cellId, deskIndex, studentIndex, …)` を直接呼ぶ。
   - source は entryId＋studentId＋dateKey＋slotNumber で盤面エントリを特定する**純関数**で解決
     （同一生徒2科目同コマの取り違え防止・見つからなければ不成立）。
   - target が読込週範囲外なら `ensureWeeksCoverDateRange` で拡張してから。
   - **振替・講習**：既存移動と同じ（講習は rawKey 科目維持・v1.5.364 を壊さない）。
   - **通常授業**：その回だけの振替＝「振替 manual 追加＋移動元当該日の抑制」の**両方**
     （7/20事故の教訓・テストで固定）。
   - 不成立（満席・範囲外・source消失）なら盤面不変で理由表示。成立なら同一 state 経由で
     `ScheduleView` は自動更新（同期不要）。
5. **テスト（同コミット必須）**：
   - source 解決純関数（見つかる/見つからない/同名別人・同一生徒2科目）。
   - target 検証（満席/休校日/範囲外→不成立、空席→成立）。
   - 通常移動＝追加＋抑制の両立（`computeStudentMove` 系既存テストに追加）。
   - 講習移動の rawKey 科目維持。
   - 週範囲外→拡張して成立。Undo で1操作として戻る。

## 5. Phase 3：検証・リリース（staging 先行・2026-07-08 オーナー確定フロー）

**チェック合格まで main（＝本番）へマージしない。** 実装は feature ブランチ上で完結させる。

1. **staging のテストデータ準備**：日大前の現状データ（出席込み）を
   `node tools/copy-prod-classroom-to-staging.mjs`（`--promote-staging-member` で staging
   ログインから教室を選択可能にする）でコピーする。再実行すれば最新を取り直せる。
   ⚠️ Claude の自動実行は Firestore 書き込み系の権限ルールでブロックされるため、
   **オーナーがターミナルで実行**（gcloud 認証済みPC・数分で完了）。
2. **staging での有効化**：staging 環境判定（`isStagingEnvironment()`）で React 対話ビュー・
   両機能を有効化。本番は生成HTMLタブのまま（影響ゼロ）。
3. **ユニットゲート**：`npm run lint` / ユニット全件 / `npm run build` green を feature
   ブランチで確認（CI はブランチ push でも走る）。**regression-reviewer** に diff を
   検査させる（特に §1 の「巻き戻し厳禁」・印刷経路の温存）。
4. **staging デプロイ**：GitHub → Actions → **「Deploy to Staging」→ Run workflow →
   feature ブランチを選択**（functions 変更が無ければ deploy_functions は不要）。
   `https://komahyouapp-staging.web.app` で §7 の検証シナリオを実施
   （メモリ実測必須・日程表コマ組みは日大前実データで一通り操作）。
5. **オーナーチェック待ち**：staging URL・確認観点（受け入れ条件の要約・ドック/ポップアウトの
   両方を試してもらう）・既知の制限をオーナーへ報告し、**合格の明示をもらうまで次へ進まない**。
   指摘があれば feature ブランチ上で修正 → staging 再デプロイを繰り返す。
6. **本番リリース（オーナー合格後）**：本番への展開形（ドック/ポップアウトどちらを既定にするか・
   生成HTMLタブを対話でも残すか置換するか）をオーナーと確定 → safe-release スキルに従い
   main マージ → 本番デプロイ → 各端末ハードリロード周知。
7. 障害時ロールバック：Hosting 巻き戻し（`docs/runbooks/rollback.md` A）または
   環境判定/フラグを戻す1行コミット。staging 段階では本番影響ゼロなので気軽に壊してよい。

## 6. テスト計画（何を・どこに・どう固定するか）

方針は `docs/test-strategy.md`（E2E廃止・ユニットが唯一の自動ゲート）。
**ロジックは必ず純関数に切り出してからテストする**。以下は最低ライン（実装中に増やすのは可）。

### Phase 0（React 土台）

| テスト対象（純関数化して export） | 固定する挙動 | 置き場所 |
|---|---|---|
| 表示算出純関数（盤面 state → 日程表表示データ） | 既存の生成HTML表示と等価（同入力→同表示データ）。振替欄・講習回数・QR 状態を正しく算出 | `scheduleView*.test.ts`（新設） |
| `isStagingEnvironment()` | projectId=staging で true、他で false | `featureRollout.test.ts` |
| 行メモ化（メモリ規律） | 変化のない生徒/講師行は再レンダーされない（`React.memo` の等価判定・renderカウント） | ビュー系テスト |

### Phase 1（リアルタイム同期）

| テスト対象 | 固定する挙動 | 置き場所 |
|---|---|---|
| 自動反映 | 盤面 state 変化で対象行の表示が更新される（同一 state 参照） | ビュー系テスト |
| 非再レンダー | 無関係な編集で他行が再レンダーされない（メモ化の担保） | 同上 |
| specialSessions 反映 | QR提出反映で振替欄・講習回数表が更新される | 同上 |

### Phase 2（日程表コマ組み）

| テスト対象 | 固定する挙動 | 置き場所 |
|---|---|---|
| source 解決純関数 | entryId で特定・同一生徒2科目同コマで取り違えない・見つからない→不成立 | `ScheduleBoardScreen.test.ts` |
| target 検証 | 満席/休校日/範囲外→不成立と理由。空席→成立 | 同上 |
| 通常授業の移動 | 「振替 manual 追加」と「移動元当該日の抑制」が**両方**入る。他週の通常は不変 | 同上 |
| 講習の移動 | 選択科目（rawKey）維持（v1.5.364 の回帰） | 同上 |
| 週範囲外への移動 | `ensureWeeksCoverDateRange` で拡張して成立 | 同上 |
| Undo | D&D移動が1操作として戻る | 同上 |

**「修正なしで落ち・修正ありで通る」の確認**：新規挙動は「実装前に落ちるテストを先に書く」が
理想だが、最低限「実装をコメントアウト/フラグ無効にするとテストが落ちる」ことを1度確認する。

## 7. デバッグ・実機検証手順（開発中・staging 共通）

### 7-1. 基本セットアップ

- `npm run dev`（ポート5173）→ 盤面を開く → 日程表をドック表示／別ウィンドウ表示で開く。
- **ポップアウト時は DevTools を本体と子ウィンドウの両方で開く**（別ウィンドウなので Console も別）。
  ただし React 同一ツリーなので、旧方式と違い実行時エラーは本体側にも伝播しやすい。

### 7-2. メモリの計測（`?memlog=1`・既存の診断機構・最重要）

- 本体URLに `?memlog=1`（または localStorage `komahyou:memlog`='1'）。
  `src/utils/memoryDiagnostics.ts` が5秒ごとに heap(MB) と `bumpMemCounter` の delta を出力。
- **実装時に `bumpMemCounter('schedule-view-render')` を `ScheduleView` の行レンダーに仕込む**。
- 判定手順（spec-interactive-view §G-4 の実測）：
  1. 日程表をドックとポップアウトの両方で開く → `?memlog=1` で 30 秒放置し baseline heap をメモ。
  2. 出席クリックを 20 回連続（数秒間隔） → `schedule-view-render` の delta が
     **編集した行の分だけで、全行×編集回数にならない**ことを確認（メモ化の担保）。
  3. 5 分間編集を続け、heap が**単調増加せず GC 後 baseline 近傍に戻る**ことを確認。
     迷ったら DevTools → Memory → ヒープスナップショットを編集前後で比較（Detached window /
     大量オブジェクトが増え続けていないか）。
- 退行ベンチ（比較用）：`React.memo` を一時的に外して同操作すると全行再レンダーで delta が増える。
  差を確認して戻す（メモ化が効いている証拠にする）。

### 7-3. ポップアウト（子ウィンドウ）の確認

- 「別ウィンドウで開く」→ 別モニターへ移動できるか・スタイルが崩れないか。
- 子ウィンドウを閉じる／親をリロードした時に本体が正常か（portal 破棄・リーク無し）。
- ドック ⇄ ポップアウトのトグルで期間・絞り込み状態が保持されるか。

### 7-4. staging での必須シナリオ（実機・デプロイ後）

1. 各 spec の受け入れ条件（interactive-view §G・sync §E・dnd §E）を上から全部。
   **ドックとポップアウトの両方**で機能1・2を確認（オーナーが両方を比較できる状態にする）。
2. **メモリ長時間試験**：ドック＋ポップアウトを開いたまま 30 分通常操作し memlog の heap が安定。
3. **印刷／PDF回帰**：全員表示・空フォーマット印刷が従来どおり出る（生成HTMLを壊していない）。
4. バージョン更新中の挙動：ポップアウト表示中に staging 再デプロイ → 本体リロードで
   子ウィンドウが孤児化せず、開き直しで正常表示（React 同一バンドルなので旧方式の
   バージョンスキュー地獄は無いが、子ウィンドウのライフサイクルは確認する）。

## 8. 本番エラーゼロ・チェックリスト（リリース判定）

**対象環境**：本番3教室のスタッフPC = Windows + Chrome/Edge 最新（自動更新）。日程表は
PC 専用運用（スマホ/タブレットは QR 提出側で本機能の対象外）。D&Dは Pointer Events で
マウス・タッチ両対応（盤面D&D `studentDragAndDropMove` を踏襲）。

リリース前に全部 YES であること：

- [ ] CI（lint / unit / build）緑。
- [ ] regression-reviewer 検査済み（§1 の厳禁リスト・**印刷経路を壊していない**・
      force ゲート等を早まって削っていない）。
- [ ] **印刷／PDF（全員表示・空フォーマット）が従来どおり動く**ことを staging で確認。
- [ ] メモリ規律の実測合格（§7-2・行メモ化が効き heap 単調増加なし。数値を CHANGELOG/Issue に記録）。
- [ ] ポップアウト子ウィンドウのライフサイクル正常（閉/親リロード/再オープンでリーク・孤児化なし）。
- [ ] **オーナーの staging チェック合格を明示的にもらった**（合格前の main マージは禁止）。
      本番展開形（ドック/ポップアウトの既定・生成HTMLタブの去就）もオーナーと確定済み。
- [ ] 本番リリース後、各教室でハードリロード（Ctrl+Shift+R）周知（旧バンドルキャッシュ事故防止）。
- [ ] リリース後 1〜2 営業日は `uptime-check` と教室報告を注視。異常時は環境判定/フラグを戻す
      1行コミット（最速）または Hosting 巻き戻し（`docs/runbooks/rollback.md` A）。

## 9. スコープ外（やらないこと）

- 多端末間のリアルタイム同期（Firestore onSnapshot 等）— 1教室1端末方針のため対象外。
- 全体日程・講習ポップアップへの自動同期、講師日程表からのD&D — 将来検討。
- 保存アーキテクチャの変更（自動保存化・D&D即時保存）— 明示的に不採用。
- 基本データ（週間パターン）の書き換えによる恒久移動 — 明示的に不採用。
