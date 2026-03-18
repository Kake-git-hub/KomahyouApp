export type ScheduleQrConfig = {
  baseUrl: string
  classroomId: string
  sessionId: string
  schoolNamePattern: string
}

export function createLegacyLessonScheduleQrConfig(): ScheduleQrConfig | undefined {
  const baseUrl = String(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_BASE_URL ?? 'https://kake-git-hub.github.io/LessonScheduleTable').trim()
  const classroomId = String(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_TEST_CLASSROOM_ID ?? '0002').trim()
  const sessionId = String(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_TEST_CLASSROOM_SESSION_ID ?? '2026-spring').trim()
  const schoolNamePattern = String(import.meta.env.VITE_LESSON_SCHEDULE_TABLE_QR_SCHOOL_PATTERN ?? 'テスト教室2').trim()

  if (!baseUrl || !classroomId || !sessionId || !schoolNamePattern) return undefined

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    classroomId,
    sessionId,
    schoolNamePattern,
  }
}