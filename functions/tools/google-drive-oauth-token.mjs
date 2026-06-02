import { exec } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OAuth2Client } from 'google-auth-library'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const DEFAULT_PORT = 8787

function printHelp() {
  console.log([
    'Google Drive OAuth refresh token helper',
    '',
    'Required variables in functions/.env or process env:',
    '  GOOGLE_DRIVE_OAUTH_CLIENT_ID',
    '  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET',
    '',
    'Optional variables:',
    '  GOOGLE_DRIVE_BACKUP_FOLDER_ID',
    '',
    'Usage:',
    '  npm --prefix functions run drive:oauth-token',
    '  npm --prefix functions run drive:oauth-token -- --write-env',
    '  npm --prefix functions run drive:oauth-token -- --port=8787',
    '',
    '--write-env updates functions/.env locally with the generated refresh token.',
  ].join('\n'))
}

function parseArgs(argv) {
  const args = {
    writeEnv: false,
    port: DEFAULT_PORT,
  }

  for (const rawArg of argv) {
    if (rawArg === '--help' || rawArg === '-h') {
      args.help = true
      continue
    }
    if (rawArg === '--write-env') {
      args.writeEnv = true
      continue
    }
    if (rawArg.startsWith('--port=')) {
      const port = Number(rawArg.slice('--port='.length))
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`不正な --port 値です: ${rawArg}`)
      }
      args.port = port
      continue
    }
    throw new Error(`未対応の引数です: ${rawArg}`)
  }

  return args
}

function trimMatchingQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return

  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (process.env[key]) continue
    process.env[key] = trimMatchingQuotes(rawValue)
  }
}

function readRequiredEnv(name) {
  const value = (process.env[name] ?? '').trim()
  if (!value) {
    throw new Error(`${name} を functions/.env に設定してください。`)
  }
  return value
}

function encodeBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function openBrowser(url) {
  const quotedUrl = url.replace(/"/g, '\\"')
  if (process.platform === 'win32') {
    exec(`start "" "${quotedUrl}"`)
    return
  }
  if (process.platform === 'darwin') {
    exec(`open "${quotedUrl}"`)
    return
  }
  exec(`xdg-open "${quotedUrl}"`)
}

function updateEnvFile(filePath, nextValues) {
  const existingText = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const lines = existingText ? existingText.split(/\r?\n/) : []
  const writtenKeys = new Set()

  const updatedLines = lines.map((line) => {
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) return line

    const key = line.slice(0, separatorIndex).trim()
    if (!(key in nextValues)) return line
    writtenKeys.add(key)
    return `${key}=${nextValues[key]}`
  })

  for (const [key, value] of Object.entries(nextValues)) {
    if (!writtenKeys.has(key)) {
      updatedLines.push(`${key}=${value}`)
    }
  }

  const nextText = `${updatedLines.filter((line, index, array) => !(index === array.length - 1 && line === '')).join('\n')}\n`
  writeFileSync(filePath, nextText, 'utf8')
}

async function fetchJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`)
  }
  return response.json()
}

async function waitForAuthorizationCode(port, expectedState) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
        if (requestUrl.pathname !== '/oauth2callback') {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Not found')
          return
        }

        const error = requestUrl.searchParams.get('error')
        const state = requestUrl.searchParams.get('state') ?? ''
        const code = requestUrl.searchParams.get('code') ?? ''
        if (state !== expectedState) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('state mismatch')
          server.close(() => rejectPromise(new Error('OAuth state が一致しません。別セッションの応答です。')))
          return
        }
        if (error) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(`<html><body><h1>認証エラー</h1><p>${error}</p><p>このタブを閉じてください。</p></body></html>`)
          server.close(() => rejectPromise(new Error(`Google OAuth エラー: ${error}`)))
          return
        }
        if (!code) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('missing code')
          server.close(() => rejectPromise(new Error('Google OAuth の認証コードを受け取れませんでした。')))
          return
        }

        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end('<html><body><h1>認証が完了しました</h1><p>このタブを閉じて、ターミナルに戻ってください。</p></body></html>')
        server.close(() => resolvePromise(code))
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('unexpected error')
        server.close(() => rejectPromise(error))
      }
    })

    server.on('error', (error) => rejectPromise(error))
    server.listen(port, '127.0.0.1')
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const currentDir = dirname(fileURLToPath(import.meta.url))
  const functionsDir = resolve(currentDir, '..')
  const envPath = resolve(functionsDir, '.env')
  loadEnvFile(envPath)

  const clientId = readRequiredEnv('GOOGLE_DRIVE_OAUTH_CLIENT_ID')
  const clientSecret = readRequiredEnv('GOOGLE_DRIVE_OAUTH_CLIENT_SECRET')
  const redirectUri = `http://127.0.0.1:${args.port}/oauth2callback`
  const folderId = (process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID ?? '').trim()
  const state = randomBytes(16).toString('hex')
  const codeVerifier = encodeBase64Url(randomBytes(48))
  const codeChallenge = encodeBase64Url(createHash('sha256').update(codeVerifier).digest())

  const oauthClient = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
  })

  const authUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    response_type: 'code',
    scope: [DRIVE_SCOPE],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  console.log(`ローカル待受 URI: ${redirectUri}`)
  console.log('ブラウザで Google 認証を開始します。自動で開かない場合は次の URL を開いてください:')
  console.log(authUrl)
  console.log('')

  try {
    openBrowser(authUrl)
  } catch {
    // Ignore browser-open failures; URL is already printed.
  }

  const authorizationCode = await waitForAuthorizationCode(args.port, state)
  const { tokens } = await oauthClient.getToken({
    code: authorizationCode,
    codeVerifier,
    redirect_uri: redirectUri,
  })

  if (!tokens.refresh_token) {
    throw new Error('refresh_token を受け取れませんでした。既存の同意がある場合は Google アカウントの権限を一度削除してから再実行してください。')
  }

  if (!tokens.access_token) {
    throw new Error('access_token を受け取れませんでした。')
  }

  let accountLabel = '取得できませんでした'
  try {
    const about = await fetchJson('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', tokens.access_token)
    const user = about.user ?? {}
    const displayName = typeof user.displayName === 'string' ? user.displayName : ''
    const emailAddress = typeof user.emailAddress === 'string' ? user.emailAddress : ''
    accountLabel = [displayName, emailAddress].filter(Boolean).join(' / ') || accountLabel
  } catch (error) {
    accountLabel = `取得失敗: ${error instanceof Error ? error.message : String(error)}`
  }

  let folderCheckLabel = '未確認'
  if (folderId) {
    try {
      const metadata = await fetchJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`, tokens.access_token)
      folderCheckLabel = `${metadata.name ?? folderId}`
    } catch (error) {
      folderCheckLabel = `取得失敗: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  console.log('Google Drive OAuth の取得に成功しました。')
  console.log(`認証アカウント: ${accountLabel}`)
  if (folderId) {
    console.log(`保存先 folder 確認: ${folderCheckLabel}`)
  }
  console.log('')
  console.log('functions/.env に設定する値:')
  console.log(`GOOGLE_DRIVE_OAUTH_CLIENT_ID=${clientId}`)
  console.log(`GOOGLE_DRIVE_OAUTH_CLIENT_SECRET=${clientSecret}`)
  console.log(`GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`)

  if (args.writeEnv) {
    updateEnvFile(envPath, {
      GOOGLE_DRIVE_OAUTH_CLIENT_ID: clientId,
      GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: clientSecret,
      GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: tokens.refresh_token,
    })
    console.log('')
    console.log(`functions/.env を更新しました: ${envPath}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})