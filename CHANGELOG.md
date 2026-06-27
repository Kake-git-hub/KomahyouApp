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
