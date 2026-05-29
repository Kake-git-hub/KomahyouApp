import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import type { SlotCell, StudentEntry, StudentStatusEntry } from '../../components/schedule-board/types'
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
}

export type BoardSharePayloadInput = Omit<BoardSharePayload, 'cells'> & {
  cells: SlotCell[]
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
  await setDoc(doc(firestore, 'boardShares', payload.token), sanitizeForFirestore(compactBoardSharePayload(payload)))
}

export async function loadBoardShare(token: string) {
  const firestore = requireFirestore()
  const snapshot = await getDoc(doc(firestore, 'boardShares', token))
  if (!snapshot.exists()) return null
  return snapshot.data() as BoardSharePayload
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
      onValue(snapshot.exists() ? snapshot.data() as BoardSharePayload : null)
    },
    onError,
  )
}