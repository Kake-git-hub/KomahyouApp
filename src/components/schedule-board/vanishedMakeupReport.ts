import type { ClassroomSettings } from '../../types/appState'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { buildMakeupStockEntries, collectMakeupOriginDatesByKey, type ManualMakeupOrigin } from './makeupStock'

// ============================================================================
// INV-06 の修正（2026-07-31・移動しただけの振替コマを休みにすると未消化振替から消滅する）で
// **未消化振替がどれだけ増えるか**を、修正前後の残数を突き合わせて洗い出すための読み取り専用レポート。
//
// 用途: 本番教室へ配信する前に「どの生徒のどのコマが戻ってくるか」を教室へ説明できる形で出す。
// 入力は書き出し済みバックアップ JSON（AppSnapshot）だけ。Firestore へは一切触れない（読み書きしない）。
//
// 修正前の挙動の再現方法（重要・回帰防止）:
//   makeupStock.ts で status==='absent' の statusSlots を読むのは collectAbsentMakeupOrigins だけで、
//   countPlannedMakeupsByKey / collectMakeupUsageByKey は absent を必ず `continue` で除外する。
//   よって「absent かつ makeup の statusSlot から makeupSourceDate を落とす」と、この修正以外の会計は
//   一切動かさずに修正前と同じ残数になる。差分＝今回の修正で戻るコマ、と言い切れるのはこの性質による。
//   （makeupStock.ts 側で absent を他の集計にも数えるよう変えたら、この前提は崩れるので合わせて見直すこと）
// ============================================================================

export type VanishedMakeupCandidate = {
  /** 未消化振替の集計キー（`<生徒キー>__<科目>`） */
  key: string
  studentName: string
  subject: string
  /** 「休み」にした日（振替先の日） */
  absentDateKey: string
  absentSlotNumber: number | null
  /** 未消化振替へ戻るべき元コマの日 */
  makeupSourceDate: string
  makeupSourceLabel: string | null
}

export type VanishedMakeupRow = VanishedMakeupCandidate & {
  /** この修正で未消化振替が +1 されるコマか */
  willIncrease: boolean
  reason: string
}

export type VanishedMakeupStudentTotal = {
  key: string
  studentName: string
  subject: string
  balanceBefore: number
  balanceAfter: number
  increase: number
}

export type VanishedMakeupReport = {
  rows: VanishedMakeupRow[]
  totals: VanishedMakeupStudentTotal[]
  /** 増える未消化振替の合計コマ数 */
  increasedTotal: number
}

export type VanishedMakeupReportParams = {
  students: StudentRow[]
  teachers: TeacherRow[]
  regularLessons: RegularLessonRow[]
  classroomSettings: ClassroomSettings
  weeks: SlotCell[][]
  manualAdjustments: Record<string, ManualMakeupOrigin[]>
  suppressedOrigins?: Record<string, ManualMakeupOrigin[]>
  fallbackStudents?: Record<string, { studentName: string; displayName: string; subject: string }>
  resolveStudentKey: (student: StudentEntry) => string
  today?: Date
}

export const VANISHED_MAKEUP_REASONS = {
  increase: '今回の修正で未消化振替に戻る（移動しただけの振替コマ＝台帳に元コマが無かった）',
  ledger: '修正前から正しく戻っていた（在庫由来＝台帳に元コマがある）',
  suppressed: '元コマが削除（個別抑制）済みなので復活しない',
  consumed: '同じ元コマの振替が別に配置済み／既に消化されているため残数には出ない',
} as const

function stripAbsentMakeupOrigin(statusEntry: StudentStatusEntry | null) {
  if (!statusEntry) return statusEntry
  if (statusEntry.status !== 'absent' || statusEntry.lessonType !== 'makeup' || !statusEntry.makeupSourceDate) return statusEntry
  return { ...statusEntry, makeupSourceDate: undefined }
}

function stripAbsentMakeupOrigins(weeks: SlotCell[][]): SlotCell[][] {
  return weeks.map((week) => week.map((cell) => ({
    ...cell,
    desks: cell.desks.map((desk) => (
      desk.statusSlots
        ? {
          ...desk,
          // statusSlots は 2 席固定のタプル。要素数を保ったまま差し替える。
          statusSlots: [stripAbsentMakeupOrigin(desk.statusSlots[0]), stripAbsentMakeupOrigin(desk.statusSlots[1])] as DeskCell['statusSlots'],
        }
        : desk
    )),
  })))
}

/** 盤面から「休みにされた振替コマ」＝今回の修正で復元対象になりうるコマを拾う（判定はしない）。 */
export function collectAbsentMakeupCandidates(
  weeks: SlotCell[][],
  resolveStudentKey: (student: StudentEntry) => string,
): VanishedMakeupCandidate[] {
  const candidates: VanishedMakeupCandidate[] = []

  for (const week of weeks) {
    for (const cell of week) {
      if (!cell.isOpenDay) continue
      for (const desk of cell.desks) {
        for (const statusEntry of desk.statusSlots ?? []) {
          if (!statusEntry || statusEntry.manualAdded) continue
          if (statusEntry.status !== 'absent') continue
          if (statusEntry.lessonType !== 'makeup' || !statusEntry.makeupSourceDate) continue
          const studentLike = { ...statusEntry, id: statusEntry.studentId } as unknown as StudentEntry
          candidates.push({
            key: `${resolveStudentKey(studentLike)}__${statusEntry.subject}`,
            studentName: statusEntry.name,
            subject: statusEntry.subject,
            absentDateKey: statusEntry.dateKey ?? cell.dateKey,
            absentSlotNumber: statusEntry.slotNumber ?? cell.slotNumber ?? null,
            makeupSourceDate: statusEntry.makeupSourceDate,
            makeupSourceLabel: statusEntry.makeupSourceLabel ?? null,
          })
        }
      }
    }
  }

  return candidates
}

/**
 * 修正前後の未消化振替残数を同じデータで突き合わせ、増えるコマを一覧化する。
 * 生徒・科目ごとの増分（totals）が正で、行の willIncrease はその増分に合わせて割り付ける
 * （残数は日付単位で重複排除されるため、同じ元コマの欠席が2コマあっても +1 にしかならない）。
 */
export function buildVanishedMakeupReport(params: VanishedMakeupReportParams): VanishedMakeupReport {
  const strippedWeeks = stripAbsentMakeupOrigins(params.weeks)
  const stockParams = {
    students: params.students,
    teachers: params.teachers,
    regularLessons: params.regularLessons,
    classroomSettings: params.classroomSettings,
    manualAdjustments: params.manualAdjustments,
    suppressedOrigins: params.suppressedOrigins,
    fallbackStudents: params.fallbackStudents,
    resolveStudentKey: params.resolveStudentKey,
    today: params.today,
  }

  const afterEntries = buildMakeupStockEntries({ ...stockParams, weeks: params.weeks })
  const beforeEntries = buildMakeupStockEntries({ ...stockParams, weeks: strippedWeeks })
  const afterBalances = new Map(afterEntries.map((entry) => [entry.key, entry.balance]))
  const beforeBalances = new Map(beforeEntries.map((entry) => [entry.key, entry.balance]))
  const displayNameByKey = new Map([...beforeEntries, ...afterEntries].map((entry) => [entry.key, entry.studentName]))

  // 台帳（自動休校日 / 同時間帯重複 / 手動調整）だけの有効 origin。absent 由来を外した盤面で求める。
  const ledgerOriginDates = collectMakeupOriginDatesByKey({
    students: params.students,
    regularLessons: params.regularLessons,
    classroomSettings: params.classroomSettings,
    weeks: strippedWeeks,
    manualAdjustments: params.manualAdjustments,
    suppressedOrigins: params.suppressedOrigins,
    resolveStudentKey: params.resolveStudentKey,
    today: params.today,
  })
  // absent 由来を含めた有効 origin。ここに載らない＝個別抑制（削除）済み。
  const effectiveOriginDates = collectMakeupOriginDatesByKey({
    students: params.students,
    regularLessons: params.regularLessons,
    classroomSettings: params.classroomSettings,
    weeks: params.weeks,
    manualAdjustments: params.manualAdjustments,
    suppressedOrigins: params.suppressedOrigins,
    resolveStudentKey: params.resolveStudentKey,
    today: params.today,
  })

  const candidates = collectAbsentMakeupCandidates(params.weeks, params.resolveStudentKey)
  const remainingIncreaseByKey = new Map<string, number>()
  for (const candidate of candidates) {
    if (remainingIncreaseByKey.has(candidate.key)) continue
    const increase = (afterBalances.get(candidate.key) ?? 0) - (beforeBalances.get(candidate.key) ?? 0)
    remainingIncreaseByKey.set(candidate.key, Math.max(0, increase))
  }

  const rows = [...candidates]
    .sort((left, right) => (
      left.studentName.localeCompare(right.studentName, 'ja')
      || left.subject.localeCompare(right.subject, 'ja')
      || left.makeupSourceDate.localeCompare(right.makeupSourceDate)
      || left.absentDateKey.localeCompare(right.absentDateKey)
    ))
    .map<VanishedMakeupRow>((candidate) => {
      if (!(effectiveOriginDates[candidate.key] ?? []).includes(candidate.makeupSourceDate)) {
        return { ...candidate, willIncrease: false, reason: VANISHED_MAKEUP_REASONS.suppressed }
      }
      if ((ledgerOriginDates[candidate.key] ?? []).includes(candidate.makeupSourceDate)) {
        return { ...candidate, willIncrease: false, reason: VANISHED_MAKEUP_REASONS.ledger }
      }
      const remaining = remainingIncreaseByKey.get(candidate.key) ?? 0
      if (remaining <= 0) {
        return { ...candidate, willIncrease: false, reason: VANISHED_MAKEUP_REASONS.consumed }
      }
      remainingIncreaseByKey.set(candidate.key, remaining - 1)
      return { ...candidate, willIncrease: true, reason: VANISHED_MAKEUP_REASONS.increase }
    })

  const totals = Array.from(new Set(candidates.map((candidate) => candidate.key)))
    .map<VanishedMakeupStudentTotal>((key) => {
      const balanceBefore = beforeBalances.get(key) ?? 0
      const balanceAfter = afterBalances.get(key) ?? 0
      const sample = candidates.find((candidate) => candidate.key === key)
      return {
        key,
        studentName: displayNameByKey.get(key) ?? sample?.studentName ?? key,
        subject: sample?.subject ?? '',
        balanceBefore,
        balanceAfter,
        increase: Math.max(0, balanceAfter - balanceBefore),
      }
    })
    .filter((total) => total.increase > 0)
    .sort((left, right) => (
      right.increase - left.increase
      || left.studentName.localeCompare(right.studentName, 'ja')
      || left.subject.localeCompare(right.subject, 'ja')
    ))

  return {
    rows,
    totals,
    increasedTotal: totals.reduce((sum, total) => sum + total.increase, 0),
  }
}
