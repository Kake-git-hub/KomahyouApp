// 自動バックアップの教室別化の共有純関数(docs/spec-save-restore.md §10・AC-B1〜B7)。
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  assembleWorkspaceBackupFromClassroomFiles,
  assembleWorkspaceBackupFromIndex,
  assertSafeWorkspaceBackupClassroomId,
  buildGoogleDriveClassroomBackupFileName,
  buildGoogleDriveIndexBackupFileName,
  buildWorkspaceBackupClassroomFile,
  buildWorkspaceBackupClassroomStoragePath,
  buildWorkspaceBackupIndex,
  buildWorkspaceBackupIndexClassroom,
  buildWorkspaceBackupIndexStoragePath,
  buildWorkspaceBackupSnapshot,
  buildWorkspaceBackupTimePointPrefix,
  isOrphanedWorkspaceBackupFolder,
  isWorkspaceBackupLayoutError,
  listWorkspaceBackupMissingClassroomIds,
  measureWorkspaceBackupJsonBytes,
  parseWorkspaceBackupTimePointPath,
  resolveWorkspaceBackupSummaryLayout,
  resolveWorkspaceBackupTimePointPrefixForSummary,
  serializeWorkspaceBackupValue,
  stableStringifyWorkspaceBackupValue,
  validateWorkspaceBackupClassroomFile,
  validateWorkspaceBackupIndex,
  WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM,
  WORKSPACE_BACKUP_ORPHAN_FOLDER_GRACE_HOURS,
  type WorkspaceBackupClassroomEntry,
  type WorkspaceBackupIndex,
  type WorkspaceBackupUser,
} from './workspaceBackupLayout'

const sha256 = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex')

const USERS: WorkspaceBackupUser[] = [
  { id: 'u-dev', name: '開発者', email: 'dev@example.com', role: 'developer', assignedClassroomId: null },
  { id: 'u-m1', name: '室長A', email: 'm1@example.com', role: 'manager', assignedClassroomId: 'c1' },
]

function classroom(id: string, name: string, students: string[]): WorkspaceBackupClassroomEntry {
  return {
    id,
    name,
    contractStatus: 'active',
    contractStartDate: '2026-04-01',
    contractEndDate: '',
    managerUserId: `u-${id}`,
    isTemporarilySuspended: false,
    temporarySuspensionReason: '',
    data: { screen: 'board', students: students.map((studentId) => ({ id: studentId, name: `生徒${studentId}` })), boardState: null, classroomSettings: { deskCount: 14 } },
  }
}

const SAVED_AT = '2026-10-29T06:00:04.000Z'
const WS = 'main'
const KEY = '2026-10-29T15-00'

/** 旧形式の書き方(全体 1 本)と教室別の書き方(目次＋教室ファイル)を同じ入力から作る。 */
function buildBoth(classrooms: WorkspaceBackupClassroomEntry[], missingClassroomIds: string[] = []) {
  const legacy = buildWorkspaceBackupSnapshot({ savedAt: SAVED_AT, users: USERS, classrooms, missingClassroomIds })
  const files = classrooms.map((entry) => {
    const file = buildWorkspaceBackupClassroomFile({ workspaceKey: WS, backupDateKey: KEY, savedAt: SAVED_AT, sourceSavedAt: `src-${entry.id}`, classroom: entry })
    const json = serializeWorkspaceBackupValue(file)
    return { classroomId: entry.id, json, indexRow: buildWorkspaceBackupIndexClassroom({ classroom: entry, bytes: measureWorkspaceBackupJsonBytes(json), sha256: sha256(json), sourceSavedAt: `src-${entry.id}` }) }
  })
  const index = buildWorkspaceBackupIndex({
    workspaceKey: WS,
    backupDateKey: KEY,
    savedAt: SAVED_AT,
    sourceSavedAt: 'src-latest',
    users: USERS,
    classrooms: files.map((file) => file.indexRow),
    missingClassrooms: missingClassroomIds.map((id) => ({ id, reason: 'assembly-failed' as const })),
  })
  return { legacy, index, files }
}

describe('パスと文字種検査(BK-6・AC-B5)', () => {
  it('時点フォルダ・目次・教室ファイルのパスは旧形式の 15min/{key}.json と重ならない階層に作る', () => {
    expect(buildWorkspaceBackupTimePointPrefix(WS, KEY)).toBe('workspace-auto-backups/main/15min/2026-10-29T15-00/')
    expect(buildWorkspaceBackupIndexStoragePath(WS, KEY)).toBe('workspace-auto-backups/main/15min/2026-10-29T15-00/index.json')
    expect(buildWorkspaceBackupClassroomStoragePath(WS, KEY, 'v8OZ7zH8vONNHjjYVcR1')).toBe('workspace-auto-backups/main/15min/2026-10-29T15-00/v8OZ7zH8vONNHjjYVcR1.json.gz')
    expect(buildWorkspaceBackupClassroomStoragePath(WS, KEY, 'test_classroom_20260507_dai')).toContain('/test_classroom_20260507_dai.json.gz')
  })

  it.each([
    ['../x', 'invalid-classroom-id'],
    ['a/b', 'invalid-classroom-id'],
    ['', 'invalid-classroom-id'],
    [' c1', 'invalid-classroom-id'],
    ['c1.json', 'invalid-classroom-id'],
    [null, 'invalid-classroom-id'],
    [123, 'invalid-classroom-id'],
  ])('教室 ID %j は拒否する(パスを組み立てない)', (classroomId, reason) => {
    expect(() => assertSafeWorkspaceBackupClassroomId(classroomId)).toThrowError(expect.objectContaining({ name: 'WorkspaceBackupLayoutError', reason }))
    expect(() => buildWorkspaceBackupClassroomStoragePath(WS, KEY, classroomId as string)).toThrowError(expect.objectContaining({ reason }))
  })

  it('時点キー・会社キーも同じ文字種で検査する', () => {
    expect(() => buildWorkspaceBackupTimePointPrefix('main/../other', KEY)).toThrowError(expect.objectContaining({ reason: 'invalid-workspace-key' }))
    expect(() => buildWorkspaceBackupTimePointPrefix(WS, '2026-10-29T15:00')).toThrowError(expect.objectContaining({ reason: 'invalid-backup-date-key' }))
    expect(() => buildWorkspaceBackupTimePointPrefix(WS, '../2026')).toThrowError(expect.objectContaining({ reason: 'invalid-backup-date-key' }))
  })

  it('時点フォルダのパスを読み戻せる(旧形式の 1 本のパスは null)', () => {
    expect(parseWorkspaceBackupTimePointPath('workspace-auto-backups/main/15min/2026-10-29T15-00/index.json')).toEqual({ workspaceKey: 'main', backupDateKey: '2026-10-29T15-00', fileName: 'index.json' })
    expect(parseWorkspaceBackupTimePointPath('workspace-auto-backups/main/15min/2026-10-29T15-00/c1.json.gz')?.fileName).toBe('c1.json.gz')
    expect(parseWorkspaceBackupTimePointPath('workspace-auto-backups/main/15min/2026-10-29T15-00.json')).toBeNull()
    expect(parseWorkspaceBackupTimePointPath('workspace-incident-backups/main/x/index.json')).toBeNull()
  })

  it('Drive のファイル名は旧形式の全体ファイル名の末尾に教室 ID / index を足した形で、どちらも .json.gz', () => {
    expect(buildGoogleDriveClassroomBackupFileName('main', 'quarterHourly', KEY, 'c1')).toBe('komahyouapp_main_quarterHourly_2026-10-29T15-00_c1.json.gz')
    expect(buildGoogleDriveIndexBackupFileName('main', 'quarterHourly', KEY)).toBe('komahyouapp_main_quarterHourly_2026-10-29T15-00_index.json.gz')
    expect(buildGoogleDriveIndexBackupFileName('会社/2', 'quarterHourly', KEY)).toBe('komahyouapp_2_quarterHourly_2026-10-29T15-00_index.json.gz')
    expect(() => buildGoogleDriveClassroomBackupFileName('main', 'quarterHourly', KEY, 'a/b')).toThrowError(expect.objectContaining({ reason: 'invalid-classroom-id' }))
  })
})

describe('教室ファイル(1 教室だけの WorkspaceSnapshot＋backupFile・AC-B3・AC-B6)', () => {
  it('users は空・classrooms は 1 件・actingClassroomId はその教室・backupFile に 3 点と時刻', () => {
    const file = buildWorkspaceBackupClassroomFile({ workspaceKey: WS, backupDateKey: KEY, savedAt: SAVED_AT, sourceSavedAt: 'src', classroom: classroom('c1', '教室1', ['s1']) })
    expect(file.users).toEqual([])
    expect(file.classrooms.map((entry) => entry.id)).toEqual(['c1'])
    expect(file.actingClassroomId).toBe('c1')
    expect(file.schemaVersion).toBe(1)
    expect(file.savedAt).toBe(SAVED_AT)
    expect(file.backupFile).toEqual({ layout: WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM, workspaceKey: WS, backupDateKey: KEY, classroomId: 'c1', savedAt: SAVED_AT, sourceSavedAt: 'src' })
    expect(file).not.toHaveProperty('missingClassroomIds')
  })

  it('3 点照合: 会社・時点・教室 ID のどれが違っても読み込まない(classroom-file-mismatch)', () => {
    const file = JSON.parse(serializeWorkspaceBackupValue(buildWorkspaceBackupClassroomFile({ workspaceKey: WS, backupDateKey: KEY, savedAt: SAVED_AT, sourceSavedAt: 'src', classroom: classroom('c1', '教室1', ['s1']) })))
    expect(validateWorkspaceBackupClassroomFile(file, { workspaceKey: WS, backupDateKey: KEY, classroomId: 'c1' }).classrooms[0].id).toBe('c1')
    expect(() => validateWorkspaceBackupClassroomFile(file, { workspaceKey: 'other', backupDateKey: KEY, classroomId: 'c1' })).toThrowError(expect.objectContaining({ reason: 'classroom-file-mismatch', details: ['workspaceKey'] }))
    expect(() => validateWorkspaceBackupClassroomFile(file, { workspaceKey: WS, backupDateKey: '2026-10-29T15-15', classroomId: 'c1' })).toThrowError(expect.objectContaining({ reason: 'classroom-file-mismatch', details: ['backupDateKey'] }))
    expect(() => validateWorkspaceBackupClassroomFile(file, { workspaceKey: WS, backupDateKey: KEY, classroomId: 'c2' })).toThrowError(expect.objectContaining({ reason: 'classroom-file-mismatch', details: ['backupFile.classroomId', 'classrooms[0].id'] }))
  })

  it('中身の教室 ID が backupFile と違う(別教室のデータが入っている)ファイルは拒否する', () => {
    const file = JSON.parse(serializeWorkspaceBackupValue(buildWorkspaceBackupClassroomFile({ workspaceKey: WS, backupDateKey: KEY, savedAt: SAVED_AT, sourceSavedAt: 'src', classroom: classroom('c1', '教室1', ['s1']) })))
    file.classrooms[0].id = 'c2'
    expect(() => validateWorkspaceBackupClassroomFile(file, { workspaceKey: WS, backupDateKey: KEY, classroomId: 'c1' })).toThrowError(expect.objectContaining({ reason: 'classroom-file-mismatch', details: ['classrooms[0].id'] }))
  })

  it('backupFile が無い・layout が違う・教室が 2 つ入っている・data が無い → invalid-classroom-file', () => {
    const base = buildWorkspaceBackupClassroomFile({ workspaceKey: WS, backupDateKey: KEY, savedAt: SAVED_AT, sourceSavedAt: 'src', classroom: classroom('c1', '教室1', ['s1']) })
    const expected = { workspaceKey: WS, backupDateKey: KEY, classroomId: 'c1' }
    const { backupFile: _marker, ...withoutMarker } = base
    void _marker
    expect(() => validateWorkspaceBackupClassroomFile(withoutMarker, expected)).toThrowError(expect.objectContaining({ reason: 'invalid-classroom-file' }))
    expect(() => validateWorkspaceBackupClassroomFile({ ...base, backupFile: { ...base.backupFile, layout: 'per-classroom-v2' } }, expected)).toThrowError(expect.objectContaining({ reason: 'invalid-classroom-file' }))
    expect(() => validateWorkspaceBackupClassroomFile({ ...base, classrooms: [base.classrooms[0], classroom('c2', '教室2', [])] }, expected)).toThrowError(expect.objectContaining({ reason: 'invalid-classroom-file' }))
    expect(() => validateWorkspaceBackupClassroomFile({ ...base, classrooms: [{ id: 'c1', name: '教室1' }] }, expected)).toThrowError(expect.objectContaining({ reason: 'invalid-classroom-file' }))
    expect(() => validateWorkspaceBackupClassroomFile('x', expected)).toThrowError(expect.objectContaining({ reason: 'invalid-classroom-file' }))
    expect(isWorkspaceBackupLayoutError(new Error('x'))).toBe(false)
  })
})

describe('時点の目次(index.json)', () => {
  it('目次の行は教室の項目(data 以外)＋ file / bytes / sha256 / sourceSavedAt', () => {
    const { index } = buildBoth([classroom('c1', '教室1', ['s1'])])
    expect(index.layout).toBe(WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM)
    expect(index.classrooms[0]).toMatchObject({ id: 'c1', name: '教室1', contractStatus: 'active', managerUserId: 'u-c1', file: 'c1.json.gz', sourceSavedAt: 'src-c1' })
    expect(index.classrooms[0]).not.toHaveProperty('data')
    expect(index.classrooms[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(index.classrooms[0].bytes).toBeGreaterThan(0)
    expect(index.users).toEqual(USERS)
    expect(listWorkspaceBackupMissingClassroomIds(index)).toEqual([])
  })

  it('検査: 正しい目次は通り、会社・時点の照合もできる(index-mismatch)', () => {
    const { index } = buildBoth([classroom('c1', '教室1', ['s1'])], ['c9'])
    const parsed = JSON.parse(serializeWorkspaceBackupValue(index))
    expect(validateWorkspaceBackupIndex(parsed, { workspaceKey: WS, backupDateKey: KEY }).missingClassrooms).toEqual([{ id: 'c9', reason: 'assembly-failed' }])
    expect(() => validateWorkspaceBackupIndex(parsed, { workspaceKey: 'other' })).toThrowError(expect.objectContaining({ reason: 'index-mismatch', details: ['workspaceKey'] }))
    expect(() => validateWorkspaceBackupIndex(parsed, { backupDateKey: 'x' })).toThrowError(expect.objectContaining({ reason: 'index-mismatch', details: ['backupDateKey'] }))
  })

  it.each([
    ['layout が違う', (index: WorkspaceBackupIndex) => ({ ...index, layout: 'per-classroom-v2' })],
    ['schemaVersion が違う', (index: WorkspaceBackupIndex) => ({ ...index, schemaVersion: 2 })],
    ['教室 ID に / が入っている', (index: WorkspaceBackupIndex) => ({ ...index, classrooms: [{ ...index.classrooms[0], id: 'a/b', file: 'a/b.json.gz' }] })],
    ['file が教室 ID と合わない', (index: WorkspaceBackupIndex) => ({ ...index, classrooms: [{ ...index.classrooms[0], file: 'other.json.gz' }] })],
    ['教室が重複', (index: WorkspaceBackupIndex) => ({ ...index, classrooms: [index.classrooms[0], index.classrooms[0]] })],
    ['missing と classrooms に同じ教室', (index: WorkspaceBackupIndex) => ({ ...index, missingClassrooms: [{ id: index.classrooms[0].id, reason: 'write-failed' }] })],
    ['missing の理由が知らない値', (index: WorkspaceBackupIndex) => ({ ...index, missingClassrooms: [{ id: 'c9', reason: 'unknown' }] })],
    ['users が壊れている', (index: WorkspaceBackupIndex) => ({ ...index, users: [{ name: 'x' }] })],
    ['bytes が数でない', (index: WorkspaceBackupIndex) => ({ ...index, classrooms: [{ ...index.classrooms[0], bytes: '1' }] })],
  ])('検査: %s → invalid-index(読み手は進まない)', (_label, mutate) => {
    const { index } = buildBoth([classroom('c1', '教室1', ['s1'])])
    expect(() => validateWorkspaceBackupIndex(JSON.parse(serializeWorkspaceBackupValue(mutate(index))))).toThrowError(expect.objectContaining({ reason: 'invalid-index' }))
  })
})

describe('要約の形式判定(BK-4)', () => {
  it('layout が無い・空・legacy は旧形式、per-classroom-v1 は教室別、知らない文字列は unknown', () => {
    expect(resolveWorkspaceBackupSummaryLayout({ storagePath: 'x.json' })).toBe('legacy')
    expect(resolveWorkspaceBackupSummaryLayout({ layout: '' })).toBe('legacy')
    expect(resolveWorkspaceBackupSummaryLayout({ layout: 'legacy' })).toBe('legacy')
    expect(resolveWorkspaceBackupSummaryLayout(null)).toBe('legacy')
    expect(resolveWorkspaceBackupSummaryLayout({ layout: 'per-classroom-v1' })).toBe('per-classroom-v1')
    expect(resolveWorkspaceBackupSummaryLayout({ layout: 'per-classroom-v2' })).toBe('unknown')
    expect(resolveWorkspaceBackupSummaryLayout({ layout: 7 })).toBe('unknown')
  })

  it('間引きで丸ごと消すフォルダは教室別の要約だけに決まる(旧形式は null = ファイル 1 本の削除)', () => {
    expect(resolveWorkspaceBackupTimePointPrefixForSummary({ layout: 'per-classroom-v1', storagePath: 'workspace-auto-backups/main/15min/2026-10-29T15-00/index.json' }, WS, KEY)).toBe('workspace-auto-backups/main/15min/2026-10-29T15-00/')
    expect(resolveWorkspaceBackupTimePointPrefixForSummary({ storagePath: 'workspace-auto-backups/main/15min/2026-10-29T15-00.json' }, WS, KEY)).toBeNull()
  })
})

describe('全体の組み立て直し(AC-B1: 旧形式の JSON と stableStringify で一致)', () => {
  it.each([
    ['教室 0 件', [] as WorkspaceBackupClassroomEntry[], [] as string[]],
    ['教室 1 件', [classroom('c1', '教室1', ['s1', 's2'])], []],
    ['教室 3 件(並びは目次どおり)', [classroom('c2', '教室2', ['s3']), classroom('c1', '教室1', ['s1']), classroom('c3', '教室3', [])], []],
    ['missingClassroomIds あり', [classroom('c1', '教室1', ['s1'])], ['c9', 'c8']],
  ])('%s', (_label, classrooms, missing) => {
    const { legacy, index, files } = buildBoth(classrooms, missing)
    const validated = validateWorkspaceBackupIndex(JSON.parse(serializeWorkspaceBackupValue(index)), { workspaceKey: WS, backupDateKey: KEY })
    const fromFiles = assembleWorkspaceBackupFromClassroomFiles(validated, files, sha256)
    expect(stableStringifyWorkspaceBackupValue(fromFiles)).toBe(stableStringifyWorkspaceBackupValue(legacy))
    const fromData = assembleWorkspaceBackupFromIndex(validated, files.map((file) => ({ classroomId: file.classroomId, data: (JSON.parse(file.json) as { classrooms: Array<{ data: Record<string, unknown> }> }).classrooms[0].data })))
    expect(stableStringifyWorkspaceBackupValue(fromData)).toBe(stableStringifyWorkspaceBackupValue(legacy))
    // 旧形式と同じ: 先頭の教室が actingClassroomId・missing は 1 件以上のときだけ。
    expect(fromFiles.actingClassroomId).toBe(classrooms[0]?.id ?? null)
    if (missing.length > 0) expect(fromFiles.missingClassroomIds).toEqual(missing)
    else expect(fromFiles).not.toHaveProperty('missingClassroomIds')
  })

  it('目次にある教室のファイルが 1 つでも無ければ一部だけの全体を作らない(missing-classroom-file・INV-14)', () => {
    const { index, files } = buildBoth([classroom('c1', '教室1', ['s1']), classroom('c2', '教室2', ['s2'])])
    expect(() => assembleWorkspaceBackupFromClassroomFiles(index, files.slice(0, 1), sha256)).toThrowError(expect.objectContaining({ reason: 'missing-classroom-file', details: ['c2'] }))
    expect(() => assembleWorkspaceBackupFromIndex(index, [])).toThrowError(expect.objectContaining({ reason: 'missing-classroom-file', details: ['c1', 'c2'] }))
  })

  it('目次に無い教室のデータは混ぜない(INV-08)', () => {
    const { index, files, legacy } = buildBoth([classroom('c1', '教室1', ['s1'])])
    const extra = buildBoth([classroom('c1', '教室1', ['s1']), classroom('c9', '別教室', ['s9'])]).files[1]
    const assembled = assembleWorkspaceBackupFromClassroomFiles(index, [...files, extra], sha256)
    expect(stableStringifyWorkspaceBackupValue(assembled)).toBe(stableStringifyWorkspaceBackupValue(legacy))
  })

  it('目次の sha256 と教室ファイルの中身が合わなければ読まない(hash-mismatch)・中身の教室 ID が違えば読まない', () => {
    const { index, files } = buildBoth([classroom('c1', '教室1', ['s1'])])
    const tampered = files[0].json.replace('生徒s1', '生徒s1x')
    expect(() => assembleWorkspaceBackupFromClassroomFiles(index, [{ classroomId: 'c1', json: tampered }], sha256)).toThrowError(expect.objectContaining({ reason: 'hash-mismatch', details: ['c1'] }))
    const other = buildBoth([classroom('c2', '教室2', ['s2'])]).files[0]
    const indexForC2 = { ...index, classrooms: [{ ...index.classrooms[0], id: 'c2', file: 'c2.json.gz', sha256: sha256(other.json) }] }
    // 目次は c2 だが、渡されたファイルの中身は c1(取り違え) → 3 点照合で止まる。
    expect(() => assembleWorkspaceBackupFromClassroomFiles(indexForC2, [{ classroomId: 'c2', json: files[0].json }])).toThrowError(expect.objectContaining({ reason: 'classroom-file-mismatch' }))
  })
})

describe('取り残しフォルダの掃除の判定(§10-6)', () => {
  const now = Date.parse('2026-10-30T00:00:00.000Z')
  const hours = (count: number) => count * 60 * 60 * 1000

  it('要約が無く、作成から 1 日以上たったフォルダだけ消す', () => {
    expect(WORKSPACE_BACKUP_ORPHAN_FOLDER_GRACE_HOURS).toBe(24)
    expect(isOrphanedWorkspaceBackupFolder({ hasSummary: false, newestFileCreatedAtMs: now - hours(24), nowMs: now })).toBe(true)
    expect(isOrphanedWorkspaceBackupFolder({ hasSummary: false, newestFileCreatedAtMs: now - hours(23.9), nowMs: now })).toBe(false)
  })

  it('要約がある・作成時刻が読めない・未来日時は消さない(安全側)', () => {
    expect(isOrphanedWorkspaceBackupFolder({ hasSummary: true, newestFileCreatedAtMs: now - hours(48), nowMs: now })).toBe(false)
    expect(isOrphanedWorkspaceBackupFolder({ hasSummary: false, newestFileCreatedAtMs: 0, nowMs: now })).toBe(false)
    expect(isOrphanedWorkspaceBackupFolder({ hasSummary: false, newestFileCreatedAtMs: Number.NaN, nowMs: now })).toBe(false)
    expect(isOrphanedWorkspaceBackupFolder({ hasSummary: false, newestFileCreatedAtMs: now + hours(1), nowMs: now })).toBe(false)
  })
})
