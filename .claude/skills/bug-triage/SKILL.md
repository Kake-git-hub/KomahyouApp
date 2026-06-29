---
name: bug-triage
description: コマ表アプリのバグ報告・ユーザー要望を GitHub Issues に一本化して整理する手順。曖昧な報告（口頭/LINE/スクショ）を再現手順・影響範囲・優先度に整え、ラベルを付けて起票する。報告を受けたとき、Issue を起票/整理するとき、優先度を判断するときに従う。実作業は triage エージェントに委譲してよい。
---

# バグ・要望のトリアージ（GitHub Issues 一本化）

報告は GitHub Issues に集約する（リポジトリ `Kake-git-hub/KomahyouApp`）。
口頭/LINE で来た曖昧な報告を、対応できる形に整えてから起票する。

## Issue の必須項目（テンプレ `.github/ISSUE_TEMPLATE/`）
- **教室**: 教室名（分かれば classroomId）。本番教室名は CLAUDE.md の一覧参照。
- **再現手順**: 1.→2.→3.。不明なら「再現条件の確認待ち」と明記。
- **期待 / 実際**の挙動。
- **影響範囲**: 全教室か特定か／データ破損を伴うか／回避策の有無。
- **初期の見立て**: 関連しそうな機能・ファイル（仮説と確証を分けて書く）。

## 優先度（severity）
- `s1` — 本番データ破損・保存不能・全停止。**即対応**。データ消失/他教室データ混入の報告は s1 候補。
- `s2` — 主要機能が一部の教室/操作で壊れている。早期対応。
- `s3` — 軽微・見た目・改善要望。

## ラベル体系
- `severity:s1` / `severity:s2` / `severity:s3`
- `area:盤面` / `area:QR` / `area:自動割振` / `area:保存` / `area:集団` / `area:生徒日程表` / `area:その他`
- `status:triage`（起票直後） → `status:in-progress` → `status:staging-verified` → close
- `type:bug` / `type:feature`

## 起票
```bash
gh issue create --title "<簡潔な症状>" \
  --body "<テンプレに沿った本文>" \
  --label "type:bug,severity:s2,area:保存,status:triage"
```
- ラベルが未整備ならラベル無しで起票し「ラベル未整備」と添える。
- 起票前にユーザーへ要約を見せて確認する。

## データ破損が疑われる報告の扱い（重要）
- 「保存が消える」「他教室のデータが出る」「集団参加が一括で消えた」等は**最優先**。
  既知の類似（memory: save-architecture / classroom-restore-cross-contamination /
  group-participation-save-paths）と突き合わせる。
- 調査の確認は**読み取りのみ**。書き込みを伴う再現は staging / 開発用教室で（本番データ保護ルール）。

委譲: 実際の整理・起票は `triage` エージェントに任せられる。
修正に進むときは `dev-fix` エージェント＋ safe-release フローへ。
