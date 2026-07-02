# 更新リスト (CHANGELOG)

コマ表アプリの変更履歴。**編集ごとに必ず追記する**(回帰防止の記録)。
運用ルールは `.claude/skills/solo-git-workflow/SKILL.md` の「編集前チェックと更新リスト」を参照。

- バージョンは CI が main への push ごとに自動で patch +1 する。**手動で `package.json` を書き換えない。**
- 作業中は `## 未リリース` に1行ずつ追記する。
- main にマージ(= デプロイ)する直前に `## 未リリース` を、次にデプロイされる版
  (`= package.json の version の patch +1`)でラベル付けし、新しい空の `## 未リリース` を上に作る。
- 書式: `- <種別>: <何を・なぜ>`(種別 = `feat` / `fix` / `refactor` / `style` / `docs` / `chore`)。
  触ったファイル名や関連コミットIDを括弧で添えると後追いが速い。

---

## 未リリース

<!-- ここに編集内容を1行ずつ追記する。例:
- fix: 〇〇の不具合を修正(src/...・関連コミット xxxxxxx)
-->

## v1.5.361

- style: 生徒名の赤文字ハイライトを「出席不可コマに配置された生徒」のみに限定(制約違反/講師なし/手動追加等の他警告はセル背景=黄とツールチップのみで示し名前は赤くしない・講師名は従来から出席不可のみで変更なし・ツールチップは不変)。名前の赤文字判定を純関数 `shouldHighlightStudentName` に集約し回帰テスト追加(src/components/schedule-board/BoardGrid.tsx・ScheduleBoardScreen.tsx・types.ts)

## v1.5.360 (2026-06-30)

- feat: 生徒日程表の登録ダイアログと QR 提出画面の「集団授業(集団理科/集団社会)」の選択肢を、その講習の期間内に**少なくとも1回その集団科目がコマ表(盤面)に登録されているときだけ**表示するよう変更(オーナー要望 2026-06-30)。集団授業を設定しない講習では集団欄を一切出さない(中3でも)。盤面の集団科目を canonical 順で抽出する純関数 `resolveRegisteredGroupClassSubjects` を新設(src/components/schedule-board/groupClass.ts)。App.tsx は QR 提出ドキュメントの `availableGroupClassSubjects`(新規発行・既配布の後埋め)をこの結果に限定。生徒日程表は scheduleHtml 埋め込みJSに `getGroupClassSubjectsInRange` を追加し登録ダイアログの集団欄を出し分け。既提出データ・提出状況は不変。回帰防止テスト6件追加(groupClass.test.ts: 未登録=空/盤面登録科目のみ/canonical順/重複排除/期間外除外/境界日含む)。

## v1.5.359 (2026-06-30)

- feat: コマ表盤面・テンプレの講師名選択肢から、同じコマ(同セル)の他机に既に割り振られている講師を除外(オーナー要望 2026-06-30)。1人の講師が同コマで複数の机を担当することはできないため、選択肢に出さないことで二重配置を未然に防ぐ。編集中の机自身の講師(currentTeacher)は除外しない。`buildTeacherSelectionOptions` 内で同セルの他机の `teacherAssignmentTeacherId`/`teacher`(名)を集めて除外集合を作り、id 一致・表示名一致の双方で判定。盤面/テンプレ両モードの3呼び出し元すべてに共通適用(src/components/schedule-board/ScheduleBoardScreen.tsx)。回帰防止テスト: 他机講師の除外/現在机の講師は残す/id一致での除外/テンプレモードでの除外、の4件に更新・追加。

## v1.5.358 (2026-06-30)

- fix: 講師日程表で授業コマ(週グリッド)が縦に長く、画面/印刷で下部が見切れてスクロールしないと全体が見えない講師ページを A3 縦へ自動切替するよう修正。従来の A3 自動切替は給与計算スクロール枠(`.salary-scroll`)のはみ出しだけを検知しており、グリッド自体が長くてシート本体(`.sheet` は overflow:hidden + A4横アスペクト比固定)からはみ出すケースを拾えていなかった。`applySalaryOverflowPaging` でシート全体のはみ出し量 `sheet.scrollHeight - sheet.clientHeight` も計測し、判定を純関数 `shouldTeacherSheetUseA3(salaryHidden, sheetOverflow)` に切り出し(給与 >2px か シート >4px で A3)。A3縦は幅がA4横と同じ297mmなので週グリッドの横レイアウトは保ったまま縦に伸ばして全コマ+給与を1ページに収める。回帰防止テストとして出荷スクリプトから純関数を `new Function` 抽出し挙動を固定(src/utils/scheduleHtml.ts)。

## v1.5.357 (2026-06-30)

- fix: 講師がQRで提出した出席可否が「開いても反映されない/リロードしても戻らない/講師日程表から登録し直さないと出ない」不具合を修正(v1.5.356 の取りこぼし修正とは別の根本原因)。真因は保存タイミングの非対称: `countSubmitted`(提出反映フラグ=specialSessions)は手動保存なしでも workspace 自動同期で永続化される一方、盤面への講師配置(weeks)は手動保存のみ。よって手動保存前にリロードすると配置だけ揮発し、以後は取り込みの `countSubmitted` ガード(App.tsx onSubmitted 3742)でスキップされ二度と自動配置されずスタックしていた。対策として起動(マウント=教室ロード/リロード毎に boardMountKey で再マウント)時に「提出済みなのに盤面に居ない講師」を自己修復する純関数 `reconcileSubmittedTeacherPlacements` を追加(未配置の講師だけ冪等に配置・既に一部でも schedule-registration 配置済みの講師は触らず室長の手動調整/部分削除を尊重)。回帰防止テスト3件追加(未配置→配置/配置済みは不変/未提出は対象外)。あわせて自動配置はスロットごと独立で、満席の4限が空きの1限をスキップさせない挙動も確認済み。src/components/schedule-board/ScheduleBoardScreen.tsx。

## v1.5.356 (2026-06-30)

- fix: 講師がQRで出席不可コマを提出しても出席可能コマに名前が追加されない不具合を修正。原因は QR一括取り込み(`subscribeLectureSubmissions` onSubmitted)で講師ごとに `setTeacherAutoAssignRequest` をループ発行していたが、リクエストが単一 `useState` のため同一スナップショットで複数講師が届くと最後の1人ぶんしか盤面配置されなかった(室長が起動/リロードした初回スナップショットで複数講師の提出が一括到着する経路で再発しやすい)。`TeacherAutoAssignRequest` を `items[]` 化し全講師を1リクエストにまとめ、受け手 `ScheduleBoardScreen` の `applyTeacherAutoAssignRequest`(新規・純関数)で全件を weeks へ畳み込む。回帰防止テスト追加(`buildTeacherAutoAssignItems`=全講師ぶん生成 / `applyTeacherAutoAssignRequest`=2講師とも配置)。src/App.tsx・src/components/schedule-board/ScheduleBoardScreen.tsx。

- chore(test): Playwright E2E を廃止(全挙動をユニットへ移植完了)。`tests/`・playwright 各 config・`@playwright/test`・`test:e2e*` スクリプトを削除。`ci-tests.yml` は e2e ジョブ2つを削除し手動 `rules` ジョブを追加。CLAUDE.md/dev-fix/safe-release/release-checklist/.vscode を新方針へ更新。lint の未使用 import(rules テストの expect)も修正。自動テストは ユニット425件(毎push)＋ルール13件(手動)。方針は docs/test-strategy.md。
- refactor(test): E2E廃止の前提整備(層1残り)。盤面の警告評価を純粋関数へ挙動不変で抽出しユニット化(+15)。科目対応外(`canTeacherHandleStudentSubject` を export・35) / 一コマ空け等の授業パターン(`resolveLessonPatternWarnings`・36,37) / 講習絶対制約(`isLectureOutsideSessionPeriod`・55, `isStudentUnavailableAtSlot`・56)。これでE2Eが唯一カバーしていた警告表示もユニットで担保。全425テスト＋build 緑。

## v1.5.351 (2026-06-29)

- test(rules): E2E廃止の代替・層2。Firestore セキュリティルールの分離テストを追加(`firebase/rules/firestore.rules.test.ts`・13件・`npm run test:rules` でエミュレータ実行)。教室アクセス分離(担当外教室は読めない)/保存の裏口防止(マネージャーは classroomSnapshots 直書き不可=CF経由のみ)/members 権限保護/billing限定を検証。毎push の `test:unit` には含めず(エミュレータ不要のまま)。`@firebase/rules-unit-testing` 導入。

## v1.5.350 (2026-06-29)

- refactor(test): E2E廃止方針に伴い、生徒移動ロジックを純粋関数 `computeStudentMove` へ挙動不変で抽出(executeMoveStudent は委譲)。盤面移動のE2Eシナリオ(基本移動/講師保持/同日・別日移動/同コマ重複ブロック/同一位置/滞留ステータス除去/入れ替え)をユニット化(+7)。全410テスト＋build 緑。方針と移植マップは docs/test-strategy.md。

## v1.5.349 (2026-06-29)

- fix(コマ表): 生徒を移動して移動元の机が0人(レッスン無し)になっても講師名を保持するようにした。executeMoveStudent で空になった移動元机を manualTeacher 扱いに固定し、commit 後の managed 再マージ(mergeManagedWeek の自動割当講師クリア分岐, ScheduleBoardScreen.tsx 2467行付近)で講師名が消えないようにする。入れ替え(swap)は移動元に相手生徒が入り対象外。回帰防止テスト追加(ScheduleBoardScreen.test.ts)。staging(隔離開発環境テスト教室)で同日・別机/別日の移動を実機確認し、移動元の講師(斎藤/山崎)が残ることを確認済み。

## v1.5.348 (2026-06-29)

- docs(運用): triage エージェント(.claude/agents/triage.md)に「着手前に必ず曖昧点・未言及の影響点を質問で返す」手順を追加。対象/再現条件/期待挙動の曖昧さに加え、他機能・他教室・保存/QR/自動割振への波及、過去修正の巻き戻し、データ影響、仕様の例外ケースを能動的に点検し、少しでも不明なら AskUserQuestion 等で確認してから起票/着手する。任せる旨の明言時は採用前提を Issue に明記。
## v1.5.347 (2026-06-29)

- docs(監視): docs/runbooks/monitoring.md に UptimeRobot による5分間隔の外部監視セットアップ手順(オーナー作業)を追記。GitHub Actions の15分外形監視と二段構えにする。
- docs(e2e): e2e #35 の調査結果を Issue に記録。失敗は emulator e2e は解消済みで local e2e のみ、根因は(1)削除済み機能(休み欄 v1.5.334)を検証する stale テスト群と(2)headless クリーン状態での前提崩れ。安易に緩めず現行仕様に合わせた更新が必要(別タスク)。
## v1.5.346 (2026-06-29) — lint 負債解消(挙動中立)

- chore(lint): lint エラー96→0(挙動中立)。eslint.config.js で react-refresh/only-export-components を warn 化(開発時専用・実行時影響なし)、no-unused-vars に `^_` 無視を追加(既存の意図的未使用規約を尊重)。地雷の scheduleHtml.ts は no-useless-escape をファイル単位 disable(埋め込みスクリプトのエスケープは意図的・memory 参照で変更厳禁)、gmail/drafts.ts の no-control-regex は意図的 disable。App.tsx/BasicDataScreen.tsx の react-hooks/refs は「最新値を ref に同期」する定番イディオムのため個別 disable。ScheduleBoardScreen.tsx の prefer-const×2、functions の未使用型4件(コンパイル出力不変)、テストの未使用識別子(`_`化)/any→unknown を整理。CI(ci-tests.yml)の lint をブロッキング化し再発防止。unit402/前後build/functions build 緑。
## v1.5.345 (2026-06-29) — Phase3/4: ロールバック手順＋外形監視(アプリ挙動の変更なし)

- docs(運用基盤/Phase3): ロールバック手順書 docs/runbooks/rollback.md(症状別 A=Hosting/B=Functions/C=データ復元・クロス汚染注意)を追加。リリースチェックリストを PR テンプレ(.github/PULL_REQUEST_TEMPLATE.md)に組み込み運用開始。safe-release スキル・CLAUDE.md から参照。
- chore(運用基盤/Phase4): 外形監視を追加。tools/uptime-check.mjs ＋ .github/workflows/uptime-check.yml(15分ごと＋手動)が本番の index/version.json/QR API を確認し、異常時は incident:uptime ラベルの Issue を自動起票(復旧で自動クローズ)＋ワークフロー赤で通知。手順 docs/runbooks/monitoring.md(GitHub スケジュールの限界と UptimeRobot/Cloud Monitoring 併用の推奨も記載)。

## v1.5.344 (2026-06-29) — 保守運営の体制づくり(アプリ挙動の変更なし・運用基盤のみ)

### Phase 1: 役割・課題管理・テストゲート
- chore(運用基盤): 役割エージェント3体(.claude/agents/ の triage / dev-fix / regression-reviewer)を追加。曖昧な報告の整理→修正→回帰検査を分担。
- chore(運用基盤): スキルを追加(regression-guard=回帰防止の実務版 / bug-triage=報告のIssue一本化 / staging-environment=検証環境の使い方)。CLAUDE.md に体制の節を追加。
- chore(運用基盤): GitHub Issue テンプレ(.github/ISSUE_TEMPLATE/ bug_report・feature_request・config)とラベル体系(type/severity/area/status 計15個)を整備。
- chore(CI): テストゲート .github/workflows/ci-tests.yml を追加。push/PR ごとに必須ゲートとして unit(vitest 402件)＋build を実行(約1分・決定的)。lint は既存負債96件のため continue-on-error の参考表示。Playwright e2e(local/Firebaseエミュレータ)は headless CI で18件不安定・18分かかるため workflow_dispatch の手動のみに分離(安定化は Issue #35)。emulator は firebase-tools 要件で Java21。

### Phase 2: 専用 staging 環境(komahyouapp-staging)
- chore(運用基盤): 本番(komahyouapp-prod)と分離した検証用 Firebase プロジェクト komahyouapp-staging を導入。書き込み自由な実機検証環境。.firebaserc に staging エイリアス、オーナー作業手順書 docs/runbooks/staging-setup.md。
- chore(staging): 手動デプロイ CI .github/workflows/deploy-staging.yml。hosting と functions を別ステップに分離(gen2 の 409 が hosting release を巻き込む「Site Not Found」回避)、hosting の「is the current active version」400 を本番同様 benign 成功扱い、functions に STORAGE_BUCKET 注入(本番バケットへのクロス汚染防止)、Java21、gen2 functions に allUsers→run.invoker 付与(本番同等の公開呼び出し=保存/QR の 403 解消・認証は関数内で検証)。
- chore(staging): 検証用の教室ブートストラップ/シード(講師40・生徒150・通常授業240)スクリプト+CI(.github/workflows/staging-bootstrap.yml・staging-seed.yml、functions/scripts/、projectId!=staging なら中断の本番保護)。
- chore(CI): deploy-functions.yml の paths に !functions/scripts/** を追加(staging 専用スクリプトで本番 functions が誤って再デプロイされないように)。
- docs(運用基盤): safe-release スキル(.claude/skills/safe-release)とリリース前チェックリスト(docs/runbooks/release-checklist.md)を追加。staging 実機検証→本番→ライブ検証→ロールバックの流れを制度化。CLAUDE.md から参照。

## v1.5.343 (2026-06-29)

- feat(生徒日程表): 講習の登録ダイアログでも、QRと同じように科目ごとの授業時間(90/60/45分)を選択できるようにした。各科目の希望数の隣に授業時間プルダウンを追加(90=既定、60/45のみ保持)。登録すると subjectDurations として保存され、回数表/講習ストックの授業時間表示(60/45サフィックス)に反映。登録済みは「2 (60分)」のように読み取り表示。通常のみONでプルダウンも無効化。既存のQR提出値は未送信時に保全(消さない)。回帰防止: schedule-student-count-save ハンドラが従来 subjectDurations をメッセージから反映せず既存保全のみだった点を修正し、配線文字列の存在テストを追加(src/utils/scheduleHtml.ts・src/App.tsx・scheduleHtml.test.ts)

## v1.5.342 (2026-06-28)

- fix(盤面): 自動割振ルール「指定時限禁止」の制約違反で、固定の通常授業まで生徒名が赤文字になっていた不具合を修正。「通常講師のみ」と同様、通常授業(lessonType==='regular')は割振り対象でないため違反扱いしない。判定を純粋関数 shouldWarnForbiddenPeriod に切り出し回帰防止テストを追加(src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts)
- fix(生徒日程表): 講習自動割振の後、開いていた生徒日程表タブで「最新表示」を押しても割り振った講習が反映されない(タブを閉じて開き直すと反映される)不具合に対処。「最新表示」は popup→opener の postMessage 往復に依存して取りこぼし/競合が起きうるため、自動割振の確定後に board→popup 方向で日程表popupを1回だけ能動再同期するトリガを追加(往復に依存せず盤面内容と揃える。popup 未表示時は no-op / src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.341 (2026-06-28)

- feat(盤面): 長押しD&D移動中、盤面の端付近(上下左右)へポインタを寄せると盤面が自動スクロールするようにした(画面に表示されていない画面外のコマへも移動できる)。requestAnimationFrame で掴んでいる間だけ回し、端からの距離に応じて速度を可変(外側へ出るほど速い・上限あり)。state を毎フレーム更新せず scrollLeft/scrollTop を直接操作(再描画を増やさない / src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.340 (2026-06-28)

- fix(盤面): 長押しD&D移動中に他の生徒名の上を通ると文字選択(青いハイライト)になり見えづらかった不具合を修正。ドラッグ中の盤面に user-select:none を適用し、掴んだ瞬間に既存の選択を removeAllRanges でクリアするようにした(src/App.css・src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.339 (2026-06-28)

- fix(盤面): 長押しD&Dで生徒を離しても配置されず、再クリックが必要だった不具合を修正。原因はドロップ
  (mouseup)が mousedown 時点の古い executeMoveStudent クロージャ(selectedStudentId=null)を呼んでいたため。
  executeMoveStudent に掴んでいる生徒IDを明示で渡せるようにし、ドロップは安定ラッパ経由で最新クロージャを
  実行するよう変更。離した瞬間に配置が確定する。配置できないコマ(メモ/出席済み/重複等)へ離した場合は選択を
  解除してキャンセル扱いにする(再クリックで配置を残さない / src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.338 (2026-06-28)

- feat: 生徒名の長押しD&D移動を全教室へ展開(featureRollout の studentDragAndDropMove を development-only → all-classrooms。オーナー指示 2026-06-28・回帰テスト更新 / src/utils/featureRollout.ts)
- style: 長押しD&D移動中の画面周囲の青枠を点滅(パルス)させず、移動中ずっと一定で表示し続けるよう変更(src/App.css)

## v1.5.337 (2026-06-28)

- feat: ライブ盤面で生徒名を長押し(約250ms)してから別の机コマへドラッグ&ドロップで移動できる機能を追加(PC マウス専用・開発用教室限定で先行有効)。実移動は既存 executeMoveStudent を再利用し入れ替え/メモ/出席済み/重複/同位置などのブロックを踏襲。移動中は画面周囲に色枠を表示、移動先は純CSS :hover で強調(毎フレーム再描画を増やさない設計)。出席済み生徒はドラッグ不可、Esc/盤面外ドロップでキャンセル(src/components/schedule-board/BoardGrid.tsx, ScheduleBoardScreen.tsx, src/App.css, src/utils/featureRollout.ts)

## v1.5.336 (2026-06-27)

- fix(集団授業): 登録済み中3の集団参加(集団理科/集団社会)・オプションが、起動直後の購読反映で
  一括消失する回帰を恒久修正(本番データ消失。緑が丘5名・日大前2名が同一時刻に {} へ消失を確認)。
  原因は `reflectParentOwnedSubmissionFields`(src/utils/submissionReflection.ts)が空の提出ドキュメント
  ({}・v1.5.335 以前に室長登録した中3の doc は空のまま)で登録済みローカル値を上書き消失させていたため
  (購読 entry は常に `?? {}` で届くので `entry ?? existing` の保全が効かない)。反映を **union(追加のみ・
  削減しない)** に変更し、空 doc が既存を消さないようにした。この経路は countSubmitted=true(提出ロック済み)
  の生徒にだけ走るため保護者が QR で外すことはなく union で安全。これにより v1.5.335 以前の空 doc も
  再登録不要で自己修復する(次回読込で消えなくなる)。回帰防止テスト追加(submissionReflection.test.ts)。

## v1.5.335 (2026-06-27)

- fix(集団授業): 生徒日程表で室長が手動で集団参加をチェックして登録しても「最新表示」/再読込で
  集団参加が消える回帰を修正。原因は登録時に提出ドキュメント(lectureSubmissions)へ集団参加/オプションを
  書き戻しておらず、doc が空のまま購読の反映(doc→ローカル: reflectParentOwnedSubmissionFields)が
  室長の手動設定を空で上書きしていたため(登録解除→登録の経路では doc が空に戻るため特に再発)。
  `markLectureSubmissionDocAsSubmitted` に集団参加/オプションの書き戻しを追加し、生徒 count-save 経路で
  最新ローカル値を渡すよう変更。回帰防止テストを追加
  (src/integrations/firebase/lectureSubmission.ts・src/App.tsx・lectureSubmission.test.ts)。
  ※既に登録済みで集団参加が消えてしまった中3は、一度「登録解除」してから集団をチェックして再登録すると恒久反映される。

## v1.5.334 (2026-06-27)

- feat(生徒日程表): オプション欄機能(休み欄を削除し振替を左詰め＋2列5行のオプション欄/QR提出のチェック
  往復)を開発用教室限定から全教室へ公開。featureRollout の studentScheduleOptionField を
  development-only → all-classrooms に変更し、回帰防止テストを追加(オーナー指示 2026-06-27 /
  src/utils/featureRollout.ts)
  ※「未消化振替も同時に自動割り当て」は v1.5.331 で既に全教室公開済みのため追加変更なし。

## v1.5.333 (2026-06-27)

- style(QR提出ページ): Android の表示補正をオーナー指示で iOS と同じ 幅520+zoom0.7 に変更。ただし
  「出席不可コマの表は現状の全幅のまま」の要望に合わせ、Android のときだけ表(.sub-table-wrap)へ
  逆ズーム(1/zoom)を当てて全幅へ戻す(見出し/科目数/ボタン等の固定pxだけ 0.7 で縮む。iOS は従来どおり
  表も 0.7 のまま)。ネスト zoom+vw の挙動はブラウザ実測で全幅維持を確認
  (src/components/submission/iosViewport.ts・SubmissionPage.tsx)

## v1.5.332 (2026-06-27)

- style(生徒日程表): 振替欄が枠に収まらない問題に対応し、年と曜日を省いて月日+限だけに詰めて表示
  (compactMakeupSourceLabel/compactMakeupDateSlot 追加・講師日程表の振替欄も同様・埋め込みスクリプトの
  正規表現は二重エスケープ必須・回帰テスト追加 / src/utils/scheduleHtml.ts)
- style(QR提出ページ): オプション欄のチェック右の「なし/あり」テキストを削除(編集画面のみ。提出済み閲覧は
  状態表示として維持 / src/components/submission/SubmissionPage.tsx)
- fix(QR提出ページ): Android のボタン/文字が大きすぎる問題に対応。iOS と同じビューポート幅補正方式で
  Android も一様縮小(既定 ANDROID_VIEWPORT_WIDTH=480・vw化の撤回 c4563f6 を踏襲し固定px維持)。
  実機調整用に #/submit-debug をプラットフォーム判別対応にし Android 値も調整・表示
  (src/components/submission/iosViewport.ts・SubmissionPage.tsx・main.tsx)

## v1.5.331 (2026-06-27)

- feat: 未消化講習の自動割振モーダルに「未消化振替も同時に自動割り当てする」チェックボックス(既定OFF)を追加。ONにすると講習を全配置した後、同じ生徒の未消化振替を講習期間内の空きコマへ「振るい順(古い振替元から)」で同一規則で割り振る(src/components/schedule-board/ScheduleBoardScreen.tsx)。開発用教室で実機検証済み
- refactor: 講習・振替の自動割振候補探索を共有コア `findBestAutoAssignCandidate` に統一(規則ロジックの二重管理=ドリフトを防止)。講習側の出力スコアは従来と完全一致(回帰防止)
- test: `buildMakeupAutoAssignPendingItems`(振るい順展開・balance厳守)の単体テストを追加(src/components/schedule-board/ScheduleBoardScreen.test.ts)

## v1.5.330 (2026-06-27)

- docs: 更新リスト `CHANGELOG.md` を新規導入(編集ごとの記録ルールを明文化)
- docs: solo-git-workflow スキルに「編集前のデプロイ済み最新との同期確認」と「更新リスト記載義務」「コミット〜main マージの常時許可」を追記
- docs: CLAUDE.md に上記必須手順へのポインタを追加

---

> これ以前の履歴は git log の `chore(release): vX.Y.Z` コミットを参照
> (CHANGELOG 導入時点のデプロイ済み最新は v1.5.329)。
