import { doc, getDoc, setDoc, deleteDoc, collection, query, where, onSnapshot } from 'firebase/firestore'
import { getFirebaseFirestoreInstance } from './client'
import { getFirebaseBackendConfig } from './config'
import type { SpecialSessionRow } from '../../components/special-data/specialSessionModel'

function generateSubmissionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export type LectureSubmissionDoc = {
  workspaceKey: string
  classroomId: string
  sessionId: string
  personType: 'student' | 'teacher'
  personId: string
  personName: string
  sessionLabel: string
  sessionStartDate: string
  sessionEndDate: string
  closedWeekdays: number[]
  // コマ表側で個別に休日設定した日付(YYYY-MM-DD)。定休日と合わせて提出不可にする。後方互換のため optional。
  holidayDates?: string[]
  forceOpenDates: string[]
  availableSubjects: string[]
  slotCount: number
  slotNumbers?: number[]
  status: 'pending' | 'submitted'
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  // 科目ごとの授業時間(分)。未設定=90分扱い。後方互換のため optional。
  subjectDurations?: Record<string, number>
  // spec-group-lesson §C: 集団授業の希望提出。
  // availableGroupClassSubjects=この生徒が選べる集団科目(中3のみ非空)。空/未設定=提出ページに集団欄を出さない。
  // groupClassParticipation=科目→参加(true)。未設定/false=不参加(既定)。後方互換のため optional。
  availableGroupClassSubjects?: string[]
  groupClassParticipation?: Record<string, boolean>
  regularOnly: boolean
  occupiedSlots: Record<string, string>
  submittedAt: string | null
  createdAt: string
}

export async function ensureSubmissionTokens(
  session: SpecialSessionRow,
  students: Array<{ id: string; name: string; availableSubjects: string[]; availableGroupClassSubjects?: string[]; occupiedSlots?: Record<string, string> }>,
  teachers: Array<{ id: string; name: string; occupiedSlots?: Record<string, string> }>,
  classroomSettings: { closedWeekdays: number[]; holidayDates?: string[]; forceOpenDates: string[] },
  slotNumbers: number[],
): Promise<{ updatedSession: SpecialSessionRow; newTokens: Array<{ token: string; doc: LectureSubmissionDoc }> }> {
  const config = getFirebaseBackendConfig()
  if (!config.enabled) return { updatedSession: session, newTokens: [] }

  const updatedAt = new Date().toISOString()
  const newTokens: Array<{ token: string; doc: LectureSubmissionDoc }> = []
  const updatedTeacherInputs = { ...session.teacherInputs }
  const updatedStudentInputs = { ...session.studentInputs }

  for (const teacher of teachers) {
    const existing = updatedTeacherInputs[teacher.id]
    if (existing?.submissionToken) continue
    const token = generateSubmissionToken()
    updatedTeacherInputs[teacher.id] = {
      ...(existing ?? { unavailableSlots: [], countSubmitted: false, updatedAt }),
      submissionToken: token,
    }
    newTokens.push({
      token,
      doc: {
        workspaceKey: config.workspaceKey,
        classroomId: '', // filled by caller
        sessionId: session.id,
        personType: 'teacher',
        personId: teacher.id,
        personName: teacher.name,
        sessionLabel: session.label,
        sessionStartDate: session.startDate,
        sessionEndDate: session.endDate,
        closedWeekdays: [...classroomSettings.closedWeekdays],
        holidayDates: [...(classroomSettings.holidayDates ?? [])],
        forceOpenDates: [...classroomSettings.forceOpenDates],
        availableSubjects: [],
        slotCount: slotNumbers.length,
        slotNumbers: [...slotNumbers],
        status: 'pending',
        unavailableSlots: [],
        subjectSlots: {},
        regularOnly: false,
        occupiedSlots: teacher.occupiedSlots ?? {},
        submittedAt: null,
        createdAt: updatedAt,
      },
    })
  }

  for (const student of students) {
    const existing = updatedStudentInputs[student.id]
    if (existing?.submissionToken) continue
    const token = generateSubmissionToken()
    updatedStudentInputs[student.id] = {
      ...(existing ?? { unavailableSlots: [], regularBreakSlots: [], subjectSlots: {}, regularOnly: false, countSubmitted: false, updatedAt }),
      submissionToken: token,
    }
    newTokens.push({
      token,
      doc: {
        workspaceKey: config.workspaceKey,
        classroomId: '', // filled by caller
        sessionId: session.id,
        personType: 'student',
        personId: student.id,
        personName: student.name,
        sessionLabel: session.label,
        sessionStartDate: session.startDate,
        sessionEndDate: session.endDate,
        closedWeekdays: [...classroomSettings.closedWeekdays],
        holidayDates: [...(classroomSettings.holidayDates ?? [])],
        forceOpenDates: [...classroomSettings.forceOpenDates],
        availableSubjects: [...student.availableSubjects],
        availableGroupClassSubjects: [...(student.availableGroupClassSubjects ?? [])],
        slotCount: slotNumbers.length,
        slotNumbers: [...slotNumbers],
        status: 'pending',
        unavailableSlots: [],
        subjectSlots: {},
        subjectDurations: {},
        groupClassParticipation: {},
        regularOnly: false,
        occupiedSlots: student.occupiedSlots ?? {},
        submittedAt: null,
        createdAt: updatedAt,
      },
    })
  }

  const updatedSession: SpecialSessionRow = {
    ...session,
    teacherInputs: updatedTeacherInputs,
    studentInputs: updatedStudentInputs,
    updatedAt,
  }

  return { updatedSession, newTokens }
}

export async function writeSubmissionDocs(newTokens: Array<{ token: string; doc: LectureSubmissionDoc }>, classroomId: string) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !newTokens.length) return

  for (const entry of newTokens) {
    const docRef = doc(db, 'lectureSubmissions', entry.token)
    await setDoc(docRef, { ...entry.doc, classroomId })
  }
}

/**
 * 登録削除（spec §E / TODO2）: 提出内容をクリアして pending に戻し、同じQRで再提出可能にする。
 * occupiedSlots / availableSubjects / slotNumbers 等の配布情報は維持する。
 */
export async function resetLectureSubmissionDoc(token: string) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  const existing = await getDoc(docRef)
  if (!existing.exists()) return

  await setDoc(docRef, {
    ...existing.data(),
    status: 'pending',
    unavailableSlots: [],
    subjectSlots: {},
    subjectDurations: {},
    groupClassParticipation: {},
    regularOnly: false,
    submittedAt: null,
  })
}

/** Mark a submission doc as submitted (lock from phone editing) without changing the submitted data */
export async function markLectureSubmissionDocAsSubmitted(token: string) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  const existing = await getDoc(docRef)
  if (!existing.exists()) return

  const data = existing.data()
  if (data.status === 'submitted') return

  await setDoc(docRef, {
    ...data,
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  })
}

export async function deleteLectureSubmissionDoc(token: string) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  await deleteDoc(docRef)
}

/** Update occupiedSlots on existing submission docs so the phone screen reflects current board state */
export async function updateSubmissionOccupiedSlots(
  entries: Array<{ token: string; occupiedSlots: Record<string, string>; slotNumbers?: number[]; holidayDates?: string[] }>,
) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !entries.length) return

  for (const entry of entries) {
    if (!entry.token) continue
    const docRef = doc(db, 'lectureSubmissions', entry.token)
    const existing = await getDoc(docRef)
    if (!existing.exists()) continue
    const data = existing.data()
    await setDoc(docRef, {
      ...data,
      occupiedSlots: entry.occupiedSlots,
      // 既発行トークンにも最新の休日設定を反映する(後から休日を設定/解除した場合に提出側へ伝播)。
      ...(entry.holidayDates ? { holidayDates: [...entry.holidayDates] } : {}),
      ...(entry.slotNumbers ? { slotNumbers: [...entry.slotNumbers], slotCount: entry.slotNumbers.length } : {}),
    })
  }
}

export type SubmissionChangeEntry = {
  token: string
  sessionId: string
  personType: 'student' | 'teacher'
  personId: string
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  subjectDurations: Record<string, number>
  groupClassParticipation: Record<string, boolean>
  regularOnly: boolean
}

export function subscribeLectureSubmissions(
  classroomId: string,
  // isInitial=true は購読直後の初回スナップショット(=既存の提出済みドキュメントの一括配信)。
  // 起動直後に過去の提出を「新着」として通知してしまうのを呼び出し側で抑止できるようにする。
  onSubmitted: (entries: SubmissionChangeEntry[], isInitial: boolean) => void,
): () => void {
  const db = getFirebaseFirestoreInstance()
  if (!db || !classroomId) return () => {}

  const q = query(
    collection(db, 'lectureSubmissions'),
    where('classroomId', '==', classroomId),
    where('status', '==', 'submitted'),
  )

  let isInitialSnapshot = true
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const isInitial = isInitialSnapshot
    isInitialSnapshot = false
    const entries: SubmissionChangeEntry[] = []
    for (const change of snapshot.docChanges()) {
      if (change.type === 'added' || change.type === 'modified') {
        const data = change.doc.data() as LectureSubmissionDoc
        entries.push({
          token: change.doc.id,
          sessionId: data.sessionId,
          personType: data.personType,
          personId: data.personId,
          unavailableSlots: data.unavailableSlots ?? [],
          subjectSlots: data.subjectSlots ?? {},
          subjectDurations: data.subjectDurations ?? {},
          groupClassParticipation: data.groupClassParticipation ?? {},
          regularOnly: data.regularOnly ?? false,
        })
      }
    }
    if (entries.length > 0) onSubmitted(entries, isInitial)
  })

  return unsubscribe
}
