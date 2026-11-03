# 特別講習「講師専用」— 別セッションへの引き継ぎ(2026-11-03)

> **状態(2026-11-03)**: v1.5.684 で実装済み。§5 の 3 点はオーナー確定 = 期間は重ねない(今どおり)／チェックは作成時だけ／講師専用では公開トグルを出さない。
> 確定仕様の正本は `docs/spec-special-session-submission.md` §B-3(この文書は経緯の記録)。

この文書は、確認リストのフリーメモ(受付 `20261103-105053536-c0f31680`・確認リスト v1.5.672)で来たオーナー要望を
別セッションで実装するための引き継ぎ。**着手前に CLAUDE.md・solo-git-workflow・regression-guard・safe-release を読むこと。**

## 1. 要望(原文)とオーナーの決定

- 原文: 「特別講習に、講師の予定だけ提出させたい要望があります。なので特別講習作成時に講師用のチェックボタンを付けて。
  このチェックがあるときは保護者や生徒日程表には、特別講習として表示しないで。講師専用とする。」
- **オーナー決定(2026-11-03・AskUserQuestion)**: 「**生徒側から全部隠す**」(推奨案を選択)。
  - 講師専用の講習は、**生徒日程表の講習の切り替え・生徒の提出用QRの発行・保護者QR・講習回数の欄**に出さない。
  - **講師日程表と講師の提出用QRだけ**に出す。
  - **まず開発用教室で先に試す**(機能フラグで開発用教室・テスト教室＋staging に限定)。
- 比較して選ばれなかった案: 「生徒QRと保護者QRだけ隠す(生徒日程表には講習期間として出る)」「見送り」。

## 2. 背景(開発用教室の実データ・読み取り専用で確認 2026-11-03)

開発用教室の特別講習データには、すでに講師の予定集めに使っているらしい講習がある:
`2026 下期出勤状況`(9/1〜9/30)・`後期通常授業予定`(10/1〜10/31)。今はこれらも生徒日程表・生徒の提出用QRに出る。
→ 講師専用チェックはこの使い方を正式にするもの。既存の講習を講師専用にするかは室長が決める(勝手に変えない)。

## 3. データ設計(案・着手時に spec-curator で確定)

- `SpecialSessionRow`(`src/components/special-data/specialSessionModel.ts`)に `teacherOnly?: boolean` を足す。
  未設定＝従来どおり(生徒にも出る)。判定は**必ず 1 つの関数**(例 `isTeacherOnlySpecialSession(session)`)を通す
  (`schedulePublished` と同じ作法・`isSpecialSessionSchedulePublished` 参照。`=== true` を各所に散らさない)。
- 作成画面(`SpecialSessionScreen.tsx` の作成欄・`createSession`)に「講師専用(生徒・保護者には出さない)」チェック。
  一覧にも講師専用の目印(列か札)。**フラグ OFF の教室ではチェックを出さず、項目も付けない**(`resolveNewSpecialSessionScheduleFields` と同じ考え)。
- 機能フラグ: `src/utils/featureRollout.ts` に新しいキー(例 `teacherOnlySpecialSession`)を `staging-environment` で追加
  (= 本番では開発用教室・テスト教室だけ・staging は全教室。`lectureSchedulePublishToggle` と同じ scope)。
  **フラグの scope は functions 側に同じ判定があるならそろえる**(保護者QRの CF は `functions/src/parentPortal.ts`)。
- Excel の書き出し/取り込み(`buildSpecialSessionWorkbook` / `parseSpecialSessionWorkbook`)で `teacherOnly` を落とさない・取り込みで勝手に付けない。

## 4. 生徒側から隠す場所(漏れなく・兄弟監査の対象)

| 場所 | 今の入口 | 隠し方の要点 |
|---|---|---|
| 生徒日程表の講習の選択 | `src/utils/scheduleHtml.ts` `buildStudentPayload` → `findOverlappingSession` → `resolveDisplayedOverlappingSession`(L339) | 生徒用は講師専用を除いた一覧で選ぶ。**講師用 `buildTeacherPayload`(L1000付近)は除かない**。共通関数に「誰向けか」を渡すか、呼ぶ前に絞る |
| 生徒日程表の埋め込みスクリプト | `scheduleHtml.ts` の `DATA.specialSessions` を読む箇所(L3387・L4351〜4399・L4608〜4627・L4792〜4878・L7046 付近) | 生徒用 payload の `specialSessions` から講師専用を外すのが一番漏れにくい(`createBasePayload` L718 付近で直列化) |
| 生徒の提出用QRの発行・後追い反映 | `src/App.tsx` `ensureScheduleSubmissionTokens`(L3879〜)・`writeSubmissionDocs` | 講師専用の講習では**生徒のトークンを作らず、生徒の文書も書かない**。講師は従来どおり |
| 講習回数(希望数)の欄・未消化講習・講習の自動割振 | `src/components/schedule-board/lectureStock.ts` `buildLectureStockEntries`・盤面の講習ストック一覧・自動割振 | 講師専用には生徒の入力が無いはずだが、手で入れられないよう生徒側の入口(生徒日程表の「登録」)が出ないことを確認 |
| 保護者QR | `src/utils/parentSchedule.ts` `readLectureSessions`(L581)・`resolveParentPublishedLectureEndDateKey`(L610)・**functions/src/generated/parentSchedule.ts(写し・パリティテストが門番)** | 講師専用は講習期間として扱わない(講習コマの表示・「次の月」の上限延長とも)。src と functions の写しを**同時に**直す |
| 生徒授業台帳・講習履歴 | `src/utils/studentLessonLedger.ts` L199・`scheduleViewData.ts` L464〜541・L809〜827 | 生徒の講習として数えない(講師専用には生徒の講習コマが無い前提を確かめる) |
| 盤面のコマ組み(別タブ) | `src/utils/scheduleViewData.ts` | 生徒の講習候補に講師専用を出さない |

**講師側は今のまま**: 講師日程表・講師の提出用QR・講師の登録/登録解除・講師の自動配置(`teacherAutoAssignRequest`)・
黄色(出席可能に変更)・講習集計の講師欄。

## 5. 決めておくべき未定義(着手時にオーナーへ確認)

1. **期間の重なり**: 今は講習期間どうしの重複登録を禁止している(`SpecialSessionScreen.tsx` L117〜122)。講師専用と生徒向けの講習を
   **同じ期間に重ねてよいか**(例: 冬期講習の期間に講師だけの出勤調査)。重ねてよいなら、日程表・QR の講習選択
   (`resolveDisplayedOverlappingSession`)は「講師日程表は講師専用を優先? 生徒向けを優先?」を決める必要がある。
2. 既存の講習(下期出勤状況など)にあとからチェックを付けたとき、**すでに発行した生徒の提出用QR**をどうするか
   (そのまま放置で読めば提出画面が出る/文書を失効させる)。
3. 講師専用の講習の「保護者への公開」トグル(`schedulePublished`)は意味が無いので、一覧で出さない・押せないにするか。

## 6. 完了の定義(CLAUDE.md の必須手順)

- 機能フラグ付きで実装し、**変更ごとのユニットテスト**(純関数＋配線のソース走査)を同じコミットに入れる。
  隠す場所(上の表)ごとに「講師専用なら出ない/講師側は出る」を固定する。
- `docs/spec-special-session-submission.md` に節を足す(講師専用の定義・隠す範囲・フラグ)。保護者QRに触れたら `docs/spec-parent-portal.md` も。
- 確認リスト(`src/utils/verificationChecklist.ts`)に開発用教室だけの確認項目を足す。**このフリーメモの受付番号
  `20261103-105053536-c0f31680` を `VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS` に足す**(足すまで確認リストに「対応待ち」として残る)。
- 進行中テーマ台帳 `src/utils/developmentStatusLedger.ts` の行 `teacher-only-special-session` を、実装後は
  stage `development-only`＋`featureKeys` に書き換える(フラグの scope と段階はテストが突き合わせる)。
- `CHANGELOG.md` に 1 行・regression-reviewer で監査 → main へマージ(CI が自動デプロイ)。functions を変えたら Actions の
  「Deploy Cloud Functions」も(パリティテストを通すこと)。

## 7. 直前の状態(このセッションで済んだこと)

- v1.5.680/681 で確認リスト 11/3 午後の送信へ対応済み(登録解除の取りこぼし・QR の内容保持・期間違いの QR・日程表の即時更新ほか)。
- 確認リストの版は **v1.5.672 据え置き**(項目ごとの送信済み表示を版で絞って読むため)。項目を足すだけなら版は上げない。
- 送ったフリーメモは「対応待ち」として確認リストに出る仕組み(`selectPendingChecklistOtherNotes`)。この要望はそこに残っている。
