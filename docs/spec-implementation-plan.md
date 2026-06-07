# 実装計画・優先順位（2026-06 全体見直しの反映）

> 各正本（`spec-*.md`）を実装に落とすための順序と段取り。
> 本番稼働中のため「安全網 → デッドコード削除 → 表示簡素化 → 核心ロジック → 高リスク移行 → 依存機能 → 仕上げ」の順で進める。
> 対象ファイルは「主な対象」。実際の変更箇所は実装時に確認する。

## 優先順位の考え方

- **データを壊さないことが最優先**。危険な変更の前に、完全復元できる JSON セーフティネットを先に作る。
- **依存関係**：③（テンプレ化・月回数撤廃）→ ④（振替再定義）・⑨（通常回数）。⑤⑦（授業時間）→ ⑨。
- **本番リスク**：④（既存残数のズレ）が最大。次いで②（保存経路）と③（盤面生成）。
- **低リスクから着手**して surface（コード量・画面項目）を減らし、核心ロジックを見通しよくしてから触る。

---

## フェーズ別ロードマップ

### Phase 0 — 安全網（最優先 / 低リスク）
1. **②: JSON フルスナップショット**（書き出し＝1教室の全状態・テンプレ含む / 読み込み＝完全復元）。← 後続の全危険変更の保険。
2. **②: 保存失敗時のJSON自動DL＋指示ダイアログ**、**離脱時の未保存ダイアログ**。

### Phase 1 — デッドコード/未使用の削除（低リスク・独立）
3. **⑧: グループ授業＋group-conflict 削除**。
4. **①: Spark廃止・アプリ内完結化**（AI分析書き出し削除・同期フォルダUI削除・developerCloudBackup撤去）。
5. **⑥: マネージャータブ削除**。

### Phase 2 — 表示・データの簡素化（低〜中リスク）
6. **色分け撤廃**（③⑨大方針）：コマ表・日程表をラベル表記（通)/振)/講)）に。表示中心。
7. **⑥: isHidden 廃止＋在籍判定を日付＋高3卒業へ**（`isActiveOnDate` の波及が広いので慎重に）。講師の出勤可能コマ・メモ・非表示も廃止。
8. **②: 保存UXの小改修**（自動保存 5s/20s、保存ボタン常時緑、オフライン時ブロック）。

### Phase 3 — 核心ロジック（高工数）
9. **③: 通常授業＝テンプレ一本化**（月契約回数・5週月・nextStudent 撤廃）。盤面生成を作り直し、ゴールデンスナップショット全面更新。開発用教室で徹底検証。

### Phase 4 — 振替ストック（最高リスク・本番移行）
10. **④: autoShortage 廃止＋欠席登録UIで明示発生**（欠席表示でコマ残す/席は操作可）。
    - ★**移行**：既存教室の残数がズレないよう確定変換 → 教室ごとに**読み取り検証** → 開発用教室で**書き込み検証** → 本番反映。

### Phase 5 — 講習・提出・日程表（依存先）
11. **⑤: 講習ストック再定義**（削除＝希望−1 / ストック＝戻す、科目・時間のコマ表編集、授業時間追加）。
12. **⑦: 提出ページ**（登録の日程表一本化、再提出モデル、授業時間、文言）。
13. **⑨: 日程表**（actualのみ表示、最新表示ボタン＝同期廃止、QR全教室、色連動、授業時間反映）。

### Phase 6 — 仕上げ
14. **②: クラウド一本化の本体**（ブラウザ内二段階廃止、復元JSONのみ、サーバー復元を開発者画面に集約）。
15. **⑧: スライダー化＋区分許可リスト**（時限優先統合・指定時限禁止・優先/制約の選択制限）。

---

## ブロック別 実装プラン

### ② 保存・復元
- **主な対象**：`src/App.tsx`（saveBoard / 自動保存 effect / queueFirebaseWorkspaceSync / 離脱・visibility ハンドラ / dev cloud backup）、`src/data/appSnapshotRepository.ts`、`src/components/backup-restore/BackupRestoreScreen.tsx`、`src/integrations/firebase/workspaceStore.ts`。
- **手順**：(0) JSON フル書き出し/読み込みを完全復元対応に拡張 →(1) 失敗時JSON自動DL＋ダイアログ、離脱時ダイアログ →(2) デバウンス5s/最大20s、保存ボタン常時緑、オフライン全面ブロック →(3) ローカル二段階廃止しクラウド一本化、教室画面の復元はJSON読込のみ（rollback/サーバー/ローカル自動の各UI削除）。
- **テスト**：フル書き出し→別環境で読み込み→完全一致。保存失敗時の挙動。オフライン遷移。
- **注意**：ローカル二段階廃止は「読込が常に正しく効く」ことを開発用教室で確認してから。

### ③ コマ表 基本配置（テンプレ一本化）
- **主な対象**：`src/components/schedule-board/ScheduleBoardScreen.tsx`（buildScheduleCellsForRange / buildManagedScheduleCellsForRange / overlay）、`src/components/basic-data/regularLessonModel.ts`（capRegularLessonDatesPerMonth・nextStudent・RegularLessonRow）、`src/components/regular-template/regularLessonTemplate.ts`、`src/App.tsx`、各 `__fixtures__` と `*Snapshot.test.ts`。
- **手順**：通常授業の生成元をテンプレートに一本化 → 月次上限ロジック撤廃（在籍期間内で毎週配置のみ）→ nextStudent 撤去 → 色分け撤廃しラベル表記 → ゴールデンスナップショット更新（差分を仕様どおりか目視）。
- **テスト**：`npm run test:unit`（boardSnapshot/scheduleOccurrences）を作り直し。フル稼働/月途中開始/退塾/休日/ペアの各 fixture。
- **注意**：④⑨の前提。ここが固まるまで④に着手しない。

### ④ 振替ストック
- **主な対象**：`src/components/schedule-board/makeupStock.ts`（autoShortage 等）、`ScheduleBoardScreen.tsx`（欠席登録UI・ストックパネル）、`__fixtures__/sampleMakeupStock.ts`、`makeupStockSnapshot.test.ts`。
- **手順**：autoShortage 自動算出を撤廃 → 欠席登録で studentId×subject に +1（origin=日付/時限、理由なし）→ 欠席はコマを残し「欠席」表示・席は操作可 → マイナス残表示廃止 → 削除/戻しの残数増減。
- **★本番移行**：現行残数（autoShortage+手動+繰越−配置）を**教室ごとに事前計測** → autoShortage 相当を明示エントリへ確定変換 → 移行前後の各 生徒×科目 残数一致を**読み取り検証** → 開発用教室で書き込み検証 → 本番反映。
- **テスト**：makeupStockSnapshot 作り直し。欠席→ストック→配置→戻し→削除の一連。

### ⑤ 講習ストック
- **主な対象**：`src/components/schedule-board/lectureStock.ts`、`ScheduleBoardScreen.tsx`、`src/components/special-data/specialSessionModel.ts`（subjectSlots に授業時間）。
- **手順**：削除＝希望−1（由来問わず未配置へ戻さない）/ ストックする＝戻す の2操作分離 → 講習コマの科目・授業時間をコマ表で直接編集可 → 授業時間90/60/45を希望データに保持。
- **テスト**：lectureStockSnapshot。削除と戻しの希望数/残数の差。

### ⑥ 基本データ画面
- **主な対象**：`src/components/basic-data/BasicDataScreen.tsx`（タブ/render）、`basicDataModel.ts`（StudentRow/TeacherRow から isHidden/availableSlots/memo、isActiveOnDate）、`src/App.tsx`（managers 初期値）、Excel 入出力。
- **手順**：マネージャータブ削除 → 生徒 isHidden 廃止＋在籍判定（入塾/退塾/高3卒業）→ 講師の出勤可能コマ・メモ・非表示 廃止 → 祝日/強制開校UIは置かない → Excel シートをテンプレ方式へ整理。
- **テスト**：`basicDataModel.test.ts` の在籍判定（高3卒業境界）。billing/日程表など isActiveOnDate 呼び出し側の整合。
- **注意**：`isActiveOnDate` の signature 変更が billing.ts / scheduleHtml.ts など多数へ波及。

### ⑦ 特別講習データ・提出
- **主な対象**：`src/components/submission/SubmissionPage.tsx`、`src/integrations/firebase/lectureSubmission.ts`、`functions/`（submission API）、`src/components/special-data/SpecialSessionScreen.tsx`、`src/App.tsx`。
- **手順**：登録経路を日程表＋QRに一本化（コマ表→別タブ欠席不可入力を廃止）→ 再提出モデル（登録削除でリセット→同QR再提出、登録確定後は不可）→ 授業時間90/60/45を提出に追加（科目ごと・既定90）→ 既提出「すでに提出済みです」/無効リンク文言追記。
- **テスト**：`lectureSubmission.test.ts`。提出→ロック→登録削除→再提出。

### ⑧ 自動割振ルール
- **主な対象**：`src/components/auto-assign-rules/autoAssignRuleModel.ts`、`AutoAssignRuleScreen.tsx`、`src/types/pairConstraint.ts`、グループ授業関連の型/データ。
- **手順**：グループ授業＋group-conflict 削除 → 時限優先3ルールをスライダー1ルールへ統合 → 1限禁止→指定時限禁止（スライダー）→ 区分を優先/制約の2区分・ルールごと許可リストで制限・絶対事項は固定/編集不可 → ペア制約の区分（既定=制約、優先に変更可）。
- **テスト**：`autoAssignRuleModel.test.ts`。許可リスト外区分を選べないこと。

### ⑨ 日程表・PDF
- **主な対象**：`src/utils/scheduleHtml.ts`、`src/utils/pdf.ts`、`ScheduleBoardScreen.tsx`（popup 起動・最新表示ボタン）、`src/App.tsx`。
- **手順**：セルは actual のみ表示（回数表用 planned は算出）→ 追従同期を廃止し「最新表示」ボタン（期間変更もこれで反映）→ 色撤廃しラベル表記 → 授業時間反映 → QR全教室表示 → 通常/講習の警告スタンプは残す。
- **テスト**：`scheduleHtml.test.ts`。最新表示ボタンでの反映、算/数 出し分け、PDFにストック非混入。

### ① 教室権限・ログイン
- **主な対象**：`src/components/developer-admin/DeveloperAdminScreen.tsx`（authMode/sparkManualAdminMode 多数）、`src/integrations/firebase/adminFunctions.ts`、`src/integrations/firebase/config.ts`、`functions/`。
- **手順**：Spark 分岐を撤去し Blaze 一本 → 教室追加・管理者発行/削除/メール変更をアプリ内（Functions）で完結 → AI分析書き出し削除 → Google Drive/ブラウザ同期フォルダの設定UI削除（サーバー側スケジュール同期は残す）→ パスワード文言を「パスワードリセットまたはパスワード変更」に。
- **テスト**：教室追加/削除/管理者更新の一連が開発用ワークスペースで通ること。
- **注意**：本番教室への書き込みは禁止。検証は開発用教室のみ。

---

## 共通の進め方（毎回）

- 変更後は `npm run build`。振替/PDF/盤面ロジックを触ったら `npm run test:unit`。
- 本番教室は読み取り専用。書き込み検証は開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ。
- 仕様を変えたら該当 `spec-*.md` と README/開発ルールを同じ変更で更新。
