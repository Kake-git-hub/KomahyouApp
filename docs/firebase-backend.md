# Firebase バックエンド構成

## 採用方針

Firebase を使う場合、現状のコマ表アプリでは Firestore を完全正規化 DB の代わりに使うより、教室単位 snapshot を中心にした方が安全です。

理由は次の 3 点です。

- 現行 UI は `AppSnapshotPayload` を中心に組まれている
- 通常授業、講習、自動割振ルールが相互依存しており、いきなりドキュメント分割すると更新整合性が崩れやすい
- 初期利用者は少人数で、まず必要なのは認証と外部保存の確立

## Firebase 全体構成

- 配信: Firebase Hosting
- 認証: Firebase Authentication
- データ: Firestore
- 管理系 API: なし

Hosting は `firebase.json` で `dist` をそのまま配信し、SPA なので全パスを `index.html` へ rewrite します。Spark 無料プランでは Functions を使わず、既存教室の閲覧・編集・snapshot 同期だけをアプリ側で行います。

## Firestore 構造

### `workspaces/{workspaceKey}`

- ワークスペース単位の親ドキュメント
- 名前や将来の全体設定を置く

### `workspaces/{workspaceKey}/members/{uid}`

- Firebase Auth のユーザーに対応
- フィールド
  - `displayName`
  - `email`
  - `role`: `developer` or `manager`
  - `assignedClassroomId`

### `workspaces/{workspaceKey}/classrooms/{classroomId}`

- 教室メタ情報
- フィールド
  - `name`
  - `contractStatus`
  - `contractStartDate`
  - `contractEndDate`
  - `managerUserId`
  - `isTemporarilySuspended`
  - `temporarySuspensionReason`
  - `updatedAt`

### `workspaces/{workspaceKey}/classroomSnapshots/{classroomId}`

- 教室ごとの現行 snapshot
- フィールド
  - `schemaVersion`
  - `savedAt`
  - `data`: `AppSnapshotPayload`
  - `updatedBy`
  - `updatedAt`

## 現状仕様に対する最適化ポイント

### 1. ワークスペース全体ではなく教室単位保存

管理者は担当教室しか見ないため、ワークスペース全体を 1 ドキュメントにしない方が権限制御しやすいです。

### 2. snapshot はメタと分離

`classrooms` に巨大な board 状態まで入れず、`classroomSnapshots` に分けています。これで一覧取得と本体取得の責務が分かれます。

### 3. 今は Firestore に合わせて無理に分解しない

`RegularLessonRow` の 1/2 生徒構造や `SpecialSessionRow` の入れ子入力は、長期的には分割候補です。ただし現段階では snapshot 保存の方が UI への影響が小さいです。

## 将来の分割候補

以下は将来的に Firestore のサブコレクションへ段階移行できます。

1. `teachers`
2. `students`
3. `regularLessons`
4. `specialSessions`
5. `makeupStocks`
6. `lectureStocks`
7. `autoAssignRules`
8. `pairConstraints`

ただし最初に切るべきは `regularLessons` です。通常授業の検索、集計、差分保存の中心だからです。

## Spark での運用境界

- 教室追加: Firebase Authentication で Auth ユーザーを作成し、取得した UID を開発者画面の `教室を追加` へ貼り付けて `members`, `classrooms`, `classroomSnapshots` を追加する
- 教室削除: Firebase Console で Auth ユーザーと対象ドキュメントを削除する
- 管理者メール変更: Firebase Auth と `members/{uid}` を同時に手動更新する

現状の通常業務データは Firestore の snapshot 同期です。教室名、契約状態、教室データ本体はアプリから Firestore へ保存しますが、Auth に触る操作だけは Spark では手動運用に寄せます。

## Spark で教室を新規作成する手順

最短で進める場合は、先に次を実行してください。

```bash
npm run firebase:first-classroom
```

この helper は対話形式で次を受け取り、Firebase Console にそのまま貼る JSON をまとめて出力します。

- `workspaceKey`
- `classroomId`
- `classroomName`
- `managerUid`
- `managerName`
- `managerEmail`
- `developerUid`
- `contractStartDate`

出力結果をそのまま Markdown ファイルとして保存したい場合は、次のように `--output` を付けます。

```bash
npm run firebase:first-classroom -- --output docs/first-classroom-shinjuku.md
```

helper を使わず進める場合は、以下の順に進めます。

### 1. Firebase Authentication で管理者ユーザーを作る

- Authentication の Email/Password で管理者アカウントを作成する
- 作成後に Firebase Auth UID を控える

### 2. 開発者画面の `教室を追加` に UID を貼り付ける

- 教室名
- 管理者名
- 管理者メール
- 1 で取得した UID
- 利用開始日

これで `members/{uid}`、`classrooms/{classroomId}`、`classroomSnapshots/{classroomId}` が自動作成されます。

### 3. 手動で作る場合の `members/{uid}`

パス:

- `workspaces/{workspaceKey}/members/{managerUid}`

最低限のフィールド:

```json
{
  "displayName": "新宿教室 管理者",
  "email": "shinjuku-manager@example.com",
  "role": "manager",
  "assignedClassroomId": "classroom_shinjuku"
}
```

### 4. `classrooms/{classroomId}` を作る

パス:

- `workspaces/{workspaceKey}/classrooms/{classroomId}`

最低限のフィールド:

```json
{
  "name": "新宿教室",
  "contractStatus": "active",
  "contractStartDate": "2026-04-01",
  "contractEndDate": "",
  "managerUserId": "<managerUid>",
  "isTemporarilySuspended": false,
  "temporarySuspensionReason": "",
  "updatedAt": "2026-03-28T00:00:00.000Z"
}
```

### 5. `classroomSnapshots/{classroomId}` を作る

パス:

- `workspaces/{workspaceKey}/classroomSnapshots/{classroomId}`

最低限のフィールド:

```json
{
  "schemaVersion": 1,
  "savedAt": "2026-03-28T00:00:00.000Z",
  "updatedBy": "<developerUid>",
  "updatedAt": "2026-03-28T00:00:00.000Z",
  "data": {
    "screen": "board",
    "classroomSettings": {
      "closedWeekdays": [0],
      "holidayDates": [],
      "forceOpenDates": [],
      "deskCount": 14,
      "initialSetupCompletedAt": "",
      "initialSetupMakeupStocks": [],
      "initialSetupLectureStocks": []
    },
    "managers": [],
    "teachers": [],
    "students": [],
    "regularLessons": [],
    "groupLessons": [],
    "specialSessions": [
      {
        "id": "session_2026_summer",
        "label": "2026 夏期講習",
        "startDate": "2026-07-21",
        "endDate": "2026-08-28",
        "teacherInputs": {},
        "studentInputs": {},
        "createdAt": "2026-03-10 09:30",
        "updatedAt": "2026-03-12 18:20"
      },
      {
        "id": "session_2026_spring",
        "label": "2026 新年度準備講座",
        "startDate": "2026-03-23",
        "endDate": "2026-04-05",
        "teacherInputs": {},
        "studentInputs": {},
        "createdAt": "2026-03-01 10:15",
        "updatedAt": "2026-03-08 13:40"
      },
      {
        "id": "session_2026_exam",
        "label": "2026 定期試験対策",
        "startDate": "2026-05-18",
        "endDate": "2026-06-05",
        "teacherInputs": {},
        "studentInputs": {},
        "createdAt": "2026-02-20 12:00",
        "updatedAt": "2026-03-11 16:10"
      },
      {
        "id": "session_2026_winter",
        "label": "2026 冬期講習",
        "startDate": "2026-12-24",
        "endDate": "2027-01-07",
        "teacherInputs": {},
        "studentInputs": {},
        "createdAt": "2026-03-05 08:20",
        "updatedAt": "2026-03-09 19:00"
      }
    ],
    "autoAssignRules": [
      { "key": "preferDateConcentration", "label": "登校日集約", "description": "同じ日に複数コマをまとめつつ、登校日どうしは期間内でほどよく間隔が空く候補を優先します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "preferNextDayOrLater", "label": "登校日分散", "description": "同じ日にまとめるより、別日の登校へ分散できる候補を優先します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "preferTwoStudentsPerTeacher", "label": "講師1人に生徒2人配置", "description": "可能な限り 1 卓に 2 人着席を優先します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "maxOneLesson", "label": "1コマ上限", "description": "同一日の授業数を 1 コマまでに抑えます。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "maxTwoLessons", "label": "2コマ上限", "description": "同一日の授業数を 2 コマまでに抑えます。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "maxThreeLessons", "label": "3コマ上限", "description": "同一日の授業数を 3 コマまでに抑えます。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "allowTwoConsecutiveLessons", "label": "2コマ連続", "description": "連続 2 コマを優先候補に含めます。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "requireBreakBetweenLessons", "label": "一コマ空け", "description": "授業の間に 1 コマ空ける形を優先します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "connectRegularLessons", "label": "通常連結2コマ", "description": "通常授業と連続する配置を優先候補に含めます。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "subjectCapableTeachersOnly", "label": "科目対応講師のみ", "description": "講師の科目担当に収まる生徒だけを配置候補にします。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "regularTeachersOnly", "label": "通常講師のみ", "description": "割振りを通常授業で担当している講師だけに制限します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "preferLateAfternoon", "label": "3,4,5限優先", "description": "3 限から 5 限を先に使う優先順です。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "preferSecondPeriod", "label": "2限寄り(2＞3＞4＞5限の優先順位)", "description": "2 限から順に近いコマを優先します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "preferFifthPeriod", "label": "5限寄り(5＞4＞3＞2限の優先順位)", "description": "5 限から順に近いコマを優先します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" },
      { "key": "forbidFirstPeriod", "label": "1限禁止", "description": "対象者を1 限に配置しないよう制限します。", "targets": [], "excludeTargets": [], "priorityScore": 3, "includeStudentIds": [], "excludeStudentIds": [], "updatedAt": "" }
    ],
    "pairConstraints": [],
    "boardState": null
  }
}
```

### 6. 作成後に確認すること

- 管理者でログインできること
- 開発者でログインすると教室一覧に新教室が出ること
- 新教室を開いて保存すると `classroomSnapshots/{classroomId}` の `savedAt` と `updatedAt` が更新されること

### 7. 実務上のおすすめ

- `specialSessions` と `autoAssignRules` は上の初期値をそのままコピーするのが安全
- 2 教室目以降は既存の `classroomSnapshots/{classroomId}` を複製して `managerUserId`, `name`, `assignedClassroomId` だけ差し替えるのが最短
- アプリ自体は `https://komahyouapp-prod.web.app/` を直接開いて運用する
- `/KomahyouApp/...` の転送経路は互換性のため残しているが、通常運用では使わない

## Blaze へ上げる場合

Blaze へ移行するなら、残してある `functions` ディレクトリを使って管理系 API を復活できます。その場合だけ `VITE_FIREBASE_ENABLE_FUNCTIONS=true` を設定し、Functions を `firebase.json` とデプロイ対象へ戻してください。

## 制約

- Firebase Hosting のプロジェクト紐付けは環境ごとに異なるため、`.firebaserc` は固定せず各環境で `firebase use --add` を実行してください
- Spark 構成のデプロイは `npm run build:firebase` の後に `npx firebase-tools deploy --only hosting,firestore` を使います