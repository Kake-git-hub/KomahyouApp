#!/usr/bin/env node
// 本番(komahyouapp-prod)を**読むだけ**のアクセストークンを作る(オーナー指示 2026-09-26)。
// Claude のクラウド環境の環境変数 KOMAHYOU_READONLY_SA_JSON_B64 に、読み取り専用サービスアカウント
// (claude-readonly@komahyouapp-prod.iam.gserviceaccount.com・ロールは Cloud Datastore 閲覧者＋Storage オブジェクト閲覧者だけ)
// の JSON 鍵を base64 にした 1 行が入っている前提。トークンは 1 時間で切れるので、その都度作り直す。
//
//   export FIRESTORE_ACCESS_TOKEN=$(node tools/prod-readonly-token.mjs)
//   curl -s -H "Authorization: Bearer $FIRESTORE_ACCESS_TOKEN" \
//     "https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents/workspaces/main/developerReports/<reportId>"
//
// ★読み取り専用のスコープ(datastore は読み取り専用スコープが無いので、アカウント側のロールで読み取りに絞る)。
//   書き込み権限のある鍵(CI の RE_FIREBASE_SERVICE_ACCOUNT など)をこの変数に入れないこと(本番データ保護ルール)。
import { createSign } from 'node:crypto'

export const READONLY_SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/devstorage.read_only',
]

/** 環境変数の値(base64 の JSON 鍵)を読む。前後の空白・改行・全角括弧の貼り間違いを弾いて理由を返す。 */
export function decodeServiceAccount(rawValue) {
  const value = String(rawValue ?? '').trim()
  if (!value) throw new Error('環境変数 KOMAHYOU_READONLY_SA_JSON_B64 が空です(クラウド環境の設定に入れて、新しいセッションを開いてください)。')
  if (/[^A-Za-z0-9+/=\s]/.test(value)) {
    throw new Error('KOMAHYOU_READONLY_SA_JSON_B64 に base64 以外の文字があります(「（」「）」や引用符が混ざっていないか確認してください)。')
  }
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8'))
  } catch {
    throw new Error('KOMAHYOU_READONLY_SA_JSON_B64 を JSON として読めません(鍵ファイル全体を base64 にした 1 行か確認してください)。')
  }
  if (!parsed?.client_email || !parsed?.private_key) throw new Error('サービスアカウント鍵に client_email / private_key がありません。')
  return parsed
}

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Google OAuth の JWT bearer 付与に使う署名済み JWT を作る(純関数・時刻は引数)。 */
export function buildSignedJwt(serviceAccount, nowSeconds, scopes = READONLY_SCOPES) {
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token'
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: serviceAccount.private_key_id }))
  const claims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: scopes.join(' '),
    aud: tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  return { jwt: `${header}.${claims}.${base64Url(signer.sign(serviceAccount.private_key))}`, tokenUri }
}

export async function fetchReadonlyAccessToken(env = process.env, fetchImpl = fetch) {
  const serviceAccount = decodeServiceAccount(env.KOMAHYOU_READONLY_SA_JSON_B64)
  const { jwt, tokenUri } = buildSignedJwt(serviceAccount, Math.floor(Date.now() / 1000))
  const response = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) {
    throw new Error(`アクセストークンを取得できません(${response.status} ${body.error ?? ''} ${body.error_description ?? ''})`.trim())
  }
  return { accessToken: body.access_token, clientEmail: serviceAccount.client_email }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  fetchReadonlyAccessToken()
    .then(({ accessToken, clientEmail }) => {
      process.stderr.write(`OK: ${clientEmail} のトークン(1 時間有効)\n`)
      process.stdout.write(`${accessToken}\n`)
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    })
}
