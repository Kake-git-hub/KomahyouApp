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

export function packSortCellDesks(cell: SlotCell, options?: { skipStatusSlotPack?: boolean }) {
  return normalizeCellDesksForSort(cell, options)
    .sort((leftDesk, rightDesk) => {
      const leftPriority = resolveDeskPackPriority(leftDesk)
      const rightPriority = resolveDeskPackPriority(rightDesk)
      if (leftPriority !== rightPriority) return leftPriority - rightPriority

      const leftTeacherLabel = leftDesk.teacher ?? ''
      const rightTeacherLabel = rightDesk.teacher ?? ''
      const teacherCompare = leftTeacherLabel.localeCompare(rightTeacherLabel, 'ja')
      if (teacherCompare !== 0) return teacherCompare

      return parseDeskOrder(leftDesk.id) - parseDeskOrder(rightDesk.id)
    })
    .map((desk, index) => ({
      ...desk,
      id: `${cell.id}_desk_${index + 1}`,
    }))
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

export function computeSeatAssignments(dayCells: SlotCell[], resolveTeacherKey: (desk: DeskCell) => string | null) {
  const seatCapacity = dayCells.reduce((min, cell) => Math.min(min, cell.desks.length), Number.MAX_SAFE_INTEGER)
  const assignments = new Map<string, number>()
  if (!dayCells.length || !Number.isFinite(seatCapacity) || seatCapacity <= 0) return assignments

  const candidateByKey = new Map<string, SeatCandidate>()
  dayCells.forEach((cell, cellIndex) => {
    for (const desk of cell.desks) {
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

  const takenSeatsByCell = dayCells.map(() => new Set<number>())
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

function placeDesksBySeat(cell: SlotCell, desks: DeskCell[], assignments: Map<string, number>, resolveTeacherKey: (desk: DeskCell) => string | null) {
  const seats: (DeskCell | null)[] = new Array(desks.length).fill(null)
  const leftovers: DeskCell[] = []

  for (const desk of desks) {
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

  return seats
    .filter((desk): desk is DeskCell => desk !== null)
    .map((desk, index) => ({ ...desk, id: `${cell.id}_desk_${index + 1}` }))
}

// 与えられたセル群を dateKey ごと(=1日ごと)にまとめ、同席番になるよう机を並べ替える。
// 机の中身は packSortCellDesks と同じ正規化を通す(=生徒スロットの左詰め)。
export function seatSortCells(cells: SlotCell[], options?: { skipStatusSlotPack?: boolean }): SlotCell[] {
  const normalizedCells = cells.map((cell) => ({ ...cell, desks: packSortCellDesks(cell, options) }))

  const cellIndexesByDate = new Map<string, number[]>()
  normalizedCells.forEach((cell, index) => {
    const indexes = cellIndexesByDate.get(cell.dateKey)
    if (indexes) indexes.push(index)
    else cellIndexesByDate.set(cell.dateKey, [index])
  })

  for (const cellIndexes of cellIndexesByDate.values()) {
    const dayCells = cellIndexes.map((index) => normalizedCells[index])
    const resolveTeacherKey = buildTeacherKeyResolver(dayCells)
    const assignments = computeSeatAssignments(dayCells, resolveTeacherKey)
    cellIndexes.forEach((cellIndex, dayIndex) => {
      const dayCell = dayCells[dayIndex]
      normalizedCells[cellIndex].desks = placeDesksBySeat(dayCell, dayCell.desks, assignments, resolveTeacherKey)
    })
  }

  return normalizedCells
}
