# 全教室展開週(11/9〜11/15)の戻し準備と毎朝の健診 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v1.5.711 で全教室へ出した 4 機能(保護者QR `parentPortalQr`・講習の公開 `lectureSchedulePublishToggle`・講師専用講習 `teacherOnlySpecialSession`・テンプレ差分反映 `templateDiffApply`)を、今週トラブルが出たときに **1 機能ずつ安全に止められる**ようにし、本番 2 校の異変を **毎朝自動で読み取り専用に点検**する。

**Architecture:** (1) テンプレ差分反映のフラグ OFF で保留の机が壊れる穴(仕様 N-1)を「保留が 1 件でもある教室は OFF でも第 2 版の経路を使う」(データで決まる方式・講師専用講習と同じ流儀)で塞ぐ。(2) 4 本それぞれの「ON の間に書かれたデータを OFF の版が消さない・ON に戻せば元どおり」を回帰防止テストで固定する。(3) フラグを戻すコード変更(scope・サーバー側・進行中テーマ台帳・CHANGELOG)を純関数＋CLI にして手順書を添える。(4) 2 時点の教室データと保存記録から異変を列挙する純関数ツールを作り、Claude のスケジュール実行(毎朝 7:40 JST・11/9〜11/15・新セッション・読み取り専用トークン)で報告する。

**Tech Stack:** React + TypeScript(vitest)・Node ESM ツール(`tools/*.mjs`・`node --test`)・Firestore REST / Storage JSON API(読み取り専用)・Claude Code のスケジュール実行。

**Spec:** 設計はオーナー確定(2026-11-08・この計画の元になった会話。採用=案 1「フラグ戻しの準備」＋案 4「毎朝の健診」、N-1 は実装、戻し方はスクリプト＋手順書、健診は 7:40 JST・プッシュ通知)。既存の正本: `docs/spec-template-behavior.md` §H Q33(N-1 の定義・1243 行付近の `lower.teacher` の注意)・`src/utils/featureRollout.ts` の各フラグのコメント(OFF の意味)・`docs/spec-parent-portal.md` §H(両側同時)・`docs/spec-save-restore.md` §8-1(保持と置き場)・§10-3(教室別バックアップの形)・`docs/runbooks/rollback.md`(A-1 の N-1 注意)。

## Global Constraints

- 本番データ保護ルール(CLAUDE.md): Firestore / Storage は **GET と読み取り専用 POST(`:runQuery`)だけ**。書き込みは一切しない。ツールはネットワークへ出ない純関数＋薄い CLI に分け、取得は手順書のコマンドで別に行う。
- 公開リポジトリ: 生徒・講師・保護者の実名をテスト・文書・ツールの出力例に書かない(テストの名前は「生徒A」等、出力は生徒 ID だけ)。
- すべての変更はテスト先行(`superpowers:test-driven-development`)。修正前に落ちるのを見てから実装する。アプリのコードに触れない変更(文書・手順書)は対象外。
- 回帰防止: 既存の「フラグ OFF では従来どおり(条件 26)」のテスト(`templatePendingBoard.wiring.test.ts` 519 行〜・`templatePendingDesks.wiring.test.ts` 280 行〜)は **assert を薄めず**、N-1 の新しい意味(「フラグ OFF かつ保留なし」が従来どおり)に文言を合わせる。`*.matrix.test.ts` の assert 薄化は禁止(CI の inv-guard)。
- `package.json` の version は手で変えない。CHANGELOG `## 未リリース` に 1 行ずつ追記し、main マージ直前に次の版(package.json の patch +1)でラベル付け。
- INV: この計画が触れるのは INV-06(在庫の保存)・INV-02(手入力の不可侵)・INV-12(同じコマに同じ生徒 2 か所)・INV-13(保留の下段は盤面専用)。コミットメッセージと CHANGELOG に `INV-06 INV-02` 等を書く。
- 進行中テーマ台帳 `src/utils/developmentStatusLedger.ts` の行は title 40 字・summary 140 字・nextAction 110 字・社内記号なし(テストが検出)。
- 確認リスト: N-1 は開発用教室(フラグ ON)では確かめられないので項目を足さない(理由を CHANGELOG に書く)。健診・戻しスクリプトはアプリ画面に出ないので項目なし。
- `ScheduleBoardScreen.tsx` は巨大ファイル。変更は `templateDiffApplyEnabled` の定義 1 行とコメントに留め、判定の本体は純関数へ出す。改行コードは触らない(`git diff --stat` で全行差分が出たら CRLF 事故。戻してやり直す)。

## Review Focus

1. **OFF＋保留あり＋旧版タブ**: 保留の下段(在庫由来の講習)を持つ教室でフラグ OFF の版がテンプレ保存しても講習の在庫(ストック)が減らない — Task 1 の INV-06 テストで固定。
2. **保留を全部解消した瞬間**: OFF の教室で最後の保留を片づけると同じセッション内で旧方式へ切り替わる。切り替わった直後の再マージで席・記録・在庫が消えない — Task 1 のテストで「保留 0 件になった後の再マージ」を固定。
3. **保護者QRの片側戻し**: スクリプトが `parentPortalQr` だけサーバー側(`PARENT_PORTAL_BASE_SCOPE`)を書き換え忘れると「QR は出ないのに API は答える」非対称になる — Task 3 のテストで両ファイルの書き換えを固定。
4. **既知の 2 か所配置(緑が丘 11/18・11/25 5限)**: 毎朝の健診が既知を毎日「異常」と鳴らすと本物を見落とす — Task 4 の既知除外テストで固定。
5. **名前の漏れ**: 健診の出力に生徒名・講師名が混じるとスケジュール実行の報告(セッション本文・通知)に実名が出る — Task 4 で「fixture の名前が出力に含まれない」テストで固定。

---

### Task 1: N-1 — 保留のある教室はフラグ OFF でも第 2 版の経路を使う

**Files:**
- Modify: `src/components/schedule-board/templatePendingDesks.ts`(純関数を追加)
- Modify: `src/components/schedule-board/ScheduleBoardScreen.tsx:9334`(`templateDiffApplyEnabled` の定義)と同行付近のコメント
- Modify: `src/utils/featureRollout.ts:200-209`(templateDiffApply のコメント: OFF の意味に N-1 を追記)
- Test: `src/components/schedule-board/templatePendingDesks.wiring.test.ts`(N-1 の describe を追加・280 行〜の文言合わせ)
- Test: `src/components/schedule-board/templatePendingBoard.wiring.test.ts:519-530`(文言合わせのみ・assert は薄めない)
- Test: `src/components/schedule-board/inv06-template-pending-rollback.matrix.test.ts`(新規・在庫の固定)
- Docs: `docs/spec-template-behavior.md`(§H Q33 N-1 の状態を「塞いだ(2026-11-08・データで決まる方式)」に)、`docs/spec-template-conflict-v2.md` §7 の表に 1 行、`docs/spec-invariants.md` INV-06 の templateDiffApply 関連の注記(あれば N-1 済みに)、`docs/runbooks/rollback.md` A-1 の N-1 注意を「保留は守られる。保留の残る教室は解消まで第 2 版のまま」に書き換え、`CHANGELOG.md` `## 未リリース` に 1 行

**Interfaces:**
- Produces: `resolveTemplateDiffApplyActive(params: { flagEnabled: boolean; pendingDesks: TemplatePendingDeskMap | null | undefined }): boolean` in `templatePendingDesks.ts`。`flagEnabled || hasTemplatePendingDesks(pendingDesks)`。
- `ScheduleBoardScreen.tsx` の `templateDiffApplyEnabled` は `resolveTemplateDiffApplyActive({ flagEnabled: isFeatureEnabledForClassroom('templateDiffApply', { id: classroomStorageKey }), pendingDesks: templatePendingDesks })` から求める(`templatePendingDesks` は同コンポーネントの state。9334 行時点で参照できる位置へ定義を動かしてよいが、state の宣言順だけを変え、ほかの行は触らない)。
- 以降のタスクはこの関数名に依存しない。

- [ ] **Step 1: 純関数のテストを書く**(`templatePendingDesks.wiring.test.ts` に `describe('N-1: 保留のある教室はフラグ OFF でも第 2 版の経路(2026-11-08)')`)

```ts
it('フラグ ON なら保留の有無に関わらず true', () => {
  expect(resolveTemplateDiffApplyActive({ flagEnabled: true, pendingDesks: undefined })).toBe(true)
})
it('フラグ OFF でも保留が 1 件でもあれば true(保留の机を周辺処理が壊さない・INV-06)', () => {
  expect(resolveTemplateDiffApplyActive({ flagEnabled: false, pendingDesks: { 'c1::d1': { lower: { students: [], /* 最小の下段 */ } } as never } })).toBe(true)
})
it('フラグ OFF で保留なし(未設定・空)は false(従来どおり)', () => {
  expect(resolveTemplateDiffApplyActive({ flagEnabled: false, pendingDesks: undefined })).toBe(false)
  expect(resolveTemplateDiffApplyActive({ flagEnabled: false, pendingDesks: {} })).toBe(false)
})
```

- [ ] **Step 2: 配線テストを書く**(同 describe)。`ScheduleBoardScreen.tsx` の本文を `readFileSync` で読み、`templateDiffApplyEnabled = resolveTemplateDiffApplyActive(` を含むこと、`isFeatureEnabledForClassroom('templateDiffApply'` が **その 1 か所にだけ**現れることを assert する(既存の配線テストと同じ作法)。

- [ ] **Step 3: INV-06 マトリクスを書く**(`inv06-template-pending-rollback.matrix.test.ts` 新規)。既存の `inv06-*.matrix.test.ts` の作法(`createInitialBoardSnapshot` と純関数の組み合わせ)で:
  - 準備: 保留 1 件(下段が在庫由来の講習 1 コマ)を持つ `PersistedBoardState`。
  - ケース A: `flagEnabled: false` でも `resolveTemplateDiffApplyActive` が true になり、テンプレ保存の分岐が **差分反映(`templateReportMode === 'diff'`)** になること。分岐の判定が純関数に出ていなければ、`ScheduleBoardScreen.tsx:12968` の `templateReportMode` の決め方を `resolveTemplateReportMode(active: boolean): 'diff' | 'overwrite'` として `templateDiffApply.ts` へ出してから assert する(挙動不変)。
  - ケース B(修正前に落ちる本体): 旧方式の上書き(`templatePendingDesks.wiring.test.ts:200` の describe が使っている純関数)に **保留を渡さず**通すと下段の講習コマが台帳へ戻らず消える(在庫 −1)が、N-1 後は差分反映経路に入るため在庫が変わらない(0)。在庫の数え方は同ファイル群の既存テストが使う `countPlannedMakeupsByKey` 等をそのまま使う。
  - ケース C: 保留を解消して 0 件になった後の再マージで、席・記録・在庫が変わらない(保留 0 件→従来経路に戻ることの確認。既存の OFF 再マージテストのフィクスチャを流用)。

- [ ] **Step 4: テストを走らせて落ちるのを確認**

Run: `npx vitest run src/components/schedule-board/templatePendingDesks.wiring.test.ts src/components/schedule-board/inv06-template-pending-rollback.matrix.test.ts`
Expected: FAIL(`resolveTemplateDiffApplyActive` が無い・ケース B で在庫 −1)

- [ ] **Step 5: 実装** — `templatePendingDesks.ts` に `resolveTemplateDiffApplyActive` を追加(JSDoc に N-1・2026-11-08・「データで決まる方式=講師専用講習と同じ」を書く)。`ScheduleBoardScreen.tsx:9334` を置き換え、コメントに「★回帰防止: フラグだけで判定に戻すと N-1(保留の在庫が消える)が再発する」と書く。`featureRollout.ts` の templateDiffApply コメントの OFF 行に「保留のある教室は OFF でも第 2 版の経路(N-1・`resolveTemplateDiffApplyActive`)」を追記。

- [ ] **Step 6: 既存テストの文言合わせ** — `templatePendingBoard.wiring.test.ts:519-530` と `templatePendingDesks.wiring.test.ts:280-300` の「フラグ OFF では従来どおり」を「フラグ OFF かつ保留なしでは従来どおり」に。assert の対象・件数は変えない。

- [ ] **Step 7: 関連テストを全部通す**

Run: `npx vitest run src/components/schedule-board`
Expected: PASS(新規 3 describe を含む・既存は全件据え置き)

- [ ] **Step 8: 文書** — 上記 Docs の 5 か所と CHANGELOG(`- fix: テンプレ差分反映のフラグを OFF に戻しても保留(緑の 2 行)のある教室は第 2 版の経路を使い続け、保留の机と下段の講習の在庫を守る(仕様 N-1・全教室展開週の戻し準備)。保留 0 件の教室だけが旧方式へ戻る。確認リストの項目なし(開発用教室はフラグ ON で確かめられない)。 触れる INV: INV-06・INV-02`)。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix: 保留のある教室はテンプレ差分反映のフラグ OFF でも第 2 版の経路を使う(N-1・戻し準備) INV-06 INV-02"
```

---

### Task 2: 戻し互換テスト(4 フラグ: ON の間のデータを OFF の版が消さない・ON に戻せる)

**Files:**
- Test: `src/components/schedule-board/templateConflictRules.test.ts`(出自の印の往復)
- Test: `src/components/special-data/schedulePublish.test.ts`(非公開の講習)
- Test: `src/components/special-data/teacherOnlySpecialSession.test.ts`(講師専用の講習)
- Test: `src/components/basic-data/parentPortal*.test.ts` または `src/utils/parentPortal*.test.ts`(写しトークン。既存のテストファイルを `grep -rl parentPortalQr src --include=*.test.ts` で選ぶ)
- Modify(テストが落ちた場合だけ): 該当の normalize / serialize 関数
- Docs: `CHANGELOG.md` 1 行

**Interfaces:**
- Consumes: Task 1 の `resolveTemplateDiffApplyActive`(保留の往復は Task 1 が固定済み。ここでは扱わない)。
- Produces: なし(テストのみ)。

- [ ] **Step 1: 出自の印** — `templateConflictRules.test.ts` に `describe('戻し互換: フラグ OFF の版でも出自の印を消さない(2026-11-08)')`。`placementOrigin` 付きの生徒を含む `AppSnapshot` を `serializeAppSnapshot` → `parseAppSnapshot`(`src/data/appSnapshotRepository.ts`)で往復し、`placementOrigin` が同じ値で残ることを assert。`createInitialBoardSnapshot({ ..., applyTemplateOriginRules: false })` を通しても印が落ちないことも assert。
- [ ] **Step 2: 非公開の講習** — `schedulePublish.test.ts` に `it('フラグ OFF の教室では schedulePublished:false の講習も公開として扱うが、項目は保存で消えない(ON に戻せば再び非公開)')`。公開判定の純関数(同ファイルが既に使っているもの)に OFF を渡して公開扱い、`SpecialSessionRow` の正規化(`specialSessionModel.ts`)で `schedulePublished: false` が残ることを assert。
- [ ] **Step 3: 講師専用の講習** — `teacherOnlySpecialSession.test.ts` に、フラグ OFF でも `teacherOnly: true` の講習が `selectStudentFacingSpecialSessions` から外れ、正規化で項目が残ることの it が無ければ追加(あれば名前に「戻し互換」を足すだけ)。
- [ ] **Step 4: 保護者QRの写しトークン** — 生徒データの写しトークン(`docs/spec-parent-portal.md` §0 の項目名)が、フラグ OFF の `createInitialBoardSnapshot` / 名簿の正規化 / `serializeAppSnapshot` 往復で剥がれないことを assert。サーバー側は既存 `functions/src/parentPortal.test.ts:558`(OFF は 403・トークン失効なし)で足りるので触らない。
- [ ] **Step 5: 走らせる**

Run: `npx vitest run src/components/schedule-board/templateConflictRules.test.ts src/components/special-data src/components/basic-data`
Expected: PASS が基本。落ちたものは「OFF で項目を捨てる正規化」なので、捨てないように直す(修正は最小・同コミット)。

- [ ] **Step 6: CHANGELOG と Commit** — `- test: 全教室展開した 4 機能のフラグを OFF に戻しても、ON の間に書かれたデータ(出自の印・非公開の講習・講師専用の講習・保護者QRの写しトークン)が消えず ON に戻せば元どおり動くことを回帰防止テストで固定(戻し準備)。`

```bash
git add -A
git commit -m "test: 4 機能のフラグ戻し互換(ON のデータを OFF の版が消さない)を固定 INV-06"
```

---

### Task 3: 戻しスクリプト `tools/feature-flag-rollback.mjs` と手順書

**Files:**
- Create: `tools/feature-flag-rollback.mjs`(純関数＋CLI。既存 `tools/snapshot-diff.mjs` と同じく `import.meta.url` で直接実行判定・`tools/invoked-directly.mjs` を使う)
- Create: `tools/feature-flag-rollback.test.mjs`(`node --test`)
- Create: `docs/runbooks/feature-flag-rollback.md`
- Modify: `docs/runbooks/rollback.md`(「どれを戻すか」の表に「機能フラグ」の行と D 節へのリンク)、`package.json` の `scripts` に `"flag:rollback": "node tools/feature-flag-rollback.mjs"`(version は触らない)、`CHANGELOG.md` 1 行

**Interfaces:**
- Produces: `applyFeatureFlagRollback(input: { files: Record<string, string>; flagKey: string; toScope: 'development-only' | 'staging-environment'; reason: string; today: string }): { files: Record<string, string>; changedPaths: string[]; ledgerRow: string }`。`files` のキーは次の 4 つの相対パスに固定: `src/utils/featureRollout.ts`・`functions/src/parentPortal.ts`・`src/utils/developmentStatusLedger.ts`・`CHANGELOG.md`。
- CLI: `node tools/feature-flag-rollback.mjs <flagKey> --reason "<理由>" [--to development-only|staging-environment] [--dry-run]`。`--to` の既定は、そのフラグが v1.5.711 直前に持っていた scope(`parentPortalQr`/`lectureSchedulePublishToggle`/`teacherOnlySpecialSession` = `staging-environment`、`templateDiffApply` = `development-only`。表 `PREVIOUS_SCOPES` として export)。`--dry-run` は差分の要約だけ出し、書かない。

- [ ] **Step 1: テストを書く**(`feature-flag-rollback.test.mjs`。fixture は実ファイルを読まず、該当ブロックだけを模した短い文字列を使う)

```js
test('templateDiffApply を development-only へ: featureRollout.ts の scope だけが変わり parentPortal.ts は不変', ...)
test('parentPortalQr を staging-environment へ: featureRollout.ts と parentPortal.ts の PARENT_PORTAL_BASE_SCOPE の両方が変わる', ...)
test('台帳に stage=toScope・featureKeys=[flagKey] の行を 1 つ足し、title<=40・summary<=140・nextAction<=110 で社内記号を含まない', ...)
test('CHANGELOG の「## 未リリース」直下に "- fix: 機能フラグ <key> を全教室から <scope> へ戻す(理由: <reason>・戻し手順書)" を 1 行入れる', ...)
test('未知のキー・all-classrooms でないフラグ・reason 空はエラー(何も書かない)', ...)
test('同じ入力を 2 回当てても 2 回目は何も変えない(冪等)', ...)
```

- [ ] **Step 2: 落ちるのを確認**

Run: `node --test tools/feature-flag-rollback.test.mjs`
Expected: FAIL(モジュールが無い)

- [ ] **Step 3: 実装** — 正規表現は「`  <key>: {` の次の行の `scope: 'all-classrooms'`」だけを置き換える(他のフラグに触れない)。`parentPortal.ts` は `PARENT_PORTAL_BASE_SCOPE: '...' | '...' = 'all-classrooms'` の右辺だけ。台帳の行は `DEVELOPMENT_STATUS_ITEMS`(配列名はファイルで確認)の先頭へ挿入。title は `「<画面の呼び名>」を <scope の日本語> に戻した`(呼び名の表 `FLAG_DISPLAY_NAMES` を export: 保護者向けQR／講習の公開／講師専用の特別講習／テンプレ保存の差分反映)。CLI はリポジトリ直下からの相対パスで読み書きし、変更後に `changedPaths` と「次にやること(npm test → git diff → commit → main マージ → version.json 確認 → parentPortalQr は Functions デプロイの緑も確認)」を標準出力に出す。
- [ ] **Step 4: 通す**

Run: `node --test tools/feature-flag-rollback.test.mjs`
Expected: PASS

- [ ] **Step 5: 本物のファイルで dry-run を 4 本試し、台帳テストも通ることを確かめる**

Run: `for k in templateDiffApply parentPortalQr lectureSchedulePublishToggle teacherOnlySpecialSession; do node tools/feature-flag-rollback.mjs $k --reason "予行" --dry-run; done`
Expected: 各 1〜2 ファイル＋台帳＋CHANGELOG の変更要約。実ファイルは不変(`git status --porcelain` が空)。
次に 1 本だけ本当に当てて `npx vitest run src/utils/developmentStatusLedger.test.ts src/utils/featureRollout.test.ts` が通るのを見てから `git checkout -- .` で戻す(戻し忘れ防止に `git status` が空を確認)。

- [ ] **Step 6: 手順書を書く**(`docs/runbooks/feature-flag-rollback.md`)。見出し: いつ使うか(症状→どのフラグか)／共通手順(5 分: スクリプト→テスト→diff→commit→main マージ→`version.json`→端末のハードリロード案内)／機能ごとの事前確認と戻した後の見え方:
  - テンプレ差分反映: 保留のある教室は N-1 で守られ第 2 版のまま(保留を解消すると旧方式へ)。戻す前に本番 2 校の保留件数を読み取り専用で数える(コマンド例: Firestore REST で `classroomSnapshots/{id}` を GET し `templatePendingDesks` のキー数)。
  - 講習の公開: 戻すと非公開の講習が提出用QR・保護者QRに出る。先に `schedulePublished: false` の講習を一覧にして室長へ知らせる。
  - 保護者QR: 両側同時(スクリプトが両方書く)。Functions デプロイの緑まで保護者ページは 403。室長へ案内。
  - 講師専用: データで決まるので見え方は変わらない。チェックが出なくなるだけ。
- [ ] **Step 7: CHANGELOG と Commit** — `- feat: 機能フラグを 1 本ずつ全教室から戻すスクリプト tools/feature-flag-rollback.mjs(scope・保護者QRのサーバー側・進行中テーマ台帳・CHANGELOG を一度に書き換える・テストつき)と手順書 docs/runbooks/feature-flag-rollback.md(全教室展開週の戻し準備)。`

```bash
git add -A
git commit -m "feat: 機能フラグの戻しスクリプトと手順書(全教室展開週の戻し準備)"
```

---

### Task 4: 健診ツール `tools/board-health-check.mjs`(2 時点の教室データの点検・純関数)

**Files:**
- Create: `tools/board-health-check.mjs`(純関数＋CLI。読み込みと教室の取り出しは `tools/snapshot-diff.mjs` の `readStoredSnapshotPayload` / `extractClassroomSnapshot` / `isGzipBuffer` を import して再利用)
- Create: `tools/board-health-check.test.mjs`(`node --test`)
- Modify: `CHANGELOG.md` 1 行

**Interfaces:**
- Produces: `buildBoardHealthReport(input: { classroomId: string; before: AppSnapshotPayload | null; after: AppSnapshotPayload; saveAttempts?: Array<{ status: string; savedAt?: string; errorMessage?: string }>; developerReports?: Array<{ reportId: string; kind?: string; createdAt?: string }>; knownIssues?: Array<{ classroomId: string; dateKey: string; slotNumber: number; studentId: string }> }): { findings: Array<{ severity: 'warn' | 'info'; code: string; message: string }>; counts: Record<string, number> }`。`formatBoardHealthText(report, { classroomLabel }): string`(日本語・生徒は ID だけ)。
- CLI: `node tools/board-health-check.mjs <前のファイル|-> <後のファイル> --classroom <id> [--save-attempts <json>] [--reports <json>] [--known <json>] [--json]`。前のファイルが `-` なら差分の検査を省く。
- `code` の一覧(export `HEALTH_CODES`): `duplicate-placement`(INV-12)・`pending-count`・`pending-delta`・`whole-day-pair-count`・`origin-mark-count`・`roster-shrink`・`teacher-shrink`・`makeup-drop`・`desk-change-burst`・`save-failed`・`save-none`・`user-report`。

- [ ] **Step 1: テストを書く**(fixture は `tools/snapshot-diff.test.mjs` の最小スナップショット作りを真似る。生徒名は「生徒A」「生徒B」)

```js
test('同じコマの 2 つの机に同じ生徒(managedStudentId・無ければ name)が居れば duplicate-placement を warn で出し、メッセージは日付・時限・机 2 つ・生徒 ID だけ', ...)
test('knownIssues に載っている組み合わせは duplicate-placement に数えない(緑が丘 11/18・11/25 5限の既知)', ...)
test('templatePendingDesks のキー数を pending-count に、前日との差を pending-delta に出す(前なしなら delta なし)', ...)
test('WHOLE_DAY_PAIR__ で始まるキーの数と placementOrigin 付き生徒の数を counts に入れる(info)', ...)
test('名簿の生徒 ID が前より減れば roster-shrink、講師が減れば teacher-shrink を warn', ...)
test('盤面の振替(lessonType が振替)のコマ数が前より 10 件以上または 10% 以上減れば makeup-drop を warn', ...)
test('机単位の変更が 200 を超えれば desk-change-burst を info(snapshot-diff の diffBoardWeeks を使う)', ...)
test('saveAttempts に too-large / write-failed / verification-failed / stale があれば save-failed を warn、24 時間で 0 件なら save-none を info', ...)
test('developerReports があれば user-report を warn(reportId と kind だけ)', ...)
test('formatBoardHealthText の出力に fixture の生徒名・講師名が 1 文字も含まれない', ...)
test('findings が無ければ 1 行「異常なし」', ...)
```

- [ ] **Step 2: 落ちるのを確認**

Run: `node --test tools/board-health-check.test.mjs`
Expected: FAIL(モジュールが無い)

- [ ] **Step 3: 実装** — 盤面の読み方: `payload.board.weeks`(`SlotCell[][]`・`cell.desks[].students[]`)。`WHOLE_DAY_PAIR__` の在りかは `grep -rn WHOLE_DAY_PAIR__ src --include=*.ts | grep -v test` で確認し、その項目のキーを数える。出自の印は `student.placementOrigin`。振替は `lessonType` の振替値(`src/components/schedule-board/types.ts` の `LessonType` で確認)。閾値は定数で export(`MAKEUP_DROP_MIN = 10`・`MAKEUP_DROP_RATIO = 0.1`・`DESK_CHANGE_BURST = 200`)。
- [ ] **Step 4: 通す**

Run: `node --test tools/board-health-check.test.mjs tools/snapshot-diff.test.mjs`
Expected: PASS

- [ ] **Step 5: CHANGELOG と Commit** — `- feat: 2 時点の教室データと保存記録から異変(同じコマに同じ生徒 2 か所・保留と組と出自の印の件数・名簿と講師の減少・振替の急減・保存失敗・利用者報告)を日本語で列挙する読み取り専用ツール tools/board-health-check.mjs(生徒は ID だけ・既知の 2 か所は除外・テストつき)。全教室展開週の毎朝の健診に使う。`

```bash
git add -A
git commit -m "feat: 教室データの毎朝の健診ツール board-health-check(読み取り専用・INV-12 ほか)"
```

---

### Task 5: 健診の手順書と予行(読み取り専用)

**Files:**
- Create: `docs/runbooks/morning-health-check.md`
- Modify: `docs/runbooks/monitoring.md`(目次に 1 行)、`CHANGELOG.md` 1 行

**Interfaces:**
- Consumes: Task 4 の CLI。`tools/prod-readonly-token.mjs`(トークン)。
- Produces: スケジュール実行のプロンプトが指す手順(Task 6 がそのまま使う)。

- [ ] **Step 1: 手順書を書く**。内容(すべて読み取り):
  1. `export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)`。
  2. 時点の選び方: 最新 = `workspaces/main/workspaceAutoBackupSummaries` を `:runQuery` で `savedAt desc limit 1`。前日 = 文書 ID `YYYY-MM-DDT03-00`(JST 3:00 の日次アンカー。無ければ `T02-45`・`T03-15` の順に探す)。
  3. 取得: 要約の `layout` が `per-classroom-v1` なら `workspace-auto-backups/main/15min/{key}/{classroomId}.json.gz` を Storage JSON API `GET https://storage.googleapis.com/storage/v1/b/komahyouapp-prod.firebasestorage.app/o/<URL エンコードしたパス>?alt=media` で落とす(`legacy` なら `{key}.json` 1 本)。置き場はスクラッチ領域。
  4. 保存記録: `classroomSnapshots/{id}/saveAttempts` を `savedAt >= 24 時間前` で `:runQuery`。利用者報告: `workspaces/main/developerReports` を `createdAt >= 前日 7:40 JST` で `:runQuery`(本文は読まない・件数と種類だけ)。
  5. 教室 2 校(日大前 `5w5OMueETerSKrSf14HC`・緑が丘 `KzFnOQoTFLsCxwUp1tvh`)で `node tools/board-health-check.mjs <前> <後> --classroom <id> --save-attempts ... --reports ... --known tools/board-health-known-issues.json`。既知ファイルは手順書と同じコミットで作る(緑が丘の生徒 s072・11/18・11/25・5限。実名は書かない)。
  6. GitHub: 利用者報告 Issue(`gh api -X GET search/issues -f q='repo:Kake-git-hub/KomahyouApp label:source:user-report is:open created:>=<前日>'`)と外形監視の最新実行(Actions `uptime-check.yml`)。
  7. 報告の形(日本語・生徒は ID): 見出し「11/10(月) 7:40 の健診」→ 教室ごとに warn → info → 保存回数 → 利用者報告 → 外形監視。異常ゼロなら「異常なし(日大前 保存 n 回・緑が丘 保存 m 回)」の 1 行。実名・保護者名は書かない。
  8. やってはいけないこと: 書き込み・復元・コピー・Functions 呼び出し。異常を見つけたら**報告だけ**し、直さない。
- [ ] **Step 2: 予行** — 手順書どおりにこのセッションで 1 回通す(今日の時点で)。トークン作成・取得・ツール実行・報告文まで。出力に実名が無いことを目で確認し、取得ファイルはスクラッチ領域に置いたまま(リポジトリへ入れない)。手順書に食い違いがあれば直す。
- [ ] **Step 3: CHANGELOG と Commit** — `- docs: 毎朝の健診の手順書 docs/runbooks/morning-health-check.md(読み取り専用・11/9〜11/15 の全教室展開週・7:40 JST のスケジュール実行が従う)と既知の 2 か所の除外リスト。`

```bash
git add -A
git commit -m "docs: 毎朝の健診の手順書と既知の除外リスト(全教室展開週)"
```

---

### Task 6: 台帳・メモリ・リリース

**Files:**
- Modify: `src/utils/developmentStatusLedger.ts`(行を 1 つ追加: title「全教室展開週の戻し準備と毎朝の健診」・stage `in-progress`・summary「4 機能を 1 本ずつ止められるようにし、11/15 まで毎朝 7:40 に本番 2 校を読み取りだけで点検して報告する。」・nextAction「11/16 に健診を止め、この行を消す。」・featureKeys なし)
- Modify: `src/utils/developmentStatusLedger.test.ts`(行数や固定の期待があれば追随)
- Create: `.claude/memory/komahyou-rollback-readiness-week-2026-11-09.md`(frontmatter つき・採用案と見送り案・N-1 の方式・健診の止め方)、`.claude/memory/MEMORY.md` に索引 1 行
- Modify: `CHANGELOG.md`(`## 未リリース` → 次の版でラベル付け)

- [ ] **Step 1: 台帳の行を足し、テストを通す**

Run: `npx vitest run src/utils/developmentStatusLedger.test.ts`
Expected: PASS

- [ ] **Step 2: メモリを書く**(実名なし)。
- [ ] **Step 3: 回帰確認の全部**

Run: `npm run lint && npx vitest run && npm run build`
Expected: すべて PASS(lint 0 error)

- [ ] **Step 4: CHANGELOG の `## 未リリース` を `## v1.5.<package.json の patch +1> (2026-11-08)` にし、新しい空の `## 未リリース` を上に作る。Commit**

```bash
git add -A
git commit -m "chore: 進行中テーマ台帳・メモリ・CHANGELOG を v1.5.<次の版> でラベル付け(全教室展開週の戻し準備) INV-06"
```

- [ ] **Step 5(主セッション):** regression-reviewer の全体レビュー → 指摘反映 → main へマージ → `version.json` の版を確認 → Task 7 へ。

---

### Task 7(主セッションが行う・コード変更なし): スケジュール登録

- [ ] main 反映後に `create_trigger`: name「全教室展開週の毎朝の健診(11/9〜11/15)」・`cron_expression` `CRON_TZ=Asia/Tokyo 40 7 9-15 11 *`・`create_new_session_on_fire: true`・`notifications: { push: true }`・prompt は独立した指示(リポジトリが無ければ `git clone https://github.com/Kake-git-hub/KomahyouApp.git` → `docs/runbooks/morning-health-check.md` を読んで従う・読み取りだけ・報告は日本語・実名を書かない・異常は報告だけで直さない)。
- [ ] 登録結果(ID・次回実行)をオーナーへ報告。11/16 以降は cron の日付範囲で自然に止まる。台帳の行の削除は 11/16 以降の作業。
