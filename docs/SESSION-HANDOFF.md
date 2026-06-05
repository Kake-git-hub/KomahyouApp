# セッション引き継ぎメモ（2026-06）

新しいチャットはまずこのファイルを読んでください。直近の作業文脈・現状・次の一手をまとめています。

## プロジェクト概要 / 環境
- コマ表アプリ（講習＋通常授業の運用管理）。React + TypeScript + Vite + Firebase。
- 本番: Firebase Hosting `https://komahyouapp-prod.web.app`（= `firebaseapp.com` も同一プロジェクト）。
- `.env.local`: `VITE_EXTERNAL_BACKEND_MODE=firebase` / `VITE_FIREBASE_ENABLE_FUNCTIONS=true`（Blaze）/ workspaceKey=`main`。
- リモート保存は **Cloud Functions 経由に一本化**（`saveClassroomSnapshot`）。読込は `workspaceStore.ts` の `loadFirebaseWorkspaceSnapshot`。
- 現行バージョン: **1.5.282**（`package.json`）。

## ビルド/テスト/デプロイ
```bash
npm run test:unit            # vitest（全 230 件）
npx tsc -p tsconfig.app.json --noEmit   # 型チェック
npm run build                # tsc -b + vite build + version.json 書き出し
npm run deploy:firebase      # build + hosting,firestore デプロイ + ライブ検証
```
- 注意: `git commit -m` で日本語複数行を渡すときは PowerShell/here-string で `@` が混入しやすい。`-F <file>` でメッセージファイル渡しが安全。
- デプロイ末尾の検証スクリプトが稀に exit 1 を返すが、`Deploy complete!` と両ドメインの `version.json` が更新されていれば配信は成功。
- ローカル実機確認は `.env.development.local` に `VITE_EXTERNAL_BACKEND_MODE=local` を置いて `npm run dev`（firebase 無効・仮ログイン）。**ただし firebase 経路・大量データは local では再現しない**。確認後は必ず削除。

## アーキテクチャの要点（再発バグの温床）
- **保存経路は Functions 一本**。`workspaceStore.ts` の Firestore 直書きは削除済み（過去は併存が回帰の温床だった）。
- **盤面のダーティ判定** = `dataSignature !== cleanSignature`（`App.tsx`）。3つの署名生成器
  `dataSignature`(useMemoスライス分割) / `buildCurrentDataSignature` / `buildClassroomDataSignature` は
  **必ず同一フォーマット**（共通 `combineDataSignature` / `buildBoardDataForSignature` / `stringifySignaturePart`、
  区切りは制御文字 ）。フォーマットがズレると誤dirty/データ消失になるので厳守。
- **盤面オーバーレイ**: ScheduleBoardScreen は週セルに対し createBoardWeek(通常授業ベース)＋overlay(手動分)を都度再計算。
  `onBoardStateChange(state, {userInitiated:false})`（オーバーレイ再計算）が App の `markStateLoadedClean` を呼ぶため、
  編集直後のクリーン化に注意（過去にこれで保存ボタンが無効化されるバグがあった）。
- **盤面 weeks は週移動で無制限蓄積**（boardState.weeks）。メモリ/配布サイズ/週移動の重さの根本。
- メモ化: BoardGrid / BoardToolbar は `React.memo` 済み。関数 props は `src/utils/useStableCallback.ts` で参照安定化。

## 本セッションで対応した内容（テーマ別・すべてデプロイ済み）
1. **開発用教室の保存失敗を修正**: 開発用教室だけ `saveDevelopmentClassroomSnapshot`(関数側が単一ハードコードID
   `v8OZ7zH8vONNHjjYVcR1` しか受けない)へ分岐して必ず失敗していた。`developmentOnly` 分岐を撤去し全教室同一経路に。
   `featureRollout.manualFirebaseSaveStability` を all-classrooms へ昇格。
2. **保存系の整理**: 未使用の Firestore 直書き(約430行)削除、保存診断ログ(appendSaveDiagnostic)削除、
   ダーティ判定を単純比較へ簡素化。
3. **保存ボタンのUX**: クリック即「保存中…」スピナー(BoardToolbar ローカル state + requestAnimationFrame)。
   **根本**: オーバーレイ再計算が未保存編集をクリーン化 → `isBoardDirty` false → `disabled={!isBoardDirty}` で
   クリックが飲み込まれていた。**「保存待ち(hasPendingSave)がある限り押せる」**よう変更。
4. **QR提出モーダル**: 全件を1モーダルに一覧表示し各行×で個別削除＋「すべて確認」、本文テキスト拡大。
5. **配布用QR(boardShares)**:
   - (a) `classroomSettings.boardShareToken` が教室間でコピーされ**同一トークンで上書き衝突**→別教室データ表示。
     `resolveBoardShareToken` を `classroomId__token` の**冪等プレフィックスで一意化**（`buildClassroomScopedBoardShareToken`）。
     Firestore doc ID は内部の `__` は有効・前後が `__`(`__x__`)は予約で不可（エミュレータ確認済み）。
   - (b) 週蓄積で cells が **Firestore 1MiB 上限超過**→`setDoc` サイレント失敗→「配布用盤面が見つかりません」。
     **gzip+base64 圧縮**で保存(約8%)、読み取りで復元、旧非圧縮docも後方互換。公開失敗時はエラー表示。
   - (c) 配布対象を**現在週以降のみ**に限定（`selectBoardShareCells`）。
   - (d) ボタン名「配布用URL」→**「講師日程共有」**、QR見出しを「教室名 / 講師日程共有」。
   - **運用注意**: スコープ化で旧トークンが変わるため、各教室で配布用URLを開き直して**QRを再配布**が必要（トークン変更は冪等で以後不要）。
6. **メモリ軽量化（数十秒で400〜500MB→クラッシュ問題）**:
   - dataSignature をスライス別メモ化（編集スライスだけ再stringify）。
   - カーソル追従プレビューを `CursorFollowPreview.tsx` に分離（ドラッグ中の全体再描画を停止）。
   - BoardGrid / BoardToolbar を memo 化。
   - 講習提出のリアルタイム購読の churn 削減（無変更時 specialSessions の参照維持）。
   - **本番メモリ診断 `src/utils/memoryDiagnostics.ts`**（`?memlog=1` or localStorage `komahyou:memlog`=`1`）。
     5秒ごとに heap と主要処理回数(delta)を `console.info('[komahyou-memlog]')` 出力。`bumpMemCounter` 設置。
   - 診断結果: **リークではなく「巨大盤面の保持(~423MB)＋読込時の一時確保(~519MB)」**と確定。
   - **週bounding 実装**（`src/components/schedule-board/boardWeekTrim.ts` + test）:
     「今日の前6週〜先26週＋手動編集のある週」だけ保持し、範囲外の未編集週(通常授業のみ=再生成で同一)を破棄。
     `weekHasManualBoardData` が手動痕跡を保守的に検出（非regular生徒/manualAdded/makeup・move・special源/メモ/出欠status/
     手動講師/teacherAssignmentSource/lessonノート）→ **編集週は必ず保持=データ消失なし**。
     トリムは applySnapshot / applyWorkspaceSnapshot(読込) と syncCurrentClassroomData(保存) で実施。
     clean署名はトリム後で計算（誤dirty回避）、weekIndex は dateKey で再特定して補正。ライブ表示中 weeks は不変。
     **効果: 読込後ベースライン 423MB → 約22〜49MB（実機確認済み）**。
   - **日程表popup のスパイク対策**: `boardState`/範囲/講習変更のたびに講師・生徒の全日程popupを完全再生成し
     ピーク847MBに達していた（同一オリジンpopupの描画もmainタブheapに合算）。**popup再同期を400msデバウンス**
     （4 effect）。`student/teacher-schedule-sync` カウンタ追加。

7. **「出席/欠席/振替を埋めると重くなる」対策（1.5.277）**:
   - **根本**: Undo/Redo 履歴(`undoStack`/`redoStack`)が**無制限**。`commitWeeks` は編集のたびに
     `createHistoryEntry`→`cloneWeeks(weeks)`(全週=週bounding後のディープクローン)を push しており、
     出欠/振替を1セルずつ埋めるほど履歴がメモリへ線形蓄積し、各クリックも徐々に重くなっていた。
   - **対策**: `MAX_HISTORY_DEPTH=50` の上限付き `appendHistoryEntry` を新設し、push 3箇所
     (commitWeeks / handleUndo の redo push / handleRedo の undo push)を差し替え。超過分は古い側から破棄。
     50手の「戻す」は実運用に十分。`ScheduleBoardScreen.test.ts` に上限テスト2件追加（全232件green）。
   - 注: 1編集あたりの同期クローン(handler/createHistoryEntry/onBoardStateChange/board-sync-publish)は
     週boundingで件数は有界。さらに削るなら commitWeeks 内のクローン重複削減が次の候補（署名/dirty判定に影響、要慎重）。

8. **「出席が溜まるとメモリが喰う(heap 1.5GB暴走)」対策（1.5.278）**:
   - **診断(本番 ?memlog=1)**: アイドル19〜29MBは良好だが、教室を開いて出席等を入力していくと
     `QuotaExceededError('komahyouapp:workspace-snapshot')` と Firestore
     `resource-exhausted: Write stream exhausted maximum allowed queued writes` が出て heap が
     269→679→1090→**1536MB** へ暴走。
   - **根本1: boardShare publish の二重発火**。`handleBoardStateChange`(250ms)に加え、`boardState`依存の
     useEffect(200ms)が**非ユーザー操作(オーバーレイ再計算・読込)でも**毎回 publish。`publishBoardShare` は
     都度 全cellsを `JSON.stringify`+gzip+`setDoc` するため、出席連続入力で setDoc がドレインより速く
     キューされ枯渇→SDKが巨大mutationをメモリ保持＆リトライ→暴走。
   - **対策1**: 重複 useEffect を撤去し publish をユーザー編集経路一本化。`publishBoardStateSnapshot` に
     (a)共有セルを compact 化した署名で**前回公開と同一ならスキップ**、(b)**single-flight**
     (`boardSharePublishInFlightRef`)＋末尾追い公開(`boardSharePendingStateRef`/`publishBoardStateSnapshotRef`)
     を実装。`compactBoardSharePayload` を App.tsx に import。未使用化した `boardSharePublishTimerRef` 削除。
   - **根本2: localStorage への workspace 丸ごと書き込みが quota 超過で例外**を投げ `onOpenClassroom` を中断。
   - **対策2**: `writeWorkspaceToLocalStorageSync` を try/catch 化し成否を boolean 返却。超過時は古いキャッシュを
     削除して握りつぶす（正本は IndexedDB）。`tryWriteWorkspaceToLocalStorageSync` は単純委譲に。
   - 注: **local モードは firebase 無効で publish 経路が走らない**ため、ローカルでは編集/Undoの回帰のみ確認。
     publish dedup/single-flight の効果検証は**本番 ?memlog=1 で要確認**（出席連続入力時に heap が
     頭打ちになり `resource-exhausted` が出ないこと、`boardshare-publish` 回数が激減すること）。
   - 別件で観測された `BoardShareScreen` の `permission-denied`(snapshot listener)は配布ビューア側の
     購読エラーで今回のメモリ暴走とは別系統。未調査（Firestore rules 要確認の可能性）。

9. **「出席が溜まる教室で1編集が重い」対策＝過去週の凍結アーカイブ化（1.5.279）**:
   - **再診断(1.5.278 の ?memlog=1)**: boardShare publish の暴走は解消(`boardshare-publish`≒0〜1)。一方 heap は
     なお最大 **1159MB**。アイドルでも 262〜289MB と高い。**緑が丘は多数の週に出席を埋めている→週トリムが
     "出欠status週は必ず保持"のため効かず、巨大 weeks を常時保持**。1編集ごとに `board-sync-publish`(全週clone)
     ／署名再stringify／`autosave`(全clone)／日程popup再生成が走り、ピークは popup を開いた区間
     (`student/teacher-schedule-sync`)に集中。
   - **方針**: ユーザー選択=「過去週をメモリから退避(案A:凍結アーカイブ・安全)」。**素朴な物理退避は保存が
     boardStateRef.current.weeks をそのまま永続化するためデータ消失リスク**。そこで「**未変更週の参照を変えず、
     未変更(過去)週を再処理しない=構造共有＋メモ化**」で実現(ナビ/署名フォーマット/保存内容は不変・消失なし)。
   - **実装**:
     - `cloneWeek`(単一週) / `cloneWeeksForActiveWeek(weeks, activeWeekIndex)` 追加。出席/欠席/振無休/クリアの
       各 handler を **編集中の週だけ clone・他週は参照維持** に変更(全ハンドラ現在週のみ編集と確認済み)。
     - `applyClassroomAvailability` を **WeakMap で週単位メモ化**(入力週参照＋可用性設定token)。未変更週は前回結果を
       再利用し normalizedWeeks の全週再生成を回避。出力は読み取り専用利用(publishは別途cloneWeeks)で安全。
       `computeWeekAvailability` は従来 `normalizeWeeksDeskCount`＋可用性付与と等価(デスク数一致時は再利用)。
     - test 5件追加(構造共有・full clone フォールバック・メモ化同値/設定変化で再計算/休校日)。全237件 green。
   - **効果(見込み)**: 1編集の全週clone(handler)と全週availability再生成を除去。未変更の過去週はホットパスから外れる。
     ※ **board-sync-publish の `cloneWeeks(normalizedWeeks)` と autosave の全clone は今回未対応**(publishクローンの
       週単位共有は変異監査が必要なため保留)。**本番 ?memlog=1 で再測定**し、まだ高ければ次段で着手。
   - 注: local は firebase 無効。ローカルでは編集/Undo/週移動後編集の回帰のみ確認(出席→Undo→Redo、6/8週編集→Undo)。

10. **日程表popupを「常時同期→手動反映」化（1.5.280）**:
    - **再診断(1.5.279)**: ベースライン改善(アイドル 262→**179〜194MB**)。但し popup を開いたまま出席入力すると
      編集ごとの全日程再生成＋autosave で **931MB** まで跳ねる。ユーザー要望=「日程表は開いたまま、常時同期を
      やめ手動『最新反映』でよい(効果大の案)」。
    - **対策**: `App.tsx` の `boardState` 依存 effect(編集ごとに student/teacher/special popup を400msデバウンス再生成)
      から **3つの sync 呼び出しを撤去**(`__lessonScheduleBoardWeeks` の参照更新だけ残す)。これで盤面編集では
      日程表を再生成しない。範囲変更/設定変更時の同期(effect 3472/3476/3481/3486)は維持。
      - 確認: `syncStudent/TeacherSchedulePopup` の依存(`buildPopupBoardWeeksForRange` 含む)は `boardStateRef`
        ＝安定参照で、盤面編集では identity 不変 → 自動再同期は確実に停止。special popup のみ
        `suppressedRegularLessonOccurrences` 依存で出席確定時に再同期が残る(通常閉じているため許容)。
    - **手動反映UI**: `scheduleHtml.ts` の toolbar に「**盤面を反映**」ボタン(`schedule-refresh-board-button`)を追加。
      クリックで既存の `schedule-refresh-request`(App側 3136-) を opener へ postMessage → 最新盤面で再同期。
      押下中は「反映中…」表示。`all-view`(印刷用全員) は toolbar 無しのため対象外。
    - 注: local は firebase 無効＋popup は別ウィンドウのため、ローカルでは盤面編集/Undo/生徒日程popup起動の
      回帰のみ確認。**本番 ?memlog=1**で「両popupを開いたまま出席連続入力 → heap ピーク」を要再測定。
    - **次段候補(まだ高い場合)**: board-sync-publish の `cloneWeeks(全週)` と autosave 全clone の週単位共有
      (publishクローン変異監査が前提)、日程表の仮想化。

11. **日程表「常時同期停止」の取りこぼし修正＋ボタン統合＋localStorageミラー無効化（1.5.281）**:
    - **1.5.280 で同期が止まっていなかった真因**: `App.tsx` の effect(範囲・講習) が依存に持つ
      `ensureScheduleSubmissionTokens` の **deps に `boardState?.weeks` / `boardState?.suppressedRegularLessonOccurrences`**
      が入っており、出席編集のたびに identity が変わって effect が再発火 → 生徒/講師/講習popupを再同期していた。
      (1.5.280 で消したのは `boardState` 依存 effect の方だけだった。)
    - **修正**: `ensureScheduleSubmissionTokens` と `syncSpecialSessionPopup` を **boardStateRef 経由読み取り**にして
      deps から boardState を除去 → identity 安定化。これで盤面編集では popup 同期 effect が一切発火しない。
      **ローカル実測で確認**: 実編集(acted)時に `syncStudentSchedulePopup` 実行ログ・対象effectログとも0。
      範囲更新(=最新表示)では同期発火を確認。
    - **ボタン統合**: 前回追加の「盤面を反映」ボタンは撤去。`scheduleHtml.ts` の範囲適用ボタン「反映」を
      **「最新表示」にリネーム**(`setRangeAndRender`→`notifyRangeChange`→App側で範囲更新→最新盤面で再同期)。
      = 期間/生徒講師の絞り込み適用 と 盤面の最新取り込み を1ボタンに集約。
    - **localStorage ミラー無効化**: `writeWorkspaceToLocalStorageSync` を、一度 quota 超過したら以後
      このセッションでは書かない方式に(`workspaceLocalStorageMirrorDisabled`)。巨大教室では毎自動保存ごとに
      「全教室を JSON.stringify→setItem で quota 例外→破棄」していた巨大文字列生成を停止(正本は IndexedDB)。
    - 検証: 型/unit 237件 green。**本番 ?memlog=1 で両popup開いたままの出席連続入力時の heap 再測定が必要**。
    - **まだ高い場合の次段(未実施・要検討)**: ①autosave のデバウンス延長/対象教室のみの差分保存(現状は毎編集で
      全ワークスペースを IndexedDB へ structuredClone)、②board-sync-publish の `cloneWeeks(全週)` を週単位共有化
      (publishクローン変異監査が前提)、③日程表の仮想化。

12. **日程表 自動同期の“本当の出所”を停止（1.5.282）**:
    - **真因(これまで見落とし)**: 日程表popupの同期は **App 側だけでなく `ScheduleBoardScreen` 自身**にもあった。
      `ScheduleBoardScreen` の2つの useEffect が `syncStudentScheduleHtml`/`syncTeacherScheduleHtml` を**直接呼び**、
      依存配列に `studentScheduleCells`/`scheduleCountAdjustments`/`movingStudentContext`/`specialSessions` 等
      **編集で変わる値**を持っていたため、出席編集ごとに全日程を再生成していた(local/本番問わず)。
      App と Board が同一 popup window を両方同期する二重構造だった。
    - **修正(両系統をゲート)**:
      - App: `syncStudentSchedulePopup`/`syncTeacherSchedulePopup` に `force` 引数。`if(!force) return` で自動呼び出し
        (effect群)は no-op 化。`schedule-popup-ready`/`schedule-refresh-request`/`schedule-range-update`(最新表示)
        ハンドラのみ `force=true`(range-update は `rangeOverride` で state 反映待ちせず即同期)。
      - Board: 2つの sync effect の依存を **`[scheduleSyncTrigger]` だけ**に変更(eslint-disable明記)。`scheduleSyncTrigger` は
        `schedule-popup-ready`(開いた時)で +1。さらに `schedule-range-update`(最新表示)ハンドラでも +1 するよう追加。
        → 同期は「開いた時」と「最新表示」だけ。実行時に最新 cells をクロージャから読むので内容は最新。
    - **ローカル実測で確認**: popup を開いたまま出席編集 → `schedule-data-update` 送信 **0回**。`最新表示`(range-update)
      → 同期発火(現状 App+Board の二重=2回。手動時のみなので許容、将来 dedup 余地)。
    - 注: 初期表示は `openStudentScheduleHtml` がデータ込みで開くため、開いた直後も内容は出る。
    - **次段(まだ高い場合)**: ①autosave 頻度/差分化、②board-sync-publish の週単位clone共有、③最新表示の二重同期dedup。

## 現在の状態 / 未確認・次の一手
- **未確認(ユーザー検証待ち)**: 1.5.276 の popup デバウンス後に `?memlog=1` で日大前校を開き、講師・生徒日程表を両方開いて
  操作したときの **heap ピーク** と **`student-schedule-sync`/`teacher-schedule-sync` の回数**。
  デバウンスが効けばピークが大幅低下するはず。
- **まだ高い場合の次の一手**: 日程表popupは「全日程を描画した2枚」で定常 ~340MB を占める（機能上の描画）。
  さらに下げるなら **日程表の描画をページング/必要分のみ描画（仮想化）** が次の候補（挙動調整を伴うので要許可）。
  併せて、保持コピー削減（workspaceClassrooms の acting 教室分の重複保持、署名文字列のハッシュ化）も候補。
- **診断コードは残置**（`?memlog=1` の時だけ作動。通常はほぼノーコスト）。不要になれば削除可。

## 重要な落とし穴
- 署名3生成器のフォーマット一致を崩さない（ダーティ判定が壊れる）。
- 週bounding は **手動編集週を必ず保持**する設計（`weekHasManualBoardData`）。判定を緩めると消失リスク。
- 日程表popupは**同一オリジン window**なので `performance.memory` に描画分が合算される（mainタブ単体ではない）。
- `App.tsx` は約4,900行・`ScheduleBoardScreen.tsx` は約8,700行の巨大ファイル。早期returnは少ないがフック順序に注意。

## 主要ファイル
- `src/App.tsx` — ルート状態・保存/同期/署名・日程表popup同期・配布QR。
- `src/components/schedule-board/ScheduleBoardScreen.tsx` — 盤面本体・オーバーレイ・ツールバー描画。
- `src/components/schedule-board/{BoardGrid,BoardToolbar,CursorFollowPreview,boardWeekTrim}.tsx/.ts`
- `src/integrations/firebase/{workspaceStore,boardShare,adminFunctions,client,config}.ts`
- `src/utils/{useStableCallback,memoryDiagnostics}.ts`
- `functions/src/index.ts` — Cloud Functions（saveClassroomSnapshot 等）。
