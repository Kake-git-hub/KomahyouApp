// 基本データの「退塾」ボタン → 盤面の痕跡消し(退塾スイープ)の一過性コマンド(オーナー確定 2026-09-20・確認リスト b-2)。
//
// 何を解くか: 退塾にした生徒の**今日以降**の盤面の痕跡(手で置いた講習・振替・増コマ・体験・手動追加・移動の席と、
// 今日以降の出欠記録)を消し切る。通常授業(テンプレ由来)は従来どおり stripWithdrawnStudentsFromBoardWeek が剥がす。
//
// ★設計の要点(Issue #46 と同型の再発火を防ぐ):
//   - 基本データ画面を開いている間は盤面が未マウントなので、命令は **App の state のキュー**に積む。
//     盤面はマウント後の effect でキューの先頭を 1 件ずつ処理し、結果を App へ返す。App は結果を受けて
//     **必ずその requestId をキューから外す**(consumeStudentWithdrawSweepRequest)。
//   - 重複ガードを「盤面ローカル ref だけ」に置くと盤面の再マウントで消えて再発火する。App 側の消費が正本で、
//     盤面 ref(processedStudentWithdrawSweepIdRef)は同一マウント内の二重実行を防ぐ副ガード。
//   - 再マージ effect や読込経路に在庫・盤面の破壊的処理を混ぜない(毎回走ると INV-03/INV-06 違反になる)。
//     この命令はユーザー操作(退塾ボタン)1 回につき 1 回だけ発行される。
import { getJstTodayDateKey } from '../../utils/jstDate'

export type StudentWithdrawSweepRequest = {
  requestId: number
  /** 名簿の生徒 id(managedStudentId と同じ値)。 */
  studentId: string
  /** 室長へのメッセージ用の表示名(会計には使わない)。 */
  displayName: string
  /** この日以降の痕跡を消す = max(退塾日, 今日[JST])。 */
  fromDateKey: string
}

export type StudentWithdrawSweepResult = {
  requestId: number
  studentId: string
  /** 消した席(studentSlots)の数。 */
  removedSeatCount: number
  /** 消した出欠記録(statusSlots)の数。 */
  removedStatusCount: number
}

/**
 * 消す範囲の開始日 = max(退塾日, 今日[JST])。
 * ★昨日以前は請求・通常授業履歴の根拠なので絶対に触らない(退塾日が過去でも今日から)。
 * 退塾日が未来(日付入力で先の退塾日を入れた場合)はその日から。
 */
export function resolveStudentWithdrawSweepFromDateKey(withdrawDateKey: string, todayKey: string = getJstTodayDateKey()): string {
  const normalized = (withdrawDateKey ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return todayKey
  return normalized > todayKey ? normalized : todayKey
}

/**
 * キューへ積む。複数の生徒を続けて退塾にしても取りこぼさないため配列で持つ。
 * 同じ生徒×同じ開始日が既に待っていれば積まない(同じ掃除を 2 回走らせない)。
 */
export function enqueueStudentWithdrawSweepRequest(
  current: readonly StudentWithdrawSweepRequest[],
  request: StudentWithdrawSweepRequest,
): StudentWithdrawSweepRequest[] {
  if (current.some((entry) => entry.studentId === request.studentId && entry.fromDateKey === request.fromDateKey)) {
    return [...current]
  }
  return [...current, request]
}

/** 盤面がいま処理すべき 1 件(キューの先頭)。空なら null。 */
export function selectStudentWithdrawSweepRequest(
  queue: readonly StudentWithdrawSweepRequest[] | null | undefined,
): StudentWithdrawSweepRequest | null {
  return queue?.[0] ?? null
}

/** 同一マウント内の二重実行を防ぐ副ガード(parentAbsenceRequest と同じ作法)。 */
export function shouldProcessStudentWithdrawSweepRequest(
  request: StudentWithdrawSweepRequest | null | undefined,
  processedRequestId: number | null,
): boolean {
  if (!request) return false
  return processedRequestId !== request.requestId
}

/** 処理し終えた 1 件をキューから外す(より新しい命令は消さない)。 */
export function consumeStudentWithdrawSweepRequest(
  current: readonly StudentWithdrawSweepRequest[],
  processedRequestId: number,
): StudentWithdrawSweepRequest[] {
  return current.filter((entry) => entry.requestId !== processedRequestId)
}

/** 室長へ出す結果メッセージ。0 件でも「痕跡は無かった」と分かるようにする。 */
export function buildStudentWithdrawSweepMessage(displayName: string, result: Pick<StudentWithdrawSweepResult, 'removedSeatCount' | 'removedStatusCount'>): string {
  const name = displayName.trim() || '退塾した生徒'
  const total = result.removedSeatCount + result.removedStatusCount
  if (total === 0) return `${name} の今日以降の盤面のコマ・記録はありませんでした。`
  return `${name} の今日以降のコマ ${result.removedSeatCount} 件・記録 ${result.removedStatusCount} 件を盤面から消しました(未消化へは戻していません)。`
}
