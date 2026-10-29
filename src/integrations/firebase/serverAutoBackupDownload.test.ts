// 時点の全体を取得する入口 downloadFirebaseServerAutoBackupJson(docs/spec-save-restore.md §10-5)を、callable を差し替えて直接動かす
// (regression-reviewer T-2)。形式の読み分け・purpose の受け渡し・教室ごとの取得の順番・応答の教室 ID 照合・途中失敗で全体を返さないことを固定する。
import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceBackupIndex,
  buildWorkspaceBackupIndexClassroom,
  buildWorkspaceBackupSnapshot,
  stableStringifyWorkspaceBackupValue,
  type WorkspaceBackupClassroomEntry,
} from '../../utils/workspaceBackupLayout'
import { downloadFirebaseServerAutoBackupJson, type ServerAutoBackupDownloadDeps } from './adminFunctions'
import type { AppSnapshotPayload } from '../../types/appState'

const KEY = '2026-10-29T15-00'
const SAVED_AT = '2026-10-29T06:00:04.000Z'
const USERS = [{ id: 'u1', name: '開発者', email: 'dev@example.com', role: 'developer', assignedClassroomId: null }]

function classroom(id: string, name: string): WorkspaceBackupClassroomEntry {
  return { id, name, contractStatus: 'active', contractStartDate: '', contractEndDate: '', managerUserId: `u-${id}`, isTemporarilySuspended: false, temporarySuspensionReason: '', data: { students: [{ id: `s-${id}` }] } }
}

function buildIndex(classrooms: WorkspaceBackupClassroomEntry[]) {
  return buildWorkspaceBackupIndex({
    workspaceKey: 'main',
    backupDateKey: KEY,
    savedAt: SAVED_AT,
    sourceSavedAt: 'src',
    users: USERS,
    classrooms: classrooms.map((entry) => buildWorkspaceBackupIndexClassroom({ classroom: entry, bytes: 1, sha256: 'x', sourceSavedAt: `src-${entry.id}` })),
    missingClassrooms: [{ id: 'c9', reason: 'assembly-failed' }],
  })
}

function buildDeps(classrooms: WorkspaceBackupClassroomEntry[], overrides: Partial<ServerAutoBackupDownloadDeps> & { calls: string[] }) {
  const byId = new Map(classrooms.map((entry) => [entry.id, entry]))
  const deps: ServerAutoBackupDownloadDeps = {
    downloadLegacy: async (backupDateKey, options) => {
      overrides.calls.push(`legacy:${backupDateKey}:${options?.purpose ?? ''}`)
      return '{"legacy":true}'
    },
    prepare: async (backupDateKey, purpose) => {
      overrides.calls.push(`prepare:${backupDateKey}:${purpose}`)
      return { layout: 'per-classroom-v1', index: buildIndex(classrooms) }
    },
    downloadClassroom: async (backupDateKey, classroomId) => {
      overrides.calls.push(`classroom:${backupDateKey}:${classroomId}`)
      const entry = byId.get(classroomId)
      if (!entry) throw new Error('バックアップ内に該当教室のデータが見つかりません。')
      return { classroomId: entry.id, classroomName: entry.name, savedAt: SAVED_AT, data: entry.data as unknown as AppSnapshotPayload }
    },
    ...overrides,
  }
  return deps
}

describe('downloadFirebaseServerAutoBackupJson(形式の読み分け・§10-5)', () => {
  it('旧形式(layout 無し / legacy)は従来の全体ダウンロードへ purpose を渡し、prepare も教室ごとの取得も呼ばない', async () => {
    const calls: string[] = []
    const deps = buildDeps([], { calls })
    expect(await downloadFirebaseServerAutoBackupJson({ backupDateKey: KEY }, { purpose: 'restore' }, deps)).toBe('{"legacy":true}')
    expect(await downloadFirebaseServerAutoBackupJson({ backupDateKey: KEY, layout: 'legacy' }, { purpose: 'local-sync' }, deps)).toBe('{"legacy":true}')
    expect(calls).toEqual([`legacy:${KEY}:restore`, `legacy:${KEY}:local-sync`])
  })

  it('知らない形式は通信せずに例外(再読み込みの案内)', async () => {
    const calls: string[] = []
    await expect(downloadFirebaseServerAutoBackupJson({ backupDateKey: KEY, layout: 'unknown' }, { purpose: 'restore' }, buildDeps([], { calls }))).rejects.toThrow('画面を再読み込みしてから')
    expect(calls).toEqual([])
  })

  it('教室別形式: prepare(purpose を渡す)→ 目次の並びで教室ごとに取得 → 共有純関数で組み立て(旧形式の JSON と同じ中身・AC-B1)。進み具合を知らせる', async () => {
    const calls: string[] = []
    const progress: Array<[number, number]> = []
    const classrooms = [classroom('c2', '教室2'), classroom('c1', '教室1')]
    const json = await downloadFirebaseServerAutoBackupJson({ backupDateKey: KEY, layout: 'per-classroom-v1' }, { purpose: 'local-sync', onProgress: (done, total) => progress.push([done, total]) }, buildDeps(classrooms, { calls }))
    expect(calls).toEqual([`prepare:${KEY}:local-sync`, `classroom:${KEY}:c2`, `classroom:${KEY}:c1`])
    expect(progress).toEqual([[1, 2], [2, 2]])
    const legacy = buildWorkspaceBackupSnapshot({ savedAt: SAVED_AT, users: USERS, classrooms, missingClassroomIds: ['c9'] })
    expect(stableStringifyWorkspaceBackupValue(JSON.parse(json))).toBe(stableStringifyWorkspaceBackupValue(legacy))
  })

  it('応答の教室 ID が目次と違えば組み立てない(INV-08)', async () => {
    const calls: string[] = []
    const classrooms = [classroom('c1', '教室1')]
    const deps = buildDeps(classrooms, {
      calls,
      downloadClassroom: async () => ({ classroomId: 'c2', classroomName: '別教室', savedAt: SAVED_AT, data: classrooms[0].data as unknown as AppSnapshotPayload }),
    })
    await expect(downloadFirebaseServerAutoBackupJson({ backupDateKey: KEY, layout: 'per-classroom-v1' }, { purpose: 'restore' }, deps)).rejects.toThrow('一致しない')
  })

  it('2 教室目の取得が失敗したら一部だけの全体を返さない(INV-14)', async () => {
    const calls: string[] = []
    const classrooms = [classroom('c1', '教室1'), classroom('c2', '教室2')]
    const deps = buildDeps([classrooms[0]], { calls, prepare: async () => ({ layout: 'per-classroom-v1', index: buildIndex(classrooms) }) })
    await expect(downloadFirebaseServerAutoBackupJson({ backupDateKey: KEY, layout: 'per-classroom-v1' }, { purpose: 'restore' }, deps)).rejects.toThrow('見つかりません')
    expect(calls).toEqual([`classroom:${KEY}:c1`, `classroom:${KEY}:c2`])
  })
})
