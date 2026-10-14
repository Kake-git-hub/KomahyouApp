// Q39（オーナー案 2026-10-14・Issue #75）: テンプレで変えたコマだけ突き合わせるための純関数のテスト。
import { describe, expect, it } from 'vitest'
import { createRegularLessonTemplate, type RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import {
  buildTemplateDefinitionDiffLines,
  buildTemplateSlotKey,
  describeTemplateDiffScope,
  diffTemplateDefinitions,
  formatTemplateDefinitionDeskDiff,
  formatTemplateSlotLabel,
  isCellInTemplateDiffScope,
  isTemplateEffectiveStartDateInPast,
  resolveDayOfWeekFromDateKey,
  resolveDefaultTemplateDiffApplyScope,
  resolveDefaultTemplateEffectiveStartDate,
  resolveNextMondayDateKey,
  resolveTemplateDiffSlotFilter,
} from './templateDefinitionDiff'

function template(deskCount = 3): RegularLessonTemplate {
  return { ...createRegularLessonTemplate(deskCount, '2026-10-05'), savedAt: '2026-10-01T00:00:00.000Z' }
}

function setDesk(source: RegularLessonTemplate, dayOfWeek: number, slotNumber: number, deskIndex: number, update: { teacherId?: string; student1?: { studentId: string; subject: string; note?: string } | null; student2?: { studentId: string; subject: string; note?: string } | null }): RegularLessonTemplate {
  return {
    ...source,
    cells: source.cells.map((cell) => (cell.dayOfWeek !== dayOfWeek || cell.slotNumber !== slotNumber ? cell : {
      ...cell,
      desks: cell.desks.map((desk) => (desk.deskIndex !== deskIndex ? desk : {
        ...desk,
        teacherId: update.teacherId ?? desk.teacherId,
        students: [
          update.student1 === undefined ? desk.students[0] : (update.student1 as RegularLessonTemplate['cells'][number]['desks'][number]['students'][0]),
          update.student2 === undefined ? desk.students[1] : (update.student2 as RegularLessonTemplate['cells'][number]['desks'][number]['students'][1]),
        ],
      })),
    })),
  }
}

const resolvers = { studentName: (id: string) => ({ sA: '山田', sB: '佐藤' }[id] ?? ''), teacherName: (id: string) => ({ t1: '田中', t2: '鈴木' }[id] ?? '') }

describe('diffTemplateDefinitions（Q39-1・Q39-2）', () => {
  it('比べる前回が無ければ全コマ（no-previous）', () => {
    const diff = diffTemplateDefinitions(null, template())
    expect(diff).toEqual({ allSlots: true, reason: 'no-previous', changedSlotKeys: [], changedDesks: [] })
  })

  it('中身が同じなら変えたコマは 0（savedAt・反映日の違いは見ない）', () => {
    const prev = template()
    const next = { ...template(), effectiveStartDate: '2026-11-02', savedAt: 'later' }
    expect(diffTemplateDefinitions(prev, next)).toEqual({ allSlots: false, changedSlotKeys: [], changedDesks: [] })
  })

  it('1 つの机の生徒を外すと、そのコマだけが変わった扱い（机の中身も返る）', () => {
    const prev = setDesk(template(), 1, 5, 3, { teacherId: 't1', student1: { studentId: 'sA', subject: '数' } })
    const next = setDesk(prev, 1, 5, 3, { student1: null })
    const diff = diffTemplateDefinitions(prev, next)
    expect(diff.allSlots).toBe(false)
    expect(diff.changedSlotKeys).toEqual([buildTemplateSlotKey(1, 5)])
    expect(diff.changedDesks).toHaveLength(1)
    const desk = diff.changedDesks[0]
    expect(desk).toMatchObject({ dayOfWeek: 1, slotNumber: 5, deskIndex: 3, teacherChanged: false })
    expect(desk.seats[0]).toMatchObject({ seat: 0, changed: true, after: null })
    expect(desk.seats[0].before).toEqual({ studentId: 'sA', subject: '数' })
    expect(desk.seats[1].changed).toBe(false)
    expect(formatTemplateDefinitionDeskDiff(desk, resolvers)).toBe('月 5限 机 3: 生徒1 山田（数） → なし')
  })

  it('講師だけ・科目だけ・備考だけ・生徒 2 だけの違いも「変わった」に数える', () => {
    const base = setDesk(template(), 3, 2, 1, { teacherId: 't1', student1: { studentId: 'sA', subject: '数' } })
    expect(diffTemplateDefinitions(base, setDesk(base, 3, 2, 1, { teacherId: 't2' })).changedDesks[0]).toMatchObject({ teacherChanged: true, teacherBefore: 't1', teacherAfter: 't2' })
    expect(diffTemplateDefinitions(base, setDesk(base, 3, 2, 1, { student1: { studentId: 'sA', subject: '英' } })).changedSlotKeys).toEqual([buildTemplateSlotKey(3, 2)])
    expect(diffTemplateDefinitions(base, setDesk(base, 3, 2, 1, { student1: { studentId: 'sA', subject: '数', note: '90分' } })).changedSlotKeys).toEqual([buildTemplateSlotKey(3, 2)])
    const withSecond = setDesk(base, 3, 2, 1, { student2: { studentId: 'sB', subject: '国' } })
    expect(formatTemplateDefinitionDeskDiff(diffTemplateDefinitions(base, withSecond).changedDesks[0], resolvers)).toBe('水 2限 机 1: 生徒2 なし → 佐藤（国）')
    const both = setDesk(base, 3, 2, 1, { teacherId: 't2', student2: { studentId: 'sB', subject: '国' } })
    expect(formatTemplateDefinitionDeskDiff(diffTemplateDefinitions(base, both).changedDesks[0], resolvers)).toBe('水 2限 机 1: 講師 田中 → 鈴木／生徒2 なし → 佐藤（国）')
  })

  it('変えたコマは月→日・時限の順に並び、変更点一覧は上限を超えると「…他 n 机」で切る', () => {
    const prev = template()
    let next = setDesk(prev, 0, 3, 1, { teacherId: 't1' })
    next = setDesk(next, 1, 5, 1, { teacherId: 't1' })
    next = setDesk(next, 1, 2, 2, { teacherId: 't2' })
    const diff = diffTemplateDefinitions(prev, next)
    expect(diff.changedSlotKeys).toEqual([buildTemplateSlotKey(1, 2), buildTemplateSlotKey(1, 5), buildTemplateSlotKey(0, 3)])
    expect(buildTemplateDefinitionDiffLines(diff, resolvers, 2)).toEqual(['月 2限 机 2: 講師 なし → 鈴木', '月 5限 机 1: 講師 なし → 田中', '…他 1 机'])
  })

  it('机の数が違えば全コマ（desk-count）。片方が机を持たない旧データは空として比べる', () => {
    expect(diffTemplateDefinitions(template(2), template(3))).toMatchObject({ allSlots: true, reason: 'desk-count' })
    const prev = template()
    const next = { ...template(), cells: template().cells.filter((cell) => cell.dayOfWeek !== 0) }
    expect(diffTemplateDefinitions(prev, next).changedSlotKeys).toEqual([])
  })
})

describe('isCellInTemplateDiffScope（Q39-1・Q39-2）', () => {
  it('絞り込みが無ければ常に対象。あれば曜日×時限が一致するセルだけ', () => {
    expect(resolveDayOfWeekFromDateKey('2026-10-07')).toBe(3)
    expect(isCellInTemplateDiffScope({ dateKey: '2026-10-07', slotNumber: 5 }, undefined)).toBe(true)
    const filter = { slotKeys: new Set([buildTemplateSlotKey(3, 5)]) }
    expect(isCellInTemplateDiffScope({ dateKey: '2026-10-07', slotNumber: 5 }, filter)).toBe(true)
    expect(isCellInTemplateDiffScope({ dateKey: '2026-10-14', slotNumber: 5 }, filter)).toBe(true)
    expect(isCellInTemplateDiffScope({ dateKey: '2026-10-07', slotNumber: 4 }, filter)).toBe(false)
    expect(isCellInTemplateDiffScope({ dateKey: '2026-10-08', slotNumber: 5 }, filter)).toBe(false)
  })

  it('fullBeforeDate より前の日は全コマ対象（前回テンプレの反映日より前の期間）', () => {
    const filter = { slotKeys: new Set([buildTemplateSlotKey(3, 5)]), fullBeforeDate: '2026-10-12' }
    expect(isCellInTemplateDiffScope({ dateKey: '2026-10-08', slotNumber: 1 }, filter)).toBe(true)
    expect(isCellInTemplateDiffScope({ dateKey: '2026-10-12', slotNumber: 1 }, filter)).toBe(false)
  })
})

describe('範囲の既定と絞り込み（Q39-3）', () => {
  const prev = setDesk(template(), 1, 5, 3, { teacherId: 't1', student1: { studentId: 'sA', subject: '数' } })
  const next = setDesk(prev, 1, 5, 3, { student1: null })

  it('変えたコマがあれば「変えたコマだけ」が既定、絞り込みに前回の反映日が付く', () => {
    const diff = diffTemplateDefinitions(prev, next)
    expect(resolveDefaultTemplateDiffApplyScope(diff)).toBe('changed-slots')
    const filter = resolveTemplateDiffSlotFilter({ diff, scope: 'changed-slots', previousEffectiveStartDate: prev.effectiveStartDate })
    expect(filter).toEqual({ slotKeys: new Set([buildTemplateSlotKey(1, 5)]), fullBeforeDate: '2026-10-05' })
    expect(describeTemplateDiffScope(diff, 'changed-slots')).toEqual({ scope: 'changed-slots', slotLabels: ['月 5限'] })
    expect(describeTemplateDiffScope(diff, 'all')).toEqual({ scope: 'all', reason: 'user' })
    expect(resolveTemplateDiffSlotFilter({ diff, scope: 'all', previousEffectiveStartDate: prev.effectiveStartDate })).toBeUndefined()
  })

  it('変えたコマが 0・前回が無い・机の数が違うときは「すべて」で絞り込みも無し', () => {
    const unchanged = diffTemplateDefinitions(prev, prev)
    expect(resolveDefaultTemplateDiffApplyScope(unchanged)).toBe('all')
    expect(resolveTemplateDiffSlotFilter({ diff: unchanged, scope: 'changed-slots', previousEffectiveStartDate: '2026-10-05' })).toBeUndefined()
    expect(describeTemplateDiffScope(unchanged, 'changed-slots')).toEqual({ scope: 'all', reason: 'no-change' })
    const first = diffTemplateDefinitions(null, next)
    expect(resolveDefaultTemplateDiffApplyScope(first)).toBe('all')
    expect(describeTemplateDiffScope(first, 'changed-slots')).toEqual({ scope: 'all', reason: 'no-previous' })
    expect(describeTemplateDiffScope(diffTemplateDefinitions(template(2), template(3)), 'changed-slots')).toEqual({ scope: 'all', reason: 'desk-count' })
  })
})

describe('反映開始日の既定と過去日（Q39-5）', () => {
  it('来週の月曜: 水曜なら次の月曜、月曜なら翌週の月曜、日曜なら翌日', () => {
    expect(resolveNextMondayDateKey('2026-10-14')).toBe('2026-10-19')
    expect(resolveNextMondayDateKey('2026-10-19')).toBe('2026-10-26')
    expect(resolveNextMondayDateKey('2026-10-18')).toBe('2026-10-19')
  })

  it('保存済みテンプレの反映日が来週の月曜より先ならその日を据え置き、過去なら来週の月曜', () => {
    expect(resolveDefaultTemplateEffectiveStartDate({ todayKey: '2026-10-14', savedEffectiveStartDate: '2026-11-02' })).toBe('2026-11-02')
    expect(resolveDefaultTemplateEffectiveStartDate({ todayKey: '2026-10-14', savedEffectiveStartDate: '2026-09-01' })).toBe('2026-10-19')
    expect(resolveDefaultTemplateEffectiveStartDate({ todayKey: '2026-10-14', savedEffectiveStartDate: null })).toBe('2026-10-19')
  })

  it('過去日の判定と表示ラベル', () => {
    expect(isTemplateEffectiveStartDateInPast('2026-10-13', '2026-10-14')).toBe(true)
    expect(isTemplateEffectiveStartDateInPast('2026-10-14', '2026-10-14')).toBe(false)
    expect(isTemplateEffectiveStartDateInPast('', '2026-10-14')).toBe(false)
    expect(formatTemplateSlotLabel(6, 1)).toBe('土 1限')
  })
})
