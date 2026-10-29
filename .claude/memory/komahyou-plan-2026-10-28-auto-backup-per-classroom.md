---
name: komahyou-plan-2026-10-28-auto-backup-per-classroom
description: 15 分毎の自動バックアップの教室別化(gzip＋時点ごとの目次)・2026-10-28 オーナー確定・2026-10-29 v1.5.662 で段階 0〜2 のコード実装済み・書く側の切り替えは設定 WORKSPACE_AUTO_BACKUP_LAYOUT(staging→本番・未)・仕様は spec-save-restore §10
metadata:
  node_type: memory
  type: project
---

**計画の正本**: `docs/plan-2026-10-28-per-classroom-auto-backup-handoff.md`(2026-10-28・spec-curator)。オーナー指示「自動バックアップの教室別化はすぐに次セッションで着手できるようにして」(分割保存の段階 B 全教室展開の直後・20 教室を見据えた質問から)。

**事実(2026-10-28 実測)**: main は 4 教室(日大前 8.38MB・緑が丘 6.11MB・テスト教室 8.94MB・開発用 8.30MB)で 15 分毎の 1 本が 31.7MB(gzip 3.0MB)・7 週で 25% 増。Storage `workspace-auto-backups/main/15min/` に 170 本 5.38GB。生成は 1 教室 1.5〜2 秒。生成関数は 540 秒/2GiB(10/22 増強済み)。**最初に詰まるのは読む側**: 復元の callable(`downloadClassroomFromServerAutoBackup`=室長の自教室復元/Feature B・`downloadServerAutoBackup`=開発者の全体復元)は 512MiB で 1 本を丸ごと読み JSON.parse するため、日大前校サイズで 1 社 8〜10 教室から**室長の自教室復元が先に壊れる**見込み。既存の副作用: 開発者のローカル同期は時点ごとに incident backup を 1 本ずつ書く(2026-05 の 46.8GB 残置と同型)・生成ループに会社ごとの try/catch が無い・間引きの要約全件読みが月 約 110 万回。

**2026-10-28 オーナー確定: Q1〜Q9 すべて推奨案(各 1 番目)**(「全部推奨案で確定して台帳に書いて」)。次セッションは聞き直さず spec §10 を書いて段階 0 から。

**案 A(確定)**: 教室ごとに 1 本 gzip ＋ 時点ごとの index.json。教室ファイルは「1 教室だけ入った WorkspaceSnapshot」(JSON 読込・開発者モーダル・snapshot-diff.mjs は無改修)。要約には layout の印だけ(教室一覧は載せない・INV-08)。目次は最後に公開(INV-14)。間引きは時点単位。移行は 2 段(読める版 → 書く側を設定で切り替え・戻せる)。決定: 全体 1 本は残さない/Storage も gzip/日次も教室別/Drive は教室ごと .json.gz・保持は Storage と同じ・掃除 1 日 1 回(30 教室で 12GB=15GB の 80%・25 教室で再判断)/復元画面は変えない/間引きは時点単位＋取り残しの掃除/Issue #77 の分割実行は後回し/控えは教室別で残しローカル同期では書かない/期限=2 社目受け入れ前に段階 2 まで。

**Why**: 1MiB 上限は分割保存で解消したが、教室数が増えたとき最初に詰まるのは全教室 1 本のバックアップとその読み手。
**How to apply**: 次セッションは Q1〜Q9 を聞き直さず、確定内容で spec-save-restore §10 を書く(骨子は計画書 §8)→ 段階 0〜3。INV-14 マトリクス「行: 自動バックアップ」の文字列検査を弱めずに追従。[[komahyou-backup-3tier-and-scheduler-role]] [[komahyou-firebase-cost-scaling]] [[komahyou-manager-self-restore]] [[komahyou-snapshot-1mib-capacity-incident]]

**2026-10-29 実装済み(v1.5.662・段階 0〜2 を 1 つの変更で)**: 仕様正本 `docs/spec-save-restore.md` §10(10-1〜10-12)。
- 共有純関数 `src/utils/workspaceBackupLayout.ts`(sync-shared で functions へ複製・パリティテスト): パス(`15min/{key}/{classroomId}.json.gz`＋`index.json`)・文字種 `^[A-Za-z0-9_-]+$`・
  教室ファイル=1 教室だけの WorkspaceSnapshot＋`backupFile`(3 点照合)・目次(`classrooms[]` は教室の項目＋file/bytes/sha256/sourceSavedAt・`missingClassrooms[{id,reason}]`)・
  要約の layout 判定(無い=legacy・知らない=unknown で fail-closed)・全体の組み立て直し(AC-B1: 旧形式と stableStringify 一致)・取り残し判定(1 日)。
- 書くループ `functions/src/workspaceBackupWriter.ts`(I/O 注入・教室ごとに逐次・目次は最後・assembly/write の exclude|throw・書き込み 1 回やり直し・ミラー失敗は集める)。
- 設定 `functions/src/workspaceBackupLayoutConfig.ts`: `WORKSPACE_AUTO_BACKUP_LAYOUT`(legacy|per-classroom-v1・既定 legacy)＋`_OVERRIDES`(main=…,demo=…)。知らない値は legacy＋警告。
- index.ts: `runWorkspaceServerAutoBackup` が会社ごとに try/catch(失敗はメール `auto-backup-failed`・会社ごと 1 時間 1 通)→ layout で `runPerClassroomWorkspaceBackupForWorkspace` / `runLegacyWorkspaceBackupForWorkspace`。
  教室別は要約を目次の後に書き(`layout`・`classroomCount`・教室名は載せない)、Drive は教室ごと＋目次の `.json.gz`(目次も gzip=7 日ルールに巻き込まれないため)・掃除は JST 3:00 の回だけ。
  読み手: `downloadClassroomFromServerAutoBackup` は文字種検査を会員確認より前→layout で分岐→教室ファイルだけ読んで 3 点照合。`downloadServerAutoBackup` は教室別の時点で failed-precondition(再読み込みの案内)・`purpose: 'local-sync'` で控えを書かない。
  新 callable `prepareServerAutoBackupRestore`(開発者・控え→目次を返す)。控え `writeWorkspaceIncidentBackup` は**常に**教室別フォルダ(assembly/write とも throw・M-1 維持)。
  間引きは教室別なら `deleteFiles({prefix})` → 要約。取り残しの掃除 `pruneOrphanedWorkspaceBackupFolders`(cleanup に独立予算 30 秒・**既定は空実行** `WORKSPACE_BACKUP_ORPHAN_PRUNE_DRY_RUN` 未設定=1・0 で削除)。
- クライアント: `adminFunctions.ts` の `downloadFirebaseServerAutoBackupJson(summary, {purpose})` が layout で読み分け(教室別=prepare→教室ごと→`assembleWorkspaceBackupFromIndex`)。App.tsx の全体復元(restore)とローカル同期(local-sync)はこれ 1 本。教室選択モーダルは不変。
- テスト: 共有 40 件・ループ 10 件・設定 4 件・配線(functions `workspaceBackup.wiring`・クライアント `serverAutoBackupRestore.wiring`)・INV-14 マトリクス「行: 自動バックアップ」を旧形式/教室別の 2 行へ(台帳 spec-invariants 改定・保証文不変)・snapshot-diff に教室ファイル fixture。
- **残り(台帳 auto-backup-per-classroom の次の一手)**: 確認リスト ab-1/ab-2(読み手が今までどおり)→ staging で `WORKSPACE_AUTO_BACKUP_LAYOUT=per-classroom-v1`(deploy-staging.yml の functions env)→ 本番 `PROD_FUNCTIONS_ENV` に同じ行→ ab-3/ab-4 を足す→ 翌朝の掃除ログで空実行の件数→ `…DRY_RUN=0`→ 段階 3(10〜20 教室の実測・backupRetentionEstimate・Issue #77)。
- ⚠️ 切り替え後は Functions を v1.5.662 より前へ戻さない(rollback.md B-6)。戻すなら先に設定を legacy へ。
