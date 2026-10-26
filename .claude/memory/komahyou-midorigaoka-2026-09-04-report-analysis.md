---
name: komahyou-midorigaoka-2026-09-04-report-analysis
description: 緑が丘 室長報告(2026-09-04)「出席にしたら元コマの振替日が消える」「未消化に入れた生徒が消えてる感覚」の調査結果と読み取り専用の実データ調査手順
metadata: 
  node_type: memory
  type: project
  originSessionId: 4d1363aa-17c6-4a03-8bb5-ff869b060da0
  modified: 2026-09-03T23:05:18.230Z
---

2026-09-04 緑が丘校 室長からの2件の報告を調査した(コード＋本番15分毎バックアップ 8/29〜9/3 の44時点・読み取りのみ)。

**報告1「休みの振替を他の日に入れて出席にしたら元コマの振替日が消える」＝表示バグ(仕様ではない)。**
真因は `src/components/schedule-board/lessonLinks.ts` の `buildLinkedLessonDestinationMap` が振替先を
`desk.lesson.studentSlots`(未出欠の配置)だけから集め、`statusSlots`(出席/振無休で移った記録)を見ないこと。
出席にした瞬間に振替コマは studentSlots→statusSlots へ移るので、元コマ「休」の隣に出ていた振替先日付
(`resolveVisibleSlotDateLabel` の linkedDestination)が消える。盤面(BoardGrid)と日程表(scheduleHtml の
`formatAbsenceNote` の「→ 日付」)は同じ関数を使うので両方で消える(経路一致=INV-04 違反ではない)。
在庫会計(`collectMakeupUsageByKey`)は attended の振替を消化として数えるので、**残数は正しく表示だけ欠ける**。
実データ(2026-09-03 時点)では 休み記録18件中、振替配置済み5件はリンクあり／出席済み振替13件は全部リンク無し。
**修正済み＝v1.5.486(2026-09-04 本番反映・オーナー指示)**: 同関数の振替先収集に `statusSlots` の attended /
absent-no-makeup を追加(moved・absent は除外のまま)。回帰テスト4件(lessonLinks.test.ts・修正なしで2件落ち)。
staging 実機は省略(純関数＋実データ検証で代替)。cc5e5e8(2026-05-29)導入時からの欠落で、後の変更で巻き戻ったものではない。

**報告2「未消化に入れた生徒がかなり消えてる」＝台帳レベルの消失は 8/29〜9/3 のデータでは確認できず。**
未消化振替の残数減少はすべて「振替配置(消化)」か「一覧の×削除(生徒F 算 5/6・8/19 の2件・確認ダイアログ付き)」で説明でき、
講習の休みも未消化講習へ戻っていた(生徒G/生徒H/生徒I/生徒J)。保存は全件1端末(単一 member・楽観ロック競合なし)。
「消えた感覚」の出どころとして確認できた事実:
- 上記の表示バグ(出席にすると元コマの振替日が消える＝振替が無くなったように見える)。
- **席の再利用で「休」記録が上書き消滅**: 休み記録(absent)がある席の同じ index に別生徒(講習生)が配置され
  出席にされると `setDeskStudentStatus` が statusSlots[index] を上書きし、前の生徒の「休」が盤面・日程表から消える
  (8/29 生徒K→生徒L、8/31 生徒M→生徒N、8/31 生徒O→生徒P。3件とも振替は消化済みで在庫損失なし)。
  仕様(spec-makeup-stock §1-B「欠席表示で残す・席はロックしない」)と実装のギャップ。配置時点で表示が隠れ、出席で永久に消える。
  データモデル(statusSlots が studentSlots と index 並列の2枠)の制約なので、直すなら妥協案提示が必要(未着手)。
- 8/29 以前(v1.5.481 の Issue #57 修正前)は上書きで移動由来振替の算出 origin が本当に消えていたので、その名残の可能性。

**Why:** 報告の「消えた」は在庫ではなく表示(リンク・休記録)の消失だった。在庫会計(INV-06)は健全。

**How to apply:** 「未消化が消えた」報告は、まず台帳(残数)と表示(リンク・休記録)を分けて検証する。
実データ調査は [[komahyou-teacher-template-remerge-instability]] の手順(15分毎バックアップ)＋以下の罠:
`gcloud storage cp` で `workspace-auto-backups/main/15min/*.json`(各57MB・JSTキー・7日分)を落とし教室を抜く→
vitest 一時プローブで `applyClassroomAvailability`→`buildMakeupStockEntries`(today固定)。**在庫キーは `sNNN__科目`、
statusSlots/studentSlots 側で自作した生徒キーは科目なし**なので突き合わせは `key+'__'+subject`。名簿の氏名は全角スペース入り。
`buildLecturePendingItemsByEntryKey` で未消化講習も同時に出せる。プローブ・取得JSONは調査後に削除済み。
関連 [[komahyou-manual-test-2026-08-analysis]] [[komahyou-lecture-stock-clear-status-wipe]] [[komahyou-no-regression-rule]]
