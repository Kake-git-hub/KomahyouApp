import { describe, expect, it } from 'vitest'
import type { StudentRow } from './basicDataModel'
import { PARENT_PORTAL_QR_TEXT, buildParentPortalQrPrintHtml, resolveParentPortalQrRowState, resolveSavedStudentIds } from './parentPortalQr'

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

describe('保存前の生徒は QR を保存待ちにする(確認リスト その他 2026-09-13)', () => {
  it('発行が要る生徒が保存済みデータに居なければ pending-save、居れば issue', () => {
    expect(resolveParentPortalQrRowState({ ...enabledParams, savedStudentIds: new Set(['s999']), student: createStudent() })).toBe('pending-save')
    expect(resolveParentPortalQrRowState({ ...enabledParams, savedStudentIds: new Set(['s001']), student: createStudent() })).toBe('issue')
    // 保存状態が未確定(null)なら従来どおり。
    expect(resolveParentPortalQrRowState({ ...enabledParams, savedStudentIds: null, student: createStudent() })).toBe('issue')
    // 他教室の写しトークン(発行が要る)も保存前なら待たせる。
    expect(resolveParentPortalQrRowState({ ...enabledParams, savedStudentIds: new Set(), student: createStudent({ parentPortalToken: 'tok' }) })).toBe('pending-save')
  })

  it('発行済み(show)・非表示(hidden)の判定は保存状態に左右されない', () => {
    const shown = createStudent({ parentPortalToken: 'tok', parentPortalTokenClassroomId: DEV_CLASSROOM_ID })
    expect(resolveParentPortalQrRowState({ ...enabledParams, savedStudentIds: new Set(), student: shown })).toBe('show')
    expect(resolveParentPortalQrRowState({ ...enabledParams, enabled: false, savedStudentIds: new Set(), student: createStudent() })).toBe('hidden')
    expect(resolveParentPortalQrRowState({ ...enabledParams, savedStudentIds: new Set(), student: createStudent({ withdrawDate: '2026-09-12' }) })).toBe('hidden')
  })

  it('resolveSavedStudentIds: 未保存の変更があるあいだは直前の保存済み集合を保ち、保存が終わったら現在の名簿で作り直す', () => {
    const students = [{ id: 's001' }, { id: 's002' }]
    expect(resolveSavedStudentIds({ hydrated: false, isClean: true, students, previous: null })).toBeNull()
    const saved = resolveSavedStudentIds({ hydrated: true, isClean: true, students, previous: null })!
    expect([...saved].sort()).toEqual(['s001', 's002'])
    // 生徒を追加した(未保存) → 追加した生徒は含めない。
    const added = [...students, { id: 's003' }]
    expect(resolveSavedStudentIds({ hydrated: true, isClean: false, students: added, previous: saved })).toBe(saved)
    // 保存が終わった → 含める。
    expect(resolveSavedStudentIds({ hydrated: true, isClean: true, students: added, previous: saved })!.has('s003')).toBe(true)
    // 中身が同じなら同じ参照(再描画を増やさない)。
    expect(resolveSavedStudentIds({ hydrated: true, isClean: true, students: [{ id: 's002' }, { id: 's001' }], previous: saved })).toBe(saved)
  })
})

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
