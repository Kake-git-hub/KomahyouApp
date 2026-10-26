---
name: komahyou-external-student-flag
description: 外部生チェックは「盤面の表示だけ」を外)に置き換える仕様(集計・在庫は不変・日程表は対象外)。振替の授業時間も同時に解禁
metadata: 
  node_type: memory
  type: project
  originSessionId: 7d7e3180-e094-4eec-973c-b53d9a3f436c
  modified: 2026-07-31T16:48:49.135Z
---

コマ表アプリの「外部生」チェック(生徒基本データ)は **v1.5.460(2026-08-01 本番反映)** で追加。
オーナー要望「外部生の授業は全部 外) と表示したい」に対する確定仕様。

**外部生は表示専用フラグ(最重要)**
- `StudentRow.isExternal`(optional・未設定=通常生徒)。判定は権威関数 `isExternalStudentRow` に一本化し、
  `row.isExternal` を直読みしない。
- 盤面(BoardGrid)の授業区分プレフィックスだけを 通)/振)/講)/増)/体) → **外)** に置き換える。
  **`StudentEntry.lessonType` の実データは書き換えない**(オーナー判断 2026-08-01)。
  → 振替在庫・講習ストック・コマ数集計・自動割振は**従来どおり計上**する。
  ⚠️ ここを「実データの授業区分を外部生用の値に変える」実装へ寄せると [[komahyou-lecture-stock-clear-status-wipe]] や
  INV-06(在庫整合)まで巻き込む。将来「外部生は集計から外したい」と言われたら**別作業として切り出す**。
- 盤面セルは生徒名しか持たないため、登録名・表示名の両方で引ける `managedStudentByAnyName` 経由で解決する
  (体験生・メモなど名簿外の名前は常に通常表示)。保存不要で名簿変更が即反映される。

**反映範囲: 盤面＋配布用盤面(共有URL)**
- 生徒日程表・講師日程表(印刷)は従来表記のまま(オーナー選択)。生徒日程表は保護者に渡す紙なので意図的に除外。
- **配布用盤面は v1.5.461(2026-08-01)で対応済み**。共有ドキュメントに `externalStudentIds`
  (外部生の managedStudentId 一覧・名簿そのものは載せない)を持たせ、共有画面は
  `isExternalBoardShareStudent` で突き合わせる。旧ドキュメント(未設定)は空集合＝全員通常表示。
  ⚠️ **公開署名 `lastPublishedBoardShareSignatureRef` にも externalStudentIds を含める**
  (外すとチェックの付け外しで署名が変わらず publish がスキップされ配布用だけ旧表記で残る)。
  ⚠️ 外部生チェックは盤面を編集しないので `handleBoardStateChange` 経由の公開が走らない。専用の
  追い公開 effect があるが、**「教室が切り替わった直後は公開しない」ガードを消してはいけない**
  (切替中は actingClassroomId が先に新教室へ変わり boardState/名簿が旧教室のまま残る窓があり、
  そこで公開すると旧教室の盤面を新教室のトークンで配布する＝[[komahyou-classroom-restore-cross-contamination]] と同じ形)。

**同時に入れた別件: 振替(makeup)の授業時間(90/60/45分)**
- 従来は通常・増コマ・講習だけ。振替も**追加メニューと編集メニューの両方**で選べる(オーナー選択)。
- 対象区分は `LESSON_TYPES_WITH_MINUTES` と権威関数 `resolveLessonMinutesNoteSuffix`(src/components/schedule-board/mockData.ts)へ集約。
  追加/編集の2つの保存経路が同じ関数を通る。**片方だけ広げると保存時に分数が落ちる**。

**検証**: `npm run dev -- --mode local`(launch.json の `dev-local`・VITE_EXTERNAL_BACKEND_MODE=local)で
本番 Firebase に触れずローカルセッションのダミー教室を操作できる。本番ログインが不要なので実機確認に使える。
