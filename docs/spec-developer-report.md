# 仕様: 「要望・報告」ボタン（利用者からの不具合報告・追加要望。旧称「開発者へ報告」）

- 正本: この文書。実装は `src/utils/operationTrace.ts` / `src/utils/developerReport.ts` /
  `src/components/developer-report/DeveloperReportModal.tsx` / `functions/src/developerReport.ts`(＋`index.ts` の
  `submitDeveloperReport`) / `tools/developer-report-notify.mjs` / `.github/workflows/developer-reports.yml`。
- 決定日: 2026-09-04（オーナー指示）。背景: 室長から「この一ヶ月でバグがあったが忙しくて自分で対処した」と後から
  連絡があり、何が起きたか追えなかった。**忙しくてもボタン1つ・数秒で開発者へ知らせられる**導線を用意する。

## A. 目的と非目的

- 目的: 利用者が「おかしいな」と感じた瞬間に、**直近の操作履歴と画面のデータ**を開発者へ届け、
  バグ／仕様の誤解／勘違いを開発者側で切り分けられるようにする。
- **受け取った後の進め方（オーナー指示 2026-09-04・厳守）**: 利用者報告 Issue を見ても**勝手に修正を始めない**。
  調査・整理までは進めてよいが、コード修正への着手はオーナーが確認して許可してから。
- 非目的: 全操作をサーバーへ常時記録すること（コストとノイズが見合わない。オーナー判断 2026-09-04）。
  本番での不変条件(INV)自己検査（オーナー判断で不要。報告が来たら開発者が検査する）。

## B. ボタンの位置と見え方（オーナー確定）

- ボタン名は **「要望・報告」**（オーナー確定 2026-09-04。不具合だけでなく追加要望も同じ導線で送る）。
- **コマ表(盤面)**: ツールバーの「講師日程共有」の**右**に「要望・報告」。同じ形(secondary/slim)で**色だけ変える**
  (淡いオレンジ・`report-developer-button`)。テンプレ編集モードでは出さない（講師日程共有と同じ）。
- **日程表(別タブ・生徒/講師)**: ツールバーの「登録された講習期間を表示する」の**右**に「要望・報告」。
  同じ枠線ボタンで色だけ変える(`button.report-developer`)。印刷用全員表示(all-view)には出さない（ツールバー自体が無い）。
- 日程表は**操作せず表示だけ見て**「おかしい」と思うことがある。そのため日程表側のボタンは、その日程表で
  表示していた条件（種別・期間・講習期間ラベル・選択人物・検索語）を報告に添える。
- **モーダルは盤面・日程表で同一の表示・文言**（オーナー指示 2026-09-04）。文言の正本は
  `DEVELOPER_REPORT_UI_TEXT`（`src/utils/developerReport.ts`）で、日程表 HTML の埋め込みスクリプトへ生成時に埋め込む。
  大きく読みやすく（幅 820px・本文 17px・入力欄 7 行）。一言が空なら送信せず「一言を入力してください」と促す。

## C. 送信内容（`submitDeveloperReport`）

| 項目 | 内容 | 出どころ |
|---|---|---|
| 種類 | 不具合・おかしい(bug) ／ 追加してほしい・要望(request)。既定は bug | 同一モーダルのラジオ |
| 内容 | **必須**（2026-09-04 改定・空欄は送れない。上限 2000 字） | 盤面・日程表とも同一モーダルの textarea |
| テスト扱い | 内容に `#テスト`（または `#test`）を含むと **Issue を起票しない**（`notifiedAt` を即時に埋める）。メールは【テスト】付きで届く | サーバーが判定 |
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

- **メール即時通知（オーナー要望 2026-09-04・LINE の代替）**: Cloud Function `notifyDeveloperReportByMail` が
  `developerReports` 文書の作成をトリガに SMTP で送る。私的経路なので操作痕跡（直近 60 件・生徒名を含む）も本文に載せる。
  設定は functions runtime env（ローカル `functions/.env`・CI は repo secret `PROD_FUNCTIONS_ENV`）の
  `REPORT_MAIL_SMTP_URL`（例: `smtps://you%40gmail.com:アプリパスワード@smtp.gmail.com:465`）と `REPORT_MAIL_TO`
  （任意 `REPORT_MAIL_FROM`）。未設定なら送らず `mailSkipped` を記録。成否は文書の `mailSentAt` / `mailError`。
  手順は `docs/runbooks/monitoring.md`。**GitHub の通知設定は不要**（Issue はあくまで課題管理の記録）。

- `.github/workflows/developer-reports.yml` が **15 分ごと**に `notifiedAt == null` の報告を Firestore REST で拾い、
  GitHub Issue を起票（ラベル `type:bug` / `status:triage` / `source:user-report`）→ `notifiedAt`・`issueNumber` を埋める。
  開発者は GitHub 通知（メール/アプリ）で受け取る。認証は既存 secret `RE_FIREBASE_SERVICE_ACCOUNT`。
- **公開リポジトリのため Issue 本文に操作痕跡（生徒名）・教室データは載せない。** メタ＋一言＋置き場所
  （Firestore 文書パス／Storage パスと取得コマンド）だけ。Issue 本文にも「勝手に修正を始めない・許可後に着手」を明記。
- LINE 通知は **不採用**（オーナー判断 2026-09-04: Messaging API の取得条件が厳しくなったため。メール直送へ置換）。
- Issue のラベルは種類で変える: bug → `type:bug`、request → `type:feature`（共通 `status:triage` / `source:user-report`）。
- Firestore ルール: `developerReports` は開発者のみ read、write は不可（Cloud Function は Admin SDK で書く）。
  ルールの反映は `firebase deploy --only firestore:rules`（main マージでは反映されない）。

## F. 受け入れ条件（テストで固定）

- 一言が空なら盤面・日程表とも送れない（`validateDeveloperReportNote`。本体側でも日程表経由の空文を弾く）。
- 操作痕跡は上限件数・上限文字数で切り、教室未登録なら記録しない（別教室混入防止）。
- 盤面差分は変わった机だけを列挙し、机に現れない付随変更（休日・在庫・補正）も名前で残す。
- サーバーは壊れた要素だけ捨てて残りを通し、`classroomId` は権限確認済みの値を使う。
- Issue 本文に生徒名（操作痕跡）・メールアドレスが載らない。起票→記録の順で二重起票を防ぐ。
- 日程表 HTML にボタンと送受信の両メッセージ種別が含まれ、埋め込みスクリプトが構文的に妥当。
