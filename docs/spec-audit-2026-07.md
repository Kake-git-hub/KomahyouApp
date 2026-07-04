# 仕様監査台帳（2026-07・全9領域）

> オーナー指示（2026-07-04）: `docs/spec-*.md`（2026-06 確定の To-Be 正本）と現行実装の差分を
> **全9領域について順次監査**し、未定義・矛盾を洗い出して要求仕様を補完する。
> 実施役は `spec-curator` エージェント（Opus）。このファイルが進捗台帳。

## 目的

アプリは「思いつき要望を取り込みながら成長」したため、仕様の未定義領域が意図しないバグの
温床になっている。監査で以下を洗い出し、正本を現実に追いつかせ、未定義をなくす。

## 差分の分類（各領域共通）

- **A: 仕様にあるが実装が違う/未実装** … 正本が正なら実装タスク化。実装が正なら正本を更新。
- **B: 実装にあるが仕様に書かれていない（未定義）** … 挙動を正本に明文化（バグの温床の主対象）。
- **C: 矛盾・判断が必要** … オーナー確認事項として集約し、確定後に正本へ反映。

各所見には「正本の該当箇所」「実装の該当箇所（file:line）」「推奨処置」を付ける。
判断が必要なものは勝手に確定しない（オーナー確認へ）。

## 進捗

| # | 領域 | 正本 | 状態 |
|---|------|------|------|
| 1 | 教室権限・ログイン・開発者画面 | `spec-classroom-auth.md` | 監査済（所見12件：A3/B4/C5・2026-07-04） |
| 2 | 保存・バックアップ・復元 | `spec-save-restore.md` | 監査済（所見12件：A3/B6/C3・2026-07-04）＋確定反映済（C3実装は主セッション） |
| 3 | コマ表の基本配置（テンプレ方式） | `spec-board-regular-placement.md` | 監査済（所見10件：A1/B6/C3・2026-07-04）＋確定反映済（C3削除は主セッション） |
| 4 | 振替ストック | `spec-makeup-stock.md` | 監査済（所見15件：A2/B8/C5・2026-07-04）＋確定反映済（C3復帰UIは Issue #39） |
| 5 | 講習・講習ストック | `spec-lecture-stock.md` | 監査済（所見13件：A3/B7/C3・2026-07-04）＋確定反映済（C1振替えるは Issue #40・C2ゴールデンは主セッション） |
| 6 | 基本データ画面 | `spec-basic-data.md` | 監査済（所見11件：A1/B7/C3・2026-07-04）＋確定反映済（C2 managers撤去は Issue #41） |
| 7 | 特別講習データ・提出ページ | `spec-special-session-submission.md` | 監査済（所見15件：A3/B9/C3・2026-07-04） |
| 8 | 自動割振ルール | `spec-auto-assign-rules.md` | 未着手 |
| 9 | 日程表・PDF | `spec-schedule-pdf.md` | 未着手 |

- 領域4・5（振替/講習ストック）と8（自動割振）は実際に事故・混乱が起きた領域（memory:
  occupied-origin-and-suppressed-makeup / lecture-stock-subject-selection / auto-assign-rules-architecture）。
  監査時は既知事例と突き合わせること。
- 監査で見つかった**修正が必要な差分は GitHub Issue 化**（bug-triage のラベル体系）し、
  この台帳からは Issue 番号で参照する。

---

## 領域別の所見

<!-- spec-curator が領域ごとに追記する。書式:
## 領域N: <名称>（監査日）
### A: 仕様と実装の相違
### B: 仕様に無い実装挙動（未定義）
### C: オーナー確認事項
### 処置（正本更新・Issue化の記録）
-->

## 領域1: 教室権限・ログイン・開発者画面（2026-07-04）

正本 `spec-classroom-auth.md`（2026-06-08 確定 To-Be）と現行実装を突き合わせた。
読み取り監査のみ（コード・正本は未編集、Firestore/本番へは未接続）。file:line は監査時点の値。

**先に「一致している主要点」（差分ではない・記録）**
- ログインは Firebase メール＋パスワード（`src/App.tsx:2908` `signInToFirebaseWithPassword`）。正本A に一致。
- パスワードリセット文言＝「パスワードリセットまたはパスワード変更」（`src/App.tsx:4750`）。正本A・主な差分3 に一致。
- 「AI分析用データ書き出し」は開発者画面に存在しない（`grep` で src 全体 0 件）。正本F・主な差分4 に一致（削除済み）。
- サーバーバックアップ（毎時/日次）復元は開発者画面に集約（`DeveloperAdminScreen.tsx:280-345`）。正本F に一致。
- Google Drive 同期 / ブラウザ同期フォルダ設定UIは現状維持（`DeveloperAdminScreen.tsx:291-298`）。正本F・主な差分5（取りやめ＝現状維持）に一致。
- 管理者メール変更はアプリ内完結（`updateWorkspaceClassroom` が `auth.updateUser({email,...})`、`functions/src/index.ts:1442`、要 developer）。正本E のメール変更に一致。
- 教室削除はパスワード再認証を要求（`src/App.tsx:2626` `reauthenticateFirebaseUser` → `deleteWorkspaceClassroom` が Auth ユーザーも削除、`functions/src/index.ts:1618-1645`）。正本D に一致。
- 一時停止中は室長に停止画面のみ（`src/App.tsx:4886`、`isCurrentClassroomSuspended` は解約済 or 一時停止）。正本B に一致。

### A: 仕様と実装の相違

**A1（最重要）: 「教室を追加」がアプリ内完結でなく、Firebase Console 手動作成＋UID貼付を強制**
- 正本の該当箇所: D「★『教室を追加』はアプリ内で完結（Blaze の Functions が作成）。Spark の『作成済み UID 貼付』分岐は廃止」／主な差分 1・2。
- 実装の該当箇所: `src/components/developer-admin/DeveloperAdminScreen.tsx:591-631`（教室追加モーダルが「Firebase Auth コンソールでアカウントを作成し、UID を貼り付けてください」と案内、`管理者 UID` が必須入力）。`src/App.tsx:2409` `addClassroom` は `managerUserId` があれば `provisionFirebaseWorkspaceClassroomWithExistingUid`（＝UID貼付経路）を呼ぶ。アプリ内完結する `provisionWorkspaceClassroom`（Functions が Auth ユーザー＋初期パスワードを発行、`functions/src/index.ts:1250`／クライアント側は `src/App.tsx:2466`）は実装済みだが、UI が UID 必須のため到達しないデッドパス。
- 推奨処置: 追加UIを「管理者メール（＋任意の初期パスワード）入力 → `provisionWorkspaceClassroom` で発行」に切替え、UID貼付フィールドと Console 案内文言を撤去。ただし現行運用が意図的に Console 発行を選んでいる可能性があり、正本と現行のどちらを正とするかは C1 で要確認。

**A2: 管理者 UID 差し替えも Console 取得 UID の貼付前提（新室長のアプリ内発行が無い）**
- 正本の該当箇所: E「管理者の UID 差し替えができる」「★新しい室長アカウントの発行…はすべてアプリ内で完結」。
- 実装の該当箇所: `DeveloperAdminScreen.tsx:405-439`（「差し替え先 UID」に Authentication で取得した UID を貼付）。`reassignWorkspaceClassroomManager`（`functions/src/index.ts:1332-1399`）は旧 Auth ユーザー削除まで行うが、差し替え先 UID 自体は Console で作る前提。新規室長アカウントをアプリ内で発行する UI 経路が無い。
- 推奨処置: 新室長発行をアプリ内（メール入力→Functions で createUser）に一本化。A1 と同じ方針判断（C1）に含める。

**A3: 個別教室の一時停止／解除 UI が無い（全件一括のみ）**
- 正本の該当箇所: C「開発者は教室を一時停止／解除できる（停止理由付き、一括も可）」。
- 実装の該当箇所: `DeveloperAdminScreen.tsx:254-261` は「契約中教室の一時利用停止（全件一括）」トグル＋一括理由のみ。教室カード（`:353-403`）には契約状態 select（契約中/解約済）はあるが、教室単位の一時停止トグルが無い。App 側も一括 `toggleContractedClassroomsTemporarySuspension`（`src/App.tsx:2677-2699`）のみで、個別 `isTemporarilySuspended` 更新経路が見当たらない（要確認）。
- 推奨処置: 教室カードに個別の一時停止/解除（理由付き）を追加する。実装しないなら「一時停止は全件一括のみ」を正本Cに明記。C2 で要確認。

### B: 仕様に無い実装挙動（未定義）

**B1: `/billing` 開発者向け請求画面が spec-classroom-auth に一切未定義**
- 正本の該当箇所: 記載なし（①は開発者画面としてバックアップ/教室管理までしか定義していない）。
- 実装の該当箇所: `src/components/billing/BillingAutomationScreen.tsx` 全体。導線は開発者画面「生徒数・請求一覧を表示」（`DeveloperAdminScreen.tsx:268`）、ルート判定 `src/App.tsx:1227`／描画 `src/App.tsx:4784`。権限は `canUseBilling = isBillingAllowedEmail(email) && role==='developer'`（`BillingAutomationScreen.tsx:144`、不許可時は `:347-353` で遮断）、サーバは `firestore.rules` の `isBillingDeveloper`（`firebase/firestore.rules:29-39`, `billingMonths` を保護）。
- 推奨処置: 「請求画面＝許可された開発者アカウント限定」「生徒数集計基準（既定15日、`src/utils/billing.ts:41-53,94-97`）」「単価・請求書PDF/Gmail 下書き」を①または別領域として正本化。C3 で扱い方針を確認。

**B2: 請求許可メールの許可リストが2箇所に分散（ドリフト危険・既知事例）**
- 正本の該当箇所: 記載なし。
- 実装の該当箇所: `src/utils/billing.ts:3` `BILLING_ALLOWED_EMAILS`（3件）と `firebase/firestore.rules:32-37` `isBillingDeveloper`（同3件を email/token の二重で列挙）。監査時点では両者一致だが、片方だけ更新すると齟齬。CLAUDE.md／memory `komahyou-billing-developer-account` の既知の温床。
- 推奨処置: 単一ソース化は不可（rules と TS は別実行環境）。追加/削除の同時更新手順を正本かrunbookに明記し、齟齬検知の回帰テストを検討。

**B3: `'local'`（仮ログイン）モード＝`authMode` 分岐が全面的に残存（正本は Firebase 前提）**
- 正本の該当箇所: A「ログインは Firebase のメール＋パスワード認証」。主な差分1「Spark 分岐撤去」。
- 実装の該当箇所: `src/integrations/firebase/config.ts:32-37`（Firebase 未設定時 `mode='local'`）、仮ログインのアカウント選択UI（`src/App.tsx:4808-4830` 付近「認証方式をまだ確定していないため…」）、`authMode: 'local'|'firebase'` 分岐が DeveloperAdminScreen / BillingAutomationScreen 全面に残る。`sparkManualAdminMode` 自体は撤去済み（config.ts:56 コメント）だが、local 仮ログインと Console 手動案内文言は残存。
- 推奨処置: local は開発時専用（本番は firebase 固定）である旨を正本に注記するか、撤去方針を確定。C4 で要確認。

**B4: `contractStatus` の値 `'suspended'` が「解約済」を意味し、一時停止(`isTemporarilySuspended`)と語が衝突**
- 正本の該当箇所: C「契約状態（契約中／解約済）」。
- 実装の該当箇所: `src/types/appState.ts:150` `contractStatus: 'active'|'suspended'`、ラベル `'suspended'→'解約済'`（`DeveloperAdminScreen.tsx:108-110,380-386`）。一方 `isTemporarilySuspended` が「一時停止」。`src/App.tsx:1370` は `isCurrentClassroomCancelled = contractStatus==='suspended'`。値名 suspended が「解約」と「一時停止」で紛らわしく、回帰の温床。
- 推奨処置: 値名整理（例 `'cancelled'`）は保存データ移行が要りコスト高。最低限データ辞書（active=契約中 / suspended=解約済 / isTemporarilySuspended=一時停止）を正本に明記。C5 で扱いを確認。

### C: オーナー確認事項

- **C1**: 教室追加・新室長発行を「アプリ内 Functions 発行」に統一するか、現行の「Console 発行＋UID 貼付」を正とするか（→A1/A2、正本D/E・主な差分1・2）。Functions（`provisionWorkspaceClassroom` 等）は実装済みで、UI 切替のみで実現可能。
- **C2**: 個別教室の一時停止/解除 UI を追加するか、「一時停止は全件一括のみ」を正とするか（→A3、正本C）。
- **C3**: `/billing` 請求画面を①の正本に取り込むか、別領域として spec 化するか。許可リストの同時更新手順・齟齬検知をどうするか（→B1/B2）。
- **C4**: `'local'` 仮ログインを「開発時専用」として正本に残すか、撤去するか（→B3）。
- **C5**: `contractStatus='suspended'`（＝解約済）の命名を将来整理するか、データ辞書明記に留めるか（→B4）。

### 処置（正本更新・Issue化の記録）— オーナー確定 2026-07-04

- **C1: アプリ内完結に統一で確定** → A1/A2 は実装対象。**Issue #38** 起票（受け入れ条件つき）。
  正本「主な差分」1・2 に監査時点の実情と確定を追記済み。
- **C2: 「一時停止は全件一括のみ」を正に確定** → 正本C を更新済み（A3 は差分でなくなった）。
- **C3: /billing の spec 化・許可リスト整備は現時点では扱わない**（本台帳の B1/B2 の記録のみ残す。
  着手する際は spec-billing.md 新規作成＋許可リスト2箇所の同時更新手順＋齟齬検知テストを推奨）。
- **C4: `'local'` 仮ログインは開発時専用として存置**（文書化のみ）→ 正本A・主な差分1 に注記済み。
- **C5: `suspended`＝解約済の語衝突はデータ辞書明記に留める**（改名しない）→ 正本C に追記済み。

## 領域2: 保存・バックアップ・復元（2026-07-04）

正本 `spec-save-restore.md`（2026-06-07 確定 To-Be／2026-06-10 Phase 6 完了時点の訂正含む）と現行実装を突き合わせた。
読み取り監査のみ（コード・正本は未編集、Firestore/本番へは未接続）。file:line は監査時点の値。
既知事故（memory: save-architecture / classroom-restore-cross-contamination / submission-board-persistence-asymmetry）と突き合わせ済み。

**先に「一致している主要点」（差分ではない・記録）**
- デバウンス 5秒／最大 20秒（`src/App.tsx:4057-4060` `AUTOSAVE_DEBOUNCE_MS=5000`/`AUTOSAVE_MAX_WAIT_MS=20000`）。正本§1・現状精査#1 に一致。
- 保存経路は Cloud Function `saveClassroomSnapshot` 一本（`functions/src/index.ts:1610`、クライアント `saveClassroomSnapshotViaFunction`、`src/App.tsx:1853`）。全教室が同一経路。正本§1「Firebase が唯一の正本」に一致（memory save-architecture の一本化に整合）。
- 二段階保存（IndexedDB/localStorage）＝クラッシュ復旧用キャッシュとして維持（`saveWorkspaceSnapshot`、pending-remote マーカーで前回終了時の未同期データを復元、`src/App.tsx:3936-3958`）。正本§1「2026-06-10 訂正・二段階保存は維持」に一致。
- 保存失敗時：自動リトライは manual-stability の 3 回まで（transient のみ、`src/App.tsx:1846-1868`）→ 恒久失敗時は JSON 自動DL＋再ログイン指示ダイアログ（`src/App.tsx:1928-1939` `SAVE_FAILURE_GUIDANCE_MESSAGE`、`saveBoard` 側 `:3054-3060`）。正本§2 に一致（transient 再試行は §2「自動リトライしない」に対する差分候補→後述 C1）。
- オフラインは全面ブロック（`src/components/OfflineGate.tsx`、Firebase 有効時のみ、接続回復で自動解除）。正本§3・現状精査#6 に一致。
- 復元は教室画面から JSON 読み込み一本＋Undo（`src/components/backup-restore/BackupRestoreScreen.tsx:10-11,229-238`）。サーバー/ローカル自動/rollback の教室画面 UI は削除済み。正本§4・現状精査#7 に一致。
- サーバーバックアップ復元は開発者画面のみ（`DeveloperAdminScreen.tsx:280-345` 一覧、`src/App.tsx:4372` `restoreServerAutoBackup`→教室選択モーダル）。正本§4 に一致。
- 復元は「選択した教室だけ」を明示 `targetClassroomIds` 指定で保存し他教室に触れない（`src/App.tsx:2865-2879` `confirmDeveloperRestoreModal`、`resolveWorkspaceSyncTargetClassrooms` `:515-528`）。正本§4「この教室だけに効く」に一致（クロス汚染インシデントの再発防止が実装で担保）。
- 教室単位 JSON 書き出し＝この教室フルスナップショット（`src/App.tsx:4222-4241` `exportBackup`＝AppSnapshot 完全形式、テンプレ・設定・盤面・ストック含む）。読み込み `importBackup`（`:4264-4300`）は confirm で「現在のデータは上書きされます」警告。正本§4「元に戻せません警告」・§5「完全復元」に一致。
- ファイル名は日本語＋日時入り（`formatBackupFileName`、例「手動バックアップ_…」「開発者バックアップ_…」）。正本§5 に一致。
- 週トリミング（今日の前6週〜先26週＋手動編集週のみ保持）を保存・読込の両方で適用（`src/components/schedule-board/boardWeekTrim.ts`、読込 `applySnapshot` `src/App.tsx:1969-1993`、保存 `syncCurrentClassroomData`）。正本§1 補足「週数の上限トリム」に一致。
- 自動バックアップ保持＝毎時72時間（3日）・日次14日（`functions/src/index.ts:27-28`）。CLAUDE.md 記載に一致。
- 開発用教室コピー室長開放は見送り＝現状維持（Feature B の他教室バックアップ読込は開発者 or 開発用教室室長のみ、`functions/src/index.ts:1702-1717`）。正本§7・オーナー決定（2026-06-10）に一致。

### A: 仕様と実装の相違

**A1: 教室画面の離脱時が「手動保存の強制」でなくブラウザ標準の離脱確認ダイアログ**
- 正本の該当箇所: §1「閉じる／タブ切替（日程表タブ以外）で未保存があれば、離脱前にダイアログを出して**手動保存させる**」／主な差分 4「離脱時（未保存）**ダイアログで手動保存強制**（日程表タブ除く）」。
- 実装の該当箇所: `src/App.tsx:4112-4135`（`beforeunload` で未保存/保存中/同期中なら `event.preventDefault()`＝ブラウザ標準の離脱確認。同時に `writeWorkspaceToLocalStorageSync` で同期ローカル保存）＋ `:4139-4154`（`visibilitychange` hidden で Firebase 自動同期）。「日程表タブ以外」というタブ単位の判定は無く、ブラウザ離脱イベント全体が対象。アプリ内の「手動保存させるダイアログ」ではない。
- 推奨処置: 正本の現状精査#4 で既に「✅ 済（同等）」＝二重安全網は充足と判定済み。実装を正とし、正本§1・主な差分4 の文言を「ブラウザ標準の離脱確認＋離脱時ローカル/リモート同期で代替（アプリ内強制保存ダイアログは設けない）」に更新するのが妥当。判断は C1 に含める。

**A2: 「日程表タブ以外で」という離脱ダイアログの適用範囲が実装に無い**
- 正本の該当箇所: §1・主な差分4「（日程表タブ除く）」。
- 実装の該当箇所: `src/App.tsx:4112`（`handleBeforeUnload` は screen/tab を条件にしていない。未保存判定は `buildCurrentDataSignature() !== cleanSignatureRef.current` のみ）。日程表タブ（生徒/講師日程表）だけダイアログを出さない、という分岐は存在しない。
- 推奨処置: A1 と一体。実装が「タブに関係なく未保存があれば離脱確認」で統一されているなら、正本の「日程表タブ除く」記述を削除（＝タブ非依存に統一）する。C1 で確認。

**A3: サーバーバックアップ復元モーダルに「元に戻せません」の不可逆警告文言が無い**
- 正本の該当箇所: §4「復元時は確認モーダルで『元に戻せません』と警告してから実行」。
- 実装の該当箇所: 開発者画面の復元モーダル（`DeveloperAdminScreen.tsx:534-564`）は「復元する教室を選択」＋「元データ日時」表示のみで、不可逆である旨の警告文言が無い。教室単位 JSON 読み込み（`importBackup` `src/App.tsx:4285-4290`）と開発用教室への他教室読込（`:4451-4457`）には confirm で「上書きされます」明示があるが、サーバー復元→教室選択モーダル経路には無い（ただし復元後は state に載るだけで Firebase 反映は保存操作を伴う二段構え）。
- 推奨処置: 復元モーダルに「復元すると選択教室の現在データは上書きされ、元に戻せません」を明示。実装コストは文言追加のみ。C 扱いにはせず実装対象候補（軽微 A）。

### B: 仕様に無い実装挙動（未定義）

**B1（最重要）: 楽観ロック（版数 version）による多端末上書き防止が正本に未定義**
- 正本の該当箇所: 記載なし（§1 は「1端末でオンライン作業」を想定運用として述べるのみで、多端末競合時の挙動を定義していない）。
- 実装の該当箇所: サーバー `functions/src/index.ts:1530-1542` `resolveOptimisticVersionDecision`（保存ごとに version+1、クライアント送信の `baseVersion` とサーバー版数が不一致なら `failed-precondition` で拒否）。クライアント `src/App.tsx:1760-1762`（`remoteStaleConflictRef` で以後のクラウド同期を停止）＋ `:1897-1919`（衝突時は JSON 自動DL＋「別端末で更新された・再読み込みを」ダイアログ、ローカル保存は継続）。版数レジストリ `src/integrations/firebase/workspaceStore.ts:648-653`。
- 推奨処置: 「クラウド保存は楽観ロックで、読込時版数と異なれば上書きせず拒否→このタブは JSON 退避＋同期停止し再読込を促す」を正本§1 または §2 に明文化。想定運用（1端末）を破った場合の唯一の防波堤であり、未定義のままだと将来の変更で誤って外されるリスク（memory total-review: 多端末上書きは版数照合・時刻比較不可）。

**B2: 保存時の3層防御（データ喪失防止・読み戻し検証・冪等 saveId）が正本に未定義**
- 正本の該当箇所: 記載なし。
- 実装の該当箇所: `functions/src/index.ts:326-339` `assertNoSnapshotDataLoss`（既存に管理データがあるのに空データで上書きしようとしたら拒否）、`:1574-1587`（保存後に読み戻して payloadHash 一致を検証、不一致なら `internal` で失敗＝サイレント破損防止）、`:1495-1517`（saveId による冪等リプレイ：同一 saveId・同一内容は再保存せず verified を返す／内容違いは `already-exists`）。
- 推奨処置: これらの安全網を正本§2 付近に明記（「空データ上書き拒否」「保存後読み戻し検証」「saveId 冪等」）。特に空データ上書き拒否はクロス汚染・偽 dirty での破壊を止める要（memory classroom-restore-cross-contamination の各真因への防御）で、消してはならない意図的ガードである旨を残す。

**B3: QR提出反映の起動時自己修復 reconcile が正本（保存領域）に未定義**
- 正本の該当箇所: 記載なし（QR 提出反映は領域7だが、「保存の非対称と自己修復」は保存領域の論点）。
- 実装の該当箇所: `src/components/schedule-board/ScheduleBoardScreen.tsx:3135` `reconcileSubmittedTeacherPlacements`（純関数）、呼び出し `:3952`（boardMountKey での教室ロード/リロード毎に1回）。`countSubmitted`（自動同期で永続）と盤面配置（手動保存でのみ永続）の永続化経路が非対称で、手動保存前リロードで配置だけ揮発する問題への自己修復（memory submission-board-persistence-asymmetry・v1.5.357）。
- 推奨処置: 「countSubmitted は自動同期・盤面配置は手動保存のみ＝永続化が非対称」「起動時 reconcile で countSubmitted=true なのに未配置の講師を冪等に再配置（部分配置済みは尊重）」を正本のどこか（保存領域の注記 or 領域7）に明文化。取りこぼしの温床を仕様として固定する。

**B4: 開発者向け「開発者バックアップ（全教室ワークスペース）」書き出し/読み込みが§5（1教室）に未包含**
- 正本の該当箇所: §5 は「開いている**1教室分**」の JSON のみ定義。
- 実装の該当箇所: `src/App.tsx:4246-4262`（`exportWorkspaceBackup`＝全教室 WorkspaceSnapshot／`importWorkspaceBackup`＝教室選択モーダル経由で復元）。開発者画面のバックアップUI（`DeveloperAdminScreen.tsx:287-288`）。教室単位（§5）とは別に、開発者用の「ワークスペース全体」書き出し/読み込みが存在する。
- 推奨処置: §5 に「開発者画面のみ：ワークスペース全体（全教室・削除済み教室含む）を1ファイルに書き出し／読み込み時は教室選択モーダルで復元教室を選ぶ」を追記。教室単位と開発者全体の2系統がある旨を明記。

**B5: JSON 読み込みのパスワード引数がデッド（暗号化は廃止済み）**
- 正本の該当箇所: 記載なし（§5 にパスワード概念なし）。
- 実装の該当箇所: `importWorkspaceBackup(file, _password)`（`src/App.tsx:4253` 第2引数は未使用 `_password`）。firebase モードでは空文字を渡し、local モードのみ `requestDeveloperPassword` で prompt（`DeveloperAdminScreen.tsx:220`）。実際の復号は行われない（残骸）。
- 推奨処置: 「JSON バックアップは平文（暗号化なし）」を正本に明記し、パスワード prompt（local 専用の残骸）を将来撤去候補として記録。C 扱いにはしない（明白なデッド）。

**B6: 開発用教室への他教室バックアップ読込（Feature B）の取り違え防止 confirm が正本に未定義**
- 正本の該当箇所: §7 は「開発用教室へコピー＝開発者アカウントで実行可」とのみ。読込元の規模確認や confirm 内容の定義なし。
- 実装の該当箇所: `src/App.tsx:4451-4457`（confirm で「生徒N名/講師N名/テンプレNコマ・想定と違えば取り違えの可能性・中止を」を明示）＋ サーバー側 `functions/src/index.ts:1702-1717`（開発者 or 開発用教室室長のみ許可）。ディープクローン＋共有トークン除去で参照共有を断つ（memory classroom-restore-cross-contamination の第二の真因対策）。
- 推奨処置: 正本§7 を「他教室コピーは廃止し、確定バックアップから開発用教室へ読み込む方式（Feature B）に置換。読込時は規模を提示する取り違え防止 confirm を出し、開発用教室のみへ書き込む」に更新。クロス汚染再発防止の意図的設計である旨を残す。

### C: オーナー確認事項

- **C1**: 離脱時の扱いを「ブラウザ標準の離脱確認＋離脱時同期で代替（アプリ内の手動保存強制ダイアログは設けない・タブ種別で分岐しない）」に正本を合わせるか、正本どおり「日程表タブ以外はアプリ内で手動保存を強制するダイアログ」を新規実装するか（→A1/A2、正本§1・主な差分4。現状精査#4 は「同等・充足」と判定済み）。
- **C2**: 保存失敗時の「transient エラーは最大3回まで自動再試行」（`manualFirebaseSaveStability`）を正本§2「自動リトライしない」の**例外**として明文化してよいか。恒久失敗（非 transient・版数衝突）は再試行せず JSON 退避する現行を正とする想定（→§2）。
- **C3**: A3 の「復元モーダルに不可逆警告文言を追加」を実装対象としてよいか（軽微・文言追加のみ。B1/B2/B3/B4/B6 の正本明文化と同時に反映する想定）。

### 危険と感じた点（記録・確定前）

- **B1/B2 は「意図的な破壊防止ガード」であり、正本に書かれていないまま将来の保存系リファクタで外されると本番データ破壊に直結する。** 楽観ロック（版数）・空データ上書き拒否・読み戻し検証は、いずれも過去のクロス汚染／偽 dirty 上書き（memory classroom-restore-cross-contamination の第一〜第四の真因）への直接的な防波堤。正本の未定義領域＝回帰の温床という本監査の主目的に最も合致するため、確定時に「消してはならないガード」として明記することを強く推奨。
- **A1（離脱時の手動保存強制）を正本どおり実装しようとすると、beforeunload でアプリ内モーダルは出せない（ブラウザ制約）ため、実装は不可能に近い。** 正本の記述自体が現実のブラウザ制約と乖離しており、正本側を実装（＝標準離脱確認＋同期）に合わせる方向（C1）が妥当。安易に「未実装 A」として実装タスク化しないこと。
- 補足（所見外の記録）: Cloud Function `downloadLatestClassroomRollback` はデッドコード。正本§4「rollback UI は削除（Undo で代替）」どおり UI 撤去済みだが、サーバー側の関数本体と、クライアント側の死蔵ラッパー `downloadLatestFirebaseClassroomRollback`＋型 `ClassroomLatestRollback`（`adminFunctions.ts`・呼び出し0件）が残存していた（監査時の「src/ 参照0件」は不正確・ラッパー定義はあった＝訂正 2026-07-04）。→ ブランチ `chore/remove-dead-rollback-download` で両方撤去（書き込み側 `mirrorLatestClassroomRollback`＋ヘルパーは手動復旧用に維持）。マージはオーナー承認待ち（functions 自動デプロイで本番から関数が消えるため）。

### 処置（正本更新・Issue化の記録）— オーナー確定 2026-07-04

- **C1: 実装を正とするで確定** → 正本§1 の離脱時記述を「ブラウザ標準の離脱確認＋離脱時ローカル/リモート同期で代替
  （アプリ内の手動保存強制ダイアログは設けない・タブ種別で分岐しない・`beforeunload` のブラウザ制約が理由）」に更新済み。
  A1/A2 は差分でなくなった（正本を実装に合わせた）。
- **C2: 例外として明文化で確定** → 正本§2 に「transient エラーのみ最大3回まで自動再試行（`manualFirebaseSaveStability`）。
  恒久失敗・版数衝突は再試行せず JSON 退避」を例外として追記済み。
- **C3: 復元モーダルの不可逆警告文言追加を実装対象に確定** → 正本§4 の「元に戻せません」警告必須は維持。
  開発者画面のサーバー復元モーダルに不可逆警告文言が無い（A3）ため、**実装（警告文言＋回帰テスト）は主セッションで対応**。
  受け入れ条件: 「開発者画面のサーバーバックアップ復元モーダルに『復元すると選択教室の現在データは上書きされ、
  元に戻せません』相当の不可逆警告が表示される」。
- **B1〜B6: すべて正本へ明文化済み**（オーナー確認済み）:
  - B1（楽観ロック・版数照合・衝突時の JSON 退避＋同期停止＋再読込促し）→ 正本§1「多端末競合の防止（楽観ロック）」新設。
  - B2（保存時3層防御：空データ上書き拒否・保存後読み戻し検証・saveId 冪等）→ 正本§2「保存時の3層防御」新設。
    B1/B2 とも「過去のクロス汚染事故への意図的な破壊防止ガードであり消してはならない」旨を明記。
  - B3（countSubmitted と盤面配置の永続化非対称＋起動時 reconcile の自己修復）→ 正本§7 に注記として明文化。
  - B4（開発者画面のワークスペース全体〈全教室〉書き出し/読み込み）→ 正本§5-2 として追記。
  - B5（JSON バックアップは平文・local モードのパスワード prompt は残骸）→ 正本§5-3 として追記。
  - B6（他教室コピー廃止→確定バックアップから開発用教室へ読み込む方式〈Feature B・規模提示 confirm・開発用教室のみ書込〉）
    → 正本§7 を更新。

## 領域3: コマ表の基本配置（テンプレ方式）（2026-07-04）

正本 `spec-board-regular-placement.md`（2026-06-07 確定 To-Be／2026-06-08 Phase 3 検証済み）と現行実装を突き合わせた。
読み取り監査のみ（コード・正本は未編集、Firestore/本番へは未接続）。file:line は監査時点の値。
既知事例（memory: template-editing-flow / regular-teachers-only-board-source / move-date-inheritance / student-drag-move）と突き合わせ済み。

**重要な前提（正本の二層構造）**: 本領域の正本 `spec-board-regular-placement.md` は**上位方針**（テンプレ一本化・月次上限撤廃・
毎週在籍配置・休校ルール・色分け撤廃）を定義し、テンプレ挙動の**細部の正本は別書 `spec-template-behavior.md`（Q1-Q20・
2026-06-09 確定）** にある（反映日境界・凍結 `templateFreezeBeforeDate`・休日との力関係・overwrite 時のストック返却/相殺・
単年度生成・履歴3件・入会前配置 等）。実装は両書を根拠に組まれている（コード内コメントが両書の Q番号を参照）。
**この二層関係が上位正本に明記されていない**ため、後述 B1 で扱う。

**先に「一致している主要点」（差分ではない・記録）**
- 通常授業の生成元は `buildRegularLessonsFromTemplate`（テンプレ）に一本化（`src/components/regular-template/regularLessonTemplate.ts:258`）。正本§1・実装状況に一致。
- 月次上限（`capRegularLessonDatesPerMonth`）は撤廃済み（src 全体で 0 件）。実配置 `buildManagedRegularLessonsRange`（`ScheduleBoardScreen.tsx:1972`）に月上限 slice が無く、該当曜日の全日付へ毎週配置（`getScheduledDatesInMonth`）。正本§2・撤廃概念に一致。
- 在籍期間フィルタ＝入塾/退塾/学齢で毎週判定（`isActiveOnDate`、`ScheduleBoardScreen.tsx:2011-2022`）。正本§2「在籍期間中の週だけ」に一致。
- 休校ルール＝forceOpenDates 優先 ＞ holidayDates ＞ closedWeekdays（`ScheduleBoardScreen.tsx:1997-2003`）。祝日は特別扱いせず平日配置。正本§3 に一致。
- 1コマ＝講師1人＋生徒最大2人。講師のみ机（生徒0でも teacher があれば配置）も可（`ScheduleBoardScreen.tsx:2008,2029`）。正本§4 に一致。
- ペア生徒は別科目・別在籍期間（`student1/2` が各々 subject・active 判定を持つ、`ScheduleBoardScreen.tsx:2011-2027`）。正本§4 に一致。
- 科目は生徒の生年月日×基準日で自動解決（`resolveDisplayedSubjectForBirthDate`、`regularLessonTemplate.ts:293`）。spec-template-behavior Q13 に一致。
- `nextStudent*`（年度引き継ぎ）は常に空文字＝死蔵（`regularLessonTemplate.ts:302-305`）。正本§2「引き継ぎ廃止」・実装状況に一致。
- 旧正本 `regular-lesson-contract-rule.md`（月4回ルール）は先頭に廃止マーク＋新正本への誘導あり（経緯記録として保持）。正本ヘッダーに一致。
- テンプレ編集の本体はオンボード経路（`ScheduleBoardScreen` の `isTemplateMode`/`templateCells`、保存 `handleSaveRegularLessonTemplate:3588`）。`RegularLessonTemplateEditor.tsx` は import 0件＝死蔵（memory template-editing-flow どおり）。
- 「通常講師のみ」判定は盤面の通常授業スロットから講師IDを集める `collectStudentRegularTeacherIdsFromWeeks`（`ScheduleBoardScreen.tsx:895`）で配列由来と和集合（memory regular-teachers-only-board-source・v1.5.317 の対処が生存）。
- 生徒移動先の日付滞留対策（`executeMoveStudent` の statusSlots クリア＋`resolveVisibleSlotDateLabel`）と、生徒同一性補完（`mergeManagedDeskLesson` の回帰防止コメント 6793374、`ScheduleBoardScreen.tsx:2132-2143`）が生存。memory move-date-inheritance / no-regression-rule どおり。

### A: 仕様と実装の相違

**A1: 授業時間 90/60/45（§6）は通常授業では「旧 note フィールドの転用」で実装されており、専用フィールドが無い**
- 正本の該当箇所: §6「各授業に授業時間 90／60／45 分を持てる（未選択＝90分扱い）」。
- 実装の該当箇所: 通常授業テンプレの授業時間は**専用フィールドを持たず**、`RegularLessonTemplateStudent.note`（盤面では `noteSuffix`）を転用している（`src/components/basic-data/regularLessonModel.ts:65-72` `normalizeRegularLessonNote`：値を `'' | '60' | '45'` に正規化、`''`＝90分扱い）。講習（special）側は専用 `lectureDurationOptions=[90,60,45]`（`special-data/specialSessionModel.ts:28-29`）を持つのと非対称。型 `types.ts`・`RegularLessonTemplateDesk` に授業時間の名前付きフィールドは無い。
- 推奨処置: 正本§6 が「専用フィールド」を要求しているのか、「note 転用でよい（データ辞書として明記）」で足りるのかを確定。機能としては満たされている（90/60/45 を保持・表示できる）ため、多くは正本側にデータ辞書（note=授業時間の転用・''=90分）を追記して整合させれば足りる見込み。判断は C1。

### B: 仕様に無い実装挙動（未定義）

**B1（最重要）: 上位正本にテンプレ挙動の細部が無く、別正本 `spec-template-behavior.md` への参照も無い**
- 正本の該当箇所: 記載なし（§1-§6 は上位方針のみで、反映日境界・凍結・overwrite 時のストック返却等に触れていない）。
- 実装の該当箇所: 細部は `spec-template-behavior.md`（Q1-Q20）が正本で、実装（`handleSaveRegularLessonTemplate` `ScheduleBoardScreen.tsx:3588`、`buildRegularLessonsFromTemplate`）はそこを根拠にしている。上位正本 `spec-board-regular-placement.md` からこの別正本への相互参照が無いため、上位だけを読むと「テンプレ保存時に何が起きるか」が未定義に見える。
- 推奨処置: 上位正本に「テンプレ挙動の細部の正本は `spec-template-behavior.md`」と明記し相互リンクする。両書の役割分担（上位＝方針／下位＝Q&A詳細）を固定して、片方だけの編集で齟齬が出ないようにする。

**B2: テンプレ凍結 `templateFreezeBeforeDate`（反映日以前は不変）が上位正本に未定義**
- 正本の該当箇所: 記載なし（`spec-template-behavior.md` Q1/Q3 にはあるが上位正本には無い）。
- 実装の該当箇所: 盤面再生成の禁忌ガード（`ScheduleBoardScreen.tsx:1363-1366`・`:3881-3902`：`templateFreezeBeforeDate` 未満の週/セルは managed overlay を完全スキップ＝講師・生徒・出欠・メモを一切変更しない）。保存時に `templateFreezeBeforeDate = effectiveStartDate` を設定（`:3619`）。
- 推奨処置: 「反映日（`templateFreezeBeforeDate`）より前のコマ表はテンプレ再生成で一切変更しない」を上位正本§2 or §3 に明文化。週トリミング（範囲外の未編集週＝テンプレ再生成で同一だから破棄）の前提でもあり、消してはならないガードである旨を残す。

**B3: overwrite 保存時の「反映日以降クリア＋振替/講習をストックへ返却・相殺」が上位正本に未定義**
- 正本の該当箇所: §末尾「下流ブロックへの影響」で触れるのみ（振替ストックの再定義は④へ委譲）。overwrite 時に既存配置をどうするかは未定義。
- 実装の該当箇所: `handleSaveRegularLessonTemplate`（`ScheduleBoardScreen.tsx:3623-` overwrite 分岐）が、反映日以降の配置済み振替/講習を未消化ストックへ返却（Q7）、欠席由来の未消化を相殺（Q8）、手動追加振替は復元しない（Q9）、抑制/回数補正は反映日前のみ保持（Q10）。
- 推奨処置: `spec-template-behavior.md` Q6-Q10 の内容を上位正本からも参照できるよう明記（B1 の相互リンクで代替可）。特に「テンプレ再保存でストックが返る/相殺される」は室長の体感に直結するため、上位正本にも要約を置くのが望ましい。

**B4: テンプレ生成は「反映日〜当年度末（3/31）の単年度のみ」（複数年一括しない）が上位正本に未定義**
- 正本の該当箇所: §2「年度替わりもテンプレ編集で管理」とあるが、生成範囲が単年度である点は明記なし。
- 実装の該当箇所: `buildRegularLessonsFromTemplate`（`regularLessonTemplate.ts:271-276`）が反映日の年度のみ（反映日 or 4/1 の遅い方〜3/31）生成。多年度ループ・上限年度(旧2031)は撤廃済み（spec-template-behavior Q11）。
- 推奨処置: 上位正本§2 に「テンプレは反映日〜当年度末の単年度のみ生成。年度替わりは新テンプレを作成」を明記。

**B5: テンプレ編集モードの参加者フィルタ＝「入会前＋在籍（退塾のみ除外）」が上位正本の在籍定義と表現差**
- 正本の該当箇所: §2「各生徒は在籍期間中の週だけ表示（入塾日〜退塾日の範囲内のみ）」。
- 実装の該当箇所: **配置後の盤面**は §2 どおり在籍週のみ表示（`isActiveOnDate`）だが、**テンプレ編集モードの配置候補**は「入会前も配置可＝退塾のみ除外」（`filterTemplateParticipantsForReferenceDate` `regularLessonTemplate.ts:219-233`、spec-template-behavior Q14）。編集時に未来入会の生徒を先行配置でき、実配置は在籍開始後の週から出る、という二段構え。
- 推奨処置: 上位正本§2 に「テンプレ編集時は入会前の生徒/講師も先行配置できる（実際の盤面表示は在籍開始週から）」を注記。矛盾ではなく段階の違いだが、未定義だと「入会前が出るのはバグ？」と誤認しうる。

**B6: 定休日セルはテンプレ編集モードで配置不可（配置ブロック）が上位正本に未定義**
- 正本の該当箇所: §3 は「休校曜日はコマを作らない」だが、テンプレ編集画面での配置可否は未定義。
- 実装の該当箇所: テンプレ編集モードで `closedWeekdays` のセルは講師・生徒を配置できない（`ScheduleBoardScreen.tsx:6009-6013` `isTemplateClosedDayCell`、spec-template-behavior Q4）。「テンプレ ＜ 定休日」「個別休日 ＜ テンプレ」の非対称も Q4 にあるが上位正本に無い。
- 推奨処置: 上位正本§3 に「テンプレ編集モードでは定休日セルに配置できない（混乱防止）」「テンプレは holidayDates のみ消し、closedWeekdays/forceOpenDates は消さない」を追記。

### C: オーナー確認事項

- **C1**: 授業時間 90/60/45（§6）を通常授業で「専用フィールド」にするか、現行の「note フィールド転用（''=90/'60'/'45'）」を正としてデータ辞書を正本に明記するかで足りるか（→A1）。機能は満たされているため後者（正本にデータ辞書追記）で足りる見込み。
- **C2**: 上位正本 `spec-board-regular-placement.md` と細部正本 `spec-template-behavior.md` の二層関係を、上位正本に相互参照として明記してよいか（→B1）。あわせて B2-B6（凍結・overwrite ストック返却/相殺・単年度生成・入会前先行配置・定休日配置ブロック）の要約を上位正本へ取り込むか、リンクに留めるか。
- **C3**: 死蔵コンポーネント `RegularLessonTemplateEditor.tsx`（import 0件）を将来削除するか、参照用に残すか（本監査では差分扱いせず記録のみ。spec-template-behavior 末尾でも「整理は別途」とされている）。

### 危険と感じた点（記録・確定前）

- **B2（テンプレ凍結）は週トリミング（boardWeekTrim）と結合した重要ガード。** 週トリムは「範囲外の未編集週＝テンプレ再生成で同一だから破棄」を前提に破棄するが、これは「反映日以前は再生成しない（凍結）」「手動編集週は保持」の両ガードが効いていて初めて安全。凍結ガードが将来のリファクタで外れると、反映日以前の確定済みコマ（過去の実績）がテンプレ再生成で書き換わる/消える危険がある。上位正本に未定義のまま放置すると発見が遅れるため、確定時に「消してはならないガード」として明記を強く推奨。
- **B3（overwrite 時のストック返却/相殺）は室長の実データに直接影響する破壊的操作。** テンプレ再保存で反映日以降の配置済み振替/講習が一括でストックへ戻る/相殺されるため、意図せぬ再保存でコマ表の見た目が大きく変わる。上位正本に要約が無いと「勝手に消えた」と誤認され、復旧のため危険な復元操作（クロス汚染リスク）を誘発しかねない。
- 補足（所見外の記録）: 正本§6 の授業時間は通常授業では note 転用実装のため、`RegularLessonTemplateStudent.note` を将来「純粋なメモ」に戻すと授業時間が失われる。note＝授業時間である旨を明記しないと、note を別用途に流用する変更で回帰する（A1/C1 と同根）。

### 処置（正本更新・Issue化の記録）— オーナー確定 2026-07-04

- **C1: データ辞書明記で確定（専用フィールド化しない）** → 上位正本§6 に「通常授業の授業時間は
  `RegularLessonTemplateStudent.note`（盤面 noteSuffix）の転用で保持（''=90/'60'/'45'・`normalizeRegularLessonNote` 正規化）」
  「note を別用途に流用しない（授業時間が失われ回帰）」「講習側は専用フィールド `lectureDurationOptions` で非対称」を追記済み。
  A1 は差分でなくなった（正本にデータ辞書を追記し実装を正とした）。
- **C2: 相互参照＋要約取込で確定** → 上位正本に §7「テンプレート挙動の細部（凍結・保存・生成範囲・編集）」を新設し、
  細部正本 `spec-template-behavior.md`（Q1-Q20）への相互参照と B2-B6 の要約を取り込み済み:
  - B2（テンプレ凍結 `templateFreezeBeforeDate`・週トリミングの安全前提・消してはならないガード）→ §7-2。
  - B3（overwrite 時のクリア＋振替/講習のストック返却・欠席由来の相殺・手動振替は復元しない・破壊的挙動）→ §7-3。
  - B4（生成は反映日〜当年度末の単年度のみ・年度替わりは新テンプレ・履歴3件）→ §7-4。
  - B5（テンプレ編集時は入会前も先行配置可・実盤面は在籍開始週から）→ §7-5。
  - B6（定休日セルは配置不可・holidayDates のみ消す非対称）→ §7-6。
  - 逆方向参照として細部正本 `spec-template-behavior.md` の先頭にも上位正本への1行参照を追記済み。
  - B1（二層構造の未参照）は §7 の相互参照追記で解消。
- **C3: `RegularLessonTemplateEditor.tsx` は削除で確定** → 上位正本§7-1 に「テンプレ編集の本体はオンボード経路
  （`ScheduleBoardScreen` の `templateCells`）」「モーダル版は死蔵で削除する」を明記済み。**削除の実装は主セッションで対応**
  （import 0件のデッドコンポーネント。受け入れ条件: ビルド・型・全ユニットテストが緑で、テンプレ編集がオンボード経路で従来どおり動作する）。

## 領域4: 振替ストック（2026-07-04）

正本 `spec-makeup-stock.md`（2026-06-07 確定 To-Be／2026-06-08 Phase 4 精査で `autoShortage` の意味を訂正・
「休日で潰れた通常授業を自動で振替計上する仕組み」として残す方針に反転）と現行実装（main・v1.5.378）を突き合わせた。
読み取り監査のみ（コード・正本は未編集、Firestore/本番へは未接続）。file:line は監査時点の値。
既知事故（memory: occupied-origin-and-suppressed-makeup / handoff-restore-720 / auto-assign-makeup-with-lecture /
lecture-stock-subject-selection / submission-board-persistence-asymmetry）と突き合わせ済み。

**重要な前提（正本の三層構造）**: 振替ストックの正本は本書 `spec-makeup-stock.md`（発生・消化・表示・廃止概念）だが、
**overwrite 時のストック返却/相殺の細部は `spec-template-behavior.md` Q7-Q10**、**繰越（初期設定の未消化振替）は
`spec-save-restore.md` §6**、**自動割振での振替同時割当は `spec-auto-assign-rules.md`（memory auto-assign-makeup-with-lecture）**
にそれぞれ分散している。本書からこれら3書への相互参照が無く（後述 B1）、本書だけを読むと振替のライフサイクルが
未定義に見える。

**先に「一致している主要点」（差分ではない・記録）**
- 休日振替の自動計上＝休日/定休日で潰れた通常授業を生徒×科目で未消化計上（理由ラベル `休日振替`/`定休日振替`、`forceOpenDates` 除外）。`computeAutomaticShortageOrigins`（`src/components/schedule-board/makeupStock.ts:408-461`）、理由解決 `resolveOriginReasonLabel`（`:158-188`）。正本§1-A に一致。
- 即時計上（過去/未来問わず・旧「今日まで」制限撤廃）。`computeAutomaticShortageOrigins` に `todayKey` キャップが無く、`stockPeriod` 全月を走査（`makeupStock.ts:439-455`、コメント「休日設定した時点で即時に振替計上する」）。正本§1-A・実装メモ1（✅）に一致。
- 集計単位＝生徒×科目（`buildMakeupStockKey(studentKey, subject)`、`makeupStock.ts:338-340`）。正本§1-A・§3 に一致。
- 欠席登録＝盤面コマの生徒を「休み」で欠席化し振替+1、コマは残して `absent` 表示・席はロックせず操作可。`handleMarkStudentAbsent`（`ScheduleBoardScreen.tsx:8382-8489`：`removeStudentFromDeskLesson`＋`setDeskStudentStatus(absent)`＋`appendMakeupOrigin`）。振替なしの欠席は別ボタン「振無休」`handleMarkStudentAbsentNoMakeup`（`:8491-`、status `absent-no-makeup`）。正本§1-B に一致。
- 繰越＝初期設定の未消化振替を最初から積む。`buildInitialSetupMakeupAdjustmentsFromSettings`（`ScheduleBoardScreen.tsx:1279-1292`、`classroomSettings.initialSetupMakeupStocks` → `manualMakeupAdjustments` に `reasonLabel:'初期設定'`）、登録UI `BackupRestoreScreen.tsx:334-337`。正本§1-C に一致。
- 消化＝空きコマへ置くと残−1、盤面から外す（戻す）と残+1。配置 `handleMakeupStockPlacement`（`ScheduleBoardScreen.tsx:7115-7159`）、戻し `handleReturnStudentToStock`（`:8341-8376` `appendMakeupOrigin`）。残数は `consumeOriginDates`（`makeupStock.ts:561-578`）で消化済み origin を除いた `remainingOriginDates.length`。正本§2 に一致。
- 振替ストックはコマ表操作後も開いたまま維持（`isMakeupStockOpen` を配置で閉じるのは生徒選択モーダルのみ、パネル自体は state で保持）。正本§3 に一致。
- 同コマへ同じ生徒が既にいると配置/移動を拒否＋選択維持（`findDuplicateStudentInCell`→`ScheduleBoardScreen.tsx:7109-7113` 配置／`:3312` 移動、いずれも `blocked` で選択維持）。正本§3 に一致。
- マイナス残（過剰配置表示）廃止＝`balance = Math.max(0, ...)` で0下限、`overAssignedRegularLessons` 減算撤去（`makeupStock.ts:661-667` 回帰防止コメント付き）。残0は一覧から除外（`:695`）。正本§4・実装メモ3（✅）に一致。回帰テスト `makeupStock.test.ts:459-538`（3→1 でなく 3→2）で保護。
- overwrite 保存時のストック返却/相殺（Q7 返却・Q8 相殺・Q9 手動振替は復元しない・Q10 反映日前のみ保持）が実装済み（`ScheduleBoardScreen.tsx:3623-3720`）。`spec-template-behavior.md` Q7-Q10 に一致（本書は「下流④へ委譲」とだけ記す）。

### A: 仕様と実装の相違

**A1（最重要）: テンプレ凍結により、凍結前（過去年度・凍結日前）の休日振替が自動計上されない（正本§1-A の「即時計上」が凍結前には効かない）— 本番4名消失事故の真因**
- 正本の該当箇所: §1-A「計上タイミングは過去・未来を問わず、休日設定した時点で即時」。§★実装メモ1「旧実装の『今日まで』制限を外し、休日設定した未来日も即時に振替計上」。過去・凍結との関係は未定義。
- 実装の該当箇所: `computeAutomaticShortageOrigins`（`makeupStock.ts:408-461`）は引数 `regularLessons`（＝凍結後の**現行テンプレ由来 rows のみ**）を走査し、さらに `if (row.schoolYear !== currentSchoolYear) continue`（`:423`）で当年度以外を除外する。テンプレ凍結（`templateFreezeBeforeDate`）で通常授業行の開始日が凍結日（例 2026-08-31）に更新されると、`resolveAutomaticStockPeriod` の `startDate`（`:240-251`）が凍結日以降になり、凍結前の休日（7/20・お盆 8/10 等）は `stockPeriod` 範囲外＝origin 未生成（autoShortage=0）。schedule 表示は `buildCombinedRegularLessonsFromHistory` で凍結前も補うが、makeup 在庫は**履歴合成していない**（memory occupied-origin-and-suppressed-makeup の訂正・handoff-restore-720）。
- 推奨処置: この非対称は本番事故（7/20 海の日の休日振替が4名分だけ在庫から消失）の直接原因。正本§1-A に「即時計上は**現行テンプレの有効期間内（凍結日以降・当年度）**の休日に限る。テンプレ凍結より前・過去年度の休日振替は自動計上の対象外で、必要なら手動追加で復帰する」を明文化するか、「在庫計算を履歴合成化して凍結前も拾う」かの方針をオーナー確認（→C1）。履歴合成化は全生徒の凍結前振替が大量復活し数量激変（release-checklist §6 ドリフトガードが検出）＝危険なため、現状は「凍結前は対象外・手動復帰」を正とするのが安全側。**この挙動は室長の体感（休みにしたのに振替が出ない）に直結するため未定義のまま放置しない。**

**A2: 正本§4 が撤去を要求した `overAssignedRegularLessons`／`negativeReason` が、型・計算・返却フィールドとして残存（balance には効かせていない）**
- 正本の該当箇所: §4「`overAssignedRegularLessons` による減算・`negativeReason` を撤去」。§★実装メモ3「`balance` の `overAssignedRegularLessons` 減算と `negativeReason` を撤去」。
- 実装の該当箇所: `MakeupStockEntry` 型に `overAssignedRegularLessons: number` / `negativeReason: string | null` が残り（`makeupStock.ts:27,35`）、`overAssignedRegularLessons` は `:648-650` で今も計算され `:683` で返る（`negativeReason` は常に `null`・`:668,690`）。撤去されたのは **balance からの減算のみ**（`:667` は `remainingOriginDates.length - manualIndependentPlannedMakeups` で overAssigned を使わない）。フィールド自体は残骸として出力に残る。
- 推奨処置: 正本§4 の「撤去」は「balance への減算を撤去」の意味だったと解釈できるため、正本§4 に「フィールド `overAssignedRegularLessons`（参考値・balance に影響しない）は残る／`negativeReason` は常に null（後方互換の残骸）」とデータ辞書を追記して整合させる（機能は満たされている）。純粋な残骸として将来撤去するかは軽微。C 扱いにはしない（明白）。→C2 で扱い方針のみ確認。

### B: 仕様に無い実装挙動（未定義）

**B1（最重要）: 抑制 `suppressedMakeupOrigins` という「振替を消す」機構が正本に一切未定義（かつ復帰UIが無い）— 事故の温床の中核**
- 正本の該当箇所: 記載なし（§2 は「盤面から外すと残+1」までしか定義せず、休日振替そのものを**削除**する経路や、削除の記録先が未定義）。
- 実装の該当箇所: `suppressedMakeupOrigins`（`boardState`、`src/types/appState.ts:100`）は「未消化振替一覧から削除」`handleDeleteMakeupOriginItem`（`ScheduleBoardScreen.tsx:7521-7548` `appendMakeupOrigin(suppressedMakeupOrigins,...)`）と、通常授業/振替の**盤面削除**`handleDeleteStudent`（`:8673-8686`）で増える。在庫計算は `allOriginDates` から `suppressedOriginDates` を除外して残数を出す（`makeupStock.ts:641-643`）。**抑制を戻す（un-suppress する）UI 経路が存在しない**（`setSuppressedMakeupOrigins` の呼び出しは初期化・overwrite クリア・undo/redo のみ・`grep` で確認）。
- 推奨処置: 「休日振替や配置済み振替を**削除**すると `suppressedMakeupOrigins` に記録され在庫から消える／削除は元に戻せない（undo 以外に復帰UIが無い）」を正本§2 に明文化。あわせて**復帰UIの欠如を仕様上の既知の制約として明記**するか、復帰UIを追加するかをオーナー確認（→C3）。memory occupied-origin-and-suppressed-makeup の「本物の休講日振替が巻き込まれ消え、戻すUIが無い」本番事故の中核。**未定義のままだと、抑制の意味を知らない将来の変更で誤って在庫が消える／復旧できない。**

**B2: 手動調整 `manualMakeupAdjustments` が「繰越・欠席・盤面戻し」の3経路を1つのマップに混載しており、正本にその区別・記録先が未定義**
- 正本の該当箇所: 記載なし（§1-B 欠席／§1-C 繰越／§2 戻しはそれぞれ挙動を述べるが、いずれも同一の `manualMakeupAdjustments` マップに積まれる実装は未記載）。
- 実装の該当箇所: `manualMakeupAdjustments`（`appState.ts:99`）に、初期設定の繰越（`buildInitialSetupMakeupAdjustmentsFromSettings` `reasonLabel:'初期設定'`）、欠席（`handleMarkStudentAbsent:8458-8460` `appendMakeupOrigin`）、盤面からの戻し（`handleReturnStudentToStock:8346-8348`）が全て append される。理由ラベルは origin ごとに任意保持（`ManualMakeupOrigin.reasonLabel`、`makeupStock.ts:9-13`）。区別は `reasonLabel` の有無のみで、消化・相殺時は日付一致で消える。
- 推奨処置: 正本に「未消化振替の内部表現＝生徒×科目キーに origin（振替元日付）を積む `manualMakeupAdjustments`（繰越・欠席・盤面戻しを混載）と、自動算出の休日/定休日/重複 origin の和集合から `suppressedMakeupOrigins` を差し引いた残数」というデータモデルを明記。ライフサイクル（誰が積み・誰が消すか）を固定しないと、消化・相殺のどれかを触る変更で二重計上/消失が起きる。

**B3: 同時間帯重複（conflict）由来の振替自動計上が正本に未定義**
- 正本の該当箇所: 記載なし（§1 は A 休日／B 欠席／C 繰越のみ。重複起因は無い）。
- 実装の該当箇所: `computeScheduleConflictOrigins`（`makeupStock.ts:463-559`）が、同一日・同一時限に同一生徒が複数コマに乗る構成を「同時間帯の重複」として振替 origin 化（理由ラベル `同時間帯の重複`・`:178-180`）。ただし休日振替と違い `todayKey` キャップあり（`:480-481` 過去分のみ）。
- 推奨処置: 正本§1 に「D. 同時間帯重複振替」を追加（自動・過去分のみ計上・理由ラベル `同時間帯の重複`）。休日振替（過去/未来即時）との計上タイミングの非対称（重複は過去のみ）も明記。

**B4: 集計キーの正規化（`manual:`／`name:` プレフィックス・非管理生徒の fallback）が正本に未定義**
- 正本の該当箇所: 記載なし（§3「手動追加した生徒は振替ストックにカウントしない」とのみ）。
- 実装の該当箇所: キーは `studentKey__subject`。`studentKey` は管理生徒=生徒ID、手動追加/未管理=`manual:` または `name:表示名`（`resolveStudentKey`／`resolveBoardStudentStockId`）。`normalizeManagedMakeupStockKeyByIdSet`（`makeupStock.ts:47-56`）が `manual:` を管理IDへ再吸着（生徒が後から管理登録された場合の救済）。非管理生徒の表示名/科目は `fallbackMakeupStudents`（`appState.ts:101`）に保持し、生徒が消えても一覧に名前を出せる。
- 推奨処置: 正本§3 に「キー＝生徒×科目。管理生徒は生徒ID、未管理は `name:表示名`。未管理生徒の表示情報は `fallbackMakeupStudents` に退避。生徒が後から管理登録されるとキーを再吸着して合算」を明記。「手動追加はカウントしない」は正確には「手動追加の授業（`manualAdded`）を消化/計上に数えない」（`makeupStock.ts:290,350,377` の `manualAdded` スキップ）であり、繰越/欠席で積んだ未管理生徒の残数は出る、という区別も明記。

**B5: 消化アルゴリズム（`consumeOriginDates`：使用済み origin の突き合わせ＋余剰使用は古い順から消す）が正本に未定義**
- 正本の該当箇所: 記載なし（§2「置くと残−1」とだけ）。
- 実装の該当箇所: `consumeOriginDates`（`makeupStock.ts:561-578`）は、盤面の振替が持つ `makeupSourceDate`（使用済み origin）を残 origin から除去し、`makeupSourceDate` を持たない配置分は残 origin を古い順に shift して消す。配置時に選んだ振替元日付は `resolveSelectedMakeupOrigin`（`ScheduleBoardScreen.tsx:7115-7117`）で尊重（最古に巻き戻さない・回帰テスト `ScheduleBoardScreen.test.ts:3984-`）。
- 推奨処置: 正本§2 に「消化は振替元日付単位で突き合わせ（配置した振替が持つ元日付を残から除く）。元日付が無い配置は古い origin から消す。一覧で選んだ元日付を配置に引き継ぐ（最古へ巻き戻さない）」を明記。振替の発生源（休日/欠席/繰越）が表示ラベルに直結するため、消化順は室長の見え方に影響する。

**B6: `initialSetupCompletedAt`（`setupFloorKey`）より前の自動 origin を計上しないガードが正本に未定義**
- 正本の該当箇所: 記載なし。
- 実装の該当箇所: `computeAutomaticShortageOrigins`（`makeupStock.ts:418-419,452`）と conflict（`:472-473,543`）が、`classroomSettings.initialSetupCompletedAt` を日付キー化した `setupFloorKey` 未満の休日/重複 origin をスキップ。運用開始前の過去に休日があっても自動振替を積まない（繰越は §1-C の手動登録で入れる想定）。
- 推奨処置: 正本§1-A/§1-C に「初期設定完了日（`initialSetupCompletedAt`）より前の休日/重複は自動計上せず、運用開始前の残は繰越（初期設定の未消化振替）で登録する」を明記。繰越と自動計上の境界が未定義だと、初期設定日を動かす変更で過去分が大量に増減する。

**B7: 自動割振での「振替同時割当」（講習と共有コア・振るい順）が本書に未定義**
- 正本の該当箇所: 記載なし（本書は自動割振に触れない）。
- 実装の該当箇所: `buildMakeupAutoAssignPendingItems`（`ScheduleBoardScreen.tsx:245-262`：balance を上限に古い origin から pending 展開）、共有コア `findBestAutoAssignCandidate`／`handleAutoAssignLectureStockEntry({includeMakeup})`（`:7364-`、既定OFF・memory auto-assign-makeup-with-lecture・v1.5.331 本番反映）。振替の自動割振は講習と同一規則・スコアを共有し、末尾で振るい順（古い振替元優先）を評価。
- 推奨処置: 本書§2 に「消化は手動配置のほか、講習の自動割振モーダルの『未消化振替も同時に自動割り当てする』（既定OFF）でもできる（規則詳細は `spec-auto-assign-rules.md`）」を注記。balance を超えて生成しない回帰防止（`:244` コメント）は消してはならないガードとして明記。

**B8: 振替と講習は「似て非なる別経路」で片方の修正が他方に自動適用されない構造が、正本に注意書きとして無い**
- 正本の該当箇所: 記載なし。
- 実装の該当箇所: 振替＝`makeupStock.ts`／`manualMakeupAdjustments`／`suppressedMakeupOrigins`、講習＝`lectureStock.ts`／`manualLectureStockCounts`／`manualLectureStockOrigins` と、モデル・キー・配置・科目選択がすべて別実装（memory lecture-stock-subject-selection：講習側だけ選択科目を無視する既存バグが振替側に無かった＝非対称の実例）。配置/戻し/欠席/削除の各ハンドラが両者を並べて別々に扱う（`ScheduleBoardScreen.tsx:8382-8489` ほか）。
- 推奨処置: 正本（本書と `spec-lecture-stock.md` の両方）に「振替と講習は別経路。片方の修正はもう片方に自動適用されない（科目選択・消化・相殺は各々で担保が必要）」を相互注記。回帰の温床として明文化。

### C: オーナー確認事項

- **C1（最重要）**: テンプレ凍結前・過去年度の休日振替を自動計上しない現行（A1）を正とし「凍結前は自動計上の対象外・必要なら手動追加で復帰」を正本§1-A に明文化するか、それとも「在庫計算を履歴合成化して凍結前も拾う」方向に仕様を変えるか（後者は全生徒の凍結前振替が大量復活し数量激変＝release-checklist §6 ドリフトガードが検出する危険な変更。memory occupied-origin-and-suppressed-makeup / handoff-restore-720 で検証済み）。安全側は前者（現行を正とし明文化）。
- **C2**: 正本§4「`overAssignedRegularLessons`／`negativeReason` を撤去」を「balance への減算を撤去」の意味と確定し、参考フィールドの残存をデータ辞書で明記するか（→A2）。純粋な残骸として将来フィールドごと撤去するかは別途。
- **C3**: 抑制 `suppressedMakeupOrigins` の**復帰UI 欠如**（B1）を「削除は undo 以外に戻せない仕様」として正本に明記して据え置くか、削除した未消化振替を復帰する UI を追加するか。本番で「本物の休日振替が巻き込まれ消え、戻せなかった」事故（7/20 4名）が起きた領域。
- **C4**: 自動計上の発生源として **同時間帯重複（B3）／初期設定日フロア（B6）** を正本§1 に正式追加してよいか（現状は実装のみ・正本§1 は A/B/C の3種のみ）。重複は過去分のみ計上（休日は過去/未来即時）の非対称も含めて明記する想定。
- **C5**: 本書と分散正本（`spec-template-behavior.md` Q7-Q10 のストック返却/相殺・`spec-save-restore.md` §6 の繰越・`spec-auto-assign-rules.md` の振替同時割当）への相互参照（B1/B7/B8）を本書に追記してよいか。あわせて振替×講習の非対称注意書き（B8）を両正本に置くか。

### 危険と感じた点（記録・確定前）

- **A1（凍結前の休日振替が自動計上されない）と B1（抑制に復帰UIが無い）は、実際に本番4名の 7/20 振替を消失させた事故の2つの真因**（テンプレ凍結による origin 未生成＋偽 origin 一括削除の巻き込み抑制）。いずれも正本に未定義のまま放置されており、本監査の主目的（未定義＝バグの温床）に最も合致する。確定時に「凍結前は手動復帰」「抑制削除は元に戻せない（復帰UIの要否を判断）」を明記しないと、同種事故の再発時に室長が復旧のため危険なデータ復元操作（クロス汚染リスク）に走りかねない。
- **`consumeOriginDates`（B5）／balance の `Math.max(0, ...)` クランプ（A2）／`buildMakeupAutoAssignPendingItems` の balance 上限（B7）は、いずれも「残数を正しく1件ずつ消化する」ための意図的ロジックで、回帰テスト（`makeupStock.test.ts:459-538` の 3→2、`ScheduleBoardScreen.test.ts:3984-` の選択元尊重）で保護されている。** 過去に「振替1コマ置くと残が2件減る（3→1）」過剰減算バグ（overAssigned の二重減算）が実際に起きており（`makeupStock.ts:661-666` の回帰防止コメント）、これを「単純化」で消すと再発する。正本にデータモデル（B2/B5）を明記し、消してはならないガードとして残すことを強く推奨。
- **overwrite 時の相殺（Q8）と suppressed クリア（D節・`ScheduleBoardScreen.tsx:3712-3718`）は、`effectiveStart` 以降のみを対象に絞ることで凍結前を保護している。** この「反映日境界」が振替ストックでも二重計上/消失を防ぐ要（領域3 B2/B3 の凍結ガードと同根）。境界判定を緩めると、テンプレ再保存で凍結前の確定済み振替が相殺され消える危険がある。
- 補足（所見外の記録）: `computeAutomaticShortageOrigins` は引数 `teachers` を受け取らないが、`buildMakeupStockEntries` は互換のため `teachers` をパラメータに残す（`makeupStock.ts:592` コメント「空きコマ不足origin廃止に伴い内部では未使用」）。空きコマ不足 origin 経路が廃止された（2026-07-03・memory occupied-origin-and-suppressed-makeup）痕跡。将来 `teachers` 引数を撤去する場合は呼び出し側（`ScheduleBoardScreen.tsx:4331-4341`）とテストの互換に注意。

### 処置（正本更新・Issue化の記録）— オーナー確定 2026-07-04

- **C1: 現行を正とし明文化で確定（履歴合成化はしない）** → 正本§1-A に「即時計上は現行テンプレの有効期間内（凍結日以降・当年度）の休日に限る。テンプレ凍結より前・過去年度は自動計上の対象外で手動追加で復帰」を明文化済み。本番 7/20 事故の真因と回復手段（凍結前は手動追加で復帰・在庫の履歴合成化は危険なため採らない）を記録。**A1 は差分でなくなった（正本を実装に合わせた）。**
- **C2: 「balance への減算を撤去」の意味と確定** → 正本§4 にデータ辞書（`overAssignedRegularLessons`＝参考値・balance に影響しない／`negativeReason`＝常に null の残骸）を追記済み。**A2 も差分でなくなった。**
- **C3: 復帰UIを追加で確定** → **Issue #39** 起票済み（受け入れ条件つき）。正本§2「削除（抑制）／復帰」に B1 の明文化（削除は `suppressedMakeupOrigins` への抑制・現状は undo 以外に復帰経路なし・復帰UIは Issue #39 で実装予定）を記載済み。**復帰UIの実装は主セッション（Issue #39）で対応。**
- **C4: 承認** → 正本§1-D に同時間帯重複振替（過去分のみ計上・理由ラベル `同時間帯の重複`・休日振替との計上タイミング非対称）を正式追加。§1-A に初期設定日フロア（`initialSetupCompletedAt` 未満は自動計上せず繰越で登録）を明記済み。
- **C5: 承認** → 正本冒頭に分散正本3書（`spec-template-behavior.md` Q7-Q10・`spec-save-restore.md` §6・`spec-auto-assign-rules.md`）＋講習正本への相互参照を追記。逆方向の1行参照を各書に追加済み（`spec-template-behavior.md` Q7 前・`spec-save-restore.md` §6・`spec-auto-assign-rules.md` A節・`spec-lecture-stock.md` 冒頭）。振替×講習の非対称注意書き（B8）を本書「## ★ 振替と講習の非対称」と `spec-lecture-stock.md` 冒頭の両方に配置。
- **B2/B4/B5/B7: すべて正本へ明文化済み**（オーナー確認済み）:
  - B2（データモデル：3系統 origin〈自動／`manualMakeupAdjustments` 混載〈繰越・欠席・盤面戻し〉／`suppressedMakeupOrigins` 抑制〉の和集合−抑制の残数構造）→ 正本§5「データモデル」新設。「消化・相殺・抑制のいずれかを触る変更で崩すと二重計上/消失＝消してはならないガード」を明記。
  - B4（キー正規化〈管理ID／`name:`／`manual:` 再吸着〉・`fallbackMakeupStudents` 退避・`manualAdded` の正確な意味）→ 正本§3「集計キーと未管理生徒の扱い」に明文化。
  - B5（消化アルゴリズム `consumeOriginDates`〈元日付突き合わせ＋古い順消化〉・選択元日付の尊重・balance クランプ）→ 正本§2「消化アルゴリズム」に明文化。過剰減算バグ（3→1）の回帰防止コメントを引用し「消してはならないガード」と明記。
  - B7（自動割振の振替同時割当〈講習と共有コア・既定 OFF〉・`buildMakeupAutoAssignPendingItems` の balance 上限）→ 正本§2「自動割振での振替同時割当」に明文化。balance 上限を「消してはならないガード」と明記。
  - B1/B2/B5/B7 とも「過去の事故・過剰減算バグへの意図的なガードであり消してはならない」旨を明記（領域2/3 の書き方に準拠）。
- **B3/B6/B8: 正本へ明文化済み** → B3（同時間帯重複）＝§1-D（C4 で追加）、B6（初期設定日フロア）＝§1-A（C4 で追加）、B8（振替×講習の非対称）＝§「振替と講習の非対称」（C5 で追加）。

## 領域5: 講習・講習ストック（2026-07-04）

正本 `docs/spec-lecture-stock.md`（2026-06-07 確定 To-Be／2026-06-09 Phase 5 着手時点の実装状況を含む）と現行実装（main・v1.5.380）を突き合わせた。
矛盾時に本書優先とされる旧文書 `docs/lecture-edit-flow.md`（先頭に廃止マーク＋新正本誘導あり）とも突き合わせた。
読み取り監査のみ（コード・正本は未編集、Firestore/本番へは未接続）。file:line は監査時点の値。
既知事例（memory: lecture-stock-subject-selection / auto-assign-makeup-with-lecture / submission-board-persistence-asymmetry）と、
領域4で確定した `spec-makeup-stock.md`（§2 消化アルゴリズム・§5 データモデル・非対称注意書き）と**対称的に**突き合わせた。

**重要な前提（振替との構造的非対称）**: 振替ストックは**盤面 `weeks` を走査して配置数・消化を算出**する（`makeupStock.ts` `buildMakeupStockEntries`）が、
**講習ストックは盤面を走査しない**。講習残数は「提出 `requestedCount`（`buildLectureStockEntries`＝希望数のみ算出）」を pending items に展開し、
**`manualLectureStockCounts`（stockKey→整数デルタ）で加減**する（負＝配置で消費・正＝盤面から戻した分／`ScheduleBoardScreen.tsx:4402-4515`）。
配置は `appendLectureStockCount(..., -1)`（`:7228`）、戻しは `appendLectureStockCount(..., +1)`（`:8303`）のデルタ操作。この「デルタ台帳」方式が本領域の所見の根。

**先に「一致している主要点」（差分ではない・記録）**
- 希望数の正は提出（QR／日程表）。`buildLectureStockEntries`（`lectureStock.ts:22-41`）は `session.studentInputs[*].subjectSlots`（提出値）だけを希望数源にし、盤面から希望数を作らない。正本§1 に一致。
- 対象は `countSubmitted` かつ `!regularOnly` の生徒のみ（`lectureStock.ts:24-25`）。「通常のみ」はストック無し。正本§2 に一致。ゴールデン `lectureStockSnapshot.test.ts:35-41`（未提出・通常のみは出ない）で保護。
- 集計単位＝セッション×生徒×科目（キー `session.id__studentId__subject`、`lectureStock.ts:32`）。正本§2 に一致。
- 配置しても希望数は減らず「未配置残数」が減る＝`manualLectureStockCounts` を −1 する（`ScheduleBoardScreen.tsx:7228`／自動割振 `:7346`）だけで `subjectSlots`（希望数）は不変。正本§3 に一致。
- ★**科目選択の尊重（memory lecture-stock-subject-selection・v1.5.364）が現存**：手動配置は `resolveSelectedLecturePlacementItem`（`lectureStockPlacement.ts:18-29`）で選択科目（subject＋sessionId）を尊重し、未選択/不一致のみ先頭フォールバック。回帰テスト `lectureStockPlacement.test.ts`（中3 国→英 事故の防止・sessionId 違いの区別・空一覧 null）で保護。振替側の rawKey 尊重と対になる修正が生存。
- ★**自動割振の共有コア（memory auto-assign-makeup-with-lecture・v1.5.331）が現存**：`handleAutoAssignLectureStockEntry(entry, {includeMakeup})`（`ScheduleBoardScreen.tsx:7258-`）が講習を全配置後、`includeMakeup` で同一生徒の振替を同一 nextWeeks に振るい順で割当。講習スコアは `findBestLectureAutoAssignCandidate` に委譲され不変。
- 削除でストック由来（session）は希望数 −1（`decrementSpecialSessionSubjectCount` ＋配置消費の打ち消し +1 で純減、`ScheduleBoardScreen.tsx:8688-8696`／確認文言 `:8650-8654`）。手動追加（manual）は希望数不変・ストックへ戻さない。正本§4・現行差分1/2・実装状況 TODO1/TODO2 に一致。
- 戻す（ストックする）と削除の役割分担が別アクション（戻す＝`handleReturnStudentToStock` の special session 分岐 `:8300-8338`／削除＝`handleDeleteStudent`）。正本§4 に一致。
- コマ表上での直接編集は不可（`:8060`「講習授業はコマ表から編集できません。生徒日程表で登録解除して内容を直し、再登録してください」）＝TODO3 廃止（編集は削除＋手動追加で代替）に一致。正本§5・実装状況 TODO3 に一致。
- 登録解除で該当生徒の講習コマを盤面から外し、セッションのデルタ台帳もリセット（`removeStudentAssignmentsFromSpecialSession` `:2826-`＋`clearLectureStockAdjustmentsForStudentSession` `:2836`、`!countSubmitted` になった生徒を検知する effect `:4013-`）。再登録は台帳リセット済みなので希望数から再計算。正本§5 に一致。
- 講師日程表の登録解除はその講師だけ外す（生徒の講習予定は残る、`scheduleHtml.ts:4256` 文言）。正本§5 に一致。
- 授業時間 90/60/45：提出由来は `SpecialSessionStudentInput.subjectDurations`（`specialSessionModel.ts:14`・未設定=90・`resolveLectureSubjectDuration` `:32-`）、手動追加は盤面 `noteSuffix`。提出UI（⑦）も 60/45 保持（`scheduleHtml.ts:2614-2621,3455`）。正本§6・実装状況 TODO4 に一致（⑦/⑨ の ⏳ は実装済みに進んでいる）。
- 手動追加分は希望数(desired)に含めず、実配置＝講習回数(actual)にはカウント（`scheduleHtml.ts` の lectureCounts は配置済み special を由来問わず加算）。正本§5 注記・実装状況に一致。
- 区分ラベル「通)」「講)」で見分け・色分け撤廃・講師なし/制約違反/手動追加は赤表示。正本§7 に一致。

### A: 仕様と実装の相違

**A1（最重要）: 「生徒を空にする」（日付一括削除）が講習ストック由来の希望数 −1 を行わない（正本§4「『空にする』も削除と同じ扱い」に反する）**
- 正本の該当箇所: §4「**「空にする」も削除と同じ扱い**」（＝ストック由来なら希望数 −1）。実装状況 末尾「**『空にする』(日付一括 `handleClearStudentsOnDate`)** のセッション講習一括 −1 は TODO1 続きとして残（要バッチ希望数減算）」。
- 実装の該当箇所: `handleClearStudentsOnDate`（`ScheduleBoardScreen.tsx:6984-7028`）は生徒スロット/statusSlots を null 化し `scheduleCountAdjustments` を積むのみ。**session 由来講習の希望数 −1（`decrementSpecialSessionSubjectCount`）も、配置消費デルタの打ち消しも、振替 origin の再計上も行わない**。確認文言（`:6985`「ストックへの移行は行いません」）は 希望数の扱いに言及しない。
- 推奨処置: 単発削除（`handleDeleteStudent`）と挙動を揃え、日付一括でも session 由来講習は希望数 −1、振替は origin をストックへ戻す/抑制する処理を通す。ただし「日付一括は意図的に単純化（ストック非干渉）」という運用判断の可能性もあるため、正本§4 の「空にする＝削除と同じ扱い」を単発のみに限定するか、一括にも適用するかをオーナー確認（→C1）。**現状は正本と実装が食い違ったまま**で、室長が「空にする」で消した講習の希望数が残り続ける（＝ストックに再出現しうる）温床。

**A2: 講習ストック残数の「盤面デルタ台帳」方式が、QR提出反映の永続化非対称（memory submission-board-persistence-asymmetry）に対して脆い（配置デルタは手動保存のみ・希望数は自動同期）**
- 正本の該当箇所: §2「講習ストック残 ＝『希望数 − 盤面に置かれた分』＋『盤面から戻した分』」。**残数の算出根拠（盤面走査かデルタ台帳か）と、その永続化タイミングは未定義**。
- 実装の該当箇所: 残数は盤面 `weeks` を**走査せず**、`manualLectureStockCounts`（stockKey→デルタ）で加減する（`ScheduleBoardScreen.tsx:4443-4499`）。配置の −1 デルタと盤面配置はどちらも**手動保存でのみ永続**だが、希望数 `subjectSlots`／`countSubmitted` は workspace 自動同期で永続（memory submission-board-persistence-asymmetry）。手動保存前リロードで「配置（盤面）＋消費デルタ」が揃って揮発するため残数は整合するが、**盤面走査ベースの振替（自己修復 reconcile あり）と違い、講習には残数の起動時 reconcile が無い**。講師配置には reconcile があるが（`reconcileSubmittedTeacherPlacements` `:3135`）、生徒の講習ストック消費デルタには自己修復が無い。
- 推奨処置: 正本§2 に「講習残数は盤面を走査せず `manualLectureStockCounts` デルタ台帳で管理する（振替が盤面走査なのと非対称）。配置デルタと盤面配置は手動保存でのみ永続」を明記し、デルタ台帳が盤面と乖離した場合の収束方針（reconcile の要否）をオーナー確認（→C2）。振替側で「盤面走査＝常に盤面が真」としたのと非対称で、講習は台帳が壊れると自己修復されない。

**A3: 旧文書 `lecture-edit-flow.md` の「削除するとストック由来は未配置へ戻る」が実装から撤去済みだが、旧文書本文が更新されず残存（正本が優先と明記されているが混乱源）**
- 正本の該当箇所: `spec-lecture-stock.md` 現行差分2「『削除』は**由来を問わず未配置へ戻さない**（従来：ストック由来は未配置へ戻していた）」。旧 `lecture-edit-flow.md:30`「もともと講習ストックから配置したコマなら、未配置分として講習ストックへ戻る」。
- 実装の該当箇所: `handleDeleteStudent`（`ScheduleBoardScreen.tsx:8688-8696`）は session 由来を希望数 −1（純減）にし**未配置へ戻さない**＝新正本どおり。旧文書の記述は実装と食い違う（旧文書は先頭で「本書ではなく新正本を優先」と明記済み）。
- 推奨処置: 旧文書は先頭に廃止マーク＋新正本誘導があり正本優先が担保されているため機能上の差分ではない。ただし旧本文が新旧で真逆の記述を残すのは将来の誤読源。旧文書§「削除するとき」に「※この項は新正本 §4 で変更（削除は由来を問わず戻さない）」の1行を差し込むか、旧文書を完全にアーカイブ化するかをオーナー確認（→C3）。C 扱いにはせず記録（軽微）。

### B: 仕様に無い実装挙動（未定義）

**B1（最重要）: 講習残数のデータモデル（`requestedCount` 展開 − session消費デルタ ＋ manual加算・`manualLectureStockCounts`／`manualLectureStockOrigins`／`fallbackLectureStockStudents` の3構造）が正本に未定義**
- 正本の該当箇所: §2 は「希望数 − 置かれた分 ＋ 戻した分」と概念式のみ。内部表現（デルタ台帳・origin メタデータ・fallback）は未記載。
- 実装の該当箇所: 残数計算 `lecturePendingItemsByEntryKey`（`ScheduleBoardScreen.tsx:4402-4515`）は、(1) 提出 `requestedCount` を pending items に展開→session 由来の負デルタ `consumeCount` 分を先頭から除外（`:4444-4446`）、(2) 正デルタ（manual・盤面から戻した分）を `manualLectureStockOrigins` のメタデータ（sessionId/originDate/slot/displayName）付きで追加（`:4463-4499`）、(3) 未管理生徒の表示情報は `fallbackLectureStockStudents`（`:4466`）。型は `appState.ts`（`manualLectureStockCounts` / `manualLectureStockOrigins` / `fallbackLectureStockStudents`）。
- 推奨処置: 領域4で振替に §5「データモデル」を新設したのと**対称的に**、正本に「講習残数のデータモデル（提出希望数の pending 展開 − session 消費デルタ ＋ manual 加算・各 origin メタデータ・fallback 退避）」を明文化。振替の「盤面走査＋抑制差し引き」と講習の「デルタ台帳」の構造差を並記し、片方を触るときもう片方に自動適用されない（B8/非対称）ことを固定。

**B2: 消費デルタの消化順（`consumeCount` は pending items を先頭から削る・`.slice(consumeCount)`）が正本に未定義**
- 正本の該当箇所: 記載なし（§3「置くと未配置残が減る」のみ）。
- 実装の該当箇所: `ScheduleBoardScreen.tsx:4445-4446`（`consumeCount = min(rawItems.length, |負デルタ|)`→`rawItems.slice(consumeCount)`）。振替の `consumeOriginDates`（元日付突き合わせ＋古い順）とは異なり、講習は**単純に先頭から個数分を削る**（origin 単位の突き合わせは無い・science 科目間の区別は科目別 stockKey で担保）。
- 推奨処置: 正本に「講習の消化は科目別 stockKey ごとに個数（デルタ）で管理し、pending 展開の先頭から消費数分を除く（振替の元日付突き合わせとは別方式）」を明記。振替側で「消化順は表示ラベルに影響」としたのと対で、講習は origin メタデータを別途 `manualLectureStockOrigins` で保持する点を並記。

**B3: `manualLectureStockCounts` が負（消費）と正（戻し/繰越）を1マップに混載する二義性が正本に未定義**
- 正本の該当箇所: 記載なし。
- 実装の該当箇所: `manualLectureStockCounts[stockKey]` は同一マップで**負＝配置で消費した数・正＝盤面から戻した/繰越で足した数**を表す（`appendLectureStockCount` `:1033-1038`／`removeLectureStockCount` は 0 以下でキー削除 `:1040-1051`）。残数計算は負を `consumeCount` に、正を追加 pending に振り分ける（B1）。繰越（初期設定）は正の値として `buildInitialSetupLectureStockCountsFromSettings`（`ScheduleBoardScreen.tsx:1294-`）で積まれる。
- 推奨処置: 正本にデータ辞書として「`manualLectureStockCounts`：正負両用の1マップ（負＝session由来の配置消費・正＝盤面戻し＋繰越）」を明記。符号の意味を固定しないと、消費/戻しのどちらかを触る変更で残数が反転する温床。

**B4: 集計キーと未管理生徒の扱い（`name:` プレフィックス・`fallbackLectureStockStudents`・`buildLectureStockScopeKey`）が正本に未定義**
- 正本の該当箇所: 記載なし（§2「セッション×生徒×科目」の粒度のみ）。
- 実装の該当箇所: stockKey＝`studentKey__subject__sessionId`（`buildLectureStockKey`）。未管理/手動追加生徒は `name:表示名`（`:7226,8301` など）。未管理生徒の表示名・科目は `fallbackLectureStockStudents`（`:4466`）に退避。一覧のグルーピングは `buildLectureStockScopeKey(studentKey, sessionId)`（生徒×セッション単位）で科目を束ねる。
- 推奨処置: 振替の §3「集計キーと未管理生徒の扱い」と対称的に、正本に「キー＝生徒×科目×セッション。未管理は `name:表示名`・表示情報は `fallbackLectureStockStudents` 退避。一覧は生徒×セッションでグルーピング」を明記。

**B5: 提出由来と手動追加由来の `specialStockSource`（'session'／'manual'）による全挙動の分岐が正本に散在・体系化されていない**
- 正本の該当箇所: §4/§5 に「ストック由来／手動追加」の区別は文章で散在するが、内部フラグ `specialStockSource` と各操作の対応表が無い。
- 実装の該当箇所: `specialStockSource: 'session' | 'manual'` が、削除（session=希望数−1／manual=変更なし・`:8688-8700`）・戻し（session=ストックへ／manual=戻さない・`:8278-8299`）・欠席（session=ストックへ／manual=戻さない・`:8396-8414`）・overwrite 返却（session のみ返却・`:3646`）の全分岐を制御する。
- 推奨処置: 正本に「講習コマは `specialStockSource`（session＝提出ストック由来／manual＝コマ表で手動追加）を持ち、削除・戻し・欠席・テンプレ overwrite の各操作で挙動が分岐する（session のみ希望数/ストックに影響・manual は盤面のみ）」の対応表を明記。散在する規則を1箇所に固定する。

**B6: 欠席（休み）登録時の講習ストック返却が正本に未定義（振替§1-B と対だが講習側は正本に無い）**
- 正本の該当箇所: 記載なし（§4 は削除/戻しのみ。欠席は振替 `spec-makeup-stock.md` §1-B にはあるが講習正本に無い）。
- 実装の該当箇所: `handleMarkStudentAbsent`（`ScheduleBoardScreen.tsx:8396-8450`）で、session 由来講習を欠席にすると**未消化講習へ戻す**（`appendLectureStockCount(+1)`＋origin 追加、`:8418-8449`「未消化講習へ戻しました」）。手動追加講習は戻さない（`:8412`）。欠席解除（`handleClearStudentStatus` `:8587-8598`）で逆操作。
- 推奨処置: 正本に「session 由来講習コマを欠席（休み）にすると未消化講習へ +1 戻す（手動追加は戻さない）。欠席解除で −1」を明記。振替の欠席（§1-B）と対称に置く。

**B7: テンプレ overwrite 時の講習ストック返却/相殺（Q7 返却・Q8 相殺）の講習側実装が講習正本に未定義（振替は領域3/4 で明文化済み）**
- 正本の該当箇所: 記載なし（`spec-template-behavior.md` Q7-Q10 にはあるが講習正本 `spec-lecture-stock.md` に相互参照が無い）。
- 実装の該当箇所: `handleSaveRegularLessonTemplate` の overwrite 分岐（`ScheduleBoardScreen.tsx:3646-3662` 配置済み session 講習を +1 返却／`:3687-3695` 欠席由来の未消化講習を相殺）。effectiveStart 以降のみ対象。
- 推奨処置: 講習正本に「テンプレ overwrite（反映日以降クリア）時、配置済みの session 由来講習は未消化へ返却・欠席で生まれた未消化講習は相殺（`spec-template-behavior.md` Q7-Q10）」を相互参照で明記。振替§と対称。

### C: オーナー確認事項

- **C1（最重要）**: 「生徒を空にする」（日付一括削除 `handleClearStudentsOnDate`）で、session 由来講習の希望数 −1・振替 origin のストック返却を単発削除と揃えて実装するか（正本§4「空にする＝削除と同じ扱い」どおり）、それとも「日付一括はストック非干渉（単純クリア）」を正として正本§4 の『空にする』を単発のみに限定するか（→A1）。現状は正本と実装が食い違う。
- **C2**: 講習残数の「盤面デルタ台帳」方式（盤面走査しない・A2/B1）を正とし、デルタ台帳が盤面と乖離した場合の収束（起動時 reconcile の要否）をどうするか。振替は盤面走査＝常に盤面が真だが、講習は台帳が壊れると自己修復されない（memory submission-board-persistence-asymmetry のリスク領域）。正本に方式を明記したうえで reconcile を追加するか、現状（デルタ台帳のみ・手動保存前提）を正とするか。
- **C3**: 旧文書 `lecture-edit-flow.md`（新正本が優先と明記済み・§削除の記述が実装と真逆）を、該当項に「新正本で変更」の注記を入れるか、完全アーカイブ化するか（→A3、軽微）。

### 危険と感じた点（記録・確定前）

- **A1（『空にする』が講習希望数を減らさない）は、正本§4・実装状況末尾が自ら「TODO 残」と認識している既知の未完了。** 室長が日付一括で講習を消しても希望数が残るため、その生徒の講習が未消化ストックに再出現し「消したのに戻ってくる」体感になりうる。振替でも同じ日付一括経路が origin 返却/抑制を通らないため、休日でない日付一括削除の振替の扱いも要確認（本監査では講習に絞ったが、`handleClearStudentsOnDate` は振替 origin も触らない点は横断リスク）。
- **A2/B1/B3（講習はデルタ台帳・振替は盤面走査）は、両ストックの根本的な非対称。** 振替側で領域4に「盤面走査＝盤面が常に真・過剰減算バグへのガード」を明文化したが、講習側は台帳の符号（負＝消費／正＝戻し）が壊れると残数が反転し、しかも自己修復が無い。`appendLectureStockCount` の符号・`consumeCount` の先頭削り・overwrite 返却の +1 は、いずれも「単純化」で符号や順序を触ると残数が静かにズレる。振替の consumeOriginDates と同様に「消してはならないガード」として正本にデータモデルを固定することを強く推奨。
- **科目選択の尊重（lectureStockPlacement.ts）と自動割振の共有コアは回帰テストで保護されているが、講習ストックの残数計算本体（`lecturePendingItemsByEntryKey`）には振替の `makeupStockSnapshot` のような残数ゴールデンが無い**（`lectureStockSnapshot.test.ts` は `buildLectureStockEntries`＝希望数だけを固定し、消費デルタ後の残数は固定していない）。release-checklist §6 は「未消化講習の要求数合計」を本番スポットチェックの対象にするが、デルタ適用後の残数の非退行はユニットで守られていない。残数計算を触る変更の回帰防止が振替より弱い点は要注意（正本明文化＋残数ゴールデン追加が望ましい）。
- 補足（所見外の記録）: `removeLecturePendingItemFromStockState`（`ScheduleBoardScreen.tsx:1053-1082`）は source ごとに session=−1デルタ／manual=+1側キー削除と非対称に分岐する。手動追加分（manual）の戻し操作は `removeLectureStockCount`（0以下でキー削除）を使い、session の配置消費（負デルタ append）と経路が違う。source の取り違えで残数がズレるため、この分岐も B5 の対応表に含めて固定するのが望ましい。

### 処置（正本更新・Issue化の記録）— オーナー確定 2026-07-04

- **C1: 日付クリックメニューの To-Be を3択に再定義で確定（選択肢外の新方針）** → ①休みにする（未消化へ・既存）
  ②**空にする（未消化に入れず削除）＝単純クリアで確定**（現行 `handleClearStudentsOnDate` を正とする・希望数−1もストック返却もしない）
  ③**振替える（全員を指定日へ振替）＝新設・Issue #40** で定義確定後に実装。
  正本§1・§4-2（新設）・現行差分1 を更新済み。振替の暗黙再出現の非対称（振替は盤面走査ゆえ単純クリアで在庫へ再出現・
  講習はデルタ台帳で再出現しない。クリア時の origin 抑制の要否は Issue #40 で確定）も §4-2 に明記。
  **A1 は差分でなくなった（正本を新 To-Be に更新・当初のバッチ希望数減算 TODO は撤回）。**
- **C2: 明文化＋残数ゴールデン追加で確定（reconcile は実装しない・台帳を正として据え置く）** → 正本§2「データモデル」新設。
  **残数ゴールデンは主セッションで実装**：`lecturePendingItemsByEntryKey` を純関数 `buildLecturePendingItemsByEntryKey` として
  `lectureStock.ts` へ切り出し（ロジック不変・キー生成ヘルパ3種と `LectureStockPendingItem` 型も移設）、
  `lecturePendingItems.test.ts` で残数を固定（デルタ無し展開・配置1回で該当科目だけ−1・負デルタ超過の0クランプ・
  正デルタの manual 追加とメタデータ先頭対応・fallback 表示名・代表シナリオのゴールデン）。
- **C3: 旧文書 `lecture-edit-flow.md` の該当項に注記挿入で確定** → §「コマ表で講習を削除するとき」に
  「※この項は新正本 §4 で変更（削除は由来を問わず未配置へ戻さない）」を挿入済み（本文は経緯記録として保持）。
- **B1〜B7: すべて正本へ明文化済み**（オーナー確認済み）:
  - B1（データモデル：requestedCount の pending 展開 − session 消費デルタ ＋ manual 加算・origin メタデータ・fallback 退避）
    → 正本§2「データモデル」新設。「符号・順序を触ると残数が静かにズレる＝消してはならないガード」を明記。
  - B2（消化順：負デルタは pending 展開の先頭から個数分削る・振替の元日付突き合わせとは別方式）→ §2。
  - B3（`manualLectureStockCounts` の正負両用データ辞書：負＝session 配置消費・正＝盤面戻し＋繰越）→ §2。
  - B4（集計キー＝生徒×科目×セッション・`name:` プレフィックス・グルーピングは生徒×セッション）→ §2。
  - B5（`specialStockSource`〈session/manual〉×各操作の対応表・`removeLecturePendingItemFromStockState` の分岐含む）→ §4-3 新設。
  - B6（欠席で session 由来講習は未消化へ +1・manual は戻さない・欠席解除で −1）→ §4-3 対応表（振替§1-B と対称）。
  - B7（テンプレ overwrite 時の講習返却/相殺・`spec-template-behavior.md` Q7-Q10 相互参照）→ §「テンプレ overwrite 時の
    講習ストック返却/相殺」新設。

## 領域6: 基本データ画面（2026-07-04）

正本 `docs/spec-basic-data.md`（2026-06-08 確定 To-Be）と現行実装（main・v1.5.382）を突き合わせた。
読み取り監査のみ（コード・正本は未編集、Firestore/本番へは未接続）。file:line は監査時点の値。
既知事例（memory: regular-teachers-only-board-source / no-regression-rule）と、領域3で確定済み
`spec-board-regular-placement.md` §6（授業時間＝`RegularLessonTemplateStudent.note` 転用）・`spec-save-restore.md` §6（初期設定 Excel 取込）と突き合わせた。

**先に「一致している主要点」（差分ではない・記録）**
- 表示タブは **生徒／講師／教室データ の3つ**（`BasicDataScreen.tsx:1374-1378` `tabItems`＝students/teachers/classroomData、描画 `:1454-1456`）。**マネージャータブは `tabItems` に無く描画経路も無い**。正本A・差分1 の「マネージャータブ削除」に一致（ただしデータ配管の残骸あり→B1）。
- 生徒の入力項目＝名前・表示名・メール・入塾日・退塾日・生年月日（`:1285` thead＝氏名/表示名/メール/入塾日/退塾日/生年月日/学年状態/操作）。`StudentRow` に `isHidden` 無し（`basicDataModel.ts:16-24`・`appState.ts` に isHidden 0件）。正本B・差分2 に一致。
- 学年は生年月日から自動判定（学年欄を持たない）＝`resolveCurrentStudentGradeLabel`（`basicDataModel.ts:134-141`）→`resolveGradeLabelFromBirthDate`（`studentGradeSubject.ts:41-57`）。正本B に一致。
- 在籍判定＝入塾日前・退塾日後・高3卒業後を非在籍（`isActiveOnDate` `basicDataModel.ts:172-179`／`resolveScheduledStatus` `:206-213`）。高3卒業は `hasGraduatedHighSchool`（`studentGradeSubject.ts:36-39`＝学年番号≥13）で生年月日から自動判定。正本B・差分3 に一致。
- 講師の入力項目＝氏名・表示名・メール・入塾日・退塾日・担当科目（`subjectCapabilities`＝科目＋上限学年）（`:1153` thead・`TeacherRow` `basicDataModel.ts:7-15`）。**`availableSlots`／`memo`／`isHidden` を持たない**（型に無し）。正本C・差分4 に一致。
- 講師の一時的な非表示は退塾日で代用＝`isHidden` 廃止・在籍判定は日付ベース（`resolveTeacherRosterStatus` `basicDataModel.ts:182-188`・birthDate を持たないため卒業判定はスキップ・コメント `:181`）。正本C（決定C）に一致。
- 担当科目は「選んだ学年以下を担当可能」（上限学年方式・`GradeCeiling`／`TeacherSubjectCapability` `basicDataModel.ts:3-5`）。正本C に一致。
- 在籍／非在籍の表示切替が生徒・講師の両タブにある（`RosterView='active'|'withdrawn'`・`:1148-1149,1280-1281`）。正本B・C に一致。
- 教室データタブは定休日（closedWeekdays）と机数（deskCount）のみ（`renderClassroomData` `:1336-1372`）。正本D に一致。祝日/強制開校 UI は無い（正本G に一致）。
- 基本データに通常授業の編集タブは無い（`BasicDataScreen` は `regularLessons` を受け取らず・編集経路も無い）。通常授業はコマ表テンプレモードで編集（領域3）。正本E に一致。
- Excel に「通常授業テンプレ」シートがあり書き出し/取り込みできる（`:511` 説明・`parseRegularLessonTemplateWorkbook` `:626`）。正本E に一致。
- 差分取込は ID 列を残して再取込で講習・ルール・盤面・ストックを保持したまま更新（`mergeImportedBundle` `:647-701` は managers/teachers/students/classroomSettings のみ更新し、講習・ルール・盤面・ストックには触れない）。ID→email→表示名→名前の順で照合（`findStudentMatch` `:114-135`・`findTeacherMatch` `:91-112`）。正本F に一致。
- 生徒/講師の管理データ Excel をテンプレ出力／現データ出力／差分取込できる（`:453-512` エクスポート・`:557-597` 取込）。正本F に一致。

### A: 仕様と実装の相違

**A1: 教室データタブに「並び替え・フィルタ」が無い（正本A「各タブの表は並び替え・フィルタができる」に対し教室データは表ですらない）**
- 正本の該当箇所: A「各タブの表は**並び替え・フィルタ**ができる」。
- 実装の該当箇所: `renderClassroomData`（`BasicDataScreen.tsx:1336-1372`）は定休日チップ＋机数入力の設定フォームで、表（table）ではない。`tableControls` は3タブ分（`:897-902`）用意されているが `classroomData` の並び替え/フィルタは使われない。生徒・講師タブには TableControl（フィルタ/ソート）があるが、教室データタブには適用対象の表が無い。
- 推奨処置: 正本A の「各タブの表は並び替え・フィルタができる」は**生徒・講師タブに限る**旨に補正（教室データは設定フォームで表ではない）。機能上の欠落ではなく正本の一般化しすぎ。C 扱いにはせず正本の文言補正候補（軽微）。→C1 で扱い方針のみ確認。

### B: 仕様に無い実装挙動（未定義）

**B1（最重要）: マネージャー（managers）のデータ配管が全面的に残存（正本A・差分1「関連 managers データ・初期値も整理」が未達）**
- 正本の該当箇所: A「★マネージャータブは削除」／差分1「マネージャータブを削除（**関連 managers データ・初期値も整理**）」。
- 実装の該当箇所: タブUI は削除済み（B節・一致点）だが、次が残存：型 `ManagerRow`（`basicDataModel.ts:4`）、`BasicDataBundle.managers`（`BasicDataScreen.tsx:64`）、`RowEditScope='manager'`（`:62`）、`findManagerMatch`（`:74-89`）、Excel エクスポートの「マネージャー」シート（`:453-457,436`）、Excel インポートの `managerRows`/`managers` 生成（`:557,561-569`）、`mergeImportedBundle` の manager マージ（`:648-658`）、重複ID検証（`basicDataImportValidation.ts:33`）、ID アロケータ（`:519`）。`initialManagers=[]`（`:151`）なので新規教室は空だが、既存データの managers は保存・復元・Excel を通じて往復し続ける。
- 推奨処置: 「managers は正本上は廃止だが、後方互換のため型・保存・Excel シートは残す（新規は空・UI 非表示）」を正本に明記するか、完全撤去（データ移行＋Excel シート削除）するかを確定。既存教室に managers データが残っている可能性があり、撤去には移行判断が要る。→C2。

**B2: 生年月日から算出する学年ラベルの範囲・単位（未就学／小1〜高3／卒業後）が正本に未定義**
- 正本の該当箇所: B「学年は生年月日から自動判定」とのみ（ラベル体系・境界は未記載）。
- 実装の該当箇所: `resolveGradeNumberFromBirthDate`（`studentGradeSubject.ts:18-33`）＝学年番号（小1=1…高3=12・13以上=卒業）。`resolveEnrollmentYearFromBirthDateParts`（`:13-15`＝4月未満は+6・以降は+7＝早生まれ考慮）。学年度境界は 4/1（`:30`）。`schoolYear < enrollmentYear` は「未就学」（`basicDataModel.ts:112`）。
- 推奨処置: 正本B に「学年＝生年月日×基準日で 未就学／小1〜6／中1〜3／高1〜3 を算出（4/1 学年度境界・早生まれは 1〜3 月生を1学年上に）。高3（学年番号12）の学年度末（3/31）を過ぎると卒業＝非在籍」を明記。学年境界は科目自動解決（領域3・`resolveDisplayedSubjectForBirthDate`）や在籍判定に直結する要定義事項。

**B3: 生徒/講師の同一性（ID／メール／表示名／名前の照合優先順位）が正本に未定義**
- 正本の該当箇所: F「ID列を残して再取込」とのみ（照合キーの優先順位・改名時の挙動は未記載）。
- 実装の該当箇所: `findStudentMatch`（`BasicDataScreen.tsx:114-135`）・`findTeacherMatch`（`:91-112`）＝**ID → メール → 表示名 → 名前**の順で既存行に照合し、一致すれば既存 ID を維持（`mergeImportedBundle:664,678`）。ID が保たれるため盤面・ストックの `managedStudentId` 参照（memory no-regression-rule の同一性補完・`mergeManagedDeskLesson`）が壊れない。改名（名前変更）しても ID/メール/表示名で追随できる。
- 推奨処置: 正本F に「再取込の同一性は ID→メール→表示名→名前の順で照合し既存 ID を維持（改名しても追随）。ID は盤面・ストックが `managedStudentId` で参照するため保持が必須」を明記。memory no-regression-rule の同一性補完と結合した消してはならない設計である旨を残す。

**B4: 差分取込は「更新・追加のみで削除しない」（インポートに無い生徒/講師は消えない）挙動が正本に未定義**
- 正本の該当箇所: 記載なし（F は保持・更新のみ言及）。
- 実装の該当箇所: `mergeImportedBundle`（`BasicDataScreen.tsx:648-686`）は `fallback.*.slice()` から始めて import 分を更新/追加するのみ。**import に含まれない既存行を削除しない**。生徒/講師の削除は画面の「削除」ボタン（`:1323` `removeStudent`）でのみ行う。
- 推奨処置: 正本F に「差分取込は更新・追加のみ（取込ファイルに無い既存生徒/講師は削除されない）。削除は基本データ画面から個別に行う」を明記。取り違えで大量削除が起きない安全側設計だが、未定義だと「Excel から消したのに残る」と誤認される。

**B5: `RegularLessonRow` の年度引き継ぎフィールド（`nextStudent1Id`/`nextSubject1`/`nextStudent2Id`/`nextSubject2`）が死蔵で残存**
- 正本の該当箇所: E（通常授業はテンプレ方式）／領域3 §2「引き継ぎ廃止・`nextStudent*` は常に空＝死蔵」。基本データ側モデルには未記載。
- 実装の該当箇所: `RegularLessonRow`（`regularLessonModel.ts:15-18`）に `nextStudent1Id/nextSubject1/nextStudent2Id/nextSubject2` が残り、`createInitialRegularLessons`（`:218-254`）でも常に空文字で埋める。領域3 で「常に空＝死蔵」と確認済みだが、基本データの通常授業モデル（`regularLessonModel.ts`）が正本E から参照されず、死蔵フィールドの扱いが基本データ領域では未定義。
- 推奨処置: 正本E に「通常授業モデル `RegularLessonRow` の年度引き継ぎフィールド（`nextStudent*`）は死蔵（常に空・領域3 で廃止確定）。Excel シート整理（差分5）で除去候補」を注記（領域3 との相互参照）。

**B6: `student1Note`/`student2Note` が授業時間（90/60/45）転用である旨が基本データモデル側に未注記**
- 正本の該当箇所: 領域3 §6 で「授業時間は `RegularLessonTemplateStudent.note` 転用・`normalizeRegularLessonNote`・note を別用途に流用しない」と確定済み。基本データ側の `RegularLessonRow.student1Note/student2Note`（`regularLessonModel.ts:7,12`）への波及は正本E に未記載。
- 推奨処置: 正本E に「`RegularLessonRow.studentNNote` は授業時間（''=90/'60'/'45'・`normalizeRegularLessonNote` `regularLessonModel.ts:65-72`）の転用で、メモに流用しない（領域3 §6 と同根・流用すると授業時間が失われ回帰）」を注記。

**B7: Excel「シート構成を整理（旧 RegularLessonRow 由来の不要部分を除去）」（差分5）が未完了で旧列が残る余地**
- 正本の該当箇所: F「③のテンプレ方式に合わせてシート構成を整理する（旧 RegularLessonRow 由来の不要部分を除去）」／差分5「Excel の『通常授業テンプレ』以外の旧通常授業シート/列を整理」。
- 実装の該当箇所: エクスポートは「マネージャー／講師／生徒／教室データ／通常授業テンプレ」シート構成（`BasicDataScreen.tsx:453-503`）。旧 RegularLessonRow 由来の独立シートは見当たらない（テンプレ方式へ統一済みに見える）が、B1 の「マネージャー」シートが残る点と、`RegularLessonRow` の死蔵フィールド（B5）がテンプレ書き出しに混ざらないかは要確認（本監査では未確認・要確認）。
- 推奨処置: 差分5 の「整理」の完了条件（残すシート・除去した列）を正本F に確定記載し、マネージャーシート（B1）の去就と併せて整理する。C 扱いにはせず記録（B1/B5 と連動）。

### C: オーナー確認事項

- **C1**: 正本A「各タブの表は並び替え・フィルタができる」を「**生徒・講師タブに限る**（教室データは設定フォームで表ではない）」に補正してよいか（→A1、軽微）。
- **C2（最重要）**: マネージャー（managers）のデータ配管（型・`BasicDataBundle.managers`・Excel シート・merge・検証・ID アロケータ）を、後方互換として「残す（新規は空・UI 非表示）」と正本に明記するか、完全撤去（既存教室の managers データ移行＋Excel シート削除）するか（→B1、差分1 が未達）。撤去には既存データ移行判断が要る。
- **C3**: Excel シート構成整理（差分5・B7）の完了条件を確定し、死蔵フィールド（`nextStudent*`＝B5）・マネージャーシート（B1）の去就を含めて正本F に記載するか（→B5/B7）。

### 危険と感じた点（記録・確定前）

- **B3（同一性 ID→メール→表示名→名前）は、盤面・ストックの `managedStudentId` 参照と結合した消してはならない設計。** 再取込で既存 ID を維持することで、盤面配置・振替/講習ストック・生徒日程表の生徒参照が壊れない（memory no-regression-rule の `mergeManagedDeskLesson` 同一性補完と同根）。照合の優先順位を「単純化」で ID のみ等に変えると、ID 空欄の Excel 再取込で全生徒が新規扱いになり盤面から生徒が消える／二重化する危険がある。正本に照合順を固定することを強く推奨。
- **B1（managers 残骸）は本番データに存在しうる。** 既存教室のスナップショットに managers 配列が残っている可能性があり、完全撤去する場合は「保存データからの managers 削除＝データ移行」になる。UI から見えないため気づきにくく、Excel エクスポートには今も「マネージャー」シートが出るため、室長が古いシートを編集して再取込すると復活しうる。撤去/存置の判断は移行影響を確認してから。
- 補足（所見外の記録）: `resolveStudentGradeSortOrder`（`basicDataModel.ts:129-130`）と `resolveManagementRosterStatusLabel`（`:200`）に `'非表示'` の分岐が残るが、`resolveScheduledStatus`（`:206-213`）は在籍/入塾前/退塾しか返さず `'非表示'` を生成しないため**死蔵ラベル**（isHidden 廃止の残骸）。害はないが、isHidden 完全撤去の一貫性としては将来除去候補（差分2 の残滓）。
- 補足（所見外の記録）: `BasicDataTab` 型に `'constraints'`（`BasicDataScreen.tsx:61`）が残るが `tabItems` に無く描画経路も無い**死蔵タブ種別**。`tableControls` にも `constraints` エントリ（`:900`）が残る。ペア制約は正本A どおり自動割振ルール画面（⑧）へ移管済みで、基本データ側の constraints は使われない。

### 処置（正本更新・Issue化の記録）— オーナー確定 2026-07-04

- **C1: 「生徒・講師タブに限る」と補正で確定** → 正本§A を「並び替え・フィルタは生徒・講師タブの表に限る（教室データタブは定休日チップ＋机数の設定フォームで表ではない）」に更新済み。**A1 は差分でなくなった。**
- **C2: managers 完全撤去で確定** → **Issue #41** 起票済み（移行計画つき：ロード時 tolerant 無視→保存時に書き出さず自然消滅・本番一括書込なし・旧「マネージャー」シート再取込は無視・受け入れ条件つき）。正本§A・差分1 に「managers はデータ配管ごと完全撤去する（Issue #41・自然消滅方式）。撤去完了までは型・保存・Excel シートが残存する（現状）」を明記済み。**撤去の実装は Issue #41（主セッション/dev-fix）で対応。**
- **C3: Excel シート整理（差分5）の完了条件を明記で確定** → 正本§F に「残すシート＝講師/生徒/教室データ/通常授業テンプレ（マネージャーは Issue #41 で撤去）」、正本§E に死蔵 `nextStudent*` の将来除去候補を明記済み。
- **B2〜B6: すべて正本へ明文化済み**（オーナー確認済み）:
  - B2（学年ラベル定義：生年月日×基準日・未就学／小1〜6／中1〜3／高1〜3・4/1 学年度境界・早生まれは1学年上・高3学年度末超過で卒業＝非在籍）→ 正本§B。
  - B3（同一性照合 ID→メール→表示名→名前・既存 ID 維持・改名追随・`managedStudentId` 参照保護と結合した消してはならない設計・memory no-regression-rule の `mergeManagedDeskLesson` 同一性補完と同根）→ 正本§F。
  - B4（差分取込は更新・追加のみ・取込に無い既存は削除されない・削除は画面から個別に）→ 正本§F。
  - B5（`nextStudent*` 死蔵・将来除去候補・領域3 §2 と相互参照）→ 正本§E。
  - B6（`studentNNote` は授業時間転用・メモに流用しない・領域3 §6 と同根）→ 正本§E。
- **補足死蔵2件**（`'非表示'` ラベル分岐・`'constraints'` タブ種別/tableControls）は **Issue #41 の「あわせて除去してよい死蔵」に含める**（正本§監査確定に撤去予定として記載済み）。

## 領域7: 特別講習データ・提出ページ（2026-07-04）

正本 `docs/spec-special-session-submission.md`（2026-06-07 確定 To-Be／2026-06-09 Phase 5 ⑦ 実装状況を含む）と現行実装（main）を突き合わせた。
読み取り監査のみ（コード・正本は未編集、Firestore/本番へは未接続）。file:line は監査時点の値。
既知事例（memory: submission-board-persistence-asymmetry〈countSubmitted と盤面配置の永続化非対称・起動時 reconcile〉／
group-participation-save-paths〈集団参加の保存2経路・空 doc union 反映の回帰〉）と、領域2 の B3 所見（QR 提出反映の
起動時自己修復 reconcile は本領域だが保存領域の論点として先に触れた）と突き合わせた。

**重要な前提（本領域の正本が「講習・集団・オプション」に分散）**: 本領域の正本 `spec-special-session-submission.md` は
教室側の講習データ画面・QR 配布・提出ページ（出席不可／希望科目数／授業時間）・提出ロック/再提出を定義するが、
**集団授業の提出（`groupClassParticipation`・中3の集団理科/社会・提出ページの集団列）は `docs/spec-group-lesson.md`（§C/§E）**、
**授業時間の講習ストック側の扱いは `docs/spec-lecture-stock.md` §6（領域5 で確定）** に正本があり、
本書からこれらへの相互参照が無い。加えて**オプション欄（開発用教室・`optionChecks`/`optionLabels`）は正本 3書のいずれにも
明文がない**（後述 B1/B2）。本書だけを読むと提出ページの実挙動（集団・オプション・授業時間の相互作用）が未定義に見える。

**先に「一致している主要点」（差分ではない・記録）**
- 講習データ画面で管理するのは講習名＋期間だけ（`SpecialSessionScreen.tsx:670-707` `createSession`＝label/startDate/endDate のみ・`SpecialSessionRow` の入力は period 系のみ編集）。正本A に一致。
- 「新規作成」で講習名＋期間登録、一覧から編集・削除できる（`:754` 新規作成トグル・`:816` 編集/`:817` 削除・`removeSession:623` は confirm 付き）。正本A に一致。
- 新規教室は講習データ空で開始・過去サンプルはロード時除去（`initialSpecialSessions=[]` `specialSessionModel.ts:89`、`removedDefaultSpecialSessionIdSet` で 4 サンプル ID をロード時 filter・`App.tsx:396,431`）。正本A に一致。
- 欠席不可・希望の登録経路は日程表/QR に一本化（画面サブコピー「欠席不可コマ・希望科目数の登録は日程表（生徒/講師）とQRから行います」`SpecialSessionScreen.tsx:745`。TODO1 で別タブ経路の生成器・handler・effect を撤去済み）。正本A・主な差分1・実装状況 TODO1 に一致（ただし編集パネル内に旧経路の案内文が1箇所残存→A1）。
- 生徒・講師それぞれに個別の提出トークン（QRリンク）を発行（`ensureSubmissionTokens` `lectureSubmission.ts:55-158` が person 単位で `submissionToken` を採番・`writeSubmissionDocs:160` で doc 化。QR は日程表 HTML に埋め込み `scheduleHtml.ts:210,214,744` `buildSubmissionUrl`→`/#/submit/{token}`）。正本B に一致。
- 室長は提出状況をリアルタイム受信（`subscribeLectureSubmissions` の `onSnapshot` で `status=='submitted'` を購読・`App.tsx:3732`、新着は `submissionAcknowledgements` に積む・初回スナップショットは通知抑止 `isInitial`）。正本B に一致。
- 提出ページ＝本人用フォーム（講習名・氏名・期間表示 `SubmissionPage.tsx:642-648`）。表は日付×限で出席不可コマをタップ×（`toggleSlot:272`）。日付タップで終日不可（`toggleAllSlotsForDate:281`）・限ヘッダタップで列全部不可（`toggleAllSlotsForColumn:298`）。正本C に一致。
- 既に盤面に組まれたコマは青表示＋不可にしようとすると確認（`occupiedSlots` を淡青 `.sub-slot-occ`・`toggleSlot` の occupiedLabel で `window.confirm`・`:277`）。休校日は灰色で選択不可（`isClosed` 行は結合セル「休校日」・タップ不可 `:517-524,682-688`、判定 `buildAvailableDates:130`＝closedWeekdays∪holidayDates−forceOpenDates）。正本C に一致。
- 希望科目数を科目ごと＋/−で入力・合計表示（`handleSubjectChange:313`・`totalSubjectCount:629`）。「通常授業のみ（講習なし）」チェックで講習ストック対象外（`regularOnly` を提出・`buildLectureStockEntries` が `!regularOnly` のみ対象＝領域5 一致）。正本D に一致。
- 提出→確認→完了画面・提出後は本人変更不可（`handleSubmit:336` confirm→`setSubmitted(true)`・POST で doc `status='submitted'`・`functions/src/index.ts:2219`）。既提出リンクを開く/再送信は「すでに提出済みです」画面（`loadedAsSubmitted` で「提出完了」と出し分け `SubmissionPage.tsx:492`・POST 409 も同画面 `:355-358`）。正本E・実装状況 TODO4 に一致。
- 無効リンクは「このリンクは無効です。管理者にお問い合わせください。」（404→`SubmissionPage.tsx:233`）。正本E・実装状況 TODO4 に一致。
- 再提出モデル＝「登録削除で再提出可能化」（TODO2）：日程表の登録トグル ON＝`markLectureSubmissionDocAsSubmitted`（ロック）／OFF＝`resetLectureSubmissionDoc`（提出内容クリア＋pending・配布情報維持 `lectureSubmission.ts:174-193`）。`unlockLectureSubmissionDoc`（ロック解除・データ保持）は撤去済み（src 全体 0 件）。正本E・主な差分2・実装状況 TODO2 に一致。
- 授業時間 90/60/45 を提出ページで科目ごとに選択・既定/未入力＝90分・希望数>0 の科目にのみ表示（`SubmissionPage.tsx:740-752` セレクタ・`handleDurationChange:327` は 60/45 のみ保持し 90 は落とす・希望数 0 で `subjectDurations` から削除 `:317-324`）。サーバ `sanitizeSubjectDurations`（45/60 のみ許容 `functions/src/index.ts:2095`）。正本F・主な差分3・実装状況 TODO3 に一致。
- Excel 往復（特別講習/生徒日程入力/講師日程入力/説明シート）が講習データ画面にある（`buildSpecialSessionWorkbook:346`・`parseSpecialSessionWorkbook:383`・ID 優先→講習名照合 `resolveSessionIdentity:373`）。正本には Excel 言及が無いが機能として存在（後述 B7）。

### A: 仕様と実装の相違

**A1: 講習データ画面の編集パネルに、TODO1 で廃止したはずの「別タブで欠席不可入力」案内文が残存（正本A・主な差分1 に反する死んだ導線の文言）**
- 正本の該当箇所: A「現行の『コマ表の講習期間帯をクリック→別タブで欠席不可入力』経路は廃止」／主な差分1「別タブの欠席不可入力経路を廃止し、登録を日程表に一本化」／実装状況 TODO1「✅ 撤去」。
- 実装の該当箇所: `SpecialSessionScreen.tsx:852`（講習編集パネル内の案内文）が今も「欠席不可日の入力は、コマ表に戻ってこの講習の期間帯をクリックすると別タブで開きます。」と表示。実際の別タブ生成器・handler・effect は TODO1 で撤去済み（`specialSessionAvailabilityHtml.ts` 削除・`special-session-availability-save` handler なし）ため、この文言が案内する導線は存在しない（死んだ案内文）。画面ヘッダのサブコピー（`:745`）は正しく「日程表とQRから」に更新済みで、編集パネル内の1文だけ取り残されている。
- 推奨処置: `:852` の案内文を削除するか「欠席不可コマ・希望科目数の登録は日程表（生徒/講師）とQRから行います」に統一。文言のみの軽微修正だが、室長が実在しない「別タブ」を探す混乱源。C 扱いにはせず実装対象候補（軽微 A）。→ C1 で扱い方針のみ確認。

**A2: 提出（QR の POST）自体が `countSubmitted=true`（＝室長登録）を立て、盤面自動配置まで走る。正本E の「提出」と「室長の登録（確定）」の二段階が実装では一段階に統合されている**
- 正本の該当箇所: E「室長がその人の登録を削除すると提出がリセット」「ただし室長がそのデータを登録（確定）した後は再提出不可」（＝提出＜登録の2段階を前提。提出後も室長が登録するまでは再提出可、という読み方ができる）／主な差分2「室長が登録（確定）するまでは再提出可、確定後は不可」。
- 実装の該当箇所: 提出 POST は即 `status='submitted'`（`functions/src/index.ts:2219`）にし、以後の POST を 409 で拒否（`:2201`）＝**提出した時点で本人は再提出不可**。同時にサーバのスナップショット統合で `countSubmitted: true`（`:2257`）を立て、クライアント購読 `onSubmitted`（`App.tsx:3752-3808`）も `countSubmitted: true` にして講師は自動配置（`buildTeacherAutoAssignItems`）・生徒は希望数/配置を反映。つまり「提出＝登録＝ロック＝自動配置」が一括で起こり、室長の「登録（確定）」という独立ステップは無い。再提出可能化は室長が日程表の登録トグルを OFF（`resetLectureSubmissionDoc`）にしたときのみ。
- 推奨処置: 正本E の「提出」と「室長の登録（確定）」を実装どおり「提出＝即ロック＝即 countSubmitted（＝登録）」と再定義するか、正本どおり「提出後も室長が登録するまでは再提出可」を維持して実装を変えるか（後者は現行の 409 即ロックを緩める大改修）。現行は「提出したら本人は変更不可・戻すのは室長の登録解除のみ」で一貫しており運用上も自然なため、**正本を実装に合わせる（提出＝登録・再提出可能化は室長の登録解除のみ）**のが安全側。判断は C2。**この二段階/一段階の解釈差は、再提出運用の根幹で未定義のまま放置しない。**

**A3: 講習期間の重複を禁止するバリデーション（同一期間の講習を作れない）が実装にあるが正本に未定義（正本A の「作成・編集」に制約が書かれていない）**
- 正本の該当箇所: A「新しい特別講習を作成…一覧から編集・削除できる」（作成・編集の制約〈同名禁止・期間重複禁止〉は未記載）。
- 実装の該当箇所: `validateSessionDraftAgainstSessions`（`SpecialSessionScreen.tsx:112-124`）が、同名（`findSessionWithSameLabel`）と**期間重複**（`findSessionDateRangeConflict:101-110`＝期間が1日でも重なる別講習があると作成/編集を拒否）を禁止。作成時（`createSession:680`）と編集完了時（`closeSessionEditor:604`・重複なら編集前スナップショットへ巻き戻す）に適用。
- 推奨処置: 正本A に「講習名は重複不可・講習期間は他講習と重複不可（1日でも重なると作成/編集を拒否）。編集で重複した場合は編集前の値に巻き戻す」を明記。提出トークンの科目/集団判定が「講習開始日基準の学年」（`App.tsx:3176` 付近）に依存するため、期間重複を許すと同一日が複数講習に属し提出先が曖昧になる。この制約は仕様として明文化すべき設計判断。→ B ではなく正本補完対象（軽微 A）。C3 で扱い方針のみ確認。

### B: 仕様に無い実装挙動（未定義）

**B1（最重要）: 集団授業の提出（`groupClassParticipation`・中3の集団理科/社会・提出ページの集団列）が本領域の正本に一切未定義（正本は `spec-group-lesson.md` §C/§E だが相互参照が無い）**
- 正本の該当箇所: 記載なし（本書 D は希望科目数のみ。集団参加の提出は触れていない）。
- 実装の該当箇所: 提出ページの集団参加チェック（`SubmissionPage.tsx:792-816`・中3かつ `availableGroupClassSubjects` 非空のみ表示）・盤面の集団コマを案内する集団列（`renderGroupBodyCells:458`・`groupClassSlots`）。データは `SpecialSessionStudentInput.groupClassParticipation`（`specialSessionModel.ts:18`）。トークン発行時に中3のみ `availableGroupClassSubjects` を載せ（`App.tsx:3184`）、既配布 QR にも後埋め（`updateSubmissionGroupClassEligibility` `lectureSubmission.ts:200`）。サーバは `sanitizeGroupClassParticipation`（allowed 科目の true のみ・`functions/src/index.ts:2108`）。反映は**2経路**（QR購読／生徒日程表の登録メッセージ・memory group-participation-save-paths）で、購読側は空 doc 消失を防ぐ union 反映（`reflectParentOwnedSubmissionFields` `submissionReflection.ts`・本番データ消失 v1.5.336 の回帰防止）。
- 推奨処置: 本書に「集団授業の提出（中3の集団理科/社会の参加可否・提出ページの集団列）の正本は `spec-group-lesson.md` §C/§E」と相互参照を明記。あわせて「保護者所有フィールド（`groupClassParticipation`）の反映は 2経路（QR購読・日程表登録）あり、購読反映は union（削減しない）で空 doc が既存を消さない＝過去の本番消失事故への意図的ガードで消してはならない」を注記（memory group-participation-save-paths / submission-board-persistence-asymmetry と結合）。

**B2（最重要）: オプション欄（開発用教室・`optionChecks`/`optionLabels`）の提出が正本 3書のいずれにも明文がない完全な未定義機能**
- 正本の該当箇所: 記載なし（本書・`spec-group-lesson.md`・`spec-lecture-stock.md` のいずれにも optionChecks/optionLabels の記述が無い）。
- 実装の該当箇所: 提出ページのオプション欄（`SubmissionPage.tsx:818-841`・`optionItems` は文言が入った行のみ表示 `buildOptionItems:84`）。文言は学年共通の `scheduleNotes`（`student:student-option-grade-{学年}-{行0..4}`）から解決（`App.tsx:3169-3176`）。フィーチャーフラグ `studentScheduleOptionField`（開発用教室のみ・`isFeatureEnabledForClassroom`）で有効化。学年は**今日基準**で解決（提出は講習開始日基準だがオプションだけ今日基準・`App.tsx:3163-3167` に「学年が食い違い空文字になる不具合」の回帰コメント）。サーバ `sanitizeOptionChecks`（非空ラベル行の true のみ・`functions/src/index.ts:2120`）。`optionChecks` も保護者所有フィールドとして union 反映（B1 と同じ経路）。
- 推奨処置: オプション欄を仕様として明文化するか（本書 D の別項 or 別正本 `spec-student-schedule.md` 等）、フィーチャーフラグ限定の実験機能として「正本化は保留（開発用教室のみ・`studentScheduleOptionField`）」と記録するかをオーナー確認（→C3）。学年キーの基準日（今日基準 vs 講習開始日基準）の非対称は回帰の温床であり、明文化しないと将来「オプションが空で出る」不具合が再発しうる。**未定義機能が本番導線（提出ページ）に出ている点は本監査の主目的に合致。**

**B3: 提出（POST）→盤面自動配置の永続化が非対称（`countSubmitted` は自動同期・盤面配置は手動保存のみ）＋講師配置のみ起動時 reconcile がある（生徒の講習ストック消費には自己修復が無い）**
- 正本の該当箇所: 記載なし（本書は提出の capture までしか定義せず、反映先〈盤面／countSubmitted〉の永続化タイミング差と自己修復に触れていない。領域2 B3・領域5 A2 で保存側から言及済み）。
- 実装の該当箇所: QR購読 `onSubmitted`（`App.tsx:3752`）で `countSubmitted` を立て講師を自動配置するが、`countSubmitted`（specialSessions state）は workspace 自動同期で永続・**盤面配置は手動保存（Cloud Function snapshot）でのみ永続**（memory submission-board-persistence-asymmetry）。手動保存前リロードで配置だけ揮発し `countSubmitted=true` が残ると `if (existing?.countSubmitted) return` でスキップされスタック。対処＝起動時 `reconcileSubmittedTeacherPlacements`（`ScheduleBoardScreen.tsx`・純関数・boardMountKey で1回・`countSubmitted=true` なのに未配置の講師だけ冪等再配置）。ただし**生徒の講習ストック消費デルタには自己修復が無い**（領域5 A2/C2）。
- 推奨処置: 本書に「QR 提出の反映は capture（提出時）＋起動時 reconcile（あるべき状態への収束）の二段で守る」「`countSubmitted`（自動同期）と盤面配置（手動保存のみ）の永続化非対称ゆえ、手動保存前リロードでの取りこぼしを reconcile が冪等に埋める（講師は自己修復あり・生徒講習ストックは無い＝領域5 C2 と連動）」を注記。領域2 B3 の保存側記述と相互参照。**過去の本番スタック（v1.5.357）への意図的ガードで消してはならない旨を明記。**

**B4: 提出リセット後の再提出レース対策 `recentlyResetSubmissionTokensRef` が実装上「読むが誰も書かない」インエル状態（ガードとして機能していない）**
- 正本の該当箇所: 記載なし。
- 実装の該当箇所: `recentlyResetSubmissionTokensRef`（`App.tsx:1235`）を購読反映で `activeEntries = entries.filter((e) => !ref.has(e.token))`（`:3735`）とレース除外に使うが、この Set に `.add` する箇所が src 全体に存在しない（常に空）。リセット（`resetLectureSubmissionDoc`・登録解除 `App.tsx:3534`）直後に、リセット前の submitted スナップショットが購読で届いて `countSubmitted` を復活させるレースを防ぐ意図と読めるが、**現状は無効**（フィルタは常に全通過）。
- 推奨処置: 「リセット直後の購読レース除外」を仕様として意図しているなら実装（リセット時に token を一定時間 Set へ add／解除）を補うべきか、意図が失われたデッド ref として撤去するかをオーナー確認（→C は付けず記録・要判断は dev-fix 起票候補）。実害の有無は「登録解除直後に古い submitted 購読で登録が戻る」再現次第で、未定義のまま放置すると再提出運用のレース回帰の温床。C 扱いにはせず記録（B・要 dev-fix 精査）。

**B5: `deleteLectureSubmissionDoc`（提出ドキュメントの完全削除）が実装にあるが呼び出し 0 件のデッドコード（正本の「登録削除＝リセット」モデルと役割が重複）**
- 正本の該当箇所: E「室長がその人の登録を削除すると提出がリセット」（＝doc は残し pending に戻す `resetLectureSubmissionDoc`。doc 自体の削除は定義されていない）。
- 実装の該当箇所: `deleteLectureSubmissionDoc`（`lectureSubmission.ts:255-261`・`deleteDoc`）は export されるが src に呼び出しが無い（テスト外 0 件）。TODO2 で「登録削除＝リセット」に統一した際に doc 完全削除の経路が使われなくなった残骸と推測。
- 推奨処置: 正本E に「登録削除は doc を残し pending に戻す（`resetLectureSubmissionDoc`）方式で、doc の完全削除は行わない。`deleteLectureSubmissionDoc` はデッド（将来撤去候補）」を注記。明白なデッドのため C 扱いにはしない（軽微・記録）。

**B6: 提出トークンの発行/更新のタイミング（日程表を開くたびに未発行者へ採番・既発行 QR へ occupiedSlots/holidayDates/slotNumbers/groupClassSlots/optionLabels を後追い反映）が正本に未定義**
- 正本の該当箇所: B「個別の提出トークン（QRリンク）を発行して配る」（発行/更新の契機・後追い反映は未記載）。
- 実装の該当箇所: `ensureSubmissionTokens`（`lectureSubmission.ts:55`）は `submissionToken` 未保持の person にのみ採番（既発行はスキップ・冪等）。`updateSubmissionOccupiedSlots`（`:264`）が既発行 doc に最新の盤面配置（青表示）・休日・限数・集団コマ・オプション文言を後追い反映（`App.tsx:3204-3227`）。既配布 QR にも中3の集団選択肢を後埋め（`updateSubmissionGroupClassEligibility`・pending のみ）。
- 推奨処置: 正本B に「トークンは一度発行したら維持（同じ QR を配り続けられる）。盤面変更・休日設定・限数変更・集団コマ・オプション文言は既発行 QR にも後追い反映され、提出ページが常に最新の盤面/休日を映す」を明記。提出ページの「青表示（occupied）」「休校日（灰）」が動的に更新される根拠。

**B7: 講習データの Excel 書き出し/取り込み（特別講習/生徒日程入力/講師日程入力/説明の4シート・ID優先→講習名照合）が正本に未定義**
- 正本の該当箇所: 記載なし（本書は Excel に触れない）。
- 実装の該当箇所: `buildSpecialSessionWorkbook`（`SpecialSessionScreen.tsx:346-371`）／`parseSpecialSessionWorkbook`（`:383-470`）。生徒日程入力シートは参加不可コマ・希望科目数・通常のみ・提出済フラグを往復。ただし**授業時間 `subjectDurations`・集団参加 `groupClassParticipation`・オプション `optionChecks` は Excel の往復対象外**（`buildStudentInputRows:277-290` に列が無い）。照合は講習ID優先→講習名（`resolveSessionIdentity:373`）。
- 推奨処置: 正本（本書か領域6 の Excel 節）に「講習データも Excel 往復できる（特別講習/生徒日程入力/講師日程入力/説明の4シート・ID優先照合）。ただし授業時間・集団参加・オプションは Excel 非対応（QR/日程表でのみ入出力）」を明記。Excel だけ再取込すると授業時間/集団/オプションが落ちる非対称は室長の体感に直結する未定義。

**B8: 提出ページの表示補正（iOS/Android のビューポート幅・zoom・逆ズーム）とデバッグ画面（#/submit-debug）が正本に未定義**
- 正本の該当箇所: 記載なし。
- 実装の該当箇所: `SubmissionPage.tsx:170-196`（iOS/Android 別のビューポート幅・zoom を初回ペイント前に適用・`iosViewport.ts`）、Android のみ表を逆ズームで全幅化（`tableWrapStyle:185`）、`#/submit-debug` のダミーデータ＋調整パネル（`DEBUG_DUMMY_DATA:48`・`debugPanel:405`）。
- 推奨処置: 正本C に「提出ページはスマホ最適化（iOS/Android 別のビューポート補正）。`#/submit-debug` は実機表示調整用のダミー画面（本番トークン不要・ネットワーク非使用）」を注記。表示崩れ調査時の入口を仕様に残す（軽微）。

**B9: 提出リセット（`resetLectureSubmissionDoc`）が `regularBreakSlots` を保持し `unavailableSlots`/`subjectSlots`/`subjectDurations`/`groupClassParticipation`/`optionChecks`/`regularOnly` のみクリアする、クリア対象の粒度が正本に未定義**
- 正本の該当箇所: E「提出がリセットされ…配布情報は維持」（何をクリアし何を残すかの粒度が未記載）。
- 実装の該当箇所: `resetLectureSubmissionDoc`（`lectureSubmission.ts:182-192`）は `status='pending'` にし提出6フィールド（unavailableSlots/subjectSlots/subjectDurations/groupClassParticipation/optionChecks/regularOnly）と `submittedAt` をクリア。配布情報（occupiedSlots/availableSubjects/slotNumbers/holidayDates/personName 等）と `availableGroupClassSubjects`・`optionLabels` は維持。生徒日程表側の登録解除経路（`App.tsx:3534`）は同時にローカルの `countSubmitted` も OFF にし unassign 要求を出す。
- 推奨処置: 正本E に「登録解除（リセット）でクリアするのは提出内容（出席不可・希望科目数・授業時間・集団参加・オプション・通常のみ・提出時刻）のみ。配布情報（本人名・期間・盤面配置・休日・限数・集団科目の選択肢・オプション文言）は維持し、同じ QR で再提出できる」とクリア粒度を明記。

### C: オーナー確認事項

- **C1**: 講習編集パネル内の死んだ案内文（`SpecialSessionScreen.tsx:852`「別タブで開きます」）を削除/文言統一する軽微修正を実装対象としてよいか（→A1）。
- **C2（最重要）**: 提出のモデルを「提出＝即ロック＝即 countSubmitted（＝登録）・再提出可能化は室長の登録解除（`resetLectureSubmissionDoc`）のみ」と実装どおり正本E に再定義するか、正本どおり「提出後も室長が登録（確定）するまでは再提出可」を維持して実装（現行の POST 409 即ロック）を緩める大改修とするか（→A2）。現行は一段階（提出＝登録）で一貫しており運用上も自然なため、実装を正とするのが安全側。
- **C3**: オプション欄（`optionChecks`/`optionLabels`・フィーチャーフラグ `studentScheduleOptionField`・開発用教室のみ）（B2）を仕様として正本化するか、実験機能として「正本化保留・開発用教室限定」と記録に留めるか。あわせて講習期間の重複禁止（A3）を正本A に明文化してよいか。
- （B1 集団参加・B3 永続化非対称/reconcile・B5 デッド delete・B6 トークン後追い反映・B7 Excel 非対称・B8 表示補正・B9 リセット粒度は明文化方針が明確なため C ではなく処置で正本反映を提案。B4 の recentlyReset 無効ガードは dev-fix 精査対象として記録。）

### 危険と感じた点（記録・確定前）

- **B1（集団参加の union 反映）と B3（起動時 reconcile）は、いずれも実際の本番データ消失/スタック事故への意図的ガードで、正本に未定義のまま放置されている。** 集団参加は空 doc union（v1.5.336・緑が丘5名/日大前2名の集団参加消失）・countSubmitted と盤面配置の永続化非対称は起動時 reconcile（v1.5.357・提出したのに名前が出ないスタック）で守られている。本監査の主目的（未定義＝バグの温床）に最も合致するため、確定時に「消してはならないガード」として本書に明記することを強く推奨（memory submission-board-persistence-asymmetry / group-participation-save-paths）。
- **A2（提出＝即ロック）の解釈差は再提出運用の根幹。** 正本E を字義どおり「提出後も室長登録まで再提出可」と読むと、実装（POST 409 即ロック）は仕様違反に見える。だが実装は「本人は提出で確定・戻すのは室長の登録解除のみ」で一貫しており、二重提出防止（正本E）とも整合する。安易に「未実装 A」として POST のロックを緩める実装を起票すると、二重提出防止と衝突し回帰しかねない。正本側を実装に合わせる方向（C2）が妥当。
- **B4（recentlyReset の無効ガード）は、登録解除直後の購読レースで登録が戻る潜在バグの防波堤のはずが機能していない。** 実害の有無は要再現だが、`resetLectureSubmissionDoc` は非同期・購読 `onSnapshot` はリセット前の submitted を配信しうるため、レースで `countSubmitted` が復活する経路が理論上ある。ガードを「読むだけ・書かない」状態のまま放置すると、将来「登録解除しても戻ってくる」不具合の調査を難しくする。dev-fix での精査（add 経路の補完 or ガード撤去）を推奨。
- 補足（所見外の記録）: サーバの QR 提出スナップショット統合は楽観ロックの版数を据え置く（`functions/src/index.ts:2270-2273`・版数を +1 すると管理者側の保存が STALE 誤判定でブロックされるため）。これは領域2 B1（楽観ロック）と結合した意図的挙動で、提出のたびに室長保存が拒否されるのを防ぐ。版数据え置きを「単純化」で +1 に変えると室長が保存できなくなる回帰。

### 処置（正本更新・Issue化の記録）— オーナー確定 2026-07-04

- **C1（A1・死んだ案内文の実装修正）**: 正本更新だけでなく**コード修正も実施**と確定。
  `SpecialSessionScreen.tsx:852` の講習編集パネル内の案内文「欠席不可日の入力は、コマ表に戻ってこの講習の
  期間帯をクリックすると別タブで開きます。」を、画面ヘッダのサブコピー（`:745`）と同じ
  「欠席不可コマ・希望科目数の登録は日程表（生徒/講師）とQRから行います」に統一。別タブ経路は TODO1 で撤去済みで
  実体が無いため文言のみの修正（ロジック変更なし）。正本には別タブ経路の記述は残っていない（A で既に「廃止」明記）ため
  正本側の削除は不要。→ 実装済み・回帰テスト追加。

- **C2（A2・提出モデルの一段階統合）**: **実装どおり正本E を一段階モデルへ書き換え**と確定。
  「提出＝即ロック＝即 `countSubmitted`（＝室長の登録）。再提出可能化は室長が日程表側の登録を解除
  （`resetLectureSubmissionDoc`）した場合のみ」を正本E とする。旧来の二段階（「提出後も室長が登録〈確定〉するまでは
  再提出可」）の記述は削除。判断根拠（現行の POST 即 `status='submitted'`・以後 409 で再提出拒否は二重提出防止と一貫し
  安全側）も正本に残す。→ 正本E・主な差分2 を更新。

- **C3（B2 オプション欄／A3 講習期間重複禁止の明文化）**: **両方を正本へ明文化**と確定。
  1. オプション欄（`optionChecks`/`optionLabels`）を正本化。フィーチャーフラグ `studentScheduleOptionField` で
     **開発用教室のみ有効**な機能と明記。学年解決が**今日基準**（提出本体は講習開始日基準）という非対称も明記し、
     回帰の温床であることを注記。→ 正本D に新項を追加。
  2. 講習期間の重複禁止を正本A に明文化。「講習名は重複不可・講習期間は他講習と重複不可（1日でも重なると作成/編集を
     拒否）。編集で重複した場合は編集前の値に巻き戻す」を実装済み挙動としてそのまま記載。→ 正本A に追記。

- **B1/B3/B5/B6/B7/B8/B9（明文化方針が明確・オーナー確認不要）**: すべて正本へ反映と確定。
  - B1: 集団参加提出の正本は `spec-group-lesson.md` §C/§E への相互参照を明記。保護者所有フィールドの反映は 2経路
    （QR購読／日程表登録）で、購読反映は union（削減しない）＝本番消失事故（v1.5.336）への意図的ガードと注記。→ 正本D。
  - B3: QR 提出の反映は capture（提出時）＋起動時 reconcile の二段。`countSubmitted`（自動同期）と盤面配置
    （手動保存のみ）の永続化非対称。講師は自己修復あり・生徒講習ストックは無い（領域5 連動）。本番スタック
    （v1.5.357）への意図的ガードで消してはならない旨を明記。→ 正本E。
  - B5: `deleteLectureSubmissionDoc` はデッドコード。登録削除は `resetLectureSubmissionDoc`（doc 残し pending に
    戻す）方式である旨を明記。→ 正本E。
  - B6: トークンは一度発行したら維持。盤面変更・休日設定・限数変更・集団コマ・オプション文言は既発行 QR にも
    後追い反映される旨を明記。→ 正本B。
  - B7: 講習データの Excel 往復（4シート・ID優先照合）が可能。授業時間・集団参加・オプションは Excel 非対応
    （QR/日程表のみ）という非対称を明記。→ 正本 Excel 節（新設）。
  - B8: 提出ページのスマホ最適化（iOS/Android 別ビューポート補正）と `#/submit-debug`（実機表示調整用ダミー画面）
    の存在を明記。→ 正本C。
  - B9: 登録解除（リセット）でクリアするのは提出内容6フィールド（unavailableSlots/subjectSlots/subjectDurations/
    groupClassParticipation/optionChecks/regularOnly）と提出時刻のみ。配布情報（本人名・期間・盤面配置・休日・限数・
    集団科目選択肢・オプション文言）は維持する旨を明記。→ 正本E。

- **B4（recentlyReset 無効ガード）**: 今回のコード修正対象外。記録のみで、必要なら別途 Issue 化する（触らない）。
