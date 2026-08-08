import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import type { SlotCell, StudentEntry, StudentStatusEntry } from '../../components/schedule-board/types'
import { normalizeGroupClassEntryMap, type GroupClassEntryMap } from '../../components/schedule-board/groupClass'
import { getFirebaseFirestoreInstance } from './client'
import { sanitizeForFirestore } from './firestoreSanitize'

export type BoardShareStudentEntry = Pick<
  StudentEntry,
  'id' | 'name' | 'managedStudentId' | 'grade' | 'noteSuffix' | 'makeupSourceDate' | 'makeupSourceLabel' | 'subject' | 'lessonType' | 'teacherType'
>

export type BoardShareStatusEntry = Pick<
  StudentStatusEntry,
  'id' | 'name' | 'managedStudentId' | 'grade' | 'noteSuffix' | 'makeupSourceDate' | 'makeupSourceLabel' | 'subject' | 'lessonType' | 'teacherType' | 'moveDestinationDateKey' | 'status'
>

export type BoardShareCell = Pick<SlotCell, 'id' | 'dateKey' | 'dayLabel' | 'dateLabel' | 'slotLabel' | 'slotNumber'> & {
  // コマの時間帯(例 16:20-17:50)。共有画面のフッターは「N限」ではなくこれを表示する。
  // 旧ドキュメントには存在しないため optional。画面側で slotNumber から補完する(後方互換)。
  timeLabel?: string
  desks: Array<{
    id: string
    teacher: string
    statusSlots?: [BoardShareStatusEntry | null, BoardShareStatusEntry | null]
    lesson?: {
      id: string
      studentSlots: [BoardShareStudentEntry | null, BoardShareStudentEntry | null]
    }
  }>
}

export type BoardSharePayload = {
  schemaVersion: 1
  token: string
  classroomId: string
  classroomName: string
  sharedAt: string
  cells: BoardShareCell[]
  // spec-group-lesson §A: 集団授業の割当(共有画面に集団行を表示するため)。後方互換のため optional。
  groupClassEntries?: GroupClassEntryMap
  // 外部生(生徒基本データの「外部生」チェック)の managedStudentId 一覧。共有画面はこれを見て
  // 授業区分表記を 外) に置き換える。⚠️ 名簿そのものは共有しない(必要なのは ID の集合だけ)。
  // 未設定/旧ドキュメントは「外部生なし」として扱う(後方互換)。
  externalStudentIds?: string[]
}

export type BoardSharePayloadInput = Omit<BoardSharePayload, 'cells'> & {
  cells: SlotCell[]
}

const BOARD_SHARE_GZIP_ENCODING = 'gzip-base64'

// Firestore の 1 ドキュメント上限は約 1MiB。週を多く蓄積した盤面では cells がこれを
// 超えて setDoc がサイレント失敗し「配布用盤面が見つかりません」になる。盤面セルは
// 反復構造が多く gzip で 1 割以下に圧縮できるため、cells を圧縮して保存する。
type StoredBoardShareDoc = {
  schemaVersion: 1
  token: string
  classroomId: string
  classroomName: string
  sharedAt: string
  cells?: BoardShareCell[]
  cellsEncoding?: typeof BOARD_SHARE_GZIP_ENCODING
  compressedCells?: string
  groupClassEntries?: GroupClassEntryMap
  externalStudentIds?: string[]
}

type CompressionStreamConstructor = new (format: 'gzip') => TransformStream
type DecompressionStreamConstructor = new (format: 'gzip') => TransformStream

function getCompressionStreamConstructor() {
  return (globalThis as { CompressionStream?: CompressionStreamConstructor }).CompressionStream
}

function getDecompressionStreamConstructor() {
  return (globalThis as { DecompressionStream?: DecompressionStreamConstructor }).DecompressionStream
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function gzipTextToBase64(text: string) {
  const CompressionStreamClass = getCompressionStreamConstructor()
  if (!CompressionStreamClass) return null
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStreamClass('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return bytesToBase64(new Uint8Array(buffer))
}

async function gunzipBase64ToText(value: string) {
  const DecompressionStreamClass = getDecompressionStreamConstructor()
  if (!DecompressionStreamClass) {
    throw new Error('このブラウザは配布用盤面の圧縮データ読込に未対応です。最新の Chrome / Edge / Safari でお試しください。')
  }
  const stream = new Blob([base64ToBytes(value)]).stream().pipeThrough(new DecompressionStreamClass('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return new TextDecoder().decode(buffer)
}

async function hydrateBoardShareDoc(data: StoredBoardShareDoc | null | undefined): Promise<BoardSharePayload | null> {
  if (!data) return null
  const base = {
    schemaVersion: data.schemaVersion,
    token: data.token,
    classroomId: data.classroomId,
    classroomName: data.classroomName,
    sharedAt: data.sharedAt,
    groupClassEntries: normalizeGroupClassEntryMap(data.groupClassEntries),
    externalStudentIds: normalizeExternalStudentIds(data.externalStudentIds),
  }
  if (data.cellsEncoding === BOARD_SHARE_GZIP_ENCODING && typeof data.compressedCells === 'string') {
    const json = await gunzipBase64ToText(data.compressedCells)
    return { ...base, cells: JSON.parse(json) as BoardShareCell[] }
  }
  return { ...base, cells: Array.isArray(data.cells) ? data.cells : [] }
}

// 共有ドキュメントの externalStudentIds を正規化する。旧ドキュメント(未設定)・型崩れは空配列。
// 重複と空文字を落として並べ替え、公開時の署名比較が値の並び順で揺れないようにする。
export function normalizeExternalStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return Array.from(new Set(ids)).sort()
}

// 共有画面での外部生判定の唯一の権威関数。managedStudentId を持たない体験生・メモは常に false。
export function isExternalBoardShareStudent(
  externalStudentIds: ReadonlySet<string>,
  student: Pick<BoardShareStudentEntry, 'managedStudentId'> | null | undefined,
) {
  const managedStudentId = student?.managedStudentId
  return Boolean(managedStudentId && externalStudentIds.has(managedStudentId))
}

function compactStudentEntry(student: StudentEntry | null): BoardShareStudentEntry | null {
  if (!student) return null
  const { id, name, managedStudentId, grade, noteSuffix, makeupSourceDate, makeupSourceLabel, subject, lessonType, teacherType } = student
  return { id, name, managedStudentId, grade, noteSuffix, makeupSourceDate, makeupSourceLabel, subject, lessonType, teacherType }
}

function compactStatusEntry(status: StudentStatusEntry | null): BoardShareStatusEntry | null {
  if (!status) return null
  const { id, name, managedStudentId, grade, noteSuffix, makeupSourceDate, makeupSourceLabel, subject, lessonType, teacherType, moveDestinationDateKey, status: statusKind } = status
  return { id, name, managedStudentId, grade, noteSuffix, makeupSourceDate, makeupSourceLabel, subject, lessonType, teacherType, moveDestinationDateKey, status: statusKind }
}

export function compactBoardSharePayload(payload: BoardSharePayloadInput): BoardSharePayload {
  return {
    ...payload,
    cells: payload.cells.map((cell) => ({
      id: cell.id,
      dateKey: cell.dateKey,
      dayLabel: cell.dayLabel,
      dateLabel: cell.dateLabel,
      slotLabel: cell.slotLabel,
      slotNumber: cell.slotNumber,
      timeLabel: cell.timeLabel,
      desks: cell.desks.map((desk) => ({
        id: desk.id,
        teacher: desk.teacher,
        statusSlots: desk.statusSlots
          ? [compactStatusEntry(desk.statusSlots[0]), compactStatusEntry(desk.statusSlots[1])]
          : undefined,
        lesson: desk.lesson
          ? {
              id: desk.lesson.id,
              studentSlots: [compactStudentEntry(desk.lesson.studentSlots[0]), compactStudentEntry(desk.lesson.studentSlots[1])],
            }
          : undefined,
      })),
    })),
  }
}

function requireFirestore() {
  const firestore = getFirebaseFirestoreInstance()
  if (!firestore) throw new Error('Firebase 設定が不足しているため、配布用URLを作成できません。')
  return firestore
}

export async function publishBoardShare(payload: BoardSharePayloadInput) {
  const firestore = requireFirestore()
  const compacted = compactBoardSharePayload(payload)
  const base = {
    schemaVersion: compacted.schemaVersion,
    token: compacted.token,
    classroomId: compacted.classroomId,
    classroomName: compacted.classroomName,
    sharedAt: compacted.sharedAt,
    groupClassEntries: normalizeGroupClassEntryMap(compacted.groupClassEntries),
    externalStudentIds: normalizeExternalStudentIds(compacted.externalStudentIds),
  }
  // 圧縮して Firestore 1MiB 上限を回避する。CompressionStream 非対応環境では従来どおり
  // 非圧縮で保存（小さい盤面はそのまま通る）。
  const compressedCells = await gzipTextToBase64(JSON.stringify(compacted.cells)).catch(() => null)
  const docData: StoredBoardShareDoc = compressedCells
    ? { ...base, cellsEncoding: BOARD_SHARE_GZIP_ENCODING, compressedCells }
    : { ...base, cells: compacted.cells }
  await setDoc(doc(firestore, 'boardShares', payload.token), sanitizeForFirestore(docData))
}

export async function loadBoardShare(token: string) {
  const firestore = requireFirestore()
  const snapshot = await getDoc(doc(firestore, 'boardShares', token))
  if (!snapshot.exists()) return null
  return hydrateBoardShareDoc(snapshot.data() as StoredBoardShareDoc)
}

export function subscribeBoardShare(
  token: string,
  onValue: (payload: BoardSharePayload | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const firestore = requireFirestore()
  return onSnapshot(
    doc(firestore, 'boardShares', token),
    (snapshot) => {
      if (!snapshot.exists()) {
        onValue(null)
        return
      }
      hydrateBoardShareDoc(snapshot.data() as StoredBoardShareDoc)
        .then(onValue)
        .catch((error) => onError(error instanceof Error ? error : new Error(String(error))))
    },
    onError,
  )
}