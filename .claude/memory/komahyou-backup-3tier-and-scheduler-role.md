---
name: komahyou-backup-3tier-and-scheduler-role
description: 自動バックアップは15分毎生成1本+プルーン時の経過時間ベース間引き方式(2026-07-10再設計・本番稼働中)。過去の3階層独立生成スケジュールは廃止済み。cloudscheduler.admin権限問題の記録も保持
metadata: 
  node_type: memory
  type: project
  originSessionId: 7d8e1494-8c97-4fde-b12c-93b9beed5613
---

自動バックアップは **15分毎(`*/15 * * * *`)の生成1本に一本化し、プルーン時に経過時間で間引く方式**
(オーナー確定・2026-07-10 v1.5.426で本番稼働開始)。
- age<24h: 全保持(15分毎そのまま)
- 24h≤age<72h: JSTで分=00のみ保持(実質毎時)
- 72h≤age<7日: JSTで時=03かつ分=00のみ保持(実質日次AM3:00)
- age≥7日: 削除
純ロジックは `functions/src/workspaceBackupSchedule.ts` の `shouldKeepWorkspaceAutoBackup({savedAtMs,nowMs})`
(kind非依存・実時刻だけで判定)。Google Driveミラーも同じ関数で統一(以前の「15分毎はDriveスキップ」は撤回、
生成のたびに毎回ミラー→頻度は96回/日に増加)。

**旧設計(2026-07-09導入・1日で廃止)**: 15分(24h)+毎時(48h)+日次(7日)の**独立した3スケジュール生成**だった。
オーナーから「直近24hは15分毎、以降72hまでは毎時0分だけ残す、以降1週間はAM3時だけ残す」という間引き方式の
指示があり、`createWorkspaceServerAutoBackups`(日次生成)・`createWorkspaceServerHourlyBackups`(毎時生成)の
**Cloud Functions 2本を削除**して現行方式に置き換えた。本番で `gcloud functions list`/`gcloud scheduler jobs list`
にて2関数の削除と `createWorkspaceServerQuarterHourlyBackups` 単独稼働(ENABLED)を確認済み。

フロントのストレージ使用量見積り(`src/App.tsx` の `SERVER_AUTO_BACKUP_ESTIMATED_RETAINED_COUNT`)も
新方式の概算本数(96+48+4=148本)に合わせて修正。旧実装は保持短縮(14日→7日、72h→48h)が反映漏れで
古い数値のまま放置されていたバグも同時に修正した。

**経緯・ハマった点(再発時の参考)**: 2026-07-09の一連の作業で、CIのSA
`firebase-adminsdk-fbsvc@komahyouapp-prod.iam.gserviceaccount.com` に `roles/cloudscheduler.admin` が
未付与で `cloudscheduler.jobs.update` が403(CLAUDE.md記載の2026-07-04初出の件と同一原因)だった。
オーナーがGCPコンソールIAMで付与後、1回目の再デプロイでは新規スケジュール関数だけ「Skipped (No changes
detected)」でスケジューラー紐付けがスキップされる罠があった(403で失敗した1回目の試行時点でCloud Function
本体は権限エラーの**前**に作成済みだったため、ソースハッシュ比較で「変化なし」と誤判定された)。
→ **教訓**: 新規スケジュール関数がスケジューラー権限エラーで失敗した場合、権限付与だけの再実行では
直らないことがある。`gcloud scheduler jobs list --project=<id> --location=<region>` で実際にジョブが
ENABLEDになっているか必ず確認すること(Cloud Functions側がACTIVEでも安心しない)。直らない場合は該当関数の
ソースに実質的な差分(コメント追加等)を入れて強制再デプロイすると解消する(今回はコード変更を伴う正当な
再デプロイだったためこの罠は再発しなかった)。

**Google Drive 同期が CI デプロイで無効化される罠(2026-07-10 恒久対策)**: `functions/.env`(GOOGLE_DRIVE_* 一式)は
.gitignore 済みで CI のチェックアウトに含まれない。本番 `deploy-functions.yml` には staging のような env 書き込み
ステップが無かったため、CI経由で functions をデプロイするたびに `GOOGLE_DRIVE_BACKUP_FOLDER_ID` 等が空になり
`isGoogleDriveBackupConfigured()` が false→Drive同期が黙って停止していた(実行時ログに "Synced Google Drive backup"
も "failed" も出ない=configured=false のサイン)。以前は本番functionsをオーナーのローカルからデプロイしていた
ため env が焼き込まれていた。→ deploy-functions.yml に「Write functions env for production」ステップを追加し、
GitHub シークレット **`PROD_FUNCTIONS_ENV`**(ローカル functions/.env と同内容=GOOGLE_DRIVE_* 4キー)を
`functions/.env.komahyouapp-prod` へ書き出す方式にした。**オーナーがこのシークレットを登録し Deploy Cloud Functions
を再実行するまで Drive 同期は無効のまま**(v1.5.431 デプロイ時点で未登録=警告のみ)。

**静音時間帯スキップ(2026-07-10)**: JST 3:15〜8:45 は生成をスキップし取得回数を抑制(9:00復帰)。ただし日次保持
アンカーの AM3:00 だけは静音帯でも取得する(`isWorkspaceAutoBackupSkippedAt`)。手動「今すぐバックアップ」は対象外。

関連: [[komahyou-save-architecture]] / [[komahyou-classroom-restore-cross-contamination]] / [[komahyou-functions-deploy-409-false-status]](デプロイ成否の見かけと実態が乖離する別パターン)
