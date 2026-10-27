# 週単位の分割保存（教室データ 1MiB 上限の恒久対策）— 次セッションへの引き継ぎ（2026-10-27）

> 状態: **仕様はオーナー確定済み・段階 0（共有純関数）と段階 A（両形式を読める版）は 2026-10-27 に実装済み（v1.5.650・ブランチ `ccr-262fd584-vi8fi3`）。
> 次は段階 A の反映（Functions → ルール → Hosting）と staging での読取確認、その後 段階 B（サーバーが分割して書く）。** 仕様の正本は `docs/spec-save-restore.md` §9（約 440 行・§9-15 の 6 論点はすべて確定）と
> `docs/spec-invariants.md` INV-14。この文書は「次のセッションが迷わず着手するための要約と手順」で、仕様の中身を複製しない
> （食い違ったら §9 が正）。オーナー指示 2026-10-27「分割保存の実装を次セッションから進めるのでまとめて」。

## 0. 30 秒で分かる状況

- **事故**: 2026-10-26 17:58〜21:15 と 10/27 14:46〜16:44、日大前校（`5w5OMueETerSKrSf14HC`）の保存が全部 Firestore に拒否された。
  教室データ（非圧縮 8.3MB）を gzip+base64 で 1 文書 `classroomSnapshots/{id}` に入れており、上限 1,048,576 バイトの 27 バイト手前だった。
  詳細は memory `komahyou-snapshot-1mib-capacity-incident`。
- **つなぎ（本番反映済み）**: v1.5.646 圧縮 level 9（使用率 94.8%・余裕 約 56KB＝**2〜4 週間**）、容量超過の記録・メール・専用案内。
  v1.5.647 操作痕跡の上限拡大。v1.5.648 保存できなかった内容の控え＋「開発者へ送る」。
- **恒久対策**: 目次＋部品（管理データ `core`・盤面の週以外 `board`・週 `week:{週キー}`）に分けて保存し、変わった部品だけ送る。
  **冬期講習（12 月）で週が重くなる前に、段階 B（サーバーで分割して書く）を日大前校まで反映する**のが期限。
- **緑が丘校**も 827KB（79%）で同じ道をたどる。薬円台校はサーバーに教室データ無し。

## 0-1. 2026-10-27 の実装内容（段階 0・A）と次セッションの最初の仕事

- 入れたもの（すべてテスト付き・main マージ前に regression-reviewer 推奨）:
  - 共有純関数 `src/utils/classroomSnapshotParts.ts`（分割・組み立て・週キー・部品/全体ハッシュの入力・目次の検査・読み手の共通手順
    `readClassroomSnapshotFromParts`・送る部品の判定・掃除の判定）。`functions/scripts/sync-shared.mjs` で
    `functions/src/generated/classroomSnapshotParts.ts` へ複製（パリティテスト `functions/src/classroomSnapshotParts.parity.test.ts`）。
  - サーバー `functions/src/snapshotPartsReader.ts`（zlib / crypto / getAll を渡す薄い層）と `index.ts` の**唯一の読み手**
    `readClassroomSnapshotPayload`（旧形式は `readLegacyStoredSnapshotPayload`・目次は組み立て・欠けたら例外）。旧 `readStoredSnapshotPayload`
    の 9 呼び出し箇所を全部置き換え（空データ上書き拒否・読み戻し・直前ロールバック before/after・版履歴・ワークスペースバックアップ・
    在籍数台帳・QR マージ・保護者ページ日程・発行時の実在確認）。自動バックアップは組み立てられない教室を除いて `missingClassroomIds`、
    復元前の安全スナップショットは例外、通知の種類 `snapshot-assembly-failed` を追加。
  - **段階 A の暫定ガード**: 分割形式の教室への保存は `failed-precondition`（reason `parts-format-write-unsupported`）で断る。QR マージも
    分割形式の教室では取り込まない（提出は `lectureSubmissions` に残る）。どちらも段階 B で分割の書き手に置き換える。
  - クライアント `src/integrations/firebase/snapshotPartsClientRead.ts`（DecompressionStream / crypto.subtle / 並列 getDoc）と
    `workspaceStore.ts` の `readFirebaseSnapshotPayload` 先頭の分岐。組み立てられない教室は教室名つきの案内で読み込み全体を失敗にし、
    盤面を出さない（＝保存も止まる）。
  - ルール `snapshotParts`（教室メンバー read・write は全面禁止）とルールテスト 7 件（`npm run test:rules`・要 Java＋エミュレータ・
    このセッションの sandbox では未実行 → 反映前にオーナー PC か Actions「Firestore rules isolation」で回す）。
  - INV-14 マトリクス `src/utils/inv14-snapshot-all-or-nothing.matrix.test.ts`（列 5 × アダプタ 2 ＋ 行 8 の配線）。台帳の担保状況を ○ に。
- 入れていないもの（次セッション）: 分割形式の**書き手**全部（§9-4・段階 B）、機能フラグ `weeklySplitSnapshotStorage`、掃除の同乗、
  `CLIENT_TOO_OLD`、`docs/runbooks/rollback.md` A・B の制限追記（段階 B と同時）、staging の読取確認用に分割形式の教室を手で作るツール。
- regression-reviewer（2026-10-27・高 0・中 4・低 9）のうち同日修正済み: M-1 復元前の安全スナップショットの組み立て失敗を握らず復元用ダウンロードを
  `failed-precondition`（`incident-backup-assembly-failed`）で止める／M-3 バックアップ JSON に `missingClassroomIds` を載せ、JSON 読込は
  `src/utils/workspaceBackupImport.ts` で「開いている教室が無ければ先頭教室へ落とさない」／L-1 `ui` を JSON 往復で正規化（NaN→null）／
  L-2 段階 A ガードの拒否を `saveAttempts`（`write-failed`・`cloud-function-rejected`）とメールに残す／L-3 目次の docId を文字種で検査／
  L-4 読み直した目次が同じなら部品を取り直さない／L-6 バックアップの組み立ては教室ごとに逐次／L-7 組み立て失敗を callable 境界で
  `HttpsError('internal', …, { reason: 'snapshot-assembly-failed' })` に包む／L-8・L-9 文言。
- **段階 B の前に直す（reviewer 指摘・未対応）**: **M-2** クライアントは 1 教室の組み立て失敗でワークスペース全体の読み込みを失敗にする
  （室長は等価だが開発者は全教室が開けなくなる）。`WorkspaceClassroom` に `loadFailed` の印を付けて返し、App 側でその教室だけ案内を出し
  `getCurrentClassroomSyncTargetIds` から外す（=保存停止）形へ。**L-5** トリガ（直前ロールバック＋版履歴）が同じ目次を 2 回組み立てる
  （段階 B で 1 保存 約 100 文書・8MB 解凍×2）→ トリガ内で組み立て結果を使い回す。**M-4** ルールテストは反映前に必ず実行。
- 次セッションの最初の仕事: (1) `npm run test:rules` を回す。(2) safe-release で Functions → ルール（Actions「Deploy Firestore rules」）→
  Hosting の順に反映。(3) staging に分割形式の目次＋部品を手で作る小さなツール（`tools/`・firebase-admin・staging 限定）を書いて
  「読める・欠けたら案内が出て盤面が出ない」を実機で確かめる。(4) 段階 B へ。

## 1. 読む順（着手前に必ず）

1. `docs/spec-save-restore.md` §9 全部（特に §9-2 変えないもの K-1〜K-11・§9-3 保存形式・§9-4 保存・§9-5 読み込み・§9-7 移行・§9-14 順序）。
2. `docs/spec-invariants.md` INV-14（教室データの全か無か・準観察）と INV-02 / INV-07 / INV-08。
3. memory `komahyou-save-architecture`（保存は Functions 一本・起動時の書き戻し復活禁止）と `komahyou-snapshot-1mib-capacity-incident`。
4. 現行コード: `functions/src/index.ts` の `saveClassroomSnapshotFromCallable`・`createStoredSnapshotDoc`・`readStoredSnapshotPayload`、
   `src/integrations/firebase/workspaceStore.ts` の `readFirebaseSnapshotPayload`（旧 `gzip-base64-chunked` / `split-documents` の名残あり・取り違え注意）、
   `functions/src/snapshotCapacity.ts`（つなぎで入れた容量の見積もり・分類）。
5. `.claude/skills/solo-git-workflow` / `regression-guard` / `safe-release`（CLAUDE.md の必須手順）。

## 2. 確定した設計（§9 の要点・判断の根拠つき）

| 論点 | 決定 | どこ |
|------|------|------|
| 置き場所 | 目次＝既存の `classroomSnapshots/{id}`（パス不変・`storageFormat: 'weekly-parts'` の印）。部品＝`classroomSnapshots/{id}/snapshotParts/{partDocId}` | §9-3-1 |
| 部品の分け方 | `core`（週と画面状態を除く管理データ）・`board`（`boardState` の週以外）・`week:{週キー}`（1 週 1 文書）・画面状態 `ui` は目次に平文（**Q1＝B**） | §9-3-2 |
| 部品は不変 | 中身が変われば新しい ID（`{kind}~{key}~v{版}~{書き手}`）。目次の切り替えで公開。読み手は半端な状態を見ない | §9-3-5 |
| ハッシュ | 部品ごと SHA-256。全体ハッシュは部品ハッシュの一覧から作る（毎回 8MB を読まないため）。正しさは**サーバーの計算だけ**に依存 | §9-3-6 |
| 保存 | 変わった部品＋送らない部品の「サーバーのハッシュはこれのはず」を送る。1 トランザクションで版数照合（A1）・照合・空データ拒否・書き込み。食い違いは `PARTS_BASE_MISMATCH` → 自動で全量送信 | §9-4 |
| トランザクション上限 | 書き込み 400 件・8MiB。超えたら分けずに拒否。全量でも約 50 件（400 件は約 7 年後） | §9-4-5 |
| 読み込み | 組み立て関数は**サーバー 1 つ・クライアント 1 つ**（純関数モジュールを sync-shared で複製・パリティテスト）。部品が欠けたら**空にせず止める**（fail-closed＝INV-14） | §9-5 |
| 移行 | 段階 A（両形式を読める版）→ B（サーバーが分割して書く・教室単位フラグ）→ C（差分送信）→ D（監視・第 2 段・アーカイブ判断）。**B と C は分けて出す（Q6＝A）**。**一方通行**（分割形式→旧形式へ戻さない） | §9-7 |
| 古い画面 | 段階 A より古い版からの保存は `CLIENT_TOO_OLD` で拒否・再読み込み案内（**Q2＝A**） | §9-7-3 |
| 旧版の部品 | 参照が外れてから **3 日**で掃除（**Q3**）。`cleanupOldSaveAttempts` の巡回に独立予算で同乗 | §9-9 |
| 切り替え順 | 開発用教室 → staging（本番サイズ）→ 日大前校 → 残り（**Q4＝A**） | §9-13 |
| INV | **INV-14** 新設（Q5＝A）。マトリクス `inv14-snapshot-all-or-nothing.matrix.test.ts` を段階 A と同じ push で新設 | spec-invariants |
| ルール | `snapshotParts` は教室メンバー read のみ・write は全面禁止（CF だけ）。ルールテスト 7 件 | §9-8 |
| 後回し | 過去週のアーカイブ（閲覧専用）は**今は決めない**（オーナー 2026-10-27）。`core` の追加分割は 50% 通知が来たら | §9-16 |

今の実装より強くする点（§9-4-6）: 版数照合をトランザクションの中で行う／冪等リプレイは「目次の saveId が同じか」で判定／読み戻しに失敗したら目次を直前へ戻す。

## 3. 実装の順序（§9-14 を作業単位に分解）

各段で dev-fix → regression-reviewer（K-1〜K-11・§9-11 の INV）→ safe-release。**変更には必ずテスト**（CLAUDE.md）。

### 段階 0: 共有の純関数モジュール
- `src/utils/snapshotParts.ts`（仮名）: 分割（payload → core / board / weeks / ui）・組み立て（逆）・週キー（`boardWeekTrim.ts` の `weekDateRange` と同じ規則・重複は `~2`）・部品ハッシュ・全体ハッシュ・「送る部品の決め方」・掃除の判定。
- `functions/` へは `parentSchedule.ts` と同じ sync-shared で複製し、パリティテストを門番にする（`functions/scripts/sync-shared.mjs`）。
- テスト: 分割→組み立てが恒等（日大前校サイズの合成データ・`{ cells }` 形の週・`boardState: null`・未知フィールドの保持）。

### 段階 A: 読める版（書く形式はまだ旧）
- サーバー: 非同期の組み立て関数を作り、`readStoredSnapshotPayload` の**全 10 呼び出し箇所**（index・lessonLedger・lessonLedgerHistory・operationTraces・parentPortal・reportAnswers・saveFailureAlert・workspaceBackupSchedule）を置き換える。部品が欠けたら例外（バックアップが空の教室を書かないこと）。
- クライアント: `workspaceStore.ts` の `readFirebaseSnapshotPayload` に分割形式を足す。欠けたら**空の教室にせず**表示と保存を止めて知らせる（INV-14）。
- ルール: `firebase/firestore.rules` に `snapshotParts` を足し、`npm run test:rules` に 7 件追加。反映は Actions「Deploy Firestore rules」。
- マトリクス `inv14-snapshot-all-or-nothing.matrix.test.ts` 新設（inv-guard の対象になる）。
- 反映順: **Functions → ルール → Hosting**。staging で「手で作った分割形式の目次を読める」こと。
- 次へ進む条件: 各教室の直近の保存がすべて段階 A 以降の版から来ている（`saveAttempts.appVersion`）。

### 段階 B: サーバーが分割して書く（★期限に効くのはここまで）
- `saveClassroomSnapshotFromCallable`: 従来の全量 `payload` を受け、フラグ ON の教室では分割して書く。1 トランザクション（版数照合・空データ拒否・上限検査・部品 set・目次 set）→ 読み戻し → 失敗なら目次を直前へ戻す。`saveAttempts` に `hashScheme: 'parts-v1'`。
- 兄弟経路（§9-6）: QR 提出のマージ（`lectureSubmissionApi` の `transaction.set`・版数据え置き）・教室作成・復元・ロールバック・直前ロールバックのトリガ・バックアップ。
- `CLIENT_TOO_OLD` の拒否。クライアントの文言（`saveProgressMessages.ts` にマーカー・既存の STALE / SNAPSHOT_TOO_LARGE と同じ作法）。
- 掃除（`resolveSnapshotPartGcActions`）を `cleanupOldSaveAttempts` に同乗。§8-1 の表 #17 を実装に合わせる。
- 機能フラグ `weeklySplitSnapshotStorage`（サーバー側・教室単位・書く形式の選択にだけ使う）。`developmentStatusLedger.ts` に段階を載せる（scope と stage のズレはテストが検出）。
- `docs/runbooks/rollback.md` A・B に「分割形式の教室がある間は段階 A より前へ戻さない」を追記。
- 切り替え: 開発用教室 → staging（`node tools/copy-prod-classroom-to-staging.mjs --workspace main --classroom 5w5OMueETerSKrSf14HC` で本番サイズを写す・オーナー PC で実行）→ 日大前校 → 残り。切り替え日は室長へ「一度ハードリロード」を案内。

### 段階 C: 差分送信
- クライアントの台帳（読んだ目次の部品ハッシュ）・変化判定は**毎回中身から計算**（オブジェクト同一性で省かない＝INV-02 の型）・gzip 送信・全量への切り替え条件（§9-4-3）。
- 速度の目標 AC-7（普段の保存 5 秒以内）・AC-8（ハッシュ 500ms 以内）・AC-23（読み込み +2 秒以内）は**暫定**。staging の本番サイズで実測して確定（オーナー判断ではない）。

### 段階 D
- 監視の数値（50% 通知・読み込み時間）を見て、第 2 段（部品の先書き・`core` の分割）と過去週のアーカイブをオーナーへ提案。

## 4. 着手時の注意（事故の教訓・巻き戻し禁止）

- **保存は Functions 一本**のまま。クライアントから `snapshotParts` へ直書きしない（ルールで禁止）。
- **起動時の書き戻しを復活させない**（v1.5.405・`App.test.ts`「いかなる条件でも書き戻さない」）。v1.5.648 の控え（`unsentCloudSave.ts`）も送るためだけに使う。
- 旧形式は**永久に読める**ようにする（Storage のバックアップ・版履歴・直前ロールバック・Drive・JSON バックアップ）。変換しない。
- `readStoredSnapshotPayload` の呼び出し箇所を 1 つでも取りこぼすと、その経路だけ分割形式の教室が「空」に見える。grep で全件を数えてテストで固定する。
- 旧「分割保存」の名残（`gzip-base64-chunked` / `split-documents`・`chunks` / `parts` / `boardWeeks`）と**別名**にする（`snapshotParts`）。
- つなぎで入れた `snapshotCapacity.ts` の見積もりは**記録と通知にだけ**使う（見積もりで書き込みを止めない）。分割形式でも同じ。
- 本番データ保護: 調査は読み取りだけ（`export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)`）。書く確認は開発用教室 `v8OZ7zH8vONNHjjYVcR1` と staging だけ。
- `src/App.tsx` は CRLF。Python 等で書き換えるときは改行を保つ（memory `komahyou-developer-report-button`）。

## 5. 数値のメモ（2026-10-27 時点・日大前校）

- 非圧縮 8,345,360 バイト。内訳: `boardState.weeks` 7.35MB（46 週・2026-05-11〜2027-03-29・1 週 95〜415KB・講習週が重い）、`suppressedRegularLessonOccurrences` 154KB、`scheduleCountAdjustments` 62KB、`specialSessions` 405KB、`classroomSettings` 162KB、`regularLessons` 65KB。
- 文書サイズ（Firestore の計算方法）: level 6 で 1,048,549（上限 −27）→ level 9 で 994,145（94.8%）。gzip level 9 は 8MB で +0.14 秒（レビュー推計では gen2 512MiB で +0.5〜1 秒）。
- 1 回の保存は 15〜25 秒（8MB の送信が主）。差分送信で普段は百数十 KB になる見込み。
- 保存記録の読み方: `classroomSnapshots/{id}/saveAttempts` を `createdAt` で runQuery（`status` / `snapshotVersion` / `documentByteLength` / `capacityRatio`）。`started` が並ぶ＝本体の書き込みで落ちている（v1.5.646 以降は `too-large` / `write-failed` に分かれる）。

## 6. 関連する未完了（この計画の外・忘れないため）

- 確認リスト sc-1（圧縮変更後の保存・再読み込み）・sc-2（机を何台も動かす操作の記録）・sc-3（Wi-Fi を切って「開発者へ送る」）はオーナーの確認待ち。sc-2 / sc-3 の裏側（記録が切れていない・メールが届いた）は Claude が確かめる。
- 日大前校の 10/26 の消えた作業: s076 の振替 3 件（11/4・11/10・11/11）は室長が入れ直す。s049 の 2 件（11/5・11/12）は s036 と重なるため室長の判断待ち。
- regression-reviewer の低優先の指摘（v1.5.648）: 控えは uid / workspaceKey で区切っていない（同じ PC の別アカウントにも案内が出る）・失敗ごとに 8MB の structured clone（間引き未実装）・報告本文づくりの共通化（`submitDeveloperReport` と `buildUnsentCloudSaveReportBody` の 2 か所）。
