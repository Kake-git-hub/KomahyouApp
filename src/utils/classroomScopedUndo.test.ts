import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { canApplyUndoSnapshotToClassroom } from './classroomScopedUndo'

const APP_TSX = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

describe('INV-08: 「直前の状態に戻す」は取った教室にしか戻さない', () => {
  it('同じ教室なら戻せる', () => {
    expect(canApplyUndoSnapshotToClassroom({ undoClassroomId: 'classroom-a', actingClassroomId: 'classroom-a' })).toBe(true)
  })

  it('別の教室を開いていたら戻せない(A で取った Undo を B へ適用しない)', () => {
    expect(canApplyUndoSnapshotToClassroom({ undoClassroomId: 'classroom-a', actingClassroomId: 'classroom-b' })).toBe(false)
  })

  it('片方だけ教室IDが無い(出所不明)なら戻せない。両方無い(ローカル単一教室)なら戻せる', () => {
    expect(canApplyUndoSnapshotToClassroom({ undoClassroomId: null, actingClassroomId: 'classroom-a' })).toBe(false)
    expect(canApplyUndoSnapshotToClassroom({ undoClassroomId: 'classroom-a', actingClassroomId: '' })).toBe(false)
    expect(canApplyUndoSnapshotToClassroom({ undoClassroomId: null, actingClassroomId: undefined })).toBe(true)
  })
})

describe('INV-08: Undo スナップショットの配線(App.tsx)', () => {
  it('スナップショットに取得元の教室IDを持たせる', () => {
    const start = APP_TSX.indexOf('const saveUndoSnapshot = useCallback(')
    expect(start).toBeGreaterThan(0)
    expect(APP_TSX.slice(start, start + 600)).toContain('classroomId: actingClassroomIdRef.current')
  })

  it('戻す前に教室を照合し、不一致なら適用せず破棄する', () => {
    const start = APP_TSX.indexOf('const restoreUndoSnapshot = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = APP_TSX.slice(start, start + 1200)
    const guardIndex = body.indexOf('canApplyUndoSnapshotToClassroom({ undoClassroomId: undoSnapshot.classroomId, actingClassroomId: actingClassroomIdRef.current })')
    const applyIndex = body.indexOf('applyClassroomPayloadToState(undoSnapshot.data')
    expect(guardIndex).toBeGreaterThan(0)
    expect(applyIndex).toBeGreaterThan(guardIndex)
  })

  it('教室を開き直すとき(openClassroom)にも破棄する(8316830 / v1.5.300 の穴埋め)', () => {
    const start = APP_TSX.indexOf('const openClassroom = useCallback(')
    expect(start).toBeGreaterThan(0)
    const end = APP_TSX.indexOf('}, [', start)
    expect(APP_TSX.slice(start, end)).toContain('setUndoSnapshot(null)')
  })
})
