import { describe, expect, it } from 'vitest'

import { buildLinkedLessonDestinationMap, resolveMovedSourceDestinationLabel, resolveVisibleSlotDateLabel } from './lessonLinks'
import type { LessonType, StudentStatusKind } from './types'

// 緑が丘 室長報告(2026-09-04)「休みの振替を他の日に入れて出席にしたら、元コマの振替日が消える」の回帰防止。
// 振替コマを出席/振無休にすると studentSlots → statusSlots へ移るため、振替先の収集が配置(studentSlots)だけだと
// 元コマの「休」に添える振替先日付(リンク)が出席の瞬間に消えていた。在庫会計(collectMakeupUsageByKey)は出席済み
// 振替を消化として数えるので、表示だけが欠ける非対称だった。本番実データ(9/3 時点)で出席済み振替 13 件が全件リンク無し。
describe('buildLinkedLessonDestinationMap 出席済み振替への振替先リンク', () => {
  const absentStatus = {
    id: 'status-absent',
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'regular' as LessonType,
    status: 'absent' as StudentStatusKind,
  }
  const makeupOf = (status: StudentStatusKind, id = `status-${status}`) => ({
    id,
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'makeup' as LessonType,
    makeupSourceDate: '2026-04-01',
    makeupSourceLabel: '2026/4/1(水) 1限',
    status,
  })
  const placedMakeup = {
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'makeup' as LessonType,
    makeupSourceDate: '2026-04-01',
    makeupSourceLabel: '2026/4/1(水) 1限',
  }
  const originCell = { dateKey: '2026-04-01', slotNumber: 1, desks: [{ statusSlots: [absentStatus, null] }] }

  it('振替コマを出席にしても、元コマの休みから振替先へのリンクが維持される', () => {
    const cells = [
      originCell,
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('attended'), null] }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-absent')).toEqual({ dateKey: '2026-04-08', slotNumber: 2 })
  })

  it('振替コマを振無休にした場合も(消化済みなので)リンクを維持する', () => {
    const cells = [
      originCell,
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('absent-no-makeup'), null] }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-absent')).toEqual({ dateKey: '2026-04-08', slotNumber: 2 })
  })

  it('休みにした振替コマ・移動マーカーはリンク先にならず、実際に置かれているコマへリンクする', () => {
    const cells = [
      originCell,
      // 4/8 の振替は休み(在庫へ戻った)、4/10 は移動マーカー(会計は移動先が持つ)。どちらも振替先ではない。
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('absent'), null] }] },
      { dateKey: '2026-04-10', slotNumber: 3, desks: [{ statusSlots: [makeupOf('moved'), null] }] },
      { dateKey: '2026-04-15', slotNumber: 4, desks: [{ lesson: { studentSlots: [placedMakeup, null] } }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-absent')).toEqual({ dateKey: '2026-04-15', slotNumber: 4 })
  })

  it('出席済み振替しか無くても、休みだけの振替コマは振替先にしない', () => {
    const cells = [
      originCell,
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [makeupOf('absent'), null] }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).has('status-absent')).toBe(false)
  })
})

describe('resolveVisibleSlotDateLabel 移動日付の引き継ぎ防止', () => {
  // 回帰防止: 生徒を移動した先のスロットに、前の生徒の「移動元表示(moved)」ステータス(移)日付)が
  // 滞留していると、上書きしたはずの新しい生徒がその移動日付を引き継いで表示されていた不具合。
  // 実在の生徒が入っているスロットでは、ステータス由来の移動日付を表示してはいけない。
  it('実在の生徒がいるスロットでは滞留した moved ステータスの移動日付を引き継がない', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: true,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-08' },
      linkedDestinationDateKey: undefined,
    })

    expect(label).toBe('')
  })

  it('実在の振替生徒は自分の makeupSourceDate を表示する(滞留ステータスは無視)', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: true,
      hasContent: true,
      resolvedLessonType: 'makeup',
      effectiveMakeupSourceDate: '2026-04-10',
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-08' },
      linkedDestinationDateKey: undefined,
    })

    expect(label).toBe('4/10')
  })

  it('生徒がいない moved ステータスのみのスロットは移動先日付を表示する', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: false,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-08' },
      linkedDestinationDateKey: undefined,
    })

    expect(label).toBe('4/8')
  })

  it('実在の生徒がいるスロットではリンク先日付も引き継がない', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: true,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'absent', moveDestinationDateKey: undefined },
      linkedDestinationDateKey: '2026-04-12',
    })

    expect(label).toBe('')
  })
})

// ============================================================================
// 振替元「休)」表示(INV-06 / オーナー確定 2026-09-16・機能フラグ transferSourceRestDisplay)
//
// 生徒日程表の振替欄を「元コマ起点」に統一するため、リンク解決の**起点**を absent だけから
// absent / moved / holiday の 3 種へ広げた。ここが起点にならないと、移動元・休日記録の行に
// 振替先が出ず全部「未定」になる(＝修正なしでは下の 3 件が落ちる)。
// ★振替先(destination)側は従来どおり「配置 + 出席/振無休」だけ。moved/holiday を振替先にすると
//   「戻った振替」「移動元マーカー」「休日で消えたコマ」へ誤ってリンクする(既存ガードの維持)。
// ============================================================================
describe('buildLinkedLessonDestinationMap 移動元(moved)・休日記録(holiday)を起点にする', () => {
  const restStatus = (status: StudentStatusKind, id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'regular' as LessonType,
    status,
    ...overrides,
  })
  const placedMakeup = {
    managedStudentId: 'student-1',
    name: '青木 太郎',
    subject: '数' as const,
    lessonType: 'makeup' as LessonType,
    makeupSourceDate: '2026-04-01',
    makeupSourceLabel: '2026/4/1(水) 1限',
  }
  const destinationCell = { dateKey: '2026-04-15', slotNumber: 4, desks: [{ lesson: { studentSlots: [placedMakeup, null] } }] }

  it('移動元マーカー(moved)から、その授業が置かれた振替コマへリンクする', () => {
    const cells = [
      { dateKey: '2026-04-01', slotNumber: 1, desks: [{ statusSlots: [restStatus('moved', 'status-moved', { moveDestinationDateKey: '2026-04-15', moveDestinationSlotNumber: 4 }), null] }] },
      destinationCell,
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-moved')).toEqual({ dateKey: '2026-04-15', slotNumber: 4 })
  })

  it('休日記録(holiday)からも、その授業が置かれた振替コマへリンクする', () => {
    const cells = [
      { dateKey: '2026-04-01', slotNumber: 1, desks: [{ statusSlots: [restStatus('holiday', 'status-holiday'), null] }] },
      destinationCell,
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-holiday')).toEqual({ dateKey: '2026-04-15', slotNumber: 4 })
  })

  it('★元が振替コマの休日記録は起点にしない(元の通常授業日の記録が既にリンクを持つため二重になる)', () => {
    // 4/8 に置いた振替コマ(元=4/1)を休日設定で消した記録。absent と同じ規則で起点にしない。
    const cells = [
      {
        dateKey: '2026-04-08',
        slotNumber: 2,
        desks: [{ statusSlots: [restStatus('holiday', 'status-holiday-makeup', { lessonType: 'makeup' as LessonType, makeupSourceDate: '2026-04-01', makeupSourceLabel: '2026/4/1(水) 1限' }), null] }],
      },
      destinationCell,
    ]
    expect(buildLinkedLessonDestinationMap(cells).has('status-holiday-makeup')).toBe(false)
  })

  it('★moved は自分のコマ(記録が載っている日)を元コマとして引く(makeupSourceDate に引っ張られない)', () => {
    // 元の通常授業日(makeupSourceDate=4/1)を持つ生徒を 4/8 から別日へ動かしたケース。
    // 起点は「4/8 の 2 限」であって 4/1 ではない(4/1 を起点にすると別の休みのリンクを横取りする)。
    const cells = [
      {
        dateKey: '2026-04-08',
        slotNumber: 2,
        desks: [{ statusSlots: [restStatus('moved', 'status-moved-makeup', { lessonType: 'makeup' as LessonType, makeupSourceDate: '2026-04-01', makeupSourceLabel: '2026/4/1(水) 1限' }), null] }],
      },
      {
        dateKey: '2026-04-20',
        slotNumber: 5,
        desks: [{ lesson: { studentSlots: [{ ...placedMakeup, makeupSourceDate: '2026-04-08', makeupSourceLabel: '2026/4/8(水) 2限' }, null] } }],
      },
    ]
    expect(buildLinkedLessonDestinationMap(cells).get('status-moved-makeup')).toEqual({ dateKey: '2026-04-20', slotNumber: 5 })
  })

  it('moved / holiday は振替先(destination)にはならない(既存ガードの維持)', () => {
    const absentOrigin = restStatus('absent', 'status-absent')
    const cells = [
      { dateKey: '2026-04-01', slotNumber: 1, desks: [{ statusSlots: [absentOrigin, null] }] },
      // 4/8 は移動マーカー、4/10 は休日記録。どちらも「振替を実施したコマ」ではない。
      { dateKey: '2026-04-08', slotNumber: 2, desks: [{ statusSlots: [restStatus('moved', 'm1', { lessonType: 'makeup' as LessonType, makeupSourceDate: '2026-04-01', makeupSourceLabel: '2026/4/1(水) 1限' }), null] }] },
      { dateKey: '2026-04-10', slotNumber: 3, desks: [{ statusSlots: [restStatus('holiday', 'h1', { lessonType: 'makeup' as LessonType, makeupSourceDate: '2026-04-01', makeupSourceLabel: '2026/4/1(水) 1限' }), null] }] },
    ]
    expect(buildLinkedLessonDestinationMap(cells).has('status-absent')).toBe(false)
  })
})

describe('resolveVisibleSlotDateLabel 移動元マーカーは自分の移動先だけを出す', () => {
  // 回帰防止(2026-09-16): moved もリンク解決の起点になったため、moved にリンク先が付く。
  // 盤面の「移)日付」は従来どおり **moveDestinationDateKey だけ** を出す(機能フラグ OFF で挙動が変わらないように)。
  it('moveDestinationDateKey が無い古い moved 記録はリンク先があっても日付を出さない', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: false,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'moved', moveDestinationDateKey: undefined },
      linkedDestinationDateKey: '2026-04-12',
    })

    expect(label).toBe('')
  })

  it('休日記録(holiday)はリンク先日付を出す(振替先が決まっていれば盤面にも出る)', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: false,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'holiday', moveDestinationDateKey: undefined },
      linkedDestinationDateKey: '2026-04-12',
    })

    expect(label).toBe('4/12')
  })
})

// 確認リスト v1.5.555 その他欄(2026-09-22)「盤面で振替し、さらにそこから再度別日に振り替えたとき、元の授業の
// 振替先日が追いついていません。日程表は問題ない」の回帰防止。
// 通常授業 A(4/1 1限) → B(4/15 4限) へ動かすと A に moved 記録(moveDestinationDateKey = B)が残る。その振替コマを
// B → C(4/20 5限) へさらに動かしても A の記録が持つ B は書き換わらない(記録は移動時に 1 度だけ作る)。
// 生徒日程表はリンク解決(今その授業が置かれているコマ = C)を先に見るので正しく、盤面だけが B を出していた。
describe('resolveMovedSourceDestinationLabel 振替をさらに別日へ動かしたら元コマの日付も追随する(A→B→C)', () => {
  it('リンク先(今置かれているコマ C)があればそれを出し、自分が持つ移動先 B は使わない', () => {
    expect(resolveMovedSourceDestinationLabel('2026-04-15', '2026-04-20')).toBe('4/20')
  })

  it('リンクが引けない(移動先を休みにして未消化へ戻した 等)ときは自分が持つ移動先を出す(従来どおり)', () => {
    expect(resolveMovedSourceDestinationLabel('2026-04-15', undefined)).toBe('4/15')
    expect(resolveMovedSourceDestinationLabel('2026-04-15', '')).toBe('4/15')
  })

  it('★移動先日付を持たない古い moved 記録はリンク先があっても空のまま(2026-09-16 の回帰防止を維持)', () => {
    expect(resolveMovedSourceDestinationLabel(undefined, '2026-04-20')).toBe('')
  })

  it('盤面ラベル: 生徒のいない moved 記録のスロットはリンク先 C を出す(修正前は自分の B を出していた)', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: false,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-15' },
      linkedDestinationDateKey: '2026-04-20',
    })
    expect(label).toBe('4/20')
  })

  it('盤面ラベル: 実在の生徒がいるスロットでは(前の生徒の)moved 記録の日付をリンク先込みで引き継がない(ee5728c 維持)', () => {
    const label = resolveVisibleSlotDateLabel({
      hasStudent: true,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: { status: 'moved', moveDestinationDateKey: '2026-04-15' },
      linkedDestinationDateKey: '2026-04-20',
    })
    expect(label).toBe('')
  })

  it('端到端: A の moved 記録は、B から C へ動かした振替コマ(makeupSourceDate は元の A のまま)へリンクする', () => {
    const student = { managedStudentId: 'student-1', name: '青木 太郎', subject: '数' as const }
    const movedAtA = {
      id: 'status-moved-a',
      ...student,
      lessonType: 'regular' as LessonType,
      status: 'moved' as StudentStatusKind,
      moveDestinationDateKey: '2026-04-15',
      moveDestinationSlotNumber: 4,
    }
    // prepareStudentForMove は振替コマを動かしても makeupSourceDate(元の通常授業 A)を保つ。B には何も残らない。
    const placedAtC = {
      ...student,
      lessonType: 'makeup' as LessonType,
      makeupSourceDate: '2026-04-01',
      makeupSourceLabel: '2026/4/1(水) 1限',
    }
    const cells = [
      { dateKey: '2026-04-01', slotNumber: 1, desks: [{ statusSlots: [movedAtA, null] }] },
      { dateKey: '2026-04-15', slotNumber: 4, desks: [{ lesson: { studentSlots: [null, null] } }] },
      { dateKey: '2026-04-20', slotNumber: 5, desks: [{ lesson: { studentSlots: [placedAtC, null] } }] },
    ]
    const linked = buildLinkedLessonDestinationMap(cells).get('status-moved-a')
    expect(linked).toEqual({ dateKey: '2026-04-20', slotNumber: 5 })
    expect(resolveVisibleSlotDateLabel({
      hasStudent: false,
      hasContent: true,
      resolvedLessonType: 'regular',
      effectiveMakeupSourceDate: undefined,
      statusEntry: movedAtA,
      linkedDestinationDateKey: linked?.dateKey,
    })).toBe('4/20')
  })
})
