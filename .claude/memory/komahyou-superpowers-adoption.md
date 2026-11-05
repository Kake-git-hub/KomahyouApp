---
name: Superpowers 採用と既存スキルの使い分け
description: 2026-11-05 オーナー確定・一般的な進め方は Superpowers・固有ルールは既存スキル・staging 実機確認は必須から外した・11 論点の決定表は CLAUDE.md が正本
type: project
---

**決定(2026-11-05・オーナー)**: 作業の進め方は Superpowers プラグイン(`superpowers:*`)に従う。
このアプリ固有の決まり(版の同期・CHANGELOG・本番データ保護・確認リスト・台帳・INV・ロールバック・Issue 整理)は
既存スキルに残す。ぶつかる 11 点の決定表は CLAUDE.md「Superpowers との使い分け」が正本(ここに複製しない)。

**要点**
- staging での実機確認は必須から外した。画面確認は本番反映後に開発用教室の確認リストでオーナーが行う。
- main マージまで自動は継続(finishing の選択肢・PR は使わない)。worktree は作らない。
- テスト先行はすべての変更に適用(文書・設定だけの変更は除く)。
- コードの変更は subagent-driven-development(実装係=dev-fix・レビュー=regression-reviewer 1 人)。トークンは増える前提でオーナーが選んだ。
- 設計は docs/spec-*.md、計画は docs/plan-*.md(docs/superpowers/ は使わない)。
- 「1% でもスキル」はコードの変更に限る(質問・読むだけの調査・文言/設定は免除)。

**同日のプラグイン設定**: `.claude/settings.json` の env で security-guidance の毎ターン差分レビューを止め
(`ENABLE_STOP_REVIEW=0`)、commit 時レビューは別名 `sonnet`。`.playwright-mcp/` は .gitignore 済み。
クラウド環境のネットワーク設定で komahyouapp-prod.web.app は拒否される(Playwright でも curl でも 403)。
