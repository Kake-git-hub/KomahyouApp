// 会社(workspace)ごとの Hosting サイト一覧 tools/company-sites.json の読み取りと検証(P-3・2026-10-10)。
// 正本は JSON。ここは純関数(テスト可能)と、ファイルを読む薄い入口だけ。
//
//   - resolveCompanySite(sites, companyKey, projectId) … その会社・そのプロジェクトのサイト(siteId・url)
//   - listMonitoredSites(sites, { includeStaging })    … 外形監視の対象(prod は monitor:true の会社すべて)
//   - validateCompanySites(sites)                        … 形の検査(キー重複・命名規則・URL)
//   - expectedFirebasercTargets(sites)                   … .firebaserc の targets に期待する形(テストで突き合わせ)
//
// 会社キーの命名規則は D-2(英小文字と数字・3〜16 文字)。既存の main は許容。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROD_PROJECT_ID = 'komahyouapp-prod'
export const STAGING_PROJECT_ID = 'komahyouapp-staging'
export const COMPANY_KEY_PATTERN = /^[a-z0-9]{3,16}$/

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const COMPANY_SITES_PATH = resolve(scriptDir, 'company-sites.json')

export function loadCompanySites(path = COMPANY_SITES_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const errors = validateCompanySites(parsed)
  if (errors.length > 0) throw new Error(`tools/company-sites.json が不正です:\n- ${errors.join('\n- ')}`)
  return parsed
}

export function validateCompanySites(sites) {
  const errors = []
  if (!sites || !Array.isArray(sites.companies)) return ['companies が配列ではありません']
  const seen = new Set()
  for (const company of sites.companies) {
    const key = typeof company?.companyKey === 'string' ? company.companyKey : ''
    if (!COMPANY_KEY_PATTERN.test(key)) errors.push(`companyKey "${key}" が命名規則(英小文字と数字・3〜16 文字)に合いません`)
    if (seen.has(key)) errors.push(`companyKey "${key}" が重複しています`)
    seen.add(key)
    if (!company.hosting || typeof company.hosting !== 'object') {
      errors.push(`${key}: hosting がありません`)
      continue
    }
    for (const [projectId, site] of Object.entries(company.hosting)) {
      if (projectId !== PROD_PROJECT_ID && projectId !== STAGING_PROJECT_ID) errors.push(`${key}: 未知のプロジェクト ${projectId}`)
      if (!site || typeof site.siteId !== 'string' || !site.siteId.trim()) errors.push(`${key}/${projectId}: siteId がありません`)
      if (!site || typeof site.url !== 'string' || !/^https:\/\/[^/\s]+$/.test(site.url)) errors.push(`${key}/${projectId}: url は https://ホスト名(末尾スラッシュ無し)で書きます`)
    }
    if (!company.hosting[PROD_PROJECT_ID]) errors.push(`${key}: 本番(${PROD_PROJECT_ID})のサイトがありません`)
    if (typeof company.monitor !== 'boolean') errors.push(`${key}: monitor(true/false)がありません`)
  }
  // siteId はプロジェクト内で一意(2 社が同じサイトへ配信しない)。
  for (const projectId of [PROD_PROJECT_ID, STAGING_PROJECT_ID]) {
    const ids = sites.companies.map((company) => company.hosting?.[projectId]?.siteId).filter(Boolean)
    const dup = ids.filter((id, index) => ids.indexOf(id) !== index)
    if (dup.length > 0) errors.push(`${projectId}: siteId が重複しています(${[...new Set(dup)].join(', ')})`)
  }
  return errors
}

export function findCompany(sites, companyKey) {
  const key = typeof companyKey === 'string' ? companyKey.trim() : ''
  return sites.companies.find((company) => company.companyKey === key) ?? null
}

/** その会社・そのプロジェクトのサイト。無ければ例外(fail-closed: 別会社の URL へ黙って落とさない)。 */
export function resolveCompanySite(sites, companyKey, projectId) {
  const company = findCompany(sites, companyKey)
  if (!company) throw new Error(`会社 "${companyKey}" は tools/company-sites.json に登録されていません(登録済み: ${sites.companies.map((c) => c.companyKey).join(', ')})`)
  const site = company.hosting[projectId]
  if (!site) throw new Error(`会社 "${companyKey}" のプロジェクト ${projectId} のサイトが tools/company-sites.json にありません`)
  return { companyKey: company.companyKey, projectId, siteId: site.siteId, url: site.url, hostingTarget: company.companyKey }
}

/** 外形監視の対象。本番は monitor:true の会社すべて。staging は includeStaging のときだけ(staging サイトがある会社のみ)。 */
export function listMonitoredSites(sites, { includeStaging = false } = {}) {
  const targets = []
  for (const company of sites.companies) {
    if (!company.monitor) continue
    const prod = company.hosting[PROD_PROJECT_ID]
    if (prod) targets.push({ name: company.companyKey === 'main' ? 'prod' : `prod:${company.companyKey}`, base: prod.url, companyKey: company.companyKey })
  }
  if (includeStaging) {
    for (const company of sites.companies) {
      if (!company.monitor) continue
      const staging = company.hosting[STAGING_PROJECT_ID]
      if (staging) targets.push({ name: company.companyKey === 'main' ? 'staging' : `staging:${company.companyKey}`, base: staging.url, companyKey: company.companyKey })
    }
  }
  return targets
}

/** .firebaserc の targets.<projectId>.hosting に期待する形(target 名 = companyKey → [siteId])。 */
export function expectedFirebasercTargets(sites) {
  const result = {}
  for (const company of sites.companies) {
    for (const [projectId, site] of Object.entries(company.hosting)) {
      result[projectId] ??= { hosting: {} }
      result[projectId].hosting[company.companyKey] = [site.siteId]
    }
  }
  return result
}
