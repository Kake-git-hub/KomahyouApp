import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      result[key] = 'true'
      continue
    }
    result[key] = next
    index += 1
  }
  return result
}

function readDefaultProjectId() {
  try {
    const text = readFileSync(resolve('.firebaserc'), 'utf8')
    const config = JSON.parse(text)
    return config.projects?.default?.trim() || ''
  } catch {
    return ''
  }
}

function resolveCommand(baseName) {
  if (process.platform !== 'win32') return baseName
  return `${baseName}.cmd`
}

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

function runCommand(command, args) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    const commandLine = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ')
    execFileSync('cmd.exe', ['/d', '/s', '/c', commandLine], {
      stdio: 'inherit',
    })
    return
  }

  execFileSync(command, args, {
    stdio: 'inherit',
  })
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const withFunctions = args['with-functions'] === 'true'
  const projectId = args.project?.trim() || readDefaultProjectId() || 'komahyouapp-prod'
  const verifyScriptPath = resolve('tools', 'verify-firebase-hosting.mjs')
  const retentionScriptPath = resolve('tools', 'firebase-hosting-retention.mjs')
  const npmCommand = resolveCommand('npm')
  const npxCommand = resolveCommand('npx')

  runCommand(npmCommand, ['run', 'build:firebase'])
  if (withFunctions) {
    runCommand(npmCommand, ['run', 'build:functions'])
  }

  const deployTargets = withFunctions ? 'hosting,firestore,functions' : 'hosting,firestore'
  runCommand(npxCommand, ['firebase-tools', 'deploy', '--project', projectId, '--only', deployTargets])
  runCommand(process.execPath, [verifyScriptPath, '--project', projectId, '--retries', '20', '--retryDelayMs', '3000'])

  try {
    runCommand(process.execPath, [retentionScriptPath, '--site', projectId, '--count', '5'])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Firebase Hosting retention warning: ${message}`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}