---
name: komahyou-plan-2026-09-15-multi-company
description: "複数会社展開の構成見直し計画(2026-09-15 起案・第2版 2026-09-16 で全判断点確定)・**Phase 0 完了 v1.5.534・残課題も v1.5.535 で完了(2026-09-16)・次は Phase 1 T1-1(src/company/profile.ts)**・DBは分けず会社=workspaces/{key}・フロントは上流フォーク方式・仕様正本は docs/spec-multi-tenant.md"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9b692f5b-169e-4773-9d9e-2b052f1480a0
  modified: 2026-09-16T03:05:29.703Z
---

2026-09-15 にオーナー要望「別会社の教室は別リポジトリで管理したい／基本機能は共通／DB は分けたくない(一括請求)／
現行アプリの問題点を定義」を受けて起案した計画。**計画正本 `docs/plan-2026-09-15-multi-company-architecture.md`**
(§9 オーナー回答・§10 確定値)。**仕様正本は `docs/spec-multi-tenant.md`(Phase 0 T0-1 で新設・2026-09-16)**。

**推奨構成**: 1 Firebase プロジェクトのまま **会社＝`workspaces/{会社キー}`**(既存 `main`＝既存運営会社・改名しない・会社名は棟の文書に持つ)。
フロントは会社ごとに **上流フォーク**(本リポ＝コア upstream・複製は2社目の要望を見てから)。差分は `src/company/` 1 フォルダに閉じる。
**functions/rules/indexes はコアリポからだけデプロイ**。Hosting は multi-site で `komahyou-<会社>.web.app`。

**確定値(§10)**: 開発用教室は会社ごとに1教室を ID 登録で固定／教室IDは自動採番のみ／新会社作成は安全装置付きコマンド限定／
機能スイッチは当面2段(基本→会社既定・O-1 教室別上書きは保留継続)／会社差はブランド・機能有無・帳票注記・独自画面の4種／
呼称は役割名だけ／請求は会社宛合算+教室宛を会社ごとに選択(既存運営会社にも適用)・許可者はメンバーのフラグへ・全社タブ・
会社標準単価+教室上書き／会社リポは私有／版は「コア版+会社識別子」／想定 1〜2年で10〜30教室(バックアップ関数の棟ごと分割は別 Issue)。

## Phase 0 完了(2026-09-16・v1.5.534・main a28cc68)

4 ブランチを別 worktree で並行実装(T0-1 spec-curator/Opus・T0-2/T0-3 dev-fix/Opus・T0-4 Sonnet)→ `phase0/integration` に統合 → regression-reviewer(Opus)監査「巻き戻しゼロ・条件付き可」→ 指摘対応 → main。
- **T0-2 開発用教室レジストリ**: `src/utils/developmentClassroomRegistry.ts`(自己完結・`{workspaceKey, classroomId, kind: development|sandbox}`)が唯一の権威。
  functions へは `functions/scripts/sync-shared.mjs`(共有ファイル一覧方式に一般化)で `functions/src/generated/` に複製・パリティテストが門番。
  **名前判定「開発用教室」と dev/development 曖昧ID一致は廃止**。`isDevelopmentClassroom(classroom, workspaceKey=env)` / `isDevelopmentClassroomIdentity(workspaceKey, id)` /
  `isFeatureEnabledForClassroom(key, classroom, workspaceKey=env)`。`index.ts` の `DEVELOPMENT_CLASSROOM_ID` 直書きは `resolveDevelopmentClassroomId(ws)` へ。
  **発見した取りこぼし**: ScheduleBoardScreen/scheduleHtml が `{ name }` だけ渡していた(id 付きに修正・字面テストで固定)。
  副作用として**テスト教室(sandbox)でも盤面側 development-only(盤面ベース予定数・講習履歴・AI即答表示)が ON**。**オーナー確定 2026-09-16「テスト教室(テスト教室の担当者)は開発用教室と同じ扱いでいい」→ 仕様本文 §4-2-11 に昇格(v1.5.537)。kind(development/sandbox)で機能解放も混入防止ガードも分けない。kind を見てよいのは会社に1つの開発用教室を決める resolveDevelopmentClassroomId だけ**。
- **T0-3 越境ガード**: `requireClassroomAccessMember` の developer 経路だけ教室 doc 存在検査(純関数 `functions/src/classroomAccess.ts`)。`boardShares` に `workspaceKey` を書くだけ(読み無改変・後方互換テストあり)。
  rules 越境テスト 10 件追加(rules 本文無改変・main⇄other 双方向)。`npm run test:rules` は CI で回らない(手動・Java 21 あり・35 件緑を主セッションで確認)。
- **T0-4 tools**: 5 ツールの `--workspace` 必須化・`copy-prod-classroom-to-staging` は `--classroom` も必須・shebang 除去+invokedDirectly ガード・`functions-logs.yml` 追随。
- **レビュー残課題 R-4〜R-6 は v1.5.535(main 259b120)で完了**: `DevelopmentClassroomIdentity` は `{ id }` のみ(`{name}` だけ渡すとコンパイルエラー・tsc -b は src/**/*.test.ts も型検査する)／サーバー `isDevelopmentClassroomIdentity({ workspaceKey, classroomId })` 名前付き引数／src 全体走査の呼び出しテスト `developmentClassroom.callSites.test.ts`／`requireClassroomAccessMember` 配線と `developmentOnly` 分岐の字面テスト／tools の直接実行判定は `tools/invoked-directly.mjs`(realpathSync)に一本化。台帳の `isRegisteredDevelopmentClassroom(ws, id)` だけ位置引数のまま(共有モジュール・呼び出しはラッパ 1 か所ずつ)。
- **仕様の未決(spec §10)**: 別プロジェクト例外(§9-8)／staging 検証用教室の登録要否(staging には「開発用教室」が無く `staging_test_classroom` のみ・staging-environment スコープで代替)／ローカルモード(workspaceKey 空)は開発用教室扱いにならない(fail-closed)／INV 候補 INV-C1「会社越境の遮断」の採否(オーナー承認)／CLAUDE.md 教室表の一般化は Phase 3／boardShares の `create,update: isSignedIn()` は据え置き(他社ログイン利用者が上書きし得る穴)。

**次の作業 = Phase 1 T1-1**(`src/company/profile.ts`・`CompanyProfile` 型・vite alias `@company`・現行値を最初のプロファイルに)→ T1-2 フラグ2段化 → T1-3 役割名辞書 → T1-4 帳票フック → T1-5 画面フック。Phase 1 完了で一度立ち止まり、2社目の要望を見てフォークを切るか決める。Phase 2 以降は2社目具体化後。

関連: [[komahyou-parallel-agent-worktrees]](並行実装の作法) [[komahyou-plan-2026-09-11-five-requests]](O-1 教室別オプション) [[komahyou-firebase-cost-scaling]]
[[komahyou-billing-developer-account]](請求許可2箇所の罠) [[komahyou-classroom-restore-cross-contamination]](越境汚染) [[komahyou-dev-classroom-qr-token-contamination]](混入防止ガードは判定と必ずセット)
