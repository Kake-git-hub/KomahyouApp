---
name: 特別講習「講師専用」(v1.5.685 で実装・開発用教室で先行 → 2026-11-08 v1.5.711 で全教室)
description: 講師の予定だけ集める特別講習。生徒側から全部隠す・期間は重ねない・印は作成時だけ・公開トグルは出さない。判定は isTeacherOnlySpecialSession / selectStudentFacingSpecialSessions。確認リスト to-1/to-2
type: project
---

- 要望: 確認リスト v1.5.672 のフリーメモ(受付 20261103-105053536-c0f31680・対応済みに登録)。
- **オーナー決定(2026-11-03)**: 生徒側から全部隠す。未定義 3 点は AskUserQuestion で確定 = **期間は重ねない(今どおり)**／**チェックは作成時だけ**(既発行の生徒QR問題を作らない)／**講師専用では保護者への公開トグルを出さない**。
- **2026-11-08 全教室へ昇格(v1.5.711)**: オーナー指示「開発・テスト教室だけで動いている機能の 4 件を全教室展開して」(確認リスト to-1/to-2 OK)。フラグ teacherOnlySpecialSession = all-classrooms。回帰で戻さない。
- **v1.5.685 で実装**(フラグ teacherOnlySpecialSession = staging-environment → all-classrooms・作成欄のチェックを出すかだけ)。**隠す処理はデータ `SpecialSessionRow.teacherOnly` で決まりフラグに依らない**。
- 隠す入口(兄弟監査の対象・ここ以外で生徒向けに specialSessions を読む所を足したら selectStudentFacingSpecialSessions を通す):
  scheduleHtml.ts `buildStudentPayload`/`openAllScheduleHtml(all-student)` → `toStudentFacingScheduleParams`(specialSessions と periodBands)・
  App.tsx `ensureScheduleSubmissionTokens`(生徒 0 人)＋`ensureSubmissionTokens`・ScheduleBoardScreen `addableSpecialSessions`・
  lectureStock `buildLectureStockEntries`(生徒授業台帳もこれ経由)・parentSchedule `readLectureSessions`(functions の写しも sync-shared)・Excel 取り込み(印は保持・新規には付けない・講師専用へ生徒入力を取り込まない)。
- 講師側(buildTeacherPayload・印刷用講師日程表・講師の自動配置・黄色)は触らない。
- 仕様 spec-special-session-submission §B-3・spec-parent-portal §0-8 の 8。テスト teacherOnlySpecialSession.test.ts。保護者QRの写しを変えたので Functions のデプロイが要る。
