// @vitest-environment jsdom
// 盤面の長押し D&D の共通セッション（longPressDrag.ts・2026-10-13 オーナー指示「保留の生徒〔テンプレも既存もどちらも〕の移動を D&D で」）。
// 生徒名の長押し D&D（ScheduleBoardScreen.handleStudentMouseDown）と同じ操作感を純粋な DOM セッションとして固定する:
// 約 250ms の長押しで掴む／成立前に 8px 以上動けばただのクリック／mouseup で `.sa-student[data-cell-id]` の席に落とす／盤面外は null／Esc で取りやめ。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LONG_PRESS_DRAG_LONG_PRESS_MS,
  LONG_PRESS_DRAG_PRE_ARM_CANCEL_PX,
  resolveLongPressDropTarget,
  startLongPressDragSession,
  type LongPressDragDropTarget,
} from './longPressDrag'

function seatElement(cellId: string, deskIndex: number, studentIndex: number) {
  const td = document.createElement('td')
  td.className = 'sa-student'
  td.dataset.cellId = cellId
  td.dataset.deskIndex = String(deskIndex)
  td.dataset.studentIndex = String(studentIndex)
  const inner = document.createElement('div')
  inner.className = 'sa-student-inner'
  td.appendChild(inner)
  document.body.appendChild(td)
  return { td, inner }
}

function mouse(type: 'mousemove' | 'mouseup', clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }))
}

describe('startLongPressDragSession（長押し D&D の共通セッション）', () => {
  const callbacks = () => ({
    onArm: vi.fn(),
    onDrop: vi.fn<(target: LongPressDragDropTarget | null) => void>(),
    onCancel: vi.fn(),
  })

  // jsdom には document.elementFromPoint が無いので、テストごとに差し替えられる関数として定義しておく。
  const elementFromPoint = vi.fn<(x: number, y: number) => Element | null>(() => null)
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    elementFromPoint.mockReset()
    elementFromPoint.mockImplementation(() => null)
    Object.defineProperty(document, 'elementFromPoint', { value: elementFromPoint, configurable: true, writable: true })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('左ボタン以外（右クリック）はセッションを作らない', () => {
    const cb = callbacks()
    expect(startLongPressDragSession({ button: 2, clientX: 10, clientY: 10, ...cb })).toBeNull()
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS + 10)
    expect(cb.onArm).not.toHaveBeenCalled()
  })

  it('長押し（250ms）で掴む → `.sa-student[data-cell-id]` の席で離すとその席を onDrop に渡す', () => {
    const cb = callbacks()
    const { inner } = seatElement('2026-10-15_4', 12, 0)
    elementFromPoint.mockImplementation(() => inner)
    const session = startLongPressDragSession({ button: 0, clientX: 10, clientY: 10, ...cb })
    expect(session).not.toBeNull()
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS - 1)
    expect(cb.onArm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb.onArm).toHaveBeenCalledTimes(1)
    mouse('mousemove', 300, 300) // 掴んだ後の移動は取りやめにならない
    mouse('mouseup', 300, 300)
    expect(cb.onDrop).toHaveBeenCalledWith({ cellId: '2026-10-15_4', deskIndex: 12, studentIndex: 0 })
    expect(cb.onCancel).not.toHaveBeenCalled()
    // 終了後のイベントは何も起こさない（リスナ解除）。
    mouse('mouseup', 300, 300)
    expect(cb.onDrop).toHaveBeenCalledTimes(1)
  })

  it('盤面の外（席でない要素）で離すと onDrop(null)', () => {
    const cb = callbacks()
    elementFromPoint.mockImplementation(() => document.body)
    startLongPressDragSession({ button: 0, clientX: 10, clientY: 10, ...cb })
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS)
    mouse('mouseup', 5, 5)
    expect(cb.onDrop).toHaveBeenCalledWith(null)
  })

  it('長押し成立前に 8px より大きく動くと取りやめ（ただのクリック扱い・onArm は呼ばれない）', () => {
    const cb = callbacks()
    startLongPressDragSession({ button: 0, clientX: 10, clientY: 10, ...cb })
    mouse('mousemove', 10 + LONG_PRESS_DRAG_PRE_ARM_CANCEL_PX + 1, 10)
    expect(cb.onCancel).toHaveBeenCalledWith('moved-before-arm', null)
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS + 10)
    expect(cb.onArm).not.toHaveBeenCalled()
    expect(cb.onDrop).not.toHaveBeenCalled()
  })

  it('長押し成立前に離すと何も通知しない（通常の click に委ねる）', () => {
    const cb = callbacks()
    startLongPressDragSession({ button: 0, clientX: 10, clientY: 10, ...cb })
    vi.advanceTimersByTime(100)
    mouse('mouseup', 10, 10)
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS)
    expect(cb.onArm).not.toHaveBeenCalled()
    expect(cb.onDrop).not.toHaveBeenCalled()
    expect(cb.onCancel).not.toHaveBeenCalled()
  })

  it('掴んだ後の Esc は onCancel(\'escape\', メッセージ) で取りやめ、以後の mouseup は無視', () => {
    const cb = callbacks()
    const { inner } = seatElement('c', 0, 0)
    elementFromPoint.mockImplementation(() => inner)
    startLongPressDragSession({ button: 0, clientX: 10, clientY: 10, ...cb })
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(cb.onCancel).toHaveBeenCalledWith('escape', '移動をキャンセルしました。')
    mouse('mouseup', 10, 10)
    expect(cb.onDrop).not.toHaveBeenCalled()
  })

  it('canArm が理由を返すと掴まずに onCancel(\'blocked\', 理由)', () => {
    const cb = callbacks()
    startLongPressDragSession({ button: 0, clientX: 10, clientY: 10, canArm: () => '出席済みの生徒は移動できません。', ...cb })
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS)
    expect(cb.onArm).not.toHaveBeenCalled()
    expect(cb.onCancel).toHaveBeenCalledWith('blocked', '出席済みの生徒は移動できません。')
  })

  it('dispose で外から止めると、その後の長押し・mouseup は何も通知しない', () => {
    const cb = callbacks()
    const session = startLongPressDragSession({ button: 0, clientX: 10, clientY: 10, ...cb })!
    session.dispose()
    vi.advanceTimersByTime(LONG_PRESS_DRAG_LONG_PRESS_MS + 10)
    mouse('mouseup', 10, 10)
    expect(cb.onArm).not.toHaveBeenCalled()
    expect(cb.onDrop).not.toHaveBeenCalled()
    expect(cb.onCancel).not.toHaveBeenCalled()
  })

  it('resolveLongPressDropTarget: data 属性が欠けた要素・席でない要素は null', () => {
    expect(resolveLongPressDropTarget(null)).toBeNull()
    expect(resolveLongPressDropTarget(document.body)).toBeNull()
    const td = document.createElement('td')
    td.className = 'sa-student'
    td.dataset.cellId = 'c'
    expect(resolveLongPressDropTarget(td)).toBeNull()
  })
})
