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
| 2 | 保存・バックアップ・復元 | `spec-save-restore.md` | 監査済（所見12件：A3/B6/C3・2026-07-04） |
| 3 | コマ表の基本配置（テンプレ方式） | `spec-board-regular-placement.md` | 未着手 |
| 4 | 振替ストック | `spec-makeup-stock.md` | 未着手 |
| 5 | 講習・講習ストック | `spec-lecture-stock.md` | 未着手 |
| 6 | 基本データ画面 | `spec-basic-data.md` | 未着手 |
| 7 | 特別講習データ・提出ページ | `spec-special-session-submission.md` | 未着手 |
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
- 補足（所見外の記録）: Cloud Function `downloadLatestClassroomRollback`（`functions/src/index.ts:1835`）はクライアント（src/）からの参照が 0 件のデッドコード。正本§4「rollback UI は削除（Undo で代替）」どおり UI 撤去済みだが、サーバー側の関数本体が残存。掃除は別途検討（本監査では差分扱いしない）。
