---
name: komahyou-ops-model-assignment
description: 運用保守のモデル割当方針(単純作業=Sonnet最新/判断=Opus最新・ID固定禁止)とspec-curator新設・標準フロー(2026-07-04オーナー指示)
metadata: 
  node_type: memory
  type: project
  originSessionId: 2b42988e-3a14-4442-98f8-40ad50191a6f
---

# 運用保守のモデル割当と標準フロー（2026-07-04 オーナー指示）

オーナーの狙い: 「Fable 5 が使えなくなっても運用保守が回る体制」＋「コスト最適化」。

## モデル割当（CLAUDE.md に明文化済み）
- **特定モデルIDに固定しない**。エージェント frontmatter は `model: sonnet` / `model: opus` エイリアスで最新に自動追従。
- **判断・仕組みづくり・原因特定・仕様策定・レビュー → Opus 最新**（dev-fix / spec-curator / regression-reviewer）。
- **手順が確立した単純作業 → Sonnet 最新**（triage、ログ収集、一括置換、定型ドキュメント更新）。
  dev-fix でも機械的な小修正（文言/ラベル/スタイル/定数）は Agent 起動時 `model: sonnet` 上書き可。
- オーケストレーション（主セッション）は上位モデルで行うが、特定モデルの存在を前提にしない
  （CLAUDE.md＋スキル＋エージェント定義だけで運用が再現できる状態を保つ）。
- **再確認(オーナー指示 2026-07-10)**: 大原則を CLAUDE.md「モデル割当方針」冒頭に明文化。
  「複雑な作業・構想作成・原因特定・仕様策定・レビュー＝高コスト上位モデル / 手順が確立した単純作業＝安い下位モデル」を、
  **主セッションが `Agent` を起動するとき／`Workflow` の各 `agent()` ステップの `model:` を選ぶときにも適用**する
  （判断の段は Opus 最新、機械的な段は Sonnet 最新）。

## spec-curator エージェント新設（.claude/agents/spec-curator.md・Opus）
背景: アプリは「思いつき要望を取り込みながら成長」したため仕様の未定義領域が意図しないバグの温床。
役割: 要望を実装に渡す前に「あるべき姿」から要求仕様を補完し `docs/spec-*.md`（正本）を更新、
受け入れ条件（テスト可能な文）つきで実装タスク化。コードは編集しない（docs のみ）。
仕様確定の判断は必ずオーナーに帰属（暫定既定は「暫定」と明記）。

## 標準フロー（バグ・要望共通）
triage(整理・起票) → 仕様に関わるなら spec-curator(未定義補完・正本更新) → dev-fix(実装+回帰テスト)
→ regression-reviewer(巻き戻し検査) → safe-release(staging→本番)。単純明白バグは spec-curator スキップ可。

## オーナー決定事項（2026-07-04）
- **仕様監査は全9領域を順次実施**。台帳は `docs/spec-audit-2026-07.md`（分類A=仕様と実装の相違/B=未定義挙動/C=要オーナー判断）。実施役は spec-curator(Opus)。領域1から着手済み。
- **定期保守ルーチンは組まない**（手動起動のみ。自動監視は GitHub Actions 外形監視+CI で足りる）。
- Issue #35(E2E技術的負債)・#1(自動割振画面シンプル化)はオーナー判断でクローズ済み。

**Why:** モデル世代が変わっても CLAUDE.md・スキル・エージェント定義だけで同じ品質の保守が回るようにするため。コストは作業の性質でモデルを使い分けて抑える。
**How to apply:** サブエージェント起動時はこの割当に従いモデルを選ぶ。新しい役割を作るときも frontmatter はエイリアス表記にし、CLAUDE.md の表へ追記する。

関連: [[komahyou-staging-and-ops]] / [[komahyou-autonomous-commit-merge]] / [[komahyou-clarify-before-proceeding]] / [[komahyou-tests-required-for-changes]]
