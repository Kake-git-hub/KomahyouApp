---
name: komahyou-autonomous-commit-merge
description: コマ表アプリでコミット〜mainマージはClaudeの判断で毎回自動実行してよい(オーナー常時許可)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fff91f61-db8a-460e-9f02-cf8a2209bcca
---

コマ表アプリでは、毎回「コミットして」「マージして」と言われなくても、Claude は自分の判断で
コミット → `CHANGELOG.md` の `## 未リリース` を次の版(`package.json` の patch +1)でラベル付け →
main へマージ(= CI 自動デプロイ)まで進めてよい(2026-06-27 オーナー指示)。完了後に
「何を・どの版で・どこへ反映したか」を簡潔に報告する。

**Why:** オーナーが一連の反映を毎回明言するのを省きたいため。ソロ開発でレビュー不要。

**How to apply:** マージ前に必ず回帰確認(build / 関連テスト / `git diff`)を通す。次は対象外で勝手に進めない —
本番データへの書き込み(開発用教室 `v8OZ7zH8vONNHjjYVcR1` 以外は読み取りのみ)、履歴の破壊的操作
(`reset --hard` / `push --force` / 共有済みブランチの rebase)、壊れたら困る大きな変更の main 直接着手
(リスクはブランチを切る)。手順の正本は `.claude/skills/solo-git-workflow/SKILL.md` の「C. コミット〜main マージ」。
版は CI が自動 bump するので `package.json` は手動で書き換えない。[[komahyou-no-regression-rule]]
