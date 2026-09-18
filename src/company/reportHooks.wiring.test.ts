// 帳票フック(Phase 1 T1-4・docs/spec-multi-tenant.md §11)の回帰固定。
//  1. 既定(全項目空)では従来の出力と同じ: ヘッダは既定ブロック・追加注記なし・ロゴ欄は「ロゴ欄」。
//  2. 差し込みがあれば: ヘッダ丸ごと差替(トークン展開・エスケープ)・注記が末尾に付く・既定ロゴが出る(利用者ロゴ優先)。
//  3. 埋め込み JS の実体を new Function で抽出して固定する(テンプレートエスケープ崩れ検知)。
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@company/profile', async (importOriginal) => {
  const original = await importOriginal<typeof import('@company/profile')>()
  return { ...original, resolveCompanyReportHooks: vi.fn(original.resolveCompanyReportHooks) }
})

import { EMPTY_COMPANY_REPORT_HOOKS, resolveCompanyReportHooks, type CompanyReportHooks } from '@company/profile'
import { openStudentScheduleHtml } from '../utils/scheduleHtml'
import type { StudentRow } from '../components/basic-data/basicDataModel'

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

function extractFunctionSource(html: string, name: string): string {
  const match = html.match(new RegExp(`(function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n {6}\\})`))
  expect(match, name).toBeTruthy()
  return match![1]
}

type HeaderBuilder = (title: string, nameLabel: string, subLabel: string, pageIndex: number, periodLabel: string, qrHtml: string, companyHeaderHtml: string) => string

// 埋め込み JS の buildHeaderHtml と、それが依存する 3 つの補助関数を抽出して実体を評価する。
function buildHeaderRuntime(html: string, hooks: CompanyReportHooks): HeaderBuilder {
  const source = [
    extractFunctionSource(html, 'applyCompanyHeaderTemplate'),
    extractFunctionSource(html, 'renderCompanyNoteHtml'),
    extractFunctionSource(html, 'renderLogoBoxInner'),
    extractFunctionSource(html, 'buildHeaderHtml'),
    'return buildHeaderHtml;',
  ].join('\n')
  const escapeHtml = (value: unknown) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return new Function('COMPANY_REPORT_HOOKS', 'escapeHtml', source)(hooks, escapeHtml) as HeaderBuilder
}

describe('帳票フック(scheduleHtml)', () => {
  afterEach(() => {
    vi.mocked(resolveCompanyReportHooks).mockReset()
  })

  it('既定では全項目が空のフックが 1 回だけ埋め込まれる(payload とは別・出力不変の前提)', () => {
    const html = renderStudentScheduleHtml()
    expect(html).toContain('const COMPANY_REPORT_HOOKS = {"studentHeaderHtml":"","teacherHeaderHtml":"","studentNoteHtml":"","teacherNoteHtml":"","emptyFormatNoteHtml":"","logoDefaultUrl":""};')
    expect(html.split('const COMPANY_REPORT_HOOKS = ').length).toBe(2)
    // 出荷スクリプト本体が構文的に妥当であること。
    const scriptStart = html.lastIndexOf('<script>')
    const scriptEnd = html.lastIndexOf('</script>')
    expect(() => new Function(html.slice(scriptStart + '<script>'.length, scriptEnd))).not.toThrow()
  })

  it('ヘッダ差替が空なら従来の上部ブロック(ロゴ欄・校舎名欄・題名欄・期間/氏名/ページ)をそのまま返す', () => {
    const html = renderStudentScheduleHtml()
    const buildHeaderHtml = buildHeaderRuntime(html, EMPTY_COMPANY_REPORT_HOOKS)
    const header = buildHeaderHtml('授業日程表', '生徒名', '山田 太郎(中1)', 0, '3月24日〜3月24日', '', '')
    expect(header.startsWith('<div class="sheet-top">')).toBe(true)
    expect(header).toContain('<div class="logo-box" data-shared-image="logo"><span class="logo-placeholder">ロゴ欄</span></div>')
    expect(header).toContain('data-shared-input="school-info"')
    expect(header).toContain('data-shared-input="sheet-title"')
    expect(header).toContain('<span class="meta-label">期間:</span> 3月24日〜3月24日')
    expect(header).toContain('<span class="meta-label">生徒名:</span> 山田 太郎(中1)')
    expect(header).toContain('1ページ目')
    expect(header).not.toContain('company-note')
  })

  it('ヘッダ差替があれば上部ブロックを丸ごと置き換え、トークンをエスケープして展開する({{qr}} だけ HTML のまま)', () => {
    const html = renderStudentScheduleHtml()
    const buildHeaderHtml = buildHeaderRuntime(html, { ...EMPTY_COMPANY_REPORT_HOOKS, studentHeaderHtml: '<header class="co"><b>{{nameLabel}}</b>:{{name}} / {{period}} / p{{page}} {{qr}} {{unknown}}</header>' })
    const header = buildHeaderHtml('授業日程表', '生徒名', '<山田> & "太郎"', 2, '3/24〜3/30', '<svg id="qr"></svg>', '<header class="co"><b>{{nameLabel}}</b>:{{name}} / {{period}} / p{{page}} {{qr}} {{unknown}}</header>')
    expect(header).toBe('<header class="co"><b>生徒名</b>:&lt;山田&gt; &amp; &quot;太郎&quot; / 3/24〜3/30 / p3 <svg id="qr"></svg> {{unknown}}</header>')
    expect(header).not.toContain('sheet-top')
  })

  it('既定ロゴは利用者ロゴが空のときだけ使われ、利用者ロゴがあればそちらが優先', () => {
    const html = renderStudentScheduleHtml()
    const withDefaultLogo = buildHeaderRuntime(html, { ...EMPTY_COMPANY_REPORT_HOOKS, logoDefaultUrl: '/company-logo.png' })
    expect(withDefaultLogo('授業日程表', '生徒名', '山田', 0, '期間', '', '')).toContain('<div class="logo-box" data-shared-image="logo"><img class="logo-image" src="/company-logo.png" alt="logo" /></div>')
    const source = `${extractFunctionSource(html, 'renderLogoBoxInner')}\nreturn renderLogoBoxInner;`
    const renderLogoBoxInner = new Function('COMPANY_REPORT_HOOKS', source)({ logoDefaultUrl: '/company-logo.png' }) as (src: string) => string
    expect(renderLogoBoxInner('data:image/png;base64,USER')).toBe('<img class="logo-image" src="data:image/png;base64,USER" alt="logo" />')
    expect(renderLogoBoxInner('')).toBe('<img class="logo-image" src="/company-logo.png" alt="logo" />')
    const withoutDefault = new Function('COMPANY_REPORT_HOOKS', source)({ logoDefaultUrl: '' }) as (src: string) => string
    expect(withoutDefault('')).toBe('<span class="logo-placeholder">ロゴ欄</span>')
  })

  it('追加注記は空なら何も足さず、あれば company-note で包む', () => {
    const html = renderStudentScheduleHtml()
    const renderCompanyNoteHtml = new Function(`${extractFunctionSource(html, 'renderCompanyNoteHtml')}\nreturn renderCompanyNoteHtml;`)() as (note: string) => string
    expect(renderCompanyNoteHtml('')).toBe('')
    expect(renderCompanyNoteHtml('<p>注記</p>')).toBe('<div class="company-note" data-role="company-note"><p>注記</p></div>')
  })

  it('生徒/講師日程表の組み立てはフックを参照する(生徒=studentHeaderHtml・空フォーマット=emptyFormatNoteHtml・講師=teacherHeaderHtml/teacherNoteHtml)', () => {
    const html = renderStudentScheduleHtml()
    expect(html).toContain("qrHtml, COMPANY_REPORT_HOOKS.studentHeaderHtml)")
    expect(html).toContain('renderCompanyNoteHtml(emptyFormat ? COMPANY_REPORT_HOOKS.emptyFormatNoteHtml : COMPANY_REPORT_HOOKS.studentNoteHtml)')
    expect(html).toContain("qrHtml, COMPANY_REPORT_HOOKS.teacherHeaderHtml)")
    expect(html).toContain('renderCompanyNoteHtml(COMPANY_REPORT_HOOKS.teacherNoteHtml)')
    // 空フォーマットのロゴも既定ロゴを補完する。
    expect(html).toContain("readStoredLogoForEmptyFormat() || COMPANY_REPORT_HOOKS.logoDefaultUrl || ''")
  })

  it('プロファイルのフックが埋め込みへそのまま渡り、"<" は JSON 内で \\u003c に逃がされる', () => {
    vi.mocked(resolveCompanyReportHooks).mockReturnValue({
      ...EMPTY_COMPANY_REPORT_HOOKS,
      studentNoteHtml: '<p>会社B 注記</p>',
      logoDefaultUrl: '/b.png',
    })
    const html = renderStudentScheduleHtml()
    expect(html).toContain('"studentNoteHtml":"\\u003cp>会社B 注記\\u003c/p>"')
    expect(html).toContain('"logoDefaultUrl":"/b.png"')
    expect(html).not.toContain('<p>会社B 注記</p>')
  })
})
