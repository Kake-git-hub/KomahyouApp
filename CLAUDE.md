# コマ表アプリ — Claude へのルール

## ⚠️ 回帰防止ルール（過去の修正を必ず踏襲する・厳守）

このアプリは**過去の修正を踏まえて次の修正を積み上げる**前提で開発されている。
過去に直したバグを後の変更（特にマージ/リベース/リファクタ）で**巻き戻してはいけない**。

- **既存ロジックを書き換える前に、その箇所が過去に何を直したかを確認する。**
  - `git log -L <開始>,<終了>:<ファイル>` や `git log -S "<該当コード片>"`、`git blame` で変遷を追う。
  - 関数の近くにある「回帰防止」「fix」「過去コミットID」コメントは**意図的なガード**。消さない・薄めない。
- **コードを「単純化」する誘惑に注意。** `{ ...a, ...b }` のような spread は、過去に明示していた
  フィールド補完（例: `managedStudentId: b.x ?? a.x`）を消すと回帰する。短く見えても挙動が変わる。
- **マージ衝突の解決時は、両側の修正を必ず両立させる。** 一方の修正を捨てて他方で上書きしない。
- **バグを直したら必ず回帰防止テストを追加する**（修正なしで落ち・修正ありで通ることを確認）。
  ゴールデンスナップショットだけに頼らない（リライトで保護が消える）。
- 実際に起きた回帰：`mergeManagedDeskLesson` の生徒同一性補完（commit `6793374`）が
  後のマージ（commit `2dce7b4`）で `{ ...managedStudent, ...student }` に巻き戻り、
  生徒日程表で通常授業がカウントされない不具合が再発（2026-06-10 に再修正＋テスト追加）。

## ⚠️ 本番データ保護ルール（最優先・厳守）

このアプリは **稼働中の本番サービス** です。複数の学習塾教室の実際のデータが Firebase (プロジェクト: `komahyouapp-prod`) に保存されています。

### Claudeが絶対に行ってはいけないこと

- **開発用教室(`v8OZ7zH8vONNHjjYVcR1`)以外のFirestoreドキュメントへの書き込み・更新・削除**
- **本番教室の復元・コピー・上書きに相当するCloud Functions呼び出し**（`saveClassroomSnapshotViaFunction`, `restoreClassroomFromServerAutoBackup`, `restoreLatestClassroomRollback`, `copyClassroomDataToDevelopmentClassroom`等）
- **管理者UID以外のmembersドキュメントへの書き込み**

### デバッグ・チェック時の読み取り専用ルール

- Firestoreデータの**確認・照合は読み取り（GET）のみ**。REST APIで `getDoc` / `getDocs` に相当する照合は可。
- gcloud / firebase CLI でのデータ参照は読み取り専用コマンドに限定する。
- **書き込みが必要な確認作業は、必ず開発用教室 `v8OZ7zH8vONNHjjYVcR1` を対象にする**。

### 教室一覧と担当者（参照用）

| 教室名 | classroomId | 用途 |
|--------|-------------|------|
| スクールIE 日大前校 | `5w5OMueETerSKrSf14HC` | 本番（読み取り専用） |
| スクールIE 緑が丘校 | `KzFnOQoTFLsCxwUp1tvh` | 本番（読み取り専用） |
| スクールIE 薬円台校 | `6xnnbSTbwgGrBLy0EJKb` | 本番（読み取り専用） |
| 開発用教室           | `v8OZ7zH8vONNHjjYVcR1` | **書き込み可能な唯一の教室** |
| テスト教室           | `test_classroom_20260507_dai` | 開発用に準じて扱う |

### 事故の記録（2026-06-06 再発防止）

Claudeの自動チェックセッションが `actingClassroomId` を適切に制御しない状態で復元/コピー操作を実行し、**日大前校のスナップショット文書が緑が丘校のデータで上書きされた**。
汚染前バックアップ（2026-06-06 T10毎時）から手動復元で対応。

再発防止：Claude はアプリのチェック・デバッグ・動作確認においても、**Firestoreへの書き込みを伴う操作は開発用教室のみ** に限定する。

---

## プロジェクト概要

- **技術スタック**: React + TypeScript + Firebase (Firestore / Cloud Functions / Hosting / Storage)
- **状態管理**: useState / useRef / useCallback 中心（外部状態ライブラリなし）
- **保存アーキテクチャ**: 手動保存ボタン → Cloud Function `saveClassroomSnapshot` に一本化。Firestore 直書き経路は廃止済み。
- **ビルド**: `npm run build` / 開発: `npm run dev`（ポート5173）
- **デプロイ**: `npm run deploy` → Firebase Hosting

## 重要な実装メモ

- `workspaceKey` = `main`（本番）/ `.env.local` の `VITE_FIREBASE_WORKSPACE_KEY` で設定
- 復元・コピーは `actingClassroomId`（現在開いている教室）に書き込む。**開いている教室の確認なしに復元操作をしてはいけない**。
- バックアップ: 毎時（直近3日）・日次（14日）。Storage パス `workspace-auto-backups/main/hourly/{key}.json`
- 詳細: `memory/komahyou-save-architecture.md` および `memory/komahyou-classroom-restore-cross-contamination.md` 参照
