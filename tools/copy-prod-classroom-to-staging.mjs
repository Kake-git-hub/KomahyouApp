#!/usr/bin/env node
// 本番教室の Firestore データを staging へコピーする（オーナー明示指示 2026-07-08）。
// 用途: staging のテストデータを「スクールIE 日大前の現状データ(出席状況込み)」にする。
//
//   node tools/copy-prod-classroom-to-staging.mjs [classroomId] [--promote-staging-member]
//
//   classroomId 省略時: 5w5OMueETerSKrSf14HC (スクールIE 日大前校)
//   --promote-staging-member: staging の members 全員を role=developer に昇格して
//     全教室を選択可能にする(assignedClassroomId は外す)。推奨。
//   --assign-staging-member: role は manager のまま、assignedClassroomId をコピーした
//     教室に切り替える(既存の staging_test_classroom は見えなくなる。戻すは再実行で可)。
//
// ⚠️ 安全ガード（変更禁止）:
//   - 本番(komahyouapp-prod)へは GET と読み取り専用 POST(:runQuery / :listCollectionIds)のみ。
//     http() が本番URLへの PATCH/DELETE/その他 POST を例外で拒否する。
//   - 書き込み・削除は staging(komahyouapp-staging) の URL のみ。
//   - このスクリプトを本番→本番のコピーに流用しない（教室クロス汚染インシデントの教訓）。
//
// 前提: gcloud CLI がオーナーアカウントで認証済み（両プロジェクトへの IAM アクセス）。
// 実行時間の目安: 数十秒〜数分（ドキュメント数による）。

import { execSync } from 'node:child_process'

const SOURCE_PROJECT = 'komahyouapp-prod'
const DEST_PROJECT = 'komahyouapp-staging'
const WORKSPACE_KEY = 'main'

if (DEST_PROJECT !== 'komahyouapp-staging') {
  throw new Error('DEST_PROJECT は komahyouapp-staging 固定。書き込み先の変更は禁止。')
}

const args = process.argv.slice(2)
const classroomId = args.find((a) => !a.startsWith('--')) ?? '5w5OMueETerSKrSf14HC'
const promoteMember = args.includes('--promote-staging-member')
const assignMember = args.includes('--assign-staging-member')

const SRC_BASE = `https://firestore.googleapis.com/v1/projects/${SOURCE_PROJECT}/databases/(default)/documents`
const DST_BASE = `https://firestore.googleapis.com/v1/projects/${DEST_PROJECT}/databases/(default)/documents`

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim()
if (!token) throw new Error('gcloud auth print-access-token が空。gcloud にログインしてください。')

const READ_ONLY_POST_SUFFIXES = [':runQuery', ':listCollectionIds']

async function http(method, url, body) {
  if (url.startsWith(SRC_BASE)) {
    const isGet = method === 'GET'
    const isReadOnlyPost = method === 'POST' && READ_ONLY_POST_SUFFIXES.some((s) => url.includes(s))
    if (!isGet && !isReadOnlyPost) {
      throw new Error(`本番への書き込み系リクエストを拒否: ${method} ${url}`)
    }
  } else if (!url.startsWith(DST_BASE)) {
    throw new Error(`想定外のURL: ${url}`)
  }
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

const relFromName = (name) => name.replace(/^projects\/[^/]+\/databases\/\(default\)\/documents\//, '')

async function listCollectionIds(base, relDocPath) {
  const out = []
  let pageToken
  do {
    const body = pageToken ? { pageSize: 100, pageToken } : { pageSize: 100 }
    const res = await http('POST', `${base}/${relDocPath}:listCollectionIds`, body)
    out.push(...(res?.collectionIds ?? []))
    pageToken = res?.nextPageToken
  } while (pageToken)
  return out
}

async function listDocs(base, relCollectionPath) {
  const out = []
  let pageToken
  do {
    const qs = new URLSearchParams({ pageSize: '300' })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await http('GET', `${base}/${relCollectionPath}?${qs}`)
    out.push(...(res?.documents ?? []))
    pageToken = res?.nextPageToken
  } while (pageToken)
  return out
}

async function queryLectureSubmissions(base) {
  const res = await fetch(`${base.replace(/\/documents$/, '')}/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'lectureSubmissions' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'classroomId' },
            op: 'EQUAL',
            value: { stringValue: classroomId },
          },
        },
      },
    }),
  })
  if (!res.ok) throw new Error(`runQuery ${base} -> ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const rows = await res.json()
  return rows.filter((r) => r.document).map((r) => r.document)
}

const stats = { copied: 0, deleted: 0 }

async function dstWrite(relDocPath, fields) {
  await http('PATCH', `${DST_BASE}/${relDocPath}`, { fields: fields ?? {} })
  stats.copied += 1
  if (stats.copied % 50 === 0) console.log(`  ... ${stats.copied} docs copied`)
}

async function dstDeleteTree(relDocPath) {
  for (const col of await listCollectionIds(DST_BASE, relDocPath)) {
    for (const doc of await listDocs(DST_BASE, `${relDocPath}/${col}`)) {
      await dstDeleteTree(relFromName(doc.name))
    }
  }
  const res = await http('DELETE', `${DST_BASE}/${relDocPath}`)
  if (res !== null) stats.deleted += 1
}

// source の relDocPath を(存在すれば)コピーし、サブコレクションを再帰コピーする。
async function copyTree(relDocPath, { required = false } = {}) {
  const doc = await http('GET', `${SRC_BASE}/${relDocPath}`)
  if (!doc && required) throw new Error(`本番に存在しません: ${relDocPath}`)
  if (doc) await dstWrite(relDocPath, doc.fields)
  for (const col of await listCollectionIds(SRC_BASE, relDocPath)) {
    for (const srcDoc of await listDocs(SRC_BASE, `${relDocPath}/${col}`)) {
      const rel = relFromName(srcDoc.name)
      await dstWrite(rel, srcDoc.fields)
      // さらに深いサブコレクションがあれば辿る(現行データ構造では通常なし)
      for (const subCol of await listCollectionIds(SRC_BASE, rel)) {
        for (const subDoc of await listDocs(SRC_BASE, `${rel}/${subCol}`)) {
          await dstWrite(relFromName(subDoc.name), subDoc.fields)
        }
      }
    }
  }
}

async function main() {
  console.log(`== 本番 ${SOURCE_PROJECT} → staging ${DEST_PROJECT} 教室コピー ==`)
  console.log(`classroomId: ${classroomId}`)

  const paths = [
    `workspaces/${WORKSPACE_KEY}/classrooms/${classroomId}`,
    `workspaces/${WORKSPACE_KEY}/classroomSettings/${classroomId}`,
    `workspaces/${WORKSPACE_KEY}/classroomSnapshots/${classroomId}`,
  ]

  console.log('-- staging 側の既存コピーを掃除 --')
  for (const p of paths) await dstDeleteTree(p)
  const staleSubs = await queryLectureSubmissions(DST_BASE)
  for (const doc of staleSubs) await dstDeleteTree(relFromName(doc.name))
  console.log(`  deleted: ${stats.deleted} docs`)

  console.log('-- 本番から読み取り → staging へ書き込み --')
  await copyTree(paths[0], { required: true })
  await copyTree(paths[1])
  await copyTree(paths[2], { required: true })

  const submissions = await queryLectureSubmissions(SRC_BASE)
  for (const doc of submissions) await dstWrite(relFromName(doc.name), doc.fields)
  console.log(`  lectureSubmissions: ${submissions.length} docs`)

  if (promoteMember || assignMember) {
    console.log('-- staging members の可視教室を更新 --')
    const members = await listDocs(DST_BASE, `workspaces/${WORKSPACE_KEY}/members`)
    for (const m of members) {
      const rel = relFromName(m.name)
      const qs = 'updateMask.fieldPaths=role&updateMask.fieldPaths=assignedClassroomId'
      const fields = promoteMember
        ? { role: { stringValue: 'developer' }, assignedClassroomId: { nullValue: null } }
        : { role: { stringValue: 'manager' }, assignedClassroomId: { stringValue: classroomId } }
      await http('PATCH', `${DST_BASE}/${rel}?${qs}`, { fields })
      console.log(`  ${rel.split('/').pop()} -> ${promoteMember ? 'developer(全教室)' : `manager(${classroomId})`}`)
    }
  }

  console.log('-- 検証(staging 読み返し) --')
  const top = await http('GET', `${DST_BASE}/workspaces/${WORKSPACE_KEY}/classroomSnapshots/${classroomId}`)
  console.log(`  snapshot doc: ${top ? 'OK' : 'MISSING'} (savedAt=${top?.fields?.savedAt?.stringValue ?? '?'})`)
  for (const col of await listCollectionIds(DST_BASE, `workspaces/${WORKSPACE_KEY}/classroomSnapshots/${classroomId}`)) {
    const docs = await listDocs(DST_BASE, `workspaces/${WORKSPACE_KEY}/classroomSnapshots/${classroomId}/${col}`)
    console.log(`  ${col}: ${docs.length} docs`)
  }
  const dstSubs = await queryLectureSubmissions(DST_BASE)
  console.log(`  lectureSubmissions: ${dstSubs.length} docs`)
  console.log(`== 完了: copied=${stats.copied} deleted=${stats.deleted} ==`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
