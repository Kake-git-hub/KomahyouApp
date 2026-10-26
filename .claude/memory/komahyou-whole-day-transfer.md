---
name: komahyou-whole-day-transfer
description: "丸ごと振替(日付メニュー3択目・Issue #40)の確定仕様と回帰監視点。v1.5.465本番反映(2026-08-02)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7be01ba2-0149-4272-ab47-2eb757728d8c
  modified: 2026-08-02T16:41:18.339Z
---

日付クリックメニュー先頭の「丸ごと振替」= 振替元日の全コマ(講師・メモ・生徒)を同じ講師・生徒のまま別日へ移す。Issue #40 として計画→2026-08-02 に定義確定・実装・本番反映(v1.5.465)。正本は docs/spec-lecture-stock.md §4-2(UI 3択)と docs/spec-makeup-stock.md §B-2-3(会計)。

**会計の要(INV-06)**:
- 移送側は在庫台帳を**一切触らない**(在庫中立)。通常→振替変換は「消化+1と使用済みorigin+1の均衡」。台帳に積むと二重計上。
- 振替先の既存コマ処分は「全コマ削除」(v1.5.464)と同一裁定へ**委譲**(`reconcileHolidayDeskStockReturns` `includeRegularLessons:false`+`returnedEntryIds`)。在庫由来(振替・session講習)=返却/通常・体験・**増コマ(オーナー指示で消去のみ)**・手動追加=返さず消去(通常のみ回数−1)。
- 出欠記録(movedマーカー含む)が両日どちらかにあれば実行不可=出欠記録を破棄する下流操作にしない。緩めるなら spec-invariants の下流列挙へ追加+2由来×出欠状態の突合が義務。
- suppressedMakeupOrigins は積みも解除もしない。

**オーナー確定のトレードオフ(2026-08-02 質疑)**:
- 振替元は空の営業日のまま残す(自動休日化しない)。全机が削除tombstone化するため**以後その日は講習自動割振・QR自動配置の対象外**(手動配置は可)。
- **QR提出講師(schedule-registration)の机を講習期間外へ移送しても自己修復は置き直さない**(v1.5.466・オーナー指示「講師移動をわかって振替しているので」)。`reconcileSubmittedTeacherPlacements` の配置済み判定は**盤面全体**を走査する(旧: 講習期間内のみ→期間外へ移した机を未配置と誤判定し起動毎に置き直して移動が巻き戻る=INV-02違反)。★**期間内限定に戻すと再発**(inv02マトリクス29件+経路テストで固定・mutation確認済み)。揮発ケースの復旧/部分配置の尊重/未提出スキップ/tombstone保護は従来どおり。
- **丸ごと振替した両日はテンプレ足場講師を再付与しない**(v1.5.467・オーナー指示「振替先にテンプレ講師が湧くのを止める」)。日単位の抑止キー`TEMPLATE_TEACHER__DAY__<日付>__0`を**既存のsuppressedRegularLessonOccurrencesに相乗り**(保存/undo/publish/署名/overlay受け渡しが全経路で通っているため。専用フィールドは配線約40箇所で漏れると黙って消える)。overlayが該当日の管理セルから「生徒のいない机の講師」を落とす。★**strip は必ず suppressManagedStudentsInCell の後**(順序がload-bearing。先に当てるとlesson付き管理机を素通しして再付与が復活)。抑止していない日のテンプレ追従(INV-02)は不変。テンプレ上書きの反映日以降は抑止解除。
- ⚠️副作用(既知・許容): 足場講師が落ちる分その日の**空き机が増える**ため、講習自動割振の満席判定が変わり従来スキップしていたコマに提出済み講師が新規配置され得る(実測でplacedCount 0→1)。また**振替元は「全机」tombstoneではない**(講師がいた机だけ)ので、元から空だった机には自動配置が入り得る。
- 処分ループは**共通関数disposeDayDeskEntries**へ一本化(v1.5.467)。丸ごと振替Phase Aと全コマ削除が共有し、違いはclearMemoSlots/suppressClearedRegularOccurrencesの2オプションのみ。studentSlotsとstatusSlotsの両方を同じ規則で走査(片方だけはINV-06再発温床)。
- 振替先が非営業日ならブロック(自動営業日化しない)。振替先の指定は選択モード(バナー+ヘッダークリック・週切替可)。

**回帰監視点**:
- `computeWholeDayTransfer`(ScheduleBoardScreen.tsx・純関数)。マトリクス `inv06-whole-day-transfer.matrix.test.ts` 29件・mutation 3件確認済み。INV-01/02 の丸ごと振替行もこのファイル(2日fixtureが要るため既存matrixと重複させない)。
- 権威関数の一本化: 再マージ抑止row-scan=`collectManagedOccurrenceSuppressionsForDate`(全コマ削除も同関数・**休日解除側だけ講師在籍フィルタが1行多い意図的な差**)/講師削除tombstone=`applyDeletedTeacherTombstone`(handleDeleteTeacher も使用)。バラして再分散させない。
- 確認ダイアログは振替先で消える講師の実人数も開示(講師カウントは机数でなくユニーク名)。

関連: [[komahyou-lecture-stock-clear-status-wipe]] [[komahyou-no-regression-rule]] [[komahyou-invariant-registry-plan]]
