// 退塾スイープ(退塾した生徒の今日以降の盤面の痕跡消し・オーナー確定 2026-09-20 夜・確認リスト b-2/b-3)。
//
// 2026-09-20 夜の改定: 「退塾ボタンが一過性コマンドを出す」方式 → **盤面が『退塾日を過ぎているのに痕跡が残る
// 生徒』を検出して掃除する**方式(日付入力で退塾日を入れた場合・未来の退塾日がその日を過ぎた場合も同じ消去が走る)。
//
// 保証(docs/spec-invariants.md):
//   INV-06 在庫の実態一致 … 痕跡を消しても未消化(振替/講習)へは戻さず、消したことで在庫が湧きもしない。
//   INV-03 操作の冪等     … 掃除は冪等(2 回目は対象 0・痕跡が無ければ何も変えない)。
//   INV-02 手動編集の永続化 … 昨日以前の盤面と他の生徒の手動編集は触らない。
//   INV-01 講師帰属の一意 … 席が空いた机の講師は既存の削除系と同じく触らない。
//   INV-08 教室分離 … 教室切替直後の窓では走らせない(検出は同じ教室の名簿 × 盤面でだけ行う)。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { computeStudentWithdrawSweep, stripWithdrawnStudentsFromBoardWeek } from './ScheduleBoardScreen'
import {
  buildStudentWithdrawSweepMessage,
  collectStudentWithdrawSweepTargets,
  resolveStudentWithdrawSweepFromDateKey,
} from './studentWithdrawSweep'

const YESTERDAY = '2026-09-19'
const TODAY = '2026-09-20'
const TOMORROW = '2026-09-21'
const MAKEUP_SOURCE = '2026-09-10'

const withdrawnStudent: StudentRow = {
  id: 'sW',
  name: '退塾 太郎',
  displayName: '退塾',
  email: '',
  entryDate: '2025-04-01',
  withdrawDate: TODAY,
  birthDate: '2012-05-01',
}
const stayingStudent: StudentRow = {
  id: 'sB',
  name: '在籍 花子',
  displayName: '在籍',
  email: '',
  entryDate: '2025-04-01',
  withdrawDate: '未定',
  birthDate: '2012-06-01',
}
const roster = [withdrawnStudent, stayingStudent]

const resolveStockId = (entry: StudentEntry) => entry.managedStudentId ?? entry.id

function seat(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'entry-1',
    name: '退塾 太郎',
    managedStudentId: 'sW',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

function status(overrides: Partial<StudentStatusEntry> = {}): StudentStatusEntry {
  return {
    id: 'status-1',
    studentId: 'sW',
    sourceManagedLesson: true,
    name: '退塾 太郎',
    managedStudentId: 'sW',
    grade: '中1',
    subject: '数',
    lessonType: 'regular',
    teacherType: 'normal',
    teacherName: '講師A',
    dateKey: TODAY,
    slotNumber: 1,
    recordedAt: `${TODAY}T10:00:00.000Z`,
    status: 'attended',
    sourceLessonId: 'lesson-1',
    ...overrides,
  }
}

function desk(overrides: Partial<DeskCell> = {}): DeskCell {
  return { id: 'desk-1', teacher: '講師A', ...overrides }
}

function cell(dateKey: string, desks: DeskCell[], overrides: Partial<SlotCell> = {}): SlotCell {
  return {
    id: `${dateKey}_1`,
    dateKey,
    dayLabel: '月',
    dateLabel: dateKey.slice(5),
    slotLabel: '1限',
    slotNumber: 1,
    timeLabel: '',
    isOpenDay: true,
    desks,
    ...overrides,
  }
}

function lesson(slots: [StudentEntry | null, StudentEntry | null]) {
  return { id: 'lesson-1', note: '', studentSlots: slots }
}

function sweep(weeks: SlotCell[][], overrides: { studentId?: string; fromDateKey?: string; suppressedMakeupOrigins?: Record<string, Array<{ dateKey: string; slotNumber?: number }>> } = {}) {
  return computeStudentWithdrawSweep({
    weeks,
    students: roster,
    studentId: overrides.studentId ?? 'sW',
    fromDateKey: overrides.fromDateKey ?? TODAY,
    suppressedMakeupOrigins: overrides.suppressedMakeupOrigins ?? {},
    resolveStockId,
  })
}

function ownedEntries(weeks: SlotCell[][]) {
  const found: string[] = []
  for (const week of weeks) {
    for (const current of week) {
      for (const currentDesk of current.desks) {
        for (const student of currentDesk.lesson?.studentSlots ?? []) {
          if (student?.managedStudentId === 'sW' || student?.name === '退塾 太郎') found.push(`${current.dateKey}:seat:${student.lessonType}`)
        }
        for (const entry of currentDesk.statusSlots ?? []) {
          if (entry?.managedStudentId === 'sW' || entry?.name === '退塾 太郎') found.push(`${current.dateKey}:status:${entry.status}`)
        }
      }
    }
  }
  return found
}

describe('退塾スイープの開始日と検出(collectStudentWithdrawSweepTargets)', () => {
  it('開始日は max(退塾日, 今日[JST])。過去の退塾日でも昨日以前は対象にしない', () => {
    expect(resolveStudentWithdrawSweepFromDateKey('2026-08-01', TODAY)).toBe(TODAY)
    expect(resolveStudentWithdrawSweepFromDateKey(TODAY, TODAY)).toBe(TODAY)
    expect(resolveStudentWithdrawSweepFromDateKey('2026-10-01', TODAY)).toBe('2026-10-01')
    // 未定・空・書式不正は今日から。
    expect(resolveStudentWithdrawSweepFromDateKey('未定', TODAY)).toBe(TODAY)
    expect(resolveStudentWithdrawSweepFromDateKey('', TODAY)).toBe(TODAY)
  })

  it('★退塾日当日から対象(共有の在籍判定 isStudentWithdrawnOnDate と同じ境界)。前日は対象外', () => {
    const weeks = [[cell(TODAY, [desk({ lesson: lesson([seat(), null]) })])]]
    // 退塾日 = 今日 ⇒ 今日から非在籍なので今日以降を掃除する。
    expect(collectStudentWithdrawSweepTargets({ weeks, students: roster, todayKey: TODAY }))
      .toEqual([{ studentId: 'sW', displayName: '退塾', fromDateKey: TODAY }])
    // 退塾日の前日(まだ在籍)は対象外。境界を「翌日から」へ動かすと在籍判定とずれるので固定する。
    expect(collectStudentWithdrawSweepTargets({ weeks, students: roster, todayKey: YESTERDAY })).toEqual([])
  })

  it('未来の退塾日は対象外(その日を過ぎてから最初に開いた時点で対象になる)', () => {
    const students = [{ ...withdrawnStudent, withdrawDate: TOMORROW }, stayingStudent]
    const weeks = [[cell(TOMORROW, [desk({ lesson: lesson([seat(), null]) })])]]
    expect(collectStudentWithdrawSweepTargets({ weeks, students, todayKey: TODAY })).toEqual([])
    expect(collectStudentWithdrawSweepTargets({ weeks, students, todayKey: TOMORROW }))
      .toEqual([{ studentId: 'sW', displayName: '退塾', fromDateKey: TOMORROW }])
  })

  it('昨日以前にしか痕跡が無い生徒・在籍中の生徒は対象にしない(開いただけで未保存にしない)', () => {
    const weeks = [[
      cell(YESTERDAY, [desk({ lesson: lesson([seat(), null]), statusSlots: [status({ dateKey: YESTERDAY }), null] })]),
      cell(TODAY, [desk({ id: 'other', lesson: lesson([seat({ id: 'stay', managedStudentId: 'sB', name: '在籍 花子' }), null]) })]),
    ]]
    expect(collectStudentWithdrawSweepTargets({ weeks, students: roster, todayKey: TODAY })).toEqual([])
  })

  it('managedStudentId の無い古い席は名簿で一意な名前で拾う。同名 2 人は拾わない(取り違え防止)', () => {
    const weeks = [[cell(TODAY, [desk({ lesson: lesson([seat({ managedStudentId: undefined }), null]) })])]]
    expect(collectStudentWithdrawSweepTargets({ weeks, students: roster, todayKey: TODAY }).map((target) => target.studentId)).toEqual(['sW'])
    const duplicatedRoster = [withdrawnStudent, { ...stayingStudent, id: 'sC', name: '退塾 太郎', displayName: '退塾' }]
    expect(collectStudentWithdrawSweepTargets({ weeks, students: duplicatedRoster, todayKey: TODAY })).toEqual([])
  })

  it('複数人が退塾していれば名簿順にまとめて返し、掃除を通すと 2 回目は対象 0(冪等)', () => {
    const students = [withdrawnStudent, { ...stayingStudent, withdrawDate: TODAY }]
    const weeks = [[cell(TODAY, [
      desk({ lesson: lesson([seat(), seat({ id: 'stay-seat', managedStudentId: 'sB', name: '在籍 花子' })]) }),
    ])]]
    const targets = collectStudentWithdrawSweepTargets({ weeks, students, todayKey: TODAY })
    expect(targets.map((target) => target.studentId)).toEqual(['sW', 'sB'])

    // 盤面側と同じ「対象者ぶんを順に適用して 1 回で確定」の流れ。
    let nextWeeks = weeks
    let suppressed: Record<string, Array<{ dateKey: string; slotNumber?: number }>> = {}
    for (const target of targets) {
      const result = computeStudentWithdrawSweep({
        weeks: nextWeeks,
        students,
        studentId: target.studentId,
        fromDateKey: target.fromDateKey,
        suppressedMakeupOrigins: suppressed,
        resolveStockId,
      })
      nextWeeks = result.nextWeeks
      suppressed = result.nextSuppressedMakeupOrigins
    }
    expect(nextWeeks[0][0].desks[0].lesson).toBeUndefined()
    expect(collectStudentWithdrawSweepTargets({ weeks: nextWeeks, students, todayKey: TODAY })).toEqual([])
  })

  it('結果メッセージは合計件数と名前を出す(1 人・複数人)。0 件なら空文字(=何も知らせない)', () => {
    expect(buildStudentWithdrawSweepMessage([{ displayName: '退塾', removedSeatCount: 0, removedStatusCount: 0 }])).toBe('')
    const single = buildStudentWithdrawSweepMessage([{ displayName: '退塾', removedSeatCount: 2, removedStatusCount: 1 }])
    expect(single).toContain('退塾 の今日以降のコマ 2 件・記録 1 件')
    expect(single).toContain('未消化へは戻していません')
    const many = buildStudentWithdrawSweepMessage([
      { displayName: '退塾', removedSeatCount: 1, removedStatusCount: 0 },
      { displayName: '在籍', removedSeatCount: 2, removedStatusCount: 3 },
    ])
    expect(many).toContain('退塾した生徒 2 名(退塾・在籍)')
    expect(many).toContain('コマ 3 件・記録 3 件')
  })
})

describe('computeStudentWithdrawSweep(今日以降の痕跡を消し切る)', () => {
  it('今日以降の席(講習・振替・増コマ・体験・手動追加・移動)と記録が消え、昨日以前は同じ参照のまま残る', () => {
    const pastDesk = desk({
      id: 'past',
      lesson: lesson([seat({ id: 'past-seat', lessonType: 'special', specialSessionId: 'sess-1' }), null]),
      statusSlots: [status({ id: 'past-status', dateKey: YESTERDAY, status: 'absent' }), null],
    })
    const todayDesk = desk({
      lesson: lesson([seat({ id: 'today-special', lessonType: 'special', specialSessionId: 'sess-1' }), seat({ id: 'stay-regular', managedStudentId: 'sB', name: '在籍 花子' })]),
      statusSlots: [null, status({ id: 'stay-status', managedStudentId: 'sB', studentId: 'sB', name: '在籍 花子' })],
    })
    const todayDesk2 = desk({
      id: 'desk-2',
      statusSlots: [status({ id: 'today-moved', status: 'moved', lessonType: 'regular' }), status({ id: 'today-absent', status: 'absent', subject: '英' })],
    })
    const tomorrowDesk = desk({
      id: 'desk-3',
      lesson: lesson([
        seat({ id: 'tomorrow-makeup', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE }),
        seat({ id: 'tomorrow-extra', lessonType: 'extra', subject: '英' }),
      ]),
    })
    const tomorrowDesk2 = desk({
      id: 'desk-4',
      lesson: lesson([seat({ id: 'tomorrow-trial', lessonType: 'trial', managedStudentId: undefined }), null]),
      statusSlots: [null, status({ id: 'tomorrow-manual', dateKey: TOMORROW, manualAdded: true, status: 'attended' })],
    })
    const pastCell = cell(YESTERDAY, [pastDesk])
    const weeks = [[pastCell, cell(TODAY, [todayDesk, todayDesk2]), cell(TOMORROW, [tomorrowDesk, tomorrowDesk2])]]

    const result = sweep(weeks)
    expect(result.changed).toBe(true)
    // 今日以降の痕跡はすべて消えている(種別を問わない)。
    expect(ownedEntries(result.nextWeeks).filter((entry) => !entry.startsWith(YESTERDAY))).toEqual([])
    // 昨日以前は「同じ参照」で残る(請求・通常授業履歴の根拠。遡って削らない)。
    expect(result.nextWeeks[0][0]).toBe(pastCell)
    expect(ownedEntries(result.nextWeeks)).toEqual([`${YESTERDAY}:seat:special`, `${YESTERDAY}:status:absent`])
    expect(result.removedSeatCount).toBe(4)
    expect(result.removedStatusCount).toBe(3)
    // 他の生徒の席・記録は不変。
    const sweptToday = result.nextWeeks[0][1]
    expect(sweptToday.desks[0].lesson?.studentSlots[1]?.managedStudentId).toBe('sB')
    expect(sweptToday.desks[0].statusSlots?.[1]?.managedStudentId).toBe('sB')
  })

  it('痕跡が昨日以前にしか無ければ何も変えない(commit しない=空の Undo を積まない)', () => {
    const weeks = [[cell(YESTERDAY, [desk({ lesson: lesson([seat(), null]), statusSlots: [status({ dateKey: YESTERDAY }), null] })]), cell(TODAY, [desk({ id: 'empty' })])]]
    const result = sweep(weeks)
    expect(result.changed).toBe(false)
    expect(result.nextWeeks).toBe(weeks)
    expect(result.removedSeatCount).toBe(0)
    expect(result.removedStatusCount).toBe(0)
  })

  it('席が空いた机の講師(manualTeacher)とメモは触らない(INV-01・既存の削除系と同じ)', () => {
    const memoSlots: [string | null, string | null] = ['帰りの連絡あり', null]
    const weeks = [[cell(TODAY, [desk({
      teacher: '講師M',
      manualTeacher: true,
      teacherAssignmentSource: 'manual',
      teacherAssignmentTeacherId: 'tM',
      memoSlots,
      lesson: lesson([seat({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE }), null]),
    })])]]
    const result = sweep(weeks)
    const sweptDesk = result.nextWeeks[0][0].desks[0]
    expect(sweptDesk.lesson).toBeUndefined()
    expect(sweptDesk).toMatchObject({ teacher: '講師M', manualTeacher: true, teacherAssignmentSource: 'manual', teacherAssignmentTeacherId: 'tM' })
    expect(sweptDesk.memoSlots).toEqual(memoSlots)
  })

  it('INV-06: 在庫台帳は一切増やさず、席を消して在庫が湧く分だけ抑止へ積む(振替=振替元日 / 通常=元の通常授業日)', () => {
    const weeks = [[cell(TODAY, [
      desk({ lesson: lesson([seat({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE }), null]) }),
      desk({ id: 'desk-2', lesson: lesson([seat({ id: 'manual-regular', subject: '英', manualAdded: true }), null]) }),
      desk({ id: 'desk-3', lesson: lesson([seat({ id: 'lecture', subject: '国', lessonType: 'special', specialSessionId: 'sess-1' }), null]) }),
    ])]]
    const result = sweep(weeks)
    // 振替は振替元日、通常は当日(= 元の通常授業日)を抑止。講習は在庫が盤面走査ではないので積まない。
    expect(result.nextSuppressedMakeupOrigins).toEqual({
      sW__数: [{ dateKey: MAKEUP_SOURCE }],
      sW__英: [{ dateKey: TODAY }],
    })
    // 返り値に台帳(manualMakeupAdjustments / manualLectureStockCounts / 希望数)は無い＝構造的に増えない。
    expect(Object.keys(result).sort()).toEqual(['changed', 'nextSuppressedMakeupOrigins', 'nextWeeks', 'removedSeatCount', 'removedStatusCount'])
  })

  it('INV-06: 出欠記録は消化に数える種別だけ抑止する(休み・移動元・休)の記録には積まない=立っている在庫を消さない)', () => {
    const weeks = [[cell(TODAY, [
      // 休み(absent)の通常授業: 台帳に origin が立っているので抑止しない(誤減防止)。
      desk({ statusSlots: [status({ status: 'absent' }), null] }),
      // 移動元(moved)の通常授業: 会計は移動先の振替コマが持つので抑止しない。
      desk({ id: 'desk-2', statusSlots: [status({ id: 's2', subject: '英', status: 'moved' }), null] }),
      // 出席済みの振替コマ: 消化に数えられているので、消すと台帳 origin が再浮上する → 振替元日を抑止する。
      desk({ id: 'desk-3', statusSlots: [status({ id: 's3', subject: '国', status: 'attended', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE }), null] }),
      // 休み(absent)の振替コマ: 消化に数えないので抑止しない(算出 origin は記録が消えれば一緒に消える)。
      desk({ id: 'desk-4', statusSlots: [status({ id: 's4', subject: '理', status: 'absent', lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE }), null] }),
    ])]]
    const result = sweep(weeks)
    expect(result.nextSuppressedMakeupOrigins).toEqual({ sW__国: [{ dateKey: MAKEUP_SOURCE }] })
    expect(result.removedStatusCount).toBe(4)
  })

  it('INV-03: 同じコマンドを 2 回流しても結果は同じ(2 回目は何も変えない)。剥がしを続けて通しても増えない', () => {
    const weeks = [[cell(TODAY, [desk({ lesson: lesson([seat({ lessonType: 'makeup', makeupSourceDate: MAKEUP_SOURCE }), null]), statusSlots: [null, status({ id: 'st', subject: '英' })] })])]]
    const first = sweep(weeks)
    const second = sweep(first.nextWeeks, { suppressedMakeupOrigins: first.nextSuppressedMakeupOrigins })
    expect(second.changed).toBe(false)
    expect(second.nextWeeks).toBe(first.nextWeeks)
    expect(second.nextSuppressedMakeupOrigins).toBe(first.nextSuppressedMakeupOrigins)
    // 退塾生徒の剥がし(再マージの先頭で走る派生処理)を通しても、消えたままで在庫にも触らない。
    const stripped = stripWithdrawnStudentsFromBoardWeek(first.nextWeeks[0], roster, TODAY)
    expect(ownedEntries([stripped])).toEqual([])
  })

  it('managedStudentId を持たない古い席は「名簿で一意な名前」で拾う。同名が 2 人いるときは拾わない(取り違え防止)', () => {
    const weeks = [[cell(TODAY, [desk({ lesson: lesson([seat({ managedStudentId: undefined, lessonType: 'trial' }), null]) })])]]
    expect(sweep(weeks).removedSeatCount).toBe(1)
    const duplicated = computeStudentWithdrawSweep({
      weeks,
      students: [withdrawnStudent, { ...stayingStudent, id: 'sC', name: '退塾 太郎', displayName: '退塾' }],
      studentId: 'sW',
      fromDateKey: TODAY,
      suppressedMakeupOrigins: {},
      resolveStockId,
    })
    expect(duplicated.changed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 配線ガード(source-scan)。巨大コンポーネントのクロージャは描画テストができないので、
// 落とすと事故になる配線(再マージへ混ぜない・結果を必ず返す・台帳を触らない)を字面で固定する。
// ---------------------------------------------------------------------------
const BOARD_TSX = readFileSync(fileURLToPath(new URL('./ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')
const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const BASIC_TSX = readFileSync(fileURLToPath(new URL('../basic-data/BasicDataScreen.tsx', import.meta.url)), 'utf8')

function sliceFrom(source: string, marker: string, length: number): string {
  const index = source.indexOf(marker)
  expect(index, `marker not found: ${marker}`).toBeGreaterThan(0)
  return source.slice(index, index + length)
}

describe('退塾スイープの配線', () => {
  it('基本データは盤面を直接触らず、名簿に退塾日を記録するだけ(命令を送る経路を作らない)', () => {
    const confirm = sliceFrom(BASIC_TSX, 'const confirmStudentWithdraw = () => {', 1400)
    expect(confirm).toContain('applyStudentWithdrawToday(current, withdrawModalState.id, today)')
    // 在庫・盤面の帳簿にも触らない。掃除は盤面側の検出に任せる(日付入力での退塾と同じ経路にするため)。
    expect(confirm).not.toContain('manualMakeupAdjustments')
    expect(confirm).not.toContain('manualLectureStockCounts')
    expect(BASIC_TSX).not.toContain('onRequestStudentWithdrawSweep')
  })

  it('App はキュー(一過性コマンド)を持たず、教室の一致ガードだけを盤面へ渡す(INV-08)', () => {
    // 撤去した二重経路を復活させない。
    expect(APP_TSX).not.toContain('studentWithdrawSweepRequests')
    expect(APP_TSX).not.toContain('enqueueStudentWithdrawSweepRequest')
    expect(APP_TSX).not.toContain('onRequestStudentWithdrawSweep')
    // 掃除を許すのは「いま画面にある編集 state が、開いている教室から読み込まれたもの」のときだけ。
    expect(APP_TSX).toContain('isEditingStateLoadedForActingClassroom={Boolean(actingClassroomId) && loadedEditingClassroomIdRef.current === actingClassroomId}')
  })

  it('★教室切替の窓: 名簿と盤面と再マウントは同じ更新バッチで差し替わる(applyClassroomPayloadToState)', () => {
    // この不変条件が崩れると「前の教室の名簿 × 新しい教室の盤面」で掃除しうる(sNNN は教室ごと独立採番)。
    const apply = sliceFrom(APP_TSX, 'function applyClassroomPayloadToState(', 2000)
    expect(apply).toContain('handlers.setStudents(sanitizedPayload.students)')
    expect(apply).toContain('handlers.setBoardState(sanitizedPayload.boardState)')
    expect(apply).toContain('handlers.setBoardMountKey?.((prev) => prev + 1)')
  })

  it('盤面は検出 → 対象者ぶんを適用 → commitWeeks 1 回(台帳・希望数は渡さない・テンプレ編集中は走らせない)', () => {
    const effect = sliceFrom(BOARD_TSX, 'const targets = collectStudentWithdrawSweepTargets({', 2600)
    expect(effect).toContain('if (targets.length === 0) return')
    expect(effect).toContain('computeStudentWithdrawSweep({')
    expect(effect).toContain('if (!changed) return')
    expect(effect).toContain('nextSuppressedMakeupOrigins,')
    // 在庫台帳は現状のまま渡す(増やさない)。「破棄前に台帳へ確定」も講習在庫の +1 もしない。
    expect(effect).toContain('manualMakeupAdjustments,')
    expect(effect).toContain('manualLectureStockCounts,')
    expect(effect).not.toContain('materializeDisplacedStatusEntryIntoLedgers')
    expect(effect).not.toContain('appendLectureStockCount')
    expect(effect).not.toContain('appendDeletedStudentScheduleCountAdjustment')
    expect(effect).not.toContain('scheduleCountAdjustments')
    // 安全条件(テンプレ編集中・教室切替直後の窓・名簿未ロード)は effect の先頭で弾く。
    const guards = sliceFrom(BOARD_TSX, 'if (isTemplateMode) return\r\n    if (!isEditingStateLoadedForActingClassroom) return', 200)
    expect(guards).toContain('if (students.length === 0) return')
  })

  it('再マージ・読込の経路にスイープを混ぜない(毎回走ると INV-03/INV-06 違反になる)', () => {
    // 呼び出しは 1 か所(検出 effect)だけ。
    expect([...BOARD_TSX.matchAll(/computeStudentWithdrawSweep\(\{/gu)]).toHaveLength(1)
    expect([...BOARD_TSX.matchAll(/collectStudentWithdrawSweepTargets\(\{/gu)]).toHaveLength(1)
    const remerge = sliceFrom(BOARD_TSX, 'export function remergeBoardWeekWithManagedData(', 1800)
    expect(remerge).not.toContain('computeStudentWithdrawSweep')
    expect(remerge).toContain('stripWithdrawnStudentsFromBoardWeek(rawWeek, params.students, params.todayKey)')
  })
})
