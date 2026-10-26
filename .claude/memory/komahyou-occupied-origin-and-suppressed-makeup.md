---
name: komahyou-occupied-origin-and-suppressed-makeup
description: 空きコマ不足origin廃止(2026-07-03)と、休講日振替がsuppressedMakeupOriginsに巻き込まれ消える事故・本番4名の7/20振替消失
metadata: 
  node_type: memory
  type: project
  originSessionId: fb7ebdf1-1563-42c4-9c7e-5d66561a1bf6
---

振替在庫(未消化)の「空きコマ不足」自動origin `computeOccupiedSlotOrigins` を**経路ごと廃止**した(**2026-07-03 本番デプロイ済 v1.5.363**)。

**不一致の真因(なぜ生徒ごとにバラバラか):** 生成ガードは `managed_` で始まる授業しか"配置済み"と認めない。スタッフが通常授業を手動移動すると id が `moved_` になり、本人の授業を"占有"と誤認して偽originを出す(例: 緑が丘 生徒A/生徒Bの英が `moved_`→残存)。一方 `managed_`(生徒s031)はガードが効き今は生成しない。加えて削除(抑制)は完全に手動・場当たり。この2重の脆さで構造的に一貫性を持てないため経路ごと廃止した。

**なぜ:** テンプレ毎週強制適用が前提の現行仕様では、開講日にコマが埋まっていても振替を自動生成すべきでない。過去にこの偽originが大量発生し、スタッフが未消化振替を一括削除すると、削除は `suppressedMakeupOrigins`(教室データ `boardState.suppressedMakeupOrigins`, キー `sid__科目`, dateKey配列)へ記録される。その際、**本物の休講日振替(海の日7/20など)まで巻き込まれて抑制され消える事故**が起きた。

**在庫計算の要点** ([makeupStock.ts](../../../../Desktop/自作ソフト/コマ表アプリ/src/components/schedule-board/makeupStock.ts) `buildMakeupStockEntries`): 未消化源 = 休講日(computeAutomaticShortageOrigins)/同時間帯重複(conflict)/手動(manual)。`allOriginDates` から `suppressedOriginDates` を除外して残数算出。suppressed は手動削除(`handleDeleteMakeupOriginItem`→`appendMakeupOrigin`)で増えるだけで**戻すUIが無い**(除去はテンプレ再適用時 effectiveStart 以降の一括クリアのみ, ScheduleBoardScreen.tsx (D)節)。

**⚠️訂正(2026-07-03 後半・検証で判明):** 7/20振替が消えた真因は**抑制ではなくテンプレ凍結**だった。`buildMakeupStockEntries` は現行 `regularLessons`(=凍結後テンプレ, 生徒s031は start=2026-08-31)だけを見て `computeAutomaticShortageOrigins` を回すため、**凍結前(夏)の休講日7/20/8/10 は在庫計算の対象外→origin生成されず(autoShortage=0)**。よって suppressedMakeupOrigins から7/20を外す「抑制解除機能」を作っても在庫は増えない(本番4名全員+0を検証で確認し、機能は出荷せず破棄)。schedule表示は `buildCombinedRegularLessonsFromHistory` で凍結前も補うが、**makeup在庫は履歴合成していない**のが差。凍結前の未配置振替を戻すには (A)盤面へ直接振替配置 (B)在庫計算を履歴合成化=全生徒の凍結前振替が大量復活し数量激変(ドリフトガード§6が検出)=危険 (C)過去分として許容、のいずれか。要オーナー判断。検証で出荷前に捕捉できたのは release-checklist §6 のベースライン照合(294不変)のおかげ。

**本番の被害(2026-07-03 読み取り調査, workspaces/main/classroomSnapshots/{classroomId}, compressedData=base64+gzip):**
- 生徒s031型の事故(お盆以外の休講日抑制で盤面にも無い)= **7/20の4名**: 緑が丘 生徒s031(数)・生徒s024(英)、日大前 生徒s068(数)・生徒s076(理)。手動配置で復旧予定。
- お盆週(8/10-15)の大量抑制(日大前119件ほか)は「お盆は振替なし運用」で意図的削除の可能性が高く事故と別(要ポリシー確認)。

**✅オーナー確定(2026-07-04 仕様監査 領域4):** 上記「要オーナー判断」は決着。(B)履歴合成化は**採らない**(数量激変=危険)。「凍結前・過去年度は自動計上の対象外・必要なら手動追加で復帰」を正本 `docs/spec-makeup-stock.md` §1-A に明文化(=現行を正)。「戻すUIが無い」問題は**復帰UIを追加で確定 → Issue #39**(凍結前originは抑制除去だけでは戻らないため manual 追加として積む設計注意を Issue に明記済み)。B2/B5/B7 のデータモデル・消化アルゴリズム・balance上限も「消してはならないガード」として正本§5/§2 に明文化済み。台帳 `docs/spec-audit-2026-07.md` 領域4参照。

関連: [[komahyou-no-regression-rule]](occupiedはテスト付き現役機能だった→新契約へ反転) / [[komahyou-move-date-inheritance]] / [[komahyou-auto-assign-rules-architecture]]
