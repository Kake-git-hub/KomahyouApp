// 自動バックアップの教室別化(docs/spec-save-restore.md §10-5)のクライアント側の配線ガード(source-scan・2026-10-29)。
//
// 守るもの:
//   - 開発者の全体復元(restoreServerAutoBackup)とローカル同期(syncDeveloperCloudAutoBackups)は、形式を要約の layout で読み分ける
//     1 つの入口 downloadFirebaseServerAutoBackupJson を通る(旧形式=全体 1 本・教室別形式=目次→教室ごと→共有純関数で組み立て)。
//   - ローカル同期は purpose 'local-sync'(サーバーが復元前の控えを書かない・Q8・AC-B17)、復元は 'restore'。
//   - 教室選択モーダル(openDeveloperRestoreModal)と JSON 読込は変えない(AC-B15・BK-3)。
//   - 教室ごとの取得は既存の downloadClassroomFromFirebaseServerAutoBackup(室長の自教室復元・Feature B と同じ callable)で、
//     応答の教室 ID が目次と違えば組み立てない(INV-08)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const ADMIN_FUNCTIONS_TS = readFileSync(fileURLToPath(new URL('./adminFunctions.ts', import.meta.url)), 'utf8')

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  expect(start, startNeedle).toBeGreaterThan(0)
  const end = source.indexOf(endNeedle, start)
  expect(end, endNeedle).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('開発者の全体復元とローカル同期の配線(App.tsx)', () => {
  it('全体復元: 要約を渡して layout で読み分ける入口を通し、復元(purpose restore)として取得 → parseWorkspaceSnapshot → 教室選択モーダル(変えない)', () => {
    const body = sliceBetween(APP_TSX, 'const restoreServerAutoBackup = useCallback(', '\n  }, [')
    const order = [
      "downloadFirebaseServerAutoBackupJson(summary ?? { backupDateKey }, {",
      "purpose: 'restore'",
      'parseWorkspaceSnapshot(snapshotJson)',
      'openDeveloperRestoreModal(',
    ].map((needle) => body.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(0))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // 旧 API を直接呼ばない(教室別形式の時点で failed-precondition になる)。
    expect(body).not.toContain('downloadFirebaseServerAutoBackup(')
  })

  it('ローカル同期: 同じ入口を purpose local-sync で通す(復元前の控えを書かない・1 時点 1 ファイルの形は変えない)', () => {
    const body = sliceBetween(APP_TSX, 'const syncDeveloperCloudAutoBackups = useCallback(', '\n  }, [')
    expect(body).toContain("downloadFirebaseServerAutoBackupJson(summary, { purpose: 'local-sync' })")
    expect(body).toContain("formatPreciseBackupFileName(summary.savedAt, '開発者バックアップ_自動保存')")
    expect(body).not.toContain('downloadFirebaseServerAutoBackup(')
  })

  it('App.tsx は旧 API downloadFirebaseServerAutoBackup を import しない(全部の入口が layout で読み分ける)', () => {
    expect(APP_TSX).not.toMatch(/\bdownloadFirebaseServerAutoBackup\b[^J]/u)
    expect(APP_TSX).toContain('downloadFirebaseServerAutoBackupJson')
  })
})

describe('layout で読み分ける入口(adminFunctions.ts downloadFirebaseServerAutoBackupJson)', () => {
  const body = sliceBetween(ADMIN_FUNCTIONS_TS, 'export async function downloadFirebaseServerAutoBackupJson(', '\n}\n')

  it('旧形式(layout 無し / legacy)は従来の全体ダウンロードへ purpose を渡す。知らない形式は進まない(再読み込みの案内)', () => {
    expect(body).toContain("const layout = summary.layout ?? 'legacy'")
    expect(body).toContain("if (layout === 'legacy') return downloadFirebaseServerAutoBackup(summary.backupDateKey, { purpose: options.purpose })")
    expect(body).toContain('if (layout !== WORKSPACE_BACKUP_LAYOUT_PER_CLASSROOM) {')
    expect(body).toContain('画面を再読み込みしてから')
  })

  it('教室別形式は 目次(prepare・purpose を渡す)→ 教室ごとに既存 callable で取得 → 応答の教室 ID 照合 → 共有純関数で組み立て → JSON 文字列', () => {
    const order = [
      'prepareFirebaseServerAutoBackupRestore(summary.backupDateKey, options.purpose)',
      'for (const [position, classroom] of prepared.index.classrooms.entries())',
      'downloadClassroomFromFirebaseServerAutoBackup(summary.backupDateKey, classroom.id)',
      'if (source.classroomId !== classroom.id) {',
      'serializeWorkspaceBackupValue(assembleWorkspaceBackupFromIndex(prepared.index, classroomData))',
    ].map((needle) => body.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(0))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // 全教室を並列に取らない(ブラウザのメモリと callable の同時実行を抑える)。
    expect(body).not.toContain('Promise.all(')
  })

  it('目次は共有純関数で検査してから使う(会社・時点の照合つき・INV-08)。旧形式の API は purpose を送る', () => {
    const prepare = sliceBetween(ADMIN_FUNCTIONS_TS, 'export async function prepareFirebaseServerAutoBackupRestore(', '\n}\n')
    expect(prepare).toContain('validateWorkspaceBackupIndex(result.data.index, { workspaceKey: config.workspaceKey, backupDateKey })')
    expect(prepare).toContain("'prepareServerAutoBackupRestore'")
    const legacy = sliceBetween(ADMIN_FUNCTIONS_TS, 'export async function downloadFirebaseServerAutoBackup(', '\n}\n')
    expect(legacy).toContain("purpose: options.purpose ?? 'restore'")
  })

  it('一覧(listFirebaseServerAutoBackupSummaries)は要約の layout を共有純関数で判定して持つ', () => {
    const list = sliceBetween(ADMIN_FUNCTIONS_TS, 'export async function listFirebaseServerAutoBackupSummaries(', '\n}\n')
    expect(list).toContain('layout: resolveWorkspaceBackupSummaryLayout(data)')
  })
})
