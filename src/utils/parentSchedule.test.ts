import { describe, expect, it } from 'vitest'
import {
  addDaysToDateKey,
  buildManagedOccurrenceKey,
  buildParentScheduleView,
  getWeekdayFromDateKey,
  isParentStudentActiveOnDate,
  normalizeParentDateText,
  PARENT_SCHEDULE_MONTHS_AFTER,
  PARENT_SCHEDULE_MONTHS_BEFORE,
  PARENT_BOARD_SLOT_TIMES,
  PARENT_DEFAULT_DESK_COUNT,
  SUBJECT_OPTIONS,
  TEMPLATE_DAY_OPTIONS,
  TEMPLATE_SLOT_NUMBERS,
  resolveParentScheduleRange,
  toJstDateKey,
  type ParentScheduleDay,
  type ParentScheduleRange,
  type ParentScheduleView,
} from './parentSchedule'
import {
  cloneParentScheduleFixturePayload,
  PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE,
  PARENT_SCHEDULE_FIXTURE_FORBIDDEN_STRINGS,
  PARENT_SCHEDULE_FIXTURE_TODAY,
  parentScheduleFixtureClassroomSettings,
  parentScheduleFixturePayload,
  parentScheduleFixtureRegularLessons,
  parentScheduleFixtureStudents,
  parentScheduleFixtureTeachers,
  parentScheduleFixtureWeek0907,
  parentScheduleFixtureWeek0914,
  parentScheduleFixtureWeek0928,
} from './parentSchedule.fixture'
// ⚠️ 以下はアプリ側の権威関数(写しの元)。parentSchedule.ts の写しがズレたらパリティテストが落ちる。
import { isActiveOnDate } from '../components/basic-data/basicDataModel'
import { hasGraduatedHighSchool, resolveDisplayedSubjectForGrade, resolveGradeLabelFromBirthDate } from './studentGradeSubject'
import { buildLinkedLessonDestinationMap } from '../components/schedule-board/lessonLinks'
import { boardSlotTimes } from '../components/schedule-board/slotTimes'
import { regularTemplateDayOptions, regularTemplateSlotNumbers } from '../components/regular-template/regularLessonTemplate'
import { allStudentSubjectOptions } from './studentGradeSubject'
import { buildRegularLessonsFromTemplate } from '../components/regular-template/regularLessonTemplate'
import { buildCombinedRegularLessonsFromHistory } from './scheduleHtml'
import { buildManagedOccurrenceKey as boardBuildManagedOccurrenceKey, ensureWeeksCoverDateRange } from '../components/schedule-board/ScheduleBoardScreen'
import type { SlotCell } from '../components/schedule-board/types'
import type { AppSnapshotPayload } from '../types/appState'

const DEFAULT_RANGE: ParentScheduleRange = { ...PARENT_SCHEDULE_FIXTURE_DEFAULT_RANGE }

function clonePayload(): AppSnapshotPayload {
  return cloneParentScheduleFixturePayload() as AppSnapshotPayload
}

function buildView(studentId: string, range: ParentScheduleRange = DEFAULT_RANGE, payload: unknown = cloneParentScheduleFixturePayload()): ParentScheduleView {
  const view = buildParentScheduleView(payload, studentId, range)
  if (!view) throw new Error(`view not built for ${studentId}`)
  return view
}

function dayOf(view: ParentScheduleView, dateKey: string): ParentScheduleDay {
  const day = view.days.find((entry) => entry.dateKey === dateKey)
  if (!day) throw new Error(`day ${dateKey} not in view`)
  return day
}

function summarize(day: ParentScheduleDay) {
  return day.lessons.map((lesson) => `${lesson.slotNumber}:${lesson.subject}:${lesson.kind}${lesson.isTentative ? ':予定' : ''}`)
}

// 授業が無い日は行ごと出ない(オーナー指示 2026-09-14)。無い日は [] として扱う。
function summarizeOn(view: ParentScheduleView, dateKey: string) {
  const day = view.days.find((entry) => entry.dateKey === dateKey)
  return day ? summarize(day) : []
}

function expectNoRow(view: ParentScheduleView, dateKey: string) {
  expect(view.days.some((entry) => entry.dateKey === dateKey), `${dateKey} の行は出さない`).toBe(false)
}

function findCell(cells: SlotCell[], dateKey: string, slotNumber: number) {
  const cell = cells.find((entry) => entry.dateKey === dateKey && entry.slotNumber === slotNumber)
  if (!cell) throw new Error(`cell ${dateKey}_${slotNumber} missing`)
  return cell
}

// ---------------------------------------------------------------------------
// 日付ユーティリティ
// ---------------------------------------------------------------------------

describe('parentSchedule 日付ユーティリティ', () => {
  it('toJstDateKey は UTC の瞬間を JST(+9h) の日付キーにする', () => {
    expect(toJstDateKey(new Date('2026-09-13T15:00:00.000Z'))).toBe('2026-09-14')
    expect(toJstDateKey(new Date('2026-09-13T14:59:59.999Z'))).toBe('2026-09-13')
    expect(toJstDateKey(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01')
  })

  it('addDaysToDateKey は月末・年末・閏日をまたいで TZ 非依存に進める', () => {
    expect(addDaysToDateKey('2026-09-14', 0)).toBe('2026-09-14')
    expect(addDaysToDateKey('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateKey('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysToDateKey('2026-09-14', -56)).toBe('2026-07-20')
    expect(addDaysToDateKey('2026-09-14', 84)).toBe('2026-12-07')
    expect(addDaysToDateKey('bad', 3)).toBe('bad')
  })

  it('getWeekdayFromDateKey は 0=日..6=土(不正なキーは -1)', () => {
    expect(getWeekdayFromDateKey('2026-09-13')).toBe(0)
    expect(getWeekdayFromDateKey('2026-09-14')).toBe(1)
    expect(getWeekdayFromDateKey('2026-09-19')).toBe(6)
    expect(getWeekdayFromDateKey('2026-02-30')).toBe(-1)
    expect(getWeekdayFromDateKey('2026/09/14')).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// 表示期間の丸め(spec §D-1 / P-1)
// ---------------------------------------------------------------------------

describe('resolveParentScheduleRange', () => {
  const today = PARENT_SCHEDULE_FIXTURE_TODAY

  // オーナー指示 2026-09-14(確認リスト k-4/k-5): 表示も移動も暦の 1 か月単位・移動できるのは前後 1 か月だけ。
  it('既定は今月の 1 日〜末日、限界は先月 1 日〜来月末日', () => {
    expect(PARENT_SCHEDULE_MONTHS_BEFORE).toBe(1)
    expect(PARENT_SCHEDULE_MONTHS_AFTER).toBe(1)
    expect(resolveParentScheduleRange({}, today)).toEqual({ from: '2026-09-01', to: '2026-09-30', bounds: { minFrom: '2026-08-01', maxTo: '2026-10-31' } })
  })

  it('from(無ければ to)が属する月の 1 日〜末日に丸める', () => {
    expect(resolveParentScheduleRange({ from: '2026-10-05', to: '2026-11-09' }, today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolveParentScheduleRange({ to: '2026-08-10' }, today)).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('前後 1 か月を超える要求はエラーにせず近い端の月へ寄せる', () => {
    expect(resolveParentScheduleRange({ from: '2026-01-01', to: '2026-01-31' }, today)).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolveParentScheduleRange({ from: '2027-01-01' }, today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('年またぎ・閏年の月末も正しく出す', () => {
    expect(resolveParentScheduleRange({}, '2026-12-20')).toEqual({ from: '2026-12-01', to: '2026-12-31', bounds: { minFrom: '2026-11-01', maxTo: '2027-01-31' } })
    expect(resolveParentScheduleRange({ from: '2028-02-10' }, '2028-01-15')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' })
    expect(resolveParentScheduleRange({}, '2027-01-05').bounds).toEqual({ minFrom: '2026-12-01', maxTo: '2027-02-28' })
  })

  it('不正な値は無視して今月にする', () => {
    expect(resolveParentScheduleRange({ from: '2026/09/20', to: 123 }, today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(resolveParentScheduleRange({ from: ['2026-09-20'], to: null }, today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(resolveParentScheduleRange({ from: '2026-02-30' }, today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
  })
})

// ---------------------------------------------------------------------------
// 在籍判定・日付正規化(basicDataModel / studentGradeSubject の写し)
// ---------------------------------------------------------------------------

describe('normalizeParentDateText', () => {
  it("''/'未定'/不正は '' に、'YYYY-MM-DD' はそのまま、'YYYY/M/D'・'YYYY.M.D' は零詰めする", () => {
    expect(normalizeParentDateText('')).toBe('')
    expect(normalizeParentDateText('未定')).toBe('')
    expect(normalizeParentDateText(undefined)).toBe('')
    expect(normalizeParentDateText(null)).toBe('')
    expect(normalizeParentDateText(' 2026-09-14 ')).toBe('2026-09-14')
    expect(normalizeParentDateText('2026/9/4')).toBe('2026-09-04')
    expect(normalizeParentDateText('2026.10.14')).toBe('2026-10-14')
    expect(normalizeParentDateText('9/4/2026')).toBe('')
    expect(normalizeParentDateText('2026-9-4')).toBe('')
    expect(normalizeParentDateText(20260914)).toBe('')
  })
})

describe('isParentStudentActiveOnDate', () => {
  // 2026-09-15 改定(確認リスト v1.5.527 b-2): 生徒の退塾日は「その日から非在籍」。保護者QRも退塾日当日から閲覧不可。
  it('入塾日前は非在籍、退塾日の前日まで在籍、退塾日当日から非在籍(P-6)', () => {
    const student = { entryDate: '2026-09-01', withdrawDate: '2026-09-10', birthDate: '2011-06-15' }
    expect(isParentStudentActiveOnDate(student, '2026-08-31')).toBe(false)
    expect(isParentStudentActiveOnDate(student, '2026-09-01')).toBe(true)
    expect(isParentStudentActiveOnDate(student, '2026-09-09')).toBe(true)
    expect(isParentStudentActiveOnDate(student, '2026-09-10')).toBe(false)
    expect(isParentStudentActiveOnDate(student, '2026-09-11')).toBe(false)
  })

  it('高3卒業は翌年度 4/1 から非在籍(3/31 までは在籍)', () => {
    const graduate = { entryDate: '', withdrawDate: '未定', birthDate: '2007-08-01' }
    expect(isParentStudentActiveOnDate(graduate, '2026-03-31')).toBe(true)
    expect(isParentStudentActiveOnDate(graduate, '2026-04-01')).toBe(false)
    // 早生まれ(1〜3 月)は 1 年早く卒業する
    const earlyBorn = { entryDate: '', withdrawDate: '', birthDate: '2008-02-10' }
    expect(isParentStudentActiveOnDate(earlyBorn, '2026-03-31')).toBe(true)
    expect(isParentStudentActiveOnDate(earlyBorn, '2026-04-01')).toBe(false)
  })

  it("スラッシュ日付・'未定'・欠損を受け、生年月日が空/不正なら卒業判定しない", () => {
    expect(isParentStudentActiveOnDate({ entryDate: '2024/4/1', withdrawDate: '2026/9/10', birthDate: '' }, '2026-09-09')).toBe(true)
    expect(isParentStudentActiveOnDate({ entryDate: '2024/4/1', withdrawDate: '2026/9/10', birthDate: '' }, '2026-09-10')).toBe(false)
    expect(isParentStudentActiveOnDate({}, '2026-09-11')).toBe(true)
    expect(isParentStudentActiveOnDate({ birthDate: '2007/8/1' }, '2026-09-11')).toBe(true)
    expect(isParentStudentActiveOnDate({ birthDate: 20070801 }, '2026-09-11')).toBe(true)
  })

  it('PARITY: 権威 isActiveOnDate / hasGraduatedHighSchool と全組合せで一致する', () => {
    const entryDates = ['', '未定', '2026-09-01', '2026/9/1', '2026-09-15']
    const withdrawDates = ['', '未定', '2026-09-10', '2026/9/10', '2026-09-30']
    const birthDates = ['', '2007-08-01', '2008-02-10', '2008-04-01', '2011-06-15', '2007/8/1', '2007-13-40']
    const dateKeys = ['2026-03-31', '2026-04-01', '2026-08-31', '2026-09-01', '2026-09-10', '2026-09-11', '2026-09-15', '2026-09-30', '2026-10-01']
    let checked = 0
    for (const entryDate of entryDates) {
      for (const withdrawDate of withdrawDates) {
        for (const birthDate of birthDates) {
          for (const dateKey of dateKeys) {
            expect(isParentStudentActiveOnDate({ entryDate, withdrawDate, birthDate }, dateKey), `${entryDate}/${withdrawDate}/${birthDate}@${dateKey}`)
              .toBe(isActiveOnDate(entryDate, withdrawDate, birthDate, dateKey))
            checked += 1
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
    for (const birthDate of birthDates) {
      for (const dateKey of dateKeys) {
        expect(isParentStudentActiveOnDate({ birthDate }, dateKey)).toBe(!hasGraduatedHighSchool(birthDate, dateKey))
      }
    }
  })
})

// ---------------------------------------------------------------------------
// buildParentScheduleView — 入力の扱い
// ---------------------------------------------------------------------------

describe('buildParentScheduleView 入力', () => {
  it('生徒が無い / payload が壊れているときは null', () => {
    expect(buildParentScheduleView(cloneParentScheduleFixturePayload(), 's999', DEFAULT_RANGE)).toBeNull()
    expect(buildParentScheduleView(null, 's001', DEFAULT_RANGE)).toBeNull()
    expect(buildParentScheduleView('x', 's001', DEFAULT_RANGE)).toBeNull()
    expect(buildParentScheduleView({ students: 'nope' }, 's001', DEFAULT_RANGE)).toBeNull()
  })

  it('表示名は displayName(無ければ氏名の先頭語)、範囲が不正なら days は空', () => {
    expect(buildView('s001').studentName).toBe('青木')
    const payload = clonePayload()
    payload.students[0].displayName = ''
    expect(buildView('s001', DEFAULT_RANGE, payload).studentName).toBe('青木')
    expect(buildParentScheduleView(payload, 's001', { from: '2026-09-20', to: '2026-09-10' })).toEqual({ studentName: '青木', days: [], hasLectureLessons: false })
    expect(buildParentScheduleView(payload, 's001', { from: 'bad', to: '2026-09-10' })).toEqual({ studentName: '青木', days: [], hasLectureLessons: false })
  })

  it('授業のある日と臨時・祝日休みの日だけを from→to 順に返し、weekday は 0=日..6=土(k-4)', () => {
    const view = buildView('s001')
    const dateKeys = view.days.map((day) => day.dateKey)
    expect([...dateKeys].sort()).toEqual(dateKeys)
    expect(new Set(dateKeys).size).toBe(dateKeys.length)
    expect(view.days[0]).toMatchObject({ dateKey: '2026-09-07', weekday: 1 })
    expect(dayOf(view, '2026-09-12').weekday).toBe(6)
    expect(dayOf(view, '2026-09-20').weekday).toBe(0)
    // 空の行(授業 0 件の board/template)は 1 件も出さない。
    expect(view.days.every((day) => day.kind === 'closed' ? day.lessons.length === 0 : day.lessons.length > 0)).toBe(true)
  })

  it('boardState が無い / weeks が無い旧 payload でもテンプレ補完だけで組み立てる', () => {
    const payload = clonePayload()
    payload.boardState = null
    const view = buildView('s001', { from: '2026-09-14', to: '2026-09-20' }, payload)
    expect(dayOf(view, '2026-09-14')).toMatchObject({ kind: 'template' })
    expect(summarize(dayOf(view, '2026-09-14'))).toEqual(['1:数:regular:予定'])
    const legacy = { ...payload, boardState: null, specialSessions: undefined, classroomSettings: { closedWeekdays: [0], holidayDates: [], forceOpenDates: [], deskCount: 2 } }
    expect(buildView('s001', { from: '2026-09-14', to: '2026-09-17' }, legacy).days.map((day) => `${day.dateKey}:${day.kind}`)).toEqual(['2026-09-14:template', '2026-09-16:template', '2026-09-17:template'])
  })
})

// ---------------------------------------------------------------------------
// K-3 受け入れ条件(spec §I)
// ---------------------------------------------------------------------------

describe('buildParentScheduleView K-3: 盤面優先とテンプレ補完', () => {
  it('盤面 weeks にある日はテンプレ展開で行が増えない(盤面に配置が無い日は行を出さない)', () => {
    const payload = clonePayload()
    // 9/17(木) 3限 のテンプレ授業(英)を盤面から外す → 盤面は存在するのでテンプレで補わず、行も出ない。
    const week = (payload.boardState?.weeks[1] as unknown as { cells: SlotCell[] }).cells
    expect(summarize(dayOf(buildView('s001'), '2026-09-17'))).toEqual(['3:英:regular'])
    findCell(week, '2026-09-17', 3).desks[0].lesson = undefined
    const view = buildView('s001', DEFAULT_RANGE, payload)
    expectNoRow(view, '2026-09-17')
    // Firestore 形 { cells } の週も盤面として扱われる。
    expect(dayOf(view, '2026-09-14').kind).toBe('board')
    expect(summarize(dayOf(view, '2026-09-14'))).toEqual(['1:数:regular'])
  })

  it('盤面に無い未来日はテンプレ展開され、全行に「予定(変更の可能性あり)」が付く', () => {
    const view = buildView('s001')
    const thursday = dayOf(view, '2026-09-24')
    expect(thursday.kind).toBe('template')
    expect(thursday.lessons).toEqual([{ slotNumber: 3, timeLabel: '16:20-17:50', subject: '英', kind: 'regular', isTentative: true }])
    expect(summarize(dayOf(view, '2026-10-07'))).toEqual(['1:理:regular:予定'])
    expect(summarize(dayOf(view, '2026-10-12'))).toEqual(['1:数:regular:予定'])
    expectNoRow(view, '2026-09-22')
    for (const day of view.days) {
      for (const lesson of day.lessons) {
        // 振替元として補った「お休み」は盤面の振替から決まった事実なので予定印を付けない(k-11)。
        expect(lesson.isTentative).toBe(day.kind === 'template' && lesson.kind !== 'absent')
      }
    }
  })

  it('templateFreezeBeforeDate より前の日付はテンプレ展開しない(行を出さない)。定休曜日の日曜も出さない', () => {
    const payload = clonePayload()
    payload.classroomSettings.templateFreezeBeforeDate = '2026-09-25'
    const view = buildView('s001', { from: '2026-09-21', to: '2026-09-27' }, payload)
    const withoutFreeze = buildView('s001', { from: '2026-09-21', to: '2026-09-27' })
    expect(summarizeOn(withoutFreeze, '2026-09-24')).toEqual(['3:英:regular:予定'])
    expect(view.days.map((day) => `${day.dateKey}:${day.kind}`)).toEqual(
      withoutFreeze.days.filter((day) => day.kind === 'closed' || day.dateKey >= '2026-09-25').map((day) => `${day.dateKey}:${day.kind}`),
    )
    expect(view.days.map((day) => day.dateKey)).toContain('2026-09-23')
    expectNoRow(view, '2026-09-24')
    expectNoRow(view, '2026-09-27')
  })

  it('置かれた振替(暗黙鍵)と suppressedRegularLessonOccurrences(明示鍵)に一致するテンプレ行は出ない', () => {
    const view = buildView('s001')
    // 9/29 5限 数 は 9/21 1限 からの振替 → 9/21 のテンプレ 数 は湧かない。
    // (代わりに振替元として「お休み＋振替先」だけが出る・確認リスト k-11)
    expect(summarizeOn(view, '2026-09-21')).toEqual(['1:数:absent'])
    // 明示鍵 s001__英__2026-10-08__3。
    expectNoRow(view, '2026-10-08')
    // 抑止を外せば湧く(鍵が効いていることの対照)。
    const payload = clonePayload()
    payload.boardState!.suppressedRegularLessonOccurrences = []
    expect(summarize(dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-10-08'))).toEqual(['3:英:regular:予定'])
  })

  it('テンプレ履歴: 新テンプレ反映日以降は旧テンプレの行が出ず、反映日前は旧テンプレの行が出る', () => {
    const before = buildView('s001', { from: '2026-08-24', to: '2026-08-30' })
    expect(summarize(dayOf(before, '2026-08-24'))).toEqual(['2:数:regular:予定'])
    expectNoRow(before, '2026-08-25')
    const after = buildView('s001')
    expect(summarizeOn(after, '2026-09-21').some((entry) => entry.startsWith('2:'))).toBe(false)
    expect(summarize(dayOf(after, '2026-10-12'))).toEqual(['1:数:regular:予定'])
  })

  it('履歴が無ければ payload.regularLessons をそのまま展開する', () => {
    const payload = clonePayload()
    payload.classroomSettings.regularLessonTemplateHistory = []
    payload.classroomSettings.preTemplateRegularLessons = []
    const view = buildView('s001', { from: '2026-10-06', to: '2026-10-12' }, payload)
    expect(summarize(dayOf(view, '2026-10-07'))).toEqual(['1:理:regular:予定'])
    expect(summarize(dayOf(view, '2026-10-12'))).toEqual(['1:数:regular:予定'])
  })
})

describe('buildParentScheduleView K-3: 休講日と講習期間', () => {
  // オーナー指示 2026-09-14(k-4): 教室休みは臨時・祝日(holidayDates)だけ 1 行出す。毎週の定休曜日は出さない。
  it('臨時・祝日休み(holidayDates)は closed の 1 行、定休曜日(closedWeekdays)は行なし、forceOpenDates の日は通常どおり出る', () => {
    const view = buildView('s001')
    expect(dayOf(view, '2026-09-23')).toEqual({ dateKey: '2026-09-23', weekday: 3, kind: 'closed', lessons: [] })
    expectNoRow(view, '2026-09-13')
    expectNoRow(view, '2026-09-27')
    const forceOpen = dayOf(view, '2026-09-20')
    expect(forceOpen.kind).toBe('board')
    expect(summarize(forceOpen)).toEqual(['2:英:makeup'])
    // 定休曜日と重なる臨時休み(holidayDates に日曜)は closed の行が出る。
    const payload = clonePayload()
    payload.classroomSettings.holidayDates = [...payload.classroomSettings.holidayDates, '2026-09-27']
    expect(dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-09-27').kind).toBe('closed')
  })

  // オーナー指示 2026-09-14(k-4): 講習は講習提出QRで案内する。このページは講習期間中も通常授業(振替・休みを含む)だけを出す。
  it('講習期間の日も「講習期間」の行にせず通常授業を出し、講習コマは出さない', () => {
    const view = buildView('s001')
    expect(view.days.some((day) => (day.kind as string) === 'lecture-period')).toBe(false)
    // 10/01 3限: 通常の英＋休みの数(盤面)。
    expect(summarize(dayOf(view, '2026-10-01'))).toEqual(['3:英:regular', '3:数:absent'])
    // 10/02 1限は講習コマだけ → 出さない。
    expect(summarizeOn(view, '2026-10-02').some((entry) => entry.startsWith('1:'))).toBe(false)
    // 10/04 は日曜(定休)なので行なし。前日(9/30)は盤面どおり。
    expectNoRow(view, '2026-10-04')
    expect(dayOf(view, '2026-09-30').kind).toBe('board')
    expect(JSON.stringify(view)).not.toContain('秋期講習')
  })

  it('special(講習コマ)は講習期間外に置かれていても出ない', () => {
    const view = buildView('s001')
    expect(summarize(dayOf(view, '2026-09-30'))).toEqual(['1:理:regular'])
  })

  // 確認リスト k-4 再報告(2026-09-14): 講習だけの月が「休みしか出ない」ように見える。講習コマは出さず、あった印だけ返して注記にする。
  it('範囲内にこの生徒の講習コマがあれば hasLectureLessons=true(講習コマ自体は出さない)。無い範囲・他の生徒は false', () => {
    expect(buildView('s001').hasLectureLessons).toBe(true)
    expect(buildView('s001', { from: '2026-09-07', to: '2026-09-13' }).hasLectureLessons).toBe(false)
    expect(buildView('s003').hasLectureLessons).toBe(false)
    expect(buildParentScheduleView(cloneParentScheduleFixturePayload(), 's001', { from: '2026-09-20', to: '2026-09-10' })?.hasLectureLessons).toBe(false)
  })

  it('出欠記録(statusSlots)の講習も印に数え、moved の講習は数えない', () => {
    const range = { from: '2026-09-07', to: '2026-09-13' }
    const withStatus = (status: string) => {
      const payload = clonePayload()
      const week = (payload.boardState?.weeks[0] ?? []) as SlotCell[]
      const target = week.find((cell) => cell.id === '2026-09-08_3')
      target!.desks[0] = {
        ...target!.desks[0],
        statusSlots: [
          { id: 'status-special', studentId: 'x1', sourceManagedLesson: false, name: '青木', managedStudentId: 's001', grade: '中3', subject: '数', lessonType: 'special', teacherType: 'normal', teacherName: '田中', dateKey: '2026-09-08', slotNumber: 3, recordedAt: '', status, sourceLessonId: '' } as never,
          null,
        ],
      }
      return buildView('s001', range, payload)
    }
    expect(withStatus('attended').hasLectureLessons).toBe(true)
    expect(withStatus('absent').hasLectureLessons).toBe(true)
    expect(withStatus('moved').hasLectureLessons).toBe(false)
    expect(JSON.stringify(withStatus('attended').days)).not.toContain('special')
  })
})

describe('buildParentScheduleView K-3: 休み・振替・出欠', () => {
  it('欠席(absent)の日は「お休み」＋振替先が出る。振替先が attended でも振替先が出る(P-10 回帰)', () => {
    const view = buildView('s001')
    expect(dayOf(view, '2026-09-09').lessons).toEqual([
      { slotNumber: 1, timeLabel: '13:00-14:30', subject: '理', kind: 'absent', makeupDestination: { dateKey: '2026-09-10', slotNumber: 4 }, isTentative: false },
    ])
    // 振替先が studentSlots に配置済み(forceOpen の日曜)。
    expect(dayOf(view, '2026-09-15').lessons).toEqual([
      { slotNumber: 4, timeLabel: '18:00-19:30', subject: '英', kind: 'absent', makeupDestination: { dateKey: '2026-09-20', slotNumber: 2 }, isTentative: false },
    ])
    // 振替先が無い → null(調整中)。在庫数は出さない。
    expect(summarize(dayOf(view, '2026-09-16'))).toEqual(['1:理:absent', '2:数:regular'])
    expect(dayOf(view, '2026-09-16').lessons[0].makeupDestination).toBeNull()
    // absent 以外には makeupDestination キー自体を付けない。
    expect('makeupDestination' in dayOf(view, '2026-09-16').lessons[1]).toBe(false)
  })

  it('出席済み(attended)・振無休(absent-no-makeup)・増コマ(extra)はその日に授業があった扱いで出る', () => {
    const view = buildView('s001')
    expect(summarize(dayOf(view, '2026-09-10'))).toEqual(['3:英:attended', '4:理:attended'])
    expect(summarize(dayOf(view, '2026-09-11'))).toEqual(['2:数:absent-no-makeup'])
    expect(summarize(dayOf(view, '2026-09-12'))).toEqual(['3:数:extra'])
    expect(summarize(dayOf(view, '2026-09-29'))).toEqual(['5:数:makeup'])
  })

  it('振替コマには振替元(日付＋元コマ)が付く。出席済みにした振替も同じ。通常授業・休みには付かない(確認リスト その他 2026-09-14)', () => {
    const view = buildView('s001')
    // 配置の振替(studentSlots)。
    expect(dayOf(view, '2026-09-29').lessons[0].makeupOrigin).toEqual({ dateKey: '2026-09-21', slotNumber: 1 })
    // 振替を出席にした(statusSlots の attended・lessonType=makeup)。
    const attendedMakeup = dayOf(view, '2026-09-10').lessons.find((lesson) => lesson.subject === '理')
    expect(attendedMakeup?.makeupOrigin).toEqual({ dateKey: '2026-09-09', slotNumber: 1 })
    // 通常授業・休み・通常授業の出席には付けない(キー自体を持たない)。
    expect('makeupOrigin' in dayOf(view, '2026-09-14').lessons[0]).toBe(false)
    expect('makeupOrigin' in dayOf(view, '2026-09-09').lessons[0]).toBe(false)
    expect('makeupOrigin' in dayOf(view, '2026-09-10').lessons.find((lesson) => lesson.subject === '英')!).toBe(false)
  })

  it('振替元のラベルから元コマが読めないときは slotNumber=null、振替元が同じ日なら付けない', () => {
    const payload = clonePayload()
    const week = payload.boardState!.weeks[2]
    const student = findCell(week, '2026-09-29', 5).desks[0].lesson!.studentSlots[0]!
    student.makeupSourceLabel = '2026/9/21(月)'
    expect(dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-09-29').lessons[0].makeupOrigin).toEqual({ dateKey: '2026-09-21', slotNumber: null })
    student.makeupSourceDate = '2026-09-29'
    expect('makeupOrigin' in dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-09-29').lessons[0]).toBe(false)
  })

  it('moved の行は出ない(移動先だけが 1 回出る=同じ授業が 2 回出ない)', () => {
    const view = buildView('s001')
    expect(summarize(dayOf(view, '2026-09-14'))).toEqual(['1:数:regular'])
    expect(summarize(dayOf(view, '2026-09-16'))).toEqual(['1:理:absent', '2:数:regular'])
    const allRegularDates = view.days.flatMap((day) => day.lessons.filter((lesson) => lesson.kind === 'regular' && lesson.subject === '数').map(() => day.dateKey))
    expect(allRegularDates.filter((dateKey) => dateKey === '2026-09-14')).toHaveLength(1)
  })

  it('振替コマ自体を休みにした(absent + makeupSourceDate)ときは振替先 null で出る', () => {
    const payload = clonePayload()
    const week = payload.boardState!.weeks[2]
    findCell(week, '2026-09-29', 5).desks[0].lesson = undefined
    findCell(week, '2026-09-29', 5).desks[0].statusSlots = [{
      id: 'status-0929-makeup-absent', studentId: 'x', sourceManagedLesson: false, name: '青木', managedStudentId: 's001', grade: '中3',
      subject: '数', lessonType: 'makeup', teacherType: 'normal', teacherName: '田中', dateKey: '2026-09-29', slotNumber: 5,
      makeupSourceDate: '2026-09-21', makeupSourceLabel: '2026/9/21(月) 1限', recordedAt: '2026-09-13T00:00:00.000Z', status: 'absent', sourceLessonId: 'l',
    }, null]
    const view = buildView('s001', DEFAULT_RANGE, payload)
    expect(dayOf(view, '2026-09-29').lessons).toEqual([
      { slotNumber: 5, timeLabel: '19:40-21:10', subject: '数', kind: 'absent', makeupDestination: null, isTentative: false },
    ])
    // 振替が studentSlots から消えたので 9/21 の暗黙抑止も消え、テンプレ行が戻る(盤面の再マージと同じ)。
    // 在庫へ戻った振替(absent)からは振替元の「お休み」を補わない(k-11)。
    expect(summarize(dayOf(view, '2026-09-21'))).toEqual(['1:数:regular:予定'])
  })
})

// 確認リスト k-11(2026-09-14「休みとなった日が行表示されない」): 丸ごと振替は振替元の机を空にするだけ、生徒のドラッグ移動は
// 振替元に moved(非表示)を残すだけで、振替元の日に何も出なかった。振替先の配置から逆に引いて「お休み＋振替先」を補う。
describe('buildParentScheduleView k-11: 振替元の日にお休み＋振替先を出す', () => {
  // 保存形式によって週は SlotCell[] か { cells } のどちらか。
  function weekCells(payload: AppSnapshotPayload, index: number): SlotCell[] {
    const week = payload.boardState!.weeks[index] as SlotCell[] | { cells: SlotCell[] }
    return Array.isArray(week) ? week : week.cells
  }

  function makeupEntry(base: NonNullable<SlotCell['desks'][number]['lesson']>['studentSlots'][number], sourceDate: string, sourceLabel: string) {
    return { ...base!, lessonType: 'makeup' as const, makeupSourceDate: sourceDate, makeupSourceLabel: sourceLabel }
  }

  it('丸ごと振替(振替元の机が空・振替先に振替)でも、振替元の日に「お休み＋振替先」が出る。生徒ごとに混ざらない', () => {
    const payload = clonePayload()
    const origin = findCell(weekCells(payload, 1), '2026-09-14', 1)
    const [aoki, other] = origin.desks[0].lesson!.studentSlots
    origin.desks[0].lesson = undefined
    const destination = findCell(weekCells(payload, 2), '2026-09-30', 1)
    destination.desks[0].lesson = {
      id: 'daymove_2026-09-14_1_0',
      studentSlots: [makeupEntry(aoki, '2026-09-14', '2026/9/14(月) 1限'), makeupEntry(other, '2026-09-14', '2026/9/14(月) 1限')],
    }

    const view = buildView('s001', DEFAULT_RANGE, payload)
    expect(dayOf(view, '2026-09-14').lessons).toEqual([
      { slotNumber: 1, timeLabel: '13:00-14:30', subject: '数', kind: 'absent', makeupDestination: { dateKey: '2026-09-30', slotNumber: 1 }, isTentative: false },
    ])
    expect(dayOf(view, '2026-09-30').lessons.find((lesson) => lesson.kind === 'makeup')?.makeupOrigin).toEqual({ dateKey: '2026-09-14', slotNumber: 1 })
    // 同じ机の別生徒(s003 英)の振替は s001 の行に付かず、s003 側にだけ出る。
    expect(summarizeOn(buildView('s003', DEFAULT_RANGE, payload), '2026-09-14')).toEqual(['1:英:absent'])
  })

  it('ドラッグ移動(振替元に moved)でも振替元にお休み＋振替先が出て、移動先の振替と合わせて 1 回ずつ', () => {
    const payload = clonePayload()
    const destinationCell = findCell(weekCells(payload, 1), '2026-09-16', 2)
    const movedLesson = destinationCell.desks.find((desk) => desk.lesson?.studentSlots.some((student) => student?.managedStudentId === 's001'))!.lesson!
    movedLesson.studentSlots = movedLesson.studentSlots.map((student) => (
      student?.managedStudentId === 's001' ? makeupEntry(student, '2026-09-14', '2026/9/14(月) 2限') : student
    )) as typeof movedLesson.studentSlots
    const view = buildView('s001', DEFAULT_RANGE, payload)
    expect(summarize(dayOf(view, '2026-09-14'))).toEqual(['1:数:regular', '2:数:absent'])
    expect(dayOf(view, '2026-09-14').lessons[1].makeupDestination).toEqual({ dateKey: '2026-09-16', slotNumber: 2 })
    expect(summarize(dayOf(view, '2026-09-16'))).toEqual(['1:理:absent', '2:数:makeup'])
  })

  it('振替先が表示範囲の外でも振替元の日に出る。休みの記録が既にある日は重ねない', () => {
    // 9/29 5限 数 は 9/21 1限 からの振替(9/21 はテンプレの日)。範囲を 9/21 だけにしても振替先が付く。
    const view = buildView('s001', { from: '2026-09-21', to: '2026-09-21' })
    expect(dayOf(view, '2026-09-21').lessons).toEqual([
      { slotNumber: 1, timeLabel: '13:00-14:30', subject: '数', kind: 'absent', makeupDestination: { dateKey: '2026-09-29', slotNumber: 5 }, isTentative: false },
    ])
    // 9/09 は休み(absent)の記録＋振替(9/10 出席済み)。補った行と二重にならない。
    expect(summarize(dayOf(buildView('s001'), '2026-09-09'))).toEqual(['1:理:absent'])
  })

  function statusSlot(overrides: Record<string, unknown>) {
    return {
      id: 'status-x', studentId: 'x', sourceManagedLesson: false, name: '青木', managedStudentId: 's001', grade: '中3',
      subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中', dateKey: '2026-09-14', slotNumber: 1,
      recordedAt: '2026-09-13T00:00:00.000Z', status: 'absent', sourceLessonId: 'l',
      ...overrides,
    } as unknown as NonNullable<SlotCell['desks'][number]['statusSlots']>[number]
  }

  it('別の生徒が同じ科目・同じ限・同じ振替元日の振替を持っていても、本人の行には付かない(レビュー指摘 A-1)', () => {
    const payload = clonePayload()
    const origin = findCell(weekCells(payload, 1), '2026-09-14', 1)
    const aoki = origin.desks[0].lesson!.studentSlots[0]!
    // 別生徒 s003 の「数」を 9/14 1限からの振替として 9/30 1限に置く(本人 s001 は 9/14 に通常のまま)。
    const otherMakeup = makeupEntry({ ...aoki, id: 'other', name: '別生徒', managedStudentId: 's003' }, '2026-09-14', '2026/9/14(月) 1限')
    findCell(weekCells(payload, 2), '2026-09-30', 1).desks[0].lesson = { id: 'other-makeup', studentSlots: [otherMakeup, null] }
    expect(summarize(dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-09-14'))).toEqual(['1:数:regular'])
    // 本人の通常を「休み(id 空・振替先なし)」にしても、別生徒の振替先では埋めない。
    origin.desks[0].lesson = undefined
    origin.desks[0].statusSlots = [statusSlot({ id: '', grade: aoki.grade }), null]
    const lessons = dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-09-14').lessons
    expect(lessons.map((lesson) => [lesson.kind, lesson.makeupDestination])).toEqual([['absent', null]])
  })

  it('振替元の同じ限に、別の日から来た振替(出席済み)があっても、お休み＋振替先は出る(レビュー指摘 A-2)', () => {
    const payload = clonePayload()
    const origin = findCell(weekCells(payload, 1), '2026-09-14', 1)
    const aoki = origin.desks[0].lesson!.studentSlots[0]!
    // 9/14 1限の本人の通常を 9/30 1限へ移し、空いた 9/14 1限に 9/07 1限分の振替を出席済みで置く。
    findCell(weekCells(payload, 2), '2026-09-30', 1).desks[0].lesson = { id: 'moved', studentSlots: [makeupEntry(aoki, '2026-09-14', '2026/9/14(月) 1限'), null] }
    origin.desks[0].lesson = undefined
    origin.desks[0].statusSlots = [statusSlot({
      id: 'status-0914-attended-makeup', grade: aoki.grade, lessonType: 'makeup', status: 'attended',
      makeupSourceDate: '2026-09-07', makeupSourceLabel: '2026/9/7(月) 1限',
    }), null]
    const lessons = dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-09-14').lessons
    expect(lessons.map((lesson) => lesson.kind)).toEqual(['attended', 'absent'])
    expect(lessons[1].makeupDestination).toEqual({ dateKey: '2026-09-30', slotNumber: 1 })
  })

  it('丸ごと振替の振替先を休みにしても(在庫へ戻っても)、振替元の日にお休みの行が残る(レビュー指摘 A-3)', () => {
    const payload = clonePayload()
    const origin = findCell(weekCells(payload, 1), '2026-09-14', 1)
    const aoki = origin.desks[0].lesson!.studentSlots[0]!
    origin.desks[0].lesson = undefined
    const destination = findCell(weekCells(payload, 2), '2026-09-30', 1)
    destination.desks[0].lesson = undefined
    destination.desks[0].statusSlots = [statusSlot({
      id: 'status-0930-absent', grade: aoki.grade, lessonType: 'makeup', dateKey: '2026-09-30',
      makeupSourceDate: '2026-09-14', makeupSourceLabel: '2026/9/14(月) 1限',
    }), null]
    const view = buildView('s001', DEFAULT_RANGE, payload)
    expect(dayOf(view, '2026-09-14').lessons.map((lesson) => [lesson.kind, lesson.makeupDestination])).toEqual([['absent', { dateKey: '2026-09-30', slotNumber: 1 }]])
    expect(dayOf(view, '2026-09-30').lessons.find((lesson) => lesson.slotNumber === 1)).toMatchObject({ kind: 'absent', makeupDestination: null })
  })

  it('講習(special)のコマは振替元を持っていても、振替元のお休みを補わない', () => {
    const payload = clonePayload()
    const aoki = findCell(weekCells(payload, 1), '2026-09-14', 1).desks[0].lesson!.studentSlots[0]!
    findCell(weekCells(payload, 2), '2026-09-30', 1).desks[0].lesson = {
      id: 'lecture', studentSlots: [{ ...aoki, lessonType: 'special', makeupSourceDate: '2026-09-15', makeupSourceLabel: '2026/9/15(火) 3限' }, null],
    }
    expect(summarizeOn(buildView('s001', DEFAULT_RANGE, payload), '2026-09-15').some((entry) => entry.startsWith('3:'))).toBe(false)
  })

  it('臨時休み(教室休み)の日から出した振替は、教室休みの行に振替先として添える', () => {
    const payload = clonePayload()
    const destination = findCell(weekCells(payload, 2), '2026-09-30', 1)
    const base = findCell(weekCells(payload, 1), '2026-09-14', 1).desks[0].lesson!.studentSlots[0]
    destination.desks[0].lesson = { id: 'holiday-makeup', studentSlots: [makeupEntry(base, '2026-09-23', '2026/9/23(水) 3限'), null] }
    const closed = dayOf(buildView('s001', DEFAULT_RANGE, payload), '2026-09-23')
    expect(closed.kind).toBe('closed')
    expect(closed.lessons).toEqual([])
    expect(closed.makeupDestinations).toEqual([{ dateKey: '2026-09-30', slotNumber: 1 }])
    // 振替が無い教室休みにはキー自体を付けない(応答を増やさない)。
    expect('makeupDestinations' in dayOf(buildView('s001'), '2026-09-23')).toBe(false)
  })
})

describe('buildParentScheduleView K-3: 生徒同一性・在籍・科目', () => {
  it('同名の別生徒がいても managedStudentId が一致する生徒の予定だけが出る', () => {
    expect(summarize(dayOf(buildView('s001'), '2026-09-07'))).toEqual(['1:数:regular'])
    expect(summarize(dayOf(buildView('s003'), '2026-09-07'))).toEqual(['1:英:regular'])
    expect(summarizeOn(buildView('s003'), '2026-09-24')).toEqual([])
    expect(summarize(dayOf(buildView('s003'), '2026-09-21'))).toEqual(['1:英:regular:予定'])
  })

  it('managedStudentId の無い配置は名前が名簿で一意なときだけ拾い、同名が複数なら拾わない。体験(trial)は同名でも出さない', () => {
    const payload = clonePayload()
    const week = payload.boardState!.weeks[0]
    // 9/12 1限: s002(佐藤)の managedStudentId を落とす → 名前一致(一意)で拾う。
    const satoEntry = findCell(week, '2026-09-12', 1).desks[0].lesson!.studentSlots[0]!
    delete satoEntry.managedStudentId
    satoEntry.name = '佐藤 花'
    // 9/07 1限: s001 の managedStudentId を落とす → 「青木 太郎」は s001/s003 で衝突 → どちらにも出ない。
    const aokiEntry = findCell(week, '2026-09-07', 1).desks[0].lesson!.studentSlots[0]!
    delete aokiEntry.managedStudentId
    aokiEntry.name = '青木 太郎'
    expect(summarize(dayOf(buildView('s002', DEFAULT_RANGE, payload), '2026-09-12'))).toEqual(['1:算:regular'])
    expect(summarizeOn(buildView('s001', DEFAULT_RANGE, payload), '2026-09-07')).toEqual([])
    expect(summarize(dayOf(buildView('s003', DEFAULT_RANGE, payload), '2026-09-07'))).toEqual(['1:英:regular'])
    // 体験生(9/12 1限 机2・同名・managedStudentId なし)は s001 にも s003 にも出ない。
    expect(summarize(dayOf(buildView('s001'), '2026-09-12'))).toEqual(['3:数:extra'])
    expect(summarizeOn(buildView('s003'), '2026-09-12')).toEqual([])
  })

  it('退塾した生徒: 盤面の日はそのまま出るが、退塾後のテンプレ補完では出ない', () => {
    const view = buildView('s004')
    expect(summarize(dayOf(view, '2026-09-08'))).toEqual(['1:国:regular'])
    expectNoRow(view, '2026-09-22')
    expectNoRow(view, '2026-10-06')
  })

  it('入塾前の生徒は入塾日からテンプレ補完に出る。高3卒業済みは非在籍', () => {
    const view = buildView('s006')
    expectNoRow(view, '2026-09-25')
    expect(summarize(dayOf(view, '2026-10-09'))).toEqual(['2:算:regular:予定'])
    expect(isParentStudentActiveOnDate(parentScheduleFixtureStudents[4], PARENT_SCHEDULE_FIXTURE_TODAY)).toBe(false)
    expect(buildView('s005').days.every((day) => day.lessons.length === 0)).toBe(true)
  })

  it('科目は学年で正規化する(小学生の 数 → 算)。盤面・テンプレの両方', () => {
    const view = buildView('s002')
    expect(summarize(dayOf(view, '2026-09-19'))).toEqual(['1:算:regular'])
    expect(summarize(dayOf(view, '2026-09-26'))).toEqual(['1:算:regular:予定'])
    expect(summarize(dayOf(view, '2026-09-24'))).toEqual(['3:算:regular:予定'])
  })

  it('机数(deskCount)が足りない行・同じセルに既に置かれた生徒の行は盤面と同じくスキップされる', () => {
    const base = {
      students: [
        { id: 'a', name: 'A A', displayName: 'A', email: '', entryDate: '', withdrawDate: '', birthDate: '2011-06-15' },
        { id: 'b', name: 'B B', displayName: 'B', email: '', entryDate: '', withdrawDate: '', birthDate: '2011-06-15' },
      ],
      regularLessons: [
        { id: 'r1', schoolYear: 2026, teacherId: 't1', student1Id: 'a', subject1: '数', startDate: '2026-04-01', endDate: '2027-03-31', student2Id: '', subject2: '', student2StartDate: '2026-04-01', student2EndDate: '2027-03-31', dayOfWeek: 1, slotNumber: 1 },
        { id: 'r2', schoolYear: 2026, teacherId: 't2', student1Id: 'b', subject1: '英', startDate: '2026-04-01', endDate: '2027-03-31', student2Id: '', subject2: '', student2StartDate: '2026-04-01', student2EndDate: '2027-03-31', dayOfWeek: 1, slotNumber: 1 },
        { id: 'r3', schoolYear: 2026, teacherId: 't3', student1Id: 'a', subject1: '国', startDate: '2026-04-01', endDate: '2027-03-31', student2Id: '', subject2: '', student2StartDate: '2026-04-01', student2EndDate: '2027-03-31', dayOfWeek: 1, slotNumber: 2 },
        { id: 'r4', schoolYear: 2026, teacherId: 't4', student1Id: 'a', subject1: '理', startDate: '2026-04-01', endDate: '2027-03-31', student2Id: '', subject2: '', student2StartDate: '2026-04-01', student2EndDate: '2027-03-31', dayOfWeek: 1, slotNumber: 2 },
      ],
      specialSessions: [],
      boardState: null,
    }
    const range = { from: '2026-09-14', to: '2026-09-14' }
    const oneDesk = buildView('b', range, { ...base, classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 1 } })
    expect(summarizeOn(oneDesk, '2026-09-14')).toEqual([])
    const twoDesks = buildView('b', range, { ...base, classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 2 } })
    expect(summarizeOn(twoDesks, '2026-09-14')).toEqual(['1:英:regular:予定'])
    // 同じセル(月2限)に a が 2 行 → 2 行目は「既に置かれている」でスキップ。
    const dup = buildView('a', range, { ...base, classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3 } })
    expect(summarizeOn(dup, '2026-09-14')).toEqual(['1:数:regular:予定', '2:国:regular:予定'])
  })

  it('講師だけの行は開講日に机を消費する(盤面と同じ)', () => {
    const payload = {
      students: [{ id: 'a', name: 'A', displayName: 'A', email: '', entryDate: '', withdrawDate: '', birthDate: '2011-06-15' }],
      regularLessons: [
        { id: 'r1', schoolYear: 2026, teacherId: 't1', student1Id: '', subject1: '', startDate: '2026-04-01', endDate: '2027-03-31', student2Id: '', subject2: '', student2StartDate: '2026-04-01', student2EndDate: '2027-03-31', dayOfWeek: 1, slotNumber: 1 },
        { id: 'r2', schoolYear: 2026, teacherId: '', student1Id: 'a', subject1: '数', startDate: '2026-04-01', endDate: '2027-03-31', student2Id: '', subject2: '', student2StartDate: '2026-04-01', student2EndDate: '2027-03-31', dayOfWeek: 1, slotNumber: 1 },
      ],
      classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 1 },
      boardState: null,
    }
    expect(buildView('a', { from: '2026-09-14', to: '2026-09-14' }, payload).days).toEqual([])
  })
})

describe('buildParentScheduleView K-3: 出力に載せない情報', () => {
  it('応答に講師名・机番号・他生徒名・在庫数・内部 ID が 1 つも含まれない(JSON を文字列化して検査)', () => {
    for (const studentId of ['s001', 's002', 's003', 's004', 's006']) {
      const view = buildView(studentId, { from: '2026-08-24', to: '2026-10-12' })
      // 本人の表示名だけは載る(それ以外の生徒名・講師名・内部 ID は 1 つも載らない)。
      const json = JSON.stringify({ ...view, studentName: '' })
      for (const forbidden of PARENT_SCHEDULE_FIXTURE_FORBIDDEN_STRINGS) {
        expect(json, `${studentId} に ${forbidden}`).not.toContain(forbidden)
      }
      expect(json).not.toMatch(/teacher|managedStudentId|studentId|recordedAt|note/i)
    }
  })

  it('lesson オブジェクトのキーは契約どおり(余計なフィールドを増やさない)', () => {
    const view = buildView('s001')
    for (const day of view.days) {
      expect(Object.keys(day).sort()).toEqual(['dateKey', 'kind', 'lessons', 'weekday'])
      for (const lesson of day.lessons) {
        const expected = ['isTentative', 'kind', 'slotNumber', 'subject', 'timeLabel']
        if (lesson.kind === 'absent') expected.push('makeupDestination')
        if (lesson.makeupOrigin) expected.push('makeupOrigin')
        expect(Object.keys(lesson).sort()).toEqual(expected.sort())
      }
    }
  })
})

// ---------------------------------------------------------------------------
// PARITY: 写しの元(権威関数)と同じ答えになることを固定する
// ---------------------------------------------------------------------------

describe('PARITY: 権威関数との一致', () => {
  it('学年→科目正規化が resolveGradeLabelFromBirthDate + resolveDisplayedSubjectForGrade と一致する(テンプレ補完)', () => {
    const birthDates = ['2020-04-01', '2019-04-02', '2015-10-02', '2014-03-31', '2013-04-10', '2011-06-15', '2010-02-01', '2008-04-01', '2007-08-01']
    const dateKeys = ['2026-03-30', '2026-04-06', '2026-09-14', '2027-03-29', '2027-04-05']
    for (const birthDate of birthDates) {
      for (const dateKey of dateKeys) {
        const weekday = getWeekdayFromDateKey(dateKey)
        const schoolYear = Number(dateKey.slice(0, 4)) - (Number(dateKey.slice(5, 7)) >= 4 ? 0 : 1)
        const payload = {
          students: [{ id: 'a', name: 'A', displayName: 'A', email: '', entryDate: '', withdrawDate: '', birthDate }],
          regularLessons: [{ id: 'r', schoolYear, teacherId: 't', student1Id: 'a', subject1: '数', startDate: '', endDate: '', student2Id: '', subject2: '', student2StartDate: '', student2EndDate: '', dayOfWeek: weekday, slotNumber: 1 }],
          classroomSettings: { closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 1 },
          boardState: null,
        }
        const view = buildView('a', { from: dateKey, to: dateKey }, payload)
        const expectedActive = isActiveOnDate('', '', birthDate, dateKey)
        const expectedSubject = resolveDisplayedSubjectForGrade('数', resolveGradeLabelFromBirthDate(birthDate, dateKey))
        expect(summarizeOn(view, dateKey), `${birthDate}@${dateKey}`).toEqual(expectedActive ? [`1:${expectedSubject}:regular:予定`] : [])
      }
    }
  })

  it('休み→振替先が buildLinkedLessonDestinationMap(全週)と一致する', () => {
    const allCells = [...parentScheduleFixtureWeek0907, ...parentScheduleFixtureWeek0914, ...parentScheduleFixtureWeek0928]
    const expectedByStatusId = buildLinkedLessonDestinationMap(allCells)
    const view = buildView('s001')
    const checks: Array<[string, string, number]> = [
      ['status-0909-absent', '2026-09-09', 1],
      ['status-0915-absent', '2026-09-15', 4],
      ['status-0916-absent', '2026-09-16', 1],
    ]
    for (const [statusId, dateKey, slotNumber] of checks) {
      const lesson = dayOf(view, dateKey).lessons.find((entry) => entry.slotNumber === slotNumber && entry.kind === 'absent')
      expect(lesson, statusId).toBeDefined()
      expect(lesson?.makeupDestination ?? null).toEqual(expectedByStatusId.get(statusId) ?? null)
    }
    // 権威側でも「出席済みの振替先」が解決されている(P-10 の前提)。
    expect(expectedByStatusId.get('status-0909-absent')).toEqual({ dateKey: '2026-09-10', slotNumber: 4 })
    expect(expectedByStatusId.get('status-0916-absent')).toBeUndefined()
  })

  it('テンプレ補完が buildCombinedRegularLessonsFromHistory + buildRegularLessonsFromTemplate + ensureWeeksCoverDateRange(盤面の週生成)と一致する', () => {
    const combined = buildCombinedRegularLessonsFromHistory({
      regularLessons: parentScheduleFixtureRegularLessons,
      regularLessonTemplateHistory: parentScheduleFixtureClassroomSettings.regularLessonTemplateHistory,
      preTemplateRegularLessons: parentScheduleFixtureClassroomSettings.preTemplateRegularLessons,
      teachers: parentScheduleFixtureTeachers,
      students: parentScheduleFixtureStudents,
    })
    // 権威のテンプレ→行(9 月テンプレ単体)が結合結果に含まれていることも固定する。
    const septemberRows = buildRegularLessonsFromTemplate({ template: parentScheduleFixtureClassroomSettings.regularLessonTemplateHistory![1], teachers: parentScheduleFixtureTeachers, students: parentScheduleFixtureStudents })
    expect(septemberRows.length).toBeGreaterThan(0)
    for (const row of septemberRows) expect(combined).toContainEqual(row)

    // 盤面が欠落週を生成するのと同じ経路で 9/21 週(前方)と 10/05 週(後方)を作り、生徒ごとの配置を期待値にする。
    const generated = ensureWeeksCoverDateRange({
      weeks: [parentScheduleFixtureWeek0928],
      startDate: '2026-09-21',
      endDate: '2026-10-11',
      classroomSettings: parentScheduleFixtureClassroomSettings,
      teachers: parentScheduleFixtureTeachers,
      students: parentScheduleFixtureStudents,
      regularLessons: combined,
    })
    const generatedCells = generated.weeks.flat().filter((cell) => cell.dateKey < '2026-09-28' || cell.dateKey > '2026-10-04')
    const suppressedKeys = new Set(['s001__数__2026-09-21__1', 's001__英__2026-10-08__3'])
    const templateDates = ['2026-09-21', '2026-09-22', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']

    for (const student of parentScheduleFixtureStudents) {
      const expected = new Map<string, string[]>()
      for (const cell of generatedCells) {
        for (const desk of cell.desks) {
          for (const entry of desk.lesson?.studentSlots ?? []) {
            if (!entry || entry.managedStudentId !== student.id) continue
            if (suppressedKeys.has(`${entry.managedStudentId}__${entry.subject}__${cell.dateKey}__${cell.slotNumber}`)) continue
            const list = expected.get(cell.dateKey) ?? []
            list.push(`${cell.slotNumber}:${resolveDisplayedSubjectForGrade(entry.subject, entry.grade)}:regular:予定`)
            expected.set(cell.dateKey, list)
          }
        }
      }
      const view = buildView(student.id, { from: '2026-09-21', to: '2026-10-11' })
      for (const dateKey of templateDates) {
        const day = view.days.find((entry) => entry.dateKey === dateKey)
        if (day) expect(day.kind, `${student.id}@${dateKey}`).toBe('template')
        // 振替元として補う「お休み＋振替先」(k-11)は盤面の週生成には無いので比較から外す(振替先を持つ休みだけ・レビュー指摘 B-3)。
        const templateOnly = (day?.lessons ?? [])
          .filter((lesson) => !(lesson.kind === 'absent' && lesson.makeupDestination))
          .map((lesson) => `${lesson.slotNumber}:${lesson.subject}:${lesson.kind}${lesson.isTentative ? ':予定' : ''}`)
          .sort()
        expect(templateOnly, `${student.id}@${dateKey}`).toEqual((expected.get(dateKey) ?? []).sort())
      }
    }
    // 期待値が空ばかりではない(テストが実質を持つ)ことを固定。
    expect(summarize(dayOf(buildView('s001', { from: '2026-09-21', to: '2026-10-11' }), '2026-09-24'))).toEqual(['3:英:regular:予定'])
  })
})

// 写した定数のドリフト検出(レビュー指摘 2026-09-13)。値そのものを権威と突き合わせる。
// これが無いと、時間割変更・科目追加のときに「盤面と日程表は新しい・保護者ページだけ古い」が CI 緑で通る。
describe('PARITY: 写した定数が権威と一致する', () => {
  it('コマ時間は slotTimes.boardSlotTimes と同じ', () => {
    expect(PARENT_BOARD_SLOT_TIMES).toEqual([...boardSlotTimes])
  })

  it('テンプレの曜日・時限の並びは regularLessonTemplate の権威と同じ', () => {
    expect(TEMPLATE_DAY_OPTIONS).toEqual([...regularTemplateDayOptions])
    expect(TEMPLATE_SLOT_NUMBERS).toEqual([...regularTemplateSlotNumbers])
  })

  it('科目の一覧は studentGradeSubject.allStudentSubjectOptions と同じ(足し忘れると「英」に潰れる)', () => {
    expect(SUBJECT_OPTIONS).toEqual([...allStudentSubjectOptions])
  })

  it('抑止鍵の形は盤面の buildManagedOccurrenceKey と同じ(ズレると振替済みの通常授業が元の曜日にも湧く)', () => {
    const entry = { id: 'e1', name: '青木', managedStudentId: 's001', grade: '中3' as const, subject: '数' as const, lessonType: 'regular' as const, teacherType: 'normal' as const }
    expect(buildManagedOccurrenceKey('s001', '数', '2026-09-21', 1)).toBe(boardBuildManagedOccurrenceKey(entry, '2026-09-21', 1))
    // managedStudentId が無い entry は表示名がキーになる(盤面と同じフォールバック)。
    const nameOnly = { ...entry, managedStudentId: undefined }
    expect(buildManagedOccurrenceKey('青木', '数', '2026-09-21', 1)).toBe(boardBuildManagedOccurrenceKey(nameOnly, '2026-09-21', 1))
  })
})

describe('レビュー指摘の穴埋め(2026-09-13)', () => {
  it('振替先が表示範囲の外でも日付を示す(§D-5・在庫や調整中に落とさない)', () => {
    // 9/09 の休み(理)の振替先は 9/10 4限。範囲を 9/09 までに絞っても振替先が出ること。
    const view = buildView('s001', { from: '2026-09-07', to: '2026-09-09' })
    const absent = dayOf(view, '2026-09-09').lessons.find((lesson) => lesson.kind === 'absent')
    expect(absent?.makeupDestination).toEqual({ dateKey: '2026-09-10', slotNumber: 4 })
    expect(view.days.some((day) => day.dateKey === '2026-09-10')).toBe(false)
  })

  it('休講日の盤面セルに配置があっても出さない(§D-2 1・判定順を曲げない)', () => {
    const payload = clonePayload()
    // 9/13 は日曜(closedWeekdays)。そこへ通常授業を置いた保存週を作る。
    const week = (payload.boardState?.weeks[0] ?? []) as SlotCell[]
    const sundayCell = week.find((cell) => cell.id === '2026-09-13_1')
    expect(sundayCell).toBeTruthy()
    expect(sundayCell?.isOpenDay).toBe(false)
    sundayCell!.desks[0] = {
      ...sundayCell!.desks[0],
      teacher: '田中',
      lesson: {
        id: 'lesson-sunday',
        studentSlots: [{ id: 'sunday-entry', name: '青木', managedStudentId: 's001', grade: '中3', subject: '数', lessonType: 'regular', teacherType: 'normal' }, null],
      },
    }
    // 定休曜日なので行ごと出ない(盤面の配置に引きずられて授業行が出ないこと)。
    expectNoRow(buildView('s001', DEFAULT_RANGE, payload), '2026-09-13')
  })

  it('statusSlots の体験・講習は出さない(studentSlots 側と同じ除外)', () => {
    const payload = clonePayload()
    const week = (payload.boardState?.weeks[0] ?? []) as SlotCell[]
    const target = week.find((cell) => cell.id === '2026-09-08_3')
    expect(target).toBeTruthy()
    target!.desks[0] = {
      ...target!.desks[0],
      statusSlots: [
        { id: 'status-special', studentId: 'x1', sourceManagedLesson: false, name: '青木', managedStudentId: 's001', grade: '中3', subject: '数', lessonType: 'special', teacherType: 'normal', teacherName: '田中', dateKey: '2026-09-08', slotNumber: 3, recordedAt: '', status: 'attended', sourceLessonId: '' },
        { id: 'status-trial', studentId: 'x2', sourceManagedLesson: false, name: '青木', managedStudentId: 's001', grade: '中3', subject: '英', lessonType: 'trial', teacherType: 'normal', teacherName: '田中', dateKey: '2026-09-08', slotNumber: 3, recordedAt: '', status: 'attended', sourceLessonId: '' },
      ],
    }
    expect(summarizeOn(buildView('s001', DEFAULT_RANGE, payload), '2026-09-08').filter((entry) => entry.startsWith('3:'))).toEqual([])
  })

  it('deskCount が欠けていてもアプリ既定(14 机)で扱い、テンプレ補完の 2 行目以降を落とさない', () => {
    const payload = clonePayload()
    delete (payload.classroomSettings as { deskCount?: number }).deskCount
    // 欠落週(9/21〜)のテンプレ補完で、机が足りずに授業が消えていないこと。
    const withoutDeskCount = buildView('s001', { from: '2026-09-21', to: '2026-09-25' }, payload)
    const withDeskCount = buildView('s001', { from: '2026-09-21', to: '2026-09-25' })
    expect(JSON.stringify(withoutDeskCount)).toBe(JSON.stringify(withDeskCount))
    expect(PARENT_DEFAULT_DESK_COUNT).toBe(14)
  })

  it('status の id が空なら振替先を引かない(空キーを共有して別の日のリンクが付くのを防ぐ)', () => {
    const payload = clonePayload()
    const weeks = (payload.boardState?.weeks ?? []) as (SlotCell[] | { cells: SlotCell[] })[]
    const asCells = (week: SlotCell[] | { cells: SlotCell[] }) => (Array.isArray(week) ? week : week.cells)
    // 振替先が決まっている休み(9/09・振替先 9/10 4限)と、決まっていない休み(9/16)の id を**両方**空にする。
    // ガードが無いと Map のキー '' を共有し、9/16 の休みに 9/10 の振替先が付いてしまう(他人・別日のリンク)。
    const cell0909 = asCells(weeks[0]).find((cell) => cell.id === '2026-09-09_1')
    const status0909 = cell0909?.desks[0]?.statusSlots?.[0]
    expect(status0909).toBeTruthy()
    cell0909!.desks[0].statusSlots = [{ ...status0909!, id: '' }, null]
    const cell0916 = asCells(weeks[1]).find((cell) => cell.id === '2026-09-16_1')
    const status0916 = cell0916?.desks[0]?.statusSlots?.[0]
    expect(status0916).toBeTruthy()
    cell0916!.desks[0].statusSlots = [{ ...status0916!, id: '' }, null]

    const view = buildView('s001', DEFAULT_RANGE, payload)
    // 9/16 には他の日の振替先が付かない(空キー共有のガード)。
    const absent0916 = dayOf(view, '2026-09-16').lessons.find((lesson) => lesson.kind === 'absent')
    expect(absent0916).toBeTruthy()
    expect(absent0916?.makeupDestination).toBeNull()
    // 9/09 は id 経由では引かないが、この生徒自身の振替(makeupSourceDate=9/09・同じ限と科目)から振替先を補う(k-11)。
    const absent0909 = dayOf(view, '2026-09-09').lessons.find((lesson) => lesson.kind === 'absent')
    expect(absent0909?.makeupDestination).toEqual({ dateKey: '2026-09-10', slotNumber: 4 })
  })
})

describe('parentSchedule.ts の自己完結', () => {
  it('固定の fixture で決定的な結果を返す(同じ入力 → 同じ JSON)', () => {
    const first = JSON.stringify(buildView('s001'))
    const second = JSON.stringify(buildView('s001', DEFAULT_RANGE, JSON.parse(JSON.stringify(parentScheduleFixturePayload))))
    expect(first).toBe(second)
  })
})
