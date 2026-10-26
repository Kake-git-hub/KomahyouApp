---
name: komahyou-popup-sync-and-dnd-plan
description: 対話用日程表の「同期＋コマ組み」を別タブ(生成HTML)方式で実装(2026-07-08 React化から転換)。Phase A/B＋同期スピナー＋Phase C(コマ組みD&D)は本番反映済み(all-classrooms)。⚠️棚上げしていた React ビュー本体は 2026-07-14(v1.5.445)に撤去済み(scheduleViewData.ts/scheduleViewMove.ts/executeScheduleViewMove は別タブ経路と共有で維持)。手順書 docs/handoff-popup-sync-and-dnd.md
metadata:
  node_type: memory
  type: project
  originSessionId: 3dd4f0b3-1dad-4d4a-9b21-bec5027bd60d
---

対話用日程表への2機能（**日程表同期**＋**日程表コマ組み**）の実装。**作業ブランチ `feature/schedule-react-view`（staging デプロイ済み・オーナー合格まで main マージ禁止）**。自己完結の手順書＝`docs/handoff-popup-sync-and-dnd.md`。

## 最重要の方針転換（2026-07-08・オーナー確定）
当初は「対話用日程表を React 化（同一ツリーで同期・コマ組みを単純化）」で Phase 0〜2 を実装したが、**React ポップアウト（別ブラウザウィンドウへの React portal）では pointer 操作＝D&D の drop が確実に届かず移動が成立しない**（setPointerCapture もポータル境界で保持されない）・**従来タブと操作感が変わる**という理由で、**「既存の別タブ（生成HTML日程表）の中に同期＋コマ組みを入れる」方式へ回帰**した。

- **⚠️React ビューは 2026-07-14(v1.5.445)に撤去済み（もう温存していない）**：かつて `scheduleReactViewEnabled = false` で棚上げしていた React ビュー本体（`ScheduleView.tsx`/`ScheduleViewPanel.tsx`/`ScheduleSheet.tsx`/`PopoutWindow.tsx`/`scheduleViewPrint.ts`/`scheduleView.css`）と featureRollout `scheduleInteractiveReactView`、ScheduleBoardScreen 内の React 専用 state/payload/ハンドラ/描画/分岐を**削除**（オーナー指示・別タブ方式が定着したため。本番挙動は不変）。日程表ボタンは従来どおり生成HTML別タブ（`openStudentScheduleHtml`/`openTeacherScheduleHtml`）を開く。
- **維持（別タブ経路と共有・本番稼働中）**: `src/utils/scheduleViewData.ts`（生成HTMLの表示算出正本）、`src/components/schedule-view/scheduleViewMove.ts`(+test・`buildDeskPickerDesks` を生成HTMLが使用)、`executeScheduleViewMove`/`findScheduleViewTargetCell` 等（別タブコマ組み studentScheduleDndMove の D&D 移動で再利用）。schedule-view ディレクトリには現在この共有 move ヘルパのみ残る。

## 実装済み・staging 反映済み
- **Phase A**（コミット 61868ce）：React ビュー無効化＝別タブを主経路に戻す。
- **Phase B**（61868ce）：**別タブ日程表への自動同期（デバウンス約1.5秒）**。盤面編集を別タブへ自動反映。①デバウンスで連打を1回に集約 ②受信側(埋め込みJS)の `buildPayloadFingerprint`/`skipNextEquivalentPayload` で等価ペイロードの再描画をスキップ ③表示範囲限定、で **2026-06-05 メモリ障害**を防ぐ（[[komahyou-schedule-popup-sync]]）。実体＝`ScheduleBoardScreen.tsx` のデバウンス effect が `scheduleSyncTrigger` を bump→既存 `syncStudentScheduleHtml`/`syncTeacherScheduleHtml` が送信。オーナー「感触だいたいOK」。
- **同期スピナー**（コミット 4a89e38）：反映までの数秒、別タブ最前面に大きく「コマ表の最新を反映中…」＋スピナー。本体が編集時に埋め込みJSの `window.__showScheduleSyncing()` を即時呼び、同期ペイロード適用(`flushIncomingPayload`)で自動消去（等価でも固着しないよう flush 末尾で必ず hide＋8秒保険）。初回表示では出さない（`syncSpinnerArmedRef`）。

## Phase C：別タブのコマ組みD&D（実装済み・staging反映＋オーナー実機確認待ち・2026-07-08）
`feature/schedule-react-view` に3コミットで実装済み(aa9e68d 土台 / 7cdbf17 机レイアウト+ゲート / cf8a67f 別タブD&D本体)。lint/unit(全577+)/build 緑・push済み。**残りは staging デプロイ＋オーナーの実機D&D確認**（生成HTML別タブは headless プレビュー不可のため自動検証できず、実機/staging 必須）。実装内容:
1. 授業カード(通/振/講)を約250ms長押し→空きコマ(開校日・当該生徒が空き)へD&D(青枠)→**机選択モーダル**(移動先コマの全机=pickerDesks をコマ表と同配置・空席のみ選択可・ルール/警告は無関係)→席確定。集団/体験/増コマ/出欠済みは掴めない。
2. 設計課題は **flag 方式**で解決：`serializeCells(cells, ..., { includeDeskPicker })` で開校日コマに `pickerDesks`(=既存 `buildDeskPickerDesks(cell)`・空席の机も含む)を別フィールドで載せる。`desks`(空席の机を落とす表示/印刷用)は不変。`scheduleDndEnabled` 時のみ載る＝本番/印刷/講師/全員表示は不変。
3. 席確定で popup→opener に `schedule-student-move-request` を postMessage。App.tsx が純関数 `parseScheduleViewMoveMessage`(scheduleViewMove.ts・信頼境界外の入力を厳密検証)で `StudentScheduleRequest` を **discriminated union 化した `mode:'move'`**(source/seat)に変換。盤面は既存 `executeScheduleViewMove` で実行(通常=振替manual追加+抑制の両方/講習=rawKey科目維持/週自動拡張)。処理後に一過性 state を消費(Issue #46 規律)・weeks 未ロード時は待つ。
4. ゲート＝featureRollout `studentScheduleDndMove`(staging-environment スコープ・staging/開発用教室のみ)。埋め込みJSは pagesElement 委譲(自動同期の再描画に強い)＋空きコマトグルより先に登録し掴めるカードのみ後続停止。自動同期の再描画中はドラッグ/モーダル破棄。送信時に同期スピナー即時表示(8秒保険で固着回避)。エスケープ罠回避(new Function 構文検証テストが番人)。テスト同コミット済(parse 6件・pickerDesks 2件・featureRollout 1件・掴めるゲート/対象外/配線 3件)。
5. **既知の割り切り**: ①ドロップ可能セルは「ホバー中のセルのみ」青枠(全空きセル一斉ハイライトはしない)。②pickerDesks は同期の等価スキップで軽微に stale になり得るが、盤面が移動時に再検証し不正な席は理由表示で弾く(誤配置なし)。③講師日程表からのD&Dは対象外(将来)。

## Phase C 追補(2026-07-08 オーナー指摘対応・staging反映済み)
- **⚠️移動失敗の真因＝机だけでなく「席(左右=studentSlots)の並び」も食い違う(重要・巻き戻し厳禁)**: 日程表の payload セルは `buildScheduleCellsForRange`→`overlayBoardWeeksOnScheduleCells`(テンプレ管理セルに盤面をオーバレイ)で作られ、盤面の生 `weeks` とは**机の並び/本数だけでなく机内の席の並びも食い違う**ことがある。モーダルが送る positional `deskIndex/studentIndex` を生 weeks にそのまま当てると別の机/席(占有)を指し、**「空き席なのに『すでに生徒がいます』」で弾かれる**(実際に 8/5 講師G机の左空席で発生)。**対策**: 席解決を純関数 `resolveScheduleViewTargetSeat`(scheduleViewMove.ts)で、机=`deskId`(=盤面 desk.id)→講師名、席=**入れ替え対象の在席生徒 `occupantEntryId` / その机の実際の空き席**で解決してから computeStudentMove。空きも入れ替え対象も無ければ null→理由表示。`buildDeskPickerDesks` に `deskId`/`occupantEntryId` 追加・`ScheduleViewMoveSeat` に `deskId?/deskTeacher?/occupantEntryId?` 追加・parse も引き継ぐ。**旧 `resolveScheduleViewTargetDeskIndex`(机だけ解決・席は positional のまま)は不十分で置換済み(復活させない)**。executeScheduleViewMove は validateScheduleViewMoveTarget を使わず、休校日チェック＋resolveScheduleViewTargetSeat＋computeStudentMove に一本化(占有席の可否/メモ/出席/重複は computeStudentMove が判定)。回帰テスト: 席解決4件・入れ替え通し1件。
- **在席選択=盤面と同じ入れ替え(swap)**: 机選択モーダルの在席セルもクリック可(橙・「入替」)。`occupantEntryId` を送り computeStudentMove の入れ替え(相手を移動元へ振替で入れる・両者 suppress)に乗せる。メモ席のみ選択不可。「モーダルは物理的な空きのみ」という当初 spec §C-2 はオーナー指示で入れ替え可へ拡張。
- **机特定は最終的に「机の在席者」で行う(deskId だけでは不十分だった)**: 8/5 講師G机で deskId/positional/講師名でも解決できず「空き席なのに移動不可」が残った。`resolveScheduleViewTargetSeat` の机特定を **deskId→`deskOccupantEntryIds`(モーダルが見せた机の在席者全員・生徒は同コマ高々1机なので一意)→講師名→positional** に強化。戻りは `{ok:true,deskIndex,studentIndex} | {ok:false,reason}` で、解決不能時は**盤面の実際の席内容(席1=◯/席2=◯)を添えた診断 reason**(stale 表示か真のバグかを切り分けられる)。
- **⚠️D&Dは既存の出席不可トグルと干渉した(staging のみ・要注意)**: 掴めるカード(通/振/講)の pointerdown で `stopImmediatePropagation` すると、同じ pagesElement 上の**出席不可トグル(pointerdown 発火)がカード上で効かなくなる**(「テキスト余白しか反応しない」)。対策=長押し未満のタップ(pending→up)で `handleUnavailablePointerDown(cell)` を実行しトグルを維持。**本番は scheduleDndEnabled=false でこの経路自体が無効なので影響ゼロ**(staging/開発用教室のみの回帰だった)。
- **自分の操作(出席不可トグル)ではスピナー抑制**: 出席不可は `updateUnavailableSlotsLocally`＋`refreshStudentUnavailableUi`＋`syncPayloadFingerprint`(エコー skip)でローカル完結。盤面の specialSessions 変更→自動同期→`__showScheduleSyncing` が出す「同期中」スピナーは**連続入力の妨げになるだけ**。`applyStudent/TeacherUnavailableSlots` で `suppressSyncSpinnerUuntil=now+3s`、`showScheduleSyncingOverlay` 冒頭で抑制。**移動(反映待ち)は `sendScheduleMoveRequest` で抑制解除**してスピナー表示。
- **本番影響ゼロの根拠(オーナー質問への回答)**: D&D 由来コードは全て `DATA.scheduleDndEnabled`(本番=false)ゲート下。①`renderStudentCellCard` は無効時 `buildLessonCardDragAttrs`='' で従来と**バイト同一** ②`setupScheduleDndMove` が早期 return で pointerdown リスナ未登録=出席不可トグルも従来どおり ③`serializeCells` は無効時 `pickerDesks` を載せない ④結果ack/ハイライト/机選択の各関数は無効時に到達しない。常時走るのは flushIncomingPayload の `cancelScheduleDndInteraction()`(no-op)と renderStudentPages の `applyScheduleMoveHighlight()`(key=null で即 return)のみ=挙動不変。
- **移動結果ack**: 盤面の move effect が `stableExecuteScheduleViewMove` の戻り `{ok,message}` を捉え、生徒 popup(studentScheduleWindowRef/generatedStudentScheduleTabRef)へ `schedule-student-move-result` を postMessage。popup: **成功=移動先コマを約4s黄色ハイライト**(`is-move-done-highlight`・`renderStudentPages` 後に毎回 `applyScheduleMoveHighlight` で再適用し自動同期の再描画をまたいで持続)、**失敗=`move-error-overlay` で理由を大きく表示+「日程表に戻る」**(盤面は不変・スピナーは hide)。
- **モーダルは「盤面の一コマ切り取り」**: 説明テキスト(タイトル/注記)無し。上=日付行(dp-datehead)・左=時限列(dp-time rowspan)・各行=机[机番号][講師][席1][席2]、ダーク1px罫線。App.css の .slot-adjust-grid/sa-* に寸法を合わせる。空席=クリック可td(青ホバー)・占有=生徒名+科目・メモ/休=淡色。

## リリース制約
両機能とも **staging だけに実装しオーナーチェック合格まで main へマージ禁止**。デプロイ＝GitHub Actions「Deploy to Staging」を `feature/schedule-react-view` で Run。staging テストデータは日大前を `tools/copy-prod-classroom-to-staging.mjs`（オーナーがターミナル実行）。ローカル検証＝`.claude/launch.json` の `dev-local`(VITE_EXTERNAL_BACKEND_MODE=local・5199)で仮ログイン→教室名「開発用教室」。※ただし生成HTMLの別タブ(window.open+document.write)は headless プレビューで固まりやすく自動検証しづらい→実機/staging で確認する。
