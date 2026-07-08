# 確定仕様：対話用日程表ビューの React 化 ＋ ドック/ポップアウト表示 — 正本

> 2026-07-08 オーナー確定。**リアルタイム同期（`spec-schedule-popup-realtime-sync.md`）と
> 日程表コマ組み（`spec-student-schedule-dnd.md`）の共通土台**。この2機能はこの土台の上に載る。
> 未実装。実装タスクは `docs/handoff-popup-sync-and-dnd.md`。

## A. 背景と決定

- 現状、対話用の生徒/講師日程表は **HTML文字列を生成して別タブに `document.write` する方式**
  （`src/utils/scheduleHtml.ts`・約5,900行・埋め込みJSはテンプレートリテラル内文字列・
  本体との通信は postMessage / 直接 window 参照）。この「別ドキュメント境界」が
  リアルタイム同期のメモリ対策・バージョンスキュー・埋め込みJSの実行時全停止・
  コマ組みD&Dの二重実装、すべての複雑さの発生源になっている。
- **決定（2026-07-08）**：staging では**対話用途の生成HTMLタブを React ビューへ置き換える**。
  対話用日程表を**本体アプリと同じ React ツリー**の中に持ち、表示形態だけを切り替える。
- **印刷／PDF は置き換えない**。全員表示（`openAllScheduleHtml`）・空フォーマット印刷などの
  印刷経路は現行の HTML 生成器を**そのまま残す**（当面「対話＝React／印刷＝HTML生成」の2経路併存）。

## B. 確定事項

| # | 論点 | 決定 |
|---|------|------|
| 1 | 対話用日程表の実体 | **本体と同一 React ツリーの React コンポーネント**（生成HTML＋document.write を置き換え）。 |
| 2 | 表示形態 | **ドック（画面内パネル）⇄ ポップアウト（別ウィンドウ）のトグル**。裏側は同一コンポーネント・同一コードパス。 |
| 3 | ポップアウトの実現 | **React portal を子ウィンドウに描く**：`window.open()` した子ウィンドウの `document.body` へ `createPortal` で描画。中身は同一 React ツリーのまま＝state・context を共有。 |
| 4 | A/Bテスト | ユーザー（教室スタッフ）が staging で**ドックと別ウィンドウの両方を実際に操作**し、どちらがよいか決める。トグルは常時見せる。 |
| 5 | 印刷／PDF | 現行 HTML 生成器（`openAllScheduleHtml` 等）を**維持**。置き換え対象外。 |
| 6 | 展開 | **staging 先行**。オーナーチェック合格まで本番へ出さない。本番展開形は合格後に決める。 |

## C. アーキテクチャ

### C-1. ポップアウト（React portal → 子ウィンドウ）

- 「別ウィンドウで開く」操作で `window.open('', name)` を行い、返った子ウィンドウへ
  `ReactDOM.createPortal(<ScheduleView .../>, childWindow.document.body)` で描画する。
- portal の中身は**親と同じ React ツリーの一部**なので、盤面 state・context・イベントハンドラを
  そのまま共有する（postMessage 不要・シリアライズ境界なし・バージョンスキューなし）。
- **スタイル移送**：このアプリは素の CSS（`index.css` / `App.css`・CSS-in-JS 不使用）。
  子ウィンドウを開いたら親 `document.head` の `<style>` / `<link rel=stylesheet>` を
  子 `document.head` へ複製する（動的追加分にも追随する場合は MutationObserver で反映）。
- **ライフサイクル**：子ウィンドウの open/closed を state で管理し、`beforeunload`/`closed` 検知で
  portal を破棄。閉→再オープン、親リロード時の子ウィンドウ孤児化、フォーカス移動を扱う。
- 既存の**2つ目 React エントリ `src/share-main.tsx`（講師日程共有）**が別コンテキスト描画の前例。

### C-2. ドック（画面内パネル）

- 同じ `ScheduleView` を本体レイアウト内のパネル/ドロワー/分割ペインとして描画するだけ。
- ドック ⇄ ポップアウトの切替は「どの DOM コンテナへ portal するか」の差でしかない
  （本体内コンテナ or 子ウィンドウ body）。**コンポーネントと state は共通**。

### C-3. データの供給

- `ScheduleView` は生成HTMLのペイロード（`SchedulePayload`）ではなく、**盤面 state を直接
  参照**して表示データを算出する。表示用の算出は既存の純関数
  （`buildScheduleCellsForRange` / `serializeCells` 由来のロジック・`scheduleHtml.ts` の
  `build*Payload` 相当）を**純関数として切り出して共有**し、React 側と印刷HTML側の双方から使う
  （表示の二重定義を避ける）。

## D. これで解消されること（2機能への波及）

- **リアルタイム同期**：同一 React ツリーなので盤面 state が変われば自動で再レンダー＝
  自動反映。postMessage・デバウンス送信・フィンガープリント・バージョンスキュー対策・
  再オープン要求といった旧設計の機構は**対話用ビューでは不要**になる
  （詳細と移行は `spec-schedule-popup-realtime-sync.md` の改訂版 §0）。
- **日程表コマ組み（D&D）**：ポップアウト先も同一ツリーなので、**実盤面の
  `executeMoveStudent` を直接呼べる**。埋め込みJSでのD&D再実装・移動要求メッセージ・
  受信側再検証は不要（詳細は `spec-student-schedule-dnd.md` の改訂版）。

## E. メモリ規律（最重要・旧デバウンス対策の置き換え）

⚠️ **React 化は「毎編集で全量HTML生成」問題を消すが、油断すると別の形で再発する。**
日程表ビューは大きい（全生徒 × 複数週）。これを1つの巨大 React サブツリーにして盤面の
1キーストロークごとに全再レンダーすると、2026-06-05 のメモリ障害と**同じ症状を React で再現**する。

必須要件：
- 生徒行/講師行コンポーネントを **`React.memo`＋安定 id key** で分割し、変更行だけ再レンダー。
- 表示データは **`useMemo`（安定 deps）** で算出。毎レンダーで巨大配列/オブジェクトを作らない。
- 必要なら表示範囲の**仮想化（ウィンドウ化）**。
- （旧 `komahyou-perf-multi-rule-optimization` の教訓：useMemo deps に関数 identity を入れて
  毎レンダー全再計算、を繰り返さない。）

## F. 移行と回帰ガード（厳守）

- 生成HTML関数（`openStudentScheduleHtml` / `openTeacherScheduleHtml` / `createScheduleHtml` /
  `sync*ScheduleHtml` / 埋め込みJS / postMessage）は **印刷／PDF用途として残す**。
  **一括削除しない**（印刷が依存）。対話用途の呼び出しだけを React ビューへ差し替える。
- `App.tsx` の force ゲート同期機構（`syncStudentSchedulePopup` の `if (!force) return` 等）・
  `ScheduleBoardScreen.tsx` の `scheduleSyncTrigger` 依存 effect は、**対話が React に完全移行し
  印刷が独立と確認できるまで剥がさない**。staging 段階では React ビュー（staging 環境判定で有効化）と
  旧生成HTML経路が**併存**しうる。どちらかを消す判断はオーナーチェック合格後。
- 2026-06-05 メモリ障害の記録（`spec-schedule-popup-realtime-sync.md` §D）は**歴史的記録として保持**。
  React 版でも §E の規律で同種の再発を防ぐ。
- regression-reviewer に「印刷経路を壊していないか」「force ゲート等を早まって削っていないか」を
  必ず検査させる。

## G. 受け入れ条件

1. 「別ウィンドウで開く」で生徒日程が別ウィンドウに出て、別モニターへ移動できる。スタイルが崩れない。
2. 「画面内に戻す」でドック表示に戻る。逆トグルも動く。表示中の期間・絞り込みが保持される。
3. ドック・ポップアウトのどちらでも、盤面編集が**追加操作なしで即反映**される（同一ツリー）。
4. ドックとポップアウトを両方出したまま盤面を連続20回以上編集しても heap が単調増加しない
   （§E のメモリ規律・`?memlog` と DevTools で実測）。
5. 子ウィンドウを閉じても本体は正常（portal 破棄・リーク無し）。親リロードで子が孤児化しない。
6. **印刷／PDF（全員表示・空フォーマット印刷）が従来どおり動く**（HTML生成経路を壊していない）。
7. staging 環境判定でのみ React 対話ビューが有効。本番3教室は影響ゼロ。

## H. メリット・デメリット

**メリット**
- リアルタイム同期・コマ組みD&Dの**両方がほぼタダ**になり、旧設計の複雑機構が不要。
- バージョンスキュー・埋め込みJSの実行時全停止という**本番エラー源が構造的に消える**。
- 別モニター運用（ポップアウト）と1画面運用（ドック）を**同一コードで両方**提供でき、
  ユーザーが実機で選べる。

**デメリット・リスク**
- 対話用日程表ビューの **React 作り直し**（規模大）。印刷HTML生成は残すため当面2経路併存。
- 子ウィンドウへのスタイル移送・ライフサイクル管理という定番だが手当ての要る実装。
- §E を怠ると React でメモリ障害が再発する（要メモ化・要実測）。
- 表示ロジックを純関数として共有しないと React 版と印刷HTML版で表示がズレる。

## I. 本番環境への影響範囲

- **データモデル・Firestore・Cloud Functions への変更なし**。保存経路不変。
- 触るのはフロントのみ。新規 React ビュー、`featureRollout.ts`（staging 環境判定）、
  盤面/Appからのビュー起動配線。生成HTML（`scheduleHtml.ts`）は印刷用に残置。
- staging 先行のため、オーナーチェック合格まで本番影響ゼロ。合格後の展開形は別途決定。
