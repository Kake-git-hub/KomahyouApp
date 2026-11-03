// 提出用QR(講習の希望提出ページ)へ載せる「組まれたコマ」(occupiedSlots)を盤面のセルから作る純関数。
// App.tsx ensureScheduleSubmissionTokens の中にあった組み立てをそのまま切り出し、日程公開(2026-11-03)の
// 「非公開の講習コマを載せない」を足した。
//
// ★includeLectureLessons=true のときは**切り出し前と同じ結果**にする(既存の挙動を変えない):
//   - 生徒: その生徒の授業ごとに buildOccupiedSlotLabel(種別1文字+科目)。同じコマに 2 つあれば先勝ち。
//   - 講師: 机の講師名を教室の講師へ照合し、机の 1 人目の生徒枠(studentSlots[0])の種別で全長ラベル。
// ★includeLectureLessons=false(講習が非公開)のとき:
//   - 生徒: 講習(special)の授業を載せない。通常・振替・増コマは今どおり載せる
//     (提出前の画面の「組まれているコマに×を付けると確認が出る」には通常授業の位置が要る)。
//   - 講師: 講習の生徒しかいない机は載せない。講習以外の生徒もいる机は、その生徒の種別でラベルを付ける。
//   提出用QRの文書(誰でもトークンで読める)に講習の配置そのものを書かないことが目的なので、画面で隠すのではなく
//   ここで落とす(オーナー確定 2026-11-03「コマ組みが終わるまで保護者に講習の日程を見せない」)。
import { buildOccupiedSlotLabel } from './occupiedSlotLabel'

export type SubmissionOccupiedSlotStudent = {
  id: string
  managedStudentId?: string
  lessonType?: string
  subject?: string
}

export type SubmissionOccupiedSlotCell = {
  dateKey: string
  slotNumber: number
  desks: Array<{
    teacher: string
    lesson?: { studentSlots: Array<SubmissionOccupiedSlotStudent | null | undefined> } | null
  }>
}

const TEACHER_LESSON_TYPE_LABELS: Record<string, string> = { extra: '増コマ', regular: '通常', makeup: '振替', special: '講習' }

export function buildSubmissionOccupiedSlotMaps(params: {
  cells: readonly SubmissionOccupiedSlotCell[]
  /** 机の講師名 → 教室の講師ID(見つからなければ null)。 */
  resolveTeacherId: (teacherName: string) => string | null
  includeLectureLessons: boolean
}): { studentOccupiedMap: Map<string, Record<string, string>>; teacherOccupiedMap: Map<string, Record<string, string>> } {
  const studentOccupiedMap = new Map<string, Record<string, string>>()
  const teacherOccupiedMap = new Map<string, Record<string, string>>()
  const ensure = (map: Map<string, Record<string, string>>, key: string) => {
    if (!map.has(key)) map.set(key, {})
    return map.get(key)!
  }

  for (const cell of params.cells) {
    const slotKey = `${cell.dateKey}_${cell.slotNumber}`
    for (const desk of cell.desks) {
      if (!desk.lesson) continue
      const studentSlots = desk.lesson.studentSlots
      const teacherId = params.resolveTeacherId(desk.teacher)
      if (teacherId) {
        let teacherLessonType: string | null = studentSlots[0]?.lessonType ?? ''
        if (!params.includeLectureLessons && studentSlots.some((slot) => slot?.lessonType === 'special')) {
          const visible = studentSlots.find((slot) => slot && slot.lessonType !== 'special')
          teacherLessonType = visible ? visible.lessonType ?? '' : null
        }
        if (teacherLessonType !== null) {
          const existing = ensure(teacherOccupiedMap, teacherId)
          if (!existing[slotKey]) existing[slotKey] = TEACHER_LESSON_TYPE_LABELS[teacherLessonType] ?? ''
        }
      }
      for (const studentSlot of studentSlots) {
        if (!studentSlot) continue
        if (!params.includeLectureLessons && studentSlot.lessonType === 'special') continue
        const studentId = studentSlot.managedStudentId ?? studentSlot.id
        const existing = ensure(studentOccupiedMap, studentId)
        // オーナー指示(2026-07-19): 生徒の割振コマは「種別+科目」で表記する(例: 講習の数学→'講数'、通常の英語→'通英')。
        // 講師側は生徒が2人で科目が一意でないため種別全長ラベルのまま。
        if (!existing[slotKey]) existing[slotKey] = buildOccupiedSlotLabel(studentSlot.lessonType, studentSlot.subject)
      }
    }
  }
  return { studentOccupiedMap, teacherOccupiedMap }
}
