# 改修作業手順書：日程表リアルタイム同期 ＋ 生徒日程表D&D移動

> 次セッションの実装担当（AIモデル問わず）向けの自己完結手順書。2026-07-08 作成。
> 仕様の正本は `docs/spec-schedule-popup-realtime-sync.md`（機能1）と
> `docs/spec-student-schedule-dnd.md`（機能2）。**本書と正本2つを読んでから着手すること**。
> 行番号は 2026-07-08（v1.5.406）時点の目安。ズレていたら記載のシンボル名で検索する。

## 0. 着手前チェック（毎回必須）

1. `CLAUDE.md` と `.claude/skills/solo-git-workflow/SKILL.md` に従う：
   `git fetch origin && git status -sb` でローカル main が origin/main に追随、
   `node -p "require('./package.json').version"` と
   `https://komahyouapp-prod.web.app/version.json` の一致を確認してから編集開始。
2. **本番データ保護**：Firestore への書き込み検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。
3. 機能実装なので**必ずブランチを切る**（例: `feature/schedule-popup-auto-sync`、
   `feature/student-schedule-dnd`）。2機能は**別ブランチ・別リリース**にする
   （機能1が性能検証を伴うため、切り分けられる状態を保つ）。
4. 編集ごとに `CHANGELOG.md` の `## 未リリース` へ1行追記。`package.json` の version は触らない。
5. **変更には必ずユニットテストを同コミットで添える**（テストゲート・オーナー厳命）。

## 1. 関連コードの地図（実装調査済み・2026-07-08）

| 場所 | 内容 |
|------|------|
| `src/utils/scheduleHtml.ts` | ポップアップHTML生成（約5800行）。**埋め込みJSはテンプレートリテラル内文字列**（エスケープ罠 → memory `komahyou-schedulehtml-embedded-script`、`new Function` 構文検証テストあり）。`openStudentScheduleHtml`(≈5804) / `syncStudentScheduleHtml`(≈5844) / `syncTeacherScheduleHtml`(≈5849)。ポップアップへの送信は `postMessage({type:'schedule-data-update', viewType, payload})`(≈5801)。ポップアップ側受信は `window.addEventListener('message', …)`(≈5727)で `scheduleIncomingPayload` → `buildPayloadFingerprint`(≈2376)で同一なら再描画スキップ。「最新表示」ボタンは `schedule-apply-button`(≈2270)。生徒カード描画は `renderStudentCellCard`(≈3062)、セル索引は `buildCellMap`(≈2788)。ペイロードのセルは `serializeCells`(≈267)で `desks`（講師名・statusSlots・lesson）まで含む。 |
| `src/App.tsx` | `syncStudentSchedulePopup` / `syncTeacherSchedulePopup`(≈3268-3345)：**先頭に `if (!force) return` ゲート**（旧メモリ障害対策・絶対に外さない）。range はポップアップの選択（`studentScheduleRange` 等）を反映済み＝表示範囲限定生成は実装済み。ポップアップからのメッセージ受信は `handleScheduleRangeMessage`(≈3360)：`schedule-refresh-request` / `schedule-popup-ready` / `schedule-student-count-save`(≈3424) / `schedule-range-update`(≈3624)。App→盤面の一過性リクエスト：`StudentScheduleRequest`(≈149・`mode:'unassign'`)、発行(≈3493)、処理済み消費 `handleStudentScheduleRequestProcessed`(≈1298)→`consumeStudentScheduleRequest`。 |
| `src/components/schedule-board/ScheduleBoardScreen.tsx` | 盤面本体（8000行超）。ポップアップ窓の共有参照 `getSchedulePopupRuntimeWindow`(≈697) / `hasOpenSchedulePopup`(≈701)。盤面側の日程表同期 effect は**2つとも deps `[scheduleSyncTrigger]` のみ**(≈5575, ≈5601・コメントが回帰ガード)。`scheduleSyncTrigger` は popup-ready と最新表示でのみ +1(≈3647, ≈4344)。移動の純関数 `computeStudentMove`(≈3358・export済・テストあり)、実移動 `executeMoveStudent(cellId, deskIndex, studentIndex, …)`(≈7617)。一過性リクエストの消費純関数 `consumeStudentScheduleRequest`(≈2906)。 |
| `src/utils/featureRollout.ts` | `featureRolloutRegistry` にキーを追加して `isFeatureEnabledForClassroom(key, classroom)` で判定。`scope:'development-only'` → 検証後 `'all-classrooms'` へ昇格（1行変更のコミット）。盤面D&Dの前例キー `studentDragAndDropMove`。 |

### 必読 memory / 過去修正（巻き戻し厳禁）

- commit `bff131c`・`b51c49d`（2026-06-05）：旧リアルタイム同期停止の真因と対策。**force ゲートと deps `[scheduleSyncTrigger]` を薄めない**。
- Issue #46（v1.5.406）：一過性リクエストを再マウントで再発火させない（**処理後に state 消費(null化)＋判定純関数化**）。
- v1.5.364：講習移動の選択科目（rawKey）尊重。v1.5.388：`resolveRegularTeacherIds` の移動生徒除外ガード（`createBasePayload` 内コメント）。
- 7/20振替消失事故：通常→振替化は「振替 manual 追加＋振替元抑制」の**両方必須**。
- `mergeManagedDeskLesson` の生徒同一性補完（spread 単純化で消さない）。

## 2. Phase 1：リアルタイム同期（機能1）

**設計方針（推奨・A案）**：「最新表示」ボタンが通っている実証済み経路
（App の force 同期＋盤面の `scheduleSyncTrigger`）を、**デバウンス済みトリガから自動発火**する。
新しい同期経路は作らない。自動発火のオーナーは**盤面（ScheduleBoardScreen）1箇所**とする
（盤面が編集の発生源であり、popup 窓参照も持つため）。

1. **featureRollout キー追加**：`schedulePopupAutoSync`（`scope:'development-only'`、
   description に目的と本手順書への参照を書く）。
2. **盤面変更リビジョンの導入**（ScheduleBoardScreen）：盤面状態のコミット地点で単調増加する
   `boardRevisionRef` を導入（`useEffect(() => { revision++ }, [boardState, specialSessions])`
   で十分。specialSessions も対象＝QR提出の反映を含む・spec §C-1。
   effect 自体は軽量なカウントのみで再生成はしない）。
3. **デバウンス自動同期 effect の追加**（ScheduleBoardScreen・新設1つ）：
   - 発火条件: feature 有効 && `hasOpenSchedulePopup('student'|'teacher')` && 前回同期時
     リビジョン < 現リビジョン。
   - 約1.5秒のデバウンス後に、既存の最新表示経路と同じ同期を1回実行する。**経路は次に確定**：
     Board のデバウンス effect が (a) `setScheduleSyncTrigger(t => t+1)`、
     (b) `window.postMessage({type:'schedule-refresh-request', viewType}, '*')` を自ウィンドウへ
     発行する。(b) は App の既存 `handleScheduleRangeMessage`（≈3360）がポップアップからの
     メッセージと同一に処理し `syncStudentSchedulePopup(true)` 等を呼ぶ——**本番実証済みの
     ハンドラを新規配線なしで再利用**するため。ただし送信前に教室ガード
     （spec D-2-1）を通す。**`if (!force) return` ゲート自体には触らない**。
     （代替案：App から Board へ同期関数をコールバック prop で渡す。プロップ配線が増えるが
     明示的。どちらでも可だが、選んだ方に一本化し二重発火させない。）
   - 実行後に「同期済みリビジョン」を更新。タイマーは cleanup で必ず破棄。
   - ⚠️ 既存2つの同期 effect（deps `[scheduleSyncTrigger]`）はそのまま使う。deps を増やさない。
4. **判定の純関数化＋テスト**：`shouldAutoSyncSchedulePopup({featureEnabled, popupOpen,
   lastSyncedRevision, currentRevision})` のような純関数に切り出し、ユニットテストで
   「変化なし→発火しない」「popup閉→発火しない」「連続編集→1回」を固定する。
   デバウンスはタイマーfakeで検証（既存テストの流儀は `ScheduleBoardScreen.test.ts` を参照）。
5. **ボタン改名**（scheduleHtml.ts ≈2270）：feature 有効時のみ
   生徒view「期間・生徒名適用」/講師view「期間・講師名適用」、無効時は従来の「最新表示」。
   title 属性の説明文も合わせて更新。ラベル出し分けのユニットテストを追加。
6. **バージョンスキュー対策**（spec D-2-2・機能2より先にここで入れる）：ペイロードに
   `payloadAppVersion: __APP_VERSION__` を同梱。埋め込みJSは生成時バージョンを定数で持ち、
   受信ペイロードと不一致なら差分適用せず本体へ再オープン要求（新メッセージ
   `schedule-reopen-request` 等）→ 本体は該当ポップアップの文書全体を再生成する。
   両側とも未知メッセージ・未知フィールドは黙って無視する防御的ハンドリングにする。
7. **回帰確認**：`npm run build`＋全ユニット green。特に scheduleHtml の
   `new Function` 構文検証テスト。`git diff` で force ゲート・既存 effect deps に触れていないこと。

## 3. Phase 2：生徒日程表D&D移動（機能2）

**設計方針**：ポップアップはUI（掴む・落とす・机を選ぶ）だけを担当し、
**盤面状態の変更は本体側で既存ロジック（`executeMoveStudent`）を再利用**する。
経路は既存の一過性リクエスト機構（`StudentScheduleRequest`）の拡張。

1. **featureRollout キー追加**：`studentSchedulePopupDragMove`（`development-only`）。
   ペイロードに feature 有効フラグを載せ、埋め込みJS側でD&Dの活性を制御。
2. **ポップアップ側・長押しD&D**（scheduleHtml.ts 埋め込みJS）：
   - `renderStudentCellCard` のカードに data 属性（entry id / studentId / dateKey /
     slotNumber / lessonType / subject）を付与。
   - 長押し約250ms→ドラッグ開始（盤面D&D `studentDragAndDropMove` のUX踏襲）。
     集団授業カードは対象外。ドロップ可能セル（開校日・当該生徒の空きセル）をハイライト。
   - ⚠️ 埋め込みJSはテンプレートリテラル内。`\'` 等のエスケープ崩れに注意し、
     **`new Function` 構文検証テストが通ることを編集のたびに確認**。
3. **ポップアップ側・机選択モーダル**：ドロップで対象コマ（dateKey×slotNumber）の
   `DATA.cells` から机テーブルを描画（講師名・着席生徒・空席。コマ表のコマと同じ見た目）。
   空席のみ選択可、ソフト警告席は警告付きで選択可、キャンセル可。
4. **移動要求メッセージ**：席確定で
   `window.opener.postMessage({type:'schedule-student-move-request', classroomStorageKey,
   payloadAppVersion, studentId, source:{dateKey, slotNumber, entryId, lessonType, subject},
   target:{dateKey, slotNumber, deskIndex}}, '*')`。送信と同時に既存 interaction-lock で
   ポップアップの追加操作をロック（結果受信/タイムアウトで解除・spec D-2-2）。
5. **App側受信 → 一過性リクエスト**（App.tsx）：`handleScheduleRangeMessage` に分岐を追加し、
   `StudentScheduleRequest` を `mode:'move'` へ拡張（requestId 採番・処理済みで
   `consumeStudentScheduleRequest` により null 化）。**Issue #46 のパターンを踏襲**：
   新しい永続 state・独自ガード ref を作らない。
6. **盤面側・移動実行**（ScheduleBoardScreen）：
   - `mode:'move'` リクエストを受けたら、source（studentId＋dateKey＋slotNumber＋entryId）を
     盤面座標（cellId / deskIndex / studentIndex）へ解決する**純関数**を新設。
   - `classroomStorageKey` が `actingClassroomId` と不一致の要求は黙って破棄（spec D-2-3）。
   - target セルの実在・空席を**実行時点の盤面で再検証**（ポップアップ情報は古い可能性）。
     target が盤面の読込週範囲外なら `ensureWeeksCoverDateRange` で拡張してから（spec D-2-1）。
     不成立なら盤面を変えず、結果メッセージをポップアップへ返してトースト表示。
   - 成立なら `executeMoveStudent` を再利用（振替・講習は既存移動と同じ。講習の
     rawKey 科目維持を壊さない）。**通常授業**は盤面D&Dで通常を別日に動かした場合と同じ
     経路に乗せ、「振替 manual 追加＋移動元当該日の抑制」が**両方**行われることをテストで固定。
   - 処理後 `onStudentScheduleRequestProcessed(requestId)` で消費し、該当ポップアップへ
     force 同期を1回発火（機能1未導入でも即反映されるように）。
7. **テスト（同コミット必須）**：
   - 座標解決純関数（見つかる/見つからない/同名別人の扱い）。
   - 通常移動＝追加＋抑制の両立（`computeStudentMove` 系の既存テストに追加）。
   - 講習移動の科目維持（v1.5.364 の回帰テストを popup 経由でも固定）。
   - target 満席・休校日で不成立になること。
   - リクエスト消費（再マウント再発火なし・Issue #46 型テストに倣う）。
   - scheduleHtml の `new Function` 構文検証。

## 4. Phase 3：検証・リリース（両機能共通・機能ごとに実施）

1. **regression-reviewer**（読み取り専用レビュー）に diff を検査させる
   （特に §1 の「巻き戻し厳禁」リスト）。
2. `npm run lint` / ユニット全件 / `npm run build` green → コミット（CHANGELOG 同梱）→
   CI（`.github/workflows/ci-tests.yml`）緑を確認 → main マージ。
3. **staging 実機検証**（`komahyouapp-staging`・`.claude/skills/staging-environment`）：
   - 機能1：受け入れ条件 §E（spec-schedule-popup-realtime-sync.md）を実施。
     **heap 計測（popup 2枚開いたまま連続出席入力）は必須**（旧障害の宿題）。
   - 機能2：受け入れ条件 §E（spec-student-schedule-dnd.md）を実施。
4. 本番デプロイ後、**開発用教室 `v8OZ7zH8vONNHjjYVcR1`** で実機確認
   （featureRollout が development-only なので本番3教室は不変）。
5. 問題なければ featureRollout を `all-classrooms` へ昇格する**単独コミット**を出し、
   safe-release スキルのチェックリストで最終確認。昇格後に各端末ハードリロード周知。
6. 障害時ロールバック：Hosting 巻き戻し（`docs/runbooks/rollback.md` A）または
   featureRollout を `development-only` に戻す1行コミット（機能2の盤面D&D前例では
   「回帰で development-only へ戻さない」と明記されているが、これは**安定後**の話。
   導入直後の不具合対応としての一時降格は可）。

## 5. テスト計画（何を・どこに・どう固定するか）

方針は `docs/test-strategy.md`（E2E廃止・ユニットが唯一の自動ゲート）。
**ロジックは必ず純関数に切り出してからテストする**。以下は最低ライン（実装中に増やすのは可）。

### 機能1（リアルタイム同期）

| テスト対象（純関数化して export） | 固定する挙動 | 置き場所 |
|---|---|---|
| `shouldAutoSyncSchedulePopup({featureEnabled, popupOpen, lastSyncedRevision, currentRevision, popupClassroomKey, actingClassroomId})` | 変化なし/popup閉/feature無効/教室不一致→発火しない。変化あり→発火し同期済みリビジョン更新 | `ScheduleBoardScreen.test.ts` |
| デバウンス動作（fake timers） | 1.5秒以内の連続編集N回→送信1回。cleanup/popup閉でタイマー破棄 | 同上 |
| ボタンラベル出し分け | feature有効: 生徒「期間・生徒名適用」/講師「期間・講師名適用」、無効: 「最新表示」 | `scheduleHtml` 系テスト |
| ペイロードの `payloadAppVersion` 同梱とポップアップ側の不一致検知（再オープン要求） | 不一致→差分適用せず再オープン要求。一致→通常適用 | 同上 |
| 埋め込みJS構文検証（既存 `new Function` テスト） | テンプレ編集後も構文正常 | 既存テストが緑のまま |

### 機能2（D&D移動）

| テスト対象 | 固定する挙動 | 置き場所 |
|---|---|---|
| source 解決純関数（popup座標→盤面 cellId/deskIndex/studentIndex） | entryId で特定・同一生徒2科目同コマでも取り違えない・見つからない→null | `ScheduleBoardScreen.test.ts` |
| target 検証純関数 | 満席/休校日/範囲外→不成立と理由。空席→成立 | 同上 |
| 通常授業の移動 | 「振替 manual 追加」と「移動元当該日の抑制」が**両方**入る。他週の通常は不変（`computeStudentMove` 系既存テストへ追加） | 同上 |
| 講習の移動 | 選択科目（rawKey）維持（v1.5.364 の回帰テストを popup 経由でも） | 同上 |
| `StudentScheduleRequest` の `mode:'move'` 拡張 | 処理後 `consumeStudentScheduleRequest` で null 化・再マウントで再発火しない（Issue #46 型テストに倣う） | 既存の #46 テスト隣 |
| 週範囲外への移動 | `ensureWeeksCoverDateRange` で拡張して成立 | 同上 |
| Undo | D&D移動が1操作として戻る | 同上 |
| 教室ガード | `classroomStorageKey` 不一致の move-request は無視され盤面不変 | `App` 側 or 純関数 |
| 埋め込みJS構文検証 | D&D/モーダル追加後も `new Function` テスト緑 | 既存 |

**「修正なしで落ち・修正ありで通る」の確認**：新規挙動は「実装前に落ちるテストを先に書く」が
理想だが、最低限「実装をコメントアウト/フラグ無効にするとテストが落ちる」ことを1度確認する。

## 6. デバッグ手順（開発中・staging 共通）

### 6-1. 基本セットアップ

- `npm run dev`（ポート5173）→ 盤面を開く → 日程表ポップアップを開く。
- **DevTools は本体ウィンドウとポップアップウィンドウの両方で開く**（ポップアップは別ウィンドウ
  なので Console/エラーも別。ポップアップ側のエラーは本体の Console には出ない）。
- ポップアップ側で実行時エラーが出ると**埋め込みJS全体が停止**する（黙って無反応になる）。
  「反応しない」時はまずポップアップ側 Console を見る。

### 6-2. メモリ・同期回数の計測（`?memlog=1`・既存の診断機構）

- 本体URLに `?memlog=1` を付ける（または localStorage `komahyou:memlog`='1'）。
  `src/utils/memoryDiagnostics.ts` が **5秒ごとに heap(MB) と各処理の発生回数(delta)** を
  `[komahyou-memlog]` として Console に出力する。
- 既存カウンタ：`student-schedule-sync` / `teacher-schedule-sync`（App の force 同期）、
  `board-render`、`app-render` 等。**実装時に `bumpMemCounter('schedule-auto-sync')` を
  デバウンス発火点に追加**し、編集回数と自動同期回数の比を数値で確認できるようにする。
- 判定手順（受け入れ条件 E-1/E-2 の実測）：
  1. 生徒・講師ポップアップを両方開く → `?memlog=1` で 30 秒放置し baseline heap をメモ。
  2. 出席クリックを 20 回連続（数秒間隔） → memlog で `schedule-auto-sync` の delta が
     編集回数より大幅に少ない（デバウンス集約）ことを確認。
  3. 5 分間編集を続け、heap が**編集のたびに単調増加せず、GC 後 baseline 近傍に戻る**ことを確認。
     判断に迷ったら DevTools → Memory → ヒープスナップショットを編集前後で取り比較
     （Detached window / 大量の文字列が増え続けていないか）。
- 旧障害の再現ベンチ（比較用）：feature フラグを一時的に「デバウンスなし・毎編集同期」にした
  ローカル改変で同じ操作をすると heap 増加が観察できるはず。対策版との差を確認して戻す。

### 6-3. メッセージのトレース

- 本体 Console で `window.addEventListener('message', e => console.log('[msg]', e.data?.type, e.data))`
  を一時実行すると popup→本体のメッセージが全部見える（`schedule-student-move-request` の
  payload 形の確認に使う）。ポップアップ側も同様に `schedule-data-update` の受信を確認できる。
- ポップアップの操作ロックが解除されず固まった場合の救済：本体から
  `popup.postMessage({type:'schedule-force-release-interaction'}, '*')`（既存機構）。

### 6-4. staging での必須シナリオ（実機・デプロイ後）

1. 機能1・機能2 の各受け入れ条件（正本 §E）を上から全部。
2. **バージョンスキュー訓練**：ポップアップを開いたまま staging に再デプロイ → 本体だけ
   リロード → ポップアップが自己修復（再オープン）し、例外が出ないこと。
3. **長時間試験**：ポップアップ2枚開いたまま 30 分通常操作し、memlog の heap が安定。
4. 回線断（DevTools offline）中の盤面編集 → 自動同期はローカル動作なので影響なしを確認。

## 7. 本番エラーゼロ・チェックリスト（リリース判定）

**対象環境**（この教室運用の実態に合わせる）：
- 本番3教室のスタッフPC = Windows + Chrome/Edge 最新（自動更新）。日程表ポップアップは
  PC 専用運用（スマホ/タブレットは QR 提出側で、本機能の対象外）。
- タッチ非対応PCではD&Dはマウス長押し。Pointer Events で実装しマウス/タッチ両対応にする
  （盤面D&D `studentDragAndDropMove` の実装を踏襲すれば両対応になる）。

リリース前に全部 YES であること：

- [ ] CI（lint / unit / build）緑。`new Function` 構文検証テスト緑。
- [ ] regression-reviewer の巻き戻し検査済み（§1 の厳禁リスト）。
- [ ] staging で §6-4 の4シナリオ全部合格（heap 実測値を Issue/CHANGELOG に記録）。
- [ ] バージョンスキュー対策が入っている（`payloadAppVersion` 同梱＋再オープン要求＋
      両側の防御的メッセージハンドリング）。**これが無いままメッセージ形を変えるリリースをしない**。
- [ ] featureRollout が `development-only` である（初回リリース時）。
- [ ] 本番デプロイ後、開発用教室 `v8OZ7zH8vONNHjjYVcR1` で受け入れ条件のスモーク
      （同期反映・D&D移動・保存・リロード永続化）。
- [ ] 昇格（`all-classrooms`）は**単独コミット**で、昇格後にオーナーへ
      「各教室でハードリロード（Ctrl+Shift+R）」の周知を依頼（旧バンドルキャッシュ事故防止）。
- [ ] 昇格後 1〜2 営業日は `uptime-check` と教室からの報告を注視。異常時は
      featureRollout を `development-only` へ戻す1行コミット（最速）または Hosting 巻き戻し
      （`docs/runbooks/rollback.md` A）。

## 8. スコープ外（やらないこと）

- 多端末間のリアルタイム同期（Firestore onSnapshot 等）— 1教室1端末方針のため対象外。
- 全体日程・講習ポップアップへの自動同期、講師日程表からのD&D — 将来検討。
- 保存アーキテクチャの変更（自動保存化・D&D即時保存）— 明示的に不採用。
- 基本データ（週間パターン）の書き換えによる恒久移動 — 明示的に不採用。
