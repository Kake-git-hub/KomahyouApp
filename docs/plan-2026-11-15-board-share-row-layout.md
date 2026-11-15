# 講師日程共有の机を「席番｜講師｜生徒｜生徒」の 1 行にする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 講師がスマホで開く共有ページ（`BoardShareScreen`）の机を、コマ表と同じ「席番｜講師名｜生徒｜生徒」の 1 行 1 机にし、文字を大きくする。

**Architecture:** 見た目だけの変更。生徒の欄に出す文字の組み立てを純関数 `resolveBoardShareSeatLines` に切り出してテストで固定し、JSX は机 1 つを 4 つの子（席番・講師・生徒 2 つ）に平らにする。文字の大きさは机の行をコンテナにして行の高さ・幅から CSS だけで決める（JS で測らない）。

**Tech Stack:** React + TypeScript、`src/App.css`、vitest。

**Spec:** `docs/spec-schedule-pdf.md` §N（2026-11-15 オーナー確定）

## Global Constraints

- 共有するデータ（`src/integrations/firebase/boardShare.ts`）・`resolveBoardShareSeatView`（INV-04）・`getVisibleDateLabel`・`resolveBoardShareLinkedDestinationDateKey`・`getStudentStatusLabel`・フッター・集団授業の帯・`layoutNonce` の再マウント（iOS の初回レイアウト対策）は変えない。
- 既存の export（`formatStudentLabel`・`getLessonTypeLabel` ほか）と既存テストの assert は変えない・消さない。`formatStudentLabel` は生徒の欄の `title` として使い続ける（死んだコードにしない）。
- 利用者に見える文字に「配布用盤面」を出さない（`boardShareWording.test.ts`）。
- 生徒の欄は 2 段。上段 = 名前（記録だけの席は `名前(休`）＋日付の札、下段 = 授業の印・学年・科目＋授業時間・講師の種別（通常講師は空）。右端の「通常／振替…」の文字は出さない。
- 文字の大きさ: 名前・講師名 `clamp(11px, min(40cqh, 4.6cqw), 22px)`、下段 `clamp(9px, min(29cqh, 3.4cqw), 16px)`、席番は名前と同じ。コンテナクエリが使えないブラウザは名前 14px・下段 11px。数値は画面で確かめて、1 画面に収まらない・切れるときだけ動かす（動かしたら spec §N の数字も合わせる）。
  - 実装時の結果(2026-11-15): 画面で見て名前・講師名は `4.3cqw` に下げた(390 幅で「名前(休」＋日付の札が早く切れたため)。列は `32px minmax(0, 0.8fr) minmax(0, 2fr) minmax(0, 2fr)`(席番 28px だと 768 幅の 2 桁が詰まる・講師は約 17%)。講師名は 2 行で切った字の頭が覗かないよう `.board-share-teacher-cell` で包んで縦の真ん中に置く(`safe center`)。spec §N の 11〜22px・9〜16px・14〜17px は実測と合うので変更なし。
- 全部の机がスクロールなしで 1 画面に収まる（`grid-template-rows: repeat(机の数, minmax(0, 1fr))` は残す）。
- 公開リポジトリ。テスト・スクリーンショット用のデータに実在の名前を使わない。本番 Firestore へは読み書きしない。
- `package.json` の version は触らない。worktree は作らない。ブランチは `ccr-2640a407-bp4lz7` のまま。

## Review Focus

- 机が多い（20 机）＋小さいスマホ（375×667）: 行が低くても 2 段が欄からはみ出して隣の行に重ならない。
- 長い名前・長い講師名: 「…」で切れ、日付の札と下段の学年・科目は押し出されない。
- 別の生徒の休み記録が残る席に生徒が居る（INV-04）: 名前に `(休` が付かない・灰色にならない。
- 生徒が居ない席・講師が居ない机（埋め草「講師未割当」）: 空の欄として出て、列の幅が崩れない。
- コンテナクエリ非対応のブラウザ: 固定の大きさで読める形になる。

---

### Task 1: 1 行 1 机の並びと大きい文字

**Files:**
- Modify: `src/components/board-share/BoardShareScreen.tsx`（`resolveBoardShareSeatLines` を足す・机の JSX を平らにする）
- Modify: `src/App.css`（`.board-share-desk`〜`.board-share-status` の区画。`.board-share-desk-body`・`.board-share-students`・`.board-share-lesson-type` は消す）
- Create: `src/components/board-share/boardShareSeatLines.test.ts`
- Create: `src/components/board-share/boardShareRowLayout.test.ts`
- Modify: `src/utils/verificationChecklist.ts`・`src/utils/verificationChecklist.test.ts`（項目 `bs-2`〔`bs-1` は過去に OK で外した ID でテストが再利用を禁じているため〕・第141版・版は `v1.5.711` 据え置き）
- Modify: `CHANGELOG.md`（`## 未リリース` に 1 行）

**Interfaces:**

```ts
export type BoardShareSeatLines = {
  name: string            // 上段。名前だけ(2026-11-15 手直し: 記録の印は statusLabel に分けた。名前の「…」に印を巻き込まないため)
  statusLabel: string     // 記録だけの席は '(休' など。生徒が居る席は ''。画面は名前の直後に縮まない span で出す
  marker: string          // 通 / 振 / 講 / 増 / 体 / 外
  markerLabel: string     // 通常 / 振替 / 講習 / 増コマ / 体験 / 外部生 (title・aria-label 用。getLessonTypeLabel と同じ)
  grade: string
  subject: string         // 科目＋授業時間 (例: 数60)
  teacherTypeLabel: string // 代行講師 / 担当科目外講師。通常講師は ''
}

export function resolveBoardShareSeatLines(
  visibleStudent: BoardShareStudentEntry | BoardShareStatusEntry | null | undefined,
  visibleStatus: Pick<BoardShareStatusEntry, 'status'> | null | undefined,
  options?: { isExternalStudent?: boolean; transferSourceRestDisplayEnabled?: boolean },
): BoardShareSeatLines | null
```

`visibleStudent`・`visibleStatus` は `resolveBoardShareSeatView` の戻り値をそのまま渡す。授業の印・授業時間・講師の種別は既存の `getLessonShortLabel`・`normalizeRegularLessonNote`・`getTeacherTypeLabel`・`getStudentStatusLabel` を使う（規則を書き直さない）。

- [ ] **Step 1: 落ちるテストを書く（`boardShareSeatLines.test.ts`）**

データの作り方は `boardShareSeatView.test.ts` の `createStudent`・`createAbsentStatus` と同じ形。次を 1 つずつ `it` にする。

```ts
// 通常の生徒
expect(resolveBoardShareSeatLines(createStudent({ name: '山田 太郎', grade: '中2', subject: '数', lessonType: 'regular' }), null))
  .toEqual({ name: '山田 太郎', marker: '通', markerLabel: '通常', grade: '中2', subject: '数', teacherTypeLabel: '' })
// 授業時間
expect(resolveBoardShareSeatLines(createStudent({ subject: '数', noteSuffix: '60' }), null)?.subject).toBe('数60')
// 授業の印 5 種: regular 通 / makeup 振 / special 講 / extra 増 / trial 体
// 外部生: どの lessonType でも marker '外'・markerLabel '外部生'
expect(resolveBoardShareSeatLines(createStudent({ lessonType: 'makeup' }), null, { isExternalStudent: true }))
  .toMatchObject({ marker: '外', markerLabel: '外部生' })
// 講師の種別
expect(resolveBoardShareSeatLines(createStudent({ teacherType: 'substitute' }), null)?.teacherTypeLabel).toBe('代行講師')
expect(resolveBoardShareSeatLines(createStudent({ teacherType: 'outside' }), null)?.teacherTypeLabel).toBe('担当科目外講師')
// 記録だけの席: 名前に記録の印が続く
const absent = createAbsentStatus({ name: '欠席 太郎', status: 'absent' })
expect(resolveBoardShareSeatLines(absent, absent)?.name).toBe('欠席 太郎(休')
// absent-no-makeup → '(振無休' / attended → '(出' / moved → 既定 '(移'・transferSourceRestDisplayEnabled: true で '(休' / holiday → '(休'
// 空の席
expect(resolveBoardShareSeatLines(null, null)).toBeNull()
// INV-04: 別の生徒の休み記録が残る席に体験生が居る → 体験生の名前に (休 が付かない
const view = resolveBoardShareSeatView(createStudent({ name: '体験 花子', lessonType: 'trial' }), createAbsentStatus())
expect(resolveBoardShareSeatLines(view.visibleStudent, view.visibleStatus)?.name).toBe('体験 花子')
```

- [ ] **Step 2: 落ちるテストを書く（`boardShareRowLayout.test.ts`）**

`boardShareWording.test.ts` と同じ読み方で `BoardShareScreen.tsx` と `src/App.css` を文字列で読み、次を固定する。

- 画面: `board-share-desk-body`・`board-share-students`・`board-share-lesson-type` を含まない。`board-share-student-name`・`board-share-student-detail`・`board-share-student-marker` を含む。`resolveBoardShareSeatLines(` を呼ぶ。`board-share-seat` → `board-share-teacher` → `board-share-student` の順に出てくる。
- CSS: `.board-share-desk {` の区画の `grid-template-columns` が 4 列（値を空白で分けて、括弧の中を 1 つに数えて 4 つ）。`container-type: size` を含む。`.board-share-desk-body`・`.board-share-students`・`.board-share-lesson-type` の区画が無い。`.board-share-desk-list` の `grid-template-rows: repeat(var(--board-share-desk-count, 14), minmax(0, 1fr))` が残っている。旧形の `font-size: 9px`（生徒）・`font-size: 10px`（講師）が `.board-share-student`・`.board-share-teacher` の区画に無い。

- [ ] **Step 3: 落ちるのを見る**

Run: `npx vitest run src/components/board-share`
Expected: 新しい 2 ファイルが FAIL（`resolveBoardShareSeatLines` が無い・旧クラスが残っている）。既存 6 ファイルは PASS。

- [ ] **Step 4: 変更前の画面を撮る**

共有ページは本番の Firestore からトークンで読むので、手元では読む口を差し替えて開く。リポジトリには置かず、スクラッチ領域に Vite の設定を作る: `root` はリポジトリ、`share.html` を開く、`resolveId` で `integrations/firebase/boardShare` の import を偽のモジュール（`loadBoardShare`・`subscribeBoardShare`・`isExternalBoardShareStudent` と型だけ）へ向ける。偽のデータは 14 机と 20 机の 2 通り（URL の `?desks=` などで切り替え）で、長い名前・長い講師名・生徒 2 人・生徒 1 人・空の机・講師なし・休みの記録だけの席（日付の札つき）・振替（振替元の日付つき）・授業時間 60・代行講師・集団授業の帯を混ぜる。Playwright（導入済み・`chromium.launch()` そのまま・`deviceScaleFactor: 2`）で 375×667・390×844・768×1024・1280×720 を撮り、スクラッチ領域の `before/` に置く。

- [ ] **Step 5: 実装する**

- `resolveBoardShareSeatLines` を `formatStudentLabel` の近くに足す。
- 机の JSX: `<section className="board-share-desk">` の直下に `board-share-seat`・`board-share-teacher`・`board-share-student` ×2 を置く（`board-share-desk-body`・`board-share-students` の入れ物をやめる）。生徒の欄は上段 `board-share-student-name-row`（`board-share-student-name` ＋ `board-share-origin-date`）と下段 `board-share-student-detail`（`board-share-student-marker` に `title`・`aria-label` = `markerLabel`、学年、科目、`board-share-student-teacher-type`）。欄の `title` に `formatStudentLabel(...)` ＋記録の印（今の 1 行の文字）を入れる。記録だけの席の `board-share-status` クラスは残す。
- CSS: `.board-share-desk` を 4 列の grid（席番は狭い固定幅、講師は全体の 2 割前後、生徒 2 つは残りを等分）＋ `container-type: size`。大きさは Global Constraints の値。講師名は 2 行まで折り返して「…」。名前は 1 行で「…」、日付の札と学年・科目は縮めない（`flex: none`）、講師の種別は入らなければ「…」。コンテナクエリ非対応の大きさは `@supports` の外に先に書き、画面の高さ ÷ 机の数から決める（`clamp(11px, calc((100vh - 110px) / var(--board-share-desk-count, 14) * 0.38), 14px)`・下段は `* 0.28` で 9〜11px。2026-11-15 手直しで固定 14px/11px から変更）。

- [ ] **Step 6: テストが通るのを見る**

Run: `npx vitest run src/components/board-share`
Expected: 8 ファイル全部 PASS。

- [ ] **Step 7: 変更後の画面を撮って見比べる**

Step 4 と同じ 8 通りを `after/` に撮り、Review Focus の 5 点を 1 枚ずつ目で確かめる（Read で画像を開く）。重なり・はみ出し・切れすぎがあれば CSS の数値を直して撮り直す。`container-type` を外した形（非対応ブラウザの代わり）も 375×667・14 机で 1 枚撮る。

- [ ] **Step 8: 確認リストに項目を足す**

`VERIFICATION_CHECKLIST.items` の末尾（`pc-2` の後）に足し、ファイル先頭の版の履歴コメントに第141版を 1 行足す。`VERIFICATION_CHECKLIST_VERSION` は `v1.5.711` のまま。テスト（項目 ID の並びを固定している 3 か所ほか）も追随させる。

```ts
{
  id: 'bs-2',
  area: 'コマ表',
  title: '講師日程共有のページが1行1机で字が大きい',
  steps: ['コマ表の「講師日程共有」を押し、出てきたリンクをスマホで開く', '生徒が2人いる机と、休みの記録がある机を見る', '「後コマ」「翌日」を押して別のコマも見る'],
  check: ['1行が1机で、左から 席番・講師名・生徒・生徒 の順', '生徒の欄は上が名前、下が「通 中2 数」のような印・学年・科目で、前より字が大きい', '全部の机がスクロールなしで1画面に収まる'],
  introducedIn: 'v1.5.736',
},
```

- [ ] **Step 9: 全体の確認**

Run: `npm run lint && npm run test:unit && npm run build`
Expected: 3 つとも成功。

- [ ] **Step 10: CHANGELOG とコミット**

`CHANGELOG.md` の `## 未リリース` に `- style: 講師日程共有のページを 1 行 1 机(席番｜講師｜生徒｜生徒)にし、生徒の欄をコマ表と同じ 2 段・字を大きくした(…)` を 1 行。`git diff` を通読してからコミットする（push はしない）。
