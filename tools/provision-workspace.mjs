// 会社(workspace)の新設ツール(P-5/P-12・2026-10-10・spec docs/spec-multi-tenant.md §6-2 / 計画 plan-2026-09-18 §3)。
//
//   node tools/provision-workspace.mjs --project <komahyouapp-staging|komahyouapp-prod> --workspace <会社キー> \
//     --company-name <会社名> [--brand-name <ブランド名>] [--billing-recipient <請求先名>] [--billing-email <請求先メール>] \
//     [--unit-price <標準単価(円)>] --developer-uid <オーナーの UID> --developer-email <オーナーのメール> [--developer-name <表示名>] \
//     [--confirm <会社キー>] [--dry-run]
//
// 作るもの(この 2 文書だけ。教室・室長は作らない = 教室は 2 社目のサイトの開発者画面から作る・runbook §4 手順 6):
//   - workspaces/<会社キー>            … 棟の文書。会社名・ブランド名・請求先・標準単価(P-11 ①の形)
//   - workspaces/<会社キー>/members/<uid> … オーナーの developer 会員(billingAllowed: true = 請求許可フラグ・P-11 ④ 第 1 段)。
//     会社側の developer は作らない(オーナー確定 2026-09-18 D-8)。
//
// ⚠️ 安全ガード(変更禁止・spec §6-2「指定した新キー以外へ書けないガード」):
//   - --workspace は必須・命名規則(英小文字と数字・3〜16 文字)・**main は拒否**。
//   - 既存キーの指定は拒否: 棟の文書が**既に存在すれば中止**(create-only = Firestore の currentDocument.exists=false 前提つき PATCH)。
//   - 書き込みは `workspaces/<会社キー>` とその直下の members/<uid> の 2 文書だけ。http() がそれ以外の URL への書き込みを例外で拒否する。
//   - --project は必須(既定なし)。本番(komahyouapp-prod)はさらに `--confirm <会社キー>` が一致しないと中止。
//   - 既存運営会社(main)の文書・他社の文書には GET も含めて触らない。
//
// 前提: gcloud CLI がオーナーアカウントで認証済み(`gcloud auth print-access-token` が通る)。本番はオーナー立会いで実行する
//       (CLAUDE.md 本番データ保護ルールの例外手順・runbook docs/runbooks/company-onboarding.md §4)。
import { execSync } from 'node:child_process'
import { isInvokedDirectly } from './invoked-directly.mjs'

export const USAGE = '使い方: node tools/provision-workspace.mjs --project <komahyouapp-staging|komahyouapp-prod> --workspace <会社キー> --company-name <会社名> --developer-uid <uid> --developer-email <mail> [--brand-name <名>] [--billing-recipient <名>] [--billing-email <mail>] [--unit-price <円>] [--developer-name <名>] [--confirm <会社キー>] [--dry-run]'

export const ALLOWED_PROJECTS = ['komahyouapp-staging', 'komahyouapp-prod']
export const PROD_PROJECT_ID = 'komahyouapp-prod'
export const WORKSPACE_KEY_PATTERN = /^[a-z0-9]{3,16}$/
export const RESERVED_WORKSPACE_KEYS = ['main']
export const DEFAULT_STANDARD_UNIT_PRICE = 300

export function parseArgs(argv) {
  const options = {
    project: '', workspaceKey: '', companyName: '', brandName: '', billingRecipient: '', billingEmail: '', unitPrice: '',
    developerUid: '', developerEmail: '', developerName: '', confirm: '', dryRun: false,
  }
  const map = {
    '--project': 'project', '--workspace': 'workspaceKey', '--company-name': 'companyName', '--brand-name': 'brandName',
    '--billing-recipient': 'billingRecipient', '--billing-email': 'billingEmail', '--unit-price': 'unitPrice',
    '--developer-uid': 'developerUid', '--developer-email': 'developerEmail', '--developer-name': 'developerName', '--confirm': 'confirm',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') { options.dryRun = true; continue }
    const field = map[arg]
    if (field) { options[field] = (argv[++index] ?? '').trim(); continue }
  }
  return options
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateArgs(options) {
  const errors = []
  if (!ALLOWED_PROJECTS.includes(options.project)) errors.push(`--project は ${ALLOWED_PROJECTS.join(' か ')} です(既定なし)。`)
  if (!options.workspaceKey) errors.push('--workspace <会社キー> は必須です。')
  else if (!WORKSPACE_KEY_PATTERN.test(options.workspaceKey)) errors.push(`--workspace "${options.workspaceKey}" が命名規則(英小文字と数字・3〜16 文字)に合いません。`)
  else if (RESERVED_WORKSPACE_KEYS.includes(options.workspaceKey)) errors.push(`--workspace "${options.workspaceKey}" は既存運営会社のキーです。新設には使えません。`)
  if (!options.companyName) errors.push('--company-name <会社名> は必須です。')
  if (!options.developerUid) errors.push('--developer-uid <オーナーの Firebase Auth UID> は必須です。')
  if (!options.developerEmail) errors.push('--developer-email <オーナーのメール> は必須です。')
  else if (!EMAIL_PATTERN.test(options.developerEmail)) errors.push(`--developer-email "${options.developerEmail}" の形式が不正です。`)
  if (options.billingEmail && !EMAIL_PATTERN.test(options.billingEmail)) errors.push(`--billing-email "${options.billingEmail}" の形式が不正です。`)
  if (options.unitPrice !== '' && !(/^\d+$/.test(options.unitPrice) && Number(options.unitPrice) >= 0)) errors.push(`--unit-price "${options.unitPrice}" は 0 以上の整数(円)で指定します。`)
  if (options.project === PROD_PROJECT_ID && !options.dryRun && options.confirm !== options.workspaceKey) {
    errors.push(`本番(${PROD_PROJECT_ID})へ作るには --confirm <会社キー>(= --workspace と同じ文字列)が必要です。`)
  }
  return errors
}

/** 棟の文書と developer 会員の文書(Firestore REST の fields 形式)。純関数(テストで形を固定)。 */
export function buildWorkspaceDocuments(options, nowIso = new Date().toISOString()) {
  const unitPrice = options.unitPrice === '' ? DEFAULT_STANDARD_UNIT_PRICE : Number(options.unitPrice)
  const workspaceDoc = {
    name: { stringValue: options.workspaceKey },
    schemaVersion: { integerValue: '1' },
    companyName: { stringValue: options.companyName },
    brandName: { stringValue: options.brandName || '' },
    billing: {
      mapValue: {
        fields: {
          recipientName: { stringValue: options.billingRecipient || options.companyName },
          recipientEmail: { stringValue: options.billingEmail || '' },
          standardUnitPrice: { integerValue: String(unitPrice) },
        },
      },
    },
    createdAt: { stringValue: nowIso },
    updatedAt: { timestampValue: nowIso },
    provisionedBy: { stringValue: 'tools/provision-workspace.mjs' },
  }
  const memberDoc = {
    displayName: { stringValue: options.developerName || options.developerEmail.toLowerCase() },
    email: { stringValue: options.developerEmail.toLowerCase() },
    role: { stringValue: 'developer' },
    assignedClassroomId: { nullValue: null },
    billingAllowed: { booleanValue: true },
    updatedAt: { stringValue: nowIso },
  }
  return {
    workspacePath: `workspaces/${options.workspaceKey}`,
    memberPath: `workspaces/${options.workspaceKey}/members/${options.developerUid}`,
    workspaceDoc,
    memberDoc,
  }
}

export function firestoreBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
}

/**
 * 書き込み先のガード。許すのは `workspaces/<会社キー>`(棟の文書)と `workspaces/<会社キー>/members/<uid>` だけ。
 * それ以外(他社・main・教室・別プロジェクト)への PATCH/POST/DELETE は例外。GET も棟の文書だけ。
 */
export function assertRequestAllowed({ method, url, projectId, workspaceKey, developerUid }) {
  const base = firestoreBase(projectId)
  const workspaceUrl = `${base}/workspaces/${workspaceKey}`
  const memberUrl = `${workspaceUrl}/members/${developerUid}`
  const path = url.split('?')[0]
  if (method === 'GET') {
    if (path !== workspaceUrl && path !== memberUrl) throw new Error(`読み取りを拒否(棟の文書と会員文書以外): ${url}`)
    return
  }
  if (method !== 'PATCH') throw new Error(`許可されていないメソッド: ${method} ${url}`)
  if (path !== workspaceUrl && path !== memberUrl) throw new Error(`書き込みを拒否(新設する workspace 以外): ${method} ${url}`)
  if (!url.includes('currentDocument.exists=false')) throw new Error(`create-only の前提(currentDocument.exists=false)が無い書き込みを拒否: ${url}`)
}

function getAccessToken() {
  return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim()
}

async function http(method, url, body, guard, token) {
  assertRequestAllowed({ method, url, ...guard })
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

export function describePlan(options, docs) {
  const lines = [
    `project      : ${options.project}${options.project === PROD_PROJECT_ID ? '  ★本番' : ''}`,
    `workspace    : ${options.workspaceKey}`,
    `会社名        : ${options.companyName}`,
    `ブランド名     : ${options.brandName || '(なし)'}`,
    `請求先        : ${docs.workspaceDoc.billing.mapValue.fields.recipientName.stringValue} <${docs.workspaceDoc.billing.mapValue.fields.recipientEmail.stringValue || '-'}>`,
    `標準単価      : ${docs.workspaceDoc.billing.mapValue.fields.standardUnitPrice.integerValue} 円/生徒`,
    `developer    : ${docs.memberDoc.email.stringValue} (uid=${options.developerUid}, billingAllowed=true)`,
    `作成する文書  : ${docs.workspacePath} / ${docs.memberPath}`,
  ]
  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const errors = validateArgs(options)
  if (errors.length > 0) {
    console.error(`${errors.join('\n')}\n${USAGE}`)
    process.exitCode = 1
    return
  }
  const docs = buildWorkspaceDocuments(options)
  console.log(describePlan(options, docs))
  if (options.dryRun) {
    console.log('\n--dry-run: 何も書き込みません。')
    return
  }

  const guard = { projectId: options.project, workspaceKey: options.workspaceKey, developerUid: options.developerUid }
  const base = firestoreBase(options.project)
  const token = getAccessToken()

  const existing = await http('GET', `${base}/${docs.workspacePath}`, undefined, guard, token)
  if (existing) {
    throw new Error(`workspaces/${options.workspaceKey} は既に存在します(既存キーの指定は拒否)。別のキーを使うか、既存の会社ならこのツールは使いません。`)
  }

  await http('PATCH', `${base}/${docs.workspacePath}?currentDocument.exists=false`, { fields: docs.workspaceDoc }, guard, token)
  console.log(`作成: ${docs.workspacePath}`)
  await http('PATCH', `${base}/${docs.memberPath}?currentDocument.exists=false`, { fields: docs.memberDoc }, guard, token)
  console.log(`作成: ${docs.memberPath}`)

  const check = await http('GET', `${base}/${docs.workspacePath}`, undefined, guard, token)
  console.log(`照合: companyName=${check?.fields?.companyName?.stringValue ?? '?'} standardUnitPrice=${check?.fields?.billing?.mapValue?.fields?.standardUnitPrice?.integerValue ?? '?'}`)
  console.log('\n次の手順(runbook §4): src/company/profiles/<会社キー>.ts → tools/company-sites.json → .firebaserc / firebase.json → Hosting サイト作成 → secret 登録 → Deploy Company Hosting。')
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
