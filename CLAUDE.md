# コマ表アプリ — Claude へのルール

## ⚠️ 作業前に必ず参照するスキル（厳守）

このリポジトリでコードを**編集・追加・修正・リファクタリング**する前に、スキル
`.claude/skills/solo-git-workflow/SKILL.md`（一人開発向け Git 運用＋回帰防止）の手順に従うこと。
**本番へマージ／デプロイする前**は `.claude/skills/safe-release/SKILL.md`（自動テスト→リリース前チェックリスト→
本番→ライブ検証→ロールバック）にも従うこと。staging での実機確認は 2026-11-05 のオーナー指示で必須から外した。
**作業の進め方そのもの（聞き取り・計画・テスト先行・実装・レビュー・完了確認）は Superpowers プラグインに従う**。
このアプリ用の上書きは下の「Superpowers との使い分け」が正本。
ユーザーが明示的に Git や回帰に触れていなくても、編集を始める前にこのスキルの判断フロー
（壊れたら困る変更はブランチを切る／変更前にベースラインを取る／変更後に既存機能の回帰を確認／
コミット前に `git diff`）を踏むこと。下記の回帰防止ルール・本番データ保護ルールと併せて守る。

このスキルには次の2点が**必須手順**として含まれる（厳守）:
- **編集着手前にデプロイ済み最新と同期確認**: `git fetch` でローカル main が origin/main に追いついているか、
  `package.json` の version と ライブ `https://komahyouapp-prod.web.app/version.json` が一致しているかを確認する。
  ライブの方が新しいまま編集を始めない（CI が毎 push で自動 bump するためローカルは遅れがち）。
- **編集ごとに更新リスト `CHANGELOG.md` へ1行追記**: 何を・なぜ変えたかを記録する。
  バージョンは CI が自動で上げるので **`package.json` は手動で書き換えない**。
- **新機能追加・修正のたびに確認リストを必ず更新(オーナー指示 2026-09-17)**: オーナーは開発用教室の確認リストパネルで
  全チェックする。`src/utils/verificationChecklist.ts` の `VERIFICATION_CHECKLIST` に、その変更を実機で確かめる手順つき項目を
  足し、`VERIFICATION_CHECKLIST_VERSION` を次にデプロイされる版へ上げる(テストも追随。下書きは版ごとに保存されるので、確認中の版へ項目を足すだけなら版は据え置く)。結果待ちの項目は残し、OK 済みは載せない。
  結果は `node tools/verification-checklist-report.mjs --workspace main` で読む(「その他」欄も必ず見る)。
  (開発者画面の**開発ダッシュボード**は 2026-10-30 から確認リストの結果を出さない。確認リストとの重複をなくすオーナー指示)。
- **進行中テーマ台帳を更新する(2026-09-25)**: 機能フラグの scope を変えた(昇格)・ブランチをマージした・保留を解除した・
  新しい先行機能や作りかけ・オーナー判断待ちが生まれたら、`src/utils/developmentStatusLedger.ts` の該当行を書き換える／消す／足す
  (開発ダッシュボード「いまの状況」= やること／開発・テスト教室だけの機能／まだ作っていないもの の正本・`docs/spec-developer-report.md` §E-3。
  済んだ行はすぐ消す。題名・要約・次の一手は**平易な短い文**で書き、経緯は `notes` へ(長さと社内記号はテストが検出)。
  確認リストの結果待ちだけの話は載せない。フラグの scope と段階のズレもテストが検出する)。
- **コミット〜main マージは Claude の判断で自動実行(常時許可・オーナー指示 2026-06-27)**:
  毎回の明示指示なしに、回帰確認(build/テスト/`git diff`)を通したうえでコミット →
  `CHANGELOG.md` の `## 未リリース` を次の版でラベル付け → main へマージ(= CI 自動デプロイ)まで進める。
  ただし**本番データへの書き込み・履歴の破壊的操作・大きな変更の main 直接着手**は対象外(従来どおり慎重に)。

## Superpowers との使い分け（オーナー確定 2026-11-05・厳守）

一般的な作業の進め方は Superpowers プラグインのスキル（`superpowers:*`）に従い、このアプリ固有の決まりは
既存スキル（solo-git-workflow / regression-guard / safe-release / bug-triage / staging-environment）に残す。
両者がぶつかる点は次のとおり決めた（この表が Superpowers の既定より優先する）。

| # | 論点 | 決定 |
|---|---|---|
| 1 | ブランチの仕上げ | `finishing-a-development-branch` の「マージ／PR／残す／破棄」の選択肢は出さない。確認を通したら **main マージまで自動**（solo-git-workflow C）。PR は作らない |
| 2 | テスト | **すべての変更をテスト先行**（`test-driven-development`）。先にテストを書き、今のコードで落ちるのを見てから実装する。アプリのコードに触れない変更（文書・設定）は対象外 |
| 3 | 実装 | **コードの変更は `subagent-driven-development` で進める**（作業ごとに実装係＋レビュー係）。実装係は `dev-fix` エージェント、判断を伴う作業は Opus 最新・機械的な作業は Sonnet 最新を `model:` で指定 |
| 4 | レビュー | Superpowers のレビュー段（各作業後・最後の全体レビュー）は **`regression-reviewer` エージェント 1 人**で行い、仕様適合・コード品質・INV 監査・巻き戻し検査を 1 回で見る。別の汎用レビュー係は重ねない |
| 5 | 仕様・設計メモ | `brainstorming` の設計は `docs/superpowers/specs/` ではなく **既存の `docs/spec-*.md`（正本）に書き足す**（spec-curator の管理） |
| 6 | 計画書 | `writing-plans` の計画は **`docs/plan-YYYY-MM-DD-<題名>.md`** に置く（書き方は Superpowers どおり） |
| 7 | worktree | **作らない**。ブランチを切るだけ（クラウドのセッションはもともと使い捨ての分離環境。worktree では `functions/node_modules` や `.env.local` が無くテストが落ちる） |
| 8 | 聞き取り | 新機能・挙動変更は `brainstorming` で進める。使い勝手に影響するものは、出す案に**懸案と妥協案を必ず含める**（下の標準フロー 2 の厳守事項）。明白なバグ修正は対象外 |
| 9 | 不具合調査 | 進め方は `systematic-debugging`。書き換える前に regression-guard（過去修正の追い方・踏み抜き例・INV 4 点）も必ず読む |
| 10 | 完了確認 | `verification-before-completion` に従い、「何を実行すれば完了と言えるか」は safe-release のリリース前チェックリストで決める |
| 11 | スキルの強制 | 「1% でも当てはまればスキルを読む」は**コードの変更に限る**。質問への回答・読むだけの調査・文言/ラベル/設定だけの変更はスキルを読まずに進めてよい |

- 公開リポジトリなので、Superpowers の手順で書く文書（仕様・計画・レビュー記録）にも生徒・講師の実名は書かない。
- 本番データ保護ルール・確認リスト・進行中テーマ台帳・CHANGELOG・利用者報告 Issue の扱いは、Superpowers の手順の途中でも従来どおり守る。

## ⚠️ 回帰防止ルール（過去の修正を必ず踏襲する・厳守）

このアプリは**過去の修正を踏まえて次の修正を積み上げる**前提で開発されている。
過去に直したバグを後の変更（特にマージ/リベース/リファクタ）で**巻き戻してはいけない**。

- **既存ロジックを書き換える前に、その箇所が過去に何を直したかを確認する。**
  - `git log -L <開始>,<終了>:<ファイル>` や `git log -S "<該当コード片>"`、`git blame` で変遷を追う。
  - 関数の近くにある「回帰防止」「fix」「過去コミットID」コメントは**意図的なガード**。消さない・薄めない。
- **コードを「単純化」する誘惑に注意。** `{ ...a, ...b }` のような spread は、過去に明示していた
  フィールド補完（例: `managedStudentId: b.x ?? a.x`）を消すと回帰する。短く見えても挙動が変わる。
- **マージ衝突の解決時は、両側の修正を必ず両立させる。** 一方の修正を捨てて他方で上書きしない。
- **バグを直したら必ず回帰防止テストを追加する**（修正なしで落ち・修正ありで通ることを確認）。
  ゴールデンスナップショットだけに頼らない（リライトで保護が消える）。
- 実際に起きた回帰：`mergeManagedDeskLesson` の生徒同一性補完（commit `6793374`）が
  後のマージ（commit `2dce7b4`）で `{ ...managedStudent, ...student }` に巻き戻り、
  生徒日程表で通常授業がカウントされない不具合が再発（2026-06-10 に再修正＋テスト追加）。

### INV アンカー（保証台帳で固定する・厳守）

上の「過去コミットを巻き戻すな」＝**パッチアンカー**に加え、バグは**ユーザー体験の保証単位（INV）**でも固定する。
横断保証台帳は `docs/spec-invariants.md`（正本・重複ゼロ）。修正時は次に従う（詳細は台帳へ委譲・ここに複製しない）。

- **UX 系バグの完了定義 4 点**: (1) 台帳で該当 INV を特定（無ければ spec-curator 経由で**台帳追加が先**・
  追加/文言改定はオーナー承認）。 (2) 経路テスト＋強制 INV は該当 `*.matrix.test.ts` を拡張。
  (3) 兄弟監査（隣接操作＝移動⇄入替⇄削除／生徒⇄講師／盤面⇄日程表／全ルールに穴が無いか）。
  (4) `CHANGELOG.md`・コミットに `INV-<番号>` を記載。分類は症状でなく真因構造で（再実行=INV-03／上書き=INV-02 等）。
- 内部リファクタ・文言のみは免除。`*.matrix.test.ts` の assert 薄化は台帳改定（オーナー承認）を同一 push に伴うこと（CI が検査）。

## ⚠️ 本番データ保護ルール（最優先・厳守）

このアプリは **稼働中の本番サービス** です。複数の学習塾教室の実際のデータが Firebase (プロジェクト: `komahyouapp-prod`) に保存されています。

### Claudeが絶対に行ってはいけないこと

- **開発用教室(`v8OZ7zH8vONNHjjYVcR1`)以外のFirestoreドキュメントへの書き込み・更新・削除**
- **本番教室の復元・コピー・上書きに相当するCloud Functions呼び出し**（`saveClassroomSnapshotViaFunction`, `restoreClassroomFromServerAutoBackup`, `restoreLatestClassroomRollback`, `copyClassroomDataToDevelopmentClassroom`等）
- **管理者UID以外のmembersドキュメントへの書き込み**

### デバッグ・チェック時の読み取り専用ルール

- **本番の読み取り専用トークン(2026-09-26)**: クラウド環境の環境変数 `KOMAHYOU_READONLY_SA_JSON_B64`(読み取り専用サービスアカウント
  `claude-readonly`・ロールは Cloud Datastore 閲覧者＋Storage オブジェクト閲覧者だけ)から
  `export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)` で 1 時間有効のトークンを作り、Firestore REST / Storage JSON API を GET する。
  利用者報告の操作痕跡(`developerReports/{id}.recentOperations`)と報告時点の教室データ(`snapshotStoragePath`)もこれで読む。
  取得した教室データ(生徒名を含む)はスクラッチ領域に置き、リポジトリ・Issue・公開ログへ出さない。

- Firestoreデータの**確認・照合は読み取り（GET）のみ**。REST APIで `getDoc` / `getDocs` に相当する照合は可。
- gcloud / firebase CLI でのデータ参照は読み取り専用コマンドに限定する。
- **書き込みが必要な確認作業は、必ず開発用教室 `v8OZ7zH8vONNHjjYVcR1` を対象にする**。

### 教室一覧と担当者（参照用）

| 教室名 | classroomId | 用途 |
|--------|-------------|------|
| スクールIE 日大前校 | `5w5OMueETerSKrSf14HC` | 本番（読み取り専用） |
| スクールIE 緑が丘校 | `KzFnOQoTFLsCxwUp1tvh` | 本番（読み取り専用） |
| スクールIE 薬円台校 | `6xnnbSTbwgGrBLy0EJKb` | 削除済み（2026-11-07 オーナー「もう消したから考えなくて良い」・影響件数の計測対象から外す） |
| 開発用教室           | `v8OZ7zH8vONNHjjYVcR1` | **書き込み可能な唯一の教室** |
| テスト教室           | `test_classroom_20260507_dai` | 開発用に準じて扱う |

### 事故の記録（2026-06-06 再発防止）

Claudeの自動チェックセッションが `actingClassroomId` を適切に制御しない状態で復元/コピー操作を実行し、**日大前校のスナップショット文書が緑が丘校のデータで上書きされた**。
汚染前バックアップ（2026-06-06 T10毎時）から手動復元で対応。

再発防止：Claude はアプリのチェック・デバッグ・動作確認においても、**Firestoreへの書き込みを伴う操作は開発用教室のみ** に限定する。

---

## Claude のメモリ（`.claude/memory/`・2026-10-26 にリポジトリへ移設）

Claude の記憶（過去の事故・設計判断・オーナー指示の記録）の**正本はリポジトリの `.claude/memory/`**。
ユーザーフォルダ側（`~/.claude/projects/.../memory/`）には案内の `MEMORY.md` だけを残してある。
索引は下で読み込む。本文で「memory `<名前>`」と書いてあるものは `.claude/memory/<名前>.md` を指す。

- **新しく覚える・直すときはここへ書く**（1 記憶 1 ファイル＋frontmatter、`MEMORY.md` に 1 行の索引）。ユーザーフォルダ側には書かない。
- **⚠️ このリポジトリは公開(PUBLIC)。** 生徒・講師・保護者・室長の実名、メールアドレス、UID、電話番号は書かない。
  生徒は生徒ID（`s091` など）か「生徒A」、講師は講師ID（`t025` など）か「講師A」、オーナーは「オーナー」と書く
  （移設時に既存の記憶も同じ規則で伏せ字にした）。

@.claude/memory/MEMORY.md

---

## 保守運営の体制（エージェントとスキル）

複数ユーザー導入に向けた保守運営の役割分担。詳細は memory `komahyou-staging-and-ops`（`.claude/memory/`）参照。

### 役割エージェント（`.claude/agents/`）
- **triage**（Sonnet）… 曖昧な報告（口頭/LINE/スクショ）を再現手順・影響範囲・優先度に整理し GitHub Issue 化（読み取り＋起票）。
- **spec-curator**（Opus）… 思いつき要望を「あるべき姿」に照らして要求仕様へ補完・確定。`docs/spec-*.md`（正本）の維持管理者。コードは触らない。
- **dev-fix**（Opus）… 原因特定とコード修正の主力。solo-git-workflow / regression-guard / safe-release を厳守。
- **regression-reviewer**（Opus）… 変更が過去修正を巻き戻していないか＋保証台帳 `docs/spec-invariants.md` の INV を満たすか検査する INV 監査ゲート兼読み取り専用レビュー役。

### モデル割当方針（コスト最適化・オーナー指示 2026-07-04 / 2026-07-10 再確認）
> **大原則（オーナー指示 2026-07-10）**: **複雑な作業・構想作成・原因特定・仕様策定・レビューなど
> “考える／仕組みを作る”仕事はコストの高い上位モデル、手順が確立した単純作業はコストの安い下位モデルを
> 使い分ける。** これはエージェント定義だけでなく、**主セッションが `Agent` を起動するとき／`Workflow` の
> 各 `agent()` ステップでモデルを選ぶときにも適用**する（判断を伴う段は Opus 最新、機械的な段は Sonnet 最新を
> `model:` で明示）。迷ったら「このステップは判断か、確立した単純作業か」で切り分ける。
- **特定モデルIDに固定しない。** エージェントの frontmatter は `model: sonnet` / `model: opus` の
  エイリアスで書き、常に各系列の最新版へ自動追従させる。
- **判断・仕組みづくり・原因特定・仕様策定・レビュー → Opus 最新**（dev-fix / spec-curator / regression-reviewer）。
- **手順が確立した単純作業 → Sonnet 最新**（triage、ログ収集、一括置換、定型ドキュメント更新など）。
  dev-fix でも**機械的な小修正**（文言・ラベル・スタイル・定数変更）は Agent 起動時に
  `model: sonnet` を指定してコストを抑えてよい（判断は起動側が済ませてから渡す）。
- オーケストレーション（主セッション）は利用可能な上位モデルで行うが、**特定モデルの存在を前提に
  しない**。この CLAUDE.md・スキル・エージェント定義だけで、どのモデルでも同じ運用が再現できる
  状態を保つ（属人化ならぬ「属モデル化」を避ける）。

### 標準フロー（バグ・要望共通）
> **⚠️ 利用者報告 Issue（ラベル `source:user-report`・「質問・要望」ボタン（旧「要望・報告」）由来の自動起票）は、
> 勝手に修正を始めない（オーナー指示 2026-09-04・厳守）。** 調査・整理（triage・切り分け）までは進めてよいが、
> コード修正への着手は**オーナーが内容を確認して許可してから**。仕様 `docs/spec-developer-report.md` §E。

1. 報告/要望 → **triage** で整理・Issue 化（曖昧点は質問で返す）。
2. 新機能・挙動変更・仕様が曖昧なバグは → **spec-curator** で未定義を補完し正本を更新、
   受け入れ条件つきで実装タスク化（単純な明白バグはスキップ可）。
   - **⚠️ ユーザビリティ影響の要望は実装前に懸案＋妥協案をオーナーへ提示（オーナー指示 2026-07-10・厳守）**：
     オーナーの要望による機能実装のうち、**ユーザビリティ**（既存の操作感・手数・画面の見え方・学習コスト・
     既存フローとの衝突・端末/画面サイズ差）に**影響が出るもの**は、いきなり実装に入らない。着手前に
     **懸案（トレードオフ・副作用・回帰リスク）と妥協案（軽量版・段階導入・オプト化・既定値の選択肢など）を
     複数提示し、オーナーと一緒に落とし所を決めてから実装する**。オーナーは妥協案を検討したい意向。
     判断が要る点は `AskUserQuestion` 等で選択式にして返す。純粋にユーザビリティへ影響しない内部修正・
     明白なバグ修正はこの限りでない（[[komahyou-clarify-before-proceeding]] の延長）。
3. → **dev-fix** で実装＋回帰防止テスト（同コミット必須・テスト先行。`subagent-driven-development` の実装係として起動）。UX 系バグは INV 完了定義4点（該当 INV 特定→経路テスト＋マトリクス拡張→兄弟監査→コミットに INV-ID）を満たす。
4. → **regression-reviewer** で仕様適合・品質＋INV 監査＋巻き戻し検査（Superpowers のレビュー段もこれ 1 人で行う。リファクタ・マージ衝突解決後は必須）。差分が触れる INV の特定・兄弟被覆・マトリクス格下げ・権威関数の分散を点検する。
5. → **safe-release** で自動テスト・チェックリスト → 本番マージ → ライブ検証。
   - **staging での実機確認は必須でない(オーナー指示 2026-11-05)**。画面での確認は、本番反映後にオーナーが
     開発用教室の確認リストで行う(確認リストの更新は従来どおり必須)。staging はオーナーが使いたいときだけ使う。
     lint / unit / build と、rules を触ったときの `npm run test:rules` は省かない。

### スキル（`.claude/skills/`）
- `solo-git-workflow`（Git運用）/ `regression-guard`（回帰防止の実務）/ `safe-release`（安全リリース）/
  `staging-environment`（検証環境・任意）/ `bug-triage`（報告→Issue 一本化）。
- 一般的な進め方は Superpowers プラグイン（`superpowers:*`）。ぶつかる点は「Superpowers との使い分け」の表に従う。

### 課題管理
- バグ・要望は **GitHub Issues に一本化**（`Kake-git-hub/KomahyouApp`）。テンプレ `.github/ISSUE_TEMPLATE/`、
  ラベル `type:* / severity:s1〜s3 / area:* / status:*`。フローは `bug-triage` スキル参照。

### テストゲート
- **⚠️ 変更には必ずテストを添える（厳守・オーナー指示 2026-06-29）**：バグ修正だけでなく**新機能・新挙動の追加・既存挙動の変更も、その挙動を守るユニットテストを必ず同じコミットで追加する**。
  E2E を廃止した今、UI操作・盤面ロジック・警告・保存/権限などの回帰防止はユニットが唯一の自動ゲート。テスト無しでマージしない。
  - 純粋関数として書けるよう設計する（巨大コンポーネント内のロジックは `computeStudentMove` / `resolveLessonPatternWarnings` のように切り出してから検証する）。
  - 「修正なしで落ち・修正ありで通る」を確認（回帰防止）。`docs/test-strategy.md` の方針に従う。
  - 保存/権限/教室分離を触ったら `npm run test:rules` も回す。本番critical（実Firebase往復・画面表示）は、本番反映後に開発用教室の確認リストで補完する。
  - **テストは先に書く（オーナー確定 2026-11-05）**: `superpowers:test-driven-development` に従い、テストを書いて今のコードで落ちるのを見てから実装する。
- `.github/workflows/ci-tests.yml` がブランチ push ごとに **lint / unit / build** を実行（毎push・約1分・決定的）。
  main マージ前に緑を確認する。マージ前チェックは `.github/PULL_REQUEST_TEMPLATE.md` ＝ `docs/runbooks/release-checklist.md`。
- **画面の自動巡回（2026-11-11・オーナー決定）**: 盤面のロジックや画面を変えた修正は、main へ入れる前に `node tools/ui-patrol.mjs --out <スクラッチ領域>/…` を回す
  （本番 2 校の形のデータ〔名前は伏せる・読み取りだけ〕を手元のアプリに入れ、室長と同じ画面操作をして、操作のたびに点検する。約 10 分）。
  「変」（終了コード 1）が出たら止めて調べる（自分の変更のせいかは `--baseline-ref origin/main` を付けて流し直すと道具が分ける）。手順は `docs/runbooks/ui-patrol.md`、設計は `docs/test-strategy.md` 層 5。ユニットの代わりではない。毎朝の健診には入れない。
- **Playwright E2E は廃止（2026-06-29）**。全シナリオをユニット（純粋関数）へ移植済み。方針と移植マップは `docs/test-strategy.md`。
  UI操作の回帰はユニットが、実環境の通し動作は開発用教室の確認リスト（本番反映後・オーナー）が担保。Firestore ルールの教室分離は `npm run test:rules`（手動・要 Java + エミュレータ）。

### 監視・障害検知 / ロールバック
- **外形監視**: `.github/workflows/uptime-check.yml`（15分ごと＋手動）が本番の index/version.json/QR API を確認。
  異常時は `incident:uptime` ラベルの Issue を自動起票＋ワークフロー赤（メール通知）、復旧で自動クローズ。詳細 `docs/runbooks/monitoring.md`。
- **ロールバック**: 症状別の戻し手順は `docs/runbooks/rollback.md`（A=Hosting / B=Functions / C=データ復元）。
  データ復元は「開いている教室」に書き込むため最重要の慎重操作（本番データ保護ルール）。

---

## プロジェクト概要

- **技術スタック**: React + TypeScript + Firebase (Firestore / Cloud Functions / Hosting / Storage)
- **状態管理**: useState / useRef / useCallback 中心（外部状態ライブラリなし）
- **保存アーキテクチャ**: 手動保存ボタン → Cloud Function `saveClassroomSnapshot` に一本化。Firestore 直書き経路は廃止済み。
- **ビルド**: `npm run build` / 開発: `npm run dev`（ポート5173）
- **デプロイ**: `npm run deploy` → Firebase Hosting

## スマホからのデプロイ手順（PC不要・GitHub経由）

PC が無くても、GitHub（モバイルアプリ/ブラウザ）だけで本番（`komahyouapp-prod`）へデプロイできる。
GitHub Actions がリポジトリのシークレット（`RE_FIREBASE_SERVICE_ACCOUNT` ほか）でデプロイを実行する。

### フロント（ホスティング）
- 作業ブランチを **`main` にマージ** すると、`.github/workflows/deploy-firebase-hosting.yml` が自動実行され、
  ビルド→本番ホスティングへデプロイ→ライブ検証まで行う（毎回 patch バージョンを自動 bump）。

### Firestore ルール（`firebase/firestore.rules`）
- ホスティング CI はルールを出さない。ルールは `.github/workflows/deploy-firestore-rules.yml`（2026-09-28）で反映する。
  - **手動**: Actions → 「Deploy Firestore rules」→ Run workflow（ブランチ=main）。
  - **自動**: `firebase/firestore.rules` を変更して `main` にマージすると発火。
  - 反映前に `npm run test:rules` で教室分離を固定する。Storage ルールは対象外。

### Cloud Functions（`lectureSubmissionApi` ほか）
- ホスティングCIは **functions を出さない**。functions は専用ワークフロー `.github/workflows/deploy-functions.yml` を使う。
  - **手動**: GitHub アプリ → 対象リポジトリ → **Actions → 「Deploy Cloud Functions」→ Run workflow**（ブランチ=main）。
  - **自動**: `functions/**` を変更して `main` にマージすると発火。
- 成否は Actions の **緑/赤** で判断できる（`set -o pipefail` で firebase の失敗を正しく検知する。緑=本当に成功）。
  - 補足: 大量の gen2 関数を同時更新すると一部が 409「unable to queue」警告を出すことがあるが、firebase が
    最終的に成功(exit 0)していれば自動リトライで解消済み。緑なら問題なし。

### 一度きりの前提セットアップ（2026-06-26 実施済み・記録）
CIのサービスアカウント `firebase-adminsdk-fbsvc@komahyouapp-prod.iam.gserviceaccount.com` に、
GCP コンソール（プロジェクト `komahyouapp-prod`）で以下を付与済み。functions デプロイにはこれらが必須：
- ロール **サービス アカウント ユーザー**（`roles/iam.serviceAccountUser`）… 実行SA(`...@appspot`)を ActAs するため
- ロール **Cloud Functions 管理者**（`roles/cloudfunctions.admin`）
- API **Cloud Billing API**（`cloudbilling.googleapis.com`）を有効化
- ロール **Cloud Scheduler 管理者**（`roles/cloudscheduler.admin`）… スケジュール関数（毎時/日次バックアップ・
  saveAttempts掃除）のジョブ更新に必要。2026-07-04 のデプロイで `cloudscheduler.jobs.update` の 403 が初出。
  **オーナーが付与するまで functions デプロイは赤になる**（付与後に Actions → Deploy Cloud Functions を再実行）。
- ロール **Firebase Rules 管理者**（`roles/firebaserules.admin`）… Firestore ルールを Actions から反映する
  `.github/workflows/deploy-firestore-rules.yml`（Actions →「Deploy Firestore rules」）に必要。2026-09-28 の初回実行で
  `firebaserules.googleapis.com …:test had HTTP Error: 403` を確認 → **同日オーナーが IAM で付与し、再実行で緑**
  （v1.5.565 の `reportAnswers` ルールが反映され、開発用教室で未読バッジの表示を確認済み）。
- ロール **ログ閲覧者**（`roles/logging.viewer`）… 関数の実行ログをスマホから読む手動ワークフロー
  `.github/workflows/functions-logs.yml`（Actions →「Read Cloud Functions logs」）に必要。2026-09-12 の初回実行で
  `PERMISSION_DENIED: Permission denied for all log views` を確認（**未付与**）。付与されるまで read-logs ジョブは赤。
  同ワークフローの `diagnose_classroom` 入力（通常授業履歴のサーバー経路を Firestore 読み取りだけで再現する
  `tools/lesson-history-diagnose.mjs`）は付与前でも動く。

### 関数が「INTERNAL」しか返さないときの調べ方（2026-09-12 の教訓）
- 画面の `INTERNAL` は「関数ハンドラが HttpsError 以外の例外を投げた」印。ログが読めないときは、まず**該当関数の
  Firestore クエリを REST(runQuery)で同じ形に再現**する（`tools/lesson-history-diagnose.mjs` の作法）。
  実例: `orderBy(FieldPath.documentId(), 'desc')` は複合インデックスが必要で `FAILED_PRECONDITION` になる
  （単一フィールドの昇順/降順は自動索引があるので、並べ替えは `dateKey` などのフィールドで行う）。
- callable では想定外の例外を原因文つきの `HttpsError('internal', …)` に包み、次回から画面に理由が出るようにする。

### 注意
- デプロイ後は各端末で **ハードリロード（Ctrl+Shift+R）** を徹底（旧バンドルのキャッシュ事故防止）。
- Claude(私)の実行サンドボックスには Firebase 認証情報が無いため、`firebase deploy` を直接は実行できない。
  デプロイは上記 GitHub Actions（＝GitHubのサーバー上）経由か、認証済みPCで行う。

## 重要な実装メモ

- `workspaceKey` = `main`（本番）/ `.env.local` の `VITE_FIREBASE_WORKSPACE_KEY` で設定
- 復元・コピーは `actingClassroomId`（現在開いている教室）に書き込む。**開いている教室の確認なしに復元操作をしてはいけない**。
- バックアップ: 毎時（直近3日）・日次（14日）。Storage パス `workspace-auto-backups/main/hourly/{key}.json`
- **staging 環境**: 本番と分離した検証用プロジェクト `komahyouapp-staging`（`komahyouapp-staging.web.app`）。
  **書き込み自由**で実機検証に使う。CI は `.github/workflows/deploy-staging.yml`（手動実行）。
  未整備なら `docs/runbooks/staging-setup.md`（オーナーがクラウド側を設定）。functions は
  `STORAGE_BUCKET` を staging に向けないと本番バケットを触る点に注意（runbook 手順6）。
- **⚠️ staging と本番の版を合わせてから使う（オーナー指示 2026-07-10）**：オーナーはどちらの環境でも
  動作確認する。**staging で新機能の実装・検証を始めるときは、その直前に最新 main を staging に反映**して
  （GitHub → Actions →「Deploy to Staging」を main ／作業ブランチから実行）、`komahyouapp-staging.web.app/version.json`
  と `komahyouapp-prod.web.app/version.json` の版が揃っている状態を作ってから作業する。古い staging のまま検証して
  「本番と挙動が違う」と誤判定しない。常時 CI 自動追従はしない（新機能で staging を使うタイミングで都度反映する）。詳細は
  `staging-environment` スキル。
- 詳細: `.claude/memory/komahyou-save-architecture.md` および `.claude/memory/komahyou-classroom-restore-cross-contamination.md` 参照
