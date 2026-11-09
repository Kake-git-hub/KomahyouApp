# 室長の質問とバグ時の生徒処理のための調査力の強化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 室長からの曖昧な連絡(「未消化が消えた」「組んだ通りになっていない」)に 1 週間以上遡って答え、バグが出たときに影響した生徒を全員見つけて正しく処理できるようにする。

**Architecture:** (1) 保証台帳(`docs/spec-invariants.md`)に違反している状態を教室データから洗い出す読み取り専用ツール `tools/inv-audit.mjs` を作り、アプリの権威関数を esbuild で束ねて使う(`tools/vanished-makeup-report.mjs` と同じ作法)。毎朝の健診に組み込む。(2) 生徒 ID と期間を渡すと、生徒授業台帳・操作ログ・保存同梱の操作痕跡・保存ごとの版の差を、その生徒の分だけ時系列に並べる読み取り専用ツール `tools/student-timeline.mjs` を作る。(3) アプリで自動処理(読み込み時と基本データ変更時の再反映・起動時の自己修復・QR 提出の反映)が盤面を変えたとき、変わった机の要約を操作痕跡に残す。

**Tech Stack:** TypeScript(vitest)・Node ESM ツール(`tools/*.mjs`・テストは vitest が `tools/**/*.test.mjs` を拾う)・esbuild 0.27(既存)・Firestore REST / Storage JSON API(読み取りのみ)。

**Spec:** オーナー確定(2026-11-09・この計画の元になった会話)。優先は「戻す」より「室長の質問に答える・バグ時に生徒を正しく処理する」。採用 = 案 1(生徒ごとの経緯ツール)・案 2(自動処理を痕跡に残す)・案 3(影響する生徒の洗い出し)。洗い出しのルールは**「決めつけずに保証台帳に違反しているものがバグ」**、**休日に設定した日に残る授業はバグとして出す**、洗い出しは**今週の毎朝の健診にも入れる**。正本: `docs/spec-invariants.md`(保証文)・`docs/spec-developer-report.md` §D-3(操作痕跡)・`docs/spec-save-restore.md` §8-1(保持)・`docs/runbooks/morning-health-check.md`。

## Global Constraints

- 本番データ保護ルール(CLAUDE.md): Firestore / Storage は **GET と読み取り専用の POST(`:runQuery`)だけ**。ネットワークに出るツールは、許す呼び方を表で固定し(`tools/copy-prod-classroom-to-staging.mjs` の `READ_ONLY_POST_SUFFIXES` と同じ作法)、それ以外を投げたら例外にする。
- 公開リポジトリ: テスト・文書に実名を書かない(生徒A・講師A・ID だけ)。ツールの出力は既定で**生徒は ID だけ**(操作痕跡の要約に含まれる名前も名簿で ID に置き換える)。名前を出すのは明示のオプション `--show-names` のときだけで、その出力はスクラッチ領域にだけ置く。
- 権威関数を写さない: 判定はアプリの権威関数を esbuild で束ねて呼ぶ(`findDuplicateStudentInCellByKey`・`buildMakeupStockEntries`・`buildLectureStockEntries`・`collectOrphanedMakeups` など)。tools 側で判定を書き直さない(健診ツールの重複判定の写しはそのまま残す。今回の洗い出しは権威関数を使う)。
- アプリの変更(Task 3)はテスト先行・既存の挙動を変えない(盤面・保存・在庫は不変で、操作痕跡に行が増えるだけ)。`setWeeks` の関数更新の中で副作用を起こさない(StrictMode の二重実行で二重記録になる)。
- `package.json` の version は手で変えない。CHANGELOG `## 未リリース` の末尾に 1 行ずつ。main マージ直前に次の版でラベル付け。
- 確認リスト(CLAUDE.md): アプリの変更(Task 3)には開発用教室で確かめる項目を `src/utils/verificationChecklist.ts` に足す(操作→確認の 2 段・上限はテストが固定)。ツールだけのタスクは項目なし。
- 触れる INV: Task 1 は INV-12・INV-06・INV-08・INV-14 を**読むだけ**、Task 3 は INV-02・INV-03(記録が二重にならない)。

## Review Focus

1. **保存していない教室・まだ一度も保存版の無い期間**: 経緯ツールが版を取れない日を「取得できず」と出し、黙って空にしない — Task 2 のテスト。
2. **生徒の名前の漏れ**: 操作痕跡の要約には他の生徒の名前も入る。既定の出力に名簿のどの名前も含まれない — Task 1・Task 2 のテスト。
3. **洗い出しの誤検知**: 休み・振無休・移動の記録だけが休日に残っているのは授業ではない(記録として正しい)。休日の判定は出欠記録を除いた「授業」だけにする — Task 1 のテスト。
4. **自動処理の記録の嵐**: 再反映の effect は依存が変わるたびに走る。机が変わらないときは記録しない・同じ要約が続けば 1 行にまとめる — Task 3 のテスト。
5. **操作痕跡の保存上限 300 件**: 自動処理の行が手の操作の行を押し出さないよう、自動処理の行は 1 回の保存あたり上限(例 50 件)を持つ — Task 3 のテスト。

---

### Task 1: 保証台帳の違反の洗い出し `tools/inv-audit.mjs`

**Files:**
- Create: `tools/inv-audit.mjs`(CLI と出力整形)・`tools/invAuditEntry.ts`(アプリの権威関数を呼ぶ純関数。esbuild で束ねる)・`tools/inv-audit.test.mjs`
- Modify: `docs/runbooks/morning-health-check.md`(§4 に洗い出しの実行を足す)・`tools/board-health-known-issues.json`(項目に `rule` を足せるようにする・既存の 2 件は `"rule": "INV-12"`)・`CHANGELOG.md` 1 行

**Interfaces:**
- Produces: `auditClassroomSnapshot(input: { classroomId: string; payload: AppSnapshotPayload; today: string; known?: KnownIssue[] }): { findings: Array<{ rule: 'INV-12' | 'INV-06' | 'INV-08' | 'INV-14' | 'HOLIDAY'; severity: 'bug' | 'check'; studentId: string | null; dateKey?: string; slotNumber?: number; deskIndex?: number; message: string }>; counts: Record<string, number> }`(`invAuditEntry.ts`)。
- CLI: `node tools/inv-audit.mjs <教室ファイル> --classroom <id> [--today YYYY-MM-DD] [--known <json>] [--json] [--show-names]`。教室ファイルは健診と同じ教室別バックアップ(`{classroomId}.json.gz`)・教室版履歴・バックアップ書き出しの JSON を受ける(`tools/snapshot-diff.mjs` の `decodeJsonBuffer` / `extractClassroomSnapshot` を使う)。

ルール(すべて「今日以降の日付」と「今日より前」を分けて数え、出力は今日以降を先に):
- **INV-12** 同じコマ(日付×時限)に同じ生徒が 2 か所以上: 権威 `findDuplicateStudentInCellByKey`(`ScheduleBoardScreen.tsx:3919`)で判定。保留の下段は数えない(INV-12 注記)。
- **INV-06** 未消化の在庫が負: `buildMakeupStockEntries` と `buildLectureStockEntries` の残(`balance` 等)が 0 未満の生徒×科目。引数の組み立ては `tools/vanishedMakeupReportEntry.ts` と同じ(名簿・管理名の引き方・保留マップ・丸ごと振替の組のキー)。
- **INV-06** 根拠を失った振替: `collectOrphanedMakeups`(`templateTransferFollow.ts:130`)が返す振替。
- **HOLIDAY**(オーナー指示でバグ扱い) `classroomSettings.holidayDates` の日付に**授業**が残っている机(出欠記録だけの行=休み・振無休・移動・休)は除く)。
- **INV-08** 生徒行の写しトークンの教室 ID(`parentPortalTokenClassroomId` など、spec-parent-portal §0 の項目)が開いている教室 ID と違う。
- **INV-14** 教室データの欠け: 名簿・講師・教室設定・盤面の週のどれかが空(severity `check`)。
- INV-01(講師帰属)と INV-13(保留の下段が日程表に出ない)は日程表の出力を作らないと判定できない。`src/utils/scheduleHtml.ts` の日程表データの作り方をスナップショットから呼べるか調べ、呼べれば同じ作法で足す。呼べなければ `it.todo` に理由を書き、手順書に「未対応」と書く。

- [ ] **Step 1: テストを書く**(fixture は `tools/board-health-check.test.mjs` の最小スナップショットの作り方に倣う)。各ルールに「出る」「出ない」の対を 1 つずつ。特に: 休日に休みの記録だけが残っている机は出ない／休日に授業が残っている机は出る。既知(`known` の `rule`・`classroomId`・`dateKey`・`slotNumber`・`studentId` が一致)は数えない。出力に fixture の名前が含まれない(`--show-names` 無し)。
- [ ] **Step 2: 落ちるのを確認** — `npx vitest run tools/inv-audit.test.mjs` が FAIL(モジュールが無い)。
- [ ] **Step 3: 実装**。束ね方は `tools/vanished-makeup-report.mjs` の `build({ bundle: true, platform: 'node', format: 'esm', packages: 'external', loader: { '.css': 'empty' } })` と同じ。出力先は `node_modules/.cache/inv-audit-*`(実行後に消す)。テストからは `invAuditEntry.ts` を vitest で直接 import してよい。
- [ ] **Step 4: 通す** — `npx vitest run tools/inv-audit.test.mjs tools/board-health-check.test.mjs`。
- [ ] **Step 5: 本番の予行(読み取り専用・主セッションが行う)** — 健診の手順で落とした 2 校の最新ファイルに当て、件数を CHANGELOG と報告に書く。誤検知が見つかればルールを直す(テストを先に足す)。
- [ ] **Step 6: 手順書と CHANGELOG** — `docs/runbooks/morning-health-check.md` §4 に「教室ごとに `node tools/inv-audit.mjs <最新のファイル> --classroom <id> --known tools/board-health-known-issues.json`」と、§6 の報告の形に「保証台帳の違反: INV-xx n 件(今日以降 m 件)・生徒 ID」を足す。CHANGELOG: `- feat: 保証台帳(INV-12・INV-06・INV-08・INV-14)と休日の授業の違反を教室データから洗い出す読み取り専用ツール tools/inv-audit.mjs(アプリの権威関数を束ねて使う・生徒は ID だけ)。毎朝の健診に組み込んだ。`
- [ ] **Step 7: Commit** — `feat: 保証台帳の違反の洗い出しツール inv-audit と健診への組み込み INV-12 INV-06 INV-08 INV-14`

---

### Task 2: 生徒ごとの経緯ツール `tools/student-timeline.mjs`

**Files:**
- Create: `tools/student-timeline.mjs`(取得・CLI)・`tools/studentTimeline.lib.mjs`(純関数: 並べる・名前の置き換え・差の抽出)・`tools/student-timeline.test.mjs`
- Create: `docs/runbooks/student-inquiry.md`(室長の連絡を受けたときの調べ方)
- Modify: `CHANGELOG.md` 1 行

**Interfaces:**
- Consumes: `tools/snapshot-diff.mjs` の `decodeJsonBuffer`・`extractClassroomSnapshot`・`diffBoardWeeks`。生徒授業台帳の読み方は `tools/lesson-ledger-report.mjs`(圧縮の解き方)に合わせる。必要なら読み方の関数を export する(その 1 行だけの変更は可・既存テストを緑のまま)。
- Produces: `buildStudentTimeline(input: { studentId: string; roster: Array<{ id: string; name: string; displayName?: string }>; ledgerDays: LedgerDay[]; events: OperationEvent[]; traces: TraceDoc[]; versionDiffs: Array<{ dateKey: string; fromSavedAt: string; toSavedAt: string; desks: BoardDiffEntry[] }> }): Array<{ at: string; source: 'ledger' | 'event' | 'trace' | 'version'; text: string }>`。`maskNames(text, roster, { except?: string })` は名簿の名前・表示名を `sNNN` に置き換える。
- CLI: `node tools/student-timeline.mjs --workspace main --classroom <id> --student <sNNN> --from YYYY-MM-DD [--to YYYY-MM-DD] [--json] [--show-names]`。トークンは `FIRESTORE_ACCESS_TOKEN`(`tools/prod-readonly-token.mjs`)。

取得の手順(読み取りだけ・許す呼び方を表で固定):
1. 生徒授業台帳 `classroomSnapshots/{id}/lessonLedgerDays` を期間で `:runQuery`(`dateKey` の範囲)。その生徒の科目ごとの未消化・実績を日ごとに並べ、**前の日から変わった日**を「変化日」とする。
2. 操作ログ `operationEvents` と操作痕跡 `operationTraces` を期間で `:runQuery`(`recordedAt` は ISO 文字列で比べる)。生徒 ID を含む行(痕跡の要約は「名前#ID」の形)だけ残す。
3. 保存ごとの版 `classroom-save-history/{ws}/{id}/` を Storage の一覧(prefix・GET)で引き、**変化日とその前日**の最初と最後の版だけを落として `diffBoardWeeks` で比べ、その生徒の机だけ残す(全部の版は落とさない・1 日 60 本ある教室がある)。版の無い日は「この日の保存の版は無い」と 1 行出す。
4. 4 つを時刻順に 1 本へ。既定は名前を ID に置き換える。

- [ ] **Step 1: テストを書く**(純関数だけ・ネットワーク無し): 台帳から変化日を出す・痕跡の行を生徒 ID で絞る・名前を ID に置き換える(他の生徒の名前も)・版の差からその生徒の机だけ残す・時刻順に並ぶ・版の無い日を明示する・許していない呼び方(PATCH・`:commit` など)は取得層が例外にする。
- [ ] **Step 2: 落ちるのを確認**。
- [ ] **Step 3: 実装**。
- [ ] **Step 4: 通す** — `npx vitest run tools/student-timeline.test.mjs tools/snapshot-diff.test.mjs tools/lesson-ledger-report.test.mjs`。
- [ ] **Step 5: 本番の予行(読み取り専用・主セッションが行う)** — 緑が丘の生徒 s072 で 11/1〜今日。出力に名前が無いこと、変化日の版だけ落としていることを確かめる。
- [ ] **Step 6: 手順書** `docs/runbooks/student-inquiry.md`: 連絡の受け方(教室・生徒・いつ頃・何が)→ 経緯ツール → 必要なら洗い出し → 室長への返事(平易に・どこを押せば直るか)。CHANGELOG 1 行。
- [ ] **Step 7: Commit** — `feat: 生徒ごとの経緯ツール student-timeline と室長の連絡の調べ方`

---

### Task 3: 自動処理を操作痕跡に残す(アプリの変更)

**Files:**
- Modify: `src/components/schedule-board/ScheduleBoardScreen.tsx`(再反映の effect 10107 付近・起動時の自己修復 10188 付近)・`src/App.tsx`(QR 提出の反映 4992 付近・**App.tsx は -text 扱い。書き換え後に改行コードを元に戻す**・memory `komahyou-developer-report-button`)・`src/utils/operationTrace.ts`(自動処理の行の上限・同じ要約をまとめる)
- Test: `src/utils/operationTrace.test.ts`・`src/components/schedule-board/autoProcessTrace.wiring.test.ts`(新規)
- Modify: `docs/spec-developer-report.md` §D-3(記録するものの一覧に自動処理を足す)・`src/utils/verificationChecklist.ts`(項目 1 つ・VERSION は次にデプロイされる版)とそのテスト・`CHANGELOG.md` 1 行

**Interfaces:**
- Produces: `recordAutoBoardChange(kind: 'board-rebuild' | 'auto', label: string, before: SlotCell[][], after: SlotCell[][]): void`(`operationTrace.ts`)。`summarizeWeeksDiff(before, after)` が空なら何もしない。直前の自動処理の行と同じ要約なら記録しない。前回保存以降の自動処理の行が `OPERATION_TRACE_AUTO_SAVE_LIMIT = 50` を超えたら、それ以上は記録せず 1 回だけ「自動処理の記録を省略(上限)」を残す。
- 記録する場所と label: 再反映の effect =「再反映(基本データ・テンプレの変更)」、マウント時の再反映(`createInitialBoardSnapshot` が保存版から作り直した差)=「読み込み時の再反映」、起動時の自己修復 =「起動時の自己修復(QR 提出の講師)」、QR 提出の反映 =「QR 提出の反映」。
- **★再反映の effect は `setWeeks(updater)` の中で記録しない**。effect の中で現在の weeks(既存の ref があれば使う。無ければ足す)から `remergeBoardWeeksWithManagedData` の結果を作り、差を記録し、`setWeeks` には今と同じ関数更新を渡す方法など、**盤面の結果が今と同じになる形**を取る。盤面の計算結果が変わらないことをテストで固定する。

- [ ] **Step 1: テストを書く** — `operationTrace.test.ts`: 差なしは記録しない・同じ要約の連続は 1 行・上限 50 で止まり省略の行は 1 回だけ・保存成功で上限の数え直し。配線テスト(既存の作法 = `readFileSync` で字面): 4 か所が `recordAutoBoardChange` を呼ぶ・`setWeeks((currentWeeks) =>` の中に `recordOperationTrace` / `recordAutoBoardChange` が無い。
- [ ] **Step 2: 落ちるのを確認**。
- [ ] **Step 3: 実装**(regression-guard に従い、触る effect の変遷を `git log -L` で確認してから)。
- [ ] **Step 4: 通す** — `npx vitest run src/utils/operationTrace.test.ts src/components/schedule-board` と全体。
- [ ] **Step 5: 確認リスト** — 項目: 操作「基本データで確認用の生徒の通常授業の時限を変える → 盤面へ戻る → 保存 → 『質問・要望』から送る」・確認「送った報告の最近の操作に『自動: 再反映…』の行がある」(報告画面に最近の操作が出ない場合は、確認を「保存できる・盤面は今までどおり」にし、行の有無は Claude がツールで読む、と項目の文に書く)。
- [ ] **Step 6: 仕様と CHANGELOG** — `docs/spec-developer-report.md` §D-3 に自動処理の 4 か所と上限を足す。CHANGELOG: `- feat: 自動処理(読み込み時と基本データ変更時の再反映・起動時の自己修復・QR 提出の反映)が盤面を変えたとき、変わった机の要約を操作痕跡に残す(机が変わったときだけ・同じ要約はまとめる・1 回の保存あたり 50 件まで)。「勝手に変わった」の理由を後から追えるようにするため。盤面・保存・在庫は不変。 触れる INV: INV-02・INV-03`
- [ ] **Step 7: Commit** — `feat: 自動処理が盤面を変えたら操作痕跡に残す INV-02 INV-03`

---

### Task 4(主セッション): 台帳・メモリ・リリース

- 進行中テーマ台帳の「全教室展開週」の行の summary/notes に洗い出しと経緯ツールを足す。メモリ `komahyou-rollback-readiness-week-2026-11-09.md` に今回の決定(オーナー 11/9:「戻すより質問への回答とバグ時の生徒処理が優先」「保証台帳に違反しているものがバグ」「休日の授業はバグ」)を追記。
- lint・unit・build・functions の型検査 → regression-reviewer の全体レビュー → main マージ → `version.json` 確認。
- 健診のスケジュール実行の指示文に「洗い出しも回す」を足す(手順書 §4 を読むので指示文の変更は 1 行)。
