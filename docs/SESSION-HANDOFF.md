# セッション引き継ぎ資料（2026-06-08 時点）

新しいチャットはまずこのファイルを読む。プロジェクト「コマ表アプリ」の**全体見直し→段階的実装**を継続中。

---

## 0. いま何をしているか（最重要・即時タスク）

**Phase 4 / B（欠席登録UI）に着手する直前**。
ただしオーナー指摘：「**現状すでに『生徒クリックメニューの欠席を押すと未消化振替にストックされる』仕様かもしれない。先に精査して**」。

→ **次セッション最初の作業**：現状の盤面で「生徒クリックメニューの欠席」が既に振替ストックを生むかを精査する。未調査のまま実装に入らない。最初に走らせる予定だったコマンド：
```
rg -a -n "欠席|absent-no-makeup|'absent'|statusSlots|setStatus|markAbsent|振無休" src/components/schedule-board/ScheduleBoardScreen.tsx
```
- `status: 'absent'` / `absent-no-makeup` は既に存在。`makeupStock.ts` は absent エントリを一部 `continue` でスキップ（line 360/392 付近）。
- **要確認**：欠席にした通常コマが「未消化振替（makeup origin）」を生むか。生んでいれば B は「ほぼ実装済み」の可能性（Phase 3/4A と同じパターン）。

仕様の目標（spec-makeup-stock.md §1-B）：盤面コマの生徒を「欠席」登録→その生徒×科目の振替に+1。欠席コマは**消さず「欠席」表示で残す**。席は**ロックせずクリックで別生徒・体験・メモ追加可**。理由ラベルなし。

---

## 1. プロジェクト概要・本番保護

- React + TypeScript + Firebase。本番 `komahyouapp-prod`、`https://komahyouapp-prod.web.app/`。**本番稼働中**（複数教室の実データ）。
- ルール：`CLAUDE.md` / `開発ルール.md` / `README.md`。
- ★**本番データ保護（厳守）**：書き込みは**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。本番3教室（日大前/緑が丘/薬円台）は読み取り専用。復元/コピー系 Functions を本番に向けない。

---

## 2. 全体の流れ

1. **仕様確定（見直し一周）**：全10ブロックを確認し `docs/spec-*.md` に正本化。目次＝`docs/spec-index.md`。
2. **実装計画**：`docs/spec-implementation-plan.md`（Phase 0〜6）。
3. **段階実装**：Phase 0〜4 実施。各PRマージ＋都度デプロイ。

### 正本（docs/）
`spec-index.md`(目次) / `spec-save-restore.md` / `spec-board-regular-placement.md` / `spec-makeup-stock.md` / `spec-lecture-stock.md` / `spec-basic-data.md` / `spec-special-session-submission.md` / `spec-auto-assign-rules.md` / `spec-schedule-pdf.md` / `spec-classroom-auth.md` / `spec-implementation-plan.md`

---

## 3. 進捗（Phase）

| Phase | 内容 | 状態 |
|---|---|---|
| 0 安全網 | ②JSONフル復元・保存失敗ダイアログ | ✅ デプロイ済 |
| 1 削除 | ⑥マネージャータブ・①AI分析・①Spark廃止・⑧グループ授業整理 | ✅ デプロイ済 |
| 2 簡素化 | ②保存UX(5s/20s・常時緑・オフラインブロック)・色撤廃・⑥isHidden廃止＋高3卒業・講師の出勤可能コマ/メモ削除 | ✅ デプロイ済 |
| 3 テンプレ一本化 | 核心は既に実装済みと確認。死蔵 `capRegularLessonDatesPerMonth` 削除 | ✅ main（挙動不変・未デプロイ） |
| 4 振替 A/C | A 休日振替の即時計上 / C マイナス残廃止（PR #15） | ✅ main・**未デプロイ** |
| 4 振替 B | 欠席登録UI | ◐ **次タスク（要先行精査）** |

### Phase 3/4 の教訓（パターン）
- 「仕様策定時の想定」と「現状実装」がズレ、**核心が既に実装済み**のことが多い。**実装前に必ず現状精査**。
- ④：`autoShortage` は「休日で潰れた通常授業の振替自動計上」だった→**残す**（仕様訂正済み）。A=未来休日も即時計上(todayキャップ撤廃)。C=残0下限＋過剰配置は一覧除外(`balance !== 0`)。

---

## 4. 本番との差・デプロイ

- **本番 = v1.5.289**（Phase 0〜2）。main はそれより先行（Phase 3＋Phase 4 A+C）。
- ★**Phase 4 A・C は本番の振替残数を意図的に変える**（特に A は未来休日を持つ教室で残数増）。**デプロイ前に教室ごとの残数差分を読み取り専用で確認**してから反映。
- デプロイ：`package.json` の version を上げる → `git push origin main` → `npm run deploy:firebase`。
  - Hosting が**一時的に HTTP 500**→そのまま再実行で成功。version を上げないと更新検知されない。

---

## 5. 開発フロー・ツール

- **PR**：`gh` 認証済（`Kake-git-hub`、トークンはキーリング）。
  フロー：`git checkout -b X` → 変更 → build/test → commit → `git push -u origin X` → `gh pr create --base main --head X ...` → `gh pr merge X --merge --delete-branch` → `git checkout main && git pull`。
- **検証**：`npm run build` / `npm run test:unit`（**262件**）。ゴールデンスナップショット `__snapshots__/*.snap` は意図的変更時のみ `npx vitest run -u <path>`。

### ★★ 改行コードの罠（大事故注意）
- `core.autocrlf=true` だが既存blobはCRLF混在。**`sed -i` は CR を剥がしてファイル全体が差分（数千行）になる**（前セッションで App.tsx が9778行差分）。
- **対策**：原則 **Edit ツールを使う**。sed を使ったらコミット前に各ファイルを元blobの改行に合わせ正規化：
  ```bash
  for f in $(git diff --name-only); do [ -f "$f" ] || continue; \
    if git show "HEAD:$f" 2>/dev/null | rg -q $'\r'; then sed -i 's/\r$//; s/$/\r/' "$f"; else sed -i 's/\r$//' "$f"; fi; done
  git -c core.autocrlf=false add -u && git -c core.autocrlf=false commit ...
  ```
  正規化後 `git diff --cached --stat` が小さければOK。
- `.gitignore` に `.claude/` 追加済み。`git add -A` は `.claude/`・`CLAUDE.md` を巻き込むので**対象ファイルを明示**して add。

### ★ セキュリティ
- オーナーが GitHub トークンをチャットに平文共有済み。**区切りで Revoke 推奨**。失効後は最小スコープ(`repo`,`workflow`)の新トークンで再 `gh auth login --with-token`。

---

## 6. 残りロードマップ

- **Phase 4 B**：欠席登録UI（まず現状精査）。
- **Phase 4 デプロイ**：A+C(＋B)を教室別残数検証のうえ本番反映。
- **Phase 5**：⑤講習ストック／⑦提出／⑨日程表。
- **Phase 6**：②クラウド一本化本体／⑧自動割振スライダー化・区分許可リスト。
- 手順・対象ファイルは `docs/spec-implementation-plan.md`。

---

## 7. 次セッション冒頭チェックリスト

1. `git checkout main && git pull`。
2. `npm run test:unit`（262件グリーン確認）。
3. Phase 4 B：§0 の grep で**欠席→振替の現状精査**してから方針判断。
4. sed を使うなら §5 の改行コード正規化を忘れない。
