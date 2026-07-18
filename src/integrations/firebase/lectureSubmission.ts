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
  // 「後から出席可能に変更」されたコマ(室長所有の配布情報・2026-07-18)。提出内容(unavailableSlots)とは
  // 別レイヤで、登録解除(resetLectureSubmissionDoc)でもクリアしない。新規提出(POST)でサーバーが空にリセットする。
  // 提出ページは unavailableSlots ∩ reopenedSlots を黄色表示する。後方互換のため optional。
  reopenedSlots?: string[]
  subjectSlots: Record<string, number>
  // 科目ごとの授業時間(分)。未設定=90分扱い。後方互換のため optional。
  subjectDurations?: Record<string, number>
  // spec-group-lesson §C: 集団授業の希望提出。
  // availableGroupClassSubjects=この生徒が選べる集団科目(中3のみ非空)。空/未設定=提出ページに集団欄を出さない。
  // groupClassParticipation=科目→参加(true)。未設定/false=不参加(既定)。後方互換のため optional。
  availableGroupClassSubjects?: string[]
  groupClassParticipation?: Record<string, boolean>
  // 生徒日程表のオプション欄(開発用教室)。optionLabels=学年共通のオプション文言(行0..4。空文字は提出ページに出さない)。
  // optionChecks=提出されたチェック状態(キー=行番号'0'..'4' -> true)。未設定/false=未チェック(既定)。後方互換のため optional。
  optionLabels?: string[]
  optionChecks?: Record<string, boolean>
  regularOnly: boolean
  occupiedSlots: Record<string, string>
  // spec-group-lesson §E: 中3の集団授業コマ(盤面に組まれた集団理科/集団社会)を提出ページの集団列に表示する。
  // key=`${dateKey}_${band}`(band=1|2)、value=科目('集団理科'|'集団社会')。中3のみ非空。後方互換のため optional。
  groupClassSlots?: Record<string, string>
  submittedAt: string | null
  createdAt: string
}

export async function ensureSubmissionTokens(
  session: SpecialSessionRow,
  students: Array<{ id: string; name: string; availableSubjects: string[]; availableGroupClassSubjects?: string[]; occupiedSlots?: Record<string, string>; groupClassSlots?: Record<string, string>; optionLabels?: string[] }>,
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
        optionLabels: [...(student.optionLabels ?? [])],
        optionChecks: {},
        regularOnly: false,
        occupiedSlots: student.occupiedSlots ?? {},
        groupClassSlots: { ...(student.groupClassSlots ?? {}) },
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
 * TTL付きの「最近リセットされた提出トークン」ガード。
 *
 * 目的（消してはならないガード・監査領域7 B4 の是正 2026-07-04）:
 *   室長が日程表の登録トグルを OFF にすると、ローカル state は即座に countSubmitted=false へ
 *   楽観更新され、直後に resetLectureSubmissionDoc（getDoc→setDoc の非同期2ステップ）で
 *   Firestore doc を pending に戻す。この書き込みが完了する前に、購読中の onSnapshot が
 *   「まだ status='submitted' の（リセット前の）」スナップショットを配信すると、反映ロジックは
 *   「ローカルは未登録なのに submitted が来た＝新規提出」と誤認して countSubmitted を復活させる。
 *   ＝室長が登録解除した直後に登録が勝手に戻るレース。
 *
 * このガードは reset 前に token を add() し、購読反映側は has(token) が true の間その token の
 * 反映を無視する。ネットワーク遅延・リセット前後に届く古いスナップショットを吸収するため、
 * add から一定時間（既定2.5秒）後にタイマーで自動 delete する（即時 delete だと取りこぼす）。
 *
 * timer はテストから注入できる（set/clear を差し替えて仮想時間で検証する）。
 */
export type RecentlyResetGuard = {
  add(token: string): void
  has(token: string): boolean
  /** テスト/クリーンアップ用: 全タイマーを解除して集合を空にする。 */
  clear(): void
}

type GuardTimer = {
  set: (callback: () => void, delayMs: number) => number
  clear: (id: number) => void
}

const DEFAULT_RECENTLY_RESET_TTL_MS = 2500

export function createRecentlyResetGuard(
  ttlMs: number = DEFAULT_RECENTLY_RESET_TTL_MS,
  timer: GuardTimer = {
    set: (callback, delayMs) => (typeof window !== 'undefined' ? window.setTimeout(callback, delayMs) : (setTimeout(callback, delayMs) as unknown as number)),
    clear: (id) => (typeof window !== 'undefined' ? window.clearTimeout(id) : clearTimeout(id as unknown as ReturnType<typeof setTimeout>)),
  },
): RecentlyResetGuard {
  const tokens = new Set<string>()
  const timers = new Map<string, number>()

  const forget = (token: string) => {
    tokens.delete(token)
    const timerId = timers.get(token)
    if (timerId !== undefined) {
      timer.clear(timerId)
      timers.delete(token)
    }
  }

  return {
    add(token: string) {
      if (!token) return
      // 既存タイマーがあれば張り直して TTL を延長する（連続解除でも最後の add から ttlMs 保持）。
      const existing = timers.get(token)
      if (existing !== undefined) timer.clear(existing)
      tokens.add(token)
      timers.set(token, timer.set(() => forget(token), ttlMs))
    },
    has(token: string) {
      return tokens.has(token)
    },
    clear() {
      for (const id of timers.values()) timer.clear(id)
      timers.clear()
      tokens.clear()
    },
  }
}

/**
 * 本番データ保護(2026-07-19): この提出ドキュメントが「操作中の教室のもの」でなければ true。
 *
 * 開発用教室でも本番と同じく「登録=常にロック / 登録解除=常にリセット」する方針にしたため
 * (呼び出し側の isActingDevelopmentClassroom スキップを撤廃)、書き込みの直前にここで
 * doc.classroomId を権威として自教室以外への書き込みを構造的に禁止する。
 * 「提出先はトークンの classroomId で決まる」([[komahyou-dev-classroom-qr-token-contamination]])。
 * - expectedClassroomId 未指定(後方互換の直接呼び出し/テスト)や doc に classroomId が無い旧トークンは
 *   false を返して従来どおり書き込みを妨げない。
 * - expectedClassroomId 指定かつ doc.classroomId が別教室のときだけ true(=書き込みを弾く)。
 */
function isForeignClassroomSubmissionDoc(
  data: { classroomId?: unknown } | undefined,
  expectedClassroomId?: string | null,
): boolean {
  if (!expectedClassroomId) return false
  const docClassroomId = typeof data?.classroomId === 'string' ? data.classroomId : ''
  return docClassroomId !== '' && docClassroomId !== expectedClassroomId
}

/**
 * 登録削除（spec §E / TODO2）: 提出内容をクリアして pending に戻し、同じQRで再提出可能にする。
 * occupiedSlots / availableSubjects / slotNumbers 等の配布情報は維持する。
 * reopenedSlots(後から出席可能に変更)も配布情報として維持する（クリア対象に加えると
 * 「登録解除しても黄色コマはキープ」の確定仕様(2026-07-18)が壊れる）。
 * expectedClassroomId を渡すと、別教室の doc には書き込まない(本番データ保護・上記ヘルパ参照)。
 */
export async function resetLectureSubmissionDoc(token: string, expectedClassroomId?: string | null) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  const existing = await getDoc(docRef)
  if (!existing.exists()) return
  const data = existing.data()
  if (isForeignClassroomSubmissionDoc(data, expectedClassroomId)) return

  await setDoc(docRef, {
    ...data,
    status: 'pending',
    unavailableSlots: [],
    subjectSlots: {},
    subjectDurations: {},
    groupClassParticipation: {},
    optionChecks: {},
    regularOnly: false,
    submittedAt: null,
  })
}

/**
 * 登録解除（countSubmitted OFF）時の共通処理（INV-07）。
 *
 * reset 前に必ずトークンを recentlyReset ガードへ add してから pending へ戻す。生徒・講師の両解除経路を
 * この1関数へ集約し、「片方だけガードを付け忘れる」非対称を構造的に不可能にする。
 *   実害（このガード add を欠くと）: 解除で楽観的に countSubmitted=false へ更新した直後、reset 完了前に
 *   届いた「まだ submitted の」古いスナップショットを購読反映が「新規提出」と誤認し、登録と盤面配置を復活させる。
 *   生徒経路は v1.5.392 で add を入れたが、講師経路（schedule-teacher-count-save の解除）に add が欠けていた回帰。
 */
export function guardAndResetLectureSubmissionDoc(
  guard: RecentlyResetGuard,
  token: string | null | undefined,
  expectedClassroomId?: string | null,
) {
  if (!token) return Promise.resolve()
  guard.add(token)
  return resetLectureSubmissionDoc(token, expectedClassroomId)
}

/**
 * spec-group-lesson §C: 既に配布済みのQR(集団欄なしで作られた古いトークン)でも中3が集団参加を選べるよう、
 * 未提出(pending)ドキュメントの availableGroupClassSubjects を後埋めする。
 * 提出済み(submitted)は再提出不可なので触らない。既に同値なら書き込まない(冪等)。
 */
export async function updateSubmissionGroupClassEligibility(token: string, availableGroupClassSubjects: string[]) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  const existing = await getDoc(docRef)
  if (!existing.exists()) return
  const data = existing.data() as LectureSubmissionDoc
  if (data.status === 'submitted') return
  const current = Array.isArray(data.availableGroupClassSubjects) ? data.availableGroupClassSubjects : []
  const isSame = current.length === availableGroupClassSubjects.length
    && current.every((value, index) => value === availableGroupClassSubjects[index])
  if (isSame) return

  await setDoc(docRef, { ...data, availableGroupClassSubjects: [...availableGroupClassSubjects] })
}

/**
 * Mark a submission doc as submitted (lock from phone editing).
 *
 * 室長が生徒日程表の「登録」ボタンで決めた保護者所有フィールド(集団参加 groupClassParticipation /
 * オプション optionChecks)を渡された場合は、ロックと同時に提出ドキュメントへ書き戻す。
 * これを書き戻さないと doc 側が古い(空)ままになり、購読の反映(doc→ローカル)
 * (reflectParentOwnedSubmissionFields)が室長の手動設定を空で上書きして消す。
 * 実害: 生徒日程表で中3を集団に参加登録しても「最新表示」/再読込で集団参加が消える回帰
 * (登録解除→登録の経路では resetLectureSubmissionDoc が doc の集団参加を空に戻すため特に再発しやすい)。
 * 渡されないフィールドは従来どおり既存値を保全する(講師経路など)。
 */
export async function markLectureSubmissionDocAsSubmitted(
  token: string,
  parentOwnedFields?: { groupClassParticipation?: Record<string, boolean>; optionChecks?: Record<string, boolean> },
  expectedClassroomId?: string | null,
) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  const existing = await getDoc(docRef)
  if (!existing.exists()) return

  const data = existing.data()
  if (data.status === 'submitted') return
  // 本番データ保護: 別教室の doc はロックしない(開発用教室で他教室由来トークンを提出済みにしない)。
  if (isForeignClassroomSubmissionDoc(data, expectedClassroomId)) return

  await setDoc(docRef, {
    ...data,
    ...(parentOwnedFields?.groupClassParticipation !== undefined
      ? { groupClassParticipation: { ...parentOwnedFields.groupClassParticipation } }
      : {}),
    ...(parentOwnedFields?.optionChecks !== undefined
      ? { optionChecks: { ...parentOwnedFields.optionChecks } }
      : {}),
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

/**
 * 「後から出席可能に変更」(reopenedSlots)を提出ドキュメントへ反映する。
 * 室長の変換操作(盤面/日程表)の直後に呼び、保護者/講師がQRを開いたとき黄色表示が即反映されるようにする。
 * 提出済み(submitted)ドキュメントも更新対象(変換は通常提出後に起きるため)。同値なら書き込まない(冪等)。
 */
export async function updateSubmissionReopenedSlots(token: string, reopenedSlots: string[]) {
  const db = getFirebaseFirestoreInstance()
  if (!db || !token) return

  const docRef = doc(db, 'lectureSubmissions', token)
  const existing = await getDoc(docRef)
  if (!existing.exists()) return
  const data = existing.data() as LectureSubmissionDoc
  const current = Array.isArray(data.reopenedSlots) ? data.reopenedSlots : []
  const isSame = current.length === reopenedSlots.length
    && current.every((value, index) => value === reopenedSlots[index])
  if (isSame) return

  await setDoc(docRef, { ...data, reopenedSlots: [...reopenedSlots] })
}

/** Update occupiedSlots on existing submission docs so the phone screen reflects current board state */
export async function updateSubmissionOccupiedSlots(
  entries: Array<{ token: string; occupiedSlots: Record<string, string>; slotNumbers?: number[]; holidayDates?: string[]; groupClassSlots?: Record<string, string>; optionLabels?: string[]; availableSubjects?: string[]; reopenedSlots?: string[] }>,
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
      // spec-group-lesson §E: 既発行QRにも最新の集団授業コマ(集理/集社)を反映する。
      ...(entry.groupClassSlots ? { groupClassSlots: { ...entry.groupClassSlots } } : {}),
      // オプション欄(開発用教室): 既発行QRにも最新のオプション文言(学年共通)を反映する。
      ...(entry.optionLabels ? { optionLabels: [...entry.optionLabels] } : {}),
      // 既発行QRにも最新の選択可能科目を反映する。理社など後から追加した科目が、
      // トークン発行済みの生徒の提出画面に出ないのを防ぐ(availableSubjects は発行時に凍結されるため)。
      // 提出済みドキュメントでも害はない(提出画面は subjectSlots>0 の科目だけ表示するため未選択科目は出ない)。
      ...(entry.availableSubjects ? { availableSubjects: [...entry.availableSubjects] } : {}),
      // 「後から出席可能に変更」(reopenedSlots)の後追い反映。変換直後の updateSubmissionReopenedSlots が
      // 失敗した場合でも、日程表を開いたタイミングでアプリ内の正へ収束させる(アプリ内 state が正)。
      ...(entry.reopenedSlots ? { reopenedSlots: [...entry.reopenedSlots] } : {}),
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
  optionChecks: Record<string, boolean>
  regularOnly: boolean
  // 講習集計結果の「提出日時」列に使う。QR提出ドキュメントの提出時刻(ISO文字列)。未設定=null。
  submittedAt: string | null
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
          optionChecks: data.optionChecks ?? {},
          regularOnly: data.regularOnly ?? false,
          submittedAt: typeof data.submittedAt === 'string' ? data.submittedAt : null,
        })
      }
    }
    if (entries.length > 0) onSubmitted(entries, isInitial)
  })

  return unsubscribe
}
