import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'

// 並べ替えの種類。pack = 上に詰めて並べ替え / seat = 同席番で並べ替え。
export type BoardSortMode = 'pack' | 'seat'

function parseDeskOrder(deskId: string) {
  const matched = deskId.match(/_desk_(\d+)$/)
  return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER
}

function isStudentSlotFilled(student: StudentEntry | null | undefined): student is StudentEntry {
  return Boolean(student && (student.id || student.name))
}

function resolveDeskPackPriority(desk: DeskCell) {
  const filledStudentCount = desk.lesson?.studentSlots.filter(isStudentSlotFilled).length ?? 0
  if (filledStudentCount >= 2) return 0
  if (filledStudentCount === 1) return 1
  if (desk.teacher.trim()) return 2
  return 3
}

// 机の中身(生徒スロット/メモ/出欠)を左詰めに正規化する。並べ替えの前段として
// 「上に詰めて並べ替え」「同席番で並べ替え」の両方が共有する。
// skipStatusSlotPack: 出欠を記録済みのスロット0がある机は左詰めしない(記録が別生徒のものになるため)。
function normalizeCellDesksForSort(cell: SlotCell, options?: { skipStatusSlotPack?: boolean }) {
  const skipStatusSlotPack = options?.skipStatusSlotPack ?? false
  return cell.desks.map((desk) => {
    const nextDesk: DeskCell = {
      ...desk,
      memoSlots: desk.memoSlots ? [...desk.memoSlots] as [string | null, string | null] : undefined,
      statusSlots: desk.statusSlots ? [...desk.statusSlots] as [StudentStatusEntry | null, StudentStatusEntry | null] : undefined,
      lesson: desk.lesson
        ? {
          ...desk.lesson,
          studentSlots: [
            isStudentSlotFilled(desk.lesson.studentSlots[0]) ? { ...desk.lesson.studentSlots[0] } : null,
            isStudentSlotFilled(desk.lesson.studentSlots[1]) ? { ...desk.lesson.studentSlots[1] } : null,
          ] as [StudentEntry | null, StudentEntry | null],
        }
        : undefined,
    }

    if (!nextDesk.lesson) return nextDesk

    const firstStudent = nextDesk.lesson.studentSlots[0]
    const secondStudent = nextDesk.lesson.studentSlots[1]
    const hasSlot0Status = skipStatusSlotPack && nextDesk.statusSlots?.[0] != null
    if (!firstStudent && secondStudent && !hasSlot0Status) {
      nextDesk.lesson.studentSlots = [secondStudent, null]
      if (nextDesk.memoSlots && !nextDesk.memoSlots[0]) {
        nextDesk.memoSlots = [nextDesk.memoSlots[1] ?? null, null]
      }
      if (nextDesk.statusSlots && !nextDesk.statusSlots[0]) {
        nextDesk.statusSlots = [nextDesk.statusSlots[1] ?? null, null]
      }
    }

    // Both slots empty → clear lesson
    if (!nextDesk.lesson.studentSlots[0] && !nextDesk.lesson.studentSlots[1]) {
      nextDesk.lesson = undefined
    }

    return nextDesk
  })
}

function compareDesksForPack(leftDesk: DeskCell, rightDesk: DeskCell) {
  const leftPriority = resolveDeskPackPriority(leftDesk)
  const rightPriority = resolveDeskPackPriority(rightDesk)
  if (leftPriority !== rightPriority) return leftPriority - rightPriority

  const leftTeacherLabel = leftDesk.teacher ?? ''
  const rightTeacherLabel = rightDesk.teacher ?? ''
  const teacherCompare = leftTeacherLabel.localeCompare(rightTeacherLabel, 'ja')
  if (teacherCompare !== 0) return teacherCompare

  return parseDeskOrder(leftDesk.id) - parseDeskOrder(rightDesk.id)
}

export type DeskSortOptions = {
  skipStatusSlotPack?: boolean
  /**
   * spec-template-behavior Q31（Issue #72・第 1 段 (C)）: 位置を固定する机の ID（そのコマの保留〔2 行〕の机）。
   * 固定した机は**中身も ID も位置もそのまま**にし、他の机だけを残りの位置へ並べ替える
   * （保留マップのキーは机 ID なので、机 ID と位置がずれると下段が別の机の下へずれる）。省略時は従来どおり。
   */
  lockedDeskIds?: ReadonlySet<string>
}

// 並べ替えた机へ位置どおりの ID(`<cellId>_desk_<n>`)を振る。固定した机は元の ID のまま。
// 固定した机の ID が位置どおりでない(旧データ等)ために位置どおりの ID と衝突するときは、
// 動かした机も元の ID のまま返す(同じコマに同じ机 ID を 2 つ作らない)。
function assignSortedDeskIds(cellId: string, desks: DeskCell[], lockedIndexes: ReadonlySet<number>) {
  if (lockedIndexes.size === 0) return desks.map((desk, index) => ({ ...desk, id: `${cellId}_desk_${index + 1}` }))
  const lockedIds = new Set([...lockedIndexes].map((index) => desks[index].id))
  const positional = desks.map((desk, index) => (lockedIndexes.has(index) ? desk : { ...desk, id: `${cellId}_desk_${index + 1}` }))
  const collides = positional.some((desk, index) => !lockedIndexes.has(index) && lockedIds.has(desk.id))
  return collides ? desks.map((desk, index) => (lockedIndexes.has(index) ? desk : { ...desk })) : positional
}

function resolveLockedDeskIndexes(desks: readonly DeskCell[], lockedDeskIds: ReadonlySet<string> | undefined) {
  const indexes = new Set<number>()
  if (!lockedDeskIds || lockedDeskIds.size === 0) return indexes
  desks.forEach((desk, index) => {
    if (lockedDeskIds.has(desk.id)) indexes.add(index)
  })
  return indexes
}

export function packSortCellDesks(cell: SlotCell, options?: DeskSortOptions) {
  const normalizedDesks = normalizeCellDesksForSort(cell, options)
  const lockedIndexes = resolveLockedDeskIndexes(cell.desks, options?.lockedDeskIds)
  if (lockedIndexes.size === 0) {
    return normalizedDesks
      .sort(compareDesksForPack)
      .map((desk, index) => ({
        ...desk,
        id: `${cell.id}_desk_${index + 1}`,
      }))
  }
  // 固定した机は元の机(正規化もしない＝席ごとの下段と上段の対応を崩さない)をその位置に置き、残りを詰めて並べる。
  const sortedMovable = normalizedDesks.filter((_desk, index) => !lockedIndexes.has(index)).sort(compareDesksForPack)
  let movableIndex = 0
  const placed = cell.desks.map((desk, index) => {
    if (lockedIndexes.has(index)) return desk
    const next = sortedMovable[movableIndex]
    movableIndex += 1
    return next
  })
  return assignSortedDeskIds(cell.id, placed, lockedIndexes)
}

// ── 同席番で並べ替え ──
// 1日(= 同じ dateKey。テンプレでは同じ曜日)の中で、講師ができるだけ同じ席番(机番号)に
// 座り続けるように机を並べ替える。コマ数の多い講師から順に「その講師が入っている全コマで
// 空いている一番小さい席番」を確保する(オーナー指示 2026-08-16)。
// 席が競合して確保できない講師は、そのコマの空き席へ入れる(部分最適・仕様どおり)。

// 講師の同一性キー。teacherAssignmentTeacherId が最優先だが、テンプレなど id を持たない机も
// あるため、同じ日の中で「id と表示名の両方を持つ机」から名前→id の対応を作って寄せる。
function buildTeacherKeyResolver(dayCells: SlotCell[]) {
  const idByTeacherName = new Map<string, string>()
  for (const cell of dayCells) {
    for (const desk of cell.desks) {
      const teacherId = desk.teacherAssignmentTeacherId?.trim()
      const teacherName = desk.teacher?.trim()
      if (teacherId && teacherName && !idByTeacherName.has(teacherName)) {
        idByTeacherName.set(teacherName, teacherId)
      }
    }
  }

  return (desk: DeskCell): string | null => {
    const teacherId = desk.teacherAssignmentTeacherId?.trim()
    if (teacherId) return `id:${teacherId}`
    const teacherName = desk.teacher?.trim()
    if (!teacherName) return null
    const mappedId = idByTeacherName.get(teacherName)
    return mappedId ? `id:${mappedId}` : `name:${teacherName}`
  }
}

type SeatCandidate = {
  key: string
  label: string
  cellIndexes: number[]
}

export function computeSeatAssignments(
  dayCells: SlotCell[],
  resolveTeacherKey: (desk: DeskCell) => string | null,
  // Q31: セルごとの位置固定の机 ID(保留の机)。固定した机の講師は候補にせず、その席はそのセルで埋まっている扱い。
  lockedDeskIdsByCellIndex?: ReadonlyArray<ReadonlySet<string> | undefined>,
) {
  const seatCapacity = dayCells.reduce((min, cell) => Math.min(min, cell.desks.length), Number.MAX_SAFE_INTEGER)
  const assignments = new Map<string, number>()
  if (!dayCells.length || !Number.isFinite(seatCapacity) || seatCapacity <= 0) return assignments

  const candidateByKey = new Map<string, SeatCandidate>()
  dayCells.forEach((cell, cellIndex) => {
    const lockedDeskIds = lockedDeskIdsByCellIndex?.[cellIndex]
    for (const desk of cell.desks) {
      if (lockedDeskIds?.has(desk.id)) continue
      const key = resolveTeacherKey(desk)
      if (!key) continue
      const candidate = candidateByKey.get(key)
      if (!candidate) {
        candidateByKey.set(key, { key, label: desk.teacher?.trim() ?? '', cellIndexes: [cellIndex] })
        continue
      }
      // 同じコマに同じ講師が二重に載っている異常データでも席数を二重に消費しない。
      if (!candidate.cellIndexes.includes(cellIndex)) candidate.cellIndexes.push(cellIndex)
    }
  })

  // コマ数の多い講師を優先(移動が減る効果が大きいため)。同数は表示名で決定的に並べる。
  const orderedCandidates = [...candidateByKey.values()].sort((left, right) => {
    if (left.cellIndexes.length !== right.cellIndexes.length) return right.cellIndexes.length - left.cellIndexes.length
    const labelCompare = left.label.localeCompare(right.label, 'ja')
    if (labelCompare !== 0) return labelCompare
    return left.key.localeCompare(right.key)
  })

  const takenSeatsByCell = dayCells.map((cell, cellIndex) => {
    const taken = new Set<number>()
    const lockedDeskIds = lockedDeskIdsByCellIndex?.[cellIndex]
    if (lockedDeskIds) cell.desks.forEach((desk, deskIndex) => { if (lockedDeskIds.has(desk.id)) taken.add(deskIndex) })
    return taken
  })
  for (const candidate of orderedCandidates) {
    for (let seat = 0; seat < seatCapacity; seat += 1) {
      const isFree = candidate.cellIndexes.every((cellIndex) => !takenSeatsByCell[cellIndex].has(seat))
      if (!isFree) continue
      assignments.set(candidate.key, seat)
      candidate.cellIndexes.forEach((cellIndex) => takenSeatsByCell[cellIndex].add(seat))
      break
    }
  }

  return assignments
}

function placeDesksBySeat(cell: SlotCell, desks: DeskCell[], assignments: Map<string, number>, resolveTeacherKey: (desk: DeskCell) => string | null, lockedDeskIds?: ReadonlySet<string>) {
  const seats: (DeskCell | null)[] = new Array(desks.length).fill(null)
  const leftovers: DeskCell[] = []
  // Q31: 位置固定の机(保留の机)は今の席のまま先に置く。
  const lockedIndexes = resolveLockedDeskIndexes(desks, lockedDeskIds)
  for (const index of lockedIndexes) seats[index] = desks[index]

  for (const [deskIndex, desk] of desks.entries()) {
    if (lockedIndexes.has(deskIndex)) continue
    const key = resolveTeacherKey(desk)
    const seat = key ? assignments.get(key) : undefined
    if (seat != null && seat < seats.length && seats[seat] === null) {
      seats[seat] = desk
      continue
    }
    leftovers.push(desk)
  }

  // 席を確保できなかった講師・講師のいない机は、埋まっている机を優先して空き席へ詰める。
  let leftoverIndex = 0
  for (let seatIndex = 0; seatIndex < seats.length && leftoverIndex < leftovers.length; seatIndex += 1) {
    if (seats[seatIndex] !== null) continue
    seats[seatIndex] = leftovers[leftoverIndex]
    leftoverIndex += 1
  }

  const placed = seats.filter((desk): desk is DeskCell => desk !== null)
  // 固定した机は席を空けずに置いてあるので、placed の位置は seats の位置と同じ。
  return assignSortedDeskIds(cell.id, placed, lockedIndexes)
}

// 与えられたセル群を dateKey ごと(=1日ごと)にまとめ、同席番になるよう机を並べ替える。
// 机の中身は packSortCellDesks と同じ正規化を通す(=生徒スロットの左詰め)。
export function seatSortCells(
  cells: SlotCell[],
  options?: {
    skipStatusSlotPack?: boolean
    /** Q31: コマごとの位置固定の机 ID(保留の机)。省略時・undefined を返すコマは従来どおり。 */
    resolveLockedDeskIds?: (cellId: string) => ReadonlySet<string> | undefined
  },
): SlotCell[] {
  const lockedDeskIdsByCell = cells.map((cell) => options?.resolveLockedDeskIds?.(cell.id))
  const normalizedCells = cells.map((cell, index) => ({
    ...cell,
    desks: packSortCellDesks(cell, { skipStatusSlotPack: options?.skipStatusSlotPack, lockedDeskIds: lockedDeskIdsByCell[index] }),
  }))

  const cellIndexesByDate = new Map<string, number[]>()
  normalizedCells.forEach((cell, index) => {
    const indexes = cellIndexesByDate.get(cell.dateKey)
    if (indexes) indexes.push(index)
    else cellIndexesByDate.set(cell.dateKey, [index])
  })

  for (const cellIndexes of cellIndexesByDate.values()) {
    const dayCells = cellIndexes.map((index) => normalizedCells[index])
    const dayLockedDeskIds = cellIndexes.map((index) => lockedDeskIdsByCell[index])
    const resolveTeacherKey = buildTeacherKeyResolver(dayCells)
    const assignments = computeSeatAssignments(dayCells, resolveTeacherKey, dayLockedDeskIds)
    cellIndexes.forEach((cellIndex, dayIndex) => {
      const dayCell = dayCells[dayIndex]
      normalizedCells[cellIndex].desks = placeDesksBySeat(dayCell, dayCell.desks, assignments, resolveTeacherKey, dayLockedDeskIds[dayIndex])
    })
  }

  return normalizedCells
}
