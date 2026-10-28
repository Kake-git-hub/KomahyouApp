import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
} from '../../utils/classroomSnapshotParts'
import {
  buildSnapshotPartsLoadFailedClassroomsNotice,
  buildSnapshotPartsLoadFailedMessage,
  decodeSnapshotPartDocInBrowser,
  hashSnapshotPartInputInBrowser,
  readSnapshotPartsPayloadInBrowser,
  SnapshotPartsAssemblyError,
} from './snapshotPartsClientRead'

// ブラウザの gunzipBase64ToText(workspaceStore.ts)と同じ手順。Node 22 にも DecompressionStream がある。
async function gunzipBase64ToText(value: string) {
  const bytes = Buffer.from(value, 'base64')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

function sha256(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function buildPayload() {
  const week = (dateKey: string) => [1, 2].map((slot) => ({ id: `${dateKey}#${slot}`, dateKey, slotNumber: slot, desks: [{ students: [{ studentId: 's1' }], teacherId: 't1' }] }))
  return {
    screen: 'board',
    classroomSettings: { deskCount: 14 },
    managers: [], teachers: [{ id: 't1', name: '講師A' }], students: [{ id: 's1', name: '生徒A' }],
    regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks: [week('2026-05-11'), week('2026-05-18')], weekIndex: 0, selectedCellId: '', suppressedRegularLessonOccurrences: [] },
  }
}

function buildStoredParts(payload: Record<string, unknown>, version = 3) {
  const split = splitClassroomSnapshotPayload(payload)
  const store = new Map<string, Record<string, unknown>>()
  const info = (content: unknown, kind: 'core' | 'board' | 'week', key: string) => {
    const json = JSON.stringify(content)
    const hash = sha256(buildSnapshotPartHashInput(content))
    const docId = buildSnapshotPartDocId({ kind, key, version, writerId: 'save-abc' })
    store.set(docId, { kind, key, hash, encoding: SNAPSHOT_PART_ENCODING, compressedData: gzipSync(Buffer.from(json, 'utf8')).toString('base64') })
    return { docId, hash, rawBytes: json.length, storedBytes: 1 }
  }
  const core = info(split.core, 'core', '-')
  const board = split.hasBoardState ? info(split.board, 'board', '-') : undefined
  const weeks = split.weeks.map((week) => ({ key: week.key, ...info(week.cells, 'week', week.key) }))
  const manifest: SnapshotPartsManifest = {
    schemaVersion: 1, storageFormat: SNAPSHOT_PARTS_STORAGE_FORMAT, storageFormatVersion: SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
    version, savedAt: '2026-10-27T00:00:00.000Z', compositeHash: '', managementCount: 2, dataByteLength: 1,
    hasBoardState: split.hasBoardState, ui: split.ui, parts: board ? { core, board } : { core }, weeks, lastWriter: 'save',
  }
  manifest.compositeHash = sha256(buildSnapshotCompositeHashInputFromManifest(manifest))
  expect(store.size).toBe(listSnapshotPartContents(split).length)
  return { manifest, store }
}

function buildIo(store: Map<string, Record<string, unknown>>, manifest: unknown) {
  const requested: string[] = []
  return {
    requested,
    io: {
      getPartDoc: async (docId: string) => { requested.push(docId); return store.get(docId) ?? null },
      getManifest: async () => manifest,
      gunzipBase64ToText,
    },
  }
}

describe('snapshotPartsClientRead: ブラウザ側の解凍・照合', () => {
  it('crypto.subtle の SHA-256 は Node の crypto と同じ 16 進(サーバーの部品ハッシュと一致する)', async () => {
    const input = buildSnapshotPartHashInput({ b: 1, a: [1, 2] })
    expect(await hashSnapshotPartInputInBrowser(input)).toBe(sha256(input))
  })

  it('gzip+base64 の部品を DecompressionStream で解凍して JSON に戻す。形が違えば例外', async () => {
    const content = { students: [{ id: 's1' }] }
    const doc = { encoding: SNAPSHOT_PART_ENCODING, compressedData: gzipSync(Buffer.from(JSON.stringify(content))).toString('base64') }
    expect(await decodeSnapshotPartDocInBrowser(doc, gunzipBase64ToText)).toEqual(content)
    await expect(decodeSnapshotPartDocInBrowser({ encoding: 'json', data: content }, gunzipBase64ToText)).rejects.toThrow(/encoding/)
    await expect(decodeSnapshotPartDocInBrowser(null, gunzipBase64ToText)).rejects.toThrow(/空/)
  })

  it('文言は教室名つきで、内部語(部品・目次・ハッシュ)を含まない', () => {
    expect(buildSnapshotPartsLoadFailedMessage('日大前校')).toBe('教室「日大前校」の教室データを読み込めませんでした。画面を再読み込みしてください。直らなければ開発者へ連絡してください。')
    expect(buildSnapshotPartsLoadFailedMessage('  ')).toBe('教室データを読み込めませんでした。画面を再読み込みしてください。直らなければ開発者へ連絡してください。')
    for (const word of ['部品', '目次', 'ハッシュ', 'manifest', 'parts']) expect(buildSnapshotPartsLoadFailedMessage('x')).not.toContain(word)
  })
})

describe('snapshotPartsClientRead: 目次から教室データ全体を組み立てる(fail-closed・INV-14)', () => {
  it('全部そろえば分割前の教室データ(週は配列形)に戻り、目次が指す文書 ID だけを getDoc する', async () => {
    const payload = buildPayload()
    const { manifest, store } = buildStoredParts(payload)
    const { io, requested } = buildIo(store, manifest)
    const assembled = await readSnapshotPartsPayloadInBrowser(manifest, io)
    expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(payload))
    expect(requested.sort()).toEqual([...store.keys()].sort())
  })

  it('部品が 1 つ無い → 目次を読み直しても無ければ SnapshotPartsAssemblyError(空の教室にしない)', async () => {
    const { manifest, store } = buildStoredParts(buildPayload())
    store.delete(manifest.parts.board!.docId)
    await expect(readSnapshotPartsPayloadInBrowser(manifest, buildIo(store, manifest).io)).rejects.toMatchObject({ name: 'SnapshotPartsAssemblyError', reason: 'missing-part', partKeys: ['board'] })
  })

  it('ハッシュが合わない部品 → hash-mismatch。目次はあるが部品が 1 つも無い → missing-part(全部品)', async () => {
    const payload = buildPayload()
    const { manifest, store } = buildStoredParts(payload)
    const weekDocId = manifest.weeks[1].docId
    const tampered = new Map(store)
    tampered.set(weekDocId, { ...store.get(weekDocId)!, compressedData: gzipSync(Buffer.from('[]')).toString('base64') })
    await expect(readSnapshotPartsPayloadInBrowser(manifest, buildIo(tampered, manifest).io)).rejects.toMatchObject({ reason: 'hash-mismatch', partKeys: ['week:2026-05-18'] })
    await expect(readSnapshotPartsPayloadInBrowser(manifest, buildIo(new Map(), manifest).io)).rejects.toBeInstanceOf(SnapshotPartsAssemblyError)
  })

  it('読み取り中に目次が切り替わった(旧目次の部品が無い)→ 読み直した新目次で組み立てる(AC-20)', async () => {
    const oldBuilt = buildStoredParts(buildPayload(), 3)
    const newBuilt = buildStoredParts({ ...buildPayload(), students: [{ id: 's1', name: '生徒A(改名)' }] }, 4)
    const assembled = await readSnapshotPartsPayloadInBrowser(oldBuilt.manifest, buildIo(newBuilt.store, newBuilt.manifest).io)
    expect((assembled.students as Array<{ name: string }>)[0].name).toBe('生徒A(改名)')
  })
})

describe('workspaceStore の配線(ソース走査): 分割形式は旧 3 形式より先に判定し、組み立て失敗は空の教室にしない', () => {
  const source = readFileSync(fileURLToPath(new URL('./workspaceStore.ts', import.meta.url)), 'utf8')

  it('readFirebaseSnapshotPayload の先頭で isSnapshotPartsManifest を見て readWeeklyPartsSnapshotPayload へ渡す(旧 split-documents の枝より前)', () => {
    const start = source.indexOf('async function readFirebaseSnapshotPayload(')
    const body = source.slice(start, source.indexOf('async function readWeeklyPartsSnapshotPayload('))
    const manifestBranch = body.indexOf('if (isSnapshotPartsManifest(snapshot)) {')
    const splitBranch = body.indexOf('FIREBASE_SPLIT_SNAPSHOT_ENCODING && snapshotRef')
    expect(manifestBranch).toBeGreaterThan(-1)
    expect(splitBranch).toBeGreaterThan(manifestBranch)
    expect(body).toContain('return readWeeklyPartsSnapshotPayload(snapshot, snapshotRef)')
  })

  it('部品は目次が指す文書 ID だけ getDoc し(getDocs でサブコレクション全体を読まない)、解凍は gunzipBase64ToText を渡す', () => {
    const body = source.slice(source.indexOf('async function readWeeklyPartsSnapshotPayload('), source.indexOf('async function readSplitSnapshotPayload('))
    expect(body).toContain('readSnapshotPartsPayloadInBrowser(snapshot, {')
    expect(body).toContain('getDoc(doc(partsCollection, docId))')
    expect(body).not.toContain('getDocs(')
    expect(body).toContain('gunzipBase64ToText,')
    expect(body).toContain('getSnapshotWeeklyPartsCollection(snapshotRef)')
    // サブコレクション名は共有定数(旧 chunks / parts / boardWeeks と取り違えない)。
    expect(source).toContain("return collection(snapshotRef, SNAPSHOT_PARTS_SUBCOLLECTION)")
  })

  it('loadFirebaseWorkspaceSnapshot は組み立て失敗を catch し、室長は教室名つきの文言で投げ直す(createEmptyClassroomPayload に落とさない)。開発者はその教室だけ一覧から外して loadFailedClassrooms に残す(M-2)', () => {
    const body = source.slice(source.indexOf('export async function loadFirebaseWorkspaceSnapshot('))
    expect(body).toContain('if (isSnapshotPartsAssemblyError(error)) {')
    expect(body).toContain("throw new Error(buildSnapshotPartsLoadFailedMessage(data.name ?? ''))")
    // 例外は握らない(`.catch(() => null)` のような握りつぶしで空の教室に落とさない)。
    const tryBlock = body.slice(body.indexOf('payload = await readFirebaseSnapshotPayload('), body.indexOf('return toWorkspaceClassroom('))
    expect(tryBlock).not.toContain('payload = null')
    expect(tryBlock).toContain('throw error')
    // 開発者だけ: その教室を null で返して一覧から外す(空の教室として開かない・保存されない)。
    expect(tryBlock).toContain("if (membership.role === 'developer') {")
    expect(tryBlock).toContain('loadFailedClassrooms.push({ id: entry.id, name:')
    expect(body).toContain('const classrooms = loadedClassrooms.filter((classroom): classroom is WorkspaceClassroom => classroom !== null)')
    expect(body).toContain('...(loadFailedClassrooms.length > 0 ? { loadFailedClassrooms } : {}),')
  })
})

describe('開発者向けの案内(外した教室)', () => {
  it('外した教室が無ければ空文字。あれば教室名を並べ、内輪語なしで再読み込みと開発者連絡を案内する', () => {
    expect(buildSnapshotPartsLoadFailedClassroomsNotice([])).toBe('')
    const notice = buildSnapshotPartsLoadFailedClassroomsNotice([{ name: '日大前校' }, { name: '  ' }])
    expect(notice).toContain('「日大前校」・「名称未設定の教室」')
    expect(notice).toContain('一覧から外しています')
    expect(notice).toContain('再読み込み')
    expect(notice).not.toMatch(/部品|目次|ハッシュ|manifest/)
  })

  it('App.tsx は読み込み(初回・読み直し)の後に notifyLoadFailedClassrooms で案内を出す', () => {
    const appTsx = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    expect(appTsx).toContain("import { buildSnapshotPartsLoadFailedClassroomsNotice } from './integrations/firebase/snapshotPartsClientRead'")
    expect(appTsx.split('notifyLoadFailedClassrooms(remoteSnapshot)').length - 1).toBe(2)
    expect(appTsx).toContain('const notice = buildSnapshotPartsLoadFailedClassroomsNotice(snapshot?.loadFailedClassrooms ?? [])')
  })
})
