import { describe, expect, it } from 'vitest'
import type { StudentRow } from './basicDataModel'
import { PARENT_PORTAL_QR_TEXT, buildParentPortalQrPrintHtml, resolveParentPortalQrRowState } from './parentPortalQr'

const DEV_CLASSROOM_ID = 'v8OZ7zH8vONNHjjYVcR1'
const REFERENCE_DATE = '2026-09-13'

function createStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 's001',
    name: '青木 太郎',
    displayName: '青木',
    email: '',
    entryDate: '2025-04-01',
    withdrawDate: '未定',
    birthDate: '2012-05-10',
    ...overrides,
  }
}

const enabledParams = { referenceDate: REFERENCE_DATE, enabled: true, remoteEnabled: true, classroomId: DEV_CLASSROOM_ID }

describe('resolveParentPortalQrRowState (spec-parent-portal §K-6)', () => {
  it('在籍中で未発行なら issue、発行元教室が一致する写しがあれば show', () => {
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent() })).toBe('issue')
    expect(resolveParentPortalQrRowState({
      ...enabledParams,
      student: createStudent({ parentPortalToken: 'tok', parentPortalTokenClassroomId: DEV_CLASSROOM_ID }),
    })).toBe('show')
  })

  it('フラグ OFF・リモート無しでは hidden(ボタンを出さない)', () => {
    const student = createStudent({ parentPortalToken: 'tok', parentPortalTokenClassroomId: DEV_CLASSROOM_ID })
    expect(resolveParentPortalQrRowState({ ...enabledParams, enabled: false, student })).toBe('hidden')
    expect(resolveParentPortalQrRowState({ ...enabledParams, remoteEnabled: false, student })).toBe('hidden')
  })

  it('非在籍(退塾後・入塾前・高3卒業後)は hidden — 在籍判定は盤面と同じ isActiveOnDate', () => {
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent({ withdrawDate: '2026-09-12' }) })).toBe('hidden')
    // 退塾日当日は在籍(isActiveOnDate は strictly greater)
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent({ withdrawDate: '2026-09-13' }) })).toBe('issue')
    // 入塾日前は hidden(基本データのタブ判定 resolveManagedRosterStatus は入塾日不問だが、ここでは使わない)
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent({ entryDate: '2026-10-01' }) })).toBe('hidden')
    // 2007-04-02 生まれ → 2026-03-31 に高3卒業済み
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent({ birthDate: '2007-04-02' }) })).toBe('hidden')
  })

  it('他教室で発行された写しトークンは show にしない(発行元タグ不一致・タグ無しは issue へ) — b2e2048 同型の事故防止', () => {
    expect(resolveParentPortalQrRowState({
      ...enabledParams,
      student: createStudent({ parentPortalToken: 'tok', parentPortalTokenClassroomId: '5w5OMueETerSKrSf14HC' }),
    })).toBe('issue')
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent({ parentPortalToken: 'tok' }) })).toBe('issue')
  })

  it('classroomId が渡されないときは写しの有無だけで判定する', () => {
    expect(resolveParentPortalQrRowState({
      ...enabledParams,
      classroomId: null,
      student: createStudent({ parentPortalToken: 'tok', parentPortalTokenClassroomId: 'other' }),
    })).toBe('show')
  })
})

describe('buildParentPortalQrPrintHtml', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><path d="M0,0h1v1h-1z" fill="#000"/></svg>'

  it('教室名・生徒名・QR・URL・案内文・印刷ボタンを 1 枚に載せる', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '開発用教室', studentName: '青木', url: 'https://example.web.app/p/abc', svg })
    expect(html).toContain('開発用教室')
    expect(html).toContain('青木 さん')
    expect(html).toContain(svg)
    expect(html).toContain('https://example.web.app/p/abc')
    expect(html).toContain(PARENT_PORTAL_QR_TEXT.guidance)
    expect(html).toContain(PARENT_PORTAL_QR_TEXT.caution)
    expect(html).toContain('onclick="window.print()"')
    expect(html).toContain('@media print { .print-button { display: none; }')
  })

  it('名前・URL は HTML エスケープする', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '<b>x</b>', studentName: 'A&B', url: 'https://x/p/t?a=1&b=2', svg })
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('A&amp;B')
    expect(html).toContain('a=1&amp;b=2')
  })

  it('空の名前はフォールバックし、生徒 ID などは載せない', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '  ', studentName: '', url: 'u', svg })
    expect(html).toContain('教室')
    expect(html).toContain('生徒 さん')
    expect(html).not.toContain('s001')
  })
})
