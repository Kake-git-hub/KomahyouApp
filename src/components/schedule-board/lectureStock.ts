import { formatStudentSelectionLabel, type StudentRow } from '../basic-data/basicDataModel'
import type { SubjectLabel } from './types'
import { resolveEffectiveUnavailableSlots, type SpecialSessionRow } from '../special-data/specialSessionModel'
import type { LectureStockCountMap, ManualLectureStockOrigin } from '../../types/appState'

export type LectureStockEntry = {
  key: string
  sessionId: string
  sessionLabel: string
  studentId: string
  displayName: string
  subject: SubjectLabel
  requestedCount: number
}

export function buildLectureStockEntries(params: {
  specialSessions: SpecialSessionRow[]
  students: StudentRow[]
  // 表示名の学年ラベル基準日(YYYY-MM-DD)。省略時は今日基準(本番挙動)。
  // テストはゴールデンが年度替わり(毎年4/1)で揺れないよう固定日付を渡す。
  referenceDate?: string
}) {
  const { specialSessions, students, referenceDate } = params
  const studentMap = new Map(students.map((student) => [student.id, student]))

  return specialSessions
    .flatMap((session) => Object.entries(session.studentInputs).flatMap(([studentId, input]) => {
      if (!input.countSubmitted) return []
      if (input.regularOnly) return []

      const student = studentMap.get(studentId)
      const displayName = student ? formatStudentSelectionLabel(student, referenceDate) : studentId

      return Object.entries(input.subjectSlots)
        .map(([subject, requestedCount]) => ({
          key: `${session.id}__${studentId}__${subject}`,
          sessionId: session.id,
          sessionLabel: session.label,
          studentId,
          displayName,
          subject: subject as SubjectLabel,
          requestedCount: Number.isFinite(requestedCount) ? Math.max(0, Math.trunc(requestedCount)) : 0,
        }))
        .filter((entry) => entry.requestedCount > 0)
    }))
    .sort((left, right) => {
      const sessionCompare = left.sessionLabel.localeCompare(right.sessionLabel, 'ja')
      if (sessionCompare !== 0) return sessionCompare

      const studentCompare = left.displayName.localeCompare(right.displayName, 'ja')
      if (studentCompare !== 0) return studentCompare

      return left.subject.localeCompare(right.subject, 'ja')
    })
}

export function buildLectureStockKey(studentKey: string, subject: string, sessionId?: string) {
  return sessionId ? `${studentKey}__${subject}__${sessionId}` : `${studentKey}__${subject}`
}

export function buildLectureStockScopeKey(studentKey: string, sessionId?: string) {
  return `${studentKey}__${sessionId ?? '-'}`
}

export function parseLectureStockKey(key: string) {
  const [studentKey = key, subject = '', sessionId] = key.split('__')
  return { studentKey, subject, sessionId }
}

export type LectureStockPendingItem = {
  stockKey: string
  subject: SubjectLabel
  source: 'session' | 'manual'
  sessionId?: string
  sessionLabel?: string
  originDateKey?: string
  originSlotNumber?: number
  startDate?: string
  endDate?: string
  unavailableSlots?: string[]
}

export type LecturePendingScopedEntry = {
  studentKey: string
  studentId: string | null
  displayName: string
  sessionId?: string
  sessionLabel?: string
  pendingItems: LectureStockPendingItem[]
}

// 未消化講習の残数計算（spec-lecture-stock データモデル）。
// 講習残数は盤面を走査せず、提出希望数(requestedCount)の pending 展開に
// manualLectureStockCounts のデルタ台帳（負=session 配置消費・正=盤面戻し/繰越）を適用して算出する。
// ★消してはならないガード:
//   - 負デルタは pending 展開の先頭から個数分だけ削る（振替の元日付突き合わせとは別方式）。
//   - 正デルタは manualLectureStockOrigins のメタデータを先頭から対応付けて manual 項目として追加する。
// 符号・順序を変えると残数が静かにズレる（回帰テスト lecturePendingItems.test.ts で保護）。
export function buildLecturePendingItemsByEntryKey(params: {
  rawLectureStockEntries: LectureStockEntry[]
  specialSessions: SpecialSessionRow[]
  manualLectureStockCounts: LectureStockCountMap
  manualLectureStockOrigins: Record<string, ManualLectureStockOrigin[]>
  fallbackLectureStockStudents: Record<string, { displayName: string; subject?: string }>
}): Map<string, LecturePendingScopedEntry> {
  const {
    rawLectureStockEntries,
    specialSessions,
    manualLectureStockCounts,
    manualLectureStockOrigins,
    fallbackLectureStockStudents,
  } = params

  const expandedRawItemsByStockKey = new Map<string, Array<{
    studentKey: string
    studentId: string
    displayName: string
    item: LectureStockPendingItem
  }>>()

  for (const stockEntry of rawLectureStockEntries) {
    if (stockEntry.requestedCount <= 0) continue
    const session = specialSessions.find((currentSession) => currentSession.id === stockEntry.sessionId)
    // 実効不可(unavailableSlots − reopenedSlots)。「出席可能に変更」済みコマは自動割振の候補に含める。
    const unavailableSlots = resolveEffectiveUnavailableSlots(session?.studentInputs[stockEntry.studentId])
    const stockKey = buildLectureStockKey(stockEntry.studentId, stockEntry.subject, stockEntry.sessionId)
    const currentItems = expandedRawItemsByStockKey.get(stockKey) ?? []
    for (let index = 0; index < stockEntry.requestedCount; index += 1) {
      currentItems.push({
        studentKey: stockEntry.studentId,
        studentId: stockEntry.studentId,
        displayName: stockEntry.displayName,
        item: {
          stockKey,
          subject: stockEntry.subject,
          source: 'session',
          sessionId: stockEntry.sessionId,
          sessionLabel: stockEntry.sessionLabel,
          startDate: session?.startDate,
          endDate: session?.endDate,
          unavailableSlots,
        },
      })
    }
    expandedRawItemsByStockKey.set(stockKey, currentItems)
  }

  const scopedItems = new Map<string, Array<{
    studentKey: string
    studentId: string | null
    displayName: string
    item: LectureStockPendingItem
  }>>()

  for (const [stockKey, rawItems] of expandedRawItemsByStockKey.entries()) {
    const adjustment = manualLectureStockCounts[stockKey] ?? 0
    const consumeCount = adjustment < 0 ? Math.min(rawItems.length, Math.abs(adjustment)) : 0
    for (const rawItem of rawItems.slice(consumeCount)) {
      const scopeKey = buildLectureStockScopeKey(rawItem.studentKey, rawItem.item.sessionId)
      const currentItems = scopedItems.get(scopeKey) ?? []
      currentItems.push({
        studentKey: rawItem.studentKey,
        studentId: rawItem.studentId,
        displayName: rawItem.displayName,
        item: rawItem.item,
      })
      scopedItems.set(scopeKey, currentItems)
    }
  }

  const metadataQueueByKey = new Map<string, ManualLectureStockOrigin[]>(
    Object.entries(manualLectureStockOrigins).map(([key, origins]) => [key, origins.map((origin) => ({ ...origin }))]),
  )

  for (const [stockKey, requestedCount] of Object.entries(manualLectureStockCounts)) {
    if (requestedCount <= 0) continue
    const { studentKey, subject, sessionId } = parseLectureStockKey(stockKey)
    const fallback = fallbackLectureStockStudents[stockKey]
    const fallbackDisplayName = fallback?.displayName ?? studentKey.replace(/^name:/, '')
    const metadataQueue = metadataQueueByKey.get(stockKey) ?? []

    for (let index = 0; index < requestedCount; index += 1) {
      const metadata = metadataQueue.shift()
      const resolvedSessionId = metadata?.sessionId ?? sessionId
      const session = resolvedSessionId
        ? specialSessions.find((currentSession) => currentSession.id === resolvedSessionId) ?? null
        : null
      const scopeKey = buildLectureStockScopeKey(studentKey, resolvedSessionId)
      const currentItems = scopedItems.get(scopeKey) ?? []
      currentItems.push({
        studentKey,
        studentId: studentKey.startsWith('name:') ? null : studentKey,
        displayName: metadata?.displayName ?? fallbackDisplayName,
        item: {
          stockKey,
          subject: (fallback?.subject ?? subject) as SubjectLabel,
          source: 'manual',
          sessionId: resolvedSessionId,
          originDateKey: metadata?.originDateKey,
          originSlotNumber: metadata?.originSlotNumber,
          sessionLabel: session?.label,
          startDate: session?.startDate,
          endDate: session?.endDate,
          unavailableSlots: session && !studentKey.startsWith('name:')
            ? resolveEffectiveUnavailableSlots(session.studentInputs[studentKey])
            : [],
        },
      })
      scopedItems.set(scopeKey, currentItems)
    }
  }

  return new Map(Array.from(scopedItems.entries()).map(([entryKey, items]) => {
    const [firstItem] = items
    return [
      entryKey,
      {
        studentKey: firstItem?.studentKey ?? entryKey.split('__')[0] ?? entryKey,
        studentId: firstItem?.studentId ?? null,
        displayName: firstItem?.displayName ?? entryKey.split('__')[0]?.replace(/^name:/, '') ?? entryKey,
        sessionId: firstItem?.item.sessionId,
        sessionLabel: firstItem?.item.sessionLabel,
        pendingItems: items.map(({ item }) => ({ ...item })),
      },
    ]
  }))
}