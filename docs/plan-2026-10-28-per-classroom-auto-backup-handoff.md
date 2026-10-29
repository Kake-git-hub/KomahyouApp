# 15 分ごとの自動バックアップを教室別に分けて書く — 次セッションへの引き継ぎ（2026-10-28）

> 状態: **段階 0〜2 のコード実装済み（2026-10-29・v1.5.662）・書く側の切り替え（設定 `WORKSPACE_AUTO_BACKUP_LAYOUT`）は staging → 本番の順で未・段階 3（実測と片付け）は切り替え後**。
> オーナー指示 2026-10-28「自動バックアップの教室別化はすぐに次セッションで着手できるようにして」→ 同日
> **§4 の論点 Q1〜Q9 はすべて推奨案（各 1 番目）でオーナー確定**（「全部推奨案で確定して台帳に書いて」）→ 2026-10-29 に `docs/spec-save-restore.md` **§10 を新設**（正本）し、
> §5 の段階 0・1・2 を 1 つの変更で実装した（共有純関数 `src/utils/workspaceBackupLayout.ts`・書くループ `functions/src/workspaceBackupWriter.ts`・設定 `functions/src/workspaceBackupLayoutConfig.ts`・
> `functions/src/index.ts` の読み手 3 本＋控え＋間引き＋書き手＋取り残しの掃除・クライアント `adminFunctions.ts` の `downloadFirebaseServerAutoBackupJson`）。
> 残りの手順（切り替え・実測・片付け）は §10-7 と台帳 `auto-backup-per-classroom` の次の一手。この文書は実測値・設計案の比較・試算の記録として残す。仕様の中身は §10 が正本で、食い違ったら §10 に従う。
> 関係: Issue #77（会社ごとの分割実行）と進行中テーマ台帳 `backup-per-workspace` を**この計画に吸収**する（§3-5・§5 段階 3）。
> 実測値はすべて 2026-10-28 に本番を読み取り専用（`tools/prod-readonly-token.mjs`）で取ったもの。生徒名を含む JSON はスクラッチ領域にだけ置いた。

## 0. 30 秒で分かる状況

- **今の仕組み**: 15 分ごと（JST 3:15〜8:45 の静音帯は休み → **1 日 73 回**）に、会社（workspace）ごとに全教室を **1 本の JSON**
  （`WorkspaceSnapshot`＝`users`＋`classrooms[]`＋`missingClassroomIds`）にまとめ、Storage `workspace-auto-backups/{ws}/15min/{JST 日時}.json`
  へ非圧縮で書く。要約を Firestore `workspaceAutoBackupSummaries/{日時キー}` に書き、Google Drive へ gzip でミラーする。
- **大きさ（実測）**: main は 4 教室（日大前校 8.38MB・緑が丘校 6.11MB・テスト教室 8.94MB・開発用教室 8.30MB）で **1 本 31.7MB**（gzip にすると 3.0MB）。
  9/7 の 25.3MB から 7 週で約 25% 増えた。1 教室 6〜9MB で、日大前校サイズの教室が 20 あれば 1 本 160〜170MB になる。
- **最初に詰まるのは読む側（試算・要実測）**: 復元用の callable 2 本はメモリ **512MiB** で、どちらも 1 本の JSON を丸ごと読む。
  - 室長の自教室復元・Feature B（`downloadClassroomFromServerAutoBackup`）: 1 教室を返すだけでも、全体をダウンロード → 文字列 → `JSON.parse` する。
  - 開発者の全体復元（`downloadServerAutoBackup`）: 復元前の安全スナップショットとして全教室を組み立て直して書き、そのあと全体をダウンロードして gzip する。
  - どちらも「JSON の 5〜6 倍」程度のメモリを使う見込みで、**日大前校サイズで 1 社 8〜10 教室**あたりから 512MiB を超えそう。
    **最初に壊れるのは、全教室へ公開済みの室長の自教室復元**。
  - 生成側（`createWorkspaceServerQuarterHourlyBackups`）は 10/22 に **540 秒/2GiB** へ増強済み（オーナー文面の「512MiB」は復元側の callable の値）。
    20 教室で 1〜1.3GB、30 教室で 2GiB に近づく見込み。処理時間は 1 教室 1.5〜2 秒なので、時間より先にメモリで詰まる。
  - Drive（上限 15GB）は、400 日保持で 20 教室なら約 8GB、30 教室なら約 12GB になる。
- **期限**: main だけなら 4 教室なので急がない。ただし **2 社目（別 workspace・約 10 教室）を受け入れる前に段階 2（書く側の切り替え）まで**終える。
  新しい教室は最初は小さいが、日大前校は 5 月から 10 月の 5 か月で 8MB に育った。
- **推奨方針（未確定）**: 教室ごとに 1 本（gzip）＋時点ごとの目次（index）。保持の規則・一覧・復元画面の見え方は変えない。
  移行は 2 段で、先に両方の形式を読める版を出し、そのあと書く形式を切り替える。

## 1. 読む順（着手前に必ず）

1. `docs/spec-save-restore.md`: §4（復元）・§4-1（室長の自教室復元）・§5（JSON）・§7（Feature B）・§8（8-1 #7〜#10・#14・8-1a・8-2・8-3・**8-4 変更時の手順**）・
   §9-2 の K-7・K-8・K-11・§9-5-3・§9-6 の「自動バックアップ・Drive・開発者のワークスペース書き出し」行・AC-21。
2. `docs/spec-invariants.md`: INV-08（教室分離）・INV-14（教室データの全か無か）。マトリクス `src/utils/inv14-snapshot-all-or-nothing.matrix.test.ts`
   の「行: 自動バックアップ」は `buildWorkspaceServerBackupSnapshot` のコード片を文字列で検査しているため、書き換えるときは**同じ push で、検査を弱めずに**追従させる（弱めるなら台帳改定とオーナー承認が要る）。
3. memory: `komahyou-backup-3tier-and-scheduler-role`（間引き・静音帯・新しいスケジュール関数の権限の罠・CI で Drive の env が消える罠）、
   `komahyou-firebase-cost-scaling`（費用の主役は書き込み回数と関数時間・incident 46.8GB 残置・`.select()`・独立した時間予算）、
   `komahyou-manager-self-restore`、`komahyou-classroom-restore-cross-contamination`、`komahyou-snapshot-1mib-capacity-incident`、`komahyou-parallel-agent-worktrees`。
4. コード（行番号は 2026-10-28 の main・v1.5.657 時点）:

| 役割 | 場所 |
|------|------|
| 生成 | `functions/src/index.ts` `createWorkspaceServerQuarterHourlyBackups`（L3317・540 秒/2GiB）→ `runWorkspaceServerAutoBackup`（L3798）→ `buildWorkspaceServerBackupSnapshot`（L1396） |
| 手動実行 | `triggerWorkspaceServerAutoBackup`（L3790・300 秒/1GiB・開発者のみ・静音帯でも実行） |
| 間引き | `pruneWorkspaceServerAutoBackups`（L1451）・Drive は `pruneWorkspaceGoogleDriveBackups`（L832） |
| Drive | `upsertWorkspaceGoogleDriveBackup`（L741）・`buildGoogleDriveBackupFileName`（L703）・`GOOGLE_DRIVE_*`（L128〜135） |
| 復元前の控え | `writeWorkspaceIncidentBackup`（L863）・掃除 `pruneWorkspaceIncidentBackups`（L3353・90 日） |
| 復元の callable | `downloadServerAutoBackup`（L3046）・`listDevelopmentClassroomBackupSources`（L3107）・`downloadClassroomFromServerAutoBackup`（L3138）（3 本とも 120 秒/512MiB） |
| 純ロジック | `functions/src/workspaceBackupSchedule.ts`（パス・表示名・`shouldKeepWorkspaceAutoBackup`・静音帯・日次 400 日・gzip・最小化 JSON・incident 90 日） |
| クライアント | `src/integrations/firebase/adminFunctions.ts`（L498〜670: 一覧 2 種・全体ダウンロード・手動実行・Feature B・教室単位ダウンロード）／`src/App.tsx`（L3431 ローカル同期フォルダ・L5371/5385 JSON 読込 2 種・L5421 一覧・L5446 手動実行・L5491 開発者の全体復元・L5522〜5566 Feature B・L5639〜5678 室長の自教室復元）／`src/utils/workspaceBackupImport.ts`／`src/components/backup-restore/managerSelfRestore.ts`／`src/components/developer-admin/DeveloperAdminScreen.tsx`（一覧と Drive 状態の表示）／`src/utils/backupRetentionEstimate.ts`（保持本数の見積り・スペックロック） |
| ツール | `tools/snapshot-diff.mjs`（`classrooms[]` を持つ JSON をワークスペースバックアップと判定する） |
| 運用文書 | `docs/runbooks/rollback.md` C（記述が古い: 「毎時 3 日・日次 14 日」「`hourly/` パス」）・`docs/runbooks/company-onboarding.md` 手順 4（`hourly/` パスが古い）・`docs/runbooks/monitoring.md` §6 |

5. Issue #77・`docs/spec-multi-tenant.md` §7-16・`docs/plan-2026-09-15-multi-company-architecture.md` §6-13 / §10-5・台帳 `src/utils/developmentStatusLedger.ts` の `backup-per-workspace`。
6. `.claude/skills/solo-git-workflow` / `regression-guard` / `safe-release`（CLAUDE.md の必須手順）。

## 2. 現状の仕組み（事実）

### 2-1. 生成（`runWorkspaceServerAutoBackup`）

1. `workspaces` を全件読み、**会社ごとに順番に（直列で）**処理する。
2. `buildWorkspaceServerBackupSnapshot(onAssemblyFailure: 'exclude')`: members・classrooms・classroomSnapshots を全件読み、教室ごとに順番に
   `readClassroomSnapshotPayload`（分割形式なら部品を組み立てる）を呼ぶ。組み立てられない教室は除いて `missingClassroomIds` に入れ、開発者へ通知する（INV-14・AC-21）。
3. `serializeWorkspaceBackupJson`（字下げなしの JSON）→ Storage へ書く（非圧縮・`resumable: false`）。
4. 要約 `workspaceAutoBackupSummaries/{key}`（`backupDateKey`・`backupKind: 'quarterHourly'`・`displayLabel`・`savedAt`・`sourceSavedAt`・`storagePath`・
   `missingClassroomIds`〔空配列でも書く〕）と、workspace 文書の `serverAutoBackupLast*` を書く。
5. `pruneWorkspaceServerAutoBackups`: **毎回、要約を全件読んで**、残さない時点のファイルを消してから要約を消す（ファイル削除の失敗は握りつぶすので、ファイルだけ取り残されることがある）。
6. Drive が設定されていれば、同じ JSON を gzip にして `komahyouapp_{ws}_quarterHourly_{key}.json.gz` を作るか更新し（同じ名前を探して PATCH/POST）、
   **毎回、Drive のファイル一覧を全件取って**間引く。結果を要約と workspace 文書に書く。
- **会社ごとの例外処理が無い**: ループの中に try/catch が無いので、ある会社で Storage への書き込みなどが例外になると、後ろの会社はその回のバックアップが取れない（2 社になると問題になる）。
- 処理時間（実測）: 実行開始（`savedAt`）は 15 分の区切りの約 4 秒後、Storage のファイルができるのは約 9〜13 秒後（直近 60 本の中央値 10.9 秒）。
  4 教室の読み込み・組み立て・書き込みで **5〜9 秒（1 教室 1.5〜2 秒）**。Drive の処理時間はこれに含まれない（ログ閲覧権限が無いので未実測）。

### 2-2. 置き場所と形

| もの | 場所・形 |
|------|---------|
| 15 分ごとの本体（今の唯一の生成物） | `workspace-auto-backups/{ws}/15min/{YYYY-MM-DDTHH-MM}.json`（JST・非圧縮・最小化） |
| 旧形式のパス（読み手のフォールバックだけに残る） | `.../{ws}/hourly/{key}.json`・`.../{ws}/{key}.json`（日次）。本番には**もう 1 本も無い**（2026-10-28 の一覧は 15min だけ・170 本） |
| 要約（一覧の正本） | Firestore `workspaces/{ws}/workspaceAutoBackupSummaries/{key}`。ルールは**ワークスペースのメンバーなら誰でも読める**・書き込み不可 |
| Drive | 設定フォルダに `komahyouapp_{ws}_quarterHourly_{key}.json.gz`（`appProperties` に workspaceKey・backupDateKey・backupKind・savedAt・sourceSavedAt）。本番は OAuth で同期できている（最新の要約は `synced`） |
| 復元前の控え（incident） | `workspace-incident-backups/{ws}/{reason}-{時刻}.json`（全教室・90 日）。今は 2 本・60MB |
| JSON の形 | `{ schemaVersion: 1, savedAt, developerPassword, developerCloud*, currentUserId: '', actingClassroomId: 先頭の教室, users: [全メンバー], classrooms: [{ id, name, contract*, managerUserId, isTemporarilySuspended, temporarySuspensionReason, data }], missingClassroomIds?（1 件以上のときだけ） }` |

### 2-3. 保持（§8-2・正本は spec）

- 0〜24 時間は 15 分ごと全部・24〜72 時間は JST の毎時 0 分だけ・72 時間〜400 日は JST 3:00 だけ・400 日を超えたら削除。Storage と Drive で同じ判定を使う（`shouldKeepWorkspaceAutoBackup`。Drive の旧形式の非圧縮 `.json` だけ 7 日）。
- 実物（2026-10-28）: **170 本・5.38GB**。いちばん古いのは 2026-08-28 3:00。8/28〜9/4 の 3:00 の分は字下げつき JSON（約 56MB・9/5 から最小化で 25MB）。日次の 400 日保持は 9/4 から積み上がっている途中で、定常状態の約 520 本（静音帯を引くと 73＋48＋397）にはまだ達していない。

### 2-4. 復元の入口（4 系統）とそのほかの読み手

| # | 入口 | 画面・クライアント | サーバー | 読み方・メモリ | 権限 |
|---|------|------------------|---------|--------------|------|
| 1 | **開発者の全体復元** | 開発者画面 → `restoreServerAutoBackup` → `downloadFirebaseServerAutoBackup` → `parseWorkspaceSnapshot` → 教室選択モーダル（`openDeveloperRestoreModal`）→ 選んだ教室だけ保存 | `downloadServerAutoBackup`: 要約 → **`writeWorkspaceIncidentBackup`（全教室を組み立てて書く）**→ ファイル全体をダウンロード → gzip+base64 で返す | 1 回の呼び出しで全体を 2 回メモリに持つ。応答は全体の gzip | 開発者 |
| 2 | **Feature B**（開発用教室へ他教室の時点を読み込む） | `listDevelopmentClassroomBackupSources` → `downloadClassroomFromFirebaseServerAutoBackup` → ディープクローン＋共有トークン除去 → 開発用教室だけ保存 | 一覧は要約を新しい順に 200 件＋教室一覧。取得は #3 と同じ callable | 全体をダウンロード → `toString` → `JSON.parse` → 1 教室を探す | 開発者・検証用教室の室長 |
| 3 | **室長の自教室復元**（§4-1・全教室公開済み） | `listRecentFirebaseServerAutoBackupSummaries`（直近 3 日・Firestore を直接読む）→ `prepareOwnClassroomRestore` → 確認モーダル → 読込 → 室長が保存で確定 | `downloadClassroomFromServerAutoBackup`（担当教室か、開発者か、検証用教室の室長だけ） | 同上（1 教室のために全体を読む） | 担当教室の室長 |
| 4 | **JSON 読込** | 教室画面 `importBackup`（開いている教室だけ・`resolveWorkspaceBackupImportTarget`）／開発者画面 `importWorkspaceBackup`（教室選択モーダル）。`readBackupFileText` が gzip を見分けるので、Drive の `.json.gz` をそのまま読める | なし（手元のファイル） | ブラウザ | 室長・開発者 |

- **そのほかの読み手**:
  - 開発者のローカル同期フォルダ（`syncDeveloperCloudAutoBackups`・App.tsx L3431）: 未同期の時点ごとに `downloadServerAutoBackup` を呼んで、1 時点 1 ファイルで手元へ書く。
    **呼ぶたびに全教室ぶんの復元前の控え（incident）が 1 本ずつ書かれる**（今も起きている副作用。2026-05 の 46.8GB 残置と同じ構造）。使われているかは要確認。
  - 開発者画面の一覧と Drive の状態（`listFirebaseServerAutoBackupSummaries`・`DeveloperAdminScreen.tsx`）。要約の `storagePath` と Drive の項目を表示する。
  - 容量の見積り（App.tsx L2085〜・`backupRetentionEstimate.ts`）: 「1 時点の大きさ × 保持本数」で計算している。
  - `tools/snapshot-diff.mjs`: `classrooms[]` があればワークスペースバックアップと判定し、複数教室なら `--classroom` が必要。
  - 運用手順: `rollback.md` C・`company-onboarding.md` 手順 4・`monitoring.md` §6。

### 2-5. 1 本の JSON の形に依存している箇所（grep・2026-10-28・テストを含む行数）

| 検索語 | 行数（ファイル別） |
|--------|------------------|
| `workspaceAutoBackupSummaries` | index.ts 5・adminFunctions.ts 2・firestore.rules 1 |
| `missingClassroomIds` | index.ts 10・workspaceBackupImport.ts 2（テスト 3）・inv14 マトリクス 4・developmentStatusLedger.ts 1 |
| `buildWorkspaceAutoBackupStoragePath` | index.ts 4・workspaceBackupSchedule.ts 1（テスト 5） |
| `summary.storagePath` | index.ts 6（間引き・全体ダウンロード・教室単位ダウンロード） |
| `buildWorkspaceServerBackupSnapshot` | index.ts 3（生成・incident・定義）・inv14 マトリクス 2・workspaceBackupImport.ts 1（コメント） |
| `snapshot.classrooms` | App.tsx 10（テスト App.test.ts 8）・workspaceBackupImport.ts 2・index.ts 1（教室単位ダウンロードの `find`） |
| `parseWorkspaceSnapshot` | App.tsx 4・appSnapshotRepository.ts 1（テスト 12） |
| `resolveWorkspaceBackupImportTarget` | App.tsx 2・workspaceBackupImport.ts 1（テスト 8） |
| `downloadServerAutoBackup` / `downloadClassroomFromServerAutoBackup` | index.ts 4/1・adminFunctions.ts 1/1・managerSelfRestore.ts 0/1（コメント） |

- 着手時に `grep -rIa` で数え直す（App.tsx は Git 上で `-text` 扱いなので `-a` が必要・CRLF）。**サーバー側で 1 本の形を前提にしているのは `index.ts` だけ**で、
  クライアントは「`WorkspaceSnapshot` の文字列を受け取る」ことにだけ依存している。これを利用して、教室ファイル自体を「1 教室だけ入った `WorkspaceSnapshot`」にすれば（§3-3）、JSON 読込とツールは変更なしで読める。

### 2-6. 費用（現状・memory `komahyou-firebase-cost-scaling` の要点）

- 費用の主役は Firestore の書き込み回数と関数の実行時間。Storage の容量は小さい（今 5.38GB）。
- 毎回の固定費として、間引きのために**要約を全件読んでいる**（定常状態で約 520 件 × 月 2,190 回 ≒ 月 110 万回の読み取り。教室数には比例しないが、保持本数に比例する）。
- 分割形式の教室を組み立てると、1 教室あたり目次 1 件＋部品 約 50 件を読む（§9-6 の見込み「15 教室で月 170 万回の読み取り・月 150 円程度」）。これはどの案でも同じ。

## 3. 設計案

### 3-1. 変えないもの（BK-◯・この計画の前提。§9-2 の K-◯ とは別番号）

| # | 守るもの | 根拠 |
|---|---------|------|
| BK-1 | 保持の規則（§8-2）を**時点の単位で**そのまま使う。教室ごとに別の判定をしない。静音帯（3:00 だけは取る）・手動実行は静音帯でも実行、も同じ | §8-2・§8-4（変えるなら spec・定数のスペックロック・CHANGELOG を同じコミットで） |
| BK-2 | 一覧の単位は**時点**（1 時点 1 要約文書・文書 ID は今と同じ `YYYY-MM-DDTHH-MM`）。開発者画面・室長の 3 日窓・Feature B のピッカーの見え方を変えない | §4・§4-1・§7 |
| BK-3 | 復元の入口 4 系統の挙動と権限を変えない（教室選択モーダル／ディープクローン＋共有トークン除去／担当・開いている・復元対象の 3 者一致と確認モーダル／開いている教室が JSON に無ければ止める）。復元は画面へ読み込んでから通常の保存で確定する | §4・§4-1・§5・§7・INV-08 |
| BK-4 | **旧形式（1 本の JSON・Drive の全体 `.json.gz`）は永久に読める**。変換しない。日次は 400 日残るので、旧形式の実物は 2027 年 12 月ごろまで存在する | §9-2 K-11 と同じ考え方 |
| BK-5 | INV-14: 組み立てられない教室を空で書かない・`missingClassroomIds`・開発者への通知。**書き終わっていない時点を一覧に出さない** | §9-5-3・AC-21 |
| BK-6 | INV-08: 1 つのファイルには 1 教室だけ。読むときに要求の教室 ID・パス・ファイルの中の教室 ID の 3 つを照合する | INV-08 |
| BK-7 | 復元前の控え（incident）は**全教室ぶん**を残す（形式は教室別でよい）。1 教室でも組み立てられなければ、復元用ダウンロードを止める（M-1）。保持は 90 日 | §8-1a |
| BK-8 | Drive は冗長化が目的（長期アーカイブではない）。間引きは Storage と同じ。非対称は旧形式の非圧縮 `.json` だけを 7 日で消すことに限る | §8-3・§8-4 |
| BK-9 | バックアップ処理は Storage と要約だけに書き、教室データ（`classroomSnapshots`）には書かない。バックアップの JSON は教室データ全体（K-8） | §9-2 K-8 |

### 3-2. 案の比較

| 案 | 中身 | 生成のメモリ | 読む側のメモリ（室長の復元） | Storage 容量 | 書き込み回数 | 読み手の改修 | 評価 |
|----|------|------------|--------------------------|------------|------------|------------|------|
| **A（推奨）** | 教室ごとに 1 本（gzip）＋時点の目次 `index.json`。要約に形式の印を付ける | 1 教室ぶん | 1 教室ぶん | 約 1/10（gzip） | 1 回の実行で「教室数＋1」 | callable 3 本＋クライアントの全体復元・同期・間引き・Drive | 教室数が増えても上限に近づかない。JSON 読込とツールはそのまま読める |
| B | 1 本のまま gzip にし、教室ごとに順番に書き出す（ストリーム） | 1 教室ぶん | **全体**（1 教室を取り出すにも全体を解凍して読む） | 約 1/10 | 1 回の実行で 1 | callable 2 本（解凍）だけ | 生成は直るが、最初に詰まる室長の復元が直らない。ストリームで JSON を読む処理を足すと複雑になる |
| C | A に加えて、全体 1 本も書く | 全体（1 本を作るとき。ストリームなら 1 教室ぶん） | 1 教室ぶん | A の約 2 倍 | A＋1 | A と同じ | 旧来の読み手を残せるが、容量と書き込みが 2 倍。日次（3:00）だけ全体も書く、という限定はありうる（§4 Q1） |
| D（直交） | 会社ごとに別の実行に分ける（Issue #77） | 1 社ぶん | 変わらない | 変わらない | 変わらない | 無し | 1 社の失敗をほかの社へ広げない・時間を分散する。A/B/C のどれとも組み合わせられる（§3-5） |

### 3-3. 推奨案 A の中身（確定前の案。確定後に spec §10 へ）

- **置き場所**（文書 ID の規則は今と同じ）:
  - 教室ファイル: `workspace-auto-backups/{ws}/15min/{key}/{classroomId}.json.gz`
  - 時点の目次: `workspace-auto-backups/{ws}/15min/{key}/index.json`（小さいので平文）
  - 旧形式の `15min/{key}.json` とは名前が重ならない（フォルダかファイルかで区別できる）。
- **教室ファイルの形**: 「**1 教室だけ入った `WorkspaceSnapshot`**」（`users: []`・`actingClassroomId: その教室`・`classrooms: [その教室 1 件]`）に、
  照合用の `backupFile: { layout: 'per-classroom-v1', workspaceKey, backupDateKey, classroomId, savedAt, sourceSavedAt }` を付ける。
  → `parseWorkspaceSnapshot`・`resolveWorkspaceBackupImportTarget`・開発者の教室選択モーダル・`tools/snapshot-diff.mjs`（教室が 1 つなら `--classroom` 不要）が**変更なしで読める**。
  Drive から落とした 1 教室ぶんの `.json.gz` も、教室画面の JSON 読込でそのまま読める。
- **時点の目次 `index.json`**: `{ layout: 'per-classroom-v1', schemaVersion, workspaceKey, backupDateKey, savedAt, sourceSavedAt, users（全メンバー）, classrooms: [{ id, file, bytes, sha256, sourceSavedAt }]（今の JSON と同じ並び）, missingClassroomIds: [{ id, reason: 'assembly-failed' | 'write-failed' }] }`。
  目次と教室ファイルがあれば、Firestore が無くても今と同じ全体の JSON を組み立て直せる（Firebase の障害時や Drive からの復旧に使う）。
- **要約文書**: 今の項目はそのまま残し、`layout: 'per-classroom-v1'`・`classroomCount`・`storagePath`（＝`index.json` のパス）を足す。
  **教室の一覧や教室名は要約に載せない**（要約はワークスペースのメンバー全員が読めるので、同じ会社のほかの教室の情報を室長に見せない。一覧は Storage の目次から、サーバーだけが読む）。
  `layout` が無い要約は旧形式として扱う。
- **書く順番（目次は最後に公開する・§9 と同じ考え方）**: 教室ごとに「組み立て → JSON → gzip → Storage → Drive → メモリを解放」を順番に行う
  → すべての教室が終わったら `index.json` → 要約（ここで一覧に出る）→ 間引き。
  - 1 教室の組み立てに失敗: ファイルを書かず `missingClassroomIds`（`assembly-failed`）に入れて通知（今と同じ）。
  - 1 教室の書き込みに失敗: 1 回やり直し、だめなら `write-failed` として同じ扱いにする。その時点はほかの教室ぶんで公開する。
  - 途中で止まった（時間切れ・メモリ不足・例外）: 要約が書かれないので一覧に出ない。残ったファイルは掃除で消す（下記）。
  - 会社ごとに try/catch で囲み、1 社の失敗をほかの社へ広げない（AC-B16）。
- **読む側**（形式は要約の `layout` で分ける。旧形式の処理は今のまま残す）:
  - `downloadClassroomFromServerAutoBackup`（室長の復元・Feature B）: 教室 ID の文字種を検査（`^[A-Za-z0-9_-]+$`・パスの組み立て前に。パス・トラバーサル対策）
    → 目次でその教室が `missing` なら今と同じ not-found → 教室ファイル**だけ**を読み、`backupFile` の 3 点が要求と一致することを確かめてから返す。応答の形は変えない。
  - 開発者の全体復元: 新しい callable（仮名 `prepareServerAutoBackupRestore`）が incident を書き、目次（教室の並び・`users`・`missing`）を返す。
    クライアントは教室ごとに `downloadClassroomFromServerAutoBackup` を呼んで `WorkspaceSnapshot` を組み立て、**今と同じ教室選択モーダル**へ渡す（純関数 `assembleWorkspaceBackup`）。
    旧形式の時点は今の `downloadServerAutoBackup` のまま（旧形式は増えないので、メモリの問題は大きくならない）。
  - ローカル同期フォルダ: 同じ組み立てで 1 時点 1 ファイルを書く（手元のファイルの形は変えない）。**この経路では incident を書かない**（§4 Q8）。
- **復元前の控え（incident）**: `workspace-incident-backups/{ws}/{reason}-{時刻}/{classroomId}.json.gz`＋`index.json` を教室ごとに書く。90 日の掃除はファイルの作成時刻で 1 本ずつ判定しているので、そのまま効く。
- **間引き**（時点の単位）: 今と同じ判定で残さない時点を選び、**教室ファイルと目次（`{key}/` の下を全部）→ Drive → 要約**の順で消す（要約を先に消すとファイルが取り残される）。
  要約を全件読む処理は、24 時間より古い時点に絞るか、1 時間に 1 回にする（任意・§2-6 の読み取りを減らす）。
- **取り残しの掃除**: 要約の無い `{key}/` フォルダのうち、作成から 1 日以上たったものを消す。`cleanupOldSaveAttempts` の巡回に**独立した時間予算**で相乗りさせ、
  最初は空実行（件数だけ数える・`INCIDENT_BACKUP_PRUNE_DRY_RUN` と同じ作法）で実物を確かめる。
- **Drive**: 教室ごとに `komahyouapp_{ws}_quarterHourly_{key}_{classroomId}.json.gz`（`appProperties` に `classroomId` と `layout` を足す）＋`index.json`。
  間引きの判定は今と同じ。ファイル数が教室数倍になる（20 教室で約 1 万本）ので、**Drive の一覧と掃除は 1 日 1 回**（3:00 の回）にする。
- **メモリと関数の設定**: 生成は 1 教室ぶんで済むので、段階 3 の実測のあとで 2GiB を下げてよい（下げるのは任意。費用は CPU 時間が主で効果は小さい）。callable は 512MiB のままで足りる見込み。

### 3-4. 移行（2 段・一方通行ではない）

- **段階 1（両方を読める版）**: 読む側だけを出す。書く側は旧形式のまま。教室別形式の時点は、テストのフィクスチャと staging で手作りした時点で確かめる。
- **段階 2（書く側の切り替え）**: サーバーの設定（仮名 `WORKSPACE_AUTO_BACKUP_LAYOUT`・会社ごとに指定できる）で、staging → 本番の main の順に教室別形式で書き始める。
  **元に戻せる**: 設定を戻せば次の回から旧形式で書く（両方の形式が混ざっても、要約の `layout` で読み分けるので壊れない）。§9 の分割保存と違って、一方通行にする理由は無い。
- 古い画面（ブラウザのキャッシュ）について: 室長の自教室復元・Feature B はサーバー側の callable が形式を吸収するので、古い画面でも動く。
  開発者の全体復元だけはクライアントの変更が要るので、**段階 1 の Hosting を段階 2 より前に出しておく**。古い画面の開発者が教室別形式の時点を全体復元しようとした場合、
  旧 `downloadServerAutoBackup` は「この時点は新しい形式です。画面を再読み込みしてください」と分かるエラーを返す（空や一部の JSON を返さない・INV-14）。

### 3-5. 会社ごとの分割実行（案 D・Issue #77）との関係

- A にすると、メモリは教室数に比例しなくなり、時間は 1 教室 1.5〜2 秒のまま（30 教室で約 1 分。540 秒の枠に十分収まる）。そのため、D の主な目的（時間とメモリ）は A でほぼ達成できる。
- 残る D の価値は「1 社の失敗をほかの社へ広げない」ことだが、これは A の段階 2 で入れる会社ごとの try/catch で足りる。
- 推奨: **D は後回し**（1 回の実行が 300 秒を超えたら、または 3 社目のときに着手）。Issue #77 は「教室別化で吸収・分割実行は条件つきで後回し」としてコメントし、台帳 `backup-per-workspace` をこの計画の段階へ書き換える（§4 Q7）。

## 4. 論点（**2026-10-28 オーナー確定: Q1〜Q9 すべて (1) の推奨案**。聞き直さない）

| # | 論点 | 選択肢（**決定＝各行の (1)**） |
|---|------|--------|
| Q1 | 教室別に分けたあと、**全体を 1 本にしたファイルも残すか** | (1) **残さない（推奨）**: 目次と教室ファイルから同じ全体を組み立て直せる（関数・ツールで）。 (2) 日次（3:00）の回だけ全体 1 本も書く（案 C を限定。容量は日次の分だけ約 2 倍）。 (3) 毎回両方書く（案 C） |
| Q2 | Storage 側も **gzip** にするか | (1) **教室別化と同時に gzip（推奨）**: 容量が約 1/10 になる。どのみち読む側を直すので、追加の手間は小さい。 (2) 非圧縮のまま（読み手の解凍が要らないが、20 教室で 83GB・月 ¥300 程度） |
| Q3 | **日次（400 日保持）も教室別にするか** | (1) **同じく教室別（推奨）**: 日次は 3:00 の回を残しているだけなので、同じ形式にすると単純。 (2) 日次だけ全体 1 本（Q1-(2) と同じ） |
| Q4 | **Drive のミラーの単位** | (1) **教室ごとの `.json.gz`・保持は Storage と同じ・Drive の掃除は 1 日 1 回（推奨）**。30 教室で約 12GB（15GB 上限の 80%）になるので、**25 教室を超えたら Drive の日次保持を短くするか再判断**。 (2) Drive には日次（3:00）だけ送る（Firebase 障害時に手元にあるのが最大 1 日前になる）。 (3) Drive だけ全体 1 本（ストリームでつないで書く。実装が複雑） |
| Q5 | **復元画面の見え方** | (1) **変えない（推奨）**。 (2) 開発者画面の一覧に「教室が欠けた時点」の印を付ける（開発者だけ・室長の画面は変えない） |
| Q6 | **間引きの単位** | (1) **時点の単位で、フォルダごと消す＋取り残しの掃除（推奨）**。 (2) 教室ファイルごとに判定（教室ごとに保持を変えられるが、BK-1 に反するのでしない前提） |
| Q7 | **会社ごとの分割実行（Issue #77）を同時にやるか** | (1) **教室別化を先に、分割実行は条件つきで後回し（推奨・§3-5）**。 (2) 同時に行う |
| Q8 | **復元前の控え（incident）と開発者のローカル同期** | (1) **控えは全教室ぶんを教室別で残す。ローカル同期フォルダの経路では控えを書かない（推奨）**。 (2) 今どおり（同期 1 時点ごとに控えが 1 本ずつ書かれる） |
| Q9 | **期限** | (1) **2 社目の受け入れの前に段階 2 まで（推奨）**。 (2) main が 6 教室を超える前まで（2 社目が先に来る場合は (1) と同じ） |

- ユーザビリティへの影響: 推奨案（Q5-(1)）では、室長と開発者の画面の見え方・手数は変わらない。開発者の全体復元は、教室ごとに取得するぶん待ち時間が変わる可能性がある（20 教室で数十秒・段階 1 で実測）。
  見え方を変える選択肢（Q5-(2)）を選ぶ場合は、開発者画面だけなので室長への影響は無い。

## 5. 実装の順序

各段で dev-fix → regression-reviewer（BK-1〜BK-9・INV-08・INV-14）→ safe-release。**変更には必ずテストを付ける**。CHANGELOG・確認リスト・台帳を更新する（CLAUDE.md）。

### 段階 0: 共有の純関数（新規 `src/utils/workspaceBackupLayout.ts`・仮名）
- 中身: パスの組み立て（教室 ID の文字種検査つき）・教室ファイルの組み立てと検査（`backupFile` の 3 点照合）・`index.json` の組み立てと検査・要約の `layout` 判定・
  全体の組み立て直し `assembleWorkspaceBackup(index, files)`・間引きで消すパスの一覧・取り残しの判定。
- サーバーへは `functions/scripts/sync-shared.mjs` で複製し、パリティテストで同じ内容であることを確かめる（`classroomSnapshotParts.ts` と同じ作法）。
- テスト: 「今の `buildWorkspaceServerBackupSnapshot` の結果」と「教室ごとに分けて組み立て直した結果」が `stableStringify` で一致すること（`missingClassroomIds` あり・なし、教室 0 件・1 件）。
  教室 ID に `../`・`/`・空文字が入ったら拒否すること。中身の教室 ID が違うファイルは拒否すること。

### 段階 1: 両方を読める版（書く側は旧形式のまま）
- サーバー: `downloadClassroomFromServerAutoBackup` と `downloadServerAutoBackup` で `layout` によって読み分ける。新しい `prepareServerAutoBackupRestore` を作る。
  `writeWorkspaceIncidentBackup` を教室ごとに書く形にする（BK-7）。間引きを両方の形式に対応させる。
- クライアント: 開発者の全体復元とローカル同期を「目次 → 教室ごとに取得 → 組み立て」に変える（教室選択モーダルは変えない）。ローカル同期は控えを書かない経路を使う。
- ツール: `snapshot-diff.mjs` のテストに教室ファイル（1 教室の `WorkspaceSnapshot`・gzip）を足す（変更は不要の見込み）。
- テスト: 4 入口それぞれについて、旧形式の時点と新形式の時点のフィクスチャ（INV-08 の照合・INV-14 の missing を含む）。`managerSelfRestore.wiring.test.ts` を追従させる。
  INV-14 マトリクスの「行: 自動バックアップ」を新しい書き方の検査へ置き換える（弱めない）。
- 反映: **Functions → Hosting**（ルールは変えない）。staging に教室別形式の時点を手作りする小さなツール（`tools/`・firebase-admin・staging 専用ガード付き）で、4 入口を実機で確かめる。

### 段階 2: 書く側の切り替え
- `runWorkspaceServerAutoBackup` を教室ごとの逐次処理に変える（§3-3 の順番）。会社ごとの try/catch。Drive を教室ごとにし、Drive の掃除を 1 日 1 回にする。
  取り残しの掃除を `cleanupOldSaveAttempts` に相乗りさせる（独立した時間予算・最初は空実行）。
- 設定 `WORKSPACE_AUTO_BACKUP_LAYOUT`（staging → 本番の main）。台帳 `developmentStatusLedger.ts` に段階を書く。
- テスト: 書く順番（要約が最後）、途中で失敗したら要約を書かないこと、1 教室の失敗で `missing`（`write-failed`）、会社ごとの分離、間引きの消す順番、静音帯と手動実行。
  I/O を差し替えられる形（`runBudgetedDeletionSweep` と同じ作法）にして、ループをユニットテストで直接動かす。
- 反映: **Functions だけ**。staging で `node tools/copy-prod-classroom-to-staging.mjs`（オーナーの PC）を使い、日大前校サイズの教室を写してから切り替え、15 分ごとの生成・間引き・Drive・4 入口を確かめる。
  そのあと本番の main で有効にし、翌朝の掃除ログと Storage の一覧を読み取りで確かめる。
- ⚠️ 新しいスケジュール関数は作らない（既存の関数の中身を変えるだけ）。もし作る場合は、memory `komahyou-backup-3tier-and-scheduler-role` の権限の罠（`gcloud scheduler jobs list` で ENABLED を確かめる）に従う。

### 段階 3: 実測と片付け
- staging に日大前校サイズの教室を 10〜20 用意して、生成と callable のメモリの山と時間を実測する（コピーツールが同じ教室を複数写せるかは要確認。できなければ合成データで測る）。必要なら関数のメモリ設定を見直す。
- 文書を直す: spec §8-1 #7・#8・#10 と §8-2 の容量の行、`backupRetentionEstimate.ts` の見積り（1 時点の大きさが教室ごとの合計になる）、`rollback.md` C（古い記述も一緒に直す）、
  `company-onboarding.md` 手順 4（パス）、`monitoring.md` §6。
- Issue #77 にコメントし、台帳 `backup-per-workspace` を書き換えるか削除する。
- 任意の追加（段階 4・別途判断）: 前回の時点から教室データの版（目次の `saveId`・全体ハッシュ）が変わっていない教室は、組み立てずに Storage 上で前のファイルをコピーする
  （Firestore の読み取りと時間が大きく減る。壊れたファイルを引き継がないよう `sha256` を照合する）。会社ごとの分割実行（案 D）。

### 確認リストに足す項目の案（`verificationChecklist.ts`・接頭辞 `ab-`）
- ab-1（段階 1）開発者画面のサーバーバックアップ一覧から最新の時点を選び、教室選択モーダルで開発用教室だけを選んで復元できる（モーダルの教室の並び・規模が今までと同じ）。
- ab-2（段階 1）開発用教室で、室長の自教室復元（直近の時点 → 確認モーダル → 読み込む → 保存）が今までどおりできる。
- ab-3（段階 2）切り替え後の時点で ab-1・ab-2 と Feature B（他教室の時点を開発用教室へ読み込む・規模の表示が想定どおり）ができる。
- ab-4（段階 2）Drive のフォルダに教室ごとの `.json.gz` が出ていて、1 本を教室画面の「バックアップを読み込む」で開発用教室に読み込める。
- 裏側（Claude が読み取りで確かめる）: Storage の `15min/{key}/` に教室数ぶんのファイルと `index.json` があること、要約の `layout`・`missingClassroomIds`、取り残しの掃除の空実行の件数、時点ごとの作成時刻の間隔（実行時間の代わり）。

## 6. 受け入れ条件（AC 案）と触れる INV

**形式**
- AC-B1 教室別形式の時点を組み立て直した `WorkspaceSnapshot` は、同じ時点を旧形式で書いた JSON と `stableStringify` で一致する（`users`・教室の並び・`missingClassroomIds` を含む）。
- AC-B2 `layout` の無い要約（旧形式）の時点は、4 入口のすべてで今どおり読める（2026-08-28 の字下げつき JSON と今の最小化 JSON の両方のフィクスチャ）。
- AC-B3 教室ファイルは 1 教室だけの `WorkspaceSnapshot` で、教室画面の JSON 読込・開発者の JSON 読込・`tools/snapshot-diff.mjs` が変更なしで読める（gzip のままでも）。

**INV-08（教室分離）**
- AC-B4 室長の自教室復元は、教室別形式の時点では**自分の教室のファイルだけ**を読む（ほかの教室のファイルを開かない）。応答の教室 ID は要求と一致する。
- AC-B5 教室 ID に `/`・`..`・許可外の文字を含む要求は `invalid-argument` で拒否され、Storage を読まない。
- AC-B6 ファイルの中の `backupFile`（workspaceKey・backupDateKey・classroomId）がパスまたは要求と違えば、読み込まずにエラーにする。
- AC-B7 要約には教室名と教室 ID の一覧を載せない（メンバー全員が読めるため）。

**INV-14（全か無か）**
- AC-B8 組み立てに失敗した教室はファイルを書かず、`missingClassroomIds`（`assembly-failed`）に載り、開発者へ通知される。ほかの教室は書かれる（AC-21 を引き継ぐ）。
- AC-B9 1 教室の書き込み失敗も `missingClassroomIds`（`write-failed`）に載り、その時点はほかの教室ぶんで公開される。
- AC-B10 要約を書く前に止まった時点は一覧に出ず、残ったファイルは取り残しの掃除で消える（空実行では件数だけ記録される）。
- AC-B11 古い画面からの全体復元で教室別形式の時点を選んだときは、空や一部だけの JSON を返さず、再読み込みを促すエラーになる。

**保持・間引き・Drive**
- AC-B12 間引きで消す時点は、教室ファイル・目次・Drive・要約がすべて消える。消す順番はファイル → 要約。残す時点のファイルは 1 本も消えない。
- AC-B13 保持期間のスペックロックテスト（`workspaceBackupSchedule.test.ts`・`backupRetentionEstimate.test.ts`）は値を変えずに通る。
- AC-B14 Drive には教室ごとの `.json.gz` が `appProperties`（workspaceKey・backupDateKey・classroomId・savedAt）つきで出て、Storage と同じ規則で間引かれる。Drive の一覧と掃除は 1 日 1 回。

**復元の入口**
- AC-B15 開発者の全体復元で表示される教室選択モーダルの内容（教室の並び・規模・元データの時刻）が旧形式と同じで、選んだ教室だけが保存される。
- AC-B16 復元前の控えは全教室ぶん書かれ、1 教室でも組み立てられなければ復元用のダウンロードは `failed-precondition`（`incident-backup-assembly-failed`）で止まる。教室別の控えも 90 日で消える。
- AC-B17 ローカル同期フォルダの経路では、復元前の控えが書かれない（Q8-(1) を選んだ場合）。

**規模・運用**
- AC-B18 生成のメモリの山は教室数に比例しない（staging の 10〜20 教室で実測。目安は 512MiB 以内【暫定】）。callable 2 本も 512MiB のまま 20 教室の時点を処理できる【暫定】。
- AC-B19 1 社の失敗（例外）があっても、ほかの社のその回のバックアップは書かれる。
- AC-B20 静音帯・手動実行（`triggerWorkspaceServerAutoBackup`）の挙動と応答の形は変わらない。
- AC-B21 確認リスト・台帳・CHANGELOG・spec §8／§10・runbook（rollback C・company-onboarding・monitoring）を段階ごとに更新する。

**触れる INV**
- **INV-08（強制）**: 教室ファイルのパス・中身・要求の照合（AC-B4〜B7）。INV-08 にはマトリクスが無く、経路テスト（`managerSelfRestore`・`workspaceBackupImport`）で担保している。この変更でも経路テストを足す。
- **INV-14（準観察）**: 欠けた教室を空で書かない・書き終わっていない時点を公開しない（AC-B8〜B11）。マトリクス `inv14-snapshot-all-or-nothing.matrix.test.ts` の「行: 自動バックアップ」を書き換え、行を足す（強める方向なので台帳の改定は不要）。
  保証文（「自動バックアップはその教室を空で書かずに除き、開発者へ知らせる」）の範囲に収まるため、**保証文の改定も新しい INV も提案しない**。
  もしオーナーが「書き終わっていない時点を出さない」を独立した保証にしたい場合だけ、INV-14 の範囲への追記を提案する（オーナー承認が必要）。
- INV-07（QR 提出）・INV-03 には触れない（復元しても `lectureSubmissions` は変わらない・BK-3）。

## 7. 数値のメモ（実測と試算）

前提: 日大前校サイズ 1 教室 = 非圧縮 約 8MB・gzip 約 0.75MB（実測は gzip level 6 で 0.62〜0.82MB）。1 日 73 回 → 月 2,190 回。
保持本数の定常値は約 520 本（73＋48＋397）。費用は 1 ドル ¥150・Storage の容量 1GB 月 約 ¥3.5・Storage の書き込み（Class A）1,000 回 約 ¥0.75 とした大まかな値（地域と料金表は要確認）。

| 教室数（1 社） | 1 時点（今の 1 本・非圧縮） | 1 時点（A・gzip 合計） | Storage 定常（今の形式） | Storage 定常（A） | Drive 定常（gzip・今も A も） | Storage の書き込み/月（今 → A） | 生成のメモリの山（今 → A・試算） | callable（室長の復元）のメモリ（今 → A・試算） |
|---|---|---|---|---|---|---|---|---|
| 4（今・実測） | 31.7MB | 3.0MB | 約 16GB（実物は積み上がり途中で 5.38GB） | 約 1.6GB | 約 1.6GB | 2,190 → 約 1.1 万 | 0.2〜0.3GB → 50〜80MB | 約 0.2GB → 1 教室ぶん |
| 5 | 約 40MB | 約 3.8MB | 約 21GB | 約 2GB | 約 2GB | → 約 1.3 万 | 0.2〜0.3GB → 同上 | 約 0.25GB → 同上 |
| 10 | 約 80MB | 約 7.5MB | 約 42GB | 約 3.9GB | 約 3.9GB | → 約 2.4 万 | 0.4〜0.65GB → 同上 | **約 0.45〜0.5GB（512MiB の限界）** → 同上 |
| 20 | 約 160MB | 約 15MB | 約 83GB（月 約 ¥290） | 約 7.8GB（月 約 ¥27） | 約 7.8GB | → 約 4.6 万（月 約 ¥35） | 0.8〜1.3GB → 同上 | 512MiB を超える → 同上 |
| 30 | 約 240MB | 約 23MB | 約 125GB（月 約 ¥440） | 約 12GB（月 約 ¥42） | **約 12GB（15GB の 80%）** | → 約 6.8 万（月 約 ¥50） | 1.2〜1.9GB（2GiB に迫る）→ 同上 | 512MiB を超える → 同上 |

- 生成の時間（今の実測 1 教室 1.5〜2 秒）: 10 教室で 15〜20 秒、20 教室で 30〜40 秒、30 教室で 45〜60 秒（Drive は別）。どの案でも教室数に比例する（段階 4 の「変わっていない教室はコピー」で減らせる）。
- Firestore の読み取り（どの案でも同じ）: 組み立てに 1 教室あたり約 51 件 → 20 教室で月 約 220 万件。間引きのための要約の全件読みが月 約 110 万件（§3-3 で減らせる）。
- Firestore の書き込みは 1 時点 約 3 件のまま（要約を時点ごとに 1 文書にするため、教室数に比例しない）。
- `downloadServerAutoBackup` の応答（全体の gzip を base64 にしたもの）: 20 教室で約 20MB、30 教室で約 31MB。コードのコメントは「応答の上限 約 10MB」だが、gen2 の上限は 32MiB の見込み（要確認）。A では 1 教室 約 1MB。
- メモリの試算の根拠（要実測）: 日本語を含む JSON は V8 で 1 文字 2 バイトの文字列になる（文字列だけで JSON の約 2 倍）。これに組み立てたオブジェクト（数倍）と Buffer のコピー（Storage 保存・Drive 用 gzip）が重なるため、山は JSON の 5〜8 倍と見た。
  callable は「ダウンロードした Buffer（1 倍）＋文字列（約 2 倍）＋`JSON.parse`（2〜3 倍）」で 5〜6 倍と見た。
- 推移（実測）: 8/28 は 56.4MB（字下げつき）→ 9/7 は 25.3MB（9/4 に最小化）→ 10/28 は 31.7MB。

## 8. 確定後に spec へ書く節の骨子（`docs/spec-save-restore.md` §10・次セッションが書く）

```
## 10. 自動バックアップの教室別化 — 2026-xx-xx オーナー確定（Q1〜Q9）
### 10-1. 背景（確定事実・本書 §0・§7 の実測値）
### 10-2. 変えないもの（BK-1〜BK-9・巻き戻し禁止）
### 10-3. 置き場所と形（教室ファイル＝1 教室の WorkspaceSnapshot＋backupFile／index.json／要約の layout・classroomCount／Drive の名前）
### 10-4. 生成（教室ごとに順番に・目次は最後に公開・失敗の扱い・会社ごとの分離・手動実行・静音帯）
### 10-5. 読む側（4 入口と同期・ツール。形式の読み分け・INV-08 の 3 点照合・文字種検査・古い画面の扱い）
### 10-6. 保持と間引き（§8-2 を時点単位で適用・消す順番・取り残しの掃除・Drive は 1 日 1 回）→ §8-1 #7・#8・#10 の行と 8-2 の容量の行をここに合わせて更新
### 10-7. 移行（段階 0〜3・設定 WORKSPACE_AUTO_BACKUP_LAYOUT・戻せること・反映の順番）
### 10-8. 触れる INV（INV-08・INV-14。保証文は spec-invariants.md が正本）
### 10-9. 受け入れ条件（AC-B1〜AC-B21 から確定したもの）
### 10-10. テスト計画（純関数・パリティ・入口ごとのフィクスチャ・INV-14 マトリクスの行・ループの I/O 差し替え・staging の実測）
### 10-11. オーナー確認事項（Q1〜Q9 の結果と日付）
### 10-12. 後回しにしたこと（会社ごとの分割実行・変わっていない教室のコピー・Drive の保持の見直し〔25 教室で再判断〕）
```

- 同じコミットで直す: §8-1 #7・#8・#10 の「実装アンカー」、§8-2 の容量の行（「1 本約 57MB で約 23GB」は古い）、§9-2 K-8 と §9-6 の「自動バックアップ」行（「教室データ全体」は教室ファイルごとに全体、と読み替える注記）、
  `docs/spec-index.md` の保存・復元の行（§10 の追加）。
