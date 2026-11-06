# 確認リストの「準備する」ボタン（自動準備・案 C 段階導入）— 計画（2026-11-06）

> 状態: **オーナー選択済み（2026-11-06「確認リストの準備は案 C で進めて」）。第 1 段を実装中。**
> 出典: 確認リストのフリーメモ（受付 `20261105-190026128`・`20261105-190336460`・版 v1.5.689）
> 「いちいち確認リストの確認状況を作るのが面倒なので、開発用画面のデータを確認リストの手順で勝手に書き換えて、開発者はその結果だけを見て
> そうなっているかをチェックするだけにしたい」「勝手に書き換えられるのは開発用教室とテスト教室にして」。
> 正本（確定したら）: `docs/spec-developer-report.md` §E-2 に「E-2-4 準備する（自動準備）」として書き足す。進行中テーマ台帳 `checklist-auto-prep`。

## 0. オーナー決定

| # | 論点 | 決定 |
|---|---|---|
| 1 | 進め方 | **案 C（段階導入）**: 確認リストの項目に「準備する」ボタンを付け、ブラウザの中で開いているコマ表に準備を作る。まず 2〜3 項目で試し、使えるなら広げる。新しい書き込み経路（Cloud Function・サービスアカウント）は作らない |
| 2 | 対象 | **開発用教室とテスト教室だけ**。本番 3 校にはボタンも処理も出さない |
| 3 | 保存 | 準備はコマ表を変えるだけ。**保存は今までどおり「保存」ボタン**（自動保存はしない: 未保存の変更との衝突と、保存経路の分散を避ける） |
| 4 | 試用の結果（2026-11-06・確認リスト ap-1 OK） | 「準備する」は使える。ボタンは**項目の左側**へ（v1.5.693）。メモ「**やることも手順ごとに準備と同じように自動化して**」は使い勝手に影響するので、懸案（確かめたい操作そのものを機械が行うと画面の不具合を見逃す・テンプレ保存の自動化は重い・項目ごとに専用の処理が要る・開発用教室のテンプレにゴミが溜まる）と妥協案を出して**オーナー判断待ち** |
| 5 | 第 2 段（2026-11-06・オーナー回答） | **データ作りだけ自動化**（確かめたい操作は手で）。「準備する」1 回でテンプレ登録と**保存まで自動**（確認画面・保存前 PDF は出さず、「詳細」の文は結果の文へ）。テンプレに登録するのは**確認用の生徒**（名簿に初回だけ足す）。**「後片づけ」ボタン**で確認用だけ消す。**まず tp-64 だけ**。仕様 spec-developer-report §E-2-4-2 |

## 1. 原則

1. **本番教室には出さない**。パネルは `isActingDevelopmentClassroom` のときしかマウントされない（App.tsx・source-scan テストで固定）。
   コマ表側の処理も、開いている教室が開発用・テスト教室でなければ断る（二重のガード）。
2. **室長の操作と同じ経路でコマ表を変える**: 置く・替える操作は `commitWeeks` を 1 回通す（出自の印・Undo・ダーティ署名・保存ボタンは今どおり）。
   直接 state を書かない。
3. **準備の中身は純関数で決める**（`src/components/schedule-board/checklistPrep.ts`）。入力＝週・名簿・今日・反映開始日・保留マップ、
   出力＝「どのコマのどの机・席に何を置くか」の操作の列と、人が読む結果文（または置けない理由）。コマ表は操作を当てるだけ。テストは純関数で固定。
4. **会計中立（INV-06）**: 第 1 段では在庫を動かす操作（休み・振替の配置・講習）を使わない。手入力の生徒は**体験**（`lessonType: 'trial'`・
   `manualAdded: true`・出自＝手入力・青字・§2-1 の 2 行の根拠になる）で代用する。振替が要る項目（v2-6 など）は第 2 段。
5. **置き場の選び方**: 反映開始日より後で、今日以降の最初の営業日から順に、条件に合う空き席を探す（休校日・保留（2 行）の机・出欠記録のある席は使わない）。
   見つからなければ理由を出して何もしない（勝手に消さない・動かさない＝INV-02）。
6. **一過性リクエスト（Issue #46 同型）**: App の state `checklistPrepRequest`（`requestId`・`itemId`）→ `ScheduleBoardScreen` の effect が 1 回だけ処理 →
   結果を App へ返して App が消費（null）。処理済み `requestId` は ref で持ち、再マウント・再レンダーで二重実行しない（`parentAbsenceRequest` と同じ作法）。
7. **結果文は具体的に**: 「11/12(水) 5限 机 3 の生徒 2 に体験 ○○ を置きました」のように日付・時限・机・席を出し、**残る手作業**（テンプレ作成で登録する内容など）も書く。
   項目の下に出し、同じ項目でもう一度押せば作り直す（前の準備は消さない＝残っていれば別の席を使う）。

## 2. 第 1 段の対象（2 項目＋枠組み）

| 項目 | 自動で作るもの | 残る手作業（結果文に出す） |
|---|---|---|
| v2-1（青字） | 講師も授業も無い空き机 3 つに、体験 2 人（同じ机）・メモ 1 つ（別の机の席 1）・手で置く講師 1 人（別の机・授業なし・`setManualTeacherAssignment`）。テンプレの机は替えない（替えるとテンプレ保存で講師欄が緑 2 行になり v2-1 の目安と食い違う・regression-reviewer 要修正 1）。空き机が 3 つ無いコマは飛ばす | なし（項目の手順どおり並び替え → テンプレ保存） |
| tp-64（講師欄の緑） | (1) テンプレの講師 X と生徒 A が居る机の講師を手で Y に替え、席 2 に体験。(2) 別のテンプレ机の席 2 に体験 | **必須**: 「通常授業テンプレ作成」で (1)・(2) の両方の席（生徒 2）に誰かを登録して保存（(1) は講師欄 2 行＋席 2 も 2 行、(2) は席 2 だけ 2 行で講師欄は白） |

第 2 段の候補: tp-71（同じ日の別の時限へ動かす・`computeStudentMove` 系の純関数で可）・v2-6（振替＝休み → 在庫から配置・会計を伴う）・v2-3。

## 3. 実装メモ（着手順）

1. **純関数** `checklistPrep.ts`:
   - `CHECKLIST_PREP_ITEM_IDS`（準備できる項目 id）と `planChecklistPrep(input): ChecklistPrepPlan`（`{ ok: true, dateKey, weekIndex, cellId, ops, message }` ｜ `{ ok: false, reason }`）。
   - `ChecklistPrepOp` = `{ kind: 'trial', cellId, deskIndex, studentIndex, name, grade, subject }` ｜ `{ kind: 'memo', cellId, deskIndex, studentIndex, text }` ｜ `{ kind: 'manual-teacher', cellId, deskIndex, teacherName, teacherId }`。
   - `applyChecklistPrepOps(weeks, ops, aliases)` → 新しい weeks（体験は `createStudentId` と同じ id 規則・`lesson.id` は `${cellId}_desk_${n}_manual`、
     講師は `setManualTeacherAssignment`（ScheduleBoardScreen.tsx 5418 行の module 関数を export するか、`deskTeacherAssignment.ts` へ切り出す）、メモは `memoSlots`）。
   - 体験の名前は「確認用 体験」＋連番、学年・科目は名簿の先頭の生徒に合わせる（名簿が空なら固定値）。講師は名簿（`teachers`）からその机の講師と別の人（呼び名の対応表で同一視）を選ぶ。
2. **項目定義** `verificationChecklist.ts`: `VerificationChecklistItem.autoPrep?: true`。v2-1・tp-64 に付け、prep の文を「『準備する』を押す（…を自動で置く）。」に。
   テスト: `autoPrep` の項目は必ず `CHECKLIST_PREP_ITEM_IDS` にある（逆も）。
3. **コマ表** `ScheduleBoardScreen.tsx`: props `checklistPrepRequest?: ChecklistPrepRequest | null`・`onChecklistPrepRequestProcessed?`。effect: テンプレ編集中は断る →
   対象日の週が表示中でなければ `jumpToWeekByDate` → `planChecklistPrep` → `applyChecklistPrepOps` → `commitWeeks(nextWeeks, weekIndex, cellId, deskIndex)` → 結果を返す。
4. **App.tsx**（⚠️ CRLF。書き換え後に `file src/App.tsx` で CRLF を確認）: state・`handleChecklistPrepare(itemId): Promise<ChecklistPrepResult>`（保険タイマー 10 秒）・
   パネルへ `onPrepare`・コマ表へ request と processed。教室ガードは `isActingDevelopmentClassroom`。
5. **パネル** `VerificationChecklistPanel.tsx`: `item.autoPrep && onPrepare` のとき「準備する」ボタン（`data-testid="verification-checklist-prep-<id>"`）。実行中は無効。
   結果文は `verification-checklist-prep-result`（component state・下書きには保存しない）。別タブ表示でも同じ。
6. **テスト**: `checklistPrep.test.ts`（置き場の選び方・操作・結果文・置けない理由・休校日/保留/記録の席を避ける・2 回押すと別の席）、
   `VerificationChecklistPanel.wiring.test.ts`（ボタンは autoPrep の項目だけ・押すと onPrepare・結果文）、コマ表の配線テスト（effect が 1 回だけ処理し結果を返す・テンプレ編集中は断る）、
   App の source-scan（props の配線・本番教室で渡さない）。
7. **文書**: `docs/spec-developer-report.md` §E-2 に「E-2-4 準備する（自動準備）」、確認リストの版を上げる、台帳 `checklist-auto-prep` を「開発用教室で先行中」へ、CHANGELOG、memory。

## 4. 保証（触れる INV）

- INV-02（手入力は消えない）: 準備は足すだけ。既にあるものを消さない・動かさない。
- INV-06（在庫の保存則）: 第 1 段は体験・メモ・講師だけなので在庫は動かない（テストで未消化の数が前後で同じことを固定）。
- INV-13: 日程表・PDF への影響なし（体験は今までどおり出る）。

## 5. 使い方（オーナー向け・確認リストの文にも書く）

1. 開発用教室（またはテスト教室）でコマ表を開く。
2. 確認リストの項目の「準備する」を押す → 結果文を読む（どこに何を置いたか・残る手作業）。
3. 「保存」を押してから、項目の「やること」を行い、OK／要改善を送る。
