import type { SlotCell, StudentEntry } from './types'

// 盤面の週(boardState.weeks)はナビゲーションのたびに蓄積し、巨大教室ではメモリを圧迫する。
// ただし週セルには「手動編集(手動配置・振替・移動・講習・メモ・出欠・手動講師)」が含まれ、
// これを失うと配布や日程表でデータ消失になる。そこで:
//   - 手動編集を持つ週は必ず保持
//   - 手動編集が無い週(=通常授業のみ。再生成で同一内容になる)は、表示範囲ウィンドウ外なら破棄
// する。suppressedRegularLessonOccurrences / scheduleCountAdjustments / manualMakeupAdjustments
// 等は boardState の別フィールド(週セル外)で保持・再適用されるため、週破棄の影響を受けない。

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

// 通常授業から自動生成されただけの生徒かどうか。非regular/手動追加/振替・移動・講習由来は「手動」。
function studentEntryIsManual(student: StudentEntry | null): boolean {
  if (!student) return false
  if (student.lessonType !== 'regular') return true
  if (student.manualAdded) return true
  if (student.makeupSourceDate || student.makeupSourceLabel) return true
  if (student.sameDayMoveSourceDate || student.sameDayMoveSourceLabel) return true
  if (student.specialSessionId || student.specialStockSource) return true
  return false
}

// 週に手動編集が含まれるか(=破棄してはいけない週か)を保守的に判定する。
// 少しでも手動の痕跡があれば true(保持)を返す。
export function weekHasManualBoardData(week: SlotCell[]): boolean {
  for (const cell of week) {
    for (const desk of cell.desks) {
      if (desk.manualTeacher) return true
      if (desk.teacherAssignmentSource) return true
      if (desk.memoSlots && desk.memoSlots.some((memo) => memo != null && memo.trim() !== '')) return true
      if (desk.statusSlots && desk.statusSlots.some((status) => status != null)) return true
      const lesson = desk.lesson
      if (lesson) {
        if (lesson.note && lesson.note.trim() !== '') return true
        if (lesson.studentSlots.some(studentEntryIsManual)) return true
      }
    }
  }
  return false
}

function weekDateRange(week: SlotCell[]): { min: string; max: string } | null {
  let min = ''
  let max = ''
  for (const cell of week) {
    if (!cell.dateKey) continue
    if (!min || cell.dateKey < min) min = cell.dateKey
    if (!max || cell.dateKey > max) max = cell.dateKey
  }
  return min && max ? { min, max } : null
}

export const BOARD_WEEK_TRIM_PAST_WEEKS = 6
export const BOARD_WEEK_TRIM_FUTURE_WEEKS = 26

export function trimBoardWeeksForMemory(
  weeks: SlotCell[][],
  options: { referenceDate?: Date; pastWeeks?: number; futureWeeks?: number } = {},
): SlotCell[][] {
  if (!Array.isArray(weeks) || weeks.length <= 1) return weeks
  const reference = options.referenceDate ?? new Date()
  const pastWeeks = options.pastWeeks ?? BOARD_WEEK_TRIM_PAST_WEEKS
  const futureWeeks = options.futureWeeks ?? BOARD_WEEK_TRIM_FUTURE_WEEKS

  const windowStart = new Date(reference)
  windowStart.setDate(windowStart.getDate() - pastWeeks * 7)
  const windowEnd = new Date(reference)
  windowEnd.setDate(windowEnd.getDate() + futureWeeks * 7)
  const windowStartKey = toDateKey(windowStart)
  const windowEndKey = toDateKey(windowEnd)

  const kept = weeks.filter((week) => {
    const range = weekDateRange(week)
    if (!range) return true // 日付不明の週は安全側で保持
    const overlapsWindow = range.max >= windowStartKey && range.min <= windowEndKey
    if (overlapsWindow) return true
    // ウィンドウ外でも手動編集を持つ週は必ず保持(データ消失防止)
    return weekHasManualBoardData(week)
  })

  // 全週が落ちる/変化なしの場合は元の配列を返す(無駄な再生成・空盤面を避ける)
  if (kept.length === 0 || kept.length === weeks.length) return weeks
  return kept
}
