# トータルレビュー結果（2026-06-12）— 改修タスク台帳

> オーナーと Claude で実施したトータルレビューの合意版。**別セッションで1件ずつ改修する**ための作業台帳。
> 各項目は「冷たい状態（このチャットの記憶なし）の別セッションが、これだけ読めば着手できる」粒度で書く。

## 0. 着手前に必ず守ること（全項目共通）

- **本番データ保護**：本番3教室（日大前 `5w5OMueETerSKrSf14HC` / 緑が丘 `KzFnOQoTFLsCxwUp1tvh` / 薬円台 `6xnnbSTbwgGrBLy0EJKb`）は**読み取り専用**。書き込み検証は**開発用教室 `v8OZ7zH8vONNHjjYVcR1` のみ**。（`CLAUDE.md` 参照）
- **回帰防止**：既存ロジックを書き換える前に `git log -L` / `git blame` で「過去に何を直したか」を確認。`{ ...a, ...b }` への単純化で過去の補完を消さない。**バグを直したら回帰テストを必ず追加**（修正なしで落ち・修正ありで通る）。（`memory/komahyou-no-regression-rule.md` 参照）
- **保存はCloud Functions一本化**：`saveClassroomSnapshot` 経由が正本。テスト（`npm run test:unit`、現在288件）グリーン維持・`__snapshots__/*.snap` は理由なく変えない。
- **コミット/デプロイはオーナー指示後**。

## 1. 前提となる運用方針（オーナー決定済み）

- **「1教室 ＝ 1端末」での編集を基本ルールとする。** 同じ教室を複数端末で同時編集する運用は想定しない。
- ただしルールは人が破りうる（PC変更・スマホ併用等）。そのときに**黙ってデータが消えるのは不可**。アプリ側は「古いデータでの上書きを検知してエラーで止め、再読み込みを促す」**安全網を必ず持つ**（→ 項目 A1）。

---

## 優先順位（合意済み）

| 順 | ID | 重大度 | 一言 |
|---|----|--------|------|
| 1 | A2 | 高 | タブを隠した瞬間の「無変更でも丸ごと送信」をやめる（放置タブ上書きの即効薬） |
| 2 | A1/B1 | 最重要 | サーバー側で「古いデータの上書き」をブロック（多端末事故の本丸） |
| 3 | A3 | 中 | 保存の“裏口”（クライアント直書き権限）を閉じる |
| 4 | B3 | 中 | 未コミットのQR提出改善を、回帰テスト追加のうえ仕上げてリリース |
| 5 | C1 | 中 | 画面分割読み込みで初回表示を高速化 |
| 6 | B2 / A4 | 低 | 死蔵コード削除・保存試行ログの掃除（整理整頓） |
| 7 | C2 | 低（長期） | 巨大ファイルの段階的分割（テスト強化とセット） |

---

## A2【高・最優先】タブを隠した瞬間の「無変更でも丸ごと送信」を止める

### 症状（非エンジニア向け）
ブラウザが「タブが隠れた」と判定する瞬間（別タブへ切替・別アプリへ切替・最小化）に、毎回**変更の有無を確認せず**教室データを丸ごとクラウド送信している。閉じるときの処理には「変更があるときだけ送る」チェックがあるのに、**隠すときの処理にはそれが抜けている**。これが「朝開いて放置したタブが、夕方ちょっと触っただけで昼の編集を上書きする」事故の引き金。

### 直し方
`src/App.tsx` の `handleVisibilityChange`（おおよそ L3798〜3806）に、`handleBeforeUnload`（L3771〜3793）と**同じ未変更チェック**を入れる。

```
// 現状：visibilitychange は無条件で送信している
const handleVisibilityChange = () => {
  if (document.visibilityState !== 'hidden') return
  ...
  const snapshot = buildWorkspaceSnapshot(new Date().toISOString())
  markPendingRemoteWorkspaceSnapshotSync(...)
  void saveWorkspaceSnapshot(snapshot).catch(() => {})
  queueFirebaseWorkspaceSync(...)   // ← 変更がなくても走る
}
```
→ `buildCurrentDataSignature() !== cleanSignatureRef.current`（＝未保存変更あり）の場合のみ送信する。`handleBeforeUnload` が既に同じ判定をしているので、それに合わせる。

### 注意・検証
- ローカル退避（IndexedDB / localStorage）は残してよい（壊れない・コストが小さい）。**クラウド送信（`queueFirebaseWorkspaceSync`）だけを未変更時にスキップ**するのが狙い。
- 回帰テスト：`hasPendingBoardSaveState` 等の既存ヘルパに倣い、「未変更ならクラウド送信が呼ばれない／変更ありなら呼ばれる」を確認するユニットテストを追加。
- **これはA1の完全代替ではない**（A2は「無変更の放置タブ」を止めるだけ。実際に編集した古い端末の上書きはA1で止める）。

### 触るファイル
- `src/App.tsx`（`handleVisibilityChange`）

---

## A1 / B1【最重要】サーバー側で「古いデータの上書き」をブロックする

### 症状（非エンジニア向け）
別端末で保存された最新データは、こちらの画面にはログインし直すまで反映されない。その状態でこちらが保存すると、相手の編集を**黙って上書きして消す**。1教室1端末ルールを守れば起きないが、ルールが破られたときに**データが静かに消えるのは許容できない**。

### 方針
1教室1端末ルールを「基本」とし、**違反時はデータを消さずエラーで止める**安全網をサーバー側に実装する。＝「あなたが画面に読み込んだ後に、別の誰かが保存しています。再読み込みしてください」と表示して保存を拒否する。

### ⚠️ 実装上の最重要落とし穴（必読）
**単純な「保存時刻（savedAt）の新しい・古い比較」では事故を防げない。**
- 例：端末Aが12:00に保存。端末B（11:00に読み込み済み）が13:00に編集して保存。Bの savedAt(13:00) は Aの savedAt(12:00) より**新しい**ので、時刻比較は素通りし、**Aの編集を知らないBがAを上書き**してしまう。
- 正しい方式は**楽観ロック（optimistic concurrency）**：
  - サーバーは教室スナップショットに**単調増加するバージョン番号（または更新トークン）**を持たせる。
  - クライアントは「自分が読み込んだ時点のバージョン `baseVersion`」を保存リクエストに付ける。
  - サーバーは「現在のバージョン == `baseVersion`」のときだけ保存を許可し、`version` を +1。違えば `failed-precondition` で拒否。
  - クライアントは拒否を受けたら上書きせず、「別端末で更新されています。再読み込みしてください」を表示。

### 直し方（目安）
- サーバー：`functions/src/index.ts` の `saveClassroomSnapshotFromCallable`（L1498〜1609）。
  - 既に `previousSnapshot` を読んでいる（L1542）。ここに `version`/`baseVersion` 照合を追加。
  - **既存の安全装置を壊さないこと**：`saveId` による冪等リプレイ（同一内容の再送は成功扱い・L1518〜1536）、`assertNoSnapshotDataLoss`（空データ上書き拒否・L1543）、読み戻し検証（L1576〜1589）は維持。冪等リプレイは同一 `saveId` なので version 照合より前に通す。
  - 「前回終了時の未同期データ復元」フロー（`resolveRemoteWorkspaceSnapshot` / pending marker）が**正規の後追い保存で誤って弾かれない**ことを確認（この経路は remote より新しいローカルを送る設計＝baseVersion を正しく引き継げば問題ないはず。要テスト）。
- クライアント：`src/integrations/firebase/adminFunctions.ts` の `saveClassroomSnapshotViaFunction` と、`src/App.tsx` の `queueFirebaseWorkspaceSync`（L1614〜1789）で `baseVersion` を持ち回り、拒否時のUI（再読み込み案内）を追加。読み込み時に `version` を保持しておく（`loadFirebaseWorkspaceSnapshot`：`src/integrations/firebase/workspaceStore.ts`）。

### 注意・検証
- **開発用教室で**、2つのブラウザプロファイルを使った手動再現（A保存→B古いまま保存→Bが拒否される）を確認。
- 冪等リプレイ・pending復元・空データ拒否の既存テストが落ちないこと。新規に「stale base で拒否」「正しい base で成功」の回帰テストを追加。
- B1（別端末の最新を画面へ自動反映＝リアルタイム同期）は**今回はやらない**。1教室1端末ルール＋A1の拒否で運用上は足りる。将来必要になったら別タスク化。

### 触るファイル
- `functions/src/index.ts`（保存ハンドラ）
- `src/integrations/firebase/adminFunctions.ts`、`src/integrations/firebase/workspaceStore.ts`、`src/App.tsx`（version の保持と拒否時UI）

---

## A3【中】保存の“裏口”（クライアント直書き権限）を閉じる

### 症状（非エンジニア向け）
保存は Cloud Functions 経由に一本化済みだが、データベースの権限設定上は**今でもアプリから直接書き込める**ままになっている。安全装置（空データ拒否・読み戻し検証・A1のバージョン照合）を**素通りする経路**なので塞ぐべき。

### 直し方
`firebase/firestore.rules`。`classroomSnapshots` とそのサブコレクション（`chunks` / `parts` / `boardWeeks`）、および `classroomSettings` の `create, update` を**クライアントから不可**にする（Cloud Functions は Admin SDK でルールを迂回するため正規保存は影響を受けない）。

```
match /classroomSnapshots/{classroomId} {
  allow read: if canAccessClassroom(...);
  allow create, update: if canAccessClassroom(...);   // ← これを false にできるか検証
  ...
}
```

### ⚠️ 着手前の必須確認
- **クライアントから `classroomSnapshots` / `classroomSettings` を直書きしている箇所が本当に無いか**を grep で確認してから閉じる（確認した限り client 直書きは `boardShares` / `lectureSubmissions` / `billingMonths` のみで、これらは別ルール。だが念のため再確認）。
- `boardShares`（配布用盤面）と `lectureSubmissions`（QR提出）は**クライアント直書きが正規**なので閉じない。
- 閉じたあと、開発用教室で「保存→読み戻し→別ログインで反映」が通ることを確認。Firestore ルールはデプロイ反映に時間差があるので注意。

### 触るファイル
- `firebase/firestore.rules`

---

## B3【中】未コミットのQR提出改善を、回帰テスト追加のうえ仕上げてリリース

### 内容（現在 working tree に未コミットで存在）
1. QR提出ページに**休日（`holidayDates`）を反映**：定休日に加え、コマ表で個別設定した休日も「休校日」として提出不可にする。既発行トークンにも後から伝播。
2. 提出後／既提出リンクで、**提出済み内容を閲覧専用（編集不可）で表示**するビューを追加。
3. 休校日セルを**1セル結合で「休校日」表示**に変更。
4. 起動・教室切替の**直後の初回スナップショットを「新着QR提出通知」から除外**（過去の提出を新着として誤通知しない）。`subscribeLectureSubmissions` に `isInitial` を追加し、`isInitial` のときは通知を出さずデータ反映だけ行う。

### 状態
- `npm run test:unit`（288件）グリーン・`npm run build` 成功は確認済み。
- **不足：上記4点それぞれの回帰テストが無い**。特に (4) の「初回は通知しない／2回目以降は通知する」、(1) の「holidayDates が提出不可に反映される」をユニットテスト化してから commit。

### 触るファイル（差分のあるファイル）
- `functions/src/index.ts`、`src/integrations/firebase/lectureSubmission.ts`、`src/components/submission/SubmissionPage.tsx`、`src/App.tsx`、`src/App.css`、`src/utils/scheduleHtml.ts`
- ※ `functions/src/index.ts` の差分（`holidayDates` 受け渡し）を含むため、デプロイは `:with-functions` 系が必要になる可能性。`docs/SESSION-HANDOFF.md` のデプロイ手順を確認。

---

## C1【中】初回読み込みの高速化（コード分割）

### 症状
アプリ本体が単一チャンク約1.37MB（gzip 366KB）でビルド警告が出る。初回表示が重い（2回目以降はキャッシュが効く）。

### 直し方
- 画面単位の遅延読み込み（`React.lazy` / 動的 `import()`）。特に重いのは `BoardShareScreen`（380KB）・`xlsx`（429KB・請求/取込でしか使わない）・`SubmissionPage`。
- まず **xlsx と請求・配布まわりを遅延化**するだけで初回チャンクを大きく削れる（普段の盤面操作に不要なため）。
- `vite.config.ts` の `manualChunks` 併用も可。

### 注意
- 挙動不変。遅延読み込みの境界でちらつき/未ロード時の表示を確認。
- 既存の `share.html` / `SubmissionPage` は別エントリで既に分割済み。重複読み込みにならないこと。

### 触るファイル
- `src/App.tsx`（画面の遅延 import）、`vite.config.ts`

---

## B2 / A4【低】整理整頓

### B2：死蔵コードの整理
- `src/utils/appSnapshotSync.ts`（`createSnapshotSyncChannel`：保存をタブ間に知らせる部品）は**どこからも import されていない**。タブ間で「保存されたよ」を反映する将来機能の名残。→ **削除**するか、必要なら正しく接続するか決める（現状の1教室1端末方針なら削除でよい）。

### A4：保存試行ログの掃除
- 保存のたびに `classroomSnapshots/{id}/saveAttempts/{saveId}` に記録が1件残り、削除されない（`functions/src/index.ts` L1515 周辺）。すぐ実害はないが無限に増える。→ Firestore TTL ポリシー、または既存のスケジュール関数（`createWorkspaceServerAutoBackups` 等の隣）で古い `saveAttempts` を定期削除。

### 触るファイル
- `src/utils/appSnapshotSync.ts`（削除）、`functions/src/index.ts`（クリーンアップ追加）

---

## C2【低・長期】巨大ファイルの段階的分割

### 症状
`src/components/schedule-board/ScheduleBoardScreen.tsx` 約9,000行、`src/App.tsx` 約4,700行、`src/utils/scheduleHtml.ts` 約5,100行。**動作速度ではなく「修正のたびに事故りやすい」保守リスク**。

### 方針
- **一括リファクタは厳禁**（回帰の温床）。テストを増やしながら、純粋関数（割振スコア計算・警告計算・テンプレ展開など）から少しずつ別ファイルへ切り出す。
- 1回の切り出しごとにテストグリーン・スナップショット不変を確認。挙動が変わったら即中止。
- 実害が出てから／他項目が落ち着いてから着手。優先度は最後。

### 触るファイル
- 上記3ファイル（段階的）

---

## 完了の定義（各項目共通）
- `npm run test:unit` グリーン・`npm run build` 成功・型エラーなし。
- 直したバグには回帰テストが付いている（修正なしで落ちることを一度確認）。
- 開発用教室で動作確認（本番教室には書き込まない）。
- コミット/デプロイはオーナー指示後。
