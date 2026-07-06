import { describe, expect, it } from 'vitest'
import { isPendingClassroomWriteBackStale, selectSafePendingWriteBackClassroomIds } from './pendingSnapshotVersionGuard'

describe('isPendingClassroomWriteBackStale (A3: 多端末 stale 書き戻し防止・2026-07-06)', () => {
  it('サーバー版数がローカル基準版数より進んでいれば stale(別端末が後から保存)', () => {
    expect(isPendingClassroomWriteBackStale({
      classroomId: 'c1',
      baseClassroomVersions: { c1: 3 },
      remoteClassroomVersions: { c1: 5 },
    })).toBe(true)
  })

  it('サーバー版数とローカル基準版数が一致していれば stale ではない(誰も後から保存していない)', () => {
    expect(isPendingClassroomWriteBackStale({
      classroomId: 'c1',
      baseClassroomVersions: { c1: 5 },
      remoteClassroomVersions: { c1: 5 },
    })).toBe(false)
  })

  it('ローカル基準版数の方が新しい(自端末が先行保存済み)なら stale ではない', () => {
    expect(isPendingClassroomWriteBackStale({
      classroomId: 'c1',
      baseClassroomVersions: { c1: 6 },
      remoteClassroomVersions: { c1: 5 },
    })).toBe(false)
  })

  it('版数情報が欠けている(旧マーカー/未versioning)ときは stale と判定しない(従来の savedAt ゲートに委ねる)', () => {
    expect(isPendingClassroomWriteBackStale({
      classroomId: 'c1',
      baseClassroomVersions: undefined,
      remoteClassroomVersions: { c1: 5 },
    })).toBe(false)
    expect(isPendingClassroomWriteBackStale({
      classroomId: 'c1',
      baseClassroomVersions: { c1: 3 },
      remoteClassroomVersions: undefined,
    })).toBe(false)
    expect(isPendingClassroomWriteBackStale({
      classroomId: 'c1',
      baseClassroomVersions: { c2: 3 },
      remoteClassroomVersions: { c1: 5 },
    })).toBe(false)
  })
})

describe('selectSafePendingWriteBackClassroomIds', () => {
  it('stale な教室を除いた安全な教室IDだけ返す', () => {
    const safe = selectSafePendingWriteBackClassroomIds({
      targetClassroomIds: ['c1', 'c2', 'c3'],
      baseClassroomVersions: { c1: 3, c2: 5, c3: 1 },
      remoteClassroomVersions: { c1: 5, c2: 5, c3: 4 },
    })
    // c1(3→5) と c3(1→4) は別端末が後から保存済み=stale。c2 は一致=安全。
    expect(safe).toEqual(['c2'])
  })
})
