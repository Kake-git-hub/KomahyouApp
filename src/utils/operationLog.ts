// 操作ログ（在庫が減る・記録が消える操作の監査記録）。
//
// 背景（2026-09-04 オーナー指示）: 「未消化振替が減った／消えた」という問い合わせに対し、これまでは
// 15 分毎の自動バックアップを前後比較して**推測**するしかなかった（誰がいつ×で消したかは残らない）。
// そこで「在庫を減らす・記録を消す操作」だけを、操作した時点で記録する。
//
// 設計の要点:
//  - **保存スナップショットには載せない。** サーバー側の別コレクション
//    `classroomSnapshots/{classroomId}/operationEvents` へ Cloud Function が書く。
//    盤面データに混ぜると、ロールバック/復元で「消した記録」ごと巻き戻り、監査に使えなくなる。
//  - **実行者と時刻はサーバーが付ける**（Cloud Function の memberRef.id）。クライアントの自己申告にしない。
//  - **保存に失敗したら記録も残さない**（保存できなかった操作＝盤面にも残っていないため）。
//    送信に失敗したイベントはバッファへ戻し、次の保存に再送する。イベント id をドキュメント id にするので
//    再送しても重複しない。
//  - モジュールスコープの単純なバッファ（1ブラウザ1タブ＝1インスタンス）。版数レジストリ
//    `classroomSnapshotVersions.ts` と同じ方式で、巨大な ScheduleBoardScreen へ props を通さずに記録できる。

/** 記録する操作の種類。**在庫が減る／出欠記録が消える操作だけ**を対象にする（オーナー確定 2026-09-04）。 */
export type OperationEventKind =
  /** 未消化振替一覧の × 削除（suppressedMakeupOrigins へ抑制を積む） */
  | 'makeup-stock-delete'
  /** 未消化講習一覧の × 削除 */
  | 'lecture-stock-delete'
  /** 盤面のコマ削除（1コマ） */
  | 'lesson-delete'
  /** 未消化へ戻す（格納） */
  | 'lesson-store'
  /** 出欠付与（休み／振無休／出席）。既存の出欠記録を上書きした場合は detail に残す */
  | 'status-mark'
  /** 出欠解除 */
  | 'status-clear'
  /** その日の生徒を全コマ削除 */
  | 'clear-day-students'
  /** 丸ごと振替（日付単位の移送） */
  | 'whole-day-transfer'
  /** 休日設定・解除 */
  | 'holiday-toggle'
  /** 生徒の移動で、移動元に書く「移)」マーカーが別生徒の出欠記録を上書きして消した */
  | 'record-displaced'
  /** ★2 自動処理: 起動時の自己修復(提出済みで未配置の講師を自動配置) */
  | 'auto-teacher-reconcile'
  /** ★2 自動処理: QR 提出/登録解除に伴う講師の自動登録・解除 */
  | 'auto-teacher-assign'
  /** ★2 自動処理: 生徒の登録解除に伴う講習コマの自動除去 */
  | 'auto-student-unassign'

export type OperationEventDetail = Record<string, string | number | boolean>

export type OperationEvent = {
  /** ドキュメント id を兼ねる。再送しても重複しないよう、生成時に一意にする。 */
  id: string
  /** 操作した時刻（クライアント時計・ISO）。信頼できる時刻はサーバーが別途付ける。 */
  at: string
  kind: OperationEventKind
  detail: OperationEventDetail
}

/** 1イベントの detail に載せるキー数の上限（想定外の巨大データを送らないための保険）。 */
export const OPERATION_EVENT_DETAIL_KEY_LIMIT = 24
/** detail の文字列値の最大長。生徒名・ラベル程度しか入れないので十分。 */
export const OPERATION_EVENT_DETAIL_VALUE_LIMIT = 120
/**
 * 未送信のまま溜められるイベント数の上限。超えたら**古いものから捨てる**（新しい操作を優先）。
 * 保存のたびに空になるため、通常の運用でこの上限に届くことはない。
 * ★サーバー側の1リクエスト上限（functions/src/operationEvents.ts `OPERATION_EVENT_REQUEST_LIMIT`）と**同じ値**にする。
 *   こちらが大きいと、超過分がサーバーで黙って切り捨てられ、保存は成功するので戻しもされず永久に失われる。
 */
export const OPERATION_EVENT_BUFFER_LIMIT = 400

function sanitizeDetail(detail: OperationEventDetail): OperationEventDetail {
  const result: OperationEventDetail = {}
  for (const [key, value] of Object.entries(detail)) {
    if (Object.keys(result).length >= OPERATION_EVENT_DETAIL_KEY_LIMIT) break
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue
      result[key] = trimmed.slice(0, OPERATION_EVENT_DETAIL_VALUE_LIMIT)
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue
      result[key] = value
      continue
    }
    if (typeof value === 'boolean') result[key] = value
  }
  return result
}

let eventSequence = 0

export function buildOperationEvent(
  kind: OperationEventKind,
  detail: OperationEventDetail,
  options: { now?: Date; idSuffix?: string } = {},
): OperationEvent {
  const now = options.now ?? new Date()
  eventSequence = (eventSequence + 1) % 1_000_000
  // 同一ミリ秒に複数イベントが出ても衝突しないよう連番を混ぜる（ドキュメント id を兼ねるため）。
  const suffix = options.idSuffix ?? `${eventSequence.toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return {
    id: `${now.getTime().toString(36)}_${kind}_${suffix}`,
    at: now.toISOString(),
    kind,
    detail: sanitizeDetail(detail),
  }
}

export function appendOperationEvent(
  buffer: OperationEvent[],
  event: OperationEvent,
  limit: number = OPERATION_EVENT_BUFFER_LIMIT,
): OperationEvent[] {
  const next = [...buffer, event]
  return next.length > limit ? next.slice(next.length - limit) : next
}

// ---------------------------------------------------------------------------
// 教室ごとの未送信バッファ（モジュールスコープ）
// ---------------------------------------------------------------------------

const buffersByClassroomId = new Map<string, OperationEvent[]>()
let currentClassroomId = ''

/** 現在開いている教室を登録する（App が actingClassroomId の変化で呼ぶ）。 */
export function setOperationLogClassroomId(classroomId: string | null | undefined): void {
  currentClassroomId = classroomId ?? ''
}

export function getOperationLogClassroomId(): string {
  return currentClassroomId
}

/**
 * 操作を記録する。**現在開いている教室が未登録なら何もしない**（教室が定まらない記録は
 * 別教室へ混入するより捨てる方が安全＝本番データ保護の考え方と同じ）。
 */
export function recordOperationEvent(kind: OperationEventKind, detail: OperationEventDetail): OperationEvent | null {
  if (!currentClassroomId) return null
  const event = buildOperationEvent(kind, detail)
  buffersByClassroomId.set(currentClassroomId, appendOperationEvent(buffersByClassroomId.get(currentClassroomId) ?? [], event))
  return event
}

/** 保存に載せるため取り出す（バッファからは消える）。保存が失敗したら restoreOperationEvents で戻すこと。 */
export function takeOperationEvents(classroomId: string): OperationEvent[] {
  if (!classroomId) return []
  const events = buffersByClassroomId.get(classroomId) ?? []
  if (events.length === 0) return []
  buffersByClassroomId.delete(classroomId)
  return events
}

/** 送信に失敗したイベントを先頭へ戻す（操作順を保つ）。 */
export function restoreOperationEvents(classroomId: string, events: OperationEvent[]): void {
  if (!classroomId || events.length === 0) return
  const merged = [...events, ...(buffersByClassroomId.get(classroomId) ?? [])]
  buffersByClassroomId.set(
    classroomId,
    merged.length > OPERATION_EVENT_BUFFER_LIMIT ? merged.slice(merged.length - OPERATION_EVENT_BUFFER_LIMIT) : merged,
  )
}

export function peekOperationEvents(classroomId: string): OperationEvent[] {
  return [...(buffersByClassroomId.get(classroomId) ?? [])]
}

/** アカウント切替・再読込時に呼ぶ（別アカウントの未送信記録を持ち越さない）。 */
export function clearOperationEvents(): void {
  buffersByClassroomId.clear()
  currentClassroomId = ''
}
