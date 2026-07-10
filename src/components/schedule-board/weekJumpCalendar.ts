// 盤面ツールバー「表示週を選択」の自作カレンダー用の純ロジック。
//
// なぜ自作か（経緯）:
//   ネイティブ日付ピッカー(<input type="date">)は「月送り」と「日選択」をどちらも
//   同じ change イベントで通知し、端末によっては blur も来ないため、コード側から
//   「月を送っただけ」と「日を選んで確定した」を確実に区別できなかった
//   (v1.5.427/428 の試行錯誤)。オーナー確定(2026-07-10)で自作カレンダーへ差し替え。
//   月送りは表示だけ変える(週は変えない)、日付タップで初めて確定、という挙動を
//   全端末で決定的に再現する。ここには表示に必要な純計算のみを置き、単体テストで守る。

export interface CalendarDay {
  /** YYYY-MM-DD */
  dateKey: string
  /** 日(1-31) */
  day: number
  /** 表示中の月に属するか(前後月のグレー表示判定用) */
  inMonth: boolean
}

export interface CalendarMonth {
  year: number
  /** 1-12 */
  month: number
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0')
}

function toKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** dateKey(YYYY-MM-DD) を年月に分解。表示月の初期化に使う。 */
export function monthOfDateKey(dateKey: string): CalendarMonth {
  const [year, month] = dateKey.split('-').map(Number)
  return { year, month }
}

/** 表示月を delta か月ずらす。日付は保持しない(1日基準・週は変えない)。 */
export function shiftMonth({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const base = new Date(year, month - 1 + delta, 1)
  return { year: base.getFullYear(), month: base.getMonth() + 1 }
}

/** 「YYYY年M月」表記。 */
export function formatMonthLabel({ year, month }: CalendarMonth): string {
  return `${year}年${month}月`
}

/**
 * 月曜始まりの 6 週 × 7 日 = 42 セルの行列を返す(getWeekStart が月曜始まりのため揃える)。
 * 前後の月の日は inMonth=false で埋める。行数を常に 6 に固定しレイアウトを安定させる。
 */
export function buildMonthMatrix({ year, month }: CalendarMonth): CalendarDay[][] {
  const first = new Date(year, month - 1, 1)
  // getDay(): 0=日..6=土。月曜始まりのオフセット(月=0..日=6)。
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(year, month - 1, 1 - mondayOffset)
  const weeks: CalendarDay[][] = []
  for (let w = 0; w < 6; w += 1) {
    const row: CalendarDay[] = []
    for (let d = 0; d < 7; d += 1) {
      const cell = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)
      row.push({
        dateKey: toKey(cell),
        day: cell.getDate(),
        inMonth: cell.getMonth() === month - 1,
      })
    }
    weeks.push(row)
  }
  return weeks
}

/** dateKey が weekStartKey から始まる 1 週間(7日)に含まれるか(選択週のハイライト用)。 */
export function isWithinWeek(dateKey: string, weekStartKey: string): boolean {
  if (!weekStartKey) return false
  const start = new Date(`${weekStartKey}T00:00:00`)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  const target = new Date(`${dateKey}T00:00:00`)
  return target >= start && target <= end
}

/** ローカル時刻での今日の dateKey。 */
export function todayDateKey(now: Date = new Date()): string {
  return toKey(now)
}
