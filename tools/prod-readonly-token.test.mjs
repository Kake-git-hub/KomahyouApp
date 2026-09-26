import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { READONLY_SCOPES, buildSignedJwt, decodeServiceAccount, fetchReadonlyAccessToken } from './prod-readonly-token.mjs'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const serviceAccount = {
  client_email: 'claude-readonly@komahyouapp-prod.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  private_key_id: 'kid-1',
  token_uri: 'https://oauth2.googleapis.com/token',
}
const encoded = Buffer.from(JSON.stringify(serviceAccount)).toString('base64')

describe('prod-readonly-token: 本番を読むだけのトークン', () => {
  it('base64 の鍵を読む(前後の空白・折り返しは許す)', () => {
    expect(decodeServiceAccount(`  ${encoded.slice(0, 40)}\n${encoded.slice(40)}  `).client_email).toBe(serviceAccount.client_email)
  })

  it('貼り間違い(全角括弧・空)は理由つきで弾く', () => {
    expect(() => decodeServiceAccount(`（${encoded}）`)).toThrow('base64 以外の文字')
    expect(() => decodeServiceAccount('')).toThrow('空です')
    expect(() => decodeServiceAccount(Buffer.from('{}').toString('base64'))).toThrow('client_email')
  })

  it('JWT は読み取り系スコープだけを要求し、鍵で正しく署名される', () => {
    const { jwt, tokenUri } = buildSignedJwt(serviceAccount, 1_000)
    const [header, claims, signature] = jwt.split('.')
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'))
    expect(tokenUri).toBe('https://oauth2.googleapis.com/token')
    expect(payload).toMatchObject({ iss: serviceAccount.client_email, aud: tokenUri, iat: 1_000, exp: 4_600 })
    expect(payload.scope.split(' ')).toEqual(READONLY_SCOPES)
    expect(payload.scope).not.toContain('cloud-platform')
    expect(payload.scope).not.toContain('read_write')
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${claims}`)
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('トークン取得の成否を返す(失敗時は Google の理由を含める)', async () => {
    const ok = await fetchReadonlyAccessToken({ KOMAHYOU_READONLY_SA_JSON_B64: encoded }, async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }))
    expect(ok).toEqual({ accessToken: 'tok', clientEmail: serviceAccount.client_email })
    await expect(fetchReadonlyAccessToken({ KOMAHYOU_READONLY_SA_JSON_B64: encoded }, async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'bad' }) })))
      .rejects.toThrow('400 invalid_grant bad')
  })
})
