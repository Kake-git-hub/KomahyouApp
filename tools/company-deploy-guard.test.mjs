// 会社配信 CI の前提検査(P-4)。会社キー・プロファイル・サイト一覧・.firebaserc・env の整合を fail-closed で検査する。
import { describe, expect, it } from 'vitest'
import { buildRepoDeps, collectGuardErrors, parseArgs, parseEnvFile } from './company-deploy-guard.mjs'

const sites = {
  companies: [
    { companyKey: 'main', hosting: { 'komahyouapp-prod': { siteId: 'komahyouapp-prod', url: 'https://komahyouapp-prod.web.app' } }, monitor: true },
    { companyKey: 'xyz', hosting: { 'komahyouapp-prod': { siteId: 'komahyou-xyz', url: 'https://komahyou-xyz.web.app' }, 'komahyouapp-staging': { siteId: 'komahyou-xyz-staging', url: 'https://komahyou-xyz-staging.web.app' } }, monitor: true },
  ],
}
const deps = {
  sites,
  firebaserc: { targets: { 'komahyouapp-prod': { hosting: { main: ['komahyouapp-prod'], xyz: ['komahyou-xyz'] } }, 'komahyouapp-staging': { hosting: { main: ['komahyouapp-staging'] } } } },
  firebaseJson: { hosting: [{ target: 'main' }, { target: 'xyz' }] },
  profileFileExists: (key) => key === 'xyz' || key === 'main',
  profileRegistered: (key) => key === 'xyz' || key === 'main',
}
const goodEnv = ['VITE_FIREBASE_API_KEY=k', 'VITE_FIREBASE_AUTH_DOMAIN=d', 'VITE_FIREBASE_PROJECT_ID=komahyouapp-prod', 'VITE_FIREBASE_APP_ID=a', 'VITE_FIREBASE_WORKSPACE_KEY=xyz', 'VITE_COMPANY_KEY=xyz'].join('\n')

describe('collectGuardErrors', () => {
  it('登録済みの会社・一致する env なら合格', () => {
    expect(collectGuardErrors({ company: 'xyz', project: 'komahyouapp-prod', envText: goodEnv }, deps)).toEqual([])
    expect(collectGuardErrors({ company: 'xyz', project: 'komahyouapp-prod' }, deps)).toEqual([])
  })

  it('main・命名規則違反・未知のプロジェクトは拒否', () => {
    expect(collectGuardErrors({ company: 'main', project: 'komahyouapp-prod' }, deps).join()).toMatch(/main/)
    expect(collectGuardErrors({ company: 'XYZ', project: 'komahyouapp-prod' }, deps).join()).toMatch(/命名規則/)
    expect(collectGuardErrors({ company: 'xyz', project: 'other' }, deps).join()).toMatch(/--project/)
  })

  it('プロファイル無し・登録無し・サイト一覧無し・.firebaserc target 無し・firebase.json 要素無しをそれぞれ検出', () => {
    const noProfile = { ...deps, profileFileExists: () => false }
    expect(collectGuardErrors({ company: 'xyz', project: 'komahyouapp-prod' }, noProfile).join()).toMatch(/profiles\/xyz\.ts/)
    const noReg = { ...deps, profileRegistered: () => false }
    expect(collectGuardErrors({ company: 'xyz', project: 'komahyouapp-prod' }, noReg).join()).toMatch(/index\.ts/)
    expect(collectGuardErrors({ company: 'abc', project: 'komahyouapp-prod' }, { ...deps, profileFileExists: () => true, profileRegistered: () => true }).join()).toMatch(/登録されていません/)
    // staging の target が .firebaserc に無い
    expect(collectGuardErrors({ company: 'xyz', project: 'komahyouapp-staging' }, deps).join()).toMatch(/\.firebaserc/)
    const noJson = { ...deps, firebaseJson: { hosting: [{ target: 'main' }] } }
    expect(collectGuardErrors({ company: 'xyz', project: 'komahyouapp-prod' }, noJson).join()).toMatch(/firebase\.json/)
  })

  it('env の workspace / 会社キー / プロジェクトの食い違い・local モード・必須値欠落を検出', () => {
    const run = (text) => collectGuardErrors({ company: 'xyz', project: 'komahyouapp-prod', envText: text }, deps).join('\n')
    expect(run(goodEnv.replace('VITE_FIREBASE_WORKSPACE_KEY=xyz', 'VITE_FIREBASE_WORKSPACE_KEY=main'))).toMatch(/VITE_FIREBASE_WORKSPACE_KEY/)
    expect(run(goodEnv.replace('VITE_COMPANY_KEY=xyz', 'VITE_COMPANY_KEY=abc'))).toMatch(/VITE_COMPANY_KEY/)
    expect(run(goodEnv.replace('komahyouapp-prod', 'komahyouapp-staging'))).toMatch(/VITE_FIREBASE_PROJECT_ID/)
    expect(run(`${goodEnv}\nVITE_EXTERNAL_BACKEND_MODE=local`)).toMatch(/local/)
    expect(run(goodEnv.replace('VITE_FIREBASE_APP_ID=a\n', ''))).toMatch(/VITE_FIREBASE_APP_ID/)
  })

  it('parseArgs / parseEnvFile', () => {
    expect(parseArgs(['--company', ' xyz ', '--project', 'komahyouapp-prod', '--env-file', '.env.production.local'])).toEqual({ company: 'xyz', project: 'komahyouapp-prod', envFile: '.env.production.local' })
    expect(parseEnvFile('# c\nA=1\nB = two=2\n\nbad')).toEqual({ A: '1', B: 'two=2' })
  })

  it('実リポジトリ: main は登録済み(プロファイル・サイト一覧・.firebaserc・firebase.json)だが、このワークフローでは拒否される', () => {
    const real = buildRepoDeps()
    expect(real.profileFileExists('main')).toBe(true)
    expect(real.profileRegistered('main')).toBe(true)
    expect(collectGuardErrors({ company: 'main', project: 'komahyouapp-prod' }, real)).toEqual(['main(既存運営会社)はこのワークフローでは配信しません(deploy-firebase-hosting.yml を使う)'])
  })
})
