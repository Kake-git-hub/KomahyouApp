# 確定仕様：日程表・PDF（To-Be 正本）

> 全体見直しセッション（2026-06-07/08）でオーナー確認済みの「目標仕様」。
> ③（通常授業＝テンプレ方式・月回数撤廃）と色分け撤廃を反映。
> 旧 `docs/schedule-popup-design.md` のうち本書と矛盾する点は本書を優先。
> 2026-07-04：仕様監査領域9（`docs/spec-audit-2026-07.md`）のオーナー確定を反映（A1 planned 由来・A2 PDF 下限・B1〜B11 の明文化。各節に確定日を付記）。

## A. 日程表の出力（生徒／講師）

- 生徒日程表・講師日程表は**別タブでHTML出力**する。
- **校舎名とロゴは生徒/講師で共有**、**期間入力は生徒/講師それぞれ別に保持**。
- ★**期間（開始日/終了日）は入力しても即時には反映しない。「最新表示」ボタンを押したときに反映**する（後述 H）。

### A-1. マルチタブ共有・編集ロック（2026-07-04 監査領域9 B7 確定・オーナー確認済み）

- 日程表の**期間・ロゴ・校舎名・連絡事項は localStorage（教室スコープ）で共有**し、同一ブラウザの**生徒/講師タブ間で同期**する（`storage` イベント経由）。
- 複数タブが同時編集しないよう **interaction lock**（`schedule-shared:interaction-lock`・**stale 5秒**・focus/blur/visibilitychange/1秒 interval で保守）で排他する。**ロック保有中は他タブに編集不可バナーを出す**。
- 配布 URL を複数端末で開く運用（**1教室1端末方針**・memory total-review）との関係に注意（この共有/ロックは同一ブラウザの別ウィンドウ間の話で、別端末間は同期しない）。

## B. 日程表のセル表示は actual のみ（★位置づけ変更）

- 日程表は**「盤面データを個別に見るための機能」**という位置づけ。
- 日程表のセル（コマ）に表示するのは **actual（盤面の実際）だけ**。
  - planned（テンプレ想定）のコマは日程表グリッドには描画しない。
  - ※ ただし回数表の比較用に planned 回数は算出する（後述 E）。
    **planned 通常回数は `expectedRegularOccurrences`（regularLessons＋テンプレ履歴から月次生成・参加者の在籍/進級/退塾の active 判定込み）から算出する。**
    かつて payload に載せていた `plannedCells` は planned 回数の根拠として使われていない未使用のデッドだったため撤去した（2026-07-04 監査領域9 A1 確定・オーナー確認済み・実装同日撤去）。
    planned 通常回数の唯一の根拠は `expectedRegularOccurrences`（テンプレ由来＝下記主な差分7 と整合）で一意とする。
- **振替ストックへ回しただけで未割当の通常授業は日程表に出さない**。実際に割り振られた振替だけ出す。

## C. 振替の表示

- 振替配置済みは「**振替**」として表示。元コマへ戻ったら通常授業として正規化。

## D. 講習の表示

- 講習は表示ラベルを「**講習**」に統一。**講習ストックから配置された分だけ** actual に出る。
- ⑤/⑦で決めた**授業時間 90/60/45 を日程表にも反映**（例：`講)小5算60`）。

### D-1. 集団授業（中3の集団理科/社会）の日程表表示（相互参照）

- 集団授業の**日程表表示・集団列・講習回数への集理/集社注入**の正本は **`spec-group-lesson.md` §A/§D/§E**（本書は個別授業の actual/回数を定義。集団は当該正本を参照）。
  - 集団参加の payload 化（`groupClassEntries`/`groupClassParticipation`）、講習回数表への集理/集社の注入（希望=範囲内コマ数／実績=出席数）、空フォーマットの中3集団追加は当該正本に従う。
  - コード側にも対応するセクション参照コメントがある（双方向参照）。（2026-07-04 監査領域9 B3 確定・オーナー確認済み）

## E. 回数表（★警告スタンプは通常・講習とも残す）

- **通常回数**：左＝actual（実配置）／右括弧＝planned（テンプレ想定）。不一致なら**通常回数表の直下に警告スタンプ**。
  - **planned（予定数）は `expectedRegularOccurrences`（regularLessons＋テンプレ履歴から生成・在籍/進級/退塾の active 判定込み）から算出**（`plannedCells` は planned 回数に不使用＝撤去済み。2026-07-04 監査領域9 A1 確定・オーナー確認済み。上述 B 参照）。
- **講習回数**：左＝actual（配置済み）／右括弧＝特別講習の登録希望数。不一致なら**講習回数表の直下に警告スタンプ**。
  - **科目名に授業時間（60/45分）を併記**（例 `英60分`）。90分（既定）は付けない（日程表セルと同ルール＝§D `formatScheduleMinutesSuffix`）。科目内で 60/45 が一意なときのみ併記し、混在・不明・90分だけの科目には付けない（`pickLectureMinutesSuffix`＝誤解を招く併記をしない）。2026-07-06 実装（オーナー要望）。
  - 分数の由来は **①実配置コマの `noteSuffix` を優先** し、**②未配置（希望登録のみ）の科目は希望登録の `subjectDurations`（QR提出の授業時間）でフォールバック** する（`resolveLectureMinutesBySubject` / `buildDesiredLectureMinutesMap`）。希望だけ登録して盤面未配置の科目にも分数が出る（2026-07-06 追加・オーナー要望）。実配置と希望が食い違う場合は実配置が勝つ。
- 通常回数の警告は**残す**。次のような**「正しいズレ」**を室長が把握するための印：
  - 休み（欠席）で振替待ちだが、表示期間内にまだ振替配置されていない。
  - 振替しない休みで、希望数より通常回数が少ない。
  - → これらのズレは正常。警告は「通常回数が想定に届いていない生徒」を見つける用途。
- **印刷/配布時の出し分け（2026-07-04 監査領域9 B2 確定・オーナー確認済み）**：
  - 回数表の**警告スタンプ**・**希望数（右括弧の予定数/希望数）**・**提出済バッジ**は**画面表示（室長確認用）のみ**で、印刷/配布時は非表示（`print-only-hidden`／`@media print { display:none }`）。保護者へ配る印刷物には **actual 回数だけ**を載せる。
  - なお下記 K の「注意の赤テキストは残す」は**連絡事項テキスト（`memo-input` 由来・印刷でも残る）**を指し、印刷で消える警告スタンプとは**別物**である。

### E-1. 生徒日程表下部のオプション欄（休み欄置換・開発用教室のみ）（2026-07-04 監査領域9 B4 確定・オーナー確認済み）

- フィーチャーフラグ **`studentScheduleOptionField`**（`optionFieldEnabled` として payload に渡す・**開発用教室のみ**）が有効なとき、生徒日程表下部の**休み欄（absence section）をオプション欄に置き換える**（振替を左詰めし、空きに**2列5行**のオプション欄を配置）。
  - 右列は QR 提出の `optionChecks` を ✓ 表示する。オプション欄の内容（学年共通テキスト＋QR提出チェック）・往復の正本は **`spec-special-session-submission.md` §D のオプション項**（相互参照）。
- ⚠️ **レイアウト仕様として明文化**：有効時は下部の休み欄が消えるため、室長は「振替待ちの休み」を日程表下部では確認できなくなる（ただし回数表の警告は残るため致命ではない）。
- なお App.tsx 同期経路は従来 `optionFieldEnabled` を欠いていた（上述 H-1 の payload 非対称・B1 と連動。dev-fix 起票済み）。

## F. 科目表示（現状維持）

- **算と数は同時表示しない**。小学生＝`算`／中学生以上＝`数`。それ以外の科目は常時表示。
- 回数表と希望科目数モーダルで同じルール。

## G. 登録（⑦の一本化）

- 「欠席不可・希望の登録は日程表に一本化」を、日程表側の登録UI（希望科目数モーダル等）で実現する。
- ★**QRも日程表機能の一部**として、**QRからの登録も可能**とする。
- コマ表の講習期間帯クリック→別タブ入力経路は廃止（⑦）。

### G-1. 日程表ポップアップ→本体の保存 messaging（2026-07-04 監査領域9 B6 確定・オーナー確認済み）

- 日程表ポップアップは opener（本体）へ **postMessage** で提出/登録内容を保存する：`schedule-student-count-save`（希望科目数・授業時間・集団・オプション・通常のみ・countSubmitted）、`schedule-student-unavailable-save`（欠席不可コマ）、`schedule-teacher-register-save`／`schedule-note-update` 等。
- **登録解除（countSubmitted=false）時**は本体側で `resetLectureSubmissionDoc` を呼び、盤面 **unassign を連動**させる。
- ⚠️ **消してはならないガード**：**保護者由来フィールド（集団参加 `groupClassParticipation`・オプション `optionChecks`）は、未送信時に既存を保全＝消さない union 反映**とする。これは **v1.5.336 の本番消失事故（集団参加が消えた）への意図的ガード**で、領域7（`spec-special-session-submission.md`）B1 と同じガード。**日程表側の保存経路を「単純化」して spread 一括代入にすると保護者由来フィールドを消す回帰になる**（相互参照＝領域7）。

## H. 更新（★追従同期を廃止）

- ★**日程表は「最新表示」ボタンによる手動更新に一本化**する。
- コマ表側との**ライブ追従同期は取りやめる**（メモリ軽量化のため）。
- 「最新表示」ボタンが、期間変更の反映（A）と盤面内容の反映を兼ねる。

### H-1. 日程表ポップアップの能動更新アーキテクチャ（2026-07-04 監査領域9 B1/C2 確定・オーナー確認済み）

- **能動更新の正本は ScheduleBoardScreen（`studentScheduleWindowRef`／講師は teacher 相当）**。App.tsx（`__lessonScheduleStudentWindow`）は QR トークン確保後の再同期などの**補助経路**。
- **両者は同一 window を更新する**ため、送る payload の内容を一致させること。具体的には App.tsx 側の同期にも `optionFieldEnabled` / `groupClassEntries` / `highlightedStudentSlot` / `scheduleCountAdjustments` を含める（従来 App.tsx 側はこれらを欠いており非対称だった）。
- ⚠️ **設計注意（消してはならない）**：popup 側は `buildPayloadFingerprint` 一致時に再描画を抑止する（echo 抑止）が、内容差のある2つの payload が rAF dedup の「最後勝ち」で揺れると、最新表示で**移動ハイライト（青枠）やオプション欄が消える/揺れる**レースの温床になる（memory schedule-popup-sync：「App.tsx 側 payload の欠落がレース要因」）。payload を揃える設計を崩さないこと。
- App.tsx 側 payload 欠落を埋める修正は **dev-fix 起票済み（2026-07-04）**。確定後の実装は popup 往復の実機再現が必要なため開発用教室での実機検証（safe-release）必須。

## I. PDF出力（現状維持）

- 出力対象は**コマ表グリッド本体のみ**。**振替ストック／講習ストックの操作パネルは混入させない**。
- **A3縦1ページ**に1週間分を必ず収める（向きはA3縦固定）。
- 時間列は**中央寄せの大きい文字**（太字20px基準、縦回転ラベル）。
- 生徒セル2行目は詰めて全文表示優先（必要時のみ段階縮小、**下限4.8px**）。可読性優先で下限は 4.8px（`PDF_STUDENT_MIN_FONT_SIZE`）とする（旧記載 4.5px を実装値 4.8px に訂正。2026-07-04 監査領域9 A2 確定・オーナー確認済み）。

### I-1. 日程表ポップアップの派生印刷（PDFとは別経路）（2026-07-04 監査領域9 B5 確定・オーナー確認済み）

上記 PDF（コマ表グリッド本体のみ）とは別に、日程表ポップアップは次の3つの派生印刷を持つ：

1. **印刷用全員表示（all-view）**：生徒/講師全員分を1ページ帯で連続表示して印刷する。
2. **空フォーマット印刷**：素の記入用ひな形を印刷する。
   - ⚠️ ここは埋め込みクライアント JS のエスケープ事故（`\'` 崩れ）で**日程表が実行時に全停止**した箇所（2026-06-09・memory schedulehtml-embedded-script）。構文検証テスト `scheduleHtml.test.ts`（`new Function` で構文検証）が回帰防止の番人＝**消してはならない**（後述 L も参照）。
3. **講習集計結果**：全生徒の登録状況一覧（登録／通常のみ／未登録）。**表示期間に講習が重なるときのみ**表示する。

## J. 日程表QR（★全教室表示）

- 日程表QRは**全教室で表示**する（旧「テスト教室2のみ表示」は撤廃）。

### J-1. QR の表示条件・提出済み表示・遅延生成（2026-07-04 監査領域9 B8 確定・オーナー確認済み）

- QR は **per-person の提出トークン有無**で出す（現行の日程表 QR は per-person 提出トークン `buildSubmissionUrl`＝`/s/{token}`）。
- **提出済みでも `showSubmittedQr`（同期経路は常に true）が立てば QR を出し続け、「提出済」バッジを併記**する（再提出・確認用。QR を消すと保護者が再確認・訂正提出できないため）。
- QR SVG は payload 肥大を避けるため**遅延生成**（初回 payload に qrSvg を埋めず、opener の `__buildScheduleQrSvg` 経由で生成しキャッシュ）。

### J-2. 旧 LessonScheduleTable 連携 QR のデッドコード（2026-07-04 監査領域9 B9/C3 確定・オーナー確認済み）

- `scheduleQrConfig.ts` の **legacy 群**（`createLegacyLessonScheduleQrConfig`／`buildLegacyLessonScheduleAvailabilityUrl`／`resolveCurrentLegacyLessonScheduleShortUrl`・既定 `schoolNamePattern:'テスト教室2'`）は、**撤廃済み旧 J 仕様（旧・外部日程表サイト LessonScheduleTable 連携）の残骸のデッドコード**（src の非テストコードから呼ばれない）。
- 既定値に「テスト教室2」が残るのは J『テスト教室2限定撤廃』の主目的に反する痕跡のため、**コードごと撤去を dev-fix 起票済み（2026-07-04）**。
- 現行の日程表 QR は per-person 提出トークン（`buildSubmissionUrl`）＝上述 J-1 が正。

## K. 色（③と整合）

- **配布する日程表も色分けを撤廃**（コマ表と揃える）。
- 通常/振替/講習は **`通)` / `振)` / `講)` 等のラベル表記**で区別する。
- 注意の赤テキストは残す（＝**連絡事項テキスト**。印刷でも残す）。ただし回数表の**警告スタンプ**は印刷では非表示＝別物（上述 E の印刷出し分けを参照。2026-07-04 監査領域9 B2 確定）。

## L. 盤面連動（移動ハイライト・講師帰属）（2026-07-04 監査領域9 B10 確定・オーナー確認済み）

- 盤面で生徒を移動中は、日程表の該当コマを**青枠強調**する（`highlightedStudentSlot`／`is-moving-highlight`）。講師ハイライト（`highlightedTeacherId`）も日程表セルへ反映する。
- ⚠️ **消してはならないガード**：**同コマ内で別講師へ移動した生徒は、基本データ行由来の旧講師に帰属させず、実際の机の講師に載せる**。`resolveRegularTeacherIds` が `sameDayMoveSourceDate===cell.dateKey || makeupSourceDate===cell.dateKey` の生徒を除外する（**v1.5.388**・memory teacher-schedule-regular-teacher-ids）。過去に**旧講師ページへ二重表示した回帰の意図的ガード**なので消さないこと。
- status 由来の移動日付表示ガード（移動先に前生徒の移動日付を滞留させない・memory move-date-inheritance）も併存する。

## M. 埋め込みクライアント JS の制約（保守運用の必須注意）（2026-07-04 監査領域9 B11 確定・オーナー確認済み）

- 日程表 HTML（`createScheduleHtml`）は、ページ全体をバッククォートのテンプレートリテラルで返し、`<script>` 内の数千行のクライアント JS を**リテラル文字列**として生成する（**tsc/vite は中身を構文解析しない**）。
- ⚠️ **構文崩れはビルド緑のまま実行時に全停止**（生徒/講師表示・選択肢・ボタン全停止）する。過去に空フォーマット印刷の `\'` 崩れで実発生（memory schedulehtml-embedded-script）。次を守ること：
  - `\'`／`\"`／バッククォート／`${` をリテラルに持ち込まない。**動的 script は `'<scr'+'ipt>'` のように分割**する。
  - 正規表現は**二重エスケープ**が必要。
  - 回帰防止テスト **`scheduleHtml.test.ts` の `new Function` 構文検証を消さない**（唯一の自動ゲート）。
  - **埋め込み JS を触る改修は staging 実機で表示確認**する（build 緑だけでは検知できないため）。
- 仕様というより保守運用の注意だが、影響が全機能停止級のため正本に明文化する。

---

## 現行からの主な差分（実装時TODO）

1. **追従同期を廃止し「最新表示」ボタン（手動更新）に一本化**（メモリ軽量化）。期間変更もこのボタンで反映。
2. 日程表セルは **actual のみ表示**（planned/managed セルは描画しない）。回数表用の planned 通常回数は `expectedRegularOccurrences`（テンプレ由来）から算出する（`plannedCells` は planned 回数に不使用のデッドだったため撤去。2026-07-04 監査領域9 A1 確定）。
3. **日程表の色分け撤廃**、ラベル表記（通)/振)/講)）で区別。
4. 講習表示に**授業時間 90/60/45**を反映。
5. 欠席不可・希望の登録を**日程表UI＋QRへ一本化**（⑦）。
6. **日程表QRを全教室表示**へ（テスト教室2限定を撤廃）。
7. planned 通常回数の基準は**テンプレート由来**（③整合）。

## 実装状況（2026-06-09・Phase 5 ⑨ 精査）

- **TODO1（最新表示ボタン）✅ 既存充足**：`scheduleHtml.ts` に `#schedule-apply-button`「最新表示」あり（期間・絞り込み・盤面最新取込を手動適用）。
- **TODO2（actualのみ）✅ 既存充足**：グリッドは actual セルを描画。planned 通常回数は `expectedRegularOccurrences`（テンプレ由来）から算出する（`plannedCells` は planned 回数に**未使用のデッド**だったため撤去。2026-07-04 監査領域9 A1 確定・オーナー確認済み・実装同日撤去）。
- **TODO3（色撤廃）✅ 既存充足**：種別の背景色なし、`通)/振)/講)` 等ラベル表記。
- **TODO4（授業時間反映）✅ 実装（2026-06-09）**：
  - 日程表セル：`formatScheduleMinutesSuffix(noteSuffix)`（60/45のみ付与・90=無し）を生徒/講師セルの科目表示へ追加（例 `算60`）。`scheduleHtml.ts` `renderStudentCellCard`/`renderTeacherCellCard`。
  - 盤面：ストック由来(session)講習の配置時に提出授業時間を `noteSuffix` として付与（`resolveSessionLectureNoteSuffix`＝`resolveLectureSubjectDuration`）。手動/自動の両配置経路。盤面表示は既存 `displaySubjectWithNote` で反映。
  - ※提出側の授業時間取込は ⑦TODO3（functions等・要デプロイ）。デプロイ前は subjectDurations 空＝全90表示。
- **TODO5（登録一本化）✅**：QR は全教室表示済（TODO6）。コマ表→別タブ欠席不可入力経路の廃止（⑦TODO1）も実装済（`specialSessionAvailabilityHtml.ts` 削除・App.tsx の sync/handler 撤去）。登録は日程表UI＋QRに一本化。
- **TODO6（QR全教室）✅ 既存充足**：`shouldShowScheduleQr()` は常に true（per-person は提出トークン有無で制御）。旧テスト教室2限定は撤廃済。
- **TODO7（planned=テンプレ由来）✅ 既存充足**：planned 通常回数は `expectedRegularOccurrences`（regularLessons＋テンプレ履歴から月次生成・active 判定込み）から算出する（テンプレ一本化＝Phase 3 と整合）。2026-07-04 監査領域9 A1 確定で「planned の唯一の根拠は `expectedRegularOccurrences`」と一意化し、未使用だった `plannedCells` payload は撤去済み。
- **残**：⑦TODO1（別タブ欠席不可入力経路の廃止）。
