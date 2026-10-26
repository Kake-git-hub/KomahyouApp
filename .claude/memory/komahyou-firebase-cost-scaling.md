---
name: komahyou-firebase-cost-scaling
description: 2026-09-04 実測に基づく Firebase 原価と30教室スケール試算・料金の主役は書込回数と関数実行時間・日次掃除バッチが Transaction too big で毎日失敗中
metadata:
  type: project
---

2026-09-04 に本番 `komahyouapp-prod` を読み取り専用で実測して出した原価構造。
請求実績は 2026-05-01〜09-30 の5ヶ月で **¥1,239（約¥300/月）**。試算レポート（Artifact）:
https://claude.ai/code/artifact/4ce56ba9-6a9f-4ac3-9db3-8ca0ce451c81

**30教室に増やすと約 ¥7,000/月**（幅 ¥5,500〜9,000・1教室あたり増分 約¥240/月）。
教室数15倍で料金23倍になるのは、いま無料枠がほぼ全部を吸収しているため。

**料金の主役は容量ではなく「書込回数」と「関数実行時間」**（30教室で ¥2,800 + ¥2,400 = 合計の75%）。
バックアップJSONを gzip 化しても 212GB→8.8GB で ¥700/月 しか下がらない。
効くのは「保存のたびに約500文書（parts 145 + boardWeeks 350）を書き直す」設計を差分書込にすること。

**実測値（2026-08-05〜09-04・2教室運用時）**: Firestore 書込 818,651/月・読取 523,029/月・
保存容量 4.27GB / Cloud Run 64,098インスタンス秒・19,012リクエスト /
Storage 56.8GB（自動バックアップ6.14GB + 復元前バックアップ46.8GB + ロールバック3MB）/
バックアップ1本 54.3MB（整形）= 24.1MB（最小化）= 2.25MB（gzip）。

**修正済み（v1.5.489・2026-09-04 本番反映・実測で効果確認）**:
1. **`cleanupOldSaveAttempts` が毎晩失敗**（`3 INVALID_ARGUMENT: Transaction too big`）。
   `SAVE_ATTEMPT_CLEANUP_BATCH_LIMIT = 300` だが saveAttempts 1件が最大1MB（`snapshot.compressedData` を持つ）で
   Firestore の 10MB トランザクション上限を超える。結果 30日保持が効かず 2026-05-30 分から 17,519件 残存。
   最初の教室で例外死するので operationEvents / lessonLedgerDays の掃除にも到達していない。
   直すならバッチ件数を 10〜20 程度へ下げる（件数でなくバイト数で切るのが本筋）。
2. **Storage のバックアップだけ非圧縮**（`JSON.stringify(snapshot, null, 2)` で2.26倍）。Drive 側は gzip 済みで非対称。
3. **`workspace-incident-backups/` に自動削除が無い**。2026年5月の3,943本＝46.8GB が残置され、
   現 Cloud Storage 請求 ¥542 のほぼ全額。教室数と無関係に消せる。

**v1.5.489 の実測結果（手動トリガーで検証済み）**: saveAttempts 12,943件削除（17,519→4,576＝30日以内のみ）/
incident backups 3,963件 46.31GB 削除（50.2GB→0.45GB）/ バックアップ1本 56.9MB→25.2MB。
ログは INFO（＝予算内で完走・滞留ゼロ）。以前は毎晩 ERROR で3ヶ月停滞していた。
⚠️ バケットは**ソフト削除7日**が有効なので、容量課金が下がるのは削除の7日後（9/11頃）。

**設計上の要点（消さないこと）**: ①個別 delete（WriteBatch へ戻すと再発）②削除クエリの `.select()`
（外すと 200件×最大1MiB で memory:512MiB が OOM＝エラー名が変わっただけの停滞）③incident 間引きは
Firestore 巡回より**先**＋**独立した時間予算**（後ろ＆共有だと毎晩1ページ目に戻り永久に減らない）
④予算打ち切り時は `logger.error`（3ヶ月気づかなかった再発検知）。ループ本体は
`runBudgetedDeletionSweep`（I/O 注入式）でユニットから直接動かせる＝「純粋関数だけでループ未被覆」が
テストで防げなかった構造要因だった。

**未修正の発見（残り）**:
1. Google Drive ミラーは30教室で約7GB（15GB上限の半分）。
2. `createWorkspaceServerQuarterHourlyBackups` はタイムアウト300秒・メモリ1GiB。30教室では180MBのJSONを扱うので不足の見込み。
3. 開発者アカウントのみ起動時に全教室を読む（30教室で1回約15,000読取）。室長アカウントは自教室のみで問題なし。
4. Storage のバックアップを gzip 化すれば 212GB→8.8GB（月約¥700）だが、復元の読み出し経路に触るので未実施
   （最小化だけで 2.26倍ぶんは回収済み）。

読取専用の調査手段: Cloud Monitoring API（`firestore.googleapis.com/document/*_count`,
`storage/data_and_index_storage_bytes`, `run.googleapis.com/container/billable_instance_time`）、
Firestore REST の `runAggregationQuery`（文書数）、`gcloud storage du -s`、`gcloud logging read`。
gcloud / firebase CLI はこの端末で `オーナーの Google アカウント` としてログイン済み。

関連: [[komahyou-backup-3tier-and-scheduler-role]] [[komahyou-operation-log-and-lesson-ledger]] [[komahyou-save-architecture]]
