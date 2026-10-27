/**
 * INV-14 マトリクステスト（台帳: docs/spec-invariants.md INV-14・週単位の分割保存 docs/spec-save-restore.md §9-5-3）
 *
 * 保証 INV-14【準観察】: 教室データは全部そろって読めたときだけ表示・保存する。
 *   目次が指す部品（管理データ core・盤面の週以外 board・全部の週）が**すべて**読めて各部品の中身がハッシュと一致したときだけ
 *   その教室データを使ってよい。1 つでも欠ける・合わないときは、読み手は空の教室データも一部だけの教室データも作らない（例外）。
 *
 * マトリクス:
 *   行（読み手） = クライアントの読込（workspaceStore）/ QR 提出のマージ（lectureSubmissionApi）/ 自動バックアップ / 直前ロールバック /
 *                 版履歴 / 保護者向け表示（parentPortalApi・発行時の実在確認）/ 在籍数台帳 / 保存の読み戻し（saveClassroomSnapshot）
 *   列（欠け方） = 部品が 1 つ無い / ハッシュ不一致 / 知らない部品の種類 / 読み取り中に目次が切り替わった（旧版が残っていれば正しく読める）/
 *                 目次はあるが部品が 1 つも無い
 *
 * 各セルの実体: すべての読み手は**唯一の読み手**（サーバー readClassroomSnapshotPayload → assembleSnapshotPartsManifest、
 * クライアント readFirebaseSnapshotPayload → readSnapshotPartsPayloadInBrowser）を通り、どちらも共有純関数
 * readClassroomSnapshotFromParts に落ちる。列は両方のアダプタ（Node の zlib+crypto / ブラウザ相当の DecompressionStream+crypto.subtle）に
 * 実際の gzip 部品を流して固定し、行は「その読み手が唯一の読み手を await し、失敗を空に落とさない」配線をソース走査で固定する
 * （index.ts は firebase-admin を初期化するため関数単位では読み込めない。saveHistory.wiring.test.ts と同じ作法）。
 * 受け入れ条件: AC-19・AC-20・AC-21・AC-15 の読み手側。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { assembleSnapshotPartsManifest } from '../../functions/src/snapshotPartsReader'
import { readSnapshotPartsPayloadInBrowser } from '../integrations/firebase/snapshotPartsClientRead'
import {
  buildSnapshotCompositeHashInputFromManifest,
  buildSnapshotPartDocId,
  buildSnapshotPartHashInput,
  isSnapshotPartsManifest,
  listSnapshotPartContents,
  SNAPSHOT_PART_ENCODING,
  SNAPSHOT_PARTS_STORAGE_FORMAT,
  SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
  splitClassroomSnapshotPayload,
  stableStringifySnapshotValue,
  type SnapshotPartsManifest,
} from './classroomSnapshotParts'

const indexTs = readFileSync(fileURLToPath(new URL('../../functions/src/index.ts', import.meta.url)), 'utf8')
const workspaceStoreTs = readFileSync(fileURLToPath(new URL('../integrations/firebase/workspaceStore.ts', import.meta.url)), 'utf8')

function sha256(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

async function gunzipBase64ToText(value: string) {
  const stream = new Blob([Buffer.from(value, 'base64')]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

function buildPayload(studentName = '生徒A') {
  const week = (dateKey: string) => [1, 2].map((slot) => ({ id: `${dateKey}#${slot}`, dateKey, slotNumber: slot, desks: [{ students: [{ studentId: 's1', status: 'attended' }], teacherId: 't1' }] }))
  return {
    screen: 'board',
    classroomSettings: { deskCount: 14 },
    managers: [], teachers: [{ id: 't1', name: '講師A' }], students: [{ id: 's1', name: studentName }],
    regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks: [week('2026-05-11'), week('2026-05-18'), week('2026-05-25')], weekIndex: 1, selectedCellId: '', suppressedRegularLessonOccurrences: ['x'] },
  }
}

type Store = Map<string, Record<string, unknown>>

function buildStored(payload: Record<string, unknown>, version: number) {
  const split = splitClassroomSnapshotPayload(payload)
  const store: Store = new Map()
  const info = (content: unknown, kind: 'core' | 'board' | 'week', key: string) => {
    const json = JSON.stringify(content)
    const hash = sha256(buildSnapshotPartHashInput(content))
    const docId = buildSnapshotPartDocId({ kind, key, version, writerId: `save-v${version}` })
    store.set(docId, { kind, key, hash, encoding: SNAPSHOT_PART_ENCODING, compressedData: gzipSync(Buffer.from(json, 'utf8')).toString('base64') })
    return { docId, hash, rawBytes: json.length, storedBytes: 1 }
  }
  const core = info(split.core, 'core', '-')
  const board = info(split.board, 'board', '-')
  const weeks = split.weeks.map((week) => ({ key: week.key, ...info(week.cells, 'week', week.key) }))
  const manifest: SnapshotPartsManifest = {
    schemaVersion: 1, storageFormat: SNAPSHOT_PARTS_STORAGE_FORMAT, storageFormatVersion: SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
    version, savedAt: '2026-10-27T00:00:00.000Z', compositeHash: '', managementCount: 2, dataByteLength: 1,
    hasBoardState: true, ui: split.ui, parts: { core, board }, weeks, lastWriter: 'save',
  }
  manifest.compositeHash = sha256(buildSnapshotCompositeHashInputFromManifest(manifest))
  expect(listSnapshotPartContents(split)).toHaveLength(store.size)
  return { manifest, store }
}

// 列（欠け方）。それぞれ「読み手に渡す目次」「部品の置き場」「読み直したときの目次」と期待を返す。
type Column = {
  label: string
  setup: () => { manifestDoc: unknown; store: Store; latestManifest: unknown; expect: { ok: true; studentName: string } | { ok: false; reason: string; partKeys?: string[] } }
}
const COLUMNS: Column[] = [
  {
    label: '部品が 1 つ無い',
    setup: () => {
      const { manifest, store } = buildStored(buildPayload(), 5)
      store.delete(manifest.weeks[1].docId)
      return { manifestDoc: manifest, store, latestManifest: manifest, expect: { ok: false, reason: 'missing-part', partKeys: ['week:2026-05-18'] } }
    },
  },
  {
    label: 'ハッシュ不一致',
    setup: () => {
      const { manifest, store } = buildStored(buildPayload(), 5)
      const coreDocId = manifest.parts.core.docId
      store.set(coreDocId, { ...store.get(coreDocId)!, compressedData: gzipSync(Buffer.from(JSON.stringify({ ...splitClassroomSnapshotPayload(buildPayload()).core, students: [] }))).toString('base64') })
      return { manifestDoc: manifest, store, latestManifest: manifest, expect: { ok: false, reason: 'hash-mismatch', partKeys: ['core'] } }
    },
  },
  {
    label: '知らない部品の種類',
    setup: () => {
      const { manifest, store } = buildStored(buildPayload(), 5)
      const manifestDoc = { ...manifest, parts: { ...manifest.parts, session: { docId: 'session~ss1~v5~x', hash: 'h' } } }
      return { manifestDoc, store, latestManifest: manifestDoc, expect: { ok: false, reason: 'invalid-manifest' } }
    },
  },
  {
    label: '読み取り中に目次が切り替わった（旧版が残っていれば正しく読める）',
    setup: () => {
      const oldBuilt = buildStored(buildPayload('生徒A'), 5)
      const newBuilt = buildStored(buildPayload('生徒A(改名)'), 6)
      // 旧目次を読んだ直後に新しい保存が走り、旧部品が掃除で消えた最悪の状況: 読み直した新目次の一式で組み立てる。
      return { manifestDoc: oldBuilt.manifest, store: newBuilt.store, latestManifest: newBuilt.manifest, expect: { ok: true, studentName: '生徒A(改名)' } }
    },
  },
  {
    label: '目次はあるが部品が 1 つも無い',
    setup: () => {
      const { manifest } = buildStored(buildPayload(), 5)
      return { manifestDoc: manifest, store: new Map(), latestManifest: manifest, expect: { ok: false, reason: 'missing-part', partKeys: ['core', 'board', 'week:2026-05-11', 'week:2026-05-18', 'week:2026-05-25'] } }
    },
  },
]

// 両アダプタ = 全行が通る「唯一の読み手」。
const ADAPTERS = [
  {
    label: 'サーバー（functions readClassroomSnapshotPayload → assembleSnapshotPartsManifest）',
    read: (manifestDoc: unknown, store: Store, latestManifest: unknown) => assembleSnapshotPartsManifest(manifestDoc, {
      fetchPartDocs: async (docIds) => docIds.map((docId) => store.get(docId) ?? null),
      refetchManifest: async () => latestManifest,
    }),
  },
  {
    label: 'クライアント（workspaceStore readFirebaseSnapshotPayload → readSnapshotPartsPayloadInBrowser）',
    read: (manifestDoc: unknown, store: Store, latestManifest: unknown) => readSnapshotPartsPayloadInBrowser(manifestDoc, {
      getPartDoc: async (docId) => store.get(docId) ?? null,
      getManifest: async () => latestManifest,
      gunzipBase64ToText,
    }),
  },
]

describe('INV-14 列（欠け方）× 唯一の読み手（サーバー / クライアント）: 空も一部だけも返さない・切り替えをまたいでも一式がそろう', () => {
  describe.each(ADAPTERS)('$label', ({ read }) => {
    it.each(COLUMNS)('$label', async ({ setup }) => {
      const scenario = setup()
      if (scenario.expect.ok) {
        const assembled = await read(scenario.manifestDoc, scenario.store, scenario.latestManifest)
        expect((assembled.students as Array<{ name: string }>)[0].name).toBe(scenario.expect.studentName)
        expect((assembled.boardState as { weeks: unknown[][] }).weeks).toHaveLength(3)
        return
      }
      const expected = scenario.expect
      let caught: unknown = null
      try {
        await read(scenario.manifestDoc, scenario.store, scenario.latestManifest)
      } catch (error) {
        caught = error
      }
      // 例外であること（null = 空の教室、一部欠けのオブジェクトを返さない）。
      expect(caught).not.toBeNull()
      expect((caught as { name?: string }).name).toBe('SnapshotPartsAssemblyError')
      expect((caught as { reason?: string }).reason).toBe(expected.reason)
      if (expected.partKeys) expect((caught as { partKeys?: string[] }).partKeys).toEqual(expected.partKeys)
    })
  })

  it('そろっているときの組み立て結果は分割前の教室データと同じ（全か無かの「全」）', async () => {
    const payload = buildPayload()
    const { manifest, store } = buildStored(payload, 5)
    for (const adapter of ADAPTERS) {
      const assembled = await adapter.read(manifest, store, manifest)
      expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(payload))
    }
    expect(isSnapshotPartsManifest(manifest)).toBe(true)
  })
})

function slice(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start, startMarker).toBeGreaterThan(-1)
  expect(end, endMarker).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('INV-14 行（読み手）: どの読み手も唯一の読み手を通り、失敗を空に落とさない（ソース走査）', () => {
  it('唯一の読み手 readClassroomSnapshotPayload は目次なら assembleSnapshotPartsManifest、旧形式なら readLegacyStoredSnapshotPayload。旧形式の関数を直接呼ぶ読み手は無い', () => {
    const reader = slice(indexTs, 'async function readClassroomSnapshotPayload(', 'type SnapshotAssemblyReader =')
    expect(reader).toContain('if (!isSnapshotPartsManifest(snapshot)) return readLegacyStoredSnapshotPayload(snapshot)')
    expect(reader).toContain('return assembleSnapshotPartsManifest(snapshot, {')
    expect(reader).toContain('firestore.getAll(')
    // 旧形式の関数は定義 1 + 唯一の読み手 1 + QR マージ（目次を先に除外した後）1 の 3 回だけ現れる。
    expect(indexTs.split('readLegacyStoredSnapshotPayload(').length - 1).toBe(3)
    // 旧名 readStoredSnapshotPayload（目次を null=空にしてしまう同期版）は残っていない。
    expect(indexTs).not.toContain('readStoredSnapshotPayload(')
  })

  it('行: クライアントの読込 — 目次を旧 3 形式より先に判定し、組み立て失敗は教室名つきの案内で投げ直す（createEmptyClassroomPayload に落とさない）', () => {
    const body = slice(workspaceStoreTs, 'async function readFirebaseSnapshotPayload(', 'async function readWeeklyPartsSnapshotPayload(')
    expect(body.indexOf('if (isSnapshotPartsManifest(snapshot)) {')).toBeLessThan(body.indexOf('FIREBASE_SPLIT_SNAPSHOT_ENCODING && snapshotRef'))
    expect(body).toContain('return readWeeklyPartsSnapshotPayload(snapshot, snapshotRef)')
    const load = workspaceStoreTs.slice(workspaceStoreTs.indexOf('export async function loadFirebaseWorkspaceSnapshot('))
    expect(load).toContain("throw new Error(buildSnapshotPartsLoadFailedMessage(data.name ?? ''))")
    expect(load).toContain('throw error')
    // 開発者は 1 教室の失敗で全教室が開けなくならないよう、その教室だけ一覧から外す(M-2・2026-10-28)。外した教室は開けない＝保存もされない。
    expect(load).toContain("if (membership.role === 'developer') {")
    expect(load).toContain('return null')
    expect(load).not.toContain('createEmptyClassroomPayload()\n')
  })

  it('行: QR 提出のマージ — 分割形式の目次は core 部品を読んで照合し、新しい core 部品＋目次の core 差し替えで書く（版数・savedAt・saveId 据え置き＝K-9）。core が欠ける・合わなければマージせず知らせる（提出は lectureSubmissions に残る・INV-07）', () => {
    const merge = slice(indexTs, "// Also update the classroom snapshot so admin sees the data immediately", 'res.json({ success: true, submittedAt: now })')
    const guard = merge.indexOf('if (isSnapshotPartsManifest(snapshotData)) {')
    const legacy = merge.indexOf('readLegacyStoredSnapshotPayload(snapshotData)')
    expect(guard).toBeGreaterThan(-1)
    expect(legacy).toBeGreaterThan(guard)
    const partsBranch = merge.slice(guard, legacy)
    expect(partsBranch).toContain("throw new SnapshotPartsAssemblyError('missing-part', ['core'])")
    expect(partsBranch).toContain("throw new SnapshotPartsAssemblyError('hash-mismatch', ['core'])")
    expect(partsBranch).toContain('const mergedCore = mergeLectureSubmissionIntoPayload(core as Record<string, unknown>, mergeInput)')
    expect(partsBranch).toContain('transaction.set(snapshotRef.collection(SNAPSHOT_PARTS_SUBCOLLECTION).doc(next.docId), next.doc)')
    expect(partsBranch).toContain('transaction.set(snapshotRef, next.manifest)')
    // 旧形式の目次を分割形式の教室へ書かない（createStoredSnapshotDoc は旧形式の枝だけ）。
    expect(partsBranch).not.toContain('createStoredSnapshotDoc(')
    expect(merge).toContain("reader: 'lecture-submission-merge', error })")
  })

  it('行: 自動バックアップ — 組み立てられない教室を空で書かずに除き、missingClassroomIds に残して開発者へ知らせる（他の教室は書く）', () => {
    const builder = slice(indexTs, 'async function buildWorkspaceServerBackupSnapshot(', '    missingClassroomIds,\n    snapshot: {')
    expect(builder).toContain('await readClassroomSnapshotPayload(')
    expect(builder).toContain("if (options.onAssemblyFailure === 'throw') throw error")
    expect(builder).toContain('missingClassroomIds.push(entry.id)')
    expect(builder).toContain('await notifySnapshotAssemblyFailure(')
    expect(builder).not.toContain('createEmptyAppSnapshotPayload()')
    const autoBackup = slice(indexTs, 'async function runWorkspaceServerAutoBackup(', 'await pruneWorkspaceServerAutoBackups(')
    expect(autoBackup).toContain("buildWorkspaceServerBackupSnapshot(workspaceKey, savedAt, { onAssemblyFailure: 'exclude', reader: 'auto-backup' })")
    expect(autoBackup).toContain('missingClassroomIds,')
    // 全教室を並列に解凍しない(512MiB・L-6): 教室の組み立ては for…of で逐次(最初の 3 コレクション読みの Promise.all は対象外)。
    expect(builder).toContain('for (const entry of classroomSnapshots.docs) {')
    expect(builder).not.toContain('Promise.all(classroomSnapshots.docs')
    const incident = slice(indexTs, 'async function writeWorkspaceIncidentBackup(', 'async function writeLatestClassroomRollback(')
    expect(incident).toContain("{ onAssemblyFailure: 'throw', reader: 'incident-backup' }")
    // 復元前の安全な控え: 組み立て失敗は握らず(M-1)、復元用ダウンロードは failed-precondition で止める。
    expect(incident).toContain('if (isSnapshotPartsAssemblyError(error)) throw error')
    const download = slice(indexTs, 'await writeWorkspaceIncidentBackup(workspaceKey, `pre-restore-workspace-${backupDateKey}`)', 'const [content] = await file.download()')
    expect(download).toContain("reason: 'incident-backup-assembly-failed'")
  })

  it('行: 直前ロールバック — before/after を唯一の読み手で組み立て、失敗は知らせて投げ直す（空の「直前の状態」を書かない）', () => {
    const rollback = slice(indexTs, 'async function writeLatestClassroomRollback(', 'function shouldWriteClassroomSaveHistory(')
    expect(rollback).toContain('beforePayload = await readClassroomSnapshotPayload(params.snapshotRef, params.beforeSnapshot)')
    expect(rollback).toContain('afterPayload = await readClassroomSnapshotPayload(params.snapshotRef, afterSnapshot)')
    // 分割形式どうしは全体ハッシュで前後の同一を判定し、after の部品(約 50 文書)は読まない(§9-6)。
    expect(rollback).toContain('params.beforeSnapshot.compositeHash === afterSnapshot.compositeHash')
    expect(rollback).toContain("reader: 'latest-rollback', error })\n    throw error")
    const trigger = slice(indexTs, 'export const mirrorLatestClassroomRollback = onDocumentWritten(', 'export const createWorkspaceServerQuarterHourlyBackups = onSchedule(')
    expect(trigger).toContain('snapshotRef,')
  })

  it('行: 版履歴 — 分割形式の目次は組み立てた教室データ全体を単一文書にして書く（目次そのものを Storage に書かない）', () => {
    const history = slice(indexTs, 'async function writeClassroomSaveHistory(', 'function deserializeBoardState(')
    expect(history).toContain('isSnapshotPartsManifest(params.afterSnapshot)')
    expect(history).toContain('await buildAssembledStoredSnapshotDoc(')
    const assembler = slice(indexTs, 'async function buildAssembledStoredSnapshotDoc(', 'function createEmptyAppSnapshotPayload(')
    expect(assembler).toContain('payload = await readClassroomSnapshotPayload(params.snapshotRef, params.manifest)')
    expect(assembler).toContain('throw error')
    expect(assembler).toContain('return createStoredSnapshotDoc({')
  })

  it('行: 保護者向け表示（日程・発行時の実在確認）— 唯一の読み手を await し、失敗は従来の読めない扱い（空の日程を出さない）', () => {
    const deps = slice(indexTs, 'function buildParentPortalDeps', 'buildScheduleView: (payload, studentId, range)')
    expect(deps).toContain('await readClassroomSnapshotPayload(parentPortalClassroomSnapshotRef(workspaceKey, classroomId), data)')
    const exists = slice(indexTs, 'async function requireParentPortalStudentExists(', 'async function loadStudentPortalOwnerAndToken(')
    expect(exists).toContain('await readClassroomSnapshotPayload(snapshotRef, snapshot.data() as FirebaseClassroomSnapshotDoc)')
  })

  it('行: 在籍数台帳 — 組み立てられない教室があれば在籍 0 名として記録せず、知らせて失敗させる', () => {
    const ledger = slice(indexTs, 'async function recordStudentCountLedgerEntry(', 'async function runMonthlyStudentCountLedger(')
    expect(ledger).toContain('await readClassroomSnapshotPayload(workspaceRef.collection(\'classroomSnapshots\').doc(entry.id), snapshotByClassroomId.get(entry.id))')
    expect(ledger).toContain("reader: 'student-count-ledger', error })\n      throw error")
  })

  it('行: 保存の読み戻しと空データ上書き拒否（旧形式の書き手）— 唯一の読み手で読む。書く形式は resolveSnapshotWriteFormat が決め、分割形式の教室は旧形式で上書きしない（一方通行）', () => {
    const save = slice(indexTs, 'async function saveClassroomSnapshotFromCallable', 'export const saveClassroomSnapshot = onCall(')
    expect(save).toContain('const readbackPayload = await readClassroomSnapshotPayload(snapshotRef, readbackSnapshot.exists ? readbackSnapshot.data() as FirebaseClassroomSnapshotDoc : null)')
    expect(save).toContain('previousIsPartsManifest: isSnapshotPartsManifest(previousSnapshotData),')
    // 分割形式で書く保存は旧形式の書き手（createStoredSnapshotDoc）へ進まず、分割形式の書き手へ分岐する。
    const branch = save.indexOf("if (writeFormat === 'weekly-parts') {\n    return saveClassroomSnapshotAsParts({")
    expect(branch).toBeGreaterThan(-1)
    expect(branch).toBeLessThan(save.indexOf('const snapshotDoc = createStoredSnapshotDoc({'))
    expect(save).not.toContain('parts-format-write-unsupported')
    const guard = slice(indexTs, 'async function assertNoSnapshotDataLoss(', 'function isGoogleDriveBackupConfigured(')
    expect(guard).toContain('await readClassroomSnapshotPayload(params.snapshotRef, params.previousSnapshot)')
    expect(guard).toContain('params.previousSnapshot.managementCount')
  })
})

// ---------------------------------------------------------------------------
// 保存する側の約束（段階 B・2026-10-28）: 保存で作られる目次は、参照するすべての部品が書けて読み戻しで一致したときだけ有効になる。
// 判定は純関数（functions/src/snapshotPartsWriter.ts・snapshotPartsWriter.test.ts で固定）。ここは index.ts の配線を固定する。
// ---------------------------------------------------------------------------
describe('INV-14 行（書き手）: 分割形式の保存は 1 トランザクション・読み戻し検証・失敗なら目次を直前へ戻す（ソース走査）', () => {
  const writer = slice(indexTs, 'async function saveClassroomSnapshotAsParts(', '// 講習履歴(生徒1人の出席・休み・振替・配置の一覧)を返す。')

  it('部品の書き込みと目次の切り替えは同じ runTransaction の中（部品だけ新しい目次は作らない・§9-4-5）。中では判定と書き込みだけ', () => {
    const tx = slice(writer, 'txResult = await firestore.runTransaction(async (transaction) => {', '  } catch (error) {')
    expect(tx).toContain('const current = await transaction.get(snapshotRef)')
    expect(tx).toContain('const plan = planSnapshotPartsCommit({')
    expect(tx).toContain('for (const write of plan.partWrites) transaction.set(partsCollection.doc(write.docId), write.doc)')
    expect(tx).toContain('transaction.set(snapshotRef, plan.manifest)')
    expect(tx).toContain("if (plan.outcome !== 'commit') return { plan, previousDoc: currentDoc }")
    // メール・saveAttempts の記録・Firestore の別読みはトランザクションの外（再実行されうる）。
    expect(tx).not.toContain('notifySaveFailureByMail(')
    expect(tx).not.toContain('saveAttemptRef.set(')
    expect(tx).not.toContain('.get()')
  })

  it('STALE・空データ・上限超過は何も書かずに失敗を返す（部品は 1 件も増えない・AC-10 / AC-11 / AC-14）', () => {
    expect(writer).toContain("if (plan.outcome === 'stale') {")
    expect(writer).toContain("if (plan.outcome === 'empty-management-data') {")
    expect(writer).toContain("if (plan.outcome === 'too-large') {")
    expect(writer).toContain('throw await buildTooLargeError(')
    expect(writer).toContain('`${STALE_SNAPSHOT_ERROR_MARKER}:別の端末でこの教室のデータが更新されています')
    expect(writer).toContain("`${SNAPSHOT_TOO_LARGE_ERROR_MARKER}:教室のデータが保存できる大きさの上限を超えたため、保存できませんでした。`")
  })

  it('読み戻し検証は目次とこの保存で書いた部品すべて（verifySnapshotPartsReadback）。失敗なら目次を直前の内容へ戻し（目次の saveId がこの saveId のときだけ）、verification-failed を記録して internal（AC-15）', () => {
    expect(writer).toContain('const readback = verifySnapshotPartsReadback({')
    expect(writer).toContain('writtenParts,')
    expect(writer).toContain('partDocs: readbackPartDocs,')
    const rollback = slice(writer, 'if (!readback.ok) {', "throw new HttpsError('internal', '保存後の確認に失敗しました。もう一度保存してください。', { reason: 'readback-verification-failed' })")
    expect(rollback).toContain('if (!isSnapshotPartsManifest(latestDoc) || latestDoc.saveId !== saveId) return')
    expect(rollback).toContain('if (previousDoc) transaction.set(snapshotRef, previousDoc)')
    expect(rollback).toContain('else transaction.delete(snapshotRef)')
    expect(rollback).toContain("await recordSaveAttemptFailure('verification-failed'")
    expect(rollback).toContain("kind: 'readback-failed'")
    // 確定済みの再送の読み戻し失敗では目次を戻さない（確定済みの保存を取り消さない）。
    expect(rollback).toContain("if (plan.outcome === 'commit') {")
  })

  it('verified の記録 → 操作ログ・台帳・痕跡（K-6）→ 容量通知（最後・K-5）の順。応答は分割形式の印と全体ハッシュを返す', () => {
    const verified = writer.indexOf("status: 'verified'")
    const events = writer.indexOf('await persistOperationEvents(')
    const notices = writer.indexOf('resolveSnapshotPartsCapacityNotices(plan)')
    expect(verified).toBeGreaterThan(-1)
    expect(events).toBeGreaterThan(verified)
    expect(notices).toBeGreaterThan(events)
    expect(writer).toContain("writeMode: 'cloud-function-parts',")
    expect(writer).toContain('storageFormat: SNAPSHOT_PARTS_STORAGE_FORMAT,')
    expect(writer).toContain('compositeHash: readback.manifest.compositeHash,')
  })

  it('古い画面（段階 A より前）からの分割形式の保存は書く前に拒否する（AC-18）。一方通行の判定は resolveSnapshotWriteFormat', () => {
    const save = slice(indexTs, 'async function saveClassroomSnapshotFromCallable', 'export const saveClassroomSnapshot = onCall(')
    const tooOld = save.indexOf("if (writeFormat === 'weekly-parts' && !isClientNewEnoughForSnapshotParts(incomingClient.appVersion)) {")
    const branch = save.indexOf("if (writeFormat === 'weekly-parts') {\n    return saveClassroomSnapshotAsParts({")
    expect(tooOld).toBeGreaterThan(-1)
    expect(tooOld).toBeLessThan(branch)
    expect(save).toContain("throw new HttpsError('failed-precondition', buildClientTooOldMessage(), { reason: 'client-too-old' })")
    expect(save).toContain('const writeFormat = resolveSnapshotWriteFormat({')
  })

  it('旧版の部品の掃除は目次が無い教室に触れず、削除の直前に目次を読み直して参照を再確認する（AC-25）', () => {
    const gc = slice(indexTs, 'async function pruneSnapshotParts(', 'async function runSaveAttemptCleanup() {')
    expect(gc).toContain('resolveSnapshotPartGcActions({')
    expect(gc).toContain('const latestManifest = await snapshotDoc.ref.get()')
    expect(gc).toContain('if (latestReferenced.has(docId)) {')
    expect(gc).toContain("partsCollection.select('gcMarkedAt').get()")
    expect(gc).toContain('SNAPSHOT_PART_GC_DRY_RUN')
    // 壊れた目次（検査に落ちる）は触らない（null）。目次が無い教室は classroomSnapshots の一覧に出ないので巡回されない。
    const resolver = slice(indexTs, 'function resolveReferencedSnapshotPartDocIds(', 'async function pruneSnapshotParts(')
    expect(resolver).toContain('if (!validation.ok) return null')
  })
})
