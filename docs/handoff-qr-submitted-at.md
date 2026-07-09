# 引き継ぎ: QR提出時刻の解析と講習集計結果への組み込み

作成: 2026-07-06（講習巻き戻り不具合対応セッションからの引き継ぎ）
オーナー依頼: 「本番データのQRの提出時間と、ユーザーからの問題報告の時間を見比べたい。
講習集計結果の画面にQRの提出時間を組み込むのと、その解析について別セッションで進めたい」

> **ステータス（2026-07-07 更新）**: タスク1は実施済み。結果は
> `docs/analysis-qr-submitted-at-2026-07-06.md` 参照。要旨: 障害教室は日大前校で確定・
> A4 は 15:25 障害の発火経路ではない（7/6 はトークン発行ゼロ）・被害生徒は提出済み(取り消し
> なし)と判明したため**最有力は A3（stale 書き戻し・`a0dba9f`）**。v1.5.396 で修正済み。
>
> **ステータス（2026-07-09 更新）**: タスク2 実装済み（branch `feature/lecture-summary-submitted-at`）。
> 講習集計結果に「提出日時」「提出方法」の2列を追加＋講師日程にも集計結果ボタンを新設。
> 仕様確定点: 方法は最後の操作で決まる（QR提出=`qr` / 室長の登録操作=`manual`）・既存データは `—`・
> 遡及バックフィルなし（本番書き込み回避）・JST表示・後方互換 optional。希望科目は生徒版のみ残し講師版は非表示。
> 詳細は CHANGELOG「未リリース」。staging 実機確認→本番マージが残（safe-release）。

---

## 0. 背景（このセッションで確定した事実）

2026-07-06、「講習を自動割振したのに数分後/アプリ再開時に未配置へ戻り、未消化講習が復活する」
不具合を修正した（本番 v1.5.396 で稼働中・詳細は CHANGELOG 1.5.396 と下記コミット）。

**確定した真因（A4）**: `ensureScheduleSubmissionTokens`（QRトークン自動発行）が、関数開始時点の
session スナップショットで `setSpecialSessions` を丸ごと置換していたため、`await writeSubmissionDocs`
（ネットワーク書き込み）中に届いた**別生徒のQR提出反映**（subscribeLectureSubmissions →
countSubmitted=true）を巻き戻し、その生徒が未提出扱いになり未提出配置除去 effect が割振済み講習を
外していた。発火には3条件が同時に必要:

1. **未発行のQRトークンが残っている**（発行対象が居ないと await 自体が発生せず窓が開かない）
2. その数百ms〜数秒の間に**別の生徒・保護者のQR提出がリアルタイムで届く**
3. 巻き戻された生徒に**割振済みの講習がある**

→ **このセッションの解析タスクの目的**: 本番の `lectureSubmissions` の `submittedAt`（QR提出時刻）と、
ユーザーの問題報告時刻を突き合わせ、「報告された巻き戻りの直前（数分以内）に同教室で別生徒の
QR提出が発生していた」ことを確認し、A4真因説の実データ裏付けを取る。

関連コミット（main 取り込み済み）: `9bafd01`（初回評価バグ）/ `a0dba9f`（A3版数ゲート）/
`8f80f5d`（A4本体+除去基準厳密化）/ `b99028c`（A4配線ガード）/ `934d11e`（確定仕様の正本化）。
関連正本: `docs/spec-special-session-submission.md`（E-2b: 登録解除の in-app 挙動・2026-07-06確定）/
`docs/spec-lecture-stock.md`（§5-1）/ `docs/spec-makeup-stock.md`（§2）。

---

## タスク1: 提出時刻 × 問題報告時刻の突き合わせ解析（読み取り専用）

### データの所在

- Firestore コレクション **`lectureSubmissions`**（トップレベル・docID=token）。
  型は `src/integrations/firebase/lectureSubmission.ts` の `LectureSubmissionDoc`:
  `workspaceKey / classroomId / sessionId / personType('student'|'teacher') / personId / personName /
  status('pending'|'submitted') / submittedAt(ISO文字列|null) / createdAt` ほか。
- **`submittedAt` はこのdocにしか無い**（アプリ内 `session.studentInputs` へは未搬送。
  `updatedAt` は反映時刻であり提出時刻ではない点に注意）。
- 注意: 登録解除（`resetLectureSubmissionDoc`）で `status='pending'`・`submittedAt=null` に戻り、
  再提出で上書きされる。**過去の提出時刻は解除/再提出で失われている可能性がある**。
  ワークスペースの毎時/日次バックアップは classroomSnapshots 系のみで `lectureSubmissions` を含まない。
  → 解析は「現存する submittedAt」で行い、欠損があり得ることを明記して報告する。

### 手順（案）

1. オーナーから入力をもらう: **問題報告の一覧（教室・おおよその発生/報告時刻・可能なら生徒名）**。
2. 対象教室の `lectureSubmissions` を読み取り専用で取得し、`status=='submitted'` の
   `submittedAt` を時系列に並べる（classroomId でフィルタ）。
3. 各報告時刻の直前（〜数分）に同教室で**別生徒の提出**があるかを照合。
   併せて件数の時間分布（中学生の講習期間はQR提出が頻発、の裏付け）も出す。
4. 結果を表にして報告。裏付けが取れれば A4 真因説の実証完了、取れなければ欠損（解除/再提出）や
   別要因の可能性を明記。

### アクセス手段の制約（重要）

- **Claude の実行サンドボックスには Firebase 認証情報が無い**（CLAUDE.md 記載）。到達手段の候補:
  (a) オーナーの認証済みPCで読み取り専用スクリプトを実行してもらい、結果JSONを渡してもらう
  (b) Firebase コンソールで対象教室の docs をエクスポートしてもらう
  (c) セッション環境に認証があるならREST/SDKのGETのみ
- **本番データ保護ルール厳守**: 書き込み・復元・コピー系は一切禁止。読み取り（GET/list）のみ。
  対象は本番3教室の読み取りに限る（CLAUDE.md の教室一覧参照）。

---

## タスク2: 講習集計結果 画面にQR提出時刻を表示する（機能追加）

### 現状の実装ポインタ（2026-07-06 時点・v1.5.401 基準）

- 画面は生徒日程表 popup 内の「講習集計結果」ボタン → `src/utils/scheduleHtml.ts`
  - ボタン: `schedule-lecture-summary-button`（:2256 付近）
  - 本体: `buildLectureSummaryHtml`（:5409 付近）。表は No. / 生徒名 / 登録状況 / 希望科目(授業時間) の
    **4列**（v1.5.401 で「希望科目(授業時間)」列 `formatDesiredSubjectsWithDuration`（:5379）が追加済み。
    提出時刻の列はこの隣に足すのが自然）
  - 判定純関数: `resolveLectureRegistrationStatus`（countSubmitted/regularOnly → 登録/通常のみ/未登録。
    `scheduleHtml.test.ts` が new Function 抽出でテスト済み。同ファイルの既存テスト方式を踏襲する）
  - データ源: popup へ渡る `DATA.specialSessions[].studentInputs`。
    **注意**: payload には serialize で載せたフィールドしか届かない。v1.5.400 で
    「subjectDurations が serialize から欠落して分数が出ない」不具合が実際に起きた前例があるため、
    submittedAt を追加する際は `buildSerializedSchedulePayload`（SerializedStudentSpecialSessionInput）
    への追加と payload 回帰テストを必ずセットにすること
- **scheduleHtml.ts は埋め込みJS・エスケープが地雷**（正本 spec-schedule-pdf.md に「埋め込みJS制約」
  の注記あり）。編集時は既存の文字列組み立てスタイルを踏襲し、`escapeHtml` を必ず通すこと。

### データモデルのギャップ（設計の核心）

`submittedAt` は Firestore doc にしか無いため、表示するには **studentInputs へ搬送する** 必要がある。
搬送経路は3つ全てを揃えないと表示が欠ける:

1. **QR提出のサーバー側マージ**: `functions/src/index.ts` `lectureSubmissionApi`（POST・:2200付近）が
   snapshot の `inputs[personId]` に `countSubmitted:true` を書く箇所 → `submittedAt: now` を追加
2. **クライアントの購読反映**: `src/App.tsx` `subscribeLectureSubmissions` ハンドラ（:3849付近）と
   `SubmissionChangeEntry`（`lectureSubmission.ts`）に submittedAt を追加して反映
3. **室長の代行登録**: popup の登録モーダル（`schedule-student-count-save` ハンドラ・App.tsx:3556付近）
   → ここで入れる時刻を「提出時刻」と呼ぶかは仕様判断（下記）

**着手前に spec-curator で確定すべき仕様点**:
- 室長が代行登録した場合の表示（「提出時刻」として室長操作時刻を出すか、「代行」と区別するか）
- 登録解除→再提出の扱い（最新のみ表示で良いか）
- 既存データ（submittedAt 未搬送の登録済み生徒）の表示（空欄/「-」で良いか。過去分の遡及は
  lectureSubmissions から一括バックフィルするか＝本番書き込みを伴うため要オーナー承認）
- 表示形式（日時のフォーマット・タイムゾーンはJST表示で良いか）
- 型変更に伴う後方互換（studentInputs に optional 追加・読み込み補完で例外を出さない）

### 実装の進め方（標準フロー）

spec-curator（仕様確定・正本 spec-special-session-submission.md 更新）→ dev-fix（実装+テスト同コミット）
→ regression-reviewer → safe-release。テストは `resolveLectureRegistrationStatus` と同様に
純関数化＋`scheduleHtml.test.ts` の文字列/抽出テスト方式を踏襲。
`functions/**` を触るため、main マージで **Deploy Cloud Functions が自動発火**する点に注意
（ホスティングCIは functions を出さない・CLAUDE.md 参照）。

---

## 次セッションの始め方（例）

1. このファイルを読む → タスク1から着手（オーナーに報告時刻一覧とデータ取得手段を確認）
2. タスク2は spec-curator の仕様確定から。上記「確定すべき仕様点」をそのまま壁打ちに使う
3. 作業ブランチは新規に切る（例: `claude/qr-submitted-at-<suffix>`）。CLAUDE.md・
   solo-git-workflow・本番データ保護ルールを厳守
