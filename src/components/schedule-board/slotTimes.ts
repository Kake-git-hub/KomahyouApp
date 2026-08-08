// 盤面のコマ時間(1限〜5限)の唯一の定義。
// 盤面(ScheduleBoardScreen)・モックデータ・配布用共有画面がここを参照し、表記が分散しないようにする。
export const boardSlotTimes = [
  '13:00-14:30',
  '14:40-16:10',
  '16:20-17:50',
  '18:00-19:30',
  '19:40-21:10',
] as const

// slotNumber(1始まり)から時間帯ラベルを引く。範囲外は空文字(呼び出し側で「N限」等へフォールバック)。
export function getBoardSlotTimeLabel(slotNumber: number): string {
  if (!Number.isInteger(slotNumber)) return ''
  return boardSlotTimes[slotNumber - 1] ?? ''
}
