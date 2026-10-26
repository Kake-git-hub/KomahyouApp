---
name: komahyou-dev-verification-checklist
description: 開発用教室だけに出る最前面「確認リスト」パネル(v1.5.503〜・第5版 v1.5.509)。オーナーが実機で OK/要改善+メモを書き「保存して送信」→ 要望・報告経路で developerReports に蓄積 → tools/verification-checklist-report.mjs で読み取り、まとめて修正する運用
metadata: 
  node_type: memory
  type: project
  originSessionId: cdfc998b-e831-4045-9d74-e2fdf9306541
  modified: 2026-09-14T22:34:23.852Z
---

# 開発用教室の「確認リスト」パネル（v1.5.503・2026-09-12 本番反映）

- **表示**: `App.tsx` で `isActingDevelopmentClassroom ? <VerificationChecklistPanel/> : null`（本番教室ではマウントしない・source-scan テストで固定）。右下 fixed・折りたたみ可・`@media print` 非表示。
- **項目定義の正本**: `src/utils/verificationChecklist.ts` の `VERIFICATION_CHECKLIST`（version と items）。**リリースごとに項目と version を差し替える**（初版 `v1.5.502`: U-0×5／盤面PDF×7／講習履歴×7）。
- **下書き**: localStorage `verification-checklist:<classroomId>:<version>`。教室切替は `key={actingClassroomId}` で再マウント。
- **送信**: 「保存して送信」→ 既存 `submitDeveloperReport`（source:'board', category:'request'）→ CF `submitDeveloperReport` → `developerReports` に記録のみ。**v1.5.517 からメール通知も Issue 起票もしない**(オーナー指示 2026-09-13「必ず修正するので通知不要」・サーバーが開発用教室×先頭マーカーで `isVerificationChecklist` 判定)。本文先頭は固定マーカー `[確認リスト vX.Y.Z]`（2000 字超は `(i/n)` 分割）。生徒名は入れない。
- **読み取り（まとめて修正する入口）**: `node tools/verification-checklist-report.mjs [--since YYYY-MM-DD] [--version vX.Y.Z] [--json]`（Firestore GET のみ・gcloud ログイン済み PC・Windows は shell 経由）。要改善を先に、項目 id ごとに最新結果を表示。

- **1周目の実績（v1.5.502 結果 → v1.5.504 で修正・2026-09-12）**: 要改善 6 件（p-1 日曜も候補＋教室別に選択記憶／p-2 講師名・席番号のサイズ追従＋ファイル名／p-3 3文字講師名の見切れ／p-6「集団」横書き／h-1 ボタン名→「通常授業履歴」／h-2 表示で開始日が書き換わる）。修正後は項目版を `v1.5.504` 第2版に差し替え（p-8/p-9/p-10 追加）。
  - h-2 は静的に原因を特定できず、「期間正規化(逆転入れ替え/366日丸め)の結果を入力欄へ書き戻す」設計そのものを止める形で対処（入力欄不変・逆転は理由表示・表示期間を注記に出す）。再発報告があれば h-2 の再確認から。
  - p-2 の「空席でもサイズは小さくしないで」は意味を確定できず、レイアウト倍率（`resolveBoardPrintLayoutRelief`）を内容に依らず一様に当てる設計で解釈対応。要改善が続くならオーナーに具体例を聞く。

- **2周目(v1.5.504 結果 → v1.5.506)**: p-2/p-3 行高さ揃え(内側固定)・h-2 INTERNAL(台帳クエリ文書ID降順→dateKey降順)・スピナー。第3版から**前回 OK の項目は載せない**運用。
- **3周目(v1.5.506 結果 → v1.5.508・2026-09-13)**: p-2/p-3「文字が大きすぎてセルからはみ出る」。真因＝内側を固定高さにしたら flex の子が flex-shrink で押し潰され scrollHeight が伸びず、はみ出し判定が効かなかった(第2版修正の副作用)。子 flex-shrink:0 ＋ `studentInnerContentOverflows`(子の高さ合計 vs 固定高さ・`data-pdf-locked-height` 付きのみ)。実ブラウザで裏取り(dev サーバーに一時 HTML を置いて計測・修正前 scrollH=clientH=58)。第4版は p-2/p-3 のみ。
  - 教訓: PDF レイアウトの修正は jsdom テストだけでは寸法バグを検出できない。オーナーの添付 PDF は pypdfium2 で PNG 化して読む(pdftoppm 無し)。書式テストは固定の FIXTURE_ITEMS に切り替え済み(版ごとの項目変更で壊れない)。

- **4周目(v1.5.508 結果 → v1.5.509・2026-09-13)**: p-3「講師名が大きすぎて見切れ」+メモ「講師未割り当ては空白でよい」。真因＝講師名の判定が td(padding込み56px)幅 vs scrollWidth で、ボックス自身は50px・中央寄せflexの左はみ出しは scrollWidth に載らない → `singleLineTextOverflows`(Range で文字幅を測りボックス clientWidth と比較)。メモの正体は集団行の CSS ::before「＋ 科目を選択」ガイドが紙に出ていたこと → `clearGroupSubjectPlaceholdersForPdf`(全選択も空白化)。第5版は p-3 再確認 + p-12。
  - 再現手順の型: `public/__xxx.html` に App.css と /node_modules/html2canvas を読み込む検証ページを一時的に置き、dev サーバー(launch.json「dev」)で開いて DOM 計測＋html2canvas 描画を確認 → 検証後にファイル削除。PDF 系の寸法バグはこれで毎回裏取りする。

- **v1.5.517(2026-09-13)**: 「テキストが入力できない」指摘。ローカル(dev-local で判定を一時的に真にして)では textarea への入力は再現せず、要改善を選ぶまでメモ欄が出ない設計が原因と判断 → メモ欄を全項目に常時表示＋未確認でメモを書くと要改善へ(`setVerificationChecklistMemo`)。**再発報告があれば、どの画面・どの欄・IME かを聞く**(別原因の可能性は残る)。

- **6周目(v1.5.512 保護者QR k-1〜k-9 結果 → v1.5.518・2026-09-14)**: 要改善 k-4/k-5 のみ(月単位表示・移動は前後1か月・授業のある日だけ・教室休みは出す・講習も具体的に)。質問で確定: 教室休みは holidayDates だけ／**講習は講習提出QRで確認する形式なので保護者QRは講習期間中も通常授業だけ**。第7版は k-4/k-5 のみ。メモ欄テストは特定 id 依存をやめ先頭項目で検証(版替えで壊れない)。
- **7周目(v1.5.518 結果 → v1.5.519・2026-09-14)**: k-5 OK・k-4「前の月の出席データが出ず休みの日しか出ない」。開発用教室スナップショットを REST GET→gunzip し、`node` で parentSchedule.ts を直接実行(Node24 は型除去で .ts を import 可)して生徒別に再計算 → 生徒(s136・8/26入塾)の8月は**講習コマだけ**で仕様どおり非表示だった(バグではなく仕様の見え方)。オーナー回答「講習は出さず注記」「講習も無い月は今のまま」→ `hasLectureLessons` 真偽値＋`resolveParentScheduleMonthNotice`。第8版は k-4 のみ。
  - 教訓: 「データが出ない」系はまず実データで再計算して、バグか仕様の見え方かを切り分ける。QR トークン一覧は `studentPortalTokens` を classroomId で runQuery。

- **8周目(v1.5.519 結果 → v1.5.521・2026-09-14)**: 項目は全部 OK だったが**「その他」欄に要望が溜まっていた**。真因＝アプリは `- その他: …` の1行で送るのに、読み取りツールは「その他の気づき:」見出し形式しか読まず**黙って落としていた**(v1.5.512/518 のその他要望=QRスピナー・テンプレ作成ボタン位置が未対応のまま)。ツール修正＋5件対応(保護者QR 1コマ1行/振替元・振替先の月日コマ/通常授業履歴の既定=今月・日付変更で再読込・記録開始前の月は直後の台帳から絞る/未保存生徒のQRはスピナー/ボタン移動)。第9版 k-10/k-11/k-12/h-9/b-1。
  - 教訓: **確認リストの読み取りは項目結果だけでなく「その他」も必ず見る**(ツールが出さなければ developerReports の note を直接読む)。「全部 OK」で終わらせない。
  - 教訓: 作業ディレクトリは**他セッションと共有**されうる。作業中に別セッションが main を checkout/merge し、自分の未コミット変更が main 上に乗った(push 前に気付き、ブランチへ移し rebase＋版ラベルを1つ繰り上げて解決)。コミット前に `git branch --show-current` を確認する。

- **9周目(v1.5.521 結果 → v1.5.526・2026-09-14)**: k-11「休みの日の行が出ない」＝丸ごと振替(振替元の机を空にするだけ)とドラッグ移動(振替元は moved=非表示)で振替元に absent が無い → 振替先の makeupSourceDate/Label から逆引きして補う。k-12 スピナー不可視＝App.css 後方の共通 .button-spinner が白線。その他「通常授業履歴の振替元列を状態欄へ」→ 台帳トークンに |振替元日|振替元限 を4状態とも追加＋サーバーで突き合わせ(statusText)。第10版 k-11/k-12/h-10。
  - 教訓: 実データ probe で desks は `lesson.studentSlots`(desk.studentSlots ではない)。parentSchedule を新旧2版で全生徒×月 diff すると副作用が一目で分かる。「休み⇄振替先」の計算が lessonLinks / parentSchedule / lessonHistory(+functions) の3系統に分散(レビュー B-4・一元化は未着手)。

- **10周目(v1.5.526 結果 → v1.5.527・2026-09-15)**: 項目は全 OK・その他「退塾ボタンは押した瞬間に非表示に(退塾日は前日)」。前日付けだと盤面/請求/保護者QRも今日から非在籍になる懸案を提示 → オーナーは「今日付けのまま一覧だけ即非表示」を選択。`isStudentInWithdrawnRosterList`(退塾日=今日も非在籍一覧)を生徒一覧の振り分けだけに使い、resolveManagedRosterStatus は不変(講師・削除可否・学年列は当日在籍のまま＝削除ボタンは翌日から)。第11版 b-2。

**Why:** オーナーが staging/開発用教室で操作しながら確認結果を書き残し、Claude が後でまとめて直す運用にしたいという指示（2026-09-12）。
**How to apply:** 新機能や修正を開発用教室で検証してもらう時は、`VERIFICATION_CHECKLIST` に項目を追加して version を上げ、確認後にツールで読み取って修正へ。本番教室に出す機能ではない。関連: [[komahyou-developer-report-button]] [[komahyou-plan-2026-09-11-five-requests]]
