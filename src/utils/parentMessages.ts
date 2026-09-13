// 保護者からの連絡(docs/spec-parent-portal.md §E-2「室長への通知(三点セット)」)の純粋ロジック。
// 購読(src/integrations/firebase/parentPortal.ts)→ 選別 → モーダル表示 → 既読のサーバー記録、のうち
// 「選別」「表示用データの組み立て」「重複排除」をここに置き、React/Firebase を import せずテストする。
// ⚠️ 保護者の文面は個人情報。GitHub Issue・通知メール・AI へ渡す資料に載せない(§E-2)。
import type { StudentRow } from '../components/basic-data/basicDataModel'
import { getStudentDisplayName } from '../components/basic-data/basicDataModel'

// Firestore `workspaces/{ws}/classroomSnapshots/{classroomId}/parentMessages/{messageId}` の読み取り形(§E-1 の表)。
// classroomId / studentId はトークン doc 由来(サーバーが付ける)。notifiedAt は室長が「確認」するまで null。
export type ParentMessageEntry = {
  id: string
  classroomId: string
  studentId: string
  studentName: string
  body: string
  senderName: string
  createdAt: string
  notifiedAt: string | null
  containsUrl: boolean
}

// モーダル 1 件分の表示データ。内部 ID(studentId)は持たせない(DOM に出さないため)。
export type ParentMessageNotification = {
  id: string
  studentName: string
  senderName: string
  body: string
  createdAt: string
  containsUrl: boolean
  classroomName: string
}

// なりすまし対策の注記(§E-2 3.)。senderName の横に**必ず**出す。
export const PARENT_MESSAGE_SENDER_UNVERIFIED_NOTE = '送信者は本人確認をしていません'
// 本文に URL らしき文字列を含むとき(containsUrl)に添える注意(§E-2 3.)。
export const PARENT_MESSAGE_URL_WARNING = 'リンクが含まれています。開く前にご確認ください'
// 送信者名が空(任意項目・P-3)のときの表示。
export const PARENT_MESSAGE_SENDER_FALLBACK = '（送信者名なし）'
// 名簿にも doc にも生徒名が無いとき(削除済みで studentName も空)の表示。
export const PARENT_MESSAGE_STUDENT_NAME_FALLBACK = '（生徒名不明）'

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Firestore doc → ParentMessageEntry。型が崩れた doc(必須文字列が無い)は null にして購読側で捨てる。
// notifiedAt は「文字列なら既読時刻・それ以外(null/未設定)は未読」と読む(講習提出の notifiedAt と同じ読み方)。
export function parseParentMessageEntry(id: string, data: unknown): ParentMessageEntry | null {
  if (!id || typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const classroomId = readText(record.classroomId)
  const studentId = readText(record.studentId)
  const body = readText(record.body)
  const createdAt = readText(record.createdAt)
  if (!classroomId || !studentId || !createdAt) return null
  return {
    id,
    classroomId,
    studentId,
    studentName: readText(record.studentName),
    body,
    senderName: readText(record.senderName),
    createdAt,
    notifiedAt: typeof record.notifiedAt === 'string' && record.notifiedAt ? record.notifiedAt : null,
    containsUrl: record.containsUrl === true,
  }
}

// 選別(§E-2 2.): 起動時は notifiedAt == null の全件、実行中は新規到着分。
// 購読は where('notifiedAt','==',null) だが、既読化直後の 'modified' 配信などで notifiedAt が埋まった doc が
// 混ざっても再通知しないよう、ここでもう一度未読だけに絞る(二重の防波堤)。
export function selectUnnotifiedParentMessages(entries: readonly ParentMessageEntry[]): ParentMessageEntry[] {
  return entries.filter((entry) => !entry.notifiedAt)
}

// 表示用データの組み立て。生徒名は**名簿の現在名を優先**し(改名に追従)、名簿に居なければ doc の studentName
// (送信時点の宛名。削除済み生徒でも誰宛か分かる)。教室名は未指定なら空文字。
export function buildParentMessageNotifications(
  entries: readonly ParentMessageEntry[],
  context: { students: readonly StudentRow[]; classroomName?: string | null },
): ParentMessageNotification[] {
  const studentById = new Map<string, StudentRow>()
  for (const student of context.students) {
    if (student.id && !studentById.has(student.id)) studentById.set(student.id, student)
  }
  const classroomName = (context.classroomName ?? '').trim()
  return entries.map((entry) => {
    const rosterStudent = studentById.get(entry.studentId)
    const rosterName = rosterStudent ? getStudentDisplayName(rosterStudent) : ''
    const studentName = rosterName || entry.studentName.trim() || PARENT_MESSAGE_STUDENT_NAME_FALLBACK
    return {
      id: entry.id,
      studentName,
      senderName: entry.senderName.trim() || PARENT_MESSAGE_SENDER_FALLBACK,
      body: entry.body,
      createdAt: entry.createdAt,
      containsUrl: entry.containsUrl,
      classroomName,
    }
  })
}

// 既存の通知リストへ新着を合流する。同じ id は新着で置き換え(modified 配信の追従)、createdAt 昇順
// (古い連絡が上)。同時刻は id で安定化し、描画順が配信順で揺れないようにする。
/**
 * 既読化 callable(markParentMessagesNotified)の 1 回あたりの上限。サーバーはこれを超える配列を
 * **切り詰めずに invalid-argument で丸ごと拒否**するので、呼び出し側が必ず分割する。
 * 分割しないと未読が 51 件に達した時点で「すべて確認」が恒久的に失敗する(レビュー指摘 2026-09-13)。
 */
export const PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE = 50

/** 既読化する ID を上限ごとに分割する。空配列なら空配列(callable を呼ばない)。 */
export function chunkParentMessageIds(
  ids: readonly string[],
  chunkSize: number = PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE,
): string[][] {
  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size))
  }
  return chunks
}

export function mergeParentMessageNotifications(
  current: readonly ParentMessageNotification[],
  incoming: readonly ParentMessageNotification[],
): ParentMessageNotification[] {
  const byId = new Map<string, ParentMessageNotification>()
  for (const item of current) byId.set(item.id, item)
  for (const item of incoming) byId.set(item.id, item)
  return Array.from(byId.values()).sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
    if (left.id === right.id) return 0
    return left.id < right.id ? -1 : 1
  })
}
