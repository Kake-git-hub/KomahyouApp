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
export const VERIFICATION_CHECKLIST_VERSION = 'v1.5.502'

/**
 * 確認項目の正本(2026-09-12 初版)。
 * U-0(戻す/やり直しの保存) / 盤面PDFコマ選択 / 講習履歴 の3領域。
 */
export const VERIFICATION_CHECKLIST: VerificationChecklistDefinition = {
  version: VERIFICATION_CHECKLIST_VERSION,
  items: [
    {
      id: 'u0-1',
      area: '盤面',
      title: '「戻す」の結果が保存できる',
      steps: [
        '盤面で何か編集する',
        '「戻す」を押す',
        '保存ボタンが青(保存)になる',
        '保存してリロードし、戻した状態が残っている',
      ],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'u0-2',
      area: '盤面',
      title: '「やり直し」でも同じ',
      steps: ['「やり直し」を押す', '保存ボタンが青になる', '保存してリロードし、やり直した状態が残っている'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'u0-3',
      area: '盤面',
      title: 'テンプレ上書き後の一段復元が保存できる',
      steps: [
        'テンプレを上書き保存する',
        '黄色バナーの「戻す」を押す',
        '保存ボタンが青になる',
        '保存してリロードし、復元結果が残っている',
      ],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'u0-4',
      area: '盤面',
      title: '直後に別教室を開いても未保存表示にならない',
      steps: ['上の操作の直後に別教室を開く', 'その教室が未保存表示にならない', '勝手に保存されない'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'u0-5',
      area: '盤面',
      title: '丸ごと振替の選択中に「戻す」で選択が解除される',
      steps: ['丸ごと振替の振替元を選択する', '「戻す」を押す', '選択バナーが消える'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'p-1',
      area: 'PDF',
      title: '全選択の出力が従来と同じ',
      steps: ['「PDF出力」でモーダルが出る', '全選択のまま出力する', '従来と同じ PDF になる'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'p-2',
      area: 'PDF',
      title: '曜日を絞ると A3 縦いっぱいに拡大される',
      steps: ['曜日を1〜2日に絞って出力する', '文字が読める大きさに拡大される', '太りすぎ・崩れがない'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'p-3',
      area: 'PDF',
      title: '時限を絞っても時限ラベルが正しい行に残る',
      steps: ['時限だけ絞って出力する', '時限ラベルが対応する行に付いている'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'p-4',
      area: 'PDF',
      title: '特別講習の帯が切れた週でも正しい幅で出る',
      steps: ['特別講習期間を含む週で列を絞って出力する', '講習の帯が正しい幅で出る'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'p-5',
      area: 'PDF',
      title: 'とびとび選択の空白コマは枠だけ残る',
      steps: ['とびとびに選択して出力する', '空白コマは枠が残り中身だけ空になる', '黄色警告が残らない'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'p-6',
      area: 'PDF',
      title: '集団授業2行がある週で列を絞った見え方',
      steps: ['集団授業2行がある週で列を絞って出力する', '集団授業の行が崩れない'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'p-7',
      area: 'PDF',
      title: '疎な選択でも白紙にならない',
      steps: ['対角5コマなど疎に選択して出力する', 'PDF が白紙にならない'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'h-1',
      area: '日程表',
      title: '「講習履歴」ボタンの位置',
      steps: ['生徒日程表タブで「講習集計結果」の左に「講習履歴」が出る', '講師日程表には出ない'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'h-2',
      area: '日程表',
      title: '既定期間(1年)の表と集計が出る',
      steps: ['生徒を選んで「講習履歴」を開く', '既定期間(1年)の表と集計が出る'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'h-3',
      area: '日程表',
      title: '2年を指定すると丸めの注記が出る',
      steps: ['期間を2年にする', '「1年分に丸めました」相当の注記が出る'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'h-4',
      area: '日程表',
      title: '種別チェックで行と集計が連動する',
      steps: ['種別チェックを OFF にする', '行と集計の両方が連動して変わる', 'ON に戻すと元に戻る'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'h-5',
      area: '日程表',
      title: '印刷ができる',
      steps: ['印刷ボタンを押す', '印刷ダイアログが開く'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'h-6',
      area: '日程表',
      title: '未保存の編集は反映されない注記が出る',
      steps: ['未保存の編集がある状態で開く', '「保存済みの記録のみ」と分かる注記が出る'],
      introducedIn: 'v1.5.502',
    },
    {
      id: 'h-7',
      area: '日程表',
      title: '本体タブが閉じているときの案内',
      steps: ['本体タブを閉じた状態でボタンを押す', '案内が出る(無反応にならない)'],
      introducedIn: 'v1.5.502',
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
