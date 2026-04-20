# 操作バグの検討結果と再発防止

最終更新: 2026-04-10

## 1. 左詰め操作で既存実績を壊した件

### 事象
- 生徒1が空いているときに生徒2を左へ詰める修正を入れた結果、出席・休み・振替なし休みの実績が残っている slot1 まで再配置の対象になり、以前の操作結果が変わった。

### 原因
- `packSortCellDesks` の正常系だけを見て、「右側生徒は左へ詰めてよい」と扱っていた。
- しかし実際には `statusSlots[0]` が存在する場合、その slot1 は「空席」ではなく「履歴を保持している実績スロット」だった。
- 同じ左詰めが `mergeManagedWeek` 側にもあり、単体ロジックだけ直しても再発し得る構造だった。

### なぜテストで見つからなかったか
- 既存テストは「右側生徒を左に詰める正常系」を確認していたが、「詰めてはいけない条件」を固定していなかった。
- `packSortCellDesks` 単体の確認はあったが、`buildScheduleCellsForRange` -> `mergeManagedWeek` を通る経路の禁止系カバーが無かった。

### 再発防止
- 操作系の変更は、正常系だけでなく「禁止系」を必ず対でテストする。
- 表示用 helper と merge/path 全体の両方に回帰テストを置く。
- 以前の操作結果が変わる修正は、実装前に影響を提示し、承認後に変更する。

## 2. 教室 UID 差し替え後に古い Auth ユーザーが残った件

### 事象
- 教室管理者 UID を差し替えたあと、古い Firebase Auth ユーザーが残存した。
- その結果、あとで同じメールアドレスを使って教室追加しようとすると `The email address is already in use by another account.` で失敗した。

### 原因
- UID 差し替え処理は Firestore の `members` と `classrooms.managerUserId` を更新していたが、以前使っていた Firebase Auth ユーザー自体は削除していなかった。
- そのため、ワークスペース上は未使用に見えても、Authentication 上では古いメールアドレスが占有されたままだった。

### 対応方針
- Functions 有効時の UID 差し替えは callable 経由に寄せ、差し替え成功後に旧 Firebase Auth ユーザーを削除する。
- 教室追加時にメール重複が起きた場合は、そのメールの Auth ユーザーがワークスペースの `members` と `classrooms` のどちらからも参照されていない stale アカウントであれば削除し、再作成を再試行する。

### 再発防止
- `members` / `classrooms` / Firebase Auth の 3 つをまたぐ管理者変更は、必ず server-side の一括処理で扱う。
- ワークスペース参照が消えた旧 Auth ユーザーを残さない。
- 「メール重複」は単なる入力ミスだけでなく、過去の UID 差し替えで残った stale Auth の可能性を疑う。

## 3. 振替出席を未消化に再カウントした件

### 事象
- 振替授業を出席に設定したあと、その振替が未消化ストックに再カウントされた。
- 振替なし休み（absent-no-makeup）でも同様に再カウントが発生した。

### 原因
- `collectMakeupUsageByKey` は `desk.lesson.studentSlots` だけを走査していた。
- 出席/休み/振無休を設定すると `removeStudentFromDeskLesson` で生徒が `studentSlots` から削除され、`desk.statusSlots` へ移動される。
- そのため消化済みカウントが消え、元のオリジンが未消化として再表示された。

### なぜ以前は顕在化しなかったか
- v1.5.78 で `consumeOriginDates` のフォールバック（`remaining.shift()`）を除去するまで、一致しないオリジンが先頭から消費される動作で偶然マスクされていた。

### 再発防止
- **ボードのセルデータから生徒を集計する関数は、`desk.lesson.studentSlots` と `desk.statusSlots` の両方を必ず走査する。**
- `statusSlots` の生徒はステータスで区別する: `attended` / `absent-no-makeup` は消化済み、`absent` は未消化。
- 新しい集計関数を追加する際は、このルールを遵守し、対応するユニットテストを `studentSlots` だけでなく `statusSlots` のパターンも含めて書く。

## 4. 今後のルール

- 既存操作の意味が変わる修正は、先に影響範囲を提示する。
- 操作ロジックの回帰テストは「やってよい」「やってはいけない」の両方を書く。
- Firestore と Firebase Auth をまたぐ運用変更は、片側だけ更新して終わらせない。