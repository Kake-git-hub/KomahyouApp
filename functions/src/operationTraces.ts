// 操作痕跡の保存同梱(2026-10-22 オーナー採用「即時対応のための案 2」)。
//
// 端末内の操作痕跡(src/utils/operationTrace.ts・盤面が変わる全確定・undo/redo・保存・別タブからのメッセージ)は、
// 従来は「質問・要望」ボタンが押されたときだけサーバーへ届いた(spec-developer-report §A「全操作を常時送らない」)。
// 室長が報告せずに自分で直してしまった事例を後から追えるよう、**保存リクエストに「前回保存以降の痕跡」を相乗りさせ**、
// 保存ごとに classroomSnapshots/{id}/operationTraces/{saveId} へ残す。追加のリクエストは無い(保存に乗るだけ)ので、
// 「常時送らない」というコストの判断と両立する。版履歴(classroom-save-history/・案 1)と同じ saveId で突き合わせられる。
//
// 決まり(操作ログ operationEvents.ts と同じ):
//  - 受領時刻(recordedAt)と実行者(updatedBy)はサーバーが付ける。
//  - 壊れた要素はその要素だけ捨てる。種別・長さ・件数の規則は報告(developerReport.ts)と同じ正規化を使う(二重管理しない)。
//  - ★書けなくても保存本体は成功のまま(index.ts persistOperationTrace が握る)。
//  - 保持は 90 日(index.ts OPERATION_TRACE_RETENTION_DAYS・掃除は retentionCleanup の対応表)。

import { normalizeDeveloperReportTrace, trimDeveloperReportTraceToBudget, type NormalizedDeveloperReportTraceEntry } from './developerReport'

/** 1 回の保存に相乗りさせる件数の上限(新しい方から)。報告と同じ 300 件・Firestore 文書 1MiB に収まる量。 */
export const OPERATION_TRACE_SAVE_LIMIT = 300

export type OperationTraceDoc = {
  classroomId: string
  saveId: string
  /** 保存の時刻(クライアント申告・保存本体と同じ値)。 */
  savedAt: string
  /** この保存で付いた版数(楽観ロックの version)。版履歴のファイル名と突き合わせる。 */
  snapshotVersion: number | null
  updatedBy: string
  appVersion?: string
  userAgent?: string
  entries: NormalizedDeveloperReportTraceEntry[]
  entryCount: number
  /** 痕跡の最初と最後の時刻(クライアント時計)。一覧から中身を開かずに範囲を読むため。 */
  firstAt: string
  lastAt: string
  /** サーバー受領時刻。掃除(保持 90 日)はこれを見る。 */
  recordedAt: string
}

/** 保存リクエストの operationTrace を正規化する(報告の recentOperations と同じ規則・上限は新しい方から 300 件)。 */
export function normalizeSaveOperationTrace(raw: unknown, options: { fallbackIso: string }): NormalizedDeveloperReportTraceEntry[] {
  const entries = normalizeDeveloperReportTrace(raw, options)
  return entries.length > OPERATION_TRACE_SAVE_LIMIT ? entries.slice(entries.length - OPERATION_TRACE_SAVE_LIMIT) : entries
}

/** Firestore 文書を組み立てる。文書 1MiB の予算に合わせて古い方から落とす(報告と同じ trimDeveloperReportTraceToBudget)。 */
export function buildOperationTraceDoc(params: {
  classroomId: string
  saveId: string
  savedAt: string
  snapshotVersion: number | undefined
  updatedBy: string
  client?: { appVersion: string; userAgent: string }
  entries: NormalizedDeveloperReportTraceEntry[]
  recordedAt: string
}): OperationTraceDoc {
  const entries = trimDeveloperReportTraceToBudget(params.entries)
  return {
    classroomId: params.classroomId,
    saveId: params.saveId,
    savedAt: params.savedAt,
    snapshotVersion: typeof params.snapshotVersion === 'number' && Number.isFinite(params.snapshotVersion) ? params.snapshotVersion : null,
    updatedBy: params.updatedBy,
    ...(params.client?.appVersion ? { appVersion: params.client.appVersion } : {}),
    ...(params.client?.userAgent ? { userAgent: params.client.userAgent } : {}),
    entries,
    entryCount: entries.length,
    firstAt: entries[0]?.at ?? '',
    lastAt: entries[entries.length - 1]?.at ?? '',
    recordedAt: params.recordedAt,
  }
}
