// 退塾した生徒の「今日以降の盤面の痕跡」を消す掃除(退塾スイープ)の**検出**を担う純関数群。
//
// 何を解くか: 退塾にした生徒の**今日以降**の盤面の痕跡(手で置いた講習・振替・増コマ・体験・手動追加・移動の席と、
// 今日以降の出欠記録)を消し切る。通常授業(テンプレ由来)は従来どおり stripWithdrawnStudentsFromBoardWeek が剥がす。
//
// ★設計の改定(オーナー確定 2026-09-20 夜・確認リスト b-2/b-3):
//   従来は「退塾ボタンが一過性コマンド(キュー)を出し、盤面がそれを 1 件処理する」方式だった。オーナー確定で
//   **日付入力で退塾日を直接入れた場合も、未来の退塾日がその日を過ぎた場合も、同じ消去が黙って走る**ことになったため、
//   「命令を出す」方式をやめ、**盤面側が『退塾日を過ぎているのに痕跡が残る生徒』を検出して掃除する**方式へ一般化した。
//   - 検出は純関数 `collectStudentWithdrawSweepTargets`(名簿 × 盤面の 1 パス)。対象 0 なら呼び出し側は何もしない
//     (開いただけで未保存にならない)。
//   - 発火点は盤面のマウント時と `students` 変更時(基本データから戻った時)。キュー・requestId・消費は**不要になったので撤去**
//     （二重経路を残さない。Issue #46 型の「一過性コマンドが再マウントで再発火する」問題自体が消える）。
//   - 冪等: 掃除し終えた生徒は痕跡が無くなるので 2 回目の検出で対象 0。
// ★境界は既存の在籍判定に必ず合わせる(`isStudentWithdrawnOnDate`: **退塾日当日から非在籍**)。
//   消す範囲の開始日 = max(退塾日, 今日[JST])。退塾日が未来ならその日が来てから(＝非在籍になってから)初めて対象になる。
import { getStudentDisplayName, isStudentWithdrawnOnDate, type StudentRow } from '../basic-data/basicDataModel'
import { getJstTodayDateKey } from '../../utils/jstDate'
import { buildUniqueNameOwnerMap, resolveBoardStudentOwnerId } from './parentAbsenceTarget'
import type { SlotCell, StudentEntry } from './types'

export type StudentWithdrawSweepTarget = {
  /** 名簿の生徒 id(managedStudentId と同じ値)。 */
  studentId: string
  /** 室長へのメッセージ用の表示名(会計には使わない)。 */
  displayName: string
  /** この日以降の痕跡を消す = max(退塾日, 今日[JST])。 */
  fromDateKey: string
}

/**
 * 消す範囲の開始日 = max(退塾日, 今日[JST])。
 * ★昨日以前は請求・通常授業履歴の根拠なので絶対に触らない(退塾日が過去でも今日から)。
 * 退塾日が未来(日付入力で先の退塾日を入れた場合)はその日から。
 *
 * ★書式の扱い(2026-09-21・レビュー指摘): **厳格な `YYYY-MM-DD` 以外は `todayKey` に落とす**。
 *   在籍判定 `isStudentWithdrawnOnDate` は `normalizeDateText` を通すので `2026/9/1` のような書式も
 *   「退塾済み」と判定されうるが、ここでは正規化せずに今日へ落として構わない
 *   (**検出済みの候補は必ず「今日 ≧ 退塾日」だから max の結果は同じ**)。
 *   ⚠️ この割り切りが成り立つのは `collectStudentWithdrawSweepTargets` の候補に対してだけ。
 *   「未来の退塾日から消す範囲を決める」など**別用途でこの関数を使わない**
 *   (使うなら先に `normalizeDateText` を通すこと)。
 */
export function resolveStudentWithdrawSweepFromDateKey(withdrawDateKey: string, todayKey: string = getJstTodayDateKey()): string {
  const normalized = (withdrawDateKey ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return todayKey
  return normalized > todayKey ? normalized : todayKey
}

/**
 * 掃除すべき生徒を盤面と名簿から検出する。
 * 条件は次の 3 つを**すべて**満たすこと:
 *   1. 退塾日が入っていて、今日[JST]時点で非在籍(`isStudentWithdrawnOnDate`。未来の退塾日はまだ対象外)。
 *   2. その生徒の席 or 出欠記録が、消去開始日(= max(退塾日, 今日))**以降**のセルに残っている。
 *   3. 生徒の同一性が決められる: `managedStudentId` 一致、無い席は**名簿で一意な名前**だけ
 *      (同名 2 人は拾わない = `buildUniqueNameOwnerMap`。sNNN は教室ごと独立採番なので名前だけで別人を消さない)。
 * 昨日以前の痕跡だけの生徒は対象にしない(触らないので掃除の必要が無い)。
 */
export function collectStudentWithdrawSweepTargets(params: {
  weeks: ReadonlyArray<ReadonlyArray<SlotCell>>
  students: ReadonlyArray<StudentRow>
  todayKey?: string
}): StudentWithdrawSweepTarget[] {
  const todayKey = params.todayKey ?? getJstTodayDateKey()
  const candidates = new Map<string, StudentWithdrawSweepTarget>()
  for (const student of params.students) {
    if (!student.id) continue
    if (!isStudentWithdrawnOnDate(student.withdrawDate, todayKey)) continue
    candidates.set(student.id, {
      studentId: student.id,
      displayName: getStudentDisplayName(student),
      fromDateKey: resolveStudentWithdrawSweepFromDateKey(student.withdrawDate, todayKey),
    })
  }
  if (candidates.size === 0) return []

  const ownerByName = buildUniqueNameOwnerMap(params.students)
  const foundStudentIds = new Set<string>()
  const markIfTarget = (entry: Pick<StudentEntry, 'managedStudentId' | 'name'> | null | undefined, cellDateKey: string) => {
    if (!entry) return
    const ownerId = resolveBoardStudentOwnerId(entry, ownerByName)
    if (!ownerId || foundStudentIds.has(ownerId)) return
    const candidate = candidates.get(ownerId)
    if (!candidate) return
    if (cellDateKey < candidate.fromDateKey) return
    foundStudentIds.add(ownerId)
  }

  for (const week of params.weeks) {
    for (const cell of week) {
      if (!cell.dateKey) continue
      for (const desk of cell.desks) {
        for (const seat of desk.lesson?.studentSlots ?? []) markIfTarget(seat, cell.dateKey)
        for (const statusEntry of desk.statusSlots ?? []) markIfTarget(statusEntry, cell.dateKey)
      }
      if (foundStudentIds.size === candidates.size) break
    }
  }

  // 名簿順(＝入力順)で返す。掃除の適用順とメッセージの並びを決定的にするため。
  return params.students
    .map((student) => candidates.get(student.id))
    .filter((target): target is StudentWithdrawSweepTarget => Boolean(target && foundStudentIds.has(target.studentId)))
}

/** 室長へ出す結果メッセージ。掃除で何かを消したときだけ出す(0 件のときは呼ばない = 黙って何もしない)。 */
export function buildStudentWithdrawSweepMessage(
  results: ReadonlyArray<{ displayName: string; removedSeatCount: number; removedStatusCount: number }>,
): string {
  const removedSeatCount = results.reduce((total, entry) => total + entry.removedSeatCount, 0)
  const removedStatusCount = results.reduce((total, entry) => total + entry.removedStatusCount, 0)
  if (removedSeatCount + removedStatusCount === 0) return ''
  const names = results
    .filter((entry) => entry.removedSeatCount + entry.removedStatusCount > 0)
    .map((entry) => entry.displayName.trim() || '退塾した生徒')
  const subject = names.length === 1 ? names[0] : `退塾した生徒 ${names.length} 名(${names.join('・')})`
  return `${subject} の今日以降のコマ ${removedSeatCount} 件・記録 ${removedStatusCount} 件を盤面から消しました(未消化へは戻していません)。保存してください。`
}
