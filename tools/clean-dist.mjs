import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const distPath = resolve('dist')

if (existsSync(distPath)) {
  if (process.platform === 'win32') {
    const escapedDistPath = distPath.replace(/'/g, "''")
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `if (Test-Path -LiteralPath '${escapedDistPath}') { Remove-Item -LiteralPath '${escapedDistPath}' -Recurse -Force }`],
      { stdio: 'ignore' },
    )
  } else {
    rmSync(distPath, { recursive: true, force: true })
  }
}