---
name: komahyou-save-architecture
description: コマ表アプリの保存フローの構造と再発バグの温床
metadata: 
  node_type: memory
  type: project
  originSessionId: ed97cb0a-f189-4c09-8c81-c926a180d2b9
---

コマ表アプリ(C:\Users\B\Desktop\自作ソフト\コマ表アプリ, React+Firebase)の保存アーキテクチャ:

- 手動「保存」ボタン → `saveBoard` (App.tsx) → ローカル保存(IndexedDB/localStorage) → `queueFirebaseWorkspaceSync` → `saveClassroomSnapshotViaFunction` → **Cloud Function `saveClassroomSnapshot`**(functions/src/index.ts)。リモート保存は Cloud Functions 経由に一本化(2026-06 のコミット 61128c6 で確定)。読込は `loadFirebaseWorkspaceSnapshot`(workspaceStore.ts)が split/inline/compressed 形式を読む。
- 全教室が同一の `saveClassroomSnapshot` を使う。かつての開発用教室専用 `saveDevelopmentClassroomSnapshot` 経路(関数側が単一ハードコードID `v8OZ7zH8vONNHjjYVcR1` しか受けず開発用教室の保存が必ず失敗していた)は撤去済み。`featureRollout` の `manualFirebaseSaveStability` は全教室適用(リトライ・即時進捗バー・失敗時バックアップ)。
- 未使用だった Firestore 直書き保存経路(`saveFirebaseWorkspaceSnapshot` ほか約430行)と保存診断ログ(`appendSaveDiagnostic`)は削除済み。
- 未保存判定は `dataSignature !== cleanSignature` の単純比較に簡素化済み(`cleanSignature` は `useLatestState` で state+ref 同期。旧 isDirty state/同期effect/skip・pending・token 各ref は廃止)。
- **盤面のダーティ追跡の罠(2026-06 コミット 5526c5f で対処)**: ScheduleBoardScreen はユーザー編集を `onBoardStateChange(state, {userInitiated:true})` で、オーバーレイ再計算を `{userInitiated:false}` で App に通知する。App の `handleBoardStateChange` は userInitiated:false のとき `markStateLoadedClean()` を呼ぶため、**ユーザー編集直後に走るオーバーレイ再計算が未保存編集をクリーン扱いに戻し**、`hasImmediateUnsavedBoardChanges`(=isBoardDirty)が false になる。本番では自動保存の `isRemoteSyncPending` で保存ボタンは「保存」表示になるが、`disabled={!isBoardDirty}` だったため無効化されクリックが効かなかった。対処: BoardToolbar で「保存待ち(hasPendingSave)がある限り押せる」+ クリック即時のローカル保存中状態でスピナー表示(親状態の伝播に依存しない)。根本(userInitiated:false の markStateLoadedClean)はオーバーレイ/ロード時挙動への影響が大きく未修正。

- **メモリ/パフォーマンス(2026-06 コミット 2c2e958)**: 実機計測で操作1回あたり「データ量の約250倍」の一時オブジェクトを確保していた。原因は (1) 盤面 `BoardGrid`(全セル)が React.memo されておらず、自動保存フラグ・進捗タイマー・ポインタプレビュー(ドラッグ中毎フレーム)等の無関係な親再描画でグリッド全体の vdom を毎回作り直していた、(2) 自動保存 effect が変更のたび(デバウンス前)に workspace 全体を deep clone + 全データ stringify していた、(3) 変更検知ガードで `dataSignature` を使わず `buildCurrentDataSignature()` を毎回呼び二重 stringify していた。対処: BoardGrid を memo 化し props を `useStableCallback`(src/utils/useStableCallback.ts)で安定化、自動保存の clone/stringify をデバウンス後に移動、ガードを `dataSignature` 再利用に変更。大量データ(スクールIE 日大前校)+ Edge 連続操作で GC が追いつかず 500MB 到達→クラッシュしていた症状への対処。さらなる軽量化候補: dataSignature の全データ stringify(編集毎)、ScheduleBoardScreen 非グリッド部の再描画、他パネルの memo 化。

- **配布用QR(boardShares)の不具合(2026-06 コミット 7d17ef1 / 7ad3147)**: (1) `classroomSettings.boardShareToken` がバックアップ復元や教室コピーで別教室へ複製され、複数教室が同一トークンで `boardShares/{token}` を上書き衝突→別教室データ表示。対処: `resolveBoardShareToken` を `classroomId__token` の冪等プレフィックスで一意化(`buildClassroomScopedBoardShareToken`)。Firestore doc ID は内部の二重 `__` は有効、前後が `__`(`__x__`)は予約で不可——エミュレータ確認済み。 (2) 週を多く蓄積した盤面で cells が Firestore 1ドキュメント上限(約1MiB)超過→`setDoc` サイレント失敗→「配布用盤面が見つかりません」。実測 10週で約574KB。対処: boardShare.ts で cells を gzip+base64 圧縮保存(実測 約8%)、読み取り側で復元、非圧縮の旧docも後方互換。`copyBoardDistributionUrl` は公開完了を await して失敗時はエラー表示(サイレント失敗で壊れたQRを配らない)。**注意: 修正後は各教室で配布用URLを再取得・再配布が必要**(旧QRは旧トークン/旧docを指す)。
- **盤面 weeks は週移動でprepend/append され無制限に蓄積する**(boardState.weeks)。メモリ肥大・配布ペイロード肥大・週移動の重さ(同期再計算)の根本。本番診断(?memlog=1)で「リークではなく巨大盤面の保持(~423MB)＋読込時の一時確保(~519MB)」と確定。
- **週bounding 実装(2026-06 コミット fa2a23b)**: `boardWeekTrim.ts` の `trimBoardWeeksForMemory` で「今日の前6週〜先26週＋手動編集のある週」だけ保持し、範囲外の未編集週(通常授業のみ=再生成で同一)を破棄。`weekHasManualBoardData` が手動痕跡(非regular生徒/manualAdded/makeup・move・special源/メモ/出欠status/手動講師/teacherAssignmentSource/lessonノート)を保守的に検出し編集週は必ず保持(ユニットテスト boardWeekTrim.test.ts)。トリムは applySnapshot / applyWorkspaceSnapshot(読込)と syncCurrentClassroomData(保存)で実施。読込時は clean署名をトリム後で計算し誤dirty回避、weekIndex は dateKey で再特定して補正。ライブ表示中の weeks は変更しない。suppressed/adjustments 等は週セル外で保持され破棄の影響なし。
- **本番メモリ診断**: `src/utils/memoryDiagnostics.ts`。`?memlog=1` or localStorage 'komahyou:memlog'='1' で作動。5秒ごとに heap と主要処理回数(delta)を console 出力。`bumpMemCounter` を App/ScheduleBoardScreen 要所に設置(無効時ほぼノーコスト)。
- **軽量化(2026-06 コミット 14c2ebe)**: (1) dataSignature をスライス別 useMemo に分割し編集スライスだけ再 stringify(3署名生成器は combineDataSignature/buildBoardDataForSignature/stringifySignaturePart で共通化、区切りは制御文字 。フォーマット不一致だとダーティ判定が壊れるので必ず共通化する)。 (2) カーソル追従プレビューを CursorFollowPreview.tsx に分離し、ドラッグ中 mousemove の全体再描画を停止。 (3) BoardToolbar を memo 化、関数 props は useStableCallback で安定化。BoardGrid は既に memo 済(コミット 2c2e958)。useStableCallback = src/utils/useStableCallback.ts(identity 固定+最新クロージャ実行)。

- **「保存し忘れ救済」(起動時の未保存ローカル書き戻し)は完全撤去(2026-07-07 オーナー決定・v1.5.405)**:
  旧実装は beforeunload/visibilitychange でマーカー(localStorage)を書き、次回起動時に
  ローカル残存データをサーバーより優先して黙って書き戻していた。7/6 本番障害(A3)の主因で、
  版数ゲート追加後も際どい相互作用(QR提出のサーバー側反映は版数を進めない等)が残ったため経路ごと削除。
  起動時は常にサーバー最新が正。維持: 閉じる前の未保存警告・タブ切替時の即時同期(A2+A1)・
  ローカル控え保存(IndexedDB)。回帰テスト「いかなる条件でも書き戻さない」(App.test.ts)を消さない。
  救済を再導入するなら必ず明示ダイアログで(黙った書き戻しは禁止)。

**Why:** 機能追加のたびに保存系の回帰が頻発していた原因は「複数の保存経路の併存」と「教室ごとの挙動分岐」。これらを解消済み。盤面はセル数が多くメモ化必須。オーナー方針: ユーザーが理解できない暗黙の自動補正より、明示的で帰責の明確な失敗の方がよい。
**How to apply:** 保存系を触るときは経路を増やさず Functions 一本化を維持する。起動時の書き戻し復活は禁止。[[komahyou-deploy]] [[komahyou-lecture-revert-2026-07-06-analysis]]
