// ⚠️【一時機能・室長が1クリックしたら本ファイルごと撤去する】(2026-07-03)
// -----------------------------------------------------------------------------
// テンプレ凍結(templateFreezeBeforeDate)で在庫計算から漏れた「7/20(海の日)の休日振替」を、
// 対象4名だけ未消化振替として復帰させるための一時ボタン用ロジック。
//
// なぜ通常手段が効かないか:
//   makeup在庫(buildMakeupStockEntries)は現行 regularLessons(=凍結後テンプレ)だけで origin を計算する。
//   対象生徒の行は start=2026-08-31 のため、凍結前の 7/20 は autoShortage を生成しない(=0)。
//   さらに過去に未消化を一括削除した際、本物の 7/20 休日振替が suppressedMakeupOrigins に巻き込まれた。
//   ∴「抑制解除だけ」では +0(auto/manual に 7/20 が無いため)。両方(手動追加 + 抑制解除)が必須。
//   詳細: memory komahyou-handoff-restore-720 / komahyou-occupied-origin-and-suppressed-makeup。
//
// メカニズム(実データ検証済み・各キー balance +1・remain に 7/20・他生徒不変):
//   対象キー studentId__subject ごとに、両方を行う(片方だけは +0)。
//     1. manualMakeupAdjustments[key] に { dateKey: '2026-07-20' } を追加(冪等: 既にあれば追加しない)
//     2. suppressedMakeupOrigins[key] から 2026-07-20 を除去(空配列ならキー削除)
// -----------------------------------------------------------------------------
import type { ManualMakeupOrigin } from './makeupStock'

type MakeupOriginMap = Record<string, ManualMakeupOrigin[]>

export const RESTORE_720_ORIGIN_DATE = '2026-07-20'

// classroomId(actingClassroomId) → 対象キー(studentId__subject)。対象教室でのみボタンを表示する。
// 緑が丘: 白川 太伊千(数)・古賀 爽太(英) / 日大前: 劉 俊輔(数)・神 結芽乃(理)。薬円台は対象なし。
export const RESTORE_720_TARGET_KEYS_BY_CLASSROOM: Record<string, string[]> = {
  KzFnOQoTFLsCxwUp1tvh: ['s031__数', 's024__英'],
  '5w5OMueETerSKrSf14HC': ['s068__数', 's076__理'],
}

export function getRestore720TargetKeys(classroomStorageKey: string | undefined): string[] {
  if (!classroomStorageKey) return []
  return RESTORE_720_TARGET_KEYS_BY_CLASSROOM[classroomStorageKey] ?? []
}

function appendOriginDateIdempotent(map: MakeupOriginMap, key: string, dateKey: string): MakeupOriginMap {
  const current = map[key] ?? []
  if (current.some((origin) => origin.dateKey === dateKey)) return map // 冪等: 二重追加しない
  return {
    ...map,
    [key]: [...current, { dateKey }].sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
  }
}

function removeOriginDate(map: MakeupOriginMap, key: string, dateKey: string): MakeupOriginMap {
  const current = map[key] ?? []
  const nextDates = current.filter((origin) => origin.dateKey !== dateKey)
  if (nextDates.length === current.length) return map // 変化なし
  if (nextDates.length === 0) {
    const { [key]: _removed, ...rest } = map
    return rest
  }
  return { ...map, [key]: nextDates }
}

// 対象キー全てに「手動追加 + 抑制解除」を適用した新しいマップを返す(純粋・冪等)。
export function applyRestore720HolidayMakeup(
  manualAdjustments: MakeupOriginMap,
  suppressedMakeupOrigins: MakeupOriginMap,
  targetKeys: string[],
  originDate: string = RESTORE_720_ORIGIN_DATE,
): { manualAdjustments: MakeupOriginMap; suppressedMakeupOrigins: MakeupOriginMap } {
  let nextManual = manualAdjustments
  let nextSuppressed = suppressedMakeupOrigins
  for (const key of targetKeys) {
    nextManual = appendOriginDateIdempotent(nextManual, key, originDate)
    nextSuppressed = removeOriginDate(nextSuppressed, key, originDate)
  }
  return { manualAdjustments: nextManual, suppressedMakeupOrigins: nextSuppressed }
}
