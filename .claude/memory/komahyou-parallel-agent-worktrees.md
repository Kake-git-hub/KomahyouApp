---
name: komahyou-parallel-agent-worktrees
description: コマ表アプリで複数エージェントを別 git worktree で並行実装させるときの作法と罠(2026-09-16 Phase 0 で確立・node_modules/CRLF/NUL/env 依存テスト/CHANGELOG 衝突/モデル分担)
metadata: 
  node_type: memory
  type: project
  originSessionId: 9b692f5b-169e-4773-9d9e-2b052f1480a0
  modified: 2026-09-18T15:53:39.856Z
---

2026-09-16 の複数会社展開 Phase 0 で、4 タスクを `Agent(isolation: "worktree")` で並行実装し統合ブランチにマージする運用を初めて行った。うまくいった型と罠。

**型**: 主セッション(上位モデル)が調査→設計判断を **scratchpad の共通ブリーフ 1 枚**(確定した事実・設計判断・担当ブランチ・触ってよい範囲・衝突回避の「触らない行」)に固めてから、
判断を伴うタスクは Opus(dev-fix/spec-curator)、確立した単純作業は Sonnet で起動。各エージェントは自ブランチにコミットのみ(マージ/push しない)。
主セッションが `phase0/integration` 等に順にマージ → 全検証(lint/unit/build/functions build/test:rules)→ regression-reviewer(Opus)→ 指摘対応 → 版ラベル → main。

**罠と対処**:
- worktree は `.claude/worktrees/agent-<id>` に作られ、メインリポ配下なのでルートの `node_modules` は上位探索で解決される(ジャンクション不要・壊れたジャンクションがあると tsc -b が TS5033)。
  **`functions/node_modules` だけはジャンクション必須**(`cmd //c mklink /J functions\\node_modules <本体>`)。無いと `questionAiAnswer.test.ts` が `@anthropic-ai/sdk` 未解決で落ちる(環境要因・本体では通る)。
- **worktree には untracked の `.env.local` が無い** → cwd の env を読むテストは worktree で通り本体で落ちる。ファイル読み取り関数は baseDir 引数を取り、テストは一時ディレクトリで固定する。
- `core.autocrlf=true` で作業ツリーは CRLF。node/sed の `\n` 前提の文字列置換は CRLF ファイルで空振りする(Edit ツールか行単位処理を使う)。テスト実行で `__snapshots__/*.snap` が LF に書き換わるノイズが出ることがある(`git checkout` で戻す)。
- エージェントがテスト文字列に**生 NUL バイト**を入れ git がバイナリ扱いにしたことがある(差分がレビューで見えなくなる)。`git diff --stat` に `Bin` が出たら疑う。
- 並行ブランチは **CHANGELOG.md の `## 未リリース` で必ず衝突**する。両側の行を残す解決(マーカー除去で連結)で足りる。index.ts など同一ファイルでも hunk が離れていれば自動マージされる。
- エージェントの Co-Authored-By は各自のモデル名になる(統一したければ amend)。
- **CI Tests は Linux(ubuntu)で走る**。Windows 限定の表記(バックスラッシュ相対パス・ドライブレター・ジャンクション)をテストに書くと本体では緑・CI で赤になる(v1.5.535 で実際に発生)。OS 依存の assert は `process.platform === 'win32'` で絞る。デプロイ 2 本は CI Tests の結果に依存しないので、赤でも本番には出てしまう点に注意。
- 版ラベルは push 前に **bump コミット(`git log -- package.json`)と CHANGELOG の見出しを突合**する。前セッションのずれ(空セクション・重複見出し)を見つけたら同じ push で是正する。

- **worktree を消す前に `functions/node_modules` のジャンクションだけ先に外す**(`cmd //c rmdir <worktree>\functions\node_modules`=リンクだけ消える)。
  外さずに `git worktree remove` すると再帰削除がジャンクションを辿って**本体の node_modules を消しうる**。外したあと本体の件数を数えて無傷を確認(2026-09-19)。
- 主セッションが進捗確認で `cd <worktree>` すると Bash の cwd が worktree に残り、以後のコマンドがエージェントの作業ツリーで走る。
  覗くときは `git -C <worktree> status` を使い、cd しない。
- サーバー/公開ページ(パートA)と盤面(パートB)のように**契約で切れる**作業は、scratchpad の共通ブリーフに「Firestore doc の形・API の形・
  触ってよい/いけないファイル」を書けばコンフリクト 0 で統合できた(2026-09-19 保護者QR休み連絡)。統合後に**両側を実物どうしで噛み合わせる契約テスト**を足すと、片側だけのドリフトを CI で拾える。

関連: [[komahyou-parent-absence-notice]] [[komahyou-ops-model-assignment]] [[komahyou-plan-2026-09-15-multi-company]]
