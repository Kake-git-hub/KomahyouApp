// 画面の自動巡回(tools/ui-patrol.mjs)の台本 g「休日設定と解除・丸ごと振替〔作成と解除〕」(2026-11-11 第 2 段の 4 本目)の日付の選び方と、
// 休日設定の在庫の仕様の増減。tools/ui-patrol/loadApp.mjs が esbuild で束ねた app から呼ぶ(entry.ts)。
// ★日付の規則はアプリの権威関数を使う(丸ごと振替の組＝wholeDayTransferPair.ts の parseWholeDayTransferPairs)。ここで規則を書き直さない。
//   アプリが断る条件(同じ曜日・反映日・出欠記録・保留・手入力の重なり・机の数など・ScheduleBoardScreen.tsx の computeWholeDayTransferPair)の
//   うち、盤面の事実で分かるものは先に外す(断られたら台本はアプリの文を info に残し、次の候補を試す)。
//   盤面の事実だけでは分からない断り(振替先の同じ時限の別の机に、振替元の手置きの講師と同じ講師が居る＝作ると同じ講師が 2 机・Issue #87・
//   2026-11-12 オーナー決定「作る前に止める」)は、ここで講師の照合を作らずにアプリに断らせ、振替先も振替元も次の候補へ進む(otherSources)。
// ★純関数。入力を書き換えない。ネットワークにもファイルにも触れない。
import { parseWholeDayTransferPairs } from '../../src/components/schedule-board/wholeDayTransferPair'
import type { AppSnapshotPayload } from '../../src/types/appState'
import type { BoardFacts, DeskFact } from './boardFacts'

export type HolidayPlan = { dateKey: string; studentCount: number }
export type WholeDayTransferCandidate = { sourceDateKey: string; targetDateKeys: string[]; studentCount: number }
/** 先頭の振替元と、その振替先が全部断られたときに試す次の振替元(otherSources・Issue #87)。 */
export type WholeDayTransferPlan = WholeDayTransferCandidate & { otherSources: WholeDayTransferCandidate[] }
export type DayOpsPlan = { holiday: HolidayPlan | null; transfer: WholeDayTransferPlan | null; skipped: string[] }

/** 振替先の候補の数の上限(近い順)。アプリに断られたら次を試す。 */
const TRANSFER_TARGET_LIMIT = 3
/** 振替元の候補の数の上限(選んだ 1 つ＋次の候補。日付の順)。振替先が全部断られたら次の振替元を試す(Issue #87)。 */
const TRANSFER_SOURCE_LIMIT = 3

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay()
}

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86400000)
}

type DateInfo = {
  dateKey: string
  desks: DeskFact[]
  /** 時限 → 机の数。 */
  deskCountBySlot: Map<number, number>
  studentCount: number
  /** 開いている日で、出欠記録・保留・講師の休み・丸ごと振替の組が無い(台本の操作が前からある記録と混ざらない)。 */
  clean: boolean
  /** `${時限}#${机番号}` → 机。 */
  deskBySlot: Map<string, DeskFact>
}

function describeDates(facts: BoardFacts, payload: AppSnapshotPayload, dateKeys: readonly string[], todayKey: string): DateInfo[] {
  const settings = (isPlainObject(payload?.classroomSettings) ? payload.classroomSettings : {}) as Record<string, unknown>
  const boardState = (isPlainObject(payload?.boardState) ? payload.boardState : {}) as Record<string, unknown>
  const holidayDates = new Set(stringList(settings.holidayDates))
  // 定休日を開けた日(forceOpenDates)は日付を押すと定休日へ戻す(メニューが出ない・handleDayHeaderClick)ので選ばない。
  const forceOpenDates = new Set(stringList(settings.forceOpenDates))
  // 抑止キーのある日(生徒の授業を別の日へ動かした・消した日)は選ぶ。本番 2 校では平日のほとんどにあり(2026-11-11 実測)、外すと土曜しか残らない。
  const suppressed = stringList(boardState.suppressedRegularLessonOccurrences)
  const pairDates = new Set(parseWholeDayTransferPairs(suppressed).flatMap((pair) => [pair.sourceDateKey, pair.targetDateKey]))
  const byDate = new Map<string, DeskFact[]>()
  for (const desk of facts.desks.values()) {
    const list = byDate.get(desk.dateKey) ?? []
    list.push(desk)
    byDate.set(desk.dateKey, list)
  }
  const infos: DateInfo[] = []
  for (const dateKey of [...new Set(dateKeys)].sort()) {
    const desks = byDate.get(dateKey) ?? []
    if (dateKey <= todayKey || desks.length === 0) continue
    const deskCountBySlot = new Map<number, number>()
    for (const desk of desks) deskCountBySlot.set(desk.slotNumber, (deskCountBySlot.get(desk.slotNumber) ?? 0) + 1)
    const open = desks.every((desk) => desk.cellOpen) && !holidayDates.has(dateKey) && !forceOpenDates.has(dateKey)
    const recorded = desks.some((desk) => desk.statuses.length > 0 || desk.pendingStatuses.length > 0 || desk.pendingRecorded || desk.teacherRest
      || desk.pendingStudents.length > 0 || desk.pendingTeacher !== '' || desk.pendingMemos.length > 0)
    infos.push({
      dateKey,
      desks,
      deskCountBySlot,
      studentCount: desks.reduce((sum, desk) => sum + desk.students.filter(Boolean).length, 0),
      clean: open && !recorded && !pairDates.has(dateKey),
      deskBySlot: new Map(desks.map((desk) => [`${desk.slotNumber}#${desk.deskIndex}`, desk])),
    })
  }
  return infos
}

/**
 * 振替先 D' の手入力が、振替元 D の授業と同じ席・同じ机に重ならないか。重なると、アプリが断る(手入力どうし)か D' の机が保留(2 行)になり、
 * 「振替先に振替元と同じ形で乗る」を確かめられない。重ならない D' の手入力は残る(§9-20「D' で置いた手入力は残す」)ので構わない。
 * 席: D の席に生徒が居て D' の同じ席に手入力の生徒。机: D の机にメモがあり D' の机にもメモ／D の机に生徒か講師が居て D' の机の講師が手入力。
 */
function isTargetCompatible(source: DateInfo, target: DateInfo): boolean {
  for (const [slotDesk, from] of source.deskBySlot) {
    const to = target.deskBySlot.get(slotDesk)
    if (!to) continue
    if ([0, 1].some((seat) => from.students[seat] && to.students[seat]?.origin === 'manual')) return false
    if (from.memos.length > 0 && to.memos.length > 0) return false
    if (to.teacherOrigin === 'manual' && (from.teacher !== '' || from.students.some(Boolean))) return false
  }
  return true
}

/**
 * 台本 g の日付を選ぶ(random は種つきの乱数・0 以上 1 未満)。dateKeys は開いた週の日付(今日より後だけ使う)。
 * - 丸ごと振替: 振替元 D＝授業のある、前からの記録の無い日(テンプレの反映日〔templateFreezeBeforeDate〕以降)。振替先＝D と同じ曜日の別の日で、
 *   前からの記録が無く、D の授業と重なる手入力が無く(isTargetCompatible)、D の時限がそろい机の数が足りる日(近い順に 3 つまで)。振替先のある D から選ぶ。
 *   振替先が全部アプリに断られたときのため、ほかの振替元を日付の順に 2 つまで otherSources に入れる(Issue #87: 振替元の手置きの講師が振替先の
 *   同じ時限の別の机にも居ると、アプリは作る前に止める。毎週同じ講師を手で置いている形では同じ振替元の振替先が全部断られる)。
 * - 休日設定: D と別の、授業のある前からの記録の無い日。D の振替先の候補でない日を先に選び、無ければ候補の日も使う
 *   (休日は丸ごと振替の前に解除して元の形へ戻すので、同じ日でも混ざらない)。
 * 候補の無い操作は null にし、skipped に理由。
 */
export function pickDayOpsPlan(params: { facts: BoardFacts; payload: AppSnapshotPayload; dateKeys: readonly string[]; todayKey: string; random: () => number }): DayOpsPlan {
  const { facts, payload, dateKeys, todayKey, random } = params
  const settings = (isPlainObject(payload?.classroomSettings) ? payload.classroomSettings : {}) as Record<string, unknown>
  const freezeDate = typeof settings.templateFreezeBeforeDate === 'string' ? settings.templateFreezeBeforeDate : ''
  const infos = describeDates(facts, payload, dateKeys, todayKey)
  const pickOne = <T>(list: T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]
  const skipped: string[] = []
  const usable = infos.filter((info) => info.clean && info.studentCount > 0)
  const targetsOf = (source: DateInfo) => infos
    .filter((target) => target.dateKey !== source.dateKey && weekdayOf(target.dateKey) === weekdayOf(source.dateKey) && target.clean && isTargetCompatible(source, target)
      && (!freezeDate || target.dateKey >= freezeDate)
      && [...source.deskCountBySlot.entries()].every(([slot, count]) => (target.deskCountBySlot.get(slot) ?? 0) >= count))
    .sort((left, right) => Math.abs(daysBetween(source.dateKey, left.dateKey)) - Math.abs(daysBetween(source.dateKey, right.dateKey)) || left.dateKey.localeCompare(right.dateKey))
    .slice(0, TRANSFER_TARGET_LIMIT)
  const sources = usable
    .filter((info) => !freezeDate || info.dateKey >= freezeDate)
    .map((info) => ({ info, targets: targetsOf(info) }))
    .filter((entry) => entry.targets.length > 0)
  let transfer: WholeDayTransferPlan | null = null
  if (sources.length > 0) {
    const picked = pickOne(sources)
    const toCandidate = ({ info, targets }: (typeof sources)[number]): WholeDayTransferCandidate => ({ sourceDateKey: info.dateKey, targetDateKeys: targets.map((target) => target.dateKey), studentCount: info.studentCount })
    const otherSources = sources.filter((entry) => entry !== picked).slice(0, TRANSFER_SOURCE_LIMIT - 1).map(toCandidate)
    transfer = { ...toCandidate(picked), otherSources }
  } else if (freezeDate && usable.length > 0 && usable.every((info) => info.dateKey < freezeDate)) {
    // 例: 日大前校の形(2026-11-11)は先の反映日 2027-02-01 のテンプレが保存済みで、開いた 4 週はすべて反映日より前(computeWholeDayTransferPair が断る)。
    skipped.push(`丸ごと振替: 開いた週の日はすべてテンプレの反映日(${freezeDate})より前で、アプリの決まりで丸ごと振替できない`)
  } else {
    skipped.push('丸ごと振替: 授業のある日と、同じ曜日で記録が無く振替元の授業と重なる手入力も無く机の数が足りる別の日の組が無い(開いた週の中・今日より後)')
  }
  const holidayPool = usable.filter((info) => info.dateKey !== transfer?.sourceDateKey)
  const preferred = holidayPool.filter((info) => !transfer?.targetDateKeys.includes(info.dateKey))
  const holidayInfo = preferred.length > 0 ? pickOne(preferred) : holidayPool.length > 0 ? pickOne(holidayPool) : null
  const holiday = holidayInfo ? { dateKey: holidayInfo.dateKey, studentCount: holidayInfo.studentCount } : null
  if (!holiday) skipped.push('休日設定: 授業があり、出欠記録・保留・講師の休み・丸ごと振替の組の無い日が無い(開いた週の中・今日より後)')
  return { holiday, transfer, skipped }
}

/**
 * 休日設定の在庫の仕様の増減(INV-06・spec-makeup-stock §B-2-2b「休日設定では授業はすべてストックへ」)。数え方(残)はアプリの権威関数
 * (stock.ts の collectStockBalances)で、ここは「その日の席の生徒 1 人につき 1 コマ戻る」という仕様の数だけを決める。
 * - 通常(regular)・振替(makeup)の生徒: 未消化振替 +1(鍵 生徒キー__科目＝buildMakeupStockKey)。
 * - 比べない(ignore): 講習(講習の在庫は講習の期間で戻り方が変わる・shouldReturnLectureStockOnAbsence → 講習の鍵の頭 生徒キー__)・
 *   体験(戻さない・0 のまま)以外の種類・名簿に結べない生徒・数え方が別の席(ineligibleSeatKeys＝手動追加・編集で振替にした・
 *   scenarios.mjs の collectStockIneligibleSeatKeys)・同じ日に同じ生徒×科目が 2 つ以上(時限なしの振替元は同じ日で畳まれうる)。
 * 体験の生徒の鍵は比べる(0 のまま)。
 */
export function expectedHolidayStockDeltas(facts: BoardFacts, dateKey: string, ineligibleSeatKeys: ReadonlySet<string>) {
  const counts = new Map<string, number>()
  const ignore = new Set<string>()
  const lecturePrefixes: string[] = []
  for (const desk of facts.desks.values()) {
    if (desk.dateKey !== dateKey) continue
    desk.students.forEach((entry, seat) => {
      if (!entry) return
      const key = `${entry.key}__${entry.subject}`
      if (entry.lessonType === 'special') {
        if (!lecturePrefixes.includes(`${entry.key}__`)) lecturePrefixes.push(`${entry.key}__`)
        return
      }
      if (entry.lessonType === 'trial') return
      if (!['regular', 'makeup'].includes(entry.lessonType) || entry.key.startsWith('name:') || ineligibleSeatKeys.has(`${desk.key}/${seat}`)) {
        ignore.add(key)
        return
      }
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
  }
  const makeup: Record<string, number> = {}
  for (const [key, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (count > 1) ignore.add(key)
    else if (!ignore.has(key)) makeup[key] = 1
  }
  return { expected: { makeup, lecture: {} as Record<string, number> }, ignore: { makeup: ignore, lecturePrefixes }, checkedCount: Object.keys(makeup).length }
}

/** 前と後のどちらかの事実にある、その日(dateKeys)の机の鍵(`${cellId}#${deskIndex}`)。日付の操作で変わってよい机。 */
export function collectDateDeskKeys(factsList: readonly BoardFacts[], dateKeys: readonly string[]): Set<string> {
  const dates = new Set(dateKeys)
  const keys = new Set<string>()
  for (const facts of factsList) for (const desk of facts.desks.values()) if (dates.has(desk.dateKey)) keys.add(desk.key)
  return keys
}
