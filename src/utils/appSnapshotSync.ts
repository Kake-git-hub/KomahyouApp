const CHANNEL_NAME = 'komahyouapp-snapshot-sync'

export type SnapshotSyncMessage = {
  type: 'snapshot-saved'
  savedAt: string
  originId: string
}

export function createSnapshotSyncChannel(onMessage: (message: SnapshotSyncMessage) => void) {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') {
    return {
      originId: 'unsupported',
      postSnapshotSaved(_savedAt: string) {},
      dispose() {},
      isSupported: false,
    }
  }

  const originId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Date.now().toString(36)}`
  const channel = new window.BroadcastChannel(CHANNEL_NAME)
  const handleMessage = (event: MessageEvent<SnapshotSyncMessage>) => {
    const message = event.data
    if (!message || message.type !== 'snapshot-saved' || typeof message.savedAt !== 'string' || typeof message.originId !== 'string') return
    onMessage(message)
  }

  channel.addEventListener('message', handleMessage)

  return {
    originId,
    postSnapshotSaved(savedAt: string) {
      channel.postMessage({ type: 'snapshot-saved', savedAt, originId } satisfies SnapshotSyncMessage)
    },
    dispose() {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    },
    isSupported: true,
  }
}
