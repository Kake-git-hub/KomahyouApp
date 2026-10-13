// 盤面の長押し D&D の共通セッション（2026-10-13・オーナー指示「保留の生徒〔テンプレも既存もどちらも〕の移動を D&D でできるようにして」）。
//
// 生徒名の長押し D&D（ScheduleBoardScreen.handleStudentMouseDown）と同じ操作感＝約 250ms の長押しで「掴む」→ 追従プレビュー → mouseup で
// `.sa-student[data-cell-id]` の席へドロップ（盤面外は取りやめ・Esc で取りやめ・長押し成立前に 8px 以上動いたらただのクリック）を、
// 保留（2 行）の**下段**の生徒にも使うために切り出した純粋な DOM セッション。React の状態は持たず、呼び出し側のコールバックで
// 掴む／落とす／取りやめを通知する。既存の生徒・講師の D&D は従来の実装のまま（回帰防止。こちらへ寄せるのは別途）。
//
// 性能: 毎フレームの React 更新はしない（追従は CursorFollowPreview、強調は純 CSS :hover）。端へ寄せたときの自動スクロールだけ rAF で回す。

export const LONG_PRESS_DRAG_LONG_PRESS_MS = 250
export const LONG_PRESS_DRAG_PRE_ARM_CANCEL_PX = 8
const AUTO_SCROLL_EDGE_PX = 60
const AUTO_SCROLL_MAX_SPEED = 22

/** ドロップ先の席（`.sa-student` の data 属性から読む）。 */
export type LongPressDragDropTarget = { cellId: string; deskIndex: number; studentIndex: number }

export type LongPressDragCancelReason = 'escape' | 'moved-before-arm' | 'blocked'

export type LongPressDragSession = {
  /** 進行中のセッションを外から止める（新しい mousedown・アンマウント時）。コールバックは呼ばない。 */
  dispose: () => void
}

export type StartLongPressDragSessionParams = {
  /** mousedown の button（左ボタン以外はセッションを作らない）。 */
  button: number
  clientX: number
  clientY: number
  /** 長押し成立の直前に呼ぶ。文字列を返すと掴まずに取りやめ（理由は onCancel('blocked') の message に渡す）。 */
  canArm?: () => string | null
  /** 掴んだ（長押し成立）。 */
  onArm: () => void
  /** 掴んだ後に離した。target は `.sa-student[data-cell-id]` の席、盤面外なら null。 */
  onDrop: (target: LongPressDragDropTarget | null) => void
  /** 掴んだ後（または掴む前）に取りやめた。'moved-before-arm' は長押し成立前の移動＝ただのクリック扱い。 */
  onCancel: (reason: LongPressDragCancelReason, message: string | null) => void
  /** 自動スクロールの対象（既定は盤面 `.slot-adjust-grid`）。 */
  scrollContainerSelector?: string
  longPressMs?: number
  preArmCancelPx?: number
}

/** `.sa-student[data-cell-id]` の要素からドロップ先の席を読む。読めなければ null。 */
export function resolveLongPressDropTarget(element: Element | null): LongPressDragDropTarget | null {
  const dropCell = element?.closest<HTMLElement>('.sa-student[data-cell-id]') ?? null
  if (!dropCell) return null
  const cellId = dropCell.dataset.cellId ?? ''
  const deskIndex = Number(dropCell.dataset.deskIndex)
  const studentIndex = Number(dropCell.dataset.studentIndex)
  if (!cellId || Number.isNaN(deskIndex) || Number.isNaN(studentIndex)) return null
  return { cellId, deskIndex, studentIndex }
}

function edgeScrollSpeed(dist: number) {
  if (dist >= AUTO_SCROLL_EDGE_PX) return 0
  const ratio = Math.min(1, (AUTO_SCROLL_EDGE_PX - dist) / AUTO_SCROLL_EDGE_PX)
  return ratio * AUTO_SCROLL_MAX_SPEED
}

/**
 * 長押し D&D のセッションを始める。左ボタン以外は null。
 * 流れ: mousedown → (longPressMs 待つ・その間に preArmCancelPx 以上動けば 'moved-before-arm' で終了＝クリックに委ねる)
 *   → canArm → onArm → mouseup で onDrop(席 or null) ／ Esc で onCancel('escape')。
 * 掴む前の mouseup は何も通知せずに終了する（通常の click に委ねる）。
 */
export function startLongPressDragSession(params: StartLongPressDragSessionParams): LongPressDragSession | null {
  if (params.button !== 0) return null
  const longPressMs = params.longPressMs ?? LONG_PRESS_DRAG_LONG_PRESS_MS
  const preArmCancelPx = params.preArmCancelPx ?? LONG_PRESS_DRAG_PRE_ARM_CANCEL_PX
  const scrollContainerSelector = params.scrollContainerSelector ?? '.slot-adjust-grid'

  let armed = false
  let disposed = false
  let timer: number | null = null
  let autoScrollRafId: number | null = null
  const startX = params.clientX
  const startY = params.clientY
  const lastPointer = { x: params.clientX, y: params.clientY }

  function autoScrollStep() {
    const grid = document.querySelector<HTMLElement>(scrollContainerSelector)
    if (grid) {
      const rect = grid.getBoundingClientRect()
      let dx = 0
      let dy = 0
      if (lastPointer.x < rect.left + AUTO_SCROLL_EDGE_PX) dx = -edgeScrollSpeed(lastPointer.x - rect.left)
      else if (lastPointer.x > rect.right - AUTO_SCROLL_EDGE_PX) dx = edgeScrollSpeed(rect.right - lastPointer.x)
      if (lastPointer.y < rect.top + AUTO_SCROLL_EDGE_PX) dy = -edgeScrollSpeed(lastPointer.y - rect.top)
      else if (lastPointer.y > rect.bottom - AUTO_SCROLL_EDGE_PX) dy = edgeScrollSpeed(rect.bottom - lastPointer.y)
      if (dx !== 0) grid.scrollLeft += dx
      if (dy !== 0) grid.scrollTop += dy
    }
    autoScrollRafId = window.requestAnimationFrame(autoScrollStep)
  }

  function teardown() {
    if (disposed) return
    disposed = true
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (autoScrollRafId !== null) {
      window.cancelAnimationFrame(autoScrollRafId)
      autoScrollRafId = null
    }
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
    window.removeEventListener('keydown', handleKeyDown)
  }

  function handleMouseMove(event: MouseEvent) {
    lastPointer.x = event.clientX
    lastPointer.y = event.clientY
    if (armed) return
    if (Math.abs(event.clientX - startX) > preArmCancelPx || Math.abs(event.clientY - startY) > preArmCancelPx) {
      teardown()
      params.onCancel('moved-before-arm', null)
    }
  }

  function handleMouseUp(event: MouseEvent) {
    const wasArmed = armed
    teardown()
    if (!wasArmed) return
    params.onDrop(resolveLongPressDropTarget(document.elementFromPoint(event.clientX, event.clientY)))
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    const wasArmed = armed
    teardown()
    params.onCancel('escape', wasArmed ? '移動をキャンセルしました。' : null)
  }

  timer = window.setTimeout(() => {
    timer = null
    if (disposed) return
    const block = params.canArm?.() ?? null
    if (block) {
      teardown()
      params.onCancel('blocked', block)
      return
    }
    armed = true
    window.getSelection?.()?.removeAllRanges()
    params.onArm()
    if (autoScrollRafId === null) autoScrollRafId = window.requestAnimationFrame(autoScrollStep)
  }, longPressMs)

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('keydown', handleKeyDown)

  return { dispose: teardown }
}
