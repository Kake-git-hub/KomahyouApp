import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { closeOpenSchedulePopupWindows } from './ScheduleBoardScreen'

// 2026-11-03 オーナー確定(フリーメモ 20261103-104733454)「コマ表アプリのタブを閉じたとき、関連するタブも自動ですべて閉じて」。
// ブラウザは閉じると再読み込みを区別できないので、再読み込みでも閉じる(オーナー選択)。
describe('コマ表のタブを閉じたら日程表タブも閉じる', () => {
  const fakeWindow = (closed = false) => {
    const win = { closed, close: () => { win.closed = true } }
    return win as unknown as Window & { closed: boolean }
  }

  it('開いている生徒・講師の日程表タブを閉じ、共有ハンドルを空にする', () => {
    const student = fakeWindow()
    const teacher = fakeWindow()
    const runtime = { __lessonScheduleStudentWindow: student, __lessonScheduleTeacherWindow: teacher } as { __lessonScheduleStudentWindow: Window | null; __lessonScheduleTeacherWindow: Window | null }
    expect(closeOpenSchedulePopupWindows(runtime)).toBe(2)
    expect(student.closed).toBe(true)
    expect(teacher.closed).toBe(true)
    expect(runtime.__lessonScheduleStudentWindow).toBeNull()
    expect(runtime.__lessonScheduleTeacherWindow).toBeNull()
  })

  it('閉じてある・無いタブは数えない', () => {
    const runtime = { __lessonScheduleStudentWindow: fakeWindow(true), __lessonScheduleTeacherWindow: null }
    expect(closeOpenSchedulePopupWindows(runtime)).toBe(0)
  })

  it('App は pagehide で閉じる(閉じる・再読み込みの両方)', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(app).toContain("    const handlePageHide = () => {\n      closeOpenSchedulePopupWindows()\n    }\n    window.addEventListener('pagehide', handlePageHide)")
  })
})
