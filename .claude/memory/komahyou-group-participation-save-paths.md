---
name: komahyou-group-participation-save-paths
description: 集団参加の保存は2経路(QR購読 / 生徒日程表の登録メッセージ)・後者のハンドラ反映漏れで出席者一覧に出ない回帰
metadata: 
  node_type: memory
  type: project
  originSessionId: e4c4cfd8-29d1-4903-9ce5-6241c0f876f8
---

集団授業の「参加」(`SpecialSessionStudentInput.groupClassParticipation`)が `specialSessions` state に入る経路は2つあり、両方を保守すること。出席者一覧モーダル(`GroupAttendanceModal`)の名簿は `resolveGroupClassParticipation` で state から作られるので、state に入らないと一覧に出ない。

1. **QR提出経路**: SubmissionPage → Cloud Function → 提出ドキュメント → App.tsx の購読反映 (`entry.groupClassParticipation ?? existing ?? {}`)。
2. **生徒日程表の登録経路(室長)**: scheduleHtml 埋め込みJS の「登録」ボタン → `persistStudentCount(..., groupParticipation)` → `schedule-student-count-save` メッセージ → App.tsx ハンドラ。

**Why:** Phase 7(2026-06-16)で集団参加の専用「保存」ボタン(`schedule-student-group-save`)を廃止し、埋め込みJS側は「登録」ボタン=`schedule-student-count-save` に `groupClassParticipation` を載せるよう変えた。しかし App.tsx の同ハンドラは更新されず、常に `previousInput?.groupClassParticipation ?? {}` で既存保全=メッセージを無視していた。結果、QR以外(室長が生徒日程表で集団登録)で参加させても出席者一覧に出ない不具合(2026-06-24 修正・v1.5.318)。QRは別経路で動くので気付きにくい。

**How to apply:** 集団参加の保存・読込をいじるときは2経路とも追う。`schedule-student-count-save` ハンドラは `resolveSavedGroupClassParticipation(message.groupClassParticipation, previous)`(指定時は既知科目のみ採用・未指定=unsubmit等は既存保全)で反映する。回帰テストは specialSessionModel.test.ts。死蔵の `schedule-student-group-save` ハンドラは残置(scheduleHtml は送らない)。[[komahyou-group-lesson-feature]] [[komahyou-no-regression-rule]]

**追記(2026-06-26・オプション欄でも同型バグ・v1.5.328修正):** QR購読経路(経路1 `onSubmitted`)には別の落とし穴があった。生徒が既に `countSubmitted=true` だと `if (existing?.countSubmitted) return session` で**届いた提出を丸ごとスキップ**し、保護者所有フィールド(`optionChecks`/`groupClassParticipation`)の更新を握りつぶす。結果、室長ローカルが古いまま手動保存→Cloud Function がスナップショットへ統合した正しい提出値を**空で上書き消失**(本番 生徒s085 のQR optionChecks {0,1}→{} で確認)。修正: 登録済みでも保護者所有2フィールドだけは最新提出値を反映する純関数 `reflectParentOwnedSubmissionFields`(`src/utils/submissionReflection.ts`)を `onSubmitted` から使用(回数・配置は再実行しない)。再読込時の初回購読で過去消失分も自己修復。QR提出の取り込みは [[komahyou-functions-deploy-409-false-status]] のとおり関数デプロイが実反映されていることが前提。

**追記(2026-06-27・上記修正に潜んだ消失バグ・本番データ消失・v1.5.336で恒久修正):** v1.5.328 で入れた `reflectParentOwnedSubmissionFields` 自体が**空 doc で既存を上書き消失させる**逆向きの罠を持っていた。購読 entry は `subscribeLectureSubmissions` で常に `data.groupClassParticipation ?? {}`(=空でも `{}` 定義済み)で届くため、関数内の `entry.x ?? existing.x ?? {}` の「欠落時 existing 保全」が**効かない**(`{}` は nullish でない)。結果、v1.5.335 以前に室長が日程表で登録した中3は提出 doc が空 `{}` のまま残っており、**起動直後の初回スナップショット反映で登録済みローカルの集団参加を一括 `{}` に消去**。本番で緑が丘5名・日大前2名が同一 updatedAt(=1回の `setSpecialSessions` 反映)で集団理科/集団社会とも消失を確認(直近3日のStorageバックアップ `workspace-auto-backups/main/hourly/*.json` を gcloud で読み比較して特定)。**恒久修正**: 反映を **union(追加のみ・削減しない)** に変更(`unionTrueKeys`)。この経路は `countSubmitted=true`(提出ロック済み)の生徒にだけ走り保護者が QR で外すことは起こり得ないため union で安全、かつ空 doc が既存を消さず v1.5.335 以前の doc も**再登録不要で自己修復**。回帰テスト `submissionReflection.test.ts`(空 doc は既存を消さない/union で足す)。**教訓**: 「最新提出を反映」系は必ず union/no-shrink で実装し、空ペイロードに削除の意味を持たせない(購読は空でも定義済みで届く)。なお同日先行の v1.5.335 は書き込み側(`markLectureSubmissionDocAsSubmitted` が登録時に doc へ書き戻し)を直したが、既存空 doc は自己修復しない別修正で、本 union 修正と相補。
