# セッション引き継ぎメモ（2026-06）

新しいチャットはまずこのファイルを読んでください。直近の作業文脈・現状・次の一手をまとめています。

## プロジェクト概要 / 環境
- コマ表アプリ（講習＋通常授業の運用管理）。React + TypeScript + Vite + Firebase。
- 本番: Firebase Hosting `https://komahyouapp-prod.web.app`（= `firebaseapp.com` も同一プロジェクト）。
- `.env.local`: `VITE_EXTERNAL_BACKEND_MODE=firebase` / `VITE_FIREBASE_ENABLE_FUNCTIONS=true`（Blaze）/ workspaceKey=`main`。
- リモート保存は **Cloud Functions 経由に一本化**（`saveClassroomSnapshot`）。読込は `workspaceStore.ts` の `loadFirebaseWorkspaceSnapshot`。
- 現行バージョン: **1.5.276**（`package.json`）。

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
