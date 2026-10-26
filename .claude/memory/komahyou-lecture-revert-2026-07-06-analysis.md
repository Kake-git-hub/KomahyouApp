---
name: komahyou-lecture-revert-2026-07-06-analysis
description: 7/6講習巻き戻り障害の実データ解析結果 — A4は当該障害の経路ではない(発行ゼロ)・初回評価誤除去/A3が有力・saveAttemptsが鑑識ログとして有効
metadata: 
  node_type: memory
  type: project
  originSessionId: bc341b62-1adf-431f-bc72-086112d27de3
---

2026-07-06 15:25 報告の講習巻き戻り障害（日大前校・自動割振→手動移動→数分後リセット）を
本番データで解析した結果（2026-07-07 実施・正本 `docs/analysis-qr-submitted-at-2026-07-06.md`）:

- **A4（トークン発行競合）は当該障害の発火経路ではない**。7/6 は全教室でトークン発行ゼロ
  （lectureSubmissions createdAt 直近: 日大前 6/30・緑が丘 6/27・薬円台 6/5）。全履歴クロス照合
  （発行±10秒に別人提出）も 0 件。A4 修正は「実発火が確認されていない防御的修正」と位置づける。
- **最有力は A3（stale 書き戻し・a0dba9f）**（2026-07-07 確定度更新）。被害生徒は
  15:18:28 に提出した本人（提出済み・取り消しなし）とオーナー確認。初回評価誤除去(9bafd01)は
  未提出生徒の配置しか外せないため本件の主因ではない。リセット保存 v1615 は被害生徒の
  提出到着1秒前の v1611 とほぼ同一サイズ（差1バイト）＝「提出→割振→移動の約5分が古い状態で
  上書き」という A3 署名に一致（盤面だけ戻り提出データは残るので残数が満数復活）。
  v1.5.396 で修正済み（7/6 21:36 JST 反映）。実地実証は修正後の次回講習割振操作待ち。
- **鑑識手法**: `workspaces/main/classroomSnapshots/{classroomId}/saveAttempts`（保持約30日）の
  snapshotVersion / createdAt(サーバー) / savedAt(クライアント) / dataByteLength / payloadHash で、
  盤面の増減（割振=+数KB〜13KB・リセット=同量減）・端末プロファイル（時計スキュー）・
  完全巻き戻り（hash一致）を判別できる。gcloud（オーナーの Google アカウント 認証済み）+ Firestore REST
  runQuery で読み取り専用照合可。
- `deleteLectureSubmissionDoc` は呼び出し元ゼロの死蔵（docは消えない前提で解析してよい）。
- **後続対応（2026-07-07・v1.5.405）**: A3 の温床だった「保存し忘れ救済」（起動時の未保存ローカル
  書き戻し）をオーナー決定で完全撤去。起動時は常にサーバー最新が正。[[komahyou-save-architecture]]
- handoff タスク2（講習集計結果へのQR提出時刻表示・submittedAt の studentInputs 搬送3経路）は
  未着手。仕様確定から（`docs/handoff-qr-submitted-at.md`）。

関連: [[komahyou-submission-board-persistence-asymmetry]] [[komahyou-lecture-stock-subject-selection]]
[[komahyou-save-architecture]]
