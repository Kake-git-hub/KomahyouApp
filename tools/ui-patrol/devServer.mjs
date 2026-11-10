// 画面の自動巡回(tools/ui-patrol.mjs)が使う手元の開発用サーバー(vite)。
// ★ローカルモードだけ: VITE_EXTERNAL_BACKEND_MODE=local を渡し、VITE_FIREBASE_* は子プロセスへ渡さない
//   (src/integrations/firebase/config.ts の getFirebaseBackendConfig は explicitMode='local' なら Firebase を使わない。
//   .env.local に Firebase の設定があっても、プロセスの環境変数のほうが vite では優先する)。
// ★開発用ビルド(vite dev)なので、巡回の読み口 window.__komahyouUiPatrol が入る(src/utils/uiPatrolHook.ts)。
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'

const START_TIMEOUT_MS = 60000

/** ポートが空いているか(使用中なら他のサーバーへつないで点検してしまうので、巡回は止める)。 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

function buildChildEnv(parentEnv) {
  const env = {}
  for (const [key, value] of Object.entries(parentEnv)) {
    if (key.startsWith('VITE_FIREBASE_')) continue
    env[key] = value
  }
  env.VITE_EXTERNAL_BACKEND_MODE = 'local'
  return env
}

async function waitForHttp(url, timeoutMs, isAlive) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!isAlive()) throw new Error('開発用サーバーが起動の途中で終わりました。')
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // まだ起動していない
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`開発用サーバーが ${Math.round(timeoutMs / 1000)} 秒で起動しませんでした。`)
}

export async function startDevServer({ port, repoRoot, env = process.env }) {
  if (!(await isPortFree(port))) throw new Error(`ポート ${port} は使用中です(--port で別のポートを指定してください)。`)
  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: repoRoot,
    env: buildChildEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
    // 子のさらに子(esbuild など)もまとめて止められるよう、別のプロセスグループにする。
    detached: true,
  })
  let exited = false
  const output = []
  const keep = (chunk) => {
    output.push(String(chunk))
    if (output.length > 50) output.shift()
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  child.once('exit', () => { exited = true })

  const stop = async () => {
    if (exited) return
    const done = new Promise((resolve) => child.once('exit', resolve))
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* 既に終わっている */ }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* 既に終わっている */ } }, 5000)
    await done
    clearTimeout(timer)
  }

  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await waitForHttp(`${baseUrl}/`, START_TIMEOUT_MS, () => !exited)
  } catch (error) {
    await stop()
    throw new Error(`${error.message}\n${output.join('').slice(-1500)}`)
  }
  return { baseUrl, stop }
}
