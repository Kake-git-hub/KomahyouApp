---
name: komahyou-parent-portal-qr
description: "保護者向け固定QR(生徒別トークン→/p/{token}で通常+振替の日程閲覧・室長へ一方向連絡)の第1段実装(v1.5.512)。開発用教室+staging限定・オンデマンド関数型・parentMessages は classroomSnapshots 配下・写しトークンは他教室コピーで剥がす・日程計算は自己完結純関数を functions へ複製(パリティテストが門番)・レビュー指摘5件を同一pushで修正"
metadata: 
  node_type: memory
  type: project
  originSessionId: e853bfe9-40dc-4076-a577-b45a7b3b78fb
  modified: 2026-09-13T15:40:20.101Z
---

# 保護者向け固定QR（第1段・2026-09-13・v1.5.512 で本番反映・開発用教室限定）

**きっかけ**: オーナー指示「保護者からのQR読み込みによる室長連絡機能を開発用教室のみで実装して」。
仕様正本 `docs/spec-parent-portal.md`（§0 に採用した既定値 P-1〜P-12、**§0-2 に実装で確定した差分**、§0-3 にデプロイ順）。
計画は `docs/plan-2026-09-11-five-requests.md` §7（K-2〜K-6）。**§0 の推奨案はそのまま既定値として採用**した。

## 形（なぜこの形か）

- **オンデマンド関数型**（QR講習提出 `/s/{token}` と同じ）。公開 read の Firestore 文書は作らない。
  配布用盤面 `boardShares` 型は「生徒数×編集回数の書込」「個人情報を含む公開文書が常駐」「失効手段がない」で不採用。
- トークンの権威は `studentPortalTokens/{token}`（CF のみ・クライアント read/write 不可）。
  **有効1本の保証は索引 `studentPortalTokenOwners/{classroomId}__{studentId}`**（revokedAt 走査なしで getOrIssue を冪等にする）。
  `StudentRow.parentPortalToken` ＋ `parentPortalTokenClassroomId` は**写し**（表示の初期値・検証には使わない）。
- **連絡は `workspaces/{ws}/classroomSnapshots/{classroomId}/parentMessages/{id}`**（トップレベルではない）。
  理由: 既存ルールの `canAccessClassroom(workspaceKey, classroomId)` がそのまま効き、`retentionCleanup` の掃除対象に自動で載る
  （トップレベルは掃除ループが回らない）。保持 365 日。回数制限カウンタは同階層 `parentPortalRateLimits`（保持 7 日）。
- **API は `/api/parent/{token}` の GET/POST**（メソッドで区別。仕様本文の `/api/parent/message` は §0-2 で改訂）。
  検証順は **書式(400) → 失効/不在(410) → フラグ(403) → 在籍(410)** で、落ちたら**教室スナップショットを読まない**。
  410 は理由を出し分けない（在籍状況を第三者に漏らさない）。ログはトークン先頭 6 文字だけ。
- **フラグは左右対称**: クライアント `featureRollout.parentPortalQr` の scope は **`staging-environment`**
  （= staging プロジェクト全教室 ＋ どの環境でも開発用/テスト教室）で、サーバー `isParentPortalEnabledForClassroom`
  （`isDevelopmentClassroomIdentity(id, name) || projectId === 'komahyouapp-staging'`）と**述語が完全一致**。
  ID 単独の許可は入れない（クライアントの `SANDBOX_CLASSROOM_IDS` に本番の開発用教室 ID が無いため、
  片側だけ広いと「QR は出るのにページが開けない／その逆」になる）。**昇格は必ず両側同時**。
  片側だけ変えると落ちる字面テストを `featureRollout.test.ts` に置いた。
- **発行は「QR」ボタン押下時の getOrIssue**（生徒追加時の自動発行はしない）。理由: 生徒 ID は追加処理の
  setState 更新関数の内部で決まるため同期的に取れず、未配布のトークンを増やしたくない。

## 落とし穴（ここを外すと壊れる）

- **他教室コピーで写しトークンを剥がす**のは `stripParentPortalTokensFromStudents`（`developmentClassroom.ts` の単一権威）。
  `buildDevelopmentClassroomCopyPayload` の `students:` に適用。外すと開発用教室の画面から**本番生徒の日程を返すQR**が
  出る（提出トークンの 2026-07-09 事故 `b2e2048` と同型・INV-08）。振る舞いテストは `App.test.ts` にある。
- **Excel 差分取込（`mergeImportedBundle`）は一致行を丸ごと置換する**ので、写しトークンを明示的に引き継がないと消える
  （テストで固定）。`buildWorkbook` には**出さない**（表計算にベアラートークンを流出させない）。
- 日程計算の権威は **`src/utils/parentSchedule.ts`（import 0 行の自己完結）**。functions へは
  `functions/scripts/sync-shared.mjs`（prebuild）で `functions/src/generated/parentSchedule.ts` へ複製し、
  **パリティテストが「生成物＝元ファイル＋ヘッダ」と実行結果一致を固定**（片方だけ直すと CI が赤）。
  生成物は**コミットする**（CI の vitest は functions build より前に走る）。
- 日程の決定順（変えない）: 休講（forceOpen>holiday>closedWeekday・**休講日は盤面に配置があっても出さない**）
  → 講習期間（両端含む・一律非表示）→ **盤面優先**（盤面セルがある日はテンプレで足さない）
  → 盤面セルが無い日だけテンプレ補完（「予定(変更の可能性あり)」）。
  休み→振替先は**全週**から解決し、**出席済み(attended)/振無休も振替先候補**に含める（P-10。盤面 lessonLinks の
  2026-09-04 緑が丘バグと同型の穴を持ち込まない）。moved/trial/講習コマは出さない。
- 既読は**サーバーの `notifiedAt` を部分更新**（callable）。「確認」を押したときで、表示時ではない。
  成功した分だけ画面から消す（失敗時に消すと二度と気付けない連絡が生まれる）。localStorage は使わない。
- **Firestore ルールは main マージでは反映されない** → `firebase deploy --only firestore:rules` を別途実行
  （2026-09-13 に実行済み）。忘れると室長側の `parentMessages` 購読が permission-denied でモーダルが出ない。
  `npm run test:rules` は Java 21＋エミュレータ（キャッシュ済み）でローカル実行できる（25 件緑）。

## レビューで直した5件（同一 push・いずれも「修正なしで落ちる」テスト付き）

4視点レビュー（INV 監査／セキュリティ／日程計算の突き合わせ／統合・運用）の指摘のうち、
**昇格したら確実に踏むもの**を同じ push で直した。

1. **生徒削除の失効を写しの有無に依存させない**。写しが無くてもサーバーには有効トークンが残る
   （別端末発行・コピーで剥がした後・保存前）。しかも生徒ID `sNNN` は**欠番を再利用**するので、
   失効漏れの古いQRが後から入った別の生徒に一致し、**その子の日程が旧家庭に見える**恐れがあった（INV-08）。
2. **回数制限は「読む → 判定 → 許可のときだけ加算」**。拒否でも加算していたため、1 本の漏洩QRからの連打で
   教室×時カウンタが上限を越え、**同じ教室の他の保護者が 1 時間送れなくなる**（＋書き込み課金が止まらない）。
   判定は純関数 `resolveParentMessageRateLimitOutcome`（拒否なら `writes: null`）に切り出してテストした。
3. **GET にトークンごとのスロットル**（10 分 60 回・インスタンス内メモリ・Firestore へは書かない）。
   1 GET でスナップショット読み取り＋gzip 解凍が走るので、無制限だと増幅経路になる
   （`maxInstances` は同時実行数の制限で総量の歯止めにならない）。
4. **購読に onSnapshot のエラーコールバック**。ルール未反映の permission-denied が「連絡 0 件」と区別できず無音だった。
5. **既読化は 50 件ずつ分割**（`chunkParentMessageIds`）。サーバーは 50 件超を切り詰めず `invalid-argument` で
   丸ごと拒否するため、未読 51 件で「すべて確認」が恒久的に失敗し全画面モーダルが毎起動で残った。

ほかに: 回数制限カウンタの文書 ID をトークン全文から SHA-256 の指紋へ（文書パスが Firestore 例外メッセージ経由で
関数ログに出る）＋ログのトークン伏せ／「要望・報告」の同梱スナップショットから写しトークンを除去（Storage → AI へ
生きたベアラートークンを載せない）／QR モーダルを開くたび権威トークンを取り直す（写しが失効済みだと**死んだQRを
印刷して配る**）／CORS を本番・staging・localhost に限定／発行時に名簿の生徒実在を確認／ゼロ幅文字の除去／
`GOOGLE_CLOUD_PROJECT` へのフォールバック（gen2 で `GCLOUD_PROJECT` が無いと staging が prod 扱いになる）／
机数の既定を 14（欠落時にテンプレの 2 行目以降が静かに消えた）／空 id の status で振替先を引かない。

## 写した定数はパリティテストで縛る

`parentSchedule.ts` は自己完結なので権威の値をコピーしている。コピーしたものは**必ず**テストで突き合わせる:
コマ時間（`boardSlotTimes`）・科目一覧（`allStudentSubjectOptions`）・テンプレの曜日/時限
（`regularTemplateDayOptions` / `regularTemplateSlotNumbers`）・抑止鍵の形（`buildManagedOccurrenceKey`。
この 1 つは権威側を `ScheduleBoardScreen.tsx` から export して比較している）。
突き合わせが無いと「盤面と日程表は新しい・保護者ページだけ古い」が CI 緑で通る。

## デプロイ順（実際に踏んだ・v1.5.512）

新しい Hosting rewrite が**まだ無い関数**を指すと、Hosting デプロイが 400
（`Cloud Run service "parentportalapi" does not exist in region "asia-northeast1"`）で落ちる。
main マージは Hosting と Functions を**並行**に起こすので順序保証が無く、Hosting が先に走ると必ず失敗する
（本番は旧版のまま無傷＝fail-closed）。**Functions が緑になってから Hosting を再実行**する。仕様 §0-3 に記録。
実反映の確認は `GET /api/parent/xxxxxxxxxxxxxxxx` が 410＋日本語 JSON を返すこと（409 誤成功対策）。
CI には functions の型チェックを追加した（従来は `npm run build` も vitest も functions を型検査せず、
コンパイルエラーが「Deploy Cloud Functions が赤」になるまで分からなかった）。

## 2026-09-14 改定(v1.5.518・確認リスト k-4/k-5)

表示は暦の1か月単位(先月〜来月・resolveParentScheduleRange が月に丸める)・授業のある日だけ行を出す・
教室休みは holidayDates だけ closed の1行(定休曜日は出さない)・**講習期間の区別は廃止**(講習期間中も通常授業だけ・
講習は講習提出QRで案内=オーナー回答)。kind は closed/board/template のみ。仕様 §0-4 が本文より優先。
保護者とのチャット化(双方向)は相談段階(§A の「一方向」確定事項の変更になる・未着手)。

## 第1段で作っていないもの

- 連絡履歴の一覧（基本データ生徒詳細）。Firestore には 365 日残るので後から足せる。
- 全体 1 分 30 件のレート制限（トークン 1 日 5 件・教室 1 時間 60 件・GET のスロットルで代替）。
- 保護者ページの実機確認（iPhone Safari の見え方・印刷 1 枚のレイアウト）は人が見る必要がある
  → 確認リスト第6版 `v1.5.512` の k-1〜k-9（開発用教室のパネルから送信）。

**Why:** 公開エンドポイント＋個人情報なので、教室分離の担保を「クライアントのタグ」だけに任せず**関数側で
「そのトークンの教室に生徒が実在し在籍」まで検証**する形にした（既存の `lectureSubmissionApi` はトークン長しか見ていない）。
**How to apply:** 昇格（本番教室へ）はフラグ両側＋ルール反映＋実機確認がセット。仕様を変えるときは §0/§0-2 を先に直す。
関連: [[komahyou-dev-classroom-qr-token-contamination]] [[komahyou-plan-2026-09-11-five-requests]]
[[komahyou-qr-submission-notify-closed-pc]] [[komahyou-invariant-registry-plan]] [[komahyou-dev-verification-checklist]]
