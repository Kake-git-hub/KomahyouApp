// 準備で置いた講師の印（checklistPrepTeacher・spec-developer-report §E-2-4-2）を、コマ表で机の講師を動かす・入れ替える・消す・書き換える
// 経路で**落とす**ことを固定する（主セッションの決定 2026-11-06: 動かした準備の講師は後片づけの対象から外す。動かした先にも元の机にも印を残さない）。
// 落とさないと、準備の講師を D&D で別の机へ動かしたあと元の机に入った別の手置き講師を後片づけが消す（INV-02）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  applyUserDeletedTeacherTombstone,
  carryBoardStatusRecordsOntoClosedDayCell,
  clearTeacherAssignment,
  computeTeacherMove,
  repackTeacherOnlyDesks,
  setScheduleRegistrationTeacherAssignment,
} from './ScheduleBoardScreen'
import { cleanupChecklistPrepBoard } from './checklistPrepTemplate'
import { restDeskTeacher } from './teacherRest'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'

const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

const student = (id: string): StudentEntry => ({ id, name: `生徒${id}`, managedStudentId: id, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' })
const cell = (desks: DeskCell[], isOpenDay = true): SlotCell => ({ id: 'C1', dateKey: '2026-11-19', dayLabel: '木', dateLabel: '11/19', slotLabel: '3限', slotNumber: 3, timeLabel: '', isOpenDay, desks })
const prepDesk = (id: string, extra: Partial<DeskCell> = {}): DeskCell => ({ id, teacher: '講師D', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 't4', checklistPrepTeacher: true, ...extra })
const hasMark = (desk: DeskCell | undefined) => Boolean(desk && 'checklistPrepTeacher' in desk)

describe('準備の講師の印: 講師の移動・入れ替え（computeTeacherMove）で落とす', () => {
  it('空き机へ動かすと、動かした先にも元の机にも印を残さない（元の机に入った別の手置き講師を後片づけが消さない）', () => {
    const weeks = [[cell([prepDesk('d0', { lesson: { id: 'la', studentSlots: [student('s001'), null] } }), { id: 'd1', teacher: '', lesson: { id: 'lb', studentSlots: [student('s002'), null] } }])]]
    const moved = computeTeacherMove({ weeks, weekIndex: 0, cellId: 'C1', sourceDeskIndex: 0, targetDeskIndex: 1 })
    expect(moved.status).toBe('moved')
    if (moved.status !== 'moved') return
    const [d0, d1] = moved.nextWeeks[0][0].desks
    expect(d1.teacher).toBe('講師D')
    expect(hasMark(d0)).toBe(false)
    expect(hasMark(d1)).toBe(false)
    // 元の机に別の講師を手で置いても、後片づけは何も消さない。
    const replaced = moved.nextWeeks.map((week) => week.map((slot) => ({ ...slot, desks: slot.desks.map((desk) => (desk.id === 'd0' ? { ...desk, teacher: '講師E', manualTeacher: true, teacherAssignmentSource: 'manual' as const, teacherAssignmentTeacherId: 't5' } : desk)) })))
    expect(cleanupChecklistPrepBoard(replaced, null).removed).toEqual({ trials: 0, memos: 0, teachers: 0 })
  })

  it('講師の居る机と入れ替えても両方の机に印を残さない（講師だけ入替・席ごと入替）', () => {
    for (const swapMode of ['teacher', 'seat'] as const) {
      const weeks = [[cell([prepDesk('d0', { lesson: { id: 'la', studentSlots: [student('s001'), null] } }), { id: 'd1', teacher: '講師B', manualTeacher: false, teacherAssignmentTeacherId: 't2', lesson: { id: 'lb', studentSlots: [student('s002'), null] } }])]]
      const swapped = computeTeacherMove({ weeks, weekIndex: 0, cellId: 'C1', sourceDeskIndex: 0, targetDeskIndex: 1, swapMode })
      expect(swapped.status, swapMode).toBe('moved')
      if (swapped.status !== 'moved') continue
      const [d0, d1] = swapped.nextWeeks[0][0].desks
      expect(d0.teacher, swapMode).toBe('講師B')
      expect(d1.teacher, swapMode).toBe('講師D')
      expect(hasMark(d0), swapMode).toBe(false)
      expect(hasMark(d1), swapMode).toBe(false)
    }
  })
})

describe('準備の講師の印: 講師を消す・書き換える経路で落とす', () => {
  it('講師メニューの削除（削除の記録）', () => {
    const desk = prepDesk('d0')
    applyUserDeletedTeacherTombstone(desk)
    expect(desk.teacherAssignmentSource).toBe('deleted')
    expect(hasMark(desk)).toBe(false)
  })

  it('講師欄を空にする（clearTeacherAssignment）・日程表登録（QR）の講師で書き換える', () => {
    const cleared = prepDesk('d0')
    clearTeacherAssignment(cleared)
    expect(cleared.teacher).toBe('')
    expect(hasMark(cleared)).toBe(false)
    const qr = prepDesk('d1')
    setScheduleRegistrationTeacherAssignment(qr, '講師F', 'ss1', 't6')
    expect(qr.teacherAssignmentSource).toBe('schedule-registration')
    expect(hasMark(qr)).toBe(false)
  })

  it('講師の休み（restDeskTeacher）でも外す', () => {
    const rested = restDeskTeacher(prepDesk('d0'))
    expect(rested?.teacherRest?.teacher).toBe('講師D')
    expect(hasMark(rested ?? undefined)).toBe(false)
  })

  it('休日のコマへ記録ごと講師を引き継ぐ（carryBoardStatusRecordsOntoClosedDayCell）ときも運ばない', () => {
    const record = { id: 'st1', studentId: 'e1', name: '生徒s001', managedStudentId: 's001', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '講師D', dateKey: '2026-11-19', slotNumber: 3, recordedAt: 'x', status: 'attended' } as unknown as StudentStatusEntry
    const closed = cell([{ id: 'd0', teacher: '' }], false)
    const board = cell([prepDesk('d0', { statusSlots: [record, null] })])
    const carried = carryBoardStatusRecordsOntoClosedDayCell(closed, board)
    expect(carried.desks[0].teacher).toBe('講師D')
    expect(hasMark(carried.desks[0])).toBe(false)
  })
})

describe('準備の講師の印: 講師だけの机の詰め直し（repackTeacherOnlyDesks）', () => {
  it('別の机へ詰めた講師の印は落とす（元の机にも残さない）', () => {
    const desks: DeskCell[] = [
      { id: 'd0', teacher: '' },
      prepDesk('d1'),
    ]
    const repacked = repackTeacherOnlyDesks(desks)
    expect(repacked[0].teacher).toBe('講師D')
    expect(repacked[1].teacher).toBe('')
    expect(hasMark(repacked[0])).toBe(false)
    expect(hasMark(repacked[1])).toBe(false)
  })

  it('詰め直しで同じ机に残った講師は動いていないので印を残す（後片づけで消せる）', () => {
    const desks: DeskCell[] = [prepDesk('d0'), { id: 'd1', teacher: '' }]
    const repacked = repackTeacherOnlyDesks(desks)
    expect(repacked[0].teacher).toBe('講師D')
    expect(repacked[0].checklistPrepTeacher).toBe(true)
    expect(hasMark(repacked[1])).toBe(false)
  })
})

describe('準備の講師の印: 書き換える関数は字面でも印を落とす（新しい経路を足すときの見落とし防止）', () => {
  it.each(['function clearTeacherAssignment(', 'function setScheduleRegistrationTeacherAssignment(', 'function applyDeskTeacherBlock(', 'function applyDeletedTeacherTombstone('])('%s は delete desk.checklistPrepTeacher を含む', (signature) => {
    const start = BOARD_TSX.indexOf(signature)
    expect(start, signature).toBeGreaterThan(0)
    const end = BOARD_TSX.indexOf('\n}\n', start)
    expect(BOARD_TSX.slice(start, end)).toContain('delete desk.checklistPrepTeacher')
  })
})
