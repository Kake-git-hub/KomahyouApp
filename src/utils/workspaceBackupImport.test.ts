import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { WorkspaceClassroom, WorkspaceSnapshot } from '../types/appState'
import { readWorkspaceBackupMissingClassroomIds, resolveWorkspaceBackupImportTarget } from './workspaceBackupImport'

function classroom(id: string): WorkspaceClassroom {
  return { id, name: `教室${id}`, contractStatus: 'active', contractStartDate: '', contractEndDate: '', managerUserId: '', isTemporarilySuspended: false, temporarySuspensionReason: '', data: { students: [{ id: `s-${id}` }] } as unknown as WorkspaceClassroom['data'] }
}

function snapshot(ids: string[], extra: Record<string, unknown> = {}): WorkspaceSnapshot {
  return { schemaVersion: 1, savedAt: '2026-10-27T00:00:00.000Z', developerCloudBackupEnabled: false, developerCloudBackupFolderName: '', developerCloudSyncedAutoBackupKeys: [], currentUserId: '', actingClassroomId: null, users: [], classrooms: ids.map(classroom), ...extra } as WorkspaceSnapshot
}

describe('resolveWorkspaceBackupImportTarget(JSON 読込で採る教室・INV-08)', () => {
  it('開いている教室が JSON にあればその教室', () => {
    const result = resolveWorkspaceBackupImportTarget(snapshot(['A', 'B']), 'B')
    expect(result).toMatchObject({ ok: true, classroom: { id: 'B' } })
  })

  it('★開いている教室が JSON に無ければ止める(先頭の別教室へ落とさない)', () => {
    const result = resolveWorkspaceBackupImportTarget(snapshot(['A', 'B']), 'C')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('開いている教室のデータが入っていません')
  })

  it('バックアップ時に除かれた教室(missingClassroomIds)なら理由つきの文言', () => {
    const result = resolveWorkspaceBackupImportTarget(snapshot(['A'], { missingClassroomIds: ['C'] }), 'C')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('読み込めなかったため')
    expect(readWorkspaceBackupMissingClassroomIds(snapshot(['A'], { missingClassroomIds: ['C', 1, null] }))).toEqual(['C'])
    expect(readWorkspaceBackupMissingClassroomIds(snapshot(['A']))).toEqual([])
  })

  it('開いている教室が無い(ローカル単体)ときだけ先頭。教室が 1 つも無ければ止める', () => {
    expect(resolveWorkspaceBackupImportTarget(snapshot(['A', 'B']), null)).toMatchObject({ ok: true, classroom: { id: 'A' } })
    expect(resolveWorkspaceBackupImportTarget(snapshot([]), null)).toMatchObject({ ok: false, message: 'バックアップに教室データが含まれていません。' })
  })

  it('App.tsx の JSON 読込はこの純関数を使い、`?? workspaceSnapshot.classrooms[0]` の先頭落ちを残さない(ソース走査)', () => {
    const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')
    expect(app).toContain('resolveWorkspaceBackupImportTarget(workspaceSnapshot, actingClassroomId)')
    expect(app).not.toContain('?? workspaceSnapshot.classrooms[0]')
  })
})
