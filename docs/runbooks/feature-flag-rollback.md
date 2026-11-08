# Runbook: 機能フラグを全教室から戻す（2026-11-08 の全教室展開週）

2026-11-08（v1.5.711）に全教室へ出した 4 つの機能を、**1 本ずつ**「全教室より前の範囲」へ戻す手順。
Hosting の版を丸ごと戻す（[rollback.md](rollback.md) の A-1）より狭く、**その機能だけ**を止める。
戻すのは手元のファイルだけで、本番データ（Firestore / Storage）には一切書かない（本番データ保護ルール）。

> 大原則: 止血を先に。ただし**機能ごとの事前確認を飛ばさない**（下の 3 節）。とくに「講習の公開」は事前確認を飛ばすと室長が講習を公開に戻せなくなる。

---

## 1. いつ使うか（症状 → どのフラグか）

| 症状（室長・保護者から） | 画面での呼び名 | フラグ | 戻し先の既定 |
|---|---|---|---|
| テンプレを保存したら授業・講師が思わぬ机に置かれた／消えた・緑の 2 行（保留）がおかしい | テンプレ保存の差分反映 | `templateDiffApply` | `development-only` |
| 保護者ページが開けない・休みの連絡が届かない・QR の発行や印刷でエラー | 保護者向けQR | `parentPortalQr` | `staging-environment` |
| 講習の「保護者への公開」ボタンの不具合・講習が提出用QR/保護者QRに出ない | 講習の公開 | `lectureSchedulePublishToggle` | `staging-environment` |
| 講習を作るときの「講師専用」チェックの不具合 | 講師専用の特別講習 | `teacherOnlySpecialSession` | `staging-environment` |

- 戻し先の既定は、v1.5.711 の直前にそのフラグが持っていた範囲（スクリプトの `PREVIOUS_SCOPES`）。`development-only` = 開発用教室・テスト教室だけ、`staging-environment` = それに検証環境（staging）を足したもの。
- 画面が真っ白・全体が動かないなど**機能を特定できない**ときは、このページではなく [rollback.md](rollback.md) の A（Hosting）へ。
- `parentPortalQr` は `development-only` へは戻せない（サーバー側の型と判定が staging も通すため。スクリプトがエラーにする）。

---

## 2. 共通手順（5 分）

1. **事前確認**（下の 3 節の該当機能）を済ませる。
2. 予行: `npm run flag:rollback -- <フラグ> --reason "<理由>" --dry-run`
   （= `node tools/feature-flag-rollback.mjs <フラグ> --reason "<理由>" [--to development-only|staging-environment] --dry-run`）。
   書き換える範囲と注意が出る。何も書かない。
3. 本番: 同じコマンドを `--dry-run` なしで実行する。次の 4 ファイルだけが変わる（2 回実行しても 2 回目は何も変えない）。
   - `src/utils/featureRollout.ts` の `scope`（そのフラグの行だけ）と、戻しの記録 `FEATURE_ROLLBACKS` の 1 項目（`{ from: 'all-classrooms', to, date, reason }`）
   - 保護者QRだけ `functions/src/parentPortal.ts` の `PARENT_PORTAL_BASE_SCOPE`（両側同時。片側だけだと `featureRollout.test.ts` の字面の突合が落ちる）
   - `src/utils/developmentStatusLedger.ts` に「〜を戻した」の行（全教室でないフラグは台帳に載っていないとテストが落ちる）
   - `CHANGELOG.md` の `## 未リリース` に `- fix: 機能フラグ <key> を全教室から <scope> へ戻す(理由: …・戻し手順書)`
4. テストは直さなくてよい。昇格を固定しているガードテストは期待値を `resolveExpectedFeatureScope(key)`（`FEATURE_ROLLBACKS` に記録があればその戻し先・無ければ `all-classrooms`）から導くので、**記録された戻しならそのまま緑**（下の「記録された戻しとガードテスト」）。
5. `npm run lint && npm run test:unit && npm run build`（保護者QRは `npm --prefix functions test` も）。
6. `git diff` を通読する（上の 4 ファイル＋直したテスト＋確認リスト以外が変わっていないか）。
7. commit → main マージ（CI が Hosting を出す）。保護者QRは `functions/**` が変わるので「Deploy Cloud Functions」も自動で走る。**緑まで確かめる**。
8. `https://komahyouapp-prod.web.app/version.json` の版が上がったのを確かめ、室長へ**ハードリロード（Ctrl+Shift+R）**を案内する。
9. 確認リスト（`src/utils/verificationChecklist.ts`）: 全教室展開を本番で見る項目 pr-1〜pr-3 は、戻したフラグについて見直す
   （`verificationChecklist.test.ts` は記録を見るので落ちないが、項目の文は「全教室で動く」前提のまま）。開発用教室で戻した後の見え方を確かめる項目を足す。

### 記録された戻しとガードテスト

- 4 機能の昇格を固定しているガードテスト（`featureRollout.test.ts` の「全教室で有効」と保護者QRの 4 件・`verificationChecklist.test.ts` の pr-1〜pr-3・
  `templatePendingDesks.wiring.test.ts`・`featureRollout.companyLayer.test.ts`・`teacherOnlySpecialSession.test.ts`・`functions/src/parentPortal.test.ts`・
  `functions/src/featureCompanyLayer.test.ts`）は、scope を `'all-classrooms'` と直接比べず `resolveExpectedFeatureScope(key)` と比べる。
- **スクリプトで戻した（= `FEATURE_ROLLBACKS` に記録がある）ならテストはそのまま緑。** 記録が無いまま scope を変えた（うっかり書き換えた事故）は、今までどおりガードが落ちる。
- 保護者QRのサーバー側の突合（`featureRollout.test.ts`）は「`PARENT_PORTAL_BASE_SCOPE` がクライアントの scope と同じ値」だけを見る。スクリプトが両側を同時に書くので通る。
- `schedulePublish.test.ts` の「講習の公開と保護者QRは同じ範囲」は、どちらかに戻しの記録があるときだけ「同じ値」を求めない（下の向きの注意に従う）。

> ⚠️ **向きの注意: 講習の公開と保護者QRは同じ範囲にそろえる決まり**（`schedulePublish.test.ts`）。
> 「保護者QRだけ広いと、隠す手段の無いまま講習が保護者に出る」ための決まりなので、**講習の公開だけを戻すとこの向きになる**（記録があればテストは通るが、害は残る）。
> 講習の公開だけを止めたいときは、保護者QRも一緒に戻すかを**オーナーが決めてから**進める。
> 保護者QRだけを戻すのは向きとしては害が無い（講習の公開の方が広い）。

---

## 3. 機能ごとの事前確認と、戻した後の見え方

読み取りの準備（全節共通・書き込みはしない）:

```bash
export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)   # 読み取り専用・1 時間有効
# いちばん新しい 15 分ごとの自動バックアップの時点を探す
curl -sS -H "Authorization: Bearer $FIRESTORE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  'https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents/workspaces/main:runQuery' \
  -d '{"structuredQuery":{"from":[{"collectionId":"workspaceAutoBackupSummaries"}],"orderBy":[{"field":{"fieldPath":"savedAt"},"direction":"DESCENDING"}],"limit":1}}'
# 要約の文書 ID が時点の key。教室ごとのファイルをスクラッチ領域へ落とす(日大前 5w5OMueETerSKrSf14HC・緑が丘 KzFnOQoTFLsCxwUp1tvh)
KEY=<時点の key>; ID=<教室 ID>; OUT=<スクラッチ領域>/$ID.json.gz
curl -sS -H "Authorization: Bearer $FIRESTORE_ACCESS_TOKEN" -o "$OUT" \
  "https://storage.googleapis.com/storage/v1/b/komahyouapp-prod.firebasestorage.app/o/$(node -e "process.stdout.write(encodeURIComponent('workspace-auto-backups/main/15min/'+process.argv[1]+'/'+process.argv[2]+'.json.gz'))" "$KEY" "$ID")?alt=media"
```

- 中身は「1 教室だけ入った全体 JSON」で、教室データは `classrooms[0].data`（`docs/spec-save-restore.md` の教室別バックアップ）。
  教室スナップショット文書（`classroomSnapshots/{id}`）は週ごとの部品に分かれているので、数えるのはバックアップの方が早い。
- 取得したファイルには生徒名が入る。スクラッチ領域に置き、リポジトリ・Issue・公開ログへ出さない。出力に名前を出さない（件数と講習 ID だけ）。
- 15 分ごとのバックアップは最新の保存を反映するまで最大 15 分遅れる。室長に直してもらった直後は、次の時点を待って数え直す。

### 3-1. テンプレ保存の差分反映（`templateDiffApply`）

**事前確認**: 本番 2 校の保留（緑の 2 行）の件数を数える。

```bash
node -e "const d=JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync(process.argv[1]))).classrooms[0].data; console.log('保留の机', Object.keys(d.boardState?.templatePendingDesks ?? {}).length)" <落としたファイル>
```

**戻した後の見え方**:
- **保留のある教室は、フラグを OFF にしても第 2 版の経路を使い続ける**（N-1・`resolveTemplateDiffApplyActive`）。2 行の表示も差分反映のテンプレ保存もそのまま。保留の机と下段の講習の在庫は守られる。
- 保留が 0 件になった教室から旧方式（テンプレ保存で上書き）へ戻る（同じ画面のうちでも戻る＝意図どおり）。そのとき、**講師の休みの机には次の読み込みでテンプレの講師が戻る**（休みの印は残り、第 2 版へ戻せばまた休みになる）。同じ日に動かしたテンプレの授業は元の時限に重ねて置かれない。
- 室長への案内: 「テンプレ保存が前の方式に戻ります。緑の 2 行が残っているうちは今の方式のままです」。講師の休みを使っている教室には「休みの机に講師が戻って見えることがある」と添える。
- ⚠️ **Hosting を v1.5.711 以前へ戻すとこの保護は無い**（その版はフラグだけで決めるので、保留の残る教室で旧方式のテンプレ保存をすると下段の在庫由来の講習・振替が未消化へ戻らずに消える・INV-06）。止めたいだけなら古い版へ戻さず、このスクリプトで OFF にした版を出す（[rollback.md](rollback.md) A-1 の注意も同じ）。

### 3-2. 講習の公開（`lectureSchedulePublishToggle`）

**事前確認（必須・飛ばさない）**: 戻すと画面のトグルは消えるが、保護者QR側（`src/utils/parentSchedule.ts` と functions の写し）は
`schedulePublished: false` の講習を**隠し続ける**。トグルが無いので**室長は公開に戻せなくなる**。

1. 非公開の講習を一覧にする（件数と講習 ID・期間だけ。講習名は室長に伝えるときだけ画面で見る）:

   ```bash
   node -e "const d=JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync(process.argv[1]))).classrooms[0].data; const s=(d.specialSessions??[]).filter(x=>x.schedulePublished===false); console.log('非公開の講習', s.length); for (const x of s) console.log(x.id, x.startDate, x.endDate)" <落としたファイル>
   ```
2. 1 件以上あれば、室長へ「戻す前に、非公開の講習を全部『保護者への公開』で公開へ戻して保存してください」と頼む。
   戻すと、それまで非公開だった講習は**提出用QR・保護者QRに出る**ことも先に伝える。
3. 次の 15 分ごとの時点を落として数え直し、**2 校とも 0 件**になってから共通手順へ進む。
4. 上の「同じ範囲にそろえる決まり」（2 節の ⚠️）をオーナーと決めてから進める。

**戻した後の見え方**: 講習の作成・編集画面から「保護者への公開」が消える。新しく作る講習は公開で始まる（非公開の項目を付けない）。
既存の講習の値は消えない（ON に戻せば元どおり）。

### 3-3. 保護者向けQR（`parentPortalQr`）

**事前確認**: 室長へ「保護者QR（休みの連絡）をいったん止める。保護者ページは開けなくなるので、休みの連絡は電話で」と案内する文を用意する。

**戻し方の注意**: スクリプトが `featureRollout.ts` と `functions/src/parentPortal.ts` の**両方**を書く。main マージで Hosting と Functions の両方のデプロイが走る。
- Functions のデプロイが**緑になるまで**、サーバーは保護者ページに答え続ける（画面の QR ボタンは Hosting の反映で先に消える）。緑になると本番教室の保護者ページは 403（開けない）になる。
- 配った QR のトークンは消えない。ON に戻せば同じ QR がまた使える。

**事後確認（ON に戻した後）**: OFF の間に名簿から**削除した生徒**の QR は、サーバー側の失効が走っていない
（`src/App.tsx` の生徒削除で失効をフラグで条件づけているため）。ON に戻したら、開発者が OFF の期間に削除した生徒の QR を失効させる。
削除済みの生徒は在籍確認で落ちるので保護者ページは開けない（実害は小）が、トークンを残さないために行う。

### 3-4. 講師専用の特別講習（`teacherOnlySpecialSession`）

**事前確認**: 不要。

**戻した後の見え方**: 講師専用かどうかは**講習のデータで決まる**ので、作成済みの講師専用の講習は生徒側から隠れたまま（見え方は変わらない）。
講習を作るときの「講師専用」のチェックが出なくなるだけ。

---

## 4. ON へ戻す（もう一度全教室へ出す）とき

原因を直し、確認リストで開発用教室の確認を通してから、オーナーの判断で次を 1 つの変更で行う。

1. `src/utils/featureRollout.ts` のそのフラグの `scope` を `'all-classrooms'` に戻す。
2. 同じファイルの `FEATURE_ROLLBACKS` からそのフラグの項目を消す（全部消えたら `{}` に戻す）。記録を残したまま scope だけ戻すと、ガードテストが「記録の戻し先と違う」で落ちる。
3. 保護者QRは `functions/src/parentPortal.ts` の `PARENT_PORTAL_BASE_SCOPE` も `'all-classrooms'` に戻す（両側同時・main マージ後に Functions デプロイの緑を確かめる）。
4. 進行中テーマ台帳の「〜を戻した」の行（id `rollback-…`）を消す。CHANGELOG に「全教室へ戻す」の 1 行。
5. `npm run lint && npm run test:unit && npm run build` → `git diff` → commit → main マージ → `version.json` → 室長へハードリロードの案内。
6. 保護者QRは 3-3 の事後確認（OFF の間に削除した生徒の QR の失効）を忘れない。

関連: [rollback.md](rollback.md)（D 節）・`tools/feature-flag-rollback.mjs`・`docs/plan-2026-11-08-rollback-readiness-week.md`。
