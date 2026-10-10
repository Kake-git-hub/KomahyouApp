// ライブ検証スクリプトのサイト URL 解決(P-3): --site が最優先、無ければ --company(既定 main)を会社サイト一覧で引く。
import { describe, expect, it } from 'vitest'
import { resolveSiteUrl } from './verify-firebase-hosting.mjs'

describe('resolveSiteUrl', () => {
  it('既定(引数なし・.firebaserc の default = 本番)は従来どおり https://komahyouapp-prod.web.app', () => {
    expect(resolveSiteUrl({})).toBe('https://komahyouapp-prod.web.app')
    expect(resolveSiteUrl({ project: 'komahyouapp-prod' })).toBe('https://komahyouapp-prod.web.app')
    expect(resolveSiteUrl({ project: 'komahyouapp-staging' })).toBe('https://komahyouapp-staging.web.app')
  })

  it('--site が最優先・--company は会社サイト一覧で引く・未登録は例外', () => {
    expect(resolveSiteUrl({ site: 'https://example.test/' , project: 'komahyouapp-prod' })).toBe('https://example.test/')
    const sites = { companies: [
      { companyKey: 'main', hosting: { 'komahyouapp-prod': { siteId: 'komahyouapp-prod', url: 'https://komahyouapp-prod.web.app' } }, monitor: true },
      { companyKey: 'xyz', hosting: { 'komahyouapp-prod': { siteId: 'komahyou-xyz', url: 'https://komahyou-xyz.web.app' } }, monitor: true },
    ] }
    expect(resolveSiteUrl({ project: 'komahyouapp-prod', company: 'xyz' }, sites)).toBe('https://komahyou-xyz.web.app')
    expect(() => resolveSiteUrl({ project: 'komahyouapp-prod', company: 'nosuch' }, sites)).toThrow(/登録されていません/)
    expect(() => resolveSiteUrl({ project: 'komahyouapp-staging', company: 'xyz' }, sites)).toThrow(/サイトが/)
  })
})
