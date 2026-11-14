import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StudentRow } from './basicDataModel'
import { parseAppSnapshot, serializeAppSnapshot } from '../../data/appSnapshotRepository'
import { assembleClassroomSnapshotPayload, splitClassroomSnapshotPayload } from '../../utils/classroomSnapshotParts'
import type { AppSnapshot, ClassroomSettings } from '../../types/appState'
import { createInitialBoardSnapshot } from '../schedule-board/ScheduleBoardScreen'
import { mergeImportedBundle } from './BasicDataScreen'
import { PARENT_PORTAL_QR_TEXT, buildParentPortalQrBulkConfirmMessage, buildParentPortalQrBulkPrintHtml, buildParentPortalQrBulkProgressLabel, buildParentPortalQrBulkResultMessage, buildParentPortalQrPrintHtml, buildScheduleSharedGlobalStorageKey, formatParentPortalCardIssuedDate, issueParentPortalTokensForBulkPrint, readParentPortalCardBranding, resolveBulkParentPortalQrPlan, resolveParentPortalQrRowState, resolveSavedStudentIds, runParentPortalQrBulkPrint, writeParentPortalQrPrintWindow } from './parentPortalQr'
import { ParentPortalQrModal, type ParentPortalQrModalProps } from './ParentPortalQrModal'

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

  it('保存待ちのボタンは「QR準備中」と出し、スピナーは白いボタンでも見える色で描く(確認リスト k-12 2026-09-14)', () => {
    expect(PARENT_PORTAL_QR_TEXT.pendingLabel).toBe('QR準備中')
    const screen = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8')
    const pendingButton = screen.slice(screen.indexOf('basic-data-student-qr-pending-'), screen.indexOf('</button>', screen.indexOf('basic-data-student-qr-pending-')))
    expect(pendingButton).toContain('PARENT_PORTAL_QR_TEXT.pendingLabel')
    expect(screen).toContain('secondary-button slim basic-data-qr-pending')
    // 全体の .button-spinner は白(塗りボタン用)なので、QR準備中だけ後勝ちで上書きする。
    const css = readFileSync(fileURLToPath(new URL('../../App.css', import.meta.url)), 'utf8')
    const overrideIndex = css.indexOf('.basic-data-qr-pending .button-spinner')
    expect(overrideIndex).toBeGreaterThan(css.lastIndexOf('border-top-color: #ffffff;'))
    expect(css.slice(overrideIndex, css.indexOf('}', overrideIndex))).toContain('border-top-color: #1f5d96')
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
    // 2026-09-15 改定: 生徒の退塾日は「その日から非在籍」。退塾日当日は hidden、翌日退塾(=今日は前日)は在籍
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent({ withdrawDate: '2026-09-13' }) })).toBe('hidden')
    expect(resolveParentPortalQrRowState({ ...enabledParams, student: createStudent({ withdrawDate: '2026-09-14' }) })).toBe('issue')
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

  it('教室名・生徒名・QR・案内文・印刷ボタンを 1 枚に載せる(URL 文字列は印字しない・2026-10-10 文言整理)', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '開発用教室', studentName: '青木', url: 'https://example.web.app/p/abc', svg })
    expect(html).toContain('開発用教室')
    expect(html).toContain('青木 さん')
    expect(html).toContain(svg)
    expect(html).not.toContain('https://example.web.app/p/abc')
    expect(html).not.toContain('class="url"')
    expect(html).toContain(PARENT_PORTAL_QR_TEXT.guidance)
    expect(html).toContain(PARENT_PORTAL_QR_TEXT.caution)
    expect(html).toContain('onclick="window.print()"')
    expect(html).toContain('@media print { .print-button, .print-hint { display: none; }')
  })

  // 2026-09-18: 自由記述の連絡は廃止(spec-parent-portal §0-5)。紙の案内文が「教室へ何でも連絡できる」と読める文言に戻らないこと。
  it('案内文は「授業予定の確認とお休みの連絡」で、自由な連絡ができるとは書かない', () => {
    expect(PARENT_PORTAL_QR_TEXT.guidance).toContain('お休みの連絡')
    expect(PARENT_PORTAL_QR_TEXT.guidance).not.toContain('教室への連絡')
  })

  it('紙の案内文・注意文は 2026-10-10 の文言整理どおり(「第三者」を使わない)', () => {
    expect(PARENT_PORTAL_QR_TEXT.guidance).toBe('このQRから、お子さまの授業予定の確認とお休みの連絡ができます。')
    expect(PARENT_PORTAL_QR_TEXT.caution).toBe('ほかの方に見せないでください。紛失したときは教室へご連絡ください（再発行します）。')
    expect(PARENT_PORTAL_QR_TEXT.caution).not.toContain('第三者')
  })

  it('名前は HTML エスケープし、URL はエスケープ有無にかかわらず載せない', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '<b>x</b>', studentName: 'A&B', url: 'https://x/p/t?a=1&b=2', svg })
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('A&amp;B')
    expect(html).not.toContain('a=1&amp;b=2')
    expect(html).not.toContain('a=1&b=2')
  })

  it('空の名前はフォールバックし、生徒 ID などは載せない', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '  ', studentName: '', url: 'u', svg })
    expect(html).toContain('教室')
    expect(html).toContain('生徒 さん')
    expect(html).not.toContain('s001')
  })
})

// 2026-11-03 フリーメモ 20261103-152520476-06446053: A4 の中に名刺サイズで印刷。QR は右、左にロゴ・連絡先・生徒名・発行日・注意書き。
describe('保護者用QRの名刺サイズ印刷', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><path d="M0,0h1v1h-1z" fill="#000"/></svg>'
  const logo = 'data:image/png;base64,iVBORw0KGgo='

  it('名刺サイズ(91×55mm)の枠で、左にロゴ・連絡先・生徒名・発行日・注意書き、右に QR を並べる', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '開発用教室', studentName: '青木', url: 'https://x/p/t', svg, logoSrc: logo, contactText: 'スクール 開発校\nTEL 000-0000-0000', issuedDateKey: '2026-11-03' })
    expect(html).toContain('@page { size: A4 portrait;')
    expect(html).toContain('width: 91mm; height: 55mm;')
    const info = html.indexOf('class="info"')
    const qrSide = html.indexOf('class="qr-side"')
    expect(info).toBeGreaterThan(0)
    expect(qrSide).toBeGreaterThan(info) // 左=情報、右=QR
    const infoHtml = html.slice(info, qrSide)
    expect(infoHtml).toContain(`<img src="${logo}"`)
    expect(infoHtml).toContain('スクール 開発校<br>TEL 000-0000-0000')
    expect(infoHtml).toContain('青木 さん')
    expect(infoHtml).toContain('発行日 2026年11月3日')
    expect(infoHtml).toContain(PARENT_PORTAL_QR_TEXT.guidance)
    expect(infoHtml).toContain(PARENT_PORTAL_QR_TEXT.caution)
    expect(html.slice(qrSide)).toContain(svg)
  })

  it('連絡先が空なら教室名を出し、ロゴが無ければロゴの枠を出さない', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '開発用教室', studentName: '青木', url: 'u', svg, contactText: '  ', issuedDateKey: '2026-11-03' })
    expect(html).toContain('<div class="contact">開発用教室</div>')
    expect(html).not.toContain('class="logo"')
  })

  it('連絡先はエスケープし、画像でない src(javascript: など)はロゴに使わない', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: 'x', studentName: 'y', url: 'u', svg, logoSrc: 'javascript:alert(1)', contactText: '<b>校舎</b>' })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<b>校舎</b>')
    expect(html).toContain('&lt;b&gt;校舎&lt;/b&gt;')
    const quoted = buildParentPortalQrPrintHtml({ classroomName: 'x', studentName: 'y', url: 'u', svg, logoSrc: 'https://e.example/a"onerror="x.png' })
    expect(quoted).not.toContain('onerror')
  })

  it('発行日は YYYY-MM-DD だけを「年月日」にし、それ以外は出さない', () => {
    expect(formatParentPortalCardIssuedDate('2026-01-05')).toBe('2026年1月5日')
    expect(formatParentPortalCardIssuedDate('')).toBe('')
    expect(buildParentPortalQrPrintHtml({ classroomName: 'x', studentName: 'y', url: 'u', svg })).not.toContain('発行日')
  })

  it('ロゴと連絡先は生徒日程表と同じ鍵(schedule-shared:<教室ID>:global:…)から読む・ロゴが無ければ会社の既定ロゴ', () => {
    expect(buildScheduleSharedGlobalStorageKey('v8OZ7zH8vONNHjjYVcR1', 'logo')).toBe('schedule-shared:v8OZ7zH8vONNHjjYVcR1:global:logo')
    expect(buildScheduleSharedGlobalStorageKey(null, 'school-info')).toBe('schedule-shared:default:global:school-info')
    const values: Record<string, string> = {
      'schedule-shared:room1:global:logo': logo,
      'schedule-shared:room1:global:school-info': '開発校\nTEL',
    }
    const storage = { getItem: (key: string) => values[key] ?? null }
    expect(readParentPortalCardBranding({ storage, classroomId: 'room1' })).toEqual({ logoSrc: logo, contactText: '開発校\nTEL' })
    expect(readParentPortalCardBranding({ storage, classroomId: 'room2', defaultLogoUrl: '/company-logo.png' })).toEqual({ logoSrc: '/company-logo.png', contactText: '' })
    const throwing = { getItem: () => { throw new Error('blocked') } }
    expect(readParentPortalCardBranding({ storage: throwing, classroomId: 'room1' })).toEqual({ logoSrc: '', contactText: '' })
  })

  it('生徒日程表の保存鍵と同じ形を使っている(scheduleHtml の STORAGE_SCOPE・sharedGlobalStoragePrefix)', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../utils/scheduleHtml.ts', import.meta.url), 'utf8')
    expect(source).toContain("const STORAGE_SCOPE = encodeURIComponent(String(DATA.classroomStorageKey || 'default'));")
    expect(source).toContain("const sharedGlobalStoragePrefix = 'schedule-shared:' + STORAGE_SCOPE + ':global:';")
    expect(source).toContain("storage.getItem(sharedGlobalStoragePrefix + 'logo')")
    expect(source).toContain("if (sharedKey === 'school-info') return sharedGlobalStoragePrefix + sharedKey;")
  })
})

// 戻し互換(2026-11-08・全教室展開した parentPortalQr をすぐ OFF に戻せるようにする準備・INV-06)。
// OFF の版でも生徒データの写しトークン(parentPortalToken と発行元教室タグ parentPortalTokenClassroomId・spec-parent-portal §0/§B)
// を剥がさない。剥がすと ON に戻したとき配った紙の QR と画面の QR が別のトークンになる(再発行が要る)。
// サーバー側の OFF(403・トークンは失効させない)は functions/src/parentPortal.test.ts が固定済み。
describe('戻し互換: フラグ OFF の版でも保護者QRの写しトークンを消さない(2026-11-08)', () => {
  const issued = createStudent({ parentPortalToken: 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAA', parentPortalTokenClassroomId: DEV_CLASSROOM_ID })
  const other = createStudent({ id: 's002', name: '生徒B', displayName: '生徒B' })
  const settings = { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2 } as unknown as ClassroomSettings
  const snapshot = { screen: 'board', classroomSettings: settings, managers: [], teachers: [], students: [issued, other], regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [], boardState: null, schemaVersion: 1, savedAt: 'x' } as unknown as AppSnapshot
  const tokenFields = (rows: StudentRow[]) => rows.map((row) => [row.id, row.parentPortalToken ?? null, row.parentPortalTokenClassroomId ?? null])
  const EXPECTED = [['s001', 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAA', DEV_CLASSROOM_ID], ['s002', null, null]]

  it('OFF の画面は QR を出さないだけで、行の写しはそのまま。ON に戻すと同じトークンの QR を出す(再発行しない)', () => {
    const before = structuredClone(issued)
    expect(resolveParentPortalQrRowState({ ...enabledParams, enabled: false, student: issued })).toBe('hidden')
    expect(issued).toEqual(before)
    expect(resolveParentPortalQrRowState({ ...enabledParams, enabled: true, student: issued })).toBe('show')
  })

  it('JSON の書き出し/読み込み・分割保存の部品の往復・Excel 差分取込で写しが残る', () => {
    expect(tokenFields(parseAppSnapshot(serializeAppSnapshot(snapshot)).students)).toEqual(EXPECTED)
    const split = splitClassroomSnapshotPayload(snapshot)
    const assembled = assembleClassroomSnapshotPayload({ core: split.core, board: split.board, weeks: split.weeks.map((week) => week.cells), ui: split.ui, hasBoardState: split.hasBoardState }) as { students: StudentRow[] }
    expect(tokenFields(assembled.students)).toEqual(EXPECTED)
    const imported = { managers: [], teachers: [], students: [createStudent(), { ...other }], classroomSettings: settings }
    const merged = mergeImportedBundle(imported as never, { managers: [], teachers: [], students: [issued, other], classroomSettings: settings } as never)
    expect(tokenFields(merged.students)).toEqual(EXPECTED)
  })

  it('盤面の読み込み(createInitialBoardSnapshot)は名簿の写しに触れない', () => {
    const students = [structuredClone(issued), structuredClone(other)]
    createInitialBoardSnapshot({ classroomSettings: settings, teachers: [], students, regularLessons: [], initialBoardState: null })
    expect(tokenFields(students)).toEqual(EXPECTED)
  })

  it('App でフラグを見る箇所は写しを剥がさない(剥がすのは開発用教室へのコピーと報告の持ち出しの 2 か所だけで、フラグに依らない)', () => {
    const app = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
    for (const line of app.split(/\r?\n/).filter((entry) => entry.includes('parentPortalQrEnabled'))) {
      expect(line).not.toMatch(/strip|delete /)
    }
    expect(app.match(/stripParentPortalTokensFromStudents(<\w+>)?\(/g)?.length).toBe(2)
    expect(app).not.toContain('stripForeignParentPortalToken')
  })
})

// ★ 全員分印刷(spec-parent-portal §K-6「全員分印刷（オーナー指示 2026-11-14）」)。
describe('保護者用QRの全員分印刷: 対象と押せるかの判定', () => {
  const roster = [
    createStudent({ id: 's010', name: '名簿 一', parentPortalToken: 'tok-a', parentPortalTokenClassroomId: DEV_CLASSROOM_ID }),
    createStudent({ id: 's002', name: '名簿 二' }),
    createStudent({ id: 's003', name: '退塾 三', withdrawDate: '2026-08-31' }),
    createStudent({ id: 's004', name: '入塾前 四', entryDate: '2026-10-01' }),
    createStudent({ id: 's005', name: '他教室 五', parentPortalToken: 'tok-x', parentPortalTokenClassroomId: 'other' }),
  ]

  it('今日在籍中の生徒だけを名簿の並び順で対象にし、未発行(issue)の人数を数える', () => {
    const plan = resolveBulkParentPortalQrPlan({ ...enabledParams, students: roster, savedStudentIds: null })
    expect(plan.targets.map((student) => student.id)).toEqual(['s010', 's002', 's005'])
    expect(plan.issueCount).toBe(2)
    expect(plan.pendingSaveStudents).toEqual([])
    expect(plan.canPrint).toBe(true)
  })

  it('削除済み(deletedAt)の生徒は在籍中でも対象にしない', () => {
    const plan = resolveBulkParentPortalQrPlan({ ...enabledParams, students: [...roster, createStudent({ id: 's006', deletedAt: '2026-09-01T00:00:00Z' })], savedStudentIds: null })
    expect(plan.targets.map((student) => student.id)).not.toContain('s006')
  })

  it('保存が終わっていない生徒が 1 人でもいれば押せない', () => {
    const plan = resolveBulkParentPortalQrPlan({ ...enabledParams, students: roster, savedStudentIds: new Set(['s010', 's005']) })
    expect(plan.pendingSaveStudents.map((student) => student.id)).toEqual(['s002'])
    expect(plan.canPrint).toBe(false)
  })

  it('フラグ OFF・リモート無し・在籍 0 人では対象なしで押せない', () => {
    expect(resolveBulkParentPortalQrPlan({ ...enabledParams, enabled: false, students: roster, savedStudentIds: null })).toMatchObject({ targets: [], canPrint: false })
    expect(resolveBulkParentPortalQrPlan({ ...enabledParams, remoteEnabled: false, students: roster, savedStudentIds: null })).toMatchObject({ targets: [], canPrint: false })
    expect(resolveBulkParentPortalQrPlan({ ...enabledParams, students: [roster[2]], savedStudentIds: null })).toMatchObject({ targets: [], canPrint: false })
  })

  it('対象の判定は 1 人分の行判定(resolveParentPortalQrRowState)と食い違わない(削除済みでない生徒)', () => {
    const plan = resolveBulkParentPortalQrPlan({ ...enabledParams, students: roster, savedStudentIds: null })
    const rowTargets = roster.filter((student) => resolveParentPortalQrRowState({ ...enabledParams, student, savedStudentIds: null }) !== 'hidden')
    expect(plan.targets).toEqual(rowTargets)
  })

  it('確認文は「在籍◯人分を印刷します（未発行の◯人は新しく発行します）」で、未発行 0 人なら括弧を付けない', () => {
    expect(buildParentPortalQrBulkConfirmMessage({ total: 12, issueCount: 3 })).toBe('在籍12人分を印刷します（未発行の3人は新しく発行します）')
    expect(buildParentPortalQrBulkConfirmMessage({ total: 5, issueCount: 0 })).toBe('在籍5人分を印刷します')
  })

  it('ボタンの文言: 平常は「全員分印刷」、実行中は「作成中 n/N」、保存待ちの案内文', () => {
    expect(PARENT_PORTAL_QR_TEXT.bulkPrintLabel).toBe('全員分印刷')
    expect(buildParentPortalQrBulkProgressLabel(3, 10)).toBe('作成中 3/10')
    expect(PARENT_PORTAL_QR_TEXT.bulkPendingSave).toBe('保存が終わると全員分を印刷できます')
  })
})

describe('保護者用QRの全員分印刷: 発行の順番処理', () => {
  const targets = ['s001', 's002', 's003', 's004', 's005', 's006'].map((id) => createStudent({ id, name: `生徒 ${id}` }))

  it('全員に reissue:false で問い合わせ、結果は名簿の順に並べ、進み具合を 1/N〜N/N で知らせる', async () => {
    const calls: Array<{ id: string; reissue: boolean }> = []
    const progress: Array<[number, number]> = []
    let active = 0
    let maxActive = 0
    const result = await issueParentPortalTokensForBulkPrint({
      targets,
      concurrency: 2,
      issue: async (id, options) => {
        calls.push({ id, reissue: options.reissue })
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, id === 's001' ? 5 : 1))
        active -= 1
        return { token: `tok-${id}` }
      },
      onProgress: (done, total) => progress.push([done, total]),
    })
    expect(calls.map((call) => call.id).sort()).toEqual(targets.map((student) => student.id))
    expect(calls.every((call) => call.reissue === false)).toBe(true)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(result.succeeded.map((entry) => [entry.student.id, entry.token])).toEqual(targets.map((student) => [student.id, `tok-${student.id}`]))
    expect(result.failed).toEqual([])
    expect(progress.map(([done]) => done)).toEqual([1, 2, 3, 4, 5, 6])
    expect(progress.every(([, total]) => total === 6)).toBe(true)
  })

  it('一部が失敗しても残りは続け、成功した生徒だけを返し、失敗した生徒を別に返す', async () => {
    const result = await issueParentPortalTokensForBulkPrint({
      targets,
      issue: async (id) => {
        if (id === 's002' || id === 's005') throw new Error('network')
        return { token: `tok-${id}` }
      },
    })
    expect(result.succeeded.map((entry) => entry.student.id)).toEqual(['s001', 's003', 's004', 's006'])
    expect(result.failed.map((entry) => entry.student.id)).toEqual(['s002', 's005'])
  })

  it('全員失敗なら成功は空', async () => {
    const result = await issueParentPortalTokensForBulkPrint({ targets, issue: async () => { throw new Error('down') } })
    expect(result.succeeded).toEqual([])
    expect(result.failed).toHaveLength(targets.length)
  })

  it('結果の文言: 失敗した生徒の名前を出す・全員失敗は印刷しないと伝える・写しが変わったら保存を促す', () => {
    expect(buildParentPortalQrBulkResultMessage({ failedNames: [], tokensChanged: false, allFailed: false })).toBe('')
    expect(buildParentPortalQrBulkResultMessage({ failedNames: [], tokensChanged: true, allFailed: false })).toBe(PARENT_PORTAL_QR_TEXT.issued)
    const partial = buildParentPortalQrBulkResultMessage({ failedNames: ['青木', '井上'], tokensChanged: true, allFailed: false })
    expect(partial).toContain('青木、井上')
    expect(partial).toContain(PARENT_PORTAL_QR_TEXT.issued)
    const all = buildParentPortalQrBulkResultMessage({ failedNames: ['青木'], tokensChanged: false, allFailed: true })
    expect(all).toContain('印刷していません')
    expect(all).toContain('青木')
  })
})

describe('保護者用QRの全員分印刷: 印刷 HTML', () => {
  const svg = '<svg data-test="qr"></svg>'
  const card = { svg, logoSrc: '/logo.png', contactText: '日大前校\nTEL 03-0000-0000', issuedDateKey: '2026-11-14' }

  it('1 生徒 1 ページで、最後のページ以外だけ改ページする', () => {
    const html = buildParentPortalQrBulkPrintHtml({ ...card, classroomName: '開発用教室', cards: [{ studentName: '青木', svg }, { studentName: '井上', svg }, { studentName: '上田', svg }] })
    expect(html.match(/class="card"/g)).toHaveLength(3)
    expect(html.match(/<section class="page( page-break)?"/g)).toHaveLength(3)
    expect(html.match(/<section class="page page-break"/g)).toHaveLength(2)
    expect(html.lastIndexOf('<section class="page"')).toBeGreaterThan(html.lastIndexOf('page page-break"'))
    expect(html).toMatch(/\.page-break \{[^}]*break-after: page;[^}]*page-break-after: always;/)
    expect(html.indexOf('青木')).toBeLessThan(html.indexOf('井上'))
    expect(html.indexOf('井上')).toBeLessThan(html.indexOf('上田'))
    expect(html.match(/<button class="print-button"/g)).toHaveLength(1)
  })

  it('各ページの名刺は 1 人分の印刷と同じ中身(同じロゴ・連絡先・発行日・CSS)', () => {
    const single = buildParentPortalQrPrintHtml({ ...card, classroomName: '開発用教室', studentName: '青木', url: 'https://example.test/p/x' })
    const bulk = buildParentPortalQrBulkPrintHtml({ ...card, classroomName: '開発用教室', cards: [{ studentName: '青木', svg }] })
    const cardOf = (html: string) => html.slice(html.indexOf('<div class="card">'), html.indexOf('</body>'))
    const singleCard = cardOf(single).replace(/\s+$/u, '')
    expect(bulk).toContain(singleCard)
    const styleOf = (html: string) => html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    expect(styleOf(bulk)).toContain(styleOf(single).slice('<style>'.length, styleOf(single).indexOf('@media print')))
    expect(bulk).toContain('発行日 2026年11月14日')
    expect(bulk).toContain('TEL 03-0000-0000')
    expect(bulk).toContain('<img src="/logo.png"')
  })

  it('名前はエスケープする', () => {
    const html = buildParentPortalQrBulkPrintHtml({ ...card, classroomName: '<教室>', cards: [{ studentName: '<script>x</script>', svg }] })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; さん')
  })

  it('先に開いた印刷ウィンドウへ書き込む(ポップアップブロック回避のため開くのは押した直後)', () => {
    const written: string[] = []
    const events: string[] = []
    const fakeWindow = { document: { open: () => events.push('open'), write: (value: string) => written.push(value), close: () => events.push('close') } }
    writeParentPortalQrPrintWindow(fakeWindow, '<html>x</html>')
    expect(events).toEqual(['open', 'close'])
    expect(written).toEqual(['<html>x</html>'])
  })
})

describe('保護者用QRモーダルの「全員分印刷」ボタン', () => {
  const baseProps = { classroomName: '開発用教室', studentName: '青木', url: 'https://example.test/p/x', svg: '<svg></svg>', isLoading: false, error: null, busy: false, onReissue: () => {}, onPrint: () => {}, onClose: () => {}, onPrintAll: () => {} }
  const render = (props: Partial<ParentPortalQrModalProps>) => renderToStaticMarkup(createElement(ParentPortalQrModal, { ...baseProps, ...props }))
  const buttonOf = (html: string, testId: string) => {
    const start = html.lastIndexOf('<button', html.indexOf(`data-testid="${testId}"`))
    return html.slice(start, html.indexOf('</button>', start))
  }

  it('「印刷」の隣に「全員分印刷」がある', () => {
    const html = render({})
    const bulk = buttonOf(html, 'parent-portal-qr-print-all-button')
    expect(bulk).toContain('全員分印刷')
    expect(bulk).not.toContain('disabled')
    expect(html.indexOf('parent-portal-qr-print-button')).toBeLessThan(html.indexOf('parent-portal-qr-print-all-button'))
    expect(html.indexOf('parent-portal-qr-print-all-button')).toBeLessThan(html.indexOf('parent-portal-qr-reissue-button'))
  })

  it('1 人分の QR がエラーでも押せるが、読み込み中・再発行中は押せない', () => {
    expect(buttonOf(render({ error: 'x', svg: '' }), 'parent-portal-qr-print-all-button')).not.toContain('disabled')
    expect(buttonOf(render({ isLoading: true }), 'parent-portal-qr-print-all-button')).toContain('disabled')
    expect(buttonOf(render({ busy: true }), 'parent-portal-qr-print-all-button')).toContain('disabled')
  })

  it('保存待ちの生徒がいれば押せず、案内文を出す', () => {
    const html = render({ bulkPrintDisabled: true, bulkPrintNote: PARENT_PORTAL_QR_TEXT.bulkPendingSave })
    expect(buttonOf(html, 'parent-portal-qr-print-all-button')).toContain('disabled')
    expect(html).toContain('保存が終わると全員分を印刷できます')
  })

  it('実行中はボタンに「作成中 n/N」を出し、ほかのボタンも閉じるも押せない', () => {
    const html = render({ bulkProgress: { done: 2, total: 7 } })
    expect(buttonOf(html, 'parent-portal-qr-print-all-button')).toContain('作成中 2/7')
    for (const testId of ['parent-portal-qr-print-all-button', 'parent-portal-qr-print-button', 'parent-portal-qr-reissue-button', 'parent-portal-qr-close-button']) {
      expect(buttonOf(html, testId)).toContain('disabled')
    }
  })

  it('失敗した生徒の名前などの結果をモーダルに出す', () => {
    expect(render({ bulkMessage: '次の生徒は印刷に含めていません: 青木' })).toContain('次の生徒は印刷に含めていません: 青木')
  })

  it('押すとモーダル内に確認文と「印刷する」「やめる」を出す(window.confirm は使わない)', () => {
    const html = render({ bulkConfirmMessage: '在籍3人分を印刷します', onConfirmPrintAll: () => {}, onCancelPrintAll: () => {} })
    expect(html).toContain('在籍3人分を印刷します')
    expect(buttonOf(html, 'parent-portal-qr-print-all-confirm-button')).toContain('印刷する')
    expect(buttonOf(html, 'parent-portal-qr-print-all-cancel-button')).toContain('やめる')
    // 確認中は「全員分印刷」をもう一度押せない。
    expect(buttonOf(html, 'parent-portal-qr-print-all-button')).toContain('disabled')
  })

  it('onPrintAll が無ければボタンを出さない', () => {
    expect(render({ onPrintAll: undefined })).not.toContain('parent-portal-qr-print-all-button')
  })
})

describe('全員分印刷の画面側の配線(BasicDataScreen)', () => {
  const screen = readFileSync(fileURLToPath(new URL('./BasicDataScreen.tsx', import.meta.url)), 'utf8')
  const confirmBody = screen.slice(screen.indexOf('const confirmPrintAllParentPortalQr = ('), screen.indexOf('const teacherEditorModalConfig'))

  it('window.confirm は使わず、モーダル内の「印刷する」のクリックで同期的にウィンドウを開き、開けなければ中止する', () => {
    expect(screen).not.toContain('window.confirm(buildParentPortalQrBulkConfirmMessage(')
    expect(confirmBody.length).toBeGreaterThan(0)
    const openIndex = confirmBody.indexOf('openBlankParentPortalQrPrintWindow()')
    expect(openIndex).toBeGreaterThan(-1)
    // 開くまでに await を挟まない(ユーザー操作の扱いが切れるとポップアップが止められる)。
    expect(confirmBody.slice(0, openIndex)).not.toContain('await ')
    expect(confirmBody.slice(openIndex, confirmBody.indexOf('runParentPortalQrBulkPrint('))).toContain('PARENT_PORTAL_QR_TEXT.printBlocked')
  })

  it('対象は行の QR ボタンと同じ在籍一覧(activeStudentRows)から作る', () => {
    expect(screen).toContain('resolveBulkParentPortalQrPlan({ students: activeStudentRows,')
    expect(screen).not.toContain('resolveBulkParentPortalQrPlan({ students,')
  })

  it('実行中の番号と押した時点の教室を握り、閉じた・画面を離れた・教室が変わったら続けない(INV-08)', () => {
    expect(screen).toContain('bulkRunIdRef')
    expect(confirmBody).toContain('shouldContinue: () => bulkRunIdRef.current === runId && classroomIdRef.current === runClassroomId')
  })

  it('例外でも finally で進み具合を必ず消す(モーダルが閉じられなくならない)', () => {
    // React Compiler が try/finally を扱えない(画面全体の最適化と lint が止まる)ので、Promise の .finally で書く。
    expect(confirmBody).not.toContain('finally {')
    const finallyIndex = confirmBody.indexOf('.finally(')
    expect(finallyIndex).toBeGreaterThan(-1)
    expect(confirmBody.slice(finallyIndex, finallyIndex + 200)).toContain('progress: null')
    // 本体の失敗(拒否)も文言にして終わらせる。
    expect(confirmBody).toContain('.then((result) => result.message, (error: unknown) =>')
  })

  it('再発行はしない・写しの反映は updateStudent で行う', () => {
    expect(confirmBody).not.toContain('reissue: true')
    expect(confirmBody).toContain('updateStudent(')
    expect(confirmBody).toContain('parentPortalTokenClassroomId: runClassroomId')
  })
})

describe('全員分印刷の本体(runParentPortalQrBulkPrint)', () => {
  const targets = ['s001', 's002', 's003', 's004'].map((id) => createStudent({ id, name: `生徒 ${id}`, displayName: `表示${id}` }))
  const createFakeWindow = () => {
    const writes: string[] = []
    const fake = {
      closed: false,
      closeCount: 0,
      close() { fake.closed = true; fake.closeCount += 1 },
      document: { open: () => undefined, write: (html: string) => { writes.push(html) }, close: () => undefined },
    }
    return { fake, writes }
  }
  const baseParams = (overrides: Partial<Parameters<typeof runParentPortalQrBulkPrint>[0]> = {}) => {
    const { fake } = createFakeWindow()
    return {
      targets,
      classroomId: DEV_CLASSROOM_ID,
      printWindow: fake,
      issue: async (id: string) => ({ token: `tok-${id}` }),
      shouldContinue: () => true,
      getStudentName: (student: StudentRow) => student.displayName,
      buildQrSvg: (token: string) => `<svg>${token}</svg>`,
      buildHtml: (cards: Array<{ studentName: string; svg: string }>) => `BULK:${cards.map((card) => card.studentName).join(',')}`,
      applyToken: () => {},
      ...overrides,
    }
  }

  it('開いた直後のウィンドウに「作成中…」だけを書き、そのあと全員分の HTML を書く', async () => {
    const { fake, writes } = createFakeWindow()
    let placeholderBeforeIssue = false
    const result = await runParentPortalQrBulkPrint(baseParams({
      printWindow: fake,
      issue: async (id) => { placeholderBeforeIssue = writes.length === 1; return { token: `tok-${id}` } },
    }))
    expect(placeholderBeforeIssue).toBe(true)
    expect(writes[0]).toContain('作成中…')
    expect(writes[1]).toBe('BULK:表示s001,表示s002,表示s003,表示s004')
    expect(result.outcome).toBe('printed')
    expect(fake.closeCount).toBe(0)
  })

  it('写しと違うトークンだけ反映し、反映したら保存を促す', async () => {
    const applied: Array<[string, string]> = []
    const withCopies = [
      createStudent({ id: 's001', parentPortalToken: 'tok-s001', parentPortalTokenClassroomId: DEV_CLASSROOM_ID }),
      createStudent({ id: 's002', parentPortalToken: 'old', parentPortalTokenClassroomId: DEV_CLASSROOM_ID }),
      createStudent({ id: 's003', parentPortalToken: 'tok-s003', parentPortalTokenClassroomId: 'other' }),
    ]
    const result = await runParentPortalQrBulkPrint(baseParams({ targets: withCopies, applyToken: (id, token) => applied.push([id, token]) }))
    expect(applied).toEqual([['s002', 'tok-s002'], ['s003', 'tok-s003']])
    expect(result.message).toContain(PARENT_PORTAL_QR_TEXT.issued)
    const unchanged = await runParentPortalQrBulkPrint(baseParams({ targets: [withCopies[0]] }))
    expect(unchanged.message).toBe('')
  })

  it('失敗した生徒の名前は終わった順でなく名簿の順に並べ、成功した分だけ印刷する', async () => {
    const result = await runParentPortalQrBulkPrint(baseParams({
      concurrency: 4,
      issue: async (id) => {
        if (id === 's001') { await new Promise((resolve) => setTimeout(resolve, 10)); throw new Error('slow fail') }
        if (id === 's003') throw new Error('fast fail')
        return { token: `tok-${id}` }
      },
      // QR の URL が作れない生徒も失敗に数える。
      buildQrSvg: (token) => (token === 'tok-s004' ? null : `<svg>${token}</svg>`),
    }))
    expect(result.outcome).toBe('printed')
    expect(result.message).toContain('表示s001、表示s003、表示s004')
  })

  it('全員失敗ならウィンドウを閉じて印刷しない', async () => {
    const { fake, writes } = createFakeWindow()
    const result = await runParentPortalQrBulkPrint(baseParams({ printWindow: fake, issue: async () => { throw new Error('down') } }))
    expect(result.outcome).toBe('all-failed')
    expect(fake.closeCount).toBe(1)
    expect(writes).toHaveLength(1)
    expect(result.message).toContain('印刷していません')
  })

  it('印刷ウィンドウが途中で閉じられていたら書かずに案内を出す(写しの反映はする)', async () => {
    const { fake, writes } = createFakeWindow()
    const applied: string[] = []
    const result = await runParentPortalQrBulkPrint(baseParams({
      printWindow: fake,
      issue: async (id) => { fake.closed = true; return { token: `tok-${id}` } },
      applyToken: (id) => applied.push(id),
    }))
    expect(result.outcome).toBe('window-closed')
    expect(writes).toHaveLength(1)
    expect(result.message).toContain(PARENT_PORTAL_QR_TEXT.bulkWindowClosed)
    expect(applied).toHaveLength(targets.length)
  })

  it('続けてはいけなくなったら(閉じた・画面を離れた・教室が変わった)残りを投げず、写しも反映せず、ウィンドウを閉じる(INV-08)', async () => {
    const { fake } = createFakeWindow()
    const issued: string[] = []
    const applied: string[] = []
    let allowed = true
    const result = await runParentPortalQrBulkPrint(baseParams({
      printWindow: fake,
      concurrency: 1,
      shouldContinue: () => allowed,
      issue: async (id) => { issued.push(id); if (id === 's002') allowed = false; return { token: `tok-${id}` } },
      applyToken: (id) => applied.push(id),
    }))
    expect(result.outcome).toBe('cancelled')
    expect(issued).toEqual(['s001', 's002'])
    expect(applied).toEqual([])
    expect(fake.closeCount).toBe(1)
    expect(result.message).toBe('')
  })

  it('途中で例外が出ても投げ返さず、ウィンドウを閉じてエラーを返す', async () => {
    const { fake } = createFakeWindow()
    const result = await runParentPortalQrBulkPrint(baseParams({ printWindow: fake, buildHtml: () => { throw new Error('boom') } }))
    expect(result.outcome).toBe('error')
    expect(result.message).toContain('boom')
    expect(fake.closeCount).toBe(1)
  })
})

describe('全員分印刷: 続けてよいか(shouldContinue)', () => {
  it('false になったら次の生徒を投げず、cancelled を返す', async () => {
    const targets = ['s001', 's002', 's003'].map((id) => createStudent({ id }))
    const issued: string[] = []
    let allowed = true
    const result = await issueParentPortalTokensForBulkPrint({
      targets,
      concurrency: 1,
      shouldContinue: () => allowed,
      issue: async (id) => { issued.push(id); allowed = false; return { token: `tok-${id}` } },
    })
    expect(issued).toEqual(['s001'])
    expect(result.cancelled).toBe(true)
  })

  it('最後まで続けられたら cancelled は false', async () => {
    const result = await issueParentPortalTokensForBulkPrint({ targets: [createStudent()], shouldContinue: () => true, issue: async () => ({ token: 't' }) })
    expect(result.cancelled).toBe(false)
  })
})

describe('1 人分の印刷 HTML は全員分印刷の追加で変わらない(完全一致・2026-11-14)', () => {
  it('既知の入力に対する出力が一字一句同じ', () => {
    const html = buildParentPortalQrPrintHtml({ classroomName: '開発用教室', studentName: '青木 <太郎>', url: 'https://example.test/p/x', svg: '<svg data-test="qr"></svg>', logoSrc: '/logo.png', contactText: '開発用校\nTEL 03-0000-0000', issuedDateKey: '2026-11-14' })
    expect(html).toBe(PINNED_SINGLE_PRINT_HTML)
  })
})

const PINNED_SINGLE_PRINT_HTML = "<!DOCTYPE html>\n<html lang=\"ja\">\n<head>\n<meta charset=\"utf-8\">\n<title>保護者用QR 青木 &lt;太郎&gt;</title>\n<style>\n  @page { size: A4 portrait; margin: 15mm; }\n  * { box-sizing: border-box; }\n  body { font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif; color: #111; margin: 0; padding: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n  .card { width: 91mm; height: 55mm; border: 0.3mm dashed #888; padding: 3.5mm; display: flex; gap: 3mm; overflow: hidden; background: #fff; }\n  .info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1mm; }\n  .logo img { display: block; max-width: 40mm; max-height: 9mm; object-fit: contain; }\n  .contact { font-size: 6.5pt; line-height: 1.35; color: #333; }\n  .student { font-size: 11pt; font-weight: 700; margin-top: 0.5mm; }\n  .issued { font-size: 6pt; color: #555; }\n  .notes { margin-top: auto; font-size: 5.5pt; line-height: 1.4; color: #333; }\n  .notes p { margin: 0; }\n  .notes .caution { color: #7a2e2e; }\n  .qr-side { flex: 0 0 31mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1mm; }\n  .qr svg { display: block; width: 31mm; height: 31mm; }\n  .qr-label { font-size: 6pt; font-weight: 700; color: #1f5d96; }\n  .print-button { display: block; margin: 0 0 8px; padding: 8px 16px; font-size: 14px; cursor: pointer; }\n  .print-hint { margin: 0 0 12px; font-size: 13px; color: #555; }\n  @media print { .print-button, .print-hint { display: none; } body { padding: 0; } }\n</style>\n</head>\n<body>\n<button class=\"print-button\" onclick=\"window.print()\">印刷</button>\n<p class=\"print-hint\">A4 用紙の左上に名刺サイズ(91×55mm)で印刷します。点線で切り取ってください。印刷の設定は「倍率 100%(実際のサイズ)」にしてください。</p>\n<div class=\"card\">\n  <div class=\"info\">\n    <div class=\"logo\"><img src=\"/logo.png\" alt=\"\"></div>\n    <div class=\"contact\">開発用校<br>TEL 03-0000-0000</div>\n    <div class=\"student\">青木 &lt;太郎&gt; さん</div>\n    <div class=\"issued\">発行日 2026年11月14日</div>\n    <div class=\"notes\">\n      <p class=\"guidance\">このQRから、お子さまの授業予定の確認とお休みの連絡ができます。</p>\n      <p class=\"caution\">ほかの方に見せないでください。紛失したときは教室へご連絡ください（再発行します）。</p>\n    </div>\n  </div>\n  <div class=\"qr-side\">\n    <div class=\"qr\"><svg data-test=\"qr\"></svg></div>\n    <div class=\"qr-label\">保護者用QR</div>\n  </div>\n</div>\n</body>\n</html>"
