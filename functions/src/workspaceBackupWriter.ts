// 15 分ごとの自動バックアップを**教室ごとに順番に書く**ループ(docs/spec-save-restore.md §10-4・段階 2)。
// I/O(教室データの組み立て・Storage・Drive・通知)はすべて注入し、ループ本体をユニットテストから直接動かせる形にする
// (retentionCleanup.ts の runBudgetedDeletionSweep と同じ作法。2026-09-04 の障害は「純粋関数だけがテストされ、ループ本体が一行も
//  実行されていなかった」ことが構造要因だった)。index.ts は Firestore / Storage / Drive の差し込みだけを担う。
//
// ★書く順番(§10-4・INV-14 の「書き終わっていない時点を一覧に出さない」):
//   教室ごとに「組み立て → JSON → ハッシュ → gzip → Storage へ書く → ミラー(任意) → メモリを解放」を**順番に**行い、
//   すべての教室が終わってから目次(index.json)を書く。要約(Firestore・一覧に出る印)は呼び出し側が**目次の後に**書く。
//   途中で例外が出れば目次も要約も書かれない(残ったファイルは取り残しの掃除が消す・§10-6)。
// ★失敗の扱い(failurePolicy):
//   - 組み立て失敗(INV-14): 'exclude' = ファイルを書かず missingClassrooms(assembly-failed)に残し onAssemblyFailure で知らせる(15 分毎のバックアップ)。
//     'throw' = その場で投げる(復元前の控え = 欠けた一式を「安全な控え」にしない・M-1)。
//   - 書き込み失敗: 1 回やり直し、だめなら 'exclude' = missingClassrooms(write-failed)・'throw' = 投げる。
//   - ミラー(Drive)の失敗: 止めずに結果に集める(要約には failed として残す)。
// ★メモリ: 1 教室ぶんの JSON / Buffer だけを同時に持つ(教室数に比例させない・AC-B18)。全教室を並列にしない。
import {
  buildWorkspaceBackupClassroomFile,
  buildWorkspaceBackupClassroomFileName,
  buildWorkspaceBackupClassroomFilePath,
  buildWorkspaceBackupIndex,
  buildWorkspaceBackupIndexClassroom,
  buildWorkspaceBackupIndexFilePath,
  measureWorkspaceBackupJsonBytes,
  serializeWorkspaceBackupValue,
  type WorkspaceBackupClassroomEntry,
  type WorkspaceBackupIndex,
  type WorkspaceBackupIndexClassroom,
  type WorkspaceBackupMissingClassroom,
  type WorkspaceBackupUser,
} from './generated/workspaceBackupLayout'

export type PerClassroomBackupFailurePolicy = 'exclude' | 'throw'

/** 書き込みの試行回数(1 回やり直す・§10-4)。 */
export const PER_CLASSROOM_BACKUP_WRITE_ATTEMPTS = 2

export type PerClassroomBackupWriteIo<TClassroom extends { id: string }> = {
  /** 教室データを組み立てて教室の項目(id・name・契約…・data)にする。組み立てられなければ例外(INV-14)。 */
  assembleClassroom: (classroom: TClassroom) => Promise<{ entry: WorkspaceBackupClassroomEntry; sourceSavedAt: string }>
  /** 非圧縮 JSON の SHA-256(16 進)。 */
  hash: (json: string) => string
  /** gzip。 */
  compress: (json: string) => Buffer
  /** Storage へ書く(失敗は例外)。 */
  writeClassroomFile: (params: { classroomId: string; path: string; body: Buffer }) => Promise<void>
  /** Drive 等へのミラー(任意)。失敗は集めるだけで止めない。 */
  mirrorClassroomFile?: (params: { classroomId: string; fileName: string; body: Buffer; bytes: number; sourceSavedAt: string }) => Promise<void>
  /** 目次を書く(失敗は例外 → 呼び出し側へ)。 */
  writeIndex: (params: { path: string; json: string; index: WorkspaceBackupIndex }) => Promise<void>
  /** 目次のミラー(任意)。失敗は集めるだけで止めない。 */
  mirrorIndex?: (params: { json: string; index: WorkspaceBackupIndex }) => Promise<void>
  /** 組み立て失敗の通知(ログ・開発者メール)。 */
  onAssemblyFailure: (params: { classroomId: string; error: unknown }) => Promise<void>
  /** 書き込み失敗の記録(やり直しの前後どちらも呼ぶ)。 */
  onWriteFailure: (params: { classroomId: string; attempt: number; error: unknown }) => Promise<void>
}

export type PerClassroomBackupWriteParams<TClassroom extends { id: string }> = {
  workspaceKey: string
  backupDateKey: string
  savedAt: string
  /** 時点全体の元データの最終保存時刻(旧形式の sourceSavedAt と同じ値を呼び出し側が渡す)。 */
  sourceSavedAt: string
  /** 時点フォルダ(末尾 `/`)。15 分毎は buildWorkspaceBackupTimePointPrefix、復元前の控えは incident のフォルダ。 */
  folderPrefix: string
  users: readonly WorkspaceBackupUser[]
  /** 書く教室の並び(目次の並びになる)。 */
  classrooms: readonly TClassroom[]
  failurePolicy: { assembly: PerClassroomBackupFailurePolicy; write: PerClassroomBackupFailurePolicy }
  io: PerClassroomBackupWriteIo<TClassroom>
  writeAttempts?: number
}

export type PerClassroomBackupWriteResult = {
  index: WorkspaceBackupIndex
  indexPath: string
  indexJson: string
  writtenClassroomIds: string[]
  missingClassrooms: WorkspaceBackupMissingClassroom[]
  /** ミラー(Drive)の失敗。target は教室 ID か 'index'。 */
  mirrorFailures: Array<{ target: string; message: string }>
  /** 教室ファイルの非圧縮 JSON の合計バイト数。 */
  totalBytes: number
  /** 教室ファイルの gzip 後の合計バイト数。 */
  compressedBytes: number
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 教室ごとに順番に書き、最後に目次を書く。要約は書かない(呼び出し側が目次の後に書く)。
 * 例外が出た場合(assembly/write の 'throw'・目次の書き込み失敗)は目次が書かれないまま投げる。
 */
export async function writePerClassroomWorkspaceBackup<TClassroom extends { id: string }>(params: PerClassroomBackupWriteParams<TClassroom>): Promise<PerClassroomBackupWriteResult> {
  const { io } = params
  const writeAttempts = Math.max(1, Math.trunc(params.writeAttempts ?? PER_CLASSROOM_BACKUP_WRITE_ATTEMPTS))
  const indexClassrooms: WorkspaceBackupIndexClassroom[] = []
  const missingClassrooms: WorkspaceBackupMissingClassroom[] = []
  const writtenClassroomIds: string[] = []
  const mirrorFailures: Array<{ target: string; message: string }> = []
  let totalBytes = 0
  let compressedBytes = 0

  for (const classroom of params.classrooms) {
    const classroomId = classroom.id
    // (1) 組み立て(INV-14: 失敗は空で書かない)。
    let assembled: { entry: WorkspaceBackupClassroomEntry; sourceSavedAt: string }
    try {
      assembled = await io.assembleClassroom(classroom)
    } catch (error) {
      await io.onAssemblyFailure({ classroomId, error })
      if (params.failurePolicy.assembly === 'throw') throw error
      missingClassrooms.push({ id: classroomId, reason: 'assembly-failed' })
      continue
    }
    // (2) 教室ファイル(1 教室だけの WorkspaceSnapshot＋backupFile)→ JSON → ハッシュ → gzip。
    //     教室 ID に Storage のパスへ使えない文字があるときは「組み立てられない教室」と同じ扱い(その教室だけ除く・会社全体の時点は作る)。
    let json: string
    let path: string
    try {
      const file = buildWorkspaceBackupClassroomFile({
        workspaceKey: params.workspaceKey,
        backupDateKey: params.backupDateKey,
        savedAt: params.savedAt,
        sourceSavedAt: assembled.sourceSavedAt,
        classroom: assembled.entry,
      })
      json = serializeWorkspaceBackupValue(file)
      path = buildWorkspaceBackupClassroomFilePath(params.folderPrefix, classroomId)
    } catch (error) {
      await io.onAssemblyFailure({ classroomId, error })
      if (params.failurePolicy.assembly === 'throw') throw error
      missingClassrooms.push({ id: classroomId, reason: 'assembly-failed' })
      continue
    }
    const bytes = measureWorkspaceBackupJsonBytes(json)
    const sha256 = io.hash(json)
    const body = io.compress(json)
    // (3) Storage へ書く(1 回やり直し)。
    let written = false
    let lastError: unknown = null
    for (let attempt = 1; attempt <= writeAttempts && !written; attempt += 1) {
      try {
        await io.writeClassroomFile({ classroomId, path, body })
        written = true
      } catch (error) {
        lastError = error
        await io.onWriteFailure({ classroomId, attempt, error })
      }
    }
    if (!written) {
      if (params.failurePolicy.write === 'throw') throw lastError
      missingClassrooms.push({ id: classroomId, reason: 'write-failed' })
      continue
    }
    writtenClassroomIds.push(classroomId)
    totalBytes += bytes
    compressedBytes += body.length
    indexClassrooms.push(buildWorkspaceBackupIndexClassroom({ classroom: assembled.entry, bytes, sha256, sourceSavedAt: assembled.sourceSavedAt }))
    // (4) ミラー(任意・失敗しても止めない)。
    if (io.mirrorClassroomFile) {
      try {
        await io.mirrorClassroomFile({ classroomId, fileName: buildWorkspaceBackupClassroomFileName(classroomId), body, bytes, sourceSavedAt: assembled.sourceSavedAt })
      } catch (error) {
        mirrorFailures.push({ target: classroomId, message: describeError(error) })
      }
    }
    // (5) この教室の JSON / Buffer はここでスコープを抜けて解放される(次の教室へ持ち越さない)。
  }

  // (6) すべての教室が終わってから目次(ここで初めてこの時点が「読める」形になる)。
  const index = buildWorkspaceBackupIndex({
    workspaceKey: params.workspaceKey,
    backupDateKey: params.backupDateKey,
    savedAt: params.savedAt,
    sourceSavedAt: params.sourceSavedAt,
    users: params.users,
    classrooms: indexClassrooms,
    missingClassrooms,
  })
  const indexJson = serializeWorkspaceBackupValue(index)
  const indexPath = buildWorkspaceBackupIndexFilePath(params.folderPrefix)
  await io.writeIndex({ path: indexPath, json: indexJson, index })
  if (io.mirrorIndex) {
    try {
      await io.mirrorIndex({ json: indexJson, index })
    } catch (error) {
      mirrorFailures.push({ target: 'index', message: describeError(error) })
    }
  }

  return { index, indexPath, indexJson, writtenClassroomIds, missingClassrooms, mirrorFailures, totalBytes, compressedBytes }
}
