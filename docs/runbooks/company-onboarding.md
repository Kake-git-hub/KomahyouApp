# Runbook: 2 社目(新しい会社 = workspace)の受け入れ手順

> 計画 `docs/plan-2026-09-18-second-company-onboarding.md` §4 の当日手順をコマンド付きで固定したもの(P-8・2026-10-10)。
> 前提の仕組みは P-1〜P-7 と P-11 で実装済み(spec `docs/spec-multi-tenant.md` §11-1・§12・§13)。
> **所要時間の目安**: 本番作業 約 2 時間(会社側のデータ準備を除く)。**先に staging で同じキーを使って 1 周してから本番**(§2)。
>
> ⚠️ 本番 Firestore への書き込みは、この手順で**新設する workspace とその中の教室に限る**(CLAUDE.md 本番データ保護ルールの
> 例外手順・**オーナー立会い**)。既存運営会社 `main` の文書・既存教室には一切触れない。

---

## 0. 決めること(オーナー・記入欄)

| 項目 | 記入 | 規則・参考 |
|---|---|---|
| 会社キー(workspaceKey) | `________` | 英小文字と数字・3〜16 文字(D-2)。`main` と登録済みキーは不可。URL・Storage パス・プロファイル名に同じ文字列を使う |
| 会社名 | `________` | 棟の文書 `companyName`(請求画面・合算請求書の宛名の既定) |
| ブランド名 | `________` | 棟の文書 `brandName`(任意) |
| 請求先(名・メール) | `________` / `________` | 棟の文書 `billing.recipientName` / `billing.recipientEmail` |
| 標準単価(円/生徒) | `________` | 棟の文書 `billing.standardUnitPrice`(教室の `studentUnitPrice` で上書き可・既定 300) |
| Hosting サイト名 | `komahyou-<会社キー>` | D-3 確定(`komahyou-<会社キー>.web.app`)。staging は `komahyou-<会社キー>-staging` |
| 開発用教室の名前 | `________` | 会社ごとに 1 教室(D-4・§7-14)。手順 6 で作り、手順 7 で台帳へ |
| オーナーの Firebase Auth UID | `________` | Firebase コンソール → Authentication → ユーザー。会社側の developer は作らない(D-8) |

---

## 1. 前提チェック(Claude)

```bash
git fetch origin && git status -sb            # main が origin/main に追随
node tools/provision-workspace.mjs --project komahyouapp-staging --workspace <会社キー> \
  --company-name "<会社名>" --developer-uid <UID> --developer-email <メール> --dry-run   # 引数の検査だけ(書き込みなし)
npm run test:unit                              # 会社サイト一覧・プロファイル・配信ガードのテストが緑
```

---

## 2. staging で予行(Claude・手順 3〜9 を staging で 1 周)

- 手順 3 の `--project komahyouapp-staging`、手順 5 の secret は `STAGING_FIREBASE_WEB_ENV_<会社キー>`、手順 8 のワークフロー入力は
  `target_project = komahyouapp-staging`。`tools/company-sites.json` には staging のサイトも書く(`komahyouapp-staging` の行)。
- 詰まった箇所はこの runbook に反映してから本番へ(P-9 予行演習の記録欄 §10)。

---

## 3. 本番: workspace(棟の文書)と developer 会員を作る(Claude・オーナー立会い)

```bash
# gcloud がオーナーアカウントで認証済みであること(gcloud auth print-access-token が通る)
node tools/provision-workspace.mjs \
  --project komahyouapp-prod --workspace <会社キー> \
  --company-name "<会社名>" --brand-name "<ブランド名>" \
  --billing-recipient "<請求先名>" --billing-email <請求先メール> --unit-price <標準単価> \
  --developer-uid <オーナーの UID> --developer-email <オーナーのメール> --developer-name "<表示名>" \
  --confirm <会社キー>
```

- 作られるのは `workspaces/<会社キー>`(棟の文書)と `workspaces/<会社キー>/members/<UID>`(developer・`billingAllowed: true`)の 2 文書だけ。
  **既存キーは拒否**(棟の文書が既にあれば中止)・**本番は `--confirm` 必須**・書き込み先ガードあり(spec §6-2)。
- 確認: ツールが最後に GET で照合した `companyName` / `standardUnitPrice` が記入欄と一致する。

---

## 4. リポジトリ側の登録(Claude・1 ブランチ・CI 緑 → main マージ)

1. **プロファイル(P-1)**: `src/company/profiles/<会社キー>.ts` を `profiles/main.ts` を写して作る
   (`companyKey: '<会社キー>'`・`displayName: '<会社名>'`・`brandName: '<ブランド名>'`・呼称・フックは既定のまま)。
   `src/company/profiles/index.ts` に `<会社キー>: <会社キー>CompanyProfile,` を 1 行足す。
2. **会社サイト一覧(P-3)**: `tools/company-sites.json` の `companies` に 1 要素
   (`companyKey`・`label`・`hosting."komahyouapp-prod" = { siteId: "komahyou-<会社キー>", url: "https://komahyou-<会社キー>.web.app" }`・
   staging も同様・`monitor: true`)。
3. **Hosting target(P-3)**: `.firebaserc` の `targets."komahyouapp-prod".hosting` と `"komahyouapp-staging".hosting` に
   `"<会社キー>": ["<siteId>"]`。`firebase.json` の `hosting` 配列に **`main` の要素を複製して `target` だけ `<会社キー>`** に。
4. **会社既定の機能スイッチ(任意)**: 会社全体で ON/OFF したい機能があれば `src/utils/companyFeatureDefaults.ts` の
   `COMPANY_FEATURE_DEFAULTS` に行を足し `npm --prefix functions run sync-shared` で生成物を更新(無ければ基本スコープのとおり)。
5. `npm run lint && npm run test:unit && npm run build` → CI 緑 → main マージ(既存運営会社のビルド出力は不変。`profile.test.ts` /
   `company-sites.test.mjs` / `company-deploy-guard.test.mjs` が固定)。

---

## 5. Hosting サイトと secret(オーナー・GCP/GitHub)

1. Firebase コンソール → Hosting → 「別のサイトを追加」→ サイト ID `komahyou-<会社キー>`(staging プロジェクトでも同様に `komahyou-<会社キー>-staging`)。
2. GitHub → Settings → Secrets and variables → Actions:
   - `FIREBASE_WEB_ENV_<会社キー>`: 本番の `.env` 形式テキスト(`FIREBASE_WEB_ENV` の中身を写し、次の 2 行を会社キーに変える)
     ```dotenv
     VITE_FIREBASE_WORKSPACE_KEY=<会社キー>
     VITE_COMPANY_KEY=<会社キー>
     ```
   - `STAGING_FIREBASE_WEB_ENV_<会社キー>`: staging 用(`STAGING_FIREBASE_WEB_ENV` を写して同じ 2 行を変える)。
   - サービスアカウント(`RE_FIREBASE_SERVICE_ACCOUNT` / `STAGING_FIREBASE_SERVICE_ACCOUNT`)は既存のものを使う。
3. secret の中身の検査はワークフローが行う(`tools/company-deploy-guard.mjs`: workspace キー・会社キー・projectId の一致、`local` でない)。

---

## 6. 配信(Claude: Actions → 「Deploy Company Hosting」→ Run workflow)

- 入力: `company_key = <会社キー>`・`target_project = komahyouapp-prod`(予行は `komahyouapp-staging`)。
- 緑なら `https://komahyou-<会社キー>.web.app/version.json` が本番 `komahyouapp-prod.web.app/version.json` と同じ版(会社版は空 = コア版)。
- 赤の見方: 前提検査(プロファイル未登録・サイト一覧未登録・target 無し・secret の食い違い)はログの箇条書きを直す。
  `is the current active version` は既に同じ内容が配信済み(成功扱い)。

---

## 7. 教室・室長・開発用教室を作る(オーナー・2 社目のサイトで)

1. `https://komahyou-<会社キー>.web.app` を開き、オーナー(developer)でログイン(ログイン前のタブ名「コマ表アプリ」)。
2. 開発者画面 → 教室を追加(自動 ID)→ 室長会員を発行(会社側には室長会員だけ・developer は作らない D-8)。
3. 同じ手順で **開発用教室**を 1 つ作り、教室 ID を控える。

---

## 8. 開発用教室の台帳登録(Claude・P-6)

1. `src/utils/developmentClassroomRegistry.ts` の `DEVELOPMENT_CLASSROOM_REGISTRY` に 1 行:
   `{ workspaceKey: '<会社キー>', classroomId: '<教室 ID>', kind: 'development', label: '<会社名>の開発用教室' },`
2. `npm --prefix functions run sync-shared` → 生成物 `functions/src/generated/developmentClassroomRegistry.ts` もコミット
   (パリティテスト `functions/src/developmentClassroomRegistry.parity.test.ts` が緑)。
3. main マージ → `functions/**` が変わるので「Deploy Cloud Functions」が自動で走る(緑を確認)。これでその教室だけが
   会社の検証用教室(先行機能・他教室バックアップの読み込み)になる(spec §4-2)。`main` の判定結果は不変(パリティテスト)。

---

## 9. 初期データの取込(室長 + Claude・P-7)

1. 会社へ雛形 `docs/runbooks/company-onboarding-template.xlsx` を渡す(再生成: `node tools/build-company-onboarding-template.mjs`)。
   **1 教室 1 ファイル**。シート: マネージャー / 講師 / 生徒 / 通常授業テンプレ(任意) / 教室データ / 説明。列名は基本データ画面の
   取込と同一(`tools/build-company-onboarding-template.test.mjs` が同期を検査)。
2. **個人情報の受け渡し**: メール本文・通常添付で送らせない。**パスワード付き zip(パスワードは電話か別メール)** か、会社の共有ドライブの
   **期限付きリンク**。受け取ったファイルはスクラッチ領域に置き、リポジトリ・Issue・ログへ出さない(CLAUDE.md)。取込後は削除。
3. 各教室で 基本データ → 「取込」で雛形を読み込む → 通常授業テンプレ反映 → 保存。
4. 毎時バックアップが workspace 単位で出ることを読み取りで確認: Storage `workspace-auto-backups/<会社キー>/hourly/`。

---

## 10. 仕上げ(Claude / オーナー)

- [ ] 外形監視: `tools/company-sites.json` に `monitor: true` で載せたので次回の Uptime Check が会社サイトも確認する(Actions 緑)。
- [ ] 請求: 開発者画面 → 請求(`/billing`)→「この会社」タブに会社名・請求先・標準単価が出る/「全社」タブに 2 社が並ぶ。
  2 社目の請求担当がオーナー以外になるときは、その人の developer 会員に `billingAllowed: true`(Firebase コンソール)。
- [ ] 確認リスト(開発用教室の確認リストパネル)を 2 社目のサイトで 1 周・「質問・要望」の通知先を確認(オーナー)。
- [ ] 会社へ URL・室長アカウント・QR の使い方(`docs/user-manual.md`)を渡す。ハードリロード(Ctrl+Shift+R)の案内。
- [ ] 台帳 `src/utils/developmentStatusLedger.ts` の行を更新。

### P-9 予行演習の記録(staging・架空の会社 `demo`)

| 日付 | 所要時間 | 詰まった箇所 → runbook の修正 |
|---|---|---|
| (未実施) | | |

---

## ロールバック

- 手順 6 まででやめる: サイトを未公開のまま残せばよい(配信していなければ利用者はいない)。
- 手順 3 で作った workspace を消す: spec §7-15(二重確認・書き出しを先に)。Firebase コンソールで `workspaces/<会社キー>` 配下を
  削除(Claude は本番の削除をしない)。既存 `main` は一切触っていないので、アーチ側への影響はゼロ。
- リポジトリ側の登録(手順 4・8)は revert で戻せる(`main` のビルド出力は登録の有無で変わらない)。

---

## 請求許可者の第 2 段(メール固定の撤去・§2-A 影響 3 承認済み・別 push)

1. オーナーが `main` と 2 社目の**自分の会員文書**に `billingAllowed: true` を立てる(新設分は手順 3 で付与済み・`main` は Firebase コンソール)。
2. 請求画面(`/billing`)が両サイトで開けることを確認。
3. Claude が `firebase/firestore.rules` の `isBillingDeveloper` のメール 3 件と `src/utils/billing.ts` の `BILLING_ALLOWED_EMAILS` を
   **同じ push** で消す(rules は「Deploy Firestore rules」で反映)。`npm run test:rules` の「メール固定の developer はフラグ無しでも読める」を
   「読めない」に反転させる。
