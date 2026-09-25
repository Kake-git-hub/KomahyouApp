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

export type ChecklistReportPart = {
  reportId: string
  version: string
  part: number
  total: number
  /** マーカー行を除いた本文。 */
  body: string
  recordedAt: string
  reportedAt: string
}

export type MergedChecklistReport = {
  version: string
  total: number
  receivedParts: number[]
  body: string
  reportIds: string[]
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
export function toChecklistReport(raw: {
  reportId?: string | null
  note?: string | null
  recordedAt?: string | null
  reportedAt?: string | null
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
    const key = `${report.version} ${report.total}`
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
