---
name: komahyou-operation-log-and-lesson-ledger
description: 操作ログ(operationEvents・在庫が減る/記録が消える操作)と生徒授業台帳(lessonLedgerDays・生徒×科目の未消化と実績を日付ごと)の設計・置き場所・読み方・落とし穴(v1.5.487・2026-09-04)
metadata: 
  node_type: memory
  type: project
  originSessionId: 4d1363aa-17c6-4a03-8bb5-ff869b060da0
  modified: 2026-09-04T01:05:36.345Z
---

2026-09-04 オーナー指示で追加した2つの監査記録(v1.5.487 で main マージ・functions は Deploy Cloud Functions ワークフローで反映)。
動機は緑が丘の「未消化が消えた感覚」調査 [[komahyou-midorigaoka-2026-09-04-report-analysis]] で
「15分毎バックアップの前後比較で推測するしかない」限界に当たったこと。

**操作ログ** `classroomSnapshots/{id}/operationEvents/{eventId}`(保持1年・オーナー確定「まず記録だけ・画面表示なし」)
- 対象は在庫が減る/記録が消える操作だけ: makeup-stock-delete / lecture-stock-delete / lesson-delete / lesson-store /
  status-mark(displaced=上書きで消えた前生徒の記録も detail に残す) / status-clear / clear-day-students /
  whole-day-transfer / holiday-toggle / record-displaced(移動の「移)」マーカーが他人の出欠記録を上書き)。
- クライアント `src/utils/operationLog.ts`(モジュールスコープのバッファ・教室キー・`setOperationLogClassroomId` を App が
  actingClassroomId で登録・未登録なら記録しない)→ 保存リクエストに `operationEvents` で相乗り → CF が verified 後に
  バッチ書き込み(実行者 updatedBy と recordedAt はサーバーが付与・イベント id=ドキュメント id で再送重複なし・
  失敗しても保存本体は成功のまま)。ログアウトで `clearOperationEvents()`。
- ★種別一覧は `src/utils/operationLog.ts` と `functions/src/operationEvents.ts` で二重管理。片方だけ足すとサーバーが黙って捨てる
  (両テストに同じ期待配列を固定済み)。★バッファ上限 400 = サーバー1リクエスト上限(超過は黙って切り捨て)。
- 記録は各ハンドラへの手挿入(14箇所)なので、削除系ハンドラを新設したら `recordOperationEvent` を忘れない。

**生徒授業台帳** `classroomSnapshots/{id}/lessonLedgerDays/{YYYY-MM-DD}`(JST 日付・同日は上書き＝その日の最終状態・保持2年)
- `src/utils/studentLessonLedger.ts` が保存のたびに**盤面と同じ関数**(buildMakeupStockEntries / buildLecturePendingItemsByEntryKey・
  同じ生徒キー規則の複製)で生徒×科目の行を作り、指紋が変わったか日付が変わったときだけ `lessonLedger` で相乗り。
  行= makeupBalance / makeupRemaining(`YYYY-MM-DD#限|理由`) / attended / absent / absentNoMakeup / placed(`日付#限|種別|振替元日`)、
  lectureRows(session×subject の pending と元コマ)、totals。実績一覧は直近400日のみ(未消化の元コマ一覧は無制限)。
- サーバー `functions/src/lessonLedger.ts`: 形の検証(壊れていれば null で保存本体だけ通す)・本文 gzip+base64・totals/rowCount は平文。
- 読み方: `node tools/lesson-ledger-report.mjs <classroomId> [--date YYYY-MM-DD] [--student 氏名] [--list] [--json]`(gcloud ログイン済みPC・GETのみ)。
  保存が無い日はドキュメントが無いので「その日以前で最新」を読む。記録は本番反映日から(遡及なし)。
- 容量の目安: 生徒100名規模で圧縮後 50〜100KB/日/教室。

**v1.5.488(2026-09-04・★1〜★3・オーナー確定、月額100円台の見込み)**
- ★1 日次(JST 3:00)バックアップの保持 7日→**400日**(Storage/Firestore は非圧縮のまま・`WORKSPACE_BACKUP_DAILY_THINNED_RETENTION_DAYS`)。
  Google Drive は 15GB 上限のため **gzip(.json.gz・application/gzip・multipart は Buffer 連結)**、旧来の非圧縮 .json だけ 7 日で間引く
  (`shouldKeepGoogleDriveBackupByName`)。復元は教室単位・開発者バックアップの両入口が gzip マジックバイト判定で解凍
  (`src/utils/backupFileText.ts`)。★400日は延長日から積み上がる(遡及なし)。★保持本数の見積りは `src/utils/backupRetentionEstimate.ts`
  (541本)にスペックロック=functions 側の定数と二重管理なので同時に変える(7a9b1e2 と 2026-09-04 の2回ドリフトした)。
- ★2 自動処理の記録 kinds: auto-teacher-reconcile / auto-teacher-assign / auto-student-unassign。教室登録は App の **useLayoutEffect**
  (盤面の起動時 effect より先)。テンプレ再マージ・机詰め直し・生徒側自動割振は未記録(ログに無い≠起きていない)。
- ★3 保存リクエストの `client{appVersion,userAgent}` を saveAttempts / operationEvents に保存(古いキャッシュ版の切り分け)。
- 未実施の候補(オーナー未指示): 大きな状態変更(テンプレ上書き/復元/undo)の記録、クライアント側エラー記録、全操作ログ化、saveAttempts 1年。

**Why:** 「未消化が減った/消えた」問い合わせに、理由(操作ログ)と結果(台帳・コマ単位)の両方で即答するため。

**How to apply:** 問い合わせが来たら まず `--list` で totals の推移→該当日の台帳で生徒の元コマ→operationEvents で理由・実行者、の順。
台帳の数字は「その時点で画面に出ていた値」なので、計算バグがあればそのまま残る(逆に影響範囲の実測に使える)。
盤面側の在庫集計を変えたら台帳も同じ結果になること(同じ関数を呼んでいること)を確認する。Firestore ルールは未変更
(両コレクションはクライアントから読めない・書けない=既定拒否・CF の Admin SDK のみ)。
関連 [[komahyou-save-architecture]] [[komahyou-student-count-ledger]]
