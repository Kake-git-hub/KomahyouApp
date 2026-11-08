import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { StudentRow } from './basicDataModel'
import { parseAppSnapshot, serializeAppSnapshot } from '../../data/appSnapshotRepository'
import { assembleClassroomSnapshotPayload, splitClassroomSnapshotPayload } from '../../utils/classroomSnapshotParts'
import type { AppSnapshot, ClassroomSettings } from '../../types/appState'
import { createInitialBoardSnapshot } from '../schedule-board/ScheduleBoardScreen'
import { mergeImportedBundle } from './BasicDataScreen'
import { PARENT_PORTAL_QR_TEXT, buildParentPortalQrPrintHtml, buildScheduleSharedGlobalStorageKey, formatParentPortalCardIssuedDate, readParentPortalCardBranding, resolveParentPortalQrRowState, resolveSavedStudentIds } from './parentPortalQr'

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
