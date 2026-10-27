import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildSnapshotCompositeHashInputFromManifest,
  buildSnapshotPartDocId,
  buildSnapshotPartHashInput,
  listSnapshotPartContents,
  SNAPSHOT_PART_ENCODING,
  SNAPSHOT_PARTS_STORAGE_FORMAT,
  SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
  splitClassroomSnapshotPayload,
  stableStringifySnapshotValue,
  type SnapshotPartsManifest,
} from './generated/classroomSnapshotParts'
import { assembleSnapshotPartsManifest, decodeSnapshotPartDoc, describeSnapshotAssemblyFailure, hashSnapshotPartInput, SnapshotPartsAssemblyError } from './snapshotPartsReader'

function sha256(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function buildPayload() {
  const week = (dateKey: string) => [1, 2].map((slot) => ({ id: `${dateKey}#${slot}`, dateKey, slotNumber: slot, desks: [{ students: [{ studentId: 's1', status: 'attended' }], teacherId: 't1' }] }))
  return {
    screen: 'board',
    classroomSettings: { deskCount: 14 },
    managers: [], teachers: [{ id: 't1', name: '講師A' }], students: [{ id: 's1', name: '生徒A' }],
    regularLessons: [], groupLessons: [], specialSessions: [{ id: 'ss1', studentInputs: {} }], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks: [week('2026-05-11'), week('2026-05-18')], weekIndex: 1, selectedCellId: '', suppressedRegularLessonOccurrences: [], groupClassEntries: {} },
  }
}

// 段階 B のサーバーの書き手が作る形(部品は gzip+base64)を、テスト用に最小限で再現する。
function buildStoredParts(payload: Record<string, unknown>, version = 12) {
  const split = splitClassroomSnapshotPayload(payload)
  const store = new Map<string, Record<string, unknown>>()
  const info = (content: unknown, kind: 'core' | 'board' | 'week', key: string) => {
    const json = JSON.stringify(content)
    const hash = sha256(buildSnapshotPartHashInput(content))
    const docId = buildSnapshotPartDocId({ kind, key, version, writerId: 'save-0123456789ab' })
    store.set(docId, { classroomId: 'c1', kind, key, hash, encoding: SNAPSHOT_PART_ENCODING, compressedData: gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64'), rawByteLength: Buffer.byteLength(json), createdAt: '2026-10-27T00:00:00.000Z', createdBy: 'save-0123456789ab', createdForVersion: version })
    return { docId, hash, rawBytes: Buffer.byteLength(json), storedBytes: 1 }
  }
  const contents = listSnapshotPartContents(split)
  const core = info(split.core, 'core', '-')
  const board = split.hasBoardState ? info(split.board, 'board', '-') : undefined
  const weeks = split.weeks.map((week) => ({ key: week.key, ...info(week.cells, 'week', week.key) }))
  const manifest: SnapshotPartsManifest = {
    schemaVersion: 1, storageFormat: SNAPSHOT_PARTS_STORAGE_FORMAT, storageFormatVersion: SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
    version, savedAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', updatedBy: 'u1', saveId: 'save-0123456789ab',
    compositeHash: '', managementCount: 2, dataByteLength: 1, hasBoardState: split.hasBoardState, ui: split.ui,
    parts: board ? { core, board } : { core }, weeks, lastWriter: 'save',
  }
  manifest.compositeHash = sha256(buildSnapshotCompositeHashInputFromManifest(manifest))
  expect(store.size).toBe(contents.length)
  return { manifest, store }
}

function buildIo(store: Map<string, Record<string, unknown>>, manifest: unknown) {
  const fetched: string[][] = []
  return {
    fetched,
    io: {
      fetchPartDocs: async (docIds: string[]) => { fetched.push(docIds); return docIds.map((docId) => store.get(docId) ?? null) },
      refetchManifest: async () => manifest,
    },
  }
}

describe('snapshotPartsReader: 部品文書の解凍とハッシュ', () => {
  it('gzip+base64 の部品を解凍して JSON に戻し、ハッシュは共有関数の入力に対する SHA-256', () => {
    const content = [{ id: 'x', dateKey: '2026-05-11' }]
    const doc = { encoding: SNAPSHOT_PART_ENCODING, compressedData: gzipSync(Buffer.from(JSON.stringify(content))).toString('base64') }
    expect(decodeSnapshotPartDoc(doc)).toEqual(content)
    expect(hashSnapshotPartInput(buildSnapshotPartHashInput(content))).toBe(sha256(buildSnapshotPartHashInput(content)))
  })

  it('encoding が違う・compressedData が無い・壊れた base64 は例外(空にしない)', () => {
    expect(() => decodeSnapshotPartDoc({ encoding: 'json', data: {} })).toThrow(/encoding/)
    expect(() => decodeSnapshotPartDoc({ encoding: SNAPSHOT_PART_ENCODING })).toThrow(/compressedData/)
    expect(() => decodeSnapshotPartDoc({ encoding: SNAPSHOT_PART_ENCODING, compressedData: 'not-gzip' })).toThrow()
    expect(() => decodeSnapshotPartDoc(null)).toThrow(/空/)
  })
})

describe('snapshotPartsReader: 目次から教室データ全体を組み立てる(旧 readStoredSnapshotPayload と同じ形)', () => {
  it('全部そろえば分割前の教室データ(週は配列形)に戻り、目次が指す文書 ID だけ取りに行く', async () => {
    const payload = buildPayload()
    const { manifest, store } = buildStoredParts(payload)
    const { io, fetched } = buildIo(store, manifest)
    const assembled = await assembleSnapshotPartsManifest(manifest, io)
    expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(payload))
    expect(fetched).toEqual([[manifest.parts.core.docId, manifest.parts.board!.docId, ...manifest.weeks.map((week) => week.docId)]])
    expect((assembled.boardState as { weeks: unknown[][] }).weeks).toHaveLength(2)
  })

  it('部品が 1 つ無い → 目次を 1 回読み直し、それでも無ければ SnapshotPartsAssemblyError(missing-part)。空の教室データは返さない', async () => {
    const { manifest, store } = buildStoredParts(buildPayload())
    store.delete(manifest.weeks[0].docId)
    const { io, fetched } = buildIo(store, manifest)
    await expect(assembleSnapshotPartsManifest(manifest, io)).rejects.toBeInstanceOf(SnapshotPartsAssemblyError)
    expect(fetched).toHaveLength(2)
    try {
      await assembleSnapshotPartsManifest(manifest, io)
    } catch (error) {
      expect(describeSnapshotAssemblyFailure(error)).toBe('missing-part: week:2026-05-11')
    }
  })

  it('部品の中身が目次のハッシュと合わない → hash-mismatch / 解凍できない → decode-failed', async () => {
    const payload = buildPayload()
    const { manifest, store } = buildStoredParts(payload)
    const coreDocId = manifest.parts.core.docId
    const tampered = new Map(store)
    tampered.set(coreDocId, { ...store.get(coreDocId)!, compressedData: gzipSync(Buffer.from(JSON.stringify({ ...splitClassroomSnapshotPayload(payload).core, students: [] }))).toString('base64') })
    await expect(assembleSnapshotPartsManifest(manifest, buildIo(tampered, manifest).io)).rejects.toMatchObject({ reason: 'hash-mismatch', partKeys: ['core'] })
    const broken = new Map(store)
    broken.set(coreDocId, { ...store.get(coreDocId)!, compressedData: 'AAAA' })
    await expect(assembleSnapshotPartsManifest(manifest, buildIo(broken, manifest).io)).rejects.toMatchObject({ reason: 'decode-failed', partKeys: ['core'] })
  })

  it('読み取り中に目次が切り替わっても、読み直した目次で一式がそろえば組み立てる(AC-20)', async () => {
    const oldBuilt = buildStoredParts(buildPayload(), 12)
    const newBuilt = buildStoredParts({ ...buildPayload(), students: [{ id: 's1', name: '生徒A(改名)' }] }, 13)
    const { io } = buildIo(newBuilt.store, newBuilt.manifest)
    const assembled = await assembleSnapshotPartsManifest(oldBuilt.manifest, io)
    expect((assembled.students as Array<{ name: string }>)[0].name).toBe('生徒A(改名)')
  })

  it('知らない形式版の目次は部品を取りに行かず invalid-manifest', async () => {
    const { manifest, store } = buildStoredParts(buildPayload())
    const { io, fetched } = buildIo(store, manifest)
    await expect(assembleSnapshotPartsManifest({ ...manifest, storageFormatVersion: 2 }, io)).rejects.toMatchObject({ reason: 'invalid-manifest' })
    expect(fetched).toEqual([])
    expect(describeSnapshotAssemblyFailure(new Error('boom'))).toBe('boom')
  })
})
