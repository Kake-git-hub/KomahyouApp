---
name: komahyou-withdraw-sweep-and-holiday-release
description: v1.5.553(2026-09-21) 確認リスト r-7 までの要改善対応。退塾=今日以降の痕跡を自動で消し切る(開発用教室限定フラグ)・退塾後は行ロック(生年月日だけ可)・高3卒業は 3/31 自動入力・休日解除=席へ復元(逆操作)・「最新データ」誤表示の真因(受動 publish の clean 化)
metadata:
  type: project
---

# v1.5.553(2026-09-21) 確認リスト r-7 までの要改善対応

## オーナー確定(2026-09-20〜21)
- **退塾**: 退塾日(ボタンでも日付入力でも)を過ぎた生徒の、今日以降の席(講習/振替/増コマ/体験/手動追加/移動)と出欠記録を**確認なしで自動消去**。
  未消化へは戻さない(抑止 suppressedMakeupOrigins だけ積む)。昨日以前・希望数・QR提出は不触。境界は**退塾日当日から非在籍**(ボタンは退塾日=今日)。
  「退塾は元に戻せない」: 退塾後の行は編集不可で「削除」だけ。**例外(案2)=生年月日だけ直せる**(誤入力で卒業扱いになった生徒の救済。
  直して卒業扱いでなくなれば、卒業で自動入力された退塾日(印 graduationWithdrawAutoFilledAt つき)だけ外す。手入力の退塾日は外さない)。
  在籍中(退塾日が未来)は退塾予定日を自由に編集可。「非在籍生徒表示」→「退塾生徒」に改名。差分取り込みは退塾済み行を変更しない(初期取り込み=全置換は対象外)。
- **高3卒業**: 4/1 に退塾日 3/31 を実データとして自動入力(1人1回・案A。浪人/既卒で通い続ける生徒は居ない前提)。判定関数は無改変でデータだけ入れる。
- **休日解除(r-5)**: 休日設定の**逆操作**。holiday 記録を元の席へ復元し、休日設定時に返した在庫を控え(statusSlots の holidayStockReturn)どおりに巻き戻す。
  別日に組んだ振替は**消して復元**(出欠記録つきは見送り)。個別の「休日記録の表示解除」は従来どおり記録を消すだけ。控えの無い旧 holiday 記録は復元しない(件数通知)。
  spec-makeup-stock §B-2-2c と INV-06 を改定済み。
- 保護者連絡の履歴は四択を選んだ時点で「確認済」(表示だけ・notifiedAt は保存成功時のまま)。丸ごと振替のブロック理由は中央ダイアログ。

## 形と罠
- 自動消去と卒業自動入力は**フラグ `studentWithdrawAutoSweep`=開発用教室限定**で先行(盤面を開いて約20秒で自動保存まで走るため)。昇格はオーナーが b-2/b-3 確認後。
  2026-09-21 の実測(15分バックアップ JSON を gcloud トークン+Storage REST GET→純関数を当てる・読み取りのみ): 本番3教室は初回の消去 0 件、卒業自動入力 0 名(最初の発火 2027-04-01・見込み 日大前1/緑が丘9/薬円台11)。
- 検出→掃除は盤面の 1 か所(`collectStudentWithdrawSweepTargets`→`applyStudentWithdrawSweepToBoard`→commitWeeks)。**掃除の入力は必ず再マージ後の weeks**(合成関数 `remergeBoardWeeksWithManagedData`)。
  再マージ effect は setWeeks(updater)、掃除は commitWeeks(明示値)なので、古い weeks を起点にすると同じ flush の再マージ結果(他生徒の改名等)が落ちたまま自動保存される。
  再マージ effect・読込経路に破壊的処理を混ぜない(INV-06/INV-03)。教室切替の窓は `isEditingStateLoadedForActingClassroom`(loadedEditingClassroomIdRef 一致)でガード(INV-08)。
- **「最新データ」誤表示(INV-02・U-0 と同機序の2件目)**: ユーザー編集直後に再マージ effect が出す 2 回目の受動 publish(userInitiated:false)が `markStateLoadedClean()` を呼び、
  未保存のまま clean 化＋自動保存タイマー破棄(休日設定は 2 回目で盤面の中身が変わるので必ず踏む・v1.5.437 でも再現)。
  修正= `hasUnsavedUserEditBeforeBoardPublish`(直前署名≠clean かつ 編集後に clean 署名が進んでいない)なら clean 化しない。明示 clean 化で目印 ref を null。ロード直後は従来どおり clean(U-0c)。
- 「消したときに抑止を積む規則」が handleDeleteStudent / collectClearedDayMakeupSuppressions / 退塾掃除の 3 か所に別実装(一元化候補)。
- 確認リスト: r-1/r-3/r-4/r-6/r-7 は OK で外した。b-2/b-3/r-2/r-5 が v1.5.553 の再確認(版 v1.5.540 据え置き)。r-5 は**この版で新しく休日設定した日**で確認する。

**Why:** 確認リスト r-7 までの結果(b-2/r-2/r-5 要改善＋その他「最新データなのに保存されていない」)への対応。
**How to apply:** フラグ昇格時は本番の影響件数を同じ読み取り専用手順で再実測する。休日/退塾の会計を触るときは inv06-holiday-record-retention / inv06-makeup-absence-stock のマトリクスに行を足す。
