// 「確認リスト」結果の読み取り(純関数)。開発ダッシュボード(開発者画面)が developerReports から
// 確認リストの送信本文を読み、項目 id ごとの最新結果に集約するために使う。
//
// ★ tools/verification-checklist-report.lib.mjs(PC から gcloud で読む従来ツール)の **TypeScript 移植**。
//   tools は node が直接実行する .mjs で TS を import できず、アプリ側は型無しの .mjs を import できないため
//   2 本になっている。**判定規則(マーカー・結果行・その他の書式)は両者で同一**に保つこと。
//   ズレは tools/verification-checklist-results.parity.test.mjs が同じ入力で両実装を突き合わせて検出する。
//   送信側の書式(src/utils/verificationChecklist.ts buildVerificationChecklistLines)を変えるときは
//   ここと .mjs の両方を合わせる。
//
// このファイルは純データ＋純関数のみ。Firestore / DOM / ネットワークには触らない。

/** 先頭行のマーカー。`[確認リスト v1.5.502]` または `[確認リスト v1.5.502] (1/2)`。 */
const MARKER_PATTERN = /^\[確認リスト\s+v([0-9]+\.[0-9]+\.[0-9]+)\](?:\s*\((\d+)\/(\d+)\))?\s*$/u

/** 結果行。`- <項目id> OK` / `- <項目id> 要改善: <メモ>`(メモに `:` を含んでもよい)。 */
const RESULT_LINE_PATTERN = /^-\s*(\S+)\s+(OK|要改善)\s*(?::\s*([\s\S]*))?$/u

const OTHER_NOTES_HEADING = /^その他の気づき[:：]?\s*$/u

/**
 * 送信本文の「その他」1 行形式(`- その他: <メモ>`)。
 * ★ 回帰防止(2026-09-14): 以前はこの形を読めず、その他欄の要望がレポートから黙って落ちていた。
 */
const OTHER_NOTES_INLINE = /^-\s*その他[:：]\s*([\s\S]*)$/u

export type ChecklistMarker = {
  /** 版(先頭の v なし。例 `1.5.556`)。 */
  version: string
  /** 分割番号(1 始まり)。 */
  part: number
  /** 総分割数。 */
  total: number
}

/** 添付画像(2026-10-14): 文書 attachments[] の 1 件(label=項目 id・Storage の保存先)。.mjs と同じ形。 */
export type ChecklistReportAttachment = {
  label: string
  name: string
  storagePath: string
  byteLength: number
  reportId: string
}

export type ChecklistReportPart = {
  reportId: string
  version: string
  part: number
  total: number
  /** マーカー行を除いた本文。 */
  body: string
  recordedAt: string
  reportedAt: string
  attachments: ChecklistReportAttachment[]
}

export type MergedChecklistReport = {
  version: string
  total: number
  receivedParts: number[]
  body: string
  reportIds: string[]
  attachments: ChecklistReportAttachment[]
  firstRecordedAt: string
  lastRecordedAt: string
}

export type ChecklistItemResultKind = 'ok' | 'needs-improvement'

export type ChecklistItemResult = {
  itemId: string
  result: ChecklistItemResultKind
  memo: string
}

export type ChecklistLatestItemResult = ChecklistItemResult & {
  version: string
  recordedAt: string
  reportIds: string[]
  /** この項目に貼られた画像(label=項目 id・2026-10-14)。 */
  attachments: ChecklistReportAttachment[]
}

export type ChecklistOtherNote = {
  version: string
  recordedAt: string
  note: string
}

export type ChecklistResultSummary = {
  items: ChecklistLatestItemResult[]
  otherNotes: ChecklistOtherNote[]
}

/**
 * note の先頭行がマーカーかどうかを判定し、あれば版数・分割番号・総分割数を返す。
 * マーカーが無ければ null(＝確認リスト結果ではない報告として除外する)。
 */
export function parseChecklistMarker(note: string | null | undefined): ChecklistMarker | null {
  const firstLine = String(note ?? '').split('\n')[0]?.trim() ?? ''
  const match = MARKER_PATTERN.exec(firstLine)
  if (!match) return null
  const [, version, partRaw, totalRaw] = match
  const part = partRaw ? Number(partRaw) : 1
  const total = totalRaw ? Number(totalRaw) : 1
  if (!Number.isFinite(part) || !Number.isFinite(total) || part < 1 || total < 1 || part > total) return null
  return { version, part, total }
}

/** 1 件の報告(developerReports のフィールド)からマーカー付きの本文だけ抽出する。マーカーが無ければ null。 */
function readChecklistReportAttachments(raw: unknown, reportId: string): ChecklistReportAttachment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && typeof (item as Record<string, unknown>).storagePath === 'string' && Boolean((item as Record<string, unknown>).storagePath))
    .map((item) => ({ label: String(item.label ?? ''), name: String(item.name ?? 'image'), storagePath: item.storagePath as string, byteLength: Number(item.byteLength ?? 0) || 0, reportId }))
}

export function toChecklistReport(raw: {
  reportId?: string | null
  note?: string | null
  recordedAt?: string | null
  reportedAt?: string | null
  attachments?: unknown
} | null | undefined): ChecklistReportPart | null {
  const note = String(raw?.note ?? '')
  const marker = parseChecklistMarker(note)
  if (!marker) return null
  const bodyLines = note.split('\n').slice(1)
  return {
    reportId: raw?.reportId ?? '',
    version: marker.version,
    part: marker.part,
    total: marker.total,
    body: bodyLines.join('\n'),
    recordedAt: raw?.recordedAt ?? raw?.reportedAt ?? '',
    reportedAt: raw?.reportedAt ?? '',
    attachments: readChecklistReportAttachments(raw?.attachments, raw?.reportId ?? ''),
  }
}

/**
 * 分割された報告(同一版・同一 total)を part 順に結合して 1 件の本文へまとめる。
 * 同じ part 番号が複数来たら受付が新しい方を採用する(同一版の再送)。part が欠けていても届いた分だけで結合する。
 * 戻り値は受付が早い順(グループの最も早い recordedAt 順)。
 */
export function mergeChecklistReports(reports: readonly ChecklistReportPart[]): MergedChecklistReport[] {
  const groups = new Map<string, ChecklistReportPart[]>()
  for (const report of reports) {
    // ★1 通だけの報告(total=1)は**それぞれ別の受付**として扱う(2026-11-03・確認リストを項目ごとに送るようにしたため)。
    //   以前は同じ版の 1 通ものを「同一版の再送」とみなして最新 1 通だけ残しており、項目ごとに送ると前に送った項目の結果が消えた。
    //   同じ項目を送り直したときの後勝ちは summarizeChecklistResults(項目 id ごとの後勝ち)が担う。
    const key = report.total === 1 ? `single ${report.reportId} ${report.recordedAt}` : `${report.version} ${report.total}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(report)
    else groups.set(key, [report])
  }
  const merged: MergedChecklistReport[] = []
  for (const parts of groups.values()) {
    const byPart = new Map<number, ChecklistReportPart>()
    for (const part of parts) {
      const existing = byPart.get(part.part)
      if (!existing || String(part.recordedAt ?? '') >= String(existing.recordedAt ?? '')) byPart.set(part.part, part)
    }
    const ordered = [...byPart.values()].sort((a, b) => a.part - b.part)
    const body = ordered.map((part) => part.body).join('\n')
    const recordedAtList = ordered.map((part) => part.recordedAt).filter(Boolean).sort()
    merged.push({
      version: ordered[0].version,
      total: ordered[0].total,
      receivedParts: ordered.map((part) => part.part),
      body,
      reportIds: ordered.map((part) => part.reportId),
      attachments: ordered.flatMap((part) => part.attachments ?? []),
      firstRecordedAt: recordedAtList[0] ?? '',
      lastRecordedAt: recordedAtList[recordedAtList.length - 1] ?? '',
    })
  }
  return merged.sort((a, b) => String(a.firstRecordedAt).localeCompare(String(b.firstRecordedAt)))
}

/**
 * 結合済み本文から項目結果と「その他の気づき」を抽出する。
 * 結果行に該当しない行は「その他の気づき」セクション配下ならそこへ、それ以外は無視する。
 */
export function parseChecklistBody(body: string | null | undefined): { items: ChecklistItemResult[]; otherNotes: string } {
  const items: ChecklistItemResult[] = []
  const otherNotesLines: string[] = []
  let inOtherNotes = false
  for (const rawLine of String(body ?? '').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (OTHER_NOTES_HEADING.test(line)) {
      inOtherNotes = true
      continue
    }
    const inlineOther = OTHER_NOTES_INLINE.exec(line)
    if (inlineOther) {
      inOtherNotes = false
      if (inlineOther[1].trim()) otherNotesLines.push(inlineOther[1].trim())
      continue
    }
    const match = RESULT_LINE_PATTERN.exec(line)
    if (match) {
      inOtherNotes = false
      const [, itemId, result, memo] = match
      items.push({ itemId, result: result === 'OK' ? 'ok' : 'needs-improvement', memo: memo ? memo.trim() : '' })
      continue
    }
    if (inOtherNotes) otherNotesLines.push(line)
  }
  return { items, otherNotes: otherNotesLines.join('\n') }
}

/**
 * 複数の受付(版・受付順つき)から、項目 id ごとの**最新結果**だけを残す(後勝ち)。
 * 「その他の気づき」も受付順に列挙する。
 */
export function summarizeChecklistResults(mergedReports: readonly MergedChecklistReport[]): ChecklistResultSummary {
  const latestByItem = new Map<string, ChecklistLatestItemResult>()
  const otherNotes: ChecklistOtherNote[] = []
  for (const report of mergedReports) {
    const { items, otherNotes: notes } = parseChecklistBody(report.body)
    for (const item of items) {
      latestByItem.set(item.itemId, {
        ...item,
        version: report.version,
        recordedAt: report.lastRecordedAt,
        reportIds: report.reportIds,
        attachments: (report.attachments ?? []).filter((attachment) => attachment.label === item.itemId),
      })
    }
    if (notes.trim()) {
      otherNotes.push({ version: report.version, recordedAt: report.lastRecordedAt, note: notes.trim() })
    }
  }
  return { items: [...latestByItem.values()], otherNotes }
}

/** 報告一覧(developerReports のフィールド)から、確認リストの結果だけを集約する(マーカー無しは無視)。 */
export function summarizeChecklistReports(
  reports: ReadonlyArray<{ reportId?: string | null; note?: string | null; recordedAt?: string | null; reportedAt?: string | null }>,
): ChecklistResultSummary {
  const parts: ChecklistReportPart[] = []
  for (const report of reports) {
    const part = toChecklistReport(report)
    if (part) parts.push(part)
  }
  return summarizeChecklistResults(mergeChecklistReports(parts))
}

// ---- どの教室で確認済みか(2026-11-03 オーナー指示) ----
//
// 「確認リストで、開発用教室とテスト用教室の双方でチェックしているため、双方が重複チェックしないように
//  どちらの教室がチェック済みかわかるようにして」。Cloud Function listVerificationChecklistResults が返す
// 送信(検証用教室から届いた指定版の確認リスト本文)を、教室ごとに項目 id の最新結果へ集約する。
// 集約の規則(マーカー・結果行・分割の結合・後勝ち)は上の関数をそのまま使う(教室で分けて呼ぶだけ)。

export type ChecklistClassroomKind = 'development' | 'sandbox'

/** listVerificationChecklistResults の 1 件(src/integrations/firebase/adminFunctions.ts と同じ形)。 */
export type ChecklistSharedReport = {
  reportId?: string | null
  classroomId: string
  classroomName?: string | null
  classroomKind: ChecklistClassroomKind
  note?: string | null
  recordedAt?: string | null
  reportedAt?: string | null
}

export type ChecklistItemClassroomResult = {
  classroomId: string
  classroomKind: ChecklistClassroomKind
  /** 「開発用教室」「テスト教室」(テスト教室が複数あるときは教室名を添える)。 */
  classroomLabel: string
  /** 今開いている教室の結果か。 */
  isCurrentClassroom: boolean
  result: ChecklistItemResultKind
  memo: string
  recordedAt: string
}

/** 項目 id → 教室ごとの最新結果(開発用教室が先・同じ種類は受付が新しい順)。 */
export type ChecklistItemClassroomResults = Record<string, ChecklistItemClassroomResult[]>

export function summarizeChecklistResultsByClassroom(
  reports: readonly ChecklistSharedReport[],
  options: { currentClassroomId: string | null | undefined },
): ChecklistItemClassroomResults {
  const byClassroom = new Map<string, ChecklistSharedReport[]>()
  for (const report of reports) {
    if (!report?.classroomId) continue
    const list = byClassroom.get(report.classroomId) ?? []
    list.push(report)
    byClassroom.set(report.classroomId, list)
  }
  const sandboxCount = [...byClassroom.values()].filter((list) => list[0].classroomKind !== 'development').length
  const results: ChecklistItemClassroomResults = {}
  for (const [classroomId, list] of byClassroom) {
    const kind: ChecklistClassroomKind = list[0].classroomKind === 'development' ? 'development' : 'sandbox'
    const name = list.map((report) => report.classroomName ?? '').find(Boolean) ?? ''
    const classroomLabel = kind === 'development' ? '開発用教室' : sandboxCount > 1 && name ? `テスト教室(${name})` : 'テスト教室'
    const summary = summarizeChecklistReports(list)
    for (const item of summary.items) {
      const bucket = results[item.itemId] ?? []
      bucket.push({
        classroomId,
        classroomKind: kind,
        classroomLabel,
        isCurrentClassroom: Boolean(options.currentClassroomId) && classroomId === options.currentClassroomId,
        result: item.result,
        memo: item.memo,
        recordedAt: item.recordedAt,
      })
      results[item.itemId] = bucket
    }
  }
  for (const bucket of Object.values(results)) {
    bucket.sort((a, b) => (a.classroomKind === b.classroomKind ? b.recordedAt.localeCompare(a.recordedAt) : a.classroomKind === 'development' ? -1 : 1))
  }
  return results
}

/** 画面に出す受付時刻(JST・`11/3 14:05`)。読めなければ空文字。 */
export function formatChecklistRecordedAt(iso: string | null | undefined): string {
  const time = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(time)) return ''
  const jst = new Date(time + 9 * 60 * 60 * 1000)
  const minutes = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${jst.getUTCHours()}:${minutes}`
}

// ---- 送ったフリーメモの履歴(2026-11-03 オーナー指示「フリーメモは送信して Claude で処理されるまでは送信内容が確認リストに履歴が残るようにして」) ----
//
// listVerificationChecklistResults が返す今の版の送信から、フリーメモ(本文の「その他」)を受付ごとに取り出し、
// Claude が対応済みにした受付(verificationChecklist.ts の VERIFICATION_CHECKLIST_PROCESSED_REPORT_IDS)を除いて並べる。

export type ChecklistPendingOtherNote = {
  reportId: string
  classroomLabel: string
  isCurrentClassroom: boolean
  recordedAt: string
  note: string
}

/** 対応待ちのフリーメモ(受付が新しい順)。受付番号の無い送信・Claude が対応済みにした受付は出さない。 */
export function selectPendingChecklistOtherNotes(
  reports: readonly ChecklistSharedReport[],
  options: { currentClassroomId: string | null | undefined; processedReportIds: ReadonlySet<string> | readonly string[] },
): ChecklistPendingOtherNote[] {
  const processed = options.processedReportIds instanceof Set ? options.processedReportIds : new Set(options.processedReportIds as readonly string[])
  const pending: ChecklistPendingOtherNote[] = []
  for (const report of reports) {
    const reportId = String(report?.reportId ?? '')
    if (!reportId || processed.has(reportId)) continue
    const part = toChecklistReport(report)
    if (!part) continue
    const { otherNotes } = parseChecklistBody(part.body)
    if (!otherNotes.trim()) continue
    pending.push({
      reportId,
      classroomLabel: report.classroomKind === 'development' ? '開発用教室' : 'テスト教室',
      isCurrentClassroom: Boolean(options.currentClassroomId) && report.classroomId === options.currentClassroomId,
      recordedAt: part.recordedAt,
      note: otherNotes.trim(),
    })
  }
  return pending.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
}
