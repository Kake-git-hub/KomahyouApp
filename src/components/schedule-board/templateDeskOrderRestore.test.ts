// §9-22 案 A（オーナー決定 2026-11-06・確認リスト v2-1）: テンプレ保存の直前に、並び替えた週の机を「テンプレの並び」へ戻す純関数
// restoreTemplateDeskOrder の単体テスト。対応付け（授業 ID → 同じ生徒 → 足場講師）・手入力の机の行き先（空いた番号）・保留の固定・
// 机 ID の振り直し・並び替えていないコマは参照ごと不変（INV-10）を固定する。
import { describe, expect, it } from 'vitest'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { restoreTemplateDeskOrder, restoreTemplateDeskOrderWithMoves } from './templateDeskOrderRestore'

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
    // （2026-11-10 M-3: 机 4 の講師が手置きの高橋だと「講師名を固定しただけの机」として高橋について行くので、別の講師にしてある）
    const used: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 't3', teacher: '' }, { id: 't4', teacher: '中村' }]
    const restored = restoreTemplateDeskOrder(cellWith([manualOnly, TANAKA, SUZUKI, EMPTY]), [TEMPLATE[0], TEMPLATE[1], { id: 't3', teacher: '' }, { id: 't4', teacher: '' }], { usedDesks: used })
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '高橋|sX', '|'])
  })
})

// 2026-11-10（オーナー決定「手入力は講師について行く」・緑が丘の報告・INV-02・spec-template-conflict-v2 §2-1）: 戻す先は新しいテンプレ（usedDesks）の講師の位置。
describe('restoreTemplateDeskOrder: 手入力は講師について行く（2026-11-10）', () => {
  // 新しいテンプレ: 机1=佐藤(講師だけ)・机2=鈴木(sB)・机3=田中(sA)・机4=空（田中と佐藤の机番号を入れ替えた）
  const SWAPPED: DeskCell[] = [
    { id: 'n1', teacher: '佐藤' },
    { id: 'n2', teacher: '鈴木', lesson: managed('n1', student('sB')) },
    { id: 'n3', teacher: '田中', lesson: managed('n2', student('sA')) },
    { id: 'n4', teacher: '' },
  ]
  // 新しいテンプレ: 佐藤を外して机3=高橋(講師だけ)
  const SATO_LEFT: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 'n3', teacher: '高橋' }, { id: 'n4', teacher: '' }]

  it('並び替えていないコマでも、新しいテンプレで講師の机番号が変わったら机ごと（中身はそのまま）その講師の机番号へ', () => {
    const cell = cellWith([TANAKA, SUZUKI, SATO_MANUAL_STUDENTS, EMPTY])
    const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cell, TEMPLATE, { usedDesks: SWAPPED })
    expect(shape(restored)).toEqual(['佐藤|sM,sD', '鈴木|sB', '田中|sA', '|'])
    expect(restored.desks[0].lesson).toBe(cell.desks[2].lesson)
    expect(teacherLeftMoves).toEqual([])
  })

  it('講師が新しいテンプレのそのコマにいない机の手入力は、テンプレが使わない一番若い番号へ。移した机を返す（講師は付け替えない・差分反映が外す）', () => {
    const cell = cellWith([TANAKA, SUZUKI, SATO_MANUAL_STUDENTS, EMPTY])
    const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cell, TEMPLATE, { usedDesks: SATO_LEFT })
    expect(shape(restored)).toEqual(['田中|sA', '鈴木|sB', '|', '佐藤|sM,sD'])
    expect(teacherLeftMoves.map((move) => [move.kind, move.fromDeskIndex, move.toDeskIndex, move.formerTeacherName, move.movedTeacherName, move.manualStudents.map((item) => item.managedStudentId)]))
      .toEqual([['moved', 2, 3, '佐藤', undefined, ['sM', 'sD']]])
  })

  it('講師がいなくなった机でも手入力が無ければ下の机へ寄せない（どこでもよい・テンプレが置き直す）。移した机も返さない', () => {
    const cell = cellWith([TANAKA, SUZUKI, { teacher: '佐藤' }, EMPTY])
    const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cell, TEMPLATE, { usedDesks: SATO_LEFT })
    expect(restored).toBe(cell)
    expect(teacherLeftMoves).toEqual([])
  })

  it('テンプレが使わない番号が無ければ、講師がいなくなった机の手入力は今の番号に残る。別の講師の机に入るので no-desk として返す（M-2）', () => {
    const used: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 'n3', teacher: '高橋' }]
    const cell = cellWith([TANAKA, SUZUKI, SATO_MANUAL_STUDENTS])
    const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cell, TEMPLATE.slice(0, 3), { usedDesks: used })
    expect(restored).toBe(cell)
    expect(teacherLeftMoves.map((move) => [move.kind, move.fromDeskIndex, move.toDeskIndex, move.formerTeacherName, move.deskTeacherName])).toEqual([['no-desk', 2, 2, '佐藤', '高橋']])
  })

  it('M-2: 空き机が無く今の番号も講師の机に取られる → 残った机へ入り、その机のテンプレの講師つきで no-desk を返す', () => {
    const used: DeskCell[] = [{ id: 'n1', teacher: '高橋' }, TEMPLATE[0], TEMPLATE[1]]
    const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, SUZUKI, SATO_MANUAL_STUDENTS]), TEMPLATE.slice(0, 3), { usedDesks: used })
    expect(shape(restored)).toEqual(['佐藤|sM,sD', '田中|sA', '鈴木|sB'])
    expect(teacherLeftMoves.map((move) => [move.kind, move.toDeskIndex, move.deskTeacherName])).toEqual([['no-desk', 0, '高橋']])
  })

  it('M-1（PROBE-P5）: 講師がいなくなった机の手入力は、テンプレが使う最後の机より下の空き机の一番若いものへ（上の空き机へは入れない）', () => {
    // 基準: 机1=田中(sA)・机2=鈴木(sB＋手入力 M)・机3=佐藤(sC)・机4/5=空。新しいテンプレ: 机1/2=空・机3=佐藤(sC)・机4=田中(sA)・机5=空（鈴木を外した）
    const anchor: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 't3', teacher: '佐藤', lesson: managed('r2', student('sC')) }, { id: 't4', teacher: '' }, { id: 't5', teacher: '' }]
    const used: DeskCell[] = [{ id: 'n1', teacher: '' }, { id: 'n2', teacher: '' }, { id: 'n3', teacher: '佐藤', lesson: managed('n2', student('sC')) }, { id: 'n4', teacher: '田中', lesson: managed('n3', student('sA')) }, { id: 'n5', teacher: '' }]
    const suzukiWithHand: Omit<DeskCell, 'id'> = { teacher: '鈴木', lesson: managed('r1', student('sB'), student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) }
    const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, suzukiWithHand, { teacher: '佐藤', lesson: managed('r2', student('sC')) }, EMPTY, EMPTY]), anchor, { usedDesks: used })
    expect(shape(restored)).toEqual(['|', '|', '佐藤|sC', '田中|sA', '鈴木|sB,sM'])
    expect(teacherLeftMoves.map((move) => [move.kind, move.toDeskIndex])).toEqual([['moved', 4]])
    // 下に空きが無ければ、テンプレが使わない机のうち一番若いもの
    const usedFull: DeskCell[] = [...used.slice(0, 4), { id: 'n5', teacher: '高橋' }]
    const fallback = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, suzukiWithHand, { teacher: '佐藤', lesson: managed('r2', student('sC')) }, EMPTY, EMPTY]), anchor, { usedDesks: usedFull })
    expect(shape(fallback.cell)).toEqual(['鈴木|sB,sM', '|', '佐藤|sC', '田中|sA', '|'])
    expect(fallback.teacherLeftMoves.map((move) => [move.kind, move.toDeskIndex])).toEqual([['moved', 0]])
  })

  it('M-3: 講師名を固定しただけの机（手置き講師・テンプレの授業の手がかり無し）は、その講師が新しいテンプレのそのコマにいればその講師の机へ。いなければ従来どおり', () => {
    const pinned: Omit<DeskCell, 'id'> = { teacher: '佐藤', manualTeacher: true, lesson: { id: 'hand', studentSlots: [student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
    expect(shape(restoreTemplateDeskOrder(cellWith([TANAKA, SUZUKI, pinned, EMPTY]), TEMPLATE, { usedDesks: SWAPPED }))).toEqual(['佐藤|sM', '鈴木|sB', '田中|sA', '|'])
    // 手置きの講師が新しいテンプレのそのコマにいない → 手がかりなし（講師がいなくなった扱いにしない＝手入力だけの机と同じ）
    const { cell: kept, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, SUZUKI, pinned, EMPTY]), TEMPLATE, { usedDesks: SATO_LEFT })
    expect(kept.desks[2].lesson?.id).toBe('hand')
    expect(teacherLeftMoves).toEqual([])
  })

  // 2026-11-10 オーナー決定・§9-1 改定（spec §2-3「同じ講師として合流する」）: 改定前は「手で置いた講師（teacherAssignmentSource あり）の机はついて行かない（手置きが勝つ・tp-59 の形）」
  // を固定していた。改定後は、机のテンプレの授業の手がかりが無い手置き・QR の講師の机も、その講師の名前で新しいテンプレの同じ講師の机へ合流する。
  it.each([
    ['手置き（manual）', { teacherAssignmentSource: 'manual' as const }],
    ['QR（schedule-registration）', { teacherAssignmentSource: 'schedule-registration' as const, teacherAssignmentSessionId: 'ss1' }],
    // regression-reviewer L（2026-11-10）: 入れ替えた講師（manual-replaced）でも、授業の手がかりも採用の記録も無ければ講師自身の名前で合流する
    ['入れ替え（manual-replaced・授業の手がかりも採用の記録も無し）', { teacherAssignmentSource: 'manual-replaced' as const }],
  ])('§9-1 改定: %s の講師の机（授業の手がかり無し）は、その講師がテンプレの別の机に居ればその机へ合流する', (_label, fields) => {
    const handPlaced: Omit<DeskCell, 'id'> = { teacher: '佐藤', manualTeacher: true, ...fields, lesson: { id: 'hand', studentSlots: [student('sM', { lessonType: 'trial' }), null] } }
    // 机 4 の手置きの佐藤。新しいテンプレの佐藤は机 1 → 手置きの机は机 1 へ
    const restored = restoreTemplateDeskOrder(cellWith([TANAKA, SUZUKI, EMPTY, handPlaced]), TEMPLATE, { usedDesks: SWAPPED })
    expect(restored.desks.findIndex((desk) => desk.lesson?.id === 'hand')).toBe(0)
    expect(shape(restored)).toEqual(['佐藤|sM', '鈴木|sB', '田中|sA', '|'])
  })

  it('§9-1 改定のガード: 別の講師（田中）のテンプレの授業に手置きの佐藤を入れた机（manual-replaced）は、佐藤ではなく田中について行く（§9-15 のまま）', () => {
    const replaced: Omit<DeskCell, 'id'> = { teacher: '佐藤', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', lesson: managed('r0', student('sA'), student('sM', { lessonType: 'trial' })) }
    const restored = restoreTemplateDeskOrder(cellWith([replaced, SUZUKI, EMPTY, EMPTY]), TEMPLATE, { usedDesks: SWAPPED })
    // 新しいテンプレの田中は机 3 → 机ごと机 3 へ（佐藤の机 1 へは行かない）
    expect(restored.desks.findIndex((desk) => desk.teacher === '佐藤')).toBe(2)
  })

  it('§9-1 改定: 今の番号に同じ講師のテンプレの机がある手置き講師の机は、ほかの机が動いてもその番号のまま', () => {
    const handPlaced: Omit<DeskCell, 'id'> = { teacher: '鈴木', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'moved_x', studentSlots: [student('sB'), null] } }
    // 盤面: 机1=田中・机2=手置きの鈴木・机3=佐藤。新しいテンプレ（SWAPPED）は田中と佐藤を入れ替え、鈴木は机 2 のまま
    const cell = cellWith([TANAKA, handPlaced, { teacher: '佐藤' }, EMPTY])
    const restored = restoreTemplateDeskOrder(cell, TEMPLATE, { usedDesks: SWAPPED })
    expect(restored.desks[1]).toBe(cell.desks[1])
    expect(shape(restored)).toEqual(['佐藤|', '鈴木|sB', '田中|sA', '|'])
  })

  it('declined: 採用した講師が今の机の講師でなければ、取り下げた講師を手がかりに使わない（isTemplateTeacherDeclinedAtDesk の S-1 と同じ）', () => {
    const stale: Omit<DeskCell, 'id'> = { teacher: '渡辺', manualTeacher: true, teacherAssignmentSource: 'manual', templateTeacherDeclined: { teacher: '佐藤', adopted: { teacher: '高橋' } }, lesson: { id: 'hand', studentSlots: [student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
    const restored = restoreTemplateDeskOrder(cellWith([TANAKA, SUZUKI, stale, EMPTY]), TEMPLATE, { usedDesks: SWAPPED })
    // 佐藤について行かない（佐藤の机＝机 1 へは入らない）。手入力だけの机として、テンプレが使わない机 4 へ
    expect(shape(restored)).toEqual(['|', '鈴木|sB', '田中|sA', '渡辺|sM'])
  })

  it('L-1: 手置き講師の机（テンプレの授業から引いた講師）は、同じ講師の足場講師の机より後に番号を取る（今の番号に居ても譲る）', () => {
    const replaced: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', lesson: managed('r0', student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) }
    // 手置き講師の机は机 3（新テンプレの田中の番号）に居て、田中の足場講師の机は机 1
    const restored = restoreTemplateDeskOrder(cellWith([{ teacher: '田中' }, SUZUKI, replaced, EMPTY]), TEMPLATE, { usedDesks: SWAPPED })
    expect(shape(restored)).toEqual(['|', '鈴木|sB', '田中|', '高橋|sM'])
  })

  it('手置き講師の机は、机のテンプレの授業が保存前のテンプレで乗っていた机の講師（鈴木）の新しい机へ。鈴木がいなければ手置き講師ごと下の空き机へ', () => {
    const replaced: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', lesson: managed('r1', student('sB'), student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) }
    const usedSuzukiMoved: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '佐藤' }, { id: 'n3', teacher: '鈴木', lesson: managed('n2', student('sB')) }, { id: 'n4', teacher: '' }]
    const followed = restoreTemplateDeskOrder(cellWith([TANAKA, replaced, { teacher: '佐藤' }, EMPTY]), TEMPLATE, { usedDesks: usedSuzukiMoved })
    expect(shape(followed)).toEqual(['田中|sA', '佐藤|', '高橋|sB,sM', '|'])
    const usedSuzukiLeft: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '佐藤' }, { id: 'n3', teacher: '' }, { id: 'n4', teacher: '' }]
    const left = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, replaced, { teacher: '佐藤' }, EMPTY]), TEMPLATE, { usedDesks: usedSuzukiLeft })
    expect(shape(left.cell)).toEqual(['田中|sA', '佐藤|', '高橋|sB,sM', '|'])
    expect(left.teacherLeftMoves.map((move) => [move.formerTeacherName, move.movedTeacherName, move.toDeskIndex, move.manualStudents.map((item) => item.managedStudentId)])).toEqual([['鈴木', '高橋', 2, ['sM']]])
  })

  // 2026-11-11 オーナー決定（Issue #84・日大前の 29 机の型・INV-02・INV-01）: 別の講師 W（鈴木）の授業に手で X（高橋）を入れた机で、W が新しいテンプレのそのコマにいなくて
  // X がいる → X の新しいテンプレの机へ合流する（v1.5.717 の合流と同じ扱い）。改定前は W がいない机として X ごと下の空き机へ移し、テンプレの生徒が講師なし（赤字）で残っていた。
  describe('Issue #84: 別の講師 W の授業に手で X を入れた机 × W がいない・X がいる → X の机へ合流', () => {
    const replacedOnSuzuki = (extra: Partial<DeskCell> = {}): Omit<DeskCell, 'id'> => ({
      teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', lesson: managed('r1', student('sB')), ...extra,
    })
    it.each([
      ['manual-replaced', 'manual-replaced' as const],
      ['manual', 'manual' as const],
    ])('(2) %s: 新しいテンプレの高橋が同じ机番号（机 2）に居る → 机 2 に居るまま（下の空き机へ移さない・確認画面にも出さない）', (_label, source) => {
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '高橋', lesson: managed('n1', student('sB')) }, TEMPLATE[2], TEMPLATE[3]]
      const cell = cellWith([TANAKA, replacedOnSuzuki({ teacherAssignmentSource: source }), { teacher: '佐藤' }, EMPTY])
      const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cell, TEMPLATE, { usedDesks: used })
      expect(restored).toBe(cell)
      expect(teacherLeftMoves).toEqual([])
    })
    it('(2) 新しいテンプレの高橋が別の机（机 3）に居る → 手置きの机は手入力ごと机 3 へ合流（佐藤は机 2・下の空き机へは移さない）', () => {
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '佐藤' }, { id: 'n3', teacher: '高橋', lesson: managed('n1', student('sB')) }, TEMPLATE[3]]
      const withHand = replacedOnSuzuki({ lesson: managed('r1', student('sB'), student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) })
      const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, withHand, { teacher: '佐藤' }, EMPTY]), TEMPLATE, { usedDesks: used })
      expect(shape(restored)).toEqual(['田中|sA', '佐藤|', '高橋|sB,sM', '|'])
      expect(teacherLeftMoves).toEqual([])
    })
    it('(2) 同じ講師の足場講師の机が盤面に居れば、そちらが講師の机番号を取る（L-1 と同じ）。合流できなかった手置きの机は今までどおり W がいない机として下の空き机へ（確認画面に出す）', () => {
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '高橋', lesson: managed('n1', student('sB')) }, TEMPLATE[2], TEMPLATE[3]]
      const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, { teacher: '佐藤' }, replacedOnSuzuki(), { teacher: '高橋' }]), TEMPLATE, { usedDesks: used })
      expect(restored.desks[1].teacherAssignmentSource).toBeUndefined()
      expect(restored.desks[1].teacher).toBe('高橋')
      expect(teacherLeftMoves.map((move) => [move.kind, move.formerTeacherName, move.movedTeacherName, move.toDeskIndex])).toEqual([['moved', '鈴木', '高橋', 3]])
    })
    it('(2) 同じ高橋の机へ 2 つの手置きの机が合流しようとしたら、先に番号を取った机だけが合流し、残りは今までどおり下の空き机へ（別の講師の机に入って 2 行にならない）', () => {
      const used: DeskCell[] = [{ id: 'n1', teacher: '高橋', lesson: managed('n0', student('sB')) }, { id: 'n2', teacher: '佐藤' }, { id: 'n3', teacher: '' }, { id: 'n4', teacher: '' }]
      const onTanaka: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', lesson: managed('r0', student('sA')) }
      const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([onTanaka, replacedOnSuzuki(), { teacher: '佐藤' }, EMPTY]), TEMPLATE, { usedDesks: used })
      expect(restored.desks.map((desk) => desk.teacher)).toEqual(['高橋', '佐藤', '高橋', ''])
      expect(teacherLeftMoves.map((move) => [move.kind, move.fromDeskIndex, move.toDeskIndex])).toEqual([['moved', 1, 2]])
    })
    it('(1) 鈴木が新しいテンプレに居れば、高橋が居ても鈴木について行く（§9-15 のまま）', () => {
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '高橋' }, { id: 'n3', teacher: '鈴木', lesson: managed('n1', student('sB')) }, TEMPLATE[3]]
      const restored = restoreTemplateDeskOrder(cellWith([TANAKA, replacedOnSuzuki(), { teacher: '佐藤' }, EMPTY]), TEMPLATE, { usedDesks: used })
      expect(restored.desks.findIndex((desk) => desk.teacher === '高橋' && desk.lesson?.id === 'managed_r1_2026-10-07')).toBe(2)
    })
    it('(3) 鈴木も高橋も居なければ、今までどおり手置きの高橋ごと下の空き机へ（確認画面に出す）', () => {
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '佐藤' }, { id: 'n3', teacher: '' }, { id: 'n4', teacher: '' }]
      const withHand = replacedOnSuzuki({ lesson: managed('r1', student('sB'), student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) })
      const left = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, withHand, { teacher: '佐藤' }, EMPTY]), TEMPLATE, { usedDesks: used })
      expect(left.teacherLeftMoves.map((move) => [move.formerTeacherName, move.movedTeacherName])).toEqual([['鈴木', '高橋']])
    })
    it('合流先（新しいテンプレの高橋の机 3）が保留（2 行）の机 → 合流できない。今までどおり手置きの高橋ごと下の空き机へ（確認画面に出す）・保留の机は動かさない', () => {
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '佐藤' }, { id: 'n3', teacher: '高橋', lesson: managed('n1', student('sB')) }, TEMPLATE[3], { id: 'n5', teacher: '' }]
      const withHand = replacedOnSuzuki({ lesson: managed('r1', student('sB'), student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) })
      const cell = cellWith([TANAKA, withHand, { teacher: '佐藤' }, EMPTY, EMPTY])
      const lockedId = cell.desks[2].id
      const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cell, [...TEMPLATE, { id: 't5', teacher: '' }], { usedDesks: used, lockedDeskIds: new Set([lockedId]) })
      expect(restored.desks[2]).toBe(cell.desks[2])
      expect(teacherLeftMoves.map((move) => [move.kind, move.formerTeacherName, move.movedTeacherName, move.toDeskIndex])).toEqual([['moved', '鈴木', '高橋', 3]])
    })
    it('高橋がそのコマで休み（休みの机がある・§9-18＝いないもの）→ 合流しない。今までどおり下の空き机へ（確認画面に出す）', () => {
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '高橋', lesson: managed('n1', student('sB')) }, TEMPLATE[2], TEMPLATE[3]]
      const withHand = replacedOnSuzuki({ lesson: managed('r1', student('sB'), student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) })
      const { teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, withHand, { teacher: '', teacherRest: { teacher: '高橋' } }, EMPTY]), TEMPLATE, { usedDesks: used })
      expect(teacherLeftMoves.map((move) => [move.formerTeacherName, move.movedTeacherName])).toEqual([['鈴木', '高橋']])
    })
    it('隣の形（採用の記録）: 取り下げた鈴木が居なくて、採用した高橋が新しいテンプレの机 3 に居る → 高橋の机へ合流', () => {
      const adopted: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', templateTeacherDeclined: { teacher: '鈴木', adopted: { teacher: '高橋' } }, lesson: { id: 'hand', studentSlots: [student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
      const used: DeskCell[] = [TEMPLATE[0], { id: 'n2', teacher: '佐藤' }, { id: 'n3', teacher: '高橋', lesson: managed('n1', student('sB')) }, TEMPLATE[3]]
      const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([TANAKA, adopted, { teacher: '佐藤' }, EMPTY]), TEMPLATE, { usedDesks: used })
      expect(shape(restored)).toEqual(['田中|sA', '佐藤|', '高橋|sM', '|'])
      expect(teacherLeftMoves).toEqual([])
    })
  })

  it('下段の講師を採用した記録（templateTeacherDeclined）しか手がかりが無い手置き講師の机も、取り下げたテンプレの講師の新しい机へ', () => {
    const adopted: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', templateTeacherDeclined: { teacher: '佐藤', adopted: { teacher: '高橋' } }, lesson: { id: 'hand', studentSlots: [student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
    const restored = restoreTemplateDeskOrder(cellWith([TANAKA, SUZUKI, adopted, EMPTY]), TEMPLATE, { usedDesks: SWAPPED })
    expect(shape(restored)).toEqual(['高橋|sM', '鈴木|sB', '田中|sA', '|'])
  })

  it('同じ講師の足場講師の机が盤面に居れば、そちらが講師の机番号を取る（手置き講師の机は手入力だけの机と同じ扱い）', () => {
    const replaced: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual-replaced', lesson: managed('r0', student('sM', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' })) }
    // 机 1 の手置き講師の机（テンプレの授業 r0＝田中の授業）と、机 4 の田中の足場講師の机
    const restored = restoreTemplateDeskOrder(cellWith([replaced, SUZUKI, { teacher: '佐藤' }, { teacher: '田中' }]), TEMPLATE, { usedDesks: SWAPPED })
    expect(shape(restored)).toEqual(['佐藤|', '鈴木|sB', '田中|', '高橋|sM'])
  })

  it('講師の削除記録・講師の休みの机は、消した／休んだ講師の新しい机へ（記録がその講師を塞ぎ続ける）', () => {
    const tombstone: Omit<DeskCell, 'id'> = { teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted', teacherAssignmentTeacherId: '佐藤' }
    expect(shape(restoreTemplateDeskOrder(cellWith([TANAKA, SUZUKI, tombstone, EMPTY]), TEMPLATE, { usedDesks: SWAPPED }))).toEqual(['|', '鈴木|sB', '田中|sA', '|'])
    expect(restoreTemplateDeskOrder(cellWith([TANAKA, SUZUKI, tombstone, EMPTY]), TEMPLATE, { usedDesks: SWAPPED }).desks[0].teacherAssignmentSource).toBe('deleted')
    const rest: Omit<DeskCell, 'id'> = { teacher: '', teacherRest: { teacher: '佐藤' } }
    expect(restoreTemplateDeskOrder(cellWith([TANAKA, SUZUKI, rest, EMPTY]), TEMPLATE, { usedDesks: SWAPPED }).desks[0].teacherRest).toEqual({ teacher: '佐藤' })
  })

  it('講師の手がかりの無い机（埋め草「講師未割当」のテンプレの授業）は従来どおり保存前のテンプレの机番号（授業 ID）', () => {
    const template: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 't3', teacher: '講師未割当', lesson: managed('r2', student('sC')) }, { id: 't4', teacher: '' }]
    const placeholder: Omit<DeskCell, 'id'> = { teacher: '講師未割当', lesson: managed('r2', student('sC')) }
    const used: DeskCell[] = [{ id: 'n1', teacher: '鈴木', lesson: managed('n0', student('sB')) }, { id: 'n2', teacher: '田中', lesson: managed('n1', student('sA')) }, template[2], template[3]]
    const restored = restoreTemplateDeskOrder(cellWith([placeholder, TANAKA, SUZUKI, EMPTY]), template, { usedDesks: used })
    expect(shape(restored)).toEqual(['鈴木|sB', '田中|sA', '講師未割当|sC', '|'])
  })

  it('講師の机が動かず、講師がいなくなった机の手入力だけを下の机へ移すとき、手入力だけの机はテンプレが使う番号でも今の番号のまま（v1.5.715 と同じ）', () => {
    const manualOnly: Omit<DeskCell, 'id'> = { teacher: '高橋', manualTeacher: true, teacherAssignmentSource: 'manual', lesson: { id: 'hand2', studentSlots: [student('sX', { lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null] } }
    // 新しいテンプレ: 佐藤を外して机 3 は講師だけの中村。机 1 に講師だけの渡辺（手入力だけの机が居る番号）
    const used: DeskCell[] = [{ id: 'n1', teacher: '渡辺' }, TEMPLATE[1], { id: 'n3', teacher: '中村' }, { id: 'n4', teacher: '' }, { id: 'n5', teacher: '' }]
    const template: DeskCell[] = [{ id: 't0', teacher: '' }, TEMPLATE[1], { id: 't3', teacher: '佐藤' }, { id: 't4', teacher: '' }, { id: 't5', teacher: '' }]
    const { cell: restored, teacherLeftMoves } = restoreTemplateDeskOrderWithMoves(cellWith([manualOnly, SUZUKI, SATO_MANUAL_STUDENTS, EMPTY, EMPTY]), template, { usedDesks: used })
    expect(shape(restored)).toEqual(['高橋|sX', '鈴木|sB', '|', '佐藤|sM,sD', '|'])
    expect(teacherLeftMoves.map((move) => [move.fromDeskIndex, move.toDeskIndex])).toEqual([[2, 3]])
  })

  it('講師がいなくなった机が既にテンプレの使わない一番若い番号にあれば動かさない（移した机も返さない）', () => {
    const used: DeskCell[] = [TEMPLATE[0], TEMPLATE[1], { id: 'n3', teacher: '' }, { id: 'n4', teacher: '' }]
    const cell = cellWith([TANAKA, SUZUKI, SATO_MANUAL_STUDENTS, EMPTY])
    const result = restoreTemplateDeskOrderWithMoves(cell, TEMPLATE, { usedDesks: used })
    expect(result.cell).toBe(cell)
    expect(result.teacherLeftMoves).toEqual([])
  })
})
