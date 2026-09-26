import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SlotCell } from '../schedule-board/types'
import { compactBoardSharePayload, selectBoardShareLinkResolutionCells, type BoardShareStatusEntry } from '../../integrations/firebase/boardShare'
import { buildLinkedLessonDestinationMap } from '../schedule-board/lessonLinks'
import { getVisibleDateLabel, resolveBoardShareLinkedDestinationDateKey } from './BoardShareScreen'

// 回帰防止(緑が丘 室長指摘 2026-09-26・Issue #70 のやり取り):
// 通常授業 9/22 を 9/29 へ振替 → その振替コマを 9/17(今週より前の週)へ動かし直すと、盤面の 9/22 は「9/17」を出すのに、
// 講師日程共有(配布用盤面)は「9/29」のままだった。
// 真因 = 共有するセルは今週以降だけ(App selectBoardShareCells)で、共有画面は**共有セルの中だけ**でリンクを解決していた。
// 9/17 の週は共有されないのでリンクが見つからず、移動元記録が持つ古い移動先日付(9/29)にフォールバックしていた。
// 修正 = 公開時に盤面の全週(linkResolutionCells)でリンクを解決し、記録に linkedDestinationDateKey として載せる。
// INV-04(盤面／配布用盤面／日程表の内容一致)。

type StatusInput = { id: string, status: 'moved' | 'absent', moveDestinationDateKey?: string, lessonType?: 'regular' | 'makeup', makeupSourceDate?: string }

function buildCell(dateKey: string, slotNumber: number, options: { status?: StatusInput, makeupFrom?: string } = {}): SlotCell {
  const { status, makeupFrom } = options
  const statusEntry = status
    ? {
        id: status.id,
        studentId: 'st-1',
        name: '生徒A',
        managedStudentId: 's001',
        grade: '中2',
        subject: '数',
        lessonType: status.lessonType ?? 'regular',
        teacherType: 'normal',
        status: status.status,
        makeupSourceDate: status.makeupSourceDate,
        moveDestinationDateKey: status.moveDestinationDateKey,
        recordedAt: '2026-09-20T00:00:00.000Z',
      }
    : null
  const makeupStudent = makeupFrom
    ? {
        id: `st-${dateKey}`,
        name: '生徒A',
        managedStudentId: 's001',
        grade: '中2',
        subject: '数',
        lessonType: 'makeup',
        teacherType: 'normal',
        makeupSourceDate: makeupFrom,
        makeupSourceLabel: `${makeupFrom.replace(/-/g, '/')}(火) ${slotNumber}限`,
      }
    : null
  return {
    id: `${dateKey}_${slotNumber}`,
    dateKey,
    dayLabel: '',
    dateLabel: dateKey.slice(5),
    slotLabel: `${slotNumber}限`,
    slotNumber,
    isOpenDay: true,
    desks: [{
      id: 'desk-1',
      teacher: '講師A',
      statusSlots: [statusEntry, null],
      lesson: makeupStudent ? { id: `lesson-${dateKey}`, studentSlots: [makeupStudent, null] } : undefined,
    }],
  } as unknown as SlotCell
}

const baseInput = { schemaVersion: 1 as const, token: 't', classroomId: 'c', classroomName: '教室', sharedAt: '' }

function sharedStatus(payload: ReturnType<typeof compactBoardSharePayload>, dateKey: string) {
  const cell = payload.cells.find((entry) => entry.dateKey === dateKey)
  return (cell?.desks[0]?.statusSlots?.[0] ?? null) as BoardShareStatusEntry | null
}

describe('講師日程共有: 振替先が今週より前の週にあっても振替先日付が盤面に追従する', () => {
  // 盤面の全週: 9/17(前の週)に振替コマ、9/22 に移動元記録(移動先 9/29 のまま)、9/29 は空き。
  const pastWeekCell = buildCell('2026-09-17', 3, { makeupFrom: '2026-09-22' })
  const movedSourceCell = buildCell('2026-09-22', 3, { status: { id: 'moved-0922', status: 'moved', moveDestinationDateKey: '2026-09-29' } })
  const emptyDestinationCell = buildCell('2026-09-29', 3)
  // 共有するのは今週以降だけ(9/17 の週は含まない)。
  const sharedCells = [movedSourceCell, emptyDestinationCell]
  const allCells = [pastWeekCell, ...sharedCells]

  it('公開時に全週で解決した振替先(9/17)を記録に載せ、共有画面は 9/17 を出す', () => {
    const payload = compactBoardSharePayload({ ...baseInput, cells: sharedCells, linkResolutionCells: allCells })
    const status = sharedStatus(payload, '2026-09-22')
    expect(status?.linkedDestinationDateKey).toBe('2026-09-17')

    // 共有画面側: 共有セルだけのリンク解決では見つからないが、公開時の値を優先して 9/17 を出す。
    const viewerMap = buildLinkedLessonDestinationMap(payload.cells)
    expect(viewerMap.get('moved-0922')).toBeUndefined()
    const linked = resolveBoardShareLinkedDestinationDateKey(status, viewerMap)
    expect(getVisibleDateLabel(status, status, { dateKey: '2026-09-22' }, linked)).toBe('9/17')
  })

  it('解決用のセルは公開ドキュメントに載せない(サイズ・共有範囲を広げない)', () => {
    const payload = compactBoardSharePayload({ ...baseInput, cells: sharedCells, linkResolutionCells: allCells })
    expect('linkResolutionCells' in payload).toBe(false)
    expect(payload.cells.map((cell) => cell.dateKey)).toEqual(['2026-09-22', '2026-09-29'])
  })

  it('修正前の形(共有セルだけで解決)では古い 9/29 が出る＝この経路を固定する', () => {
    const payload = compactBoardSharePayload({ ...baseInput, cells: sharedCells })
    const status = sharedStatus(payload, '2026-09-22')
    expect(status?.linkedDestinationDateKey).toBeUndefined()
    const linked = resolveBoardShareLinkedDestinationDateKey(status, buildLinkedLessonDestinationMap(payload.cells))
    expect(getVisibleDateLabel(status, status, { dateKey: '2026-09-22' }, linked)).toBe('9/29')
  })

  it('兄弟: 欠席(休)の振替先が前の週にあるときも日付を出す', () => {
    const absentCell = buildCell('2026-09-22', 3, { status: { id: 'absent-0922', status: 'absent' } })
    const payload = compactBoardSharePayload({ ...baseInput, cells: [absentCell], linkResolutionCells: [pastWeekCell, absentCell] })
    const status = sharedStatus(payload, '2026-09-22')
    expect(status?.linkedDestinationDateKey).toBe('2026-09-17')
    const linked = resolveBoardShareLinkedDestinationDateKey(status, buildLinkedLessonDestinationMap(payload.cells))
    expect(getVisibleDateLabel(status, status, { dateKey: '2026-09-22' }, linked)).toBe('9/17')
  })

  it('旧ドキュメント(linkedDestinationDateKey 無し)は共有セルから解決する(後方互換)', () => {
    const viewerMap = new Map([['moved-0922', { dateKey: '2026-10-06' }]])
    expect(resolveBoardShareLinkedDestinationDateKey({ id: 'moved-0922' }, viewerMap)).toBe('2026-10-06')
    expect(resolveBoardShareLinkedDestinationDateKey({ id: 'moved-0922', linkedDestinationDateKey: '2026-09-17' }, viewerMap)).toBe('2026-09-17')
    expect(resolveBoardShareLinkedDestinationDateKey(null, viewerMap)).toBeUndefined()
  })

  it('リンクが無い記録には項目を足さない(既存ドキュメントの形を変えない)', () => {
    const payload = compactBoardSharePayload({ ...baseInput, cells: [movedSourceCell], linkResolutionCells: [movedSourceCell] })
    const status = sharedStatus(payload, '2026-09-22')
    expect(status && 'linkedDestinationDateKey' in status).toBe(false)
  })
})

describe('講師日程共有: 全週でのリンク解決の配線(App)', () => {
  it('selectBoardShareLinkResolutionCells は全週を平らにし、壊れた週(配列でない)は飛ばす', () => {
    const past = buildCell('2026-09-17', 3)
    const current = buildCell('2026-09-22', 3)
    const weeks = [[past], null, [current]] as unknown as SlotCell[][]
    expect(selectBoardShareLinkResolutionCells(weeks).map((cell) => cell.dateKey)).toEqual(['2026-09-17', '2026-09-22'])
  })

  it('App の公開 2 経路と署名用 compact の 3 か所すべてが全週を渡す(1 か所でも抜けると古い日付が残る)', () => {
    const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8').replace(/\r\n/g, '\n')
    expect(appSource.match(/linkResolutionCells: selectBoardShareLinkResolutionCells\(/g) ?? []).toHaveLength(3)
    expect(appSource.match(/compactBoardSharePayload\(\{/g) ?? []).toHaveLength(1)
    expect(appSource.match(/publishBoardShare\(\{/g) ?? []).toHaveLength(2)
  })

  it('署名の感度: 共有セルが同じでも、前の週の振替を別日へ動かすと compact 結果が変わる(公開がスキップされない)', () => {
    const movedSourceCell = buildCell('2026-09-22', 3, { status: { id: 'moved-0922', status: 'moved', moveDestinationDateKey: '2026-09-29' } })
    const sharedCells = [movedSourceCell, buildCell('2026-09-29', 3)]
    const compactWith = (pastWeek: SlotCell[]) => JSON.stringify(compactBoardSharePayload({
      ...baseInput,
      cells: sharedCells,
      linkResolutionCells: selectBoardShareLinkResolutionCells([pastWeek, sharedCells]),
    }).cells)
    const before = compactWith([buildCell('2026-09-17', 3, { makeupFrom: '2026-09-22' }), buildCell('2026-09-18', 3)])
    const after = compactWith([buildCell('2026-09-17', 3), buildCell('2026-09-18', 3, { makeupFrom: '2026-09-22' })])
    expect(after).not.toBe(before)
  })

  it('移動先日付を持たない古い moved 記録は、公開時にリンクが付いても空のまま(v1.5.556 の回帰防止をこの経路でも維持)', () => {
    const legacyMovedCell = buildCell('2026-09-22', 3, { status: { id: 'legacy-moved', status: 'moved' } })
    const payload = compactBoardSharePayload({
      ...baseInput,
      cells: [legacyMovedCell],
      linkResolutionCells: [buildCell('2026-09-17', 3, { makeupFrom: '2026-09-22' }), legacyMovedCell],
    })
    const status = sharedStatus(payload, '2026-09-22')
    expect(status?.linkedDestinationDateKey).toBe('2026-09-17')
    const linked = resolveBoardShareLinkedDestinationDateKey(status, buildLinkedLessonDestinationMap(payload.cells))
    expect(getVisibleDateLabel(status, status, { dateKey: '2026-09-22' }, linked)).toBe('')
  })
})
