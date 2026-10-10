// 会社ごとの配信 CI(.github/workflows/deploy-company-hosting.yml・P-4)の前提検査。fail-closed。
//
//   node tools/company-deploy-guard.mjs --company <会社キー> --project <komahyouapp-prod|komahyouapp-staging> [--env-file <path>]
//
// 検査する内容(どれか 1 つでも欠けたら exit 1):
//   1. 会社キーの命名規則(D-2)。main は拒否(既存運営会社は deploy-firebase-hosting.yml が担当・自動 bump つき)。
//   2. src/company/profiles/<会社キー>.ts が存在し、profiles/index.ts に登録されている(P-1)。
//   3. tools/company-sites.json に会社行があり、そのプロジェクトのサイトがある(P-3)。
//   4. .firebaserc の targets.<project>.hosting.<会社キー> が siteId を指す。firebase.json の hosting に target がある。
//   5. --env-file があれば、その中の VITE_FIREBASE_WORKSPACE_KEY / VITE_COMPANY_KEY が会社キーと、VITE_FIREBASE_PROJECT_ID が
//      プロジェクトと一致し、VITE_EXTERNAL_BACKEND_MODE=local でない(別会社・別プロジェクトの設定で配信しない)。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COMPANY_KEY_PATTERN, loadCompanySites, resolveCompanySite } from './company-sites.mjs'
import { isInvokedDirectly } from './invoked-directly.mjs'

export function parseArgs(argv) {
  const options = { company: '', project: '', envFile: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--company') { options.company = (argv[++index] ?? '').trim(); continue }
    if (arg === '--project') { options.project = (argv[++index] ?? '').trim(); continue }
    if (arg === '--env-file') { options.envFile = (argv[++index] ?? '').trim(); continue }
  }
  return options
}

export function parseEnvFile(text) {
  return Object.fromEntries(
    text.split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
    }),
  )
}

/**
 * 純関数の検査本体。ファイルの有無などは deps で注入する(テスト用)。
 * 戻り値はエラー文の配列(空 = 合格)。
 */
export function collectGuardErrors(options, deps) {
  const errors = []
  const { company, project, envText } = options
  if (!COMPANY_KEY_PATTERN.test(company)) errors.push(`会社キー "${company}" が命名規則(英小文字と数字・3〜16 文字)に合いません`)
  if (company === 'main') errors.push('main(既存運営会社)はこのワークフローでは配信しません(deploy-firebase-hosting.yml を使う)')
  if (project !== 'komahyouapp-prod' && project !== 'komahyouapp-staging') errors.push(`--project は komahyouapp-prod か komahyouapp-staging です: "${project}"`)
  if (errors.length > 0) return errors

  if (!deps.profileFileExists(company)) errors.push(`src/company/profiles/${company}.ts がありません(P-1)`)
  if (!deps.profileRegistered(company)) errors.push(`src/company/profiles/index.ts に ${company} が登録されていません(P-1)`)

  let site = null
  try {
    site = resolveCompanySite(deps.sites, company, project)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (site) {
    const target = deps.firebaserc?.targets?.[project]?.hosting?.[company]
    if (!Array.isArray(target) || target[0] !== site.siteId) {
      errors.push(`.firebaserc の targets.${project}.hosting.${company} が ["${site.siteId}"] ではありません(P-3)`)
    }
    const hosting = Array.isArray(deps.firebaseJson?.hosting) ? deps.firebaseJson.hosting : []
    if (!hosting.some((entry) => entry?.target === company)) errors.push(`firebase.json の hosting に target "${company}" の要素がありません(P-3)`)
  }

  if (typeof envText === 'string') {
    const env = parseEnvFile(envText)
    if ((env.VITE_EXTERNAL_BACKEND_MODE || '').toLowerCase() === 'local') errors.push('VITE_EXTERNAL_BACKEND_MODE=local では Firebase に接続しません')
    for (const key of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_WORKSPACE_KEY']) {
      if (!env[key]) errors.push(`env に ${key} がありません`)
    }
    if (env.VITE_FIREBASE_WORKSPACE_KEY && env.VITE_FIREBASE_WORKSPACE_KEY !== company) errors.push(`env の VITE_FIREBASE_WORKSPACE_KEY(${env.VITE_FIREBASE_WORKSPACE_KEY})が会社キー(${company})と一致しません(混線防止)`)
    if (env.VITE_COMPANY_KEY && env.VITE_COMPANY_KEY !== company) errors.push(`env の VITE_COMPANY_KEY(${env.VITE_COMPANY_KEY})が会社キー(${company})と一致しません(混線防止)`)
    if (env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_PROJECT_ID !== project) errors.push(`env の VITE_FIREBASE_PROJECT_ID(${env.VITE_FIREBASE_PROJECT_ID})が配信先(${project})と一致しません`)
  }
  return errors
}

export function buildRepoDeps() {
  const profilesIndex = readFileSync(resolve('src/company/profiles/index.ts'), 'utf8')
  return {
    sites: loadCompanySites(),
    firebaserc: JSON.parse(readFileSync(resolve('.firebaserc'), 'utf8')),
    firebaseJson: JSON.parse(readFileSync(resolve('firebase.json'), 'utf8')),
    profileFileExists: (company) => existsSync(resolve('src/company/profiles', `${company}.ts`)),
    profileRegistered: (company) => new RegExp(`^\\s*${company}:\\s`, 'm').test(profilesIndex),
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const envText = options.envFile ? readFileSync(resolve(options.envFile), 'utf8') : undefined
  const errors = collectGuardErrors({ company: options.company, project: options.project, envText }, buildRepoDeps())
  if (errors.length > 0) {
    console.error(`会社配信の前提検査に失敗しました(会社キー ${options.company || '(空)'}・${options.project || '(空)'}):\n- ${errors.join('\n- ')}`)
    process.exitCode = 1
    return
  }
  console.log(`company deploy guard OK: company=${options.company} project=${options.project}${envText !== undefined ? ' env=OK' : ''}`)
}

if (isInvokedDirectly(import.meta.url)) main()
