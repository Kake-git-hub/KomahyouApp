---
name: komahyou-submission-board-persistence-asymmetry
description: QR提出の反映漏れの真因=countSubmittedは自動同期で永続化だが盤面配置は手動保存のみの非対称・起動時reconcileで自己修復
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35f969-a19c-40d4-874e-bac1fe2ea767
---

講師/生徒のQR提出を盤面へ反映する機能の根深い罠（2026-06-30・v1.5.357で対処）。

**保存タイミングが非対称**:
- `countSubmitted`（提出反映フラグ。`specialSessions` 内）は**手動保存しなくても** workspace 自動同期（App.tsx の visibility-hidden / localStorage sync）で永続化される。
- 一方、QR提出による**盤面への講師名配置（boardState の weeks/desks）は手動保存（Cloud Function snapshot）でしか永続化されない**。

**起きた不具合**: 取り込み（App.tsx onSubmitted, `subscribeLectureSubmissions`）は `if (existing?.countSubmitted) return` で登録済みをスキップする。手動保存前にリロードすると盤面配置だけ揮発し、countSubmitted=true は残るため、以後は取り込みでスキップされ二度と自動配置されず「提出したのに出席可能コマに名前が出ない」状態でスタック。講師日程表から登録し直す（解除→再登録、ガードを通らない）と入る。

**対処**: 起動時の自己修復。盤面は `boardMountKey` で教室ロード/リロード毎に再マウントされ specialSessions と weeks が確定値で揃う。マウントで1回 `reconcileSubmittedTeacherPlacements`（ScheduleBoardScreen.tsx・純関数）が「countSubmitted=true なのに schedule-registration 配置が盤面に無い講師」だけを冪等に配置し直す。既に一部でも配置済みの講師は触らない（手動調整/部分削除を尊重）。全コマ外したい場合は登録解除で対応する設計と整合。

**教訓**: 「提出をキャプチャして1回反映する」だけの設計は、反映先（盤面）と反映フラグ（countSubmitted）の永続化経路が違うと取りこぼす。反映漏れ系は capture だけでなく**ロード時の reconcile（あるべき状態への収束）**で守る。

**自動配置の性質メモ**: `autoAssignTeacherToSpecialSession` はコマ（セル）ごと独立。満席の4限は4限だけスキップし、空きのある1限には配置する（時限間で波及しない）。机が満席のコマだけ講師名を載せない。

関連: [[komahyou-save-architecture]] [[komahyou-group-participation-save-paths]] [[komahyou-tests-required-for-changes]]
