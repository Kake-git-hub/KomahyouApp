// 集団授業（特別講習・中3向け）の盤面データモデルと純粋ヘルパ。
// 既存の個別授業（DeskLesson）とは独立した経路。仕様は docs/spec-group-lesson.md 参照。
//
// 盤面では「特別講習を含む週」の1限の上に2バンド（10:00-11:00 / 11:10-12:10）の集団行を出す。
// 各（日 × バンド）セルに科目（集団理科 / 集団社会）と担当講師、出欠を保持する。

export type GroupClassSubject = '集団理科' | '集団社会'

export const groupClassSubjects: readonly GroupClassSubject[] = ['集団理科', '集団社会']

// 集団授業の時間帯バンド。1 = 10:00-11:00、2 = 11:10-12:10。
export type GroupClassBand = 1 | 2

export const groupClassBands: readonly GroupClassBand[] = [1, 2]

export const groupClassBandTimeLabels: Record<GroupClassBand, string> = {
  1: '10:00-11:00',
  2: '11:10-12:10',
}

// 盤面に置かれた集団授業1コマ（日 × バンド）。
export type GroupClassEntry = {
  dateKey: string
  band: GroupClassBand
  subject: GroupClassSubject
  teacherName?: string
  // 出欠は既定=出席。欠席にした生徒の studentId のみ保持する。
  absentStudentIds: string[]
  // 名簿（参加提出者）外で当日手動追加した中3の studentId。
  addedStudentIds: string[]
}

// key = `${dateKey}_${band}`（例: '2026-07-21_1'）。
export type GroupClassEntryMap = Record<string, GroupClassEntry>

export function groupClassEntryKey(dateKey: string, band: GroupClassBand): string {
  return `${dateKey}_${band}`
}

export function isGroupClassSubject(value: unknown): value is GroupClassSubject {
  return value === '集団理科' || value === '集団社会'
}

export function isGroupClassBand(value: unknown): value is GroupClassBand {
  return value === 1 || value === 2
}

function sanitizeStudentIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    result.push(entry)
  }
  return result
}

// 復元（JSON / スナップショット）時の防御的パース。
// 不正な値は捨て、未設定は空マップ。既存の個別授業データには触れない。
export function normalizeGroupClassEntryMap(value: unknown): GroupClassEntryMap {
  if (!value || typeof value !== 'object') return {}
  const result: GroupClassEntryMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.dateKey !== 'string' || !entry.dateKey) continue
    if (!isGroupClassBand(entry.band)) continue
    if (!isGroupClassSubject(entry.subject)) continue

    const normalized: GroupClassEntry = {
      dateKey: entry.dateKey,
      band: entry.band,
      subject: entry.subject,
      absentStudentIds: sanitizeStudentIdList(entry.absentStudentIds),
      addedStudentIds: sanitizeStudentIdList(entry.addedStudentIds),
    }
    if (typeof entry.teacherName === 'string' && entry.teacherName.trim()) {
      normalized.teacherName = entry.teacherName
    }
    result[key] = normalized
  }
  return result
}

// publish / 履歴用のディープコピー。参照共有による取り違えを防ぐ。
export function cloneGroupClassEntryMap(value: GroupClassEntryMap | null | undefined): GroupClassEntryMap {
  if (!value) return {}
  const result: GroupClassEntryMap = {}
  for (const [key, entry] of Object.entries(value)) {
    result[key] = {
      ...entry,
      absentStudentIds: [...entry.absentStudentIds],
      addedStudentIds: [...entry.addedStudentIds],
    }
  }
  return result
}
