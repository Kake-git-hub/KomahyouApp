---
name: komahyou-developer-report-button
description: 「要望・報告」ボタン(旧「開発者へ報告」・v1.5.490〜494・2026-09-04)の設計判断と運用。全操作は端末内だけに記録し報告時のみ送る(生徒名+ID付き)・内容必須・種類(不具合/要望/質問=v1.5.511)・盤面/日程表で同一モーダル・メール即時通知(Cloud Function・env REPORT_MAIL_*)+GitHub Actions定期Issue起票・#テストはIssue起票なし・LINEは不採用・受け取っても勝手に修正しない
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b6680ec-d412-4d9a-b0ce-af054a5db4dc
  modified: 2026-09-13T02:21:10.325Z
---

# 「開発者へ報告」ボタン（2026-09-04 オーナー指示・v1.5.490 で main マージ）

**きっかけ**: 室長から「この一ヶ月でバグがあったが忙しくて自分で対処した」と後から連絡。何が起きたか追えなかった。
オーナーの当初案は「一ヶ月限定で全操作をサーバー記録」。提案の結果、次で確定:

- **全操作の常時サーバー記録はしない**（コスト・ノイズが見合わない）。代わりに**端末内の全操作リングバッファ**
  (`src/utils/operationTrace.ts`・教室ごと最新300件・localStorage `operation-trace:<classroomId>`)を持ち、
  利用者が「開発者へ報告」を押した時だけ直近分＋報告時点の教室データ(未保存込み・gzip→Storage)を送る。
- **本番での INV 自己検査は不要**（オーナー判断: 報告が来たら開発者がチェックして回答する）。
- ボタン位置(オーナー確定): 盤面ツールバー「講師日程共有」の右／日程表タブ「登録された講習期間を表示する」の右。
  同じ形で色だけ変える(淡いオレンジ)。任意の一言は**空欄でも送れる**。
- 記録の集約点は `commitWeeks`（盤面が変わる全操作が通る・37 呼び出し）の前後差分要約 `summarizeWeeksDiff`。
  undo/redo・テンプレ反映・保存成否・操作ログ(`operationLog.ts`)の写し・別タブ postMessage も残す。
- サーバー: Cloud Function `submitDeveloperReport` → Firestore `workspaces/main/developerReports/{id}`＋
  Storage `developer-reports/{ws}/{classroomId}/{id}.json.gz`。本番データには書かない。
- 通知: `.github/workflows/developer-reports.yml`(15分ごと)が `notifiedAt==null` を Firestore REST で拾い
  GitHub Issue 起票(ラベル `source:user-report` を新設)。認証は既存 secret `RE_FIREBASE_SERVICE_ACCOUNT`
  (google-github-actions/auth の access_token)。**リポジトリは公開なので Issue に操作痕跡(生徒名)・教室データを
  載せない**（メタ＋一言＋置き場所のみ。テストで固定）。
- Firestore ルール `developerReports` は開発者 read のみ。ルールは main マージで反映されないので
  `firebase deploy --only firestore:rules` が別途必要(in-app 閲覧を作るまで実害なし)。
- functions デプロイは Actions「Deploy Cloud Functions」(functions/** 変更で自動発火)。関数が出るまで
  ボタンは「送れませんでした(not-found)」になる。

**同日の追加確定(v1.5.491〜493)**:
- 操作痕跡の生徒表記は「名前#生徒ID」(managedStudentId 優先・無ければ盤面 id)。誰の何がバグかを取り違えないため。
- **一言は必須**(「空欄のままでも送れます」は撤回)。盤面・日程表とも**同一表示・同一文言のモーダル**(文言正本
  `DEVELOPER_REPORT_UI_TEXT`・日程表 HTML へ生成時に埋め込む)。幅 820px・本文 17px・入力 7 行に拡大。
  日程表側は `.print-only-hidden{display:inline}` に負けて中央寄せが崩れたので複合セレクタで flex を勝たせている。
- **利用者報告 Issue(`source:user-report`)を見ても勝手に修正を始めない**。切り分け・整理までで止め、オーナーの
  許可後に dev-fix(CLAUDE.md 標準フロー冒頭・Issue 本文・仕様 §A/§E に明記)。
- LINE 通知: LINE Notify は 2025-03 終了のため Messaging API push。secrets `LINE_CHANNEL_ACCESS_TOKEN` /
  `LINE_NOTIFY_TO` をオーナーが設定したら有効(未設定なら Issue のみ)。手順は docs/runbooks/monitoring.md。
- App.tsx は git が -text(バイナリ)扱いの巨大ファイルで改行の自動正規化が効かない。python 等で書き戻すと LF 化して
  全行差分になる(v1.5.492 で発生→v1.5.493 で CRLF 復旧)。**App.tsx を書き換えたら CRLF に戻してからコミット**。

**v1.5.494 の追加確定(2026-09-04)**:
- ボタン名は **「要望・報告」**。種類ラジオ(不具合・おかしい／追加してほしい・要望、既定 bug)。Issue ラベルは type:bug / type:feature。
- **LINE は不採用**(Messaging API の取得条件が厳しくなったとオーナー判断)。代わりに **メール即時通知**: Cloud Function
  `notifyDeveloperReportByMail`(developerReports 作成トリガ・nodemailer)。env `REPORT_MAIL_SMTP_URL`(smtps://user%40gmail.com:アプリPW@smtp.gmail.com:465)
  と `REPORT_MAIL_TO` を functions/.env と repo secret `PROD_FUNCTIONS_ENV` に足して functions 再デプロイ(未設定なら mailSkipped)。
  オーナーが設定するまでメールは届かない。GitHub の通知設定は不要(Issue は課題管理の記録)。
- **`#テスト`**(または #test)を内容に含むとテスト扱い: サーバーが notifiedAt を即時に埋めて GitHub Issue を作らない。
  メールは【テスト】付き。結果文も「テストとして受け付けました」。
- 私的経路のメールには操作痕跡(直近60件・生徒名#ID)を載せる。公開 Issue には載せない(不変)。

**v1.5.495 の実機検証(2026-09-04 夜・3経路すべて成功)**:
- 盤面 / 生徒日程表 / 講師日程表 の3経路から `#テスト` 送信 → Firestore 文書＋Storage gz(各約428KB)が生成され、
  `isTest:true` / `notifySkipped:"test"` で **GitHub Issue は起票されない**ことを実データで確認。日程表からの2件は
  `scheduleContext.viewType` が student / teacher で正しく分かれる(source は両方 `schedule`、screen は `board`)。
- **メール通知の詰まり方(再発時の勘所)**: `PROD_FUNCTIONS_ENV` に手順書の例文をそのまま登録していたため、
  `REPORT_MAIL_SMTP_URL` のパスワード部が文字化けした `?` 14文字になり `@` も落ちて不正 URL 化 →
  `mailError: getaddrinfo EAI_AGAIN <オーナーのメール>`。実アプリパスワードを入れて再デプロイ後、`mailSentAt` が入り送信成功。
- **GitHub Secrets は書き込み専用で値を表示しない**(Update 画面の入力欄は登録済みでも常に空。空のまま保存すると
  `GOOGLE_DRIVE_*` ごと消えて Drive 同期が止まる)。値が正しいかの検証は
  `gcloud functions describe <fn> --region=asia-northeast1 --format=json` の `serviceConfig.environmentVariables` を見る。
- 旧テスト報告 Issue #60(v1.5.490 当時・`#` なし「テスト」)は「テストのためクローズ」済み。

**Why:** 「何が起きたか」だけでなく「いつ人がおかしいと感じたか」を拾わないとバグ/仕様誤解/勘違いの切り分けができない。
**How to apply:** 報告 Issue が来たら Firestore 文書の `recentOperations`(kind/summary 時系列)と Storage の教室データで再現し、
`bug-triage` → `dev-fix` の標準フローへ。仕様正本は `docs/spec-developer-report.md`。関連: [[komahyou-operation-log-and-lesson-ledger]]

**v1.5.511 の追加(2026-09-13・計画 Q-2)**:
- 種類に **「使い方の質問」(category = question)** を追加。3 種別は同じ流れ(送信→developerReports→メール→後で開発者が対応)で自動回答なし。
  質問を選んだときだけ「回答は開発者が確認してからお返しします(すぐには返りません・自動返信はしません)」の注意文が盤面 React モーダルと日程表埋め込みモーダルの両方に出る(`DEVELOPER_REPORT_UI_TEXT.questionNotice`)。
- メール件名は `【質問】`(テスト送信は `【テスト】【質問】` の順)、GitHub Issue はラベル `type:question`(リポジトリに作成済み・色 5319e7)・タイトル `[利用者質問]`。
- client↔server の種別一覧は両テストに同じ期待配列で固定(operationLog の作法)。仕様は `docs/spec-developer-report.md` §G(§G-3〜G-6 承認画面・返答通知・QA 公開と §H ダイジェストは未実装=計画 Q-3〜Q-6)。
