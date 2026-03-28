# コマ表アプリ

講習と通常授業を同じ運用画面で扱うための管理アプリです。既存の LessonScheduleTable には手を加えず、別プロジェクトとしてコマ表中心に育てています。

## 現在の方針

- 初期利用者はアプリ開発者と管理者(室長)のみ
- 認証方式確定前はローカルの仮ログインで、開発者と各教室管理者の導線を先に固める
- PC 前提のクローズドな管理アプリとして開始
- 通常授業、休日、振替、再調整を優先して実装
- 講師、生徒、保護者向けの共有や通知は後続フェーズ
- UI はコマ表画面を基本画面にして、短い確認サイクルで修正を回す

## 現在の実装状況

現時点では、仮データ中心ながら日常運用を意識した主要導線まで入っています。

- コマ表画面
- コマ詳細パネル
- 振替ストックの自動計算と手動操作
- 通常残 / 未解決一覧
- 基本データ画面: 講師、生徒、通常授業、各種期間設定
- 講習データ画面
- デバッグコピーと報告テンプレートコピー
- PDF 出力
- 生徒日程表 / 講師日程表の別タブ出力
- ローカル自動保存とバックアップ JSON の書き出し / 復元
- 開発者画面での教室編集、利用中 / 停止中の切り替え、管理者アカウント編集
- ローカル運用または Functions 有効時は開発者画面で教室追加 / 削除も可能
- 管理者は割り当てられた教室だけ開けて、停止中は停止画面のみ表示
- 本番環境のアプリ起点 URL は `https://komahyouapp-prod.web.app/` を使う
- 日程表QRは `テスト教室2` の校舎名入力時のみ表示し、既定では `https://kake-git-hub.github.io/LessonScheduleTable` の `0002 / 2026-spring` に向ける
- 既存の `/KomahyouApp/...` 転送経路は互換性のため残しているが、通常運用では使わない
- 通常授業 / 通常振替 / 通常代行 / 講習 / 注意付きの色分け
- 日程表 popup では校舎名とロゴを生徒日程 / 講師日程で共有する
- 日程表 popup の講習関連文言は `講習` に統一し、更新ボタンは持たない

## 現在の運用ルール

- 手動追加した生徒は振替ストックにカウントしない
- 手動追加や講師未設定の警告は生徒ごとに表示する
- 通常授業の `月 4 回` は月内上限を意味し、開始 / 終了が月途中なら残っている通常授業週数分だけ配置する
- 5 週ある月だけ 5 回目以降の生徒配置を止め、通常授業期間中の講師枠は祝日 / 休校日以外で残す
- 契約回数ルールの詳細は `docs/regular-lesson-contract-rule.md` を正本として扱う
- 振替ストックはコマ表操作後も開いたまま維持する
- 振替授業を再度ストックへ戻すときは、元の通常授業基準で残数比較する
- 振替中 / 移動中に同コマへ同じ生徒がすでにいる場合は配置を拒否し、選択状態を維持する
- 日付入力の解除は専用の未入力ボタンではなく、カレンダー操作側で行う
- 管理データ由来の通常授業には不要なヒントを出さない
- 日程表タブの開始日 / 終了日は入力時点で即反映し、講習期間セレクターは開始日順に並べる
- 通常授業を振替ストックへ回しただけの未割当分は日程表に表示せず、実際に割り振られた振替だけを表示する
- 生徒日程の通常回数は `actual` と `planned` を分けて集計し、未消化の stock 送りは希望数を減らさず予定数だけ差分として扱う
- 通常回数の警告スタンプは通常回数表の直下、講習回数の警告スタンプは講習回数表の直下に表示する
- 生徒日程の `算` と `数` は学年に応じて片方だけ表示する
	- 小学生: `算`
	- 中学生以上: `数`
- IndexedDB を優先し、利用不可時は localStorage にフォールバックしてアプリ全体のスナップショットを自動保存する
- 教室ごとのデータを含むワークスペース状態もローカル保存し、第三者認証やDBは未確定のまま画面運用を先に検証する
- 同一ブラウザ内の別タブで保存が発生した場合は BroadcastChannel で最新スナップショットを取り込む
- `.env` に Firebase 接続情報を入れると、Email/Password 認証と教室単位の外部 DB 同期へ切り替わる
- Spark 無料プラン前提では Firebase Hosting + Auth + Firestore のみを使い、管理者アカウント追加 / 削除 / 管理者メール変更は Firebase Console で手動運用する
- Spark 無料プランでも開発者画面の `教室を追加` ボタンから、Firebase Console 直リンク、作成先コレクション、helper コマンド、本番 Hosting URL をまとめたガイドを開ける

## 設計メモ

- 日程表反映の設計メモは [docs/schedule-popup-design.md](docs/schedule-popup-design.md) を参照する
- PDF 出力の設計メモは [docs/board-pdf-design.md](docs/board-pdf-design.md) を参照する
- 外部 DB / 認証候補は [docs/external-db-auth-options.md](docs/external-db-auth-options.md) を参照する
- DB 構成見直しは [docs/database-architecture.md](docs/database-architecture.md) を参照する

## 外部DBと認証

- 現在の採用方針は Firebase です
- 現段階の外部保存は Firestore の `workspaces/{workspaceKey}/classroomSnapshots/{classroomId}` に教室単位で同期します
- Firebase Hosting で `dist` を配信し、Firestore に教室メタ情報と snapshot を保存します
- Spark 前提ではアプリ内の教室追加 / 削除 / 管理者メール変更はロックされます。必要な場合は Firebase Console で `Authentication` と `workspaces/{workspaceKey}/members`, `classrooms`, `classroomSnapshots` を手動更新してください
- 最初の教室を作るときは `npm run firebase:first-classroom` を実行すると、Firebase Console に貼る JSON 一式を対話形式で生成できます
- Spark 構成では開発者画面の `教室を追加` を押すと、上記の Firebase Console リンクと手順ガイドを画面内で開けます
- アプリ自体は `https://komahyouapp-prod.web.app/` を直接開いて運用します
- `firebase/firestore.rules` を適用し、`.env` に `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_APP_ID` / `VITE_FIREBASE_WORKSPACE_KEY` を設定すると有効化されます
- `VITE_FIREBASE_ENABLE_FUNCTIONS=true` は Blaze へ移行する場合のみ使ってください
- `/KomahyouApp/...` 転送経路は互換性のため残していますが、現運用では本番 Hosting のルート URL を使います
- 詳細な構成は [docs/firebase-backend.md](docs/firebase-backend.md) を参照してください
- Firebase CLI 側は [firebase.json](firebase.json) を使い、プロジェクト紐付けは各環境で `firebase use --add` を実行してください

## 開発コマンド

```bash
npm install
npm run dev
npm run build
npm run build:firebase
npm run firebase:first-classroom
npx firebase-tools deploy --only hosting,firestore
npm run test:unit
npm run test:e2e -- tests/schedule-board.spec.ts
npx playwright test tests/schedule-board.spec.ts
```

## テスト運用

- コマ表、振替、日程表、講習帯、期間入力まわりを変更したら `npm run build` と `npx playwright test tests/schedule-board.spec.ts` をセットで実行する
- 振替ストック計算や PDF 整形ロジックを変更したら `npm run test:unit` も追加で実行する
- 日程表ポップアップの変更時は次を最低確認する
- 自動反映
- 講習期間セレクターの並び順
- 開いたままの追従更新
- 通常授業を stock へ回した未割当分が日程表に残らないこと
- 通常回数 / 講習回数の警告スタンプ位置
- `算` / `数` が学年ごとに適切に出し分けられること
- `テスト教室2` 入力時だけ QR が表示され、それ以外では非表示のままなこと
- 同コマ重複時の振替 / 移動の拒否と状態維持
- `src/components/schedule-board/makeupStock.test.ts` の stock 集計ケースが通ること
- 詳細運用は [開発ルール.md](開発ルール.md) を参照する

## 次の実装候補

1. 欠席 / 未実施登録 UI の具体化
2. 振替ストックの月跨ぎ説明と明細表示の強化
3. 通常残 / 未解決一覧とコマ表の相互ジャンプ
4. 保存先とバックアップ導線の整理

## 問題報告の受け渡し

短報:

```text
画面名 / 操作 / 実際の結果 / 期待結果 / 優先度
```

詳細報:

```text
画面名 / 操作手順 / 問題内容 / 期待する状態 / 優先度 / スクリーンショット / デバッグコピー
```

コマ表画面では、次も付けると修正が速くなります。

```text
日付 / 時限 / 講師 / 生徒 / 表示色 or 注意表示
```
