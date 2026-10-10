// 会社サイト一覧(tools/company-sites.json)と .firebaserc / firebase.json の整合(P-3)。
// 「JSON に会社を足したのに .firebaserc の target が無い」「firebase.json の hosting 要素の中身が会社ごとにズレた」を CI で止める。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  expectedFirebasercTargets,
  listMonitoredSites,
  loadCompanySites,
  resolveCompanySite,
  validateCompanySites,
} from './company-sites.mjs'

const sites = loadCompanySites()
const firebaserc = JSON.parse(readFileSync(resolve('.firebaserc'), 'utf8'))
const firebaseJson = JSON.parse(readFileSync(resolve('firebase.json'), 'utf8'))

describe('company-sites.json', () => {
  it('既存運営会社 main は本番 komahyouapp-prod.web.app・staging komahyouapp-staging.web.app のまま(配布済み QR・URL は不変)', () => {
    expect(resolveCompanySite(sites, 'main', 'komahyouapp-prod')).toEqual({
      companyKey: 'main', projectId: 'komahyouapp-prod', siteId: 'komahyouapp-prod', url: 'https://komahyouapp-prod.web.app', hostingTarget: 'main',
    })
    expect(resolveCompanySite(sites, 'main', 'komahyouapp-staging').url).toBe('https://komahyouapp-staging.web.app')
  })

  it('未登録の会社・無いプロジェクトは例外(別会社の URL へ黙って落とさない)', () => {
    expect(() => resolveCompanySite(sites, 'nosuch', 'komahyouapp-prod')).toThrow(/登録されていません/)
    const only = { companies: [{ companyKey: 'xyz', hosting: { 'komahyouapp-prod': { siteId: 'komahyou-xyz', url: 'https://komahyou-xyz.web.app' } }, monitor: true }] }
    expect(() => resolveCompanySite(only, 'xyz', 'komahyouapp-staging')).toThrow(/サイトが/)
  })

  it('.firebaserc の hosting target(= 会社キー → siteId)が JSON と一致する', () => {
    const expected = expectedFirebasercTargets(sites)
    for (const [projectId, { hosting }] of Object.entries(expected)) {
      expect(firebaserc.targets?.[projectId]?.hosting, projectId).toEqual(hosting)
    }
    // 旧 target 名 'default' は使わない(--only hosting:<会社キー> で会社を選ぶ)。
    for (const projectId of Object.keys(firebaserc.targets ?? {})) {
      expect(firebaserc.targets[projectId].hosting.default, projectId).toBeUndefined()
    }
  })

  it('firebase.json の hosting は配列で、要素は会社キーごとに 1 つ・target 以外の中身は main と同一', () => {
    expect(Array.isArray(firebaseJson.hosting)).toBe(true)
    const targets = firebaseJson.hosting.map((entry) => entry.target)
    expect(targets).toEqual(sites.companies.map((company) => company.companyKey))
    const strip = (entry) => JSON.stringify({ ...entry, target: undefined })
    const mainEntry = firebaseJson.hosting.find((entry) => entry.target === 'main')
    for (const entry of firebaseJson.hosting) expect(strip(entry), entry.target).toBe(strip(mainEntry))
    // 配信内容は従来どおり(dist・SPA rewrite・API rewrite)。
    expect(mainEntry.public).toBe('dist')
    expect(mainEntry.rewrites.at(-1)).toEqual({ source: '**', destination: '/index.html' })
  })

  it('外形監視の対象: 本番は monitor:true の会社すべて・staging は指定時だけ', () => {
    expect(listMonitoredSites(sites)).toEqual([{ name: 'prod', base: 'https://komahyouapp-prod.web.app', companyKey: 'main' }])
    expect(listMonitoredSites(sites, { includeStaging: true })).toEqual([
      { name: 'prod', base: 'https://komahyouapp-prod.web.app', companyKey: 'main' },
      { name: 'staging', base: 'https://komahyouapp-staging.web.app', companyKey: 'main' },
    ])
    const two = {
      companies: [
        ...sites.companies,
        { companyKey: 'xyz', label: 'x', hosting: { 'komahyouapp-prod': { siteId: 'komahyou-xyz', url: 'https://komahyou-xyz.web.app' } }, monitor: true },
        { companyKey: 'off', label: 'o', hosting: { 'komahyouapp-prod': { siteId: 'komahyou-off', url: 'https://komahyou-off.web.app' } }, monitor: false },
      ],
    }
    expect(listMonitoredSites(two, { includeStaging: true }).map((t) => t.name)).toEqual(['prod', 'prod:xyz', 'staging'])
  })

  it('validateCompanySites: 命名規則違反・重複キー・siteId 重複・本番サイト無し・URL 形式を検出する', () => {
    const base = { companyKey: 'xyz', hosting: { 'komahyouapp-prod': { siteId: 'komahyou-xyz', url: 'https://komahyou-xyz.web.app' } }, monitor: true }
    expect(validateCompanySites({ companies: [base] })).toEqual([])
    expect(validateCompanySites({ companies: [{ ...base, companyKey: 'XYZ' }] }).join()).toMatch(/命名規則/)
    expect(validateCompanySites({ companies: [base, base] }).join()).toMatch(/重複/)
    expect(validateCompanySites({ companies: [base, { ...base, companyKey: 'abc' }] }).join()).toMatch(/siteId が重複/)
    expect(validateCompanySites({ companies: [{ ...base, hosting: {} }] }).join()).toMatch(/本番/)
    expect(validateCompanySites({ companies: [{ ...base, hosting: { 'komahyouapp-prod': { siteId: 'a', url: 'https://a.web.app/' } } }] }).join()).toMatch(/url/)
    expect(validateCompanySites({ companies: [{ ...base, monitor: 'yes' }] }).join()).toMatch(/monitor/)
  })
})
