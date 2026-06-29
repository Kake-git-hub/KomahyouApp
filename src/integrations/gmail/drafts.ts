const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose'

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void
}

type GoogleIdentityServices = {
  accounts?: {
    oauth2?: {
      initTokenClient: (options: {
        client_id: string
        scope: string
        callback: (response: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => void
      }) => GoogleTokenClient
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentityServices
  }
}

function readGoogleOAuthClientId() {
  return typeof import.meta !== 'undefined' ? String(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? '').trim() : ''
}

function loadGoogleIdentityServices() {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Google OAuth ライブラリの読み込みに失敗しました。')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google OAuth ライブラリの読み込みに失敗しました。'))
    document.head.appendChild(script)
  })
}

export function isGmailDraftCreationConfigured() {
  return Boolean(readGoogleOAuthClientId())
}

// セッション中はアクセストークンをメモリにキャッシュし、有効期限内なら再取得しない。
// 期限切れ後の再取得も prompt:'' なので（初回同意済みなら）ポップアップは出ない。
let cachedAccessToken: { token: string; expiresAt: number } | null = null

export async function requestGmailComposeAccessToken() {
  const clientId = readGoogleOAuthClientId()
  if (!clientId) {
    throw new Error('Gmail 下書き作成には VITE_GOOGLE_OAUTH_CLIENT_ID の設定が必要です。')
  }

  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token
  }

  await loadGoogleIdentityServices()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google OAuth ライブラリを初期化できませんでした。')

  return new Promise<string>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_COMPOSE_SCOPE,
      callback: (response) => {
        if (response.access_token) {
          const ttlMs = (response.expires_in ?? 3600) * 1000
          // 期限の60秒手前で失効扱いにして、使用中に切れないようにする。
          cachedAccessToken = { token: response.access_token, expiresAt: Date.now() + ttlMs - 60_000 }
          resolve(response.access_token)
          return
        }
        reject(new Error(response.error_description || response.error || 'Gmail のアクセス許可を取得できませんでした。'))
      },
    })
    // prompt:'' → 初回のみ同意画面を表示し、以降は同意済みなら無表示でトークンを再取得する。
    tokenClient.requestAccessToken({ prompt: '' })
  })
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function toBase64Url(value: string) {
  return btoa(unescape(encodeURIComponent(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function encodeMimeMessage(value: string) {
  return toBase64Url(value)
}

function encodeHeader(value: string) {
  // ASCII 範囲(制御文字含む)判定で \x00 は意図的。値が非ASCIIなら MIME エンコードする。
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`
}

export async function createGmailDraftWithPdf(params: {
  accessToken: string
  to: string
  cc?: string
  subject: string
  bodyText: string
  pdfBlob: Blob
  pdfFileName: string
}) {
  const boundary = `komahyou_invoice_${Date.now()}`
  const pdfBase64 = arrayBufferToBase64(await params.pdfBlob.arrayBuffer())
  const message = [
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    `Subject: ${encodeHeader(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.bodyText,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${encodeHeader(params.pdfFileName)}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${encodeHeader(params.pdfFileName)}"`,
    '',
    pdfBase64.replace(/(.{76})/g, '$1\r\n'),
    '',
    `--${boundary}--`,
  ].join('\r\n')

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw: encodeMimeMessage(message) } }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Gmail 下書き作成に失敗しました (${response.status})。${errorText}`)
  }

  return await response.json() as { id: string; message?: { id?: string } }
}