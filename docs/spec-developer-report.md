# 仕様: 「開発者へ報告」ボタン（利用者からの不具合報告）

- 正本: この文書。実装は `src/utils/operationTrace.ts` / `src/utils/developerReport.ts` /
  `src/components/developer-report/DeveloperReportModal.tsx` / `functions/src/developerReport.ts`(＋`index.ts` の
  `submitDeveloperReport`) / `tools/developer-report-notify.mjs` / `.github/workflows/developer-reports.yml`。
- 決定日: 2026-09-04（オーナー指示）。背景: 室長から「この一ヶ月でバグがあったが忙しくて自分で対処した」と後から
  連絡があり、何が起きたか追えなかった。**忙しくてもボタン1つ・数秒で開発者へ知らせられる**導線を用意する。

## A. 目的と非目的

- 目的: 利用者が「おかしいな」と感じた瞬間に、**直近の操作履歴と画面のデータ**を開発者へ届け、
  バグ／仕様の誤解／勘違いを開発者側で切り分けられるようにする。
- 非目的: 全操作をサーバーへ常時記録すること（コストとノイズが見合わない。オーナー判断 2026-09-04）。
  本番での不変条件(INV)自己検査（オーナー判断で不要。報告が来たら開発者が検査する）。

## B. ボタンの位置と見え方（オーナー確定）

- **コマ表(盤面)**: ツールバーの「講師日程共有」の**右**に「開発者へ報告」。同じ形(secondary/slim)で**色だけ変える**
  (淡いオレンジ・`report-developer-button`)。テンプレ編集モードでは出さない（講師日程共有と同じ）。
- **日程表(別タブ・生徒/講師)**: ツールバーの「登録された講習期間を表示する」の**右**に「開発者へ報告」。
  同じ枠線ボタンで色だけ変える(`button.report-developer`)。印刷用全員表示(all-view)には出さない（ツールバー自体が無い）。
- 日程表は**操作せず表示だけ見て**「おかしい」と思うことがある。そのため日程表側のボタンは、その日程表で
  表示していた条件（種別・期間・講習期間ラベル・選択人物・検索語）を報告に添える。

## C. 送信内容（`submitDeveloperReport`）

| 項目 | 内容 | 出どころ |
|---|---|---|
| 任意の一言 | **空欄でも送れる**（上限 2000 字） | モーダルの textarea / 日程表は `prompt` |
| 直近の操作痕跡 | 端末内リングバッファの最新 300 件 | `operationTrace.ts`（§D） |
| 報告時点の教室データ | メモリ上の教室データ（**未保存の変更込み**）を gzip して Storage へ | `buildClassroomSnapshotPayload` |
| メタ | 教室・報告元(board/schedule)・アプリ版数・UA・URL・画面・未保存有無・最終保存時刻 | App |
| 実行者・受領時刻 | **サーバーが付ける**（自己申告にしない） | Cloud Function |

- 保存先: Firestore `workspaces/{ws}/developerReports/{reportId}`（メタ＋操作痕跡）、
  Storage `developer-reports/{ws}/{classroomId}/{reportId}.json.gz`（教室データ）。
- **本番データ（classroomSnapshots 等）には一切書かない。** 権限は保存と同じ `requireClassroomAccessMember`。
- 教室データの Storage 保存に失敗しても報告本体は残す（`snapshotStoragePath` 空・`snapshotByteLength=-1`）。

## D. 操作痕跡（端末内・全操作）

- 対象: 盤面が変わる全確定（`commitWeeks` の前後差分＝「日付 限 机番: 前 → 後」）、テンプレ反映(board-rebuild)、
  undo/redo、保存の成否、操作ログ(`operationLog.ts`)のイベントの写し、日程表など別タブからの postMessage、
  報告モーダルの開閉・送信結果。
- 保持: 教室ごとに最新 300 件をメモリ＋`localStorage`(`operation-trace:<classroomId>`)。再読み込みを跨いで残る。
- **報告ボタンが押されるまで端末外へ出ない。** 記録の失敗は本体の操作に影響させない（例外は握る）。
- 操作ログ（サーバー監査記録・在庫が減る/記録が消える操作だけ）とは別物。両者の種別一覧はサーバー
  `DEVELOPER_REPORT_TRACE_KINDS` と二重管理（テストで一致を固定）。

## E. 開発者が受け取る仕組み

- `.github/workflows/developer-reports.yml` が **15 分ごと**に `notifiedAt == null` の報告を Firestore REST で拾い、
  GitHub Issue を起票（ラベル `type:bug` / `status:triage` / `source:user-report`）→ `notifiedAt`・`issueNumber` を埋める。
  開発者は GitHub 通知（メール/アプリ）で受け取る。認証は既存 secret `RE_FIREBASE_SERVICE_ACCOUNT`。
- **公開リポジトリのため Issue 本文に操作痕跡（生徒名）・教室データは載せない。** メタ＋一言＋置き場所
  （Firestore 文書パス／Storage パスと取得コマンド）だけ。
- Firestore ルール: `developerReports` は開発者のみ read、write は不可（Cloud Function は Admin SDK で書く）。
  ルールの反映は `firebase deploy --only firestore:rules`（main マージでは反映されない）。

## F. 受け入れ条件（テストで固定）

- 一言なしで送れる（`parseScheduleDeveloperReportMessage` / `normalizeDeveloperReportNote`）。
- 操作痕跡は上限件数・上限文字数で切り、教室未登録なら記録しない（別教室混入防止）。
- 盤面差分は変わった机だけを列挙し、机に現れない付随変更（休日・在庫・補正）も名前で残す。
- サーバーは壊れた要素だけ捨てて残りを通し、`classroomId` は権限確認済みの値を使う。
- Issue 本文に生徒名（操作痕跡）・メールアドレスが載らない。起票→記録の順で二重起票を防ぐ。
- 日程表 HTML にボタンと送受信の両メッセージ種別が含まれ、埋め込みスクリプトが構文的に妥当。
