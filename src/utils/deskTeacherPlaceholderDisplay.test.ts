// 机の講師欄の埋め草「講師未割当」「講師未設定」はどの画面・文面にも出さない（オーナー指示 2026-11-07「講師未割当はもう表示しなくてよい」）。
// 表示だけの変更：データ（desk.teacher）・机の同一性・講師の判定は変えない。出力に出る所ごとに、埋め草の机を入れて文字が無いことを固定する。
// 判定の権威は utils/deskTeacherLabel.ts（DESK_TEACHER_PLACEHOLDER_LABELS / formatDeskTeacherLabel）1 か所。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DeskCell, SlotCell, StudentEntry } from '../components/schedule-board/types'
import { DESK_TEACHER_PLACEHOLDER_LABELS } from './deskTeacherLabel'
import { summarizeWeeksDiff } from './operationTrace'
import { resolveScheduleViewTargetSeat } from '../components/schedule-view/scheduleViewMove'
import { buildTemplatePendingList } from '../components/schedule-board/templatePendingList'
import { buildTemplatePendingDeskKey } from '../components/schedule-board/templatePendingDesks'
import { buildTemplatePendingTeacherChoiceConfirm } from '../components/schedule-board/templatePendingResolution'
import { buildStudentAssignments, collectStudentAbsenceNotes } from './scheduleViewData'
import type { SerializedCell } from './scheduleHtml'
import { buildTemplateDiffStudentNoteLines } from '../components/schedule-board/templateDiffApply'

const PLACEHOLDERS = [...DESK_TEACHER_PLACEHOLDER_LABELS]

function expectNoPlaceholder(text: string) {
  for (const label of PLACEHOLDERS) expect(text).not.toContain(label)
}

function student(id: string, name: string): StudentEntry {
  return { id, name, grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal' }
}

function slotCell(desks: DeskCell[]): SlotCell {
  return { id: '2026-10-07_5', dateKey: '2026-10-07', dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true, desks }
}

describe.each(PLACEHOLDERS)('埋め草「%s」を文面に出さない', (placeholder) => {
  it('日程表タブの移動先の机に空きが無い理由文', () => {
    const full = { id: 'd1', teacher: placeholder, lesson: { id: 'l', studentSlots: [student('a', '生徒A'), student('b', '生徒B')] as [StudentEntry, StudentEntry] } }
    const result = resolveScheduleViewTargetSeat(slotCell([full]), { deskIndex: 0, studentIndex: 0, deskId: 'd1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expectNoPlaceholder(result.reason)
  })

  it('保留の一覧（講師の保留の上の行・理由文）', () => {
    const desk: DeskCell = { id: '2026-10-07_5_desk_1', teacher: placeholder }
    const cell = slotCell([desk])
    const key = buildTemplatePendingDeskKey(cell.id, desk.id)
    const rows = buildTemplatePendingList({ [key]: { lower: { teacher: { teacher: '手置き講師', manualTeacher: true } }, effectiveStartDate: '2026-10-07', createdAt: '2026-10-01T00:00:00.000Z' } }, [[cell]])
    expect(rows.length).toBe(1)
    expectNoPlaceholder(JSON.stringify(rows))
  })

  it('保留の講師の採用の確認文', () => {
    const text = buildTemplatePendingTeacherChoiceConfirm(
      { teacher: placeholder, lesson: undefined },
      { lower: { teacher: { teacher: '手置き講師', manualTeacher: true } }, effectiveStartDate: '2026-10-07', createdAt: '2026-10-01T00:00:00.000Z' },
      'template',
    )
    expect(text).not.toBe('')
    expectNoPlaceholder(text)
  })

  it('操作の痕跡（机の差分の要約）', () => {
    const before = [[slotCell([{ id: 'd1', teacher: placeholder }])]]
    const after = [[slotCell([{ id: 'd1', teacher: placeholder, lesson: { id: 'l', studentSlots: [student('a', '生徒A'), null] } }])]]
    const summary = summarizeWeeksDiff(before, after)
    expect(summary).not.toBe('')
    expectNoPlaceholder(summary)
  })

  it('テンプレ反映の確認の講師の行（講師名・保留の講師）', () => {
    const lines = buildTemplateDiffStudentNoteLines([
      { kind: 'teacher-pending', studentName: placeholder, subject: '', dateKey: '2026-10-07', slotNumber: 5, detail: placeholder },
      { kind: 'teacher-replaced', studentName: placeholder, subject: '', dateKey: '2026-10-07', slotNumber: 5, detail: placeholder },
      { kind: 'teacher-kept', studentName: placeholder, subject: '', dateKey: '2026-10-07', slotNumber: 5, detail: placeholder },
      { kind: 'teacher-elsewhere', studentName: placeholder, subject: '', dateKey: '2026-10-07', slotNumber: 5, detail: '2' },
    ])
    expect(lines.length).toBeGreaterThan(0)
    expectNoPlaceholder(lines.join('\n'))
  })

  it('生徒日程表の授業の講師名・欠席メモ（別タブの表示算出）', () => {
    const cells: SerializedCell[] = [{
      dateKey: '2026-10-07', dateLabel: '10/7', dayLabel: '水', slotNumber: 5, slotLabel: '5限', timeLabel: '', isOpenDay: true,
      desks: [{
        teacher: placeholder,
        statuses: [{ id: 'st', linkedStudentId: 'stu-1', name: '生徒A', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', recordedAt: '2026-10-01T00:00:00.000Z', status: 'absent' }],
        lesson: { students: [{ id: 'e1', linkedStudentId: 'stu-1', name: '生徒A', grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', manualAdded: false }] },
      }],
    } as unknown as SerializedCell]
    const map = buildStudentAssignments(cells)
    expectNoPlaceholder(JSON.stringify([...map.values()]))
    const notes = collectStudentAbsenceNotes(cells, { id: 'stu-1', name: '生徒A', fullName: '生徒A' } as never)
    expect(notes.length).toBeGreaterThan(0)
    expectNoPlaceholder(notes.join('\n'))
  })
})

describe('配線（ソースの形で固定する表示箇所）', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('コマ表の操作メッセージの机の呼び名（resolveDeskLabel）と保留メニューの見出しは formatDeskTeacherLabel を通す', () => {
    const screen = read('../components/schedule-board/ScheduleBoardScreen.tsx')
    expect(screen).toContain("return formatDeskTeacherLabel(desk.teacher).trim() || `${deskIndex + 1}机目`")
    expect(screen).toContain("テンプレ ${formatDeskTeacherLabel(templatePendingDeskMenuContext.desk.teacher).trim() || 'なし'}")
  })

  it('別タブ(生成HTML)は埋め草の一覧を共有定数から埋め込み、机一覧・生徒日程表の講師名・欠席メモで同じ関数を通す（文字比較を直書きしない）', () => {
    const html = read('./scheduleHtml.ts')
    expect(html).not.toContain("desk.teacher === '講師未割当'")
    expect(html).toContain('const DESK_TEACHER_PLACEHOLDERS = ${JSON.stringify(DESK_TEACHER_PLACEHOLDER_LABELS)};')
    expect(html).toContain("escapeHtml(displayDeskTeacher(desk.teacher)) + '</td>'")
    expect(html).toContain('teacher: displayDeskTeacher(desk.teacher), timeLabel: cell.timeLabel, lesson: student')
    expect(html).toContain('teacher: displayDeskTeacher(statusEntry.teacherName || desk.teacher)')
    expect(html).toContain('displayDeskTeacher(entry.teacherName || desk.teacher)')
    // 机の同一性の照合(data-desk-teacher)は元の文字のまま。
    expect(html).toContain(`' data-desk-teacher="' + escapeHtml(desk.teacher || '') + '"'`)
  })
})
