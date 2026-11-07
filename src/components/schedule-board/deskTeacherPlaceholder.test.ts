// 講師の居ない机の埋め草「講師未割当」を講師として扱わない（オーナー指示 2026-11-07「直して」・確認リスト tp-72 の準備の結果）。
//
// テンプレの通常授業で講師が決まっていない行は、再マージが机の teacher に「講師未割当」という埋め草を入れる（deskTeacherLabel.ts）。
// 生徒を動かしてその机が 0 人になると、v1.5.349 の「空いた机の講師名を残す（manual 固定）」が埋め草まで手置きの講師として固定していた。
// その後のテンプレ保存のたびに「講師 講師未割当: 同じコマの机 n に手で置いた同じ講師が先にある…」の行が詳細に出続けた
// （§2-3 講師の一意が埋め草を講師として数えた）。INV-02（手動編集＝手置きの講師の判定）・INV-01（講師の一意）。
// ★埋め草の判定は isDeskTeacherPlaceholder（utils/deskTeacherLabel.ts）1 か所。各所で文字列を比べ直さない。
import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import {
  buildManagedScheduleCellsForRange,
  computeStudentMove,
  computeTeacherMove,
  computeTemplateDiffApplyForBoard,
  reconcileSubmittedTeacherPlacements,
  remergeBoardWeeksWithManagedData,
} from './ScheduleBoardScreen'
import type { SpecialSessionRow } from '../special-data/specialSessionModel'
import { isManualOriginDeskTeacher, resolveDeskTeacherOrigin } from './placementOrigin'
import { restDeskTeacher } from './teacherRest'
import { collectOverwriteReportRows } from '../../utils/pdf'
import { buildTeacherPayload } from '../../utils/scheduleHtml'
import { buildTeacherSheetViewModel } from '../../utils/scheduleViewData'
import { hasRealDeskTeacher, isPinnedPlaceholderTeacherDesk } from '../../utils/deskTeacherLabel'

const PLACEHOLDER = '講師未割当'
const WEEK_START = '2026-10-05'
const WEEK_END = '2026-10-11'
const DATE = '2026-10-07'
const SLOT = 5
const CELL_ID = `${DATE}_${SLOT}`
const TODAY_KEY = '2026-10-01'

const studentRow = (id: string, name: string): StudentRow => ({ id, name, displayName: name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' })
const teacherRow = (id: string, name: string): TeacherRow => ({ id, name, email: `${id}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }] })
const students = [studentRow('sC', '千葉'), studentRow('sX', '山田')]
const teachers = [teacherRow('tB', '倉島')]
const row = (id: string, teacherId: string, student1Id = ''): RegularLessonRow => ({
  id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id: '', subject2: '',
  student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: SLOT,
})
/** 講師の居ない行が 2 本（机 0＝千葉・机 1＝山田）。 */
const ROWS = [row('r0', '', 'sC'), row('r1', '', 'sX')]
const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2, ...extra }) as ClassroomSettings

function buildWeek(rows: RegularLessonRow[]) {
  return buildManagedScheduleCellsForRange({ range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' }, fallbackStartDate: WEEK_START, fallbackEndDate: WEEK_END, classroomSettings: settings(), teachers, students, regularLessons: rows, boardWeeks: [] })
}
const cellOf = (week: SlotCell[], id = CELL_ID) => week.find((cell) => cell.id === id)!

describe('埋め草「講師未割当」の判定（権威 1 か所: utils/deskTeacherLabel.ts）', () => {
  it('hasRealDeskTeacher: 埋め草と空は講師なし。ふつうの講師名は講師あり', () => {
    expect(hasRealDeskTeacher(PLACEHOLDER)).toBe(false)
    expect(hasRealDeskTeacher(' 講師未設定 ')).toBe(false)
    expect(hasRealDeskTeacher('')).toBe(false)
    expect(hasRealDeskTeacher(undefined)).toBe(false)
    expect(hasRealDeskTeacher('倉島')).toBe(true)
    expect(hasRealDeskTeacher('講師未割当2')).toBe(true)
  })
  it('isPinnedPlaceholderTeacherDesk: 埋め草を手置きの印で固定した机だけ真（本物の手置き講師・印の無い埋め草・削除記録は偽）', () => {
    expect(isPinnedPlaceholderTeacherDesk({ teacher: PLACEHOLDER, manualTeacher: true })).toBe(true)
    expect(isPinnedPlaceholderTeacherDesk({ teacher: PLACEHOLDER, teacherAssignmentSource: 'manual' })).toBe(true)
    expect(isPinnedPlaceholderTeacherDesk({ teacher: PLACEHOLDER })).toBe(false)
    expect(isPinnedPlaceholderTeacherDesk({ teacher: '倉島', manualTeacher: true })).toBe(false)
    expect(isPinnedPlaceholderTeacherDesk({ teacher: '', manualTeacher: true, teacherAssignmentSource: 'deleted' })).toBe(false)
  })
})

describe('出自の印（placementOrigin.ts）: 埋め草は手入力の講師にならない', () => {
  it('手置きの印で固定された埋め草は「講師なし」。印の無い埋め草はテンプレ（従来どおり）。本物の手置き講師は手入力（従来どおり）', () => {
    expect(resolveDeskTeacherOrigin({ teacher: PLACEHOLDER, manualTeacher: true })).toBeNull()
    expect(resolveDeskTeacherOrigin({ teacher: PLACEHOLDER, manualTeacher: false, teacherAssignmentSource: 'manual' })).toBeNull()
    expect(isManualOriginDeskTeacher({ teacher: PLACEHOLDER, manualTeacher: true })).toBe(false)
    expect(resolveDeskTeacherOrigin({ teacher: PLACEHOLDER })).toBe('template')
    expect(resolveDeskTeacherOrigin({ teacher: '倉島', manualTeacher: true })).toBe('manual')
  })
})

describe('作る側: 生徒を動かして空いた机の埋め草を手置きの講師に固定しない（v1.5.349 のガードは本物の講師だけ）', () => {
  it('講師の居ない行の机から生徒を別の日へ動かす → 空いた机の manualTeacher は立たない（本物の講師の机は従来どおり固定＝ScheduleBoardScreen.test の v1.5.349 行）', () => {
    const week = buildWeek(ROWS)
    const cell = cellOf(week)
    expect(cell.desks.map((desk) => desk.teacher)).toEqual([PLACEHOLDER, PLACEHOLDER])
    const moving = cell.desks[1].lesson!.studentSlots[0]!
    for (const templateOriginRules of [false, true]) {
      const moved = computeStudentMove({
        weeks: [week], weekIndex: 0, cells: week, movingStudentId: moving.id, cellId: '2026-10-08_5', deskIndex: 0, studentIndex: 0,
        suppressedRegularLessonOccurrences: [], managedStudentByAnyName: new Map(students.map((student) => [student.name, student])),
        resolveBoardStudentDisplayName: (name) => name, templateOriginRules,
      })
      expect(moved.status).toBe('moved')
      if (moved.status !== 'moved') return
      const emptied = cellOf(moved.nextWeeks[0]).desks[1]
      expect(emptied.lesson).toBeUndefined()
      expect(Boolean(emptied.manualTeacher)).toBe(false)
      expect(isManualOriginDeskTeacher(emptied)).toBe(false)
    }
  })
})

describe('再マージ: 既に保存された「固定された埋め草」の空き机は講師なしの机として扱う（手作業の修復なしで消える）', () => {
  it('授業・出欠記録の無い机の固定された埋め草は手置きの印が外れる。2 回目の再マージで変わらない（INV-03）。本物の手置き講師の空き机は残る（INV-02）', () => {
    const base = buildWeek(ROWS)
    const legacy = base.map((cell) => (cell.id !== CELL_ID ? cell : {
      ...cell,
      desks: [
        cell.desks[0],
        { ...cell.desks[1], teacher: PLACEHOLDER, manualTeacher: true, lesson: undefined },
      ],
    }))
    const suppressed = [`sX__数__${DATE}__${SLOT}`]
    const remerge = (weeks: SlotCell[][], templateOriginRules: boolean) => remergeBoardWeeksWithManagedData(weeks, { classroomSettings: settings(), teachers, students, regularLessons: ROWS, suppressedRegularLessonOccurrences: suppressed, todayKey: TODAY_KEY, templateOriginRules: templateOriginRules ? { pendingDesks: {} } : null })
    for (const templateOriginRules of [false, true]) {
      const once = remerge([legacy], templateOriginRules)
      const desk1 = cellOf(once[0]).desks[1]
      expect(Boolean(desk1.manualTeacher)).toBe(false)
      expect(desk1.lesson).toBeUndefined()
      expect(cellOf(once[0]).desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sC')
      expect(remerge(once, templateOriginRules).flat().map((cell) => cell.desks)).toEqual(once.flat().map((cell) => cell.desks))
    }
    // 本物の手置き講師の空き机（生徒を動かして空いた机・v1.5.349）は再マージで消えない。
    const real = base.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: [cell.desks[0], { ...cell.desks[1], teacher: '倉島', manualTeacher: true, lesson: undefined }] }))
    const kept = cellOf(remerge([real], false)[0]).desks[1]
    expect([kept.teacher, kept.manualTeacher]).toEqual(['倉島', true])
  })
})

describe('講師の D&D（computeTeacherMove）: 埋め草を講師名として文に出さない', () => {
  const desks = (): DeskCell[] => [
    { id: `${CELL_ID}_desk_1`, teacher: '倉島', manualTeacher: true, teacherAssignmentTeacherId: 'tB', lesson: { id: 'l0', studentSlots: [{ id: 'e0', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' } as StudentEntry, null] } },
    { id: `${CELL_ID}_desk_2`, teacher: PLACEHOLDER, lesson: { id: 'l1', studentSlots: [{ id: 'e1', name: '山田', managedStudentId: 'sX', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' } as StudentEntry, null] } },
  ]
  const weeksOf = (deskList: DeskCell[]): SlotCell[][] => [[{ id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: SLOT, timeLabel: '', isOpenDay: true, desks: deskList }]]
  it('講師の居ない机へ倉島を動かす → 「講師 倉島 を 2机目へ移動しました。」（「講師未割当 と入れ替え」と出さない）', () => {
    const result = computeTeacherMove({ weeks: weeksOf(desks()), weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 0, targetDeskIndex: 1, teachers })
    expect(result.status).toBe('moved')
    expect(result.message).toBe('講師 倉島 を 2机目へ移動しました。')
    expect(result.message).not.toContain(PLACEHOLDER)
  })
  it('講師の居ない机（見た目は空欄）から倉島の机へ動かす → 倉島が講師の居ない机へ移る文（「講師 講師未割当 と 倉島」と出さない）', () => {
    const result = computeTeacherMove({ weeks: weeksOf(desks()), weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 1, targetDeskIndex: 0, teachers })
    expect(result.status).toBe('moved')
    expect(result.message).toBe('講師 倉島 を 2机目へ移動しました。')
  })
})

describe('講師の休み・テンプレ保存前レポート: 埋め草は講師として数えない', () => {
  it('restDeskTeacher: 埋め草の机は休みにできない（null）。本物の講師は従来どおり', () => {
    expect(restDeskTeacher({ id: 'd', teacher: PLACEHOLDER })).toBeNull()
    expect(restDeskTeacher({ id: 'd', teacher: PLACEHOLDER, manualTeacher: true })).toBeNull()
    expect(restDeskTeacher({ id: 'd', teacher: '倉島', manualTeacher: true })?.teacherRest?.teacher).toBe('倉島')
  })
  it('collectOverwriteReportRows: 固定された埋め草を「手入力講師」の行に出さない（本物の手置き講師は出す）', () => {
    const weeks: SlotCell[][] = [[{
      id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: SLOT, timeLabel: '', isOpenDay: true,
      desks: [{ id: 'd1', teacher: PLACEHOLDER, manualTeacher: true }, { id: 'd2', teacher: '倉島', manualTeacher: true }],
    }]]
    const rows = collectOverwriteReportRows(weeks, '2026-10-01', (name) => name)
    expect(rows.filter((item) => item.category === '手入力講師').map((item) => item.detail)).toEqual(['倉島'])
  })
})

describe('講習の講師の自動割当（QR 提出の自己修復）: 埋め草だけの空き机を「講師だけの机」に数えない', () => {
  it('2 机のコマ（机 0＝講師の居ない行の千葉・机 1＝埋め草だけの空き机）→ 満席と見なさず、提出済みの講師を机 1 へ置く', () => {
    const session = {
      id: 'sess1', label: '冬期講習', startDate: DATE, endDate: DATE,
      teacherInputs: { tB: { unavailableSlots: [], countSubmitted: true, updatedAt: '' } },
      studentInputs: {}, createdAt: '', updatedAt: '',
    } as unknown as SpecialSessionRow
    const cell: SlotCell = {
      id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: SLOT, timeLabel: '', isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: PLACEHOLDER, lesson: { id: 'managed_r0', studentSlots: [{ id: 'e0', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' } as StudentEntry, null] } },
        { id: `${CELL_ID}_desk_2`, teacher: PLACEHOLDER },
      ],
    }
    const result = reconcileSubmittedTeacherPlacements({ weeks: [[cell]], specialSessions: [session], teachers, students, regularLessons: [], classroomSettings: settings() })
    expect(result.placedCount).toBe(1)
    const desks = result.nextWeeks[0][0].desks
    expect(desks.filter((desk) => desk.teacher === '倉島')).toHaveLength(1)
    expect(desks[0].lesson?.studentSlots[0]?.managedStudentId).toBe('sC')
  })
})

// regression-reviewer 指摘 1（2026-11-07）: 埋め草の机に生徒がいるときの「生徒ごと席入替」は埋め草の修正の前からできた操作。止めない。
// 動かす中身の無い形（埋め草だけの机・講師だけ入替）だけ何もしない。
describe('講師の D&D（computeTeacherMove）: 埋め草の机でも生徒ごと席入替は中身を動かす', () => {
  const st = (id: string, name: string) => ({ id: `e_${id}`, name, managedStudentId: id, grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' } as StudentEntry)
  const weeksOf = (deskList: DeskCell[]): SlotCell[][] => [[{ id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: SLOT, timeLabel: '', isOpenDay: true, desks: deskList }]]
  const run = (deskList: DeskCell[], swapMode: 'teacher' | 'seat') => computeTeacherMove({ weeks: weeksOf(deskList), weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 0, targetDeskIndex: 1, teachers, swapMode })
  const idsOf = (desk: DeskCell) => (desk.lesson?.studentSlots ?? []).map((student) => student?.managedStudentId ?? null)

  it('埋め草＋山田の机 → 空き机へ席ごと: 山田（とメモ）が 2 机目へ移る。文に埋め草の名前を出さない', () => {
    const result = run([
      { id: 'd1', teacher: PLACEHOLDER, lesson: { id: 'l1', studentSlots: [st('sX', '山田'), null] }, memoSlots: ['持ち物', null] },
      { id: 'd2', teacher: '' },
    ], 'seat')
    expect(result.status).toBe('moved')
    if (result.status !== 'moved') return
    const [d1, d2] = result.nextWeeks[0][0].desks
    expect(idsOf(d1)).toEqual([])
    expect(idsOf(d2)).toEqual(['sX', null])
    expect(d2.memoSlots).toEqual(['持ち物', null])
    expect(result.message).not.toContain(PLACEHOLDER)
    expect(result.message).toBe('1机目の席を生徒ごと 2机目へ移動しました。')
  })

  it('埋め草＋山田 ↔ 埋め草＋千葉 を席ごと: 2 人が入れ替わる', () => {
    const result = run([
      { id: 'd1', teacher: PLACEHOLDER, lesson: { id: 'l1', studentSlots: [st('sX', '山田'), null] } },
      { id: 'd2', teacher: PLACEHOLDER, lesson: { id: 'l2', studentSlots: [st('sC', '千葉'), null] } },
    ], 'seat')
    expect(result.status).toBe('moved')
    if (result.status !== 'moved') return
    const [d1, d2] = result.nextWeeks[0][0].desks
    expect([idsOf(d1), idsOf(d2)]).toEqual([['sC', null], ['sX', null]])
    expect(result.message).toBe('1机目と 2机目の席を生徒ごと入れ替えました。')
  })

  it('動かす中身が無い形は何もしない: 埋め草だけの机 → 空き机（席ごとでも）／埋め草どうしの講師だけ入替', () => {
    expect(run([{ id: 'd1', teacher: PLACEHOLDER }, { id: 'd2', teacher: '' }], 'seat')).toEqual({ status: 'blocked', message: '移動する講師がいません。' })
    expect(run([
      { id: 'd1', teacher: PLACEHOLDER, lesson: { id: 'l1', studentSlots: [st('sX', '山田'), null] } },
      { id: 'd2', teacher: '' },
    ], 'teacher')).toEqual({ status: 'blocked', message: '移動する講師がいません。' })
  })
})

// regression-reviewer 指摘 2・4（2026-11-07）: 再マージが外すのは「中身の何も無い机」の固定された埋め草だけ。
//   - 授業のある机（講師 D&D の跡）: 外すとテンプレの講師が元の机へ戻り同じ講師が 2 机になる（INV-01）。
//   - 出欠記録だけの机・メモだけの机: 外すと空き机としてテンプレの授業の置き場になりうる（findManagedPlacementTargetDesk はメモを見ない）。
describe('再マージ: 固定された埋め草のうち外さない形（INV-01 / INV-02）', () => {
  const remerge = (weeks: SlotCell[][], rows: RegularLessonRow[], templateOriginRules: boolean, suppressed: string[] = []) => remergeBoardWeeksWithManagedData(weeks, { classroomSettings: settings(), teachers, students, regularLessons: rows, suppressedRegularLessonOccurrences: suppressed, todayKey: TODAY_KEY, templateOriginRules: templateOriginRules ? { pendingDesks: {} } : null })
  const sheet = (weeks: SlotCell[][], rows: RegularLessonRow[], teacherId: string) => {
    const payload = buildTeacherPayload({ cells: weeks.flat(), defaultStartDate: WEEK_START, defaultEndDate: WEEK_END, titleLabel: 'ph', classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [] }, teachers, students, regularLessons: rows })
    const vm = buildTeacherSheetViewModel(payload, { startDate: WEEK_START, endDate: WEEK_END, teacherId, todayKey: TODAY_KEY })
    const cell = vm?.rows.find((item) => item.slotNumber === SLOT)?.cells.find((item) => item.dateKey === DATE)
    return (cell?.people ?? []).map((person) => person.name)
  }

  it('講師 D&D の跡: テンプレの倉島（千葉の机）を講師の居ない行の机（山田）へ動かす → 千葉の机に固定された埋め草が残り、再マージ 2 回でも倉島は 1 机だけ（フラグ ON/OFF とも）', () => {
    const rows = [row('r0', 'tB', 'sC'), row('r1', '', 'sX')]
    const week = buildWeek(rows)
    expect(cellOf(week).desks.map((desk) => desk.teacher)).toEqual(['倉島', PLACEHOLDER])
    const moved = computeTeacherMove({ weeks: [week], weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 0, targetDeskIndex: 1, teachers })
    expect(moved.status).toBe('moved')
    if (moved.status !== 'moved') return
    expect([cellOf(moved.nextWeeks[0]).desks[0].teacher, cellOf(moved.nextWeeks[0]).desks[0].manualTeacher]).toEqual([PLACEHOLDER, true])
    for (const templateOriginRules of [false, true]) {
      const once = remerge(moved.nextWeeks, rows, templateOriginRules)
      const twice = remerge(once, rows, templateOriginRules)
      for (const weeks of [once, twice]) {
        const desks = cellOf(weeks[0]).desks
        expect([desks[0].teacher, desks[0].manualTeacher]).toEqual([PLACEHOLDER, true])
        expect(desks.filter((desk) => desk.teacher === '倉島')).toHaveLength(1)
        expect(sheet(weeks, rows, 'tB')).toEqual(['山田'])
      }
    }
  })

  it('出欠記録だけの机・メモだけの机の固定された埋め草は再マージで外さない（空き机としてテンプレの授業の置き場にしない）', () => {
    const base = buildWeek(ROWS)
    const suppressed = [`sX__数__${DATE}__${SLOT}`]
    const record = { ...cellOf(base).desks[1].lesson!.studentSlots[0]!, status: 'absent', dateKey: DATE, slotNumber: SLOT, recordedAt: '2026-10-07T10:00:00.000Z', teacherName: '', studentId: 'sX', sourceManagedLesson: true, sourceLessonId: 'x' }
    for (const extra of [{ statusSlots: [record, null] }, { memoSlots: ['持ち物', null] }] as Array<Partial<DeskCell>>) {
      const legacy = base.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: [cell.desks[0], { ...cell.desks[1], teacher: PLACEHOLDER, manualTeacher: true, lesson: undefined, ...extra } as DeskCell] }))
      for (const templateOriginRules of [false, true]) {
        const desk1 = cellOf(remerge([legacy], ROWS, templateOriginRules, suppressed)[0]).desks[1]
        expect([desk1.teacher, desk1.manualTeacher]).toEqual([PLACEHOLDER, true])
        expect(desk1.lesson).toBeUndefined()
      }
    }
  })

  // オーナー確定（2026-11-07「今のままで良い」・regression-reviewer 指摘 5）: 第 2 版のテンプレ保存は、講師 D&D の跡の固定された埋め草（生徒つき）を
  // 「講師なし」と読む。手で動かした本物の講師が後でそのコマから居なくなると、次のテンプレ保存でテンプレの講師が黙ってその机へ戻る
  // （埋め草の修正の前は、埋め草を手置きの講師と見て緑の 2 行で室長に選ばせていた）。この挙動をオーナーが確定した（テンプレどおり戻るのが自然・以前の緑 2 行は中身の無い「講師未割当」を手置き講師に見せていただけ）。ここで固定する。
  it('オーナー確定(2026-11-07): D&D の跡の机（千葉）× 倉島がそのコマから居なくなった後のテンプレ保存 → 千葉の机に倉島が戻る（講師欄 2 行にしない）', () => {
    const rows = [row('r0', 'tB', 'sC'), row('r1', '', 'sX')]
    const week = buildWeek(rows)
    const moved = computeTeacherMove({ weeks: [week], weekIndex: 0, cellId: CELL_ID, sourceDeskIndex: 0, targetDeskIndex: 1, teachers })
    if (moved.status !== 'moved') throw new Error('move failed')
    // 倉島を山田の机から外す（講師欄を空に・削除記録は作らない形＝別のコマへ動かした跡と同じ）
    const left = moved.nextWeeks.map((weekCells) => weekCells.map((cell) => (cell.id !== CELL_ID ? cell : { ...cell, desks: cell.desks.map((desk, index) => (index === 1 ? { ...desk, teacher: '', manualTeacher: false, teacherAssignmentSource: undefined, teacherAssignmentTeacherId: undefined } : desk)) })))
    const saved = computeTemplateDiffApplyForBoard({ weeks: left, classroomSettings: settings({ templateFreezeBeforeDate: DATE }), teachers, students, regularLessons: rows, effectiveStartDate: DATE, suppressedRegularLessonOccurrences: [], templatePendingDesks: {}, createdAt: '2026-10-07T00:00:00.000Z', manualMakeupAdjustments: {}, scheduleCountAdjustments: [] })
    const desk0 = cellOf(saved.nextWeeks[0]).desks[0]
    expect([desk0.teacher, Boolean(desk0.manualTeacher)]).toEqual(['倉島', false])
    expect(saved.nextPendingDesks).toEqual({})
  })
})

// regression-reviewer 指摘 3（2026-11-07）: 置き場所の順番。埋め草だけの机は、本物の講師だけの机より先に使う（本物の講師を上書きしない）。
describe('講習の講師の自動割当: 机が複数あるコマの置き場所の順番', () => {
  it('机 0＝本物の講師だけ（講師Z）・机 1＝埋め草だけ・机 2＝千葉 → 倉島は埋め草の机へ。講師Z は残る', () => {
    const session = {
      id: 'sess1', label: '冬期講習', startDate: DATE, endDate: DATE,
      teacherInputs: { tB: { unavailableSlots: [], countSubmitted: true, updatedAt: '' } },
      studentInputs: {}, createdAt: '', updatedAt: '',
    } as unknown as SpecialSessionRow
    const cell: SlotCell = {
      id: CELL_ID, dateKey: DATE, dayLabel: '水', dateLabel: '10/7', slotLabel: '5限', slotNumber: SLOT, timeLabel: '', isOpenDay: true,
      desks: [
        { id: `${CELL_ID}_desk_1`, teacher: '講師Z' },
        { id: `${CELL_ID}_desk_2`, teacher: PLACEHOLDER },
        { id: `${CELL_ID}_desk_3`, teacher: PLACEHOLDER, lesson: { id: 'managed_r0', studentSlots: [{ id: 'e0', name: '千葉', managedStudentId: 'sC', grade: '中2', subject: '数', lessonType: 'regular', teacherType: 'normal' } as StudentEntry, null] } },
      ],
    }
    const result = reconcileSubmittedTeacherPlacements({ weeks: [[cell]], specialSessions: [session], teachers, students, regularLessons: [], classroomSettings: settings({ deskCount: 3 }) })
    expect(result.placedCount).toBe(1)
    const desks = result.nextWeeks[0][0].desks
    expect(desks.filter((desk) => desk.teacher === '倉島')).toHaveLength(1)
    expect(desks.filter((desk) => desk.teacher === '講師Z')).toHaveLength(1)
    expect(desks.find((desk) => desk.lesson)?.lesson?.studentSlots[0]?.managedStudentId).toBe('sC')
  })
})
