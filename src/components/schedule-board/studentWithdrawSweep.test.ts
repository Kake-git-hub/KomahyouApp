// 退塾スイープ(基本データの「退塾」→ 盤面の痕跡消し・オーナー確定 2026-09-20・確認リスト b-2 要改善)。
//
// 保証(docs/spec-invariants.md):
//   INV-06 在庫の実態一致 … 痕跡を消しても未消化(振替/講習)へは戻さず、消したことで在庫が湧きもしない。
//   INV-03 操作の冪等     … 一過性コマンドは 1 回だけ適用される(再マウント・2 回流しで結果が変わらない)。
//   INV-02 手動編集の永続化 … 昨日以前の盤面と他の生徒の手動編集は触らない。
//   INV-01 講師帰属の一意 … 席が空いた机の講師は既存の削除系と同じく触らない。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { StudentRow } from '../basic-data/basicDataModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { computeStudentWithdrawSweep, stripWithdrawnStudentsFromBoardWeek } from './ScheduleBoardScreen'
import {
  buildStudentWithdrawSweepMessage,
  consumeStudentWithdrawSweepRequest,
  enqueueStudentWithdrawSweepRequest,
  resolveStudentWithdrawSweepFromDateKey,
  selectStudentWithdrawSweepRequest,
  shouldProcessStudentWithdrawSweepRequest,
  type StudentWithdrawSweepRequest,
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

describe('退塾スイープの開始日とキュー(一過性コマンド)', () => {
  it('開始日は max(退塾日, 今日[JST])。過去の退塾日でも昨日以前は対象にしない', () => {
    expect(resolveStudentWithdrawSweepFromDateKey('2026-08-01', TODAY)).toBe(TODAY)
    expect(resolveStudentWithdrawSweepFromDateKey(TODAY, TODAY)).toBe(TODAY)
    expect(resolveStudentWithdrawSweepFromDateKey('2026-10-01', TODAY)).toBe('2026-10-01')
    // 未定・空・書式不正は今日から。
    expect(resolveStudentWithdrawSweepFromDateKey('未定', TODAY)).toBe(TODAY)
    expect(resolveStudentWithdrawSweepFromDateKey('', TODAY)).toBe(TODAY)
  })

  it('複数人を続けて退塾にしても取りこぼさない(キュー)。同じ生徒×同じ開始日は積み直さない', () => {
    const first: StudentWithdrawSweepRequest = { requestId: 1, studentId: 'sW', displayName: '退塾', fromDateKey: TODAY }
    const second: StudentWithdrawSweepRequest = { requestId: 2, studentId: 'sB', displayName: '在籍', fromDateKey: TODAY }
    const queue = enqueueStudentWithdrawSweepRequest(enqueueStudentWithdrawSweepRequest([], first), second)
    expect(queue.map((entry) => entry.requestId)).toEqual([1, 2])
    const again = enqueueStudentWithdrawSweepRequest(queue, { ...first, requestId: 3 })
    expect(again.map((entry) => entry.requestId)).toEqual([1, 2])
    // 先頭から 1 件ずつ処理し、処理した分だけキューから外す(Issue #46 同型の再発火防止)。
    expect(selectStudentWithdrawSweepRequest(queue)?.requestId).toBe(1)
    expect(shouldProcessStudentWithdrawSweepRequest(queue[0], null)).toBe(true)
    expect(shouldProcessStudentWithdrawSweepRequest(queue[0], 1)).toBe(false)
    const rest = consumeStudentWithdrawSweepRequest(queue, 1)
    expect(rest.map((entry) => entry.requestId)).toEqual([2])
    expect(selectStudentWithdrawSweepRequest([])).toBeNull()
    expect(shouldProcessStudentWithdrawSweepRequest(null, null)).toBe(false)
  })

  it('結果メッセージは件数を出し、0 件でも「痕跡が無かった」と分かる', () => {
    expect(buildStudentWithdrawSweepMessage('退塾', { removedSeatCount: 0, removedStatusCount: 0 })).toContain('ありませんでした')
    const message = buildStudentWithdrawSweepMessage('退塾', { removedSeatCount: 2, removedStatusCount: 1 })
    expect(message).toContain('コマ 2 件')
    expect(message).toContain('記録 1 件')
    expect(message).toContain('未消化へは戻していません')
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
  it('基本データは盤面を直接触らず、退塾の確定時に一過性コマンドを 1 回だけ依頼する', () => {
    const confirm = sliceFrom(BASIC_TSX, 'const confirmStudentWithdraw = () => {', 1400)
    expect(confirm).toContain('applyStudentWithdrawToday(current, withdrawModalState.id, today)')
    expect(confirm).toContain('onRequestStudentWithdrawSweep?.({ studentId: withdrawModalState.id, displayName: withdrawModalState.name, withdrawDateKey: today })')
    // 名簿の更新と依頼だけ。在庫・盤面の帳簿には触らない。
    expect(confirm).not.toContain('manualMakeupAdjustments')
    expect(confirm).not.toContain('manualLectureStockCounts')
  })

  it('App はキューへ積み、盤面の結果で必ず消費する。教室の差し替えとログアウトでキューを捨てる(INV-08)', () => {
    const request = sliceFrom(APP_TSX, 'const requestStudentWithdrawSweep = useCallback(', 900)
    expect(request).toContain('enqueueStudentWithdrawSweepRequest(current, {')
    expect(request).toContain('fromDateKey: resolveStudentWithdrawSweepFromDateKey(params.withdrawDateKey)')
    const processed = sliceFrom(APP_TSX, 'const handleStudentWithdrawSweepProcessed = useCallback(', 400)
    expect(processed).toContain('consumeStudentWithdrawSweepRequest(current, result.requestId)')
    // boardMountKey(教室の開き直し・復元・undo)とログアウトで捨てる。
    const boardMountEnd = APP_TSX.indexOf('}, [boardMountKey, setPendingParentAbsenceFinalize])')
    expect(boardMountEnd).toBeGreaterThan(0)
    const boardMountEffect = APP_TSX.slice(Math.max(0, boardMountEnd - 900), boardMountEnd)
    expect(boardMountEffect).toContain('setParentAbsenceRequest(null)')
    expect(boardMountEffect).toContain('setStudentWithdrawSweepRequests([])')
    const logout = sliceFrom(APP_TSX, 'const logout = useCallback(() => {', 900)
    expect(logout).toContain('setStudentWithdrawSweepRequests([])')
    // 盤面へ渡している(未マウントのときは処理されずキューで待つ)。
    expect(APP_TSX).toContain('studentWithdrawSweepRequests={studentWithdrawSweepRequests}')
    expect(APP_TSX).toContain('onStudentWithdrawSweepProcessed={handleStudentWithdrawSweepProcessed}')
    expect(APP_TSX).toContain('onRequestStudentWithdrawSweep={requestStudentWithdrawSweep}')
  })

  it('盤面は純関数 1 本で計算し、痕跡があるときだけ commitWeeks を 1 回通す(台帳・希望数は渡さない)', () => {
    const effect = sliceFrom(BOARD_TSX, 'const request = selectStudentWithdrawSweepRequest(studentWithdrawSweepRequests)', 2600)
    expect(effect).toContain('if (isTemplateMode) return')
    expect(effect).toContain('computeStudentWithdrawSweep({')
    expect(effect).toContain('processedStudentWithdrawSweepIdRef.current = target.requestId')
    expect(effect).toContain('if (sweep.changed) {')
    expect(effect).toContain('sweep.nextSuppressedMakeupOrigins,')
    // 在庫台帳は現状のまま渡す(増やさない)。「破棄前に台帳へ確定」も講習在庫の +1 もしない。
    expect(effect).toContain('manualMakeupAdjustments,')
    expect(effect).toContain('manualLectureStockCounts,')
    expect(effect).not.toContain('materializeDisplacedStatusEntryIntoLedgers')
    expect(effect).not.toContain('appendLectureStockCount')
    expect(effect).not.toContain('appendDeletedStudentScheduleCountAdjustment')
    expect(effect).not.toContain('scheduleCountAdjustments')
    // 結果は成功/0 件のどちらでも必ず返す(返さないと App が消費できず再マウントで再発火する)。
    expect(effect).toContain('onStudentWithdrawSweepProcessed?.({')
  })

  it('再マージ・読込の経路にスイープを混ぜない(毎回走ると INV-03/INV-06 違反になる)', () => {
    // 呼び出しは 1 か所(退塾コマンドの effect)だけ。
    expect([...BOARD_TSX.matchAll(/computeStudentWithdrawSweep\(\{/gu)]).toHaveLength(1)
    const remerge = sliceFrom(BOARD_TSX, 'export function remergeBoardWeekWithManagedData(', 1800)
    expect(remerge).not.toContain('computeStudentWithdrawSweep')
    expect(remerge).toContain('stripWithdrawnStudentsFromBoardWeek(rawWeek, params.students, params.todayKey)')
  })
})
