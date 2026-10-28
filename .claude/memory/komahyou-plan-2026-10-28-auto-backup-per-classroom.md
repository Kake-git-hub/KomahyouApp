---
name: komahyou-plan-2026-10-28-auto-backup-per-classroom
description: 15 分毎の自動バックアップを教室別(gzip＋時点ごとの目次)に分ける計画(2026-10-28)・次セッションの着手手順は計画書が正本・論点 Q1〜Q9 はオーナー確定待ち
metadata:
  node_type: memory
  type: project
---

**計画の正本**: `docs/plan-2026-10-28-per-classroom-auto-backup-handoff.md`(2026-10-28・spec-curator)。オーナー指示「自動バックアップの教室別化はすぐに次セッションで着手できるようにして」(分割保存の段階 B 全教室展開の直後・20 教室を見据えた質問から)。

**事実(2026-10-28 実測)**: main は 4 教室(日大前 8.38MB・緑が丘 6.11MB・テスト教室 8.94MB・開発用 8.30MB)で 15 分毎の 1 本が 31.7MB(gzip 3.0MB)・7 週で 25% 増。Storage `workspace-auto-backups/main/15min/` に 170 本 5.38GB。生成は 1 教室 1.5〜2 秒。生成関数は 540 秒/2GiB(10/22 増強済み)。**最初に詰まるのは読む側**: 復元の callable(`downloadClassroomFromServerAutoBackup`=室長の自教室復元/Feature B・`downloadServerAutoBackup`=開発者の全体復元)は 512MiB で 1 本を丸ごと読み JSON.parse するため、日大前校サイズで 1 社 8〜10 教室から**室長の自教室復元が先に壊れる**見込み。既存の副作用: 開発者のローカル同期は時点ごとに incident backup を 1 本ずつ書く(2026-05 の 46.8GB 残置と同型)・生成ループに会社ごとの try/catch が無い・間引きの要約全件読みが月 約 110 万回。

**推奨案 A(未確定)**: 教室ごとに 1 本 gzip ＋ 時点ごとの index.json。教室ファイルは「1 教室だけ入った WorkspaceSnapshot」(JSON 読込・開発者モーダル・snapshot-diff.mjs は無改修)。要約には layout の印だけ(教室一覧は載せない・INV-08)。目次は最後に公開(INV-14)。間引きは時点単位。移行は 2 段(読める版 → 書く側を設定で切り替え・戻せる)。論点 Q1〜Q9(全体 1 本を残すか/Storage も gzip/日次も教室別/Drive の単位〔30 教室で 12GB=15GB の 80%・25 教室で再判断〕/復元画面は変えない/間引き単位/Issue #77 の分割実行は後回し/incident とローカル同期/期限=2 社目受け入れ前に段階 2 まで)。

**Why**: 1MiB 上限は分割保存で解消したが、教室数が増えたとき最初に詰まるのは全教室 1 本のバックアップとその読み手。
**How to apply**: 次セッションはまず Q1〜Q9 を AskUserQuestion で確定 → spec-save-restore §10 を書く(骨子は計画書 §8)→ 段階 0〜3。INV-14 マトリクス「行: 自動バックアップ」の文字列検査を弱めずに追従。[[komahyou-backup-3tier-and-scheduler-role]] [[komahyou-firebase-cost-scaling]] [[komahyou-manager-self-restore]] [[komahyou-snapshot-1mib-capacity-incident]]
