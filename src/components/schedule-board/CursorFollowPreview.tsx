import { memo, useEffect, useState } from 'react'

// カーソル追従プレビュー。マウス移動のたびに位置 state を更新するため、これを親
// (ScheduleBoardScreen) に置くとドラッグ中に毎フレーム盤面全体が再描画されてしまう。
// 位置 state をこの小さなコンポーネント内に閉じ込め、mousemove では本コンポーネントだけが
// 再描画されるようにする（挙動は不変）。
function CursorFollowPreviewComponent({ label }: { label: string }) {
  const [position, setPosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (typeof window === 'undefined') return
    let frameId: number | null = null
    const handlePointerMove = (event: MouseEvent) => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        setPosition({ x: event.clientX, y: event.clientY })
        frameId = null
      })
    }
    window.addEventListener('mousemove', handlePointerMove)
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      window.removeEventListener('mousemove', handlePointerMove)
    }
  }, [])

  const style = typeof window === 'undefined'
    ? { left: 16, top: 16 }
    : {
        left: Math.max(12, Math.min(position.x + 18, window.innerWidth - 320)),
        top: Math.max(12, Math.min(position.y + 18, window.innerHeight - 80)),
      }

  return (
    <div className="cursor-follow-preview" style={style} data-testid="move-preview" role="status" aria-live="polite">
      {label}
    </div>
  )
}

export const CursorFollowPreview = memo(CursorFollowPreviewComponent)
