// 開発用教室だけに出す「確認事項チェックリスト」の純粋ロジック(2026-09-12 オーナー指示)。
//
// 目的: 新機能を開発用教室で触りながら「OK か・どこを直してほしいか」をその場で書き留め、
// まとめて開発者へ送れるようにする。送信経路は既存の「要望・報告」(submitDeveloperReport)を
// そのまま使う(= developerReports に蓄積されメール通知が飛ぶ)。新しい保存先は作らない。
//
// 本番教室では一切出さない(App 側の isActingDevelopmentClassroom で条件付け・source-scan テストで固定)。
//
// このファイルは純データ＋純関数のみ。localStorage / DOM / ネットワークには触らない
// (テストしやすさのため。呼び出し側が入出力を担う)。

import { DEVELOPER_REPORT_NOTE_LIMIT } from './developerReport'

/** 1項目の確認状態。未確認は送信対象から外す(省略)。 */
export const VERIFICATION_CHECKLIST_STATUSES = ['unchecked', 'ok', 'needs-fix'] as const
export type VerificationChecklistStatus = (typeof VERIFICATION_CHECKLIST_STATUSES)[number]

export type VerificationChecklistItem = {
  /** 送信本文に載る短い識別子。生徒名などの個人情報は含めない。 */
  id: string
  /** 画面上の分類見出し(盤面 / PDF / 日程表 …)。 */
  area: string
  title: string
  /** 確認手順。1行1手順。 */
  steps: string[]
  /** この項目を追加した版(あとから「いつからの確認項目か」を追える)。 */
  introducedIn: string
}

export type VerificationChecklistDefinition = {
  version: string
  items: readonly VerificationChecklistItem[]
}

/** 確認リストの版。項目を足したら上げる(下書きは版ごとに分かれる)。 */
export const VERIFICATION_CHECKLIST_VERSION = 'v1.5.526'

/**
 * 確認項目の正本(2026-09-12 初版・v1.5.504 で第2版・v1.5.506 で第3版・v1.5.508 で第4版・v1.5.509 で第5版)。
 * ★ 第3版からの運用(オーナー指摘 2026-09-12「以前確認し終わったものが残っている」): 前回の確認リストで OK だった項目は
 *   **載せない**。載せるのは「前回 要改善 → 今回の修正を確認してほしい項目」と「今回の新機能」だけ。
 *   OK 済みの項目は git 履歴(v1.5.502 / v1.5.504 の定義)と Issue #62 / #63 に残る。
 * 第3版: v1.5.504 の結果(Issue #63)で要改善だった p-2/p-3(行高さ)・h-2(履歴 INTERNAL)の再確認と、
 *   その他要望(PDF 出力中のスピナー・確認リストの整理)の確認項目。
 * 第4版(v1.5.508・2026-09-13): 第3版の結果で要改善だった p-2/p-3(文字が大きすぎてセルからはみ出る)の再確認のみ。
 * 第5版(v1.5.509・2026-09-13): 第4版の結果で要改善だった p-3(講師名の見切れ)の再確認と、集団行ガイドの空白化 p-12。
 * 第6版(v1.5.512・2026-09-13): 第5版は p-3/p-12 とも OK(Issue #66)だったので載せない。**保護者向け固定QR の第1段**
 *   (開発用教室限定・docs/spec-parent-portal.md)の確認項目だけにした。QR の URL は /p/{トークン} で、
 *   スマホで開いて確認する(講習提出の /s/ とは別物)。**本番教室では QR ボタンが出ないこと**も確認項目に含める。
 * 第7版(v1.5.518・2026-09-14): 第6版の結果で要改善だった k-4(表示は1か月単位・授業のある日だけ・講習期間も具体的に・
 *   教室休みは出す)と k-5(月単位で前後1か月だけ動かす)の再確認のみ。講習は講習提出QRで案内するので、このページは
 *   講習期間中も通常授業だけを出す(オーナー回答 2026-09-14)。教室休みは臨時・祝日休み(休校日)だけを出す。
 * 第8版(v1.5.519・2026-09-14): 第7版は k-5 OK。k-4 は「前の月の出席データが出ず休みの日しか出ない」で要改善 →
 *   実データでは講習だけの月(夏期講習中に入塾した生徒の 8 月)だった。講習コマは出さず注記を出す(オーナー回答)。k-4 の再確認のみ。
 * 第9版(v1.5.521・2026-09-14): 第8版は k-4 OK。これまでの「その他」欄の要望 5 件の確認項目(読み取りツールが「- その他:」行を
 *   落としていたため、v1.5.512/v1.5.518 のその他要望が未対応だった分を含む)。
 * 第10版(v1.5.526・2026-09-14): 第9版は k-10/h-9/b-1 OK。要改善の k-11(休みの日の行が出ない・1行表示)/k-12(QR準備中の表示)の
 *   再確認と、その他要望(通常授業履歴の振替元列を状態欄へまとめる)の h-10。
 */
export const VERIFICATION_CHECKLIST: VerificationChecklistDefinition = {
  version: VERIFICATION_CHECKLIST_VERSION,
  items: [
    {
      id: 'k-11',
      area: '保護者QR',
      title: 'お休みにした日(丸ごと振替・移動を含む)にも行が出て、振替日まで1行に収まる',
      steps: [
        '授業を振替にした生徒の保護者用QRをスマホで開く(例: 日付メニューの丸ごと振替、生徒を別の日へドラッグ移動、休み→振替の配置)',
        '振替元の日に「お休み　9/30 5限に振替」の行が出る',
        '振替先の日に「理　9/23 5限の振替」のように出る(出席にした振替は「出席（9/23 5限の振替）」)',
        '教室休み(臨時・祝日)から振替に回した分は「教室休み　9/28 3限に振替」と出る',
        '振替の補足が2行に折り返さず1行に収まる',
      ],
      introducedIn: 'v1.5.526',
    },
    {
      id: 'k-12',
      area: '保護者QR',
      title: '生徒を追加した直後の QR ボタンが「QR準備中」と回るマーク付きで見える',
      steps: ['基本データで生徒を追加する', 'その生徒の QR ボタンが青い回るマーク＋「QR準備中」になり押せない', '保存が終わると「QR」に戻り、押すと発行できる'],
      introducedIn: 'v1.5.526',
    },
    {
      id: 'h-10',
      area: '日程表',
      title: '通常授業履歴に「振替元」列が無く、状態欄に振替元・振替先・未消化がまとまって出る',
      steps: [
        '生徒日程表で振替のある生徒を選び「通常授業履歴」を開く',
        '表の列は 日付・曜日・時限・種別・科目・状態 だけ(「振替元」列が無い)',
        '休みの行が「休み（振替先 9/30 5限）」、振替が置かれていない休みは「休み（未消化）」',
        '振替の行が「予定（振替元 9/23 5限）」、出席にした振替は「出席（振替元 9/23 5限）」',
        '※ 振替元の限・出席にした振替の振替元は、この版で保存した後の記録から出る(一度「保存」してから開く)',
      ],
      introducedIn: 'v1.5.526',
    },
  ],
}

export type VerificationChecklistEntry = {
  status: VerificationChecklistStatus
  memo: string
}

export type VerificationChecklistDraft = {
  version: string
  entries: Record<string, VerificationChecklistEntry>
  /** 項目に紐づかない自由記入(その他の気づき)。 */
  otherNotes: string
}

/** 下書きの localStorage キー接頭辞。教室別・版別に分ける(他教室の下書きが混ざらない)。 */
export const VERIFICATION_CHECKLIST_STORAGE_PREFIX = 'verification-checklist'
/** 折りたたみ状態のキー(教室をまたいで共通)。 */
export const VERIFICATION_CHECKLIST_COLLAPSED_STORAGE_KEY = `${VERIFICATION_CHECKLIST_STORAGE_PREFIX}:collapsed`

export function verificationChecklistStorageKey(
  classroomId: string | null | undefined,
  version: string = VERIFICATION_CHECKLIST.version,
): string {
  return `${VERIFICATION_CHECKLIST_STORAGE_PREFIX}:${classroomId ?? 'unknown'}:${version}`
}

export function createEmptyVerificationChecklistDraft(
  version: string = VERIFICATION_CHECKLIST.version,
): VerificationChecklistDraft {
  return { version, entries: {}, otherNotes: '' }
}

function normalizeStatus(raw: unknown): VerificationChecklistStatus {
  return typeof raw === 'string' && (VERIFICATION_CHECKLIST_STATUSES as readonly string[]).includes(raw)
    ? (raw as VerificationChecklistStatus)
    : 'unchecked'
}

export function serializeVerificationChecklistDraft(draft: VerificationChecklistDraft): string {
  return JSON.stringify({
    version: draft.version,
    entries: draft.entries,
    otherNotes: draft.otherNotes,
  })
}

/**
 * 保存済み文字列を下書きへ戻す。壊れた JSON・別版・想定外の形はすべて空の下書きとして扱う
 * (下書きが壊れてもパネルが落ちない・本番データには一切影響しない)。
 */
export function parseVerificationChecklistDraft(
  raw: unknown,
  version: string = VERIFICATION_CHECKLIST.version,
): VerificationChecklistDraft {
  const empty = createEmptyVerificationChecklistDraft(version)
  if (typeof raw !== 'string' || !raw.trim()) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
  const candidate = parsed as { version?: unknown; entries?: unknown; otherNotes?: unknown }
  if (typeof candidate.version === 'string' && candidate.version !== version) return empty
  const entries: Record<string, VerificationChecklistEntry> = {}
  if (candidate.entries && typeof candidate.entries === 'object' && !Array.isArray(candidate.entries)) {
    for (const [id, value] of Object.entries(candidate.entries as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as { status?: unknown; memo?: unknown }
      const status = normalizeStatus(entry.status)
      const memo = typeof entry.memo === 'string' ? entry.memo : ''
      if (status === 'unchecked' && !memo) continue
      entries[id] = { status, memo }
    }
  }
  return {
    version,
    entries,
    otherNotes: typeof candidate.otherNotes === 'string' ? candidate.otherNotes : '',
  }
}

/** 1項目を書き換えた新しい下書きを返す(純関数・元は変えない)。 */
export function setVerificationChecklistEntry(
  draft: VerificationChecklistDraft,
  id: string,
  patch: Partial<VerificationChecklistEntry>,
): VerificationChecklistDraft {
  const current = draft.entries[id] ?? { status: 'unchecked' as VerificationChecklistStatus, memo: '' }
  const next: VerificationChecklistEntry = {
    status: patch.status ?? current.status,
    memo: patch.memo ?? current.memo,
  }
  return { ...draft, entries: { ...draft.entries, [id]: next } }
}

/**
 * メモ欄の入力を反映する(純関数)。メモ欄は結果に関わらず常に出すので、**未確認のままメモを書いたら要改善に切り替える**
 * (未確認の行は送信本文に載らない＝書いたメモが黙って捨てられるのを防ぐ・2026-09-13)。OK/要改善はそのまま。
 */
export function setVerificationChecklistMemo(
  draft: VerificationChecklistDraft,
  id: string,
  memo: string,
): VerificationChecklistDraft {
  const current = getVerificationChecklistEntry(draft, id)
  const status: VerificationChecklistStatus = current.status === 'unchecked' && memo.trim() ? 'needs-fix' : current.status
  return setVerificationChecklistEntry(draft, id, { status, memo })
}

export function setVerificationChecklistOtherNotes(
  draft: VerificationChecklistDraft,
  otherNotes: string,
): VerificationChecklistDraft {
  return { ...draft, otherNotes }
}

export function getVerificationChecklistEntry(
  draft: VerificationChecklistDraft,
  id: string,
): VerificationChecklistEntry {
  return draft.entries[id] ?? { status: 'unchecked', memo: '' }
}

export type VerificationChecklistProgress = {
  total: number
  checked: number
  ok: number
  needsFix: number
  remaining: number
}

/** 進捗カウント(折りたたみボタンの「確認リスト n/N」用)。 */
export function countVerificationChecklistProgress(
  draft: VerificationChecklistDraft,
  items: readonly VerificationChecklistItem[] = VERIFICATION_CHECKLIST.items,
): VerificationChecklistProgress {
  let ok = 0
  let needsFix = 0
  for (const item of items) {
    const status = getVerificationChecklistEntry(draft, item.id).status
    if (status === 'ok') ok += 1
    else if (status === 'needs-fix') needsFix += 1
  }
  const checked = ok + needsFix
  return { total: items.length, checked, ok, needsFix, remaining: items.length - checked }
}

/** 送信本文の先頭に必ず付く目印。開発者が受信メールで確認リストだと判別できるようにする。 */
export function buildVerificationChecklistMarker(version: string = VERIFICATION_CHECKLIST.version): string {
  return `[確認リスト ${version}]`
}

function singleLineMemo(memo: string): string {
  return memo.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trim()).filter(Boolean).join(' / ')
}

/** 送信本文の明細行(未確認は省略)。生徒名などは載せない＝項目 id とメモだけ。 */
function buildVerificationChecklistLines(
  draft: VerificationChecklistDraft,
  items: readonly VerificationChecklistItem[],
): string[] {
  const lines: string[] = []
  for (const item of items) {
    const entry = getVerificationChecklistEntry(draft, item.id)
    if (entry.status === 'unchecked') continue
    const memo = singleLineMemo(entry.memo)
    if (entry.status === 'ok') lines.push(memo ? `- ${item.id} OK: ${memo}` : `- ${item.id} OK`)
    else lines.push(memo ? `- ${item.id} 要改善: ${memo}` : `- ${item.id} 要改善`)
  }
  const other = singleLineMemo(draft.otherNotes)
  if (other) lines.push(`- その他: ${other}`)
  return lines
}

function packLines(lines: string[], header: string, limit: number): string[] {
  const budget = limit - header.length - 1
  const parts: string[] = []
  let buffer: string[] = []
  let used = 0
  for (const rawLine of lines) {
    // 1行だけで上限を超える長文メモは、その行を切って必ず収める(送信不能にしない)。
    const line = rawLine.length > budget ? `${rawLine.slice(0, Math.max(0, budget - 1))}…` : rawLine
    const cost = buffer.length === 0 ? line.length : line.length + 1
    if (buffer.length > 0 && used + cost > budget) {
      parts.push(buffer.join('\n'))
      buffer = [line]
      used = line.length
      continue
    }
    buffer.push(line)
    used += cost
  }
  if (buffer.length > 0) parts.push(buffer.join('\n'))
  return parts
}

/**
 * 確認リストを「要望・報告」の本文(複数通)に整形する。
 *  - 先頭行は必ず目印 `[確認リスト <版>]`(分割時は `(1/2)` 等を付ける)。
 *  - 未確認の項目は省略。何も確認していなければ空配列を返す(= 送らない)。
 *  - 1通が DEVELOPER_REPORT_NOTE_LIMIT(2000字)を超えないように分割する。
 */
export function buildVerificationChecklistReportNotes(
  draft: VerificationChecklistDraft,
  options?: { items?: readonly VerificationChecklistItem[]; limit?: number },
): string[] {
  const items = options?.items ?? VERIFICATION_CHECKLIST.items
  const limit = options?.limit ?? DEVELOPER_REPORT_NOTE_LIMIT
  const lines = buildVerificationChecklistLines(draft, items)
  if (lines.length === 0) return []
  const marker = buildVerificationChecklistMarker(draft.version)

  const single = `${marker}\n${lines.join('\n')}`
  if (single.length <= limit) return [single]

  // 分割が必要。通数は「(i/n)」の桁数に依存するので、通数が安定するまで数回試す。
  let total = packLines(lines, `${marker} (1/9)`, limit).length
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const header = `${marker} (1/${total})`
    const parts = packLines(lines, header, limit)
    if (parts.length === total) {
      return parts.map((body, index) => `${marker} (${index + 1}/${total})\n${body}`)
    }
    total = parts.length
  }
  const parts = packLines(lines, `${marker} (1/${total})`, limit)
  return parts.map((body, index) => `${marker} (${index + 1}/${parts.length})\n${body}`)
}

const STATUS_LABELS: Record<VerificationChecklistStatus, string> = {
  unchecked: '未確認',
  ok: 'OK',
  'needs-fix': '要改善',
}

export function verificationChecklistStatusLabel(status: VerificationChecklistStatus): string {
  return STATUS_LABELS[status]
}

/** クリップボード用の Markdown(送信できないときの保険)。未確認も含めて全項目を出す。 */
export function buildVerificationChecklistMarkdown(
  draft: VerificationChecklistDraft,
  items: readonly VerificationChecklistItem[] = VERIFICATION_CHECKLIST.items,
): string {
  const progress = countVerificationChecklistProgress(draft, items)
  const lines: string[] = [
    `# ${buildVerificationChecklistMarker(draft.version)}`,
    `確認 ${progress.checked}/${progress.total}(OK ${progress.ok} / 要改善 ${progress.needsFix})`,
    '',
  ]
  let currentArea = ''
  for (const item of items) {
    if (item.area !== currentArea) {
      currentArea = item.area
      lines.push(`## ${currentArea}`)
    }
    const entry = getVerificationChecklistEntry(draft, item.id)
    const box = entry.status === 'ok' ? 'x' : ' '
    lines.push(`- [${box}] ${item.id} ${item.title} — ${verificationChecklistStatusLabel(entry.status)}`)
    const memo = singleLineMemo(entry.memo)
    if (memo) lines.push(`  - メモ: ${memo}`)
  }
  const other = singleLineMemo(draft.otherNotes)
  if (other) {
    lines.push('')
    lines.push('## その他の気づき')
    lines.push(`- ${other}`)
  }
  return lines.join('\n')
}
