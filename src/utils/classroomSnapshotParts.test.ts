import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sanitizeForFirestore } from '../integrations/firebase/firestoreSanitize'
import {
  assembleClassroomSnapshotFromParts,
  assembleClassroomSnapshotPayload,
  buildSnapshotCompositeHashInput,
  buildSnapshotCompositeHashInputFromManifest,
  buildSnapshotPartDocId,
  buildSnapshotPartHashInput,
  buildSnapshotPartHashMapFromManifest,
  buildSnapshotWeekPartKey,
  isSnapshotPartsManifest,
  listSnapshotPartContents,
  listSnapshotPartReferences,
  parseSnapshotPartKey,
  readClassroomSnapshotFromParts,
  resolveSnapshotPartGcActions,
  resolveSnapshotPartsToSend,
  resolveSnapshotWeekKeys,
  sanitizeSnapshotValue,
  SNAPSHOT_BOARD_UI_FIELDS,
  SNAPSHOT_PART_GC_GRACE_DAYS,
  SNAPSHOT_PARTS_NODATE_WEEK_KEY,
  SNAPSHOT_PARTS_STORAGE_FORMAT,
  SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
  SnapshotPartsAssemblyError,
  splitClassroomSnapshotPayload,
  stableStringifySnapshotValue,
  stripSnapshotWeekKeySuffix,
  validateSnapshotPartsManifest,
  type SnapshotPartsManifest,
} from './classroomSnapshotParts'

// 今日の読み取り結果(workspaceStore.ts / functions index.ts の deserializeSnapshotPayload)の写し。同一性の約束(AC-1)の比較相手。
function deserializeLikeToday(payload: Record<string, unknown>) {
  const boardState = payload.boardState
  const deserializedBoard = !boardState || typeof boardState !== 'object'
    ? null
    : {
      ...(boardState as Record<string, unknown>),
      weeks: (Array.isArray((boardState as { weeks?: unknown }).weeks) ? (boardState as { weeks: unknown[] }).weeks : []).map((week) => {
        if (Array.isArray(week)) return week
        return Array.isArray((week as { cells?: unknown })?.cells) ? (week as { cells: unknown[] }).cells : []
      }),
    }
  return { ...payload, boardState: deserializedBoard }
}

function sha256(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function buildWeek(dateKeys: string[], label: string) {
  return dateKeys.flatMap((dateKey) => [1, 2].map((slot) => ({
    id: `${dateKey}#${slot}`,
    dateKey,
    dayLabel: label,
    slotNumber: slot,
    desks: [{ students: [{ studentId: `s${slot}`, lessonType: 'regular' }], teacherId: `t${slot}`, note: label }],
  })))
}

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    screen: 'board',
    classroomSettings: { deskCount: 14, holidayDates: ['2026-05-04'], regularLessonTemplate: { cells: [] } },
    managers: [{ id: 'm1', name: '室長A' }],
    teachers: [{ id: 't1', name: '講師A' }, { id: 't2', name: '講師B' }],
    students: [{ id: 's1', name: '生徒A', grade: '中3' }, { id: 's2', name: '生徒B' }],
    regularLessons: [{ id: 'r1', studentId: 's1', weekday: 1 }],
    groupLessons: [],
    specialSessions: [{ id: 'ss1', name: '夏期講習', studentInputs: { s1: { countSubmitted: true } } }],
    autoAssignRules: [],
    pairConstraints: [],
    futureUnknownField: { nested: ['keep', 'me'] },
    boardState: {
      weeks: [
        buildWeek(['2026-05-11', '2026-05-12'], '月火'),
        buildWeek(['2026-05-18', '2026-05-19'], '月火'),
        buildWeek(['2026-05-25'], '月'),
      ],
      weekIndex: 1,
      selectedCellId: '2026-05-18#1',
      selectedDeskIndex: 3,
      isLectureStockOpen: false,
      isMakeupStockOpen: true,
      studentScheduleRange: null,
      teacherScheduleRange: { from: '2026-05-01', to: '2026-05-31' },
      suppressedRegularLessonOccurrences: ['s1|2026-05-11|1'],
      scheduleCountAdjustments: [{ studentId: 's1', delta: -1 }],
      manualMakeupAdjustments: {},
      suppressedMakeupOrigins: {},
      fallbackMakeupStudents: {},
      manualLectureStockCounts: { s1__数学: 2 },
      manualLectureStockOrigins: {},
      fallbackLectureStockStudents: {},
      groupClassEntries: {},
      boardFutureUnknownField: 'keep',
    },
    ...overrides,
  }
}

function expectIdentity(payload: Record<string, unknown>) {
  const split = splitClassroomSnapshotPayload(payload)
  const assembled = assembleClassroomSnapshotPayload({
    core: split.core,
    board: split.board,
    weeks: split.weeks.map((week) => week.cells),
    ui: split.ui,
    hasBoardState: split.hasBoardState,
  })
  const expected = deserializeLikeToday(sanitizeForFirestore(payload) as Record<string, unknown>)
  expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(expected))
  return { split, assembled }
}

// 分割結果から目次と部品(ハッシュ付き)を作る(段階 B のサーバーの書き手が行う計算の最小版・テスト用)。
function buildManifestAndParts(payload: Record<string, unknown>, version = 7, writerId = 'save-abcdef123456') {
  const split = splitClassroomSnapshotPayload(payload)
  const contents = listSnapshotPartContents(split)
  const parts = new Map<string, { content: unknown; hash: string }>()
  const info = (content: unknown, kind: 'core' | 'board' | 'week', key: string) => {
    const hash = sha256(buildSnapshotPartHashInput(content))
    const docId = buildSnapshotPartDocId({ kind, key, version, writerId })
    parts.set(docId, { content, hash })
    return { docId, hash, rawBytes: JSON.stringify(content).length, storedBytes: 10 }
  }
  const core = info(split.core, 'core', '-')
  const board = split.hasBoardState ? info(split.board, 'board', '-') : undefined
  const weeks = split.weeks.map((week) => ({ key: week.key, ...info(week.cells, 'week', week.key) }))
  const manifest: SnapshotPartsManifest = {
    schemaVersion: 1,
    storageFormat: SNAPSHOT_PARTS_STORAGE_FORMAT,
    storageFormatVersion: SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
    version,
    savedAt: '2026-10-27T10:00:00.000Z',
    saveId: 'save-abcdef123456',
    compositeHash: '',
    managementCount: 5,
    dataByteLength: 1,
    hasBoardState: split.hasBoardState,
    ui: split.ui,
    parts: board ? { core, board } : { core },
    weeks,
    lastWriter: 'save',
  }
  manifest.compositeHash = sha256(buildSnapshotCompositeHashInputFromManifest(manifest))
  expect(contents.length).toBe(parts.size)
  return { manifest, parts, split }
}

describe('classroomSnapshotParts: 分割→組み立ての同一性(AC-1・AC-2)', () => {
  it('通常の教室データ(3 週・未知フィールド・ui あり)で今日の読み取り結果と stableStringify が一致する', () => {
    const { split } = expectIdentity(buildPayload())
    expect(split.hasBoardState).toBe(true)
    expect(Object.keys(split.core)).not.toContain('boardState')
    expect(Object.keys(split.core)).not.toContain('screen')
    expect(split.core.futureUnknownField).toEqual({ nested: ['keep', 'me'] })
    expect(split.board?.boardFutureUnknownField).toBe('keep')
    for (const field of SNAPSHOT_BOARD_UI_FIELDS) {
      expect(split.board).not.toHaveProperty(field)
    }
    expect(split.ui).toEqual({
      screen: 'board',
      board: {
        weekIndex: 1,
        selectedCellId: '2026-05-18#1',
        selectedDeskIndex: 3,
        isLectureStockOpen: false,
        isMakeupStockOpen: true,
        studentScheduleRange: null,
        teacherScheduleRange: { from: '2026-05-01', to: '2026-05-31' },
      },
    })
    expect(split.weeks.map((week) => week.key)).toEqual(['2026-05-11', '2026-05-18', '2026-05-25'])
  })

  it('boardState: null の教室は board も週も無く、組み立て後も boardState は null のまま', () => {
    const { split, assembled } = expectIdentity(buildPayload({ boardState: null }))
    expect(split.hasBoardState).toBe(false)
    expect(split.board).toBeNull()
    expect(split.weeks).toEqual([])
    expect(split.ui).toEqual({ screen: 'board' })
    expect(assembled.boardState).toBeNull()
  })

  it('boardState キー自体が無い・boardState が文字列の教室は今日と同じく boardState: null。配列も今日の規則どおり(オブジェクト扱い)', () => {
    const withoutKey = buildPayload()
    delete (withoutKey as Record<string, unknown>).boardState
    expect(expectIdentity(withoutKey).assembled.boardState).toBeNull()
    expect(expectIdentity(buildPayload({ boardState: 'broken' })).assembled.boardState).toBeNull()
    expect(expectIdentity(buildPayload({ boardState: 0 })).assembled.boardState).toBeNull()
    expectIdentity(buildPayload({ boardState: [1, 2, 3] }))
  })

  it('旧 { cells } 形の週・空の週・日付の無い週は配列形に直して保持する(週の数は変えない)', () => {
    const payload = buildPayload({
      boardState: {
        ...(buildPayload().boardState as Record<string, unknown>),
        weeks: [
          { cells: buildWeek(['2026-06-01'], '月') },
          [],
          [{ id: 'x', desks: [] }],
          'not-a-week',
        ],
      },
    })
    const { split } = expectIdentity(payload)
    expect(split.weeks.map((week) => week.key)).toEqual(['2026-06-01', SNAPSHOT_PARTS_NODATE_WEEK_KEY, `${SNAPSHOT_PARTS_NODATE_WEEK_KEY}~2`, `${SNAPSHOT_PARTS_NODATE_WEEK_KEY}~3`])
    expect(split.weeks[3].cells).toEqual([])
  })

  it('同じ開始日の週が 2 つある教室は 2 週目が ~2 になり、順番(weekIndex の基準)を保つ(AC-2・AC-3)', () => {
    const base = buildPayload().boardState as Record<string, unknown>
    const weekA = buildWeek(['2026-05-11'], 'A')
    const weekB = buildWeek(['2026-05-11'], 'B')
    const weekC = buildWeek(['2026-05-04'], 'C')
    const payload = buildPayload({ boardState: { ...base, weeks: [weekA, weekB, weekC] } })
    const { split, assembled } = expectIdentity(payload)
    expect(split.weeks.map((week) => week.key)).toEqual(['2026-05-11', '2026-05-11~2', '2026-05-04'])
    const assembledWeeks = (assembled.boardState as { weeks: unknown[][] }).weeks
    expect((assembledWeeks[0][0] as { dayLabel: string }).dayLabel).toBe('A')
    expect((assembledWeeks[1][0] as { dayLabel: string }).dayLabel).toBe('B')
    expect((assembledWeeks[2][0] as { dayLabel: string }).dayLabel).toBe('C')
    // 同じ入力には同じ結果
    expect(resolveSnapshotWeekKeys([weekA, weekB, weekC])).toEqual(resolveSnapshotWeekKeys([weekA, weekB, weekC]))
    expect(stripSnapshotWeekKeySuffix('2026-05-11~2')).toBe('2026-05-11')
    expect(stripSnapshotWeekKeySuffix('2026-05-11')).toBe('2026-05-11')
  })

  it('ui の「無い」と「null」を区別して残す(screen 無し・selectedCellId: null・weekIndex 無し)', () => {
    const base = buildPayload().boardState as Record<string, unknown>
    const boardState: Record<string, unknown> = { ...base, selectedCellId: null }
    delete boardState.weekIndex
    const payload = buildPayload({ boardState })
    delete (payload as Record<string, unknown>).screen
    const { split, assembled } = expectIdentity(payload)
    expect(split.ui).not.toHaveProperty('screen')
    expect(split.ui.board).not.toHaveProperty('weekIndex')
    expect(split.ui.board).toHaveProperty('selectedCellId', null)
    expect(assembled).not.toHaveProperty('screen')
    expect(assembled.boardState).not.toHaveProperty('weekIndex')
    expect((assembled.boardState as Record<string, unknown>).selectedCellId).toBeNull()
  })

  it('undefined のフィールド・Date・Set・Map・非有限数は sanitizeForFirestore と同じ規則で正規化してから分ける(ハッシュの一致)', () => {
    const payload = buildPayload({
      students: [{ id: 's1', name: '生徒A', memo: undefined, tags: new Set(['a', undefined]), when: new Date('2026-06-03T13:23:00.000Z'), ratio: Number.POSITIVE_INFINITY, big: 12n }],
      optional: undefined,
      boardState: { ...(buildPayload().boardState as Record<string, unknown>), keyed: new Map([['left', 1], ['right', undefined]]), selectedDeskIndex: undefined },
    })
    const { split } = expectIdentity(payload)
    expect(split.core).not.toHaveProperty('optional')
    expect((split.core.students as Array<Record<string, unknown>>)[0]).toEqual({ id: 's1', name: '生徒A', tags: ['a', null], when: '2026-06-03T13:23:00.000Z', ratio: null, big: '12' })
    expect(split.ui.board).not.toHaveProperty('selectedDeskIndex')
    // 規則そのものが firestoreSanitize.ts と同じ
    const tricky = { a: undefined, b: [undefined, 1], c: new Date(Number.NaN), d: new Map([['k', new Set([2n])]]), e: Number.NEGATIVE_INFINITY, f: Number.NaN, g: () => 1, h: Symbol('x'), i: { toJSON: () => ({ z: undefined, y: 1 }) } }
    expect(sanitizeSnapshotValue(tricky)).toEqual(sanitizeForFirestore(tricky))
  })

  it('日大前校サイズの合成データ(46 週・1 週 35 コマ・机 14 台)でも同一で、週キーは 46 件すべて一意', () => {
    const weeks: unknown[][] = []
    for (let index = 0; index < 46; index += 1) {
      const start = new Date(Date.UTC(2026, 4, 11 + index * 7))
      const dateKeys = [0, 1, 2, 3, 4].map((offset) => new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10))
      weeks.push(dateKeys.flatMap((dateKey) => [1, 2, 3, 4, 5, 6, 7].map((slot) => ({
        id: `${dateKey}#${slot}`,
        dateKey,
        slotNumber: slot,
        desks: Array.from({ length: 14 }, (_, desk) => ({ students: [{ studentId: `s${desk}`, lessonType: desk % 3 === 0 ? 'lecture' : 'regular', status: desk % 5 === 0 ? 'attended' : undefined }], teacherId: `t${desk % 6}` })),
      }))))
    }
    const payload = buildPayload({ boardState: { ...(buildPayload().boardState as Record<string, unknown>), weeks } })
    const { split } = expectIdentity(payload)
    expect(split.weeks).toHaveLength(46)
    expect(new Set(split.weeks.map((week) => week.key)).size).toBe(46)
    expect(split.weeks[0].key).toBe('2026-05-11')
    expect(split.weeks[45].key).toBe('2027-03-22')
  })
})

describe('classroomSnapshotParts: ハッシュの入力・部品キー・文書 ID(§9-3-5・§9-3-6)', () => {
  it('部品ハッシュの入力はキー順に依存せず、週は配列形で計算する', () => {
    expect(buildSnapshotPartHashInput({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(buildSnapshotPartHashInput({ a: [{ c: 2, d: 1 }], b: 1 }))
    expect(buildSnapshotPartHashInput({ a: undefined, b: 1 })).toBe(buildSnapshotPartHashInput({ b: 1 }))
    expect(buildSnapshotPartHashInput([{ id: 'x' }])).toBe('[{"id":"x"}]')
  })

  it('全体ハッシュの入力は部品ハッシュの一覧と ui・hasBoardState から作り、週の順番が変わると変わる', () => {
    const base = { ui: { screen: 'board', board: { weekIndex: 0 } }, hasBoardState: true, coreHash: 'c', boardHash: 'b', weeks: [['2026-05-11', 'w1'], ['2026-05-18', 'w2']] as const }
    const input = buildSnapshotCompositeHashInput(base)
    expect(input).toContain('"f":"weekly-parts-v1"')
    expect(buildSnapshotCompositeHashInput({ ...base, weeks: [['2026-05-18', 'w2'], ['2026-05-11', 'w1']] })).not.toBe(input)
    expect(buildSnapshotCompositeHashInput({ ...base, ui: { board: { weekIndex: 0 }, screen: 'board' } })).toBe(input)
    expect(buildSnapshotCompositeHashInput({ ...base, hasBoardState: false, boardHash: null, weeks: [] })).toContain('"board":null')
  })

  it('文書 ID は {kind}~{key}~v{版}~{書き手 12 文字}(core / board の key は -)で、書き手の記号は落とす', () => {
    expect(buildSnapshotPartDocId({ kind: 'week', key: '2026-05-11~2', version: 1234, writerId: 'a1b2c3d4e5f6g7h8' })).toBe('week~2026-05-11~2~v1234~a1b2c3d4e5f6')
    expect(buildSnapshotPartDocId({ kind: 'core', key: 'ignored', version: 3, writerId: 'qr1234/5678' })).toBe('core~-~v3~qr12345678')
    expect(buildSnapshotPartDocId({ kind: 'board', key: '-', version: 0, writerId: '' })).toBe('board~-~v0~unknown')
  })

  it('部品キーの分解と組み立て', () => {
    expect(parseSnapshotPartKey('core')).toEqual({ kind: 'core', key: '-' })
    expect(parseSnapshotPartKey('board')).toEqual({ kind: 'board', key: '-' })
    expect(parseSnapshotPartKey(buildSnapshotWeekPartKey('2026-05-11~2'))).toEqual({ kind: 'week', key: '2026-05-11~2' })
    expect(parseSnapshotPartKey('week:')).toBeNull()
    expect(parseSnapshotPartKey('session:x')).toBeNull()
  })
})

describe('classroomSnapshotParts: 目次の検査(fail-closed)', () => {
  it('旧形式(data / compressedData)の文書は目次ではない', () => {
    expect(isSnapshotPartsManifest({ schemaVersion: 1, data: {} })).toBe(false)
    expect(isSnapshotPartsManifest({ dataEncoding: 'gzip-base64', compressedData: 'H4sI' })).toBe(false)
    expect(isSnapshotPartsManifest({ dataEncoding: 'split-documents', splitSetId: 'x' })).toBe(false)
    expect(isSnapshotPartsManifest(null)).toBe(false)
    expect(validateSnapshotPartsManifest({ data: {} })).toEqual({ ok: false, errors: ['storageFormat が weekly-parts ではない'] })
  })

  it('正しい目次は通り、参照一覧は core → board → 週の順', () => {
    const { manifest } = buildManifestAndParts(buildPayload())
    const result = validateSnapshotPartsManifest(manifest)
    expect(result.ok).toBe(true)
    const refs = listSnapshotPartReferences(manifest)
    expect(refs.map((ref) => ref.partKey)).toEqual(['core', 'board', 'week:2026-05-11', 'week:2026-05-18', 'week:2026-05-25'])
    expect(refs[2].docId).toBe('week~2026-05-11~v7~save-abcdef1')
    expect(buildSnapshotPartHashMapFromManifest(manifest)).toEqual(Object.fromEntries(refs.map((ref) => [ref.partKey, ref.hash])))
  })

  it.each([
    ['知らない形式版', (m: SnapshotPartsManifest) => ({ ...m, storageFormatVersion: 2 }), /storageFormatVersion=2/],
    ['知らない部品の種類', (m: SnapshotPartsManifest) => ({ ...m, parts: { ...m.parts, session: { docId: 'x', hash: 'y' } } }), /知らない部品の種類 parts\.session/],
    ['core が無い', (m: SnapshotPartsManifest) => ({ ...m, parts: { board: m.parts.board } }), /parts\.core が無い/],
    ['hasBoardState=true なのに board 無し', (m: SnapshotPartsManifest) => ({ ...m, parts: { core: m.parts.core } }), /parts\.board が無い/],
    ['hasBoardState=false なのに board あり', (m: SnapshotPartsManifest) => ({ ...m, hasBoardState: false, weeks: [] }), /parts\.board がある/],
    ['hasBoardState=false なのに週あり', (m: SnapshotPartsManifest) => ({ ...m, hasBoardState: false, parts: { core: m.parts.core } }), /weeks がある/],
    ['週キーの重複', (m: SnapshotPartsManifest) => ({ ...m, weeks: [m.weeks[0], { ...m.weeks[1], key: m.weeks[0].key }] }), /週キーが重複/],
    ['週の文書 ID の重複', (m: SnapshotPartsManifest) => ({ ...m, weeks: [m.weeks[0], { ...m.weeks[1], docId: m.weeks[0].docId }] }), /文書 ID が重複/],
    ['週の形が違う', (m: SnapshotPartsManifest) => ({ ...m, weeks: [{ key: '2026-05-11' }] }), /weeks\[0\] の形が違う/],
    ['compositeHash が無い', (m: SnapshotPartsManifest) => ({ ...m, compositeHash: '' }), /compositeHash が無い/],
    ['ui が無い', (m: SnapshotPartsManifest) => ({ ...m, ui: null }), /ui がオブジェクトではない/],
  ])('%s → 失敗', (_label, mutate, pattern) => {
    const { manifest } = buildManifestAndParts(buildPayload())
    const result = validateSnapshotPartsManifest(mutate(manifest) as unknown)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' / ')).toMatch(pattern)
  })
})

describe('classroomSnapshotParts: 組み立て(純関数)は欠け・不一致で例外にし、空も一部も返さない(INV-14)', () => {
  it('全部そろえば分割前と同じ教室データに戻る(目次の ui も反映)', () => {
    const payload = buildPayload()
    const { manifest, parts } = buildManifestAndParts(payload)
    const assembled = assembleClassroomSnapshotFromParts(manifest, (ref) => parts.get(ref.docId))
    expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(deserializeLikeToday(sanitizeForFirestore(payload) as Record<string, unknown>)))
  })

  it('部品が 1 つ無い → missing-part(欠けた部品キー付き)', () => {
    const { manifest, parts } = buildManifestAndParts(buildPayload())
    const missingDocId = manifest.weeks[1].docId
    expect(() => assembleClassroomSnapshotFromParts(manifest, (ref) => ref.docId === missingDocId ? null : parts.get(ref.docId)))
      .toThrow(SnapshotPartsAssemblyError)
    try {
      assembleClassroomSnapshotFromParts(manifest, (ref) => ref.docId === missingDocId ? null : parts.get(ref.docId))
    } catch (error) {
      expect((error as SnapshotPartsAssemblyError).reason).toBe('missing-part')
      expect((error as SnapshotPartsAssemblyError).partKeys).toEqual(['week:2026-05-18'])
    }
  })

  it('ハッシュが合わない → hash-mismatch / 中身の形が違う → invalid-part-content', () => {
    const { manifest, parts } = buildManifestAndParts(buildPayload())
    const coreDocId = manifest.parts.core.docId
    expect(() => assembleClassroomSnapshotFromParts(manifest, (ref) => ref.docId === coreDocId ? { content: parts.get(coreDocId)!.content, hash: 'tampered' } : parts.get(ref.docId)))
      .toThrow(/hash-mismatch: core/)
    const weekDocId = manifest.weeks[0].docId
    expect(() => assembleClassroomSnapshotFromParts(manifest, (ref) => ref.docId === weekDocId ? { content: { cells: [] }, hash: parts.get(weekDocId)!.hash } : parts.get(ref.docId)))
      .toThrow(/invalid-part-content: week:2026-05-11/)
  })
})

describe('classroomSnapshotParts: 読み手の共通手順 readClassroomSnapshotFromParts(§9-5-2)', () => {
  function buildIo(parts: Map<string, { content: unknown; hash: string }>, overrides: Partial<Parameters<typeof readClassroomSnapshotFromParts>[1]> = {}) {
    const fetched: string[][] = []
    const io = {
      fetchParts: async (docIds: string[]) => {
        fetched.push(docIds)
        return docIds.map((docId) => (parts.has(docId) ? { docId, content: parts.get(docId)!.content } : null))
      },
      decodePart: (partDoc: unknown) => (partDoc as { content: unknown }).content,
      hash: (input: string) => sha256(input),
      ...overrides,
    }
    return { io, fetched }
  }

  it('目次が指す文書 ID だけを取りに行き(サブコレクション全体は読まない)、組み立てて返す', async () => {
    const payload = buildPayload()
    const { manifest, parts } = buildManifestAndParts(payload)
    const { io, fetched } = buildIo(parts)
    const assembled = await readClassroomSnapshotFromParts(manifest, io)
    expect(fetched).toEqual([listSnapshotPartReferences(manifest).map((ref) => ref.docId)])
    expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(deserializeLikeToday(sanitizeForFirestore(payload) as Record<string, unknown>)))
  })

  it('部品が欠けていたら目次を 1 回だけ読み直し、新しい目次で揃えば組み立てる(読み取り中の切り替え・AC-20)', async () => {
    const oldPayload = buildPayload()
    const newPayload = buildPayload({ students: [{ id: 's1', name: '生徒A(改名)' }] })
    const oldBuilt = buildManifestAndParts(oldPayload, 7)
    const newBuilt = buildManifestAndParts(newPayload, 8, 'save-newsave000')
    // 旧目次を読んだ直後に新しい保存が走り、旧 core が(掃除で)消えたという極端な状況を再現する。
    const store = new Map([...newBuilt.parts])
    const refetches: number[] = []
    const { io } = buildIo(store, { refetchManifest: async () => { refetches.push(1); return newBuilt.manifest } })
    const assembled = await readClassroomSnapshotFromParts(oldBuilt.manifest, io)
    expect(refetches).toHaveLength(1)
    expect((assembled.students as Array<{ name: string }>)[0].name).toBe('生徒A(改名)')
  })

  it('読み直しても欠けていれば例外(空も一部も返さない)。読み直し関数が無くても例外', async () => {
    const { manifest, parts } = buildManifestAndParts(buildPayload())
    const partial = new Map([...parts].filter(([docId]) => docId !== manifest.parts.core.docId))
    const refetches: number[] = []
    const { io } = buildIo(partial, { refetchManifest: async () => { refetches.push(1); return manifest } })
    await expect(readClassroomSnapshotFromParts(manifest, io)).rejects.toMatchObject({ name: 'SnapshotPartsAssemblyError', reason: 'missing-part', partKeys: ['core'] })
    expect(refetches).toHaveLength(1)
    const { io: ioNoRefetch } = buildIo(partial)
    await expect(readClassroomSnapshotFromParts(manifest, ioNoRefetch)).rejects.toBeInstanceOf(SnapshotPartsAssemblyError)
  })

  it('目次はあるが部品が 1 つも無い → 例外(空の教室にしない)', async () => {
    const { manifest } = buildManifestAndParts(buildPayload())
    const { io } = buildIo(new Map(), { refetchManifest: async () => manifest })
    await expect(readClassroomSnapshotFromParts(manifest, io)).rejects.toMatchObject({ reason: 'missing-part', partKeys: ['core', 'board', 'week:2026-05-11', 'week:2026-05-18', 'week:2026-05-25'] })
  })

  it('中身が壊れてハッシュが合わない → 読み直し後も hash-mismatch。解凍に失敗 → decode-failed(読み直さない)', async () => {
    const { manifest, parts } = buildManifestAndParts(buildPayload())
    const tampered = new Map(parts)
    const weekDocId = manifest.weeks[2].docId
    tampered.set(weekDocId, { content: [{ id: 'tampered' }], hash: 'ignored' })
    const { io } = buildIo(tampered, { refetchManifest: async () => manifest })
    await expect(readClassroomSnapshotFromParts(manifest, io)).rejects.toMatchObject({ reason: 'hash-mismatch', partKeys: ['week:2026-05-25'] })
    const refetches: number[] = []
    const { io: ioDecode } = buildIo(parts, {
      decodePart: (partDoc: unknown) => {
        if ((partDoc as { docId: string }).docId === weekDocId) throw new Error('gunzip failed')
        return (partDoc as { content: unknown }).content
      },
      refetchManifest: async () => { refetches.push(1); return manifest },
    })
    await expect(readClassroomSnapshotFromParts(manifest, ioDecode)).rejects.toMatchObject({ reason: 'decode-failed', partKeys: ['week:2026-05-25'] })
    expect(refetches).toHaveLength(0)
  })

  it('知らない形式版・知らない部品の種類の目次は部品を取りに行かずに例外(invalid-manifest)', async () => {
    const { manifest, parts } = buildManifestAndParts(buildPayload())
    const { io, fetched } = buildIo(parts)
    await expect(readClassroomSnapshotFromParts({ ...manifest, storageFormatVersion: 99 }, io)).rejects.toMatchObject({ reason: 'invalid-manifest' })
    await expect(readClassroomSnapshotFromParts({ ...manifest, parts: { ...manifest.parts, session: { docId: 'x', hash: 'y' } } }, io)).rejects.toMatchObject({ reason: 'invalid-manifest' })
    expect(fetched).toEqual([])
  })
})

describe('classroomSnapshotParts: 送る部品の決め方(§9-4-2・§9-4-3)', () => {
  it('台帳が無ければ全量、あれば違う部品だけ送り、同じ部品は unchanged にサーバーのハッシュを添える', () => {
    const current = { core: 'c1', board: 'b2', 'week:2026-05-11': 'w1', 'week:2026-05-18': 'w2' }
    expect(resolveSnapshotPartsToSend({ currentHashes: current, ledgerHashes: null })).toEqual({ sendMode: 'full', sent: Object.keys(current), unchanged: {} })
    expect(resolveSnapshotPartsToSend({ currentHashes: current, ledgerHashes: { core: 'c1', board: 'b1', 'week:2026-05-11': 'w1' } }))
      .toEqual({ sendMode: 'delta', sent: ['board', 'week:2026-05-18'], unchanged: { core: 'c1', 'week:2026-05-11': 'w1' } })
  })
})

describe('classroomSnapshotParts: 掃除の判定(§9-9・AC-25)', () => {
  const now = '2026-10-30T03:30:00.000Z'
  it('参照中は消さない(印があれば消す)・参照外で印無しは印を付ける・印から 3 日以上で削除・3 日未満は待つ', () => {
    const actions = resolveSnapshotPartGcActions({
      referencedDocIds: new Set(['core~-~v9~a', 'week~2026-05-11~v9~a']),
      parts: [
        { docId: 'core~-~v9~a' },
        { docId: 'week~2026-05-11~v9~a', gcMarkedAt: '2026-10-20T00:00:00.000Z' },
        { docId: 'core~-~v8~a' },
        { docId: 'week~2026-05-11~v8~a', gcMarkedAt: '2026-10-27T03:30:00.000Z' },
        { docId: 'week~2026-05-18~v8~a', gcMarkedAt: '2026-10-28T00:00:00.000Z' },
        { docId: 'board~-~v8~a', gcMarkedAt: 'broken-date' },
      ],
      nowIso: now,
    })
    expect(actions).toEqual({
      mark: ['core~-~v8~a', 'board~-~v8~a'],
      remove: ['week~2026-05-11~v8~a'],
      unmark: ['week~2026-05-11~v9~a'],
    })
    expect(SNAPSHOT_PART_GC_GRACE_DAYS).toBe(3)
  })

  it('目次が無い教室(referencedDocIds=null)は何もしない。猶予は最低 1 日', () => {
    expect(resolveSnapshotPartGcActions({ referencedDocIds: null, parts: [{ docId: 'x' }], nowIso: now })).toEqual({ mark: [], remove: [], unmark: [] })
    expect(resolveSnapshotPartGcActions({ referencedDocIds: new Set(), parts: [{ docId: 'x', gcMarkedAt: '2026-10-29T10:00:00.000Z' }], nowIso: now, graceDays: 0 }))
      .toEqual({ mark: [], remove: [], unmark: [] })
    expect(resolveSnapshotPartGcActions({ referencedDocIds: new Set(), parts: [{ docId: 'x', gcMarkedAt: '2026-10-29T03:00:00.000Z' }], nowIso: now, graceDays: 0 }))
      .toEqual({ mark: [], remove: ['x'], unmark: [] })
  })
})
