// 基本データ画面の「保護者用QR」(spec-parent-portal.md §K-6 / P-7)の純ロジック。
//
// deleteGuard.ts と同じ流儀で、モーダルの表示判断・印刷 HTML を React から切り離してテストする。
// - 行ボタンの表示可否: 在籍中(isActiveOnDate=盤面・サーバーと同じ判定)の生徒にだけ出す。
//   基本データのタブ判定 resolveManagedRosterStatus(入塾日不問)は使わない(§F: 判定の分散を作らない)。
// - 発行元教室の一致判定は developmentClassroom.ts の権威関数に委ね、ここで再実装しない(§B-3)。
// - 印刷は 1 生徒 1 枚。A4 の左上に名刺サイズ(91×55mm)で、右に QR・左にロゴ・連絡先・生徒名・発行日・注意書き
//   (2026-11-03 フリーメモ 20261103-152520476-06446053)。盤面/日程表の印刷レイアウトには触れない。
//   URL 文字列は紙に印字しない(QR だけで足りる・2026-10-10 文言整理)。画面のモーダルには引き続き URL を出す。

import { isActiveOnDate, isStudentDeletedFromApp, type StudentRow } from './basicDataModel'
import { isParentPortalTokenOwnedByClassroom } from '../../utils/developmentClassroom'

export type ParentPortalQrRowState = 'hidden' | 'issue' | 'show' | 'pending-save'

export const PARENT_PORTAL_QR_TEXT = {
  title: '保護者用QR',
  buttonLabel: 'QR',
  // 2026-09-18: 自由記述の連絡は廃止し、できるのは「授業の行をタップして休みを連絡する」だけ(spec-parent-portal §0-5)。
  guidance: 'このQRから、お子さまの授業予定の確認とお休みの連絡ができます。',
  caution: 'ほかの方に見せないでください。紛失したときは教室へご連絡ください（再発行します）。',
  issued: '保護者用QRを発行しました。忘れずに保存してください。',
  /** 権威トークンの確認に失敗したとき(写しで描けている場合)の注意文。印刷を止めるため文言を分けている。 */
  verifyFailed: '最新のQRか確認できませんでした。この場で印刷せず、通信状態を確認してから開き直してください。',
  reissueConfirm: '保護者用QRを再発行します。今までのQRコードは使えなくなります。よろしいですか？',
  reissued: '保護者用QRを再発行しました。忘れずに保存し、新しいQRを配布してください。',
  issueFailed: '保護者用QRの発行に失敗しました。',
  urlUnavailable: '保護者用URLを作成できません。',
  printBlocked: '印刷ウィンドウを開けませんでした。ポップアップのブロックを解除してください。',
  /** 追加したばかりでまだ保存されていない生徒(サーバーの名簿に居ないので発行できない)。 */
  pendingSave: 'データの保存が終わるとQRを発行できます。',
  /** 保存待ちのあいだボタンに出す文言(確認リスト k-12 2026-09-14「スピナーだけでは見えにくい」)。 */
  pendingLabel: 'QR準備中',
  /** 全員分印刷(spec-parent-portal §K-6・オーナー指示 2026-11-14)。 */
  bulkPrintLabel: '全員分印刷',
  bulkPendingSave: '保存が終わると全員分を印刷できます',
  bulkNoTargets: '在籍中の生徒がいません',
  bulkConfirmButton: '印刷する',
  bulkCancelButton: 'やめる',
  bulkPlaceholder: '作成中…',
  bulkWindowClosed: '印刷の画面が閉じられたため、印刷していません。もう一度「全員分印刷」を押してください。',
  bulkFailed: '保護者用QRの全員分印刷に失敗しました。',
} as const

// 行操作に「QR」ボタンを出すか。
//   hidden: フラグ OFF／リモート(Cloud Functions)無し／非在籍(入塾前・退塾後・高3卒業後)
//   show  : 発行元教室が一致する写しトークンがある(押すと表示)
//   issue : 未発行 or 他教室のトークン(押すと getOrIssue で発行して表示)
//   pending-save: 発行が要るが、その生徒がまだ保存済みデータに居ない(押せない・保存中のスピナーを出す)
//     ★ 確認リスト その他(2026-09-13): 生徒を追加してすぐ押すと、サーバーの名簿(保存済みスナップショット)に
//       まだ居ないので発行が失敗していた(requireParentPortalStudentExists)。保存が終わるまで待たせる。
//       savedStudentIds が null(保存状態が未確定)のときは従来どおり判定しない。
export function resolveParentPortalQrRowState(params: {
  student: StudentRow
  referenceDate: string
  enabled: boolean
  remoteEnabled: boolean
  classroomId?: string | null
  savedStudentIds?: ReadonlySet<string> | null
}): ParentPortalQrRowState {
  const { student, referenceDate, enabled, remoteEnabled, classroomId, savedStudentIds } = params
  if (!enabled || !remoteEnabled) return 'hidden'
  if (!isActiveOnDate(student.entryDate, student.withdrawDate, student.birthDate, referenceDate)) return 'hidden'
  const needsIssue = !student.parentPortalToken || Boolean(classroomId && !isParentPortalTokenOwnedByClassroom(student, classroomId))
  if (!needsIssue) return 'show'
  if (savedStudentIds && !savedStudentIds.has(student.id)) return 'pending-save'
  return 'issue'
}

// 全員分印刷の対象と押せるか(spec-parent-portal §K-6「全員分印刷（オーナー指示 2026-11-14）」)。
// 対象 = 行の QR ボタンが出る生徒(resolveParentPortalQrRowState が hidden 以外)。判定を分散させないため必ずこれを通す。
// 並びは渡された students の順(画面からは行の QR ボタンと同じ在籍一覧 activeStudentRows＝学年→名前順を渡す)。
// 削除済み(deletedAt)の生徒は一覧に出ないので、ここでも外す(守りを厚く)。
// 保存待ち(pending-save)の生徒が 1 人でもいれば押せない(オーナー回答 2026-11-14)。
export function resolveBulkParentPortalQrPlan(params: {
  students: readonly StudentRow[]
  referenceDate: string
  enabled: boolean
  remoteEnabled: boolean
  classroomId?: string | null
  savedStudentIds?: ReadonlySet<string> | null
}): { targets: StudentRow[]; issueCount: number; pendingSaveStudents: StudentRow[]; canPrint: boolean } {
  const { students, ...rest } = params
  const targets: StudentRow[] = []
  const pendingSaveStudents: StudentRow[] = []
  let issueCount = 0
  for (const student of students) {
    if (isStudentDeletedFromApp(student)) continue
    const state = resolveParentPortalQrRowState({ ...rest, student })
    if (state === 'hidden') continue
    targets.push(student)
    if (state === 'issue') issueCount += 1
    if (state === 'pending-save') pendingSaveStudents.push(student)
  }
  return { targets, issueCount, pendingSaveStudents, canPrint: targets.length > 0 && pendingSaveStudents.length === 0 }
}

export function buildParentPortalQrBulkConfirmMessage(params: { total: number; issueCount: number }): string {
  const base = `在籍${params.total}人分を印刷します`
  return params.issueCount > 0 ? `${base}（未発行の${params.issueCount}人は新しく発行します）` : base
}

export function buildParentPortalQrBulkProgressLabel(done: number, total: number): string {
  return `作成中 ${done}/${total}`
}

// 全員分の権威トークンを getOrIssue(reissue:false・冪等)で確かめる。再発行はしない(1 人分と同じ理由で写しは信用しない)。
// 同時に投げる数は小さく抑える(既定 4)。1 人の失敗で止めず、成功・失敗を名簿の順に分けて返す。
// shouldContinue が false になったら(モーダルを閉じた・画面を離れた・教室が変わった・INV-08)次の生徒を投げず cancelled を返す。
export async function issueParentPortalTokensForBulkPrint(params: {
  targets: readonly StudentRow[]
  issue: (studentId: string, options: { reissue: boolean }) => Promise<{ token: string }>
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  shouldContinue?: () => boolean
}): Promise<{ succeeded: Array<{ student: StudentRow; token: string }>; failed: Array<{ student: StudentRow; error: unknown }>; cancelled: boolean }> {
  const { targets, issue, onProgress } = params
  const shouldContinue = params.shouldContinue ?? (() => true)
  const concurrency = Math.max(1, Math.floor(params.concurrency ?? 4))
  const outcomes: Array<{ token: string } | { error: unknown } | undefined> = new Array(targets.length)
  let nextIndex = 0
  let done = 0
  let cancelled = false
  const worker = async () => {
    while (nextIndex < targets.length) {
      if (cancelled || !shouldContinue()) { cancelled = true; return }
      const index = nextIndex
      nextIndex += 1
      try {
        const { token } = await issue(targets[index].id, { reissue: false })
        outcomes[index] = token ? { token } : { error: new Error('empty token') }
      } catch (error) {
        outcomes[index] = { error }
      }
      if (cancelled || !shouldContinue()) { cancelled = true; return }
      done += 1
      onProgress?.(done, targets.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()))
  const succeeded: Array<{ student: StudentRow; token: string }> = []
  const failed: Array<{ student: StudentRow; error: unknown }> = []
  targets.forEach((student, index) => {
    const outcome = outcomes[index]
    if (!outcome) return
    if ('token' in outcome) succeeded.push({ student, token: outcome.token })
    else failed.push({ student, error: outcome.error })
  })
  return { succeeded, failed, cancelled }
}

export type ParentPortalQrBulkPrintWindow = {
  closed: boolean
  close: () => void
  document: { open: () => unknown; write: (html: string) => unknown; close: () => unknown }
}

export type ParentPortalQrBulkRunOutcome = 'printed' | 'all-failed' | 'window-closed' | 'cancelled' | 'error'

// 開いた直後の印刷ウィンドウに出す仮の中身(通信のあいだ白紙にしない)。
export function buildParentPortalQrBulkPlaceholderHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${PARENT_PORTAL_QR_TEXT.title} 全員分</title>
</head>
<body>
<p>${PARENT_PORTAL_QR_TEXT.bulkPlaceholder}</p>
</body>
</html>`
}

// 全員分印刷の本体(画面の状態から切り離した純粋な非同期関数・依存は引数で受ける)。
// 順番: 仮の中身を書く → 全員を getOrIssue → (続けてよければ)写しを反映 → 印刷の HTML を書く。
// ★ 例外は投げ返さず outcome:'error' で返す(呼び出し側の finally と二重に守り、モーダルが閉じられなくならないように)。
// ★ 続けてはいけなくなったら(INV-08)写しも反映せずウィンドウを閉じる。開き直した別の教室の名簿へ書き込まない。
// ★ 書く直前にウィンドウが閉じられていないかを確かめる(閉じられていたら書かずに案内)。
// 失敗した生徒の名前は終わった順ではなく targets(名簿)の順に並べる。
export async function runParentPortalQrBulkPrint(params: {
  targets: readonly StudentRow[]
  classroomId: string
  printWindow: ParentPortalQrBulkPrintWindow
  issue: (studentId: string, options: { reissue: boolean }) => Promise<{ token: string }>
  shouldContinue: () => boolean
  getStudentName: (student: StudentRow) => string
  buildQrSvg: (token: string) => string | null
  buildHtml: (cards: Array<{ studentName: string; svg: string }>) => string
  applyToken: (studentId: string, token: string) => void
  onProgress?: (done: number, total: number) => void
  concurrency?: number
}): Promise<{ outcome: ParentPortalQrBulkRunOutcome; message: string }> {
  const { targets, classroomId, printWindow } = params
  const closeWindow = () => {
    try { if (!printWindow.closed) printWindow.close() } catch { /* 閉じられなくても続ける */ }
  }
  try {
    writeParentPortalQrPrintWindow(printWindow, buildParentPortalQrBulkPlaceholderHtml())
    const { succeeded, failed, cancelled } = await issueParentPortalTokensForBulkPrint({
      targets,
      issue: params.issue,
      concurrency: params.concurrency,
      onProgress: params.onProgress,
      shouldContinue: params.shouldContinue,
    })
    if (cancelled || !params.shouldContinue()) {
      closeWindow()
      return { outcome: 'cancelled', message: '' }
    }
    const failedIds = new Set(failed.map(({ student }) => student.id))
    const cardsById = new Map<string, { studentName: string; svg: string }>()
    let tokensChanged = false
    for (const { student, token } of succeeded) {
      // 写しが違えば 1 人分(openParentPortalQr)と同じく写しへ反映する。保存は手動(保存アーキテクチャ)。
      if (token !== student.parentPortalToken || student.parentPortalTokenClassroomId !== classroomId) {
        params.applyToken(student.id, token)
        tokensChanged = true
      }
      const svg = params.buildQrSvg(token)
      if (svg) cardsById.set(student.id, { studentName: params.getStudentName(student), svg })
      else failedIds.add(student.id)
    }
    const failedNames = targets.filter((student) => failedIds.has(student.id)).map(params.getStudentName)
    const cards = targets.flatMap((student) => {
      const card = cardsById.get(student.id)
      return card ? [card] : []
    })
    if (cards.length === 0) {
      closeWindow()
      return { outcome: 'all-failed', message: buildParentPortalQrBulkResultMessage({ failedNames, tokensChanged, allFailed: true }) }
    }
    if (printWindow.closed) {
      const message = [PARENT_PORTAL_QR_TEXT.bulkWindowClosed, tokensChanged ? PARENT_PORTAL_QR_TEXT.issued : ''].filter(Boolean).join(' ')
      return { outcome: 'window-closed', message }
    }
    writeParentPortalQrPrintWindow(printWindow, params.buildHtml(cards))
    return { outcome: 'printed', message: buildParentPortalQrBulkResultMessage({ failedNames, tokensChanged, allFailed: false }) }
  } catch (error) {
    closeWindow()
    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
    return { outcome: 'error', message: `${PARENT_PORTAL_QR_TEXT.bulkFailed}${detail}` }
  }
}

// 全員分印刷のあとに出す文言。失敗した生徒の名前を出し、全員失敗なら印刷していないと伝える。
// 写しトークンが新しく入った/変わったら 1 人分と同じ「忘れずに保存してください」を添える。
export function buildParentPortalQrBulkResultMessage(params: { failedNames: readonly string[]; tokensChanged: boolean; allFailed: boolean }): string {
  const parts: string[] = []
  const names = params.failedNames.join('、')
  if (params.allFailed) {
    parts.push(`保護者用QRを作成できなかったため、印刷していません。通信状態を確認してからやり直してください。${names ? `（${names}）` : ''}`)
  } else if (names) {
    parts.push(`次の生徒の保護者用QRを作成できなかったため、印刷に含めていません: ${names}`)
  }
  if (params.tokensChanged) parts.push(PARENT_PORTAL_QR_TEXT.issued)
  return parts.join(' ')
}

// 保存済みデータに含まれる生徒 id。未保存の変更が無い(データ署名 = 保存済み署名)ときだけ現在の名簿から作り直し、
// 未保存の変更があるあいだは直前の保存済み集合を保つ(追加したばかりの生徒を含めない)。
// 読み込み前(hydrated=false)は null(=判定しない)。前回と同じ中身なら同じ参照を返す(再描画を増やさない)。
export function resolveSavedStudentIds(params: {
  hydrated: boolean
  isClean: boolean
  students: readonly Pick<StudentRow, 'id'>[]
  previous: ReadonlySet<string> | null
}): ReadonlySet<string> | null {
  if (!params.hydrated) return null
  if (!params.isClean) return params.previous
  const next = new Set(params.students.map((student) => student.id))
  const previous = params.previous
  if (previous && previous.size === next.size && [...next].every((id) => previous.has(id))) return previous
  return next
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 名刺の左側に載せるロゴと連絡先(フリーメモ 20261103-152520476-06446053「生徒日程表で保存したロゴ、連絡先」)。
// 生徒日程表(scheduleHtml.ts)はロゴと「校舎名・TEL等」欄を、開いた元のコマ表タブの localStorage へ
// `schedule-shared:<教室ID>:global:logo` / `...:global:school-info` で保存する(STORAGE_SCOPE = encodeURIComponent(教室ID))。
// 同じ鍵を読むだけで、ここからは書かない。ロゴが無ければ会社の既定ロゴ(生徒日程表と同じ補完)、連絡先が空なら教室名。
export function buildScheduleSharedGlobalStorageKey(classroomId: string | null | undefined, sharedKey: 'logo' | 'school-info'): string {
  return `schedule-shared:${encodeURIComponent(String(classroomId || 'default'))}:global:${sharedKey}`
}

export function readParentPortalCardBranding(params: {
  storage: Pick<Storage, 'getItem'> | null | undefined
  classroomId: string | null | undefined
  defaultLogoUrl?: string
}): { logoSrc: string; contactText: string } {
  const read = (sharedKey: 'logo' | 'school-info') => {
    try {
      return params.storage?.getItem(buildScheduleSharedGlobalStorageKey(params.classroomId, sharedKey)) ?? ''
    } catch {
      return ''
    }
  }
  return {
    logoSrc: read('logo') || params.defaultLogoUrl || '',
    contactText: read('school-info'),
  }
}

// 画像として埋め込んでよい src だけを通す(生徒日程表で選んだ画像の data URL・会社の既定ロゴの URL)。
function sanitizeLogoSrc(value: string | undefined): string {
  const src = (value ?? '').trim()
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(src)) return src
  if (/^(https:\/\/|\/)[^\s"'<>]*$/u.test(src)) return src
  return ''
}

// 発行日(印刷した日)を「2026年11月3日」の形で出す。dateKey は YYYY-MM-DD。
export function formatParentPortalCardIssuedDate(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey.trim())
  if (!match) return ''
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
}

export const PARENT_PORTAL_CARD_SIZE_MM = { width: 91, height: 55 } as const

type ParentPortalCardBrandingParams = {
  classroomName: string
  logoSrc?: string
  contactText?: string
  issuedDateKey?: string
}

// 名刺 1 枚分(<div class="card">…</div>)。1 人分の印刷と全員分印刷で同じものを使う(2026-11-14 全員分印刷)。
// ★ 1 人分の出力 HTML を変えないよう、元の buildParentPortalQrPrintHtml の文字列をそのまま切り出している。
function buildParentPortalCardHtml(params: ParentPortalCardBrandingParams & { studentName: string; svg: string }): string {
  const classroomName = escapeHtml(params.classroomName.trim() || '教室')
  const studentName = escapeHtml(params.studentName.trim() || '生徒')
  const contactLines = (params.contactText ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const contactHtml = contactLines.length > 0 ? contactLines.map(escapeHtml).join('<br>') : classroomName
  const logoSrc = sanitizeLogoSrc(params.logoSrc)
  const logoHtml = logoSrc ? `<div class="logo"><img src="${escapeHtml(logoSrc)}" alt=""></div>` : ''
  const issuedDate = formatParentPortalCardIssuedDate(params.issuedDateKey ?? '')
  const issuedHtml = issuedDate ? `<div class="issued">発行日 ${escapeHtml(issuedDate)}</div>` : ''
  return `<div class="card">
  <div class="info">
    ${logoHtml}
    <div class="contact">${contactHtml}</div>
    <div class="student">${studentName} さん</div>
    ${issuedHtml}
    <div class="notes">
      <p class="guidance">${escapeHtml(PARENT_PORTAL_QR_TEXT.guidance)}</p>
      <p class="caution">${escapeHtml(PARENT_PORTAL_QR_TEXT.caution)}</p>
    </div>
  </div>
  <div class="qr-side">
    <div class="qr">${params.svg}</div>
    <div class="qr-label">${PARENT_PORTAL_QR_TEXT.title}</div>
  </div>
</div>`
}

// 名刺の CSS(1 人分と全員分で共有)。@media print の行は呼び出し側で足す(全員分はページの余白も消すため)。
function buildParentPortalCardCss(): string {
  const { width, height } = PARENT_PORTAL_CARD_SIZE_MM
  return `  @page { size: A4 portrait; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif; color: #111; margin: 0; padding: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card { width: ${width}mm; height: ${height}mm; border: 0.3mm dashed #888; padding: 3.5mm; display: flex; gap: 3mm; overflow: hidden; background: #fff; }
  .info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1mm; }
  .logo img { display: block; max-width: 40mm; max-height: 9mm; object-fit: contain; }
  .contact { font-size: 6.5pt; line-height: 1.35; color: #333; }
  .student { font-size: 11pt; font-weight: 700; margin-top: 0.5mm; }
  .issued { font-size: 6pt; color: #555; }
  .notes { margin-top: auto; font-size: 5.5pt; line-height: 1.4; color: #333; }
  .notes p { margin: 0; }
  .notes .caution { color: #7a2e2e; }
  .qr-side { flex: 0 0 31mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1mm; }
  .qr svg { display: block; width: 31mm; height: 31mm; }
  .qr-label { font-size: 6pt; font-weight: 700; color: #1f5d96; }
  .print-button { display: block; margin: 0 0 8px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  .print-hint { margin: 0 0 12px; font-size: 13px; color: #555; }
`
}

function buildParentPortalPrintControlsHtml(): string {
  const { width, height } = PARENT_PORTAL_CARD_SIZE_MM
  return `<button class="print-button" onclick="window.print()">印刷</button>
<p class="print-hint">A4 用紙の左上に名刺サイズ(${width}×${height}mm)で印刷します。点線で切り取ってください。印刷の設定は「倍率 100%(実際のサイズ)」にしてください。</p>`
}

// 印刷 HTML(groupAttendanceHtml と同じ「印刷ボタン＋@media print で非表示」方式)。
// ★ 2026-11-03 フリーメモ 20261103-152520476-06446053: A4 の中に名刺サイズ(91×55mm・点線で切り取る)で 1 生徒 1 枚。
//   QR は右、左にロゴ・連絡先・生徒名・発行日・注意書き(案内文＋注意文)。
// svg は generateQrSvg が生成した信頼できる文字列なのでそのまま埋め込む。名前・連絡先はエスケープする。
// url は呼び出し側の互換のため受け取るが、紙には印字しない(QR だけで足りる・2026-10-10 文言整理)。
export function buildParentPortalQrPrintHtml(params: {
  classroomName: string
  studentName: string
  url: string
  svg: string
  logoSrc?: string
  contactText?: string
  issuedDateKey?: string
}): string {
  const studentName = escapeHtml(params.studentName.trim() || '生徒')
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${PARENT_PORTAL_QR_TEXT.title} ${studentName}</title>
<style>
${buildParentPortalCardCss()}  @media print { .print-button, .print-hint { display: none; } body { padding: 0; } }
</style>
</head>
<body>
${buildParentPortalPrintControlsHtml()}
${buildParentPortalCardHtml(params)}
</body>
</html>`
}

// 全員分印刷(spec-parent-portal §K-6「全員分印刷（オーナー指示 2026-11-14）」)。1 生徒 A4 1 枚。
// 各ページの名刺は 1 人分の印刷と同じ(CSS・ロゴ・連絡先・発行日を共有)。最後のページ以外だけ改ページする
// (最後に改ページすると白紙が 1 枚出る)。
export function buildParentPortalQrBulkPrintHtml(params: ParentPortalCardBrandingParams & {
  cards: ReadonlyArray<{ studentName: string; svg: string }>
}): string {
  const { cards, ...branding } = params
  const pages = cards.map((card, index) => {
    const className = index < cards.length - 1 ? 'page page-break' : 'page'
    return `<section class="${className}">
${buildParentPortalCardHtml({ ...branding, studentName: card.studentName, svg: card.svg })}
</section>`
  }).join('\n')
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${PARENT_PORTAL_QR_TEXT.title} 全員分（${cards.length}人）</title>
<style>
${buildParentPortalCardCss()}  .page + .page { margin-top: 16px; }
  .page-break { break-after: page; page-break-after: always; }
  @media print { .print-button, .print-hint { display: none; } body { padding: 0; } .page + .page { margin-top: 0; } }
</style>
</head>
<body>
${buildParentPortalPrintControlsHtml()}
${pages}
</body>
</html>`
}

// 別ウィンドウで印刷用 HTML を開く(副作用・テスト対象外。openGroupAttendancePrint と同型)。
export function openParentPortalQrPrint(html: string): boolean {
  const printWindow = openBlankParentPortalQrPrintWindow()
  if (!printWindow) return false
  writeParentPortalQrPrintWindow(printWindow, html)
  return true
}

// 全員分印刷は通信(発行)を待つあいだにユーザー操作の扱いが切れてポップアップが止められるので、
// 押した直後に空のウィンドウを開いておき、準備ができてから中身を書く(副作用・テスト対象外)。
export function openBlankParentPortalQrPrintWindow(): Window | null {
  if (typeof window === 'undefined') return null
  return window.open('', '_blank')
}

export function writeParentPortalQrPrintWindow(printWindow: { document: { open: () => unknown; write: (html: string) => unknown; close: () => unknown } }, html: string): void {
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}
