# 計画: 複数会社展開に向けた構成見直し（2026-09-15 起案・第1版・計画のみ）

> **作成**: 2026-09-15（主セッション＝計画審査役、Fable 5.1）。**前提版**: v1.5.528（ライブ）／ローカル main は v1.5.529 ラベル済み・未 push。
> **第2版（2026-09-16）**: §6 の問題点をオーナーと質疑で詰め、結果を §10 に記録（§9 の回答済み項目も反映）。
> **同日追記**: §9-1（方式 B・フォークは 2 社目の要望を見てから）と §9-9（Phase 0→1 を今から着手）が確定。**次の作業は Phase 0 の T0-1（`docs/spec-multi-tenant.md` 起案）から。**
> **性質**: 計画（実装なし）。オーナーの判断点は §9 の回答欄。仕様が確定したら `docs/spec-multi-tenant.md`（新設）へ移し、
> ここからは参照に置き換える。**役割分担**（CLAUDE.md モデル割当）: 計画審査＝主セッション／仕様確定＝spec-curator（Opus）／
> 実装・原因特定＝dev-fix（Opus）／機械的作業＝Sonnet／INV 監査＝regression-reviewer（Opus）。

---

## 0. 結論（先に要点）

**オーナーの条件**: ①会社ごとにリポジトリを分ける（会社ごとの機能・見た目の差を各々で管理）②基本機能は共通化する
③データベースは分けない（手間をかけない・全社一括請求のメリット）④現行アプリの問題点を定義する。

**推奨構成（一言）**: **「1 Firebase プロジェクト ＝ 会社ごとに `workspaces/{会社キー}` ／ フロントは会社ごとにフォーク（上流＝本リポ）／
バックエンド（functions・rules・indexes）は本リポからだけデプロイ」**。

| 論点 | 推奨 | 理由（要約） |
|---|---|---|
| DB を分けるか | **分けない**（1 プロジェクト・会社＝workspace） | データ構造は最初から `workspaces/{workspaceKey}` が親で、rules・callable・定期関数（バックアップ／在籍数台帳／掃除）が **すべて workspace 単位で書かれ、全 workspace を巡回する**（§1）。会社を増やす＝workspace 文書を増やすだけで、コードの新設はほぼ不要。請求も `studentCountLedger` が全 workspace に記録される。 |
| リポジトリ | **B: 上流フォーク方式**（本リポ＝コア upstream、会社リポ＝フォーク） | オーナー要望（会社別リポ）と「共通は一箇所」を両立する最小手間の形。コアの npm パッケージ化（C 案）は 2.7 万行の巨大ファイル分割が前提で今は割に合わない（§3）。 |
| 「共通」の定義 | **データ形・Firestore パス・functions・rules・保存/復元・INV 台帳で守る盤面ロジック・請求台帳 ＝ 共通（コア）**。ブランド・文言・機能の既定 ON/OFF・帳票差・追加画面 ＝ 会社固有 | 判定フロー §2。迷ったら「他社の教室データを読める/書ける経路か」「INV に載る保証を触るか」で決める。 |
| 会社固有の置き場 | フォーク内の **`src/company/` 1 フォルダ**（プロファイル＋拡張点）に閉じ込め、コア本体ファイルは直接編集しない | フォークがコア本体を書き換えるほど上流同期の衝突と回帰が増える。会社レイヤはコア側に「差し込み口」を先に作る（Phase 1）。 |
| 一括請求 | 会社＝workspace ごとに合算請求 ＋ 全社一覧を 1 画面（開発者が所属する全 workspace を列挙） | 現行の請求は workspace 内の教室行のみ（§5）。横断列挙の手段（callable 1 本）を足す。 |

**着手順**（詳細 §7）: **Phase 0（境界の監査・分割前）→ Phase 1（会社レイヤをコアに導入・現行会社を最初のプロファイルとして抽出）→
Phase 2（フォーク運用の型を staging で予行）→ Phase 3（2 社目の受け入れ手順・横断請求）→ Phase 4（将来: コアのパッケージ化）**。
2 社目が現れるまでは Phase 0〜2 をコアリポ内だけで進められる（フォークはまだ作らない）。

**懸案（正直に）**: 会社別リポは「コアの修正 1 件を N リポへ同期する」運用コストが恒常的に乗る。会社数が 2〜3 で、差分が
ブランド・文言・ON/OFF に収まるなら、A 案「単一リポ＋会社プロファイル（ビルド時切替）」の方が総手間は小さい（§3）。
オーナーの要望を尊重して B 案を推奨するが、**Phase 1 を終えた時点で A のままでも会社差は表現できる**ので、フォークを切るかは
2 社目の要望の大きさを見てから決めてよい（§9-1）。

---

## 1. 現状の事実（調査結果・根拠つき）

| # | 項目 | 現状 | 根拠 |
|---|---|---|---|
| 1 | テナント境界 | 最上位は `workspaces/{workspaceKey}`。教室メタ・スナップショット・設定・請求月・在籍台帳・開発者報告がすべてこの配下 | `firebase/firestore.rules:49-145`、`docs/firebase-backend.md` |
| 2 | 現在の workspace | `main` の 1 つだけ。`VITE_FIREBASE_WORKSPACE_KEY=main` を**ビルド時に焼き込む** | `.env.local`、`src/integrations/firebase/config.ts:21-49` |
| 3 | 権限 | `members/{uid}` に `role: developer|manager` と `assignedClassroomId`（1 人 1 教室）。developer は **workspace 内の全教室**にアクセス可。会社をまたぐ権限は workspace で切れる | `firestore.rules:25-47`、`functions/src/index.ts:1233-1266` |
| 4 | callable の検証 | 全 callable は引数 `workspaceKey` を受け、`members` を引いて所属を検証（`requireDeveloperMember` / `requireClassroomAccessMember`） | `functions/src/index.ts:1233-1266` |
| 5 | 定期関数 | 15 分毎バックアップ・在籍数台帳（毎月 15 日）・保持期間の掃除は **`workspaces` 全件を巡回** | `functions/src/index.ts:2335, 2493, 2551` |
| 6 | バックアップ置き場 | `workspace-auto-backups/{workspaceKey}/...`（workspace 別） | CLAUDE.md、`functions/src/index.ts:658` |
| 7 | 公開系トップレベル | `lectureSubmissions`（QR 提出）は `workspaceKey` フィールドを持つ。`boardShares`（講師日程共有）は **`classroomId` のみ**。`studentPortalTokens` は CF 専用 | `src/integrations/firebase/lectureSubmission.ts:90,127`、`boardShare.ts:195-215`、`firestore.rules:148-169` |
| 8 | 「会社」概念 | コード・データに `company / organization / tenant` は **存在しない** | grep 0 件 |
| 9 | 教室のハードコード | 実行コードには本番教室 ID・名は無い（テスト・コメント・tools の既定引数・CLAUDE.md のみ） | 調査 §2 |
| 10 | 開発用教室判定 | 単一 ID 定数 `DEVELOPMENT_CLASSROOM_ID` ＋ サンドボックス ID 配列 ＋ **教室名「開発用教室」の文字一致**。クライアントとサーバーで**二重実装（手動同期）** | `src/utils/developmentClassroom.ts:12-30`、`functions/src/developmentClassroomIdentity.ts:7-27`、`functions/src/index.ts:105` |
| 11 | 機能フラグ | `featureRolloutRegistry` の scope は `development-only / all-classrooms / staging-environment` の 3 値。**会社軸は無い**。教室別上書き（O-1 `featureOverrides`）は保留中 | `src/utils/featureRollout.ts:15-135`、`docs/plan-2026-09-11-five-requests.md §4` |
| 12 | サーバー側フラグ | 保護者 QR・AI 回答はサーバーにも同じ述語（両側同時に変える運用） | `functions/src/parentPortal.ts`、`questionAiAnswer.ts` |
| 13 | ブランディング | 校舎名・TEL・ロゴは教室データ（`ClassroomSettings.scheduleHeader`）。「スクールIE」はコードに無い。**「室長」は UI 全域の共通語** | `src/types/appState.ts:15-27`、`scheduleHtml.ts:6081-6098` |
| 14 | 請求 | `workspaces/{ws}/billingMonths/{月}/classrooms/{教室}` に教室単位の請求行。許可者は **メール 3 件をコードと rules の 2 箇所にハードコード**。会社合算は無い | `src/utils/billing.ts:3`、`firestore.rules:29-39`、`billingStore.ts:33-37` |
| 15 | Hosting | 1 プロジェクト＝1 サイト（`.firebaserc` に multi-site 無し）。`/api/submission/**`・`/api/parent/**` は関数へ rewrite | `firebase.json`、`.firebaserc` |
| 16 | CI | main push → patch 自動 bump → build → `deploy --only hosting` → ライブ検証 → **bump を main へコミットバック**。functions は別ワークフロー（`--force` でソースに無い関数を削除）。rules は手動 | `.github/workflows/deploy-firebase-hosting.yml:48-129`、`deploy-functions.yml:87-101` |
| 17 | 外形監視 | `uptime-check.yml` が本番 1 URL を確認 | `tools/uptime-check.mjs` |
| 18 | コードの粒度 | `ScheduleBoardScreen.tsx` 12,963 行／`scheduleHtml.ts` 8,010 行／`App.tsx` 5,663 行／`functions/src/index.ts` 3,238 行。UI・ロジック・印刷・文言が未分離 | wc |
| 19 | 原価 | 2 教室で約 ¥300/月 → 30 教室で約 ¥7,000/月。支配要因は教室数（書込回数・関数時間）で会社数ではない | memory `komahyou-firebase-cost-scaling` |

---

## 2. 「共通（コア）」と「会社固有」の線引き（提案）

### 2-1. 判定基準（この順に問う）

1. **他社の教室データを読める／書ける経路に触るか**（Firestore パス・rules・callable・定期関数・バックアップ／復元・トークン発行）→ **コア**。フォークでは触らない。
2. **保存データの形（`AppSnapshotPayload`・`schemaVersion`）を変えるか** → **コア**。理由: 同じ DB を複数のフロント版が読み書きするので、形の変更はコアが一元管理し後方互換を保証する（今の staging↔本番の版ズレ運用と同じ）。
3. **INV 台帳（`docs/spec-invariants.md`）に載る保証（盤面⇄日程表の一致、在庫の保存など）を触るか** → **コア**。マトリクステストもコアで動かす。
4. **請求の根拠（在籍数台帳・請求月）に触るか** → **コア**。
5. 上のどれにも当たらず、**見え方・言葉・入口の有無・帳票の体裁・追加画面**なら → **会社固有**。

### 2-2. 層構造

| 層 | 内容 | 置き場 | 変更者 |
|---|---|---|---|
| **L0 バックエンド** | functions / firestore.rules / storage.rules / indexes / Hosting rewrites の関数指定 | コアリポのみ。**フォークには複製しない**（§3-3） | コア |
| **L1 ドメイン** | 型・保存/復元・盤面/在庫/日程表の純関数・自動割振・請求計算・機能フラグ基盤 | コアリポ `src/utils`, `src/data`, `src/types`, `src/integrations` | コア |
| **L2 画面の骨格** | App／盤面／基本データ／日程表 HTML 生成などの React・HTML。会社レイヤを **参照する側** | コアリポ `src/components`, `src/App.tsx`, `scheduleHtml.ts` | コア（フォークは直接編集しない） |
| **L3 会社レイヤ** | ブランド（名称・ロゴ既定・色）・呼称辞書（「室長」→任意）・機能の既定 ON/OFF・帳票の文言／体裁差・追加ボタン／追加画面・`workspaceKey`・Hosting サイト名 | `src/company/`（コアには「スクールIE 用」＝現行値のプロファイルを置く。フォークはこのフォルダを差し替える） | 会社 |

### 2-3. 会社固有の代表例（現時点で分かっているもの）

| 会社固有にできるもの | 実現方法 |
|---|---|
| 機能の入口の有無（要望・報告／講師日程共有／空フォーマット／丸ごと振替／PDF／集団 2 行 …） | 既存の `featureRolloutRegistry` に **会社既定値**を足す（§6-4）。O-1 の教室別 `featureOverrides` はその上に重ねる |
| 呼称（室長・講習・振替・コマ など） | 会社レイヤの文言辞書。まず「室長」など**役割名 2〜3 語**だけ対象にし、全域置換はしない（回帰リスク） |
| ロゴ・校舎名・TEL の既定 | 教室データ（`scheduleHeader`）は現状維持。会社レイヤは**未設定時の既定**とアプリ名・ファビコン |
| 帳票の追加行・注記 | `scheduleHtml.ts` の生成関数に**フック（extension point）**を開け、会社レイヤの関数を差し込む |
| 追加画面（会社独自の帳票・集計） | 会社レイヤに画面を置き、コアの画面遷移に「追加メニュー」フックで登録 |

---

## 3. リポジトリ構成の 3 案

| 案 | 形 | 手間（初期／恒常） | 分離度 | 欠点 |
|---|---|---|---|---|
| **A** 単一リポ＋会社プロファイル | 本リポに `src/company/<会社>/` を並べ、ビルド時 `VITE_COMPANY=<会社>` で切替。Hosting は multi-site | 小／小 | 低（他社の差分も同じリポに見える） | オーナー要望（会社別リポ）と違う。会社が増えると 1 リポに全社の差分が溜まる |
| **B** 上流フォーク（**推奨**） | 本リポ＝コア（upstream）。会社リポ＝GitHub フォーク。差分は `src/company/` に閉じ、コア更新は `git merge upstream/main` で取り込む | 中／中（同期作業が N 回） | 中〜高（リポ・CI・Issue が会社別） | フォークがコア本体を編集し始めると衝突と回帰が増える。CI の自動 bump が同期のたびに衝突（対策 §3-3） |
| **C** コアのパッケージ化 | monorepo `packages/core` を npm パッケージ化し、会社アプリが依存。会社リポは薄いシェル | 大／小 | 高 | `ScheduleBoardScreen.tsx` 1.3 万行などの分割が前提。回帰リスクが最大。今は非推奨（Phase 4 の将来オプション） |

### 3-1. B 案の要点（フォークで守るルール）

- **フォークが変更してよいのは `src/company/` と会社用ドキュメント（README・CHANGELOG-company・CLAUDE.md の会社版）だけ。** コア本体を直したくなったら upstream（本リポ）へ PR を出して取り込み、フォークは同期で受け取る。
- **上流同期は「コアのリリースごと」または週 1**。`git fetch upstream && git merge upstream/main` → CI 緑 → フォークの Hosting へ。同期手順はスキル `upstream-sync`（新設）に固定し Sonnet で実行可能にする。
- コアのテスト（ユニット・マトリクス・`inv-guard`）は**フォークでもそのまま走る**。会社レイヤのテストは会社リポに置く。

### 3-2. A 案との使い分け（妥協案）

Phase 1 で会社レイヤをコアに作れば、**A でも B でも同じプロファイル形式**を使える。2 社目が「ブランド・文言・ON/OFF」の範囲なら A（プロファイルを 1 つ足すだけ）で始め、
独自画面や帳票改造など**差分が大きくなった会社だけフォーク（B）へ昇格**する、という段階運用ができる。フォークを最初から作る必要はない。

### 3-3. B 案で先に潰す衝突源

| 衝突源 | 対策（コア側で先に実施） |
|---|---|
| CI が `package.json` を bump して main へコミットバック（フォークの同期のたびに `package.json` が衝突） | コアの版は今のまま。**フォークの CI は bump しない**（`version.json` を build 時に「コア版＋フォークのコミット SHA／run 番号」で生成）。会社版は `src/company/profile.ts` の `companyVersion` で管理 |
| `CHANGELOG.md` の同一行への追記 | フォークは `CHANGELOG-company.md` を別ファイルで持つ（コアの CHANGELOG は同期で受け取るだけ） |
| `firebase.json` / `.firebaserc` の差 | コアの `firebase.json` を **hosting target 方式**にし、フォークは `.firebaserc` の target 名だけ差し替える。functions/rules のセクションはフォークの `firebase.json` から**削除**（誤デプロイ防止） |
| `.github/workflows/deploy-functions.yml` など | フォークでは**ワークフローごと削除**。フォークの CI シークレットは **Hosting 専用のサービスアカウント**（`roles/firebasehosting.admin` のみ）にし、functions/rules を出せない権限にする |
| `CLAUDE.md` の本番教室一覧・memory の他社情報 | フォークには**会社版 CLAUDE.md**（当該 workspace の教室だけ）を置く。他社の教室 ID・名前は書かない |

---

## 4. データベース: 分けない（推奨）とその条件

### 4-1. 分けない場合の設計

- **会社 ＝ `workspaces/{会社キー}`**。既存 3 教室は `main` のまま（改名移行はしない。§9-2）。**既存の運営会社名は「スクールIE」ではなく別にある**（オーナー回答 2026-09-16）ので、会社名・請求先は棟の文書 `workspaces/{キー}` のフィールドに持ち、コード・文書で「スクールIE 社」と呼ばない。
- 会社の属性（会社名・請求先・ブランド既定・契約状態）は `workspaces/{会社キー}` 文書のフィールドに持つ（新規フィールドの追加のみ・既存構造は不変）。
- 会社ごとのフロントは **`VITE_FIREBASE_WORKSPACE_KEY=<会社キー>` を焼き込んだビルド**を **会社ごとの Hosting サイト**（同一プロジェクトの multi-site、例 `komahyou-<会社>.web.app` かカスタムドメイン）へ配信。`/api/**` の rewrite は同じ関数を指す。
- Auth は共通プール。会社 A のサイトに会社 B の室長がログインしても `members` が無いので **rules と callable の両方で拒否**（Phase 0 でテスト固定）。
- 開発者（オーナー）は各 workspace に `role: developer` の member を持つ。他社の開発担当を入れる場合は当該 workspace にだけ member を作る（= 会社間の壁は workspace で切れる）。

### 4-2. 分けない場合のリスクと手当

| リスク | 手当 |
|---|---|
| 事故の影響範囲（2026-06-06 の復元取り違えのような越境汚染） | `workspaceKey` はビルド固定で UI から選べない（現状維持）。復元／コピー系 callable に「対象 classroomId が当該 workspace に属するか」の検査を追加（Phase 0）。本番データ保護ルールを「全 workspace の本番教室」に拡張して明文化 |
| developer は workspace 内全教室を見られる | 会社ごとの workspace で切れる。オーナー以外の developer を入れるときは workspace 単位で付与 |
| 定期関数の容量（15 分毎バックアップ 300 秒／1GiB は 30 教室で不足見込み） | 会社数でなく総教室数の問題。教室 15 を超える前に workspace ごとの分割実行へ（既存課題・memory 参照） |
| Firestore／Functions の quota・費用が共有 | 支配要因は教室数（¥240/教室/月 目安）。会社別の原価は教室数按分で出せる（請求根拠にもなる） |
| 個人情報（生徒・保護者）を他社ぶんも自社プロジェクトで預かる | 利用規約・業務委託／秘密保持の契約、**退会時のデータ書き出し＋削除手順**（オフボーディングツール・Phase 3）。バックアップの保持期間（400 日）も契約に明記 |
| 同一メールは 1 アカウント（会社をまたぐ人） | `members` が workspace ごとにあるので同じ UID を両方に登録できる。UI は「サイトごとに 1 会社」なので混乱しない |
| rules の 1 ファイル化（会社が増えても rules は変わらない） | 変わらないことが利点。会社固有の rules を作らないのが原則 |

### 4-3. 分ける場合（比較・不採用）

会社ごとに Firebase プロジェクトを立てると、functions・rules・indexes・Storage・Scheduler・監視・staging を **N 回**デプロイ／設定する必要がある。一括請求は各プロジェクトの台帳を突合する別ツールが要る。
利点は「事故と quota の完全分離」「無料枠が会社ごと」。**規約上プロジェクト分離を要求する大口が出た場合だけ**、例外として別プロジェクトにする（コアは env でプロジェクトを切り替えられることを staging で実証済み）。§9-8。

---

## 5. 一括請求の設計（分けない前提）

| 現状 | 変更案 |
|---|---|
| 請求行は workspace 内の教室単位（`billingMonths/{月}/classrooms/{教室}`）。請求書は教室（室長メール）宛 | **会社（workspace）宛の合算請求書**を追加（教室行の合計＋明細）。教室宛は残す（会社の希望で選べる） |
| 開発者画面・請求画面は「自分のビルドの workspace」だけを見る | 開発者向けに **全社一覧**（自分が developer である全 workspace を列挙し、月ごとの教室数・在籍数・金額を並べ、一括で下書き作成）。列挙は callable `listBillingWorkspaces`（`members` を引いて developer の workspace だけ返す）で行う（`workspaces` の list を rules で開けない） |
| 許可者はメール 3 件をコードと rules に二重ハードコード | `workspaces/{会社キー}/members/{uid}.role` に `'billing'` 相当のフラグ（例 `canBill: true`）を持たせ、rules・クライアント・callable が同じ場所を見る。**移行は既存 3 メールを member に立ててから切替**（片方だけ変えると動かない罠・memory `komahyou-billing-developer-account`） |
| 在籍数台帳は全 workspace に記録済み | 変更なし（そのまま会社横断の根拠になる） |

---

## 6. 現行アプリで問題になる点（定義）

「別会社を同じ DB・別リポで受け入れる」前提で、**今のままだと問題になる**点。番号は Phase（§7）に対応。

| # | 問題 | 根拠 | 影響 | 対処（Phase） |
|---|---|---|---|---|
| 6-1 | **会社概念が無く `workspaceKey` が `main` 固定の前提で運用されている**（ドキュメント・tools・memory も `main` 前提） | `.env.local`、`tools/*.mjs` | 2 社目の workspace を作っても、運用手順・ツールが `main` を暗黙に指す | Phase 0: 全ツールの `--workspace` 必須化、Phase 3: 会社作成ツール |
| 6-2 | **開発用教室の判定に「教室名に『開発用教室』を含む」文字一致がある** | `src/utils/developmentClassroom.ts:19-30` | 他社が「開発用教室」という名前の教室を作ると、開発用限定機能・保存経路（`saveDevelopmentClassroomSnapshot`）・AI 回答が誤発火 | Phase 0: 名前判定を廃止し **ID ＋ workspace** で固定（クライアント／サーバー同時） |
| 6-3 | **開発用教室・機能フラグの述語がクライアントとサーバーで二重実装** | `developmentClassroom.ts` ⇄ `functions/src/developmentClassroomIdentity.ts`、`featureRollout.ts` ⇄ `parentPortal.ts` | 会社軸を足すとズレる箇所が倍になる | Phase 0: 述語を 1 モジュールに寄せ、パリティテスト（保護者 QR で使った手法）で固定 |
| 6-4 | **機能フラグに会社軸が無い**（scope は環境・教室種別のみ）。教室別上書き O-1 は保留 | `featureRollout.ts:15` | 「会社 B は丸ごと振替なし」のような既定を表現できない | Phase 1: 判定を **scope → 会社既定（会社レイヤ）→ 教室上書き（O-1）** の 3 段に。O-1 をここで再開 |
| 6-5 | **請求許可がメール 3 件のハードコード×2 箇所**、会社合算なし、横断列挙の手段なし | `billing.ts:3`、`rules:29-39` | 会社が増えるたびにコード＋rules 変更。全社一括の画面が作れない | Phase 3（§5） |
| 6-6 | **CI の自動 bump コミットバック**がフォーク同期と毎回衝突 | `deploy-firebase-hosting.yml:118-129` | 上流同期のたびに `package.json`／`CHANGELOG.md` で手作業 | Phase 2（§3-3） |
| 6-7 | **functions／rules の deploy ワークフローとフルアクセスのサービスアカウントがリポに紐づく** | `deploy-functions.yml`（`--force`）、`RE_FIREBASE_SERVICE_ACCOUNT` | フォークが同じワークフローを持つと、フォーク側の誤操作で本番の関数削除・rules 上書きが起きうる | Phase 2: フォークからワークフロー削除＋Hosting 専用 SA |
| 6-8 | **Hosting 単一サイト前提**（`.firebaserc`・`verify-firebase-hosting.mjs`・`uptime-check.yml` が 1 URL） | `firebase.json`、`tools/uptime-check.mjs` | 会社ごとの URL を持てない。監視・ライブ検証も 1 サイトのみ | Phase 2: multi-site 化（target 方式）、監視 URL を一覧化 |
| 6-9 | **`boardShares`（講師日程共有）が `classroomId` のみで `workspaceKey` を持たない** | `src/integrations/firebase/boardShare.ts:195-215` | 越境の実害は無い（classroomId は Firestore 自動 ID で一意）が、教室 ID を手入力で作ると衝突しうる（`test_classroom_20260507_dai` の例）。監査・削除で会社が分からない | Phase 0: `workspaceKey` を書き足す（読みは無改変）。教室 ID は自動 ID 以外禁止を明文化 |
| 6-10 | **巨大ファイルに文言・ブランド・帳票が未分離** | `ScheduleBoardScreen.tsx` 1.3 万行、`scheduleHtml.ts` 8 千行 | フォークが見た目を変えるとコア本体を編集することになり、同期衝突と回帰の温床 | Phase 1: **ファイル分割はしない**。参照箇所だけを会社レイヤ経由に置換（文言辞書・フック） |
| 6-11 | **「室長」などの呼称が UI 全域で固定** | `App.tsx:153,220` ほか多数 | 他社が別の呼称を使う場合、全域置換は回帰リスク大 | Phase 1: 役割名 2〜3 語だけ辞書化。全域は要望が出たときに段階的に |
| 6-12 | **CLAUDE.md・memory に本番教室 ID／名前**、tools の既定引数が日大前 | `CLAUDE.md:70-76`、`tools/copy-prod-classroom-to-staging.mjs:7` | フォークへコピーすると他社に情報が渡る | Phase 2: 会社版 CLAUDE.md テンプレ、tools の既定値廃止 |
| 6-13 | **バックアップ関数の容量**（300 秒／1GiB）と開発者の起動時全教室読込 | memory `komahyou-firebase-cost-scaling` | 会社数でなく総教室数で詰まる（15 教室前後が目安） | 既存課題。教室 10 を超える前に着手（本計画の外） |
| 6-14 | **rules テストに workspace 越境ケースが無い** | `vitest.rules.config.ts` | 「会社 A の室長が会社 B の教室を読めない」保証が自動化されていない | Phase 0: `npm run test:rules` に越境ケース追加 |
| 6-15 | **新 workspace の初期化手段が無い**（callable は既存 member を要求するので、最初の developer member は Admin 経由で作るしかない） | `functions/src/index.ts:1233`、`adminFunctions.ts:194-210` | 2 社目の受け入れが手作業（REST＋gcloud）になる | Phase 3: `tools/provision-workspace.mjs`（新 workspace キー以外へ書かないガード付き） |

---

## 7. 段階計画

> 各 Phase は **1 テーマ＝1 ブランチ**、変更にはテスト同コミット、UX 系は INV 完了定義 4 点、main マージ前に regression-reviewer。
> Firestore 書込の検証は開発用教室（`v8OZ7zH8vONNHjjYVcR1`）のみ。新 workspace の検証は **staging プロジェクト**で行う。

### Phase 0: テナント境界の監査と固定（コアリポ内・分割前・2 社目が無くても価値がある）

| ID | 内容 | 担当 | テスト | 目安 |
|---|---|---|---|---|
| T0-1 | `docs/spec-multi-tenant.md` 新設: 会社＝workspace の定義、会社固有／コアの判定基準（§2）、本番データ保護ルールの全 workspace 適用、教室 ID は自動 ID のみ | spec-curator（Opus） | — | 0.5 |
| T0-2 | 開発用教室判定の是正: **会社ごとに 1 教室を `{workspaceKey, classroomId}` の組で登録**して判定（名前一致には頼らない・オーナー確定 2026-09-16。既存 main の名前一致は移行期間だけ残し、ID 登録が済んだら外す）。クライアント／サーバーを 1 つの述語モジュールに寄せ、パリティテストで固定（6-2, 6-3） | dev-fix（Opus） | `developmentClassroom.test.ts` ＋ functions 側パリティ | 1 |
| T0-3 | 越境ガード: 復元／コピー／保存／トークン発行 callable に「classroomId が当該 workspace に存在する」検査を追加。`boardShares` に `workspaceKey` を書き足す（6-9） | dev-fix（Opus） | callable 入力検証テスト、`npm run test:rules` に越境ケース（6-14） | 1 |
| T0-4 | tools の `--workspace` 必須化、`copy-prod-classroom-to-staging` の既定教室廃止（6-1, 6-12） | Sonnet | `tools/*.test.mjs` | 0.3 |

### Phase 1: 会社レイヤの導入（コアリポ内・現行会社を最初のプロファイルとして抽出）

| ID | 内容 | 担当 | テスト | 目安 |
|---|---|---|---|---|
| T1-1 | `src/company/profile.ts`（型 `CompanyProfile`: `companyKey`（= workspaceKey）、表示名、アプリ名、ロゴ既定、呼称辞書、`featureDefaults`、`companyVersion`）と vite alias `@company`。現行値＝スクールIE プロファイル | dev-fix（Opus） | プロファイルの型・既定値テスト | 0.5 |
| T1-2 | 機能フラグ 2 段化（オーナー確定 2026-09-16）: `isFeatureEnabledForClassroom(key, classroom)` を **scope → 会社既定（会社レイヤ `featureDefaults`）** に。教室上書き（O-1）は保留のまま、将来 3 段目として差し込める形にしておく（6-4）。サーバー側述語も同じ順序 | dev-fix（Opus） | `featureRollout.test.ts` 拡張、CF 側パリティ | 1 |
| T1-3 | 文言辞書の第 1 段: 役割名（室長・開発者）だけ辞書経由に。全域置換はしない（6-11） | Sonnet（対象一覧は Opus が確定） | スナップショット差分 0 のテスト（既定辞書で出力不変） | 0.5 |
| T1-4 | 帳票フック: `scheduleHtml.ts` の生徒／講師日程・空フォーマットに「追加注記」「ヘッダ差替」の差し込み口を 2〜3 個。既定は空（出力不変） | dev-fix（Opus） | `scheduleHtml.test.ts` 構文検証＋出力不変 | 1 |
| T1-5 | 画面フック: ツールバー追加ボタン・追加メニューの登録口（既定は空） | dev-fix（Opus） | 既定で DOM 不変 | 0.5 |

> Phase 1 完了時点で **A 案（単一リポ）でも会社差を表現できる**。ここで一度立ち止まり、2 社目の要望の大きさを見てフォークを切るか決める（§9-1）。

### Phase 2: フォーク運用の型（staging で予行・2 社目が決まる前に済ませる）

| ID | 内容 | 担当 | テスト／確認 | 目安 |
|---|---|---|---|---|
| T2-1 | Hosting multi-site 化: `firebase.json` を target 方式に、`.firebaserc` に会社サイトを追加。`verify-firebase-hosting.mjs`／`uptime-check` を複数 URL 対応（6-8） | dev-fix（Opus） | staging に第 2 サイトを作り、別 workspace のビルドを配信して確認 | 1 |
| T2-2 | CI の分離: コアはそのまま。**フォーク用ワークフロー雛形**（bump なし・`--only hosting:<target>`・functions/rules 無し・Hosting 専用 SA）を `docs/runbooks/company-fork-setup.md` とともに用意（6-6, 6-7） | dev-fix（Opus）→ Sonnet | 雛形をコアの staging で dry-run | 1 |
| T2-3 | スキル `upstream-sync`（フォークでの上流取り込み手順: fetch → merge → 衝突は `src/company/` 以外を upstream 優先 → CI 緑 → 配信）と会社版 CLAUDE.md テンプレ（6-12） | Sonnet | 手順の dry-run | 0.5 |
| T2-4 | GitHub の **テンプレートリポジトリ**設定（またはフォーク手順）と、フォークが触ってよいパスの CI ガード（`src/company/` 以外の差分があれば警告） | Sonnet | — | 0.3 |

### Phase 3: 2 社目の受け入れ（会社が決まってから）

| ID | 内容 | 担当 | テスト／確認 | 目安 |
|---|---|---|---|---|
| T3-1 | `tools/provision-workspace.mjs`: 新 workspace 文書＋オーナーの developer member を作る（**指定した新キー以外へ書けないガード**・既存キー指定は拒否）。まず staging で実行（6-15） | dev-fix（Opus） | ガードのユニット、staging 実行 | 0.5 |
| T3-2 | 会社の開発用教室: 会社ごとに 1 教室を「開発用」として ID 登録（T0-2 の述語に追加）。または「開発用教室はコア（main）のみ」と決める（§9-6） | Sonnet | 述語テスト | 0.2 |
| T3-3 | 横断請求（§5）: 会社合算請求書（教室宛も会社ごとに選択可）、既存運営会社の請求画面に「全社」タブ、`listBillingWorkspaces`、許可者の member 化、**会社の標準単価（棟の文書）→ 教室 `studentUnitPrice` で上書き**（6-5） | dev-fix（Opus） | `billing.test.ts`、CF 検証、`test:rules` | 1.5 |
| T3-4 | オフボーディング: workspace 単位の書き出し（既存バックアップ形式）と削除手順（runbook。削除は二重確認・本番データ保護ルール） | spec-curator → dev-fix | 書き出しのユニット、削除は staging でのみ実行 | 1 |
| T3-5 | 会社リポの作成（フォーク or テンプレ）→ `src/company/` 差替 → Hosting サイト作成 → CI シークレット（Hosting 専用 SA）→ 初回配信 → 外形監視に URL 追加 | Sonnet（runbook どおり） | ライブ検証 | 0.5 |

### Phase 4（将来オプション・今はやらない）

コアの npm パッケージ化（C 案）。条件: フォークが 3 社以上で、`src/company/` だけでは足りずコア本体の差分が恒常化した場合。着手前に `ScheduleBoardScreen.tsx`／`scheduleHtml.ts` の分割計画を別途立てる。

---

## 8. 運用ルール（フォーク後の日常）

1. **変更の置き場判定**（§2-1）を PR テンプレに追加: 「この変更は他社データ経路／データ形／INV／請求に触るか」→ 触るならコアへ。
2. **リリース順**: コア main → 本番（スクールIE 各教室）→ 各会社リポで upstream 同期 → CI → 各サイト。コアの `CHANGELOG.md` に「会社側の対応要否」を 1 語で添える（例 `[要同期]`）。
3. **staging の使い方**: コアの staging に会社サイトを増やして予行（本番プロジェクトの multi-site と同じ構成にする）。版合わせのルール（新機能で staging を使う直前に最新反映）は会社サイトにも適用。
4. **本番データ保護**: 「書き込み可能な教室は各 workspace の開発用教室のみ」を全 workspace に適用。他社 workspace の教室は**読み取りも必要最小限**（調査時は当該会社の同意範囲内）。
5. **Issue**: 会社固有の要望は会社リポの Issues、コアに影響する不具合はコアの Issues へ転記（`source:company-<会社>` ラベル）。

---

## 9. オーナー回答欄（判断点・推奨を先頭に）

### 9-1. リポジトリ方式
- [x] **B: 上流フォーク**（推奨）／ A: 単一リポ＋会社プロファイル／ C: コアのパッケージ化: **B（2026-09-16）**
- [x] Phase 1 完了時点で「フォークを切るかは 2 社目の要望を見て決める」段階運用でよいか: **はい（2026-09-16）**

### 9-2. 既存 3 教室の扱い
- [x] `workspaces/main` をそのまま既存運営会社の workspace とし、改名移行はしない: **はい（会社名は棟の文書に持つ・2026-09-16）**

### 9-3. 会社ごとの URL
- [x] 同一プロジェクトの multi-site（`komahyou-<会社>.web.app`）で始め、必要な会社だけカスタムドメイン: **はい（2026-09-16）**

### 9-4. 一括請求の形
- [x] 会社（workspace）宛の**合算請求書**を追加し、教室宛は会社の希望で選べる: **はい。既存運営会社にも適用（2026-09-16）**
- [x] 請求許可者をメールのハードコードから member のフラグへ移す: **はい（2026-09-16）**

### 9-5. 呼称
- [x] 「室長」など役割名を会社ごとに変えられるようにするか: **役割名 2〜3 語だけ（2026-09-16）**

### 9-6. 開発用教室
- [x] 会社ごとに開発用教室を持つ: **持つ（各社 1 教室・ID 登録で固定・2026-09-16）**

### 9-7. 他社の開発担当者
- [x] 他社側の開発担当を developer として入れる想定はあるか: **無し。会社リポもオーナー管理の私有リポで他社に見せない（2026-09-16）**

### 9-8. 別プロジェクト分離の例外
- [ ] 規約上プロジェクト分離を要求する会社が出た場合だけ、例外として別プロジェクト（コアの env 切替で対応）: ______（未回答・該当会社が出たときに判断）

### 9-9. 着手順
- [x] Phase 0 → 1 の順にコアリポ内で先に進める（2 社目未確定でも着手）: **はい。Phase 2 以降は 2 社目が具体化してから（2026-09-16）**
- [x] O-1（教室別オプション基盤・保留中）を Phase 1 の T1-2 として再開してよいか: **再開しない。機能スイッチは当面 2 段（基本→会社既定）。教室単位の要望が増えたら 3 段へ（2026-09-16）**

---

## 10. 問題点の詰め（2026-09-16 オーナー質疑の記録）

§6 の 15 件を 5 グループに分け、たとえ話つきで質疑した結果。**ここが §6 各項目の確定値**（§7 の該当タスクに反映済み）。

### 10-1. 会社の壁（6-1, 6-2, 6-3, 6-9, 6-14, 6-15）

| 論点 | 確定 | 補足 |
|---|---|---|
| 開発用教室の判定 | **会社ごとに 1 教室を ID 登録して固定**。名前一致には頼らない | オーナー: 室長は自教室しか開けず教室名も開発者が作るので偶然の衝突は無い。各社に開発用教室を設けるので名前定義は不要 |
| 教室 ID | **自動採番のみ**。手入力 ID は今後禁止（既存 `test_classroom_20260507_dai` は例外で存置） | 共有リンク等の誤配の芽を消す（6-9） |
| 開発用教室の持ち方 | **会社ごとに 1 つ** | 会社固有機能の検証先。教室 1 つぶんのデータが会社ごとに増える |
| 新しい会社（棟）の作成 | **安全装置付きの専用コマンドに限定**（開発者画面からは作らない） | 指定した新キー以外へ書けないガード。取り違え事故（2026-06-06 型）の回避 |
| tools の棟指定必須化／rules 越境テスト／`boardShares` への会社キー追記 | 推奨どおり実施 | 反対なし |

### 10-2. 会社ごとの違いの表し方（6-4, 6-10, 6-11）

| 論点 | 確定 | 補足 |
|---|---|---|
| 機能スイッチ | **当面 2 段（基本 → 会社既定）**。教室単位の要望が増えたら 3 段（O-1）へ | O-1 は保留継続。3 段目を後から差し込める構造にはしておく |
| 会社差の範囲 | **ロゴ・名称・色・呼称／機能の有無／帳票の項目追加・注記／独自の画面・集計** の 4 種すべて | Phase 1 の差し込み口は「帳票の注記・ヘッダ差替」と「メニュー登録・ツールバー追加」の両方を用意する（T1-4, T1-5） |
| 巨大ファイル | ファイル分割はしない。差し込み口を数か所開けるだけ | 要望ごとに「差し込み口で足りるか／コアの機能にすべきか」を判断 |
| 呼称 | **役割名だけ**（室長・開発者など 2〜3 語）。画面と印刷を同時に辞書化。既定は今の言葉 | 授業用語は要望が出てから |

### 10-3. 請求（6-5）

| 論点 | 確定 | 補足 |
|---|---|---|
| 請求書の宛先 | **会社宛合算 ＋ 教室宛**を会社ごとに選べる。**既存運営会社にも適用** | 既存の会社名は「スクールIE」とは別にある。会社名・請求先は棟の文書に持つ |
| 許可者 | **メンバーの印（フラグ）へ移行** | 切替は「先に印を付けてから彫り込み（コード＋rules）を消す」順。片方だけの状態を作らない |
| 全社一覧 | **既存運営会社側の請求画面に「全社」タブ** | 列挙はサーバーの窓口 `listBillingWorkspaces` 1 本 |
| 単価 | **会社の標準単価 ＋ 教室で上書き** | 会社追加時に 1 回決めればよい。教室ごとの例外は今どおり |

### 10-4. 配る仕組み（6-6, 6-7, 6-8, 6-12）

| 論点 | 確定 | 補足 |
|---|---|---|
| 会社リポの公開 | **見せない（オーナー管理の私有リポ）** | フォーク方式でよい。履歴（教室名・調査記録）の漏洩を気にしなくて済む。将来他社に見せるなら履歴なしテンプレ方式へ切替 |
| 会社ごとの URL | **`komahyou-<会社>.web.app` で開始**。独自ドメインは後から | DNS 待ちが無い。既に配った QR（既存 3 教室）は不変 |
| 版番号 | **コア版 ＋ 会社識別子**（例 `1.5.530+companyB.12`）。会社リポは番号を押さない | 上流同期の台帳衝突を消す。版一致チェックの道具を会社サイト用に合わせる |
| 鍵と手順 | 会社リポには Hosting 専用の鍵だけ。functions/rules のワークフローは置かない | 反対なし |

### 10-5. 容量（6-13）

| 論点 | 確定 | 補足 |
|---|---|---|
| 想定規模 | **1〜2 年で 10〜30 教室（全社合計）** | バックアップ関数（300 秒／1GiB）は 15 教室前後で枠切れの見込み。**棟ごとの分割実行を Phase 2 と並行で着手**（本計画の外・別 Issue）。保存の差分書込化は 30 教室が見えてから |
