// 画面の自動巡回の報告・終了コード。純関数(ネットワークにもファイルにも触れない)。
// 全体の報告 = { appVersion, backupKey, classrooms: [教室の報告] }。教室の報告 = createClassroomReport の形。
// 手順(step) = { name, title, durationMs, operations(その手順で行った画面操作の回数), findings, notes }。
// 所見(finding) = tools/ui-patrol/checks.ts の PatrolFinding(level は stop=変 / info=知らせるだけ)。
// ★出力に出すのは仮名・ID・件数・経路だけ(所見の message は checks.ts が仮名と ID だけで作る)。

export function createPatrolReport({ appVersion = '', backupKey = '' } = {}) {
  return { appVersion, backupKey, classrooms: [] }
}

export function createClassroomReport({ classroomId, label, backupKey }) {
  // noScenarioRan: 選んだ台本(起動のほか)がどれも候補なしで飛んだ(台本 g・h は候補なしを中断にせず飛ばす・resolveExitCode が見る)。
  return { classroomId, label, backupKey, steps: [], knownCount: 0, aborted: null, noScenarioRan: false }
}

/** 手順を足した新しい教室の報告を返す(元は書き換えない)。 */
export function addStep(classroomReport, step) {
  return { ...classroomReport, steps: [...classroomReport.steps, step] }
}

function classroomsOf(report) {
  return Array.isArray(report) ? report : (Array.isArray(report?.classrooms) ? report.classrooms : [])
}

export function summarizeReport(report) {
  let stop = 0
  let info = 0
  let stepsRun = 0
  let operations = 0
  let aborted = false
  for (const room of classroomsOf(report)) {
    if (room.aborted) aborted = true
    for (const step of room.steps ?? []) {
      stepsRun += 1
      operations += step.operations ?? 0
      for (const finding of step.findings ?? []) {
        if (finding.level === 'stop') stop += 1
        else info += 1
      }
    }
  }
  const summary = { stop, info, stepsRun, operations, aborted }
  // baseline(変更前の報告)と比べた報告だけ、新しい/前から/消えたを足す(tools/ui-patrol/baseline.mjs)。数えるのは所見の印と resolved から。
  if (report?.baseline) {
    let newStops = 0
    let carriedStops = 0
    let resolvedStops = 0
    for (const room of classroomsOf(report)) {
      resolvedStops += (room.resolved ?? []).length
      for (const step of room.steps ?? []) {
        for (const finding of step.findings ?? []) {
          if (finding.level !== 'stop') continue
          if (finding.baseline === 'carried') carriedStops += 1
          else newStops += 1
        }
      }
    }
    return { ...summary, newStops, carriedStops, resolvedStops }
  }
  return summary
}

/**
 * 0=変なし／1=変あり／2=流せなかった。教室ごとに見る: 中断、または手順が 0 本の教室が 1 つでもあれば 2。
 * 全体の操作が 0 回でも 2(何も操作していない巡回の「変なし」を信用させない)。2 が先で、そのあと変があれば 1。
 * 変が無く、全部の教室で選んだ台本が候補なしで飛んだ(noScenarioRan)ときも 2(例 --scenario h を講習の提出の前に流した)。
 * --prepare-only はこの関数を通さない(自己点検が通れば 0・tools/ui-patrol.mjs)。
 */
export function resolveExitCode(report) {
  const rooms = classroomsOf(report)
  if (rooms.length === 0) return 2
  if (rooms.some((room) => room.aborted || (room.steps ?? []).length === 0)) return 2
  const summary = summarizeReport(report)
  if (summary.operations === 0) return 2
  // baseline ありは「新しい変」だけで決める(前からある変が残っていても、自分の変更が新しい変を生んでいなければ 0)。
  const hasStop = report?.baseline ? summary.newStops > 0 : summary.stop > 0
  if (hasStop) return 1
  // 選んだ台本(起動のほか)がどの教室でも候補なしで飛んだ(noScenarioRan・台本 g・h)なら、何も確かめていないので 2。
  // 1 校でも流れていれば、候補なしで飛んだ台本は注に残るだけ(既定＋h を講習の提出の前に流しても、ほかの台本の結果どおり 0／1・手直し 1 I-1)。
  if (rooms.every((room) => room.noScenarioRan)) return 2
  return 0
}

export function formatPatrolReportText(report) {
  const summary = summarizeReport(report)
  const version = report.appVersion ? (String(report.appVersion).startsWith('v') ? report.appVersion : `v${report.appVersion}`) : 'v不明'
  const stopText = report.baseline
    ? `変 ${summary.stop} 件(新しい ${summary.newStops}・前から ${summary.carriedStops})・消えた変 ${summary.resolvedStops} 件`
    : `変 ${summary.stop} 件`
  // --incidents の件なら見出しに件の名前と時点(件ごとの報告を並べて読んだとき、どの件か分かるように)。
  const incidentText = report.incident ? ` [事故の日の形 ${report.incident.name}・時点 ${report.incident.key}]` : ''
  const lines = [`■ 画面の自動巡回${incidentText} (アプリ ${version}・データ ${report.backupKey || '不明'}): ${stopText}・知らせるだけ ${summary.info} 件・操作 ${summary.operations} 回`]
  if (report.incident?.incident) lines.push(`  事故の形: ${report.incident.incident}`)
  if (report.baseline) lines.push(`  比べた報告: ${report.baseline.source}`)
  const stopMark = (finding) => (finding.baseline === 'new' ? '[変・新]' : finding.baseline === 'carried' ? (finding.baselineMatch === 'other-step' ? '[変・前・別の手順]' : '[変・前]') : '[変]')
  for (const room of classroomsOf(report)) {
    lines.push(`■ ${room.label || room.classroomId}(${room.classroomId}・データ ${room.backupKey})`)
    for (const step of room.steps ?? []) {
      lines.push(`  ${step.title ?? step.name}(操作 ${step.operations ?? 0} 回・${Math.round((step.durationMs ?? 0) / 100) / 10} 秒)`)
      for (const finding of step.findings ?? []) lines.push(`    ${finding.level === 'stop' ? stopMark(finding) : '[知]'} ${finding.message}`)
      for (const note of step.notes ?? []) lines.push(`    注: ${note}`)
    }
    for (const item of room.resolved ?? []) lines.push(`    [消えた] ${item.title ?? item.step}: ${item.finding.message}`)
    if (room.knownCount > 0) lines.push(`  既知で外した ${room.knownCount} 件`)
    if (room.aborted) lines.push(`  [中断] ${room.aborted}`)
  }
  return lines.join('\n')
}
