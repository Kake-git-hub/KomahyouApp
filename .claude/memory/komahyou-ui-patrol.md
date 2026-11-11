---
name: 画面の自動巡回(tools/ui-patrol.mjs)
description: 本番の形のデータ(伏せ字)を手元のアプリに入れ、室長と同じ画面操作を自動で行って点検する道具。盤面や画面を変えた修正を main へ入れる前に回す。作りと罠、初回に見つけた所見とその後、変更前との自動比較
type: project
---

# 画面の自動巡回(2026-11-11 第 1 段・v1.5.718)

**きっかけ**: 2026-11-10 の緑が丘「テンプレ保存で手入力の生徒の位置がずれる」(v1.5.715〜717)。本番にしか無い状態(先の反映日 2027-02-01 のテンプレが保存済み)で
思い込みが崩れ、作り物のデータのユニットは通っていた。オーナー「ユーザーが操作したときに変じゃないか、が一番大事」。

**決定(オーナー回答 2026-11-11)**: データは毎回の最新だけ(過去は `--key`)／台本は標準(移動 6 か所)／マージ前に回して「変」が出たら止める／毎朝の健診には入れない。

**回し方**: `node tools/ui-patrol.mjs --out <スクラッチ領域>/…`(約 6 分〔台本 d を足す前は約 4 分〕・終了コード 0/1/2・手順 docs/runbooks/ui-patrol.md・設計 docs/test-strategy.md 層 5)。
盤面のロジック・画面・テンプレ・保存/読み込みを変えたら回す(safe-release のチェックリスト)。

**作り**
- データ: 15 分バックアップを読み取りだけで GET(`fetchData.mjs` の `sendReadOnly`・`assertReadOnlyRequest`)。元データはファイルに書かない。
- 伏せ字(`tools/ui-patrol/anonymize.ts`): ID から仮名(生徒092・講師005)。対応表は講師の項目用と生徒の項目用の 2 枚。名前から作った鍵(`name:…__科目`)も組み直す。
  自己点検 3 つ(名前の漏れ・名前引きと鍵の前後一致・保証台帳の結果の一致)を通らないと止まる。
- 入れ方: **アプリを開く前に**、同じオリジンの空ページから `saveWorkspaceSnapshot`(アプリ自身の関数)で IndexedDB へ。室長でログイン済みの種データ(`seed.mjs`)。
- 読み口: `window.__komahyouUiPatrol.readClassroom()`(`src/utils/uiPatrolHook.ts`・開発用ビルド かつ ローカルモードだけ)。本番ビルドの番人 `tools/check-dist-dev-hooks.mjs`。
- 点検(`boardFacts.ts`・`checks.ts`): 盤面の「意味」(本物の講師・生徒・出自・出欠記録・メモ・保留の下段)で比べる。出自・講師なしはアプリの権威関数。
- 台本(`scenarios.mjs`): 起動 → c 保存→読み込み直し → b 生徒の移動(長押しドラッグ・元に戻す・やり直し) → a テンプレを何も変えずに保存(反映日=来週の月曜)
  → d テンプレを実際に変えて保存(第 2 段・2026-11-11。生徒を 1 人足す → 講師を替える → 机を消す を 1 回の保存に 1 種類ずつ・別々のコマ・最後に保存→読み込み直し)。`--random n` はでたらめ操作(試験的)。
- 台本 d の候補選びは `tools/ui-patrol/templateEdit.ts`(テンプレ作成の画面と同じ机を `resolveTemplateDiffBaseline` で作る・盤面で前の版のその机が当たり手入力の無い机だけ・
  生徒と講師は画面のプルダウンの選択肢から `--seed` の種で選ぶ)。点検は `checks.ts` の `checkTemplateEditApplied`(起きるはずの変化・規則で置かれない日は知らせるだけ)と
  `checkTemplateEditSaved`(保存したテンプレに変更が入っているか)。テンプレ保存の点検の組み合わせは a と d で `collectTemplateSaveFindings` 1 つ。

**踏んだ罠(次に触るとき用)**
- ローカルモードは `navigator.webdriver` が true だと保存を止める(`App.tsx` の `isSnapshotPersistenceRuntimeEnabled`・旧 E2E の名残)。起動引数 `--disable-blink-features=AutomationControlled` で隠す。
- アプリを先に開いてから IndexedDB へ入れると読まれない(初回起動の自動保存のほうが新しい扱い・`loadWorkspaceSnapshot` は新しい方を取る)。
- ローカルモードは変更の 5 秒後に自分で保存して clean になる。保存ボタンが「既に clean で押せない」は普通。
- アプリは週を開いたとき初めてその週を作る。候補は週を開いて読んでから選ぶ。
- 保存→読み込み直しで生徒の席の出自の印(無い ↔ template)が千件単位で付け直される。比べるのは `resolveStudentOrigin` の結果。
- 講師の姓と生徒の姓が同じ教室がある(1 枚の対応表だと講師欄が生徒の仮名になり、名前引きが数千件ずれた)。
- `teacherAssignmentTeacherId` には ID でなく講師の名前が入っている机が約 2,100 ある。名簿から外れた講師の ID も残っている。
- Playwright は `createRequire(import.meta.url)('playwright')`(`/opt/node-tools/node_modules`・`package.json` に足さない)。Chromium は環境変数の proxy を使いうるので `--no-proxy-server`。
- Ctrl+C: 子の vite は別プロセスグループ。Playwright の既定のシグナル処理を切り、自前で片づけて 130。
- (台本 d・2026-11-11) テンプレ作成の画面の生徒・講師のプルダウンは `SearchableSelect`(testId の prop で `<select>` に data-testid)。ソースには `testId="…"` の字面で残るので、
  `selectors.mjs` の `SEARCHABLE_SELECT_TESTIDS` と `selectors.test.mjs` で別に見張る。テンプレの机の `deskIndex` は 1 始まり・画面の机は 0 始まり。
- (台本 d) 確認の画面の「保留 n机」は「反映日以降の開いている日のコマの机のうち、保存のあとに保留の机」(作った保留＋保存し直した保留・`templateConflictRules.ts` の `summary.pending`・休日は飛ばす)で、増えた数ではない。前から保留のある盤面で
  「増えた数＝n」と見て誤報した(日大前の形: 前 30・確認 28・後 28)。点検は `countPendingDesksFrom` で数えて等号(手直し 1)。
- (台本 d) 講師を替えるときは確かめる日のコマに居ない講師だけ選ぶ(居る講師に替えると点検が素通り・無ければ飛ばす)。足した生徒にその日その時限の削除記録(保存前からの抑止キー)があれば知らせるだけ。
- (台本 d) 既知の制約: 手入力のある机でテンプレを変える形は未検査(§2-1 と「講師なしは変」の扱いを決めてから)。
- (台本 d) テンプレ保存の反映(第 2 版)の本体は `templateConflictRules.ts` の `computeTemplateDiffApply`(`ScheduleBoardScreen.tsx` の `runTemplateDiffApplyV2`)。
  `templateDiffApply.ts` の `stripUnmarkedRegularStudents`・`resolveTemplateDeskTeacher` を 1 行壊しても巡回の盤面は変わらなかった。講師の置き場は保存後の読み直し(再マージ)が
  通常授業の行から作り直すので、反映の途中の講師の選び方を壊しても室長に見える不具合にならない。「わざと壊す」は盤面に出る所(手入力の拾い上げ・画面の追加)で行う。
- (台本 d) d だけ流すと(`--scenario d`)1 回目の保存で先の版(反映日が来週より先)の中身も当たり、変わった机にその分が混ざる(注に出る)。ふだんは a のあと。

**効くことの確かめ**: 緑が丘 11/10 朝の形(`--key 2026-11-10T03-00`)・台本 a・反映日 11/16。修正前(v1.5.714)= 止める所見 29(うち「手入力の生徒の講師が変わった」8)。今のコード= その所見 0。
戻し方は `git checkout 7014a07a -- src/components/schedule-board/{ScheduleBoardScreen.tsx,templateDeskOrderRestore.ts,templateDiffApply.ts,templateTransferFollow.ts,checklistPrep.ts}` → 流す → `git checkout HEAD -- …`。

**初回に見つけた所見と、その後(2026-11-11)**
- A(不具合): 先の反映日のテンプレが保存済みの教室で反映日を手前へ動かして保存すると、別の講師 W の授業に手で入れた講師 X が 1 人で空き机へ移り、テンプレの生徒が講師なしで残る
  (日大前校の形で 29 机・確認の画面に出ない)。→ **v1.5.719 で修正(Issue #84・INV-02)**。`templateDeskOrderRestore.ts`: 机の手がかりに「手で入れた X」を添え、
  順番 0(新テンプレの X の机がこの机のテンプレの生徒を 1 人でも持つ → W が居ても X の机へ)／1(W が居る → W へ・§9-15)／2(W が居らず X が居る → X へ)／3(どちらも居ない → 空き机)。
  X が休み・X の机が保留・X の番号を先に取られた、は合流しない。仕様 `docs/spec-template-conflict-v2.md` §9-23。
- B(仕様): 室長が講師を消した机(削除記録)へテンプレの生徒が講師なしで置かれる。→ **オーナー「講師を消した机にテンプレ生徒を置く」=仕様どおり(§9-24・Issue #85)**。アプリは変えず、
  巡回は「知らせるだけ」(`teacherless-student-at-deleted-teacher-desk`・条件=その机が講師の削除記録 かつ 生徒の出自が template かつ そのコマで操作が削除記録を増やしていない〔机単位にしないのは、並べ直しで削除記録の机が机ごと別の番号へ移るため〕)。削除記録の判定は `isTemplateDiffTeacherTombstone`
  (`ScheduleBoardScreen.tsx` の `isDeletedTeacherTombstone` は空き机としての判定で、生徒が居る机では偽)。
- その後の本番 2 校の形は止める所見 0(日大前の台本 a: 60 → 8 → 0)。A の修正前(c9328b1c)を `--baseline-ref` にすると「消えた変 50 件」＝A が再発すれば止まる。
- 残した問い(2026-11-11 オーナー決定=案 1・未実装・台帳 `teacher-rest-hand-placed-elsewhere`): 休みにした講師 X の机に代わりの講師を置き、同じコマの別の机へ X を手で置いた形。今は X を「来ている」と扱い合流する(v1.5.719 のまま)。`isTeacherRestedInCell` に替えると 1 回目の保存で離れ 2 回目で戻る(INV-03)ので替えていない。
- 2026-11-11 01:45 時点の緑が丘の本番データには、今日以降に「生徒がいるのに講師なしの机」が 13 あった(うち削除記録の机 4)。

**変更前との自動比較(第 2 段の 2・2026-11-11)**
- `--baseline-ref <ref>`: その ref のアプリを `git archive` で `<out>/baseline-app/` に取り出して先に流し、今の作業ツリーと比べる(作業ツリー・index・ブランチに触らない。約 2 倍=2 校で約 7 分)。
  `--baseline <report.json>`: 報告どうし。止める所見を 新しい(`[変・新]`)／前から(`[変・前]`)／消えた(`[消えた]`)に分け、**新しい変が 0 なら終了コード 0**。
- 同じ種データでないと比べない(報告に種データの指紋)。依存(`package-lock.json`)が違う ref・読み口の無い版(v1.5.718 より前)は断る(2)。2 つ同時には流せない(ポートと `node_modules` を共用)。
- ふだんは比べずに回し、「変」が出たら `--baseline-ref origin/main --seed-file …` で流し直す(手で `git stash` して比べない)。

**台本 d が効くこと(2026-11-11)**: 緑が丘の形・`--scenario d`・壊す前の報告と `--baseline` で比べた(どれも戻した)。手入力の生徒を拾わない(`templateConflictRules.ts` の `collectManualSeatItems`)=`[変・新]` 79 件・終了コード 1。
画面で足した生徒の `managedStudentId` を空にする(`handleTemplateConfirmAdd`)=「保存されていない」1＋「盤面に反映されていない」9・終了コード 1。今のコードの本番 2 校(11/11 18:45)は止める所見 0・全体 5 分 50 秒。

**次のセッションへの引き継ぎ(2026-11-11 オーナー回答)**: 第 2 段の残りは推奨順(台本 → 事故の日の形 → でたらめ操作 → 毎晩)。手順は `docs/plan-2026-11-11-ui-patrol-stage2-handoff.md`。休みの講師を同じコマへ手で置いたら休みをコマ全体で解除する(案 1)は v1.5.723 で済み(spec-template-conflict-v2 §9-25)。

**第 2 段の残り(台帳 `ui-patrol-stage2`)**: 台本を足す(出欠・講師の移動・丸ごと振替・休日設定・講習の自動割振。テンプレを実際に変えて保存=台本 d は済み)／でたらめ操作を既定に／毎晩の自動実行／過去の事故の日の形の一覧。
カード 1(テンプレ保存前の自己点検)が同じ数え方を使うときは `tools/ui-patrol/boardFacts.ts` を `src/` へ移して共有する。
