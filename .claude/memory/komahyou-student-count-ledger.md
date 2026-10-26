---
name: komahyou-student-count-ledger
description: 請求の在籍生徒数は毎月15日にサーバーが恒久記録する台帳(write-once)が正・Firestoreルールは CI 非対象で別途デプロイ必須
metadata: 
  node_type: memory
  type: project
  originSessionId: eee979a1-f7ce-47d4-bf4d-6c58230e3600
  modified: 2026-08-08T11:19:32.092Z
---

請求画面の在籍生徒数は、**毎月15日 0:00(JST)時点をサーバーが恒久記録した台帳**が正本。v1.5.477 本番反映(2026-08-08・オーナー指示)。

- 台帳パス: `workspaces/{key}/studentCountLedger/{YYYY-MM-DD}` ＋ サブコレクション `classrooms/{classroomId}`(人数＋内訳の生徒ID)。
- 書くのはスケジュール関数 `recordMonthlyStudentCounts`(`10 0 15 * *` / Asia/Tokyo)と手動 callable `triggerMonthlyStudentCountRecord`(開発者のみ)。
- **write-once**: 既存記録があれば `batch.create` がコミットごと失敗して上書きしない。ルールもクライアントは read のみ・`write: false`。これを set(merge) や write 許可に緩めると恒久記録が壊れる。
- 画面は `resolveBillingStudentCount` で「台帳 > ライブ計算」。台帳が無い日付は `暫定` バッジで参考値と明示する。
- **過去は遡れない**(自動バックアップの保持は最長7日)。最初の自動記録は 2026-08-15。それ以前の月は暫定表示のまま。
- 記録は**完全にサーバー側**(Cloud Scheduler が関数URLへ OIDC 付き POST)。アプリを開く必要もボタンも不要。
  15日を待たずに配線を確かめたいときは `gcloud scheduler jobs run <job>` で1回起動する。15日以外の日は
  関数が「15日ではない」と判定して**書き込み前に return する**ので安全な疎通試験になる(2026-08-08 に実施し
  `Unexpected run date (skipped): 2026-08-08` を確認済み＝JST変換も実環境で正しい)。
- **未来日は記録禁止**(v1.5.478 で追加)。write-once と「既定の集計日＝当月15日」の組み合わせで、月の前半に手動記録すると
  15日の定期実行がスキップし本当の15日時点が永久に残らなくなる。サーバー/画面の両方でガード済み。**このガードを外さない**。
- 在籍判定は `functions/src/monthlyStudentCount.ts` がクライアント権威関数(`isActiveOnDate` / `hasGraduatedHighSchool`)の**鏡像**。Date の組み立て方まで写して TZ 差でズレないようにしてある。パリティテストが片側だけの変更を検出する。
- 既存ガード「保存済み `billingMonths.studentCount` は表示に使わない」は今も有効。台帳はその復活ではない([[komahyou-no-regression-rule]])。

## ⚠️ Firestore ルールは main マージでは反映されない

`deploy-firebase-hosting.yml` は **hosting のみ**。ルール変更は別途
`npx firebase-tools deploy --project komahyouapp-prod --only firestore:rules` が要る。
今回これに気付かずマージし、機能が半分死ぬ寸前だった(読めないと画面は暫定表示へフォールバック)。
**ルールを触った変更は、リリース後に必ずこのコマンドを別で実行する**。
反映確認は firebaserules API(`x-goog-user-project: komahyouapp-prod` ヘッダが要る)で ruleset の中身を GET。

## CLAUDE.md の記述と実機の食い違い

CLAUDE.md は「Claude の実行サンドボックスには Firebase 認証情報が無いので `firebase deploy` を直接実行できない」と書いているが、
**このPCでは firebase-tools が オーナーの Google アカウント でログイン済み**(`firebase login:list` で確認)で、gcloud も同アカウント。
実際にルールデプロイを実行できた。CLAUDE.md の当該記述は古い。

関連: [[komahyou-save-architecture]] / [[komahyou-functions-deploy-409-false-status]]
