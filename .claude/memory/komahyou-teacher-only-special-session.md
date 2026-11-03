---
name: 特別講習「講師専用」(未着手・引き継ぎ済み)
description: 講師の予定だけ集める特別講習。オーナー決定「生徒側から全部隠す」・開発用教室で先行。引き継ぎ書 docs/plan-2026-11-03-teacher-only-special-session-handoff.md
type: project
---

- 要望: 確認リスト v1.5.672 のフリーメモ(受付 20261103-105053536-c0f31680)。特別講習の作成時に「講師専用」チェック。
- **オーナー決定(2026-11-03)**: 生徒側から全部隠す = 生徒日程表の講習選択・生徒の提出用QR・保護者QR・講習回数の欄に出さず、講師日程表と講師QRだけ。まず開発用教室(機能フラグ staging-environment)。
- 未定義(着手時にオーナー確認): 生徒向け講習との期間の重なりを許すか／既発行の生徒QRの扱い／講師専用での「保護者への公開」トグル。
- 隠す場所の一覧・完了の定義は引き継ぎ書 §4・§6。保護者QRは src/utils/parentSchedule.ts と functions/src/generated の写しを同時に直す(パリティテスト)。
- 対応したら VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS に受付番号を足し、台帳の行 teacher-only-special-session を書き換える。
