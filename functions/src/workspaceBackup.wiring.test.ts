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
      'validateWorkspaceBackupClassroomFile(JSON.parse(gunzipSync(content).toString(\'utf8\')), { workspaceKey, backupDateKey, classroomId })',
      'dataGzipBase64,',
    ].map((needle) => perClassroom.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(-1))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // ほかの教室のファイルは開かない(全体の組み立て直しをここでしない)。
    expect(perClassroom).not.toContain('assembleWorkspaceBackupFromClassroomFiles(')
    expect(perClassroom).not.toContain('for (const')
    // 目次は会社・時点の照合つきで検査する。
    const readIndex = slice('async function readWorkspaceBackupIndex(', 'async function downloadClassroomFromPerClassroomBackup(')
    expect(readIndex).toContain('validateWorkspaceBackupIndex(JSON.parse(content.toString(\'utf8\')), { workspaceKey, backupDateKey })')
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

  it('全体復元の準備(prepareServerAutoBackupRestore): 開発者だけ・文字種検査 → 要約の layout → 目次 → 復元なら控え(全教室ぶん)を書いてから目次を返す', () => {
    const prepare = slice('export const prepareServerAutoBackupRestore = onCall(', '// 検証用(サンドボックス)教室の判定は')
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

  it('会社ごとに try/catch で囲み、1 社の失敗をほかの社へ広げない(AC-B19)。失敗は関数ログと開発者メール(auto-backup-failed)・応答の failures', () => {
    const loop = run.slice(run.indexOf('for (const workspaceDoc of workspacesSnapshot.docs) {'))
    expect(loop).toContain('try {')
    expect(loop).toContain('} catch (error) {')
    expect(loop).toContain('failures.push({ workspaceKey, message })')
    expect(loop).toContain("kind: 'auto-backup-failed'")
    expect(loop).toContain('await notifySaveFailureByMail({')
    expect(loop).not.toContain('throw')
    expect(run).toContain('return { backupDateKey, backupKind, workspaceCount: results.length, results, failures, googleDriveBackups:')
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
    expect(perClassroom).toContain('classroomCount: written.writtenClassroomIds.length,')
    // 要約に教室の一覧や教室名を載せない(AC-B7)。
    expect(perClassroom).not.toContain('classrooms: written.index.classrooms')
    expect(perClassroom).not.toContain('classroomNames')
    const legacy = slice('async function runLegacyWorkspaceBackupForWorkspace(', '// ---------------------------------------------------------------------------\n// Lecture submission API')
    expect(legacy).toContain('await pruneWorkspaceGoogleDriveBackups(workspaceKey, now)')
    expect(legacy).not.toContain('isGoogleDriveDailyPruneRunAt(')
    expect(legacy).toContain("layout: 'legacy'")
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

  it('間引き: 教室別形式は時点フォルダを丸ごと(ファイル → 要約の順)、旧形式は 1 本(AC-B12)', () => {
    const prune = slice('async function pruneWorkspaceServerAutoBackups(', 'function validateEmailAddress(')
    const folder = prune.indexOf('resolveWorkspaceBackupTimePointPrefixForSummary(summary, workspaceKey, summaryDoc.id)')
    const deleteFiles = prune.indexOf('await bucket.deleteFiles({ prefix: timePointPrefix })')
    const legacyDelete = prune.indexOf('await bucket.file(summary.storagePath).delete()')
    const summaryDelete = prune.indexOf('batch.delete(summaryDoc.ref)')
    expect(folder).toBeGreaterThan(-1)
    expect(deleteFiles).toBeGreaterThan(folder)
    expect(legacyDelete).toBeGreaterThan(deleteFiles)
    expect(summaryDelete).toBeGreaterThan(legacyDelete)
    expect(prune).toContain('shouldKeepWorkspaceAutoBackup({ savedAtMs, nowMs })')
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

  it('復元前の控え: フォルダ `{reason}-{時刻}/` に教室ごとの gzip＋目次。旧来の 1 本のパスは作らない', () => {
    const incident = slice('async function writeWorkspaceIncidentBackup(', 'async function writeLatestClassroomRollback(')
    expect(incident).toContain('folderPrefix: `${WORKSPACE_INCIDENT_BACKUP_PREFIX}/${workspaceKey}/${folderName}/`')
    expect(incident).toContain('backupDateKey: folderName,')
    expect(indexTs).not.toContain('function buildWorkspaceIncidentBackupStoragePath(')
  })
})
