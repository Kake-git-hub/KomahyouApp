import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

function resolveGcloudCommand() {
  if (process.platform !== 'win32') return 'gcloud'

  const localAppData = process.env.LOCALAPPDATA?.trim()
  const candidates = [
    localAppData ? `${localAppData}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd` : '',
    localAppData ? `${localAppData}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1` : '',
    'gcloud.cmd',
    'gcloud',
  ].filter(Boolean)

  return candidates.find((candidate) => candidate.endsWith('.cmd') || candidate.endsWith('.ps1') ? existsSync(candidate) : true) ?? 'gcloud'
}

function getAccessToken() {
  try {
    const gcloudCommand = resolveGcloudCommand()
    if (process.platform === 'win32' && gcloudCommand.endsWith('.cmd')) {
      const escapedPath = gcloudCommand.replace(/'/g, "''")
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', `& '${escapedPath}' auth print-access-token`], { encoding: 'utf8' }).trim()
    }
    return execFileSync(gcloudCommand, ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`gcloud auth print-access-token failed: ${message}`)
  }
}

async function patchRetentionCount({ siteId, channelId, retainedReleaseCount }) {
  const accessToken = getAccessToken()
  const response = await fetch(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/channels/${channelId}?updateMask=retainedReleaseCount`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': siteId,
      },
      body: JSON.stringify({
        name: `sites/${siteId}/channels/${channelId}`,
        retainedReleaseCount,
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Hosting retention update failed (${response.status}): ${text}`)
  }

  return response.json()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const siteId = args.site?.trim() || process.env.FIREBASE_HOSTING_SITE_ID?.trim() || readDefaultProjectId() || 'komahyouapp-prod'
  const channelId = args.channel?.trim() || 'live'
  const retainedReleaseCount = Number(args.count ?? process.env.FIREBASE_HOSTING_RETAIN_COUNT ?? '5')

  if (!siteId) {
    throw new Error('siteId is required. Pass --site or configure .firebaserc default project.')
  }
  if (!Number.isInteger(retainedReleaseCount) || retainedReleaseCount < 1) {
    throw new Error(`retainedReleaseCount must be a positive integer. Received: ${retainedReleaseCount}`)
  }

  const result = await patchRetentionCount({ siteId, channelId, retainedReleaseCount })
  console.log(`Firebase Hosting retention updated: site=${siteId} channel=${channelId} retainedReleaseCount=${result.retainedReleaseCount}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})