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
   `boardRevisionRef` を導入（`useEffect(() => { revision++ }, [boardState])` で十分。
   effect 自体は軽量なカウントのみで再生成はしない）。
3. **デバウンス自動同期 effect の追加**（ScheduleBoardScreen・新設1つ）：
   - 発火条件: feature 有効 && `hasOpenSchedulePopup('student'|'teacher')` && 前回同期時
     リビジョン < 現リビジョン。
   - 約1.5秒のデバウンス後に、既存の最新表示経路と同じ同期を1回実行
     （`setScheduleSyncTrigger(t => t+1)` ＋ App 側 force 同期の発火。App 側は
     `schedule-refresh-request` ハンドラ相当の関数を props/コールバックで呼ぶか、既存の
     window message を利用。**`if (!force) return` ゲート自体には触らない**）。
   - 実行後に「同期済みリビジョン」を更新。タイマーは cleanup で必ず破棄。
   - ⚠️ 既存2つの同期 effect（deps `[scheduleSyncTrigger]`）はそのまま使う。deps を増やさない。
4. **判定の純関数化＋テスト**：`shouldAutoSyncSchedulePopup({featureEnabled, popupOpen,
   lastSyncedRevision, currentRevision})` のような純関数に切り出し、ユニットテストで
   「変化なし→発火しない」「popup閉→発火しない」「連続編集→1回」を固定する。
   デバウンスはタイマーfakeで検証（既存テストの流儀は `ScheduleBoardScreen.test.ts` を参照）。
5. **ボタン改名**（scheduleHtml.ts ≈2270）：feature 有効時のみ
   生徒view「期間・生徒名適用」/講師view「期間・講師名適用」、無効時は従来の「最新表示」。
   title 属性の説明文も合わせて更新。ラベル出し分けのユニットテストを追加。
6. **回帰確認**：`npm run build`＋全ユニット green。特に scheduleHtml の
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
   `window.opener.postMessage({type:'schedule-student-move-request', studentId,
   source:{dateKey, slotNumber, entryId, lessonType, subject},
   target:{dateKey, slotNumber, deskIndex}}, '*')`。
5. **App側受信 → 一過性リクエスト**（App.tsx）：`handleScheduleRangeMessage` に分岐を追加し、
   `StudentScheduleRequest` を `mode:'move'` へ拡張（requestId 採番・処理済みで
   `consumeStudentScheduleRequest` により null 化）。**Issue #46 のパターンを踏襲**：
   新しい永続 state・独自ガード ref を作らない。
6. **盤面側・移動実行**（ScheduleBoardScreen）：
   - `mode:'move'` リクエストを受けたら、source（studentId＋dateKey＋slotNumber＋entryId）を
     盤面座標（cellId / deskIndex / studentIndex）へ解決する**純関数**を新設。
   - target セルの実在・空席を**実行時点の盤面で再検証**（ポップアップ情報は古い可能性）。
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

## 5. スコープ外（やらないこと）

- 多端末間のリアルタイム同期（Firestore onSnapshot 等）— 1教室1端末方針のため対象外。
- 全体日程・講習ポップアップへの自動同期、講師日程表からのD&D — 将来検討。
- 保存アーキテクチャの変更（自動保存化・D&D即時保存）— 明示的に不採用。
- 基本データ（週間パターン）の書き換えによる恒久移動 — 明示的に不採用。
