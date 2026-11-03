// 確認リストの「どの教室で確認済みか」を返す callable(listVerificationChecklistResults)の純関数(2026-11-03 オーナー指示)。
//
// オーナー指示「確認リストで、開発用教室とテスト用教室の双方でチェックしているため、双方が重複チェックしないように
// どちらの教室がチェック済みかわかるようにして」。developerReports はクライアントから読めない(rules: developer だけ)ので、
// 検証用教室(開発用教室・テスト教室)の利用者がこの関数経由で**確認リストの送信本文だけ**を読めるようにする。
//
// ★読み取り専用。返すのは「同じ会社の検証用教室から届いた、指定版の確認リスト送信」の本文・教室・受付時刻だけ。
//   送信者(メール・名前)・操作痕跡・教室データの保存先・画像の保存先は返さない(本文は項目 id と結果・メモだけで、
//   送信側が生徒名を入れない書式＝src/utils/verificationChecklist.ts buildVerificationChecklistLines)。
//   本文の読み解き(結果行・その他・分割の結合)はクライアントの src/utils/verificationChecklistResults.ts が担う(3 本目の写しを作らない)。
//
// このファイルは純関数のみ(Firestore / ネットワークに触らない)。

/** 版の書式(`v1.5.672`)。 */
const CHECKLIST_VERSION_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+$/u

/** 先頭行のマーカー(版を取り出す)。functions/src/developerReport.ts isVerificationChecklistNote と同じ形。 */
const CHECKLIST_MARKER_WITH_VERSION = /^\[確認リスト\s+(v[0-9]+\.[0-9]+\.[0-9]+)\](?:\s*\(\d+\/\d+\))?\s*$/u

/** 1 回に返す件数の上限(新しい順に残す)。項目ごとに送るようになったので 1 版で数十〜百件程度の想定。 */
export const VERIFICATION_CHECKLIST_STATUS_REPORT_LIMIT = 600

/** 本文 1 件の上限(送信側の上限 DEVELOPER_REPORT_NOTE_LIMIT と同じ)。 */
export const VERIFICATION_CHECKLIST_STATUS_NOTE_LIMIT = 2000

/** Firestore から読むフィールド(select)。これ以外は読まない・返さない。 */
export const VERIFICATION_CHECKLIST_STATUS_SELECT_FIELDS = ['reportId', 'classroomId', 'classroomName', 'note', 'recordedAt', 'reportedAt'] as const

export type VerificationChecklistClassroomKind = 'development' | 'sandbox'

export type VerificationChecklistStatusReport = {
  reportId: string
  classroomId: string
  classroomName: string
  /** 開発用教室(development)か、それ以外の検証用教室=テスト教室(sandbox)か。 */
  classroomKind: VerificationChecklistClassroomKind
  note: string
  recordedAt: string
  reportedAt: string
}

/** 要求の版を読む。書式違いは null(呼び出し側が invalid-argument にする)。 */
export function readVerificationChecklistVersion(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return CHECKLIST_VERSION_PATTERN.test(value) ? value : null
}

/** 本文の先頭行のマーカーから版を取り出す。確認リストでなければ null。 */
export function readVerificationChecklistNoteVersion(note: unknown): string | null {
  const firstLine = String(note ?? '').split(/\r?\n/u)[0]?.trim() ?? ''
  const match = CHECKLIST_MARKER_WITH_VERSION.exec(firstLine)
  return match ? match[1] : null
}

function readText(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}

/**
 * developerReports の文書(isVerificationChecklist == true で絞った後)から、返してよいものだけを選んで整える。
 *  - 本文の版が要求の版と一致するものだけ(別の版の結果は、項目の中身が違うことがあるので混ぜない)。
 *  - 同じ会社の検証用教室(isAllowedClassroom)から届いたものだけ(本番教室のものは isVerificationChecklist が立たないが、念のため二重に見る)。
 *  - 新しい順に上限件数まで。返すのは受付が古い順(後勝ちで集約するクライアントの読み方に合わせる)。
 */
export function selectVerificationChecklistStatusReports(
  docs: ReadonlyArray<{ id: string; data: Record<string, unknown> }>,
  options: {
    version: string
    isAllowedClassroom: (classroomId: string) => boolean
    developmentClassroomId: string | null
    limit?: number
  },
): VerificationChecklistStatusReport[] {
  const limit = options.limit ?? VERIFICATION_CHECKLIST_STATUS_REPORT_LIMIT
  const selected: VerificationChecklistStatusReport[] = []
  for (const doc of docs) {
    const note = readText(doc.data.note)
    if (readVerificationChecklistNoteVersion(note) !== options.version) continue
    const classroomId = readText(doc.data.classroomId)
    if (!classroomId || !options.isAllowedClassroom(classroomId)) continue
    selected.push({
      reportId: readText(doc.data.reportId) || doc.id,
      classroomId,
      classroomName: readText(doc.data.classroomName),
      classroomKind: options.developmentClassroomId && classroomId === options.developmentClassroomId ? 'development' : 'sandbox',
      note: note.slice(0, VERIFICATION_CHECKLIST_STATUS_NOTE_LIMIT),
      recordedAt: readText(doc.data.recordedAt),
      reportedAt: readText(doc.data.reportedAt),
    })
  }
  const byNewest = selected.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, limit)
  return byNewest.reverse()
}
