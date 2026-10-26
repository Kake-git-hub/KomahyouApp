---
name: komahyou-schedule-count-desired-semantics
description: 生徒日程表「通常回数(予定数)／講習回数(希望数)」の会計体系と、希望数の正本が2系統ある罠（v1.5.468）
metadata: 
  node_type: memory
  type: project
  originSessionId: 9607abce-e394-4290-98ab-09d44fb692da
  modified: 2026-08-04T15:34:10.784Z
---

生徒日程表の回数表は各科目行が「**実績(括弧内)**」表示。括弧と赤い警告スタンプは**画面のみ**
(`print-only-hidden`)で、印刷して保護者に渡る紙には実績しか載らない。

**括弧の出どころは通常と講習で別物**（2026-08-05 オーナー確定で呼称を分離）:
- **通常＝「予定数」** … 基本データ/テンプレ由来 `expectedRegularOccurrences`（提出とは無関係）
- **講習＝「希望数」** … QR提出/室長登録の `subjectSlots`（「通常のみ」は0）
- 警告文も `予定数と一致していません！` / `希望数と一致していません！` に分離した。

## ★希望数を減らす正本は2系統ある（二重減算の罠・v1.5.468 で修正）

在庫由来(session)講習の**単発削除**が `subjectSlots` −1 と表示調整 `scheduleCountAdjustments` −1 の
**両方**を積み、1回の削除で希望数が2減っていた（確認ダイアログは「1減ります」と言う）。
`74c830d` で subjectSlots −1 を足したとき、旧経路の表示調整 −1 を外し忘れたのが真因。
**排他を `resolveDeletedStudentCountAdjustments` / `isSessionLectureDeletion` に固定した。ほどくと即再発**。

- 在庫由来(session)の講習 → `subjectSlots` **だけ** 減らす
- それ以外 → `scheduleCountAdjustments` **だけ** 積む
- 「その日の生徒を全コマ削除」「丸ごと振替」は在庫へ**返す**経路なので**どちらも減らさない**
  （INV-06「返す＝別日にやる／返さない＝もうやらない」。`decrementSpecialSessionSubjectCount` を呼ぶのは単発削除だけ）

## 手動追加コマは全種別で予定/希望側 +1（v1.5.468 で対称化）

以前は**講習だけ** +1 で、増コマ・手動追加の通常/振替は実績だけ増えて警告が出っぱなしだった。
数える条件は実績側と厳密に対称にする: 体験(trial)除外 ／ **`studentSlots` と `statusSlots` の両走査**
（出欠を付けるとコマは statusSlots へ**移る**ので片走査だと出席の瞬間に +1 が消える。[[komahyou-lecture-stock-clear-status-wipe]] と同型）
／ `absent`・`moved` は除外（`absent-no-makeup`＝振無休は**数える**）。

## 実データの注意（2026-08-05 読み取り専用実測）

修正は**今後の削除にしか効かず、過去に積まれた調整は遡って直らない**。本番の
`boardState.scheduleCountAdjustments` に `countKind='special'` の負エントリが
**日大前22件/8名・緑が丘2件/2名・薬円台0件**残存（夏期講習期間に効いている）。
症状は2通り: ①提出より小さい希望数（例 実績3/希望1で警告）②調整が提出を食い潰し0以下になると
**行ごと消えて「希望=実績」に化け警告も出ない**（`applyCountAdjustments` が0以下を delete するため）。
実測は `gcloud auth print-access-token` + Firestore REST GET →
`classroomSnapshots/{id}.compressedData` を gunzip+base64 で解凍（chunks 分割形式もあり）。

関連: [[komahyou-lecture-stock-subject-selection]] / [[komahyou-invariant-registry-plan]]（INV-05 は今回で
two-strike 到達＝強制昇格候補・昇格はオーナー承認待ち）

## ★希望数は「セッション総数」、実績は「表示期間内」（期間の非対称・Issue #61 で顕在化 2026-09-07）

`buildDesiredLectureCountMap` は**表示期間に重なるセッションの `subjectSlots` を丸ごと**足す。実績は範囲内の配置だけ。
同一セッションの講習を期間外（9月）へ置くと、夏期の紙は「13(15)」で残2に見えるが実は9月に組み済み。
逆に9月の紙は夏期セッションが重ならず希望が無い → `toCountRows` が **実績にフォールバックして「2(2)」＝警告も出ない**。
「残り〇回」は表示範囲の cells からは出せない（`cells` は範囲限定）。出すなら `outstandingAbsences` と同型で
**盤面全体から算出した値を payload に渡す**必要がある。
右括弧は「提出値」ではなく「提出 ＋ 手動追加 − 削除」＝運用上の予定総数なので、保護者向け印字の語は「希望」でなく「予定/全〇回」が正確。
実測（緑が丘 s041 夏期 英15/数15/国15）: 期間内 13/14/13、9月に 1/1/2、未配置 英1、台帳 −14/−15/−15（整合）。
台帳には希望0の 理/社 に −10 の残滓あり（帳簿は独立に食い違い得る）。special の −1 調整残存は緑が丘2件（s031 数 7/25・s095 算 7/23）。

## 講習の右括弧は印刷にも載る（v1.5.497・2026-09-07・Issue #61）

生徒シートの講習回数表だけ `toCountRows` の `printDesired` で右括弧を印字（見出しは画面「(希望数)」／紙「(予定)」＝
`print-only-visible`）。印字は **desiredCountMap に実在する個別科目のみ**（フォールバック行・集団・通常の予定数・講師シートは画面のみ）。
オーナー確定: A案（括弧そのまま）・常時全教室・集団は含めない。「残り〇回」印字は未実装（盤面全体走査の payload が要る）。
