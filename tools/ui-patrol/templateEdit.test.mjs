// tools/ui-patrol/templateEdit.ts(台本 d「テンプレを実際に変えて保存」の候補選び)を固定する。
// フィクスチャはこのファイル内の架空データだけ(生徒A〜D・講師A〜C)。盤面の事実は boardFacts.ts で作る(台本と同じ入り口)。
import { describe, it, expect } from 'vitest'
import { collectBoardFacts } from './boardFacts.ts'
import {
  TEMPLATE_EDIT_KINDS, buildTemplateEditorDesks, collectCellPresence, findTemplateDeskAnchorCells, pickTemplateEditOption, pickTemplateEditTarget,
} from './templateEdit.ts'
import { createSeededRandom } from './scenarios.mjs'

const TODAY = '2026-11-11'
const FROM = '2026-11-16'
const teachers = [
  { id: 't1', name: '講師A', displayName: '講師A', entryDate: '', withdrawDate: '', memo: '' },
  { id: 't2', name: '講師B', displayName: '講師B', entryDate: '', withdrawDate: '', memo: '' },
  { id: 't3', name: '講師C', displayName: '講師C', entryDate: '', withdrawDate: '', memo: '' },
]
const roster = ['sA', 'sB', 'sC', 'sD'].map((id) => ({ id, name: `生徒${id}`, displayName: `生徒${id}`, entryDate: '', withdrawDate: '', birthDate: '2012-05-01', email: '', memo: '' }))

function tplDesk(deskIndex, teacherId, studentIds = []) {
  return { deskIndex, teacherId, students: [0, 1].map((seat) => (studentIds[seat] ? { studentId: studentIds[seat], subject: '数', note: '' } : null)) }
}

/** テンプレ: 火曜(2) 1限 = 机1 講師A(生徒A・空き)・机2 講師B(生徒B・生徒C)。水曜(3) 1限 = 机1 講師C(空き)。日曜は定休日。 */
function template() {
  return {
    version: 1, effectiveStartDate: FROM, savedAt: '',
    cells: [
      { dayOfWeek: 2, slotNumber: 1, desks: [tplDesk(1, 't1', ['sA']), tplDesk(2, 't2', ['sB', 'sC'])] },
      { dayOfWeek: 3, slotNumber: 1, desks: [tplDesk(1, 't3')] },
      { dayOfWeek: 0, slotNumber: 1, desks: [tplDesk(1, 't1', ['sD'])] },
    ],
  }
}

function boardStudent(id, key, origin = 'template', overrides = {}) {
  return { id, name: `生徒${key}`, managedStudentId: key, grade: '中1', subject: '数', lessonType: 'regular', teacherType: 'normal', ...(origin ? { origin } : {}), ...overrides }
}
function boardDesk(id, teacher, slots = [null, null], overrides = {}) {
  return { id, teacher, lesson: { id: `L-${id}`, studentSlots: slots }, ...overrides }
}
function cell(dateKey, slotNumber, desks) {
  return { id: `${dateKey}_${slotNumber}`, dateKey, dayLabel: '', dateLabel: '', slotLabel: '', slotNumber, timeLabel: '', isOpenDay: true, desks }
}

/** 盤面: 11/17・11/24(火) 1限にテンプレどおりの机。11/10(反映日より前)にも同じ形。11/18(水) 1限に講師C。 */
function board(extraCells = []) {
  const tuesday = (dateKey) => cell(dateKey, 1, [
    boardDesk(`${dateKey}-0`, '講師A', [boardStudent(`${dateKey}-a`, 'sA'), null]),
    boardDesk(`${dateKey}-1`, '講師B', [boardStudent(`${dateKey}-b`, 'sB'), boardStudent(`${dateKey}-c`, 'sC')]),
    boardDesk(`${dateKey}-2`, ''),
  ])
  return [tuesday('2026-11-10'), tuesday('2026-11-17'), tuesday('2026-11-24'), cell('2026-11-18', 1, [boardDesk('w0', '講師C'), boardDesk('w1', '')]), ...extraCells]
}

function payloadOf(cells, settings = {}) {
  return {
    classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 3, regularLessonTemplate: template(), ...settings },
    managers: [], teachers, students: roster, regularLessons: [], groupLessons: [], specialSessions: [], autoAssignRules: [], pairConstraints: [],
    boardState: { weeks: [cells], weekIndex: 0 },
  }
}

describe('buildTemplateEditorDesks', () => {
  it('テンプレ作成の画面と同じ机(template_{曜日}_{時限}・机は 0 始まり・講師は表示名)。定休日の曜日は出さない', () => {
    const desks = buildTemplateEditorDesks(payloadOf(board()), TODAY)
    expect(desks.some((desk) => desk.dayOfWeek === 0)).toBe(false)
    const tuesday = desks.filter((desk) => desk.cellId === 'template_2_1')
    expect(tuesday).toHaveLength(3)
    expect(tuesday[0]).toMatchObject({ deskIndex: 0, teacherId: 't1', teacher: '講師A', dayOfWeek: 2, slotNumber: 1 })
    expect(tuesday[0].students).toEqual([{ studentId: 'sA', subject: '数' }, null])
    expect(tuesday[2]).toMatchObject({ deskIndex: 2, teacherId: '', teacher: '' })
    expect(buildTemplateEditorDesks(payloadOf(board(), { regularLessonTemplate: undefined }), TODAY)).toEqual([])
  })

  it('退塾した講師・生徒は画面と同じく外れる(在籍の絞り込み)', () => {
    const payload = payloadOf(board())
    payload.teachers = teachers.map((teacher) => (teacher.id === 't2' ? { ...teacher, withdrawDate: '2026-10-31' } : teacher))
    const tuesday = buildTemplateEditorDesks(payload, TODAY).filter((desk) => desk.cellId === 'template_2_1')
    expect(tuesday[1]).toMatchObject({ teacherId: '', teacher: '' })
  })
})

describe('findTemplateDeskAnchorCells', () => {
  it('反映日以降・同じ曜日と時限で、その講師がテンプレ由来で座っているコマだけ(反映日より前・手置きの講師は入れない)', () => {
    const extra = cell('2026-12-01', 1, [boardDesk('m0', '講師A', [null, null], { manualTeacher: true, teacherAssignmentSource: 'manual' })])
    const facts = collectBoardFacts(payloadOf(board([extra])))
    const anchors = findTemplateDeskAnchorCells(facts, { dayOfWeek: 2, slotNumber: 1, fromDateKey: FROM, teacher: '講師A' })
    expect(anchors.map((anchor) => anchor.cellId)).toEqual(['2026-11-17_1', '2026-11-24_1'])
    expect(anchors[0].deskKey).toBe('2026-11-17_1#0')
    expect(findTemplateDeskAnchorCells(facts, { dayOfWeek: 2, slotNumber: 1, fromDateKey: FROM, teacher: '' })).toEqual([])
  })
})

describe('pickTemplateEditTarget', () => {
  it('3 種類とも選べる・同じ種なら同じ結果・使ったコマは外せる', () => {
    const payload = payloadOf(board())
    const desks = buildTemplateEditorDesks(payload, TODAY)
    const facts = collectBoardFacts(payload)
    for (const kind of TEMPLATE_EDIT_KINDS) {
      const picked = pickTemplateEditTarget({ kind, desks, facts, fromDateKey: FROM, random: createSeededRandom(1) })
      expect(picked.skip).toBeUndefined()
      expect(picked.anchorCellIds.length).toBeGreaterThan(0)
      expect(pickTemplateEditTarget({ kind, desks, facts, fromDateKey: FROM, random: createSeededRandom(1) })).toEqual(picked)
    }
    const add = pickTemplateEditTarget({ kind: 'add-student', desks, facts, fromDateKey: FROM, random: createSeededRandom(1) })
    // 空いた席のある講師の机: 火 1限 机1(講師A・席2) か 水 1限 机1(講師C)
    expect(['template_2_1#0', 'template_3_1#0']).toContain(`${add.desk.cellId}#${add.desk.deskIndex}`)
    expect(add.desk.students[add.seat]).toBeNull()
    const other = pickTemplateEditTarget({ kind: 'add-student', desks, facts, fromDateKey: FROM, random: createSeededRandom(1), excludeCellIds: new Set([add.desk.cellId]) })
    expect(other.desk.cellId).not.toBe(add.desk.cellId)
  })

  it('講師を替える・机を消すは、生徒のいる講師の机だけ(講師だけの机・講師のいない机は選ばない)', () => {
    const payload = payloadOf(board())
    const desks = buildTemplateEditorDesks(payload, TODAY)
    const facts = collectBoardFacts(payload)
    for (const kind of ['change-teacher', 'delete-desk']) {
      for (let seed = 1; seed <= 8; seed += 1) {
        const picked = pickTemplateEditTarget({ kind, desks, facts, fromDateKey: FROM, random: createSeededRandom(seed) })
        expect(picked.desk.cellId).toBe('template_2_1')
        expect(picked.desk.teacher).not.toBe('')
        expect(picked.desk.students.some(Boolean)).toBe(true)
      }
    }
  })

  it('盤面のその机に手入力(手入力の生徒・出欠記録・メモ)がある日が 1 つでもあれば選ばない(規則で動く形を避ける)', () => {
    const cells = board()
    const target = cells.find((item) => item.id === '2026-11-24_1')
    target.desks[0].memoSlots = [null, 'メモ']
    target.desks[1].lesson.studentSlots[1] = boardStudent('m1', 'sD', 'manual', { lessonType: 'makeup', makeupSourceDate: '2026-11-03' })
    const payload = payloadOf(cells)
    const desks = buildTemplateEditorDesks(payload, TODAY)
    const facts = collectBoardFacts(payload)
    for (const kind of TEMPLATE_EDIT_KINDS) {
      const picked = pickTemplateEditTarget({ kind, desks, facts, fromDateKey: FROM, random: createSeededRandom(3) })
      if (kind === 'add-student') expect(picked.desk.cellId).toBe('template_3_1')
      else expect(picked.skip).toMatch(/候補/)
    }
  })

  it('確かめる日(盤面に前の版のその机が当たっているコマ)が無ければ選ばない → 飛ばす理由を返す', () => {
    const payload = payloadOf([])
    const picked = pickTemplateEditTarget({ kind: 'add-student', desks: buildTemplateEditorDesks(payload, TODAY), facts: collectBoardFacts(payload), fromDateKey: FROM, random: createSeededRandom(1) })
    expect(picked.skip).toMatch(/候補/)
  })
})

describe('pickTemplateEditOption・collectCellPresence', () => {
  const options = [{ value: '', label: '生徒なし' }, { value: 'sA', label: 'A' }, { value: 'sB', label: 'B' }, { value: 'sC', label: 'C' }, { value: 'sD', label: 'D' }]
  it('空と除くものは選ばない・望ましいものがあればその中から・無ければ残りから・同じ種なら同じ', () => {
    const pick = (seed, prefer = () => true, exclude = []) => pickTemplateEditOption({ options, exclude: new Set(exclude), prefer, random: createSeededRandom(seed) })
    for (let seed = 1; seed <= 10; seed += 1) {
      expect(['sB', 'sC', 'sD']).toContain(pick(seed, () => true, ['sA']))
      expect(pick(seed, (value) => value === 'sD')).toBe('sD')
      expect(['sA', 'sB']).toContain(pick(seed, () => false, ['sC', 'sD']))
      expect(pick(seed)).toBe(pick(seed))
    }
    expect(pickTemplateEditOption({ options: [{ value: '', label: '' }], exclude: new Set(), prefer: () => true, random: createSeededRandom(1) })).toBeNull()
    // requirePreferred: 望ましいもの(講師を替える＝そのコマに居ない講師)が無ければ残りから選ばず null(既に居る講師に替えると点検が素通りするため)
    expect(pickTemplateEditOption({ options, exclude: new Set(), prefer: () => false, random: createSeededRandom(1), requirePreferred: true })).toBeNull()
    expect(pickTemplateEditOption({ options, exclude: new Set(), prefer: (value) => value === 'sC', random: createSeededRandom(1), requirePreferred: true })).toBe('sC')
  })

  it('コマに居る生徒(上段・下段・出欠記録)と講師(講師欄・下段・休み)を集める', () => {
    const cells = board()
    const target = cells.find((item) => item.id === '2026-11-17_1')
    target.desks[2].statusSlots = [{ id: 'st', studentId: 'x', name: '生徒sD', managedStudentId: 'sD', subject: '数', lessonType: 'regular', status: 'absent', dateKey: '2026-11-17', slotNumber: 1 }, null]
    target.desks[2].teacherRest = { teacher: '講師C', teacherId: 't3', origin: 'manual' }
    const presence = collectCellPresence(collectBoardFacts(payloadOf(cells)), ['2026-11-17_1'])
    expect([...presence.studentKeys].sort()).toEqual(['sA', 'sB', 'sC', 'sD'])
    expect([...presence.teachers].sort()).toEqual(['講師A', '講師B', '講師C'])
  })
})
