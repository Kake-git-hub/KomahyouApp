// 役割名辞書(Phase 1 T1-3・docs/spec-multi-tenant.md §11)の配線を固定する。
// 対象は**役割名だけ**(室長・教室管理者・開発者)とアプリ名。全域置換はしない(オーナー確定 2026-09-16)。
//  1. 既定辞書では出力不変(既存テスト scheduleHtml.test.ts の「室長登録」もそのまま通る)。
//  2. 辞書を差し替えると画面(App.tsx のタブ名・アカウント一覧)と印刷(日程表の「提出方法」)が**同時に**変わる。
//  3. 対象箇所は字面で固定し、辞書を通さない直書きへ戻らないようにする。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@company/profile', async (importOriginal) => {
  const original = await importOriginal<typeof import('@company/profile')>()
  return {
    ...original,
    roleLabel: vi.fn(original.roleLabel),
    appName: vi.fn(original.appName),
  }
})

import { appName, roleLabel } from '@company/profile'
import { openStudentScheduleHtml } from '../utils/scheduleHtml'
import type { StudentRow } from '../components/basic-data/basicDataModel'

const APP_TSX = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const SCHEDULE_HTML_TS = readFileSync(fileURLToPath(new URL('../utils/scheduleHtml.ts', import.meta.url)), 'utf8')

function renderStudentScheduleHtml(): string {
  const write = vi.fn()
  const popup = {
    closed: false,
    document: { open() {}, write, close() {} },
    focus() {},
    postMessage() {},
  } as unknown as Window
  vi.stubGlobal('window', {
    open: () => popup,
    setTimeout: (callback: () => void) => { callback(); return 0 },
  })
  const student: StudentRow = {
    id: 'student-1',
    name: '山田 太郎',
    displayName: '山田',
    email: 'student@example.com',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-01',
  }
  openStudentScheduleHtml({
    cells: [],
    students: [student],
    regularLessons: [],
    defaultStartDate: '2026-03-24',
    defaultEndDate: '2026-03-24',
    titleLabel: 'テスト',
    classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [] },
    targetWindow: popup,
  })
  vi.unstubAllGlobals()
  return write.mock.calls[0]?.[0] as string
}

function extractSubmissionMethodLabel(html: string): (input: unknown) => string {
  const match = html.match(/function resolveSubmissionMethodLabel\(input\)\s*\{([\s\S]*?)\n {6}\}/)
  expect(match).toBeTruthy()
  return new Function('input', match![1]) as (input: unknown) => string
}

describe('役割名辞書の配線(画面と印刷を同時に)', () => {
  afterEach(() => {
    vi.mocked(roleLabel).mockReset()
    vi.mocked(appName).mockReset()
  })

  it('既定辞書では日程表の「提出方法」が従来どおり「室長登録」(出力不変)', () => {
    const resolveMethod = extractSubmissionMethodLabel(renderStudentScheduleHtml())
    expect(resolveMethod({ countSubmitted: true, submissionMethod: 'manual' })).toBe('室長登録')
    expect(resolveMethod({ countSubmitted: true, submissionMethod: 'qr' })).toBe('QR提出')
  })

  it('辞書の manager を差し替えると日程表の「提出方法」も変わる(印刷側が辞書を読んでいる)', () => {
    vi.mocked(roleLabel).mockImplementation((key) => (key === 'manager' ? 'マネージャー' : '×'))
    const resolveMethod = extractSubmissionMethodLabel(renderStudentScheduleHtml())
    expect(resolveMethod({ countSubmitted: true, submissionMethod: 'manual' })).toBe('マネージャー登録')
  })

  it("辞書の値に引用符・バックスラッシュ・改行が入っても埋め込みスクリプトが壊れない", () => {
    vi.mocked(roleLabel).mockImplementation(() => "It's \\ \"Head\"\n")
    vi.mocked(appName).mockImplementation(() => "O'Neil\\App</script>")
    const html = renderStudentScheduleHtml()
    const resolveMethod = extractSubmissionMethodLabel(html)
    expect(resolveMethod({ countSubmitted: true, submissionMethod: 'manual' })).toBe("It's \\ \"Head\"\n登録")
    // '<' は \u003c に逃がされ、値に '</script>' が入ってもスクリプトブロックが途中で閉じない。
    expect(html).not.toContain("O'Neil\\\\App</script>")
    expect(html).toContain("\\u003c/script>本体のタブ")
    // 出荷スクリプト本体が構文的に妥当であること(<script> ラッパを外して new Function でパース)。
    const scriptStart = html.lastIndexOf('<script>')
    const scriptEnd = html.lastIndexOf('</script>')
    expect(scriptStart).toBeGreaterThan(-1)
    expect(() => new Function(html.slice(scriptStart + '<script>'.length, scriptEnd))).not.toThrow()
  })

  it('App.tsx: アカウント一覧の役割表示・タブ名・ログイン題名は辞書経由(直書きへ戻さない)', () => {
    expect(APP_TSX).toContain("{user.role === 'developer' ? roleLabel('developer') : roleLabel('classroomAdmin')}")
    expect(APP_TSX).not.toContain("'developer' ? '開発者' : '教室管理者'")
    expect(APP_TSX).toContain("document.title = `${roleLabel('developer')}画面 | ${appName()}`")
    expect(APP_TSX).toContain('document.title = classroomName ? `${classroomName} | ${appName()}` : appName()')
    expect(APP_TSX).toContain('<h1>{appName()}ログイン</h1>')
    expect(APP_TSX).not.toContain("document.title = 'コマ表アプリ'")
    expect(APP_TSX).not.toContain("document.title = '開発者画面 | コマ表アプリ'")
  })

  it('scheduleHtml.ts: 「室長登録」とアプリ名の直書きは辞書経由に置き換わっている', () => {
    expect(SCHEDULE_HTML_TS).toContain("return '${managerLabelJs}登録';")
    expect(SCHEDULE_HTML_TS).not.toContain("return '室長登録';")
    expect(SCHEDULE_HTML_TS).not.toContain("'コマ表アプリ本体のタブが見つからないため")
    expect(SCHEDULE_HTML_TS).toContain("'${appNameJs}本体のタブが見つからないため")
  })
})
