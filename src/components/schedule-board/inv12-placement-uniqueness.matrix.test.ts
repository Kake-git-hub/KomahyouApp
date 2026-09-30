import { describe, expect, it } from 'vitest'
import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { DeskCell, SlotCell, StudentEntry } from './types'
import { buildManagedScheduleCellsForRange, computePendingDeskResolution, computePendingLowerStudentMove, computeStudentMove, computeTemplateDiffApplyForBoard, remergeBoardWeeksWithManagedData, type TemplatePendingResolutionLedgers } from './ScheduleBoardScreen'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'

// ============================================================================
// INV-12 操作マトリクス（配置の一意性: 同一生徒を同コマに二重配置しない）
//
// 保証文（docs/spec-invariants.md / 台帳 INV-12・強制・2026-08-29 新設）:
//   同一生徒は同一コマ（日付×時限）に 1 エントリしか配置されない。
//   移動・入れ替え・追加・配置のどの経路でも二重配置を作らない。
//
// 対象バグ（Issue #56 / v1.5.481・第三者手動テスト No.276）:
//   computeStudentMove の入れ替え経路に2つの穴があり、日程表D&Dスワップで同一生徒の講習が
//   同じ日に2枚並んだ（実例=富樫/小林のスワップ）。
//   ①入れ替え相手の着地先（移動元コマ）に重複検査が皆無
//   ②移動先検査が「見つかった最初の1件が相手なら免除」で、同コマ2エントリ目を素通り
//
// 同一性の判定は resolveStockComparableStudentKey（managedStudentId 優先）＝エントリIDが違っても
// 同じ生徒なら二重配置。盤面クリック移動・長押しD&D・日程表D&Dは同じ関数を通る。
// テンプレモード移動（handleTemplateMoveStudent）にも同じ検査を配線済みだが、コンポーネント内関数の
// ため未テスト（末尾の it.todo）。
// ============================================================================

type Slots = [StudentEntry | null, StudentEntry | null]
const mkStudent = (id: string, name: string, extra: Partial<StudentEntry> = {}): StudentEntry => ({
  id, name, managedStudentId: id, grade: '中3', subject: '数', lessonType: 'regular', teacherType: 'normal', ...extra,
})
const mkLesson = (id: string, slots: Slots) => ({ id, studentSlots: slots })
const mkCell = (id: string, dateKey: string, slotNumber: number, desks: unknown[]) =>
  ({ id, dateKey, dayLabel: '', dateLabel: dateKey, slotLabel: `${slotNumber}限`, slotNumber, timeLabel: '', isOpenDay: true, desks }) as unknown as SlotCell
const baseParams = (weeks: SlotCell[][]) => ({
  weeks, weekIndex: 0, cells: weeks[0],
  suppressedRegularLessonOccurrences: [] as string[],
  managedStudentByAnyName: new Map(),
  resolveBoardStudentDisplayName: (n: string) => n,
})
const deskById = (weeks: SlotCell[][], cellId: string, deskId: string) =>
  weeks.flat().find((c) => c.id === cellId)!.desks.find((d) => d.id === deskId)!

describe('INV-12 マトリクス: 同一生徒を同コマに二重配置しない', () => {
  it('同コマに同一生徒(別エントリID・同 managedStudentId)が既にいる移動先はブロックして状態を維持する', () => {
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-03-23', 1, [
        { id: 'd0', teacher: '田中', manualTeacher: false, lesson: mkLesson('la', [mkStudent('a', '太郎', { managedStudentId: 'mX' }), null]) },
      ]),
      mkCell('C2', '2026-03-24', 1, [
        { id: 'e0', teacher: '佐藤', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('b', '太郎', { managedStudentId: 'mX' }), null]) },
        { id: 'e1', teacher: '', manualTeacher: false, lesson: undefined },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'a', cellId: 'C2', deskIndex: 1, studentIndex: 0 })
    expect(r.status).toBe('blocked')
    if (r.status !== 'blocked') return
    expect(r.message).toContain('移動不可')
    expect(r.message).toContain('太郎')
  })

  // Issue #56(2026-08-29): 以下2件は旧実装(相手の着地先検査なし+「相手なら免除」)で
  // status='moved'(=二重配置)になり落ちることを mutation で確認済み。
  it('入れ替え相手の着地先(移動元コマ)に相手と同一生徒が既にいる入れ替えはブロックする(Issue #56)', () => {
    // C1(8/25)に「南緒(y2)」と「應佑(x1)」。C2(8/26)に「南緒(y1)」。
    // 應佑(x1) を C2 の南緒(y1)とスワップ → 南緒(y1) が C1 へ着地すると C1 に南緒が2人になる。
    // 旧実装は入れ替え相手の着地先(移動元コマ)を一切検査せず二重配置になっていた。
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-08-25', 1, [
        { id: 'd0', teacher: '絹川', manualTeacher: false, lesson: mkLesson('la', [mkStudent('y2', '南緒', { managedStudentId: 'mY' }), null]) },
        { id: 'd1', teacher: '山本', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('x1', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
      mkCell('C2', '2026-08-26', 1, [
        { id: 'e0', teacher: '村上', manualTeacher: false, lesson: mkLesson('lc', [mkStudent('y1', '南緒', { managedStudentId: 'mY' }), null]) },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'x1', cellId: 'C2', deskIndex: 0, studentIndex: 0 })
    expect(r.status).toBe('blocked')
    if (r.status !== 'blocked') return
    expect(r.message).toContain('南緒')
  })

  it('移動先コマに同一生徒が2エントリ(入れ替え相手+別机)ある入れ替えは免除せずブロックする(Issue #56)', () => {
    // C2 の應佑(x2) を C1 の同キー相手(x1)とスワップしようとするが、C1 の別机にも應佑(x3)が居る。
    // 旧実装は「見つかった1件=相手」で免除し、x3 を見落として二重配置になっていた。
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-08-25', 1, [
        { id: 'd0', teacher: '絹川', manualTeacher: false, lesson: mkLesson('la', [mkStudent('x1', '應佑', { managedStudentId: 'mX' }), null]) },
        { id: 'd1', teacher: '山本', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('x3', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
      mkCell('C2', '2026-08-26', 1, [
        { id: 'e0', teacher: '村上', manualTeacher: false, lesson: mkLesson('lc', [mkStudent('x2', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'x2', cellId: 'C1', deskIndex: 0, studentIndex: 0 })
    expect(r.status).toBe('blocked')
  })

  it('入れ替え相手が移動元コマに重複を作らない通常のスワップは従来どおり成立する(Issue #56 回帰なし)', () => {
    const weeks: SlotCell[][] = [[
      mkCell('C1', '2026-08-25', 1, [
        { id: 'd0', teacher: '絹川', manualTeacher: false, lesson: mkLesson('la', [mkStudent('y1', '南緒', { managedStudentId: 'mY' }), null]) },
      ]),
      mkCell('C2', '2026-08-26', 1, [
        { id: 'e0', teacher: '村上', manualTeacher: false, lesson: mkLesson('lb', [mkStudent('x2', '應佑', { managedStudentId: 'mX' }), null]) },
      ]),
    ]]
    const r = computeStudentMove({ ...baseParams(weeks), movingStudentId: 'x2', cellId: 'C1', deskIndex: 0, studentIndex: 0 })
    expect(r.status).toBe('moved')
    if (r.status !== 'moved') return
    const d0 = deskById(r.nextWeeks, 'C1', 'd0')
    const e0 = deskById(r.nextWeeks, 'C2', 'e0')
    expect(d0.lesson?.studentSlots[0]?.managedStudentId).toBe('mX')
    expect(e0.lesson?.studentSlots[0]?.managedStudentId).toBe('mY')
  })

  // Issue #56 フォローアップ: テンプレモードの移動(handleTemplateMoveStudent)はコンポーネント内関数のため
  // 純関数テストができない。入れ替え着地の重複検査は computeStudentMove と同じ
  // findDuplicateStudentInCellByKey を配線済みだが、テンプレ移動自体の抽出とテストは未着手。
  it.todo('テンプレ移動を純関数へ抽出し「入れ替え相手の着地先に同一生徒 → blocked」を固定する(Issue #56 フォローアップ)')
  // 兄弟被覆(INV監査 2026-08-29): 配置/追加系4経路(未消化振替の配置・未消化講習の配置・生徒手動追加・
  // 自動割当候補探索)は findDuplicateStudentInCell が配線済みでコードに穴は無いが、マトリクスでの
  // ロックは未整備(UIハンドラ内のためテスト不能。純関数化とあわせて上の todo と同時に固定する)。
  it.todo('配置/追加系4経路(振替配置・講習配置・手動追加・自動割当)の重複ガードをマトリクスで固定する')
})

// ============================================================================
// INV-12 × テンプレ差分反映の保留（2 行）の解決操作（Issue #72・第 1 段 (B)・spec-template-behavior Q26-4・条件 19）
//
// 保留中の下段は「配置」ではない（INV-13）ので、上段と下段・別の机の 1 行と下段に同じ生徒が並ぶこと自体は違反ではない。
// ただし**解決操作の結果**は INV-12 を満たすこと: 下段を机へ戻す「既存を採用」・下段の「移動」が同じコマに同じ生徒を
// 2 か所で生かすなら止める（findDuplicateStudentInCellByKey と同じ検査）。兄弟: 下段を捨てる「テンプレを採用」は
// 生徒を増やさないので止めない（上段側の 1 か所が残る）。
// ============================================================================
describe('INV-12 × 保留（2 行）の解決操作: 同じコマに同じ生徒を 2 か所で生かさない（Q26-4）', () => {
  const CELL = 'P1'
  const DATE = '2026-10-07'
  const pendingKey = buildTemplatePendingDeskKey(CELL, 'p0')
  const ledgers: TemplatePendingResolutionLedgers = {
    manualLectureStockCounts: {},
    manualLectureStockOrigins: {},
    manualMakeupAdjustments: {},
    fallbackLectureStockStudents: {},
    fallbackMakeupStudents: {},
    suppressedMakeupOrigins: {},
    suppressedRegularLessonOccurrences: [],
    scheduleCountAdjustments: [],
  }
  const context = {
    managedStudentByAnyName: new Map(),
    resolveDisplayName: (name: string) => name,
    resolveStockId: (student: StudentEntry) => student.managedStudentId ?? student.name,
    ledgerOriginDatesByKey: {},
  }
  // 机 p0 = 上段 C（テンプレ）＋下段 A（振替）の 2 行。机 p1 に A が 1 行で生きている（Q21-11 後段の形）。机 p2 は空。
  function fixture(aAlsoOnOneRowDesk: boolean) {
    const weeks: SlotCell[][] = [[
      mkCell(CELL, DATE, 5, [
        { id: 'p0', teacher: '鈴木', lesson: mkLesson('managed_r0', [mkStudent('c1', '千葉', { managedStudentId: 'mC' }), null]) },
        { id: 'p1', teacher: '田中', lesson: aAlsoOnOneRowDesk ? mkLesson('la', [mkStudent('a-live', '青木', { managedStudentId: 'mA', manualAdded: true }), null]) : undefined },
        { id: 'p2', teacher: '佐藤', lesson: undefined },
      ]),
    ]]
    const pending: TemplatePendingDeskMap = {
      [pendingKey]: {
        lower: { lesson: mkLesson('lower', [mkStudent('a-lower', '青木', { managedStudentId: 'mA', lessonType: 'makeup', makeupSourceDate: '2026-09-30' }), null]) },
        effectiveStartDate: DATE,
        createdAt: '2026-09-29T10:00:00.000Z',
      },
    }
    return { weeks, pending }
  }
  const liveCount = (weeks: SlotCell[][], managedId: string) => weeks.flat().filter((cell) => cell.id === CELL)
    .flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []))
    .filter((student) => student?.managedStudentId === managedId).length
  const resolveMode = (mode: 'adopt-existing' | 'adopt-template', weeks: SlotCell[][], pending: TemplatePendingDeskMap) => computePendingDeskResolution({
    mode, weeks, cellId: CELL, deskId: 'p0', templatePendingDesks: pending, ledgers, ...context,
  })

  it('既存を採用: 下段の生徒が別の 1 行の机に生きていれば止め、盤面・保留マップ・台帳を変えない', () => {
    const { weeks, pending } = fixture(true)
    const snapshot = JSON.stringify({ weeks, pending, ledgers })
    const r = resolveMode('adopt-existing', weeks, pending)
    expect(r.status).toBe('blocked')
    if (r.status !== 'blocked') return
    expect(r.message).toContain('2 か所')
    expect(r.message).toContain('先に上段側を片づけてください')
    expect(JSON.stringify({ weeks, pending, ledgers })).toBe(snapshot)
  })

  it('既存を採用: 重ならなければ成立し、下段の生徒は同じコマに 1 か所だけ生きる', () => {
    const { weeks, pending } = fixture(false)
    const r = resolveMode('adopt-existing', weeks, pending)
    expect(r.status).toBe('applied')
    if (r.status !== 'applied') return
    expect(liveCount(r.nextWeeks, 'mA')).toBe(1)
    expect(liveCount(r.nextWeeks, 'mC')).toBe(0)
    expect(r.nextTemplatePendingDesks).toEqual({})
  })

  it('兄弟: テンプレを採用は下段を捨てるだけなので止めず、別の机の A は 1 か所のまま', () => {
    const { weeks, pending } = fixture(true)
    const r = resolveMode('adopt-template', weeks, pending)
    expect(r.status).toBe('applied')
    if (r.status !== 'applied') return
    expect(liveCount(r.nextWeeks, 'mA')).toBe(1)
    expect(liveCount(r.nextWeeks, 'mC')).toBe(1)
  })

  it('兄弟: 下段の移動も、移動先のコマに同じ生徒が生きていれば止める（上段・別の机を含む実配置で検査）', () => {
    const { weeks, pending } = fixture(true)
    const r = computePendingLowerStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      templatePendingDesks: pending,
      source: { cellId: CELL, deskId: 'p0', lowerIndex: 0 },
      cellId: CELL,
      deskIndex: 2,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: new Map(),
      resolveBoardStudentDisplayName: (n: string) => n,
    })
    expect(r.status).toBe('blocked')
    if (r.status === 'blocked') expect(r.message).toContain('移動不可')
  })
})

// ============================================================================
// INV-12 × テンプレ差分反映の**保存**（Issue #72・spec-template-behavior Q21-11 の二段構え・regression-reviewer R-2）
//
// 保存経路（computeTemplateDiffApplyForBoard）→ 保存直後の再マージ（remergeBoardWeeksWithManagedData）1 回を通しても、
// 同じコマの「生きている」同じ生徒は 1 か所だけ（保留中の下段は配置ではない＝INV-13 なので数えない）。
//   前段: 別の 1 行の机に生きている生徒 → 上段に置かない（置かなかった生徒の抑止キーを保存が積むので、再マージでも湧かない）
//   後段: 別の机の下段にだけ生きている生徒 → 上段に置く（置かないと保留中に日程表から消え、下段側でテンプレを採用すると無言で消失する）
// 兄弟: 解決操作の検査は上の describe（Q26-4）。
// ============================================================================
describe('INV-12 × テンプレ差分反映の保存: 同じコマの生存数は保存 → 再マージの後も 1（Q21-11）', () => {
  const WEEK_START = '2026-10-05'
  const WEEK_END = '2026-10-11'
  const DATE = '2026-10-07'
  const CELL = `${DATE}_5`
  const studentRows: StudentRow[] = [
    { id: 'sA', name: '青木', displayName: '青木', email: 'a@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
    { id: 'sB', name: '馬場', displayName: '馬場', email: 'b@example.com', entryDate: '2025-04-01', withdrawDate: '未定', birthDate: '2012-05-01' },
  ]
  const teacherRows: TeacherRow[] = ['田中', '鈴木', '佐藤'].map((name, index) => ({
    id: `t${index + 1}`, name, email: `t${index + 1}@example.com`, entryDate: '2025-04-01', withdrawDate: '未定', subjectCapabilities: [{ subject: '数', maxGrade: '高3' }],
  }))
  const row = (id: string, teacherId: string, student1Id = ''): RegularLessonRow => ({
    id, schoolYear: 2026, teacherId, student1Id, subject1: student1Id ? '数' : '', startDate: '', endDate: '', student2Id: '', subject2: '',
    student2StartDate: '', student2EndDate: '', nextStudent1Id: '', nextSubject1: '', nextStudent2Id: '', nextSubject2: '', dayOfWeek: 3, slotNumber: 5,
  })
  const settings = (extra: Partial<ClassroomSettings> = {}) => ({ closedWeekdays: [], holidayDates: [], forceOpenDates: [], deskCount: 3, ...extra }) as ClassroomSettings
  const OLD_ROWS = [row('r0', 't1', 'sA'), row('r1', 't2', 'sB'), row('r2', 't3')]
  // 新テンプレ: 机 0 に A（旧テンプレと同じ）・机 1 に B・机 2 は講師だけ
  const NEW_ROWS = OLD_ROWS
  const makeupA = (id: string) => mkStudent(id, '青木', { managedStudentId: 'sA', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })

  function board(update: (desks: DeskCell[]) => DeskCell[]) {
    const week = buildManagedScheduleCellsForRange({
      range: { startDate: WEEK_START, endDate: WEEK_END, periodValue: '', personId: '' },
      fallbackStartDate: WEEK_START,
      fallbackEndDate: WEEK_END,
      classroomSettings: settings(),
      teachers: teacherRows,
      students: studentRows,
      regularLessons: OLD_ROWS,
      boardWeeks: [],
    })
    return week.map((cell) => (cell.id === CELL ? { ...cell, desks: update(cell.desks) } : cell))
  }

  // 保存本体と同じ経路 → 保存直後の再マージ 1 回（教室設定・通常授業の変更 effect と同じ合成関数）。
  function saveThenRemerge(week: SlotCell[]) {
    const saved = computeTemplateDiffApplyForBoard({
      weeks: [week],
      classroomSettings: settings({ templateFreezeBeforeDate: DATE }),
      teachers: teacherRows,
      students: studentRows,
      regularLessons: NEW_ROWS,
      effectiveStartDate: DATE,
      suppressedRegularLessonOccurrences: [],
      templatePendingDesks: {},
      createdAt: '2026-09-29T10:00:00.000Z',
    })
    const remerged = remergeBoardWeeksWithManagedData(saved.nextWeeks, {
      classroomSettings: settings({ templateFreezeBeforeDate: DATE }),
      teachers: teacherRows,
      students: studentRows,
      regularLessons: NEW_ROWS,
      suppressedRegularLessonOccurrences: saved.addedSuppressedRegularLessonOccurrences,
      todayKey: '2026-09-29',
    })
    return { saved, remerged }
  }
  const liveCount = (weeks: SlotCell[][], managedId: string) => weeks.flat().filter((cell) => cell.id === CELL)
    .flatMap((cell) => cell.desks.flatMap((desk) => desk.lesson?.studentSlots ?? []))
    .filter((student) => student?.managedStudentId === managedId).length
  const liveIdsAt = (weeks: SlotCell[][], deskIndex: number) => (weeks.flat().find((cell) => cell.id === CELL)!.desks[deskIndex].lesson?.studentSlots ?? [])
    .filter(Boolean).map((student) => student!.managedStudentId)

  it('前段: 別の 1 行の机（机 2）に A の振替が生きていれば、机 0 の上段に A を置かない。再マージ 1 回の後も A は 1 か所', () => {
    const week = board((desks) => desks.map((desk, index) => (index === 2 ? { ...desk, lesson: mkLesson('hand-a', [makeupA('a-makeup'), null]) } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expect(liveIdsAt(saved.nextWeeks, 2)).toEqual(['sA'])
    expect(saved.summary.skippedDuplicateStudents).toBe(1)
    expect(saved.addedSuppressedRegularLessonOccurrences).toHaveLength(1)
    expect(liveCount(remerged, 'sA')).toBe(1)
    expect(liveIdsAt(remerged, 2)).toEqual(['sA'])
  })

  it('席ごと（2026-09-30）: 同じ机の生徒 2 の席に A の振替があり、テンプレの生徒 1 が A（通常）なら、生徒 2 の席が空いていても A の振替は 1 行に残さず下段へ。再マージ 1 回の後も A は 1 か所', () => {
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupA('a-makeup')] } } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    const pendingKey = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_1`)
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(saved.nextPendingDesks[pendingKey]?.lower.lesson?.studentSlots.map((student) => student?.managedStudentId ?? null)).toEqual([null, 'sA'])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expect(liveCount(remerged, 'sA')).toBe(1)
  })

  it('席ごと（2026-09-30）: 机 0 の生徒 2 の席に 1 行で残した B の振替が、別の机（机 1）のテンプレの B と重なるなら、机 1 の B を上段に置かず抑止キーを 1 件積む。再マージ 1 回の後も B は 1 か所', () => {
    const makeupB = mkStudent('b-makeup', '馬場', { managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupB] } } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA', 'sB'])
    expect(liveIdsAt(saved.nextWeeks, 1)).toEqual([])
    expect(saved.summary.skippedDuplicateStudents).toBe(1)
    expect(saved.addedSuppressedRegularLessonOccurrences).toHaveLength(1)
    expect(liveCount(saved.nextWeeks, 'sB')).toBe(1)
    expect(liveCount(remerged, 'sB')).toBe(1)
  })

  // regression-reviewer L-7（2026-09-30）: Q21-11 で生徒を全員外した机は「講師だけの机」になる。再マージは抑止で空になった
  // 管理授業の机を suppressManagedStudentsInCell と同じ形（講師名は残し teacherAssignmentTeacherId は外す）で置き直すので、
  // 保存結果も同じ形でなければ再マージの不動点にならない（INV-02 / INV-03）。生徒 ID の比較だけでは見えないため、セル丸ごと比べる。
  const cellOf = (weeks: SlotCell[][]) => weeks.flat().find((cell) => cell.id === CELL)!

  it('不動点（L-7）: Q21-11 で机 1 のテンプレの B を外して講師だけの机になっても、保存 → 再マージ 1 回でセルは丸ごと変わらない（置き換えの経路）', () => {
    const makeupB = mkStudent('b-makeup', '馬場', { managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const week = board((desks) => desks.map((desk, index) => (index === 0 ? { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupB] } } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    expect(saved.summary.skippedDuplicateStudents).toBe(1)
    const savedDesk1 = cellOf(saved.nextWeeks).desks[1]
    expect(savedDesk1.lesson).toBeUndefined()
    expect(savedDesk1.teacher).toBe('鈴木')
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7）: 兄弟＝残す（keep）の経路。メモの印がある机 1 のテンプレの B を Q21-11 で外しても、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const makeupB = mkStudent('b-makeup', '馬場', { managedStudentId: 'sB', lessonType: 'makeup', makeupSourceDate: '2026-09-30' })
    const week = board((desks) => desks.map((desk, index) => {
      if (index === 0) return { ...desk, lesson: { ...desk.lesson!, studentSlots: [desk.lesson!.studentSlots[0], makeupB] } }
      if (index === 1) return { ...desk, memoSlots: ['連絡あり', null] }
      return desk
    }))
    const { saved, remerged } = saveThenRemerge(week)
    expect(saved.summary.skippedDuplicateStudents).toBe(1)
    expect(saved.summary.kept).toBe(1)
    const savedDesk1 = cellOf(saved.nextWeeks).desks[1]
    expect(savedDesk1.lesson).toBeUndefined()
    expect(savedDesk1.teacher).toBe('鈴木')
    expect(savedDesk1.memoSlots).toEqual(['連絡あり', null])
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  it('不動点（L-7）: 兄弟＝Q21-11 に当たらない保存（講師だけのテンプレ机 2 を含む）も、保存 → 再マージ 1 回でセルは丸ごと変わらない', () => {
    const week = board((desks) => desks)
    const { saved, remerged } = saveThenRemerge(week)
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(cellOf(saved.nextWeeks).desks[2].teacherAssignmentTeacherId).toBe('t3')
    expect(cellOf(remerged)).toEqual(cellOf(saved.nextWeeks))
  })

  // L-7 の INV 監査（regression-reviewer 2026-09-30）で残った兄弟。どれも今回の修正の後退ではなく、Q21-11 が新しい発生源になる既存の穴。
  it.todo('不動点（L-7 兄弟）: 丸ごと振替の日（足場講師 strip）に Q21-11 で講師だけになった机も、保存 → 再マージ 1 回でセル丸ごと不変（今は講師名が消える見込み）')
  it.todo('不動点（L-7 兄弟）: 講師のいないテンプレ机が Q21-11 で完全に空になり、後ろに講師だけの机があっても、再マージで講師が前の机へずれない')
  it.todo('不動点（L-7 兄弟）: 保留中の再保存（Q29）で Q21-11 により空になったテンプレ机（下段が 1 行に戻る／保留のまま）も、保存 → 再マージ 1 回でセル丸ごと不変')

  it('後段: 別の机（机 1）の下段にだけ A が居るなら、机 0 の上段に A を置く。再マージ 1 回の後も生きている A は 1 か所（下段は数えない）', () => {
    // 机 1 に A の振替を手置き → 新テンプレの机 1 は B なので中身が違い保留（下段に A）
    const week = board((desks) => desks.map((desk, index) => (index === 1 ? { ...desk, lesson: mkLesson('hand-a', [makeupA('a-makeup'), null]) } : desk)))
    const { saved, remerged } = saveThenRemerge(week)
    const pendingKey = buildTemplatePendingDeskKey(CELL, `${CELL}_desk_2`)
    expect(saved.nextPendingDesks[pendingKey]?.lower.lesson?.studentSlots[0]?.managedStudentId).toBe('sA')
    expect(saved.summary.skippedDuplicateStudents).toBe(0)
    expect(saved.addedSuppressedRegularLessonOccurrences).toEqual([])
    expect(liveIdsAt(saved.nextWeeks, 0)).toEqual(['sA'])
    expect(liveCount(saved.nextWeeks, 'sA')).toBe(1)
    expect(liveCount(remerged, 'sA')).toBe(1)
    expect(liveIdsAt(remerged, 0)).toEqual(['sA'])
  })
})
