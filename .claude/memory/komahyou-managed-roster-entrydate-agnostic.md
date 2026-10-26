---
name: komahyou-managed-roster-entrydate-agnostic
description: 管理データ画面の在籍表示は入塾日不問(未来入塾も在籍)・退塾日当日在籍/翌日非在籍・高3卒業は退塾日自動補完。盤面/請求の共有判定は従来どおりで管理画面限定
metadata: 
  node_type: memory
  type: project
  originSessionId: f831c53e-a461-4af6-9f61-2fbbef2f3a2d
---

管理データ画面(BasicDataScreen)の名簿表示だけ、在籍判定から入塾日を外した(オーナー指示 2026-07-10・feature/managed-roster-entrydate-agnostic・commit 25753a4)。

**管理画面の在籍ルール(`resolveManagedRosterStatus`)**:
- 入塾日は在籍判定に使わない = 入塾日が未来でも「在籍」として名簿に出す。学年ラベルも生年月日から算出('入塾前' にしない)。
- 退塾日「当日」は在籍・翌日以降が非在籍(strictly after `referenceDate > effectiveWithdraw`)。
- 高3卒業は卒業日(高3学年度末=翌3/31=`(enrollmentYear+12)-03-31`)を退塾日として自動補完し非在籍化(`resolveEffectiveManagedWithdrawDate`)。明示退塾日があれば優先。**表示上の補完のみでFirestore自動書込はしない**([[komahyou-save-architecture]] の起動時書き戻し禁止を尊重)。オーナーが実データ書込を望めば要再確認。

**⚠️ 共有判定は変更禁止(この分岐は管理画面限定)**: `isActiveOnDate` / `resolveScheduledStatus` / `resolveTeacherRosterStatus` / `resolveCurrentStudentGradeLabel` / `hasGraduatedHighSchool` は無改変で、盤面/請求/日程表/自動割振は従来どおり入塾日前・高3卒業を非在籍のまま維持(未来入塾を入塾日前から盤面に先行表示しない)。将来これらを「統一」して入塾日不問を共有側へ波及させると回帰。basicDataModel.test.ts に共有 `isActiveOnDate` ロックテストを追加済み(統一しようとすると落ちる)。

講師は birthDate 空のため卒業補完はスキップ=明示退塾日のみ効く。正本は docs/spec-basic-data.md §B/§C。[[komahyou-clarify-before-proceeding]](ユーザビリティ影響で着手前にQ&A実施済み)。
