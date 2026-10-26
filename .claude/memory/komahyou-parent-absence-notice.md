---
name: komahyou-parent-absence-notice
description: 保護者QRを「休み連絡」専用へ作り替え(2026-09-18 オーナー指示)。来月削除・自由記述/保護者名廃止・授業行タップで休み連絡・盤面は四択(休み/振無休/振替先を今決める/何もしない)で自動処理・処理済みは盤面保存成功時・保護者ページに「教室確認済」
metadata: 
  node_type: memory
  type: project
  originSessionId: eebc5aca-f2cc-4c0d-afe5-7b741983b771
  modified: 2026-09-18T15:53:32.409Z
---

# 保護者QRを「休み連絡」専用へ(2026-09-18〜19・開発用教室＋staging 限定のまま)

**状態: v1.5.550 で本番反映済み(2026-09-19)。** Hosting / Functions / CI Tests 緑、`parentPortalApi`・`markParentMessagesNotified` の
updateTime を gcloud で確認済み(409 誤成功ではない)。Firestore ルールの変更なし。**実機確認は未**(確認リスト q-1〜q-5・
スマホ＋PC の両方を使う)。保護者ページはモックで 375px 目視確認済み、盤面モーダルはログインが要るので未目視。

[[komahyou-parent-portal-qr]] の第1段(自由記述の連絡)をオーナー指示で作り替えた。仕様正本は `docs/spec-parent-portal.md` **§0-5**(§A・§C・§E の本文より優先)。

## オーナー確定(着手前に懸案4点を AskUserQuestion で確認)
1. **来月は出さない**(先月・今月だけ)。月またぎの休み連絡は電話運用(月末の穴はオーナー了承)。
2. **当日の連絡も受け付ける**。かつ**室長が四択を押したら保護者ページに「教室確認済」を出す**(オーナーが回答欄に自由記入で追加した要件。
   それまでは「休み連絡済」)。プッシュ/メールは無し。=「一方向」確定事項のうち**状態だけ**は返すように変わった。
3. **「振替先を今決める」= 休みにして未消化振替へ戻してから既存の振替配置モードへ**(途中でやめても休みは残る)。生徒の移動としては扱わない。
4. **処理済み(notifiedAt)は盤面を保存できた時点**(「何もしない」だけ即時)。保存前に閉じたら次回もう一度通知。
「振替休」というオーナーの言い回しは盤面の既存語彙(休み=未消化振替へ戻す / 振無休=振替なし)へ寄せた(どちらの読みでも自動処理の集合は同じ)。

## 形(なぜこの形か)
- 連絡 doc は `kind:'absence'` ＋ `absence{dateKey,slotNumber,subject,lessonKind,isTentative}` ＋ `acknowledgedAt`/`resolution`/`notifiedAt`。
  messageId は決定的 `abs-{トークン指紋}-{date}-{slot}` を `create()` = 同じコマの二重連絡を原子的に 409。
  鍵に**生徒IDでなくトークン指紋**を使う(sNNN は欠番再利用。トークンは削除で失効)。GET の状態取得は `absenceKey` 単一フィールド範囲条件(複合インデックス不要)。
- POST は `{dateKey, slotNumber}` だけで、科目・種別は**サーバーが日程計算から引く**。連絡可能かの判定は共有純関数
  `isParentLessonAbsenceReportable`(parentSchedule.ts・サーバー検証とページで同じ1関数)。
- callable は増やさず `markParentMessagesNotified` に `stage`('acknowledged'|'notified'・省略=notified で旧互換)と `resolution` を足した。
- 盤面側: App→盤面の一過性コマンド `parentAbsenceRequest`([[komahyou-transient-request-remount-refire]] と同じ2点で守る=
  結果を必ず返す＋App が消費)。盤面は週ジャンプ(2段階 effect)→ 純関数 `resolveParentAbsenceTarget`(managedStudentId 優先・
  無ければ名簿で一意な名前・通常/振替/増コマだけ)→ **メニューの「休み」「振無休」と同じ1本**(`markStudentAbsentAt` /
  `markStudentAbsentNoMakeupAt` へ切り出し)。INV-06 の会計経路を増やさないのが要点。
- 保存非対称の防止([[komahyou-submission-board-persistence-asymmetry]] と同型): 四択で反映した連絡は App の「保存待ち」に積み、
  保存の成功点(`saveClassroomSnapshotViaFunction` 直後・自動保存もここを通る)で「保存した教室・snapshot.savedAt 以前に処理した分」だけ
  `'notified'`。教室切替/ログアウト/フラグOFF と `boardMountKey`(= applyClassroomPayloadToState だけが進める=開き直し・復元・直前に戻す)で
  保存待ちを捨てる → 購読が**毎回全件**を渡す形にしたので、捨てた連絡は一覧へ自動で戻る(docChanges 差分のままだと戻せなかった)。
- モーダルは「あとで(盤面を見る)」で右下のピルへ畳める。全画面モーダルが盤面を隠すと四択を決められないため。

## regression-reviewer の指摘で同じ push で直したもの(次に同型を作るときの注意)
- **処理済みにするのは「保存した盤面に休み/振無休の記録が実在する」連絡だけ**(`hasParentAbsenceRecord`・保存成功点で保存ペイロードを見る)。
  pending だけだと、四択→盤面の「元に戻す」(boardMountKey は進まない)→保存、で連絡が処理済みになり二度と再通知されなかった。
  「外部状態が保存前の反映を跨ぐ」型は、**保存した中身で裏を取る**のが一番堅い(undo・休み解除・何でも吸収する)。
- 一覧は `selectParentMessagesForClassroom` で開いている教室に絞る。教室切替直後の 1 レンダーは前の教室の連絡と新しい教室の名簿が
  同時に見え、生徒ID sNNN は教室ごと独立採番なので**別人を休みにしうる**(INV-08)。
- 「振替先を今決める」の振替元トークンは `resolveRemainingOriginToken`(在庫行自身の値で作る)。★レビューの提案は
  `buildOriginToken(日付, 限)` の 1 行だったが、通常授業の休みは台帳へ**時限なし**で積まれる(appendMakeupOrigin 3 引数)ので
  `日付#限` は一致せず `resolveSelectedMakeupOrigin` が**最古へフォールバック**する(2026-06 の回帰と同じ症状)。提案を鵜呑みにせず
  権威関数の一致条件を読んで往復テストを書いた(parentMakeupPlacement.test.ts)。
- 配置モードへ入る判定は**その科目の raw 在庫行**の残数(`resolveParentMakeupPlacement`)。生徒単位の合計で見ると先取り済み科目で裏付けの無い振替が置かれる。
- 畳んだ入口(ピル)は**左下**。右下は確認リストのトグル/パネル(z-index:2000)が占有(開発用教室で必ず同時に出る)。
- 保存ループの try の中に足す後処理は **try/catch で囲む**(全教室の保存を「保存失敗」に巻き込まない)。

## 落とし穴
- `App.tsx` は git 上 -text(NUL バイト含む)で CRLF。grep が "Binary file matches" になる。ブロック置換は scratchpad に .cjs と本文ファイルを
  置いて `split('\r\n')` で行単位に差し替えた(Bash の heredoc に JS を直書きすると `\\n` が実改行に化けたり quote で落ちる)。
- `navigateClassroomScreen` は四択ハンドラより下で定義されるので ref 経由(`navigateClassroomScreenRef`)。useCallback の deps は定義時に評価され TDZ になる。
- 保護者ページが読むのは**保存済み**盤面。四択を押しても保存するまで行は通常授業のまま(「教室確認済」だけ先に付く)。
- デプロイ順: Hosting が先に出た数分は新ページの POST が旧 functions で 400、`'acknowledged'` を旧 functions が notified 扱い(開発用教室限定で許容)。
  Functions 緑を確認してから実機確認(確認リスト q-1〜q-5)。Firestore ルールの変更は無い。

**Why:** 自由記述は個人情報・URL・なりすましの懸念を抱えるわりに、実需は「休みます」だけだった(オーナー判断)。連絡を構造化したことで盤面の自動処理が可能になった。
**How to apply:** 昇格(本番教室)はフラグ両側同時([[komahyou-parent-portal-qr]])。四択の処理を増やすときは必ず既存メニューの本体を呼ぶ形にし、別の会計経路を作らない。

## 「保護者連絡」ボタン(休み連絡の履歴・v1.5.552・2026-09-19 オーナー指示)
- 盤面ツールバー「通常授業テンプレ作成」の右。フラグ parentPortalQr が OFF なら入口ごと出ない。未確認件数をバッジ表示。
- 履歴は**別購読** `subscribeParentMessageHistory`(createdAt 降順・limit 50・where なし=複合インデックス不要)。未処理の権威は従来の
  `where('notifiedAt','==',null)` 購読のまま(limit で古い未処理を落とさないため)。合流は `mergeParentMessageEntries`。
- 行の状態は `buildParentContactHistory`: 未確認 / 確認済(保存待ち)=pending / 確認済=notifiedAt or hidden。確認済は直近10件(見た目だけ)。
- ★「未処理」判定は `isUnprocessedParentMessage` の 1 本(モーダル一覧と履歴の未確認が同じ集合・同値性テストあり)。片方だけ条件を足さない。
- 未確認行クリック=既存の四択モーダルを開くだけ(履歴側に処理経路を作らない・INV-06)。出せる連絡 0 件/振替配置中は開かない。
- 確認リスト q-6(版 v1.5.540 据え置き)。functions/ルール変更なし。
