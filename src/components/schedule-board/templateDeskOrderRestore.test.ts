// §9-22 案 A（オーナー決定 2026-11-06・確認リスト v2-1）: テンプレ保存の直前に、並び替えた週の机を「テンプレの並び」へ戻す純関数
// restoreTemplateDeskOrder の単体テスト。対応付け（授業 ID → 同じ生徒 → 足場講師）・手入力の机の行き先（空いた番号）・保留の固定・
// 机 ID の振り直し・並び替えていないコマは参照ごと不変（INV-10）を固定する。
import { describe, expect, it } from 'vitest'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { restoreTemplateDeskOrder } from './templateDeskOrderRestore'

const CELL_ID = '2026-10-07_5'

function student(id: string, overrides: Partial<StudentEntry> = {}): StudentEntry {
  return { id: `${id}_e`, name: id, managedStudentId: id, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal', ...overrides }
}

function cellWith(desks: Array<Omit<DeskCell, 'id'>>): SlotCell {
  return {
    id: CELL_ID, dateKey: '2026-10-07', dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: 5, timeLabel: '', isOpenDay: true,
    desks: desks.map((desk, index) => ({ ...desk, id: `${CELL_ID}_desk_${index + 1}` })),
  }
}

const managed = (rowId: string, ...students: StudentEntry[]) => ({ id: `managed_${rowId}_2026-10-07`, note: '管理データ反映', studentSlots: [students[0] ?? null, students[1] ?? null] as [StudentEntry | null, StudentEntry | null] })

// テンプレ: 机1=田中(sA)・机2=鈴木(sB)・机3=佐藤(講師だけ)・机4=空
const TEMPLATE: DeskCell[] = [
  { id: 't1', teacher: '田中', lesson: managed('r0', student('sA')) },
  { id: 't2', teacher: '鈴木', lesson: managed('r1', student('sB')) },
  { id: 't3', teacher: '佐藤' },
  { id: 't4', teacher: '' },
]
const TANAKA: Omit<DeskCell, 'id'> = { teacher: '田中', lesson: managed('r0', student('sA')) }
const SUZUKI: Omit<DeskCell, 'id'> = { teacher: '鈴木', lesson: managed('r1', student('sB')) }
const SATO_MANUAL_STUDENTS: Omit<DeskCell, 'id'> = { teacher: '佐藤', lesson: { id: 'hand', studentSlots: [student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), student('sD', { lessonType: 'special' })] } }
const EMPTY: Omit<DeskCell, 'id'> = { teacher: '' }

const shape = (cell: SlotCell) => cell.desks.map((desk) => `${desk.teacher}|${(desk.lesson?.studentSlots ?? []).filter(Boolean).map((item) => item!.managedStudentId).join(',')}`)

describe('restoreTemplateDeskOrder（§9-22 案 A）', () => {
  it('並び替えていないコマ（全部の机が対応する番号にある）は参照ごと不変（不動点・INV-10）', () => {
    const cell = cellWith([TANAKA, SUZUKI, SATO_MANUAL_STUDENTS, EMPTY])
    expect(restoreTemplateDeskOrder(cell, TEMPLATE)).toBe(cell)
  })

  it('授業 ID でテンプレの机番号へ戻し、テンプレの講師（足場）の机は同じ講師のテンプレの机へ。机の中身は変えず、机 ID は位置で振り直す', () => {
    const sorted = cellWith([SATO_MANUAL_STUDENTS, TANAKA, SUZUKI, EMPTY])
    const restored = restoreTemplateDeskOrder(sorted, TEMPLATE)
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '佐藤|sM,sD', '|'])
    expect(restored.desks.map((desk) => desk.id)).toEqual([1, 2, 3, 4].map((n) => `${CELL_ID}_desk_${n}`))
    // 中身（授業・席）は同じもの
    expect(restored.desks[2].lesson).toBe(sorted.desks[0].lesson)
    expect(restored.desks[0].lesson).toBe(sorted.desks[1].lesson)
    // 入力は変えない
    expect(shape(sorted)).toEqual(['佐藤|sM,sD', '田中|sA', '鈴木|sB', '|'])
  })

  it('授業 ID が一致しないテンプレの授業（行が変わった等）は、同じ生徒を持つテンプレの机へ', () => {
    const moved: Omit<DeskCell, 'id'> = { teacher: '鈴木', lesson: { id: 'managed_old_2026-10-07', note: '管理データ反映', studentSlots: [student('sB'), null] } }
    const restored = restoreTemplateDeskOrder(cellWith([moved, TANAKA, { teacher: '佐藤' }, EMPTY]), TEMPLATE)
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '佐藤|', '|'])
  })

  it('手入力だけの机: 今の番号がテンプレで使われていなければそのまま、使われていればテンプレが使わない番号（一番若い）へ', () => {
    const manualOnly: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand2', studentSlots: [student('sX', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
    // 並び替えで手入力だけの机が机 1（テンプレの田中の番号）へ動いた
    const restored = restoreTemplateDeskOrder(cellWith([manualOnly, TANAKA, SUZUKI, { teacher: '佐藤' }]), TEMPLATE)
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '佐藤|', '高橋|sX'])
  })

  it('手入力だけの机: テンプレが全部の机を使う（空いた番号が無い）と、残った番号に入る（§2-1 で 2 行になる・今までどおり）', () => {
    const template: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 't3', teacher: '佐藤', lesson: managed('r2', student('sC')) }]
    const manualOnly: Omit<DeskCell, 'id'> = { teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand2', studentSlots: [student('sX', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
    const restored = restoreTemplateDeskOrder(cellWith([manualOnly, TANAKA, SUZUKI]), template)
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '佐藤|sX'])
  })

  it('メモだけ・出欠記録だけの机も手入力の机として扱う（中身は変えない）', () => {
    const memoOnly: Omit<DeskCell, 'id'> = { teacher: '', memoSlots: ['持ち物', null] }
    const restored = restoreTemplateDeskOrder(cellWith([memoOnly, TANAKA, SUZUKI, { teacher: '佐藤' }]), TEMPLATE)
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '佐藤|', '|'])
    expect(restored.desks[3].memoSlots).toEqual(['持ち物', null])
  })

  it('保留（2 行）の机は位置も机 ID も中身もそのまま（Q31）。他の机だけを戻す', () => {
    const sorted = cellWith([SATO_MANUAL_STUDENTS, SUZUKI, TANAKA, EMPTY])
    const lockedId = sorted.desks[1].id
    const restored = restoreTemplateDeskOrder(sorted, TEMPLATE, { lockedDeskIds: new Set([lockedId]) })
    expect(restored.desks[1]).toBe(sorted.desks[1])
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '佐藤|sM,sD', '|'])
  })

  it('保留の机が別のテンプレの番号を塞いでいるときは、その机に戻れない机は今の番号に残る（保留の机は動かさない）', () => {
    // 机 1 が保留（中身は鈴木）。田中の机は机 1 へ戻れない
    const sorted = cellWith([SUZUKI, TANAKA, { teacher: '佐藤' }, EMPTY])
    const restored = restoreTemplateDeskOrder(sorted, TEMPLATE, { lockedDeskIds: new Set([sorted.desks[0].id]) })
    expect(restored.desks[0]).toBe(sorted.desks[0])
    expect(shape(restored)).toEqual(['鈴木|sB', '田中|sA', '佐藤|', '|'])
  })

  it('テンプレの講師だけの机（足場）は同じ講師（呼び名の対応表）のテンプレの机へ', () => {
    const aliases = (key: string) => (key === '佐藤先生' || key === '佐藤' ? ['佐藤', '佐藤先生', 't3'] : [key])
    const restored = restoreTemplateDeskOrder(cellWith([{ teacher: '佐藤先生' }, TANAKA, SUZUKI, EMPTY]), TEMPLATE, { aliases })
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '佐藤先生|', '|'])
  })

  it('手入力の机の行き先（空いた番号）は usedDesks（反映するテンプレ）で決める', () => {
    const manualOnly: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand2', studentSlots: [student('sX', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
    // 盤面の元のテンプレ（基準）は机 3・机 4 とも空。反映するテンプレ（usedDesks）は机 4 に講師を置く → 手入力の机は机 3 へ（机 4 へは行かない）
    const used: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 't3', teacher: '' }, { id: 't4', teacher: '高橋' }]
    const restored = restoreTemplateDeskOrder(cellWith([manualOnly, TANAKA, SUZUKI, EMPTY]), [TEMPLATE[0], TEMPLATE[1], { id: 't3', teacher: '' }, { id: 't4', teacher: '' }], { usedDesks: used })
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '高橋|sX', '|'])
  })
})
