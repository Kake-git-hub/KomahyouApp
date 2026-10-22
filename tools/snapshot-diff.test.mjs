// tools/snapshot-diff.mjs(2 時点の教室データを生徒・コマ単位で読み比べる読み取り専用ツール)の純関数を固定する。
// フィクスチャはこのファイル内の架空データだけ(実データ・実在の生徒名は使わない)。
// import しても main() が走らない(isInvokedDirectly ガード)ことも確かめる(走るとファイル読み込みでテストが壊れる)。
import { gzipSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import {
  buildNameIndex,
  buildSnapshotDiff,
  COMPRESSED_SNAPSHOT_ENCODING,
  decodeJsonBuffer,
  describeDeskForDiff,
  detectSnapshotFileKind,
  diffBoardExtras,
  diffBoardWeeks,
  diffRowCollection,
  diffValues,
  extractClassroomSnapshot,
  formatBoardEntry,
  formatJstDateTime,
  formatSnapshotDiffText,
  isGzipBuffer,
  normalizeBoardState,
  parseArgs,
  readStoredSnapshotPayload,
  resolveTargetClassroomId,
  STUDENT_FIELD_ORDER,
  truncateText,
  validateArgs,
} from './snapshot-diff.mjs'

// ---------------------------------------------------------------------------
// フィクスチャ(架空)
// ---------------------------------------------------------------------------

function makeStudentRow(overrides = {}) {
  return { id: 's1', name: '生徒A', displayName: 'A', email: '', entryDate: '2026-04-01', withdrawDate: '', birthDate: '2013-05-01', ...overrides }
}

function makeTeacherRow(overrides = {}) {
  return { id: 't1', name: '講師A', email: '', entryDate: '', withdrawDate: '', subjectCapabilities: [], ...overrides }
}

function makeStudentEntry(overrides = {}) {
  return { id: 'e1', name: '生徒A', managedStudentId: 's1', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function makeDesk(overrides = {}) {
  return { id: 'd1', teacher: '', ...overrides }
}

function makeCell(dateKey, slotNumber, desks) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '月', dateLabel: dateKey.slice(5), slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }
}

function makeBoardState(weeks, overrides = {}) {
  return {
    weeks,
    weekIndex: 0,
    selectedCellId: '',
    selectedDeskIndex: 0,
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
    manualMakeupAdjustments: {},
    suppressedMakeupOrigins: {},
    fallbackMakeupStudents: {},
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    fallbackLectureStockStudents: {},
    isLectureStockOpen: false,
    isMakeupStockOpen: false,
    studentScheduleRange: null,
    teacherScheduleRange: null,
    ...overrides,
  }
}

function makePayload(overrides = {}) {
  return {
    screen: 'board',
    classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 2 },
    managers: [],
    teachers: [makeTeacherRow()],
    students: [makeStudentRow(), makeStudentRow({ id: 's2', name: '生徒B', displayName: 'B' })],
    regularLessons: [],
    groupLessons: [],
    specialSessions: [],
    autoAssignRules: [],
    pairConstraints: [],
    boardState: makeBoardState([[makeCell('2026-10-05', 1, [makeDesk(), makeDesk({ id: 'd2' })])]]),
    ...overrides,
  }
}

function makeStoredDoc(payload, overrides = {}) {
  return { schemaVersion: 1, savedAt: '2026-10-21T01:00:00.000Z', data: payload, updatedBy: 'uid', updatedAt: '2026-10-21T01:00:00.000Z', ...overrides }
}

function makeCompressedStoredDoc(payload, overrides = {}) {
  const json = JSON.stringify(payload)
  return {
    schemaVersion: 1,
    savedAt: '2026-10-21T01:00:00.000Z',
    dataEncoding: COMPRESSED_SNAPSHOT_ENCODING,
    compressedData: gzipSync(Buffer.from(json, 'utf8')).toString('base64'),
    dataByteLength: Buffer.byteLength(json, 'utf8'),
    updatedBy: 'uid',
    updatedAt: '2026-10-21T01:00:00.000Z',
    ...overrides,
  }
}

function makeWorkspaceBackup(classrooms) {
  return { schemaVersion: 1, savedAt: '2026-10-21T03:00:00.000Z', users: [], classrooms }
}

function makeRollback(classroomId, payload, overrides = {}) {
  return { classroomId, sourceSavedAt: '2026-10-21T01:00:00.000Z', capturedAt: '2026-10-21T02:00:00.000Z', snapshot: makeStoredDoc(payload), ...overrides }
}

function makeDeveloperReport(classroomId, payload) {
  return {
    reportId: '20261021-abc',
    workspaceKey: 'main',
    classroomId,
    classroomName: 'テスト教室',
    recordedAt: '2026-10-21T04:00:00.000Z',
    reportedAt: '2026-10-21T03:59:59.000Z',
    appVersion: '1.5.624',
    payload,
  }
}

function snapshotOf(payload, overrides = {}) {
  return { file: '', kind: 'payload', kindLabel: '教室データ(payload)', classroomId: 'room1', classroomName: '', times: [], version: null, appVersion: '', payload, ...overrides }
}

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

describe('parseArgs / validateArgs', () => {
  it('ファイル 2 つと --classroom / --json / --limit を読む', () => {
    const options = parseArgs(['before.json.gz', 'after.json.gz', '--classroom', ' room1 ', '--json', '--limit', '50'])
    expect(options.files).toEqual(['before.json.gz', 'after.json.gz'])
    expect(options.classroomId).toBe('room1')
    expect(options.json).toBe(true)
    expect(options.limit).toBe(50)
    expect(validateArgs(options)).toEqual([])
  })

  it('既定は --limit 200・--classroom 空・テキスト出力', () => {
    const options = parseArgs(['a.json', 'b.json'])
    expect(options.limit).toBe(200)
    expect(options.classroomId).toBe('')
    expect(options.json).toBe(false)
  })

  it('ファイル数違い・不正な --limit・値の無いオプション・知らないオプションはエラー', () => {
    expect(validateArgs(parseArgs(['only.json']))).toEqual(['比べるファイルを 2 つ指定してください(指定 1 個)。'])
    expect(validateArgs(parseArgs(['a', 'b', '--limit', '-1']))).toContain('--limit は 0 以上の整数で指定してください(0 は無制限)。')
    expect(validateArgs(parseArgs(['a', 'b', '--limit', 'x']))).toContain('--limit は 0 以上の整数で指定してください(0 は無制限)。')
    expect(validateArgs(parseArgs(['a', 'b', '--classroom']))).toContain('--classroom に値がありません。')
    expect(validateArgs(parseArgs(['a', 'b', '--write']))).toContain('知らないオプションです: --write')
  })

  it('--limit 0 は無制限として受け付ける', () => {
    expect(validateArgs(parseArgs(['a', 'b', '--limit', '0']))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 復号と種別判定
// ---------------------------------------------------------------------------

describe('decodeJsonBuffer', () => {
  it('平文 JSON(BOM 付きも)を読む', () => {
    expect(decodeJsonBuffer(Buffer.from('{"a":1}', 'utf8'))).toEqual({ a: 1 })
    expect(decodeJsonBuffer(Buffer.from('﻿{"a":2}', 'utf8'))).toEqual({ a: 2 })
  })

  it('gzip(1f 8b)なら解凍して読む(拡張子に依らない)', () => {
    const doc = makeDeveloperReport('room1', makePayload())
    const gz = gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'))
    expect(isGzipBuffer(gz)).toBe(true)
    expect(isGzipBuffer(Buffer.from('{}'))).toBe(false)
    expect(decodeJsonBuffer(gz)).toEqual(doc)
  })
})

describe('detectSnapshotFileKind', () => {
  it('6 つの形を見分ける', () => {
    const payload = makePayload()
    expect(detectSnapshotFileKind(makeWorkspaceBackup([{ id: 'room1', name: '教室', data: payload }]))).toBe('workspace-backup')
    expect(detectSnapshotFileKind(makeRollback('room1', payload))).toBe('classroom-rollback')
    expect(detectSnapshotFileKind(makeRollback('room1', payload, { version: 12 }))).toBe('save-history')
    expect(detectSnapshotFileKind(makeDeveloperReport('room1', payload))).toBe('developer-report')
    expect(detectSnapshotFileKind(makeStoredDoc(payload))).toBe('stored-snapshot')
    expect(detectSnapshotFileKind(makeCompressedStoredDoc(payload))).toBe('stored-snapshot')
    expect(detectSnapshotFileKind(payload)).toBe('payload')
  })

  it('version が無くてもパスが classroom-save-history なら版履歴', () => {
    expect(detectSnapshotFileKind(makeRollback('room1', makePayload()), 'classroom-save-history/main/room1/x.json.gz')).toBe('save-history')
  })

  it('利用者報告の旧キー snapshotPayload も利用者報告として扱う', () => {
    const doc = makeDeveloperReport('room1', null)
    delete doc.payload
    doc.snapshotPayload = makePayload()
    expect(detectSnapshotFileKind(doc)).toBe('developer-report')
  })

  it('判別できない形は unknown', () => {
    expect(detectSnapshotFileKind({ hello: 'world' })).toBe('unknown')
    expect(detectSnapshotFileKind([1, 2])).toBe('unknown')
    expect(detectSnapshotFileKind(null)).toBe('unknown')
  })
})

describe('readStoredSnapshotPayload / normalizeBoardState', () => {
  it('平文 data をそのまま payload にする', () => {
    const payload = makePayload()
    expect(readStoredSnapshotPayload(makeStoredDoc(payload))).toEqual(payload)
  })

  it('gzip-base64(compressedData)を復号する(サーバーの readStoredSnapshotPayload と同じ)', () => {
    const payload = makePayload()
    expect(readStoredSnapshotPayload(makeCompressedStoredDoc(payload))).toEqual(payload)
  })

  it('gzip-base64 が data 側に文字列で入っていても復号する', () => {
    const payload = makePayload()
    const doc = makeCompressedStoredDoc(payload)
    doc.data = doc.compressedData
    delete doc.compressedData
    expect(readStoredSnapshotPayload(doc)).toEqual(payload)
  })

  it('週の { cells } 形を cell 配列へ揃える', () => {
    const cell = makeCell('2026-10-05', 1, [makeDesk()])
    expect(normalizeBoardState({ weeks: [{ cells: [cell] }, [cell], { nope: 1 }] }).weeks).toEqual([[cell], [cell], []])
    const payload = makePayload({ boardState: makeBoardState([{ cells: [cell] }]) })
    expect(readStoredSnapshotPayload(makeStoredDoc(payload)).boardState.weeks).toEqual([[cell]])
  })

  it('中身が無ければ null', () => {
    expect(readStoredSnapshotPayload({ savedAt: 'x' })).toBeNull()
    expect(readStoredSnapshotPayload(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 教室の選択と取り出し
// ---------------------------------------------------------------------------

describe('extractClassroomSnapshot', () => {
  it('ワークスペースバックアップ: 教室が 1 つなら --classroom 無しで採る(教室データのキーは data)', () => {
    const payload = makePayload()
    const result = extractClassroomSnapshot(makeWorkspaceBackup([{ id: 'room1', name: '教室1', data: payload }]))
    expect(result.kind).toBe('workspace-backup')
    expect(result.classroomId).toBe('room1')
    expect(result.classroomName).toBe('教室1')
    expect(result.payload.students).toHaveLength(2)
    expect(result.times.map((time) => time.key)).toEqual(['savedAt'])
  })

  it('ワークスペースバックアップ: 教室が複数なら --classroom 必須・無い教室は中止', () => {
    const doc = makeWorkspaceBackup([{ id: 'room1', name: '教室1', data: makePayload() }, { id: 'room2', name: '教室2', data: makePayload({ students: [] }) }])
    expect(() => extractClassroomSnapshot(doc)).toThrow(/教室が 2 個あります。--classroom で選んでください: room1\(教室1\), room2\(教室2\)/)
    expect(extractClassroomSnapshot(doc, { classroomId: 'room2' }).payload.students).toEqual([])
    expect(() => extractClassroomSnapshot(doc, { classroomId: 'room9' })).toThrow(/教室 room9 がありません/)
  })

  it('ワークスペースバックアップ: snapshot キーに保存文書の形で入っていても読む', () => {
    const payload = makePayload()
    const result = extractClassroomSnapshot(makeWorkspaceBackup([{ id: 'room1', name: '教室1', snapshot: makeCompressedStoredDoc(payload) }]))
    expect(result.payload).toEqual(payload)
  })

  it('直前ロールバック: classroomId と時点を読み、--classroom 不一致は中止', () => {
    const doc = makeRollback('room1', makePayload())
    const result = extractClassroomSnapshot(doc)
    expect(result.kind).toBe('classroom-rollback')
    expect(result.classroomId).toBe('room1')
    expect(result.times.map((time) => time.key)).toEqual(['sourceSavedAt', 'savedAt', 'capturedAt'])
    expect(() => extractClassroomSnapshot(doc, { classroomId: 'room2' })).toThrow(/教室 room1 のデータです\(--classroom room2 と一致しません\)/)
  })

  it('版履歴: version を読み、圧縮された snapshot も復号する', () => {
    const payload = makePayload()
    const result = extractClassroomSnapshot(makeRollback('room1', payload, { version: 7, snapshot: makeCompressedStoredDoc(payload) }))
    expect(result.kind).toBe('save-history')
    expect(result.version).toBe(7)
    expect(result.payload).toEqual(payload)
  })

  it('利用者報告: payload キーと recordedAt / appVersion を読む', () => {
    const result = extractClassroomSnapshot(makeDeveloperReport('room1', makePayload()))
    expect(result.kind).toBe('developer-report')
    expect(result.classroomName).toBe('テスト教室')
    expect(result.appVersion).toBe('1.5.624')
    expect(result.times.map((time) => time.key)).toEqual(['recordedAt', 'reportedAt'])
    expect(() => extractClassroomSnapshot(makeDeveloperReport('room1', makePayload()), { classroomId: 'other' })).toThrow(/一致しません/)
  })

  it('教室データを取り出せない・判別できないファイルは中止', () => {
    expect(() => extractClassroomSnapshot(makeDeveloperReport('room1', null))).toThrow(/教室データ\(payload\)を取り出せませんでした/)
    expect(() => extractClassroomSnapshot({ hello: 1 }, { file: 'x.json' })).toThrow(/x\.json の形を判別できません/)
  })
})

describe('resolveTargetClassroomId', () => {
  const backup = makeWorkspaceBackup([{ id: 'room1', name: '', data: makePayload() }, { id: 'room2', name: '', data: makePayload() }])

  it('--classroom 無しでも、中に classroomId を持つ側から教室を決める(ワークスペースバックアップ側の選択に使う)', () => {
    const entries = [
      { label: '前', doc: backup, kind: 'workspace-backup' },
      { label: '後', doc: makeRollback('room2', makePayload()), kind: 'classroom-rollback' },
    ]
    expect(resolveTargetClassroomId(entries)).toBe('room2')
  })

  it('前後で教室が違えば中止', () => {
    const entries = [
      { label: '前', doc: makeRollback('room1', makePayload()), kind: 'classroom-rollback' },
      { label: '後', doc: makeDeveloperReport('room2', makePayload()), kind: 'developer-report' },
    ]
    expect(() => resolveTargetClassroomId(entries)).toThrow(/前後のファイルで教室が違います\(前=room1 \/ 後=room2\)/)
  })

  it('--classroom と中の classroomId が違えば中止・一致すればその値', () => {
    const entries = [{ label: '前', doc: makeRollback('room1', makePayload()), kind: 'classroom-rollback' }]
    expect(() => resolveTargetClassroomId(entries, 'room2')).toThrow(/前のファイルは教室 room1 のデータです/)
    expect(resolveTargetClassroomId(entries, 'room1')).toBe('room1')
  })

  it('どちらにも classroomId が無ければ空文字(バックアップ側の「1 教室なら採る」に任せる)', () => {
    expect(resolveTargetClassroomId([{ label: '前', doc: backup, kind: 'workspace-backup' }])).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 値・行の差分
// ---------------------------------------------------------------------------

describe('truncateText / formatJstDateTime', () => {
  it('60 字(省略記号込み)で切る', () => {
    const long = 'あ'.repeat(80)
    const cut = truncateText(long)
    expect(Array.from(cut)).toHaveLength(60)
    expect(cut.endsWith('…')).toBe(true)
    expect(truncateText('短い')).toBe('短い')
  })

  it('ISO を JST 表記にし、読めない値はそのまま', () => {
    expect(formatJstDateTime('2026-10-21T15:30:00.000Z')).toBe('2026-10-22 00:30:00 JST')
    expect(formatJstDateTime('not-a-date')).toBe('not-a-date')
    expect(formatJstDateTime('')).toBe('')
  })
})

describe('diffValues', () => {
  it('配列は要素の追加/削除で出す(並べ替えだけなら reorderedOnly)', () => {
    const [change] = diffValues({ holidayDates: ['2026-11-03', '2026-11-23'] }, { holidayDates: ['2026-11-23', '2026-12-29'] }, { depth: 1 })
    expect(change).toMatchObject({ path: 'holidayDates', kind: 'array', beforeCount: 2, afterCount: 2, added: ['2026-12-29'], removed: ['2026-11-03'], reorderedOnly: false })
    const [reordered] = diffValues(['a', 'b'], ['b', 'a'], { path: 'x' })
    expect(reordered.reorderedOnly).toBe(true)
  })

  it('末尾が token の項目は値を伏せる', () => {
    const changes = diffValues({ parentPortalToken: 'secret-1' }, { parentPortalToken: 'secret-2' }, { depth: 1 })
    expect(changes).toEqual([{ path: 'parentPortalToken', before: '(伏せ字・値あり)', after: '(伏せ字・値あり)' }])
    expect(JSON.stringify(changes)).not.toContain('secret')
  })

  it('生徒/講師 id の項目には名前を添える', () => {
    const names = buildNameIndex(makePayload())
    const changes = diffValues({ student1Id: 's1', teacherId: 't1' }, { student1Id: 's2', teacherId: '' }, { depth: 1, names })
    expect(changes).toEqual([
      { path: 'student1Id', before: 's1(生徒A)', after: 's2(生徒B)' },
      { path: 'teacherId', before: 't1(講師A)', after: '(空)' },
    ])
  })
})

describe('diffRowCollection(名簿)', () => {
  it('id で突き合わせ、追加・削除・変更(主要項目を先に・前 → 後)を出す', () => {
    const before = [makeStudentRow(), makeStudentRow({ id: 's2', name: '生徒B' })]
    const after = [
      makeStudentRow({ withdrawDate: '2026-10-31', name: '生徒A改', parentPortalToken: 'tok' }),
      makeStudentRow({ id: 's3', name: '生徒C' }),
    ]
    const result = diffRowCollection(before, after, { fieldOrder: STUDENT_FIELD_ORDER })
    expect(result.added).toEqual([{ id: 's3', label: '生徒C' }])
    expect(result.removed).toEqual([{ id: 's2', label: '生徒B' }])
    expect(result.changed).toHaveLength(1)
    expect(result.changed[0].id).toBe('s1')
    expect(result.changed[0].changes).toEqual([
      { path: 'name', before: '生徒A', after: '生徒A改' },
      { path: 'withdrawDate', before: '(空)', after: '2026-10-31' },
      { path: 'parentPortalToken', before: '(なし)', after: '(伏せ字・値あり)' },
    ])
  })

  it('同じ id の重複行は別行として扱う(黙って片方を捨てない)', () => {
    const result = diffRowCollection([makeStudentRow()], [makeStudentRow(), makeStudentRow({ name: '重複' })])
    expect(result.added).toEqual([{ id: 's1@2', label: '重複' }])
  })

  it('自動割振ルールは key で突き合わせる', () => {
    const result = diffRowCollection(
      [{ key: 'preferSameTeacher', label: '同じ講師', priorityScore: 1 }],
      [{ key: 'preferSameTeacher', label: '同じ講師', priorityScore: 3 }],
    )
    expect(result.changed).toEqual([{ id: 'preferSameTeacher', label: '同じ講師', changes: [{ path: 'priorityScore', before: '1', after: '3' }] }])
  })
})

// ---------------------------------------------------------------------------
// 盤面
// ---------------------------------------------------------------------------

describe('describeDeskForDiff', () => {
  it('講師・生徒(#id 種別 科目)・出欠・メモを 1 行にする', () => {
    const desk = makeDesk({
      teacher: '講師A',
      lesson: { id: 'l1', studentSlots: [makeStudentEntry({ lessonType: 'makeup', makeupSourceLabel: '10/1' }), null] },
      statusSlots: [null, { id: 'st1', studentId: 'e2', managedStudentId: 's2', name: '生徒B', subject: '英', status: 'absent', sourceManagedLesson: true, grade: '中1', lessonType: 'regular', teacherType: 'normal', teacherName: '講師A', dateKey: '2026-10-05', slotNumber: 1, recordedAt: '', sourceLessonId: 'x' }],
      memoSlots: [null, '体調\n不良'],
    })
    expect(describeDeskForDiff(desk)).toBe('講師A: 生徒A#s1(振替 数 振)10/1) / [休み 生徒B#s2 英] + メモ:体調⏎不良')
    expect(describeDeskForDiff(makeDesk())).toBe('講師なし: 空 / 空')
  })
})

describe('diffBoardWeeks', () => {
  const weekBefore = () => [[makeCell('2026-10-05', 1, [makeDesk({ teacher: '講師A' }), makeDesk({ id: 'd2' })]), makeCell('2026-10-05', 2, [makeDesk(), makeDesk({ id: 'd2' })])]]

  it('机単位に「日付 N限 机M: 前 → 後」を出す', () => {
    const after = weekBefore()
    after[0][0].desks[0].lesson = { id: 'l1', studentSlots: [makeStudentEntry(), null] }
    const entries = diffBoardWeeks(weekBefore(), after)
    expect(entries).toEqual([{ scope: 'desk', dateKey: '2026-10-05', slotNumber: 1, deskNumber: 1, before: '講師A: 空 / 空', after: '講師A: 生徒A#s1(通常 数) / 空' }])
    expect(formatBoardEntry(entries[0])).toBe('2026-10-05 1限 机1: 講師A: 空 / 空 → 講師A: 生徒A#s1(通常 数) / 空')
  })

  it('週の形({ cells } と配列)が違うだけなら差分なし', () => {
    const asCells = normalizeBoardState({ weeks: weekBefore().map((cells) => ({ cells })) }).weeks
    expect(diffBoardWeeks(weekBefore(), asCells)).toEqual([])
  })

  it('表示が同じで内部項目だけ変わった机は hiddenChanges で拾う', () => {
    const after = weekBefore()
    after[0][0].desks[0].teacherAssignmentSource = 'manual'
    const [entry] = diffBoardWeeks(weekBefore(), after)
    expect(entry.hiddenChanges).toEqual([{ path: 'teacherAssignmentSource', before: '(なし)', after: 'manual' }])
    expect(formatBoardEntry(entry)).toContain('表示は同じ・内部項目が変化 (teacherAssignmentSource: (なし) → manual)')
  })

  it('コマ属性(休講)と机数の変化はコマ行で出し、増えた空の机は机行にしない', () => {
    const after = weekBefore()
    after[0][1].isOpenDay = false
    after[0][1].desks.push(makeDesk({ id: 'd3' }))
    const entries = diffBoardWeeks(weekBefore(), after)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ scope: 'cell', change: 'changed', slotNumber: 2 })
    expect(formatBoardEntry(entries[0])).toBe('2026-10-05 2限 (コマ): isOpenDay: true → false / 机数: 2 → 3')
  })

  it('週が増えたときはコマ 1 行＋中身のある机だけを出す', () => {
    const after = [...weekBefore(), [makeCell('2026-10-12', 1, [makeDesk({ teacher: '講師A' }), makeDesk({ id: 'd2' })])]]
    const entries = diffBoardWeeks(weekBefore(), after)
    expect(entries).toEqual([
      { scope: 'cell', dateKey: '2026-10-12', slotNumber: 1, change: 'added', deskCount: 2, nonEmptyDeskCount: 1 },
      { scope: 'desk', dateKey: '2026-10-12', slotNumber: 1, deskNumber: 1, before: '(机なし)', after: '講師A: 空 / 空' },
    ])
  })

  it('日付 → 時限(数値順) → 机番号で並べる', () => {
    const before = [[makeCell('2026-10-06', 1, [makeDesk()]), makeCell('2026-10-05', 10, [makeDesk()]), makeCell('2026-10-05', 2, [makeDesk()])]]
    const after = before.map((week) => week.map((cell) => ({ ...cell, desks: [makeDesk({ teacher: '講師A' })] })))
    expect(diffBoardWeeks(before, after).map((entry) => `${entry.dateKey}#${entry.slotNumber}`)).toEqual(['2026-10-05#2', '2026-10-05#10', '2026-10-06#1'])
  })
})

describe('diffBoardExtras(週セル外)', () => {
  it('配列は追加/削除、マップはキーごとに出し、weeks は対象外', () => {
    const before = makeBoardState([[]], { suppressedRegularLessonOccurrences: ['a', 'b'], manualMakeupAdjustments: { 's1__数': [{ dateKey: '2026-10-01' }] } })
    const after = makeBoardState([[makeCell('2026-10-05', 1, [])]], { suppressedRegularLessonOccurrences: ['b', 'c'], manualMakeupAdjustments: { 's1__数': [], 's2__英': [{ dateKey: '2026-10-02' }] } })
    const extras = diffBoardExtras(before, after)
    expect(extras.map((extra) => extra.key)).toEqual(['suppressedRegularLessonOccurrences', 'manualMakeupAdjustments'])
    expect(extras[0].changes[0]).toMatchObject({ added: ['c'], removed: ['a'] })
    expect(extras[1].changes).toEqual([
      expect.objectContaining({ path: 'manualMakeupAdjustments.s1__数', beforeCount: 1, afterCount: 0, removed: ['{"dateKey":"2026-10-01"}'] }),
      expect.objectContaining({ path: 'manualMakeupAdjustments.s2__英', beforeMissing: true, afterCount: 1, added: ['{"dateKey":"2026-10-02"}'] }),
    ])
  })

  it('変化が無ければ空', () => {
    expect(diffBoardExtras(makeBoardState([]), makeBoardState([]))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 全体と出力
// ---------------------------------------------------------------------------

describe('buildSnapshotDiff / formatSnapshotDiffText', () => {
  function changedPayload() {
    const payload = makePayload()
    payload.students = [makeStudentRow({ withdrawDate: '2026-10-31' }), makeStudentRow({ id: 's2', name: '生徒B', displayName: 'B' }), makeStudentRow({ id: 's3', name: '生徒C' })]
    payload.regularLessons = [{ id: 'r1', schoolYear: 2026, teacherId: 't1', student1Id: 's2', subject1: '英', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 1, slotNumber: 1 }]
    payload.classroomSettings = { ...payload.classroomSettings, holidayDates: ['2026-11-03'] }
    payload.boardState.weeks[0][0].desks[0] = makeDesk({ teacher: '講師A', lesson: { id: 'l1', studentSlots: [makeStudentEntry(), null] } })
    payload.boardState.suppressedRegularLessonOccurrences = ['r1__2026-10-05']
    return payload
  }

  it('名簿・通常授業・教室設定・盤面・週セル外の差をまとめ、テキストに出す', () => {
    const before = snapshotOf(makePayload(), { kind: 'classroom-rollback', kindLabel: '教室の直前ロールバック', file: 'latest.json', times: [{ key: 'sourceSavedAt', label: '元の保存時刻', iso: '2026-10-21T01:00:00.000Z', jst: '2026-10-21 10:00:00 JST' }] })
    const after = snapshotOf(changedPayload(), { kind: 'save-history', kindLabel: '保存ごとの版履歴', file: 'v8.json.gz', version: 8, times: [{ key: 'sourceSavedAt', label: '元の保存時刻', iso: '2026-10-21T02:00:00.000Z', jst: '2026-10-21 11:00:00 JST' }] })
    const report = buildSnapshotDiff(before, after)
    expect(report.hasChanges).toBe(true)
    expect(report.warnings).toEqual([])
    expect(JSON.stringify(report)).not.toContain('"payload"')

    const text = formatSnapshotDiffText(report)
    expect(text).toContain('リポジトリ・Issue・公開ログへ貼らない') // 出力を貼らない注意書き
    expect(text).toContain('教室: room1')
    expect(text).toContain('前: 教室の直前ロールバック  latest.json')
    expect(text).toContain('元の保存時刻(sourceSavedAt) 2026-10-21 10:00:00 JST')
    expect(text).toContain('版 8')
    expect(text).toContain('## 生徒(名簿): 追加 1 / 削除 0 / 変更 1')
    expect(text).toContain('  + 追加 #s3 生徒C')
    expect(text).toContain('  ~ 変更 #s1 生徒A')
    expect(text).toContain('      withdrawDate: (空) → 2026-10-31')
    expect(text).toContain('## 通常授業: 追加 1 / 削除 0 / 変更 0')
    expect(text).toContain('  + 追加 #r1 月曜 1限 / 講師A / 生徒B 英 (2026年度)')
    expect(text).toContain('## 教室設定: 変更 1 項目')
    expect(text).toContain('  holidayDates: 0件 → 1件')
    expect(text).toContain('    + 2026-11-03')
    expect(text).toContain('## 盤面(机単位): 1 件')
    expect(text).toContain('  2026-10-05 1限 机1: 講師なし: 空 / 空 → 講師A: 生徒A#s1(通常 数) / 空')
    expect(text).toContain('  ■ suppressedRegularLessonOccurrences: 変化あり')
    expect(text).toContain('変化なし: 講師 / 室長 / 講習 / 集団授業 / 自動割振ルール / ペア制約')
  })

  it('--limit を超えた盤面差分は「他 n 件」にまとめる(0 は無制限)', () => {
    const before = makePayload({ boardState: makeBoardState([[1, 2, 3, 4, 5].map((slot) => makeCell('2026-10-05', slot, [makeDesk()]))]) })
    const after = makePayload({ boardState: makeBoardState([[1, 2, 3, 4, 5].map((slot) => makeCell('2026-10-05', slot, [makeDesk({ teacher: '講師A' })]))]) })
    const limited = buildSnapshotDiff(snapshotOf(before), snapshotOf(after), { limit: 2 })
    expect(limited.board.totalCount).toBe(5)
    expect(limited.board.entries).toHaveLength(2)
    expect(limited.board.omittedCount).toBe(3)
    expect(formatSnapshotDiffText(limited)).toContain('… 他 3 件')
    expect(buildSnapshotDiff(snapshotOf(before), snapshotOf(after), { limit: 0 }).board.entries).toHaveLength(5)
  })

  it('差が無ければ「差分なし」', () => {
    const report = buildSnapshotDiff(snapshotOf(makePayload()), snapshotOf(makePayload({ screen: 'basic-data' })))
    expect(report.hasChanges).toBe(false)
    expect(formatSnapshotDiffText(report)).toContain('差分なし')
  })

  it('後の時点が前より古ければ注意を出す', () => {
    const times = (iso) => [{ key: 'savedAt', label: '保存時刻', iso, jst: formatJstDateTime(iso) }]
    const report = buildSnapshotDiff(snapshotOf(makePayload(), { times: times('2026-10-21T05:00:00.000Z') }), snapshotOf(makePayload(), { times: times('2026-10-21T01:00:00.000Z') }))
    expect(report.warnings[0]).toContain('「後」のファイルの時点が「前」より古い')
  })

  it('知らない最上位項目は「その他の項目」で拾う(マップは 1 段下のキーごと)', () => {
    const report = buildSnapshotDiff(snapshotOf(makePayload()), snapshotOf(makePayload({ futureField: { a: 1 }, futureList: ['x'] })))
    expect(report.otherChanges).toEqual([
      { path: 'futureField.a', before: '(なし)', after: '1' },
      expect.objectContaining({ path: 'futureList', kind: 'array', beforeMissing: true, added: ['x'] }),
    ])
    expect(formatSnapshotDiffText(report)).toContain('## その他の項目: 変更 2')
  })

  it('取り出し → 差分の通し(gzip のワークスペースバックアップ と gzip-base64 の版履歴)', () => {
    const backupBuffer = gzipSync(Buffer.from(JSON.stringify(makeWorkspaceBackup([
      { id: 'room1', name: '教室1', data: makePayload() },
      { id: 'room2', name: '教室2', data: makePayload({ students: [] }) },
    ])), 'utf8'))
    const historyBuffer = gzipSync(Buffer.from(JSON.stringify(makeRollback('room1', null, { version: 3, snapshot: makeCompressedStoredDoc(changedPayload()) })), 'utf8'))
    const entries = [backupBuffer, historyBuffer].map((buffer, index) => {
      const doc = decodeJsonBuffer(buffer)
      return { label: index === 0 ? '前' : '後', doc, kind: detectSnapshotFileKind(doc) }
    })
    const classroomId = resolveTargetClassroomId(entries)
    expect(classroomId).toBe('room1')
    const [before, after] = entries.map((entry) => extractClassroomSnapshot(entry.doc, { classroomId, kind: entry.kind }))
    const report = buildSnapshotDiff(before, after)
    expect(report.classroomName).toBe('教室1')
    expect(report.sections.find((section) => section.key === 'students').added).toEqual([{ id: 's3', label: '生徒C' }])
    expect(report.board.totalCount).toBe(1)
  })
})

describe('モジュール import の副作用', () => {
  it('import しただけでは main() が実行されない(isInvokedDirectly ガード)', async () => {
    const mod = await import('./snapshot-diff.mjs')
    expect(typeof mod.buildSnapshotDiff).toBe('function')
  })
})
