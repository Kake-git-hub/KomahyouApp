---
name: komahyou-manual-test-2026-08-analysis
description: 第三者手動テスト(307項目)の×30件分析台帳。★重大3件=v1.5.481/小粒9件=v1.5.482/No.146改名=v1.5.483/オーナー判断8論点の確定反映=v1.5.484 で**全件クローズ**。残はit.todo(配置系純関数化)と表示名解決2系統の一本化のみ
metadata: 
  node_type: memory
  type: project
  originSessionId: d1837f97-cbd7-4424-a2c6-c336d029d487
  modified: 2026-08-29T05:33:53.787Z
---

# 手動テスト2026-08 分析結果(2026-08-29)

## ✅仕様確認8論点はオーナー確定 → v1.5.484 で正本へ反映(2026-08-29・挙動変更なし)
1. **保存ボタン=青**(「常に緑」を撤回・仕様書を実装に合わせる)。状態はラベル(保存/最新データ/保存中…)＋`data-state`で表す。`.primary-button.is-clean`(緑)は死蔵クラス→spec-save-restore §1
2. **黄色コマは配置削除でも保持**(一方通行のまま)→spec-special-session-submission §C-1b
3. **黄色化後は赤字警告が出ないのが正**→チェックリストNo.74/No.207の期待値を書き換え済み(xlsx更新)
4. **5週目は特別定義しない・「月◯回」の概念も持たない**。授業回数＝週の数で、調整は室長の手動運用→spec-board-regular-placement(旧「月4回ルール」撤廃の延長)
5. **1教室1タブは BroadcastChannel=同一ブラウザ内のみ**を明文化のみ(UI警告は足さない)。多端末の唯一の実効ガードは楽観ロック→spec-save-restore
6. **休日設定で戻る/戻らない**をstatus別の確定一覧に(attended/振無休=戻す、absent/moved=戻さない、体験・増コマ・手動追加=戻さない、「戻す」と希望−1は排他)→spec-makeup-stock §B-2-2b(新設)
7. **黄色コマの自動割振は現状が正**(通常の可能コマと同等・候補は講師の居る机のみ・本人在席セルはスキップ・候補ゼロは未消化に残す)→spec-auto-assign-rules
8. **講師の登録解除は `schedule-registration` × 同セッション × 同講師の AND のみ外す**(手動配置/テンプレ足場は不可侵=INV-02)→spec-special-session-submission §E-2a(新設)

チェックリストv1.5.455(307項目)を第三者がstagingで実施→×30件+気づき45件を、コード(v1.5.480 main)照合で3分類した。
レポートArtifact: https://claude.ai/code/artifact/4ccd0ba6-7727-4d51-a577-cf51795ef2ea

## ✅No.146の線引き確定+日程表の改名追従 = v1.5.483(2026-08-29)
**オーナー確定の線引き(docs/spec-basic-data.md §B-1 に明文化・INV化は見送り)**:
- **氏名=名簿の現在値に追従**(改姓・入力ミス修正が全画面に効く)。盤面=`resolveStudentEntryDisplayNameFromRoster`/日程表=`serializeCells`の`resolveSerializedEntryName`
- **科目・授業種別・授業時間=配置時の値のまま**(その授業の記録。名簿の希望科目に追従させると過去が書き換わる)
- **学年=生年月日から都度算出**で元から追従
- 体験生・名簿外・managedStudentId無しの旧データはフォールバックで配置時の名前
- ★在庫キー/照合キーは従来どおりID優先(v1.5.451)。表示追従とは別物なので混ぜない
- INV化はオーナー判断で見送り(実害限定・マトリクス維持コスト。同種再発時に昇格検討)

## ✅小粒9件+INV-12+Issue #59 は v1.5.482 で修正済み(2026-08-29・INV監査済み)
- **INV-12「配置の一意性」新設**(オーナー承認)・#56テストをinv12マトリクスへ昇格。配置系4経路とテンプレ移動の純関数化はit.todoで可視化(フォローアップ)
- **Issue #59**: 丸ごと振替の振替先処分にも振替抑制を対称化(振替元には積まない)。クローズ済み
- 小粒9件: タブ名教室名配線/日程表noteSuffix/学年ソート学齢順/講習バッジ=コマ数合計/D&D無効ドロップ理由表示/講習削除undoの希望数差分復元(`SpecialSessionSubjectDelta`+`resolveDeleteSubjectDelta`=current>0のみ記録・INV-05)/講習重複時は`resolveDisplayedOverlappingSession`で1つ選択+`qrSessionId`ガード(INV-07)/opener不在alert可視化+catch可視化+`/s/**`no-store(INV-07)/改名は`resolveStudentEntryDisplayNameFromRoster`でID優先(盤面のみ・日程表セルは据え置き)
- 残オーナー判断: **No.146の「盤面表示と名簿の一致」INV追加要否**・保存ボタン緑/青などの8論点(レポート参照)
- staging実機確認推奨(監査指摘B): 講習期間が2つ重なる表示でQRがどの講習を指すか・開発用教室でQRの宛先教室
- 表示名解決が2系統(名前逆引き/ID優先)・バッジ合計2実装の一本化は中期課題(6793374型ドリフト源)

## ✅重大3件は v1.5.481 で修正済み(2026-08-29・mainマージ・INV監査済み)
- Issue #56(スワップ二重配置): computeStudentMoveの2穴封鎖(入替相手の着地先検査追加+免除→除外方式)。テンプレ移動の同型穴も配線(純関数化はit.todoでフォローアップ)。**該当INVなし→新INV(配置の一意性)の台帳追加はオーナー承認待ち**
- Issue #57(移動がabsent記録破棄・INV-06): クリアをmovedマーカー限定に+破棄前確定を`materializeDisplacedStatusEntryIntoLedgers`へ一本化(休日設定/全コマ削除/移動/出欠付与が共有)。台帳INV-06「move-displaces-absent-record」転記済み
- Issue #58(空にする→休日で積み直し・INV-06): `collectClearedDayMakeupSuppressions`新設(時限つき=テンプレ元時限・absent/movedはスキップ)。INV監査で「movedに積むと移動先休みの算出originが消える誤減」を検出し即修正。台帳「clear-day-then-holiday-restack」転記済み。spec-makeup-stock.mdの2026-07-06確定「空にするは単純クリア」を通常授業に限り改定
- フォローアップ: **Issue #59**(丸ごと振替の振替先処分に抑制を積むか裁定+抑制トークン生成3様分散の権威関数化+単発削除の時限なし抑制と仕様書の食い違い)

## 修正すべきバグ(未修正・Issue化候補)

**重大3件(在庫・出欠整合に波及、INV完了定義4点で対処)**
1. **日程表D&Dスワップで同一生徒が同コマ二重配置**(No.276): `computeStudentMove`のスワップ経路(ScheduleBoardScreen.tsx:3998-4015)にスワップ相手の着地側重複ガードが皆無+着地側ガードは最初の1件のみ(:3968の`findDuplicateStudentInCellByKey`)。盤面内D&Dも同根。重複テスト0件。
2. **生徒移動が移動先のabsent記録を無条件破棄**(No.113): ScheduleBoardScreen.tsx:3995 `setDeskStudentStatus(targetDesk, studentIndex, null)`。ee5728c(moved対策)がabsentまで巻き込み。「休」が日程表から消える+移動由来振替の休みだと未消化振替が無言消滅(INV-06のmaterialize規律がこの経路だけ未適用)。
3. **「生徒を空にする」→休日設定で振替積み直し**(No.121): handleClearStudentsOnDateがsuppressedMakeupOriginsを積まない(単発削除:10601は積む=非対称)。休日振替はテンプレベースの`computeAutomaticShortageOrigins`が発火するため盤面が空でも積まれる。5週目運用阻害の正体。単発削除と同じ抑制を積めば解決。

**小粒(1〜数行修正)**
- タブ名に教室名が入らない(No.22/243): openStudentScheduleHtml/openTeacherScheduleHtml(:10052/:10109)が`classroomName`未配線。2026-07-09オーナー指示未達。
- 日程表セルの講習分数60/45が出ない(No.250): scheduleHtml.ts:368-386のシリアライズで`noteSuffix`項目漏れ(SerializedStudentEntryに無い。statusEntry側は有り)。
- 学年ソートが文字コード順「中→小→高」(No.148): BasicDataScreen.tsx:1262がラベル文字列比較。`resolveStudentGradeSortOrder`(既存)を使えば直る。表示名ソートも同根。
- 未消化講習バッジが行数(人数)単位(No.119): :11013 `lectureStockEntries.length`。振替バッジ(:5848 balance合計=コマ数)と不一致。`reduce((t,e)=>t+e.requestedCount,0)`で揃う。No.118「戻らない」誤認の主因。
- 無効ドロップ理由が出ない(No.279): scheduleHtml.ts:3620-3641のonScheduleDndPointerUpにelseが無い(別タブ側で弾くと無言)。
- undoで講習希望数が戻らない(No.131): subjectSlots(提出データ)がundo履歴(createHistoryEntry :8041)対象外なのに削除は2帳簿を動かす→undoの度に1コマ欠損。
- 登録解除→再提出不可に見える(No.210): ロジックは正しい。scheduleHtml.ts:4517でopener不在だと黙ってreturn+reset失敗が.catch(()=>{})握り潰し(App.tsx:3731/3736/3857/3860)。`/s/**`にno-storeなし(firebase.json)も併発候補。
- 講習期間2つが表示範囲に重なると全員のQR/提出済みバッジ消失(No.201): scheduleHtml.ts:276-282 findOverlappingSessionがlength>1でsession:undefined。+解除がセッション無視でバッジを落とす(:5427/:5447)。データ自体は講習×人で独立・無事。
- 改名が盤面表示に反映されない(No.146): 表示解決が名前逆引きのみ(managedStudentNameMap :5649)。在庫キーはv1.5.451でID化済み。表示のID解決化は中期の設計変更。

## オーナー判断が必要な8論点(→ 2026-08-29 に全件確定。上の「✅仕様確認8論点」参照・以下は論点の原文)
- 保存ボタン: 仕様書spec-save-restore§1「常時緑」vs実装「青」(is-clean CSSは定義だけで付与元なし・進捗表は✅済と虚偽)。緑実装 or 仕様書を青へ。
- 黄色コマの一方通行: 配置削除後もreopenedSlots保持が仕様だが「配置をやめたら不可へ戻したい」直感との整合。
- 赤字条件(No.71/72): 黄色コマ後は「不可コマ配置で赤字」が発生しない(承認→黄色化)。チェックリスト期待値の書き換え。
- 5週目の公式扱い/1教室1タブはBroadcastChannel=同一ブラウザ内のみ/休日化で戻る・戻らないの明文化/黄色コマ割振の確認手順(講師の居る机のみ候補・本人在席セルはスキップ)/講師登録解除はschedule-registration由来のみ外す(INV-02)。

## 現仕様どおり(テスターへ回答)
校舎名・ロゴ=室長入力欄の未設定/高3卒業補完=卒業後・非在籍タブ(v1.5.434済)/理社1行=小学生限定(中3は集理・集社が正)/手動追加講習の削除で希望数減=v1.5.468の新会計/中3が無い=グループ内相互排他(登校日集約・3コマ上限・通常連結2コマに割当済み)/ルールExcel=バックアップ/初期設定画面に存在/再提出=登録解除後のみ可が正。

## 検証環境の教訓
- 確認情報シート(実施日・版)が空欄→次回必須化。staging functionsの版が黄色コマQR表示の再現性を左右(deploy-stagingはfunctions除外可)。サンドボックス教室はQRトークン再発行ガードで本番と挙動が変わる場面あり。
- 再現情報待ち: No.168(不正Excel取込)・No.193(講師QRロック)・No.246(別タブ同期の取りこぼし)。

関連: [[komahyou-invariant-registry-plan]] [[komahyou-schedule-count-desired-semantics]] [[komahyou-reopened-slots-feature]]
