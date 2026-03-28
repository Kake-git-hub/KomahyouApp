# DB 構成見直し

## 結論

現状仕様に対しては、いきなり全データを完全正規化して CRUD を全面置換するより、次の 2 段構えが最適です。

1. 先行導入
   - 認証は Firebase Authentication
   - 永続化は Firestore の `classroomSnapshots` を教室単位で持つ
   - 権限は `members/{uid}` と Firestore Security Rules で制御する
2. 次段階
   - 通常授業、講習入力、振替残、割振ルールを正規化テーブルへ分解する

今回の実装は 1 を採用しています。理由は、現在の React 状態が `AppSnapshotPayload` に強く集約されており、いきなり全面正規化すると UI の検証速度が落ちるためです。

## 現状データの問題点

### 1. ログイン情報と業務データが同じ保存物に混ざっている

- `developerPassword`
- `currentUserId`
- `actingClassroomId`

これらは外部認証に移ると DB の業務保存対象から外すべきです。

### 2. ワークスペース丸ごと 1 塊だと管理者権限に合わない

管理者は担当教室しか見てはいけないため、全教室入りの 1 レコードをそのまま返す構造は避けるべきです。

### 3. `RegularLessonRow` は将来的に正規化した方が良い

- `student1Id` / `student2Id`
- `subject1` / `subject2`
- `nextStudent1Id` / `nextStudent2Id`

この構造は UI 上は扱いやすい一方、DB では更新競合と集計が重くなります。

## 今回採用した外部 DB 構成

### `workspaces/{workspaceKey}`

- アプリ全体の論理ワークスペース
- `slug` でフロント接続先を切り替える

### `workspaces/{workspaceKey}/members/{uid}`

- 認証ユーザーとワークスペースの所属
- ロールは `developer` / `manager`
- 管理者は `assigned_classroom_id` を持つ

### `workspaces/{workspaceKey}/classrooms/{classroomId}`

- 教室メタ情報
- 契約状態、一時停止、担当管理者など

### `workspaces/{workspaceKey}/classroomSnapshots/{classroomId}`

- 教室単位の `AppSnapshotPayload`
- 既存 UI を大きく崩さず外部保存へ移せる

## なぜ教室単位 snapshot にしたか

- 管理者への権限制御を Firestore Rules で素直に書ける
- 既存の `WorkspaceClassroom.data` と 1 対 1 で移行できる
- ローカル保存から外部保存への差し替え範囲を最小化できる

## 次段階で正規化すべきテーブル

将来的には少なくとも以下へ分解するのが良いです。

1. `teachers`
2. `teacher_subject_capabilities`
3. `students`
4. `regular_lesson_slots`
5. `regular_lesson_enrollments`
6. `special_sessions`
7. `special_session_teacher_inputs`
8. `special_session_student_inputs`
9. `makeup_stock_entries`
10. `lecture_stock_entries`
11. `pair_constraints`
12. `auto_assign_rule_targets`

特に `regular_lesson_slots` と `regular_lesson_enrollments` の分離が最優先です。ここを切ると、通常授業の開始終了期間、二人着席、同一枠集計、欠席由来振替の追跡がすべて素直になります。

## 実運用上の注意

- Firebase 直結のフロントだけでは、管理者アカウントの新規発行を安全に完結できません。
- そのため、今回の実装では外部認証モード時の「教室追加/削除」は止めています。
- この部分は将来的に Cloud Functions か管理 API へ分離してください。