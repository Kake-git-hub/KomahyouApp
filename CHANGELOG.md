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

## v1.5.434

- feat: 管理データ画面の在籍表示を入塾日不問へ変更(オーナー指示)。入塾日が未来でも在籍として名簿に出し、退塾日は当日在籍・翌日以降を非在籍に。高3卒業は卒業日(翌3/31)を退塾日として自動補完して非在籍表示。盤面/請求/日程表の共有判定(isActiveOnDate/resolveScheduledStatus)は従来どおり入塾日前・卒業で非在籍のまま(この画面限定)。新設 resolveManagedRosterStatus/resolveEffectiveManagedWithdrawDate/resolveManagedStudentGradeLabel/compareManagedStudentsByGradeThenName(src/components/basic-data/basicDataModel.ts・BasicDataScreen.tsx)＋回帰テスト7件(管理挙動・共有isActiveOnDateロック含む)・spec-basic-data.md 更新

## v1.5.433 (2026-07-10)

- feat: 基本データの生徒/講師削除に確認モーダルを追加(window.confirm 廃止)。不可逆である旨・データを残すなら退塾日で非表示にできる案内・未消化の講習/振替が残る生徒への警告・本番はログインアカウントのパスワード再認証を要求(src/components/basic-data/BasicDataScreen.tsx・deleteGuard.ts)。富樫兄弟(講習提出済み)の誤削除で講習一覧に生ID表示された事象の再発防止。
- feat: 盤面(ScheduleBoardScreen)が未消化の講習/振替残数を生徒ID単位で親へ通知し、削除警告に利用(onDeletionStockSummaryChange・App.tsx)。
- test: 削除ガードの純ロジックに回帰テストを追加(deleteGuard.test.ts・講習のみ/両方/なし/講師除外/名前フォールバック)。

## v1.5.432 (2026-07-10)

- docs(保守体制にオーナー要望3点を明文化・オーナー指示 2026-07-10): ①**隔離開発環境(staging)と本番の版を常に一致** — どちらでも動作確認するため。常時CI自動追従はせず「staging で新機能の実装・検証を始める直前に最新 main を Deploy to Staging で反映し両 version.json を揃える」オンデマンド同期を採用(CLAUDE.md staging 項・staging-environment スキルに手順追加・safe-release 手順3/チェックリストに版一致項目追加)。②**モデルのコスト使い分けを再確認** — 複雑作業・構想・原因特定・仕様策定・レビュー=高コスト上位モデル/確立した単純作業=安い下位モデル。主セッションの Agent 起動・Workflow の agent() の model 選択にも適用する旨を「モデル割当方針」冒頭に大原則として明記。③**ユーザビリティ影響の機能要望は実装前に懸案+妥協案を提示して合意** — 標準フロー step2 と spec-curator エージェント(手順5・アウトプット形式)に妥協案ゲートを追加。合意前に dev-fix へ渡さない(CLAUDE.md・.claude/skills/{safe-release,staging-environment}・.claude/agents/spec-curator.md)

## v1.5.431 (2026-07-10)

- fix(サーバーバックアップの Google Drive 自動同期がCIデプロイで無効化される事故の恒久対策): `functions/.env`(Google Drive OAuth 一式)は .gitignore 済みで CI のチェックアウトに含まれないのに、本番 `deploy-functions.yml` には staging のような env 書き込みステップが無かったため、CI経由で functions をデプロイするたびに `GOOGLE_DRIVE_BACKUP_FOLDER_ID` 等が空になり `isGoogleDriveBackupConfigured()` が false となって Drive 同期が黙って停止していた(2026-07-10 のバックアップ再設計で初めてCI経由デプロイして顕在化)。deploy-functions.yml に「Write functions env for production」ステップを追加し、GitHub シークレット `PROD_FUNCTIONS_ENV`(ローカル functions/.env と同内容)を `functions/.env.komahyouapp-prod` へ書き出して runtime env に焼き込むようにした。**シークレット `PROD_FUNCTIONS_ENV` の登録が必要**(.github/workflows/deploy-functions.yml)
- feat(自動バックアップ: 早朝の静音時間帯をスキップして取得回数を抑制・オーナー確定 2026-07-10): 15分毎バックアップのうち JST 3:15〜8:45(ユーザーが操作しない早朝)は生成をスキップし、9:00 から通常の15分刻みへ復帰する。ただし 72時間〜7日帯の日次保持アンカーである **AM3:00 の1本だけは静音帯でも取得**する(取らないと3〜7日前の日次バックアップが存在しなくなるため)。純関数 `isWorkspaceAutoBackupSkippedAt` をスケジュール関数側で判定(手動「今すぐバックアップ」は対象外)。回帰テスト7件を同コミットで追加(functions/src/workspaceBackupSchedule.ts(+test)・functions/src/index.ts・src/components/developer-admin/DeveloperAdminScreen.tsx)
- fix(生徒日程表コマ組みの机選択モーダル: ブラウザ拡大時に画面からはみ出す): コマ組み(別タブD&D)で移動先を選ぶ「机選択モーダル」を、日程表をブラウザ拡大していても画面いっぱいに収まるよう修正。原因は2点 — (1) `.desk-picker-modal` の `transform-origin` が `center top` で、机数が多く縦長になると flex 中央寄せでボックス上端が画面外に出た状態から上基点で縮むため上端が切れていた → `center center` に変更し中央基点で確実に画面内へ収める。(2) 縮小率計算が高さのみで幅を見ておらず、ブラウザ拡大で viewport の CSS px が縮むと固定px寸法の盤面が横にもはみ出していた → `computeDeskPickerFitScale` を高さ・幅の両方で判定し厳しい方の縮小率を採用(埋め込みJSミラーも同式に更新)。回帰テスト5件を同コミットで追加(src/utils/scheduleHtml.ts(+test))

## v1.5.429 (2026-07-10)

- feat(表示週選択を自作カレンダーへ差し替え: 月送りでは週を変えず日付タップでのみ確定・オーナー確定 2026-07-10): 盤面ツールバー「表示週を選択」のネイティブ日付ピッカー(`<input type="date">`)を廃止し、アプリ自作のカレンダーポップオーバーに差し替え。ネイティブは「月送り」と「日選択」をどちらも同じ change で通知し端末によっては blur も来ないため、月を送っただけで表示週が変わる/選んでも変わらない、をコード側で確実に分離できなかった(v1.5.427/428 の試行錯誤)。自作カレンダーは **‹ › の月送りは表示月(state)だけを変え週は一切変えず、日付ボタンのタップで初めて `onJumpToDate` を呼んで確定** する挙動を全端末で決定的に再現。今日/選択中の週/前後月をハイライト、外側クリック・Escape・「閉じる」で週を変えずに閉じる、「今日」ボタンで今日の週へ。表示計算(月曜始まり6週×7日の行列生成・月送り・週内判定・今日)は純関数 `weekJumpCalendar.ts` に切り出し回帰テスト9件を同コミットで追加。旧 `weekJumpPicker.ts`(＋test)は役目を終えたため削除(src/components/schedule-board/weekJumpCalendar.ts(+test)・src/components/schedule-board/BoardToolbar.tsx・src/App.css)

## v1.5.428 (2026-07-10)

- fix(表示週選択カレンダー: 日付を選んで確定した時に確実に切り替える・v1.5.427の追随修正・オーナー報告 2026-07-10): v1.5.427 で「blur / Enter で確定」にした結果、デスクトップ等のカレンダーは**日付をクリックしてもフォーカスが外れず(=blur が来ず)、選んでも表示週が切り替わらない**回帰が出た。プラットフォーム差(タブレットのホイール/カレンダーは操作途中に change 連発、デスクトップのカレンダークリックは blur なし)を吸収するため、確定トリガーを「**最後の change から約320msの静止＝日付を選び終えた**」とみなす方式へ変更。blur / Enter が来れば即確定(待ち時間ゼロ)、Escape は取り消し、アンマウント時はタイマー解除。純関数 `createWeekJumpPicker`(stage/commit/reset)はそのまま流用し、確定タイミングのみ component 側(`weekJumpCommitTimerRef`)で制御(src/components/schedule-board/BoardToolbar.tsx)

## v1.5.427 (2026-07-10)

- fix(盤面の表示週選択カレンダー: 日付を確定するまで表示週を変えない・オーナー依頼 2026-07-10): 「表示週を選択」のネイティブ日付ピッカー(`<input type="date">`)は、タブレット等でホイール/カレンダー操作中に `change` を発火させるため、以前は確定前に表示週が勝手に切り替わっていた。`change` では週を変えず「保留(stage)」のみ行い、ピッカーを閉じて確定した時(blur / Enter)に最後の値へジャンプする方式へ変更(Escape はキャンセルで保留破棄)。確定制御を純関数 `createWeekJumpPicker`(stage/commit/reset)に切り出し、controlled(`value`)だと保留中に値が戻ってしまうため uncontrolled(`defaultValue`＋`key={weekStartDate}`)にして週変更時のみ再同期。回帰防止テスト: stage だけでは commit まで値を返さない/commit は最後の値を一度だけ返す(多重ジャンプ防止)/空値・reset は null、を新規追加(src/components/schedule-board/weekJumpPicker.ts(+test)・src/components/schedule-board/BoardToolbar.tsx)

## v1.5.426 (2026-07-10)

- refactor(ワークスペース自動バックアップの間引き方式へ再設計・オーナー確定 2026-07-10): 生成スケジュールを15分毎(`*/15 * * * *`)の1本に一本化し、毎時生成(`createWorkspaceServerHourlyBackups`)・日次生成(`createWorkspaceServerAutoBackups`)の**Cloud Functionsを本番から削除**。保持はプルーン時の経過時間ベースの間引きで実現(新関数 `shouldKeepWorkspaceAutoBackup`: age<24h=全保持/24-72h=JST分00のみ/72h-7日=JST時03分00のみ/7日以上=削除)。Google Driveミラーも「15分毎はスキップ」を撤回し毎回アップロード、プルーンも同じ間引きルールへ統一(`shouldKeepGoogleDriveBackupFile`)。フロントのストレージ使用量見積り(`src/App.tsx`)も新方式の概算本数(96+48+4=148本)に合わせて修正し、旧実装が保持短縮(14日→7日、72h→48h)の反映漏れで古い数値のまま放置されていたバグも併せて修正。回帰防止テスト: `shouldKeepWorkspaceAutoBackup` の境界値(24h/72h/7日ちょうど・JSTオフセット跨ぎ含む)を新規追加(functions/src/workspaceBackupSchedule.ts(+test)・functions/src/index.ts・src/App.tsx・src/components/developer-admin/DeveloperAdminScreen.tsx)

## v1.5.425 (2026-07-09)

- feat(講習集計結果に提出日時・提出方法を表示＋講師日程にも集計結果ボタン・オーナー依頼 2026-07-09): 生徒の「講習集計結果」に「提出日時」(QR提出/室長登録の日時・JST `M/D HH:MM`)と「提出方法」(`QR提出`/`室長登録`・不明は `—`)の2列を追加。方法は最後の操作で決まる(保護者/講師のQR提出=`qr`、室長が日程表の登録操作で確定=`manual`)。搬送は4経路を揃える: (1)QR提出のFunctions側スナップショット統合(`lectureSubmissionApi`)に `submittedAt`/`submissionMethod:'qr'` を追加、(2)購読反映(`subscribeLectureSubmissions`/`SubmissionChangeEntry` に `submittedAt` を追加し `App.tsx` の新規反映で `qr` を付与)、(3)室長の代行登録(`schedule-student-count-save`/`schedule-teacher-count-save` で `manual`＋操作時刻、登録解除でクリア)、(4)payload serialize(`SerializedStudent/TeacherSpecialSessionInput` へ追加=欠落すると popup で全て `—` に化ける v1.5.400 と同型の非対称を回避)。**講師日程にも「講習集計結果」ボタンを新設**(`buildTeacherLectureSummaryHtml`)。講師版は希望科目列を出さない(No./講師名/登録状況/提出日時/提出方法の5列)。既存データ(未搬送)は `—` 表示・遡及バックフィルなし(本番書き込みを伴うため)。回帰テスト: `formatSubmissionDateTime`(JST・日付境界・不正)/`resolveSubmissionMethodLabel`(qr/manual/未登録/不明)/payload serialize(生徒・講師)/講師ボタン・列構成 を同コミットで追加(src/utils/scheduleHtml.ts(+test)・functions/src/index.ts・src/App.tsx・src/integrations/firebase/lectureSubmission.ts・src/components/special-data/specialSessionModel.ts・src/App.test.ts)

## v1.5.423 (2026-07-09)

- feat(講師D&Dを全教室へ展開・オーナー確定 2026-07-09): 講師の同コマ内D&D移動/入れ替え(`teacherDragAndDropMove`)の scope を `development-only` から `all-classrooms` へ昇格。開発用教室での実機検証OK。テスト更新: 全教室で有効(src/utils/featureRollout.ts(+test))
- style(掴み中のカーソルを grabbing に): 長押しD&D中(生徒/講師とも)、盤面全体のマウスカーソルを「掴んでいる手(grabbing)」にして掴んでいる最中であることを明示する。従来は生徒セル(`.sa-student`)だけに付いており講師ドラッグ時は既定カーソルのままだった。`.slot-adjust-grid-dragging` 配下全体へ `cursor: grabbing` を適用(src/App.css)

## v1.5.422 (2026-07-09)

- feat(盤面で講師を生徒のようにD&Dで移動/入れ替え・同一コマ限定・開発用教室先行): 講師名を長押し(約250ms)して掴み、同じコマ内の別の机へドラッグ&ドロップで移動できる。移動先が空き講師なら単純移動、講師がいれば2机の講師だけを入れ替える(生徒=lesson は動かさない)。別コマの講師セルへ離しても無効(同一コマ限定)。実移動は純関数 `computeTeacherMove`(机の「講師ブロック」6フィールドだけを入れ替え・lesson の無い机に残った講師は managed 再マージで消えないよう manualTeacher=true に固定=v1.5.349 の emptiedSourceDesk ガードと同型)に集約。UIは生徒D&D(`studentDragAndDropMove`)と同じ操作感で、独立した `teacherDragMoveRef`/`draggingTeacherLabel`/`suppressNextTeacherClickRef` を使い生徒ドラッグ状態と干渉させない。新フラグ `teacherDragAndDropMove` は scope=`development-only`(本番3教室は無効のまま・検証後に昇格予定)。回帰テスト: `computeTeacherMove` 5件＋フラグの development-only 1件を同コミットで追加(src/utils/featureRollout.ts(+test)・src/components/schedule-board/ScheduleBoardScreen.tsx(+test)・src/components/schedule-board/BoardGrid.tsx)

## v1.5.421 (2026-07-09)

- fix: 講師が盤面から削除操作なしに勝手に消える不具合を修正(緑が丘 8/4 講習で門田/角田等)。原因は `teacherAutoAssignRequest`(講師の自動配置/登録解除の一過性コマンド)が App 永続 state に載ったまま消費されず、盤面 key 再マウントで重複ガード(processedRef)が消えるたびに古い unassign(登録解除)が再発火して講師を再削除していた。Issue #46(studentScheduleRequest)と同型で、同じ規律=処理後に App 側 state を消費(null)＋判定を純関数化(`shouldProcessTeacherAutoAssignRequest`/`consumeTeacherAutoAssignRequest`)で修正。再マウント再発火の回帰テスト8件追加(src/App.tsx・src/components/schedule-board/ScheduleBoardScreen.tsx)

## v1.5.420 (2026-07-09)

- feat(講師選択セレクターに講習の出席可否記号・オーナー要望 2026-07-09・全教室): 盤面の講師選択セレクター(`<select>`)で、そのコマの日が講習期間内かつ講師が出席不可コマを提出済み(`countSubmitted`)のとき、講師名の横に **○=出席可能 / ×=出席不可** を付ける。未提出(teacherInputs 無し/`countSubmitted=false`)や講習期間外は記号なし。純関数 `resolveTeacherLectureSlotMark`(specialSessions から日付でセッションを引き、`teacherInputs[id].unavailableSlots` の有無で判定)を新設しユニットテスト4件を同コミットで追加。`value` は従来どおり `teacher.name` のままで保存/確定ロジックは不変(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))

## v1.5.419 (2026-07-09)

- feat(日程表コマ組みを全教室へ公開): 生徒日程表(別タブ)のコマ組みD&D(`studentScheduleDndMove`)と、その移動結果の即反映に必要な自動同期＋スピナー(`schedulePopupAutoSync`)の scope を `staging-environment` から `all-classrooms` へ昇格(オーナー確定 2026-07-09)。staging→本番の開発用教室で段階検証済み。2026-06-05 のポップアップ再生成メモリ障害はデバウンス+fingerprintスキップ+表示範囲限定で緩和済み。テスト更新: 両フラグが全教室で有効(src/utils/featureRollout.ts(+test))

- feat(自動バックアップ3階層化・オーナー確定 2026-07-09): ワークスペース自動バックアップを hourly(72h保持)+daily(14日保持) の2階層から、**15分毎(新規・保持24時間)+毎時(保持48時間に短縮)+日次(保持7日に短縮)** の3階層へ変更。純ロジック(日時キー生成・Storageパス・displayLabel・保持判定)を `functions/src/workspaceBackupSchedule.ts` へ抽出しユニットテスト化(`functions/src/workspaceBackupSchedule.test.ts`・13件)。15分tierはStorage+Firestore summaryのみでGoogle Driveミラーはスキップ(APIクォータ回避・保持定数は既存のDriveプルーンが自動追従)。ダウンロード解決経路(storagePath由来)は無変更。フロント型 `backupKind` を `'daily'|'hourly'|'quarterHourly'` へ拡張(src/integrations/firebase/adminFunctions.ts)。**次回プルーン実行時、既存の48時間超の毎時バックアップ・7日超の日次バックアップは仕様どおり削除される点に注意。**

## v1.5.417 (2026-07-09)

- feat(Phase C 本番展開ゲート): 日程表コマ組み(別タブD&D)を本番の**開発用教室のみ**へ展開(scope=staging-environment・本番3教室は無効)。加えて別タブ日程表の**自動同期(デバウンス)＋同期スピナー**も本番3教室では意図せず有効化されないよう新フラグ `schedulePopupAutoSync`(staging-environment)を追加してゲート。off の教室では自動同期effectを no-op にし従来どおり「最新表示ボタン/開いた時のみ更新」に保つ(2026-06-05 のポップアップ再生成メモリ障害と同種の負荷が本番大教室で未検証のため・オーナー確定 2026-07-09)。回帰テスト追加(src/utils/featureRollout.ts(+test) / src/components/schedule-board/ScheduleBoardScreen.tsx)
- fix(Phase C 出席済み席への配置ガード): 出席済みにした生徒は studentSlots から除去され statusSlots に退避される仕様上、`computeStudentMove` の出席ガードが `targetStudentBeforeMove &&` 条件で studentSlots 依存になっており出席席へ別生徒を配置・入れ替えできてしまう回帰を修正。statusSlots が `attended` なら studentSlots の有無に関わらずブロックするよう変更(欠席/振無休/移動済みは従来どおり配置可能な空席のまま)。机選択モーダル側(`buildDeskPickerDesks`)も出席席を `selectable:false` にし、埋め込みJS(`renderDeskPickerSeatCellHtml`)も非選択席を記録ラベル付きのブロック表示に変更。回帰テスト追加(src/components/schedule-board/ScheduleBoardScreen.tsx(+test)・src/components/schedule-view/scheduleViewMove.ts(+test)・src/utils/scheduleHtml.ts)
- fix(Phase C 日程表コマ組みの同期即時化・二重スピナー修正): 別タブでの生徒移動成立時、1.5秒の自動同期デバウンス任せだった別タブへの反映を短縮。当初は即時 `setScheduleSyncTrigger` を別途足したが、自動同期(デバウンス)effectと経路が二重化し「早期hide→再show」でスピナーが2回出る問題が判明。同期経路を自動同期effectに一本化し、移動時だけ次回1回のデバウンス遅延を0msにする方式(`scheduleSyncDelayRef`)に変更してスピナーを1回・最短に(src/components/schedule-board/ScheduleBoardScreen.tsx)

- fix(Phase C D&D対象拡大): 日程表コマ組み(別タブD&D)で増コマ(lessonType='extra')が掴めなかった問題を修正。prepareStudentForMove は regular/makeup 以外は単純な位置移動のみで既存の講習(special)と同じ経路のため副作用なし。buildLessonCardDragAttrs の対象種別に 'extra' を追加(spec-student-schedule-dnd.md も更新)。回帰テスト追加(src/utils/scheduleHtml.ts(+test))
- fix(Phase C 週自動拡張の上限): 日程表コマ組みD&Dで移動先が現在ロード済みの週から離れていると weeks state が無制限に肥大化し(cloneWeeks全週クローン+Undo履歴×最大10で増幅)後続操作が重くなる問題に対処。executeScheduleViewMove に上限8週間(56日)のガードを追加し、超える移動は ensureWeeksCoverDateRange を呼ばず不成立を返す(盤面自体の週送りには影響なし・スコープ限定)。純関数 checkScheduleViewMoveRangeWithinCap を export しユニットテスト化(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))
- refactor(ensureWeeksCoverDateRange 性能): 週の自動拡張ループが毎回 `[newWeek, ...nextWeeks]` / `[...nextWeeks, newWeek]` で配列全体をコピーしO(n^2)になっていたのを、前方/後方それぞれ一時配列に貯めてから最後に一度だけ結合するO(n)に最適化。生成される週の内容・順序・weekIndexOffsetは完全に不変(リファクタ前実装との出力一致をスタッシュ比較で確認済み)。回帰テスト追加(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))

- fix(Phase C 机選択モーダル 3): 机が多い/横向き画面で全机が縦スクロール必須になる問題を修正。`.desk-picker-modal` を `overflow:auto/max-height` から `overflow:visible`+`transform-origin:center top` に変更し、表示直後にモーダル実高さから `scale(k)`(k<=1)を算出して縮小適用し、全机を1画面に収める(横幅は `max-width:92vw` を維持)。純関数 `computeDeskPickerFitScale` を export しユニットテスト化(埋め込みJS側は同式のミラー)(src/utils/scheduleHtml.ts(+test))
- fix(Phase C 移動成立ハイライト): 移動成立時の黄色ハイライトが「同期中」スピナー表示中に始まり被って見えづらい問題を修正。成立通知は即ハイライトせず `pendingScheduleMoveHighlightKey` に保留し、`flushIncomingPayload` でスピナーを消した直後(250ms後)に開始する`promotePendingScheduleMoveHighlight`へ昇格。メッセージ到着順の保険として、既にスピナーが消えている場合は即昇格する(src/utils/scheduleHtml.ts)
- fix(Phase C 講習自動割振後の武装解除): 講習自動割振で割振りきれない残があると `selectedLectureStockKey` 等がセットされタップ配置モードに武装されてしまう挙動を廃止(オーナー確定 2026-07-09)。純関数 `resolvePostLectureAutoAssignView` を export し、割振り後は常に選択キーをクリアしたうえで、講習残があれば未消化講習一覧・講習ゼロで振替残があれば未消化振替一覧・両ゼロなら未消化講習一覧を開くだけにする。回帰テスト4件(src/components/schedule-board/ScheduleBoardScreen.tsx(+test))

- fix(Phase C 席の解決2): 「空き席なのに移動不可」の残存を根治。resolveScheduleViewTargetSeat の机特定を **deskId→机の在席者(deskOccupantEntryIds)→講師名→positional** に強化(日程表と盤面で机の並び/deskId が食い違っても、在席生徒で「その机」を一意特定)。空きも入れ替え対象も無いときは盤面の実際の席内容(席1=◯/席2=◯)を添えた診断メッセージを返す。回帰テスト: 在席者での机特定・診断(scheduleViewMove.ts(+test) / ScheduleBoardScreen.tsx)
- fix(Phase C×出席不可トグル): 掴めるカード(通/振/講)をタップすると出席不可トグルが効かない回帰を修正。D&Dの pointerdown が stopImmediatePropagation でトグルを潰していたため、長押し未満のタップ(pending→up)でカードでも `handleUnavailablePointerDown` を実行するようにした(カード全体が反応対象＝テキストの短い/余白の狭いコマでもトグル可)。staging のD&D有効時のみの回帰(本番は影響なし)。回帰テスト: タップ→トグルの配線(scheduleHtml.ts(+test))
- perf(Phase C×出席不可トグル): 出席不可コマの連続入力を妨げないよう、ポップアップ自身の操作(出席不可トグル)では「同期中」スピナーを抑制(この操作はローカル反映＋fingerprint スキップ済みでエコーに描画変化なし)。applyStudent/TeacherUnavailableSlots で suppress 窓(3秒)を張り、showScheduleSyncingOverlay で抑制。移動(反映待ち)は抑制を解除してスピナー表示。回帰テスト: 抑制の配線(scheduleHtml.ts(+test))

- fix(Phase C 席の解決): 別タブのコマ組みで「空き席なのに『すでに生徒がいます』で移動不可」を根治。日程表(overlay 済みセル)と盤面の生 weeks は机内の席(左右=studentSlots)の並びも食い違うことがあり、positional な studentIndex を鵜呑みにすると占有席を指していた。resolveScheduleViewTargetSeat で机は deskId→講師名、席は「入れ替え対象の在席生徒(occupantEntryId)/その机の実際の空き席」で解決してから配置するようにした(旧 resolveScheduleViewTargetDeskIndex を置換)。空きも入れ替え対象も無い場合は理由を出す。回帰テスト4件(scheduleViewMove.ts(+test) / ScheduleBoardScreen.tsx)
- feat(Phase C 入れ替え): 机選択モーダルで在席の生徒を選ぶと**盤面の入れ替えと同じ**挙動で交換できるようにした(オーナー要望)。在席セルをクリック可(橙ホバー・「入替」表示)にし、相手の entryId を送って computeStudentMove の入れ替え(相手を移動元へ振替で入れる)に乗せる。メモ席のみ選択不可。回帰テスト: 入れ替えの通し1件・席セルの入替属性(scheduleViewMove.ts(+test) / scheduleHtml.ts(+test))

- fix(Phase C 移動失敗の原因): 別タブのコマ組みで「本来移動できるはずが移動不可になる」ケースを修正。日程表(overlay 済みセル)と盤面の生 weeks は机の並び/本数が食い違うことがあり、モーダルの positional deskIndex が盤面の別の机(占有/存在せず)を指して弾かれていた。机選択モーダルに机同一性(deskId=盤面 desk.id・講師名)を持たせ、移動確定時に resolveScheduleViewTargetDeskIndex で deskId→講師名→positional の順に実机へ解決してから検証・移動する。回帰テスト3件(scheduleViewMove.ts(+test) / ScheduleBoardScreen.tsx)
- feat(Phase C 移動の結果表示): 盤面→別タブへ移動結果を ack 送信。成功=移動先コマを数秒(約4s)黄色ハイライト(自動同期の再描画をまたいで持続)。失敗=理由を最前面に大きく表示し「日程表に戻る」ボタンで閉じる(盤面は不変)。回帰テスト: 配線マーカー(scheduleHtml.ts(+test) / ScheduleBoardScreen.tsx)
- style(Phase C 机選択モーダル 2): 説明テキスト(タイトル/注記)を削除し、机列の左に時限列(rowspan)・一番上に日付行を追加して「盤面の一コマをそのまま切り取った」表にした(オーナー要望)。回帰テスト: 席セルの机同一性属性・日付/時限セルの配線(scheduleHtml.ts(+test))
- style(Phase C 机選択モーダル): 机一覧の形式を盤面と同じ「1コマを切り取った」表に変更(オーナー要望)。カード式(席を縦積み)をやめ、盤面の .slot-adjust-grid/sa-* に合わせた 1机=1行 [机番号][講師][席1][席2] のダーク罫線テーブルに。空席=クリック可td(青ホバー)・占有=非クリックtd(生徒名+科目)・メモ/休記録=淡色。回帰テスト: 席セルtd形式2件・盤面テーブルの配線マーカー(scheduleHtml.ts(+test))
- feat(Phase C 別タブD&D本体): 生徒日程表(別タブ・生成HTML)の授業カード長押しD&Dでコマ組み。通常/振替/講習カードを約250ms長押しで掴み→空きコマ(開校日・当該生徒が空き)へドラッグ(青枠ハイライト)→ドロップで机選択モーダル(移動先コマの全机=pickerDesks をコマ表と同配置で表示・空席のみ選択可・自動割振ルール/警告は無関係)→席確定で本体へ schedule-student-move-request 送信→盤面が executeScheduleViewMove で実移動→自動同期で別タブ更新。pointerdown は再描画に強い pagesElement 委譲で拾い、空きコマトグルより先に登録し掴めるカードのみ後続を止める。自動同期の再描画中はドラッグ/モーダルを破棄。scheduleDndEnabled(staging/開発用教室)時のみ有効。埋め込みJSのエスケープ罠に配慮(new Function 構文検証テストが番人)。回帰テスト: 掴めるカードのゲート/対象外種別/配線 3件(scheduleHtml.ts(+test))
- feat(Phase C 机レイアウト+ゲート): 日程表コマ組みの机選択モーダル用データとフィーチャーゲート。serializeCells に includeDeskPicker フラグを追加し、有効時は開校日コマに pickerDesks(空席の机も含む全机レイアウト=既存テスト済み buildDeskPickerDesks)を別途載せる(desks は空席の机を落とすので机選択に不足するため。印刷/講師/全員表示のペイロードは不変)。featureRollout に `studentScheduleDndMove`(staging-environment スコープ)を追加、盤面が生徒ペイロードに scheduleDndEnabled として渡す。回帰テスト: pickerDesks の載せ分け2件・featureRollout スコープ1件(scheduleHtml.ts(+test) / featureRollout.ts(+test) / ScheduleBoardScreen.tsx)
- feat(Phase C 土台): 日程表コマ組み(別タブD&D)の受け側配線。StudentScheduleRequest を discriminated union 化し `mode:'move'`(source/seat)を追加、App.tsx が別タブからの `schedule-student-move-request` を純関数 parseScheduleViewMoveMessage で厳密検証して一過性リクエスト化、盤面が executeScheduleViewMove で実移動する effect を追加(Issue #46 規律: 処理時に消費・weeks 未ロード時は待つ)。埋め込みJSのD&D UI・机選択モーダルは次コミット。回帰テスト: parseScheduleViewMoveMessage 6件(scheduleViewMove.ts(+test) / App.tsx / ScheduleBoardScreen.tsx)
- refactor: 対話用日程表の方針を「別タブ(生成HTML)に同期＋コマ組みを実装」へ回帰(オーナー確定 2026-07-08)。React ポップアウトは別ブラウザウィンドウへの portal で pointer 操作(D&D の drop)が確実に届かず・従来タブと操作感が変わるため棚上げ。scheduleReactViewEnabled を常時 false に(React ビュー・featureRollout は将来再検討用に温存)、日程表ボタンは従来の生成HTMLタブ(openStudentScheduleHtml/openTeacherScheduleHtml)を開く。(ScheduleBoardScreen.tsx)
- feat: 別タブ日程表への自動同期(デバウンス約1.5秒)。盤面編集を別タブへ自動反映する。編集ごとの即再生成は 2026-06-05 メモリ障害の温床のため、①デバウンスで連打を1回に集約 ②受信側(埋め込みJS)の buildPayloadFingerprint で等価ペイロードの再描画をスキップ ③表示範囲限定、の3点で防ぐ。ポップアップを開いている間だけ作動。「最新表示(期間・生徒適用)」ボタンは残す。staging で ?memlog=1 の heap 実測を行う。(ScheduleBoardScreen.tsx)
- feat: 別タブ日程表の「同期中」スピナー(オーナー指示 2026-07-08)。盤面編集→別タブ反映までの数秒、最前面に大きくスピナー＋「コマ表の最新を反映中…」を表示する。本体(盤面)が編集時に埋め込みJSの `__showScheduleSyncing()` を即時に呼び、同期ペイロード適用(flushIncomingPayload)で自動的に消える(等価ペイロードでも固着しないよう flush 末尾で必ず非表示＋8秒の保険タイマー)。ポップアップを開いた直後の初期表示ではスピナーを出さない。回帰テスト1件。(scheduleHtml.ts(+test) / ScheduleBoardScreen.tsx)

- feat: 対話用日程表のReact化 Phase 0+1(土台＋リアルタイム同期・staging先行)。盤面と同一Reactツリーの `ScheduleView`(ドック⇄ポップアウト切替・spec-schedule-interactive-view)を新設し、staging環境判定(`isStagingEnvironment`/`scheduleInteractiveReactView`・stagingと開発用教室のみ有効)で日程表ボタンの対話用途を差し替え。表示算出は生成HTMLと同じ `buildStudentPayload`/`buildTeacherPayload` を共有し、埋め込みJSの表示ロジックを `scheduleViewData.ts` へ純関数移植(等価性テスト同梱)。行は React.memo＋signature比較で変更行のみ再レンダー(メモリ規律・`bumpMemCounter('schedule-view-row-render')` 等で ?memlog=1 実測可)。絞り込みは即時適用(旧「最新表示」ボタン廃止・Reactビュー内のみ)。印刷/PDF(全員表示・空フォーマット)と旧同期機構(forceゲート/scheduleSyncTrigger)は無変更で温存。本番3教室は従来の生成HTMLタブのまま(オーナーチェック合格まで main へマージしない)。(src/utils/scheduleViewData.ts / src/components/schedule-view/* / featureRollout.ts / ScheduleBoardScreen.tsx / BoardToolbar.tsx)
- chore: ローカル検証用の launch 設定 `dev-local`(VITE_EXTERNAL_BACKEND_MODE=local・ポート5199)を追加。(.claude/launch.json)
- feat: 日程表コマ組み Phase 2(spec-student-schedule-dnd・staging先行)。生徒日程表(Reactビュー)の授業カード(通/振/講)を長押し(約250ms)D&D→空きコマへドロップ→机選択モーダル(コマ表と同じ机配置・物理的な空きのみ判定、自動割振ルール/警告は評価も表示もしない)→盤面の computeStudentMove を直接実行。通常授業は「移動先に振替manual追加＋移動元当該日の抑制」の両方(7/20事故の教訓)、講習は選択科目・授業時間維持(v1.5.364回帰なし)、週範囲は ensureWeeksCoverDateRange で自動拡張、source は entryId+生徒id+日付+時限で特定(取り違え防止)、Undoで1操作復元。未保存のローカル変更(手動保存で確定)。集団カード・出欠カードは掴めない。テスト8件同梱(scheduleViewMove.test.ts)。(schedule-view/scheduleViewMove.ts / ScheduleView.tsx / ScheduleSheet.tsx / ScheduleBoardScreen.tsx / scheduleViewData.ts)
- feat/fix: 対話用日程表のUX調整(オーナーstaging指摘・2026-07-08)。①対話は**別ウィンドウ(ポップアウト)既定**に変更しドック/トグルUIを撤去(ドックはポップアップブロック時のフォールバックのみ)。②ポップアウトの chrome バー(「生徒日程表」タイトル/ボタン)・D&Dヒントバーを撤去、ウィンドウは location/menubar/toolbar 無効のポップアップで開き document.title を空に(タブの about:blank/タイトルを抑制)。③日程表コマ組みの緑ハイライトを撤去し、盤面D&Dと同じ**画面周囲の青枠**＋ドロップ先コマの青枠ハイライト(直接DOM操作で行を再レンダーしない=メモリ規律)に変更。ドロップ判定を hover 追跡＋イベントの ownerDocument での elementFromPoint に堅牢化し**ポップアウトでも移動成立**。④ポップアウトは日程表シートが下まで収まるよう **zoom を自動調整**(fitToWindow)。⑤ポップアウトの **Ctrl+P は日程表だけを従来体裁で印刷**(子ウィンドウ専用の印刷CSSを注入・非対象パーツ非表示・A4横・fit zoom打ち消し)。印刷CSS回帰テスト＋行メモ化テスト更新。(schedule-view/ScheduleView.tsx / ScheduleSheet.tsx / ScheduleViewPanel.tsx / PopoutWindow.tsx / scheduleViewPrint.ts(+test) / scheduleView.css / ScheduleBoardScreen.tsx)
- fix: 対話用日程表のオーナー再指摘対応(2026-07-08)。①**ポップアウトでD&Dが効かない不具合を根治**: pointer 操作を document への addEventListener＋ownerDocument 依存から、カード要素の **React synthetic pointer events ＋ setPointerCapture** に変更し、hit-test は event.view.document(発生元ウィンドウ)で行う。dock/popout の両方で長押し→ドロップ→机選択→移動が成立(盤面側が誤って掴まれる副作用も解消)。②**別ウィンドウを最大化(画面いっぱい)で開く**(availWidth/Height で open＋moveTo/resizeTo)。③**印刷は A4横いっぱいの倍率**(余白3mm・シート291×204mm・aspect-ratio固定解除)。④**「印刷用全員表示」を直接呼び出しで動作**(postMessage 経由をやめ runOpenAllSchedule 直呼び)。⑤**空フォーマット印刷・講習集計結果ボタンを復活**(生成HTMLの生徒日程タブへ委譲・講習集計は講習期間が重なる時のみ表示)。⑥**生徒/講師セレクター右の「期間・◯反映」ボタンを復活**(旧「最新表示」相当のdraft＋apply。選択は反映を押すまで表示に効かない)。(schedule-view/ScheduleView.tsx / ScheduleSheet.tsx / PopoutWindow.tsx / scheduleViewPrint.ts(+test) / ScheduleBoardScreen.tsx)
## v1.5.416 (2026-07-09)

- fix: v1.5.415 のガードで開発用教室のQRが生徒/講師日程表に表示されなくなった回帰を修正。開発用教室の既発行トークンは全て「発行元教室タグ未設定」のためガードが一律に他教室由来とみなして除去していた。ensureScheduleSubmissionTokens で**開発用教室のみ**、自教室が発行したものでない(未タグ/他教室タグ)トークンを自教室タグ付きで**再発行**するようにした(applyIssuedSubmissionTokensToSessions に差し替え分岐・提出内容は保持)。再発行後は owned となりQRが復活し、かつ他教室トークンが残らないため混入も起きない。本番教室は素通し(既存・印刷配布済みトークンは不変)。
- feat: 日程表(別タブ)のタブ名に「開いている教室名」を表示、期間表示は廃止(取り違え防止・オーナー要望)。scheduleHtml に classroomName を渡し document.title を教室名ベースに変更(App.tsx / scheduleHtml.ts)。
- fix(混入監査): 開発用教室での登録/登録解除(markLectureSubmissionDocAsSubmitted / resetLectureSubmissionDoc)が、自教室発行でないトークンのドキュメント(=他教室=本番)へ書き込み得る残存経路にガードを追加(開発用のみ・所有トークンのみ書込)。他の書込経路(教室スナップショット保存=acting限定、occupiedSlots/集団同期=再発行後の所有トークンのみ)は問題なしを確認。
- test: 再発行差し替え・冪等性・タブ名・所有判定の回帰テストを追加(App.test.ts / scheduleHtml.test.ts / developmentClassroom.test.ts)。関連メモリ [[komahyou-dev-classroom-qr-token-contamination]]

## v1.5.415 (2026-07-09)

- fix: 開発用教室のQRテストが本番教室(日大前校)へ書き込まれる混入事故の恒久対策。開発用教室は他教室の生データをコピーしてテストするため、コピー元(本番)の提出トークンが残っていると日程表がそのQRを表示し、スキャンで本番へ誤書き込みする(2026-07-09 実発生・日大前校の複数生徒が誤登録)。対策: 提出トークンに発行元教室ID(`submissionTokenClassroomId`)を刻み(applyIssuedSubmissionTokensToSessions)、他教室→開発用コピー時に除去(buildDevelopmentClassroomCopyPayload)、**開発用教室でのみ**日程表へ渡す前に「自教室が発行したものでないトークン」を除去してQRを出せなくする(applyDevelopmentScheduleTokenGuard)。本番教室ではこのガードは一切走らず、既存・印刷配布済みトークンは不変。純関数化して回帰テスト追加(developmentClassroom.ts / App.tsx / specialSessionModel.ts)。関連メモリ [[komahyou-classroom-restore-cross-contamination]]

## v1.5.414 (2026-07-09)

- fix: 追加した科目「理社」がQR提出画面に出ない不具合を修正。availableSubjects はトークン発行時に提出ドキュメントへ凍結保存されるため、v1.5.413 以前に発行済みの生徒トークンには理社が伝播していなかった。既発行トークンの同期経路 `updateSubmissionOccupiedSlots` に availableSubjects の伝播を追加し、盤面更新のたびに最新の選択可能科目へ揃うようにした(提出済みドキュメントでも subjectSlots>0 の科目のみ表示するため害なし)。回帰テスト2件追加(lectureSubmission.ts・App.tsx)

## v1.5.413 (2026-07-09)

- feat: 小学生の科目に合体科目「理社」を追加(算国と同型・小学限定)。要望対応。1コマで理科+社会をまとめて扱う選択肢で、科目選択・体験授業・通常テンプレ・QR希望提出(getSelectableStudentSubjectsForGrade経由)・回数表(社の直後に表示)に反映。講師対応判定は理または社の担当で可。非小学に紛れた場合は理へ畳む。A4への影響: 回数表は理社の授業がある生徒のみ1行(理+社の2行を1行に統合する形で最悪行数は増えない・講習表はhideZeroZeroで0非表示)。回帰テスト追加(types.ts/studentGradeSubject.ts/scheduleHtml.ts/ScheduleBoardScreen.tsx/regularLessonTemplate.ts)

## v1.5.412 (2026-07-09)

- fix: `tools/copy-prod-classroom-to-staging.mjs` が無出力のまま止まって見える不具合を修正。`classroomSnapshots/{id}/saveAttempts`(保存の冪等性ログ・稼働中教室では数百〜数千件に達し得る)を削除・コピーの両方で丸ごとスキップするようにした(進捗ログも追加)。アプリ本体(デプロイ物)には影響しない開発ツールのみの変更(tools/copy-prod-classroom-to-staging.mjs)

## v1.5.411 (2026-07-08)

- fix: 生徒日程表の印刷で、講習回数の科目が多い生徒が A4横シート(height:190mm; overflow:hidden)の下端で見切れる不具合を修正。@media print 内で通常回数/講習回数表(.count-table)の行高を 22px→16px・縦paddingを詰めた(画面表示は22pxのまま)。回帰テスト同コミット追加(src/utils/scheduleHtml.ts・scheduleHtml.test.ts)

## v1.5.410 (2026-07-08)

- docs: 対話用日程表のReact化を土台に据える方針転換を確定(オーナー確定 2026-07-08。stagingでは生成HTMLタブを対話用途はReactビューに置換・印刷/PDFのHTML生成は残す)。同一Reactツリー化でリアルタイム同期は自動反映・日程表コマ組みはexecuteMoveStudent直呼びに単純化。ドック⇄ポップアウト(React portal→子ウィンドウ)トグルで両表示をstagingでユーザーが比較。新正本 docs/spec-schedule-interactive-view.md 追加、既存2仕様に§0(方式転換)追記、手順書をReact土台版(Phase0→1→2)に再構成、spec-index更新

## v1.5.409 (2026-07-08)

- docs: 機能2を「日程表コマ組み」と命名・自動割振ルール/警告をスコープ外に・両機能ともstaging先行オーナーチェック待ちへリリース方針変更(オーナー確定 2026-07-08。spec-student-schedule-dnd / spec-schedule-popup-realtime-sync / handoff-popup-sync-and-dnd / spec-index)
- chore: 本番教室→stagingのFirestoreコピースクリプトを追加(tools/copy-prod-classroom-to-staging.mjs。日大前の現状データをstagingテストデータ化するオーナー明示指示対応。本番=読み取りのみ/staging=書き込みのみのURLガード付き。実行はオーナーのターミナルから)

## v1.5.408 (2026-07-08)

- docs: 日程表同期+D&D仕様のギャップ精査追補(教室切替ガード・バージョンスキュー自己修復・机選択モーダルは物理空きのみ判定・週範囲拡張・操作ロック・Undo)と、手順書へテスト計画/デバッグ手順(?memlog計測手順)/本番エラーゼロチェックリストを追加(spec-*-realtime-sync / spec-student-schedule-dnd / handoff-popup-sync-and-dnd。コード変更なし)

## v1.5.407 (2026-07-08)

- docs: 日程表リアルタイム同期＋生徒日程表D&D移動の確定仕様と改修手順書を追加(オーナーQ&A 10問で要件確定。docs/spec-schedule-popup-realtime-sync.md / docs/spec-student-schedule-dnd.md / docs/handoff-popup-sync-and-dnd.md。spec-index の大方針6を正式上書き。コード変更なし)

## v1.5.406 (2026-07-07)

- fix: 登録解除→再登録→再割振後に画面遷移すると組み直した講習コマが消える回帰を修正(Issue #46)。一過性の unassign リクエスト(`studentScheduleRequest`)が処理後も App state に残り、盤面 `key={boardMountKey}` 再マウントで重複ガード(ローカル ref)が消えて再発火していた。処理後に App 側 state を消費済み(null)にする `consumeStudentScheduleRequest` を導入し、処理判定 `shouldProcessStudentScheduleRequest` を純関数化。セッション/生徒ロード後にのみ消費するよう処理順も整理(未ロード時の取りこぼしも解消)。再マウント再発火の回帰テスト同梱(src/App.tsx, src/components/schedule-board/ScheduleBoardScreen.tsx, ScheduleBoardScreen.test.ts)

## 1.5.405

- fix: 「保存し忘れ救済」(起動時の未保存ローカル書き戻し)を完全撤去(オーナー決定 2026-07-07)。起動時は常にサーバー最新を正とし、暗黙の書き戻し(7/6障害の主因・A3の残存リスク源)を経路ごと排除。閉じる前の未保存警告・タブ切替時の即時同期・ローカル控え保存は維持(src/App.tsx, src/data/appSnapshotRepository.ts, pendingSnapshotVersionGuard削除, 回帰テスト置換)

## 1.5.404

- docs: 7/6障害の最有力経路を初回評価誤除去→A3(stale書き戻し)へ訂正(被害生徒=提出済み本人とオーナー確認・リセット保存が提出到着1秒前の状態とほぼ同一サイズ・docs/analysis-qr-submitted-at-2026-07-06.md)

## 1.5.403

- docs: 7/6 講習巻き戻り障害の実データ解析結果を追加(docs/analysis-qr-submitted-at-2026-07-06.md・A4は当該障害の経路ではなく初回評価誤除去/A3が有力・handoffタスク1完了)

## 1.5.402

- docs: 引き継ぎ文書 docs/handoff-qr-submitted-at.md を追加。①本番 lectureSubmissions の submittedAt と問題報告時刻の突き合わせ解析(A4真因説の実データ裏付け・読み取り専用・アクセス制約と欠損注意つき) ②講習集計結果画面へのQR提出時刻表示(実装ポインタ・submittedAt を studentInputs へ搬送する3経路・着手前に spec-curator で確定すべき仕様点)を別セッションで進めるための背景・手順・制約をまとめた

## 1.5.401

- feat: 講習集計結果に「希望科目（授業時間）」列を追加。各生徒の希望各科目を授業時間付き数量で表示(例 `英×1 / 数60分×2`)。90分(既定)は分数なし、未登録・通常のみ・希望なしは `—`。授業時間は subjectDurations 由来(講習回数表と同ルール)。オーナー要望。src/utils/scheduleHtml.ts(formatDesiredSubjectsWithDuration 追加・buildLectureSummaryHtml に列追加)・docs/spec-schedule-pdf.md
- test: 講習集計結果の授業時間付き数量の回帰テストを追加。formatDesiredSubjectsWithDuration(60/45分併記・90分なし・SUBJECT_SORT_ORDER順・通常のみ/未登録/希望なしは `—`)を出荷後スクリプトの実体で固定。列ヘッダと関数の存在も確認。src/utils/scheduleHtml.test.ts

## 1.5.400

- fix: 講習回数表に希望登録の授業時間(60/45分)が表示されない不具合を修正。根本原因は payload シリアライズで studentInputs.subjectDurations が欠落していたこと(subjectSlots は載っていたため希望数だけ出て授業時間が消える非対称)。popup の DATA.specialSessions に届かず、未配置の希望科目で分数が一切出なかった。serialize に subjectDurations を追加し、配置済み(noteSuffix由来)・未配置(希望登録由来)の両方で分数が出るようにした。src/utils/scheduleHtml.ts(buildSerializedSchedulePayload・SerializedStudentSpecialSessionInput)・docs/spec-schedule-pdf.md §E
- test: payload に subjectDurations が載ることを固定する回帰テストを追加(未配置科目に分数が出ない根本原因の再発防止)。修正なしで落ち・ありで通ることを確認。src/utils/scheduleHtml.test.ts

## 1.5.399

- feat: 講習回数表の授業時間併記を、希望登録のみで盤面未配置の科目にも表示。実配置コマの noteSuffix を優先し、未配置科目は希望登録(QR提出の subjectDurations)の 60/45分でフォールバック。実配置と食い違う場合は実配置優先。オーナー要望。src/utils/scheduleHtml.ts(buildDesiredLectureMinutesMap・resolveLectureMinutesBySubject 追加)・docs/spec-schedule-pdf.md §E
- test: 未配置フォールバックの回帰テストを追加。resolveLectureMinutesBySubject(未配置は希望分数/実配置優先/実配置混在は希望へフォールバック/両方なしは併記せず)を出荷後スクリプトの実体で固定。src/utils/scheduleHtml.test.ts

## 1.5.398

- feat: 生徒日程表の講習回数表で、科目名の横に授業時間(60/45分)を併記(例 `英60分`)。90分(既定)は付けない(日程表セルと同ルール)。分数は実配置コマの noteSuffix 由来で、科目内で 60/45 が一意なときのみ併記(混在・不明・90分だけ・未配置は付けない)。オーナー要望。src/utils/scheduleHtml.ts(toCountRows に labelMinutesMap・pickLectureMinutesSuffix 追加、buildStudentSheetHtml で科目別に分数収集)・docs/spec-schedule-pdf.md §E
- test: 講習回数表の授業時間併記の回帰テストを追加。pickLectureMinutesSuffix(一意=併記/混在・空=なし/60+90=60)と toCountRows(labelMinutesMap ありで `英60分`・なしで素の科目名)を出荷後スクリプトの実体で固定。src/utils/scheduleHtml.test.ts

## 1.5.397

- docs: 登録解除の現状挙動をオーナー確定(2026-07-06)として正本に明文化。「講習だけ外し振替は残す(未消化へ戻さない)非対称は意図的」「希望数(subjectSlots)は in-app 保持・doc はクリアの二層」「ストック調整は台帳クリア方式が正・restoreSessionStock の +1 復元はデッド」「自動除去は提出済み→未提出の実遷移のみ発火」「セッション/生徒削除・期間変更では自動掃除しない」を追記。「空にする」での振替再出現(講習は台帳方式ゆえ再出現しない)の非対称を確定に格上げ。docs/spec-special-session-submission.md(E-2b 新設)・spec-lecture-stock.md(§5-1 新設)・spec-makeup-stock.md(§2)
- test: 確定仕様固定の回帰テストを追加。`removeStudentAssignmentsFromSpecialSession` を export(挙動変更なし)し、①special は外れ同一生徒の makeup は不変(最重要) ②specialSessionId 一致セッションのみ除去 ③セッション紐付き手動配置(specialStockSource='manual')も除去 ④台帳はその生徒×セッション分だけクリア(他生徒・他セッションのデルタは不変) ⑤デフォルト経路は +1 復元せず台帳クリアのみ(デッド分岐に依存しない)、を固定。src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts

## 1.5.396

- test: A4 配線ガード(regression-reviewer 指摘)。トークン発行の state 反映を薄いラッパー `reflectIssuedSubmissionTokens` に切り出し、「関数型アップデータで setter 実行時点の最新 current へマージする」配線をテストで固定(stale スナップショット丸ごと置換へ戻すと落ちる)。あわせて症状連鎖の端到端テスト(トークン発行反映後も提出済み生徒が未提出除去の対象にならない=割振済み講習が戻らない)を追加。src/App.tsx・src/App.test.ts
- fix: 講習提出トークンの自動発行反映を「丸ごと置換」から「current(最新)へマージ」へ修正(A4)。生徒日程表popupを開く/最新表示すると ensureScheduleSubmissionTokens が走り、関数開始時点の session スナップショットから updatedSession を作って `await writeSubmissionDocs`(ネットワーク)後に `setSpecialSessions(current => current.map(s => s.id===updatedSession.id ? updatedSession : s))` で対象セッションを丸ごと置換していた。この await 中に別生徒のQR提出反映(subscribeLectureSubmissions → countSubmitted=true)が届くと、古いスナップショットが上書きしてその生徒を未提出へ巻き戻し、未提出配置除去 effect が盤面の割振済み講習を外し講習残数が満数へ戻る経路になり得た。純関数 `applyIssuedSubmissionTokensToSessions` を新設し、新規発行トークンの追加/後埋めだけを current へマージ・既存エントリの countSubmitted/subjectSlots 等は保持するよう変更(回帰テスト4件)。src/App.tsx・src/App.test.ts
- fix: 未提出配置の自動除去判定 `resolveNewlyUnsubmittedSessionStudents` の基準を「未提出集合」から「提出済み集合」へ厳密化。除去対象を「前回提出済みだった生徒が今回未提出になった=登録解除」だけに限定し、トークン自動発行(ensureSubmissionTokens が countSubmitted:false エントリをセッション途中に新規追加)で現れる『初めから未提出』の生徒を『新たに未提出』と誤判定して除去する経路を原理的に排除。null 番兵(初回/再マウントは基準取り込みのみ)と空ロード据え置きガードは維持。回帰テスト更新(『初めから未提出』は除去しない/登録解除は除去する・旧基準では落ちることを確認)。src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts
- test: 多端末 stale 書き戻しガード(A3)に単一端末シーケンスの版数ゲートテストを追加。自分の保存でサーバー版数が進んだ(v11>マーカー基準v10)場合、残存した旧マーカーの書き戻しをブロックしリモート(=保存済み最新)を優先することを固定(単一PCでも成立)。src/App.test.ts
- test: 多端末 stale 書き戻し修正(A3)の regression-reviewer 指摘テスト補強3点。①部分マージ分岐(複数教室で stale=リモート維持/safe=ローカル書き戻し・pendingTargetClassroomIds が safe のみ・採用マッピング反転の変異で落ちることを確認済み) ②manager 専用パス(別ユーザーのマーカー→担当教室)の版数ゲート(stale=書き戻さない/一致=従来どおり) ③pending マーカー baseClassroomVersions の localStorage 往復(mark→read 欠落なし・不正値除去・旧マーカー後方互換)。src/App.test.ts・src/data/appSnapshotRepository.test.ts
- fix: 「講習を自動割振して数分後に未配置へ戻る／講習残数が増える」多端末 stale 書き戻し不具合を修正(単一端末では再現せず・中学生=大容量教室で顕著)。真因は保存の楽観ロック(教室単位 version・functions/optimisticVersion.ts)を、ログイン時の「前回終了時の未同期ローカル書き戻し」経路が素通りしていたこと。書き戻し直前の `loadFirebaseWorkspaceSnapshot` が版数レジストリをサーバー最新版数へ更新するため baseVersion が最新になり、サーバーは stale と気づけない。ゲートはワークスペース全体の savedAt(クライアント壁時計・端末間で数分ズレる)比較だけで教室単位版数を見ておらず、別端末が後から保存した最新教室データを古いローカルが savedAt 勝ちで黙って上書きしていた。盤面(weeks)だけ古い状態へ戻り提出(subjectSlots)は残るため講習残数が満数へ戻る(残数が増える)。対策: マーカーに教室単位の基準版数 `baseClassroomVersions` を記録し、書き戻し判定でサーバー現在版数と突き合わせて「別端末が後保存済み(remote版数>基準版数)」の教室はローカルで上書きせずリモートを優先する純関数ガード `isPendingClassroomWriteBackStale` を新設(`resolveRemoteWorkspaceSnapshot`/`resolvePendingLocalClassroomSnapshotForAuthenticatedUser` に版数ゲートを追加)。既存の savedAt ガード・A2 放置タブガード・A1 サーバー楽観ロックは巻き戻さず強化(二重防御)。回帰テスト追加(修正前=stale ローカルが savedAt 勝ちで上書きして落ち・修正後=リモート優先で通る/版数一致は従来どおり書き戻す/旧マーカーは後方互換)。src/data/pendingSnapshotVersionGuard.ts・src/App.tsx・src/data/appSnapshotRepository.ts・src/integrations/firebase/classroomSnapshotVersions.ts
- fix: 講習を自動割振したのに(教室を開き直すと)割り振った講習が未配置に戻る不具合を修正。未提出(countSubmitted=false)の生徒も fallback/manual ストック(lectureStock.ts の manualLectureStockCounts 正デルタ経路)から講習を自動割振できるが、「未提出になった生徒の講習配置を盤面から自動除去する」effect が基準集合 `prevUnsubmittedSessionStudentKeysRef` を空 Set で初期化していたため、教室ロード直後の初回評価で『以前から未提出だった生徒』まで「新たに未提出になった」と誤判定し、保存済みの割振済み講習を消していた。判定を純関数 `resolveNewlyUnsubmittedSessionStudents` へ切り出し、初回/再マウント(previousUnsubmittedKeys=null)は除去せず現在の未提出集合を基準として取り込むだけにし、提出→未提出へ実際に遷移した生徒だけを除去対象にした(コメント "Only clean up ... newly unsubmitted (not previously known)" の本来の意図に整合)。あわせて specialSessions 未ロード(空)の間は基準を進めず既存基準を据え置くガードを純関数へ一本化し、非同期ロードの「空→充填」遷移で既存未提出を全消しする再発も塞いだ(nextBasisKeys 番兵)。回帰テスト7件追加(修正前=初回/空充填で既存未提出を誤除去して落ち・修正後=通る)。src/components/schedule-board/ScheduleBoardScreen.tsx・ScheduleBoardScreen.test.ts

## 1.5.395

- feat: 自動割振の区分「制約事項」をソフト(強い減点+警告)からハードフィルタへ転換(Issue #44・B案・2026-07-04オーナー確定)。findBestAutoAssignCandidate のスコア構築前に純関数 shouldExcludeAutoAssignCandidateByConstraint で違反候補を continue 除外し、置ける候補が無ければ既存の「候補不足でストックに残す」経路で未消化在庫に残す。制約可リストから diversifySubjects(科目分散)を外し優先のみへ(旧データの constraint は resolveRuleCategory が優先へ丸め)。理由=違反状態で埋まるより未消化に残して気づけるほうがよいという運用哲学へ転換(2026-06-11「全ソフト維持」の意図的上書き・仕様書§Bに新旧併記)。制約対象なしは割振結果・スコア・走査順を完全不変に保つ(ゴールデン維持)。通常講師のみの判定元は配列+盤面の和集合を踏襲(v1.5.317)・『絶対事項合計』ソフト次元は存続(§H)。回帰テスト11件+モデル許可リスト縮小テスト更新(autoAssignRuleModel.ts/ScheduleBoardScreen.tsx/AutoAssignRuleScreen.tsx説明シート文言・正本 docs/spec-auto-assign-rules.md 反映)。staging実機検証で発見した画面冒頭説明文の旧ソフト挙動記述(「候補がないときだけ優先事項違反で割り振り」)もハード挙動(「守れない候補は未消化に残す」)へ更新し文言回帰テスト2件を追加

## 1.5.394

- fix: ペア制約の警告(制約=赤「組み合わせ不可」/優先=「組み合わせ回避」)を他ソフト制約(指定時限禁止・通常講師のみ・科目分散)と同一原則に統一し、通常授業(lessonType='regular')を警告対象外に(監査領域8 A3/C2オーナー確定・純関数 resolvePairConstraintWarningSeverity 新設・回帰テスト5件・自動割振スコア isPairConstraintBlocked は挙動不変)
- refactor: 日程表payloadの未使用 plannedCells 送出を全経路(scheduleHtml.ts型/serialize・App.tsx sync 2箇所・ScheduleBoardScreen all-view/useMemo/sync/open 7箇所)から撤去(監査領域9 A1/C1オーナー確定・plannedの唯一の根拠は expectedRegularOccurrences・b3279cc以降デッドと履歴で確認・buildManagedScheduleCellsForRange はテスト検証面として維持・回帰テスト追加)
- docs: 仕様監査領域8/9のオーナー確定を正本反映(spec-auto-assign-rules.md=全ソフト明記/キー名乖離/共有コア・振替同時割当/グループ二重管理/盤面∪配列判定/Excel列仕様/相互排他単位/スコア設計/4点セット等、spec-schedule-pdf.md=planned由来訂正/4.8px/二重同期H-1/印刷出し分け/派生印刷/unionガード/マルチタブ/提出済QR/盤面連動/埋め込みJS制約等)・台帳へ処置記録・Issue #42(App.tsx同期payload欠落)/#43(旧テスト教室2 QR残骸撤去)起票

## 1.5.393

- docs: 仕様監査の領域8(自動割振ルール・所見14件 A3/B9/C2)と領域9(日程表・PDF・所見16件 A2/B11/C3)を実施し監査台帳へ追記(docs/spec-audit-2026-07.md・spec-curator読み取り監査・正本/コードは未変更)。全9領域の監査が完了。C確定(領域8: 全ソフト明記/ペア制約の通常授業警告、領域9: plannedCellsデッドpayload/ポップアップ二重同期payload欠落/旧テスト教室2 QR残骸)はオーナー待ち

## 1.5.392

- fix: 講習提出の登録解除直後に、リセット前の古い購読スナップショットで登録(countSubmitted)が勝手に復活するレースを修正(監査領域7 B4)。無効だったガードを TTL 付き `createRecentlyResetGuard()` に切り出して実効化(src/integrations/firebase/lectureSubmission.ts・src/App.tsx・回帰テスト recentlyResetGuard.test.ts)

## 1.5.391

- docs+style: 仕様監査領域7(特別講習データ・提出ページ)のオーナー確定を反映。正本 `docs/spec-special-session-submission.md` を実装に合わせ更新(C2=提出は一段階モデル〈提出＝即ロック＝即countSubmitted・再提出可能化は室長の登録解除のみ〉に書換・二段階記述を撤回/C3=オプション欄optionChecksを開発用教室限定機能として正本化+学年解決の今日基準/講習開始日基準の非対称を注記・講習期間の重複禁止をA に明文化/B1集団参加の相互参照とunion反映ガード・B3永続化非対称と起動時reconcile・B5デッドdelete・B6トークン後追い反映・B7 Excel非対称・B8スマホ最適化/submit-debug・B9リセット粒度を明記)。あわせて C1: 講習編集パネルに残っていた廃止済みの死んだ案内文「…別タブで開きます。」を日程表/QR 案内へ統一(src/components/special-data/SpecialSessionScreen.tsx・回帰テスト2件追加・別タブ言及の復活を防止)。表示文言のみでロジック変更なし。監査台帳 docs/spec-audit-2026-07.md にオーナー確定を追記
- fix: staging(komahyouapp-staging)への functions デプロイが2回連続赤に。原因はソースから削除済みの孤児関数(downloadLatestClassroomRollback・gcloudで削除済み)と、Artifact Registry のクリーンアップポリシー未設定を non-interactive モードで確認できず abort していたため。`firebase deploy --only functions` に `--force` を追加し、staging限定でこれらの確認を自動承認するよう修正(.github/workflows/deploy-staging.yml)。あわせて .claude/launch.json に `dev-staging`(vite --mode staging・ポート5175)を追加し、ローカルから staging Firebase へ直接繋いで実機検証できるようにした(認証情報は .env.staging.local・gitignore済み・配信バンドルの公開設定値から生成)

## v1.5.389 (2026-07-04)

- feat: 自動割振ルールに「科目分散」(diversifySubjects)を新規追加。通常・講習を問わず同日の隣接コマ(±1時限)が同一科目になる候補を不利にし、違反は割振り対象(非通常)コマへ警告表示。区分は制約/優先の切替可(既定=優先事項)・優先順位グループとして上下入替可。旧教室データへは読込時にルール行を末尾補完(backfillMissingAutoAssignRules)。ルール未設定なら割振結果・警告とも不変(autoAssignRuleModel.ts / ScheduleBoardScreen.tsx / AutoAssignRuleScreen.tsx / App.tsx・ユニットテスト12件追加・仕様正本 docs/spec-auto-assign-rules.md 更新)

## v1.5.388 (2026-07-04)

- fix: 講師日程表で、同コマ内で別講師の机へ移動した生徒が旧講師のページにも二重表示される不具合を修正。moved_* レッスンはマージで机の講師IDが消えるため、基本データ行由来の regularTeacherIds(v1.5.247 導入の旧表示名救済)が旧講師を指し続けていた。盤面移動で配置された生徒(同日移動/元コマへ戻した振替)を regularTeacherIds の帰属から除外(src/utils/scheduleHtml.ts resolveRegularTeacherIds)。回帰テスト2件追加(ペイロード単体+移動操作→マージ→ペイロードの端到端・修正なしで落ちることを確認済み)

## v1.5.387 (2026-07-04)

- docs(changelog): 版ズレ修正(未リリース下に溜めたまま複数回デプロイした監査分を実デプロイ版 v1.5.379〜384 へ振り直し)。以後はマージごとに次版でラベル付けする(ラベル同乗ルール)

## v1.5.386 (2026-07-04)

- test: 講習ストックのゴールデン2件(lectureStockSnapshot/lecturePendingItems)が毎年4/1の年度替わりで自動的に落ちる問題を恒久対応。buildLectureStockEntries に省略可能な referenceDate を追加し(本番呼び出しは無引数のまま挙動不変)、テストは fixture 一元定義の固定基準日 2026-07-01 を渡す。referenceDate 尊重の回帰テスト追加(2028年基準で高2)。既存スナップショットは更新なしで通過=挙動不変を確認

## v1.5.385 (2026-07-04)

- chore(ci): GitHub Pages への副次デプロイを廃止(deploy-pages.yml 削除・オーナー確定 2026-07-04)。2026-03-17導入の前身デプロイで、Firebase Hosting CI 確立(6/25)以降は未参照の第二入口＋直近2日で約4割が GitHub 側エラーで赤だった。vite.config.ts の base を '/' 固定へ簡素化(6/25本番真っ白障害の発生条件そのものを消滅・経緯コメントは保持)、不活性化した FIREBASE_DEPLOY env を3ワークフローから除去、CI に dist/index.html のルート相対資産アサートを追加(regression-reviewer 検査済み・実ビルドで /KomahyouApp/ 参照0件を確認)

## v1.5.384 (2026-07-04)

- docs: 仕様監査 領域6のオーナー確定(C1: 並び替え/フィルタは生徒・講師タブに限ると補正・C2: managers完全撤去を Issue #41 に起票〈自然消滅方式の移行計画つき〉・C3: Excelシート整理の完了条件を確定)を正本 spec-basic-data.md へ反映。B2〜B6(学年ラベル定義・同一性照合ID→メール→表示名→名前は消してはならない設計・差分取込は削除しない・nextStudent*死蔵・note授業時間転用)を明文化(docs/spec-audit-2026-07.md に処置記録)

## v1.5.383 (2026-07-04)

- docs: 仕様監査 領域6(基本データ画面)を実施・所見11件(A1/B7/C3)を台帳 docs/spec-audit-2026-07.md へ追記(spec-curator・読み取り監査のみ)。UI削ぎ落とし方針(マネージャータブ/isHidden/availableSlots廃止等)はUI上実装済みで、差分はmanagers等のデータ配管残骸に集中。同一性照合ID→メール→表示名→名前は消してはならない設計と記録。C1〜C3はオーナー確定待ち

## v1.5.382 (2026-07-04)

- docs: 仕様監査 領域5のオーナー確定(C1: 日付メニュー3択に再定義〈空にする=単純クリア確定・振替える新設は Issue #40〉・C2: 残数のデルタ台帳方式を明文化＋reconcileしない・C3: 旧文書 lecture-edit-flow.md に注記)を正本 spec-lecture-stock.md へ反映。B1〜B7(データモデル・消化順・正負デルタ辞書・集計キー・specialStockSource対応表・欠席返却・overwrite返却/相殺)を「消してはならないガード」として明文化(docs/spec-audit-2026-07.md に処置記録)
- test+refactor: 講習残数計算 lecturePendingItemsByEntryKey を純関数 buildLecturePendingItemsByEntryKey として lectureStock.ts へ切り出し(ロジック不変・キー生成ヘルパ3種と LectureStockPendingItem 型も移設)、残数ゴールデン lecturePendingItems.test.ts を追加(仕様監査 領域5 C2・デルタ適用後の残数が初のユニット保護)

## v1.5.381 (2026-07-04)

- docs: 仕様監査 領域5(講習・講習ストック)を実施・所見13件(A3/B7/C3)を台帳 docs/spec-audit-2026-07.md へ追記(spec-curator・読み取り監査のみ)。振替=盤面走査/講習=デルタ台帳の構造非対称が所見の根。科目選択修正(v1.5.364)と自動割振共有コア(v1.5.331)の現存・回帰テスト保護を確認。C1〜C3はオーナー確定待ち

## v1.5.380 (2026-07-04)

- docs: 仕様監査 領域4のオーナー確定(C1: 凍結前・過去年度の休日振替は自動計上対象外＝手動追加で復帰・C2: §4撤去=balance減算撤去と確定しデータ辞書明記・C3: 削除済み未消化振替の復帰UIを Issue #39 に起票・C4: 同時間帯重複§1-D＋初期設定日フロア追加・C5: 分散正本4書と相互参照)を正本 spec-makeup-stock.md へ反映。B2データモデル/B4キー正規化/B5消化アルゴリズム/B7自動割振balance上限を「消してはならないガード」として明文化(docs/spec-audit-2026-07.md に処置記録)

## v1.5.379 (2026-07-04)

- docs: 仕様監査 領域4(振替ストック)を実施・所見15件(A2/B8/C5)を台帳 docs/spec-audit-2026-07.md へ追記(spec-curator・読み取り監査のみ)。既知事故(7/20振替消失: 凍結前origin未生成A1＋抑制suppressedMakeupOriginsの復帰UI欠如B1)と突き合わせ済み。C1〜C5はオーナー確定待ち

## v1.5.378 (2026-07-04)

- docs: 仕様監査 領域3のオーナー確定(C1: 授業時間はnote転用をデータ辞書明記・C2: 二層正本の相互参照＋B2〜B6要約取込・C3: 死蔵エディタ削除)を正本 spec-board-regular-placement.md(§6・§7新設)と spec-template-behavior.md へ反映(docs/spec-audit-2026-07.md に処置記録)
- chore: 死蔵コンポーネント RegularLessonTemplateEditor.tsx を削除(import 0件・仕様監査 領域3 C3・オーナー承認済み)。テンプレ編集はオンボード経路(ScheduleBoardScreen templateCells)のみ。copilot-instructions.md の参照も現行仕様(Q14)へ更新
- docs: CLAUDE.md の CIセットアップ記録に Cloud Scheduler 管理者ロール要件を追記(2026-07-04 functions デプロイでスケジュール関数の cloudscheduler.jobs.update 403 が初出。オーナー付与→再実行が必要)

## v1.5.377 (2026-07-04)

- chore: デッド関数 downloadLatestClassroomRollback(functions/src/index.ts)と、呼び出し0件のクライアント死蔵ラッパー downloadLatestFirebaseClassroomRollback＋型 ClassroomLatestRollback(src/integrations/firebase/adminFunctions.ts)を撤去(仕様監査 領域2 補足の掃除・オーナー承認済み 2026-07-04)。書き込み側 mirrorLatestClassroomRollback とヘルパーは手動復旧用に維持
- chore(ci): deploy-functions.yml に --force を追加(--non-interactive のみではソースから削除した関数を本番から消せずデプロイが失敗するため。関数削除はオーナー承認済みマージのみ main に入れる運用を注記)

## v1.5.376 (2026-07-04)

- docs: 仕様監査 領域3(コマ表の基本配置・テンプレ方式)を実施(docs/spec-audit-2026-07.md)。所見10件(A1/B6/C3)＋一致点12項目。上位正本と細部正本 spec-template-behavior.md の二層関係が未明記(B1)、テンプレ凍結(B2)・overwrite時ストック返却/相殺(B3)が上位正本未定義である点を特定。オーナー確認C1〜C3は確定待ち
- docs: 領域2補足の訂正(downloadLatestClassroomRollback は「src/ 参照0件」でなく死蔵ラッパーが存在。ブランチ chore/remove-dead-rollback-download で両方撤去・マージはオーナー承認待ち)

## v1.5.375 (2026-07-04)

- docs: 仕様監査 領域2のオーナー確定(C1: 離脱時は実装を正・C2: transient再試行を例外明文化・C3: 復元警告を実装)を正本 spec-save-restore.md へ反映。B1〜B6(楽観ロック・保存時3層防御・QR反映非対称・全教室書出・平文・Feature B)を明文化し「消してはならない破壊防止ガード」を明記(docs/spec-audit-2026-07.md に処置記録)
- fix: 開発者画面のサーバーバックアップ復元モーダルに不可逆警告「復元すると選択教室の現在データは上書きされ、元に戻せません」を追加(spec-save-restore §4 の警告必須要件・監査 領域2 A3。DeveloperAdminScreen.tsx＋回帰テスト DeveloperAdminScreen.test.ts)

## v1.5.374 (2026-07-04)

- docs: 仕様監査 領域2(保存・バックアップ・復元)を実施(docs/spec-audit-2026-07.md)。所見12件(A3/B6/C3)＋一致点14項目。楽観ロック・空データ上書き拒否・読み戻し検証など「意図的な破壊防止ガード」が正本未定義である点を特定(B1/B2)。オーナー確認事項C1〜C3は確定待ち(正本 spec-save-restore.md は未編集)

## v1.5.373

- docs: CHANGELOG の版ズレ修正(v1.5.371ラベル単独pushが変更なし版として挟まったため監査分をv1.5.372へ付け替え)。solo-git-workflow スキルに「版ラベルは内容と同じpushに含める」ルールを追記(再発防止)

## v1.5.372

- docs: 仕様監査（全9領域・オーナー指示2026-07-04）の台帳 docs/spec-audit-2026-07.md を新設し、領域1(教室権限・ログイン・開発者画面)を監査。所見12件(A3/B4/C5)。オーナー確定を正本 spec-classroom-auth.md へ反映(一時停止は全件一括のみ・localは開発専用・contractStatusデータ辞書)。教室追加のアプリ内完結化は Issue #38 起票

## v1.5.371

- (変更なし: CHANGELOG ラベル付けのみの再デプロイ)

## v1.5.370

- chore: 保守運営体制のブラッシュアップ。spec-curator エージェント新設(思いつき要望→要求仕様の補完・確定役)、モデル割当方針(単純作業=Sonnet最新/判断=Opus最新・モデルID固定禁止)と標準フロー(triage→spec-curator→dev-fix→regression-reviewer→safe-release)を CLAUDE.md に明文化。bug-triage スキルに仕様確定ステップを追記。古い引き継ぎ文書2件(docs/NEXT-SESSION-PROMPT.md, SESSION-HANDOFF.md)へ廃止ヘッダ追加(.claude/agents/spec-curator.md ほか)

## v1.5.369

- fix: 講習集計結果ページの最下部がWindowsタスクバーに隠れて見えない問題を修正。ポップアップ本文に padding-bottom:160px を追加し、最後の行までスクロールで確実に見えるようにした(印刷時は0に戻す)。回帰防止アサート追加(src/utils/scheduleHtml.ts・scheduleHtml.test.ts)

## v1.5.368

- feat: 生徒日程表の「印刷用全員表示」の左に「講習集計結果」ボタンを追加。表示期間に講習期間(specialSession)が重なるときだけ表示し、クリックで全生徒の講習登録状況(登録/未登録、登録でも通常のみは「登録（通常のみ）」の注記)を新タブに一覧表示する。判定は studentInputs の countSubmitted=登録・regularOnly=通常のみ。読み取り専用(DATA参照+新タブ生成のみ、Firestore書き込みなし)。埋め込みスクリプト系のため new Function 抽出で状態分類を、生成HTMLの配線有無を回帰テストで担保(src/utils/scheduleHtml.ts・scheduleHtml.test.ts)

## v1.5.367

- chore(一時機能撤去): 7/20休日振替の復帰ボタン(v1.5.366で追加)を撤去。対象4名(緑が丘 白川:数/古賀:英、日大前 劉:数/神:理)の復帰は室長が各教室でクリック→手動保存済みで本番反映を確認(manualMakeupAdjustmentsに7/20あり・suppressedMakeupOriginsから除去済み)。撤去は button/ハンドラ/import/restore720Holiday.ts/restore720Holiday.test.ts の削除のみでデータには非干渉のため7/20は在庫に残り続ける(src/components/schedule-board/ScheduleBoardScreen.tsx・restore720Holiday.ts削除・関連コミット 2edf396)

## v1.5.366

- docs: リリースチェックリストに「在庫数量(未消化振替/講習)の非退行チェック」§6を追加。ゴールデンスナップショット(makeupStockSnapshot/lectureStockSnapshot)を自動ガードとして明記し、意図的変更時のみ -u 更新+目視レビューするルール、在庫計算を触った版の本番スポットチェック手順、2026-07-03基準値(未消化振替294/未消化講習raw1436)を記録(docs/runbooks/release-checklist.md)
- feat(一時機能): 7/20(海の日)の休日振替を対象4名だけ未消化振替へ復帰する一時ボタンを未消化振替パネルに追加。テンプレ凍結で在庫計算(buildMakeupStockEntries)から漏れた7/20を、対象キー(緑が丘 白川:数/古賀:英、日大前 劉:数/神:理)に「手動追加(manualMakeupAdjustments) + 抑制解除(suppressedMakeupOrigins)」の両方を適用して復帰する(片方だけでは+0=両方必須)。対象教室(actingClassroomId)のときのみ表示・冪等。純粋ロジックは新規 restore720Holiday.ts に分離し回帰防止テスト付き(実データで各キー+1・他生徒不変を検証済み)。**室長が各教室で1クリック→手動保存した後、本ボタンは撤去する**(撤去後も保存済みデータに残り7/20は在庫に残り続ける)。buildMakeupStockEntries自体は不変=ゴールデン不変(src/components/schedule-board/restore720Holiday.ts・ScheduleBoardScreen.tsx)

## v1.5.364

- fix(未消化講習): モーダルで選んだ科目が無視され、常に先頭科目が配置される不具合を修正(例: 中3で数学を選ぶと英語が置かれる)。振替(makeup)側の rawKey に相当する選択科目の尊重が講習側に無かったのが原因(2026-03-20/06-15 由来の既存バグ・直近デプロイとは無関係)。選択科目(subject+sessionId)を記憶し配置対象を解決する純粋関数 `resolveSelectedLecturePlacementItem` を追加、未選択/不一致は先頭へ安全フォールバック。回帰防止テスト付き(src/components/schedule-board/lectureStockPlacement.ts・ScheduleBoardScreen.tsx)

## v1.5.363

- refactor: 振替在庫の「空きコマ不足」自動origin(`computeOccupiedSlotOrigins`)を経路ごと廃止(オーナー指示 2026-07-03)。テンプレ毎週強制適用が前提で開講日にコマが埋まっていても未消化を自動生成しない。過去にこの偽originが大量発生→一括削除される際、本物の休講日振替(例: スクールIE緑が丘 白川 数 7/20)まで巻き込まれ消える事故の再発防止。未消化源は「休講日(自動)/同時間帯重複/手動」のみに一本化。占有origin関連テストは新契約(在庫を生成しない)へ反転(src/components/schedule-board/makeupStock.ts・makeupStock.test.ts)

## v1.5.362

- style: 警告時のセル黄色背景(`.sa-warning`)を全条件で廃止。警告は名前の赤文字(出席不可コマ配置のみ)とツールチップで示す。背景を支えていた `.sa-warning .sa-student-detail` の文字色調整も併せて削除(見た目のみ・ロジック/クラス付与は不変・src/App.css)

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
