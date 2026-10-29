// 教室ごとに順番に書くループ(§10-4・AC-B8〜B10・AC-B18 の「教室数に比例しない」の構造)。I/O を注入してループ本体を直接動かす。
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import {
  assembleWorkspaceBackupFromClassroomFiles,
  buildWorkspaceBackupSnapshot,
  buildWorkspaceBackupTimePointPrefix,
  stableStringifyWorkspaceBackupValue,
  validateWorkspaceBackupIndex,
  type WorkspaceBackupClassroomEntry,
} from './generated/workspaceBackupLayout'
import { PER_CLASSROOM_BACKUP_WRITE_ATTEMPTS, writePerClassroomWorkspaceBackup, type PerClassroomBackupWriteIo } from './workspaceBackupWriter'

const sha256 = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex')

type Classroom = { id: string; name: string; students: string[]; broken?: boolean }

function entryOf(classroom: Classroom): WorkspaceBackupClassroomEntry {
  return {
    id: classroom.id,
    name: classroom.name,
    contractStatus: 'active',
    contractStartDate: '',
    contractEndDate: '',
    managerUserId: `u-${classroom.id}`,
    isTemporarilySuspended: false,
    temporarySuspensionReason: '',
    data: { students: classroom.students.map((id) => ({ id })), boardState: null },
  }
}

type Harness = {
  io: PerClassroomBackupWriteIo<Classroom>
  events: string[]
  storage: Map<string, Buffer | string>
  mirrored: string[]
  failWrites: Map<string, number>
}

function buildHarness(options: { failWrites?: Record<string, number>; failMirror?: string[]; failIndex?: boolean } = {}): Harness {
  const events: string[] = []
  const storage = new Map<string, Buffer | string>()
  const mirrored: string[] = []
  const failWrites = new Map(Object.entries(options.failWrites ?? {}))
  const io: PerClassroomBackupWriteIo<Classroom> = {
    assembleClassroom: async (classroom) => {
      events.push(`assemble:${classroom.id}`)
      if (classroom.broken) throw new Error(`assembly failed for ${classroom.id}`)
      return { entry: entryOf(classroom), sourceSavedAt: `src-${classroom.id}` }
    },
    hash: sha256,
    compress: (json) => gzipSync(Buffer.from(json, 'utf8')),
    writeClassroomFile: async ({ classroomId, path, body }) => {
      const remaining = failWrites.get(classroomId) ?? 0
      events.push(`write:${classroomId}`)
      if (remaining > 0) {
        failWrites.set(classroomId, remaining - 1)
        throw new Error(`storage down for ${classroomId}`)
      }
      storage.set(path, body)
    },
    mirrorClassroomFile: async ({ classroomId, fileName }) => {
      events.push(`mirror:${classroomId}`)
      if (options.failMirror?.includes(classroomId)) throw new Error(`drive down for ${classroomId}`)
      mirrored.push(fileName)
    },
    writeIndex: async ({ path, json }) => {
      events.push('index')
      if (options.failIndex) throw new Error('index write failed')
      storage.set(path, json)
    },
    mirrorIndex: async () => {
      events.push('mirror:index')
      mirrored.push('index')
    },
    onAssemblyFailure: async ({ classroomId }) => {
      events.push(`notify-assembly:${classroomId}`)
    },
    onWriteFailure: async ({ classroomId, attempt }) => {
      events.push(`write-failed:${classroomId}#${attempt}`)
    },
  }
  return { io, events, storage, mirrored, failWrites }
}

const BASE = {
  workspaceKey: 'main',
  backupDateKey: '2026-10-29T15-00',
  savedAt: '2026-10-29T06:00:04.000Z',
  sourceSavedAt: '2026-10-29T05:58:00.000Z',
  folderPrefix: buildWorkspaceBackupTimePointPrefix('main', '2026-10-29T15-00'),
  users: [{ id: 'u1', name: '開発者', email: 'dev@example.com', role: 'developer', assignedClassroomId: null }],
}
const EXCLUDE = { assembly: 'exclude' as const, write: 'exclude' as const }
const THROW = { assembly: 'throw' as const, write: 'throw' as const }

describe('writePerClassroomWorkspaceBackup(教室ごとに順番に・目次は最後)', () => {
  it('教室ごとに 組み立て→書く→ミラー を順番に行い、すべての教室の後に目次を書く(並列にしない)', async () => {
    const harness = buildHarness()
    const classrooms: Classroom[] = [{ id: 'c1', name: '教室1', students: ['s1'] }, { id: 'c2', name: '教室2', students: ['s2', 's3'] }]
    const result = await writePerClassroomWorkspaceBackup({ ...BASE, classrooms, failurePolicy: EXCLUDE, io: harness.io })
    expect(harness.events).toEqual(['assemble:c1', 'write:c1', 'mirror:c1', 'assemble:c2', 'write:c2', 'mirror:c2', 'index', 'mirror:index'])
    expect(result.writtenClassroomIds).toEqual(['c1', 'c2'])
    expect(result.missingClassrooms).toEqual([])
    expect(result.mirrorFailures).toEqual([])
    expect(result.indexPath).toBe('workspace-auto-backups/main/15min/2026-10-29T15-00/index.json')
    expect([...harness.storage.keys()]).toEqual([
      'workspace-auto-backups/main/15min/2026-10-29T15-00/c1.json.gz',
      'workspace-auto-backups/main/15min/2026-10-29T15-00/c2.json.gz',
      'workspace-auto-backups/main/15min/2026-10-29T15-00/index.json',
    ])
    expect(harness.mirrored).toEqual(['c1.json.gz', 'c2.json.gz', 'index'])
    expect(result.totalBytes).toBeGreaterThan(result.compressedBytes)
  })

  it('AC-B1: 書いた教室ファイルと目次から組み立て直すと、同じ入力を旧形式で書いた全体 JSON と一致する', async () => {
    const harness = buildHarness()
    const classrooms: Classroom[] = [{ id: 'c2', name: '教室2', students: ['s2'] }, { id: 'c1', name: '教室1', students: ['s1'] }]
    const result = await writePerClassroomWorkspaceBackup({ ...BASE, classrooms, failurePolicy: EXCLUDE, io: harness.io })
    const index = validateWorkspaceBackupIndex(JSON.parse(harness.storage.get(result.indexPath) as string), { workspaceKey: 'main', backupDateKey: '2026-10-29T15-00' })
    const files = index.classrooms.map((row) => ({ classroomId: row.id, json: gunzipSync(harness.storage.get(`${BASE.folderPrefix}${row.file}`) as Buffer).toString('utf8') }))
    const assembled = assembleWorkspaceBackupFromClassroomFiles(index, files, sha256)
    const legacy = buildWorkspaceBackupSnapshot({ savedAt: BASE.savedAt, users: BASE.users, classrooms: classrooms.map(entryOf) })
    expect(stableStringifyWorkspaceBackupValue(assembled)).toBe(stableStringifyWorkspaceBackupValue(legacy))
    expect(index.sourceSavedAt).toBe(BASE.sourceSavedAt)
    expect(index.classrooms.map((row) => row.sourceSavedAt)).toEqual(['src-c2', 'src-c1'])
  })

  it('AC-B8: 組み立てられない教室はファイルを書かず missingClassrooms(assembly-failed)に残して知らせる。ほかの教室は書かれる', async () => {
    const harness = buildHarness()
    const classrooms: Classroom[] = [{ id: 'c1', name: '教室1', students: ['s1'] }, { id: 'c2', name: '壊れた教室', students: [], broken: true }, { id: 'c3', name: '教室3', students: ['s3'] }]
    const result = await writePerClassroomWorkspaceBackup({ ...BASE, classrooms, failurePolicy: EXCLUDE, io: harness.io })
    expect(harness.events).toContain('notify-assembly:c2')
    expect(harness.events).not.toContain('write:c2')
    expect(result.writtenClassroomIds).toEqual(['c1', 'c3'])
    expect(result.missingClassrooms).toEqual([{ id: 'c2', reason: 'assembly-failed' }])
    const index = validateWorkspaceBackupIndex(JSON.parse(harness.storage.get(result.indexPath) as string))
    expect(index.classrooms.map((row) => row.id)).toEqual(['c1', 'c3'])
    expect(index.missingClassrooms).toEqual([{ id: 'c2', reason: 'assembly-failed' }])
    expect(harness.storage.has(`${BASE.folderPrefix}c2.json.gz`)).toBe(false)
  })

  it('AC-B9: 書き込みに失敗したら 1 回やり直し、2 回とも失敗なら missingClassrooms(write-failed)。1 回目だけの失敗は書けたことになる', async () => {
    const harness = buildHarness({ failWrites: { c1: 1, c2: 2 } })
    expect(PER_CLASSROOM_BACKUP_WRITE_ATTEMPTS).toBe(2)
    const classrooms: Classroom[] = [{ id: 'c1', name: '教室1', students: ['s1'] }, { id: 'c2', name: '教室2', students: ['s2'] }, { id: 'c3', name: '教室3', students: ['s3'] }]
    const result = await writePerClassroomWorkspaceBackup({ ...BASE, classrooms, failurePolicy: EXCLUDE, io: harness.io })
    expect(harness.events.filter((event) => event.startsWith('write:c1'))).toHaveLength(2)
    expect(harness.events.filter((event) => event.startsWith('write:c2'))).toHaveLength(2)
    expect(harness.events).toContain('write-failed:c1#1')
    expect(harness.events).toContain('write-failed:c2#2')
    expect(result.writtenClassroomIds).toEqual(['c1', 'c3'])
    expect(result.missingClassrooms).toEqual([{ id: 'c2', reason: 'write-failed' }])
    // 書けなかった教室はミラーもしない。
    expect(harness.events).not.toContain('mirror:c2')
  })

  it('復元前の控え(失敗を投げる方針): 組み立て失敗はその場で投げ、目次を書かない(欠けた一式を安全な控えにしない・M-1)', async () => {
    const harness = buildHarness()
    const classrooms: Classroom[] = [{ id: 'c1', name: '教室1', students: ['s1'] }, { id: 'c2', name: '壊れた教室', students: [], broken: true }, { id: 'c3', name: '教室3', students: ['s3'] }]
    await expect(writePerClassroomWorkspaceBackup({ ...BASE, classrooms, failurePolicy: THROW, io: harness.io })).rejects.toThrow('assembly failed for c2')
    expect(harness.events).toContain('notify-assembly:c2')
    expect(harness.events).not.toContain('index')
    expect(harness.events).not.toContain('assemble:c3')
  })

  it('書き込み失敗を投げる方針: やり直しても失敗なら投げ、目次を書かない', async () => {
    const harness = buildHarness({ failWrites: { c1: 2 } })
    await expect(writePerClassroomWorkspaceBackup({ ...BASE, classrooms: [{ id: 'c1', name: '教室1', students: [] }], failurePolicy: THROW, io: harness.io })).rejects.toThrow('storage down for c1')
    expect(harness.events).not.toContain('index')
  })

  it('AC-B10: 目次の書き込みに失敗したら投げる(呼び出し側は要約を書かない＝一覧に出ない。残ったファイルは取り残しの掃除が消す)', async () => {
    const harness = buildHarness({ failIndex: true })
    await expect(writePerClassroomWorkspaceBackup({ ...BASE, classrooms: [{ id: 'c1', name: '教室1', students: [] }], failurePolicy: EXCLUDE, io: harness.io })).rejects.toThrow('index write failed')
    expect(harness.storage.has(`${BASE.folderPrefix}c1.json.gz`)).toBe(true)
    expect(harness.storage.has(`${BASE.folderPrefix}index.json`)).toBe(false)
  })

  it('ミラー(Drive)の失敗は止めずに結果に集める(Storage には書けている・要約は failed にできる)', async () => {
    const harness = buildHarness({ failMirror: ['c1'] })
    const result = await writePerClassroomWorkspaceBackup({ ...BASE, classrooms: [{ id: 'c1', name: '教室1', students: [] }, { id: 'c2', name: '教室2', students: [] }], failurePolicy: EXCLUDE, io: harness.io })
    expect(result.writtenClassroomIds).toEqual(['c1', 'c2'])
    expect(result.mirrorFailures).toEqual([{ target: 'c1', message: 'drive down for c1' }])
    expect(harness.mirrored).toEqual(['c2.json.gz', 'index'])
  })

  it('教室 0 件でも目次は書く(users だけの時点)', async () => {
    const harness = buildHarness()
    const result = await writePerClassroomWorkspaceBackup({ ...BASE, classrooms: [], failurePolicy: EXCLUDE, io: harness.io })
    expect(result.index.classrooms).toEqual([])
    expect(harness.events).toEqual(['index', 'mirror:index'])
  })

  it('教室 ID に許可外の文字があれば、その教室を書く前に投げる(パスを組み立てない・BK-6)', async () => {
    const harness = buildHarness()
    await expect(writePerClassroomWorkspaceBackup({ ...BASE, classrooms: [{ id: '../x', name: 'x', students: [] }], failurePolicy: EXCLUDE, io: harness.io })).rejects.toThrowError(expect.objectContaining({ reason: 'invalid-classroom-id' }))
    expect(harness.events).toEqual(['assemble:../x'])
    expect(harness.storage.size).toBe(0)
  })
})
