// 保護者からの休み連絡(docs/spec-parent-portal.md §0-5・§E-2「室長への通知」)の純粋ロジック。
// 購読(src/integrations/firebase/parentPortal.ts)→ 選別 → モーダル(四択)→ 盤面の自動処理 → 保存成功で処理済み、のうち
// 「選別」「表示用データの組み立て」「重複排除」「処理済み待ちの管理」をここに置き、React/Firebase を import せずテストする。
//
// 2026-09-18 オーナー指示で自由記述の連絡(body / senderName)は廃止し、連絡は「このコマを休みます」だけになった。
// 旧形式の doc(kind が 'absence' でないもの)は Firestore に残っていても表示しない。
import type { StudentRow } from '../components/basic-data/basicDataModel'
import { getStudentDisplayName } from '../components/basic-data/basicDataModel'

// 盤面モーダルの四択。'manual' だけは盤面を触らない(手動で処理するので何もしない)。
export type ParentAbsenceResolution = 'absent' | 'absent-no-makeup' | 'makeup-now' | 'manual'

export type ParentAbsenceLessonKind = 'regular' | 'makeup' | 'extra'

export type ParentAbsenceDetail = {
  dateKey: string
  slotNumber: number
  subject: string
  lessonKind: ParentAbsenceLessonKind
  isTentative: boolean
}

// Firestore `workspaces/{ws}/classroomSnapshots/{classroomId}/parentMessages/{messageId}` の読み取り形(§0-5 の表)。
// classroomId / studentId はトークン doc 由来(サーバーが付ける)。
// - acknowledgedAt: 室長が四択を押した時刻(保護者ページの「教室確認済」)。
// - notifiedAt: 処理完了(盤面を保存できた or 何もしない)。未読購読 where('notifiedAt','==',null) から外れる。
export type ParentMessageEntry = {
  id: string
  classroomId: string
  studentId: string
  studentName: string
  absence: ParentAbsenceDetail
  createdAt: string
  acknowledgedAt: string | null
  resolution: ParentAbsenceResolution | null
  notifiedAt: string | null
}

// モーダル 1 件分の表示データ。studentId は盤面への一過性コマンドに使うだけで、DOM には出さない。
export type ParentMessageNotification = {
  id: string
  studentId: string
  studentName: string
  classroomName: string
  createdAt: string
  absence: ParentAbsenceDetail
  // 前回の起動で四択を押したが盤面を保存しなかった連絡(=再通知)。モーダルに「保存されていません」を添える。
  previousResolution: ParentAbsenceResolution | null
}

// 名簿にも doc にも生徒名が無いとき(削除済みで studentName も空)の表示。
export const PARENT_MESSAGE_STUDENT_NAME_FALLBACK = '（生徒名不明）'

const PARENT_ABSENCE_RESOLUTIONS: readonly ParentAbsenceResolution[] = ['absent', 'absent-no-makeup', 'makeup-now', 'manual']
const PARENT_ABSENCE_LESSON_KINDS: readonly ParentAbsenceLessonKind[] = ['regular', 'makeup', 'extra']
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function parseAbsenceDetail(raw: unknown): ParentAbsenceDetail | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const dateKey = readText(record.dateKey)
  const slotNumber = record.slotNumber
  const lessonKind = readText(record.lessonKind) as ParentAbsenceLessonKind
  if (!DATE_KEY_PATTERN.test(dateKey)) return null
  if (typeof slotNumber !== 'number' || !Number.isInteger(slotNumber) || slotNumber < 1) return null
  if (!PARENT_ABSENCE_LESSON_KINDS.includes(lessonKind)) return null
  return { dateKey, slotNumber, subject: readText(record.subject), lessonKind, isTentative: record.isTentative === true }
}

// Firestore doc → ParentMessageEntry。型が崩れた doc と**旧形式(自由記述)の doc は null** にして購読側で捨てる。
// notifiedAt / acknowledgedAt は「文字列なら時刻・それ以外(null/未設定)は未」と読む(講習提出の notifiedAt と同じ読み方)。
export function parseParentMessageEntry(id: string, data: unknown): ParentMessageEntry | null {
  if (!id || typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  if (record.kind !== 'absence') return null
  const classroomId = readText(record.classroomId)
  const studentId = readText(record.studentId)
  const createdAt = readText(record.createdAt)
  const absence = parseAbsenceDetail(record.absence)
  if (!classroomId || !studentId || !createdAt || !absence) return null
  const resolution = readText(record.resolution) as ParentAbsenceResolution
  return {
    id,
    classroomId,
    studentId,
    studentName: readText(record.studentName),
    absence,
    createdAt,
    acknowledgedAt: readTimestamp(record.acknowledgedAt),
    resolution: PARENT_ABSENCE_RESOLUTIONS.includes(resolution) ? resolution : null,
    notifiedAt: readTimestamp(record.notifiedAt),
  }
}

// 選別(§E-2 2.): 起動時は notifiedAt == null の全件、実行中は新規到着分。
// 購読は where('notifiedAt','==',null) だが、処理済み化直後の 'modified' 配信などで notifiedAt が埋まった doc が
// 混ざっても再通知しないよう、ここでもう一度未処理だけに絞る(二重の防波堤)。
// ★pendingIds = この起動中に四択で盤面へ反映済み・保存待ちの連絡。四択を押すと acknowledgedAt の更新で
//   'modified' が届くので、ここで除かないと処理したばかりの連絡がモーダルに戻ってくる。
export function selectUnnotifiedParentMessages(entries: readonly ParentMessageEntry[], pendingIds: ReadonlySet<string> = new Set()): ParentMessageEntry[] {
  return entries.filter((entry) => !entry.notifiedAt && !pendingIds.has(entry.id))
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
      studentId: entry.studentId,
      studentName,
      classroomName,
      createdAt: entry.createdAt,
      absence: entry.absence,
      // 'manual' は即処理済みになるので再通知に現れない。盤面を変える 3 種だけが「保存されなかった」候補。
      previousResolution: entry.acknowledgedAt ? entry.resolution : null,
    }
  })
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const LESSON_KIND_LABELS: Record<ParentAbsenceLessonKind, string> = { regular: '通常', makeup: '振替', extra: '増コマ' }

// 「9月20日(土) 3限 英(通常)」。曜日は Date.UTC から取る(Date.parse('YYYY-MM-DD') は TZ で日付がずれる)。
export function formatParentAbsenceLessonLabel(absence: ParentAbsenceDetail): string {
  const [year, month, day] = absence.dateKey.split('-').map((part) => Number(part))
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? ''
  const subject = absence.subject ? ` ${absence.subject}` : ''
  return `${month}月${day}日(${weekday}) ${absence.slotNumber}限${subject}(${LESSON_KIND_LABELS[absence.lessonKind]})`
}

// 四択の定義(並び順＝画面の並び順)。ラベルは盤面の既存メニュー(休み / 振無休)と同じ言葉にする。
export type ParentAbsenceChoice = { resolution: ParentAbsenceResolution; label: string; description: string }
export const PARENT_ABSENCE_CHOICES: readonly ParentAbsenceChoice[] = [
  { resolution: 'absent', label: '休み', description: '休みにして未消化振替へ戻す' },
  { resolution: 'absent-no-makeup', label: '振無休', description: '振替なしの休みにする' },
  { resolution: 'makeup-now', label: '振替先を今決める', description: '休みにして、続けて振替先の空席を選ぶ' },
  { resolution: 'manual', label: '何もしない', description: '盤面は変えない(手動で処理する)' },
]

export const PARENT_ABSENCE_RESOLUTION_LABELS: Record<ParentAbsenceResolution, string> = {
  absent: '休み',
  'absent-no-makeup': '振無休',
  'makeup-now': '振替先を今決める',
  manual: '何もしない',
}

// 再通知(前回四択を押したが、保存された盤面に休みの記録が無い)のときの注意文。
// 「保存されなかった」と断定しない: 保存はできていても、ログアウト直前の保存や盤面の「元に戻す」で
// 記録の確認が取れなかった場合もここへ来る(レビュー指摘 2026-09-19)。
export function buildParentAbsenceUnsavedNote(previousResolution: ParentAbsenceResolution | null): string {
  if (!previousResolution || previousResolution === 'manual') return ''
  return `前回「${PARENT_ABSENCE_RESOLUTION_LABELS[previousResolution]}」を選びましたが、保存された盤面で確認が取れなかったため、もう一度表示しています。盤面を確認して選び直してください。`
}

/**
 * 処理済み化 callable(markParentMessagesNotified)の 1 回あたりの上限。サーバーはこれを超える配列を
 * **切り詰めずに invalid-argument で丸ごと拒否**するので、呼び出し側が必ず分割する。
 * 分割しないと対象が 51 件に達した時点で恒久的に失敗する(レビュー指摘 2026-09-13)。
 */
export const PARENT_MESSAGE_MARK_NOTIFIED_CHUNK_SIZE = 50

/** 処理済みにする ID を上限ごとに分割する。空配列なら空配列(callable を呼ばない)。 */
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

// 既存の通知リストへ新着を合流する。同じ id は新着で置き換え(modified 配信の追従)、createdAt 昇順
// (古い連絡が上)。同時刻は id で安定化し、描画順が配信順で揺れないようにする。
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

// --- 保存待ち(盤面へ反映済み・未保存)の管理 ---------------------------------------------------
// オーナー確定(2026-09-18): 四択で盤面を変えた連絡は、**盤面を保存できた時点**で処理済み(notifiedAt)にする。
// 選んだ瞬間に処理済みにすると、保存し忘れて閉じたとき「連絡は処理済みなのに盤面は休みになっていない」が起きる
// (QR提出反映の保存非対称と同型)。保存前に閉じれば pending は消え、次回起動でもう一度通知される。
// - classroomId = その連絡を処理した教室。保存した教室と一致する分だけ処理済みにする(INV-08)。
// - processedAt = 盤面へ反映した時刻(ISO)。**保存したスナップショットの作成時刻以前**の分だけ処理済みにする
//   (保存の通信中に処理した連絡は、その保存の中身に入っていないので次の保存まで待つ)。
// - studentId / dateKey / slotNumber = 保存した盤面に休みの記録が実在するかを確かめるための対象(DOM には出さない)。
export type PendingParentAbsenceFinalize = {
  messageId: string
  classroomId: string
  processedAt: string
  studentId: string
  dateKey: string
  slotNumber: number
}

// 同じ連絡をやり直した(見つからず失敗 → もう一度選んだ等)ときは、新しい processedAt で置き換える。
export function addPendingParentAbsenceFinalize(
  current: readonly PendingParentAbsenceFinalize[],
  entry: PendingParentAbsenceFinalize,
): PendingParentAbsenceFinalize[] {
  if (!entry.messageId || !entry.classroomId || !entry.processedAt) return [...current]
  return [...current.filter((item) => item.messageId !== entry.messageId), entry]
}

/**
 * 保存に成功した教室・その保存に含まれる分を取り出し、**保存した盤面に休みの記録が実在するか**で振り分ける。
 * - toFinalize: 記録がある → 処理済み(notifiedAt)にしてよい。
 * - returned:   記録が無い(四択のあと盤面の「元に戻す」や休み解除で消えた)→ 処理済みにせず保存待ちからも外す
 *               = 一覧へ戻り、室長がもう一度選べる。「連絡は処理済みなのに盤面は休みになっていない」を作らない。
 * - remaining:  他教室の分と、スナップショット作成より後に処理した分(次の保存で判定する)。
 */
export function splitPendingParentAbsenceFinalize(
  current: readonly PendingParentAbsenceFinalize[],
  saved: {
    classroomId: string | null | undefined
    snapshotSavedAt: string | null | undefined
    isRecordedInSavedBoard: (item: PendingParentAbsenceFinalize) => boolean
  },
): { toFinalize: string[]; returned: string[]; remaining: PendingParentAbsenceFinalize[] } {
  if (!saved.classroomId || !saved.snapshotSavedAt) return { toFinalize: [], returned: [], remaining: [...current] }
  const toFinalize: string[] = []
  const returned: string[] = []
  const remaining: PendingParentAbsenceFinalize[] = []
  for (const item of current) {
    if (item.classroomId !== saved.classroomId || item.processedAt > saved.snapshotSavedAt) remaining.push(item)
    else if (saved.isRecordedInSavedBoard(item)) toFinalize.push(item.messageId)
    else returned.push(item.messageId)
  }
  return { toFinalize, returned, remaining }
}

// 購読教室と違う教室の連絡を一覧に出さない(INV-08)。教室を切り替えた直後の 1 レンダーは、前の教室の連絡(entries)と
// 新しい教室の名簿・教室IDが同時に見える。ここで落とさないと、その一瞬に四択を押したとき、前の教室の生徒ID(sNNN は
// 教室ごとに独立採番)で**新しい教室の別人**を休みにしうる(レビュー指摘 2026-09-19)。購読層の doc.classroomId ガードと対。
export function selectParentMessagesForClassroom(entries: readonly ParentMessageEntry[], classroomId: string | null | undefined): ParentMessageEntry[] {
  if (!classroomId) return []
  return entries.filter((entry) => entry.classroomId === classroomId)
}
