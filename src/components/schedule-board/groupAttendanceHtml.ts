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

export function buildGroupAttendanceHtml(params: GroupAttendancePrintParams): string {
  const presentCount = params.attendees.filter((attendee) => attendee.present).length
  const absentCount = params.attendees.length - presentCount

  const rowsHtml = params.attendees.length > 0
    ? params.attendees
      .map((attendee, index) => {
        const statusLabel = attendee.present ? '出席' : '欠席'
        const statusClass = attendee.present ? 'present' : 'absent'
        return `<tr><td class="num">${index + 1}</td><td class="name">${escapeHtml(attendee.name)}</td><td class="status ${statusClass}">${statusLabel}</td></tr>`
      })
      .join('')
    : '<tr><td class="empty" colspan="3">出席者がいません</td></tr>'

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
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 24px; margin-bottom: 16px; font-size: 14px; }
  .meta .label { display: inline-block; min-width: 64px; color: #555; margin-right: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { border: 1px solid #999; padding: 6px 10px; text-align: left; }
  th { background: #f2f2f2; }
  td.num { width: 48px; text-align: center; }
  td.status { width: 80px; text-align: center; font-weight: 700; }
  td.status.absent { color: #b00020; }
  td.empty { text-align: center; color: #777; }
  .summary { margin-top: 16px; font-size: 14px; font-weight: 700; }
  .print-button { margin-bottom: 16px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  @media print { .print-button { display: none; } body { margin: 0; } }
</style>
</head>
<body>
<button class="print-button" onclick="window.print()">印刷</button>
<h1>集団授業 出席者一覧</h1>
<div class="meta">${headerRows}</div>
<table>
<thead><tr><th class="num">#</th><th>氏名</th><th class="status">出欠</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
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
