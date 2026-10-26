---
name: komahyou-classroom-restore-cross-contamination
description: コマ表アプリで復元/コピーは「開いている教室」に書き込まれ教室取り違えで他教室データに汚染される
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f781850-bd04-4199-934e-37cb49599219
---

コマ表アプリの教室データ汚染インシデントと再発防止(2026-06-06 発生・調査)。

- **症状**: スクールIE日大前校のマネージャーがログインすると緑が丘校のデータが表示された。
- **原因(確定)**: コード(読込/保存/権限ルール)・members の `assignedClassroomId`・教室の紐付けはすべて正常。実体は **日大前校のスナップショット文書 `classroomSnapshots/5w5OMueETerSKrSf14HC` の中身が緑が丘校データに上書きされていた**(生徒の68/73が緑が丘と一致)。汚染書込みは 2026-06-06T01:38(UTC) に**開発者アカウント**が inline で実行。直前の毎時バックアップ T10(01:10 UTC=JST10:10)は生徒128名・授業924・緑が丘との一致0で無傷=本物の日大前データ。
- **汚染の真因**: **Claudeの別セッションによる自動チェック操作**。ユーザー操作ではない。Claude が `actingClassroomId` を適切に管理しない状態でアプリの動作確認等の操作を行い、復元/コピー相当の書き込みが日大前校文書に実行された。
- **根本の罠**: アプリ内の `restoreClassroomFromServerAutoBackup` / `restoreLatestClassroomRollback` / 教室コピーは **`actingClassroomId`(今開いている教室)へ書き込む**(App.tsx 約4219/4254/4289)。別教室や緑が丘バックアップを開いた状態で復元/コピーを実行すると、その教室データが現在開いている教室の文書を上書きする。これが今回の汚染源。
- **再発防止**: 復元・コピー前に必ず画面の教室名で「対象が正しいか」を確認する。理想的には復元 UI に対象教室名の明示と確認(教室名の二重確認)を入れる。
- **復元手段**: 開発者ログイン→対象教室を開く→「バックアップ/復元」→「サーバーバックアップから復元」→該当毎時(例 2026-06-06 10:10)→「この教室を復元する」→**保存**で Firebase へ永続化(復元はstateに載るだけで保存は別操作)。Cloud Function `downloadClassroomFromServerAutoBackup` は復元前に自動でインシデントバックアップ(`writeWorkspaceIncidentBackup`)を取る。毎時バックアップは直近3日、日次14日保持。バケット `komahyouapp-prod.firebasestorage.app`、パス `workspace-auto-backups/main/hourly/{key}.json`。workspaceKey=`main`。
- **データ確認手段**: `gcloud auth print-access-token`(オーナーの Google アカウント は開発者)で Firestore/Storage REST を叩いて教室スナップショットや members を直接照合できる。教室ID: 日大前=5w5OMueETerSKrSf14HC, 緑が丘=KzFnOQoTFLsCxwUp1tvh, 薬円台=6xnnbSTbwgGrBLy0EJKb, 開発用=v8OZ7zH8vONNHjjYVcR1。

- **第二の真因(2026-06-11 確定・修正済 v1.5.297)**: 他教室→開発用教室コピー `buildDevelopmentClassroomCopyPayload`(App.tsx)が**浅いコピー**で、コピー先(開発用)とコピー元(他教室)が `students/teachers/regularLessons/regularLessonTemplate` 等のネスト参照を共有していた(`sanitizeClassroomPayload`/`sanitizeClassroomSettings` は spread のみで配列をクローンしない)。コピー後に開発用教室を編集するとコピー元(他教室)のメモリ上データまで書き換わり、保存経路の **「targetClassroomIds 未指定なら全教室を書く」フォールバック**(App.tsx 約1659-1661 `queueFirebaseWorkspaceSync`)で他教室 Firestore に開発用データが混入した。**修正**: コピー元を `cloneInitialValue`(structuredClone)でディープクローンしてから加工し参照を完全に断つ。回帰テスト追加(App.test.ts「コピー先と元が一切の参照を共有しない」)。
- **教訓**: 教室間でデータを複製する箇所は必ずディープクローン。`{ ...a }` spread は配列/ネストobj参照を残し、別教室の同一参照を経由して全教室書込みで混入する。[[komahyou-no-regression-rule]] の spread 単純化リスクと同根。
- **混入の調査手法(2026-06-11 確立・読み取り専用)**: 毎時/日次バックアップ(Storage `workspace-auto-backups/main/`)を gcloud token で GET し、各教室の「生徒IDソート列の sha1(stuHash)」「regularLessonTemplate.cells のhash/cell数/effectiveStartDate」を時系列で並べる。**本物の教室は stuHash が長期安定**。混入は2教室間で stuHash が入れ替わる/別教室の値が出現する形で見える。corruption の発生時刻は「最後に正しいバックアップ」と「最初に壊れたバックアップ」の savedAt 間に挟める。実例(2026-06-11): 日大前(5w5OMue)の本物データ=stuHash `0c691a4075`(生徒129・テンプレ35セル・eff 2026-09-07)が毎時 `2026-06-11T07`(savedAt 06-10T22:10Z)まで正しく、`T08`(06-10T23:10Z)で開発用とSWAP、`T09`(06-11T00:10Z)で古い空の開発用データ `d19bb93b16`(生徒73・テンプレ無)に上書きされた。復旧は毎時 `2026-06-11 07:10` から**日大前のみ選択**して復元。
- **第三の真因(2026-06-11 確定・修正済 v1.5.300)**: アカウント切替時の **in-memory undoSnapshot 残存**。SPA はマネージャーのログアウト→別マネージャーのログインでページ再読込しないため、`logout`/`applyWorkspaceSnapshot` が `undoSnapshot` を破棄しないと、前セッション(例:開発用室長でテンプレ上書き)の「直前に戻す」バナーが次のアカウント(例:日大前室長)の最初の画面に残る。押すと `restoreUndoSnapshot`→`applyClassroomPayloadToState` で前教室データを現在の教室へ書き込み汚染する。**修正**: logout と applyWorkspaceSnapshot で `setUndoSnapshot(null)`。localStorage の教室データは同一ユーザーガード(`marker.authenticatedUserId===authenticatedUserId` / `targetClassroomIds` に assignedClassroomId 必須)で別アカウントへは漏れない。漏れていたのは in-memory undo。なお localStorage キーは全アカウント共通(`komahyouapp:workspace-snapshot`)なので、ガードが将来緩むと再発リスクあり。
- **コピー廃止→バックアップ読込に置換(Feature B・v1.5.301)**: in-memory の他教室参照を使う「他教室コピー」を**廃止**。代わりに Storage の確定バックアップから「教室×時点」を選び**開発用教室(acting)のみ**へ読み込む方式に。読込はサーバー callable(`listDevelopmentClassroomBackupSources` 新設で候補一覧、`downloadClassroomFromServerAutoBackup` で1教室取得)→ `buildDevelopmentClassroomCopyPayload` でディープクローン+トークン除去→ dev のみ書込み。**開発用教室の室長アカウントでも機能**(権限を「開発者 or 開発用教室の室長(name=開発用教室で判定)」に緩和)。1教室でも数MB→ callable 応答上限対策で gzip+base64。UI は教室画面のバックアップ/復元タブ(BackupRestoreScreen の開発用パネル)。他教室には一切書き込まないため構造的に混入しない。
- **増幅器(修正済 v1.5.299)**: `queueFirebaseWorkspaceSync` の `targetClassroomIds` 未指定フォールバックが **全教室を Firestore に書いていた**(旧 App.tsx `: nextItem.snapshot.classrooms`)。古い・混入した教室データが全教室へ永続化され他教室を壊しえた。`resolveWorkspaceSyncTargetClassrooms` 新設で「未指定なら操作中教室のみ(acting不明なら無し)」へ限定。複数教室を書く正当な操作(開発者復元)は復元した教室IDを明示指定。

- **2026-06-13 汚染インシデント(照合確定・読み取り専用)**: 毎時バックアップ照合の結果、**汚染されたのは日大前のみ**。日大前が savedAt `2026-06-13T06:10Z`(=15:10 JST)のバックアップで **`d19bb93b16`(生徒73・古い開発用データ)** に上書きされ、次の T16(16:10)で本物 `0c691a4075`(129)に復旧。**緑が丘 `15b57f5da7`(79)・薬円台 `13ea92f771`(87)は全時間帯で不変＝無傷**。汚染発生窓は 14:10–15:10 JST。
  - **原因評価(訂正)**: 上書きデータは「古い開発用(73)」で、当時の現行開発用(`15b57f5da7`・79)とも違う。Claude が同日入れた `handleBoardStateChange` 改変(userInitiated:false でも集団差分時に `writePendingWorkspaceSnapshotForRemoteSync` を呼ぶ)は**現在のメモリ状態(=79)を書く**挙動なので、**73の古いデータ書込みとは一致せず、今回の直接原因ではない可能性が高い**。データ像は第三の真因系(**undoSnapshot残存/古いin-memory・localStorage状態が現教室へ書込み**)に合致。引き金候補=14:10–15:00頃の「元に戻す」操作 or 古い開発用バックアップ読込。
  - ただし Claude の改変は「受動イベントで書き込む」新経路を増やすリスク要因のため **差し戻し済(commit d87cd83、userInitiated:false では書込/同期しない元動作へ)**。差し戻しは維持。
- **鉄則(厳守)**: 盤面の `onBoardStateChange(userInitiated:false)`(=ロード/教室切替/受動再計算)では**絶対に書き込み・リモート同期・スナップショット保存を起こさない**。書込みは必ず `userInitiated:true`(commitWeeks 等の実ユーザー編集、acting教室と全refsが整合した状態)に限る。集団授業の dirty 検知/共有再公開を入れるなら、教室切替中に発火しない経路(userInitiated:true emit か、actingClassroomId と全 refs の整合を確認してから)で再実装する。

- **第四の真因(2026-06-21 確定・修正済 v1.5.313)**: `applyWorkspaceSnapshot`(ログイン/reloadRemoteWorkspace/復元後の再読込)が**開発者画面で着地するとき編集state(students等)を読み込まなかった**(旧コード `if (targetClassroom && nextScreen !== 'developer')`)。一方で `setActingClassroomId(target)` と `markStateLoadedClean(target.dataの署名)` は実行されるため、**前に開いていた別教室の名簿が編集stateに残ったまま acting だけ別教室に向き**、編集state(別教室)と clean署名(target)が不一致→偽dirty→自動保存(App.tsx 約3900 の effect)が `getCurrentClassroomSyncTargetIds=[acting]` 宛に**編集state(別教室の名簿)を acting の教室文書へ書込み**、上書き汚染した。照合実例: 日大前(5w5OMue)が backup `2026-06-21T14`(savedAt 05:10Z=14:10JST・生徒129・hash 9bb5a85a60)まで正常→`T15`(06:10Z=15:10JST)で生徒73(古い開発用)に、さらに`T21`(12:10Z=21:10JST)で生徒79(緑が丘/開発用 hash e15c20167d)に上書き。**緑が丘79/薬円台87/テスト教室120(=本物日大前名簿)は無傷**。`setActingClassroomId` の呼び出しは openClassroom と applyWorkspaceSnapshot の2箇所のみで、前者は必ず編集stateを読み込むため後者だけが穴だった。
  - **修正**: (1) applyWorkspaceSnapshot は画面に関わらず acting教室の編集stateを必ず読み込む(不変条件「編集state は acting教室のもの」を常時維持)。(2) 防御ガード `shouldInjectEditingStateIntoClassroom(classroomId, acting, loadedEditingClassroomId)` を新設し、編集state→教室への反映チョークポイント(`buildWorkspaceSnapshot` と `syncCurrentClassroomData`)で「編集stateの出所 `loadedEditingClassroomIdRef` が acting と一致するときだけ」書込み許可。出所は open/applyWorkspaceSnapshot/applySnapshot/undo/開発用バックアップ読込/Excel取込 の各所で記録。(3) 回帰テスト App.test.ts。これにより acting と編集stateが何らかで desync しても他教室文書へ別教室データが書かれない。
  - **教訓**: `setActingClassroomId` と「編集stateの読込」は**必ずセットで**行う(acting だけ変えて編集stateを残すと次の自動保存で混入)。新たに acting を変える経路を足すときは編集state読込と `loadedEditingClassroomIdRef` 更新を必ず伴わせる。

**Why:** 「教室別分岐が回帰の温床」という既知傾向([[komahyou-save-architecture]])の具体例。コードは正しくても運用(復元先の教室取り違え)・**浅いコピーの参照共有**・**受動イベントでの書込み**で容易にクロス汚染する。
**How to apply:** 「他教室データが見える」報告時は、まずコードを疑う前に該当教室の `classroomSnapshots/{id}` の中身を REST で照合し、汚染なら汚染前の毎時/日次バックアップから当該教室だけを復元する。
