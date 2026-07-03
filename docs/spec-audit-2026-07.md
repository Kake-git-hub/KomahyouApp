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
| 2 | 保存・バックアップ・復元 | `spec-save-restore.md` | 未着手 |
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
