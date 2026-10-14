// 「処理中」表示を出してから重い同期計算を始めるための待ち(2026-10-14 オーナー指摘「テンプレの反映ボタンを押して
// つぎのモーダルが出るまで操作できないのにローディングスピンがでない」)。
//
// React の setState で BusyOverlay を出しても、同じイベントハンドラの中で続けて数秒の同期計算を始めると
// ブラウザは描画する間が無く、スピナーが出ないまま固まって見える。描画を 1 フレーム(requestAnimationFrame)待ち、
// さらに次のタスク(setTimeout 0)まで譲ってから計算を始めると、スピナーが出た状態で計算に入れる。
//
// 依存を引数で受ける(テストで擬似の raf / timer を渡せる)。window が無い環境では即解決する。

export type NextPaintScheduler = {
  requestAnimationFrame?: (callback: () => void) => unknown
  setTimeout: (callback: () => void, ms: number) => unknown
}

function defaultScheduler(): NextPaintScheduler | null {
  if (typeof window === 'undefined') return null
  return {
    requestAnimationFrame: typeof window.requestAnimationFrame === 'function' ? (callback) => window.requestAnimationFrame(() => callback()) : undefined,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  }
}

/** 次の描画が終わるまで待つ。raf が無い環境(古いブラウザ・テスト)は setTimeout(0) だけで譲る。 */
export function waitForNextPaint(scheduler: NextPaintScheduler | null = defaultScheduler()): Promise<void> {
  if (!scheduler) return Promise.resolve()
  return new Promise((resolve) => {
    const afterFrame = () => { scheduler.setTimeout(resolve, 0) }
    if (scheduler.requestAnimationFrame) scheduler.requestAnimationFrame(afterFrame)
    else afterFrame()
  })
}
