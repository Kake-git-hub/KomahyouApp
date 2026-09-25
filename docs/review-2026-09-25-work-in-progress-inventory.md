# 途中作業の洗い出し（2026-09-25 時点）

> **性質**: 調査記録（オーナー指示 2026-09-25「今のコマ表アプリの途中作業のもの（開発用教室だけにとどまっているものや、
> Claude Code で作成途中で止まっているもの）を洗い出して」）。仕様の正本ではない。
> この洗い出しを起点に、以後は開発者画面の**開発ダッシュボード**（`docs/spec-developer-report.md` §E-3）と
> 進行中テーマ台帳 `src/utils/developmentStatusLedger.ts` で追う。この文書は時点の記録として残し、更新しない。

## 0. 同期状態（洗い出しの土台）

| 項目 | 状態 |
|---|---|
| ローカル / origin/main | `39509e1` = **v1.5.556**（一致・遅れなし） |
| ライブ `komahyouapp-prod.web.app/version.json` | セッションのサンドボックスから到達できず（プロキシ 403）。main の最後のコミットが CI の bump（v1.5.556）なので、ライブも v1.5.556 とみなした |
| `CHANGELOG.md` の `## 未リリース` | 空（main にコミット漏れなし） |
| 作業ツリー | クリーン |
| テスト | `npm run test:unit` 2343 件緑（functions の依存を入れないと `@anthropic-ai/sdk` で 2 ファイル落ちる＝環境要因） |

## 1. 開発用教室（検証用教室）だけで止まっている機能（機能フラグ）

`src/utils/featureRollout.ts` の `scope` が `all-classrooms` でないもの。**6 件**。

| フラグ | 機能 | scope | 導入 | 状態・残り |
|---|---|---|---|---|
| `transferSourceRestDisplay` | 振替元「休)」表示・振替欄の元起点統一・丸ごと振替/休日設定の記録保持（INV-06/INV-05） | development-only | v1.5.539（2026-09-16） | r-1〜r-8 は OK。A→B→C 再移動の日付追随を v1.5.556 で修正 → 確認 **t-1 結果待ち**。OK なら staging → 全教室 |
| `studentWithdrawAutoSweep` | 退塾の自動掃除・高3卒業の退塾日自動入力 | development-only | v1.5.553〜554（2026-09-20/21） | 室長の確認なしに実データを書き換えるため先行。**b-2 / b-3 結果待ち**。本番3教室の初回対象は 0 名（2026-09-21 実測） |
| `parentPortalQr` | 保護者向け固定QR（休み連絡専用） | staging-environment | v1.5.513（2026-09-13）・休み連絡専用へ v1.5.550 | **q-1〜q-6 結果待ち**。公開順は 開発用 → staging → 本番1教室 → 全教室（§H）。**サーバー側 `isParentPortalEnabledForClassroom` と両側同時に昇格** |
| `lessonHistory` | 講習履歴（生徒日程表タブ） | development-only | v1.5.502（2026-09-12） | h-1〜h-10 は OK 済み（Issue #63〜#66）。**昇格の判断だけが未定** |
| `boardBasedPlannedCount` | 通常回数（予定数）の盤面ベース化（INV-05 Step2） | development-only | v1.5.471（2026-08-07・オーナー確定 2026-08-05） | **7 週間止まっている**。ON で過去月の数字が動くため段階導入。確認リストの項目が作られていない |
| `questionAiAnswer` | 質問への AI 即時回答（Vertex AI・試験） | development-only | v1.5.524（2026-09-14） | オーナー指示で開発用教室だけ。本番へ出す予定は未定（§G-1「即答は作らない」の例外） |

昇格済み（参考・残作業なし）: `managerSelfRestore`（v1.5.556 で全教室）、`boardPrintSelection`（v1.5.511）、`boardOnlyScheduleCells`、
`studentScheduleDndMove` / `schedulePopupAutoSync`、`teacherDragAndDropMove`、`studentDragAndDropMove`、`studentScheduleOptionField` ほか。

## 2. 確認リスト（第23版 v1.5.556）の結果待ち 11 項目

`src/utils/verificationChecklist.ts`。第22版の結果（受付 e541141c・2026-09-22）で OK だった項目は外し済み。

| id | 分類 | 内容 | 紐づく機能 |
|---|---|---|---|
| b-2 / b-3 | 基本データ | 退塾で今日以降のコマ・記録が消え切る／日付入力でも同じ・退塾後は編集不可 | `studentWithdrawAutoSweep` |
| c-2 | 確認リスト | 文字が 2 倍・幅 1120px | パネル自体 |
| t-1 | 盤面 | A→B→C の再移動で「休)」の日付が C に追いつく | `transferSourceRestDisplay` |
| s-4 | バックアップ/復元 | 本番教室にも「サーバーバックアップから復元」のパネルが出る（見るだけ） | `managerSelfRestore`（昇格済みの確認） |
| q-1〜q-6 | 保護者QR（休み連絡） | 保護者ページ → PC の四択 → 保存 → 再通知なし → 履歴 | `parentPortalQr` |

結果は `node tools/verification-checklist-report.mjs --workspace main` か、開発ダッシュボード「5. 確認リスト」で読む。
第24版（本セッション・版は v1.5.556 据え置き）で開発ダッシュボードの確認 **d-1** を追加した。

## 3. Git ブランチ（リモート 51 本）

`git fetch --deepen` で全履歴を取り、`git cherry` で main に同じ変更が入っているかを見た。

### 3-1. main に無い変更を持つブランチ（5 本）= 作りかけ・クローズ候補

| ブランチ | 最終 | 独自コミット | 中身 | 判断 |
|---|---|---|---|---|
| `claude/arch-contract-recovery-plan-m7765e` | 2026-09-19 | 5 | 株式会社アーチとの契約時環境の固定（タグ `contract/arch-2026-09-19` = v1.5.552）・release タグ自動付与・`mark-stable.yml` / `restore-baseline.yml`・runbook `contract-baseline-arch.md`・CLAUDE.md 4 行 | **作りかけ**。CI ワークフローを 2 本増やす内容なのでオーナーが中身を見てからマージ／破棄 |
| `claude/stoic-carson-srb4tr` | 2026-09-19 | 4 | 室長・保護者向け画面の文言棚卸し（`docs/ui-text-review-2026-09-18.md` 561 行＋Excel・オーナー記入欄つき） | **作りかけ**（docs のみ）。オーナーが Excel に可否を記入 → 実装テーマ化 |
| `ci/functions-deploy-409-targeted` | 2026-06-27 | 2 | functions デプロイの 409 誤成功対策（PR #31・open のまま） | **古い**。main は `set -o pipefail` で別対応済み（CLAUDE.md にも記載）。クローズ候補 |
| `claude/test-procedure-docs-tm1y8t` | 2026-06-30 | 6 | 実機確認テスト手順書（Word/Excel・`docs/runbooks/manual-test-procedure.md`） | **古い**。main には別経路で xlsx 2 件だけある。取り込むか捨てるかをオーナーが決める |
| `agents/feature-data-integrity-checks` | 2026-06-03 | 1 | データ整合性チェック（`dataIntegrity.ts`）＋ `ScheduleBoardScreen.tsx` 大改修（27 ファイル・+2351 行） | **古い**。4 か月前の盤面に対する変更で衝突確実。クローズ候補（必要なら純関数 `dataIntegrity.ts` だけ拾い直す） |

### 3-2. main に取り込み済みのブランチ（45 本）= 削除してよい

`template-lesson-minutes`（1 コミット先行だが同じ変更が main にある）を含め、下記はすべて `git cherry` で `-`（取り込み済み）。
リモートから削除して見通しをよくする（削除はオーナー操作。`git push origin --delete <branch>`）。

```
main-yiic87 feat/group-lesson spec-review-2026-06 feat/report-question feat/parent-portal-qr
template-lesson-minutes feat/question-ai-answer feat/question-ai-vertex feature/board-sort-modes
chore/withdraw-followups feature/student-drag-move fix/firebase-cost-cleanup feature/backup-granularity
feature/whole-day-transfer feat/hide-day-spacing-rule feature/schedule-react-view feat/salary-subtotal-manual
fix/withdraw-date-exclusive fix/basic-data-delete-guards feat/student-withdraw-button
fix/durable-manual-teacher-edits feat/transfer-source-rest-display feat/withdrawn-student-soft-delete
fix/checklist-0914-k11-k12-history fix/withdraw-button-immediate-hide chore/checklist-v1.5.541-rehearsal
chore/remove-dead-rollback-download claude/uptime-check-failures-91x63r claude/undigested-makeup-bug-o1oldi
feature/monthly-student-count-ledger copilot/fix-timetable-operation-issue chore/checklist-v1.5.540-rest-display
fix/teacher-auto-assign-request-refire claude/instructor-screen-layout-mtlkql fix/holiday-record-remerge-and-seat-ops
copilot/simplify-automatic-assignment-ui copilot/simplify-ui-for-auto-assign-rule claude/phase0-phase1-continuation-1cqr5m
claude/koma-schedule-options-field-0hia1q claude/student-schedule-group-sync-oz74nc feature/managed-roster-entrydate-agnostic
feature/auto-assign-rule-ui-simplification claude/koma-hyō-repo-firebase-sync-oijmoa claude/previous-session-display-bug-s4qu50
claude/training-assignment-revert-bug-48nfel
```

（`claude/quirky-mendel-xs7xys` は本セッションの作業ブランチ。）

## 4. 計画・仕様文書で「未着手」「保留」「オーナー確認待ち」のもの

| テーマ | 段階 | 出どころ | 残り |
|---|---|---|---|
| 質問の承認・返答フロー Q-3〜Q-6（callable `answerDeveloperReport`・開発者画面の承認サブページ・返答通知・QA 公開） | 未着手 | `spec-developer-report.md` §G-3〜G-5、`plan-2026-09-11-five-requests.md` §3 | §G「オーナー確認待ち ①〜④」（入口・公開基準・公開範囲・API 自動処理）が仮置きのまま。Q-1/Q-2（質問種別）は実装済み |
| 2 社目の受け入れ P-1〜P-12 | 未着手（計画第 3 版・オーナー回答済み） | `plan-2026-09-18-second-company-onboarding.md` §3/§8 | 着手順 P-1（会社別プロファイル）→ P-2（タブ名「コマ表アプリ_教室名」）→ P-3（multi-site）。P-0 はオーナーの薬円台校削除の実施待ち |
| 複数会社展開 Phase 2 / Phase 3 | 未着手（2 社目が具体化してから） | `plan-2026-09-15-multi-company-architecture.md` §7/§9-9 | Phase 0・1 は完了（2026-09-18）。バックアップ関数の棟分割（P-10）は 15 教室に近づく前に別枠 |
| 教室別オプション基盤 O-1 / O-2 | 保留 | `plan-2026-09-11-five-requests.md` §4、`spec-multi-tenant.md` §7-1 | 機能スイッチは当面 2 段。教室単位の要望が増えたら再開 |
| 戻るボタンの再定義 U-1〜U-6 | 保留（2026-09-11） | `plan-2026-09-11-five-requests.md` §2 | U-0（現行バグの疑い）だけ修正済み |
| 対話用日程表の React 化 | 棚上げ（2026-07-08） | `handoff-popup-sync-and-dnd.md`、`spec-schedule-interactive-view.md` | React ビュー本体のコードは既に無い（`scheduleViewData.ts` / `scheduleViewMove.ts` は別タブ方式で現役）。`spec-index.md` の「未実装」表記が残っている |
| 多ルール×「全員」の性能最適化 | 待機（発火条件待ち） | `perf-multi-rule-optimization-handoff.md` | 室長から「重い」報告が来たら着手 |
| 保護者ページ API の全体レート制限（1 分 30 件） | 未実装 | `functions/src/parentPortal.ts:192`（maxInstances で代替） | 保護者 QR の昇格判断と同時に要否を決める |
| 教室追加のアプリ内完結（UID 貼付の撤去） | 未着手 | `spec-classroom-auth.md` 差分 2、Issue #38 | Functions `provisionWorkspaceClassroom` は実装済みで UI 未接続 |
| 引き継ぎ文書の後始末 | — | `SESSION-HANDOFF.md` / `NEXT-SESSION-PROMPT.md`（廃止済み・歴史記録）、`handoff-qr-submitted-at.md`（完了）、`handoff-student-schedule-option-field.md`（昇格済み） | 残作業なし。歴史記録として保持 |

コード内の `TODO` 34 件はすべて仕様番号への参照（`⑧TODO2` など）で、未完了の印ではない。

## 5. GitHub Issue（open 13 件）と PR

| # | 内容 | ラベル | 判断 |
|---|---|---|---|
| #69 | [利用者質問] 緑が丘校: 丸ごと振替後に新規で入った生徒の日付（2026-09-16） | question / user-report / triage | **オーナー確認待ち**（利用者報告は勝手に修正を始めない） |
| #62〜#66 | [利用者要望] 開発用教室: 確認リスト v1.5.502〜509（2026-09-11〜12） | feature / user-report / triage | 確認リストは Issue を起票しない運用（2026-09-13）に変える前の自動起票。中身は対応済み → **クローズ候補** |
| #48 | テンプレ上書き分岐Cの講習ストック相殺が freeze 境界で残数ズレ | bug s3 盤面 | 7 月のバックログ |
| #47 | テンプレ講師が出勤不可でも赤配置で置き直され続ける | feature s3 盤面 | 7 月のバックログ |
| #43 | 旧 LessonScheduleTable 連携 QR のデッドコード撤去 | feature s3 QR | 7 月のバックログ |
| #42 | 日程表ポップアップの二重同期 | bug s3 生徒日程表 | 7 月のバックログ |
| #41 | 廃止済み managers の配管撤去 | feature s3 | 7 月のバックログ |
| #39 | 削除した未消化振替を復帰できる UI | feature s3 盤面 | 7 月のバックログ |
| #38 | 教室追加・新室長発行をアプリ内完結に | feature s3 | 7 月のバックログ（§4 と同じ） |
| PR #31 | ci(functions): 409 誤成功の解消（2026-06-26） | — | 古い。main で別対応済み → クローズ候補 |

## 6. 次の一手（推奨）

1. 開発用教室で確認リスト第24版（b-2/b-3・c-2・t-1・s-4・q-1〜q-6・d-1）を回し、結果を開発ダッシュボードで読む。
2. OK になったものから `transferSourceRestDisplay` → `studentWithdrawAutoSweep` → `parentPortalQr`（両側同時）の順に昇格を判断する。
3. `lessonHistory`（検証済み）と `boardBasedPlannedCount`（7 週間停止）の昇格可否を決める。後者は確認項目を先に作る。
4. 作りかけブランチ 2 本（契約時環境の復旧計画・文言棚卸し）の扱いを決め、古いブランチ 3 本と PR #31、Issue #62〜#66 を閉じる。
5. マージ済みブランチ 45 本をリモートから削除する。
