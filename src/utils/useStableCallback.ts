import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * 参照（関数の identity）を安定させつつ、呼び出し時には常に最新のコールバックを実行するフック。
 *
 * React.memo した子コンポーネントへ関数 props を渡す際、毎レンダリングで新しい関数が
 * 生成されると memo が無効化されてしまう。このフックは identity を固定しつつ最新のクロージャを
 * 呼ぶため、stale closure を生まずに（＝挙動を変えずに）子の不要な再描画を防げる。
 *
 * ref の更新は描画後・ペイント前に走る useLayoutEffect で行うため、ユーザー操作（クリック等）が
 * 発火する時点では常に最新のコールバックが参照される。
 */
export function useStableCallback<TArgs extends unknown[], TReturn>(
  callback: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return useCallback((...args: TArgs) => callbackRef.current(...args), [])
}
