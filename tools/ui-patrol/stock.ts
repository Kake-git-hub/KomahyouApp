// 画面の自動巡回(tools/ui-patrol.mjs・台本 e「出欠」)の在庫の数え方。操作の前後の教室データから、未消化振替と未消化講習の残を読む。
// ★数え方はアプリの権威関数をそのまま使う(道具の側に別の数え方を作らない・INV-06):
//   未消化振替 = buildMakeupStockEntries(盤面画面の rawMakeupStockEntries と同じ入力。入力の作り方は保証台帳の洗い出しと共有＝
//   tools/invAuditEntry.ts の collectSnapshotMakeupStockEntries)・未消化講習 = buildLectureStockEntries → buildLecturePendingItemsByEntryKey
//   (盤面画面の lecturePendingItemsByEntryKey と同じ)。
// ★純関数。入力を書き換えない。ネットワークにもファイルにも触れない。
import { buildLecturePendingItemsByEntryKey, buildLectureStockEntries } from '../../src/components/schedule-board/lectureStock'
import type { SpecialSessionRow } from '../../src/components/special-data/specialSessionModel'
import type { StudentRow } from '../../src/components/basic-data/basicDataModel'
import type { AppSnapshotPayload, LectureStockCountMap, ManualLectureStockOrigin } from '../../src/types/appState'
import { collectSnapshotMakeupStockEntries } from '../invAuditEntry'

/** 未消化振替の 1 行(画面の「未消化振替」の行と同じ中身のうち、点検と振替元の選び方に使うものだけ)。 */
export type MakeupStockRow = {
  /** `${生徒キー}__${科目}`(buildMakeupStockKey)。 */
  key: string
  balance: number
  remainingOriginDates: string[]
  remainingOriginSlots: Array<number | null>
  remainingOriginLabels: string[]
}

/**
 * 未消化講習の 1 行(画面の「未消化講習」の行＝生徒×講習。鍵は buildLectureStockScopeKey の 生徒キー__講習 ID〔講習に結べない手動追加は 生徒キー__-〕)。
 * 台本 h(講習の自動割振)が、押す行と割振の期間を選ぶのに使う。items は残っている 1 コマずつ(科目・期間・その生徒の出席不可のコマ)。
 * periodStart / periodEnd は items の期間の最小・最大(期間の無い item が 1 つでもあれば空＝期間を決められない)。
 */
export type LectureStockRow = {
  key: string
  studentKey: string
  studentId: string | null
  sessionId: string
  count: number
  periodStart: string
  periodEnd: string
  items: Array<{ subject: string; startDate: string; endDate: string; unavailableSlots: string[] }>
}

/** makeup: 未消化振替の残(鍵＝生徒キー__科目)。lecture: 未消化講習の残(鍵＝講習の在庫の行の鍵・残 0 の行は入らない)。 */
export type StockBalances = { makeup: Record<string, number>; lecture: Record<string, number>; makeupRows: MakeupStockRow[]; lectureRows: LectureStockRow[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function collectStockBalances(payload: AppSnapshotPayload, today: string): StockBalances {
  const makeup: Record<string, number> = {}
  const makeupRows: MakeupStockRow[] = []
  for (const entry of collectSnapshotMakeupStockEntries(payload, today)) {
    makeup[entry.key] = (makeup[entry.key] ?? 0) + entry.balance
    makeupRows.push({
      key: entry.key,
      balance: entry.balance,
      remainingOriginDates: [...entry.remainingOriginDates],
      remainingOriginSlots: [...entry.remainingOriginSlots],
      remainingOriginLabels: [...entry.remainingOriginLabels],
    })
  }
  const safe = (isPlainObject(payload) ? payload : {}) as Partial<AppSnapshotPayload>
  const boardState = (isPlainObject(safe.boardState) ? safe.boardState : {}) as Record<string, unknown>
  const specialSessions = asArray<SpecialSessionRow>(safe.specialSessions)
  const pending = buildLecturePendingItemsByEntryKey({
    rawLectureStockEntries: buildLectureStockEntries({ specialSessions, students: asArray<StudentRow>(safe.students) }),
    specialSessions,
    manualLectureStockCounts: (isPlainObject(boardState.manualLectureStockCounts) ? boardState.manualLectureStockCounts : {}) as LectureStockCountMap,
    manualLectureStockOrigins: (isPlainObject(boardState.manualLectureStockOrigins) ? boardState.manualLectureStockOrigins : {}) as Record<string, ManualLectureStockOrigin[]>,
    fallbackLectureStockStudents: (isPlainObject(boardState.fallbackLectureStockStudents) ? boardState.fallbackLectureStockStudents : {}) as Record<string, { displayName: string }>,
  })
  const lecture: Record<string, number> = {}
  const lectureRows: LectureStockRow[] = []
  for (const [entryKey, scoped] of pending) {
    if (scoped.pendingItems.length === 0) continue
    lecture[entryKey] = scoped.pendingItems.length
    const items = scoped.pendingItems.map((item) => ({ subject: item.subject, startDate: item.startDate ?? '', endDate: item.endDate ?? '', unavailableSlots: [...(item.unavailableSlots ?? [])] }))
    const dated = items.every((item) => item.startDate !== '' && item.endDate !== '')
    lectureRows.push({
      key: entryKey,
      studentKey: scoped.studentKey,
      studentId: scoped.studentId,
      sessionId: scoped.sessionId ?? '',
      count: items.length,
      periodStart: dated ? items.map((item) => item.startDate).sort()[0] : '',
      periodEnd: dated ? items.map((item) => item.endDate).sort().at(-1)! : '',
      items,
    })
  }
  return { makeup, lecture, makeupRows, lectureRows }
}

/**
 * 振替元(日付×時限)の画面の文字(未消化振替の一覧の「元の授業」の文字・remainingOriginLabels)。台本が「選んで置く」振替元を画面の行から探すのに使う。
 * 時限が一致する行を先に、無ければ同じ日付の行。見つからなければ ''。
 */
export function findMakeupOriginLabel(balances: StockBalances, stockKey: string, dateKey: string, slotNumber: number): string {
  const row = balances.makeupRows.find((item) => item.key === stockKey)
  if (!row) return ''
  const exact = row.remainingOriginDates.findIndex((date, index) => date === dateKey && row.remainingOriginSlots[index] === slotNumber)
  const index = exact >= 0 ? exact : row.remainingOriginDates.findIndex((date) => date === dateKey)
  return index >= 0 ? (row.remainingOriginLabels[index] ?? '') : ''
}

/** 振替の借りを確かめる仮の振替元の日付(どの授業・振替の日付とも重ならない昔の日。対応の取れない使用は古い振替元から消すので、借りがあればこれが消える)。 */
const MAKEUP_DEBT_PROBE_DATE = '1999-01-01'

/**
 * 振替元を 1 つ足したときの残の増え方(鍵＝生徒キー__科目 → 増えた数)。仮の振替元を keys の全部に 1 つずつ足して、アプリの数え方(collectStockBalances)で
 * 残の差を取る(数え方を 2 つ作らない)。ふつうは 1。置いた振替が振替元より多い(前から置きすぎ＝振替の借り)鍵は、足した振替元が借りの返済に消えて 0。
 * 休日設定の在庫の点検は、この増え方を期待値にする(借りの鍵で残が増えたら二重計上を拾える・手直し 1 Minor-2)。入力は書き換えない。
 */
export function collectMakeupOriginGains(payload: AppSnapshotPayload, today: string, keys: Iterable<string>): Record<string, number> {
  const wanted = [...new Set(keys)]
  if (wanted.length === 0) return {}
  const probed = structuredClone(payload) as AppSnapshotPayload & { boardState: Record<string, unknown> }
  const boardState = (isPlainObject(probed.boardState) ? probed.boardState : {}) as Record<string, unknown>
  const ledger = (isPlainObject(boardState.manualMakeupAdjustments) ? boardState.manualMakeupAdjustments : {}) as Record<string, unknown>
  for (const key of wanted) ledger[key] = [...asArray<unknown>(ledger[key]), { dateKey: MAKEUP_DEBT_PROBE_DATE }]
  boardState.manualMakeupAdjustments = ledger
  probed.boardState = boardState as typeof probed.boardState
  const before = collectStockBalances(payload, today).makeup
  const after = collectStockBalances(probed, today).makeup
  return Object.fromEntries(wanted.map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]))
}
