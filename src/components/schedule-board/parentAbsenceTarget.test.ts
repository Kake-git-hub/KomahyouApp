import { describe, expect, it } from 'vitest'
import type { StudentRow } from '../basic-data/basicDataModel'
import {
  consumeParentAbsenceRequest,
  isBoardStudentOwnedBy,
  resolveParentAbsenceTarget,
  shouldProcessParentAbsenceRequest,
  type ParentAbsenceRequest,
} from './parentAbsenceTarget'
import type { DeskCell, SlotCell, StudentEntry } from './types'

// 保護者からの休み連絡(docs/spec-parent-portal.md §0-5)を盤面のどの席へ当てるか。
function createStudentRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return { id: 's001', name: '青木 太郎', displayName: '青木', email: '', entryDate: '2026-04-01', withdrawDate: '未定', birthDate: '2012-05-01', ...overrides }
}

function createBoardStudent(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return { id: 'entry-1', name: '青木', managedStudentId: 's001', grade: '中2', subject: '英', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function createDesk(id: string, students: [StudentEntry | null, StudentEntry | null] | null): DeskCell {
  return { id, teacher: '講師', ...(students ? { lesson: { id: `${id}-lesson`, studentSlots: students } } : {}) }
}

function createCell(overrides: Partial<SlotCell> = {}): SlotCell {
  return { id: '2026-09-20_3', dateKey: '2026-09-20', dayLabel: '日', dateLabel: '9/20', slotLabel: '3限', slotNumber: 3, timeLabel: '16:20-17:50', isOpenDay: true, desks: [], ...overrides }
}

const REQUEST = { studentId: 's001', dateKey: '2026-09-20', slotNumber: 3, subject: '英' }

describe('resolveParentAbsenceTarget', () => {
  it('日付・時限が一致するセルから本人の席(机・生徒枠)を返す', () => {
    const cells = [
      createCell({ id: 'other-slot', slotNumber: 2, desks: [createDesk('d0', [createBoardStudent(), null])] }),
      createCell({ desks: [createDesk('d0', [createBoardStudent({ id: 'x', name: '別の子', managedStudentId: 's002' }), null]), createDesk('d1', [null, createBoardStudent()])] }),
    ]
    const result = resolveParentAbsenceTarget({ cells, students: [createStudentRow()], ...REQUEST })
    expect(result).toMatchObject({ ok: true, target: { cellId: '2026-09-20_3', deskIndex: 1, studentIndex: 1 } })
  })

  it('その日・その時限のセルが無ければ cell-not-found(休校日・週が違う)', () => {
    const cells = [createCell({ dateKey: '2026-09-21', id: '2026-09-21_3' })]
    expect(resolveParentAbsenceTarget({ cells, students: [createStudentRow()], ...REQUEST })).toEqual({ ok: false, reason: 'cell-not-found' })
  })

  // すでに電話で休みにした・別の日へ動かした・削除した、のいずれか。盤面を何も変えずに室長へ知らせる。
  it('セルはあるが本人が居なければ student-not-found(休み済みの出欠記録 statusSlots は対象にしない)', () => {
    const desk: DeskCell = { id: 'd0', teacher: '講師', statusSlots: [null, null], lesson: { id: 'l', studentSlots: [null, null] } }
    expect(resolveParentAbsenceTarget({ cells: [createCell({ desks: [desk] })], students: [createStudentRow()], ...REQUEST })).toEqual({ ok: false, reason: 'student-not-found' })
  })

  it('講習(special)と体験(trial)のコマは対象にしない(保護者ページに出ないコマを休みにしない)', () => {
    const cells = [createCell({ desks: [createDesk('d0', [createBoardStudent({ lessonType: 'special' }), createBoardStudent({ id: 't', lessonType: 'trial' })])] })]
    expect(resolveParentAbsenceTarget({ cells, students: [createStudentRow()], ...REQUEST })).toEqual({ ok: false, reason: 'student-not-found' })
  })

  it('振替(makeup)と増コマ(extra)は対象にする', () => {
    for (const lessonType of ['makeup', 'extra'] as const) {
      const cells = [createCell({ desks: [createDesk('d0', [createBoardStudent({ lessonType }), null])] })]
      expect(resolveParentAbsenceTarget({ cells, students: [createStudentRow()], ...REQUEST })).toMatchObject({ ok: true, student: { lessonType } })
    }
  })

  it('同じコマに本人が 2 席あるときは連絡の科目に一致する席を選ぶ。一致が無ければ先頭', () => {
    const cells = [createCell({ desks: [createDesk('d0', [createBoardStudent({ id: 'math', subject: '数' }), null]), createDesk('d1', [createBoardStudent({ id: 'eng', subject: '英' }), null])] })]
    expect(resolveParentAbsenceTarget({ cells, students: [createStudentRow()], ...REQUEST })).toMatchObject({ ok: true, target: { deskIndex: 1 } })
    expect(resolveParentAbsenceTarget({ cells, students: [createStudentRow()], ...REQUEST, subject: '国' })).toMatchObject({ ok: true, target: { deskIndex: 0 } })
  })
})

describe('isBoardStudentOwnedBy(生徒の同一性)', () => {
  const owner = new Map([['青木', 's001'], ['青木太郎', 's001'], ['田中', '']])
  it('managedStudentId があればそれだけで決める(同名でも別 ID なら別人)', () => {
    expect(isBoardStudentOwnedBy({ managedStudentId: 's001', name: '別名' }, 's001', owner)).toBe(true)
    expect(isBoardStudentOwnedBy({ managedStudentId: 's002', name: '青木' }, 's001', owner)).toBe(false)
  })
  it('managedStudentId が無いときだけ、名簿で一意な名前(空白除去)の一致で拾う', () => {
    expect(isBoardStudentOwnedBy({ name: '青木 太郎' }, 's001', owner)).toBe(true)
    expect(isBoardStudentOwnedBy({ name: '田中' }, 's001', owner)).toBe(false) // 同名が 2 人以上=名前では決めない
    expect(isBoardStudentOwnedBy({ name: '' }, 's001', owner)).toBe(false)
    expect(isBoardStudentOwnedBy({ name: '青木' }, '', owner)).toBe(false)
  })
  it('同名の生徒が名簿に 2 人居るときは、managedStudentId の無い席を拾わない(別人を休みにしない)', () => {
    const students = [createStudentRow(), createStudentRow({ id: 's002', name: '青木 次郎', displayName: '青木' })]
    const cells = [createCell({ desks: [createDesk('d0', [createBoardStudent({ managedStudentId: undefined }), null])] })]
    expect(resolveParentAbsenceTarget({ cells, students, ...REQUEST })).toEqual({ ok: false, reason: 'student-not-found' })
  })
})

// Issue #46 と同型の再発火防止。盤面は key 再マウントで processedRef が消えるので、App 側 state の消費と対で守る。
describe('一過性コマンドの消費判定', () => {
  const request: ParentAbsenceRequest = { requestId: 3, messageId: 'm1', action: 'absent', ...REQUEST }
  it('未処理の 1 件だけ処理する(null・処理済み requestId は処理しない)', () => {
    expect(shouldProcessParentAbsenceRequest(null, null)).toBe(false)
    expect(shouldProcessParentAbsenceRequest(request, null)).toBe(true)
    expect(shouldProcessParentAbsenceRequest(request, 2)).toBe(true)
    expect(shouldProcessParentAbsenceRequest(request, 3)).toBe(false)
  })
  it('処理した requestId と一致するときだけ null 化する(より新しいリクエストは消さない)', () => {
    expect(consumeParentAbsenceRequest(request, 3)).toBeNull()
    expect(consumeParentAbsenceRequest(request, 2)).toBe(request)
    expect(consumeParentAbsenceRequest(null, 3)).toBeNull()
  })
})
