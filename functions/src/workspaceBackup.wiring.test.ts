// 自動バックアップの教室別化(docs/spec-save-restore.md §10)のサーバー側の配線ガード(ソース走査・2026-10-29)。
// index.ts は firebase-admin を初期化するため関数単位では読み込めない(saveHistory.wiring.test.ts と同じ作法)。
// 純粋な判定(パス・3 点照合・組み立て直し・ループ・設定)はそれぞれのテストで固定し、ここは「その関数をどの順で・どの条件で呼ぶか」を固定する。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

function slice(startMarker: string, endMarker: string) {
  const start = indexTs.indexOf(startMarker)
  const end = indexTs.indexOf(endMarker, start)
  expect(start, startMarker).toBeGreaterThan(-1)
  expect(end, endMarker).toBeGreaterThan(start)
  return indexTs.slice(start, end)
}

describe('読む側(§10-5・INV-08)', () => {
  const classroomCallable = slice('export const downloadClassroomFromServerAutoBackup = onCall(', 'export const mirrorLatestClassroomRollback = onDocumentWritten(')

  it('教室単位の取得: 教室 ID・時点キー・会社キーの文字種検査を、会員の確認より前・パスの組み立てより前に通す(AC-B5)', () => {
    const check = classroomCallable.indexOf('assertSafeBackupPathArguments({ workspaceKey, backupDateKey, classroomId })')
    const member = classroomCallable.indexOf('memberRef.get()')
    expect(check).toBeGreaterThan(-1)
    expect(member).toBeGreaterThan(check)
    // 検査は共有純関数(違反は invalid-argument)。
    const guard = slice('function assertSafeBackupPathArguments(', 'async function readWorkspaceBackupIndex(')
    expect(guard).toContain('assertSafeWorkspaceBackupClassroomId(params.classroomId)')
    expect(guard).toContain("throw new HttpsError('invalid-argument'")
  })

  it('教室単位の取得: 要約の layout で読み分け、教室別形式はその教室のファイルだけを読んで 3 点照合する(AC-B4・AC-B6)。旧形式の枝は変えない', () => {
    expect(classroomCallable).toContain('const layout = resolveWorkspaceBackupSummaryLayout(summary)')
    expect(classroomCallable).toContain('return downloadClassroomFromPerClassroomBackup({ workspaceKey, backupDateKey, classroomId })')
    // 旧形式の枝(全体 1 本を読んで find)はそのまま。
    expect(classroomCallable).toContain('const snapshot = JSON.parse(content.toString(\'utf-8\')) as WorkspaceSnapshot')
    expect(classroomCallable).toContain('snapshot.classrooms?.find((c) => c.id === classroomId)')
    const perClassroom = slice('async function downloadClassroomFromPerClassroomBackup(', 'export const downloadServerAutoBackup = onCall(')
    // 目次 → その教室が目次に無ければ not-found → 教室ファイル 1 本 → 3 点照合 → 応答(旧形式と同じ形)。
    const order = [
      'const index = await readWorkspaceBackupIndex(workspaceKey, backupDateKey)',
      "throw new HttpsError('not-found', 'バックアップ内に該当教室のデータが見つかりません。')",
      'buildWorkspaceBackupClassroomStoragePath(workspaceKey, backupDateKey, classroomId)',
      'validateWorkspaceBackupClassroomFile(JSON.parse(json), { workspaceKey, backupDateKey, classroomId })',
      'dataGzipBase64,',
    ].map((needle) => perClassroom.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(-1))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // ほかの教室のファイルは開かない(全体の組み立て直しをここでしない)。
    expect(perClassroom).not.toContain('assembleWorkspaceBackupFromClassroomFiles(')
    expect(perClassroom).not.toContain('for (const')
    // 目次の sha256 と照合してから 3 点照合(低-3)。
    expect(perClassroom).toContain('if (sha256 !== indexEntry.sha256) throw new Error(')
    expect(perClassroom.indexOf('if (sha256 !== indexEntry.sha256)')).toBeLessThan(perClassroom.indexOf('validateWorkspaceBackupClassroomFile('))
    // 目次は会社・時点の照合つきで検査する。
    const readIndex = slice('async function readWorkspaceBackupIndex(', 'async function downloadClassroomFromPerClassroomBackup(')
    expect(readIndex).toContain('validateWorkspaceBackupIndex(JSON.parse(content.toString(\'utf8\')), { workspaceKey, backupDateKey })')
    // 室長の画面にも出る not-found の文言に Storage のパスを出さない(低-5)。
    expect(readIndex).toContain("throw new HttpsError('not-found', '指定したサーバーバックアップが見つかりません。')")
    expect(readIndex).not.toContain('見つかりません。(${indexPath})')
  })

  it('旧形式の全体ダウンロード: 教室別形式・知らない形式の時点では進まず再読み込みを促す(AC-B11)。復元前の控えは purpose restore のときだけ(AC-B17)', () => {
    const download = slice('export const downloadServerAutoBackup = onCall(', 'export const prepareServerAutoBackupRestore = onCall(')
    const layoutCheck = download.indexOf('assertLegacyBackupLayout(summary)')
    const fileDownload = download.indexOf('const [content] = await file.download()')
    expect(layoutCheck).toBeGreaterThan(-1)
    expect(fileDownload).toBeGreaterThan(layoutCheck)
    expect(download).toContain("if (purpose === 'restore') {")
    expect(download.indexOf("if (purpose === 'restore') {")).toBeLessThan(download.indexOf('await writeWorkspaceIncidentBackup('))
    const assertLegacy = slice('function assertLegacyBackupLayout(', 'function assertSafeBackupPathArguments(')
    expect(assertLegacy).toContain("reason: 'per-classroom-layout'")
    expect(assertLegacy).toContain('画面を再読み込みしてから')
    expect(assertLegacy).toContain('throwUnknownBackupLayout()')
  })

  it('全体復元の準備(prepareServerAutoBackupRestore): 開発者だけ・文字種検査 → 要約の layout → 目次 → 復元なら控え(全教室ぶん)を書いてから目次を返す。旧形式・知らない形式では進まない', () => {
    const prepare = slice('export const prepareServerAutoBackupRestore = onCall(', '// 検証用(サンドボックス)教室の判定は')
    expect(prepare).toContain('if (layout !== WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) throwUnknownBackupLayout()')
    // purpose の既定は restore(古い画面が purpose を送らなくても控えを書く・BK-7・判定は readBackupDownloadPurpose のテスト)。
    expect(prepare).toContain('const purpose = readBackupDownloadPurpose(rawData.purpose)')
    const order = [
      'assertSafeBackupPathArguments({ workspaceKey, backupDateKey })',
      'await requireDeveloperMember(request.auth?.uid, workspaceKey)',
      'const layout = resolveWorkspaceBackupSummaryLayout(summarySnapshot.data())',
      'const index = await readWorkspaceBackupIndex(workspaceKey, backupDateKey)',
      "if (purpose === 'restore') {",
      'await writeWorkspaceIncidentBackup(workspaceKey, `pre-restore-workspace-${backupDateKey}`)',
      'return { layout, index }',
    ].map((needle) => prepare.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(-1))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    expect(prepare).toContain("reason: 'legacy-layout'")
    // 全体を 1 本で返さない(教室ごとの取得は downloadClassroomFromServerAutoBackup)。
    expect(prepare).not.toContain('gzipSync(')
  })
})

describe('書く側(§10-4・§10-7)', () => {
  const run = slice('async function runWorkspaceServerAutoBackup(backupKind: WorkspaceAutoBackupKind) {', 'async function runPerClassroomWorkspaceBackupForWorkspace(')

  it('書く形式は runtime env(WORKSPACE_AUTO_BACKUP_LAYOUT・_OVERRIDES)を会社ごとに解決する。会社キーに使えない文字があれば旧形式へ(安全側)', () => {
    expect(run).toContain('const layoutConfig = parseWorkspaceAutoBackupLayoutConfig(process.env)')
    expect(run).toContain('let layout = resolveWorkspaceAutoBackupLayout(workspaceKey, layoutConfig)')
    expect(run).toContain('if (layout === WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM && !isSafeWorkspaceBackupPathSegment(workspaceKey)) {')
    expect(run).toContain("layout = 'legacy'")
    expect(run).toContain('? await runPerClassroomWorkspaceBackupForWorkspace(params)')
    expect(run).toContain(': await runLegacyWorkspaceBackupForWorkspace(params))')
  })

  it('会社ごとに try/catch で囲み、1 社の失敗をほかの社へ広げない(AC-B19)。失敗は関数ログと開発者メール(auto-backup-failed)・応答の failures。手動実行はその failures を従来どおり例外にする(AC-B20・中-1)', () => {
    const loop = run.slice(run.indexOf('for (const workspaceDoc of workspacesSnapshot.docs) {'), run.indexOf('logger.info(`[AutoBackup] Completed'))
    expect(loop).toContain('try {')
    expect(loop).toContain('} catch (error) {')
    expect(loop).toContain('failures.push({ workspaceKey, message })')
    expect(loop).toContain("kind: 'auto-backup-failed'")
    expect(loop).toContain('await notifySaveFailureByMail({')
    expect(loop).not.toContain('throw')
    expect(run).toContain('return { backupDateKey, backupKind, workspaceCount: results.length, results, failures, googleDriveBackups:')
    const trigger = slice('export const triggerWorkspaceServerAutoBackup = onCall(', 'type WorkspaceAutoBackupRunResult = {')
    expect(trigger).toContain('if (result.failures.length > 0) {')
    expect(trigger).toContain("throw new HttpsError('internal', `サーバーバックアップの実行に失敗しました:")
  })

  it('教室別形式: 要約は目次の後(一覧に出るのは最後)・間引きは要約の後・Drive の掃除は 1 日 1 回(JST 3:00 の回)だけ。旧形式の Drive の掃除は毎回のまま', () => {
    const perClassroom = slice('async function runPerClassroomWorkspaceBackupForWorkspace(', 'async function runLegacyWorkspaceBackupForWorkspace(')
    const order = [
      'const sources = await loadWorkspaceBackupSources(workspaceKey, savedAt)',
      'const written = await writePerClassroomWorkspaceBackup({',
      'summaryRef.set({',
      'await pruneWorkspaceServerAutoBackups(workspaceKey, now)',
      'if (isGoogleDriveDailyPruneRunAt(now)) {',
      'await pruneWorkspaceGoogleDriveBackups(workspaceKey, now)',
    ].map((needle) => perClassroom.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(-1))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    expect(perClassroom).toContain('folderPrefix: buildWorkspaceBackupTimePointPrefix(workspaceKey, backupDateKey),')
    // 要約の項目は許可リストどおり(教室の一覧や教室名を載せない・AC-B7)。
    const summaryBlock = perClassroom.slice(perClassroom.indexOf('summaryRef.set({'), perClassroom.indexOf('} satisfies WorkspaceAutoBackupSummaryDoc'))
    const summaryKeys = [...summaryBlock.matchAll(/^\s{6}([A-Za-z]+)[,:]/gmu)].map((match) => match[1])
    expect(summaryKeys).toEqual(['backupDateKey', 'backupKind', 'displayLabel', 'savedAt', 'sourceSavedAt', 'storagePath', 'createdAt', 'missingClassroomIds', 'layout', 'classroomCount'])
    expect(summaryBlock).toContain('layout: WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM,')
    expect(summaryBlock).toContain('classroomCount: written.writtenClassroomIds.length,')
    const legacy = slice('async function runLegacyWorkspaceBackupForWorkspace(', "return { workspaceKey, backupDateKey, storagePath, backupKind, layout: 'legacy', googleDriveBackup }")
    expect(legacy).toContain('await pruneWorkspaceGoogleDriveBackups(workspaceKey, now)')
    expect(legacy).not.toContain('isGoogleDriveDailyPruneRunAt(')
    // 旧形式の要約も形式を明示する(同じ時点キーに教室別の要約が残っていても読み手を旧形式へ向ける・中-2)。
    expect(legacy).toContain("layout: 'legacy',")
    expect(legacy).toContain('classroomCount: snapshot.classrooms.length,')
  })

  it('Drive の教室ファイル・目次は appProperties に workspaceKey・layout・教室 ID を持つ .json.gz(間引きは Storage と同じ規則・AC-B14)', () => {
    const io = slice('function buildPerClassroomBackupIo(', 'async function buildWorkspaceServerBackupSnapshot(')
    expect(io).toContain('layout: WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM')
    expect(io).toContain('buildGoogleDriveClassroomBackupFileName(workspaceKey, mirror.backupKind, mirror.backupDateKey, classroomId)')
    expect(io).toContain('buildGoogleDriveIndexBackupFileName(workspaceKey, mirror.backupKind, mirror.backupDateKey)')
    expect(io).toContain('appProperties: { ...driveProperties, classroomId, sourceSavedAt }')
    expect(io).toContain('body: compressBackupJson(json)')
    // 旧形式の Drive 名の組み立て(buildGoogleDriveBackupFileName)は据え置き。
    expect(indexTs).toContain("return `komahyouapp_${safeWorkspaceKey}_${backupKind}_${backupDateKey}${GOOGLE_DRIVE_BACKUP_COMPRESSED_SUFFIX}`")
  })

  it('間引き: 要約の layout に関係なく、旧形式の 1 本(storagePath と旧形式の既定パス)と時点フォルダの両方を消してから要約を消す(混在しても取り残さない・AC-B12・中-2)', () => {
    const prune = slice('async function pruneWorkspaceServerAutoBackups(', 'function validateEmailAddress(')
    const legacyDelete = prune.indexOf('await bucket.file(legacyPath).delete()')
    const deleteFiles = prune.indexOf('await bucket.deleteFiles({ prefix: timePointPrefix })')
    const summaryDelete = prune.indexOf('batch.delete(summaryDoc.ref)')
    expect(legacyDelete).toBeGreaterThan(-1)
    expect(deleteFiles).toBeGreaterThan(legacyDelete)
    expect(summaryDelete).toBeGreaterThan(deleteFiles)
    expect(prune).toContain("legacyPaths.add(buildWorkspaceAutoBackupStoragePath(workspaceKey, summaryDoc.id, 'quarterHourly'))")
    expect(prune).toContain('const timePointPrefix = buildWorkspaceBackupTimePointPrefix(workspaceKey, summaryDoc.id)')
    // 教室別の要約の storagePath(index.json)を「旧形式の 1 本」として消さない(フォルダごと消すので同じ結果だが、意図の印)。
    expect(prune).toContain('!summary.storagePath.endsWith(`/${WORKSPACE_BACKUP_INDEX_FILE_NAME}`)')
    expect(prune).toContain('shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs })')
    // Drive の間引きは同時実行を抑える(中-3)。
    const drive = slice('async function pruneWorkspaceGoogleDriveBackups(', 'function buildClassroomLatestRollbackStoragePath(')
    expect(drive).toContain('for (const chunk of chunkItems(staleFiles, GOOGLE_DRIVE_DELETE_CONCURRENCY)) {')
    expect(indexTs).toContain('const GOOGLE_DRIVE_DELETE_CONCURRENCY = 10')
  })

  it('取り残しの掃除: 要約の無い時点フォルダだけ・判定は純関数・既定は空実行(件数だけ)・独立した予算で Firestore 巡回より先(AC-B10)', () => {
    expect(indexTs).toContain("const WORKSPACE_BACKUP_ORPHAN_PRUNE_DRY_RUN = (process.env.WORKSPACE_BACKUP_ORPHAN_PRUNE_DRY_RUN ?? '1').trim() !== '0'")
    const orphan = slice('async function pruneOrphanedWorkspaceBackupFolders(', 'async function runSaveAttemptCleanup() {')
    expect(orphan).toContain("delimiter: '/',")
    expect(orphan).toContain('if (summaryIds.has(backupDateKey)) continue')
    expect(orphan).toContain('isOrphanedWorkspaceBackupFolder({ hasSummary: false, newestFileCreatedAtMs, nowMs })')
    expect(orphan).toContain('WORKSPACE_BACKUP_ORPHAN_PRUNE_TIME_BUDGET_MS')
    expect(orphan).toContain('if (WORKSPACE_BACKUP_ORPHAN_PRUNE_DRY_RUN) {')
    const cleanup = slice('async function runSaveAttemptCleanup() {', 'const summary = `[SaveAttemptCleanup]')
    const orphanCall = cleanup.indexOf('orphanPrune = await pruneOrphanedWorkspaceBackupFolders(Date.now())')
    const firestoreSweep = cleanup.indexOf("const workspacesSnapshot = await firestore.collection('workspaces').get()")
    expect(orphanCall).toBeGreaterThan(-1)
    expect(firestoreSweep).toBeGreaterThan(orphanCall)
    expect(cleanup).toContain('|| orphanPrune.stoppedByBudget')
  })

  it('復元前の控え: フォルダ `{reason}-{時刻}/` に教室ごとの gzip＋目次。旧来の 1 本のパスは作らない。組み立て失敗と教室 ID の文字種違反は投げる(BK-7・M-1)', () => {
    const incident = slice('async function writeWorkspaceIncidentBackup(', 'async function writeLatestClassroomRollback(')
    expect(incident).toContain('folderPrefix: `${WORKSPACE_INCIDENT_BACKUP_PREFIX}/${workspaceKey}/${folderName}/`')
    expect(incident).toContain('backupDateKey: folderName,')
    expect(incident).toContain('if (isSnapshotPartsAssemblyError(error) || isWorkspaceBackupLayoutError(error)) throw error')
    expect(indexTs).not.toContain('function buildWorkspaceIncidentBackupStoragePath(')
  })
})
