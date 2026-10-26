---
name: komahyou-transfer-source-rest-display
description: スクールIE要望(2026-09-16) 振替元「休)」表示・振替欄の元起点統一＋未定・丸ごと振替/休日設定の記録保持 — オーナー確定の設計とフラグ transferSourceRestDisplay
metadata: 
  node_type: memory
  type: project
  originSessionId: 86b23086-486b-4c71-a806-3f9002d6dc44
  modified: 2026-09-16T09:16:06.105Z
---

2026-09-16 スクールIE要望4件をオーナーと壁打ちして確定し、**v1.5.538 で本番反映済み(フラグ `transferSourceRestDisplay` は development-only・開発用教室でのみ有効)**。次は開発用教室での実機確認 → staging → 全教室昇格。

**v1.5.539(2026-09-16)で追補**: 休日セルの記録は読込時の再マージ(overlayBoardWeeksOnScheduleCells の休日分岐・8559c28)で消えていた→`carryBoardStatusRecordsOntoClosedDayCell` で記録のある机だけ記録＋講師ブロックを引き継ぐ(授業/メモは持ち込まない・講師を持たないと休日解除後に v1.5.471 ガードで講師空のまま=INV-01)。休日解除後の holiday 席は moved 席と同じ4ボタン、休日中の holiday/moved は解除ボタンだけ。移動/入替の着地で holiday も消える(生徒追加/体験/在庫配置では moved 同様に下に残る)。本番3教室で対象セル0件を読み取り実測。
オーナー回答: 基本データで通常授業は組まない(テンプレのみ)。残る未決: 配布用盤面は休日でも記録のある机の講師名を出す(配信データに営業日情報が無い・既存挙動)。

- D1 「休)」は**表示ラベルだけ**。移動元は内部 `moved` のまま・在庫会計と INV-06 ガード不変(本当の absent にすると移動先の振替と二重計上)。
- D2 生徒日程表の振替欄は**元コマ起点**「科目 元 → 先 / 未定」。先起点(現状)の行と元トークンで重複排除・両方範囲外は出さない。「未定」の根拠は未消化一覧の正本 `makeupStockEntries.remainingOriginDates/Slots` を payload `outstandingMakeupOrigins` で渡す。
- D3 別日D&Dで元に記録を残すのは通常授業のみ(現状どおり)。振替/講習コマの別日移動は元に何も残さない。
- D4 丸ごと振替は振替元の通常授業の生徒ごとに moved 記録(先日付/限)を残す。記録が残る日は再度の丸ごと振替がブロック(オーナー了承・解除は個別解除)。
- D5 休日設定は記録を消さない。moved/absent は残し、在庫へ戻した配置・出席・振無休は**新種別 `holiday`(表示専用・会計は moved と同じ無視)**へ変換。体験は記録なし。休日解除でも配置へは戻さない。第1弾/第2弾は**まとめて実装**(オーナー指示)。
- D6 下段レイアウトは現状(オプション欄あり=休み欄なし・`studentScheduleOptionField` は all-classrooms 昇格済み 2026-06-27)を崩さない。spec-schedule-pdf §E-1 の「開発用教室のみ」は古い記述。
- 保護者ページは既に moved を「お休み＋振替先」で補っており整合([[komahyou-parent-portal-qr]])。

**Why:** オーナーの運用は「丸ごと振替 → その日を休日設定」が定番で、日程表で「その日に授業があった」痕跡が消えるのが困る。移動由来と在庫由来で表示が違うのも混乱の元。
**How to apply:** 会計は触らず表示と記録の保持だけで満たす。`'moved'` を特別扱いする全箇所に `holiday` を同じ側で入れる(漏れ=INV-06 違反)。昇格は開発用教室→staging→全教室([[komahyou-whole-day-transfer]] [[komahyou-move-date-inheritance]] [[komahyou-clarify-before-proceeding]])。
