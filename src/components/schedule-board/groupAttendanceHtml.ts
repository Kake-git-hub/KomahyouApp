// spec-group-lesson §B: 集団授業「出席者一覧」の印刷用HTML（別ウィンドウで印刷＝PDF化）。
// ヘッダ（教室名・日付・時間帯・科目・担当講師）＋出欠一覧＋末尾に人数集計。

export type GroupAttendancePrintAttendee = {
  name: string
  present: boolean
}

export type GroupAttendancePrintParams = {
  schoolName?: string
  dateLabel: string
  bandTimeLabel: string
  subject: string
  teacherName?: string
  attendees: GroupAttendancePrintAttendee[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// A4縦1枚に最大50名を収めるため、26名以上は2列に分割する（1列あたり最大25名）。
// 通し番号は分割をまたいで連続させる。
const ATTENDEES_PER_COLUMN = 25

function buildAttendeeRow(attendee: GroupAttendancePrintAttendee, displayIndex: number): string {
  const statusLabel = attendee.present ? '出席' : '欠席'
  const statusClass = attendee.present ? 'present' : 'absent'
  // 最右の「チェック欄」は印刷後の手書きチェック用に常に空欄。
  return `<tr><td class="num">${displayIndex}</td><td class="name">${escapeHtml(attendee.name)}</td><td class="status ${statusClass}">${statusLabel}</td><td class="check"></td></tr>`
}

function buildRosterTable(rowsHtml: string): string {
  return `<table>
<thead><tr><th class="num">#</th><th class="name">氏名</th><th class="status">出欠</th><th class="check">チェック欄</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>`
}

export function buildGroupAttendanceHtml(params: GroupAttendancePrintParams): string {
  const presentCount = params.attendees.filter((attendee) => attendee.present).length
  const absentCount = params.attendees.length - presentCount

  // 出席者を最大25名ずつの列に分割（最大50名=2列でA4縦1枚に収める）。
  const columnCount = Math.max(1, Math.ceil(params.attendees.length / ATTENDEES_PER_COLUMN))
  const perColumn = Math.ceil(params.attendees.length / columnCount)

  const rosterHtml = params.attendees.length > 0
    ? Array.from({ length: columnCount }, (_, columnIndex) => {
        const start = columnIndex * perColumn
        const slice = params.attendees.slice(start, start + perColumn)
        const rowsHtml = slice
          .map((attendee, sliceIndex) => buildAttendeeRow(attendee, start + sliceIndex + 1))
          .join('')
        return `<div class="roster-col">${buildRosterTable(rowsHtml)}</div>`
      }).join('')
    : `<div class="roster-col">${buildRosterTable('<tr><td class="empty" colspan="4">出席者がいません</td></tr>')}</div>`

  const headerRows = [
    params.schoolName ? `<div><span class="label">教室</span>${escapeHtml(params.schoolName)}</div>` : '',
    `<div><span class="label">日付</span>${escapeHtml(params.dateLabel)}</div>`,
    `<div><span class="label">時間帯</span>集団 ${escapeHtml(params.bandTimeLabel)}</div>`,
    `<div><span class="label">科目</span>${escapeHtml(params.subject)}</div>`,
    params.teacherName ? `<div><span class="label">担当講師</span>${escapeHtml(params.teacherName)}</div>` : '',
  ].filter(Boolean).join('')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>出席者一覧 ${escapeHtml(params.subject)} ${escapeHtml(params.dateLabel)}</title>
<style>
  /* A4縦1枚に最大50名（2列×25名）を収める印刷レイアウト。 */
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif; color: #111; margin: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .meta { display: flex; flex-wrap: wrap; gap: 2px 24px; margin-bottom: 12px; font-size: 13px; }
  .meta .label { display: inline-block; min-width: 64px; color: #555; margin-right: 8px; }
  /* 出席者一覧は最大2列を横並びにする（25名超で2列）。各表は内容幅で左詰め(無駄に横長にしない)。 */
  .roster { display: flex; gap: 16px; align-items: flex-start; justify-content: flex-start; }
  .roster-col { flex: 0 0 auto; }
  table { width: auto; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 2px 8px; text-align: left; white-space: nowrap; }
  th { background: #f2f2f2; }
  td.num, th.num { width: 36px; text-align: center; }
  td.name, th.name { min-width: 132px; }
  td.status, th.status { width: 56px; text-align: center; font-weight: 700; }
  /* チェック欄は印刷後に手書きチェックできる幅を確保する。 */
  td.check, th.check { width: 84px; }
  td.status.absent { color: #b00020; }
  td.empty { text-align: center; color: #777; }
  .summary { margin-top: 12px; font-size: 13px; font-weight: 700; }
  .print-button { margin-bottom: 12px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  @media print { .print-button { display: none; } body { margin: 0; } }
</style>
</head>
<body>
<button class="print-button" onclick="window.print()">印刷</button>
<h1>集団授業 出席者一覧</h1>
<div class="meta">${headerRows}</div>
<div class="roster">${rosterHtml}</div>
<div class="summary">出席 ${presentCount} 名 / 欠席 ${absentCount} 名（合計 ${params.attendees.length} 名）</div>
</body>
</html>`
}

// 別ウィンドウで印刷用HTMLを開く（副作用・テスト対象外）。
export function openGroupAttendancePrint(params: GroupAttendancePrintParams): boolean {
  if (typeof window === 'undefined') return false
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.open()
  printWindow.document.write(buildGroupAttendanceHtml(params))
  printWindow.document.close()
  return true
}
