// 日程表コマ組み(spec-student-schedule-dnd)の回帰防止テスト。
// source 特定の頑健性(§D-2-2)・target の物理的空き検証・机選択モーダルの表示データと、
// computeStudentMove 経由の移動セマンティクス(通常=振替追加+抑制の両方/講習の科目・分数維持)を固定する。
import { describe, expect, it } from 'vitest'
import type { SlotCell, StudentEntry } from '../schedule-board/types'
import {
  buildDeskPickerDesks,
  findScheduleViewMoveSource,
  findScheduleViewTargetCell,
  parseScheduleViewMoveMessage,
  resolveScheduleViewTargetSeat,
  validateScheduleViewMoveTarget,
} from './scheduleViewMove'
import { computeStudentMove } from '../schedule-board/ScheduleBoardScreen'

function makeStudentEntry(overrides: Partial<StudentEntry> = {}): StudentEntry {
  return {
    id: 'entry-1',
    name: '山田太',
    managedStudentId: 'stu-1',
    grade: '中2',
    subject: '英',
    lessonType: 'regular',
    teacherType: 'normal',
    ...overrides,
  }
}

let cellSeq = 0
function makeCell(dateKey: string, slotNumber: number, desks: Array<Partial<SlotCell['desks'][number]>>, isOpenDay = true): SlotCell {
  cellSeq += 1
  const cellId = `cell-${dateKey}-${slotNumber}-${cellSeq}`
  return {
    id: cellId,
    dateKey,
    dayLabel: '月',
    dateLabel: `${Number(dateKey.split('-')[1])}/${Number(dateKey.split('-')[2])}`,
    slotLabel: `${slotNumber}限`,
    slotNumber,
    timeLabel: '16:20-17:50',
    isOpenDay,
    desks: desks.map((desk, index) => ({
      id: `${cellId}_desk_${index + 1}`,
      teacher: desk.teacher ?? '',
      ...desk,
    })),
  }
}

function makeLessonDesk(teacher: string, students: [StudentEntry | null, StudentEntry | null]) {
  return {
    teacher,
    lesson: { id: `lesson-${cellSeq}`, studentSlots: students },
  }
}

describe('scheduleViewMove: source の特定(§D-2-2)', () => {
  it('entryId で特定し、同一生徒が同コマに2科目持っていても取り違えない', () => {
    const englishEntry = makeStudentEntry({ id: 'entry-eng', subject: '英' })
    const mathEntry = makeStudentEntry({ id: 'entry-math', subject: '数' })
    const weeks: SlotCell[][] = [[
      makeCell('2026-07-06', 1, [
        makeLessonDesk('佐藤', [englishEntry, null]),
        makeLessonDesk('田中', [mathEntry, null]),
      ]),
    ]]
    const hit = findScheduleViewMoveSource(weeks, {
      entryId: 'entry-math', studentId: 'stu-1', sourceDateKey: '2026-07-06', sourceSlotNumber: 1,
      lessonType: 'regular', subject: '数', studentName: '山田太',
    })
    expect(hit).not.toBeNull()
    expect(hit!.deskIndex).toBe(1)
    expect(hit!.student.subject).toBe('数')
  })

  it('エントリが見つからない・生徒idが一致しない場合は null(移動不成立)', () => {
    const weeks: SlotCell[][] = [[
      makeCell('2026-07-06', 1, [makeLessonDesk('佐藤', [makeStudentEntry(), null])]),
    ]]
    expect(findScheduleViewMoveSource(weeks, {
      entryId: 'missing', studentId: 'stu-1', sourceDateKey: '2026-07-06', sourceSlotNumber: 1,
      lessonType: 'regular', subject: '英', studentName: '山田太',
    })).toBeNull()
    expect(findScheduleViewMoveSource(weeks, {
      entryId: 'entry-1', studentId: 'other-student', sourceDateKey: '2026-07-06', sourceSlotNumber: 1,
      lessonType: 'regular', subject: '英', studentName: '山田太',
    })).toBeNull()
  })
})

describe('scheduleViewMove: target の物理的空き検証(ルール・警告は評価しない)', () => {
  it('休校日・机なし・満席・メモ席は不成立、空席は成立', () => {
    const holidayCell = makeCell('2026-07-06', 1, [makeLessonDesk('佐藤', [null, null])], false)
    expect(validateScheduleViewMoveTarget(holidayCell, 0, 0)).toMatchObject({ ok: false })

    const openCell = makeCell('2026-07-07', 1, [
      makeLessonDesk('佐藤', [makeStudentEntry({ id: 'occupied' }), null]),
      { teacher: '田中', memoSlots: ['メモ', null] as [string | null, string | null] },
    ])
    expect(validateScheduleViewMoveTarget(openCell, 9, 0)).toMatchObject({ ok: false })
    expect(validateScheduleViewMoveTarget(openCell, 0, 0)).toMatchObject({ ok: false, reason: '移動先の席にはすでに生徒がいます。' })
    expect(validateScheduleViewMoveTarget(openCell, 1, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('メモ') })
    expect(validateScheduleViewMoveTarget(openCell, 0, 1)).toEqual({ ok: true })
  })

  it('findScheduleViewTargetCell は週をまたいで日付×時限のセルを見つける', () => {
    const weeks: SlotCell[][] = [
      [makeCell('2026-07-06', 1, [])],
      [makeCell('2026-07-13', 2, [])],
    ]
    expect(findScheduleViewTargetCell(weeks, '2026-07-13', 2)?.weekIndex).toBe(1)
    expect(findScheduleViewTargetCell(weeks, '2026-07-20', 1)).toBeNull()
  })
})

describe('scheduleViewMove: 机選択モーダルの表示データ', () => {
  it('着席生徒・メモ席・出欠記録つき空席を区別し、空席のみ selectable にする', () => {
    const cell = makeCell('2026-07-07', 3, [
      {
        teacher: '佐藤',
        lesson: { id: 'lesson-x', studentSlots: [makeStudentEntry({ name: '山田太', subject: '英' }), null] },
        memoSlots: [null, null] as [string | null, string | null],
      },
      {
        teacher: '田中',
        memoSlots: [null, 'メモあり'] as [string | null, string | null],
        statusSlots: [
          {
            id: 'st-1', studentId: 'stu-2', sourceManagedLesson: true, name: '鈴木', grade: '中1',
            subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中',
            dateKey: '2026-07-07', slotNumber: 3, recordedAt: 'r', status: 'absent', sourceLessonId: 'l1',
          },
          null,
        ] as SlotCell['desks'][number]['statusSlots'],
      },
    ])
    const desks = buildDeskPickerDesks(cell)
    expect(desks[0].seats[0]).toMatchObject({ occupied: true, selectable: false, label: '山田太 英' })
    expect(desks[0].seats[1]).toMatchObject({ occupied: false, selectable: true })
    // 欠席記録がある物理的空席: 選択可だが記録を表示する(知らずに上書きしないため)
    expect(desks[1].seats[0]).toMatchObject({ occupied: false, selectable: true, statusLabel: '休 鈴木' })
    expect(desks[1].seats[1]).toMatchObject({ occupied: false, selectable: false, blockedByMemo: true })
  })

  it('出席済みの物理的空席は selectable:false(欠席/振無休と違い配置不可)にする(2026-07-09 回帰防止)', () => {
    const cell = makeCell('2026-07-07', 3, [
      {
        teacher: '田中',
        memoSlots: [null, null] as [string | null, string | null],
        statusSlots: [
          {
            id: 'st-attended', studentId: 'stu-3', sourceManagedLesson: true, name: '出席花子', grade: '中1',
            subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中',
            dateKey: '2026-07-07', slotNumber: 3, recordedAt: 'r', status: 'attended', sourceLessonId: 'l2',
          },
          null,
        ] as SlotCell['desks'][number]['statusSlots'],
      },
    ])
    const desks = buildDeskPickerDesks(cell)
    // studentSlots は空(出席で除去済み)でも、statusSlots が attended なら selectable:false。
    expect(desks[0].seats[0]).toMatchObject({ occupied: false, selectable: false, statusLabel: '出席 出席花子' })
  })
})

describe('scheduleViewMove: computeStudentMove 経由の移動セマンティクス(方式非依存の確定事項)', () => {
  const emptyManagedMap = new Map()
  const displayName = (name: string) => name

  it('通常授業の別日移動は「移動先に振替」と「移動元当該日の抑制」の両方が入り、他週の通常は不変', () => {
    const movingEntry = makeStudentEntry({ id: 'entry-move', subject: '英', lessonType: 'regular', managedStudentId: 'stu-1' })
    const otherWeekEntry = makeStudentEntry({ id: 'entry-other-week', subject: '英', lessonType: 'regular', managedStudentId: 'stu-1' })
    const sourceCell = makeCell('2026-07-06', 1, [makeLessonDesk('佐藤', [movingEntry, null])])
    const targetCell = makeCell('2026-07-08', 2, [makeLessonDesk('田中', [null, null])])
    const otherWeekCell = makeCell('2026-07-13', 1, [makeLessonDesk('佐藤', [otherWeekEntry, null])])
    const weeks: SlotCell[][] = [[sourceCell, targetCell], [otherWeekCell]]

    const result = computeStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      movingStudentId: 'entry-move',
      cellId: targetCell.id,
      deskIndex: 0,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: emptyManagedMap,
      resolveBoardStudentDisplayName: displayName,
    })

    expect(result.status).toBe('moved')
    if (result.status !== 'moved') return
    const movedTarget = result.nextWeeks[0].find((cell) => cell.id === targetCell.id)!.desks[0].lesson!.studentSlots[0]!
    // 追加: 移動先には「その回だけの振替」として置かれる
    expect(movedTarget.lessonType).toBe('makeup')
    expect(movedTarget.makeupSourceDate).toBe('2026-07-06')
    expect(movedTarget.subject).toBe('英')
    // 抑制: 移動元当該日の managed occurrence キーが追加される(7/20振替消失事故の教訓: 両方必須)
    expect(result.nextSuppressedRegularLessonOccurrences).toContain('stu-1__英__2026-07-06__1')
    // 他週の同一生徒の通常授業は不変
    const untouched = result.nextWeeks[1].find((cell) => cell.id === otherWeekCell.id)!.desks[0].lesson!.studentSlots[0]!
    expect(untouched.lessonType).toBe('regular')
    expect(untouched.id).toBe('entry-other-week')
  })

  it('在席の席を選ぶと盤面同様に入れ替わる(相手が移動元へ振替で入る・resolveScheduleViewTargetSeat→computeStudentMove)', () => {
    const dragged = makeStudentEntry({ id: 'entry-drag', name: '山田', subject: '数', lessonType: 'makeup' })
    const occupant = makeStudentEntry({ id: 'entry-occ', name: '中野', subject: '英', lessonType: 'regular', managedStudentId: 'stu-nakano' })
    const sourceCell = makeCell('2026-08-05', 1, [makeLessonDesk('佐藤', [dragged, null])])
    const targetCell = makeCell('2026-08-05', 3, [makeLessonDesk('中川', [occupant, null])])
    const weeks: SlotCell[][] = [[sourceCell, targetCell]]

    // 在席(中野)を選んだ想定。studentIndex を敢えて 1(空席側)で送っても occupantEntryId で席0に解決される。
    const resolved = resolveScheduleViewTargetSeat(targetCell, {
      targetDateKey: '2026-08-05', targetSlotNumber: 3, deskIndex: 0, studentIndex: 1,
      deskId: targetCell.desks[0].id, deskTeacher: '中川', occupantEntryId: 'entry-occ',
    })
    expect(resolved).toEqual({ ok: true, deskIndex: 0, studentIndex: 0 })
    if (!resolved.ok) return

    const result = computeStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      movingStudentId: 'entry-drag',
      cellId: targetCell.id,
      deskIndex: resolved.deskIndex,
      studentIndex: resolved.studentIndex,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: emptyManagedMap,
      resolveBoardStudentDisplayName: displayName,
    })

    expect(result.status).toBe('moved')
    if (result.status !== 'moved') return
    expect(result.message).toContain('入れ替え')
    // 移動先席0 = 山田(移動してきた) / 移動元席0 = 中野(相手が移動元へ)
    expect(result.nextWeeks[0].find((c) => c.id === targetCell.id)!.desks[0].lesson!.studentSlots[0]!.id).toBe('entry-drag')
    expect(result.nextWeeks[0].find((c) => c.id === sourceCell.id)!.desks[0].lesson!.studentSlots[0]!.id).toBe('entry-occ')
  })

  it('講習カードの移動は選択科目(subject)と授業時間(noteSuffix)を維持する(v1.5.364 の回帰なし)', () => {
    const lectureEntry = makeStudentEntry({ id: 'entry-lecture', subject: '数', lessonType: 'special', noteSuffix: '60' })
    const sourceCell = makeCell('2026-07-06', 2, [makeLessonDesk('佐藤', [lectureEntry, null])])
    const targetCell = makeCell('2026-07-09', 4, [makeLessonDesk('田中', [null, null])])
    const weeks: SlotCell[][] = [[sourceCell, targetCell]]

    const result = computeStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      movingStudentId: 'entry-lecture',
      cellId: targetCell.id,
      deskIndex: 0,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: emptyManagedMap,
      resolveBoardStudentDisplayName: displayName,
    })

    expect(result.status).toBe('moved')
    if (result.status !== 'moved') return
    const moved = result.nextWeeks[0].find((cell) => cell.id === targetCell.id)!.desks[0].lesson!.studentSlots[0]!
    expect(moved.lessonType).toBe('special')
    expect(moved.subject).toBe('数')
    expect(moved.noteSuffix).toBe('60')
    // 講習は通常の抑制キー対象外
    expect(result.nextSuppressedRegularLessonOccurrences).toEqual([])
  })

  it('移動先が出席済みの席(studentSlots空・statusSlots=attended)なら blocked にする(2026-07-09 回帰防止: studentSlots依存だと素通りしていた)', () => {
    const movingEntry = makeStudentEntry({ id: 'entry-move-to-attended' })
    const sourceCell = makeCell('2026-07-06', 1, [makeLessonDesk('佐藤', [movingEntry, null])])
    const targetCell = makeCell('2026-07-08', 2, [
      {
        teacher: '田中',
        lesson: { id: 'lesson-target', studentSlots: [null, null] },
        statusSlots: [
          {
            id: 'st-attended', studentId: 'stu-9', sourceManagedLesson: true, name: '出席花子', grade: '中1',
            subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中',
            dateKey: '2026-07-08', slotNumber: 2, recordedAt: 'r', status: 'attended', sourceLessonId: 'l3',
          },
          null,
        ] as SlotCell['desks'][number]['statusSlots'],
      },
    ])
    const weeks: SlotCell[][] = [[sourceCell, targetCell]]

    const result = computeStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      movingStudentId: 'entry-move-to-attended',
      cellId: targetCell.id,
      deskIndex: 0,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: emptyManagedMap,
      resolveBoardStudentDisplayName: displayName,
    })

    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('出席済み')
  })

  it('移動先が欠席記録つき空席(statusSlots=absent)なら attended と違いブロックせず moved になる', () => {
    const movingEntry = makeStudentEntry({ id: 'entry-move-to-absent' })
    const sourceCell = makeCell('2026-07-06', 1, [makeLessonDesk('佐藤', [movingEntry, null])])
    const targetCell = makeCell('2026-07-08', 2, [
      {
        teacher: '田中',
        lesson: { id: 'lesson-target-absent', studentSlots: [null, null] },
        statusSlots: [
          {
            id: 'st-absent', studentId: 'stu-10', sourceManagedLesson: true, name: '欠席太郎', grade: '中1',
            subject: '数', lessonType: 'regular', teacherType: 'normal', teacherName: '田中',
            dateKey: '2026-07-08', slotNumber: 2, recordedAt: 'r', status: 'absent', sourceLessonId: 'l4',
          },
          null,
        ] as SlotCell['desks'][number]['statusSlots'],
      },
    ])
    const weeks: SlotCell[][] = [[sourceCell, targetCell]]

    const result = computeStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      movingStudentId: 'entry-move-to-absent',
      cellId: targetCell.id,
      deskIndex: 0,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: emptyManagedMap,
      resolveBoardStudentDisplayName: displayName,
    })

    expect(result.status).toBe('moved')
  })

  it('入力 weeks を破壊しない(盤面 Undo が1操作で戻れる前提)', () => {
    const movingEntry = makeStudentEntry({ id: 'entry-immutable' })
    const sourceCell = makeCell('2026-07-06', 1, [makeLessonDesk('佐藤', [movingEntry, null])])
    const targetCell = makeCell('2026-07-08', 2, [makeLessonDesk('田中', [null, null])])
    const weeks: SlotCell[][] = [[sourceCell, targetCell]]
    const before = JSON.stringify(weeks)

    const result = computeStudentMove({
      weeks,
      weekIndex: 0,
      cells: weeks[0],
      movingStudentId: 'entry-immutable',
      cellId: targetCell.id,
      deskIndex: 0,
      studentIndex: 0,
      suppressedRegularLessonOccurrences: [],
      managedStudentByAnyName: emptyManagedMap,
      resolveBoardStudentDisplayName: displayName,
    })

    expect(result.status).toBe('moved')
    expect(JSON.stringify(weeks)).toBe(before)
  })
})

describe('parseScheduleViewMoveMessage: 別タブからの移動要求メッセージ検証', () => {
  const validMessage = {
    type: 'schedule-student-move-request',
    source: {
      entryId: 'entry-1',
      studentId: 'stu-1',
      sourceDateKey: '2026-07-06',
      sourceSlotNumber: 1,
      lessonType: 'makeup',
      subject: '数',
      studentName: '山田太',
    },
    seat: { targetDateKey: '2026-07-08', targetSlotNumber: 3, deskIndex: 2, studentIndex: 1 },
  }

  it('正常な payload を {source, seat} に変換する', () => {
    const parsed = parseScheduleViewMoveMessage(validMessage)
    expect(parsed).not.toBeNull()
    expect(parsed!.source).toEqual({
      entryId: 'entry-1',
      studentId: 'stu-1',
      sourceDateKey: '2026-07-06',
      sourceSlotNumber: 1,
      lessonType: 'makeup',
      subject: '数',
      studentName: '山田太',
    })
    expect(parsed!.seat).toEqual({ targetDateKey: '2026-07-08', targetSlotNumber: 3, deskIndex: 2, studentIndex: 1 })
  })

  it('studentId は任意(欠けても成立し undefined になる)', () => {
    const { studentId: _omit, ...sourceWithoutId } = validMessage.source
    const parsed = parseScheduleViewMoveMessage({ ...validMessage, source: sourceWithoutId })
    expect(parsed).not.toBeNull()
    expect(parsed!.source.studentId).toBeUndefined()
  })

  it('必須フィールドが欠けたら null(移動不成立)', () => {
    expect(parseScheduleViewMoveMessage(null)).toBeNull()
    expect(parseScheduleViewMoveMessage({})).toBeNull()
    expect(parseScheduleViewMoveMessage({ ...validMessage, source: undefined })).toBeNull()
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: undefined })).toBeNull()
    expect(parseScheduleViewMoveMessage({ ...validMessage, source: { ...validMessage.source, entryId: '' } })).toBeNull()
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, targetDateKey: 123 } })).toBeNull()
  })

  it('席番号は 0/1 のみ・机番号は非負(範囲外は null)', () => {
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, studentIndex: 2 } })).toBeNull()
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, deskIndex: -1 } })).toBeNull()
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, studentIndex: 0 } })).not.toBeNull()
  })

  it('数値フィールドが文字列や NaN なら null(埋め込みJS由来の型崩れを弾く)', () => {
    expect(parseScheduleViewMoveMessage({ ...validMessage, source: { ...validMessage.source, sourceSlotNumber: '1' } })).toBeNull()
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, targetSlotNumber: Number.NaN } })).toBeNull()
  })

  // 「後から出席可能に変更」(2026-07-18): 別タブの確認ダイアログ承認を盤面へ運ぶ。
  // true 以外(欠落/文字列/false)は未承認扱い=盤面側が不可コマ着地を不成立にする(無確認の黄色化を防ぐ)。
  it('reopenApproved は true のときだけ seat に引き継ぐ', () => {
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, reopenApproved: true } })!.seat.reopenApproved).toBe(true)
    expect(parseScheduleViewMoveMessage(validMessage)!.seat.reopenApproved).toBeUndefined()
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, reopenApproved: 'true' } })!.seat.reopenApproved).toBeUndefined()
    expect(parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, reopenApproved: false } })!.seat.reopenApproved).toBeUndefined()
  })

  it('deskId/deskTeacher を seat に引き継ぐ(任意・机同一性で解決するため)', () => {
    const parsed = parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, deskId: 'd9', deskTeacher: '佐藤' } })
    expect(parsed!.seat.deskId).toBe('d9')
    expect(parsed!.seat.deskTeacher).toBe('佐藤')
    // deskTeacher は空文字(空席の机)も許容する。deskId 未指定は undefined。
    const emptyTeacher = parseScheduleViewMoveMessage({ ...validMessage, seat: { ...validMessage.seat, deskTeacher: '' } })
    expect(emptyTeacher!.seat.deskTeacher).toBe('')
    expect(parseScheduleViewMoveMessage(validMessage)!.seat.deskId).toBeUndefined()
  })
})

describe('resolveScheduleViewTargetSeat: 机・席の同一性での解決(並びのズレ/入れ替え対応)', () => {
  it('席の並びが日程表と盤面で食い違っても、実データの空き席へ解決する(空席なのに埋まっている扱いの根治)', () => {
    // 盤面: 中川机は席0に中野(占有)・席1が空き。日程表(モーダル)は左=席0を空きと見せ deskIndex/studentIndex=0 を送ってくる。
    const cell = makeCell('2026-08-05', 3, [
      makeLessonDesk('中川', [makeStudentEntry({ id: '中野-entry', name: '中野友莉花' }), null]),
    ])
    const resolved = resolveScheduleViewTargetSeat(cell, {
      targetDateKey: '2026-08-05', targetSlotNumber: 3, deskIndex: 0, studentIndex: 0,
      deskId: cell.desks[0].id, deskTeacher: '中川',
    })
    // 席0は占有なので、同じ机の実際の空き席(席1)へ解決される。
    expect(resolved).toEqual({ ok: true, deskIndex: 0, studentIndex: 1 })
  })

  it('deskId が盤面と食い違っても、机の在席者(deskOccupantEntryIds)で正しい机を特定する(8/5 中川机の根治)', () => {
    // 盤面: [0]=別の満席机, [1]=中川机(中野在席・席1空き)。モーダルの deskId は盤面と一致せず、positional=0 は満席。
    const cell = makeCell('2026-08-05', 3, [
      makeLessonDesk('田村', [makeStudentEntry({ id: 'x' }), makeStudentEntry({ id: 'y' })]),
      makeLessonDesk('中川', [makeStudentEntry({ id: '中野-entry', name: '中野友莉花' }), null]),
    ])
    const resolved = resolveScheduleViewTargetSeat(cell, {
      targetDateKey: '2026-08-05', targetSlotNumber: 3, deskIndex: 0, studentIndex: 0,
      deskId: 'stale-id-not-in-board', deskTeacher: '中川', deskOccupantEntryIds: ['中野-entry'],
    })
    // 在席者で中川机(index 1)を特定し、その空き席(席1)へ。
    expect(resolved).toEqual({ ok: true, deskIndex: 1, studentIndex: 1 })
  })

  it('在席生徒を選んだら(occupantEntryId)その生徒の席に解決する(=盤面の入れ替え)', () => {
    const cell = makeCell('2026-08-05', 3, [
      makeLessonDesk('中川', [makeStudentEntry({ id: '中野-entry', name: '中野友莉花' }), makeStudentEntry({ id: '他', name: '他生徒' })]),
    ])
    const resolved = resolveScheduleViewTargetSeat(cell, {
      targetDateKey: '2026-08-05', targetSlotNumber: 3, deskIndex: 0, studentIndex: 1,
      deskId: cell.desks[0].id, deskTeacher: '中川', occupantEntryId: '中野-entry',
    })
    expect(resolved).toEqual({ ok: true, deskIndex: 0, studentIndex: 0 })
  })

  it('deskId 未指定・deskIndex 範囲外でも講師名で机を解決する', () => {
    const cell = makeCell('2026-08-05', 3, [
      makeLessonDesk('佐藤', [makeStudentEntry({ id: 'a' }), null]),
      { teacher: '鈴木' },
    ])
    const resolved = resolveScheduleViewTargetSeat(cell, {
      targetDateKey: '2026-08-05', targetSlotNumber: 3, deskIndex: 9, studentIndex: 0, deskTeacher: '鈴木',
    })
    expect(resolved).toEqual({ ok: true, deskIndex: 1, studentIndex: 0 })
  })

  it('空きも入れ替え対象も無ければ ok:false + 盤面の実席内容つきの理由(診断)', () => {
    const cell = makeCell('2026-08-05', 3, [
      makeLessonDesk('中川', [makeStudentEntry({ id: 'p', name: '青木', subject: '数' }), makeStudentEntry({ id: 'q', name: '井上', subject: '英' })]),
    ])
    const resolved = resolveScheduleViewTargetSeat(cell, {
      targetDateKey: '2026-08-05', targetSlotNumber: 3, deskIndex: 0, studentIndex: 0,
      deskId: cell.desks[0].id, deskTeacher: '中川',
    })
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    // 診断: どの机で何が埋まっているかを理由に含める。
    expect(resolved.reason).toContain('中川')
    expect(resolved.reason).toContain('青木')
    expect(resolved.reason).toContain('井上')
  })
})
