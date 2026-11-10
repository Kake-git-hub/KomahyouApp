---
name: 画面の自動巡回(tools/ui-patrol.mjs)
description: 本番の形のデータ(伏せ字)を手元のアプリに入れ、室長と同じ画面操作を自動で行って点検する道具。盤面や画面を変えた修正を main へ入れる前に回す。作りと罠、初回に見つけた所見
type: project
---

# 画面の自動巡回(2026-11-11 第 1 段・v1.5.718)

**きっかけ**: 2026-11-10 の緑が丘「テンプレ保存で手入力の生徒の位置がずれる」(v1.5.715〜717)。本番にしか無い状態(先の反映日 2027-02-01 のテンプレが保存済み)で
思い込みが崩れ、作り物のデータのユニットは通っていた。オーナー「ユーザーが操作したときに変じゃないか、が一番大事」。

**決定(オーナー回答 2026-11-11)**: データは毎回の最新だけ(過去は `--key`)／台本は標準(移動 6 か所)／マージ前に回して「変」が出たら止める／毎朝の健診には入れない。

**回し方**: `node tools/ui-patrol.mjs --out <スクラッチ領域>/…`(約 3 分半・終了コード 0/1/2・手順 docs/runbooks/ui-patrol.md・設計 docs/test-strategy.md 層 5)。
盤面のロジック・画面・テンプレ・保存/読み込みを変えたら回す(safe-release のチェックリスト)。

**作り**
- データ: 15 分バックアップを読み取りだけで GET(`fetchData.mjs` の `sendReadOnly`・`assertReadOnlyRequest`)。元データはファイルに書かない。
- 伏せ字(`tools/ui-patrol/anonymize.ts`): ID から仮名(生徒092・講師005)。対応表は講師の項目用と生徒の項目用の 2 枚。名前から作った鍵(`name:…__科目`)も組み直す。
  自己点検 3 つ(名前の漏れ・名前引きと鍵の前後一致・保証台帳の結果の一致)を通らないと止まる。
- 入れ方: **アプリを開く前に**、同じオリジンの空ページから `saveWorkspaceSnapshot`(アプリ自身の関数)で IndexedDB へ。室長でログイン済みの種データ(`seed.mjs`)。
- 読み口: `window.__komahyouUiPatrol.readClassroom()`(`src/utils/uiPatrolHook.ts`・開発用ビルド かつ ローカルモードだけ)。本番ビルドの番人 `tools/check-dist-dev-hooks.mjs`。
- 点検(`boardFacts.ts`・`checks.ts`): 盤面の「意味」(本物の講師・生徒・出自・出欠記録・メモ・保留の下段)で比べる。出自・講師なしはアプリの権威関数。
- 台本(`scenarios.mjs`): 起動 → c 保存→読み込み直し → b 生徒の移動(長押しドラッグ・元に戻す・やり直し) → a テンプレを何も変えずに保存(反映日=来週の月曜)。`--random n` はでたらめ操作(試験的)。

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

**効くことの確かめ**: 緑が丘 11/10 朝の形(`--key 2026-11-10T03-00`)・台本 a・反映日 11/16。修正前(v1.5.714)= 止める所見 29(うち「手入力の生徒の講師が変わった」8)。今のコード= その所見 0。
戻し方は `git checkout 7014a07a -- src/components/schedule-board/{ScheduleBoardScreen.tsx,templateDeskOrderRestore.ts,templateDiffApply.ts,templateTransferFollow.ts,checklistPrep.ts}` → 流す → `git checkout HEAD -- …`。

**初回に見つけた所見(2026-11-11・アプリ未修正・オーナー判断待ち・台帳 `template-save-teacher-detached`)**
- A(不具合の疑い): 先の反映日のテンプレが保存済みの教室で反映日を手前へ動かして保存すると、別の講師の授業に手で入れた講師 X が、新しいテンプレでも同じ机なのに 1 人で空き机へ移り、
  テンプレの生徒が講師なしで残る。確認の画面に出ない。日大前校の形で 29 机。`templateDeskOrderRestore.ts` の `resolveDeskTeacherClue`(授業の手がかりで元の講師 W を返す)→ W が新テンプレに居ない → 空き机へ、の経路。
- B(仕様の穴): 室長が講師を消した机(削除記録)へテンプレの生徒が講師なしで置かれる。日大前校 10 机・緑が丘 11/10 朝の形で 9 件。
- 直るまで日大前校の台本 a は終了コード 1(60 件)。known には載せていない(隠さない)。変更前と件数・場所を比べて増えていなければ進む。
- 2026-11-11 01:45 時点の緑が丘の本番データには、今日以降に「生徒がいるのに講師なしの机」が 13 あった(うち削除記録の机 4)。

**第 2 段の案(台帳 `ui-patrol-stage2`)**: 台本を足す(出欠・講師の移動・丸ごと振替・休日設定・講習の自動割振・テンプレを実際に変えて保存)／でたらめ操作を既定に／毎晩の自動実行／変更前との自動比較／過去の事故の日の形の一覧。
カード 1(テンプレ保存前の自己点検)が同じ数え方を使うときは `tools/ui-patrol/boardFacts.ts` を `src/` へ移して共有する。
