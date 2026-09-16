import { getFirebaseBackendConfig } from '../integrations/firebase/config'
import { isRegisteredDevelopmentClassroom } from './developmentClassroomRegistry'

/**
 * 検証用教室の判定に渡す教室の識別情報。**教室ID だけ**を持つ(2026-09-16・docs/spec-multi-tenant.md)。
 *
 * ★`name` を意図的に持たない(回帰防止・型で固定): 2026-09-16 までは教室名「開発用教室」でも検証用教室と
 * 見なしていたが、複数会社(workspace)展開で他社が同名の教室を作ると誤発火するため廃止した(オーナー確定)。
 * 名前フィールドを型に残しておくと `{ name: classroomName }` だけを渡す呼び出しが**コンパイルを通ってしまい**、
 * その画面の development-only 機能が開発用教室でも静かに無効化される(2026-09-16 レビュー指摘)。
 * ここに `name` を戻さない。教室オブジェクト(`actingClassroom` など)は余剰プロパティ検査の対象外
 * (変数経由の代入)なので、そのまま渡せる。
 */
export type DevelopmentClassroomIdentity = {
  id?: string | null
}

// 検証用(サンドボックス)教室の判定。**登録台帳 src/utils/developmentClassroomRegistry.ts が唯一の正本**で、
// (workspaceKey, classroomId) の完全一致だけを見る。教室名・ID の曖昧一致(dev/development)は 2026-09-16 に廃止。
//
// この判定は「他教室のバックアップをこの教室へ読み込む(Feature B)」の解放だけでなく、
// 混入防止ガード(自教室が発行していない提出トークンはQRを出さない・コピー時に剥がす)にも
// 使われる。**両者は必ずセット**で、片方だけ有効にすると 2026-07-09 のQR混入事故が再発する。
//
// サーバー側 functions/src/developmentClassroomIdentity.ts は同じ台帳の**複製**(sync-shared)を読む薄いラッパで、
// ズレは functions/src/developmentClassroomRegistry.parity.test.ts が検出する。台帳を直せば両側に効く。
//
// workspaceKey は既定で現在の接続先(env VITE_FIREBASE_WORKSPACE_KEY)。ローカルモードでは空文字なので
// 常に false(fail-closed)。テストからは第2引数で明示する。
export function isDevelopmentClassroom(
  classroom: DevelopmentClassroomIdentity | null | undefined,
  workspaceKey: string = getFirebaseBackendConfig().workspaceKey,
) {
  return isRegisteredDevelopmentClassroom(workspaceKey, classroom?.id)
}

type SubmissionTokenBearer = {
  submissionToken?: string
  submissionTokenClassroomId?: string
}

// 混入防止(2026-07-09): この提出トークンが「今開いている教室で発行されたもの」か。
// submissionTokenClassroomId が未設定(旧トークン)や別教室IDなら false。
// 本番データ保護: 他教室の生データを開発用教室へコピーした際、コピー元(他教室)の
// トークンをそのまま日程表でQR表示し、スキャンで他教室(本番)へ書き込む事故を防ぐ判定。
export function isSubmissionTokenOwnedByClassroom(
  input: SubmissionTokenBearer | null | undefined,
  classroomId: string | null | undefined,
): boolean {
  if (!input?.submissionToken) return false
  if (!classroomId) return false
  return input.submissionTokenClassroomId === classroomId
}

// 提出トークンを構成するフィールドを「1か所」で剥がす唯一の権威関数(無条件)。
// 発行元教室に関係なく submissionToken と発行元教室タグ submissionTokenClassroomId を落とす。
// 教室コピー(他教室→開発用)で全トークンを剥がして開発用側に再発行させる用途に使う。
// トークン系フィールドが将来増えても、除去の取りこぼしはこの関数の更新だけで防げる(分散させない)。純関数。
export function stripSubmissionToken<T extends SubmissionTokenBearer>(input: T): T {
  if (input.submissionToken === undefined && input.submissionTokenClassroomId === undefined) return input
  const next = { ...input }
  delete next.submissionToken
  delete next.submissionTokenClassroomId
  return next
}

// studentInputs / teacherInputs(Record)単位で無条件に提出トークンを剥がす。教室コピー時に使う。
export function stripSubmissionTokensFromInputs<T extends SubmissionTokenBearer>(
  inputs: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(inputs).map(([id, input]) => [id, stripSubmissionToken(input)]),
  )
}

// 開発用教室でのみ使う: 「今開いている教室が発行したものではない」提出トークンを除去する。
// これにより日程表はそのトークンでQRを生成できず、他教室(本番)への誤スキャン混入を防ぐ。
// 本番教室では呼び出さない(既存トークン・印刷済みQRは一切変更しない)。純関数。
// 除去そのものは stripSubmissionToken に委譲し、剥がすフィールドの定義を1か所に保つ。
export function stripForeignSubmissionToken<T extends SubmissionTokenBearer>(
  input: T,
  classroomId: string | null | undefined,
): T {
  if (isSubmissionTokenOwnedByClassroom(input, classroomId)) return input
  return stripSubmissionToken(input)
}

// studentInputs / teacherInputs(Record)単位で他教室由来トークンを除去する。開発用教室でのみ使う。
export function stripForeignSubmissionTokensFromInputs<T extends SubmissionTokenBearer>(
  inputs: Record<string, T>,
  classroomId: string | null | undefined,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(inputs).map(([id, input]) => [id, stripForeignSubmissionToken(input, classroomId)]),
  )
}

// ---- 保護者向け固定QR(docs/spec-parent-portal.md §B-3・2026-09-13) ----
// StudentRow が持つ保護者ポータル用トークンの「写し」と発行元教室タグ。
// 提出トークン(studentInputs の Record)とは持ち主の形が違う(StudentRow の配列)ため、上の stripSubmissionToken*
// を流用せず兄弟関数を置く。剥がすフィールドの定義はこのファイル 1 か所に集約し、呼び出し側(App.tsx など)で
// `delete row.parentPortalToken` を手書きしない(分散させると片方だけ剥がし忘れる)。
export type ParentPortalTokenBearer = {
  parentPortalToken?: string
  parentPortalTokenClassroomId?: string
}

// この保護者用トークンが「今開いている教室で発行されたもの」か。タグ未設定・別教室IDなら false。
// 判定の意味は isSubmissionTokenOwnedByClassroom と同じ(発行元不明は信用しない)。
export function isParentPortalTokenOwnedByClassroom(
  row: ParentPortalTokenBearer | null | undefined,
  classroomId: string | null | undefined,
): boolean {
  if (!row?.parentPortalToken) return false
  if (!classroomId) return false
  return row.parentPortalTokenClassroomId === classroomId
}

// 保護者用トークンを構成するフィールドを「1か所」で剥がす唯一の権威関数(無条件)。
// 発行元教室に関係なく parentPortalToken と発行元教室タグ parentPortalTokenClassroomId の両方を落とす
// (片方だけ残すと「タグだけの行」や「タグ無しトークン」が生まれて判定が揺れる)。
// 教室コピー(他教室→開発用: buildDevelopmentClassroomCopyPayload)で使う。変更が無ければ同一参照を返す。純関数。
export function stripParentPortalToken<T extends ParentPortalTokenBearer>(row: T): T {
  if (row.parentPortalToken === undefined && row.parentPortalTokenClassroomId === undefined) return row
  const next = { ...row }
  delete next.parentPortalToken
  delete next.parentPortalTokenClassroomId
  return next
}

// StudentRow[](配列)単位で無条件に保護者用トークンを剥がす。教室コピー時に使う。
// どの行も変わらなければ配列も同一参照を返す(不要な再レンダー・差分検知の揺れを避ける)。
export function stripParentPortalTokensFromStudents<T extends ParentPortalTokenBearer>(rows: T[]): T[] {
  let changed = false
  const next = rows.map((row) => {
    const stripped = stripParentPortalToken(row)
    if (stripped !== row) changed = true
    return stripped
  })
  return changed ? next : rows
}

// 開発用教室でのみ使う: 「今開いている教室が発行したものではない」保護者用トークンを除去する。
// 本番教室では呼び出さない(配布済みの紙の QR を黙って無効にしない)。除去は stripParentPortalToken に委譲。純関数。
export function stripForeignParentPortalToken<T extends ParentPortalTokenBearer>(
  row: T,
  classroomId: string | null | undefined,
): T {
  if (isParentPortalTokenOwnedByClassroom(row, classroomId)) return row
  return stripParentPortalToken(row)
}

// StudentRow[](配列)単位で他教室由来の保護者用トークンを除去する。開発用教室でのみ使う。
export function stripForeignParentPortalTokensFromStudents<T extends ParentPortalTokenBearer>(
  rows: T[],
  classroomId: string | null | undefined,
): T[] {
  let changed = false
  const next = rows.map((row) => {
    const stripped = stripForeignParentPortalToken(row, classroomId)
    if (stripped !== row) changed = true
    return stripped
  })
  return changed ? next : rows
}
