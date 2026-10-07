# 計画: 休日設定で手動追加のコマも未消化振替へ返す（2026-10-07）

> **状態**: 計画のみ（未実装）。別セッションで実行する。
> **発端**: 日大前校の質問（[Kake-git-hub/KomahyouApp#73](https://github.com/Kake-git-hub/KomahyouApp/issues/73)・
> 2026-10-07「10/12 を休日設定にしたが、未消化振替に入っている生徒と入っていない生徒がいる」）。
> 調査の結果、入っていない 6 人のうち 3 人は**手動追加のコマ**、3 人は**休日設定前に削除済み**で、どちらも現行仕様どおり。
> 室長の希望: **今回（10/12）はそのままでよい。次回以降の休日設定では手動追加の生徒分も未消化に入れてほしい。**
> オーナー指示（2026-10-07）: 仕様変更として計画を作る。
>
> ⚠️ 利用者報告 Issue 由来なので、**実装着手はオーナーの許可が前提**（CLAUDE.md 標準フロー）。この計画をオーナーが読んで
> 「進めてよい」と言った時点で着手する。実装セッションは着手前に §4 の判断 3 点を `AskUserQuestion` で確定すること。

---

## 1. 現行仕様（変更前の事実）

正本: `docs/spec-makeup-stock.md` §B-2-2c の表「その机の中身 → 未消化在庫へ」。

| 休日設定時の机の中身 | 現行 | 根拠 |
|---|---|---|
| テンプレ由来の通常授業（配置・出席・振無休） | 未消化振替へ**返る** | 授業が消えるので別日にやる |
| 在庫由来の振替・講習 | **返る** | 在庫を消費していたので返す |
| **手動追加**（`manualAdded`）の通常・振替・増コマ | **返らない** | 「在庫を経由していない」（表の最終行。**例外は §B-3 の「休み」だけ**） |
| 手動追加の講習（`specialStockSource:'manual'`） | **返らない** | 同上 |
| 体験（`trial`） | 返らない | 振替の概念が無い |

コード上の分岐（`src/components/schedule-board/ScheduleBoardScreen.tsx`）:

- `reconcileHolidayDeskStockReturns`（約 1640〜1790 行）内の `returnEntryToStock`:
  - `special` かつ `specialStockSource !== 'session'` → `{ kind: 'none' }`（手動追加の講習は返さない）
  - `if (!entry.manualAdded) { … appendMakeupOrigin … return { kind:'makeup', … } }` → それ以外（手動追加の通常/振替/増コマ）は `{ kind: 'none' }`
- 控え `holidayStockReturn`（`HolidayStockReturnStamp`）は `holiday` 記録へ焼き込まれ、**休日解除**（約 1948〜2060 行）は控えだけを見て巻き戻す。
  `kind:'none'` かつ `manualAdded` の記録は「在庫を消化していない＝再浮上しない」として**別日のコマを消さず席へ戻すだけ**
  （`inv06-holiday-record-retention.matrix.test.ts` ★(k)）。
- 「その日の生徒を全コマ削除」（`handleClearStudentsOnDate`・5956 / 6118 行の `includeRegularLessons: false`）は同じ関数を使うが、
  通常授業も手動追加も返さず希望回数 −1（2026-08-02 オーナー確定）。

**なぜ食い違って見えるか**: 同じ手動追加のコマでも、「休み」ボタンは未消化へ返す（§B-3・2026-07-31 オーナー確定「手動追加かどうかで
扱いを変えない」）のに、休日設定は返さない。§B-3 の根拠は「日程表の実績カウントは `manualAdded` を除外しないので、実績から外れた分を
返さないと 1 コマ消える」——この根拠は**休日設定でもそのまま成り立つ**（休日で盤面から消えれば実績 −1 になる）。
つまり現行は §B-3 と休日設定が**非対称**で、今回の要望は「休日設定を §B-3 に揃える」と整理できる。

### 日大前校で実際に起きたこと（参考・生徒名はここに書かない）
- 曜日変更した生徒を「通常授業（テンプレ）は旧曜日のまま、毎週 旧曜日の回を削除して新曜日に手動追加」で運用していた。
  → 新曜日が休日になると手動追加分は返らず、振替が 0。
- 根本対策は**テンプレの曜日を変える**ことだが、室長の運用に合わせて休日設定側でも救うのが本計画。

---

## 2. あるべき姿（変更後の仕様案）

> spec-curator がこの節を `docs/spec-makeup-stock.md` へ反映する（§B-2-2c の表・§B-3・§3 の文言・INV-06）。文言改定はオーナー承認。

1. **休日設定で消える手動追加の通常（`regular`）・増コマ（`extra`）・振替（`makeup`）は、未消化振替へ返す。**
   - 対象は配置（`studentSlots`）と、`HOLIDAY_STOCK_RETURNABLE_STATUSES`（出席・振無休）の出欠記録。`absent` / `moved` / `holiday` は従来どおり触らない。
   - 元コマ（origin）は `resolveOriginalRegularDate(entry, cellDateKey)`（手動追加の通常は当日＝休日の日付。手動追加の振替は
     `makeupSourceDate` を持たないので当日）。時限は付けない（既存の通常授業と同じ形・`appendMakeupOrigin` は重複を許すので
     同じ生徒×科目を同日に 2 コマ手動追加していれば 2 件積まれる）。
   - 在庫キーは `resolveBoardStudentStockId`（管理生徒＝生徒 ID／未管理の手動追加＝`manual:name:表示名`）。未管理なら
     `fallbackMakeupStudents` へ表示名を足す（既存の `fallbackAdded` 経路）。
2. **控え（`holidayStockReturn`）は `{ kind:'makeup', originDateKey, fallbackAdded }` を焼き込む**（通常授業と同じ形）。
   これで**休日解除は既存の 'makeup' 経路で対称に巻き戻る**（origin を 1 件外す／別日に組んだ振替コマを消す／出欠記録付きなら復元しない）。
   解除側のコードは**変えない**。
3. **旧記録との互換**: この変更より前に休日設定した `holiday` 記録（手動追加・控え `kind:'none'`）は解除で**台帳を触らない**（現行どおり）。
   返していないものを巻き戻してはいけないので、'none' の扱いは残す（★(k) テストは据え置き）。
4. **「その日の生徒を全コマ削除」は変えない**（通常授業すら返さない操作なので、手動追加も返さない。希望回数 −1 も従来どおり）。
5. **個別メニューの「ストックへ戻す」が手動追加で無効なのは変えない**（別要望。今回の範囲外）。
6. **体験（`trial`）は返さない**（休みボタンも無い）。
7. **手動追加の講習**（`special` / `specialStockSource:'manual'`）: §4 の判断 B による。推奨は**未消化講習へ返す**（§B-4「手動追加した講習も
   未消化講習へ戻す・例外を作らない」と揃える）。返す場合は `appendLectureStockCount`＋`appendManualLectureStockOrigin` を
   session 由来と同じに通し、控えは `{ kind:'lecture', originDateKey, originSlotNumber }`。解除側の 'lecture' 経路で対称に戻る。
   `specialSessionId` が無い旧データだけ対象外（§B-4 と同じ保険）。
8. 日程表の回数: 手動追加の通常は希望回数に含まれず実績だけ（§3）。休日で実績 −1 → 返した origin から振替を置けば実績 +1 で釣り合う。
   `scheduleCountAdjustments` は触らない。
9. 操作ログ `holiday-toggle action=set-holiday movedStudentCount=N` の N に手動追加分が含まれるようになる（仕様上の副作用。報告の読み方に注意）。
10. **過去の休日には遡及しない**。10/12 分は室長了承のうえそのまま（必要なら「手動追加 → 休み」の運用で +1 できる）。

---

## 3. 懸案と妥協案（ユーザビリティ影響・オーナー提示用）

| # | 懸案 | 妥協案 / 判断 |
|---|---|---|
| 1 | **在庫の純増**: 手動追加はもともと在庫を消費していないので、休日で返すと「足したコマの分だけ未消化が増える」。§B-3「手動追加して休みにすると在庫が純増する」と同じ性質 | §B-3 で**オーナーが許容済み（2026-07-31）**の挙動と同型。休日設定だけ例外にしている方が不整合。→ 揃える |
| 2 | **全教室に即時適用**か、**フラグで開発用教室→staging→全教室**か | 会計ルールの変更で UI は変わらない。確認リスト＋staging 実機で担保できる規模。推奨: **フラグ無し**（§4-A） |
| 3 | 手動追加の**講習**も揃えるか | 推奨: 揃える（§B-4 と同じ根拠）。範囲を小さくしたいなら振替だけ先行（§4-B） |
| 4 | 曜日変更を手動追加で代用する運用そのものは残る（テンプレ側の曜日を変えれば本来は不要） | 回答文で「テンプレの曜日変更をおすすめ」を添える（対応済み・本計画とは別） |
| 5 | 同じ生徒×科目でテンプレ通常授業と手動追加が**同日**に並ぶ場合、origin が 2 件になる | 2 コマ消えるので 2 件が正しい。ただし `resolveMakeupStatusOriginToMaterialize` の「同じ日付の origin があれば積まない」は**出欠記録の振替**専用で、配置の通常授業には掛からないことをテストで固定する（§5 T-4） |

---

## 4. 着手前にオーナーへ確認する判断（実装セッションが `AskUserQuestion` で確定）

- **A. 適用範囲**: (推奨) フラグ無しで全教室 ／ `featureRollout` に新フラグを切って開発用教室→昇格
- **B. 手動追加の講習**: (推奨) 振替と同時に未消化講習へ返す ／ 今回は振替だけ
- **C. 仕様文言**: §2 の案を spec-curator がそのまま正本へ反映してよいか（§B-2-2c 表の最終行を分割・§3「手動追加した生徒は振替ストックに
  カウントしない」の注記に「休日設定・休みで返した分は出る」を追記）

---

## 5. 実装手順（dev-fix 向け・1 ブランチ・1 コミットでテスト同梱）

**前提**: `solo-git-workflow` の同期確認（`git fetch` → ローカル main が origin/main、`package.json` の version とライブ `version.json` が一致）。
作業ブランチ例: `feat/holiday-return-manual-added`。

### 5-1. 仕様（spec-curator・先行）
- `docs/spec-makeup-stock.md`
  - §B-2-2c の表: 「体験・増コマ・手動追加コマ」行を「体験 … 返らない」「**手動追加の通常・増コマ・振替 … 返る**（当日 origin・§B-3 と同根拠・2026-10-xx 改定）」
    「手動追加の講習 … 判断 B」に分割。表直下の「この表を変えるときは控えと解除側を同時に見直す」に従い、控えの形を明記。
  - §B-3 に「休日設定も同じ扱い（2026-10-xx）」の 1 行。§B-2-1 の「全コマ削除は返さない」は据え置きと明記。
  - §3「手動追加した生徒は振替ストックにカウントしない」の注記に「休み／休日設定で**返した**分は残数に出る（消化側で数えないのは据え置き）」。
- `docs/spec-invariants.md` INV-06 の行に経路を追記（休日設定×手動追加）。
- 文言はオーナー承認を得てから push（台帳改定を同一 push に伴わないと CI の matrix 薄化検査に引っかかる可能性あり）。

### 5-2. コード（`src/components/schedule-board/ScheduleBoardScreen.tsx`）
1. `reconcileHolidayDeskStockReturns` の params に `includeManualAddedLessons?: boolean`（既定 `false`）を足す。
   - `returnEntryToStock` の `if (!entry.manualAdded)` を `if (!entry.manualAdded || includeManualAddedLessons)` に。
     `returnedEntryIds.push` も同じ条件（全コマ削除は false のままなので希望回数 −1 の挙動は不変）。
   - 判断 B が「返す」なら `special` 分岐も `specialStockSource === 'session' || (includeManualAddedLessons && entry.specialSessionId)` で
     同じ返却経路へ。`specialSessionId` 無しは `{ kind:'none' }` のまま。
   - コメントに「§B-3 と同根拠（実績カウントは manualAdded を含む）・2026-10-xx オーナー確定・INV-06」を残す（回帰防止アンカー）。
2. 休日設定の呼び出し（`handleToggleHolidayDate` 内・約 10893〜10920 行）で `includeManualAddedLessons: true` を渡す。
   **全コマ削除（5956 / 6118 行）は渡さない。**
3. 解除側（約 1995〜2060 行）は変更しない。'none'＋`manualAdded` の分岐コメントに「この変更以前の旧記録向け」と 1 行足す。
4. 文言: 休日設定の確認ダイアログ「この日に入っている授業はすべてストックへ移行します」は手動追加も含むようになるので**そのままで正しい**。
   手動追加コマのメニュー注記「手動追加した通常/振替は未消化振替へ戻せません」は個別操作の話なので据え置き。

### 5-3. テスト（同一コミット・「修正なしで落ち・修正ありで通る」を確認）
`src/components/schedule-board/inv06-holiday-stock-reconciliation.matrix.test.ts` に追加:
- T-1 配置の手動追加 `regular` → `includeManualAddedLessons:true` で当日 origin が 1 件・`returnedEntryIds` に含む・控え `kind:'makeup'`。
- T-2 出席済み（`attended`）／振無休の手動追加 `regular` → 同上。`absent` の手動追加は積まない（mark-absent 済み）。
- T-3 手動追加 `makeup`（`makeupSourceDate` 無し）→ 当日 origin。手動追加 `extra` → 当日 origin。`trial` → `kind:'none'`。
- T-4 同じ生徒×科目でテンプレ通常＋手動追加が同日に並ぶ → origin 2 件（dedupe されない）。
- T-5 `includeManualAddedLessons` 省略（＝全コマ削除経路）→ 手動追加は従来どおり `kind:'none'`・`returnedEntryIds` に入らない（非回帰）。
- T-6（判断 B＝返す）手動追加の講習 → `manualLectureStockCounts +1`・控え `kind:'lecture'`。`specialSessionId` 無し → 'none'。

`src/components/schedule-board/inv06-holiday-record-retention.matrix.test.ts` に追加:
- T-7 往復: 手動追加 regular を休日設定 → 解除で台帳が設定前と完全一致・席へ戻る・`manualAdded:true` が保たれる。
- T-8 休日設定 → その origin から別日に振替を置く → 解除でその振替コマが消え origin も外れる（±0）。出欠記録付きなら `makeup-in-record` でスキップ。
- T-9 旧記録（控え 'none'＋manualAdded）は解除で台帳を触らない（既存 ★(k) を据え置き＝回帰防止）。

`ScheduleBoardScreen.test.ts` の休日件数・メッセージの既存 assert が手動追加を含むようになる箇所があれば期待値を更新（薄化ではなく拡張）。
`npm run lint` / `npm run test` / `npm run build` を通す。

### 5-4. 確認リスト・台帳・更新リスト
- `src/utils/verificationChecklist.ts`: 次にデプロイされる版へ `VERIFICATION_CHECKLIST_VERSION` を上げ、項目を追加（例 id `h-1`〜`h-3`）:
  - h-1 開発用教室で営業日の空席に管理生徒を「生徒を追加」（通常）→ その日を休日設定 → 未消化振替にその生徒×科目が +1、盤面に「休)」が残る。
  - h-2 その日を休日解除 → 未消化が −1 で元に戻り、席にその生徒が戻る（手動追加のまま）。
  - h-3 同じ日を「その日の生徒を全コマ削除」→ 手動追加分は未消化に**入らない**（従来どおり）。
  - （判断 B）h-4 手動追加の講習で h-1/h-2 を繰り返し、未消化講習が +1/−1。
- `src/utils/developmentStatusLedger.ts`: 作業中は行 `holiday-return-manual-added`（stage に応じて）を置き、main マージ後に消す。
- `CHANGELOG.md` `## 未リリース` に `feat: 休日設定で手動追加の通常/振替(/講習)も未消化へ返す（§B-3 と同根拠・#73・INV-06）`。
- コミットメッセージに `INV-06` と `#73` を記載。

### 5-5. レビューとリリース
- `regression-reviewer` で INV-06 監査（兄弟監査: 休日設定⇄解除／全コマ削除／個別削除／休み、生徒⇄講師、盤面⇄日程表）。
- `safe-release`: staging に最新 main を反映 → ブランチをデプロイ → h-1〜h-3 を実機 → main マージ → ライブ検証 → 確認リスト結果を
  `node tools/verification-checklist-report.mjs --workspace main` で読む。
- Issue #73 はオーナー確認後にクローズ（室長への回答は開発者画面「質問への回答」から・§G-4 準拠で時期は約束しない）。

---

## 6. 室長への回答文案（実装後に送る・§G-4 準拠）

> 休日に設定したとき、手で追加したコマも未消化振替に入るように変更しました。これからの休日設定ではご質問の件は起きません。
> 「その日の生徒を全コマ削除」とコマ1つずつの「削除」は、これまでどおり未消化には入りません（授業を行わない扱いです）。
> 10/12 の分は、ご了承いただいたとおりそのままにしています。

（実装前に先行して返す場合は「要望として記録しました。対応できるようになったらお知らせします」までにとどめる。）
