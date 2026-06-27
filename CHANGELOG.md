# 更新リスト (CHANGELOG)

コマ表アプリの変更履歴。**編集ごとに必ず追記する**(回帰防止の記録)。
運用ルールは `.claude/skills/solo-git-workflow/SKILL.md` の「編集前チェックと更新リスト」を参照。

- バージョンは CI が main への push ごとに自動で patch +1 する。**手動で `package.json` を書き換えない。**
- 作業中は `## 未リリース` に1行ずつ追記する。
- main にマージ(= デプロイ)する直前に `## 未リリース` を、次にデプロイされる版
  (`= package.json の version の patch +1`)でラベル付けし、新しい空の `## 未リリース` を上に作る。
- 書式: `- <種別>: <何を・なぜ>`(種別 = `feat` / `fix` / `refactor` / `style` / `docs` / `chore`)。
  触ったファイル名や関連コミットIDを括弧で添えると後追いが速い。

---

## 未リリース

<!-- ここに編集内容を1行ずつ追記する。例:
- fix: 〇〇の不具合を修正(src/...・関連コミット xxxxxxx)
-->

## v1.5.336 (2026-06-27)

- fix(集団授業): 登録済み中3の集団参加(集団理科/集団社会)・オプションが、起動直後の購読反映で
  一括消失する回帰を恒久修正(本番データ消失。緑が丘5名・日大前2名が同一時刻に {} へ消失を確認)。
  原因は `reflectParentOwnedSubmissionFields`(src/utils/submissionReflection.ts)が空の提出ドキュメント
  ({}・v1.5.335 以前に室長登録した中3の doc は空のまま)で登録済みローカル値を上書き消失させていたため
  (購読 entry は常に `?? {}` で届くので `entry ?? existing` の保全が効かない)。反映を **union(追加のみ・
  削減しない)** に変更し、空 doc が既存を消さないようにした。この経路は countSubmitted=true(提出ロック済み)
  の生徒にだけ走るため保護者が QR で外すことはなく union で安全。これにより v1.5.335 以前の空 doc も
  再登録不要で自己修復する(次回読込で消えなくなる)。回帰防止テスト追加(submissionReflection.test.ts)。

## v1.5.335 (2026-06-27)

- fix(集団授業): 生徒日程表で室長が手動で集団参加をチェックして登録しても「最新表示」/再読込で
  集団参加が消える回帰を修正。原因は登録時に提出ドキュメント(lectureSubmissions)へ集団参加/オプションを
  書き戻しておらず、doc が空のまま購読の反映(doc→ローカル: reflectParentOwnedSubmissionFields)が
  室長の手動設定を空で上書きしていたため(登録解除→登録の経路では doc が空に戻るため特に再発)。
  `markLectureSubmissionDocAsSubmitted` に集団参加/オプションの書き戻しを追加し、生徒 count-save 経路で
  最新ローカル値を渡すよう変更。回帰防止テストを追加
  (src/integrations/firebase/lectureSubmission.ts・src/App.tsx・lectureSubmission.test.ts)。
  ※既に登録済みで集団参加が消えてしまった中3は、一度「登録解除」してから集団をチェックして再登録すると恒久反映される。

## v1.5.334 (2026-06-27)

- feat(生徒日程表): オプション欄機能(休み欄を削除し振替を左詰め＋2列5行のオプション欄/QR提出のチェック
  往復)を開発用教室限定から全教室へ公開。featureRollout の studentScheduleOptionField を
  development-only → all-classrooms に変更し、回帰防止テストを追加(オーナー指示 2026-06-27 /
  src/utils/featureRollout.ts)
  ※「未消化振替も同時に自動割り当て」は v1.5.331 で既に全教室公開済みのため追加変更なし。

## v1.5.333 (2026-06-27)

- style(QR提出ページ): Android の表示補正をオーナー指示で iOS と同じ 幅520+zoom0.7 に変更。ただし
  「出席不可コマの表は現状の全幅のまま」の要望に合わせ、Android のときだけ表(.sub-table-wrap)へ
  逆ズーム(1/zoom)を当てて全幅へ戻す(見出し/科目数/ボタン等の固定pxだけ 0.7 で縮む。iOS は従来どおり
  表も 0.7 のまま)。ネスト zoom+vw の挙動はブラウザ実測で全幅維持を確認
  (src/components/submission/iosViewport.ts・SubmissionPage.tsx)

## v1.5.332 (2026-06-27)

- style(生徒日程表): 振替欄が枠に収まらない問題に対応し、年と曜日を省いて月日+限だけに詰めて表示
  (compactMakeupSourceLabel/compactMakeupDateSlot 追加・講師日程表の振替欄も同様・埋め込みスクリプトの
  正規表現は二重エスケープ必須・回帰テスト追加 / src/utils/scheduleHtml.ts)
- style(QR提出ページ): オプション欄のチェック右の「なし/あり」テキストを削除(編集画面のみ。提出済み閲覧は
  状態表示として維持 / src/components/submission/SubmissionPage.tsx)
- fix(QR提出ページ): Android のボタン/文字が大きすぎる問題に対応。iOS と同じビューポート幅補正方式で
  Android も一様縮小(既定 ANDROID_VIEWPORT_WIDTH=480・vw化の撤回 c4563f6 を踏襲し固定px維持)。
  実機調整用に #/submit-debug をプラットフォーム判別対応にし Android 値も調整・表示
  (src/components/submission/iosViewport.ts・SubmissionPage.tsx・main.tsx)

## v1.5.331 (2026-06-27)

- feat: 未消化講習の自動割振モーダルに「未消化振替も同時に自動割り当てする」チェックボックス(既定OFF)を追加。ONにすると講習を全配置した後、同じ生徒の未消化振替を講習期間内の空きコマへ「振るい順(古い振替元から)」で同一規則で割り振る(src/components/schedule-board/ScheduleBoardScreen.tsx)。開発用教室で実機検証済み
- refactor: 講習・振替の自動割振候補探索を共有コア `findBestAutoAssignCandidate` に統一(規則ロジックの二重管理=ドリフトを防止)。講習側の出力スコアは従来と完全一致(回帰防止)
- test: `buildMakeupAutoAssignPendingItems`(振るい順展開・balance厳守)の単体テストを追加(src/components/schedule-board/ScheduleBoardScreen.test.ts)

## v1.5.330 (2026-06-27)

- docs: 更新リスト `CHANGELOG.md` を新規導入(編集ごとの記録ルールを明文化)
- docs: solo-git-workflow スキルに「編集前のデプロイ済み最新との同期確認」と「更新リスト記載義務」「コミット〜main マージの常時許可」を追記
- docs: CLAUDE.md に上記必須手順へのポインタを追加

---

> これ以前の履歴は git log の `chore(release): vX.Y.Z` コミットを参照
> (CHANGELOG 導入時点のデプロイ済み最新は v1.5.329)。
