import { useEffect, useState } from 'react'

const PING = 'classroom-tab-lock-ping'
const PONG = 'classroom-tab-lock-pong'
const RELEASE = 'classroom-tab-lock-release'

type Message = { type: typeof PING | typeof PONG | typeof RELEASE; tabId: string; ts: number }

function generateTabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 同じ教室を複数タブで開くのをブロックする。
 * - 開発者 (enabled=false) は対象外
 * - 既に他タブが同じ classroomId+userId で動作中なら blocked=true を返す
 * - BroadcastChannel が無い環境では機能を無効化する (blocked は常に false)
 */
export function useClassroomTabLock(params: {
  enabled: boolean
  classroomId: string | null | undefined
  userId: string | null | undefined
}): { blocked: boolean } {
  const { enabled, classroomId, userId } = params
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!enabled || !classroomId || !userId) {
      setBlocked(false)
      return
    }
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      setBlocked(false)
      return
    }

    const channelName = `komahyou-classroom-tab-lock::${userId}::${classroomId}`
    const channel = new BroadcastChannel(channelName)
    const tabId = generateTabId()
    let isOwner = false
    let isBlocked = false
    let cancelled = false

    const sendPing = () => {
      const message: Message = { type: PING, tabId, ts: Date.now() }
      channel.postMessage(message)
    }

    const handleMessage = (event: MessageEvent<Message>) => {
      const data = event.data
      if (!data || data.tabId === tabId) return
      if (data.type === PING) {
        // 既に owner ならば pong を返して新規タブをブロックする
        if (isOwner) {
          const reply: Message = { type: PONG, tabId, ts: Date.now() }
          channel.postMessage(reply)
        }
      } else if (data.type === PONG) {
        // owner が他にいる → このタブはブロック対象
        if (!cancelled) {
          isBlocked = true
          setBlocked(true)
        }
      } else if (data.type === RELEASE) {
        // 既存 owner が閉じた。自分が次の owner になる試み
        if (!isOwner && !cancelled) {
          isOwner = true
          isBlocked = false
          setBlocked(false)
        }
      }
    }

    channel.addEventListener('message', handleMessage)

    // 起動時: 既存 owner がいるかを確認
    sendPing()

    // 一定時間 pong が来なければ自分を owner にする
    const claimTimer = window.setTimeout(() => {
      if (!cancelled && !isBlocked) {
        isOwner = true
      }
    }, 400)

    const handleBeforeUnload = () => {
      if (isOwner) {
        const message: Message = { type: RELEASE, tabId, ts: Date.now() }
        try {
          channel.postMessage(message)
        } catch {
          /* noop */
        }
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      cancelled = true
      window.clearTimeout(claimTimer)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      handleBeforeUnload()
      channel.removeEventListener('message', handleMessage)
      channel.close()
      setBlocked(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, classroomId, userId])

  return { blocked }
}
