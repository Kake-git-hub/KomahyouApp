import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { SlotCell, StudentEntry, StudentStatusEntry } from '../components/schedule-board/types'
import type { ClassroomSettings, PersistedBoardState } from '../types/appState'

export type DataIntegritySeverity = 'error' | 'warning' | 'info'

export type DataIntegrityIssue = {
  id: string
  severity: DataIntegritySeverity
  title: string
  detail: string
  location?: string
}

export type DataIntegrityReport = {
  generatedAt: string
  summary: string
  counts: {
    errors: number
    warnings: number
    infos: number
    weeks: number
    cells: number
    lessons: number
    studentsInBoard: number
  }
  issues: DataIntegrityIssue[]
}

type DataIntegrityInput = {
  classroomId?: string | null
  classroomName?: string | null
  classroomSettings: ClassroomSettings
  boardState: PersistedBoardState | null
  specialSessions: SpecialSessionRow[]
  studentIds: string[]
  teacherIds: string[]
}

function getStudentKey(student: Pick<StudentEntry | StudentStatusEntry, 'managedStudentId' | 'id' | 'name'>) {
  return student.managedStudentId || student.id || student.name
}

function getStatusStudentKey(status: StudentStatusEntry) {
  return status.managedStudentId || status.studentId || status.id || status.name
}

function formatCellLocation(cell: SlotCell, deskIndex?: number, studentIndex?: number) {
  return [
    cell.dateKey,
    `${cell.slotNumber}限`,
    deskIndex !== undefined ? `${deskIndex + 1}机目` : '',
    studentIndex !== undefined ? `${studentIndex + 1}枠` : '',
  ].filter(Boolean).join(' / ')
}

function addIssue(issues: DataIntegrityIssue[], issue: Omit<DataIntegrityIssue, 'id'>) {
  issues.push({
    id: `integrity_${issues.length + 1}`,
    ...issue,
  })
}

export function runDataIntegrityChecks(input: DataIntegrityInput): DataIntegrityReport {
  const issues: DataIntegrityIssue[] = []
  const studentIdSet = new Set(input.studentIds)
  const teacherIdSet = new Set(input.teacherIds)
  const allCells = input.boardState?.weeks.flat() ?? []
  let lessonCount = 0
  let studentSlotCount = 0
  const seenCellIds = new Set<string>()
  const seenCellKeys = new Set<string>()

  if (!input.boardState) {
    addIssue(issues, {
      severity: 'warning',
      title: '盤面状態が未作成',
      detail: '整合性チェック対象の boardState がまだ保存されていません。コマ表を一度開いて保存してください。',
    })
  }

  for (const [cellIndex, cell] of allCells.entries()) {
    const cellKey = `${cell.dateKey}_${cell.slotNumber}`
    if (seenCellIds.has(cell.id)) {
      addIssue(issues, {
        severity: 'error',
        title: 'セルIDの重複',
        detail: `同じセルID "${cell.id}" が複数存在します。`,
        location: formatCellLocation(cell),
      })
    }
    seenCellIds.add(cell.id)

    if (seenCellKeys.has(cellKey)) {
      addIssue(issues, {
        severity: 'error',
        title: '同一日時コマの重複',
        detail: `${cell.dateKey} ${cell.slotNumber}限のセルが複数存在します。`,
        location: formatCellLocation(cell),
      })
    }
    seenCellKeys.add(cellKey)

    if (cell.desks.length !== input.classroomSettings.deskCount) {
      addIssue(issues, {
        severity: 'warning',
        title: '机数が教室設定と不一致',
        detail: `盤面セルの机数 ${cell.desks.length} が教室設定 ${input.classroomSettings.deskCount} と一致しません。`,
        location: formatCellLocation(cell),
      })
    }

    const studentsInCell = new Map<string, string[]>()
    const statusesInCell: Array<{ key: string; status: StudentStatusEntry; location: string }> = []
    for (const [deskIndex, desk] of cell.desks.entries()) {
      if (desk.lesson) lessonCount += 1
      for (const [studentIndex, student] of (desk.lesson?.studentSlots ?? []).entries()) {
        if (!student) continue
        studentSlotCount += 1
        const studentKey = getStudentKey(student)
        const locations = studentsInCell.get(studentKey) ?? []
        locations.push(formatCellLocation(cell, deskIndex, studentIndex))
        studentsInCell.set(studentKey, locations)
        if (student.managedStudentId && !studentIdSet.has(student.managedStudentId)) {
          addIssue(issues, {
            severity: 'warning',
            title: '管理データにない生徒が盤面に存在',
            detail: `${student.name} (${student.managedStudentId}) が基本データの生徒一覧に見つかりません。`,
            location: formatCellLocation(cell, deskIndex, studentIndex),
          })
        }
      }

      for (const [studentIndex, status] of (desk.statusSlots ?? []).entries()) {
        if (!status) continue
        const statusKey = getStatusStudentKey(status)
        statusesInCell.push({ key: statusKey, status, location: formatCellLocation(cell, deskIndex, studentIndex) })
      }
    }

    for (const entry of statusesInCell) {
      const activeLocations = studentsInCell.get(entry.key)
      if (!activeLocations?.length) continue
      addIssue(issues, {
        severity: 'error',
        title: '同じ生徒の実授業と履歴マーカーが同一コマに混在',
        detail: `${entry.status.name} の実授業と ${entry.status.status} マーカーが同じ日時コマ内にあります。`,
        location: entry.location,
      })
    }

    for (const [studentKey, locations] of studentsInCell.entries()) {
      if (locations.length <= 1) continue
      addIssue(issues, {
        severity: 'error',
        title: '同一コマ内の生徒重複',
        detail: `生徒キー ${studentKey} が同じ日時コマに ${locations.length} 回配置されています。`,
        location: `${formatCellLocation(cell)} (${locations.join(' / ')})`,
      })
    }

    if (cellIndex !== 0 && allCells[cellIndex - 1].dateKey > cell.dateKey) {
      addIssue(issues, {
        severity: 'info',
        title: '盤面セルの日付順序が逆転',
        detail: '保存データ内のセル順序が日付昇順ではありません。表示に影響がなければ情報扱いです。',
        location: formatCellLocation(cell),
      })
    }
  }

  const seenSubmissionTokens = new Map<string, string>()
  for (const session of input.specialSessions) {
    for (const [teacherId, teacherInput] of Object.entries(session.teacherInputs)) {
      if (teacherId && !teacherIdSet.has(teacherId)) {
        addIssue(issues, {
          severity: 'warning',
          title: '講習提出に管理データ外の講師ID',
          detail: `${session.label} の講師ID ${teacherId} が基本データに見つかりません。`,
        })
      }
      const token = teacherInput.submissionToken
      if (!token) continue
      const previous = seenSubmissionTokens.get(token)
      if (previous) {
        addIssue(issues, {
          severity: 'error',
          title: 'QR提出トークンの重複',
          detail: `${previous} と ${session.label}/講師/${teacherId} が同じ提出トークンを使っています。`,
        })
      }
      seenSubmissionTokens.set(token, `${session.label}/講師/${teacherId}`)
    }

    for (const [studentId, studentInput] of Object.entries(session.studentInputs)) {
      if (studentId && !studentIdSet.has(studentId)) {
        addIssue(issues, {
          severity: 'warning',
          title: '講習提出に管理データ外の生徒ID',
          detail: `${session.label} の生徒ID ${studentId} が基本データに見つかりません。`,
        })
      }
      const token = studentInput.submissionToken
      if (!token) continue
      const previous = seenSubmissionTokens.get(token)
      if (previous) {
        addIssue(issues, {
          severity: 'error',
          title: 'QR提出トークンの重複',
          detail: `${previous} と ${session.label}/生徒/${studentId} が同じ提出トークンを使っています。`,
        })
      }
      seenSubmissionTokens.set(token, `${session.label}/生徒/${studentId}`)
    }
  }

  if (input.boardState?.selectedCellId && !seenCellIds.has(input.boardState.selectedCellId)) {
    addIssue(issues, {
      severity: 'warning',
      title: '選択セルが盤面内に存在しない',
      detail: `保存された selectedCellId "${input.boardState.selectedCellId}" が現在の盤面に見つかりません。`,
    })
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  const infos = issues.filter((issue) => issue.severity === 'info').length
  const summary = errors > 0
    ? `整合性エラー ${errors} 件、警告 ${warnings} 件を検出しました。`
    : warnings > 0
      ? `重大エラーはありません。警告 ${warnings} 件を検出しました。`
      : '重大エラー・警告は見つかりませんでした。'

  return {
    generatedAt: new Date().toISOString(),
    summary,
    counts: {
      errors,
      warnings,
      infos,
      weeks: input.boardState?.weeks.length ?? 0,
      cells: allCells.length,
      lessons: lessonCount,
      studentsInBoard: studentSlotCount,
    },
    issues,
  }
}

export function buildDebugSnapshot(input: DataIntegrityInput & { report?: DataIntegrityReport | null }) {
  return {
    generatedAt: new Date().toISOString(),
    classroom: {
      id: input.classroomId ?? '',
      name: input.classroomName ?? '',
      deskCount: input.classroomSettings.deskCount,
    },
    counts: {
      teachers: input.teacherIds.length,
      students: input.studentIds.length,
      specialSessions: input.specialSessions.length,
      weeks: input.boardState?.weeks.length ?? 0,
      cells: input.boardState?.weeks.flat().length ?? 0,
    },
    report: input.report ?? runDataIntegrityChecks(input),
    boardState: input.boardState,
    specialSessions: input.specialSessions,
  }
}
