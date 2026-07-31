// tools/vanished-makeup-report.mjs から esbuild でバンドルして使うエントリ。
// 盤面画面(ScheduleBoardScreen)が未消化振替を計算するときと**同じ前処理・同じ生徒キー解決**を再現し、
// 書き出し済みバックアップ JSON からレポートを作る。Firestore へは触れない（ファイルを読むだけ）。
import { applyClassroomAvailability } from '../src/components/schedule-board/ScheduleBoardScreen'
import { getStudentDisplayName, type StudentRow } from '../src/components/basic-data/basicDataModel'
import { buildVanishedMakeupReport, type VanishedMakeupReport } from '../src/components/schedule-board/vanishedMakeupReport'
import type { StudentEntry } from '../src/components/schedule-board/types'
import type { AppSnapshot } from '../src/types/appState'

export function buildReportFromSnapshot(snapshot: AppSnapshot, options: { today?: Date } = {}): VanishedMakeupReport {
  const boardState = snapshot.boardState
  if (!boardState || !Array.isArray(boardState.weeks)) {
    throw new Error('このバックアップには盤面(boardState.weeks)が入っていません。教室を開いた状態で書き出した JSON を指定してください。')
  }

  const students = snapshot.students ?? []
  // ScheduleBoardScreen の managedStudentByAnyName / managedStudentNameMap と同じ作り方（登録名・表示名の両方を引く）。
  const studentByAnyName = new Map<string, StudentRow>()
  const displayNameByAnyName = new Map<string, string>()
  for (const student of students) {
    const displayName = getStudentDisplayName(student)
    studentByAnyName.set(student.name, student)
    studentByAnyName.set(displayName, student)
    displayNameByAnyName.set(student.name, displayName)
    displayNameByAnyName.set(displayName, displayName)
  }

  // ScheduleBoardScreen の resolveBoardStudentStockId と同一規則（managedStudentId 最優先→名前逆引き→name: フォールバック）。
  const resolveStudentKey = (student: StudentEntry) => {
    const managedId = student.managedStudentId ?? studentByAnyName.get(student.name)?.id
    if (managedId) return managedId
    const fallbackId = `name:${displayNameByAnyName.get(student.name) ?? student.name}`
    return student.manualAdded ? `manual:${fallbackId}` : fallbackId
  }

  return buildVanishedMakeupReport({
    students,
    teachers: snapshot.teachers ?? [],
    regularLessons: snapshot.regularLessons ?? [],
    classroomSettings: snapshot.classroomSettings,
    weeks: applyClassroomAvailability(boardState.weeks, snapshot.classroomSettings),
    manualAdjustments: boardState.manualMakeupAdjustments ?? {},
    suppressedOrigins: boardState.suppressedMakeupOrigins ?? {},
    fallbackStudents: boardState.fallbackMakeupStudents ?? {},
    resolveStudentKey,
    today: options.today,
  })
}
