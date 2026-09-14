// 基本データ画面の「保護者用QR」(spec-parent-portal.md §K-6 / P-7)の純ロジック。
//
// deleteGuard.ts と同じ流儀で、モーダルの表示判断・印刷 HTML を React から切り離してテストする。
// - 行ボタンの表示可否: 在籍中(isActiveOnDate=盤面・サーバーと同じ判定)の生徒にだけ出す。
//   基本データのタブ判定 resolveManagedRosterStatus(入塾日不問)は使わない(§F: 判定の分散を作らない)。
// - 発行元教室の一致判定は developmentClassroom.ts の権威関数に委ね、ここで再実装しない(§B-3)。
// - 印刷は 1 生徒 1 枚(生徒名・教室名・QR・短い案内文)。盤面/日程表の印刷レイアウトには触れない。

import { isActiveOnDate, type StudentRow } from './basicDataModel'
import { isParentPortalTokenOwnedByClassroom } from '../../utils/developmentClassroom'

export type ParentPortalQrRowState = 'hidden' | 'issue' | 'show' | 'pending-save'

export const PARENT_PORTAL_QR_TEXT = {
  title: '保護者用QR',
  buttonLabel: 'QR',
  guidance: 'このQRコードを読み取ると、お子さまの授業予定の確認と教室への連絡ができます。',
  caution: 'QRコードは第三者に見せないでください。紛失した場合は教室へご連絡ください（再発行できます）。',
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

// 1 生徒 1 枚の印刷 HTML(groupAttendanceHtml と同じ「印刷ボタン＋@media print で非表示」方式)。
// svg は generateQrSvg が生成した信頼できる文字列なのでそのまま埋め込む。URL・名前はエスケープする。
export function buildParentPortalQrPrintHtml(params: { classroomName: string; studentName: string; url: string; svg: string }): string {
  const classroomName = escapeHtml(params.classroomName.trim() || '教室')
  const studentName = escapeHtml(params.studentName.trim() || '生徒')
  const url = escapeHtml(params.url)
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${PARENT_PORTAL_QR_TEXT.title} ${studentName}</title>
<style>
  @page { size: A4 portrait; margin: 18mm; }
  body { font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif; color: #111; margin: 0; padding: 24px; }
  .card { max-width: 420px; margin: 0 auto; border: 1px solid #999; border-radius: 12px; padding: 24px; text-align: center; }
  .classroom { font-size: 16px; font-weight: 700; color: #1f5d96; margin-bottom: 6px; }
  .title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .student { font-size: 20px; font-weight: 700; margin-bottom: 16px; }
  .qr { display: inline-block; padding: 10px; border: 1px solid #ccc; border-radius: 8px; background: #fff; }
  .qr svg { display: block; width: 220px; height: 220px; }
  .url { margin-top: 12px; font-size: 11px; color: #444; word-break: break-all; }
  .guidance { margin-top: 16px; font-size: 13px; line-height: 1.6; text-align: left; }
  .caution { margin-top: 8px; font-size: 12px; color: #7a2e2e; line-height: 1.6; text-align: left; }
  .print-button { display: block; margin: 0 auto 16px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  @media print { .print-button { display: none; } body { padding: 0; } .card { border-color: #666; } }
</style>
</head>
<body>
<button class="print-button" onclick="window.print()">印刷</button>
<div class="card">
  <div class="classroom">${classroomName}</div>
  <div class="title">${PARENT_PORTAL_QR_TEXT.title}</div>
  <div class="student">${studentName} さん</div>
  <div class="qr">${params.svg}</div>
  <div class="url">${url}</div>
  <p class="guidance">${escapeHtml(PARENT_PORTAL_QR_TEXT.guidance)}</p>
  <p class="caution">${escapeHtml(PARENT_PORTAL_QR_TEXT.caution)}</p>
</div>
</body>
</html>`
}

// 別ウィンドウで印刷用 HTML を開く(副作用・テスト対象外。openGroupAttendancePrint と同型)。
export function openParentPortalQrPrint(html: string): boolean {
  if (typeof window === 'undefined') return false
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
  return true
}
