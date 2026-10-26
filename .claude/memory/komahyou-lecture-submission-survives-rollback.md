---
name: komahyou-lecture-submission-survives-rollback
description: QR講習提出はlectureSubmissions独立コレクションに保持されロールバックでも消えないのが正・登録解除だけが消去経路・購読はclassroomId分離
metadata: 
  node_type: memory
  type: project
  originSessionId: 132264e1-9f51-4037-b33d-3b4a9fec5daa
---

QR講習提出の実体は `lectureSubmissions`(トークン単位・`classroomId`/`status` フィールド付きの独立 Firestore コレクション)にあり、**教室スナップショットのバックアップ/復元/ロールバックの対象外**。`functions/src/index.ts` で復元系はこのコレクションに一切触れない(触れるのは提出ページ REST API のみ)。

**この「復元しても提出が生き残る」挙動はバグではなく確定仕様**(オーナー確認 2026-07-07)。要件=「生徒が一度QR提出したら恒久保持。室長が盤面都合でバックアップ復元しても生徒提出は残す。消えるのは明示的な"登録解除"だけ」。したがって「復元時に lectureSubmissions を整合させて消す/pending に戻す」対策は**入れてはいけない**(再提出を強いる誤修正)。

再反映の仕組み: 起動/復元後、`subscribeLectureSubmissions(actingClassroomId, status=submitted)` が提出を配信 → [App.tsx:3886](src/App.tsx) の反映は `existing.countSubmitted===false` のときだけ `subjectSlots`/`countSubmitted=true` を再適用。通常運用では提出→反映→室長保存で snapshot 側も countSubmitted=true になり一致するため不可視。**提出より前の時点へロールバックしたとき**だけ snapshot 側 false ↔ doc 側 submitted の不一致で再適用が表面化する(=消したはずの回数が復活=要件通りの望ましい挙動)。

安全性: 購読は `classroomId` で絞る([lectureSubmission.ts:384](src/integrations/firebase/lectureSubmission.ts))ので**教室をまたいで提出が漏れることはない**。開発用教室のテスト提出(例: 生徒Q 数学200)も `classroomId=開発用教室` なので本番へ流れず、開発用教室の該当 doc を手で消せば済む(本番欠陥ではない)。

**Why:** この設計は将来うっかり「整合修正」でロールバック時に提出を消す方向へ巻き戻しやすい論点。巻き戻すと生徒に再提出を強いる回帰になる。

**How to apply:** 復元/ロールバック処理に「lectureSubmissions を snapshot に合わせて消す/リセットする」を足さない。提出の消去経路は `resetLectureSubmissionDoc`(登録解除 `countSubmitted=false` 経路 [App.tsx:3651])だけに保つ。

現状のままで良いと確認済みの際どい2点(仕様変更不要): (1)室長が登録解除でなく手動で回数変更しても提出 doc の `subjectSlots` は書き戻されない(`markLectureSubmissionDocAsSubmitted` は subjectSlots を触らず既 submitted なら早期return)→ロールバック後は室長手修正が消え生徒の元提出値が復活。(2)提出済み生徒を名簿削除すると孤立 doc が再生成され得る(削除時に doc も消していれば問題なし)。

関連: [[komahyou-submission-board-persistence-asymmetry]] [[komahyou-group-participation-save-paths]] [[komahyou-classroom-restore-cross-contamination]]
