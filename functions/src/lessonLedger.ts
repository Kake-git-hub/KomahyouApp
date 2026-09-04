// 生徒授業台帳（生徒×科目ごとの授業実績と未消化・元コマ一覧つき）のサーバー側受け口。
//
// クライアント（src/utils/studentLessonLedger.ts）が保存リクエストに相乗りさせて送る台帳を、
// Firestore へ書く前に検証・整形し、**JST の日付ごとに1ドキュメント**へ格納する（同じ日の保存は上書き＝
// その日の最終状態が残る）。保持はオーナー指示「1年分を振り返れる」を満たすため **2 年**（年度末に前年度
// 分が消えないよう余裕を持たせる）。掃除は index.ts の定期クリーンアップが行う。
//
// 置き場所: classroomSnapshots/{classroomId}/lessonLedgerDays/{YYYY-MM-DD}
// - 本文は gzip+base64 で持つ（大規模教室でも 1MB のドキュメント上限に収める）。
// - 集計値（totals・行数）は非圧縮で持ち、一覧だけで推移を追えるようにする。

import { gunzipSync, gzipSync } from 'node:zlib'

export const LESSON_LEDGER_ENCODING = 'gzip-base64' as const
/** 受け付ける台帳 JSON の最大長（圧縮前）。これを超える台帳は捨てて保存本体だけ通す。 */
export const LESSON_LEDGER_MAX_JSON_LENGTH = 6 * 1024 * 1024
const JST_OFFSET_IN_MS = 9 * 60 * 60 * 1000

export type NormalizedLessonLedger = {
  version: number
  computedAt: string
  rows: unknown[]
  lectureRows: unknown[]
  totals: { makeupBalance: number; lecturePending: number; attended: number; placed: number }
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function toJstDateKeyFromIso(iso: string, fallback = new Date()): string {
  const parsed = Date.parse(iso)
  const base = Number.isFinite(parsed) ? parsed : fallback.getTime()
  const jst = new Date(base + JST_OFFSET_IN_MS)
  return `${jst.getUTCFullYear()}-${`${jst.getUTCMonth() + 1}`.padStart(2, '0')}-${`${jst.getUTCDate()}`.padStart(2, '0')}`
}

/**
 * 台帳の形を最低限検証する。壊れていれば null（保存本体は通す・監査記録は保存より優先度が低い）。
 * 行の中身までは検証しない（クライアントと同じ計算結果をそのまま保管する用途で、読む側が解釈する）。
 */
export function normalizeLessonLedger(raw: unknown, options: { fallbackIso?: string } = {}): NormalizedLessonLedger | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  if (!Array.isArray(candidate.rows) || !Array.isArray(candidate.lectureRows)) return null
  const totalsRaw = (candidate.totals && typeof candidate.totals === 'object' && !Array.isArray(candidate.totals))
    ? candidate.totals as Record<string, unknown>
    : {}
  const computedAtParsed = typeof candidate.computedAt === 'string' ? Date.parse(candidate.computedAt) : Number.NaN
  const computedAt = Number.isFinite(computedAtParsed)
    ? new Date(computedAtParsed).toISOString()
    : (options.fallbackIso ?? new Date().toISOString())
  const normalized: NormalizedLessonLedger = {
    version: toFiniteNumber(candidate.version) || 1,
    computedAt,
    rows: candidate.rows,
    lectureRows: candidate.lectureRows,
    totals: {
      makeupBalance: toFiniteNumber(totalsRaw.makeupBalance),
      lecturePending: toFiniteNumber(totalsRaw.lecturePending),
      attended: toFiniteNumber(totalsRaw.attended),
      placed: toFiniteNumber(totalsRaw.placed),
    },
  }
  if (JSON.stringify(normalized).length > LESSON_LEDGER_MAX_JSON_LENGTH) return null
  return normalized
}

export function encodeLessonLedgerBody(ledger: NormalizedLessonLedger): string {
  return gzipSync(Buffer.from(JSON.stringify({ rows: ledger.rows, lectureRows: ledger.lectureRows }), 'utf8')).toString('base64')
}

export function decodeLessonLedgerBody(encoded: string): { rows: unknown[]; lectureRows: unknown[] } {
  return JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')) as { rows: unknown[]; lectureRows: unknown[] }
}

/** Firestore ドキュメントに書く形（本文は圧縮・集計は平文）。 */
export function buildLessonLedgerDayDoc(params: {
  ledger: NormalizedLessonLedger
  classroomId: string
  dateKey: string
  savedAt: string
  saveId: string
  updatedBy: string
  recordedAt: string
}) {
  const { ledger } = params
  return {
    classroomId: params.classroomId,
    dateKey: params.dateKey,
    savedAt: params.savedAt,
    saveId: params.saveId,
    updatedBy: params.updatedBy,
    recordedAt: params.recordedAt,
    version: ledger.version,
    computedAt: ledger.computedAt,
    rowCount: ledger.rows.length,
    lectureRowCount: ledger.lectureRows.length,
    totals: ledger.totals,
    dataEncoding: LESSON_LEDGER_ENCODING,
    data: encodeLessonLedgerBody(ledger),
  }
}
