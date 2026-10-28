// 週単位の分割保存(docs/spec-save-restore.md §9)の【サーバーの書き手】の純ロジック(段階 B・2026-10-28)。
//
// index.ts の saveClassroomSnapshotFromCallable / lectureSubmissionApi は Firestore の読み書き(トランザクション)だけを担い、
// 「何を書くか・書いてよいか」の判定はここの純関数で決める(§9-13 ユニット「保存の判定」・AC-9〜15)。
//  - buildSnapshotParts        … 教室データ全体を共有純関数で部品に分け、部品ごとに SHA-256・gzip(level 9)・全体ハッシュを作る。
//  - planSnapshotPartsCommit   … トランザクションの中で「目次 + 送られた部品」から 確定済みの再送 / STALE / 空データ / 上限超過 /
//                                書く部品(新 ID)と再利用する部品 と 新しい目次 を決める(§9-4-4 6・§9-4-5・§9-4-6)。
//  - verifySnapshotPartsReadback … 読み戻し検証(目次の saveId・version・全体ハッシュ ＋ この保存で書いた部品すべて・§9-4-4 7)。
//  - mergeLectureSubmissionIntoPayload / buildQrMergedCorePart … QR 提出のマージ(K-9: 版数・savedAt・saveId 据え置き・§9-6)。
//  - resolveSnapshotPartsCapacityNotices … 85% の容量注意と 50% の「第 2 段着手の合図」(§9-3-7)。
//
// ★守ること(§9-2 K-1〜K-11 と INV-14)
//  - 部品は不変。中身が変われば必ず新しい文書 ID(buildSnapshotPartDocId = kind~key~v版~書き手)。同じ ID へは同じ内容しか書かない。
//  - 旧形式の教室の最初の保存(移行)は**全部品を書く**(旧本体からの「再利用」はしない・§9-4-4 6-5 の簡約)。一方通行(§9-7-1)。
//  - トランザクションの上限(書き込み 400 件・8MiB・1 文書 1MiB)を超えたら**分けて書かずに拒否**(§9-4-5)。
//  - 判定だけ。Firestore・メール・saveAttempts はここで触らない(トランザクションは再実行されうる)。
import { gzipSync } from 'node:zlib'
import {
  buildSnapshotCompositeHashInput,
  buildSnapshotCompositeHashInputFromManifest,
  buildSnapshotPartDocId,
  buildSnapshotPartHashInput,
  buildSnapshotWeekPartKey,
  isSnapshotPartsManifest,
  listSnapshotPartContents,
  listSnapshotPartReferences,
  SNAPSHOT_PART_ENCODING,
  SNAPSHOT_PART_KEY_BOARD,
  SNAPSHOT_PART_KEY_CORE,
  SNAPSHOT_PARTS_STORAGE_FORMAT,
  SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
  SNAPSHOT_PARTS_SUBCOLLECTION,
  sanitizeSnapshotValue,
  splitClassroomSnapshotPayload,
  validateSnapshotPartsManifest,
  type SnapshotPartDoc,
  type SnapshotPartInfo,
  type SnapshotPartKind,
  type SnapshotPartsManifest,
  type SplitClassroomSnapshot,
} from './generated/classroomSnapshotParts'
import { resolveOptimisticVersionDecision } from './optimisticVersion'
import { estimateFirestoreDocumentBytes, FIRESTORE_DOCUMENT_MAX_BYTES, SNAPSHOT_CAPACITY_WARNING_RATIO, SNAPSHOT_GZIP_LEVEL } from './snapshotCapacity'
import { decodeSnapshotPartDoc, hashSnapshotPartInput } from './snapshotPartsReader'

// ---------------------------------------------------------------------------
// 上限(§9-3-7・§9-4-5)。Firestore の 500 件・10MiB の 8 割。
// ---------------------------------------------------------------------------
export const SNAPSHOT_PARTS_TX_MAX_WRITES = 400
export const SNAPSHOT_PARTS_TX_MAX_BYTES = 8 * 1024 * 1024
/** トランザクションの 50%(200 件・5MiB)以上で「第 2 段(部品の先書き)着手の合図」を知らせる。 */
export const SNAPSHOT_PARTS_TX_NOTICE_WRITES = 200
export const SNAPSHOT_PARTS_TX_NOTICE_BYTES = 5 * 1024 * 1024
/** core / board の保存サイズが 512KiB 以上で「部品の追加分割(第 2 段)着手の合図」を知らせる。 */
export const SNAPSHOT_PART_SPLIT_NOTICE_BYTES = 512 * 1024

/** SHA-256(16 進)。実装は読み手の hashSnapshotPartInput 1 つ(regression-reviewer 低-5: 二重実装にしない)。 */
export function sha256Hex(input: string): string {
  return hashSnapshotPartInput(input)
}

/**
 * 保存の書き手 ID(部品文書 ID の末尾 12 文字に入る)。saveId は `${savedAt}_${classroomId}_${uuid}` で先頭 12 文字が時刻(同じ時間帯で全保存が同じ)に
 * なるため、saveId の SHA-256 の先頭 12 文字を使う(regression-reviewer 中-1: 文書 ID が一意でないと「部品は不変」が崩れる)。
 */
export function buildSaveWriterId(saveId: string): string {
  return sha256Hex(saveId).slice(0, 12)
}

// ---------------------------------------------------------------------------
// 部品を作る
// ---------------------------------------------------------------------------

export type BuiltSnapshotPart = {
  partKey: string
  kind: SnapshotPartKind
  key: string
  /** 部品ハッシュ(SHA-256 of stableStringify(sanitize 済みの中身))。 */
  hash: string
  /** 中身の JSON(sanitize 済み)。 */
  json: string
  compressedData: string
  rawBytes: number
  storedBytes: number
}

export type BuiltSnapshotParts = {
  split: SplitClassroomSnapshot
  parts: BuiltSnapshotPart[]
  /** 部品キー → ハッシュ(応答の partHashes・読み戻しの照合に使う)。 */
  partHashes: Record<string, string>
  compositeHash: string
}

/** 1 部品の圧縮(サーバーは常に level 9・§9-3-5)。 */
export function compressSnapshotPartJson(json: string): string {
  return gzipSync(Buffer.from(json, 'utf8'), { level: SNAPSHOT_GZIP_LEVEL }).toString('base64')
}

/**
 * 教室データ全体(従来の形 `payload`)を部品に分け、部品ごとのハッシュ・圧縮・全体ハッシュを作る。
 * 分割・週キーは共有純関数(splitClassroomSnapshotPayload)だけが行う。sanitize は分割の中で済む。
 */
export function buildSnapshotParts(payload: Record<string, unknown>): BuiltSnapshotParts {
  const split = splitClassroomSnapshotPayload(payload)
  const parts = listSnapshotPartContents(split).map<BuiltSnapshotPart>((entry) => {
    const json = JSON.stringify(entry.content)
    const hash = sha256Hex(buildSnapshotPartHashInput(entry.content))
    const compressedData = compressSnapshotPartJson(json)
    return {
      partKey: entry.partKey,
      kind: entry.kind,
      key: entry.key,
      hash,
      json,
      compressedData,
      rawBytes: Buffer.byteLength(json, 'utf8'),
      storedBytes: compressedData.length,
    }
  })
  const partHashes: Record<string, string> = {}
  for (const part of parts) partHashes[part.partKey] = part.hash
  const compositeHash = sha256Hex(buildSnapshotCompositeHashInput({
    ui: split.ui,
    hasBoardState: split.hasBoardState,
    coreHash: partHashes[SNAPSHOT_PART_KEY_CORE],
    boardHash: split.hasBoardState ? partHashes[SNAPSHOT_PART_KEY_BOARD] ?? null : null,
    weeks: split.weeks.map((week) => [week.key, partHashes[buildSnapshotWeekPartKey(week.key)]] as const),
  }))
  return { split, parts, partHashes, compositeHash }
}

// ---------------------------------------------------------------------------
// 保存の判定(トランザクションの中で呼ぶ・純関数)
// ---------------------------------------------------------------------------

export type SnapshotPartWrite = {
  partKey: string
  docId: string
  doc: SnapshotPartDoc
  /** Firestore の計算方法での文書サイズ(見積もり)。 */
  documentBytes: number
}

export type SnapshotPartsCommitPlan =
  | { outcome: 'already-committed'; manifest: SnapshotPartsManifest }
  | { outcome: 'stale'; previousVersion: number; incomingBaseVersion: number }
  | { outcome: 'empty-management-data'; previousManagementCount: number }
  | { outcome: 'too-large'; detail: string; maxDocumentBytes: number; maxDocumentPartKey: string; writeCount: number; totalBytes: number }
  | {
    outcome: 'commit'
    nextVersion: number
    manifest: SnapshotPartsManifest
    partWrites: SnapshotPartWrite[]
    writtenPartKeys: string[]
    reusedPartKeys: string[]
    /** トランザクションの書き込み件数(部品 + 目次)。saveAttempts.writeCountInTx。 */
    writeCount: number
    totalBytes: number
    maxDocumentBytes: number
    maxDocumentPartKey: string
    manifestBytes: number
    corePartBytes: number
    boardPartBytes: number
  }

export type SnapshotPartsCommitInput = {
  /** トランザクションで読んだ目次文書の data()(旧形式の文書・存在しないときは null)。 */
  currentDoc: unknown
  classroomId: string
  /** 目次文書のデータベース内パス(workspaces/{ws}/classroomSnapshots/{id})。サイズ見積もりに使う。 */
  snapshotPath: string
  saveId: string
  savedAt: string
  updatedBy: string
  incomingBaseVersion: number | undefined
  built: BuiltSnapshotParts
  /** 新しい core の管理データ件数(countClassroomManagementData)。 */
  managementCount: number
  /** 組み立て後の JSON の総バイト(非圧縮・参考値)。 */
  dataByteLength: number
  createdAt: string
  schemaVersion?: number
}

function readManifestPartInfos(manifest: SnapshotPartsManifest): Map<string, SnapshotPartInfo> {
  const map = new Map<string, SnapshotPartInfo>()
  const weekInfoByKey = new Map(manifest.weeks.map((week) => [week.key, week]))
  for (const ref of listSnapshotPartReferences(manifest)) {
    const info = ref.kind === 'core' ? manifest.parts.core : ref.kind === 'board' ? manifest.parts.board : weekInfoByKey.get(ref.key)
    if (info) map.set(ref.partKey, { docId: info.docId, hash: info.hash, rawBytes: info.rawBytes, storedBytes: info.storedBytes })
  }
  return map
}

/**
 * 目次と送られた部品から、書くもの・再利用するものと新しい目次を決める(§9-4-4 6-1〜6-8)。
 * 順序: 確定済みの再送(目次の saveId が同じ) → A1 版数照合(isReplay は使わない=「記録はあるが未検証」では飛ばさない・§9-4-6) →
 * 空データ上書き拒否(目次の managementCount) → 再利用/新規の振り分け → 上限判定 → 新しい目次。
 */
export function planSnapshotPartsCommit(input: SnapshotPartsCommitInput): SnapshotPartsCommitPlan {
  const currentDoc = input.currentDoc && typeof input.currentDoc === 'object' ? input.currentDoc as Record<string, unknown> : null
  const currentManifest = isSnapshotPartsManifest(currentDoc) ? currentDoc : null

  // 6-2: 既に確定済みの再送(同じ saveId の目次がある)。何も書かない。
  if (currentManifest && currentManifest.saveId === input.saveId) {
    return { outcome: 'already-committed', manifest: currentManifest }
  }

  // 6-3: A1 版数照合をトランザクションの中で。
  const previousVersion = typeof currentDoc?.version === 'number' ? currentDoc.version as number : undefined
  const decision = resolveOptimisticVersionDecision({ incomingBaseVersion: input.incomingBaseVersion, previousVersion, isReplay: false })
  if (!decision.ok) {
    return { outcome: 'stale', previousVersion: decision.previousVersion, incomingBaseVersion: decision.incomingBaseVersion }
  }
  const nextVersion = decision.nextVersion

  // 6-6: 空データ上書き拒否(分割形式の目次は managementCount で・旧形式は呼び出し側が事前に 1 回解凍して数えている)。
  if (currentManifest && typeof currentManifest.managementCount === 'number' && input.managementCount <= 0 && currentManifest.managementCount > 0) {
    return { outcome: 'empty-management-data', previousManagementCount: currentManifest.managementCount }
  }

  // 6-5: 目次と同じハッシュの部品は既存の文書を再利用。旧形式(または目次が壊れている)なら全部品を書く。
  const previousInfos = currentManifest && validateSnapshotPartsManifest(currentManifest).ok ? readManifestPartInfos(currentManifest) : new Map<string, SnapshotPartInfo>()
  const partWrites: SnapshotPartWrite[] = []
  const writtenPartKeys: string[] = []
  const reusedPartKeys: string[] = []
  const infoByPartKey = new Map<string, SnapshotPartInfo>()
  let totalBytes = 0
  let maxDocumentBytes = 0
  let maxDocumentPartKey = ''
  let corePartBytes = 0
  let boardPartBytes = 0
  for (const part of input.built.parts) {
    const previous = previousInfos.get(part.partKey)
    if (previous && previous.hash === part.hash) {
      infoByPartKey.set(part.partKey, previous)
      reusedPartKeys.push(part.partKey)
      continue
    }
    const docId = buildSnapshotPartDocId({ kind: part.kind, key: part.key, version: nextVersion, writerId: buildSaveWriterId(input.saveId) })
    const doc: SnapshotPartDoc = {
      classroomId: input.classroomId,
      kind: part.kind,
      key: part.key,
      hash: part.hash,
      encoding: SNAPSHOT_PART_ENCODING,
      compressedData: part.compressedData,
      rawByteLength: part.rawBytes,
      createdAt: input.createdAt,
      createdBy: input.saveId,
      createdForVersion: nextVersion,
    }
    const documentBytes = estimateFirestoreDocumentBytes(`${input.snapshotPath}/${SNAPSHOT_PARTS_SUBCOLLECTION}/${docId}`, doc as unknown as Record<string, unknown>)
    partWrites.push({ partKey: part.partKey, docId, doc, documentBytes })
    writtenPartKeys.push(part.partKey)
    infoByPartKey.set(part.partKey, { docId, hash: part.hash, rawBytes: part.rawBytes, storedBytes: part.storedBytes })
    totalBytes += documentBytes
    if (documentBytes > maxDocumentBytes) {
      maxDocumentBytes = documentBytes
      maxDocumentPartKey = part.partKey
    }
    if (part.partKey === SNAPSHOT_PART_KEY_CORE) corePartBytes = documentBytes
    if (part.partKey === SNAPSHOT_PART_KEY_BOARD) boardPartBytes = documentBytes
  }

  const split = input.built.split
  const core = infoByPartKey.get(SNAPSHOT_PART_KEY_CORE)
  if (!core) throw new Error('core 部品がありません')
  const board = split.hasBoardState ? infoByPartKey.get(SNAPSHOT_PART_KEY_BOARD) : undefined
  const manifest: SnapshotPartsManifest = {
    schemaVersion: input.schemaVersion ?? 1,
    storageFormat: SNAPSHOT_PARTS_STORAGE_FORMAT,
    storageFormatVersion: SNAPSHOT_PARTS_STORAGE_FORMAT_VERSION,
    version: nextVersion,
    savedAt: input.savedAt,
    updatedAt: input.savedAt,
    updatedBy: input.updatedBy,
    saveId: input.saveId,
    compositeHash: input.built.compositeHash,
    managementCount: input.managementCount,
    dataByteLength: input.dataByteLength,
    hasBoardState: split.hasBoardState,
    ui: split.ui,
    parts: board ? { core, board } : { core },
    weeks: split.weeks.map((week) => {
      const info = infoByPartKey.get(buildSnapshotWeekPartKey(week.key))
      if (!info) throw new Error(`週の部品がありません: ${week.key}`)
      return { key: week.key, ...info }
    }),
    lastWriter: 'save',
  }
  const manifestBytes = estimateFirestoreDocumentBytes(input.snapshotPath, manifest as unknown as Record<string, unknown>)
  totalBytes += manifestBytes
  if (manifestBytes > maxDocumentBytes) {
    maxDocumentBytes = manifestBytes
    maxDocumentPartKey = 'manifest'
  }
  const writeCount = partWrites.length + 1

  // 6-7: 上限判定(§9-4-5)。超えたら分けて書かずに拒否。
  if (maxDocumentBytes > FIRESTORE_DOCUMENT_MAX_BYTES) {
    return {
      outcome: 'too-large',
      detail: `文書 ${maxDocumentPartKey} の見積もり ${maxDocumentBytes} バイトが 1 文書の上限 ${FIRESTORE_DOCUMENT_MAX_BYTES} を超えた`,
      maxDocumentBytes, maxDocumentPartKey, writeCount, totalBytes,
    }
  }
  if (writeCount > SNAPSHOT_PARTS_TX_MAX_WRITES || totalBytes > SNAPSHOT_PARTS_TX_MAX_BYTES) {
    return {
      outcome: 'too-large',
      detail: `1 回の書き込み(トランザクション)が上限を超えた: 件数 ${writeCount}/${SNAPSHOT_PARTS_TX_MAX_WRITES}・合計 ${totalBytes}/${SNAPSHOT_PARTS_TX_MAX_BYTES} バイト`,
      maxDocumentBytes, maxDocumentPartKey, writeCount, totalBytes,
    }
  }

  return {
    outcome: 'commit',
    nextVersion,
    manifest,
    partWrites,
    writtenPartKeys,
    reusedPartKeys,
    writeCount,
    totalBytes,
    maxDocumentBytes,
    maxDocumentPartKey,
    manifestBytes,
    corePartBytes,
    boardPartBytes,
  }
}

// ---------------------------------------------------------------------------
// 読み戻し検証(§9-4-4 7・AC-15)
// ---------------------------------------------------------------------------

export type SnapshotPartsReadbackInput = {
  /** 読み直した目次文書の data()(無ければ null)。 */
  manifestDoc: unknown
  expected: { saveId: string; version: number; compositeHash: string }
  /** この保存で書いた部品(目次が指す docId と期待ハッシュ)。書いていない部品は不変なので読み直さない。 */
  writtenParts: ReadonlyArray<{ partKey: string; docId: string; hash: string }>
  /** writtenParts と同じ並びで読み直した部品文書の data()(無ければ null)。 */
  partDocs: ReadonlyArray<unknown | null>
}

export function verifySnapshotPartsReadback(input: SnapshotPartsReadbackInput): { ok: true; manifest: SnapshotPartsManifest; crossedByQrMerge: boolean } | { ok: false; detail: string } {
  const validation = validateSnapshotPartsManifest(input.manifestDoc)
  if (!validation.ok) return { ok: false, detail: `目次が読めない: ${validation.errors.join(' / ')}` }
  const manifest = validation.manifest
  if (manifest.saveId !== input.expected.saveId) return { ok: false, detail: `目次の saveId が違う(${String(manifest.saveId)} ≠ ${input.expected.saveId})` }
  if (manifest.version !== input.expected.version) return { ok: false, detail: `目次の version が違う(${String(manifest.version)} ≠ ${input.expected.version})` }
  // QR 提出のマージ(§9-6・K-9)は saveId・version を据え置いたまま core だけ差し替え、compositeHash を変える。保存の読み戻しの直前に
  // 割り込むと compositeHash が合わないが、保存は確定している(regression-reviewer 中-2)。この場合は core 以外の書いた部品が今も参照されて
  // いることで成功と扱う(core は QR が新しい版にしたので読み直さない)。
  const crossedByQrMerge = manifest.lastWriter === 'qr-submission' && manifest.compositeHash !== input.expected.compositeHash
  if (!crossedByQrMerge && manifest.compositeHash !== input.expected.compositeHash) return { ok: false, detail: '目次の compositeHash が違う' }
  if (sha256Hex(buildSnapshotCompositeHashInputFromManifest(manifest)) !== manifest.compositeHash) return { ok: false, detail: '目次の部品一覧から作った全体ハッシュが compositeHash と合わない' }
  const referenced = new Map(listSnapshotPartReferences(manifest).map((ref) => [ref.partKey, ref]))
  const failures: string[] = []
  input.writtenParts.forEach((written, index) => {
    if (crossedByQrMerge && written.partKey === SNAPSHOT_PART_KEY_CORE) return
    const ref = referenced.get(written.partKey)
    if (!ref || ref.docId !== written.docId || ref.hash !== written.hash) {
      failures.push(`${written.partKey}: 目次が別の文書を指している`)
      return
    }
    const partDoc = input.partDocs[index]
    if (!partDoc) {
      failures.push(`${written.partKey}: 部品文書が無い(${written.docId})`)
      return
    }
    try {
      const content = decodeSnapshotPartDoc(partDoc)
      const hash = hashSnapshotPartInput(buildSnapshotPartHashInput(content))
      if (hash !== written.hash) failures.push(`${written.partKey}: ハッシュ不一致`)
    } catch (error) {
      failures.push(`${written.partKey}: 解凍できない(${error instanceof Error ? error.message : String(error)})`)
    }
  })
  if (failures.length > 0) return { ok: false, detail: failures.join(' / ') }
  return { ok: true, manifest, crossedByQrMerge }
}

/**
 * 読み戻し失敗のあと目次を直前の内容へ戻してよいか(純関数・AC-15・regression-reviewer 中-2)。
 * 戻すのは「今の目次がこの保存が書いたものそのまま」(saveId と compositeHash が一致)のときだけ。QR マージが割り込んで compositeHash が
 * 変わっていれば戻さない(戻すと確定済みの保存と QR の反映を両方消す)。別の保存が進んでいれば saveId が違うので戻さない。
 */
export function shouldRollbackManifestAfterReadbackFailure(params: { latestDoc: unknown; saveId: string; compositeHash: string }): boolean {
  if (!isSnapshotPartsManifest(params.latestDoc)) return false
  return params.latestDoc.saveId === params.saveId && params.latestDoc.compositeHash === params.compositeHash
}

// ---------------------------------------------------------------------------
// 掃除の参照集合(§9-9・pruneSnapshotParts が使う)
// ---------------------------------------------------------------------------

/** 掃除が目次から読む項目(select)。validateSnapshotPartsManifest が要求する項目をすべて含む(テストで固定)。 */
export const SNAPSHOT_MANIFEST_SELECT_FIELDS = ['storageFormat', 'storageFormatVersion', 'hasBoardState', 'ui', 'parts', 'weeks', 'compositeHash', 'version', 'saveId', 'lastWriter'] as const

/**
 * 目次が参照している部品の文書 ID の集合。旧形式の文書(目次でない)は空集合(参照なし＝旧形式が正)、壊れた目次(検査に落ちる)は null(触らない)。
 */
export function resolveReferencedSnapshotPartDocIds(manifestDoc: unknown): ReadonlySet<string> | null {
  if (!isSnapshotPartsManifest(manifestDoc)) return new Set<string>()
  const validation = validateSnapshotPartsManifest(manifestDoc)
  if (!validation.ok) return null
  return new Set(listSnapshotPartReferences(validation.manifest).map((ref) => ref.docId))
}

// ---------------------------------------------------------------------------
// QR 提出のマージ(§9-6・K-9)
// ---------------------------------------------------------------------------

export type LectureSubmissionMergeInput = {
  sessionId: string
  personType: 'student' | 'teacher' | string
  personId: string
  token: string
  now: string
  unavailableSlots: unknown
  subjectSlots: unknown
  subjectDurations: unknown
  groupClassParticipation: unknown
  optionChecks: unknown
  regularOnly: boolean
}

/**
 * 教室データ(または core 部品)の specialSessions へ提出を反映した**新しいオブジェクト**を返す。対象の講習が無ければ null
 * (何も書かない)。反映の中身は従来の lectureSubmissionApi と同一(旧形式・分割形式で共通に使う)。
 */
export function mergeLectureSubmissionIntoPayload(payload: Record<string, unknown>, input: LectureSubmissionMergeInput): Record<string, unknown> | null {
  if (!Array.isArray(payload.specialSessions)) return null
  const sessions = [...(payload.specialSessions as Array<Record<string, unknown>>)]
  const sessionIndex = sessions.findIndex((session) => session && typeof session === 'object' && session.id === input.sessionId)
  if (sessionIndex < 0) return null

  const session = { ...sessions[sessionIndex] }
  const inputKey = input.personType === 'teacher' ? 'teacherInputs' : 'studentInputs'
  const inputs = { ...((session[inputKey] ?? {}) as Record<string, Record<string, unknown>>) }
  const existingInput = inputs[input.personId] ?? {}
  inputs[input.personId] = {
    ...existingInput,
    unavailableSlots: input.unavailableSlots,
    // 新規提出でスナップショット側の「出席可能に変更」(reopenedSlots)もリセット(doc 側と対称)。
    reopenedSlots: [],
    ...(input.personType === 'student'
      ? {
        subjectSlots: input.subjectSlots,
        subjectDurations: input.subjectDurations,
        groupClassParticipation: input.groupClassParticipation,
        optionChecks: input.optionChecks,
        regularOnly: input.regularOnly,
        regularBreakSlots: existingInput.regularBreakSlots ?? [],
      }
      : {}),
    countSubmitted: true,
    submissionToken: input.token,
    // 講習集計結果の提出日時/方法。QR からの提出なので method='qr'、時刻は提出時刻(now)。
    submittedAt: input.now,
    submissionMethod: 'qr',
    updatedAt: input.now,
  }
  session[inputKey] = inputs
  sessions[sessionIndex] = session
  return { ...payload, specialSessions: sessions }
}

/**
 * QR マージの書き手 ID(部品文書 ID の末尾 12 文字に入る)。`q` + ミリ秒の 36 進(8 文字・2059 年まで) + 乱数 3 文字 = 12 文字で、
 * 同じ秒の提出 2 件でも別の ID になる(regression-reviewer 中-1)。
 */
export function buildQrMergeWriterId(nowMs: number, random: string): string {
  const stamp = Math.max(0, Math.floor(nowMs)).toString(36).padStart(8, '0').slice(-8)
  return `q${stamp}${random.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).padEnd(3, '0')}`
}

/**
 * マージ後の core から新しい core 部品と目次を作る(純関数)。core の中身(ハッシュ)が変わらなければ null(何も書かない)。
 * ★版数・savedAt・saveId は据え置き(K-9)。lastWriter='qr-submission'・updatedAt=now・compositeHash/managementCount/dataByteLength は更新。
 */
export function buildQrMergedCorePart(params: {
  manifest: SnapshotPartsManifest
  classroomId: string
  mergedCore: Record<string, unknown>
  managementCount: number
  now: string
  writerId: string
}): { docId: string; doc: SnapshotPartDoc; manifest: SnapshotPartsManifest } | null {
  const core = sanitizeSnapshotValue(params.mergedCore) as Record<string, unknown>
  const hash = sha256Hex(buildSnapshotPartHashInput(core))
  if (hash === params.manifest.parts.core.hash) return null
  const json = JSON.stringify(core)
  const compressedData = compressSnapshotPartJson(json)
  const version = typeof params.manifest.version === 'number' ? params.manifest.version : 0
  const docId = buildSnapshotPartDocId({ kind: 'core', key: '-', version, writerId: params.writerId })
  const rawBytes = Buffer.byteLength(json, 'utf8')
  const doc: SnapshotPartDoc = {
    classroomId: params.classroomId,
    kind: 'core',
    key: '-',
    hash,
    encoding: SNAPSHOT_PART_ENCODING,
    compressedData,
    rawByteLength: rawBytes,
    createdAt: params.now,
    createdBy: params.writerId,
    createdForVersion: version,
  }
  const previousCore = params.manifest.parts.core
  const nextManifest: SnapshotPartsManifest = {
    ...params.manifest,
    updatedAt: params.now,
    parts: { ...params.manifest.parts, core: { docId, hash, rawBytes, storedBytes: compressedData.length } },
    managementCount: params.managementCount,
    dataByteLength: Math.max(0, (params.manifest.dataByteLength ?? 0) - (previousCore.rawBytes ?? 0) + rawBytes),
    lastWriter: 'qr-submission',
    compositeHash: '',
  }
  nextManifest.compositeHash = sha256Hex(buildSnapshotCompositeHashInputFromManifest(nextManifest))
  return { docId, doc, manifest: nextManifest }
}

// ---------------------------------------------------------------------------
// 容量の通知(§9-3-7・§9-10)
// ---------------------------------------------------------------------------

export type SnapshotPartsCapacityNotices = {
  /** 書いた文書のうち最大のものが 85% 以上(既存の capacity-warning を全文書に適用)。 */
  capacityWarning: boolean
  /** 第 2 段着手の合図(split-capacity-notice): core/board が 512KiB 以上、または書き込み件数/バイトが上限の 50% 以上。 */
  splitCapacityNotice: boolean
  detail: string
}

export function resolveSnapshotPartsCapacityNotices(plan: Extract<SnapshotPartsCommitPlan, { outcome: 'commit' }>): SnapshotPartsCapacityNotices {
  const capacityWarning = plan.maxDocumentBytes / FIRESTORE_DOCUMENT_MAX_BYTES >= SNAPSHOT_CAPACITY_WARNING_RATIO
  const reasons: string[] = []
  if (plan.corePartBytes >= SNAPSHOT_PART_SPLIT_NOTICE_BYTES) reasons.push(`core 部品 ${plan.corePartBytes} バイト(512KiB 以上)`)
  if (plan.boardPartBytes >= SNAPSHOT_PART_SPLIT_NOTICE_BYTES) reasons.push(`board 部品 ${plan.boardPartBytes} バイト(512KiB 以上)`)
  if (plan.writeCount >= SNAPSHOT_PARTS_TX_NOTICE_WRITES) reasons.push(`書き込み件数 ${plan.writeCount}(上限 ${SNAPSHOT_PARTS_TX_MAX_WRITES} の 50% 以上)`)
  if (plan.totalBytes >= SNAPSHOT_PARTS_TX_NOTICE_BYTES) reasons.push(`書き込み合計 ${plan.totalBytes} バイト(上限 ${SNAPSHOT_PARTS_TX_MAX_BYTES} の 50% 以上)`)
  return {
    capacityWarning,
    splitCapacityNotice: reasons.length > 0,
    detail: [
      `最大文書=${plan.maxDocumentPartKey} ${plan.maxDocumentBytes} バイト(上限 ${FIRESTORE_DOCUMENT_MAX_BYTES})`,
      `書き込み ${plan.writeCount} 件・合計 ${plan.totalBytes} バイト`,
      ...reasons,
    ].join('・'),
  }
}
