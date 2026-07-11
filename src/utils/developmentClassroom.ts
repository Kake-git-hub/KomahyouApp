export type DevelopmentClassroomIdentity = {
  id?: string | null
  name?: string | null
}

export function isDevelopmentClassroom(classroom: DevelopmentClassroomIdentity | null | undefined) {
  const id = classroom?.id?.trim().toLowerCase() ?? ''
  const name = classroom?.name?.trim() ?? ''
  return id === 'development'
    || id === 'dev'
    || id.includes('development')
    || id.startsWith('dev_')
    || name === '開発用教室'
    || name.includes('開発用教室')
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
