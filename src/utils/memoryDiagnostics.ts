// 本番メモリ診断（挙動には影響しない）。
// URL に ?memlog=1 を付けた時、または localStorage 'komahyou:memlog'='1' の時だけ作動し、
// メモリ使用量と主要処理の発生回数を数秒ごとに console へ出力する。
// 「増え続けるリーク」か「一時ピーク（GCで戻る）」かの切り分けと、どの処理が繰り返し走って
// いるかの特定に使う。無効時 bumpMemCounter はほぼノーコスト。

let cachedEnabled: boolean | null = null

export function isMemoryDiagnosticsEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled
  if (typeof window === 'undefined') {
    cachedEnabled = false
    return false
  }
  try {
    const param = new URLSearchParams(window.location.search).get('memlog')
    cachedEnabled = param === '1' || window.localStorage.getItem('komahyou:memlog') === '1'
  } catch {
    cachedEnabled = false
  }
  return cachedEnabled
}

const counters: Record<string, number> = {}

export function bumpMemCounter(name: string): void {
  if (!isMemoryDiagnosticsEnabled()) return
  counters[name] = (counters[name] ?? 0) + 1
}

let started = false

export function startMemoryDiagnostics(): void {
  if (started || typeof window === 'undefined' || !isMemoryDiagnosticsEnabled()) return
  started = true

  const startedAt = Date.now()
  let previous: Record<string, number> = {}

  const readHeapMB = (): number => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    return memory ? Math.round(memory.usedJSHeapSize / 1048576) : -1
  }

  window.setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
    const deltas: Record<string, number> = {}
    for (const key of Object.keys(counters)) {
      const delta = counters[key] - (previous[key] ?? 0)
      if (delta !== 0) deltas[key] = delta
    }
    previous = { ...counters }
    console.info(`[komahyou-memlog] t=${elapsedSeconds}s heap=${readHeapMB()}MB delta=`, deltas)
  }, 5000)

  console.info('[komahyou-memlog] started (?memlog=1). 5秒ごとに heap と各処理の発生回数(delta)を出力します。')
}
