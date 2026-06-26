# 引き継ぎ資料：生徒日程表「オプション欄」機能（開発用教室のみ）

最終更新: 2026-06-26 / ブランチ: `claude/koma-schedule-options-field-0hia1q`

このファイルだけ読めば、この機能の状態・残作業・デプロイ手順が分かるようにまとめてある。

---

## 0. 一言サマリ

生徒日程表の **休み欄を削除**し、**振替授業欄を左に詰め**、空いたスペースに **オプション欄（2列5行）** を追加した。
左列＝学年共通のテキスト入力、右列＝QR提出のチェック状態（✓）。**開発用教室（`開発用教室`）でのみ有効**。

実装は2フェーズとも**コード完了・テスト緑・ビルド成功・プッシュ済み**。
残るは **デプロイのみ**（フロントは main マージで自動、Cloud Function だけ PC で手動）。

---

## 1. ブランチとコミット

- ブランチ: `claude/koma-schedule-options-field-0hia1q`（origin にプッシュ済み）
- コミット:
  - `4c90e82` feat: 休み欄削除＋オプション欄(2列5行)追加（第1フェーズ：レイアウト＋文言入力）
  - `9918514` feat: オプション欄のQRチェック往復を実装（第2フェーズ）
  - （本ドキュメント追加コミット）

---

## 2. やったこと（仕様）

ユーザー指示の確定事項:
- オプション左列テキストは **学年で共通**（共通連絡事項(学年別)と同じ `scheduleNotes` の仕組み）。
- 右列は **チェックマーク1文字分**の細い列、左列を大きく。
- 右列は **QR提出のチェック状態**を反映。**既定は未チェック**。
- QR画面では **集団の下** にオプション欄（文言＋チェックボックス）を表示。
- **まず開発用教室のみ**。

### 第1フェーズ（レイアウト＋文言入力）
- `src/utils/featureRollout.ts`：`studentScheduleOptionField`（scope=`development-only`）を追加。
- `src/utils/scheduleHtml.ts`：`renderBottomSection` を分岐。フラグONで休み欄を出さず、
  `共通連絡事項｜個別連絡事項｜振替授業｜オプション｜回数` の並びに。`renderOptionSection`（2列5行）追加。
  - 左列の note キー: `student-option-grade-{学年}-{行0..4}`（保存形式は `student:` プレフィックス付き）。
- `src/components/schedule-board/ScheduleBoardScreen.tsx`：`isFeatureEnabledForClassroom(..., { name: classroomName })`
  で判定し、`optionFieldEnabled` を各 schedule 呼び出しへ渡す。

### 第2フェーズ（QRチェックの往復）
既存の集団参加（`groupClassParticipation`）と**同じ経路**に載せた。
- `src/integrations/firebase/lectureSubmission.ts`：提出ドキュメントに `optionLabels`（学年共通文言）/
  `optionChecks` を追加。reset・購読（`SubmissionChangeEntry`）・既発行QRの後埋め
  （`updateSubmissionOccupiedSlots`）にも反映。
- `functions/src/index.ts`（**Cloud Function `lectureSubmissionApi`**）：GET で `optionLabels`/`optionChecks`
  を返却、POST で `sanitizeOptionChecks`（非空ラベル行のみ true を保存）→ スナップショットの
  `studentInputs` へマージ。
- `src/App.tsx`：開発用教室のときだけ `scheduleNotes` から学年共通文言を解決して提出ドキュメントへ載せる。
  購読マージで `optionChecks` を `studentInputs` へ反映。
- `src/components/submission/SubmissionPage.tsx`：集団授業の下に「オプション」欄。文言のある行のみ
  チェックボックス表示、提出時 `optionChecks` 送信、提出済み画面は あり/なし の読み取り表示。
- `src/utils/scheduleHtml.ts`：重なるセッションの `studentInput.optionChecks` を直列化生徒へ載せ、右列に✓描画。
- `src/components/special-data/specialSessionModel.ts`：`SpecialSessionStudentInput.optionChecks` 追加。

### データの流れ（往復）
```
室長: 生徒日程表オプション左列に文言入力（学年共通・scheduleNotes）
  → QR発行/同期時に学年→文言を解決し lectureSubmissions ドキュメントへ optionLabels として保存
保護者/生徒: QR画面「オプション」でチェック → POST optionChecks
  → Cloud Function が sanitize して保存＋スナップショット studentInputs へマージ
室長アプリ: subscribeLectureSubmissions で optionChecks を studentInputs へ反映
  → 生徒日程表オプション右列に✓表示（重なるセッションの値を使用。既定=未チェック）
```

---

## 3. デプロイ手順（ここが重要）

CI（`.github/workflows/deploy-firebase-hosting.yml`）は **`main` への push で `--only hosting` のみ**自動デプロイする。
**Cloud Function は CI ではデプロイされない。**

### 3-1. フロント（ホスティング）＝スマホだけでも可
このブランチを `main` にマージすれば CI が自動でホスティングをデプロイする
（休み欄削除・オプション欄レイアウト・QR画面のオプションUI が反映される）。

### 3-2. Cloud Function ＝ PC で手動（必須・担当: オーナー）
QRチェックの「保存・返却・反映」を動かすには `lectureSubmissionApi` のデプロイが必要。
**未デプロイでもフロントは動く**が、QRでチェックしても右列に✓が反映されない（保存もされない）。

PC（Firebase 認証あり）で、リポジトリのルートで:
```bash
# 関数のみをデプロイ（推奨・最小影響）
npm --prefix functions run build
npx firebase-tools deploy --project komahyouapp-prod --only functions

# もしくは hosting/firestore も含めてまとめて（ローカルの正規フロー）
npm run deploy:firebase:with-functions
```
> `npm run deploy:firebase:with-functions` は内部で `build:functions` 後に
> `hosting,firestore,functions` をデプロイする（`tools/deploy-firebase.mjs`）。

### 3-3. デプロイ順序の注意（後方互換なので順不同で安全）
全変更は **後方互換**（フィールドは optional・既定空、既存の集団参加と同じ規約）。
フロント先行でもCloud Function先行でも、他教室・既存機能には影響しない。
完全動作には **両方** のデプロイが必要。

---

## 4. 検証状況（このセッションで実施済み）

- 型チェック: app（`tsc -b`）/ functions（`functions/` で `tsc`）ともにOK。
- ユニットテスト: **377 件すべてグリーン**（`npx vitest run`）。回帰防止テストを追加:
  - フラグの有無でレイアウト出し分け（休み欄/オプション欄）。
  - 提出セッションの `optionChecks` が直列化生徒→DATA→右列✓描画に流れること。
- 本番ビルド: app `npm run build` / functions `npm --prefix functions run build` 成功。
- Lint: 変更による新規エラー 0（既存エラー件数のみ）。
- 目視（Playwright/Chromium）:
  - 生徒日程表: 休み欄が消え、振替が左詰め、オプション欄が2列5行で表示。
    `optionChecks:{'0':true,'2':true}` が右列で `[✓, , ✓, , ]` に描画されることを確認。
  - QR画面(`#/submit-debug`): 「集団授業」の下に「オプション」欄。文言のある行のみチェックボックス表示を確認。

---

## 5. 仕様メモ・既知の注意点

- **開発用教室判定**は `isDevelopmentClassroom`（教室名に「開発用教室」を含むか等）に依存。
  本番教室では従来どおり休み欄が残る。
- **どのセッションのチェックを表示するか**: 既存の `findOverlappingSession`（表示期間に重なる講習）に従う。
  集団参加・提出済みバッジと同じ挙動。
- **学年共通文言の後埋め**: 文言は QR 発行時にドキュメントへスナップショットされるが、
  後から文言を編集しても `updateSubmissionOccupiedSlots`（盤面同期時に走る）で未提出QRへ反映される。
- **右列は表示専用**（室長が手でチェックする欄ではない）。チェックは QR 経由のみ。
- `optionLabels`/`optionChecks` は他教室でも空で保存されうるが、これは既存の
  `groupClassParticipation: {}` / `availableGroupClassSubjects: []` と同じ規約で**無害**。

---

## 6. 次フェーズ候補（未着手・必要なら）

- 全教室への展開（`featureRollout` を `all-classrooms` に昇格）。本番で検証後に。
- オプション文言の専用管理UI（現状は生徒日程表の左列に直接入力）。
- スマホだけで関数デプロイしたい場合: `workflow_dispatch` の手動トリガー Actions を追加すれば
  GitHubモバイルから関数デプロイ可能（要・サービスアカウントへの関数デプロイ権限）。
