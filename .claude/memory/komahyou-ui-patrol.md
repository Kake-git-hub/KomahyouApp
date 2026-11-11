---
name: 画面の自動巡回(tools/ui-patrol.mjs)
description: 本番の形のデータ(伏せ字)を手元のアプリに入れ、室長と同じ画面操作を自動で行って点検する道具。盤面や画面を変えた修正を main へ入れる前に回す。作りと罠、初回に見つけた所見とその後、変更前との自動比較
type: project
---

# 画面の自動巡回(2026-11-11 第 1 段・v1.5.718)

**きっかけ**: 2026-11-10 の緑が丘「テンプレ保存で手入力の生徒の位置がずれる」(v1.5.715〜717)。本番にしか無い状態(先の反映日 2027-02-01 のテンプレが保存済み)で
思い込みが崩れ、作り物のデータのユニットは通っていた。オーナー「ユーザーが操作したときに変じゃないか、が一番大事」。

**決定(オーナー回答 2026-11-11)**: データは毎回の最新だけ(過去は `--key`)／台本は標準(移動 6 か所)／マージ前に回して「変」が出たら止める／毎朝の健診には入れない。
同日夕方の追加回答: 所要時間は**約 10 分のまま**(既定=boot・c・b・e・f・a・d。台本 g は選んだときだけ)／**毎晩の自動実行はやらない**(鍵を新しい場所に置かない)。

**回し方**: `node tools/ui-patrol.mjs --out <スクラッチ領域>/…`(約 10 分〔実測 9 分 42 秒・台本 f を足す前は約 7 分・e を足す前は約 6 分・d を足す前は約 4 分〕・終了コード 0/1/2・手順 docs/runbooks/ui-patrol.md・設計 docs/test-strategy.md 層 5)。
盤面のロジック・画面・テンプレ・保存/読み込みを変えたら回す(safe-release のチェックリスト)。

**作り**
- データ: 15 分バックアップを読み取りだけで GET(`fetchData.mjs` の `sendReadOnly`・`assertReadOnlyRequest`)。元データはファイルに書かない。
- 伏せ字(`tools/ui-patrol/anonymize.ts`): ID から仮名(生徒092・講師005)。対応表は講師の項目用と生徒の項目用の 2 枚。名前から作った鍵(`name:…__科目`)も組み直す。
  自己点検 3 つ(名前の漏れ・名前引きと鍵の前後一致・保証台帳の結果の一致)を通らないと止まる。
- 入れ方: **アプリを開く前に**、同じオリジンの空ページから `saveWorkspaceSnapshot`(アプリ自身の関数)で IndexedDB へ。室長でログイン済みの種データ(`seed.mjs`)。
- 読み口: `window.__komahyouUiPatrol.readClassroom()`(`src/utils/uiPatrolHook.ts`・開発用ビルド かつ ローカルモードだけ)。本番ビルドの番人 `tools/check-dist-dev-hooks.mjs`。
- 点検(`boardFacts.ts`・`checks.ts`): 盤面の「意味」(本物の講師・生徒・出自・出欠記録・メモ・保留の下段)で比べる。出自・講師なしはアプリの権威関数。
- 台本(`scenarios.mjs`): 起動 → c 保存→読み込み直し → b 生徒の移動(長押しドラッグ・元に戻す・やり直し) → a テンプレを何も変えずに保存(反映日=来週の月曜)
  (a の前に e 出欠〔第 2 段の 2 本目・2026-11-11〕と f 講師の移動・入れ替え・休み〔第 2 段の 3 本目・2026-11-11〕)→ d テンプレを実際に変えて保存(第 2 段・2026-11-11。生徒を 1 人足す → 講師を替える → 机を消す を 1 回の保存に 1 種類ずつ・別々のコマ・最後に保存→読み込み直し)。`--random n` はでたらめ操作(試験的)。
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

- (台本 e・2026-11-11) 出欠の入口は盤面の生徒メニュー(`menu-absence-button` など。保留の机の上段は「出席」が無い)。振替先は ツールバー「未消化振替」→ 生徒の行
  (`makeup-stock-entry-{生徒キー__- の記号を - に}`・JS の置換は UTF-16 の 1 文字ずつ)→ 振替元の行(`stock-origin-item-N`・文字は「科目 2026/11/17(火) 4限 (理由)」)→ 空欄の席。
  選択の取り消しは `cancel-selection-button`(prop で付くので `PROP_TESTIDS` で別に見張る)。在庫は `tools/ui-patrol/stock.ts`(アプリの関数・入力の作り方は `invAuditEntry.ts` の `readSnapshotInputs` を共有)。
- (台本 e) 手動追加(`manualAdded`)・編集で振替にした生徒(`editedToMakeup`・`editedFromRegular`)は未消化振替の消化に数えない(`collectMakeupUsageByKey`)ので「休み +1」で確かめられない。
  生徒の事実(`boardFacts.ts`)はこの印を持たない(署名に入れると読み込み直しで誤報しうる)ので、教室データから席を集めて除く(`collectStockIneligibleSeatKeys`)。
- (台本 e) 範囲は机単位だと、同じ机の隣の席の生徒が消えても素通りした(「わざと壊す」で分かった)。机の中は操作した席とその生徒の記録 1 件だけ変わってよい(`checkAttendanceApplied`)。
- (台本 e) 振替先を先に選ぶと、出欠の候補の生徒の机の空いた席を取ってしまい候補が減った。出欠の操作を先に選び、振替先は残りの机から選ぶ。
- (台本 e) テンプレ保存の §2-4「記録が勝つ」は守りが何重にもある(休みで積む抑止キー・盤面から導く抑止・`collectTemplateBlockersInCell` の記録など)。1〜3 行を壊しても盤面は壊す前と同じで、点検 `checkAttendanceRecordsHold` が「変」を出す形は作れなかった(ユニットでだけ確かめた・どこで止まっているかは未調査)。記録の種類の判定は `isTemplateBlockingRecordStatus` をそのまま使う(「移)」も入る)。
- (台本 e) 振替の休みは台帳に振替元を積まない(消化が外れて元の振替元が戻る＝+1)。偽のアプリで両方積むと +2 になる(テストの作り方の注意)。

- (台本 f・2026-11-11) 講師の入口は盤面の講師欄(`teacher-cell-{cellId}-{deskIndex}`)。長押しドラッグは同じコマの中だけで、放した位置の机は `closest('.sa-teacher[data-cell-id]')`。
  どちらかの机に生徒がいると「講師だけ入れ替え／生徒ごと席を入れ替え」の選ぶ画面(`teacher-seat-move-modal`)が出る(ステータスの文は画面を押すまで変わらない)。講師メニューの休みは `teacher-rest-button`(文字は「休み」／「休みを解除する(講師名)」)。
- (台本 f) ローカルモードは、盤面が前に保存した形へ戻る操作(休みの解除・元に戻す)のあと自動保存を飛ばし(署名が clean と同じ)、編集のたびの控え(`writePendingWorkspaceSnapshotForRemoteSync`・間引き 5 秒)に途中の形が残る。
  読み込み直しは IndexedDB の新しい方を読むので、休みが戻ったように見えた(本番は起動時にサーバーを読むので起きない)。台本 f はその操作の前に保存ボタンを押す。台本 b の元に戻すも同じ形を作りうる(今は後ろの台本が上書きして表に出ていない)。
- (台本 f) 休みを解除すると、同じ画面のうちに再マージでテンプレの講師が戻る(§2-4「次の反映で戻る」)。点検はテンプレ由来の講師が戻るのを認める。
- (台本 f) 休みの講師はそのコマのどの机にも居ないので、ドラッグで休みの講師を同じコマへ置く形は画面で作れない(要件の「できればドラッグ」は不可・注に出す)。
- (台本 f) 全体の点検 `checkTeacherCellIntegrity`(どの台本のあとでも): 休みの記録があるコマにその講師が居る(`isTeacherRestedInCell`)・同じ講師が 1 コマに 2 机(`isTeacherElsewhereInCell`)。
  事実は `boardFacts.ts` の `teacherAnomalies`(署名の外)。操作の前後で新しくできた形だけ止め、前からある形は起動で知らせるだけ(丸ごと振替の付け替えでは仕様の範囲でできうる)。

- (台本 g・2026-11-11・**既定では流さない**=`--scenario` で g を挙げたときだけ。所要時間は約 10 分のまま=2026-11-11 オーナー決定) 入口は日付の見出し(`day-header-{dateKey}`)。開いている日はメニュー
  (`div.day-header-menu`・testid は無い→`CLASS_SELECTORS`)の `day-header-menu-holiday`/`-transfer`/`-transfer-release`。休日の日・定休日を開けた日の見出しはメニューを出さずに切り替える(定休日を開けた日は選ばない)。
  丸ごと振替の振替先は見出しを押すだけ(帯 `whole-day-transfer-banner`・断りは中央の `whole-day-transfer-blocked-modal`)。振替先は同じ曜日＝別の週なので、選ぶ状態のまま週を移る(`jumpToWeekByDate` は `setWeeks` だけで選ぶ状態を消さない)。
- (台本 g) 選び方は `tools/ui-patrol/dayOps.ts`。本番 2 校は平日のほとんどに抑止キー(その日の授業を動かした・消した)と手入力があり、外すと土曜しか残らない→抑止キーのある日は選ぶ・振替先は「振替元の授業と同じ席・机に手入力が無い」だけ見る。
  日大前校の形は `templateFreezeBeforeDate`＝2027-02-01 で 4 週とも反映日より前→丸ごと振替はアプリが断る(飛ばして注に理由)。
- (台本 g) 休日設定の在庫: テンプレの通常授業は休日の自動発生と台帳の振替元が重なる(時限なしは同じ日で畳まれる)ので、台帳へ積むのを外しても残が動かない生徒が多い(緑が丘の 37 鍵のうち 1 鍵だけ動いた)。
  振替元の無い振替は数え方の上で在庫中立なので、丸ごと振替の振替元の日付を変えても残は動かない。講習・手動追加・編集で振替・同じ日に同じ生徒×科目 2 つの鍵は比べない(`expectedHolidayStockDeltas`)。
- (台本 g) 休日の解除で戻らないのが仕様のもの(知らせるだけ): 休日にした日のメモと、生徒も記録も無い机の手入力の講師(休日にした時点では残り、休日のまま読み込み直す〔再マージ〕と消える。再マージで休日のコマは授業・講師・メモを持ち込まず講師は記録のある机だけ引き継ぐ・inv06 マトリクスで固定。台本 f が手で置いた講師が g の日に当たって分かった)・その日の抑止キーの出入り(`resolveHolidayReleaseSuppressedOccurrences` が席へ戻した授業の鍵を外し、戻せなかった授業の鍵を積む)。
- (台本 g) 本番の形で見つけた不具合(2026-11-11・**Issue #86・v1.5.728 で修正**): 休日にした日に台帳の振替元(時限なし)を使った振替があると、休日設定が同じ振替元をもう 1 つ積み(席の授業の返却は台帳を見なかった)、
  読み込みで 1 つに畳まれ(`normalizeMakeupOriginMapKeys`)、解除が控えどおり 1 つ外して台帳から消えた(緑が丘 s092 算・10/19)。直し方=休日設定だけ在庫由来の振替の配置を積まず控え none(`skipLedgerBackedMakeupPlacements`)。修正後は `--scenario g` で 2 校とも変 0。
- (台本 g) 止めた所見の差分ファイル(`.diff.json`)に、前後で違う部分の中身(`summarizeSectionDiff`・配列は増えた/減った・オブジェクトは鍵ごと・40 件まで・大きい値は長さだけ)も残す。部分の名前だけでは見立てられなかった。

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

**次のセッションへの引き継ぎ(2026-11-11 オーナー回答)**: 第 2 段の残りは推奨順(台本 → 事故の日の形 → でたらめ操作。毎晩の自動実行はやらない=2026-11-11 オーナー決定)。手順は `docs/plan-2026-11-11-ui-patrol-stage2-handoff.md`。休みの講師を同じコマへ手で置いたら休みをコマ全体で解除する(案 1)は v1.5.723 で済み(spec-template-conflict-v2 §9-25)。

**台本 e が効くこと(2026-11-11)**: 緑が丘の形・`--scenario e`・壊す前の報告と `--baseline` で比べた(どれも戻した)。通常の休みで振替元を積まない(`computeStudentAbsentMark`)=
`[変・新]` 在庫の増減 0(仕様 +1)＋一覧から選べない・終了コード 1。振無休の記録を付けない＋出席で隣の席も外す=`[変・新]` 記録が付かない＋同じ机のほかの部分が変わった・終了コード 1。
今のコードの本番 2 校(11/11 19:45)は止める所見 0・全体 7 分 19 秒(e は 2 校で約 1 分 10 秒)。

**台本 f が効くこと(2026-11-11)**: 緑が丘の形・`--scenario f`・壊す前の報告と `--baseline` で比べた(どれも戻した)。§9-25 の解除を机単位に戻す(`releaseTeacherRestInCellIfSameTeacherPlaced` が置いた机だけ見る)=
`[変・新]` 休みの記録があるコマにその講師が居る＋休みの記録が残った・終了コード 1。講師だけ入替で生徒も動く(`computeTeacherMove`)=`[変・新]` 講師の操作が仕様どおりに効いていない 2 件。元の机へ相手の講師を入れない=`[変・新]` 同じ講師が 1 コマに 2 机 6 件ほか。

**台本 g が効くこと(2026-11-11)**: 緑が丘校の形・`--scenario g`・壊す前の報告と `--baseline` で比べた(どれも戻した)。休日設定で台帳へ振替元を積まない(`reconcileHolidayDeskStockReturns` の `appendMakeupOrigin`)=
`[変・新] 休日設定で在庫の増減が仕様と違う` 1 鍵・終了コード 1。丸ごと振替の解除で組の鍵を外さない(`computeWholeDayTransferPairRelease`)=`[変・新] 解除しても操作の前の盤面に戻らない` 22 件・終了コード 1。
丸ごと振替の振替の振替元の日付を変える=所見 0(在庫中立・ユニットだけ)。2 校で約 2 分半(日大前は休日設定だけ)。

- (台本 h・2026-11-11・**既定では流さない**=`--scenario h`) 入口は「未消化講習」(`lecture-stock-chip`)→ 生徒の行(`lecture-stock-entry-{生徒キー__講習 ID の記号を - に}`)→ 画面の
  「未消化振替も同時に自動割り当てする」(`stock-action-modal-include-makeup` の中の checkbox)→「自動割振」(`stock-action-modal-auto`)→ 結果の画面(`auto-assign-debug-panel`・割り振れなくても必ず出る)を閉じる。
  全員まとめての入口は無い。講習の自動割振は**生徒の席だけ**置き講師は置かない(講習の講師の自動配置は講師日程表の登録・QR 提出＝通らない)。候補選びは `tools/ui-patrol/autoAssign.ts`(期間の終わりが今日以降の行だけ)。
  点検は `checks.ts` の `checkAutoAssignApplied`(期間の机で「空き → その生徒」以外の変化は変)と `checkAutoAssignPlacementRules`(出席不可・指定時限禁止・科目対応講師のみ。学年は置いた生徒の grade を読む)と在庫(`expectedAutoAssignStockDeltas`)。
- (台本 h) 2026-11-11 の本番 2 校は冬期講習の提出の前で、未消化講習は夏期講習の残りだけ→ 候補なしで飛ばす(h だけなら終了コード 2・既定＋h は飛ばすだけ。手直し 1 で g も同じ「候補なしは飛ばす」に統一・report の noScenarioRan)。確かめは候補選びの 1 行を一時的に外して夏期講習の残りで流した(変 0)。
  在庫を減らさない=`[変・新]` 19 件・机の授業を作り直す=`[変・新]` 置いた席のほかが変わった 1 件。`isStudentSlotBlocked` を緩めても点数で空き席が先に選ばれ所見 0。
- (台本 h) 本番 2 校のデータに 2026-08-10 の週が無い(間の週)。週の選択で押しても前の週のまま(`ensureWeeksCoverDateRange` は端にしか足さない)。`gotoWeekOf` はコマの無い日(休日)でも見出しで「出た」とみなすようにし、間の週は h が注に出して続ける。
- (台本 h) 2 回目を押す点検は、1 回目で置き切ると一覧から行が消えて押せない(実走では 4 回とも置き切った)。

**第 2 段の残り(台帳 `ui-patrol-stage2`)**: 過去の事故の日の形の一覧／でたらめ操作を既定に(毎晩の自動実行はやらない)。台本は d・e・f・g・h で済み(g と h は既定では流さない)。
カード 1(テンプレ保存前の自己点検)が同じ数え方を使うときは `tools/ui-patrol/boardFacts.ts` を `src/` へ移して共有する。
