import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'
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
  forceOpenDates: string[]
  availableSubjects: string[]
  slotCount: number
  status: 'pending' | 'submitted'
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  regularOnly: boolean
  submittedAt: string | null
  createdAt: string
}

export async function ensureSubmissionTokens(
  session: SpecialSessionRow,
  students: Array<{ id: string; name: string; availableSubjects: string[] }>,
  teachers: Array<{ id: string; name: string }>,
  classroomSettings: { closedWeekdays: number[]; forceOpenDates: string[] },
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
        forceOpenDates: [...classroomSettings.forceOpenDates],
        availableSubjects: [],
        slotCount: 7,
        status: 'pending',
        unavailableSlots: [],
        subjectSlots: {},
        regularOnly: false,
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
        forceOpenDates: [...classroomSettings.forceOpenDates],
        availableSubjects: [...student.availableSubjects],
        slotCount: 7,
        status: 'pending',
        unavailableSlots: [],
        subjectSlots: {},
        regularOnly: false,
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
    regularOnly: false,
    submittedAt: null,
  })
}

export async function deleteLectureSubmissionDoc(token: string) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  await deleteDoc(docRef)
}
