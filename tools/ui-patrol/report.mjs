// 画面の自動巡回の報告・終了コード。純関数(ネットワークにもファイルにも触れない)。
// 全体の報告 = { appVersion, backupKey, classrooms: [教室の報告] }。教室の報告 = createClassroomReport の形。
// 手順(step) = { name, title, durationMs, operations(その手順で行った画面操作の回数), findings, notes }。
// 所見(finding) = tools/ui-patrol/checks.ts の PatrolFinding(level は stop=変 / info=知らせるだけ)。
// ★出力に出すのは仮名・ID・件数・経路だけ(所見の message は checks.ts が仮名と ID だけで作る)。

export function createPatrolReport({ appVersion = '', backupKey = '' } = {}) {
  return { appVersion, backupKey, classrooms: [] }
}

export function createClassroomReport({ classroomId, label, backupKey }) {
  return { classroomId, label, backupKey, steps: [], knownCount: 0, aborted: null }
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
  return { stop, info, stepsRun, operations, aborted }
}

/** 0=変なし／1=変あり／2=中断または 1 本も流れていない。 */
export function resolveExitCode(report) {
  const summary = summarizeReport(report)
  if (summary.aborted || summary.stepsRun === 0) return 2
  return summary.stop > 0 ? 1 : 0
}

export function formatPatrolReportText(report) {
  const summary = summarizeReport(report)
  const version = report.appVersion ? (String(report.appVersion).startsWith('v') ? report.appVersion : `v${report.appVersion}`) : 'v不明'
  const lines = [`■ 画面の自動巡回 (アプリ ${version}・データ ${report.backupKey || '不明'}): 変 ${summary.stop} 件・知らせるだけ ${summary.info} 件・操作 ${summary.operations} 回`]
  for (const room of classroomsOf(report)) {
    lines.push(`■ ${room.label || room.classroomId}(${room.classroomId}・データ ${room.backupKey})`)
    for (const step of room.steps ?? []) {
      lines.push(`  ${step.title ?? step.name}(操作 ${step.operations ?? 0} 回・${Math.round((step.durationMs ?? 0) / 100) / 10} 秒)`)
      for (const finding of step.findings ?? []) lines.push(`    ${finding.level === 'stop' ? '[変]' : '[知]'} ${finding.message}`)
      for (const note of step.notes ?? []) lines.push(`    注: ${note}`)
    }
    if (room.knownCount > 0) lines.push(`  既知で外した ${room.knownCount} 件`)
    if (room.aborted) lines.push(`  [中断] ${room.aborted}`)
  }
  return lines.join('\n')
}
