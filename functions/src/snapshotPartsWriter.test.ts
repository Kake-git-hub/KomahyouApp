// 週単位の分割保存 段階 B: サーバーの書き手の純ロジック(docs/spec-save-restore.md §9-4・§9-6・AC-9〜AC-17)。
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assembleClassroomSnapshotFromParts,
  buildSnapshotCompositeHashInputFromManifest,
  buildSnapshotPartHashInput,
  listSnapshotPartReferences,
  SNAPSHOT_PART_ENCODING,
  stableStringifySnapshotValue,
  type SnapshotPartDoc,
  type SnapshotPartsManifest,
} from './generated/classroomSnapshotParts'
import { FIRESTORE_DOCUMENT_MAX_BYTES } from './snapshotCapacity'
import { assembleSnapshotPartsManifest, decodeSnapshotPartDoc, hashSnapshotPartInput } from './snapshotPartsReader'
import {
  buildQrMergedCorePart,
  buildQrMergeWriterId,
  buildSnapshotParts,
  mergeLectureSubmissionIntoPayload,
  planSnapshotPartsCommit,
  resolveSnapshotPartsCapacityNotices,
  sha256Hex,
  SNAPSHOT_PART_SPLIT_NOTICE_BYTES,
  SNAPSHOT_PARTS_TX_MAX_WRITES,
  SNAPSHOT_PARTS_TX_NOTICE_WRITES,
  verifySnapshotPartsReadback,
  type SnapshotPartsCommitPlan,
} from './snapshotPartsWriter'

const SNAPSHOT_PATH = 'workspaces/main/classroomSnapshots/c1'

function buildPayload(options: { studentName?: string; weekCount?: number; extraWeekCell?: Record<string, unknown> } = {}) {
  const week = (dateKey: string) => [1, 2].map((slot) => ({ id: `${dateKey}#${slot}`, dateKey, slotNumber: slot, desks: [{ students: [{ studentId: 's1', status: 'attended' }], teacherId: 't1' }], ...(options.extraWeekCell ?? {}) }))
  const weeks = Array.from({ length: options.weekCount ?? 3 }, (_, index) => week(`2026-05-${String(11 + index * 7).padStart(2, '0')}`))
  return {
    screen: 'board',
    classroomSettings: { deskCount: 14 },
    managers: [], teachers: [{ id: 't1', name: '講師A' }], students: [{ id: 's1', name: options.studentName ?? '生徒A' }],
    regularLessons: [], groupLessons: [], specialSessions: [{ id: 'ss1', studentInputs: { s1: { regularBreakSlots: ['x'] } }, teacherInputs: {} }], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks, weekIndex: 1, selectedCellId: '', suppressedRegularLessonOccurrences: ['x'] },
  }
}

function commitInput(overrides: Partial<Parameters<typeof planSnapshotPartsCommit>[0]> & { payload?: Record<string, unknown> } = {}) {
  const payload = overrides.payload ?? buildPayload()
  const built = overrides.built ?? buildSnapshotParts(payload)
  return {
    currentDoc: null,
    classroomId: 'c1',
    snapshotPath: SNAPSHOT_PATH,
    saveId: 'save-0001',
    savedAt: '2026-10-28T00:00:00.000Z',
    updatedBy: 'uid-manager',
    incomingBaseVersion: undefined,
    built,
    managementCount: 2,
    dataByteLength: 1000,
    createdAt: '2026-10-28T00:00:01.000Z',
    ...overrides,
  }
}

/** 計画の書き込みを「Firestore に書いた」体で持つ(部品文書の置き場)。 */
function applyPlan(store: Map<string, Record<string, unknown>>, plan: SnapshotPartsCommitPlan) {
  if (plan.outcome !== 'commit') throw new Error(`commit ではない: ${plan.outcome}`)
  for (const write of plan.partWrites) store.set(write.docId, write.doc as unknown as Record<string, unknown>)
  return plan.manifest
}

/** 読み直した目次 manifestDoc を、計画(plan)が書いたはずの目次・部品と照合する。期待値は plan.manifest から(読み直した側を信用しない)。 */
function readbackOf(store: Map<string, Record<string, unknown>>, manifestDoc: SnapshotPartsManifest, plan: Extract<SnapshotPartsCommitPlan, { outcome: 'commit' }>) {
  const writtenParts = plan.partWrites.map((write) => ({ partKey: write.partKey, docId: write.docId, hash: write.doc.hash }))
  return verifySnapshotPartsReadback({
    manifestDoc,
    expected: { saveId: plan.manifest.saveId ?? '', version: plan.manifest.version ?? 0, compositeHash: plan.manifest.compositeHash },
    writtenParts,
    partDocs: writtenParts.map((part) => store.get(part.docId) ?? null),
  })
}

describe('buildSnapshotParts(部品・ハッシュ・圧縮・全体ハッシュ)', () => {
  it('core / board / 週ごとの部品を作り、読み手(decode + hash)で元に戻る。全体ハッシュは目次から再計算した値と一致する(AC-16)', async () => {
    const payload = buildPayload()
    const built = buildSnapshotParts(payload)
    expect(built.parts.map((part) => part.partKey)).toEqual(['core', 'board', 'week:2026-05-11', 'week:2026-05-18', 'week:2026-05-25'])
    for (const part of built.parts) {
      const doc = { encoding: SNAPSHOT_PART_ENCODING, compressedData: part.compressedData }
      const content = decodeSnapshotPartDoc(doc)
      expect(hashSnapshotPartInput(buildSnapshotPartHashInput(content))).toBe(part.hash)
      expect(part.rawBytes).toBe(Buffer.byteLength(part.json, 'utf8'))
      expect(part.storedBytes).toBe(part.compressedData.length)
    }
    const plan = planSnapshotPartsCommit(commitInput({ built }))
    expect(plan.outcome).toBe('commit')
    const manifest = (plan as Extract<SnapshotPartsCommitPlan, { outcome: 'commit' }>).manifest
    expect(sha256Hex(buildSnapshotCompositeHashInputFromManifest(manifest))).toBe(built.compositeHash)
  })

  it('boardState が null の教室は core だけ(board も週も無し)', () => {
    const built = buildSnapshotParts({ ...buildPayload(), boardState: null })
    expect(built.parts.map((part) => part.partKey)).toEqual(['core'])
    const plan = planSnapshotPartsCommit(commitInput({ built }))
    expect(plan.outcome).toBe('commit')
    const manifest = (plan as Extract<SnapshotPartsCommitPlan, { outcome: 'commit' }>).manifest
    expect(manifest.hasBoardState).toBe(false)
    expect(manifest.parts.board).toBeUndefined()
    expect(manifest.weeks).toEqual([])
  })
})

describe('planSnapshotPartsCommit(トランザクションの中の判定)', () => {
  it('旧形式(または文書なし)からの最初の保存は全部品を書き、版数は +1(AC-17 の移行)', () => {
    const plan = planSnapshotPartsCommit(commitInput({ currentDoc: { schemaVersion: 1, version: 7, dataEncoding: 'gzip-base64', compressedData: 'x' }, incomingBaseVersion: 7 }))
    expect(plan.outcome).toBe('commit')
    if (plan.outcome !== 'commit') return
    expect(plan.nextVersion).toBe(8)
    expect(plan.writtenPartKeys).toHaveLength(5)
    expect(plan.reusedPartKeys).toEqual([])
    expect(plan.writeCount).toBe(6)
    expect(plan.manifest).toMatchObject({ storageFormat: 'weekly-parts', storageFormatVersion: 1, version: 8, saveId: 'save-0001', lastWriter: 'save', managementCount: 2, hasBoardState: true })
    expect(plan.manifest).not.toHaveProperty('compressedData')
    expect(plan.manifest).not.toHaveProperty('data')
    expect(plan.partWrites[0].docId).toBe('core~-~v8~save-0001')
    expect(plan.partWrites[0].doc).toMatchObject({ classroomId: 'c1', kind: 'core', key: '-', encoding: 'gzip-base64', createdBy: 'save-0001', createdForVersion: 8 })
    expect(plan.manifest.weeks.map((week) => week.key)).toEqual(['2026-05-11', '2026-05-18', '2026-05-25'])
  })

  it('1 週だけ変えた保存は、その週(と board)だけ新しい ID で書き、他は目次の文書を再利用する(AC-6 のサーバー側)', () => {
    const store = new Map<string, Record<string, unknown>>()
    const first = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    const manifest = applyPlan(store, first)
    const edited = buildPayload()
    ;(edited.boardState.weeks[1][0] as Record<string, unknown>).memo = '変更'
    const second = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0002', incomingBaseVersion: 1, built: buildSnapshotParts(edited) }))
    expect(second.outcome).toBe('commit')
    if (second.outcome !== 'commit') return
    expect(second.writtenPartKeys).toEqual(['week:2026-05-18'])
    expect(second.reusedPartKeys).toEqual(['core', 'board', 'week:2026-05-11', 'week:2026-05-25'])
    expect(second.writeCount).toBe(2)
    expect(second.manifest.parts.core.docId).toBe(manifest.parts.core.docId)
    expect(second.manifest.weeks[1].docId).toBe('week~2026-05-18~v2~save-0002')
    expect(second.manifest.weeks[0].docId).toBe(manifest.weeks[0].docId)
    expect(second.manifest.compositeHash).not.toBe(manifest.compositeHash)
    // 再利用した部品と新しい部品で組み立てると編集後の教室データになる。
    applyPlan(store, second)
    const assembled = assembleClassroomSnapshotFromParts(second.manifest, (ref) => {
      const doc = store.get(ref.docId)
      if (!doc) return null
      const content = decodeSnapshotPartDoc(doc)
      return { content, hash: hashSnapshotPartInput(buildSnapshotPartHashInput(content)) }
    })
    expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(edited))
  })

  it('目次の saveId が同じ再送は何も書かずに確定済みとして返す(AC-12 後半・INV-03)', () => {
    const first = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    const manifest = applyPlan(new Map(), first)
    const replay = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0001', incomingBaseVersion: 0 }))
    expect(replay).toEqual({ outcome: 'already-committed', manifest })
  })

  it('「記録はあるが目次は前のまま」の再送は版数照合を受ける(AC-12 前半): 版数が食い違えば STALE・合えば通常どおり書く', () => {
    const first = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    const manifest = applyPlan(new Map(), first)
    const stale = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0002', incomingBaseVersion: 0 }))
    expect(stale).toEqual({ outcome: 'stale', previousVersion: 1, incomingBaseVersion: 0 })
    const ok = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0002', incomingBaseVersion: 1 }))
    expect(ok.outcome).toBe('commit')
    // 旧クライアント(baseVersion なし)は従来どおり照合しない。
    const legacyClient = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0003', incomingBaseVersion: undefined }))
    expect(legacyClient.outcome).toBe('commit')
  })

  it('別の端末が先に保存した教室へ古い版数で保存すると STALE で、部品は 1 件も増えない(AC-11)', () => {
    const plan = planSnapshotPartsCommit(commitInput({ currentDoc: { storageFormat: 'weekly-parts', version: 12, saveId: 'other' }, incomingBaseVersion: 11 }))
    expect(plan).toEqual({ outcome: 'stale', previousVersion: 12, incomingBaseVersion: 11 })
  })

  it('管理データ 0 件の保存は、目次の managementCount が 1 以上なら拒否(AC-14)。前回も 0 件なら通す', () => {
    const first = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    const manifest = applyPlan(new Map(), first)
    const empty = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0002', incomingBaseVersion: 1, managementCount: 0 }))
    expect(empty).toEqual({ outcome: 'empty-management-data', previousManagementCount: 2 })
    const emptyAfterEmpty = planSnapshotPartsCommit(commitInput({ currentDoc: { ...manifest, managementCount: 0 }, saveId: 'save-0002', incomingBaseVersion: 1, managementCount: 0 }))
    expect(emptyAfterEmpty.outcome).toBe('commit')
  })

  it('判定の順序: 確定済みの再送 → STALE → 空データ(再送なら STALE も空データも見ない)', () => {
    const first = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    const manifest = applyPlan(new Map(), first)
    const replay = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0001', incomingBaseVersion: 99, managementCount: 0 }))
    expect(replay.outcome).toBe('already-committed')
    const staleBeforeEmpty = planSnapshotPartsCommit(commitInput({ currentDoc: manifest, saveId: 'save-0002', incomingBaseVersion: 99, managementCount: 0 }))
    expect(staleBeforeEmpty.outcome).toBe('stale')
  })

  it('書き込み件数が 400 件を超える保存は、何も書かずに too-large(AC-10)', () => {
    const plan = planSnapshotPartsCommit(commitInput({ built: buildSnapshotParts(buildPayload({ weekCount: SNAPSHOT_PARTS_TX_MAX_WRITES })) }))
    expect(plan.outcome).toBe('too-large')
    if (plan.outcome !== 'too-large') return
    expect(plan.writeCount).toBe(SNAPSHOT_PARTS_TX_MAX_WRITES + 3)
    expect(plan.detail).toContain('件数')
  })

  it('1 文書の上限(1MiB)を超える部品があれば、部品キーつきで too-large(AC-4)', () => {
    // 圧縮が効かないよう乱数(base64)で埋める(gzip 後も 1MiB を超える週)。
    const noise = randomBytes(900_000).toString('base64')
    const built = buildSnapshotParts(buildPayload({ extraWeekCell: { noise } }))
    const plan = planSnapshotPartsCommit(commitInput({ built }))
    expect(plan.outcome).toBe('too-large')
    if (plan.outcome !== 'too-large') return
    expect(plan.maxDocumentPartKey).toMatch(/^week:/)
    expect(plan.maxDocumentBytes).toBeGreaterThan(FIRESTORE_DOCUMENT_MAX_BYTES)
    expect(plan.detail).toContain(plan.maxDocumentPartKey)
  })

  it('壊れた目次(検査に落ちる)の教室への保存は再利用せず全部品を書き直す(読める状態へ戻す)', () => {
    const broken = { storageFormat: 'weekly-parts', storageFormatVersion: 1, version: 3, saveId: 'old', managementCount: 2, hasBoardState: true, ui: {}, parts: {}, weeks: [], compositeHash: 'x' }
    const plan = planSnapshotPartsCommit(commitInput({ currentDoc: broken, incomingBaseVersion: 3 }))
    expect(plan.outcome).toBe('commit')
    if (plan.outcome !== 'commit') return
    expect(plan.writtenPartKeys).toHaveLength(5)
    expect(plan.nextVersion).toBe(4)
  })
})

describe('verifySnapshotPartsReadback(読み戻し検証・AC-15)', () => {
  it('目次と書いた部品が一致すれば ok。目次の saveId / version / compositeHash の食い違い・部品の欠け・中身の改変は失敗', () => {
    const store = new Map<string, Record<string, unknown>>()
    const plan = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    if (plan.outcome !== 'commit') throw new Error('commit ではない')
    const manifest = applyPlan(store, plan)
    expect(readbackOf(store, manifest, plan)).toEqual({ ok: true, manifest })

    expect(readbackOf(store, { ...manifest, saveId: 'other' }, plan)).toMatchObject({ ok: false, detail: expect.stringContaining('saveId') })
    expect(readbackOf(store, { ...manifest, version: 9 }, plan)).toMatchObject({ ok: false, detail: expect.stringContaining('version') })
    expect(readbackOf(store, { ...manifest, compositeHash: 'zzz' }, plan)).toMatchObject({ ok: false, detail: expect.stringContaining('compositeHash') })
    // 目次の部品一覧を書き換えると全体ハッシュと合わない。
    const tampered = { ...manifest, weeks: manifest.weeks.map((week, index) => (index === 0 ? { ...week, hash: 'deadbeef' } : week)) }
    expect(readbackOf(store, tampered, plan)).toMatchObject({ ok: false, detail: expect.stringContaining('全体ハッシュ') })

    const missing = new Map(store)
    missing.delete(plan.partWrites[2].docId)
    expect(readbackOf(missing, manifest, plan)).toMatchObject({ ok: false, detail: expect.stringContaining('部品文書が無い') })

    const corrupted = new Map(store)
    // core(生徒名を含む)を別の生徒名の core で差し替える(board は生徒名を含まないので変わらない)。
    const target = plan.partWrites[0]
    corrupted.set(target.docId, { ...store.get(target.docId)!, compressedData: buildSnapshotParts(buildPayload({ studentName: '別' })).parts[0].compressedData })
    const corruptedResult = readbackOf(corrupted, manifest, plan)
    expect(corruptedResult.ok).toBe(false)
    expect((corruptedResult as { detail: string }).detail).toContain('ハッシュ不一致')
  })

  it('書いていない部品(再利用)は読み直さない(writtenParts が空なら目次だけで判定)', () => {
    const plan = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    if (plan.outcome !== 'commit') throw new Error('commit ではない')
    const result = verifySnapshotPartsReadback({
      manifestDoc: plan.manifest,
      expected: { saveId: 'save-0001', version: 1, compositeHash: plan.manifest.compositeHash },
      writtenParts: [],
      partDocs: [],
    })
    expect(result.ok).toBe(true)
  })

  it('読み戻した部品一式はサーバーの読み手(assembleSnapshotPartsManifest)で元の教室データに戻る', async () => {
    const store = new Map<string, Record<string, unknown>>()
    const payload = buildPayload()
    const plan = planSnapshotPartsCommit(commitInput({ payload, incomingBaseVersion: 0 }))
    const manifest = applyPlan(store, plan)
    const assembled = await assembleSnapshotPartsManifest(manifest, {
      fetchPartDocs: async (docIds) => docIds.map((docId) => store.get(docId) ?? null),
      refetchManifest: async () => manifest,
    })
    expect(stableStringifySnapshotValue(assembled)).toBe(stableStringifySnapshotValue(payload))
  })
})

describe('QR 提出のマージ(§9-6・K-9・INV-07)', () => {
  const submission = {
    sessionId: 'ss1', personType: 'student', personId: 's1', token: 'tok-1234567890abcdef', now: '2026-10-28T01:00:00.000Z',
    unavailableSlots: ['2026-11-01#1'], subjectSlots: { 数学: 2 }, subjectDurations: {}, groupClassParticipation: {}, optionChecks: {}, regularOnly: false,
  }

  it('mergeLectureSubmissionIntoPayload は従来のマージと同じ中身を新しいオブジェクトで返す(元は変えない)。対象の講習が無ければ null', () => {
    const payload = buildPayload()
    const merged = mergeLectureSubmissionIntoPayload(payload, submission)
    expect(merged).not.toBeNull()
    const input = ((merged!.specialSessions as Array<Record<string, unknown>>)[0].studentInputs as Record<string, Record<string, unknown>>).s1
    expect(input).toMatchObject({
      unavailableSlots: ['2026-11-01#1'], reopenedSlots: [], subjectSlots: { 数学: 2 }, regularOnly: false, regularBreakSlots: ['x'],
      countSubmitted: true, submissionToken: 'tok-1234567890abcdef', submittedAt: submission.now, submissionMethod: 'qr', updatedAt: submission.now,
    })
    // 元のオブジェクトは変えない(トランザクションの再実行で二重反映しない)。
    expect(((payload.specialSessions[0] as Record<string, unknown>).studentInputs as Record<string, Record<string, unknown>>).s1).toEqual({ regularBreakSlots: ['x'] })
    expect(mergeLectureSubmissionIntoPayload(payload, { ...submission, sessionId: 'none' })).toBeNull()
    expect(mergeLectureSubmissionIntoPayload({ ...payload, specialSessions: undefined }, submission)).toBeNull()
    // 講師は科目などを持たない。
    const teacher = mergeLectureSubmissionIntoPayload(payload, { ...submission, personType: 'teacher', personId: 't1' })
    const teacherInput = ((teacher!.specialSessions as Array<Record<string, unknown>>)[0].teacherInputs as Record<string, Record<string, unknown>>).t1
    expect(teacherInput).not.toHaveProperty('subjectSlots')
    expect(teacherInput).toMatchObject({ countSubmitted: true, submissionMethod: 'qr' })
  })

  it('buildQrMergedCorePart は core だけ新しい部品にし、目次の版数・savedAt・saveId は据え置き・lastWriter=qr-submission・compositeHash 更新', () => {
    const store = new Map<string, Record<string, unknown>>()
    const plan = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    const manifest = applyPlan(store, plan)
    const core = decodeSnapshotPartDoc(store.get(manifest.parts.core.docId)) as Record<string, unknown>
    const mergedCore = mergeLectureSubmissionIntoPayload(core, submission)!
    const writerId = buildQrMergeWriterId(1_700_000_000_000, 'ab12')
    expect(writerId).toBe('qr1700000000000ab12')
    const next = buildQrMergedCorePart({ manifest, classroomId: 'c1', mergedCore, managementCount: 2, now: submission.now, writerId })
    expect(next).not.toBeNull()
    expect(next!.docId).toBe('core~-~v1~qr1700000000')
    expect(next!.doc).toMatchObject({ kind: 'core', key: '-', encoding: 'gzip-base64', createdBy: writerId, createdForVersion: 1, classroomId: 'c1' })
    expect(next!.manifest.version).toBe(manifest.version)
    expect(next!.manifest.savedAt).toBe(manifest.savedAt)
    expect(next!.manifest.saveId).toBe(manifest.saveId)
    expect(next!.manifest.updatedAt).toBe(submission.now)
    expect(next!.manifest.lastWriter).toBe('qr-submission')
    expect(next!.manifest.parts.board).toEqual(manifest.parts.board)
    expect(next!.manifest.weeks).toEqual(manifest.weeks)
    expect(next!.manifest.parts.core.docId).toBe(next!.docId)
    expect(next!.manifest.compositeHash).not.toBe(manifest.compositeHash)
    expect(sha256Hex(buildSnapshotCompositeHashInputFromManifest(next!.manifest))).toBe(next!.manifest.compositeHash)
    // 新しい core を読むと提出が入っている。
    const reread = decodeSnapshotPartDoc(next!.doc as unknown as SnapshotPartDoc) as Record<string, unknown>
    expect(((reread.specialSessions as Array<Record<string, unknown>>)[0].studentInputs as Record<string, Record<string, unknown>>).s1.countSubmitted).toBe(true)
    expect(hashSnapshotPartInput(buildSnapshotPartHashInput(reread))).toBe(next!.manifest.parts.core.hash)
    // 目次が参照する部品は core だけ変わる。
    const before = listSnapshotPartReferences(manifest).map((ref) => ref.docId)
    const after = listSnapshotPartReferences(next!.manifest).map((ref) => ref.docId)
    expect(after.slice(1)).toEqual(before.slice(1))
  })

  it('core の中身が変わらなければ null(何も書かない)', () => {
    const store = new Map<string, Record<string, unknown>>()
    const plan = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    const manifest = applyPlan(store, plan)
    const core = decodeSnapshotPartDoc(store.get(manifest.parts.core.docId)) as Record<string, unknown>
    expect(buildQrMergedCorePart({ manifest, classroomId: 'c1', mergedCore: core, managementCount: 2, now: submission.now, writerId: 'qr1' })).toBeNull()
  })
})

describe('容量の通知(§9-3-7)', () => {
  it('普段の保存では通知なし。core/board が 512KiB 以上・書き込み件数が 200 件以上で第 2 段の合図', () => {
    const plan = planSnapshotPartsCommit(commitInput({ incomingBaseVersion: 0 }))
    if (plan.outcome !== 'commit') throw new Error('commit ではない')
    expect(resolveSnapshotPartsCapacityNotices(plan)).toMatchObject({ capacityWarning: false, splitCapacityNotice: false })
    expect(resolveSnapshotPartsCapacityNotices({ ...plan, corePartBytes: SNAPSHOT_PART_SPLIT_NOTICE_BYTES })).toMatchObject({ splitCapacityNotice: true, detail: expect.stringContaining('core') })
    expect(resolveSnapshotPartsCapacityNotices({ ...plan, boardPartBytes: SNAPSHOT_PART_SPLIT_NOTICE_BYTES + 1 })).toMatchObject({ splitCapacityNotice: true, detail: expect.stringContaining('board') })
    expect(resolveSnapshotPartsCapacityNotices({ ...plan, writeCount: SNAPSHOT_PARTS_TX_NOTICE_WRITES })).toMatchObject({ splitCapacityNotice: true, detail: expect.stringContaining('件数') })
    expect(resolveSnapshotPartsCapacityNotices({ ...plan, maxDocumentBytes: Math.ceil(FIRESTORE_DOCUMENT_MAX_BYTES * 0.85), maxDocumentPartKey: 'core' })).toMatchObject({ capacityWarning: true })
  })
})
