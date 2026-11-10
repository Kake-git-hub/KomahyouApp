# 画面の自動巡回（第 1 段） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> このリポジトリの上書き（`CLAUDE.md`「Superpowers との使い分け」）: 実装係は `dev-fix` エージェント、レビュー係は `regression-reviewer` エージェント 1 人。worktree は作らない。PR は作らない。

**Goal:** 本番の形のデータ（名前は伏せる）を手元のアプリに入れ、室長と同じ画面操作を自動で行い、操作のたびに「変なことが起きていないか」を機械で点検する道具 `tools/ui-patrol.mjs` を作る。

**Architecture:** 道具は Node で動く。本番 2 校の最新バックアップを読み取りだけで取り、伏せ字にして、ローカルモードの開発用サーバーで開いたアプリのブラウザ保存領域へ「アプリが起動する前に」入れる。Playwright の Chromium で画面を操作し、開発用ビルド＋ローカルモード限定の読み口 `window.__komahyouUiPatrol` から盤面を読み、アプリの権威関数を束ねた点検（変わってよい範囲・手入力・保証台帳）に通す。

**Tech Stack:** Node 22（ESM `.mjs`）・TypeScript（アプリの関数を使う判定は `.ts`。道具からは esbuild で束ねて読む＝`tools/inv-audit.mjs` と同じ作法）・vitest（`tools/**/*.test.mjs`）・Playwright（環境に入っているものを `createRequire` で読む。`package.json` には足さない）・Vite 開発用サーバー。

**Spec:** `docs/test-strategy.md` の「画面の自動巡回（層 5）」。実装係はこの節を必ず読む。

## Global Constraints

- **本番データは読み取りだけ。** 使ってよい通信は Storage JSON API の GET と Firestore REST の `:runQuery`（読み取り）だけ。Firestore・Storage への書き込み、Cloud Functions の呼び出しは禁止。
- **実名を残さない。** 取得した元データ（実名入り）はファイルに書かない。伏せ字のあとのデータ・画面写真・報告は `--out`（スクラッチ領域）にだけ置く。リポジトリの中を `--out` にできない。テストの合成データに実在の人の名前を使わない（架空の名前だけ）。報告・ログに出すのは仮名と ID だけ。
- **アプリ本体の挙動は変えない。** `src/` に足してよいのは `src/utils/uiPatrolHook.ts` と、`src/App.tsx` の読み口を入れる `useEffect` 1 つだけ。`src/components/schedule-board/` は 1 行も変えない（効くことの確かめで修正前の版へ一時的に戻すため）。
- **`src/App.tsx` は CRLF。** 書き換えたあと `file src/App.tsx` が `CRLF line terminators` のままで、`git diff --stat src/App.tsx` が数行だけであることを確かめる。grep は `grep -a`。
- **読み口は開発用ビルド かつ ローカルモードだけ。** グローバル名は `__komahyouUiPatrol`。本番ビルド（`dist/`）にこの文字が 1 つでも入ったらビルドを失敗させる。
- **テスト先行。** 各作業は、テストを書く → 今のコードで落ちるのを見る → 実装 → 通るのを見る、の順。
- 終了コード: `0`＝「変」なし／`1`＝「変」（止める所見）あり／`2`＝流せなかった・途中で止まった・何も操作できなかった。
- 所見の段階は 2 つ: `stop`（止める＝「変」）と `info`（知らせるだけ）。
- 文言は日本語。コメントは「なぜ」を書く。`package.json` の `version` は触らない。`CHANGELOG.md` は最後の文書の作業でまとめて書く（各作業では触らない）。
- コミットは作業ごと。メッセージは `feat(ui-patrol): …` / `test(ui-patrol): …`。末尾の帰属行は主セッションの指示どおり。

## Review Focus

仕様が暗に求めるが、作業ごとのテストだけでは漏れやすいもの。持ち主の作業にテストを足してある。

1. **トークンが無い・切れた・バックアップが教室別の形でない** → 分かる文で終了コード 2。途中まで流して「変なし」と言わない（作業 4: `fetchData.test.mjs`・`report.test.mjs`）。
2. **画面の testid が変わった・モーダルが出ない** → 終了コード 2 と画面写真。testid の変更は毎 push のユニットで先に気づく（作業 5: `selectors.test.mjs` の字面の突き合わせ）。
3. **「変」0 件だが実は何も操作していない**（移動の候補が 0・保存ボタンが空振り） → 報告に「操作した数」を出し、台本が 1 本も最後まで流れなければ終了コード 2（作業 4: `resolveExitCode`・作業 5 の `pickMoveCandidates` の候補なし）。
4. **伏せ字の漏れ・伏せ字で挙動が変わる** → 漏れ検査と保証台帳の結果の一致で止まる。新しく増えた名前入りの項目も漏れ検査が拾う（作業 2: `findNameLeaks` の「一覧に無い項目」のテスト）。
5. **途中で落ちたときにサーバーとブラウザが残る・出力先がリポジトリの中** → `finally` で必ず片づける。出力先は起動時に検査（作業 4: `assertOutDirOutsideRepo`・作業 5 の手順）。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/utils/uiPatrolHook.ts`（新） | 読み口の純関数と取り付け。入れてよい条件の判定はここだけ |
| `src/App.tsx`（変更） | 読み口を入れる `useEffect` 1 つ |
| `tools/check-dist-dev-hooks.mjs`（新） | `dist/` に読み口の文字が入っていないかの検査（`npm run build` の最後） |
| `tools/ui-patrol.mjs`（新） | 入口。引数 → 取得 → 伏せ字 → 自己点検 → サーバー → 台本 → 報告 |
| `tools/ui-patrol/entry.ts`（新） | esbuild で束ねる入口。下の `.ts` と `auditClassroomSnapshot` などを再輸出 |
| `tools/ui-patrol/anonymize.ts`（新） | 伏せ字・漏れ検査・保証台帳の結果の一致 |
| `tools/ui-patrol/boardFacts.ts`（新） | 盤面の「意味」を机ごとの事実にする・差分 |
| `tools/ui-patrol/checks.ts`（新） | 点検（変わってよい範囲・手入力・講師なし・保証台帳・同じ状態・保留の数） |
| `tools/ui-patrol/seed.mjs`（新） | 伏せ字の教室データ → ローカルモードの教室データ一式 |
| `tools/ui-patrol/fetchData.mjs`（新） | 読み取り専用の取得（最新の時点・教室ファイル） |
| `tools/ui-patrol/options.mjs`（新） | 引数・出力先の検査 |
| `tools/ui-patrol/report.mjs`（新） | 報告の文・終了コード |
| `tools/ui-patrol/loadApp.mjs`（新） | `entry.ts` を esbuild で束ねて読む |
| `tools/ui-patrol/selectors.mjs`（新） | 台本が頼る testid の一覧（1 か所） |
| `tools/ui-patrol/devServer.mjs`（新） | ローカルモードの開発用サーバーの起動と停止 |
| `tools/ui-patrol/driver.mjs`（新） | ブラウザ操作の部品 |
| `tools/ui-patrol/scenarios.mjs`（新） | 台本（起動・c・b・a）と移動の候補選び |
| `tools/ui-patrol/randomOps.mjs`（新） | でたらめ操作の土台（試験的・既定で動かない） |
| `tools/ui-patrol-known.json`（新） | 誤報と判断した所見の除外（ID だけ・理由つき）。最初は `[]` |

テストは同じ場所の `*.test.mjs`（`.ts` の関数は vitest で直接 import する＝`tools/inv-audit.test.mjs` と同じ）。`src/utils/uiPatrolHook.test.ts` だけ `src/` 側。

---

### Task 1: 読み口と本番ビルドの番人

**Files:**
- Create: `src/utils/uiPatrolHook.ts`
- Test: `src/utils/uiPatrolHook.test.ts`
- Modify: `src/App.tsx`（`useEffect` を 1 つ足す。CRLF を保つ）
- Create: `tools/check-dist-dev-hooks.mjs`
- Test: `tools/check-dist-dev-hooks.test.mjs`
- Modify: `package.json`（`scripts.build` の末尾に `&& node tools/check-dist-dev-hooks.mjs`）

**Interfaces:**
- Consumes: `AppSnapshotPayload`・`WorkspaceSnapshot`（`src/types/appState.ts`）、`isFirebaseBackendEnabled`（`src/integrations/firebase/config.ts`）、App の `buildWorkspaceSnapshot(savedAt)`（`src/App.tsx` 2171 行付近の `useCallback`）。
- Produces:

```ts
// src/utils/uiPatrolHook.ts
export const UI_PATROL_GLOBAL_KEY = '__komahyouUiPatrol'
export type UiPatrolClassroomRead = { classroomId: string; payload: AppSnapshotPayload }
export type UiPatrolHook = { version: 1; backendMode: 'local'; appVersion: string; readClassroom: () => UiPatrolClassroomRead | null }
/** 開発用ビルド かつ ローカルモードのときだけ true。 */
export function shouldInstallUiPatrolHook(params: { isDevBuild: boolean; backendEnabled: boolean }): boolean
/** 教室データ一式から、今開いている教室の分だけを取り出す。無ければ null。 */
export function pickUiPatrolClassroom(snapshot: Pick<WorkspaceSnapshot, 'classrooms'>, classroomId: string | null): UiPatrolClassroomRead | null
/** target[UI_PATROL_GLOBAL_KEY] に入れる。戻り値で外す（自分が入れたものだけ消す）。 */
export function installUiPatrolHook(target: object, hook: UiPatrolHook): () => void
```

```js
// tools/check-dist-dev-hooks.mjs
export const DEV_HOOK_MARKERS = ['__komahyouUiPatrol']
/** 開発用の読み口の文字を含むファイルの path を返す。 */
export function findDevHookMarkers(files /* Array<{ path: string, text: string }> */) // → string[]
```

- [ ] **Step 1: `src/utils/uiPatrolHook.test.ts` を書く**

```ts
describe('画面の自動巡回の読み口（開発用ビルド かつ ローカルモードだけ）', () => {
  it('入れてよいのは 開発用ビルド かつ Firebase 無効 のときだけ', () => {
    expect(shouldInstallUiPatrolHook({ isDevBuild: true, backendEnabled: false })).toBe(true)
    expect(shouldInstallUiPatrolHook({ isDevBuild: true, backendEnabled: true })).toBe(false)
    expect(shouldInstallUiPatrolHook({ isDevBuild: false, backendEnabled: false })).toBe(false)
    expect(shouldInstallUiPatrolHook({ isDevBuild: false, backendEnabled: true })).toBe(false)
  })
  it('今開いている教室の分だけを返す。教室が無い・ID が無いときは null', () => { /* classrooms 2 件で id 一致の data を返す／null・未知の id は null */ })
  it('取り付けと取り外し。別の物に置き換わっていたら消さない', () => { /* target[UI_PATROL_GLOBAL_KEY] === hook → 外すと undefined。外す前に別の値へ差し替えたら残る */ })
  it('配線: App.tsx は import.meta.env.DEV の if の中でだけ取り付ける', () => {
    // App.tsx を読む（CRLF を \n に直してから）。installUiPatrolHook( は 1 回だけ。
    // その直前 600 文字に `if (import.meta.env.DEV) {` と `shouldInstallUiPatrolHook(` がある。
  })
  it('配線: 読み口の名前を使うのは uiPatrolHook.ts と App.tsx だけ', () => {
    // src/ 配下の .ts/.tsx（*.test.* を除く）で `uiPatrolHook` か `__komahyouUiPatrol` を含むのは上の 2 ファイルだけ。
  })
})
```

- [ ] **Step 2: 落ちるのを見る** — `npx vitest run src/utils/uiPatrolHook.test.ts` → モジュールが無くて FAIL。
- [ ] **Step 3: `src/utils/uiPatrolHook.ts` を実装する**（純関数 3 つ。import は型だけ）。
- [ ] **Step 4: `src/App.tsx` に `useEffect` を足す**

`buildWorkspaceSnapshot` の定義より後に置く。形はこのとおり（`if (import.meta.env.DEV) { … }` のブロックにする。本番ビルドで中身ごと消えるようにするため、早期 return の形にしない）。

```ts
  // 画面の自動巡回（tools/ui-patrol.mjs・docs/test-strategy.md 層 5）の読み口。開発用ビルド かつ ローカルモードだけ。
  // 本番ビルドでは import.meta.env.DEV が false に置き換わり、この if の中身ごと消える（tools/check-dist-dev-hooks.mjs が番人）。
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (!shouldInstallUiPatrolHook({ isDevBuild: import.meta.env.DEV, backendEnabled: isFirebaseBackendEnabled() })) return
      return installUiPatrolHook(window, {
        version: 1,
        backendMode: 'local',
        appVersion: __APP_VERSION__,
        readClassroom: () => pickUiPatrolClassroom(buildWorkspaceSnapshot(new Date().toISOString()), /* 今開いている教室の ID */),
      })
    }
  }, [/* buildWorkspaceSnapshot と、今開いている教室の ID の元 */])
```

「今開いている教室の ID」は、`buildWorkspaceSnapshot` が編集中の状態を差し込む先の教室と同じものを使う（`buildWorkspaceSnapshot` の中身を読んで合わせる。室長は担当教室、開発者は `actingClassroomId`）。`buildWorkspaceSnapshot` が state を書き換えない読むだけの関数であることを確かめ、そうでなければ主セッションへ報告して止まる。

- [ ] **Step 5: 通るのを見る** — `npx vitest run src/utils/uiPatrolHook.test.ts` → PASS。`file src/App.tsx` → `with CRLF line terminators`。`git diff --stat src/App.tsx` → 20 行未満。
- [ ] **Step 6: `tools/check-dist-dev-hooks.test.mjs` を書く**

```js
it('読み口の文字を含むファイルだけを返す', () => {
  expect(findDevHookMarkers([{ path: 'a.js', text: 'x=1' }, { path: 'b.js', text: 'window.__komahyouUiPatrol={}' }])).toEqual(['b.js'])
})
it('npm run build の最後でこの検査を呼ぶ', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(pkg.scripts.build.trim().endsWith('node tools/check-dist-dev-hooks.mjs')).toBe(true)
})
it('印の文字はアプリの UI_PATROL_GLOBAL_KEY と同じ', () => { /* src/utils/uiPatrolHook.ts を読み、DEV_HOOK_MARKERS[0] が含まれる */ })
```

- [ ] **Step 7: 落ちるのを見る → `tools/check-dist-dev-hooks.mjs` を実装する → 通るのを見る**

直接実行したとき（`tools/invoked-directly.mjs` の `isInvokedDirectly`）は `dist/` 配下の `.js`・`.html`・`.css` を全部読み、見つかれば path を出して終了コード 1、`dist/` が無ければ終了コード 1。見つからなければ「開発用の読み口は本番ビルドに入っていません」と出して 0。

- [ ] **Step 8: `package.json` の `build` を直し、本番ビルドで確かめる**

Run: `npm run build`
Expected: 最後に「開発用の読み口は本番ビルドに入っていません」。`grep -rl __komahyouUiPatrol dist | wc -l` → `0`。

- [ ] **Step 9: 開発用サーバーで読み口が出ることを確かめる**

`VITE_EXTERNAL_BACKEND_MODE=local npx vite --port 5199 --strictPort` を起動し、次を Node で実行する（終わったらサーバーを止める）。

```js
const { chromium } = require('playwright')
const b = await chromium.launch(); const p = await b.newPage(); await p.goto('http://localhost:5199/'); await p.waitForTimeout(3000)
console.log(await p.evaluate(() => ({ has: !!window.__komahyouUiPatrol, mode: window.__komahyouUiPatrol?.backendMode, read: !!window.__komahyouUiPatrol?.readClassroom() })))
```

Expected: `{ has: true, mode: 'local', read: true }`（webdriver のままなのでアプリは初期教室で自動ログインする）。

- [ ] **Step 10: `npm run lint` と `npx vitest run src/utils tools/check-dist-dev-hooks.test.mjs` を通してコミット**

---

### Task 2: 伏せ字と種データ

**Files:**
- Create: `tools/ui-patrol/anonymize.ts`
- Test: `tools/ui-patrol/anonymize.test.mjs`
- Create: `tools/ui-patrol/seed.mjs`
- Test: `tools/ui-patrol/seed.test.mjs`

**Interfaces:**
- Consumes: `AppSnapshotPayload`、`deriveManagedDisplayName`（`src/components/basic-data/basicDataModel.ts`）、`hasRealDeskTeacher`（`src/utils/deskTeacherLabel.ts`）、`InvAuditResult`（`tools/invAuditEntry.ts`）、`parseWorkspaceSnapshot`（`src/data/appSnapshotRepository.ts`・テストで使う）。
- Produces:

```ts
// tools/ui-patrol/anonymize.ts
export type AnonymizeResult = {
  payload: AppSnapshotPayload            // 伏せ字のあと。入力は書き換えない
  nameMap: Map<string, string>           // 実名の文字列 → 仮名。報告・ファイルへ出さない
  stats: { students: number; teachers: number; aliases: number; memos: number; cleared: number }
}
export function anonymizeClassroomPayload(payload: AppSnapshotPayload): AnonymizeResult
/** 伏せ字のあとに実名が残っている項目の経路（値は返さない）。空なら漏れなし。 */
export function findNameLeaks(anonymized: unknown, realNames: Iterable<string>): string[]
/** 伏せ字の前後で保証台帳の洗い出しの結果が同じか。食い違いの説明（空なら一致）。 */
export function compareAuditForParity(real: InvAuditResult, anonymized: InvAuditResult): string[]
```

```js
// tools/ui-patrol/seed.mjs
export const PATROL_MANAGER_USER_ID = 'patrol_manager'
export const PATROL_CLASSROOM_NAME = '巡回用教室'
/** 伏せ字の教室データ 1 つから、ローカルモードが読める教室データ一式（WorkspaceSnapshot）を作る。 */
export function buildPatrolWorkspaceSnapshot({ classroomId, payload, savedAt }) // → WorkspaceSnapshot
```

**伏せ字の決まり（この表が仕様）**

| 対象 | 置き換え |
|---|---|
| `students[].name` | `生徒NNN`（NNN＝ID の数字部分。`s092`→`生徒092`。数字が無い ID は名簿順の `生徒X001`）。元の名前に空白（全角も）があれば `生徒NNN　名`（全角空白＋「名」） |
| `students[].displayName` | 空なら空のまま。`deriveManagedDisplayName(元の name)` と同じなら `生徒NNN`。それ以外は `生NNN` |
| `teachers[].name`／`displayName` | 同じ規則で `講師NNN`／`講師NNN　名`／`講NNN` |
| `managers[].name` ほか室長の名前 | `室長N`（並び順） |
| 名前の入る盤面の項目（下の一覧） | **文字列ごとの対応表**で置き換える。対応表は名簿を先に登録し（生徒 → 講師 → 室長の順・先に登録した文字列が勝つ）、同じ文字列は必ず同じ仮名にする |
| 対応表に無い名前 | 空白を除いた形が登録済みの名前と同じなら、その仮名の空白を合わせた形。それ以外は `別名NNN`（初めて出た順） |
| 講師欄の空・埋め草（`hasRealDeskTeacher` が false） | そのまま |
| `teacherAssignmentTeacherId` | `teachers[].id` のどれかと同じならそのまま。違えば名前として対応表で置き換える |
| メモ（`desks[].memoSlots[]`・保留の下段の同じ項目・`classroomSettings.scheduleNotes` の値・`teachers[].memo`） | 空でなければ `メモ` |
| `scheduleHeader.logoDataUrl`・`phoneNumber`・各 `email` | 空にする |
| `scheduleHeader.schoolName` | 空でなければ `巡回用教室` |
| `classroomSettings.updatedBy` | `patrol` |
| トークン（`boardShareToken`・`parentPortalToken`・`submissionToken`） | 同じ長さの偽の値（`p` ＋連番を 0 で埋める）。`*TokenClassroomId` はそのまま |
| それ以外（ID・日付・科目・学年・講習の名前・生年月日・`withdrawDate` の「未定」など） | そのまま |

名前の入る盤面の項目（2026-11-11 に本番 2 校で数えた一覧）: `desks[].teacher`・`desks[].teacherAssignmentTeacherId`・`lesson.studentSlots[].name`・`statusSlots[].name`・`statusSlots[].teacherName`・`boardState.fallbackMakeupStudents.*.studentName`／`displayName`・`boardState.manualLectureStockOrigins.*[].displayName`・`boardState.fallbackLectureStockStudents.*.displayName`・`boardState.groupClassEntries.*.teacherName`・`boardState.templatePendingDesks` の中の同じ形の項目。
実装係は `src/components/schedule-board/types.ts`（`DeskCell`・`DeskLesson`・`StudentEntry`・`StudentStatusEntry`）と `templatePendingDesks.ts`・`basicDataModel.ts`（`StudentRow.withdrawSweepRemovedLessons`）を読み、**人の名前を持つ文字列の項目がほかにあれば一覧に足す**（足したものは報告に書く）。漏れ検査が最後の番人。

**漏れ検査 `findNameLeaks`**: `realNames` の各文字列と、それを空白で分けた 2 文字以上の部分を「実名の断片」とする。伏せ字のあとのデータの**すべての文字列の値とオブジェクトのキー**を見て、断片と完全一致するか、2 文字以上の断片を含むものがあれば、その経路（例 `boardState.weeks[][].desks[].lesson.note`）を返す。値は返さない。

- [ ] **Step 1: `tools/ui-patrol/anonymize.test.mjs` を書く**（架空の名前だけを使う。例: 生徒 `甲野　一郎`〔表示名 `甲野`〕・`乙川　二郎`〔表示名 `乙川二`〕、講師 `丙山　三子`〔表示名 `丙山`〕）

テスト名と確かめること:

```js
it('名簿: 生徒は ID から作った仮名になり、表示名が姓と同じならアプリの導出と一致する', () => {
  // s092 甲野　一郎／表示名 甲野 → name '生徒092　名'・displayName '生徒092'・deriveManagedDisplayName(name) === displayName
  // s093 乙川　二郎／表示名 乙川二 → name '生徒093　名'・displayName '生093'
})
it('盤面: 同じ文字列は必ず同じ仮名（生徒の席・出欠記録・講師欄・出欠記録の講師名）', () => {})
it('盤面: アプリの名前引き（buildManagedStudentByAnyNameMap）が伏せ字の前後で同じ生徒 ID を返す', () => {})
it('名簿に無い名前は 別名NNN。同じ文字列は同じ別名。空白の違いだけの名前は登録済みの仮名に合わせる', () => {})
it('講師欄の空と埋め草（講師未割当）はそのまま。teacherAssignmentTeacherId は ID ならそのまま・名前なら仮名', () => {})
it('メモと連絡事項は「メモ」に、空は空のまま。ロゴ・電話・メールは空。校舎名は 巡回用教室。更新者は patrol', () => {})
it('トークンは同じ長さの別の値。発行元の教室 ID はそのまま', () => {})
it('ID・日付・科目・学年・生年月日・withdrawDate の「未定」は変えない。入力のオブジェクトは書き換えない', () => {})
it('漏れ検査: 伏せ字のあとに実名が無ければ空', () => {})
it('漏れ検査: 一覧に無い項目に名前が残っていたら経路を返す（値は返さない）', () => {
  // 伏せ字のあとの payload に boardState.futureField = { who: '甲野' } を足す → ['boardState.futureField.who']。返り値のどこにも '甲野' が無い
})
it('漏れ検査: オブジェクトのキーに名前が残っていても拾う', () => {})
it('結果の一致: 件数と所見の組が同じなら空。違えば説明を返す', () => {})
```

- [ ] **Step 2: 落ちるのを見る** — `npx vitest run tools/ui-patrol/anonymize.test.mjs`
- [ ] **Step 3: `tools/ui-patrol/anonymize.ts` を実装する**

`compareAuditForParity` は `counts` の全キーの一致と、所見の組（`rule`・`severity`・`kind`・`studentId`・`dateKey`・`slotNumber`・`deskIndex`・`subject`・`sessionId`・`period`）を並べ替えた列の一致を見る（`message` は比べない）。

- [ ] **Step 4: 通るのを見る**
- [ ] **Step 5: `tools/ui-patrol/seed.test.mjs` を書く**

```js
it('アプリの読み込み（parseWorkspaceSnapshot）が受け付ける形', () => {
  const seed = buildPatrolWorkspaceSnapshot({ classroomId: 'room1', payload, savedAt: '2026-11-11T00:00:00.000Z' })
  expect(parseWorkspaceSnapshot(JSON.stringify(seed))).not.toBeNull()
})
it('室長でログイン済み・担当教室が開く形（currentUserId・assignedClassroomId・actingClassroomId・screen=board）', () => {
  // currentUserId === 'patrol_manager'。users に manager（assignedClassroomId 'room1'）と developer。classrooms は 1 件で name '巡回用教室'・data.screen 'board'
})
it('メールアドレスは example.invalid。実在の値を持たない', () => {})
```

- [ ] **Step 6: 落ちるのを見る → `tools/ui-patrol/seed.mjs` を実装する → 通るのを見る**
- [ ] **Step 7: 本番の形で自己点検を回す（結果を報告に書く）**

主セッションが用意した 2 校のバックアップ（スクラッチ領域・path は指示で渡す）に、`anonymizeClassroomPayload` → `findNameLeaks` → `auditClassroomSnapshot`（伏せ字の前後）→ `compareAuditForParity` を当てる使い捨てスクリプトをスクラッチ領域に書いて実行する（vitest か `tools/inv-audit.mjs` の `loadAuditor` の作法で束ねる）。
Expected: 2 校とも漏れ 0・結果の一致。出力に実名を出さない（件数と経路だけ）。漏れや食い違いが出たら原因を直す（決まりの表を変える必要があるなら主セッションへ報告）。

- [ ] **Step 8: `npm run lint`・関連テストを通してコミット**

---

### Task 3: 盤面の事実と点検

**Files:**
- Create: `tools/ui-patrol/boardFacts.ts`
- Test: `tools/ui-patrol/boardFacts.test.mjs`
- Create: `tools/ui-patrol/checks.ts`
- Test: `tools/ui-patrol/checks.test.mjs`
- Create: `tools/ui-patrol-known.json`（中身 `[]`）

**Interfaces:**
- Consumes: `AppSnapshotPayload`・`SlotCell`・`DeskCell`、`resolveStudentOrigin`・`resolveDeskTeacherOrigin`（`src/components/schedule-board/placementOrigin.ts`）、`hasRealDeskTeacher`（`src/utils/deskTeacherLabel.ts`）、`hasDeskTeacherRest`（`src/components/schedule-board/teacherRest.ts`）、`normalizeTemplatePendingDeskMap`・`parseTemplatePendingDeskKey`（`templatePendingDesks.ts`）、`InvAuditResult`・`InvAuditFinding`（`tools/invAuditEntry.ts`）。
- Produces:

```ts
// tools/ui-patrol/boardFacts.ts
export type StudentFact = { key: string; name: string; subject: string; lessonType: string; origin: 'template' | 'manual' }  // key＝managedStudentId、無ければ 'name:' + name
export type DeskFact = {
  key: string                       // `${cellId}#${deskIndex}`
  cellId: string; dateKey: string; slotNumber: number; deskIndex: number
  teacher: string                   // 本物の講師名（空・埋め草は ''）
  teacherOrigin: 'template' | 'manual' | null
  teacherRest: boolean              // 講師の休みの机
  students: Array<StudentFact | null>   // 席 0・席 1
  statuses: string[]                // 出欠記録 1 件 1 文字列（生徒キー|status|科目|種類）。並べ替え済み
  memos: string[]                   // 空でないメモ。並べ替え済み
  pendingStudents: StudentFact[]    // 保留（2 行）の下段の生徒
  pendingTeacher: string            // 保留の下段の講師（無ければ ''）
  signature: string                 // 上の中身（位置の項目以外）の JSON。比べるのはこれ
}
export type BoardFacts = { desks: Map<string, DeskFact>; sections: Record<string, string>; pendingDeskCount: number }
export const BOARD_FACT_SECTIONS: readonly string[]
export function collectBoardFacts(payload: AppSnapshotPayload): BoardFacts
export function isEmptyDeskFact(fact: DeskFact): boolean
export type DeskChange = { key: string; before: DeskFact | null; after: DeskFact | null; fields: string[] }  // fields は 'teacher'|'students'|'statuses'|'memos'|'pending'
export function diffBoardFacts(before: BoardFacts, after: BoardFacts): { desks: DeskChange[]; sections: string[] }
```

`BOARD_FACT_SECTIONS`（盤面の机以外で比べる部分。キーを並べ替えた JSON を署名にする）:
`students`・`teachers`・`managers`・`regularLessons`・`groupLessons`・`specialSessions`・`autoAssignRules`・`pairConstraints`・`classroomSettings.template`（`regularLessonTemplate`・`regularLessonTemplateHistory`・`preTemplateRegularLessons`・`templateFreezeBeforeDate`）・`classroomSettings.other`（残り）・`boardState.suppressedRegularLessonOccurrences`・`boardState.scheduleCountAdjustments`・`boardState.manualMakeupAdjustments`・`boardState.suppressedMakeupOrigins`・`boardState.fallbackMakeupStudents`・`boardState.manualLectureStockCounts`・`boardState.manualLectureStockOrigins`・`boardState.fallbackLectureStockStudents`・`boardState.groupClassEntries`。
画面の状態（`weekIndex`・`selectedCellId`・`selectedDeskIndex`・在庫パネルの開閉・日程表の範囲）と `classroomSettings.savedAt`／`updatedAt` は比べない。
片方にしか無い机は、中身が空（`isEmptyDeskFact`）なら差分に数えない。

```ts
// tools/ui-patrol/checks.ts
export const PATROL_FINDING_CODES = [
  'outside-allowed-range', 'manual-student-teacher-changed', 'manual-student-teacher-changed-announced', 'manual-student-lost',
  'manual-student-to-pending', 'teacherless-student-added', 'manual-input-lost', 'inv-new-violation', 'inv-new-check',
  'undo-not-restored', 'redo-not-restored', 'save-changed', 'reload-changed', 'pending-count-mismatch',
  'external-request', 'page-error', 'move-not-applied', 'move-blocked', 'change-summary',
] as const
export type PatrolFindingCode = (typeof PATROL_FINDING_CODES)[number]
export type PatrolFinding = { level: 'stop' | 'info'; code: PatrolFindingCode; message: string; dateKey?: string; slotNumber?: number; deskIndex?: number; studentId?: string }
export type AllowedChange = { deskKeys?: ReadonlySet<string>; fromDateKey?: string; sections?: ReadonlySet<string> }

export function checkOutsideAllowedRange(before: BoardFacts, after: BoardFacts, allowed: AllowedChange): PatrolFinding[]
export function checkManualStudentsKeepTeacher(before: BoardFacts, after: BoardFacts, options?: { announcedText?: string; excludeDeskKeys?: ReadonlySet<string> }): PatrolFinding[]
export function checkTeacherlessStudentsNotAdded(before: BoardFacts, after: BoardFacts, options?: { excludeDeskKeys?: ReadonlySet<string> }): PatrolFinding[]
export function checkManualInputsNotLost(before: BoardFacts, after: BoardFacts, options?: { excludeDeskKeys?: ReadonlySet<string> }): PatrolFinding[]
export function checkSameState(before: BoardFacts, after: BoardFacts, code: 'undo-not-restored' | 'redo-not-restored' | 'save-changed' | 'reload-changed'): PatrolFinding[]
export function checkAuditNotWorse(before: InvAuditResult, after: InvAuditResult): PatrolFinding[]
export function parsePendingCountFromConfirm(message: string): number | null       // 「保留 2机」→ 2。書いてなければ null
export function checkPendingCountMatchesPreview(before: BoardFacts, after: BoardFacts, confirmMessage: string): PatrolFinding[]
export function summarizeChanges(before: BoardFacts, after: BoardFacts): PatrolFinding[]   // info 'change-summary' 1 件（変わった机の数・項目ごとの数）
export type KnownPatrolIssue = { code?: string; classroomId?: string; step?: string; dateKey?: string; slotNumber?: number; studentId?: string; note?: string }
export function applyKnownIssues(findings: PatrolFinding[], known: KnownPatrolIssue[], context: { classroomId: string; step: string }): { findings: PatrolFinding[]; knownCount: number }
```

**点検の決まり**

- `checkOutsideAllowedRange`: 変わった机のうち、`deskKeys` に無く、かつ（`fromDateKey` が無い、または机の日付が `fromDateKey` より前）のものを `stop 'outside-allowed-range'`。変わった部分（sections）が `sections` に無ければ同じく `stop`。机の所見は先頭 20 件まで 1 件ずつ、残りは「ほか n 机」の 1 件にまとめる。
- `checkManualStudentsKeepTeacher`: 操作前の手入力の生徒（`origin === 'manual'`。`excludeDeskKeys` の机を除く）を、操作後の**同じコマ**（同じ `cellId`）で `生徒キー・科目・授業の種類` で探す。
  - 席にいて本物の講師名が同じ → 所見なし（机番号だけの移動は数えない）。
  - 席にいて講師名が違う → `stop 'manual-student-teacher-changed'`。ただし `announcedText` がその生徒の `name` を含むなら `info 'manual-student-teacher-changed-announced'`。
  - 席におらず、同じコマの保留の下段にいる → `info 'manual-student-to-pending'`。
  - どこにもいない → `stop 'manual-student-lost'`。
  - 同じコマに同じ生徒が 2 か所いるデータ（既存の INV-12 違反）でも落ちない（数で突き合わせる）。
- `checkTeacherlessStudentsNotAdded`: 「生徒がいて本物の講師がおらず、講師の休みでもない机」に座る生徒の組（コマ・生徒キー）を前後で作り、操作後にだけある組を `stop 'teacherless-student-added'`（`excludeDeskKeys` の机は見ない）。
- `checkManualInputsNotLost`: 操作前のメモ・出欠記録（`excludeDeskKeys` の机を除く）が、操作後の同じコマのどこかの机にあること。無ければ `stop 'manual-input-lost'`。
- `checkSameState`: 机の署名と sections がすべて同じこと。違えば指定の code で `stop`（先頭 20 件＋まとめ）。
- `checkAuditNotWorse`: 所見の鍵（`rule|severity|kind|studentId|dateKey|slotNumber|deskIndex|subject|sessionId`）で、操作後にだけある `bug` を `stop 'inv-new-violation'`、`check` を `info 'inv-new-check'`。
- `checkPendingCountMatchesPreview`: 確認の文の保留の数（`parsePendingCountFromConfirm`）と `after.pendingDeskCount - before.pendingDeskCount` が違えば `stop 'pending-count-mismatch'`。文に数が無ければ所見なし。
- `message` は日本語 1 行。場所は「11/19(木) 3限 机5」の形、人は仮名（`StudentFact.name`・講師名）と生徒 ID。
- `applyKnownIssues`: 書いてある項目がすべて一致する所見を外し、外した数を返す（`tools/board-health-known-issues.json` と同じ考え方）。

- [ ] **Step 1: `tools/ui-patrol/boardFacts.test.mjs` を書く**（合成データ。名前は 生徒A・講師A など）

```js
it('机ごとの事実: 本物の講師・生徒 2 席・出自・出欠記録・メモ・保留の下段', () => {})
it('埋め草の講師（講師未割当）と空は講師なし。講師の休みは teacherRest', () => {})
it('出自はアプリの権威関数どおり（印が無い振替は手入力・印が無い通常はテンプレ）', () => {})
it('内部の印だけの違い（origin の付け直し・lesson.id・manualTeacher の有無）は署名が変わらない／講師の出自の違いは変わる', () => {})
it('差分: 変わった机と項目・変わった部分（sections）を返す。片方にしか無い空の机は数えない', () => {})
it('画面の状態（weekIndex・selectedCellId・在庫パネルの開閉）は比べない', () => {})
```

- [ ] **Step 2: 落ちるのを見る → `boardFacts.ts` を実装する → 通るのを見る**
- [ ] **Step 3: `tools/ui-patrol/checks.test.mjs` を書く**

```js
describe('変わってよい範囲', () => {
  it('動かした元と先の机だけなら所見なし', () => {})
  it('生徒を 1 人動かしたのに別の机の講師が変わったら stop', () => {})
  it('反映日より前の机が変わったら stop。反映日以降は所見なし', () => {})
  it('許していない部分（例 specialSessions）が変わったら stop', () => {})
  it('21 机以上は 20 件＋「ほか n 机」にまとめる', () => {})
})
describe('手入力の生徒の講師（2026-11-10 緑が丘の形）', () => {
  it('手入力の振替の生徒が、講師 講師A の机から講師のいない机へ移ったら stop manual-student-teacher-changed', () => {})
  it('同じ講師について机番号だけ変わったのは所見なし', () => {})
  it('確認の画面の詳細に名前が出ていれば info に下げる', () => {})
  it('保留の下段へ移ったのは info。どこにもいなければ stop manual-student-lost', () => {})
  it('同じコマに同じ生徒が 2 か所いても落ちない', () => {})
})
describe('講師なしの机・手入力・同じ状態・保証台帳・保留の数・既知', () => {
  it('講師のいない机に座る生徒が増えたら stop。講師の休みの机は数えない。除外の机は見ない', () => {})
  it('メモ・出欠記録が同じコマから消えたら stop。同じコマの別の机へ移ったのは所見なし', () => {})
  it('同じ状態: 1 机でも違えば指定の code で stop', () => {})
  it('保証台帳: 新しい bug は stop・新しい check は info・前からある違反は所見なし', () => {})
  it('保留の数: 「置き換え 24机・保留 2机」で実際が +2 なら所見なし・+3 なら stop・数が無い文は所見なし', () => {})
  it('既知: 書いた項目がすべて一致する所見だけ外す', () => {})
})
```

- [ ] **Step 4: 落ちるのを見る → `checks.ts` を実装する → 通るのを見る**
- [ ] **Step 5: `npm run lint`・関連テストを通してコミット**

---

### Task 4: 取得・引数・報告・入口の骨組み

**Files:**
- Create: `tools/ui-patrol/fetchData.mjs`・`tools/ui-patrol/options.mjs`・`tools/ui-patrol/report.mjs`・`tools/ui-patrol/loadApp.mjs`・`tools/ui-patrol/entry.ts`・`tools/ui-patrol.mjs`
- Test: `tools/ui-patrol/fetchData.test.mjs`・`tools/ui-patrol/options.test.mjs`・`tools/ui-patrol/report.test.mjs`・`tools/ui-patrol.test.mjs`
- Modify: `package.json`（`scripts` に `"ui:patrol": "node tools/ui-patrol.mjs"`）

**Interfaces:**
- Consumes: Task 2・3 の関数、`fetchReadonlyAccessToken`（`tools/prod-readonly-token.mjs`）、`decodeJsonBuffer`・`extractClassroomSnapshot`（`tools/snapshot-diff.mjs`）、`auditClassroomSnapshot`（`tools/invAuditEntry.ts`）、`resolveNextMondayDateKey`（`src/components/schedule-board/templateDefinitionDiff.ts`）、`isInvokedDirectly`（`tools/invoked-directly.mjs`）。
- Produces:

```js
// tools/ui-patrol/fetchData.mjs
export const DEFAULT_CLASSROOMS = [{ id: '5w5OMueETerSKrSf14HC', label: '日大前校' }, { id: 'KzFnOQoTFLsCxwUp1tvh', label: '緑が丘校' }]
export function buildLatestBackupKeyRequest()                 // → { url, method: 'POST', body }（workspaceAutoBackupSummaries を savedAt の降順で 1 件・:runQuery）
export function parseLatestBackupKey(json)                    // → { key, layout } | null
export function buildClassroomBackupRequest(key, classroomId) // → { url, method: 'GET' }（Storage JSON API・alt=media）
export function assertReadOnlyRequest({ url, method })        // GET か、firestore.googleapis.com の :runQuery への POST 以外は throw
export async function fetchClassroomBackup({ token, classroomId, key, fetchImpl })  // → { key, buffer }。key 省略時は最新

// tools/ui-patrol/options.mjs
export const USAGE
export function parseArgs(argv)       // → { out, classrooms: string[], key, seedFiles: string[], scenarios: string[], moves, seed, random, known, port, headed, prepareOnly, json, help, unknown, missingValue }
export function validateArgs(options) // → string[]（日本語）
export function assertOutDirOutsideRepo(outDir, repoRoot)   // リポジトリの中（同じ場所を含む）なら throw
export function jstToday(now)         // 'YYYY-MM-DD'

// tools/ui-patrol/report.mjs
export function createClassroomReport({ classroomId, label, backupKey })  // → { classroomId, label, backupKey, steps: [], knownCount: 0, aborted: null }
export function summarizeReport(report)      // → { stop, info, stepsRun, operations, aborted: boolean }
export function resolveExitCode(report)      // → 0 | 1 | 2
export function formatPatrolReportText(report)  // 日本語。1 行目が要約

// tools/ui-patrol/loadApp.mjs
export async function loadPatrolApp()  // → { app, cleanup }。app は entry.ts の輸出

// tools/ui-patrol/entry.ts（再輸出だけ）
export { anonymizeClassroomPayload, findNameLeaks, compareAuditForParity } from './anonymize'
export { collectBoardFacts, diffBoardFacts, isEmptyDeskFact, BOARD_FACT_SECTIONS } from './boardFacts'
export * from './checks'
export { auditClassroomSnapshot } from '../invAuditEntry'
export { resolveNextMondayDateKey } from '../../src/components/schedule-board/templateDefinitionDiff'
```

**決まり**

- 引数: `--out <dir>`（必須。リポジトリの外）・`--classroom <id>`（複数可。既定は本番 2 校）・`--key <YYYY-MM-DDTHH-mm>`（既定は最新）・`--seed-file <path>`（伏せ字済みの種データを使い、取得しない。`--classroom` と同じ数・同じ順）・`--scenario <boot,c,b,a>`（既定は全部。`boot` は必ず流す）・`--moves <n>`（既定 6）・`--seed <n>`（既定 1）・`--random <n>`（既定 0）・`--known <json>`（既定 `tools/ui-patrol-known.json`）・`--port <n>`（既定 5199）・`--headed`・`--prepare-only`（取得と伏せ字と自己点検だけ）・`--json`。
- 通信はすべて `assertReadOnlyRequest` を通す 1 つの関数から出す。`layout` が `per-classroom-v1` でなければ「教室別の形ではない」で止まる。HTTP が 200 でなければ状態コードつきで止まる。
- トークンは環境変数 `FIRESTORE_ACCESS_TOKEN`、無ければ `fetchReadonlyAccessToken()`。どちらも無ければ「読み取り専用トークンを作れません」で終了コード 2。
- 入口の流れ（この作業では `--prepare-only` まで。ブラウザの部分は Task 5 が足す）: 引数 → 出力先の検査 → 教室ごとに〔取得（メモリの中だけ）→ `extractClassroomSnapshot` → 伏せ字 → 漏れ検査 → 保証台帳の結果の一致 → `<out>/<classroomId>.seed.json` を書く〕。漏れ・食い違いは経路と説明を出して終了コード 2。**元のデータをファイルに書かない。**
- `resolveExitCode`: どれかの教室が `aborted`、または `stepsRun === 0` → 2。`stop > 0` → 1。それ以外 0。`--prepare-only` は自己点検が通れば 0。
- 報告の 1 行目: `■ 画面の自動巡回 (アプリ v1.5.x・データ <key>): 変 n 件・知らせるだけ m 件・操作 k 回` 。続けて教室ごと・台本ごとに所見を `[変]`／`[知]` で 1 件 1 行。途中で止まった教室は `[中断]` と理由。既知で外した数も出す。

- [ ] **Step 1: テスト 4 本を書く**

```js
// fetchData.test.mjs
it('読み取りだけ: GET と :runQuery への POST は通す', () => {})
it('読み取りだけ: PUT・PATCH・DELETE・ほかの POST（例 :commit・cloudfunctions.net）は throw', () => {})
it('読み取りだけ: 知らないホストは throw', () => {})
it('最新の時点: runQuery の結果から key と layout を読む。結果が空なら null', () => {})
it('取得: 偽の fetch に出た通信は :runQuery 1 回と GET 1 回だけ。key 指定なら GET 1 回だけ', () => {})
it('取得: layout が教室別でない・HTTP 403 は分かる文で throw', () => {})
// options.test.mjs
it('既定: 教室は本番 2 校・台本は boot,c,b,a・移動 6・種 1・でたらめ 0', () => {})
it('--out が無い・知らないオプション・値の無いオプション・--seed-file と --classroom の数が違う、は日本語で断る', () => {})
it('出力先がリポジトリの中（リポジトリそのもの・docs/ の下）は throw。外は通す', () => {})
// report.test.mjs
it('終了コード: 変なし 0・変あり 1・中断 2・1 本も流れていない 2', () => {})
it('文: 1 行目に件数。[変] と [知] を分ける。[中断] と理由を出す。既知で外した数を出す', () => {})
// ui-patrol.test.mjs（入口・--prepare-only）
it('--prepare-only: 偽の取得で、出力先には伏せ字の種データだけができ、どのファイルにも元の名前が無い', () => {
  // main({ argv, fetchImpl, env }) を呼べる形にしておく。合成の教室データ（架空の名前）を gzip して偽の fetch が返す。
})
it('伏せ字のあとに名前が残る・保証台帳の結果が食い違うときは終了コード 2 で、種データを書かない', () => {})
```

- [ ] **Step 2: 落ちるのを見る → 実装する → 通るのを見る**

`tools/ui-patrol/loadApp.mjs` は `tools/inv-audit.mjs` の `loadAuditor` と同じ esbuild の設定（`packages: 'external'`・`alias @company`・`define import.meta.env`・束ね先は `node_modules/.cache/ui-patrol-*`・`node_modules/.cache` が無ければ作る・終わったら消す）。`tools/inv-audit.mjs` は変えない。

- [ ] **Step 3: 本番の形で `--prepare-only` を回す**

Run: `node tools/ui-patrol.mjs --out <スクラッチ領域>/patrol-prepare --prepare-only`
Expected: 2 校とも「漏れ 0・結果の一致」、`<out>/<classroomId>.seed.json` が 2 つ、終了コード 0。出力に実名なし。

- [ ] **Step 4: `npm run lint`・関連テストを通してコミット**

---

### Task 5: ブラウザ操作と台本（起動・c・b・a）

**Files:**
- Create: `tools/ui-patrol/selectors.mjs`・`tools/ui-patrol/devServer.mjs`・`tools/ui-patrol/driver.mjs`・`tools/ui-patrol/scenarios.mjs`
- Test: `tools/ui-patrol/selectors.test.mjs`・`tools/ui-patrol/scenarios.test.mjs`
- Modify: `tools/ui-patrol.mjs`（`--prepare-only` でなければサーバー → ブラウザ → 台本 → 報告）

**Interfaces:**
- Consumes: Task 1 の読み口、Task 3 の点検、Task 4 の入口・報告・`loadPatrolApp`。
- Produces:

```js
// tools/ui-patrol/selectors.mjs — 台本が頼る testid はここだけに書く
export const TESTIDS = {
  saveButton: 'save-board-button', undoButton: 'undo-button', redoButton: 'redo-button', status: 'toolbar-status',
  openTemplate: 'board-regular-template-button', templateDate: 'template-effective-start-date', templateSave: 'template-save-overwrite-button',
  templateConfirmModal: 'template-save-confirm-modal', templateConfirmMessage: 'template-save-confirm-message',
  templateConfirmDetail: 'template-save-confirm-detail-text', templateConfirmExecute: 'template-save-confirm-execute-button',
  weekLabel: 'week-label', weekJumpPopover: 'week-jump-popover', prevWeek: 'prev-week-button', nextWeek: 'next-week-button',
  duplicateTabBlock: 'duplicate-tab-block',
}
export const TESTID_PREFIXES = { studentCell: 'student-cell-', weekJumpDay: 'week-jump-day-' }   // student-cell-{cellId}-{deskIndex}-{studentIndex}
export const SOURCE_FILES_WITH_TESTIDS = ['src/components/schedule-board/BoardToolbar.tsx', 'src/components/schedule-board/BoardGrid.tsx', 'src/components/schedule-board/ScheduleBoardScreen.tsx', 'src/App.tsx']

// tools/ui-patrol/devServer.mjs
export async function startDevServer({ port, repoRoot })   // → { baseUrl, stop }。VITE_EXTERNAL_BACKEND_MODE=local。VITE_FIREBASE_* は渡さない。ポートが使用中なら throw

// tools/ui-patrol/driver.mjs
export async function launchPatrolBrowser({ baseUrl, headed })   // → session { browser, context, page, baseUrl, externalRequests: string[], pageErrors: string[], dialogs: string[] }
export async function seedAndOpen(session, seedSnapshot)         // アプリの起動前に種データを入れて開き、盤面と読み口を待つ
export async function readClassroom(session)                     // → { classroomId, payload }。2 回続けて同じになるまで待つ
export async function clickSave(session)                         // 保存ボタン → data-state="clean" を待つ。押せたら true、既に clean なら false
export async function reloadApp(session)
export async function gotoWeekOf(session, dateKey)
export async function dragStudent(session, from, to)             // 長押しドラッグ。from/to は { cellId, deskIndex, seat }。ステータスの文を返す
export async function clickUndo(session); export async function clickRedo(session)
export async function openTemplateEditor(session)                // → 既定の反映開始日
export async function setTemplateStartDate(session, dateKey)
export async function requestTemplateSave(session)               // → { confirmMessage, detailText }
export async function confirmTemplateSave(session)               // 確認を押し、テンプレ編集が閉じるのを待つ
export async function takeScreenshot(session, file)
export async function closePatrolBrowser(session)

// tools/ui-patrol/scenarios.mjs
export const MOVE_KINDS = ['regular-same-slot', 'regular-other-day', 'makeup-same-slot', 'makeup-other-day', 'special-same-slot', 'special-other-day']
export function createSeededRandom(seed)                         // → () => number（0 以上 1 未満・同じ種なら同じ列）
export function pickMoveCandidates(facts, { weekDateKeys, todayKey, count, seed })
  // → Array<{ kind, from: { cellId, deskIndex, seat }, to: { cellId, deskIndex, seat }, studentId }>。候補が無い種類は飛ばす
export const MOVE_ALLOWED_SECTIONS            // 生徒の移動で変わってよい部分（根拠のコード行をコメントに書く）
export const TEMPLATE_SAVE_ALLOWED_SECTIONS   // テンプレ保存で変わってよい部分（同上）
export function buildMoveAllowedChange(candidate)                // → AllowedChange（元と先の机・MOVE_ALLOWED_SECTIONS）
export async function runClassroomPatrol({ session, app, classroom, seedSnapshot, options, outDir, known, today })  // → Task 4 の教室の報告
```

**ブラウザの決まり**

- Playwright は `createRequire(import.meta.url)('playwright')`。読めなければ「Playwright が無い環境では回せません」で終了コード 2。
- 起動引数: `--disable-blink-features=AutomationControlled`（アプリはローカルモードで `navigator.webdriver` が true だと保存を止める＝`src/App.tsx` の `isSnapshotPersistenceRuntimeEnabled`。巡回は保存も通すので隠す）と `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`（localhost 以外は名前解決の段階で止める）。開いた直後に `navigator.webdriver === false` を確かめ、true なら終了コード 2。
- `context.route('**/*')` で localhost・`data:`・`blob:` 以外を止めて、ホスト名を `externalRequests` に記録する（所見 `stop 'external-request'`）。
- 画面の大きさは盤面の全コマがスクロールなしで入る大きさにする（目安 幅 2600・高さ 3400。足りなければ実測して決める）。`locale: 'ja-JP'`・`timezoneId: 'Asia/Tokyo'`・`deviceScaleFactor: 1`。
- ダイアログは全部 accept して文を `dialogs` に残す。ダウンロード（テンプレ保存前の盤面の PDF）は cancel する。`pageerror` は `pageErrors` に残す（所見 `stop 'page-error'`）。
- **種データの入れ方**（`seedAndOpen`）: `context.route` で `<baseUrl>/__ui-patrol-blank.html` に空の HTML を返し、そこへ移動してから `page.evaluate(async (snapshot) => { const m = await import('/src/data/appSnapshotRepository.ts'); return m.saveWorkspaceSnapshot(snapshot) }, seed)` で入れる（`savedAt` は今）。結果の `savedToIndexedDb` が true でなければ中断。それから `<baseUrl>/` を開く。**アプリを先に開いてから入れない**（初回起動の自動保存のほうが新しい扱いになり、種データが読まれない）。
- 盤面が開いたことは、保存ボタンが見え、読み口があり、`readClassroom().classroomId` が種データの教室 ID であることで確かめる。`duplicate-tab-block` が出たら中断。1 教室 1 コンテキスト（タブは 1 つ）。
- `readClassroom` は 200ms おきに読み、盤面の部分の JSON が 2 回続けて同じになったら返す（最長 10 秒。超えたら中断）。
- 長押しドラッグ（`src/components/schedule-board/ScheduleBoardScreen.tsx` の `handleStudentMouseDown`: mouse イベント・長押し 250ms・成立前に 8px 動くと取り消し・放した位置を `elementFromPoint` → `.sa-student[data-cell-id]`）: 元の席の中央へ `mouse.move` → `mouse.down` → 400ms 待つ → 先の席の中央へ 10 段階で `mouse.move` → 100ms 待つ → `mouse.up`。
- 待ちは必ず条件で待つ（testid の状態・読み口の値）。固定の待ちは長押しと描画の落ち着きだけ。待ちが時間切れになったら、画面写真を撮って教室を `aborted` にする（所見にしない）。
- `finally` でブラウザとサーバーを必ず止める。

**台本の決まり**（教室ごと。`today` は JST の今日・`nextMonday = app.resolveNextMondayDateKey(today)`）

各手順は「前の状態を読む → 操作 → 後の状態を読む → 点検 → 既知を外す → 報告へ足す」。`stop` の所見が出た手順では画面写真を `<out>/<classroomId>-<台本>-<連番>.png` に撮る。

1. **起動 `boot`**: 種データ（伏せ字の payload）を「前」、開いた直後の `readClassroom` を「後」とする。
   点検: `checkManualStudentsKeepTeacher`・`checkTeacherlessStudentsNotAdded`・`checkManualInputsNotLost`・`checkAuditNotWorse`・`summarizeChanges`。
2. **保存→読み込み直し `c`**: 〔保存〕前後で `checkSameState(…, 'save-changed')`。〔読み込み直し〕前後で `checkSameState(…, 'reload-changed')`。保存ボタンが既に clean で押せなかったときは、その旨を報告の notes に書く。
3. **生徒の移動 `b`**: `gotoWeekOf(nextMonday)`。その週の事実から `pickMoveCandidates(…, { count: options.moves, seed: options.seed })`。候補ごとに:
   - 〔移動〕`dragStudent` → 状態が変わっていなければ `info 'move-blocked'`（ステータスの文つき）で次の候補へ。変わっていれば `checkOutsideAllowedRange(前, 後, buildMoveAllowedChange(候補))`・除外の机つきの `checkManualStudentsKeepTeacher`／`checkTeacherlessStudentsNotAdded`／`checkManualInputsNotLost`・`checkAuditNotWorse`。動かした生徒が先の席にいなければ `stop 'move-not-applied'`。
   - 〔元に戻す〕`checkSameState(移動前, 今, 'undo-not-restored')`。〔やり直し〕`checkSameState(移動後, 今, 'redo-not-restored')`。〔元に戻す〕もう一度 `undo-not-restored`（次の候補は同じ土台から始める）。
   - 候補が 1 つも無ければ notes に書く（操作 0 回として数える）。
4. **テンプレ保存 `a`**: `openTemplateEditor` → `setTemplateStartDate(nextMonday)` → `requestTemplateSave`（確認の文と詳細を notes に残す）→ `confirmTemplateSave`。
   点検: `checkOutsideAllowedRange(前, 後, { fromDateKey: nextMonday, sections: TEMPLATE_SAVE_ALLOWED_SECTIONS })`・`checkManualStudentsKeepTeacher(前, 後, { announcedText: 詳細 })`・`checkTeacherlessStudentsNotAdded`・`checkManualInputsNotLost`・`checkAuditNotWorse`・`checkPendingCountMatchesPreview`・`summarizeChanges`。
   続けて〔保存〕`save-changed`・〔読み込み直し〕`reload-changed`（テンプレ保存の結果が読み込み直しで動かないこと）。
5. 最後に `externalRequests`・`pageErrors` を所見にする。

`pickMoveCandidates` の決まり: 元＝その週で日付が今日以降のコマの生徒（出欠記録のある席・保留の机・講師の休みの机は除く）。先＝空いた席（生徒なし・メモなし・出欠記録なし）で**本物の講師がいる机**。`same-slot` は同じコマの別の机、`other-day` は同じ週の別の日のコマで、動かす生徒がそのコマにまだいないもの。種類ごとに候補を作り、種つきの乱数で 1 つずつ選ぶ。`count` が種類の数より多ければ 2 周目に入る。同じ席を 2 回使わない。

**`MOVE_ALLOWED_SECTIONS`・`TEMPLATE_SAVE_ALLOWED_SECTIONS` の決め方**: 実装係がコードを読んで決める（`computeStudentMove`・`executeMoveStudent`・`commitWeeks` と、`handleSaveRegularLessonTemplateByDiff` が書き換える盤面の机以外の state）。決めた根拠（関数名）をコメントに書く。実データで流して出た `outside-allowed-range` は、根拠がコードにあるものだけ足す。

- [ ] **Step 1: `selectors.test.mjs`・`scenarios.test.mjs` を書く**

```js
// selectors.test.mjs
it('台本が頼る testid は、アプリのソースに字面で存在する（名前が変わったら毎 push のテストで気づく）', () => {
  // TESTIDS の各値について SOURCE_FILES_WITH_TESTIDS のどれかに `data-testid="<値>"` がある（App.tsx は CRLF を直して読む）。
  // TESTID_PREFIXES は `data-testid={\`<接頭辞>` の形で存在する。
})
it('長押しの長さと取り消しの距離がアプリと合っている', () => {
  // ScheduleBoardScreen.tsx に `DRAG_LONG_PRESS_MS = 250` と `PRE_ARM_CANCEL_PX = 8` がある（変わったら driver の待ちを見直す合図）。
})
// scenarios.test.mjs
it('乱数: 同じ種なら同じ列・違う種なら違う列', () => {})
it('移動の候補: 6 種類をそれぞれ選ぶ（合成の 1 週間）。同じ種なら同じ候補', () => {})
it('移動の候補: 先は本物の講師がいる空いた席だけ。メモ・出欠記録のある席・保留の机・今日より前の日は選ばない', () => {})
it('移動の候補: 別の日の先は、その生徒がまだいないコマだけ', () => {})
it('移動の候補: 候補の無い種類は飛ばす。全部無ければ空', () => {})
it('移動で変わってよい範囲は、元と先の机だけ', () => {})
```

- [ ] **Step 2: 落ちるのを見る → `selectors.mjs`・`scenarios.mjs` の純関数を実装する → 通るのを見る**
- [ ] **Step 3: `devServer.mjs`・`driver.mjs`・`runClassroomPatrol`・入口のつなぎを実装する**
- [ ] **Step 4: 本番の形で流す（`--seed-file` で Task 4 の種データを使ってよい）**

Run: `node tools/ui-patrol.mjs --out <スクラッチ領域>/patrol-run1`
Expected: 2 校とも最後まで流れる（中断なし）。所要時間を測る（目安 5 分前後。8 分を超えるなら、遅い所を測って報告する）。
続けて同じ種データでもう 1 回流し、所見が同じであること（ぶれないこと）を確かめる。

- [ ] **Step 5: 出た `stop` を 1 件ずつ分類する（ここが要）**

`stop` が出たら、画面写真と差分を見て「本当に変（アプリの不具合の疑い）」か「点検の見立て違い」かを分ける。
- 点検の見立て違い → 点検か変わってよい範囲を直す。**根拠（仕様の節・コードの関数）をコメントとコミットに書く。緑にするためだけに緩めない。**
- 本当に変の疑い → 直さない。場所（日付・時限・机・生徒 ID）・手順・画面写真の path を報告に書いて主セッションへ返す（アプリの修正はこの計画の外）。必要なら `tools/ui-patrol-known.json` へは**載せずに**残す。

- [ ] **Step 6: わざと壊して、点検が鳴ることを確かめる（終わったら必ず戻す）**

`src/components/schedule-board/ScheduleBoardScreen.tsx` の `computeStudentMove` の結果を一時的に壊す（例: 移動のとき、関係ない別の机の講師名を書き換える 1 行を足す）→ 台本 `b` だけ流す（`--scenario b --classroom <1 校>`）→ `outside-allowed-range` が出て終了コード 1 になることを見る → `git checkout -- src/components/schedule-board/ScheduleBoardScreen.tsx` で戻し、`git status` で差分が無いことを確かめる。

- [ ] **Step 7: `npm run lint`・`npx vitest run tools/ui-patrol` を通してコミット**（報告に: 所要時間・2 校の所見の件数・分類の結果・決めた「変わってよい部分」と根拠）

---

### Task 6: でたらめ操作の土台（試験的・既定で動かない）

**Files:**
- Create: `tools/ui-patrol/randomOps.mjs`
- Test: `tools/ui-patrol/randomOps.test.mjs`
- Modify: `tools/ui-patrol/scenarios.mjs`（`--random n` が 1 以上のとき、台本 `b` のあと・`a` の前に手順 `random` を流す）

**Interfaces:**
- Consumes: Task 5 の `createSeededRandom`・`pickMoveCandidates`・driver の操作、Task 3 の点検。
- Produces:

```js
// tools/ui-patrol/randomOps.mjs
export const RANDOM_OP_NAMES = ['move', 'undo', 'redo', 'save', 'reload']
/** 今できる操作の中から、種つきの乱数で次の操作を選ぶ。 */
export function pickNextRandomOp(model, random)   // model: { undoDepth, redoDepth, dirty }
/** 操作のあとの見込み（元に戻す／やり直しの深さ・未保存か）を進める。 */
export function advanceRandomModel(model, opName, { applied })
/** 手順の列を、あとで同じ種で流し直せる 1 行にする（例: "seed=1: move→undo→save→reload"）。 */
export function formatRandomTrace(seed, ops)
export async function runRandomOps({ session, app, options, today, onFinding })   // → { ops: string[], operations: number }
```

**決まり**

- 操作は第 1 段にある 5 つだけ（移動・元に戻す・やり直し・保存・読み込み直し）。第 2 段で操作を足すときは、この一覧に「操作・できる条件・変わってよい範囲」を 1 つ足せば流れる形にする。
- 見込み（model）: 移動が通ると `undoDepth+1`・`redoDepth=0`・`dirty=true`。元に戻すは `undoDepth>0` のときだけ選ぶ。やり直しは `redoDepth>0` のときだけ。読み込み直しは `dirty=false` のときだけ選び、`undoDepth=redoDepth=0` にする。保存は `dirty=false` にする。
- 状態の列を持ち、元に戻すのあとは 1 つ前の状態と `checkSameState(…, 'undo-not-restored')`、やり直しのあとは 1 つ先の状態と `redo-not-restored`、保存・読み込み直しは `save-changed`・`reload-changed`、移動は台本 `b` と同じ点検。
- 最後に必ず `undoDepth` の分だけ元に戻して、手順 `a` を土台の状態から始める。戻らなければ `stop`。
- 報告の notes に `formatRandomTrace` の 1 行を残す。`stop` が出たらそこで手順 `random` を打ち切る。

- [ ] **Step 1: `randomOps.test.mjs` を書く**

```js
it('元に戻す物が無いときは undo を選ばない。やり直す物が無いときは redo を選ばない。未保存のときは reload を選ばない', () => {})
it('同じ種なら同じ操作の列', () => {})
it('見込み: 移動で undo が 1 増え redo は 0。通らなかった移動は変えない。読み込み直しで両方 0', () => {})
it('流し直しの 1 行: "seed=7: move→undo→redo→save→reload"', () => {})
```

- [ ] **Step 2: 落ちるのを見る → 実装する → 通るのを見る**
- [ ] **Step 3: 本番の形で `--random 12 --seed 1` と `--seed 2` を 1 校ずつ流し、最後まで流れること・手順の 1 行が報告に出ることを確かめる**（`stop` が出たら Task 5 の Step 5 と同じ分類をして報告する）
- [ ] **Step 4: `npm run lint`・`npx vitest run tools/ui-patrol` を通してコミット**

---

### Task 7: 文書と組み込み（主セッションが行う・コードなし）

- [ ] `docs/runbooks/ui-patrol.md`（使い方・回すタイミング・終了コード・「変」が出たときの見方・誤報の扱い・過去の時点の流し方・効くことの確かめの結果）
- [ ] `.claude/skills/safe-release/SKILL.md` と `docs/runbooks/release-checklist.md` のチェックリストに 1 行
- [ ] `CLAUDE.md`「テストゲート」に 1 行、`docs/runbooks/morning-health-check.md` に「健診には入れない（オーナー決定 2026-11-11）」の注記
- [ ] `CHANGELOG.md`・`.claude/memory/`（1 記憶＋索引）・`src/utils/developmentStatusLedger.ts`（第 2 段の案＝オーナー判断待ちの 1 行）
- [ ] 効くことの確かめ: 緑が丘校 11/10 朝の形（`--key 2026-11-10T03-00`）で台本 `a` を、今のコードと修正前（v1.5.714＝`7014a07a` の `src/components/schedule-board/` の 5 ファイルへ一時的に戻す・コミットしない）で流す
- [ ] `npm run lint`・`npm run test:unit`・`npm run build` → `regression-reviewer` の全体レビュー → main へマージ → ライブの版を確認

---

## 結果（2026-11-11）

- 作業 1〜6 は実装とレビュー（作業ごと＋全体）を終えた。Task 7 の文書も反映済み。
- 計画から変えた主な点（理由つき）:
  - 伏せ字の対応表を講師の項目用と生徒の項目用の 2 枚にした（講師の姓と生徒の姓が同じ教室で、講師欄が生徒の仮名になった）。名前から作った鍵も組み直す。
  - 自己点検に「名前引きと鍵の前後一致」（`compareNameResolutionForParity`）を足した（保証台帳の結果だけでは弱い）。
  - 終了コード 2 の条件を強めた（教室ごとに手順 0 本・操作 0 回・移動が 1 回も効かない・押しても何も起きない）。
  - 点検に「知らせるだけ」を 2 つ足した（テンプレ自体が講師なしの授業・確認の画面が件数を出した振替の削除）。
  - 外への通信の守りを強めた（同じ origin だけ・WebSocket・`--no-proxy-server`）。Ctrl+C で必ず片づける。
- 実データ（本番 2 校の形）: 通しで約 3 分半・操作 63 回・流すたびに同じ結果。
- 効くことの確かめと、いま出る所見: `docs/runbooks/ui-patrol.md` §7・§9。

